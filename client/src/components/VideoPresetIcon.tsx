import type { ReactNode } from 'react';

/**
 * Tiny line-icons for the Video studio presets — each visually shows what the preset DOES
 * (the camera's motion, the light's quality, the look) so a non-expert can read the row at a
 * glance instead of parsing words. Stroke uses currentColor, so they inherit the chip's muted
 * / accent colour automatically. Kept minimal + uniform (24-grid, 1.7 stroke, round caps).
 */

// A 4-point sparkle = "Auto / smart pick" (shared by the camera + lighting Auto chips).
const SPARKLE: ReactNode = (
  <>
    <path d="M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5z" />
    <path d="M18.5 4.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" />
  </>
);

const CAM_ICON: Record<string, ReactNode> = {
  auto: SPARKLE,
  // Converging chevrons ">  <" = the frame tightening on the subject.
  push: (<><path d="M4 7l3.5 5-3.5 5" /><path d="M20 7l-3.5 5 3.5 5" /></>),
  // Diverging chevrons "<  >" = pulling back to reveal.
  pull: (<><path d="M8 7l-3.5 5 3.5 5" /><path d="M16 7l3.5 5-3.5 5" /></>),
  // Horizontal double-arrow = lateral pan.
  pan: (<><path d="M3 12h18" /><path d="M6.5 8.5L3 12l3.5 3.5" /><path d="M17.5 8.5L21 12l-3.5 3.5" /></>),
  // A subject dot with a trailing arrow = the camera follows it.
  track: (<><circle cx="5.5" cy="12" r="2" fill="currentColor" stroke="none" /><path d="M9.5 12h9" /><path d="M15 8.5l3.5 3.5-3.5 3.5" /></>),
  // A ring around a centre dot = orbiting the subject.
  orbit: (<><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" /><path d="M16.5 6.2l2 .3-.3 2" /></>),
  // An altitude line with a descending arrow = a drone shot coming down.
  aerial: (<><path d="M4 6.5h16" /><path d="M12 10v9" /><path d="M8 15l4 4 4-4" /></>),
  // An up arrow on a baseline = crane / boom rising.
  craneup: (<><path d="M12 20V6" /><path d="M8 10l4-4 4 4" /><path d="M5 20h14" /></>),
  // A down arrow onto a baseline = crane / boom lowering.
  cranedown: (<><path d="M12 4v14" /><path d="M8 14l4 4 4-4" /><path d="M5 4h14" /></>),
  // A magnifier with a plus = a lens zoom in.
  zoom: (<><circle cx="10.5" cy="10.5" r="6" /><path d="M14.8 14.8L20 20" /><path d="M10.5 8v5M8 10.5h5" /></>),
  // Nested frames joined by perspective lines = the dolly-zoom warp.
  dollyzoom: (<><rect x="3" y="6" width="18" height="12" rx="1.5" /><rect x="8.5" y="9.5" width="7" height="5" rx="1" /><path d="M3 6l5.5 3.5M21 6l-5.5 3.5M3 18l5.5-3.5M21 18l-5.5-3.5" /></>),
  // Speed lines with an arrow = a fast whip pan.
  whip: (<><path d="M3 9h12" /><path d="M4 12h15" /><path d="M3 15h10" /><path d="M16 8l3.5 4-3.5 4" /></>),
  // A quadcopter = an FPV drone fly-through.
  fpv: (<><circle cx="6" cy="6" r="2.1" /><circle cx="18" cy="6" r="2.1" /><circle cx="6" cy="18" r="2.1" /><circle cx="18" cy="18" r="2.1" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M7.6 7.6l1.9 1.9M16.4 7.6l-1.9 1.9M7.6 16.4l1.9-1.9M16.4 16.4l-1.9-1.9" /></>),
  // A wave = natural handheld shake.
  handheld: (<path d="M3 13c1.5-3.2 3-3.2 4.5 0s3 3.2 4.5 0 3-3.2 4.5 0 3 3.2 3 3.2" />),
  // A framed screen on a tripod = a locked-off, fixed camera.
  fixed: (<><rect x="6" y="4.5" width="12" height="9" rx="1.5" /><path d="M12 13.5v3.5" /><path d="M8 21l4-4 4 4" /></>),
};

const LIGHT_ICON: Record<string, ReactNode> = {
  auto: SPARKLE,
  // Half-sun rising over a horizon = golden hour.
  golden: (<><path d="M3.5 17.5h17" /><path d="M8 17.5a4 4 0 0 1 8 0" /><path d="M12 8v2" /><path d="M6.4 11.2l1.3 1.3" /><path d="M17.6 11.2l-1.3 1.3" /></>),
  // Half-sun below a horizon with a twinkle = blue-hour twilight.
  bluehour: (<><path d="M3.5 14h17" /><path d="M8.5 14a3.5 3.5 0 0 1 7 0" /><path d="M17.5 6.5l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" /></>),
  // A full sun with rays = soft, even daylight.
  daylight: (<><circle cx="12" cy="12" r="3.6" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6.2 6.2l1.6 1.6M16.2 16.2l1.6 1.6M6.2 17.8l1.6-1.6M16.2 7.8l1.6-1.6" /></>),
  // A sun with long straight rays = hard direct sun.
  hardsun: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3.5M12 18.5v3.5M2 12h3.5M18.5 12h3.5M5 5l2.4 2.4M16.6 16.6L19 19M5 19l2.4-2.4M16.6 7.4L19 5" /></>),
  // A softbox panel on a stand = studio lighting.
  studio: (<><rect x="5" y="4" width="14" height="9" rx="1.5" /><path d="M9.5 4v9M14.5 4v9M5 8.5h14" /><path d="M12 13v5M8.5 20h7" /></>),
  // A disc with one bright, thick edge = rim / edge light.
  rim: (<><circle cx="11" cy="12" r="6" /><path d="M13.5 6.6a6 6 0 0 1 0 10.8" strokeWidth="2.6" /></>),
  // A downward beam cone = a single spotlight.
  spotlight: (<><path d="M10 3h4l4.5 8h-13z" /><path d="M8 11l1.5 9M16 11l-1.5 9M11 20h2" /></>),
  // A lightning bolt = electric neon glow.
  neon: (<path d="M13 3L5.5 13H11l-1.5 8L18 10.5h-5.5z" />),
  // A candle flame = warm candlelight.
  candle: (<path d="M12 3c2.5 3 3.8 5 3.8 7.5a3.8 3.8 0 0 1-7.6 0c0-1.4.7-2.6 1.9-3.7.1.9.7 1.6 1.4 1.9-.1-1.9.4-3.7.5-5.7z" />),
  // A filled subject with rays behind it = strong backlight.
  backlit: (<><circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6.2 6.2l1.5 1.5M16.3 16.3l1.5 1.5M6.2 17.8l1.5-1.5M16.3 7.7l1.5-1.5" /></>),
  // A cloud = flat, overcast light.
  overcast: (<path d="M7.5 18h9a3.8 3.8 0 0 0 .3-7.6 4.8 4.8 0 0 0-9.2-1A3.4 3.4 0 0 0 7.5 18z" />),
  // A crescent moon = moody, low-key light.
  moody: (<path d="M15.5 3.2a7 7 0 1 0 5.3 8.4 5.6 5.6 0 0 1-5.3-8.4z" />),
};

const LOOK_ICON: Record<string, ReactNode> = {
  // Clapperboard = cinematic.
  cinematic: (<><rect x="4" y="6" width="16" height="12" rx="1.5" /><path d="M4 10h16" /><path d="M7.5 6L5.5 10M11.5 6l-2 4M15.5 6l-2 4" /></>),
  // 3D cube = a product hero.
  product: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12v9M4 7.5l8 4.5 8-4.5" /></>),
  // A phone = handheld UGC.
  ugc: (<><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M10.5 5.5h3" /><circle cx="12" cy="18" r="0.9" fill="currentColor" stroke="none" /></>),
  // A star = stylised animation.
  anime: (<path d="M12 3.5l2.4 5.6 6 .5-4.6 3.9 1.5 5.9L12 16.6 6.2 19.4l1.5-5.9L3.1 9.6l6-.5z" />),
  // An eye = observational documentary realism.
  documentary: (<><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.6" /></>),
  // A perforated film strip = vintage film.
  vintage: (<><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 8.5h2M4 12h2M4 15.5h2M18 8.5h2M18 12h2M18 15.5h2" /></>),
  // A half-filled disc = high-contrast black-and-white noir.
  noir: (<><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></>),
  // Soft overlapping bokeh discs = a dreamy, soft-focus look.
  dreamy: (<><circle cx="10" cy="12" r="5" /><circle cx="15.5" cy="10.5" r="3.6" opacity="0.55" /></>),
  // A sparkle burst = vibrant, high-energy colour.
  vibrant: (<path d="M12 3l1.7 4 4.2-1.6-1.6 4.2 4 1.7-4 1.7 1.6 4.2-4.2-1.6L12 21l-1.7-4-4.2 1.6 1.6-4.2-4-1.7 4-1.7L6.1 5.4l4.2 1.6z" />),
  // A cut gem = a luxury, premium finish.
  luxury: (<><path d="M6 4h12l3 5-9 11L3 9z" /><path d="M3 9h18M9 4l3 16M15 4l-3 16" /></>),
  // A minus = no preset (plain).
  none: (<path d="M6 12h12" />),
};

const GROUPS = { camera: CAM_ICON, light: LIGHT_ICON, look: LOOK_ICON } as const;

export function PresetIcon({ group, id, size = 15 }: { group: keyof typeof GROUPS; id: string; size?: number }) {
  const inner = GROUPS[group][id];
  if (!inner) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      {inner}
    </svg>
  );
}
