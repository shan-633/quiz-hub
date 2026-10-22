import type { Attempt, Block, Grade, Question, ReviewColumn, ReviewColumnFeedback } from './model';
import { walkBlocks } from './domain';
export const reviewPoints = (n: number) => Number(n.toFixed(12));
export interface ReviewTarget extends ReviewColumn {
  kind: 'blank' | 'part' | 'whole' | 'custom';
  sourceId: string;
}
export function reviewColumns(q: Question, rubric?: ReviewColumn[]): ReviewTarget[] {
  if (rubric?.length) {
    const defaults = reviewColumns(q);
    return rubric.map((c) => ({
      ...(defaults.find((d) => d.id === c.id) ?? { kind: 'custom' as const, sourceId: c.id }),
      ...c,
    }));
  }
  if (q.type === 'single' || q.type === 'multiple')
    return [{ id: 'whole', label: '本题', max: q.score, kind: 'whole', sourceId: 'whole' }];
  const result: ReviewTarget[] = [],
    seen = new Set<string>();
  const blank = (id: string, parent = '') => {
    const b = q.blanks.find((b) => b.id === id);
    if (!b || seen.has(id)) return;
    seen.add(id);
    result.push({
      id: b.id,
      sourceId: b.id,
      label: parent ? `${parent} · ${b.label}` : b.label,
      max: b.score,
      kind: 'blank',
    });
  };
  const visit = (blocks: Block[], parent = '') => {
    for (const b of blocks) {
      if (b.type === 'subquestion') {
        if (b.responseKind !== 'blanks')
          result.push({ id: b.id, sourceId: b.id, label: b.label, max: b.score, kind: 'part' });
        visit(b.children, b.label);
      } else if (b.type === 'group') visit(b.children, parent);
      else {
        const texts =
          b.type === 'paragraph'
            ? [b.text]
            : b.type === 'table'
              ? [...b.headers, ...b.rows.flat()]
              : [];
        for (const text of texts)
          for (const match of text.matchAll(/\{\{([a-zA-Z0-9_-]+)\}\}/g)) blank(match[1], parent);
      }
    }
  };
  visit(q.content);
  for (const b of q.blanks) blank(b.id);
  if (!result.length)
    return [{ id: 'whole', label: '本题', max: q.score, kind: 'whole', sourceId: 'whole' }];
  const counts = new Map<string, number>();
  for (const c of result) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const c of result) if (counts.get(c.id)! > 1) c.id = `${c.kind}:${c.sourceId}`;
  const sum = result.reduce((n, c) => n + c.max, 0);
  // Existing calculation snapshots may use part scores as weights. Convert them
  // to the frozen whole-question maximum without changing the source snapshot.
  for (const c of result)
    c.max = reviewPoints(sum > 0 ? (c.max * q.score) / sum : q.score / result.length);
  result[result.length - 1].max = reviewPoints(
    q.score - result.slice(0, -1).reduce((n, c) => n + c.max, 0),
  );
  return result;
}
export function columnAllocationNote(q: Question): string {
  if (q.type === 'single' || q.type === 'multiple') return '';
  const parts = walkBlocks(q.content).filter(
    (b) => b.type === 'subquestion' && b.responseKind !== 'blanks',
  );
  if (!q.blanks.length && !parts.length) return '';
  const sum =
    q.blanks.reduce((n, b) => n + b.score, 0) +
    parts.reduce((n, b) => n + (b.type === 'subquestion' ? b.score : 0), 0);
  if (
    Math.abs(sum - q.score) <=
    Number.EPSILON * Math.max(1, sum, q.score) * (q.blanks.length + parts.length + 2) * 4
  )
    return '';
  return sum > 0
    ? `原小问分值合计${reviewPoints(sum)}分，与整题${q.score}分不一致；评分栏目已按原比例换算至整题总分，原卷快照保留。`
    : `小问未配置分值，评分栏目暂按整题${q.score}分平均分配；教师可核对并调整栏目分值。原卷快照保留。`;
}
export function columnReference(q: Question, column: ReviewTarget): string {
  if (column.kind === 'blank')
    return q.solution?.blanks[column.sourceId]?.accepted.join(' / ') ?? '';
  const b = walkBlocks(q.content).find((b) => b.id === column.sourceId);
  if (b?.type === 'subquestion' && (b.responseKind === 'single' || b.responseKind === 'multiple'))
    return (b.options ?? [])
      .filter((o) => q.solution?.partChoices?.[b.id]?.includes(o.id))
      .map((o) => String.fromCharCode(65 + (b.options ?? []).indexOf(o)))
      .join('、');
  return '';
}
export function validColumnScore(max: number, verdict: string, score: number): boolean {
  return (
    Number.isFinite(score) &&
    score >= 0 &&
    score <= max &&
    (verdict === 'correct'
      ? score === max
      : verdict === 'incorrect'
        ? score === 0
        : verdict === 'partial' && score > 0 && score < max)
  );
}
export function columnErrors(
  columns: ReviewColumn[],
  items: Record<string, { verdict: string; score: number }> | undefined,
  maximum: number,
): string[] {
  const errors: string[] = [];
  if (
    Math.abs(reviewPoints(columns.reduce((n, c) => n + c.max, 0)) - reviewPoints(maximum)) >
    0.000000001
  )
    errors.push(`栏目满分合计必须等于${maximum}分`);
  if (new Set(columns.map((c) => c.id)).size !== columns.length) errors.push('评分栏目ID重复');
  for (const c of columns) {
    const item = items?.[c.id];
    if (!item?.verdict) errors.push(`请完成「${c.label}」的评价`);
    else if (!validColumnScore(c.max, item.verdict, item.score))
      errors.push(`「${c.label}」分数与判定不符（满分${c.max}分）`);
  }
  if (Object.keys(items ?? {}).some((id) => !columns.some((c) => c.id === id)))
    errors.push('包含不属于本题的评分栏目');
  return errors;
}
export function columnGrade(
  q: Question,
  columns: ReviewColumn[],
  items: Record<string, ReviewColumnFeedback>,
  source: 'teacher' | 'self',
  automatic: Grade['details'] = {},
): Grade {
  const details = {
    ...automatic,
    ...Object.fromEntries(
      columns.map((c) => [c.id, { earned: items[c.id].score, max: c.max, pending: false }]),
    ),
  };
  const earned = reviewPoints(Object.values(details).reduce((n, c) => n + c.earned, 0));
  return {
    earned,
    max: q.score,
    pending: false,
    source: source === 'self' && Object.keys(automatic).length ? 'mixed' : source,
    status: earned === reviewPoints(q.score) ? 'correct' : earned > 0 ? 'partial' : 'incorrect',
    details,
  };
}
export function reviewComplete(a: Attempt, q: Question): boolean {
  const g = a.grades?.[q.id];
  if (!g || g.pending) return false;
  if (
    a.gradingMode === 'self' ? a.selfReview?.state === 'completed' : a.review?.state === 'published'
  )
    return true;
  const columns = reviewColumns(q, a.teacherFeedback?.[q.id]?.rubric);
  if (columns.length < 2) return true;
  return columns.every(
    (c) =>
      g.details[c.id] &&
      !g.details[c.id].pending &&
      Math.abs(g.details[c.id].max - c.max) < 0.000000001,
  );
}
export function columnText(
  columns: ReviewColumn[],
  items: Record<string, ReviewColumnFeedback>,
  field: 'comment' | 'correctAnswer',
) {
  return columns
    .filter((c) => items[c.id][field]?.trim())
    .map((c) => `### ${c.label}\n${items[c.id][field]!.trim()}`)
    .join('\n\n');
}
