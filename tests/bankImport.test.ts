import { describe, it, expect } from 'vitest';
import { parseBankPackage, bankPackageSchema, MAX_IMPORT_BYTES } from '../shared/bankImport';

export const fixturePackage = (): any => ({
  format: 'zhixu.question-bank',
  version: '1.0',
  bank: {
    title: '导入协议测试题库',
    description: '仅用于自动化验收',
    chapter: '九年级 · 综合',
    minutes: 20,
    accent: 'exam',
  },
  assets: [],
  questions: [
    {
      id: 'q1',
      type: 'single',
      title: '单位判断',
      score: 2,
      difficulty: '基础',
      tags: ['单位'],
      content: [{ id: 'p1', type: 'paragraph', text: '下列哪个是力的单位？' }],
      options: [
        { id: 'a', text: '牛顿' },
        { id: 'b', text: '焦耳' },
      ],
      blanks: [],
      solution: { choices: ['a'], blanks: {}, explanation: '力的国际单位是牛顿。' },
    },
  ],
});

describe('题库交换协议 v1.0', () => {
  it('接受完整协议及 UTF-8 BOM，生成可用题目但不带外部数据库标识', () => {
    const result = parseBankPackage('\uFEFF' + JSON.stringify(fixturePackage()));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.document?.questions[0].id).toBe('q1');
    expect(bankPackageSchema.safeParse(fixturePackage()).success).toBe(true);
  });
  it('报告语法、未知版本与未知嵌套字段的明确路径', () => {
    expect(parseBankPackage('{bad').errors[0].code).toBe('json');
    const input = fixturePackage();
    input.version = '2.0';
    expect(parseBankPackage(JSON.stringify(input)).errors.some((e) => e.path === '$.version')).toBe(
      true,
    );
    input.version = '1.0';
    input.questions[0].solution.blanks.extra = { accepted: ['1'], typo: true };
    const errors = parseBankPackage(JSON.stringify(input)).errors;
    expect(errors.some((e) => e.path.includes('solution.blanks.extra'))).toBe(true);
  });
  it('拒绝重复题号、无效答案引用、未声明图片及错误分值', () => {
    const input = fixturePackage();
    input.questions.push(structuredClone(input.questions[0]));
    input.questions[0].solution.choices = ['missing'];
    input.questions[0].content.push({
      id: 'img',
      type: 'image',
      assetId: 'missing',
      alt: '实验图',
      caption: '',
      width: 100,
    });
    const result = parseBankPackage(JSON.stringify(input));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'duplicate')).toBe(true);
    expect(result.errors.some((e) => e.code === 'asset_reference')).toBe(true);
    expect(result.errors.some((e) => e.message.includes('正确选项'))).toBe(true);
    input.questions = [
      {
        ...input.questions[0],
        type: 'fill',
        score: 3,
        options: [],
        content: [{ id: 'p', type: 'paragraph', text: '{{b}}' }],
        blanks: [{ id: 'b', kind: 'number', label: '读数', score: 2 }],
        solution: { choices: [], blanks: { b: { accepted: ['1'] } }, explanation: '示例' },
      },
    ];
    expect(
      parseBankPackage(JSON.stringify(input)).errors.some((e) => e.message.includes('分值之和')),
    ).toBe(true);
  });
  it('拒绝会被渲染器忽略的混合控件及多余答案配置', () => {
    const input = fixturePackage();
    input.questions[0].blanks = [{ id: 'b', kind: 'text', label: '答案', score: 1 }];
    input.questions[0].content[0].text = '下列哪个是力的单位？{{b}}';
    input.questions[0].solution.blanks = { b: { accepted: ['牛顿'] } };
    expect(
      parseBankPackage(JSON.stringify(input)).errors.some((e) => e.code === 'type_content'),
    ).toBe(true);
    const extra = fixturePackage();
    extra.questions[0].solution.partChoices = { ghost: ['a'] };
    expect(
      parseBankPackage(JSON.stringify(extra)).errors.some((e) => e.code === 'answer_reference'),
    ).toBe(true);
  });
  it('在递归模式解析前拒绝过深结构、超限体积与外部图片 URL', () => {
    const input = fixturePackage();
    let b: any = { id: 'p', type: 'paragraph', text: '题干' };
    for (let i = 0; i < 30; i++) b = { id: 'g' + i, type: 'group', layout: 'stack', children: [b] };
    input.questions[0].content = [b];
    expect(parseBankPackage(JSON.stringify(input)).errors[0].code).toBe('structure_limit');
    expect(parseBankPackage(' '.repeat(MAX_IMPORT_BYTES + 1)).errors[0].code).toBe('file_size');
    input.questions[0].content = [
      {
        id: 'i',
        type: 'image',
        src: 'https://example.com/test.png',
        alt: 'test',
        caption: '',
        width: 100,
      },
    ];
    expect(parseBankPackage(JSON.stringify(input)).valid).toBe(false);
  });
  it('拒绝保留ID以及Markdown中不会显示的图片语法，避免静默丢图', () => {
    const input = fixturePackage();
    input.questions[0].id = 'constructor';
    expect(parseBankPackage(JSON.stringify(input)).valid).toBe(false);
    input.questions[0].id = 'q1';
    input.questions[0].content[0].text = '![实验图](https://example.com/a.png)';
    expect(
      parseBankPackage(JSON.stringify(input)).errors.some((e) => e.code === 'markdown_image'),
    ).toBe(true);
  });
  it('单题节点过大时拒绝，避免导入后无法编辑；选项公式同样校验', () => {
    const input = fixturePackage();
    input.questions[0].content = Array.from({ length: 20 }, (_, i) => ({
      id: 't' + i,
      type: 'table',
      headers: Array(10).fill('值'),
      rows: Array.from({ length: 100 }, () => Array(10).fill('1')),
    }));
    expect(
      parseBankPackage(JSON.stringify(input)).errors.some((e) => e.code === 'question_structure'),
    ).toBe(true);
    const formula = fixturePackage();
    formula.questions[0].options[0].text = '$\\badformula{1}$';
    expect(parseBankPackage(JSON.stringify(formula)).errors.some((e) => e.code === 'formula')).toBe(
      true,
    );
  });
});
