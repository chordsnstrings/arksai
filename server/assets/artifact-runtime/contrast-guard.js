/* Runtime contrast guard — measures the background actually painted across the viewport and
   toggles html.artifact-dark so the ink tokens always match the surface. Catches a component
   that paints a dark background while using light-theme text tokens (dark-on-dark). Idempotent
   and reality-based: re-runs after mount, on resize, and after async state settles. Lives in its
   OWN file (NOT inside a template literal) so its regex backslashes survive verbatim. */
(function () {
  function lum(r, g, b) {
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function colorsIn(s) {
    var out = [], m;
    var re = /rgba?\(([^)]+)\)|#([0-9a-fA-F]{6})\b/g;
    while ((m = re.exec(s))) {
      if (m[1]) {
        var p = m[1].split(',').map(function (x) { return parseFloat(x); });
        if (p.length < 4 || p[3] > 0.4) out.push([p[0], p[1], p[2]]);
      } else if (m[2]) {
        out.push([parseInt(m[2].slice(0, 2), 16), parseInt(m[2].slice(2, 4), 16), parseInt(m[2].slice(4, 6), 16)]);
      }
    }
    return out;
  }
  function bgLumAt(x, y) {
    var el = document.elementFromPoint(x, y), depth = 0;
    while (el && depth++ < 40) {
      var cs = getComputedStyle(el);
      var bc = cs.backgroundColor || '';
      var m = bc.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(',').map(function (v) { return parseFloat(v); });
        if (p.length < 4 || p[3] > 0.4) return lum(p[0], p[1], p[2]);
      }
      var bi = cs.backgroundImage || '';
      if (bi && bi !== 'none' && /gradient/.test(bi)) {
        var cols = colorsIn(bi);
        if (cols.length) {
          var s = 0;
          cols.forEach(function (c) { s += lum(c[0], c[1], c[2]); });
          return s / cols.length;
        }
      }
      el = el.parentElement;
    }
    return 1;
  }
  function measure() {
    var w = innerWidth || 320, h = innerHeight || 480;
    var pts = [[w * 0.5, h * 0.18], [w * 0.25, h * 0.5], [w * 0.5, h * 0.5], [w * 0.75, h * 0.5], [w * 0.5, h * 0.85]];
    var ls = [];
    for (var i = 0; i < pts.length; i++) {
      var v = bgLumAt(pts[i][0], pts[i][1]);
      if (typeof v === 'number' && !isNaN(v)) ls.push(v);
    }
    if (!ls.length) return null;
    ls.sort(function (a, b) { return a - b; });
    return ls[Math.floor(ls.length / 2)];
  }
  function fix() {
    try {
      var L = measure();
      if (L === null) return;
      document.documentElement.classList.toggle('artifact-dark', L < 0.34);
    } catch (e) { /* never let the guard break the artifact */ }
  }
  if (document.readyState !== 'loading') requestAnimationFrame(fix);
  else document.addEventListener('DOMContentLoaded', function () { requestAnimationFrame(fix); });
  setTimeout(fix, 120);
  setTimeout(fix, 400);
  setTimeout(fix, 1000);
  addEventListener('resize', function () { requestAnimationFrame(fix); });
})();
