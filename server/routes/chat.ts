import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ChatService } from '../chat';
import { requireUser, sessionUser, HttpError } from '../auth';
import { subscribeAccess } from '../permissions';
import { streamManager } from '../eventStream';
import type { Store } from '../store';
export function registerChat(app: FastifyInstance, store: Store) {
  const chat = new ChatService(store),
    stream = streamManager(app);
  const user = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.role === 'admin') throw new HttpError(403, '管理员不参与师生私聊');
    return u;
  };
  app.get('/api/chat/contacts', async (req) => chat.contacts(user(req)));
  app.get('/api/chat/conversations', async (req) => chat.conversations(user(req)));
  app.post('/api/chat/conversations', async (req) =>
    chat.create(
      user(req),
      z
        .object({ peerId: z.string().max(128) })
        .strict()
        .parse(req.body).peerId,
    ),
  );
  app.get<{ Params: { id: string } }>('/api/chat/conversations/:id/messages', async (req) => {
    const q = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        after: z.coerce.number().int().nonnegative().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(50),
      })
      .refine((q) => q.before === undefined || q.after === undefined, {
        message: '前后游标不可同时使用',
      })
      .parse(req.query);
    return chat.messages(user(req), req.params.id, q.before, q.limit, q.after);
  });
  app.post<{ Params: { id: string } }>(
    '/api/chat/conversations/:id/messages',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.user?.id ?? req.ip,
        },
      },
    },
    async (req, reply) => {
      const b = z
        .object({
          body: z.string().trim().min(1).max(4000),
          clientMessageId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
          reference: z
            .object({ attemptId: z.string().max(128), questionId: z.string().max(128) })
            .strict()
            .optional(),
        })
        .strict()
        .parse(req.body);
      return reply.code(201).send(chat.send(user(req), req.params.id, b));
    },
  );
  app.post<{ Params: { id: string } }>('/api/chat/conversations/:id/read', async (req) =>
    chat.read(
      user(req),
      req.params.id,
      z.object({ messageId: z.number().int().nonnegative() }).strict().parse(req.body).messageId,
    ),
  );
  app.get('/api/chat/events', (req, reply) => {
    const u = user(req);
    stream(
      reply,
      () => {
        const current = sessionUser(store, req.sessionId);
        return current?.id === u.id && current.role === u.role;
      },
      (write) => {
        const dispose = chat.subscribe((ids, id) => {
          if (ids.includes(u.id)) {
            try {
              chat.thread(u, id);
              write('changed', { conversationId: id });
            } catch {}
          }
        });
        const access = subscribeAccess(store, () => write('snapshot', chat.conversations(u)));
        write('snapshot', chat.conversations(u));
        return () => {
          dispose();
          access();
        };
      },
    );
  });
}
