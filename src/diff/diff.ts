import type { AppStatus, StoredAppEntry, StoredState } from '../state/types.js';

export interface DiffResult {
  /** 알림 대상 변화 */
  changes: AppStatus[];
  /** 저장할 다음 상태(apps) */
  nextApps: Record<string, StoredAppEntry>;
}

/**
 * 현재 조회 결과 vs 저장된 직전 상태 비교.
 * - 최초 관측(prev 없음)은 알림 없이 baseline만 시드 (도배 방지)
 * - 알림 조건: state 변화 | phasedState 변화 | (phasedDay 변화 && ACTIVE && READY_FOR_SALE)
 */
export const diffStatuses = (current: AppStatus[], stored: StoredState): DiffResult => {
  const changes: AppStatus[] = [];
  const nextApps: Record<string, StoredAppEntry> = { ...stored.apps };

  for (const app of current) {
    const prev = stored.apps[app.appId];

    const notify =
      prev !== undefined &&
      (app.state !== prev.state ||
        app.phasedState !== prev.phasedState ||
        (app.phasedCurrentDay !== prev.phasedCurrentDay &&
          app.phasedState === 'ACTIVE' &&
          app.state === 'READY_FOR_SALE'));

    if (notify) {
      changes.push(app);
    }

    nextApps[app.appId] = {
      version: app.version,
      state: app.state,
      phasedState: app.phasedState,
      phasedCurrentDay: app.phasedCurrentDay,
    };
  }

  return { changes, nextApps };
};
