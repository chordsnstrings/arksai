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

export type MotionStyleId = 'clean' | 'nutshell' | 'broadcast' | 'vox';

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

const words = (s: unknown): number => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** Validate a text slot against its word ceiling; empty is allowed when optional. */
function cap(problems: string[], slot: string, value: unknown, max: number, required = false): string {
  const t = String(value ?? '').trim();
  if (!t) {
    if (required) problems.push(`slot "${slot}" is required`);
    return '';
  }
  if (words(t) > max) problems.push(`slot "${slot}" exceeds the ${max}-word ceiling (${words(t)} words) — on-screen text is keywords, not sentences`);
  return t;
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
  };
  const byToken: Record<string, string> = {
    light: home[style],
    home: home[style],
    dark: 'mg-ground-dark',
    accent: style === 'broadcast' ? 'mg-ground-dark' : 'mg-ground-accent',
    space: 'mg-ground-space',
    stage: 'mg-ground-stage',
    studio: 'mg-ground-studio',
    floor: 'mg-ground-floor',
  };
  if (ground && byToken[ground]) return byToken[ground];
  // auto rhythm: index 0 (the hook) lands on the dramatic ground, then alternates so
  // adjacent auto scenes NEVER share a ground (the scene-contrast doctrine by default).
  const rhythm =
    style === 'nutshell'
      ? ['mg-ground-space', 'mg-ground-dark', 'mg-ground-space', 'mg-ground-accent']
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
    .map((l, i) => `<span class="mg-mask"><span class="mg-rise" style="--at:${(startAt + i * perLine).toFixed(2)}s">${esc(l)}</span></span>`)
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
      return `<span class="mg-mask" style="display:block;"><span class="mg-rise" style="--at:${(startAt + i * 0.13).toFixed(2)}s;font-size:${size}vh;line-height:1.02;display:inline-block;">${esc(l)}</span></span>`;
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
  const theme = [
    ctx.accent ? `--mg-accent:${esc(ctx.accent)};` : '',
    ctx.accent2 ? `--mg-accent-2:${esc(ctx.accent2)};` : '',
  ].join('');
  const exitCls = opts.exit === 'none' ? '' : ` ${opts.exit ?? 'mg-exit-up'}`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="${k}fonts/fonts.css">
