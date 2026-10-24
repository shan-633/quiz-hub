import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { legacyCurriculum, curriculumSchema } from '../shared/curriculum';
import { parseBankPackage } from '../shared/bankImport';
const senior = {
  stage: 'senior',
  subject: '数学',
  region: '浙江',
  exam: '高考',
  scheme: '2026 · 自选方案',
};
const university = {
  stage: 'university',
  subject: '英语',
  region: '全国',
  exam: '大学英语四级',
  scheme: '',
};
const fixtures: { app: Awaited<ReturnType<typeof createApp>>; store: Store; dir: string }[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.app.close();
    f.store.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-directions-')),
    app = await createApp({ dataDir: dir }),
    store = new Store(dir);
  fixtures.push({ app, store, dir });
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: username === 'teacher' ? 'Teacher123!' : 'Student123!' },
    });
    expect(r.statusCode).toBe(200);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  return {
    app,
    store,
    t: await login('teacher'),
    s: await login('student'),
    other: await login('student2'),
  };
}
it('同一账号保存多个跨学段方向，不改写用户角色或其他人的偏好，使用修订号防覆盖', async () => {
  const { app, store, s, other } = await setup(),
    before = store.get('users', 'user-student');
  expect((await app.inject({ url: '/api/account/directions' })).statusCode).toBe(401);
  const payload = { expectedRevision: 0, directions: [legacyCurriculum, senior, university] };
  expect(
    (
      await app.inject({ method: 'PUT', url: '/api/account/directions', headers: s, payload })
    ).json().directions,
  ).toHaveLength(3);
  expect(store.get('users', 'user-student')).toEqual(before);
  expect(
    (await app.inject({ url: '/api/account/directions', headers: other })).json().directions,
  ).toEqual([]);
  expect(
    (await app.inject({ method: 'PUT', url: '/api/account/directions', headers: s, payload }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/account/directions',
        headers: s,
        payload: { expectedRevision: 1, directions: [] },
      })
    ).statusCode,
  ).toBe(200);
});
it('方向输入严格校验：无CSRF、重复、空学科、过长方案、篡改角色均拒绝', async () => {
  const { app, s } = await setup();
  for (const directions of [
    [senior, senior],
    [{ ...senior, subject: ' ' }],
    [{ ...senior, scheme: 'x'.repeat(121) }],
    Array(31).fill(senior),
  ])
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/account/directions',
          headers: s,
          payload: { expectedRevision: 0, directions },
        })
      ).statusCode,
    ).toBe(422);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/account/directions',
        headers: { cookie: s.cookie },
        payload: { expectedRevision: 0, directions: [senior] },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/account/directions',
        headers: s,
        payload: { expectedRevision: 0, directions: [senior], role: 'teacher', id: 'user-teacher' },
      })
    ).statusCode,
  ).toBe(422);
  expect(curriculumSchema.parse({ ...senior, subject: ' 数学 ' }).subject).toBe('数学');
});
it('旧题库分类只读兼容且不改写存储；偏好不能打开未推送内容或泄露外教师分类', async () => {
  const { app, store, s, t } = await setup(),
    before = store.get('library', 'bank-mechanics');
  expect(
    (await app.inject({ url: '/api/teacher/banks', headers: t }))
      .json()
      .find((b: any) => b.id === 'bank-mechanics').curriculum,
  ).toEqual(legacyCurriculum);
  expect(store.get('library', 'bank-mechanics')).toEqual(before);
  store.put('library', 'foreign', {
    ...(before as any),
    id: 'foreign',
    teacherId: 'other-teacher',
    curriculum: senior,
  });
  await app.inject({
    method: 'PUT',
    url: '/api/account/directions',
    headers: s,
    payload: { expectedRevision: 0, directions: [senior] },
  });
  expect((await app.inject({ url: '/api/library/bank-mechanics', headers: s })).statusCode).toBe(
    404,
  );
  expect(
    (await app.inject({ url: '/api/account/directions', headers: s })).json().available,
  ).toEqual([]);
  expect(
    (await app.inject({ url: '/api/account/directions', headers: t })).json().available,
  ).not.toContainEqual(senior);
});
it('任务冻结推送时分类，之后改库仍按原分类开始作答，历史摘要保留', async () => {
  const { app, store, s, t } = await setup(),
    bank = store.get<any>('library', 'bank-mechanics');
  let r = await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/' + bank.id,
    headers: t,
    payload: { ...bank, curriculum: senior },
  });
  expect(r.statusCode).toBe(200);
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name: '跨学段组', studentIds: ['user-student'] },
    })
  ).json();
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/assignments',
      headers: t,
      payload: { libraryId: bank.id, groupIds: [group.id] },
    })
  ).json();
  expect(task.curriculum).toEqual(senior);
  await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/' + bank.id,
    headers: t,
    payload: { ...bank, curriculum: university, state: 'archived' },
  });
  expect(
    (await app.inject({ url: '/api/account/directions', headers: s })).json().available,
  ).toContainEqual(senior);
  expect(
    (await app.inject({ url: '/api/account/directions', headers: t })).json().available,
  ).toContainEqual(senior);
  const a = await app.inject({
    method: 'POST',
    url: '/api/attempts',
    headers: s,
    payload: { libraryId: bank.id, assignmentId: task.id },
  });
  expect(a.statusCode).toBe(201);
  expect(a.json().curriculum).toEqual(senior);
  expect((await app.inject({ url: '/api/attempts', headers: s })).json()[0].curriculum).toEqual(
    senior,
  );
  expect((await app.inject({ url: '/api/tasks', headers: s })).json()[0].curriculum).toEqual(
    senior,
  );
});
it('展示练习冻结分类，老师改库不能改变已经开始的作答归属', async () => {
  const { app, store, s, t } = await setup(),
    bank = store.get<any>('library', 'bank-electric');
  // A single fully answered choice question makes a valid showcase without modifying seeded questions.
  const source = store.version('q-force', 1)!;
  store.put('library', 'cross-show', {
    ...bank,
    id: 'cross-show',
    kind: 'paper',
    teacherId: 'user-teacher',
    deliveryMode: 'showcase',
    state: 'published',
    curriculum: senior,
    items: [{ questionId: source.id, version: source.version, score: source.score }],
  });
  const a = await app.inject({
    method: 'POST',
    url: '/api/attempts',
    headers: s,
    payload: { libraryId: 'cross-show' },
  });
  expect(a.statusCode).toBe(201);
  expect(a.json().curriculum).toEqual(senior);
  const old = store.get<any>('library', 'cross-show');
  store.put('library', old.id, { ...old, curriculum: university });
  expect(
    (await app.inject({ url: '/api/attempts/' + a.json().id, headers: s })).json().curriculum,
  ).toEqual(senior);
});
it('导入协议1.0兼容可选分类，未知字段仍拒绝', () => {
  const input = {
    format: 'zhixu.question-bank',
    version: '1.0',
    bank: { title: '数学', curriculum: senior },
    assets: [],
    questions: [
      {
        id: 'q1',
        type: 'single',
        title: '计算',
        score: 2,
        content: [{ id: 'p', type: 'paragraph', text: '1+1等于？' }],
        options: [
          { id: 'a', text: '2' },
          { id: 'b', text: '3' },
        ],
        solution: { choices: ['a'], explanation: '加法' },
      },
    ],
  };
  const parsed = parseBankPackage(JSON.stringify(input));
  expect(parsed.valid).toBe(true);
  expect(parsed.document?.bank.curriculum).toEqual(senior);
  const invalid = parseBankPackage(
    JSON.stringify({ ...input, bank: { ...input.bank, curriculum: { ...senior, unknown: true } } }),
  );
  expect(invalid.valid).toBe(false);
});
it('关闭演示初始化时不向公网登录页提供演示入口', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-production-config-'));
  const app = await createApp({ dataDir: dir, seed: false }),
    store = new Store(dir);
  fixtures.push({ app, store, dir });
  expect((await app.inject({ url: '/api/auth/config' })).json()).toEqual({ demoMode: false });
});
