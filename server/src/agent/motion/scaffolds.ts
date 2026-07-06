import fs from 'node:fs';
import path from 'node:path';

/**
 * Scene SCAFFOLDS — parameterized archetypes with media-house choreography baked in
 * (operator directive 2026-07-05: "scaffolds … so the ai can simply focus on the actual
 * output"). The authoring model supplies CONTENT (slots: text, asset picks, numbers);
 * the scaffold supplies CRAFT: entrance choreography ≤1.2s with staggers, ambient idles,
 * an eased camera move (direction rotated per scene), exit choreography in the scene tail,
 * composition (grounds, depth, focal hierarchy, vignette, safe areas), and per-style-pack
 * skinning. Pure functions — unit-testable without Chromium.
 *
 * Word ceilings are enforced here (Mayer's redundancy principle: 5–12 words on screen),
 * so "walls of label text" are mechanically impossible through this path.
 */

export type MotionStyleId = 'clean' | 'nutshell' | 'broadcast' | 'vox' | 'nordic';

export interface ScaffoldCtx {
  style: MotionStyleId;
  /** Path prefix from the scene file to the workspace root ('' or '../../'). */
  kitPrefix: string;
  /** 0-based scene index — rotates camera direction + default grounds deterministically. */
  sceneIndex: number;
  /** Inline a workspace-relative SVG asset (materialized by search_assets); null = missing. */
  readAsset: (rel: string) => string | null;
  accent?: string;
  accent2?: string;
  /** DEPRECATED alias for a tall format — prefer width/height. */
  portrait?: boolean;
  /** Output pixels — drives the FORMAT system (landscape/square/tall compositions). */
  width?: number;
  height?: number;
}

/**
 * FORMAT system (operator 2026-07-05: "fix it for any size"): the binary portrait flag
 * left 1:1 with landscape compositions and 4:5 with 9:16-tuned ones. Three real formats:
 * landscape (16:9), square (1:1 and 4:5 — row layouts survive, tightened), tall (9:16 —
 * full-height stacked). Every scaffold branches on this, and the shell stamps a format
 * class so motion.css can tune sizes per format.
 */
export type FrameFormat = 'landscape' | 'square' | 'tall';
export function formatOf(ctx: ScaffoldCtx): FrameFormat {
  if (ctx.width && ctx.height) {
    const r = ctx.height / ctx.width;
    return r < 0.95 ? 'landscape' : r <= 1.34 ? 'square' : 'tall';
  }
  return ctx.portrait ? 'tall' : 'landscape';
}

export interface ScaffoldResult {
  html?: string;
  problems: string[];
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * A reveal delay PROPORTIONAL to the scene length (operator 2026-07-05: "the scenes don't
 * really match the actual narration") — narration duration varies per scene, so secondary
 * content is scheduled as a fraction of --scene-s and lands roughly while it is being
 * spoken about, instead of everything piling into the first second. Primary headlines
 * stay fixed-fast (≤0.5s of the cut).
 */
const atFrac = (f: number) => `calc(var(--scene-s, 8) * ${f}s)`;

/** Display size that scales with the SHORT edge: Xvh in landscape, width-bounded in portrait. */
const dsize = (vh: number) => `min(${vh}vh, ${(vh * 1.15).toFixed(1)}vw)`;

/**
 * LIVING-FRAME wrappers (operator 2026-07-05: "ensure there's dynamic movement within the
 * frames" — the audit measured mid-scene motion at ~1.0 YAVG, i.e. camera-only). Perpetual
 * ambient motion goes on a WRAPPER (the `animation` shorthand collides on one element).
 */
const drift = (inner: string, opts: { dur?: number; dx?: string; dy?: string; at?: string } = {}) =>
  `<div class="mg-drift" style="--ddur:${opts.dur ?? 9}s;${opts.dx ? `--dx:${opts.dx};` : ''}${opts.dy ? `--dy:${opts.dy};` : ''}animation-delay:${opts.at ?? '-3s'};">${inner}</div>`;

/** A bottom hairline with a slowly travelling accent segment — fills a dead lower band with quiet life. */
const runline = (at = 0.3) =>
  `<div class="mg-fade" style="--at:${atFrac(at)};position:absolute;left:8vw;right:8vw;bottom:6.5vh;z-index:1;"><div class="mg-runline"></div></div>`;

const words = (s: unknown): number => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** Validate a text slot against its word ceiling; empty is allowed when optional. */
function cap(problems: string[], slot: string, value: unknown, max: number, required = false): string {
  // normalize: collapse whitespace + restore the space after sentence punctuation
  // (live typo: "Real science.Use with care."), and screen structural meta-words.
  const t = String(value ?? '').trim().replace(/\s+/g, ' ').replace(/([.!?])(?=[A-Za-z])/g, '$1 ');
  if (!t) {
    if (required) problems.push(`slot "${slot}" is required`);
    return '';
  }
  const plain = t.replace(/\*/g, '');
  if (/^(hook|scene ?\d*|placeholder|todo|tbd|lorem)$/i.test(plain)) {
    problems.push(`slot "${slot}" is the structural word "${plain}" — slots carry REAL content, never planning labels`);
    return '';
  }
  if (words(plain) > max) problems.push(`slot "${slot}" exceeds the ${max}-word ceiling (${words(plain)} words) — on-screen text is keywords, not sentences`);
  return t;
}

/**
 * KINETIC EMPHASIS (operator 2026-07-05: "texts that are given emphasis on"): any text
 * slot may mark a phrase with *asterisks* — it renders in the pack's emphasis treatment
 * (highlight sweep / rule / shout), firing proportionally while it is being spoken.
 * The word stays visible with its line; only the effect arrives late.
 */
function renderEmph(t: string, at = atFrac(0.55)): string {
  return t
    .split(/\*([^*]+)\*/g)
    .map((seg, i) => (i % 2 ? `<span class="mg-emph" style="--at:${at}">${esc(seg)}</span>` : esc(seg)))
    .join('');
}

/**
 * ANIMATED ICONS (operator 2026-07-05): stroke icons (lucide/tabler/ph are stroke-based)
 * enter by DRAWING ON (the kit's .mg-draw animates stroke-dashoffset), then settle into
 * whatever idle the composition gives them. Fill-based icons pass through unchanged —
 * mgDraw only touches strokes, so they simply appear.
 */
function drawIcon(svg: string, at = '0.25s'): string {
  if (!svg) return svg;
  const isStroke = /stroke=["'](?:currentColor|#)/i.test(svg) || /fill=["']none["']/i.test(svg);
  return isStroke ? `<span class="mg-draw" style="--at:${at};display:inline-flex;width:100%;height:100%;">${svg}</span>` : svg;
}

/** The camera move rotates per scene so adjacent scenes never share one. */
function camera(ctx: ScaffoldCtx, override?: string): string {
  const cams = ['mg-cam-in', 'mg-cam-out', 'mg-cam-drift'];
  if (override && cams.includes(override)) return override;
  return cams[ctx.sceneIndex % cams.length];
}

/** Resolve a ground token to the style pack's classes. 'auto' rotates per scene. */
export function groundClass(style: MotionStyleId, ground: string | undefined, sceneIndex: number): string {
  const home: Record<MotionStyleId, string> = {
    clean: 'mg-ground-floor',
    nutshell: 'mg-ground-space',
    broadcast: 'mg-ground-stage',
    vox: 'mg-ground-studio',
    nordic: 'mg-ground-paper',
  };
  const byToken: Record<string, string> = {
    light: home[style],
    home: home[style],
    dark: 'mg-ground-dark',
    accent: style === 'broadcast' || style === 'vox' ? 'mg-ground-dark' : 'mg-ground-accent',
    space: 'mg-ground-space',
    stage: 'mg-ground-stage',
    studio: 'mg-ground-studio',
    floor: 'mg-ground-floor',
    paper: 'mg-ground-paper',
    night: 'mg-ground-night',
  };
  if (ground && byToken[ground]) return byToken[ground];
  // auto rhythm: index 0 (the hook) lands on the dramatic ground, then alternates so
  // adjacent auto scenes NEVER share a ground (the scene-contrast doctrine by default).
  const rhythm =
    style === 'nutshell'
      ? ['mg-ground-space', 'mg-ground-dark', 'mg-ground-space', 'mg-ground-accent']
      : style === 'nordic'
        ? ['mg-ground-night', 'mg-ground-paper', 'mg-ground-dark', 'mg-ground-paper']
        : style === 'vox'
          ? ['mg-ground-dark', 'mg-ground-studio', 'mg-ground-dark', 'mg-ground-studio']
          : ['mg-ground-dark', home[style], style === 'broadcast' ? 'mg-ground-dark' : 'mg-ground-accent', home[style]];
  return rhythm[sceneIndex % rhythm.length];
}

function inlineSvg(ctx: ScaffoldCtx, rel: unknown, problems: string[], slot: string): string {
  const p = String(rel ?? '').trim();
  if (!p) return '';
  if (!/\.svg$/i.test(p)) {
    problems.push(`slot "${slot}": expected a workspace-relative .svg path (materialize it with search_assets first), got "${p}"`);
    return '';
  }
  const content = ctx.readAsset(p);
  if (!content || !/<svg/i.test(content)) {
    problems.push(`slot "${slot}": asset "${p}" not found — materialize it with search_assets first`);
    return '';
  }
  return content;
}

/** A masked-line-rise title: each line rises from behind an invisible mask, staggered. */
function maskLines(text: string, cls: string, startAt = 0.1, perLine = 0.12): string {
  // Split on explicit | or into ~2 balanced lines for longer titles.
  let lines = text.split('|').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && words(text) > 5) {
    const ws = text.split(/\s+/);
    const mid = Math.ceil(ws.length / 2);
    lines = [ws.slice(0, mid).join(' '), ws.slice(mid).join(' ')];
  }
  return lines
    .map((l, i) => `<span class="mg-mask"><span class="mg-rise" style="--at:${(startAt + i * perLine).toFixed(2)}s">${renderEmph(l)}</span></span>`)
    .join(' ');
}

/**
 * TYPOGRAPHIC composition (operator 2026-07-05: "texts are not really typographically
 * rich… almost slide like"): a headline set as MIXED-SIZE masked lines — short lines set
 * huge, long lines smaller (scale contrast inside one headline), each rising staggered.
 * Split on explicit | or balanced 2-3 lines.
 */
function richLines(text: string, baseVh: number, startAt = 0.12): string {
  let lines = text.split('|').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1) {
    const ws = text.split(/\s+/);
    if (ws.length > 6) {
      const third = Math.ceil(ws.length / 3);
      lines = [ws.slice(0, third).join(' '), ws.slice(third, third * 2).join(' '), ws.slice(third * 2).join(' ')].filter(Boolean);
    } else if (ws.length > 3) {
      const mid = Math.ceil(ws.length / 2);
      lines = [ws.slice(0, mid).join(' '), ws.slice(mid).join(' ')];
    }
  }
  const maxLen = Math.max(...lines.map((l) => l.length), 1);
  return lines
    .map((l, i) => {
      const scale = Math.min(1.65, Math.max(0.72, maxLen / Math.max(l.length, 1)));
      const size = (baseVh * scale).toFixed(1);
      return `<span class="mg-mask" style="display:block;"><span class="mg-rise" style="--at:${(startAt + i * 0.13).toFixed(2)}s;font-size:min(${size}vh, ${(Number(size) * 1.15).toFixed(1)}vw);line-height:1.02;display:inline-block;">${renderEmph(l)}</span></span>`;
    })
    .join('\n');
}

