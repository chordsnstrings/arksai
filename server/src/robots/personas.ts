import { randomUUID } from 'node:crypto';
import type { RobotKbDoc, RobotPersona } from '../../../shared/types';
import { q, qOne } from '../db';

/**
 * Personas (org-level, reusable) + the per-robot knowledge base.
 *
 * A persona is a saved voice: name + the tone/behavior text + language + signature. A robot
 * points at one via config.personaId; free-text config.persona still wins (additive).
 *
 * KB docs are extracted TEXT stored per robot. Retrieval is pure + deterministic
 * (selectKnowledge): chunk on paragraph boundaries, score by query-term overlap, pack the
 * best chunks into a small budget — so a reply's context carries only the RELEVANT slices
 * (the §5c data-minimization survives a large corpus).
 */

// ---- personas ----

function rowToPersona(r: any): RobotPersona {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    description: r.description ?? null,
    voice: r.voice,
    language: r.language ?? null,
    signature: r.signature ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listPersonas(orgId: string): Promise<RobotPersona[]> {
  const rows = await q('SELECT * FROM robot_personas WHERE org_id = $1 ORDER BY name', [orgId]);
  return rows.map(rowToPersona);
}

export async function getPersona(id: string, orgId?: string): Promise<RobotPersona | null> {
  const r = await qOne('SELECT * FROM robot_personas WHERE id = $1', [id]);
  if (!r) return null;
  if (orgId != null && r.org_id !== orgId) return null;
  return rowToPersona(r);
}

export interface PersonaInput {
  name: string;
  description?: string | null;
  voice: string;
  language?: string | null;
  signature?: string | null;
}

export async function createPersona(orgId: string, p: PersonaInput): Promise<RobotPersona> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO robot_personas(id, org_id, name, description, voice, language, signature, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, orgId, p.name.slice(0, 80), p.description ?? null, p.voice.slice(0, 4000), p.language ?? null, p.signature ?? null, now, now],
  );
  return (await getPersona(id, orgId))!;
}

export async function updatePersona(id: string, orgId: string, p: Partial<PersonaInput>): Promise<RobotPersona | null> {
  const existing = await getPersona(id, orgId);
  if (!existing) return null;
  await q(
    `UPDATE robot_personas SET name = $1, description = $2, voice = $3, language = $4, signature = $5, updated_at = $6 WHERE id = $7`,
    [
      (p.name ?? existing.name).slice(0, 80),
      p.description !== undefined ? p.description : existing.description,
      (p.voice ?? existing.voice).slice(0, 4000),
      p.language !== undefined ? p.language : existing.language,
      p.signature !== undefined ? p.signature : existing.signature,
      Date.now(),
      id,
    ],
  );
  return getPersona(id, orgId);
}

export async function deletePersona(id: string, orgId: string): Promise<void> {
  await q('DELETE FROM robot_personas WHERE id = $1 AND org_id = $2', [id, orgId]);
}

// ---- knowledge base ----

const DOC_CAP = 200_000; // chars stored per doc
const MAX_DOCS = 40;

function rowToKbDoc(r: any): RobotKbDoc {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    name: r.name,
    chars: typeof r.chars === 'number' ? r.chars : String(r.text ?? '').length,
    createdAt: Number(r.created_at),
  };
}

export async function listKbDocs(robotId: string, orgId?: string): Promise<RobotKbDoc[]> {
  const rows = await q(
    'SELECT id, robot_id, org_id, name, LENGTH(text) AS chars, created_at FROM robot_kb_docs WHERE robot_id = $1 ORDER BY created_at DESC',
    [robotId],
  );
  return rows.map(rowToKbDoc).filter((d) => orgId == null || d.orgId === orgId);
}

export async function addKbDoc(robotId: string, orgId: string, name: string, text: string): Promise<RobotKbDoc> {
  const count = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM robot_kb_docs WHERE robot_id = $1', [robotId]);
  if (Number(count?.n ?? 0) >= MAX_DOCS) throw new Error(`This robot already has ${MAX_DOCS} knowledge documents — remove one first.`);
  const id = randomUUID();
  await q(
    'INSERT INTO robot_kb_docs(id, robot_id, org_id, name, text, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, robotId, orgId, name.slice(0, 120), text.slice(0, DOC_CAP), Date.now()],
  );
  return (await qOne('SELECT id, robot_id, org_id, name, LENGTH(text) AS chars, created_at FROM robot_kb_docs WHERE id = $1', [id]).then(rowToKbDoc))!;
}

