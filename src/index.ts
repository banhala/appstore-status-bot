import { loadEnv } from './config/env.js';
import { createAscClient } from './asc/client.js';
import { fetchAppStatuses } from './asc/appStatus.js';
import { diffStatuses } from './diff/diff.js';
import { createSlackNotifier } from './notify/slack.js';
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
  const statuses = await fetchAppStatuses(client, env.bundleIds, env.summary);
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
    await notifier.notify(app);
  }

  await saveState({ apps: nextApps, updatedAt: nowIso }, gistConfig, persist);
};

main().catch((error: unknown) => {
  console.error('[오류] 봇 실행 실패:', error);
  process.exitCode = 1;
});
