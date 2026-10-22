import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AnswerData, Attempt, LibraryItem } from '../../shared/model';
import { answerSchema } from '../../shared/schema';
import { publicQuestion, walkBlocks } from '../../shared/domain';
import { initialReview } from '../../shared/teacherReview';
import { attemptProgress } from '../../shared/progress';
import { HttpError, requireUser } from '../auth';
import { canReadLibrary, canContinue } from '../permissions';
import type { Store } from '../store';
import { libraryQuestions } from './library';
import { validateAnswerAssets } from './uploads';
export function registerAttempts(app: FastifyInstance, store: Store) {
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
    return a;
  };
  const view = (a: Attempt) => {
    if (a.status === 'active' || (a.review && a.review.state !== 'published')) {
      const { grades, teacherFeedback, ...safe } = a;
      return { ...safe, questions: a.questions.map(publicQuestion) };
    }
    return a;
  };
  app.get('/api/attempts', async (req) =>
    store
      .list<Attempt>('attempts', requireUser(req).id)
      .reverse()
      .map(view)
      .map((a) => ({
        id: a.id,
        title: a.title,
        status: a.status,
        libraryId: a.libraryId,
        teacherId: a.teacherId,
        available: a.status === 'submitted' || canContinue(store, requireUser(req), a),
        repeatAvailable: canReadLibrary(
          store,
          requireUser(req),
          store.get<LibraryItem>('library', a.libraryId),
        ),
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        questionCount: a.questions.length,
        answeredCount: attemptProgress(a).answeredCount,
        earned: a.grades ? Object.values(a.grades).reduce((s, g) => s + g.earned, 0) : undefined,
        pending: a.grades ? Object.values(a.grades).some((g) => g.pending) : undefined,
        reviewState: a.review?.state,
      })),
  );
  app.post('/api/attempts', async (req, reply) => {
    const user = requireUser(req);
    if (user.role !== 'student') throw new HttpError(403, '只有学生可以开始作答');
    const body = z
      .object({ libraryId: z.string().max(128), fresh: z.boolean().optional() })
      .parse(req.body);
    const item = store.get<LibraryItem>('library', body.libraryId);
    if (!item || item.state !== 'published' || !canReadLibrary(store, user, item))
      throw new HttpError(404, '未找到已发布的试卷或题库');
    const active = store
      .list<Attempt>('attempts', user.id)
      .reverse()
      .find((a) => a.libraryId === item.id && a.status === 'active');
    if (active && !body.fresh) return view(active);
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
      };
    store.put('attempts', a.id, a, user.id);
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
      a.status = 'submitted';
      a.submittedAt = a.updatedAt = new Date().toISOString();
      Object.assign(a, initialReview(a.questions, a.answers));
      store.put('attempts', a.id, a, a.userId);
      return view(a);
    });
  });
}
