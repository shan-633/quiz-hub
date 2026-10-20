import 'node:process';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
const { createApp } = await import('./app');
const app = await createApp({
  dataDir: process.env.DATA_DIR ?? './data',
  seed: process.env.DEMO_MODE !== 'false',
  logger: true,
});
await app.listen({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => app.close().then(() => process.exit(0)));
