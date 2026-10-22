import { existsSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { ProgressStore } from '../server/progressStore';
import { bootstrapAdmin, migrateIdentity } from '../server/identity';
if (existsSync('.env')) process.loadEnvFile('.env');
const store = new ProgressStore(process.env.DATA_DIR ?? './data');
const outputIndex = process.argv.indexOf('--output'),
  output =
    outputIndex >= 0
      ? resolve(process.argv[outputIndex + 1] ?? 'data/admin-initial-credentials.txt')
      : undefined;
let descriptor: number | undefined;
try {
  if (output) descriptor = openSync(output, 'wx', 0o600);
  migrateIdentity(store);
  const result = bootstrapAdmin(store, process.argv[2] ?? 'administrator');
  if (descriptor !== undefined) {
    writeFileSync(
      descriptor,
      `管理员登录：${process.env.APP_ORIGIN ?? 'http://localhost:3001'}/login?admin=1\n账号：${result.user.username}\n临时密码：${result.temporaryPassword}\n\n首次登录必须修改密码。请私下保管本文件，修改完成后可自行删除。\n`,
    );
    console.log('管理员已创建，临时凭据保存在指定本机文件。');
  } else
    process.stdout.write(
      JSON.stringify({
        username: result.user.username,
        temporaryPassword: result.temporaryPassword,
        mustChangePassword: true,
      }) + '\n',
    );
} finally {
  if (descriptor !== undefined) closeSync(descriptor);
  store.close();
}