<link rel="stylesheet" href="${k}motion-kit/motion.css">
<style>:root{${theme}}${opts.extraCss ?? ''}</style>
</head><body>
<div class="mg-scene ${opts.ground}">
  <div class="mg-wash"></div>
  ${opts.bg ?? ''}
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
  const body = `
  <div class="mg-fill" style="position:relative;z-index:2;display:flex;align-items:center;">
    ${kicker ? `<div class="mg-vert mg-fade" style="--at:.05s;position:absolute;left:3.2vw;top:8vh;">${esc(kicker)}</div>` : ''}
    <div class="mg-col" style="align-items:flex-start;text-align:left;gap:2.2vh;margin-left:11vw;max-width:72vw;">
      <h1 class="mg-title" style="font-size:1px;">${richLines(question, 9.4, 0.12)}</h1>
      ${sub ? `<div class="mg-rulelabel mg-lag" style="--at:${atFrac(0.26)}">${esc(sub)}</div>` : ''}
    </div>
  </div>`;
  const bg = `${stars.bg}
  ${echo ? `<div class="mg-echo mg-outline mg-depth-bg" style="right:-6vw;bottom:-5vh;font-size:34vh;">${esc(echo)}</div>` : ''}
  ${
    prop
      ? `<div class="mg-prop-hero br mg-depth-fg" style="z-index:1;"><div class="mg-breathe" style="--at:-1.2s;width:100%;height:100%;">${prop}</div></div>`
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
  const body = `
  <div class="mg-safe mg-fill" style="display:flex;flex-direction:column;justify-content:center;align-items:flex-start;position:relative;z-index:1;padding-left:10vw;">
    ${kicker ? `<div class="mg-rulelabel mg-reveal" style="--at:.06s">${esc(kicker)}</div>` : ''}
    <div class="mg-stress" style="--at:${atFrac(0.7)}"><div class="mg-stat mg-pop" style="--at:.25s;font-size:32vh;line-height:.85;letter-spacing:-0.035em;">${esc(slots.prefix ?? '')}<span data-count-to="${value}" data-count-from="${from}" data-count-start-frac="0.2" data-count-dur="1300" data-count-decimals="${decimals}">${from}</span>${esc(slots.suffix ?? '')}</div></div>
    <div class="mg-lag" style="--at:${atFrac(0.42)};font-family:var(--mg-font-display);font-size:4.2vh;font-weight:600;margin-left:1vw;">${esc(label)}</div>
  </div>`;
  const bg = `<div class="mg-echo mg-outline mg-depth-bg" style="right:-8vw;top:-8vh;font-size:52vh;font-family:var(--mg-font-data);">${esc(shown)}</div>`;
  return { problems, html: shell(ctx, { ground, body, bg }) };
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
  const card = (s: { title: string; lines: string[]; icon: string }, cls: string, at: number) => `
    <div class="${cls} mg-band" style="--at:${at}s;display:flex;flex-direction:column;gap:2.2vh;align-items:center;text-align:center;padding:4vh 2.5vw;flex:1;">
      ${s.icon ? `<div class="mg-breathe" style="--at:-${(at + 1).toFixed(1)}s"><div class="mg-chip mg-contact" style="width:15vh;height:15vh;">${s.icon}</div></div>` : ''}
      <div style="font-family:var(--mg-font-display);font-size:5.4vh;font-weight:600;">${esc(s.title)}</div>
      <div class="mg-col mg-stagger" style="--at:${(at + 0.35).toFixed(2)}s;gap:1.2vh;">
        ${s.lines.map((l) => `<div class="mg-label mg-reveal" style="font-size:3vh;">${esc(l)}</div>`).join('\n')}
      </div>
    </div>`;
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:4vh;">
    ${title ? `<div style="display:flex;flex-direction:column;align-items:center;"><h2 class="mg-title mg-reveal" style="--at:.05s;font-size:5.6vh;">${esc(title)}</h2></div>` : ''}
    <div style="display:flex;align-items:stretch;justify-content:center;gap:3vw;max-width:82vw;margin:0 auto;width:100%;position:relative;">
      <div class="mg-echo mg-outline" style="left:50%;top:50%;transform:translate(-50%,-52%);font-size:42vh;z-index:0;">VS</div>
      ${card(L, 'mg-slide-l', 0.12)}
      <div class="mg-pop" style="--at:${atFrac(0.36)};align-self:center;font-family:var(--mg-font-data);font-weight:800;font-size:3.4vh;background:var(--mg-ink);color:var(--mg-bg);border-radius:50%;width:9vh;height:9vh;display:flex;align-items:center;justify-content:center;flex:none;">VS</div>
      ${card(R, 'mg-slide-r', 0.44)}
    </div>
    ${verdict ? `<div style="display:flex;justify-content:center;"><div class="mg-key" style="--at:${atFrac(0.74)};font-size:3.8vh;">${esc(verdict)}</div></div>` : ''}
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
  const body = `
  <div class="mg-safe mg-fill mg-split" style="align-items:center;">
    <div class="mg-col mg-left" style="align-items:flex-start;text-align:left;">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
      <h1 class="mg-title" style="font-size:6.4vh;">${maskLines(title, 'mg-title', 0.15)}</h1>
    </div>
    <div class="mg-col mg-stagger" style="--at:${atFrac(0.14)};--stagger:calc(var(--scene-s, 8) * 0.11s);gap:2.2vh;">
      ${items
        .map(
          (s, i) => `
      <div class="mg-band mg-slide-r mg-row" style="gap:2vw;align-items:center;margin-left:${(i * 2.4).toFixed(1)}vw;">
        <div class="mg-kicker" style="font-size:3vh;min-width:4.5vh;">${i + 1}</div>
        ${s.icon ? `<div class="mg-chip" style="width:8vh;height:8vh;">${s.icon}</div>` : ''}
        <div style="font-size:3.1vh;font-weight:600;">${esc(s.label)}</div>
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
  const labelCls = ctx.style === 'broadcast' ? 'mg-callout' : 'mg-label-vox';
  const bg = `
  <div class="mg-plate"><div class="mg-kenburns" style="width:100%;height:100%;"><img src="${esc(ctx.kitPrefix + plate)}" alt=""></div></div>
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
  const tone = slots.tone === 'danger' ? ' danger' : slots.tone === 'money' ? ' money' : '';
  const ground = groundClass(ctx.style, slots.ground ?? 'home', ctx.sceneIndex);
  const body = `
  <div class="mg-safe mg-fill mg-split" style="align-items:center;">
    <div style="position:relative;display:flex;justify-content:center;">
      <div class="mg-bob" style="--at:-1s;width:38vh;height:38vh;"><div class="mg-pop mg-contact" style="--at:.15s;width:100%;height:100%;">${subject}</div></div>
      ${subjectLabel ? `<div class="mg-tag" style="left:12%;top:6%;--at:${atFrac(0.3)}">${esc(subjectLabel)}</div>` : ''}
    </div>
    <div class="mg-col" style="align-items:flex-start;gap:2.4vh;">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.1s">${esc(kicker)}</div>` : ''}
      <div class="mg-callout${tone}" style="--at:${atFrac(0.42)};">${big ? `<span class="big"><span data-count-to="${Number(big) || 0}" data-count-start-frac="0.5" data-count-dur="1000">0</span></span>` : ''}${esc(text)}</div>
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body }) };
};