/** The longest word — used as a giant outlined background echo (texture, not content). */
function echoWord(text: string): string {
  return text.replace(/[^\w\s%]/g, '').split(/\s+/).sort((a, b) => b.length - a.length)[0] ?? '';
}

/** Shared page shell: ground → wash → camera wrapper → exit wrapper → content → vignette. */
function shell(
  ctx: ScaffoldCtx,
  opts: {
    ground: string;
    body: string;
    bg?: string; // persists through the exit (plates, grounds, starfields)
    exit?: 'mg-exit-up' | 'mg-exit-fade' | 'mg-exit-scale' | 'none';
    cam?: string;
    extraCss?: string;
    afterScript?: string;
    grain?: boolean;
  },
): string {
  const k = ctx.kitPrefix;
  // Agent-passed accents go INLINE on the scene element so they beat the pack/ground
  // class tokens (element-level classes out-cascade a :root declaration).
  const theme = [
    ctx.accent ? `--mg-accent:${esc(ctx.accent)};` : '',
    ctx.accent2 ? `--mg-accent-2:${esc(ctx.accent2)};` : '',
  ].join('');
  const fmt = formatOf(ctx);
  const fmtCls = fmt === 'tall' ? ' mg-portrait mg-fmt-tall' : fmt === 'square' ? ' mg-fmt-sq' : '';
  const exitCls = opts.exit === 'none' ? '' : ` ${opts.exit ?? 'mg-exit-up'}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${k}fonts/fonts.css">
<link rel="stylesheet" href="${k}motion-kit/motion.css">
<style>${opts.extraCss ?? ''}</style>
</head><body>
<div class="mg-scene ${opts.ground} mg-style-${ctx.style}${fmtCls}"${theme ? ` style="${theme}"` : ''}>
  <div class="mg-wash"></div>
  ${opts.bg ?? ''}${(ctx as any).__libBg ?? ''}
  <div class="${opts.cam ?? camera(ctx)}" style="position:absolute;inset:0;">
    <div class="scaffold-content${exitCls}" style="position:absolute;inset:0;display:flex;flex-direction:column;">
      ${opts.body}
    </div>
  </div>
  ${opts.grain ? '<div class="mg-grain"></div>' : ''}
  <div class="mg-vignette"></div>
</div>
<script src="${k}motion-kit/motion.js"></script>
${opts.afterScript ?? ''}
</body></html>`;
}

// ---------------------------------------------------------------------------
// The scaffold catalog
// ---------------------------------------------------------------------------

type Builder = (slots: Record<string, any>, ctx: ScaffoldCtx) => ScaffoldResult;

/** HOOK — the opening question/claim. Motion in the first second, ≤14 words, tease not resolve. */
const hookQuestion: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const question = cap(problems, 'question', slots.question, 14, true);
  const sub = cap(problems, 'sub', slots.sub, 10);
  const prop = inlineSvg(ctx, slots.prop, [], 'prop'); // optional; missing prop is not fatal for a hook
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground, ctx.sceneIndex); // auto index-0 = the dramatic ground
  const isSpace = ground === 'mg-ground-space';
  const stars = isSpace
    ? { bg: '<div class="mg-particles" id="mg-stars"></div>', script: `<script>__mgScatter('mg-stars',{count:110,seed:${7 + ctx.sceneIndex}})</script>` }
    : { bg: '', script: '' };
  const echo = echoWord(question);
  const fmt = formatOf(ctx);
  const marginL = fmt === 'landscape' ? '11vw' : '9vw';
  const body = `
  <div class="mg-fill" style="position:relative;z-index:2;display:flex;align-items:center;${fmt === 'tall' ? 'padding-top:6vh;' : ''}">
    ${kicker ? `<div class="mg-vert mg-fade mg-shimmer" style="--at:.05s;position:absolute;left:3.2vw;top:8vh;">${esc(kicker)}</div>` : ''}
    <div class="mg-col" style="align-items:flex-start;text-align:left;gap:2.2vh;margin-left:${marginL};max-width:${fmt === 'landscape' ? '72vw' : '82vw'};">
      <h1 class="mg-title" style="font-size:1px;">${richLines(question, 9.4, 0.12)}</h1>
      ${sub ? `<div class="mg-rulelabel mg-lag" style="--at:${atFrac(0.26)}">${esc(sub)}</div>` : ''}
    </div>
  </div>`;
  const bg = `${stars.bg}
  ${echo ? `<div class="mg-echo mg-outline" style="right:-6vw;bottom:-5vh;font-size:${dsize(34)};">${drift(`<span style="display:inline-block;">${esc(echo)}</span>`, { dur: 11, dx: '1.6vw', dy: '1vh' })}</div>` : ''}
  ${
    prop
      ? `<div class="mg-prop-hero br mg-depth-fg" style="z-index:1;"><div class="mg-breathe" style="--at:-1.2s;width:100%;height:100%;">${drawIcon(prop, '0.3s')}</div></div>`
      : ''
  }`;
  return { problems, html: shell(ctx, { ground, body, bg, cam: 'mg-cam-in', afterScript: stars.script, grain: ctx.style === 'nutshell' }) };
};

