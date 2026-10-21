import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { resolvePrintImages } from '../server/print/resources';
import { newQuestion } from '../shared/domain';
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) {
    s.close();
    rmSync(s.dataDir, { recursive: true, force: true });
  }
});
function setup() {
  const store = new Store(mkdtempSync(join(tmpdir(), 'zhixu-print-images-')));
  stores.push(store);
  return store;
}
it('只解析被题目引用的题干图片，原字节内嵌且去重，不访问网络', async () => {
  const s = setup(),
    q = newQuestion('single', 'b');
  q.content = [{ id: 'i', type: 'image', assetId: 'image', alt: '原图', caption: '', width: 100 }];
  writeFileSync(join(s.dataDir, 'uploads', 'image.png'), Buffer.from([137, 80, 78, 71]));
  s.put('assets', 'image', { id: 'image', kind: 'question', fileName: 'image.png' });
  expect(await resolvePrintImages(s, [q, q])).toEqual({ image: 'data:image/png;base64,iVBORw==' });
});
it('拒绝答案照片、缺失图片、任意文件路径和远程图片，不静默丢图', async () => {
  const s = setup(),
    q = newQuestion('single', 'b'),
    img = {
      id: 'i',
      type: 'image' as const,
      assetId: 'image',
      alt: '原图',
      caption: '',
      width: 100,
    };
  q.content = [img];
  await expect(resolvePrintImages(s, [q])).rejects.toMatchObject({ statusCode: 422 });
  s.put('assets', 'image', { id: 'image', kind: 'answer', fileName: 'image.png' });
  await expect(resolvePrintImages(s, [q])).rejects.toMatchObject({ statusCode: 422 });
  s.put('assets', 'image', { id: 'image', kind: 'question', fileName: '../../.env' });
  await expect(resolvePrintImages(s, [q])).rejects.toMatchObject({ statusCode: 422 });
  q.content = [{ ...img, assetId: undefined, src: 'https://example.com/private.png' }];
  await expect(resolvePrintImages(s, [q])).rejects.toMatchObject({ statusCode: 422 });
});
