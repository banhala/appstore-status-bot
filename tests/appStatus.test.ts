import { describe, it, expect, vi } from 'vitest';
import { fetchAppSnapshots } from '../src/asc/appStatus.js';
import type { AscClient } from '../src/asc/client.js';
import type { AppStatus } from '../src/state/types.js';

const client = (apps: unknown, versions: unknown): AscClient => ({
  get: (async (path: string) => {
    if (path === '/v1/apps') return apps;
    if (path.includes('/appStoreVersions')) return versions;
    throw new Error(`unexpected path: ${path}`);
  }) as AscClient['get'],
});

const appsRes = { data: [{ type: 'apps', id: 'APPID', attributes: { name: '에이블리' } }] };

const firstVersion = async (target: AscClient, bundleIds: string[]): Promise<AppStatus | undefined> =>
  (await fetchAppSnapshots(target, bundleIds))[0]?.versions[0];

describe('fetchAppSnapshots', () => {
  it('appStoreState·phased·아이콘을 정규화한다', async () => {
    const versions = {
      data: [
        {
          type: 'appStoreVersions',
          id: 'v1',
          attributes: { versionString: '2.0.0', createdDate: '2026-06-01T00:00:00Z', appStoreState: 'READY_FOR_SALE' },
          relationships: {
            appStoreVersionPhasedRelease: { data: { type: 'appStoreVersionPhasedReleases', id: 'p1' } },
            build: { data: { type: 'builds', id: 'b1' } },
          },
        },
      ],
      included: [
        { type: 'appStoreVersionPhasedReleases', id: 'p1', attributes: { phasedReleaseState: 'ACTIVE', currentDayNumber: 3 } },
        { type: 'builds', id: 'b1', attributes: { iconAssetToken: { templateUrl: 'https://x/{w}x{h}.{f}' } } },
      ],
    };
    const status = await firstVersion(client(appsRes, versions), ['com.x']);
    expect(status).toEqual({
      appId: 'APPID',
      name: '에이블리',
      versionId: 'v1',
      version: '2.0.0',
      state: 'READY_FOR_SALE',
      iconUrl: 'https://x/340x340.png',
      phasedState: 'ACTIVE',
      phasedCurrentDay: 3,
    });
  });

  it('appVersionState 신규 표기를 내부 표기로 흡수한다', async () => {
    const versions = {
      data: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '2.0.0', createdDate: '2026-06-01T00:00:00Z', appVersionState: 'READY_FOR_DISTRIBUTION' }, relationships: {} }],
    };
    const status = await firstVersion(client(appsRes, versions), ['com.x']);
    expect(status?.state).toBe('READY_FOR_SALE');
    expect(status?.phasedState).toBe('NOT_EXIST');
  });

  it('전체 버전을 최신 생성 순으로 반환한다', async () => {
    const versions = {
      data: [
        { type: 'appStoreVersions', id: 'old', attributes: { versionString: '1.0.0', createdDate: '2026-01-01T00:00:00Z', appStoreState: 'READY_FOR_SALE' }, relationships: {} },
        { type: 'appStoreVersions', id: 'new', attributes: { versionString: '2.0.0', createdDate: '2026-06-01T00:00:00Z', appStoreState: 'IN_REVIEW' }, relationships: {} },
      ],
    };
    const [snapshot] = await fetchAppSnapshots(client(appsRes, versions), ['com.x']);
    expect(snapshot?.versions.map(item => [item.versionId, item.version, item.state])).toEqual([
      ['new', '2.0.0', 'IN_REVIEW'],
      ['old', '1.0.0', 'READY_FOR_SALE'],
    ]);
  });

  it('버전마다 자기 phased release를 연결한다', async () => {
    const versions = {
      data: [
        {
          type: 'appStoreVersions',
          id: 'new',
          attributes: { versionString: '2.416.0', createdDate: '2026-11-04T00:00:00Z', appStoreState: 'WAITING_FOR_REVIEW' },
          relationships: { appStoreVersionPhasedRelease: { data: { type: 'appStoreVersionPhasedReleases', id: 'p-new' } } },
        },
        {
          type: 'appStoreVersions',
          id: 'old',
          attributes: { versionString: '2.415.0', createdDate: '2026-11-03T00:00:00Z', appStoreState: 'READY_FOR_SALE' },
          relationships: { appStoreVersionPhasedRelease: { data: { type: 'appStoreVersionPhasedReleases', id: 'p-old' } } },
        },
      ],
      included: [
        { type: 'appStoreVersionPhasedReleases', id: 'p-new', attributes: { phasedReleaseState: 'INACTIVE', currentDayNumber: 0 } },
        { type: 'appStoreVersionPhasedReleases', id: 'p-old', attributes: { phasedReleaseState: 'ACTIVE', currentDayNumber: 1 } },
      ],
    };
    const [snapshot] = await fetchAppSnapshots(client(appsRes, versions), ['com.x']);
    expect(snapshot?.versions.map(item => [item.version, item.phasedState, item.phasedCurrentDay])).toEqual([
      ['2.416.0', 'INACTIVE', 0],
      ['2.415.0', 'ACTIVE', 1],
    ]);
  });

  it('앱을 못 찾으면 결과에서 제외한다', async () => {
    const result = await fetchAppSnapshots(client({ data: [] }, { data: [] }), ['com.x']);
    expect(result).toEqual([]);
  });

  it('알 수 없는 상태값은 경고하고 제외한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const versions = {
      data: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '2.0.0', appStoreState: 'FUTURE_STATE' }, relationships: {} }],
    };
    const result = await fetchAppSnapshots(client(appsRes, versions), ['com.x']);
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FUTURE_STATE'));
    warn.mockRestore();
  });

  it('두 필드가 모두 있으면 appStoreState가 우선한다', async () => {
    const versions = {
      data: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '2.0.0', appStoreState: 'IN_REVIEW', appVersionState: 'READY_FOR_DISTRIBUTION' }, relationships: {} }],
    };
    const status = await firstVersion(client(appsRes, versions), ['com.x']);
    expect(status?.state).toBe('IN_REVIEW');
  });

  it('앱은 있지만 버전이 하나도 없으면 제외한다', async () => {
    const result = await fetchAppSnapshots(client(appsRes, { data: [] }), ['com.x']);
    expect(result).toEqual([]);
  });

  it('빌드/아이콘이 없으면 iconUrl은 빈 문자열', async () => {
    const versions = {
      data: [{ type: 'appStoreVersions', id: 'v1', attributes: { versionString: '2.0.0', appStoreState: 'IN_REVIEW' }, relationships: {} }],
    };
    const status = await firstVersion(client(appsRes, versions), ['com.x']);
    expect(status?.iconUrl).toBe('');
  });

  it('summary 모드에서 버전 슬림 요약을 출력한다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const versions = {
      data: [
        {
          type: 'appStoreVersions',
          id: 'v1',
          attributes: { versionString: '2.0.0', createdDate: '2026-06-01T00:00:00Z', appStoreState: 'IN_REVIEW' },
          relationships: { build: { data: { type: 'builds', id: 'b1' } } },
        },
      ],
      included: [{ type: 'builds', id: 'b1', attributes: { version: '1157' } }],
      meta: { paging: { total: 563 } },
    };
    await fetchAppSnapshots(client(appsRes, versions), ['com.x'], true);
    const lines = log.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => line.includes('버전 1개 조회 (총 563)'))).toBe(true);
    expect(
      lines.some(line => line.includes('2.0.0') && line.includes('IN_REVIEW') && line.includes('build=1157')),
    ).toBe(true);
    log.mockRestore();
  });
});
