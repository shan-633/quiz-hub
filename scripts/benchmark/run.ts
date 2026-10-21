import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, platform, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeFixture, cloneFixture, type Fixture } from './fixtures';
import { Client, distribution, sleep, startServer } from './transport';
import type { StudentProgress } from '../../shared/progress';

const quick = process.argv.includes('--quick');
const rounds = quick ? 1 : 3,
  loadMs = quick ? 1000 : 5000,
  mixedMs = quick ? 4000 : 12000;
const root = mkdtempSync(join(tmpdir(), 'zhixu-progress-pressure-'));
const output = resolve('docs/performance/results');
mkdirSync(output, { recursive: true });
const results: any[] = [];
const manifest: any = {
  measuredAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  os: platform(),
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  ramGiB: totalmem() / 1073741824,
  quick,
  rounds,
  loadMs,
  mixedMs,
  queryConcurrency: 4,
  writeConcurrency: 8,
  mixedStudents: 30,
  teacherClients: 5,
  studentIntervalMs: 2000,
  pollIntervalMs: 3000,
  fixtureRoot: root,
  results,
};
const save = () =>
  writeFileSync(join(output, quick ? 'smoke.json' : 'raw.json'), JSON.stringify(manifest, null, 2));
async function until(check: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!check() && performance.now() < deadline) await sleep(10);
  assert.ok(check(), 'expected SSE event before timeout');
}
async function endpointParity(fixture: Fixture) {
  const rows: any[] = [];
  for (const mode of ['baseline', 'optimized'] as const) {
    const dir = join(root, `parity-${fixture.active}-${mode}`);
    cloneFixture(fixture, dir);
    const server = await startServer(mode, dir),
      client = new Client(server.address);
    try {
      const result = await client.request('/api/teacher/progress', fixture.teacher);
      assert.equal(result.status, 200);
      rows.push(
        JSON.parse(result.body.toString()).sort((a: any, b: any) => a.id.localeCompare(b.id)),
      );
      assert.equal((await client.request('/api/teacher/progress', fixture.headers[0])).status, 403);
      assert.equal((await client.request('/api/teacher/progress', {})).status, 401);
      if (mode === 'optimized') {
        assert.equal(
          (await client.request('/api/teacher/progress/events', fixture.headers[0])).status,
          403,
        );
        assert.equal((await client.request('/api/teacher/progress/events', {})).status, 401);
        const events: any[] = [];
        const stop = await client.stream(
          '/api/teacher/progress/events',
          fixture.teacher,
          (event, data) => events.push({ event, data }),
        );
        const r = await client.request(
          `/api/attempts/bench-attempt-0/answers/${fixture.writeQid}`,
          fixture.headers[0],
          {
            data: { ...fixture.answer, markdown: '校验更新', drawingPages: [] },
            expectedRevision: 1,
          },
        );
        assert.equal(r.status, 200);
        await until(() => events.some((e) => e.event === 'progress'));
        assert.equal(events[0].event, 'snapshot');
        assert.equal(events[1].data.type, 'upsert');
        assert.equal(events[1].data.row.updatedAt, r.progressVersion);
        assert.equal(events[1].data.row.answers, undefined);
        const submitted = await client.request(
          '/api/attempts/bench-attempt-0/submit',
          fixture.headers[0],
          undefined,
          'POST',
        );
        assert.equal(submitted.status, 200);
        await until(() => events.at(-1).data.type === 'remove');
        assert.deepEqual(events.at(-1).data, { type: 'remove', id: 'bench-attempt-0' });
        stop();
      }
    } finally {
      client.close();
      await server.close();
    }
  }
  assert.deepEqual(rows[0], rows[1]);
  console.log(`parity OK: ${fixture.active} active / ${fixture.history} history`);
}
async function load(
  fixture: Fixture,
  mode: 'baseline' | 'optimized',
  type: 'query' | 'write',
  round: number,
) {
  const dir = join(root, `${fixture.active}-${type}-${round}-${mode}`);
  cloneFixture(fixture, dir);
  const server = await startServer(mode, dir),
    client = new Client(server.address);
  try {
    for (let n = 0; n < 5; n++)
      assert.equal((await client.request('/api/teacher/progress', fixture.teacher)).status, 200);
    await server.rpc('reset');
    const latencies: number[] = [],
      statuses: Record<string, number> = {};
    let bytes = 0,
      issued = 0;
    const start = performance.now(),
      deadline = start + loadMs;
    await Promise.all(
      Array.from({ length: type === 'query' ? 4 : 8 }, async (_, n) => {
        let revision = 1;
        while (performance.now() < deadline) {
          issued++;
          try {
            const r =
              type === 'query'
                ? await client.request('/api/teacher/progress', fixture.teacher)
                : await client.request(
                    `/api/attempts/bench-attempt-${n}/answers/${fixture.writeQid}`,
                    fixture.headers[n],
                    {
                      data: {
                        ...fixture.answer,
                        markdown: `${fixture.answer.markdown}\n步骤${revision}`,
                      },
                      expectedRevision: revision,
                    },
                  );
            statuses[r.status] = (statuses[r.status] ?? 0) + 1;
            if (r.status === 200) {
              latencies.push(r.ms);
              bytes += r.bytes;
              if (type === 'write') revision++;
            }
          } catch {
            statuses.network = (statuses.network ?? 0) + 1;
          }
        }
      }),
    );
    const wallMs = performance.now() - start,
      metrics = await server.rpc('metrics');
    const result = {
      type,
      mode,
      round,
      active: fixture.active,
      history: fixture.history,
      issued,
      successful: latencies.length,
      errors: issued - latencies.length,
      statuses,
      wallMs,
      requestsPerSecond: (latencies.length / wallMs) * 1000,
      responseBodyBytes: bytes,
      ...distribution(latencies),
      ...metrics,
      backfillMs: server.backfillMs,
    };
    results.push(result);
    save();
    console.log(JSON.stringify(result));
    assert.equal(result.errors, 0, 'do not report successful-only throughput with hidden failures');
  } finally {
    client.close();
    await server.close();
  }
}
async function mixed(fixture: Fixture, mode: 'baseline' | 'optimized', round: number) {
  const dir = join(root, `${fixture.active}-mixed-${round}-${mode}`);
  cloneFixture(fixture, dir);
  const server = await startServer(mode, dir),
    client = new Client(server.address);
  const histories = Array.from(
    { length: 5 },
    () => new Map<string, { version: string; at: number }[]>(),
  );
  const observe = (teacher: number, row: StudentProgress, at: number) => {
    const prior = histories[teacher].get(row.id) ?? [];
    if (prior.at(-1)?.version !== row.updatedAt) prior.push({ version: row.updatedAt, at });
    histories[teacher].set(row.id, prior);
  };
  let active = true,
    teacherBodyBytes = 0,
    teacherRequests = 0,
    teacherErrors = 0;
  const closeStreams: (() => void)[] = [],
    pollers: Promise<void>[] = [];
  const updates: { id: string; version: string; start: number }[] = [],
    writeTimes: number[] = [],
    schedulingLags: number[] = [];
  let writeErrors = 0,
    writeBytes = 0;
  try {
    await Promise.all(
      Array.from({ length: 5 }, async (_, teacher) => {
        await sleep(teacher * 200);
        if (mode === 'optimized') {
          teacherRequests++;
          closeStreams.push(
            await client.stream(
              '/api/teacher/progress/events',
              fixture.teacher,
              (event, data, _bytes, at) => {
                if (event === 'snapshot') for (const row of data) observe(teacher, row, at);
                if (event === 'progress' && data.type === 'upsert') observe(teacher, data.row, at);
              },
              {
                onBytes: (bytes) => {
                  teacherBodyBytes += bytes;
                },
                onDisconnect: () => {
                  teacherErrors++;
                },
              },
            ),
          );
        } else {
          let ready: () => void = () => {};
          const first = new Promise<void>((resolve) => {
            ready = resolve;
          });
          pollers.push(
            (async () => {
              while (active) {
                teacherRequests++;
                try {
                  const r = await client.request('/api/teacher/progress', fixture.teacher);
                  if (r.status === 200) {
                    teacherBodyBytes += r.bytes;
                    for (const row of JSON.parse(r.body.toString()))
                      observe(teacher, row, r.finishedAt);
                  } else teacherErrors++;
                } catch {
                  teacherErrors++;
                }
                ready();
                await sleep(3000);
              }
            })(),
          );
          await first;
        }
      }),
    );
    const initialTeacherBytes = teacherBodyBytes;
    const initialTeacherRequests = teacherRequests;
    await server.rpc('reset');
    const start = performance.now();
    await Promise.all(
      Array.from({ length: 30 }, async (_, n) => {
        let revision = 1;
        for (let offset = (n * 2000) / 30; offset < mixedMs; offset += 2000) {
          await sleep(Math.max(0, start + offset - performance.now()));
          const issuedAt = performance.now();
          schedulingLags.push(Math.max(0, issuedAt - start - offset));
          try {
            const r = await client.request(
              `/api/attempts/bench-attempt-${n}/answers/${fixture.writeQid}`,
              fixture.headers[n],
              {
                data: {
                  ...fixture.answer,
                  markdown: `${fixture.answer.markdown}\n本次步骤${revision}`,
                },
                expectedRevision: revision,
              },
            );
            if (r.status === 200) {
              writeTimes.push(r.ms);
              writeBytes += r.bytes;
              revision++;
              updates.push({
                id: `bench-attempt-${n}`,
                version: r.progressVersion!,
                start: issuedAt,
              });
            } else writeErrors++;
          } catch {
            writeErrors++;
          }
        }
      }),
    );
    const writersWallMs = performance.now() - start;
    // Give the 3-second polling implementation time to observe the final save.
    const drainStart = performance.now();
    await sleep(4000);
    const allCovered = () =>
      updates.every((update) =>
        histories.every((teacher) =>
          (teacher.get(update.id) ?? []).some(
            (o) => o.at >= update.start && o.version >= update.version,
          ),
        ),
      );
    while (!allCovered() && performance.now() - drainStart < 30000) await sleep(500);
    const drainMs = performance.now() - drainStart;
    active = false;
    for (const close of closeStreams) close();
    await Promise.all(pollers);
    const metrics = await server.rpc('metrics');
    const visible: number[] = [];
    let exactObserved = 0,
      missing = 0;
    for (const update of updates)
      for (const teacher of histories) {
        const observations = teacher.get(update.id) ?? [];
        if (observations.some((o) => o.version === update.version)) exactObserved++;
        const observation = observations.find(
          (o) => o.at >= update.start && o.version >= update.version,
        );
        if (observation) visible.push(observation.at - update.start);
        else missing++;
      }
    const result = {
      type: 'mixed',
      mode,
      round,
      active: fixture.active,
      history: fixture.history,
      writeErrors,
      teacherErrors,
      writes: updates.length,
      expectedWrites: Math.ceil(mixedMs / 2000) * 30,
      writersWallMs,
      teacherRequests,
      initialTeacherRequests,
      steadyTeacherRequests: teacherRequests - initialTeacherRequests,
      teacherBodyBytes,
      initialTeacherBytes,
      steadyTeacherBodyBytes: teacherBodyBytes - initialTeacherBytes,
      writeResponseBodyBytes: writeBytes,
      writeLatency: distribution(writeTimes),
      visibilityLatency: distribution(visible),
      exactObserved,
      missing,
      drainMs,
      scheduleLagP95Ms: distribution(schedulingLags).p95Ms,
      ...metrics,
      backfillMs: server.backfillMs,
    };
    results.push(result);
    save();
    console.log(JSON.stringify(result));
    assert.equal(writeErrors + teacherErrors + missing, 0);
    assert.equal(updates.length, result.expectedWrites);
    await Promise.all(pollers);
  } finally {
    active = false;
    for (const close of closeStreams) close();
    client.close();
    await server.close();
  }
}

