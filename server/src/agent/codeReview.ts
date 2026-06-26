// Code-review gate: a second-model pass over the actual git DIFF, hunting CORRECTNESS
// regressions/security/leftover-debug — the thing the verify gate (which only proves the
// code builds + boots) can't see. Pure prompt-builder + verdict-parser so it's unit-tested;
// the model call + bounded-revise wiring lives in runner.ts (mirrors the design gate).

export interface ReviewVerdict {
  verdict: 'approve' | 'revise';
  findings: string[]; // concrete, fixable problems (empty when approved)
}

/** System + user messages for the reviewer. ONLY the diff is in scope. */
export function buildReviewPrompt(diff: string, opts: { repoName?: string | null } = {}): {
  system: string;
  user: string;
} {
  const where = opts.repoName ? ` in the repository ${opts.repoName}` : '';
  const system =
    `You are a meticulous senior software engineer reviewing a colleague's change${where}. ` +
    `You are given a unified git diff. Review ONLY what this diff changes — find real defects it INTRODUCES:\n` +
    `- correctness bugs (off-by-one, wrong operator/condition, null/undefined, await missing, wrong variable);\n` +
    `- regressions (a changed function/contract that breaks an existing caller, a removed case still relied on);\n` +
    `- security issues (injection, missing authz/validation on a NEW path, a leaked secret/token);\n` +
    `- left-behind cruft on a new code path (debug logging, a hard-coded test value, a TODO that blocks, dead code);\n` +
    `- an obviously missing error/edge case on a path this diff adds.\n\n` +
    `Do NOT comment on style, formatting, naming, or anything OUTSIDE the diff. Do NOT restate what the code does. ` +
    `Be conservative: only flag an issue you are genuinely confident is real and was introduced here — a noisy ` +
    `reviewer is worse than none. If the change is correct, APPROVE.\n\n` +
    `Respond with STRICT JSON only:\n` +
    `{"verdict":"approve"|"revise","findings":[{"file":"path","issue":"the concrete problem AND how to fix it, one sentence"}]}\n` +
    `Use "revise" only when findings is non-empty. Approve with "findings":[] when there is nothing real to fix.`;
  const user = `Review this diff:\n\n${diff}`;
  return { system, user };
}

/**
 * Parse the reviewer's reply into a verdict. FAIL-OPEN: anything we can't parse, or a "revise"
 * with no concrete findings, is treated as APPROVE — a wrongly-blocking review would stall a
 * good ship, which is worse than missing one issue (the verify gate already proved it runs).
 */
export function parseReviewVerdict(text: string): ReviewVerdict {
  const approve: ReviewVerdict = { verdict: 'approve', findings: [] };
  if (!text || !text.trim()) return approve;
  const obj = extractJson(text);
  if (!obj) return approve;
  const rawFindings = Array.isArray(obj.findings) ? obj.findings : [];
  const findings = rawFindings
    .map((f: any) => {
      if (typeof f === 'string') return f.trim();
      if (f && typeof f === 'object') {
        const file = String(f.file ?? f.path ?? '').trim();
        const issue = String(f.issue ?? f.problem ?? f.message ?? f.description ?? '').trim();
        return [file && `${file}:`, issue].filter(Boolean).join(' ').trim();
      }
      return '';
    })
    .filter((s: string) => s.length > 0)
    .slice(0, 12); // bound the feedback we push back
  const wantsRevise = String(obj.verdict ?? '').toLowerCase() === 'revise';
  // Require BOTH a revise verdict and at least one concrete finding to block.
  if (wantsRevise && findings.length) return { verdict: 'revise', findings };
  return approve;
}

/** Find the first balanced JSON object in a string (handles ```json fences and surrounding prose). */
function extractJson(text: string): any | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  // Walk to the matching closing brace so trailing prose doesn't break the parse.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
