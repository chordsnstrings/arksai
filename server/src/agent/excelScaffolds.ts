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
type Sheet = { name: string; months?: number; item_header?: string; month_headers?: string[]; rows: Row[] };

/** Y1..Yn period headers for annual models (the default is M1..Mn). */
const years = (n: number): string[] => Array.from({ length: n }, (_, i) => `Y${i + 1}`);

// v(label, value, fmt?) — fmt is the per-row number format ('currency'/'percent'/'number'/
// explicit) that the theme pass applies, so every scaffold ships premium formatting baked in.
const v = (label: string, value: number, fmt?: string): Row => ({ label, value, ...(fmt ? { fmt } : {}) });

function revenueForecast(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('base units month 1', 1000, '#,##0'), v('monthly unit growth rate', 0.04, 'percent'), v('price per unit', 50, 'currency')] },
    {
      name: 'Revenue',
      months: n,
      rows: [
        { label: 'Units', fmt: '#,##0', first: '={ROW:Assumptions!base units month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly unit growth rate})' },
        { label: 'Revenue', fmt: 'currency', each: '={ROW:Units}*{ROW:Assumptions!price per unit}' },
        { label: 'Growth %', fmt: 'percent', first: '=0', then: '=IF({ROW:Revenue[-1]}=0,0,{ROW:Revenue}/{ROW:Revenue[-1]}-1)' },
      ],
    },
  ];
}

function threeStatement(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('revenue month 1', 100000, 'currency'), v('monthly revenue growth', 0.03, 'percent'), v('COGS % of revenue', 0.35, 'percent'),
        v('opex % of revenue', 0.25, 'percent'), v('fixed opex per month', 20000, 'currency'), v('D&A per month', 3000, 'currency'),
        v('capex per month', 5000, 'currency'), v('tax rate', 0.09, 'percent'), v('opening cash', 150000, 'currency'),
      ],
    },
    {
      name: 'Income',
      months: n,
      rows: [
        { label: 'Revenue', fmt: 'currency', first: '={ROW:Assumptions!revenue month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly revenue growth})' },
        { label: 'COGS', fmt: 'currency', each: '={ROW:Revenue}*{ROW:Assumptions!COGS % of revenue}' },
        { label: 'Gross profit', fmt: 'currency', each: '={ROW:Revenue}-{ROW:COGS}' },
        { label: 'Opex', fmt: 'currency', each: '={ROW:Revenue}*{ROW:Assumptions!opex % of revenue}+{ROW:Assumptions!fixed opex per month}' },
        { label: 'EBITDA', fmt: 'currency', each: '={ROW:Gross profit}-{ROW:Opex}' },
        { label: 'D&A', fmt: 'currency', each: '={ROW:Assumptions!D&A per month}' },
        { label: 'EBIT', fmt: 'currency', each: '={ROW:EBITDA}-{ROW:D&A}' },
        { label: 'Tax', fmt: 'currency', each: '=IF({ROW:EBIT}>0,{ROW:EBIT}*{ROW:Assumptions!tax rate},0)' },
        { label: 'Net profit', fmt: 'currency', each: '={ROW:EBIT}-{ROW:Tax}' },
        { label: 'CHECK gross profit tie', fmt: '0.00', check: '={ROW:Gross profit}-({ROW:Revenue}-{ROW:COGS})' },
      ],
    },
    {
      name: 'Cashflow',
      months: n,
      rows: [
        { label: 'Net profit', fmt: 'currency', each: '={ROW:Income!Net profit}' },
        { label: 'Add back D&A', fmt: 'currency', each: '={ROW:Income!D&A}' },
        { label: 'Capex', fmt: 'currency', each: '=-{ROW:Assumptions!capex per month}' },
        { label: 'Net cash flow', fmt: 'currency', each: '={ROW:Net profit}+{ROW:Add back D&A}+{ROW:Capex}' },
        { label: 'Ending cash', fmt: 'currency', first: '={ROW:Assumptions!opening cash}+{ROW:Net cash flow}', then: '={PREV}+{ROW:Net cash flow}' },
        { label: 'CHECK cash roll-forward', fmt: '0.00', first: '={ROW:Ending cash}-({ROW:Assumptions!opening cash}+{ROW:Net cash flow})', then: '={ROW:Ending cash}-({ROW:Ending cash[-1]}+{ROW:Net cash flow})' },
      ],
    },
  ];
}

function dcfValuation(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('EBIT year 1', 500000, 'currency'), v('annual EBIT growth', 0.06, 'percent'), v('tax rate', 0.25, 'percent'), v('D&A per year', 60000, 'currency'),
        v('capex per year', 80000, 'currency'), v('change in NWC per year', 20000, 'currency'), v('WACC', 0.1, 'percent'), v('terminal growth', 0.025, 'percent'),
        v('net debt', 400000, 'currency'), v('shares outstanding', 100000, '#,##0'),
      ],
    },
    {
      name: 'FCF',
      months: n,
      rows: [
        { label: 'EBIT', fmt: 'currency', first: '={ROW:Assumptions!EBIT year 1}', then: '={PREV}*(1+{ROW:Assumptions!annual EBIT growth})' },
        { label: 'NOPAT', fmt: 'currency', each: '={ROW:EBIT}*(1-{ROW:Assumptions!tax rate})' },
        { label: 'Free cash flow', fmt: 'currency', each: '={ROW:NOPAT}+{ROW:Assumptions!D&A per year}-{ROW:Assumptions!capex per year}-{ROW:Assumptions!change in NWC per year}' },
        // Exponent-free discounting: df(1)=1/(1+wacc), then df=prev/(1+wacc).
        { label: 'Discount factor', fmt: '0.0000', first: '=1/(1+{ROW:Assumptions!WACC})', then: '={PREV}/(1+{ROW:Assumptions!WACC})' },
        { label: 'PV of FCF', fmt: 'currency', each: '={ROW:Free cash flow}*{ROW:Discount factor}' },
      ],
    },
    {
      name: 'Valuation',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'Sum of PV of FCF', fmt: 'currency', each: '=SUM({RANGE:FCF!PV of FCF})' },
        { label: 'Terminal value', fmt: 'currency', each: '={LAST:FCF!Free cash flow}*(1+{ROW:Assumptions!terminal growth})/({ROW:Assumptions!WACC}-{ROW:Assumptions!terminal growth})' },
        { label: 'PV of terminal value', fmt: 'currency', each: '={ROW:Terminal value}*{LAST:FCF!Discount factor}' },
        { label: 'Enterprise value', fmt: 'currency', each: '={ROW:Sum of PV of FCF}+{ROW:PV of terminal value}' },
        { label: 'Equity value', fmt: 'currency', each: '={ROW:Enterprise value}-{ROW:Assumptions!net debt}' },
        { label: 'Value per share', fmt: 'currency', each: '={ROW:Equity value}/{ROW:Assumptions!shares outstanding}' },
        { label: 'CHECK terminal growth < WACC', fmt: '0', check: '=IF({ROW:Assumptions!terminal growth}<{ROW:Assumptions!WACC},0,1)' },
      ],
    },
  ];
}

