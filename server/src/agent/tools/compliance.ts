import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * UAE compliance file generator — emits the three FORMAT-STRICT machine files a
 * UAE finance team must hand to a system/authority, and (like generate_spreadsheet
 * / generate_pptx) self-validates so it returns ERRORS instead of a bad file:
 *   - wps_sif         → the MOHRE WPS Salary Information File (.sif)
 *   - faf             → the FTA VAT Audit File (FAF) CSV
 *   - einvoice_pint_ae→ the UBL 2.1 / PINT AE e-invoice XML
 *
 * The readable invoice + the VAT-201/CT/Excise/payroll-reconciliation working
 * papers are produced with generate_doc / generate_spreadsheet / render_report —
 * this tool only owns the strict machine formats. Validation here mirrors the
 * agent-bank / FTA / ASP validator as far as is possible without their schema;
 * every result carries a "verify against the official schema before live
 * submission" note.
 */

export interface BuildOk {
  ok: true;
  content: string;
  filename: string;
  summary: string;
  warnings: string[];
}
export interface BuildErr {
  ok: false;
  errors: string[];
}
export type BuildResult = BuildOk | BuildErr;

// ---------- shared helpers ----------

/** AED amount → fixed 2dp, NO thousands separators (commas break the validators). */
function money(n: any): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2) : 'NaN';
}
function isAmount(n: any): boolean {
  return Number.isFinite(Number(n)) && !String(n).includes(',');
}
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
/** Parse "YYYY-MM-DD" / Date / now → a Date (UTC-safe enough for filenames). */
function asDate(v: any): Date {
  if (v instanceof Date) return v;
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s + (s.length === 10 ? 'T00:00:00Z' : ''));
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

// ---------- WPS SIF ----------

export interface WpsEmployee {
  labourId: string; // 14-digit MOL personal / labour-card number
  routingCode: string; // 9-digit agent/bank routing code
  iban: string; // 23-char IBAN, "AE" + 21 digits
  startDate: string; // pay-period start, YYYY-MM-DD
  endDate: string; // pay-period end, YYYY-MM-DD
  days?: number;
  fixedAmount: number; // AED
  variableAmount?: number; // AED
  ref?: string;
}
export interface WpsArgs {
  employerId: string; // 13-digit establishment ID
  bankRoutingCode: string; // 9-digit SCR routing code
  salaryMonth: string; // MMYYYY
  currency?: string; // default AED
  creationDate?: string; // optional; default now
  creationTime?: string; // optional HH:MM[:SS]; default now
  employees: WpsEmployee[];
  declaredTotal?: number; // optional cross-check
}

const LINE = '\r\n'; // WPS files are Windows-oriented

