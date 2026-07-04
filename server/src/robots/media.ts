import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config';
import { analyzeImage } from '../engines/minimax';
import { extractText } from '../lib/extract';

/**
 * Inbound attachment handling for robot channels — a customer sends a photo of a broken
 * product, a PDF receipt, a voice note; the robot should SEE it and answer accordingly.
 *
 * Images → M3 vision description (when keyed); pdf/docx → extracted text; txt/md/csv → read
 * directly; audio → an honest "can't listen yet" note (no ASR in the stack today). Every
 * note is bounded, failures degrade to a factual marker, and temp files are always cleaned.
 */

export interface InboundAttachment {
  kind: 'image' | 'document' | 'audio';
  name: string;
  /** Absolute temp path (caller cleans up via cleanupAttachments). */
  path: string;
  mime: string;
}

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DOC_NOTE_CAP = 1500;
const VISION_TIMEOUT_MS = 45_000;

/** Where channel downloads land before processing (cleaned per message). */
export function mediaTmpDir(): string {
  const dir = path.join(os.tmpdir(), 'arksai-robot-media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function classifyMime(mime: string, name: string): InboundAttachment['kind'] {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('audio/') || /\.(ogg|oga|mp3|m4a|wav|opus)$/i.test(name)) return 'audio';
  return 'document';
}

// Injectable deps so tests run without egress / heavy parsers.
let visionFn: typeof analyzeImage = analyzeImage;
let extractFn: typeof extractText = extractText;
export function __setMediaDeps(deps: { vision?: typeof analyzeImage; extract?: typeof extractText }): void {
  if (deps.vision) visionFn = deps.vision;
  if (deps.extract) extractFn = deps.extract;
}

function dataUrl(abs: string, mime: string): string {
  return `data:${mime || 'image/jpeg'};base64,${fs.readFileSync(abs).toString('base64')}`;
}

/** Describe each attachment for the reply context. Never throws; one line per file. */
export async function describeAttachments(atts: InboundAttachment[], signal: AbortSignal): Promise<string[]> {
  const notes: string[] = [];
  for (const a of atts.slice(0, MAX_ATTACHMENTS)) {
    try {
      const st = fs.existsSync(a.path) ? fs.statSync(a.path) : null;
      if (!st || !st.size) {
        notes.push(`${a.name}: (attachment could not be downloaded)`);
        continue;
      }
      if (st.size > MAX_ATTACHMENT_BYTES) {
        notes.push(`${a.name}: (too large to process — ask them to describe it or send a smaller file)`);
        continue;
      }
      if (a.kind === 'image') {
        if (config.minimaxApiKey) {
          const ac = new AbortController();
          const onAbort = () => ac.abort();
          signal.addEventListener('abort', onAbort, { once: true });
          const timer = setTimeout(() => ac.abort(), VISION_TIMEOUT_MS);
          try {
            const r = await visionFn(
              dataUrl(a.path, a.mime),
              'Describe this image precisely for a support agent answering the sender: what it shows, any visible ' +
                'text/numbers (order ids, error messages, labels), product/document type, and anything relevant to a ' +
                'likely question about it. 3-5 sentences, facts only.',
              ac.signal,
            );
            notes.push(`photo "${a.name}": ${r.ok && r.text ? r.text.trim().slice(0, 900) : '(image received — could not be analyzed right now)'}`);
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
          }
        } else {
          notes.push(`photo "${a.name}" (image received — describe-and-confirm with the sender if its contents matter)`);
        }
        continue;
      }
      if (a.kind === 'audio') {
        notes.push(
          `voice note "${a.name}" — you cannot listen to audio yet; warmly ask the sender to type the key points.`,
        );
        continue;
      }
      // Documents: txt/md/csv read directly; pdf/docx via the extractor.
      const ext = path.extname(a.name || a.path).toLowerCase();
      let text: string | null = null;
      if (['.txt', '.md', '.csv'].includes(ext)) text = fs.readFileSync(a.path, 'utf8');
      else text = await extractFn(a.path);
      if (text && !text.startsWith('[extraction failed')) {
        const t = text.replace(/\s+/g, ' ').trim().slice(0, DOC_NOTE_CAP);
        notes.push(`document "${a.name}" (contents): ${t}${text.length > DOC_NOTE_CAP ? '…' : ''}`);
      } else {
        notes.push(`document "${a.name}" (received, but its contents could not be read — ask for the key details)`);
      }
    } catch (e: any) {
      notes.push(`${a.name}: (could not be processed: ${String(e?.message ?? e).slice(0, 80)})`);
    }
  }
  if (atts.length > MAX_ATTACHMENTS) {
    notes.push(`(+${atts.length - MAX_ATTACHMENTS} more attachment(s) not processed — one message can carry at most ${MAX_ATTACHMENTS})`);
  }
  return notes;
}

/** Best-effort temp cleanup after a message is fully handled. */
export function cleanupAttachments(atts: InboundAttachment[]): void {
  for (const a of atts) {
    try {
      fs.rmSync(a.path, { force: true });
    } catch {
      /* best effort */
    }
  }
}
