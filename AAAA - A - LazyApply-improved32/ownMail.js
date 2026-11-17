// Referral emails sent from the user's own Gmail (background worker).
//
// LazyApply's own referral emails need email credits, which can no longer be
// bought. This sends the same kind of email without them: people are found
// through the user's LeadOcean account (leadOcean.js), the email is written
// from the built-in template (emailVars.js), and it goes out from the user's
// own mailbox, with their CV attached, in one of two ways:
//   1. Gmail tab (no setup): a compose tab is opened with the email filled in,
//      gmailSend.js drops the CV onto it and presses Send.
//   2. Gmail connection (optional): with the user's own Google client ID the
//      email is sent directly, with no tab.
// Everything is kept in this browser. Off unless switched on in the options.
(function () {
  "use strict";
  var KEY = "lazyOwnMail"; // { on, mode: "auto" | "review", cap, clientId, linked }
  var KEY_CV = "lazyOwnMailCv"; // { name, type, base64, size }
  var KEY_TOKEN = "lazyOwnMailToken"; // { token, until }
  var KEY_DAY = "lazyOwnMailDay"; // { date, n }
  var KEY_SENT = "lazyOwnMailSent"; // addresses already written to
  var KEY_PENDING = "lazyGmailPending";
  var SCOPE = "https://www.googleapis.com/auth/gmail.send";
  var PER_JOB = 2;
  var GAP_MS = 4000; // pause between two emails

  var get = function (keys) { return chrome.storage.local.get(keys); };
  var set = function (obj) { return chrome.storage.local.set(obj); };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var validEmail = function (e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "")); };

  async function settings() {
    var r = await get([KEY, KEY_CV]);
    var v = r[KEY] || {};
    var cap = Number(v.cap);
    return {
      on: v.on === true,
      mode: v.mode === "review" ? "review" : "auto",
      cap: cap > 0 && cap <= 200 ? Math.floor(cap) : 30,
      clientId: typeof v.clientId === "string" ? v.clientId.trim() : "",
      linked: v.linked === true,
      cv: r[KEY_CV] && r[KEY_CV].base64 && r[KEY_CV].name ? r[KEY_CV] : null,
    };
  }
  function log(entry) {
    try { if (self.__lazyEmail && self.__lazyEmail.logLine) self.__lazyEmail.logLine(entry); } catch (e) {}
  }

  // ---------------- Gmail connection (optional) ----------------
  function redirectUri() {
    try { return chrome.identity.getRedirectURL(); } catch (e) { return "https://" + chrome.runtime.id + ".chromiumapp.org/"; }
  }
  function authUrl(clientId, prompt) {
    return "https://accounts.google.com/o/oauth2/v2/auth?client_id=" + encodeURIComponent(clientId) + "&response_type=token&redirect_uri=" +
      encodeURIComponent(redirectUri()) + "&scope=" + encodeURIComponent(SCOPE) + (prompt ? "&prompt=" + prompt : "");
  }
  function webFlow(url, interactive) {
    return new Promise(function (resolve) {
      try {
        chrome.identity.launchWebAuthFlow({ url: url, interactive: interactive }, function (back) {
          void chrome.runtime.lastError;
          resolve(back || "");
        });
      } catch (e) { resolve(""); }
    });
  }
  async function token(interactive) {
    var cfg = await settings();
    if (!cfg.clientId) throw new Error("No Google client ID saved.");
    var r = await get(KEY_TOKEN);
    var t = r[KEY_TOKEN];
    if (t && t.token && t.until - 60000 > Date.now()) return t.token;
    // Google reissues silently once permission has been given.
    var back = await webFlow(authUrl(cfg.clientId, "none"), false);
    if (!back && interactive) back = await webFlow(authUrl(cfg.clientId, cfg.linked ? "" : "select_account"), true);
    var params = new URLSearchParams(String(back).split("#")[1] || "");
    var tok = params.get("access_token");
    if (!tok) throw new Error(interactive ? "Google did not give permission (" + (params.get("error") || "window closed") + ")." : "Gmail connection needs renewing.");
    await set({ [KEY_TOKEN]: { token: tok, until: Date.now() + Number(params.get("expires_in") || 3600) * 1000 } });
    return tok;
  }
  function b64url(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function header(v) {
    var s = String(v || "");
    return /^[\x20-\x7E]*$/.test(s) ? s : "=?UTF-8?B?" + b64url(s).replace(/-/g, "+").replace(/_/g, "/") + "?=";
  }
  function buildRaw(m) {
    var head = ["To: " + m.to, "Subject: " + header(m.subject), "MIME-Version: 1.0"];
    if (!m.files.length) {
      head.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit");
      return b64url(head.join("\r\n") + "\r\n\r\n" + m.body);
    }
    var boundary = "lz_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    head.push('Content-Type: multipart/mixed; boundary="' + boundary + '"');
    var parts = ["--" + boundary, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit", "", m.body];
    m.files.forEach(function (f) {
      var name = header(f.name);
      parts.push("--" + boundary, "Content-Type: " + (f.type || "application/octet-stream") + '; name="' + name + '"',
        "Content-Transfer-Encoding: base64", 'Content-Disposition: attachment; filename="' + name + '"', "",
        String(f.base64).replace(/[\r\n]/g, "").replace(/(.{1,76})/g, "$1\r\n").trim());
    });
    parts.push("--" + boundary + "--");
    return b64url(head.join("\r\n") + "\r\n\r\n" + parts.join("\r\n"));
  }
  async function sendViaApi(m) {
    var tok = await token(false);
    var res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ raw: buildRaw(m) }),
    });
    if (res.status === 401) { await chrome.storage.local.remove(KEY_TOKEN); throw new Error("Gmail connection needs renewing."); }
    if (!res.ok) throw new Error("Gmail refused the email (" + res.status + ").");
    return { ok: true, via: "Gmail connection" };
  }

  // ---------------- Gmail tab (no setup) ----------------
  var waiting = {}; // id -> resolve
  var tabBroken = 0, tabFails = 0; // two "no compose window" failures in a row pause the tab route for 3 minutes
  async function sendViaTab(m, mode) {
    if (!m.test && Date.now() - tabBroken < 3 * 60000) return { ok: false, error: "Gmail did not open a compose window earlier in this run (is Gmail signed in?)." };
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await set({ [KEY_PENDING]: { id: id, at: Date.now(), to: m.to, subject: m.subject, files: m.files, autoSend: mode !== "review" } });
    // authuser picks the Gmail account chosen under "Select Email" in LazyApply,
    // when several are signed in.
    var url = "https://mail.google.com/mail/?" + (m.from ? "authuser=" + encodeURIComponent(m.from) + "&" : "") + "view=cm&fs=1&tf=1&to=" + encodeURIComponent(m.to) + "&su=" + encodeURIComponent(m.subject) + "&body=" + encodeURIComponent(m.body);
    var tab = await chrome.tabs.create({ url: url, active: false });
    var result = await new Promise(function (resolve) {
      waiting[id] = resolve;
      setTimeout(function () { resolve({ ok: false, error: "Gmail did not open a compose window (is Gmail signed in?).", noCompose: true }); }, 120000);
    });
    delete waiting[id];
    await chrome.storage.local.remove(KEY_PENDING);
    if (result.noCompose) { if (++tabFails >= 2) tabBroken = Date.now(); } else { tabFails = 0; tabBroken = 0; }
    // A sent email's tab is closed; anything else is left open to look at.
    if (result.ok && result.sent) setTimeout(function () { chrome.tabs.remove(tab.id, function () { void chrome.runtime.lastError; }); }, 1500);
    result.via = "Gmail tab";
    return result;
  }

  // ---------------- one job ----------------
  async function run(req) {
    var cfg = await settings();
    // A run started with "Application with Referral" sends through Gmail too:
    // LazyApply's own sending needs credits that can no longer be bought.
    if (!cfg.on && !req.referralRun) return { handled: false };
    var job = req.job || {};
    // The template, attachment choice and sender picked in LazyApply's
    // "Configure Referral Options"; the built-in template only when none is.
    var tpl = req.template && (req.template.subject || req.template.content) && req.template.id !== self.__lazyEmail.BUILTIN_ID ? req.template : null;
    var tplName = tpl ? "template \"" + (tpl.name || "LazyApply") + "\"" : "built-in template";
    var where = { company: job.company || "", title: job.title || "" };
    var done = function (text, sent) {
      log(Object.assign({ kind: "job", status: sent ? "send_success" : "skipped", text: text, finder: "LeadOcean" }, where));
      return { handled: true, sent: sent || 0, text: text };
    };
    if (!self.LazyLeadOcean) return done("Not sent: the LeadOcean finder is not loaded.");
    var day = (await get(KEY_DAY))[KEY_DAY];
    var count = day && day.date === today() ? day.n : 0;
    if (count >= cfg.cap) return done("Not sent: today's limit of " + cfg.cap + " emails from your Gmail is reached.");

    var found = await self.LazyLeadOcean.find(job).catch(function () { return { ok: false, reason: "LeadOcean lookup failed." }; });
    if (!found.ok) return done("Not sent: " + (found.reason === "off" ? "the LeadOcean finder is switched off, and it is needed to find people." : found.reason));
    var sentBefore = (await get(KEY_SENT))[KEY_SENT] || [];
    var people = found.people.filter(function (p) { return validEmail(p.email) && sentBefore.indexOf(p.email.toLowerCase()) < 0; }).slice(0, PER_JOB);
    if (!people.length) return done("Not sent: the people found at this company were already emailed.");

    if (self.__lazyEmail.reload) await self.__lazyEmail.reload();
    // Your name and phone: from this job's resume, else the copy kept when a form was filled.
    var resume = req.resume && req.resume.personalInformation ? req.resume : ((await get("lazyOwnMailProfile")).lazyOwnMailProfile || {});
    var links = [];
    links[job.index >= 0 ? job.index : 0] = req.link || {};
    var wantCv = !(req.template && req.template.attachResume === false); // "Attach Resume" off in LazyApply
    var files = cfg.cv && wantCv ? [{ name: cfg.cv.name, type: cfg.cv.type, base64: cfg.cv.base64 }] : [];
    var sent = 0;
    for (var i = 0; i < people.length && count < cfg.cap; i++) {
      var p = people[i];
      var values = self.__lazyEmail.values({
        job: { title: job.title, company: job.company, url: job.url }, recipient: { name: p.name, role: p.title },
        resume: resume, state: { currentIndex: job.index >= 0 ? job.index : 0, links: links }, attach: files.length > 0,
      });
      var m = { to: p.email, from: req.from || "",
        subject: self.__lazyEmail.fill(tpl ? tpl.subject || self.__lazyEmail.SUBJECT : self.__lazyEmail.SUBJECT, null, values),
        body: self.__lazyEmail.fill(tpl ? tpl.content || self.__lazyEmail.BODY : self.__lazyEmail.BODY, null, values), files: files };
      // Nothing with a gap, a leftover {{variable}} or broken punctuation goes out.
      var problem = self.__lazyEmail.lint ? self.__lazyEmail.lint(m.subject, m.body, values) : "";
      if (problem) {
        log(Object.assign({ kind: "email", status: "skipped", text: "Not sent to " + p.email + ": " + problem + ". Subject would have been: " + m.subject }, where));
        if (/job title|company name/.test(problem)) break;
        continue;
      }
      var result;
      try {
        result = cfg.clientId && cfg.linked ? await sendViaApi(m).catch(function () { return sendViaTab(m, cfg.mode); }) : await sendViaTab(m, cfg.mode);
      } catch (e) {
        result = { ok: false, error: (e && e.message) || "sending failed" };
      }
      var who = p.name + (p.title ? " (" + p.title + ")" : "") + ", " + p.email;
      if (result.ok && result.sent !== false) {
        sent++; count++;
        sentBefore.push(p.email.toLowerCase());
        await set({ [KEY_DAY]: { date: today(), n: count }, [KEY_SENT]: sentBefore.slice(-1000) });
        log(Object.assign({ kind: "email", status: "sent", text: "Sent from your Gmail to " + who + (files.length ? ", CV attached" : ", no CV") + ", " + tplName + " (" + result.via + ")." }, where));
      } else if (result.ok) {
        log(Object.assign({ kind: "email", status: "ready", text: "Ready in a Gmail tab for you to send: " + who + (result.attached ? ", CV attached." : ".") }, where));
      } else {
        log(Object.assign({ kind: "email", status: "send_failed", text: "Could not send to " + who + ": " + (result.error || "unknown reason") + (result.left ? " The Gmail tab was left open." : "") }, where));
      }
      if (i + 1 < people.length) await sleep(GAP_MS);
    }
    return { handled: true, sent: sent, text: sent ? sent + " referral email" + (sent > 1 ? "s" : "") + " sent from your Gmail" : "Referral emails were not sent (see the log)" };
  }

  var queue = Promise.resolve(), queued = 0, recent = {};
  // A line in the "Automation In Progress" panel of the automation tab.
  function notePanel(text) {
    try {
      chrome.storage.local.get("automationTabId", function (r) {
        if (!r || !r.automationTabId) return;
        chrome.tabs.sendMessage(r.automationTabId, { automationControlMessageMain: text, automationControlMessage: "", automationControlProgressBar: false, atsForm: true }).catch(function () {});
      });
    } catch (e) {}
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || typeof request.type !== "string" || request.type.indexOf("LAZY_") !== 0) return;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return;
    var reply = function (work) { work.then(sendResponse, function (e) { sendResponse({ ok: false, handled: false, text: (e && e.message) || "failed" }); }); return true; };
    if (request.type === "LAZY_OWNMAIL_RUN") {
      if (!request.queue) return reply(run(request));
      // Queued: the application moves on at once and the emails go out here,
      // one job after another, with the result shown in the panel.
      return reply(settings().then(function (cfg) {
        if (!cfg.on && !request.referralRun) return { handled: false };
        // Once per job: it is handed over when the submission is seen and
        // again at the referral step, whichever is reached.
        var jobKey = (request.job && request.job.url) || "";
        if (jobKey && recent[jobKey] && Date.now() - recent[jobKey] < 6 * 3600000) return { handled: true, queued: true, dup: true };
        if (jobKey) recent[jobKey] = Date.now();
        queued++;
        queue = queue.then(function () { return run(request); }).catch(function (e) {
          return { handled: true, sent: 0, text: "Referral emails failed: " + ((e && e.message) || "unknown error") };
        }).then(function (r) {
          queued--;
          var who = [request.job && request.job.company, request.job && request.job.title].filter(Boolean).join(", ");
          notePanel((r && r.text ? r.text : "Referral emails finished") + (who ? " (" + who + ")" : ""));
        });
        return { handled: true, queued: true, ahead: queued - 1 };
      }));
    }
    if (request.type === "LAZY_OWNMAIL_TEST") {
      // A test email to yourself through the same Gmail route, with the CV.
      return reply(settings().then(async function (cfg) {
        var to = String(request.to || "").trim();
        if (!validEmail(to)) return { ok: false, text: "No email address to send the test to." };
        var files = cfg.cv ? [{ name: cfg.cv.name, type: cfg.cv.type, base64: cfg.cv.base64 }] : [];
        var m = { test: true, to: to, from: to, subject: "LazyApply test: referral emails from your Gmail", files: files,
          body: "This is a test from the LazyApply extension. If you can read this, referral emails can be sent from this Gmail account" + (files.length ? ", and your CV (" + cfg.cv.name + ") is attached." : ". No CV is saved, so none is attached.") };
        var r;
        try { r = cfg.clientId && cfg.linked ? await sendViaApi(m).catch(function () { return sendViaTab(m, "auto"); }) : await sendViaTab(m, "auto"); }
        catch (e) { r = { ok: false, error: (e && e.message) || "sending failed" }; }
        var text = r.ok && r.sent !== false ? "Test email sent to " + to + (files.length ? " with your CV" : "") + ". Check your inbox." : "Test email not sent: " + (r.error || "unknown reason");
        log({ kind: "email", status: r.ok && r.sent !== false ? "sent" : "send_failed", text: text, company: "Test", title: "" });
        return { ok: !!(r.ok && r.sent !== false), text: text };
      }));
    }
    if (request.type === "LAZY_GMAIL_RESULT") {
      if (waiting[request.id]) waiting[request.id](request.result || { ok: false, error: "no result" });
      return;
    }
    if (request.type === "LAZY_OWNMAIL_CONNECT") {
      return reply(token(true).then(async function () {
        var r = await get(KEY);
        await set({ [KEY]: Object.assign({}, r[KEY] || {}, { linked: true }) });
        return { ok: true, text: "Gmail connected. Emails will be sent directly, without opening a tab." };
      }));
    }
    if (request.type === "LAZY_OWNMAIL_DISCONNECT") {
      return reply(get(KEY).then(async function (r) {
        await set({ [KEY]: Object.assign({}, r[KEY] || {}, { linked: false }) });
        await chrome.storage.local.remove(KEY_TOKEN);
        return { ok: true, text: "Gmail connection removed. The Gmail tab method will be used." };
      }));
    }
    if (request.type === "LAZY_OPEN_OPTIONS") { chrome.runtime.openOptionsPage(); sendResponse({ ok: true }); return; }
    if (request.type === "LAZY_OWNMAIL_INFO") return reply(Promise.resolve({ ok: true, redirectUri: redirectUri() }));
  });

  self.LazyOwnMail = { run: run, buildRaw: buildRaw, settings: settings };
})();