export function buildWpsSif(args: WpsArgs): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const employerId = String(args.employerId ?? '').trim();
  const routing = String(args.bankRoutingCode ?? '').trim();
  const month = String(args.salaryMonth ?? '').trim();
  const currency = String(args.currency ?? 'AED').trim().toUpperCase();
  const emps = Array.isArray(args.employees) ? args.employees : [];

  if (!/^\d{13}$/.test(employerId)) errors.push(`employerId must be exactly 13 digits (got "${employerId}").`);
  if (!/^\d{9}$/.test(routing)) errors.push(`bankRoutingCode must be exactly 9 digits (got "${routing}").`);
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(month)) errors.push(`salaryMonth must be MMYYYY (got "${month}").`);
  if (currency !== 'AED') warnings.push(`currency is "${currency}"; WPS salaries are paid in AED — confirm with your agent bank.`);
  if (!emps.length) errors.push('At least one employee (EDR) is required.');

  let total = 0;
  emps.forEach((e, i) => {
    const tag = `employee #${i + 1}${e?.labourId ? ` (${e.labourId})` : ''}`;
    if (!/^\d{14}$/.test(String(e?.labourId ?? ''))) errors.push(`${tag}: labourId must be 14 digits.`);
    if (!/^\d{9}$/.test(String(e?.routingCode ?? ''))) errors.push(`${tag}: routingCode must be 9 digits.`);
    if (!/^AE\d{21}$/.test(String(e?.iban ?? '').replace(/\s/g, '').toUpperCase()))
      errors.push(`${tag}: IBAN must be "AE" + 21 digits (23 chars).`);
    if (!isAmount(e?.fixedAmount)) errors.push(`${tag}: fixedAmount must be a number with no commas.`);
    if (e?.variableAmount != null && !isAmount(e.variableAmount)) errors.push(`${tag}: variableAmount must be a number with no commas.`);
    if (e?.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.startDate))) warnings.push(`${tag}: startDate should be YYYY-MM-DD.`);
    if (e?.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.endDate))) warnings.push(`${tag}: endDate should be YYYY-MM-DD.`);
    total += Number(e?.fixedAmount || 0) + Number(e?.variableAmount || 0);
  });
  total = Math.round(total * 100) / 100;

  if (args.declaredTotal != null && Math.abs(Number(args.declaredTotal) - total) > 0.005)
    errors.push(`declaredTotal ${money(args.declaredTotal)} does not match the sum of EDR amounts ${money(total)} (must reconcile to the fils).`);

  if (errors.length) return { ok: false, errors };

  const created = asDate(args.creationDate);
  if (args.creationTime && /^\d{1,2}:\d{2}/.test(args.creationTime)) {
    const [hh, mm, ss] = args.creationTime.split(':');
    created.setUTCHours(Number(hh) || 0, Number(mm) || 0, Number(ss) || 0, 0);
  }
  const yy = String(created.getUTCFullYear()).slice(-2);
  const fdate = `${yy}${pad2(created.getUTCMonth() + 1)}${pad2(created.getUTCDate())}`;
  const ftime = `${pad2(created.getUTCHours())}${pad2(created.getUTCMinutes())}${pad2(created.getUTCSeconds())}`;
  const scrDate = `${created.getUTCFullYear()}-${pad2(created.getUTCMonth() + 1)}-${pad2(created.getUTCDate())}`;
  const scrTime = `${pad2(created.getUTCHours())}${pad2(created.getUTCMinutes())}`;

  const scr = ['SCR', employerId, routing, scrDate, scrTime, month, String(emps.length), money(total), currency].join(',');
  const edrs = emps.map((e) =>
    [
      'EDR',
      String(e.labourId),
      String(e.routingCode),
      String(e.iban).replace(/\s/g, '').toUpperCase(),
      String(e.startDate ?? ''),
      String(e.endDate ?? ''),
      String(e.days ?? ''),
      money(e.fixedAmount),
      money(e.variableAmount ?? 0),
      String(e.ref ?? '').replace(/[\r\n,]/g, ' '),
    ].join(','),
  );
  const content = [scr, ...edrs].join(LINE) + LINE;
  const filename = `${employerId}${fdate}${ftime}.sif`;
  warnings.push('The exact SIF column order varies by agent bank/free zone — confirm the layout with your WPS agent bank before upload. DIFC/ADGM use their own systems.');
  return {
    ok: true,
    content,
    filename,
    warnings,
    summary: `${emps.length} employee record(s), control total AED ${money(total)} (= Σ EDR, reconciled). Filename ${filename}.`,
  };
}

// ---------- FAF (FTA VAT Audit File) ----------

export interface FafTxn {
  date: string;
  invoiceNo: string;
  name: string; // customer (supplies) / supplier (purchases)
  trn?: string;
  netAmount: number;
  vatAmount: number;
}
export interface FafArgs {
  company: { name: string; trn: string; taxAgencyName?: string; tan?: string; taxAgentName?: string; taan?: string; periodStart: string; periodEnd: string };
  supplies: FafTxn[];
  purchases: FafTxn[];
  declaredOutputVat?: number; // reconcile to VAT 201 Box 8
  declaredInputVat?: number; // reconcile to VAT 201 Box 11
}

