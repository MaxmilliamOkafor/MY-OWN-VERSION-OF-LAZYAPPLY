// Runs on mail.google.com. When wdVerify.js has opened a Gmail search tab to
// find a Workday "verify your account" email, this opens the newest matching
// emails one by one and reports the verification link for that Workday site.
// It only reads: nothing is sent, deleted, archived or labelled. It acts only
// on a search tab opened moments ago for a waiting verification.
(function () {
  "use strict";
  if (window.__lazyGmailVerify || window.top !== window) return;
  window.__lazyGmailVerify = true;

  var KEY = "lazyWdVerifyPending";
  var MAX_AGE = 3 * 60000;
  var LOOK_MS = 140000;
  var VERIFY = /verif|activat|confirm|validat/i;
  var WD_HOST = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$/i;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var report = function (id, result) {
    try { chrome.runtime.sendMessage({ type: "LAZY_WD_VERIFY_LINK", id: id, result: result }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  };

  // The real address behind a link (Gmail may wrap it in google.com/url?q=).
  function realUrl(a) {
    var href = a.getAttribute("href") || "";
    try {
      var u = new URL(href, location.href);
      if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname === "/url") href = u.searchParams.get("q") || u.searchParams.get("url") || href;
      return new URL(href);
    } catch (e) { return null; }
  }

  // The verification link for `host` in an open email, or "".
  function linkIn(root, host) {
    var best = "", bestScore = 0;
    var tenant = host.split(".")[0];
    Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
      var u = realUrl(a);
      if (!u || u.protocol !== "https:") return;
      var h = u.hostname.toLowerCase();
      var score = 0;
      if (h === host) score += 4;
      else if (WD_HOST.test(h) && h.split(".")[0] === tenant) score += 3;
      else return; // only a link to this employer's Workday site
      var said = (a.innerText || a.textContent || "") + " " + u.pathname + " " + u.search;
      if (VERIFY.test(said)) score += 3;
      else if (/\/(activate|verify|confirm)/i.test(u.pathname)) score += 3;
      else return; // a job link or the careers home page, not the verification
      if (score > bestScore) { bestScore = score; best = u.href; }
    });
    return best;
  }

  // Search result rows, newest first: [{ id, text }].
  function rows() {
    var main = document.querySelector('div[role="main"]') || document;
    return Array.prototype.filter.call(main.querySelectorAll("tr.zA"), function (r) { return r.offsetParent; }).map(function (r) {
      var idEl = r.querySelector("[data-legacy-thread-id]");
      return { el: r, id: idEl ? idEl.getAttribute("data-legacy-thread-id") : "", text: (r.innerText || "").replace(/\s+/g, " ") };
    });
  }

  function openBodies() {
    return Array.prototype.filter.call(document.querySelectorAll("div.a3s"), function (b) { return b.offsetParent; });
  }

  function press(el) {
    ["mousedown", "mouseup", "click"].forEach(function (t) { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
  }

  async function openThread(row, searchHash) {
    if (row.id) location.hash = searchHash + "/" + row.id;
    else press(row.el.querySelector("span.bog") || row.el);
    for (var i = 0; i < 40; i++) { // up to 10 s
      await sleep(250);
      var b = openBodies();
      if (b.length) { await sleep(600); return openBodies(); }
    }
    return [];
  }

  async function run() {
    var pending = await new Promise(function (resolve) { chrome.storage.local.get(KEY, function (r) { resolve((r && r[KEY]) || null); }); });
    if (!pending || !pending.id || Date.now() - pending.at > MAX_AGE) return;
    if (!/^#search\//.test(location.hash)) return;
    var searchHash = location.hash.split("/").slice(0, 2).join("/");
    // Signed in as someone else: say so instead of reading their mail.
    for (var w = 0; w < 40 && !/@/.test(document.title); w++) await sleep(250);
    var who = (document.title.match(/[^\s<>()"]+@[^\s<>()"]+/) || [""])[0].toLowerCase();
    if (who && who !== pending.email) {
      return report(pending.id, { ok: false, error: "Gmail is signed in as " + who + ", not " + pending.email });
    }
    await new Promise(function (resolve) { chrome.storage.local.remove(KEY, resolve); }); // claim it

    var start = Date.now(), tried = {};
    while (Date.now() - start < LOOK_MS) {
      if (location.hash !== searchHash) { location.hash = searchHash; await sleep(1500); }
      await sleep(1500);
      var list = rows().filter(function (r) { return VERIFY.test(r.text) && !tried[r.id || r.text]; }).slice(0, 6);
      for (var i = 0; i < list.length; i++) {
        tried[list[i].id || list[i].text] = true;
        var bodies = await openThread(list[i], searchHash);
        // The newest message of the thread is the last one shown.
        for (var j = bodies.length - 1; j >= 0; j--) {
          var link = linkIn(bodies[j], pending.host);
          if (link) { location.hash = searchHash; return report(pending.id, { ok: true, link: link }); }
        }
        location.hash = searchHash;
        await sleep(1200);
      }
      // Not there yet: wait, then search again (the email may still be on its way).
      await sleep(8000);
      location.hash = "#inbox";
      await sleep(1000);
      location.hash = searchHash;
    }
    report(pending.id, { ok: false, error: "no verification email for " + pending.host + " arrived in Gmail" });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
