/**
 * EXCEL MODEL SCAFFOLDS — parameterized, check-row-carrying pattern specs for the model
 * archetypes users actually ask for (research 2026-07-06: Anthropic's dcf-model /
 * 3-statement-model / xlsx skills + FAST-standard practice, distilled in EXCEL_BAKEOFF.md).
 *
 * Every scaffold returns PATTERN sheets (see excelPattern.ts) so it flows through the same
 * deterministic expansion + audits as hand-written pattern sheets. Design rules baked in:
 * assumptions are the ONLY typed numbers; every derived cell is a live formula; tie-out
 * CHECK rows ship inside the model (the tool hard-fails a non-zero check); tax is IF-gated
 * for losses; interest accrues on the OPENING balance (no circularity); ratios guard /0;
 * exponent-free where recursion serves (discount factors, compounding PMT factor,
 * helper-row trend slope) so every formula is verifiable by the recalc engine.
 *
 * The agent customises a scaffold by passing its own "Assumptions" (or any) pattern sheet
 * in the same call — same-name sheets REPLACE the scaffold's before expansion, so label
 * references keep resolving.
 */

type Row = Record<string, unknown>;
type Sheet = { name: string; months?: number; item_header?: string; rows: Row[] };

const v = (label: string, value: number): Row => ({ label, value });

function revenueForecast(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('base units month 1', 1000), v('monthly unit growth rate', 0.04), v('price per unit', 50)] },
    {
      name: 'Revenue',
      months: n,
      rows: [
        { label: 'Units', first: '={ROW:Assumptions!base units month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly unit growth rate})' },
        { label: 'Revenue', each: '={ROW:Units}*{ROW:Assumptions!price per unit}' },
        { label: 'Growth %', first: '=0', then: '=IF({ROW:Revenue[-1]}=0,0,{ROW:Revenue}/{ROW:Revenue[-1]}-1)' },
      ],
    },
  ];
}

function threeStatement(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('revenue month 1', 100000), v('monthly revenue growth', 0.03), v('COGS % of revenue', 0.35),
        v('opex % of revenue', 0.25), v('fixed opex per month', 20000), v('D&A per month', 3000),
        v('capex per month', 5000), v('tax rate', 0.09), v('opening cash', 150000),
      ],
    },
    {
      name: 'Income',
      months: n,
      rows: [
        { label: 'Revenue', first: '={ROW:Assumptions!revenue month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly revenue growth})' },
        { label: 'COGS', each: '={ROW:Revenue}*{ROW:Assumptions!COGS % of revenue}' },
        { label: 'Gross profit', each: '={ROW:Revenue}-{ROW:COGS}' },
        { label: 'Opex', each: '={ROW:Revenue}*{ROW:Assumptions!opex % of revenue}+{ROW:Assumptions!fixed opex per month}' },
        { label: 'EBITDA', each: '={ROW:Gross profit}-{ROW:Opex}' },
        { label: 'D&A', each: '={ROW:Assumptions!D&A per month}' },
        { label: 'EBIT', each: '={ROW:EBITDA}-{ROW:D&A}' },
        { label: 'Tax', each: '=IF({ROW:EBIT}>0,{ROW:EBIT}*{ROW:Assumptions!tax rate},0)' },
        { label: 'Net profit', each: '={ROW:EBIT}-{ROW:Tax}' },
        { label: 'CHECK gross profit tie', check: '={ROW:Gross profit}-({ROW:Revenue}-{ROW:COGS})' },
      ],
    },
    {
      name: 'Cashflow',
      months: n,
      rows: [
        { label: 'Net profit', each: '={ROW:Income!Net profit}' },
        { label: 'Add back D&A', each: '={ROW:Income!D&A}' },
        { label: 'Capex', each: '=-{ROW:Assumptions!capex per month}' },
        { label: 'Net cash flow', each: '={ROW:Net profit}+{ROW:Add back D&A}+{ROW:Capex}' },
        { label: 'Ending cash', first: '={ROW:Assumptions!opening cash}+{ROW:Net cash flow}', then: '={PREV}+{ROW:Net cash flow}' },
        { label: 'CHECK cash roll-forward', first: '={ROW:Ending cash}-({ROW:Assumptions!opening cash}+{ROW:Net cash flow})', then: '={ROW:Ending cash}-({ROW:Ending cash[-1]}+{ROW:Net cash flow})' },
      ],
    },
  ];
}

