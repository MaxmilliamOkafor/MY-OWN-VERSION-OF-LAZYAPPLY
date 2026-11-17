/*
 * Parallel applying — worker isolation.
 *
 * When several tabs apply at once (parallelApply.js), each tab runs the same
 * application script, and that script keeps its progress in shared storage
 * keys ("applicationState", "automationTabId", ...). This file runs first in
 * the tab and gives each worker tab its own private copy of those keys, so
 * two tabs never read or overwrite each other's job.
 *
 * In a normal (single-tab) run, or in any tab that is not a worker, it
 * changes nothing: every call goes straight to chrome.storage.local.
 */
(function () {
  "use strict";
  if (window.__lazyWorkerShim) return;
  window.__lazyWorkerShim = true;
  let area;
  try {
    area = chrome.storage && chrome.storage.local;
  } catch (e) {
    return;
  }
  if (!area || area.__lazyWorkerShim) return;

  // Keys that belong to one run of the application script.
  const OWN = new Set([
    "lazyJobId",
    "applicationState",
    "automationTabId",
    "jobTimeoutSet",
    "automationControlMessage",
    "automationControlJobDetails",
    "automationControlProgressBar",
    "automationControlView",
    "pendingAnalytics",
    "missedAnswersCount",
    "selectors_main",
    "toBeClosedTabId",
    "failedEmailStatusUpdate",
    // The referral-email step's data for the job this tab is on.
    "jobDetails",
    "emailOptions",
    "templateOptions",
    "emailTemplates",
    "profiles",
  ]);
  const own = (k) => typeof k === "string" && (OWN.has(k) || k.startsWith("fingerprints_"));
  const WORKER_KEY = /@w\d+$/;

  // Which worker is this tab? Asked once per page; null = not a worker.
  let ident = null;
  const who = () => {
    if (ident) return ident;
    ident = new Promise((resolve) => {
      let tries = 0;
      const ask = () => {
        tries++;
        try {
          chrome.runtime.sendMessage({ type: "PARALLEL_WHOAMI" }, (r) => {
            if (chrome.runtime.lastError || !r) {
              // The background may be waking up: ask again a few times.
              if (tries < 5) return setTimeout(ask, 400 * tries);
              return resolve(null);
            }
            resolve(r.worker ? { sfx: "@w" + r.worker, main: !!r.main, info: r } : null);
          });
        } catch (e) {
          resolve(null);
        }
      };
      ask();
    });
    return ident;
  };

  const orig = {
    get: area.get.bind(area),
    set: area.set.bind(area),
    remove: area.remove.bind(area),
  };
  // Supports both chrome.storage styles: callback, or a returned promise.
  const both = (p, cb) => {
    if (typeof cb === "function") {
      p.then((v) => cb(v), () => cb(undefined));
      return undefined;
    }
    return p;
  };

  const toWorker = (w, k) => (w && own(k) ? k + w.sfx : k);
  // A stored entry, as this tab should see it (or undefined to hide it).
  const fromStored = (w, k) => {
    if (!w) return WORKER_KEY.test(k) ? undefined : k;
    if (k.endsWith(w.sfx)) return k.slice(0, -w.sfx.length);
    if (WORKER_KEY.test(k) || own(k)) return undefined; // another worker's, or the shared copy
    return k;
  };

  area.get = function (keys, cb) {
    return both(
      (async () => {
        const w = await who();
        if (keys == null) {
          const all = (await orig.get(null)) || {};
          const out = {};
          for (const k of Object.keys(all)) {
            const name = fromStored(w, k);
            if (name !== undefined) out[name] = all[k];
          }
          return out;
        }
        if (!w) return orig.get(keys);
        if (typeof keys === "string") {
          const r = (await orig.get(toWorker(w, keys))) || {};
          const v = r[toWorker(w, keys)];
          return v === undefined ? {} : { [keys]: v };
        }
        if (Array.isArray(keys)) {
          const r = (await orig.get(keys.map((k) => toWorker(w, k)))) || {};
          const out = {};
          for (const k of keys) if (r[toWorker(w, k)] !== undefined) out[k] = r[toWorker(w, k)];
          return out;
        }
        // { key: default, ... }
        const mapped = {};
        for (const k of Object.keys(keys)) mapped[toWorker(w, k)] = keys[k];
        const r = (await orig.get(mapped)) || {};
        const out = {};
        for (const k of Object.keys(keys)) out[k] = r[toWorker(w, k)];
        return out;
      })(),
      cb
    );
  };

  area.set = function (items, cb) {
    return both(
      (async () => {
        const w = await who();
        if (!w || !items || typeof items !== "object") return orig.set(items);
        const mapped = {};
        for (const k of Object.keys(items)) mapped[toWorker(w, k)] = items[k];
        return orig.set(mapped);
      })(),
      cb
    );
  };

  area.remove = function (keys, cb) {
    return both(
      (async () => {
        const w = await who();
        if (!w) return orig.remove(keys);
        return orig.remove(Array.isArray(keys) ? keys.map((k) => toWorker(w, k)) : toWorker(w, keys));
      })(),
      cb
    );
  };
  area.__lazyWorkerShim = true;

  // Change notifications: each tab hears about its own copy only.
  try {
    const ev = chrome.storage.onChanged;
    const origAdd = ev.addListener.bind(ev);
    const origRemove = ev.removeListener.bind(ev);
    const wrapped = new Map();
    ev.addListener = function (fn) {
      if (typeof fn !== "function" || wrapped.has(fn)) return;
      const wrap = (changes, areaName) => {
        who().then((w) => {
          if (areaName !== "local") return fn(changes, areaName);
          const out = {};
          for (const k of Object.keys(changes || {})) {
            const name = fromStored(w, k);
            if (name !== undefined) out[name] = changes[k];
          }
          if (Object.keys(out).length) fn(out, areaName);
        });
      };
      wrapped.set(fn, wrap);
      origAdd(wrap);
    };
    ev.removeListener = function (fn) {
      const wrap = wrapped.get(fn);
      if (wrap) {
        wrapped.delete(fn);
        origRemove(wrap);
      } else origRemove(fn);
    };
  } catch (e) {}

  // A small "Worker 2 of 3 · 41 of 500 done" label on each worker tab.
  function badge(w) {
    if (!w || !w.main || window.top !== window) return;
    let host = null;
    let label = null;
    const show = (p) => {
      if (!p) return;
      if (!host) {
        if (!document.body) return;
        host = document.createElement("div");
        host.id = "lazyapply-worker-badge";
        const root = host.attachShadow({ mode: "closed" });
        root.innerHTML =
          '<style>div{position:fixed;left:12px;bottom:12px;z-index:2147483646;font:600 12px/1.4 system-ui,sans-serif;' +
          "background:#4f46e5;color:#fff;padding:6px 10px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none}</style><div></div>";
        label = root.querySelector("div");
        document.body.appendChild(host);
      }
      label.textContent = `LazyApply · Tab ${p.slot} of ${p.slots} · ${p.done} of ${p.total} done` + (p.paused ? " · Paused" : "");
    };
    show(w.info.progress);
    try {
      chrome.runtime.onMessage.addListener((m) => {
        if (m && m.type === "PARALLEL_PROGRESS") show(m.progress);
      });
    } catch (e) {}
    if (!host) document.addEventListener("DOMContentLoaded", () => show(w.info.progress), { once: true });
  }
  who().then(badge);
})();
