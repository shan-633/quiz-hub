// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useAnswerSync } from '../client/useAnswerSync';
import * as persistence from '../client/persistence';
import type { Attempt } from '../shared/model';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('选图尚未写入本机队列时，提交必须等待入库和上传', async () => {
  let release: () => void = () => {},
    entered: () => void = () => {};
  const gate = new Promise<void>((r) => {
      release = r;
    }),
    started = new Promise<void>((r) => {
      entered = r;
    });
  const actual = persistence.enqueueUpload;
  vi.spyOn(persistence, 'enqueueUpload').mockImplementation(async (entry) => {
    entered();
    await gate;
    await actual({ ...entry, file: new Blob(['test'], { type: 'image/png' }) });
  });
  const originalForm = globalThis.FormData;
  vi.stubGlobal(
    'FormData',
    class {
      append() {}
    },
  );
  vi.stubGlobal('fetch', async (url: string, init: any) => {
    const body = url.endsWith('/uploads')
      ? { id: 'test-asset' }
      : { data: JSON.parse(init.body).data, revision: 1, updatedAt: 'now' };
    return { ok: true, json: async () => body };
  });
  const attempt: Attempt = {
    id: 'submit-test',
    userId: 'u',
    title: 'test',
    libraryId: 'b',
    status: 'active',
    createdAt: 'now',
    updatedAt: 'now',
    answers: {},
    questions: [
      {
        id: 'q',
        version: 1,
        bankId: 'b',
        type: 'calculation',
        title: '计算',
        score: 8,
        difficulty: '中等',
        tags: [],
        content: [],
        options: [],
        blanks: [],
        state: 'published',
      },
    ],
  };
  const hook = renderHook(() => useAnswerSync(attempt));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  let adding: Promise<void>;
  act(() => {
    adding = hook.result.current.uploads.add(
      [new File(['test'], 'answer.png', { type: 'image/png' })],
      { attemptId: attempt.id, questionId: 'q' },
    );
  });
  await started;
  let done = false,
    preparing: Promise<void>;
  act(() => {
    preparing = hook.result.current.prepareSubmission().then(() => {
      done = true;
    });
  });
  await new Promise((r) => setTimeout(r, 80));
  expect(done).toBe(false);
  await act(async () => {
    release();
    await adding!;
    await preparing!;
  });
  expect(done).toBe(true);
  expect(hook.result.current.get('q').imagePages).toHaveLength(1);
  vi.stubGlobal('FormData', originalForm);
});
