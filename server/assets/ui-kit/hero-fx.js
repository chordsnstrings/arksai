/*
 * ArksAI hero FX — self-contained, fallback-first Canvas-2D hero backgrounds. ~5KB, no deps, no CDN.
 *
 * WHY CANVAS 2D, NOT WebGL: 2D renders reliably everywhere (incl. headless CI and low-end phones);
 * WebGL is GPU-dependent and blanks silently under software rendering. These read as a premium,
 * interactive hero without the fragility.
 *
 * FALLBACK-FIRST: the canvas OVERLAYS the solid --fx-bg colour on .fx-hero (see hero-fx.css). If the
 * 2D context is unavailable OR the user prefers reduced motion, the canvas is hidden and that solid
 * colour — a designed, legible hero — shows on its own. The effect never removes ink, only adds it.
 *
 * Markup (install via add_hero_fx):
 *   <section class="fx-hero" data-fx="aurora"
 *            style="--fx-bg:#0b0f1a; --fx-accent:#5b8cff; --fx-accent-2:#c86bff; --fx-ink:#f4f6ff">
 *     <canvas class="fx-canvas" aria-hidden="true"></canvas>
 *     <div class="fx-scrim" aria-hidden="true"></div>   (optional legibility veil)
 *     <div class="fx-content"> … headline / sub / CTA … </div>
 *   </section>
 *
 * data-fx: "aurora" (drifting soft gradient mesh) · "particles" (constellation field) ·
 *          "waves" (layered flowing lines). Tune with data-fx-density (0.5–1.5) and
 *          data-fx-speed (0.5–1.6). Everything is transform/paint-cheap and pauses offscreen.
 */
