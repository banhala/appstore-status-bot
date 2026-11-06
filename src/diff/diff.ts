import type {
  AppSnapshot,
  AppStatus,
  LegacyStoredAppEntry,
  Notice,
  PhasedState,
  StoredState,
  StoredVersionEntry,
} from '../state/types.js';
import { isLegacyAppEntry } from '../state/types.js';

export interface DiffResult {
  /** 알림 대상 변화 */
  notices: Notice[];
  /** 최초 관측되어 baseline만 시드된 appId (알림 없음) */
  baselined: string[];
  /** 저장할 다음 상태(apps) */
  nextApps: StoredState['apps'];
  dropped: Array<{ name: string; version: string }>;
}

const ROLLING: readonly PhasedState[] = ['ACTIVE', 'PAUSED'];
const FULL_ROLLOUT_DAY = 7; // phased release 7일차부터 100% 노출, messages.ts PHASED_PERCENT와 같은 기준

const rolloutIncomplete = (app: AppStatus): boolean =>
  ROLLING.includes(app.phasedState) && app.phasedCurrentDay < FULL_ROLLOUT_DAY;

const toEntry = (app: AppStatus): StoredVersionEntry => ({
  version: app.version,
  state: app.state,
  phasedState: app.phasedState,
  phasedCurrentDay: app.phasedCurrentDay,
});

const stageChanged = (app: AppStatus, prev: StoredVersionEntry): boolean =>
  app.state !== prev.state || app.phasedState !== prev.phasedState;

const progressed = (app: AppStatus, prev: StoredVersionEntry): boolean =>
  app.phasedCurrentDay !== prev.phasedCurrentDay &&
  app.phasedState === 'ACTIVE' &&
  app.state === 'READY_FOR_SALE';

// ASC가 이전 버전의 appStoreState를 READY_FOR_SALE로 남겨 두므로 출시 여부는 생성 순서로 판단
// versions가 최신 생성 순이 아니면 추적 범위가 틀어짐
export const trackedVersions = (versions: AppStatus[]): AppStatus[] => {
  const liveIndex = versions.findIndex(version => version.state === 'READY_FOR_SALE');
  return versions.slice(0, liveIndex === -1 ? 1 : liveIndex + 1);
};

const migrateLegacy = (
  legacy: LegacyStoredAppEntry,
  versions: AppStatus[],
): Record<string, StoredVersionEntry> => {
  const matched = versions.find(version => version.version === legacy.version);
  return matched === undefined ? {} : { [matched.versionId]: legacy };
};

/**
 * 현재 조회 결과 vs 저장된 직전 상태 비교.
 * - 최초 관측(prev 없음)은 알림 없이 baseline만 시드 (도배 방지)
 * - 알림 조건: state 변화 | phasedState 변화 | (phasedDay 변화 && ACTIVE && READY_FOR_SALE)
 */
export const diffStatuses = (snapshots: AppSnapshot[], stored: StoredState): DiffResult => {
  const notices: Notice[] = [];
  const baselined: string[] = [];
  const dropped: DiffResult['dropped'] = [];
  const nextApps: StoredState['apps'] = { ...stored.apps };

  for (const snapshot of snapshots) {
    const tracked = trackedVersions(snapshot.versions);
    nextApps[snapshot.appId] = {
      versions: Object.fromEntries(tracked.map(app => [app.versionId, toEntry(app)])),
    };

    const storedEntry = stored.apps[snapshot.appId];
    if (storedEntry === undefined) {
      baselined.push(snapshot.appId);
      continue;
    }

    const migrating = isLegacyAppEntry(storedEntry);
    const prevVersions = migrating
      ? migrateLegacy(storedEntry, snapshot.versions)
      : storedEntry.versions;
    const trackedIds = new Set(tracked.map(app => app.versionId));
    const anchor = tracked[tracked.length - 1];
    // 출시 버전 판매 중단으로 다시 추적되는 이전 버전의 신규 오판 방지. 아는 버전보다 나중에 생성된 버전만 신규로 봄
    // 아는 버전이 없으면 구 스키마 이관일 때 전부 baseline, 그 밖에는 전부 신규
    const newestKnown = snapshot.versions.findIndex(app => prevVersions[app.versionId] !== undefined);
    const newBoundary = newestKnown !== -1 ? newestKnown : migrating ? 0 : snapshot.versions.length;

    for (const [index, app] of [...snapshot.versions.entries()].reverse()) {
      const prev = prevVersions[app.versionId];

      if (trackedIds.has(app.versionId)) {
        if (prev === undefined) {
          if (index < newBoundary) {
            notices.push({ kind: 'status', app });
          }
        } else if (stageChanged(app, prev) || progressed(app, prev)) {
          notices.push({ kind: 'status', app, prev });
        }
        continue;
      }

      if (prev === undefined) {
        continue;
      }
      if (stageChanged(app, prev)) {
        notices.push({ kind: 'status', app, prev });
      }
      if (rolloutIncomplete(app) && anchor !== undefined) {
        notices.push({ kind: 'superseded', app, next: anchor, prev });
      }
    }

    const observedIds = new Set(snapshot.versions.map(app => app.versionId));
    for (const [versionId, prev] of Object.entries(prevVersions)) {
      if (!observedIds.has(versionId)) {
        dropped.push({ name: snapshot.name, version: prev.version });
      }
    }
  }

  return { notices, baselined, nextApps, dropped };
};

export const rollbackFailed = (
  nextApps: StoredState['apps'],
  failed: Notice[],
): StoredState['apps'] => {
  const apps = { ...nextApps };
  for (const notice of failed) {
    const { appId, versionId } = notice.app;
    const entry = apps[appId];
    if (entry === undefined || isLegacyAppEntry(entry)) {
      continue;
    }
    const versions = { ...entry.versions };
    // 처음 관측한 버전은 저장소에서 빼야 다음 실행에서 신규로 다시 알림
    if (notice.prev === undefined) {
      delete versions[versionId];
    } else {
      versions[versionId] = notice.prev;
    }
    apps[appId] = { versions };
  }
  return apps;
};