function csvField(v: any): string {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(cells: any[]): string {
  return cells.map(csvField).join(',');
}

export function buildFaf(args: FafArgs): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const c = args.company || ({} as FafArgs['company']);
  const supplies = Array.isArray(args.supplies) ? args.supplies : [];
  const purchases = Array.isArray(args.purchases) ? args.purchases : [];

  if (!c.name) errors.push('company.name is required.');
  if (!/^\d{15}$/.test(String(c.trn ?? ''))) errors.push(`company.trn must be a 15-digit TRN (got "${c.trn}").`);
  if (!c.periodStart || !c.periodEnd) errors.push('company.periodStart and company.periodEnd are required.');
  if (!supplies.length && !purchases.length) errors.push('Provide at least one supply or purchase record.');

  const checkTxns = (rows: FafTxn[], kind: string) =>
    rows.forEach((r, i) => {
      if (r?.trn && !/^\d{15}$/.test(String(r.trn))) warnings.push(`${kind} #${i + 1}: TRN "${r.trn}" is not 15 digits.`);
      if (!isAmount(r?.netAmount)) errors.push(`${kind} #${i + 1}: netAmount must be a number with no commas.`);
      if (!isAmount(r?.vatAmount)) errors.push(`${kind} #${i + 1}: vatAmount must be a number with no commas.`);
    });
  checkTxns(supplies, 'supply');
  checkTxns(purchases, 'purchase');

  const sum = (rows: FafTxn[], k: keyof FafTxn) => Math.round(rows.reduce((t, r) => t + Number((r as any)[k] || 0), 0) * 100) / 100;
  const outVat = sum(supplies, 'vatAmount');
  const inVat = sum(purchases, 'vatAmount');
  const outNet = sum(supplies, 'netAmount');
  const inNet = sum(purchases, 'netAmount');

  if (args.declaredOutputVat != null && Math.abs(Number(args.declaredOutputVat) - outVat) > 0.01)
    errors.push(`FAF output VAT ${money(outVat)} does not reconcile to the VAT 201 Box 8 output VAT ${money(args.declaredOutputVat)}.`);
  if (args.declaredInputVat != null && Math.abs(Number(args.declaredInputVat) - inVat) > 0.01)
    errors.push(`FAF input VAT ${money(inVat)} does not reconcile to the VAT 201 Box 11 input VAT ${money(args.declaredInputVat)}.`);

  if (errors.length) return { ok: false, errors };

  const lines: string[] = [];
  // Company block (record type "C")
  lines.push(csvRow(['C', c.name, c.trn, c.taxAgencyName ?? '', c.tan ?? '', c.taxAgentName ?? '', c.taan ?? '', c.periodStart, c.periodEnd, new Date().toISOString().slice(0, 10), 'ArksAI-1.0', String(supplies.length), String(purchases.length)]));
  // Supplies header + rows (record type "S")
  lines.push(csvRow(['S', 'TransactionDate', 'InvoiceNo', 'CustomerName', 'CustomerTRN', 'NetAmount', 'VATAmount']));
  for (const r of supplies) lines.push(csvRow(['S', r.date, r.invoiceNo, r.name, r.trn ?? '', money(r.netAmount), money(r.vatAmount)]));
  // Purchases header + rows (record type "P")
  lines.push(csvRow(['P', 'TransactionDate', 'InvoiceNo', 'SupplierName', 'SupplierTRN', 'NetAmount', 'VATAmount']));
  for (const r of purchases) lines.push(csvRow(['P', r.date, r.invoiceNo, r.name, r.trn ?? '', money(r.netAmount), money(r.vatAmount)]));
  // Footer totals (record type "F")
  lines.push(csvRow(['F', 'Totals', String(supplies.length), money(outNet), money(outVat), String(purchases.length), money(inNet), money(inVat)]));

  warnings.push('This follows the documented FAF block layout — validate against the CURRENT FTA FAF specification (field order can change) before submission.');
  return {
    ok: true,
    content: lines.join('\r\n') + '\r\n',
    filename: `FAF_${String(c.trn)}_${String(c.periodStart)}_${String(c.periodEnd)}.csv`,
    warnings,
    summary: `${supplies.length} supply + ${purchases.length} purchase rows; output VAT AED ${money(outVat)}, input VAT AED ${money(inVat)} (reconciled).`,
  };
}

// ---------- PINT AE e-invoice (UBL 2.1) ----------