function loanAmortization(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('loan principal', 500000, 'currency'), v('annual interest rate', 0.08, 'percent'), v('term months', n, '0')] },
    {
      name: 'Schedule',
      months: n,
      rows: [
        // Compounding factor row reproduces PMT without POWER: F(m)=(1+r)^m by recursion.
        { label: 'Compounding factor', fmt: '0.0000', first: '=1+{ROW:Assumptions!annual interest rate}/12', then: '={PREV}*(1+{ROW:Assumptions!annual interest rate}/12)' },
        { label: 'Payment', fmt: 'currency', each: '={ROW:Assumptions!loan principal}*({ROW:Assumptions!annual interest rate}/12)*{LAST:Compounding factor}/({LAST:Compounding factor}-1)' },
        { label: 'Opening balance', fmt: 'currency', first: '={ROW:Assumptions!loan principal}', then: '={ROW:Closing balance[-1]}' },
        { label: 'Interest', fmt: 'currency', each: '={ROW:Opening balance}*{ROW:Assumptions!annual interest rate}/12' },
        { label: 'Principal repaid', fmt: 'currency', each: '={ROW:Payment}-{ROW:Interest}' },
        { label: 'Closing balance', fmt: 'currency', each: '={ROW:Opening balance}-{ROW:Principal repaid}' },
        { label: 'CHECK roll-forward', fmt: '0.00', each: '={ROW:Closing balance}-({ROW:Opening balance}-{ROW:Principal repaid})' },
      ],
    },
    {
      name: 'Summary',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'Total interest paid', fmt: 'currency', each: '=SUM({RANGE:Schedule!Interest})' },
        { label: 'Total paid', fmt: 'currency', each: '=SUM({RANGE:Schedule!Payment})' },
        { label: 'CHECK final balance is zero', fmt: '0.00', check: '=ROUND({LAST:Schedule!Closing balance},2)' },
      ],
    },
  ];
}

function saasMrr(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('starting MRR', 50000, 'currency'), v('new logos per month', 10, '0'), v('ACV per logo (annual)', 12000, 'currency'),
        v('expansion % of beginning MRR', 0.02, 'percent'), v('churn % of beginning MRR', 0.015, 'percent'),
      ],
    },
    {
      name: 'MRR',
      months: n,
      rows: [
        { label: 'Beginning MRR', fmt: 'currency', first: '={ROW:Assumptions!starting MRR}', then: '={ROW:Ending MRR[-1]}' },
        { label: 'New MRR', fmt: 'currency', each: '={ROW:Assumptions!new logos per month}*{ROW:Assumptions!ACV per logo (annual)}/12' },
        { label: 'Expansion', fmt: 'currency', each: '={ROW:Beginning MRR}*{ROW:Assumptions!expansion % of beginning MRR}' },
        { label: 'Churn', fmt: 'currency', each: '=-{ROW:Beginning MRR}*{ROW:Assumptions!churn % of beginning MRR}' },
        { label: 'Ending MRR', fmt: 'currency', each: '={ROW:Beginning MRR}+{ROW:New MRR}+{ROW:Expansion}+{ROW:Churn}' },
        { label: 'ARR', fmt: 'currency', each: '={ROW:Ending MRR}*12' },
        { label: 'NRR', fmt: 'percent', each: '=IF({ROW:Beginning MRR}=0,0,({ROW:Beginning MRR}+{ROW:Expansion}+{ROW:Churn})/{ROW:Beginning MRR})' },
        { label: 'CHECK waterfall tie', fmt: '0.00', check: '={ROW:Ending MRR}-({ROW:Beginning MRR}+{ROW:New MRR}+{ROW:Expansion}+{ROW:Churn})' },
      ],
    },
  ];
}

function headcountPlan(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('role 1 start month', 1, '0'), v('role 1 annual salary', 180000, 'currency'),
        v('role 2 start month', 3, '0'), v('role 2 annual salary', 144000, 'currency'),
        v('role 3 start month', 6, '0'), v('role 3 annual salary', 96000, 'currency'),
        v('burden % (benefits/taxes)', 0.18, 'percent'),
      ],
    },
    {
      name: 'Plan',
      months: n,
      rows: [
        { label: 'Month index', fmt: '0', first: '=1', then: '={PREV}+1' },
        { label: 'Role 1 active', fmt: '0', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 1 start month},1,0)' },
        { label: 'Role 2 active', fmt: '0', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 2 start month},1,0)' },
        { label: 'Role 3 active', fmt: '0', each: '=IF({ROW:Month index}>={ROW:Assumptions!role 3 start month},1,0)' },
        { label: 'Headcount', fmt: '0', each: '={ROW:Role 1 active}+{ROW:Role 2 active}+{ROW:Role 3 active}' },
        {
          label: 'Payroll (loaded)',
          fmt: 'currency',
          each:
            '=({ROW:Role 1 active}*{ROW:Assumptions!role 1 annual salary}+{ROW:Role 2 active}*{ROW:Assumptions!role 2 annual salary}+{ROW:Role 3 active}*{ROW:Assumptions!role 3 annual salary})/12*(1+{ROW:Assumptions!burden % (benefits/taxes)})',
        },
        { label: 'Cumulative payroll', fmt: 'currency', first: '={ROW:Payroll (loaded)}', then: '={PREV}+{ROW:Payroll (loaded)}' },
      ],
    },
  ];
}

function forecastTrend(n: number): Sheet[] {
  // Prediction scaffold: helper-row least squares (slope/intercept from SUM/AVERAGE — no
  // LINEST) + exponential smoothing. The Actuals row ships as a live example series the
  // user replaces with real data; everything downstream recomputes.
  return [
    { name: 'Assumptions', rows: [v('smoothing alpha (0-1)', 0.3, '0.00'), v('example actuals base', 1000, '#,##0'), v('example actuals monthly step', 40, '#,##0')] },
    {
      name: 'Data',
      months: n,
      rows: [
        { label: 'Period (x)', fmt: '0', first: '=1', then: '={PREV}+1' },
        { label: 'Actuals (replace with your data)', fmt: '#,##0.00', first: '={ROW:Assumptions!example actuals base}', then: '={PREV}+{ROW:Assumptions!example actuals monthly step}' },
        { label: 'x times y', fmt: '#,##0', each: '={ROW:Period (x)}*{ROW:Actuals (replace with your data)}' },
        { label: 'x squared', fmt: '#,##0', each: '={ROW:Period (x)}*{ROW:Period (x)}' },
        { label: 'Smoothed (exp)', fmt: '#,##0.00', first: '={ROW:Actuals (replace with your data)}', then: '={ROW:Assumptions!smoothing alpha (0-1)}*{ROW:Actuals (replace with your data)}+(1-{ROW:Assumptions!smoothing alpha (0-1)})*{PREV}' },
      ],
    },
    {
      name: 'Model',
      months: 1,
      item_header: 'Line',
      rows: [
        { label: 'n periods', fmt: '0', each: '=COUNT({RANGE:Data!Actuals (replace with your data)})' },
        {
          label: 'Slope',
          fmt: '#,##0.0000',
          each:
            '=({ROW:n periods}*SUM({RANGE:Data!x times y})-SUM({RANGE:Data!Period (x)})*SUM({RANGE:Data!Actuals (replace with your data)}))/({ROW:n periods}*SUM({RANGE:Data!x squared})-SUM({RANGE:Data!Period (x)})*SUM({RANGE:Data!Period (x)}))',
        },
        { label: 'Intercept', fmt: '#,##0.0000', each: '=AVERAGE({RANGE:Data!Actuals (replace with your data)})-{ROW:Slope}*AVERAGE({RANGE:Data!Period (x)})' },
      ],
    },
    {
      name: 'Forecast',
      months: n,
      rows: [
        { label: 'Future period (x)', fmt: '0', first: `=${n}+1`, then: '={PREV}+1' },
        { label: 'Trend forecast', fmt: '#,##0.00', each: '={FIRST:Model!Intercept}+{FIRST:Model!Slope}*{ROW:Future period (x)}' },
      ],
    },
  ];
}

