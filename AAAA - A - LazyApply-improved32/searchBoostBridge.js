/*
 * Search Boost — bridge between the dashboard page (searchBoostPage.js) and
 * the extension's background worker (searchBoost.js). Runs as a normal
 * content script, the only place that can reach both.
 */
(function () {
  "use strict";
  // One live copy per page: a copy left behind by an earlier version of the
  // extension no longer counts (it cannot reach the extension).
  const prev = window.__lazyApplySearchBoostBridge;
  if (typeof prev === "function" && prev()) return;
  window.__lazyApplySearchBoostBridge = () => alive();

  // The dashboard sends every command (scan LinkedIn/Indeed/Glassdoor, start
  // applying, ...) to the extension ID saved in localStorage. A stale ID from
  // an older install makes all of them fail, so keep it pointing at this one.
  try {
    if (chrome.runtime && chrome.runtime.id && localStorage.getItem("extensionId") !== chrome.runtime.id) {
      localStorage.setItem("extensionId", chrome.runtime.id);
    }
  } catch (e) {}

  // After the extension updates or reloads, this copy can no longer reach it.
  // A fresh copy is injected into the tab (background.js), so this one stands
  // down instead of answering requests with nothing.
  const alive = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  };

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (!alive()) return;
    const d = e.data;
    if (!d || d.__lazyBoost !== "req" || typeof d.id !== "string") return;

    const reply = (result) => window.postMessage({ __lazyBoost: "res", id: d.id, result }, window.location.origin);
    const message =
      d.kind === "learn"
        ? { type: "SEARCH_BOOST_LEARN", urls: Array.isArray(d.payload && d.payload.urls) ? d.payload.urls : [] }
        : d.kind === "filter"
        ? {
            type: "SEARCH_BOOST_FILTER",
            titles: (d.payload && d.payload.titles) || [],
            jobTitles: Array.isArray(d.payload && d.payload.jobTitles) ? d.payload.jobTitles : [],
            jobs: Array.isArray(d.payload && d.payload.jobs) ? d.payload.jobs : undefined,
            filters: (d.payload && d.payload.filters) || null,
            locations: Array.isArray(d.payload && d.payload.locations) ? d.payload.locations : [],
          }
        : { type: "SEARCH_BOOST", query: d.payload || {} };

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) return reply(null);
        reply(response || null);
      });
    } catch (err) {
      // The extension was reloaded; the page keeps the server's results.
      reply(null);
    }
  });

  // Pre-load the job boards in the background while the dashboard is open,
  // so a search reads them from the cache. The worker skips it when it ran
  // in the past 20 minutes.
  const warm = () => {
    if (document.visibilityState === "hidden") return;
    try {
      chrome.runtime.sendMessage({ type: "SEARCH_BOOST_WARM" }, () => void chrome.runtime.lastError);
    } catch (e) {}
  };
  setTimeout(warm, 1500);
  setInterval(warm, 20 * 60 * 1000 + 5000);
  document.addEventListener("visibilitychange", warm);

  // On the dashboard's Profile pages: an "Applications Account" section (the
  // email and password used on job sites that need an account, such as
  // iCIMS and Workday). Saved only in this browser (chrome.storage.local),
  // never sent to LazyApply. The dashboard is a single-page app, so the page
  // is re-checked every 1.5 s.
  const CRED_KEY = "lazyUserAtsCredentials";
  const SECTION_ID = "lazyapply-applications-account";

  // The email shown in the profile's Personal Information section.
  function profileEmail() {
    const labels = [...document.querySelectorAll("p,span,div,h6,label")].filter(
      (e) => e.childElementCount === 0 && /^email$/i.test(e.textContent.trim())
    );
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const l of labels) {
      // The value sits in the element right after the "Email" label.
      const v = l.nextElementSibling && l.nextElementSibling.textContent.trim();
      if (v && EMAIL_RE.test(v)) return v;
    }
    try {
      const u = JSON.parse(localStorage.getItem("user") || "null");
      if (u && typeof u.email === "string") return u.email;
    } catch (e) {}
    return "";
  }

  const CSS = `
    :host { all: initial; display: block; }
    .wrap { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--text); margin: 16px 0;
      --text:#1b1f24; --muted:#5b6470; --card:#f3f4f6; --line:#d1d5db; --field:#ffffff; --accent:#6366f1; --ok:#15803d; --warn:#b45309; }
    .wrap.dark { --text:#eef0f3; --muted:#a3abb7; --card:#2a2f3a; --line:#4b5262; --field:#232833; --accent:#7c83f7; --ok:#6fd08c; --warn:#f0b860; }
    h3 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
    p.desc { color: var(--muted); margin: 0 0 12px; }
    .card { background: var(--card); border-radius: 14px; padding: 6px 20px; }
    .row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px 0; flex-wrap: wrap; }
    .row + .row { border-top: 1px solid var(--line); }
    .row > label { font-weight: 600; font-size: 16px; padding-top: 8px; }
    .field { width: min(380px, 100%); }
    input[type=email], input[type=password], input[type=text] { box-sizing: border-box; width: 100%; padding: 10px 44px 10px 14px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--field); color: var(--text); font: inherit; }
    input:disabled { opacity: .7; }
    input:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .check { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--text); }
    .check input { width: 18px; height: 18px; accent-color: var(--accent); }
    .pw { position: relative; }
    .eye { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: 0; color: var(--muted);
      cursor: pointer; padding: 6px; display: flex; }
    .actions { display: flex; align-items: center; gap: 12px; padding: 4px 0 16px; flex-wrap: wrap; }
    button.save { background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 9px 18px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
    button.clear { background: none; border: 1px solid var(--line); color: var(--text); border-radius: 10px; padding: 8px 14px; font: inherit; cursor: pointer; }
    .status { font-weight: 600; }
    select { box-sizing: border-box; width: 100%; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--field); color: var(--text); font: inherit; }
    #pst { margin-top: 8px; font-weight: 400; color: var(--muted); }
    .status.ok { color: var(--ok); }
    .status.warn { color: var(--warn); }
  `;
  const EYE =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';

  function isDark(el) {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor || "";
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(bg);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] < 128;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function buildSection(anchor) {
    const host = document.createElement("div");
    host.id = SECTION_ID;
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>${CSS}</style>
      <section class="wrap" aria-labelledby="t">
        <h3 id="t">Applications Account</h3>
        <p class="desc">Used to sign in or create an account on job sites that ask for one (iCIMS, Workday and similar), so applications are filed under your own account and replies reach your inbox. Saved only in this browser, not sent to LazyApply. Pick a password you do not use for email or banking.</p>
        <div class="card">
          <div class="row"><label for="em">Email</label>
            <div class="field"><input id="em" type="email" autocomplete="off" placeholder="you@example.com">
              <label class="check"><input id="usep" type="checkbox"> Use profile email</label></div></div>
          <div class="row"><label for="pw">Password</label>
            <div class="field pw"><input id="pw" type="password" autocomplete="new-password" minlength="8">
              <button class="eye" id="eye" type="button" aria-label="Show password" aria-pressed="false">${EYE}</button></div></div>
          <div class="actions"><button class="save" id="save" type="button">Save</button>
            <button class="clear" id="clr" type="button">Remove</button><span class="status" id="st" role="status"></span></div>
        </div>
        <h3 id="t2" style="margin-top:20px">Applying Speed</h3>
        <p class="desc">For queues of 400 jobs or more, several tabs apply at the same time, each in its own small window, side by side. Each tab is reused from job to job, so tabs do not pile up. Shorter queues always use one tab.</p>
        <div class="card">
          <div class="row"><label for="par">Tabs at once (400+ jobs)</label>
            <div class="field"><select id="par" aria-labelledby="t2">
              <option value="1">1 tab (one job at a time)</option>
              <option value="2">2 tabs</option>
              <option value="3">3 tabs (fastest)</option>
            </select><div class="status" id="pst" role="status"></div></div></div>
        </div>
      </section>`;
    const $ = (id) => root.getElementById(id);
    const status = (t, k) => {
      $("st").textContent = t;
      $("st").className = "status " + (k || "");
    };
    const syncEmail = () => {
      if ($("usep").checked) {
        $("em").value = profileEmail();
        $("em").disabled = true;
      } else {
        $("em").disabled = false;
      }
    };
    root.querySelector(".wrap").classList.toggle("dark", isDark(anchor));
    chrome.storage.local.get(CRED_KEY, (r) => {
      const v = (r && r[CRED_KEY]) || null;
      // New setups default to the profile email; older saves keep their own.
      $("usep").checked = v ? v.useProfileEmail === true : true;
      if (v && v.email && !$("usep").checked) $("em").value = v.email;
      $("pw").value = (v && v.password) || "";
      syncEmail();
      status(
        v && v.email ? "Saved for " + v.email + "." : "Nothing saved yet. iCIMS jobs are skipped until you save.",
        v && v.email ? "ok" : "warn"
      );
      // Keep the stored email in step with the profile.
      if (v && v.useProfileEmail && $("em").value && $("em").value !== v.email) {
        chrome.storage.local.set({ [CRED_KEY]: { ...v, email: $("em").value, savedAt: Date.now() } });
      }
    });
    $("usep").addEventListener("change", syncEmail);
    // Applying speed (parallelApply.js reads "lazyParallelTabs"; default 3).
    try {
      chrome.storage.local.get("lazyParallelTabs", (r) => {
        const n = Number(r && r.lazyParallelTabs);
        $("par").value = String(n >= 1 && n <= 3 ? n : 3);
      });
    } catch (e) {}
    $("par").addEventListener("change", () => {
      if (!alive()) return ($("pst").textContent = STALE);
      const n = Number($("par").value);
      try {
        chrome.storage.local.set({ lazyParallelTabs: n }, () => {
          $("pst").textContent = n === 1 ? "Saved: one tab at a time." : "Saved: " + n + " tabs for queues of 400+ jobs.";
        });
      } catch (e) {
        $("pst").textContent = STALE;
      }
    });
    $("eye").addEventListener("click", () => {
      const show = $("pw").type === "password";
      $("pw").type = show ? "text" : "password";
      $("eye").setAttribute("aria-pressed", String(show));
      $("eye").setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
    const STALE = "LazyApply was just updated. Reload this page (F5), then press Save again.";
    $("save").addEventListener("click", () => {
      syncEmail();
      const email = $("em").value.trim();
      const password = $("pw").value;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return status("Enter a valid email address.", "warn");
      if (password.length < 8) return status("Use a password of at least 8 characters.", "warn");
      if (!alive()) return status(STALE, "warn");
      const value = { email, password, useProfileEmail: $("usep").checked, savedAt: Date.now() };
      try {
        chrome.storage.local.set({ [CRED_KEY]: value }, () => {
          if (chrome.runtime.lastError) return status("Could not save: " + chrome.runtime.lastError.message, "warn");
          // Read it back: "Saved" is shown only once it is really stored.
          chrome.storage.local.get(CRED_KEY, (r) => {
            const got = r && r[CRED_KEY];
            const ok = got && got.email === email && got.password === password;
            status(ok ? "Saved for " + email + ". Kept in this browser until you press Remove." : "Could not save. Reload this page and try again.", ok ? "ok" : "warn");
          });
        });
      } catch (e) {
        status(STALE, "warn");
      }
    });
    $("clr").addEventListener("click", () => {
      if (!alive()) return status(STALE, "warn");
      try {
        chrome.storage.local.remove(CRED_KEY, () => {
          $("pw").value = "";
          status("Removed. iCIMS jobs are skipped until you save.", "warn");
        });
      } catch (e) {
        status(STALE, "warn");
      }
    });
    return host;
  }

  function syncAccountSection() {
    const onProfile = /\/dashboard\/profile\/./.test(location.pathname);
    const existing = document.getElementById(SECTION_ID);
    if (!alive()) {
      // This copy is out of date: hand the section over to the fresh copy.
      clearInterval(sectionTimer);
      if (existing && existing.__lazyOwner === ownerTag) existing.remove();
      return;
    }
    if (!onProfile) {
      if (existing) existing.remove();
      return;
    }
    if (existing && existing.isConnected) {
      if (existing.__lazyOwner === ownerTag) return;
      existing.remove(); // left by an out-of-date copy
    }
    const h = [...document.querySelectorAll("h6,h5,h4,h3")].find((e) => e.textContent.trim() === "Job Preferences");
    const card = h && h.closest(".MuiPaper-root");
    if (!card || !card.parentElement) return;
    try {
      const host = buildSection(card);
      host.__lazyOwner = ownerTag;
      card.parentElement.insertBefore(host, card.nextSibling);
    } catch (e) {}
  }
  const ownerTag = {};
  const sectionTimer = setInterval(syncAccountSection, 1500);
})();
