/*
 * Debugger, background half. Records what the extension does, in order, into
 * IndexedDB ("lazyDebug") in this browser:
 *  - every run and every job: start, each status change, why it ended
 *    (applied / failed / skipped / stuck / timed out), with the error text;
 *  - every message between pages and the background, every tab opened,
 *    moved or closed, every script injected, every page loaded or failed to
 *    load in the automation tabs;
 *  - every network request the background makes (address, status, time;
 *    for LazyApply's server also what was asked and answered);
 *  - errors, warnings and console output of the background;
 *  - events sent by the pages (debugHook.js): clicks, fields filled, AI
 *    answers, page errors, form snapshots, search progress.
 * Events carry the run, the job number and the job they belong to, so the
 * Debugger page (debugger.html) can show what led to each outcome.
 *
 * Loaded first by background.js so its hooks see everything after it.
 */
(function (g) {
  "use strict";
  if (g.LazyDebug) return;
  const C = g.__lazyDbgCore;
  const DB = "lazyDebug", STORE = "ev", VERSION = 1;
  const SETTINGS = "lazyDbgSettings", CTX = "lazyDbgCtx";
  const DEFAULTS = { on: true, level: "full", max: 300000 };
  let settings = Object.assign({}, DEFAULTS);
  let ctx = { run: null, runStart: 0, idx: null, jobUrl: "", jobTitle: "", autoTab: null, dashTab: null, total: 0 };
  const openers = new Map(); // tabId -> opener tabId
  const prev = {}; // last seen state per applicationState key, for diffs
  let queue = [], timer = null, written = 0, db = null;
  const t0 = Date.now();

  // ---- storage ------------------------------------------------------------
  function openDb() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
          s.createIndex("run", "run");
          s.createIndex("ts", "ts");
        }
      };
      r.onsuccess = () => { db = r.result; db.onversionchange = () => { db.close(); db = null; }; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  function flush() {
    timer = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    openDb()
      .then((d) => new Promise((res) => {
        const tx = d.transaction(STORE, "readwrite");
        const s = tx.objectStore(STORE);
        for (const e of batch) { try { s.add(e); } catch (err) { s.add({ ts: e.ts, run: e.run, cat: "debugger", lvl: "warn", msg: "Event could not be stored: " + err.message }); } }
        tx.oncomplete = tx.onerror = tx.onabort = () => res();
      }))
      .then(() => { written += batch.length; if (written >= 2000) { written = 0; prune(); } })
      .catch(() => {});
  }
  function prune() {
    openDb().then((d) => {
      const tx = d.transaction(STORE, "readwrite");
      const s = tx.objectStore(STORE);
      const cnt = s.count();
      cnt.onsuccess = () => {
        let extra = cnt.result - settings.max;
        if (extra <= 0) return;
        extra += Math.floor(settings.max * 0.1);
        s.openCursor().onsuccess = (e) => {
          const c = e.target.result;
          if (!c || extra-- <= 0) return;
          c.delete();
          c.continue();
        };
      };
    }).catch(() => {});
  }
  function push(e) {
    if (!settings.on) return;
    if (settings.level === "errors" && e.lvl !== "error" && e.lvl !== "warn" && e.cat !== "job" && e.cat !== "run") return;
    if (settings.level === "standard" && e.lvl === "debug") return;
    queue.push(e);
    if (queue.length > 400) flush();
    else if (!timer) timer = setTimeout(flush, 400);
  }

  // ---- context --------------------------------------------------------------
  function jobFor(tabId) {
    try {
      const P = g.LazyParallel && g.LazyParallel._internal && g.LazyParallel._internal.run;
      const top = openers.has(tabId) && !(P && P.workers && P.workers[tabId]) && tabId !== ctx.autoTab ? openers.get(tabId) : tabId;
      if (P && P.workers && P.workers[top] && P.workers[top].idx != null) {
        const l = (P.master.links || [])[P.workers[top].idx] || {};
        return { job: P.workers[top].idx, jurl: l.url || "", jt: jobName(l) };
      }
      if (top === ctx.autoTab && ctx.idx != null) return { job: ctx.idx, jurl: ctx.jobUrl, jt: ctx.jobTitle };
    } catch (e) {}
    return {};
  }
  const jobName = (l) => [l && l.title, l && (l.companyName || l.company)].filter(Boolean).join(" – ").slice(0, 160);
  function isTracked(tabId, url) {
    if (tabId == null) return false;
    if (tabId === ctx.autoTab || tabId === ctx.dashTab) return true;
    if (g.LazyParallel && g.LazyParallel.isWorker && g.LazyParallel.isWorker(tabId)) return true;
    const o = openers.get(tabId);
    if (o != null && (o === ctx.autoTab || (g.LazyParallel && g.LazyParallel.isWorker && g.LazyParallel.isWorker(o)))) return true;
    return /^https:\/\/(app|beta)\.lazyapply\.com\//.test(url || "");
  }

  /** Records one event. cat: run, job, state, msg, net, tab, nav, inject, console, error, page, dom, field, ai, search, snapshot, debugger... */
  function log(cat, lvl, msg, data, extra) {
    try {
      const e = Object.assign({ ts: Date.now(), run: ctx.run, cat, lvl: lvl || "info", msg: C.clip(C.scrubString(msg == null ? "" : msg), 600), src: "bg" }, extra || {});
      // Background events belong to the open job only when they are about it:
      // job-board lookups of the search, storage writes and console chatter
      // happen alongside and would bury the job's real steps.
      const aboutJob = /^(job|tab|inject|nav|panel|email|error|stuck|skip)$/.test(cat) || (cat === "msg" && extra && extra.tab != null) || (cat === "net" && /lazyapply\.com/.test(String((extra && extra.url) || msg))) || (cat === "console" && lvl !== "debug");
      // An event about a given tab already carries that tab's job (jobFor), or none.
      if (e.job === undefined && ctx.idx != null && ctx.run && aboutJob && !(extra && "tab" in extra)) { e.job = ctx.idx; e.jurl = ctx.jobUrl; e.jt = ctx.jobTitle; }
      if (data !== undefined) e.data = C.safe(data, 2000, 5);
      push(e);
    } catch (err) {}
  }

  function saveCtx() { try { chrome.storage.local.set({ [CTX]: ctx }); } catch (e) {} }
  const ready = (async () => {
    try {
      const r = await chrome.storage.local.get([SETTINGS, CTX, "applicationState", "automationTabId", "globalTabId"]);
      settings = Object.assign({}, DEFAULTS, r[SETTINGS] || {});
      if (r[CTX]) ctx = Object.assign(ctx, r[CTX]);
      if (r.automationTabId != null) ctx.autoTab = r.automationTabId;
      if (r.globalTabId != null) ctx.dashTab = Number(r.globalTabId);
      if (r.applicationState) prev.applicationState = shape(r.applicationState);
    } catch (e) {}
  })();

  // ---- application state: runs, jobs, statuses -------------------------------
  function shape(st) {
    return {
      active: !!st.isAutomationActive, paused: !!st.isPaused, idx: st.currentIndex,
      statuses: (st.links || []).map((l) => (l ? (l.status || "") + "|" + (l.currentState || "") : "")),
      failed: (st.failedLinks || []).length, skipped: (st.skippedLinks || []).length, timedOut: (st.timedOutLinks || []).length,
      n: (st.links || []).length,
    };
  }
  function newRun(st) {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    ctx.run = "run-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    ctx.runStart = Date.now();
    ctx.idx = null;
    ctx.total = (st.links || []).length;
    const boards = {};
    for (const l of st.links || []) { const b = (l && (l.jobBoard || l.platform)) || hostOf(l && l.url); boards[b] = (boards[b] || 0) + 1; }
    log("run", "info", "Run started: " + ctx.total + " jobs" + (st.emailApplyOption ? ", with referral emails" : ""), { boards, sessionId: st.sessionId || undefined, parallel: !!(g.LazyParallel && g.LazyParallel._internal && g.LazyParallel._internal.run) }, { job: null });
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "?"; } };
  function onState(key, st) {
    const was = prev[key];
    if (!st) {
      if (was && key === "applicationState" && ctx.run) {
        log("run", "info", "Run state cleared (run over)", undefined, { job: null });
        ctx.run = null; ctx.idx = null; saveCtx();
      }
      delete prev[key];
      return;
    }
    const now = shape(st);
    prev[key] = now;
    const worker = key !== "applicationState";
    const tag = worker ? " (tab " + key.split(/[^0-9]+/).filter(Boolean).pop() + ")" : "";
    if (!worker) {
      if (now.active && (!ctx.run || (was && !was.active) || (was && was.n !== now.n && now.idx === 0))) newRun(st);
      if (now.idx !== ctx.idx || !was) {
        ctx.idx = now.idx;
        const l = (st.links || [])[now.idx] || {};
        ctx.jobUrl = l.url || "";
        ctx.jobTitle = jobName(l);
        saveCtx();
        if (now.active && l.url) log("job", "info", "Job " + (now.idx + 1) + "/" + now.n + " started: " + (ctx.jobTitle || l.url), { url: l.url, board: l.jobBoard || hostOf(l.url) });
      }
      if (was && was.paused !== now.paused) log("run", "info", now.paused ? "Paused" : "Resumed");
      if (was && was.active && !now.active) log("run", "info", "Run marked inactive");
    }
    if (!was) return;
    for (let i = 0; i < now.statuses.length; i++) {
      if (now.statuses[i] === was.statuses[i]) continue;
      const l = (st.links || [])[i] || {};
      const [s, cs] = now.statuses[i].split("|");
      const [ps] = String(was.statuses[i] || "|").split("|");
      if (s === ps && !cs) continue;
      const lvl = s === "failed" ? "error" : /skipped|timeout|expired/.test(s) ? "warn" : "info";
      log("job", lvl, "Job " + (i + 1) + tag + ": " + (ps || "pending") + " → " + s + (cs && cs !== s ? " (" + cs + ")" : "") + (l.error ? ": " + l.error : ""), { url: l.url, status: s, currentState: cs, error: l.error, lastUrl: l.lastUrl }, { job: i, jurl: l.url || "", jt: jobName(l) });
    }
    for (const [k, list, lvl] of [["failed", "failedLinks", "error"], ["skipped", "skippedLinks", "warn"], ["timedOut", "timedOutLinks", "warn"]]) {
      if (now[k] > was[k]) for (const e of (st[list] || []).slice(was[k])) {
        const i = (st.links || []).findIndex((l) => l && l.url === e.url);
        log("job", lvl, "Job " + (i + 1) + tag + " → " + list.replace("Links", "") + (e.reason || e.error ? ": " + (e.reason || e.error) : "") + (e.stage ? " [stage " + e.stage + "]" : ""), e, i >= 0 ? { job: i, jurl: e.url, jt: jobName(st.links[i]) } : undefined);
      }
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const k of Object.keys(changes)) {
      if (k === CTX) continue;
      if (k === SETTINGS) { settings = Object.assign({}, DEFAULTS, changes[k].newValue || {}); continue; }
      const nv = changes[k].newValue;
      if (/^applicationState/.test(k)) { onState(k, nv); continue; }
      if (k === "automationTabId") { ctx.autoTab = nv == null ? null : nv; saveCtx(); }
      if (k === "globalTabId" && nv != null) { ctx.dashTab = Number(nv); saveCtx(); }
      if (k === "lazyEmailLog") {
        const last = Array.isArray(nv) ? nv[nv.length - 1] : null;
        if (last) log("email", /sent|success/.test(last.status) ? "info" : "warn", "Referral log: " + (last.text || last.status), last);
        continue;
      }
      if (k === "lazyLastRun" && nv) { log("run", "info", "Run report: " + Object.entries(nv.counts || {}).filter((x) => x[1]).map((x) => x[0] + " " + x[1]).join(", "), { counts: nv.counts, reasons: nv.reasons, total: nv.total }, { job: null }); continue; }
      if (k === "allLinks") { log("state", "info", "Scanned job list: " + (Array.isArray(nv) ? nv.length : 0) + " links"); continue; }
      if (k === "automationControlMessage" || k === "automationControlView") { log("panel", "debug", "Panel: " + C.clip(typeof nv === "string" ? nv : JSON.stringify(C.safe(nv, 200, 2)), 300)); continue; }
      const small = nv == null || typeof nv !== "object" ? nv : Array.isArray(nv) ? "[array " + nv.length + "]" : "[object " + Object.keys(nv).length + " keys]";
      log("storage", "debug", (nv === undefined ? "Removed " : "Set ") + k, C.SECRET_KEY.test(k) ? "[secret]" : small);
    }
  });

  // ---- messages -------------------------------------------------------------
  const QUIET = /^LAZY_DBG/;
  function msgName(r) {
    if (!r || typeof r !== "object") return String(r);
    return String(r.type || r.message || r.action || r.cmd || r.kind || Object.keys(r).slice(0, 4).join(","));
  }
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const name = msgName(request);
    if (request && request.type === "LAZY_DBG") {
      const tabId = sender && sender.tab ? sender.tab.id : null;
      const url = (sender && (sender.url || (sender.tab && sender.tab.url))) || "";
      const j = jobFor(tabId);
      for (const e of (request.events || []).slice(0, 500)) {
        if (!e || typeof e !== "object") continue;
        push(Object.assign({ run: ctx.run }, ctx.run ? j : {}, e, {
          ts: Number(e.ts) || Date.now(), src: "page", tab: tabId, frame: sender && sender.frameId,
          url: C.clip(C.scrubString(e.url || url), 300), msg: C.clip(C.scrubString(e.msg || ""), 800),
          data: e.data === undefined ? undefined : C.safe(e.data, e.cat === "ai" || e.cat === "snapshot" ? 8000 : 2000, 6),
        }));
      }
      sendResponse({ ok: true });
      return;
    }
    if (request && request.type === "LAZY_DBG_HELLO") {
      const tabId = sender && sender.tab ? sender.tab.id : null;
      const url = (sender && sender.tab && sender.tab.url) || sender.url || "";
      ready.then(() => sendResponse({ on: settings.on, level: settings.level, full: request.injected || isTracked(tabId, url) || !!ctx.run }));
      return true;
    }
    if (request && request.type === "LAZY_OPEN_DEBUGGER") {
      chrome.tabs.create({ url: chrome.runtime.getURL("debugger.html") + (request.run ? "#run=" + encodeURIComponent(request.run) : "") });
      return;
    }
    if (request && request.type === "LAZY_DBG_SNAPSHOT_ALL") {
      snapshotAll(request.why || "Snapshot asked for in the Debugger").then((n) => sendResponse({ tabs: n }));
      return true;
    }
    if (QUIET.test(name)) return;
    const tabId = sender && sender.tab ? sender.tab.id : null;
    log("msg", "debug", "Message " + name + (sender && sender.tab ? " from tab " + tabId : sender && sender.url ? " from " + C.clip(sender.url.replace(/^chrome-extension:\/\/[^/]+\//, ""), 60) : ""), request, Object.assign({ tab: tabId, url: C.clip(C.scrubString((sender && sender.url) || ""), 300) }, ctx.run ? jobFor(tabId) : {}));
  });

  // ---- page snapshots on request ---------------------------------------------
  async function snapshot(tabId, why, wait) {
    if (tabId == null) return false;
    try {
      const p = chrome.tabs.sendMessage(tabId, { type: "LAZY_DBG_SNAPSHOT", why });
      p.catch(() => {});
      await Promise.race([p, new Promise((r) => setTimeout(r, wait || 1500))]);
      return true;
    } catch (e) {
      return false;
    }
  }
  async function snapshotAll(why) {
    const ids = new Set([ctx.autoTab]);
    try { const P = g.LazyParallel._internal.run; if (P) Object.keys(P.workers).forEach((k) => ids.add(Number(k))); } catch (e) {}
    openers.forEach((o, id) => { if (ids.has(o)) ids.add(id); });
    let n = 0;
    for (const id of ids) if (id != null && (await snapshot(id, why, 2000))) n++;
    return n;
  }

  // ---- tabs, navigation, injected scripts ---------------------------------------
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.openerTabId != null) openers.set(tab.id, tab.openerTabId);
    if (isTracked(tab.openerTabId) || isTracked(tab.id, tab.pendingUrl || tab.url)) log("tab", "info", "Tab " + tab.id + " opened" + (tab.openerTabId != null ? " by tab " + tab.openerTabId : "") + ": " + C.clip(C.scrubString(tab.pendingUrl || tab.url || ""), 200), undefined, Object.assign({ tab: tab.id }, jobFor(tab.id)));
  });
  chrome.tabs.onRemoved.addListener((tabId, info) => {
    if (isTracked(tabId)) log("tab", tabId === ctx.autoTab && ctx.run ? "warn" : "info", "Tab " + tabId + " closed" + (info && info.isWindowClosing ? " (window closed)" : ""), undefined, Object.assign({ tab: tabId }, jobFor(tabId)));
    openers.delete(tabId);
  });
  if (chrome.webNavigation) {
    chrome.webNavigation.onCommitted.addListener((d) => {
      if (d.frameId !== 0 || !isTracked(d.tabId, d.url)) return;
      log("nav", "info", "Page opened: " + C.clip(C.scrubString(d.url), 300), { how: d.transitionType, qualifiers: d.transitionQualifiers }, Object.assign({ tab: d.tabId, url: C.clip(C.scrubString(d.url), 300) }, jobFor(d.tabId)));
    });
    chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
      if (d.frameId !== 0 || !isTracked(d.tabId, d.url)) return;
      log("nav", "debug", "Address changed in page: " + C.clip(C.scrubString(d.url), 300), undefined, Object.assign({ tab: d.tabId, url: C.clip(C.scrubString(d.url), 300) }, jobFor(d.tabId)));
    });
    chrome.webNavigation.onErrorOccurred.addListener((d) => {
      if (!isTracked(d.tabId, d.url) || /ERR_ABORTED/.test(d.error)) return;
      log("nav", "error", "Page failed to load (" + d.error + "): " + C.clip(C.scrubString(d.url), 300), { frame: d.frameId }, Object.assign({ tab: d.tabId, url: C.clip(C.scrubString(d.url), 300) }, jobFor(d.tabId)));
    });
  }

  // Wrap a chrome API method so each call is recorded (arguments summarised).
  function wrap(obj, name, label, summarise) {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== "function" || orig.__lazyDbg) return;
      const w = function () {
        try { const s = summarise(arguments); if (s) log(s.cat || "tab", s.lvl || "debug", s.msg, s.data, s.extra); } catch (e) {}
        const out = orig.apply(this, arguments);
        if (out && typeof out.catch === "function") out.catch((err) => { log("tab", "warn", label + " failed: " + ((err && err.message) || err)); });
        return out;
      };
      w.__lazyDbg = true;
      obj[name] = w;
    } catch (e) {}
  }
  const tabLabel = (id) => (id === ctx.autoTab ? "automation tab " + id : id === ctx.dashTab ? "dashboard tab " + id : "tab " + id);
  wrap(chrome.tabs, "create", "Open tab", (a) => ({ lvl: "info", msg: "Open tab: " + C.clip(C.scrubString((a[0] && a[0].url) || ""), 200), data: a[0] }));
  wrap(chrome.tabs, "update", "Update tab", (a) => {
    const id = typeof a[0] === "number" ? a[0] : null;
    const p = typeof a[0] === "object" ? a[0] : a[1];
    return { lvl: p && p.url ? "info" : "debug", msg: (p && p.url ? "Load in " + tabLabel(id) + ": " + C.clip(C.scrubString(p.url), 200) : "Update " + tabLabel(id)), data: p, extra: Object.assign({ tab: id }, jobFor(id)) };
  });
  wrap(chrome.tabs, "remove", "Close tab", (a) => ({ lvl: "info", msg: "Close " + [].concat(a[0]).map(tabLabel).join(", "), extra: { tab: typeof a[0] === "number" ? a[0] : null } }));
  wrap(chrome.tabs, "sendMessage", "Message to tab", (a) => {
    if (a[1] && a[1].type === "LAZY_DBG_SNAPSHOT") return null;
    return { cat: "msg", msg: "Message to " + tabLabel(a[0]) + ": " + msgName(a[1]), data: a[1], extra: Object.assign({ tab: a[0] }, jobFor(a[0])) };
  });
  if (chrome.windows) wrap(chrome.windows, "create", "Open window", (a) => ({ lvl: "info", msg: "Open window" + (a[0] && a[0].url ? ": " + C.clip(String(a[0].url), 200) : ""), data: a[0] }));
  if (chrome.scripting) wrap(chrome.scripting, "executeScript", "Inject script", (a) => {
    const d = a[0] || {};
    const id = d.target && d.target.tabId;
    return { cat: "inject", msg: "Inject " + (d.files ? d.files.join(", ") : d.func ? "function " + (d.func.name || "") : "?") + " into " + tabLabel(id) + (d.target && d.target.allFrames ? " (all frames)" : ""), extra: Object.assign({ tab: id }, jobFor(id)) };
  });

  // ---- network ----------------------------------------------------------------
  if (typeof g.fetch === "function" && !g.fetch.__lazyDbg) {
    const of = g.fetch;
    const f = function (input, init) {
      const url = C.scrubString(typeof input === "string" ? input : (input && input.url) || String(input));
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const lazy = /lazyapply\.com/.test(url);
      const started = Date.now();
      const extra = { url: C.clip(url, 300) };
      let body;
      if (lazy && init && typeof init.body === "string") { try { body = JSON.parse(init.body); } catch (e) { body = init.body; } }
      const p = of.apply(this, arguments);
      p.then((res) => {
        const ms = Date.now() - started;
        const lvl = res.ok ? (lazy ? "info" : "debug") : res.status >= 500 || res.status === 0 ? "error" : "warn";
        if (lazy) {
          res.clone().text().then((t) => {
            let parsed = t;
            try { parsed = JSON.parse(t); } catch (e) {}
            log("net", lvl, method + " " + res.status + " " + ms + "ms " + C.clip(url.replace(/^https:\/\//, ""), 160), { request: body, response: parsed }, extra);
          }).catch(() => log("net", lvl, method + " " + res.status + " " + ms + "ms " + C.clip(url, 160), { request: body }, extra));
        } else log("net", lvl, method + " " + res.status + " " + ms + "ms " + C.clip(url.replace(/^https:\/\//, ""), 160), undefined, extra);
      }, (err) => {
        log("net", "error", method + " FAILED " + (Date.now() - started) + "ms " + C.clip(url, 160) + ": " + ((err && err.message) || err), { request: body }, extra);
      });
      return p;
    };
    f.__lazyDbg = true;
    g.fetch = f;
  }

  // ---- background errors and console --------------------------------------------
  const LV = { error: "error", warn: "warn", log: "debug", info: "debug", debug: "debug" };
  for (const k of Object.keys(LV)) {
    const o = console[k];
    if (typeof o !== "function" || o.__lazyDbg) continue;
    const w = function () {
      try {
        const args = Array.prototype.slice.call(arguments);
        const text = args.map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : JSON.stringify(C.safe(a, 300, 3)))).join(" ");
        const err = args.find((a) => a instanceof Error);
        log("console", LV[k], text, err ? { stack: C.clip(err.stack || "", 3000) } : args.length > 1 ? args.slice(1) : undefined);
      } catch (e) {}
      return o.apply(this, arguments);
    };
    w.__lazyDbg = true;
    console[k] = w;
  }
  g.addEventListener("error", (e) => log("error", "error", "Background error: " + ((e && e.message) || e), { file: e && e.filename, line: e && e.lineno, col: e && e.colno, stack: e && e.error && C.clip(e.error.stack || "", 3000) }));
  g.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    log("error", "error", "Background promise failed: " + ((r && r.message) || String(r)), { stack: r && C.clip(r.stack || "", 3000) });
  });

  if (chrome.commands) chrome.commands.onCommand.addListener((c) => { if (c === "open-debugger") chrome.tabs.create({ url: chrome.runtime.getURL("debugger.html") }); });
  if (chrome.alarms) chrome.alarms.onAlarm.addListener((a) => log("bg", "debug", "Alarm " + a.name));

  log("bg", "info", "Background started (extension " + chrome.runtime.getManifest().version + ")", { ua: (g.navigator && navigator.userAgent) || "" }, { job: null });

  g.LazyDebug = { log, snapshot, snapshotAll, flush, ready, get ctx() { return ctx; }, get settings() { return settings; }, _internal: { onState, shape, jobFor, isTracked, openers, prev, t0 } };
})(self);
