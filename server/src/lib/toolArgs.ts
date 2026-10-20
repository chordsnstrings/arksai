/**
 * Parse streamed tool-call arguments. Strict JSON first; if that fails, recover the FIRST complete
 * top-level JSON object (string/escape-aware brace matching) when only trailing junk follows it —
 * a model occasionally streams a few stray characters after a valid object, and rejecting the whole
 * call would cost a retry turn on a large generation. Anything else → null (the tool reports the
 * malformed call as before). PURE (unit-tested).
 */
export function parseToolArgs(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through to recovery */
  }
  const start = raw.indexOf('{');
  if (start < 0 || raw.slice(0, start).trim()) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const obj = JSON.parse(raw.slice(start, i + 1));
        // Only accept when the remainder can't be a continuation of the object (no second object).
        return /^[^{]*$/.test(raw.slice(i + 1)) ? obj : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}
