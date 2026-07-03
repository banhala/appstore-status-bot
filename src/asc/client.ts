import { createAscJwt } from './jwt.js';
import { fetchWithRetry } from '../util/fetchWithRetry.js';
import type { Env } from '../config/env.js';

const BASE_URL = 'https://api.appstoreconnect.apple.com';

export interface AscClient {
  get: <T>(path: string, query?: Record<string, string | string[]>) => Promise<T>;
}

/**
 * ASC REST 클라이언트. 토큰은 생성 시 1회 발급해 재사용
 * (한 실행은 수십 초라 19분 TTL 내에서 충분).
 */
export const createAscClient = (env: Env): AscClient => {
  const token = createAscJwt({
    keyId: env.ascKeyId,
    issuerId: env.ascIssuerId,
    privateKey: env.ascPrivateKey,
  });

  const get = async <T>(
    path: string,
    query?: Record<string, string | string[]>,
  ): Promise<T> => {
    const url = new URL(path.startsWith('http') ? path : `${BASE_URL}${path}`);
    if (query) {
      for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, Array.isArray(value) ? value.join(',') : value);
      }
    }

    const res = await fetchWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const rateLimit = res.headers.get('X-Rate-Limit');
    if (rateLimit) {
      console.log(`[ASC] 잔여 요청 한도: ${rateLimit}`);
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ASC ${res.status} ${res.statusText} (${path}): ${body}`);
    }

    return (await res.json()) as T;
  };

  return { get };
};
