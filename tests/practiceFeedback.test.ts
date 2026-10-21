import { describe, it, expect } from 'vitest';
import { getAccuracyFeedback, summarizeResult, navigatorState } from '../client/practiceFeedback';
import type { Grade } from '../shared/model';

const grade = (status: Grade['status'], earned = 0, max = 2): Grade => ({
  status,
  earned,
  max,
  pending: status === 'pending',
  details: {},
});
describe('正确率反馈分档', () => {
  it.each([
    [100, 'perfect'],
    [99.9, 'excellent'],
    [90, 'excellent'],
    [89.9, 'secure'],
    [85, 'secure'],
    [84.9, 'caution'],
    [75, 'caution'],
    [74.9, 'warning'],
    [60, 'warning'],
    [59.9, 'danger'],
    [0, 'danger'],
  ] as const)('%s%% 对应 %s，不按得分分档', (percent, band) => {
    expect(getAccuracyFeedback(percent).band).toBe(band);
  });
  it('正确率按题数，部分正确和未作答算未全对，待评阅不进入分母', () => {
    const summary = summarizeResult(
      ['a', 'b', 'c', 'd', 'e', 'missing'].map((id) => ({ id })),
      {
        a: grade('correct', 100, 100),
        b: grade('incorrect'),
        c: grade('partial', 1),
        d: grade('unanswered'),
        e: grade('pending'),
        orphan: grade('correct'),
      },
    );
    expect(summary).toMatchObject({
      correct: 1,
      graded: 4,
      pending: 2,
      total: 6,
      accuracy: 25,
      displayAccuracy: '25',
    });
  });
  it('全为待评阅时为中性状态；显示精度不会把未满分提升到100%', () => {
    expect(summarizeResult([{ id: 'a' }], { a: grade('pending') })).toMatchObject({
      accuracy: null,
      displayAccuracy: '—',
    });
    expect(getAccuracyFeedback(null).band).toBe('pending');
    const ids = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
    const grades = Object.fromEntries(
      ids.map((q, i) => [q.id, grade(i === 0 ? 'incorrect' : 'correct')]),
    );
    const summary = summarizeResult(ids, grades);
    expect(summary.displayAccuracy).toBe('99.9');
    expect(getAccuracyFeedback(summary.accuracy).band).toBe('excellent');
  });
  it('提交前已答题为中性作答色，提交后仅全对绿色，部分正确/错误/空题均红色', () => {
    expect(navigatorState(false, true, undefined)).toBe('answered');
    expect(navigatorState(false, false, undefined)).toBe('empty');
    for (const status of ['correct', 'incorrect', 'partial', 'unanswered', 'pending'] as const)
      expect(navigatorState(true, true, grade(status))).toBe(status);
    expect(navigatorState(true, true, undefined)).toBe('pending');
    expect(navigatorState(true, true, { ...grade('correct'), pending: true })).toBe('pending');
  });
});
