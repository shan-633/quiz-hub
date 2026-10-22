import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
it('只有关联师生可创建私聊，消息幂等、游标分页、未读及只读历史', async () => {
  const f = await community();
  fixtures.push(f);
  const { app, login } = f;
  const t = await login('teacher'),
    t2 = await login('t2'),
    s = await login('student'),
    stranger = await login('s3'),
    admin = await login('administrator');
  const request = (method: any, url: string, headers: any, payload?: any) =>
    app.inject({ method, url, headers, payload });
  expect((await request('GET', '/api/chat/contacts', s)).json().length).toBe(2);
  expect(
    (await request('POST', '/api/chat/conversations', stranger, { peerId: 'user-teacher' }))
      .statusCode,
  ).toBe(403);
  expect((await request('GET', '/api/chat/conversations', admin)).statusCode).toBe(403);
  const c = (
    await request('POST', '/api/chat/conversations', s, { peerId: 'user-teacher' })
  ).json();
  expect(c.id).toBeTruthy();
  const message = { body: '老师好，想问第3题', clientMessageId: 'retry-1' };
  const first = await request('POST', `/api/chat/conversations/${c.id}/messages`, s, message);
  expect(first.statusCode).toBe(201);
  const again = await request('POST', `/api/chat/conversations/${c.id}/messages`, s, message);
  expect(again.json().id).toBe(first.json().id);
  expect((await request('GET', `/api/chat/conversations/${c.id}/messages`, t2)).statusCode).toBe(
    404,
  );
  expect((await request('GET', '/api/chat/conversations', t)).json()[0].unread).toBe(1);
  await request('POST', `/api/chat/conversations/${c.id}/read`, t, { messageId: first.json().id });
  expect((await request('GET', '/api/chat/conversations', t)).json()[0].unread).toBe(0);
  await request('POST', `/api/chat/conversations/${c.id}/messages`, t, {
    body: '请先画受力图',
    clientMessageId: 'reply-1',
  });
  const history = (
    await request('GET', `/api/chat/conversations/${c.id}/messages?limit=1`, s)
  ).json();
  expect(history.messages.length).toBe(1);
  expect(history.hasMore).toBe(true);
  const earlier = (
    await request(
      'GET',
      `/api/chat/conversations/${c.id}/messages?before=${history.messages[0].id}&limit=1`,
      s,
    )
  ).json();
  expect(earlier.messages[0].body).toBe(message.body);
  expect(
    (
      await request('POST', `/api/chat/conversations/${c.id}/messages`, s, {
        body: '  ',
        clientMessageId: 'blank',
      })
    ).statusCode,
  ).toBe(422);
  await request('DELETE', '/api/admin/teachers/user-teacher/students/user-student', admin);
  expect((await request('GET', '/api/chat/conversations', s)).json()[0].canSend).toBe(false);
  expect((await request('GET', `/api/chat/conversations/${c.id}/messages`, s)).statusCode).toBe(
    200,
  );
  expect(
    (
      await request('POST', `/api/chat/conversations/${c.id}/messages`, t, {
        body: 'x',
        clientMessageId: 'removed',
      })
    ).statusCode,
  ).toBe(403);
});
it('消息引用验证双方答卷权限；不能用引用读取其他教师或未交卷答案', async () => {
  const f = await community();
  fixtures.push(f);
  const { app, login } = f;
  const s = await login('student'),
    t = await login('teacher');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: s,
      payload: { peerId: 'user-teacher' },
    })
  ).json();
  const send = (reference: any, id: string) =>
    app.inject({
      method: 'POST',
      url: `/api/chat/conversations/${c.id}/messages`,
      headers: s,
      payload: { body: '这道题', clientMessageId: id, reference },
    });
  expect((await send({ attemptId: a.id, questionId: 'q-force' }, 'active')).statusCode).toBe(422);
  await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s });
  const r = await send({ attemptId: a.id, questionId: 'q-force' }, 'submitted');
  expect(r.statusCode).toBe(201);
  expect(r.json().reference.label).toContain('力与运动');
  expect(r.body).not.toContain('solution');
  expect(
    (await app.inject({ url: `/api/chat/conversations/${c.id}/messages`, headers: t })).json()
      .messages[0].reference.href,
  ).toContain('/teacher/attempts/');
  expect((await send({ attemptId: a.id, questionId: 'unknown' }, 'bad')).statusCode).toBe(422);
});
it('超过50条离线消息可按after游标升序补齐，前后游标不可混用', async () => {
  const f = await community();
  fixtures.push(f);
  const { app, store, login } = f;
  const s = await login('student');
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: s,
      payload: { peerId: 'user-teacher' },
    })
  ).json();
  const ids: number[] = [];
  for (let i = 0; i < 115; i++)
    ids.push(
      Number(
        store.db
          .prepare(
            'INSERT INTO chat_messages(conversation_id,sender_id,client_message_id,body,created_at) VALUES(?,?,?,?,?)',
          )
          .run(c.id, 'user-teacher', `bulk-${i}`, `消息${i}`, '2026-10-22').lastInsertRowid,
      ),
    );
  const page = (
    await app.inject({
      url: `/api/chat/conversations/${c.id}/messages?after=${ids[0]}`,
      headers: s,
    })
  ).json();
  expect(page.messages[0].id).toBe(ids[1]);
  expect(page.messages).toHaveLength(50);
  expect(page.hasMore).toBe(true);
  const page2 = (
    await app.inject({
      url: `/api/chat/conversations/${c.id}/messages?after=${page.messages.at(-1).id}`,
      headers: s,
    })
  ).json();
  expect(page2.messages[0].id).toBe(ids[51]);
  expect(
    (
      await app.inject({
        url: `/api/chat/conversations/${c.id}/messages?before=100&after=1`,
        headers: s,
      })
    ).statusCode,
  ).toBe(422);
});
