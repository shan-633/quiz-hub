import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import type { LibraryItem, Question } from '../shared/model';
const resources: { app: Awaited<ReturnType<typeof createApp>>; store: Store; dir: string }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-pdf-api-')),
    render = vi.fn(async (_html: string) => ({ bytes: Buffer.from('%PDF-1.7\nmock'), pages: 3 })),
    app = await createApp({ dataDir: dir, pdfRenderer: { render, close: async () => {} } }),
    store = new Store(dir);
  resources.push({ app, store, dir });
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'student', password: 'Student123!' },
  });
  return {
    app,
    store,
    render,
    headers: {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    },
  };
}
it('学生可导出已发布题库为PDF，文件名/页数正确且不创建作答、不泄露答案', async () => {
  const { app, store, render, headers } = await setup();
  const before = store.list('attempts');
  const r = await app.inject({
    method: 'POST',
    url: '/api/library/bank-mechanics/pdf',
    headers,
    payload: {},
  });
  expect(r.statusCode).toBe(200);
  expect(r.headers['content-type']).toContain('application/pdf');
  expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
  expect(decodeURIComponent(r.headers['content-disposition'] as string)).toContain(
    '力与运动_阅读版_A4.pdf',
  );
  expect(r.headers['x-pdf-page-count']).toBe('3');
  expect(r.headers['cache-control']).toContain('no-store');
  expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  const html = render.mock.calls[0][0];
  expect(html).not.toContain('font-large');
  expect(html).not.toContain('answer-space');
  expect(html).not.toContain('solution');
  expect(html).not.toContain('力改变物体');
  expect(store.list('attempts')).toEqual(before);
});
it('试卷保持发布版本、顺序和自定义分值；当前草稿及教师标准答案不进入PDF', async () => {
  const { app, store, render, headers } = await setup();
  const first = store.version('q-force', 1)!,
    next: Question = {
      ...first,
      version: 2,
      content: [{ id: 'new', type: 'paragraph', text: '新版本不应出现' }],
      solution: { choices: ['a'], blanks: {}, explanation: '秘密解析绝不能打印' },
    };
  store.publish(next);
  const paper: LibraryItem = {
    id: 'print-paper',
    kind: 'paper',
    title: '顺序/版本测试',
    description: '',
    chapter: '综合',
    accent: 'exam',
    state: 'published',
    questionCount: 2,
    totalScore: 6,
    minutes: 20,
    items: [
      { questionId: 'q-multiple', version: 1, score: 1.5 },
      { questionId: 'q-force', version: 1, score: 4.5 },
    ],
  };
  store.put('library', paper.id, paper);
  const r = await app.inject({
    method: 'POST',
    url: `/api/library/${paper.id}/pdf`,
    headers,
    payload: {},
  });
  expect(r.statusCode).toBe(200);
  const html = render.mock.calls[0][0];
  expect(html.indexOf('data-question-id="q-multiple"')).toBeLessThan(
    html.indexOf('data-question-id="q-force"'),
  );
  expect(html).toContain('4.5 分');
  expect(html).toContain('1.5 分');
  expect(html).not.toContain('新版本不应出现');
  expect(html).not.toContain('秘密解析');
});
it('匿名/缺CSRF、草稿与空题库、答案开关均不能生成PDF', async () => {
  const { app, store, render, headers } = await setup();
  const url = '/api/library/bank-mechanics/pdf';
  expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
  expect(
    (await app.inject({ method: 'POST', url, headers: { cookie: headers.cookie }, payload: {} }))
      .statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ method: 'POST', url, headers, payload: { includeAnswers: true } }))
      .statusCode,
  ).toBe(422);
  for (const payload of [
    { mode: 'writing' },
    { fontSize: 'large' },
    { mode: 'reading', fontSize: 'standard' },
  ]) {
    expect((await app.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(422);
  }
  const bank = store.get<LibraryItem>('library', 'bank-mechanics')!;
  store.put('library', bank.id, { ...bank, state: 'draft' });
  expect((await app.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(404);
  store.put('library', 'empty', { ...bank, id: 'empty', state: 'published' });
  expect(
    (await app.inject({ method: 'POST', url: '/api/library/empty/pdf', headers, payload: {} }))
      .statusCode,
  ).toBe(422);
  expect(render).not.toHaveBeenCalled();
});