/** One oversized animated number with a settle pulse — the scale-contrast beat. */
const heroStat: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 6);
  const label = cap(problems, 'label', slots.label, 8, true);
  const value = Number(slots.value);
  if (!Number.isFinite(value)) problems.push('slot "value" must be a number');
  const from = Number.isFinite(Number(slots.from)) ? Number(slots.from) : 0;
  const decimals = Number.isFinite(Number(slots.decimals)) ? Math.min(2, Math.max(0, Number(slots.decimals))) : 0;
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground, ctx.sceneIndex);
  const shown = `${slots.prefix ?? ''}${value}${slots.suffix ?? ''}`;
  const fmt = formatOf(ctx);
  const statSize = fmt === 'landscape' ? dsize(34) : dsize(30);
  const body = `
  <div class="mg-safe mg-fill" style="display:flex;flex-direction:column;justify-content:center;align-items:flex-start;position:relative;z-index:1;padding-left:${fmt === 'landscape' ? '10vw' : '8vw'};">
    ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.06s">${esc(kicker)}</div>` : ''}
    <div class="mg-stress" style="--at:${atFrac(0.7)}"><div class="mg-stat mg-pop" style="--at:.25s;font-size:${statSize};line-height:.85;letter-spacing:-0.035em;">${esc(slots.prefix ?? '')}<span data-count-to="${value}" data-count-from="${from}" data-count-start-frac="0.2" data-count-dur="1300" data-count-decimals="${decimals}">${from}</span>${esc(slots.suffix ?? '')}</div></div>
    <div class="mg-bar" style="--at:${atFrac(0.45)};height:1vh;width:${fmt === 'landscape' ? '22vw' : '34vw'};background:var(--mg-accent);border-radius:0.5vh;margin:1.6vh 0 0.4vh;"></div>
    <div class="mg-lag" style="--at:${atFrac(0.42)};font-family:var(--mg-font-display);font-size:4.2vh;font-weight:600;margin-left:1vw;">${renderEmph(label)}</div>
  </div>`;
  const bg = `<div class="mg-echo mg-outline" style="right:-8vw;top:-8vh;font-size:${dsize(48)};font-family:var(--mg-font-data);">${drift(`<span style="display:inline-block;">${esc(shown)}</span>`, { dur: 10, dx: '1.4vw', dy: '1.2vh' })}</div>`;
  return { problems, html: shell(ctx, { ground, body: body + runline(0.55), bg }) };
};

/** A vs B comparison — slide-in halves, late verdict pop. */
const splitCompare: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const title = cap(problems, 'title', slots.title, 8);
  const verdict = cap(problems, 'verdict', slots.verdict, 8);
  const side = (s: any, slot: string): { title: string; lines: string[]; icon: string } => {
    const t = cap(problems, `${slot}.title`, s?.title, 4, true);
    const lines: string[] = Array.isArray(s?.lines) ? s.lines.slice(0, 3).map((l: any, i: number) => cap(problems, `${slot}.lines[${i}]`, l, 6)) : [];
    return { title: t, lines: lines.filter(Boolean), icon: inlineSvg(ctx, s?.icon, [], `${slot}.icon`) };
  };
  const L = side(slots.left, 'left');
  const R = side(slots.right, 'right');
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stackedCards = fmt === 'tall';
  const card = (s: { title: string; lines: string[]; icon: string }, cls: string, at: number, phase: number) => `
    <div class="${cls} mg-card" style="--at:${at}s;display:flex;flex-direction:column;gap:2.2vh;align-items:center;justify-content:center;text-align:center;padding:${stackedCards ? '3.4vh 4vw' : '4.5vh 2.5vw'};flex:1;">
      ${s.icon ? `<div class="mg-bob" style="--at:${-phase.toFixed(1)}s;animation-duration:4.4s;"><div class="mg-chip mg-contact" style="width:${dsize(14)};height:${dsize(14)};">${drawIcon(s.icon)}</div></div>` : ''}
      <div style="font-family:var(--mg-font-display);font-size:${dsize(5.8)};font-weight:700;">${esc(s.title)}</div>
      <div class="mg-col mg-stagger" style="--at:${(at + 0.35).toFixed(2)}s;gap:1.3vh;">
        ${s.lines.map((l) => `<div class="mg-reveal" style="font-size:${dsize(3.3)};font-weight:500;">${renderEmph(l)}</div>`).join('\n')}
      </div>
    </div>`;
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:${stackedCards ? '2.6vh' : '4vh'};">
    ${title ? `<div style="display:flex;flex-direction:column;align-items:center;"><h2 class="mg-title mg-reveal" style="--at:.05s;font-size:${dsize(6)};">${esc(title)}</h2></div>` : ''}
    <div style="display:flex;flex-direction:${stackedCards ? 'column' : 'row'};align-items:stretch;justify-content:center;gap:${stackedCards ? '2.5vh' : '2.5vw'};max-width:${fmt === 'landscape' ? '84vw' : '90vw'};margin:0 auto;width:100%;position:relative;${stackedCards ? '' : 'flex:1;max-height:56vh;'}">
      <div class="mg-echo mg-outline" style="left:50%;top:50%;transform:translate(-50%,-52%);font-size:${dsize(38)};z-index:0;">VS</div>
      ${card(L, 'mg-slide-l', 0.12, 1)}
      <div class="mg-pulse mg-pop" style="--at:${atFrac(0.36)};align-self:center;font-family:var(--mg-font-data);font-weight:800;font-size:3.4vh;background:var(--mg-ink);color:var(--mg-bg);border-radius:50%;width:9vh;height:9vh;display:flex;align-items:center;justify-content:center;flex:none;z-index:1;">VS</div>
      ${card(R, 'mg-slide-r', 0.44, 3)}
    </div>
    ${verdict ? `<div style="display:flex;justify-content:center;"><div class="${ctx.style === 'vox' || ctx.style === 'broadcast' ? 'mg-label-vox' : 'mg-key'}" style="--at:${atFrac(0.74)};font-size:3.6vh;">${esc(verdict)}</div></div>` : ''}
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** Numbered steps with icons — staggered reading-order reveals, asymmetric left rail. */
const processSteps: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const title = cap(problems, 'title', slots.title, 8, true);
  const steps: any[] = Array.isArray(slots.steps) ? slots.steps.slice(0, 5) : [];
  if (!steps.length) problems.push('slot "steps" needs 2-5 entries {label, icon?}');
  const items = steps.map((s: any, i: number) => ({
    label: cap(problems, `steps[${i}].label`, s?.label, 6, true),
    icon: inlineSvg(ctx, s?.icon, [], `steps[${i}].icon`),
  }));
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const psFmt = formatOf(ctx);
  const psStacked = psFmt === 'tall';
  const body = `
  <div class="mg-safe mg-fill ${psStacked ? 'mg-col' : 'mg-split'}" style="align-items:${psStacked ? 'stretch' : 'center'};${psStacked ? 'display:flex;justify-content:space-evenly;' : ''}">
    <div class="mg-col mg-left" style="align-items:flex-start;text-align:left;">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
      <h1 class="mg-title" style="font-size:${dsize(6.6)};">${maskLines(title, 'mg-title', 0.15)}</h1>
    </div>
    <div class="mg-col mg-stagger" style="--at:${atFrac(0.14)};--stagger:calc(var(--scene-s, 8) * 0.11s);gap:2.2vh;">
      ${items
        .map(
          (s, i) => `
      <div class="mg-card mg-slide-r mg-row" style="gap:2vw;align-items:center;margin-left:${(i * 2.4).toFixed(1)}vw;padding:2vh 2.6vw;">
        <div class="mg-kicker" style="font-size:3.2vh;min-width:4.5vh;">${i + 1}</div>
        ${s.icon ? `<div class="mg-bob" style="--at:-${(i * 1.3 + 0.5).toFixed(1)}s;animation-duration:4.6s;"><div class="mg-chip" style="width:${dsize(8)};height:${dsize(8)};">${drawIcon(s.icon, `${(0.3 + i * 0.25).toFixed(2)}s`)}</div></div>` : ''}
        <div style="font-size:${dsize(3.3)};font-weight:600;">${renderEmph(s.label)}</div>
      </div>`,
        )
        .join('\n')}
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** A real photographic/chart PLATE with annotation labels — the vox signature. */
const annotatedPlate: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const plate = String(slots.plate ?? '').trim();
  if (!plate) problems.push('slot "plate" is required: a workspace-relative image from search_photos (or generate_image)');
  const headline = cap(problems, 'headline', slots.headline, 10);
  const labels: any[] = Array.isArray(slots.labels) ? slots.labels.slice(0, 4) : [];
  const items = labels.map((l: any, i: number) => ({
    text: cap(problems, `labels[${i}].text`, l?.text, 8, true),
    x: String(l?.x ?? '10%'),
    y: String(l?.y ?? `${18 + i * 20}%`),
    kind: l?.kind === 'num' ? 'num' : l?.kind === 'ink' ? 'ink' : '',
    at: Number.isFinite(Number(l?.at)) ? Number(l.at) : -1, // -1 = proportional default
  }));
  if (problems.length) return { problems };
  const labelCls = ctx.style === 'broadcast' ? 'mg-callout' : ctx.style === 'nordic' ? 'mg-label-vox ink' : 'mg-label-vox';
  // Studio treatment: duotone/archival wrap so a plate never reads as a raw stock rectangle.
  const treat = slots.treatment === 'duotone' ? 'mg-duotone' : slots.treatment === 'archival' ? 'mg-archival' : '';
  const bg = `
  <div class="mg-plate"><div class="mg-kenburns${treat ? ' ' + treat : ''}" style="width:100%;height:100%;position:relative;"><img src="${esc(ctx.kitPrefix + plate)}" alt=""></div></div>
  <div class="mg-plate-scrim${slots.scrim === 'top' ? ' top' : ''}"></div>`;
  const body = `
  <div class="mg-fill" style="position:relative;">
    ${items
      .map(
        (l) =>
          `<div class="${labelCls}${l.kind ? ' ' + l.kind : ''}" style="position:absolute;left:${esc(l.x)};top:${esc(l.y)};--at:${l.at >= 0 ? l.at.toFixed(2) + 's' : atFrac(0.18 + items.indexOf(l) * 0.17)};max-width:34vw;">${esc(l.text)}</div>`,
      )
      .join('\n')}
    ${headline ? `<div style="position:absolute;left:6vw;bottom:7vh;right:6vw;color:#fff;"><h1 class="mg-title-serif" style="font-size:6vh;color:#fff;">${maskLines(headline, '', 0.2)}</h1></div>` : ''}
  </div>`;
  const ground = groundClass(ctx.style, slots.ground ?? 'home', ctx.sceneIndex);
  return { problems, html: shell(ctx, { ground, body, bg, cam: 'mg-cam-drift', exit: 'mg-exit-fade' }) };
};

