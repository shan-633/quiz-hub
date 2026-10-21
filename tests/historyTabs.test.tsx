// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HistoryPage } from '../client/pages/HistoryPage';
import { useLoad } from '../client/useLoad';
import { api } from '../client/api';
vi.mock('../client/useLoad', () => ({ useLoad: vi.fn() }));
vi.mock('../client/context', () => ({ useToast: () => vi.fn() }));
vi.mock('../client/api', async (original) => ({
  ...(await original<typeof import('../client/api')>()),
  api: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const record = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  title: id,
  libraryId: 'bank',
  status: 'submitted',
  questionCount: 6,
  answeredCount: 2,
  updatedAt: '2026-10-21T00:00:00Z',
  ...patch,
});
const records = () => [
  record('未完成练习', { status: 'active' }),
  record('新交答卷', { reviewState: 'pending' }),
  record('教师批改中', { reviewState: 'in_progress', earned: 999 }),
  record('已发布答卷', { reviewState: 'published', earned: 12 }),
  record('历史零分卷', { earned: 0, pending: false }),
  record('历史待评阅', { earned: 3, pending: true }),
  record('尚无结果的旧卷'),
];
function load(data = records()) {
  const reload = vi.fn();
  vi.mocked(useLoad).mockReturnValue({ data, loading: false, error: '', reload } as any);
  return reload;
}
function historyTree() {
  return (
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HistoryPage />} />
        <Route path="/attempts/new" element={<p>新的练习</p>} />
      </Routes>
    </MemoryRouter>
  );
}
function mount() {
  return render(historyTree());
}
const titles = () =>
  within(screen.getByRole('tabpanel'))
    .queryAllByRole('heading', { level: 2 })
    .map((el) => el.textContent);
it('按未完成、等待发布和已批改分区，兼容旧记录、零分和缺失成绩', () => {
  load();
  mount();
  expect(screen.getByRole('tab', { name: /全部.*7/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('tab', { name: /未答完.*1/ }));
  expect(titles()).toEqual(['未完成练习']);
  fireEvent.click(screen.getByRole('tab', { name: /待批改.*4/ }));
  expect(titles()).toEqual(['新交答卷', '教师批改中', '历史待评阅', '尚无结果的旧卷']);
  expect(within(screen.getByRole('tabpanel')).queryByText(/得分 999/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /已批改.*2/ }));
  expect(titles()).toEqual(['已发布答卷', '历史零分卷']);
  expect(screen.getByText(/得分 0 分/)).toBeTruthy();
});
it('刷新保留所选分区并更新数量，空分区可以返回全部', () => {
  const reload = load([record('待处理', { reviewState: 'pending' })]);
  const view = mount();
  fireEvent.click(screen.getByRole('tab', { name: /待批改/ }));
  fireEvent.click(screen.getByRole('button', { name: '刷新批改状态' }));
  expect(reload).toHaveBeenCalledOnce();
  load([record('待处理', { reviewState: 'published', earned: 6 })]);
  view.rerender(historyTree());
  expect(screen.getByRole('tab', { name: /待批改.*0/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('暂时没有待批改的作答')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看全部作答' }));
  expect(titles()).toEqual(['待处理']);
});
it('标签支持方向键与Home/End，继续、查看和再练一次仍然可用', async () => {
  load();
  mount();
  const all = screen.getByRole('tab', { name: /全部/ });
  all.focus();
  fireEvent.keyDown(all, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /未答完/ })).toBe(document.activeElement);
  expect(screen.getByRole('link', { name: /继续练习/ }).getAttribute('href')).toBe(
    '/attempts/未完成练习',
  );
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(screen.getByRole('tab', { name: /已批改/ })).toBe(document.activeElement);
  expect(screen.getAllByRole('link', { name: /查看作答/ })).toHaveLength(2);
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(all.getAttribute('aria-selected')).toBe('true');
  vi.mocked(api).mockResolvedValue({ id: 'new' });
  fireEvent.click(screen.getAllByRole('button', { name: /再练一次/ })[0]);
  expect(await screen.findByText('新的练习')).toBeTruthy();
  expect(api).toHaveBeenCalledWith(
    '/attempts',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ libraryId: 'bank', fresh: true }),
    }),
  );
});
it('没有作答时仍显示四个零数量标签及开始练习入口', () => {
  load([]);
  mount();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.getByText('第一份练习，等你开始')).toBeTruthy();
  expect(screen.getByRole('link', { name: /浏览试卷与题库/ }).getAttribute('href')).toBe(
    '/library',
  );
});
