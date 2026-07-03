const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 45_000; // per-attempt (30s → 45s: 느리지만 살아있는 서버에 여유)
const DEFAULT_MAX_ATTEMPTS = 4; // 최초 1 + 재시도 3
const DEFAULT_BASE_DELAY_MS = 1_000; // 지수 백오프 기준 → 1s, 2s, 4s

export interface RetryOptions {
  /** per-attempt 타임아웃 (기본 45s) */
  timeoutMs?: number;
  /** 최대 시도 횟수 — 최초 포함 (기본 4 = 재시도 3회) */
  maxAttempts?: number;
  /** 지수 백오프 기준 지연 (기본 1000ms → 1s, 2s, 4s) */
  baseDelayMs?: number;
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 타임아웃 + 지수 백오프 재시도를 입힌 fetch
 * - 재시도 대상: 타임아웃(AbortError)·네트워크 에러·HTTP 429/5xx
 * - 그 외 응답(2xx/4xx 등)은 즉시 반환 — 호출자가 판단
 * - ⚠️ Slack chat.postMessage처럼 멱등이 아닌 요청엔 쓰지 말 것 (중복 발송 위험)
 */
export const fetchWithRetry = async (
  url: string | URL,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> => {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
  } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      // 재시도 가능한 상태코드면 마지막 시도가 아닌 한 백오프 후 재시도
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
        await delay(baseDelayMs * 2 ** (attempt - 1));
        continue;
      }
      return res;
    } catch (error) {
      // 네트워크 에러·타임아웃(AbortError) — 마지막 시도면 전파
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }
      await delay(baseDelayMs * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
};
