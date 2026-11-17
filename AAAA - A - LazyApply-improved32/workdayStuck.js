/*
 * Workday only: leave an application that is stuck, so no time is wasted on it.
 *
 * Runs on every Workday page (job, apply steps, sign-in, create account) and
 * checks it every 3 s. The background only acts when the message comes from
 * the tab of a running, unpaused automation, so it does nothing otherwise.
 *
 * Progress = the page reaching a state it has not been in before: a new
 * address, step, heading, set of fields or values. Going back to a state
 * already seen (typing the same school again and again) is not progress.
 *
 * "Busy" = the automation itself working the page (its clicks, typing and
 * key presses are script events, isTrusted false). While it is busy the short
 * timers wait: it is reading dropdown options or waiting for answers, which
 * changes nothing on screen. (Before, about two in three skipped jobs were
 * left while the automation was still filling them in.) Each rule also has a
 * hard limit that applies even while busy, so a loop is still left.
 *
 * The job is left:
 *  - after 8 s on a dead end (error page, job closed, "verify your email",
 *    locked account);
 *  - on a sign-in / create-account screen: after 30 s there with the
 *    automation idle, or 120 s there in total; with the same sign-in error
 *    shown for 12 s while idle, or 45 s in total ("wrong email or password"
 *    is normal before an account is created, so it gets time to do that);
 *  - with the same error message on screen: 25 s idle, or 90 s in total;
 *  - with no progress: 45 s idle, or 150 s in total.
 * Pressing keys or clicking in the page yourself holds it off for 60 s.
 *
 * Greenhouse, Lever, Ashby, iCIMS, Rippling, SmartRecruiters: only one rule.
 * When a required question is still empty after the form was filled ("This
 * field is required" shown) and nothing changes for 20 s while the automation
 * is idle (75 s in total), the job is left instead of waiting for the run's
 * long timeout. Anything else on those sites keeps the normal timeout.
 */
