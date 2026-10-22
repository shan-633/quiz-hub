import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AssignmentService } from '../assignments';
import { requireTeacher, requireUser } from '../auth';
import type { Store } from '../store';
const groupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    studentIds: z.array(z.string().max(128)).max(2000),
    expectedRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export function registerAssignments(
  app: FastifyInstance,
  store: Store,
  service: AssignmentService,
) {
  app.get('/api/teacher/students', (req) => service.students(requireTeacher(req).id));
  app.get('/api/teacher/groups', (req) => service.groups(requireTeacher(req).id));
  app.post('/api/teacher/groups', (req, reply) =>
    reply.code(201).send(service.saveGroup(requireTeacher(req).id, groupSchema.parse(req.body))),
  );
  app.put<{ Params: { id: string } }>('/api/teacher/groups/:id', (req) =>
    service.saveGroup(requireTeacher(req).id, groupSchema.parse(req.body), req.params.id),
  );
  app.delete<{ Params: { id: string } }>('/api/teacher/groups/:id', (req) => {
    service.deleteGroup(
      requireTeacher(req).id,
      req.params.id,
      z.object({ expectedRevision: z.number().int().positive() }).parse(req.body).expectedRevision,
    );
    return { ok: true };
  });
  app.get('/api/teacher/assignments', (req) => service.teacherTasks(requireTeacher(req).id));
  app.get<{ Params: { id: string } }>('/api/teacher/assignments/:id', (req) =>
    service.details(requireTeacher(req).id, req.params.id),
  );
  app.post('/api/teacher/assignments', (req, reply) => {
    const body = z
      .object({
        libraryId: z.string().max(128),
        groupIds: z.array(z.string().max(128)).min(1).max(100),
        timeLimitMinutes: z.number().int().min(1).max(600).optional(),
        enforceTimeLimit: z.boolean().default(false),
        deadlineAt: z.string().datetime({ offset: true }).optional(),
        opensAt: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(req.body);
    if (body.deadlineAt) body.deadlineAt = new Date(body.deadlineAt).toISOString();
    if (body.opensAt) body.opensAt = new Date(body.opensAt).toISOString();
    return reply.code(201).send(service.push(requireTeacher(req).id, body));
  });
  app.get('/api/tasks', (req) => service.studentTasks(requireUser(req)));
}