const VAT_CATEGORIES = new Set(['S', 'Z', 'E', 'AE', 'O', 'G']);
const INVOICE_TYPE_CODES = new Set(['380', '381', '383', '386', '388', '389']); // tax, credit, debit, prepayment, tax(self), self-billed

export interface EInvoiceLine {
  name: string;
  quantity: number;
  unitPrice: number; // AED, net
  unit?: string; // UN/ECE Rec 20 code, default C62
  vatCategory: string; // S|Z|E|AE|O|G
  vatRate: number; // percent, e.g. 5
}
export interface EInvoiceParty {
  name: string;
  trn?: string; // 15-digit
  countryCode?: string; // default AE
  address?: string;
  city?: string;
}
export interface EInvoiceArgs {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  typeCode?: string; // default 380
  simplified?: boolean; // simplified tax invoice → buyer TRN optional
  currency?: string; // default AED
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  lines: EInvoiceLine[];
  precedingInvoiceRef?: string; // required for credit/debit notes
  note?: string;
}

function xmlEsc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Lightweight well-formedness check (tag balance) over generated XML. */
export function xmlWellFormed(xml: string): boolean {
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(xml))) {
    // anything between the last tag and this one that contains a stray '<' or unbalanced is ignored;
    // we only validate element nesting here.
    idx = m.index;
    const closing = m[1] === '/';
    const name = m[2];
    const selfClose = m[4] === '/';
    if (closing) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  void idx;
  return stack.length === 0;
}

