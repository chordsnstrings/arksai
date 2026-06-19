import type { ToolDef } from './common';

/**
 * compute_financials — deterministic finance math so the agent EMBEDS computed
 * numbers instead of hand-typing (and inevitably mis-typing or fabricating)
 * derived figures. Four operations:
 *   - dcf:      discounted cash flow NPV + Gordon terminal value → enterprise value
 *   - ratios:   the standard profitability / liquidity / leverage / efficiency set
 *   - variance: budget vs actual, absolute + %, favourable/unfavourable
 *   - forecast: simple linear-regression or growth-rate projection
 *
 * Pure compute — no LLM, no network, no key. The formulas are ported
 * (reimplemented in TypeScript) from the MIT-licensed claude-skills
 * financial-analyst tools:
 *   finance/skills/financial-analyst/scripts/{dcf_valuation,ratio_calculator,
 *   budget_variance_analyzer,forecast_builder}.py
 * (Anthropic claude-skills, MIT). No Python and no dependency added — only the
 * math was harvested.
 */

export type FinOp = 'dcf' | 'ratios' | 'variance' | 'forecast';

const round = (v: number, p = 2) => {
  const f = 10 ** p;
  return Math.round((v + Number.EPSILON) * f) / f;
};
const safeDiv = (n: number, d: number, def = 0): number => (!d || !isFinite(d) ? def : n / d);
const num = (v: any, def = 0): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isFinite(n) ? n : def;
};

// ---------------------------------------------------------------- DCF
export interface DcfArgs {
  cash_flows: number[]; // projected free cash flows, year 1..N
  discount_rate: number; // WACC, as a decimal (0.10) or percent (10) — auto-detected
  terminal_growth?: number; // perpetuity growth g (decimal or percent)
  net_debt?: number; // subtract to get equity value
  shares_outstanding?: number; // to get value per share
}

/** Normalize a rate that may have been passed as a percent (e.g. 10 → 0.10). */
const asRate = (v: number): number => (Math.abs(v) > 1 ? v / 100 : v);

