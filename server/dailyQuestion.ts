import { randomInt } from 'node:crypto';
import type { Attempt, LibraryItem, Question, User } from '../shared/model';
import type { DailyEntry, DailyOverview } from '../shared/dailyQuestion';
import { beijingDate } from '../shared/dailyQuestion';
import { curriculumOf } from '../shared/curriculum';
import { hasCompleteStandardAnswer } from '../shared/teacherReview';
import { isBeforeOpening } from '../shared/availability';
import { HttpError } from './auth';
import { canContinue, canReadLibrary } from './permissions';
import type { Store } from './store';
import type { AssignmentService } from './assignments';

export class DailyQuestionService {
  constructor(
    private store: Store,
    private assignments?: AssignmentService,
  ) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS daily_questions(
      user_id TEXT NOT NULL,day TEXT NOT NULL,attempt_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY(user_id,day));`);
  }
  private entry(user: User, day: string, attemptId: string): DailyEntry | undefined {
    const a = this.store.get<Attempt>('attempts', attemptId);
    if (!a || a.userId !== user.id) return undefined;
    const grade = a.grades?.[a.questions[0]?.id];
    return {
      date: day,
      attemptId,
      status: a.status,
      result:
        a.status === 'submitted' && a.review?.state === 'published' && grade && !grade.pending
          ? grade.status === 'correct'
            ? 'correct'
            : 'incorrect'
          : null,
      available: a.status === 'submitted' || canContinue(this.store, user, a),
      curriculum: curriculumOf(a),
    };
  }
  overview(user: User, month = beijingDate().slice(0, 7)): DailyOverview {
    const today = beijingDate();
    const rows = this.store.db
      .prepare(
        'SELECT day,attempt_id FROM daily_questions WHERE user_id=? AND day>=? AND day<=? ORDER BY day',
      )
      .all(user.id, `${month}-01`, `${month}-31`);
    const entries = rows.flatMap(
      (r) => this.entry(user, r.day as string, r.attempt_id as string) ?? [],
    );
    const todayRow = this.store.db
      .prepare('SELECT attempt_id FROM daily_questions WHERE user_id=? AND day=?')
      .get(user.id, today);
    return {
      today,
      month,
      entries,
      ...(todayRow ? { todayEntry: this.entry(user, today, todayRow.attempt_id as string) } : {}),
    };
  }
  start(user: User): { attemptId: string; created: boolean } {
    return this.store.transaction(() => {
      const day = beijingDate();
      const prior = this.store.db
        .prepare('SELECT attempt_id FROM daily_questions WHERE user_id=? AND day=?')
        .get(user.id, day);
      if (prior) {
        const entry = this.entry(user, day, prior.attempt_id as string);
        if (!entry?.available)
          throw new HttpError(403, '当前每日一题的教学关系已改变，无法继续作答');
        return { attemptId: entry.attemptId, created: false };
      }
      const banks = new Map(
        this.store
          .list<LibraryItem>('library')
          .filter(
            (b) =>
              b.kind === 'bank' &&
              b.deliveryMode === 'showcase' &&
              b.state === 'published' &&
              !isBeforeOpening(b.opensAt) &&
              canReadLibrary(this.store, user, b),
          )
          .map((b) => [b.id, b]),
      );
      const candidates: { q: Question; bank: LibraryItem }[] = [];
      const seen = new Set<string>();
      const add = (q: Question, bank: LibraryItem) => {
        const key = `${bank.id}:${q.id}:${q.version}`;
        if (
          !seen.has(key) &&
          (q.type === 'single' || q.type === 'multiple') &&
          hasCompleteStandardAnswer(q)
        ) {
          seen.add(key);
          candidates.push({ q, bank });
        }
      };
      // Only project identifiers here: drafts and historical answer payloads stay in SQLite.
      for (const row of this.store.db
        .prepare(
          `SELECT id,
        json_extract(data,'$.bankId') AS bank_id,json_extract(data,'$.latestVersion') AS version
        FROM documents WHERE collection='questions' AND COALESCE(json_extract(data,'$.archived'),0)=0
        AND json_extract(data,'$.latestVersion')>0`,
        )
        .iterate()) {
        const bank = banks.get(row.bank_id as string);
        if (!bank) continue;
        const q = this.store.version(row.id as string, row.version as number);
        if (q) add(q, bank);
      }
      // Assigned banks contribute only the already-delivered, opened snapshot.
      // New source-bank questions and future pushes must never enter this pool.
      for (const task of this.assignments?.received(user.id) ?? []) {
        const bank = this.store.get<LibraryItem>('library', task.libraryId);
        if (
          !bank ||
          bank.kind !== 'bank' ||
          bank.deliveryMode === 'showcase' ||
          bank.state !== 'published' ||
          bank.teacherId !== task.teacherId ||
          isBeforeOpening(task.opensAt) ||
          !canReadLibrary(this.store, user, bank)
        )
          continue;
        for (const q of task.questions) add(q, { ...bank, curriculum: curriculumOf(task) });
      }
      if (!candidates.length)
        throw new HttpError(
          422,
          '暂无可用的每日一题，请等待老师发布展示题库，或推送已开放且有完整答案的单选、多选题库',
        );
      const { q, bank } = candidates[randomInt(candidates.length)];
      const now = new Date().toISOString();
      const a: Attempt = {
        id: crypto.randomUUID(),
        userId: user.id,
        teacherId: bank.teacherId,
        libraryId: bank.id,
        curriculum: curriculumOf(bank),
        dailyDate: day,
        title: `${day} · 每日一题`,
        status: 'active',
        gradingMode: 'self',
        createdAt: now,
        updatedAt: now,
        questions: [q],
        answers: {},
      };
      this.store.put('attempts', a.id, a, user.id);
      this.store.db.prepare('INSERT INTO daily_questions VALUES(?,?,?)').run(user.id, day, a.id);
      return { attemptId: a.id, created: true };
    });
  }
}
