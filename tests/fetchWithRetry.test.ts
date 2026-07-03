import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithRetry } from '../src/util/fetchWithRetry.js';

const resp = (status: number) => ({ ok: status < 400, status, statusText: 'x', json: async () => ({}) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchWithRetry', () => {
  it('2xx면 한 번만 호출하고 응답을 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x', {});
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('5xx면 백오프 후 재시도해 성공한다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(resp(503)).mockResolvedValueOnce(resp(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x', {}, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('네트워크 에러면 재시도한다', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(resp(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x', {}, { baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('4xx면 재시도하지 않고 응답을 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(404));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://x', {}, { baseDelayMs: 1 });
    expect(res.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts 소진 후에도 실패면 throw한다', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchWithRetry('https://x', {}, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(/down/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
