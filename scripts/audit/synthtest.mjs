import fs from 'fs';
for (const line of fs.readFileSync('.env','utf8').split('\n')) { const m=line.match(/^([A-Z0-9_]+)=(.*)$/); if(m) process.env[m[1]]=m[2].trim(); }
const { generateCreativeTool } = await import('/home/user/arksai/server/dist/server/src/agent/tools/creative.js');
fs.mkdirSync('/tmp/creative-synth', { recursive: true });
const ctx = { repoDir: '/tmp/creative-synth', signal: new AbortController().signal, addCost: ()=>{}, mode: 'chat', session: {} };
// EXACT malformed shape from the screenshot: copy fields, NO imagery prompt
const args = { aspect_ratio: '1:1', headline: 'UK TOURIST VISA', subhead: 'Fast & Accurate Processing', bullets: ['Quick Turnaround','Correct Documentation','Embassy-Ready Files'], logo_placeholder: true };
const res = await generateCreativeTool.run(args, ctx);
console.log('RESULT:', res.slice(0, 200));
console.log('errored?', res.startsWith('Error') || res.includes('IS available'));
