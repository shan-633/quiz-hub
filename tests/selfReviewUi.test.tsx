// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SelfReviewPage } from '../client/pages/SelfReviewPage';
vi.mock('../client/context', () => ({ useToast: () => () => {} }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('旧版仅选择小问的自评不被灰色旧成绩卡住，可完成并校准自动结果', async () => {
  const response = {
    choiceIds: ['a'],
    blankValues: {},
    markdown: '',
    drawingPages: [],
    imagePages: [],
  };
  const q: any = {
    id: 'old-choice-parts',
    title: '旧版计算选择小问',
    type: 'calculation',
    score: 6,
    options: [],
    blanks: [],
    content: [1, 2].map((n) => ({
      id: 'p' + n,
      type: 'subquestion',
      label: '选择' + n,
      score: 2,
      responseKind: 'single',
      options: [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
      ],
      children: [],
    })),
    solution: {
      choices: [],
      blanks: {},
      partChoices: { p1: ['a'], p2: ['a'] },
      explanation: '参考答案',
    },
  };
  const a: any = {
    id: 'auto',
    title: '旧版自评',
    gradingMode: 'self',
    status: 'submitted',
    questions: [q],
    answers: {
      [q.id]: {
        revision: 1,
        data: { ...response, parts: { p1: response, p2: response }, flagged: false },
      },
    },
    selfReview: { state: 'in_progress', revision: 1, feedback: {} },
    grades: {
      [q.id]: {
        earned: 0,
        max: 6,
        pending: true,
        status: 'pending',
        details: { whole: { earned: 0, max: 6, pending: true } },
      },
    },
  };
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      a.selfReview.state = 'completed';
      a.grades[q.id] = { earned: 6, max: 6, pending: false, status: 'correct', details: {} };
    }
    return { ok: true, json: async () => structuredClone(a) };
  });
  render(
    <MemoryRouter initialEntries={['/attempts/auto/self-review']}>
      <Routes>
        <Route path="/attempts/:id/self-review" element={<SelfReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const finish = await screen.findByRole('button', { name: '完成自评' });
  expect((finish as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(finish);
  fireEvent.click(screen.getByRole('button', { name: '确认完成' }));
  expect(await screen.findByText('自评已完成')).toBeTruthy();
});
it('学生自评的多个空格也必须分别确认，漏评不能保存或切题', async () => {
  let puts = 0;
  const a: any = {
    id: 'columns',
    title: '多空自评',
    status: 'submitted',
    gradingMode: 'self',
    selfReview: { state: 'in_progress', revision: 1, feedback: {} },
    answers: {},
    questions: [
      {
        id: 'q',
        type: 'fill',
        score: 4,
        options: [],
        blanks: [
          { id: 'a', label: '第1空', score: 2, kind: 'text' },
          { id: 'b', label: '第2空', score: 2, kind: 'text' },
        ],
        content: [{ id: 'p', type: 'paragraph', text: '{{a}} {{b}}' }],
        solution: {
          choices: [],
          blanks: { a: { accepted: ['甲'] }, b: { accepted: ['乙'] } },
          explanation: '',
        },
      },
      {
        id: 'next',
        type: 'single',
        score: 2,
        options: [],
        blanks: [],
        content: [],
        solution: { choices: [], blanks: {}, explanation: '' },
      },
    ],
    grades: {
      q: { earned: 0, max: 4, pending: true, status: 'pending', details: {} },
      next: { earned: 0, max: 2, pending: false, status: 'incorrect', details: {} },
    },
  };
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts++;
      throw Error('本测试不应保存不完整栏目');
    }
    return { ok: true, json: async () => a };
  });
  render(
    <MemoryRouter initialEntries={['/attempts/columns/self-review']}>
      <Routes>
        <Route path="/attempts/:id/self-review" element={<SelfReviewPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const first = await screen.findByRole('group', { name: '评分栏目：第1空' });
  fireEvent.click(within(first).getByRole('button', { name: '正确' }));
  fireEvent.click(screen.getByRole('button', { name: '保存本题自评' }));
  expect(screen.getByRole('alert').textContent).toContain('第2空');
  fireEvent.click(screen.getByRole('button', { name: '下一题' }));
  expect(screen.getByRole('group', { name: '评分栏目：第2空' })).toBeTruthy();
  expect(puts).toBe(0);
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
