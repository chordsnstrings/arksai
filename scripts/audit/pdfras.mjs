import fs from 'fs';
const mupdf = await import('mupdf');
const doc = mupdf.Document.openDocument(fs.readFileSync(process.argv[2]), 'application/pdf');
const n = doc.countPages(); console.log('pages:', n);
for (let i=0;i<Math.min(n,3);i++){ const pg=doc.loadPage(i); const px=pg.toPixmap(mupdf.Matrix.scale(1.5,1.5), mupdf.ColorSpace.DeviceRGB, false, true); fs.writeFileSync(`/tmp/report-p${i+1}.png`, Buffer.from(px.asPNG())); }
console.log('rasterized', Math.min(n,3), 'pages');
