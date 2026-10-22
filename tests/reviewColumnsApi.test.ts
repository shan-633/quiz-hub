import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
import type { Attempt, Question } from '../shared/model';
import { initialReview } from '../shared/teacherReview';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
const question = (): Question => ({
  id: 'multi',
  version: 1,
  bankId: 'bank-mechanics',
  type: 'fill',
  title: '两个空格',
  score: 5,
  difficulty: '基础',
  tags: [],
  state: 'published',
  options: [],
  blanks: [
    { id: 'x', label: '第1空', score: 2, kind: 'text' },
    { id: 'y', label: '第2空', score: 3, kind: 'text' },
  ],
  content: [{ id: 'stem', type: 'paragraph', text: '填入{{x}}和{{y}}' }],
  solution: {
    choices: [],
    blanks: { x: { accepted: ['甲'] }, y: { accepted: ['乙'] } },
    explanation: '参考解析',
  },
});
async function setup(q = question(), self = false) {
  const f = await community({ assigned: false });
  fixtures.push(f);
  const now = new Date().toISOString();
  const a: Attempt = {
    id: 'column-test',
    userId: 'user-student',
    teacherId: 'user-teacher',
    libraryId: q.bankId,
    title: '分栏批改',
    status: 'submitted',
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    questions: [q],
    answers: {},
    ...initialReview([q], {}),
    ...(self
      ? ({
          gradingMode: 'self',
          selfReview: { state: 'in_progress', revision: 1, feedback: {} },
        } as const)
      : {}),
  };
  if (self) a.review!.state = 'published';
  f.store.put('attempts', a.id, a, a.userId);
  return { ...f, a, teacher: await f.login('teacher'), student: await f.login('student') };
}
const result = (verdict: string, score: number, comment = '') => ({
  verdict,
  score,
  comment,
  correctAnswer: '本栏正确答案',
});
it('兼容旧计算题小问分值与整题不一致，按原比例换算后教师和学生都能完成分栏', async () => {
  const q = {
    ...question(),
    type: 'calculation' as const,
    score: 6,
    blanks: [],
    content: [1, 2].map((n) => ({
      id: `p${n}`,
      type: 'subquestion' as const,
      label: `（${n}）`,
      score: 2,
      responseKind: 'open' as const,
      children: [{ id: `text-${n}`, type: 'paragraph' as const, text: '计算过程' }],
    })),
  };
  for (const self of [false, true]) {
    const f = await setup(q, self);
    const items = Object.fromEntries(
      ['p1', 'p2'].map((id) => [id, { verdict: 'correct', score: 3, comment: '' }]),
    );
    const r = await f.app.inject({
      method: 'PUT',
      url: self
        ? '/api/attempts/column-test/self-review/multi'
        : '/api/teacher/attempts/column-test/grades/multi',
      headers: self ? f.student : f.teacher,
      payload: { expectedRevision: 1, items },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().grades.multi).toMatchObject({
      earned: 6,
      max: 6,
      pending: false,
      status: 'correct',
    });
    expect(r.json().questions[0]).toEqual(q);
  }
});
it('小数栏目自评合计归一化，反馈分数和全对判定与正式成绩一致', async () => {
  const q = question();
  q.score = 0.3;
  q.blanks[0].score = 0.1;
  q.blanks[1].score = 0.2;
  const f = await setup(q, true);
  const r = await f.app.inject({
    method: 'PUT',
    url: '/api/attempts/column-test/self-review/multi',
    headers: f.student,
    payload: {
      expectedRevision: 1,
      items: {
        x: { verdict: 'correct', score: 0.1, comment: '' },
        y: { verdict: 'correct', score: 0.2, comment: '' },
      },
    },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().selfReview.feedback.multi).toMatchObject({ score: 0.3, verdict: 'correct' });
  expect(r.json().grades.multi).toMatchObject({ earned: 0.3, status: 'correct' });
});
it('空格与小问同名时仍独立评价，可调整分值且不能删掉任何原有栏目', async () => {
  const q = question();
  q.type = 'experiment';
  q.blanks = [{ ...q.blanks[0], id: 'same' }];
  q.content = [
    { id: 'stem', type: 'paragraph', text: '{{same}}' },
    {
      id: 'same',
      type: 'subquestion',
      label: '解释小问',
      score: 3,
      responseKind: 'open',
      children: [],
    },
  ];
  q.solution!.blanks = { same: { accepted: ['甲'] } };
  const f = await setup(q);
  const rubric = [
    { id: 'blank:same', label: '第1空', max: 1 },
    { id: 'part:same', label: '解释小问', max: 4 },
  ];
  const items = { 'blank:same': result('correct', 1), 'part:same': result('correct', 4) };
  const r = await f.app.inject({
    method: 'PUT',
    url: '/api/teacher/attempts/column-test/grades/multi',
    headers: f.teacher,
    payload: { expectedRevision: 1, rubric, items },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().grades.multi.earned).toBe(5);
  const dropped = await f.app.inject({
    method: 'PUT',
    url: '/api/teacher/attempts/column-test/grades/multi',
    headers: f.teacher,
    payload: {
      expectedRevision: 2,
      rubric: [rubric[0], { id: 'extra', label: '替代', max: 4 }],
      items: { 'blank:same': items['blank:same'], extra: items['part:same'] },
    },
  });
  expect(dropped.statusCode).toBe(422);
});
it('旧版仅含自动选择小问的自评可显式完成并校准，已完成记录不重新评分', async () => {
  for (const calculation of [false, true]) {
    const q: Question = {
      ...question(),
      type: calculation ? 'calculation' : 'reading',
      score: calculation ? 6 : 4.0005,
      blanks: [],
      content: [1, 2].map((n) => ({
        id: 'p' + n,
        type: 'subquestion',
        label: '选择' + n,
        responseKind: 'single',
        score: 2,
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        children: [],
      })),
      solution: {
        choices: [],
        blanks: {},
        partChoices: { p1: ['a'], p2: ['a'] },
        explanation: '完整参考答案',
      },
    };
    const f = await setup(q, true);
    const response = {
      choiceIds: ['a'],
      blankValues: {},
      markdown: '',
      drawingPages: [],
      imagePages: [],
    };
    f.a.answers[q.id] = {
      revision: 1,
      updatedAt: f.a.updatedAt,
      data: { ...response, parts: { p1: response, p2: response }, flagged: false },
    };
    f.a.grades![q.id] = {
      earned: calculation ? 0 : 4,
      max: q.score,
      pending: calculation,
      status: calculation ? 'pending' : 'partial',
      details: calculation
        ? { whole: { earned: 0, max: 6, pending: true } }
        : { p1: { earned: 2, max: 2, pending: false }, p2: { earned: 2, max: 2, pending: false } },
    };
    f.store.put('attempts', f.a.id, f.a, f.a.userId);
    const r = await f.app.inject({
      method: 'POST',
      url: '/api/attempts/column-test/self-review/complete',
      headers: f.student,
      payload: { expectedRevision: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().grades[q.id]).toMatchObject({
      earned: q.score,
      pending: false,
      status: 'correct',
    });
    expect(r.json().questions).toEqual([q]);
    const old = structuredClone(f.a);
    old.selfReview!.state = 'completed';
    f.store.put('attempts', old.id, old, old.userId);
    const locked = await f.app.inject({
      method: 'POST',
      url: '/api/attempts/column-test/self-review/complete',
      headers: f.student,
      payload: { expectedRevision: 1 },
    });
    expect(locked.statusCode).toBe(200);
    expect(locked.json().grades).toEqual(old.grades);
  }
});

it('多空题必须逐栏全部评完，漏栏/整题分数绕过/多余栏被拒绝且不写入，完整保存后汇总分数', async () => {
  const f = await setup();
  const url = '/api/teacher/attempts/column-test/grades/multi';
  const save = (payload: any) =>
    f.app.inject({
      method: 'PUT',
      url,
      headers: f.teacher,
      payload: { expectedRevision: 1, ...payload },
    });
  expect(
    (await save({ verdict: 'correct', score: 5, correctAnswer: '甲乙', comment: '' })).statusCode,
  ).toBe(422);
  expect((await save({ items: { x: result('correct', 2) } })).statusCode).toBe(422);
  expect(
    (await save({ items: { x: result('correct', 2), y: result('correct', 4) } })).statusCode,
  ).toBe(422);
  expect(
    (
      await save({
        items: { x: result('correct', 2), y: result('correct', 3), extra: result('incorrect', 0) },
      })
    ).statusCode,
  ).toBe(422);
  expect(f.store.get<Attempt>('attempts', f.a.id)).toEqual(f.a);
  const r = await save({
    items: { x: result('incorrect', 0, '注意单位'), y: result('correct', 3, '推理清楚') },
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().grades.multi).toMatchObject({
    earned: 3,
    max: 5,
    pending: false,
    status: 'partial',
    details: { x: { earned: 0, max: 2, pending: false }, y: { earned: 3, max: 3, pending: false } },
  });
  expect(r.json().teacherFeedback.multi.items.x.comment).toBe('注意单位');
  const hidden = await f.app.inject({ url: '/api/attempts/column-test', headers: f.student });
  expect(hidden.json().teacherFeedback).toBeUndefined();
  const published = await f.app.inject({
    method: 'POST',
    url: '/api/teacher/attempts/column-test/publish',
    headers: f.teacher,
    payload: { expectedRevision: 2 },
  });
  expect(published.statusCode).toBe(200);
  const visible = (
    await f.app.inject({ url: '/api/attempts/column-test', headers: f.student })
  ).json();
  expect(visible.teacherFeedback.multi.items.y).toMatchObject({
    verdict: 'correct',
    score: 3,
    comment: '推理清楚',
  });
});

it('计算题的三个结构化小问分别初始待评，不允许漏掉其中一问', async () => {
  const q = {
    ...question(),
    type: 'calculation' as const,
    score: 6,
    blanks: [],
    content: [1, 2, 3].map((n) => ({
      id: `p${n}`,
      type: 'subquestion' as const,
      label: `（${n}）`,
      score: 2,
      responseKind: 'open' as const,
      children: [],
    })),
  };
  const f = await setup(q);
  expect(Object.keys(f.a.grades!.multi.details)).toEqual(['p1', 'p2', 'p3']);
  const save = (items: unknown) =>
    f.app.inject({
      method: 'PUT',
      url: '/api/teacher/attempts/column-test/grades/multi',
      headers: f.teacher,
      payload: { expectedRevision: 1, items },
    });
  expect((await save({ p1: result('correct', 2), p3: result('incorrect', 0) })).statusCode).toBe(
    422,
  );
  const r = await save({
    p1: result('correct', 2),
    p2: result('partial', 1),
    p3: result('incorrect', 0),
  });
  expect(r.statusCode).toBe(200);
  expect(r.json().grades.multi.earned).toBe(3);
});

it('学生自评也不能整题跳过多栏，所有人工栏必评，选择小问自动分不可篡改', async () => {
  const q = question();
  q.score = 7;
  q.content.push({
    id: 'choice',
    type: 'subquestion',
    label: '选择小问',
    score: 2,
    responseKind: 'single',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    children: [],
  });
  q.solution!.partChoices = { choice: ['a'] };
  const f = await setup(q, true);
  const auto = f.a.grades!.multi.details.choice.earned;
  const save = (payload: any) =>
    f.app.inject({
      method: 'PUT',
      url: '/api/attempts/column-test/self-review/multi',
      headers: f.student,
      payload: { expectedRevision: 1, ...payload },
    });
  expect((await save({ verdict: 'correct', score: 5, comment: '' })).statusCode).toBe(422);
  const item = (score: number) => ({ verdict: 'correct', score, comment: '' });
  expect((await save({ items: { x: item(2) } })).statusCode).toBe(422);
  expect((await save({ items: { x: item(2), y: item(3), choice: item(2) } })).statusCode).toBe(422);
  const r = await save({ items: { x: item(2), y: item(3) } });
  expect(r.statusCode).toBe(200);
  expect(r.json().grades.multi.earned).toBe(auto + 5);
  expect(r.json().grades.multi.details.choice.earned).toBe(auto);
  expect(r.json().selfReview.feedback.multi.items.y.score).toBe(3);
});

it('图片整题可由教师明确拆栏，分值合计必须等于本题，不改写题干快照', async () => {
  const q = {
    ...question(),
    type: 'calculation' as const,
    score: 6,
    blanks: [],
    content: [{ id: 'raw', type: 'paragraph' as const, text: '原卷图文含（1）（2）两问' }],
  };
  const f = await setup(q);
  const rubric = [
    { id: 'first', label: '（1）求速度', max: 2 },
    { id: 'second', label: '（2）求功率', max: 4 },
  ];
  const save = (rubric: unknown, items: unknown) =>
    f.app.inject({
      method: 'PUT',
      url: '/api/teacher/attempts/column-test/grades/multi',
      headers: f.teacher,
      payload: { expectedRevision: 1, rubric, items },
    });
  expect(
    (
      await save([{ ...rubric[0], max: 3 }, rubric[1]], {
        first: result('correct', 3),
        second: result('correct', 4),
      })
    ).statusCode,
  ).toBe(422);
  const r = await save(rubric, { first: result('correct', 2), second: result('partial', 2) });
  expect(r.statusCode).toBe(200);
  expect(r.json().questions).toEqual([q]);
  expect(r.json().teacherFeedback.multi.rubric).toEqual(rubric);
  expect(r.json().grades.multi.earned).toBe(4);
});
