import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { StoredState } from './types.js';

const execFileAsync = promisify(execFile);

export const STATE_PATH = 'state/status.json';
const EPOCH = '1970-01-01T00:00:00Z';

export const defaultState = (): StoredState => ({
  window: { open: false, openedAt: EPOCH, hardExpiresAt: EPOCH, trigger: 'manual' },
  apps: {},
  updatedAt: EPOCH,
});

export const loadState = async (path: string = STATE_PATH): Promise<StoredState> => {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as StoredState;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      console.warn(`[상태] ${path} 읽기 실패 — 기본 상태로 시작: ${String(error)}`);
    }
    return defaultState();
  }
};

const git = (args: string[]): Promise<{ stdout: string; stderr: string }> =>
  execFileAsync('git', args);

// 변화가 있을 때만 commit + push. 동시 push 충돌 시 1회 rebase 후 재시도.
const commitAndPush = async (path: string): Promise<void> => {
  await git(['add', path]);
  const { stdout } = await git(['status', '--porcelain', path]);
  if (stdout.trim() === '') {
    console.log('[상태] 직전과 동일 — 커밋 생략');
    return;
  }
  await git(['commit', '-m', '상태 자동 갱신 [skip ci]']);
  try {
    await git(['push']);
  } catch {
    console.warn('[상태] push 충돌 — rebase 후 재시도');
    await git(['pull', '--rebase']);
    await git(['push']);
  }
  console.log('[상태] status.json 갱신본 push 완료');
};

export const saveState = async (
  state: StoredState,
  options: { commit?: boolean; path?: string } = {},
): Promise<void> => {
  const path = options.path ?? STATE_PATH;
  const commit = options.commit ?? true;

  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  if (commit) {
    await commitAndPush(path);
  }
};
