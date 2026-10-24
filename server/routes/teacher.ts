import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Attempt, LibraryItem, User } from '../../shared/model';
import { initialReview } from '../../shared/teacherReview';
import { attemptProgress, type StudentProgress } from '../../shared/progress';
import { HttpError, requireTeacher } from '../auth';
import type { Store } from '../store';
import { canReview } from '../permissions';
import {
  reviewColumns,
  columnErrors,
  columnGrade,
  columnText,
  reviewComplete,
} from '../../shared/reviewColumns';
import { teacherGradeSchema } from '../reviewValidation';
import { curriculumOf } from '../../shared/curriculum';

export function registerTeacher(
  app: FastifyInstance,
  store: Store,
  progressSnapshot?: (teacherId: string) => StudentProgress[],
) {
  const submitted = (id: string, user: User) => {
    const a = store.get<Attempt>('attempts', id);
    if (!a || a.status !== 'submitted' || !canReview(store, user, a))
      throw new HttpError(404, '未找到已交卷记录');
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
    const teacher = requireTeacher(req);
    reply.header('Cache-Control', 'no-store');
    if (progressSnapshot) return progressSnapshot(teacher.id);
    return store
      .list<Attempt>('attempts')
      .filter((a) => a.status === 'active' && canReview(store, teacher, a))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => {
        const { student, kind } = detail(a);
        return {
          id: a.id,
          title: a.title,
          libraryId: a.libraryId,
          curriculum: curriculumOf(a),
          kind,
          student,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          ...attemptProgress(a),
        };
      });
  });
  app.get('/api/teacher/attempts', async (req) => {
    const teacher = requireTeacher(req);
    return store
      .list<Attempt>('attempts')
      .filter((a) => a.status === 'submitted' && canReview(store, teacher, a))
      .sort((a, b) => (b.submittedAt ?? b.updatedAt).localeCompare(a.submittedAt ?? a.updatedAt))
      .map((a) => {
        const { student, kind } = detail(a),
          grades = Object.values(a.grades ?? {});
        return {
          id: a.id,
          title: a.title,
          libraryId: a.libraryId,
          curriculum: curriculumOf(a),
          kind,
          student,
          submittedAt: a.submittedAt ?? a.updatedAt,
          reviewState: a.review?.state ?? 'legacy',
          questionCount: a.questions.length,
          finalizedCount: a.questions.filter((q) => reviewComplete(a, q)).length,
          autoCount: a.review?.autoCount ?? 0,
          autoReason: a.review?.autoReason,
          earned: grades.reduce((s, g) => s + g.earned, 0),
          total: a.questions.reduce((s, q) => s + q.score, 0),
        };
      });
  });
  app.get<{ Params: { id: string } }>('/api/teacher/attempts/:id', async (req) => {
    requireTeacher(req);
    return detail(submitted(req.params.id, requireTeacher(req)));
  });
  app.post<{ Params: { id: string } }>('/api/teacher/attempts/:id/start', async (req) => {
    requireTeacher(req);
    const body = revisionSchema.parse(req.body);
    return store.transaction(() => {
      const a = submitted(req.params.id, requireTeacher(req));
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
      const body = teacherGradeSchema.parse(req.body);
      return store.transaction(() => {
        const a = submitted(req.params.id, user);
        checkRevision(a, body.expectedRevision);
        if (!a.review || a.review.state === 'published')
          throw new HttpError(409, '请先发起复核，已发布的批改不能修改');
        const q = a.questions.find((q) => q.id === req.params.questionId);
        if (!q) throw new HttpError(404, '题目不属于该答卷');
        const defaults = reviewColumns(q);
        const rubric = body.rubric ?? a.teacherFeedback?.[q.id]?.rubric;
        if (
          rubric &&
          (q.type === 'single' ||
            q.type === 'multiple' ||
            (defaults.length > 1 &&
              (rubric.length !== defaults.length ||
                defaults.some((c) => !rubric.some((r) => r.id === c.id)))))
        )
          throw new HttpError(422, '结构化多空、小问和选择题不能用自定义栏目替换');
        const columns = reviewColumns(q, rubric);
        const items =
          body.items ??
          (columns.length === 1 && body.verdict !== undefined && body.score !== undefined
            ? {
                [columns[0].id]: {
                  verdict: body.verdict,
                  score: body.score,
                  correctAnswer: body.correctAnswer ?? '',
                  comment: body.comment ?? '',
                },
              }
            : undefined);
        const errors = columnErrors(columns, items, q.score);
        if (errors.length)
          throw new HttpError(422, errors.join('；'), {
            missingItems: columns.filter((c) => !items?.[c.id]?.verdict).map((c) => c.id),
          });
        const normalized = Object.fromEntries(
          Object.entries(items!).map(([id, f]) => [
            id,
            {
              ...f,
              correctAnswer: f.correctAnswer?.trim() ?? '',
              comment: f.comment.trim(),
            },
          ]),
        );
        const grade = columnGrade(q, columns, normalized, 'teacher');
        const now = new Date().toISOString();
        a.teacherFeedback ??= {};
        a.teacherFeedback[q.id] = {
          verdict: grade.status as 'correct' | 'incorrect' | 'partial',
          score: grade.earned,
          correctAnswer:
            body.correctAnswer?.trim() ?? columnText(columns, normalized, 'correctAnswer'),
          comment: body.comment?.trim() ?? columnText(columns, normalized, 'comment'),
          teacherId: user.id,
          teacherName: user.name,
          updatedAt: now,
          ...(columns.length > 1 || body.items ? { items: normalized } : {}),
          ...(rubric ? { rubric } : {}),
        };
        a.grades ??= {};
        a.grades[q.id] = grade;
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
      const a = submitted(req.params.id, user);
      checkRevision(a, body.expectedRevision);
      if (a.review?.state === 'published') return detail(a);
      if (!a.review || a.questions.some((q) => !reviewComplete(a, q)))
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
