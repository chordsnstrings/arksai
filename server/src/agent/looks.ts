// Complete "looks" — a confident palette + type pairing + style, named, so the agent starts from
// a high design floor in ONE pick. Apply with <html data-kit="<name>"> (UI kit) or by setting the
// same --accent ramp + --font-display/--font-sans tokens. All accents are WCAG-AA.
export interface Look { name: string; accent: string; accentInk: string; display: string; body: string; mono: string | null; vibe: string; }

export const LOOKS: Look[] = [
  {
    "name": "fresh",
    "accent": "#0e7a52",
    "accentInk": "#ffffff",
    "display": "Space Grotesk",
    "body": "Inter",
    "mono": null,
    "vibe": "eco · wellness · fresh consumer"
  },
  {
    "name": "bold",
    "accent": "#c5312b",
    "accentInk": "#ffffff",
    "display": "Space Grotesk",
    "body": "Hanken Grotesk",
    "mono": null,
    "vibe": "sport · energy · bold startup"
  },
  {
    "name": "studio",
    "accent": "#7c3aed",
    "accentInk": "#ffffff",
    "display": "Fraunces",
    "body": "Inter",
    "mono": null,
    "vibe": "creative studio · agency · portfolio"
  },
  {
    "name": "warm",
    "accent": "#c2740a",
    "accentInk": "#15161a",
    "display": "Fraunces",
    "body": "Lora",
    "mono": null,
    "vibe": "food · hospitality · craft"
  },
  {
    "name": "tech",
    "accent": "#2456c8",
    "accentInk": "#ffffff",
    "display": "Sora",
    "body": "Manrope",
    "mono": "IBM Plex Mono",
    "vibe": "SaaS · fintech · product"
  },
  {
    "name": "boutique",
    "accent": "#7b2d6b",
    "accentInk": "#ffffff",
    "display": "Source Serif 4",
    "body": "Inter",
    "mono": null,
    "vibe": "beauty · fashion · boutique"
  },
  {
    "name": "trust",
    "accent": "#0b6fae",
    "accentInk": "#ffffff",
    "display": "Manrope",
    "body": "Plus Jakarta Sans",
    "mono": null,
    "vibe": "finance · B2B · professional"
  },
  {
    "name": "vibrant",
    "accent": "#e0514a",
    "accentInk": "#15161a",
    "display": "Outfit",
    "body": "DM Sans",
    "mono": null,
    "vibe": "friendly consumer · lifestyle"
  },
  {
    "name": "signal",
    "accent": "#4f46e5",
    "accentInk": "#ffffff",
    "display": "Space Grotesk",
    "body": "Hanken Grotesk",
    "mono": "IBM Plex Mono",
    "vibe": "AI · modern software · data"
  }
];

export function looksMenu(): string {
  return LOOKS.map((l) => `  ${l.name} — ${l.accent} · ${l.display}/${l.body}${l.mono ? ' · ' + l.mono : ''} — ${l.vibe}`).join('\n');
}
