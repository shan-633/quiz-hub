import { z } from 'zod';
import { curriculumSchema } from './curriculum';
import katex from 'katex';
import type { Block, Question, QuestionType } from './model';
import { validateQuestion, walkBlocks } from './domain';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const id = z
  .string()
  .regex(
    /^(?!(?:__proto__|prototype|constructor|__defineGetter__|__defineSetter__|hasOwnProperty|__lookupGetter__|__lookupSetter__|isPrototypeOf|propertyIsEnumerable|toString|valueOf|toLocaleString)$)[a-zA-Z0-9_-]{1,128}$/,
  );
const text = z.string().max(100000);
const option = z.object({ id, text: z.string().trim().min(1).max(5000) }).strict();
const block: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ id, type: z.literal('paragraph'), text }).strict(),
    z.object({ id, type: z.literal('formula'), latex: z.string().min(1).max(10000) }).strict(),
    z
      .object({
        id,
        type: z.literal('image'),
        assetId: id,
        alt: z.string().trim().min(1).max(1000),
        caption: z.string().max(1000).default(''),
        width: z.number().min(10).max(100).default(100),
      })
      .strict(),
    z
      .object({
        id,
        type: z.literal('table'),
        headers: z.array(z.string().max(5000)).min(1).max(20),
        rows: z.array(z.array(z.string().max(5000)).max(20)).max(100),
      })
      .strict(),
    z
      .object({
        id,
        type: z.literal('group'),
        layout: z.enum(['stack', 'mediaAside']),
        children: z.array(block).min(1).max(50),
      })
      .strict(),
    z
      .object({
        id,
        type: z.literal('subquestion'),
        label: z.string().trim().min(1).max(200),
        score: z.number().positive().max(100),
        responseKind: z.enum(['blanks', 'single', 'multiple', 'open']),
        options: z.array(option).max(20).optional(),
        children: z.array(block).min(1).max(50),
      })
      .strict(),
  ]),
);
const rule = z
  .object({
    accepted: z.array(z.string().max(1000)).max(30),
    tolerance: z.number().min(0).max(1e12).optional(),
    ignoreWhitespace: z.boolean().optional(),
  })
  .strict();
