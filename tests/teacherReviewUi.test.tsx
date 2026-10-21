// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TeacherReviewPage } from '../client/pages/TeacherReviewPage';
import { useLoad } from '../client/useLoad';
import { api, ApiError } from '../client/api';
import type { Attempt } from '../shared/model';
vi.mock('../client/useLoad', () => ({ useLoad: vi.fn() }));
vi.mock('../client/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../client/api')>()),
  api: vi.fn(),
}));
vi.mock('../client/context', () => ({ useToast: () => vi.fn() }));
vi.mock('../client/components/QuestionRenderer', () => ({
  QuestionRenderer: () => <div>学生原始作答</div>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const fixture = (): Attempt => ({
  id: 'a',
  userId: 'u',
  libraryId: 'b',
  title: '批改测试卷',
  status: 'submitted',
  createdAt: 'now',
  updatedAt: 'now',
  answers: {},
  review: {
    state: 'pending',
    revision: 1,
    receivedAt: 'now',
    autoEligible: true,
    autoCount: 0,
    autoReason: '其他题人工批改',
  },
  questions: [
    {
      id: 'q',
      version: 1,
      bankId: 'b',
      type: 'calculation',
      title: '计算',
      score: 8,
      difficulty: '基础',
      tags: [],
      content: [],
      options: [],
      blanks: [],
      state: 'published',
      solution: { choices: [], blanks: {}, explanation: 'F=10N' },
    },
  ],
  grades: { q: { earned: 0, max: 8, status: 'pending', pending: true, details: {} } },
});
function mount(a = fixture()) {
  vi.mocked(useLoad).mockReturnValue({
    data: { ...a, student: { name: '张同学', username: 'student' }, kind: 'paper' },
    loading: false,
    error: '',
    reload: vi.fn(),
  } as any);
  return render(
    <MemoryRouter initialEntries={['/teacher/attempts/a']}>
      <Routes>
        <Route path="/teacher/attempts/:id" element={<TeacherReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('手工判定会填写对应分数，并保存正确答案和评语，待评题不能直接发布', async () => {
  mount();
  expect(screen.getAllByText('学生原始作答').length).toBe(2);
  expect((screen.getByRole('button', { name: '发布批改结果' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.click(screen.getByRole('button', { name: '正确' }));
  expect((screen.getByLabelText('本题得分') as HTMLInputElement).value).toBe('8');
  fireEvent.click(screen.getByRole('button', { name: '部分正确' }));
  fireEvent.change(screen.getByLabelText('本题得分'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('正确答案'), { target: { value: '正确过程' } });
  fireEvent.change(screen.getByLabelText('教师评语'), { target: { value: '注意单位' } });
  const saved = fixture();
  saved.review!.revision = 2;
  saved.grades!.q = {
    earned: 3,
    max: 8,
    status: 'partial',
    pending: false,
    source: 'teacher',
    details: {},
  };
  vi.mocked(api).mockResolvedValueOnce(saved);
  fireEvent.click(screen.getByRole('button', { name: '保存本题批改' }));
  await waitFor(() => expect(api).toHaveBeenCalled());
  expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string)).toMatchObject({
    expectedRevision: 1,
    verdict: 'partial',
    score: 3,
    correctAnswer: '正确过程',
    comment: '注意单位',
  });
});
it('版本冲突保留教师未保存文本，提供载入最新版本操作', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: '错误' }));
  fireEvent.change(screen.getByLabelText('教师评语'), { target: { value: '不能丢失的评语' } });
  vi.mocked(api).mockRejectedValueOnce(new ApiError('批改已更新', 409, {}));
  fireEvent.click(screen.getByRole('button', { name: '保存本题批改' }));
  await screen.findByRole('button', { name: '载入最新批改' });
  expect((screen.getByLabelText('教师评语') as HTMLTextAreaElement).value).toBe('不能丢失的评语');
});
