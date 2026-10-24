import packageInfo from '../package.json' with { type: 'json' };
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z, ZodError } from 'zod';
import { ProgressStore } from './progressStore';
import { registerProgressStream } from './routes/progressStream';
import { seed as seedDatabase } from './seed';
import { installRealBeijing2022 } from './content/installRealBeijing2022';
import {
  registerAuthHooks,
  checkPassword,
  newSession,
  HttpError,
  requireUser,
  type StoredUser,
} from './auth';
import { registerLibrary } from './routes/library';
import { registerQuestions } from './routes/questions';
import { registerAttempts } from './routes/attempts';
import { registerTeacher } from './routes/teacher';
import { registerUploads } from './routes/uploads';
import { registerBankImport } from './routes/bankImport';
import { registerPrint } from './routes/print';
import { migrateIdentity, publicUser } from './identity';
import { registerAdmin } from './routes/admin';
import { registerChat } from './routes/chat';
import { AssignmentService } from './assignments';
import { registerAssignments } from './routes/assignments';
import { initAttemptTiming, startDeadlineWorker } from './attemptTiming';
import { registerSelfReview } from './routes/selfReview';
import { registerCurriculum } from './routes/curriculum';
import type { PdfRenderer } from './print/pdf';
export interface AppOptions {
  dataDir: string;
  seed?: boolean;
  origin?: string;
  logger?: boolean;
  pdfRenderer?: PdfRenderer;
}
export async function createApp(options: AppOptions) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 8 * 1024 * 1024 });
  const store = new ProgressStore(resolve(options.dataDir));
  if (options.seed ?? true) {
    seedDatabase(store);
    installRealBeijing2022(store);
  }
  migrateIdentity(store);
  initAttemptTiming(store);
  const assignments = new AssignmentService(store);
  await app.register(cookie);
  await app.register(cors, {
    origin: options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
    exposedHeaders: ['Content-Disposition', 'X-PDF-Page-Count', 'X-PDF-Question-Count'],
  });
  await app.register(rateLimit, { max: 500, timeWindow: '1 minute' });
  registerAuthHooks(
    app,
    store,
    options.origin ?? process.env.APP_ORIGIN ?? 'http://localhost:5173',
  );
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(422).send({
        message: '输入格式不正确',
        issues: error.issues.map((i) => `${i.path.join('.')}：${i.message}`),
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message, ...error.extra });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error(error);
    return reply
      .code(status)
      .send({ message: status >= 500 ? '服务暂时不可用，请稍后重试' : (error as Error).message });
  });
  app.get('/api/health', async () => ({ ok: true, version: packageInfo.version }));
  app.get('/api/auth/config', async () => ({
    demoMode: (options.seed ?? true) && process.env.NODE_ENV !== 'production',
  }));
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = z
        .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(128) })
        .parse(req.body);
      const user = store.list<StoredUser>('users').find((u) => u.username === body.username);
      if (
        !user ||
        user.disabled ||
        !['student', 'teacher', 'admin'].includes(user.role) ||
        !checkPassword(body.password, user.passwordHash)
      )
        throw new HttpError(401, '账号或密码不正确');
      const { token, csrfToken } = newSession(store, user.id),
        safe = publicUser(user);
      reply.setCookie('zhixu_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.SECURE_COOKIE === 'true',
        maxAge: 7 * 86400,
      });
      return { user: safe, csrfToken };
    },
  );
  app.get('/api/auth/me', async (req) => ({ user: req.user, csrfToken: req.csrfToken }));
  app.post('/api/auth/logout', async (req, reply) => {
    requireUser(req);
    store.delete('sessions', req.sessionId);
    reply.clearCookie('zhixu_session', { path: '/' });
    return { ok: true };
  });
  registerLibrary(app, store);
  registerCurriculum(app, store);
  registerAdmin(app, store);
  registerChat(app, store);
  registerAssignments(app, store, assignments);
  registerQuestions(app, store);
  registerAttempts(app, store, assignments);
  registerSelfReview(app, store);
  registerPrint(app, store, options.pdfRenderer, assignments);
  registerTeacher(app, store, (teacherId) => store.listProgress(teacherId));
  registerProgressStream(app, store);
  await registerUploads(app, store, assignments);
  registerBankImport(app, store);
  const publicDir = resolve('public');
  if (existsSync(publicDir))
    await app.register(fastifyStatic, { root: publicDir, prefix: '/', decorateReply: false });
  const dist = resolve('dist');
  if (existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      decorateReply: true,
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ message: '接口不存在' })
        : reply.sendFile('index.html', dist),
    );
  }
  const stopDeadlines = startDeadlineWorker(store, (error) => app.log.error(error));
  app.addHook('onClose', async () => {
    stopDeadlines();
    store.close();
  });
  return app;
}
