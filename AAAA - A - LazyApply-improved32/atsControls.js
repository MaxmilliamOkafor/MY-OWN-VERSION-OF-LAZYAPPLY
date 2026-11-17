/*
 * Safer Workday form controls for the application script.
 *
 * The application script fills Workday dropdowns, search lists and date
 * boxes. This file runs before it and gives it a few careful helpers, using
 * methods from the user's own Workday engine:
 *
 *  - Dropdowns: pick the option that really matches the answer, and if none
 *    does, close the list and pick nothing. (Before, it clicked the FIRST
 *    option when nothing matched, which could answer "Yes" to a sponsorship
 *    or veteran question that was never answered.)
 *  - "Yes"/"No" answers only match options that start with yes/no, so "No"
 *    can no longer pick "Not applicable" or "None of the above".
 *  - Search lists (school, field of study): if no result shares a word with
 *    the answer, nothing is picked, instead of the first unrelated school.
 *  - Date boxes: typed in a way Workday's React fields accept (native value
 *    setter + input events + arrow-key nudge), and checked afterwards.
 *
 * Nothing here sends data anywhere; it only works on the page in front of it.
 */
(function () {
  "use strict";
  const g = typeof globalThis !== "undefined" ? globalThis : window;
  if (g.__lazyAts) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const SYNONYMS = [
    [/\bu\.?s\.?a?\.?\b|\bunited states of america\b/g, "united states"],
    [/\bu\.?k\.?\b|\bgreat britain\b/g, "united kingdom"],
    [/\bdon'?t\b/g, "do not"],
    [/\bwon'?t\b/g, "will not"],
    [/\bi'?m\b/g, "i am"],
  ];
  function norm(s) {
    let t = String(s == null ? "" : s).toLowerCase().normalize("NFKC").replace(/[’']/g, "'").trim();
    for (const [rx, rep] of SYNONYMS) t = t.replace(rx, rep);
    t = t.normalize("NFD").replace(/[̀-ͯ]+/g, "");
    return t.replace(/[^a-z0-9+ ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Ported from the Workday engine (dom.ts similarity).
  function similarity(a, b) {
    const x = norm(a);
    const y = norm(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    if (y.startsWith(x + " ") || x.startsWith(y + " ")) return 0.92;
    if ((" " + y + " ").includes(" " + x + " ") || (" " + x + " ").includes(" " + y + " ")) return 0.85;
    const tx = new Set(x.split(" "));
    const ty = new Set(y.split(" "));
    let inter = 0;
    tx.forEach((t) => ty.has(t) && inter++);
    return inter / Math.max(tx.size, ty.size);
  }

  const PLACEHOLDER = /^(select one|select|select an option|choose one|please select|make a selection|-+ ?make a selection ?-+|none selected)$/;
  const DECLINE = /(decline|do not wish|prefer not|not wish to|choose not|rather not|do not want to (answer|disclose|identify)|not to (answer|disclose|say|identify)|self identify|no answer)/;
  const yesNo = (s) => {
    const w = norm(s).split(" ")[0];
    return w === "yes" ? "yes" : w === "no" ? "no" : "";
  };

  /** Index of the option that matches `answer`, or -1 when none really does. */
  function matchIndex(options, answer, min) {
    min = min == null ? 0.6 : min;
    const want = norm(answer);
    if (!want || !Array.isArray(options)) return -1;
    const texts = options.map((o) => norm(o));
    const ok = (i) => texts[i] && !PLACEHOLDER.test(texts[i]);
    let i = texts.findIndex((t, k) => ok(k) && t === want);
    if (i !== -1) return i;
    // A plain yes/no answer only fits options that begin with yes/no.
    const yn = /^(yes|no)\b/.test(want) && want.split(" ").length <= 2 ? yesNo(want) : "";
    if (yn) {
      const hits = texts.map((t, k) => (ok(k) && yesNo(t) === yn ? k : -1)).filter((k) => k !== -1);
      if (!hits.length) return -1;
      return hits.sort((a, b) => texts[a].length - texts[b].length)[0];
    }
    // A decline answer picks the decline option.
    if (DECLINE.test(want)) {
      const d = texts.findIndex((t, k) => ok(k) && DECLINE.test(t));
      if (d !== -1) return d;
    }
    let best = -1;
    let score = 0;
    texts.forEach((t, k) => {
      if (!ok(k)) return;
      // Answers for a yes/no style option set must agree on yes/no.
      if (yesNo(want) && yesNo(t) && yesNo(want) !== yesNo(t)) return;
      const s = similarity(want, t);
      if (s > score || (s === score && best !== -1 && s > 0 && t.length < texts[best].length)) {
        score = s;
        best = k;
      }
    });
    return score >= min ? best : -1;
  }

  const textOf = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "");

  /** The best option element for `answer`, or null. */
  function bestNode(nodes, answer, min) {
    const list = Array.from(nodes || []);
    const i = matchIndex(list.map(textOf), answer, min);
    return i === -1 ? null : list[i];
  }

  /** Does any word (4+ letters) of the answer appear in the option? */
  function sharesWord(option, answer) {
    const o = new Set(norm(option).split(" "));
    return norm(answer)
      .split(" ")
      .some((w) => w.length >= 4 && o.has(w));
  }

  function escapeKey(el) {
    for (const t of ["keydown", "keyup"]) {
      const ev = new KeyboardEvent(t, { key: "Escape", code: "Escape", bubbles: true, cancelable: true });
      try {
        Object.defineProperty(ev, "keyCode", { get: () => 27 });
      } catch (e) {}
      (el || document.body).dispatchEvent(ev);
    }
  }

  function listOpen(btn) {
    const id = btn && btn.getAttribute && btn.getAttribute("aria-controls");
    const byId = id && document.getElementById(id);
    if (byId && byId.offsetParent !== null) return true;
    return btn && btn.getAttribute && btn.getAttribute("aria-expanded") === "true";
  }

  /** Close a dropdown's list without choosing anything. */
  async function closeList(btn) {
    try {
      escapeKey(btn);
      escapeKey(document.activeElement);
      await sleep(120);
      if (listOpen(btn)) {
        btn.click();
        await sleep(120);
      }
    } catch (e) {}
  }

  const nativeSet = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    if (d && d.set) d.set.call(el, v);
    else el.value = v;
  };

  /** Set a Workday date part (month/day/year spin box) so React keeps it. */
  async function setSpin(seg, value) {
    if (!seg) return false;
    const v = String(value == null ? "" : value).trim();
    if (!v) return false;
    const clean = () => String(seg.value || seg.getAttribute("aria-valuenow") || "").replace(/^0+/, "");
    const want = v.replace(/^0+/, "");
    if (clean() === want) return true;
    try {
      seg.focus();
      seg.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      // Digits as key presses first: Workday's boxes listen for them.
      for (const ch of v) {
        seg.dispatchEvent(new KeyboardEvent("keydown", { key: ch, code: "Digit" + ch, bubbles: true, cancelable: true }));
        seg.dispatchEvent(new KeyboardEvent("keyup", { key: ch, code: "Digit" + ch, bubbles: true }));
        await sleep(25);
      }
      if (clean() !== want) {
        nativeSet(seg, v);
        seg.dispatchEvent(new Event("input", { bubbles: true }));
        seg.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(40);
      }
      // Some boxes revert a set value but honour arrow keys: step to it.
      const target = Number(want);
      if (clean() !== want && Number.isFinite(target) && target > 0 && target < 3000) {
        const arrow = (up) => {
          const k = up ? "ArrowUp" : "ArrowDown";
          const kc = up ? 38 : 40;
          for (const t of ["keydown", "keyup"]) {
            const e = new KeyboardEvent(t, { key: k, code: k, bubbles: true, cancelable: true });
            try {
              Object.defineProperty(e, "keyCode", { get: () => kc });
            } catch (x) {}
            seg.dispatchEvent(e);
          }
        };
        const start = clean();
        arrow(true);
        await sleep(15);
        if (clean() !== start) {
          for (let i = 0; i < 120 && clean() !== want; i++) {
            arrow(Number(clean() || 0) < target);
            await sleep(10);
          }
        }
      }
      seg.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
    } catch (e) {}
    return clean() === want;
  }

  /** [[box, value], ...] one after another (month, day, year). */
  async function setDateParts(parts) {
    for (const [el, v] of parts || []) if (el) await setSpin(el, v);
    await sleep(300);
  }

  /**
   * The ATS's own "application submitted" marker on the page (from the
   * Jobright driver). Only markers that appear after a submission count.
   */
  function submittedMark() {
    try {
      const host = location.hostname;
      const seen = (doc, sel) => {
        const el = doc && doc.querySelector(sel);
        return el && textOf(el) ? el : null;
      };
      if (/myworkdayjobs\.com$|myworkday\.com$/.test(host)) {
        return !!seen(document, '[data-automation-id="congratulationsMessage"],[data-automation-id="applicationSubmittedPage"]');
      }
      if (/icims\.com$/.test(host)) {
        const frame = document.querySelector("iframe#icims_content_iframe");
        let inner = null;
        try {
          inner = frame && frame.contentDocument;
        } catch (e) {}
        for (const doc of [inner, document]) {
          if (!doc) continue;
          if (seen(doc, ".iCIMS_ConfirmMessage")) return true;
          const ok = seen(doc, ".iCIMS_SuccessMessage");
          if (ok && /submitted|thank you for applying|application (has been )?received|successfully applied/i.test(textOf(ok))) return true;
        }
      }
    } catch (e) {}
    return false;
  }

  /* ---------- job-site accounts (Workday, iCIMS) ----------
   * The application script used one built-in password for every Workday
   * account it created, and sent each new account's password to LazyApply's
   * server. Now: the password is the one saved on the "Applications Account"
   * page, or (if none is saved) a random one made on this computer; and new
   * accounts are remembered only in this browser.
   */
  const CREDS = "lazyUserAtsCredentials";
  const PW = "lazyAtsPassword";
  const ACCOUNTS = "lazyAtsAccounts";
  const acct = { loaded: false, creds: null, workdayEmail: "", pw: "", accounts: {} };
  const takeCreds = (v) =>
    v && typeof v.email === "string" && v.email.trim() && typeof v.password === "string" && v.password
      ? { email: v.email.trim(), password: v.password }
      : null;
  try {
    chrome.storage.local.get([CREDS, PW, ACCOUNTS, "workdayEmail"], (r) => {
      if (chrome.runtime.lastError || !r) return;
      acct.creds = takeCreds(r[CREDS]);
      acct.pw = typeof r[PW] === "string" ? r[PW] : "";
      acct.accounts = r[ACCOUNTS] && typeof r[ACCOUNTS] === "object" ? r[ACCOUNTS] : {};
      acct.workdayEmail = typeof r.workdayEmail === "string" ? r.workdayEmail.trim() : "";
      acct.loaded = true;
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== "local") return;
      if (ch[CREDS]) acct.creds = takeCreds(ch[CREDS].newValue);
      if (ch[PW]) acct.pw = typeof ch[PW].newValue === "string" ? ch[PW].newValue : "";
      if (ch[ACCOUNTS]) acct.accounts = ch[ACCOUNTS].newValue && typeof ch[ACCOUNTS].newValue === "object" ? ch[ACCOUNTS].newValue : {};
      if (ch.workdayEmail) acct.workdayEmail = typeof ch.workdayEmail.newValue === "string" ? ch.workdayEmail.newValue.trim() : "";
    });
  } catch (e) {}

  /** A random password that meets the usual rules (upper, lower, digit, symbol). */
  function randomPassword() {
    const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%*?"];
    const all = sets.join("");
    const rnd = new Uint32Array(18);
    crypto.getRandomValues(rnd);
    const out = sets.map((set, i) => set[rnd[i] % set.length]);
    for (let i = sets.length; i < 16; i++) out.push(all[rnd[i] % all.length]);
    for (let i = out.length - 1; i > 0; i--) {
      const j = rnd[16 + (i % 2)] % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join("");
  }

  /** The password for new job-site accounts ("" if storage has not answered yet). */
  function accountPassword() {
    if (acct.creds) return acct.creds.password;
    if (!acct.loaded) return "";
    if (!acct.pw) {
      acct.pw = randomPassword();
      try {
        chrome.storage.local.set({ [PW]: acct.pw });
      } catch (e) {}
    }
    return acct.pw;
  }

  const accountKey = (site, company) => site + ":" + String(company || "").toLowerCase();
  function rememberAccount(site, company, email, password) {
    if (!company || !email || !password) return false;
    acct.accounts = Object.assign({}, acct.accounts, { [accountKey(site, company)]: { email, password, at: Date.now() } });
    try {
      chrome.storage.local.set({ [ACCOUNTS]: acct.accounts });
    } catch (e) {}
    return true;
  }

  /** Workday: this browser's saved account for the company, else the old server lookup. */
  async function workdayAccount(company, serverLookup) {
    const a = acct.accounts[accountKey("workday", company)];
    if (a && a.email && a.password) return { found: true, email: a.email, password: a.password };
    try {
      const r = await serverLookup();
      if (r && typeof r === "object") return r;
    } catch (e) {}
    return { found: false, email: null, password: null };
  }
  const saveWorkdayAccount = async (company, email, password) => rememberAccount("workday", company, email, password);

  /** iCIMS with no saved sign-in anywhere: the user's own email + local password, never a shared login. */
  function icimsFallback(company) {
    const a = acct.accounts[accountKey("icims", company)];
    if (a && a.email && a.password) return { email: a.email, password: a.password };
    const email = acct.workdayEmail;
    const password = accountPassword();
    if (!email || !password) return null;
    rememberAccount("icims", company, email, password);
    return { email, password };
  }

  /**
   * Stands in for the bundle's call to LazyApply's people finder. When the
   * LeadOcean finder is on and returns people, those are used; otherwise the
   * original request goes ahead unchanged.
   */
  async function findPeopleFetch(url, options) {
    try {
      const body = JSON.parse((options && options.body) || "{}");
      const st = await new Promise((res) => chrome.storage.local.get("applicationState", (r) => res((r && r.applicationState) || {})));
      const link = (st.links && st.links[st.currentIndex]) || {};
      const job = { company: body.companyName || link.companyName || "", title: link.title || "", location: link.location || link.jobLocation || "" };
      const reply = await new Promise((res) => {
        const timer = setTimeout(() => res(null), 90000);
        try {
          chrome.runtime.sendMessage({ type: "LAZY_LEADOCEAN_FIND", job }, (r) => {
            clearTimeout(timer);
            res(chrome.runtime.lastError ? null : r);
          });
        } catch (e) { clearTimeout(timer); res(null); }
      });
      if (reply && reply.ok && Array.isArray(reply.people) && reply.people.length) {
        finder = "LeadOcean";
        const data = { success: true, data: { success: true, data: reply.people } };
        return { ok: true, status: 200, json: async () => data };
      }
    } catch (e) {}
    return fetch(url, options);
  }

  // ---- Job ID shown on the job page -------------------------------------
  // Referral emails quote the employer's own job ID. It is read here, while
  // the application page is open, and kept for the email step. Only a value
  // the page labels as an ID is taken; nothing is guessed.
  const looksLikeId = (v) => {
    v = String(v == null ? "" : v).trim().replace(/[.,;:)\]]+$/, "");
    if (v.length < 2 || v.length > 24 || !/\d/.test(v)) return "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) return ""; // internal posting code, no use to a referrer
    if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(v) || /^(19|20)\d{2}$/.test(v)) return ""; // a date or a year
    return v;
  };
  function jobIdFromLd(items) {
    const stack = [].concat(items || []);
    while (stack.length) {
      const o = stack.shift();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      if (o["@graph"]) stack.push(o["@graph"]);
      const type = [].concat(o["@type"] || []).join(" ");
      if (!/JobPosting/i.test(type)) continue;
      const ident = o.identifier;
      const id = looksLikeId(ident && typeof ident === "object" ? ident.value : ident);
      if (id) return id;
    }
    return "";
  }
  const ID_LABEL = /(?:^|[\s(|·•,;>])(?:job|req|requisition|reference|ref|posting|position|vacancy|opening|role)\.?[ \t]*(?:id|no|num|number|code|#)\.?[ \t]*[:#–-]?[ \t]*#?[ \t]*([A-Za-z]{0,6}[-_]?\d[A-Za-z0-9_\/-]{0,22})/i;
  const ID_SHORT = /(?:^|[\s(|·•,;>])(?:req|requisition|job)[ \t]*(?:#|:)[ \t]*([A-Za-z]{0,6}[-_]?\d[A-Za-z0-9_\/-]{0,22})/i;
  function jobIdFromText(text) {
    text = String(text || "").slice(0, 80000);
    for (const re of [ID_LABEL, ID_SHORT]) {
      const m = text.match(re);
      const id = m && looksLikeId(m[1]);
      if (id) return id;
    }
    return "";
  }
  function pageJobId(doc) {
    try {
      const wd = doc.querySelector('[data-automation-id="requisitionId"]');
      if (wd) {
        const id = looksLikeId((wd.textContent || "").replace(/^.*?(?:id|req\w*)\s*[:#]?\s*/i, "")) || jobIdFromText("job id: " + wd.textContent);
        if (id) return id;
      }
      const ld = [];
      doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => { try { ld.push(JSON.parse(el.textContent)); } catch (e) {} });
      const fromLd = jobIdFromLd(ld);
      if (fromLd) return fromLd;
      let text = (doc.body && (doc.body.innerText || doc.body.textContent)) || "";
      doc.querySelectorAll("iframe").forEach((f) => { try { text += "\n" + (f.contentDocument.body.innerText || ""); } catch (e) {} });
      return jobIdFromText(text);
    } catch (e) {
      return "";
    }
  }
  // Where the job is and which team it sits in. Used in the referral email
  // when the employer publishes no job ID (Lever and Ashby rarely do), so the
  // reader can still tell which posting is meant.
  const tidy = (v) => {
    v = String(v == null ? "" : v).replace(/\s+/g, " ").replace(/^[\s:\-\u2013|/]+|[\s:\-\u2013|/]+$/g, "").trim();
    if (v.length < 2 || v.length > 60 || v.split(" ").length > 7) return "";
    if (/[*?]|\b(resume|cv|upload|attach|select|required|enter|search|type here|apply|submit|cover letter|first name|last name|email|phone)\b/i.test(v)) return ""; // a form label, not a value
    return v;
  };
  function jobMetaFromLd(items) {
    const out = { location: "", team: "" };
    const stack = [].concat(items || []);
    while (stack.length) {
      const o = stack.shift();
      if (!o || typeof o !== "object") continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      if (o["@graph"]) stack.push(o["@graph"]);
      if (!/JobPosting/i.test([].concat(o["@type"] || []).join(" "))) continue;
      const places = [].concat(o.jobLocation || []).map((l) => {
        const a = (l && l.address) || {};
        return tidy(typeof a === "string" ? a : [a.addressLocality, a.addressRegion || a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter((x) => typeof x === "string" && x).join(", ")) || tidy(l && l.name);
      }).filter(Boolean);
      out.location = places[0] || (/TELECOMMUTE/i.test(String(o.jobLocationType || "")) ? "Remote" : "");
      return out;
    }
    return out;
  }
  function jobMetaFromText(text) {
    text = String(text || "").slice(0, 60000);
    const grab = (label) => {
      const m = text.match(new RegExp("(?:^|\\n)[ \\t]*" + label + "[ \\t]*(?::[ \\t]*|\\n[ \\t]*)([^\\n]{2,80})", "i"));
      return m ? tidy(m[1]) : "";
    };
    return { location: grab("(?:job )?locations?"), team: grab("(?:department|team)") };
  }
  function pageJobMeta(doc) {
    const out = { location: "", team: "" };
    try {
      const first = (sels) => {
        for (const sel of sels) { const el = doc.querySelector(sel); const v = el && tidy(el.textContent); if (v) return v; }
        return "";
      };
      const ld = [];
      doc.querySelectorAll('script[type="application/ld+json"]').forEach((el) => { try { ld.push(JSON.parse(el.textContent)); } catch (e) {} });
      const fromLd = jobMetaFromLd(ld);
      const text = jobMetaFromText((doc.body && (doc.body.innerText || doc.body.textContent)) || "");
      out.location = first(['.posting-categories .location', '[data-automation-id="locations"] dd', '.job__location', '.app-title + .location', '#header .location']) || fromLd.location || text.location;
      out.team = first(['.posting-categories .department', '.posting-categories .team']) || fromLd.team || text.team;
    } catch (e) {}
    return out;
  }

  function captureJobId() {
    try {
      if (g.top !== g.self) return;
      const pageId = pageJobId(document);
      const meta = pageJobMeta(document);
      chrome.storage.local.get(["applicationState", "lazyJobId"], (r) => {
        const st = (r && r.applicationState) || {};
        const index = typeof st.currentIndex === "number" ? st.currentIndex : -1;
        const prev = r && r.lazyJobId && r.lazyJobId.index === index && Date.now() - r.lazyJobId.at < 3 * 3600e3 ? r.lazyJobId : null;
        if (prev && prev.pageId === (pageId || prev.pageId) && prev.url === location.href &&
          (prev.location || "") === (meta.location || prev.location || "") && (prev.team || "") === (meta.team || prev.team || "")) return;
        chrome.storage.local.set({ lazyJobId: {
          index,
          pageId: pageId || (prev && prev.pageId) || "",
          location: meta.location || (prev && prev.location) || "",
          team: meta.team || (prev && prev.team) || "",
          firstUrl: (prev && prev.firstUrl) || location.href, // the job page, before any confirmation page
          url: location.href,
          at: Date.now(),
        } });
      });
    } catch (e) {}
  }
  try {
    if (typeof document !== "undefined" && /^https?:$/.test(location.protocol) && !/lazyapply\.com$/.test(location.hostname)) {
      [300, 2500, 7000].forEach((ms) => setTimeout(captureJobId, ms));
    }
  } catch (e) {}

  // ---- Referral email log -----------------------------------------------
  // The referral step used to pass without a trace when it did nothing. Each
  // job now leaves a line saying what happened, shown on the options page.
  function emailLog(entry) {
    try {
      chrome.runtime.sendMessage({ type: "LAZY_EMAIL_LOG", entry }, () => void chrome.runtime.lastError);
    } catch (e) {}
  }
  let gateWhy = "", finder = "LazyApply";
  /** Same test the bundle makes before the referral step, plus a check that its settings are complete. */
  function emailGate(state) {
    const d = (state && state.emailApplyDetails) || {};
    const all = d.allData || {};
    if (!state || !state.emailApplyOption) gateWhy = "Not sent: this run was started as a Direct Application, without referral emails.";
    else if (!(Number(d.creditsRemaining) > 0)) gateWhy = "Not sent: no LazyApply email credits left.";
    else if (!Array.isArray(all.positions) || !Array.isArray(all.emails) || !Array.isArray(all.templates) || !d.selectedTemplate)
      gateWhy = "Not sent: the referral settings (sender email, recipients or template) did not reach this run.";
    else gateWhy = "";
    finder = "LazyApply";
    return !gateWhy;
  }
  // Referral emails from the user's own Gmail (ownMail.js). When that is
  // switched on it takes the place of LazyApply's referral step, which needs
  // email credits; when it is off the original step runs unchanged.
  let ownHandled = false;
  // Shows a line in the "Automation In Progress" panel, the same way the bundle does.
  const panelNote = (text, link) => {
    try {
      chrome.storage.local.get("automationTabId", (r) => {
        if (!r || !r.automationTabId) return;
        chrome.runtime.sendMessage({ type: "AUTOMATION_CONTROL_TAB", tabId: r.automationTabId, message: {
          automationControlMessageMain: text, automationControlMessage: "", automationControlProgressBar: true, automationControlJobDetails: link, atsForm: true,
        } }, () => void chrome.runtime.lastError);
      });
    } catch (e) {}
  };
  // What LazyApply's "Configure Referral Options" chose for this run: the
  // template, sender and whether this is an "Application with Referral" run.
  function referralInfo(state) {
    const app = (state && state.applicationState) || {};
    const det = app.emailApplyDetails || {};
    const all = det.allData || {};
    const sel = det.selectedTemplate || null;
    const full = sel ? (Array.isArray(all.templates) && all.templates.find((t) => t && t.id === sel.id)) || sel : null;
    const template = full ? { id: full.id, name: full.name || full.label || "", subject: full.subject || "", content: full.content || full.body || "", attachResume: full.attachResume } : null;
    const selEmail = det.selectedEmail || null;
    let from = (selEmail && (selEmail.email || selEmail.label || selEmail.name)) || "";
    if (!from && selEmail && Array.isArray(all.emails)) { const e = all.emails.find((x) => x && x.id === selEmail.id); from = (e && (e.email || e.label || e.name)) || ""; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) from = "";
    return { referralRun: app.emailApplyOption === true, template, from };
  }
  const getCfg = () => new Promise((res) => { try { chrome.storage.local.get("lazyOwnMail", (r) => res((r && r.lazyOwnMail) || {})); } catch (e) { res({}); } });
  // Hands the job to ownMail.js, which sends in the background (once per job:
  // a second hand-over of the same job is ignored there).
  function queueOwnMail(state, link, resume, info) {
    const st = (state && state.applicationState) || {};
    link = link || (st.links && st.links[st.currentIndex]) || {};
    return new Promise((res) => {
      const timer = setTimeout(() => res(null), 20000);
      try {
        chrome.runtime.sendMessage({
          type: "LAZY_OWNMAIL_RUN", queue: true, referralRun: info.referralRun, template: info.template, from: info.from,
          job: { company: link.companyName || "", title: link.title || "", location: link.location || link.jobLocation || "", url: link.url || "", index: typeof st.currentIndex === "number" ? st.currentIndex : -1 },
          link: { title: link.title, companyName: link.companyName, url: link.url, jobId: link.jobId, location: link.location },
          resume: (resume && (resume.resume_data || resume)) || {},
        }, (r) => { clearTimeout(timer); res(chrome.runtime.lastError ? null : r); });
      } catch (e) { clearTimeout(timer); res(null); }
    });
  }
  // Called the moment the bundle sees the application was submitted, before
  // the later steps (another resume download, analytics) that can fail and end
  // the job early without reaching the referral step.
  async function jobSubmitted(state) {
    try {
      const info = referralInfo(state);
      if (!info.referralRun && (await getCfg()).on !== true) return;
      const st = (state && state.applicationState) || {};
      const link = (st.links && st.links[st.currentIndex]) || {};
      const reply = await queueOwnMail(state, link, null, info);
      if (reply && reply.queued && !reply.dup) panelNote("Application submitted. Referral emails queued, sending from your Gmail in the background", link);
    } catch (e) {}
  }
  // Your name, phone and links for the email, kept from the resume the
  // bundle downloads to fill the form (only in this browser).
  function rememberProfile(data) {
    try {
      if (!data || !data.personalInformation) return;
      chrome.storage.local.set({ lazyOwnMailProfile: { personalInformation: data.personalInformation, miscellaneous: data.miscellaneous || {}, at: Date.now() } });
    } catch (e) {}
  }

  async function ownMail(state, original, v2Id, token, resume, link) {
    const cfg = await getCfg();
    const info = referralInfo(state);
    if (cfg.on !== true && !info.referralRun) {
      const out = await original(state, v2Id, token);
      // Say in the panel why nothing went out, instead of moving on silently.
      if (!(out && out.emailStatus) && gateWhy) {
        const st = (state && state.applicationState) || {};
        panelNote(gateWhy + (/Direct Application|credits/.test(gateWhy) ? " To send referral emails, start the run with \"Application with Referral\": they go out from your Gmail with the template you pick there." : ""), link || (st.links && st.links[st.currentIndex]) || {});
        await new Promise((res) => setTimeout(res, 2500));
      }
      return out;
    }
    ownHandled = true;
    try {
      const st = (state && state.applicationState) || {};
      link = link || (st.links && st.links[st.currentIndex]) || {};
      const reply = await queueOwnMail(state, link, resume, info);
      if (reply && reply.handled === false) { ownHandled = false; return original(state, v2Id, token); }
      if (!(reply && reply.dup)) {
        panelNote(reply && reply.queued ? "Referral emails queued, sending from your Gmail in the background" + (reply.ahead ? " (" + reply.ahead + " job" + (reply.ahead > 1 ? "s" : "") + " ahead)" : "")
          : (reply && reply.text) || "Referral emails could not be queued (see the log in Options)", link);
        await new Promise((res) => setTimeout(res, 1200));
      }
    } catch (e) {}
    return { emailStatus: null }; // nothing to report to LazyApply: these are not its emails
  }

  function emailOutcome(status, link) {
    if (ownHandled) { ownHandled = false; return; } // ownMail.js wrote its own log lines
    const text = {
      send_success: "Referral emails finished (see the lines above for each one).",
      company_not_found: "Not sent: the people finder did not recognise this company.",
      profiles_not_found: "Not sent: the people finder found nobody at this company.",
      profiles_found: "People were found but the email window did not finish.",
      failed: "Not sent: the referral step failed or timed out.",
    }[status] || gateWhy || "Not sent: the referral step was skipped.";
    emailLog({ kind: "job", company: (link && link.companyName) || "", title: (link && link.title) || "", status: status || "skipped", text, finder: status ? finder : "" });
  }

  // "Job not found" check. The original matched any page containing the words
  // "job posting" and "closed" ("disclosed" counts, and Greenhouse's equal
  // opportunity text says "will not be disclosed"), or "listing" and "removed",
  // so live jobs were skipped at random. Only whole closing phrases count now,
  // and never on a page that shows an application form.
  const NOT_FOUND = {
    lever_not_found: [/sorry, we couldn['’]t find anything here/, /\b(?:this|the) job (?:posting|post) (?:is|has been|was) (?:closed|removed|filled)\b/, /\bjob posting (?:is )?no longer (?:available|open|active)\b/],
    rippling_not_found: [/the page you['’]re looking for doesn['’]t exist/, /the link you followed may be broken/],
    ashby_not_found: [/the page you requested was not found/, /job you requested was not found/],
    listing_removed: [/\b(?:this|the) (?:job )?listing (?:has been|was|is) (?:removed|taken down)\b/],
    wellfound_not_found: [/page no longer available \(410\)/, /page not found \(404\)/],
    workday_not_found: [/the page you are looking for doesn['’]t exist\./],
    icims_not_found: [/the requested job either does not exist or is no longer open\./],
  };
  function hasForm(doc) {
    try {
      if (doc.querySelector('input[type="file"]')) return true;
      let n = 0;
      doc.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea').forEach((el) => { if (el.offsetParent !== null) n++; });
      return n >= 3;
    } catch (e) { return false; }
  }
  function pageNotFound(text, doc) {
    text = String(text || "").toLowerCase();
    const matched = Object.keys(NOT_FOUND).filter((k) => NOT_FOUND[k].some((re) => re.test(text)));
    if (matched.length && doc && hasForm(doc)) return { isPageNotFound: false, matchedPatterns: [] };
    if (matched.length) skipLog("Skipped: the page says the job is closed or gone (" + matched.join(", ") + ").");
    return { isPageNotFound: matched.length > 0, matchedPatterns: matched };
  }
  // Apply button: the original looked once, 3 s after load, and skipped the job
  // as "expired" if the button had not rendered yet. Look up to 4 times over
  // about 10 s, scrolling to wake lazily loaded parts, before giving up.
  let applyTries = { url: "", n: 0 };
  function applyRetry() {
    if (applyTries.url !== location.href) applyTries = { url: location.href, n: 0 };
    if (++applyTries.n <= 3) return true;
    skipLog("Skipped: no Apply button found on the job page after 4 looks over about 10 seconds.");
    return false;
  }
  function applyWait() {
    try {
      const y = window.scrollY;
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
      setTimeout(() => window.scrollTo(0, y), 400);
    } catch (e) {}
    return new Promise((res) => setTimeout(res, 2500));
  }
  function skipLog(text) {
    try { if (self.__lazyDbg) { self.__lazyDbg.log("skip", "warn", text); self.__lazyDbg.snapshot(text.slice(0, 120)); } } catch (e) {}
    try {
      chrome.storage.local.get("applicationState", (r) => {
        const st = (r && r.applicationState) || {};
        const link = (st.links && st.links[st.currentIndex]) || {};
        emailLog({ kind: "skip", company: link.companyName || "", title: link.title || "", status: "job_skipped", text: text + " " + location.href.slice(0, 150) });
      });
    } catch (e) {}
  }

  g.__lazyAts = { jobSubmitted, rememberProfile, referralInfo, pageNotFound, applyRetry, applyWait, pageJobMeta, jobMetaFromText, jobMetaFromLd, ownMail, emailGate, emailOutcome, emailLog, jobIdFromText, jobIdFromLd, pageJobId, captureJobId, findPeopleFetch, accountPassword, workdayAccount, saveWorkdayAccount, icimsFallback, norm, similarity, matchIndex, bestNode, sharesWord, closeList, setSpin, setDateParts, submittedMark, textOf, version: 1 };
})();
