import { loadEnv } from './config/env.js';
import { createAscClient } from './asc/client.js';
import { fetchAppStatuses } from './asc/appStatus.js';
import { diffStatuses } from './diff/diff.js';
import { createSlackNotifier } from './notify/slack.js';
import { loadState, saveState } from './state/store.js';
import type { Window } from './state/types.js';

const WINDOW_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const main = async (): Promise<void> => {
  const env = loadEnv();
  const state = await loadState();

  const now = new Date();
  const nowIso = now.toISOString();

  // 상태 커밋/푸시는 CI(GitHub Actions)에서만. 로컬/dry 실행은 파일만 쓰고 부작용 없음
  const commitState = process.env.GITHUB_ACTIONS === 'true';

  // repository_dispatch(App Store 버전 생성) / workflow_dispatch(수동) → 윈도우 오픈
  const isOpener = env.trigger === 'repository_dispatch' || env.trigger === 'workflow_dispatch';

  let reviewWindow: Window = state.window;
  if (isOpener) {
    reviewWindow = {
      open: true,
      openedAt: nowIso,
      hardExpiresAt: new Date(now.getTime() + WINDOW_TTL_DAYS * DAY_MS).toISOString(),
      trigger: env.trigger === 'repository_dispatch' ? 'repository_dispatch' : 'workflow_dispatch',
      ...(env.windowVersion !== undefined ? { targetVersion: env.windowVersion } : {}),
      ...(env.releaseNote !== undefined ? { releaseNote: env.releaseNote } : {}),
    };
    const versionPart = env.windowVersion !== undefined ? `, 버전 ${env.windowVersion}` : '';
    console.log(`[윈도우] 오픈 — ${env.trigger}${versionPart}, ${reviewWindow.hardExpiresAt}까지 추적`);
  }

  // 윈도우 닫힘 & opener 아님(=schedule 하트비트) → no-op
  if (!reviewWindow.open) {
    console.log('[종료] 추적 중인 릴리즈 없음 — App Store 조회 생략 (schedule 하트비트)');
    return;
  }

  // 하드 만료 → 닫고 종료
  if (nowIso > reviewWindow.hardExpiresAt) {
    console.log(
      `[윈도우] ${reviewWindow.openedAt} 오픈분이 만료기한(${reviewWindow.hardExpiresAt}) 초과 — 닫고 종료`,
    );
    await saveState(
      { window: { ...reviewWindow, open: false }, apps: state.apps, updatedAt: nowIso },
      { commit: commitState },
    );
    return;
  }

  const client = createAscClient(env);
  const statuses = await fetchAppStatuses(client, env.bundleIds);
  for (const status of statuses) {
    const phasedPart =
      status.phasedState === 'ACTIVE' ? ` (${status.phasedCurrentDay}일차)` : '';
    console.log(
      `[관측] ${status.name} ${status.version} — 심사 ${status.state}, 점진배포 ${status.phasedState}${phasedPart}`,
    );
  }

  const { changes, baselined, nextApps } = diffStatuses(statuses, state);
  if (baselined.length > 0) {
    console.log(`[판정] 최초 관측 — baseline ${baselined.length}건 기록(알림 없음)`);
  }
  if (changes.length === 0 && baselined.length === 0) {
    console.log('[판정] 직전 상태와 동일 — 알림 없음');
  }

  const notifier = createSlackNotifier({
    token: env.slackToken,
    channel: env.slackChannel,
    mentionGroupIds: env.mentionGroupIds,
    dryRun: env.dryRun,
  });
  for (const app of changes) {
    await notifier.notify(app, reviewWindow.releaseNote);
  }

  // 종료조건: 추적 중인 앱이 모두 phased COMPLETE → 릴리즈 사이클 종료
  const allComplete =
    statuses.length > 0 && statuses.every(status => status.phasedState === 'COMPLETE');
  if (allComplete) {
    console.log('[윈도우] 모든 앱 점진적 배포 완료(COMPLETE) — 추적 종료(윈도우 닫음)');
    reviewWindow = { ...reviewWindow, open: false };
  }

  await saveState({ window: reviewWindow, apps: nextApps, updatedAt: nowIso }, { commit: commitState });
};

main().catch((error: unknown) => {
  console.error('[오류] 봇 실행 실패:', error);
  process.exitCode = 1;
});
