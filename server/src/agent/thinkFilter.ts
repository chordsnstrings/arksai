/**
 * Strip MiniMax M3's inline <think>…</think> reasoning from a streamed text feed.
 * M3 (thinking mode) emits its chain-of-thought inline in `content`; we don't want
 * that in the user-facing chat or in the model context. Incremental and tag-split
 * safe: feed each content delta in, get back only the emittable (non-think) text;
 * call flush() at end of stream. A no-op pass-through for models that never emit it.
 */
export function makeThinkFilter(): ((chunk: string) => string) & { flush: () => string } {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let buf = '';
  // Longest suffix of s that is a prefix of tag — a possible split-across-chunks tag.
  const tailPrefix = (s: string, tag: string): number => {
    const max = Math.min(s.length, tag.length - 1);
    for (let k = max; k > 0; k--) if (s.endsWith(tag.slice(0, k))) return k;
    return 0;
  };
  const fn = (chunk: string): string => {
    buf += chunk;
    let out = '';
    for (;;) {
      if (!inThink) {
        const i = buf.indexOf(OPEN);
        if (i === -1) {
          const keep = tailPrefix(buf, OPEN); // hold back a possible partial "<think>"
          out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          break;
        }
        out += buf.slice(0, i);
        buf = buf.slice(i + OPEN.length);
        inThink = true;
      } else {
        const j = buf.indexOf(CLOSE);
        if (j === -1) {
          buf = buf.slice(buf.length - tailPrefix(buf, CLOSE)); // drop think content, keep a possible partial "</think>"
          break;
        }
        buf = buf.slice(j + CLOSE.length);
        inThink = false;
      }
    }
    return out;
  };
  (fn as any).flush = (): string => {
    if (inThink) {
      buf = '';
      return '';
    }
    const t = buf;
    buf = '';
    return t;
  };
  return fn as ((chunk: string) => string) & { flush: () => string };
}
