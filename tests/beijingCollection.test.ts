import { expect, it } from 'vitest';
import metadata from '../content-assets/beijing-2023-2026/metadata.json';
import { buildCollection, type CollectionManifest } from '../server/content/beijingCollection';
import { questionSchema } from '../shared/schema';
import { validateQuestion } from '../shared/domain';

const manifest = {
  ...metadata,
  assets: [],
  papers: metadata.papers.map((p) => ({
    ...p,
    questions: p.questions.map((q) => ({
      ...q,
      stemImages: q.regions.map((_, i) => ({
        assetId: `stem-${p.key}-${q.number}-${i}`,
        caption: '原题截图',
      })),
      referenceImages: [{ assetId: `ref-${p.key}`, caption: '原卷答案' }],
    })),
  })),
} as CollectionManifest;
it('20套卷515道按原题序号建库，18套完整卷每题通过发布校验，缺失卷不冒充完整卷', () => {
  const data = buildCollection(manifest, 'user-teacher');
  expect(data.banks).toHaveLength(20);
  expect(data.questions).toHaveLength(515);
  expect(data.banks.filter((b) => b.state === 'published')).toHaveLength(18);
  for (const q of data.questions) {
    expect(
      q.content.some((b) => b.type === 'image'),
      q.title,
    ).toBe(true);
    expect(questionSchema.safeParse(q).success, q.title).toBe(true);
    if (q.state === 'published') expect(validateQuestion(q), q.title).toEqual([]);
  }
  expect(data.banks.find((b) => b.title.includes('下载节选'))?.state).toBe('draft');
  expect(data.banks.find((b) => b.title.includes('源卷无答案'))?.state).toBe('draft');
  expect(
    data.questions.find((q) => q.tags.includes('2023-haidian') && q.title.includes('第01题'))
      ?.solution?.choices,
  ).toEqual(['d']);
});
it('图文/答案分离、实验整题开放作答不虚构逐空分，教师间ID隔离且同教师重跑稳定', () => {
  const first = buildCollection(manifest, 't1'),
    again = buildCollection(manifest, 't1'),
    other = buildCollection(manifest, 't2');
  expect(first).toEqual(again);
  expect(first.questions[0].id).not.toBe(other.questions[0].id);
  expect(first.questions[0].content).not.toEqual(other.questions[0].content);
  const experiment = first.questions.find((q) => q.type === 'experiment')!;
  expect(experiment.blanks).toEqual([]);
  expect(experiment.content.filter((b) => b.type === 'subquestion')).toHaveLength(1);
  expect(
    first.questions
      .filter((q) => !['single', 'multiple'].includes(q.type))
      .every((q) => q.solution?.referenceImages?.length),
  ).toBe(true);
});
it('单题答案按题号分割，不携带全卷答案页，不与同卷其他题答案区域重叠', () => {
  for (const paper of metadata.papers) {
    const regions: { number: number; page: number; rect: number[] }[] = [];
    for (const q of paper.questions)
      for (const r of ('answerRegions' in q ? q.answerRegions : []) ?? [])
        regions.push({ number: q.number, ...r });
    for (const [i, a] of regions.entries())
      for (const b of regions.slice(i + 1)) {
        if (a.number === b.number || a.page !== b.page) continue;
        const width = Math.min(a.rect[2], b.rect[2]) - Math.max(a.rect[0], b.rect[0]);
        const height = Math.min(a.rect[3], b.rect[3]) - Math.max(a.rect[1], b.rect[1]);
        // PDF coordinates are float32; sub-millipoint rounding is far below one pixel.
        expect(
          width > 0.001 && height > 0.001,
          `${paper.key} answers ${a.number}/${b.number}`,
        ).toBe(false);
      }
  }
});
