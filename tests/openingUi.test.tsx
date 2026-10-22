// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../client/pages/HomePage';
import { TasksPage } from '../client/pages/TasksPage';
vi.mock('../client/context', () => ({
  useAuth: () => ({ user: { id: 's', role: 'student' } }),
  useToast: () => () => {},
}));
vi.mock('../client/chatContext', () => ({ useChat: () => ({ contacts: [], status: 'live' }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const response = (data: unknown) => ({ ok: true, json: async () => data });

it('从首页定位任务只在首次加载后聚焦，15秒刷新不抢回用户焦点', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', async () =>
    response(
      ['one', 'two'].map((id) => ({
        id,
        libraryId: 'b',
        title: id,
        teacherName: '陈老师',
        groupNames: ['一班'],
        status: 'not_started',
        questionCount: 2,
        totalScore: 6,
      })),
    ),
  );
  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/tasks#task-one']}>
        <TasksPage />
      </MemoryRouter>,
    );
  });
  expect(document.activeElement?.id).toBe('task-one');
  const second = screen.getAllByRole('button', { name: '开始作答' })[1];
  second.focus();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15100);
  });
  expect(document.activeElement).toBe(second);
});

it('目录显示开放时间，开放前禁用开始和打印，到时自动启用', async () => {
  vi.useFakeTimers();
  const opensAt = new Date(Date.now() + 1000).toISOString();
  vi.stubGlobal('fetch', async (url: string) =>
    response(
      url.endsWith('/library')
        ? [
            {
              id: 'b',
              title: '定时题库',
              kind: 'bank',
              opensAt,
              questionCount: 1,
              minutes: 20,
              totalScore: 5,
              chapter: '',
              description: '',
              accent: 'mechanics',
            },
          ]
        : [],
    ),
  );
  await act(async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
  });
  expect((screen.getByRole('button', { name: '尚未开放' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: '打印 PDF' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect((screen.getByRole('button', { name: '开始练习' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});

it('班级任务新增未开放分区，到时无需刷新即可开始', async () => {
  vi.useFakeTimers();
  const opensAt = new Date(Date.now() + 1000).toISOString();
  vi.stubGlobal('fetch', async () =>
    response([
      {
        id: 'task',
        libraryId: 'b',
        title: '待开放任务',
        teacherName: '陈老师',
        groupNames: ['一班'],
        questionCount: 2,
        totalScore: 10,
        status: 'scheduled',
        opensAt,
      },
    ]),
  );
  await act(async () => {
    render(
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>,
    );
  });
  expect(screen.getByRole('tab', { name: /未开放/ })).toBeTruthy();
  expect((screen.getByRole('button', { name: '尚未开放' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect((screen.getByRole('button', { name: '开始作答' }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
