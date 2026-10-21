import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Question } from '../../shared/model';
import { walkBlocks } from '../../shared/domain';
import { HttpError } from '../auth';
import type { Store } from '../store';
import type { Asset } from '../routes/uploads';
const require = createRequire(import.meta.url);
const stylesPath = resolve('server/print/print.css');
const fontsPath = resolve('content-assets/print/NotoSerifCJKsc-Regular.otf');
let styles: Promise<{ fontCss: string; mathCss: string }> | undefined;
export function loadPrintStyles() {
  return (styles ??= (async () => {
    const [font, css] = await Promise.all([readFile(fontsPath), readFile(stylesPath, 'utf8')]);
    const katexPath = dirname(require.resolve('katex'));
    const math = await readFile(join(katexPath, 'katex.min.css'), 'utf8');
    const sources = [...math.matchAll(/src:([^;}]+)/g)];
    let mathCss = math;
    for (const source of sources) {
      const woff = source[1].match(/url\(([^)]+\.woff2)\)/);
      if (!woff) continue;
      const bytes = await readFile(join(katexPath, woff[1]));
      mathCss = mathCss.replace(
        source[0],
        `src:url(data:font/woff2;base64,${bytes.toString('base64')}) format("woff2")`,
      );
    }
    return {
      fontCss: `@font-face{font-family:ZhixuPrint;font-style:normal;font-weight:400;font-display:block;src:url(data:font/otf;base64,${font.toString('base64')}) format("opentype")}\n${css}`,
      mathCss,
    };
  })().catch((error) => {
    styles = undefined;
    throw error;
  }));
}
export async function resolvePrintImages(
  store: Store,
  questions: Question[],
): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  let totalBytes = 0;
  for (const q of questions)
    for (const b of walkBlocks(q.content)) {
      if (b.type !== 'image') continue;
      const key = b.assetId ?? b.src ?? '';
      if (images[key]) continue;
      let file: string, mime: string;
      if (b.assetId) {
        const asset = store.get<Asset>('assets', b.assetId);
        if (
          !asset ||
          asset.kind !== 'question' ||
          !/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/i.test(asset.fileName)
        )
          throw new HttpError(422, `题干图片不可用：${b.alt || q.title}`);
        file = join(store.dataDir, 'uploads', asset.fileName);
        const ext = asset.fileName.split('.').at(-1)!.toLowerCase();
        mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      } else if (b.src && /^\/diagrams\/[a-z-]+\.svg$/.test(b.src)) {
        file = resolve('public', b.src.slice(1));
        mime = 'image/svg+xml';
      } else throw new HttpError(422, '打印只支持本地题干图片，请教师检查图片配置');
      let bytes: Buffer;
      try {
        bytes = await readFile(file);
      } catch {
        throw new HttpError(422, `题干图片缺失：${b.alt || q.title}，请教师补齐后重试`);
      }
      totalBytes += bytes.length;
      if (totalBytes > 64 * 1024 * 1024)
        throw new HttpError(413, '本次题干图片超过64MB，请拆分题库后导出');
      images[key] = `data:${mime};base64,${bytes.toString('base64')}`;
    }
  return images;
}
