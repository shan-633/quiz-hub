import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { emptyAnswer } from '../shared/domain';
import type { Attempt } from '../shared/model';

const resources: { app: Awaited<ReturnType<typeof createApp>>; store: Store; dir: string }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-progress-'));
  const app = await createApp({ dataDir: dir }),
    store = new Store(dir);
  resources.push({ app, store, dir });
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username,
        password: username === 'teacher' ? 'Teacher123!' : 'Student123!',
      },
    });
    expect(r.statusCode).toBe(200);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  return { app, store, dir, login };
}

it('教师读取未交卷进度，保存与清空同步变化，交卷后移入收卷箱且不泄露草稿答案', async () => {
  const { app, login, dir } = await setup();
  const student = await login('student'),
    teacher = await login('teacher');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: student,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json() as Attempt;
  const progress = async () => {
    const r = await app.inject({ url: '/api/teacher/progress', headers: teacher });
    expect(r.statusCode).toBe(200);
    return r.json();
  };
  expect((await progress())[0]).toMatchObject({
    id: a.id,
    student: { name: '同学' },
    kind: 'bank',
    answeredCount: 0,
    inProgressCount: 0,
    percent: 0,
    questionCount: a.questions.length,
  });
  expect((await app.inject({ url: '/api/teacher/progress', headers: student })).statusCode).toBe(
    403,
  );
  expect((await app.inject({ url: '/api/teacher/progress' })).statusCode).toBe(401);
  const q = a.questions.find((q) => q.type === 'single')!;
  const save = async (data: ReturnType<typeof emptyAnswer>, revision: number) => {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/attempts/${a.id}/answers/${q.id}`,
      headers: student,
      payload: { data, expectedRevision: revision },
    });
    expect(r.statusCode).toBe(200);
  };
  await save({ ...emptyAnswer(), choiceIds: [q.options[0].id] }, 0);
  const row = (await progress())[0];
  expect(row.answeredCount).toBe(1);
  expect(row.updatedAt >= a.updatedAt).toBe(true);
  expect(row.answers).toBeUndefined();
  expect(row.questions).toBeUndefined();
  expect(row.grades).toBeUndefined();
  const reopened = new Store(dir);
  expect(reopened.get<Attempt>('attempts', a.id)!.answers[q.id].revision).toBe(1);
  reopened.close();
  await save({ ...emptyAnswer(), flagged: true }, 1);
  expect((await progress())[0].answeredCount).toBe(0);
  const history = (await app.inject({ url: '/api/attempts', headers: student })).json();
  expect(history[0].answeredCount).toBe(0);
  expect(
    (await app.inject({ url: `/api/teacher/attempts/${a.id}`, headers: teacher })).statusCode,
  ).toBe(404);
  await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: student });
  expect(await progress()).toEqual([]);
  expect((await app.inject({ url: '/api/teacher/attempts', headers: teacher })).json()[0].id).toBe(
    a.id,
  );
});

it('按完整题目计数，多空题部分填写另计；空白画板和仅标记不算作答', async () => {
  const { app, store, login } = await setup();
  const teacher = await login('teacher');
  const base = {
    id: 'q',
    version: 1,
    bankId: 'b',
    title: '测试',
    score: 4,
    difficulty: '中等',
    tags: [],
    content: [],
    options: [],
    blanks: [],
    state: 'published' as const,
  };
  const a: Attempt = {
    id: 'mixed',
    userId: 'student',
    libraryId: 'b',
    title: '混合题',
    status: 'active',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    questions: [
      {
        ...base,
        id: 'fill',
        type: 'fill',
        blanks: [
          { id: 'a', label: 'A', score: 2, kind: 'text' },
          { id: 'b', label: 'B', score: 2, kind: 'text' },
        ],
      },
      { ...base, id: 'calc', type: 'calculation' },
      { ...base, id: 'photo', type: 'calculation' },
      {
        ...base,
        id: 'reading',
        type: 'reading',
        content: [
          {
            id: 'part',
            type: 'subquestion',
            label: '1',
            score: 4,
            responseKind: 'open',
            children: [],
          },
        ],
      },
    ],
    answers: {
      fill: {
        data: { ...emptyAnswer(), blankValues: { a: '10', b: ' ' } },
        revision: 1,
        updatedAt: 'now',
      },
      calc: {
        data: {
          ...emptyAnswer(),
          drawingPages: [{ id: 'p', width: 100, height: 100, strokes: [] }],
        },
        revision: 1,
        updatedAt: 'now',
      },
      photo: {
        data: {
          ...emptyAnswer(),
          imagePages: [{ id: 'img', assetId: 'asset', name: '答案', rotation: 0 }],
        },
        revision: 1,
        updatedAt: 'now',
      },
      reading: {
        data: { ...emptyAnswer(), parts: { part: { ...emptyAnswer(), markdown: '推导过程' } } },
        revision: 1,
        updatedAt: 'now',
      },
    },
  };
  store.put('attempts', a.id, a, a.userId);
  const r = await app.inject({ url: '/api/teacher/progress', headers: teacher });
  expect(r.statusCode).toBe(200);
  expect(r.json()[0]).toMatchObject({
    questionCount: 4,
    answeredCount: 2,
    inProgressCount: 1,
    emptyCount: 1,
    percent: 50,
  });
});
