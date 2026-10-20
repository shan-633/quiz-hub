import { openDB } from 'idb';
import type { LocalDraft } from './syncEngine';
export interface DraftRecord extends LocalDraft {
  key: string;
  userId: string;
  attemptId: string;
  updatedAt: number;
}
export interface PendingUpload {
  key: string;
  userId: string;
  attemptId: string;
  questionId: string;
  partId?: string;
  file: Blob;
  name: string;
  createdAt: number;
}
const database = () =>
  openDB('zhixu-local-v1', 1, {
    upgrade(db) {
      const drafts = db.createObjectStore('drafts', { keyPath: 'key' });
      drafts.createIndex('attempt', ['userId', 'attemptId']);
      const uploads = db.createObjectStore('uploads', { keyPath: 'key' });
      uploads.createIndex('attempt', ['userId', 'attemptId']);
    },
  });
const draftKey = (user: string, attempt: string, qid: string) => `${user}:${attempt}:${qid}`;
export async function putDraft(userId: string, attemptId: string, draft: LocalDraft) {
  const db = await database();
  await db.put('drafts', {
    ...draft,
    key: draftKey(userId, attemptId, draft.questionId),
    userId,
    attemptId,
    updatedAt: Date.now(),
  });
}
export async function readDrafts(userId: string, attemptId: string): Promise<DraftRecord[]> {
  return (await database()).getAllFromIndex('drafts', 'attempt', [userId, attemptId]);
}
export async function removeDraft(userId: string, attemptId: string, qid: string) {
  await (await database()).delete('drafts', draftKey(userId, attemptId, qid));
}
export async function enqueueUpload(entry: PendingUpload) {
  await (await database()).put('uploads', entry);
}
export async function readUploads(userId: string, attemptId: string): Promise<PendingUpload[]> {
  return (await database()).getAllFromIndex('uploads', 'attempt', [userId, attemptId]);
}
export async function removeUpload(key: string) {
  await (await database()).delete('uploads', key);
}
