/**
 * COMPLETE structural audit of EVERY play in the catalog (all 88, all 8 departments).
 * No model calls — deterministic config validation that catches a broken play before a
 * user ever hits it: does the key resolve to real expertise, is the mode/model/prompt
 * valid, does the play's mode actually grant the tools its prompt promises.
 * Run: npx tsx --tsconfig scripts/audit/tsconfig.json scripts/audit/play-audit.mts
 */
import { DEPARTMENTS } from '../../client/src/lib/departments';
import { expertiseFor } from '../../server/src/agent/expertise';
import { getToolsForMode } from '../../server/src/agent/tools';
import { SESSION_MODES, AUTO_MODEL, MAX_MODEL, KNOWN_MODELS, MODELS, DEFAULT_MODEL } from '../../shared/types';

const validModel = (m: string | undefined) =>
  m === undefined || m === AUTO_MODEL || m === MAX_MODEL || m === DEFAULT_MODEL || m in KNOWN_MODELS || MODELS.includes(m as any);

const DEPTS = new Set(['marketing', 'sales', 'finance', 'people', 'engineering', 'bi', 'tax', 'legal']);
// Which tool a prompt implies it needs → must be present in that play's mode toolset.
const NEEDS: { re: RegExp; tool: string; label: string }[] = [
  { re: /\bpublish\b|live url|shareable/i, tool: 'publish_app', label: 'publish' },
  { re: /\.pptx|slide deck|16:9|pitch deck/i, tool: 'generate_pptx', label: 'pptx' },
  { re: /\.xlsx|spreadsheet|formula-driven|cash ?flow|model/i, tool: 'generate_spreadsheet', label: 'xlsx' },
  { re: /\.docx|editable doc|offer letter|policy|memo/i, tool: 'generate_doc', label: 'docx' },
  { re: /\bPDF\b|report|render_report/i, tool: 'render_report', label: 'report' },
  { re: /generate a real|on-brand (hero|ad|image|creative)|social (post|creative)/i, tool: 'generate_creative', label: 'creative' },
  { re: /fetch|public (csv|link|sheet)|CSV\/JSON|published-Sheet/i, tool: 'fetch_data', label: 'fetch_data' },
  { re: /webhook|Slack\/|post to a slack/i, tool: 'send_webhook', label: 'webhook' },
];

let total = 0;
const fails: string[] = [];
const warns: string[] = [];

for (const dept of DEPARTMENTS as any[]) {
  for (const p of dept.plays) {
    total++;
    const id = p.key;
    // 1. key + dept
    if (!/^[a-z]+\.[a-z_]+$/.test(id)) fails.push(`${id}: malformed key`);
    if (!DEPTS.has(id.split('.')[0])) fails.push(`${id}: unknown dept`);
    if (id.split('.')[0] !== dept.id) fails.push(`${id}: key dept != catalog dept ${dept.id}`);
    // 2. expertise resolves + substantial
    const exp = expertiseFor(id);
    if (!exp) fails.push(`${id}: expertiseFor → null (no persona/standards)`);
    else if (exp.length < 60) warns.push(`${id}: expertise thin (${exp.length} chars)`);
    // 3. mode
    if (!SESSION_MODES.includes(p.mode)) fails.push(`${id}: invalid mode "${p.mode}"`);
    // 4. model
    if (!validModel(p.model)) fails.push(`${id}: invalid model "${p.model}"`);
    // 5. prompt
    if (typeof p.prompt !== 'string' || p.prompt.trim().length < 40) fails.push(`${id}: prompt too short/missing`);
    // 6. title + category
    if (!p.title || typeof p.title !== 'string') fails.push(`${id}: missing title`);
    if (!['create', 'analyze', 'operate'].includes(p.category)) fails.push(`${id}: bad category "${p.category}"`);
    // 7. the mode actually grants the tools the prompt promises
    const toolset = getToolsForMode(p.mode) as any;
    const names = new Set<string>([...(toolset.map?.keys?.() ?? [])]);
    for (const n of NEEDS) {
      if (n.re.test(p.prompt) && names.size && !names.has(n.tool)) {
        // chat mode legitimately re-routes to code/report, so only flag code/report-mode plays
        if (p.mode === 'code' || p.mode === 'report') warns.push(`${id}: prompt implies ${n.label} but mode ${p.mode} lacks ${n.tool}`);
      }
    }
  }
}

console.log(`Audited ${total} plays across ${DEPARTMENTS.length} departments.`);
console.log(`FAILS: ${fails.length}`);
fails.forEach((f) => console.log('  ✗ ' + f));
console.log(`WARNINGS: ${warns.length}`);
warns.slice(0, 40).forEach((w) => console.log('  ⚠ ' + w));
if (fails.length) process.exit(1);
console.log('\n✅ Every play has a valid key, resolves to expertise, and has a valid mode/model/prompt/title/category.');
