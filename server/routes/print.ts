import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '../../shared/model';
import { publicQuestion } from '../../shared/domain';
import { z } from 'zod';
import { HttpError, requireUser, requireActiveSession } from '../auth';
import { canReadLibrary } from '../permissions';
import type { Store } from '../store';
import { libraryQuestions } from './library';
import { loadPrintStyles, resolvePrintImages } from '../print/resources';
import { createPdfRenderer, type PdfRenderer } from '../print/pdf';
export function registerPrint(app: FastifyInstance, store: Store, provided?: PdfRenderer) {
  const renderer = provided ?? createPdfRenderer();
  app.addHook('onClose', async () => renderer.close());
  app.post<{ Params: { id: string } }>(
    '/api/library/:id/pdf',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      const item = store.get<LibraryItem>('library', req.params.id);
      if (!item || item.state !== 'published' || !canReadLibrary(store, user, item))
        throw new HttpError(404, '未找到已发布的试卷或题库');
      const questions = libraryQuestions(store, item).map(publicQuestion);
      if (!questions.length) throw new HttpError(422, '这里还没有可打印的已发布题目');
      if (questions.length > 1000)
        throw new HttpError(413, '单次最多导出1000题，请将题库拆分后导出');
      const [images, styles] = await Promise.all([
        resolvePrintImages(store, questions),
        loadPrintStyles(),
      ]);
      const { renderPrintDocument } = await import('../print/PrintDocument');
      const html = renderPrintDocument({ item, questions, images, ...styles });
      let result;
      try {
        result = await renderer.render(html);
      } catch (error) {
        if (error instanceof Error && error.cause) req.log.error(error.cause);
        throw error;
      }
      const safeName =
        [...item.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')]
          .slice(0, 90)
          .join('')
          .replace(/[. ]+$/g, '') || '物理练习';
      const currentUser = requireActiveSession(store, req);
      if (!canReadLibrary(store, currentUser, store.get<LibraryItem>('library', req.params.id)))
        throw new HttpError(404, '未找到可访问的试卷或题库');
      const name = `${safeName}_阅读版_A4.pdf`,
        encoded = encodeURIComponent(name).replace(
          /[!'()*]/g,
          (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
        );
      return reply
        .type('application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="zhixu-questions.pdf"; filename*=UTF-8''${encoded}`,
        )
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-PDF-Page-Count', String(result.pages))
        .header('X-PDF-Question-Count', String(questions.length))
        .send(result.bytes);
    },
  );
}
