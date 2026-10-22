// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from '../client/pages/AdminPage';
import { ChatPage } from '../client/pages/ChatPage';
import { PasswordPage } from '../client/pages/PasswordPage';
import { HomePage } from '../client/pages/HomePage';
const state = vi.hoisted(() => ({
  canSend: true,
  revision: 0,
  unread: 0,
  contacts: [] as any[],
  user: { id: 's', name: '学生', username: 'student', role: 'student', mustChangePassword: false },
  reload: vi.fn(),
  login: vi.fn(),
}));
vi.mock('../client/context', () => ({
  useAuth: () => ({ user: state.user, login: state.login }),
  useToast: () => () => {},
}));
vi.mock('../client/chatContext', () => ({
  useChat: () => ({
    conversations: [
      {
        id: 'c',
        peer: { id: 't', name: '陈老师', username: 'teacher', role: 'teacher' },
        canSend: state.canSend,
        unread: state.unread,
        updatedAt: '2026-10-22T00:00:00Z',
      },
    ],
    contacts: state.contacts,
    revision: state.revision,
    status: 'live',
    reload: state.reload,
    error: '',
  }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  state.canSend = true;
  state.user.mustChangePassword = false;
  state.revision = 0;
  state.unread = 0;
  state.contacts = [];
});
const response = (data: any) => ({ ok: true, json: async () => data });
it('首页消息链接直接打开已有会话，未知会话参数不能触发读取', async () => {
  const paths: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    paths.push(url);
    return response({
      messages: [
        {
          id: 1,
          conversationId: 'c',
          senderId: 't',
          clientMessageId: 'home-message',
          body: '从首页打开的教师消息',
          createdAt: '2026-10-22T00:00:00Z',
        },
      ],
      hasMore: false,
    });
  });
  const view = render(
    <MemoryRouter initialEntries={['/chat?conversation=c']}>
      <ChatPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('从首页打开的教师消息')).toBeTruthy();
  expect(screen.getByLabelText('消息内容')).toBeTruthy();
  view.unmount();
  paths.length = 0;
  render(
    <MemoryRouter initialEntries={['/chat?conversation=foreign']}>
      <ChatPage />
    </MemoryRouter>,
  );
  expect(paths.some((p) => p.includes('foreign'))).toBe(false);
  expect(screen.queryByLabelText('消息内容')).toBeNull();
});
it('管理员创建账号后仅本次显示临时密码，角色和归属入口可用', async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init?.method === 'POST')
      return response({
        user: { id: 'new', username: 'newstudent', role: 'student' },
        temporaryPassword: 'OnlyOnceTemporary123!',
      });
    return response(
      url.includes('/relations') ? { users: [], links: [] } : { users: [], page: 1, total: 0 },
    );
  });
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: '创建账号' }));
  fireEvent.change(screen.getByLabelText('登录账号'), { target: { value: 'newstudent' } });
  fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '新同学' } });
  fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
  expect(await screen.findByText('OnlyOnceTemporary123!')).toBeTruthy();
  expect(screen.getByRole('button', { name: '师生关系' })).toBeTruthy();
});
it('聊天安全显示文字并发送，解除关系的会话只读', async () => {
  let sent = false;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    if (init?.method === 'POST') {
      sent = true;
      return response({
        id: 2,
        conversationId: 'c',
        senderId: 's',
        clientMessageId: 'id',
        body: '请问这道题',
        createdAt: '2026-10-22T00:00:00Z',
      });
    }
    return response({
      messages: [
        {
          id: 1,
          conversationId: 'c',
          senderId: 't',
          clientMessageId: 'x',
          body: '<script>不是HTML</script>',
          createdAt: '2026-10-22T00:00:00Z',
        },
      ],
      hasMore: false,
    });
  });
  const view = render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /陈老师/ }));
  expect(await screen.findByText('<script>不是HTML</script>')).toBeTruthy();
  expect(document.querySelector('script')).toBeNull();
  fireEvent.change(screen.getByLabelText('消息内容'), { target: { value: '请问这道题' } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  });
  expect(sent).toBe(true);
  expect(await screen.findByText('请问这道题')).toBeTruthy();
  state.canSend = false;
  view.rerender(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  );
  expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByText(/师生关系已解除/)).toBeTruthy();
});
it('临时密码必须修改，新密码两次不一致时不发送', async () => {
  state.user.mustChangePassword = true;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <PasswordPage />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'Temporary123!' } });
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'ChangedPassword123!' } });
  fireEvent.change(screen.getByLabelText('再次输入新密码'), {
    target: { value: 'DifferentPassword123!' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存新密码' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '两次输入的新密码不一致');
  expect(fetch).not.toHaveBeenCalled();
});
it('重连后超过50条新消息按游标补齐，不会留下无法加载的消息缺口', async () => {
  let online = false;
  const message = (id: number) => ({
    id,
    conversationId: 'c',
    senderId: 't',
    clientMessageId: `m${id}`,
    body: `顺序消息-${id}`,
    createdAt: '2026-10-22T00:00:00Z',
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (!online) return response({ messages: [message(1)], hasMore: false });
    const after = new URL('http://test' + url).searchParams.get('after');
    if (after !== null) {
      const start = Number(after) + 1;
      return response({
        messages: Array.from({ length: Math.max(0, Math.min(50, 65 - start)) }, (_, i) =>
          message(start + i),
        ),
        hasMore: start + 50 < 65,
      });
    }
    return response({
      messages: Array.from({ length: 50 }, (_, i) => message(i + 15)),
      hasMore: true,
    });
  });
  const view = render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /陈老师/ }));
  await screen.findByText('顺序消息-1');
  online = true;
  state.revision++;
  view.rerender(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('顺序消息-64')).toBeTruthy();
  expect(screen.getByText('顺序消息-2')).toBeTruthy();
  expect(screen.getByText('顺序消息-51')).toBeTruthy();
});
it('已读提交失败后，刷新会再次确认同一条消息', async () => {
  state.unread = 1;
  let reads = 0;
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.endsWith('/read')) {
      reads++;
      return reads === 1
        ? { ok: false, status: 500, json: async () => ({ message: '已读保存失败' }) }
        : response({ ok: true });
    }
    return response({
      messages: [
        {
          id: 9,
          conversationId: 'c',
          senderId: 't',
          clientMessageId: 'x',
          body: '未读消息',
          createdAt: '2026-10-22T00:00:00Z',
        },
      ],
      hasMore: false,
    });
  });
  const view = render(
    <MemoryRouter>
      <ChatPage />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /陈老师/ }));
  await screen.findByText('已读保存失败');
  expect(reads).toBe(1);
  state.revision++;
  await act(async () => {
    view.rerender(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>,
    );
  });
  expect(reads).toBe(2);
});
it('师生关系变化后学生目录自动更新，不必刷新整个页面', async () => {
  let assigned = false;
  vi.stubGlobal('fetch', async (url: string) =>
    response(
      url.includes('/library') && assigned
        ? [
            {
              id: 'new-bank',
              kind: 'bank',
              title: '新分配的力学练习',
              description: '关联教师的题库',
              chapter: '力学',
              accent: 'mechanics',
              state: 'published',
              questionCount: 1,
              totalScore: 2,
              minutes: 5,
            },
          ]
        : [],
    ),
  );
  const view = render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  await screen.findByText('暂时没有可用练习');
  assigned = true;
  state.contacts = [{ id: 't', name: '陈老师', role: 'teacher', username: 'teacher' }];
  view.rerender(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  expect(await screen.findByText('新分配的力学练习')).toBeTruthy();
  assigned = false;
  state.contacts = [];
  view.rerender(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  await screen.findByText('暂时没有可用练习');
  expect(screen.queryByText('新分配的力学练习')).toBeNull();
});
