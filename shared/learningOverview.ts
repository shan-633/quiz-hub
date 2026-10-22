import type { Attempt } from './model';

export interface AttemptPerformance {
  correct: number;
  partial: number;
  total: number;
  earned: number;
  max: number;
}
export interface AttemptSummary {
  id: string;
  title: string;
  libraryId: string;
  status: Attempt['status'];
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  questionCount: number;
  answeredCount: number;
  totalScore: number;
  earned?: number;
  pending?: boolean;
  reviewState?: NonNullable<Attempt['review']>['state'];
  gradingMode?: Attempt['gradingMode'];
  selfReviewState?: NonNullable<Attempt['selfReview']>['state'];
  available?: boolean;
  performance?: AttemptPerformance;
}
export function attemptPerformance(a: Attempt): AttemptPerformance | undefined {
  if (
    a.status !== 'submitted' ||
    !a.questions.length ||
    !a.grades ||
    (a.review && a.review.state !== 'published') ||
    (a.gradingMode === 'self' && a.selfReview?.state !== 'completed')
  )
    return;
  const grades = a.questions.map((q) => a.grades![q.id]);
  if (grades.some((g) => !g || g.pending)) return;
  return {
    correct: grades.filter((g) => g.status === 'correct').length,
    partial: grades.filter((g) => g.status === 'partial').length,
    total: a.questions.length,
    earned: Math.round(grades.reduce((n, g) => n + g.earned, 0) * 100) / 100,
    max: Math.round(a.questions.reduce((n, q) => n + q.score, 0) * 100) / 100,
  };
}

export function learningStage(a: AttemptSummary) {
  if (a.status === 'active') return 'active';
  if (a.gradingMode === 'self' && a.selfReviewState === 'in_progress') return 'self';
  if (a.reviewState) return a.reviewState === 'published' ? 'graded' : 'pending';
  return !a.pending && typeof a.earned === 'number' ? 'graded' : 'pending';
}
export const learningStageLabels = {
  active: '未答完',
  self: '待自评',
  graded: '已批改',
  pending: '待批改',
};
export const attemptHref = (a: AttemptSummary) =>
  learningStage(a) === 'self' ? `/attempts/${a.id}/self-review` : `/attempts/${a.id}`;

// Calendar days use the school's timezone, including when a device is travelling.
const dayFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function learningDay(value: string | number | Date): string {
  return dayFormatter.format(new Date(value));
}
export interface LearningDay {
  date: string;
  future: boolean;
  attempts: AttemptSummary[];
  correct: number;
  total: number;
  pending: number;
  accuracy?: number;
}
export function learningCalendar(
  attempts: AttemptSummary[],
  now: Date = new Date(),
): LearningDay[] {
  const today = learningDay(now),
    end = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (end.getUTCDay() + 6) % 7;
  const start = end.getTime() - (77 + mondayOffset) * 86400000;
  const buckets = new Map<string, AttemptSummary[]>();
  for (const a of attempts) {
    if (a.status !== 'submitted') continue;
    const value = a.submittedAt ?? a.updatedAt;
    if (!Number.isFinite(Date.parse(value))) continue;
    const day = learningDay(value);
    const bucket = buckets.get(day);
    if (bucket) bucket.push(a);
    else buckets.set(day, [a]);
  }
  return Array.from({ length: 84 }, (_, index) => {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    const rows = (buckets.get(date) ?? []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const correct = rows.reduce((n, a) => n + (a.performance?.correct ?? 0), 0);
    const total = rows.reduce((n, a) => n + (a.performance?.total ?? 0), 0);
    return {
      date,
      future: date > today,
      attempts: rows,
      correct,
      total,
      pending: rows.filter((a) => !a.performance).length,
      accuracy: total ? (correct / total) * 100 : undefined,
    };
  });
}
export function accuracyTone(accuracy: number | undefined): string {
  if (accuracy === undefined) return 'waiting';
  if (accuracy >= 100) return 'perfect';
  if (accuracy >= 90) return 'strong';
  if (accuracy >= 85) return 'safe';
  if (accuracy >= 75) return 'steady';
  if (accuracy >= 60) return 'warning';
  return 'risk';
}
