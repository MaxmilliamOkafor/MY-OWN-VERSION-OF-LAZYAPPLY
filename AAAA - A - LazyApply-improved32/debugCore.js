/*
 * Debugger core, shared by the background recorder (debugRecorder.js), the
 * page recorder (debugHook.js) and the Debugger page (debugger.js).
 *
 * Everything recorded stays in this browser. Secrets are never recorded:
 * passwords, LazyApply / Google / LeadOcean tokens, API keys, cookies and
 * Authorization headers are replaced by "[secret]" before an event is made.
 * mask() additionally hides personal details (emails, phone numbers, profile
 * links) for exports you want to share.
 */
(function (g) {
  "use strict";
  if (g.__lazyDbgCore) return;

  const SECRET_KEY = /pass(word|wd)?|secret|token|authori[sz]ation|cookie|api[-_]?key|apikey|bearer|credential|otp|refresh|jwt|session[-_]?id|private[-_]?key|client[-_]?secret|^key$|^code$|^pin$/i;
  const SECRET_VAL = [
    [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}/g, "[secret]"], // JWT
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, "Bearer [secret]"],
    [/\bya29\.[A-Za-z0-9._-]{20,}/g, "[secret]"], // Google OAuth access token
    [/\b(sk|pk|lo|key)[-_](live|test)?[-_]?[A-Za-z0-9]{20,}/g, "[secret]"],
    [/([?&](?:token|access_token|key|api_key|apikey|auth|sig|signature|code|password)=)[^&#\s"]+/gi, "$1[secret]"],
  ];

  function scrubString(s) {
    s = String(s);
    for (const [re, rep] of SECRET_VAL) s = s.replace(re, rep);
    return s;
  }

  /**
   * A copy of v that is safe and small: secrets removed, strings cut to
   * `max` characters, at most `depth` levels and 60 keys / items per level.
   */
  function safe(v, max, depth, seen) {
    max = max || 1500;
    depth = depth == null ? 5 : depth;
    if (v == null || typeof v === "boolean" || typeof v === "number") return v;
    if (typeof v === "string") return clip(scrubString(v), max);
    if (typeof v === "bigint") return String(v);
    if (typeof v === "function") return "[function " + (v.name || "") + "]";
    if (typeof v === "symbol") return String(v);
    try {
      if (typeof Element !== "undefined" && v instanceof Element) return describe(v);
      if (typeof Event !== "undefined" && v instanceof Event) return { event: v.type, target: v.target && v.target.nodeType === 1 ? describe(v.target) : undefined };
      if (typeof Window !== "undefined" && v instanceof Window) return "[window]";
      if (typeof Node !== "undefined" && v instanceof Node) return "[" + v.nodeName + "]";
    } catch (e) {}
    if (v instanceof Error) return { error: v.name, message: clip(scrubString(v.message), max), stack: clip(scrubString(v.stack || ""), 3000) };
    if (depth <= 0) return Array.isArray(v) ? "[array " + v.length + "]" : "[object]";
    seen = seen || new WeakSet();
    if (seen.has(v)) return "[circular]";
    seen.add(v);
    if (Array.isArray(v)) {
      const out = v.slice(0, 60).map((x) => safe(x, max, depth - 1, seen));
      if (v.length > 60) out.push("… " + (v.length - 60) + " more");
      return out;
    }
    if (typeof File !== "undefined" && v instanceof File) return { file: v.name, size: v.size, type: v.type };
    if (typeof Blob !== "undefined" && v instanceof Blob) return { blob: v.size, type: v.type };
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (++n > 60) { out["…"] = Object.keys(v).length - 60 + " more keys"; break; }
      let x;
      try { x = v[k]; } catch (e) { x = "[unreadable]"; }
      out[k] = SECRET_KEY.test(k) && x != null && x !== "" && typeof x !== "boolean" ? "[secret]" : safe(x, max, depth - 1, seen);
    }
    return out;
  }

  function clip(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "… (" + (s.length - n) + " more chars)" : s;
  }

  // Short text that tells which element it is.
  function describe(el) {
    try {
      if (!el || el.nodeType !== 1) return String(el);
      const t = el.tagName.toLowerCase();
      const a = (n) => el.getAttribute && el.getAttribute(n);
      let s = t;
      if (el.id) s += "#" + clip(el.id, 60);
      const da = a("data-automation-id") || a("data-qa") || a("data-testid");
      if (da) s += "[" + clip(da, 50) + "]";
      if (a("name")) s += "[name=" + clip(a("name"), 40) + "]";
      if (t === "input" && a("type")) s += "[type=" + a("type") + "]";
      const label = labelOf(el) || a("aria-label") || (/^(button|a|label|span|div|li|option)$/.test(t) ? (el.innerText || el.textContent || "") : "");
      if (label) s += ' "' + clip(String(label).replace(/\s+/g, " ").trim(), 80) + '"';
      return s;
    } catch (e) {
      return "[element]";
    }
  }

  // The visible question / label of a form field.
  function labelOf(el) {
    try {
      if (!el || el.nodeType !== 1) return "";
      const doc = el.ownerDocument;
      const by = el.getAttribute("aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean).map((x) => x.textContent).join(" ").trim();
        if (t) return t.replace(/\s+/g, " ").slice(0, 160);
      }
      if (el.id) {
        const l = doc.querySelector('label[for="' + (g.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
        if (l && l.textContent.trim()) return l.textContent.replace(/\s+/g, " ").trim().slice(0, 160);
      }
      const wrap = el.closest("label");
      if (wrap && wrap.textContent.trim()) return wrap.textContent.replace(/\s+/g, " ").trim().slice(0, 160);
      const al = el.getAttribute("aria-label") || el.getAttribute("placeholder");
      if (al) return al.slice(0, 160);
      const fs = el.closest("fieldset, [role=group], .field, .form-group, .application-question, [data-automation-id*='formField']");
      if (fs) {
        const lg = fs.querySelector("legend, label, .label, [class*='label']");
        if (lg && lg.textContent.trim()) return lg.textContent.replace(/\s+/g, " ").trim().slice(0, 160);
      }
    } catch (e) {}
    return "";
  }

  // A field's value as it may be recorded (never a password).
  function fieldValue(el, v) {
    try {
      const type = String((el && el.type) || "").toLowerCase();
      const hint = ((el && (el.name || el.id || el.autocomplete)) || "") + " " + labelOf(el);
      if (type === "password" || SECRET_KEY.test(hint) || /one.?time|verification code|security code|cvv|card number|iban|ssn|social security/i.test(hint)) return "[secret]";
    } catch (e) {}
    return clip(scrubString(v == null ? "" : v), 400);
  }

  // Personal details out, for an export you share.
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const PHONE = /(?<![\w/.-])\+?\d[\d ().-]{7,}\d(?![\w/-])/g;
  const PROFILE = /(linkedin\.com\/in\/|github\.com\/|twitter\.com\/|x\.com\/)[A-Za-z0-9_.%-]+/gi;
  function maskString(s, extra) {
    s = String(s).replace(EMAIL, "[email]").replace(PROFILE, "$1[me]");
    // A phone number has a + or separators, or starts with 0; plain long
    // numbers (tab ids, job ids, timestamps) stay.
    s = s.replace(PHONE, (m) => (/^\d{4}-\d{2}-\d{2}/.test(m) || m.replace(/\D/g, "").length < 9 || !/^\+|^0|[ ().-]/.test(m) ? m : "[phone]"));
    for (const w of extra || []) if (w && w.length >= 3) s = s.split(w).join("[me]");
    return s;
  }
  function mask(v, extra) {
    if (typeof v === "string") return maskString(v, extra);
    if (Array.isArray(v)) return v.map((x) => mask(x, extra));
    if (v && typeof v === "object") {
      const o = {};
      for (const k of Object.keys(v)) o[k] = mask(v[k], extra);
      return o;
    }
    return v;
  }

  g.__lazyDbgCore = { safe, clip, describe, labelOf, fieldValue, scrubString, mask, maskString, SECRET_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = g.__lazyDbgCore;
})(typeof self !== "undefined" ? self : globalThis);
