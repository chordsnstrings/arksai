import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdCopy, gateCopyBatch } from '../src/agent/social/copyCheck';

// ---- Meta compliance bans ----
test('copyCheck: personal-attribute copy is a hard fail ("Are you diabetic?" class)', () => {
  assert.ok(checkAdCopy('Are you diabetic?', 'We can help you manage it.').hard.length >= 1);
  assert.ok(checkAdCopy('Struggling with debt?', 'Consolidate today.').hard.some((h) => /personal attribute/.test(h)));
  assert.ok(checkAdCopy('Tired of being overweight?', '').hard.length >= 1);
  // Third-person / service-framed copy is fine.
  assert.equal(checkAdCopy('Diabetes care that fits your day', 'Specialist clinic in Marina.').hard.length, 0);
  assert.equal(checkAdCopy('Debt consolidation, explained simply', '').hard.length, 0);
});

test('copyCheck: health verticals ban negative self-perception; others allow neutral use', () => {
  const bad = checkAdCopy('Fix your smile', 'No more feeling ashamed of your teeth.', { healthRules: true });
  assert.ok(bad.hard.some((h) => /self-perception/.test(h)));
  // Same words outside a health vertical don't trip the HEALTH rule (may trip others or none).
  const nonHealth = checkAdCopy('Ashamed of your lawn?', 'We fix gardens.', { healthRules: false });
  assert.ok(!nonHealth.hard.some((h) => /self-perception/.test(h)));
});

test('copyCheck: sensationalism is a hard fail', () => {
  assert.ok(checkAdCopy('You won\'t believe this miracle', 'Doctors hate it.').hard.length >= 1);
  assert.ok(checkAdCopy('100% guaranteed results', '').hard.length >= 1);
});

// ---- truthful scarcity: the load-bearing ethics rule ----
test('copyCheck: ungrounded urgency/scarcity is a hard fail in every form', () => {
  assert.ok(checkAdCopy('Offer ends soon!', 'Book now.').hard.some((h) => /no real deadline/.test(h)));
  assert.ok(checkAdCopy('Only 3 spots left', '').hard.some((h) => /no real count/.test(h)));
  assert.ok(checkAdCopy('Selling fast — limited edition', '').hard.some((h) => /nothing limited on record/.test(h)));
});

test('copyCheck: grounded facts allow matching claims — and only matching ones', () => {
  const facts = { offerEndsAt: Date.now() + 5 * 86_400_000, limitedCount: 6 };
  assert.equal(checkAdCopy('Offer ends soon', 'Real deadline.', facts).hard.length, 0);
  assert.equal(checkAdCopy('Only 6 spots left', '', facts).hard.length, 0);
  assert.equal(checkAdCopy('Only 4 spots left', '', facts).hard.length, 0); // ≤ real count is honest
  // Claiming MORE than the real count is a lie → hard.
  assert.ok(checkAdCopy('Only 20 spots left', '', facts).hard.some((h) => /must match the fact/.test(h)));
});

test('copyCheck: advisories nudge quality without blocking', () => {
  const v = checkAdCopy('Discover a better way', 'Take your business to the next level with our premium service offering today.');
  assert.equal(v.hard.length, 0);
  assert.ok(v.advisories.length >= 1);
});

// ---- the batch gate ----
test('gateCopyBatch: rewrites hard failures, counts them, drops a rewrite that still fails', () => {
  const items = [
    { headline: 'Great veg boxes', body: 'Fresh weekly.' },
    { headline: 'Only 99 left — hurry!', body: '' }, // ungrounded → rewrite
  ];
  const r = gateCopyBatch(items, {}, () => ({ headline: 'Fresh veg boxes, weekly', body: 'Delivered to you.' }));
  assert.equal(r.checksRun, 2);
  assert.equal(r.draftsRejected, 1);
  assert.equal(r.items.length, 2);
  assert.ok(r.items.every((i) => checkAdCopy(i.headline, i.body, {}).hard.length === 0));

  // A rewrite that ITSELF fails the gate → the line is dropped, never shipped.
  const stubborn = gateCopyBatch(
    [{ headline: 'Last chance!', body: '' }],
    {},
    () => ({ headline: 'Final hours — hurry!', body: '' }),
  );
  assert.equal(stubborn.items.length, 0);
  assert.equal(stubborn.draftsRejected, 1);
  assert.ok(stubborn.notes.some((n) => /dropped/.test(n)));
});

// ---- Review-fix locks: the scarcity lexicon covers realistic phrasings ----

test('scarcity gaps closed: generic nouns, weekdays, N-days-left all need grounding', async () => {
  const { checkAdCopy } = await import('../src/agent/social/copyCheck');
  // The doctrine's own canonical example + realistic variants — all hard-fail ungrounded.
  for (const line of [
    'Only 12 boxes left — order today.',
    'Only 3 rooms left at this rate. Book direct.',
    'Sale ends Monday — do not wait.',
    'Only 2 days left to claim your spot.',
    'Offer ends Jan 15 — book your slot.',
  ]) {
    assert.ok(checkAdCopy(line, 'Body.').hard.length >= 1, `should hard-fail ungrounded: "${line}"`);
  }
  // "Only 2 days left" is TIME urgency, not a count claim: a real end date grounds it fully.
  const timed = checkAdCopy('Only 2 days left to claim your spot.', 'Body.', { offerEndsAt: Date.now() + 86_400_000 });
  assert.equal(timed.hard.length, 0);
  // A real count grounds the generic-noun form, and the number must still match the fact.
  assert.equal(checkAdCopy('Only 12 boxes left.', 'Body.', { limitedCount: 12 }).hard.length, 0);
  assert.ok(checkAdCopy('Only 30 boxes left.', 'Body.', { limitedCount: 12 }).hard.length >= 1, 'overclaimed count still rejected');
});
