import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { ZodError } from 'zod';
import type { ServerResponse } from 'node:http';
import { Store } from '../../server/store';
import { HttpError, registerAuthHooks, requireTeacher } from '../../server/auth';
import { registerAttempts } from '../../server/routes/attempts';
import { registerTeacher } from '../../server/routes/teacher';
import { SummaryStore } from './summary-store';
import type { Attempt } from '../../shared/model';

// Harness-only composition: both modes share production auth and save handlers.
export async function createBenchmarkApp(dir: string, mode: 'baseline' | 'optimized') {
  const store = mode === 'optimized' ? new SummaryStore(dir) : new Store(dir);
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  // Both modes expose the committed attempt timestamp for measurement only.
  // Production saves set answer.updatedAt and attempt.updatedAt separately.
  const committedVersions = new Map<string, string>();
  const put = store.put.bind(store);
  store.put = (collection, id, value, owner = '') => {
    put(collection, id, value, owner);
    if (collection === 'attempts') committedVersions.set(id, (value as Attempt).updatedAt);
  };
  app.addHook('onSend', async (req, reply, payload) => {
    const id = req.url.match(/^\/api\/attempts\/([^/]+)\/answers\//)?.[1];
    if (req.method === 'PUT' && id && reply.statusCode === 200)
      reply.header('X-Benchmark-Progress-Version', committedVersions.get(id)!);
    return payload;
  });
  await app.register(cookie);
  registerAuthHooks(app, store, 'http://127.0.0.1');
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(422).send({ message: '输入格式不正确' });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ message: error.message, ...error.extra });
    return reply.code(500).send({ message: (error as Error).message });
  });
  const streams = new Set<ServerResponse>();
  if (store instanceof SummaryStore) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.method === 'GET' && req.url === '/api/teacher/progress') {
        requireTeacher(req);
        return reply.header('Cache-Control', 'no-store').send(store.listProgress());
      }
    });
    store.onProgress = (event) => {
      const frame = `event: progress\ndata: ${JSON.stringify(event)}\n\n`;
      for (const stream of streams) {
        if (stream.destroyed || stream.writableLength > 1024 * 1024) {
          stream.destroy();
          streams.delete(stream);
        } else stream.write(frame);
      }
    };
    app.get('/api/teacher/progress/events', (req, reply) => {
      requireTeacher(req);
      reply.hijack();
      const stream = reply.raw;
      stream.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      streams.add(stream);
      // Same JS turn as subscription: no gap between the snapshot and new events.
      stream.write(`event: snapshot\ndata: ${JSON.stringify(store.listProgress())}\n\n`);
      const heartbeat = setInterval(() => stream.write(': heartbeat\n\n'), 15000);
      stream.on('close', () => {
        clearInterval(heartbeat);
        streams.delete(stream);
      });
    });
  }
  registerAttempts(app, store);
  registerTeacher(app, store);
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.destroy();
  });
  app.addHook('onClose', async () => store.close());
  return { app, store, backfillMs: store instanceof SummaryStore ? store.backfillMs : 0 };
}
