import type { FastifyInstance } from 'fastify';
import type { LibraryItem, Question } from '../../shared/model';
import { librarySchema } from '../../shared/schema';
import { HttpError } from '../auth';
import type { Store, StoredQuestion } from '../store';
export function libraryQuestions(store: Store, item: LibraryItem): Question[] {
  if (item.kind === 'paper')
    return (item.items ?? []).flatMap((ref) => {
      const q = store.version(ref.questionId, ref.version);
      if (!q) return [];
      const ratio = ref.score / q.score;
      q.score = ref.score;
      q.blanks = q.blanks.map((b) => ({ ...b, score: b.score * ratio }));
      const scale = (blocks: Question['content']): Question['content'] =>
        blocks.map((b) =>
          'children' in b
            ? {
                ...b,
                ...(b.type === 'subquestion' ? { score: b.score * ratio } : {}),
                children: scale(b.children),
              }
            : b,
        );
      q.content = scale(q.content);
      return [q];
    });
  return store
    .list<StoredQuestion>('questions')
    .filter((q) => q.bankId === item.id && q.latestVersion > 0 && !q.archived)
    .flatMap((q) => store.version(q.id, q.latestVersion) ?? []);
}
export function enrichLibrary(store: Store, item: LibraryItem): LibraryItem {
  const qs = libraryQuestions(store, item);
  return { ...item, questionCount: qs.length, totalScore: qs.reduce((sum, q) => sum + q.score, 0) };
}
export function registerLibrary(app: FastifyInstance, store: Store) {
  const adminItem = (item: LibraryItem): LibraryItem => {
    if (item.kind !== 'bank') return enrichLibrary(store, item);
    const questions = store
      .list<StoredQuestion>('questions')
      .filter((q) => q.bankId === item.id && !q.archived);
    return {
      ...item,
      questionCount: questions.length,
      totalScore: questions.reduce((s, q) => s + q.draft.score, 0),
    };
  };
  app.get('/api/library', async () =>
    store
      .list<LibraryItem>('library')
      .filter((b) => b.state === 'published')
      .map((b) => enrichLibrary(store, b)),
  );
  app.get<{ Params: { id: string } }>('/api/library/:id', async (req) => {
    const item = store.get<LibraryItem>('library', req.params.id);
    if (!item || item.state !== 'published') throw new HttpError(404, '未找到已发布的试卷或题库');
    return enrichLibrary(store, item);
  });
  for (const kind of ['bank', 'paper'] as const) {
    const path = kind === 'bank' ? 'banks' : 'papers';
    app.get(`/api/admin/${path}`, async () =>
      store
        .list<LibraryItem>('library')
        .filter((b) => b.kind === kind)
        .map((b) => adminItem(b)),
    );
    const save = (raw: unknown, id: string) => {
      const parsed = librarySchema.parse(raw);
      if (
        new Set((parsed.items ?? []).map((i) => i.questionId)).size !== (parsed.items ?? []).length
      )
        throw new HttpError(422, '同一份试卷不能重复引用同一道题');
      for (const ref of parsed.items ?? [])
        if (!store.version(ref.questionId, ref.version))
          throw new HttpError(422, '试卷包含尚未发布的题目');
      const item: LibraryItem = { ...parsed, id, kind, questionCount: 0, totalScore: 0 };
      if (item.state === 'published' && !libraryQuestions(store, item).length)
        throw new HttpError(422, '请先添加并发布至少一道题目');
      store.put('library', id, item);
      return adminItem(item);
    };
    app.post(`/api/admin/${path}`, async (req, reply) => {
      const result = save(req.body, crypto.randomUUID());
      return reply.code(201).send(result);
    });
    app.put<{ Params: { id: string } }>(`/api/admin/${path}/:id`, async (req) => {
      const old = store.get<LibraryItem>('library', req.params.id);
      if (!old || old.kind !== kind) throw new HttpError(404, '未找到条目');
      return save(req.body, old.id);
    });
  }
}
