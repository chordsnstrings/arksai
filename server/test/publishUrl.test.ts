import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicUrl } from '../src/agent/tools/publish';

const PATH = '/apps/gic-global/';

test('buildPublicUrl: path-based by default (subdomain off)', () => {
  assert.equal(
    buildPublicUrl(PATH, { publicBaseUrl: 'https://arksai.studio', appsSubdomainBase: '' }),
    'https://arksai.studio/apps/gic-global/',
  );
});

test('buildPublicUrl: clean subdomain when a base is configured', () => {
  assert.equal(
    buildPublicUrl(PATH, { publicBaseUrl: 'https://arksai.studio', appsSubdomainBase: 'apps.arksai.studio' }),
    'https://gic-global.apps.arksai.studio/',
  );
  // works without a trailing slash on the path too
  assert.equal(
    buildPublicUrl('/apps/foo', { publicBaseUrl: 'https://arksai.studio', appsSubdomainBase: 'apps.arksai.studio' }),
    'https://foo.apps.arksai.studio/',
  );
});

test('buildPublicUrl: an already-absolute URL is passed through unchanged', () => {
  assert.equal(
    buildPublicUrl('https://example.com/x', { publicBaseUrl: 'https://arksai.studio', appsSubdomainBase: 'apps.arksai.studio' }),
    'https://example.com/x',
  );
});