function scenarioForecast(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('scenario (1=bear 2=base 3=bull)', 2, '0'),
        v('bear growth', 0.01, 'percent'), v('base growth', 0.03, 'percent'), v('bull growth', 0.06, 'percent'),
        v('bear price', 45, 'currency'), v('base price', 50, 'currency'), v('bull price', 55, 'currency'),
        v('base units month 1', 1000, '#,##0'),
      ],
    },
    {
      // ONE consolidation block (the dcf-model skill rule) — every downstream formula
      // references the Selected rows, never the scenario blocks.
      name: 'Selected',
      months: 1,
      item_header: 'Driver',
      rows: [
        { label: 'Selected growth', fmt: 'percent', each: '=IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=1,{ROW:Assumptions!bear growth},IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=2,{ROW:Assumptions!base growth},{ROW:Assumptions!bull growth}))' },
        { label: 'Selected price', fmt: 'currency', each: '=IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=1,{ROW:Assumptions!bear price},IF({ROW:Assumptions!scenario (1=bear 2=base 3=bull)}=2,{ROW:Assumptions!base price},{ROW:Assumptions!bull price}))' },
        { label: 'CHECK growth hierarchy', fmt: '0', check: '=IF({ROW:Assumptions!bull growth}>={ROW:Assumptions!base growth},0,1)+IF({ROW:Assumptions!base growth}>={ROW:Assumptions!bear growth},0,1)' },
      ],
    },
    {
      name: 'Forecast',
      months: n,
      rows: [
        { label: 'Units', fmt: '#,##0', first: '={ROW:Assumptions!base units month 1}', then: '={PREV}*(1+{FIRST:Selected!Selected growth})' },
        { label: 'Revenue', fmt: 'currency', each: '={ROW:Units}*{FIRST:Selected!Selected price}' },
        { label: 'Cumulative revenue', fmt: 'currency', first: '={ROW:Revenue}', then: '={PREV}+{ROW:Revenue}' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// CATALOG EXPANSION (2026-07-06, operator: "a scaffold for everything that's
// needed for anyone, including BI") — FP&A, sales/marketing, BI/analytics,
// operations, HR, personal finance, real estate, e-commerce. Same rules as the
// core eight: assumptions are the only typed numbers, every derived cell is a
// live formula the recalc engine can verify (IF-nesting instead of AND/OR,
// ^0.5 instead of SQRT), and every model carries a tie-out CHECK row.
// ---------------------------------------------------------------------------

function budgetVsActual(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('base monthly budget', 100000, 'currency'), v('monthly budget growth', 0.01, 'percent'), v('example actual factor', 0.97, '0.00')] },
    {
      name: 'Variance',
      months: n,
      rows: [
        { label: 'Budget', fmt: 'currency', first: '={ROW:Assumptions!base monthly budget}', then: '={PREV}*(1+{ROW:Assumptions!monthly budget growth})' },
        { label: 'Actual (replace with your data)', fmt: 'currency', each: '={ROW:Budget}*{ROW:Assumptions!example actual factor}' },
        { label: 'Variance', fmt: 'currency', each: '={ROW:Actual (replace with your data)}-{ROW:Budget}' },
        { label: 'Variance %', fmt: 'percent', each: '=IF({ROW:Budget}=0,0,{ROW:Variance}/{ROW:Budget})' },
        { label: 'Cumulative variance', fmt: 'currency', first: '={ROW:Variance}', then: '={PREV}+{ROW:Variance}' },
        { label: 'CHECK variance tie', fmt: '0.00', check: '={ROW:Variance}-({ROW:Actual (replace with your data)}-{ROW:Budget})' },
      ],
    },
  ];
}

function cashRunway(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('opening cash', 500000, 'currency'), v('monthly revenue', 40000, 'currency'), v('monthly revenue growth', 0.05, 'percent'),
        v('monthly operating costs', 90000, 'currency'), v('monthly cost growth', 0.02, 'percent'),
      ],
    },
    {
      name: 'Runway',
      months: n,
      rows: [
        { label: 'Revenue', fmt: 'currency', first: '={ROW:Assumptions!monthly revenue}', then: '={PREV}*(1+{ROW:Assumptions!monthly revenue growth})' },
        { label: 'Operating costs', fmt: 'currency', first: '={ROW:Assumptions!monthly operating costs}', then: '={PREV}*(1+{ROW:Assumptions!monthly cost growth})' },
        { label: 'Net burn', fmt: 'currency', each: '={ROW:Operating costs}-{ROW:Revenue}' },
        { label: 'Opening cash', fmt: 'currency', first: '={ROW:Assumptions!opening cash}', then: '={ROW:Closing cash[-1]}' },
        { label: 'Closing cash', fmt: 'currency', each: '={ROW:Opening cash}-{ROW:Net burn}' },
        { label: 'Runway (months at this burn)', fmt: '0.0', each: '=IF({ROW:Net burn}>0,{ROW:Closing cash}/{ROW:Net burn},0)' },
        { label: 'CHECK cash roll-forward', fmt: '0.00', check: '={ROW:Closing cash}-({ROW:Opening cash}-{ROW:Net burn})' },
      ],
    },
  ];
}

function breakEven(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('price per unit', 120, 'currency'), v('variable cost per unit', 70, 'currency'),
        v('fixed costs per month', 40000, 'currency'), v('volume step (units)', 200, '#,##0'),
      ],
    },
    {
      name: 'Summary',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'Contribution margin per unit', fmt: 'currency', each: '={ROW:Assumptions!price per unit}-{ROW:Assumptions!variable cost per unit}' },
        { label: 'Contribution margin %', fmt: 'percent', each: '=IF({ROW:Assumptions!price per unit}=0,0,{ROW:Contribution margin per unit}/{ROW:Assumptions!price per unit})' },
        { label: 'Break-even units', fmt: '#,##0.0', each: '=IF({ROW:Contribution margin per unit}=0,0,{ROW:Assumptions!fixed costs per month}/{ROW:Contribution margin per unit})' },
        { label: 'Break-even revenue', fmt: 'currency', each: '={ROW:Break-even units}*{ROW:Assumptions!price per unit}' },
        { label: 'CHECK profit at break-even is zero', fmt: '0.00', check: '={ROW:Break-even units}*{ROW:Contribution margin per unit}-{ROW:Assumptions!fixed costs per month}' },
      ],
    },
    {
      name: 'Sensitivity',
      months: n,
      rows: [
        { label: 'Units', fmt: '#,##0', first: '={ROW:Assumptions!volume step (units)}', then: '={PREV}+{ROW:Assumptions!volume step (units)}' },
        { label: 'Revenue', fmt: 'currency', each: '={ROW:Units}*{ROW:Assumptions!price per unit}' },
        { label: 'Total cost', fmt: 'currency', each: '={ROW:Assumptions!fixed costs per month}+{ROW:Units}*{ROW:Assumptions!variable cost per unit}' },
        { label: 'Profit', fmt: 'currency', each: '={ROW:Revenue}-{ROW:Total cost}' },
      ],
    },
  ];
}

