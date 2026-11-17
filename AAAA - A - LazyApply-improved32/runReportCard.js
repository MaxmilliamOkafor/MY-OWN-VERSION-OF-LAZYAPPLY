/*
 * "What happened to each job" card under LazyApply's Application Results.
 * Reads the report background.js saved at the end of the run (lazyLastRun,
 * see runReport.js): one line per outcome with its count and reasons, and the
 * full list of jobs with what happened to each.
 */
(function () {
  "use strict";
  if (window.__lazyRunCard || window.top !== window) return;
  window.__lazyRunCard = true;

  const ORDER = ["applied", "unconfirmed", "failed", "closed", "stuck", "timeout", "redirected", "skipped", "not_reached"];
  const COLOR = { applied: "#3ddc84", unconfirmed: "#9cc9ff", failed: "#ff6b6b", closed: "#a9a9a9", stuck: "#f5a623", timeout: "#f5a623", redirected: "#c39bff", skipped: "#a9a9a9", not_reached: "#777" };
  let host = null, shown = 0;

  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(rep) {
    const root = host.shadowRoot;
    root.textContent = "";
    const box = el("div", "font-family:Roboto,Segoe UI,Arial,sans-serif;background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:18px 20px;color:#e8e8e8;margin:16px 0");
    box.appendChild(el("div", "font-size:17px;font-weight:600;margin-bottom:4px", "What happened to each job"));
    const sum = ORDER.filter((k) => rep.counts[k]).map((k) => rep.counts[k]).reduce((a, b) => a + b, 0);
    box.appendChild(el("div", "font-size:12.5px;color:#a9a9a9;margin-bottom:12px", (rep.status === "interrupted" ? "Run stopped. " : "") + sum + " of " + rep.total + " jobs accounted for · " + new Date(rep.at).toLocaleString()));
    for (const k of ORDER) {
      const n = rep.counts[k];
      if (!n) continue;
      const row = el("div", "display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid #222");
      row.appendChild(el("span", "width:9px;height:9px;border-radius:50%;flex:none;background:" + COLOR[k]));
      row.appendChild(el("span", "width:34px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums", String(n)));
      const txt = el("div", "flex:1;font-size:13px");
      txt.appendChild(el("div", "", (rep.labels && rep.labels[k]) || k));
      const rs = Object.entries((rep.reasons && rep.reasons[k]) || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [r, c] of rs) txt.appendChild(el("div", "color:#a9a9a9;font-size:12px", (rs.length > 1 || c !== n ? c + " × " : "") + r));
      row.appendChild(txt);
      box.appendChild(row);
    }
    const det = el("details", "margin-top:10px;font-size:12.5px");
    det.appendChild(el("summary", "cursor:pointer;color:#9cc9ff", "Show all " + rep.rows.length + " jobs"));
    const list = el("div", "max-height:420px;overflow:auto;margin-top:8px");
    rep.rows.forEach((r, i) => {
      const line = el("div", "padding:5px 0;border-top:1px solid #222;display:flex;gap:8px");
      line.appendChild(el("span", "color:#777;width:28px;flex:none;text-align:right", String(i + 1)));
      const mid = el("div", "flex:1;min-width:0");
      const a = el("a", "color:#e8e8e8;text-decoration:none", [r.title, r.company].filter(Boolean).join(" – ") || r.url);
      if (/^https?:\/\//.test(r.url)) { a.href = r.url; a.target = "_blank"; a.rel = "noopener"; }
      mid.appendChild(a);
      mid.appendChild(el("div", "color:" + COLOR[r.outcome] + ";font-size:12px", ((rep.labels && rep.labels[r.outcome]) || r.outcome) + (r.reason ? ": " + r.reason : "")));
      line.appendChild(mid);
      list.appendChild(line);
    });
    det.appendChild(list);
    box.appendChild(det);
    const dbg = el("button", "margin-top:12px;background:#1f3a5c;color:#e8e8e8;border:1px solid #2d5582;border-radius:6px;padding:7px 12px;font-size:13px;cursor:pointer", "Open the Debugger: every step of this run, root causes, export");
    dbg.onclick = () => { try { chrome.runtime.sendMessage({ type: "LAZY_OPEN_DEBUGGER" }, () => void chrome.runtime.lastError); } catch (e) {} };
    box.appendChild(dbg);
    root.appendChild(box);
  }

  // The "Application Results" card of the dashboard.
  function resultsCard() {
    const hs = document.querySelectorAll("h1,h2,h3,h4,h5,h6,div,span,p");
    for (const h of hs) {
      if (h.childElementCount || h.textContent.trim() !== "Application Results") continue;
      let c = h.parentElement;
      for (let i = 0; c && i < 6; i++, c = c.parentElement) if (/Total Jobs Applied/.test(c.textContent) && /Success/.test(c.textContent)) return c;
    }
    return null;
  }

  function tick() {
    const card = resultsCard();
    if (!card) {
      if (host && !host.isConnected) host = null;
      return;
    }
    chrome.storage.local.get("lazyLastRun", (r) => {
      const rep = r && r.lazyLastRun;
      if (!rep || !Array.isArray(rep.rows)) return;
      if (!host) {
        host = document.createElement("div");
        host.id = "lazy-run-report";
        host.attachShadow({ mode: "open" });
      }
      if (host.previousElementSibling !== card) card.insertAdjacentElement("afterend", host);
      if (shown !== rep.at) { shown = rep.at; render(rep); }
    });
  }
  setInterval(tick, 1500);
  chrome.storage.onChanged.addListener((c) => { if (c.lazyLastRun) { shown = 0; tick(); } });
})();
