import { describe, expect, it } from 'vitest';
import type { Question } from '../shared/model';
import { emptyAnswer } from '../shared/domain';
import { initialReview, hasCompleteStandardAnswer } from '../shared/teacherReview';

const choice: Question = {
  id: 'choice',
  version: 1,
  bankId: 'bank',
  type: 'multiple',
  title: '多选',
  score: 4,
  difficulty: '基础',
  tags: [],
  content: [{ id: 'p', type: 'paragraph', text: '选择' }],
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  blanks: [],
  state: 'published',
  multipleScoring: 'half',
  solution: { choices: ['a', 'b'], blanks: {}, explanation: '解析' },
};
const mixed: Question = {
  ...choice,
  id: 'mixed',
  type: 'experiment',
  score: 6,
  options: [],
  blanks: [{ id: 'x', label: '填空', score: 2, kind: 'text' }],
  content: [
    { id: 'p', type: 'paragraph', text: '{{x}}' },
    {
      id: 'part',
      type: 'subquestion',
      label: '选择',
      score: 2,
      responseKind: 'single',
      options: choice.options,
      children: [],
    },
    {
      id: 'open',
      type: 'subquestion',
      label: '解释',
      score: 2,
      responseKind: 'open',
      children: [],
    },
  ],
  solution: {
    choices: [],
    blanks: { x: { accepted: ['向上'] } },
    partChoices: { part: ['b'] },
    explanation: '解释参考答案',
  },
};
describe('教师初评策略', () => {
  it('只评选择与选择小问，多选保留半分，填空和空白开放题也需人工', () => {
    const r = initialReview([choice, mixed], {
      choice: { data: { ...emptyAnswer(), choiceIds: ['a'] }, revision: 1, updatedAt: '' },
      mixed: {
        data: {
          ...emptyAnswer(),
          blankValues: { x: '向上' },
          parts: { part: { ...emptyAnswer(), choiceIds: ['b'] } },
        },
        revision: 1,
        updatedAt: '',
      },
    });
    expect(r.review.autoEligible).toBe(true);
    expect(r.review.autoCount).toBe(2);
    expect(r.grades.choice).toMatchObject({
      earned: 2,
      pending: false,
      status: 'partial',
      source: 'auto',
    });
    expect(r.grades.mixed).toMatchObject({ earned: 2, pending: true, source: 'mixed' });
    expect(r.grades.mixed.details.x.pending).toBe(true);
    expect(r.grades.mixed.details.open.pending).toBe(true);
  });
  it('任一题标准答案不完整，所有选择题都转人工', () => {
    const incomplete = { ...mixed, solution: { ...mixed.solution!, partChoices: {} } };
    expect(hasCompleteStandardAnswer(incomplete)).toBe(false);
    const r = initialReview([choice, incomplete], {});
    expect(r.review.autoEligible).toBe(false);
    expect(r.review.autoCount).toBe(0);
    expect(r.grades.choice.pending).toBe(true);
  });
  it('计算题参考答案完整才符合条件，但空白计算题仍待人工', () => {
    const q: Question = {
      ...choice,
      id: 'calc',
      type: 'calculation',
      options: [],
      solution: { choices: [], blanks: {}, explanation: 'F=10N' },
    };
    expect(hasCompleteStandardAnswer(q)).toBe(true);
    expect(initialReview([q], {}).grades.calc).toMatchObject({ pending: true, earned: 0 });
    expect(
      hasCompleteStandardAnswer({ ...q, solution: { ...q.solution!, explanation: ' ' } }),
    ).toBe(false);
  });
});
