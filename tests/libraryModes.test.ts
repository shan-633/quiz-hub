import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { ProgressStore } from '../server/progressStore';
import { emptyAnswer } from '../shared/domain';
import { reviewColumns } from '../shared/reviewColumns';
import { selfReviewParts } from '../shared/selfReview';
const resources: {
  app: Awaited<ReturnType<typeof createApp>>;
  store: ProgressStore;
  dir: string;
}[] = [];
afterEach(async () => {
  for (const f of resources.splice(0)) {
    await f.app.close();
    f.store.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'modes-')),
    app = await createApp({ dataDir: dir }),
    store = new ProgressStore(dir);
  const f = { app, store, dir };
  resources.push(f);
  const login = async (username: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: username === 'teacher' ? 'Teacher123!' : 'Student123!' },
    });
    return {
      cookie: r.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-csrf-token': r.json().csrfToken,
    };
  };
  return {
    ...f,
    t: await login('teacher'),
    s: await login('student'),
    other: await login('student2'),
  };
}
it('展示练习必须补全标准答案才能发布', async () => {
  const { app, store, t } = await setup();
  const bank = store.get<any>('library', 'bank-mechanics');
  const q = store.version('q-force', 1)!;
  const incomplete = { ...q, version: 2, solution: { choices: [], blanks: {}, explanation: '' } };
  store.publish(incomplete);
  const record = store.get<any>('questions', q.id);
  store.put('questions', q.id, { ...record, latestVersion: 2, draft: incomplete });
  const r = await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/bank-mechanics',
    headers: t,
    payload: { ...bank, deliveryMode: 'showcase' },
  });
  expect(r.statusCode).toBe(422);
  expect(store.get<any>('library', bank.id).deliveryMode).not.toBe('showcase');
});
it('既有内容默认分配，未推送学生不可见、不能开始或打印，推送仅收件学生可见', async () => {
  const { app, t, s, other } = await setup();
  expect((await app.inject({ url: '/api/library', headers: s })).json()).toEqual([]);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: 'bank-mechanics' },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/api/library/bank-mechanics/pdf',
        headers: s,
        payload: {},
      })
    ).statusCode,
  ).toBe(404);
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name: '指定组', studentIds: ['user-student'] },
    })
  ).json();
  const task = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/assignments',
      headers: t,
      payload: { libraryId: 'bank-mechanics', groupIds: [group.id] },
    })
  ).json();
  expect((await app.inject({ url: '/api/library', headers: s })).json()).toHaveLength(1);
  expect((await app.inject({ url: '/api/library', headers: other })).json()).toEqual([]);
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  expect(a.assignmentId).toBe(task.id);
  expect(a.gradingMode).toBe('teacher');
  const repeated = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics', fresh: true },
    })
  ).json();
  expect(repeated.id).toBe(a.id);
  const sent = (
    await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s })
  ).json();
  expect(JSON.stringify(sent)).not.toContain('solution');
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: `/api/attempts/${a.id}/self-review/q-force`,
        headers: s,
        payload: { expectedRevision: 1, verdict: 'correct', score: 3, comment: '' },
      })
    ).statusCode,
  ).toBe(403);
});

it('展示交卷立即给答案，只自动评选择，其余仅本人自评；不能改自动分并支持完成锁定', async () => {
  const { app, store, t, s, other } = await setup();
  const bank = store.get<any>('library', 'bank-mechanics');
  const changed = await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/bank-mechanics',
    headers: t,
    payload: { ...bank, deliveryMode: 'showcase' },
  });
  expect(changed.statusCode).toBe(200);
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: bank.id },
    })
  ).json();
  expect(a.gradingMode).toBe('self');
  expect(JSON.stringify(a)).not.toContain('solution');
  await app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/q-force`,
    headers: s,
    payload: { data: { ...emptyAnswer(), choiceIds: ['a'] }, expectedRevision: 0 },
  });
  const submitted = (
    await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s })
  ).json();
  expect(submitted.questions[0].solution).toBeTruthy();
  expect(submitted.grades['q-force'].source).toBe('auto');
  expect(submitted.grades['q-force'].earned).toBe(3);
  const fill = submitted.questions.find((q: any) => q.type === 'fill');
  expect(submitted.grades[fill.id].pending).toBe(true);
  expect(submitted.selfReview.state).toBe('in_progress');
  const save = (qid: string, headers: any, revision: number, score: number) =>
    app.inject({
      method: 'PUT',
      url: `/api/attempts/${a.id}/self-review/${qid}`,
      headers,
      payload: {
        expectedRevision: revision,
        verdict: 'correct',
        score,
        comment: '对照答案自评',
        ...(reviewColumns(submitted.questions.find((q: any) => q.id === qid)).length > 1
          ? {
              items: Object.fromEntries(
                selfReviewParts(
                  submitted,
                  submitted.questions.find((q: any) => q.id === qid),
                ).columns.map((c) => [
                  c.id,
                  { verdict: 'correct', score: c.max, comment: '对照答案自评' },
                ]),
              ),
            }
          : {}),
      },
    });
  expect((await save(fill.id, other, 1, fill.score)).statusCode).toBe(404);
  expect((await save('q-force', s, 1, 3)).statusCode).toBe(422);
  let result = await save(fill.id, s, 1, fill.score);
  expect(result.statusCode).toBe(200);
  expect(result.json().grades[fill.id].source).toBe('self');
  expect((await save(fill.id, s, 1, fill.score)).statusCode).toBe(409);
  let current = result.json();
  for (const q of current.questions)
    if (current.grades[q.id].pending) {
      result = await save(q.id, s, current.selfReview.revision, q.score);
      expect(result.statusCode).toBe(200);
      current = result.json();
    }
  const finished = await app.inject({
    method: 'POST',
    url: `/api/attempts/${a.id}/self-review/complete`,
    headers: s,
    payload: { expectedRevision: current.selfReview.revision },
  });
  expect(finished.statusCode).toBe(200);
  expect(finished.json().selfReview.state).toBe('completed');
  expect((await save(fill.id, s, finished.json().selfReview.revision, fill.score)).statusCode).toBe(
    409,
  );
  expect((await app.inject({ url: '/api/teacher/attempts', headers: t })).body).not.toContain(a.id);
  expect((await app.inject({ url: `/api/teacher/attempts/${a.id}`, headers: t })).statusCode).toBe(
    404,
  );
  const c = (
    await app.inject({
      method: 'POST',
      url: '/api/chat/conversations',
      headers: s,
      payload: { peerId: 'user-teacher' },
    })
  ).json();
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/chat/conversations/${c.id}/messages`,
        headers: s,
        payload: {
          body: '自评记录',
          clientMessageId: 'self-ref',
          reference: { attemptId: a.id, questionId: 'q-force' },
        },
      })
    ).statusCode,
  ).toBe(422);
});