function unitEconomics(): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('monthly marketing spend', 30000, 'currency'), v('new customers per month', 150, '#,##0'),
        v('ARPU per month', 45, 'currency'), v('gross margin', 0.7, 'percent'), v('monthly churn rate', 0.03, 'percent'),
      ],
    },
    {
      name: 'Economics',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'CAC', fmt: 'currency', each: '=IF({ROW:Assumptions!new customers per month}=0,0,{ROW:Assumptions!monthly marketing spend}/{ROW:Assumptions!new customers per month})' },
        { label: 'Contribution per customer per month', fmt: 'currency', each: '={ROW:Assumptions!ARPU per month}*{ROW:Assumptions!gross margin}' },
        { label: 'Customer lifetime (months)', fmt: '0.0', each: '=IF({ROW:Assumptions!monthly churn rate}=0,0,1/{ROW:Assumptions!monthly churn rate})' },
        { label: 'LTV', fmt: 'currency', each: '={ROW:Contribution per customer per month}*{ROW:Customer lifetime (months)}' },
        { label: 'LTV to CAC ratio', fmt: '0.00', each: '=IF({ROW:CAC}=0,0,{ROW:LTV}/{ROW:CAC})' },
        { label: 'CAC payback (months)', fmt: '0.0', each: '=IF({ROW:Contribution per customer per month}=0,0,{ROW:CAC}/{ROW:Contribution per customer per month})' },
        { label: 'CHECK LTV tie', fmt: '0.00', check: '={ROW:LTV}-{ROW:Contribution per customer per month}*{ROW:Customer lifetime (months)}' },
      ],
    },
  ];
}

function npvProject(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('initial investment', 1000000, 'currency'), v('cash flow year 1', 250000, 'currency'),
        v('annual cash flow growth', 0.03, 'percent'), v('discount rate', 0.1, 'percent'),
      ],
    },
    {
      name: 'Cashflows',
      months: n,
      month_headers: years(n),
      rows: [
        { label: 'Cash flow', fmt: 'currency', first: '={ROW:Assumptions!cash flow year 1}', then: '={PREV}*(1+{ROW:Assumptions!annual cash flow growth})' },
        { label: 'Discount factor', fmt: '0.0000', first: '=1/(1+{ROW:Assumptions!discount rate})', then: '={PREV}/(1+{ROW:Assumptions!discount rate})' },
        { label: 'PV of cash flow', fmt: 'currency', each: '={ROW:Cash flow}*{ROW:Discount factor}' },
        { label: 'Cumulative PV', fmt: 'currency', first: '={ROW:PV of cash flow}', then: '={PREV}+{ROW:PV of cash flow}' },
      ],
    },
    {
      name: 'Appraisal',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'Total PV of cash flows', fmt: 'currency', each: '=SUM({RANGE:Cashflows!PV of cash flow})' },
        { label: 'NPV', fmt: 'currency', each: '={ROW:Total PV of cash flows}-{ROW:Assumptions!initial investment}' },
        { label: 'Profitability index', fmt: '0.00', each: '=IF({ROW:Assumptions!initial investment}=0,0,{ROW:Total PV of cash flows}/{ROW:Assumptions!initial investment})' },
        { label: 'CHECK discounting starts at 1/(1+r)', fmt: '0.0000', check: '={FIRST:Cashflows!Discount factor}*(1+{ROW:Assumptions!discount rate})-1' },
      ],
    },
  ];
}

function capexDepreciation(n: number): Sheet[] {
  const dep = (i: number) =>
    `=IF({ROW:Month index}>={ROW:Assumptions!asset ${i} start month},IF({ROW:Month index}<{ROW:Assumptions!asset ${i} start month}+{ROW:Assumptions!asset ${i} life (months)},{ROW:Assumptions!asset ${i} cost}/{ROW:Assumptions!asset ${i} life (months)},0),0)`;
  return [
    {
      name: 'Assumptions',
      rows: [
        v('asset 1 cost', 120000, 'currency'), v('asset 1 start month', 1, '0'), v('asset 1 life (months)', 36, '0'),
        v('asset 2 cost', 60000, 'currency'), v('asset 2 start month', 6, '0'), v('asset 2 life (months)', 24, '0'),
        v('asset 3 cost', 30000, 'currency'), v('asset 3 start month', 12, '0'), v('asset 3 life (months)', 12, '0'),
      ],
    },
    {
      name: 'Depreciation',
      months: n,
      rows: [
        { label: 'Month index', fmt: '0', first: '=1', then: '={PREV}+1' },
        { label: 'Asset 1 depreciation', fmt: 'currency', each: dep(1) },
        { label: 'Asset 2 depreciation', fmt: 'currency', each: dep(2) },
        { label: 'Asset 3 depreciation', fmt: 'currency', each: dep(3) },
        { label: 'Total depreciation', fmt: 'currency', each: '={ROW:Asset 1 depreciation}+{ROW:Asset 2 depreciation}+{ROW:Asset 3 depreciation}' },
        { label: 'Cumulative depreciation', fmt: 'currency', first: '={ROW:Total depreciation}', then: '={PREV}+{ROW:Total depreciation}' },
        { label: 'Net book value', fmt: 'currency', each: '=({ROW:Assumptions!asset 1 cost}+{ROW:Assumptions!asset 2 cost}+{ROW:Assumptions!asset 3 cost})-{ROW:Cumulative depreciation}' },
        { label: 'CHECK depreciation never exceeds cost', fmt: '0', check: '=IF({ROW:Cumulative depreciation}<={ROW:Assumptions!asset 1 cost}+{ROW:Assumptions!asset 2 cost}+{ROW:Assumptions!asset 3 cost},0,1)' },
      ],
    },
  ];
}

