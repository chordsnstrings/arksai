import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { config } from '../config';

/**
 * Symmetric encryption for third-party secrets stored at rest (per-org mailbox
 * passwords). AES-256-GCM with a key derived from config.encryptionKey via scrypt.
 * Ciphertext format: "enc1$<saltHex>$<ivHex>$<tagHex>$<dataHex>". The salt is
 * stored per value so the derived key is value-specific (no shared-key reuse).
 *
 * If no encryption key is configured we refuse to encrypt (callers must handle the
 * thrown error) — we never store a plaintext secret silently.
 */

const PREFIX = 'enc1';

function deriveKey(salt: Buffer): Buffer {
  const secret = config.encryptionKey;
  if (!secret) {
    throw new Error('No ENCRYPTION_KEY (or APP_PASSWORD) set — cannot encrypt secrets at rest.');
  }
  return scryptSync(secret, salt, 32);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, salt.toString('hex'), iv.toString('hex'), tag.toString('hex'), data.toString('hex')].join('$');
}

export function decryptSecret(stored: string | null | undefined): string {
  const s = String(stored || '');
  const parts = s.split('$');
  if (parts.length !== 5 || parts[0] !== PREFIX) {
    throw new Error('Malformed encrypted secret.');
  }
  const [, saltHex, ivHex, tagHex, dataHex] = parts;
  const key = deriveKey(Buffer.from(saltHex, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

export function isEncrypted(s: string | null | undefined): boolean {
  return typeof s === 'string' && s.startsWith(PREFIX + '$');
}
