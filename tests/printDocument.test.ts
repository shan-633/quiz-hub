import { expect, it } from 'vitest';
import type { Question, LibraryItem } from '../shared/model';
import { renderPrintDocument } from '../server/print/PrintDocument';
const item: LibraryItem = {
  id: 'b',
  kind: 'bank',
  title: '力学 <练习>',
  description: '',
  chapter: '八年级',
  accent: 'mechanics',
  state: 'published',
  questionCount: 1,
  minutes: 30,
  totalScore: 4,
};
const question: Question = {
  id: 'q',
  version: 2,
  bankId: 'b',
  type: 'experiment',
  title: '题',
  score: 4,
  difficulty: '基础',
  tags: [],
  options: [],
  blanks: [{ id: 'x', label: '读数', score: 1, kind: 'text' }],
  state: 'published',
  content: [
    { id: 'p', type: 'paragraph', text: '读数为{{x}}，公式为 $F=ma$。' },
    {
      id: 'img',
      type: 'image',
      assetId: 'fig',
      alt: '原图',
      caption: '图1 · 原卷截图（点击放大）',
      width: 70,
    },
    { id: 'table', type: 'table', headers: ['测量', '结果'], rows: [['第一次', '{{x}}']] },
    {
      id: 'part',
      type: 'subquestion',
      label: '（2）',
      score: 3,
      responseKind: 'open',
      children: [{ id: 'stem', type: 'paragraph', text: '请解释观察到的现象。' }],
    },
  ],
  solution: {
    choices: [],
    blanks: { x: { accepted: ['秘密答案'] } },
    explanation: '绝不能进入学生PDF的解析',
  },
};
it('原卷图文打印保留专用排版，不重复合成选项和网页作答提示', () => {
  const scan: Question = {
    ...question,
    tags: ['原卷图文'],
    type: 'single',
    options: [
      { id: 'a', text: '选择原题中的 A 选项' },
      { id: 'b', text: '选择原题中的 B 选项' },
    ],
    content: [
      ...question.content,
      {
        id: 'response',
        type: 'subquestion',
        label: '按原题小问序号作答',
        responseKind: 'open',
        score: 4,
        children: [
          { id: 'response-note', type: 'paragraph', text: '可使用文字、手写或照片提交整题作答。' },
        ],
      },
    ],
  };
  const html = renderPrintDocument({
    item,
    questions: [scan],
    images: { fig: 'data:image/png;base64,AAAA' },
    fontCss: '',
    mathCss: '',
  });
  expect(html).toContain('original-scan');
  expect(html).not.toContain('选择原题中的');
  expect(html).not.toContain('可使用文字');
});
it('打印渲染包含原图、公式、空格、小问和表格，不含答案或交互输入', () => {
  const html = renderPrintDocument({
    item,
    questions: [question],
    images: { fig: 'data:image/png;base64,AAAA' },
    fontCss: '',
    mathCss: '',
  });
  expect(html).toContain('力学 &lt;练习&gt;');
  expect(html).toContain('katex');
  expect(html).toContain('<table');
  expect(html).toContain('data:image/png;base64,AAAA');
  expect(html).toContain('print-blank');
  expect(html).toContain('请解释观察到的现象');
  expect(html).not.toContain('秘密答案');
  expect(html).not.toContain('绝不能进入');
  expect(html).not.toContain('<input');
  expect(html).not.toContain('<textarea');
  expect(html).not.toContain('点击放大');
  expect(html).not.toContain('answer-space');
});
it('计算题与开放小问只保留题目，选择题保留选项与分值规则', () => {
  const calc: Question = {
    ...question,
    id: 'calc',
    type: 'calculation',
    blanks: [],
    content: [{ id: 'p', type: 'paragraph', text: '求功率。' }],
  };
  const multiple: Question = {
    ...calc,
    id: 'multi',
    type: 'multiple',
    score: 2,
    options: [
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ],
    multipleScoring: 'half',
  };
  const html = renderPrintDocument({
    item,
    questions: [question, calc, multiple],
    images: { fig: 'data:image/png;base64,AAAA' },
    fontCss: '',
    mathCss: '',
  });
  expect(html).not.toContain('font-large');
  expect(html).not.toContain('answer-space');
  expect(html).not.toContain('student-details');
  expect(html).toContain('求功率');
  expect(html).toContain('选对但不全');
  expect(html).toContain('A.');
  expect(html).toContain('B.');
  expect(html).toContain('第 3 题');
});
it('小幅选择题插图与文字并排，末尾不生成只有结束标记的空页', () => {
  const q: Question = {
    ...question,
    type: 'single',
    blanks: [],
    options: [
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ],
    content: [
      { id: 'p', type: 'paragraph', text: '看图选择。' },
      {
        id: 'i',
        type: 'image',
        assetId: 'fig',
        alt: '原图',
        caption: '图1',
        width: 45,
        intrinsicWidth: 291,
        intrinsicHeight: 318,
      },
    ],
  };
  const html = renderPrintDocument({
    item,
    questions: [q],
    images: { fig: 'data:image/png;base64,AAAA' },
    fontCss: '',
    mathCss: '',
  });
  expect(html).toContain('has-aside');
  expect(html).toContain('print-aside');
  expect(html).not.toContain('题目结束');
  expect(html.match(/<figure/g)).toHaveLength(1);
});
