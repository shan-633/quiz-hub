import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Attempt } from '../../shared/model';
import { selfReviewParts } from '../../shared/selfReview';
import { initialReview } from '../../shared/teacherReview';
import type { Store } from '../store';
import { HttpError, requireUser } from '../auth';
import { selfGradeSchema } from '../reviewValidation';
import {
  reviewColumns,
  columnErrors,
  columnGrade,
  columnText,
  reviewComplete,
  reviewPoints,
} from '../../shared/reviewColumns';
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
        const body = selfGradeSchema.parse(req.body);
        if (a.selfReview!.revision !== body.expectedRevision)
          throw new HttpError(409, '自评已在其他页面更新，请载入最新记录');
        if (a.selfReview!.state === 'completed') throw new HttpError(409, '自评已完成，记录已锁定');
        const q = a.questions.find((q) => q.id === req.params.questionId);
        if (!q) throw new HttpError(404, '题目不属于该作答');
        const { maximum, hasManual, columns, automatic } = selfReviewParts(a, q);
        if (!hasManual) throw new HttpError(422, '选择题的自动评分不能自行修改');
        const multi = reviewColumns(q).length > 1;
        const items =
          body.items ??
          (!multi && body.verdict !== undefined && body.score !== undefined
            ? {
                [columns[0].id]: {
                  verdict: body.verdict,
                  score: body.score,
                  comment: body.comment ?? '',
                },
              }
            : undefined);
        const errors = columnErrors(columns, items, maximum);
        if (errors.length) throw new HttpError(422, errors.join('；'));
        const normalized = Object.fromEntries(
          Object.entries(items!).map(([id, f]) => [id, { ...f, comment: f.comment.trim() }]),
        );
        const grade = columnGrade(q, columns, normalized, 'self', automatic);
        const manualScore = reviewPoints(
          Object.values(normalized).reduce((n, f) => n + f.score, 0),
        );
        a.selfReview!.feedback[q.id] = {
          verdict: manualScore === maximum ? 'correct' : manualScore > 0 ? 'partial' : 'incorrect',
          score: manualScore,
          comment: body.comment?.trim() ?? columnText(columns, normalized, 'comment'),
          studentName: u.name,
          updatedAt: new Date().toISOString(),
          ...(multi || body.items ? { items: normalized } : {}),
        };
        a.grades![q.id] = grade;
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
      // Reconcile automatic-only columns from immutable answers when the student
      // explicitly finishes an older in-progress review. Completed records stay intact.
      for (const q of a.questions) {
        if (!selfReviewParts(a, q).hasManual) {
          a.grades ??= {};
          a.grades[q.id] = initialReview([q], a.answers).grades[q.id];
        }
      }
      if (a.questions.some((q) => !reviewComplete(a, q)))
        throw new HttpError(422, '请先完成所有题目自评');
      a.selfReview!.state = 'completed';
      a.selfReview!.revision++;
      a.selfReview!.completedAt = a.updatedAt = new Date().toISOString();
      store.put('attempts', a.id, a, a.userId);
      return a;
    }),
  );
}
