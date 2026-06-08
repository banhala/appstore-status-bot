import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultState, loadState, saveState } from '../src/state/store.js';

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'asbot-')), 'status.json');

describe('store', () => {
  it('파일이 없으면 기본 상태를 반환한다', async () => {
    const state = await loadState(tempFile());
    expect(state.window.open).toBe(false);
    expect(state.apps).toEqual({});
  });

  it('saveState(commit:false) 후 loadState로 라운드트립된다', async () => {
    const path = tempFile();
    const state = defaultState();
    state.apps['1'] = { version: '1.0.0', state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 0 };

    await saveState(state, { commit: false, path });
    const loaded = await loadState(path);

    expect(loaded.apps['1']?.state).toBe('IN_REVIEW');
    rmSync(path, { force: true });
  });

  it('깨진 JSON이면 기본 상태로 폴백한다', async () => {
    const path = tempFile();
    writeFileSync(path, '{ not valid json');
    const state = await loadState(path);
    expect(state.apps).toEqual({});
    rmSync(path, { force: true });
  });
});
