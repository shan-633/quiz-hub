let csrfToken = '';
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const progressEventsUrl = `${apiBase}/api/teacher/progress/events`;
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
async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('x-csrf-token', csrfToken);
  return fetch(`${apiBase}/api${path}`, {
    credentials: 'include',
    ...init,
    headers,
  }).catch((error) => {
    if (error?.name === 'AbortError') throw error;
    throw new TypeError('暂时无法连接服务器，请检查网络后重试');
  });
}
export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  const body = await response.json().catch(() => ({ message: '服务器响应格式不正确' }));
  if (!response.ok) throw new ApiError(body.message ?? '请求失败', response.status, body);
  return body;
}
export interface DownloadFile {
  blob: Blob;
  filename: string;
  pages: number | null;
  questionCount: number | null;
}
export async function apiFile(path: string, init: RequestInit = {}): Promise<DownloadFile> {
  const response = await request(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: 'PDF生成失败，请稍后重试' }));
    throw new ApiError(body.message ?? 'PDF生成失败', response.status, body);
  }
  if (!response.headers.get('content-type')?.includes('application/pdf'))
    throw new Error('服务器未返回PDF文件，请重试');
  const disposition = response.headers.get('content-disposition') ?? '',
    encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = '物理练习.pdf';
  try {
    if (encoded) filename = decodeURIComponent(encoded);
  } catch {}
  const count = (name: string) => {
    const n = Number(response.headers.get(name));
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  return {
    blob: await response.blob(),
    filename,
    pages: count('x-pdf-page-count'),
    questionCount: count('x-pdf-question-count'),
  };
}
export const json = (data: unknown) => JSON.stringify(data);
