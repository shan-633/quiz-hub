let csrfToken = '';
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const assetUrl = (id: string, thumbnail = false) =>
  `${apiBase}/api/uploads/${encodeURIComponent(id)}${thumbnail ? '?thumbnail=1' : ''}`;
export const bankImportFileUrl = (name: string) =>
  `${apiBase}/api/teacher/bank-import/files/${encodeURIComponent(name)}`;
export const setCsrf = (token: string) => {
  csrfToken = token;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('x-csrf-token', csrfToken);
  const response = await fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    ...init,
    headers,
  }).catch(() => {
    throw new TypeError('暂时无法连接服务器，请检查网络后重试');
  });
  const body = await response.json().catch(() => ({ message: '服务器响应格式不正确' }));
  if (!response.ok) throw new ApiError(body.message ?? '请求失败', response.status, body);
  return body;
}
export const json = (data: unknown) => JSON.stringify(data);
