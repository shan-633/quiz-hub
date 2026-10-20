// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QuestionRenderer } from '../client/components/QuestionRenderer';
import { emptyAnswer } from '../shared/domain';
import type { Question } from '../shared/model';
import { CalculationAnswer } from '../client/components/CalculationAnswer';
afterEach(cleanup);
it('阅读开放小问使用自己的标签，答案写入子题且保留客观填空', () => {
  const q: Question = {
    id: 'read',
    version: 1,
    bankId: 'bank',
    type: 'reading',
    title: '阅读材料',
    score: 2,
    difficulty: '中等',
    tags: [],
    options: [],
    blanks: [],
    state: 'published',
    content: [
      {
        id: 'argument',
        type: 'subquestion',
        label: '推理与论证',
        score: 2,
        responseKind: 'open',
        children: [{ id: 'material', type: 'paragraph', text: '说明理由。' }],
      },
    ],
  };
  const changed = vi.fn();
  render(
    <QuestionRenderer
      question={q}
      answer={{ ...emptyAnswer(), blankValues: { retained: '电能' } }}
      onChange={changed}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '推理与论证文字答案' }), {
    target: { value: '依据材料，需知道之前的状态。' },
  });
  expect(changed.mock.calls[0][0].parts.argument.markdown).toContain('之前的状态');
  expect(changed.mock.calls[0][0].blankValues.retained).toBe('电能');
});
it('切换到照片作答再返回文字，已经输入的计算过程保留', () => {
  function Editor() {
    const [value, setValue] = useState(emptyAnswer());
    return <CalculationAnswer value={value} onChange={(next) => setValue({ ...value, ...next })} />;
  }
  render(<Editor />);
  fireEvent.change(screen.getByRole('textbox', { name: '计算题文字答案' }), {
    target: { value: 'v=s/t=6' },
  });
  fireEvent.click(screen.getByRole('tab', { name: '拍照上传' }));
  fireEvent.click(screen.getByRole('tab', { name: '文字与公式' }));
  expect(
    (screen.getByRole('textbox', { name: '计算题文字答案' }) as HTMLTextAreaElement).value,
  ).toBe('v=s/t=6');
});
const question: Question = {
  id: 'fill',
  version: 1,
  bankId: 'bank',
  type: 'fill',
  title: '平均速度',
  score: 2,
  difficulty: '基础',
  tags: [],
  content: [{ id: 'p', type: 'paragraph', text: '速度为 {{speed}} m/s。' }],
  options: [],
  blanks: [{ id: 'speed', label: '速度', score: 2, kind: 'number', unit: 'm/s' }],
  state: 'published',
};
it('正文中的空格修改使用稳定 ID，保持其他答案', () => {
  const onChange = vi.fn();
  render(
    <QuestionRenderer
      question={question}
      answer={{ ...emptyAnswer(), markdown: '保留草稿' }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '速度' }), { target: { value: '6' } });
  expect(onChange.mock.calls[0][0].blankValues).toEqual({ speed: '6' });
  expect(onChange.mock.calls[0][0].markdown).toBe('保留草稿');
});
it('单选与多选使用对应的语义控件', () => {
  render(
    <QuestionRenderer
      question={{
        ...question,
        type: 'multiple',
        blanks: [],
        content: [{ id: 't', type: 'paragraph', text: '请选择' }],
        options: [
          { id: 'a', text: '甲' },
          { id: 'b', text: '乙' },
        ],
      }}
      answer={emptyAnswer()}
      onChange={() => {}}
    />,
  );
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
});
it('只读作答禁止编辑，题干不渲染脚本为可执行 HTML', () => {
  render(
    <QuestionRenderer
      question={{
        ...question,
        content: [{ id: 'p', type: 'paragraph', text: '<script>alert(1)</script> {{speed}}' }],
      }}
      answer={emptyAnswer()}
      onChange={() => {}}
      disabled
    />,
  );
  expect((screen.getByRole('textbox', { name: '速度' }) as HTMLInputElement).disabled).toBe(true);
  expect(document.querySelector('script')).toBeNull();
});
