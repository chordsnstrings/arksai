/**
 * Self-healing PHASE 1 — issue DETECTION + CLUSTERING (pure, unit-tested). No auto-fixing:
 * this half turns raw platform activity (run outcomes + user reactions) into a ranked, redacted
 * "what's breaking" digest for the operator. The dangerous half (an agent editing code) is
 * deliberately NOT here — Phase 1 only observes and reports.
 *
 * Privacy: everything user-visible is a SHORT REDACTED snippet (emails/URLs/ids/secrets stripped),
 * never a raw transcript, and the digest is operator-only.
 */

export type RemediationType = 'code' | 'prompt' | 'model' | 'environment' | 'knowledge' | 'user-error' | 'unknown';
export type SignalKind = 'run_error' | 'complaint';

/** One detected symptom — a failed run, or a user reacting badly to an output. */
export interface IssueSignal {
  kind: SignalKind;
  orgId: string | null;
  sessionId: string | null;
  ts: number;
  mode?: string; // chat / code / report
  deliverable?: string; // app / pdf / xlsx / …
  errorClass?: string; // normalized failure category (see classifyError)
  snippet?: string; // redacted, short — a representative example
}

/** A group of like signals — the unit the operator acts on. */
export interface IssueCluster {
  key: string;
  kind: SignalKind;
  title: string;
  count: number; // total occurrences
  orgs: number; // distinct tenants affected (cross-tenant ⇒ more severe)
  severity: number;
  remediation: RemediationType;
  mode?: string;
  deliverable?: string;
  errorClass?: string;
  firstTs: number;
  lastTs: number;
  examples: string[]; // up to 3 redacted snippets
}

/** Strip anything identifying or secret, collapse whitespace, and truncate — so a digest snippet
 *  can never carry a transcript, an email, a URL, an id, or a key. */
export function redactSnippet(text: string, max = 180): string {
  if (!text) return '';
  let s = String(text)
    .replace(/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, '‹email›')
    .replace(/https?:\/\/\S+/gi, '‹url›')
    .replace(/\b(sk|pk|api|ghp|xox|bearer|token|key)[-_][\w-]{5,}/gi, '‹key›') // incl. hyphenated keys (sk-cp-…)
    .replace(/\b[A-Fa-f0-9]{16,}\b/g, '‹hex›') // long hex ids / hashes
    .replace(/\b\d[\d\s()+-]{6,}\d\b/g, '‹num›') // phone/id-ish digit runs
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '‹uuid›')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…';
  return s;
}

/** A user turn that reads as a reaction to a BAD output (not an opening request). Deliberately
 *  conservative — a genuine complaint/error report, not mere iteration ("make it blue"). */
const COMPLAINT_RE =
  /\b(doesn'?t|does not|didn'?t|won'?t|can'?t|cannot)\s+(work|load|open|run|send|show|generate|build)|" ?\bnot working\b|\bstill (broken|not|isn'?t|doesn'?t|failing|wrong)\b|\bis broken\b|\bbroken\b|\bthis is wrong\b|\bthat'?s wrong\b|\bincorrect\b|\berror(s)?\b|\bfailed\b|\bfailing\b|\bcrash(ed|es|ing)?\b|\bbug\b|\bglitch\b|\bnothing happen|\bblank\b|\bnot (loading|showing|opening|sending)\b|\bwhy (is|does|isn'?t|doesn'?t)\b.*\b(not|broken|fail|wrong|blank|error)\b|\buseless\b|\bterrible\b|\bawful\b|\bstupid\b/i;

export function looksLikeComplaint(text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 3 || t.length > 2000) return false;
  return COMPLAINT_RE.test(t);
}

