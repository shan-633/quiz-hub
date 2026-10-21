import { Store, type Collection } from '../../server/store';
import { attemptProgress, type StudentProgress } from '../../shared/progress';
import type { Attempt, LibraryItem, User } from '../../shared/model';

export type ProgressEvent =
  { type: 'upsert'; row: StudentProgress } | { type: 'remove'; id: string };

// Experimental comparison only. Not imported by the application server.
export class SummaryStore extends Store {
  private pending: ProgressEvent[] = [];
  onProgress?: (event: ProgressEvent) => void;
  readonly backfillMs: number;
  constructor(dir: string) {
    super(dir);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS benchmark_progress(id TEXT PRIMARY KEY,status TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS benchmark_progress_status_time ON benchmark_progress(status,updated_at DESC);`);
    const start = performance.now();
    this.transaction(() => {
      for (const a of this.list<Attempt>('attempts')) this.writeSummary(a);
    });
    this.backfillMs = performance.now() - start;
  }
  private writeSummary(a: Attempt): ProgressEvent {
    const user = this.get<User>('users', a.userId);
    const row: StudentProgress = {
      id: a.id,
      title: a.title,
      libraryId: a.libraryId,
      kind: this.get<LibraryItem>('library', a.libraryId)?.kind ?? 'bank',
      student: { id: a.userId, name: user?.name ?? '学生', username: user?.username ?? '' },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      ...attemptProgress(a),
    };
    this.db
      .prepare(
        'INSERT INTO benchmark_progress(id,status,updated_at,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,data=excluded.data',
      )
      .run(a.id, a.status, a.updatedAt, JSON.stringify(row));
    return a.status === 'active' ? { type: 'upsert', row } : { type: 'remove', id: a.id };
  }
  override put(collection: Collection, id: string, value: unknown, owner = ''): void {
    if (collection !== 'attempts') return super.put(collection, id, value, owner);
    if (!this.db.isTransaction)
      return this.transaction(() => this.put(collection, id, value, owner));
    super.put(collection, id, value, owner);
    this.pending.push(this.writeSummary(value as Attempt));
  }
  override transaction<T>(fn: () => T): T {
    const start = this.pending.length;
    let result: T;
    try {
      result = super.transaction(fn);
    } catch (error) {
      this.pending.splice(start);
      throw error;
    }
    const events = this.pending.splice(start);
    for (const event of events) this.onProgress?.(event);
    return result;
  }
  listProgress(): StudentProgress[] {
    return this.db
      .prepare("SELECT data FROM benchmark_progress WHERE status='active' ORDER BY updated_at DESC")
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
}
