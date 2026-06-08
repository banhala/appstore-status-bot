import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const REQUIRED = {
  KEY_ID: 'k',
  ISSUER_ID: 'i',
  PRIVATE_KEY: 'pk',
  BUNDLE_ID: 'com.a,com.b',
  SLACK_WEB_CLIENT_API_KEY: 'tok',
  CHANNEL_R: 'C1',
};

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (
      key in REQUIRED ||
      ['MENTION_GROUP_IDS', 'GROUP_ID_P', 'DRY_RUN', 'TRIGGER', 'WINDOW_VERSION', 'RELEASE_NOTE'].includes(key)
    ) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, REQUIRED);
});

afterEach(() => {
  process.env = snapshot;
});

describe('loadEnv', () => {
  it('필수값을 파싱하고 BUNDLE_ID를 콤마 분리한다', () => {
    const env = loadEnv();
    expect(env.bundleIds).toEqual(['com.a', 'com.b']);
    expect(env.slackChannel).toBe('C1');
  });

  it('필수값 누락 시 throw한다', () => {
    delete process.env.KEY_ID;
    expect(() => loadEnv()).toThrow(/KEY_ID/);
  });

  it('BUNDLE_ID가 콤마뿐이면 throw한다', () => {
    process.env.BUNDLE_ID = ' , ';
    expect(() => loadEnv()).toThrow(/BUNDLE_ID/);
  });

  it('PRIVATE_KEY의 리터럴 \\n을 실제 개행으로 복원한다', () => {
    process.env.PRIVATE_KEY = 'line1\\nline2';
    expect(loadEnv().ascPrivateKey).toBe('line1\nline2');
  });

  it('MENTION_GROUP_IDS 우선, 없으면 GROUP_ID_P fallback', () => {
    process.env.GROUP_ID_P = 'G9';
    expect(loadEnv().mentionGroupIds).toEqual(['G9']);
    process.env.MENTION_GROUP_IDS = 'A,B,C';
    expect(loadEnv().mentionGroupIds).toEqual(['A', 'B', 'C']);
  });

  it('DRY_RUN은 정확히 "true"일 때만 true', () => {
    expect(loadEnv().dryRun).toBe(false);
    process.env.DRY_RUN = 'true';
    expect(loadEnv().dryRun).toBe(true);
    process.env.DRY_RUN = '1';
    expect(loadEnv().dryRun).toBe(false);
  });

  it('trigger 기본값은 manual', () => {
    expect(loadEnv().trigger).toBe('manual');
    process.env.TRIGGER = 'schedule';
    expect(loadEnv().trigger).toBe('schedule');
  });
});
