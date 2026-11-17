/*
 * Your own job-site sign-in — makes the saved email and password (set on the
 * extension's "Job-site sign-in" page) available to the automation scripts on
 * sites that need an account before applying (iCIMS, Workday).
 *
 * Runs in the extension's own script world, so the page itself cannot read
 * the values. They are kept only in this browser (chrome.storage.local) and
 * are not sent to LazyApply's server.
 */
(function () {
  "use strict";
  if (window.__lazyCredsLoader) return;
  window.__lazyCredsLoader = true;

  const KEY = "lazyUserAtsCredentials";
  const apply = (v) => {
    window.__lazyCreds =
      v && typeof v.email === "string" && v.email.trim() && typeof v.password === "string" && v.password
        ? { email: v.email.trim(), password: v.password }
        : null;
  };

  try {
    chrome.storage.local.get(KEY, (r) => {
      if (chrome.runtime.lastError) return;
      apply(r && r[KEY]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[KEY]) apply(changes[KEY].newValue);
    });
  } catch (e) {}
})();
