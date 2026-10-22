import type { Attempt, Question, User } from './model';
export interface ClassGroup {
  id: string;
  teacherId: string;
  name: string;
  studentIds: string[];
  revision: number;
}
export interface ClassAssignment {
  id: string;
  teacherId: string;
  libraryId: string;
  title: string;
  createdAt: string;
  groupNames: string[];
  questions: Question[];
  timeLimitMinutes?: number;
  enforceTimeLimit: boolean;
  deadlineAt?: string;
}
export type TaskStatus = 'not_started' | 'active' | 'pending' | 'published' | 'expired';
export interface StudentTask {
  id: string;
  title: string;
  libraryId: string;
  teacherName: string;
  createdAt: string;
  groupNames: string[];
  questionCount: number;
  totalScore: number;
  deadlineAt?: string;
  timeLimitMinutes?: number;
  enforceTimeLimit: boolean;
  status: TaskStatus;
  attemptId?: string;
  dueAt?: string;
  late?: boolean;
  submissionReason?: Attempt['submissionReason'];
}
export interface TeacherAssignment extends Omit<StudentTask, 'teacherName' | 'status'> {
  recipientCount: number;
  submittedCount: number;
}
export interface AssignmentStudent {
  student: Pick<User, 'id' | 'name' | 'username'>;
  status: TaskStatus;
  attemptId?: string;
  submittedAt?: string;
  dueAt?: string;
  late?: boolean;
  submissionReason?: Attempt['submissionReason'];
  available: boolean;
}
export const taskStatusLabels: Record<TaskStatus, string> = {
  not_started: '未开始',
  active: '进行中',
  pending: '待批改',
  published: '已批改',
  expired: '已截止',
};
