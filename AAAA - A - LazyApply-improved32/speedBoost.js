/*
 * Speed Boost — shortens the fixed pauses the automation scripts take between
 * steps (click, wait 2s, type, wait 1s, ...).
 *
 * Runs first in the extension's own script world on job sites, so only the
 * extension's timers are touched, never the page's.
 *
 *  - Pauses of 250 ms – 3 s are multiplied by a per-site factor.
 *  - Shorter timers (polling) and longer ones (safety timeouts, "give up
 *    after 15 s") are left exactly as they are.
 *  - Sites that challenge fast robots (LinkedIn, Indeed, Glassdoor, ...) get
 *    a gentler factor than plain application forms.
 *
 * To change the speed, set `lazySpeedFactor` in chrome.storage.local:
 * 1 = original speed, 0.5 = pauses halved. Values are kept within 0.35 – 1.
 */
(function () {
  "use strict";
  if (window.__lazySpeedBoost) return;
  window.__lazySpeedBoost = true;

  const host = location.hostname;
  const SIMPLE_FORMS = /(greenhouse\.io|lever\.co|ashbyhq\.com|rippling\.com|vivahr\.com|wellfound\.com)$/i;
  const ACCOUNT_FORMS = /(myworkdayjobs\.com|icims\.com)$/i;
  const DEFAULT_FACTOR = SIMPLE_FORMS.test(host) ? 0.5 : ACCOUNT_FORMS.test(host) ? 0.65 : 0.8;

  const MIN_SCALED = 250; // pauses shorter than this are not touched
  const MAX_SCALED = 3000; // pauses longer than this are not touched
  const FLOOR = 200; // a scaled pause is never shorter than this

  let factor = DEFAULT_FACTOR;
  const clamp = (v) => Math.min(1, Math.max(0.35, v));

  try {
    chrome.storage.local.get("lazySpeedFactor", (r) => {
      if (chrome.runtime.lastError) return;
      const v = Number(r && r.lazySpeedFactor);
      // The user's value is the speed on simple forms; other sites keep
      // their extra caution on top of it.
      if (v > 0) factor = clamp(v * (DEFAULT_FACTOR / 0.5));
    });
  } catch (e) {}

  const nativeSetTimeout = window.setTimeout;

  window.setTimeout = function (fn, delay) {
    if (typeof delay === "number" && delay >= MIN_SCALED && delay <= MAX_SCALED && factor < 1) {
      const args = Array.prototype.slice.call(arguments);
      args[1] = Math.max(FLOOR, Math.round(delay * factor));
      return nativeSetTimeout.apply(window, args);
    }
    return nativeSetTimeout.apply(window, arguments);
  };

  // Is anything on the page visibly still working (upload, spinner)?
  const BUSY =
    '[aria-busy="true"], [role="progressbar"], progress, ' +
    '[class*="uploading" i], [class*="spinner" i], [class*="loading" i], [class*="progress" i]';
  function pageBusy() {
    try {
      for (const el of document.querySelectorAll(BUSY)) {
        const r = el.getBoundingClientRect();
        if (r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden") return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * Used in place of a long fixed pause: waits at least `minMs`, then returns
   * as soon as the page has looked idle for a full second, and never waits
   * longer than `maxMs` (the pause it replaces).
   */
  window.__lazySettle = function (minMs, maxMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      let quietSince = 0;
      (function tick() {
        const now = Date.now();
        const waited = now - started;
        if (waited >= maxMs) return resolve();
        if (pageBusy()) quietSince = 0;
        else if (!quietSince) quietSince = now;
        if (waited >= minMs && quietSince && now - quietSince >= 1000) return resolve();
        nativeSetTimeout(tick, 200);
      })();
    });
  };
})();
