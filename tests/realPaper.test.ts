import { expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { buildRealBeijing2022, realPaperId } from '../server/content/beijing2022Real';
import { installRealBeijing2022 } from '../server/content/installRealBeijing2022';
import { Store, type StoredQuestion } from '../server/store';
import { questionSchema } from '../shared/schema';
import { emptyAnswer, gradeQuestion, validateQuestion, walkBlocks } from '../shared/domain';
import manifest from '../content-assets/beijing-2022/manifest.json';
import { createAssignedApp as createApp } from './fixtures/assignedApp';

it('24张原图经有权限学生的真实API读取时字节与来源无损WebP一致', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bj-real-api-'));
  const app = await createApp({ dataDir: dir, seed: true });
  try {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'student', password: 'Student123!' },
    });
    const headers = { cookie: login.cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
    for (const asset of manifest.assets) {
      const response = await app.inject({ url: `/api/uploads/${asset.id}`, headers });
      expect(response.statusCode, asset.name).toBe(200);
      expect(response.headers['content-type']).toContain('image/webp');
      expect(createHash('sha256').update(response.rawPayload).digest('hex'), asset.name).toBe(
        asset.webpSha256,
      );
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('整套2022北京真题保留26题70分、原题选项顺序和答案键及所有原图引用', () => {
  const { questions, paper, analysis } = buildRealBeijing2022();
  expect(questions).toHaveLength(26);
  expect(paper.items).toHaveLength(26);
  expect(questions.reduce((sum, q) => sum + q.score, 0)).toBe(70);
  expect(paper.minutes).toBe(70);
  expect(questions.slice(0, 15).map((q) => q.solution!.choices.join('').toUpperCase())).toEqual([
    'A',
    'D',
    'D',
    'A',
    'C',
    'A',
    'C',
    'B',
    'C',
    'D',
    'B',
    'D',
    'ACD',
    'BC',
    'ABC',
  ]);
  expect(questions.slice(15, 23).map((q) => q.score)).toEqual([2, 4, 3, 4, 4, 3, 4, 4]);
  const references = questions.flatMap((q) =>
    walkBlocks(q.content).flatMap((b) => (b.type === 'image' ? [b.assetId] : [])),
  );
  expect([...references].sort()).toEqual(manifest.assets.map((a) => a.id).sort());
  expect([...new Set(manifest.assets.flatMap((a) => a.figures))].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 24 }, (_, i) => i + 1),
  );
  expect(analysis.find((a) => a.number === 25)?.pages).toEqual([7, 8]);
  let pending = 0;
  for (const q of questions) {
    expect(questionSchema.safeParse(q).success, q.title).toBe(true);
    expect(validateQuestion(q), q.title).toEqual([]);
    const a = emptyAnswer();
    a.choiceIds = q.solution!.choices;
    for (const b of q.blanks)
      a.blankValues[b.id] =
        b.kind === 'manual' ? '完整的物理表述' : q.solution!.blanks[b.id].accepted[0];
    for (const b of walkBlocks(q.content))
      if (b.type === 'subquestion') {
        if (b.responseKind === 'open')
          a.parts[b.id] = { ...emptyAnswer(), markdown: '完整原题解答' };
        if (b.responseKind === 'single')
          a.parts[b.id] = { ...emptyAnswer(), choiceIds: q.solution!.partChoices![b.id] };
      }
    if (q.type === 'calculation') a.markdown = '原题计算过程';
    const grade = gradeQuestion(q, a);
    pending += grade.max - grade.earned;
  }
  expect(pending).toBe(18);
  expect(questions[19].solution!.blanks[questions[19].blanks[2].id].accepted).toContain('2.7');
});

it('每个网页图均与PNG原截图像素一致，并可追溯到同一PDF', async () => {
  const source = readFileSync('docs/beijing-2022-real/source.pdf');
  expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.sourceSha256);
  for (const asset of manifest.assets) {
    const prefix = 'content-assets/beijing-2022/';
    for (const [file, hash] of [
      [asset.png, asset.pngSha256],
      [asset.webp, asset.webpSha256],
    ])
      expect(
        createHash('sha256')
          .update(readFileSync(prefix + file))
          .digest('hex'),
        file,
      ).toBe(hash);
    const png = await sharp(prefix + asset.png)
      .removeAlpha()
      .raw()
      .toBuffer();
    const webp = await sharp(prefix + asset.webp)
      .removeAlpha()
      .raw()
      .toBuffer();
    expect(png.equals(webp), asset.name).toBe(true);
    expect(asset.page).toBeLessThanOrEqual(8);
  }
});

it('新真题替换原创卷公开入口，重复安装保留教师修改、旧题版本与作答', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bj-real-'));
  const store = new Store(dir);
  try {
    store.put('library', 'paper-beijing-original-01', {
      id: 'paper-beijing-original-01',
      state: 'published',
    });
    store.put('attempts', 'old-attempt', { id: 'old-attempt', answers: { keep: '旧答案' } });
    const { questions } = installRealBeijing2022(store);
    const changed = store.get<StoredQuestion>('questions', questions[0].id)!;
    changed.draft.title = '教师修订';
    store.put('questions', changed.id, changed);
    installRealBeijing2022(store);
    expect(store.list('questions')).toHaveLength(26);
    expect(store.versions()).toHaveLength(26);
    expect(store.get<StoredQuestion>('questions', changed.id)?.draft.title).toBe('教师修订');
    expect(store.get<any>('library', 'paper-beijing-original-01').state).toBe('archived');
    expect(store.get<any>('attempts', 'old-attempt').answers.keep).toBe('旧答案');
    expect(store.get<any>('library', realPaperId).state).toBe('published');
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
