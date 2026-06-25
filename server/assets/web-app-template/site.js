/* Bulletproof mobile nav. Delegated so it works no matter how the markup is edited:
   tap the hamburger to open/close the menu; tapping a link or outside closes it. */
(function () {
  var nav = function () { return document.getElementById('site-nav'); };
  document.addEventListener('click', function (e) {
    var toggle = e.target.closest && e.target.closest('[data-nav-toggle]');
    var n = nav();
    if (!n) return;
    if (toggle) {
      var open = n.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    // tap a nav link, or anywhere outside the menu → close it
    if (e.target.closest('#site-nav a') || !e.target.closest('#site-nav')) {
      n.classList.remove('open');
      var t = document.querySelector('[data-nav-toggle]');
      if (t) t.setAttribute('aria-expanded', 'false');
    }
  });

  /* Micro-engagement — free + reliable, and OFF under prefers-reduced-motion.
     - [data-reveal]   : fades/rises into view on scroll (staggered children supported by craft.css).
     - [data-count]    : counts a number up to data-count (e.g. <span data-count="30000">0</span>),
                         honouring a trailing suffix like "+", "%", "k" in the element text. */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }
  ready(function () {
    var reveals = [].slice.call(document.querySelectorAll('[data-reveal]'));
    var counts = [].slice.call(document.querySelectorAll('[data-count]'));
    if (reduce || !('IntersectionObserver' in window)) {
      reveals.forEach(function (el) { el.classList.add('in'); el.classList.remove('reveal-hidden'); });
      return; // leave numbers at their final/static text
    }
    reveals.forEach(function (el) { el.classList.add('reveal-hidden'); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        en.target.classList.remove('reveal-hidden');
        io.unobserve(en.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { io.observe(el); });

    function animateCount(el) {
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var m = (el.textContent || '').match(/[^0-9.,\s-]+\s*$/); // trailing suffix like + % k
      var suffix = m ? m[0].trim() : '';
      var dur = 1100, t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        var val = Math.round(target * eased);
        el.textContent = val.toLocaleString() + (suffix ? suffix : '');
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        animateCount(en.target);
        cio.unobserve(en.target);
      });
    }, { threshold: 0.5 });
    counts.forEach(function (el) { cio.observe(el); });
  });
})();
