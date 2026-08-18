/**
 * The app is light/warm editorial by default; the Engineering ("developer") team gets a
 * dark theme. Theme follows the chosen department (persisted) UNLESS the user has set a
 * manual light/dark override via the toggle — that wins. Applied at the document level so
 * the whole shell (sidebar, chat, canvas) flips with a smooth full-page crossfade.
 */
export const DEPT_KEY = 'arksai.department';
export const THEME_OVERRIDE_KEY = 'arksai.themeOverride'; // 'light' | 'dark' | '' (follow dept)

function readOverride(): 'light' | 'dark' | '' {
  try {
    const v = localStorage.getItem(THEME_OVERRIDE_KEY);
    return v === 'light' || v === 'dark' ? v : '';
  } catch {
    return '';
  }
}

/** Resolve whether dark mode should be on: manual override wins, else the department default. */
function resolveDark(deptId: string | null | undefined): boolean {
  const ov = readOverride();
  if (ov) return ov === 'dark';
  return deptId === 'engineering';
}

/** Apply a concrete light/dark state, optionally with a smooth crossfade. */
function applyTheme(dark: boolean, animate: boolean): void {
  const root = document.documentElement;
  const changing = root.getAttribute('data-theme') !== (dark ? 'dark' : 'light');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // The actual flip — theme attribute, native color-scheme, and the mobile browser chrome
  // colour together so everything changes in one shot.
  const flip = () => {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    root.style.colorScheme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15181e' : '#f1eee6');
  };

  // Preferred: a true full-page crossfade via the View Transition API — snapshots the old
  // and new states and dissolves between them (covers gradients/images CSS can't transition).
  const startViewTransition = (document as any).startViewTransition?.bind(document);
  if (animate && changing && !reduce && startViewTransition) {
    startViewTransition(flip);
    return;
  }
  // Fallback (no View Transition API): briefly enable colour transitions, then remove them.
  if (animate && changing && !reduce) {
    root.classList.add('theme-animating');
    window.clearTimeout((root as any)._themeT);
    (root as any)._themeT = window.setTimeout(() => root.classList.remove('theme-animating'), 1000);
  }
  flip();
}

/** Apply the theme for a department (respecting any manual override). */
export function applyDeptTheme(deptId: string | null | undefined, animate = false): void {
  applyTheme(resolveDark(deptId), animate);
}

/** Is the app currently in dark mode? */
export function isDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/**
 * Manual toggle (the top-bar switch): flip light↔dark, persist it as an override that wins
 * over the department default, and crossfade. Returns the new state.
 */
export function toggleTheme(): boolean {
  const next = !isDark();
  try {
    localStorage.setItem(THEME_OVERRIDE_KEY, next ? 'dark' : 'light');
  } catch {
    /* private mode — fine */
  }
  applyTheme(next, true);
  return next;
}

/** Apply the saved theme as early as possible (avoids a flash). Override wins over dept. */
export function initTheme(): void {
  try {
    applyDeptTheme(localStorage.getItem(DEPT_KEY));
  } catch {
    applyDeptTheme(null);
  }
}
