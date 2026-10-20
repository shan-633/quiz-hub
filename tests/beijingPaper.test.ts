import { expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildBeijingPaper } from '../server/content/beijingPaper';
import { questionSchema } from '../shared/schema';
import {
  blankRefs,
  emptyAnswer,
  gradeQuestion,
  validateQuestion,
  walkBlocks,
} from '../shared/domain';

it('原创北京式试卷26题70分，逐题通过发布/结构校验，无重复ID或缺图', () => {
  const { questions, paper, analysis } = buildBeijingPaper();
  expect(questions).toHaveLength(26);
  expect(analysis).toHaveLength(26);
  expect(questions.reduce((sum, q) => sum + q.score, 0)).toBe(70);
  const manual = questions.reduce(
    (sum, q) =>
      sum +
      (q.type === 'calculation'
        ? q.score
        : walkBlocks(q.content).reduce(
            (s, b) => s + (b.type === 'subquestion' && b.responseKind === 'open' ? b.score : 0),
            0,
          )),
    0,
  );
  expect(manual).toBe(24);
  expect(paper.minutes).toBe(70);
  expect(paper.items?.map((i) => i.questionId)).toEqual(questions.map((q) => q.id));
  const counts = questions.reduce(
    (a, q) => ({ ...a, [q.type]: (a[q.type] ?? 0) + 1 }),
    {} as Record<string, number>,
  );
  expect(counts).toEqual({ single: 12, multiple: 3, experiment: 8, reading: 1, calculation: 2 });
  const ids = questions.flatMap((q) => [
    q.id,
    ...q.blanks.map((b) => b.id),
    ...walkBlocks(q.content).map((b) => b.id),
  ]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const q of questions) {
    expect(questionSchema.safeParse(q).success, q.title).toBe(true);
    expect(validateQuestion(q), q.title).toEqual([]);
    expect(blankRefs(q.content).length, q.title).toBe(q.blanks.length);
    for (const b of walkBlocks(q.content))
      if (b.type === 'image' && b.src)
        expect(existsSync(resolve('public', b.src.slice(1))), b.src).toBe(true);
    expect(gradeQuestion(q, emptyAnswer()).earned, q.title).toBe(0);
  }
});

it('所有客观答案可按录入规则判对，开放小问与计算保留待评阅', () => {
  for (const q of buildBeijingPaper().questions) {
    const a = emptyAnswer();
    a.choiceIds = q.solution!.choices;
    for (const b of q.blanks) a.blankValues[b.id] = q.solution!.blanks[b.id].accepted[0];
    for (const b of walkBlocks(q.content))
      if (b.type === 'subquestion') {
        if (b.responseKind === 'open')
          a.parts[b.id] = { ...emptyAnswer(), markdown: '完整的推理与作图过程' };
        if (b.responseKind === 'single')
          a.parts[b.id] = { ...emptyAnswer(), choiceIds: q.solution!.partChoices![b.id] };
      }
    if (q.type === 'calculation') a.markdown = '完整计算过程';
    const grade = gradeQuestion(q, a);
    const manual =
      q.type === 'calculation'
        ? q.score
        : walkBlocks(q.content).reduce(
            (s, b) => s + (b.type === 'subquestion' && b.responseKind === 'open' ? b.score : 0),
            0,
          );
    expect(grade.earned, q.title).toBe(q.score - manual);
    expect(grade.pending, q.title).toBe(manual > 0);
  }
});
