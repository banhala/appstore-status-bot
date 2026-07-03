import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultState, loadState, saveState } from '../src/state/store.js';
import type { StoredState } from '../src/state/types.js';

const config = { gistId: 'gid', token: 'tok' };

const sample = (): StoredState => {
  const state = defaultState();
  state.apps['1'] = { version: '1.0.0', state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 0 };
  return state;
};

const gistWith = (content: string) => ({
  ok: true,
  json: async () => ({ files: { 'status.json': { content } } }),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('store (gist)', () => {
  it('config 없으면(로컬) 기본 상태', async () => {
    const state = await loadState();
    expect(state.window.open).toBe(false);
    expect(state.apps).toEqual({});
  });

  it('gist 내용을 파싱해 로드한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gistWith(JSON.stringify(sample()))));
    const state = await loadState(config);
    expect(state.apps['1']?.state).toBe('IN_REVIEW');
  });

  it('구 스키마/유효하지 않은 내용이면 기본값으로 폴백', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gistWith(JSON.stringify({ status: 'In review', appID: '1' }))));
    const state = await loadState(config);
    expect(state.apps).toEqual({});
  });

  it('파일 없으면 기본값', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: {} }) }));
    expect((await loadState(config)).apps).toEqual({});
  });

  it('GET 지속 실패(4xx/5xx)면 조용히 폴백하지 않고 throw한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', text: async () => 'x' }));
    await expect(loadState(config)).rejects.toThrow(/404/);
  });

  it('persist=true면 PATCH로 저장한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await saveState(sample(), config, true);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toContain('/gists/gid');
    expect(call[1].method).toBe('PATCH');
    expect(call[1].body).toContain('status.json');
    expect(call[1].body).toContain('IN_REVIEW');
  });

  it('persist=false면 저장하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await saveState(sample(), config, false);
    await saveState(sample(), undefined, true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
