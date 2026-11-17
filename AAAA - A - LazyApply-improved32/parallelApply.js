/*
 * Parallel applying: up to 3 tabs work through one job list at the same time.
 *
 * - Each worker is ONE tab in its own small window (side by side where the
 *   dashboard window was). The tab is reused from job to job; tabs a job
 *   opens (sign-in pop-ups, "Apply" buttons) are closed before the next job.
 *   Its own window keeps the tab visible, so Chrome does not slow it down
 *   the way it slows hidden background tabs.
 * - Each worker sees its own copy of the application script's progress
 *   (workerShim.js), so tabs never take or overwrite each other's job.
 * - Jobs are handed out one at a time from the shared list; two workers are
 *   never on the same company's site at once (sites rate-limit that).
 * - Pause / Quit in any tab applies to all of them. When the list is done the
 *   dashboard gets the same results message as a normal run.
 *
 * Only for long lists (MIN_JOBS = 400 jobs or more); shorter lists keep the
 * original single-tab run, untouched.
 * Settings: "lazyParallelTabs" in chrome.storage.local = 1, 2 or 3
 * (default 3). 1 = always the original single-tab run.
 *
 * Applications still go through the normal flow: the same application script,
 * the same LazyApply records and allowance; only the number of tabs changes.
 */
(function () {
  "use strict";
  const RUN_KEY = "lazyParallelRun";
  const SETTING_KEY = "lazyParallelTabs";
  const DEFAULT_TABS = 3;
  const MAX_TABS = 3;
  const MIN_JOBS = 400; // shorter lists keep the normal single tab
  const WATCH_ALARM = "lazyapply-parallel-watch";
  const HARD_TIMEOUT_MS = 15 * 60 * 1000; // a job still open after this is moved on from
  const PENDING = new Set(["pending", undefined, null, ""]);

  const store = chrome.storage.local;
  const g = globalThis;
  let run = null; // the active run (mirrored in storage under RUN_KEY)
  let lock = Promise.resolve();
  // Runs fn after every earlier call has finished (one change at a time).
  const serial = (fn) => {
    const p = lock.then(fn, fn);
    lock = p.catch(() => {});
    return p;
  };
  const save = () => (run ? store.set({ [RUN_KEY]: run }) : store.remove(RUN_KEY));
  const wkey = (k, tabId) => `${k}@w${tabId}`;

  let loaded = false; // has the saved run (if any) been read back yet?
  const ready = (async () => {
    try {
      const r = await store.get(RUN_KEY);
      if (r && r[RUN_KEY] && r[RUN_KEY].active) run = r[RUN_KEY];
    } catch (e) {}
    loaded = true;
  })();

  function siteKey(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.toLowerCase();
      const seg = u.pathname.split("/").filter(Boolean);
      if (/greenhouse\.io$/.test(h)) return "gh:" + (seg[0] === "embed" ? u.searchParams.get("for") || "" : seg[0] || "");
      if (/lever\.co$/.test(h)) return "lever:" + (seg[0] || "");
      if (/ashbyhq\.com$/.test(h)) return "ashby:" + (seg[0] || "");
      return h; // Workday / iCIMS / ...: one host per company
    } catch (e) {
      return String(url);
    }
  }

  async function tabsSetting() {
    try {
      const r = await store.get(SETTING_KEY);
      const n = Number(r && r[SETTING_KEY]);
      return n >= 1 && n <= MAX_TABS ? Math.floor(n) : DEFAULT_TABS;
    } catch (e) {
      return DEFAULT_TABS;
    }
  }

  const workerIds = () => (run ? Object.keys(run.workers).map(Number) : []);
  const isWorker = (tabId) => !!(run && run.workers[tabId]);

  // Main worker tab for a tab (itself, or the worker tab that opened it).
  async function workerFor(tab) {
    await ready;
    if (!run || !tab) return null;
    if (run.workers[tab.id]) return tab.id;
    let opener = tab.openerTabId;
    for (let i = 0; opener && i < 4; i++) {
      if (run.workers[opener]) return opener;
      try {
        opener = (await chrome.tabs.get(opener)).openerTabId;
      } catch (e) {
        break;
      }
    }
    return null;
  }

  function progress(slot) {
    const links = run.master.links;
    const done = links.filter((l) => !PENDING.has(l.status)).length;
    return { slot, slots: run.slots, done, total: links.length, paused: !!run.master.isPaused };
  }

  function broadcast() {
    if (!run) return;
    for (const id of workerIds()) {
      chrome.tabs.sendMessage(id, { type: "PARALLEL_PROGRESS", progress: progress(run.workers[id].slot) }).catch(() => {});
    }
  }

  // Window layout: side by side over the dashboard window's area.
  async function layout(n) {
    let b = { left: 0, top: 0, width: 1400, height: 900 };
    try {
      const { globalTabId } = await store.get("globalTabId");
      const t = globalTabId ? await chrome.tabs.get(Number(globalTabId)) : null;
      const w = t ? await chrome.windows.get(t.windowId) : await chrome.windows.getLastFocused();
      if (w && w.width) b = { left: w.left || 0, top: w.top || 0, width: w.width, height: w.height };
    } catch (e) {}
    const width = Math.max(420, Math.floor(b.width / n));
    return Array.from({ length: n }, (_, i) => ({ left: b.left + i * width, top: b.top, width, height: b.height }));
  }

  // ------------------------------------------------------------- start --
  async function start(request, links, meta) {
    const want = await tabsSetting();
    if (links.length < MIN_JOBS) return null;
    const n = Math.min(want, MAX_TABS, links.length);
    if (n <= 1) return null; // single-tab run: the original code handles it
    return serial(async () => {
      await ready;
      if (run) await stopAll(false);
      run = {
        active: true,
        slots: n,
        startedAt: Date.now(),
        workers: {},
        windows: [],
        master: {
          ...meta,
          links,
          currentIndex: 0,
          failedLinks: [],
          skippedLinks: [],
          timedOutLinks: [],
          isAutomationActive: true,
          isPaused: false,
        },
      };
      const places = await layout(n);
      const firstTabs = [];
      for (let slot = 1; slot <= n; slot++) {
        let win;
        try {
          win = await chrome.windows.create({ url: "about:blank", focused: slot === 1, ...places[slot - 1] });
        } catch (e) {
          win = await chrome.windows.create({ url: "about:blank", focused: slot === 1 }).catch(() => null);
        }
        const tab = win && win.tabs && win.tabs[0];
        if (!tab) continue;
        run.windows.push(win.id);
        run.workers[tab.id] = { slot, windowId: win.id, idx: null, site: "", claimedAt: 0, waiting: false };
        firstTabs.push(tab.id);
      }
      if (!firstTabs.length) {
        run = null;
        await save();
        return null;
      }
      await save();
      try {
        chrome.alarms.create(WATCH_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
      } catch (e) {}
      for (const id of firstTabs) await claimNext(id);
      return { tabId: firstTabs[0], tabs: firstTabs.length };
    });
  }

  // Hands the worker its next job (or parks / closes it). Call inside serial().
  async function claimNext(tabId) {
    if (!run || !run.workers[tabId]) return;
    const w = run.workers[tabId];
    w.idx = null;
    w.site = "";
    if (run.master.isPaused) {
      w.waiting = true;
      await save();
      return;
    }
    const taken = new Set(workerIds().map((id) => run.workers[id].idx).filter((i) => i != null));
    const busySites = new Set(workerIds().filter((id) => id !== tabId).map((id) => run.workers[id].site).filter(Boolean));
    const links = run.master.links;
    let pick = -1;
    let anyPending = false;
    for (let i = 0; i < links.length; i++) {
      if (!PENDING.has(links[i].status) || taken.has(i)) continue;
      anyPending = true;
      if (busySites.has(siteKey(links[i].url))) continue;
      pick = i;
      break;
    }
    if (pick < 0) {
      if (anyPending) {
        // Only jobs on a site another tab is using: wait for it.
        w.waiting = true;
        await save();
        return;
      }
      // Nothing left for this tab: close its window to free memory.
      delete run.workers[tabId];
      await save();
      try {
        await chrome.windows.remove(w.windowId);
      } catch (e) {}
      await maybeFinish();
      return;
    }
    w.waiting = false;
    w.idx = pick;
    w.site = siteKey(links[pick].url);
    w.claimedAt = Date.now();
    w.creditsAtClaim = run.master.emailApplyDetails && typeof run.master.emailApplyDetails.creditsRemaining === "number" ? run.master.emailApplyDetails.creditsRemaining : null;
    links[pick].status = "pending";
    const state = {
      ...run.master,
      links: links.map((l) => ({ ...l })),
      currentIndex: pick,
      failedLinks: [],
      skippedLinks: [],
      timedOutLinks: [],
      isAutomationActive: true,
    };
    await store.remove([
      wkey("jobTimeoutSet", tabId),
      wkey("automationControlMessage", tabId),
      wkey("automationControlProgressBar", tabId),
      wkey("toBeClosedTabId", tabId),
    ]);
    await store.set({
      [wkey("applicationState", tabId)]: state,
      [wkey("automationTabId", tabId)]: tabId,
      [wkey("automationControlJobDetails", tabId)]: { companyName: links[pick].companyName || "", title: links[pick].title || "" },
    });
    await save();
    try {
      await g.closeAutomationChildTabs(tabId);
    } catch (e) {}
    try {
      await chrome.tabs.update(tabId, { url: links[pick].url });
    } catch (e) {
      // The tab is gone: its job goes back to the list.
      links[pick].status = "pending";
      delete run.workers[tabId];
      run.windows = run.windows.filter((x) => x !== w.windowId);
      await save();
      // Other tabs may be waiting for work, or this was the last tab.
      for (const id of workerIds()) if (run && run.workers[id] && run.workers[id].waiting) await claimNext(id);
      await maybeFinish();
      if (!run) return;
    }
    broadcast();
  }

  // The worker's job is over (done, failed, skipped or timed out): copy its
  // result into the shared list and give it the next one.
  async function finishJob(tabId, forced) {
    if (!run || !run.workers[tabId]) return;
    const w = run.workers[tabId];
    const idx = w.idx;
    if (idx == null) return;
    const key = wkey("applicationState", tabId);
    const ws = ((await store.get(key)) || {})[key];
    const link = run.master.links[idx];
    const got = ws && ws.links && ws.links[idx];
    if (got) Object.assign(link, got);
    if (forced) link.status = forced.status;
    if (PENDING.has(link.status)) link.status = "skipped"; // never handed out twice
    for (const k of ["failedLinks", "skippedLinks", "timedOutLinks"]) {
      if (ws && Array.isArray(ws[k])) run.master[k].push(...ws[k]);
    }
    if (forced && forced.list) run.master[forced.list].push(forced.entry);
    // Referral emails: each tab counts down its own copy of the credits left;
    // keep the shared count in step so tabs stop emailing when they run out.
    const used = ws && ws.emailApplyDetails && w.creditsAtClaim != null ? w.creditsAtClaim - Number(ws.emailApplyDetails.creditsRemaining) : 0;
    if (used > 0 && run.master.emailApplyDetails && typeof run.master.emailApplyDetails.creditsRemaining === "number") {
      run.master.emailApplyDetails = { ...run.master.emailApplyDetails, creditsRemaining: Math.max(0, run.master.emailApplyDetails.creditsRemaining - used) };
    }
    run.master.currentIndex = run.master.links.filter((l) => !PENDING.has(l.status)).length;
    w.idx = null;
    w.site = "";
    await save();
    await claimNext(tabId);
    // A finished job may free a site another tab was waiting for.
    for (const id of workerIds()) if (run && run.workers[id] && run.workers[id].waiting) await claimNext(id);
    broadcast();
  }

  async function maybeFinish() {
    if (!run) return;
    const left = run.master.links.some((l) => PENDING.has(l.status));
    const busy = workerIds().some((id) => run.workers[id].idx != null);
    if (busy) return;
    if (left && workerIds().length) return;
    const master = { ...run.master, isAutomationActive: false };
    const interrupted = left; // every tab closed before the list was done
    await stopAll(true);
    if (interrupted) {
      await g.handleAutomationInterrupted(master);
    } else {
      // Same results message and clean-up as a normal run.
      await store.set({ applicationState: master });
      await g.handleAutomationComplete(null);
    }
  }

  // Closes every worker window and forgets the run.
  async function stopAll(keepResults) {
    if (!run) return;
    const ids = workerIds();
    const windows = run.windows.slice();
    run = null;
    await save();
    try {
      chrome.alarms.clear(WATCH_ALARM);
    } catch (e) {}
    for (const winId of windows) {
      try {
        await chrome.windows.remove(winId);
      } catch (e) {}
    }
    // Drop every worker's private keys.
    try {
      const all = await store.get(null);
      const stale = Object.keys(all || {}).filter((k) => /@w\d+$/.test(k));
      if (stale.length) await store.remove(stale);
    } catch (e) {}
    if (!keepResults) {
      try {
        chrome.power && chrome.power.releaseKeepAwake();
      } catch (e) {}
    }
    void ids;
  }

  async function interruptAll() {
    if (!run) return;
    const master = { ...run.master, isAutomationActive: false };
    await stopAll(false);
    await g.handleAutomationInterrupted(master);
  }

  async function setPaused(paused) {
    if (!run) return;
    run.master.isPaused = paused;
    for (const id of workerIds()) {
      const key = wkey("applicationState", id);
      const ws = ((await store.get(key)) || {})[key];
      if (ws) {
        ws.isPaused = paused;
        await store.set({ [key]: ws });
      }
      chrome.tabs.sendMessage(id, { type: "AUTOMATION_STATE_CHANGED", isPaused: paused }).catch(() => {});
    }
    await save();
    if (!paused) for (const id of workerIds()) if (run && run.workers[id] && run.workers[id].waiting) await claimNext(id);
    broadcast();
  }

  // ------------------------------------------------------------ events --
  // Every message from the extension's own pages goes through here first.
  // Messages from worker tabs (and tabs they open) are handled here; all the
  // rest go to the original handler (`legacy`) exactly as before.
  const WATCHED = ["OPEN_NEXT_LINK", "AUTOMATION_COMPLETE", "AUTOMATION_CONTROL", "QUIT_AUTOMATION_BUTTON", "REMOVE_TAB_AND_MAKE_FOCUS_ON_AUTOMATION_TAB"];
  function route(request, sender, sendResponse, legacy) {
    const type = request && request.type;
    if (type === "PARALLEL_WHOAMI") {
      (async () => {
        const id = await workerFor(sender && sender.tab);
        sendResponse(id ? { worker: id, main: sender.tab.id === id, progress: progress(run.workers[id].slot) } : { worker: null });
      })();
      return true;
    }
    if (!WATCHED.includes(type)) return legacy(request, sender, sendResponse);
    (async () => {
      const id = await workerFor(sender && sender.tab); // waits for a restarted worker to reload the run
      if (!id) return legacy(request, sender, sendResponse);
      await handleWorkerMessage(id, type, request, sendResponse);
    })();
    return true;
  }

  async function handleWorkerMessage(id, type, request, sendResponse) {
    {
      if (type === "OPEN_NEXT_LINK" || type === "AUTOMATION_COMPLETE") {
        await serial(() => finishJob(id));
        sendResponse({ success: true, tabId: id });
      } else if (type === "AUTOMATION_CONTROL") {
        if (request.action === "PAUSE" || request.action === "RESUME") await serial(() => setPaused(request.action === "PAUSE"));
        sendResponse({ success: true });
      } else if (type === "QUIT_AUTOMATION_BUTTON") {
        await serial(() => interruptAll());
      } else if (type === "REMOVE_TAB_AND_MAKE_FOCUS_ON_AUTOMATION_TAB") {
        try {
          if (request.tabId && request.tabId !== id) await chrome.tabs.remove(request.tabId);
        } catch (e) {}
        try {
          await chrome.tabs.update(id, { active: true });
        } catch (e) {}
        sendResponse({ success: true, message: "Automation tab focused successfully." });
      }
    }
  }

  // "Stop" from the dashboard during a parallel run. Returns true if handled.
  // `legacyStop` is the normal single-tab stop, used when no parallel run exists.
  function stopFromDashboard(sendResponse, legacyStop) {
    if (loaded && !run) return false;
    // The extension may have just been woken by this message: wait until the
    // saved run has been read back before deciding there is none.
    ready.then(() => {
      if (!run) return legacyStop ? legacyStop() : sendResponse({ message: "stopped" });
      return serial(() => interruptAll()).then(() => sendResponse({ message: "stopped" }));
    });
    return true;
  }

  // Page loads in a worker tab: the same handling a single run's tab gets.
  async function onTabUpdated(tabId, changeInfo, tab) {
    await ready;
    if (!isWorker(tabId)) return false;
    if (!tab || !tab.url || run.workers[tabId].idx == null) return true;
    if (!(changeInfo.url || changeInfo.status === "complete")) return true;
    if (changeInfo.status === "complete" && /^https?:/i.test(tab.url)) {
      g.executeScripts(tabId, [{ file: "jquery.min.js" }, { file: "inject-autofill-template.js" }, { file: "autoFillTemplate.bundle.js" }]);
    }
    if (/^about:/i.test(tab.url)) return true;
    if (!g.isUrlInAllowedPatterns(tab.url)) {
      const url = tab.url;
      const idx = run.workers[tabId].idx;
      setTimeout(async () => {
        try {
          const cur = await chrome.tabs.get(tabId);
          if (cur.url === url && !g.isUrlInAllowedPatterns(cur.url)) {
            await serial(async () => {
              if (!run || !run.workers[tabId] || run.workers[tabId].idx !== idx) return;
              await finishJob(tabId, {
                status: "skipped",
                list: "skippedLinks",
                entry: { url: run.master.links[idx].url, timestamp: new Date().toISOString(), reason: "URL pattern not allowed" },
              });
            });
          }
        } catch (e) {}
      }, 1000);
    } else if (changeInfo.status === "complete") {
      g.processUrl(tab.url, tabId);
    }
    return true;
  }

  async function onTabRemoved(tabId) {
    await ready;
    if (!isWorker(tabId)) return;
    await serial(async () => {
      if (!run || !run.workers[tabId]) return;
      const w = run.workers[tabId];
      if (w.idx != null) {
        const link = run.master.links[w.idx];
        link.status = "skipped";
        run.master.skippedLinks.push({ url: link.url, timestamp: new Date().toISOString(), reason: "Tab closed" });
      }
      delete run.workers[tabId];
      run.windows = run.windows.filter((x) => x !== w.windowId);
      await save();
      await maybeFinish();
      broadcast();
    });
  }

  // Every minute: move on from jobs that are stuck.
  async function watch() {
    await ready;
    if (!run) {
      try {
        chrome.alarms.clear(WATCH_ALARM);
      } catch (e) {}
      return;
    }
    await serial(async () => {
      for (const id of workerIds()) {
        if (!run || !run.workers[id]) continue;
        const w = run.workers[id];
        if (w.idx == null) {
          if (w.waiting && !run.master.isPaused) await claimNext(id);
          continue;
        }
        if (run.master.isPaused) continue;
        const key = wkey("jobTimeoutSet", id);
        const jt = ((await store.get(key)) || {})[key];
        const late = (jt && jt.time && Date.now() - jt.time > jt.timeoutMs) || Date.now() - w.claimedAt > HARD_TIMEOUT_MS;
        if (!late) continue;
        const link = run.master.links[w.idx];
        chrome.tabs
          .sendMessage(id, {
            type: "AUTOMATION_CONTROL_MESSAGE",
            message: { automationControlMessageMain: "Application took too long", automationControlMessage: "Moving to the next job...", automationControlProgressBar: false },
          })
          .catch(() => {});
        await finishJob(id, {
          status: "timeout",
          list: "timedOutLinks",
          entry: { url: link.url, timestamp: new Date().toISOString(), jobBoard: link.jobBoard || "unknown", title: link.title || "unknown" },
        });
      }
    });
  }

  try {
    chrome.alarms.onAlarm.addListener((a) => {
      if (a && a.name === WATCH_ALARM) watch();
    });
  } catch (e) {}
  chrome.tabs.onRemoved.addListener((tabId) => {
    onTabRemoved(tabId);
  });

  // Storage keys the original handlers should use for a message: the
  // sender's private copy when it is a worker tab.
  async function keysFor(sender) {
    const id = sender && sender.tab ? await workerFor(sender.tab) : null;
    return id
      ? { state: wkey("applicationState", id), pending: wkey("pendingAnalytics", id) }
      : { state: "applicationState", pending: "pendingAnalytics" };
  }

  // A worker's Workday page stopped moving (see atsControls.js): leave it now.
  async function skipStuck(id, reason, url) {
    let done = false, paused = false;
    await serial(async () => {
      if (!run || !run.workers[id] || run.workers[id].idx == null) return;
      if (run.master.isPaused) { paused = true; return; }
      const w = run.workers[id];
      const link = run.master.links[w.idx];
      chrome.tabs
        .sendMessage(id, {
          type: "AUTOMATION_CONTROL_MESSAGE",
          message: { automationControlMessageMain: "Workday got stuck (" + reason + ")", automationControlMessage: "Moving to the next job...", automationControlProgressBar: false },
        })
        .catch(() => {});
      await finishJob(id, {
        status: "skipped",
        list: "skippedLinks",
        entry: { url: link.url, timestamp: new Date().toISOString(), reason: "Stuck: " + reason },
      });
      done = true;
    });
    return { skipped: done, paused };
  }

  g.LazyParallel = {
    MIN_JOBS,
    ready,
    start,
    skipStuck,
    route,
    stopFromDashboard,
    onTabUpdated,
    isWorker: (id) => isWorker(id),
    keysFor,
    siteKey,
    _internal: { get run() { return run; }, claimNext, finishJob, watch, onTabRemoved, serial },
  };
})();
