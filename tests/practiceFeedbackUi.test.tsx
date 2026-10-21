// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AttemptPage } from '../client/pages/AttemptPage';
import { useLoad } from '../client/useLoad';
import type { Attempt, Grade } from '../shared/model';
vi.mock('../client/useLoad', () => ({ useLoad: vi.fn() }));
vi.mock('../client/context', () => ({ useToast: () => vi.fn() }));
vi.mock('../client/components/QuestionRenderer', () => ({
  QuestionRenderer: () => <div>测试题干</div>,
}));
vi.mock('../client/useAnswerSync', () => ({
  useAnswerSync: (a: Attempt) => ({
    ready: true,
    status: 'saved',
    error: '',
    conflicts: {},
    uploads: { pending: [] },
    get: (id: string) =>
      a.answers[id]?.data ?? {
        choiceIds: [],
        blankValues: {},
        markdown: '',
        drawingPages: [],
        imagePages: [],
        parts: {},
        flagged: false,
      },
  }),
}));
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function fixture(statuses: Grade['status'][]): Attempt {
  return {
    id: 'result',
    userId: 'student',
    libraryId: 'bank',
    title: '反馈测试',
    status: 'submitted',
    createdAt: 'now',
    updatedAt: 'now',
    answers: {},
    questions: statuses.map((s, i) => ({
      id: 'q' + i,
      bankId: 'bank',
      version: 1,
      type: 'single',
      title: '题' + i,
      score: i === 0 ? 100 : 2,
      state: 'published',
      difficulty: '基础',
      tags: [],
      content: [],
      options: [],
      blanks: [],
      solution: { choices: [], blanks: {}, explanation: '参考解析' },
    })),
    grades: Object.fromEntries(
      statuses.map((status, i) => [
        'q' + i,
        {
          status,
          pending: status === 'pending',
          earned: status === 'correct' ? (i === 0 ? 100 : 2) : status === 'partial' ? 1 : 0,
          max: i === 0 ? 100 : 2,
          details: {},
        },
      ]),
    ),
  };
}
function mount(a: Attempt) {
  vi.mocked(useLoad).mockReturnValue({
    data: a,
    loading: false,
    error: '',
    reload: vi.fn(),
  } as any);
  return render(
    <MemoryRouter initialEntries={['/attempts/result']}>
      <Routes>
        <Route path="/attempts/:id" element={<AttemptPage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it('顶部按分值加权显示得分，部分分计入；答题卡对错和光圈保持独立', () => {
  const { container } = mount(
    fixture(['correct', 'incorrect', 'partial', 'unanswered', 'pending']),
  );
  const banner = container.querySelector('.result-banner')!;
  expect(banner.classList.contains('result-excellent')).toBe(true);
  expect(banner.textContent).toContain('101 / 108');
  expect(banner.textContent).toContain('95.2%');
  expect(banner.textContent).toContain('2 分待评阅');
  expect(banner.textContent).not.toContain('正确率');
  const first = screen.getByRole('button', { name: /第 1 题，回答正确/ });
  const second = screen.getByRole('button', { name: /第 2 题，回答错误/ });
  expect(first.classList.contains('nav-correct')).toBe(true);
  expect(first.getAttribute('aria-current')).toBe('step');
  fireEvent.click(second);
  expect(second.classList.contains('nav-incorrect')).toBe(true);
  expect(second.getAttribute('aria-current')).toBe('step');
  expect(first.classList.contains('nav-correct')).toBe(true);
  expect(first.hasAttribute('aria-current')).toBe(false);
  expect(
    screen.getByRole('button', { name: /第 3 题，部分正确/ }).classList.contains('nav-partial'),
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: /第 4 题，未作答/ }).classList.contains('nav-unanswered'),
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: /第 5 题，待评阅/ }).classList.contains('nav-pending'),
  ).toBe(true);
});
it('全部待评阅不显示红色或虚假的100%正确率', () => {
  const { container } = mount(fixture(['pending']));
  const banner = container.querySelector('.result-banner')!;
  expect(banner.classList.contains('result-pending')).toBe(true);
  expect(banner.textContent).not.toContain('100%');
  expect(banner.textContent).toContain('等待评阅');
});
it('已判部分满分仍明确限定分值范围，待评阅分数不当作零分', () => {
  const { container } = mount(fixture(['correct', 'pending']));
  const banner = container.querySelector('.result-banner')!;
  expect(banner.textContent).toContain('已判部分拿到满分');
  expect(banner.textContent).toContain('100 / 102');
  expect(banner.textContent).toContain('已判部分得分率');
  expect(banner.textContent).toContain('2 分待评阅');
});
