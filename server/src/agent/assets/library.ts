/**
 * ASSET LIBRARY — ~20,000 vendored, open-licensed vector assets, searchable OFFLINE.
 *
 * Why: an autonomous motion-graphics/explainer build needs the RIGHT icon/logo for every
 * beat, and a model that hand-draws SVG paths or guesses slugs ships garbage. This module
 * indexes the vendored packs into one flat manifest and ranks matches DETERMINISTICALLY
 * (term overlap + a synonym map — the selectKnowledge pattern, no model call).
 *
 * Sets (all npm-vendored, self-hosted, ship in the image — no network, no keys):
 *  - @iconify-json/lucide  (ISC)   ~1,800 line icons
 *  - @iconify-json/tabler  (MIT)   ~6,200 line icons
 *  - @iconify-json/ph      (MIT)   Phosphor — regular + -fill kept (other weights skipped)
 *  - @iconify-json/healthicons (MIT/CC0 art) ~2,700 medical/health icons
 *  - simple-icons          (CC0; brand marks remain trademarks of their owners)
 *
 * Loaded LAZILY on first use (the JSONs are MBs — don't tax boot).
 */

export type AssetKind = 'icon' | 'logo';

export interface AssetEntry {
  /** Stable id, e.g. "lucide:heart-pulse" or "brand:stripe". */
  id: string;
  set: string;
  name: string;
  kind: AssetKind;
  /** Search tokens (name words + aliases). */
  terms: string[];
  /** simple-icons official brand hex (logos only). */
  brandHex?: string;
}

interface IconifyJson {
  icons: Record<string, { body: string; width?: number; height?: number }>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
}

interface LoadedSets {
  entries: AssetEntry[];
  byId: Map<string, AssetEntry>;
  iconify: Record<string, IconifyJson>;
  brands: Map<string, { title: string; hex: string; path: string }>;
}

// Concept → asset-vocabulary expansion for explainer briefs. Small and curated — the
// point is recall on COMMON beats (money, health, security…), not a thesaurus.
export const SYNONYMS: Record<string, string[]> = {
  money: ['coin', 'coins', 'cash', 'currency', 'dollar', 'wallet', 'banknote'],
  payment: ['credit-card', 'card', 'wallet', 'cash', 'receipt'],
  bank: ['landmark', 'building-bank', 'piggy-bank'],
  growth: ['trending-up', 'chart', 'sprout', 'rocket', 'arrow-up'],
  decline: ['trending-down', 'arrow-down', 'chart-down'],
  security: ['shield', 'lock', 'key', 'fingerprint'],
  secure: ['shield', 'lock', 'shield-check'],
  idea: ['lightbulb', 'sparkles', 'brain'],
  time: ['clock', 'hourglass', 'timer', 'calendar', 'watch'],
  speed: ['gauge', 'zap', 'rocket', 'timer'],
  team: ['users', 'people', 'user-group'],
  person: ['user', 'people'],
  talk: ['message', 'chat', 'phone', 'megaphone'],
  email: ['mail', 'inbox', 'send'],
  health: ['heart', 'heart-pulse', 'stethoscope', 'activity', 'pill'],
  heart: ['heart-pulse', 'cardiogram', 'heart-organ'],
  cholesterol: ['blood', 'blood-vessel', 'artery', 'heart-organ', 'lipid', 'blood-drop'],
  blood: ['blood-drop', 'blood-vessel', 'artery', 'vein', 'blood-pressure'],
  artery: ['blood-vessel', 'vein', 'blood', 'heart-organ'],
  ldl: ['cholesterol', 'blood-drop', 'blood-vessel', 'heart-organ'],
  doctor: ['stethoscope', 'doctor', 'nurse', 'hospital'],
  medicine: ['pill', 'pills', 'capsule', 'syringe', 'prescription'],
  exercise: ['running', 'dumbbell', 'bike', 'walking', 'yoga', 'gym'],
  food: ['apple', 'salad', 'utensils', 'carrot', 'fish', 'egg', 'nutrition'],
  diet: ['salad', 'apple', 'avocado', 'nutrition', 'fruit', 'vegetables'],
  smoking: ['cigarette', 'smoke', 'no-smoking'],
  data: ['chart', 'database', 'graph', 'analytics'],
  document: ['file', 'file-text', 'clipboard', 'notebook'],
  settings: ['gear', 'settings', 'sliders', 'wrench'],
  ai: ['brain', 'cpu', 'sparkles', 'bot', 'robot'],
  phone: ['smartphone', 'device-mobile', 'mobile'],
  web: ['globe', 'browser', 'world'],
  shipping: ['truck', 'package', 'box'],
  shop: ['shopping-cart', 'store', 'shopping-bag', 'storefront'],
  warning: ['alert-triangle', 'alert', 'warning-circle'],
  success: ['check', 'circle-check', 'badge-check', 'trophy'],
  goal: ['target', 'flag', 'trophy', 'crosshair'],
  home: ['house', 'building'],
  travel: ['plane', 'map', 'compass', 'luggage'],
  weather: ['sun', 'cloud', 'rain', 'moon'],
  energy: ['zap', 'battery', 'bolt', 'flame'],
  nature: ['leaf', 'tree', 'plant', 'flower'],
};

