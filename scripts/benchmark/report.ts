import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const dir = resolve('docs/performance');
const data = JSON.parse(readFileSync(resolve(dir, 'results/raw.json'), 'utf8'));
if (!data.complete || data.quick) throw new Error('Formal benchmark did not finish successfully');
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const get = (obj: any, path: string): number => path.split('.').reduce((a, p) => a[p], obj);
const format = (n: number, digits = 2) =>
  n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
function comparison(type: string, active: number, path: string, direction: 'lower' | 'higher') {
  const a = data.results
    .filter((r: any) => r.type === type && r.active === active && r.mode === 'baseline')
    .sort((x: any, y: any) => x.round - y.round);
  const b = data.results
    .filter((r: any) => r.type === type && r.active === active && r.mode === 'optimized')
    .sort((x: any, y: any) => x.round - y.round);
  if (a.length !== 3 || b.length !== 3) throw new Error('Expected three paired rounds');
  const ratios = a.map((r: any, i: number) =>
    direction === 'lower' ? get(r, path) / get(b[i], path) : get(b[i], path) / get(r, path),
  );
  return {
    type,
    active,
    path,
    baseline: median(a.map((r: any) => get(r, path))),
    optimized: median(b.map((r: any) => get(r, path))),
    ratio: median(ratios),
    minRatio: Math.min(...ratios),
    maxRatio: Math.max(...ratios),
    baselineRange: [
      Math.min(...a.map((r: any) => get(r, path))),
      Math.max(...a.map((r: any) => get(r, path))),
    ],
    optimizedRange: [
      Math.min(...b.map((r: any) => get(r, path))),
      Math.max(...b.map((r: any) => get(r, path))),
    ],
  };
}
const comparisons = [
  comparison('query', 100, 'requestsPerSecond', 'higher'),
  comparison('query', 300, 'requestsPerSecond', 'higher'),
  comparison('write', 100, 'requestsPerSecond', 'higher'),
  comparison('write', 100, 'p95Ms', 'lower'),
  comparison('mixed', 100, 'writeLatency.p95Ms', 'lower'),
  comparison('mixed', 100, 'visibilityLatency.p95Ms', 'lower'),
  comparison('mixed', 100, 'cpuMs', 'lower'),
  comparison('mixed', 100, 'teacherBodyBytes', 'lower'),
];
writeFileSync(resolve(dir, 'results/summary.json'), JSON.stringify({ comparisons }, null, 2));
const key = (type: string, active: number, path: string) =>
  comparisons.find((c) => c.type === type && c.active === active && c.path === path)!;
const row = (label: string, c: ReturnType<typeof comparison>, unit: string) =>
  `| ${label} | ${format(c.baseline)} ${unit} | ${format(c.optimized)} ${unit} | ${format(c.ratio)}×（${format(c.minRatio)}–${format(c.maxRatio)}×） |`;
const queries = data.results.filter((r: any) => r.type === 'query');
const mixed = data.results.filter((r: any) => r.type === 'mixed');
const errors = data.results.reduce(
  (s: number, r: any) =>
    s + (r.errors ?? 0) + (r.writeErrors ?? 0) + (r.teacherErrors ?? 0) + (r.missing ?? 0),
  0,
);
const rawRows = data.results
  .map((r: any) => {
    const p95 = r.type === 'mixed' ? r.visibilityLatency.p95Ms : r.p95Ms;
    return `| ${r.type} | ${r.active}/${r.history} | ${r.mode === 'baseline' ? 'A' : 'B'} | ${r.round} | ${r.successful ?? r.writes} | ${r.type === 'mixed' ? '—' : format(r.requestsPerSecond)} | ${format(p95)} | ${format(r.cpuMs, 0)} | ${format(r.peakRssMiB, 1)} | ${format(r.eventLoopP95Ms)} |`;
  })
  .join('\n');
const mixedRows = mixed
  .map(
    (r: any) =>
      `| ${r.mode === 'baseline' ? 'A' : 'B'} | ${r.round} | ${format(r.writersWallMs)} | ${format(r.scheduleLagP95Ms)} | ${format(r.drainMs)} | ${format(r.serverWallMs)} | ${r.exactObserved}/900 | ${r.initialTeacherRequests} / ${r.steadyTeacherRequests} |`,
  )
  .join('\n');
