/*
 * Workday "verify your account" emails, done for you (background side).
 *
 * Some employers' Workday sites want the new account confirmed from a link
 * they email before you can sign in ("Verify your account before you sign in
 * or request a verification email."). LazyApply used to ask its own server to
 * do this, but that server address no longer exists, so these jobs were
 * always left. Now, for a tab of a running automation only:
 *   1. a Gmail tab is opened in the background, signed in as the account's
 *      email, searching recent verification emails (gmailVerify.js reads it);
 *   2. the newest email with a verification link for this exact Workday site
 *      gives the link;
 *   3. the link is opened in a background tab (that is what verifies the
 *      account), which is closed again; the job page then signs in as usual.
 * Nothing is sent, deleted or marked in Gmail; only the email is opened.
 * Each Workday site + email is tried at most twice per run of the browser.
 */
(function () {
  "use strict";
  var KEY = "lazyWdVerifyPending";
  var FIND_MS = 150000; // the email can take a minute or two to arrive
  var tries = {}; // "host|email" -> times tried
  var running = {}; // "host|email" -> promise
  var waiting = {}; // id -> resolve

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var log = function (level, msg, data) { try { if (self.__lazyDbg) self.__lazyDbg.log("verify", level, msg, data); } catch (e) {} };
  var WD_HOST = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/i;

  async function isRunTab(tabId) {
    if (tabId == null) return false;
    try {
      if (self.LazyParallel) { await self.LazyParallel.ready; if (self.LazyParallel.isWorker(tabId)) return true; }
    } catch (e) {}
    var r = await chrome.storage.local.get(["applicationState", "automationTabId"]);
    var st = r.applicationState;
    return !!(st && st.isAutomationActive && !st.isPaused && r.automationTabId === tabId);
  }

  // Give the job its full time again: verifying takes a while.
  async function holdJobTimeout() {
    try {
      var r = await chrome.storage.local.get("jobTimeoutSet");
      if (r.jobTimeoutSet) await chrome.storage.local.set({ jobTimeoutSet: Object.assign({}, r.jobTimeoutSet, { time: Date.now() }) });
    } catch (e) {}
  }

  function closeTab(id) { try { chrome.tabs.remove(id, function () { void chrome.runtime.lastError; }); } catch (e) {} }

  function waitLoaded(tabId, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (ok) { if (done) return; done = true; chrome.tabs.onUpdated.removeListener(on); resolve(ok); };
      var on = function (id, info) { if (id === tabId && info.status === "complete") finish(true); };
      chrome.tabs.onUpdated.addListener(on);
      chrome.tabs.get(tabId, function (t) { void chrome.runtime.lastError; if (t && t.status === "complete") finish(true); });
      setTimeout(function () { finish(false); }, ms);
    });
  }

  async function findLink(email, host, since) {
    var id = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    // Recent emails only; the link's address must be this Workday site.
    var q = "newer_than:2d (verify OR verification OR activate OR activation OR confirm)";
    var url = "https://mail.google.com/mail/u/" + encodeURIComponent(email) + "/#search/" + encodeURIComponent(q);
    await chrome.storage.local.set({ [KEY]: { id: id, email: email, host: host, since: since, at: Date.now() } });
    var tab = null;
    try {
      tab = await chrome.tabs.create({ url: url, active: false });
      return await new Promise(function (resolve) {
        var timer = null;
        var done = function (r) { clearInterval(timer); resolve(r); };
        waiting[id] = done;
        setTimeout(function () { done({ ok: false, error: "no verification email found in Gmail within " + Math.round(FIND_MS / 1000) + " s" }); }, FIND_MS);
        // Gmail not signed in as this email: it sends the tab to Google's sign-in page.
        timer = setInterval(function () {
          chrome.tabs.get(tab.id, function (t) {
            void chrome.runtime.lastError;
            if (!t) return done({ ok: false, error: "the Gmail tab was closed" });
            if (/^https:\/\/accounts\.google\.com\//.test(t.url || "")) done({ ok: false, error: "Gmail is not signed in as " + email + " in this Chrome profile" });
          });
        }, 4000);
      });
    } finally {
      delete waiting[id];
      try { await chrome.storage.local.remove(KEY); } catch (e) {}
      if (tab) closeTab(tab.id);
    }
  }

  async function openLink(link) {
    var tab = await chrome.tabs.create({ url: link, active: false });
    await waitLoaded(tab.id, 30000);
    await sleep(5000); // Workday confirms the account from its page script
    var text = "";
    try {
      var r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: function () { return (document.body && document.body.innerText || "").slice(0, 2000); } });
      text = (r && r[0] && r[0].result) || "";
    } catch (e) {}
    closeTab(tab.id);
    return text;
  }

  async function verify(email, host, since) {
    log("info", "Workday wants the account verified; looking for the email in Gmail", { host: host });
    await holdJobTimeout();
    var found = await findLink(email, host, since);
    if (!found || !found.ok || !found.link) {
      log("warn", "Workday verification email not found: " + ((found && found.error) || "no link"), { host: host });
      return { ok: false, error: (found && found.error) || "no verification link found" };
    }
    await holdJobTimeout();
    var page = await openLink(found.link);
    var bad = /(link|token|request) (has |is )?(expired|invalid|already been used)|no longer valid/i.test(page);
    log(bad ? "warn" : "info", bad ? "Workday verification link did not work" : "Workday account verified from the emailed link", { host: host, page: page.slice(0, 200) });
    return bad ? { ok: false, error: "the verification link had expired or was already used" } : { ok: true };
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request) return;
    if (request.type === "LAZY_WD_VERIFY_LINK") {
      if (waiting[request.id]) waiting[request.id](request.result || { ok: false, error: "no result" });
      return;
    }
    if (request.type !== "LAZY_WD_VERIFY") return;
    (async function () {
      var tabId = sender && sender.tab && sender.tab.id;
      var email = String(request.email || "").trim().toLowerCase();
      var host = "";
      try { host = new URL(sender.tab.url || sender.url).hostname.toLowerCase(); } catch (e) {}
      if (!WD_HOST.test(host)) return sendResponse({ ok: false, error: "not a Workday page" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendResponse({ ok: false, error: "no account email to look for" });
      if (!(await isRunTab(tabId))) return sendResponse({ ok: false, error: "not a running automation's tab" });
      var k = host + "|" + email;
      if (!running[k]) {
        if ((tries[k] || 0) >= 2) return sendResponse({ ok: false, error: "already tried twice for this site" });
        tries[k] = (tries[k] || 0) + 1;
        running[k] = verify(email, host, Number(request.since) || Date.now() - 3600000)
          .catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; })
          .finally(function () { delete running[k]; });
      }
      sendResponse(await running[k]);
    })();
    return true;
  });
})();
