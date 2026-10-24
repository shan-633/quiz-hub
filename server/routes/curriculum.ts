import type { FastifyInstance } from 'fastify';
import type { Store } from '../store';
import { requireUser, HttpError } from '../auth';
import { directionsSchema, type LearningDirections } from '../../shared/curriculum';
import { uniqueCurricula } from '../../shared/curriculum';
import { canReadLibrary, canManageLibrary, canReview, linked } from '../permissions';
import type { Attempt, LibraryItem } from '../../shared/model';

export function registerCurriculum(app: FastifyInstance, store: Store) {
  const current = (id: string): LearningDirections =>
    store.get('learning_directions', id) ?? { id, revision: 0, directions: [] };
  app.get('/api/account/directions', async (req) => {
    const user = requireUser(req);
    // Only project classification/ownership; answer payloads never enter this lookup.
    const history = store.db
      .prepare(
        `SELECT json_extract(data,'$.curriculum') AS curriculum,
      json_extract(data,'$.teacherId') AS teacherId, json_extract(data,'$.userId') AS userId,
      json_extract(data,'$.gradingMode') AS gradingMode FROM documents
      WHERE collection='attempts' AND (owner_id=? OR json_extract(data,'$.teacherId')=?)`,
      )
      .all(user.id, user.role === 'teacher' ? user.id : '')
      .filter((row) => row.userId === user.id || canReview(store, user, row as unknown as Attempt));
    const tasks = store.db
      .prepare(
        `SELECT json_extract(d.data,'$.curriculum') AS curriculum,
      json_extract(d.data,'$.libraryId') AS libraryId, json_extract(d.data,'$.teacherId') AS teacherId
      FROM documents d WHERE collection='assignments' AND (owner_id=? OR EXISTS
      (SELECT 1 FROM assignment_recipients r WHERE r.assignment_id=d.id AND r.student_id=?))`,
      )
      .all(user.role === 'teacher' ? user.id : '', user.id)
      .filter(
        (row) =>
          (user.role === 'teacher' && row.teacherId === user.id) ||
          (user.role === 'student' && linked(store, row.teacherId as string, user.id)),
      );
    const frozen = [...history, ...tasks].map((row) => ({
      curriculum: row.curriculum ? JSON.parse(row.curriculum as string) : undefined,
    }));
    return {
      ...current(user.id),
      available: uniqueCurricula([
        ...store
          .list<LibraryItem>('library')
          .filter(
            (item) =>
              canManageLibrary(user, item) ||
              (item.state === 'published' && canReadLibrary(store, user, item)),
          ),
        ...frozen,
      ]),
    };
  });
  app.put('/api/account/directions', async (req) => {
    const user = requireUser(req),
      input = directionsSchema.parse(req.body);
    return store.transaction(() => {
      const old = current(user.id);
      if (old.revision !== input.expectedRevision)
        throw new HttpError(409, '方向已在其他页面更新，请刷新后重试');
      const next = { id: user.id, revision: old.revision + 1, directions: input.directions };
      store.put('learning_directions', user.id, next, user.id);
      return next;
    });
  });
}
