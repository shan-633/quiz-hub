import type { Attempt, Question, User } from './model';
import type { Curriculum } from './curriculum';
export interface ClassGroup {
  id: string;
  teacherId: string;
  name: string;
  studentIds: string[];
  revision: number;
}
export interface ClassAssignment {
  curriculum?: Curriculum;
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
  opensAt?: string;
}
export type TaskStatus =
  'scheduled' | 'not_started' | 'active' | 'pending' | 'published' | 'expired';
export interface StudentTask {
  curriculum?: Curriculum;
  id: string;
  title: string;
  libraryId: string;
  teacherName: string;
  createdAt: string;
  groupNames: string[];
  questionCount: number;
  totalScore: number;
  deadlineAt?: string;
  opensAt?: string;
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
  scheduled: '未开放',
  not_started: '未开始',
  active: '进行中',
  pending: '待批改',
  published: '已批改',
  expired: '已截止',
};
