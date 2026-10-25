import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
import { Client, sleep } from '../scripts/benchmark/transport';
const fixtures: { f: Awaited<ReturnType<typeof community>>; client: Client }[] = [];
afterEach(async () => {
  for (const { f, client } of fixtures.splice(0)) {
    client.close();
    await f.close();
  }
});
async function setup() {
  const f = await community(),
    address = await f.app.listen({ host: '127.0.0.1', port: 0 }),
    client = new Client(address);
  fixtures.push({ f, client });
  return { ...f, client };
}
async function until(fn: () => boolean) {
  const end = performance.now() + 3000;
  while (!fn() && performance.now() < end) await sleep(10);
  expect(fn()).toBe(true);
}
it('进度SSE按教师过滤，解除关系清空快照，停用账号结束旧连接', async () => {
  const { app, client, login } = await setup();
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
  const one: any[] = [],
    two: any[] = [];
  const close1 = await client.stream('/api/teacher/progress/events', t, (type, data) =>
    one.push({ type, data }),
  );
  const close2 = await client.stream('/api/teacher/progress/events', t2, (type, data) =>
    two.push({ type, data }),
  );
  expect(one[0].data[0].id).toBe(a.id);
  expect(two[0].data).toEqual([]);
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/q-force`,
    headers: s,
    payload: {
      expectedRevision: 0,
      data: {
        choiceIds: ['a'],
        blankValues: {},
        markdown: '',
        drawingPages: [],
        imagePages: [],
        parts: {},
        flagged: false,
      },
    },
  });
  expect(saved.statusCode).toBe(200);
  await until(() => one.some((e) => e.type === 'progress'));
  await sleep(30);
  expect(two.some((e) => e.type === 'progress')).toBe(false);
  await app.inject({
    method: 'DELETE',
    url: '/api/admin/teachers/user-teacher/students/user-student',
    headers: admin,
  });
  await until(() => one.filter((e) => e.type === 'snapshot').length === 2);
  expect(one.at(-1).data).toEqual([]);
  const disabled = await app.inject({
    method: 'PATCH',
    url: '/api/admin/users/user-teacher',
    headers: admin,
    payload: { expectedRevision: 0, role: 'teacher', disabled: true },
  });
  expect(disabled.statusCode).toBe(200);
  await until(() => one.at(-1).type === 'session-expired');
  close1();
  close2();
});
it('聊天SSE仅通知双方，关系解除只读，重置密码后旧连接即时失效', async () => {
  const { app, client, login } = await setup();
  const t = await login('teacher'),
    t2 = await login('t2'),
    s = await login('student'),
    admin = await login('administrator');
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: s,
      payload: { peerId: 'user-teacher' },
    })
  ).json();
  const teachers: any[] = [],
    students: any[] = [],
    other: any[] = [];
  const closes = [
    await client.stream('/api/chat/events', t, (type, data) => teachers.push({ type, data })),
    await client.stream('/api/chat/events', s, (type, data) => students.push({ type, data })),
    await client.stream('/api/chat/events', t2, (type, data) => other.push({ type, data })),
  ];
  await app.inject({
    method: 'POST',
    url: `/api/chat/conversations/${c.id}/messages`,
    headers: s,
    payload: { body: '只给陈老师的消息', clientMessageId: 'sse-1' },
  });
  await until(
    () => teachers.some((e) => e.type === 'changed') && students.some((e) => e.type === 'changed'),
  );
  await sleep(30);
  expect(other.some((e) => e.type === 'changed')).toBe(false);
  expect(JSON.stringify(other)).not.toContain(c.id);
  await app.inject({
    method: 'DELETE',
    url: '/api/admin/teachers/user-teacher/students/user-student',
    headers: admin,
  });
  await until(() => teachers.filter((e) => e.type === 'snapshot').length === 2);
  expect(teachers.filter((e) => e.type === 'snapshot').at(-1).data[0].canSend).toBe(false);
  const reset = await app.inject({
    method: 'POST',
    url: '/api/admin/users/user-student/reset-password',
    headers: admin,
    payload: { expectedRevision: 0 },
  });
  expect(reset.statusCode).toBe(200);
  await until(() => students.at(-1).type === 'session-expired');
  for (const close of closes) close();
  expect(
    (await app.inject({ url: `/api/chat/conversations/${c.id}/messages`, headers: s })).statusCode,
  ).toBe(401);
});
it('在线状态推送覆盖所有关联联系人，未关联用户收不到他人状态，解除关系清除状态', async () => {
  const { app, client, login } = await setup();
  const t = await login('teacher'),
    t2 = await login('t2'),
    s = await login('student'),
    other = await login('s3'),
    admin = await login('administrator');
  const one: any[] = [],
    two: any[] = [],
    strangers: any[] = [];
  const closes = [
    await client.stream('/api/chat/events', t, (type, data) => one.push({ type, data })),
    await client.stream('/api/chat/events', t2, (type, data) => two.push({ type, data })),
    await client.stream('/api/chat/events', other, (type, data) => strangers.push({ type, data })),
  ];
  await app.inject({
    method: 'POST',
    url: '/api/chat/presence',
    headers: s,
    payload: { clientId: 'sse-tab', sequence: 1 },
  });
  await until(
    () =>
      one.some((e) => e.type === 'presence' && e.data['user-student'] === 'online') &&
      two.some((e) => e.type === 'presence' && e.data['user-student'] === 'online'),
  );
  expect(strangers.filter((e) => e.type === 'presence').map((e) => e.data)).toEqual([{}]);
  await app.inject({
    method: 'DELETE',
    url: '/api/admin/teachers/user-teacher/students/user-student',
    headers: admin,
  });
  await until(
    () => one.filter((e) => e.type === 'presence').at(-1)?.data['user-student'] === undefined,
  );
  for (const close of closes) close();
});
