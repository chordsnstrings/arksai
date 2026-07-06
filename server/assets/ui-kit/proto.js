/*
 * proto.js — the prototype screen SWITCHER.
 *
 * Discovers the prototype's screens from the page's own <a href="*.html"> graph (plus an
 * optional explicit manifest) and injects a floating pill listing them in order, with the
 * current screen highlighted. Arrow keys jump between screens. Zero dependencies.
 *
 * Optional explicit order (recommended — put on every page):
 *   <body class="proto" data-screens="cart.html,checkout.html,payment.html,success.html">
 */
(function () {
  var body = document.body;
  if (!body || !body.classList.contains('proto')) return;

  function baseName(href) {
    try {
      var u = new URL(href, location.href);
      var f = u.pathname.split('/').pop() || 'index.html';
      return f;
    } catch (e) {
      return null;
    }
  }

  var screens = [];
  var manifest = (body.getAttribute('data-screens') || '').trim();
  if (manifest) {
    screens = manifest.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  } else {
    // Derive from same-directory .html links, in document order, current page included.
    var seen = {};
    var current = baseName(location.href);
    if (current) { screens.push(current); seen[current] = true; }
    var links = document.querySelectorAll('a[href$=".html"]');
    for (var i = 0; i < links.length; i++) {
      var f = baseName(links[i].getAttribute('href'));
      if (f && !seen[f]) { seen[f] = true; screens.push(f); }
    }
  }
  if (screens.length < 2) return; // nothing to switch between

  var here = baseName(location.href) || screens[0];
  var bar = document.createElement('nav');
  bar.className = 'proto-switcher';
  bar.setAttribute('aria-label', 'Prototype screens');
  var label = document.createElement('span');
  label.className = 'proto-label';
  label.textContent = 'screens';
  bar.appendChild(label);
  screens.forEach(function (f, i) {
    var a = document.createElement('a');
    a.href = f;
    a.textContent = String(i + 1) + ' · ' + f.replace(/\.html$/, '').replace(/[-_]/g, ' ');
    if (f === here) a.className = 'on';
    bar.appendChild(a);
  });
  document.body.appendChild(bar);

  // Arrow keys walk the flow (never while typing in a field).
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    var idx = screens.indexOf(here);
    if (idx < 0) return;
    if (e.key === 'ArrowRight' && idx < screens.length - 1) location.href = screens[idx + 1];
    if (e.key === 'ArrowLeft' && idx > 0) location.href = screens[idx - 1];
  });
})();
