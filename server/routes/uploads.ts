import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import type { Attempt, LibraryItem } from '../../shared/model';
import { walkBlocks } from '../../shared/domain';
import { HttpError, requireUser, requireTeacher, requireActiveSession } from '../auth';
import type { Store } from '../store';
import { canReadLibrary, canReview, canContinue } from '../permissions';
import { libraryQuestions } from './library';
export interface Asset {
  id: string;
  ownerId: string;
  kind: 'answer' | 'question';
  attemptId?: string;
  questionId?: string;
  partId?: string;
  clientId: string;
  fileName: string;
  thumbnail: string;
  width: number;
  height: number;
  createdAt: string;
}
export function validateAnswerAssets(
  store: Store,
  userId: string,
  attemptId: string,
  questionId: string,
  data: any,
) {
  const check = (value: any, partId?: string) => {
    for (const page of value.imagePages ?? []) verify(page.assetId, partId);
    for (const page of value.drawingPages ?? [])
      if (page.previewAssetId) verify(page.previewAssetId, partId);
  };
  const verify = (id: string, partId?: string) => {
    const asset = store.get<Asset>('assets', id);
    if (
      !asset ||
      asset.kind !== 'answer' ||
      asset.ownerId !== userId ||
      asset.attemptId !== attemptId ||
      asset.questionId !== questionId ||
      asset.partId !== partId
    )
      throw new HttpError(422, '附件不属于当前用户、题目或小问');
  };
  check(data);
  for (const [id, part] of Object.entries(data.parts ?? {})) check(part, id);
}
export async function registerUploads(app: FastifyInstance, store: Store) {
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8, fieldSize: 1000 },
  });
  app.post(
    '/api/uploads',
    { config: { rateLimit: { max: 45, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req),
        file = await req.file();
      if (!file) throw new HttpError(422, '请选择一张图片');
      const fields: Record<string, string> = {};
      for (const [key, field] of Object.entries(file.fields)) {
        if (field && !Array.isArray(field) && field.type === 'field' && 'value' in field)
          fields[key] = String(field.value);
      }
      const body = z
        .object({
          kind: z.enum(['answer', 'question']),
          attemptId: z.string().max(128).optional(),
          questionId: z.string().max(128).optional(),
          partId: z.string().max(128).optional(),
          clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
        })
        .parse(fields);
      if (body.kind === 'question') requireTeacher(req);
      else {
        const a = store.get<Attempt>('attempts', body.attemptId ?? '');
        const q = a?.questions.find((q) => q.id === body.questionId);
        if (!a || !canContinue(store, user, a) || !q) throw new HttpError(404, '练习或题目不存在');
        if (a.status !== 'active') throw new HttpError(409, '作答已提交，不能继续上传');
        if (body.partId) {
          const part = walkBlocks(q.content).find(
            (b) => b.id === body.partId && b.type === 'subquestion',
          );
          if (!part || part.type !== 'subquestion' || part.responseKind !== 'open')
            throw new HttpError(422, '该小问不支持图片作答');
        } else if (q.type !== 'calculation') throw new HttpError(422, '该题不支持图片作答');
      }
      const bytes = await file.toBuffer();
      if (file.file.truncated) throw new HttpError(413, '单张图片不能超过 10MB');
      const prior = store
        .list<Asset>('assets', user.id)
        .find(
          (a) =>
            a.clientId === body.clientId &&
            a.kind === body.kind &&
            a.attemptId === body.attemptId &&
            a.questionId === body.questionId &&
            a.partId === body.partId,
        );
      if (prior)
        return reply.code(201).send({ id: prior.id, width: prior.width, height: prior.height });
      let output: Buffer, thumbnail: Buffer, metadata: Metadata;
      try {
        metadata = await sharp(bytes, { limitInputPixels: 25000000 }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
          throw new Error();
        output = await sharp(bytes, { limitInputPixels: 25000000 })
          .rotate()
          .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 92 })
          .toBuffer();
        thumbnail = await sharp(output)
          .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();
      } catch {
        throw new HttpError(
          422,
          '无法读取图片，请使用有效的 JPEG、PNG 或 WebP 图片（最高 2500 万像素）',
        );
      }
      const id = crypto.randomUUID(),
        fileName = `${id}.webp`,
        thumb = `${id}-thumb.webp`;
      requireActiveSession(store, req, body.kind === 'question' ? 'teacher' : 'student');
      if (body.kind === 'answer') {
        const current = store.get<Attempt>('attempts', body.attemptId ?? '');
        if (!current || current.status !== 'active' || !canContinue(store, user, current))
          throw new HttpError(409, '作答状态或教学关系已改变，请重新加载');
      }
      writeFileSync(join(store.dataDir, 'uploads', fileName), output);
      writeFileSync(join(store.dataDir, 'uploads', thumb), thumbnail);
      const dimensions = await sharp(output).metadata();
      const asset: Asset = {
        id,
        ownerId: user.id,
        ...body,
        fileName,
        thumbnail: thumb,
        width: dimensions.width!,
        height: dimensions.height!,
        createdAt: new Date().toISOString(),
      };
      store.put('assets', id, asset, user.id);
      return reply.code(201).send({ id, width: asset.width, height: asset.height });
    },
  );
  app.get<{ Params: { id: string }; Querystring: { thumbnail?: string } }>(
    '/api/uploads/:id',
    async (req, reply) => {
      const asset = store.get<Asset>('assets', req.params.id);
      if (!asset) throw new HttpError(404, '图片不存在');
      const user = requireUser(req);
      const hasImage = (q: Attempt['questions'][number]) =>
        walkBlocks(q.content).some((b) => b.type === 'image' && b.assetId === asset.id);
      const published =
        asset.kind === 'question' &&
        ((user.role === 'teacher' && asset.ownerId === user.id) ||
          store
            .list<LibraryItem>('library')
            .filter((item) => canReadLibrary(store, user, item) && item.state === 'published')
            .some((item) => libraryQuestions(store, item).some(hasImage)) ||
          (user.role === 'student' &&
            store
              .list<Attempt>('attempts', user.id)
              .some(
                (a) =>
                  (a.status === 'submitted' || canContinue(store, user, a)) &&
                  a.questions.some(hasImage),
              )) ||
          (user.role === 'teacher' &&
            store
              .list<Attempt>('attempts')
              .some(
                (a) =>
                  a.status === 'submitted' &&
                  canReview(store, user, a) &&
                  a.questions.some(hasImage),
              )));
      const staff = req.user?.role === 'teacher';
      const attempt =
        asset.kind === 'answer' && asset.attemptId
          ? store.get<Attempt>('attempts', asset.attemptId)
          : undefined;
      const response = attempt?.answers[asset.questionId ?? '']?.data;
      const value = asset.partId ? response?.parts[asset.partId] : response;
      const submittedAttachment =
        staff &&
        attempt?.status === 'submitted' &&
        canReview(store, user, attempt) &&
        attempt.userId === asset.ownerId &&
        attempt.questions.some((q) => q.id === asset.questionId) &&
        !!value &&
        (value.imagePages.some((p) => p.assetId === asset.id) ||
          value.drawingPages.some((p) => p.previewAssetId === asset.id));
      if (
        !published &&
        !submittedAttachment &&
        !(
          asset.kind === 'answer' &&
          attempt &&
          user.id === asset.ownerId &&
          (attempt.status === 'submitted' || canContinue(store, user, attempt))
        )
      )
        throw new HttpError(404, '图片不存在');
      const fileName = req.query.thumbnail === '1' ? asset.thumbnail : asset.fileName;
      const contentType: Record<string, string> = {
        webp: 'image/webp',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
      };
      return reply
        .type(contentType[fileName.split('.').pop() ?? ''] ?? 'application/octet-stream')
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(readFileSync(join(store.dataDir, 'uploads', fileName)));
    },
  );
}
