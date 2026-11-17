// Runs on mail.google.com. When ownMail.js has opened a compose tab for a
// referral email, this attaches the CV the way a person would (by dropping the
// file onto the compose window), checks it is really there, and presses Send.
// It acts only on a compose tab opened moments ago for a waiting email, and
// never touches anything else in Gmail. The email is not sent if the CV could
// not be attached, or if the recipient on screen is not the intended one.
(function () {
  "use strict";
  if (window.__lazyGmailSend) return;
  window.__lazyGmailSend = true;
  // The compose-only page. Gmail rewrites ".../mail/?view=cm&fs=1&tf=1&to=..."
  // to ".../mail/u/0/?fs=1&tf=cm&to=...", so both forms count.
  if (!/[?&](view|tf)=cm(&|$)/.test(location.search + "&" + location.hash.replace(/^#/, "&"))) return;

  var KEY = "lazyGmailPending";
  var MAX_AGE = 3 * 60000;
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var report = function (id, result) {
    try { chrome.runtime.sendMessage({ type: "LAZY_GMAIL_RESULT", id: id, result: result }, function () { void chrome.runtime.lastError; }); } catch (e) {}
  };

  function bodyBox() {
    return document.querySelector('[g_editable="true"], div[role="textbox"][contenteditable="true"]');
  }
  function composeRoot() {
    var box = bodyBox();
    if (!box) return null;
    return box.closest('div[role="dialog"], form, .AD, .nH.Hd') || document.body;
  }
  function chips(root) {
    try { return root.querySelectorAll('[class*="dL"] [role="listitem"], .aQH > div, [aria-label*="attachment" i], .dL, input[name="attach"]').length; } catch (e) { return 0; }
  }
  function toFile(f) {
    var bin = atob(String(f.base64 || "").replace(/\s+/g, "")), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name, { type: f.type || "application/octet-stream" });
  }
  function transfer(files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    return dt;
  }
  async function attach(root, files) {
    var before = chips(root);
    var seen = async function () {
      for (var i = 0; i < 20; i++) { await sleep(250); if (chips(root) > before) return true; }
      return false;
    };
    var target = bodyBox() || root, dt = transfer(files);
    ["dragenter", "dragover", "drop"].forEach(function (type) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    if (await seen()) return true;
    var input = root.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
    if (!input) return false;
    try {
      input.files = transfer(files).files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return false; }
    return seen();
  }
  async function uploadsFinished(root) {
    for (var i = 0; i < 240; i++) { // up to a minute
      if (!root.querySelector('[role="progressbar"]')) return true;
      await sleep(250);
    }
    return false;
  }
  function sendButton(root) {
    var list = root.querySelectorAll('div[role="button"], button');
    for (var i = 0; i < list.length; i++) {
      var b = list[i], tip = (b.getAttribute("data-tooltip") || "") + " " + (b.getAttribute("aria-label") || "");
      // The tooltip names the shortcut ("Send (Ctrl-Enter)") in every language.
      if (/(ctrl|⌘|cmd)[\s\-+]*enter/i.test(tip) || b.classList.contains("aoO")) return b;
    }
    for (var j = 0; j < list.length; j++) if (/^send$/i.test((list[j].textContent || "").trim())) return list[j];
    return null;
  }
  function press(el) {
    ["mousedown", "mouseup", "click"].forEach(function (type) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }

  async function run() {
    var pending = await new Promise(function (resolve) { chrome.storage.local.get(KEY, function (r) { resolve((r && r[KEY]) || null); }); });
    if (!pending || !pending.id || Date.now() - pending.at > MAX_AGE) return;
    // This tab must be the one opened for this email.
    var wanted = String(pending.to || "").toLowerCase();
    var where = ""; try { where = decodeURIComponent(location.search + location.hash).toLowerCase(); } catch (e) { where = (location.search + location.hash).toLowerCase(); }
    if (!wanted || where.indexOf("to=" + wanted) < 0) return;
    await new Promise(function (resolve) { chrome.storage.local.remove(KEY, resolve); }); // claim it, so it can never be used twice

    var root = null;
    for (var i = 0; i < 80 && !root; i++) { root = composeRoot(); if (!root) await sleep(250); } // up to 20 s
    if (!root) return report(pending.id, { ok: false, error: "Gmail did not show a compose window.", noCompose: true });
    await sleep(800); // let the compose window settle

    if ((root.textContent + " " + Array.prototype.map.call(root.querySelectorAll("[email], input, textarea"), function (e) { return (e.getAttribute("email") || "") + " " + (e.value || ""); }).join(" ")).toLowerCase().indexOf(wanted) < 0) {
      return report(pending.id, { ok: false, left: true, error: "the recipient shown in Gmail was not the intended one, so nothing was sent." });
    }

    var files = [], attached = false;
    try { files = (pending.files || []).map(toFile); } catch (e) { files = null; }
    if (files === null) return report(pending.id, { ok: false, left: true, error: "the saved CV could not be read." });
    if (files.length) {
      attached = (await attach(root, files)) && (await uploadsFinished(root));
      if (!attached) return report(pending.id, { ok: false, left: true, error: "the CV could not be attached, so the email was not sent." });
      await sleep(700);
    }
    if (!pending.autoSend) return report(pending.id, { ok: true, sent: false, attached: attached });

    var button = sendButton(root);
    if (!button) return report(pending.id, { ok: false, left: true, attached: attached, error: "Gmail's Send button was not found." });
    press(button);
    for (var k = 0; k < 80; k++) { // up to 20 s for the compose window to close
      await sleep(250);
      if (!bodyBox() || /message sent|has been sent/i.test(document.body.innerText || "")) return report(pending.id, { ok: true, sent: true, attached: attached });
    }
    report(pending.id, { ok: false, left: true, attached: attached, error: "Gmail did not confirm the email was sent." });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
