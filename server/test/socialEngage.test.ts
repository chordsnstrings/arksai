import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autonomyPolicy, autonomyEnumFromLevel, autonomyLevelOf, autonomyBand } from '../src/robots/autonomy';
import { metaAddr, parseMetaAddr, replyRequest } from '../src/robots/channels/meta';
import { parseMetaEntry } from '../src/routes/metaHooks';

// ---- autonomy slider ----
test('autonomy slider: bands gate the three tracks at 40/60/80', () => {
  const ask = autonomyPolicy(30);
  assert.equal(ask.autoReply, false);
  assert.equal(ask.autoPublish, false);
  assert.equal(ask.autoLaunch, false);
  assert.equal(ask.holdForApproval, true);
  assert.equal(ask.band, 'Ask first');

  const reply = autonomyPolicy(40);
  assert.equal(reply.autoReply, true);
  assert.equal(reply.autoPublish, false);
  assert.equal(reply.autoLaunch, false);
  assert.equal(reply.band, 'Auto-reply');

  const content = autonomyPolicy(60);
  assert.equal(content.autoReply, true);
  assert.equal(content.autoPublish, true);
  assert.equal(content.autoLaunch, false);

  const pilot = autonomyPolicy(85);
  assert.equal(pilot.autoReply, true);
  assert.equal(pilot.autoPublish, true);
  assert.equal(pilot.autoLaunch, true);
  assert.equal(pilot.band, 'Autopilot');

  // Invariant: negatives always escalate, at every level.
  for (const l of [0, 40, 60, 100]) assert.equal(autonomyPolicy(l).escalateNegative, true);
});

test('autonomy: clamps out-of-range + defaults', () => {
  assert.equal(autonomyPolicy(-10).level, 0);
  assert.equal(autonomyPolicy(999).level, 100);
  assert.equal(autonomyPolicy(NaN).level, 30); // clamp fallback
  assert.equal(autonomyLevelOf({ autonomyLevel: 72 }), 72);
  assert.equal(autonomyLevelOf({}), 30);
  assert.equal(autonomyLevelOf(undefined), 30);
  assert.equal(autonomyBand(88).label, 'Autopilot');
});

test('autonomy: slider → coarse reply-engine enum', () => {
  assert.equal(autonomyEnumFromLevel(0), 'shadow');
  assert.equal(autonomyEnumFromLevel(20), 'ask');
  assert.equal(autonomyEnumFromLevel(40), 'auto');
  assert.equal(autonomyEnumFromLevel(90), 'auto');
});

// ---- meta channel address + reply builders ----
test('meta channel: address round-trips and rejects malformed', () => {
  assert.equal(metaAddr('ig_c', '17895'), 'ig_c:17895');
  assert.deepEqual(parseMetaAddr('ig_c:17895'), { kind: 'ig_c', id: '17895' });
  assert.deepEqual(parseMetaAddr('fb_dm:PSID_1'), { kind: 'fb_dm', id: 'PSID_1' });
  assert.equal(parseMetaAddr('nope'), null);
  assert.equal(parseMetaAddr(''), null);
});

test('meta channel: reply request targets the right endpoint per surface', () => {
  assert.deepEqual(replyRequest({ kind: 'ig_c', id: 'C1' }, 'IG9', 'PG9', 'hi'), { url: 'C1/replies', body: { message: 'hi' } });
  assert.deepEqual(replyRequest({ kind: 'fb_c', id: 'C2' }, 'IG9', 'PG9', 'hi'), { url: 'C2/comments', body: { message: 'hi' } });
  const igdm = replyRequest({ kind: 'ig_dm', id: 'U3' }, 'IG9', 'PG9', 'hi');
  assert.equal(igdm.url, 'IG9/messages');
  assert.deepEqual(igdm.body, { recipient: { id: 'U3' }, message: { text: 'hi' } });
  const fbdm = replyRequest({ kind: 'fb_dm', id: 'U4' }, 'IG9', 'PG9', 'hi');
  assert.equal(fbdm.url, 'PG9/messages');
  assert.equal(fbdm.body.messaging_type, 'RESPONSE');
});

// ---- webhook parsing ----
test('meta webhook: parses FB comment, skips our own + removals', () => {
  const entry = {
    id: 'PAGE1',
    changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'CM1', message: 'love this', from: { id: 'USER1', name: 'Sara' }, created_time: 1_700_000_000 } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'CM2', message: 'from the page itself', from: { id: 'PAGE1', name: 'Brand' } } },
      { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'CM3', message: 'x', from: { id: 'USER2' } } },
      { field: 'feed', value: { item: 'reaction', verb: 'add' } },
    ],
  };
  const rows = parseMetaEntry('page', entry, new Set(['PAGE1']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'CM1');
  assert.equal(rows[0].from, 'fb_c:CM1');
  assert.equal(rows[0].fromName, 'Sara');
  assert.equal(rows[0].text, 'love this');
});

test('meta webhook: parses IG comment', () => {
  const entry = {
    id: 'IG1',
    changes: [{ field: 'comments', value: { id: 'IGC1', text: 'where to buy?', from: { id: 'IGUSER', username: 'buyer' }, media: { id: 'M1' } } }],
  };
  const rows = parseMetaEntry('instagram', entry, new Set(['IG1']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, 'ig_c:IGC1');
  assert.equal(rows[0].fromName, 'buyer');
});

test('meta webhook: parses a Facebook Messenger DM (reply → sender, dedup → mid)', () => {
  const entry = {
    id: 'PAGE1',
    messaging: [
      { sender: { id: 'PSID9' }, recipient: { id: 'PAGE1' }, timestamp: 1_700_000_000_000, message: { mid: 'MID1', text: 'do you deliver?' } },
      { sender: { id: 'PAGE1' }, recipient: { id: 'PSID9' }, message: { mid: 'MID2', text: 'our own echo', is_echo: true } }, // skip echoes
      { sender: { id: 'PSID8' }, recipient: { id: 'PAGE1' }, message: { mid: 'MID3' } }, // no text (receipt) → skip
    ],
  };
  const rows = parseMetaEntry('page', entry, new Set(['PAGE1']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'MID1'); // dedup on the message id
  assert.equal(rows[0].from, 'fb_dm:PSID9'); // reply goes to the sender
  assert.equal(rows[0].text, 'do you deliver?');
});

test('meta webhook: parses an Instagram Direct message', () => {
  const entry = {
    id: 'IG1',
    messaging: [{ sender: { id: 'IGSID7' }, recipient: { id: 'IG1' }, timestamp: 1_700_000_000_000, message: { mid: 'IGMID1', text: 'is this in stock?' } }],
  };
  const rows = parseMetaEntry('instagram', entry, new Set(['IG1']));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, 'ig_dm:IGSID7');
  assert.equal(rows[0].id, 'IGMID1');
});
