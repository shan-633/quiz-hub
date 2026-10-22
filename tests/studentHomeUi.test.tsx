// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { StudentHomePage } from '../client/pages/StudentHomePage';
const state = vi.hoisted(() => ({ conversations: [] as any[] }));
vi.mock('../client/context', () => ({
  useAuth: () => ({ user: { id: 's', name: '小林', role: 'student' } }),
}));
vi.mock('../client/chatContext', () => ({
  useChat: () => ({
    contacts: [],
    conversations: state.conversations,
    revision: 0,
    status: 'live',
    error: '',
    reload: () => {},
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.conversations = [];
  vi.useRealTimers();
});
const at = new Date().toISOString();
it('首页任务跨过开放时间后更新可用状态，不需要重新请求', async () => {
  vi.useFakeTimers();
  const opensAt = new Date(Date.now() + 1000).toISOString();
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/tasks')
        ? [
            {
              id: 'future',
              libraryId: 'b',
              title: '定时推送',
              status: 'scheduled',
              opensAt,
              createdAt: at,
              teacherName: '陈老师',
              groupNames: [],
              questionCount: 2,
              totalScore: 6,
            },
          ]
        : [],
  }));
  await act(async () => {
    render(
      <MemoryRouter>
        <StudentHomePage />
      </MemoryRouter>,
    );
  });
  expect(screen.getByText('未开放')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1100);
  });
  expect(screen.getByText('未开始')).toBeTruthy();
});
function mount(rows: any[] = []) {
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    json: async () => {
      if (url.endsWith('/attempts')) return rows;
      if (url.endsWith('/tasks'))
        return [
          {
            id: 'task-new',
            title: '刚收到的电学卷',
            libraryId: 'b',
            createdAt: at,
            teacherName: '陈老师',
            groupNames: ['一班'],
            status: 'not_started',
            questionCount: 26,
            totalScore: 70,
          },
        ];
      if (url.endsWith('/library')) return [];
      throw new Error(`Unexpected request ${url}`);
    },
  }));
  return render(
    <MemoryRouter>
      <StudentHomePage />
    </MemoryRouter>,
  );
}
it('首页汇总新任务、真实教师消息和可继续的作答，链接直达对应内容', async () => {
  state.conversations = [
    {
      id: 'chat1',
      peer: { id: 't', name: '陈老师', role: 'teacher' },
      unread: 2,
      canSend: true,
      updatedAt: at,
      lastMessage: '这是学生自己的回复',
      latestReceived: { body: '记得写清计算过程', createdAt: at },
    },
  ];
  mount([
    {
      id: 'active',
      title: '未完成的力学卷',
      status: 'active',
      libraryId: 'old-assigned',
      questionCount: 26,
      answeredCount: 8,
      updatedAt: at,
      createdAt: at,
      totalScore: 70,
    },
  ]);
  const tasks = await screen.findByRole('region', { name: '最新收到' });
  expect(
    within(tasks)
      .getByRole('link', { name: /刚收到的电学卷/ })
      .getAttribute('href'),
  ).toBe('/tasks#task-task-new');
  expect(screen.getByRole('link', { name: /继续作答/ }).getAttribute('href')).toBe(
    '/attempts/active',
  );
  expect(screen.getByText('记得写清计算过程')).toBeTruthy();
  expect(screen.queryByText('这是学生自己的回复')).toBeNull();
  expect(screen.getByRole('link', { name: /陈老师.*记得写清/ }).getAttribute('href')).toBe(
    '/chat?conversation=chat1',
  );
});
it('点击热力格可查看已评正确题数与分数，待批改不会显示假成绩', async () => {
  mount([
    {
      id: 'graded',
      title: '已批改的试卷',
      status: 'submitted',
      submittedAt: at,
      createdAt: at,
      updatedAt: at,
      libraryId: 'b',
      questionCount: 4,
      answeredCount: 4,
      totalScore: 10,
      reviewState: 'published',
      performance: { correct: 3, partial: 1, total: 4, earned: 9, max: 10 },
    },
    {
      id: 'waiting',
      title: '等待教师的试卷',
      status: 'submitted',
      submittedAt: at,
      createdAt: at,
      updatedAt: at,
      libraryId: 'b',
      questionCount: 4,
      answeredCount: 4,
      totalScore: 10,
      reviewState: 'pending',
      earned: 999,
    },
  ]);
  const day = await screen.findByRole('button', { name: /正确率75%.*1份待评/ });
  fireEvent.click(day);
  const details = screen.getByRole('region', { name: '当天作答详情' });
  expect(within(details).getByText(/3 \/ 4 题全对/)).toBeTruthy();
  expect(within(details).getByText(/9 \/ 10 分/)).toBeTruthy();
  expect(within(details).getByText('等待教师的试卷')).toBeTruthy();
  expect(screen.queryByText(/999/)).toBeNull();
  day.focus();
  fireEvent.keyDown(day, { key: 'ArrowLeft' });
  expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).not.toBe(day);
  expect(within(details).getByText(/这一天还没有交卷记录/)).toBeTruthy();
});
it('没有作答时显示空日历，灰格不会伪造正确率', async () => {
  mount();
  const calendar = await screen.findByLabelText('最近12周作答正确率热力图');
  expect(within(calendar).queryByRole('button', { name: /正确率/ })).toBeNull();
  expect(within(calendar).getAllByRole('button')).toHaveLength(84);
  expect(screen.getByText(/这一天还没有交卷记录/)).toBeTruthy();
});
it('空历史不伪造热力数据，单个模块失败后其他模块仍可使用', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/attempts'))
      return { ok: false, status: 503, json: async () => ({ message: '作答暂不可用' }) };
    return { ok: true, json: async () => [] };
  });
  render(
    <MemoryRouter>
      <StudentHomePage />
    </MemoryRouter>,
  );
  expect(await screen.findAllByText('作答暂不可用')).not.toHaveLength(0);
  expect(screen.getByRole('link', { name: /全部任务/ })).toBeTruthy();
  expect(screen.queryByText('0%')).toBeNull();
  expect(screen.getByText('还没有教师消息')).toBeTruthy();
});
