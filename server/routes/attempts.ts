import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AnswerData, Attempt, LibraryItem } from '../../shared/model';
import { answerSchema } from '../../shared/schema';
import { publicQuestion, walkBlocks } from '../../shared/domain';
import { attemptProgress } from '../../shared/progress';
import { HttpError, requireUser } from '../auth';
import { canReadLibrary, canContinue } from '../permissions';
import type { Store } from '../store';
import { libraryQuestions } from './library';
import { validateAnswerAssets } from './uploads';
import type { AssignmentService } from '../assignments';
import { expireAttempt, timingSnapshot, trackDeadline, submitAttempt } from '../attemptTiming';
import { isBeforeOpening } from '../../shared/availability';
export function registerAttempts(
  app: FastifyInstance,
  store: Store,
  assignments?: AssignmentService,
) {
  const owned = (req: FastifyRequest, id: string) => {
    const user = requireUser(req),
      a = store.get<Attempt>('attempts', id);
    if (
      !a ||
      user.role !== 'student' ||
      a.userId !== user.id ||
      (a.status === 'active' && !canContinue(store, user, a))
    )
      throw new HttpError(404, '未找到你的作答记录');
    return expireAttempt(store, a);
  };
  const view = (a: Attempt) => {
    if (a.status === 'active' || (a.review && a.review.state !== 'published')) {
      const { grades, teacherFeedback, ...safe } = a;
      return {
        ...safe,
        questions: a.questions.map(publicQuestion),
        ...(a.status === 'active' && a.dueAt ? { serverNow: new Date().toISOString() } : {}),
      };
    }
    return a;
  };
  app.get('/api/attempts', async (req) =>
    store
      .list<Attempt>('attempts', requireUser(req).id)
      .reverse()
      .map((a) => expireAttempt(store, a))
      .map(view)
      .map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        libraryId: a.libraryId,
        teacherId: a.teacherId,
        available: a.status === 'submitted' || canContinue(store, requireUser(req), a),
        repeatAvailable:
          !a.assignmentId &&
          canReadLibrary(store, requireUser(req), store.get<LibraryItem>('library', a.libraryId)),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        questionCount: a.questions.length,
        answeredCount: attemptProgress(a).answeredCount,
        earned: a.grades ? Object.values(a.grades).reduce((s, g) => s + g.earned, 0) : undefined,
        pending: a.grades ? Object.values(a.grades).some((g) => g.pending) : undefined,
        reviewState: a.review?.state,
        assignmentId: a.assignmentId,
        dueAt: a.dueAt,
        submissionReason: a.submissionReason,
        late: a.late,
      })),
  );
  app.post('/api/attempts', async (req, reply) => {
    const user = requireUser(req);
    if (user.role !== 'student') throw new HttpError(403, '只有学生可以开始作答');
    const body = z
      .object({
        libraryId: z.string().max(128),
        assignmentId: z.string().max(128).optional(),
        fresh: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.assignmentId && assignments)
      return view(assignments.start(user, body.assignmentId, body.libraryId));
    const item = store.get<LibraryItem>('library', body.libraryId);
    if (!item || item.state !== 'published' || !canReadLibrary(store, user, item))
      throw new HttpError(404, '未找到已发布的试卷或题库');
    const active = store
      .list<Attempt>('attempts', user.id)
      .reverse()
      .find((a) => a.libraryId === item.id && !a.assignmentId && a.status === 'active');
    if (active) {
      const current = expireAttempt(store, active);
      if (current.status === 'active' && (!body.fresh || current.dueAt)) return view(current);
      if (!body.fresh && current.submissionReason === 'timeout') return view(current);
    }
    if (isBeforeOpening(item.opensAt))
      throw new HttpError(403, '尚未到开放时间，请开放后再开始作答');
    const questions = libraryQuestions(store, item);
    if (!questions.length) throw new HttpError(422, '这里还没有已发布的题目');
    const now = new Date().toISOString(),
      a: Attempt = {
        id: crypto.randomUUID(),
        teacherId: item.teacherId,
        userId: user.id,
        libraryId: item.id,
        title: item.title,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        questions,
        answers: {},
        ...timingSnapshot(item, now),
      };
    store.transaction(() => {
      store.put('attempts', a.id, a, user.id);
      trackDeadline(store, a);
    });
    return reply.code(201).send(view(a));
  });
  app.get<{ Params: { id: string } }>('/api/attempts/:id', async (req) =>
    view(owned(req, req.params.id)),
  );
  app.put<{ Params: { id: string; questionId: string } }>(
    '/api/attempts/:id/answers/:questionId',
    async (req) => {
      const a = owned(req, req.params.id);
      if (a.status !== 'active') throw new HttpError(409, '该练习已经提交，不能继续修改');
      const q = a.questions.find((q) => q.id === req.params.questionId);
      if (!q) throw new HttpError(404, '题目不属于该练习');
      const body = z
        .object({ data: answerSchema, expectedRevision: z.number().int().min(0) })
        .parse(req.body);
      const current = a.answers[q.id];
      if ((current?.revision ?? 0) !== body.expectedRevision)
        throw new HttpError(409, '答案已在其他页面更新，请选择要保留的版本', {
          current: current ?? null,
        });
      const ids = new Set(q.options.map((o) => o.id));
      if (body.data.choiceIds.some((id) => !ids.has(id)))
        throw new HttpError(422, '答案中包含无效选项');
      if (Object.keys(body.data.blankValues).some((id) => !q.blanks.some((b) => b.id === id)))
        throw new HttpError(422, '答案中包含无效空格');
      const partIds = new Set(
        walkBlocks(q.content)
          .filter((b) => b.type === 'subquestion')
          .map((b) => b.id),
      );
      if (Object.keys(body.data.parts).some((id) => !partIds.has(id)))
        throw new HttpError(422, '答案中包含无效子题');
      validateAnswerAssets(store, a.userId, a.id, q.id, body.data);
      if (expireAttempt(store, a).status !== 'active')
        throw new HttpError(409, '作答时间已结束，已自动交卷');
      a.answers[q.id] = {
        data: body.data as AnswerData,
        revision: (current?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
      };
      a.updatedAt = new Date().toISOString();
      store.put('attempts', a.id, a, a.userId);
      return a.answers[q.id];
    },
  );
  app.post<{ Params: { id: string } }>('/api/attempts/:id/submit', async (req) => {
    return store.transaction(() => {
      const a = owned(req, req.params.id);
      if (a.status === 'submitted') return view(a);
      return view(submitAttempt(store, a, 'student'));
    });
  });
}
