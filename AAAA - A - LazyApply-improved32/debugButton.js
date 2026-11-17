/*
 * A "Debugger" button that is always on LazyApply's dashboard (bottom left,
 * clear of the chat bubble on the right), so the Debugger can be opened with
 * one click instead of remembering Shift+Alt+D. It opens the same page as the
 * shortcut and the button on the run report card.
 */
(function () {
  "use strict";
  if (window.__lazyDebugButton || window.top !== window) return;
  window.__lazyDebugButton = true;

  const host = document.createElement("div");
  host.id = "lazy-debug-button";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
  :host{all:initial}
  button{position:fixed;left:20px;bottom:20px;z-index:2147483646;display:flex;align-items:center;gap:8px;
    font:600 14px/1 Roboto,Segoe UI,Arial,sans-serif;color:#fff;background:#1f6feb;border:1px solid #4c8dff;
    border-radius:999px;padding:11px 16px 11px 13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.45)}
  button:hover{background:#2b7bff}
  button:focus-visible{outline:2px solid #fff;outline-offset:2px}
  svg{width:18px;height:18px;flex:none}
  .k{font-weight:400;font-size:11.5px;opacity:.75;margin-left:2px}
  @media (max-width:600px){.k{display:none}}
  </style>
  <button type="button" title="Open the Debugger: every step of each run, root causes, export (also Shift+Alt+D)" aria-label="Open the Debugger">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 0 1 6 0v1.1"/>
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/>
      <path d="M12 20v-9M6.5 13H3M21 13h-3.5M6 9.5L3.5 8M18 9.5L20.5 8M6.4 17.5L4 19M17.6 17.5L20 19"/>
    </svg>
    Debugger<span class="k">Shift+Alt+D</span>
  </button>`;
  root.querySelector("button").addEventListener("click", () => {
    try {
      chrome.runtime.sendMessage({ type: "LAZY_OPEN_DEBUGGER" }, () => void chrome.runtime.lastError);
    } catch (e) {
      // The extension was reloaded: this page needs a refresh to reach it.
      alert("LazyApply was updated. Refresh this page, then click Debugger again.");
    }
  });

  const mount = () => {
    if (!host.isConnected && document.body) document.body.appendChild(host);
  };
  mount();
  // The dashboard is a single-page app that can replace the body's content.
  setInterval(mount, 2000);
})();
