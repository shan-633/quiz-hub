import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Attempt } from '../../shared/model';
import { selfGrade, selfReviewParts, validManualScore } from '../../shared/selfReview';
import type { Store } from '../store';
import { HttpError, requireUser } from '../auth';
export function registerSelfReview(app: FastifyInstance, store: Store) {
  const owned = (req: FastifyRequest, id: string) => {
    const u = requireUser(req),
      a = store.get<Attempt>('attempts', id);
    if (!a || u.role !== 'student' || a.userId !== u.id) throw new HttpError(404, '未找到你的作答');
    if (a.gradingMode !== 'self' || a.status !== 'submitted' || !a.selfReview)
      throw new HttpError(403, '只有已交卷的展示练习支持自评');
    return a;
  };
  app.put<{ Params: { id: string; questionId: string } }>(
    '/api/attempts/:id/self-review/:questionId',
    (req) =>
      store.transaction(() => {
        const a = owned(req, req.params.id),
          u = requireUser(req);
        const body = z
          .object({
            expectedRevision: z.number().int().positive(),
            verdict: z.enum(['correct', 'incorrect', 'partial']),
            score: z.number().finite().nonnegative(),
            comment: z.string().max(10000),
          })
          .strict()
          .parse(req.body);
        if (a.selfReview!.revision !== body.expectedRevision)
          throw new HttpError(409, '自评已在其他页面更新，请载入最新记录');
        if (a.selfReview!.state === 'completed') throw new HttpError(409, '自评已完成，记录已锁定');
        const q = a.questions.find((q) => q.id === req.params.questionId);
        if (!q) throw new HttpError(404, '题目不属于该作答');
        const { maximum, hasManual } = selfReviewParts(a, q);
        if (!hasManual) throw new HttpError(422, '选择题的自动评分不能自行修改');
        if (!validManualScore(maximum, body.verdict, body.score))
          throw new HttpError(422, `自评分数须符合判定，人工部分满分为${maximum}分`);
        a.selfReview!.feedback[q.id] = {
          verdict: body.verdict,
          score: body.score,
          comment: body.comment.trim(),
          studentName: u.name,
          updatedAt: new Date().toISOString(),
        };
        a.grades![q.id] = selfGrade(a, q, body.score);
        a.selfReview!.revision++;
        a.updatedAt = new Date().toISOString();
        store.put('attempts', a.id, a, a.userId);
        return a;
      }),
  );
  app.post<{ Params: { id: string } }>('/api/attempts/:id/self-review/complete', (req) =>
    store.transaction(() => {
      const a = owned(req, req.params.id),
        body = z.object({ expectedRevision: z.number().int().positive() }).strict().parse(req.body);
      if (a.selfReview!.revision !== body.expectedRevision)
        throw new HttpError(409, '自评已更新，请刷新');
      if (a.selfReview!.state === 'completed') return a;
      if (a.questions.some((q) => !a.grades?.[q.id] || a.grades[q.id].pending))
        throw new HttpError(422, '请先完成所有题目自评');
      a.selfReview!.state = 'completed';
      a.selfReview!.revision++;
      a.selfReview!.completedAt = a.updatedAt = new Date().toISOString();
      store.put('attempts', a.id, a, a.userId);
      return a;
    }),
  );
}