(function () {
  "use strict";
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (g.__lazyStuck) return;

  const STUCK = {
    tick: 3000,
    stall: 45000, stallMax: 150000,
    error: 25000, errorMax: 90000,
    dead: 8000,
    auth: 30000, authMax: 120000,
    authError: 12000, authErrorMax: 45000,
    hands: 60000,
    required: 20000, requiredMax: 75000,
    seenMax: 200,
  };
  const WD_HOST = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/i;
  const OTHER_HOST = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|icims\.com|rippling\.com|smartrecruiters\.com)$/i;
  const SITE_NAME = [[/greenhouse/i, "Greenhouse"], [/lever/i, "Lever"], [/ashby/i, "Ashby"], [/icims/i, "iCIMS"], [/rippling/i, "Rippling"], [/smartrecruiters/i, "SmartRecruiters"], [/workday/i, "Workday"]];
  const REQUIRED_RE = /\b(this field is required|field is required|is required|required field|please (fill|complete|select|answer|choose|enter)|can['’]?t be blank|cannot be blank|must be (selected|answered|filled))\b/i;
  const DEAD_END = [
    [/something went wrong|an (unexpected )?error (has )?occurred|we('re| are) (sorry|unable)[^.]{0,40}(error|problem)|service (is )?(temporarily )?unavailable/i, "Workday error page"],
    [/the page you are looking for doesn['’]t exist|this job (posting )?is no longer available|job (is )?(closed|no longer accepting)/i, "job no longer open"],
    [/verify your (email|account)|(we('ve)?|has been) sent (you )?an? (verification|confirmation) (email|link|code)|check your (email|inbox) (to|for) (verify|activate|confirm)/i, "email verification needed"],
    [/account (is |has been )?locked|too many (failed |unsuccessful )?(sign[- ]?in |login )?attempts|session (has )?(expired|timed out)/i, "sign-in blocked"],
  ];
  const SUBMITTED = /application (has been |was )?(successfully )?submitted|thank you for (applying|your application)|you('ve| have) (already )?applied/i;
  const AUTH_IDS = '[data-automation-id="signInContent"],[data-automation-id="createAccountContent"],[data-automation-id="signInSubmitButton"],[data-automation-id="createAccountSubmitButton"],[data-automation-id="signInLink"],[data-automation-id="createAccountLink"]';

  function probe(doc) {
    doc = doc || document;
    const loc = (doc.defaultView && doc.defaultView.location) || location;
    const vis = (el) => !!(el && (el.offsetParent || (el.getClientRects && el.getClientRects().length)));
    const q = (s) => Array.prototype.filter.call(doc.querySelectorAll(s), vis);
    const text = (s) => q(s).map((e) => (e.innerText || e.textContent || "").trim()).join(" | ").slice(0, 300);
    const fields = q("input:not([type=hidden]),textarea,select,[role=combobox],[data-automation-id*=selectedItem]");
    let filled = 0, len = 0;
    for (const f of fields) {
      const v = f.value != null ? String(f.value) : (f.textContent || "");
      if (v.trim() || f.checked) filled++;
      len += Math.min(v.length, 200);
    }
    const body = ((doc.body && doc.body.innerText) || "").slice(0, 6000);
    const heads = text("h1,h2,h3").slice(0, 160);
    const auth = q(AUTH_IDS).length > 0 || q('input[type="password"]').length > 0 || /^(sign in|create account|sign up|log in)\b/im.test(heads);
    const errors = text('[data-automation-id="errorBanner"],[data-automation-id="errorMessage"],[data-automation-id*="inputAlert"],[role="alert"]');
    // Required questions still empty: the field's label for each error shown.
    const required = [];
    for (const el of q('[aria-invalid="true"],.helper-text--error,[class*="error"],[id$="-error"],[role="alert"]')) {
      const t = (el.innerText || el.textContent || "").trim();
      if (el.getAttribute("aria-invalid") !== "true" && !(t.length < 140 && REQUIRED_RE.test(t))) continue;
      const box = el.closest(".field-wrapper, .select, .application-question, .input-wrapper, fieldset, li, [class*='question'], [class*='field']") || el.parentElement;
      const lab = box && box.querySelector("label, legend");
      required.push(((lab && (lab.innerText || lab.textContent)) || t).trim().slice(0, 60));
    }
    let dead = "";
    for (const [re, why] of DEAD_END) if (re.test(body)) { dead = why; break; }
    const base = [loc.pathname, loc.hash, text('[data-automation-id="progressBarActiveStep"],[aria-current="step"]'), heads, fields.length];
    return {
      // On sign-in screens retyping the same details is not progress.
      key: (auth ? base : base.concat([filled, len])).join("¦"),
      auth,
      errors,
      dead,
      required: Array.from(new Set(required)).join(" | ").slice(0, 200),
      submitted: SUBMITTED.test(body),
    };
  }

  // A page state counts as progress only the first time it is seen.
  function progressed(s, p, now) {
    if (p.key === s.key) return false;
    s.key = p.key;
    if (!s.seen) s.seen = new Set();
    if (s.seen.has(p.key)) return false; // back to a state already seen: a loop
    if (s.seen.size >= STUCK.seenMax) s.seen.clear();
    s.seen.add(p.key);
    s.moved = now;
    return true;
  }
  const secs = (ms) => Math.round(ms / 1000) + " s";

  // One check: returns why to skip, or "". `s` carries the timers between checks.
  function step(s, p, now) {
    if (progressed(s, p, now)) { s.errSince = null; s.deadSince = null; }
    if (p.submitted) { s.moved = now; s.authSince = null; return ""; }
    if (p.auth) { if (s.authSince == null) s.authSince = now; } else s.authSince = null;
    if (now - s.hands < STUCK.hands) return "";
    const busy = s.busy || -Infinity;
    if (p.dead) { if (s.deadSince == null) s.deadSince = now; if (now - s.deadSince >= STUCK.dead) return p.dead; } else s.deadSince = null;
    if (p.errors) {
      if (p.errors !== s.errText) { s.errText = p.errors; s.errSince = now; }
      if (p.auth) {
        if (now - Math.max(s.errSince, busy) >= STUCK.authError) return "sign-in / sign-up error: " + p.errors.slice(0, 80);
        if (now - s.errSince >= STUCK.authErrorMax) return "sign-in / sign-up error for " + secs(STUCK.authErrorMax) + ": " + p.errors.slice(0, 80);
      } else {
        const since = Math.max(s.errSince, s.moved);
        if (now - Math.max(since, busy) >= STUCK.error) return "same error for " + secs(STUCK.error) + ": " + p.errors.slice(0, 80);
        if (now - since >= STUCK.errorMax) return "same error for " + secs(STUCK.errorMax) + ": " + p.errors.slice(0, 80);
      }
    } else { s.errText = ""; s.errSince = null; }
    if (p.auth) {
      if (now - Math.max(s.authSince, busy) >= STUCK.auth) return "stuck on sign-in / create account for " + secs(STUCK.auth);
      if (now - s.authSince >= STUCK.authMax) return "stuck on sign-in / create account for " + secs(STUCK.authMax);
    }
    if (now - Math.max(s.moved, busy) >= STUCK.stall) return "no progress for " + secs(STUCK.stall);
    if (now - s.moved >= STUCK.stallMax) return "no progress for " + secs(STUCK.stallMax) + " (repeating the same steps)";
    return "";
  }

  // Greenhouse, Lever, ... : leave a job whose required question stays empty.
  function stepOther(s, p, now) {
    if (progressed(s, p, now)) s.errSince = null;
    if (p.submitted) { s.moved = now; return ""; }
    if (now - s.hands < STUCK.hands) return "";
    if (!p.required) { s.errText = ""; s.errSince = null; return ""; }
    if (p.required !== s.errText) { s.errText = p.required; s.errSince = now; }
    const since = Math.max(s.errSince, s.moved);
    if (now - Math.max(since, s.busy || -Infinity) >= STUCK.required) return "required question left unanswered: " + p.required.slice(0, 100);
    if (now - since >= STUCK.requiredMax) return "required question left unanswered for " + secs(STUCK.requiredMax) + ": " + p.required.slice(0, 100);
    return "";
  }

  function fresh(now) {
    return { key: "", seen: new Set(), moved: now, busy: -Infinity, errText: "", errSince: null, deadSince: null, authSince: null, hands: -Infinity, sent: false };
  }

  function watch() {
    const wd = WD_HOST.test(location.hostname);
    const other = !wd && OTHER_HOST.test(location.hostname);
    if (!(wd && g.top === g) && !other) return; // Greenhouse forms may sit in a frame
    const site = (SITE_NAME.find(([re]) => re.test(location.hostname)) || [0, "The job site"])[1];
    const s = fresh(Date.now());
    const touch = (e) => { if (e.isTrusted) s.hands = Date.now(); };
    ["keydown", "mousedown", "touchstart"].forEach((t) => document.addEventListener(t, touch, true));
    // The automation's own clicks / typing (script events) mean it is busy.
    const work = (e) => { if (!e.isTrusted) s.busy = Date.now(); };
    ["click", "input", "change", "keydown", "mousedown", "mouseup", "focusin"].forEach((t) => document.addEventListener(t, work, true));
    const timer = setInterval(() => {
      if (s.sent) return;
      let why = "";
      try { why = (wd ? step : stepOther)(s, probe(document), Date.now()); } catch (e) { return; }
      if (!why) return;
      s.sent = true;
      try { if (self.__lazyDbg) { self.__lazyDbg.log("stuck", "warn", site + " stuck, asking to skip: " + why); self.__lazyDbg.snapshot("Stuck: " + why); self.__lazyDbg.flush(); } } catch (e) {}
      try {
        chrome.runtime.sendMessage({ type: "LAZY_STUCK_SKIP", reason: why, site, url: location.href.slice(0, 300) }, (r) => {
          void chrome.runtime.lastError;
          if (r && r.skipped) {
            clearInterval(timer);
          } else {
            // Paused, or not a run's tab: start counting again.
            Object.assign(s, fresh(Date.now()), { hands: s.hands, busy: s.busy });
          }
        });
      } catch (e) {
        clearInterval(timer); // the extension was reloaded
      }
    }, STUCK.tick);
  }

  g.__lazyStuck = { probe, step, stepOther, fresh, STUCK };
  try { watch(); } catch (e) {}
})();