/** The nutshell mascot acts a beat — comedy/empathy carrier. */
const characterBeat: Builder = (slots, ctx) => {
  const problems: string[] = [];
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
  const body = `
  <div class="mg-safe mg-fill mg-split" style="align-items:center;">
    <div class="mg-reveal mg-band" style="--at:.15s;padding:3vh 2vw;display:flex;align-items:center;justify-content:center;">
      <div style="width:100%;max-height:64vh;">${chart}</div>
    </div>
    <div class="mg-col mg-left" style="align-items:flex-start;text-align:left;gap:2.4vh;">
      ${kicker ? `<div class="mg-kicker mg-reveal" style="--at:.05s">${esc(kicker)}</div>` : ''}
      <h2 style="font-family:var(--mg-font-display);font-size:5.2vh;line-height:1.2;font-weight:600;"><span class="mg-mask"><span class="mg-rise" style="--at:${atFrac(0.32)}">${insightHtml}</span></span></h2>
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
  const body = `
  <div class="mg-safe mg-center mg-col mg-fill" style="display:flex;gap:1.2vh;">
    <h1 class="mg-title" style="font-size:1px;display:flex;flex-direction:column;gap:.6vh;align-items:center;">
      ${texts.map((t, i) => `<span class="mg-mask"><span class="mg-rise" style="--at:${i === 0 ? '.15s' : atFrac(0.1 + i * 0.16)};font-size:${(8.6 * Math.min(1.6, Math.max(0.72, maxLen / Math.max(t.length, 1)))).toFixed(1)}vh;line-height:1.04;display:inline-block;${i % 2 ? 'font-style:italic;' : ''}">${esc(t)}</span></span>`).join('\n')}
    </h1>
    ${attribution ? `<div class="mg-label mg-lag" style="--at:${atFrac(0.6)};font-size:2.6vh;">${esc(attribution)}</div>` : ''}
  </div>`;
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
  const body = `
  <div class="mg-safe mg-col mg-fill" style="display:flex;justify-content:center;gap:2.6vh;max-width:64vw;margin:0 auto;">
    ${title ? `<div class="mg-kicker mg-reveal" style="--at:.05s;font-size:2.6vh;">${esc(title)}</div>` : ''}
    <div class="mg-col mg-stagger" style="--at:${atFrac(0.12)};--stagger:calc(var(--scene-s, 8) * 0.12s);gap:2vh;">
      ${items
        .map(
          (s, i) => `
      <div class="mg-slide-l mg-row" style="gap:2vw;align-items:center;margin-left:${(i * 2.2).toFixed(1)}vw;">
        <div class="mg-stat" style="font-size:4.6vh;min-width:6vh;">${i + 1}</div>
        ${s.icon ? `<div class="mg-chip" style="width:8.6vh;height:8.6vh;">${s.icon}</div>` : ''}
        <div style="font-size:3.4vh;font-weight:600;">${esc(s.label)}</div>
      </div>`,
        )
        .join('\n')}
    </div>
  </div>`;
  return { problems, html: shell(ctx, { ground, body, cam: 'mg-cam-out' }) };
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
    <h1 class="mg-title" style="font-size:7vh;display:flex;flex-direction:column;align-items:center;gap:.4vh;">
      <span class="mg-words" style="--at:.1s;--wstag:.07s;">${esc(ws.join(' '))}</span>
      <span class="mg-mask" style="display:block;"><span class="mg-rise mg-key" style="--at:${(0.3 + ws.length * 0.07).toFixed(2)}s;color:${ground === 'mg-ground-accent' ? '#fff' : 'var(--mg-accent)'};font-size:17vh;line-height:.9;letter-spacing:-0.02em;display:inline-block;">${esc(last)}</span></span>
    </h1>
    ${sub ? `<div class="mg-rulelabel mg-lag" style="--at:${atFrac(0.5)};color:inherit;opacity:.8;">${esc(sub)}</div>` : ''}
  </div>
  <div class="mg-echo mg-outline mg-depth-bg" style="left:-5vw;bottom:-7vh;font-size:36vh;">${esc(last)}</div>`;
  return { problems, html: shell(ctx, { ground, body, cam: 'mg-cam-in', exit: 'mg-exit-scale' }) };
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
};

