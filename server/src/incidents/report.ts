import { config } from '../config';
import type { Incident } from './store';

/** Build the GitHub issue body an auto-fix agent (Claude Code trigger) will act on. */
export function buildIssueBody(inc: Incident): string {
  const ctx = inc.context ? '```json\n' + JSON.stringify(inc.context, null, 2).slice(0, 3000) + '\n```' : '_none_';
  return [
    `**Auto-filed by ArksAI self-healing.** Fingerprint \`${inc.fingerprint}\`.`,
    '',
    `- **Kind:** ${inc.kind}  · **Severity:** ${inc.severity}  · **Count:** ${inc.count}`,
    `- **Session:** ${inc.sessionId ?? '—'}  · **Org:** ${inc.orgId ?? '—'}`,
    '',
    '### Detail',
    '```',
    (inc.detail ?? '(none)').slice(0, 3000),
    '```',
    '### Context',
    ctx,
    '',
    '### What to do',
    'Reproduce (recreate the failing run via the API harness or locally), find the root cause, fix it,',
    'run the gate (`npm run typecheck && npm test && npm run build`), and open a PR. Do NOT ship a red gate.',
    'Only auto-merge low-risk classes (timeout/stall/tool_error/http_5xx/cost_spike); never touch auth/billing/data paths.',
  ].join('\n');
}

/** File (or comment on) a GitHub issue for a fresh incident. Best-effort; gated on a
 *  token + repo. Returns the issue URL or null. */
export async function fileIncidentIssue(inc: Incident): Promise<string | null> {
  if (!config.autoHeal || !config.githubToken || !config.autoHealRepo) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${config.autoHealRepo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'arksai-selfheal',
      },
      body: JSON.stringify({
        title: `[auto-fix] ${inc.title}`.slice(0, 250),
        body: buildIssueBody(inc),
        labels: ['auto-fix', `sev:${inc.severity}`, `kind:${inc.kind}`],
      }),
    });
    if (!res.ok) {
      console.warn(`[incidents] issue file failed HTTP ${res.status}`);
      return null;
    }
    const j: any = await res.json();
    return j.html_url ?? null;
  } catch (e) {
    console.warn('[incidents] issue file error:', (e as any)?.message ?? e);
    return null;
  }
}
