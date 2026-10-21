import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';

const apps: any[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'zhixu-test-'));
  dirs.push(dir);
  const app = await createApp({ dataDir: dir, seed: true });
  apps.push(app);
  return { app, dir };
}
async function login(app: any, username = 'student') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: username === 'teacher' ? 'Teacher123!' : 'Student123!' },
  });
  expect(res.statusCode).toBe(200);
  return {
    cookie: res.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': res.json().csrfToken,
  };
}
it('教师从可复用混合实验/科普阅读模板建题，拒绝跨题型套用模板', async () => {
  const { app } = await setup();
  const headers = await login(app, 'teacher');
  const mixed = await app.inject({
    method: 'POST',
    url: '/api/teacher/questions',
    headers,
    payload: { bankId: 'bank-mechanics', type: 'experiment', templateId: 'experiment-mixed' },
  });
  expect(mixed.statusCode).toBe(201);
  expect(mixed.json().content.some((b: any) => b.responseKind === 'open')).toBe(true);
  const reading = await app.inject({
    method: 'POST',
    url: '/api/teacher/questions',
    headers,
    payload: { bankId: 'bank-mechanics', type: 'reading', templateId: 'reading-mixed' },
  });
  expect(reading.statusCode).toBe(201);
  expect(reading.json().blanks.length).toBeGreaterThan(0);
  expect(reading.json().content.some((b: any) => b.responseKind === 'open')).toBe(true);
  const invalid = await app.inject({
    method: 'POST',
    url: '/api/teacher/questions',
    headers,
    payload: { bankId: 'bank-mechanics', type: 'single', templateId: 'reading-mixed' },
  });
  expect(invalid.statusCode).toBe(422);
});
it('北京真题卷从公开目录到提交：26题无答案泄露，多选半分与阅读待评阅由服务器计算', async () => {
  const { app } = await setup();
  const library = (await app.inject({ url: '/api/library' })).json();
  const paper = library.find((x: any) => x.id === 'paper-beijing-2022-real');
  expect(paper.questionCount).toBe(26);
  expect(paper.totalScore).toBe(70);
  const headers = await login(app);
  const start = await app.inject({
    method: 'POST',
    url: '/api/attempts',
    headers,
    payload: { libraryId: paper.id },
  });
  expect(start.statusCode).toBe(201);
  const attempt = start.json();
  expect(attempt.questions).toHaveLength(26);
  expect(JSON.stringify(attempt.questions)).not.toContain('solution');
  const empty = {
    choiceIds: [],
    blankValues: {},
    markdown: '',
    drawingPages: [],
    imagePages: [],
    parts: {},
    flagged: false,
  };
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/attempts/${attempt.id}/answers/bj2022-q13`,
    headers,
    payload: { expectedRevision: 0, data: { ...empty, choiceIds: ['a'] } },
  });
  expect(saved.statusCode).toBe(200);
  const reading = attempt.questions.find((q: any) => q.type === 'reading');
  const open = reading.content.find((b: any) => b.responseKind === 'open');
  const readSaved = await app.inject({
    method: 'PUT',
    url: `/api/attempts/${attempt.id}/answers/${reading.id}`,
    headers,
    payload: {
      expectedRevision: 0,
      data: {
        ...empty,
        parts: { [open.id]: { ...empty, markdown: '选择极低温，超导状态电阻为零，减少发热。' } },
      },
    },
  });
  expect(readSaved.statusCode).toBe(200);
  const submitted = await app.inject({
    method: 'POST',
    url: `/api/attempts/${attempt.id}/submit`,
    headers,
  });
  expect(submitted.statusCode).toBe(200);
  expect(submitted.json().grades).toBeUndefined();
  const teacher = await login(app, 'teacher');
  const review = (
    await app.inject({ url: `/api/teacher/attempts/${attempt.id}`, headers: teacher })
  ).json();
  expect(review.grades['bj2022-q13'].earned).toBe(1);
  expect(review.kind).toBe('paper');
  expect(review.grades[reading.id].pending).toBe(true);
});

describe('真实 SQLite API 与权限边界', () => {
  it('匿名不能开始作答，学生不能进入管理接口', async () => {
    const { app } = await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/attempts',
          payload: { libraryId: 'bank-mechanics' },
        })
      ).statusCode,
    ).toBe(401);
    const headers = await login(app);
    expect((await app.inject({ url: '/api/teacher/banks', headers })).statusCode).toBe(403);
  });
  it('写操作需要 CSRF，跨站登录被拒绝', async () => {
    const { app } = await setup();
    const headers = await login(app);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/attempts',
          headers: { cookie: headers.cookie },
          payload: { libraryId: 'bank-mechanics' },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: 'https://untrusted.example' },
          payload: { username: 'teacher', password: 'Teacher123!' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('进行中题目不泄漏答案，旧 revision 不覆盖新答案，交卷后不可写', async () => {
    const { app } = await setup();
    const headers = await login(app);
    const started = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers,
      payload: { libraryId: 'bank-mechanics' },
    });
    expect(started.statusCode).toBe(201);
    const a = started.json();
    expect(JSON.stringify(a)).not.toContain('solution');
    const q = a.questions[0];
    const data = {
      choiceIds: ['a'],
      blankValues: {},
      markdown: '',
      drawingPages: [],
      imagePages: [],
      parts: {},
      flagged: false,
    };
    const url = `/api/attempts/${a.id}/answers/${q.id}`;
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload: { data, expectedRevision: 0 } }))
        .statusCode,
    ).toBe(200);
    const stale = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: { data: { ...data, choiceIds: ['b'] }, expectedRevision: 0 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current.data.choiceIds).toEqual(['a']);
    expect(
      (await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'PUT', url, headers, payload: { data, expectedRevision: 1 } }))
        .statusCode,
    ).toBe(409);
    const again = await app.inject({
      method: 'POST',
      url: `/api/attempts/${a.id}/submit`,
      headers,
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().status).toBe('submitted');
  });
  it('教师修改发布题目不改变已开始练习的版本', async () => {
    const { app } = await setup();
    const student = await login(app);
    const teacher = await login(app, 'teacher');
    const a = (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: student,
        payload: { libraryId: 'bank-mechanics' },
      })
    ).json();
    const before = a.questions[0];
    const q = (
      await app.inject({ url: `/api/teacher/questions/${before.id}`, headers: teacher })
    ).json();
    const updated = await app.inject({
      method: 'PUT',
      url: `/api/teacher/questions/${q.id}`,
      headers: teacher,
      payload: { ...q, title: '新版本标题' },
    });
    expect(updated.statusCode).toBe(200);
    const publish = await app.inject({
      method: 'POST',
      url: `/api/teacher/questions/${q.id}/publish`,
      headers: teacher,
    });
    expect(publish.statusCode).toBe(200);
    const old = (await app.inject({ url: `/api/attempts/${a.id}`, headers: student })).json();
    expect(old.questions[0].title).toBe(before.title);
    const fresh = (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: student,
        payload: { libraryId: 'bank-mechanics', fresh: true },
      })
    ).json();
    expect(fresh.questions[0].title).toBe('新版本标题');
  });
  it('重新打开数据库后练习和会话仍可恢复', async () => {
    const { app, dir } = await setup();
    const headers = await login(app);
    const a = (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers,
        payload: { libraryId: 'bank-mechanics' },
      })
    ).json();
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const reopened = await createApp({ dataDir: dir, seed: true });
    apps.push(reopened);
    const restored = await reopened.inject({ url: `/api/attempts/${a.id}`, headers });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().id).toBe(a.id);
  });
  it('无效题目可以存草稿但不能发布', async () => {
    const { app } = await setup();
    const headers = await login(app, 'teacher');
    const created = await app.inject({
      method: 'POST',
      url: '/api/teacher/questions',
      headers,
      payload: { bankId: 'bank-mechanics', type: 'single' },
    });
    expect(created.statusCode).toBe(201);
    const res = await app.inject({
      method: 'POST',
      url: `/api/teacher/questions/${created.json().id}/publish`,
      headers,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().issues.length).toBeGreaterThan(0);
  });
});
