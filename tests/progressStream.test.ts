import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { ProgressStore } from '../server/progressStore';
import { newSession } from '../server/auth';
import { emptyAnswer } from '../shared/domain';
import type { Attempt } from '../shared/model';
import { Client, sleep } from '../scripts/benchmark/transport';
const resources: {
  app: Awaited<ReturnType<typeof createApp>>;
  store: ProgressStore;
  client: Client;
  dir: string;
}[] = [];
afterEach(async () => {
  for (const r of resources.splice(0)) {
    r.client.close();
    await r.app.close();
    r.store.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'progress-sse-')),
    store = new ProgressStore(dir);
  const session = (id: string, role: string) => {
    store.put('users', id, { id, name: id, username: id, role });
    const s = newSession(store, id);
    return { cookie: `zhixu_session=${s.token}`, 'x-csrf-token': s.csrfToken };
  };
  const student = session('student', 'student'),
    teacher = session('teacher', 'teacher');
  const a: Attempt = {
    id: 'a',
    userId: 'student',
    libraryId: 'b',
    title: '试卷',
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
  store.put('attempts', a.id, a, a.userId);
  const app = await createApp({ dataDir: dir, seed: false, origin: 'http://client.local' });
  const address = await app.listen({ port: 0, host: '127.0.0.1' }),
    client = new Client(address);
  resources.push({ app, store, dir, client });
  const save = (markdown: string, expectedRevision: number) =>
    client.request('/api/attempts/a/answers/q', student, {
      data: { ...emptyAnswer(), markdown },
      expectedRevision,
    });
  return { app, store, client, student, teacher, address, save };
}
async function until(check: () => boolean) {
  const end = performance.now() + 3000;
  while (!check() && performance.now() < end) await sleep(10);
  expect(check()).toBe(true);
}
it('正式服务推送快照、增量、清空和交卷移除，重连校准最新状态，历史正文不进入热查询', async () => {
  const { store, client, teacher, student, save } = await setup();
  // A sentinel historical document would break the old full JSON scan.
  store.db
    .prepare(
      "INSERT INTO documents(collection,id,data) VALUES('attempts','old','broken historical body')",
    )
    .run();
  expect((await client.request('/api/teacher/progress', teacher)).status).toBe(200);
  const events: any[] = [];
  let close = await client.stream('/api/teacher/progress/events', teacher, (type, data) =>
    events.push({ type, data }),
  );
  expect(events[0]).toMatchObject({ type: 'snapshot', data: [{ id: 'a', answeredCount: 0 }] });
  expect((await save('推导', 0)).status).toBe(200);
  await until(() => events.length === 2);
  expect(events[1]).toMatchObject({
    type: 'progress',
    data: { type: 'upsert', row: { answeredCount: 1 } },
  });
  expect(JSON.stringify(events)).not.toContain('推导');
  expect((await save('', 1)).status).toBe(200);
  await until(() => events.length === 3);
  expect(events[2].data.row.answeredCount).toBe(0);
  close();
  await save('离线期间保存', 2);
  const snapshots: any[] = [];
  close = await client.stream('/api/teacher/progress/events', teacher, (type, data) => {
    if (type === 'snapshot') snapshots.push(data);
    else events.push({ type, data });
  });
  expect(snapshots[0][0].answeredCount).toBe(1);
  expect((await client.request('/api/attempts/a/submit', student, undefined, 'POST')).status).toBe(
    200,
  );
  await until(() => events.at(-1).data.type === 'remove');
  expect(events.at(-1).data).toEqual({ type: 'remove', id: 'a' });
  close();
});
it('SSE拒绝学生/匿名，保留凭据跨域响应头，退出后不再发送进度', async () => {
  const { client, student, teacher, address, save } = await setup();
  expect((await client.request('/api/teacher/progress/events', {})).status).toBe(401);
  expect((await client.request('/api/teacher/progress/events', student)).status).toBe(403);
  const controller = new AbortController();
  const cors = await fetch(address + '/api/teacher/progress/events', {
    headers: { ...teacher, origin: 'http://client.local' },
    signal: controller.signal,
  });
  expect(cors.headers.get('access-control-allow-origin')).toBe('http://client.local');
  expect(cors.headers.get('access-control-allow-credentials')).toBe('true');
  expect(cors.headers.get('content-type')).toContain('text/event-stream');
  controller.abort();
  const events: any[] = [];
  const close = await client.stream('/api/teacher/progress/events', teacher, (type, data) =>
    events.push({ type, data }),
  );
  expect((await client.request('/api/auth/logout', teacher, undefined, 'POST')).status).toBe(200);
  await save('退出之后', 0);
  await until(() => events.length > 1);
  expect(events[1].type).toBe('session-expired');
  expect(events.some((e) => e.type === 'progress')).toBe(false);
  close();
});
