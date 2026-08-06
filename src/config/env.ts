export interface Env {
  /** ASC API Key ID */
  ascKeyId: string;
  /** ASC Issuer ID */
  ascIssuerId: string;
  /** .p8 private key 본문 (PEM) */
  ascPrivateKey: string;
  /** 대상 번들 ID 목록 (콤마 다중) */
  bundleIds: string[];
  /** Slack Bot 토큰 */
  slackToken: string;
  /** 알림 채널 ID */
  slackChannel: string;
  /** 멘션할 Slack subteam ID 목록 (없으면 빈 배열) */
  mentionGroupIds: string[];
  /** true면 Slack 미발송 (조회/diff만) */
  dryRun: boolean;
  /** ASC 응답 로그 — 기본 true(슬림 요약), false면 전체 raw 출력 */
  summary: boolean;
  /** 상태 저장용 gist ID (GIST_ID) */
  gistId?: string;
  /** gist 접근 토큰 (GH_TOKEN, gist 스코프) */
  githubToken?: string;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`필수 환경변수 누락: ${name}`);
  }
  return value;
};

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value;
};

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);

/** GitHub Secret에 리터럴 `\n`으로 저장된 .p8를 실제 개행으로 복원 (ES256 서명 전 정규화) */
const normalizePrivateKey = (raw: string): string => raw.replace(/\\n/g, '\n');

export const loadEnv = (): Env => {
  // 멘션 ID는 MENTION_GROUP_IDS(콤마 다중) 우선, 없으면 기존 GROUP_ID_P fallback
  const mentionRaw = optional('MENTION_GROUP_IDS') ?? optional('GROUP_ID_P');

  const bundleIds = splitList(required('BUNDLE_ID'));
  if (bundleIds.length === 0) {
    throw new Error('BUNDLE_ID에 유효한 번들 ID가 없습니다');
  }

  return {
    ascKeyId: required('KEY_ID'),
    ascIssuerId: required('ISSUER_ID'),
    ascPrivateKey: normalizePrivateKey(required('PRIVATE_KEY')),
    bundleIds,
    slackToken: required('SLACK_WEB_CLIENT_API_KEY'),
    slackChannel: required('CHANNEL_R'),
    mentionGroupIds: mentionRaw ? splitList(mentionRaw) : [],
    dryRun: optional('DRY_RUN') === 'true',
    summary: optional('SUMMARY') !== 'false',
    gistId: optional('GIST_ID'),
    githubToken: optional('GH_TOKEN'),
  };
};