let loaded: LoadedSets | null = null;

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1);

/** Phosphor ships 5 weights per glyph; healthicons ships size/negative variants. Keep the
 *  useful two per family so search results aren't 5 duplicates of the same idea. */
function keepVariant(set: string, name: string): boolean {
  if (set === 'ph') return !/-(bold|duotone|light|thin)$/.test(name);
  if (set === 'healthicons') return !/-24px$/.test(name) && !/-negative$/.test(name);
  return true;
}

function load(): LoadedSets {
  if (loaded) return loaded;
  const entries: AssetEntry[] = [];
  const iconify: Record<string, IconifyJson> = {};
  const brands = new Map<string, { title: string; hex: string; path: string }>();

  for (const set of ['lucide', 'tabler', 'ph', 'healthicons']) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const json: IconifyJson = require(`@iconify-json/${set}/icons.json`);
    iconify[set] = json;
    const aliasesByParent = new Map<string, string[]>();
    for (const [alias, def] of Object.entries(json.aliases ?? {})) {
      const list = aliasesByParent.get(def.parent) ?? [];
      list.push(alias);
      aliasesByParent.set(def.parent, list);
    }
    for (const name of Object.keys(json.icons)) {
      if (!keepVariant(set, name)) continue;
      const terms = [...tokenize(name)];
      for (const a of aliasesByParent.get(name) ?? []) terms.push(...tokenize(a));
      entries.push({ id: `${set}:${name}`, set, name, kind: 'icon', terms: [...new Set(terms)] });
    }
  }

  // simple-icons: exports are siPascalCase objects { title, slug, hex, path }.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const si = require('simple-icons') as Record<string, { title: string; slug: string; hex: string; path: string }>;
  for (const v of Object.values(si)) {
    if (!v || typeof v !== 'object' || !v.slug || !v.path) continue;
    brands.set(v.slug, { title: v.title, hex: v.hex, path: v.path });
    entries.push({
      id: `brand:${v.slug}`,
      set: 'simple-icons',
      name: v.title,
      kind: 'logo',
      terms: [...new Set([...tokenize(v.title), v.slug])],
      brandHex: `#${v.hex}`,
    });
  }

  const byId = new Map(entries.map((e) => [e.id, e]));
  loaded = { entries, byId, iconify, brands };
  return loaded;
}

export interface SearchHit {
  id: string;
  set: string;
  name: string;
  kind: AssetKind;
  score: number;
  brandHex?: string;
}

// Filler words that describe the ASSET, not the concept — dropped from ranking, but
// "logo"/"brand" bias results toward real brand marks when no kind was forced.
const FILLERS = new Set(['logo', 'icon', 'icons', 'symbol', 'brand', 'mark', 'svg', 'image']);

