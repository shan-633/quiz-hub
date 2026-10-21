import type { Attempt, ResponseValue } from './model';
import { isAnswered } from './domain';

function hasContent(a: ResponseValue): boolean {
  return (
    a.choiceIds.length > 0 ||
    Object.values(a.blankValues).some((v) => !!v.trim()) ||
    !!a.markdown.trim() ||
    a.imagePages.length > 0 ||
    a.drawingPages.some((p) => p.strokes.some((s) => s.points.length > 0))
  );
}

export function attemptProgress(a: Pick<Attempt, 'questions' | 'answers'>) {
  let answeredCount = 0,
    inProgressCount = 0;
  for (const q of a.questions) {
    const answer = a.answers[q.id]?.data;
    if (!answer) continue;
    if (isAnswered(q, answer)) answeredCount++;
    else if (hasContent(answer) || Object.values(answer.parts).some(hasContent)) inProgressCount++;
  }
  const questionCount = a.questions.length;
  return {
    questionCount,
    answeredCount,
    inProgressCount,
    emptyCount: questionCount - answeredCount - inProgressCount,
    percent: questionCount ? Math.floor((answeredCount / questionCount) * 100) : 0,
  };
}

export interface StudentProgress {
  id: string;
  title: string;
  libraryId: string;
  kind: 'paper' | 'bank';
  student: { id: string; name: string; username: string };
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  answeredCount: number;
  inProgressCount: number;
  emptyCount: number;
  percent: number;
}
