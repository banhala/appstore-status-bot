import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createAscJwt } from '../src/asc/jwt.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const decode = (segment: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;

describe('createAscJwt', () => {
  const token = createAscJwt({ keyId: 'KID', issuerId: 'ISS', privateKey: privatePem });
  const [headerB64, payloadB64, signatureB64] = token.split('.');

  it('header는 ES256/kid/typ를 갖는다', () => {
    expect(decode(headerB64 ?? '')).toEqual({ alg: 'ES256', kid: 'KID', typ: 'JWT' });
  });

  it('payload는 iss/aud와 20분 이내 exp를 갖는다', () => {
    const payload = decode(payloadB64 ?? '');
    expect(payload.iss).toBe('ISS');
    expect(payload.aud).toBe('appstoreconnect-v1');
    const iat = payload.iat as number;
    const exp = payload.exp as number;
    expect(exp - iat).toBeLessThanOrEqual(20 * 60);
    expect(exp - iat).toBeGreaterThan(0);
  });

  it('서명을 공개키로 검증할 수 있다 (JOSE r‖s)', () => {
    const signingInput = `${headerB64}.${payloadB64}`;
    const ok = verify(
      'sha256',
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64 ?? '', 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('다른 공개키로는 검증에 실패한다', () => {
    const { publicKey: wrongKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const signingInput = `${headerB64}.${payloadB64}`;
    const ok = verify(
      'sha256',
      Buffer.from(signingInput),
      { key: wrongKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureB64 ?? '', 'base64url'),
    );
    expect(ok).toBe(false);
  });
});
