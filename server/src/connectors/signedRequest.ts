import { createHmac, timingSafeEqual } from 'node:crypto';

/** The JSON payload Meta signs inside a `signed_request` (Data Deletion / Deauthorize). */
export interface SignedRequestPayload {
  algorithm: string;
  issued_at?: number;
  expires?: number;
  /** the app-scoped user id — the only stable identifier the callback carries */
  user_id?: string;
  [key: string]: unknown;
}

/**
 * Pure, unit-tested verifier for Facebook's `signed_request` format
 * (`<base64url_sig>.<base64url_payload>`), used by the Data Deletion Request and
 * Deauthorize callbacks. Returns the decoded payload on a valid HMAC-SHA256 signature,
 * or null on ANY problem (malformed, wrong algorithm, bad signature) — the caller treats
 * null as "reject". Constant-time signature comparison; never throws.
 */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  if (!signedRequest || !appSecret || typeof signedRequest !== 'string') return null;
  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || dot === signedRequest.length - 1) return null;
  const encodedSig = signedRequest.slice(0, dot);
  const encodedPayload = signedRequest.slice(dot + 1);
  // Reject anything outside the base64url alphabet before we hand bytes to Buffer.
  if (!/^[A-Za-z0-9_-]+$/.test(encodedSig) || !/^[A-Za-z0-9_-]+$/.test(encodedPayload)) return null;

  let sig: Buffer;
  let payloadJson: string;
  try {
    sig = Buffer.from(encodedSig, 'base64url');
    payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!sig.length) return null;

  // The signature is over the RAW base64url payload segment (not the decoded JSON).
  const expected = createHmac('sha256', appSecret).update(encodedPayload).digest();
  if (expected.length !== sig.length) return null;
  if (!timingSafeEqual(expected, sig)) return null;

  let payload: SignedRequestPayload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  // Meta always signs with HMAC-SHA256; refuse anything else (defence against downgrade).
  if (String(payload.algorithm || '').toUpperCase().replace('-', '') !== 'HMACSHA256') return null;
  return payload;
}

/** Encode a payload as a valid `signed_request` — used by tests (and never in production). */
export function buildSignedRequest(payload: Record<string, unknown>, appSecret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', ...payload }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', appSecret).update(encodedPayload).digest('base64url');
  return `${sig}.${encodedPayload}`;
}
