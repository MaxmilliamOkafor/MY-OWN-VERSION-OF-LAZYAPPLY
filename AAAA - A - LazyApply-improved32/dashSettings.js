/*
 * "Send from my Gmail" section inside LazyApply's own "Configure Referral
 * Options" dialog (no floating button anywhere). One line shows what is set;
 * Edit opens the LeadOcean API key (finds the people), the CV to attach and
 * the daily limit. Everything is
 * saved in this browser only (chrome.storage.local), read back after saving,
 * and shared with the extension's Options page.
 */
(function () {
  "use strict";
  if (window.__lazyDashSettings || window.top !== window) return;
  window.__lazyDashSettings = true;
  const LO = "lazyLeadOcean", OM = "lazyOwnMail", CV = "lazyOwnMailCv";
  const get = (k) => new Promise((res) => chrome.storage.local.get(k, (r) => res(r || {})));
  const set = (o) => new Promise((res, rej) => chrome.storage.local.set(o, () => (chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res())));

  const host = document.createElement("div");
  host.id = "lazy-dash-settings";
  host.style.cssText = "display:block;margin:20px 0 4px";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
  :host{all:initial}
  *{box-sizing:border-box;font-family:Roboto,Segoe UI,Arial,sans-serif}
  .ttl{color:#fff;font-size:15px;font-weight:500;margin:0 0 4px}
  .sub{color:#a9a9a9;font-size:13px;margin:0 0 12px}
  .fab{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:#262626;color:#e8e8e8;border:1px solid #333;border-radius:6px;padding:11px 12px;font-size:13px;cursor:pointer}
  .fab:hover{background:#2e2e2e}
  .fab .sum{flex:1}
  .fab .edit{color:#9cc9ff;font-size:12.5px}
  .dot{width:9px;height:9px;border-radius:50%;background:#f5a623;flex:none}
  .dot.ok{background:#3ddc84}
  .box{background:#202020;color:#e8e8e8;border:1px solid #333;border-top:0;border-radius:0 0 6px 6px;padding:14px 14px 10px;display:none}
  .box.open{display:block}
  .fab.open{border-radius:6px 6px 0 0}
  h2{margin:0 0 4px;font-size:17px}
  h3{margin:16px 0 8px;font-size:14px;color:#9cc9ff}
  p{margin:0 0 8px;font-size:12.5px;color:#a9a9a9;line-height:1.45}
  label{display:block;font-size:13px;margin:8px 0 4px}
  .row{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:13px}
  .row label{margin:0}
  input[type=password],input[type=text],input[type=number],select{width:100%;background:#121212;color:#eee;border:1px solid #444;border-radius:8px;padding:9px 10px;font-size:13px}
  input[type=checkbox]{width:16px;height:16px;accent-color:#409cff}
  .btns{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
  button.b{border:1px solid #444;background:#2a2a2a;color:#eee;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer}
  button.b.primary{background:#409cff;border-color:#409cff;color:#fff;font-weight:600}
  .st{font-size:12.5px;margin-top:8px;min-height:18px;font-weight:600}
  .ok{color:#3ddc84}.warn{color:#f5a623}
  .x{position:absolute;top:10px;right:12px;background:none;border:0;color:#aaa;font-size:20px;cursor:pointer}
  a{color:#9cc9ff;font-size:12.5px}
  hr{border:0;border-top:1px solid #333;margin:16px 0 4px}
  .recent{margin-top:10px;background:#202020;border:1px solid #333;border-radius:6px;padding:10px 12px}
  .rh{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;color:#cfcfcf;margin-bottom:6px}
  button.b.sm{padding:5px 9px;font-size:12px}
  .ln{font-size:12px;line-height:1.4;padding:4px 0;border-top:1px solid #2c2c2c}
  .ln:first-child{border-top:0}
  .ln .t{color:#8a8a8a}
  .ln.good{color:#3ddc84}.ln.bad{color:#f5a623}
  </style>
  <p class="ttl">Send from my Gmail</p>
  <p class="sub">The template, email and recipients above are used. LeadOcean finds the people; your CV is attached when the template has "Attach Resume" on.</p>
  <button class="fab" id="fab" type="button"><span class="dot" id="dot"></span><span class="sum" id="sum">Checking…</span><span class="edit" id="edit">Edit</span></button>
  <div class="recent"><div class="rh"><span>Latest results</span><button class="b sm" id="testBtn" type="button">Send test email to myself</button></div><div id="recent"></div><div class="st" id="testSt"></div></div>
  <div class="box" id="box">
    <p>Saved only in this browser. Your key is sent only to api.leadocean.io.</p>
    <h3>LeadOcean</h3>
    <label for="key">LeadOcean API key</label>
    <input id="key" type="password" autocomplete="off" placeholder="Paste your key here" />
    <div class="row"><input id="show" type="checkbox"><label for="show">Show key</label></div>
    <div class="row"><input id="loOn" type="checkbox"><label for="loOn">Use LeadOcean to find who to email</label></div>
    <div class="btns"><button class="b primary" id="loSave">Save key</button><button class="b" id="loTest">Test key</button><button class="b" id="loClear">Remove key</button></div>
    <div class="st" id="loSt"></div>
    <hr>
    <h3>Gmail</h3>
    <div class="row"><input id="omOn" type="checkbox"><label for="omOn">Also send them on Direct Application runs</label></div>
    <label for="mode">How</label>
    <select id="mode"><option value="auto">Send automatically</option><option value="review">Open each email in Gmail for me to check and send</option></select>
    <label for="cap">Most emails per day</label>
    <input id="cap" type="number" min="1" max="200" />
    <label for="headline">My headline, for {{headline}} ("I am ...")</label>
    <input id="headline" type="text" maxlength="160" placeholder="e.g. a data analyst with 5 years in fintech" />
    <label for="cv">CV to attach (PDF or Word, up to 5 MB)</label>
    <input id="cv" type="file" accept=".pdf,.doc,.docx" style="font-size:12.5px;color:#ccc" />
    <p id="cvName" style="margin-top:6px"></p>
    <div class="btns"><button class="b primary" id="omSave">Save</button></div>
    <div class="st" id="omSt"></div>
    <hr>
    <p>You need to be signed in to Gmail in this browser. The log of every email (and every skipped job) is on the <a href="#" id="more">full settings page</a>.</p>
  </div>`;
  const $ = (id) => root.getElementById(id);
  const say = (id, text, good) => { $(id).textContent = text; $(id).className = "st " + (good ? "ok" : "warn"); };

  // fill: put the saved values into the inputs (only when the box opens, so
  // nothing typed but not yet saved is overwritten). Otherwise only the saved
  // state (CV name, green dot) is refreshed.
  async function show(fill) {
    const r = await get([LO, OM, CV, "lazyReferralHeadline"]);
    if (fill) $("headline").value = typeof r.lazyReferralHeadline === "string" ? r.lazyReferralHeadline : "";
    const lo = r[LO] || {}, om = r[OM] || {}, cv = r[CV];
    if (fill) {
      $("key").value = lo.key || "";
      $("loOn").checked = lo.on === true;
      $("omOn").checked = om.on === true;
      $("mode").value = om.mode === "review" ? "review" : "auto";
      $("cap").value = Number(om.cap) > 0 ? String(Math.floor(Number(om.cap))) : "30";
    }
    $("cvName").textContent = cv && cv.name ? "Saved: " + cv.name + " (" + Math.round((cv.size || 0) / 1024) + " KB)" : "No CV saved. Emails go without an attachment.";
    const ready = lo.on === true && !!lo.key;
    $("dot").className = "dot" + (ready ? " ok" : "");
    $("sum").textContent = (ready ? "LeadOcean connected" : lo.key ? "LeadOcean key saved but switched off" : "LeadOcean key needed") +
      " · " + (cv && cv.name ? "CV: " + cv.name : "no CV saved") + " · up to " + (Number(om.cap) > 0 ? Math.floor(Number(om.cap)) : 30) + " a day";
    showRecent();
    return { lo, om, cv };
  }
  // The last few lines of the run log, so you can see here what happened.
  async function showRecent() {
    const list = ((await get("lazyEmailLog")).lazyEmailLog || []).slice(-5).reverse();
    const box = $("recent");
    box.textContent = "";
    if (!list.length) { const d = document.createElement("div"); d.className = "ln"; d.textContent = "Nothing yet. After each submitted application a line appears here."; return box.appendChild(d); }
    list.forEach((e) => {
      const d = document.createElement("div");
      d.className = "ln " + (e.status === "sent" || e.status === "send_success" ? "good" : "bad");
      const t = document.createElement("span"); t.className = "t";
      t.textContent = new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " " + [e.company, e.title].filter(Boolean).join(" – ") + ": ";
      d.append(t, document.createTextNode(e.text || e.status || ""));
      box.appendChild(d);
    });
  }
  // Sender picked in this dialog ("Select Email"), for the test email.
  function dialogSender() {
    const dlg = host.closest("*") && referralDialog();
    const text = dlg ? dlg.innerText || "" : "";
    const m = text.match(/[^\s@]+@[^\s@]+\.[a-z]{2,}/i);
    return m ? m[0] : "";
  }

  $("testBtn").addEventListener("click", () => {
    const to = dialogSender();
    if (!to) return say("testSt", "Pick your email under Select Email first.", false);
    say("testSt", "Opening Gmail and sending a test to " + to + "... (up to 2 minutes)", true);
    $("testBtn").disabled = true;
    chrome.runtime.sendMessage({ type: "LAZY_OWNMAIL_TEST", to }, (r) => {
      $("testBtn").disabled = false;
      if (chrome.runtime.lastError || !r) return say("testSt", "Could not reach the extension. Reload it at chrome://extensions and refresh this page.", false);
      say("testSt", r.text, !!r.ok);
    });
  });
  $("fab").addEventListener("click", () => {
    const open = $("box").classList.toggle("open");
    $("fab").classList.toggle("open", open);
    $("edit").textContent = open ? "Close" : "Edit";
    if (open) show(true);
  });
  $("show").addEventListener("change", (e) => { $("key").type = e.target.checked ? "text" : "password"; });
  // A key pasted into the box switches the finder on (it is what the key is for).
  $("key").addEventListener("input", () => { if ($("key").value.trim()) $("loOn").checked = true; });

  $("loSave").addEventListener("click", async () => {
    const key = $("key").value.trim(), on = $("loOn").checked;
    if (on && !key) return say("loSt", "Paste your LeadOcean API key first.", false);
    try {
      await set({ [LO]: { on, key, savedAt: Date.now() } });
      const { lo } = await show();
      if (lo.key === key && (lo.on === true) === on) say("loSt", on ? "Saved. LeadOcean is on." : "Saved. LeadOcean is off.", true);
      else say("loSt", "It did not save. Try again.", false);
    } catch (e) { say("loSt", "Could not save: " + (e.message || e), false); }
  });
  $("loTest").addEventListener("click", () => {
    const key = $("key").value.trim();
    if (!key) return say("loSt", "Paste your LeadOcean API key first.", false);
    say("loSt", "Checking...", true);
    chrome.runtime.sendMessage({ type: "LAZY_LEADOCEAN_TEST", key }, (r) => {
      if (chrome.runtime.lastError || !r) return say("loSt", "Could not reach the extension. Reload it and refresh this page.", false);
      say("loSt", r.text, !!r.ok);
    });
  });
  $("loClear").addEventListener("click", async () => {
    await new Promise((res) => chrome.storage.local.remove(LO, res));
    await show(true); say("loSt", "Key removed. LeadOcean is off.", false);
  });

  $("cv").addEventListener("change", () => {
    const f = $("cv").files && $("cv").files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return say("omSt", "That file is over 5 MB.", false);
    if (!/\.(pdf|docx?)$/i.test(f.name)) return say("omSt", "Choose a PDF or Word file.", false);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await set({ [CV]: { name: f.name, type: f.type || "", size: f.size, base64: String(reader.result).split(",")[1] || "", savedAt: Date.now() } });
        const { cv } = await show();
        say("omSt", cv && cv.name === f.name ? "CV saved." : "The CV did not save. Try again.", !!(cv && cv.name === f.name));
      } catch (e) { say("omSt", "Could not save the CV: " + (e.message || e), false); }
    };
    reader.readAsDataURL(f);
  });
  $("omSave").addEventListener("click", async () => {
    const cap = Math.floor(Number($("cap").value));
    if (!(cap >= 1 && cap <= 200)) return say("omSt", "Set the daily limit to a number from 1 to 200.", false);
    const prev = (await get(OM))[OM] || {};
    const next = Object.assign({}, prev, { on: $("omOn").checked, mode: $("mode").value, cap, savedAt: Date.now() });
    try {
      await set({ [OM]: next, lazyReferralHeadline: $("headline").value.trim() });
      const { lo, om } = await show();
      if (om.on !== next.on || Number(om.cap) !== cap) return say("omSt", "It did not save. Try again.", false);
      if (!(lo.on && lo.key)) say("omSt", "Saved. Also save your LeadOcean key above, it finds who to email.", false);
      else say("omSt", next.on ? "Saved. Referral emails go out from your Gmail on every run." : "Saved. Referral emails go out from your Gmail on \"Application with Referral\" runs.", true);
    } catch (e) { say("omSt", "Could not save: " + (e.message || e), false); }
  });
  $("more").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.sendMessage({ type: "LAZY_OPEN_OPTIONS" }, () => void chrome.runtime.lastError); });

  chrome.storage.onChanged.addListener((c) => { if (c[LO] || c[OM] || c[CV]) show(); else if (c.lazyEmailLog) showRecent(); });
  // Lives inside LazyApply's "Configure Referral Options" dialog, after
  // "Select Template", and nowhere else.
  function referralDialog() {
    const heads = document.querySelectorAll("h1,h2,h3,h4,h5,h6,p,span,div");
    for (const h of heads) {
      if (h.childElementCount || (h.textContent || "").trim() !== "Configure Referral Options") continue;
      let box = h;
      for (let i = 0; i < 12 && box.parentElement; i++) {
        box = box.parentElement;
        const btns = [...box.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
        if (btns.includes("Continue") && btns.includes("Back")) return box;
      }
    }
    return null;
  }
  function mount() {
    const dlg = referralDialog();
    if (!dlg) { if (host.isConnected) host.remove(); return; }
    if (dlg.contains(host)) return;
    const cont = [...dlg.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Continue");
    let footer = cont;
    while (footer && footer.parentElement !== dlg && !(footer.parentElement && [...footer.parentElement.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "Back") && footer.parentElement.textContent.trim().length < 40)) footer = footer.parentElement;
    if (footer && footer.parentElement && footer.parentElement !== dlg) footer = footer.parentElement;
    // the scrolling content sits just before the footer: add to its end
    const content = footer && footer.previousElementSibling;
    if (content) content.appendChild(host);
    else if (footer) footer.parentElement.insertBefore(host, footer);
    else dlg.appendChild(host);
    show();
  }
  mount(); setInterval(mount, 700); new MutationObserver(() => { if (!host.isConnected) mount(); }).observe(document.documentElement, { childList: true, subtree: true });
  show();
})();