/** Subject + shouting boxed callout — the broadcast signature (numbers get labeled). */
const callout: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const text = cap(problems, 'text', slots.text, 8, true);
  const big = String(slots.big ?? '').trim();
  const subjectLabel = cap(problems, 'subjectLabel', slots.subjectLabel, 4);
  const subject = inlineSvg(ctx, slots.subject, problems, 'subject');
  if (problems.length) return { problems };
  const tone = ctx.style === 'nordic' ? '' : slots.tone === 'danger' ? ' danger' : slots.tone === 'money' ? ' money' : '';
  const calloutCls = ctx.style === 'nordic' ? 'mg-label-vox ink' : 'mg-callout';
  const ground = groundClass(ctx.style, slots.ground ?? 'home', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stacked = fmt === 'tall';
  // The big number is a HERO STAT above the boxed label, never inline inside it (the
  // audit's worst frames: a giant icon dwarfing a tiny box reading "28HEAT KILLS…").
  const body = `
  <div class="mg-safe mg-fill ${stacked ? 'mg-col mg-center' : 'mg-split'}" style="align-items:center;${stacked ? 'display:flex;justify-content:space-evenly;' : ''}">
    <div style="position:relative;display:flex;justify-content:center;">
      <div class="mg-bob" style="--at:-1s;width:${dsize(26)};height:${dsize(26)};"><div class="${slots.tone === 'danger' ? 'mg-shake' : ''}" style="width:100%;height:100%;${slots.tone === 'danger' ? `--at:${atFrac(0.5)};` : ''}"><div class="mg-pop mg-contact" style="--at:.15s;width:100%;height:100%;">${drawIcon(subject, '0.2s')}</div></div></div>
      ${subjectLabel ? `<div class="mg-tag" style="left:12%;top:6%;--at:${atFrac(0.3)}">${esc(subjectLabel)}</div>` : ''}
    </div>
    <div class="mg-col" style="align-items:${stacked ? 'center' : 'flex-start'};gap:2.2vh;${stacked ? 'text-align:center;' : ''}">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.1s">${esc(kicker)}</div>` : ''}
      ${big ? `<div class="mg-stress" style="--at:${atFrac(0.72)}"><div class="mg-stat mg-pop" style="--at:${atFrac(0.34)};font-size:${dsize(17)};line-height:.9;"><span data-count-to="${Number(big) || 0}" data-count-start-frac="0.34" data-count-dur="1100">0</span></div></div>` : ''}
      <div class="${calloutCls}${tone}" style="--at:${atFrac(0.5)};font-size:${dsize(3.4)};">${renderEmph(text)}</div>
    </div>
  </div>`;
  const echo = big || echoWord(text);
  const bg = echo ? `<div class="mg-echo mg-outline" style="left:-5vw;bottom:-6vh;font-size:${dsize(36)};font-family:var(--mg-font-data);">${drift(`<span style="display:inline-block;">${esc(echo)}</span>`, { dur: 12, dx: '1.2vw', dy: '0.9vh' })}</div>` : '';
  return { problems, html: shell(ctx, { ground, body: body + (stacked ? '' : runline(0.6)), bg }) };
};

/** The nutshell mascot acts a beat — comedy/empathy carrier. */
const characterBeat: Builder = (slots, ctx) => {
  const problems: string[] = [];
  if (ctx.style !== 'nutshell') {
    return { problems: [`character-beat (the mascot) is a NUTSHELL-only device — in ${ctx.style}, use hero-stat, quote-punch or annotated-plate instead (pack fidelity)`] };
  }
  const line = cap(problems, 'line', slots.line, 12, true);
  const prop = inlineSvg(ctx, slots.prop, [], 'prop');
  if (problems.length) return { problems };
  const acting = ['hop', 'flap', 'look-l', 'look-r', 'look-up'].includes(String(slots.acting)) ? String(slots.acting) : 'hop';
  const ground = groundClass(ctx.style, slots.ground ?? (ctx.style === 'nutshell' ? 'space' : 'dark'), ctx.sceneIndex);
  const isSpace = ground === 'mg-ground-space';
  const stars = isSpace ? { bg: '<div class="mg-particles" id="mg-stars"></div>', script: `<script>__mgScatter('mg-stars',{count:100,seed:${11 + ctx.sceneIndex}})</script>` } : { bg: '', script: '' };
  const body = `
  <div class="mg-safe mg-fill mg-split" style="align-items:center;">
    <div style="display:flex;justify-content:center;">
      <div class="mg-pop" style="--at:.1s"><div class="mg-bird ${acting} mg-bob" style="--at:${atFrac(0.4)};--bird:${esc(slots.birdColor ?? '#ffb433')}">
        <div class="body"></div><div class="belly"></div>
        <div class="eye l"><div class="pupil"></div></div><div class="eye r"><div class="pupil"></div></div>
        <div class="beak"></div><div class="wing l"></div><div class="wing r"></div><div class="shadow"></div>
      </div></div>
    </div>
    <div class="mg-col mg-left" style="align-items:flex-start;text-align:left;gap:2.6vh;">
      <h1 class="mg-title mg-words" style="--at:.35s;--wstag:.08s;font-size:6.2vh;">${esc(line)}</h1>
      ${prop ? `<div class="mg-float" style="--at:-2s"><div class="mg-pop mg-glow" style="--at:${atFrac(0.55)};width:14vh;height:14vh;">${prop}</div></div>` : ''}
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body, bg: stars.bg, afterScript: stars.script, grain: ctx.style === 'nutshell' }) };
};

