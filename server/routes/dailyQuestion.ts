import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { HttpError, requireUser } from '../auth';
import { DailyQuestionService } from '../dailyQuestion';
import type { Store } from '../store';
export function registerDailyQuestion(app: FastifyInstance, store: Store) {
  const service = new DailyQuestionService(store);
  const student = (req: FastifyRequest) => {
    const u = requireUser(req);
    if (u.role !== 'student') throw new HttpError(403, '每日一题仅供学生使用');
    return u;
  };
  app.get('/api/daily-question', (req) => {
    const u = student(req);
    const query = z
      .object({
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      })
      .strict()
      .parse(req.query);
    return service.overview(u, query.month);
  });
  app.post('/api/daily-question/start', (req, reply) => {
    const result = service.start(student(req));
    return reply.code(result.created ? 201 : 200).send(result);
  });
}
