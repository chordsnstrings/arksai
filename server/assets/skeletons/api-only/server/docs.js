// The self-documenting index page — server-rendered, zero dependencies, styled inline.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function docsPage(endpoints) {
  const rows = endpoints
    .map(
      (e) => `<tr><td class="m ${e.method.toLowerCase()}">${e.method}</td><td class="p">${esc(e.path)}</td>` +
        `<td class="a">${e.auth ? 'API key' : 'public'}</td><td>${esc(e.desc)}</td></tr>`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>__APP_NAME__ · API</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; font:15px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color:#1b2430; background:#fafaf7; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 48px 24px 80px; }
  h1 { font-size: 26px; letter-spacing: -.02em; margin: 0 0 6px; }
  .sub { color:#5b6572; margin: 0 0 28px; }
  table { width:100%; border-collapse: collapse; background:#fff; border:1px solid #e4e2da; border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding: 10px 14px; border-bottom: 1px solid #eeece5; font-size: 13.5px; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing:.07em; color:#8a8577; background:#f5f4ef; }
  tr:last-child td { border-bottom: 0; }
  .m { font-weight: 700; font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  .m.get { color:#22754c; } .m.post { color:#8a5a1f; } .m.delete { color:#a13434; } .m.patch { color:#4a5aa8; }
  .p { font-family: ui-monospace, monospace; font-size: 12.5px; white-space: nowrap; }
  .a { color:#5b6572; white-space: nowrap; }
  code { background:#f0efe9; border-radius:5px; padding: 1px 6px; font-size: 12.5px; }
  .card { background:#fff; border:1px solid #e4e2da; border-radius:10px; padding: 16px 18px; margin-top: 20px; }
  @media (max-width: 640px) { .wrap { padding: 28px 14px 60px; } table, thead, tbody, tr { display:block; }
    th { display:none; } td { display:block; border-bottom:0; padding: 3px 14px; } tr { border-bottom: 1px solid #eeece5; padding: 9px 0; } }
</style></head><body><div class="wrap">
<h1>__APP_NAME__</h1>
<p class="sub">__APP_DESCRIPTION__</p>
<table><thead><tr><th>Method</th><th>Path</th><th>Auth</th><th>What it does</th></tr></thead><tbody>
${rows}
</tbody></table>
<div class="card">
  <strong>Authentication.</strong> Send your key on every request: <code>X-API-Key: &lt;key&gt;</code>
  (or <code>Authorization: Bearer &lt;key&gt;</code>). The first key is printed once by
  <code>npm run seed</code>. Errors always return JSON: <code>{ "error": "reason" }</code>.
</div>
</div></body></html>`;
}
