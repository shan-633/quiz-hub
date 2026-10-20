import type { AnswerData, SavedAnswer } from '../shared/model';
export interface LocalDraft {
  questionId: string;
  data: AnswerData;
  baseRevision: number;
}
type Status = 'saved' | 'saving' | 'local' | 'error' | 'conflict';
interface Persistence {
  put: (id: string, draft: LocalDraft) => Promise<void>;
  remove: (id: string) => Promise<void>;
}
export class AnswerSyncEngine {
  values: Record<string, AnswerData> = {};
  revisions: Record<string, number> = {};
  conflicts: Record<string, { local: AnswerData; remote: SavedAnswer }> = {};
  status: Status = 'saved';
  error = '';
  private dirty = new Set<string>();
  private running: Promise<void> | null = null;
  private storage = Promise.resolve();
  private storageFailed = false;
  constructor(
    initial: Record<string, SavedAnswer>,
    private save: (id: string, data: AnswerData, revision: number) => Promise<SavedAnswer>,
    private persistence?: Persistence,
    private notify: () => void = () => {},
  ) {
    for (const [id, a] of Object.entries(initial)) {
      this.values[id] = a.data;
      this.revisions[id] = a.revision;
    }
  }
  private persist(task: () => Promise<void>) {
    this.storage = this.storage
      .catch(() => {})
      .then(task)
      .catch((e) => {
        this.storageFailed = true;
        this.error = '无法写入本机存储，请保持页面打开并连接网络保存';
        this.notify();
        throw e;
      });
    return this.storage;
  }
  async update(id: string, data: AnswerData) {
    this.values = { ...this.values, [id]: data };
    if (this.conflicts[id]) this.conflicts[id].local = data;
    this.dirty.add(id);
    this.status = Object.keys(this.conflicts).length ? 'conflict' : 'saving';
    this.notify();
    if (this.persistence)
      await this.persist(() =>
        this.persistence!.put(id, {
          questionId: id,
          data: structuredClone(this.values[id]),
          baseRevision: this.revisions[id] ?? 0,
        }),
      );
  }
  restore(drafts: LocalDraft[]) {
    for (const draft of drafts) {
      const remote = this.values[draft.questionId],
        revision = this.revisions[draft.questionId] ?? 0;
      if (remote && JSON.stringify(remote) === JSON.stringify(draft.data)) {
        if (this.persistence)
          void this.persist(() => this.persistence!.remove(draft.questionId)).catch(() => {});
        continue;
      }
      if (revision !== draft.baseRevision) {
        this.conflicts[draft.questionId] = {
          local: draft.data,
          remote: { data: remote ?? draft.data, revision, updatedAt: '' },
        };
      } else {
        this.values = { ...this.values, [draft.questionId]: draft.data };
        this.dirty.add(draft.questionId);
      }
    }
    this.status = Object.keys(this.conflicts).length
      ? 'conflict'
      : this.dirty.size
        ? 'local'
        : 'saved';
    this.notify();
  }
  async resolve(id: string, choice: 'local' | 'remote') {
    const conflict = this.conflicts[id];
    if (!conflict) return;
    this.revisions[id] = conflict.remote.revision;
    delete this.conflicts[id];
    if (choice === 'local') await this.update(id, conflict.local);
    else {
      this.values = { ...this.values, [id]: conflict.remote.data };
      this.dirty.delete(id);
      if (this.persistence) await this.persist(() => this.persistence!.remove(id));
    }
    this.status = Object.keys(this.conflicts).length
      ? 'conflict'
      : this.dirty.size
        ? 'local'
        : 'saved';
    this.notify();
  }
  async flush(): Promise<void> {
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (Object.keys(this.conflicts).length) throw new Error('请先处理答案版本冲突');
    if (!this.dirty.size) return;
    const work = (async () => {
      this.status = 'saving';
      this.notify();
      try {
        await this.storage.catch(() => {});
        while (this.dirty.size) {
          const id = [...this.dirty][0],
            snapshot = structuredClone(this.values[id]),
            saved = await this.save(id, snapshot, this.revisions[id] ?? 0);
          this.revisions[id] = saved.revision;
          if (JSON.stringify(this.values[id]) === JSON.stringify(snapshot)) {
            this.dirty.delete(id);
            if (this.persistence) await this.persist(() => this.persistence!.remove(id));
          } else if (this.persistence)
            await this.persist(() =>
              this.persistence!.put(id, {
                questionId: id,
                data: this.values[id],
                baseRevision: saved.revision,
              }),
            );
        }
        this.status = 'saved';
        if (!this.storageFailed) this.error = '';
        this.notify();
      } catch (error) {
        const e = error as any;
        if (e.status === 409 && e.body?.current) {
          const id = [...this.dirty][0];
          this.conflicts[id] = { local: this.values[id], remote: e.body.current };
          this.status = 'conflict';
        } else this.status = e instanceof TypeError && !this.storageFailed ? 'local' : 'error';
        this.error = e.message;
        this.notify();
        throw e;
      }
    })();
    this.running = work;
    try {
      await work;
    } finally {
      this.running = null;
    }
  }
  get hasUnsaved() {
    return this.dirty.size > 0 || Object.keys(this.conflicts).length > 0;
  }
}