function workingCapital(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('monthly revenue', 300000, 'currency'), v('monthly revenue growth', 0.02, 'percent'), v('COGS % of revenue', 0.6, 'percent'),
        v('DSO (days sales outstanding)', 45, '0'), v('DIO (days inventory outstanding)', 30, '0'), v('DPO (days payables outstanding)', 38, '0'),
      ],
    },
    {
      name: 'WorkingCapital',
      months: n,
      rows: [
        { label: 'Revenue', fmt: 'currency', first: '={ROW:Assumptions!monthly revenue}', then: '={PREV}*(1+{ROW:Assumptions!monthly revenue growth})' },
        { label: 'COGS', fmt: 'currency', each: '={ROW:Revenue}*{ROW:Assumptions!COGS % of revenue}' },
        { label: 'Accounts receivable', fmt: 'currency', each: '={ROW:Revenue}*{ROW:Assumptions!DSO (days sales outstanding)}/30' },
        { label: 'Inventory', fmt: 'currency', each: '={ROW:COGS}*{ROW:Assumptions!DIO (days inventory outstanding)}/30' },
        { label: 'Accounts payable', fmt: 'currency', each: '={ROW:COGS}*{ROW:Assumptions!DPO (days payables outstanding)}/30' },
        { label: 'Net working capital', fmt: 'currency', each: '={ROW:Accounts receivable}+{ROW:Inventory}-{ROW:Accounts payable}' },
        { label: 'Change in NWC', fmt: 'currency', first: '={ROW:Net working capital}', then: '={ROW:Net working capital}-{ROW:Net working capital[-1]}' },
        { label: 'Cash conversion cycle (days)', fmt: '0', each: '={ROW:Assumptions!DSO (days sales outstanding)}+{ROW:Assumptions!DIO (days inventory outstanding)}-{ROW:Assumptions!DPO (days payables outstanding)}' },
        { label: 'CHECK NWC tie', fmt: '0.00', check: '={ROW:Net working capital}-({ROW:Accounts receivable}+{ROW:Inventory}-{ROW:Accounts payable})' },
      ],
    },
  ];
}

function salesPipeline(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('new leads per month', 200, '#,##0'), v('monthly lead growth', 0.03, 'percent'), v('lead to qualified rate', 0.4, 'percent'),
        v('qualified to proposal rate', 0.5, 'percent'), v('proposal win rate', 0.3, 'percent'), v('average deal size', 8000, 'currency'),
      ],
    },
    {
      name: 'Pipeline',
      months: n,
      rows: [
        { label: 'Leads', fmt: '#,##0.0', first: '={ROW:Assumptions!new leads per month}', then: '={PREV}*(1+{ROW:Assumptions!monthly lead growth})' },
        { label: 'Qualified', fmt: '#,##0.0', each: '={ROW:Leads}*{ROW:Assumptions!lead to qualified rate}' },
        { label: 'Proposals', fmt: '#,##0.0', each: '={ROW:Qualified}*{ROW:Assumptions!qualified to proposal rate}' },
        { label: 'Wins', fmt: '#,##0.0', each: '={ROW:Proposals}*{ROW:Assumptions!proposal win rate}' },
        { label: 'New revenue', fmt: 'currency', each: '={ROW:Wins}*{ROW:Assumptions!average deal size}' },
        { label: 'Lead to win rate', fmt: 'percent', each: '=IF({ROW:Leads}=0,0,{ROW:Wins}/{ROW:Leads})' },
        { label: 'Cumulative revenue', fmt: 'currency', first: '={ROW:New revenue}', then: '={PREV}+{ROW:New revenue}' },
        { label: 'CHECK funnel narrows', fmt: '0', check: '=IF({ROW:Wins}<={ROW:Leads},0,1)' },
      ],
    },
  ];
}

function salesCommission(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('monthly quota', 100000, 'currency'), v('sales month 1', 90000, 'currency'), v('monthly sales growth', 0.04, 'percent'),
        v('base commission rate', 0.05, 'percent'), v('accelerator rate above quota', 0.1, 'percent'),
      ],
    },
    {
      name: 'Commissions',
      months: n,
      rows: [
        { label: 'Sales', fmt: 'currency', first: '={ROW:Assumptions!sales month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly sales growth})' },
        { label: 'Quota', fmt: 'currency', each: '={ROW:Assumptions!monthly quota}' },
        { label: 'Attainment %', fmt: 'percent', each: '=IF({ROW:Quota}=0,0,{ROW:Sales}/{ROW:Quota})' },
        { label: 'Commission (base)', fmt: 'currency', each: '=IF({ROW:Sales}<={ROW:Quota},{ROW:Sales},{ROW:Quota})*{ROW:Assumptions!base commission rate}' },
        { label: 'Commission (accelerator)', fmt: 'currency', each: '=IF({ROW:Sales}>{ROW:Quota},({ROW:Sales}-{ROW:Quota})*{ROW:Assumptions!accelerator rate above quota},0)' },
        { label: 'Total commission', fmt: 'currency', each: '={ROW:Commission (base)}+{ROW:Commission (accelerator)}' },
        { label: 'Cumulative commission', fmt: 'currency', first: '={ROW:Total commission}', then: '={PREV}+{ROW:Total commission}' },
        { label: 'CHECK commission tie', fmt: '0.00', check: '={ROW:Total commission}-({ROW:Commission (base)}+{ROW:Commission (accelerator)})' },
      ],
    },
  ];
}

function marketingFunnel(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('monthly ad spend', 20000, 'currency'), v('CPM (cost per 1000 impressions)', 12, 'currency'), v('click-through rate', 0.015, 'percent'),
        v('click to lead rate', 0.08, 'percent'), v('lead to customer rate', 0.1, 'percent'), v('revenue per customer', 500, 'currency'),
      ],
    },
    {
      name: 'Funnel',
      months: n,
      rows: [
        { label: 'Ad spend', fmt: 'currency', each: '={ROW:Assumptions!monthly ad spend}' },
        { label: 'Impressions', fmt: '#,##0', each: '={ROW:Ad spend}/{ROW:Assumptions!CPM (cost per 1000 impressions)}*1000' },
        { label: 'Clicks', fmt: '#,##0.0', each: '={ROW:Impressions}*{ROW:Assumptions!click-through rate}' },
        { label: 'Leads', fmt: '#,##0.0', each: '={ROW:Clicks}*{ROW:Assumptions!click to lead rate}' },
        { label: 'New customers', fmt: '#,##0.0', each: '={ROW:Leads}*{ROW:Assumptions!lead to customer rate}' },
        { label: 'CAC', fmt: 'currency', each: '=IF({ROW:New customers}=0,0,{ROW:Ad spend}/{ROW:New customers})' },
        { label: 'Revenue', fmt: 'currency', each: '={ROW:New customers}*{ROW:Assumptions!revenue per customer}' },
        { label: 'ROAS', fmt: '0.00', each: '=IF({ROW:Ad spend}=0,0,{ROW:Revenue}/{ROW:Ad spend})' },
        { label: 'CHECK funnel narrows', fmt: '0', check: '=IF({ROW:Clicks}<={ROW:Impressions},0,1)+IF({ROW:Leads}<={ROW:Clicks},0,1)' },
      ],
    },
  ];
}

