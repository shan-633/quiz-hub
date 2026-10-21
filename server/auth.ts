import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../shared/model';
import type { Store } from './store';
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
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api')) return;
    const raw = req.cookies.zhixu_session;
    if (raw) {
      const key = hashToken(raw),
        session = store.get<Session>('sessions', key);
      if (session && session.expiresAt > Date.now()) {
        const stored = store.get<StoredUser>('users', session.userId);
        if (stored && (stored.role === 'teacher' || stored.role === 'student')) {
          const { passwordHash, ...user } = stored;
          req.user = { ...user, role: stored.role };
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
    if (req.url.startsWith('/api/teacher')) requireTeacher(req);
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
