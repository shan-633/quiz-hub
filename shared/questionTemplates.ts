import type { Block, Question, QuestionType } from './model';
import { applyStarter } from './editor';
import { randomId } from './browserIds';

export const questionTemplates: {
  id: string;
  type: QuestionType;
  name: string;
  description: string;
}[] = [
  {
    id: 'experiment-table',
    type: 'experiment',
    name: '实验 · 数据表与填空',
    description: '实验材料、数据表、稳定填空与数值答案。',
  },
  {
    id: 'experiment-mixed',
    type: 'experiment',
    name: '实验 · 填空、作图与论证',
    description: '客观填空和独立开放小问；作图、解释可文字/手写/拍照。',
  },
  {
    id: 'reading-mixed',
    type: 'reading',
    name: '科普阅读 · 材料与混合小问',
    description: '共享阅读材料、信息提取填空、选择判断和开放论证。',
  },
];

export function applyQuestionTemplate(original: Question, templateId?: string): Question {
  if (!templateId)
    return ['fill', 'experiment'].includes(original.type) ? applyStarter(original) : original;
  const template = questionTemplates.find((t) => t.id === templateId);
  if (!template || template.type !== original.type) throw new Error('模板不存在或与题型不匹配');
  const q = structuredClone(original);
  const uid = randomId;
  const p = (text: string): Block => ({ id: uid(), type: 'paragraph', text });
  const blankId = `blank-${uid()}`;
  q.content = [
    p(
      template.type === 'reading'
        ? '在此填写共享阅读材料，可继续插入示意图、公式和数据表。'
        : '在此填写实验目的、装置与操作说明。',
    ),
  ];
  q.blanks = [{ id: blankId, label: '信息提取或实验读数', kind: 'text', score: 1 }];
  q.solution = {
    choices: [],
    blanks: { [blankId]: { accepted: [], ignoreWhitespace: true } },
    partChoices: {},
    explanation: '',
  };
  if (templateId === 'experiment-table') {
    q.content.push(
      {
        id: uid(),
        type: 'table',
        headers: ['实验次数', '测量条件', '测量结果'],
        rows: [
          ['1', '', ''],
          ['2', '', ''],
          ['3', '', ''],
        ],
      },
      p(`根据数据，测量结果为 {{${blankId}}}。`),
    );
    q.score = 1;
  } else {
    q.content.push({
      id: uid(),
      type: 'subquestion',
      label: '（1）信息提取',
      score: 1,
      responseKind: 'blanks',
      children: [p(`根据材料填写：{{${blankId}}}。`)],
    });
    if (templateId === 'reading-mixed') {
      q.content.push({
        id: uid(),
        type: 'subquestion',
        label: '（2）判断应用',
        score: 1,
        responseKind: 'single',
        options: [
          { id: uid(), text: '选项 A' },
          { id: uid(), text: '选项 B' },
        ],
        children: [p('依据材料选择正确说法。')],
      });
    }
    q.content.push({
      id: uid(),
      type: 'subquestion',
      label: template.type === 'reading' ? '（3）推理与论证' : '（2）作图或解释',
      score: 2,
      responseKind: 'open',
      children: [
        p(
          template.type === 'reading'
            ? '结合材料说明理由。'
            : '按实验要求作图或说明理由。可切换手写作答，也可拍照上传。',
        ),
      ],
    });
    q.score = template.type === 'reading' ? 4 : 3;
  }
  return q;
}