function kpiDashboard(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('revenue month 1', 250000, 'currency'), v('monthly revenue growth', 0.03, 'percent'), v('monthly revenue target', 260000, 'currency'),
        v('orders month 1', 1200, '#,##0'), v('monthly order growth', 0.02, 'percent'),
        v('active users month 1', 8000, '#,##0'), v('monthly user growth', 0.04, 'percent'),
      ],
    },
    {
      name: 'KPIs',
      months: n,
      rows: [
        { label: 'Revenue', fmt: 'currency', first: '={ROW:Assumptions!revenue month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly revenue growth})' },
        { label: 'Revenue target', fmt: 'currency', each: '={ROW:Assumptions!monthly revenue target}' },
        { label: 'Revenue vs target %', fmt: 'percent', each: '=IF({ROW:Revenue target}=0,0,{ROW:Revenue}/{ROW:Revenue target}-1)' },
        { label: 'Revenue MoM %', fmt: 'percent', first: '=0', then: '=IF({ROW:Revenue[-1]}=0,0,{ROW:Revenue}/{ROW:Revenue[-1]}-1)' },
        { label: 'On target (1 = yes)', fmt: '0', each: '=IF({ROW:Revenue}>={ROW:Revenue target},1,0)' },
        { label: 'Orders', fmt: '#,##0.0', first: '={ROW:Assumptions!orders month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly order growth})' },
        { label: 'Orders MoM %', fmt: 'percent', first: '=0', then: '=IF({ROW:Orders[-1]}=0,0,{ROW:Orders}/{ROW:Orders[-1]}-1)' },
        { label: 'Average order value', fmt: 'currency', each: '=IF({ROW:Orders}=0,0,{ROW:Revenue}/{ROW:Orders})' },
        { label: 'Active users', fmt: '#,##0.0', first: '={ROW:Assumptions!active users month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly user growth})' },
        { label: 'Revenue per user', fmt: 'currency', each: '=IF({ROW:Active users}=0,0,{ROW:Revenue}/{ROW:Active users})' },
        { label: 'CHECK AOV tie', fmt: '0.00', check: '={ROW:Average order value}*{ROW:Orders}-{ROW:Revenue}' },
      ],
    },
  ];
}

function cohortRetention(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('cohort size (signups)', 1000, '#,##0'), v('monthly churn rate', 0.08, 'percent'), v('ARPU per month', 25, 'currency')] },
    {
      name: 'Cohort',
      months: n,
      rows: [
        { label: 'Retention rate', fmt: 'percent', first: '=1', then: '={PREV}*(1-{ROW:Assumptions!monthly churn rate})' },
        { label: 'Active users', fmt: '#,##0.0', each: '={ROW:Assumptions!cohort size (signups)}*{ROW:Retention rate}' },
        { label: 'Monthly revenue', fmt: 'currency', each: '={ROW:Active users}*{ROW:Assumptions!ARPU per month}' },
        { label: 'Cumulative revenue', fmt: 'currency', first: '={ROW:Monthly revenue}', then: '={PREV}+{ROW:Monthly revenue}' },
        { label: 'Cumulative LTV per user', fmt: 'currency', each: '={ROW:Cumulative revenue}/{ROW:Assumptions!cohort size (signups)}' },
        { label: 'CHECK retention within bounds', fmt: '0', check: '=IF({ROW:Retention rate}<=1,0,1)+IF({ROW:Retention rate}>=0,0,1)' },
      ],
    },
  ];
}

function inventoryPlanning(): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('annual demand (units)', 24000, '#,##0'), v('cost per order', 150, 'currency'), v('holding cost per unit per year', 4, 'currency'),
        v('average daily demand (units)', 66, '#,##0.0'), v('lead time (days)', 14, '0'), v('safety stock (units)', 300, '#,##0'),
      ],
    },
    {
      name: 'Plan',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'Economic order quantity (EOQ)', fmt: '#,##0.0', each: '=(2*{ROW:Assumptions!annual demand (units)}*{ROW:Assumptions!cost per order}/{ROW:Assumptions!holding cost per unit per year})^0.5' },
        { label: 'Orders per year', fmt: '0.0', each: '={ROW:Assumptions!annual demand (units)}/{ROW:Economic order quantity (EOQ)}' },
        { label: 'Annual ordering cost', fmt: 'currency', each: '={ROW:Orders per year}*{ROW:Assumptions!cost per order}' },
        { label: 'Annual holding cost', fmt: 'currency', each: '={ROW:Economic order quantity (EOQ)}/2*{ROW:Assumptions!holding cost per unit per year}' },
        { label: 'Average inventory (units)', fmt: '#,##0.0', each: '={ROW:Economic order quantity (EOQ)}/2+{ROW:Assumptions!safety stock (units)}' },
        { label: 'Reorder point (units)', fmt: '#,##0', each: '={ROW:Assumptions!average daily demand (units)}*{ROW:Assumptions!lead time (days)}+{ROW:Assumptions!safety stock (units)}' },
        { label: 'Total annual cost', fmt: 'currency', each: '={ROW:Annual ordering cost}+{ROW:Annual holding cost}' },
        { label: 'CHECK EOQ balances ordering and holding', fmt: '0.00', check: '={ROW:Annual ordering cost}-{ROW:Annual holding cost}' },
      ],
    },
  ];
}

function projectBudget(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('total project budget', 600000, 'currency'), v('planned monthly spend', 50000, 'currency'), v('example actual factor', 1.05, '0.00')] },
    {
      name: 'Tracker',
      months: n,
      rows: [
        { label: 'Planned spend', fmt: 'currency', each: '={ROW:Assumptions!planned monthly spend}' },
        { label: 'Actual spend (replace with your data)', fmt: 'currency', each: '={ROW:Planned spend}*{ROW:Assumptions!example actual factor}' },
        { label: 'Variance', fmt: 'currency', each: '={ROW:Actual spend (replace with your data)}-{ROW:Planned spend}' },
        { label: 'Cumulative planned', fmt: 'currency', first: '={ROW:Planned spend}', then: '={PREV}+{ROW:Planned spend}' },
        { label: 'Cumulative actual', fmt: 'currency', first: '={ROW:Actual spend (replace with your data)}', then: '={PREV}+{ROW:Actual spend (replace with your data)}' },
        { label: 'Budget consumed %', fmt: 'percent', each: '=IF({ROW:Assumptions!total project budget}=0,0,{ROW:Cumulative actual}/{ROW:Assumptions!total project budget})' },
        { label: 'Budget remaining', fmt: 'currency', each: '={ROW:Assumptions!total project budget}-{ROW:Cumulative actual}' },
        { label: 'CHECK remaining tie', fmt: '0.00', check: '={ROW:Budget remaining}-({ROW:Assumptions!total project budget}-{ROW:Cumulative actual})' },
      ],
    },
  ];
}

