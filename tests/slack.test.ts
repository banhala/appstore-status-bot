import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSlackNotifier, notifyAll } from '../src/notify/slack.js';
import type { SlackNotifier } from '../src/notify/slack.js';
import type { AppStatus, Notice } from '../src/state/types.js';

const app = (over: Partial<AppStatus> = {}): AppStatus => ({
  appId: 'APPID',
  name: '에이블리',
  versionId: 'v1',
  version: '2.416.0',
  state: 'IN_REVIEW',
  iconUrl: '',
  phasedState: 'INACTIVE',
  phasedCurrentDay: 0,
  ...over,
});

const statusNotice: Notice = { kind: 'status', app: app() };

const supersededNotice: Notice = {
  kind: 'superseded',
  app: app({ versionId: 'v0', version: '2.415.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 2 }),
  next: app({ state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 }),
  prev: { version: '2.415.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 2 },
};

const notifier = (dryRun = false): SlackNotifier =>
  createSlackNotifier({ token: 'xoxb', channel: 'C1', mentionGroupIds: ['G1'], dryRun });

interface PostedBody {
  channel: string;
  text: string;
  attachments: Array<{ color: string; fields: Array<{ title: string; value: string }> }>;
}

const stubSlack = (response: { ok: boolean; error?: string } = { ok: true }) => {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => response });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    body: (): PostedBody => {
      const call = fetchMock.mock.calls[0] as [string, { body: string }];
      return JSON.parse(call[1].body) as PostedBody;
    },
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createSlackNotifier', () => {
  it('status 알림은 헤드라인과 버전, 상태 라벨 카드로 전송한다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const slack = stubSlack();
    await notifier().notify(statusNotice);
    const body = slack.body();
    expect(body.channel).toBe('C1');
    expect(body.text).toBe('<!subteam^G1> 애플 심사 상태: 심사 중입니다.');
    expect(body.attachments[0]?.fields).toEqual([
      { title: '버전', value: '2.416.0', short: true },
      { title: '상태', value: '심사 중', short: true },
    ]);
  });

  it('superseded 알림은 밀려난 버전 기준으로 미완료 라벨과 경고 색상을 쓴다', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const slack = stubSlack();
    await notifier().notify(supersededNotice);
    const body = slack.body();
    expect(body.text).toContain('애플 심사 상태: 점진적 배포를 100%로 전환하지 않은 상태에서 2.416.0 출시가 시작되었습니다.');
    expect(body.attachments[0]?.fields).toEqual([
      { title: '버전', value: '2.415.0', short: true },
      { title: '상태', value: '점진적 배포 미완료', short: true },
    ]);
    expect(body.attachments[0]?.color).toBe('#f4f124');
  });

  it('Slack이 ok:false를 돌려주면 예외를 던진다', async () => {
    stubSlack({ ok: false, error: 'not_in_channel' });
    await expect(notifier().notify(statusNotice)).rejects.toThrow(/not_in_channel/);
  });

  it('DRY_RUN이면 전송하지 않고 로그만 남긴다', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const slack = stubSlack();
    await notifier(true).notify(supersededNotice);
    expect(slack.fetchMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('superseded (미발송)'));
  });
});

describe('notifyAll', () => {
  it('일부 전송이 실패해도 나머지를 보내고 실패한 알림만 돌려준다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sent: Notice[] = [];
    const fake: SlackNotifier = {
      notify: async notice => {
        if (notice === supersededNotice) {
          throw new Error('boom');
        }
        sent.push(notice);
      },
    };
    const failed = await notifyAll(fake, [supersededNotice, statusNotice]);
    expect(failed).toEqual([supersededNotice]);
    expect(sent).toEqual([statusNotice]);
  });

  it('모두 성공하면 빈 배열을 돌려준다', async () => {
    const fake: SlackNotifier = { notify: async () => {} };
    expect(await notifyAll(fake, [statusNotice])).toEqual([]);
  });
});
