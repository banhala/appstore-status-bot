import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

export interface AscJwtParams {
  keyId: string;
  issuerId: string;
  /** .p8 private key (PEM) */
  privateKey: string;
  /** 토큰 수명(초). 기본 1140(19분) — Apple 한계 20분 안쪽 */
  ttlSeconds?: number;
}

const base64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64url');

/**
 * App Store Connect API용 ES256 JWT 발급.
 * - alg ES256, aud appstoreconnect-v1
 * - iat에 클럭 스큐 버퍼(-30s), exp는 20분 한계 안쪽
 * - 서명은 JOSE raw r||s 포맷(`ieee-p1363`) — DER 아님
 */
export const createAscJwt = (params: AscJwtParams): string => {
  const { keyId, issuerId, privateKey, ttlSeconds = 1140 } = params;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const payload = {
    iss: issuerId,
    iat: now - 30,
    exp: now + ttlSeconds,
    aud: 'appstoreconnect-v1',
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(privateKey);
  const signature = cryptoSign('sha256', Buffer.from(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64url(signature)}`;
};
