import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Attempt, LibraryItem, User } from '../../shared/model';
import { initialReview } from '../../shared/teacherReview';
import { attemptProgress, type StudentProgress } from '../../shared/progress';
import { HttpError, requireTeacher } from '../auth';
import type { Store } from '../store';

export function registerTeacher(app: FastifyInstance, store: Store) {
  const submitted = (id: string) => {
    const a = store.get<Attempt>('attempts', id);
    if (!a || a.status !== 'submitted') throw new HttpError(404, '未找到已交卷记录');
    return a;
  };
  const detail = (a: Attempt) => ({
    ...a,
    student: (() => {
      const u = store.get<User>('users', a.userId);
      return { id: a.userId, name: u?.name ?? '学生', username: u?.username ?? '' };
    })(),
    kind: store.get<LibraryItem>('library', a.libraryId)?.kind ?? 'bank',
  });
  const checkRevision = (a: Attempt, revision: number) => {
    if ((a.review?.revision ?? 0) !== revision)
      throw new HttpError(409, '批改已在其他页面更新。你的输入仍保留，请载入最新版本后核对。');
  };
  const revisionSchema = z.object({ expectedRevision: z.number().int().min(0) });
  app.get('/api/teacher/progress', async (req, reply): Promise<StudentProgress[]> => {
    requireTeacher(req);
    reply.header('Cache-Control', 'no-store');
    return store
      .list<Attempt>('attempts')
      .filter((a) => a.status === 'active')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => {
        const { student, kind } = detail(a);
        return {
          id: a.id,
          title: a.title,
          libraryId: a.libraryId,
          kind,
          student,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          ...attemptProgress(a),
        };
      });
  });
  app.get('/api/teacher/attempts', async (req) => {
    requireTeacher(req);
    return store
      .list<Attempt>('attempts')
      .filter((a) => a.status === 'submitted')
      .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt))
      .map((a) => {
        const { student, kind } = detail(a),
          grades = Object.values(a.grades ?? {});
        return {
          id: a.id,
          title: a.title,
          libraryId: a.libraryId,
          kind,
          student,
          submittedAt: a.submittedAt ?? a.updatedAt,
          reviewState: a.review?.state ?? 'legacy',
          questionCount: a.questions.length,
          finalizedCount: grades.filter((g) => !g.pending).length,
          autoCount: a.review?.autoCount ?? 0,
          autoReason: a.review?.autoReason,
          earned: grades.reduce((s, g) => s + g.earned, 0),
          total: a.questions.reduce((s, q) => s + q.score, 0),
        };
      });
  });
  app.get<{ Params: { id: string } }>('/api/teacher/attempts/:id', async (req) => {
    requireTeacher(req);
    return detail(submitted(req.params.id));
  });
  app.post<{ Params: { id: string } }>('/api/teacher/attempts/:id/start', async (req) => {
    requireTeacher(req);
    const body = revisionSchema.parse(req.body);
    return store.transaction(() => {
      const a = submitted(req.params.id);
      checkRevision(a, body.expectedRevision);
      if (a.review) throw new HttpError(409, '该答卷已进入批改流程');
      Object.assign(a, initialReview(a.questions, a.answers));
      a.updatedAt = new Date().toISOString();
      store.put('attempts', a.id, a, a.userId);
      return detail(a);
    });
  });
  app.put<{ Params: { id: string; questionId: string } }>(
    '/api/teacher/attempts/:id/grades/:questionId',
    async (req) => {
      const user = requireTeacher(req);
      const body = z
        .object({
          expectedRevision: z.number().int().min(1),
          verdict: z.enum(['correct', 'incorrect', 'partial']),
          score: z.number().finite().nonnegative(),
          correctAnswer: z.string().max(20000),
          comment: z.string().max(10000),
        })
        .parse(req.body);
      return store.transaction(() => {
        const a = submitted(req.params.id);
        checkRevision(a, body.expectedRevision);
        if (!a.review || a.review.state === 'published')
          throw new HttpError(409, '请先发起复核，已发布的批改不能修改');
        const q = a.questions.find((q) => q.id === req.params.questionId);
        if (!q) throw new HttpError(404, '题目不属于该答卷');
        if (
          body.score > q.score ||
          (body.verdict === 'correct' && body.score !== q.score) ||
          (body.verdict === 'incorrect' && body.score !== 0) ||
          (body.verdict === 'partial' && (body.score <= 0 || body.score >= q.score))
        )
          throw new HttpError(422, '正确应为满分，错误应为 0 分，部分正确应在 0 与满分之间');
        const now = new Date().toISOString();
        a.teacherFeedback ??= {};
        a.teacherFeedback[q.id] = {
          verdict: body.verdict,
          score: body.score,
          correctAnswer: body.correctAnswer.trim(),
          comment: body.comment.trim(),
          teacherId: user.id,
          teacherName: user.name,
          updatedAt: now,
        };
        a.grades ??= {};
        a.grades[q.id] = {
          earned: body.score,
          max: q.score,
          pending: false,
          status: body.verdict,
          source: 'teacher',
          details: { teacher: { earned: body.score, max: q.score, pending: false } },
        };
        a.review.state = 'in_progress';
        a.review.revision++;
        a.updatedAt = now;
        store.put('attempts', a.id, a, a.userId);
        return detail(a);
      });
    },
  );
  app.post<{ Params: { id: string } }>('/api/teacher/attempts/:id/publish', async (req) => {
    const user = requireTeacher(req),
      body = revisionSchema.parse(req.body);
    return store.transaction(() => {
      const a = submitted(req.params.id);
      checkRevision(a, body.expectedRevision);
      if (a.review?.state === 'published') return detail(a);
      if (!a.review || a.questions.some((q) => !a.grades?.[q.id] || a.grades[q.id].pending))
        throw new HttpError(422, '还有题目待批改，全部完成后才能发布');
      a.review.state = 'published';
      a.review.revision++;
      a.review.publishedAt = a.updatedAt = new Date().toISOString();
      a.review.publishedBy = user.name;
      store.put('attempts', a.id, a, a.userId);
      return detail(a);
    });
  });
}