function dcfValuation(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('EBIT year 1', 500000), v('annual EBIT growth', 0.06), v('tax rate', 0.25), v('D&A per year', 60000),
        v('capex per year', 80000), v('change in NWC per year', 20000), v('WACC', 0.1), v('terminal growth', 0.025),
        v('net debt', 400000), v('shares outstanding', 100000),
      ],
    },
    {
      name: 'FCF',
      months: n,
      rows: [
        { label: 'EBIT', first: '={ROW:Assumptions!EBIT year 1}', then: '={PREV}*(1+{ROW:Assumptions!annual EBIT growth})' },
        { label: 'NOPAT', each: '={ROW:EBIT}*(1-{ROW:Assumptions!tax rate})' },
        { label: 'Free cash flow', each: '={ROW:NOPAT}+{ROW:Assumptions!D&A per year}-{ROW:Assumptions!capex per year}-{ROW:Assumptions!change in NWC per year}' },
        // Exponent-free discounting: df(1)=1/(1+wacc), then df=prev/(1+wacc).
        { label: 'Discount factor', first: '=1/(1+{ROW:Assumptions!WACC})', then: '={PREV}/(1+{ROW:Assumptions!WACC})' },
        { label: 'PV of FCF', each: '={ROW:Free cash flow}*{ROW:Discount factor}' },
      ],
    },
    {
      name: 'Valuation',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'Sum of PV of FCF', each: '=SUM({RANGE:FCF!PV of FCF})' },
        { label: 'Terminal value', each: '={LAST:FCF!Free cash flow}*(1+{ROW:Assumptions!terminal growth})/({ROW:Assumptions!WACC}-{ROW:Assumptions!terminal growth})' },
        { label: 'PV of terminal value', each: '={ROW:Terminal value}*{LAST:FCF!Discount factor}' },
        { label: 'Enterprise value', each: '={ROW:Sum of PV of FCF}+{ROW:PV of terminal value}' },
        { label: 'Equity value', each: '={ROW:Enterprise value}-{ROW:Assumptions!net debt}' },
        { label: 'Value per share', each: '={ROW:Equity value}/{ROW:Assumptions!shares outstanding}' },
        { label: 'CHECK terminal growth < WACC', check: '=IF({ROW:Assumptions!terminal growth}<{ROW:Assumptions!WACC},0,1)' },
      ],
    },
  ];
}

function loanAmortization(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('loan principal', 500000), v('annual interest rate', 0.08), v('term months', n)] },
    {
      name: 'Schedule',
      months: n,
      rows: [
        // Compounding factor row reproduces PMT without POWER: F(m)=(1+r)^m by recursion.
        { label: 'Compounding factor', first: '=1+{ROW:Assumptions!annual interest rate}/12', then: '={PREV}*(1+{ROW:Assumptions!annual interest rate}/12)' },
        { label: 'Payment', each: '={ROW:Assumptions!loan principal}*({ROW:Assumptions!annual interest rate}/12)*{LAST:Compounding factor}/({LAST:Compounding factor}-1)' },
        { label: 'Opening balance', first: '={ROW:Assumptions!loan principal}', then: '={ROW:Closing balance[-1]}' },
        { label: 'Interest', each: '={ROW:Opening balance}*{ROW:Assumptions!annual interest rate}/12' },
        { label: 'Principal repaid', each: '={ROW:Payment}-{ROW:Interest}' },
        { label: 'Closing balance', each: '={ROW:Opening balance}-{ROW:Principal repaid}' },
        { label: 'CHECK roll-forward', each: '={ROW:Closing balance}-({ROW:Opening balance}-{ROW:Principal repaid})' },
      ],
    },
    {
      name: 'Summary',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'Total interest paid', each: '=SUM({RANGE:Schedule!Interest})' },
        { label: 'Total paid', each: '=SUM({RANGE:Schedule!Payment})' },
        { label: 'CHECK final balance is zero', check: '=ROUND({LAST:Schedule!Closing balance},2)' },
      ],
    },
  ];
}

