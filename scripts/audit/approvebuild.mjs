import fs from 'fs';
const pw=(fs.readFileSync('.env','utf8').match(/APP_PASSWORD=(.+)/)||[])[1].trim();
const base='http://localhost:3000'; let cookie='';
async function api(p,init={}){const h={...(init.headers||{})};if(cookie)h.Cookie=cookie;if(init.body)h['Content-Type']='application/json';const r=await fetch(base+p,{...init,headers:h});const sc=r.headers.getSetCookie?.()||[];if(sc.length)cookie=sc.map(c=>c.split(';')[0]).join('; ');return r;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(id,max){const t=Date.now();let s='running';while(Date.now()-t<max){await sleep(5000);const m=await(await api(`/api/sessions/${id}`)).json().catch(()=>null);s=m?.meta?.status??s;process.stdout.write(`\r  ${Math.round((Date.now()-t)/1000)}s ${s}   `);if(s!=='running')break;}console.log('');return s;}
async function meta(id){return (await(await api(`/api/sessions/${id}`)).json()).meta;}
await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:pw})});
const sess=await(await api('/api/sessions',{method:'POST',body:JSON.stringify({mode:'chat',model:'arksai-auto'})})).json();
console.log('session',sess.id);
console.log('1) sending build request → expect PLAN + submit_plan');
await api(`/api/sessions/${sess.id}/messages`,{method:'POST',body:JSON.stringify({text:'Build me a simple tip calculator web page — enter a bill and tip %, see the tip and total. Clean and minimal.'})});
await poll(sess.id, 240000);
let m=await meta(sess.id); console.log('   after plan: status=%s awaitingPlan=%s mode=%s', m.status, m.awaitingPlan, m.mode);
console.log('2) sending canonical APPROVE → expect it BUILDS (not re-plan)');
await api(`/api/sessions/${sess.id}/messages`,{method:'POST',body:JSON.stringify({text:'Approved — build it now, end to end and autonomously. No more check-ins.'})});
await poll(sess.id, 420000);
m=await meta(sess.id);
const d=await(await api(`/api/sessions/${sess.id}`)).json();
const files=(d.timeline||[]).filter(t=>t.kind==='file').map(t=>t.name);
const tools=[...new Set((d.timeline||[]).filter(t=>t.kind==='tools').flatMap(t=>t.calls.map(c=>c.tool)))];
console.log('   after approve: status=%s awaitingPlan=%s mode=%s', m.status, m.awaitingPlan, m.mode);
console.log('   tools used:', tools.join(', '));
console.log('   files produced:', files.join(', ')||'(none)');
console.log('   VERDICT:', (m.mode==='code'||files.length||tools.includes('write_file')) && !m.awaitingPlan ? 'BUILT ✓ (approve started the build, no re-plan loop)' : 'DID NOT BUILD ✗');
