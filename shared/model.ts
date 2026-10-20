export type QuestionType =
  'single' | 'multiple' | 'fill' | 'experiment' | 'reading' | 'calculation';
export type State = 'draft' | 'published' | 'archived';
export interface Option {
  id: string;
  text: string;
}
export interface Blank {
  id: string;
  label: string;
  score: number;
  kind: 'text' | 'number' | 'manual';
  unit?: string;
}
export type Block =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'formula'; latex: string }
  | {
      id: string;
      type: 'image';
      assetId?: string;
      src?: string;
      alt: string;
      caption: string;
      width: number;
      intrinsicWidth?: number;
      intrinsicHeight?: number;
    }
  | { id: string; type: 'table'; headers: string[]; rows: string[][] }
  | { id: string; type: 'group'; layout: 'stack' | 'mediaAside'; children: Block[] }
  | {
      id: string;
      type: 'subquestion';
      label: string;
      score: number;
      responseKind: 'blanks' | 'single' | 'multiple' | 'open';
      options?: Option[];
      children: Block[];
    };
export interface BlankRule {
  accepted: string[];
  tolerance?: number;
  ignoreWhitespace?: boolean;
}
export interface Solution {
  choices: string[];
  blanks: Record<string, BlankRule>;
  partChoices?: Record<string, string[]>;
  explanation: string;
}
export interface Question {
  id: string;
  version: number;
  bankId: string;
  type: QuestionType;
  title: string;
  score: number;
  difficulty: string;
  tags: string[];
  content: Block[];
  options: Option[];
  blanks: Blank[];
  solution?: Solution;
  state: State;
  source?: string;
  allowedModes?: ('text' | 'drawing' | 'photo')[];
  multipleScoring?: 'exact' | 'half';
}
export interface Point {
  x: number;
  y: number;
  p: number;
  t: number;
}
export interface Stroke {
  id: string;
  color: string;
  width: number;
  points: Point[];
}
export interface DrawingPage {
  id: string;
  width: number;
  height: number;
  strokes: Stroke[];
  previewAssetId?: string;
}
export interface ImagePage {
  id: string;
  assetId: string;
  rotation: number;
  name: string;
}
export interface ResponseValue {
  choiceIds: string[];
  blankValues: Record<string, string>;
  markdown: string;
  drawingPages: DrawingPage[];
  imagePages: ImagePage[];
}
export interface AnswerData extends ResponseValue {
  parts: Record<string, ResponseValue>;
  flagged: boolean;
}
export interface SavedAnswer {
  data: AnswerData;
  revision: number;
  updatedAt: string;
}
export interface Grade {
  earned: number;
  max: number;
  pending: boolean;
  status: 'correct' | 'incorrect' | 'partial' | 'pending' | 'unanswered';
  details: Record<string, { earned: number; max: number; pending: boolean }>;
}
export interface LibraryItem {
  id: string;
  kind: 'bank' | 'paper';
  title: string;
  description: string;
  chapter: string;
  accent: string;
  state: State;
  questionCount: number;
  minutes: number;
  totalScore: number;
  items?: { questionId: string; version: number; score: number }[];
}
export interface User {
  id: string;
  name: string;
  role: 'student' | 'admin';
  username: string;
}
export interface Attempt {
  id: string;
  userId: string;
  libraryId: string;
  title: string;
  status: 'active' | 'submitted';
  createdAt: string;
  updatedAt: string;
  questions: Question[];
  answers: Record<string, SavedAnswer>;
  grades?: Record<string, Grade>;
  submittedAt?: string;
}
export const typeLabels: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  fill: '填空题',
  experiment: '实验题',
  reading: '科普阅读题',
  calculation: '计算题',
};
