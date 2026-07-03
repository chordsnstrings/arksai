/**
 * Inline line-SVG icon set. Use color: currentColor for tint.
 * Stroke 1.7, round caps — visually consistent with the design.
 */

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function Icon({ name, size = 16, style }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', style, ...STROKE };
  switch (name) {
    case 'dashboard': return <svg {...props}><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>;
    case 'projects':  return <svg {...props}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>;
    case 'board':     return <svg {...props}><rect x="3" y="4" width="6" height="16" rx="1.5"/><rect x="11" y="4" width="6" height="11" rx="1.5"/><rect x="19" y="4" width="2" height="8" rx="1"/></svg>;
    case 'members':   return <svg {...props}><circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M14 19c0-2.6 1.6-4.7 4-5.4"/></svg>;
    case 'settings':  return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>;
    case 'plus':      return <svg {...props}><path d="M12 5v14M5 12h14"/></svg>;
    case 'search':    return <svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>;
    case 'check':     return <svg {...props}><path d="M5 12.5l4.5 4.5L19 7"/></svg>;
    case 'x':         return <svg {...props}><path d="M6 6l12 12M18 6L6 18"/></svg>;
    case 'chev-down': return <svg {...props}><path d="M6 9l6 6 6-6"/></svg>;
    case 'chev-right':return <svg {...props}><path d="M9 6l6 6-6 6"/></svg>;
    case 'copy':      return <svg {...props}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>;
    case 'arrow-up-right': return <svg {...props}><path d="M7 17L17 7M7 7h10v10"/></svg>;
    case 'edit':      return <svg {...props}><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
    case 'trash':     return <svg {...props}><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M5 6l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14"/></svg>;
    case 'alert':     return <svg {...props}><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>;
    case 'calendar':  return <svg {...props}><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>;
    case 'menu':      return <svg {...props}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
    case 'logout':    return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
    case 'arrow-left':return <svg {...props}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
    case 'arrow-right': return <svg {...props}><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
    case 'log-out':   return <svg {...props}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
    case 'sparkle':   return <svg {...props}><path d="M12 2l2 7 7 2-7 2-2 7-2-7-7-2 7-2z"/></svg>;
    case 'inbox':     return <svg {...props}><path d="M3 13h4l2 3h6l2-3h4M3 13L5 5a2 2 0 012-2h10a2 2 0 012 2l2 8v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6z"/></svg>;
    case 'bag':       return <svg {...props}><path d="M6 7h12l1 13a1.8 1.8 0 01-1.8 2H6.8A1.8 1.8 0 015 20L6 7z"/><path d="M9 10V6a3 3 0 016 0v4"/></svg>;
    case 'tag':       return <svg {...props}><path d="M20.6 13.4L12 22 2 12V2h10l8.6 8.6a2 2 0 010 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/></svg>;
    case 'clock':     return <svg {...props}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>;
    case 'file':      return <svg {...props}><path d="M14 2H7a2 2 0 00-2 2v16a2 2 0 002 2h10a2 2 0 002-2V7l-5-5z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></svg>;
    default: return null;
  }
}
