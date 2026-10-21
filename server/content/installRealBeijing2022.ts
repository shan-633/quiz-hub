import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Store } from '../store';
import type { Asset } from '../routes/uploads';
import type { LibraryItem } from '../../shared/model';
import { validateQuestion } from '../../shared/domain';
import { questionSchema } from '../../shared/schema';
import { buildRealBeijing2022 } from './beijing2022Real';
import manifest from '../../content-assets/beijing-2022/manifest.json';

export function installRealBeijing2022(store: Store) {
  const content = buildRealBeijing2022();
  const prepared: Asset[] = [];
  for (const entry of manifest.assets) {
    const fileName = `${entry.id}.webp`;
    const source = resolve('content-assets/beijing-2022', entry.webp);
    const bytes = readFileSync(source);
    if (createHash('sha256').update(bytes).digest('hex') !== entry.webpSha256)
      throw new Error(`原卷图片校验失败：${entry.name}`);
    const destination = join(store.dataDir, 'uploads', fileName);
    if (!existsSync(destination)) copyFileSync(source, destination);
    prepared.push({
      id: entry.id,
      ownerId: 'user-teacher',
      kind: 'question',
      clientId: entry.id,
      fileName,
      thumbnail: fileName,
      width: entry.width,
      height: entry.height,
      createdAt: '2026-10-20T00:00:00.000Z',
    });
  }
  for (const question of content.questions) {
    questionSchema.parse(question);
    const issues = validateQuestion(question);
    if (issues.length) throw new Error(`${question.title}: ${issues.join('；')}`);
  }
  store.transaction(() => {
    for (const asset of prepared)
      if (!store.get('assets', asset.id)) store.put('assets', asset.id, asset, asset.ownerId);
    for (const question of content.questions) {
      if (store.get('questions', question.id)) continue;
      if (!store.version(question.id, question.version)) store.publish(question);
      store.put('questions', question.id, {
        id: question.id,
        bankId: question.bankId,
        latestVersion: question.version,
        draft: question,
        archived: false,
      });
    }
    for (const item of [content.bank, content.paper])
      if (!store.get('library', item.id)) store.put('library', item.id, item);
    // Supersede our previous original simulation without deleting questions, versions or attempts.
    for (const id of ['bank-beijing-original-01', 'paper-beijing-original-01']) {
      const old = store.get<LibraryItem>('library', id);
      if (old && old.state !== 'archived') store.put('library', id, { ...old, state: 'archived' });
    }
  });
  return content;
}
