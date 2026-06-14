/**
 * The app is light/warm editorial by default; the Engineering ("developer") team
 * gets a dark theme. Theme follows the chosen department (persisted), applied at
 * the document level so the whole shell — sidebar, chat, canvas — flips.
 */
export const DEPT_KEY = 'arksai.department';

export function applyDeptTheme(deptId: string | null | undefined, animate = false): void {
  const dark = deptId === 'engineering';
  const root = document.documentElement;
  if (animate && root.getAttribute('data-theme') !== (dark ? 'dark' : 'light')) {
    // Briefly enable color transitions across the UI for a smooth crossfade,
    // then remove them so they don't linger on hovers/interactions.
    root.classList.add('theme-animating');
    window.clearTimeout((root as any)._themeT);
    (root as any)._themeT = window.setTimeout(() => root.classList.remove('theme-animating'), 480);
  }
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#15171b' : '#f4f1ea');
}

/** Apply the saved department's theme as early as possible (avoids a flash). */
export function initTheme(): void {
  try {
    applyDeptTheme(localStorage.getItem(DEPT_KEY));
  } catch {
    applyDeptTheme(null);
  }
}
