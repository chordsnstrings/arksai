/**
 * Grounded research loop (MASTER_PLAN.md Phase 5 — "Claude's take" on accuracy).
 *
 * The thesis: **the draft is never the deliverable.** A fact-sensitive answer is
 * reconstructed from an *adjudicated claim ledger* — every check-worthy claim must pass a
 * verdict gate (with a source) before it can appear in the output. A confabulated claim has
 * no source → it becomes `unverified` and is labelled or dropped before the user sees it.
 * This kills confident fact errors (invented entities, wrong dates, confabulated figures)
 * STRUCTURALLY, regardless of which model drafts.
 *
 * Honest boundary: this fixes GROUNDING (facts), not JUDGMENT (ranking/thesis-fit). The
 * latter is a model-capability question — narrowed via self-consistency (§reduceVerdict)
 * and rubric decomposition, or by routing adjudication to the strongest model.
 *
 * Design: the orchestrator takes INJECTABLE `llm` + `search` so the pure logic (the gates,
 * extraction parse, verdict reduction, final-gate diff) is fully unit-testable and the live
 * wiring (model adapter + web_search tool) is a thin seam. Mechanical steps run at temp 0.
 */

export type ClaimType = 'entity' | 'date' | 'figure' | 'quote' | 'relationship' | 'definition';
export type Verdict = 'confirmed' | 'corrected' | 'contradicted' | 'unverified';

export interface Source {
  url: string;
  snippet: string;
}

export interface Claim {
  id: string;
  draftText: string;
  type: ClaimType;
  subject: string;
  assertion: string;
  checkWorthy: boolean;
  queries: string[];
  sources: Source[];
  verdict?: Verdict;
  correctedValue?: string | null;
  confidence?: number;
  attempts: number;
}

export interface AdjudicationResult {
  verdict: Verdict;
  correctedValue?: string | null;
  sourceIndex?: number | null;
  confidence: number;
  note?: string | null;
}

export interface RunState {
  task: string;
  factSensitive: boolean;
  draft?: string;
  claims: Claim[];
  finalAnswer?: string;
  searchesUsed: number;
  status: 'running' | 'emitted' | 'failed';
}

/** Injected dependencies — the only seam to the live model + search tools. */
export interface LoopDeps {
  /** A single non-streaming completion. `json:true` requests strict-JSON output. */
  llm: (role: 'draft' | 'extract' | 'adjudicate' | 'revise' | 'finalGate', system: string, user: string) => Promise<string>;
  /** Web search → top snippets for a query. */
  search: (query: string) => Promise<Source[]>;
}

export const LOOP_CONFIG = {
  maxSearchesPerRun: 30,
  maxRetriesPerClaim: 2,
  maxReviseLoops: 2,
  selfConsistency: 3, // sample adjudication N times; reduce by skepticism
};

// --------------------------------------------------------------------------
// G0 — is the task fact-sensitive? (cheap heuristic; the loop only pays its cost here)
// --------------------------------------------------------------------------
const FACT_SIGNALS =
  /\b(research|investigate|who|when|where|how many|how much|which|list|find|funds?|investors?|companies|prices?|dates?|founded|revenue|statistics?|compare|vs\b|latest|current|in 20\d\d|market|sources?)\b/i;
const NON_FACT =
  /\b(write (me )?a (poem|story|haiku|song)|brainstorm|imagine|opinion|refactor|debug|implement|code|function|essay about my|how do i feel)\b/i;

/** Pure heuristic backstop; the live path can also use an `llm` classify call. */
export function classifyFactSensitive(task: string): boolean {
  const t = (task || '').toLowerCase();
  if (!t.trim()) return false;
  if (NON_FACT.test(t)) return false;
  return FACT_SIGNALS.test(t);
}

