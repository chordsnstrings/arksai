import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * design_direction — the ART-DIRECTION phase.
 *
 * Before a visual website is built, the agent must LOCK a bespoke design concept
 * grounded in the subject (the move that makes output read as art-directed, not
 * templated). This tool forces that commitment and persists it as a durable,
 * inspectable artifact the build reads and the design gate enforces:
 *   • design-direction.json — the structured brief
 *   • DESIGN.md             — the human-readable rationale
 *   • tokens.css            — the palette + type roles, ready for the page to link
 *
 * It is deliberately NOT a generator of pretty defaults: it captures a decision.
 */

export interface TypeRole { family: string; role?: string; why?: string }
export interface DesignBrief {
  concept: string;
  rationale: string;
  structureEncodes: string;
  antiDefaults: string[];
  type: { display: TypeRole; body: TypeRole; data: TypeRole };
  palette: {
    ink: string; brand: string; paper: string; surface: string;
    line: string; muted: string; accent: string; accentInk: string; accentRationale: string;
  };
  signature: string;
  motion: string;
}

const HEX = /^#?[0-9a-fA-F]{6}$/;
const cleanHex = (v: unknown, fallback: string): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (!HEX.test(t)) return fallback;
  return t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`;
};
const cleanFont = (v: unknown, fallback: string): string => {
  const t = typeof v === 'string' ? v.trim().replace(/["'<>]/g, '') : '';
  return t ? t.slice(0, 48) : fallback;
};
const cleanStr = (v: unknown, fallback = '', max = 400): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  return (t || fallback).slice(0, max);
};

/** Relative luminance → pick a readable ink colour for text ON the accent. */
function readableInkOn(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? '#14161b' : '#ffffff';
}

/** Normalize raw tool args into a complete, sane brief (forgiving, but commits to a decision). */
export function normalizeBrief(args: any): DesignBrief {
  const t = args?.type ?? {};
  const p = args?.palette ?? {};
  const accent = cleanHex(p.accent, '#1b4d3e');
  const role = (x: any, famFallback: string): TypeRole => ({
    family: cleanFont(x?.family, famFallback),
    role: cleanStr(x?.role, '', 60) || undefined,
    why: cleanStr(x?.why, '', 120) || undefined,
  });
  const anti = Array.isArray(args?.antiDefaults)
    ? args.antiDefaults.map((s: any) => cleanStr(s, '', 80)).filter(Boolean).slice(0, 5)
    : [];
  return {
    concept: cleanStr(args?.concept, 'Untitled direction', 80),
    rationale: cleanStr(args?.rationale, '', 600),
    structureEncodes: cleanStr(args?.structureEncodes, '', 300),
    antiDefaults: anti.length ? anti : ['generic minimal-muted blue-on-white', 'cream + serif + terracotta', 'black + acid-green'],
    type: {
      display: role(t.display, 'Fraunces'),
      body: role(t.body, 'Hanken Grotesk'),
      data: role(t.data, 'IBM Plex Mono'),
    },
    palette: {
      ink: cleanHex(p.ink, '#14201a'),
      brand: cleanHex(p.brand, accent),
      paper: cleanHex(p.paper, '#f5f3ec'),
      surface: cleanHex(p.surface, '#ffffff'),
      line: cleanHex(p.line, '#d8d5c9'),
      muted: cleanHex(p.muted, '#5d6760'),
      accent,
      accentInk: cleanHex(p.accentInk, readableInkOn(accent)),
      accentRationale: cleanStr(p.accentRationale, '', 200),
    },
    signature: cleanStr(args?.signature, '', 300),
    motion: cleanStr(args?.motion, 'one easing token; nav underline; button lift + arrow nudge', 200),
  };
}

const fam = (r: TypeRole, fallbacks: string): string => `"${r.family}", ${fallbacks}`;

/** Render the locked brief into tokens.css — the handoff the page links (with rationale comments). */
export function buildTokensCss(b: DesignBrief): string {
  return `/* ============================================================
   ${b.concept} — design direction (locked by design_direction)
   ${b.rationale}
   Avoiding: ${b.antiDefaults.join(' · ')}
   Type roles: ${b.type.display.family} (display) · ${b.type.body.family} (body) · ${b.type.data.family} (data/mono)
   ============================================================ */
