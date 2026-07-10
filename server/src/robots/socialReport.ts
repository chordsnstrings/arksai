import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Robot } from '../../../shared/types';
import { config } from '../config';
import { findForProvider } from '../connectors/store';
import { fetchReport } from '../connectors';
import { normalizeInsights, toSnapshotMetrics, type NormalizedRow } from '../agent/social/insights';
import { saveSnapshot, listSnapshots, computeSeriesDeltas } from '../agent/metricSnapshots';
import { sendFileOnChannel } from './outbound';

/**
 * The Report bot — a scheduled, DETERMINISTIC Meta performance report emailed as a designed PDF.
 * Numbers are never LLM-authored: insights are pulled + normalised (`normalizeInsights`), deltas
 * come from the metric-snapshot store, and observations are heuristic. `runAdsReport` is fired by
 * the `ads_report` robot job.
 */

export interface AdsReportConfig {
  accountId?: string;
  scope?: 'account' | 'account+campaign';
  include?: { reach?: boolean; leads?: boolean; conversions?: boolean; topCreatives?: boolean };
}

const iso = (n: number): string => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 });
const money = (n: number): string => `$${fmt(n)}`;
const esc = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Pure: deterministic observation bullets from the normalized data (unit-tested). */
export function reportObservations(total: NormalizedRow, campaigns: NormalizedRow[], deltas: { metric: string; deltaPct: number | null }[]): string[] {
  const out: string[] = [];
  const withResults = campaigns.filter((c) => c.results > 0 && c.costPerResult != null);
  if (withResults.length) {
    const best = [...withResults].sort((a, b) => (a.costPerResult! - b.costPerResult!))[0];
    out.push(`Best value: "${best.name}" at ${money(best.costPerResult!)} per result — consider shifting budget here.`);
  }
  const weak = campaigns.filter((c) => c.impressions >= 1000 && c.ctr < 0.6);
  if (weak.length) out.push(`${weak.length} campaign(s) with CTR under 0.6% after 1,000+ impressions — refresh the creative or pause.`);
  if (total.frequency >= 3.5) out.push(`Frequency is ${fmt(total.frequency)} — audiences are seeing ads often; rotate fresh creatives to fight fatigue.`);
  const spendDelta = deltas.find((d) => d.metric === 'spend');
  const resultDelta = deltas.find((d) => d.metric === 'results');
  if (resultDelta?.deltaPct != null) out.push(`Results ${resultDelta.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(resultDelta.deltaPct)}% vs the previous period.`);
  else if (spendDelta?.deltaPct != null) out.push(`Spend ${spendDelta.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(spendDelta.deltaPct)}% vs the previous period.`);
  if (!out.length) out.push('Performance is steady — no action needed this period.');
  return out;
}

function kpiCard(label: string, value: string, delta?: number | null): string {
  const chip = delta == null ? '' : `<span class="d ${delta >= 0 ? 'up' : 'dn'}">${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}%</span>`;
  return `<div class="kpi"><div class="kv">${esc(value)}</div><div class="kl">${esc(label)} ${chip}</div></div>`;
}

/** A tiny hand-rolled inline-SVG bar chart (no Vega dependency → pure + deterministic). */
function barSvg(items: { label: string; value: number }[], accent: string): string {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((i) => i.value));
  const rows = items.slice(0, 6).map((it, i) => {
    const w = Math.round((it.value / max) * 300);
    const y = i * 26;
    return `<text x="0" y="${y + 13}" class="bl">${esc(it.label.slice(0, 22))}</text>` +
      `<rect x="150" y="${y + 3}" width="${w}" height="14" rx="3" fill="${accent}"/>` +
      `<text x="${150 + w + 6}" y="${y + 14}" class="bv">${esc(fmt(it.value))}</text>`;
  }).join('');
  return `<svg viewBox="0 0 520 ${items.slice(0, 6).length * 26}" width="100%">${rows}</svg>`;
}

export interface ReportInput {
  robotName: string;
  accountName: string;
  periodLabel: string;
  since: string;
  until: string;
  total: NormalizedRow;
  campaigns: NormalizedRow[];
  deltas: { metric: string; value: number; deltaPct: number | null }[];
  accent?: string;
}

