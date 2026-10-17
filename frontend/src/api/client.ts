/**
 * 后端请求封装：
 * - access token 只保存在内存中；refresh token 在 httpOnly Cookie 里，由浏览器自动携带
 * - 请求返回 401 时自动刷新一次 token 再重试；并发请求共用同一次刷新
 */

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let accessToken: string | null = null;
let refreshing: Promise<RefreshResult> | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/** 刷新失败（登录彻底失效）时的回调，用于切回登录页 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') return body.detail;
    // 参数校验失败时 detail 是数组，取第一条
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return String(body.detail[0].msg).replace(/^Value error, /, '');
  } catch {
    // 响应不是 JSON
  }
  return `请求失败（${res.status}）`;
}

interface TokenOut {
  accessToken: string;
  expiresIn: number;
}

export type RefreshResult = 'ok' | 'expired' | 'offline';

/** 用 refresh Cookie 换新的 access token；并发调用共用同一次请求 */
export function refreshAccessToken(): Promise<RefreshResult> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then(async (res): Promise<RefreshResult> => {
      if (res.status === 401) {
        accessToken = null;
        return 'expired';
      }
      if (!res.ok) return 'offline';
      accessToken = ((await res.json()) as TokenOut).accessToken;
      return 'ok';
    })
    .catch((): RefreshResult => 'offline')
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 页面关闭时仍尽量把请求发出去 */
  keepalive?: boolean;
  /** 内部使用：已经重试过一次 */
  retried?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError(0, '网络连接失败，请检查网络或后端服务');
  }

  const isAuthPath = path.startsWith('/auth/login') || path.startsWith('/auth/register') || path.startsWith('/auth/refresh');
  if (res.status === 401 && !opts.retried && !isAuthPath) {
    const r = await refreshAccessToken();
    if (r === 'ok') return request<T>(path, { ...opts, retried: true });
    if (r === 'expired') onUnauthorized?.();
  }

  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
