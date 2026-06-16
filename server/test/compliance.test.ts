import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import {
  buildWpsSif,
  buildFaf,
  buildEInvoicePintAe,
  xmlWellFormed,
  generateComplianceFileTool,
} from '../src/agent/tools/compliance';
import { expertiseFor } from '../src/agent/expertise';
import { TAX_TASKS } from '../src/agent/compliance/uae';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-compliance-'));
const ctx = (): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

const goodEmployee = (over: Partial<any> = {}) => ({
  labourId: '12345678901234',
  routingCode: '123456789',
  iban: 'AE070331234567890123456',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  days: 30,
  fixedAmount: 8000,
  variableAmount: 500,
  ...over,
});

// ---------- WPS SIF ----------

test('wps_sif: builds a valid file, control total = Σ EDR, correct 25-char filename', () => {
  const r = buildWpsSif({
    employerId: '1234567890123',
    bankRoutingCode: '987654321',
    salaryMonth: '062026',
    creationDate: '2026-07-02',
    creationTime: '09:30:15',
    employees: [goodEmployee(), goodEmployee({ labourId: '99999999999999', fixedAmount: 6000, variableAmount: 0 })],
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  // total = (8000+500) + (6000+0) = 14500.00
  assert.match(r.content, /^SCR,1234567890123,987654321,2026-07-02,0930,062026,2,14500\.00,AED/);
  assert.equal(r.content.split('\r\n').filter((l) => l.startsWith('EDR')).length, 2);
  assert.equal(r.filename, '1234567890123' + '260702' + '093015' + '.sif');
  assert.equal(r.filename.length, 13 + 6 + 6 + 4);
  // amounts use a decimal point and no thousands separator (the 14500 total is "14500.00", never "14,500.00")
  assert.ok(!r.content.includes('14,500'));
});

test('wps_sif: rejects a control-total mismatch (declaredTotal ≠ Σ EDR)', () => {
  const r = buildWpsSif({
    employerId: '1234567890123',
    bankRoutingCode: '987654321',
    salaryMonth: '062026',
    declaredTotal: 99999,
    employees: [goodEmployee()],
  });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => /reconcile|match/i.test(e)));
});

test('wps_sif: rejects a bad IBAN, short labourId and bad employerId', () => {
  const r = buildWpsSif({
    employerId: '123', // too short
    bankRoutingCode: '987654321',
    salaryMonth: '062026',
    employees: [goodEmployee({ iban: 'AE12', labourId: '123' })],
  });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => /employerId/i.test(e)));
  assert.ok(r.errors.some((e) => /IBAN/i.test(e)));
  assert.ok(r.errors.some((e) => /labourId/i.test(e)));
});

// ---------- FAF ----------

