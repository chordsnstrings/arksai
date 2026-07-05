/*
 * ArksAI motion-kit runtime — DETERMINISTIC time for frame capture.
 *
 * The capture harness renders a scene frame-by-frame by calling window.__seek(ms) and
 * screenshotting. For that to be exact, the page must have NO wall-clock time source:
 * every animation is a CSS/WAAPI animation (paused here, driven by seek) or a registered
 * __motionHook(fn) that derives its state ONLY from the t it is given. Never use
 * requestAnimationFrame state, setInterval/setTimeout visuals, or Date.now().
 *
 * The harness injects the scene duration before the first seek:
 *   --scene-ms / --scene-s on :root and window.__sceneMs
 * so authors can time proportionally: animation-duration: calc(var(--scene-s) * 1s).
 */
(function () {
  'use strict';

  var hooks = [];
  window.__motionHook = function (fn) {
    if (typeof fn === 'function') hooks.push(fn);
  };

  function pauseAll() {
    try {
      document.getAnimations({ subtree: true }).forEach(function (a) {
        try {
          if (a.playState !== 'paused') a.pause();
        } catch (e) {}
      });
    } catch (e) {}
    // SMIL (animated SVG) pauses separately.
    var svgs = document.querySelectorAll('svg');
    for (var i = 0; i < svgs.length; i++) {
      try { if (svgs[i].pauseAnimations) svgs[i].pauseAnimations(); } catch (e) {}
    }
  }

  /** Set the scene duration (called by the capture harness; also usable by previews). */
  window.__setSceneMs = function (ms) {
    window.__sceneMs = ms;
    var root = document.documentElement;
    root.style.setProperty('--scene-ms', String(ms));
    root.style.setProperty('--scene-s', String(ms / 1000));
  };

  // Proportional start times: data-*-frac attributes resolve against the scene duration,
  // so a reveal lands mid-narration regardless of how long the narration turned out to be.
  function startOf(el, fracAttr, fixedAttr) {
    var fr = el.getAttribute(fracAttr);
    if (fr != null) return parseFloat(fr) * (window.__sceneMs || 8000);
    return parseFloat(el.getAttribute(fixedAttr) || '0');
  }

  // Typewriter: remember each element's full text once, then slice by time.
  function typewriter(ms) {
    var els = document.querySelectorAll('[data-typewriter]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__mgFull === undefined) el.__mgFull = el.textContent || '';
      var start = startOf(el, 'data-tw-start-frac', 'data-tw-start');
      var cps = parseFloat(el.getAttribute('data-tw-cps') || '24'); // chars per second
      var shown = Math.max(0, Math.floor(((ms - start) / 1000) * cps));
      el.textContent = el.__mgFull.slice(0, Math.min(el.__mgFull.length, shown));
    }
  }

  // Counters: <span data-count-to="42" data-count-start="800" data-count-dur="1200">0</span>
  function counters(ms) {
    var els = document.querySelectorAll('[data-count-to]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var to = parseFloat(el.getAttribute('data-count-to') || '0');
      var from = parseFloat(el.getAttribute('data-count-from') || '0');
      var start = startOf(el, 'data-count-start-frac', 'data-count-start');
      var dur = Math.max(1, parseFloat(el.getAttribute('data-count-dur') || '1200'));
      var dec = parseInt(el.getAttribute('data-count-decimals') || '0', 10);
      var p = Math.min(1, Math.max(0, (ms - start) / dur));
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      var v = from + (to - from) * eased;
      el.textContent = v.toLocaleString('en-US', {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      });
    }
  }

  /** THE time source. Returns true so the harness can assert the call landed. */
  window.__seek = function (ms) {
    pauseAll();
    var anims = [];
    try { anims = document.getAnimations({ subtree: true }); } catch (e) {}
    for (var i = 0; i < anims.length; i++) {
      try { anims[i].currentTime = ms; } catch (e) {}
    }
    var svgs = document.querySelectorAll('svg');
    for (var j = 0; j < svgs.length; j++) {
      try { if (svgs[j].setCurrentTime) svgs[j].setCurrentTime(ms / 1000); } catch (e) {}
    }
    document.documentElement.style.setProperty('--t', String(ms));
    typewriter(ms);
    counters(ms);
    for (var k = 0; k < hooks.length; k++) {
      try { hooks[k](ms); } catch (e) {}
    }
    return true;
  };

  /**
   * Seeded particle scatter — the sanctioned way to fill a sky/field with dots
   * DETERMINISTICALLY (Math.random would differ between the render and the QC
   * spot-frame reload). Runs once at load; each dot is one animated element, so
   * respect the budget: count ≤ 150 keeps capture fast.
   *   __mgScatter('stars', { count: 120, seed: 7, className: 'mg-dot' })
   */
  window.__mgScatter = function (hostId, opts) {
    var host = document.getElementById(hostId);
    if (!host) return;
    var o = opts || {};
    var count = Math.min(150, o.count || 100);
    var seed = (o.seed || 42) >>> 0;
    function rnd() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    var f = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var d = document.createElement('div');
      d.className = o.className || 'mg-dot';
      d.style.left = (rnd() * 100).toFixed(2) + 'vw';
      d.style.top = (rnd() * 100).toFixed(2) + 'vh';
      d.style.setProperty('--sz', (1 + rnd() * 3).toFixed(1) + 'px');
      d.style.setProperty('--dur', (2.5 + rnd() * 4).toFixed(2) + 's');
      d.style.setProperty('--at', '-' + (rnd() * 6).toFixed(2) + 's'); // negative delay = phase offset
      d.style.setProperty('--o0', (0.1 + rnd() * 0.3).toFixed(2));
      f.appendChild(d);
    }
    host.appendChild(f);
  };

  /**
   * Kinetic-type word splitter: any element with class .mg-words gets its text split into
   * <span class="w" style="--w:N"> spans once at load, so words reveal one by one
   * (CSS .mg-words .w staggers by --w). Deterministic — pure DOM restructuring at load,
   * before any seek. Idempotent via a marker property.
   */
  function splitWords() {
    var els = document.querySelectorAll('.mg-words');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__mgSplit) continue;
      el.__mgSplit = true;
      var words = (el.textContent || '').trim().split(/\s+/).filter(Boolean);
      el.textContent = '';
      for (var w = 0; w < words.length; w++) {
        var s = document.createElement('span');
        s.className = 'w';
        s.style.setProperty('--w', String(w));
        s.textContent = words[w] + (w < words.length - 1 ? ' ' : '');
        el.appendChild(s);
      }
    }
  }

  window.__motionReady = true;
  splitWords();
  if (document.readyState === 'complete') pauseAll();
  else window.addEventListener('load', function () { splitWords(); pauseAll(); });
})();
