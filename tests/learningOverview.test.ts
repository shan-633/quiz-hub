import { expect, it } from 'vitest';
import { accuracyTone, learningCalendar, learningStage } from '../shared/learningOverview';
import type { AttemptSummary } from '../shared/learningOverview';
const record = (id: string, patch: Partial<AttemptSummary> = {}): AttemptSummary => ({
  id,
  title: id,
  libraryId: 'b',
  status: 'submitted',
  createdAt: '2026-10-20T00:00:00Z',
  submittedAt: '2026-10-20T23:30:00Z',
  updatedAt: '2026-10-22T02:00:00Z',
  questionCount: 2,
  answeredCount: 2,
  totalScore: 10,
  ...patch,
});
it('按北京时间交卷日聚合，多份试卷按题数计算正确率，待批改不拉低正确率', () => {
  const days = learningCalendar(
    [
      record('small', { performance: { correct: 1, partial: 1, total: 2, earned: 6, max: 10 } }),
      record('large', { performance: { correct: 3, partial: 0, total: 8, earned: 3, max: 8 } }),
      record('waiting', { reviewState: 'pending' }),
      record('active', { status: 'active' }),
    ],
    new Date('2026-10-22T00:00:00Z'),
  );
  expect(days).toHaveLength(84);
  expect(days[0].date).toBe('2026-08-03');
  const day = days.find((d) => d.date === '2026-10-21')!;
  expect(day).toMatchObject({ correct: 4, total: 10, accuracy: 40, pending: 1 });
  expect(day.attempts.map((a) => a.id)).toEqual(['small', 'large', 'waiting']);
  expect(days.find((d) => d.date === '2026-10-23')!.future).toBe(true);
});
it('旧记录使用更新时间，零分参与计算，待自评和未公布结果仍显示等待状态', () => {
  const days = learningCalendar(
    [
      record('zero', {
        submittedAt: undefined,
        performance: { correct: 0, partial: 0, total: 2, earned: 0, max: 10 },
      }),
    ],
    new Date('2026-10-22T00:00:00Z'),
  );
  expect(days.find((d) => d.date === '2026-10-22')!.accuracy).toBe(0);
  expect(
    learningStage(
      record('self', {
        gradingMode: 'self',
        selfReviewState: 'in_progress',
        reviewState: 'published',
      }),
    ),
  ).toBe('self');
  expect(learningStage(record('waiting', { reviewState: 'in_progress', earned: 10 }))).toBe(
    'pending',
  );
  expect(learningStage(record('old-zero', { earned: 0, pending: false }))).toBe('graded');
});
it('正确率颜色覆盖六个边界，未评卷独立为等待色', () => {
  for (const [value, tone] of [
    [100, 'perfect'],
    [90, 'strong'],
    [85, 'safe'],
    [75, 'steady'],
    [60, 'warning'],
    [59.9, 'risk'],
    [0, 'risk'],
    [undefined, 'waiting'],
  ] as const)
    expect(accuracyTone(value)).toBe(tone);
});
