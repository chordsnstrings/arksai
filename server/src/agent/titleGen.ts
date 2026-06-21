/** Derive a short sidebar title from the user's first message — instant, no model call.
 *  (We're MiniMax-only and its models think by default on the OpenAI surface, so a tiny
 *  title completion would stall; a clean heuristic is faster and always works.) */
export function deriveTitle(userText: string): string | null {
  if (!userText) return null;
  // First non-empty line, stripped of markdown/quotes and collapsed whitespace.
  const firstLine = userText
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return null;
  let t = firstLine
    .replace(/^["'#>*\-\s]+/, '')
    .replace(/["'`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Cut at a sentence/clause boundary if it's long, then cap length.
  if (t.length > 60) {
    const cut = t.slice(0, 60);
    const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
    t = (lastBreak > 24 ? cut.slice(0, lastBreak) : cut).trim();
  }
  // Capitalize the first letter; drop a trailing period.
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/[.\s]+$/, '');
  return t ? t.slice(0, 60) : null;
}
