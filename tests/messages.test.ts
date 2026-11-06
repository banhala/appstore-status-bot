import { describe, it, expect } from 'vitest';
import {
  buildHeadline,
  buildNoticeHeadline,
  noticeColor,
  noticeLabel,
  stateColor,
  stateLabel,
} from '../src/notify/messages.js';
import { VERSION_STATES } from '../src/state/types.js';
import type { AppStatus, Notice, StoredVersionEntry } from '../src/state/types.js';

const app = (over: Partial<AppStatus> = {}): AppStatus => ({
  appId: '1',
  name: 'A',
  versionId: 'v1',
  version: '1.0.0',
  state: 'IN_REVIEW',
  iconUrl: '',
  phasedState: 'NOT_EXIST',
  phasedCurrentDay: 0,
  ...over,
});

describe('messages', () => {
  it('모든 VersionState에 라벨·색상이 존재한다', () => {
    for (const state of VERSION_STATES) {
      expect(stateLabel(state).length).toBeGreaterThan(0);
      expect(stateColor(state)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('헤드라인에 멘션 프리픽스와 상태 문구가 포함된다', () => {
    const text = buildHeadline(app({ state: 'IN_REVIEW' }), ['G1', 'G2']);
    expect(text).toBe('<!subteam^G1> <!subteam^G2> 애플 심사 상태: 심사 중입니다.');
  });

  it('멘션이 없으면 프리픽스 없이 구성한다', () => {
    const text = buildHeadline(app({ state: 'WAITING_FOR_REVIEW' }), []);
    expect(text).toBe('애플 심사 상태: 심사 대기 중입니다.');
  });

  it('READY_FOR_SALE + ACTIVE는 day별 진행률 문구로 대체된다', () => {
    const cases: Array<[number, string]> = [
      [1, '1%'],
      [2, '2%'],
      [3, '5%'],
      [4, '10%'],
      [5, '20%'],
      [6, '50%'],
      [7, '100%'],
    ];
    for (const [day, percent] of cases) {
      const text = buildHeadline(
        app({ state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: day }),
        [],
      );
      expect(text).toContain(`점진적 배포가 ${percent}로 진행 중입니다.`);
    }
  });

  it('READY_FOR_SALE인데 phased가 INACTIVE/NOT_EXIST면 "판매가 시작되었습니다"', () => {
    expect(buildHeadline(app({ state: 'READY_FOR_SALE', phasedState: 'INACTIVE' }), [])).toBe(
      '애플 심사 상태: 판매가 시작되었습니다.',
    );
    expect(buildHeadline(app({ state: 'READY_FOR_SALE', phasedState: 'NOT_EXIST' }), [])).toBe(
      '애플 심사 상태: 판매가 시작되었습니다.',
    );
  });

  it('phased COMPLETE/PAUSED는 전용 문구를 쓴다', () => {
    expect(buildHeadline(app({ state: 'READY_FOR_SALE', phasedState: 'COMPLETE' }), [])).toContain(
      '점진적 배포가 완료',
    );
    expect(buildHeadline(app({ state: 'READY_FOR_SALE', phasedState: 'PAUSED' }), [])).toContain(
      '점진적 배포가 중단',
    );
  });

  it('READY_FOR_SALE가 아니면 phased 값이 있어도 상태 문구를 쓴다', () => {
    const text = buildHeadline(app({ state: 'IN_REVIEW', phasedState: 'ACTIVE', phasedCurrentDay: 3 }), []);
    expect(text).toBe('애플 심사 상태: 심사 중입니다.');
  });

  it('phased ACTIVE인데 day가 범위(1~7) 밖이면 완료 문구로 폴백한다', () => {
    for (const day of [0, 8]) {
      const text = buildHeadline(app({ state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: day }), []);
      expect(text).toContain('점진적 배포가 완료');
    }
  });
});

describe('notice messages', () => {
  const prev: StoredVersionEntry = { version: '2.400.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 2 };
  const next = app({ versionId: 'v2', version: '2.401.0', state: 'READY_FOR_SALE', phasedState: 'ACTIVE', phasedCurrentDay: 1 });
  const superseded = (over: Partial<AppStatus>): Notice => ({
    kind: 'superseded',
    app: app({ version: '2.400.0', state: 'READY_FOR_SALE', ...over }),
    next,
    prev,
  });

  it('status 알림은 상태 헤드라인과 라벨, 색상을 그대로 쓴다', () => {
    const notice: Notice = { kind: 'status', app: app({ state: 'IN_REVIEW' }) };
    expect(buildNoticeHeadline(notice, [])).toBe(buildHeadline(notice.app, []));
    expect(noticeLabel(notice)).toBe(stateLabel('IN_REVIEW'));
    expect(noticeColor(notice)).toBe(stateColor('IN_REVIEW'));
  });

  it('100% 전환 없이 밀려난 버전은 마지막 진행율과 다음 버전을 알린다', () => {
    const notice = superseded({ phasedState: 'ACTIVE', phasedCurrentDay: 2 });
    expect(buildNoticeHeadline(notice, ['G1'])).toBe(
      '<!subteam^G1> 애플 심사 상태: 점진적 배포를 100%로 전환하지 않은 상태에서 2.401.0 출시가 시작되었습니다. (마지막 진행율 2%)',
    );
    expect(noticeLabel(notice)).toBe('점진적 배포 미완료');
    expect(noticeColor(notice)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('PAUSED 상태로 밀려나면 중단 상태로 표기한다', () => {
    const text = buildNoticeHeadline(superseded({ phasedState: 'PAUSED', phasedCurrentDay: 3 }), []);
    expect(text).toContain('(점진적 배포 중단 상태)');
  });
});
