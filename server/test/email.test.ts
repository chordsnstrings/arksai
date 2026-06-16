import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailDomain, isFreeEmailDomain } from '../../shared/types';

test('emailDomain extracts the lowercased domain', () => {
  assert.equal(emailDomain('Jane@Acme.COM'), 'acme.com');
  assert.equal(emailDomain('  ceo@Stripe.com '), 'stripe.com');
  assert.equal(emailDomain('not-an-email'), '');
});

test('isFreeEmailDomain flags consumer providers', () => {
  for (const e of ['x@gmail.com', 'x@googlemail.com', 'x@outlook.com', 'x@yahoo.co.uk', 'x@icloud.com', 'x@proton.me', 'x@hotmail.com', 'x@aol.com']) {
    assert.ok(isFreeEmailDomain(e), `${e} should be flagged as free`);
  }
});

test('isFreeEmailDomain allows corporate domains', () => {
  for (const e of ['jane@acme.com', 'ceo@stripe.com', 'ops@gicbd.com', 'a@some-company.io']) {
    assert.ok(!isFreeEmailDomain(e), `${e} should be allowed`);
  }
});
