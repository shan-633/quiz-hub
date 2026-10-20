import { describe, it, expect } from 'vitest';
import {
  validateQuestion,
  gradeQuestion,
  publicQuestion,
  isAnswered,
  emptyAnswer,
} from '../shared/domain';
import type { Question } from '../shared/model';

const multiple: Question = {
  id: 'q1',
  version: 1,
  bankId: 'b1',
  type: 'multiple',
  title: '力的认识',
  score: 3,
  difficulty: '基础',
  tags: ['力'],
  content: [{ id: 't1', type: 'paragraph', text: '下列说法正确的是？' }],
  options: [
    { id: 'a', text: '力改变运动状态' },
    { id: 'b', text: '力可以使物体形变' },
    { id: 'c', text: '力维持运动' },
  ],
  blanks: [],
  solution: { choices: ['a', 'b'], blanks: {}, explanation: '力能改变运动状态或使物体形变。' },
  state: 'published',
};
const fill: Question = {
  ...multiple,
  id: 'q2',
  type: 'fill',
  score: 4,
  options: [],
  content: [{ id: 't2', type: 'paragraph', text: '速度为 {{speed}} m/s，运动状态为 {{state}}。' }],
  blanks: [
    { id: 'speed', label: '速度', score: 2, kind: 'number', unit: 'm/s' },
    { id: 'state', label: '状态', score: 2, kind: 'text' },
  ],
  solution: {
    choices: [],
    blanks: {
      speed: { accepted: ['6'], tolerance: 0.01 },
      state: { accepted: ['匀速直线运动', '匀速运动'], ignoreWhitespace: true },
    },
    explanation: '速度等于路程除以时间。',
  },
};
describe('题目内容与判分契约', () => {
  it('多选必须匹配正确集合，选全部不能得分', () => {
    expect(gradeQuestion(multiple, { ...emptyAnswer(), choiceIds: ['b', 'a'] }).earned).toBe(3);
    expect(gradeQuestion(multiple, { ...emptyAnswer(), choiceIds: ['a', 'b', 'c'] }).earned).toBe(
      0,
    );
  });
  it('数值容差与同义答案按稳定空格 ID 判分', () => {
    expect(
      gradeQuestion(fill, {
        ...emptyAnswer(),
        blankValues: { state: ' 匀速 运动 ', speed: '6.005' },
      }).earned,
    ).toBe(4);
    expect(
      gradeQuestion(fill, { ...emptyAnswer(), blankValues: { speed: '6.2', state: '静止' } })
        .earned,
    ).toBe(0);
  });
  it('空答案不将空白与数值零误判为相等', () => {
    const q = structuredClone(fill);
    q.solution!.blanks.speed.accepted = ['0'];
    expect(gradeQuestion(q, emptyAnswer()).earned).toBe(0);
    expect(isAnswered(q, emptyAnswer())).toBe(false);
  });
  it('学生进行中题目不包含 solution', () => {
    const safe = publicQuestion(fill);
    expect(safe).not.toHaveProperty('solution');
    expect(safe.content[0].id).toBe('t2');
  });
  it('发布拦截孤立空格和错误分值', () => {
    expect(validateQuestion({ ...fill, score: 6 })).toContain('填空及子题分值之和必须等于总分');
    const q = structuredClone(fill);
    q.content[0] = { id: 't', type: 'paragraph', text: '{{ghost}}' };
    expect(validateQuestion(q).some((x) => x.includes('ghost'))).toBe(true);
  });
  it('拒绝重复空格 ID 与单选多个正确项', () => {
    expect(
      validateQuestion({ ...fill, blanks: [fill.blanks[0], fill.blanks[0]] }).some((x) =>
        x.includes('重复'),
      ),
    ).toBe(true);
    expect(validateQuestion({ ...multiple, type: 'single' })).toContain(
      '单选题必须设置一个正确选项',
    );
  });
  it('有效题目允许发布', () => {
    expect(validateQuestion(multiple)).toEqual([]);
    expect(validateQuestion(fill)).toEqual([]);
  });
  it('计算题有文字时待人工评阅，不能伪造自动得分', () => {
    const q = { ...multiple, type: 'calculation' as const, options: [], score: 8 };
    const result = gradeQuestion(q, { ...emptyAnswer(), markdown: 'v=s/t=6m/s' });
    expect(result.pending).toBe(true);
    expect(result.earned).toBe(0);
    expect(isAnswered(q, { ...emptyAnswer(), markdown: 'v=6' })).toBe(true);
  });
});
