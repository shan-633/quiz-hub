import type { FastifyInstance } from 'fastify';
import { requireTeacher, teacherSessionActive } from '../auth';
import type { ProgressStore } from '../progressStore';

export function registerProgressStream(app: FastifyInstance, store: ProgressStore) {
  const connections = new Set<() => void>();
  app.get('/api/teacher/progress/events', (req, reply) => {
    requireTeacher(req);
    reply.header('Content-Type', 'text/event-stream; charset=utf-8');
    reply.header('Cache-Control', 'no-store, no-transform');
    reply.header('X-Accel-Buffering', 'no');
    reply.hijack();
    const response = reply.raw;
    // Preserve CORS and rate-limit headers already set by Fastify hooks.
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) response.setHeader(name, value);
    }
    response.writeHead(200);
    response.on('error', () => close());
    let closed = false;
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      connections.delete(close);
      response.destroy();
    };
    const write = (event: string, data: unknown) => {
      if (closed) return;
      if (response.destroyed || response.writableLength > 1024 * 1024) {
        close();
        return;
      }
      try {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        close();
      }
    };
    const authorized = () => {
      if (closed) return false;
      if (teacherSessionActive(store, req.sessionId)) return true;
      write('session-expired', {});
      unsubscribe();
      clearInterval(heartbeat);
      connections.delete(close);
      closed = true;
      response.end();
      return false;
    };
    connections.add(close);
    response.on('close', close);
    // Store writes are synchronous; subscribing and reading the snapshot in this
    // turn leaves no interval in which a committed change could be missed.
    unsubscribe = store.subscribeProgress((change) => {
      if (authorized()) write('progress', change);
    });
    if (!authorized()) return;
    try {
      write('snapshot', store.listProgress());
    } catch (error) {
      req.log.error(error);
      close();
    }
    if (closed) return;
    heartbeat = setInterval(() => {
      if (authorized()) write('heartbeat', { at: new Date().toISOString() });
    }, 15000);
    heartbeat.unref();
  });
  app.addHook('preClose', async () => {
    for (const close of connections) close();
  });
}
