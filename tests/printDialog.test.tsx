// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrintPdfDialog } from '../client/components/PrintPdfDialog';
import { HomePage } from '../client/pages/HomePage';
import { api, apiFile } from '../client/api';
import { useAuth } from '../client/context';
import { useLoad } from '../client/useLoad';
import type { LibraryItem } from '../shared/model';
vi.mock('../client/api', async (original) => ({
  ...(await original<typeof import('../client/api')>()),
  apiFile: vi.fn(),
  api: vi.fn(async () => []),
}));
vi.mock('../client/context', () => ({
  useAuth: vi.fn(() => ({ user: { id: 's', role: 'student' } })),
  useToast: () => vi.fn(),
}));
vi.mock('../client/useLoad', () => ({ useLoad: vi.fn() }));
const bank: LibraryItem = {
  id: 'b',
  title: '力学题库',
  kind: 'bank',
  state: 'published',
  description: '',
  chapter: '八年级',
  accent: 'mechanics',
  questionCount: 6,
  totalScore: 25,
  minutes: 30,
};
beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:print-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ user: { id: 's', role: 'student' } } as any);
});
const file = () => ({
  blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
  filename: '力学题库_作答版_A4.pdf',
  pages: 3,
  questionCount: 6,
});
it('选择作答/大字后生成真PDF，显示页数与预览/下载，改变设置使旧文件失效并释放URL', async () => {
  vi.mocked(apiFile).mockResolvedValue(file());
  const view = render(
    <MemoryRouter>
      <PrintPdfDialog item={bank} onClose={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByLabelText('作答版'));
  fireEvent.click(screen.getByLabelText('大字 · 14 磅'));
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await screen.findByRole('link', { name: '下载 PDF' });
  expect(apiFile).toHaveBeenCalledWith(
    '/library/b/pdf',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ mode: 'writing', fontSize: 'large' }),
    }),
  );
  expect(screen.getByText(/共 3 页/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '打开 PDF 预览' }).getAttribute('href')).toBe(
    'blob:print-test',
  );
  expect(screen.getByRole('link', { name: '下载 PDF' }).getAttribute('download')).toBe(
    '力学题库_作答版_A4.pdf',
  );
  fireEvent.click(screen.getByLabelText('标准 · 12 磅'));
  expect(screen.queryByRole('link', { name: '下载 PDF' })).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:print-test');
  view.unmount();
});
it('生成失败明确显示原因，可以重试；匿名需先登录', async () => {
  vi.mocked(apiFile)
    .mockRejectedValueOnce(new Error('图片缺失，请教师补齐'))
    .mockResolvedValueOnce(file());
  render(
    <MemoryRouter>
      <PrintPdfDialog item={bank} onClose={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '图片缺失，请教师补齐');
  fireEvent.click(screen.getByRole('button', { name: '生成 PDF' }));
  await screen.findByRole('link', { name: '下载 PDF' });
  cleanup();
  vi.mocked(useAuth).mockReturnValue({ user: null } as any);
  render(
    <MemoryRouter>
      <PrintPdfDialog item={bank} onClose={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: '登录后生成' }).getAttribute('href')).toBe(
    '/login?print=b',
  );
  expect(screen.queryByRole('button', { name: '生成 PDF' })).toBeNull();
});
it('题库和试卷卡片都提供入口，登录后的print参数能继续打开生成弹窗', async () => {
  const paper = { ...bank, id: 'p', kind: 'paper' as const, title: '中考试卷' };
  vi.mocked(useLoad).mockReturnValue({
    data: [bank, paper],
    loading: false,
    error: '',
    reload: vi.fn(),
  } as any);
  render(
    <MemoryRouter initialEntries={['/library?print=p']}>
      <HomePage />
    </MemoryRouter>,
  );
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByText('中考试卷')[0]).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: '关闭弹窗' }));
  const article = screen.getByRole('heading', { name: '力学题库' }).closest('article')!;
  fireEvent.click(within(article).getByRole('button', { name: '打印 PDF' }));
  await waitFor(() =>
    expect(within(screen.getByRole('dialog')).getAllByText('力学题库')[0]).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { name: '打印 PDF' })).toHaveLength(2);
  expect(api).toHaveBeenCalledWith('/attempts');
});
