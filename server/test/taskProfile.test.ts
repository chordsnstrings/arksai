import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask } from '../src/agent/taskProfile';

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
