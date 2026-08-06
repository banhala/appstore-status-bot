import type { AppStatus } from '../state/types.js';
import { buildHeadline, stateColor, stateLabel } from './messages.js';

const POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage';
const TIMEOUT_MS = 30_000;

export interface SlackNotifierParams {
  token: string;
  channel: string;
  mentionGroupIds: string[];
  dryRun: boolean;
}

export interface SlackNotifier {
  notify: (app: AppStatus) => Promise<void>;
}

interface PostMessageResponse {
  ok: boolean;
  error?: string;
}

const buildAttachment = (app: AppStatus): Record<string, unknown> => ({
  color: stateColor(app.state),
  title: 'App Store Connect',
  author_name: app.name,
  ...(app.iconUrl !== '' ? { author_icon: app.iconUrl } : {}),
  title_link: `https://appstoreconnect.apple.com/apps/${app.appId}/appstore`,
  fields: [
    { title: '버전', value: app.version, short: true },
    { title: '상태', value: stateLabel(app.state), short: true },
  ],
  footer: 'appstore-status-bot',
});

export const createSlackNotifier = (params: SlackNotifierParams): SlackNotifier => {
  const { token, channel, mentionGroupIds, dryRun } = params;

  const post = async (text: string, attachments: Record<string, unknown>[]): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(POST_MESSAGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ channel, text, attachments }),
        signal: controller.signal,
      });
      const data = (await res.json()) as PostMessageResponse;
      if (!data.ok) {
        throw new Error(`Slack 전송 실패: ${data.error ?? 'unknown'}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };

  const notify = async (app: AppStatus): Promise<void> => {
    const text = buildHeadline(app, mentionGroupIds);
    if (dryRun) {
      console.log(`[알림:DRY_RUN] ${app.name} ${app.version} → ${app.state} (미발송) | ${text}`);
      return;
    }
    await post(text, [buildAttachment(app)]);
    console.log(`[알림] ${app.name} ${app.version} → ${app.state} Slack 전송 완료`);
  };

  return { notify };
};
