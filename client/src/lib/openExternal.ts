/**
 * Open a URL in the user's real browser, NOT inside our installed PWA.
 *
 * In a standalone PWA a same-origin `<a target="_blank">` (or a plain navigation)
 * is captured by the app window — so a published /apps/<slug>/ link opened "inside"
 * the PWA, hijacking it and making the user lose their ArksAI session. Using
 * window.open with an explicit _blank + noopener hands the URL to the OS browser,
 * leaving the PWA untouched so the user can switch back to it.
 */
export function openExternal(url: string) {
  try {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    // If a popup blocker (or the PWA shell) refused the window, fall back to a
    // synthesized anchor click, which most platforms route to the external browser.
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch {
    window.location.href = url;
  }
}
