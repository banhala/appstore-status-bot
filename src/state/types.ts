// 내부 정규화 상태값 = ASC `appStoreState` 셋(상위집합).
// `appVersionState`의 신규 표기는 appStatus 정규화에서 이 셋으로 흡수.
export const VERSION_STATES = [
  'ACCEPTED',
  'DEVELOPER_REMOVED_FROM_SALE',
  'DEVELOPER_REJECTED',
  'IN_REVIEW',
  'INVALID_BINARY',
  'METADATA_REJECTED',
  'PENDING_APPLE_RELEASE',
  'PENDING_CONTRACT',
  'PENDING_DEVELOPER_RELEASE',
  'PREPARE_FOR_SUBMISSION',
  'PREORDER_READY_FOR_SALE',
  'PROCESSING_FOR_APP_STORE',
  'READY_FOR_REVIEW',
  'READY_FOR_SALE',
  'REJECTED',
  'REMOVED_FROM_SALE',
  'WAITING_FOR_EXPORT_COMPLIANCE',
  'WAITING_FOR_REVIEW',
  'REPLACED_WITH_NEW_VERSION',
  'NOT_APPLICABLE',
] as const;
export type VersionState = (typeof VERSION_STATES)[number];

export const isVersionState = (value: string): value is VersionState =>
  (VERSION_STATES as readonly string[]).includes(value);

// NOT_EXIST = phased release 미존재(합성값). 나머지는 ASC PhasedReleaseState.
export const PHASED_STATES = ['NOT_EXIST', 'INACTIVE', 'ACTIVE', 'PAUSED', 'COMPLETE'] as const;
export type PhasedState = (typeof PHASED_STATES)[number];

export const isPhasedState = (value: string): value is PhasedState =>
  (PHASED_STATES as readonly string[]).includes(value);

export interface AppStatus {
  appId: string;
  name: string;
  version: string;
  state: VersionState;
  iconUrl: string;
  phasedState: PhasedState;
  phasedCurrentDay: number;
}

export interface StoredAppEntry {
  version: string;
  state: VersionState;
  phasedState: PhasedState;
  phasedCurrentDay: number;
}

export interface StoredState {
  apps: Record<string, StoredAppEntry>;
  /** ISO 8601 */
  updatedAt: string;
}
