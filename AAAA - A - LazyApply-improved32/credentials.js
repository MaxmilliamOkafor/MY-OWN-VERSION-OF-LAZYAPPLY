// Settings page for the user's own job-site sign-in (see atsCredentials.js).
(function () {
  "use strict";
  const KEY = "lazyUserAtsCredentials";
  const $ = (id) => document.getElementById(id);
  const status = (text, kind) => {
    $("status").textContent = text;
    $("status").className = kind || "";
  };

  chrome.storage.local.get(KEY, (r) => {
    const v = r && r[KEY];
    if (v && v.email) {
      $("email").value = v.email;
      $("password").value = v.password || "";
      status("A sign-in is saved for " + v.email + ".", "ok");
    } else {
      status("Nothing saved yet.", "warn");
    }
  });

  $("show").addEventListener("change", (e) => {
    $("password").type = e.target.checked ? "text" : "password";
  });

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("email").value.trim();
    const password = $("password").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return status("Enter a valid email address.", "warn");
    if (password.length < 8) return status("Use a password of at least 8 characters.", "warn");
    chrome.storage.local.set({ [KEY]: { email, password, savedAt: Date.now() } }, () => {
      if (chrome.runtime.lastError) return status("Could not save: " + chrome.runtime.lastError.message, "warn");
      status("Saved. It will be used from the next application.", "ok");
    });
  });

  $("clear").addEventListener("click", () => {
    chrome.storage.local.remove(KEY, () => {
      $("email").value = "";
      $("password").value = "";
      status("Removed. iCIMS jobs will be skipped until you save a sign-in.", "warn");
    });
  });

  // Referral email settings (read by emailVars.js).
  const REF_ON = "lazyReferralTemplate";
  const REF_PROOF = "lazyReferralProof";
  chrome.storage.local.get([REF_ON, REF_PROOF], (r) => {
    $("refOn").checked = !r || r[REF_ON] !== false;
    $("refProof").value = (r && typeof r[REF_PROOF] === "string" && r[REF_PROOF]) || "";
  });
  $("refForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = { [REF_ON]: $("refOn").checked, [REF_PROOF]: $("refProof").value.trim() };
    chrome.storage.local.set(data, () => {
      const el = $("refStatus");
      if (chrome.runtime.lastError) {
        el.textContent = "Could not save: " + chrome.runtime.lastError.message;
        el.style.color = "var(--warn)";
      } else {
        el.textContent = "Saved. It applies from the next referral email.";
        el.style.color = "var(--ok)";
      }
    });
  });

  // LeadOcean contact finder (read by leadOcean.js in the background worker).
  const LO = "lazyLeadOcean";
  const loStatus = (text, good) => {
    $("loStatus").textContent = text;
    $("loStatus").style.color = good ? "var(--ok)" : "var(--warn)";
  };
  const loShowSaved = (after) => chrome.storage.local.get(LO, (r) => {
    const v = (r && r[LO]) || {};
    $("loOn").checked = v.on === true;
    $("loKey").value = v.key || "";
    if (after) after(v);
    else loStatus(v.key ? (v.on ? "LeadOcean is on. A key is saved." : "A key is saved. LeadOcean is off.") : "No key saved. LeadOcean is off.", !!(v.key && v.on));
  });
  loShowSaved();
  $("loKey").addEventListener("input", () => { if ($("loKey").value.trim()) $("loOn").checked = true; });
  $("loShow").addEventListener("change", (e) => { $("loKey").type = e.target.checked ? "text" : "password"; });
  $("loForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const key = $("loKey").value.trim();
    const on = $("loOn").checked;
    if (on && !key) return loStatus("Paste your LeadOcean API key to switch this on.", false);
    chrome.storage.local.set({ [LO]: { on, key, savedAt: Date.now() } }, () => {
      if (chrome.runtime.lastError) return loStatus("Could not save: " + chrome.runtime.lastError.message, false);
      // Read it back so "Saved" is only shown when it really is stored.
      loShowSaved((v) => {
        if (v.key === key && (v.on === true) === on) loStatus(on ? "Saved. LeadOcean is on from the next referral email." : "Saved. LeadOcean is off.", true);
        else loStatus("The setting did not save. Try again.", false);
      });
    });
  });
  $("loTest").addEventListener("click", () => {
    const key = $("loKey").value.trim();
    if (!key) return loStatus("Paste your LeadOcean API key first.", false);
    loStatus("Checking...", true);
    chrome.runtime.sendMessage({ type: "LAZY_LEADOCEAN_TEST", key }, (r) => {
      if (chrome.runtime.lastError || !r) return loStatus("Could not reach the extension. Reload it and try again.", false);
      loStatus(r.text + (r.ok ? " Press Save to keep the key." : ""), r.ok);
    });
  });
  $("loClear").addEventListener("click", () => {
    chrome.storage.local.remove(LO, () => loShowSaved(() => loStatus("Key removed. LeadOcean is off.", false)));
  });

  // Referral email log (written by atsControls.js and emailVars.js).
  const showLog = () => chrome.storage.local.get("lazyEmailLog", (r) => {
    const list = Array.isArray(r && r.lazyEmailLog) ? r.lazyEmailLog.slice().reverse() : [];
    const box = $("logList");
    box.textContent = "";
    if (!list.length) {
      const p = document.createElement("p");
      p.style.margin = "10px 0";
      p.textContent = "Nothing yet. A line appears here after each job in a run.";
      return box.appendChild(p);
    }
    list.forEach((e) => {
      const row = document.createElement("div");
      row.style.cssText = "padding: 8px 0; border-bottom: 1px solid var(--line)";
      const head = document.createElement("div");
      head.style.cssText = "color: var(--muted); font-size: 13px";
      head.textContent = new Date(e.at).toLocaleString() + " \u00b7 " + [e.company, e.title].filter(Boolean).join(" \u2013 ") + (e.finder ? " \u00b7 finder: " + e.finder : "");
      const text = document.createElement("div");
      text.style.color = e.status === "sent" || e.status === "send_success" ? "var(--ok)" : "var(--warn)";
      text.textContent = e.text || e.status || "";
      row.append(head, text);
      box.appendChild(row);
    });
  });
  showLog();
  chrome.storage.onChanged.addListener((c) => { if (c.lazyEmailLog) showLog(); });
  $("logClear").addEventListener("click", () => chrome.storage.local.remove("lazyEmailLog", showLog));

  // Referral emails from the user's own Gmail (read by ownMail.js).
  const OM = "lazyOwnMail", OM_CV = "lazyOwnMailCv";
  const omStatus = (text, good) => {
    $("omStatus").textContent = text;
    $("omStatus").style.color = good ? "var(--ok)" : "var(--warn)";
  };
  const omShow = (after) => chrome.storage.local.get([OM, OM_CV, LO], (r) => {
    const v = (r && r[OM]) || {}, cv = r && r[OM_CV], lo = (r && r[LO]) || {};
    $("omOn").checked = v.on === true;
    $("omMode").value = v.mode === "review" ? "review" : "auto";
    $("omCap").value = Number(v.cap) > 0 ? String(Math.floor(Number(v.cap))) : "30";
    $("omClient").value = v.clientId || "";
    $("omCvName").textContent = cv && cv.name ? "Saved: " + cv.name + " (" + Math.round((cv.size || 0) / 1024) + " KB)" : "No CV saved. Emails will go without an attachment.";
    $("omCvRemove").style.display = cv && cv.name ? "" : "none";
    if (after) return after(v, cv);
    if (v.on !== true) omStatus("Off. LazyApply's own referral step is used (it needs email credits).", false);
    else if (!(lo.on === true && lo.key)) omStatus("On, but the LeadOcean finder below is off or has no key, so nobody can be found yet.", false);
    else omStatus("On. " + (v.linked ? "Sending directly through your Gmail connection." : "Sending through a Gmail tab.") + (cv && cv.name ? "" : " No CV saved."), true);
  });
  omShow();
  chrome.runtime.sendMessage({ type: "LAZY_OWNMAIL_INFO" }, (r) => { void chrome.runtime.lastError; if (r && r.redirectUri) $("omRedirect").value = r.redirectUri; });
  $("omCv").addEventListener("change", () => {
    const f = $("omCv").files && $("omCv").files[0];
    if (!f) return;
    if (!/\.(pdf|docx?)$/i.test(f.name)) return omStatus("Choose a PDF or Word file.", false);
    if (f.size > 5 * 1024 * 1024) return omStatus("That file is larger than 5 MB.", false);
    const reader = new FileReader();
    reader.onerror = () => omStatus("The file could not be read.", false);
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      chrome.storage.local.set({ [OM_CV]: { name: f.name, type: f.type || "", size: f.size, base64, savedAt: Date.now() } }, () => {
        if (chrome.runtime.lastError) return omStatus("Could not save the CV: " + chrome.runtime.lastError.message, false);
        omShow((v, cv) => omStatus(cv && cv.name === f.name ? "CV saved: " + f.name : "The CV did not save. Try again.", !!(cv && cv.name === f.name)));
      });
    };
    reader.readAsDataURL(f);
  });
  $("omCvRemove").addEventListener("click", () => chrome.storage.local.remove(OM_CV, () => { $("omCv").value = ""; omShow(() => omStatus("CV removed.", false)); }));
  $("omForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const cap = Math.floor(Number($("omCap").value));
    if (!(cap >= 1 && cap <= 200)) return omStatus("Set the daily limit to a number from 1 to 200.", false);
    chrome.storage.local.get(OM, (r) => {
      const prev = (r && r[OM]) || {};
      const clientId = $("omClient").value.trim();
      const next = { on: $("omOn").checked, mode: $("omMode").value, cap, clientId, linked: prev.linked === true && clientId === (prev.clientId || ""), savedAt: Date.now() };
      chrome.storage.local.set({ [OM]: next }, () => {
        if (chrome.runtime.lastError) return omStatus("Could not save: " + chrome.runtime.lastError.message, false);
        omShow((v) => {
          if (v.on === next.on && v.mode === next.mode && Number(v.cap) === cap) omShow();
          else omStatus("The settings did not save. Try again.", false);
        });
      });
    });
  });
  $("omConnect").addEventListener("click", () => {
    if (!$("omClient").value.trim()) return omStatus("Paste your Google client ID and press Save first.", false);
    omStatus("Waiting for Google...", true);
    chrome.runtime.sendMessage({ type: "LAZY_OWNMAIL_CONNECT" }, (r) => {
      if (chrome.runtime.lastError || !r) return omStatus("Could not reach the extension. Reload it and try again.", false);
      omStatus(r.text || (r.ok ? "Connected." : "Not connected."), !!r.ok);
    });
  });
  $("omDisconnect").addEventListener("click", () => chrome.runtime.sendMessage({ type: "LAZY_OWNMAIL_DISCONNECT" }, (r) => { void chrome.runtime.lastError; omStatus((r && r.text) || "Disconnected.", false); }));
})();