try {
  const fixtures = (
    quick
      ? [[30, 60]]
      : [
          [100, 900],
          [300, 2700],
        ]
  ).map(([active, history]) => makeFixture(join(root, `source-${active}`), active, history));
  manifest.fixtures = fixtures.map(({ active, history, attemptBytes, writeBodyBytes }) => ({
    active,
    history,
    attemptBytes,
    writeBodyBytes,
  }));
  save();
  for (const fixture of fixtures) {
    await endpointParity(fixture);
    for (let round = 1; round <= rounds; round++) {
      const modes =
        round % 2 ? (['baseline', 'optimized'] as const) : (['optimized', 'baseline'] as const);
      for (const mode of modes) await load(fixture, mode, 'query', round);
    }
  }
  const fixture = fixtures[0];
  for (let round = 1; round <= rounds; round++) {
    const modes =
      round % 2 ? (['baseline', 'optimized'] as const) : (['optimized', 'baseline'] as const);
    for (const mode of modes) {
      await load(fixture, mode, 'write', round);
      await mixed(fixture, mode, round);
    }
  }
  manifest.complete = true;
  save();
  console.log(`DONE: ${join(output, quick ? 'smoke.json' : 'raw.json')}`);
} catch (e) {
  manifest.complete = false;
  manifest.error = (e as Error).stack;
  save();
  throw e;
}