export function computeDcf(a: DcfArgs) {
  const cfs = (Array.isArray(a.cash_flows) ? a.cash_flows : []).map((x) => num(x));
  const warnings: string[] = [];
  if (!cfs.length) return { error: 'dcf needs a non-empty `cash_flows` array (year 1..N).' };
  const wacc = asRate(num(a.discount_rate));
  if (wacc <= 0) return { error: 'dcf needs a positive `discount_rate` (e.g. 0.10 or 10).' };
  const g = asRate(num(a.terminal_growth, 0.025));
  if (g >= wacc) warnings.push(`terminal growth (${round(g * 100, 2)}%) ≥ discount rate (${round(wacc * 100, 2)}%) — terminal value is undefined; treated as 0.`);

  const years = cfs.length;
  const pvByYear = cfs.map((cf, i) => round(cf / (1 + wacc) ** (i + 1)));
  const pvCashFlows = round(pvByYear.reduce((s, v) => s + v, 0));

  const terminalFcf = cfs[years - 1];
  const terminalValue = g < wacc ? round((terminalFcf * (1 + g)) / (wacc - g)) : 0;
  const pvTerminalValue = round(terminalValue / (1 + wacc) ** years);
  const enterpriseValue = round(pvCashFlows + pvTerminalValue);

  const out: any = {
    operation: 'dcf',
    inputs: { wacc: round(wacc, 4), terminal_growth: round(g, 4), years },
    pv_by_year: pvByYear,
    pv_cash_flows: pvCashFlows,
    terminal_value: terminalValue,
    pv_terminal_value: pvTerminalValue,
    enterprise_value: enterpriseValue,
    warnings,
  };
  if (a.net_debt != null) {
    out.equity_value = round(enterpriseValue - num(a.net_debt));
    if (a.shares_outstanding != null && num(a.shares_outstanding) > 0) {
      out.value_per_share = round(safeDiv(out.equity_value, num(a.shares_outstanding)), 4);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Ratios
export interface RatiosArgs {
  income_statement?: Record<string, any>;
  balance_sheet?: Record<string, any>;
  cash_flow?: Record<string, any>;
}

export function computeRatios(a: RatiosArgs) {
  const inc = a.income_statement ?? {};
  const bal = a.balance_sheet ?? {};
  const cf = a.cash_flow ?? {};

  const revenue = num(inc.revenue);
  const cogs = num(inc.cost_of_goods_sold ?? inc.cogs);
  const opInc = num(inc.operating_income);
  const netInc = num(inc.net_income);
  const interest = num(inc.interest_expense);

  const equity = num(bal.total_equity);
  const assets = num(bal.total_assets);
  const curAssets = num(bal.current_assets);
  const curLiab = num(bal.current_liabilities);
  const inventory = num(bal.inventory);
  const cash = num(bal.cash_and_equivalents ?? bal.cash);
  const ar = num(bal.accounts_receivable);
  const debt = num(bal.total_debt);

  const ocf = num(cf.operating_cash_flow);
  const debtService = num(cf.total_debt_service ?? interest);

  const grossProfit = revenue - cogs;
  const recvTurnover = safeDiv(revenue, ar);

  const r = (value: number, formula: string, name: string) => ({ value: round(value, 4), formula, name });

  const result: any = {
    operation: 'ratios',
    profitability: {
      roe: r(safeDiv(netInc, equity), 'Net Income / Total Equity', 'Return on Equity'),
      roa: r(safeDiv(netInc, assets), 'Net Income / Total Assets', 'Return on Assets'),
      gross_margin: r(safeDiv(grossProfit, revenue), '(Revenue - COGS) / Revenue', 'Gross Margin'),
      operating_margin: r(safeDiv(opInc, revenue), 'Operating Income / Revenue', 'Operating Margin'),
      net_margin: r(safeDiv(netInc, revenue), 'Net Income / Revenue', 'Net Margin'),
    },
    liquidity: {
      current_ratio: r(safeDiv(curAssets, curLiab), 'Current Assets / Current Liabilities', 'Current Ratio'),
      quick_ratio: r(safeDiv(curAssets - inventory, curLiab), '(Current Assets - Inventory) / Current Liabilities', 'Quick Ratio'),
      cash_ratio: r(safeDiv(cash, curLiab), 'Cash & Equivalents / Current Liabilities', 'Cash Ratio'),
    },
    leverage: {
      debt_to_equity: r(safeDiv(debt, equity), 'Total Debt / Total Equity', 'Debt-to-Equity'),
      interest_coverage: r(safeDiv(opInc, interest), 'Operating Income / Interest Expense', 'Interest Coverage'),
      dscr: r(safeDiv(ocf, debtService), 'Operating Cash Flow / Total Debt Service', 'Debt Service Coverage'),
    },
    efficiency: {
      asset_turnover: r(safeDiv(revenue, assets), 'Revenue / Total Assets', 'Asset Turnover'),
      inventory_turnover: r(safeDiv(cogs, inventory), 'COGS / Inventory', 'Inventory Turnover'),
      receivables_turnover: r(recvTurnover, 'Revenue / Accounts Receivable', 'Receivables Turnover'),
      dso: r(recvTurnover > 0 ? safeDiv(365, recvTurnover) : 0, '365 / Receivables Turnover', 'Days Sales Outstanding'),
    },
    warnings: [] as string[],
  };
  if (revenue <= 0) result.warnings.push('Revenue is 0 or missing — margin/turnover ratios are not meaningful.');
  if (equity <= 0) result.warnings.push('Total equity is 0 or missing — ROE / debt-to-equity are not meaningful.');
  return result;
}

// ---------------------------------------------------------------- Variance
export interface VarianceLine {
  name: string;
  type?: 'revenue' | 'expense';
  actual: number;
  budget: number;
  prior_year?: number;
}
export interface VarianceArgs {
  line_items: VarianceLine[];
}

export function computeVariance(a: VarianceArgs) {
  const items = Array.isArray(a.line_items) ? a.line_items : [];
  if (!items.length) return { error: 'variance needs a non-empty `line_items` array of {name, type, actual, budget}.' };

  let totalActual = 0;
  let totalBudget = 0;
  const lines = items.map((it) => {
    const type = it.type === 'revenue' ? 'revenue' : 'expense';
    const actual = num(it.actual);
    const budget = num(it.budget);
    const amt = actual - budget;
    const pct = round(safeDiv(amt, budget) * 100, 2);
    // Revenue: over budget = favourable. Expense: under budget = favourable.
    const favourability = type === 'revenue' ? (amt > 0 ? 'Favourable' : 'Unfavourable') : amt < 0 ? 'Favourable' : 'Unfavourable';
    totalActual += actual;
    totalBudget += budget;
    const rec: any = {
      name: it.name ?? 'Unknown',
      type,
      actual: round(actual),
      budget: round(budget),
      variance_amount: round(amt),
      variance_pct: pct,
      favourability,
    };
    if (it.prior_year != null) {
      const py = num(it.prior_year);
      rec.prior_year = round(py);
      rec.prior_year_variance_amount = round(actual - py);
      rec.prior_year_variance_pct = round(safeDiv(actual - py, py) * 100, 2);
    }
    return rec;
  });

  const totalAmt = totalActual - totalBudget;
  return {
    operation: 'variance',
    lines,
    totals: {
      actual: round(totalActual),
      budget: round(totalBudget),
      variance_amount: round(totalAmt),
      variance_pct: round(safeDiv(totalAmt, totalBudget) * 100, 2),
    },
  };
}

// ---------------------------------------------------------------- Forecast
export interface ForecastArgs {
  history: number[]; // historical values, oldest → newest
  periods?: number; // periods to project (default 6)
  method?: 'linear' | 'growth'; // linear regression vs average-growth-rate
}

/** Simple linear regression → {slope, intercept, r2}. Pure. */
export function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n < 2 || n !== y.length) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };
  const xm = x.reduce((s, v) => s + v, 0) / n;
  const ym = y.reduce((s, v) => s + v, 0) / n;
  let ssxy = 0;
  let ssxx = 0;
  let ssyy = 0;
  for (let i = 0; i < n; i++) {
    ssxy += (x[i] - xm) * (y[i] - ym);
    ssxx += (x[i] - xm) ** 2;
    ssyy += (y[i] - ym) ** 2;
  }
  const slope = safeDiv(ssxy, ssxx);
  const intercept = ym - slope * xm;
  const r2 = ssyy > 0 ? safeDiv(ssxy ** 2, ssxx * ssyy) : 0;
  return { slope, intercept, r2 };
}

