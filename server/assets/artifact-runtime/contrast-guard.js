/* Runtime contrast guard — measures the background actually painted across the viewport and
   toggles html.artifact-dark so the ink tokens always match the surface. Catches a component
   that paints a dark background while using light-theme text tokens (dark-on-dark). Idempotent
   and reality-based: re-runs after mount, on resize, and after async state settles. Lives in its
   OWN file (NOT inside a template literal) so its regex backslashes survive verbatim.
   NOTE: computed backgrounds may serialize as rgb()/rgba() OR color(srgb r g b / a) (the latter is
   how Chromium serializes color-mix() results — which the tinted token system uses everywhere), so
   parse BOTH or a tinted dark surface reads as "unparseable → light" and the dark theme is dropped. */
(function () {
  function lum(r, g, b) {
    var a = [r, g, b].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  // Parse one CSS color string → [r,g,b,a] (0-255 channels), handling rgb()/rgba() and
  // color(srgb r g b [/ a]) with 0-1 channels. Returns null if it isn't a solid color.
  function parse(str) {
    if (!str) return null;
    var m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(/[ ,\/]+/).map(parseFloat);
      return [p[0], p[1], p[2], p.length > 3 && !isNaN(p[3]) ? p[3] : 1];
    }
    m = str.match(/color\(\s*srgb\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)\s+([0-9.eE+-]+)(?:\s*\/\s*([0-9.eE+-]+))?/);
    if (m) {
      return [parseFloat(m[1]) * 255, parseFloat(m[2]) * 255, parseFloat(m[3]) * 255, m[4] !== undefined ? parseFloat(m[4]) : 1];
    }
    return null;
  }
  function solidLum(str) {
    var c = parse(str);
    if (c && (isNaN(c[3]) || c[3] > 0.4)) return lum(c[0], c[1], c[2]);
    return null;
  }
  // Average luminance of the color stops inside a gradient string (each stop may be rgb/color(srgb)).
  function gradientLum(s) {
    var re = /(rgba?\([^)]+\)|color\(\s*srgb[^)]+\))/g, m, ls = [];
    while ((m = re.exec(s))) {
      var L = solidLum(m[1]);
      if (L !== null) ls.push(L);
    }
    if (!ls.length) return null;
    var t = 0;
    ls.forEach(function (x) { t += x; });
    return t / ls.length;
  }
  function bgLumAt(x, y) {
    var el = document.elementFromPoint(x, y), depth = 0;
    while (el && depth++ < 40) {
      var cs = getComputedStyle(el);
      var L = solidLum(cs.backgroundColor || '');
      if (L !== null) return L;
      var bi = cs.backgroundImage || '';
      if (bi && bi !== 'none' && /gradient/.test(bi)) {
        var g = gradientLum(bi);
        if (g !== null) return g;
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
