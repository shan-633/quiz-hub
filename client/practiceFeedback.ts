import type { Attempt, Grade } from '../shared/model';

export type FeedbackBand =
  'perfect' | 'excellent' | 'secure' | 'caution' | 'warning' | 'danger' | 'pending';
const feedback: Record<FeedbackBand, { title: string; description: string }> = {
  perfect: {
    title: '拿到满分，这次掌握得很扎实。',
    description: '继续保持，也试着把解题思路讲清楚。',
  },
  excellent: {
    title: '表现很稳，再打磨一点细节。',
    description: '把少数错题弄懂，下次更接近满分。',
  },
  secure: {
    title: '基础扎实，继续保持这个节奏。',
    description: '把容易混淆的地方再练一次，让理解更牢固。',
  },
  caution: {
    title: '还有薄弱点，值得回头再练。',
    description: '优先重做错题，找出概念或步骤中的缺口。',
  },
  warning: {
    title: '需要留意，先把关键知识补牢。',
    description: '从错得最多的知识点开始，配合解析重新练习。',
  },
  danger: {
    title: '先停一停，把基础一步步补回来。',
    description: '不用赶进度，先读解析，再完成一组基础练习。',
  },
  pending: {
    title: '答案已保存，等评阅后再看结果。',
    description: '开放作答还需要人工评阅，可以先对照解析回顾思路。',
  },
};
export function getScoreFeedback(scoreRate: number | null) {
  const band: FeedbackBand =
    scoreRate === null
      ? 'pending'
      : scoreRate >= 100
        ? 'perfect'
        : scoreRate >= 90
          ? 'excellent'
          : scoreRate >= 85
            ? 'secure'
            : scoreRate >= 75
              ? 'caution'
              : scoreRate >= 60
                ? 'warning'
                : 'danger';
  return { band, ...feedback[band] };
}
export function summarizeScore(
  questions: { id: string; score: number }[],
  grades: Attempt['grades'],
) {
  let earnedScore = 0,
    gradedScore = 0,
    pendingScore = 0,
    totalScore = 0,
    gradedEarned = 0;
  for (const q of questions) {
    totalScore += q.score;
    const grade = grades?.[q.id];
    if (!grade) {
      pendingScore += q.score;
      continue;
    }
    earnedScore += grade.earned;
    if (grade.pending || grade.status === 'pending') {
      const parts = Object.values(grade.details);
      const ungraded = parts.length
        ? parts.filter((p) => p.pending).reduce((sum, p) => sum + p.max, 0)
        : q.score;
      pendingScore += ungraded;
      gradedScore += Math.max(0, q.score - ungraded);
      gradedEarned += parts.filter((p) => !p.pending).reduce((sum, p) => sum + p.earned, 0);
    } else {
      gradedScore += q.score;
      gradedEarned += grade.earned;
    }
  }
  const clean = (value: number) => Number(value.toPrecision(12));
  earnedScore = clean(earnedScore);
  gradedScore = clean(gradedScore);
  pendingScore = clean(pendingScore);
  totalScore = clean(totalScore);
  const scoreRate =
    gradedScore > 0
      ? Math.min(100, Math.max(0, clean((clean(gradedEarned) * 100) / gradedScore)))
      : null;
  return {
    earnedScore,
    gradedScore,
    pendingScore,
    totalScore,
    scoreRate,
    displayScoreRate: scoreRate === null ? '—' : String(Math.floor(scoreRate * 10) / 10),
  };
}
export function summarizeResult(questions: { id: string }[], grades: Attempt['grades']) {
  let correct = 0,
    graded = 0;
  for (const q of questions) {
    const grade = grades?.[q.id];
    if (!grade || grade.pending || grade.status === 'pending') continue;
    graded++;
    if (grade.status === 'correct') correct++;
  }
  return {
    correct,
    graded,
    pending: questions.length - graded,
    total: questions.length,
    accuracy: graded ? (correct * 100) / graded : null,
    // Truncate display only, so 99.95% cannot read as 100% or promote the feedback tier.
    displayAccuracy: graded ? String(Math.floor((correct * 1000) / graded) / 10) : '—',
  };
}
export function navigatorState(submitted: boolean, answered: boolean, grade: Grade | undefined) {
  if (!submitted) return answered ? 'answered' : 'empty';
  return !grade || grade.pending ? 'pending' : grade.status;
}
export const navigatorLabels = {
  correct: '回答正确',
  incorrect: '回答错误',
  partial: '部分正确',
  unanswered: '未作答',
  pending: '待评阅',
  answered: '已作答',
  empty: '未作答',
};
