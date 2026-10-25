import type { User } from '../shared/model';
import type { PresenceSnapshot, PresenceStatus } from '../shared/presence';
import { HttpError, sessionUser } from './auth';
import { linked } from './permissions';
import type { Store } from './store';

interface Lease {
  userId: string;
  sessionId: string;
  clientId: string;
  sequence: number;
  expires: number;
  offline: boolean;
  attemptId?: string;
  status: PresenceStatus;
}
export const presenceTtl = 90000;
export class PresenceService {
  private leases = new Map<string, Lease>();
  private listeners = new Set<() => void>();
  private previous = '';
  private current: PresenceSnapshot = {};
  constructor(private store: Store) {}
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private activity(userId: string, id: string, now: number): PresenceStatus | undefined {
    const row = this.store.db
      .prepare(
        `SELECT
      json_extract(a.data,'$.userId') AS user_id,json_extract(a.data,'$.teacherId') AS teacher_id,
      json_extract(a.data,'$.status') AS status,json_extract(a.data,'$.dailyDate') AS daily,
      json_extract(a.data,'$.dueAt') AS due,json_extract(a.data,'$.enforceTimeLimit') AS enforced,
      json_extract(l.data,'$.kind') AS kind FROM documents a
      LEFT JOIN documents l ON l.collection='library' AND l.id=json_extract(a.data,'$.libraryId')
      WHERE a.collection='attempts' AND a.id=?`,
      )
      .get(id);
    if (
      !row ||
      row.user_id !== userId ||
      row.status !== 'active' ||
      !row.teacher_id ||
      !linked(this.store, row.teacher_id as string, userId) ||
      (row.enforced && row.due && Date.parse(row.due as string) <= now)
    )
      return undefined;
    return row.kind === 'paper' && !row.daily ? 'examining' : 'practicing';
  }
  private states(now: number): PresenceSnapshot {
    const states: PresenceSnapshot = {};
    const rank = { offline: 0, online: 1, practicing: 2, examining: 3 };
    for (const lease of this.leases.values()) {
      if (lease.offline || lease.expires <= now) continue;
      const state = lease.status;
      if (rank[state] > rank[states[lease.userId] ?? 'offline']) states[lease.userId] = state;
    }
    return states;
  }
  snapshot(contacts: User[], now?: number): PresenceSnapshot {
    // A cached aggregate keeps each subscriber update proportional to its contacts,
    // rather than scanning every user's sessions for every recipient.
    const states = now === undefined ? this.current : this.states(now);
    return Object.fromEntries(contacts.map((u) => [u.id, states[u.id] ?? 'offline']));
  }
  update(
    user: User,
    sessionId: string,
    body: {
      clientId: string;
      sequence: number;
      attemptId?: string;
      offline?: boolean;
    },
    now = Date.now(),
  ) {
    const key = `${sessionId}:${body.clientId}`;
    const old = this.leases.get(key);
    if (old && old.sequence >= body.sequence) return;
    const activity =
      body.attemptId && !body.offline ? this.activity(user.id, body.attemptId, now) : undefined;
    if (body.attemptId && !body.offline && !activity)
      throw new HttpError(422, '只能展示自己正在作答的有效练习状态');
    if (
      !old &&
      [...this.leases.values()].filter((l) => l.userId === user.id && l.expires > now).length >= 20
    )
      throw new HttpError(429, '打开的在线页面过多，请关闭部分页面后重试');
    this.leases.set(key, {
      ...body,
      userId: user.id,
      sessionId,
      expires: now + presenceTtl,
      offline: !!body.offline,
      status: activity ?? 'online',
    });
    this.changed(now);
  }
  removeSession(id: string) {
    for (const [key, lease] of this.leases) if (lease.sessionId === id) this.leases.delete(key);
    this.changed();
  }
  sweep(now = Date.now()) {
    for (const [key, lease] of this.leases) {
      if (lease.expires <= now || sessionUser(this.store, lease.sessionId)?.id !== lease.userId)
        this.leases.delete(key);
      else
        lease.status = lease.attemptId
          ? (this.activity(lease.userId, lease.attemptId, now) ?? 'online')
          : 'online';
    }
    this.changed(now);
  }
  private changed(now = Date.now()) {
    this.current = this.states(now);
    const current = JSON.stringify(Object.entries(this.current).sort());
    if (current === this.previous) return;
    this.previous = current;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {}
    }
  }
  close() {
    this.leases.clear();
    this.listeners.clear();
  }
}