function personalBudget(n: number): Sheet[] {
  const grow = (label: string, key: string): Row => ({
    label, fmt: 'currency',
    first: `={ROW:Assumptions!${key}}`,
    then: '={PREV}*(1+{ROW:Assumptions!annual inflation}/12)',
  });
  return [
    {
      name: 'Assumptions',
      rows: [
        v('monthly take-home income', 18000, 'currency'), v('rent', 5500, 'currency'), v('groceries', 2200, 'currency'),
        v('transport', 900, 'currency'), v('utilities and bills', 1100, 'currency'), v('lifestyle and other', 2400, 'currency'),
        v('annual inflation', 0.03, 'percent'),
      ],
    },
    {
      name: 'Budget',
      months: n,
      rows: [
        { label: 'Income', fmt: 'currency', each: '={ROW:Assumptions!monthly take-home income}' },
        grow('Rent', 'rent'),
        grow('Groceries', 'groceries'),
        grow('Transport', 'transport'),
        grow('Utilities and bills', 'utilities and bills'),
        grow('Lifestyle and other', 'lifestyle and other'),
        { label: 'Total expenses', fmt: 'currency', each: '={ROW:Rent}+{ROW:Groceries}+{ROW:Transport}+{ROW:Utilities and bills}+{ROW:Lifestyle and other}' },
        { label: 'Savings', fmt: 'currency', each: '={ROW:Income}-{ROW:Total expenses}' },
        { label: 'Savings rate', fmt: 'percent', each: '=IF({ROW:Income}=0,0,{ROW:Savings}/{ROW:Income})' },
        { label: 'Cumulative savings', fmt: 'currency', first: '={ROW:Savings}', then: '={PREV}+{ROW:Savings}' },
        { label: 'CHECK expense tie', fmt: '0.00', check: '={ROW:Total expenses}-({ROW:Rent}+{ROW:Groceries}+{ROW:Transport}+{ROW:Utilities and bills}+{ROW:Lifestyle and other})' },
      ],
    },
  ];
}

function savingsGoal(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('starting balance', 20000, 'currency'), v('monthly contribution', 3000, 'currency'),
        v('expected annual return', 0.06, 'percent'), v('savings goal', 150000, 'currency'),
      ],
    },
    {
      name: 'Growth',
      months: n,
      rows: [
        { label: 'Opening balance', fmt: 'currency', first: '={ROW:Assumptions!starting balance}', then: '={ROW:Closing balance[-1]}' },
        { label: 'Contribution', fmt: 'currency', each: '={ROW:Assumptions!monthly contribution}' },
        { label: 'Investment growth', fmt: 'currency', each: '={ROW:Opening balance}*{ROW:Assumptions!expected annual return}/12' },
        { label: 'Closing balance', fmt: 'currency', each: '={ROW:Opening balance}+{ROW:Contribution}+{ROW:Investment growth}' },
        { label: 'Progress to goal', fmt: 'percent', each: '=IF({ROW:Assumptions!savings goal}=0,0,{ROW:Closing balance}/{ROW:Assumptions!savings goal})' },
        { label: 'CHECK balance roll-forward', fmt: '0.00', check: '={ROW:Closing balance}-({ROW:Opening balance}+{ROW:Contribution}+{ROW:Investment growth})' },
      ],
    },
  ];
}

function rentalProperty(): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('purchase price', 1200000, 'currency'), v('down payment %', 0.25, 'percent'), v('annual interest rate', 0.045, 'percent'),
        v('loan term (months)', 300, '0'), v('monthly rent', 6500, 'currency'), v('vacancy rate', 0.05, 'percent'),
        v('annual operating costs', 18000, 'currency'), v('closing costs', 40000, 'currency'),
      ],
    },
    {
      name: 'Analysis',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'Loan amount', fmt: 'currency', each: '={ROW:Assumptions!purchase price}*(1-{ROW:Assumptions!down payment %})' },
        {
          label: 'Monthly mortgage payment', fmt: 'currency',
          each: '={ROW:Loan amount}*({ROW:Assumptions!annual interest rate}/12)*(1+{ROW:Assumptions!annual interest rate}/12)^{ROW:Assumptions!loan term (months)}/((1+{ROW:Assumptions!annual interest rate}/12)^{ROW:Assumptions!loan term (months)}-1)',
        },
        { label: 'Effective annual rent', fmt: 'currency', each: '={ROW:Assumptions!monthly rent}*12*(1-{ROW:Assumptions!vacancy rate})' },
        { label: 'Net operating income (NOI)', fmt: 'currency', each: '={ROW:Effective annual rent}-{ROW:Assumptions!annual operating costs}' },
        { label: 'Cap rate', fmt: 'percent', each: '=IF({ROW:Assumptions!purchase price}=0,0,{ROW:Net operating income (NOI)}/{ROW:Assumptions!purchase price})' },
        { label: 'Annual debt service', fmt: 'currency', each: '={ROW:Monthly mortgage payment}*12' },
        { label: 'Annual cash flow', fmt: 'currency', each: '={ROW:Net operating income (NOI)}-{ROW:Annual debt service}' },
        { label: 'Cash invested', fmt: 'currency', each: '={ROW:Assumptions!purchase price}*{ROW:Assumptions!down payment %}+{ROW:Assumptions!closing costs}' },
        { label: 'Cash-on-cash return', fmt: 'percent', each: '=IF({ROW:Cash invested}=0,0,{ROW:Annual cash flow}/{ROW:Cash invested})' },
        { label: 'DSCR', fmt: '0.00', each: '=IF({ROW:Annual debt service}=0,0,{ROW:Net operating income (NOI)}/{ROW:Annual debt service})' },
        { label: 'CHECK DSCR tie', fmt: '0.00', check: '={ROW:DSCR}*{ROW:Annual debt service}-{ROW:Net operating income (NOI)}' },
      ],
    },
  ];
}

function ecommercePnl(n: number): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('orders month 1', 800, '#,##0'), v('monthly order growth', 0.05, 'percent'), v('average order value', 180, 'currency'),
        v('return rate', 0.06, 'percent'), v('COGS % of net revenue', 0.45, 'percent'), v('payment and platform fees %', 0.03, 'percent'),
        v('shipping cost per order', 12, 'currency'),
      ],
    },
    {
      name: 'PnL',
      months: n,
      rows: [
        { label: 'Orders', fmt: '#,##0.0', first: '={ROW:Assumptions!orders month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly order growth})' },
        { label: 'Gross revenue', fmt: 'currency', each: '={ROW:Orders}*{ROW:Assumptions!average order value}' },
        { label: 'Returns', fmt: 'currency', each: '={ROW:Gross revenue}*{ROW:Assumptions!return rate}' },
        { label: 'Net revenue', fmt: 'currency', each: '={ROW:Gross revenue}-{ROW:Returns}' },
        { label: 'COGS', fmt: 'currency', each: '={ROW:Net revenue}*{ROW:Assumptions!COGS % of net revenue}' },
        { label: 'Fees', fmt: 'currency', each: '={ROW:Net revenue}*{ROW:Assumptions!payment and platform fees %}' },
        { label: 'Shipping', fmt: 'currency', each: '={ROW:Orders}*{ROW:Assumptions!shipping cost per order}' },
        { label: 'Contribution profit', fmt: 'currency', each: '={ROW:Net revenue}-{ROW:COGS}-{ROW:Fees}-{ROW:Shipping}' },
        { label: 'Contribution margin', fmt: 'percent', each: '=IF({ROW:Net revenue}=0,0,{ROW:Contribution profit}/{ROW:Net revenue})' },
        { label: 'CHECK contribution tie', fmt: '0.00', check: '={ROW:Contribution profit}-({ROW:Net revenue}-{ROW:COGS}-{ROW:Fees}-{ROW:Shipping})' },
      ],
    },
  ];
}