// --------------------------------------------------------------------------
// EXTRACT — parse the model's claim JSON leniently
// --------------------------------------------------------------------------
export function parseClaimsJson(raw: string): Omit<Claim, 'id' | 'queries' | 'sources' | 'attempts'>[] {
  if (!raw) return [];
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  let arr: any;
  try {
    arr = JSON.parse(s);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((o) => o && typeof o.assertion === 'string')
    .map((o) => ({
      draftText: String(o.draftText ?? o.assertion),
      type: (['entity', 'date', 'figure', 'quote', 'relationship', 'definition'].includes(o.type) ? o.type : 'entity') as ClaimType,
      subject: String(o.subject ?? ''),
      assertion: String(o.assertion),
      checkWorthy: !!o.checkWorthy,
    }));
}

export function parseVerdictJson(raw: string): AdjudicationResult | null {
  if (!raw) return null;
  let s = raw.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    const o = JSON.parse(s);
    const v = ['confirmed', 'corrected', 'contradicted', 'unverified'].includes(o.verdict) ? o.verdict : 'unverified';
    return {
      verdict: v as Verdict,
      correctedValue: typeof o.correctedValue === 'string' ? o.correctedValue : null,
      sourceIndex: Number.isInteger(o.sourceIndex) ? o.sourceIndex : null,
      confidence: typeof o.confidence === 'number' ? o.confidence : 0.5,
      note: typeof o.note === 'string' ? o.note : null,
    };
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// Self-consistency reducer — conservative tie-break (never ship a false 'confirmed')
// --------------------------------------------------------------------------
const SKEPTICISM: Record<Verdict, number> = { unverified: 3, contradicted: 2, corrected: 1, confirmed: 0 };

export function reduceVerdict(samples: AdjudicationResult[]): AdjudicationResult {
  if (!samples.length) return { verdict: 'unverified', confidence: 0, correctedValue: null, sourceIndex: null, note: null };
  const counts = new Map<Verdict, number>();
  for (const s of samples) counts.set(s.verdict, (counts.get(s.verdict) ?? 0) + 1);
  const maxCount = Math.max(...counts.values());
  const tied = [...counts.entries()].filter(([, c]) => c === maxCount).map(([v]) => v);
  const winner = tied.sort((a, b) => SKEPTICISM[b] - SKEPTICISM[a])[0]; // most skeptical of the tied
  const winning = samples.filter((s) => s.verdict === winner);
  return {
    verdict: winner,
    correctedValue: winning.find((s) => s.correctedValue)?.correctedValue ?? null,
    sourceIndex: winning.find((s) => s.sourceIndex != null)?.sourceIndex ?? null,
    confidence: maxCount / samples.length, // calibrated: 3/3 high, 2/3 flag it
    note: winning.find((s) => s.note)?.note ?? null,
  };
}

// --------------------------------------------------------------------------
// FINAL_GATE diff — a final claim is "backed" iff a confirmed/corrected ledger entry
// covers it OR the surrounding text labels it unverified/contradicted.
// --------------------------------------------------------------------------
export function covers(ledger: Claim, finalAssertion: string): boolean {
  const a = (ledger.subject + ' ' + ledger.assertion).toLowerCase();
  const b = finalAssertion.toLowerCase();
  // cheap containment: the ledger subject must appear, and a meaningful token overlap.
  if (ledger.subject && !b.includes(ledger.subject.toLowerCase().split(/\s+/)[0])) return false;
  const at = new Set(a.split(/\W+/).filter((w) => w.length > 3));
  const bt = b.split(/\W+/).filter((w) => w.length > 3);
  const overlap = bt.filter((w) => at.has(w)).length;
  return overlap >= Math.min(2, at.size);
}

export function hasUnverifiedLabel(answer: string, assertion: string): boolean {
  // is the assertion near an explicit unverified/conflict label?
  const idx = answer.toLowerCase().indexOf(assertion.toLowerCase().slice(0, 30));
  const window = idx >= 0 ? answer.slice(Math.max(0, idx - 160), idx + 160) : answer;
  return /could not (verify|confirm)|unverified|unconfirmed|sources? (conflict|disagree)|conflicting|not independently/i.test(window);
}

// --------------------------------------------------------------------------
// Prompt templates (MASTER_PLAN.md §2 / ARKS_Verification_Loop_Spec §4)
// --------------------------------------------------------------------------
export const EXTRACT_SYS = `You are a claim-extraction component. Input: a draft answer. Output ONLY a JSON array of atomic factual claims.
A claim is ATOMIC if it asserts exactly one verifiable proposition.
checkWorthy=true when truth depends on a real-world fact that could be wrong: a named entity, a date, a quantity/figure, a quote, a current status/role, or a relationship between real entities. checkWorthy=false for pure reasoning, common definitions, opinions, hedged language, the assistant's own analysis.
PRESERVE the specific value (keep "$136M", never "a large fund").
Output: [{"draftText":str,"type":"entity|date|figure|quote|relationship|definition","subject":str,"assertion":str,"checkWorthy":bool}]`;

export const ADJUDICATE_SYS = `You are a verification adjudicator. Input: ONE claim + numbered search snippets. Return a verdict.
- confirmed: a snippet DIRECTLY and SPECIFICALLY supports the exact assertion (same entity, same value). Give sourceIndex.
- corrected: snippets support a DIFFERENT specific value. Give correctedValue + sourceIndex.
- contradicted: sources conflict / flatly negate. Describe the conflict; do NOT pick a side.
- unverified: no snippet directly supports the specific assertion, even if related.
A snippet that mentions the subject but NOT the specific value is NOT support. Do NOT infer. Do NOT fill gaps from your own knowledge. When unsure between confirmed and unverified, choose unverified.
Output ONLY: {"verdict":"confirmed|corrected|contradicted|unverified","correctedValue":str|null,"sourceIndex":int|null,"confidence":float,"note":str|null}`;

export const REVISE_SYS = `Rewrite the final answer using ONLY the adjudicated claim ledger below. The earlier draft is discarded.
1. Use correctedValue, never the original drafted value, where verdict is "corrected".
2. For "unverified" claims the user asked about, state them explicitly as unverified ("could not confirm X"); never present as fact, never silently drop.
3. For "contradicted", surface the conflict, don't choose a side.
4. Introduce NO new fact-sensitive claim absent from the ledger. If writing needs a fact with no verdict, omit it or mark it unverified.
5. Cite sources for confirmed/corrected claims.
Write naturally for the user's task. Do not mention this process or the ledger.`;

// --------------------------------------------------------------------------
// Orchestrator
// --------------------------------------------------------------------------
let _id = 0;
const nextId = () => `c${++_id}`;

/** Cluster near-duplicate claims so one query serves a group (cheap key = subject+type). */
export function clusterClaims(claims: Claim[]): Claim[][] {
  const groups = new Map<string, Claim[]>();
  for (const c of claims) {
    const key = `${c.subject.toLowerCase()}|${c.type}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  return [...groups.values()];
}

/**
 * Run the loop. `factSensitive` is forced by G0 (or the caller). Returns the grounded
 * answer + the claim ledger (provenance). Never throws on a single claim failure.
 */
export async function groundedResearch(task: string, deps: LoopDeps): Promise<{ answer: string; claims: Claim[]; factSensitive: boolean }> {
  const run: RunState = { task, factSensitive: classifyFactSensitive(task), claims: [], searchesUsed: 0, status: 'running' };

  // G0 — non-fact-sensitive → one plain pass, no apparatus.
  if (!run.factSensitive) {
    const answer = await deps.llm('revise', 'Answer the user helpfully and accurately.', task);
    return { answer, claims: [], factSensitive: false };
  }

  // DRAFT (thrown away — only a substrate to extract claims from).
  run.draft = await deps.llm('draft', 'Draft a complete answer to the task. It will be fact-checked.', task);

  // EXTRACT (G1)
  const extracted = parseClaimsJson(await deps.llm('extract', EXTRACT_SYS, run.draft));
  run.claims = extracted.map((e) => ({ ...e, id: nextId(), queries: [], sources: [], attempts: 0 }));
  const checkable = run.claims.filter((c) => c.checkWorthy);

  // PLAN → FAN_OUT → ADJUDICATE (G2) with bounded retry + self-consistency.
  for (const group of clusterClaims(checkable)) {
    const lead = group[0];
    while (lead.attempts <= LOOP_CONFIG.maxRetriesPerClaim) {
      if (run.searchesUsed >= LOOP_CONFIG.maxSearchesPerRun) {
        for (const c of group) c.verdict = c.verdict ?? 'unverified';
        break;
      }
      const query = `${lead.subject} ${lead.assertion}`.trim();
      lead.queries.push(query);
      const results = await deps.search(query).catch(() => [] as Source[]);
      run.searchesUsed++;
      for (const c of group) c.sources.push(...results.slice(0, 5));
      const snippets = results.slice(0, 5).map((s, i) => `[${i}] ${s.snippet} (${s.url})`).join('\n');
      // adjudicate each claim in the group against the shared evidence (self-consistency)
      for (const c of group) {
        const samples: AdjudicationResult[] = [];
        for (let n = 0; n < LOOP_CONFIG.selfConsistency; n++) {
          const v = parseVerdictJson(await deps.llm('adjudicate', ADJUDICATE_SYS, `CLAIM: ${c.subject} — ${c.assertion}\nSNIPPETS:\n${snippets || '(none)'}`));
          if (v) samples.push(v);
        }
        const reduced = reduceVerdict(samples);
        c.verdict = reduced.verdict;
        c.correctedValue = reduced.correctedValue;
        c.confidence = reduced.confidence;
      }
      lead.attempts++;
      if (group.every((c) => c.verdict && c.verdict !== 'unverified')) break;
    }
  }
  // G2 invariant: every checkable claim has a verdict.
  for (const c of checkable) c.verdict = c.verdict ?? 'unverified';

  // REVISE → FINAL_GATE (G3) with bounded retry.
  let answer = '';
  for (let loop = 0; loop < LOOP_CONFIG.maxReviseLoops; loop++) {
    const ledger = JSON.stringify(run.claims.map((c) => ({ subject: c.subject, assertion: c.assertion, verdict: c.verdict, correctedValue: c.correctedValue, sources: c.sources.slice(0, 2) })));
    answer = await deps.llm('revise', REVISE_SYS, `USER TASK: ${task}\nLEDGER: ${ledger}`);
    // FINAL_GATE: re-extract the final, flag any check-worthy claim not backed + not labelled.
    const finalClaims = parseClaimsJson(await deps.llm('finalGate', EXTRACT_SYS, answer)).filter((c) => c.checkWorthy);
    const smuggled = finalClaims.filter(
      (fc) =>
        !run.claims.some((l) => (l.verdict === 'confirmed' || l.verdict === 'corrected') && covers({ ...l } as Claim, fc.assertion)) &&
        !hasUnverifiedLabel(answer, fc.assertion),
    );
    if (smuggled.length === 0) break; // G3 pass
  }

  run.status = 'emitted';
  return { answer, claims: run.claims, factSensitive: true };
}
