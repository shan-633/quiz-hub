import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
it('教师只见自己的题库与题目，学生可见多位关联教师但其他学生和匿名不可见', async () => {
  const f = await community();
  fixtures.push(f);
  const { app, login } = f;
  const t = await login('teacher'),
    t2 = await login('t2'),
    s = await login('student'),
    s3 = await login('s3');
  expect((await app.inject({ url: '/api/teacher/banks', headers: t2 })).json()).toEqual([]);
  expect((await app.inject({ url: '/api/teacher/questions', headers: t2 })).json()).toEqual([]);
  expect(
    (await app.inject({ url: '/api/teacher/questions/q-force', headers: t2 })).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/teacher/banks/bank-mechanics',
        headers: t2,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect((await app.inject({ url: '/api/library' })).json()).toEqual([]);
  expect((await app.inject({ url: '/api/library', headers: s3 })).json()).toEqual([]);
  expect((await app.inject({ url: '/api/library', headers: s })).json().length).toBeGreaterThan(0);
  expect((await app.inject({ url: '/api/teacher/questions/q-force', headers: t })).statusCode).toBe(
    200,
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/library/bank-mechanics/pdf',
        headers: s3,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s3,
        payload: { libraryId: 'bank-mechanics' },
      })
    ).statusCode,
  ).toBe(404);
  const bank = (await app.inject({ url: '/api/teacher/banks', headers: t })).json()[0];
  const created = await app.inject({
    method: 'POST',
    url: '/api/teacher/banks',
    headers: t2,
    payload: { ...bank, title: '教师二题库', state: 'draft' },
  });
  expect(created.statusCode).toBe(201);
  expect(created.json().teacherId).toBe('t2');
  const paper = (await app.inject({ url: '/api/teacher/papers', headers: t })).json()[0];
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/teacher/papers',
        headers: t2,
        payload: { ...paper, title: '盗用他人题目' },
      })
    ).statusCode,
  ).toBe(422);
});
it('共同学生的答卷只进入试卷所属教师；关系撤销停止继续作答及教师访问，提交历史保留本人只读', async () => {
  const f = await community();
  fixtures.push(f);
  const { app, store, login } = f;
  const t = await login('teacher'),
    t2 = await login('t2'),
    s = await login('student'),
    admin = await login('administrator');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  expect(a.teacherId).toBe('user-teacher');
  expect((await app.inject({ url: '/api/teacher/progress', headers: t2 })).json()).toEqual([]);
  expect((await app.inject({ url: '/api/teacher/progress', headers: t })).json()[0].id).toBe(a.id);
  await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s });
  expect((await app.inject({ url: '/api/teacher/attempts', headers: t2 })).json()).toEqual([]);
  expect((await app.inject({ url: `/api/teacher/attempts/${a.id}`, headers: t2 })).statusCode).toBe(
    404,
  );
  const b = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics', fresh: true },
    })
  ).json();
  await app.inject({
    method: 'DELETE',
    url: '/api/admin/teachers/user-teacher/students/user-student',
    headers: admin,
  });
  expect((await app.inject({ url: '/api/teacher/progress', headers: t })).json()).toEqual([]);
  expect((await app.inject({ url: `/api/teacher/attempts/${a.id}`, headers: t })).statusCode).toBe(
    404,
  );
  expect((await app.inject({ url: `/api/attempts/${b.id}`, headers: s })).statusCode).toBe(404);
  expect((await app.inject({ url: `/api/attempts/${a.id}`, headers: s })).statusCode).toBe(200);
  expect(store.get<any>('attempts', b.id).status).toBe('active');
});
