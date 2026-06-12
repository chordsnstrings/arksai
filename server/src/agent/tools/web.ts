import { config } from '../../config';
import { scrubSecrets, truncateMiddle } from '../../lib/exec';
import { fetchPublic, htmlToText } from '../../lib/web';
import type { ToolDef } from './common';

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

async function serperSearch(query: string, signal: AbortSignal): Promise<SearchHit[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    signal,
    headers: { 'X-API-KEY': config.serperApiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: 10 }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data: any = await res.json();
  return (data.organic ?? []).map((o: any) => ({
    title: o.title ?? '',
    url: o.link ?? '',
    snippet: o.snippet ?? '',
  }));
}

async function braveSearch(query: string, signal: AbortSignal): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await fetch(url, {
    signal,
    headers: { 'X-Subscription-Token': config.braveApiKey, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data: any = await res.json();
  return (data.web?.results ?? []).map((o: any) => ({
    title: o.title ?? '',
    url: o.url ?? '',
    snippet: o.description ?? '',
  }));
}

/** No-key fallback: DuckDuckGo HTML endpoint, scraped. */
async function duckduckgoSearch(query: string, signal: AbortSignal): Promise<SearchHit[]> {
  const { body } = await fetchPublic(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    signal,
  );
  const hits: SearchHit[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) && hits.length < 10) {
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    hits.push({ title: htmlToText(m[2]).slice(0, 200), url, snippet: '' });
  }
  return hits;
}

export const webSearchTool: ToolDef = {
  name: 'web_search',
  description:
    'Search the web and return ranked results (title, URL, snippet). Use this to find current ' +
    'information, documentation, or sources, then web_fetch a URL to read it in full.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'The search query' } },
    required: ['query'],
  },
  modes: ['chat', 'plan', 'code'],
  summarize: (args) => String(args.query ?? '').slice(0, 100),
  async run(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return 'Error: empty query';
    let hits: SearchHit[] = [];
    let provider = '';
    try {
      if (config.serperApiKey) {
        provider = 'Serper';
        hits = await serperSearch(query, ctx.signal);
      } else if (config.braveApiKey) {
        provider = 'Brave';
        hits = await braveSearch(query, ctx.signal);
      } else {
        provider = 'DuckDuckGo';
        hits = await duckduckgoSearch(query, ctx.signal);
      }
    } catch (err: any) {
      return `Error: web search failed (${provider}): ${scrubSecrets(String(err?.message ?? err))}`;
    }
    if (hits.length === 0) return 'No results found.';
    const lines = hits.map(
      (h, i) => `${i + 1}. ${h.title}\n   ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`,
    );
    return `Results via ${provider}:\n\n${lines.join('\n\n')}`;
  },
};

export const webFetchTool: ToolDef = {
  name: 'web_fetch',
  description:
    'Fetch a public web page or API URL and return its readable text content (HTML is converted ' +
    'to text). Use after web_search to read a source in full.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: 'The http(s) URL to fetch' } },
    required: ['url'],
  },
  modes: ['chat', 'plan', 'code'],
  summarize: (args) => String(args.url ?? '').slice(0, 120),
  async run(args, ctx) {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: empty url';
    let result;
    try {
      result = await fetchPublic(url, ctx.signal);
    } catch (err: any) {
      return `Error: ${scrubSecrets(String(err?.message ?? err))}`;
    }
    const isHtml = /text\/html|application\/xhtml/i.test(result.contentType);
    const text = isHtml ? htmlToText(result.body) : result.body;
    const header = `[${result.status}] ${url} (${result.contentType || 'unknown type'})\n\n`;
    return header + truncateMiddle(scrubSecrets(text), 40_000);
  },
};