const sources = [
  'app.ts',
  'summary-store.ts',
  'fixtures.ts',
  'run.ts',
  'server.ts',
  'transport.ts',
].map((name) => ({
  name,
  sha256: createHash('sha256')
    .update(readFileSync(resolve('scripts/benchmark', name)))
    .digest('hex'),
}));
writeFileSync(resolve(dir, 'results/sources.json'), JSON.stringify(sources, null, 2));
const querySamples = (active: number, mode: string) =>
  queries
    .filter((r: any) => r.active === active && r.mode === mode)
    .map((r: any) => r.samples)
    .join(' / ');
const backfill = (active: number) =>
  median(
    data.results
      .filter((r: any) => r.active === active && r.mode === 'optimized')
      .map((r: any) => r.backfillMs),
  );
const text = `# 实时作答进度：两种方案实际压测

测试时间：${new Date(data.measuredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）。基线产品提交：\`${data.commit.slice(0, 7)}\`。

A：当前完整记录扫描＋教师3秒轮询。B：隔离实验原型，SQLite独立进度摘要＋SSE。B未接入正在使用的3001应用；没有改动真实题库、作答或数据库。摘要维护、事务及广播的成本全部纳入B。两边仍写整份作答JSON，本实验不包含逐题存储、笔迹增量、合并推送或分页的收益。

## 实测结果

下表A/B各列为三轮中位数；倍数为三组配对倍数的中位数，括号为最小至最大值，不能直接用两列中位数反推同一倍数。吞吐量越高越好，延迟/CPU/流量越低越好；小于1×表示B退步。

| 指标 | A 当前方案 | B 摘要＋SSE | B相对A的倍数及范围 |
| --- | ---: | ---: | ---: |
${row('1,000份记录：进度查询吞吐量', key('query', 100, 'requestsPerSecond'), '请求/秒')}
${row('3,000份记录：进度查询吞吐量', key('query', 300, 'requestsPerSecond'), '请求/秒')}
${row('无教师查询：学生保存吞吐量', key('write', 100, 'requestsPerSecond'), '请求/秒')}
${row('无教师查询：学生保存P95', key('write', 100, 'p95Ms'), 'ms')}
${row('混合负载：学生保存P95', key('mixed', 100, 'writeLatency.p95Ms'), 'ms')}
${row('混合负载：教师收到进度P95', key('mixed', 100, 'visibilityLatency.p95Ms'), 'ms')}
${row('混合负载：服务端CPU时间', key('mixed', 100, 'cpuMs'), 'ms')}
${row('混合负载：教师接收正文', key('mixed', 100, 'teacherBodyBytes'), 'bytes')}

总错误、异常断流及最终状态未覆盖计数：**${errors}**。每轮混合负载各有180次学生保存、5个教师客户端，900份观察高度相关，不是900个独立样本。轮询允许跳过中间版本，可见延迟指客户端首次收到“本次更新或更新版本”，另外记录exactObserved。没有把漏掉的中间版本伪装成逐条完整接收。

混合负载的**计划发送窗口为12秒**，每个学生串行等待响应，服务较慢时会延后补发，所以它是有单学生背压的负载，并非无限排队的固定到达率测试。上表保存/可见延迟从实际发起HTTP计算，不包括发起前的延期。实际完成时间、调度延期与统计窗口如下；不能据此直接宣称稳定承载30人每两秒保存。

| 方案 | 轮次 | 完成全部保存 ms | 发起延期P95 ms | 等最终可见 ms | 统计窗 ms | 精确观察版本数 | 初始/后续教师请求数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${mixedRows}

查询收益主要来自避免重复解析历史完整答卷；SSE主要减少3秒等待与查询竞争。不能把表中查询倍数称为整站提速倍数。纯保存若变慢，原因是新增摘要写入、计算和事务开销；混合负载则可能因消除全量查询阻塞而改善。最终结果应结合这些不同方向的指标判断。

## 条件与限制

- 本机：${data.cpu}，${data.logicalCpus}逻辑处理器，${format(data.ramGiB, 1)} GiB内存，${data.os}，Node ${data.node}。
- 真实本机HTTP＋keep-alive；客户端和服务端分进程，每轮独立SQLite克隆和服务器子进程，WAL开启。双方共享生产认证、CSRF、保存校验、revision及收卷路由；不包含登录耗时。双方压测服务关闭IP限流和请求日志，线上配置未变，结果不等同默认限流下的外部容量。
- 真实2022北京卷26题快照＋合成答案，单份约${format(data.fixtures[0].attemptBytes / 1024, 1)} KiB，手写含500个点；保存请求约${format(data.fixtures[0].writeBodyBytes / 1024, 1)} KiB。1,000份为100活跃/900历史；3,000份为300活跃/2,700历史。均非真实学生数据。图片只存引用，不测图片上传、解码或PDF。
- 每模式3轮，A/B、B/A、A/B顺序。查询并发4，保存并发8；每轮预热5次完整进度读取，随后至少发起5秒负载，等待在途请求完成。**慢基线使5秒内请求数偏少**：1,000份A三轮样本为${querySamples(100, 'baseline')}；3,000份A为${querySamples(300, 'baseline')}。其P95/P99接近最大值，只作短时描述，不作为稳定尾延迟容量承诺；倍数也应结合范围解读。
- 混合负载使用1,000份数据：30名学生计划每2秒保存一次，错开相位，计划发送窗口12秒；5名教师同时查看，A按响应完成后再等3秒，B保持5条SSE。学生每人单个在途请求，慢时延后补发并记录调度迟延。结束至少等待4秒，最长30秒等最终状态，停止新轮询后等待在途请求完毕再固定结果。CPU、正文流量覆盖负载及收尾，serverWallMs记录实际窗口。
- 教师正文流量包含初始完整快照、全部事件和心跳，HTTP头与TCP开销未计；initialTeacherBytes、initialTeacherRequests另列。SSE意外关闭计错误，主动收尾不计错误。峰值RSS为50ms采样近似，包含预热后残留堆，不能等同每请求分配量。
- 延迟从HTTP保存发起到教师客户端接收正文，**不包含学生700ms/2秒保存防抖、浏览器渲染或公网延迟**。实验响应头使用同一次提交的attempt.updatedAt匹配，避免答案和作答记录分开取时间的毫秒差；要求观察发生在保存发起之后。
- B的一次性摘要回填未计入稳态：1,000份中位数${format(backfill(100))}ms，3,000份${format(backfill(300))}ms；RSS会受启动回填和GC影响。SSE原型尚未做公网代理、会话过期长连接、多进程广播或故障恢复验收。
- 这是短时、单机、单服务进程测试；只证明所列条件，不能推断公网并发人数、长时间运行或其他硬件倍率。

## 每轮原始指标

混合行的成功数为保存次数，P95为教师可见延迟；查询/保存行的成功数与P95均针对对应HTTP接口。

| 场景 | 活跃/历史 | 方案 | 轮次 | 成功数 | 请求/秒 | P95 ms | CPU ms | 峰值RSS MiB | 事件循环P95 ms |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rawRows}

原始机器记录：[raw.json](results/raw.json)；配对统计：[summary.json](results/summary.json)；最终复现源码校验：[sources.json](results/sources.json)。协议见[protocol.md](protocol.md)。${data.temporaryDatabasesRetained === false ? '本次临时数据库已清理，保留全部测量记录及可重现脚本。' : '隔离数据库位于系统临时目录，路径见raw.json。'}3001服务全程保持原版本。

## 重现

在项目根目录运行，先结束其他压测/构建，避免争抢CPU：

\`\`\`powershell
npm test -- tests/progressBenchmark.test.ts
node --import tsx scripts/benchmark/run.ts --quick
node --import tsx scripts/benchmark/run.ts
node --import tsx scripts/benchmark/report.ts
\`\`\`

压测脚本完全位于scripts/benchmark，产品服务器不导入这些文件。复跑会覆盖results中的报告原始文件，临时SQLite克隆会保留以便排查，可能占用数GB磁盘。不要在压测时同时执行完整测试和构建。
`;
writeFileSync(resolve(dir, 'report.md'), text);
console.log(JSON.stringify(comparisons, null, 2));
