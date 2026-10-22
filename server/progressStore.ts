import { Store, type Collection } from './store';
import type { Attempt } from '../shared/model';
import { attemptProgress, type ProgressChange, type StudentProgress } from '../shared/progress';
const snapshotSql = `SELECT p.data,p.user_id,
  json_extract(u.data,'$.name') AS name,json_extract(u.data,'$.username') AS username,
  json_extract(l.data,'$.kind') AS kind FROM attempt_progress p
  LEFT JOIN documents u ON u.collection='users' AND u.id=p.user_id
  LEFT JOIN documents l ON l.collection='library' AND l.id=p.library_id`;

export class ProgressStore extends Store {
  private pending = new Set<string>();
  private listeners = new Set<(event: ProgressChange) => void>();
  constructor(dir: string) {
    super(dir);
    this.db
      .exec(`CREATE TABLE IF NOT EXISTS attempt_progress(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,library_id TEXT NOT NULL,updated_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS attempt_progress_time ON attempt_progress(updated_at DESC,id);
      CREATE INDEX IF NOT EXISTS attempt_progress_user ON attempt_progress(user_id);
      CREATE INDEX IF NOT EXISTS attempt_progress_library ON attempt_progress(library_id);
      CREATE TABLE IF NOT EXISTS progress_schema(version INTEGER PRIMARY KEY);`);
    if (
      !this.db
        .prepare('PRAGMA table_info(attempt_progress)')
        .all()
        .some((c) => c.name === 'teacher_id')
    ) {
      this.db.exec("ALTER TABLE attempt_progress ADD COLUMN teacher_id TEXT NOT NULL DEFAULT ''");
      this.db.exec(
        "UPDATE attempt_progress SET teacher_id=COALESCE((SELECT json_extract(data,'$.teacherId') FROM documents WHERE collection='library' AND id=attempt_progress.library_id),'')",
      );
    }
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS attempt_progress_teacher ON attempt_progress(teacher_id,updated_at DESC,id)',
    );
    if (!this.db.prepare('SELECT version FROM progress_schema WHERE version=1').get()) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        // Stream active records once; historical answer JSON never enters JS memory.
        if (!this.db.prepare('SELECT version FROM progress_schema WHERE version=1').get()) {
          for (const row of this.db
            .prepare(
              "SELECT data FROM documents WHERE collection='attempts' AND json_extract(data,'$.status')='active'",
            )
            .iterate())
            this.writeProgress(JSON.parse(row.data as string));
          this.db.prepare('INSERT INTO progress_schema(version) VALUES(1)').run();
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.db.close();
        throw error;
      }
    }
  }
  private writeProgress(a: Attempt) {
    if (a.status !== 'active') {
      this.db.prepare('DELETE FROM attempt_progress WHERE id=?').run(a.id);
      return;
    }
    const data = {
      id: a.id,
      title: a.title,
      libraryId: a.libraryId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      ...attemptProgress(a),
    };
    this.db
      .prepare(
        'INSERT INTO attempt_progress(id,user_id,library_id,updated_at,data,teacher_id) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id,library_id=excluded.library_id,updated_at=excluded.updated_at,data=excluded.data,teacher_id=excluded.teacher_id',
      )
      .run(a.id, a.userId, a.libraryId, a.updatedAt, JSON.stringify(data), a.teacherId ?? '');
  }
  private rows(id?: string): StudentProgress[] {
    const statement = this.db.prepare(
      snapshotSql + (id ? ' WHERE p.id=?' : ' ORDER BY p.updated_at DESC,p.id'),
    );
    const rows = id ? statement.all(id) : statement.all();
    return rows.map((row) => ({
      ...JSON.parse(row.data as string),
      student: {
        id: row.user_id as string,
        name: (row.name as string | null) ?? '学生',
        username: (row.username as string | null) ?? '',
      },
      kind: row.kind === 'paper' ? 'paper' : 'bank',
    }));
  }
  listProgress(teacherId?: string): StudentProgress[] {
    if (!teacherId) return this.rows();
    return this.db
      .prepare(
        snapshotSql +
          ` WHERE p.teacher_id=? AND json_extract(u.data,'$.role')='student' AND COALESCE(json_extract(u.data,'$.disabled'),0)=0
      AND EXISTS(SELECT 1 FROM teaching_links t WHERE t.teacher_id=p.teacher_id AND t.student_id=p.user_id) ORDER BY p.updated_at DESC,p.id`,
      )
      .all(teacherId)
      .map((row) => ({
        ...JSON.parse(row.data as string),
        student: {
          id: row.user_id as string,
          name: (row.name as string) ?? '学生',
          username: (row.username as string) ?? '',
        },
        kind: row.kind === 'paper' ? 'paper' : 'bank',
      }));
  }
  subscribeProgress(listener: (event: ProgressChange) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  override put(collection: Collection, id: string, value: unknown, owner = ''): void {
    const tracked = ['attempts', 'users', 'library'].includes(collection);
    if (tracked && !this.db.isTransaction)
      return this.transaction(() => this.put(collection, id, value, owner));
    super.put(collection, id, value, owner);
    if (collection === 'attempts') {
      this.writeProgress(value as Attempt);
      this.pending.add(id);
    }
    if (collection === 'users' || collection === 'library') {
      const column = collection === 'users' ? 'user_id' : 'library_id';
      for (const row of this.db
        .prepare(`SELECT id FROM attempt_progress WHERE ${column}=?`)
        .all(id))
        this.pending.add(row.id as string);
    }
  }
  override delete(collection: Collection, id: string): void {
    if (collection !== 'attempts') return super.delete(collection, id);
    if (!this.db.isTransaction) return this.transaction(() => this.delete(collection, id));
    super.delete(collection, id);
    this.db.prepare('DELETE FROM attempt_progress WHERE id=?').run(id);
    this.pending.add(id);
  }
  override transaction<T>(fn: () => T): T {
    const before = new Set(this.pending);
    let result: T;
    try {
      result = super.transaction(fn);
    } catch (error) {
      this.pending = before;
      throw error;
    }
    const ids = this.pending;
    this.pending = new Set();
    if (this.listeners.size)
      for (const id of ids) {
        const row = this.rows(id)[0];
        const event: ProgressChange = row ? { type: 'upsert', row } : { type: 'remove', id };
        for (const listener of this.listeners) {
          // A disconnected observer must never turn a committed save into an error.
          try {
            listener(event);
          } catch {}
        }
      }
    return result;
  }
  override close() {
    this.listeners.clear();
    super.close();
  }
}
