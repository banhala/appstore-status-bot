import { describe, it, expect } from 'vitest';
import { buildHeadline, stateColor, stateLabel } from '../src/notify/messages.js';
import { VERSION_STATES } from '../src/state/types.js';
import type { AppStatus } from '../src/state/types.js';

const app = (over: Partial<AppStatus> = {}): AppStatus => ({
  appId: '1',
  name: 'A',
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
      [3, '5%'],
      [5, '20%'],
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
