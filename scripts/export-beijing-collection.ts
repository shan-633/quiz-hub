import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCollection,
  collectionId,
  type CollectionManifest,
} from '../server/content/beijingCollection';
import { parseBankPackage } from '../shared/bankImport';
import { walkBlocks } from '../shared/domain';
import type { Block } from '../shared/model';
const root = 'output/import/beijing-2023-2026';
const manifest = JSON.parse(
  readFileSync(join(root, 'manifest.json'), 'utf8'),
) as CollectionManifest;
const content = buildCollection(manifest, 'portable');
const assetMap = new Map(manifest.assets.map((a) => [collectionId('portable', a.id), a]));
const strip = (blocks: Block[]): Block[] =>
  blocks.map((b) => {
    if (b.type === 'image') {
      const { intrinsicWidth, intrinsicHeight, ...rest } = b;
      return rest;
    }
    return 'children' in b ? { ...b, children: strip(b.children) } : b;
  });
mkdirSync(join(root, 'packages'), { recursive: true });
const reports = [];
for (const [index, bank] of content.banks.entries()) {
  if (bank.state !== 'published') {
    reports.push({
      key: manifest.papers[index].key,
      title: bank.title,
      draft: true,
      reason: '源文件缺页、答案或分值，已在应用保留草稿，未冒充可发布导入包',
    });
    continue;
  }
  const questions = content.questions
    .filter((q) => q.bankId === bank.id)
    .map((q) => {
      const { bankId, state, version, ...portable } = q;
      return { ...portable, content: strip(portable.content) };
    });
  const used = new Set(
    questions.flatMap((q) => [
      ...walkBlocks(q.content).flatMap((b) => (b.type === 'image' ? [b.assetId!] : [])),
      ...(q.solution?.referenceImages ?? []).map((i) => i.assetId),
    ]),
  );
  const pkg = {
    format: 'zhixu.question-bank',
    version: '1.0',
    bank: {
      title: bank.title,
      description: bank.description,
      chapter: bank.chapter,
      minutes: bank.minutes,
      accent: bank.accent,
    },
    questions,
    assets: [...used].map((id) => {
      const a = assetMap.get(id)!;
      return {
        id,
        mimeType: 'image/webp',
        name: a.id + '.webp',
        data: readFileSync(join(root, a.file)).toString('base64'),
      };
    }),
  };
  const text = JSON.stringify(pkg),
    report = parseBankPackage(text);
  if (!report.valid) throw new Error(bank.title + JSON.stringify(report.errors));
  const file = manifest.papers[index].key + '.zqb.json';
  writeFileSync(join(root, 'packages', file), text);
  reports.push({
    file,
    title: bank.title,
    questions: questions.length,
    bytes: Buffer.byteLength(text),
    valid: true,
  });
}
writeFileSync(join(root, 'packages', 'report.json'), JSON.stringify(reports, null, 2));
console.log(
  JSON.stringify({
    exported: reports.filter((r) => 'file' in r).length,
    drafts: reports.filter((r) => 'draft' in r).length,
    largestBytes: Math.max(...reports.map((r) => ('bytes' in r ? r.bytes! : 0))),
  }),
);
