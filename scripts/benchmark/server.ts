import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createBenchmarkApp } from './app';
const [mode, dir] = process.argv.slice(2);
if (mode !== 'baseline' && mode !== 'optimized') throw new Error('mode');
const { app, backfillMs } = await createBenchmarkApp(dir, mode);
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let cpu = process.cpuUsage(),
  started = performance.now(),
  peakRss = process.memoryUsage().rss;
const sample = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 50);
process.on('message', async (m: { type: string; id: number }) => {
  if (m.type === 'reset') {
    delay.reset();
    cpu = process.cpuUsage();
    started = performance.now();
    peakRss = process.memoryUsage().rss;
    process.send?.({ id: m.id, ok: true });
  } else if (m.type === 'metrics') {
    const usage = process.cpuUsage(cpu),
      ms = performance.now() - started;
    process.send?.({
      id: m.id,
      serverWallMs: ms,
      cpuMs: (usage.user + usage.system) / 1000,
      cpuPercent: ((usage.user + usage.system) / 1000 / ms) * 100,
      rssMiB: process.memoryUsage().rss / 1048576,
      peakRssMiB: peakRss / 1048576,
      eventLoopP95Ms: delay.percentile(95) / 1e6,
    });
  } else if (m.type === 'stop') {
    clearInterval(sample);
    delay.disable();
    await app.close();
    process.exit(0);
  }
});
process.send?.({ type: 'ready', address, backfillMs });
