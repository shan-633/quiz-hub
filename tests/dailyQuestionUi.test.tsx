// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DailyQuestionPanel } from '../client/components/DailyQuestionPanel';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('日历显示对应日期及红绿空色，历史可查看，今日按钮回到固定作答', async () => {
  const today = '2026-10-25';
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T02:00:00Z'));
  vi.stubGlobal('fetch', async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith('/start')
        ? { attemptId: 'fixed' }
        : {
            today,
            month: '2026-10',
            entries: [
              { date: '2026-10-23', result: 'correct', attemptId: 'right', available: true },
              { date: '2026-10-24', result: 'incorrect', attemptId: 'wrong', available: true },
              { date: today, result: null, attemptId: 'fixed', available: true },
            ],
            todayEntry: { date: today, result: null, attemptId: 'fixed', available: true },
          },
  }));
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<DailyQuestionPanel />} />
        <Route path="/attempts/:id" element={<p>固定每日作答页</p>} />
      </Routes>
    </MemoryRouter>,
  );
  const right = await screen.findByRole('button', { name: '2026-10-23 · 全对' });
  expect(right.className).toContain('correct');
  expect(screen.getByRole('button', { name: '2026-10-24 · 未全对' }).className).toContain(
    'incorrect',
  );
  expect(screen.getByRole('button', { name: '2026-10-25 · 未交卷' }).className).toContain('empty');
  expect(screen.getByRole('button', { name: '2026-10-22 · 未做' }).className).toContain('empty');
  fireEvent.click(right);
  expect(
    within(screen.getByLabelText('每日一题当天详情'))
      .getByRole('link', { name: /查看作答与解析/ })
      .getAttribute('href'),
  ).toBe('/attempts/right');
  fireEvent.click(screen.getByRole('button', { name: /继续今日一题/ }));
  expect(await screen.findByText('固定每日作答页')).toBeTruthy();
});
