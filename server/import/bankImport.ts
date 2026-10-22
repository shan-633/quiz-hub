import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  MAX_IMAGE_BYTES,
  parseBankPackage,
  packageQuestion,
  type BankPackage,
  type ImportReport,
} from '../../shared/bankImport';
import { walkBlocks } from '../../shared/domain';
import type { LibraryItem } from '../../shared/model';
import type { Asset } from '../routes/uploads';
import type { Store } from '../store';
import { HttpError } from '../auth';

interface PreparedAsset {
  externalId: string;
  bytes: Buffer;
  extension: string;
  width: number;
  height: number;
  mimeType: string;
}
export interface PreparedImport {
  report: ImportReport;
  document?: BankPackage;
  assets: PreparedAsset[];
}
interface ImportRecord {
  bankId: string;
  title: string;
  digest: string;
  createdAt: string;
  ownerId: string;
}
export interface BankImportResult {
  bankId: string;
  title: string;
  state: string;
  questionCount: number;
  reused: boolean;
}

export function previousBankImport(store: Store, digest: string, ownerId?: string) {
  const record = ownerId
    ? (store.get<ImportRecord>('imports', `${ownerId}:${digest}`) ??
      store.list<ImportRecord>('imports', ownerId).find((r) => r.digest === digest))
    : store.get<ImportRecord>('imports', digest);
  const bank = record && store.get<LibraryItem>('library', record.bankId);
  return bank ? { bankId: bank.id, title: bank.title, state: bank.state } : undefined;
}

function hasPngAnimation(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    if (offset + length + 12 > bytes.length) throw new Error('PNG图片数据不完整');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    if (type === 'IEND') break;
    offset += length + 12;
  }
  return false;
}

export async function prepareBankImport(text: string): Promise<PreparedImport> {
  const parsed = parseBankPackage(text);
  const { document, ...report } = parsed;
  const prepared: PreparedImport = { report, document, assets: [] };
  if (!report.valid || !document) return prepared;
  report.digest = createHash('sha256')
    .update(text.replace(/^\uFEFF/, ''))
    .digest('hex');
  for (const [index, asset] of document.assets.entries()) {
    try {
      const bytes = Buffer.from(asset.data, 'base64');
      if (bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== asset.data)
        throw new Error('图片须为不含前缀、空白的标准Base64，且解码后不超过5 MiB');
      const decoder = sharp(bytes, { limitInputPixels: 25_000_000, failOn: 'warning' });
      const metadata = await decoder.metadata();
      const formats: Record<string, string> = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };
      if (
        !metadata.format ||
        formats[metadata.format] !== asset.mimeType ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) > 1 ||
        (metadata.format === 'png' && hasPngAnimation(bytes))
      )
        throw new Error('实际图片格式与mimeType不符，或为动画/多页图片；仅支持静态PNG、JPEG、WebP');
      // Decode every pixel to reject truncated/corrupt payloads, while retaining original bytes.
      await decoder.raw().toBuffer();
      prepared.assets.push({
        externalId: asset.id,
        bytes,
        extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format,
        width: [5, 6, 7, 8].includes(metadata.orientation ?? 0) ? metadata.height : metadata.width,
        height: [5, 6, 7, 8].includes(metadata.orientation ?? 0) ? metadata.width : metadata.height,
        mimeType: asset.mimeType,
      });
    } catch (e) {
      report.errors.push({
        path: `$.assets[${index}].data`,
        code: 'image',
        message: `图片 ${asset.id} 无效：${(e as Error).message}`,
      });
    }
  }
  report.valid = report.errors.length === 0;
  if (report.valid) {
    const questions = document.questions.map((q) => packageQuestion(q));
    for (const q of questions)
      for (const b of walkBlocks(q.content))
        if (b.type === 'image') {
          const asset = prepared.assets.find((a) => a.externalId === b.assetId)!;
          b.intrinsicWidth = asset.width;
          b.intrinsicHeight = asset.height;
        }
    report.preview = {
      questions,
      assetSources: Object.fromEntries(
        prepared.assets.map((a) => [
          a.externalId,
          `data:${a.mimeType};base64,${a.bytes.toString('base64')}`,
        ]),
      ),
    };
  }
  return prepared;
}

/** No awaits in the commit section: duplicate detection and transaction serialize on this process. */
export function commitBankImport(
  store: Store,
  prepared: PreparedImport,
  ownerId: string,
  publish = false,
): BankImportResult {
  const { report, document } = prepared;
  if (!report.valid || !document || !report.digest)
    throw new HttpError(422, '题库文件未通过校验', { report });
  const prior = previousBankImport(store, report.digest, ownerId);
  if (prior) {
    const count = store
      .list<{ bankId: string }>('questions')
      .filter((q) => q.bankId === prior.bankId).length;
    return { ...prior, questionCount: count, reused: true };
  }
  const bankId = randomUUID(),
    createdAt = new Date().toISOString();
  const assets = prepared.assets.map((a) => {
    const id = randomUUID();
    const asset: Asset = {
      id,
      ownerId,
      kind: 'question',
      clientId: id,
      fileName: `${id}.${a.extension}`,
      thumbnail: `${id}.${a.extension}`,
      width: a.width,
      height: a.height,
      createdAt,
    };
    return { original: a, asset };
  });
  const questions = document.questions.map((input) => {
    const q = packageQuestion(structuredClone(input), bankId);
    q.id = randomUUID();
    q.state = publish ? 'published' : 'draft';
    q.version = publish ? 1 : 0;
    for (const b of walkBlocks(q.content))
      if (b.type === 'image') {
        const a = assets.find((a) => a.original.externalId === b.assetId)!;
        b.assetId = a.asset.id;
        b.intrinsicWidth = a.asset.width;
        b.intrinsicHeight = a.asset.height;
      }
    return q;
  });
  const bank: LibraryItem = {
    ...document.bank,
    id: bankId,
    teacherId: ownerId,
    kind: 'bank',
    state: publish ? 'published' : 'draft',
    questionCount: questions.length,
    totalScore: questions.reduce((sum, q) => sum + q.score, 0),
  };
  const createdFiles: string[] = [];
  try {
    for (const { original, asset } of assets) {
      const path = join(store.dataDir, 'uploads', asset.fileName);
      const descriptor = openSync(path, 'wx');
      createdFiles.push(path);
      try {
        writeFileSync(descriptor, original.bytes);
      } finally {
        closeSync(descriptor);
      }
    }
    store.transaction(() => {
      for (const { asset } of assets) store.put('assets', asset.id, asset, ownerId);
      store.put('library', bankId, bank, ownerId);
      for (const q of questions) {
        if (publish) store.publish(q);
        store.put('questions', q.id, {
          id: q.id,
          bankId,
          latestVersion: q.version,
          draft: q,
          archived: false,
        });
      }
      store.put(
        'imports',
        `${ownerId}:${report.digest!}`,
        {
          bankId,
          title: bank.title,
          digest: report.digest!,
          createdAt,
          ownerId,
        } satisfies ImportRecord,
        ownerId,
      );
    });
  } catch (error) {
    for (const path of createdFiles)
      try {
        unlinkSync(path);
      } catch {
        /* Retain the original failure. */
      }
    throw error;
  }
  return {
    bankId,
    title: bank.title,
    state: bank.state,
    questionCount: questions.length,
    reused: false,
  };
}
