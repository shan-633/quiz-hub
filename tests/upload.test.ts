import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app';
let app: any, dir: string;
afterEach(async () => {
  if (app) await app.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});
async function setup() {
  dir = mkdtempSync(join(tmpdir(), 'zhixu-upload-'));
  app = await createApp({ dataDir: dir, seed: true });
  return app;
}
async function login(username = 'student') {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: {
      username,
      password:
        username === 'teacher' ? 'Teacher123!' : username === 'admin' ? 'Admin123!' : 'Student123!',
    },
  });
  return {
    cookie: r.cookies.map((c: any) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': r.json().csrfToken,
  };
}
function multipart(fields: Record<string, string>, bytes: Buffer, type = 'image/png') {
  const boundary = 'zhixu-test-boundary';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        Object.entries(fields)
          .map(
            ([k, v]) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
          )
          .join(''),
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="answer.png"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
it('照片经真实解码后保存，重复上传幂等，其他学生无法读取或引用', async () => {
  await setup();
  const headers = await login(),
    other = await login('student2');
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  const b = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: other,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  const bytes = await sharp({
    create: { width: 30, height: 30, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  const form = multipart(
    { kind: 'answer', attemptId: a.id, questionId: 'q-work', clientId: 'photo-test' },
    bytes,
  );
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { ...headers, ...form.headers },
    payload: form.payload,
  });
  expect(uploaded.statusCode).toBe(201);
  const asset = uploaded.json();
  const again = await app.inject({
    method: 'POST',
    url: '/api/uploads',
    headers: { ...headers, ...form.headers },
    payload: form.payload,
  });
  expect(again.json().id).toBe(asset.id);
  expect((await app.inject({ url: `/api/uploads/${asset.id}`, headers })).statusCode).toBe(200);
  expect((await app.inject({ url: `/api/uploads/${asset.id}`, headers: other })).statusCode).toBe(
    404,
  );
  const answer = {
    choiceIds: [],
    blankValues: {},
    markdown: '',
    drawingPages: [],
    imagePages: [{ id: 'page', assetId: asset.id, rotation: 0, name: '答案' }],
    parts: {},
    flagged: false,
  };
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/attempts/${b.id}/answers/q-work`,
        headers: other,
        payload: { data: answer, expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(422);
  const bad = multipart(
    { kind: 'answer', attemptId: a.id, questionId: 'q-work', clientId: 'fake' },
    Buffer.from('<script>alert(1)</script>'),
  );
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { ...headers, ...bad.headers },
        payload: bad.payload,
      })
    ).statusCode,
  ).toBe(422);
  const teacher = await login('teacher'),
    admin = await login('admin');
  const uploadedUrl = `/api/uploads/${asset.id}`;
  expect((await app.inject({ url: uploadedUrl, headers: teacher })).statusCode).toBe(404);
  const orphanForm = multipart(
    { kind: 'answer', attemptId: a.id, questionId: 'q-work', clientId: 'unused-photo' },
    bytes,
  );
  const orphan = (
    await app.inject({
      method: 'POST',
      url: '/api/uploads',
      headers: { ...headers, ...orphanForm.headers },
      payload: orphanForm.payload,
    })
  ).json();
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/attempts/${a.id}/answers/q-work`,
        headers,
        payload: { data: answer, expectedRevision: 0 },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers })).statusCode,
  ).toBe(200);
  expect((await app.inject({ url: uploadedUrl, headers: teacher })).statusCode).toBe(200);
  expect((await app.inject({ url: uploadedUrl, headers: admin })).statusCode).toBe(200);
  expect((await app.inject({ url: uploadedUrl, headers: other })).statusCode).toBe(404);
  expect(
    (await app.inject({ url: `/api/uploads/${orphan.id}`, headers: teacher })).statusCode,
  ).toBe(404);
});
