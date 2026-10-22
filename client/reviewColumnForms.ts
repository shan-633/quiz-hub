import type { Attempt, Question, ReviewColumn, ReviewColumnFeedback } from '../shared/model';
import { columnReference, reviewColumns } from '../shared/reviewColumns';
export interface ColumnForm {
  verdict: ReviewColumnFeedback['verdict'] | '';
  score: string;
  correctAnswer: string;
  comment: string;
}
export type ColumnForms = Record<string, ColumnForm>;
export function columnForms(
  a: Attempt,
  q: Question,
  self = false,
  rubric?: ReviewColumn[],
): ColumnForms {
  const feedback = self ? a.selfReview?.feedback[q.id] : a.teacherFeedback?.[q.id];
  return Object.fromEntries(
    reviewColumns(q, rubric).map((c) => {
      const f = feedback?.items?.[c.id],
        g = a.grades?.[q.id]?.details[c.id];
      const prior =
        !self && g && !g.pending
          ? g.earned === g.max
            ? 'correct'
            : g.earned > 0
              ? 'partial'
              : 'incorrect'
          : '';
      return [
        c.id,
        {
          verdict: f?.verdict ?? prior,
          score: String(f?.score ?? (!self && g && !g.pending ? g.earned : 0)),
          correctAnswer: f?.correctAnswer ?? columnReference(q, c),
          comment: f?.comment ?? '',
        },
      ];
    }),
  );
}
export function columnPayload(forms: ColumnForms, columns: ReviewColumn[], self = false) {
  return Object.fromEntries(
    columns.map((c) => {
      const f = forms[c.id];
      return [
        c.id,
        {
          verdict: f?.verdict ?? '',
          score: f?.score.trim() ? Number(f.score) : NaN,
          comment: f?.comment ?? '',
          ...(!self ? { correctAnswer: f?.correctAnswer ?? '' } : {}),
        },
      ];
    }),
  );
}
