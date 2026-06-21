import fs from 'node:fs';
import type { ToolDef } from './common';
import { resolveInWorkspace, ToolError } from './common';

// Per-call output budget — keep a tool response bounded (token cost) while letting the
// agent page through any slide via the `slide` range. The manifest ALWAYS lists every
// slide (the whole point — a multi-slide deck can never silently lose a slide).
const MANIFEST_BODY_LINES = 4; // body lines shown per slide in the manifest
const MAX_OUTPUT = 60_000; // chars per call

interface SlideText {
  index: number; // 1-based slide number
  title: string;
  body: string[]; // body lines (text runs after the title)
  images: number; // count of pictures/blips
  tables: number; // count of tables
  notes: string; // speaker notes (may be empty)
}

/** Decode the handful of XML entities that appear in OOXML <a:t> runs. */
function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => safeCp(parseInt(d, 10)))
    .replace(/&amp;/g, '&'); // last, so &amp;lt; → &lt; not <
}
function safeCp(n: number): string {
  try {
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}

/** Pull all <a:t>…</a:t> text runs from an OOXML part, in document order. */
function textRuns(xml: string): string[] {
  const out: string[] = [];
  const re = /<a:t>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const t = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
  return out;
}

/** Number suffix of a slideN.xml / notesSlideN.xml path (natural-sort key). */
function fileNum(name: string): number {
  const m = name.match(/(\d+)\.xml$/);
  return m ? parseInt(m[1], 10) : 0;
}

export const readPresentationTool: ToolDef = {
  name: 'read_presentation',
  description:
    'Read an uploaded PowerPoint (.pptx) ACCURATELY — use this instead of read_file (a .pptx is a binary ' +
    'zip, so read_file returns garbage). Call with just `path` for a MANIFEST of every slide (title, bullet ' +
    'count, images, notes) — the right first step for "what is in this deck?". Then add `slide` (a 1-based ' +
    'number or a range "3-8") to read full slide text + speaker notes for those slides. For .ppt (the legacy ' +
    'binary format) ask the user to re-save as .pptx.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path to the .pptx, e.g. "uploads/deck.pptx".' },
      slide: {
        type: 'string',
        description: 'Optional: a 1-based slide NUMBER or a range "3-8". Omit for the full manifest of all slides.',
      },
    },
    required: ['path'],
  },
  modes: ['chat', 'plan', 'code', 'report'],
  summarize: (a) => `read_presentation ${String(a.path ?? '').slice(0, 50)}${a.slide ? ` · ${a.slide}` : ''}`,
  async run(args, ctx) {
    const p = String(args.path ?? '').trim();
    if (!p) return 'Error: a `path` is required.';
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, p);
    } catch (e) {
      return `Error: ${e instanceof ToolError ? e.message : String(e)}`;
    }
    if (!fs.existsSync(abs)) return `Error: no file at "${p}".`;

    let zip: any;
    try {
      const JSZip: any = (await import('jszip')).default ?? (await import('jszip'));
      zip = await JSZip.loadAsync(fs.readFileSync(abs));
    } catch (e: any) {
      return `Error: could not open the .pptx — ${String(e?.message ?? e).slice(0, 160)}. If it's a legacy .ppt, ask the user to re-save it as .pptx.`;
    }

    const names: string[] = Object.keys(zip.files);
    const slidePaths = names
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => fileNum(a) - fileNum(b));
    if (!slidePaths.length)
      return `"${p}" has no slides — it may not be a valid .pptx (a legacy binary .ppt won't work; ask the user to re-save as .pptx).`;

    // Deck title from docProps/core.xml <dc:title>.
    let deckTitle = '';
    try {
      const core = zip.file('docProps/core.xml');
      if (core) {
        const xml = await core.async('string');
        const m = xml.match(/<dc:title>([\s\S]*?)<\/dc:title>/);
        if (m) deckTitle = decodeXml(m[1]).replace(/\s+/g, ' ').trim();
      }
    } catch {
      /* title is optional */
    }

    // Speaker notes: ppt/notesSlides/notesSlideN.xml. The reliable mapping is via each
    // slide's rels (ppt/slides/_rels/slideN.xml.rels → a notesSlide target); fall back to
    // matching by the notesSlideN number, which usually aligns with the slide number.
    const notesByNum = new Map<number, string>();
    for (const n of names) {
      if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n)) {
        try {
          const xml = await zip.file(n)!.async('string');
          // A notes part also carries the slide's own placeholder text; the runs are
          // dominated by the actual note. Surface the joined runs (deduped against title later).
          const runs = textRuns(xml).filter((t) => !/^\d+$/.test(t)); // drop the lone slide-number run
          if (runs.length) notesByNum.set(fileNum(n), runs.join(' '));
        } catch {
          /* skip a bad notes part */
        }
      }
    }

    const slides: SlideText[] = [];
    for (let i = 0; i < slidePaths.length; i++) {
      const sp = slidePaths[i];
      const num = fileNum(sp);
      let xml = '';
      try {
        xml = await zip.file(sp)!.async('string');
      } catch {
        /* skip an unreadable slide but keep its slot */
      }
      const runs = textRuns(xml);
      const images = (xml.match(/<p:pic\b/g) || []).length || (xml.match(/<a:blip\b/g) || []).length;
      const tables = (xml.match(/<a:tbl\b/g) || []).length;

      // Resolve this slide's notes via rels when possible, else by matching number.
      let notes = '';
      try {
        const relPath = `ppt/slides/_rels/slide${num}.xml.rels`;
        const rel = zip.file(relPath);
        if (rel) {
          const relXml = await rel.async('string');
          const m = relXml.match(/Target="(?:\.\.\/)?notesSlides\/notesSlide(\d+)\.xml"/);
          if (m) notes = notesByNum.get(parseInt(m[1], 10)) || '';
        }
      } catch {
        /* fall through to number match */
      }
      if (!notes) notes = notesByNum.get(num) || '';

      // The FIRST text block on a slide is typically the title; the rest is body.
      const title = runs[0] || '(no title)';
      const body = runs.slice(1);
      // If the matched note is wholly the slide's own text (a mirrored placeholder), drop it.
      if (notes && new Set([title, ...body]).has(notes)) notes = '';

      slides.push({ index: i + 1, title, body, images, tables, notes });
    }
    const total = slides.length;

    /** Parse a `slide` arg: "3-8" → [3,8] or "5" → [5,5] (1-based, inclusive, clamped). */
    const parseSlideRange = (spec: string): [number, number] => {
      const r = spec.match(/^(\d+)\s*[-:]\s*(\d+)$/);
      if (r) return [Math.max(1, Math.min(total, +r[1])), Math.max(1, Math.min(total, +r[2]))];
      const n = parseInt(spec, 10);
      if (!isNaN(n)) return [Math.max(1, Math.min(total, n)), Math.max(1, Math.min(total, n))];
      return [1, total];
    };

    // ---- Specific slide(s) ----
    if (args.slide != null && String(args.slide).trim() !== '') {
      const spec = String(args.slide).trim();
      let [from, to] = parseSlideRange(spec);
      if (from > to) [from, to] = [to, from];
      const head = deckTitle ? `Deck "${deckTitle}" (${p}) — slides ${from}–${to} of ${total}:\n` : `${p} — slides ${from}–${to} of ${total}:\n`;
      let out = head;
      for (let i = from - 1; i < to && i < total; i++) {
        const s = slides[i];
        const meta = [s.images ? `${s.images} image${s.images === 1 ? '' : 's'}` : '', s.tables ? `${s.tables} table${s.tables === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
        let block = `\n— Slide ${s.index}/${total}: ${s.title}${meta ? ` [${meta}]` : ''} —\n`;
        for (const line of s.body) block += `• ${line}\n`;
        if (s.notes) block += `Speaker notes: ${s.notes}\n`;
        if (out.length + block.length > MAX_OUTPUT) {
          out += `\n… stopped at slide ${i} (output cap) — request a narrower \`slide\` range for the rest.\n`;
          return out.trimEnd();
        }
        out += block;
      }
      return out.trimEnd();
    }

    // ---- Manifest of every slide ----
    const head = `${deckTitle ? `Deck "${deckTitle}" — ` : ''}"${p}" — ${total} slide${total === 1 ? '' : 's'}:\n`;
    let out = '';
    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      const bits = [
        `${s.body.length} bullet${s.body.length === 1 ? '' : 's'}`,
        s.images ? `${s.images} image${s.images === 1 ? '' : 's'}` : '',
        s.tables ? `${s.tables} table${s.tables === 1 ? '' : 's'}` : '',
        s.notes ? 'notes' : '',
      ].filter(Boolean).join(', ');
      let block = `\nSlide ${s.index}/${total}: ${s.title} — ${bits}\n`;
      for (const line of s.body.slice(0, MANIFEST_BODY_LINES)) block += `  • ${line}\n`;
      if (s.body.length > MANIFEST_BODY_LINES)
        block += `  … +${s.body.length - MANIFEST_BODY_LINES} more line(s) — call read_presentation with slide:"${s.index}" for the full slide + notes.\n`;
      if (out.length + block.length > MAX_OUTPUT) {
        out += `\n[Manifest output cap reached after ${i} of ${total} slides — call read_presentation with slide:"${i + 1}-${total}" to read the remaining slides.]\n`;
        break;
      }
      out += block;
    }
    return (
      head +
      out +
      `\n[This is a structured overview of every slide. For a slide's full text + speaker notes call read_presentation with slide:"<n>" (or a range "3-8").]`
    );
  },
};
