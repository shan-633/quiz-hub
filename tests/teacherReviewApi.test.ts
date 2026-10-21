import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import type { Attempt, Question } from '../shared/model';
import { emptyAnswer } from '../shared/domain';
const resources: { app: Awaited<ReturnType<typeof createApp>>; store: Store; dir: string }[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-teacher-')),
    app = await createApp({ dataDir: dir }),
    store = new Store(dir);
  resources.push({ app, store, dir });
  async function login(username: string) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username,
        password:
          username === 'teacher'
            ? 'Teacher123!'
            : username === 'admin'
              ? 'Admin123!'
              : 'Student123!',
      },
    });
    expect(r.statusCode).toBe(200);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  }
  return { app, store, login };
}
it('交卷进入教师箱，学生无答案/成绩；教师逐题批改、冲突保护、全部完成后发布', async () => {
  const { app, store, login } = await setup(),
    student = await login('student'),
    teacher = await login('teacher');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: student,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json() as Attempt;
  const base = `/api/teacher/attempts/${a.id}`;
  expect((await app.inject({ url: base, headers: teacher })).statusCode).toBe(404);
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/attempts/${a.id}/submit`,
    headers: student,
  });
  expect(submitted.statusCode).toBe(200);
  expect(submitted.json().review.state).toBe('pending');
  expect(submitted.json().grades).toBeUndefined();
  expect(JSON.stringify(submitted.json())).not.toContain('solution');
  expect((await app.inject({ url: '/api/teacher/attempts', headers: student })).statusCode).toBe(
    403,
  );
  const inbox = (await app.inject({ url: '/api/teacher/attempts', headers: teacher })).json();
  expect(inbox[0]).toMatchObject({ id: a.id, student: { name: '同学' }, kind: 'bank' });
  let draft = (await app.inject({ url: base, headers: teacher })).json() as Attempt;
  expect(draft.grades!['q-force'].source).toBe('auto');
  expect(
    draft.questions
      .filter((q) => q.type !== 'single' && q.type !== 'multiple')
      .every((q) => draft.grades![q.id].pending),
  ).toBe(true);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: base + '/publish',
        headers: teacher,
        payload: { expectedRevision: draft.review!.revision },
      })
    ).statusCode,
  ).toBe(422);
  const savedVersion = draft.review!.revision;
  const q = draft.questions[0];
  const payload = {
    expectedRevision: savedVersion,
    verdict: 'correct',
    score: q.score,
    correctAnswer: '教师补充的正确答案',
    comment: '过程清晰，继续保持。',
  };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: base + `/grades/${q.id}`,
        headers: { cookie: teacher.cookie },
        payload,
      })
    ).statusCode,
  ).toBe(403);
  draft = (
    await app.inject({ method: 'PUT', url: base + `/grades/${q.id}`, headers: teacher, payload })
  ).json();
  expect(draft.teacherFeedback![q.id].comment).toContain('过程清晰');
  expect(
    (await app.inject({ method: 'PUT', url: base + `/grades/${q.id}`, headers: teacher, payload }))
      .statusCode,
  ).toBe(409);
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: base + `/grades/${q.id}`,
        headers: teacher,
        payload: { ...payload, expectedRevision: draft.review!.revision, score: q.score + 1 },
      })
    ).statusCode,
  ).toBe(422);
  for (const [i, question] of draft.questions.entries()) {
    const r = await app.inject({
      method: 'PUT',
      url: base + `/grades/${question.id}`,
      headers: teacher,
      payload: {
        expectedRevision: draft.review!.revision,
        verdict: i === 0 ? 'correct' : i === 1 ? 'partial' : 'incorrect',
        score: i === 0 ? question.score : i === 1 ? question.score / 2 : 0,
        correctAnswer: `第${i + 1}题正确答案`,
        comment: '逐题评语',
      },
    });
    expect(r.statusCode).toBe(200);
    draft = r.json();
  }
  const hidden = (await app.inject({ url: `/api/attempts/${a.id}`, headers: student })).json();
  expect(hidden.teacherFeedback).toBeUndefined();
  expect(hidden.grades).toBeUndefined();
  const history = (await app.inject({ url: '/api/attempts', headers: student })).json()[0];
  expect(history.earned).toBeUndefined();
  expect(history.reviewState).toBe('in_progress');
  const r = await app.inject({
    method: 'POST',
    url: base + '/publish',
    headers: teacher,
    payload: { expectedRevision: draft.review!.revision },
  });
  expect(r.statusCode).toBe(200);
  const published = r.json();
  const visible = (await app.inject({ url: `/api/attempts/${a.id}`, headers: student })).json();
  expect(visible.teacherFeedback[q.id].correctAnswer).toBe('第1题正确答案');
  expect(visible.grades[q.id].earned).toBe(q.score);
  expect(
    (
      await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: student })
    ).json(),
  ).toEqual(visible);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: base + '/publish',
        headers: teacher,
        payload: { expectedRevision: published.review.revision },
      })
    ).json(),
  ).toEqual(published);
  expect(store.get<Attempt>('attempts', a.id)!.questions).toEqual(draft.questions);
  expect((await app.inject({ url: '/api/admin/banks', headers: teacher })).statusCode).toBe(200);
});
it('六种题型都支持手工写答案与评语；标准答案缺失时全卷不自动评卷', async () => {
  const { app, store, login } = await setup(),
    teacher = await login('teacher');
  const seed = store.list<Attempt>('attempts');
  expect(seed).toEqual([]);
  const questions = store
    .versions()
    .filter((q, i, all) => all.findIndex((x) => x.type === q.type) === i);
  expect(questions).toHaveLength(6);
  questions[0].solution = undefined;
  const a: Attempt = {
    id: 'all-types',
    userId: 'user-student',
    libraryId: 'paper',
    title: '六题型测试',
    status: 'active',
    createdAt: 'now',
    updatedAt: 'now',
    answers: {},
    questions,
  };
  store.put('attempts', a.id, a, a.userId);
  const student = await login('student');
  await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: student });
  let draft = (
    await app.inject({ url: `/api/teacher/attempts/${a.id}`, headers: teacher })
  ).json() as Attempt;
  expect(draft.review!.autoEligible).toBe(false);
  expect(draft.review!.autoCount).toBe(0);
  for (const q of draft.questions) {
    const r = await app.inject({
      method: 'PUT',
      url: `/api/teacher/attempts/${a.id}/grades/${q.id}`,
      headers: teacher,
      payload: {
        expectedRevision: draft.review!.revision,
        verdict: 'incorrect',
        score: 0,
        correctAnswer: '人工标准答案',
        comment: q.type + '评语',
      },
    });
    expect(r.statusCode).toBe(200);
    draft = r.json();
    expect(draft.grades![q.id].pending).toBe(false);
  }
  expect(Object.keys(draft.teacherFeedback!)).toHaveLength(6);
});
it('旧记录只在主动复核时进入新流程，使用历史快照而不是当前题库', async () => {
  const { app, store, login } = await setup(),
    teacher = await login('teacher'),
    student = await login('student');
  const q = store.versions().find((q) => q.type === 'single')!;
  const a: Attempt = {
    id: 'legacy',
    userId: 'user-student',
    libraryId: q.bankId,
    title: '旧记录',
    status: 'submitted',
    createdAt: 'now',
    updatedAt: 'now',
    answers: {},
    questions: [q],
    grades: {
      [q.id]: { earned: q.score, max: q.score, pending: false, status: 'correct', details: {} },
    },
  };
  store.put('attempts', a.id, a, a.userId);
  const base = '/api/teacher/attempts/legacy';
  expect((await app.inject({ url: base, headers: teacher })).json().review).toBeUndefined();
  expect(
    (await app.inject({ url: '/api/attempts/legacy', headers: student })).json().grades[q.id]
      .earned,
  ).toBe(q.score);
  const r = await app.inject({
    method: 'POST',
    url: base + '/start',
    headers: teacher,
    payload: { expectedRevision: 0 },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().review.autoEligible).toBe(true);
  expect(r.json().questions).toEqual(a.questions);
  expect(
    (await app.inject({ url: '/api/attempts/legacy', headers: student })).json().grades,
  ).toBeUndefined();
});