:root {
  /* colour — grounded in the concept (${b.palette.accentRationale || 'accent used sparingly, ~5–8%'}) */
  --ink: ${b.palette.ink};
  --brand: ${b.palette.brand};
  --accent: ${b.palette.accent};
  --accent-ink: ${b.palette.accentInk};
  /* accent ramp (derived) — for hover/active/tints, so the accent reads considered, not flat */
  --accent-deep: color-mix(in srgb, ${b.palette.accent} 82%, #000);
  --accent-2: color-mix(in srgb, ${b.palette.accent} 78%, ${b.palette.ink});
  --accent-tint: color-mix(in srgb, ${b.palette.accent} 12%, ${b.palette.paper});
  --muted: ${b.palette.muted};
  --bg: ${b.palette.paper};
  --paper: ${b.palette.paper};
  --surface: ${b.palette.surface};
  --border: ${b.palette.line};
  --line: ${b.palette.line};
  /* glass (frosted surfaces) — high enough opacity to stay legible */
  --glass-bg: color-mix(in srgb, ${b.palette.surface} 72%, transparent);
  --glass-blur: saturate(1.4) blur(12px);

  /* type — three deliberate ROLES (run add_fonts to embed these) */
  --font: ${fam(b.type.body, 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif')};
  --display: ${fam(b.type.display, 'Georgia, "Times New Roman", serif')};
  --font-mono: ${fam(b.type.data, 'ui-monospace, "SF Mono", Menlo, monospace')};

  /* layout + feel */
  --maxw: 1120px;
  --pad: clamp(16px, 4vw, 40px);
  --radius: 8px;
  --ease: cubic-bezier(0.22, 0.61, 0.36, 1);
}

html { font-family: var(--font); color: var(--ink); background: var(--bg); line-height: 1.6; -webkit-text-size-adjust: 100%; }
body { font-size: clamp(15px, 0.9rem + 0.2vw, 17px); }
h1, h2, h3 { font-family: var(--display); line-height: 1.14; font-weight: 600; margin: 0 0 .4em; letter-spacing: -0.01em; color: var(--brand); }
h1 { font-size: clamp(2rem, 1.4rem + 3.4vw, 3.5rem); }
h2 { font-size: clamp(1.5rem, 1.1rem + 1.7vw, 2.4rem); }
h3 { font-size: 1.2rem; }
p { margin: 0 0 1em; max-width: 66ch; }
.muted { color: var(--muted); }
`;
}

/** Render the human-readable direction doc. */
export function buildDesignMd(b: DesignBrief): string {
  const t = b.type;
  const line = (r: TypeRole) => `**${r.family}**${r.role ? ` — ${r.role}` : ''}${r.why ? ` _(${r.why})_` : ''}`;
  return `# Design direction — ${b.concept}

${b.rationale}

## What the structure encodes
${b.structureEncodes || '_(ground the page structure in something true about the subject — real codes, dates, SKUs, places — never generic 01/02/03.)_'}

## Type (three roles)
- Display: ${line(t.display)}
- Body: ${line(t.body)}
- Data / mono: ${line(t.data)}

## Palette
| token | value | |
| --- | --- | --- |
| ink | \`${b.palette.ink}\` | body text |
| brand | \`${b.palette.brand}\` | headings / nav / footer |
| accent | \`${b.palette.accent}\` | ${b.palette.accentRationale || 'one accent, used sparingly (~5–8%)'} |
| paper | \`${b.palette.paper}\` | page background |
| surface | \`${b.palette.surface}\` | cards / panels |
| line | \`${b.palette.line}\` | hairlines |

## Signature moment
${b.signature || '_(build ONE meaningful signature element from craft.css — a .board / .spec keyed to real data for this subject.)_'}

## Motion
${b.motion}

## Avoiding (the AI-default looks)
${b.antiDefaults.map((a) => `- ${a}`).join('\n')}

---
_Locked by design_direction. The build links \`tokens.css\` (generated from this) + \`ui-kit/craft.css\`._
`;
}

export const designDirectionTool: ToolDef = {
  name: 'design_direction',
  description:
    'LOCK a bespoke design concept BEFORE building a visual website (do this first for any brand / ' +
    'marketing / portfolio / multi-page site). You commit to: a named CONCEPT grounded in the SUBJECT\'s ' +
    'real world (e.g. an immigration consultancy → "Port of Entry", travel documents); what the page ' +
    'STRUCTURE encodes that is TRUE (real country codes / SKUs / dates / places, never generic 01/02/03); ' +
    'a deliberate TYPE TRIO with roles (display / body / a MONO data face) chosen on purpose, NOT the ' +
    'defaults (avoid reflexive Inter / Playfair). Choose families ONLY from the embedded set so they load — ' +
    'display: Fraunces, Spectral, Bricolage Grotesque, Source Serif 4, Newsreader, Space Grotesk; body: ' +
    'Hanken Grotesk, Inter, DM Sans, Plus Jakarta Sans, Manrope, Outfit, Sora; data/mono: IBM Plex Mono, ' +
    'Space Mono (do NOT name JetBrains Mono or any face/weight that is not bundled). Then a concept-grounded ' +
    'PALETTE with a rationale (not default ' +
    'blue-on-white); ONE meaningful SIGNATURE element; and the named AI-default looks you are AVOIDING. ' +
    'It writes design-direction.json + DESIGN.md + tokens.css into the workspace. Then call create_web_app ' +
    '(mechanics — it preserves your tokens.css) + add_fonts, and build to this direction. Surface the ' +
    'one-line concept to the user for a brand build; run it silently for a quick ask.',
  parameters: {
    type: 'object',
    properties: {
      concept: { type: 'string', description: 'A named concept grounded in the subject (e.g. "Port of Entry", "The Workshop Ledger").' },
      rationale: { type: 'string', description: 'One or two sentences: why this concept fits THIS subject.' },
      structureEncodes: { type: 'string', description: 'What the page structure encodes that is TRUE — real codes/SKUs/dates/places used as markers, not generic numbers.' },
      antiDefaults: { type: 'array', items: { type: 'string' }, description: 'The AI-default looks you are deliberately avoiding (e.g. "cream+serif+terracotta", "generic minimal-muted blue").' },
      type: {
        type: 'object',
        description: 'Three deliberate type roles. Choose with intent — not the reflexive Inter/Playfair.',
        properties: {
          display: { type: 'object', properties: { family: { type: 'string' }, role: { type: 'string' }, why: { type: 'string', description: 'why this, not the default' } } },
          body: { type: 'object', properties: { family: { type: 'string' }, role: { type: 'string' }, why: { type: 'string' } } },
          data: { type: 'object', properties: { family: { type: 'string', description: 'a MONO face for codes/labels/figures (e.g. IBM Plex Mono, Space Mono)' }, role: { type: 'string' } } },
        },
      },
      palette: {
        type: 'object',
        description: 'A concept-grounded palette (hex). Not default blue-on-white.',
        properties: {
          ink: { type: 'string' }, brand: { type: 'string' }, paper: { type: 'string' },
          surface: { type: 'string' }, line: { type: 'string' }, muted: { type: 'string' },
          accent: { type: 'string', description: 'the ONE accent, used sparingly' },
          accentInk: { type: 'string', description: 'text colour on the accent (auto-picked if omitted)' },
          accentRationale: { type: 'string' },
        },
      },
      signature: { type: 'string', description: 'The ONE meaningful signature element (e.g. "a departures board keyed to real country codes").' },
      motion: { type: 'string', description: 'The motion intent (one easing token; nav underline; button lift).' },
      dest: { type: 'string', description: 'Workspace subfolder to write into (default the workspace root ".").' },
    },
    required: ['concept', 'type', 'palette'],
  },
  modes: ['code'],
  summarize: (a) => `design direction${a?.concept ? ` "${String(a.concept).slice(0, 40)}"` : ''}`,
  async run(args, ctx) {
    const brief = normalizeBrief(args);
    const destRel = String(args?.dest ?? '.').replace(/[^a-zA-Z0-9._/-]/g, '-') || '.';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      fs.mkdirSync(destAbs, { recursive: true });
      fs.writeFileSync(path.join(destAbs, 'design-direction.json'), JSON.stringify(brief, null, 2));
      fs.writeFileSync(path.join(destAbs, 'DESIGN.md'), buildDesignMd(brief));
      fs.writeFileSync(path.join(destAbs, 'tokens.css'), buildTokensCss(brief));
    } catch (e: any) {
      return `Error: could not write the design direction — ${e?.message ?? e}`;
    }
    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Locked the design direction "${brief.concept}" at ${at}: design-direction.json + DESIGN.md + tokens.css ` +
      `(palette accent ${brief.palette.accent}; type ${brief.type.display.family} / ${brief.type.body.family} / ` +
      `${brief.type.data.family}; signature: ${brief.signature || 'TBD'}).\n` +
      `NEXT: (1) call add_fonts and confirm these families are embedded (${brief.type.display.family}, ` +
      `${brief.type.body.family}, ${brief.type.data.family}); (2) call create_web_app (it now PRESERVES this ` +
      `tokens.css); (3) build the page to this direction — use the mono DATA face for labels/codes/figures, and ` +
      `build the ONE signature moment from ui-kit/craft.css (.board / .spec / .stamp) keyed to REAL data for this ` +
      `subject (never generic 01/02/03). Tell the user the concept in ONE line, then build.`
    );
  },
};
