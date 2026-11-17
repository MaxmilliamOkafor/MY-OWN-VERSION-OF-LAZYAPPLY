/*
 * What happened to every job of a run.
 *
 * LazyApply's results screen only counts "completed" jobs and the ones in
 * failedLinks. Jobs skipped (closed / expired page, stuck, not an application
 * page), timed out, submitted without a confirmation page, or never reached
 * were counted nowhere, so "26/114, Successful 26, Failed 4" left 84 jobs
 * unexplained. build() gives each job one outcome and a reason; the results
 * sent to the dashboard then add up to the total, and the full list is kept in
 * chrome.storage.local "lazyLastRun" for the breakdown card (runReportCard.js).
 *
 * Loaded by background.js (importScripts) and by the tests.
 */
(function (g) {
  "use strict";
  if (g.LazyRunReport) return;

  const OUTCOMES = {
    applied: "Applied",
    unconfirmed: "Submit clicked, no confirmation seen",
    failed: "Failed",
    closed: "Job closed or gone",
    stuck: "Stuck, skipped",
    timeout: "Took too long",
    redirected: "Not an application page",
    skipped: "Skipped",
    not_reached: "Not reached",
  };

  const str = (v, n) => String(v == null ? "" : v).slice(0, n || 200);
  function byUrl(list) {
    const m = new Map();
    for (const e of Array.isArray(list) ? list : []) if (e && e.url) m.set(e.url, e);
    return m;
  }

  function classify(link, lists) {
    const s = link.status;
    const cs = link.currentState || "";
    const sk = lists.skipped.get(link.url) || {};
    const to = lists.timedOut.get(link.url);
    const fl = lists.failed.get(link.url);
    if (s === "completed") return { outcome: "applied", reason: "" };
    if (s === "submit_clicked") return { outcome: "unconfirmed", reason: "Submit was clicked, but no confirmation page or message was seen." };
    if (s === "failed" || fl) return { outcome: "failed", reason: str((fl && (fl.error || fl.stage)) || link.error || "Error while filling the form") };
    if (s === "timeout" || to) return { outcome: "timeout", reason: "Open longer than the job timeout." };
    if (s === "expired" || cs === "button_not_found") return { outcome: "closed", reason: "No Apply button on the job page (job closed or expired)." };
    const why = str(sk.reason || link.error || "");
    if (/^Stuck/i.test(why)) return { outcome: "stuck", reason: why.replace(/^Stuck:\s*/i, "") };
    if (/not allowed|redirect/i.test(why) || cs === "redirected") return { outcome: "redirected", reason: "The link went to a page that is not an application form (" + str(link.lastUrl || "company site, sign-in or job board", 80) + ")." };
    if (/not found|closed|gone|removed|expired/i.test(why)) return { outcome: "closed", reason: why };
    if (s === "skipped") return { outcome: "skipped", reason: why || "Skipped by the automation." };
    if (!s || s === "pending") return { outcome: "not_reached", reason: "The run ended before this job." };
    return { outcome: "skipped", reason: why || "Status: " + str(s, 40) };
  }

  /** {at, total, counts:{outcome:n}, reasons:{outcome:{reason:n}}, rows:[...]} */
  function build(state, extra) {
    state = state || {};
    const links = Array.isArray(state.links) ? state.links : [];
    const lists = { skipped: byUrl(state.skippedLinks), timedOut: byUrl(state.timedOutLinks), failed: byUrl(state.failedLinks) };
    const counts = {}, reasons = {}, rows = [];
    for (const k of Object.keys(OUTCOMES)) counts[k] = 0;
    for (const link of links) {
      if (!link) continue;
      const c = classify(link, lists);
      counts[c.outcome]++;
      if (c.reason) {
        const r = (reasons[c.outcome] = reasons[c.outcome] || {});
        const key = c.reason.replace(/\s*\(.*\)\.?$/, "").slice(0, 120);
        r[key] = (r[key] || 0) + 1;
      }
      rows.push({ title: str(link.title, 120), company: str(link.companyName || link.company, 80), url: str(link.url, 400), board: str(link.jobBoard || link.platform, 30), outcome: c.outcome, reason: c.reason });
    }
    return Object.assign({ at: Date.now(), total: links.length, counts, reasons, rows, labels: OUTCOMES }, extra || {});
  }

  /** Every job that was not applied, as failedLinks entries with the reason, so the dashboard's numbers add up. */
  function failedForDashboard(report, original) {
    const out = [];
    const seen = new Set();
    for (const e of Array.isArray(original) ? original : []) if (e && e.url) { out.push(e); seen.add(e.url); }
    for (const r of report.rows) {
      if (r.outcome === "applied" || seen.has(r.url)) continue;
      out.push({ url: r.url, error: OUTCOMES[r.outcome] + (r.reason ? ": " + r.reason : ""), stage: r.outcome, title: r.title });
    }
    return out;
  }

  g.LazyRunReport = { build, classify, failedForDashboard, OUTCOMES };
  if (typeof module !== "undefined" && module.exports) module.exports = g.LazyRunReport;
})(typeof self !== "undefined" ? self : globalThis);
