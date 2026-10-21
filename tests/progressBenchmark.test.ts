import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { SummaryStore } from '../scripts/benchmark/summary-store';
import type { Attempt } from '../shared/model';
import { emptyAnswer } from '../shared/domain';
import { createBenchmarkApp } from '../scripts/benchmark/app';
import { Client, sleep } from '../scripts/benchmark/transport';
import { newSession } from '../server/auth';
const resources: { store: Store; dir: string }[] = [];
afterEach(() => {
  for (const { store, dir } of resources.splice(0)) {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'progress-bench-test-'));
  const store = new SummaryStore(dir);
  resources.push({ store, dir });
  store.put('users', 's', { id: 's', name: '学生', username: 'student', role: 'student' });
  const a: Attempt = {
    id: 'a',
    title: '练习',
    userId: 's',
    libraryId: 'b',
    status: 'active',
    createdAt: '2026-10-21',
    updatedAt: '2026-10-21',
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
  return { store, a };
}
it('实验摘要随真实答案保存、清空、交卷而变化，并在重开后保留', () => {
  const { store, a } = fixture();
  store.put('attempts', a.id, a, a.userId);
  expect(store.listProgress()[0]).toMatchObject({
    id: 'a',
    answeredCount: 0,
    student: { name: '学生' },
  });
  a.answers.q = { data: { ...emptyAnswer(), markdown: '过程' }, revision: 1, updatedAt: 'now' };
  store.put('attempts', a.id, a, a.userId);
  expect(store.listProgress()[0]).toMatchObject({ answeredCount: 1, percent: 100 });
  const reopened = new SummaryStore(store.dataDir);
  expect(reopened.listProgress()[0].answeredCount).toBe(1);
  reopened.close();
  a.answers.q.data = emptyAnswer();
  store.put('attempts', a.id, a, a.userId);
  expect(store.listProgress()[0].answeredCount).toBe(0);
  a.status = 'submitted';
  store.put('attempts', a.id, a, a.userId);
  expect(store.listProgress()).toEqual([]);
});
it('答案与摘要在同一事务回滚，不能显示没有持久化的进度', () => {
  const { store, a } = fixture();
  store.put('attempts', a.id, a, a.userId);
  const observed: unknown[] = [];
  store.onProgress = (event) => observed.push(event);
  expect(() =>
    store.transaction(() => {
      a.answers.q = {
        data: { ...emptyAnswer(), markdown: '未提交事务' },
        revision: 1,
        updatedAt: 'now',
      };
      store.put('attempts', a.id, a, a.userId);
      throw new Error('rollback');
    }),
  ).toThrow('rollback');
  expect(store.get<Attempt>('attempts', a.id)!.answers).toEqual({});
  expect(store.listProgress()[0].answeredCount).toBe(0);
  expect(observed).toEqual([]);
});
it('摘要仅在事务提交后广播，订阅者可从其他连接读取已提交答案', () => {
  const { store, a } = fixture();
  store.put('attempts', a.id, a, a.userId);
  const reader = new Store(store.dataDir),
    observed: string[] = [];
  store.onProgress = () =>
    observed.push(reader.get<Attempt>('attempts', a.id)!.answers.q.data.markdown);
  try {
    store.transaction(() => {
      a.answers.q = {
        data: { ...emptyAnswer(), markdown: '提交之后才通知' },
        revision: 1,
        updatedAt: 'now',
      };
      store.put('attempts', a.id, a, a.userId);
      expect(observed).toEqual([]);
    });
    expect(observed).toEqual(['提交之后才通知']);
  } finally {
    reader.close();
  }
});
it('实验HTTP保存和清空触发SSE摘要，交卷移除；未登录和学生不能订阅', async () => {
  const { store, a } = fixture();
  store.put('attempts', a.id, a, a.userId);
  store.put('users', 't', { id: 't', username: 'teacher', name: '教师', role: 'teacher' });
  const s = newSession(store, 's'),
    t = newSession(store, 't');
  const student = { cookie: `zhixu_session=${s.token}`, 'x-csrf-token': s.csrfToken };
  const teacher = { cookie: `zhixu_session=${t.token}` };
  const { app } = await createBenchmarkApp(store.dataDir, 'optimized');
  const address = await app.listen({ port: 0, host: '127.0.0.1' }),
    client = new Client(address);
  const events: any[] = [];
  try {
    expect((await client.request('/api/teacher/progress/events', {})).status).toBe(401);
    expect((await client.request('/api/teacher/progress/events', student)).status).toBe(403);
    const close = await client.stream('/api/teacher/progress/events', teacher, (event, data) =>
      events.push({ event, data }),
    );
    const wait = async (count: number) => {
      const deadline = performance.now() + 2000;
      while (events.length < count && performance.now() < deadline) await sleep(10);
      expect(events).toHaveLength(count);
    };
    const save = async (markdown: string, revision: number) =>
      client.request('/api/attempts/a/answers/q', student, {
        data: { ...emptyAnswer(), markdown },
        expectedRevision: revision,
      });
    expect((await save('已填入', 0)).status).toBe(200);
    await wait(2);
    expect(events[1].data).toMatchObject({ type: 'upsert', row: { answeredCount: 1 } });
    expect(events[1].data.row.answers).toBeUndefined();
    expect((await save('', 1)).status).toBe(200);
    await wait(3);
    expect(events[2].data.row.answeredCount).toBe(0);
    expect(
      (await client.request('/api/attempts/a/submit', student, undefined, 'POST')).status,
    ).toBe(200);
    await wait(4);
    expect(events[3].data).toEqual({ type: 'remove', id: 'a' });
    close();
  } finally {
    client.close();
    await app.close();
  }
});
