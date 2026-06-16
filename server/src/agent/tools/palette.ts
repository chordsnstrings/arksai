import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * Extract a real colour palette from an uploaded LOGO (or any image) so a build's
 * identity is taken FROM the brand — the dominant brand colour becomes the accent,
 * paired with cohesive neutrals — instead of a guessed/default blue. Deterministic
 * (samples pixels via headless Chromium); no vision model needed.
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}
interface Bucket extends RGB {
  count: number;
}
export interface Palette {
  accent: string;
  palette: string[];
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function toHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}
function saturation({ r, g, b }: RGB): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
}
function lightness({ r, g, b }: RGB): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
}

/**
 * Pure palette chooser (unit-tested): given colour buckets (with counts), pick the
 * brand ACCENT (strongest, most-present chroma that isn't a near-white/near-black
 * background or a grey) and the top brand colours. White/black/grey are skipped for
 * the accent because logos sit on white and use black text.
 */
export function pickPalette(buckets: Bucket[]): Palette {
  const sorted = [...buckets].filter((b) => b.count > 0).sort((a, b) => b.count - a.count);
  const palette = sorted.slice(0, 6).map(toHex);
  const candidates = sorted.filter((b) => {
    const l = lightness(b);
    return saturation(b) >= 0.18 && l > 0.1 && l < 0.92;
  });
  // A monochrome logo (only white/black/grey) has NO chroma candidate → use a
  // tasteful fallback rather than picking white/black as the "accent".
  let accent = '#3b5bdb';
  if (candidates.length) {
    candidates.sort((a, b) => saturation(b) * Math.sqrt(b.count) - saturation(a) * Math.sqrt(a.count));
    accent = toHex(candidates[0]);
  }
  return { accent, palette };
}

export const extractPaletteTool: ToolDef = {
  name: 'extract_palette',
  description:
    'Extract the real colour palette from a LOGO or image in the workspace (e.g. an uploaded uploads/logo.png) ' +
    'so the design identity is taken FROM the brand. Returns the dominant brand colour to use as the ACCENT plus the ' +
    'top brand colours. Use this whenever the user provides a logo — for ANY deliverable (web app, deck, doc, report) — ' +
    'then place the logo and apply the accent (nudged for AA contrast) with cohesive neutrals. If there is no logo, choose ' +
    'one deliberately beautiful palette instead.',
  parameters: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace-relative path to the image, e.g. "uploads/logo.png".' },
    },
    required: ['image'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `extract palette from ${String(a.image ?? '')}`,
  async run(args, ctx) {
    const rel = String(args.image ?? '').trim();
    if (!rel) return 'Error: provide the image path (e.g. "uploads/logo.png").';
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, rel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    if (!fs.existsSync(abs)) return `Error: ${rel} not found in the workspace.`;
    const ext = (path.extname(abs).slice(1) || 'png').toLowerCase();
    const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const src = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;

    let pw: any;
    try {
      pw = await import('playwright');
    } catch {
      return 'Note: colour extraction needs the headless browser, which is unavailable here — pick a deliberately beautiful palette instead, or derive it by eye from the logo.';
    }
    let browser: any;
    try {
      browser = await pw.chromium.launch();
      const page = await browser.newPage();
      const buckets = (await page.evaluate(async (imgSrc: string) => {
        // Runs in the browser; reach DOM globals via globalThis so the Node tsconfig
        // (no DOM lib) doesn't try to type-check `Image`/`document`.
        const g: any = globalThis as any;
        const img: any = new g.Image();
        const loaded = new Promise<boolean>((res) => {
          img.onload = () => res(true);
          img.onerror = () => res(false);
        });
        img.src = imgSrc;
        const okImg = await Promise.race([loaded, new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
        if (!okImg || !img.width) return [];
        const max = 80;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c: any = g.document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx2: any = c.getContext('2d');
        if (!ctx2) return [];
        ctx2.drawImage(img, 0, 0, w, h);
        const data = ctx2.getImageData(0, 0, w, h).data;
        const map = new Map<string, { r: number; g: number; b: number; count: number }>();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // skip transparent
          const r = data[i],
            g = data[i + 1],
            b = data[i + 2];
          const key = `${r >> 3},${g >> 3},${b >> 3}`; // quantize to 32 levels/channel
          const e = map.get(key) || { r: 0, g: 0, b: 0, count: 0 };
          e.r += r;
          e.g += g;
          e.b += b;
          e.count++;
          map.set(key, e);
        }
        return [...map.values()]
          .map((e) => ({ r: Math.round(e.r / e.count), g: Math.round(e.g / e.count), b: Math.round(e.b / e.count), count: e.count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 48);
      }, src)) as Bucket[];
      if (!buckets.length) return `Could not read pixels from ${rel} — pick a deliberately beautiful palette instead.`;
      const { accent, palette } = pickPalette(buckets);
      return (
        `Palette extracted from ${rel}:\n- Accent (use as the brand accent, nudge for AA contrast): ${accent}\n` +
        `- Brand colours: ${palette.join(', ')}\n` +
        `Apply ${accent} as the single accent across the deliverable, pair it with cohesive neutrals (near-black ink, soft light surfaces), and place the logo in the header/cover.`
      );
    } catch (e: any) {
      return `Note: couldn't extract colours (${e?.message ?? e}) — pick a deliberately beautiful palette instead.`;
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  },
};
