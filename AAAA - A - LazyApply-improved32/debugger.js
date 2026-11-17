/*
 * Debugger page: reads what debugRecorder.js / debugHook.js recorded
 * (IndexedDB "lazyDebug"), works out for each job why it ended the way it did,
 * and exports a report to fix from.
 */
(function () {
  "use strict";
  const C = self.__lazyDbgCore;
  const RR = self.LazyRunReport;
  const $ = (id) => document.getElementById(id);
  const DB = "lazyDebug", STORE = "ev";
  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

  // ---------------------------------------------------------------- data --
  let db = null;
  function openDb() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          s.createIndex("run", "run");
          s.createIndex("ts", "ts");
        }
      };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function store(mode) { return (await openDb()).transaction(STORE, mode || "readonly").objectStore(STORE); }
  async function byRun(run) { return req2p((await store()).index("run").getAll(run)); }
  async function byTime(a, b) { return (await req2p((await store()).index("ts").getAll(IDBKeyRange.bound(a, b)))).filter((e) => !e.run); }
  async function since(id) { return req2p((await store()).getAll(IDBKeyRange.lowerBound(id, true))); }
  async function everything() { return req2p((await store()).getAll()); }
  async function total() { return req2p((await store()).count()); }
  // Each list is read in one transaction, with plain callbacks (a transaction
  // closes as soon as the code waits on anything else).
  async function listRuns() {
    const d = await openDb();
    return new Promise((res) => {
      const idx = d.transaction(STORE).objectStore(STORE).index("run");
      const keys = [];
      const c = idx.openKeyCursor(null, "nextunique");
      c.onerror = () => res([]);
      c.onsuccess = () => {
        const k = c.result;
        if (k) { keys.push(k.key); return k.continue(); }
        keys.sort().reverse();
        const pick = keys.slice(0, 80);
        const out = pick.map((run) => ({ run, n: 0, start: 0, end: 0, title: "" }));
        let left = pick.length * 3;
        if (!left) return res(out);
        const done = () => { if (--left === 0) res(out); };
        pick.forEach((run, i) => {
          const r = IDBKeyRange.only(run);
          const a = idx.count(r);
          a.onsuccess = () => { out[i].n = a.result; done(); };
          a.onerror = done;
          const b = idx.openCursor(r);
          b.onsuccess = () => { const v = b.result && b.result.value; if (v) { out[i].start = v.ts; out[i].title = v.msg; } done(); };
          b.onerror = done;
          const e = idx.openCursor(r, "prev");
          e.onsuccess = () => { const v = e.result && e.result.value; if (v) out[i].end = v.ts; done(); };
          e.onerror = done;
        });
      };
    });
  }
  async function listDays() {
    const d = await openDb();
    return new Promise((res) => {
      const idx = d.transaction(STORE).objectStore(STORE).index("ts");
      const f = idx.openCursor();
      f.onerror = () => res([]);
      f.onsuccess = () => {
        const first = f.result && f.result.value;
        if (!first) return res([]);
        const d0 = new Date(); d0.setHours(0, 0, 0, 0);
        const days = [];
        for (let i = 0; i < 21; i++) { const a = d0.getTime() - i * 86400000; if (a + 86400000 < first.ts) break; days.push(a); }
        const out = days.map((day) => ({ day, n: 0 }));
        let left = days.length;
        if (!left) return res([]);
        days.forEach((a, i) => {
          const q = idx.count(IDBKeyRange.bound(a, a + 86399999));
          q.onsuccess = () => { out[i].n = q.result; if (--left === 0) res(out.filter((x) => x.n)); };
          q.onerror = () => { if (--left === 0) res(out.filter((x) => x.n)); };
        });
      };
    });
  }

  // ------------------------------------------------------------ analysis --
  const norm = (s) => String(s || "").replace(/https?:\/\/([^/\s"')]+)[^\s"')]*/g, "$1").replace(/"[^"]{0,160}"/g, '"…"').replace(/\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 160);
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } };
  const where = (stack) => {
    const m = String(stack || "").match(/(?:chrome-extension:\/\/[^/]+\/|\/)([\w.-]+\.js):(\d+):(\d+)/);
    return m ? m[1] + ":" + m[2] + ":" + m[3] : "";
  };
  const fmtDur = (ms) => { if (!(ms >= 0)) return "?"; const s = Math.round(ms / 1000); return s < 60 ? s + "s" : s < 3600 ? Math.floor(s / 60) + "m " + (s % 60) + "s" : Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m"; };

  function diagnoseJob(j) {
    const ev = j.events;
    const lists = { skipped: new Map(), timedOut: new Map(), failed: new Map() };
    if (j.reason && /skip|stuck|not allowed|closed|gone/i.test(j.listKind || "skipped")) lists.skipped.set(j.url, { reason: j.reason });
    if (j.listKind === "timedOut") lists.timedOut.set(j.url, {});
    if (j.listKind === "failed") lists.failed.set(j.url, { error: j.reason });
    const cls = RR.classify({ url: j.url, status: j.status, currentState: j.currentState, error: j.error, lastUrl: j.lastUrl }, lists);
    const outcome = j.status || j.listKind ? cls.outcome : ev.length ? "unknown" : "not_reached";
    const pageMsgs = [...new Set(ev.filter((e) => e.cat === "page" && /^Page shows: /.test(e.msg)).map((e) => e.msg.slice(12)))];
    const snaps = ev.filter((e) => e.cat === "snapshot" && e.data);
    const snap = snaps.length ? snaps[snaps.length - 1].data : null;
    const stuck = ev.filter((e) => e.cat === "stuck");
    const noAns = ev.filter((e) => e.cat === "ai" && e.lvl === "warn").map((e) => (e.msg.match(/"([^"]+)"/) || [])[1]).filter(Boolean);
    const errs = ev.filter((e) => e.lvl === "error" && e.cat !== "job");
    const netBad = ev.filter((e) => (e.cat === "net" || e.cat === "ai") && (e.lvl === "error" || e.lvl === "warn"));
    const lazyBad = netBad.filter((e) => /lazyapply\.com/.test(e.msg + " " + (e.url || "")));
    const navErr = ev.filter((e) => e.cat === "nav" && e.lvl === "error");
    const skips = ev.filter((e) => e.cat === "skip");
    const navs = ev.filter((e) => e.cat === "nav" && /^(Page opened|Address changed|Load in)/.test(e.msg));
    const lastNav = navs.length ? navs[navs.length - 1] : null;
    const actions = ev.filter((e) => e.cat === "field" || (e.cat === "dom" && e.lvl === "info"));
    const lastAction = actions.length ? actions[actions.length - 1] : null;
    const endTs = j.end || (ev.length ? ev[ev.length - 1].ts : 0);
    const details = [];
    let primary = (RR.OUTCOMES[outcome] || outcome) + (cls.reason && outcome !== "applied" ? ": " + cls.reason : "");
    if (outcome === "closed" && skips.length) primary = "Job closed or gone: " + skips[skips.length - 1].msg.replace(/^Skipped:\s*/, "");
    if (outcome === "redirected") primary = "Not an application page: went to " + (hostOf(j.lastUrl || (lastNav && lastNav.msg.replace(/^.*?(https?:\/\/\S+).*$/, "$1"))) || "another site");
    if (outcome === "stuck" && stuck.length) primary = "Stuck: " + stuck[stuck.length - 1].msg.replace(/^.*asking to skip:\s*/, "");
    if (outcome === "timeout") primary = "Took too long" + (lastAction ? " — last action " + fmtDur(endTs - lastAction.ts) + " before the timeout: " + lastAction.msg.slice(0, 120) : " — the automation never acted on the page");
    if (outcome === "unknown") primary = "No outcome recorded (the run may have stopped here)";
    const secondary = [];
    if (snap && snap.requiredEmpty && snap.requiredEmpty.length) secondary.push("required and empty: " + snap.requiredEmpty.slice(0, 5).join(" | "));
    if (noAns.length) secondary.push("no answer for: " + [...new Set(noAns)].slice(0, 4).join(" | "));
    if (pageMsgs.length) secondary.push("page showed: " + pageMsgs.slice(-3).join(" | "));
    if (errs.length) secondary.push("error: " + errs[0].msg.slice(0, 160) + (where(errs[0].data && errs[0].data.stack) ? " @ " + where(errs[0].data.stack) : ""));
    if (lazyBad.length) secondary.push("LazyApply server: " + lazyBad[lazyBad.length - 1].msg.slice(0, 120));
    if (navErr.length) secondary.push(navErr[0].msg.slice(0, 160));
    if (outcome !== "applied") details.push(...secondary);
    if (snap && outcome !== "applied") {
      if (snap.errors && snap.errors.length) details.push("errors on the page at the end: " + snap.errors.slice(0, 5).join(" | "));
      details.push("last page: " + (snap.heading ? snap.heading + " — " : "") + (snap.url || ""));
    }
    const cause = outcome === "applied" ? "Applied" : primary + (secondary.length ? " — " + secondary[0] : "");
    const sig = outcome + "|" + norm(primary.replace(/ — last action.*$/, "")) + (secondary.length ? "|" + norm(secondary[0].replace(/:.*$/, "")) : "");
    const notDebug = ev.filter((e) => e.lvl !== "debug");
    return { outcome, cause, sig, details, errs, snap, lastEvents: (notDebug.length >= 10 ? notDebug : ev).slice(-30), duration: j.start ? endTs - j.start : 0, actions: actions.length, pageMsgs, noAns };
  }

  function analyzeRun(events) {
    const jobs = new Map();
    let totalJobs = 0;
    const get = (i) => { if (!jobs.has(i)) jobs.set(i, { idx: i, url: "", title: "", events: [], start: 0, end: 0 }); return jobs.get(i); };
    for (const e of events) {
      if (e.cat === "run") { const m = /^Run started: (\d+)/.exec(e.msg); if (m) totalJobs = +m[1]; }
      if (e.job == null || e.job < 0) continue;
      const j = get(e.job);
      j.events.push(e);
      if (!j.title && e.jt) j.title = e.jt;
      if (!j.url && e.jurl) j.url = e.jurl;
      if (e.cat !== "job") continue;
      if (/ started: /.test(e.msg)) { if (!j.start) j.start = e.ts; if (e.data && e.data.url) j.url = e.data.url; }
      if (e.data && e.data.status) { j.status = e.data.status; j.currentState = e.data.currentState; j.error = e.data.error; if (e.data.lastUrl) j.lastUrl = e.data.lastUrl; j.end = e.ts; }
      const lm = / → (failed|skipped|timedOut)(?::\s*(.*?))?(?: \[stage .*\])?$/.exec(e.msg);
      if (lm) { j.listKind = lm[1]; j.reason = (e.data && (e.data.reason || e.data.error)) || lm[2] || ""; j.end = j.end || e.ts; }
    }
    if (!totalJobs) totalJobs = jobs.size ? Math.max(...jobs.keys()) + 1 : 0;
    const list = [...jobs.values()].sort((a, b) => a.idx - b.idx);
    const counts = {};
    const causes = new Map();
    for (const j of list) {
      j.d = diagnoseJob(j);
      counts[j.d.outcome] = (counts[j.d.outcome] || 0) + 1;
      if (j.d.outcome === "applied") continue;
      const g = causes.get(j.d.sig) || { sig: j.d.sig, outcome: j.d.outcome, cause: j.d.cause, jobs: [] };
      g.jobs.push(j.idx);
      causes.set(j.d.sig, g);
    }
    const missing = Math.max(0, totalJobs - list.length);
    if (missing) counts.not_reached = (counts.not_reached || 0) + missing;
    return { jobs: list, total: totalJobs, counts, causes: [...causes.values()].sort((a, b) => b.jobs.length - a.jobs.length), errors: groupErrors(events), start: events.length ? events[0].ts : 0, end: events.length ? events[events.length - 1].ts : 0, search: searchSummary(events) };
  }

  function groupErrors(events) {
    const m = new Map();
    for (const e of events) {
      if (e.lvl !== "error" || e.cat === "job") continue;
      const k = e.cat + "|" + norm(e.msg);
      const g = m.get(k) || { msg: e.msg, cat: e.cat, n: 0, jobs: new Set(), where: where(e.data && e.data.stack), stack: e.data && e.data.stack, first: e.ts, url: e.url };
      g.n++;
      if (e.job != null) g.jobs.add(e.job);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).map((g) => Object.assign(g, { jobs: [...g.jobs] }));
  }

  function searchSummary(events) {
    const s = events.filter((e) => e.cat === "search");
    if (!s.length) return null;
    const starts = s.filter((e) => /^Search started/.test(e.msg));
    const pages = s.filter((e) => /^Page answered/.test(e.msg));
    const groups = s.filter((e) => /^Server keyword group/.test(e.msg));
    const failed = groups.filter((e) => /no answer/.test(e.msg));
    const secs = groups.map((e) => parseFloat((e.msg.match(/in ([\d.]+)s/) || [])[1])).filter((x) => x >= 0);
    const last = pages[pages.length - 1];
    return { searches: starts.length, lastStart: starts.length ? starts[starts.length - 1] : null, pages: pages.length, last: last ? last.msg : "", groups: groups.length, failed: failed.length, avgSec: secs.length ? Math.round((secs.reduce((a, b) => a + b, 0) / secs.length) * 10) / 10 : null, slowest: secs.length ? Math.max(...secs) : null };
  }

  // -------------------------------------------------------------- export --
  async function extraMask() {
    const words = [];
    if (!hasChrome) return words;
    try {
      const r = await chrome.storage.local.get("lazyOwnMailProfile");
      const p = (r.lazyOwnMailProfile && r.lazyOwnMailProfile.personalInformation) || {};
      for (const k of ["firstName", "lastName", "fullName", "name", "middleName"]) if (p[k] && String(p[k]).trim().length >= 3) words.push(String(p[k]).trim());
      const full = [p.firstName, p.lastName].filter(Boolean).join(" ");
      if (full) words.unshift(full);
    } catch (e) {}
    return words;
  }
  function meta(masked) {
    let version = "?";
    try { version = chrome.runtime.getManifest().version; } catch (e) {}
    return { extension: "LazyApply (improved) " + version, exportedAt: new Date().toISOString(), browser: navigator.userAgent, masked };
  }
  const t = (ts) => { const d = new Date(ts); return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0"); };
  const evLine = (e) => t(e.ts) + " [" + e.cat + (e.lvl !== "info" ? "/" + e.lvl : "") + "] " + (e.job != null ? "#" + (e.job + 1) + " " : "") + e.msg;

  function fixReport(sess, events, a, m) {
    const L = [];
    L.push("# LazyApply debug report", "", "- " + m.extension, "- Exported " + m.exportedAt, "- Browser: " + m.browser, "- Personal details hidden: " + (m.masked ? "yes" : "no"), "");
    L.push("## " + sess.label, "", "- From " + new Date(a.start).toLocaleString() + " to " + new Date(a.end).toLocaleString() + " (" + fmtDur(a.end - a.start) + ")", "- Events recorded: " + events.length, "");
    if (a.total) {
      L.push("### Outcomes (" + a.total + " jobs)", "", "| Outcome | Jobs |", "|---|---|");
      for (const [k, n] of Object.entries(a.counts).sort((x, y) => y[1] - x[1])) L.push("| " + (RR.OUTCOMES[k] || k) + " | " + n + " |");
      L.push("");
      L.push("### Root causes (jobs not applied, grouped)", "");
      for (const g of a.causes) L.push("- **" + g.jobs.length + " ×** " + g.cause + " — jobs " + g.jobs.slice(0, 20).map((i) => "#" + (i + 1)).join(", ") + (g.jobs.length > 20 ? " …" : ""));
      if (!a.causes.length) L.push("- none");
      L.push("");
    }
    if (a.search) {
      const s = a.search;
      L.push("### Search", "", "- Searches started: " + s.searches + (s.lastStart ? " (last: " + s.lastStart.msg + ")" : ""), "- Pages answered: " + s.pages + (s.last ? "; last: " + s.last : ""), "- Server keyword-group requests: " + s.groups + ", without answer: " + s.failed + (s.avgSec != null ? ", average " + s.avgSec + "s, slowest " + s.slowest + "s" : ""), "");
    }
    L.push("### Errors (grouped)", "");
    for (const g of a.errors.slice(0, 40)) {
      L.push("- **" + g.n + " ×** [" + g.cat + "] " + g.msg.slice(0, 300) + (g.where ? " — `" + g.where + "`" : "") + (g.jobs.length ? " — jobs " + g.jobs.slice(0, 12).map((i) => "#" + (i + 1)).join(", ") : ""));
      if (g.stack) L.push("  ```", "  " + String(g.stack).split("\n").slice(0, 8).join("\n  "), "  ```");
    }
    if (!a.errors.length) L.push("- none");
    L.push("");
    const bad = a.jobs.filter((j) => j.d.outcome !== "applied");
    if (bad.length) {
      L.push("### Jobs not applied (" + bad.length + ")", "");
      for (const j of bad.slice(0, 150)) {
        L.push("#### #" + (j.idx + 1) + " " + (j.title || "?") + (j.url ? " — " + j.url : ""), "", "- Outcome: **" + (RR.OUTCOMES[j.d.outcome] || j.d.outcome) + "** after " + fmtDur(j.d.duration) + ", " + j.d.actions + " automation actions", "- Cause: " + j.d.cause);
        for (const d of j.d.details.slice(1)) L.push("- " + d);
        if (j.d.snap && j.d.snap.fields) {
          const f = j.d.snap.fields.filter((x) => !x.hidden).slice(0, 40);
          L.push("- Form at the end (" + j.d.snap.why + "):", "", "  | Field | Type | Req | Value |", "  |---|---|---|---|");
          for (const x of f) L.push("  | " + String(x.label).replace(/\|/g, "/").slice(0, 80) + " | " + x.type + " | " + (x.required ? "yes" : "") + " | " + String(x.value || (x.empty ? "(empty)" : "")).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 60) + (x.invalid ? " ⚠" : "") + " |");
          L.push("");
        }
        L.push("- Last steps:", "", "  ```");
        for (const e of j.d.lastEvents.slice(-25)) L.push("  " + evLine(e).slice(0, 300));
        L.push("  ```", "");
      }
    }
    if (!a.total) {
      L.push("### Last 300 events", "", "```");
      for (const e of events.slice(-300)) L.push(evLine(e).slice(0, 300));
      L.push("```");
    }
    return L.join("\n");
  }

  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }
  async function doExport(kind) {
    const masked = $("mask").checked;
    const words = masked ? await extraMask() : [];
    const mk = (x) => (masked ? C.mask(x, words) : x);
    const m = meta(masked);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    if (kind === "all") {
      const all = await everything();
      return download("lazyapply-debug-all-" + stamp + ".json", JSON.stringify(mk({ meta: m, events: all })), "application/json");
    }
    if (!state.sess) return;
    const name = (state.sess.run || "activity-" + new Date(state.sess.day).toISOString().slice(0, 10)) + "-" + stamp;
    if (kind === "json") {
      const a = state.analysis;
      const summary = a ? { total: a.total, counts: a.counts, causes: a.causes, errors: a.errors, search: a.search, jobs: a.jobs.map((j) => ({ n: j.idx + 1, title: j.title, url: j.url, outcome: j.d.outcome, cause: j.d.cause, details: j.d.details, seconds: Math.round(j.d.duration / 1000) })) } : null;
      return download("lazyapply-debug-" + name + ".json", JSON.stringify(mk({ meta: m, session: state.sess.label, summary, events: state.events }), null, 1), "application/json");
    }
    const text = fixReport(state.sess, state.events, state.analysis || analyzeRun(state.events), m);
    download("lazyapply-debug-" + name + ".md", mk(text), "text/markdown");
  }

  // ------------------------------------------------------------------ UI --
  const state = { sess: null, events: [], analysis: null, job: null, sel: null, levels: new Set(["error", "warn", "info"]), cats: null, q: "", limit: 1500, maxId: 0, jobFilter: null };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const OC = { applied: "okc", failed: "bad", stuck: "wc", timeout: "wc", unconfirmed: "", closed: "muted", redirected: "", skipped: "muted", not_reached: "muted", unknown: "wc" };

  async function refreshSide() {
    const [runs, days, n] = await Promise.all([listRuns(), listDays(), total()]);
    $("count").textContent = n.toLocaleString() + " events stored";
    const r = $("runs");
    r.textContent = "";
    if (!runs.length) r.innerHTML = '<div class="muted small" style="padding:4px">No runs recorded yet. Start one from the dashboard; everything it does is recorded here.</div>';
    for (const x of runs) {
      const d = document.createElement("div");
      d.className = "sess" + (state.sess && state.sess.run === x.run ? " on" : "");
      d.innerHTML = '<div class="t">' + esc(new Date(x.start).toLocaleString()) + '</div><div class="s">' + esc((x.title || "").replace(/^Run started: /, "")) + " · " + fmtDur(x.end - x.start) + " · " + x.n.toLocaleString() + " events</div>";
      d.onclick = () => select({ run: x.run, label: "Run " + x.run, start: x.start });
      r.appendChild(d);
    }
    const dd = $("days");
    dd.textContent = "";
    for (const x of days) {
      const d = document.createElement("div");
      d.className = "sess" + (state.sess && state.sess.day === x.day ? " on" : "");
      d.innerHTML = '<div class="t">' + esc(new Date(x.day).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })) + '</div><div class="s">' + x.n.toLocaleString() + " events that day (outside runs shown)</div>";
      d.onclick = () => select({ day: x.day, label: "Activity on " + new Date(x.day).toDateString() });
      dd.appendChild(d);
    }
    return runs;
  }

  async function select(sess) {
    state.sess = sess;
    state.job = null;
    state.sel = null;
    state.cats = null;
    state.limit = 1500;
    $("content").innerHTML = '<div class="empty">Loading…</div>';
    const ev = sess.run ? await byRun(sess.run) : await byTime(sess.day, sess.day + 86399999);
    ev.sort((a, b) => a.id - b.id);
    state.events = ev;
    state.maxId = Math.max(state.maxId, ...ev.map((e) => e.id), 0);
    state.analysis = sess.run ? analyzeRun(ev) : { jobs: [], total: 0, counts: {}, causes: [], errors: groupErrors(ev), start: ev.length ? ev[0].ts : 0, end: ev.length ? ev[ev.length - 1].ts : 0, search: searchSummary(ev) };
    try { history.replaceState(null, "", sess.run ? "#run=" + encodeURIComponent(sess.run) : "#day=" + sess.day); } catch (e) {}
    render();
    refreshSide();
  }

  function render() {
    const a = state.analysis;
    const root = $("content");
    const keepScroll = root.scrollTop;
    root.textContent = "";
    if (!state.sess) { root.innerHTML = '<div class="empty">Pick a run or a day on the left.</div>'; return; }
    const head = card(esc(state.sess.label), '<div class="muted">' + esc(new Date(a.start).toLocaleString()) + " → " + esc(new Date(a.end).toLocaleTimeString()) + " · " + fmtDur(a.end - a.start) + " · " + state.events.length.toLocaleString() + " events</div>");
    if (a.total) {
      const st = document.createElement("div");
      st.className = "stats";
      st.innerHTML = '<div class="stat"><b>' + a.total + "</b><span>jobs</span></div>" + Object.entries(a.counts).sort((x, y) => y[1] - x[1]).map(([k, n]) => '<div class="stat"><b class="' + (OC[k] || "") + '">' + n + "</b><span>" + esc(RR.OUTCOMES[k] || k) + "</span></div>").join("");
      head.appendChild(st);
    }
    root.appendChild(head);

    if (a.causes.length) {
      const c = card("Root causes", '<div class="muted small" style="margin-bottom:6px">Jobs that were not applied, grouped by what stopped them. Click a job number to see its steps.</div>');
      const tb = document.createElement("table");
      tb.innerHTML = "<tr><th class=num>Jobs</th><th>Cause</th><th>Which</th></tr>";
      for (const g of a.causes) {
        const tr = document.createElement("tr");
        tr.innerHTML = '<td class="num"><b>' + g.jobs.length + '</b></td><td class="cause">' + esc(g.cause) + "</td><td></td>";
        const td = tr.lastChild;
        g.jobs.slice(0, 30).forEach((i) => { const l = document.createElement("a"); l.href = "#"; l.textContent = "#" + (i + 1); l.style.marginRight = "6px"; l.onclick = (e) => { e.preventDefault(); pickJob(i); }; td.appendChild(l); });
        tb.appendChild(tr);
      }
      c.appendChild(tb);
      root.appendChild(c);
    }

    if (a.search) {
      const s = a.search;
      root.appendChild(card("Search", '<div class="stats"><div class="stat"><b>' + s.searches + '</b><span>searches started</span></div><div class="stat"><b>' + s.pages + '</b><span>pages answered</span></div><div class="stat"><b>' + s.groups + '</b><span>server requests</span></div><div class="stat"><b class="' + (s.failed ? "bad" : "") + '">' + s.failed + '</b><span>without answer</span></div><div class="stat"><b>' + (s.avgSec == null ? "–" : s.avgSec + "s") + '</b><span>average server time</span></div></div><div class="muted small">' + esc(s.last) + "</div>"));
    }

    if (a.errors.length) {
      const c = card("Errors (" + a.errors.reduce((x, g) => x + g.n, 0) + ")", "");
      const tb = document.createElement("table");
      tb.innerHTML = "<tr><th class=num>×</th><th>Error</th><th>Where</th><th>Jobs</th></tr>";
      for (const g of a.errors.slice(0, 25)) {
        const tr = document.createElement("tr");
        tr.innerHTML = '<td class="num">' + g.n + '</td><td class="cause bad">' + esc(g.msg.slice(0, 260)) + '</td><td class="small tl">' + esc(g.where || g.cat) + '</td><td class="small">' + g.jobs.slice(0, 8).map((i) => "#" + (i + 1)).join(" ") + "</td>";
        tb.appendChild(tr);
      }
      c.appendChild(tb);
      root.appendChild(c);
    }

    if (a.jobs.length) {
      const c = card("Jobs", "");
      const tb = document.createElement("table");
      tb.innerHTML = "<tr><th class=num>#</th><th>Job</th><th>Outcome</th><th>Cause</th><th class=num>Time</th></tr>";
      for (const j of a.jobs) {
        const tr = document.createElement("tr");
        tr.className = "job" + (state.job === j.idx ? " on" : "");
        tr.innerHTML = '<td class="num">' + (j.idx + 1) + "</td><td>" + esc(j.title || hostOf(j.url) || "?") + '<div class="muted small">' + esc(hostOf(j.url)) + '</div></td><td class="' + (OC[j.d.outcome] || "") + '">' + esc(RR.OUTCOMES[j.d.outcome] || j.d.outcome) + '</td><td class="cause">' + esc(j.d.outcome === "applied" ? "" : j.d.cause) + '</td><td class="num small">' + fmtDur(j.d.duration) + "</td>";
        tr.onclick = () => pickJob(j.idx);
        tb.appendChild(tr);
      }
      c.appendChild(tb);
      root.appendChild(c);
    }

    if (state.job != null) {
      const j = a.jobs.find((x) => x.idx === state.job);
      if (j) {
        const c = card("Job #" + (j.idx + 1) + ": " + esc(j.title || ""), '<div class="muted small">' + (j.url ? '<a href="' + esc(j.url) + '" target="_blank" rel="noopener">' + esc(j.url) + "</a>" : "") + "</div>");
        c.id = "jobcard";
        const ul = document.createElement("ul");
        ul.className = "why";
        ul.innerHTML = "<li><b>Outcome:</b> <span class='" + (OC[j.d.outcome] || "") + "'>" + esc(RR.OUTCOMES[j.d.outcome] || j.d.outcome) + "</span> after " + fmtDur(j.d.duration) + ", " + j.d.actions + " automation actions</li><li><b>Cause:</b> " + esc(j.d.cause) + "</li>" + j.d.details.slice(1).map((d) => "<li>" + esc(d) + "</li>").join("");
        c.appendChild(ul);
        if (j.d.snap) c.appendChild(snapTable(j.d.snap));
        const b = document.createElement("button");
        b.textContent = "Show all jobs in the timeline";
        b.onclick = () => { state.job = null; render(); };
        c.appendChild(b);
        root.appendChild(c);
      }
    }
    root.appendChild(timeline());
    root.scrollTop = keepScroll;
  }

  function card(title, html) {
    const c = document.createElement("div");
    c.className = "card";
    c.innerHTML = "<h3>" + title + "</h3>" + (html || "");
    return c;
  }
  function pickJob(i) {
    state.job = i;
    state.sel = null;
    render();
    const jc = $("jobcard");
    if (jc) jc.scrollIntoView({ block: "start" });
  }

  function snapTable(s) {
    const w = document.createElement("div");
    w.style.marginTop = "8px";
    w.innerHTML = '<div class="muted small">Page snapshot (' + esc(s.why || "") + "): " + esc(s.heading || "") + " " + esc(s.url || "") + "</div>" + (s.errors && s.errors.length ? '<div class="bad small">Errors shown: ' + esc(s.errors.join(" | ")) + "</div>" : "") + (s.buttons && s.buttons.length ? '<div class="muted small">Buttons: ' + esc(s.buttons.join(" · ")) + "</div>" : "");
    if (s.fields && s.fields.length) {
      const tb = document.createElement("table");
      tb.className = "small";
      tb.innerHTML = "<tr><th>Field</th><th>Type</th><th>Required</th><th>Value</th></tr>" + s.fields.filter((f) => !f.hidden).slice(0, 80).map((f) => "<tr><td>" + esc(f.label) + "</td><td>" + esc(f.type) + "</td><td>" + (f.required ? "yes" : "") + "</td><td class='" + (f.invalid || (f.required && f.empty) ? "bad" : "") + "'>" + esc(f.value || (f.empty ? "(empty)" : "")) + (f.invalid ? " ⚠ invalid" : "") + "</td></tr>").join("");
      w.appendChild(tb);
    }
    return w;
  }

  function timeline() {
    const c = card("Timeline" + (state.job != null ? " — job #" + (state.job + 1) : ""), "");
    const cats = [...new Set(state.events.map((e) => e.cat))].sort();
    if (!state.cats) state.cats = new Set(cats);
    const f = document.createElement("div");
    f.className = "filters";
    const lv = document.createElement("div");
    lv.className = "chips";
    for (const l of ["error", "warn", "info", "debug"]) {
      const ch = document.createElement("span");
      ch.className = "chip" + (state.levels.has(l) ? "" : " off");
      ch.innerHTML = '<span class="dot" style="background:var(--' + (l === "error" ? "err" : l === "warn" ? "warn" : l === "info" ? "accent" : "debug") + ')"></span> ' + l;
      ch.onclick = () => { state.levels.has(l) ? state.levels.delete(l) : state.levels.add(l); render(); };
      lv.appendChild(ch);
    }
    f.appendChild(lv);
    const q = document.createElement("input");
    q.type = "search";
    q.placeholder = "Search events…";
    q.value = state.q;
    q.oninput = () => { state.q = q.value; clearTimeout(q._t); q._t = setTimeout(() => { const p = q.selectionStart; render(); const nq = document.querySelector("#content input[type=search]"); if (nq) { nq.focus(); nq.setSelectionRange(p, p); } }, 250); };
    f.appendChild(q);
    c.appendChild(f);
    const cc = document.createElement("div");
    cc.className = "chips";
    for (const k of cats) {
      const ch = document.createElement("span");
      ch.className = "chip" + (state.cats.has(k) ? "" : " off");
      ch.textContent = k + " " + state.events.filter((e) => e.cat === k).length;
      ch.title = "Click to show / hide; double-click to show only this";
      ch.onclick = () => { state.cats.has(k) ? state.cats.delete(k) : state.cats.add(k); render(); };
      ch.ondblclick = () => { state.cats = new Set([k]); render(); };
      cc.appendChild(ch);
    }
    c.appendChild(cc);
    const ql = state.q.toLowerCase();
    const shown = state.events.filter((e) => state.levels.has(e.lvl) && state.cats.has(e.cat) && (state.job == null || e.job === state.job) && (!ql || (e.msg + " " + (e.url || "") + " " + (e.jt || "")).toLowerCase().includes(ql) || (ql.length > 3 && JSON.stringify(e.data || "").toLowerCase().includes(ql))));
    const slice = shown.slice(-state.limit);
    const info = document.createElement("div");
    info.className = "muted small";
    info.textContent = shown.length.toLocaleString() + " events match" + (shown.length > slice.length ? ", showing the last " + slice.length : "");
    if (shown.length > slice.length) {
      const more = document.createElement("button");
      more.textContent = "Show earlier";
      more.style.marginLeft = "8px";
      more.onclick = () => { state.limit += 3000; render(); };
      info.appendChild(more);
    }
    c.appendChild(info);
    const tl = document.createElement("div");
    tl.className = "tl";
    let prevTs = 0;
    const frag = document.createDocumentFragment();
    for (const e of slice) {
      const r = document.createElement("div");
      r.className = "row " + e.lvl + (state.sel === e.id ? " sel" : "");
      const d = prevTs ? e.ts - prevTs : 0;
      prevTs = e.ts;
      r.innerHTML = "<span>" + t(e.ts) + '</span><span class="d muted">' + (d ? "+" + (d < 1000 ? d + "ms" : (d / 1000).toFixed(1) + "s") : "") + '</span><span class="dot" style="margin-top:4px;background:var(--' + (e.lvl === "error" ? "err" : e.lvl === "warn" ? "warn" : e.lvl === "info" ? "accent" : "debug") + ')"></span><span class="cat">' + esc(e.cat) + '</span><span class="j muted">' + (e.job != null ? "#" + (e.job + 1) : "") + '</span><span class="m">' + esc(e.msg) + (e.src === "page" && e.url ? ' <span class="muted">· ' + esc(hostOf(e.url)) + "</span>" : "") + "</span>";
      r.onclick = () => { state.sel = e.id; showDetail(e); document.querySelectorAll(".row.sel").forEach((x) => x.classList.remove("sel")); r.classList.add("sel"); };
      frag.appendChild(r);
    }
    tl.appendChild(frag);
    if (!slice.length) tl.innerHTML = '<div class="empty">Nothing matches these filters.</div>';
    c.appendChild(tl);
    const det = document.createElement("div");
    det.id = "detail";
    det.className = "detail";
    det.style.display = "none";
    c.appendChild(det);
    if (state.sel != null) { const e = state.events.find((x) => x.id === state.sel); if (e) setTimeout(() => showDetail(e), 0); }
    return c;
  }

  function showDetail(e) {
    const d = $("detail");
    if (!d) return;
    d.style.display = "block";
    d.textContent = "";
    const close = document.createElement("button");
    close.textContent = "Close";
    close.style.float = "right";
    close.onclick = () => { d.style.display = "none"; state.sel = null; };
    d.appendChild(close);
    const h = document.createElement("div");
    h.innerHTML = "<b>" + esc(new Date(e.ts).toLocaleString()) + "." + String(e.ts % 1000).padStart(3, "0") + "</b> · " + esc(e.cat) + " · " + esc(e.lvl) + " · from " + esc(e.src === "page" ? "page" + (e.tab != null ? " (tab " + e.tab + (e.frame ? ", frame " + e.frame : "") + ")" : "") : "background") + (e.job != null ? " · job #" + (e.job + 1) + " " + esc(e.jt || "") : "") + (e.url ? '<div class="muted small">' + esc(e.url) + "</div>" : "");
    d.appendChild(h);
    const m = document.createElement("pre");
    m.style.margin = "8px 0";
    m.textContent = e.msg;
    d.appendChild(m);
    if (e.cat === "snapshot" && e.data) d.appendChild(snapTable(e.data));
    if (e.data !== undefined) {
      const p = document.createElement("pre");
      p.textContent = JSON.stringify(e.data, null, 2);
      d.appendChild(p);
    }
  }

  // ------------------------------------------------------------- header --
  async function loadSettings() {
    if (!hasChrome) return;
    const r = await chrome.storage.local.get("lazyDbgSettings");
    const s = Object.assign({ on: true, level: "full", max: 300000 }, r.lazyDbgSettings || {});
    $("recDot").style.background = s.on ? "var(--err)" : "#555";
    $("recText").textContent = s.on ? "Recording" : "Not recording";
    $("recToggle").textContent = s.on ? "Pause recording" : "Start recording";
    $("level").value = s.level;
    return s;
  }
  async function saveSettings(patch) {
    const r = await chrome.storage.local.get("lazyDbgSettings");
    await chrome.storage.local.set({ lazyDbgSettings: Object.assign({ on: true, level: "full", max: 300000 }, r.lazyDbgSettings || {}, patch) });
    loadSettings();
  }

  async function poll() {
    if (!$("live").checked || !state.sess) return;
    const fresh = await since(state.maxId).catch(() => []);
    if (!fresh.length) return;
    state.maxId = Math.max(state.maxId, ...fresh.map((e) => e.id));
    const mine = fresh.filter((e) => (state.sess.run ? e.run === state.sess.run : !e.run && e.ts >= state.sess.day && e.ts < state.sess.day + 86400000));
    const newRun = fresh.some((e) => e.run && e.cat === "run" && /^Run started/.test(e.msg));
    if (newRun) refreshSide();
    if (!mine.length) return;
    state.events.push(...mine);
    state.analysis = state.sess.run ? analyzeRun(state.events) : Object.assign(state.analysis, { errors: groupErrors(state.events), end: state.events[state.events.length - 1].ts, search: searchSummary(state.events) });
    const typing = document.activeElement && document.activeElement.tagName === "INPUT" && document.activeElement.type === "search";
    if (!typing) render();
  }

  if (typeof document !== "undefined" && $("content")) {
    (async () => {
      if (hasChrome) {
        $("recToggle").onclick = async () => { const s = await loadSettings(); saveSettings({ on: !s.on }); };
        $("level").onchange = () => saveSettings({ level: $("level").value });
        $("snap").onclick = () => chrome.runtime.sendMessage({ type: "LAZY_DBG_SNAPSHOT_ALL" }, (r) => { void chrome.runtime.lastError; $("snap").textContent = r && r.tabs ? "Snapshot taken (" + r.tabs + " tab" + (r.tabs > 1 ? "s" : "") + ")" : "No automation tab open"; setTimeout(() => ($("snap").textContent = "Snapshot now"), 3000); });
        loadSettings();
      }
      $("exportBtn").onclick = (e) => { e.stopPropagation(); $("exportMenu").classList.toggle("open"); };
      document.addEventListener("click", (e) => { if (!$("exportMenu").contains(e.target)) $("exportMenu").classList.remove("open"); });
      document.querySelectorAll("#exportMenu [data-x]").forEach((b) => (b.onclick = () => { $("exportMenu").classList.remove("open"); doExport(b.dataset.x); }));
      $("clear").onclick = async () => {
        if (!confirm("Delete everything the debugger has recorded? This cannot be undone. (Export first if you may need it.)")) return;
        await req2p((await store("readwrite")).clear());
        state.sess = null; state.events = []; state.analysis = null;
        await refreshSide();
        render();
      };
      const runs = await refreshSide().catch((e) => { $("content").innerHTML = '<div class="empty bad">Could not read the recording: ' + esc((e && e.message) || e) + "</div>"; return []; });
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get("run")) select({ run: h.get("run"), label: "Run " + h.get("run") });
      else if (h.get("day")) select({ day: +h.get("day"), label: "Activity on " + new Date(+h.get("day")).toDateString() });
      else if (runs.length) select({ run: runs[0].run, label: "Run " + runs[0].run });
      else { const d = new Date(); d.setHours(0, 0, 0, 0); select({ day: d.getTime(), label: "Activity on " + d.toDateString() }); }
      setInterval(poll, 2000);
    })();
  }

  self.__lazyDbgView = { analyzeRun, diagnoseJob, fixReport, groupErrors, searchSummary, norm, where };
})();
