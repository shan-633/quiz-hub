import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAX_IMPORT_BYTES } from '../../shared/bankImport';
import { HttpError, requireAdmin } from '../auth';
import type { Store } from '../store';
import { prepareBankImport, commitBankImport, previousBankImport } from '../import/bankImport';

async function readFile(req: FastifyRequest) {
  const fields: Record<string, string> = {};
  let bytes: Buffer | undefined;
  for await (const part of req.parts({
    limits: { fileSize: MAX_IMPORT_BYTES, files: 1, fields: 2, fieldSize: 1000, parts: 3 },
  })) {
    if (part.type === 'file') {
      if (part.fieldname !== 'file' || !part.filename.toLowerCase().endsWith('.json'))
        throw new HttpError(422, '请选择.json题库文件，上传字段名应为file');
      bytes = await part.toBuffer();
      if (part.file.truncated) throw new HttpError(413, '题库文件不能超过20 MiB');
    } else {
      if (!['digest', 'publish'].includes(part.fieldname))
        throw new HttpError(422, '未知上传字段：' + part.fieldname);
      if (Object.hasOwn(fields, part.fieldname)) throw new HttpError(422, '不能重复提交同一字段');
      fields[part.fieldname] = String(part.value);
    }
  }
  if (!bytes) throw new HttpError(422, '请选择题库文件');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new HttpError(422, '文件必须使用UTF-8编码');
  }
  return { text, fields };
}
export function registerBankImport(app: FastifyInstance, store: Store) {
  app.get<{ Params: { name: string } }>(
    '/api/admin/bank-import/files/:name',
    async (req, reply) => {
      requireAdmin(req);
      const name = req.params.name;
      if (
        ![
          'protocol-v1.md',
          'question-bank-v1.schema.json',
          'minimal.zqb.json',
          'six-types.zqb.json',
          'beijing-2022.zqb.json',
        ].includes(name)
      )
        throw new HttpError(404, '下载文件不存在');
      return reply
        .type(
          name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
        )
        .header('Content-Disposition', `attachment; filename="${name}"`)
        .header('Cache-Control', 'private, no-store')
        .send(readFileSync(resolve('content-assets/import', name)));
    },
  );
  for (const endpoint of ['validate', 'commit'])
    app.post(
      `/api/admin/bank-import/${endpoint}`,
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const user = requireAdmin(req);
        const { text, fields } = await readFile(req);
        const options = z
          .object({
            digest: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            publish: z.enum(['true', 'false']).optional(),
          })
          .strict()
          .parse(fields);
        const prepared = await prepareBankImport(text);
        if (endpoint === 'validate') {
          if (prepared.report.digest)
            prepared.report.existing = previousBankImport(store, prepared.report.digest);
          return prepared.report;
        }
        if (!prepared.report.valid)
          throw new HttpError(422, '题库文件未通过校验', { report: prepared.report });
        if (!options.digest || options.digest !== prepared.report.digest)
          throw new HttpError(409, '文件与校验结果不一致，请重新校验');
        const result = commitBankImport(store, prepared, user.id, options.publish === 'true');
        return reply.code(result.reused ? 200 : 201).send(result);
      },
    );
}