function attritionHeadcount(n: number): Sheet[] {
  return [
    { name: 'Assumptions', rows: [v('starting headcount', 120, '#,##0'), v('monthly hires', 6, '0'), v('monthly attrition rate', 0.015, 'percent')] },
    {
      name: 'Workforce',
      months: n,
      rows: [
        { label: 'Opening headcount', fmt: '#,##0.0', first: '={ROW:Assumptions!starting headcount}', then: '={ROW:Closing headcount[-1]}' },
        { label: 'Hires', fmt: '0', each: '={ROW:Assumptions!monthly hires}' },
        { label: 'Exits', fmt: '0.0', each: '={ROW:Opening headcount}*{ROW:Assumptions!monthly attrition rate}' },
        { label: 'Closing headcount', fmt: '#,##0.0', each: '={ROW:Opening headcount}+{ROW:Hires}-{ROW:Exits}' },
        { label: 'Net growth', fmt: '0.0', each: '={ROW:Hires}-{ROW:Exits}' },
        { label: 'Annualized attrition rate', fmt: 'percent', each: '={ROW:Assumptions!monthly attrition rate}*12' },
        { label: 'CHECK headcount roll-forward', fmt: '0.00', check: '={ROW:Closing headcount}-({ROW:Opening headcount}+{ROW:Hires}-{ROW:Exits})' },
      ],
    },
  ];
}

function abTest(): Sheet[] {
  return [
    {
      name: 'Assumptions',
      rows: [
        v('visitors A', 5000, '#,##0'), v('conversions A', 400, '#,##0'),
        v('visitors B', 5000, '#,##0'), v('conversions B', 460, '#,##0'),
      ],
    },
    {
      name: 'Results',
      months: 1,
      item_header: 'Line',
      month_headers: ['Value'],
      rows: [
        { label: 'Conversion rate A', fmt: '0.00%', each: '={ROW:Assumptions!conversions A}/{ROW:Assumptions!visitors A}' },
        { label: 'Conversion rate B', fmt: '0.00%', each: '={ROW:Assumptions!conversions B}/{ROW:Assumptions!visitors B}' },
        { label: 'Uplift %', fmt: 'percent', each: '=IF({ROW:Conversion rate A}=0,0,{ROW:Conversion rate B}/{ROW:Conversion rate A}-1)' },
        { label: 'Pooled conversion rate', fmt: '0.00%', each: '=({ROW:Assumptions!conversions A}+{ROW:Assumptions!conversions B})/({ROW:Assumptions!visitors A}+{ROW:Assumptions!visitors B})' },
        {
          label: 'Standard error', fmt: '0.0000',
          each: '=({ROW:Pooled conversion rate}*(1-{ROW:Pooled conversion rate})*(1/{ROW:Assumptions!visitors A}+1/{ROW:Assumptions!visitors B}))^0.5',
        },
        { label: 'Z-score', fmt: '0.00', each: '=IF({ROW:Standard error}=0,0,({ROW:Conversion rate B}-{ROW:Conversion rate A})/{ROW:Standard error})' },
        { label: 'Significant at 95% (1 = yes)', fmt: '0', each: '=IF(ABS({ROW:Z-score})>=1.96,1,0)' },
        {
          label: 'CHECK pooled rate lies between A and B', fmt: '0',
          check:
            '=IF({ROW:Pooled conversion rate}>={ROW:Conversion rate A},0,IF({ROW:Pooled conversion rate}>={ROW:Conversion rate B},0,1))+IF({ROW:Pooled conversion rate}<={ROW:Conversion rate A},0,IF({ROW:Pooled conversion rate}<={ROW:Conversion rate B},0,1))',
        },
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
  // FP&A
  { id: 'budget-vs-actual', blurb: 'budget vs actual variance (abs + %, cumulative) — replace the example Actual row with real data', build: budgetVsActual, defaultMonths: 12 },
  { id: 'cash-runway', blurb: 'startup burn: revenue vs costs, net burn, cash roll-forward, months of runway', build: cashRunway, defaultMonths: 18 },
  { id: 'break-even', blurb: 'contribution margin, break-even units/revenue + a volume sensitivity table (profit-at-BE=0 check)', build: breakEven, defaultMonths: 12 },
  { id: 'unit-economics', blurb: 'CAC, LTV (margin × lifetime), LTV:CAC, CAC payback months', build: () => unitEconomics(), defaultMonths: 1 },
  { id: 'npv-project', blurb: 'project appraisal: annual cash flows, recursive discounting, NPV + profitability index', build: npvProject, defaultMonths: 10 },
  { id: 'capex-depreciation', blurb: 'multi-asset straight-line depreciation schedule with start-month gating + net book value', build: capexDepreciation, defaultMonths: 24 },
  { id: 'working-capital', blurb: 'AR/inventory/AP from DSO/DIO/DPO, NWC + change, cash conversion cycle', build: workingCapital, defaultMonths: 12 },
  // Sales & marketing
  { id: 'sales-pipeline', blurb: 'lead → qualified → proposal → win funnel with conversion rates and revenue', build: salesPipeline, defaultMonths: 12 },
  { id: 'sales-commission', blurb: 'quota attainment + tiered commission (base rate to quota, accelerator above)', build: salesCommission, defaultMonths: 12 },
  { id: 'marketing-funnel', blurb: 'spend → impressions → clicks → leads → customers, CAC + ROAS', build: marketingFunnel, defaultMonths: 12 },
  // BI & analytics
  { id: 'kpi-dashboard', blurb: 'BI metric board: actual vs target, MoM %, AOV, revenue per user, on-target flags', build: kpiDashboard, defaultMonths: 12 },
  { id: 'cohort-retention', blurb: 'BI cohort curve: retention decay, active users, cumulative LTV per user', build: cohortRetention, defaultMonths: 12 },
  { id: 'ab-test', blurb: 'A/B test significance: conversion rates, uplift, pooled SE, z-score, 95% flag', build: () => abTest(), defaultMonths: 1 },
  // Operations & projects
  { id: 'inventory-planning', blurb: 'EOQ (ordering cost == holding cost check), reorder point, total annual cost', build: () => inventoryPlanning(), defaultMonths: 1 },
  { id: 'project-budget', blurb: 'project tracker: planned vs actual spend, % consumed, budget remaining', build: projectBudget, defaultMonths: 12 },
  // HR
  { id: 'attrition-headcount', blurb: 'workforce flow: opening/hires/exits/closing roll-forward + annualized attrition', build: attritionHeadcount, defaultMonths: 12 },
  // Personal finance & property
  { id: 'personal-budget', blurb: 'household budget: income, inflating expense lines, savings rate, cumulative savings', build: personalBudget, defaultMonths: 12 },
  { id: 'savings-goal', blurb: 'investment growth: contributions + compounding, progress to goal', build: savingsGoal, defaultMonths: 24 },
  { id: 'rental-property', blurb: 'real-estate deal: PMT mortgage, NOI, cap rate, cash-on-cash, DSCR', build: () => rentalProperty(), defaultMonths: 1 },
  // E-commerce
  { id: 'ecommerce-pnl', blurb: 'store P&L: GMV, returns, COGS, fees, shipping → contribution profit + margin', build: ecommercePnl, defaultMonths: 12 },
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
