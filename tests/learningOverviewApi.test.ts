import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
import type { Attempt, Grade, Question } from '../shared/model';

const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

it('首页成绩使用作答快照分值，只汇总本人已公布且全部批完的题目，保留零分', async () => {
  const f = await community({ assigned: false });
  fixtures.push(f);
  const headers = await f.login('student');
  const source = f.store.get<{ draft: Question }>('questions', 'q-force')!.draft;
  const questions = [
    { ...source, id: 'one', score: 3 },
    { ...source, id: 'two', score: 7 },
  ];
  const grade = (earned: number, max: number, status: Grade['status']): Grade => ({
    earned,
    max,
    status,
    pending: false,
    details: {},
  });
  const put = (id: string, patch: Partial<Attempt> = {}) => {
    const a: Attempt = {
      id,
      userId: 'user-student',
      teacherId: 'user-teacher',
      libraryId: 'bank-mechanics',
      title: id,
      status: 'submitted',
      createdAt: '2026-10-01T01:00:00Z',
      updatedAt: '2026-10-22T02:00:00Z',
      submittedAt: '2026-10-20T03:00:00Z',
      questions,
      answers: {},
      grades: { one: grade(3, 3, 'correct'), two: grade(2, 7, 'partial') },
      review: {
        state: 'published',
        revision: 1,
        autoEligible: false,
        autoCount: 0,
        autoReason: '',
        receivedAt: '2026-10-20T03:00:00Z',
      },
      ...patch,
    };
    f.store.put('attempts', id, a, a.userId);
  };
  put('graded');
  put('zero', { grades: { one: grade(0, 3, 'incorrect'), two: grade(0, 7, 'unanswered') } });
  put('waiting', {
    review: {
      state: 'in_progress',
      revision: 1,
      autoEligible: true,
      autoCount: 1,
      autoReason: '',
      receivedAt: '2026-10-20T03:00:00Z',
    },
  });
  put('self-waiting', {
    gradingMode: 'self',
    selfReview: { state: 'in_progress', revision: 0, feedback: {} },
  });
  put('active', { status: 'active', submittedAt: undefined });
  put('someone-else', { userId: 'user-student2' });
  const r = await f.app.inject({ url: '/api/attempts', headers });
  expect(r.statusCode).toBe(200);
  const rows = r.json();
  expect(rows.find((a: any) => a.id === 'graded')).toMatchObject({
    totalScore: 10,
    submittedAt: '2026-10-20T03:00:00Z',
    performance: { correct: 1, partial: 1, total: 2, earned: 5, max: 10 },
  });
  expect(rows.find((a: any) => a.id === 'zero').performance).toEqual({
    correct: 0,
    partial: 0,
    total: 2,
    earned: 0,
    max: 10,
  });
  for (const id of ['waiting', 'self-waiting', 'active'])
    expect(rows.find((a: any) => a.id === id).performance).toBeUndefined();
  expect(rows.some((a: any) => a.id === 'someone-else')).toBe(false);
  expect(r.body).not.toContain('solution');
  expect(r.body).not.toContain('answers');
});

it('首页教师消息摘要保留最近收到的内容，学生后续回复不覆盖，不自动标为已读', async () => {
  const f = await community({ assigned: false });
  fixtures.push(f);
  const student = await f.login('student'),
    teacher = await f.login('teacher');
  const c = (
    await f.app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: student,
      payload: { peerId: 'user-teacher' },
    })
  ).json();
  const send = (headers: any, body: string, clientMessageId: string) =>
    f.app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${c.id}/messages`,
      headers,
      payload: { body, clientMessageId },
    });
  await send(student, '老师好', 's1');
  expect(
    (await f.app.inject({ url: '/api/chat/conversations', headers: student })).json()[0]
      .latestReceived,
  ).toBeUndefined();
  const reply = (await send(teacher, '明天前完成电学练习', 't1')).json();
  await send(student, '收到，我会完成', 's2');
  const rows = (await f.app.inject({ url: '/api/chat/conversations', headers: student })).json();
  expect(rows[0].lastMessage).toBe('收到，我会完成');
  expect(rows[0].latestReceived).toEqual({
    body: '明天前完成电学练习',
    createdAt: reply.createdAt,
  });
  expect(rows[0].unread).toBe(1);
  const other = await f.login('student2');
  expect((await f.app.inject({ url: '/api/chat/conversations', headers: other })).json()).toEqual(
    [],
  );
});
