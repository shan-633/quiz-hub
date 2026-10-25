import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
import { PresenceService, presenceTtl } from '../server/presence';
import { hashToken } from '../server/auth';
import type { User } from '../shared/model';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});
it('好友状态仅对关联联系人可见，拒绝伪造或其他人的作答，退出登录立即离线', async () => {
  const f = await community();
  fixtures.push(f);
  const s = await f.login('student'),
    t = await f.login('teacher'),
    other = await f.login('s3');
  const post = (headers: any, payload: any) =>
    f.app.inject({ method: 'POST', url: '/api/chat/presence', headers, payload });
  expect((await post(s, { clientId: 'tab1', sequence: 1 })).statusCode).toBe(200);
  expect(
    (await f.app.inject({ url: '/api/chat/presence', headers: t })).json()['user-student'],
  ).toBe('online');
  expect((await f.app.inject({ url: '/api/chat/presence', headers: other })).json()).toEqual({});
  expect((await post(s, { clientId: 'tab1', sequence: 2, status: 'examining' })).statusCode).toBe(
    422,
  );
  expect(
    (await post(other, { clientId: 'tab1', sequence: 1, attemptId: 'unknown' })).statusCode,
  ).toBe(422);
  const a = (
    await f.app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  expect((await post(s, { clientId: 'tab1', sequence: 2, attemptId: a.id })).statusCode).toBe(200);
  expect(
    (await f.app.inject({ url: '/api/chat/presence', headers: t })).json()['user-student'],
  ).toBe('practicing');
  expect((await post(other, { clientId: 'tab1', sequence: 2, attemptId: a.id })).statusCode).toBe(
    422,
  );
  const payload = (await f.app.inject({ url: '/api/chat/presence', headers: t })).body;
  expect(payload).not.toContain(a.id);
  expect(payload).not.toContain('libraryId');
  await f.app.inject({ method: 'POST', url: '/api/auth/logout', headers: s });
  expect(
    (await f.app.inject({ url: '/api/chat/presence', headers: t })).json()['user-student'],
  ).toBe('offline');
});
it('多页面考试优先，旧心跳不覆盖新状态；到期、交卷、会话撤销会清除状态', async () => {
  const f = await community();
  fixtures.push(f);
  const s = await f.login('student');
  const user = f.store.get<User>('users', 'user-student')!;
  const sessionId = hashToken(s.cookie.split('=')[1]);
  const service = new PresenceService(f.store);
  const now = Date.now();
  f.store.put('library', 'presence-paper', { id: 'presence-paper', kind: 'paper' });
  const a = {
    id: 'presence-attempt',
    userId: user.id,
    teacherId: 'user-teacher',
    libraryId: 'presence-paper',
    status: 'active',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    title: '考试',
  };
  f.store.put('attempts', a.id, { ...a, questions: [], answers: {} }, user.id);
  service.update(user, sessionId, { clientId: 'tab1', sequence: 1, attemptId: a.id }, now);
  service.update(user, sessionId, { clientId: 'tab2', sequence: 1 }, now);
  expect(service.snapshot([user])[user.id]).toBe('examining');
  service.update(user, sessionId, { clientId: 'tab1', sequence: 3, offline: true }, now);
  service.update(user, sessionId, { clientId: 'tab1', sequence: 2, attemptId: a.id }, now);
  expect(service.snapshot([user])[user.id]).toBe('online');
  service.update(user, sessionId, { clientId: 'tab1', sequence: 4, attemptId: a.id }, now);
  f.store.put('attempts', a.id, { ...a, status: 'submitted', questions: [], answers: {} }, user.id);
  service.sweep(now + 1000);
  expect(service.snapshot([user])[user.id]).toBe('online');
  service.sweep(now + presenceTtl + 1);
  expect(service.snapshot([user])[user.id]).toBe('offline');
  service.update(user, sessionId, { clientId: 'tab1', sequence: 5 }, now);
  f.store.delete('sessions', sessionId);
  service.sweep(now + 2000);
  expect(service.snapshot([user])[user.id]).toBe('offline');
});