test('faf: emits company/supply/purchase/footer and reconciles to declared VAT', () => {
  const r = buildFaf({
    company: { name: 'Acme FZ LLC', trn: '100200300400500', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
    supplies: [{ date: '2026-04-10', invoiceNo: 'INV-1', name: 'Cust A', trn: '111222333444555', netAmount: 1000, vatAmount: 50 }],
    purchases: [{ date: '2026-04-12', invoiceNo: 'BILL-1', name: 'Supp B', netAmount: 400, vatAmount: 20 }],
    declaredOutputVat: 50,
    declaredInputVat: 20,
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.match(r.content, /^C,Acme FZ LLC,100200300400500/);
  assert.match(r.content, /\nS,2026-04-10,INV-1,Cust A,111222333444555,1000\.00,50\.00/);
  assert.match(r.content, /\nP,2026-04-12,BILL-1,Supp B,,400\.00,20\.00/);
  assert.match(r.content, /\nF,Totals,1,1000\.00,50\.00,1,400\.00,20\.00/);
});

test('faf: rejects a non-reconciling declared output VAT and a bad TRN', () => {
  const r = buildFaf({
    company: { name: 'Acme', trn: 'bad', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
    supplies: [{ date: '2026-04-10', invoiceNo: 'INV-1', name: 'Cust A', netAmount: 1000, vatAmount: 50 }],
    purchases: [],
    declaredOutputVat: 999,
  });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => /TRN/i.test(e)));
  assert.ok(r.errors.some((e) => /reconcile/i.test(e)));
});

// ---------- PINT AE e-invoice ----------

test('einvoice_pint_ae: well-formed UBL, 15-digit TRNs, scheme 0235, totals reconcile', () => {
  const r = buildEInvoicePintAe({
    invoiceNumber: 'INV-2026-001',
    issueDate: '2026-07-01',
    typeCode: '380',
    seller: { name: 'Seller LLC', trn: '100000000000001', city: 'Dubai' },
    buyer: { name: 'Buyer LLC', trn: '200000000000002', city: 'Abu Dhabi' },
    lines: [
      { name: 'Consulting', quantity: 10, unitPrice: 100, vatCategory: 'S', vatRate: 5 },
      { name: 'Exported goods', quantity: 1, unitPrice: 500, vatCategory: 'Z', vatRate: 0 },
    ],
  });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.ok(xmlWellFormed(r.content));
  assert.match(r.content, /schemeID="0235">100000000000001/);
  assert.match(r.content, /<cbc:CompanyID>200000000000002<\/cbc:CompanyID>/);
  // net = 10*100 + 500 = 1500; VAT = 1000*0.05 = 50; gross = 1550
  assert.match(r.content, /<cbc:LineExtensionAmount currencyID="AED">1500\.00<\/cbc:LineExtensionAmount>/);
  assert.match(r.content, /<cbc:TaxAmount currencyID="AED">50\.00<\/cbc:TaxAmount>/);
  assert.match(r.content, /<cbc:PayableAmount currencyID="AED">1550\.00<\/cbc:PayableAmount>/);
  assert.match(r.content, /<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1<\/cbc:CustomizationID>/);
});

test('einvoice_pint_ae: credit note uses the CreditNote root and requires a preceding ref', () => {
  const missing = buildEInvoicePintAe({
    invoiceNumber: 'CN-1', issueDate: '2026-07-01', typeCode: '381',
    seller: { name: 'S', trn: '100000000000001' }, buyer: { name: 'B', trn: '200000000000002' },
    lines: [{ name: 'Refund', quantity: 1, unitPrice: 100, vatCategory: 'S', vatRate: 5 }],
  });
  assert.ok(!missing.ok);
  const ok = buildEInvoicePintAe({
    invoiceNumber: 'CN-1', issueDate: '2026-07-01', typeCode: '381', precedingInvoiceRef: 'INV-2026-001',
    seller: { name: 'S', trn: '100000000000001' }, buyer: { name: 'B', trn: '200000000000002' },
    lines: [{ name: 'Refund', quantity: 1, unitPrice: 100, vatCategory: 'S', vatRate: 5 }],
  });
  assert.ok(ok.ok, JSON.stringify(ok));
  if (!ok.ok) return;
  assert.match(ok.content, /<CreditNote /);
  assert.match(ok.content, /<cac:CreditNoteLine>/);
  assert.match(ok.content, /<cbc:CreditNoteTypeCode>381<\/cbc:CreditNoteTypeCode>/);
  assert.ok(xmlWellFormed(ok.content));
});

test('einvoice_pint_ae: rejects a bad VAT category, missing buyer TRN (non-simplified), bad seller TRN', () => {
  const r = buildEInvoicePintAe({
    invoiceNumber: 'INV-X', issueDate: '2026-07-01',
    seller: { name: 'S', trn: '999' },
    buyer: { name: 'B' },
    lines: [{ name: 'x', quantity: 1, unitPrice: 100, vatCategory: 'X' as any, vatRate: 5 }],
  });
  assert.ok(!r.ok);
  if (r.ok) return;
  assert.ok(r.errors.some((e) => /seller\.trn/i.test(e)));
  assert.ok(r.errors.some((e) => /buyer\.trn/i.test(e)));
  assert.ok(r.errors.some((e) => /vatCategory/i.test(e)));
});

test('einvoice_pint_ae: a simplified invoice allows an omitted buyer TRN', () => {
  const r = buildEInvoicePintAe({
    invoiceNumber: 'SIMP-1', issueDate: '2026-07-01', simplified: true,
    seller: { name: 'S', trn: '100000000000001' }, buyer: { name: 'Walk-in customer' },
    lines: [{ name: 'Coffee', quantity: 2, unitPrice: 15, vatCategory: 'S', vatRate: 5 }],
  });
  assert.ok(r.ok, JSON.stringify(r));
});

// ---------- well-formedness helper ----------

test('xmlWellFormed: detects balanced vs unbalanced tags', () => {
  assert.ok(xmlWellFormed('<a><b/></a>'));
  assert.ok(xmlWellFormed('<?xml version="1.0"?>\n<a x="1"><b>text</b></a>'));
  assert.ok(!xmlWellFormed('<a><b></a>'));
  assert.ok(!xmlWellFormed('<a></b>'));
});

// ---------- the tool (integration) ----------

test('generate_compliance_file: writes a validated .sif into the workspace', async () => {
  const out = await generateComplianceFileTool.run(
    {
      kind: 'wps_sif',
      employerId: '1234567890123',
      bankRoutingCode: '987654321',
      salaryMonth: '062026',
      employees: [goodEmployee()],
    },
    ctx(),
  );
  assert.match(out, /Generated .+\.sif/);
  assert.match(out, /validated/i);
  assert.match(out, /EmaraTax|agent bank/i);
  const files = fs.readdirSync(ws).filter((f) => f.endsWith('.sif'));
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(ws, files[0]), 'utf8'), /^SCR,1234567890123/);
});

test('generate_compliance_file: returns the validation errors and writes nothing on a bad invoice', async () => {
  const before = fs.readdirSync(ws).filter((f) => f.endsWith('.xml')).length;
  const out = await generateComplianceFileTool.run(
    { kind: 'einvoice_pint_ae', invoiceNumber: 'INV-Y', issueDate: 'nope', seller: { name: 'S', trn: '1' }, buyer: { name: 'B' }, lines: [] },
    ctx(),
  );
  assert.match(out, /Validation failed/i);
  assert.match(out, /never fabricate/i);
  const after = fs.readdirSync(ws).filter((f) => f.endsWith('.xml')).length;
  assert.equal(after, before); // nothing written
});

// ---------- expertise wiring ----------

test('expertiseFor: every tax.* play key resolves with UAE specifics + guardrails', () => {
  for (const key of Object.keys(TAX_TASKS)) {
    const e = expertiseFor(key);
    assert.ok(e, `expertiseFor(${key}) should resolve`);
    assert.match(e!, /EmaraTax|ASP|agent bank|FTA|MOHRE/);
    assert.match(e!, /not tax or legal advice/i);
  }
});

test('expertiseFor: VAT return carries the box structure, WPS carries the SCR/EDR rules', () => {
  assert.match(expertiseFor('tax.vat_return')!, /Box 1|Emirate/);
  assert.match(expertiseFor('tax.vat_return')!, /FAF/);
  assert.match(expertiseFor('tax.wps')!, /SCR|EDR|IBAN/);
  assert.match(expertiseFor('tax.einvoice')!, /PINT AE|UBL|0235/);
  assert.match(expertiseFor('tax.ct_return')!, /375,000|9%/);
});
