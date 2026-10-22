import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { deflateSync } from 'node:zlib';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { prepareBankImport, commitBankImport } from '../server/import/bankImport';

let app: Awaited<ReturnType<typeof createApp>>, dir: string, store: Store;
let teacher: Record<string, string>, student: Record<string, string>;
let serial = 0;
const input = (): any => ({
  format: 'zhixu.question-bank',
  version: '1.0',
  bank: { title: '协议 API 验收 ' + ++serial },
  assets: [],
  questions: [
    {
      id: 'q1',
      type: 'single',
      title: '单位',
      score: 2,
      content: [{ id: 'p', type: 'paragraph', text: '力的单位？' }],
      options: [
        { id: 'a', text: '牛顿' },
        { id: 'b', text: '焦耳' },
      ],
      solution: { choices: ['a'], explanation: '力的单位为牛顿。' },
    },
  ],
});
const imageInput = () => {
  const file = input(),
    bytes = readFileSync('content-assets/beijing-2022/fig-13.webp');
  file.assets = [{ id: 'original', mimeType: 'image/webp', data: bytes.toString('base64') }];
  file.questions[0].content.push({
    id: 'image',
    type: 'image',
    assetId: 'original',
    alt: '原温度计截图',
  });
  return { file, bytes };
};
async function login(username: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password: username === 'teacher' ? 'Teacher123!' : 'Student123!' },
  });
  expect(r.statusCode).toBe(200);
  return {
    cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    'x-csrf-token': r.json().csrfToken,
  };
}
function upload(
  endpoint: string,
  text: string,
  fields: Record<string, string> = {},
  headers = teacher,
) {
  const boundary = 'zhixu-test-boundary';
  const pieces = Object.entries(fields).map(
    ([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
  );
  pieces.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bank.zqb.json"\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`,
  );
  return app.inject({
    method: 'POST',
    url: '/api/teacher/bank-import/' + endpoint,
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(pieces.join('')),
  });
}
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'zhixu-import-'));
  app = await createApp({ dataDir: dir });
  store = new Store(dir);
  teacher = await login('teacher');
  student = await login('student');
});
afterAll(async () => {
  store.close();
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

it('校验真实图片且完整预览，不创建数据库记录、版本或附件', async () => {
  const { file } = imageInput(),
    before = store.list('library').length,
    files = readdirSync(join(dir, 'uploads'));
  const r = await upload('validate', JSON.stringify(file));
  expect(r.statusCode).toBe(200);
  expect(r.json().valid).toBe(true);
  expect(r.json().summary).toMatchObject({ questionCount: 1, imageCount: 1, totalScore: 2 });
  expect(r.json().preview.questions[0].solution.choices).toEqual(['a']);
  expect(r.json().preview.assetSources.original).toMatch(/^data:image\/webp;base64,/);
  expect(store.list('library')).toHaveLength(before);
  expect(readdirSync(join(dir, 'uploads'))).toEqual(files);
});
it('学生不能校验或导入，教师提交仍必须通过CSRF校验', async () => {
  expect((await upload('validate', JSON.stringify(input()), {}, student)).statusCode).toBe(403);
  expect((await upload('commit', JSON.stringify(input()), {}, student)).statusCode).toBe(403);
  expect(
    (await upload('validate', JSON.stringify(input()), {}, { cookie: teacher.cookie })).statusCode,
  ).toBe(403);
});
it('带答案的协议示例仅教师可下载，不在公开静态目录暴露', async () => {
  const url = '/api/teacher/bank-import/files/beijing-2022.zqb.json';
  expect((await app.inject({ url })).statusCode).toBe(401);
  expect((await app.inject({ url, headers: student })).statusCode).toBe(403);
  const r = await app.inject({ url, headers: teacher });
  expect(r.statusCode).toBe(200);
  expect(r.json().questions).toHaveLength(26);
  expect(r.headers['content-disposition']).toContain('attachment');
  expect(fs.existsSync('public/import/beijing-2022.zqb.json')).toBe(false);
});
it('不信任文件格式、MIME、Base64或损坏图片，错误文件不能部分入库', async () => {
  const { file } = imageInput(),
    before = store.list('library').length,
    files = readdirSync(join(dir, 'uploads'));
  for (const data of ['%%%bad-base64', Buffer.from('not an image').toString('base64')]) {
    file.assets[0].data = data;
    const r = await upload('validate', JSON.stringify(file));
    expect(r.statusCode).toBe(200);
    expect(r.json().valid).toBe(false);
    expect(r.json().errors[0].path).toContain('assets[0]');
  }
  const mismatch = imageInput().file;
  mismatch.assets[0].mimeType = 'image/png';
  expect((await upload('validate', JSON.stringify(mismatch))).json().valid).toBe(false);
  const r = await upload('commit', JSON.stringify(file), { digest: '0'.repeat(64) });
  expect(r.statusCode).toBe(422);
  expect(store.list('library')).toHaveLength(before);
  expect(readdirSync(join(dir, 'uploads'))).toEqual(files);
});
it('默认草稿导入，ID重新分配，原图字节完整保存，重试与并发提交只创建一个题库', async () => {
  const { file, bytes } = imageInput(),
    text = JSON.stringify(file),
    valid = (await upload('validate', text)).json();
  const results = await Promise.all([
    upload('commit', text, { digest: valid.digest }),
    upload('commit', text, { digest: valid.digest }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
  const imported = results[0].json();
  expect(results[1].json().bankId).toBe(imported.bankId);
  const bank: any = store.get('library', imported.bankId);
  expect(bank.state).toBe('draft');
  const q: any = store.list<any>('questions').find((q) => q.bankId === bank.id);
  expect(q.id).not.toBe('q1');
  expect(q.latestVersion).toBe(0);
  const asset: any = store.get('assets', q.draft.content[1].assetId);
  expect(readFileSync(join(dir, 'uploads', asset.fileName))).toEqual(bytes);
  expect(q.draft.content[1].intrinsicWidth).toBeGreaterThan(0);
  expect(
    (await app.inject({ url: '/api/library' })).json().some((b: any) => b.id === bank.id),
  ).toBe(false);
  expect(
    (await app.inject({ url: '/api/teacher/banks', headers: teacher }))
      .json()
      .find((b: any) => b.id === bank.id).questionCount,
  ).toBe(1);
  const again = (await upload('validate', text)).json();
  expect(again.existing.bankId).toBe(bank.id);
  expect(again.digest).toBe(createHash('sha256').update(text).digest('hex'));
});
it('发布选项创建不可变v1且学生作答不获得标准答案；提交内容变化必须重新校验', async () => {
  const file = input(),
    text = JSON.stringify(file),
    valid = (await upload('validate', text)).json();
  expect(
    (await upload('commit', text, { digest: '0'.repeat(64), publish: 'true' })).statusCode,
  ).toBe(409);
  const r = await upload('commit', text, { digest: valid.digest, publish: 'true' });
  expect(r.statusCode).toBe(201);
  const started = await app.inject({
    method: 'POST',
    url: '/api/attempts',
    headers: student,
    payload: { libraryId: r.json().bankId },
  });
  expect(started.statusCode).toBe(201);
  expect(started.json().questions[0].version).toBe(1);
  expect(JSON.stringify(started.json().questions)).not.toContain('solution');
});
it('数据库写入失败时回滚所有库、题、图片元数据和本次附件', async () => {
  const { file } = imageInput(),
    prepared = await prepareBankImport(JSON.stringify(file));
  const count = store.list('library').length,
    assets = store.list('assets').length,
    versions = store.versions().length,
    files = readdirSync(join(dir, 'uploads'));
  const original = store.put.bind(store);
  const spy = vi.spyOn(store, 'put').mockImplementation((collection, ...args) => {
    if (collection === 'questions') throw new Error('injected database failure');
    return original(collection, ...args);
  });
  try {
    expect(() => commitBankImport(store, prepared, 'user-teacher', true)).toThrow(
      'injected database failure',
    );
  } finally {
    spy.mockRestore();
  }
  expect(store.list('library')).toHaveLength(count);
  expect(store.list('assets')).toHaveLength(assets);
  expect(store.versions()).toHaveLength(versions);
  expect(readdirSync(join(dir, 'uploads'))).toEqual(files);
});
it('原始PNG/JPEG以正确Content-Type返回，EXIF旋转图预留显示后的宽高', async () => {
  for (const format of ['png', 'jpeg'] as const) {
    const { file } = imageInput();
    const image = sharp({ create: { width: 12, height: 8, channels: 3, background: 'white' } });
    const bytes =
      format === 'jpeg'
        ? await image.jpeg().withMetadata({ orientation: 6 }).toBuffer()
        : await image.png().toBuffer();
    file.assets[0] = {
      id: 'original',
      mimeType: 'image/' + format,
      data: bytes.toString('base64'),
    };
    const text = JSON.stringify(file),
      valid = (await upload('validate', text)).json();
    expect(valid.valid).toBe(true);
    const result = (await upload('commit', text, { digest: valid.digest, publish: 'true' })).json();
    const q = store.list<any>('questions').find((q) => q.bankId === result.bankId).draft;
    const response = await app.inject({
      url: '/api/uploads/' + q.content[1].assetId,
      headers: teacher,
    });
    expect(response.headers['content-type']).toBe('image/' + format);
    expect(response.rawPayload).toEqual(bytes);
    expect(q.content[1].intrinsicWidth).toBe(format === 'jpeg' ? 8 : 12);
    expect(q.content[1].intrinsicHeight).toBe(format === 'jpeg' ? 12 : 8);
  }
});
it('导入允许的深层图文结构仍可在原编辑器保存', async () => {
  const file = input();
  let content = file.questions[0].content[0];
  for (let i = 0; i < 9; i++)
    content = { id: 'group' + i, type: 'group', layout: 'stack', children: [content] };
  file.questions[0].content = [content];
  const prepared = await prepareBankImport(JSON.stringify(file));
  expect(prepared.report.valid).toBe(true);
  const result = commitBankImport(store, prepared, 'user-teacher');
  const q = store.list<any>('questions').find((q) => q.bankId === result.bankId).draft;
  const response = await app.inject({
    method: 'PUT',
    url: '/api/teacher/questions/' + q.id,
    headers: teacher,
    payload: q,
  });
  expect(response.statusCode).toBe(200);
});
it('拒绝Sharp未报告页数的真实APNG动画，不允许绕过静态图片协议', async () => {
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const v of b) {
      c ^= v;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, b: Buffer) => {
    const name = Buffer.from(type),
      len = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    len.writeUInt32BE(b.length);
    tail.writeUInt32BE(crc(Buffer.concat([name, b])));
    return Buffer.concat([len, name, b, tail]);
  };
  const u32 = (...values: number[]) => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((n, i) => b.writeUInt32BE(n, i * 4));
    return b;
  };
  const control = (n: number) =>
    Buffer.concat([u32(n, 1, 1, 0, 0), Buffer.from([0, 1, 0, 10, 0, 0])]);
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', Buffer.concat([u32(1, 1), Buffer.from([8, 6, 0, 0, 0])])),
    chunk('acTL', u32(2, 0)),
    chunk('fcTL', control(0)),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    chunk('fcTL', control(1)),
    chunk('fdAT', Buffer.concat([u32(2), deflateSync(Buffer.from([0, 0, 255, 0, 255]))])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  expect((await sharp(bytes).metadata()).format).toBe('png');
  const { file } = imageInput();
  file.assets[0] = { id: 'original', mimeType: 'image/png', data: bytes.toString('base64') };
  const report = (await prepareBankImport(JSON.stringify(file))).report;
  expect(report.valid).toBe(false);
  expect(report.errors[0].message).toMatch(/动画/);
});
it('磁盘部分写入后失败，也清理本次已创建的当前文件', async () => {
  const { file } = imageInput(),
    prepared = await prepareBankImport(JSON.stringify(file)),
    files = readdirSync(join(dir, 'uploads')),
    count = store.list('library').length;
  const original = fs.writeFileSync;
  fs.writeFileSync = ((path: any, data: any, options: any) => {
    original(path, data.subarray(0, 1), options);
    throw Object.assign(new Error('mock partial write ENOSPC'), { code: 'ENOSPC' });
  }) as typeof original;
  syncBuiltinESMExports();
  try {
    expect(() => commitBankImport(store, prepared, 'user-teacher')).toThrow('ENOSPC');
  } finally {
    fs.writeFileSync = original;
    syncBuiltinESMExports();
  }
  expect(store.list('library')).toHaveLength(count);
  expect(readdirSync(join(dir, 'uploads'))).toEqual(files);
});
