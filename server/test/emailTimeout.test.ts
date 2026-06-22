import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../src/email/client';

test('withTimeout: rejects a hung promise with an actionable message', async () => {
  const never = new Promise<void>(() => {});
  await assert.rejects(
    () => withTimeout(never, 40, 'SMTP check'),
    (e: Error) => /SMTP check timed out after/.test(e.message) && /didn't respond/.test(e.message),
  );
});

test('withTimeout: passes through a value that resolves in time', async () => {
  const fast = new Promise<number>((res) => setTimeout(() => res(42), 5));
  assert.equal(await withTimeout(fast, 200, 'IMAP check'), 42);
});

test('withTimeout: propagates the original error if it rejects first', async () => {
  const boom = Promise.reject(new Error('auth failed'));
  await assert.rejects(() => withTimeout(boom, 200, 'SMTP check'), /auth failed/);
});
