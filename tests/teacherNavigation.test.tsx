// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import App from '../client/App';
import { LoginPage } from '../client/pages/LoginPage';
vi.mock('../client/context', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => vi.fn(),
  useAuth: () => ({
    user: { id: 't', name: '老师', role: 'teacher' },
    loading: false,
    logout: vi.fn(),
    login: async (username: string) => ({
      id: username,
      name: '演示账号',
      role: username === 'teacher' ? 'teacher' : 'student',
    }),
  }),
}));
vi.mock('../client/pages/HomePage', () => ({ HomePage: () => <div>学生空间</div> }));
vi.mock('../client/pages/TeacherLibraryPage', () => ({
  TeacherLibraryPage: () => <div>教师题库页面</div>,
}));
vi.mock('../client/pages/TeacherInboxPage', () => ({
  TeacherInboxPage: () => <div>教师收卷页面</div>,
}));
afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});
it('教师题库入口与录题链接全部属于teacher，收卷链接不会同时高亮', async () => {
  window.history.replaceState({}, '', '/teacher/library');
  render(<App />);
  await screen.findByText('教师题库页面');
  const nav = within(screen.getByRole('navigation', { name: '主要导航' }));
  expect(nav.getByRole('link', { name: '题库与试卷' }).getAttribute('href')).toBe(
    '/teacher/library',
  );
  expect(nav.getByRole('link', { name: '题目录入' }).getAttribute('href')).toBe(
    '/teacher/library?tab=questions',
  );
  expect(nav.getByRole('link', { name: '收卷与批改' }).getAttribute('aria-current')).toBeNull();
  expect(screen.queryByText('管理后台')).toBeNull();
  expect(document.querySelector('a[href^="/admin"]')).toBeNull();
});
it('登录仅有学生/教师入口，从教师页切换学生登录会进入学生空间', async () => {
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: '/login', search: '?teacher=1', state: { from: '/teacher/library' } },
      ]}
    >
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>学生空间</div>} />
        <Route path="/teacher/library" element={<div>不应进入教师页</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: '管理员端' })).toBeNull();
  expect(screen.queryByText(/Admin123/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '学生端' }));
  expect(await screen.findByText('学生空间')).toBeTruthy();
});
