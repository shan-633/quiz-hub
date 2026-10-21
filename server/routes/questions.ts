import { applyQuestionTemplate } from '../../shared/questionTemplates';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { questionSchema } from '../../shared/schema';
import { newQuestion, validateQuestion, walkBlocks } from '../../shared/domain';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Asset } from './uploads';
import type { LibraryItem, Question } from '../../shared/model';
import { HttpError } from '../auth';
import type { Store, StoredQuestion } from '../store';
function checkDepth(value: unknown) {
  const queue = [{ v: value, d: 0 }];
  let count = 0;
  while (queue.length) {
    const { v, d } = queue.pop()!;
    if (d > 24 || ++count > 20000) throw new HttpError(422, '题目结构过深或过大');
    if (v && typeof v === 'object')
      for (const child of Object.values(v)) queue.push({ v: child, d: d + 1 });
  }
}
export function registerQuestions(app: FastifyInstance, store: Store) {
  const get = (id: string) => {
    const q = store.get<StoredQuestion>('questions', id);
    if (!q) throw new HttpError(404, '未找到题目');
    return q;
  };
  app.get('/api/teacher/questions', async () =>
    store
      .list<StoredQuestion>('questions')
      .map((q) => ({ ...q.draft, latestVersion: q.latestVersion, archived: q.archived })),
  );
  app.get<{ Params: { id: string } }>(
    '/api/teacher/questions/:id',
    async (req) => get(req.params.id).draft,
  );
  app.post('/api/teacher/questions', async (req, reply) => {
    const body = z
      .object({
        bankId: z.string(),
        type: z.enum(['single', 'multiple', 'fill', 'experiment', 'reading', 'calculation']),
        templateId: z.string().max(100).optional(),
      })
      .parse(req.body);
    const bank = store.get<LibraryItem>('library', body.bankId);
    if (!bank || bank.kind !== 'bank' || bank.state === 'archived')
      throw new HttpError(422, '请选择有效题库');
    const initial = newQuestion(body.type, body.bankId);
    let q: Question;
    try {
      q = applyQuestionTemplate(initial, body.templateId);
    } catch {
      throw new HttpError(422, '模板不存在或与题型不匹配');
    }
    store.put('questions', q.id, {
      id: q.id,
      bankId: q.bankId,
      latestVersion: 0,
      draft: q,
      archived: false,
    });
    return reply.code(201).send(q);
  });
  app.put<{ Params: { id: string } }>('/api/teacher/questions/:id', async (req) => {
    const old = get(req.params.id);
    checkDepth(req.body);
    const q = questionSchema.parse(req.body) as Question;
    if (
      !store.get<LibraryItem>('library', q.bankId) ||
      store.get<LibraryItem>('library', q.bankId)?.kind !== 'bank'
    )
      throw new HttpError(422, '请选择有效题库');
    q.id = old.id;
    q.version = old.latestVersion;
    q.state = q.state === 'archived' ? 'archived' : 'draft';
    store.put('questions', q.id, {
      ...old,
      bankId: q.bankId,
      draft: q,
      archived: q.state === 'archived',
    });
    return q;
  });
  app.post<{ Params: { id: string } }>('/api/teacher/questions/:id/publish', async (req) => {
    const old = get(req.params.id),
      issues = validateQuestion(old.draft);
    for (const b of walkBlocks(old.draft.content))
      if (b.type === 'image') {
        const asset = b.assetId ? store.get<Asset>('assets', b.assetId) : null;
        if (
          (b.assetId && (!asset || asset.kind !== 'question')) ||
          (b.src && !existsSync(resolve('public', b.src.slice(1))))
        )
          issues.push('题干图片不存在或不是题目资源');
      }
    if (issues.length) throw new HttpError(422, '题目尚未满足发布条件', { issues });
    const q = { ...old.draft, version: old.latestVersion + 1, state: 'published' as const };
    store.transaction(() => {
      store.publish(q);
      store.put('questions', q.id, {
        id: q.id,
        bankId: q.bankId,
        draft: q,
        latestVersion: q.version,
        archived: false,
      });
    });
    return q;
  });
}
