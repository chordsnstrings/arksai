// Research hub content layer. Articles live as JSON in client/public/research/ so they
// are ONE source: served statically (fetched here at runtime) AND read by the server's
// SEO layer (per-article <title>/description/OpenGraph + JSON-LD articleBody) so crawlers
// and answer engines get the real content, not an empty SPA shell.

export interface ArticleSection {
  heading: string;
  body: string[];
  list?: string[];
  pull?: string;
}
export interface ArticleSource {
  title: string;
  publisher: string;
  url: string;
  note?: string;
}
export interface Article {
  slug: string;
  title: string;
  dek: string;
  date: string;
  readingTimeMin: number;
  tags: string[];
  heroEyebrow: string;
  keyTakeaways: string[];
  sections: ArticleSection[];
  sources: ArticleSource[];
  seo?: { title?: string; description?: string; keywords?: string[] };
}

// Curated order (newest / most important first). Keep in sync with sitemap.xml + the
// server's RESEARCH_SLUGS in marketingMeta.ts.
export const RESEARCH_SLUGS = [
  'energy-the-next-currency',
  'east-ai-frontier',
  'reading-ai-benchmarks',
] as const;

const cache = new Map<string, Article>();

export async function loadArticle(slug: string): Promise<Article | null> {
  if (cache.has(slug)) return cache.get(slug)!;
  try {
    const res = await fetch(`/research/${slug}.json`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const a = (await res.json()) as Article;
    cache.set(slug, a);
    return a;
  } catch {
    return null;
  }
}

export async function loadIndex(): Promise<Article[]> {
  const all = await Promise.all(RESEARCH_SLUGS.map((s) => loadArticle(s)));
  const list = all.filter((a): a is Article => !!a);
  // Curated order is RESEARCH_SLUGS; keep it (don't re-sort) so the lead piece stays first.
  return list;
}

export function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''));
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
