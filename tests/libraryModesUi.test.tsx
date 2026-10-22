// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HomePage } from '../client/pages/HomePage';
import { TeacherLibraryPage } from '../client/pages/TeacherLibraryPage';
import { HistoryPage } from '../client/pages/HistoryPage';
import { TasksPage } from '../client/pages/TasksPage';
vi.mock('../client/context', () => ({
  useAuth: () => ({ user: { id: 's', role: 'student' } }),
  useToast: () => () => {},
}));
vi.mock('../client/chatContext', () => ({ useChat: () => ({ contacts: [], status: 'live' }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const response = (data: unknown) => ({ ok: true, json: async () => data });
const bank = {
  id: 's',
  deliveryMode: 'showcase',
  title: '展示例子',
  kind: 'bank',
  description: '',
  state: 'published',
  chapter: '',
  accent: 'mechanics',
  questionCount: 1,
  totalScore: 3,
  minutes: 20,
};
it('学生首页展示练习单独显示，分配内容引导至班级任务', async () => {
  vi.stubGlobal('fetch', async (url: string) =>
    response(
      url.endsWith('/library')
        ? [bank, { ...bank, id: 'a', deliveryMode: 'assigned', title: '分配例子' }]
        : [],
    ),
  );
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('展示例子')).toBeTruthy();
  expect(screen.queryByText('分配例子')).toBeNull();
  expect(screen.getByRole('link', { name: /查看班级任务/ })).toBeTruthy();
});
it('教师按展示和分配分区，编辑类别并保存', async () => {
  let saved: any;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init?.method === 'PUT') {
      saved = JSON.parse(init.body as string);
      return response(saved);
    }
    return response(url.endsWith('/banks') ? [bank] : []);
  });
  render(
    <MemoryRouter>
      <TeacherLibraryPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /展示练习/ }));
  fireEvent.click(screen.getByRole('button', { name: '编辑题库' }));
  fireEvent.change(screen.getByLabelText('内容类别'), { target: { value: 'assigned' } });
  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await screen.findByText('展示例子');
  expect(saved.deliveryMode).toBe('assigned');
});
it('历史将已交展示练习列入待自评，可直接进入自评', async () => {
  vi.stubGlobal('fetch', async () =>
    response([
      {
        id: 'a',
        title: '我的展示作答',
        libraryId: 's',
        status: 'submitted',
        gradingMode: 'self',
        selfReviewState: 'in_progress',
        reviewState: 'published',
        earned: 3,
        pending: true,
        questionCount: 2,
        answeredCount: 2,
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
  render(
    <MemoryRouter>
      <HistoryPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: /待自评/ }));
  expect((await screen.findByRole('link', { name: /继续自评/ })).getAttribute('href')).toBe(
    '/attempts/a/self-review',
  );
});
it('已收到的任务保留打印入口，并将所选推送ID传给PDF接口', async () => {
  let exported: any;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/pdf')) {
      exported = { url, body: JSON.parse(init!.body as string) };
      return { ok: false, status: 422, json: async () => ({ message: '测试生成请求已收到' }) };
    }
    return response([
      {
        id: 'task-old',
        title: '旧任务',
        libraryId: 'bank',
        teacherName: '老师',
        groupNames: ['一班'],
        questionCount: 2,
        totalScore: 6,
        status: 'not_started',
      },
    ]);
  });
  render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '打印题目' }));
  expect(screen.getByRole('heading', { name: '生成打印 PDF' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await screen.findByRole('alert');
  expect(exported).toEqual({ url: '/api/library/bank/pdf', body: { assignmentId: 'task-old' } });
});