/** A render_chart SVG + one insight line with the key phrase swept. */
const chartInsight: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const insight = cap(problems, 'insight', slots.insight, 12, true);
  const chart = inlineSvg(ctx, slots.chart, problems, 'chart');
  if (problems.length) return { problems };
  const hi = String(slots.highlight ?? '').trim();
  let insightHtml = esc(insight);
  if (hi && insight.toLowerCase().includes(hi.toLowerCase())) {
    const idx = insight.toLowerCase().indexOf(hi.toLowerCase());
    insightHtml = `${esc(insight.slice(0, idx))}<span class="${ctx.style === 'vox' ? 'mg-highlight' : 'mg-mark'}" style="--at:${atFrac(0.66)}">${esc(insight.slice(idx, idx + hi.length))}</span>${esc(insight.slice(idx + hi.length))}`;
  }
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const ciFmt = formatOf(ctx);
  const ciStacked = ciFmt === 'tall';
  const body = `
  <div class="mg-safe mg-fill ${ciStacked ? 'mg-col' : 'mg-split'}" style="align-items:center;${ciStacked ? 'display:flex;justify-content:space-evenly;' : ''}">
    ${drift(`<div class="mg-reveal mg-card" style="--at:.15s;padding:3.4vh 2.4vw;display:flex;align-items:center;justify-content:center;${ciStacked ? 'width:100%;' : ''}">
      <div style="width:100%;max-height:${ciStacked ? '48vh' : '64vh'};">${chart}</div>
    </div>`, { dur: 12, dx: '0.5vw', dy: '0.6vh' })}
    <div class="mg-col mg-left" style="align-items:flex-start;text-align:left;gap:2.4vh;">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
      <h2 style="font-family:var(--mg-font-display);font-size:${dsize(5.4)};line-height:1.2;font-weight:600;"><span class="mg-mask"><span class="mg-rise" style="--at:${atFrac(0.32)}">${insightHtml}</span></span></h2>
      <div class="mg-bar" style="--at:${atFrac(0.5)};height:0.8vh;width:16vw;background:var(--mg-accent);border-radius:0.4vh;"></div>
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** Big masked-rise statement lines — the typographic moment. */
const quotePunch: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const lines: any[] = Array.isArray(slots.lines) ? slots.lines.slice(0, 3) : [];
  if (!lines.length) problems.push('slot "lines" needs 1-3 short lines');
  const texts = lines.map((l: any, i: number) => cap(problems, `lines[${i}]`, l, 8, true));
  const attribution = cap(problems, 'attribution', slots.attribution, 6);
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'accent', ctx.sceneIndex);
  const maxLen = Math.max(...texts.map((t) => t.length), 1);
  const qpEcho = echoWord(texts.join(' '));
  const body = `
  <div class="mg-safe mg-center mg-col mg-fill" style="display:flex;gap:1.2vh;position:relative;z-index:1;">
    <h1 class="mg-title" style="font-size:1px;display:flex;flex-direction:column;gap:.6vh;align-items:center;">
      ${texts.map((t, i) => `<span class="mg-mask"><span class="mg-rise" style="--at:${i === 0 ? '.15s' : atFrac(0.1 + i * 0.16)};font-size:min(${(8.6 * Math.min(1.6, Math.max(0.72, maxLen / Math.max(t.length, 1)))).toFixed(1)}vh, ${(9.9 * Math.min(1.6, Math.max(0.72, maxLen / Math.max(t.length, 1)))).toFixed(1)}vw);line-height:1.04;display:inline-block;${i % 2 ? 'font-style:italic;' : ''}">${renderEmph(t)}</span></span>`).join('\n')}
    </h1>
    ${attribution ? `<div class="mg-label mg-lag mg-shimmer" style="--at:${atFrac(0.6)};font-size:2.6vh;">${esc(attribution)}</div>` : ''}
  </div>
  ${qpEcho ? `<div class="mg-echo mg-outline" style="right:-5vw;top:-6vh;font-size:${dsize(30)};">${drift(`<span style="display:inline-block;">${esc(qpEcho)}</span>`, { dur: 11, dx: '1.3vw', dy: '1vh' })}</div>` : ''}`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** Ordered recap rows — the closing checklist. */
const listRecap: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const title = cap(problems, 'title', slots.title, 6);
  const list: any[] = Array.isArray(slots.items) ? slots.items.slice(0, 5) : [];
  if (list.length < 2) problems.push('slot "items" needs 2-5 entries {label, icon?}');
  const items = list.map((s: any, i: number) => ({
    label: cap(problems, `items[${i}].label`, s?.label, 7, true),
    icon: inlineSvg(ctx, s?.icon, [], `items[${i}].icon`),
  }));
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'dark', ctx.sceneIndex);
  const lrFmt = formatOf(ctx);
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:2.6vh;max-width:${lrFmt === 'landscape' ? '64vw' : '84vw'};margin:0 auto;">
    ${title ? `<div class="mg-kicker mg-reveal" style="--at:.05s;font-size:2.6vh;">${esc(title)}</div>` : ''}
    <div class="mg-col mg-stagger" style="--at:${atFrac(0.12)};--stagger:calc(var(--scene-s, 8) * 0.12s);gap:2vh;">
      ${items
        .map(
          (s, i) => `
      <div class="mg-slide-l mg-row" style="gap:2vw;align-items:center;margin-left:${(i * 2.2).toFixed(1)}vw;">
        <div class="mg-stat" style="font-size:${dsize(4.8)};min-width:6vh;">${i + 1}</div>
        ${s.icon ? `<div class="mg-bob" style="--at:-${(i * 1.1 + 0.4).toFixed(1)}s;animation-duration:4.8s;"><div class="mg-chip" style="width:${dsize(8.6)};height:${dsize(8.6)};">${drawIcon(s.icon, `${(0.3 + i * 0.25).toFixed(2)}s`)}</div></div>` : ''}
        <div style="font-size:${dsize(3.5)};font-weight:600;">${renderEmph(s.label)}</div>
      </div>`,
        )
        .join('\n')}
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body: body + runline(0.5), cam: 'mg-cam-out' }) };
};

/** The punch-out ending — short, kinetic, pays off the hook. Pair with a short narration. */
const endPunch: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const line = cap(problems, 'line', slots.line, 10, true);
  const sub = cap(problems, 'sub', slots.sub, 8);
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'accent', ctx.sceneIndex);
  const ws = line.split(/\s+/);
  const last = ws.pop() ?? '';
  const body = `
  <div class="mg-safe mg-center mg-col mg-fill" style="display:flex;gap:1vh;position:relative;z-index:1;">
    <h1 class="mg-title" style="font-size:${dsize(7)};display:flex;flex-direction:column;align-items:center;gap:.4vh;">
      <span class="mg-words" style="--at:.1s;--wstag:.07s;">${esc(ws.join(' '))}</span>
      <span class="mg-mask" style="display:block;"><span class="mg-rise" style="--at:${(0.3 + ws.length * 0.07).toFixed(2)}s;display:inline-block;"><span class="mg-breathe" style="--at:-1.6s;display:inline-block;"><span class="mg-key" style="--at:${(0.32 + ws.length * 0.07).toFixed(2)}s;color:${ground === 'mg-ground-accent' ? '#fff' : 'var(--mg-accent)'};font-size:${dsize(16)};line-height:.9;letter-spacing:-0.02em;">${esc(last)}</span></span></span></span>
    </h1>
    ${sub ? `<div class="mg-rulelabel mg-lag" style="--at:${atFrac(0.5)};color:inherit;opacity:.8;">${esc(sub)}</div>` : ''}
  </div>
  <div class="mg-echo mg-outline" style="left:-5vw;bottom:-7vh;font-size:${dsize(34)};">${drift(`<span style="display:inline-block;">${esc(last)}</span>`, { dur: 10, dx: '1.5vw', dy: '1vh' })}</div>`;
  return { problems, html: shell(ctx, { ground, body, cam: 'mg-cam-in', exit: 'mg-exit-scale' }) };
};

// ---------------------------------------------------------------------------
// SCENE-GRAMMAR archetypes (craft research 2026-07-05, MOTION_CRAFT.md): chapter cards
// as act-break breathers, timeline scrubs, and the quiet "breath" beat that keeps a
// dense video from feeling relentless.
// ---------------------------------------------------------------------------

/** Act-break title card: ghost number + chapter name + a rule that draws. 1.5-2.5s beat. */
const chapterCard: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const name = cap(problems, 'name', slots.name, 5, true);
  const kicker = cap(problems, 'kicker', slots.kicker, 4);
  const num = String(slots.number ?? '').trim().slice(0, 4) || String(ctx.sceneIndex + 1).padStart(2, '0');
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'dark', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const body = `
  <div class="mg-safe mg-fill" style="display:flex;align-items:center;position:relative;z-index:1;">
    <div class="mg-col" style="align-items:flex-start;gap:1.6vh;margin-left:${fmt === 'landscape' ? '12vw' : '9vw'};">
      ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
      <h1 class="mg-title" style="font-size:${dsize(8.4)};">${maskLines(name, '', 0.14)}</h1>
      <div class="mg-bar" style="--at:.5s;height:0.5vh;width:${fmt === 'landscape' ? '18vw' : '30vw'};background:var(--mg-accent);"></div>
    </div>
  </div>
  <div class="mg-echo mg-outline" style="right:-4vw;top:-8vh;font-size:${dsize(52)};font-family:var(--mg-font-data);opacity:.12;">${drift(`<span style="display:inline-block;">${esc(num)}</span>`, { dur: 12, dx: '1vw', dy: '1.2vh' })}</div>`;
  return { problems, html: shell(ctx, { ground, body, cam: 'mg-cam-in', exit: 'mg-exit-fade' }) };
};

/** Timeline scrub: a progress line draws while dated events pop along it as spoken. */
const timeline: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const title = cap(problems, 'title', slots.title, 8);
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const list: any[] = Array.isArray(slots.events) ? slots.events.slice(0, 5) : [];
  if (list.length < 3) problems.push('slot "events" needs 3-5 entries {label≤5w, year?}');
  const events = list.map((e: any, i: number) => ({
    label: cap(problems, `events[${i}].label`, e?.label, 5, true),
    year: String(e?.year ?? '').trim().slice(0, 8),
  }));
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stacked = fmt === 'tall';
  const n = events.length;
  const items = events
    .map((e, i) => {
      const at = atFrac(0.14 + (i / Math.max(1, n - 1)) * 0.5);
      if (stacked) {
        return `
        <div class="mg-row" style="gap:2.4vw;align-items:center;">
          <div class="mg-pop" style="--at:${at};width:2.6vh;height:2.6vh;border-radius:50%;background:var(--mg-accent);flex:none;"></div>
          <div class="mg-reveal" style="--at:${at};">
            ${e.year ? `<div class="mg-kicker" style="font-size:2.2vh;">${esc(e.year)}</div>` : ''}
            <div style="font-size:${dsize(3.4)};font-weight:600;">${renderEmph(e.label)}</div>
          </div>
        </div>`;
      }
      const above = i % 2 === 0;
      // endpoint labels shift inward so they never cross the frame edge (geometry gate)
      const shift = i === 0 ? '-18%' : i === n - 1 ? '-82%' : '-50%';
      const align = i === 0 ? 'left' : i === n - 1 ? 'right' : 'center';
      return `
      <div style="position:absolute;left:${(8 + (i / Math.max(1, n - 1)) * 78).toFixed(1)}%;top:50%;">
        <div class="mg-pop" style="--at:${at};width:2.6vh;height:2.6vh;border-radius:50%;background:var(--mg-accent);transform:translate(-50%,-50%);"></div>
        <div class="mg-reveal" style="--at:${at};position:absolute;left:0;${above ? 'bottom:3.4vh;' : 'top:3.4vh;'}transform:translateX(${shift});text-align:${align};width:16vw;min-width:20ch;max-width:24vw;">
          ${e.year ? `<div class="mg-kicker" style="font-size:2.1vh;">${esc(e.year)}</div>` : ''}
          <div style="font-size:${dsize(2.9)};font-weight:600;">${renderEmph(e.label)}</div>
        </div>
      </div>`;
    })
    .join('\n');
  const rail = stacked
    ? `<div class="mg-bar-v" style="--at:.2s;position:absolute;left:1.2vh;top:0;bottom:0;width:0.4vh;background:color-mix(in srgb, var(--mg-ink) 22%, transparent);animation-duration:calc(var(--scene-s, 8) * 0.6s);"></div>`
    : `<div class="mg-bar" style="--at:.2s;position:absolute;left:8%;right:14%;top:50%;height:0.4vh;background:color-mix(in srgb, var(--mg-ink) 22%, transparent);animation-duration:calc(var(--scene-s, 8) * 0.6s);"></div>`;
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:2.6vh;">
    ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
    ${title ? `<h2 class="mg-title" style="font-size:${dsize(5.4)};">${maskLines(title, '', 0.12)}</h2>` : ''}
    ${stacked ? `<div class="mg-col" style="gap:3.2vh;position:relative;padding-left:1vw;">${rail}${items}</div>` : `<div style="position:relative;flex:1;max-height:46vh;">${rail}${items}</div>`}
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** The breath — a near-empty quiet beat after a dense stretch. Minimal by design. */
const breath: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const line = cap(problems, 'line', slots.line, 6);
  const prop = inlineSvg(ctx, slots.prop, [], 'prop');
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'home', ctx.sceneIndex);
  const body = `
  <div class="mg-safe mg-center mg-col mg-fill" style="display:flex;gap:3vh;">
    ${prop ? drift(`<div class="mg-fade mg-breathe" style="--at:.3s;width:${dsize(12)};height:${dsize(12)};">${drawIcon(prop, '0.4s')}</div>`, { dur: 10, dx: '0.6vw', dy: '0.9vh' }) : ''}
    ${line ? `<div class="mg-rulelabel mg-fade" style="--at:${atFrac(0.3)};">${esc(line)}</div>` : ''}
  </div>`;
  return { problems, html: shell(ctx, { ground, body, exit: 'mg-exit-fade' }) };
};

// ---------------------------------------------------------------------------
// ANIMATED DATA scaffolds (operator 2026-07-05: "there's no animated charts") — charts
// are BUILT from data slots and animate like editorial dataviz: staggered bar growth
// with counting labels, SVG line draw-on, donut fills. Color discipline: ONE highlighted
// series in the pack accent, the rest muted.
// ---------------------------------------------------------------------------

/** Horizontal animated bars — the ranking/comparison data moment. */
const barChart: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const title = cap(problems, 'title', slots.title, 8);
  const insight = cap(problems, 'insight', slots.insight, 10);
  const unit = String(slots.unit ?? '').trim().slice(0, 8);
  const list: any[] = Array.isArray(slots.bars) ? slots.bars.slice(0, 6) : [];
  if (list.length < 2) problems.push('slot "bars" needs 2-6 entries {label, value:num}');
  const bars = list.map((b: any, i: number) => ({
    label: cap(problems, `bars[${i}].label`, b?.label, 4, true),
    value: Number(b?.value),
  }));
  bars.forEach((b, i) => { if (!Number.isFinite(b.value)) problems.push(`bars[${i}].value must be a number`); });
  if (problems.length) return { problems };
  const maxV = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  const hotLabel = String(slots.highlight ?? '').trim().toLowerCase();
  const hotIdx = hotLabel ? bars.findIndex((b) => b.label.toLowerCase().includes(hotLabel)) : bars.reduce((m, b, i, a) => (b.value > a[m].value ? i : m), 0);
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const rows = bars
    .map((b, i) => {
      const at = atFrac(0.12 + i * 0.09);
      const w = Math.max(4, Math.round((Math.abs(b.value) / maxV) * 100));
      return `
      <div class="mgc-row${i === hotIdx ? ' hot' : ''}">
        <div class="mgc-label">${esc(b.label)}</div>
        <div class="mgc-track" style="margin-right:${fmt === 'landscape' ? '9vw' : '13vw'};">
          <div class="mgc-fill" style="--at:${at};width:${w}%;">
            <div class="mgc-val"><span data-count-to="${b.value}" data-count-start-frac="${(0.12 + i * 0.09).toFixed(2)}" data-count-dur="900">0</span>${esc(unit)}</div>
          </div>
        </div>
      </div>`;
    })
    .join('\n');
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:2.4vh;max-width:${fmt === 'landscape' ? '76vw' : '92vw'};margin:0 auto;width:100%;">
    ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
    ${title ? `<h2 class="mg-title" style="font-size:${dsize(5.6)};">${maskLines(title, '', 0.12)}</h2>` : ''}
    <div class="mg-col" style="gap:1.9vh;margin-top:1vh;">${rows}</div>
    ${insight ? `<div class="mg-lag" style="--at:${atFrac(0.66)};font-family:var(--mg-font-display);font-size:${dsize(3.4)};font-weight:600;">${renderEmph(insight, atFrac(0.78))}</div>` : ''}
    ${slots.source ? `<div class="mgc-source" style="--at:${atFrac(0.84)}">${esc(String(slots.source).slice(0, 60))}</div>` : ''}
  </div>`;
  return { problems, html: shell(ctx, { ground, body: body + runline(0.6) }) };
};

