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
      {
        key: 'splash-fresh',
        label: 'Freshness splash',
        desc: 'A water crown erupts around it',
        beats: [
          { motion: 'push in on the product', view: 'the product standing on a wet reflective surface, droplets beading on it' },
          { motion: 'slow-motion splash', view: 'a crown of clear water erupting around the product, droplets suspended mid-air' },
          { motion: 'settle to the hero', view: 'the water calming to ripples, the product crisp and glistening' },
        ],
        light: 'cool crisp daylight with strong speculars on the water',
        audio: 'water splash foley in slow motion, fresh airy tone',
        negatives: 'no murky water, no text, the label stays dry-legible and exactly as photographed',
      },
      {
        key: 'luxe-noir',
        label: 'Dark luxury',
        desc: 'Gold light sweeps a black set',
        beats: [
          { motion: 'a blade of warm light sweeps across', view: 'the product emerging from darkness on a black reflective surface' },
          { motion: 'slow orbit', view: 'golden highlights tracing the bottle\'s silhouette, deep shadows around it' },
          { motion: 'push in and hold', view: 'the hero angle, one soft glint travelling across the glass' },
        ],
        light: 'single warm key on black — high-end perfume-counter lighting',
        audio: 'hushed luxurious score, one deep resonant note at the end',
        negatives: 'no crushed blacks hiding the product, no text, no invented label typography',
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
      {
        key: 'macro-crave',
        label: 'Macro crave',
        desc: 'The irresistible close-up',
        beats: [
          { motion: 'extreme macro rack focus', view: 'the most appetizing detail — a glistening surface, a fizzing bubble line, a delicate crumb structure' },
          { motion: 'slow-motion crave moment', view: 'the money shot: a cheese pull / a fizz overflow / a soft break-apart, texture filling the frame' },
          { motion: 'pull out to the hero', view: 'the whole product, styled and perfect, steam or chill still visible' },
        ],
        light: 'warm low-angle key that makes textures glisten',
        audio: 'intimate close food foley — fizz, crunch, pour',
        negatives: 'no unappetizing colours, no deformed or melted-wrong food, no text',
      },
      {
        key: 'table-social',
        label: 'Table moment',
        desc: 'Shared around a beautiful table',
        beats: [
          { motion: 'overhead crane down', view: 'a warmly styled table with the product at its center, dishes and hands arranged around it' },
          { motion: 'tracking shot at table level', view: 'hands reaching, serving, passing — the product the heart of the moment' },
          { motion: 'push in to the hero', view: 'the product crisp in front, the convivial scene softly blurred behind' },
        ],
        light: 'golden-hour window light, warm and social',
        audio: 'gentle chatter ambience, cutlery, a warm score',
        negatives: 'no warped hands or faces, no text, the pack/label stays exactly as photographed',
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
      {
        key: 'street-story',
        label: 'Street story',
        desc: 'Golden-hour city, worn candid',
        beats: [
          { motion: 'handheld tracking shot', view: 'the product worn on a city street at golden hour, confident candid energy' },
          { motion: 'slow-motion crossing moment', view: 'hair and fabric moving, the product catching warm light against the urban backdrop' },
          { motion: 'push in', view: 'a tight detail of the product being worn, city bokeh behind' },
        ],
        light: 'golden-hour sun with long soft shadows, urban warmth',
        audio: 'city ambience under a confident beat',
        negatives: 'no warped faces or limbs, no readable signage or text, no logos invented',
      },
      {
        key: 'flat-lay',
        label: 'Flat-lay build',
        desc: 'The outfit assembles around it',
        beats: [
          { motion: 'overhead locked shot, pieces slide in', view: 'complementary garments and accessories arranging themselves around the product, stop-motion feel' },
          { motion: 'the layout breathes', view: 'the completed flat-lay perfectly composed, the product the clear centerpiece' },
          { motion: 'push in from above', view: 'the product filling the frame, fabric texture crisp' },
        ],
        light: 'soft even overhead daylight, editorial flat-lay lighting',
        audio: 'playful fabric swishes and soft taps in rhythm',
        negatives: 'no text, no invented brand marks on the garments',
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
      {
        key: 'worn-elegance',
        label: 'Worn elegance',
        desc: 'On the wrist, the neckline, alive',
        beats: [
          { motion: 'slow push in', view: 'the piece worn — a wrist turning, a neckline in soft morning light, skin and metal in harmony' },
          { motion: 'macro glide along the piece', view: 'stones and links catching light as the wearer moves gently' },
          { motion: 'settle to a still', view: 'an elegant final pose, the piece the unmistakable focus' },
        ],
        light: 'soft directional morning light, warm skin tones, gentle speculars',
        audio: 'intimate quiet score, a faint fabric rustle',
        negatives: 'no warped hands or fingers, no extra knuckles, no text',
      },
      {
        key: 'gift-moment',
        label: 'Gift reveal',
        desc: 'The box opens, light blooms',
        beats: [
          { motion: 'push in on a closed velvet box', view: 'the box on a candlelit table, anticipation' },
          { motion: 'the lid opens in slow motion', view: 'light blooming onto the piece inside, sparkles waking up' },
          { motion: 'push past the box to the hero', view: 'the piece lifted to center frame, glinting, box softly blurred' },
        ],
        light: 'warm candlelight glow with one crisp key on the piece',
        audio: 'soft hinge, a warm swell, one chime as the light hits',
        negatives: 'no invented engravings, no text, no warped hands if hands appear',
      },
      {
        key: 'black-water',
        label: 'Dark reflection',
        desc: 'Over black rippling water',
        beats: [
          { motion: 'slow descent from above', view: 'the piece suspended over a black mirror of water, perfect reflection below' },
          { motion: 'a single drop falls', view: 'ripples spreading in slow motion, the reflection shimmering, sparkles dancing' },
          { motion: 'orbit and settle', view: 'the piece crisp against the deep black, one final travelling glint' },
        ],
        light: 'dramatic single key on black, speculars like stars',
        audio: 'a deep quiet tone, one water drop, crystalline shimmer',
        negatives: 'no murky water, no dust, no text',
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
      {
        key: 'desk-life',
        label: 'A day with it',
        desc: 'On a beautiful desk, in real hands',
        beats: [
          { motion: 'slow dolly across a styled desk', view: 'a beautiful minimal workspace revealing the product in its natural place' },
          { motion: 'push in as hands interact', view: 'hands picking it up / using it naturally, the interaction effortless' },
          { motion: 'settle to the hero', view: 'the product front and center on the desk, warm and inviting' },
        ],
        light: 'soft window daylight with a warm desk lamp accent',
        audio: 'quiet workspace ambience, gentle interaction foley',
        negatives: 'no warped hands, no readable screen text or UI (screens stay an abstract glow), no text',
      },
      {
        key: 'neon-drop',
        label: 'Product drop',
        desc: 'Neon-lit hype energy',
        beats: [
          { motion: 'fast push in with a light flare', view: 'the product spot-lit in a dark neon-washed space, hype-drop energy' },
          { motion: 'quick orbit with sweeping neon reflections', view: 'colour washes travelling across the product\'s surfaces' },
          { motion: 'hard stop on the hero', view: 'the product locked center-frame, a final flare kissing its edge' },
        ],
        light: 'dark set with saturated neon accent lights, strong reflections',
        audio: 'bass-driven electronic beat, a riser into the final hit',
        negatives: 'no readable screen text or UI, no invented logos, no lens-flare overload hiding the product',
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
      {
        key: 'noir-desire',
        label: 'Noir desire',
        desc: 'Shadow play, amber light, allure',
        beats: [
          { motion: 'slow push through darkness', view: 'the bottle half-lit by a slit of warm amber light, deep shadows, seductive mood' },
          { motion: 'shadows drift across', view: 'silhouette patterns (blinds, silk, a passing figure) moving over the glass' },
          { motion: 'the light finds it fully', view: 'the bottle revealed crisp and glowing, one highlight tracing its edge' },
        ],
        light: 'low-key amber and shadow, film-noir sensuality',
        audio: 'sultry slow score, a distant heartbeat',
        negatives: 'no crushed blacks hiding the bottle, no text, no invented label typography',
      },
      {
        key: 'garden-air',
        label: 'Garden air',
        desc: 'A breeze through fresh botanicals',
        beats: [
          { motion: 'slow tracking through foliage', view: 'the bottle standing in a sunlit garden, flowers and leaves framing it' },
          { motion: 'a breeze passes in slow motion', view: 'petals lifting and drifting past the bottle, light dappling' },
          { motion: 'settle to the hero', view: 'the bottle crisp, botanicals softly blurred, air feeling fresh' },
        ],
        light: 'bright natural morning light with soft dapple through leaves',
        audio: 'birdsong and breeze, an airy uplifting note',
        negatives: 'no fake-looking plastic plants, no text',
      },
      {
        key: 'glass-sculpture',
        label: 'Glass sculpture',
        desc: 'The bottle as an art object',
        beats: [
          { motion: 'extreme macro rack focus', view: 'light refracting through the glass, the liquid glowing like a gem' },
          { motion: 'slow orbit', view: 'the bottle as sculpture — facets, curves and cap in precise detail' },
          { motion: 'pull back and hold', view: 'the hero pose on a minimal set, a caustic light pattern beneath it' },
        ],
        light: 'hard directional key throwing caustics through the glass',
        audio: 'minimal glassy tones, one resonant note',
        negatives: 'no fingerprints, no dust, no text',
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
      {
        key: 'craft-story',
        label: 'Craft story',
        desc: 'Hands, materials, the making of',
        beats: [
          { motion: 'macro tracking over raw material', view: 'wood grain / leather / weave in warm workshop light, hands smoothing a surface' },
          { motion: 'a series of soft dissolves through craft moments', view: 'sanding, stitching, joining — honest workmanship on the piece' },
          { motion: 'pull out to the finished hero', view: 'the completed product standing proud in the workshop light' },
        ],
        light: 'warm workshop light with dust motes in the beams',
        audio: 'gentle tool foley, warm acoustic score',
        negatives: 'no warped hands, no text, no invented maker\'s marks',
      },
      {
        key: 'day-cycle',
        label: 'Light passage',
        desc: 'Morning to evening across the room',
        beats: [
          { motion: 'locked wide shot as light shifts', view: 'morning sun sweeping across the room, the product anchoring the space' },
          { motion: 'slow push in as the light warms', view: 'afternoon glow wrapping the product, shadows lengthening' },
          { motion: 'settle at dusk', view: 'lamps on, the product in a warm intimate evening scene' },
        ],
        light: 'a full passage of natural light — cool morning to golden dusk to warm lamplight',
        audio: 'quiet home ambience shifting from birdsong to evening calm',
      },
      {
        key: 'cosy-moment',
        label: 'Lived-in moment',
        desc: 'Someone settles in, at home',
        beats: [
          { motion: 'tracking shot into the scene', view: 'a person settling naturally into / at the product — coffee, a book, soft knitwear' },
          { motion: 'slow push in', view: 'the comfortable moment, the product supporting real life' },
          { motion: 'drift to the hero', view: 'the product crisp and inviting, the scene softly blurred around it' },
        ],
        light: 'soft warm interior light, hygge calm',
        audio: 'a page turn, a cup set down, warm quiet score',
        negatives: 'no warped faces or hands, no text',
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
      {
        key: 'dawn-grind',
        label: 'Dawn grind',
        desc: 'First light, discipline, grit',
        beats: [
          { motion: 'aerial rise at dawn', view: 'an athlete training alone at first light — road, track or rooftop — the product with them' },
          { motion: 'tracking shot at effort pace', view: 'breath visible in the cold air, the product in use, determined rhythm' },
          { motion: 'push in to the hero', view: 'the product tight in frame, sunrise flaring softly behind' },
        ],
        light: 'cold blue dawn warming to a low sunrise flare',
        audio: 'footfalls and breath over a rising cinematic pulse',
        negatives: 'no warped limbs or faces, no text',
      },
      {
        key: 'studio-power',
        label: 'Power studio',
        desc: 'Dark set, chalk dust, drama',
        beats: [
          { motion: 'slow push through haze', view: 'the product spot-lit in a dark training space, chalk dust drifting in the beam' },
          { motion: 'slow-motion impact', view: 'a burst of chalk / sweat droplets flying as the product takes the strain' },
          { motion: 'orbit and lock', view: 'the product heroic in the single beam, dust settling' },
        ],
        light: 'single hard spotlight in a dark space, atmospheric haze',
        audio: 'deep bass hits, an exhale, dust-settle quiet',
        negatives: 'no warped limbs, no text',
      },
      {
        key: 'trail-air',
        label: 'Out on the trail',
        desc: 'Drone chase through nature',
        beats: [
          { motion: 'FPV drone chase', view: 'the product in use across a mountain trail / open water / forest road, landscape sweeping past' },
          { motion: 'slow-motion peak moment', view: 'the jump, the turn, the stride — product center-frame against the sky' },
          { motion: 'settle to the hero', view: 'the product crisp, dirt or spray still in the air, wilderness behind' },
        ],
        light: 'clean outdoor daylight with a low warm sun',
        audio: 'wind and terrain foley under an adventurous score',
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
      {
        key: 'night-city',
        label: 'Night city',
        desc: 'Neon reflections on wet streets',
        beats: [
          { motion: 'low tracking shot', view: 'the vehicle gliding through a neon-lit city at night, reflections streaming over the body' },
          { motion: 'slow-motion pass through a puddle of light', view: 'colour washes sweeping the paintwork, fine spray catching the neon' },
          { motion: 'push in to the stance', view: 'the vehicle stopped under a single street light, lamps glowing, hero pose' },
        ],
        light: 'wet-street neon night with strong specular reflections',
        audio: 'a low engine burble, city night ambience, moody synth',
        negatives: 'no warped wheels or badges, no readable plates or signage, no text',
      },
      {
        key: 'detail-craft',
        label: 'Detail craft',
        desc: 'Macro over stitching, badge, wheel',
        beats: [
          { motion: 'macro glide along the body line', view: 'paint depth and panel gaps in raking light, immaculate' },
          { motion: 'rack focus through details', view: 'the badge, a wheel spoke, stitched leather, brushed metal — one at a time' },
          { motion: 'pull back to the hero', view: 'the whole vehicle resolving from its details, studio-crisp' },
        ],
        light: 'controlled studio raking light that reveals surface craft',
        audio: 'hushed studio tone, one leather creak, a soft ignition at the end',
        negatives: 'no warped badges or spokes, no readable plates, no invented logos, no text',
      },
      {
        key: 'offroad-grit',
        label: 'Off-road grit',
        desc: 'Dust, terrain, capability',
        beats: [
          { motion: 'aerial chase over open terrain', view: 'the vehicle carving through desert or mountain trail, dust plume rising' },
          { motion: 'slow-motion terrain hit', view: 'wheels working, dirt and gravel flying, suspension soaking the impact' },
          { motion: 'crane down to the hero', view: 'the vehicle stopped on a ridge at golden hour, dust drifting past' },
        ],
        light: 'hard desert sun into a golden-hour ridge finale',
        audio: 'engine under load, gravel foley, a widescreen score',
        negatives: 'no warped wheels, no readable plates, no text',
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
      {
        key: 'daily-ritual',
        label: 'Daily ritual',
        desc: 'The everyday moment it belongs to',
        beats: [
          { motion: 'push in on a real morning scene', view: 'a bright kitchen or bathroom, the product in its natural everyday place' },
          { motion: 'slow-motion use moment', view: 'hands using the product naturally — the small satisfying ritual' },
          { motion: 'settle to the hero', view: 'the pack crisp and front-on, the warm scene softly blurred behind' },
        ],
        light: 'bright optimistic morning daylight',
        audio: 'cheerful home ambience, light product foley',
        negatives: 'no warped hands or faces, no invented label text, no text overlays',
      },
      {
        key: 'stop-motion',
        label: 'Stop-motion play',
        desc: 'Packs dance in playful rhythm',
        beats: [
          { motion: 'stop-motion hops and slides', view: 'the pack bouncing into frame in a playful choreographed rhythm' },
          { motion: 'contents pop in around it', view: 'the product\'s contents appearing beat-by-beat in a graphic arrangement' },
          { motion: 'freeze on the hero grid', view: 'the pack centered, everything snapped into a satisfying final composition' },
        ],
        light: 'flat bright pop-art studio light, saturated and fun',
        audio: 'snappy percussive stop-motion clicks in rhythm',
        negatives: 'no invented label text, keep the real pack exactly as photographed, no text overlays',
      },
      {
        key: 'colour-pop',
        label: 'Colour pop',
        desc: 'Bold graphic energy, quick cuts',
        beats: [
          { motion: 'hard push in on a saturated set', view: 'the pack against a bold complementary colour block, confident and graphic' },
          { motion: 'quick orbit with colour washes', view: 'background hues shifting boldly while the pack stays true-colour' },
          { motion: 'snap to the end frame', view: 'the pack poster-perfect, centered, punchy' },
        ],
        light: 'high-key saturated studio light, colour-true on the pack',
        audio: 'upbeat rhythmic track with a final sting',
        negatives: 'no colour cast on the pack itself, no invented label text, no text overlays',
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