/** Deterministic search: token overlap with synonym expansion; exact-name match wins. */
export function searchAssets(query: string, opts: { kind?: AssetKind | 'any'; limit?: number } = {}): SearchHit[] {
  const lib = load();
  const limit = Math.max(1, Math.min(40, opts.limit ?? 12));
  const allTokens = tokenize(query);
  const wantsLogo = allTokens.some((t) => t === 'logo' || t === 'brand');
  const qTokens = allTokens.filter((t) => !FILLERS.has(t));
  if (!qTokens.length) return [];
  const expanded = new Set<string>(qTokens);
  for (const t of qTokens) for (const s of SYNONYMS[t] ?? []) for (const st of tokenize(s)) expanded.add(st);
  const exact = qTokens.join('-');

  const hits: SearchHit[] = [];
  for (const e of lib.entries) {
    if (opts.kind && opts.kind !== 'any' && e.kind !== opts.kind) continue;
    let score = 0;
    for (const term of e.terms) {
      if (expanded.has(term)) score += qTokens.includes(term) ? 3 : 1.5; // direct tokens beat synonyms
      else if (term.length > 3 && [...expanded].some((q) => q.length > 3 && (term.startsWith(q) || q.startsWith(term)))) score += 0.5;
    }
    if (!score) continue;
    if (e.name.toLowerCase() === exact || e.name.toLowerCase() === query.trim().toLowerCase()) score += 6;
    if (wantsLogo && e.kind === 'logo') score += 4; // "stripe logo" → the real brand mark first
    // shorter names that fully matched are more "on point" than sprawling compound names
    score += Math.max(0, 2 - e.terms.length * 0.15);
    hits.push({ id: e.id, set: e.set, name: e.name, kind: e.kind, score, brandHex: e.brandHex });
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return hits.slice(0, limit);
}

/** Raw pieces needed to materialize an asset (kept internal to the assets module). */
export function assetSource(id: string):
  | { kind: 'icon'; body: string; width: number; height: number; set: string; name: string }
  | { kind: 'logo'; path: string; hex: string; title: string; slug: string }
  | null {
  const lib = load();
  const e = lib.byId.get(id);
  if (!e) return null;
  if (e.kind === 'logo') {
    const b = lib.brands.get(id.slice('brand:'.length));
    return b ? { kind: 'logo', path: b.path, hex: `#${b.hex}`, title: b.title, slug: id.slice('brand:'.length) } : null;
  }
  const json = lib.iconify[e.set];
  const icon = json?.icons[e.name];
  if (!icon) return null;
  return {
    kind: 'icon',
    body: icon.body,
    width: icon.width ?? json.width ?? 24,
    height: icon.height ?? json.height ?? 24,
    set: e.set,
    name: e.name,
  };
}

/** Library size + license summary (for the tool description / attributions). */
export function libraryStats(): { total: number; icons: number; logos: number } {
  const lib = load();
  const logos = lib.entries.filter((e) => e.kind === 'logo').length;
  return { total: lib.entries.length, icons: lib.entries.length - logos, logos };
}

export const ATTRIBUTIONS_MD = `# Vendored asset library — licenses & attribution

All assets are self-hosted (no network, no keys) and open-licensed:

- **Lucide** icons — ISC License. © Lucide Contributors — https://lucide.dev
- **Tabler Icons** — MIT License. © Paweł Kuna — https://tabler.io/icons
- **Phosphor Icons** — MIT License. © Phosphor Icons — https://phosphoricons.com
- **Health Icons** — MIT (code) / CC0 (art). https://healthicons.org
- **Simple Icons** — CC0 1.0. https://simpleicons.org — brand marks remain trademarks of
  their respective owners; use them to REFER to the brand, never to imply endorsement.

Icon sets are consumed via the Iconify JSON packages (@iconify-json/*).
`;
