import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { createAscClient } from '../src/asc/client.js';
import type { Env } from '../src/config/env.js';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const env = {
  ascKeyId: 'k',
  ascIssuerId: 'i',
  ascPrivateKey: pem,
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAscClient.get', () => {
  it('쿼리 직렬화 + Bearer 헤더로 호출하고 JSON을 반환한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      json: async () => ({ data: 'ok' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createAscClient(env);
    const res = await client.get('/v1/apps', { 'filter[bundleId]': 'com.x', include: ['a', 'b'] });

    expect(res).toEqual({ data: 'ok' });
    const call = fetchMock.mock.calls[0] as [URL, { headers: Record<string, string> }];
    const url = call[0].toString();
    expect(url).toContain('https://api.appstoreconnect.apple.com/v1/apps');
    expect(url).toContain('include=a%2Cb'); // 배열 → 콤마 결합 후 인코딩
    expect(call[1].headers.Authorization).toMatch(/^Bearer .+\..+\..+/);
  });

  it('non-2xx 응답이면 throw한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        headers: { get: () => null },
        text: async () => 'no auth',
      }),
    );
    const client = createAscClient(env);
    await expect(client.get('/v1/apps')).rejects.toThrow(/401/);
  });
});
