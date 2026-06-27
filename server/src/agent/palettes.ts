// AUTO-curated palette swatch book — every accent is WCAG-AA for its --accent-ink (validated at
// generation). 'vivid' = confident real colour (the DEFAULT for most consumer/creative/food/eco/bold
// work); 'muted' = quiet desaturated (corporate/technical/luxury). Pick a FITTING palette; never fall
// back to a generic grey. Apply tokens directly (--accent/-2/-deep/-tint/-ink) or, with the bundled UI
// kit, via <html data-theme="<name>">.
export interface Palette { name: string; accent: string; accent2: string; accentDeep: string; accentTint: string; accentInk: string; mood: string; tier: 'vivid' | 'muted'; }

export const PALETTES: Palette[] = [
  {
    "name": "emerald",
    "accent": "#0e7a52",
    "accent2": "#358f6e",
    "accentDeep": "#0b6242",
    "accentTint": "#e7f2ee",
    "accentInk": "#ffffff",
    "mood": "fresh green — eco, growth, wellness",
    "tier": "vivid"
  },
  {
    "name": "forest",
    "accent": "#1b5e40",
    "accent2": "#3f785f",
    "accentDeep": "#164b33",
    "accentTint": "#e8efec",
    "accentInk": "#ffffff",
    "mood": "deep premium green — natural, sustainable",
    "tier": "vivid"
  },
  {
    "name": "pine",
    "accent": "#176153",
    "accent2": "#3c7a6f",
    "accentDeep": "#124e42",
    "accentTint": "#e8efee",
    "accentInk": "#ffffff",
    "mood": "deep teal-green — calm, premium",
    "tier": "vivid"
  },
  {
    "name": "turquoise",
    "accent": "#0a6e72",
    "accent2": "#318589",
    "accentDeep": "#08585b",
    "accentTint": "#e7f1f1",
    "accentInk": "#ffffff",
    "mood": "clear teal — wellness, fresh, spa",
    "tier": "vivid"
  },
  {
    "name": "cobalt",
    "accent": "#2456c8",
    "accent2": "#4771d1",
    "accentDeep": "#1d45a0",
    "accentTint": "#e9eefa",
    "accentInk": "#ffffff",
    "mood": "confident blue — tech, SaaS, trust",
    "tier": "vivid"
  },
  {
    "name": "azure",
    "accent": "#1f6fd6",
    "accent2": "#4386dd",
    "accentDeep": "#1959ab",
    "accentTint": "#e9f1fb",
    "accentInk": "#ffffff",
    "mood": "bright friendly blue — product, fintech",
    "tier": "vivid"
  },
  {
    "name": "marine",
    "accent": "#0b6fae",
    "accent2": "#3286bb",
    "accentDeep": "#09598b",
    "accentTint": "#e7f1f7",
    "accentInk": "#ffffff",
    "mood": "clear ocean blue — travel, clean, B2B",
    "tier": "vivid"
  },
  {
    "name": "electric",
    "accent": "#4f46e5",
    "accent2": "#6b64e9",
    "accentDeep": "#3f38b7",
    "accentTint": "#ededfc",
    "accentInk": "#ffffff",
    "mood": "vivid indigo — modern software, AI",
    "tier": "vivid"
  },
  {
    "name": "royal",
    "accent": "#3b3fb6",
    "accent2": "#5a5ec2",
    "accentDeep": "#2f3292",
    "accentTint": "#ebecf8",
    "accentInk": "#ffffff",
    "mood": "deep blue-violet — premium, trust",
    "tier": "vivid"
  },
  {
    "name": "grape",
    "accent": "#7c3aed",
    "accent2": "#915af0",
    "accentDeep": "#632ebe",
    "accentTint": "#f2ebfd",
    "accentInk": "#ffffff",
    "mood": "rich purple — creative, bold",
    "tier": "vivid"
  },
  {
    "name": "mulberry",
    "accent": "#7b2d6b",
    "accent2": "#904f83",
    "accentDeep": "#622456",
    "accentTint": "#f2eaf0",
    "accentInk": "#ffffff",
    "mood": "rich plum — boutique, beauty, premium",
    "tier": "vivid"
  },
  {
    "name": "berry",
    "accent": "#b4185d",
    "accent2": "#c03d77",
    "accentDeep": "#90134a",
    "accentTint": "#f8e8ef",
    "accentInk": "#ffffff",
    "mood": "deep magenta — fashion, bold",
    "tier": "vivid"
  },
  {
    "name": "rose",
    "accent": "#d11a6b",
    "accent2": "#d83f83",
    "accentDeep": "#a71556",
    "accentTint": "#fae8f0",
    "accentInk": "#ffffff",
    "mood": "vivid rose — lifestyle, beauty",
    "tier": "vivid"
  },
  {
    "name": "crimson",
    "accent": "#c5312b",
    "accent2": "#ce524d",
    "accentDeep": "#9e2722",
    "accentTint": "#f9eaea",
    "accentInk": "#ffffff",
    "mood": "confident red — food, energy, sport",
    "tier": "vivid"
  },
  {
    "name": "tangerine",
    "accent": "#e0560f",
    "accent2": "#e57135",
    "accentDeep": "#b3450c",
    "accentTint": "#fceee7",
    "accentInk": "#15161a",
    "mood": "warm orange — energetic, friendly",
    "tier": "vivid"
  },
  {
    "name": "amber",
    "accent": "#c2740a",
    "accent2": "#cc8a31",
    "accentDeep": "#9b5d08",
    "accentTint": "#f9f1e7",
    "accentInk": "#15161a",
    "mood": "golden amber — warm, premium, craft",
    "tier": "vivid"
  },
  {
    "name": "coral",
    "accent": "#e0514a",
    "accent2": "#e56d67",
    "accentDeep": "#b3413b",
    "accentTint": "#fceeed",
    "accentInk": "#15161a",
    "mood": "warm coral — lifestyle, hospitality",
    "tier": "vivid"
  },
  {
    "name": "midnight",
    "accent": "#1e293b",
    "accent2": "#424b5a",
    "accentDeep": "#18212f",
    "accentTint": "#e9eaeb",
    "accentInk": "#ffffff",
    "mood": "deep slate-navy — luxe, dark-first",
    "tier": "vivid"
  },
  {
    "name": "slate",
    "accent": "#44566a",
    "accent2": "#627182",
    "accentDeep": "#364555",
    "accentTint": "#eceef0",
    "accentInk": "#ffffff",
    "mood": "muted blue-grey — modern SaaS, product",
    "tier": "muted"
  },
  {
    "name": "ink",
    "accent": "#2b2e34",
    "accent2": "#4d4f54",
    "accentDeep": "#22252a",
    "accentTint": "#eaeaeb",
    "accentInk": "#ffffff",
    "mood": "near-black graphite — minimal, technical, luxury",
    "tier": "muted"
  },
  {
    "name": "indigo",
    "accent": "#4c5580",
    "accent2": "#697094",
    "accentDeep": "#3d4466",
    "accentTint": "#edeef2",
    "accentInk": "#ffffff",
    "mood": "muted indigo — calm software",
    "tier": "muted"
  },
  {
    "name": "ocean",
    "accent": "#395c78",
    "accent2": "#59768e",
    "accentDeep": "#2e4a60",
    "accentTint": "#ebeff2",
    "accentInk": "#ffffff",
    "mood": "muted denim blue — enterprise, finance",
    "tier": "muted"
  },
  {
    "name": "sage",
    "accent": "#4f6551",
    "accent2": "#6b7e6d",
    "accentDeep": "#3f5141",
    "accentTint": "#edf0ee",
    "accentInk": "#ffffff",
    "mood": "muted green — health, sustainability",
    "tier": "muted"
  },
  {
    "name": "teal",
    "accent": "#3a6568",
    "accent2": "#5a7e80",
    "accentDeep": "#2e5153",
    "accentTint": "#ebf0f0",
    "accentInk": "#ffffff",
    "mood": "muted teal — wellness, education",
    "tier": "muted"
  },
  {
    "name": "clay",
    "accent": "#97604a",
    "accent2": "#a87967",
    "accentDeep": "#794d3b",
    "accentTint": "#f5efed",
    "accentInk": "#ffffff",
    "mood": "muted terracotta — warm hospitality, craft",
    "tier": "muted"
  },
  {
    "name": "stone",
    "accent": "#6b6052",
    "accent2": "#83796e",
    "accentDeep": "#564d42",
    "accentTint": "#f0efee",
    "accentInk": "#ffffff",
    "mood": "warm taupe — editorial, neutral",
    "tier": "muted"
  },
  {
    "name": "plum",
    "accent": "#5f5170",
    "accent2": "#796d87",
    "accentDeep": "#4c415a",
    "accentTint": "#efeef1",
    "accentInk": "#ffffff",
    "mood": "muted mauve — creative, studio",
    "tier": "muted"
  },
  {
    "name": "olive",
    "accent": "#5f5e38",
    "accent2": "#797858",
    "accentDeep": "#4c4b2d",
    "accentTint": "#efefeb",
    "accentInk": "#ffffff",
    "mood": "muted olive — natural, organic",
    "tier": "muted"
  }
];

/** A compact menu for the design prompt: name · hex · use-case, grouped by tier. */
export function paletteMenu(): string {
  const line = (p: Palette) => `  ${p.name} ${p.accent} (ink ${p.accentInk}) — ${p.mood}`;
  const vivid = PALETTES.filter((p) => p.tier === 'vivid').map(line).join('\n');
  const muted = PALETTES.filter((p) => p.tier === 'muted').map(line).join('\n');
  return `CONFIDENT (real character — default for most work):\n${vivid}\n\nMUTED (quiet/corporate/technical only):\n${muted}`;
}
