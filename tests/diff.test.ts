import { describe, it, expect } from 'vitest';
import { diffStatuses } from '../src/diff/diff.js';
import type { AppStatus, StoredAppEntry, StoredState } from '../src/state/types.js';

const app = (over: Partial<AppStatus> = {}): AppStatus => ({
  appId: '1',
  name: 'A',
  version: '1.0.0',
  state: 'IN_REVIEW',
  iconUrl: '',
  phasedState: 'NOT_EXIST',
  phasedCurrentDay: 0,
  ...over,
});

const entry = (over: Partial<StoredAppEntry> = {}): StoredAppEntry => ({
  version: '1.0.0',
  state: 'IN_REVIEW',
  phasedState: 'NOT_EXIST',
  phasedCurrentDay: 0,
  ...over,
});

const stored = (apps: StoredState['apps'] = {}): StoredState => ({
  window: { open: true, openedAt: 'x', hardExpiresAt: 'y', trigger: 'manual' },
  apps,
  updatedAt: 'z',
});

describe('diffStatuses', () => {
  it('최초 관측은 알림 없이 baseline만 시드한다', () => {
    const result = diffStatuses([app()], stored({}));
    expect(result.changes).toHaveLength(0);
    expect(result.baselined).toEqual(['1']);
    expect(result.nextApps['1']).toMatchObject({ state: 'IN_REVIEW' });
  });

  it('심사 상태가 바뀌면 알림한다', () => {
    const result = diffStatuses([app({ state: 'IN_REVIEW' })], stored({ '1': entry({ state: 'WAITING_FOR_REVIEW' }) }));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]?.state).toBe('IN_REVIEW');
    expect(result.baselined).toEqual([]);
  });

  it('직전과 동일하면 알림하지 않는다', () => {
    const result = diffStatuses([app({ state: 'IN_REVIEW' })], stored({ '1': entry({ state: 'IN_REVIEW' }) }));
    expect(result.changes).toHaveLength(0);
  });

  it('phasedState가 바뀌면 알림한다', () => {
    const result = diffStatuses(
      [app({ state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 })],
      stored({ '1': entry({ state: 'READY_FOR_SALE', phasedState: 'INACTIVE' }) }),
    );
    expect(result.changes).toHaveLength(1);
  });

  it('phasedDay 변화는 ACTIVE + READY_FOR_SALE일 때만 알림한다', () => {
    const base = { state: 'READY_FOR_SALE', phasedState: 'ACTIVE' } as const;
    const notify = diffStatuses(
      [app({ ...base, phasedCurrentDay: 2 })],
      stored({ '1': entry({ ...base, phasedCurrentDay: 1 }) }),
    );
    expect(notify.changes).toHaveLength(1);

    // ACTIVE가 아니면 day만 바뀌어도 알림하지 않음
    const noNotify = diffStatuses(
      [app({ state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 2 })],
      stored({ '1': entry({ state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 1 }) }),
    );
    expect(noNotify.changes).toHaveLength(0);
  });

  it('조회되지 않은 기존 앱 엔트리는 보존한다', () => {
    const result = diffStatuses([app({ appId: '1' })], stored({ '2': entry({ version: '9.9.9' }) }));
    expect(result.nextApps['2']).toMatchObject({ version: '9.9.9' });
    expect(result.nextApps['1']).toBeDefined();
  });

  it('phasedState ACTIVE라도 state가 READY_FOR_SALE가 아니면 day 변화는 무알림', () => {
    const result = diffStatuses(
      [app({ state: 'PENDING_DEVELOPER_RELEASE', phasedState: 'ACTIVE', phasedCurrentDay: 2 })],
      stored({ '1': entry({ state: 'PENDING_DEVELOPER_RELEASE', phasedState: 'ACTIVE', phasedCurrentDay: 1 }) }),
    );
    expect(result.changes).toHaveLength(0);
  });
});