export function computeForecast(a: ForecastArgs) {
  const hist = (Array.isArray(a.history) ? a.history : []).map((v) => num(v));
  if (hist.length < 2) return { error: 'forecast needs a `history` array of at least 2 numbers (oldest → newest).' };
  const periods = Math.max(1, Math.min(120, Math.round(num(a.periods, 6))));
  const method = a.method === 'growth' ? 'growth' : 'linear';
  const warnings: string[] = [];

  // Period-over-period growth rates → average.
  const growth: number[] = [];
  for (let i = 1; i < hist.length; i++) {
    if (hist[i - 1] !== 0) growth.push((hist[i] - hist[i - 1]) / hist[i - 1]);
  }
  const avgGrowth = growth.length ? growth.reduce((s, v) => s + v, 0) / growth.length : 0;

  const x = hist.map((_, i) => i + 1);
  const { slope, intercept, r2 } = linearRegression(x, hist);

  const projected: number[] = [];
  if (method === 'growth') {
    let last = hist[hist.length - 1];
    for (let p = 0; p < periods; p++) {
      last = last * (1 + avgGrowth);
      projected.push(round(last));
    }
  } else {
    for (let p = 0; p < periods; p++) {
      projected.push(round(intercept + slope * (hist.length + p + 1)));
    }
    if (r2 < 0.5) warnings.push(`linear fit is weak (R²=${round(r2, 3)}) — the trend is noisy; consider method="growth" or more history.`);
  }

  return {
    operation: 'forecast',
    method,
    trend: { slope: round(slope, 4), intercept: round(intercept, 4), r2: round(r2, 4), direction: slope > 0 ? 'upward' : slope < 0 ? 'downward' : 'flat' },
    average_growth_rate: round(avgGrowth, 4),
    projected,
    warnings,
  };
}

