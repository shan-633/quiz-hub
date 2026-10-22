import type { FastifyInstance } from 'fastify';
import { requireTeacher, teacherSessionActive } from '../auth';
import type { ProgressStore } from '../progressStore';
import { linked, subscribeAccess } from '../permissions';

export function registerProgressStream(app: FastifyInstance, store: ProgressStore) {
  const connections = new Set<() => void>();
  app.get('/api/teacher/progress/events', (req, reply) => {
    const teacher = requireTeacher(req);
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
    let unsubscribeAccess = () => {};
    const visible = new Set<string>();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe();
      unsubscribeAccess();
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
      unsubscribeAccess();
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
      if (!authorized()) return;
      const row = change.type === 'upsert' ? change.row : undefined;
      const teacherId = row
        ? store.db.prepare('SELECT teacher_id FROM attempt_progress WHERE id=?').get(row.id)
            ?.teacher_id
        : undefined;
      if (row && teacherId === teacher.id && linked(store, teacher.id, row.student.id)) {
        visible.add(row.id);
        write('progress', change);
      } else {
        const id = change.type === 'remove' ? change.id : change.row.id;
        if (visible.delete(id)) write('progress', { type: 'remove', id });
      }
    });
    const snapshot = () => {
      if (!authorized()) return;
      const rows = store.listProgress(teacher.id);
      visible.clear();
      rows.forEach((r) => visible.add(r.id));
      write('snapshot', rows);
    };
    unsubscribeAccess = subscribeAccess(store, snapshot);
    if (!authorized()) return;
    try {
      snapshot();
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