export async function deleteKbDoc(id: string, orgId: string): Promise<void> {
  await q('DELETE FROM robot_kb_docs WHERE id = $1 AND org_id = $2', [id, orgId]);
}

export async function kbDocTexts(robotId: string): Promise<{ name: string; text: string }[]> {
  const rows = await q('SELECT name, text FROM robot_kb_docs WHERE robot_id = $1 ORDER BY created_at DESC', [robotId]);
  return rows.map((r: any) => ({ name: r.name, text: String(r.text ?? '') }));
}

// ---- retrieval (pure) ----

const STOP = new Set(
  ('a an and are as at be by for from has have how i in is it its me my of on or our so that the ' +
    'their there this to was we what when where which who will with you your do does did can could not').split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** Split a document into ~chunkSize-char chunks on paragraph/sentence boundaries. */
export function chunkText(text: string, chunkSize = 800): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > chunkSize) {
      chunks.push(cur);
      cur = '';
    }
    if (p.length > chunkSize) {
      // A single huge paragraph: split on sentences.
      let rest = p;
      while (rest.length > chunkSize) {
        let cut = rest.lastIndexOf('. ', chunkSize);
        if (cut < chunkSize / 2) cut = chunkSize;
        chunks.push((cur ? cur + '\n' : '') + rest.slice(0, cut + 1).trim());
        cur = '';
        rest = rest.slice(cut + 1).trim();
      }
      cur = rest;
    } else {
      cur = cur ? `${cur}\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Pick the knowledge slices most relevant to `query` across all docs, within `budget` chars.
 * Deterministic term-overlap scoring (no model, no egress). Chunks that share zero terms with
 * the query are never included — an unrelated corpus contributes nothing.
 */
export function selectKnowledge(
  docs: { name: string; text: string }[],
  query: string,
  budget = 4000,
): string[] {
  const qTerms = new Set(tokenize(query));
  if (!qTerms.size || !docs.length) return [];
  const scored: { score: number; snippet: string }[] = [];
  for (const doc of docs) {
    for (const chunk of chunkText(doc.text)) {
      const terms = tokenize(chunk);
      if (!terms.length) continue;
      let hits = 0;
      const seen = new Set<string>();
      for (const t of terms) {
        if (qTerms.has(t) && !seen.has(t)) {
          hits++;
          seen.add(t);
        }
      }
      if (!hits) continue;
      // Favor chunks matching MORE distinct query terms; light length normalization.
      const score = hits / Math.sqrt(terms.length);
      scored.push({ score, snippet: `(${doc.name}) ${chunk}` });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  let used = 0;
  for (const s of scored) {
    if (used + s.snippet.length > budget) continue;
    out.push(s.snippet);
    used += s.snippet.length;
    if (out.length >= 6) break;
  }
  return out;
}

// ---- the one-call resolver the poller/routes use ----

import { buildHistoryLines, listThreadDrafts } from './store';

/** Resolve a robot's reply extras: persona voice/signature + retrieved knowledge slices +
 *  (when a thread address is given) this sender's own conversation history. */
export async function replyExtrasFor(
  robot: { id: string; config?: { personaId?: string } | null },
  orgId: string,
  messageText: string,
  thread?: { channel: 'email' | 'telegram' | 'whatsapp' | 'sms'; fromAddr: string },
): Promise<{ personaVoice?: string; personaSignature?: string; knowledgeSnippets?: string[]; history?: string[] }> {
  const out: { personaVoice?: string; personaSignature?: string; knowledgeSnippets?: string[]; history?: string[] } = {};
  const pid = robot.config?.personaId;
  if (pid) {
    const p = await getPersona(pid, orgId).catch(() => null);
    if (p) {
      out.personaVoice = p.language ? `${p.voice}\nAlways respond in ${p.language}.` : p.voice;
      if (p.signature) out.personaSignature = p.signature;
    }
  }
  const docs = await kbDocTexts(robot.id).catch(() => []);
  if (docs.length) {
    const snippets = selectKnowledge(docs, messageText);
    if (snippets.length) out.knowledgeSnippets = snippets;
  }
  if (thread?.fromAddr) {
    const prior = await listThreadDrafts(robot.id, thread.channel, thread.fromAddr).catch(() => []);
    if (prior.length) {
      const lines = buildHistoryLines(prior);
      if (lines.length) out.history = lines;
    }
  }
  return out;
}
