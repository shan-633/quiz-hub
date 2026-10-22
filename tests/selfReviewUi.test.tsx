// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SelfReviewPage } from '../client/pages/SelfReviewPage';
vi.mock('../client/context', () => ({ useToast: () => () => {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('自评复用判分控件，选择自动分只读，非选择对照答案保存并完成', async () => {
  const base: any = {
    id: 'a',
    userId: 's',
    title: '展示练习',
    gradingMode: 'self',
    status: 'submitted',
    answers: {},
    questions: [
      {
        id: 'q1',
        type: 'single',
        score: 3,
        content: [],
        options: [{ id: 'a', text: '牛顿' }],
        blanks: [],
        solution: { choices: ['a'], blanks: {}, explanation: '力的单位是牛顿' },
      },
      {
        id: 'q2',
        type: 'fill',
        score: 4,
        content: [{ id: 'p', type: 'paragraph', text: '填写速度单位' }],
        options: [],
        blanks: [{ id: 'b', label: '速度单位', score: 4, kind: 'text' }],
        solution: {
          choices: [],
          blanks: { b: { accepted: ['m/s'] } },
          explanation: '标准答案解析',
        },
      },
    ],
    grades: {
      q1: { source: 'auto', earned: 3, max: 3, pending: false, status: 'correct', details: {} },
      q2: {
        source: 'pending',
        earned: 0,
        max: 4,
        pending: true,
        status: 'pending',
        details: { b: { earned: 0, max: 4, pending: true } },
      },
    },
    selfReview: { state: 'in_progress', revision: 1, feedback: {} },
  };
  let saved: any;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init?.method === 'PUT') {
      saved = JSON.parse(init.body as string);
      base.selfReview.revision++;
      base.selfReview.feedback.q2 = {
        ...saved,
        studentName: '自己',
        updatedAt: new Date().toISOString(),
      };
      base.grades.q2 = { ...base.grades.q2, earned: saved.score, pending: false, source: 'self' };
    }
    if (init?.method === 'POST') base.selfReview.state = 'completed';
    return { ok: true, json: async () => structuredClone(base) };
  });
  render(
    <MemoryRouter initialEntries={['/attempts/a/self-review']}>
      <Routes>
        <Route path="/attempts/:id/self-review" element={<SelfReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText('自动评分，不能修改')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '下一题' }));
  expect(screen.getByText('标准答案解析')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '部分正确' }));
  fireEvent.change(screen.getByLabelText('本题得分'), { target: { value: '2' } });
  fireEvent.click(screen.getByRole('button', { name: '保存本题自评' }));
  await screen.findByText('本题自评已保存');
  expect(saved.score).toBe(2);
  expect(saved.correctAnswer).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: '完成自评' }));
  fireEvent.click(screen.getByRole('button', { name: '确认完成' }));
  expect(await screen.findByText('自评已完成')).toBeTruthy();
});
it('零分主观小问仍显示人工自评控件，可确认而不会卡住', async () => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({
      id: 'zero',
      title: '零分说明',
      gradingMode: 'self',
      status: 'submitted',
      answers: {},
      questions: [
        {
          id: 'q',
          type: 'calculation',
          score: 0,
          content: [],
          options: [],
          blanks: [],
          solution: { choices: [], blanks: {}, explanation: '参考解答' },
        },
      ],
      grades: {
        q: {
          source: 'pending',
          earned: 0,
          max: 0,
          pending: true,
          status: 'pending',
          details: { open: { earned: 0, max: 0, pending: true } },
        },
      },
      selfReview: { state: 'in_progress', revision: 1, feedback: {} },
    }),
  }));
  render(
    <MemoryRouter initialEntries={['/attempts/zero/self-review']}>
      <Routes>
        <Route path="/attempts/:id/self-review" element={<SelfReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('button', { name: '正确' })).toBeTruthy();
  expect(screen.queryByText('自动评分，不能修改')).toBeNull();
  expect(screen.getByRole('button', { name: '保存本题自评' })).toBeTruthy();
});