function saasMrr(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('starting MRR', 50000), v('new logos per month', 10), v('ACV per logo (annual)', 12000),
        v('expansion % of beginning MRR', 0.02), v('churn % of beginning MRR', 0.015),
      ],
    },
    {
      name: 'MRR',
      months: n,
      rows: [
        { label: 'Beginning MRR', first: '={ROW:Assumptions!starting MRR}', then: '={ROW:Ending MRR[-1]}' },
        { label: 'New MRR', each: '={ROW:Assumptions!new logos per month}*{ROW:Assumptions!ACV per logo (annual)}/12' },
        { label: 'Expansion', each: '={ROW:Beginning MRR}*{ROW:Assumptions!expansion % of beginning MRR}' },
        { label: 'Churn', each: '=-{ROW:Beginning MRR}*{ROW:Assumptions!churn % of beginning MRR}' },
        { label: 'Ending MRR', each: '={ROW:Beginning MRR}+{ROW:New MRR}+{ROW:Expansion}+{ROW:Churn}' },
        { label: 'ARR', each: '={ROW:Ending MRR}*12' },
        { label: 'NRR', each: '=IF({ROW:Beginning MRR}=0,0,({ROW:Beginning MRR}+{ROW:Expansion}+{ROW:Churn})/{ROW:Beginning MRR})' },
        { label: 'CHECK waterfall tie', check: '={ROW:Ending MRR}-({ROW:Beginning MRR}+{ROW:New MRR}+{ROW:Expansion}+{ROW:Churn})' },
      ],
    },
  ];
}

function headcountPlan(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('role 1 start month', 1), v('role 1 annual salary', 180000),
        v('role 2 start month', 3), v('role 2 annual salary', 144000),
        v('role 3 start month', 6), v('role 3 annual salary', 96000),
        v('burden % (benefits/taxes)', 0.18),
      ],
    },
    {
      name: 'Plan',
      months: n,
      rows: [
        { label: 'Month index', first: '=1', then: '={PREV}+1' },
        { label: 'Role 1 active', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 1 start month},1,0)' },
        { label: 'Role 2 active', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 2 start month},1,0)' },
        { label: 'Role 3 active', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 3 start month},1,0)' },
        { label: 'Headcount', each: '={ROW:Role 1 active}+{ROW:Role 2 active}+{ROW:Role 3 active}' },
        {
          label: 'Payroll (loaded)',
          each:
            '=({ROW:Role 1 active}*{ROW:Assumptions!role 1 annual salary}+{ROW:Role 2 active}*{ROW:Assumptions!role 2 annual salary}+{ROW:Role 3 active}*{ROW:Assumptions!role 3 annual salary})/12*(1+{ROW:Assumptions!burden % (benefits/taxes)})',
        },
        { label: 'Cumulative payroll', first: '={ROW:Payroll (loaded)}', then: '={PREV}+{ROW:Payroll (loaded)}' },
      ],
    },
  ];
}

function forecastTrend(n: number): Sheet[] {
  // Prediction scaffold: helper-row least squares (slope/intercept from SUM/AVERAGE — no
  // LINEST) + exponential smoothing. The Actuals row ships as a live example series the
  // user replaces with real data; everything downstream recomputes.
  return [
    { name: 'Assumptions', rows: [v('smoothing alpha (0-1)', 0.3), v('example actuals base', 1000), v('example actuals monthly step', 40)] },
    {
      name: 'Data',
      months: n,
      rows: [
        { label: 'Period (x)', first: '=1', then: '={PREV}+1' },
        { label: 'Actuals (replace with your data)', first: '={ROW:Assumptions!example actuals base}', then: '={PREV}+{ROW:Assumptions!example actuals monthly step}' },
        { label: 'x times y', each: '={ROW:Period (x)}*{ROW:Actuals (replace with your data)}' },
        { label: 'x squared', each: '={ROW:Period (x)}*{ROW:Period (x)}' },
        { label: 'Smoothed (exp)', first: '={ROW:Actuals (replace with your data)}', then: '={ROW:Assumptions!smoothing alpha (0-1)}*{ROW:Actuals (replace with your data)}+(1-{ROW:Assumptions!smoothing alpha (0-1)})*{PREV}' },
      ],
    },
    {
      name: 'Model',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'n periods', each: '=COUNT({RANGE:Data!Actuals (replace with your data)})' },
        {
          label: 'Slope',
          each:
            '=({ROW:n periods}*SUM({RANGE:Data!x times y})-SUM({RANGE:Data!Period (x)})*SUM({RANGE:Data!Actuals (replace with your data)}))/({ROW:n periods}*SUM({RANGE:Data!x squared})-SUM({RANGE:Data!Period (x)})*SUM({RANGE:Data!Period (x)}))',
        },
        { label: 'Intercept', each: '=AVERAGE({RANGE:Data!Actuals (replace with your data)})-{ROW:Slope}*AVERAGE({RANGE:Data!Period (x)})' },
      ],
    },
    {
      name: 'Forecast',
      months: n,
      rows: [
        { label: 'Future period (x)', first: `=${n}+1`, then: '={PREV}+1' },
        { label: 'Trend forecast', each: '={FIRST:Model!Intercept}+{FIRST:Model!Slope}*{ROW:Future period (x)}' },
      ],
    },
  ];
}

