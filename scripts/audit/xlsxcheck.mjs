import fs from 'fs';
const XLSX = await import('xlsx');
const { auditFormulaModel } = await import('/home/user/arksai/server/dist/server/src/agent/deliverableCheck.js');
const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type:'buffer' });
console.log('sheets:', wb.SheetNames.join(', '));
let total=0, formulas=0;
for (const n of wb.SheetNames) { const s=wb.Sheets[n]; let f=0; for (const a of Object.keys(s)){ if(a[0]==='!')continue; total++; if(s[a].f) f++; } formulas+=f; console.log(`  ${n}: ${f} formula cells`); }
console.log('TOTAL formula cells:', formulas);
const audit = auditFormulaModel(wb);
console.log('auditFormulaModel:', JSON.stringify(audit), audit.isModel ? '← FLAGGED (hard-coded!)' : '← OK (formula-driven)');
