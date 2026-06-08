import type { AppStatus, StoredAppEntry, StoredState } from '../state/types.js';

export interface AppChange {
  app: AppStatus;
  submissionStartDate?: string;
}

export interface DiffResult {
  /** 알림 대상 변화 */
  changes: AppChange[];
  /** 저장할 다음 상태(apps) */
  nextApps: Record<string, StoredAppEntry>;
}

/**
 * 현재 조회 결과 vs 저장된 직전 상태 비교.
 * - 최초 관측(prev 없음)은 알림 없이 baseline만 시드 (도배 방지)
 * - 알림 조건: state 변화 | phasedState 변화 | (phasedDay 변화 && ACTIVE && READY_FOR_SALE)
 * - WAITING_FOR_REVIEW 진입 시 submissionStartDate 기록
 */
export const diffStatuses = (
  current: AppStatus[],
  stored: StoredState,
  now: string,
): DiffResult => {
  const changes: AppChange[] = [];
  const nextApps: Record<string, StoredAppEntry> = { ...stored.apps };

  for (const app of current) {
    const prev = stored.apps[app.appId];

    const enteringReview =
      app.state === 'WAITING_FOR_REVIEW' && prev?.state !== 'WAITING_FOR_REVIEW';
    const submissionStartDate = enteringReview ? now : prev?.submissionStartDate;

    const notify =
      prev !== undefined &&
      (app.state !== prev.state ||
        app.phasedState !== prev.phasedState ||
        (app.phasedCurrentDay !== prev.phasedCurrentDay &&
          app.phasedState === 'ACTIVE' &&
          app.state === 'READY_FOR_SALE'));

    if (notify) {
      changes.push({ app, submissionStartDate });
    }

    nextApps[app.appId] = {
      version: app.version,
      state: app.state,
      phasedState: app.phasedState,
      phasedCurrentDay: app.phasedCurrentDay,
      ...(submissionStartDate !== undefined ? { submissionStartDate } : {}),
    };
  }

  return { changes, nextApps };
};
