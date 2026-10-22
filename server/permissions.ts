import type { Attempt, LibraryItem, User } from '../shared/model';
import type { Store } from './store';

export function activeUser(store: Store, id: string, role?: User['role']): User | undefined {
  const u = store.get<User>('users', id);
  return u && !u.disabled && (!role || u.role === role) ? u : undefined;
}
export function linked(store: Store, teacherId: string, studentId: string): boolean {
  return (
    !!activeUser(store, teacherId, 'teacher') &&
    !!activeUser(store, studentId, 'student') &&
    !!store.db
      .prepare('SELECT 1 FROM teaching_links WHERE teacher_id=? AND student_id=?')
      .get(teacherId, studentId)
  );
}
export function canManageLibrary(user: User, item: LibraryItem | undefined): boolean {
  return !!item && user.role === 'teacher' && item.teacherId === user.id;
}
export function canReadLibrary(
  store: Store,
  user: User | null,
  item: LibraryItem | undefined,
): boolean {
  if (!user || !item) return false;
  if (canManageLibrary(user, item)) return true;
  return (
    user.role === 'student' &&
    item.state === 'published' &&
    !!item.teacherId &&
    linked(store, item.teacherId, user.id) &&
    (item.deliveryMode === 'showcase' ||
      !!store.db
        .prepare(
          `SELECT 1 FROM assignment_recipients r JOIN documents d ON d.collection='assignments' AND d.id=r.assignment_id WHERE r.student_id=? AND json_extract(d.data,'$.libraryId')=? AND json_extract(d.data,'$.teacherId')=? LIMIT 1`,
        )
        .get(user.id, item.id, item.teacherId))
  );
}
export function attemptTeacher(store: Store, a: Attempt): string | undefined {
  return a.teacherId ?? store.get<LibraryItem>('library', a.libraryId)?.teacherId;
}
export function canReview(store: Store, user: User, a: Attempt): boolean {
  return (
    user.role === 'teacher' &&
    a.gradingMode !== 'self' &&
    attemptTeacher(store, a) === user.id &&
    linked(store, user.id, a.userId)
  );
}
export function canContinue(store: Store, user: User, a: Attempt): boolean {
  return (
    user.role === 'student' &&
    a.userId === user.id &&
    !!attemptTeacher(store, a) &&
    linked(store, attemptTeacher(store, a)!, user.id)
  );
}
const accessListeners = new WeakMap<Store, Set<() => void>>();
export function subscribeAccess(store: Store, listener: () => void) {
  let set = accessListeners.get(store);
  if (!set) accessListeners.set(store, (set = new Set()));
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}
export function notifyAccess(store: Store) {
  for (const fn of accessListeners.get(store) ?? []) {
    try {
      fn();
    } catch {}
  }
}