export const computeFinancialsTool: ToolDef = {
  name: 'compute_financials',
  description:
    'Compute derived financial figures DETERMINISTICALLY so you embed COMPUTED numbers, never hand-typed or ' +
    'guessed ones. Pick `operation`: ' +
    '"dcf" (discounted cash flow → NPV + Gordon terminal value + enterprise/equity value: pass cash_flows[], ' +
    'discount_rate, optional terminal_growth/net_debt/shares_outstanding); ' +
    '"ratios" (profitability/liquidity/leverage/efficiency: pass income_statement, balance_sheet, cash_flow objects); ' +
    '"variance" (budget vs actual, absolute + % + favourable/unfavourable: pass line_items[] of {name,type,actual,budget,prior_year?}); ' +
    '"forecast" (project a series via linear regression or average growth: pass history[], periods, method). ' +
    'Rates accept decimals (0.10) or percents (10). Returns structured numbers (and any sanity warnings) — use ' +
    'them in the report/sheet/answer. Never fabricate inputs; pass the user\'s real figures or mark them as ' +
    'estimates. Pure, deterministic, instant.',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['dcf', 'ratios', 'variance', 'forecast'], description: 'Which computation to run.' },
      // dcf
      cash_flows: { type: 'array', items: { type: 'number' }, description: 'dcf: projected free cash flows, year 1..N.' },
      discount_rate: { type: 'number', description: 'dcf: WACC / discount rate (0.10 or 10).' },
      terminal_growth: { type: 'number', description: 'dcf: perpetuity growth g (default 0.025). Must be < discount_rate.' },
      net_debt: { type: 'number', description: 'dcf: net debt to subtract for equity value (optional).' },
      shares_outstanding: { type: 'number', description: 'dcf: shares outstanding for value-per-share (optional).' },
      // ratios
      income_statement: { type: 'object', description: 'ratios: {revenue, cost_of_goods_sold, operating_income, net_income, interest_expense}.' },
      balance_sheet: { type: 'object', description: 'ratios: {total_equity, total_assets, current_assets, current_liabilities, inventory, cash_and_equivalents, accounts_receivable, total_debt}.' },
      cash_flow: { type: 'object', description: 'ratios: {operating_cash_flow, total_debt_service}.' },
      // variance
      line_items: {
        type: 'array',
        items: { type: 'object' },
        description: 'variance: rows of {name, type:"revenue"|"expense", actual, budget, prior_year?}.',
      },
      // forecast
      history: { type: 'array', items: { type: 'number' }, description: 'forecast: historical values, oldest → newest.' },
      periods: { type: 'number', description: 'forecast: number of periods to project (default 6).' },
      method: { type: 'string', enum: ['linear', 'growth'], description: 'forecast: linear regression (default) or average-growth-rate.' },
    },
    required: ['operation'],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `compute ${String(a.operation ?? '')}`,
  async run(args) {
    const op = String(args.operation ?? '') as FinOp;
    let res: any;
    switch (op) {
      case 'dcf':
        res = computeDcf(args as DcfArgs);
        break;
      case 'ratios':
        res = computeRatios(args as RatiosArgs);
        break;
      case 'variance':
        res = computeVariance(args as VarianceArgs);
        break;
      case 'forecast':
        res = computeForecast(args as ForecastArgs);
        break;
      default:
        return 'Error: `operation` must be one of dcf | ratios | variance | forecast.';
    }
    if (res && res.error) return `Error: ${res.error}`;
    return JSON.stringify(res, null, 2);
  },
};
