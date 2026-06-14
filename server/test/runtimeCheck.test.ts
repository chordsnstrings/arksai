import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillParams } from '../src/agent/runtimeCheck';

test('fillParams: leaves param-free paths untouched', () => {
  assert.equal(fillParams('/api/todos'), '/api/todos');
  assert.equal(fillParams('/'), '/');
});

test('fillParams: fills Express :id with a numeric seed', () => {
  assert.equal(fillParams('/api/todos/:id'), '/api/todos/1');
  assert.equal(fillParams('/users/:userId/posts/:postId'), '/users/arksai-verify/posts/arksai-verify');
});

test('fillParams: :slug gets a slug seed', () => {
  assert.equal(fillParams('/posts/:slug'), '/posts/arksai-verify');
});

test('fillParams: brace and Flask/FastAPI param syntax', () => {
  assert.equal(fillParams('/items/{id}'), '/items/1');
  assert.equal(fillParams('/users/<int:id>'), '/users/1');
  assert.equal(fillParams('/p/<slug>'), '/p/arksai-verify');
});

test('fillParams: wildcard / catch-all routes are skipped', () => {
  assert.equal(fillParams('/files/*'), null);
  assert.equal(fillParams('/static/*path'), null);
});

test('fillParams: optional Express param', () => {
  assert.equal(fillParams('/search/:q?'), '/search/arksai-verify');
});
