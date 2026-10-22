// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherInboxPage } from '../client/pages/TeacherInboxPage';
import type { StudentProgress } from '../shared/progress';
class Stream extends EventTarget {
  static instances: Stream[] = [];
  closed = false;
  onerror: (() => void) | null = null;
  constructor(
    readonly url: string,
    readonly options: { withCredentials: boolean },
  ) {
    super();
    Stream.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}
afterEach(() => {
  cleanup();
  Stream.instances = [];
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
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', Stream);
  const requested: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    return {
      ok: true,
      json: async () =>
        url.endsWith('/auth/me')
          ? { user: { id: 't', role: 'teacher', name: '教师', username: 'teacher' } }
          : [],
    };
  });
  render(
    <MemoryRouter>
      <TeacherInboxPage />
    </MemoryRouter>,
  );
  return requested;
}
async function openProgress() {
  await act(async () => {});
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '进行中' }));
  });
  expect(Stream.instances).toHaveLength(1);
  const stream = Stream.instances[0];
  await act(async () => {
    stream.emit('snapshot', [row]);
  });
  return stream;
}
it('通过SSE快照和增量更新进度，交卷移除；保持连接时不再轮询', async () => {
  const requests = setup(),
    stream = await openProgress();
  expect(stream.options.withCredentials).toBe(true);
  expect(stream.url).toContain('/api/teacher/progress/events');
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('26');
  await act(async () => {
    stream.emit('progress', { type: 'upsert', row: { ...row, answeredCount: 15, percent: 50 } });
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  expect(requests.some((url) => url.endsWith('/teacher/progress'))).toBe(false);
  expect(Stream.instances).toHaveLength(1);
  await act(async () => {
    stream.emit('progress', { type: 'remove', id: row.id });
  });
  expect(screen.getByText('还没有未交卷记录')).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '待处理' }));
  });
  expect(stream.closed).toBe(true);
  expect(requests.filter((u) => u.endsWith('/teacher/attempts'))).toHaveLength(2);
});
it('断网保留进度并重连，用新快照校准，旧连接事件不能覆盖，搜索仍可用', async () => {
  setup();
  const stream = await openProgress();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索学生或试卷' }), {
    target: { value: '没有' },
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索学生或试卷' }), {
    target: { value: 'xiaoming' },
  });
  await act(async () => {
    stream.onerror?.();
  });
  expect(stream.closed).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('连接中断');
  expect(screen.getByRole('progressbar')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(Stream.instances).toHaveLength(2);
  await act(async () => {
    Stream.instances[1].emit('snapshot', [{ ...row, percent: 80 }]);
    stream.emit('snapshot', []);
  });
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('80');
  expect(screen.queryByRole('alert')).toBeNull();
});
it('隐藏关闭，恢复重连；手动刷新替换连接，离开后不再重连', async () => {
  setup();
  const stream = await openProgress();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(stream.closed).toBe(true);
  expect(Stream.instances).toHaveLength(1);
  hidden.mockReturnValue(false);
  await act(async () => {
    fireEvent(document, new Event('visibilitychange'));
  });
  expect(Stream.instances).toHaveLength(2);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '刷新收卷箱' }));
  });
  expect(Stream.instances[1].closed).toBe(true);
  expect(Stream.instances).toHaveLength(3);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '待处理' }));
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(Stream.instances[2].closed).toBe(true);
  expect(Stream.instances).toHaveLength(3);
});
it('登录失效后清除旧进度并停止重试', async () => {
  setup();
  const stream = await openProgress();
  await act(async () => {
    stream.emit('session-expired', {});
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.getByRole('link', { name: '重新登录教师账号' })).toBeTruthy();
  expect(Stream.instances).toHaveLength(1);
  expect(stream.closed).toBe(true);
});
it('断流后的身份探测悬挂时，超时后仍继续重连', async () => {
  setup();
  const stream = await openProgress();
  vi.stubGlobal(
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );
  await act(async () => {
    stream.onerror?.();
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(Stream.instances).toHaveLength(2);
});
it('身份探测收到响应头后正文超时，保留进度并继续重连', async () => {
  setup();
  const stream = await openProgress();
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ({
    ok: true,
    json: () =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  }));
  await act(async () => {
    stream.onerror?.();
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(Stream.instances).toHaveLength(2);
  expect(screen.getByRole('progressbar')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '重新登录教师账号' })).toBeNull();
});
