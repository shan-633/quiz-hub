import { afterEach, expect, it, vi } from 'vitest';
import { randomId, drawingFingerprint } from '../shared/browserIds';
afterEach(() => vi.unstubAllGlobals());
it('局域网HTTP缺少randomUUID和subtle时仍可创建唯一标识和稳定的绘图重试键', async () => {
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const a = randomId(),
    b = randomId();
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a).not.toBe(b);
  expect(await drawingFingerprint('same-strokes')).toBe(await drawingFingerprint('same-strokes'));
  expect(await drawingFingerprint('other-strokes')).not.toBe(
    await drawingFingerprint('same-strokes'),
  );
});