(function () {
  'use strict';
  var W = window, D = document;
  var reduce = W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Parse a CSS colour (hex #rgb/#rrggbb, or rgb/rgba()) to {r,g,b}. Falls back to a mid grey.
  function toRgb(str) {
    var s = String(str || '').trim();
    var m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) { var c = m[1]; return { r: parseInt(c[0] + c[0], 16), g: parseInt(c[1] + c[1], 16), b: parseInt(c[2] + c[2], 16) }; }
    m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { var h = m[1]; return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
    m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) { var p = m[1].split(',').map(function (x) { return parseFloat(x); }); return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0 }; }
    return { r: 120, g: 130, b: 150 };
  }
  function lum(c) { return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; }
  function rgba(c, a) { return 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + a + ')'; }
  function readVar(el, name, dflt) {
    var v = '';
    try { v = getComputedStyle(el).getPropertyValue(name); } catch (e) {}
    return (v && v.trim()) || dflt;
  }

  function initHero(host) {
    var canvas = host.querySelector('canvas.fx-canvas');
    if (!canvas) return;

    var ctx = null;
    try { ctx = canvas.getContext('2d'); } catch (e) { ctx = null; }
    // No 2D context OR reduced motion → hide the canvas; the solid --fx-bg fallback carries the hero.
    if (!ctx || reduce) { canvas.style.display = 'none'; return; }

    var kind = (host.getAttribute('data-fx') || 'aurora').toLowerCase();
    var density = clamp(parseFloat(host.getAttribute('data-fx-density')) || 1, 0.5, 1.5);
    var speed = clamp(parseFloat(host.getAttribute('data-fx-speed')) || 1, 0.4, 1.6);
    var accent = toRgb(readVar(host, '--fx-accent', '#5b8cff'));
    var accent2 = toRgb(readVar(host, '--fx-accent-2', readVar(host, '--fx-accent', '#c86bff')));
    var bg = toRgb(readVar(host, '--fx-bg', '#0b0f1a'));
    var darkBg = lum(bg) < 0.5; // additive glow on dark grounds; gentle normal blend on light

    var dpr = Math.min(W.devicePixelRatio || 1, 1.5); // perf budget: cap DPR at 1.5
    var w = 1, h = 1;
    var particles = [], waves = [], blobs = [];

    function build() {
      var area = w * h;
      if (kind === 'particles') {
        particles = [];
        var n = Math.round(clamp((area / 20000) * density, 20, 96)); // capped particle count
        for (var i = 0; i < n; i++) {
          particles.push({
            x: Math.random() * w, y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
            r: 0.8 + Math.random() * 1.4,
          });
        }
      } else if (kind === 'waves') {
        waves = [];
        var layers = Math.round(clamp(4 * density, 3, 6));
        for (var k = 0; k < layers; k++) {
          waves.push({ amp: (h * 0.06) * (1 + k * 0.35), off: (h * 0.55) + k * (h * 0.09), len: 0.6 + k * 0.22, ph: Math.random() * Math.PI * 2, sp: 0.18 + k * 0.05 });
        }
      } else {
        blobs = [];
        var b = Math.round(clamp(3 * density, 3, 5));
        for (var j = 0; j < b; j++) {
          blobs.push({ bx: Math.random(), by: Math.random(), rx: 0.35 + Math.random() * 0.3, ph: Math.random() * Math.PI * 2, sp: 0.12 + Math.random() * 0.1, col: j % 2 ? accent2 : accent });
        }
      }
    }

    function resize() {
      var r = host.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      try { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); } catch (e) {}
      build();
    }

    // Pointer (desktop fine-pointer only) for a subtle reactive layer.
    var mx = -999, my = -999;
    var finePointer = W.matchMedia && W.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (finePointer) {
      host.addEventListener('mousemove', function (e) { var r = host.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; }, { passive: true });
      host.addEventListener('mouseleave', function () { mx = -999; my = -999; });
    }

    function drawAurora() {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = darkBg ? 'lighter' : 'source-over';
      for (var i = 0; i < blobs.length; i++) {
        var b = blobs[i];
        var cx = (b.bx + Math.sin(t * b.sp + b.ph) * 0.14) * w;
        var cy = (b.by + Math.cos(t * b.sp * 0.9 + b.ph) * 0.14) * h;
        var rad = b.rx * Math.max(w, h);
        var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        var peak = darkBg ? 0.42 : 0.30;
        g.addColorStop(0, rgba(b.col, peak));
        g.addColorStop(0.55, rgba(b.col, peak * 0.32));
        g.addColorStop(1, rgba(b.col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawParticles() {
      ctx.clearRect(0, 0, w, h);
      var link = 118, link2 = link * link;
      // pointer nudge
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (mx > -900) {
          var dx = mx - p.x, dy = my - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 26000 && d2 > 1) { p.vx += (dx / Math.sqrt(d2)) * 0.006; p.vy += (dy / Math.sqrt(d2)) * 0.006; }
        }
        p.vx = clamp(p.vx * 0.995, -0.4, 0.4);
        p.vy = clamp(p.vy * 0.995, -0.4, 0.4);
        p.x += p.vx * speed; p.y += p.vy * speed;
        if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; else if (p.y > h + 10) p.y = -10;
      }
      // links
      ctx.lineWidth = 1;
      for (var a = 0; a < particles.length; a++) {
        var pa = particles[a];
        for (var b2 = a + 1; b2 < particles.length; b2++) {
          var pb = particles[b2];
          var ex = pa.x - pb.x, ey = pa.y - pb.y, dd = ex * ex + ey * ey;
          if (dd < link2) {
            ctx.strokeStyle = rgba(accent, (1 - dd / link2) * 0.16);
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
          }
        }
      }
      // dots
      for (var c = 0; c < particles.length; c++) {
        var pc = particles[c];
        ctx.fillStyle = rgba(accent, 0.7);
        ctx.beginPath(); ctx.arc(pc.x, pc.y, pc.r, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawWaves() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < waves.length; i++) {
        var wv = waves[i];
        var col = i % 2 ? accent2 : accent;
        ctx.beginPath();
        ctx.moveTo(0, h + 4);
        var step = Math.max(6, Math.round(w / 90));
        for (var x = 0; x <= w; x += step) {
          var y = wv.off + Math.sin((x / w) * Math.PI * 2 * (1.2 + wv.len) + t * wv.sp + wv.ph) * wv.amp
                        + Math.sin((x / w) * Math.PI * 5 + t * wv.sp * 0.6) * (wv.amp * 0.22);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h + 4);
        ctx.closePath();
        var alpha = (darkBg ? 0.10 : 0.08) + (i / waves.length) * 0.06;
        ctx.fillStyle = rgba(col, alpha);
        ctx.fill();
        ctx.strokeStyle = rgba(col, alpha + 0.14);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }

    function draw() {
      try {
        if (kind === 'particles') drawParticles();
        else if (kind === 'waves') drawWaves();
        else drawAurora();
      } catch (e) { stop(); }
    }

    var t = 0, raf = 0, running = false, visible = true;
    function frame() {
      raf = 0;
      if (!running) return;
      t += 0.016 * speed;
      draw();
      raf = W.requestAnimationFrame(frame);
    }
    function start() { if (running) return; running = true; raf = W.requestAnimationFrame(frame); }
    function stop() { running = false; if (raf) { W.cancelAnimationFrame(raf); raf = 0; } }

    // Pause when the hero scrolls offscreen (perf) and when the tab is hidden.
    if ('IntersectionObserver' in W) {
      try {
        var io = new IntersectionObserver(function (es) {
          for (var i = 0; i < es.length; i++) { visible = es[i].isIntersecting; if (visible) start(); else stop(); }
        }, { threshold: 0.01 });
        io.observe(host);
      } catch (e) { visible = true; }
    }
    D.addEventListener('visibilitychange', function () { if (D.hidden) stop(); else if (visible) start(); });

    if ('ResizeObserver' in W) {
      try { new ResizeObserver(resize).observe(host); } catch (e) { W.addEventListener('resize', resize); }
    } else {
      W.addEventListener('resize', resize);
    }

    resize();
    draw(); // paint one frame immediately — no flash of empty canvas
    if (visible) start();
  }

  function boot() {
    var hosts = D.querySelectorAll('.fx-hero[data-fx]');
    for (var i = 0; i < hosts.length; i++) {
      try { initHero(hosts[i]); } catch (e) { /* on any failure the solid --fx-bg fallback shows */ }
    }
  }
  if (D.readyState !== 'loading') boot();
  else D.addEventListener('DOMContentLoaded', boot);
})();
