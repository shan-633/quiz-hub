import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { User } from '../../shared/model';
import {
  HttpError,
  requireAdmin,
  requireUser,
  hashPassword,
  checkPassword,
  type StoredUser,
} from '../auth';
import { audit, publicUser, revokeSessions, temporaryPassword } from '../identity';
import { activeUser, notifyAccess } from '../permissions';
import type { Store } from '../store';
const roles = z.enum(['student', 'teacher', 'admin']);
const revision = z.number().int().nonnegative();
export function registerAdmin(app: FastifyInstance, store: Store) {
  const find = (id: string) => {
    const u = store.get<StoredUser>('users', id);
    if (!u) throw new HttpError(404, '账号不存在');
    return u;
  };
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const query = z
      .object({
        search: z.string().max(100).default(''),
        role: roles.optional(),
        status: z.enum(['enabled', 'disabled', 'pending']).optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    const users = store
      .list<StoredUser>('users')
      .filter(
        (u) =>
          (!query.role || u.role === query.role) &&
          (!query.status ||
            (query.status === 'disabled'
              ? !!u.disabled
              : query.status === 'pending'
                ? !u.disabled && !!u.mustChangePassword
                : !u.disabled)) &&
          `${u.name} ${u.username}`.toLowerCase().includes(query.search.toLowerCase()),
      );
    return {
      users: users.slice((query.page - 1) * 30, query.page * 30).map(publicUser),
      total: users.length,
      page: query.page,
    };
  });
  app.post('/api/admin/users', async (req, reply) => {
    const actor = requireAdmin(req),
      b = z
        .object({
          username: z.string().regex(/^[a-zA-Z0-9_-]{3,40}$/),
          name: z.string().trim().min(1).max(60),
          role: roles,
        })
        .strict()
        .parse(req.body);
    const password = temporaryPassword();
    const user = store.transaction(() => {
      if (
        store.list<User>('users').some((u) => u.username.toLowerCase() === b.username.toLowerCase())
      )
        throw new HttpError(409, '账号已存在');
      const u: StoredUser = {
        ...b,
        id: crypto.randomUUID(),
        disabled: false,
        mustChangePassword: true,
        revision: 1,
        passwordHash: hashPassword(password),
      };
      store.put('users', u.id, u);
      audit(store, actor.id, 'create-user', u.id, b.role);
      return publicUser(u);
    });
    notifyAccess(store);
    return reply.code(201).send({ user, temporaryPassword: password });
  });
  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const actor = requireAdmin(req),
      b = z
        .object({
          expectedRevision: revision,
          role: roles,
          disabled: z.boolean(),
          name: z.string().trim().min(1).max(60).optional(),
        })
        .strict()
        .parse(req.body);
    const user = store.transaction(() => {
      const old = find(req.params.id);
      if ((old.revision ?? 0) !== b.expectedRevision)
        throw new HttpError(409, '账号已更新，请刷新后重试');
      if (
        old.role === 'admin' &&
        !old.disabled &&
        (b.disabled || b.role !== 'admin') &&
        store.list<User>('users').filter((u) => u.role === 'admin' && !u.disabled).length <= 1
      )
        throw new HttpError(409, '必须保留至少一位启用的管理员');
      const next = {
        ...old,
        role: b.role,
        disabled: b.disabled,
        name: b.name ?? old.name,
        revision: (old.revision ?? 0) + 1,
      };
      store.put('users', old.id, next);
      revokeSessions(store, old.id);
      audit(
        store,
        actor.id,
        'update-user',
        old.id,
        JSON.stringify({ role: b.role, disabled: b.disabled }),
      );
      return publicUser(next);
    });
    notifyAccess(store);
    return { user };
  });
  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/reset-password',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = requireAdmin(req),
        b = z.object({ expectedRevision: revision }).strict().parse(req.body),
        password = temporaryPassword();
      const user = store.transaction(() => {
        const u = find(req.params.id);
        if ((u.revision ?? 0) !== b.expectedRevision)
          throw new HttpError(409, '账号已更新，请刷新后重试');
        const next = {
          ...u,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          revision: (u.revision ?? 0) + 1,
        };
        store.put('users', u.id, next);
        revokeSessions(store, u.id);
        audit(store, actor.id, 'reset-password', u.id, '已设置临时密码');
        return publicUser(next);
      });
      notifyAccess(store);
      return { user, temporaryPassword: password };
    },
  );
  app.get('/api/admin/relations', async (req) => {
    requireAdmin(req);
    return {
      users: store.list<User>('users').map(publicUser),
      links: store.db
        .prepare('SELECT teacher_id AS teacherId,student_id AS studentId FROM teaching_links')
        .all(),
    };
  });
  for (const method of ['PUT', 'DELETE'] as const)
    app.route<{ Params: { teacher: string; student: string } }>({
      method,
      url: '/api/admin/teachers/:teacher/students/:student',
      handler: async (req) => {
        const actor = requireAdmin(req),
          { teacher, student } = req.params;
        store.transaction(() => {
          if (!activeUser(store, teacher, 'teacher') || !activeUser(store, student, 'student'))
            throw new HttpError(422, '请选择启用的教师和学生');
          if (method === 'PUT')
            store.db
              .prepare('INSERT OR IGNORE INTO teaching_links VALUES(?,?,?)')
              .run(teacher, student, new Date().toISOString());
          else
            store.db
              .prepare('DELETE FROM teaching_links WHERE teacher_id=? AND student_id=?')
              .run(teacher, student);
          audit(store, actor.id, method === 'PUT' ? 'link' : 'unlink', student, teacher);
        });
        notifyAccess(store);
        return { ok: true };
      },
    });
  app.get('/api/admin/audit', async (req) => {
    requireAdmin(req);
    return store.db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 100').all();
  });
  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req) => {
      const actor = requireUser(req),
        b = z
          .object({
            currentPassword: z.string().max(128),
            newPassword: z.string().min(12).max(128),
          })
          .strict()
          .parse(req.body);
      if (b.currentPassword === b.newPassword) throw new HttpError(422, '新密码不能与当前密码相同');
      const user = store.transaction(() => {
        const old = find(actor.id);
        if (!checkPassword(b.currentPassword, old.passwordHash))
          throw new HttpError(422, '当前密码不正确');
        const next = {
          ...old,
          passwordHash: hashPassword(b.newPassword),
          mustChangePassword: false,
          revision: (old.revision ?? 0) + 1,
        };
        store.put('users', old.id, next);
        revokeSessions(store, old.id);
        audit(store, actor.id, 'change-password', old.id, '本人修改密码');
        return publicUser(next);
      });
      notifyAccess(store);
      return { user, relogin: true };
    },
  );
}