export function buildEInvoicePintAe(args: EInvoiceArgs): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const typeCode = String(args.typeCode ?? '380');
  const currency = String(args.currency ?? 'AED').toUpperCase();
  const lines = Array.isArray(args.lines) ? args.lines : [];
  const seller = args.seller || ({} as EInvoiceParty);
  const buyer = args.buyer || ({} as EInvoiceParty);

  if (!args.invoiceNumber) errors.push('invoiceNumber is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.issueDate ?? ''))) errors.push('issueDate must be YYYY-MM-DD.');
  if (!INVOICE_TYPE_CODES.has(typeCode)) errors.push(`typeCode "${typeCode}" is not a supported UBL invoice type (380 tax, 381 credit, 383 debit, 386 prepayment, 388, 389 self-billed).`);
  if (currency !== 'AED') warnings.push(`currency is "${currency}" — UAE invoices are in AED; include the AED equivalent + FTA rate if a foreign currency is used.`);
  if (!seller.name) errors.push('seller.name is required.');
  if (!/^\d{15}$/.test(String(seller.trn ?? ''))) errors.push(`seller.trn must be a 15-digit TRN (got "${seller.trn}").`);
  if (!buyer.name) errors.push('buyer.name is required.');
  const buyerTrnOk = /^\d{15}$/.test(String(buyer.trn ?? ''));
  if (!buyerTrnOk) {
    if (args.simplified) warnings.push('Simplified invoice: buyer TRN omitted (allowed for B2C / supply < AED 10,000).');
    else errors.push(`buyer.trn must be a 15-digit TRN for a full tax invoice (got "${buyer.trn}"). Set simplified:true for a B2C/simplified invoice.`);
  }
  if ((typeCode === '381' || typeCode === '383') && !args.precedingInvoiceRef)
    errors.push('A credit (381) / debit (383) note must reference the original invoice via precedingInvoiceRef.');
  if (!lines.length) errors.push('At least one invoice line is required.');

  // line math + per-category breakdown
  interface Cat { taxable: number; tax: number; rate: number }
  const cats = new Map<string, Cat>();
  let sumLineNet = 0;
  const lineRows: { id: number; net: number; line: EInvoiceLine }[] = [];
  lines.forEach((l, i) => {
    const tag = `line #${i + 1}`;
    const cat = String(l?.vatCategory ?? '').toUpperCase();
    if (!VAT_CATEGORIES.has(cat)) errors.push(`${tag}: vatCategory must be one of S, Z, E, AE, O, G (got "${l?.vatCategory}").`);
    if (!Number.isFinite(Number(l?.quantity))) errors.push(`${tag}: quantity must be a number.`);
    if (!Number.isFinite(Number(l?.unitPrice))) errors.push(`${tag}: unitPrice must be a number.`);
    const rate = Number(l?.vatRate ?? 0);
    if (cat === 'S' && !(rate > 0)) errors.push(`${tag}: a standard-rated (S) line must have a VAT rate > 0 (usually 5).`);
    if (cat !== 'S' && rate !== 0) warnings.push(`${tag}: category ${cat} normally carries a 0% rate.`);
    const net = Math.round(Number(l?.quantity || 0) * Number(l?.unitPrice || 0) * 100) / 100;
    sumLineNet += net;
    const tax = cat === 'S' ? Math.round(net * (rate / 100) * 100) / 100 : 0;
    const key = `${cat}@${rate}`;
    const prev = cats.get(key) || { taxable: 0, tax: 0, rate };
    prev.taxable += net;
    prev.tax += tax;
    cats.set(key, prev);
    lineRows.push({ id: i + 1, net, line: { ...l, vatCategory: cat, vatRate: rate } });
  });

  if (errors.length) return { ok: false, errors };

  sumLineNet = Math.round(sumLineNet * 100) / 100;
  let totalVat = 0;
  for (const c of cats.values()) {
    c.taxable = Math.round(c.taxable * 100) / 100;
    c.tax = Math.round(c.tax * 100) / 100;
    totalVat += c.tax;
  }
  totalVat = Math.round(totalVat * 100) / 100;
  const grand = Math.round((sumLineNet + totalVat) * 100) / 100;

  const isCredit = typeCode === '381';
  const rootEl = isCredit ? 'CreditNote' : 'Invoice';
  const lineEl = isCredit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyEl = isCredit ? 'CreditedQuantity' : 'InvoicedQuantity';
  const typeEl = isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode';

  const party = (p: EInvoiceParty, role: string) => {
    const cc = (p.countryCode || 'AE').toUpperCase();
    const trnBlock = /^\d{15}$/.test(String(p.trn ?? ''))
      ? `\n      <cbc:EndpointID schemeID="0235">${xmlEsc(p.trn)}</cbc:EndpointID>` +
        `\n      <cac:PartyTaxScheme>\n        <cbc:CompanyID>${xmlEsc(p.trn)}</cbc:CompanyID>\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>\n      </cac:PartyTaxScheme>`
      : '';
    return (
      `  <cac:Accounting${role}Party>\n    <cac:Party>` +
      trnBlock +
      `\n      <cac:PostalAddress>` +
      (p.address ? `\n        <cbc:StreetName>${xmlEsc(p.address)}</cbc:StreetName>` : '') +
      (p.city ? `\n        <cbc:CityName>${xmlEsc(p.city)}</cbc:CityName>` : '') +
      `\n        <cac:Country><cbc:IdentificationCode>${xmlEsc(cc)}</cbc:IdentificationCode></cac:Country>\n      </cac:PostalAddress>` +
      `\n      <cac:PartyLegalEntity><cbc:RegistrationName>${xmlEsc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>` +
      `\n    </cac:Party>\n  </cac:Accounting${role}Party>`
    );
  };

  const taxSubtotals = [...cats.entries()]
    .map(([key, c]) => {
      const cat = key.split('@')[0];
      return (
        `    <cac:TaxSubtotal>\n      <cbc:TaxableAmount currencyID="${currency}">${money(c.taxable)}</cbc:TaxableAmount>` +
        `\n      <cbc:TaxAmount currencyID="${currency}">${money(c.tax)}</cbc:TaxAmount>` +
        `\n      <cac:TaxCategory>\n        <cbc:ID>${xmlEsc(cat)}</cbc:ID>\n        <cbc:Percent>${money(c.rate)}</cbc:Percent>\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>\n      </cac:TaxCategory>\n    </cac:TaxSubtotal>`
      );
    })
    .join('\n');

  const invoiceLines = lineRows
    .map(({ id, net, line }) => {
      const unit = line.unit || 'C62';
      return (
        `  <cac:${lineEl}>\n    <cbc:ID>${id}</cbc:ID>` +
        `\n    <cbc:${qtyEl} unitCode="${xmlEsc(unit)}">${money(line.quantity)}</cbc:${qtyEl}>` +
        `\n    <cbc:LineExtensionAmount currencyID="${currency}">${money(net)}</cbc:LineExtensionAmount>` +
        `\n    <cac:Item>\n      <cbc:Name>${xmlEsc(line.name)}</cbc:Name>` +
        `\n      <cac:ClassifiedTaxCategory>\n        <cbc:ID>${xmlEsc(line.vatCategory)}</cbc:ID>\n        <cbc:Percent>${money(line.vatRate)}</cbc:Percent>\n        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>\n      </cac:ClassifiedTaxCategory>\n    </cac:Item>` +
        `\n    <cac:Price><cbc:PriceAmount currencyID="${currency}">${money(line.unitPrice)}</cbc:PriceAmount></cac:Price>\n  </cac:${lineEl}>`
      );
    })
    .join('\n');

  const ns =
    isCredit
      ? 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"'
      : 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"';

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<${rootEl} ${ns}\n` +
    `    xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"\n` +
    `    xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">\n` +
    `  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>\n` +
    `  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>\n` +
    `  <cbc:ID>${xmlEsc(args.invoiceNumber)}</cbc:ID>\n` +
    `  <cbc:IssueDate>${xmlEsc(args.issueDate)}</cbc:IssueDate>\n` +
    `  <cbc:${typeEl}>${xmlEsc(typeCode)}</cbc:${typeEl}>\n` +
    (args.note ? `  <cbc:Note>${xmlEsc(args.note)}</cbc:Note>\n` : '') +
    `  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>\n` +
    `  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>\n` +
    (args.precedingInvoiceRef
      ? `  <cac:BillingReference>\n    <cac:InvoiceDocumentReference><cbc:ID>${xmlEsc(args.precedingInvoiceRef)}</cbc:ID></cac:InvoiceDocumentReference>\n  </cac:BillingReference>\n`
      : '') +
    party(seller, 'Supplier') +
    '\n' +
    party(buyer, 'Customer') +
    '\n' +
    `  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID="${currency}">${money(totalVat)}</cbc:TaxAmount>\n${taxSubtotals}\n  </cac:TaxTotal>\n` +
    `  <cac:LegalMonetaryTotal>\n` +
    `    <cbc:LineExtensionAmount currencyID="${currency}">${money(sumLineNet)}</cbc:LineExtensionAmount>\n` +
    `    <cbc:TaxExclusiveAmount currencyID="${currency}">${money(sumLineNet)}</cbc:TaxExclusiveAmount>\n` +
    `    <cbc:TaxInclusiveAmount currencyID="${currency}">${money(grand)}</cbc:TaxInclusiveAmount>\n` +
    `    <cbc:PayableAmount currencyID="${currency}">${money(grand)}</cbc:PayableAmount>\n` +
    `  </cac:LegalMonetaryTotal>\n` +
    invoiceLines +
    `\n</${rootEl}>\n`;

  if (!xmlWellFormed(xml)) return { ok: false, errors: ['Internal error: the generated XML was not well-formed.'] };

  warnings.push('Authoritative PINT AE Schematron/XSD validation is performed by your accredited service provider (ASP) — validate there before live submission; the PINT AE spec is still partly draft.');
  return {
    ok: true,
    content: xml,
    filename: `einvoice_${String(args.invoiceNumber).replace(/[^a-zA-Z0-9._-]/g, '-')}.xml`,
    warnings,
    summary: `${rootEl} ${args.invoiceNumber}, ${lineRows.length} line(s); net AED ${money(sumLineNet)} + VAT AED ${money(totalVat)} = AED ${money(grand)} (reconciled), ${cats.size} VAT category subtotal(s).`,
  };
}

