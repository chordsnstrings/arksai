import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDcf,
  computeRatios,
  computeVariance,
  computeForecast,
  linearRegression,
} from '../src/agent/tools/computeFinancials';

test('dcf: known case — flat 100 FCF, 10% WACC, 2% growth', () => {
  const r: any = computeDcf({ cash_flows: [100, 100, 100, 100, 100], discount_rate: 0.1, terminal_growth: 0.02 });
  assert.ok(!r.error);
  // PV of 5×100 at 10%, each year rounded then summed: 90.91+82.64+75.13+68.30+62.09 = 379.07
  assert.equal(r.pv_cash_flows, 379.07);
  assert.deepEqual(r.pv_by_year, [90.91, 82.64, 75.13, 68.3, 62.09]);
  // Terminal value = 100*(1.02)/(0.10-0.02) = 1275; PV = 1275 / 1.1^5 = 791.67
  assert.equal(r.terminal_value, 1275);
  assert.equal(r.pv_terminal_value, 791.67);
  assert.equal(r.enterprise_value, round2(r.pv_cash_flows + r.pv_terminal_value));
});

test('dcf: percent rates auto-normalize; equity + per-share computed', () => {
  const r: any = computeDcf({ cash_flows: [100, 100], discount_rate: 10, terminal_growth: 2, net_debt: 50, shares_outstanding: 10 });
  assert.ok(!r.error);
  assert.equal(r.inputs.wacc, 0.1);
  assert.equal(typeof r.equity_value, 'number');
  assert.equal(r.equity_value, round2(r.enterprise_value - 50));
  assert.equal(r.value_per_share, round4(r.equity_value / 10));
});

test('dcf: growth >= wacc warns and zeroes terminal value', () => {
  const r: any = computeDcf({ cash_flows: [100], discount_rate: 0.05, terminal_growth: 0.08 });
  assert.equal(r.terminal_value, 0);
  assert.ok(r.warnings.length >= 1);
});

test('ratios: known case', () => {
  const r: any = computeRatios({
    income_statement: { revenue: 1000, cost_of_goods_sold: 600, operating_income: 200, net_income: 150, interest_expense: 20 },
    balance_sheet: { total_equity: 750, total_assets: 1500, current_assets: 400, current_liabilities: 200, inventory: 100, cash_and_equivalents: 50, accounts_receivable: 200, total_debt: 300 },
    cash_flow: { operating_cash_flow: 180, total_debt_service: 60 },
  });
  assert.equal(r.profitability.gross_margin.value, 0.4); // (1000-600)/1000
  assert.equal(r.profitability.net_margin.value, 0.15);
  assert.equal(r.profitability.roe.value, 0.2); // 150/750
  assert.equal(r.liquidity.current_ratio.value, 2); // 400/200
  assert.equal(r.liquidity.quick_ratio.value, 1.5); // (400-100)/200
  assert.equal(r.leverage.debt_to_equity.value, 0.4); // 300/750
  assert.equal(r.leverage.interest_coverage.value, 10); // 200/20
  assert.equal(r.efficiency.inventory_turnover.value, 6); // 600/100
});

test('ratios: safe-divide on zero denominators + warnings', () => {
  const r: any = computeRatios({ income_statement: { revenue: 0 }, balance_sheet: { total_equity: 0 } });
  assert.equal(r.profitability.roe.value, 0);
  assert.ok(r.warnings.length >= 1);
});

test('variance: favourable/unfavourable classification + totals', () => {
  const r: any = computeVariance({
    line_items: [
      { name: 'Sales', type: 'revenue', actual: 1200, budget: 1000 },
      { name: 'Marketing', type: 'expense', actual: 300, budget: 250 },
      { name: 'Rent', type: 'expense', actual: 90, budget: 100, prior_year: 80 },
    ],
  });
  const sales = r.lines.find((l: any) => l.name === 'Sales');
  assert.equal(sales.variance_amount, 200);
  assert.equal(sales.variance_pct, 20);
  assert.equal(sales.favourability, 'Favourable'); // revenue over budget = good
  const mkt = r.lines.find((l: any) => l.name === 'Marketing');
  assert.equal(mkt.favourability, 'Unfavourable'); // expense over budget = bad
  const rent = r.lines.find((l: any) => l.name === 'Rent');
  assert.equal(rent.favourability, 'Favourable'); // expense under budget = good
  assert.equal(rent.prior_year_variance_amount, 10); // 90 - 80
  assert.equal(r.totals.actual, 1590);
  assert.equal(r.totals.budget, 1350);
  assert.equal(r.totals.variance_amount, 240);
});

test('forecast: linear regression on a perfect line', () => {
  const { slope, intercept, r2 } = linearRegression([1, 2, 3, 4], [10, 20, 30, 40]);
  assert.equal(round2(slope), 10);
  assert.equal(round2(intercept), 0);
  assert.equal(round2(r2), 1);
});

test('forecast: linear projection continues the trend', () => {
  const r: any = computeForecast({ history: [10, 20, 30, 40], periods: 2, method: 'linear' });
  assert.ok(!r.error);
  assert.deepEqual(r.projected, [50, 60]);
  assert.equal(r.trend.direction, 'upward');
});

test('forecast: growth method compounds the average growth rate', () => {
  const r: any = computeForecast({ history: [100, 110, 121], periods: 1, method: 'growth' });
  assert.ok(!r.error);
  assert.equal(r.average_growth_rate, 0.1); // both steps were +10%
  assert.equal(r.projected[0], 133.1); // 121 * 1.1
});

test('forecast: too little history errors', () => {
  const r: any = computeForecast({ history: [5] });
  assert.ok(r.error);
});

function round2(v: number) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
function round4(v: number) {
  return Math.round((v + Number.EPSILON) * 10000) / 10000;
}
