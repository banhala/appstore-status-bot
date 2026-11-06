import { describe, it, expect } from 'vitest';
import { diffStatuses, rollbackFailed, trackedVersions } from '../src/diff/diff.js';
import type {
  AppSnapshot,
  AppStatus,
  Notice,
  PhasedState,
  StoredAppEntry,
  StoredState,
  StoredVersionEntry,
  VersionState,
} from '../src/state/types.js';

const app = (over: Partial<AppStatus> = {}): AppStatus => ({
  appId: '1',
  name: 'A',
  versionId: 'v1',
  version: '1.0.0',
  state: 'IN_REVIEW',
  iconUrl: '',
  phasedState: 'NOT_EXIST',
  phasedCurrentDay: 0,
  ...over,
});

const entry = (over: Partial<StoredVersionEntry> = {}): StoredVersionEntry => ({
  version: '1.0.0',
  state: 'IN_REVIEW',
  phasedState: 'NOT_EXIST',
  phasedCurrentDay: 0,
  ...over,
});

const snapshot = (...versions: AppStatus[]): AppSnapshot => ({ appId: '1', name: 'A', versions });

const stored = (apps: StoredState['apps'] = {}): StoredState => ({
  apps,
  updatedAt: 'z',
});

const appEntry = (...apps: AppStatus[]): StoredAppEntry => ({
  versions: Object.fromEntries(
    apps.map(item => [
      item.versionId,
      entry({
        version: item.version,
        state: item.state,
        phasedState: item.phasedState,
        phasedCurrentDay: item.phasedCurrentDay,
      }),
    ]),
  ),
});

const v =(version: string, state: VersionState, phasedState: PhasedState, day: number): AppStatus =>
  app({ versionId: `id-${version}`, version, state, phasedState, phasedCurrentDay: day });

const summarize = (notices: Notice[]): string[] =>
  notices.map(notice =>
    notice.kind === 'status'
      ? `${notice.app.version} ${notice.app.state}/${notice.app.phasedState}`
      : `${notice.app.version} superseded by ${notice.next.version}`,
  );

const storedVersions = (apps: StoredState['apps']): string[] => {
  const target = apps['1'];
  return target !== undefined && 'versions' in target
    ? Object.values(target.versions).map(item => item.version)
    : [];
};

const single = (prev: Partial<StoredVersionEntry>): StoredState =>
  stored({ '1': { versions: { v1: entry(prev) } } });

describe('diffStatuses', () => {
  it('최초 관측은 알림 없이 baseline만 시드한다', () => {
    const result = diffStatuses([snapshot(app())], stored({}));
    expect(result.notices).toHaveLength(0);
    expect(result.baselined).toEqual(['1']);
    expect(result.nextApps['1']).toEqual({ versions: { v1: entry({ state: 'IN_REVIEW' }) } });
  });

  it('심사 상태가 바뀌면 알림한다', () => {
    const result = diffStatuses([snapshot(app({ state: 'IN_REVIEW' }))], single({ state: 'WAITING_FOR_REVIEW' }));
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]?.app.state).toBe('IN_REVIEW');
    expect(result.baselined).toEqual([]);
  });

  it('직전과 동일하면 알림하지 않는다', () => {
    const result = diffStatuses([snapshot(app({ state: 'IN_REVIEW' }))], single({ state: 'IN_REVIEW' }));
    expect(result.notices).toHaveLength(0);
  });

  it('phasedState가 바뀌면 알림한다', () => {
    const result = diffStatuses(
      [snapshot(app({ state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 }))],
      single({ state: 'READY_FOR_SALE', phasedState: 'INACTIVE' }),
    );
    expect(result.notices).toHaveLength(1);
  });

  it('phasedDay 변화는 ACTIVE + READY_FOR_SALE일 때만 알림한다', () => {
    const base = { state: 'READY_FOR_SALE', phasedState: 'ACTIVE' } as const;
    const notify = diffStatuses(
      [snapshot(app({ ...base, phasedCurrentDay: 2 }))],
      single({ ...base, phasedCurrentDay: 1 }),
    );
    expect(notify.notices).toHaveLength(1);

    // ACTIVE가 아니면 day만 바뀌어도 알림하지 않음
    const noNotify = diffStatuses(
      [snapshot(app({ state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 2 }))],
      single({ state: 'IN_REVIEW', phasedState: 'NOT_EXIST', phasedCurrentDay: 1 }),
    );
    expect(noNotify.notices).toHaveLength(0);
  });

  it('조회되지 않은 기존 앱 엔트리는 보존한다', () => {
    const result = diffStatuses(
      [snapshot(app())],
      stored({ '2': { versions: { x: entry({ version: '9.9.9' }) } } }),
    );
    expect(result.nextApps['2']).toEqual({ versions: { x: entry({ version: '9.9.9' }) } });
    expect(result.nextApps['1']).toBeDefined();
  });

  it('phasedState ACTIVE라도 state가 READY_FOR_SALE가 아니면 day 변화는 무알림', () => {
    const result = diffStatuses(
      [snapshot(app({ state: 'PENDING_DEVELOPER_RELEASE', phasedState: 'ACTIVE', phasedCurrentDay: 2 }))],
      single({ state: 'PENDING_DEVELOPER_RELEASE', phasedState: 'ACTIVE', phasedCurrentDay: 1 }),
    );
    expect(result.notices).toHaveLength(0);
  });

  it('COMPLETE 이후 day만 바뀌면 알림하지 않는다', () => {
    const before = v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 1);
    const after = v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 2);
    const result = diffStatuses([snapshot(after)], stored({ '1': appEntry(before) }));
    expect(result.notices).toHaveLength(0);
  });
});

