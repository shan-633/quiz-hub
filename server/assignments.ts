import type { Attempt, LibraryItem, User } from '../shared/model';
import type {
  ClassAssignment,
  ClassGroup,
  StudentTask,
  AssignmentStudent,
  TeacherAssignment,
} from '../shared/assignments';
import { HttpError } from './auth';
import { linked, activeUser, canManageLibrary } from './permissions';
import { libraryQuestions } from './routes/library';
import { expireAttempt, timingSnapshot, trackDeadline } from './attemptTiming';
import type { Store } from './store';
import { isBeforeOpening, latestOpening } from '../shared/availability';

export class AssignmentService {
  constructor(private store: Store) {
    store.db
      .exec(`CREATE TABLE IF NOT EXISTS class_groups(id TEXT PRIMARY KEY,teacher_id TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS class_groups_teacher ON class_groups(teacher_id);
      CREATE TABLE IF NOT EXISTS class_members(group_id TEXT NOT NULL REFERENCES class_groups(id) ON DELETE CASCADE,student_id TEXT NOT NULL,PRIMARY KEY(group_id,student_id));
      CREATE TABLE IF NOT EXISTS assignment_recipients(assignment_id TEXT NOT NULL,student_id TEXT NOT NULL,attempt_id TEXT UNIQUE,PRIMARY KEY(assignment_id,student_id));
      CREATE INDEX IF NOT EXISTS assignment_recipients_student ON assignment_recipients(student_id,assignment_id);`);
  }
  students(teacherId: string) {
    return this.store.db
      .prepare('SELECT student_id FROM teaching_links WHERE teacher_id=?')
      .all(teacherId)
      .flatMap((row) => {
        const u = activeUser(this.store, row.student_id as string, 'student');
        return u ? [{ id: u.id, name: u.name, username: u.username }] : [];
      });
  }
  groups(teacherId: string): ClassGroup[] {
    return this.store.db
      .prepare('SELECT * FROM class_groups WHERE teacher_id=? ORDER BY rowid')
      .all(teacherId)
      .map((row) => ({
        id: row.id as string,
        teacherId,
        name: row.name as string,
        revision: row.revision as number,
        studentIds: this.store.db
          .prepare('SELECT student_id FROM class_members WHERE group_id=?')
          .all(row.id)
          .map((r) => r.student_id as string)
          .filter((id) => linked(this.store, teacherId, id)),
      }));
  }
  saveGroup(
    teacherId: string,
    input: { name: string; studentIds: string[]; expectedRevision?: number },
    id?: string,
  ): ClassGroup {
    return this.store.transaction(() => {
      const old = id ? this.groups(teacherId).find((g) => g.id === id) : undefined;
      if (id && !old) throw new HttpError(404, '未找到你的班级组');
      if (old && old.revision !== input.expectedRevision)
        throw new HttpError(409, '班级组已被修改，请刷新后重试');
      const ids = [...new Set(input.studentIds)];
      if (ids.some((s) => !linked(this.store, teacherId, s)))
        throw new HttpError(422, '只能添加当前关联给自己的学生');
      const group = {
        id: id ?? crypto.randomUUID(),
        teacherId,
        name: input.name,
        studentIds: ids,
        revision: (old?.revision ?? 0) + 1,
      };
      this.store.db
        .prepare(
          'INSERT INTO class_groups VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision',
        )
        .run(group.id, teacherId, group.name, group.revision);
      this.store.db.prepare('DELETE FROM class_members WHERE group_id=?').run(group.id);
      for (const student of ids)
        this.store.db.prepare('INSERT INTO class_members VALUES(?,?)').run(group.id, student);
      return group;
    });
  }
  deleteGroup(teacherId: string, id: string, revision: number) {
    const group = this.groups(teacherId).find((g) => g.id === id);
    if (!group) throw new HttpError(404, '未找到你的班级组');
    if (group.revision !== revision) throw new HttpError(409, '班级组已被修改，请刷新');
    this.store.db.prepare('DELETE FROM class_groups WHERE id=?').run(id);
  }
  push(
    teacherId: string,
    input: {
      libraryId: string;
      groupIds: string[];
      timeLimitMinutes?: number;
      enforceTimeLimit: boolean;
      deadlineAt?: string;
      opensAt?: string;
    },
  ): TeacherAssignment {
    return this.store.transaction(() => {
      const item = this.store.get<LibraryItem>('library', input.libraryId);
      if (!canManageLibrary({ id: teacherId, role: 'teacher' } as User, item))
        throw new HttpError(404, '未找到你的题库或试卷');
      if (item!.state !== 'published') throw new HttpError(422, '请先发布题库或试卷');
      const groups = this.groups(teacherId),
        targets = [...new Set(input.groupIds)].map((id) => groups.find((g) => g.id === id));
      if (targets.some((g) => !g)) throw new HttpError(422, '班级组不存在或不属于你');
      const recipients = [...new Set(targets.flatMap((g) => g!.studentIds))];
      if (!recipients.length) throw new HttpError(422, '所选班级组没有可接收任务的学生');
      if (input.deadlineAt && Date.parse(input.deadlineAt) <= Date.now())
        throw new HttpError(422, '截止时间必须晚于现在');
      const opensAt = latestOpening(item!.opensAt, input.opensAt);
      if (opensAt && input.deadlineAt && Date.parse(opensAt) >= Date.parse(input.deadlineAt))
        throw new HttpError(422, '开放时间必须早于截止时间');
      if (input.enforceTimeLimit && !input.timeLimitMinutes && !input.deadlineAt)
        throw new HttpError(422, '强制交卷需要设置答题时限或截止时间');
      const questions = libraryQuestions(this.store, item!);
      if (!questions.length) throw new HttpError(422, '没有可推送的已发布题目');
      const assignment: ClassAssignment = {
        id: crypto.randomUUID(),
        teacherId,
        title: item!.title,
        libraryId: item!.id,
        groupNames: targets.map((g) => g!.name),
        questions,
        createdAt: new Date().toISOString(),
        timeLimitMinutes: input.timeLimitMinutes,
        enforceTimeLimit: input.enforceTimeLimit,
        deadlineAt: input.deadlineAt,
        opensAt,
      };
      this.store.put('assignments', assignment.id, assignment, teacherId);
      for (const student of recipients)
        this.store.db
          .prepare('INSERT INTO assignment_recipients(assignment_id,student_id) VALUES(?,?)')
          .run(assignment.id, student);
      return this.teacherSummary(assignment);
    });
  }
  private attempt(id: string | null): Attempt | undefined {
    const a = id ? this.store.get<Attempt>('attempts', id) : undefined;
    return a ? expireAttempt(this.store, a) : undefined;
  }
  private status(a: ClassAssignment, attempt?: Attempt): StudentTask['status'] {
    if (attempt)
      return attempt.status === 'active'
        ? 'active'
        : attempt.review?.state === 'published'
          ? 'published'
          : 'pending';
    if (a.enforceTimeLimit && a.deadlineAt && Date.parse(a.deadlineAt) <= Date.now())
      return 'expired';
    return isBeforeOpening(a.opensAt) ? 'scheduled' : 'not_started';
  }
  private metadata(a: ClassAssignment) {
    return {
      id: a.id,
      title: a.title,
      libraryId: a.libraryId,
      createdAt: a.createdAt,
      groupNames: a.groupNames,
      questionCount: a.questions.length,
      totalScore: a.questions.reduce((s, q) => s + q.score, 0),
      deadlineAt: a.deadlineAt,
      opensAt: a.opensAt,
      timeLimitMinutes: a.timeLimitMinutes,
      enforceTimeLimit: a.enforceTimeLimit,
    };
  }
  studentTasks(user: User): StudentTask[] {
    if (user.role !== 'student') throw new HttpError(403, '只有学生可访问班级任务');
    return this.store.db
      .prepare(
        'SELECT assignment_id,attempt_id FROM assignment_recipients WHERE student_id=? ORDER BY rowid DESC',
      )
      .all(user.id)
      .flatMap((row) => {
        const a = this.store.get<ClassAssignment>('assignments', row.assignment_id as string);
        if (!a) return [];
        const attempt = this.attempt(row.attempt_id as string | null);
        if (!linked(this.store, a.teacherId, user.id) && !attempt?.submittedAt) return [];
        return [
          {
            ...this.metadata(a),
            teacherName: this.store.get<User>('users', a.teacherId)?.name ?? '教师',
            status: this.status(a, attempt),
            attemptId: attempt?.id,
            dueAt: attempt?.dueAt,
            late: attempt?.late,
            submissionReason: attempt?.submissionReason,
          },
        ];
      });
  }
  start(user: User, id: string, libraryId: string): Attempt {
    return this.store.transaction(() => {
      const a = this.store.get<ClassAssignment>('assignments', id);
      const recipient = this.store.db
        .prepare(
          'SELECT attempt_id FROM assignment_recipients WHERE assignment_id=? AND student_id=?',
        )
        .get(id, user.id);
      if (
        user.role !== 'student' ||
        !a ||
        !recipient ||
        a.libraryId !== libraryId ||
        !linked(this.store, a.teacherId, user.id)
      )
        throw new HttpError(404, '未找到你的班级任务');
      const existing = this.attempt(recipient.attempt_id as string | null);
      if (existing) return existing;
      if (isBeforeOpening(a.opensAt))
        throw new HttpError(403, '任务尚未到开放时间，请稍后开始作答');
      if (this.status(a) === 'expired') throw new HttpError(409, '任务已截止，无法开始作答');
      const now = new Date().toISOString();
      const attempt: Attempt = {
        id: crypto.randomUUID(),
        userId: user.id,
        teacherId: a.teacherId,
        assignmentId: a.id,
        title: a.title,
        libraryId: a.libraryId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        questions: a.questions,
        answers: {},
        ...timingSnapshot(a, now),
      };
      this.store.put('attempts', attempt.id, attempt, user.id);
      trackDeadline(this.store, attempt);
      this.store.db
        .prepare(
          'UPDATE assignment_recipients SET attempt_id=? WHERE assignment_id=? AND student_id=?',
        )
        .run(attempt.id, id, user.id);
      return attempt;
    });
  }
  teacherSummary(a: ClassAssignment): TeacherAssignment {
    const students = this.details(a.teacherId, a.id).students;
    return {
      ...this.metadata(a),
      recipientCount: students.length,
      submittedCount: students.filter((s) => ['pending', 'published'].includes(s.status)).length,
    };
  }
  teacherTasks(teacherId: string) {
    return this.store
      .list<ClassAssignment>('assignments', teacherId)
      .reverse()
      .map((a) => this.teacherSummary(a));
  }
  details(teacherId: string, id: string): { title: string; students: AssignmentStudent[] } {
    const a = this.store.get<ClassAssignment>('assignments', id);
    if (!a || a.teacherId !== teacherId) throw new HttpError(404, '未找到你的任务');
    const students = this.store.db
      .prepare('SELECT student_id,attempt_id FROM assignment_recipients WHERE assignment_id=?')
      .all(id)
      .flatMap((row) => {
        const user = this.store.get<User>('users', row.student_id as string);
        if (!user) return [];
        const available = linked(this.store, teacherId, user.id);
        // Revoked students remain in the historical recipient count without exposing new answer state.
        const attempt = available ? this.attempt(row.attempt_id as string | null) : undefined;
        return [
          {
            student: { id: user.id, name: user.name, username: user.username },
            status: this.status(a, attempt),
            available,
            attemptId: attempt?.id,
            submittedAt: attempt?.submittedAt,
            dueAt: attempt?.dueAt,
            late: attempt?.late,
            submissionReason: attempt?.submissionReason,
          },
        ];
      });
    return { title: a.title, students };
  }
}