const question = z
  .object({
    id,
    type: z.enum(['single', 'multiple', 'fill', 'experiment', 'reading', 'calculation']),
    title: z.string().trim().min(1).max(300),
    score: z.number().positive().max(1000),
    difficulty: z.string().max(50).default('基础'),
    tags: z.array(z.string().max(100)).max(20).default([]),
    source: z.string().max(1000).optional(),
    content: z.array(block).min(1).max(100),
    options: z.array(option).max(20).default([]),
    blanks: z
      .array(
        z
          .object({
            id,
            label: z.string().trim().min(1).max(200),
            score: z.number().positive().max(100),
            kind: z.enum(['text', 'number', 'manual']),
            unit: z.string().max(100).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    solution: z
      .object({
        choices: z.array(id).max(20).default([]),
        blanks: z.record(id, rule).default({}),
        partChoices: z.record(id, z.array(id).max(20)).optional(),
        explanation: text.refine((v) => !!v.trim(), '请填写参考解析'),
        referenceImages: z
          .array(z.object({ assetId: id, caption: z.string().max(1000).default('') }).strict())
          .max(20)
          .optional(),
      })
      .strict(),
    multipleScoring: z.enum(['exact', 'half']).optional(),
    allowedModes: z
      .array(z.enum(['text', 'drawing', 'photo']))
      .min(1)
      .max(3)
      .optional(),
  })
  .strict();
export const bankPackageSchema = z
  .object({
    format: z.literal('zhixu.question-bank'),
    version: z.literal('1.0'),
    bank: z
      .object({
        curriculum: curriculumSchema.optional(),
        title: z.string().trim().min(1).max(200),
        description: z.string().max(3000).default(''),
        chapter: z.string().max(100).default(''),
        minutes: z.number().int().min(1).max(600).default(30),
        accent: z.enum(['mechanics', 'electric', 'buoyancy', 'exam']).default('exam'),
      })
      .strict(),
    questions: z.array(question).min(1).max(200),
    assets: z
      .array(
        z
          .object({
            id,
            mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
            data: z
              .string()
              .min(4)
              .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3)),
            name: z.string().max(255).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type BankPackage = z.infer<typeof bankPackageSchema>;
export interface ImportIssue {
  path: string;
  code: string;
  message: string;
}
export interface ImportSummary {
  title: string;
  questionCount: number;
  totalScore: number;
  imageCount: number;
  types: Partial<Record<QuestionType, number>>;
  manualQuestionCount: number;
}
export interface ImportReport {
  valid: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  digest?: string;
  summary?: ImportSummary;
  existing?: { bankId: string; title: string; state: string };
  preview?: { questions: Question[]; assetSources: Record<string, string> };
}
export const packageQuestion = (
  q: BankPackage['questions'][number],
  bankId = 'preview-bank',
): Question => ({ ...q, bankId, version: 0, state: 'draft' });
const pathText = (path: PropertyKey[]) =>
  '$' + path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('');

function structureTooLarge(value: unknown, maxDepth: number, maxNodes: number) {
  const queue = [{ value, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const { value, depth } = queue.pop()!;
    if (depth > maxDepth || ++count > maxNodes) return true;
    if (value && typeof value === 'object')
      for (const child of Object.values(value)) queue.push({ value: child, depth: depth + 1 });
  }
  return false;
}

export function parseBankPackage(fileText: string): ImportReport & { document?: BankPackage } {
  const errors: ImportIssue[] = [];
  const add = (path: string, code: string, message: string) => {
    if (errors.length < 100) errors.push({ path, code, message });
  };
  if (new TextEncoder().encode(fileText).length > MAX_IMPORT_BYTES)
    return {
      valid: false,
      errors: [{ path: '$', code: 'file_size', message: '题库文件不能超过20 MiB' }],
      warnings: [],
    };
  let raw: unknown;
  try {
    raw = JSON.parse(fileText.replace(/^\uFEFF/, ''));
  } catch (e) {
    return {
      valid: false,
      errors: [{ path: '$', code: 'json', message: `JSON语法错误：${(e as Error).message}` }],
      warnings: [],
    };
  }
  if (structureTooLarge(raw, 24, 100000))
    return {
      valid: false,
      errors: [
        {
          path: '$',
          code: 'structure_limit',
          message: '文件结构超过24层或100000个节点，请减少嵌套或拆分题库',
        },
      ],
      warnings: [],
    };
  const parsed = bankPackageSchema.safeParse(raw, { error: z.locales.zhCN().localeError });
  if (!parsed.success)
    return {
      valid: false,
      errors: parsed.error.issues.slice(0, 100).map((i) => ({
        path: pathText(i.path),
        code: 'schema',
        message:
          i.code === 'unrecognized_keys' ? `存在未定义字段：${i.keys.join('、')}` : i.message,
      })),
      warnings: [],
    };
  const document = parsed.data;
  const warnings: ImportIssue[] = [];
  if (!document.bank.curriculum)
    warnings.push({
      path: '$.bank.curriculum',
      code: 'unclassified',
      message: '文件没有考试分类，导入后标记为待分类；请编辑题库设置实际学段、学科和地区。',
    });
  const unique = (values: string[], path: string) => {
    if (new Set(values).size !== values.length)
      add(path, 'duplicate', 'ID重复；同一作用域内ID必须唯一');
  };
  unique(
    document.questions.map((q) => q.id),
    '$.questions',
  );
  unique(
    document.assets.map((a) => a.id),
    '$.assets',
  );
  const assets = new Set(document.assets.map((a) => a.id));
  const usedAssets = new Set<string>();
  let totalBlocks = 0;
  document.questions.forEach((q, index) => {
    const path = `$.questions[${index}]`,
      blocks = walkBlocks(q.content);
    totalBlocks += blocks.length;
    for (const image of q.solution.referenceImages ?? []) {
      if (!assets.has(image.assetId))
        add(
          path + '.solution.referenceImages',
          'asset_reference',
          `参考答案图片 ${image.assetId} 未在assets声明`,
        );
      else usedAssets.add(image.assetId);
    }
    if (
      structureTooLarge(
        packageQuestion(q),
        24,
        20000 - blocks.filter((b) => b.type === 'image').length * 2,
      )
    ) {
      add(path, 'question_structure', '单题结构超过可编辑的20000个节点限制，请拆分题目或减少表格');
      return;
    }
    if (blocks.length > 1000) add(path + '.content', 'structure_limit', '单题内容块不能超过1000个');
    for (const message of validateQuestion(packageQuestion(q))) add(path, 'question', message);
    const parts = blocks.filter((b) => b.type === 'subquestion');
    if (
      parts.some(
        (p) =>
          p.type === 'subquestion' &&
          p.responseKind !== 'blanks' &&
          q.blanks.some((b) => b.id === p.id),
      )
    )
      add(path + '.content', 'duplicate', '计分小问ID不能与填空ID相同');
    const renderedTexts = [
      ...q.options.map((o) => o.text),
      q.solution.explanation,
      ...blocks.flatMap((b) =>
        b.type === 'paragraph'
          ? [b.text]
          : b.type === 'table'
            ? [...b.headers, ...b.rows.flat()]
            : b.type === 'subquestion'
              ? (b.options ?? []).map((o) => o.text)
              : [],
      ),
    ];
    if (renderedTexts.some((text) => /!\[[^\]]*\]\s*(?:\(|\[)/.test(text)))
      add(
        path + '.content',
        'markdown_image',
        '请用image内容块引用assets图片；Markdown图片语法不会被显示',
      );
    for (const text of renderedTexts)
      for (const math of text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$\n]+)\$/g)) {
        try {
          katex.renderToString(math[1] ?? math[2], {
            throwOnError: true,
            trust: false,
            strict: 'ignore',
            maxExpand: 500,
          });
        } catch {
          add(path + '.content', 'formula', '选项、材料或解析中存在无法渲染的公式');
        }
      }
    const isChoice = q.type === 'single' || q.type === 'multiple';
    if ((isChoice || q.type === 'calculation') && (q.blanks.length || parts.length))
      add(
        path + '.content',
        'type_content',
        '选择和计算题不能包含填空或子题；混合题请使用experiment或reading',
      );
    if (!isChoice && (q.options.length || q.solution.choices.length))
      add(path + '.options', 'type_content', '本题型不使用顶层选项和choices；混合选择请放在子题中');
    if (q.type === 'fill' && parts.length)
      add(path + '.content', 'type_content', '填空题只使用填空；混合小问请使用experiment或reading');
    if (q.multipleScoring && q.type !== 'multiple')
      add(path + '.multipleScoring', 'type_content', 'multipleScoring仅用于顶层多选题');
    if (q.allowedModes && new Set(q.allowedModes).size !== q.allowedModes.length)
      add(path + '.allowedModes', 'duplicate', '作答方式不能重复');
    for (const key of Object.keys(q.solution.blanks))
      if (!q.blanks.some((b) => b.id === key))
        add(path + '.solution.blanks.' + key, 'answer_reference', '答案指向不存在的填空');
    for (const key of Object.keys(q.solution.partChoices ?? {}))
      if (
        !parts.some(
          (b) =>
            b.id === key &&
            b.type === 'subquestion' &&
            ['single', 'multiple'].includes(b.responseKind),
        )
      )
        add(path + '.solution.partChoices.' + key, 'answer_reference', '答案指向不存在的选择小问');
    blocks.forEach((b) => {
      if (b.type === 'image') {
        if (!b.assetId || !assets.has(b.assetId))
          add(
            path + '.content',
            'asset_reference',
            `图片块 ${b.id} 引用的图片 ${b.assetId} 未在assets声明`,
          );
        else usedAssets.add(b.assetId);
      }
      if (b.type === 'subquestion') {
        if (!['single', 'multiple'].includes(b.responseKind) && b.options?.length)
          add(path + '.content', 'type_content', `小问 ${b.id} 不是选择小问，不能设置options`);
        if (
          b.responseKind !== 'blanks' &&
          walkBlocks(b.children).some(
            (c) =>
              (c.type === 'paragraph' && /\{\{/.test(c.text)) ||
              (c.type === 'table' && /\{\{/.test(JSON.stringify(c))),
          )
        )
          add(path + '.content', 'type_content', `小问 ${b.id} 含填空时responseKind必须为blanks`);
      }
    });
  });
  if (totalBlocks > 10000) add('$.questions', 'structure_limit', '全文件内容块不能超过10000个');
  for (const asset of document.assets)
    if (!usedAssets.has(asset.id))
      add('$.assets', 'asset_reference', `图片 ${asset.id} 未被题目使用，请删除多余资源`);
  const types: ImportSummary['types'] = {};
  let manualQuestionCount = 0;
  document.questions.forEach((q, i) => {
    types[q.type] = (types[q.type] ?? 0) + 1;
    if (
      q.type === 'calculation' ||
      q.blanks.some((b) => b.kind === 'manual') ||
      walkBlocks(q.content).some((b) => b.type === 'subquestion' && b.responseKind === 'open')
    ) {
      manualQuestionCount++;
      warnings.push({
        path: `$.questions[${i}]`,
        code: 'manual_grading',
        message: `「${q.title}」含开放作答，需人工评阅`,
      });
    }
  });
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    document,
    summary: {
      title: document.bank.title,
      questionCount: document.questions.length,
      totalScore: document.questions.reduce((s, q) => s + q.score, 0),
      imageCount: document.assets.length,
      types,
      manualQuestionCount,
    },
  };
}
