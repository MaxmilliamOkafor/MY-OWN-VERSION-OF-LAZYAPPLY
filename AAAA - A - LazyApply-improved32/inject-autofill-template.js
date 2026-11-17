/*
 * Host element for the "Automation In Progress" panel (autoFillTemplate.bundle.js
 * renders into #autoFillTemplate). Injected again on every page of the
 * automation tab, so it sets up once per page and afterwards only makes sure
 * the panel is still there and visible:
 *  - if the site rebuilds its page and removes the panel, it is put back
 *    (the same element, so the panel keeps its state);
 *  - it is kept in the top layer, above the site's own pop-ups;
 *  - if it ends up entirely off screen (dragged away, window resized), it is
 *    brought back into view.
 */
(function () {
  "use strict";
  // While a site has a modal <dialog> open, everything outside it is inert
  // (unclickable), so the panel lives inside the topmost modal until it closes.
  var topModal = function () {
    try {
      var m = document.querySelectorAll("dialog:modal");
      return m.length ? m[m.length - 1] : null;
    } catch (e) {
      return null;
    }
  };
  var place = function (host) {
    if (!host) return;
    var parent = topModal() || document.body || document.documentElement;
    if (!host.isConnected || host.parentNode !== parent) parent.appendChild(host);
  };
  if (window.__lazyPanelHost) {
    place(window.__lazyPanelHost);
    return;
  }
  var host = document.getElementById("autoFillTemplate");
  if (!host) {
    host = document.createElement("div");
    host.id = "autoFillTemplate";
    (document.body || document.documentElement).appendChild(host);
  }
  window.__lazyPanelHost = host;

  // Some sites (the newer Greenhouse boards, for one) rebuild their whole page
  // after loading, which throws away the panel's style sheets and leaves it as
  // plain text in the middle of the page. The sheets are remembered as soon as
  // they appear and put back whenever they go missing.
  var styles = (window.__lazyPanelStyles = window.__lazyPanelStyles || []);
  function keepStyles() {
    try {
      var all = document.querySelectorAll("style");
      for (var i = 0; i < all.length; i++) {
        var text = all[i].textContent || "";
        if (styles.indexOf(all[i]) < 0 && (text.indexOf("main-automation-control-div") >= 0 || text.indexOf("automationcontrol") >= 0 || text.indexOf(".control-card") >= 0)) styles.push(all[i]);
      }
      var home = document.head || document.documentElement;
      for (var j = 0; j < styles.length; j++) if (!styles[j].isConnected && home) home.appendChild(styles[j]);
    } catch (e) {}
  }

  var MARGIN = 40; // px of the panel that must stay on screen
  function keepVisible() {
    keepStyles();
    place(host);
    var panel = document.getElementById("main-automation-control-div");
    if (!panel) return;
    try {
      if (typeof panel.showPopover === "function" && !panel.matches(":popover-open")) panel.showPopover();
    } catch (e) {}
    var r = panel.getBoundingClientRect();
    if (
      r.width &&
      (r.right < MARGIN || r.bottom < MARGIN || r.left > window.innerWidth - MARGIN || r.top > window.innerHeight - MARGIN)
    ) {
      panel.style.transform = "translate(0px, 0px)";
      r = panel.getBoundingClientRect();
    }
    // Something opened later in the top layer (a site's modal dialog or popover)
    // covers the panel: show it again so it is the newest, topmost layer.
    if (r.width && typeof panel.showPopover === "function") {
      var el = document.elementFromPoint(
        Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1),
        Math.min(Math.max(r.top + 12, 0), window.innerHeight - 1)
      );
      if (el && !panel.contains(el)) {
        try {
          panel.hidePopover();
          panel.showPopover();
        } catch (e) {}
      }
    }
  }
  setInterval(keepVisible, 1000);
  try {
    var styleCheck = 0;
    new MutationObserver(function () {
      if (!host.isConnected) keepVisible();
      if (!styleCheck) styleCheck = setTimeout(function () { styleCheck = 0; keepStyles(); }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
