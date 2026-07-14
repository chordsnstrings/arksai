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

// ---- Multi-account targeting: list_ad_accounts + name/id resolution + honest errors ----

test('list_ad_accounts is registered for chat/code/report (agent can discover every account)', () => {
  for (const mode of ['chat', 'code'] as const) assert.ok(registered('list_ad_accounts', mode), `list_ad_accounts in ${mode}`);
  assert.ok(ALL_TOOLS.some((t) => t.name === 'list_ad_accounts'), 'list_ad_accounts registered');
});

test('fetch_ads accepts an account by NAME or id, and its error lists real accounts (never "reconnect")', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/tools/ads.ts'), 'utf8');
  // Resolution matches by exact id OR account name (fuzzy).
  assert.match(src, /accountId\.toLowerCase\(\) === q/);
  assert.match(src, /accountName ?\?\?? ''\)\.toLowerCase\(\)\.includes\(q\)/);
  // A no-match-among-connected error lists the real accounts and forbids the reconnect lie.
  assert.match(src, /These \$\{provider\} accounts ARE connected/);
  assert.match(src, /Do NOT tell the user to reconnect/);
  // list_ad_accounts reads the store (never guesses) and shows ids.
  assert.match(src, /listAdAccountsTool/);
  assert.match(src, /id \$\{c\.accountId\}/);
});

test('prompt steers list-then-target and forbids the reconnect lie for connected accounts', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/prompts.ts'), 'utf8');
  assert.match(src, /call\s+\*\*list_ad_accounts\*\*\s+FIRST/);
  assert.match(src, /NEVER tell the user to reconnect[\s\S]{0,80}when list_ad_accounts already returns them/);
});
