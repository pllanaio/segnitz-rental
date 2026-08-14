import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiJson, apiRequest, setCsrfToken } from './client';

describe('API client', () => {
  beforeEach(() => {
    setCsrfToken(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lädt für schreibende Requests einmalig ein CSRF-Token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-test' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await apiJson('/cart/items', 'POST', { productId: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const mutation = fetchMock.mock.calls[1];
    expect(mutation[0]).toBe('/cart/items');
    expect(new Headers(mutation[1]?.headers).get('X-CSRF-Token')).toBe('csrf-test');
    expect(mutation[1]?.credentials).toBe('same-origin');
  });

  it('wandelt API-Fehler in typisierte ApiError-Objekte um', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Nicht gefunden' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    }));

    const request = expect(apiRequest('/missing')).rejects;
    await request.toBeInstanceOf(ApiError);
    await request.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Nicht gefunden',
    });
  });

  it('behält das Token bei fachlichen 403-Antworten', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-stable' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Keine Berechtigung.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await expect(apiJson('/protected', 'POST', {})).rejects.toMatchObject({ status: 403 });
    await apiJson('/allowed', 'POST', {});

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get('X-CSRF-Token'))
      .toBe('csrf-stable');
  });

  it('verwirft das Token nach einem echten CSRF-Fehler', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-old' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Ungültiges oder fehlendes CSRF-Token.' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await expect(apiJson('/expired', 'POST', {})).rejects.toMatchObject({ status: 403 });
    await apiJson('/retried', 'POST', {});

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[2][0]).toBe('/csrf-token');
    expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('X-CSRF-Token'))
      .toBe('csrf-new');
  });

  it('verwirft das Token nach einer abgelaufenen Sitzung', async () => {
    setCsrfToken('session-bound-token');
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Sitzung abgelaufen.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'fresh-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));

    await expect(apiJson('/protected', 'POST', {})).rejects.toMatchObject({ status: 401 });
    await apiJson('/protected', 'POST', {});

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/csrf-token', expect.any(Object));
    const thirdRequest = fetchMock.mock.calls[2]?.[1];
    expect(new Headers(thirdRequest?.headers).get('X-CSRF-Token')).toBe('fresh-token');
  });
});
