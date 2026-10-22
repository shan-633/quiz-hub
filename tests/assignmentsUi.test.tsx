// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TeacherStudentsPage } from '../client/pages/TeacherStudentsPage';
import { PushAssignment } from '../client/components/PushAssignment';
import { AttemptTimer } from '../client/components/AttemptTimer';
vi.mock('../client/context', () => ({ useToast: () => () => {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (data: unknown) => ({ ok: true, json: async () => data });

it('教师选关联学生建立班级组', async () => {
  let saved: any;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init?.method === 'POST') {
      saved = JSON.parse(init.body as string);
      return response({ id: 'g', ...saved, revision: 1 });
    }
    return response(
      url.includes('/students') ? [{ id: 's', name: '小禾', username: 'student' }] : [],
    );
  });
  render(
    <MemoryRouter>
      <TeacherStudentsPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '新建班级组' }));
  fireEvent.change(screen.getByLabelText('班级组名称'), { target: { value: '九年级一班' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /小禾/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存班级组' }));
  await screen.findByText('班级组已保存');
  expect(saved.name).toBe('九年级一班');
  expect(saved.studentIds).toEqual(['s']);
});

it('推送表单包含班级、截止、时限和强制规则', async () => {
  let sent: any;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init?.method === 'POST') {
      sent = JSON.parse(init.body as string);
      return response({ id: 'task', recipientCount: 1 });
    }
    return response([{ id: 'g', name: '一班', studentIds: ['s'], revision: 1 }]);
  });
  render(
    <MemoryRouter>
      <PushAssignment
        item={{ id: 'bank', title: '力与运动', timeLimitMinutes: 30 }}
        onClose={() => {}}
        onSent={() => {}}
      />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('checkbox', { name: /一班/ }));
  fireEvent.click(screen.getByRole('checkbox', { name: /到时强制交卷/ }));
  fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '2026-12-30T18:00' } });
  fireEvent.click(screen.getByRole('button', { name: '确认推送' }));
  await screen.findByText('已推送给1位学生');
  expect(sent.groupIds).toEqual(['g']);
  expect(sent.timeLimitMinutes).toBe(30);
  expect(sent.enforceTimeLimit).toBe(true);
  expect(sent.deadlineAt).toBeTruthy();
});

it('倒计时使用服务器时间校准，到时先锁定，再确认服务端交卷并退出', async () => {
  vi.useFakeTimers();
  const now = Date.now(),
    lock = vi.fn(),
    completed = vi.fn();
  vi.stubGlobal('fetch', async () =>
    response({ id: 'a', status: 'submitted', submissionReason: 'timeout' }),
  );
  render(
    <AttemptTimer
      attempt={
        {
          id: 'a',
          status: 'active',
          serverNow: new Date(now + 60000).toISOString(),
          dueAt: new Date(now + 61000).toISOString(),
          enforceTimeLimit: true,
        } as any
      }
      onLock={lock}
      onSubmitted={completed}
    />,
  );
  expect(screen.getByText('00:01')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(lock).toHaveBeenCalledWith(true);
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
});

it('非强制超时仅显示提示，不锁定或自动交卷', async () => {
  const lock = vi.fn(),
    completed = vi.fn(),
    fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <AttemptTimer
      attempt={
        {
          id: 'a',
          status: 'active',
          serverNow: new Date().toISOString(),
          dueAt: new Date(Date.now() - 1000).toISOString(),
          enforceTimeLimit: false,
        } as any
      }
      onLock={lock}
      onSubmitted={completed}
    />,
  );
  expect(screen.getByText(/已超时，可继续完成/)).toBeTruthy();
  expect(lock).not.toHaveBeenCalledWith(true);
  expect(completed).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it('到时断网保持锁定，网络恢复后确认自动交卷', async () => {
  vi.useFakeTimers();
  let online = false;
  const lock = vi.fn(),
    completed = vi.fn();
  vi.stubGlobal('fetch', async () => {
    if (!online) throw new TypeError('offline');
    return response({ status: 'submitted', submissionReason: 'timeout' });
  });
  render(
    <AttemptTimer
      attempt={
        {
          id: 'a',
          status: 'active',
          dueAt: new Date(Date.now() - 1).toISOString(),
          enforceTimeLimit: true,
        } as any
      }
      onLock={lock}
      onSubmitted={completed}
    />,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(lock).toHaveBeenCalledWith(true);
  expect(completed).not.toHaveBeenCalled();
  expect(screen.getByText(/正在确认交卷状态；网络恢复后会重试/)).toBeTruthy();
  online = true;
  await act(async () => {
    window.dispatchEvent(new Event('online'));
  });
  expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
});