/** SVG line drawing on with gridlines, end dot, and a counting end value. */
const lineChart: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  const title = cap(problems, 'title', slots.title, 8);
  const insight = cap(problems, 'insight', slots.insight, 12);
  const unit = String(slots.unit ?? '').trim().slice(0, 8);
  const pts: number[] = Array.isArray(slots.points) ? slots.points.map(Number).slice(0, 12) : [];
  if (pts.length < 3 || pts.some((p) => !Number.isFinite(p))) problems.push('slot "points" needs 3-12 numbers (the y-values, in order)');
  const xl = Array.isArray(slots.labels) ? slots.labels.slice(0, 2).map((l: any) => String(l).slice(0, 14)) : [];
  if (problems.length) return { problems };
  const W = 1000, H = 520, PAD = 30;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const px = (i: number) => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const py = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const lineD = pts.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
  const areaD = `${lineD} L${px(pts.length - 1).toFixed(1)},${H - PAD} L${px(0).toFixed(1)},${H - PAD} Z`;
  const grid = [0.25, 0.5, 0.75].map((f) => `<line class="mgc-grid" x1="${PAD}" x2="${W - PAD}" y1="${(PAD + f * (H - PAD * 2)).toFixed(1)}" y2="${(PAD + f * (H - PAD * 2)).toFixed(1)}"/>`).join('');
  const last = pts[pts.length - 1];
  const rising = last >= pts[0];
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:2vh;max-width:${fmt === 'landscape' ? '74vw' : '92vw'};margin:0 auto;width:100%;">
    ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
    ${title ? `<h2 class="mg-title" style="font-size:${dsize(5.4)};">${maskLines(title, '', 0.12)}</h2>` : ''}
    <div style="position:relative;width:100%;">
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible;">
        ${grid}
        <path class="mgc-area" d="${areaD}"/>
        <path class="mgc-line" d="${lineD}" pathLength="1000"/>
        <circle class="mgc-dot" cx="${px(pts.length - 1).toFixed(1)}" cy="${py(last).toFixed(1)}" r="11"/>
        ${xl[0] ? `<text class="mgc-axis" x="${PAD}" y="${H - 4}">${esc(xl[0])}</text>` : ''}
        ${xl[1] ? `<text class="mgc-axis" x="${W - PAD}" y="${H - 4}" text-anchor="end">${esc(xl[1])}</text>` : ''}
      </svg>
      <div class="mg-pop" style="--at:${atFrac(0.42)};position:absolute;${rising ? 'top:-1vh;' : 'bottom:12%;'}right:0;font-family:var(--mg-font-data);font-variant-numeric:tabular-nums;font-size:${dsize(5.4)};font-weight:700;color:var(--mg-accent);"><span data-count-to="${last}" data-count-start-frac="0.16" data-count-dur="1400">0</span>${esc(unit)}</div>
    </div>
    ${insight ? `<div class="mg-lag" style="--at:${atFrac(0.62)};font-family:var(--mg-font-display);font-size:${dsize(3.4)};font-weight:600;">${renderEmph(insight, atFrac(0.76))}</div>` : ''}
    ${slots.source ? `<div class="mgc-source" style="--at:${atFrac(0.84)}">${esc(String(slots.source).slice(0, 60))}</div>` : ''}
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** Donut/gauge fill with a counting center number — the share/percentage moment. */
const donutStat: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const kicker = cap(problems, 'kicker', slots.kicker, 6);
  const label = cap(problems, 'label', slots.label, 8, true);
  const value = Number(slots.value);
  if (!Number.isFinite(value) || value < 0 || value > 100) problems.push('slot "value" must be a number 0-100 (a share/percentage)');
  if (problems.length) return { problems };
  const suffix = String(slots.suffix ?? '%').slice(0, 4);
  const ground = groundClass(ctx.style, slots.ground, ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stacked = fmt === 'tall';
  const donut = `
    <div style="position:relative;width:${stacked ? 'min(60vw, 36vh)' : dsize(36)};height:${stacked ? 'min(60vw, 36vh)' : dsize(36)};">
      <svg viewBox="0 0 120 120" style="width:100%;height:100%;">
        <circle class="mgc-donut-track" cx="60" cy="60" r="50" stroke-width="13"/>
        <circle class="mgc-donut-fill" cx="60" cy="60" r="50" stroke-width="13" pathLength="100" style="--off:${(100 - value).toFixed(1)};--at:${atFrac(0.14)};"/>
      </svg>
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
        <div class="mg-stat" style="font-size:${stacked ? 'min(16vw, 9.5vh)' : dsize(9.5)};line-height:1;"><span data-count-to="${value}" data-count-start-frac="0.14" data-count-dur="1300">0</span>${esc(suffix)}</div>
      </div>
    </div>`;
  const body = `
  <div class="mg-safe mg-fill ${stacked ? 'mg-col mg-center' : 'mg-split'}" style="align-items:center;${stacked ? 'display:flex;justify-content:space-evenly;' : ''}">
    <div style="display:flex;justify-content:center;">${drift(`<div class="mg-pop" style="--at:.2s;">${donut}</div>`, { dur: 10, dx: '0.5vw', dy: '0.7vh' })}</div>
    <div class="mg-col" style="align-items:${stacked ? 'center' : 'flex-start'};gap:2vh;${stacked ? 'text-align:center;' : ''}">
      ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.06s">${esc(kicker)}</div>` : ''}
      <div class="mg-lag" style="--at:${atFrac(0.4)};font-family:var(--mg-font-display);font-size:${dsize(4.6)};font-weight:600;max-width:${stacked ? '84vw' : '34vw'};">${renderEmph(label, atFrac(0.6))}</div>
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body: body + (stacked ? '' : runline(0.55)) }) };
};

