import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/agent/prompts';

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
