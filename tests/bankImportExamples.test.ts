import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { bankPackageSchema, parseBankPackage } from '../shared/bankImport';
import { prepareBankImport } from '../server/import/bankImport';
it('协议下载文档、机器Schema和运行模式同步，三份示例全部通过实际解码校验', async () => {
  expect(readFileSync('content-assets/import/protocol-v1.md', 'utf8')).toBe(
    readFileSync('docs/import-protocol-v1.md', 'utf8'),
  );
  expect(
    JSON.parse(readFileSync('content-assets/import/question-bank-v1.schema.json', 'utf8')),
  ).toEqual(z.toJSONSchema(bankPackageSchema, { target: 'draft-2020-12', io: 'input' }));
  for (const name of ['minimal', 'six-types', 'beijing-2022']) {
    const text = readFileSync(`content-assets/import/${name}.zqb.json`, 'utf8');
    const prepared = await prepareBankImport(text);
    expect(prepared.report.errors, name).toEqual([]);
    expect(prepared.report.valid, name).toBe(true);
    const document = parseBankPackage(text).document!;
    if (name === 'six-types') expect(new Set(document.questions.map((q) => q.type)).size).toBe(6);
    if (name === 'beijing-2022') {
      expect(document.questions).toHaveLength(26);
      expect(prepared.report.summary?.totalScore).toBe(70);
      expect(prepared.assets).toHaveLength(24);
      for (const asset of prepared.assets)
        expect(asset.bytes).toEqual(
          readFileSync(
            'content-assets/beijing-2022/' +
              document.assets.find((a) => a.id === asset.externalId)!.name,
          ),
        );
    }
  }
});
