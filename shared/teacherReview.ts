import type { Attempt, Grade, Question, Review } from './model';
import { emptyAnswer, gradeQuestion, walkBlocks } from './domain';

/** Completeness is checked on the frozen attempt, never the current question bank. */
export function hasCompleteStandardAnswer(q: Question): boolean {
  const s = q.solution;
  if (!s) return false;
  const choicesComplete = (ids: string[], options: Question['options'], single: boolean) =>
    ids.length > 0 &&
    (!single || ids.length === 1) &&
    new Set(ids).size === ids.length &&
    ids.every((id) => options.some((o) => o.id === id));
  if (q.type === 'single' || q.type === 'multiple')
    return choicesComplete(s.choices, q.options, q.type === 'single');
  if (q.type === 'calculation' && !s.explanation.trim()) return false;
  if (
    q.blanks.some((b) =>
      b.kind === 'manual'
        ? !s.explanation.trim()
        : !s.blanks[b.id]?.accepted.length ||
          s.blanks[b.id].accepted.some(
            (v) => !v.trim() || (b.kind === 'number' && !Number.isFinite(Number(v))),
          ),
    )
  )
    return false;
  return walkBlocks(q.content).every(
    (b) =>
      b.type !== 'subquestion' ||
      (b.responseKind === 'single' || b.responseKind === 'multiple'
        ? choicesComplete(s.partChoices?.[b.id] ?? [], b.options ?? [], b.responseKind === 'single')
        : b.responseKind === 'open'
          ? !!s.explanation.trim()
          : true),
  );
}

export function referenceAnswer(q: Question): string {
  const s = q.solution;
  if (!s) return '';
  const letters = (ids: string[], options: Question['options']) =>
    options
      .filter((o) => ids.includes(o.id))
      .map((o) => String.fromCharCode(65 + options.indexOf(o)))
      .join('、');
  return [
    s.choices.length ? `正确选项：${letters(s.choices, q.options)}` : '',
    ...q.blanks.map((b) => `${b.label}：${s.blanks[b.id]?.accepted.join(' / ') || '参见解析'}`),
    ...walkBlocks(q.content).flatMap((b) =>
      b.type === 'subquestion' && (b.responseKind === 'single' || b.responseKind === 'multiple')
        ? [`${b.label}：${letters(s.partChoices?.[b.id] ?? [], b.options ?? [])}`]
        : [],
    ),
    s.explanation,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function initialReview(questions: Question[], answers: Attempt['answers']) {
  const autoEligible = questions.length > 0 && questions.every(hasCompleteStandardAnswer);
  let autoCount = 0;
  const grades: Record<string, Grade> = {};
  for (const q of questions) {
    const a = answers[q.id]?.data ?? emptyAnswer();
    if (autoEligible && (q.type === 'single' || q.type === 'multiple')) {
      grades[q.id] = { ...gradeQuestion(q, a), source: 'auto' };
      autoCount++;
      continue;
    }
    const details: Grade['details'] = {};
    if (q.type === 'single' || q.type === 'multiple' || q.type === 'calculation')
      details.whole = { earned: 0, max: q.score, pending: true };
    else {
      for (const b of q.blanks) details[b.id] = { earned: 0, max: b.score, pending: true };
      for (const b of walkBlocks(q.content)) {
        if (b.type !== 'subquestion' || b.responseKind === 'blanks') continue;
        if (autoEligible && (b.responseKind === 'single' || b.responseKind === 'multiple')) {
          const synthetic: Question = {
            ...q,
            type: b.responseKind,
            score: b.score,
            options: b.options ?? [],
            multipleScoring: 'exact',
            solution: { choices: q.solution!.partChoices![b.id], blanks: {}, explanation: '' },
          };
          const g = gradeQuestion(synthetic, { ...emptyAnswer(), ...a.parts[b.id] });
          details[b.id] = { earned: g.earned, max: b.score, pending: false };
          autoCount++;
        } else details[b.id] = { earned: 0, max: b.score, pending: true };
      }
    }
    if (!Object.keys(details).length) details.whole = { earned: 0, max: q.score, pending: true };
    const units = Object.values(details),
      pending = units.some((u) => u.pending),
      earned = units.reduce((s, u) => s + u.earned, 0);
    grades[q.id] = {
      earned,
      max: q.score,
      pending,
      status: pending
        ? 'pending'
        : earned === q.score
          ? 'correct'
          : earned > 0
            ? 'partial'
            : 'incorrect',
      details,
      source: units.some((u) => !u.pending) ? (pending ? 'mixed' : 'auto') : 'pending',
    };
  }
  const review: Review = {
    state: 'pending',
    revision: 1,
    autoEligible,
    autoCount,
    autoReason: !autoEligible
      ? '本次卷面有标准答案缺失，全卷等待人工批改。'
      : autoCount
        ? `标准答案完整，已初评 ${autoCount} 个选择作答点；其他题人工批改。`
        : '标准答案完整，本次没有可自动初评的选择题。',
    receivedAt: new Date().toISOString(),
  };
  return { grades, review };
}
