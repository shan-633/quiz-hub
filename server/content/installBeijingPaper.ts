import type { Store } from '../store';
import { buildBeijingPaper } from './beijingPaper';
import { validateQuestion, walkBlocks } from '../../shared/domain';
import { questionSchema } from '../../shared/schema';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** One-time demo content installation. Existing teacher edits/versions are never overwritten. */
export function installBeijingPaper(store: Store) {
  const data = buildBeijingPaper();
  for (const q of data.questions) {
    questionSchema.parse(q);
    const issues = validateQuestion(q);
    for (const b of walkBlocks(q.content))
      if (b.type === 'image' && b.src && !existsSync(resolve('public', b.src.slice(1))))
        issues.push(`缺少图片 ${b.src}`);
    if (issues.length) throw new Error(`${q.title}: ${issues.join('；')}`);
  }
  store.transaction(() => {
    for (const q of data.questions) {
      if (store.get('questions', q.id)) continue;
      if (!store.version(q.id, q.version)) store.publish(q);
      store.put('questions', q.id, {
        id: q.id,
        bankId: q.bankId,
        latestVersion: q.version,
        draft: q,
        archived: false,
      });
    }
    for (const item of [data.bank, data.paper])
      if (!store.get('library', item.id)) store.put('library', item.id, item);
  });
  return data;
}
