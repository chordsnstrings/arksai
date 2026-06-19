import crypto from 'node:crypto';
import { config } from '../config';

// AES-256-GCM encryption for connector OAuth tokens at rest. The key is derived by
// SHA-256 of CONNECTOR_ENC_KEY (so any-length secret → a valid 32-byte key). Format
// stored: base64(iv).base64(authTag).base64(ciphertext).

function key(): Buffer {
  return crypto.createHash('sha256').update(config.connectorEncKey, 'utf8').digest();
}

/** True when token storage is configured (a key is set). Connectors are gated on this. */
export function encryptionReady(): boolean {
  return !!config.connectorEncKey;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed ciphertext');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Sign/verify the OAuth `state` param (CSRF + carries the initiating org). HMAC-SHA256. */
export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string): Record<string, string> | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  // constant-time compare
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}
