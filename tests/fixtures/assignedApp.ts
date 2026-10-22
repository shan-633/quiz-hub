import { createApp as createRealApp, type AppOptions } from '../../server/app';
import { ProgressStore } from '../../server/progressStore';
import { AssignmentService } from '../../server/assignments';
import type { LibraryItem } from '../../shared/model';
import { libraryQuestions } from '../../server/routes/library';

/** Arrange genuine teacher pushes for older API tests whose focus is answering/review, not delivery. */
export function assignLibrary(store: ProgressStore, libraryId: string, fresh = false) {
  const item = store.get<LibraryItem>('library', libraryId);
  if (!item?.teacherId || item.state !== 'published' || !libraryQuestions(store, item).length)
    return;
  if (!fresh && store.list<any>('assignments', item.teacherId).some((a) => a.libraryId === item.id))
    return;
  const service = new AssignmentService(store);
  const ids = service.students(item.teacherId).map((s) => s.id);
  if (!ids.length) return;
  const group =
    service.groups(item.teacherId).find((g) => g.name === '回归测试班') ??
    service.saveGroup(item.teacherId, { name: '回归测试班', studentIds: ids });
  return service.push(item.teacherId, {
    libraryId,
    groupIds: [group.id],
    enforceTimeLimit: !!item.enforceTimeLimit,
    timeLimitMinutes: item.timeLimitMinutes,
    opensAt: item.opensAt,
  });
}
export async function createAssignedApp(options: AppOptions) {
  const app = await createRealApp(options),
    store = new ProgressStore(options.dataDir);
  try {
    for (const item of store.list<LibraryItem>('library')) assignLibrary(store, item.id);
  } finally {
    store.close();
  }
  return app;
}
export function pushFixture(dir: string, libraryId: string, fresh = false) {
  const store = new ProgressStore(dir);
  try {
    return assignLibrary(store, libraryId, fresh);
  } finally {
    store.close();
  }
}