// ---------------------------------------------------------------------------
// STUDIO scaffolds (operator 2026-07-05: "real photos, cut outs, typography… ready to be
// used for any kind of media") — photography as design material in every pack/format.
// ---------------------------------------------------------------------------

/** Validate a workspace-relative raster path (photo/cutout from search_photos). */
function imgPath(problems: string[], slot: string, value: unknown, required = false): string {
  const p = String(value ?? '').trim();
  if (!p) {
    if (required) problems.push(`slot "${slot}" is required: a workspace-relative image from search_photos (pass cutout:true there for -cutout.png subjects)`);
    return '';
  }
  if (!/\.(png|jpe?g|webp)$/i.test(p)) {
    problems.push(`slot "${slot}": expected a workspace-relative photo path (.png/.jpg/.webp), got "${p}"`);
    return '';
  }
  return p;
}

/** The pack's cutout edge treatment: die-cut sticker (playful packs) or ink outline (print packs). */
function cutoutCls(style: MotionStyleId): string {
  if (style === 'nutshell' || style === 'broadcast') return 'mg-cutout sticker';
  if (style === 'nordic') return 'mg-cutout ink';
  return 'mg-cutout';
}

/** Full-bleed treated photo + giant typographic headline — the magazine-cover beat. */
const photoHero: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const photo = imgPath(problems, 'photo', slots.photo, true);
  const headline = cap(problems, 'headline', slots.headline, 10, true);
  const kicker = cap(problems, 'kicker', slots.kicker, 5);
  if (problems.length) return { problems };
  const treat = slots.treatment === 'plain' ? '' : slots.treatment === 'archival' ? 'mg-archival' : 'mg-duotone';
  const fmt = formatOf(ctx);
  // grain is a SIBLING overlay — mg-photo-grain::after would clobber mg-duotone::after
  // (both pseudo-elements) if stacked on one element.
  const bg = `
  <div class="mg-plate"><div class="mg-kenburns" style="width:100%;height:100%;position:relative;"><div${treat ? ` class="${treat}"` : ''} style="width:100%;height:100%;position:relative;"><img src="${esc(ctx.kitPrefix + photo)}" alt="" style="width:100%;height:100%;object-fit:cover;"></div><div class="mg-photo-grain" style="position:absolute;inset:0;"></div></div></div>
  <div class="mg-plate-scrim"></div>`;
  const echo = echoWord(headline);
  const body = `
  <div class="mg-fill" style="position:relative;z-index:1;display:flex;align-items:flex-end;">
    <div class="mg-col" style="align-items:flex-start;gap:2vh;margin:0 8vw ${fmt === 'tall' ? '12vh' : '9vh'};max-width:${fmt === 'landscape' ? '70vw' : '84vw'};color:#fff;">
      ${kicker ? `<div class="mg-rulelabel mg-reveal mg-shimmer" style="--at:.08s;color:rgba(255,255,255,.85);">${esc(kicker)}</div>` : ''}
      <h1 class="mg-title" style="font-size:1px;color:#fff;">${richLines(headline, fmt === 'landscape' ? 10.5 : 9, 0.15)}</h1>
    </div>
  </div>
  ${echo ? `<div class="mg-echo mg-outline" style="right:-6vw;top:-5vh;font-size:${dsize(30)};-webkit-text-stroke-color:rgba(255,255,255,.5);">${drift(`<span style="display:inline-block;">${esc(echo)}</span>`, { dur: 11, dx: '1.4vw', dy: '1vh' })}</div>` : ''}`;
  const ground = groundClass(ctx.style, slots.ground ?? 'home', ctx.sceneIndex);
  return { problems, html: shell(ctx, { ground, body, bg, cam: 'mg-cam-drift', exit: 'mg-exit-fade' }) };
};

