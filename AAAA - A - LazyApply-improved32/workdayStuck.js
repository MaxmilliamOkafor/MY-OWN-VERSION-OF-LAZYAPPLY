/*
 * Workday only: leave an application that is stuck, so no time is wasted on it.
 *
 * Runs on every Workday page (job, apply steps, sign-in, create account) and
 * checks it every 3 s. The background only acts when the message comes from
 * the tab of a running, unpaused automation, so it does nothing otherwise.
 *
 * Progress = the address, the step, the heading, the fields shown, or anything
 * typed into them changing. The job is left:
 *  - after 8 s on a dead end (error page, job closed, "verify your email",
 *    locked account);
 *  - on a sign-in / create-account screen: after 30 s there in total (typing
 *    the same email and password again is not progress), or 10 s with the
 *    same sign-in error shown;
 *  - after 25 s with the same error message on screen and nothing changing;
 *  - after 45 s with no progress at all.
 * Pressing keys or clicking in the page yourself holds it off for 60 s.
 *
 * Greenhouse, Lever, Ashby, iCIMS, Rippling, SmartRecruiters: only one rule.
 * When a required question is still empty after the form was filled ("This
 * field is required" shown) and nothing changes for 20 s, the job is left
 * instead of waiting for the run's long timeout. Anything else on those sites
 * keeps the normal timeout.
 */
(function () {
  "use strict";
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (g.__lazyStuck) return;

  const STUCK = { tick: 3000, stall: 45000, error: 25000, dead: 8000, auth: 30000, authError: 10000, hands: 60000, required: 20000 };
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

  // One check: returns why to skip, or "". `s` carries the timers between checks.
  function step(s, p, now) {
    if (p.key !== s.key) { s.key = p.key; s.moved = now; s.errSince = null; s.deadSince = null; }
    if (p.submitted) { s.moved = now; s.authSince = null; return ""; }
    if (p.auth) { if (s.authSince == null) s.authSince = now; } else s.authSince = null;
    if (now - s.hands < STUCK.hands) return "";
    if (p.dead) { if (s.deadSince == null) s.deadSince = now; if (now - s.deadSince >= STUCK.dead) return p.dead; } else s.deadSince = null;
    if (p.errors) {
      if (p.errors !== s.errText) { s.errText = p.errors; s.errSince = now; }
      if (p.auth && now - s.errSince >= STUCK.authError) return "sign-in / sign-up error: " + p.errors.slice(0, 80);
      if (now - Math.max(s.errSince, s.moved) >= STUCK.error) return "same error for 25 s: " + p.errors.slice(0, 80);
    } else { s.errText = ""; s.errSince = null; }
    if (p.auth && now - s.authSince >= STUCK.auth) return "stuck on sign-in / create account for 30 s";
    if (now - s.moved >= STUCK.stall) return "no progress for 45 s";
    return "";
  }

  // Greenhouse, Lever, ... : leave a job whose required question stays empty.
  function stepOther(s, p, now) {
    if (p.key !== s.key) { s.key = p.key; s.moved = now; s.errSince = null; }
    if (p.submitted) { s.moved = now; return ""; }
    if (now - s.hands < STUCK.hands) return "";
    if (!p.required) { s.errText = ""; s.errSince = null; return ""; }
    if (p.required !== s.errText) { s.errText = p.required; s.errSince = now; }
    if (now - Math.max(s.errSince, s.moved) >= STUCK.required) return "required question left unanswered: " + p.required.slice(0, 100);
    return "";
  }

  function fresh(now) {
    return { key: "", moved: now, errText: "", errSince: null, deadSince: null, authSince: null, hands: -Infinity, sent: false };
  }

  function watch() {
    const wd = WD_HOST.test(location.hostname);
    const other = !wd && OTHER_HOST.test(location.hostname);
    if (!(wd && g.top === g) && !other) return; // Greenhouse forms may sit in a frame
    const site = (SITE_NAME.find(([re]) => re.test(location.hostname)) || [0, "The job site"])[1];
    const s = fresh(Date.now());
    const touch = (e) => { if (e.isTrusted) s.hands = Date.now(); };
    ["keydown", "mousedown", "touchstart"].forEach((t) => document.addEventListener(t, touch, true));
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
            Object.assign(s, fresh(Date.now()), { hands: s.hands });
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
