/**
 * Video art-style catalog — the modular render-style menu behind every video surface
 * (Scene mode's Look picker, Product mode's stage-from-description path, and the
 * generate_video steering). PURE DATA shared by client and server so they can't drift.
 *
 * Each style is a `phrase` written the way the video model's prompt guide wants a style
 * stated. The server-side prompt compiler (videoBrief.ts) only ADDS its default premium
 * grade when no style is present — an explicit phrase from this catalog always wins.
 *
 * NOTE for product videos: when a real product PHOTO is staged as the first frame, the
 * clip literally starts on those pixels — a non-photoreal style can't restyle them, so
 * the art-style picker applies to described (photo-less) products and Scene shots.
 */

export type ArtStyleGroup = 'Photoreal' | 'Animated & illustrated' | 'Stylized worlds';

export interface ArtStyle {
  id: string;
  label: string;
  group: ArtStyleGroup;
  /** The exact style sentence injected into the brief ("Look: <phrase>."). */
  phrase: string;
}

export const ART_STYLE_GROUPS: ArtStyleGroup[] = ['Photoreal', 'Animated & illustrated', 'Stylized worlds'];

export const ART_STYLES: ArtStyle[] = [
  // ── Photoreal — real-world camera looks ─────────────────────────────────────
  { id: 'photoreal', label: 'Photorealistic', group: 'Photoreal', phrase: 'photorealistic, true-to-life colour and materials, crisp natural detail' },
  { id: 'cinematic', label: 'Cinematic', group: 'Photoreal', phrase: 'cinematic, shallow depth of field, filmic colour grade, smooth camera move' },
  { id: 'documentary', label: 'Documentary', group: 'Photoreal', phrase: 'observational documentary realism, natural light, unstaged' },
  { id: 'ugc', label: 'UGC / handheld', group: 'Photoreal', phrase: 'authentic handheld UGC look, natural light, casual energy' },
  { id: 'vintage', label: 'Vintage film', group: 'Photoreal', phrase: 'vintage 16mm film, warm faded tones, visible grain' },
  { id: 'noir', label: 'Noir B&W', group: 'Photoreal', phrase: 'high-contrast black-and-white film noir, hard shadows' },
  { id: 'dreamy', label: 'Dreamy', group: 'Photoreal', phrase: 'dreamy soft-focus, ethereal glow, gentle bloom' },
  { id: 'vibrant', label: 'Vibrant', group: 'Photoreal', phrase: 'vibrant saturated bold colour, high energy' },
  { id: 'luxury', label: 'Luxury', group: 'Photoreal', phrase: 'luxury editorial, glossy premium finish, elegant' },
  // ── Animated & illustrated — rendered/drawn worlds ──────────────────────────
  { id: 'anim-3d', label: '3D animation', group: 'Animated & illustrated', phrase: 'polished 3D animated feature-film style, soft global illumination, expressive character shading' },
  { id: 'cartoon-2d', label: '2D cartoon', group: 'Animated & illustrated', phrase: 'bold 2D cartoon animation, clean outlines, flat vivid colour, bouncy motion' },
  { id: 'anime', label: 'Anime', group: 'Animated & illustrated', phrase: 'stylised anime animation, expressive line work, dramatic light and colour' },
  { id: 'claymation', label: 'Claymation', group: 'Animated & illustrated', phrase: 'stop-motion claymation, visible clay texture and thumbprints, handmade charm, slightly stepped motion' },
  { id: 'papercraft', label: 'Papercraft', group: 'Animated & illustrated', phrase: 'layered paper-cutout animation, crafted card textures, soft drop shadows between layers' },
  { id: 'watercolor', label: 'Watercolour', group: 'Animated & illustrated', phrase: 'hand-painted watercolour animation, soft bleeding edges, paper texture showing through' },
  { id: 'comic', label: 'Comic book', group: 'Animated & illustrated', phrase: 'graphic-novel comic style, inked outlines, halftone shading, punchy panels-in-motion feel' },
  { id: 'pixel', label: 'Pixel art', group: 'Animated & illustrated', phrase: 'retro pixel-art animation, chunky pixels, limited palette, charming 16-bit game feel' },
  { id: 'lowpoly', label: 'Low-poly 3D', group: 'Animated & illustrated', phrase: 'minimal low-poly 3D world, faceted geometry, soft pastel lighting' },
  { id: 'sketch', label: 'Line sketch', group: 'Animated & illustrated', phrase: 'hand-drawn ink sketch animation, loose expressive lines, minimal wash of colour' },
  // ── Stylized worlds — strong scene-wide aesthetics ──────────────────────────
  { id: 'cyberpunk', label: 'Cyberpunk', group: 'Stylized worlds', phrase: 'cyberpunk neon-noir world, rain-slick surfaces, holographic glow, teal-magenta palette' },
  { id: 'synthwave', label: 'Synthwave', group: 'Stylized worlds', phrase: 'retro synthwave aesthetic, neon grid horizon, chrome and sunset gradients, 80s glow' },
  { id: 'fantasy', label: 'Fantasy epic', group: 'Stylized worlds', phrase: 'epic fantasy world, painterly golden light, mist and grandeur, cinematic scale' },
  { id: 'toyworld', label: 'Toy world', group: 'Stylized worlds', phrase: 'a miniature plastic toy diorama world, glossy toy materials, playful staged scenes' },
  { id: 'surreal', label: 'Surreal dream', group: 'Stylized worlds', phrase: 'surreal dreamscape, impossible physics, floating elements, soft otherworldly light' },
];

export const findArtStyle = (id: string) => ART_STYLES.find((s) => s.id === id) || null;
export const artStylesByGroup = (group: ArtStyleGroup) => ART_STYLES.filter((s) => s.group === group);
