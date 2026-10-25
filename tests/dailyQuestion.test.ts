import { afterEach, expect, it, vi } from 'vitest';
import { community } from './fixtures/community';
import { beijingDate } from '../shared/dailyQuestion';
import { emptyAnswer, newQuestion } from '../shared/domain';
import type { Attempt, LibraryItem } from '../shared/model';

const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.close();
});
async function fixture(type: 'single' | 'multiple' = 'single') {
  const f = await community({ assigned: false });
  fixtures.push(f);
  const base = f.store.get<LibraryItem>('library', 'bank-mechanics')!;
  // All existing banks are assigned; only this explicitly published showcase is eligible.
  for (const b of f.store.list<LibraryItem>('library'))
    f.store.put('library', b.id, { ...b, deliveryMode: 'assigned' }, b.teacherId);
  const bank = {
    ...base,
    id: 'daily-bank',
    kind: 'bank' as const,
    deliveryMode: 'showcase' as const,
    state: 'published' as const,
  };
  f.store.put('library', bank.id, bank, bank.teacherId);
  const q = {
    ...newQuestion(type, bank.id),
    id: 'daily-choice',
    title: '每日选择题',
    version: 1,
    state: 'published' as const,
    multipleScoring: 'half' as const,
    solution: {
      choices: type === 'single' ? ['a'] : ['a', 'b'],
      blanks: {},
      explanation: '标准解析',
    },
  };
  f.store.publish(q);
  f.store.put(
    'questions',
    q.id,
    { id: q.id, bankId: bank.id, latestVersion: 1, archived: false, draft: q },
    bank.teacherId,
  );
  return { ...f, q, bank };
}
it('北京时间在16:00 UTC切日，月份与日历日期稳定', () => {
  expect(beijingDate(Date.parse('2026-10-31T15:59:59Z'))).toBe('2026-10-31');
  expect(beijingDate(Date.parse('2026-10-31T16:00:00Z'))).toBe('2026-11-01');
});
it('每天固定一题并冻结版本，首次交卷自动评分，重复提交与跨月历史不改变成绩', async () => {
  let now = Date.parse('2026-10-25T02:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const f = await fixture();
  const s = await f.login('student');
  const start = () =>
    f.app.inject({ method: 'POST', url: '/api/daily-question/start', headers: s });
  const first = await start();
  expect(first.statusCode).toBe(201);
  const id = first.json().attemptId;
  expect((await start()).json().attemptId).toBe(id);
  const a = (await f.app.inject({ url: `/api/attempts/${id}`, headers: s })).json();
  expect(a.questions).toHaveLength(1);
  expect(a.questions[0].solution).toBeUndefined();
  expect(a.dailyDate).toBe('2026-10-25');
  const overview = () => f.app.inject({ url: '/api/daily-question?month=2026-10', headers: s });
  expect((await overview()).json().todayEntry.result).toBeNull();
  expect(
    (await f.app.inject({ method: 'POST', url: `/api/attempts/${id}/submit`, headers: s }))
      .statusCode,
  ).toBe(422);
  const normal = (
    await f.app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: f.bank.id },
    })
  ).json();
  expect(normal.id).not.toBe(id);
  expect(normal.dailyDate).toBeUndefined();
  // Editing the bank afterwards cannot change the frozen daily answer.
  f.store.publish({ ...f.q, version: 2, solution: { ...f.q.solution, choices: ['b'] } });
  f.store.put('questions', f.q.id, {
    id: f.q.id,
    bankId: f.bank.id,
    latestVersion: 2,
    archived: false,
    draft: f.q,
  });
  expect(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/attempts/${id}/answers/${f.q.id}`,
        headers: s,
        payload: { data: { ...emptyAnswer(), choiceIds: ['a'] }, expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(200);
  const graded = await f.app.inject({
    method: 'POST',
    url: `/api/attempts/${id}/submit`,
    headers: s,
  });
  expect(graded.json().grades[f.q.id].status).toBe('correct');
  expect(graded.json().review.state).toBe('published');
  expect((await overview()).json().todayEntry.result).toBe('correct');
  expect((await start()).json().attemptId).toBe(id);
  expect(
    (await f.app.inject({ method: 'POST', url: `/api/attempts/${id}/submit`, headers: s })).json()
      .grades,
  ).toEqual(graded.json().grades);
  now = Date.parse('2026-11-01T01:00:00Z');
  const next = (await start()).json().attemptId;
  expect(next).not.toBe(id);
  const history = (await overview()).json();
  expect(history.entries[0].result).toBe('correct');
  expect(history.todayEntry.date).toBe('2026-11-01');
  expect(
    (await f.app.inject({ url: '/api/daily-question?month=2026-13', headers: s })).statusCode,
  ).toBe(422);
});
it('多选部分得分标红；其他学生、未推送和未开放题库不能进入题池', async () => {
  const f = await fixture('multiple');
  const s = await f.login('student'),
    stranger = await f.login('s3');
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/daily-question/start', headers: stranger }))
      .statusCode,
  ).toBe(422);
  f.store.put(
    'library',
    f.bank.id,
    { ...f.bank, opensAt: '2099-01-01T00:00:00Z' },
    f.bank.teacherId,
  );
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/daily-question/start', headers: s }))
      .statusCode,
  ).toBe(422);
  f.store.put('library', f.bank.id, { ...f.bank, deliveryMode: 'assigned' }, f.bank.teacherId);
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/daily-question/start', headers: s }))
      .statusCode,
  ).toBe(422);
  f.store.put('library', f.bank.id, f.bank, f.bank.teacherId);
  const id = (
    await f.app.inject({ method: 'POST', url: '/api/daily-question/start', headers: s })
  ).json().attemptId;
  expect((await f.app.inject({ url: `/api/attempts/${id}`, headers: stranger })).statusCode).toBe(
    404,
  );
  expect(
    (await f.app.inject({ url: '/api/daily-question', headers: stranger })).json().entries,
  ).toHaveLength(0);
  await f.app.inject({
    method: 'PUT',
    url: `/api/attempts/${id}/answers/${f.q.id}`,
    headers: s,
    payload: { data: { ...emptyAnswer(), choiceIds: ['a'] }, expectedRevision: 0 },
  });
  const grade = (
    await f.app.inject({ method: 'POST', url: `/api/attempts/${id}/submit`, headers: s })
  ).json().grades[f.q.id];
  expect(grade.earned).toBeGreaterThan(0);
  expect(grade.status).toBe('partial');
  expect(
    (await f.app.inject({ url: '/api/daily-question', headers: s })).json().todayEntry.result,
  ).toBe('incorrect');
  expect((await f.app.inject({ url: '/api/daily-question' })).statusCode).toBe(401);
  expect(
    (await f.app.inject({ url: '/api/daily-question', headers: await f.login('teacher') }))
      .statusCode,
  ).toBe(403);
});
