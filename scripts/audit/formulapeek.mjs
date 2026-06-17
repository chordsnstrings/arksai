import fs from 'fs';
const XLSX = await import('xlsx');
const wb = XLSX.read(fs.readFileSync(process.argv[2]), { type:'buffer' });
const cf = wb.Sheets['12 Month Cash Flow Forecast'] || wb.Sheets[wb.SheetNames.find(n=>/cash/i.test(n))];
// print formulas for the first few data columns of a few rows (B..E for Jan/Feb)
for (const addr of ['B3','C3','B4','C4','G3','G4','G5','N3','N4']) {
  const c = cf[addr]; if (c) console.log(addr, '=', c.f ? '{f: '+c.f+', v: '+c.v+'}' : 'literal '+c.v);
}
