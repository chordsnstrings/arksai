/**
 * The app is light/warm editorial by default; the Engineering ("developer") team
 * gets a dark theme. Theme follows the chosen department (persisted), applied at
 * the document level so the whole shell — sidebar, chat, canvas — flips.
 */
export const DEPT_KEY = 'arksai.department';

export function applyDeptTheme(deptId: string | null | undefined, animate = false): void {
  const dark = deptId === 'engineering';
  const root = document.documentElement;
  const changing = root.getAttribute('data-theme') !== (dark ? 'dark' : 'light');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // The actual flip — set the theme attribute, native color-scheme, and the mobile
  // browser chrome colour together so everything changes in one shot.
  const flip = () => {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15171b' : '#f4f1ea');
  };

  // Preferred: a true full-page crossfade via the View Transition API. It snapshots
  // the old and new states and dissolves between them, so EVERYTHING fades — including
  // the gradients/images that CSS property transitions can't touch. Smooth like a
  // native mobile theme switch. (Chromium-class browsers; we fall back otherwise.)
  const startViewTransition = (document as any).startViewTransition?.bind(document);
  if (animate && changing && !reduce && startViewTransition) {
    startViewTransition(flip);
    return;
  }

  // Fallback (no View Transition API): briefly enable colour transitions across the UI
  // for a property-level crossfade, then remove them so they don't linger on hovers.
  if (animate && changing && !reduce) {
    root.classList.add('theme-animating');
    window.clearTimeout((root as any)._themeT);
    (root as any)._themeT = window.setTimeout(() => root.classList.remove('theme-animating'), 560);
  }
  flip();
}

/** Apply the saved department's theme as early as possible (avoids a flash). */
export function initTheme(): void {
  try {
    applyDeptTheme(localStorage.getItem(DEPT_KEY));
  } catch {
    applyDeptTheme(null);
  }
}
