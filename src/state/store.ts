import type { StoredState } from './types.js';

const GIST_API = 'https://api.github.com/gists';
const FILENAME = 'status.json';
const TIMEOUT_MS = 30_000;
const EPOCH = '1970-01-01T00:00:00Z';

export interface GistConfig {
  gistId: string;
  token: string;
}

export const defaultState = (): StoredState => ({
  window: { open: false, openedAt: EPOCH, hardExpiresAt: EPOCH, trigger: 'manual' },
  apps: {},
  updatedAt: EPOCH,
});

interface GistResponse {
  files?: Record<string, { content?: string } | null>;
}

const gistRequest = async (
  config: GistConfig,
  method: 'GET' | 'PATCH',
  body?: unknown,
): Promise<GistResponse> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GIST_API}/${config.gistId}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Gist ${method} ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    return (await res.json()) as GistResponse;
  } finally {
    clearTimeout(timer);
  }
};

// 우리 형식(window/apps)이 아니면 false → 기본값 폴백(첫 실행 재baseline)
const isStoredState = (value: unknown): value is StoredState => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.window === 'object' &&
    candidate.window !== null &&
    typeof candidate.apps === 'object' &&
    candidate.apps !== null
  );
};

/** gist에서 직전 상태 로드. config 없음(로컬)·파일 없음·구 스키마·실패 → 기본값 */
export const loadState = async (config?: GistConfig): Promise<StoredState> => {
  if (config === undefined) {
    return defaultState();
  }
  try {
    const gist = await gistRequest(config, 'GET');
    const content = gist.files?.[FILENAME]?.content;
    if (content === undefined || content === '') {
      return defaultState();
    }
    const parsed: unknown = JSON.parse(content);
    return isStoredState(parsed) ? parsed : defaultState();
  } catch (error) {
    console.warn(`[상태] gist 로드 실패 — 기본 상태로 시작: ${String(error)}`);
    return defaultState();
  }
};

/** gist에 상태 저장. config 없거나 persist=false(로컬/비-CI)면 쓰지 않음 */
export const saveState = async (
  state: StoredState,
  config: GistConfig | undefined,
  persist: boolean,
): Promise<void> => {
  if (config === undefined || !persist) {
    console.log('[상태] 저장 생략 (로컬/비-CI)');
    return;
  }
  await gistRequest(config, 'PATCH', {
    files: { [FILENAME]: { content: `${JSON.stringify(state, null, 2)}\n` } },
  });
  console.log('[상태] gist 갱신 완료');
};
