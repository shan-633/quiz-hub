import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Question } from '../shared/model';
export type Collection =
  | 'users'
  | 'sessions'
  | 'library'
  | 'questions'
  | 'attempts'
  | 'assets'
  | 'imports'
  | 'assignments';
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(dataDir, 'uploads'), { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'zhixu.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS documents(collection TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT NOT NULL DEFAULT '',data TEXT NOT NULL,PRIMARY KEY(collection,id));
 CREATE INDEX IF NOT EXISTS documents_owner ON documents(collection,owner_id);
 CREATE TABLE IF NOT EXISTS question_versions(question_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(question_id,version)); PRAGMA user_version=1;`);
  }
  get<T>(collection: Collection, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT data FROM documents WHERE collection=? AND id=?')
      .get(collection, id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  list<T>(collection: Collection, owner?: string): T[] {
    const rows =
      owner === undefined
        ? this.db
            .prepare('SELECT data FROM documents WHERE collection=? ORDER BY rowid')
            .all(collection)
        : this.db
            .prepare('SELECT data FROM documents WHERE collection=? AND owner_id=? ORDER BY rowid')
            .all(collection, owner);
    return rows.map((r) => JSON.parse(r.data as string));
  }
  put(collection: Collection, id: string, value: unknown, owner = '') {
    this.db
      .prepare(
        'INSERT INTO documents(collection,id,owner_id,data) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data,owner_id=excluded.owner_id',
      )
      .run(collection, id, owner, JSON.stringify(value));
  }
  delete(collection: Collection, id: string) {
    this.db.prepare('DELETE FROM documents WHERE collection=? AND id=?').run(collection, id);
  }
  version(id: string, version: number): Question | undefined {
    const row = this.db
      .prepare('SELECT data FROM question_versions WHERE question_id=? AND version=?')
      .get(id, version) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }
  publish(q: Question) {
    this.db
      .prepare('INSERT INTO question_versions(question_id,version,data) VALUES(?,?,?)')
      .run(q.id, q.version, JSON.stringify(q));
  }
  versions(): Question[] {
    return this.db
      .prepare('SELECT data FROM question_versions')
      .all()
      .map((r) => JSON.parse(r.data as string));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  close() {
    this.db.close();
  }
}
export interface StoredQuestion {
  id: string;
  bankId: string;
  latestVersion: number;
  draft: Question;
  archived: boolean;
}
