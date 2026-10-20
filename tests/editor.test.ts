import { it, expect } from 'vitest';
import {
  duplicateBlock,
  removeBlock,
  insertBlankAt,
  reorderBlock,
  insertTableBlank,
  applyStarter,
} from '../shared/editor';
import {
  newQuestion,
  blankRefs,
  validateQuestion,
  gradeQuestion,
  emptyAnswer,
} from '../shared/domain';
it('实验模板与表格空格可复用同一套答案 ID', () => {
  let q = applyStarter(newQuestion('experiment', 'bank'));
  expect(q.blanks).toHaveLength(2);
  expect(q.score).toBe(4);
  q.content.push({ id: 'table', type: 'table', headers: ['次数', '结果'], rows: [['1', '']] });
  q = insertTableBlank(q, 'table', 0, 1);
  expect(blankRefs(q.content)).toHaveLength(3);
  expect(q.blanks[2].label).toBe('表格第 1 行第 2 列');
  expect(q.score).toBe(6);
});
it('在光标插入填空，复制重映射新 ID，原空格及答案不变', () => {
  let q = newQuestion('fill', 'bank');
  q.content = [{ id: 'p', type: 'paragraph', text: '速度为 m/s。' }];
  q = insertBlankAt(q, 'p', 3);
  const original = q.blanks[0].id;
  q.solution!.blanks[original].accepted = ['6'];
  q = duplicateBlock(q, 'p');
  const refs = blankRefs(q.content);
  expect(refs).toHaveLength(2);
  expect(new Set(refs).size).toBe(2);
  expect(refs[0]).toBe(original);
  expect(q.solution!.blanks[refs[1]].accepted).toEqual(['6']);
  expect(q.score).toBe(4);
  q = removeBlock(q, q.content[1].id);
  expect(q.blanks).toHaveLength(1);
  expect(q.blanks[0].id).toBe(original);
  expect(q.score).toBe(2);
});
it('移动内容块保留空格及选项的稳定 ID', () => {
  let q = newQuestion('fill', 'bank');
  q.content = [
    { id: 'first', type: 'paragraph', text: '甲' },
    { id: 'second', type: 'paragraph', text: '乙' },
  ];
  q = insertBlankAt(q, 'first', 1);
  const id = q.blanks[0].id;
  q = reorderBlock(q, 'first', 'second');
  expect(q.content[1].id).toBe('first');
  expect(q.blanks[0].id).toBe(id);
  expect(blankRefs(q.content)).toEqual([id]);
});
it('未回答的开放小问不能因为空集合相等而获得分数', () => {
  const q = newQuestion('experiment', 'bank');
  q.content = [
    {
      id: 'part',
      type: 'subquestion',
      label: '解释原因',
      score: 4,
      responseKind: 'open',
      children: [{ id: 'text', type: 'paragraph', text: '说明理由。' }],
    },
  ];
  q.score = 4;
  const g = gradeQuestion(q, emptyAnswer());
  expect(g.earned).toBe(0);
  expect(g.pending).toBe(false);
});
it('发布检查正文内的公式语法、空格位置和小问结构', () => {
  const q = newQuestion('single', 'bank');
  q.title = '公式';
  q.content = [{ id: 'p', type: 'paragraph', text: '速度 $\\frac{1}{$' }];
  q.solution!.explanation = '公式';
  expect(validateQuestion(q)).toContain('存在无法渲染的公式');
});
