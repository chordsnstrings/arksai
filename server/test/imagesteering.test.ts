import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/agent/prompts';
import { expertiseFor } from '../src/agent/expertise';

// Locks the fix for the operator's "why is it SEARCHING, not generating?" bug: a chat
// image request must steer to generate_creative/generate_image and explicitly forbid
// web-searching for stock photos or switching to code to "build" the image.
const chatSession = { id: 's', mode: 'chat', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;

test('chat prompt steers image requests to GENERATE, never to a stock-photo search', () => {
  const p = buildSystemPrompt(chatSession, '/tmp', '');
  assert.match(p, /generate_creative/);
  assert.match(p, /generate_image/);
  // the prohibition that stops the "Searching Unsplash … stock photo" / switch-to-code path
  assert.match(p, /NEVER a search/);
  assert.match(p, /stock\/Unsplash|stock photos/i);
  assert.match(p, /do NOT web_search/i);
  // and the prohibition that stops "I don't have image tools → fall back to HTML/CSS"
  assert.match(p, /image generation tools/i);
  assert.match(p, /HTML\/CSS/);
  assert.match(p, /fix the (call|arguments)/i);
});

// Locks the operator's recurring "image generation isn't working on the platform" bug:
// the marketing persona must NOT give the model a CSS/SVG escape hatch (it was misreading a
// generation ERROR as "tool unavailable" and silently building an HTML/CSS graphic instead).
test('marketing persona forbids a CSS/SVG fallback and treats an error as RETRY, not unavailable', () => {
  const m = expertiseFor('marketing.creative')!;
  assert.match(m, /generate_creative/);
  // the escape hatch that caused the regression must be gone
  assert.doesNotMatch(m, /fall ?back to a (tasteful )?CSS\/SVG/i);
  // an error must mean fix-and-retry, never "unavailable", never a substitute graphic
  assert.match(m, /call it AGAIN/i);
  assert.match(m, /NOT mean the tool is unavailable/i);
  assert.match(m, /NEVER substitute an HTML\/CSS\/SVG graphic/i);
});

// PHASE 4 — when no expertise is injected and the ask is too thin, the chat agent asks ONE
// crisp clarifying question (never refuses, never blind-guesses); a clear ask still builds.
test('chat prompt carries the vague-clarify behavior (ask one question, never guess/refuse)', () => {
  const p = buildSystemPrompt(chatSession, '/tmp', '');
  // the dedicated section exists and frames clarify-then-build, not refuse/guess
  assert.match(p, /When the ask is vague, get the context FIRST/);
  assert.match(p, /don't guess blindly/i);
  // the Phase-4 reinforcement: exactly ONE question on a genuinely thin message,
  // and a clear subject is NOT treated as vague
  assert.match(p, /lead with exactly ONE warm, specific question/i);
  assert.match(p, /already\s+names a clear subject is NOT vague/i);
  // stays the expert — never the refusal path
  assert.doesNotMatch(p, /I can't help with that/i);
});
