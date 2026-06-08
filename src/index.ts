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

  // repository_dispatch(App Store 제출) / workflow_dispatch(수동) → 윈도우 오픈
  const isOpener = env.trigger === 'repository_dispatch' || env.trigger === 'workflow_dispatch';

  let window: Window = state.window;
  if (isOpener) {
    window = {
      open: true,
      openedAt: nowIso,
      hardExpiresAt: new Date(now.getTime() + WINDOW_TTL_DAYS * DAY_MS).toISOString(),
      trigger: env.trigger === 'repository_dispatch' ? 'repository_dispatch' : 'workflow_dispatch',
      ...(env.windowVersion !== undefined ? { targetVersion: env.windowVersion } : {}),
      ...(env.releaseNote !== undefined ? { releaseNote: env.releaseNote } : {}),
    };
    console.log(`[window] ${env.trigger}로 오픈`);
  }

  // 윈도우 닫힘 & opener 아님(=schedule 하트비트) → no-op
  if (!window.open) {
    console.log('[window] 닫힘 — 건너뜀');
    return;
  }

  // 하드 만료 → 닫고 종료
  if (nowIso > window.hardExpiresAt) {
    console.log('[window] 만료 — 닫음');
    await saveState({ window: { ...window, open: false }, apps: state.apps, updatedAt: nowIso });
    return;
  }

  const client = createAscClient(env);
  const statuses = await fetchAppStatuses(client, env.bundleIds);

  const { changes, nextApps } = diffStatuses(statuses, state);

  const notifier = createSlackNotifier({
    token: env.slackToken,
    channel: env.slackChannel,
    mentionGroupIds: env.mentionGroupIds,
    dryRun: env.dryRun,
  });
  for (const app of changes) {
    await notifier.notify(app, window.releaseNote);
  }
  console.log(`[poll] 조회 ${statuses.length}건, 변화 알림 ${changes.length}건`);

  // 종료조건: 추적 중인 앱이 모두 phased COMPLETE → 릴리즈 사이클 종료
  const allComplete =
    statuses.length > 0 && statuses.every(status => status.phasedState === 'COMPLETE');
  if (allComplete) {
    console.log('[window] 모든 앱 phased COMPLETE — 닫음');
    window = { ...window, open: false };
  }

  await saveState({ window, apps: nextApps, updatedAt: nowIso });
};

main().catch((error: unknown) => {
  console.error('[fatal]', error);
  process.exitCode = 1;
});
