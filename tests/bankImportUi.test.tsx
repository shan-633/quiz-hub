// @vitest-environment jsdom
import React from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BankImportDialog } from '../client/components/BankImportDialog';
import { api } from '../client/api';
vi.mock('../client/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client/api')>()),
  api: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const mount = () => {
  const imported = vi.fn();
  render(
    <MemoryRouter>
      <BankImportDialog onClose={() => {}} onImported={imported} />
    </MemoryRouter>,
  );
  return imported;
};
const select = (name = 'sample.json') =>
  fireEvent.change(screen.getByLabelText('题库JSON文件'), {
    target: { files: [new File(['{}'], name, { type: 'application/json' })] },
  });
it('校验失败显示路径与原因并阻止导入；更换文件清空旧校验', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    valid: false,
    errors: [{ path: '$.questions[0].score', code: 'score', message: '分值必须大于零' }],
    warnings: [],
  });
  mount();
  expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  select();
  fireEvent.click(screen.getByRole('button', { name: '校验文件' }));
  await screen.findByText('分值必须大于零');
  expect(screen.getByText('$.questions[0].score')).toBeTruthy();
  expect((screen.getByRole('button', { name: '确认导入' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  select('replacement.json');
  expect(screen.queryByText('分值必须大于零')).toBeNull();
});
it('校验成功后默认草稿，使用校验摘要提交，失败可重试且保留报告', async () => {
  vi.mocked(api).mockResolvedValueOnce({
    valid: true,
    digest: 'a'.repeat(64),
    errors: [],
    warnings: [],
    summary: {
      title: '测试库',
      questionCount: 1,
      totalScore: 2,
      imageCount: 0,
      types: { single: 1 },
      manualQuestionCount: 0,
    },
    preview: { questions: [], assetSources: {} },
  });
  vi.mocked(api).mockRejectedValueOnce(new Error('连接中断'));
  vi.mocked(api).mockResolvedValueOnce({
    bankId: 'newbank',
    title: '测试库',
    state: 'draft',
    questionCount: 1,
    reused: false,
  });
  const imported = mount();
  select();
  fireEvent.click(screen.getByRole('button', { name: '校验文件' }));
  await screen.findByText('校验通过');
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  await screen.findByText('连接中断');
  expect(screen.getByText('校验通过')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '确认导入' }));
  await screen.findByText('题库已导入');
  expect(imported).toHaveBeenCalledWith('newbank');
  const body = vi.mocked(api).mock.calls[1][1]?.body as FormData;
  expect(body.get('publish')).toBe('false');
  expect(body.get('digest')).toBe('a'.repeat(64));
});
it('拒绝错误扩展名与超大文件，不向服务器发送', async () => {
  mount();
  select('not-a-bank.pdf');
  fireEvent.click(screen.getByRole('button', { name: '校验文件' }));
  await screen.findByText('请选择.json格式的题库文件');
  expect(api).not.toHaveBeenCalled();
});
it('混合小问的真实标准选择答案也在预览中显示', async () => {
  const q = {
    id: 'mixed',
    bankId: 'preview',
    version: 0,
    state: 'draft',
    type: 'experiment',
    title: '实验判断',
    score: 2,
    difficulty: '基础',
    tags: [],
    blanks: [],
    options: [],
    content: [
      {
        id: 'part1',
        type: 'subquestion',
        label: '（1）判断',
        score: 2,
        responseKind: 'single',
        options: [
          { id: 'x', text: '断开开关' },
          { id: 'y', text: '闭合开关' },
        ],
        children: [{ id: 'p', type: 'paragraph', text: '连接时应如何操作？' }],
      },
    ],
    solution: {
      choices: [],
      blanks: {},
      partChoices: { part1: ['x'] },
      explanation: '先确保电路安全。',
    },
  };
  vi.mocked(api).mockResolvedValueOnce({
    valid: true,
    digest: 'a'.repeat(64),
    errors: [],
    warnings: [],
    summary: {
      title: '测试库',
      questionCount: 1,
      totalScore: 2,
      imageCount: 0,
      types: { experiment: 1 },
      manualQuestionCount: 0,
    },
    preview: { questions: [q], assetSources: {} },
  });
  mount();
  select();
  fireEvent.click(screen.getByRole('button', { name: '校验文件' }));
  await screen.findByText('（1）判断：A');
});
