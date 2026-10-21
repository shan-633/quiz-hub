import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../../server/store';
import { buildRealBeijing2022 } from '../../server/content/beijing2022Real';
import { newSession } from '../../server/auth';
import { emptyAnswer } from '../../shared/domain';
import type { AnswerData, Attempt, SavedAnswer } from '../../shared/model';

export function makeFixture(dir: string, active: number, history: number) {
  mkdirSync(dir, { recursive: true });
  const store = new Store(dir),
    { paper, questions } = buildRealBeijing2022();
  const headers: Record<string, string>[] = [];
  const drawingQ = questions.find((q) => q.type === 'calculation')!;
  const answers: Record<string, SavedAnswer> = {};
  for (const q of questions.slice(0, 8))
    answers[q.id] = {
      data: { ...emptyAnswer(), choiceIds: [q.options[0].id] },
      revision: 1,
      updatedAt: '2026-10-21T00:00:00.000Z',
    };
  const drawing: AnswerData = {
    ...emptyAnswer(),
    markdown: '根据题意列式，代入数据并检验单位。'.repeat(15),
    drawingPages: [
      {
        id: 'bench-page',
        width: 900,
        height: 600,
        strokes: Array.from({ length: 20 }, (_, n) => ({
          id: `s${n}`,
          color: '#222222',
          width: 2,
          points: Array.from({ length: 25 }, (_, t) => ({
            x: t * 5 + n,
            y: n * 10 + (t % 5),
            p: 0.5,
            t: n * 100 + t,
          })),
        })),
      },
    ],
  };
  answers[drawingQ.id] = { data: drawing, revision: 1, updatedAt: '2026-10-21T00:00:00.000Z' };
  const template: Attempt = {
    id: '',
    userId: '',
    libraryId: paper.id,
    title: paper.title,
    status: 'active',
    questions,
    answers,
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
  };
  store.transaction(() => {
    store.put('library', paper.id, paper);
    store.put('users', 'bench-teacher', {
      id: 'bench-teacher',
      username: 'bench-teacher',
      name: '压测教师',
      role: 'teacher',
    });
    for (let n = 0; n < active; n++) {
      const id = `bench-student-${n}`;
      store.put('users', id, {
        id,
        username: `student${n}`,
        name: `压测学生${n}`,
        role: 'student',
      });
      const session = newSession(store, id);
      headers.push({ cookie: `zhixu_session=${session.token}`, 'x-csrf-token': session.csrfToken });
    }
    for (let n = 0; n < active + history; n++) {
      const a = {
        ...template,
        id: `bench-attempt-${n}`,
        userId: `bench-student-${n % active}`,
        status: n < active ? ('active' as const) : ('submitted' as const),
      };
      store.put('attempts', a.id, a, a.userId);
    }
  });
  const session = newSession(store, 'bench-teacher');
  const teacher = { cookie: `zhixu_session=${session.token}` };
  const fixture = {
    dir,
    active,
    history,
    headers,
    teacher,
    writeQid: drawingQ.id,
    answer: drawing,
    attemptBytes: Buffer.byteLength(
      JSON.stringify({ ...template, id: 'bench-attempt-0000', userId: 'bench-student-0000' }),
    ),
    writeBodyBytes: Buffer.byteLength(JSON.stringify({ data: drawing, expectedRevision: 1 })),
  };
  store.close();
  return fixture;
}
export type Fixture = ReturnType<typeof makeFixture>;
export function cloneFixture(fixture: Fixture, destination: string) {
  mkdirSync(destination, { recursive: true });
  const store = new Store(fixture.dir);
  store.db.exec("VACUUM INTO '" + join(destination, 'zhixu.sqlite').replaceAll("'", "''") + "'");
  store.close();
}
