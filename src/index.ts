import { loadEnv } from './config/env.js';
import { createAscClient } from './asc/client.js';
import { fetchAppSnapshots } from './asc/appStatus.js';
import { diffStatuses, rollbackFailed, trackedVersions } from './diff/diff.js';
import { createSlackNotifier, notifyAll } from './notify/slack.js';
import { loadState, saveState } from './state/store.js';

const main = async (): Promise<void> => {
  const env = loadEnv();

  const nowIso = new Date().toISOString();

  // 상태 저장(gist write)은 CI에서만. 로컬/dry 실행은 읽기만 하고 쓰지 않음
  const persist = process.env.GITHUB_ACTIONS === 'true';
  const gistConfig =
    env.gistId !== undefined && env.githubToken !== undefined
      ? { gistId: env.gistId, token: env.githubToken }
      : undefined;
  if (persist && gistConfig === undefined) {
    throw new Error('CI 실행에는 GIST_ID / GH_TOKEN 시크릿이 필요합니다');
  }
  const state = await loadState(gistConfig);

  const client = createAscClient(env);
  const snapshots = await fetchAppSnapshots(client, env.bundleIds, env.summary);
  for (const snapshot of snapshots) {
    for (const status of trackedVersions(snapshot.versions)) {
      const phasedPart =
        status.phasedState === 'ACTIVE' ? ` (${status.phasedCurrentDay}일차)` : '';
      console.log(
        `[관측] ${status.name} ${status.version} — 심사 ${status.state}, 점진배포 ${status.phasedState}${phasedPart}`,
      );
    }
  }

  const { notices, baselined, nextApps, dropped } = diffStatuses(snapshots, state);
  if (baselined.length > 0) {
    console.log(`[판정] 최초 관측 — baseline ${baselined.length}건 기록(알림 없음)`);
  }
  for (const { name, version } of dropped) {
    console.warn(`[판정] ${name} ${version}: ASC 응답에서 사라진 추적 버전 — 추적 종료`);
  }
  if (notices.length === 0 && baselined.length === 0) {
    console.log('[판정] 직전 상태와 동일 — 알림 없음');
  }

  const notifier = createSlackNotifier({
    token: env.slackToken,
    channel: env.slackChannel,
    mentionGroupIds: env.mentionGroupIds,
    dryRun: env.dryRun,
  });
  const failed = await notifyAll(notifier, notices);

  await saveState(
    { apps: rollbackFailed(nextApps, failed), updatedAt: nowIso },
    gistConfig,
    persist,
  );
  if (failed.length > 0) {
    throw new Error(`알림 전송 실패 ${failed.length}건 — 다음 실행에서 재시도`);
  }
};

main().catch((error: unknown) => {
  console.error('[오류] 봇 실행 실패:', error);
  process.exitCode = 1;
});
