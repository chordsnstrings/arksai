import type { ToolDef } from './common';
import { resolveInWorkspace } from './common';
import fs from 'node:fs';

/**
 * dependency_auditor — DETERMINISTIC, OFFLINE dependency auditing. Parses a
 * package.json or requirements.txt (path OR pasted content) and flags the risks
 * it can determine WITHOUT a network call: floating-vs-pinned version ranges,
 * duplicate/conflicting entries, suspiciously old pins, and a missing lockfile.
 *
 * HONESTY: this tool CANNOT know live CVEs offline — it never invents a CVE. It
 * counts + categorizes deps, flags structural risk, and tells the agent to pair
 * the result with `npm audit` / `pip-audit` (or the registry advisory feed) for
 * current vulnerability coverage.
 *
 * The parsing + risk heuristics are reimplemented in TypeScript from the
 * MIT-licensed Anthropic claude-skills `dependency-auditor` skill
 * (engineering/skills/dependency-auditor/scripts/dep_scanner.py — "Author:
 * Claude Skills Engineering Team, License: MIT"). No Python, no dependency added
 * — only the offline-deterministic logic was harvested.
 */

export type ManifestType = 'package.json' | 'requirements.txt' | 'unknown';

export interface DepEntry {
  name: string;
  /** The raw version spec as written, e.g. "^1.2.3", ">=2,<3", "*", "1.4.0". */
  spec: string;
  /** dependencies vs devDependencies/peer/optional, or "runtime" for requirements.txt. */
  scope: string;
  /** Best-effort base semver extracted from the spec (e.g. "1.2.3"), or null. */
  version: string | null;
  /** True when the spec floats (^, ~, >=, *, no pin, git/url) rather than pinning exactly. */
  floating: boolean;
}

export type Severity = 'high' | 'medium' | 'low' | 'info';
export interface Finding {
  severity: Severity;
  category:
    | 'duplicate'
    | 'floating'
    | 'unpinned'
    | 'old-pin'
    | 'no-lockfile'
    | 'cve-note';
  dependency?: string;
  message: string;
}

export interface AuditResult {
  manifest_type: ManifestType;
  summary: {
    total: number;
    by_scope: Record<string, number>;
    floating: number;
    pinned: number;
    duplicates: number;
    lockfile_present: boolean | null;
  };
  deps: DepEntry[];
  findings: Finding[];
  /** Honest, always-present note that offline auditing can't see live CVEs. */
  cve_note: string;
}

const CVE_NOTE =
  'OFFLINE AUDIT — this did NOT check live advisories, so it reports ZERO known CVEs (not "no vulnerabilities exist"). ' +
  'For current vulnerability coverage, run `npm audit` (Node) or `pip-audit` (Python), or query the registry/GitHub advisory feed. Never claim a package is CVE-free from this output.';

/** A spec is "floating" if it can resolve to more than one published version. */
function isFloating(spec: string): boolean {
  const s = spec.trim();
  if (!s || s === '*' || s.toLowerCase() === 'latest') return true;
  if (/^(\^|~|>|<|>=|<=)/.test(s)) return true;
  if (s.includes('||') || s.includes(' - ') || s.includes(',')) return true;
  if (/x|\*/i.test(s)) return true; // 1.x, 1.2.*
  // git/url/file specs float to whatever the source resolves to
  if (/^(git|http|https|file|link|workspace):/i.test(s) || s.includes('/')) return true;
  return false;
}

