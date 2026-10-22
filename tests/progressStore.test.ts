import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store';
import { ProgressStore } from '../server/progressStore';
import { emptyAnswer } from '../shared/domain';
import type { Attempt } from '../shared/model';
const resources: { store: Store; dir: string }[] = [];
const readers: Store[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const reader of readers.splice(0)) reader.close();
  for (const { store, dir } of resources.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
function legacy() {
  const dir = mkdtempSync(join(tmpdir(), 'progress-store-')),
    store = new Store(dir);
  const a: Attempt = {
    id: 'a',
    title: '练习',
    userId: 's',
    libraryId: 'b',
    status: 'active',
    createdAt: '2026-10-22',
    updatedAt: '2026-10-22',
    answers: {},
    questions: [
      {
        id: 'q',
        bankId: 'b',
        version: 1,
        type: 'calculation',
        title: '题',
        score: 4,
        difficulty: '中等',
        tags: [],
        content: [],
        blanks: [],
        options: [],
        state: 'published',
      },
    ],
  };
  store.put('users', 's', { id: 's', name: '学生', username: 'student', role: 'student' });
  store.put('attempts', a.id, a, a.userId);
  store.put('attempts', 'history', { ...a, id: 'history', status: 'submitted' }, a.userId);
  store.close();
  return { dir, a };
}
it('从旧库回填active摘要并保留原始数据，后续重开不读取作答JSON', () => {
  const { dir, a } = legacy();
  const store = new ProgressStore(dir);
  resources.push({ store, dir });
  expect(store.listProgress()).toHaveLength(1);
  expect(store.listProgress()[0]).toMatchObject({
    id: 'a',
    answeredCount: 0,
    student: { name: '学生' },
  });
  expect(store.get('attempts', 'a')).toEqual(a);
  const parse = vi.spyOn(JSON, 'parse');
  const reopened = new ProgressStore(dir);
  readers.push(reopened);
  expect(parse).not.toHaveBeenCalled();
});
it('保存/清空/交卷更新摘要，回滚不推送；提交后其他连接可读，坏订阅者不影响保存', () => {
  const { dir, a } = legacy();
  const store = new ProgressStore(dir);
  resources.push({ store, dir });
  const events: any[] = [],
    reader = new Store(dir);
  readers.push(reader);
  store.subscribeProgress((e) => {
    events.push(e);
    expect(reader.get<Attempt>('attempts', 'a')!.answers.q).toBeDefined();
  });
  expect(() =>
    store.transaction(() => {
      a.answers.q = { data: { ...emptyAnswer(), markdown: '推导' }, revision: 1, updatedAt: 'now' };
      store.put('attempts', a.id, a, a.userId);
      expect(events).toEqual([]);
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(events).toEqual([]);
  expect(store.listProgress()[0].answeredCount).toBe(0);
  store.put('attempts', a.id, a, a.userId);
  expect(events[0]).toMatchObject({ type: 'upsert', row: { answeredCount: 1, percent: 100 } });
  store.subscribeProgress(() => {
    throw new Error('subscriber');
  });
  a.answers.q.data = emptyAnswer();
  expect(() => store.put('attempts', a.id, a, a.userId)).not.toThrow();
  expect(store.listProgress()[0].answeredCount).toBe(0);
  a.status = 'submitted';
  store.put('attempts', a.id, a, a.userId);
  expect(store.listProgress()).toEqual([]);
  expect(events.at(-1)).toEqual({ type: 'remove', id: 'a' });
});
it('关联用户及题库的最新元数据，删除记录移出进度', () => {
  const { dir } = legacy();
  const store = new ProgressStore(dir);
  resources.push({ store, dir });
  store.put('users', 's', { id: 's', name: '新姓名', username: 'new', role: 'student' });
  store.put('library', 'b', { id: 'b', kind: 'paper' });
  expect(store.listProgress()[0]).toMatchObject({
    kind: 'paper',
    student: { name: '新姓名', username: 'new' },
  });
  store.delete('attempts', 'a');
  expect(store.listProgress()).toEqual([]);
});
