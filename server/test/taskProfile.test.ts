import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask, suggestArchitecture } from '../src/agent/taskProfile';

test('classifyTask: visual deliverables are isVisual with the right type', () => {
  assert.equal(classifyTask('build a landing page for my startup', 'code').type, 'landing');
  assert.equal(classifyTask('build a landing page for my startup', 'code').isVisual, true);
  assert.equal(classifyTask('an analytics dashboard with charts', 'code').type, 'dashboard');
  assert.equal(classifyTask('a signup form with validation', 'code').type, 'form');
  assert.equal(classifyTask('my personal portfolio website', 'code').type, 'portfolio');
  assert.equal(classifyTask('a bar chart of monthly revenue', 'code').type, 'data-viz');
  assert.equal(classifyTask('a todo web app with react', 'code').type, 'web-app');
  assert.equal(classifyTask('a todo web app with react', 'code').isVisual, true);
});

test('classifyTask: report mode is always report + visual', () => {
  const p = classifyTask('summarize this data', 'report');
  assert.equal(p.type, 'report');
  assert.equal(p.isVisual, true);
});

test('classifyTask: backend/cli/library are NOT visual', () => {
  assert.equal(classifyTask('build a REST API for users', 'code').isVisual, false);
  assert.equal(classifyTask('a CLI tool to rename files', 'code').isVisual, false);
  assert.equal(classifyTask('publish an npm library for date math', 'code').isVisual, false);
  assert.equal(classifyTask('a cron worker that syncs records', 'code').type, 'api');
});

test('classifyTask: generic is visual only with explicit UI signals', () => {
  assert.equal(classifyTask('write a script to parse logs', 'code').isVisual, false);
  assert.equal(classifyTask('a beautiful UI in html and css', 'code').isVisual, true);
});

test('classifyTask: carries a complexity tier', () => {
  const heavy = classifyTask('architect a full-stack dashboard with auth and a database schema', 'code');
  assert.equal(heavy.tier, 'heavy');
});

// ─────────── Archetype router (Phase 3): brief → deterministic architecture pick ───────────
test('suggestArchitecture: multi-tenant SaaS → scaffold_app with orgs (+ crud)', () => {
  const t = 'Build a multi-tenant SaaS where teams sign up, invite members, and track projects on a dashboard';
  const s = suggestArchitecture(t, classifyTask(t, 'code'))!;
  assert.equal(s.base, 'scaffold_app');
  assert.ok(s.modules.includes('orgs') && s.modules.includes('crud') && s.modules.includes('dashboard'), s.modules.join(','));
  assert.match(s.line, /Multi-tenant SaaS/);
});

test('suggestArchitecture: a shop → scaffold_app + catalog; a clinic → booking', () => {
  const shop = 'An online store where customers browse products, add to cart and checkout, with order management';
  const s1 = suggestArchitecture(shop, classifyTask(shop, 'code'))!;
  assert.equal(s1.base, 'scaffold_app');
  assert.ok(s1.modules.includes('catalog'));

  const clinic = 'A clinic app where patients log in and book appointments in available time slots';
  const s2 = suggestArchitecture(clinic, classifyTask(clinic, 'code'))!;
  assert.equal(s2.base, 'scaffold_app');
  assert.ok(s2.modules.includes('booking'));
  assert.match(s2.line, /Booking/);
});

test('suggestArchitecture: static marketing site → create_web_app; report/cli → null', () => {
  const t = 'A landing page for our new coffee brand with a waitlist';
  const s = suggestArchitecture(t, classifyTask(t, 'code'))!;
  assert.equal(s.base, 'create_web_app');
  const cli = 'a cli tool to rename files';
  assert.equal(suggestArchitecture(cli, classifyTask(cli, 'code')), null);
});

test('suggestArchitecture: client-only interactive app without persistence → create_react_app', () => {
  const t = 'A mortgage calculator web app with sliders and charts, no accounts needed';
  const s = suggestArchitecture(t, classifyTask(t, 'code'))!;
  // "charts" alone shouldn't force a backend; it stays a client app.
  assert.equal(s.base, 'create_react_app');
});
