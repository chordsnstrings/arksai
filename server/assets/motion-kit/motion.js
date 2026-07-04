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

  // Typewriter: remember each element's full text once, then slice by time.
  function typewriter(ms) {
    var els = document.querySelectorAll('[data-typewriter]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__mgFull === undefined) el.__mgFull = el.textContent || '';
      var start = parseFloat(el.getAttribute('data-tw-start') || '0');
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
      var start = parseFloat(el.getAttribute('data-count-start') || '0');
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

  window.__motionReady = true;
  if (document.readyState === 'complete') pauseAll();
  else window.addEventListener('load', pauseAll);
})();
