import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { hashPassword, newSession } from '../server/auth';
import type { LibraryItem } from '../shared/model';
const resources: { app: Awaited<ReturnType<typeof createApp>>; dir: string }[] = [];
afterEach(async () => {
  for (const { app, dir } of resources.splice(0)) {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('没有管理员初始化标记时重启仍保留教师已修改的题库', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-teacher-seed-'));
  const resource = { app: await createApp({ dataDir: dir }), dir };
  resources.push(resource);
  const store = new Store(dir);
  const bank = store.get<LibraryItem>('library', 'bank-mechanics')!;
  bank.title = '教师保存的标题';
  store.put('library', bank.id, bank);
  store.close();
  await resource.app.close();
  resource.app = await createApp({ dataDir: dir });
  const list = (await resource.app.inject({ url: '/api/library' })).json();
  expect(list.find((b: LibraryItem) => b.id === bank.id).title).toBe('教师保存的标题');
});
it('教学管理统一到教师接口，只保留学生和教师身份', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-roles-')),
    app = await createApp({ dataDir: dir });
  resources.push({ app, dir });
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
  const teacher = await login('teacher', 'Teacher123!'),
    student = await login('student', 'Student123!');
  const store = new Store(dir);
  try {
    expect(store.list<any>('users').every((u) => u.role !== 'admin')).toBe(true);
    store.put('users', 'legacy-admin', {
      id: 'legacy-admin',
      username: 'admin',
      name: '原管理员',
      role: 'admin',
      passwordHash: hashPassword('Admin123!'),
    });
    const { token } = newSession(store, 'legacy-admin');
    expect(
      (
        await app.inject({ url: '/api/auth/me', headers: { cookie: `zhixu_session=${token}` } })
      ).json().user,
    ).toBeNull();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'admin', password: 'Admin123!' },
        })
      ).statusCode,
    ).toBe(401);
  } finally {
    store.close();
  }
  for (const path of [
    '/api/teacher/banks',
    '/api/teacher/papers',
    '/api/teacher/questions',
    '/api/teacher/attempts',
  ]) {
    expect((await app.inject({ url: path, headers: teacher })).statusCode).toBe(200);
    expect((await app.inject({ url: path, headers: student })).statusCode).toBe(403);
    expect((await app.inject({ url: path })).statusCode).toBe(401);
  }
  expect((await app.inject({ url: '/api/admin/banks', headers: teacher })).statusCode).toBe(404);
  const files = '/api/teacher/bank-import/files/minimal.zqb.json';
  expect((await app.inject({ url: files, headers: teacher })).statusCode).toBe(200);
  expect((await app.inject({ url: files, headers: student })).statusCode).toBe(403);
});
