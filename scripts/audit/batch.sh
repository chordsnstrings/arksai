#!/bin/bash
cd /home/user/arksai
run() { AUDIT_DEADLINE_MS=420000 timeout 450 node scripts/audit/run-play.mjs "$@" >> /tmp/audit-batch.log 2>&1; echo "DONE $1" >> /tmp/audit-batch.log; }
run finance.cashflow code deepseek-v4-flash "Build a 12-month cash-flow forecast model for a SaaS startup: an Assumptions sheet (MRR, growth %, churn, headcount cost) driving a monthly Cash Flow sheet with formula-driven revenue, costs, net cash and ending balance. Make it formula-driven, not hard-coded."
run bi.dashboard code deepseek-v4-flash "Build an interactive sales KPI dashboard web app from this data: monthly revenue, deals won, pipeline. Headline KPIs with period-over-period change, a trend chart, and a couple of filters. Pick a clean teal palette. Verify it works and keep it runnable."
run tax.wps code deepseek-v4-flash "Generate a WPS SIF salary file for a 5-employee Dubai company for this month, plus a payroll reconciliation. Invent realistic employee IDs, IBANs and salaries; ensure the SCR total equals the sum of the EDR records."
run finance.boardupdate report deepseek-v4-pro "Create a 1-page investor update PDF for a SaaS startup: headline KPIs (MRR, growth, runway), a short narrative on the quarter, and next steps. Clean editorial design, one accent colour."
echo "ALL DONE" >> /tmp/audit-batch.log
