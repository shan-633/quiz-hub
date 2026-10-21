import { afterEach, expect, it, vi } from 'vitest';
import { apiFile, setCsrf } from '../client/api';
afterEach(() => {
  vi.unstubAllGlobals();
  setCsrf('');
});
it('PDF请求携带会话和CSRF，按二进制读取并解析UTF8文件名及页数', async () => {
  const fetch = vi.fn(
    async (_url: RequestInfo | URL, _init: RequestInit) =>
      new Response('%PDF-1.7', {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "attachment; filename*=UTF-8''%E7%89%A9%E7%90%86.pdf",
          'x-pdf-page-count': '2',
          'x-pdf-question-count': '26',
        },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  setCsrf('token');
  const f = await apiFile('/library/p/pdf', { method: 'POST', body: '{}' });
  expect(f.filename).toBe('物理.pdf');
  expect(f.pages).toBe(2);
  expect(f.questionCount).toBe(26);
  expect(await f.blob.text()).toBe('%PDF-1.7');
  const init = fetch.mock.calls[0][1];
  expect(init.credentials).toBe('include');
  expect(new Headers(init.headers).get('x-csrf-token')).toBe('token');
});
it('服务端JSON错误保留状态与信息，不把错误当作PDF下载', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ message: '请先登录后继续' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
  await expect(apiFile('/library/p/pdf', { method: 'POST', body: '{}' })).rejects.toMatchObject({
    status: 401,
    message: '请先登录后继续',
  });
});
