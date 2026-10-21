// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherInboxPage } from '../client/pages/TeacherInboxPage';
import type { StudentProgress } from '../shared/progress';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const row: StudentProgress = {
  id: 'draft',
  title: '北京物理试卷',
  libraryId: 'paper',
  kind: 'paper',
  student: { id: 's', name: '小明', username: 'xiaoming' },
  createdAt: '2026-10-20T08:00:00Z',
  updatedAt: '2026-10-20T08:01:00Z',
  questionCount: 30,
  answeredCount: 8,
  inProgressCount: 2,
  emptyCount: 20,
  percent: 26,
};
function setup() {
  let rows = [row],
    fail = false;
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    if (url.endsWith('/teacher/progress') && fail) throw new TypeError('offline');
    return { ok: true, json: async () => (url.endsWith('/teacher/progress') ? rows : []) };
  });
  render(
    <MemoryRouter>
      <TeacherInboxPage />
    </MemoryRouter>,
  );
  return {
    requested,
    rows: (next: StudentProgress[]) => {
      rows = next;
    },
    fail: (next: boolean) => {
      fail = next;
    },
  };
}
async function openProgress() {
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '进行中' }));
  });
}
it('独立分区显示未交卷进度，轮询更新并移除交卷项，返回批改分区刷新收卷箱', async () => {
  vi.useFakeTimers();
  const server = setup();
  await openProgress();
  expect(screen.getByText('小明', { exact: false })).toBeTruthy();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('26');
  expect(screen.queryByRole('link', { name: /进入批改/ })).toBeNull();
  server.rows([{ ...row, answeredCount: 15, percent: 50, emptyCount: 13 }]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  server.rows([]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByText('还没有未交卷记录')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '待处理' }));
  });
  expect(server.requested.filter((u) => u.endsWith('/teacher/attempts'))).toHaveLength(2);
  const calls = server.requested.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(server.requested).toHaveLength(calls);
});
it('搜索、断网保留上次进度、隐藏时暂停并在返回时立即刷新', async () => {
  vi.useFakeTimers();
  const server = setup();
  await openProgress();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索学生或试卷' }), {
    target: { value: '其他学生' },
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索学生或试卷' }), {
    target: { value: 'xiaoming' },
  });
  expect(screen.getByRole('progressbar')).toBeTruthy();
  server.fail(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(screen.getByRole('alert').textContent).toContain('暂时无法连接');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('26');
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  const count = server.requested.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(server.requested).toHaveLength(count);
  server.fail(false);
  hidden.mockReturnValue(false);
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
  });
  expect(server.requested).toHaveLength(count + 1);
  expect(screen.queryByRole('alert')).toBeNull();
});
it('慢请求不会重叠，离开分区中止请求且不会重新启动轮询', async () => {
  vi.useFakeTimers();
  let resolve: (response: unknown) => void = () => {};
  let progressCalls = 0;
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!url.endsWith('/teacher/progress')) return { ok: true, json: async () => [] };
    progressCalls++;
    signal = init.signal as AbortSignal;
    return new Promise((r) => {
      resolve = r;
    });
  });
  render(
    <MemoryRouter>
      <TeacherInboxPage />
    </MemoryRouter>,
  );
  await openProgress();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(progressCalls).toBe(1);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '待处理' }));
  });
  expect(signal?.aborted).toBe(true);
  await act(async () => {
    resolve({ ok: true, json: async () => [row] });
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(progressCalls).toBe(1);
  expect(screen.queryByRole('progressbar')).toBeNull();
});