// ---------- the tool ----------

const KINDS = ['wps_sif', 'faf', 'einvoice_pint_ae'] as const;

export const generateComplianceFileTool: ToolDef = {
  name: 'generate_compliance_file',
  description:
    'Generate a FORMAT-STRICT UAE compliance file and self-validate it (returns errors instead of a bad file, like generate_spreadsheet). ' +
    'kind = "wps_sif" (MOHRE WPS Salary Information File .sif — builds the SCR header + EDR rows, computes the control total = Σ EDR, validates the 13-digit employer ID, 9-digit routing, 14-digit labour IDs, 23-char "AE" IBANs and no-comma AED amounts, and names the file [employerID][YYMMDD][HHMMSS].sif), ' +
    '"faf" (the FTA VAT Audit File CSV — company block + supplies + purchases + totals; reconciles output/input VAT to the VAT 201 Box 8 / Box 11 figures if provided), or ' +
    '"einvoice_pint_ae" (a UBL 2.1 / PINT AE e-invoice XML — parties with 15-digit TRNs + schemeID 0235, lines, a TaxSubtotal per VAT category code (S/Z/E/AE/O/G), and totals that reconcile; checks well-formedness + mandatory fields). ' +
    'The readable invoice and the VAT-201 / CT / Excise / payroll-reconciliation working papers are produced with generate_doc / generate_spreadsheet / render_report — this tool only owns the strict machine formats. ' +
    'NEVER fabricate figures — use only the data the user provides. Every file carries a note to validate against the official FTA schema / your ASP / your WPS agent bank before live submission.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['wps_sif', 'faf', 'einvoice_pint_ae'], description: 'Which compliance file to generate.' },
      output: { type: 'string', description: 'Optional output filename; a correct default is derived from the content if omitted.' },
      // wps_sif
      employerId: { type: 'string', description: 'wps_sif: 13-digit MOHRE establishment ID.' },
      bankRoutingCode: { type: 'string', description: 'wps_sif: 9-digit agent/bank routing code for the SCR header.' },
      salaryMonth: { type: 'string', description: 'wps_sif: salary month as MMYYYY.' },
      currency: { type: 'string', description: 'wps_sif/einvoice: currency (default AED).' },
      creationDate: { type: 'string', description: 'wps_sif: file creation date YYYY-MM-DD (default now).' },
      creationTime: { type: 'string', description: 'wps_sif: file creation time HH:MM[:SS] (default now).' },
      declaredTotal: { type: 'number', description: 'wps_sif: optional expected control total to cross-check against Σ EDR.' },
      employees: {
        type: 'array',
        description: 'wps_sif: one entry per employee (EDR).',
        items: {
          type: 'object',
          properties: {
            labourId: { type: 'string', description: '14-digit MOL labour-card/personal number.' },
            routingCode: { type: 'string', description: '9-digit routing code.' },
            iban: { type: 'string', description: '23-char IBAN, "AE" + 21 digits.' },
            startDate: { type: 'string', description: 'Pay-period start YYYY-MM-DD.' },
            endDate: { type: 'string', description: 'Pay-period end YYYY-MM-DD.' },
            days: { type: 'number' },
            fixedAmount: { type: 'number', description: 'Fixed component, AED.' },
            variableAmount: { type: 'number', description: 'Variable component, AED.' },
            ref: { type: 'string' },
          },
          required: ['labourId', 'routingCode', 'iban', 'fixedAmount'],
        },
      },
      // faf
      company: {
        type: 'object',
        description: 'faf: the taxable person + tax period.',
        properties: {
          name: { type: 'string' },
          trn: { type: 'string', description: '15-digit TRN.' },
          taxAgencyName: { type: 'string' },
          tan: { type: 'string' },
          taxAgentName: { type: 'string' },
          taan: { type: 'string' },
          periodStart: { type: 'string', description: 'YYYY-MM-DD.' },
          periodEnd: { type: 'string', description: 'YYYY-MM-DD.' },
        },
        required: ['name', 'trn', 'periodStart', 'periodEnd'],
      },
      supplies: {
        type: 'array',
        description: 'faf: output transactions.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' }, invoiceNo: { type: 'string' }, name: { type: 'string', description: 'Customer name.' },
            trn: { type: 'string' }, netAmount: { type: 'number' }, vatAmount: { type: 'number' },
          },
          required: ['date', 'invoiceNo', 'name', 'netAmount', 'vatAmount'],
        },
      },
      purchases: {
        type: 'array',
        description: 'faf: input transactions.',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string' }, invoiceNo: { type: 'string' }, name: { type: 'string', description: 'Supplier name.' },
            trn: { type: 'string' }, netAmount: { type: 'number' }, vatAmount: { type: 'number' },
          },
          required: ['date', 'invoiceNo', 'name', 'netAmount', 'vatAmount'],
        },
      },
      declaredOutputVat: { type: 'number', description: 'faf: VAT 201 Box 8 output VAT to reconcile against.' },
      declaredInputVat: { type: 'number', description: 'faf: VAT 201 Box 11 input VAT to reconcile against.' },
      // einvoice_pint_ae
      invoiceNumber: { type: 'string', description: 'einvoice: unique invoice number.' },
      issueDate: { type: 'string', description: 'einvoice: issue date YYYY-MM-DD.' },
      typeCode: { type: 'string', description: 'einvoice: 380 tax (default), 381 credit, 383 debit, 386 prepayment, 389 self-billed.' },
      simplified: { type: 'boolean', description: 'einvoice: true for a simplified (B2C / < AED 10k) invoice — buyer TRN optional.' },
      precedingInvoiceRef: { type: 'string', description: 'einvoice: the original invoice number (required for credit/debit notes).' },
      note: { type: 'string', description: 'einvoice: optional free-text note.' },
      seller: {
        type: 'object', description: 'einvoice: the supplier.',
        properties: { name: { type: 'string' }, trn: { type: 'string', description: '15-digit TRN.' }, countryCode: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' } },
        required: ['name', 'trn'],
      },
      buyer: {
        type: 'object', description: 'einvoice: the customer.',
        properties: { name: { type: 'string' }, trn: { type: 'string', description: '15-digit TRN (required unless simplified).' }, countryCode: { type: 'string' }, address: { type: 'string' }, city: { type: 'string' } },
        required: ['name'],
      },
      lines: {
        type: 'array', description: 'einvoice: one entry per invoice line.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }, quantity: { type: 'number' }, unitPrice: { type: 'number', description: 'Net unit price, AED.' },
            unit: { type: 'string', description: 'UN/ECE unit code (default C62).' },
            vatCategory: { type: 'string', enum: ['S', 'Z', 'E', 'AE', 'O', 'G'], description: 'S standard, Z zero, E exempt, AE reverse-charge, O out-of-scope, G export.' },
            vatRate: { type: 'number', description: 'VAT % (5 for standard, 0 otherwise).' },
          },
          required: ['name', 'quantity', 'unitPrice', 'vatCategory', 'vatRate'],
        },
      },
    },
    required: ['kind'],
  },
  modes: ['code'],
  summarize: (a) => `compliance file (${String(a.kind ?? '?')})`,
  async run(args, ctx) {
    const kind = String(args.kind ?? '');
    if (!KINDS.includes(kind as any)) return `Error: kind must be one of ${KINDS.join(', ')}.`;

    let result: BuildResult;
    try {
      if (kind === 'wps_sif') result = buildWpsSif(args as WpsArgs);
      else if (kind === 'faf') result = buildFaf(args as FafArgs);
      else result = buildEInvoicePintAe(args as EInvoiceArgs);
    } catch (e: any) {
      return `Error: failed to build the ${kind} file — ${e?.message ?? e}`;
    }

    if (!result.ok) {
      return (
        `Validation failed — the ${kind} file was NOT written. Fix these and call again (never fabricate a value to pass a check):\n- ` +
        result.errors.join('\n- ')
      );
    }

    const name = (args.output ? String(args.output) : result.filename).replace(/[^a-zA-Z0-9._-]/g, '-');
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, name);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      fs.writeFileSync(absOut, result.content, 'utf8');
    } catch (e: any) {
      return `Error: built and validated the file but could not write it — ${e?.message ?? e}`;
    }

    const sz = Buffer.byteLength(result.content, 'utf8');
    const warn = result.warnings.length ? `\nNotes: ${result.warnings.join(' ')}` : '';
    return `Generated ${name} (${Math.max(1, Math.round(sz / 1024))} KB, ${kind}) — validated. ${result.summary}${warn}\nThis is a draft for professional review — submit via EmaraTax / your accredited ASP / your WPS agent bank after validating against the official schema.`;
  },
};
