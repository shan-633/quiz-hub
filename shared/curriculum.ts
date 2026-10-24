import { z } from 'zod';

export const stageLabels = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
  university: '大学',
  professional: '职业与资格',
  other: '其他',
} as const;
const name = z.string().trim().min(1).max(80);
export const curriculumSchema = z
  .object({
    stage: z.enum(['primary', 'junior', 'senior', 'university', 'professional', 'other']),
    subject: name,
    region: name,
    exam: name,
    scheme: z.string().trim().max(120).default(''),
  })
  .strict();
export type Curriculum = z.infer<typeof curriculumSchema>;
export const legacyCurriculum: Curriculum = {
  stage: 'junior',
  subject: '物理',
  region: '北京',
  exam: '中考',
  scheme: '',
};
export const unclassifiedCurriculum: Curriculum = {
  stage: 'other',
  subject: '待分类',
  region: '全国',
  exam: '未分类',
  scheme: '',
};
export const curriculumOf = (item: { curriculum?: Curriculum }) =>
  item.curriculum ?? legacyCurriculum;
export const curriculumKey = (c: Curriculum) =>
  JSON.stringify([c.stage, c.subject, c.region, c.exam, c.scheme ?? '']);
export const curriculumLabel = (c: Curriculum) =>
  [stageLabels[c.stage], c.subject, c.region, c.exam, c.scheme].filter(Boolean).join(' · ');
export const sameCurriculum = (a: Curriculum, b: Curriculum) =>
  curriculumKey(a) === curriculumKey(b);
export function uniqueCurricula(items: { curriculum?: Curriculum }[]) {
  return [
    ...new Map(
      items.map((item) => {
        const c = curriculumOf(item);
        return [curriculumKey(c), c];
      }),
    ).values(),
  ];
}
export interface LearningDirections {
  id: string;
  revision: number;
  directions: Curriculum[];
}
export const directionsSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    directions: z.array(curriculumSchema).max(30),
  })
  .strict()
  .refine(
    (value) => new Set(value.directions.map(curriculumKey)).size === value.directions.length,
    '不能重复添加相同方向',
  );
