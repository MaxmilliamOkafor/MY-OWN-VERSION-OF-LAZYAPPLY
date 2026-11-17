/*
 * Debugger, page half. Runs in the extension's own script space of every page
 * the extension works in (job sites, application forms, the dashboard), so it
 * sees what the extension's scripts do there, and nothing the website does:
 *  - every click the automation makes and every event it fires;
 *  - every field it fills (label and value; passwords and codes never), every
 *    box it ticks, every file it attaches;
 *  - every request it makes (address, status, time; for LazyApply's server,
 *    including the AI questions and answers);
 *  - errors, failed promises and console output of the extension's scripts;
 *  - error messages that appear on the page ("This field is required");
 *  - page loads and address changes;
 *  - snapshots of the form (each field, its value, which are required or in
 *    error, visible buttons) on load, on errors and when a job is left.
 * Events go to the background (debugRecorder.js) in small batches.
 */
(function () {
  "use strict";
  if (self.__lazyDbg) return;
  const C = self.__lazyDbgCore;
  if (!C) return;
  const TOP = window.top === window;
  let mode = "pending"; // pending | full | errors | off
  let buf = [], timer = null, dropped = 0;
  let bucket = 80, bucketAt = Date.now();

  function send() {
    timer = null;
    if (mode === "pending" || mode === "off" || !buf.length) return;
    const events = buf.splice(0, 300);
    try { chrome.runtime.sendMessage({ type: "LAZY_DBG", events }, () => void chrome.runtime.lastError); } catch (e) { mode = "off"; }
    if (buf.length) timer = setTimeout(send, 200);
  }
  function emit(cat, lvl, msg, data) {
    if (mode === "off") return;
    const important = lvl === "error" || lvl === "warn";
    if (mode === "errors" && !important && cat !== "snapshot") return;
    const now = Date.now();
    bucket = Math.min(80, bucket + ((now - bucketAt) / 1000) * 60);
    bucketAt = now;
    if (bucket < 1 && !important) { dropped++; return; }
    bucket--;
    if (dropped) { buf.push({ ts: now, cat: "debugger", lvl: "debug", msg: dropped + " events not recorded (too many at once)" }); dropped = 0; }
    const e = { ts: now, cat, lvl: lvl || "info", msg: String(msg == null ? "" : msg).slice(0, 800) };
    if (!TOP) e.url = location.href.slice(0, 300);
    if (data !== undefined) e.data = C.safe(data, cat === "ai" || cat === "snapshot" ? 8000 : 1500, 6);
    if (mode === "pending") { if (buf.length < 800) buf.push(e); return; }
    buf.push(e);
    if (!timer) timer = setTimeout(send, buf.length > 100 ? 50 : 500);
  }

  // Asks the background how much to record here. A page that is not part of
  // a run yet (opened before the run started) records only errors and asks
  // again every few seconds, so it records everything once a run uses it.
  let wantFull = false;
  function hello() {
    try {
      chrome.runtime.sendMessage({ type: "LAZY_DBG_HELLO" }, (r) => {
        if (chrome.runtime.lastError || !r) { if (mode === "pending") { mode = "off"; buf = []; } return; }
        if (!r.on) { mode = "off"; buf = []; wantFull = false; return; }
        wantFull = !!r.full && r.level !== "errors";
        const was = mode;
        mode = wantFull ? "full" : "errors";
        if (mode === "errors") buf = buf.filter((e) => e.lvl === "error" || e.lvl === "warn" || e.cat === "snapshot");
        if (was === "errors" && mode === "full") emit("debugger", "debug", "This page is now part of a run: recording everything");
        send();
      });
    } catch (e) { mode = "off"; }
  }
  hello();
  let asks = 0;
  setInterval(() => { asks++; if (!wantFull && (asks < 40 || asks % 5 === 0)) hello(); }, 3000); // every 3 s for 2 min, then every 15 s

  // ---- errors -----------------------------------------------------------------
  window.addEventListener("error", (e) => {
    const t = e && e.target;
    if (t && t !== window && t.nodeType === 1) {
      emit("page", "debug", "Resource failed to load: " + C.describe(t) + " " + String(t.src || t.href || "").slice(0, 200));
      return;
    }
    emit("error", "error", "Script error: " + (e.message || "?") + (e.filename ? " (" + String(e.filename).replace(/^chrome-extension:\/\/[^/]+\//, "") + ":" + e.lineno + ":" + e.colno + ")" : ""), { stack: e.error && e.error.stack });
    shotSoon("After a script error");
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    const r = e && e.reason;
    emit("error", "error", "Promise failed: " + ((r && r.message) || String(r)).slice(0, 400), { stack: r && r.stack });
    shotSoon("After a failed promise");
  });

  // ---- console of the extension's scripts ---------------------------------------
  const LV = { error: "error", warn: "warn", log: "debug", info: "debug", debug: "debug" };
  for (const k of Object.keys(LV)) {
    const o = console[k];
    if (typeof o !== "function" || o.__lazyDbg) continue;
    const w = function () {
      try {
        const a = Array.prototype.slice.call(arguments);
        const text = a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.name + ": " + x.message : (() => { try { return JSON.stringify(C.safe(x, 300, 3)); } catch (e) { return String(x); } })())).join(" ");
        const err = a.find((x) => x instanceof Error);
        emit("console", LV[k], text.slice(0, 800), err ? { stack: err.stack } : undefined);
      } catch (e) {}
      return o.apply(this, arguments);
    };
    w.__lazyDbg = true;
    console[k] = w;
  }

  // ---- what the automation does to the page ---------------------------------------
  const lastVal = new WeakMap();
  function noteValue(el, prop, v) {
    if (!el || el.nodeType !== 1) return;
    const key = prop + ":" + String(v).slice(0, 200);
    if (lastVal.get(el) === key) return;
    lastVal.set(el, key);
    const label = C.labelOf(el) || C.describe(el);
    if (prop === "checked") emit("field", "info", (v ? "Ticked " : "Unticked ") + '"' + label.slice(0, 160) + '"' + (el.value && el.value !== "on" ? " (" + C.fieldValue(el, el.value) + ")" : ""), { el: C.describe(el) });
    else if (prop === "files") {
      const list = v && v.length ? Array.prototype.map.call(v, (f) => f.name + " (" + Math.round(f.size / 1024) + " KB)").join(", ") : "none";
      emit("field", "info", 'Attached file to "' + label.slice(0, 120) + '": ' + list, { el: C.describe(el) });
    } else if (prop === "selectedIndex") {
      const o = el.options && el.options[v];
      emit("field", "info", 'Chose "' + (o ? o.text : v) + '" in "' + label.slice(0, 160) + '"', { el: C.describe(el) });
    } else emit("field", "info", 'Filled "' + label.slice(0, 160) + '" = ' + JSON.stringify(C.fieldValue(el, v)), { el: C.describe(el), type: el.type || el.tagName.toLowerCase() });
  }
  function hookProp(proto, prop) {
    try {
      const d = proto && Object.getOwnPropertyDescriptor(proto, prop);
      if (!d || !d.set || d.set.__lazyDbg) return;
      const set = function (v) {
        try { if (mode !== "off") noteValue(this, prop, v); } catch (e) {}
        return d.set.call(this, v);
      };
      set.__lazyDbg = true;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set });
    } catch (e) {}
  }
  hookProp(HTMLInputElement.prototype, "value");
  hookProp(HTMLInputElement.prototype, "checked");
  hookProp(HTMLInputElement.prototype, "files");
  hookProp(HTMLTextAreaElement.prototype, "value");
  hookProp(HTMLSelectElement.prototype, "value");
  hookProp(HTMLSelectElement.prototype, "selectedIndex");

  try {
    const oc = HTMLElement.prototype.click;
    if (!oc.__lazyDbg) {
      const c = function () {
        try { if (mode !== "off") emit("dom", "info", "Clicked " + C.describe(this)); } catch (e) {}
        return oc.apply(this, arguments);
      };
      c.__lazyDbg = true;
      HTMLElement.prototype.click = c;
    }
  } catch (e) {}
  try {
    const od = EventTarget.prototype.dispatchEvent;
    if (!od.__lazyDbg) {
      let last = "", lastAt = 0;
      const KEEP_KEYS = /^(Enter|Escape|Tab|ArrowDown|ArrowUp|Space| )$/;
      const d = function (ev) {
        try {
          if (mode !== "off" && ev && this && this.nodeType === 1) {
            const t = ev.type;
            const key = t + "|" + (this.id || this.tagName);
            const now = Date.now();
            const keyEv = /^key/.test(t);
            if (!(keyEv && !KEEP_KEYS.test(ev.key || "")) && !(key === last && now - lastAt < 400) && !/^(pointermove|mousemove|mouseover|mouseout|mouseenter|mouseleave|pointerover|pointerout|scroll|wheel)$/.test(t)) {
              last = key; lastAt = now;
              emit("dom", /^(click|submit|change)$/.test(t) ? "info" : "debug", "Fired " + t + (keyEv ? " " + ev.key : "") + " on " + C.describe(this));
            }
          }
        } catch (e) {}
        return od.apply(this, arguments);
      };
      d.__lazyDbg = true;
      EventTarget.prototype.dispatchEvent = d;
    }
  } catch (e) {}
  try {
    const os = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      try { emit("dom", "info", "Submitted form " + C.describe(this)); shot("Form submitted"); } catch (e) {}
      return os.apply(this, arguments);
    };
  } catch (e) {}

  // ---- requests made by the extension's scripts ---------------------------------------
  const isAi = (u) => /saveQuestions|answers|openai|gpt|generate/i.test(u);
  function parse(t) { if (typeof t !== "string") return t; try { return JSON.parse(t); } catch (e) { return t; } }
  function netDone(method, url, status, ms, reqBody, resText, err) {
    url = C.scrubString(String(url || ""));
    const lazy = /lazyapply\.com/.test(url);
    const lvl = err ? "error" : status >= 500 || status === 0 ? "error" : status >= 400 ? "warn" : lazy ? "info" : "debug";
    const cat = lazy && isAi(url) ? "ai" : "net";
    const msg = method + " " + (err ? "FAILED" : status) + " " + ms + "ms " + url.replace(/^https?:\/\//, "").slice(0, 160) + (err ? ": " + err : "");
    emit(cat, lvl, msg, lazy || lvl !== "debug" ? { request: parse(reqBody), response: parse(resText) } : undefined);
  }
  try {
    const of = self.fetch;
    if (typeof of === "function" && !of.__lazyDbg) {
      const f = function (input, init) {
        const url = typeof input === "string" ? input : (input && input.url) || String(input);
        const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
        const body = init && typeof init.body === "string" ? init.body : undefined;
        const t = Date.now();
        const p = of.apply(this, arguments);
        p.then((res) => {
          if (/lazyapply\.com/.test(url)) res.clone().text().then((txt) => netDone(method, url, res.status, Date.now() - t, body, txt)).catch(() => netDone(method, url, res.status, Date.now() - t, body));
          else netDone(method, url, res.status, Date.now() - t, undefined);
        }, (e) => netDone(method, url, 0, Date.now() - t, body, undefined, (e && e.message) || String(e)));
        return p;
      };
      f.__lazyDbg = true;
      self.fetch = f;
    }
  } catch (e) {}
  try {
    const X = XMLHttpRequest.prototype;
    const oo = X.open, osd = X.send;
    if (!oo.__lazyDbg) {
      X.open = function (m, u) { try { this.__lazyDbg = { m: String(m || "GET").toUpperCase(), u: String(u) }; } catch (e) {} return oo.apply(this, arguments); };
      X.open.__lazyDbg = true;
      X.send = function (body) {
        const info = this.__lazyDbg;
        if (info) {
          const t = Date.now();
          this.addEventListener("loadend", () => {
            let txt;
            try { if (/lazyapply\.com/.test(info.u) && (this.responseType === "" || this.responseType === "text")) txt = this.responseText; } catch (e) {}
            netDone(info.m, info.u, this.status, Date.now() - t, typeof body === "string" ? body : undefined, txt, this.status === 0 ? "network error or blocked" : "");
          });
        }
        return osd.apply(this, arguments);
      };
    }
  } catch (e) {}

  // ---- error messages shown on the page ---------------------------------------
  const ERR_SEL = '[role="alert"], [aria-live="assertive"], .error, .errors, .error-message, .field-error, .invalid-feedback, .helper-text--error, [data-automation-id*="error" i], [data-automation-id*="Error"], [class*="error" i]:not(input):not(textarea):not(select):not(body):not(html), [id*="error" i]:not(input)';
  const seenErr = new Set();
  let errScan = null;
  function visible(el) { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; } catch (e) { return false; } }
  function scanErrors() {
    errScan = null;
    if (mode === "off" || seenErr.size > 60) return;
    try {
      for (const el of document.querySelectorAll(ERR_SEL)) {
        if (el.querySelector(ERR_SEL)) continue; // the innermost one
        const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        if (t.length < 3 || t.length > 300 || seenErr.has(t) || !visible(el)) continue;
        seenErr.add(t);
        const field = el.closest("[role=group], fieldset, .field, .form-group, [data-automation-id*='formField'], .application-question, .field-wrapper");
        emit("page", "warn", "Page shows: " + t, field ? { near: C.clip((field.innerText || "").replace(/\s+/g, " "), 200) } : undefined);
      }
    } catch (e) {}
  }
  try {
    new MutationObserver(() => { if (!errScan) errScan = setTimeout(scanErrors, 900); }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-invalid", "class", "style", "hidden"] });
  } catch (e) {}

  // ---- form snapshots ---------------------------------------------------------------
  function snapshot(why) {
    const out = { why, url: location.href.slice(0, 300), title: document.title.slice(0, 160), frame: TOP ? "top" : "iframe" };
    try {
      const h = document.querySelector("h1, h2");
      if (h) out.heading = h.textContent.replace(/\s+/g, " ").trim().slice(0, 160);
      const fields = [];
      for (const el of document.querySelectorAll("input, textarea, select, [role=combobox], [role=listbox], button[aria-haspopup]")) {
        if (fields.length >= 150) break;
        const type = (el.type || el.getAttribute("role") || el.tagName).toLowerCase();
        if (/^(hidden|submit|button|image|reset)$/.test(type)) continue;
        const vis = visible(el);
        if (!vis && type !== "file" && type !== "checkbox" && type !== "radio") continue;
        if ((type === "radio" || type === "checkbox") && !el.checked && fields.length > 120) continue;
        const req = el.required || el.getAttribute("aria-required") === "true" || /\*\s*$/.test(C.labelOf(el));
        let v = "value" in el ? el.value : el.textContent;
        if (type === "file") v = el.files && el.files.length ? Array.prototype.map.call(el.files, (f) => f.name).join(", ") : "";
        if (type === "checkbox" || type === "radio") v = el.checked ? "checked" : "";
        if (el.tagName === "SELECT") v = el.selectedIndex >= 0 && el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : "";
        fields.push({ label: C.labelOf(el).slice(0, 140) || C.describe(el), type, required: !!req || undefined, value: C.fieldValue(el, String(v || "").trim()), empty: !String(v || "").trim() || undefined, invalid: el.getAttribute("aria-invalid") === "true" || undefined, disabled: el.disabled || undefined, hidden: !vis || undefined });
      }
      out.fields = fields;
      out.requiredEmpty = fields.filter((f) => f.required && f.empty && !f.hidden).map((f) => f.label);
      out.errors = [];
      for (const el of document.querySelectorAll(ERR_SEL)) {
        if (out.errors.length >= 30 || el.querySelector(ERR_SEL)) continue;
        const t = (el.innerText || "").replace(/\s+/g, " ").trim();
        if (t.length >= 3 && t.length <= 300 && visible(el) && !out.errors.includes(t)) out.errors.push(t);
      }
      out.buttons = Array.prototype.filter.call(document.querySelectorAll("button, [role=button], input[type=submit], a.btn, a[class*='button' i]"), visible).slice(0, 40).map((b) => (b.innerText || b.value || b.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean);
      out.text = C.clip((document.body && document.body.innerText || "").replace(/\s+/g, " ").trim(), 1500);
      out.iframes = document.querySelectorAll("iframe").length;
    } catch (e) { out.snapshotError = String(e && e.message); }
    return out;
  }
  let lastShot = 0;
  function shot(why) {
    if (mode === "off") return;
    if (!TOP && !document.querySelector("form, input, textarea, select")) return; // empty frames say nothing
    lastShot = Date.now();
    const s = snapshot(why);
    emit("snapshot", s.requiredEmpty && s.requiredEmpty.length ? "warn" : "info", why + ": " + (s.fields ? s.fields.length : 0) + " fields" + (s.requiredEmpty && s.requiredEmpty.length ? ", required and empty: " + s.requiredEmpty.slice(0, 4).join(" | ") : "") + (s.errors && s.errors.length ? ", errors shown: " + s.errors.slice(0, 3).join(" | ") : ""), s);
  }
  function shotSoon(why) { if (Date.now() - lastShot > 15000) setTimeout(() => shot(why), 300); }

  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (!req || req.type !== "LAZY_DBG_SNAPSHOT") return;
    shot(req.why || "Snapshot");
    send();
    if (TOP) sendResponse({ ok: true });
  });

  // ---- page loads and address changes -------------------------------------------------
  let href = location.href;
  if (TOP) emit("nav", "debug", "Recorder started on " + href.slice(0, 200) + " (" + document.readyState + ")");
  window.addEventListener("load", () => {
    if (TOP) emit("nav", "info", "Page loaded: " + document.title.slice(0, 120) + " — " + location.href.slice(0, 200));
    setTimeout(() => shot("Page loaded"), 4000);
  });
  setInterval(() => {
    if (location.href !== href) {
      emit("nav", "info", "Address changed: " + location.href.slice(0, 250));
      href = location.href;
      seenErr.clear();
      setTimeout(() => shot("Address changed"), 3000);
    }
  }, 1000);
  window.addEventListener("beforeunload", () => { if (TOP) emit("nav", "debug", "Leaving page " + location.href.slice(0, 200)); send(); });
  document.addEventListener("visibilitychange", () => emit("nav", "debug", "Page " + document.visibilityState));

  // ---- events from the extension's main-world scripts (dashboard search) --------------
  window.addEventListener("message", (e) => {
    const d = e && e.data;
    if (e.source !== window || !d || d.__lazyDbg !== 1) return;
    emit(String(d.cat || "page").slice(0, 20), ["error", "warn", "info", "debug"].includes(d.lvl) ? d.lvl : "info", d.msg, d.data);
  });

  self.__lazyDbg = { log: (cat, lvl, msg, data) => emit(cat, lvl, msg, data), snapshot: shot, flush: send, get mode() { return mode; } };
})();
