import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
let app: any, dir: string;
afterEach(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zhixu-sec-'));
  app = await createApp({ dataDir: dir });
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: 'Admin123!' },
  });
  return {
    cookie: r.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': r.json().csrfToken,
  };
}
it('试卷不能重复引用同一题，否则作答 ID 会冲突', async () => {
  const headers = await setup();
  const result = await app.inject({
    method: 'POST',
    url: '/api/admin/papers',
    headers,
    payload: {
      title: '重复试卷',
      description: '',
      chapter: '八年级',
      state: 'published',
      minutes: 30,
      items: [
        { questionId: 'q-force', version: 1, score: 3 },
        { questionId: 'q-force', version: 1, score: 3 },
      ],
    },
  });
  expect(result.statusCode).toBe(422);
});
it('不能发布不存在的题干图片', async () => {
  const headers = await setup();
  const q = (await app.inject({ url: '/api/admin/questions/q-force', headers })).json();
  q.content.push({
    id: 'missing',
    type: 'image',
    assetId: 'missing-asset',
    alt: '不存在的图片',
    caption: '',
    width: 100,
  });
  await app.inject({ method: 'PUT', url: '/api/admin/questions/q-force', headers, payload: q });
  const result = await app.inject({
    method: 'POST',
    url: '/api/admin/questions/q-force/publish',
    headers,
  });
  expect(result.statusCode).toBe(422);
});
it('学生不能读取其他用户的练习，即使知道 ID', async () => {
  await setup();
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: 'Student123!' },
    });
    return {
      cookie: r.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  const one = await login('student'),
    two = await login('student2');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: one,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  expect((await app.inject({ url: `/api/attempts/${a.id}`, headers: two })).statusCode).toBe(404);
});
