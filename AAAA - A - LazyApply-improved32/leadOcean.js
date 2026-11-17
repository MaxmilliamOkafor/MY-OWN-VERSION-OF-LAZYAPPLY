// Optional contact finder for referral emails, using the user's own LeadOcean
// account. Runs in the background worker. Off unless switched on in the
// extension's options page. The API key is kept in this browser only and is
// sent to api.leadocean.io and nowhere else.
(function () {
  "use strict";
  var KEY = "lazyLeadOcean"; // { on: boolean, key: string }
  var API = "https://api.leadocean.io";
  var SEARCH_LIMIT = 8; // people per search; each one returned costs one LeadOcean record
  var MAX_EMAIL_LOOKUPS = 4; // each lookup costs one record
  var WANTED = 2; // the pop-up emails two people

  function settings() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(KEY, function (r) {
        var v = (r && r[KEY]) || {};
        resolve({ on: v.on === true, key: typeof v.key === "string" ? v.key.trim() : "" });
      });
    });
  }

  function call(key, path, params) {
    var q = [];
    for (var k in params || {}) {
      var v = params[k];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      q.push(encodeURIComponent(k) + "=" + encodeURIComponent(Array.isArray(v) ? v.join(",") : v));
    }
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, 20000);
    return fetch(API + path + (q.length ? "?" + q.join("&") : ""), { headers: { "x-api-key": key }, signal: ctl.signal })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (body) {
          return { status: res.status, body: body };
        });
      })
      .finally(function () { clearTimeout(timer); });
  }

  function errorText(r) {
    var m = r && r.body && r.body.error && r.body.error.message;
    if (r && r.status === 401) return "LeadOcean did not accept the API key.";
    if (r && r.status === 403) return "This LeadOcean key lacks the search or enrich permission.";
    if (r && r.status === 402) return "The LeadOcean account has no records left.";
    if (r && r.status === 429) return "LeadOcean is rate-limiting requests; try again shortly.";
    return m ? "LeadOcean: " + m : "LeadOcean could not be reached.";
  }

  function plain(v) {
    return String(v == null ? "" : v).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(inc|incorporated|ltd|limited|llc|plc|corp|corporation|co|company|gmbh|ag|sa|bv|nv|pty|holdings)\b/g, " ")
      .replace(/\s+/g, " ").trim();
  }
  // The person must work at this company, not one that merely shares a word.
  function sameCompany(a, b) {
    a = plain(a); b = plain(b);
    if (!a || !b) return false;
    if (a === b) return true;
    // "Acme" and "Acme Group" are the same employer; "Acme" and "Acme Parts Warehouse" are not.
    var long = a.length > b.length ? a : b, short = a.length > b.length ? b : a;
    if (long.indexOf(short + " ") !== 0) return false;
    return long.slice(short.length).trim().split(" ").every(function (w) {
      return /^(group|global|international|technologies|technology|labs|uk|usa|us|ireland|europe|emea|apac|software|systems|solutions|services|the)$/.test(w);
    });
  }

  var SKIP = /^(senior|sr|junior|jr|lead|principal|staff|associate|assistant|intern|graduate|head|director|manager|vp|chief|of|and|the|for|in|at|to|a|an|i|ii|iii|iv|remote|hybrid|\d+)$/;
  function titleWords(title) {
    return plain(title).split(" ").filter(function (w) { return w.length > 1 && !SKIP.test(w); }).slice(0, 3);
  }

  function toProfile(row) {
    var p = row.profile_data || {}, c = row.contact_data || {};
    var job = (c.contact_current_experiences || []).filter(function (e) { return e && e.current !== false; })[0] || {};
    var a = p.profile_address || {};
    return {
      personId: row.meta && row.meta.source_ids && row.meta.source_ids.person_id,
      name: p.profile_full_name || [p.profile_first_name, p.profile_last_name].filter(Boolean).join(" "),
      role: job.job_title || "",
      company: job.company_name || "",
      location: [a.city, a.state, a.country_code].filter(Boolean).join(", "),
      email: "x@pending.invalid", // placeholder so ranking keeps the row; replaced by the looked-up address
    };
  }

  async function find(job) {
    var s = await settings();
    if (!s.on) return { ok: false, reason: "off" };
    if (!s.key) return { ok: false, reason: "LeadOcean is on but no API key is saved." };
    var company = String((job && job.company) || "").trim();
    if (!company) return { ok: false, reason: "No company name for this job." };

    // Only people whose current work address has been checked.
    var base = {
      companyName: [company], emailType: ["work"], emailStatus: ["verified", "catch_all_valid"], limit: SEARCH_LIMIT,
      fields: ["profile_data.profile_full_name", "profile_data.profile_first_name", "profile_data.profile_last_name",
        "profile_data.profile_address", "contact_data.contact_current_experiences", "meta.source_ids"],
    };
    var searches = [Object.assign({}, base, { title: ["recruiter", "talent acquisition", "talent partner", "sourcer"] })];
    var words = titleWords(job.title);
    if (words.length) searches.push(Object.assign({}, base, { title: words, seniority: ["manager", "head", "director", "vp"] }));

    var rows = [], seen = {}, firstError = null;
    for (var i = 0; i < searches.length; i++) {
      var r;
      try { r = await call(s.key, "/v1/people/search", searches[i]); } catch (e) { r = null; }
      if (!r || r.status !== 200 || !r.body || !Array.isArray(r.body.data)) {
        firstError = firstError || errorText(r);
        if (r && (r.status === 401 || r.status === 403 || r.status === 402)) break;
        continue;
      }
      r.body.data.forEach(function (row) {
        var p = toProfile(row);
        if (!p.personId || !p.name || seen[p.personId] || !sameCompany(p.company, company)) return;
        seen[p.personId] = true;
        p.id = rows.length + 1;
        rows.push(p);
      });
    }
    if (!rows.length) return { ok: false, reason: firstError || "LeadOcean found nobody with a checked work email at " + company + "." };

    // Same ordering the pop-up uses: hiring manager for the role, then recruiter; location breaks ties.
    var ranked = rows;
    try {
      if (self.__lazyEmail && self.__lazyEmail.rank) {
        var order = self.__lazyEmail.rank(rows.map(function (p) {
          return { id: p.id, name: p.name, role: p.role, email: p.id + "@pending.invalid", location: p.location };
        }), { title: job.title }, { currentIndex: 0, links: [{ location: job.location || "" }] });
        ranked = order.map(function (o) { return rows.filter(function (p) { return p.id === o.id; })[0]; }).filter(Boolean);
      }
    } catch (e) {}

    var out = [], lookups = 0;
    for (var j = 0; j < ranked.length && out.length < WANTED && lookups < MAX_EMAIL_LOOKUPS; j++) {
      lookups++;
      var er;
      try { er = await call(s.key, "/v2/people/email/work", { contact_id: ranked[j].personId }); } catch (e) { er = null; }
      var d = er && er.status === 200 && er.body && er.body.data;
      var address = d && typeof d.email === "string" ? d.email.trim() : "";
      if (!address || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) continue;
      if (d.status && ["verified", "catch_all_valid"].indexOf(d.status) < 0) continue;
      out.push({ name: ranked[j].name, title: ranked[j].role, email: address, location: ranked[j].location });
    }
    if (!out.length) return { ok: false, reason: "LeadOcean had no checked work email for the best matches at " + company + "." };
    return { ok: true, people: out };
  }

  // Free call: confirms the saved key works and shows what is left.
  async function test(key) {
    key = String(key || "").trim() || (await settings()).key;
    if (!key) return { ok: false, text: "No API key saved." };
    var r;
    try { r = await call(key, "/v1/account", {}); } catch (e) { r = null; }
    if (!r || r.status !== 200) return { ok: false, text: errorText(r) };
    var d = (r.body && (r.body.data || r.body)) || {};
    var rec = d.records || {};
    var plan = (d.account && d.account.plan) || (typeof d.plan === "string" ? d.plan : "");
    var usage = rec.remaining != null ? ", " + rec.remaining + " records left this month." : rec.used != null ? ", " + rec.used + " records used this month." : ".";
    return { ok: true, text: "Connected to LeadOcean" + (plan ? " (" + plan + " plan)" : "") + usage };
  }

  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (!request || (request.type !== "LAZY_LEADOCEAN_FIND" && request.type !== "LAZY_LEADOCEAN_TEST")) return;
    if (sender && sender.id && sender.id !== chrome.runtime.id) return;
    var work = request.type === "LAZY_LEADOCEAN_FIND" ? find(request.job || {}) : test(request.key);
    work.then(sendResponse, function () { sendResponse({ ok: false, reason: "LeadOcean lookup failed.", text: "LeadOcean lookup failed." }); });
    return true;
  });

  self.LazyLeadOcean = { find: find, test: test, sameCompany: sameCompany, titleWords: titleWords };
})();