/** Normalize a terminal error message / session context into a coarse failure class. */
export function classifyError(text: string): string {
  const t = (text || '').toLowerCase();
  // Publish/deploy first — "smoke test failed" is a publish failure, not a unit-test failure.
  if (/publish|deploy|smoke|live url|apps\//.test(t)) return 'publish';
  if (/verif|gate|type-?check|typecheck|tsc|test suite|tests? fail|lint|build failed|compile/.test(t)) return 'verification';
  if (/budget|token limit|cutoff|max iterations|output (budget|limit)|out of (budget|tokens)/.test(t)) return 'budget';
  if (/stall|timed?\s*out|timeout|no output|hung|hang|still working/.test(t)) return 'stall';
  if (/egress|network|econn|proxy|dns|fetch failed|unreachable|allowlist|403|407|blocked/.test(t)) return 'network';
  if (/no recognizable project|produced no|no deliverable|nothing to verify|empty (output|result)/.test(t)) return 'no-deliverable';
  if (/insufficient_balance|quota|rate.?limit|429|1008/.test(t)) return 'provider-limit';
  return 'other';
}

/** The deterministic first-guess remediation type for a symptom (an optional model pass can refine
 *  this later; Phase 1 ships the heuristic so it works with no key and is fully testable). */
export function remediationFor(kind: SignalKind, errorClass?: string): RemediationType {
  if (kind === 'complaint') return 'prompt'; // quality reactions are usually prompt/model, not a crash
  switch (errorClass) {
    case 'verification':
    case 'publish':
    case 'no-deliverable':
      return 'code';
    case 'budget':
      return 'model';
    case 'stall':
    case 'network':
      return 'environment';
    case 'provider-limit':
      return 'environment';
    default:
      return 'unknown';
  }
}

/** The clustering signature: like symptoms collapse to one row. */
export function signatureOf(s: IssueSignal): string {
  return s.kind === 'run_error'
    ? `run_error/${s.mode ?? '-'}/${s.deliverable ?? '-'}/${s.errorClass ?? 'other'}`
    : `complaint/${s.mode ?? '-'}/${s.deliverable ?? '-'}`;
}

function titleFor(s: IssueSignal): string {
  const where = [s.mode, s.deliverable].filter((x) => x && x !== '-').join(' · ');
  if (s.kind === 'run_error') {
    const cls = s.errorClass ?? 'other';
    const label: Record<string, string> = {
      verification: 'Builds failing the quality gate',
      budget: 'Runs hitting the budget/token cutoff',
      stall: 'Runs stalling / timing out',
      publish: 'Publishing / live-URL failures',
      network: 'Network / egress failures',
      'no-deliverable': 'Runs finishing with no deliverable',
      'provider-limit': 'Model provider limit / balance errors',
      other: 'Runs ending in error',
    };
    return `${label[cls] ?? label.other}${where ? ` (${where})` : ''}`;
  }
  return `Users reporting problems${where ? ` (${where})` : ''}`;
}

/** frequency × kind-weight × cross-tenant multiplier. A run error weighs more than a single
 *  grumble; an issue spanning many tenants weighs more than a one-tenant blip. */
export function severityOf(count: number, orgs: number, kind: SignalKind): number {
  const kindWeight = kind === 'run_error' ? 3 : 2;
  const spread = 1 + Math.min(orgs, 10) * 0.5; // more tenants → more severe (capped)
  return Math.round(count * kindWeight * spread);
}

/** Collapse signals into ranked clusters (most severe first). Pure. */
export function clusterSignals(signals: IssueSignal[]): IssueCluster[] {
  const byKey = new Map<string, IssueSignal[]>();
  for (const s of signals) {
    const k = signatureOf(s);
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(s);
  }
  const clusters: IssueCluster[] = [];
  for (const [key, group] of byKey) {
    const orgs = new Set(group.map((g) => g.orgId ?? '·')).size;
    const first = group[0];
    const examples: string[] = [];
    for (const g of group) {
      if (g.snippet && examples.length < 3 && !examples.includes(g.snippet)) examples.push(g.snippet);
    }
    clusters.push({
      key,
      kind: first.kind,
      title: titleFor(first),
      count: group.length,
      orgs,
      severity: severityOf(group.length, orgs, first.kind),
      remediation: remediationFor(first.kind, first.errorClass),
      mode: first.mode,
      deliverable: first.deliverable,
      errorClass: first.errorClass,
      firstTs: Math.min(...group.map((g) => g.ts)),
      lastTs: Math.max(...group.map((g) => g.ts)),
      examples,
    });
  }
  return clusters.sort((a, b) => b.severity - a.severity || b.count - a.count);
}
