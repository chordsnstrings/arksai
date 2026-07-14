import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_TOOLS } from '../src/agent/tools';
import { complexityTier } from '../src/agent/router';
import { buildMetaAuthUrl } from '../src/connectors/meta';

/**
 * The FXP-disaster fix: the piecemeal creation footguns are retired from the agent, ad-account
 * work routes off the fast lane, the write scope is requested, and Pages come from stored data.
 * (Tests the REGISTRATION — getToolsForMode also availability-gates on a live Meta connection.)
 */

// A tool is "reachable in <mode>" if it's registered with that mode (availability is a live gate).
const registered = (name: string, mode: 'chat' | 'code') =>
  ALL_TOOLS.some((t) => t.name === name && t.modes.includes(mode));

test('retired: create_campaign / plan_campaign / boost_post are NOT registered for chat or code', () => {
  for (const gone of ['create_campaign', 'plan_campaign', 'boost_post']) {
    assert.ok(!ALL_TOOLS.some((t) => t.name === gone), `${gone} must be removed from ALL_TOOLS`);
  }
  for (const mode of ['chat', 'code'] as const) {
    assert.ok(registered('launch_managed_campaign', mode), `launch_managed_campaign in ${mode}`);
    assert.ok(registered('pause_campaign', mode) && registered('campaign_report', mode), `management tools in ${mode}`);
    assert.ok(registered('list_pages', mode), `list_pages in ${mode}`);
  }
});

test('Meta ad operations route to the heavy lane (M3), never the Swift fast lane', () => {
  for (const brief of [
    'create a campaign to point to my site for tourist visa in Canada',
    'launch an ad for our new product',
    'run facebook ads for the clinic, $50/day',
    'boost this post',
  ]) {
    assert.equal(complexityTier(brief, 'chat'), 'heavy', `"${brief}" must be heavy`);
  }
  // A plain question is still light (no over-escalation).
  assert.equal(complexityTier('what is a good daily budget?', 'chat'), 'light');
});

test('the Meta login now requests the WRITE + Pages scopes (was read-only)', () => {
  const u = buildMetaAuthUrl('APPID', 'STATE', 'https://arksai.studio/api/connectors/meta/callback');
  assert.match(u, /ads_management/); // the write scope — without it every create/upload fails
  assert.match(u, /pages_show_list/);
});

test('list_pages returns stored pages only, never invents them (honest empty message)', () => {
  // Source-lock: the tool reads listMetaPages and, on empty, tells the user to reconnect —
  // it must not fabricate page names (the exact live hallucination).
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/tools/pages.ts'), 'utf8');
  assert.match(src, /listMetaPages/);
  assert.match(src, /Do NOT guess page names/);
  assert.doesNotMatch(src, /Global Immigration|FXP Official/); // no hardcoded page names
});

test('the chat prompt carries the absolute Meta honesty rule', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/prompts.ts'), 'utf8');
  assert.match(src, /NEVER say a[\s\S]{0,80}created \/ uploaded \/ launched/);
  assert.match(src, /returned its REAL id in THIS turn/);
  assert.match(src, /launch_managed_campaign[\s\S]{0,120}ONLY way to create ads/);
});
