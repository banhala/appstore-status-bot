import type { AppStatus, Notice, VersionState } from '../state/types.js';

// 상태 변화 알림 문구 (한국어)
const STATE_MESSAGE: Record<VersionState, string> = {
  PREPARE_FOR_SUBMISSION: '제출 준비 중입니다.',
  READY_FOR_REVIEW: '심사 준비됨으로 상태가 변경되었습니다.',
  WAITING_FOR_REVIEW: '심사 대기 중입니다.',
  IN_REVIEW: '심사 중입니다.',
  PENDING_CONTRACT: '대기 중인 계약입니다.',
  WAITING_FOR_EXPORT_COMPLIANCE: '수출 규정 관련 문서 승인 대기중입니다.',
  PENDING_DEVELOPER_RELEASE: '개발자 출시 대기 중입니다.',
  PROCESSING_FOR_APP_STORE: 'App Store 판매 준비중입니다.',
  PENDING_APPLE_RELEASE: '앱 승인 대기 중입니다.',
  READY_FOR_SALE: '판매가 시작되었습니다.', // 통상 phasedMessage로 대체
  ACCEPTED: '심사를 통과했습니다.',
  PREORDER_READY_FOR_SALE: '예약 주문 준비됨으로 상태가 변경되었습니다.',
  REJECTED: '앱 승인이 거부되었습니다.',
  METADATA_REJECTED: '메타데이터가 거부되었습니다.',
  REMOVED_FROM_SALE: '판매가 중단되었습니다.',
  DEVELOPER_REJECTED: '개발자가 취소했습니다.',
  DEVELOPER_REMOVED_FROM_SALE: '개발자가 판매를 중단했습니다.',
  INVALID_BINARY: '유효하지 않은 바이너리로 인해 거절되었습니다.',
  REPLACED_WITH_NEW_VERSION: '새 버전으로 대체되었습니다.',
  NOT_APPLICABLE: '상태가 변경되었습니다.',
};

// Slack attachment Status 필드용 짧은 라벨
const STATE_LABEL: Record<VersionState, string> = {
  PREPARE_FOR_SUBMISSION: '제출 준비 중',
  READY_FOR_REVIEW: '심사 준비됨',
  WAITING_FOR_REVIEW: '심사 대기 중',
  IN_REVIEW: '심사 중',
  PENDING_CONTRACT: '대기 중인 계약',
  WAITING_FOR_EXPORT_COMPLIANCE: '수출 규정 승인 대기',
  PENDING_DEVELOPER_RELEASE: '개발자 출시 대기',
  PROCESSING_FOR_APP_STORE: 'App Store 준비 중',
  PENDING_APPLE_RELEASE: '앱 승인 대기',
  READY_FOR_SALE: '판매 준비됨',
  ACCEPTED: '심사 통과',
  PREORDER_READY_FOR_SALE: '예약 주문 준비됨',
  REJECTED: '거부됨',
  METADATA_REJECTED: '메타데이터 거부됨',
  REMOVED_FROM_SALE: '판매 중단됨',
  DEVELOPER_REJECTED: '개발자 취소',
  DEVELOPER_REMOVED_FROM_SALE: '개발자 판매 중단',
  INVALID_BINARY: '유효하지 않은 바이너리',
  REPLACED_WITH_NEW_VERSION: '새 버전으로 대체',
  NOT_APPLICABLE: '해당 없음',
};

const INFO = '#8e8e8e';
const BLUE = '#1eb6fc';
const WARNING = '#f4f124';
const GREEN = '#14ba40';
const FAILURE = '#e0143d';

const STATE_COLOR: Record<VersionState, string> = {
  PREPARE_FOR_SUBMISSION: INFO,
  READY_FOR_REVIEW: INFO,
  WAITING_FOR_REVIEW: INFO,
  IN_REVIEW: BLUE,
  PENDING_CONTRACT: WARNING,
  WAITING_FOR_EXPORT_COMPLIANCE: WARNING,
  PENDING_DEVELOPER_RELEASE: GREEN,
  PROCESSING_FOR_APP_STORE: GREEN,
  PENDING_APPLE_RELEASE: GREEN,
  READY_FOR_SALE: GREEN,
  ACCEPTED: GREEN,
  PREORDER_READY_FOR_SALE: INFO,
  REJECTED: FAILURE,
  METADATA_REJECTED: FAILURE,
  REMOVED_FROM_SALE: FAILURE,
  DEVELOPER_REJECTED: FAILURE,
  DEVELOPER_REMOVED_FROM_SALE: FAILURE,
  INVALID_BINARY: FAILURE,
  REPLACED_WITH_NEW_VERSION: INFO,
  NOT_APPLICABLE: INFO,
};

// phased release 진행 day → 노출 비율
const PHASED_PERCENT: Record<number, string | undefined> = {
  1: '1%',
  2: '2%',
  3: '5%',
  4: '10%',
  5: '20%',
  6: '50%',
  7: '100%',
};

const phasedMessage = (app: AppStatus): string => {
  if (app.phasedState === 'COMPLETE') {
    return '점진적 배포가 완료되었습니다. (배포 진행율 100%)';
  }
  if (app.phasedState === 'PAUSED') {
    return '점진적 배포가 중단되었습니다.';
  }
  if (app.phasedState !== 'ACTIVE') {
    // INACTIVE(점진 배포 시작 전) 또는 NOT_EXIST(점진 배포 없이 출시) — 아직 100% 완료가 아님
    return '판매가 시작되었습니다.';
  }
  const percent = PHASED_PERCENT[app.phasedCurrentDay];
  return percent !== undefined
    ? `점진적 배포가 ${percent}로 진행 중입니다.`
    : '점진적 배포가 완료되었습니다. (배포 진행율 100%)';
};

const stateMessage = (app: AppStatus): string =>
  app.state === 'READY_FOR_SALE' ? phasedMessage(app) : STATE_MESSAGE[app.state];

const supersededMessage = (app: AppStatus, next: AppStatus): string => {
  const progress =
    app.phasedState === 'PAUSED'
      ? '점진적 배포 중단 상태'
      : `마지막 진행율 ${PHASED_PERCENT[app.phasedCurrentDay] ?? '알 수 없음'}`;
  return `점진적 배포를 100%로 전환하지 않은 상태에서 ${next.version} 출시가 시작되었습니다. (${progress})`;
};

const withPrefix = (mentionGroupIds: string[], body: string): string => {
  const mentions = mentionGroupIds.map(id => `<!subteam^${id}>`).join(' ');
  return mentions === '' ? `애플 심사 상태: ${body}` : `${mentions} 애플 심사 상태: ${body}`;
};

/** 멘션 프리픽스 + "애플 심사 상태: {문구}" 헤드라인 */
export const buildHeadline = (app: AppStatus, mentionGroupIds: string[]): string =>
  withPrefix(mentionGroupIds, stateMessage(app));

export const buildNoticeHeadline = (notice: Notice, mentionGroupIds: string[]): string =>
  notice.kind === 'status'
    ? buildHeadline(notice.app, mentionGroupIds)
    : withPrefix(mentionGroupIds, supersededMessage(notice.app, notice.next));

export const stateLabel = (state: VersionState): string => STATE_LABEL[state];

export const stateColor = (state: VersionState): string => STATE_COLOR[state];

export const noticeLabel = (notice: Notice): string =>
  notice.kind === 'status' ? stateLabel(notice.app.state) : '점진적 배포 미완료';

export const noticeColor = (notice: Notice): string =>
  notice.kind === 'status' ? stateColor(notice.app.state) : WARNING;
