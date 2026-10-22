import type { Attempt, Grade, Question, SelfFeedback } from './model';
import { initialReview } from './teacherReview';
import { reviewColumns } from './reviewColumns';
const points = (n: number) => Number(n.toFixed(12));

export function selfReviewParts(a: Attempt, q: Question) {
  const initial = initialReview([q], a.answers).grades[q.id];
  const automatic = Object.fromEntries(
    Object.entries(initial.details).filter(([, unit]) => !unit.pending),
  );
  const maximum =
    q.type === 'single' || q.type === 'multiple'
      ? 0
      : Math.max(
          0,
          points(q.score - Object.values(automatic).reduce((s, unit) => s + unit.max, 0)),
        );
  return {
    automatic,
    maximum,
    hasManual: Object.values(initial.details).some((unit) => unit.pending),
    earned: points(Object.values(automatic).reduce((s, unit) => s + unit.earned, 0)),
    columns: reviewColumns(q).filter((c) => !Object.hasOwn(automatic, c.id)),
  };
}
export function validManualScore(
  max: number,
  verdict: SelfFeedback['verdict'],
  score: number,
): boolean {
  return (
    Number.isFinite(score) &&
    score >= 0 &&
    score <= max &&
    (verdict === 'correct'
      ? score === max
      : verdict === 'incorrect'
        ? score === 0
        : score > 0 && score < max)
  );
}
export function selfGrade(a: Attempt, q: Question, score: number): Grade {
  const { automatic, maximum, earned: autoEarned } = selfReviewParts(a, q);
  const earned = points(autoEarned + score);
  let key = 'self';
  while (key in automatic) key = '_' + key;
  return {
    earned,
    max: q.score,
    pending: false,
    source: Object.keys(automatic).length ? 'mixed' : 'self',
    status: earned === points(q.score) ? 'correct' : earned > 0 ? 'partial' : 'incorrect',
    details: { ...automatic, [key]: { earned: score, max: maximum, pending: false } },
  };
}