function scenarioForecast(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('scenario (1=bear 2=base 3=bull)', 2),
        v('bear growth', 0.01), v('base growth', 0.03), v('bull growth', 0.06),
        v('bear price', 45), v('base price', 50), v('bull price', 55),
        v('base units month 1', 1000),
      ],
    },
    {
      // ONE consolidation block (the dcf-model skill rule) — every downstream formula
      // references the Selected rows, never the scenario blocks.
      name: 'Selected',
      months: 1,
      item_header: 'Driver',
      rows: [
        { label: 'Selected growth', each: '=IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=1,{ROW:Assumptions!bear growth},IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=2,{ROW:Assumptions!base growth},{ROW:Assumptions!bull growth}))' },
        { label: 'Selected price', each: '=IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=1,{ROW:Assumptions!bear price},IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=2,{ROW:Assumptions!base price},{ROW:Assumptions!bull price}))' },
        { label: 'CHECK growth hierarchy', check: '=IF({ROW:Assumptions!bull growth}>={ROW:Assumptions!base growth},0,1)+IF({ROW:Assumptions!base growth}>={ROW:Assumptions!bear growth},0,1)' },
      ],
    },
    {
      name: 'Forecast',
      months: n,
      rows: [
        { label: 'Units', first: '={ROW:Assumptions!base units month 1}', then: '={PREV}*(1+{FIRST:Selected!Selected growth})' },
        { label: 'Revenue', each: '={ROW:Units}*{FIRST:Selected!Selected price}' },
        { label: 'Cumulative revenue', first: '={ROW:Revenue}', then: '={PREV}+{ROW:Revenue}' },
      ],
    },
  ];
}

export interface ExcelScaffold {
  id: string;
  /** What the scaffold is for — surfaced in the tool description. */
  blurb: string;
  build: (months: number) => Sheet[];
  defaultMonths: number;
}

export const EXCEL_SCAFFOLDS: ExcelScaffold[] = [
  { id: 'revenue-forecast', blurb: 'units × price driver forecast with compounding growth + guarded growth %', build: revenueForecast, defaultMonths: 24 },
  { id: 'three-statement', blurb: 'Income + Cashflow with IF-gated tax, D&A/capex, cash roll-forward + tie checks', build: threeStatement, defaultMonths: 24 },
  { id: 'dcf-valuation', blurb: 'FCF build, recursive discount factors (no POWER), terminal value, per-share equity', build: dcfValuation, defaultMonths: 10 },
  { id: 'loan-amortization', blurb: 'payment via compounding-factor PMT, interest on opening balance, zero-balance check', build: loanAmortization, defaultMonths: 36 },
  { id: 'saas-mrr', blurb: 'MRR waterfall (new/expansion/churn), ARR, guarded NRR + waterfall tie check', build: saasMrr, defaultMonths: 24 },
  { id: 'headcount-plan', blurb: 'role start-month gating, loaded payroll, cumulative cost', build: headcountPlan, defaultMonths: 24 },
  { id: 'forecast-trend', blurb: 'PREDICTION: least-squares trend (helper rows, no LINEST) + exponential smoothing + forward forecast', build: forecastTrend, defaultMonths: 12 },
  { id: 'scenario-forecast', blurb: 'bear/base/bull driver blocks with ONE consolidation row + hierarchy check', build: scenarioForecast, defaultMonths: 24 },
];

/** Instantiate a scaffold and merge the caller's sheets over it (same-name replaces). */
export function applyScaffold(id: string, months: number | undefined, userSheets: any[]): any[] | null {
  const sc = EXCEL_SCAFFOLDS.find((s) => s.id === id);
  if (!sc) return null;
  const n = Math.max(1, Math.min(120, Number(months) || sc.defaultMonths));
  const base = sc.build(n);
  const byName = new Map(base.map((s) => [s.name.toLowerCase(), s] as const));
  for (const u of userSheets ?? []) byName.set(String(u?.name ?? '').toLowerCase(), u);
  // Preserve scaffold order, then any extra user sheets.
  const merged: any[] = base.map((s) => byName.get(s.name.toLowerCase()));
  for (const u of userSheets ?? []) if (!base.some((s) => s.name.toLowerCase() === String(u?.name ?? '').toLowerCase())) merged.push(u);
  return merged;
}
