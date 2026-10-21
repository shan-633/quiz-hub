import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import type { LibraryItem, Question } from '../shared/model';
import { newQuestion } from '../shared/domain';
import { createPdfRenderer } from '../server/print/pdf';

const dir = mkdtempSync(join(tmpdir(), 'zhixu-print-sample-')),
  engine = createPdfRenderer();
const app = await createApp({
    dataDir: dir,
    pdfRenderer: {
      render: async (html) => {
        try {
          return await engine.render(html);
        } catch (e) {
          console.error(e);
          throw e;
        }
      },
      close: () => engine.close(),
    },
  }),
  store = new Store(dir);
mkdirSync('output/pdf', { recursive: true });
mkdirSync('tmp/pdfs/print', { recursive: true });
const manifest: { file: string; pages: number; questions: number }[] = [];
try {
  const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'student', password: 'Student123!' },
    }),
    headers = {
      cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': login.json().csrfToken,
    };
  const makePaper = (id: string, title: string, questions: Question[]) => {
    const paper: LibraryItem = {
      id,
      title,
      kind: 'paper',
      state: 'published',
      description: '打印排版验收示例',
      chapter: '综合',
      accent: 'exam',
      questionCount: questions.length,
      totalScore: questions.reduce((n, q) => n + q.score, 0),
      minutes: 70,
      items: questions.map((q) => ({ questionId: q.id, version: q.version, score: q.score })),
    };
    for (const q of questions) if (!store.version(q.id, q.version)) store.publish(q);
    store.put('library', id, paper);
  };
  const six = store.versions().filter((q, i, qs) => qs.findIndex((x) => x.type === q.type) === i);
  makePaper('print-six', '六题型打印示例（非完整试卷）', six);
  const reading: Question = {
    ...newQuestion('reading', 'stress-bank'),
    id: 'print-long-reading',
    version: 1,
    state: 'published',
    title: '长材料与公式',
    score: 5,
    blanks: [{ id: 'value', label: '数值', score: 1, kind: 'number' }],
    content: [
      {
        id: 'long',
        type: 'paragraph',
        text: Array.from(
          { length: 24 },
          (_, i) =>
            `第${i + 1}段材料：通过观察实验现象，保持其他条件不变，比较测量数据，解释速度、质量和力之间的关系。物理模型应与实际实验条件相符，记录证据后再得出结论。`,
        ).join('\n\n'),
      },
      { id: 'formula', type: 'formula', latex: 'v=\\frac{s}{t},\\qquad E_k=\\frac12mv^2' },
      { id: 'value', type: 'paragraph', text: '测得数值为{{value}}。' },
      {
        id: 'open',
        type: 'subquestion',
        label: '开放论证',
        score: 4,
        responseKind: 'open',
        children: [{ id: 'why', type: 'paragraph', text: '请依据材料写出实验方案与理由。' }],
      },
    ],
  };
  const table: Question = {
    ...newQuestion('experiment', 'stress-bank'),
    id: 'print-long-table',
    version: 1,
    state: 'published',
    title: '跨页长表格',
    score: 2,
    blanks: [{ id: 'end', label: '结论', score: 2, kind: 'text' }],
    content: [
      {
        id: 'desc',
        type: 'paragraph',
        text: '下表含100行测量结果，跨页时应重复表头，所有数据均应完整保留。',
      },
      {
        id: 'table',
        type: 'table',
        headers: ['实验次数', '路程 / m', '时间 / s'],
        rows: Array.from({ length: 100 }, (_, i) => [
          String(i + 1),
          String((i + 1) * 2),
          String(i + 1),
        ]),
      },
      { id: 'conclusion', type: 'paragraph', text: '根据第100次实验，得到结论：{{end}}。' },
    ],
  };
  makePaper('print-stress', '长材料、跨页表格与公式 · 排版验收', [reading, table]);
  const specs = [
    ['paper-beijing-2022-real', 'output/pdf/2022北京中考物理_阅读版.pdf'],
    ['print-six', 'tmp/pdfs/print/六题型_阅读版.pdf'],
    ['print-stress', 'tmp/pdfs/print/长题与长表格.pdf'],
  ];
  for (const [id, file] of specs) {
    const r = await app.inject({
      method: 'POST',
      url: `/api/library/${id}/pdf`,
      headers,
      payload: {},
    });
    if (r.statusCode !== 200) throw new Error(`${id}: ${r.statusCode} ${r.body}`);
    writeFileSync(file, r.rawPayload);
    const info = {
      file: resolve(file),
      pages: Number(r.headers['x-pdf-page-count']),
      questions: Number(r.headers['x-pdf-question-count']),
    };
    manifest.push(info);
    console.log(info);
  }
  writeFileSync('tmp/pdfs/print/manifest.json', JSON.stringify(manifest, null, 2));
} finally {
  store.close();
  await app.close();
  if (resolve(dir).startsWith(resolve(tmpdir()) + sep + 'zhixu-print-sample-'))
    rmSync(dir, { recursive: true, force: true });
}
