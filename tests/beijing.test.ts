import { expect, it } from 'vitest';
import { emptyAnswer, gradeQuestion, newQuestion, validateQuestion } from '../shared/domain';
import { questionSchema } from '../shared/schema';

it('北京式多选：全对2分、漏选1分、错选或未选0分，旧题仍全对才给分', () => {
  const q = newQuestion('multiple', 'bank');
  q.score = 2;
  q.solution!.choices = ['a', 'c'];
  (q as any).multipleScoring = 'half';
  const a = emptyAnswer();
  a.choiceIds = ['a'];
  expect(gradeQuestion(q, a).earned).toBe(1);
  a.choiceIds = ['a', 'c'];
  expect(gradeQuestion(q, a).earned).toBe(2);
  a.choiceIds = ['a', 'b'];
  expect(gradeQuestion(q, a).earned).toBe(0);
  a.choiceIds = [];
  expect(gradeQuestion(q, a).earned).toBe(0);
  delete (q as any).multipleScoring;
  a.choiceIds = ['a'];
  expect(gradeQuestion(q, a).earned).toBe(0);
});

it('科普阅读是独立题型，必须校验小问分值，支持客观填空和开放论证共存', () => {
  const q = newQuestion('experiment', 'bank');
  (q as any).type = 'reading';
  q.title = '阅读传感器材料';
  q.score = 4;
  q.content = [
    { id: 'intro', type: 'paragraph', text: '材料' },
    {
      id: 'part',
      type: 'subquestion',
      label: '说明理由',
      score: 3,
      responseKind: 'open',
      children: [{ id: 'body', type: 'paragraph', text: '说明理由。' }],
    },
  ];
  q.solution!.explanation = '根据材料解释。';
  expect(questionSchema.safeParse(q).success).toBe(true);
  expect(validateQuestion(q)).toContain('填空及子题分值之和必须等于总分');
  q.score = 3;
  expect(validateQuestion(q)).toEqual([]);
  const a = emptyAnswer();
  a.parts.part = { ...emptyAnswer(), markdown: '推理过程' };
  expect(gradeQuestion(q, a).pending).toBe(true);
  expect(gradeQuestion(q, a).earned).toBe(0);
});
