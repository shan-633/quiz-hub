import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { z } from 'zod';
import { bankPackageSchema, parseBankPackage, type BankPackage } from '../shared/bankImport';
import { buildRealBeijing2022 } from '../server/content/beijing2022Real';
import { walkBlocks } from '../shared/domain';
import type { Block, Question } from '../shared/model';
import manifest from '../content-assets/beijing-2022/manifest.json';
const directory = 'content-assets/import';
mkdirSync(directory, { recursive: true });
const stripBlocks = (blocks: Block[]): Block[] =>
  blocks.map((block) => {
    if (block.type === 'image') {
      const { intrinsicWidth, intrinsicHeight, ...rest } = block;
      return rest;
    }
    return 'children' in block ? { ...block, children: stripBlocks(block.children) } : block;
  });
const portable = (q: Question) => {
  const { bankId, version, state, ...rest } = q;
  return { ...rest, content: stripBlocks(q.content), solution: q.solution! };
};
const real = buildRealBeijing2022();
const pack = (title: string, questions: BankPackage['questions']): BankPackage => {
  const used = new Set(
    questions.flatMap((q) =>
      walkBlocks(q.content).flatMap((b) => (b.type === 'image' && b.assetId ? [b.assetId] : [])),
    ),
  );
  return {
    format: 'zhixu.question-bank',
    version: '1.0',
    bank: {
      title,
      description: '依据原题与来源记录校录。图像为来源PDF截图，保留原字节和水印；导入为独立题库。',
      chapter: '九年级 · 综合',
      minutes: 70,
      accent: 'exam',
    },
    questions,
    assets: manifest.assets
      .filter((a) => used.has(a.id))
      .map((a) => ({
        id: a.id,
        mimeType: 'image/webp',
        name: a.webp,
        data: readFileSync('content-assets/beijing-2022/' + a.webp).toString('base64'),
      })),
  };
};
const minimal = {
  format: 'zhixu.question-bank',
  version: '1.0',
  bank: { title: '协议演示 · 最小题库', minutes: 5 },
  questions: [
    {
      id: 'q1',
      type: 'single',
      title: '力的单位',
      score: 2,
      content: [{ id: 'stem', type: 'paragraph', text: '下列哪个是力的国际单位？' }],
      options: [
        { id: 'a', text: '牛顿' },
        { id: 'b', text: '焦耳' },
      ],
      solution: { choices: ['a'], explanation: '力的国际单位是牛顿，符号为N。' },
    },
  ],
};
const fill: BankPackage['questions'][number] = {
  id: 'demo-fill',
  type: 'fill',
  title: '协议演示填空（非真题）',
  score: 2,
  difficulty: '基础',
  tags: ['单位'],
  source: '协议演示题，用于展示稳定填空与数值容差，不属于北京真题卷。',
  options: [],
  blanks: [{ id: 'mass', label: '质量', kind: 'number', unit: 'kg', score: 2 }],
  content: [{ id: 'p', type: 'paragraph', text: '1000 g = {{mass}} kg。' }],
  solution: {
    choices: [],
    blanks: { mass: { accepted: ['1'], tolerance: 0 } },
    explanation: '1 kg = 1000 g。',
  },
};
const six = pack('协议演示 · 六题型示例（非试卷）', [
  ...real.questions
    .filter((q) =>
      ['bj2022-q01', 'bj2022-q13', 'bj2022-q16', 'bj2022-q24', 'bj2022-q25'].includes(q.id),
    )
    .map(portable),
  fill,
]);
six.bank.description =
  '六种格式各一题：五题复用标明来源的2022北京原题，填空为明确标识的协议演示题。本文件不是一套真实试卷。';
six.bank.minutes = 30;
for (const [name, value] of Object.entries({
  'minimal.zqb.json': minimal,
  'six-types.zqb.json': six,
  'beijing-2022.zqb.json': pack('2022北京中考物理 · 文件导入示例', real.questions.map(portable)),
})) {
  const text = JSON.stringify(value, null, 2) + '\n',
    report = parseBankPackage(text);
  if (!report.valid) throw new Error(name + JSON.stringify(report.errors));
  writeFileSync(directory + '/' + name, text);
}
const schema = z.toJSONSchema(bankPackageSchema, { target: 'draft-2020-12', io: 'input' });
writeFileSync(directory + '/question-bank-v1.schema.json', JSON.stringify(schema, null, 2) + '\n');
copyFileSync('docs/import-protocol-v1.md', directory + '/protocol-v1.md');
console.log(
  'Generated protocol, JSON Schema, minimal, six-type and real Beijing portable examples.',
);
