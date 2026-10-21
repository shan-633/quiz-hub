import type { Attempt, Grade } from '../shared/model';

export type FeedbackBand =
  'perfect' | 'excellent' | 'secure' | 'caution' | 'warning' | 'danger' | 'pending';
const feedback: Record<FeedbackBand, { title: string; description: string }> = {
  perfect: {
    title: '全部答对，这次掌握得很扎实。',
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
export function getAccuracyFeedback(accuracy: number | null) {
  const band: FeedbackBand =
    accuracy === null
      ? 'pending'
      : accuracy >= 100
        ? 'perfect'
        : accuracy >= 90
          ? 'excellent'
          : accuracy >= 85
            ? 'secure'
            : accuracy >= 75
              ? 'caution'
              : accuracy >= 60
                ? 'warning'
                : 'danger';
  return { band, ...feedback[band] };
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
