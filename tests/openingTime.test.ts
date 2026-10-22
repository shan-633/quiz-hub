import { afterEach, expect, it } from 'vitest';
import { community } from './fixtures/community';
import { createApp } from '../server/app';
const fixtures: Awaited<ReturnType<typeof community>>[] = [];
async function showcaseCommunity() {
  const f = await community({ assigned: false });
  for (const item of f.store.list<any>('library'))
    f.store.put('library', item.id, { ...item, deliveryMode: 'showcase' }, item.teacherId);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

it('题库和试卷保存开放时间，开放前拒绝开始与打印，到时可开始', async () => {
  const f = await showcaseCommunity();
  fixtures.push(f);
  const t = await f.login('teacher'),
    s = await f.login('student');
  const opensAt = new Date(Date.now() + 3600000).toISOString();
  const all = f.store.list<any>('library');
  for (const kind of ['bank', 'paper']) {
    const item = all.find(
      (i) => i.kind === kind && i.teacherId === 'user-teacher' && i.state === 'published',
    )!;
    const path = item.kind === 'bank' ? 'banks' : 'papers';
    const saved = await f.app.inject({
      method: 'PUT',
      url: `/api/teacher/${path}/${item.id}`,
      headers: t,
      payload: { ...item, opensAt },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().opensAt).toBe(opensAt);
    expect(
      (
        await f.app.inject({
          method: 'POST',
          url: '/api/attempts',
          headers: s,
          payload: { libraryId: item.id },
        })
      ).statusCode,
    ).toBe(403);
    const pdf = await f.app.inject({
      method: 'POST',
      url: `/api/library/${item.id}/pdf`,
      headers: s,
      payload: {},
    });
    expect(pdf.statusCode).toBe(403);
    expect(pdf.body).toContain('开放');
  }
  const item = f.store.get<any>('library', 'bank-mechanics');
  f.store.put(
    'library',
    item.id,
    { ...item, opensAt: new Date(Date.now() - 1000).toISOString() },
    item.teacherId,
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: item.id },
      })
    ).statusCode,
  ).toBe(201);
});

it('班级任务继承较晚开放时间，未开放显示状态并阻止直接开始，开放与截止区间须有效', async () => {
  const f = await showcaseCommunity();
  fixtures.push(f);
  const t = await f.login('teacher'),
    s = await f.login('student');
  const item = f.store.get<any>('library', 'bank-mechanics');
  const opensAt = new Date(Date.now() + 3600000).toISOString();
  f.store.put('library', item.id, { ...item, opensAt, deliveryMode: 'assigned' }, item.teacherId);
  const g = (
    await f.app.inject({
      method: 'POST',
      url: '/api/teacher/groups',
      headers: t,
      payload: { name: '一班', studentIds: ['user-student'] },
    })
  ).json();
  const payload = {
    libraryId: item.id,
    groupIds: [g.id],
    opensAt: new Date(Date.now() + 60000).toISOString(),
  };
  const pushed = await f.app.inject({
    method: 'POST',
    url: '/api/teacher/assignments',
    headers: t,
    payload,
  });
  expect(pushed.statusCode).toBe(201);
  expect(pushed.json().opensAt).toBe(opensAt);
  const id = pushed.json().id;
  expect((await f.app.inject({ url: '/api/tasks', headers: s })).json()[0].status).toBe(
    'scheduled',
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: item.id, assignmentId: id },
      })
    ).statusCode,
  ).toBe(403);
  const invalid = await f.app.inject({
    method: 'POST',
    url: '/api/teacher/assignments',
    headers: t,
    payload: { ...payload, deadlineAt: new Date(Date.parse(opensAt) - 1).toISOString() },
  });
  expect(invalid.statusCode).toBe(422);
  const task = f.store.get<any>('assignments', id);
  f.store.put(
    'assignments',
    id,
    { ...task, opensAt: new Date(Date.now() - 1).toISOString() },
    item.teacherId,
  );
  expect((await f.app.inject({ url: '/api/tasks', headers: s })).json()[0].status).toBe(
    'not_started',
  );
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: item.id, assignmentId: id },
      })
    ).statusCode,
  ).toBe(201);
});

it('设置未来开放时间不修改既有答卷，旧记录仍可继续和查看', async () => {
  const f = await showcaseCommunity();
  fixtures.push(f);
  const s = await f.login('student'),
    t = await f.login('teacher');
  const a = (
    await f.app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: s,
      payload: { libraryId: 'bank-mechanics' },
    })
  ).json();
  const item = f.store.get<any>('library', 'bank-mechanics');
  await f.app.inject({
    method: 'PUT',
    url: `/api/teacher/banks/${item.id}`,
    headers: t,
    payload: { ...item, opensAt: new Date(Date.now() + 3600000).toISOString() },
  });
  const existing = await f.app.inject({ url: `/api/attempts/${a.id}`, headers: s });
  expect(existing.statusCode).toBe(200);
  expect(existing.json().status).toBe('active');
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: item.id },
      })
    ).json().id,
  ).toBe(a.id);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: s,
        payload: { libraryId: item.id, fresh: true },
      })
    ).statusCode,
  ).toBe(403);
});

it('PDF生成期间教师推迟开放时也拒绝下载结果', async () => {
  const f = await showcaseCommunity();
  fixtures.push(f);
  const student = await f.login('student');
  const app = await createApp({
    dataDir: f.dir,
    pdfRenderer: {
      render: async () => {
        const item = f.store.get<any>('library', 'bank-mechanics');
        f.store.put(
          'library',
          item.id,
          { ...item, opensAt: new Date(Date.now() + 60000).toISOString() },
          item.teacherId,
        );
        return { bytes: Buffer.from('%PDF-1.7'), pages: 1 };
      },
      close: async () => {},
    },
  });
  try {
    const r = await app.inject({
      method: 'POST',
      url: '/api/library/bank-mechanics/pdf',
      headers: student,
      payload: {},
    });
    expect(r.statusCode).toBe(403);
  } finally {
    await app.close();
  }
});

it('未开放题干图片不能提前读取，教师与既有作答仍有权访问', async () => {
  const f = await showcaseCommunity();
  fixtures.push(f);
  const student = await f.login('student'),
    teacher = await f.login('teacher');
  const asset = f.store.list<any>('assets').find((a) => a.kind === 'question')!;
  const items = f.store.list<any>('library');
  const opensAt = new Date(Date.now() + 60000).toISOString();
  for (const item of items) f.store.put('library', item.id, { ...item, opensAt }, item.teacherId);
  expect(
    (await f.app.inject({ url: `/api/uploads/${asset.id}`, headers: student })).statusCode,
  ).toBe(404);
  expect(
    (await f.app.inject({ url: `/api/uploads/${asset.id}`, headers: teacher })).statusCode,
  ).toBe(200);
});
