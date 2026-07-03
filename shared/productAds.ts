/**
 * Product-ad catalog — the researched per-category ad templates + staging backdrops behind
 * product videos (generate_video product mode + the Video studio's Product flow).
 * PURE DATA shared by server (productShot.ts brief compiler + first-frame compositor) and
 * client (VideoStudio category/template/backdrop pickers) so the two can never drift.
 */

export interface AdBeat {
  motion: string; // the single camera/action move for this beat
  view: string; // what we see
}
export interface AdTemplate {
  key: string;
  label: string;
  desc: string; // shown to the user as the card subtitle
  beats: AdBeat[];
  light: string;
  audio: string;
  negatives?: string;
}
export interface ProductCategory {
  id: string;
  label: string;
  templates: AdTemplate[];
}

export const HERO: AdBeat = { motion: 'slow steady orbit around the product', view: 'the product hero, centered, tack-sharp' };

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  {
    id: 'skincare',
    label: 'Skincare & beauty',
    templates: [
      {
        key: 'texture-ritual',
        label: 'Texture & application',
        desc: 'Hero → texture macro → glowing skin',
        beats: [
          HERO,
          { motion: 'push in to an extreme macro', view: 'the cream/serum texture swirling, rich and glossy' },
          { motion: 'soft cut to a gentle application', view: "fingertips smoothing the product onto glowing, healthy skin (a woman's cheek or hand), serene expression" },
        ],
        light: 'soft diffused daylight with a warm key — dewy, clean beauty lighting',
        audio: 'calm spa-like ambience, soft fabric and skin-touch foley',
        negatives: 'no warped faces or hands, no bent fingers, no harsh shadows, no text',
      },
      {
        key: 'ingredient-story',
        label: 'Ingredient story',
        desc: 'Botanicals & droplets orbit the bottle',
        beats: [
          { motion: 'slow rise from low angle', view: 'the product standing amid soft botanical elements' },
          { motion: 'orbit while ingredients drift', view: 'leaves, petals and water droplets floating gently around the bottle, catching light' },
          { motion: 'settle to a static hero', view: 'the product crisp in front, ingredients softly blurred behind' },
        ],
        light: 'bright airy daylight, gentle backlight through the botanicals',
        audio: 'light nature ambience, a single soft chime at the end',
        negatives: 'no fake-looking plastic plants, no text, no logos invented on the label',
      },
    ],
  },
  {
    id: 'food',
    label: 'Food & beverage',
    templates: [
      {
        key: 'sizzle-pour',
        label: 'Sizzle & pour',
        desc: 'Steam, pour, appetite appeal',
        beats: [
          { motion: 'push in on the product', view: 'the dish/drink steaming or chilled with condensation, irresistibly fresh' },
          { motion: 'slow-motion action shot', view: 'a pour / a sprinkle / a sauce drizzle hitting the product, droplets suspended' },
          { motion: 'pull out to the hero', view: 'the finished product perfectly plated, garnish settling' },
        ],
        light: 'warm directional key with a soft rim — golden, appetizing food light',
        audio: 'sizzle/pour foley, warm kitchen ambience',
        negatives: 'no unappetizing colours, no melted or deformed food, no text',
      },
      {
        key: 'fresh-ingredients',
        label: 'Ingredient explosion',
        desc: 'Ingredients fly in and assemble',
        beats: [
          { motion: 'ingredients drift in from all sides in slow motion', view: 'fresh ingredients converging toward the center' },
          { motion: 'whip to the assembled product', view: 'the product formed, a burst of crumbs/droplets settling' },
          HERO,
        ],
        light: 'bright high-key studio light, crisp and fresh',
        audio: 'playful whooshes, a satisfying final thump',
      },
    ],
  },
  {
    id: 'fashion',
    label: 'Fashion & apparel',
    templates: [
      {
        key: 'fabric-flow',
        label: 'Fabric in motion',
        desc: 'Cloth billows, details close up',
        beats: [
          { motion: 'slow motion as fabric billows', view: 'the garment flowing in a gentle wind, fabric texture alive' },
          { motion: 'macro tracking shot', view: 'stitching, weave and hardware details gliding past' },
          HERO,
        ],
        light: 'soft editorial window light with deep gentle shadows',
        audio: 'soft fabric movement, minimal airy score',
        negatives: 'no mannequin-looking figures, no warped limbs, no text',
      },
      {
        key: 'on-model',
        label: 'On-model turn',
        desc: 'Worn, walking, turning',
        beats: [
          { motion: 'tracking shot', view: 'a model wearing the product walking toward camera, confident' },
          { motion: 'slow 180° turn', view: 'the model turns, the product\'s silhouette and fit clear' },
          { motion: 'push in', view: 'a detail of the product being worn' },
        ],
        light: 'clean studio cyc wall, fashion-editorial lighting',
        audio: 'minimal fashion-film score, footsteps',
        negatives: 'no warped faces or hands, no extra limbs, no text',
      },
    ],
  },
  {
    id: 'jewellery',
    label: 'Jewellery & watches',
    templates: [
      {
        key: 'macro-sparkle',
        label: 'Macro sparkle',
        desc: 'Light dances across facets',
        beats: [
          { motion: 'extreme macro rack focus', view: 'light refracting through stones / across the dial, every facet crisp' },
          { motion: 'slow orbit', view: 'the piece rotating on dark velvet, highlights sweeping' },
          { motion: 'settle and glint', view: 'the hero angle, one final light glint travelling across it' },
        ],
        light: 'single hard key with pinpoint speculars on black — luxury jewellery lighting',
        audio: 'hushed ambience, one crystalline shimmer note',
        negatives: 'no fingerprints, no dust, no invented engravings or text',
      },
    ],
  },
  {
    id: 'electronics',
    label: 'Electronics & gadgets',
    templates: [
      {
        key: 'feature-orbit',
        label: 'Feature orbit',
        desc: 'Ports, textures, precision',
        beats: [
          { motion: 'slow precise orbit', view: 'the device floating, edges and materials catching cool light' },
          { motion: 'macro glide', view: 'ports, buttons, texture details tracked closely' },
          { motion: 'pull back and land', view: 'the device settling into the hero pose, screen a soft abstract glow' },
        ],
        light: 'cool studio gradient with crisp rim light — precision tech lighting',
        audio: 'minimal electronic pulse, subtle mechanical clicks',
        negatives: 'no readable screen text or UI (screens stay an abstract glow), no fingerprints, no cables',
      },
      {
        key: 'exploded-view',
        label: 'Exploded assembly',
        desc: 'Parts float apart and reassemble',
        beats: [
          { motion: 'components drift apart in slow motion', view: 'the product separating into floating layers' },
          { motion: 'orbit the exploded arrangement', view: 'inner precision suggested by clean abstract parts' },
          { motion: 'snap reassembly', view: 'everything glides back into the complete product, hero pose' },
        ],
        light: 'dark studio, cool blue accents, strong rim',
        audio: 'soft mechanical whirs, a satisfying final click',
        negatives: 'no fictional circuitry text, no brand logos invented',
      },
    ],
  },
  {
    id: 'fragrance',
    label: 'Fragrance',
    templates: [
      {
        key: 'mist-bloom',
        label: 'Mist & bloom',
        desc: 'A spritz blooms into atmosphere',
        beats: [
          HERO,
          { motion: 'slow-motion spritz', view: 'a fine mist blooming from the bottle, droplets glittering in the light' },
          { motion: 'petals or silk drift through', view: 'soft elements floating past the bottle, dreamlike' },
        ],
        light: 'golden-hour warmth with strong backlight through the mist',
        audio: 'airy cinematic swell, a soft exhale',
        negatives: 'no text, no invented label typography',
      },
    ],
  },
  {
    id: 'furniture',
    label: 'Furniture & home',
    templates: [
      {
        key: 'room-reveal',
        label: 'Room reveal',
        desc: 'The piece anchors a beautiful room',
        beats: [
          { motion: 'slow dolly through a doorway', view: 'a beautifully styled room revealing the product as its centerpiece' },
          { motion: 'orbit the product', view: 'materials and craftsmanship in warm detail' },
          { motion: 'push in to a texture macro', view: 'wood grain / fabric weave / finish up close' },
        ],
        light: 'warm afternoon window light, cosy interior ambience',
        audio: 'quiet home ambience, soft warm score',
      },
    ],
  },
  {
    id: 'fitness',
    label: 'Sports & fitness',
    templates: [
      {
        key: 'in-action',
        label: 'In action',
        desc: 'Energy, sweat, performance',
        beats: [
          { motion: 'whip pan onto the product', view: 'the product in dynamic use — gripped, worn, in motion' },
          { motion: 'slow-motion peak action', view: 'the intense moment: impact, stride, lift — product center-frame' },
          HERO,
        ],
        light: 'dramatic gym key light with atmospheric haze',
        audio: 'driving percussion, breath and impact foley',
        negatives: 'no warped limbs or faces, no text',
      },
    ],
  },
  {
    id: 'automotive',
    label: 'Automotive',
    templates: [
      {
        key: 'reveal-drive',
        label: 'Reveal & drive',
        desc: 'Light sweep, then the road',
        beats: [
          { motion: 'light sweep across the body', view: 'reflections travelling over the paint in a dark studio' },
          { motion: 'aerial tracking shot', view: 'the vehicle driving a sweeping coastal or desert road' },
          { motion: 'push in to the hero', view: 'front three-quarter stance, wheels settling' },
        ],
        light: 'dark studio sweep → golden-hour exterior',
        audio: 'engine note, cinematic rise',
        negatives: 'no warped wheels or badges, no readable plates, no text',
      },
    ],
  },
  {
    id: 'fmcg',
    label: 'Packaged goods',
    templates: [
      {
        key: 'shelf-hero',
        label: 'Pack hero',
        desc: 'The pack, crisp and confident',
        beats: [
          HERO,
          { motion: 'burst of the contents', view: 'the product\'s contents artfully suspended around the pack (crumbs, drops, powder — whatever fits)' },
          { motion: 'settle to a static end frame', view: 'the pack front-on, contents settled, poster-clean' },
        ],
        light: 'bright even studio light, colour-true',
        audio: 'crisp product foley, upbeat sting',
        negatives: 'no invented label text, keep the real pack exactly as photographed',
      },
    ],
  },
];

