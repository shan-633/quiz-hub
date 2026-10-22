import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../server/app';
import { ProgressStore } from '../../server/progressStore';
import { hashPassword } from '../../server/auth';
import { bootstrapAdmin } from '../../server/identity';
import { createAssignedApp } from './assignedApp';
export async function community(options: { assigned?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'community-')),
    app = await (options.assigned === false ? createApp : createAssignedApp)({ dataDir: dir }),
    store = new ProgressStore(dir);
  for (const [id, role] of [
    ['t2', 'teacher'],
    ['s3', 'student'],
  ] as const)
    store.put('users', id, {
      id,
      username: id,
      name: id,
      role,
      passwordHash: hashPassword('FixturePass123!'),
    });
  store.db
    .prepare('INSERT INTO teaching_links VALUES(?,?,?)')
    .run('t2', 'user-student', '2026-10-22');
  const admin = bootstrapAdmin(store, 'administrator', 'FixturePass123!');
  store.put('users', admin.user.id, {
    ...store.get<any>('users', admin.user.id),
    mustChangePassword: false,
  });
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username,
        password:
          username === 'teacher'
            ? 'Teacher123!'
            : username.startsWith('student')
              ? 'Student123!'
              : 'FixturePass123!',
      },
    });
    if (r.statusCode !== 200) throw new Error(r.body);
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  return {
    app,
    store,
    dir,
    login,
    close: async () => {
      await app.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
