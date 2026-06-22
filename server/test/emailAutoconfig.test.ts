import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainOf, presetFromMx, parseAutoconfigXml, detectEmailConfig } from '../src/email/autoconfig';

test('domainOf extracts a valid lowercased domain', () => {
  assert.equal(domainOf('Jane@Example.COM'), 'example.com');
  assert.equal(domainOf('a@sub.domain.co.uk'), 'sub.domain.co.uk');
  assert.equal(domainOf('not-an-email'), null);
  assert.equal(domainOf('a@localhost'), null);
  assert.equal(domainOf('a@bad_domain.com'), null);
});

test('presetFromMx maps Workspace / M365 / others by exchange host', () => {
  assert.equal(presetFromMx(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']), 'google');
  assert.equal(presetFromMx(['acme-com.mail.protection.outlook.com']), 'm365');
  assert.equal(presetFromMx(['mx.zoho.com']), 'zoho');
  assert.equal(presetFromMx(['smtp.secureserver.net']), 'godaddy');
  assert.equal(presetFromMx(['in1-smtp.messagingengine.com']), 'fastmail');
  assert.equal(presetFromMx(['mail.some-unknown-host.net']), null);
});

test('parseAutoconfigXml reads incoming(imap) + outgoing(smtp) servers', () => {
  const xml = `<clientConfig><emailProvider domain="x.com">
    <incomingServer type="imap"><hostname>imap.x.com</hostname><port>993</port><socketType>SSL</socketType></incomingServer>
    <incomingServer type="pop3"><hostname>pop.x.com</hostname><port>995</port><socketType>SSL</socketType></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.x.com</hostname><port>587</port><socketType>STARTTLS</socketType></outgoingServer>
  </emailProvider></clientConfig>`;
  const cfg = parseAutoconfigXml(xml);
  assert.ok(cfg);
  assert.equal(cfg!.imapHost, 'imap.x.com');
  assert.equal(cfg!.imapPort, 993);
  assert.equal(cfg!.imapSecure, true);
  assert.equal(cfg!.smtpHost, 'smtp.x.com');
  assert.equal(cfg!.smtpPort, 587);
  assert.equal(cfg!.smtpSecure, false); // STARTTLS → not implicit-TLS
  assert.equal(cfg!.source, 'autoconfig');
});

test('parseAutoconfigXml returns null when a server is missing', () => {
  assert.equal(parseAutoconfigXml('<clientConfig></clientConfig>'), null);
});

test('detectEmailConfig resolves a built-in domain with no network', async () => {
  const cfg = await detectEmailConfig('someone@gmail.com');
  assert.ok(cfg);
  assert.equal(cfg!.imapHost, 'imap.gmail.com');
  assert.equal(cfg!.smtpHost, 'smtp.gmail.com');
  assert.equal(cfg!.imapSecure, true);
  assert.equal(cfg!.source, 'builtin:google');
});

test('detectEmailConfig returns null for an invalid address', async () => {
  assert.equal(await detectEmailConfig('nope'), null);
});