export const findCategory = (id: string) => PRODUCT_CATEGORIES.find((c) => c.id === id) || null;
export const findTemplate = (catId: string, key: string) =>
  findCategory(catId)?.templates.find((t) => t.key === key) || null;

/** CSS scenes for the staged first frame — one per studio backdrop id. The server composites
 *  the isolated product onto these in Chromium; the client uses the same CSS as tile previews. */
export const BACKDROP_CSS: Record<string, string> = {
  'studio-white': 'background: radial-gradient(ellipse at 50% 35%, #ffffff 0%, #f2f2f0 55%, #e2e1dd 100%);',
  'studio-grey': 'background: radial-gradient(ellipse at 50% 35%, #d9d9db 0%, #b9babd 55%, #96979b 100%);',
  'dark-luxury': 'background: radial-gradient(ellipse at 50% 30%, #2a2a2e 0%, #131316 60%, #060607 100%);',
  'colour-pop': 'background: radial-gradient(ellipse at 50% 35%, #ff7a59 0%, #e84f2f 65%, #c93a1d 100%);',
  gradient: 'background: linear-gradient(160deg, #7f9cf5 0%, #c48cf1 50%, #f5a3c7 100%);',
  marble: 'background: linear-gradient(115deg, #f4f2ee 0%, #e6e2da 30%, #f5f3ef 52%, #ddd8ce 74%, #f1efe9 100%);',
  'silk-fabric': 'background: linear-gradient(135deg, #d9c6b8 0%, #c2a894 40%, #e4d5c8 70%, #b99f8a 100%);',
  'water-splash': 'background: radial-gradient(ellipse at 50% 30%, #bfe3f2 0%, #7fbcd9 55%, #4f93b8 100%);',
  'ice-frost': 'background: radial-gradient(ellipse at 50% 30%, #eef7fb 0%, #cfe6f0 55%, #a9cddd 100%);',
  'smoke-mist': 'background: radial-gradient(ellipse at 50% 40%, #9aa0a8 0%, #6d737c 55%, #474c54 100%);',
  'stone-slate': 'background: linear-gradient(150deg, #6e6e6a 0%, #55554f 50%, #3f3f3a 100%);',
  'warm-wood': 'background: linear-gradient(150deg, #a57647 0%, #8a5f38 50%, #6f4a2a 100%);',
  botanical: 'background: radial-gradient(ellipse at 50% 30%, #dfe9d8 0%, #b7ccab 55%, #8fae82 100%);',
  'desert-sand': 'background: linear-gradient(160deg, #e8d3ae 0%, #d4b98c 55%, #bd9f6f 100%);',
  floating: 'background: linear-gradient(180deg, #cfe0f2 0%, #e9f1f9 60%, #ffffff 100%);',
  industrial: 'background: linear-gradient(150deg, #7d7f83 0%, #5c5e62 50%, #3f4145 100%);',
  'neon-night': 'background: radial-gradient(ellipse at 50% 30%, #3a1f5e 0%, #1d0f38 60%, #0a0618 100%);',
  festive: 'background: radial-gradient(ellipse at 50% 30%, #7c1f2e 0%, #56101d 60%, #350811 100%);',
  lifestyle: 'background: linear-gradient(160deg, #e9ddcd 0%, #d4c3ac 55%, #b9a68c 100%);',
  tech: 'background: linear-gradient(150deg, #1c2733 0%, #10161f 55%, #070a0f 100%);',
};

/** Human labels for the backdrop tiles, in display order (every id must exist in BACKDROP_CSS). */
export const BACKDROP_LABELS: { id: string; label: string }[] = [
  { id: 'studio-white', label: 'Studio white' },
  { id: 'studio-grey', label: 'Studio grey' },
  { id: 'dark-luxury', label: 'Dark luxury' },
  { id: 'colour-pop', label: 'Colour pop' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'marble', label: 'Marble' },
  { id: 'silk-fabric', label: 'Silk & fabric' },
  { id: 'water-splash', label: 'Water splash' },
  { id: 'ice-frost', label: 'Ice & frost' },
  { id: 'smoke-mist', label: 'Smoke & mist' },
  { id: 'stone-slate', label: 'Stone & slate' },
  { id: 'warm-wood', label: 'Warm wood' },
  { id: 'botanical', label: 'Botanical' },
  { id: 'desert-sand', label: 'Desert sand' },
  { id: 'floating', label: 'Floating' },
  { id: 'industrial', label: 'Industrial' },
  { id: 'neon-night', label: 'Neon night' },
  { id: 'festive', label: 'Festive' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'tech', label: 'Tech' },
];
