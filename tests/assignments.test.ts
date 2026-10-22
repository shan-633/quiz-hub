import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

it('教师只能将自己的学生分组；分组修改有版本保护且不能跨教师读取', async () => {
  const f = await community();
  fixtures.push(f);
  const teacher = await f.login('teacher'),
    other = await f.login('t2');
  const students = await f.app.inject({ url: '/api/teacher/students', headers: teacher });
  expect(students.statusCode).toBe(200);
  expect(students.json().map((s: any) => s.id)).toContain('user-student');
  const create = (studentIds: string[]) =>
    f.app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: teacher,
      payload: { name: '九年级一班', studentIds },
    });
  expect((await create(['s3'])).statusCode).toBe(422);
  const r = await create(['user-student']);
  expect(r.statusCode).toBe(201);
  const group = r.json();
  expect(group.studentIds).toEqual(['user-student']);
  expect((await f.app.inject({ url: '/api/teacher/groups', headers: other })).json()).toEqual([]);
  expect(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/teacher/groups/${group.id}`,
        headers: other,
        payload: { name: '盗改', studentIds: [], expectedRevision: group.revision },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/teacher/groups/${group.id}`,
        headers: teacher,
        payload: { name: '新班名', studentIds: [], expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(409);
});

it('推送按班级收件去重并冻结题目；学生只见自己的任务且重复开始不重置计时', async () => {
  const f = await community();
  fixtures.push(f);
  const t = await f.login('teacher'),
    t2 = await f.login('t2'),
    s = await f.login('student'),
    stranger = await f.login('s3');
  const groups: any[] = [];
  for (const name of ['一班', '提高组']) {
    const r = await f.app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name, studentIds: ['user-student'] },
    });
    expect(r.statusCode).toBe(201);
    groups.push(r.json());
  }
  const payload = {
    libraryId: 'bank-mechanics',
    groupIds: groups.map((g) => g.id),
    timeLimitMinutes: 20,
    enforceTimeLimit: true,
    deadlineAt: new Date(Date.now() + 3600000).toISOString(),
  };
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/teacher/assignments', headers: t2, payload }))
      .statusCode,
  ).toBe(404);
  const pushed = await f.app.inject({
    method: 'POST',
    url: '/api/teacher/assignments',
    headers: t,
    payload,
  });
  expect(pushed.statusCode).toBe(201);
  const assignment = pushed.json();
  expect(assignment.recipientCount).toBe(1);
  expect((await f.app.inject({ url: '/api/tasks', headers: stranger })).json()).toEqual([]);
  const list = await f.app.inject({ url: '/api/tasks', headers: s });
  expect(list.json()[0].id).toBe(assignment.id);
  expect(list.body).not.toContain('solution');
  const original = f.store.get<any>('library', 'bank-mechanics');
  f.store.put('library', original.id, { ...original, title: '后来改的标题' }, 'user-teacher');
  const start = () =>
    f.app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics', assignmentId: assignment.id, fresh: true },
    });
  const a = (await start()).json(),
    again = (await start()).json();
  expect(a.id).toBeTruthy();
  expect(a.title).toBe(original.title);
  expect(a.questions.length).toBeGreaterThan(0);
  expect(a.timeLimitMinutes).toBe(20);
  expect(a.enforceTimeLimit).toBe(true);
  expect(a.dueAt).toBeTruthy();
  expect(again.id).toBe(a.id);
  expect(again.dueAt).toBe(a.dueAt);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: stranger,
        payload: { libraryId: original.id, assignmentId: assignment.id },
      })
    ).statusCode,
  ).toBe(404);
  const detail = (
    await f.app.inject({ url: `/api/teacher/assignments/${assignment.id}`, headers: t })
  ).json();
  expect(detail.students).toHaveLength(1);
  expect(detail.students[0].status).toBe('active');
});

it('截止时间比答题时限更早时优先截止；未开始的强制任务过期后不能进入', async () => {
  const f = await community();
  fixtures.push(f);
  const teacher = await f.login('teacher'),
    student = await f.login('student');
  const group = (
    await f.app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: teacher,
      payload: { name: '限时班', studentIds: ['user-student', 'user-student2'] },
    })
  ).json();
  const deadlineAt = new Date(Date.now() + 300000).toISOString();
  const task = (
    await f.app.inject({
      method: 'POST',
      url: '/api/teacher/assignments',
      headers: teacher,
      payload: {
        libraryId: 'bank-mechanics',
        groupIds: [group.id],
        deadlineAt,
        timeLimitMinutes: 30,
        enforceTimeLimit: true,
      },
    })
  ).json();
  const started = (
    await f.app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: student,
      payload: { libraryId: 'bank-mechanics', assignmentId: task.id },
    })
  ).json();
  expect(started.dueAt).toBe(deadlineAt);
  const snapshot = f.store.get<any>('assignments', task.id);
  f.store.put(
    'assignments',
    task.id,
    { ...snapshot, deadlineAt: new Date(Date.now() - 1000).toISOString() },
    'user-teacher',
  );
  const second = await f.login('student2');
  expect((await f.app.inject({ url: '/api/tasks', headers: second })).json()[0].status).toBe(
    'expired',
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: second,
        payload: { libraryId: 'bank-mechanics', assignmentId: task.id },
      })
    ).statusCode,
  ).toBe(409);
  await f.app.inject({
    method: 'PUT',
    url: `/api/teacher/groups/${group.id}`,
    headers: teacher,
    payload: { name: '限时班', studentIds: [], expectedRevision: 1 },
  });
  expect(
    (await f.app.inject({ url: `/api/teacher/assignments/${task.id}`, headers: teacher })).json()
      .students,
  ).toHaveLength(2);
});
