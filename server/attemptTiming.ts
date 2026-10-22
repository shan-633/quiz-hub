import type { Attempt } from '../shared/model';
import { initialReview } from '../shared/teacherReview';
import type { Store } from './store';

export function initAttemptTiming(store: Store) {
  store.db
    .exec(`CREATE TABLE IF NOT EXISTS attempt_deadlines(attempt_id TEXT PRIMARY KEY,due_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS attempt_deadlines_due ON attempt_deadlines(due_at);`);
}
export function timingSnapshot(
  rules: { timeLimitMinutes?: number; enforceTimeLimit?: boolean; deadlineAt?: string },
  start: string,
) {
  const ends = [
    rules.deadlineAt ? Date.parse(rules.deadlineAt) : Infinity,
    rules.timeLimitMinutes ? Date.parse(start) + rules.timeLimitMinutes * 60000 : Infinity,
  ];
  const due = Math.min(...ends);
  return {
    ...(rules.timeLimitMinutes ? { timeLimitMinutes: rules.timeLimitMinutes } : {}),
    ...(Number.isFinite(due)
      ? { dueAt: new Date(due).toISOString(), enforceTimeLimit: !!rules.enforceTimeLimit }
      : {}),
  };
}
export function trackDeadline(store: Store, a: Attempt) {
  if (a.status === 'active' && a.enforceTimeLimit && a.dueAt)
    store.db
      .prepare(
        'INSERT INTO attempt_deadlines VALUES(?,?) ON CONFLICT(attempt_id) DO UPDATE SET due_at=excluded.due_at',
      )
      .run(a.id, a.dueAt);
  else store.db.prepare('DELETE FROM attempt_deadlines WHERE attempt_id=?').run(a.id);
}
export function submitAttempt(
  store: Store,
  attempt: Attempt,
  reason: 'student' | 'timeout',
  now = Date.now(),
): Attempt {
  const write = () => {
    const a = store.get<Attempt>('attempts', attempt.id)!;
    if (a.status === 'submitted') {
      trackDeadline(store, a);
      return a;
    }
    a.status = 'submitted';
    a.submissionReason = reason;
    a.late = reason === 'student' && !!a.dueAt && now > Date.parse(a.dueAt);
    a.submittedAt = a.updatedAt =
      reason === 'timeout' && a.dueAt ? a.dueAt : new Date(now).toISOString();
    Object.assign(a, initialReview(a.questions, a.answers));
    store.put('attempts', a.id, a, a.userId);
    trackDeadline(store, a);
    return a;
  };
  return store.db.isTransaction ? write() : store.transaction(write);
}
export function expireAttempt(store: Store, a: Attempt, now = Date.now()): Attempt {
  return a.status === 'active' && a.enforceTimeLimit && a.dueAt && Date.parse(a.dueAt) <= now
    ? submitAttempt(store, a, 'timeout', now)
    : a;
}
export function drainDeadlines(store: Store, now = Date.now()) {
  const rows = store.db
    .prepare('SELECT attempt_id FROM attempt_deadlines WHERE due_at<=? ORDER BY due_at LIMIT 200')
    .all(new Date(now).toISOString());
  for (const row of rows) {
    const a = store.get<Attempt>('attempts', row.attempt_id as string);
    if (a) {
      const current = expireAttempt(store, a, now);
      trackDeadline(store, current);
    } else store.db.prepare('DELETE FROM attempt_deadlines WHERE attempt_id=?').run(row.attempt_id);
  }
}
export function startDeadlineWorker(store: Store, onError: (error: unknown) => void) {
  const tick = () => {
    try {
      drainDeadlines(store);
    } catch (error) {
      onError(error);
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