describe('trackedVersions', () => {
  it('가장 최근 READY_FOR_SALE 버전과 그 이후 버전만 추적한다', () => {
    const versions = [
      v('2.416.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
      v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.414.0', 'READY_FOR_SALE', 'COMPLETE', 1),
    ];
    expect(trackedVersions(versions).map(item => item.version)).toEqual(['2.416.0', '2.415.0']);
  });

  it('READY_FOR_SALE 버전이 없으면 최신 1개만 추적한다', () => {
    const versions = [
      v('1.1.0', 'IN_REVIEW', 'NOT_EXIST', 0),
      v('1.0.0', 'REJECTED', 'NOT_EXIST', 0),
    ];
    expect(trackedVersions(versions).map(item => item.version)).toEqual(['1.1.0']);
  });
});

describe('diffStatuses 버전 단위 추적', () => {
  it('한 폴링 간격 안에 이전 버전 100% 전환과 다음 버전 심사 요청이 함께 일어나도 둘 다 알린다', () => {
    const prev = [
      v('2.401.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 1),
    ];
    const current = snapshot(
      v('2.401.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 1),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual([
      '2.400.0 READY_FOR_SALE/COMPLETE',
      '2.401.0 WAITING_FOR_REVIEW/INACTIVE',
    ]);
  });

  it('새 버전이 처음 관측되면 그 시점 상태로 알린다', () => {
    const prev = [v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 1)];
    const current = snapshot(
      v('2.401.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 1),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual(['2.401.0 WAITING_FOR_REVIEW/INACTIVE']);
    expect(result.notices[0]?.prev).toBeUndefined();
  });

  it('다음 버전이 출시되면 완료된 이전 버전은 알림 없이 추적을 끝낸다', () => {
    const prev = [
      v('2.416.0', 'PENDING_DEVELOPER_RELEASE', 'INACTIVE', 0),
      v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 2),
    ];
    const current = snapshot(
      v('2.416.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 2),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual(['2.416.0 READY_FOR_SALE/ACTIVE']);
    expect(storedVersions(result.nextApps)).toEqual(['2.416.0']);
  });

  it('이전 버전이 100% 전환 없이 다음 버전에 밀려나면 경고하고 추적을 끝낸다', () => {
    const prev = [
      v('2.401.0', 'PENDING_DEVELOPER_RELEASE', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 2),
    ];
    const current = snapshot(
      v('2.401.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 3),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual([
      '2.400.0 superseded by 2.401.0',
      '2.401.0 READY_FOR_SALE/ACTIVE',
    ]);
    expect(storedVersions(result.nextApps)).toEqual(['2.401.0']);
  });

  it('밀려난 버전이 PAUSED여도 경고한다', () => {
    const prev = [v('2.400.0', 'READY_FOR_SALE', 'PAUSED', 2)];
    const current = snapshot(
      v('2.401.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.400.0', 'READY_FOR_SALE', 'PAUSED', 2),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual([
      '2.400.0 superseded by 2.401.0',
      '2.401.0 READY_FOR_SALE/ACTIVE',
    ]);
  });

  it('한 폴링 간격 안에 이전 버전 100% 전환과 다음 버전 출시가 함께 일어나면 완료로 알린다', () => {
    const prev = [
      v('2.401.0', 'PENDING_DEVELOPER_RELEASE', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 2),
    ];
    const current = snapshot(
      v('2.401.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 2),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual([
      '2.400.0 READY_FOR_SALE/COMPLETE',
      '2.401.0 READY_FOR_SALE/ACTIVE',
    ]);
  });

  it('다음 버전이 거부되면 이전 버전을 계속 추적한다', () => {
    const prev = [
      v('2.401.0', 'IN_REVIEW', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 2),
    ];
    const current = snapshot(
      v('2.401.0', 'REJECTED', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 3),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual([
      '2.400.0 READY_FOR_SALE/ACTIVE',
      '2.401.0 REJECTED/INACTIVE',
    ]);
    expect(storedVersions(result.nextApps)).toEqual(['2.401.0', '2.400.0']);
  });

  it('응답에서 사라진 추적 버전은 dropped로 보고하고 저장하지 않는다', () => {
    const prev = [
      v('2.401.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
      v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 7),
    ];
    const current = snapshot(v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 7));
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(result.notices).toHaveLength(0);
    expect(result.dropped).toEqual([{ name: 'A', version: '2.401.0' }]);
    expect(storedVersions(result.nextApps)).toEqual(['2.400.0']);
  });

  it('7일차 ACTIVE에서 다음 버전에 밀려나면 이미 100%이므로 경고하지 않는다', () => {
    const prev = [v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 7)];
    const current = snapshot(
      v('2.401.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      v('2.400.0', 'READY_FOR_SALE', 'ACTIVE', 7),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual(['2.401.0 READY_FOR_SALE/ACTIVE']);
  });

  it('출시 버전이 판매 중단되어 기준이 이전 버전으로 돌아가도 이전 버전을 새 버전으로 알리지 않는다', () => {
    const prev = [v('2.401.0', 'READY_FOR_SALE', 'COMPLETE', 7)];
    const current = snapshot(
      v('2.401.0', 'DEVELOPER_REMOVED_FROM_SALE', 'COMPLETE', 7),
      v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 7),
    );
    const result = diffStatuses([current], stored({ '1': appEntry(...prev) }));
    expect(summarize(result.notices)).toEqual(['2.401.0 DEVELOPER_REMOVED_FROM_SALE/COMPLETE']);
    expect(storedVersions(result.nextApps)).toEqual(['2.401.0', '2.400.0']);
  });

  it('저장된 버전이 비어 있으면 추적 버전을 모두 새 버전으로 알린다', () => {
    const current = snapshot(v('1.1.0', 'WAITING_FOR_REVIEW', 'NOT_EXIST', 0));
    const result = diffStatuses([current], stored({ '1': { versions: {} } }));
    expect(summarize(result.notices)).toEqual(['1.1.0 WAITING_FOR_REVIEW/NOT_EXIST']);
  });

  it('앱마다 독립적으로 판정한다', () => {
    const other: AppSnapshot = {
      appId: '2',
      name: 'B',
      versions: [app({ appId: '2', versionId: 'b1', version: '3.0.0', state: 'IN_REVIEW' })],
    };
    const result = diffStatuses(
      [snapshot(v('2.401.0', 'IN_REVIEW', 'INACTIVE', 0)), other],
      stored({ '1': appEntry(v('2.401.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0)) }),
    );
    expect(summarize(result.notices)).toEqual(['2.401.0 IN_REVIEW/INACTIVE']);
    expect(result.baselined).toEqual(['2']);
  });
});

describe('diffStatuses 연속 실행 (실행 로그 순서 재현)', () => {
  const replay = (initial: StoredState, runs: AppSnapshot[]): string[][] => {
    let state = initial;
    return runs.map(run => {
      const result = diffStatuses([run], state);
      state = stored(result.nextApps);
      return summarize(result.notices);
    });
  };

  it('2.416.0 생성과 심사 요청 뒤에 2.415.0을 100% 전환한 흐름에서 완료를 알린다 (2026-11-05)', () => {
    const initial = stored({ '1': appEntry(v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1)) });
    const runs = [
      snapshot(
        v('2.416.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
        v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      ),
      snapshot(
        v('2.416.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
        v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      ),
      snapshot(
        v('2.416.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
        v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 1),
      ),
      snapshot(
        v('2.416.0', 'READY_FOR_SALE', 'ACTIVE', 1),
        v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 2),
      ),
    ];
    expect(replay(initial, runs)).toEqual([
      ['2.416.0 PREPARE_FOR_SUBMISSION/INACTIVE'],
      ['2.416.0 WAITING_FOR_REVIEW/INACTIVE'],
      ['2.415.0 READY_FOR_SALE/COMPLETE'],
      ['2.416.0 READY_FOR_SALE/ACTIVE'],
    ]);
  });

  it('2.415.0 생성 뒤에 2.414.0을 100% 전환한 흐름에서 완료를 알린다 (2026-11-04)', () => {
    const initial = stored({ '1': appEntry(v('2.414.0', 'READY_FOR_SALE', 'ACTIVE', 1)) });
    const runs = [
      snapshot(
        v('2.415.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
        v('2.414.0', 'READY_FOR_SALE', 'ACTIVE', 1),
      ),
      snapshot(
        v('2.415.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
        v('2.414.0', 'READY_FOR_SALE', 'COMPLETE', 1),
      ),
    ];
    expect(replay(initial, runs)).toEqual([
      ['2.415.0 PREPARE_FOR_SUBMISSION/INACTIVE'],
      ['2.414.0 READY_FOR_SALE/COMPLETE'],
    ]);
  });
});

describe('diffStatuses 구 스키마 이관', () => {
  it('versionString이 일치하는 버전은 직전 값을 이어받아 변화를 알린다', () => {
    const legacy = entry({ version: '2.415.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 });
    const current = snapshot(v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 1));
    const result = diffStatuses([current], stored({ '1': legacy }));
    expect(summarize(result.notices)).toEqual(['2.415.0 READY_FOR_SALE/COMPLETE']);
    expect(result.baselined).toEqual([]);
    expect(result.nextApps['1']).toEqual(appEntry(v('2.415.0', 'READY_FOR_SALE', 'COMPLETE', 1)));
  });

  it('직전 값을 알 수 없는 추적 버전은 알림 없이 baseline으로 기록한다', () => {
    const legacy = entry({ version: '2.416.0', state: 'WAITING_FOR_REVIEW', phasedState: 'INACTIVE' });
    const current = snapshot(
      v('2.416.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
      v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
    );
    const result = diffStatuses([current], stored({ '1': legacy }));
    expect(result.notices).toHaveLength(0);
    expect(storedVersions(result.nextApps)).toEqual(['2.416.0', '2.415.0']);
  });

  it('구 스키마의 버전보다 나중에 만든 버전은 새 버전으로 알린다', () => {
    const legacy = entry({ version: '2.415.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 });
    const current = snapshot(
      v('2.416.0', 'PREPARE_FOR_SUBMISSION', 'INACTIVE', 0),
      v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
    );
    const result = diffStatuses([current], stored({ '1': legacy }));
    expect(summarize(result.notices)).toEqual(['2.416.0 PREPARE_FOR_SUBMISSION/INACTIVE']);
  });

  it('구 스키마 버전과 일치하는 버전이 없으면 모두 알림 없이 기록한다', () => {
    const legacy = entry({ version: '9.9.9' });
    const current = snapshot(
      v('2.416.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0),
      v('2.415.0', 'READY_FOR_SALE', 'ACTIVE', 1),
    );
    const result = diffStatuses([current], stored({ '1': legacy }));
    expect(result.notices).toHaveLength(0);
    expect(storedVersions(result.nextApps)).toEqual(['2.416.0', '2.415.0']);
  });
});

describe('rollbackFailed', () => {
  const v401 = v('2.401.0', 'WAITING_FOR_REVIEW', 'INACTIVE', 0);
  const v400 = v('2.400.0', 'READY_FOR_SALE', 'COMPLETE', 1);
  const next = (): StoredState['apps'] => ({ '1': appEntry(v401, v400) });

  it('전송에 실패한 버전은 직전 값으로 되돌린다', () => {
    const prev = entry({ version: '2.400.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 });
    const apps = rollbackFailed(next(), [{ kind: 'status', app: v400, prev }]);
    expect(apps['1']).toEqual({ versions: { ...appEntry(v401).versions, [v400.versionId]: prev } });
  });

  it('처음 관측한 버전의 전송이 실패하면 저장소에서 빼서 다음 실행에 다시 새 버전으로 본다', () => {
    const apps = rollbackFailed(next(), [{ kind: 'status', app: v401 }]);
    expect(storedVersions(apps)).toEqual(['2.400.0']);
    expect(summarize(diffStatuses([snapshot(v401, v400)], stored(apps)).notices)).toEqual([
      '2.401.0 WAITING_FOR_REVIEW/INACTIVE',
    ]);
  });

  it('추적을 끝낸 버전의 경고 전송이 실패하면 저장소에 되살린다', () => {
    const v399 = v('2.399.0', 'READY_FOR_SALE', 'ACTIVE', 2);
    const prev = entry({ version: '2.399.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 2 });
    const failed: Notice[] = [{ kind: 'superseded', app: v399, next: v400, prev }];
    expect(storedVersions(rollbackFailed(next(), failed))).toEqual(['2.401.0', '2.400.0', '2.399.0']);
  });

  it('실패가 없으면 그대로 둔다', () => {
    expect(rollbackFailed(next(), [])).toEqual(next());
  });
});
