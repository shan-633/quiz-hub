import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Store } from '../server/store';
import {
  buildCollection,
  collectionId,
  type CollectionManifest,
} from '../server/content/beijingCollection';
import { questionSchema } from '../shared/schema';
import { validateQuestion, walkBlocks } from '../shared/domain';
import type { User } from '../shared/model';
const args = process.argv.slice(2);
const option = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const manifestPath = resolve(option('--manifest', 'output/import/beijing-2023-2026/manifest.json'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as CollectionManifest;
const dataDir = resolve(option('--data-dir', 'data')),
  store = new Store(dataDir);
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
try {
  const teacher = store
    .list<User>('users')
    .find(
      (u) => u.username === option('--teacher', 'teacher') && u.role === 'teacher' && !u.disabled,
    );
  if (!teacher) throw new Error('Teacher account not found');
  // Preserve and verify the source before committing any teaching records, including retries.
  if (args.includes('--commit')) {
    const preservedSource = join(
      dataDir,
      'sources',
      `beijing-2023-2026-${manifest.source.sha256.slice(0, 12)}.pdf`,
    );
    if (existsSync(preservedSource)) {
      if (sha(readFileSync(preservedSource)) !== manifest.source.sha256)
        throw new Error('Preserved source fingerprint differs');
    } else {
      if (sha(readFileSync(manifest.source.path)) !== manifest.source.sha256)
        throw new Error('Source fingerprint differs');
      mkdirSync(dirname(preservedSource), { recursive: true });
      copyFileSync(manifest.source.path, preservedSource);
    }
  }
  const recordId = `${teacher.id}:beijing-collection:${manifest.source.sha256}`;
  const prior = store.get<any>('imports', recordId);
  if (prior) {
    console.log(
      JSON.stringify({ reused: true, banks: prior.bankIds.length, questions: prior.questionCount }),
    );
  } else {
    const content = buildCollection(manifest, teacher.id);
    const assetMap = new Map(manifest.assets.map((a) => [collectionId(teacher.id, a.id), a]));
    for (const q of content.questions) {
      if (store.get('questions', q.id)) throw new Error('Question ID already exists: ' + q.id);
      for (const b of walkBlocks(q.content))
        if (b.type === 'image') {
          const image = assetMap.get(b.assetId!);
          if (!image) throw new Error('Missing stem asset');
          b.intrinsicWidth = image.width;
          b.intrinsicHeight = image.height;
        }
      for (const image of q.solution?.referenceImages ?? [])
        if (!assetMap.has(image.assetId)) throw new Error('Missing answer asset');
      questionSchema.parse(q);
      const issues = validateQuestion(q);
      if (q.state === 'published' && issues.length)
        throw new Error(q.title + ': ' + issues.join('; '));
    }
    for (const b of content.banks)
      if (store.get('library', b.id)) throw new Error('Bank ID already exists');
    for (const a of manifest.assets) {
      const path = resolve(dirname(manifestPath), a.file);
      if (!path.startsWith(dirname(manifestPath) + '\\') || sha(readFileSync(path)) !== a.sha256)
        throw new Error('Invalid asset fingerprint: ' + a.id);
    }
    const summary = {
      teacher: teacher.username,
      banks: content.banks.length,
      questions: content.questions.length,
      publishedBanks: content.banks.filter((b) => b.state === 'published').length,
      draftBanks: content.banks.filter((b) => b.state === 'draft').length,
      assets: manifest.assets.length,
    };
    if (!args.includes('--commit')) console.log(JSON.stringify({ dryRun: true, ...summary }));
    else {
      const createdFiles: string[] = [],
        now = new Date().toISOString();
      try {
        for (const a of manifest.assets) {
          const id = collectionId(teacher.id, a.id),
            target = join(dataDir, 'uploads', id + '.webp');
          if (existsSync(target) || store.get('assets', id))
            throw new Error('Asset already exists: ' + id);
          copyFileSync(resolve(dirname(manifestPath), a.file), target);
          createdFiles.push(target);
        }
        store.transaction(() => {
          for (const a of manifest.assets) {
            const id = collectionId(teacher.id, a.id);
            store.put(
              'assets',
              id,
              {
                id,
                ownerId: teacher.id,
                kind: 'question',
                clientId: id,
                fileName: id + '.webp',
                thumbnail: id + '.webp',
                width: a.width,
                height: a.height,
                createdAt: now,
              },
              teacher.id,
            );
          }
          for (const b of content.banks) store.put('library', b.id, b, teacher.id);
          for (const q of content.questions) {
            if (q.state === 'published') store.publish(q);
            store.put('questions', q.id, {
              id: q.id,
              bankId: q.bankId,
              draft: q,
              latestVersion: q.version,
              archived: false,
            });
          }
          store.put(
            'imports',
            recordId,
            {
              ...summary,
              bankIds: content.banks.map((b) => b.id),
              questionCount: content.questions.length,
              sourceSha256: manifest.source.sha256,
              manifestSha256: sha(readFileSync(manifestPath)),
              createdAt: now,
              ownerId: teacher.id,
            },
            teacher.id,
          );
        });
      } catch (error) {
        for (const file of createdFiles) unlinkSync(file);
        throw error;
      }
      const record = {
        ...summary,
        bankIds: content.banks.map((b) => b.id),
        sourceSha256: manifest.source.sha256,
        createdAt: now,
      };
      writeFileSync(
        join(dataDir, 'beijing-collection-import.json'),
        JSON.stringify(record, null, 2),
      );
      console.log(JSON.stringify({ committed: true, ...summary }));
    }
  }
} finally {
  store.close();
}
