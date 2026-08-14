const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;
  readonly retryAfter: string | null;

  constructor(message: string, status: number, payload: unknown, retryAfter: string | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.retryAfter = retryAfter;
  }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text || null;
}

function readMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const candidate = (payload as { error?: unknown; message?: unknown }).error ??
      (payload as { error?: unknown; message?: unknown }).message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return fallback;
}

async function loadCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  if (csrfRequest) return csrfRequest;

  csrfRequest = fetch('/csrf-token', {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
    .then(async (response) => {
      const payload = await parseResponse(response);
      if (!response.ok) {
        throw new ApiError(
          readMessage(payload, 'Das CSRF-Token konnte nicht geladen werden.'),
          response.status,
          payload,
          response.headers.get('retry-after'),
        );
      }

      const tokenFromHeader = response.headers.get('x-csrf-token');
      const tokenFromBody = payload && typeof payload === 'object'
        ? (payload as { csrfToken?: unknown }).csrfToken
        : null;
      const token = typeof tokenFromHeader === 'string' && tokenFromHeader
        ? tokenFromHeader
        : typeof tokenFromBody === 'string'
          ? tokenFromBody
          : null;

      if (!token) throw new Error('Die CSRF-Antwort enthielt kein Token.');
      csrfToken = token;
      return token;
    })
    .finally(() => {
      csrfRequest = null;
    });

  return csrfRequest;
}

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token || null;
}

export async function apiRequest<T = unknown>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const method = String(init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (!SAFE_METHODS.has(method) && input !== '/setup-admin') {
    headers.set('X-CSRF-Token', await loadCsrfToken());
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });

  const responseToken = response.headers.get('x-csrf-token');
  if (responseToken) setCsrfToken(responseToken);

  const payload = await parseResponse(response);
  if (!response.ok) {
    if (response.status === 401) setCsrfToken(null);
    if (response.status === 403 && !SAFE_METHODS.has(method)) {
      const message = readMessage(payload, '');
      if (/CSRF-Token/iu.test(message)) setCsrfToken(null);
    }
    throw new ApiError(
      readMessage(payload, `Die Anfrage ist fehlgeschlagen (${response.status}).`),
      response.status,
      payload,
      response.headers.get('retry-after'),
    );
  }

  return payload as T;
}

export function apiGet<T = unknown>(input: string): Promise<T> {
  return apiRequest<T>(input);
}

export function apiJson<T = unknown>(
  input: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return apiRequest<T>(input, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
