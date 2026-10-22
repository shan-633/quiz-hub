import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { ProgressStore } from '../server/progressStore';
import { bootstrapAdmin, migrateIdentity } from '../server/identity';
import { linked } from '../server/permissions';
const resources: {
  app: Awaited<ReturnType<typeof createApp>>;
  store: ProgressStore;
  dir: string;
}[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    await r.app.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'identity-'));
  const app = await createApp({ dataDir: dir });
  const store = new ProgressStore(dir);
  resources.push({ app, store, dir });
  bootstrapAdmin(store, 'administrator', 'AdminStart123!');
  const login = async (username: string, password: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
    expect(r.statusCode).toBe(200);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  return { app, store, login };
}
it('迁移建立明确归属和多教师关系，重复迁移不恢复已删除关系', async () => {
  const { store } = await setup();
  expect(store.get<any>('library', 'bank-mechanics').teacherId).toBe('user-teacher');
  expect(linked(store, 'user-teacher', 'user-student')).toBe(true);
  store.db.prepare('DELETE FROM teaching_links WHERE student_id=?').run('user-student');
  migrateIdentity(store);
  expect(linked(store, 'user-teacher', 'user-student')).toBe(false);
});
it('管理员创建账号、强制改密、重置撤销会话，敏感字段不出现在响应', async () => {
  const { app, login } = await setup();
  const admin = await login('administrator', 'AdminStart123!');
  expect((await app.inject({ url: '/api/admin/users', headers: admin })).statusCode).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: admin,
        payload: { currentPassword: 'AdminStart123!', newPassword: 'AdminChanged123!' },
      })
    ).statusCode,
  ).toBe(200);
  const fresh = await login('administrator', 'AdminChanged123!');
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: fresh,
    payload: { username: 'newteacher', name: '新教师', role: 'teacher' },
  });
  expect(created.statusCode).toBe(201);
  const { user, temporaryPassword } = created.json();
  expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
  expect(user.passwordHash).toBeUndefined();
  const teacher = await login('newteacher', temporaryPassword);
  expect((await app.inject({ url: '/api/teacher/banks', headers: teacher })).statusCode).toBe(403);
  await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: teacher,
    payload: { currentPassword: temporaryPassword, newPassword: 'TeacherChanged123!' },
  });
  const t = await login('newteacher', 'TeacherChanged123!');
  expect((await app.inject({ url: '/api/teacher/banks', headers: t })).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/admin/users/${user.id}/reset-password`,
        headers: fresh,
        payload: { expectedRevision: user.revision + 1 },
      })
    ).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: '/api/teacher/banks', headers: t })).statusCode).toBe(401);
  expect((await app.inject({ url: '/api/admin/users', headers: t })).statusCode).toBe(401);
  const users = (await app.inject({ url: '/api/admin/users', headers: fresh })).json();
  expect(JSON.stringify(users)).not.toContain('passwordHash');
});
it('最后管理员保护、角色权限及多个教师可关联同一学生', async () => {
  const { app, store, login } = await setup();
  const admin = await login('administrator', 'AdminStart123!');
  await app.inject({
    method: 'POST',
    url: '/api/auth/password',
    headers: admin,
    payload: { currentPassword: 'AdminStart123!', newPassword: 'AdminChanged123!' },
  });
  const a = await login('administrator', 'AdminChanged123!');
  const users = (await app.inject({ url: '/api/admin/users', headers: a })).json().users;
  const me = users.find((u: any) => u.username === 'administrator');
  expect(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${me.id}`,
        headers: a,
        payload: { expectedRevision: me.revision, role: 'student', disabled: false },
      })
    ).statusCode,
  ).toBe(409);
  const t2 = (
    await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      headers: a,
      payload: { username: 'secondteacher', name: '教师二', role: 'teacher' },
    })
  ).json().user;
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/admin/teachers/${t2.id}/students/user-student`,
        headers: a,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(linked(store, t2.id, 'user-student')).toBe(true);
  expect(linked(store, 'user-teacher', 'user-student')).toBe(true);
  const student = await login('student', 'Student123!');
  expect((await app.inject({ url: '/api/admin/users', headers: student })).statusCode).toBe(403);
});