/** Pure: the whole report as a self-contained HTML string (unit-tested). */
export function buildReportHtml(inp: ReportInput): string {
  const accent = inp.accent || '#1f5f8b';
  const d = (m: string) => inp.deltas.find((x) => x.metric === m)?.deltaPct ?? null;
  const kpis = [
    kpiCard('Spend', money(inp.total.spend), d('spend')),
    kpiCard('Results', fmt(inp.total.results), d('results')),
    kpiCard('Cost / result', inp.total.costPerResult != null ? money(inp.total.costPerResult) : '—'),
    kpiCard('Reach', fmt(inp.total.reach), d('reach')),
    kpiCard('Impressions', fmt(inp.total.impressions)),
    kpiCard('CTR', `${fmt(inp.total.ctr)}%`, d('ctr')),
  ].join('');
  const topCampaigns = [...inp.campaigns].sort((a, b) => b.spend - a.spend);
  const rows = topCampaigns.map((c) => `<tr><td>${esc(c.name || '—')}</td><td>${money(c.spend)}</td><td>${fmt(c.impressions)}</td><td>${fmt(c.ctr)}%</td><td>${fmt(c.results)}</td><td>${c.costPerResult != null ? money(c.costPerResult) : '—'}</td></tr>`).join('');
  const obs = reportObservations(inp.total, inp.campaigns, inp.deltas).map((o) => `<li>${esc(o)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm 14mm}
    *{box-sizing:border-box} body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;margin:0}
    .mast{font:600 12px/1 'Space Grotesk',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${accent}}
    h1{font:600 26px/1.2 Georgia,serif;margin:6px 0 2px} .sub{color:#666;margin:0 0 16px}
    .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 18px}
    .kpi{border:1px solid #e6e2d8;border-radius:10px;padding:12px 14px}
    .kv{font:600 22px/1 Georgia,serif} .kl{font-size:11px;color:#777;margin-top:5px}
    .d{font-size:10px;font-weight:600} .up{color:#2f7d5b} .dn{color:#b23f2e}
    h2{font:600 15px/1 'Space Grotesk',sans-serif;margin:18px 0 8px;color:#333}
    table{border-collapse:collapse;width:100%;font-size:11.5px} th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}
    th{color:#888;font-weight:600;text-transform:uppercase;font-size:10px;letter-spacing:.04em}
    td:nth-child(n+2){text-align:right;font-variant-numeric:tabular-nums}
    .obs{background:#f6f4ee;border-left:3px solid ${accent};border-radius:8px;padding:10px 16px;margin-top:14px}
    .bl{font-size:11px;fill:#444} .bv{font-size:11px;fill:#666;font-weight:600}
    .foot{color:#999;font-size:10px;margin-top:22px;border-top:1px solid #eee;padding-top:8px}
  </style></head><body>
    <div class="mast">${esc(inp.robotName)} · Performance report</div>
    <h1>${esc(inp.accountName)}</h1>
    <p class="sub">${esc(inp.periodLabel)} — ${esc(inp.since)} to ${esc(inp.until)}</p>
    <div class="kpis">${kpis}</div>
    <div class="obs"><strong>What to know</strong><ul style="margin:6px 0 0;padding-left:18px">${obs}</ul></div>
    <h2>Spend by campaign</h2>
    ${barSvg(topCampaigns.map((c) => ({ label: c.name, value: c.spend })), accent)}
    <h2>Campaigns</h2>
    <table><thead><tr><th>Campaign</th><th>Spend</th><th>Impr.</th><th>CTR</th><th>Results</th><th>Cost/result</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No active campaigns in this period.</td></tr>'}</tbody></table>
    <div class="foot">Data through ${esc(inp.until)} (Meta attribution windows apply; the last 1–2 days may be incomplete). Generated by ArksAI.</div>
  </body></html>`;
}

/** Render report HTML → PDF under data/robot-reports; returns the file path. */
export async function renderReportPdf(html: string): Promise<string> {
  const dir = path.join(config.dataDir, 'robot-reports');
  fs.mkdirSync(dir, { recursive: true });
  const htmlPath = path.join(dir, `r-${randomUUID()}.html`);
  const pdfPath = path.join(dir, `report-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}.pdf`);
  fs.writeFileSync(htmlPath, html);
  let browser: any;
  try {
    const pw = await import('playwright');
    browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await (await browser.newContext()).newPage();
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    try { await browser?.close(); } catch {}
    try { fs.unlinkSync(htmlPath); } catch {}
  }
  return pdfPath;
}

/** Fired by the ads_report robot job: pull → normalise → deltas → PDF → email. Never throws fatally. */
export async function runAdsReport(robot: Robot, cfg: AdsReportConfig, recipients: string[]): Promise<{ ok: boolean; detail: string }> {
  const conn = await findForProvider(robot.orgId, 'meta', cfg.accountId);
  if (!conn) return { ok: false, detail: 'No Meta ad account connected.' };
  const to = recipients.filter(Boolean);
  if (!to.length) return { ok: false, detail: 'No report recipients set.' };

  const since = iso(8); // last 7 full days, through yesterday
  const until = iso(1);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  try {
    const acct = normalizeInsights(await fetchReport(conn, { accountId: conn.accountId, since, until, level: 'account' }, ac.signal));
    const camp = normalizeInsights(await fetchReport(conn, { accountId: conn.accountId, since, until, level: 'campaign' }, ac.signal));

    // Deltas via the metric-snapshot store (period = report end date).
    const series = `ads:${conn.accountId}`;
    const period = until;
    await saveSnapshot({ orgId: robot.orgId, series, period, metrics: toSnapshotMetrics(acct.total) }).catch(() => {});
    const deltas = computeSeriesDeltas(await listSnapshots(robot.orgId, series, 8))
      .filter((d) => d.period === period)
      .map((d) => ({ metric: d.metric, value: d.value, deltaPct: d.deltaPct }));

    const html = buildReportHtml({
      robotName: robot.name,
      accountName: conn.accountName || conn.accountId,
      periodLabel: 'Last 7 days',
      since, until, total: acct.total, campaigns: camp.rows, deltas,
    });
    const pdf = await renderReportPdf(html);
    for (const addr of to) {
      await sendFileOnChannel(robot, 'email', addr, pdf, `${robot.name} — performance report ${until}`).catch((e: any) =>
        console.error(`[ads_report] email to ${addr} failed:`, e?.message ?? e),
      );
    }
    return { ok: true, detail: `Report emailed to ${to.length} recipient(s).` };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  } finally {
    clearTimeout(timer);
  }
}
