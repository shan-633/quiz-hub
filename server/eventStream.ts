import type { FastifyInstance, FastifyReply } from 'fastify';
export function streamManager(app: FastifyInstance) {
  const all = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const close of all) close();
  });
  return (
    reply: FastifyReply,
    valid: () => boolean,
    setup: (write: (type: string, data: unknown) => void) => () => void,
  ) => {
    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-store, no-transform')
      .header('X-Accel-Buffering', 'no');
    reply.hijack();
    const raw = reply.raw;
    for (const [n, v] of Object.entries(reply.getHeaders()))
      if (v !== undefined) raw.setHeader(n, v);
    raw.writeHead(200);
    let closed = false,
      dispose = () => {},
      timer: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      dispose();
      clearInterval(timer);
      all.delete(close);
      raw.destroy();
    };
    const write = (type: string, data: unknown) => {
      if (closed) return;
      if (raw.destroyed || raw.writableLength > 1024 * 1024) {
        close();
        return;
      }
      try {
        raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        close();
      }
    };
    const authorized = () => {
      if (closed) return false;
      if (valid()) return true;
      write('session-expired', {});
      dispose();
      clearInterval(timer);
      all.delete(close);
      closed = true;
      raw.end();
      return false;
    };
    raw.on('close', close);
    raw.on('error', close);
    all.add(close);
    if (!authorized()) return;
    try {
      dispose = setup((type, data) => {
        if (authorized()) write(type, data);
      });
    } catch {
      close();
    }
    if (closed) {
      dispose();
      return;
    }
    timer = setInterval(() => {
      if (authorized()) write('heartbeat', {});
    }, 15000);
    timer.unref();
  };
}