/** Cutout subject + hero numeral — the collage-explainer stat beat. */
const cutoutStat: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const cut = imgPath(problems, 'cutout', slots.cutout, true);
  const label = cap(problems, 'label', slots.label, 8, true);
  const kicker = cap(problems, 'kicker', slots.kicker, 6);
  const value = Number(slots.value);
  if (!Number.isFinite(value)) problems.push('slot "value" must be a number');
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground, ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stacked = fmt === 'tall';
  const shown = `${slots.prefix ?? ''}${value}${slots.suffix ?? ''}`;
  const statSize = fmt === 'landscape' ? dsize(26) : dsize(22);
  const cutSize = stacked ? 'width:min(58vw, 40vh);height:min(58vw, 40vh);' : `width:${dsize(38)};height:${dsize(38)};`;
  const body = `
  <div class="mg-safe mg-fill ${stacked ? 'mg-col mg-center' : 'mg-split'}" style="align-items:center;${stacked ? 'display:flex;justify-content:space-evenly;' : ''}">
    <div class="mg-col" style="align-items:flex-start;gap:1.8vh;${stacked ? 'align-items:center;text-align:center;' : ''}position:relative;z-index:1;">
      ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.06s">${esc(kicker)}</div>` : ''}
      <div class="mg-stress" style="--at:${atFrac(0.72)}"><div class="mg-stat mg-pop" style="--at:.22s;font-size:${statSize};line-height:.88;">${esc(slots.prefix ?? '')}<span data-count-to="${value}" data-count-from="0" data-count-start-frac="0.2" data-count-dur="1300">0</span>${esc(slots.suffix ?? '')}</div></div>
      <div class="mg-bar" style="--at:${atFrac(0.45)};height:0.9vh;width:${stacked ? '30vw' : '18vw'};background:var(--mg-accent);border-radius:0.45vh;"></div>
      <div class="mg-lag" style="--at:${atFrac(0.42)};font-family:var(--mg-font-display);font-size:${dsize(4)};font-weight:600;">${renderEmph(label)}</div>
    </div>
    <div style="display:flex;justify-content:center;position:relative;">
      ${drift(`<div class="mg-pop ${cutoutCls(ctx.style)}" style="--at:.3s;${cutSize}"><img src="${esc(ctx.kitPrefix + cut)}" alt=""></div>`, { dur: 8, dx: '0.7vw', dy: '1vh' })}
    </div>
  </div>`;
  const bg = `<div class="mg-echo mg-outline" style="left:-6vw;bottom:-8vh;font-size:${dsize(44)};font-family:var(--mg-font-data);">${drift(`<span style="display:inline-block;">${esc(shown)}</span>`, { dur: 12, dx: '1.4vw', dy: '1vh' })}</div>`;
  return { problems, html: shell(ctx, { ground, body: body + (stacked ? '' : runline(0.55)), bg }) };
};

/** Two cutout subjects face off — the collage version of split-compare. */
const collageCompare: Builder = (slots, ctx) => {
  const problems: string[] = [];
  const title = cap(problems, 'title', slots.title, 8);
  const verdict = cap(problems, 'verdict', slots.verdict, 8);
  const side = (s: any, slot: string) => ({
    cutout: imgPath(problems, `${slot}.cutout`, s?.cutout, true),
    title: cap(problems, `${slot}.title`, s?.title, 4, true),
  });
  const L = side(slots.left, 'left');
  const R = side(slots.right, 'right');
  if (problems.length) return { problems };
  const ground = groundClass(ctx.style, slots.ground ?? 'light', ctx.sceneIndex);
  const fmt = formatOf(ctx);
  const stacked = fmt === 'tall';
  const labelCls = ctx.style === 'vox' || ctx.style === 'broadcast' ? 'mg-label-vox' : ctx.style === 'nordic' ? 'mg-label-vox ink' : 'mg-key';
  const cutSize = stacked ? 'width:min(64vw, 30vh);height:min(64vw, 30vh);' : `width:${dsize(30)};height:${dsize(30)};`;
  const sideCol = (s: { cutout: string; title: string }, cls: string, at: number, phase: number) => `
    <div class="${cls}" style="--at:${at}s;display:flex;flex-direction:column;align-items:center;gap:2vh;flex:1;position:relative;">
      ${drift(`<div class="${cutoutCls(ctx.style)}" style="${cutSize}"><img src="${esc(ctx.kitPrefix + s.cutout)}" alt=""></div>`, { dur: 8 + phase, dx: '0.6vw', dy: '0.9vh', at: `-${phase}s` })}
      <div class="${labelCls}" style="--at:${(at + 0.3).toFixed(2)}s;font-size:${dsize(3.4)};">${esc(s.title)}</div>
    </div>`;
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:${stacked ? '2vh' : '3.5vh'};">
    ${title ? `<div style="display:flex;justify-content:center;"><h2 class="mg-title mg-reveal" style="--at:.05s;font-size:${dsize(5.8)};">${esc(title)}</h2></div>` : ''}
    <div style="display:flex;flex-direction:${stacked ? 'column' : 'row'};align-items:center;justify-content:center;gap:${stacked ? '2vh' : '2vw'};position:relative;">
      <div class="mg-echo mg-outline" style="left:50%;top:50%;transform:translate(-50%,-52%);font-size:${dsize(36)};z-index:0;">VS</div>
      ${sideCol(L, 'mg-slide-l', 0.12, 1)}
      <div class="mg-pulse mg-pop" style="--at:${atFrac(0.36)};font-family:var(--mg-font-data);font-weight:800;font-size:3.2vh;background:var(--mg-ink);color:var(--mg-bg);border-radius:50%;width:8.5vh;height:8.5vh;display:flex;align-items:center;justify-content:center;flex:none;z-index:1;">VS</div>
      ${sideCol(R, 'mg-slide-r', 0.4, 3)}
    </div>
    ${verdict ? `<div style="display:flex;justify-content:center;"><div class="${ctx.style === 'vox' || ctx.style === 'broadcast' ? 'mg-label-vox' : 'mg-key'}" style="--at:${atFrac(0.74)};font-size:3.4vh;">${esc(verdict)}</div></div>` : ''}
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

const BUILDERS: Record<string, Builder> = {
  'hook-question': hookQuestion,
  'hero-stat': heroStat,
  'split-compare': splitCompare,
  'process-steps': processSteps,
  'annotated-plate': annotatedPlate,
  callout,
  'character-beat': characterBeat,
  'chart-insight': chartInsight,
  'quote-punch': quotePunch,
  'list-recap': listRecap,
  'end-punch': endPunch,
  'photo-hero': photoHero,
  'cutout-stat': cutoutStat,
  'collage-compare': collageCompare,
  'bar-chart': barChart,
  'line-chart': lineChart,
  'donut-stat': donutStat,
  'chapter-card': chapterCard,
  timeline,
  breath,
};

export const SCAFFOLD_IDS = Object.keys(BUILDERS);

/** One-line slot documentation per scaffold (embedded in the tool description). */
export const SCAFFOLD_DOC =
  'hook-question{question≤14w, kicker?, sub?, prop?:svg} · hero-stat{value:num, label≤8w, prefix?, suffix?, from?, kicker?} · ' +
  'split-compare{left/right:{title≤4w, lines?[≤3×6w], icon?:svg}, title?, verdict?} · process-steps{title≤8w, steps[2-5]:{label≤6w, icon?:svg}, kicker?} · ' +
  'annotated-plate{plate:img-path, labels?[≤4]:{text≤8w, x?, y?, kind?:num|ink, at?:s}, headline?, scrim?:top} · ' +
  'callout{subject:svg, text≤8w, big?:num, tone?:danger|money, subjectLabel?, kicker?} · character-beat{line≤12w, acting?:hop|flap|look-l|look-r|look-up, prop?:svg} · ' +
  'chart-insight{chart:svg-path, insight≤12w, highlight?:phrase, kicker?} · quote-punch{lines[1-3×8w], attribution?} · ' +
  'list-recap{items[2-5]:{label≤7w, icon?:svg}, title?} · end-punch{line≤10w, sub?} · ' +
  'photo-hero{photo:img-path, headline≤10w, kicker?, treatment?:duotone|archival|plain} · ' +
  'cutout-stat{cutout:png-path (search_photos cutout:true), value:num, label≤8w, prefix?, suffix?, kicker?} · ' +
  'collage-compare{left/right:{cutout:png-path, title≤4w}, title?, verdict?} · ' +
  'bar-chart{bars[2-6]:{label≤4w, value:num}, title?, kicker?, unit?, highlight?:label, insight?} · ' +
  'line-chart{points[3-12]:nums, title?, kicker?, labels?[first,last], unit?, insight?} · donut-stat{value:0-100, label≤8w, kicker?, suffix?} · ' +
  'chapter-card{name≤5w, number?, kicker?} (act break, 1.5-2.5s via min_ms) · timeline{events[3-5]:{label≤5w, year?}, title?, kicker?} · breath{line?≤6w, prop?:svg} (quiet beat after a dense stretch). ' +
  'Charts also take source? (credibility line, fades in last). ' +
  'Common slots: ground?:light|dark|accent (auto-rotates for contrast when omitted); bg?:<design-library background id> (search_motion_design kind:"background" — an animated texture layer under the content); annotated-plate also takes treatment?:duotone|archival. ' +
  'EMPHASIS: mark the spoken keyword in any text slot with *asterisks* — it gets the pack\'s kinetic emphasis timed to the narration.';

/**
 * Materialize a scaffold spec to a full scene HTML page. Pure given ctx.readAsset.
 * problems[] non-empty → do not render; return them to the model verbatim.
 */
export function materializeScaffold(spec: { id: string; slots?: Record<string, any> }, ctx: ScaffoldCtx): ScaffoldResult {
  const builder = BUILDERS[String(spec?.id ?? '')];
  if (!builder) return { problems: [`unknown scaffold "${spec?.id}" — one of: ${SCAFFOLD_IDS.join(', ')}`] };
  try {
    // Common `bg` slot: a design-library background id (search_motion_design, kind
    // "background") — the animated layer is injected into the shell under the content.
    const bgId = String(spec.slots?.bg ?? '').trim();
    if (bgId) {
      // require lazily to avoid a module cycle (library imports MotionStyleId from here)
      const { designEntry } = require('./library') as typeof import('./library');
      const entry = designEntry(bgId);
      if (!entry || entry.kind !== 'background') {
        return { problems: [`slot "bg": unknown background id "${bgId}" — search_motion_design with kind:"background" and use an exact id`] };
      }
      (ctx as any).__libBg = entry.snippet;
    } else {
      (ctx as any).__libBg = '';
    }
    return builder(spec.slots ?? {}, ctx);
  } catch (e: any) {
    return { problems: [`scaffold "${spec.id}" failed: ${String(e?.message ?? e)}`] };
  }
}

/** Reader for workspace assets used by scaffold slots (icons/charts materialized earlier). */
export function workspaceAssetReader(repoDir: string): (rel: string) => string | null {
  return (rel: string) => {
    try {
      const abs = path.resolve(repoDir, rel);
      if (!abs.startsWith(path.resolve(repoDir))) return null;
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > 2_000_000) return null;
      return fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  };
}
