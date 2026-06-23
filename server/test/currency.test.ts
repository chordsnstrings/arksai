import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENCIES, DEFAULT_CURRENCY, convertFromUsd, currencyOf, formatMoney } from '../../shared/currency';

test('AED is the default and pegged at 3.6725', () => {
  assert.equal(DEFAULT_CURRENCY, 'AED');
  assert.equal(CURRENCIES.AED.rate, 3.6725);
  assert.equal(currencyOf().code, 'AED'); // no arg → default
  assert.equal(currencyOf('aed').code, 'AED'); // case-insensitive
});

test('unknown / empty currency falls back to the default', () => {
  assert.equal(currencyOf('XYZ').code, 'AED');
  assert.equal(currencyOf(null).code, 'AED');
  assert.equal(currencyOf('').code, 'AED');
});

test('convertFromUsd applies the peg', () => {
  assert.equal(convertFromUsd(1, 'AED'), 3.6725);
  assert.equal(convertFromUsd(2, 'USD'), 2);
  assert.equal(convertFromUsd(0, 'AED'), 0);
});

test('formatMoney converts + formats with the right symbol and decimals', () => {
  // $1 → AED 3.67
  assert.equal(formatMoney(1, 'AED'), 'AED 3.67');
  // USD keeps the tight $ symbol
  assert.equal(formatMoney(1, 'USD'), '$1.00');
  // sub-cent (in display currency) keeps 4 decimals — e.g. $0.001 → AED 0.0037
  assert.equal(formatMoney(0.001, 'AED'), 'AED 0.0037');
  // zero is plain
  assert.equal(formatMoney(0, 'AED'), 'AED 0.00');
});

test('SAR/QAR/BHD/OMR are present and pegged', () => {
  for (const c of ['SAR', 'QAR', 'BHD', 'OMR']) {
    assert.ok(CURRENCIES[c], `${c} should be supported`);
    assert.ok(CURRENCIES[c].rate > 0);
  }
});