export const SCAFFOLD_IDS = Object.keys(BUILDERS);

/** One-line slot documentation per scaffold (embedded in the tool description). */
export const SCAFFOLD_DOC =
  'hook-question{question≤14w, kicker?, sub?, prop?:svg} · hero-stat{value:num, label≤8w, prefix?, suffix?, from?, kicker?} · ' +
  'split-compare{left/right:{title≤4w, lines?[≤3×6w], icon?:svg}, title?, verdict?} · process-steps{title≤8w, steps[2-5]:{label≤6w, icon?:svg}, kicker?} · ' +
  'annotated-plate{plate:img-path, labels?[≤4]:{text≤8w, x?, y?, kind?:num|ink, at?:s}, headline?, scrim?:top} · ' +
  'callout{subject:svg, text≤8w, big?:num, tone?:danger|money, subjectLabel?, kicker?} · character-beat{line≤12w, acting?:hop|flap|look-l|look-r|look-up, prop?:svg} · ' +
  'chart-insight{chart:svg-path, insight≤12w, highlight?:phrase, kicker?} · quote-punch{lines[1-3×8w], attribution?} · ' +
  'list-recap{items[2-5]:{label≤7w, icon?:svg}, title?} · end-punch{line≤10w, sub?}. ' +
  'Common slots: ground?:light|dark|accent (auto-rotates for contrast when omitted).';

/**
 * Materialize a scaffold spec to a full scene HTML page. Pure given ctx.readAsset.
 * problems[] non-empty → do not render; return them to the model verbatim.
 */
export function materializeScaffold(spec: { id: string; slots?: Record<string, any> }, ctx: ScaffoldCtx): ScaffoldResult {
  const builder = BUILDERS[String(spec?.id ?? '')];
  if (!builder) return { problems: [`unknown scaffold "${spec?.id}" — one of: ${SCAFFOLD_IDS.join(', ')}`] };
  try {
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
