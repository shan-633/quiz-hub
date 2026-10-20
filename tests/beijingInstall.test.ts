import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type StoredQuestion } from '../server/store';
import { installBeijingPaper } from '../server/content/installBeijingPaper';
import { beijingPaperId } from '../server/content/beijingPaper';
it('安装试卷可重复执行，不覆盖老师的题目改动或旧版本，重启数据仍在', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bj-paper-'));
  let store = new Store(dir);
  try {
    const { questions } = installBeijingPaper(store);
    const saved = store.get<StoredQuestion>('questions', questions[0].id)!;
    saved.draft.title = '老师自行修订的标题';
    store.put('questions', saved.id, saved);
    installBeijingPaper(store);
    expect(store.list('questions')).toHaveLength(26);
    expect(store.versions()).toHaveLength(26);
    expect(store.get<StoredQuestion>('questions', saved.id)?.draft.title).toBe(
      '老师自行修订的标题',
    );
    expect(store.version(saved.id, 1)?.title).toBe(questions[0].title);
    store.close();
    store = new Store(dir);
    expect(store.get('library', beijingPaperId)).toBeTruthy();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
