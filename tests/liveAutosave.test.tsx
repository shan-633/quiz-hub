// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAnswerSync } from '../client/useAnswerSync';
import { emptyAnswer } from '../shared/domain';
import type { Attempt } from '../shared/model';
vi.mock('../client/persistence', () => ({
  readDrafts: async () => [],
  readUploads: async () => [],
  putDraft: async () => {},
  removeDraft: async () => {},
  enqueueUpload: async () => {},
  removeUpload: async () => {},
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const attempt: Attempt = {
  id: 'live',
  userId: 's',
  libraryId: 'b',
  title: '实时保存',
  status: 'active',
  createdAt: 'now',
  updatedAt: 'now',
  questions: [],
  answers: {},
};
function server() {
  const saved: string[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    saved.push(body.data.markdown);
    return {
      ok: true,
      json: async () => ({
        data: body.data,
        revision: body.expectedRevision + 1,
        updatedAt: 'now',
      }),
    };
  });
  return saved;
}
it('持续输入没有700ms停顿时，2秒内仍保存到服务器', async () => {
  vi.useFakeTimers();
  const saved = server(),
    hook = renderHook(() => useAnswerSync(attempt));
  await act(async () => {});
  for (let n = 1; n <= 5; n++) {
    await act(async () => {
      hook.result.current.update('q', { ...emptyAnswer(), markdown: `步骤${n}` });
      await vi.advanceTimersByTimeAsync(400);
    });
  }
  expect(saved).toEqual(['步骤5']);
  expect(hook.result.current.status).toBe('saved');
});
it('离开作答页时立即同步，不等待防抖结束', async () => {
  vi.useFakeTimers();
  const saved = server(),
    hook = renderHook(() => useAnswerSync(attempt));
  await act(async () => {});
  await act(async () => {
    hook.result.current.update('q', { ...emptyAnswer(), markdown: '离开前的内容' });
  });
  hook.unmount();
  await act(async () => {});
  expect(saved).toEqual(['离开前的内容']);
});
it('切换到后台时保存最新内容，返回后仍可继续保存', async () => {
  vi.useFakeTimers();
  const saved = server(),
    hook = renderHook(() => useAnswerSync(attempt));
  await act(async () => {});
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    hook.result.current.update('q', { ...emptyAnswer(), markdown: '切换前' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(saved).toEqual(['切换前']);
  visibility.mockReturnValue('visible');
  await act(async () => {
    hook.result.current.update('q', { ...emptyAnswer(), markdown: '返回后' });
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(saved).toEqual(['切换前', '返回后']);
  visibility.mockRestore();
});
