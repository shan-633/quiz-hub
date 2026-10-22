import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../shared/model';
import type { Store } from './store';
import { publicUser } from './identity';
export interface StoredUser extends Omit<User, 'role'> {
  // Historical admin records are kept for attribution, but cannot authenticate.
  role: User['role'] | 'admin';
  passwordHash: string;
}
interface Session {
  userId: string;
  csrfToken: string;
  expiresAt: number;
}
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    csrfToken: string;
    sessionId: string;
  }
}
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export function hashPassword(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
export function checkPassword(value: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const actual = scryptSync(value, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, '请先登录后继续');
  return req.user;
}
export function requireTeacher(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.role !== 'teacher') throw new HttpError(403, '需要教师权限');
  return user;
}
export function requireAdmin(req: FastifyRequest): User {
  const user = requireUser(req);
  if (user.role !== 'admin') throw new HttpError(403, '需要管理员权限');
  return user;
}
export function requireActiveSession(store: Store, req: FastifyRequest, role?: User['role']): User {
  const user = sessionUser(store, req.sessionId);
  if (!user) throw new HttpError(401, '登录状态已失效，请重新登录');
  if (role && user.role !== role) throw new HttpError(403, '当前角色无权执行此操作');
  return user;
}
export function sessionUser(store: Store, sessionId: string): User | undefined {
  const s = store.get<Session>('sessions', sessionId);
  if (!s || s.expiresAt <= Date.now()) return undefined;
  const u = store.get<StoredUser>('users', s.userId);
  return u &&
    !u.disabled &&
    !u.mustChangePassword &&
    ['student', 'teacher', 'admin'].includes(u.role)
    ? publicUser(u)
    : undefined;
}
export function teacherSessionActive(store: Store, sessionId: string): boolean {
  return sessionUser(store, sessionId)?.role === 'teacher';
}
export function registerAuthHooks(app: FastifyInstance, store: Store, origin: string) {
  app.decorateRequest('user', null);
  app.decorateRequest('csrfToken', '');
  app.decorateRequest('sessionId', '');
  const origins = new Set([
    origin,
    ...(process.env.NODE_ENV !== 'production'
      ? [
          'http://localhost:5173',
          'http://127.0.0.1:5173',
          'http://localhost:3001',
          'http://127.0.0.1:3001',
        ]
      : []),
  ]);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api')) return;
    reply.header('Cache-Control', 'private, no-store');
    const raw = req.cookies.zhixu_session;
    if (raw) {
      const key = hashToken(raw),
        session = store.get<Session>('sessions', key);
      if (session && session.expiresAt > Date.now()) {
        const stored = store.get<StoredUser>('users', session.userId);
        if (stored && !stored.disabled && ['teacher', 'student', 'admin'].includes(stored.role)) {
          req.user = publicUser(stored);
          req.csrfToken = session.csrfToken;
          req.sessionId = key;
        } else {
          store.delete('sessions', key);
        }
      } else if (session) store.delete('sessions', key);
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (
      write &&
      ((req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site')
    )
      throw new HttpError(403, '请求来源不受信任');
    if (
      req.user?.mustChangePassword &&
      !['/api/auth/me', '/api/auth/password', '/api/auth/logout'].includes(req.url.split('?')[0])
    )
      throw new HttpError(403, '请先修改临时密码', { code: 'PASSWORD_CHANGE_REQUIRED' });
    if (req.url.startsWith('/api/teacher')) requireTeacher(req);
    if (req.url.startsWith('/api/admin')) requireAdmin(req);
    if (write && req.url !== '/api/auth/login') {
      requireUser(req);
      if (req.headers['x-csrf-token'] !== req.csrfToken)
        throw new HttpError(403, '会话校验失败，请刷新后重试');
    }
  });
}
export function newSession(store: Store, userId: string) {
  const token = randomBytes(32).toString('hex'),
    csrfToken = randomBytes(24).toString('hex');
  store.put('sessions', hashToken(token), {
    userId,
    csrfToken,
    expiresAt: Date.now() + 7 * 86400000,
  });
  return { token, csrfToken };
}
