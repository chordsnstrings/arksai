/*
 * ArksAI UI kit — tiny progressive enhancer (no dependencies, ~1KB).
 * Link before </body>:  <script src="ui-kit/ui-kit.js" defer></script>
 * Powers scroll-reveal, tabs, dialogs, dropdowns, toasts, theme toggle.
 * Everything degrades gracefully if the markup or APIs are absent.
 */
(function () {
  'use strict';
  var D = document;

  /* Scroll reveal: ARM (hide) only when we can actually reveal — JS + IO + motion ok —
     so content is NEVER stuck invisible if anything is missing. */
  var rev = D.querySelectorAll('[data-reveal]');
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (rev.length && 'IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.remove('reveal-hidden'); e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    rev.forEach(function (el) { el.classList.add('reveal-hidden'); io.observe(el); });
  }

  /* Tabs: <div data-tabs>… buttons with aria-controls="panelId" … panels .tab-panel */
  D.querySelectorAll('[data-tabs]').forEach(function (root) {
    var btns = root.querySelectorAll('[aria-controls]');
    function select(b) {
      btns.forEach(function (x) {
        var on = x === b;
        x.setAttribute('aria-selected', String(on));
        var p = D.getElementById(x.getAttribute('aria-controls'));
        if (p) p.hidden = !on;
      });
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { select(b); }); });
    if (btns[0]) select(btns[0]);
  });

  /* Single-select button group: <div data-segmented> buttons */
  D.querySelectorAll('[data-segmented]').forEach(function (g) {
    var btns = g.querySelectorAll('button');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.toggle('is-active', x === b); x.setAttribute('aria-selected', String(x === b)); });
      });
    });
  });

  /* Dialog: [data-open="#id"] opens a native <dialog>; backdrop click or [data-close] closes. */
  D.querySelectorAll('[data-open]').forEach(function (t) {
    t.addEventListener('click', function () { var d = D.querySelector(t.getAttribute('data-open')); if (d && d.showModal) d.showModal(); });
  });
  D.querySelectorAll('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.querySelectorAll('[data-close]').forEach(function (c) { c.addEventListener('click', function () { d.close(); }); });
  });

  /* Dropdown: a [data-dropdown] trigger toggles its next-sibling .menu */
  D.querySelectorAll('[data-dropdown]').forEach(function (btn) {
    var menu = btn.nextElementSibling;
    if (!menu) return;
    if (btn.parentElement) btn.parentElement.style.position = 'relative';
    menu.style.position = 'absolute';
    menu.style.zIndex = '40';
    menu.hidden = true;
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
    D.addEventListener('click', function () { menu.hidden = true; });
  });

  /* Theme toggle: [data-theme-toggle] flips " dark" on <html>'s data-theme */
  D.querySelectorAll('[data-theme-toggle]').forEach(function (t) {
    t.addEventListener('click', function () {
      var h = D.documentElement, cur = h.getAttribute('data-theme') || 'aurora';
      h.setAttribute('data-theme', /\bdark\b/.test(cur) ? cur.replace(/\s*dark\b/, '').trim() : cur + ' dark');
    });
  });

  /* Toasts: window.toast('Saved') */
  window.toast = function (msg) {
    var wrap = D.querySelector('.toasts');
    if (!wrap) { wrap = D.createElement('div'); wrap.className = 'toasts'; D.body.appendChild(wrap); }
    var t = D.createElement('div'); t.className = 'toast'; t.textContent = msg; wrap.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, 3200);
  };
})();
