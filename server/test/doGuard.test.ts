import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProtectedResource } from '../src/build/do';
import { config } from '../src/config';

test('the master ArksAI droplet is a protected resource', () => {
  assert.equal(isProtectedResource(config.masterDropletId), true);
  assert.equal(isProtectedResource(Number(config.masterDropletId)), true);
  assert.equal(isProtectedResource('577088981'), true); // the live master id
});

test('a build droplet id is NOT protected (still disposable)', () => {
  assert.equal(isProtectedResource('999999999'), false);
  assert.equal(isProtectedResource(12345), false);
});

test('the baked Android snapshot is protected when configured', () => {
  const prev = config.androidSnapshotId;
  try {
    config.androidSnapshotId = '233935491';
    assert.equal(isProtectedResource('233935491'), true);
  } finally {
    config.androidSnapshotId = prev;
  }
});
