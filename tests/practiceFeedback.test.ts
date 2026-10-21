import { describe, it, expect } from 'vitest';
import {
  getScoreFeedback,
  summarizeResult,
  summarizeScore,
  navigatorState,
} from '../client/practiceFeedback';
import type { Grade } from '../shared/model';

const grade = (status: Grade['status'], earned = 0, max = 2): Grade => ({
  status,
  earned,
  max,
  pending: status === 'pending',
  details: {},
});
describe('得分反馈分档', () => {
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
  ] as const)('%s%% 得分率对应 %s', (percent, band) => {
    expect(getScoreFeedback(percent).band).toBe(band);
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
    expect(getScoreFeedback(null).band).toBe('pending');
    const ids = Array.from({ length: 2000 }, (_, i) => ({ id: String(i) }));
    const grades = Object.fromEntries(
      ids.map((q, i) => [q.id, grade(i === 0 ? 'incorrect' : 'correct')]),
    );
    const summary = summarizeResult(ids, grades);
    expect(summary.displayAccuracy).toBe('99.9');
    expect(getScoreFeedback(summary.accuracy).band).toBe('excellent');
  });
  it('横幅按每题分值和部分得分加权，而答题卡仍按对错计数', () => {
    const questions = [
      { id: 'a', score: 100 },
      { id: 'b', score: 2 },
      { id: 'c', score: 2 },
      { id: 'd', score: 2 },
      { id: 'e', score: 4 },
      { id: 'missing', score: 3 },
    ];
    const grades = {
      a: grade('correct', 100, 100),
      b: grade('incorrect'),
      c: grade('partial', 1),
      d: grade('unanswered'),
      e: grade('pending', 0, 4),
      orphan: grade('correct', 500, 500),
    };
    const summary = summarizeScore(questions, grades);
    expect(summary).toMatchObject({
      earnedScore: 101,
      gradedScore: 106,
      pendingScore: 7,
      totalScore: 113,
      displayScoreRate: '95.2',
    });
    expect(getScoreFeedback(summary.scoreRate).band).toBe('excellent');
    expect(summarizeResult(questions, grades).accuracy).toBe(25);
  });
  it('混合题已判小问计入分值，待评阅分值单列；小数分值满分不受浮点误差影响', () => {
    const summary = summarizeScore([{ id: 'mixed', score: 4 }], {
      mixed: {
        ...grade('pending', 2, 4),
        details: {
          blank: { earned: 2, max: 2, pending: false },
          open: { earned: 0, max: 2, pending: true },
        },
      },
    });
    expect(summary).toMatchObject({
      earnedScore: 2,
      gradedScore: 2,
      pendingScore: 2,
      totalScore: 4,
      scoreRate: 100,
    });
    const decimal = summarizeScore([{ id: 'decimal', score: 0.3 }], {
      decimal: {
        ...grade('correct', 0.1 + 0.2, 0.3),
        details: {
          a: { earned: 0.1, max: 0.1, pending: false },
          b: { earned: 0.2, max: 0.2, pending: false },
        },
      },
    });
    expect(decimal).toMatchObject({ earnedScore: 0.3, totalScore: 0.3, scoreRate: 100 });
    expect(
      summarizeScore([{ id: 'pending', score: 8 }], { pending: grade('pending', 0, 8) }),
    ).toMatchObject({ gradedScore: 0, pendingScore: 8, scoreRate: null, displayScoreRate: '—' });
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
