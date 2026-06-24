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
})();
