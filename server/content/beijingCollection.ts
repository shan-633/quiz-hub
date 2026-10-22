import { createHash } from 'node:crypto';
import type { LibraryItem, Question, QuestionType } from '../../shared/model';
export interface CollectionManifest {
  source: { path: string; sha256: string; pages: number };
  assets: { id: string; file: string; width: number; height: number; sha256: string }[];
  papers: {
    key: string;
    title: string;
    year: number;
    region: string;
    state: string;
    minutes: number;
    notes: string[];
    questions: {
      number: number;
      type: string;
      score: number;
      choices?: string[];
      notes?: string;
      incomplete?: boolean;
      scoreUnverified?: boolean;
      sourceNumber?: number;
      stemImages: { assetId: string; caption: string }[];
      referenceImages: { assetId: string; caption: string }[];
    }[];
  }[];
}
export const collectionId = (teacherId: string, externalId: string) =>
  'bjc-' +
  createHash('sha256')
    .update(teacherId + ':' + externalId)
    .digest('hex')
    .slice(0, 32);
const labels: Record<QuestionType, string> = {
  single: '单选',
  multiple: '多选',
  experiment: '实验探究',
  reading: '科普阅读',
  calculation: '计算',
  fill: '填空',
};
export function buildCollection(manifest: CollectionManifest, teacherId: string) {
  const banks: LibraryItem[] = [],
    questions: Question[] = [];
  for (const paper of manifest.papers) {
    const bankId = collectionId(teacherId, paper.key),
      published = paper.state === 'published';
    const state = published ? ('published' as const) : ('draft' as const);
    banks.push({
      id: bankId,
      teacherId,
      kind: 'bank',
      deliveryMode: 'assigned',
      title: paper.title,
      description: [
        '用户提供汇编原图版；按原卷题号作答。实验、阅读题按整题提交文字、笔迹或照片，不另拆分原卷未标的小问分值。',
        ...paper.notes,
      ]
        .join('\n')
        .slice(0, 3000),
      chapter: `九年级 · ${paper.year} · ${paper.region}`,
      minutes: paper.minutes,
      accent: 'exam',
      state,
      questionCount: paper.questions.length,
      totalScore: paper.questions.reduce((sum, q) => sum + q.score, 0),
    });
    for (const source of paper.questions) {
      const type = source.type as QuestionType,
        choice = type === 'single' || type === 'multiple';
      const refs = source.referenceImages.map((image) => ({
        ...image,
        assetId: collectionId(teacherId, image.assetId),
      }));
      const content: Question['content'] = source.stemImages.map((image, i) => ({
        id: `original-${i}`,
        type: 'image',
        assetId: collectionId(teacherId, image.assetId),
        alt: `${paper.title}第${source.number}题原图${i + 1}`,
        caption: image.caption,
        width: 100,
      }));
      if (type === 'experiment' || type === 'reading')
        content.push({
          id: 'response',
          type: 'subquestion',
          label: '按原题小问序号作答',
          score: source.score,
          responseKind: 'open',
          children: [
            {
              id: 'response-note',
              type: 'paragraph',
              text: '请依照原题序号写出各空答案、实验步骤或分析说明。可使用文字、手写或照片提交整题作答。',
            },
          ],
        });
      const q: Question = {
        id: collectionId(teacherId, paper.key + ':' + source.number),
        bankId,
        version: published ? 1 : 0,
        state,
        type,
        title: `第${String(source.number).padStart(2, '0')}题 · ${labels[type]}${source.incomplete ? '（源文截断）' : ''}`,
        score: source.score,
        difficulty: '中考',
        tags: [
          String(paper.year),
          paper.region,
          paper.key,
          '原卷图文',
          ...(source.incomplete ? ['残题待补录'] : []),
          ...(source.scoreUnverified ? ['分值待校对'] : []),
        ],
        source:
          `用户提供《北京中考物理真题与重点区一模汇编（2023-2026）》；${paper.title}；原题号${source.sourceNumber ?? source.number}。${source.notes ?? ''}`.slice(
            0,
            1000,
          ),
        content,
        options: choice
          ? ['a', 'b', 'c', 'd'].map((id) => ({
              id,
              text: `选择原题中的 ${id.toUpperCase()} 选项`,
            }))
          : [],
        blanks: [],
        solution: {
          choices: source.choices ?? [],
          blanks: {},
          explanation: refs.length
            ? '本题参考答案与评分说明保留在下方原卷图片中。'
            : choice && source.choices?.length
              ? '正确选项已按原卷参考答案核对，选项字母与题干原图一一对应。'
              : '此份源文件没有收录本题参考答案，需教师补录并核对后发布。',
          ...(refs.length ? { referenceImages: refs } : {}),
        },
        ...(type === 'multiple' ? { multipleScoring: 'half' as const } : {}),
        ...(!choice
          ? { allowedModes: ['text', 'drawing', 'photo'] as Question['allowedModes'] }
          : {}),
      };
      questions.push(q);
    }
  }
  return { banks, questions };
}
