import type { FastifyInstance } from 'fastify';
import type { LibraryItem } from '../../shared/model';
import { publicQuestion } from '../../shared/domain';
import { z } from 'zod';
import { HttpError, requireUser, requireActiveSession } from '../auth';
import { canReadLibrary } from '../permissions';
import { isBeforeOpening } from '../../shared/availability';
import type { Store } from '../store';
import { libraryQuestions } from './library';
import { loadPrintStyles, resolvePrintImages } from '../print/resources';
import { createPdfRenderer, type PdfRenderer } from '../print/pdf';
import type { AssignmentService } from '../assignments';
export function registerPrint(
  app: FastifyInstance,
  store: Store,
  provided?: PdfRenderer,
  assignments?: AssignmentService,
) {
  const renderer = provided ?? createPdfRenderer();
  app.addHook('onClose', async () => renderer.close());
  app.post<{ Params: { id: string } }>(
    '/api/library/:id/pdf',
    { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = requireUser(req);
      const body = z
        .object({ assignmentId: z.string().max(128).optional() })
        .strict()
        .parse(req.body ?? {});
      const item = store.get<LibraryItem>('library', req.params.id);
      if (!item || item.state !== 'published' || !canReadLibrary(store, user, item))
        throw new HttpError(404, '未找到已发布的试卷或题库');
      const task =
        user.role === 'student' && body.assignmentId
          ? assignments
              ?.received(user.id)
              .find((a) => a.id === body.assignmentId && a.libraryId === item.id)
          : user.role === 'student' && item.deliveryMode !== 'showcase'
            ? assignments?.latestForLibrary(user.id, item.id)
            : undefined;
      if (body.assignmentId && (user.role !== 'student' || !task))
        throw new HttpError(404, '未找到收到的班级任务');
      if (user.role === 'student' && item.deliveryMode !== 'showcase' && !task)
        throw new HttpError(404, '请等待教师推送');
      if (user.role === 'student' && isBeforeOpening(task ? task.opensAt : item.opensAt))
        throw new HttpError(403, '尚未到开放时间，暂不能打印试题');
      const questions = (task ? task.questions : libraryQuestions(store, item)).map(publicQuestion);
      if (!questions.length) throw new HttpError(422, '这里还没有可打印的已发布题目');
      if (questions.length > 1000)
        throw new HttpError(413, '单次最多导出1000题，请将题库拆分后导出');
      const [images, styles] = await Promise.all([
        resolvePrintImages(store, questions),
        loadPrintStyles(),
      ]);
      const { renderPrintDocument } = await import('../print/PrintDocument');
      const html = renderPrintDocument({
        item: task ? { ...item, title: task.title } : item,
        questions,
        images,
        ...styles,
      });
      let result;
      try {
        result = await renderer.render(html);
      } catch (error) {
        if (error instanceof Error && error.cause) req.log.error(error.cause);
        throw error;
      }
      const safeName =
        [...(task?.title ?? item.title).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')]
          .slice(0, 90)
          .join('')
          .replace(/[. ]+$/g, '') || '物理练习';
      const currentUser = requireActiveSession(store, req);
      const current = store.get<LibraryItem>('library', req.params.id);
      if (!canReadLibrary(store, currentUser, current))
        throw new HttpError(404, '未找到可访问的试卷或题库');
      if (currentUser.role === 'student' && current?.deliveryMode !== item.deliveryMode)
        throw new HttpError(409, '内容类别已改变，请重试');
      if (currentUser.role === 'student' && isBeforeOpening(task ? task.opensAt : current?.opensAt))
        throw new HttpError(403, '尚未到开放时间，暂不能打印试题');
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
