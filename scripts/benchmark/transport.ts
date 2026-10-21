import http from 'node:http';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
export function distribution(values: number[]) {
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
  };
}
export class Client {
  readonly agent = new http.Agent({ keepAlive: true, maxSockets: 128 });
  constructor(readonly base: string) {}
  request(path: string, headers: Record<string, string>, body?: unknown, method?: string) {
    const start = performance.now(),
      payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{
      status: number;
      ms: number;
      bytes: number;
      body: Buffer;
      finishedAt: number;
      progressVersion?: string;
    }>((resolve, reject) => {
      const req = http.request(
        this.base + path,
        {
          agent: this.agent,
          method: method ?? (payload ? 'PUT' : 'GET'),
          headers: {
            ...headers,
            ...(payload
              ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks);
            resolve({
              status: res.statusCode!,
              ms: performance.now() - start,
              bytes: body.length,
              body,
              finishedAt: performance.now(),
              progressVersion: res.headers['x-benchmark-progress-version'] as string | undefined,
            });
          });
          res.on('error', reject);
        },
      );
      req.setTimeout(30000, () => req.destroy(new Error('request timeout')));
      req.on('error', reject);
      req.end(payload);
    });
  }
  stream(
    path: string,
    headers: Record<string, string>,
    onFrame: (event: string, data: any, bytes: number, at: number) => void,
    options: { onBytes?: (bytes: number) => void; onDisconnect?: (error: Error) => void } = {},
  ) {
    return new Promise<() => void>((resolve, reject) => {
      let intentional = false,
        disconnected = false,
        connected = false;
      const disconnect = (error: Error) => {
        if (intentional || disconnected) return;
        disconnected = true;
        if (!connected) reject(error);
        else options.onDisconnect?.(error);
      };
      const req = http.get(this.base + path, { headers, agent: this.agent }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`SSE ${res.statusCode}`));
          return;
        }
        let buffer = '',
          first = true;
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          options.onBytes?.(Buffer.byteLength(chunk));
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end),
              bytes = Buffer.byteLength(buffer.slice(0, end + 2));
            buffer = buffer.slice(end + 2);
            const data = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!data) continue;
            const event =
              frame
                .split('\n')
                .find((l) => l.startsWith('event: '))
                ?.slice(7) ?? 'message';
            onFrame(event, JSON.parse(data.slice(6)), bytes, performance.now());
            if (first) {
              first = false;
              connected = true;
              resolve(() => {
                intentional = true;
                req.destroy();
              });
            }
          }
        });
        res.on('error', disconnect);
        res.on('end', () => disconnect(new Error('SSE ended unexpectedly')));
        res.on('close', () => disconnect(new Error('SSE connection closed')));
      });
      req.on('error', disconnect);
    });
  }
  close() {
    this.agent.destroy();
  }
}
export async function startServer(mode: 'baseline' | 'optimized', dir: string) {
  const child: ChildProcess = fork(new URL('./server.ts', import.meta.url), [mode, dir], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  let stderr = '';
  child.stderr?.on('data', (b) => {
    stderr += b;
  });
  let serial = 0;
  const pending = new Map<number, (value: any) => void>();
  const ready = new Promise<{ address: string; backfillMs: number }>((resolve, reject) => {
    child.on('message', (message: any) => {
      if (message.type === 'ready') resolve(message);
      else if (message.id) {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    });
    child.on('exit', (code) => {
      if (code) reject(new Error(`benchmark child exited ${code}: ${stderr}`));
    });
    child.on('error', reject);
  });
  const info = await ready;
  const rpc = (type: string) =>
    new Promise<any>((resolve) => {
      const id = ++serial;
      pending.set(id, resolve);
      child.send({ type, id });
    });
  return {
    ...info,
    rpc,
    async close() {
      if (child.exitCode !== null) return;
      const stopped = once(child, 'exit');
      child.send({ type: 'stop', id: 0 });
      await stopped;
    },
  };
}
