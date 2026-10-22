import { expect, it } from 'vitest';
import type { Question } from '../shared/model';
import { reviewColumns, columnAllocationNote, columnErrors } from '../shared/reviewColumns';
import { initialReview } from '../shared/teacherReview';
import { emptyAnswer } from '../shared/domain';
const base: Question = {
  id: 'q',
  version: 1,
  bankId: 'b',
  type: 'experiment',
  title: '栏目顺序',
  score: 5,
  difficulty: '',
  tags: [],
  options: [],
  state: 'published',
  blanks: [
    { id: 'late', label: '第二空', score: 3, kind: 'text' },
    { id: 'early', label: '第一空', score: 2, kind: 'text' },
  ],
  content: [
    {
      id: 'group',
      type: 'subquestion',
      responseKind: 'blanks',
      label: '（1）',
      score: 5,
      children: [
        { id: 'table', type: 'table', headers: ['测量{{early}}'], rows: [['结果{{late}}']] },
      ],
    },
  ],
  solution: {
    choices: [],
    blanks: { late: { accepted: ['乙'] }, early: { accepted: ['甲'] } },
    explanation: '参考',
  },
};
it('按题干顺序识别嵌套与表格空格，不把填空小问总分再重复计一次', () => {
  expect(reviewColumns(base).map(({ id, label, max }) => ({ id, label, max }))).toEqual([
    { id: 'early', label: '（1） · 第一空', max: 2 },
    { id: 'late', label: '（1） · 第二空', max: 3 },
  ]);
  expect(columnAllocationNote(base)).toBe('');
});
it('没有配置分值的旧小问保持多个必评栏目，零权重合计按整题平均分配', () => {
  const q: Question = {
    ...base,
    type: 'calculation',
    score: 6,
    blanks: [],
    content: [1, 2, 3].map((n) => ({
      id: 'part' + n,
      type: 'subquestion',
      responseKind: 'open',
      label: '（' + n + '）',
      score: 0,
      children: [],
    })),
  };
  const columns = reviewColumns(q);
  expect(columns.map((c) => c.max)).toEqual([2, 2, 2]);
  expect(columnAllocationNote(q)).toContain('平均分配');
  expect(
    columnErrors(
      columns,
      { part1: { verdict: 'correct', score: 2 }, part2: { verdict: 'incorrect', score: 0 } },
      6,
    ),
  ).toEqual(['请完成「（3）」的评价']);
});
it('小数选择小问初评分数归一化，不将全部正确误判为部分正确', () => {
  const q: Question = {
    ...base,
    type: 'reading',
    score: 0.3,
    blanks: [],
    content: [0.1, 0.2].map((score, i) => ({
      id: 'p' + i,
      label: '选择' + i,
      type: 'subquestion',
      score,
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
      partChoices: { p0: ['a'], p1: ['a'] },
      explanation: '参考',
    },
  };
  const answer = {
    ...emptyAnswer(),
    parts: {
      p0: { ...emptyAnswer(), choiceIds: ['a'] },
      p1: { ...emptyAnswer(), choiceIds: ['a'] },
    },
  };
  expect(
    initialReview([q], { q: { data: answer, revision: 1, updatedAt: '' } }).grades.q,
  ).toMatchObject({ earned: 0.3, status: 'correct', pending: false });
});