/** Extract a base "major.minor.patch" (or major.minor) from a spec, best-effort. */
function baseVersion(spec: string): string | null {
  const m = spec.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return m[3] != null ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`;
}

/** True when a pinned major is 0 or unusually low — a heuristic "suspiciously old" flag. */
function looksOldPin(version: string | null): boolean {
  if (!version) return false;
  const major = parseInt(version.split('.')[0], 10);
  // 0.x = pre-1.0 (no stability guarantee). We can't know "old" without dates offline,
  // so we only flag the unambiguous pre-1.0 case to avoid false confidence.
  return Number.isFinite(major) && major === 0;
}

function detectType(filename: string, content: string): ManifestType {
  const f = filename.toLowerCase();
  if (f.endsWith('package.json')) return 'package.json';
  if (f.endsWith('requirements.txt') || f.endsWith('.txt')) return 'requirements.txt';
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return 'package.json';
  // requirements.txt: lines like "name==1.2.3" / "name>=1.0"
  if (/^[A-Za-z0-9._-]+\s*(==|>=|<=|~=|!=|>|<)/m.test(trimmed)) return 'requirements.txt';
  return 'unknown';
}

function parsePackageJson(content: string): { deps: DepEntry[]; lockHint: boolean | null } {
  let pkg: any;
  try {
    pkg = JSON.parse(content);
  } catch {
    throw new Error('package.json is not valid JSON.');
  }
  const deps: DepEntry[] = [];
  const scopes: [string, string][] = [
    ['dependencies', 'dependencies'],
    ['devDependencies', 'devDependencies'],
    ['peerDependencies', 'peerDependencies'],
    ['optionalDependencies', 'optionalDependencies'],
  ];
  for (const [field, scope] of scopes) {
    const obj = pkg[field];
    if (obj && typeof obj === 'object') {
      for (const [name, raw] of Object.entries(obj)) {
        const spec = String(raw ?? '');
        deps.push({ name, spec, scope, version: baseVersion(spec), floating: isFloating(spec) });
      }
    }
  }
  return { deps, lockHint: null };
}

function parseRequirements(content: string): DepEntry[] {
  const deps: DepEntry[] = [];
  for (const lineRaw of content.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue; // skip blank, comments, -r/-e/--flags
    // name[extras](==|>=|...)spec ; environment markers stripped at " ;"
    const body = line.split(';')[0].trim();
    const m = body.match(/^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$/);
    if (!m) continue;
    const name = m[1];
    const spec = (m[3] || '').trim();
    deps.push({
      name,
      spec: spec || '*',
      scope: 'runtime',
      version: baseVersion(spec),
      floating: spec ? isFloating(spec) : true, // no spec at all = floats to latest
    });
  }
  return deps;
}

/** Pure audit over already-parsed deps. `lockfilePresent` null = unknown (pasted content). */
export function auditDeps(
  manifestType: ManifestType,
  deps: DepEntry[],
  lockfilePresent: boolean | null,
): AuditResult {
  const findings: Finding[] = [];

  // 1. Duplicates / conflicts (same name twice, possibly across scopes).
  const byName = new Map<string, DepEntry[]>();
  for (const d of deps) {
    const arr = byName.get(d.name) ?? [];
    arr.push(d);
    byName.set(d.name, arr);
  }
  let duplicates = 0;
  for (const [name, entries] of byName) {
    if (entries.length > 1) {
      duplicates++;
      const specs = entries.map((e) => `${e.spec} (${e.scope})`).join(', ');
      findings.push({
        severity: 'high',
        category: 'duplicate',
        dependency: name,
        message: `"${name}" appears ${entries.length}× — ${specs}. Duplicate/conflicting declarations resolve unpredictably; keep ONE.`,
      });
    }
  }

  // 2. Floating / unpinned ranges.
  let floating = 0;
  for (const d of deps) {
    if (d.floating) {
      floating++;
      const unpinned = !d.spec || d.spec === '*' || d.spec.toLowerCase() === 'latest';
      findings.push({
        severity: unpinned ? 'high' : 'medium',
        category: unpinned ? 'unpinned' : 'floating',
        dependency: d.name,
        message: unpinned
          ? `"${d.name}" is fully unpinned ("${d.spec || '(none)'}") — it can silently jump to ANY new release. Pin to an exact version (and use a lockfile).`
          : `"${d.name}" uses a floating range "${d.spec}" — installs are not reproducible without a lockfile. Pin exactly or commit the lockfile.`,
      });
    }
  }
  const pinned = deps.length - floating;

  // 3. Suspiciously old / pre-1.0 pins.
  for (const d of deps) {
    if (looksOldPin(d.version)) {
      findings.push({
        severity: 'low',
        category: 'old-pin',
        dependency: d.name,
        message: `"${d.name}" is on a pre-1.0 version (${d.version}) — pre-1.0 packages give no stability guarantee; review whether a stable release exists.`,
      });
    }
  }

  // 4. Lockfile signal (only when we actually know — a path scan can check the dir).
  if (lockfilePresent === false) {
    findings.push({
      severity: 'medium',
      category: 'no-lockfile',
      message:
        manifestType === 'package.json'
          ? 'No package-lock.json / yarn.lock / pnpm-lock.yaml found alongside package.json — installs are not reproducible. Commit a lockfile.'
          : 'No pinned lockfile (e.g. a fully-pinned requirements.txt or pip-compile output) — installs are not reproducible. Pin transitive deps.',
    });
  }

  // 5. The always-on honest CVE note as a finding too (so it shows in the list).
  findings.push({ severity: 'info', category: 'cve-note', message: CVE_NOTE });

  const byScope: Record<string, number> = {};
  for (const d of deps) byScope[d.scope] = (byScope[d.scope] ?? 0) + 1;

  return {
    manifest_type: manifestType,
    summary: {
      total: deps.length,
      by_scope: byScope,
      floating,
      pinned,
      duplicates,
      lockfile_present: lockfilePresent,
    },
    deps,
    findings,
    cve_note: CVE_NOTE,
  };
}

/** Parse + audit raw manifest content. Used by the tool and the unit tests. */
export function auditManifest(
  filename: string,
  content: string,
  lockfilePresent: boolean | null,
): AuditResult {
  const type = detectType(filename, content);
  if (type === 'package.json') {
    const { deps } = parsePackageJson(content);
    return auditDeps(type, deps, lockfilePresent);
  }
  if (type === 'requirements.txt') {
    return auditDeps(type, parseRequirements(content), lockfilePresent);
  }
  throw new Error('Could not detect a supported manifest (package.json or requirements.txt). Pass `manifest_type` or the file content explicitly.');
}

export const dependencyAuditorTool: ToolDef = {
  name: 'dependency_auditor',
  description:
    'Audit a project\'s dependencies DETERMINISTICALLY and OFFLINE (no network, instant). Pass either `path` ' +
    '(a package.json or requirements.txt in the workspace) OR pasted `content` (+ optional `manifest_type`). ' +
    'It parses every dependency, then flags the risks it can know without a network call: floating/unpinned ' +
    'version ranges (non-reproducible installs), duplicate/conflicting entries, pre-1.0 pins, and a missing ' +
    'lockfile. Returns structured JSON {manifest_type, summary, deps[], findings[]}. ' +
    'HONESTY: it CANNOT see live CVEs — it never invents one and always notes to pair it with `npm audit` / ' +
    '`pip-audit` for current advisories. Turn the JSON into a DESIGNED audit report (generate_doc / render_report) — ' +
    'never a raw dump.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path to a package.json or requirements.txt. Used if `content` is omitted.' },
      content: { type: 'string', description: 'Pasted manifest text (package.json or requirements.txt). Takes precedence over `path`.' },
      manifest_type: {
        type: 'string',
        enum: ['package.json', 'requirements.txt'],
        description: 'Optional explicit type when pasting ambiguous content.',
      },
    },
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `audit deps ${a.path ? String(a.path) : '(pasted)'}`,
  async run(args, ctx) {
    let content: string = typeof args.content === 'string' ? args.content : '';
    let filename: string = typeof args.manifest_type === 'string' ? args.manifest_type : '';
    let lockfilePresent: boolean | null = null;

    if (!content) {
      const p = typeof args.path === 'string' ? args.path : '';
      if (!p) return 'Error: pass `path` (a manifest file in the workspace) or `content` (pasted manifest text).';
      let abs: string;
      try {
        abs = resolveInWorkspace(ctx.repoDir, p);
      } catch (e: any) {
        return `Error: ${e?.message ?? 'invalid path'}`;
      }
      if (!fs.existsSync(abs)) return `Error: no file at "${p}".`;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch (e: any) {
        return `Error: could not read "${p}": ${e?.message ?? e}`;
      }
      filename = p;
      // We have a real path → we CAN check for a sibling lockfile.
      const dir = abs.replace(/[^/\\]+$/, '');
      const type = detectType(filename, content);
      const locks =
        type === 'package.json'
          ? ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']
          : ['requirements.lock', 'requirements.txt.lock', 'poetry.lock', 'Pipfile.lock'];
      lockfilePresent = locks.some((l) => fs.existsSync(dir + l));
    }

    try {
      const result = auditManifest(filename || 'manifest', content, lockfilePresent);
      return JSON.stringify(result, null, 2);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
  },
};
