import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { ProgressStore } from '../server/progressStore';
import { prepareBankImport, commitBankImport } from '../server/import/bankImport';
import { parseBankPackage } from '../shared/bankImport';
import { assignLibrary } from './fixtures/assignedApp';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
const pack = (): any => ({
  format: 'zhixu.question-bank',
  version: '1.0',
  bank: { title: '原卷答案图片' },
  assets: [
    {
      id: 'answer',
      mimeType: 'image/webp',
      data: readFileSync('content-assets/beijing-2022/fig-13.webp').toString('base64'),
    },
  ],
  questions: [
    {
      id: 'q',
      type: 'single',
      title: '单位判断',
      score: 2,
      content: [{ id: 'p', type: 'paragraph', text: '力的单位？' }],
      options: [
        { id: 'a', text: '牛顿' },
        { id: 'b', text: '焦耳' },
      ],
      solution: {
        choices: ['a'],
        explanation: '原卷答案',
        referenceImages: [{ assetId: 'answer', caption: '原卷第9页' }],
      },
    },
  ],
});

it('导入支持参考答案原图，单独校验引用且重写内部资产ID', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ref-import-')),
    store = new Store(dir);
  cleanup.push(async () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const input = pack(),
    prepared = await prepareBankImport(JSON.stringify(input));
  expect(prepared.report.valid).toBe(true);
  const result = commitBankImport(store, prepared, 'user-teacher', true);
  const q = store.list<any>('questions').find((q) => q.bankId === result.bankId).draft;
  expect(q.solution.referenceImages).toHaveLength(1);
  expect(q.solution.referenceImages[0].assetId).not.toBe('answer');
  expect(store.get('assets', q.solution.referenceImages[0].assetId)).toBeTruthy();
  input.questions[0].solution.referenceImages[0].assetId = 'missing';
  expect(
    parseBankPackage(JSON.stringify(input)).errors.some((e) => e.code === 'asset_reference'),
  ).toBe(true);
});

it.each(['self', 'teacher'])(
  '答案图仅在%s答卷公布之后向本人开放，推送或交卷不能提前泄露',
  async (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'ref-access-')),
      app = await createApp({ dataDir: dir }),
      store = new ProgressStore(dir);
    cleanup.push(async () => {
      await app.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const auth = async (username: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username, password: username === 'teacher' ? 'Teacher123!' : 'Student123!' },
      });
      return {
        cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        'x-csrf-token': r.json().csrfToken,
      };
    };
    const s = await auth('student'),
      other = await auth('student2'),
      teacher = await auth('teacher');
    const bytes = readFileSync('content-assets/beijing-2022/fig-13.webp');
    writeFileSync(join(dir, 'uploads', 'reference.webp'), bytes);
    store.put(
      'assets',
      'reference',
      {
        id: 'reference',
        kind: 'question',
        ownerId: 'user-teacher',
        fileName: 'reference.webp',
        thumbnail: 'reference.webp',
        width: 100,
        height: 100,
      },
      'user-teacher',
    );
    const q: any = store.version('q-force', 1);
    q.version = 2;
    q.solution.referenceImages = [{ assetId: 'reference', caption: '评分标准' }];
    store.publish(q);
    const old = store.get<any>('questions', q.id);
    store.put('questions', q.id, { ...old, latestVersion: 2, draft: q });
    const bank = store.get<any>('library', 'bank-mechanics');
    bank.deliveryMode = mode === 'self' ? 'showcase' : 'assigned';
    store.put('library', bank.id, bank, bank.teacherId);
    if (mode === 'teacher') assignLibrary(store, bank.id);
    const get = (headers: any) => app.inject({ url: '/api/uploads/reference', headers });
    expect((await get(teacher)).statusCode).toBe(200);
    expect((await get(s)).statusCode).toBe(404);
    const a = (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: bank.id },
      })
    ).json();
    expect(JSON.stringify(a)).not.toContain('referenceImages');
    expect((await get(s)).statusCode).toBe(404);
    const sent = (
      await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s })
    ).json();
    expect((await get(s)).statusCode).toBe(mode === 'self' ? 200 : 404);
    expect((await get(other)).statusCode).toBe(404);
    if (mode === 'teacher') {
      expect(JSON.stringify(sent)).not.toContain('referenceImages');
      const saved: any = store.get('attempts', a.id);
      saved.review.state = 'published';
      store.put('attempts', a.id, saved, saved.userId);
      expect((await get(s)).statusCode).toBe(200);
    }
  },
);
