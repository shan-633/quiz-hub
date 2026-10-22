import { afterEach, expect, it, vi } from 'vitest';
import { community } from './fixtures/community';
import { emptyAnswer } from '../shared/domain';
import { createApp } from '../server/app';
import { Store } from '../server/store';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.close();
});

it('答案校验期间跨过硬截止时拒绝写入，并自动提交截止前已存内容', async () => {
  const { f, s, a } = await timed(true);
  const due = Date.parse(a.dueAt);
  let now = due - 1;
  f.store.put(
    'assets',
    'timing-asset',
    {
      id: 'timing-asset',
      kind: 'answer',
      ownerId: a.userId,
      attemptId: a.id,
      questionId: 'q-force',
    },
    a.userId,
  );
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const read = Store.prototype.get;
  vi.spyOn(Store.prototype, 'get').mockImplementation(function (this: Store, collection, id) {
    if (collection === 'assets' && id === 'timing-asset') now = due + 1;
    return read.call(this, collection, id) as any;
  });
  const data = {
    ...emptyAnswer(),
    drawingPages: [
      { id: 'page', width: 800, height: 1000, strokes: [], previewAssetId: 'timing-asset' },
    ],
  };
  const save = await f.app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/q-force`,
    headers: s,
    payload: { data, expectedRevision: 0 },
  });
  expect(save.statusCode).toBe(409);
  const stored = f.store.get<any>('attempts', a.id);
  expect(stored.status).toBe('submitted');
  expect(stored.submissionReason).toBe('timeout');
  expect(stored.answers).toEqual({});
});

async function timed(enforceTimeLimit: boolean) {
  const f = await community();
  fixtures.push(f);
  const s = await f.login('student'),
    t = await f.login('teacher');
  const original = f.store.get<any>('library', 'bank-mechanics');
  const save = await f.app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/bank-mechanics',
    headers: t,
    payload: { ...original, timeLimitMinutes: 10, enforceTimeLimit },
  });
  expect(save.statusCode).toBe(200);
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/attempts',
    headers: s,
    payload: { libraryId: original.id },
  });
  expect(response.statusCode).toBe(201);
  return { f, s, t, a: response.json() };
}
function makeDue(f: any, a: any) {
  const dueAt = new Date(Date.now() - 1000).toISOString();
  f.store.put('attempts', a.id, { ...f.store.get('attempts', a.id), dueAt }, a.userId);
  f.store.db.prepare('UPDATE attempt_deadlines SET due_at=? WHERE attempt_id=?').run(dueAt, a.id);
}

it('题库可设置真实时限；硬截止无人在线自动提交、隐藏答案并拒绝后续保存', async () => {
  const { f, s, t, a } = await timed(true);
  expect(a.timeLimitMinutes).toBe(10);
  expect(a.enforceTimeLimit).toBe(true);
  expect(Date.parse(a.dueAt) - Date.parse(a.createdAt)).toBe(600000);
  const answer = { ...emptyAnswer(), choiceIds: ['b'] };
  const saved = await f.app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/q-force`,
    headers: s,
    payload: { data: answer, expectedRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  makeDue(f, a);
  await new Promise((resolve) => setTimeout(resolve, 1250));
  const stored = f.store.get<any>('attempts', a.id);
  expect(stored.status).toBe('submitted');
  expect(stored.submissionReason).toBe('timeout');
  expect(stored.answers['q-force'].data.choiceIds).toEqual(['b']);
  expect(
    (
      await f.app.inject({
        method: 'PUT',
        url: `/api/attempts/${a.id}/answers/q-force`,
        headers: s,
        payload: { data: emptyAnswer(), expectedRevision: 1 },
      })
    ).statusCode,
  ).toBe(409);
  const view = await f.app.inject({ url: `/api/attempts/${a.id}`, headers: s });
  expect(view.json().review.state).toBe('pending');
  expect(view.body).not.toContain('solution');
  const inbox = await f.app.inject({ url: '/api/teacher/attempts', headers: t });
  expect(inbox.body).toContain(a.id);
});

it('软时限到期不强制提交，允许继续保存并标记迟交', async () => {
  const { f, s, a } = await timed(false);
  expect(a.dueAt).toBeTruthy();
  makeDue(f, a);
  const saved = await f.app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/q-force`,
    headers: s,
    payload: { data: emptyAnswer(), expectedRevision: 0 },
  });
  expect(saved.statusCode).toBe(200);
  const submitted = await f.app.inject({
    method: 'POST',
    url: `/api/attempts/${a.id}/submit`,
    headers: s,
  });
  expect(submitted.json().late).toBe(true);
  expect(submitted.json().submissionReason).toBe('student');
});

it('到期后的上传入口拒绝新照片，截止入口直接核验不等待定时器', async () => {
  const { f, s, a } = await timed(true);
  makeDue(f, a);
  const boundary = 'timed-upload-boundary';
  const payload = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nanswer\r\n--${boundary}\r\nContent-Disposition: form-data; name="attemptId"\r\n\r\n${a.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="questionId"\r\n\r\nq-force\r\n--${boundary}\r\nContent-Disposition: form-data; name="clientId"\r\n\r\ntiming-check\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nnot-an-image\r\n--${boundary}--\r\n`,
  );
  const upload = await f.app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { ...s, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });
  expect(upload.statusCode).toBe(409);
  expect(f.store.get<any>('attempts', a.id).status).toBe('submitted');
});

it('重启服务补交已到期的强制答卷；非限时旧记录不被修改', async () => {
  const { f, a } = await timed(true);
  await f.app.close();
  makeDue(f, a);
  const original = f.store.list<any>('attempts').find((row: any) => row.id !== a.id);
  const reopened = await createApp({ dataDir: f.dir });
  try {
    expect(f.store.get<any>('attempts', a.id).status).toBe('submitted');
    expect(f.store.get<any>('attempts', a.id).submissionReason).toBe('timeout');
    if (original) expect(f.store.get('attempts', original.id)).toEqual(original);
  } finally {
    await reopened.close();
  }
});