it('分配任务的PDF和题干图片只来自推送快照，源库新增题不能提前泄露', async () => {
  const { app, store, t, s, dir } = await setup();
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name: '快照组', studentIds: ['user-student'] },
    })
  ).json();
  const originalTask = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/assignments',
      headers: t,
      payload: { libraryId: 'bank-mechanics', groupIds: [group.id] },
    })
  ).json();
  const old = store.get<any>('questions', 'q-force'),
    asset = store.list<any>('assets').find((a) => a.kind === 'question');
  const q = {
    ...old.draft,
    version: old.latestVersion + 1,
    content: [
      { id: 'secret', type: 'paragraph', text: '尚未推送的新题内容' },
      { id: 'new-picture', type: 'image', assetId: asset.id, alt: '新图', caption: '', width: 100 },
    ],
  };
  store.publish(q);
  store.put('questions', q.id, { ...old, draft: q, latestVersion: q.version });
  expect((await app.inject({ url: `/api/uploads/${asset.id}`, headers: s })).statusCode).toBe(404);
  let html = '';
  const rendererApp = await createApp({
    dataDir: dir,
    pdfRenderer: {
      render: async (content) => {
        html = content;
        return { bytes: Buffer.from('%PDF-1.7'), pages: 1 };
      },
      close: async () => {},
    },
  });
  try {
    await app.inject({
      method: 'POST',
      url: '/api/teacher/assignments',
      headers: t,
      payload: {
        libraryId: 'bank-mechanics',
        groupIds: [group.id],
        opensAt: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(
      (
        await rendererApp.inject({
          method: 'POST',
          url: '/api/library/bank-mechanics/pdf',
          headers: s,
          payload: { assignmentId: originalTask.id },
        })
      ).statusCode,
    ).toBe(200);
    expect(html).not.toContain('尚未推送的新题内容');
  } finally {
    await rendererApp.close();
  }
});

it('混合题自评只评人工部分，不能覆盖选择小问自动分', async () => {
  const { app, store, s } = await setup();
  const q: any = {
    ...store.version('q-lab', 1),
    id: 'self-mixed',
    bankId: 'bank-mechanics',
    type: 'experiment',
    score: 6,
    version: 1,
    options: [],
    blanks: [{ id: 'b', label: '填空', score: 2, kind: 'text' }],
    content: [
      {
        id: 'choice',
        type: 'subquestion',
        label: '选择',
        score: 2,
        responseKind: 'single',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        children: [],
      },
      {
        id: 'open',
        type: 'subquestion',
        label: '说明',
        score: 2,
        responseKind: 'open',
        children: [],
      },
    ],
    solution: {
      choices: [],
      blanks: { b: { accepted: ['正确'] } },
      partChoices: { choice: ['a'] },
      explanation: '完整标准解答',
    },
  };
  store.publish(q);
  store.put('questions', q.id, { id: q.id, bankId: q.bankId, latestVersion: 1, draft: q });
  const bank = store.get<any>('library', 'bank-mechanics');
  store.put(
    'library',
    'self-paper',
    {
      ...bank,
      id: 'self-paper',
      kind: 'paper',
      deliveryMode: 'showcase',
      items: [{ questionId: q.id, version: 1, score: 6 }],
    },
    bank.teacherId,
  );
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'self-paper' },
    })
  ).json();
  const data = emptyAnswer();
  data.parts.choice = { ...emptyAnswer(), choiceIds: ['a'] };
  await app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/${q.id}`,
    headers: s,
    payload: { data, expectedRevision: 0 },
  });
  const submitted = (
    await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s })
  ).json();
  expect(submitted.grades[q.id].earned).toBe(2);
  const save = (verdict: string, score: number, expectedRevision: number) =>
    app.inject({
      method: 'PUT',
      url: `/api/attempts/${a.id}/self-review/${q.id}`,
      headers: s,
      payload: {
        verdict,
        score,
        expectedRevision,
        comment: '',
        items: Object.fromEntries(
          selfReviewParts(submitted, q).columns.map((c) => [
            c.id,
            { verdict, score: (score * c.max) / 4, comment: '' },
          ]),
        ),
      },
    });
  expect((await save('correct', 6, 1)).statusCode).toBe(422);
  const full = await save('correct', 4, 1);
  expect(full.statusCode).toBe(200);
  expect(full.json().grades[q.id].earned).toBe(6);
  const wrong = await save('incorrect', 0, 2);
  expect(wrong.json().grades[q.id].earned).toBe(2);
  expect(wrong.json().grades[q.id].details.choice.earned).toBe(2);
});

it('类别切换不改变已开始答卷的答案公布和批改方式', async () => {
  const { app, store, s, t } = await setup();
  const group = (
    await app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name: '快照', studentIds: ['user-student'] },
    })
  ).json();
  await app.inject({
    method: 'POST',
    url: '/api/teacher/assignments',
    headers: t,
    payload: { libraryId: 'bank-mechanics', groupIds: [group.id] },
  });
  const assigned = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  const bank = store.get<any>('library', 'bank-mechanics');
  await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/bank-mechanics',
    headers: t,
    payload: { ...bank, deliveryMode: 'showcase' },
  });
  const self = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: bank.id },
    })
  ).json();
  expect(self.gradingMode).toBe('self');
  await app.inject({
    method: 'PUT',
    url: '/api/teacher/banks/bank-mechanics',
    headers: t,
    payload: { ...bank, deliveryMode: 'assigned' },
  });
  const teacherResult = await app.inject({
    method: 'POST',
    url: `/api/attempts/${assigned.id}/submit`,
    headers: s,
  });
  expect(teacherResult.body).not.toContain('solution');
  const selfResult = await app.inject({
    method: 'POST',
    url: `/api/attempts/${self.id}/submit`,
    headers: s,
  });
  expect(selfResult.json().gradingMode).toBe('self');
  expect(selfResult.json().questions[0].solution).toBeTruthy();
  const history = (await app.inject({ url: '/api/attempts', headers: s })).json();
  expect(history.find((a: any) => a.id === self.id).repeatAvailable).toBe(false);
});

it.each([0, 0.3])('混合题人工部分为%s分时仍可正常自评并完成', async (manual) => {
  const { app, store, s } = await setup();
  const score = 0.1 + manual;
  const q: any = {
    ...store.version('q-lab', 1),
    id: 'edge-mixed',
    bankId: 'bank-mechanics',
    type: 'experiment',
    score,
    version: 1,
    blanks: [],
    options: [],
    content: [
      {
        id: 'choice',
        type: 'subquestion',
        label: '选择',
        score: 0.1,
        responseKind: 'single',
        options: [
          { id: 'a', text: 'A' },
          { id: 'b', text: 'B' },
        ],
        children: [],
      },
      {
        id: 'open',
        type: 'subquestion',
        label: '说明',
        score: manual,
        responseKind: 'open',
        children: [],
      },
    ],
    solution: { choices: [], blanks: {}, partChoices: { choice: ['a'] }, explanation: '标准解答' },
  };
  store.publish(q);
  store.put('questions', q.id, { id: q.id, bankId: q.bankId, latestVersion: 1, draft: q });
  const bank = store.get<any>('library', 'bank-mechanics');
  store.put(
    'library',
    'edge-paper',
    {
      ...bank,
      id: 'edge-paper',
      kind: 'paper',
      deliveryMode: 'showcase',
      items: [{ questionId: q.id, version: 1, score }],
    },
    bank.teacherId,
  );
  const a = (
    await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'edge-paper' },
    })
  ).json();
  const data = emptyAnswer();
  data.parts.choice = { ...emptyAnswer(), choiceIds: ['a'] };
  await app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/answers/${q.id}`,
    headers: s,
    payload: { data, expectedRevision: 0 },
  });
  await app.inject({ method: 'POST', url: `/api/attempts/${a.id}/submit`, headers: s });
  const saved = await app.inject({
    method: 'PUT',
    url: `/api/attempts/${a.id}/self-review/${q.id}`,
    headers: s,
    payload: {
      expectedRevision: 1,
      items: { open: { verdict: 'correct', score: manual, comment: '对照答案确认' } },
    },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().grades[q.id].earned).toBeCloseTo(score);
  expect(saved.json().grades[q.id].status).toBe('correct');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: `/api/attempts/${a.id}/self-review/complete`,
        headers: s,
        payload: { expectedRevision: 2 },
      })
    ).statusCode,
  ).toBe(200);
});
