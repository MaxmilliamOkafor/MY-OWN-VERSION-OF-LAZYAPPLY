/*
 * Search Boost — dashboard hook (runs in the page's own JavaScript world).
 *
 * Watches the dashboard's job search request to LazyApply's server and:
 *  1. widens it: turns on Workday/iCIMS results and uses the searched
 *     location's country instead of the hard-coded "us";
 *  2. merges in matching jobs from the extension's own job-board search
 *     (searchBoost.js, reached through searchBoostBridge.js);
 *  3. passes the companies seen in the server's results to the extension so
 *     their job boards are searched next time too.
 * If the extension does not answer in time, the server's response is used
 * unchanged, so the dashboard never breaks because of this script.
 */
(function () {
  "use strict";
  if (window.__lazyApplySearchBoost) return;
  window.__lazyApplySearchBoost = true;

  const SEARCH_RE = /\/lazyapplyv2\/job-search-v3(\?|$)/i;
  const rawFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  // Time budget (ms) of each search round: first jobs in ~10 s, then further
  // rounds while job boards are still loading (a cold start needs several).
  const BOOST_ROUNDS = [9000, 15000, 20000]; // later rounds: 20 s each, so new jobs arrive often
  // No time limit: rounds continue while job sites are still loading and
  // still giving new jobs. They end after this many rounds in a row with
  // nothing new (the sites have nothing more), or once the target is reached.
  const STALE_ROUNDS_TO_STOP = 3;
  // LazyApply's own server can take 25-40 s per batch. Once the extension has
  // jobs ready, the batch is answered with those after this grace period and
  // the server's jobs follow in the next batch.
  const EARLY_GRACE_MS = 1500;
  const SERVER_WAIT_MS = 4000; // longest wait for LazyApply's server once the extension is done
  const TAG = "lazyapply-search-boost";
  // Debugger (debugHook.js forwards these to the run log).
  const dbg = (lvl, msg, data) => { try { window.postMessage({ __lazyDbg: 1, cat: "search", lvl, msg, data }, location.origin); } catch (e) {} };

  const COUNTRY_CODES = {
    ireland: "ie", ie: "ie", "republic of ireland": "ie", dublin: "ie", cork: "ie", galway: "ie", limerick: "ie",
    "united kingdom": "uk", uk: "uk", england: "uk", scotland: "uk", wales: "uk", london: "uk",
    canada: "ca", germany: "de", france: "fr", india: "in", australia: "au", netherlands: "nl",
    spain: "es", italy: "it", portugal: "pt", poland: "pl", sweden: "se", singapore: "sg",
    "new zealand": "nz", belgium: "be", switzerland: "ch", austria: "at", denmark: "dk",
    "northern ireland": "uk", belfast: "uk", manchester: "uk", birmingham: "uk", edinburgh: "uk", glasgow: "uk",
    bristol: "uk", leeds: "uk", liverpool: "uk", cardiff: "uk", "great britain": "uk", britain: "uk", gb: "uk",
    "united states": "us", usa: "us", us: "us", "united states of america": "us",
    toronto: "ca", vancouver: "ca", montreal: "ca", calgary: "ca", ottawa: "ca",
    berlin: "de", munich: "de", frankfurt: "de", hamburg: "de", cologne: "de", deutschland: "de",
    paris: "fr", lyon: "fr", madrid: "es", barcelona: "es", lisbon: "pt", porto: "pt",
    rome: "it", milan: "it", amsterdam: "nl", rotterdam: "nl", "the netherlands": "nl", holland: "nl",
    brussels: "be", antwerp: "be", zurich: "ch", geneva: "ch", vienna: "at", copenhagen: "dk",
    stockholm: "se", oslo: "no", norway: "no", helsinki: "fi", finland: "fi", warsaw: "pl", krakow: "pl",
    prague: "cz", "czech republic": "cz", czechia: "cz", budapest: "hu", hungary: "hu", bucharest: "ro", romania: "ro",
    athens: "gr", greece: "gr", luxembourg: "lu", estonia: "ee", tallinn: "ee", latvia: "lv", riga: "lv",
    lithuania: "lt", vilnius: "lt", sofia: "bg", bulgaria: "bg", croatia: "hr", zagreb: "hr",
    "united arab emirates": "ae", uae: "ae", dubai: "ae", "abu dhabi": "ae", qatar: "qa", doha: "qa",
    "saudi arabia": "sa", riyadh: "sa", israel: "il", "tel aviv": "il", "south africa": "za",
    "cape town": "za", johannesburg: "za", nigeria: "ng", lagos: "ng", kenya: "ke", nairobi: "ke",
    japan: "jp", tokyo: "jp", "south korea": "kr", seoul: "kr", "hong kong": "hk", china: "cn",
    taiwan: "tw", philippines: "ph", manila: "ph", malaysia: "my", "kuala lumpur": "my",
    indonesia: "id", jakarta: "id", thailand: "th", bangkok: "th", vietnam: "vn", pakistan: "pk",
    mumbai: "in", bangalore: "in", bengaluru: "in", delhi: "in", hyderabad: "in", pune: "in", chennai: "in",
    sydney: "au", melbourne: "au", brisbane: "au", perth: "au", auckland: "nz", wellington: "nz",
    brazil: "br", "sao paulo": "br", mexico: "mx", "mexico city": "mx", argentina: "ar", "buenos aires": "ar",
    chile: "cl", colombia: "co", peru: "pe", turkey: "tr", istanbul: "tr", egypt: "eg", morocco: "ma",
  };

  // ------------------------------------------------------------- bridge --
  let seq = 0;
  const pending = new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__lazyBoost !== "res") return;
    const p = pending.get(e.data.id);
    if (p) {
      pending.delete(e.data.id);
      p(e.data.result);
    }
  });

  function askExtension(kind, payload, timeoutMs) {
    return new Promise((resolve) => {
      const id = TAG + ":" + ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, timeoutMs);
      pending.set(id, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
      window.postMessage({ __lazyBoost: "req", id, kind, payload }, window.location.origin);
    });
  }

  // ------------------------------------------------------------- search --
  const sessions = new Map(); // searchSessionId -> { boost: Promise, delivered: Set }

  function countryFor(locations) {
    for (const l of locations || []) {
      const plain = String(l).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      const parts = plain.split(/[,/|()]| - /).map((s) => s.replace(/\b(remote|hybrid|on-?site)\b/g, "").trim()).filter(Boolean);
      for (const p of [plain.trim()].concat(parts.reverse())) if (COUNTRY_CODES[p]) return COUNTRY_CODES[p];
    }
    return null;
  }

  // "Python, SQL, Data" typed into one box = three keywords. No limit here.
  function splitKeywords(list) {
    const out = [];
    for (const t of Array.isArray(list) ? list : [list]) {
      for (const k of String(t || "").split(/[,;|\n]+/)) {
        const v = k.replace(/\s+/g, " ").trim();
        if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
      }
    }
    return out;
  }

  const SERVER_MAX_TITLES = 4; // what the server's own search was built for
  const SUB_DAY_RE = /^qdr:(h\d*|n\d+)$/i; // past N hours / minutes
  const QUIET_PAGES_TO_STOP = 2; // pages in a row with nothing new before the search ends
  const DONE_TEXT = JSON.stringify({ jobs: [], total_jobs: 0, pagination: { has_more_pages: false } });
  // An empty server batch while keyword groups remain: try up to this many
  // further groups at once (the dashboard gives up after 2 empty batches).
  const FOLLOW_UPS = 4;
  const FOLLOW_UP_MS = 45000;
  // Keyword-group requests kept running on LazyApply's server at once: up to
  // 10, fewer while the server is refusing requests (then back up).
  const SERVER_PARALLEL = 10;
  const SERVER_PARALLEL_MIN = 2;
  // The dashboard stopped asking (search closed or replaced): stop sending.
  const ABANDONED_MS = 3 * 60000;
  // No time limit on the server side either: a keyword group is finished when
  // the server says it has no more pages, or after this many pages in a row
  // that bring nothing new (the same jobs again).
  const STALE_PAGES_PER_GROUP = 3;

  // The server searches at most 4 keywords per request. With more, each
  // request takes the next group of 4 (skipping groups the server says are
  // used up), so every keyword reaches the server over the batches.
  const rotations = new Map(); // searchSessionId -> state
  function rotateTitles(b, all) {
    const sid = b.searchSessionId || "no-session";
    let r = rotations.get(sid);
    if (!r) {
      const chunks = [];
      for (let i = 0; i < all.length; i += SERVER_MAX_TITLES) chunks.push(all.slice(i, i + SERVER_MAX_TITLES));
      r = { chunks, next: 0, page: chunks.map(() => 0), done: chunks.map(() => false), current: 0 };
      rotations.set(sid, r);
      if (rotations.size > 20) rotations.delete(rotations.keys().next().value);
    }
    const n = r.chunks.length;
    let idx = r.next % n;
    for (let k = 0; k < n; k++) {
      const i = (r.next + k) % n;
      if (!r.done[i]) {
        idx = i;
        break;
      }
    }
    r.next = idx + 1;
    r.current = idx;
    b.titles = r.chunks[idx];
    b.page = r.page[idx]++;
    return r;
  }

  function widenRequest(body) {
    try {
      const b = JSON.parse(body);
      b.includeWorkdayIcimsJobs = true;
      if (Array.isArray(b.titles) || typeof b.titles === "string") {
        const all = splitKeywords(b.titles);
        if (all.length) {
          b.titles = all.slice(0, SERVER_MAX_TITLES);
          // The extension's own search below gets every keyword.
          Object.defineProperty(b, "__allTitles", { value: all, enumerable: false });
          if (all.length > SERVER_MAX_TITLES) {
            const rot = rotateTitles(b, all);
            Object.defineProperty(b, "__rotation", { value: { r: rot, idx: rot.current }, enumerable: false, configurable: true });
          }
        }
      }
      const tf = b.timeFilter || (b.filtersForBackend && b.filtersForBackend.timeFilter) || "";
      Object.defineProperty(b, "__timeFilter", { value: tf, enumerable: false });
      if (SUB_DAY_RE.test(tf)) {
        // Hour / minute windows: the server only understands whole days.
        if (b.timeFilter) b.timeFilter = "qdr:d";
        if (b.filtersForBackend && b.filtersForBackend.timeFilter) {
          b.filtersForBackend = { ...b.filtersForBackend, timeFilter: "qdr:d" };
        }
      }
      // The dashboard always sends "us". A searched place sets its country;
      // no place (or Remote / Worldwide / a region) searches every country.
      const cc = countryFor(b.locations);
      if (!b.country || b.country === "us") b.country = cc || "";
      return { text: JSON.stringify(b), json: b };
    } catch (e) {
      return { text: body, json: null };
    }
  }

  function startBoost(req) {
    if (!req) return null;
    const sid = req.searchSessionId || "no-session";
    let s = sessions.get(sid);
    if (!s) {
      const query = {
        titles: req.__allTitles || splitKeywords(req.titles || []),
        locations: req.locations || [],
        timeFilter: req.__timeFilter || req.timeFilter || (req.filtersForBackend && req.filtersForBackend.timeFilter) || "",
        companiesToExclude: req.companiesToExclude || [],
        filters: pickFilters(req.filtersForBackend),
        limit: Math.min(2000, Math.max(300, (Number(req.totalNeeded) || 50) * 6)),
      };
      dbg("info", "Search started: " + query.titles.length + " keywords, target " + (Number(req.totalNeeded) || "?") + " jobs", { titles: query.titles, locations: query.locations, timeFilter: query.timeFilter, filters: query.filters, excluded: query.companiesToExclude.length });
      // Progressive search: a quick first round, then longer rounds while
      // boards are still loading (each round reuses everything cached by the
      // one before, so later rounds add jobs without redoing work).
      const run = (round) => {
        const budget = BOOST_ROUNDS[Math.min(round, BOOST_ROUNDS.length - 1)];
        s.running = askExtension("search", { ...query, budgetMs: budget }, budget + 20000).then((r) => {
          if (r && r.ok && Array.isArray(r.jobs)) {
            if (r.window || !s.window) s.window = r.window || null;
            if (r.window) {
              // Each round reports the window it used (an early, incomplete
              // round may have widened further): jobs not yet handed over
              // that fall outside the latest window are dropped.
              const now = Date.now();
              s.jobs = s.jobs.filter(
                (j) =>
                  s.delivered.has(keyOf(j)) ||
                  (typeof j.posted_ms === "number"
                    ? now - j.posted_ms <= r.window.usedMs + 60000
                    : dayOf(j) != null && now - dayOf(j) <= r.window.usedMs + 86400000)
              );
            }
            const seen = new Set(s.jobs.map(keyOf));
            let fresh = 0;
            for (const j of r.jobs) {
              const k = keyOf(j);
              if (k && !seen.has(k) && autofillSupported(j)) {
                seen.add(k);
                s.jobs.push(j);
                fresh++;
              }
            }
            s.staleRounds = fresh ? 0 : (s.staleRounds || 0) + 1;
          } else s.staleRounds = (s.staleRounds || 0) + 1;
          s.firstDone = true;
          if (r && r.ok && r.partial && !s.stopNext && s.staleRounds < STALE_ROUNDS_TO_STOP) run(round + 1);
          else s.running = null;
          return s.jobs;
        });
        return s.running;
      };
      s = {
        jobs: [],
        running: null,
        firstDone: false,
        get boost() {
          return boostJobs(s);
        },
        window: null,
        noticeShown: false,
        delivered: new Set(),
        deliveredSame: new Set(), // company + title of every job handed over
        pending: [],
        started: Date.now(),
        stopNext: false,
        serverSeen: new Set(),
        quiet: 0,
        prefetching: 0,
        staleRounds: 0,
      };
      sessions.set(sid, s);
      if (sessions.size > 20) sessions.delete(sessions.keys().next().value);
      run(0);
    }
    return s;
  }

  // Jobs found so far. Waits only when nothing new is ready to hand over:
  // the first round, or a later round when every found job was delivered.
  function undelivered(s) {
    return s.jobs.some((j) => {
      const k = keyOf(j);
      return k && !s.delivered.has(k) && !s.serverSeen.has(k);
    });
  }
  async function boostJobs(s) {
    if (s.running && (!s.firstDone || !undelivered(s))) await s.running;
    return s.jobs;
  }

  // Job Type / Work Type / Experience Level from "Additional Filters".
  function pickFilters(f) {
    if (!f || typeof f !== "object") return null;
    const v = (x) => (x && typeof x === "object" ? x.selected || x.value || "" : x || "");
    const out = { jobType: v(f.jobType), workType: v(f.workType), experienceLevel: v(f.experienceLevel) };
    return out.jobType || out.workType || out.experienceLevel ? out : null;
  }

  function subDayMs(tf) {
    const m = /^qdr:([hn])(\d*)$/i.exec(String(tf || ""));
    if (!m) return 86400000;
    const n = Number(m[2] || 1);
    return n * (m[1].toLowerCase() === "h" ? 3600000 : 60000);
  }

  // A posting time precise enough for minute / hour windows, or null.
  function exactTime(j) {
    if (!j) return null;
    if (typeof j.posted_ms === "number") return j.posted_ms;
    const v = j.date_posted || j.datePosted || j.postedDate;
    if (typeof v === "number") return v > 1e12 ? v : v * 1000;
    if (typeof v === "string" && /\d{1,2}:\d{2}/.test(v)) {
      const t = Date.parse(v);
      return isNaN(t) ? null : t;
    }
    return null;
  }

  const WINDOWS = { "qdr:d": 86400000, "qdr:w": 7 * 86400000, "qdr:m": 30 * 86400000, "qdr:y": 365 * 86400000 };
  // A date-only posting date ("2026-11-03"), as the start of that day, or null.
  function dayOf(j) {
    const v = j && (j.date_posted || j.datePosted || j.postedDate);
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
    const t = Date.parse(v.slice(0, 10) + "T00:00:00Z");
    return isNaN(t) ? null : t;
  }

  function fmtSpan(ms) {
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min} minutes`;
    const h = Math.round(min / 60);
    if (h >= 48) return `${Math.round(h / 24)} days`;
    return h === 1 ? "hour" : `${h} hours`;
  }

  function showNotice(text) {
    const id = "lazyapply-window-notice";
    const put = () => {
      if (!document.body) return setTimeout(put, 300);
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.setAttribute("role", "status");
        el.style.cssText =
          "position:fixed;left:50%;top:84px;transform:translateX(-50%);z-index:2147483000;max-width:min(640px,calc(100vw - 32px));" +
          "padding:12px 40px 12px 16px;border-radius:10px;background:#1e3a8a;color:#fff;font:500 14px/1.45 system-ui,sans-serif;" +
          "box-shadow:0 4px 16px rgba(0,0,0,.35)";
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "×";
        x.setAttribute("aria-label", "Close");
        x.style.cssText = "position:absolute;right:8px;top:6px;background:none;border:0;color:#fff;font-size:20px;cursor:pointer";
        x.onclick = () => el.remove();
        el.appendChild(document.createElement("span"));
        el.appendChild(x);
        document.body.appendChild(el);
      }
      el.firstChild.textContent = text;
      clearTimeout(el.__t);
      el.__t = setTimeout(() => el.remove(), 15000);
    };
    put();
  }

  const STOP_WORDS = new Set(("and or of the for in to with a an senior sr junior jr lead principal staff head chief " +
    "associate assistant intern graduate entry level remote hybrid i ii iii iv de des la le du und fur").split(" "));
  const wordsOf = (t) =>
    String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  // Words too common to show a job fits on their own ("Senior Software
  // Engineer" shares "engineer" with "Sales Engineer" but is not a match).
  const GENERIC_WORDS = new Set(("engineer engineering manager management analyst analytics specialist consultant consulting " +
    "officer coordinator owner director operations operation services service business technical technology tech product " +
    "program programme project process improvement data systems system solutions solution sales account client customer " +
    "partner success delivery change problem it ai ml team support expert professional administrator admin advisor " +
    "security cloud reporting master quality value digital financial payments monitoring party third model responsible " +
    "testing information officer strategy research marketing platform software developer global regional " +
    "general office executive representative partner trainer training procurement").split(" "));
  function keywordWords(list) {
    const set = new Set();
    const phrases = [];
    for (const k of list) {
      const ws = wordsOf(k);
      if (ws.length) phrases.push(ws);
      for (const w of ws) if (!GENERIC_WORDS.has(w)) set.add(w);
    }
    set.phrases = phrases;
    return set;
  }
  // A job title fits when it holds a whole searched title ("Product Manager"
  // in "Senior Product Manager, Payments") or a specific word from one
  // ("compliance", "risk", "kyc", including word forms like "auditor").
  function titleShares(title, words) {
    const ws = wordsOf(title);
    if (!ws.length) return true;
    const has = new Set(ws);
    if ((words.phrases || []).some((p) => p.every((w) => has.has(w)))) return true;
    return ws.some(
      (w) =>
        !GENERIC_WORDS.has(w) &&
        (words.has(w) || (w.length > 5 && [...words].some((k) => k.length > 5 && (w.startsWith(k) || k.startsWith(w)))))
    );
  }

  // Application sites LazyApply's autofill runs on (see manifest content
  // scripts). Jobs elsewhere cannot be applied to automatically, so they are
  // left out.
  const AUTOFILL_HOST_RE = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|icims\.com|rippling\.com|vivahr\.com|wellfound\.com)$/i;
  function autofillSupported(j) {
    const m = /^https?:\/\/([^/?#:]+)/i.exec(String((j && (j.apply_url || j.link || j.url)) || ""));
    return !!m && AUTOFILL_HOST_RE.test(m[1]);
  }

  // One key per job, whichever of its links is used (Greenhouse board vs embed
  // link, Lever /apply, Workday with or without the language part).
  function jobKey(u) {
    const s = String(u || "").trim();
    let m = /greenhouse\.io\/.*?[?&]for=([^&#]+).*?[?&]token=(\d+)/i.exec(s) || /greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i.exec(s);
    if (m) return "gh:" + m[1].toLowerCase() + ":" + m[2];
    m = /[?&]gh_jid=(\d+)/i.exec(s);
    if (m) return "gh::" + m[1];
    m = /lever\.co\/([^/?#]+)\/([0-9a-f-]{36})/i.exec(s);
    if (m) return "lever:" + m[2].toLowerCase();
    m = /ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{36})/i.exec(s);
    if (m) return "ashby:" + m[2].toLowerCase();
    m = /\/\/([^./]+)\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/?#]+)\/job\/.*?_([A-Za-z0-9-]+?)(?:-\d)?(?:[/?#]|$)/i.exec(s);
    if (m) return "wd:" + m[1].toLowerCase() + ":" + m[3].toLowerCase();
    return s.split("#")[0].replace(/\/(apply|application)\/?$/i, "").replace(/\/$/, "").toLowerCase();
  }
  const keyOf = (j) => jobKey(j && (j.apply_url || j.link || j.url));
  // Company + title + place: the same job listed twice (no company: no match).
  const sameJob = (j) => {
    const c = String((j && j.company) || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!c) return "nocompany:" + keyOf(j);
    const t = String((j && (j.title || j.jobTitle)) || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    const l = String((j && j.location) || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    return c + "|" + t + "|" + l;
  };

  // The job site a job is on, from its link.
  function platformOf(j) {
    const u = String(keyOf(j) || (j && (j.url || j.link || j.job_url || j.jobUrl)) || "").toLowerCase();
    const p = String((j && (j.platform || j.ats || j.source)) || "").toLowerCase();
    const s = u + " " + p;
    if (/myworkday|workday/.test(s)) return "workday";
    if (/icims/.test(s)) return "icims";
    if (/greenhouse/.test(s)) return "greenhouse";
    if (/lever\.co|\blever\b/.test(s)) return "lever";
    if (/ashby/.test(s)) return "ashby";
    if (/rippling/.test(s)) return "rippling";
    if (/smartrecruiters/.test(s)) return "smartrecruiters";
    return "other";
  }

  // Up to n jobs, one from each job site in turn (each site's own order kept),
  // so no supported site is crowded out when there are more jobs than room.
  function fairTake(list, n) {
    const groups = new Map();
    for (const j of list) {
      const k = platformOf(j);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(j);
    }
    const qs = [...groups.values()];
    const out = [];
    const max = Math.min(n, list.length);
    for (let i = 0; out.length < max; i++) for (const g of qs) if (i < g.length && out.length < max) out.push(g[i]);
    return out;
  }

  async function mergeResponse(text, req) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return text;
    }
    if (!data || !Array.isArray(data.jobs)) return text;

    // The search already ended (see the end of this function).
    const sp = startBoost(req);
    if (sp && sp.stopNext) return DONE_TEXT;
    // Server jobs that arrived after this batch was already answered early.
    if (sp && sp.pending.length) data.jobs = sp.pending.splice(0).concat(data.jobs);

    // Empty server batch with keyword groups left: ask the server for the
    // next groups now instead of returning an empty batch.
    const rot0 = req && req.__rotation;
    const s0 = startBoost(req);
    // Only worth the wait when the extension has nothing new to show either.
    // Background group requests are already running, or new jobs are in hand:
    // no need to hold this page for follow-up requests.
    if (s0 && ((s0.firstDone && undelivered(s0)) || s0.lastReq || freshPending(s0))) {
      if (rot0 && !data.jobs.length && !(data.pagination && data.pagination.has_more_pages)) rot0.r.done[rot0.idx] = true;
    } else if (rot0 && !data.jobs.length && typeof req.__send === "function") {
      if (!(data.pagination && data.pagination.has_more_pages)) rot0.r.done[rot0.idx] = true;
      const until = Date.now() + FOLLOW_UP_MS;
      for (let k = 0; k < FOLLOW_UPS && Date.now() < until && rot0.r.done.some((d) => !d); k++) {
        const nb = { ...req };
        const r = rotateTitles(nb, req.__allTitles);
        const idx = r.current;
        const res = await req.__send(nb);
        if (!res || !Array.isArray(res.jobs)) break;
        const more = !!(res.pagination && res.pagination.has_more_pages);
        if (!res.jobs.length && !more) r.done[idx] = true;
        if (res.jobs.length) {
          data.jobs = res.jobs;
          data.pagination = { ...(data.pagination || {}), ...(res.pagination || {}) };
          Object.defineProperty(req, "__rotation", { value: { r, idx }, enumerable: false, configurable: true });
          break;
        }
      }
    }

    const serverUrls = data.jobs.map(keyOf).filter(Boolean);
    if (serverUrls.length) askExtension("learn", { urls: serverUrls }, 5000);

    const s = startBoost(req);
    if (!s) return text;

    // 1. Keep only the server's jobs whose title matches a searched keyword.
    //    For hour / minute windows, keep only server jobs that carry an exact
    //    posting time inside the window (a bare date cannot be placed).
    let serverJobs = data.jobs;
    const subDay = SUB_DAY_RE.test((req && req.__timeFilter) || "");
    if (subDay) {
      const boosted = await s.boost; // also gives the window actually used
      const span = (s.window && s.window.usedMs) || subDayMs(req.__timeFilter);
      const now = Date.now();
      // Jobs with an exact posting time: only those inside the window, newest
      // first. Jobs with only a date: the server already limited them to the
      // past 24 hours, so they stay, listed after the exactly-timed ones.
      const timed = [];
      const dated = [];
      for (const j of serverJobs) {
        const t = exactTime(j);
        if (t == null) dated.push(j);
        else if (now - t <= span && now - t >= -300000) timed.push([t, j]);
      }
      timed.sort((a, b) => b[0] - a[0]);
      // A bare date can only be placed once the window is the whole day.
      // A bare date counts as that whole day: kept only if the day can fall inside the window.
      const datedIn = dated.filter((j) => {
        const d = dayOf(j);
        return d == null || now - d <= span + 86400000;
      });
      // Jobs dated only by day ("posted today") follow the exactly-timed ones.
      serverJobs = timed.map((x) => x[1]).concat(datedIn);
      if (s.window && s.window.widened && !s.noticeShown) {
        s.noticeShown = true;
        showNotice(
          `${s.window.askedMs < 3600000 ? "No jobs" : "Fewer than 10 jobs"} for this search were posted in the past ${fmtSpan(s.window.askedMs)}, so jobs from the past ${fmtSpan(s.window.usedMs)} are shown, newest first. ` +
            `Each card shows when it was posted. Remove the location or add more job titles for more results.`
        );
      }
    }
    serverJobs = serverJobs.filter(autofillSupported);
    // Day, week, month and year windows: a server job dated before the window is dropped.
    const winMs = WINDOWS[String((req && req.__timeFilter) || "").toLowerCase()];
    if (winMs && !subDay) {
      const now = Date.now();
      serverJobs = serverJobs.filter((j) => {
        const t = exactTime(j) || dayOf(j);
        return t == null || now - t <= winMs + 86400000;
      });
    }
    if (serverJobs.length) {
      // The same title rules as the extension's own jobs: the job title must
      // name what was searched ("Nurse Practitioner" is not "Registered Nurse").
      const kws = (req && req.__allTitles) || splitKeywords((req && req.titles) || []);
      const titles = serverJobs.map((j) => String((j && (j.title || j.jobTitle)) || ""));
      const r = await askExtension("filter", { titles: kws, jobTitles: titles }, 5000);
      if (r && r.ok && Array.isArray(r.keep) && r.keep.length === serverJobs.length) {
        serverJobs = serverJobs.filter((_, i) => r.keep[i]);
      } else {
        const words = keywordWords(kws);
        if (words.size || words.phrases.length) serverJobs = serverJobs.filter((j) => titleShares(String((j && (j.title || j.jobTitle)) || ""), words));
      }
    }
    const flt = pickFilters(req && req.filtersForBackend);
    const wantLoc = req && Array.isArray(req.locations) ? req.locations.filter(Boolean) : [];
    if ((flt || wantLoc.length) && serverJobs.length) {
      const r = await askExtension(
        "filter",
        {
          filters: flt,
          locations: wantLoc,
          jobs: serverJobs.map((j) => ({
            title: String((j && (j.title || j.jobTitle)) || ""),
            location: String((j && j.location) || ""),
            description: String((j && j.description) || "").slice(0, 600),
            employment_type: String((j && (j.employment_type || j.employmentType)) || ""),
          })),
        },
        5000
      );
      if (r && r.ok && Array.isArray(r.keep) && r.keep.length === serverJobs.length) {
        serverJobs = serverJobs.filter((_, i) => r.keep[i]);
        // Kept for a place named only in the description: say so on the card.
        if (wantLoc.length) {
          serverJobs = serverJobs.map((j) =>
            j && !String(j.location || "").trim() ? { ...j, location: `${wantLoc[0]} (per job description)` } : j
          );
        }
      }
    }
    const rot = req && req.__rotation;
    if (rot) notePage(rot.r, rot.idx, s, data);
    const groupsLeft = !!(rot && rot.r.done.some((d) => !d));
    let newFromServer = 0;
    for (const j of serverJobs) {
      const k = keyOf(j);
      if (k && !s.serverSeen.has(k) && !s.delivered.has(k)) newFromServer++;
      if (k) s.serverSeen.add(k);
    }

    // 2. Add the extension's own jobs, in chunks, so the dashboard's paging
    //    and limits keep working.
    const extra = await s.boost;
    // Server jobs repeated across batches, or the same job twice in one batch.
    const firstSeen = new Set();
    serverJobs = serverJobs.filter((j) => {
      const k = keyOf(j);
      const sj = sameJob(j);
      if ((k && (firstSeen.has(k) || s.delivered.has(k))) || s.deliveredSame.has(sj)) return false;
      firstSeen.add(k);
      s.deliveredSame.add(sj);
      s.delivered.add(k);
      return true;
    });
    // Never more than the chosen target ("Target 500 jobs") in total, across
    // every batch of this search.
    const target = Math.max(1, Number(req && req.totalNeeded) || 50);
    s.sent = s.sent || 0;
    const remaining = Math.max(0, target - s.sent);
    const have = new Set(serverJobs.map(keyOf));
    s.delivered.forEach((u) => have.add(u));
    // The extension's own jobs not shown yet (enough to reach the target).
    const room = Math.min(2000, remaining);
    const cand = [];
    const candSame = new Set();
    for (const j of room > 0 ? extra : []) {
      const k = keyOf(j);
      const sj = sameJob(j);
      if (!k || have.has(k) || s.serverSeen.has(k) || s.deliveredSame.has(sj) || candSame.has(sj)) continue;
      cand.push(j);
      have.add(k);
      candSame.add(sj);
      if (cand.length >= room) break;
    }
    // Every supported job site (Workday, iCIMS, Greenhouse, Lever, Ashby...)
    // gets its fair share of what is left of the target, whether a job came
    // from LazyApply's server or from the extension's own search.
    const picked = fairTake(serverJobs.concat(cand), remaining);
    const candSet = new Set(cand);
    const add = picked.filter((j) => candSet.has(j));
    for (const j of add) {
      s.delivered.add(keyOf(j));
      s.deliveredSame.add(sameJob(j));
    }

    // 3. Stop the search once nothing new is coming, instead of letting the
    //    dashboard ask the server for dozens more pages to reach the target.
    const serverBusy = groupsLeft || s.prefetching > 0 || s.pending.length > 0;
    if (!add.length && !newFromServer && !s.running && !serverBusy) s.quiet++;
    else s.quiet = 0;

    data.jobs = picked;
    if (typeof data.total_jobs === "number") data.total_jobs = data.jobs.length;
    if (!data.pagination || typeof data.pagination !== "object") data.pagination = {};
    if (add.length || serverBusy || s.running) data.pagination.has_more_pages = true;
    // No time limit: the search ends only when the target is reached or
    // nothing new is left anywhere (a few pages in a row with nothing new while
    // the extension and every keyword group are finished).
    if (s.quiet >= QUIET_PAGES_TO_STOP) {
      s.stopNext = true;
      data.jobs = [];
      data.pagination.has_more_pages = false;
    }
    s.sent += data.jobs.length;
    if (s.sent >= target) {
      // Target reached: this batch completes it and the search ends here.
      s.stopNext = true;
      data.pagination.has_more_pages = false;
    }
    dbg("info", "Page answered: " + data.jobs.length + " jobs (" + s.sent + "/" + target + " so far)" + (s.stopNext ? (s.sent >= target ? ", target reached, search ends" : ", nothing new left, search ends") : ""), {
      fromServer: newFromServer, fromExtension: add.length, queued: s.pending.length, running: s.prefetching, groupsLeft, quiet: s.quiet,
      platforms: data.jobs.reduce((m, j) => { const p = platformOf(j); m[p] = (m[p] || 0) + 1; return m; }, {}),
    });
    return JSON.stringify(data);
  }

  // ---------------------------------------------------------------- XHR --
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url) {
    try {
      this.__boost = String(method).toUpperCase() === "POST" && SEARCH_RE.test(String(url)) ? { url: String(url), headers: {} } : null;
    } catch (e) {
      this.__boost = null;
    }
    return origOpen.apply(this, arguments);
  };

  const origSetHeader = XHR.setRequestHeader;
  XHR.setRequestHeader = function (name, value) {
    try {
      if (this.__boost) this.__boost.headers[name] = value;
    } catch (e) {}
    return origSetHeader.apply(this, arguments);
  };

  function sender(url, headers) {
    return (body) => {
      if (!rawFetch) return Promise.resolve(null);
      const h = { ...(headers || {}) };
      if (!Object.keys(h).some((k) => k.toLowerCase() === "content-type")) h["Content-Type"] = "application/json";
      return rawFetch(url, { method: "POST", headers: h, body: JSON.stringify(body) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
    };
  }

  const PROTO_GET = (name) => {
    const d = Object.getOwnPropertyDescriptor(XHR, name);
    return d && d.get ? (x) => d.get.call(x) : (x) => x[name];
  };
  const realState = PROTO_GET("readyState");
  const realStatus = PROTO_GET("status");
  const realText = PROTO_GET("responseText");

  function answer(xhr, text) {
    try {
      Object.defineProperty(xhr, "responseText", { configurable: true, get: () => text });
      Object.defineProperty(xhr, "response", {
        configurable: true,
        get: () => (xhr.responseType === "json" ? JSON.parse(text) : text),
      });
    } catch (e) {}
  }

  // A server batch that comes back after the dashboard was already answered:
  // keep its jobs for the next batch and note whether its group is used up.
  function stashLate(req, text) {
    try {
      const data = JSON.parse(text);
      const s = startBoost(req);
      if (!s || !data || !Array.isArray(data.jobs)) return;
      const rot = req && req.__rotation;
      if (rot) notePage(rot.r, rot.idx, s, data);
      for (const j of data.jobs) s.pending.push(j);
    } catch (e) {}
  }

  // Send the next keyword groups to LazyApply's server at the same time as the
  // dashboard's own request; their jobs join the next batch.
  const EARLY_POLL_MS = 700;
  // Server jobs already in hand (from keyword groups sent alongside) that were
  // not handed over yet.
  function freshPending(s) {
    return s.pending.some((j) => {
      const k = keyOf(j);
      return k && autofillSupported(j) && !s.delivered.has(k) && !s.serverSeen.has(k);
    });
  }
  function groupsOpen(req) {
    const rot = req && req.__rotation;
    return !!(rot && rot.r.done.some((d) => !d));
  }

  // A server page for keyword group idx: the group is finished when the server
  // has no more pages, or after STALE_PAGES_PER_GROUP pages with nothing new.
  function notePage(r, idx, s, res) {
    const jobs = (res && Array.isArray(res.jobs) && res.jobs) || [];
    const more = !!(res && res.pagination && res.pagination.has_more_pages);
    const fresh = jobs.some((j) => {
      const k = keyOf(j);
      return k && !s.serverSeen.has(k) && !s.delivered.has(k);
    });
    r.stale = r.stale || r.chunks.map(() => 0);
    r.stale[idx] = fresh ? 0 : r.stale[idx] + 1;
    if ((!jobs.length && !more) || r.stale[idx] >= STALE_PAGES_PER_GROUP) r.done[idx] = true;
  }

  // Keeps SERVER_PARALLEL keyword-group requests running on LazyApply's server
  // all the time (not only when the dashboard asks for a page), so a long
  // keyword list is covered quickly. A failed request is retried (same page,
  // short pause); a group that fails 3 times is skipped.
  function prefetchGroups(req) {
    const rot = req && req.__rotation;
    const s = startBoost(req);
    if (!rot || !s || typeof req.__send !== "function") return;
    s.lastReq = req; // newest request: its sign-in headers are the freshest
    s.lastAsk = Date.now();
    pump(s);
  }
  function pump(s) {
    const req = s.lastReq;
    const r = req.__rotation.r;
    const all = req.__allTitles || [];
    while (
      !s.stopNext &&
      !(s.pumpFails >= 3 && !s.pumpOk) &&
      s.prefetching < (s.parallel || SERVER_PARALLEL) &&
      r.done.some((d) => !d) &&
      Date.now() >= (s.backoffUntil || 0) &&
      s.pending.length < 3000 &&
      Date.now() - s.lastAsk < ABANDONED_MS
    ) {
      const nb = { ...req };
      rotateTitles(nb, all);
      const idx = r.current;
      const page = nb.page;
      s.prefetching++;
      const sentAt = Date.now();
      req.__send(nb)
        .then((res) => {
          dbg(res && Array.isArray(res.jobs) ? "debug" : "warn", "Server keyword group " + (idx + 1) + "/" + r.chunks.length + " page " + page + ": " + (res && Array.isArray(res.jobs) ? res.jobs.length + " jobs" : "no answer") + " in " + Math.round((Date.now() - sentAt) / 100) / 10 + "s", { titles: nb.titles, running: s.prefetching, parallel: s.parallel });
          if (!res || !Array.isArray(res.jobs)) {
            s.pumpFails = (s.pumpFails || 0) + 1;
            r.fail = r.fail || r.chunks.map(() => 0);
            // Never worked at all (e.g. sign-in): leave the groups to the
            // dashboard's own requests instead of giving them up.
            if (++r.fail[idx] >= 3 && s.pumpOk) r.done[idx] = true;
            else r.page[idx] = Math.min(r.page[idx], page);
            s.backoffUntil = Date.now() + 3000;
            s.parallel = Math.max(SERVER_PARALLEL_MIN, (s.parallel || SERVER_PARALLEL) - 3);
            return;
          }
          s.pumpOk = true;
          s.parallel = Math.min(SERVER_PARALLEL, (s.parallel || SERVER_PARALLEL) + 1);
          notePage(r, idx, s, res);
          for (const j of res.jobs) s.pending.push(j);
        })
        .catch(() => {})
        .finally(() => {
          s.prefetching--;
          setTimeout(() => pump(s), Math.max(0, (s.backoffUntil || 0) - Date.now()));
        });
    }
  }

  XHR.send = function (body) {
    const ctx = this.__boost;
    if (!ctx || typeof body !== "string") return origSend.apply(this, arguments);

    const widened = widenRequest(body);
    ctx.req = widened.json;
    if (ctx.req) Object.defineProperty(ctx.req, "__send", { value: sender(ctx.url, ctx.headers), enumerable: false });
    const s = startBoost(ctx.req); // runs alongside the server request
    // Many keywords: the extension's own steady stream of keyword-group
    // requests does all the server work, so this page is answered from the
    // jobs already collected instead of adding one more slow request on top
    // (a pile of requests slows LazyApply's server down or gets refused).
    let pumpOnly = false;
    try {
      const rot = ctx.req && ctx.req.__rotation;
      pumpOnly = !!(s && rot && typeof ctx.req.__send === "function" && !(s.pumpFails >= 3 && !s.pumpOk));
      if (pumpOnly) rot.r.page[rot.idx] = Math.min(rot.r.page[rot.idx], Number(ctx.req.page) || 0); // this page was not sent
      prefetchGroups(ctx.req);
    } catch (e) {
      pumpOnly = false;
    }

    const xhr = this;
    let answered = false;
    // Answer the dashboard with the extension's jobs alone (LazyApply's server
    // is slow, down, or refusing requests). Returns false if there is nothing
    // to answer with, so the caller can pass the server's own reply on.
    const respond = async (handler) => {
      if (!s || !ctx.req) return false;
      answered = true;
      const text = await mergeResponse(JSON.stringify({ jobs: [], pagination: { has_more_pages: true } }), ctx.req).catch(() => null);
      if (!text) return false;
      answer(xhr, text);
      try {
        Object.defineProperty(xhr, "readyState", { configurable: true, get: () => 4 });
        Object.defineProperty(xhr, "status", { configurable: true, get: () => 200 });
        Object.defineProperty(xhr, "statusText", { configurable: true, get: () => "OK" });
      } catch (e) {}
      let ev = null;
      try {
        ev = new ProgressEvent("loadend");
      } catch (e) {}
      handler.call(xhr, ev);
      return true;
    };
    // The server failed (network error, rate limit, server error): the
    // extension's jobs are still shown. Sign-in problems (401 / 403) are passed
    // on so the dashboard can deal with them.
    const serverFailed = () => realState(xhr) === 4 && realStatus(xhr) !== 200 && realStatus(xhr) !== 401 && realStatus(xhr) !== 403;
    const deliver = (handler, ev) => {
      if (answered) {
        // Already answered early: the real reply only feeds the next batch.
        if (realState(xhr) === 4 && realStatus(xhr) === 200) {
          try {
            stashLate(ctx.req, realText(xhr));
          } catch (e) {}
        }
        return;
      }
      if (serverFailed()) {
        respond(handler).then((ok) => {
          if (!ok) handler.call(xhr, ev);
        });
        return;
      }
      if (xhr.readyState !== 4 || xhr.status !== 200) return handler.call(xhr, ev);
      let original = "";
      try {
        original = xhr.responseText;
      } catch (e) {
        return handler.call(xhr, ev);
      }
      answered = true;
      mergeResponse(original, ctx.req)
        .catch(() => original)
        .then((text) => {
          if (text !== original) answer(xhr, text);
          handler.call(xhr, ev);
        });
    };

    // Answer early with the extension's jobs when the server is slow.
    const early = (handler) => {
      if (!s || !ctx.req) return;
      const ended = () => s.stopNext;
      const done = () => answered || realState(xhr) === 4;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Hand over new jobs the moment they are ready (the extension's own, or
      // ones from keyword groups already sent to the server), instead of
      // waiting 25-40 s for this request's own server reply.
      (async () => {
        if (!s.firstDone) await boostJobs(s);
        if (!ended()) await sleep(EARLY_GRACE_MS);
        let idle = 0;
        while (!done()) {
          if (ended() || undelivered(s) || freshPending(s)) return respond(handler);
          // Nothing new is coming from anywhere but this request: stop waiting
          // on it after a short while (a late reply still joins the next batch).
          const waitingElsewhere = s.running || s.prefetching > 0;
          idle = waitingElsewhere ? 0 : idle + EARLY_POLL_MS;
          if (idle >= SERVER_WAIT_MS && !groupsOpen(ctx.req)) return respond(handler);
          await sleep(EARLY_POLL_MS);
        }
      })().catch(() => {});
    };
    // axios rejects on "error" / "timeout" before "loadend" arrives: when the
    // extension can answer, the failure is replaced by its jobs.
    const guardError = (name, handler) => {
      const orig = xhr[name];
      if (typeof orig !== "function") return;
      xhr[name] = function (ev) {
        if (answered) return;
        respond(handler).then((ok) => {
          if (!ok) orig.call(xhr, ev);
        });
      };
    };

    // axios listens with onloadend (or onreadystatechange on old browsers);
    // hold its callback until the extra jobs are merged in.
    if (typeof xhr.onloadend === "function") {
      const h = xhr.onloadend;
      xhr.onloadend = function (ev) {
        deliver(h, ev);
      };
      guardError("onerror", h);
      guardError("ontimeout", h);
      early(h);
    } else if (typeof xhr.onreadystatechange === "function") {
      const h = xhr.onreadystatechange;
      xhr.onreadystatechange = function (ev) {
        if (answered && realState(xhr) === 4) deliver(h, ev);
        else if (answered) return;
        else if (xhr.readyState === 4) deliver(h, ev);
        else h.call(xhr, ev);
      };
      guardError("onerror", h);
      guardError("ontimeout", h);
      early(h);
    } else pumpOnly = false;
    if (pumpOnly) return; // answered by early() from the collected jobs
    return origSend.call(this, widened.text);
  };

  // -------------------------------------------------------------- fetch --
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (method !== "POST" || !SEARCH_RE.test(String(url || "")) || !init || typeof init.body !== "string") {
        return origFetch.apply(this, arguments);
      }
      const widened = widenRequest(init.body);
      if (widened.json) {
        let hdrs = {};
        try {
          const H = init.headers;
          if (H && typeof H.forEach === "function" && !Array.isArray(H)) H.forEach((v, k) => (hdrs[k] = v));
          else if (Array.isArray(H)) H.forEach(([k, v]) => (hdrs[k] = v));
          else if (H) hdrs = { ...H };
        } catch (e) {}
        Object.defineProperty(widened.json, "__send", { value: sender(String(url), hdrs), enumerable: false });
      }
      startBoost(widened.json);
      try {
        prefetchGroups(widened.json);
      } catch (e) {}
      const fallback = async (res) => {
        try {
          const text = await mergeResponse(JSON.stringify({ jobs: [], pagination: { has_more_pages: true } }), widened.json);
          return new Response(text, { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } });
        } catch (e) {
          if (res) return res;
          throw e;
        }
      };
      let res;
      try {
        res = await origFetch.call(this, input, { ...init, body: widened.text });
      } catch (e) {
        if (!widened.json) throw e;
        return fallback(null);
      }
      if (!res.ok) return res.status === 401 || res.status === 403 || !widened.json ? res : fallback(res);
      try {
        const original = await res.clone().text();
        const text = await mergeResponse(original, widened.json);
        if (text === original) return res;
        return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
      } catch (e) {
        return res;
      }
    };
  }
})();
