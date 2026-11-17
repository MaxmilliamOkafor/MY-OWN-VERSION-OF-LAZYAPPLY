/*
 * Answers for dropdown / yes-no questions the AI left unanswered or answered
 * with text that matches none of the options (the field then stayed empty and
 * the run waited on that job until its timeout).
 *
 * Only answers that follow from the user's own profile, or that apply the
 * application itself:
 *  - a privacy / data notice whose only option is "Acknowledge" / "Confirm";
 *  - work permit / passport / "authorised to work in X": from the profile's
 *    "Authorised to work" list, citizenship and visa requirement. If those do
 *    not settle it, nothing is picked (never guessed);
 *  - visa sponsorship needed: from the profile's visa requirement;
 *  - willing to relocate: from the profile;
 *  - available for the job's hybrid / office days: Yes (the job states it and
 *    the user chose to apply).
 * Every answer is then matched to the exact option text ("Yes" -> "Yes, I am").
 *
 * Copied into atsAutomation.bundle.js (LAZY_ANSWER_FIX markers); loaded on its
 * own by the tests.
 */
(function (g) {
  "use strict";
  if (g.__lazyAnswers) return;

  const norm = (s) =>
    String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9+ ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const EU = ["austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia", "czech republic", "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland", "portugal", "romania", "slovakia", "slovenia", "spain", "sweden"];
  const EEA_EXTRA = ["norway", "iceland", "liechtenstein"];
  const EU_WORDS = /\b(eu|e u|european union|eea|european economic area|europe)\b/;
  const DEMONYM = { irish: "ireland", german: "germany", french: "france", spanish: "spain", italian: "italy", dutch: "netherlands", polish: "poland", portuguese: "portugal", austrian: "austria", belgian: "belgium", swedish: "sweden", danish: "denmark", finnish: "finland", greek: "greece", czech: "czechia", hungarian: "hungary", romanian: "romania", bulgarian: "bulgaria", croatian: "croatia", slovak: "slovakia", slovenian: "slovenia", estonian: "estonia", latvian: "latvia", lithuanian: "lithuania", maltese: "malta", cypriot: "cyprus", luxembourgish: "luxembourg", british: "united kingdom", american: "united states", canadian: "canada" };
  const OTHER = ["united kingdom", "uk", "united states", "usa", "us", "canada", "switzerland", "australia", "new zealand", "india", "singapore", "united arab emirates", "uae"];
  const ALIAS = { uk: "united kingdom", "great britain": "united kingdom", britain: "united kingdom", england: "united kingdom", usa: "united states", us: "united states", america: "united states", "czech republic": "czechia", holland: "netherlands", uae: "united arab emirates", deutschland: "germany", eire: "ireland" };
  const canon = (c) => {
    c = norm(c);
    return ALIAS[c] || DEMONYM[c] || c;
  };

  function misc(profile) {
    return (profile && profile.resume_data && profile.resume_data.miscellaneous) || {};
  }
  function personal(profile) {
    return (profile && profile.resume_data && profile.resume_data.personalInformation) || {};
  }
  // Where the profile says the user may work: {countries:Set, euWide:bool}
  function rights(profile) {
    const m = misc(profile);
    const list = Array.isArray(m.authorisedToWork) ? m.authorisedToWork : m.authorisedToWork ? String(m.authorisedToWork).split(/[,;/]+/) : [];
    const countries = new Set();
    let euWide = false;
    for (const x of list) {
      const v = typeof x === "object" && x ? x.label || x.value || x.name : x;
      const n = norm(v);
      if (!n) continue;
      if (EU_WORDS.test(n)) euWide = true;
      countries.add(canon(n));
    }
    const cit = canon(personal(profile).citizenship || m.citizenship || "");
    if (cit) {
      countries.add(cit);
      if (EU.includes(cit) || EEA_EXTRA.includes(cit)) euWide = true; // an EU/EEA passport
    }
    return { countries, euWide, citizenEU: EU.includes(cit) || EEA_EXTRA.includes(cit), visa: norm(m.visaRequirement), known: countries.size > 0 || euWide };
  }

  const YES = (opts) => pick(opts, "yes");
  const NO = (opts) => pick(opts, "no");
  // The option that means yes / no / the given text, or "".
  function pick(opts, want) {
    const w = norm(want);
    const list = (opts || []).map((o) => String(o == null ? "" : o));
    const first = (o) => norm(o).split(" ")[0];
    if (w === "yes" || w === "no") {
      const hit = list.find((o) => first(o) === w) || list.find((o) => norm(o) === (w === "yes" ? "true" : "false"));
      return hit || "";
    }
    return list.find((o) => norm(o) === w) || list.find((o) => norm(o).startsWith(w + " ")) || list.find((o) => w.startsWith(norm(o) + " ")) || "";
  }
  function matches(opts, ans) {
    if (!ans || !Array.isArray(opts) || !opts.length) return false;
    const a = norm(ans);
    return opts.some((o) => norm(o) === a);
  }

  // The country a question asks about ("authorised to work in Germany"), or
  // "eu", or the job's own location ("the specified hiring location").
  function placeAsked(q, jobPlace) {
    const t = " " + norm(q) + " ";
    if (EU_WORDS.test(t)) return { eu: true };
    const all = EU.concat(EEA_EXTRA, OTHER, Object.keys(ALIAS));
    for (const c of all) if (t.includes(" " + c + " ")) return { country: canon(c) };
    const jp = " " + norm(jobPlace) + " ";
    for (const c of all) if (jp.includes(" " + c + " ")) return { country: canon(c), fromJob: true };
    return {};
  }

  const WORK_RIGHT = /\b(passport|work permit|right to work|authori[sz]ed to work|authori[sz]ation to work|authori[sz]es you to work|eligible to work|legally (allowed|able|permitted|entitled) to work|legal right|permission to work|work authori[sz]ation)\b/;
  const SPONSOR = /\b(sponsor|sponsorship|require a visa|need a visa|visa support)\b/;
  const RELOCATE = /\b(relocat)/;
  const ARRANGEMENT = /\b(hybrid|in office|in the office|on ?site|onsite|days (a|per) week in|office days|days in (the )?office|commute|work from (our|the) office)\b/;
  const WILLING = /\b(happy|willing|able|available|comfortable|open|okay|ok|agree)\b/;
  const NOTICE = /\b(privacy|personal data|data protection|gdpr|your data|data policy|acknowledge|confirm|consent|terms|notice)\b/;
  const ACK_OPT = /^(i )?(acknowledge|confirm|agree|accept|consent|understand|yes|ok)\b|acknowledge|confirm/;

  /** Answer for one question, or null to leave it as it is. */
  function answerFor(q, profile, jobPlace) {
    const question = String((q && (q.question || q.label)) || "");
    const opts = Array.isArray(q && q.options) ? q.options.map((o) => (typeof o === "object" && o ? o.label || o.text || o.value : o)).filter((o) => o != null && String(o).trim()) : [];
    const t = norm(question);
    if (!t || !opts.length) return null;
    const real = opts.filter((o) => !/^(select|select one|select an option|choose|please select|\-+)$/i.test(String(o).trim()));
    // 1. A notice whose only real option is "Acknowledge/Confirm".
    if (real.length === 1 && NOTICE.test(t) && ACK_OPT.test(norm(real[0]))) return real[0];
    // 2. Work permit / passport / authorised to work: only from the profile.
    if (WORK_RIGHT.test(t) && !SPONSOR.test(t)) {
      const r = rights(profile);
      const where = placeAsked(question, jobPlace);
      let yes = null;
      if (where.eu) {
        // "EU passport or a valid work permit for the hiring location"
        const jobCountry = placeAsked("", jobPlace).country;
        if (r.euWide) yes = true;
        else if (/\bor\b/.test(t) && jobCountry && r.countries.has(jobCountry)) yes = true;
        else if (r.known && (!/\bor\b/.test(t) || jobCountry)) yes = false;
      } else if (where.country) {
        if (r.countries.has(where.country) || (r.euWide && (EU.includes(where.country) || EEA_EXTRA.includes(where.country)))) yes = true;
        else if (r.known && !where.fromJob) yes = false;
      }
      if (yes === null && r.visa === "need sponsorship" && !r.known) yes = false;
      return yes === null ? null : yes ? YES(opts) || null : NO(opts) || null;
    }
    // 3. Visa sponsorship needed: from the profile's visa requirement.
    if (SPONSOR.test(t)) {
      const v = rights(profile).visa;
      if (v === "need sponsorship") return YES(opts) || null;
      if (v === "have work permit" || v === "not required") return NO(opts) || null;
      return null;
    }
    // 4. Willing to relocate: from the profile.
    if (RELOCATE.test(t)) {
      const v = norm(misc(profile).willingToRelocation);
      if (v === "yes") return YES(opts) || null;
      if (v === "no") return NO(opts) || null;
      return null;
    }
    // 5. Available for the job's hybrid / office arrangement.
    if (ARRANGEMENT.test(t) && WILLING.test(t)) return YES(opts) || null;
    return null;
  }

  function jobPlaceOnPage() {
    try {
      const el = document.querySelector('.job__location, .location, [class*="job-location"], [data-qa="job-location"], .posting-categories .location, [class*="_location"]');
      return el ? el.textContent : "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Fix the answers of a list of questions in place ({question, options, answer}).
   * Only questions with options are touched; free-text answers stay as they are.
   */
  function fix(questions, profile) {
    if (!Array.isArray(questions)) return questions;
    const place = jobPlaceOnPage();
    const dbg = (q, before, why) => {
      try {
        if (self.__lazyDbg && before !== q.answer) self.__lazyDbg.log("ai", "info", 'Answer for "' + String(q.question || "").slice(0, 120) + '": ' + JSON.stringify(before == null ? null : String(before).slice(0, 80)) + " → " + JSON.stringify(q.answer == null ? null : String(q.answer).slice(0, 80)) + " (" + why + ")", { options: (q.options || []).slice(0, 15) });
        else if (self.__lazyDbg && (q.answer == null || q.answer === "")) self.__lazyDbg.log("ai", "warn", 'No answer for "' + String(q.question || "").slice(0, 120) + '" (no option matched and the profile does not settle it)', { options: (q.options || []).slice(0, 15) });
      } catch (e) {}
    };
    for (const q of questions) {
      const before = q && q.answer;
      let why = "AI answer kept";
      try {
        if (q && !Array.isArray(q.options) && Array.isArray(q.optionsText)) q.options = q.optionsText;
        if (!q || !Array.isArray(q.options) || !q.options.length) continue;
        const ours = answerFor(q, profile, place);
        const opts = q.options.map((o) => (typeof o === "object" && o ? o.label || o.text || o.value : o));
        if (ours && (WORK_RIGHT.test(norm(q.question)) || SPONSOR.test(norm(q.question)))) {
          q.answer = ours; // the profile decides these, not the AI
          why = "from your profile";
          continue;
        }
        if (matches(opts, q.answer)) {
          q.answer = opts.find((o) => norm(o) === norm(q.answer)) || q.answer;
          why = "matched to the option's wording";
          continue;
        }
        if (ours) {
          q.answer = ours;
          why = "AI answer matched no option; rule from profile / job";
          continue;
        }
        // The AI's "Yes" / "No" / text, put into the option's exact wording.
        const a = String(q.answer == null ? "" : q.answer);
        const exact = a ? pick(opts, /^(yes|no)\b/i.test(a.trim()) ? a.trim().split(/\W/)[0] : a) : "";
        if (exact) { q.answer = exact; why = "matched to the option's wording"; }
      } catch (e) {
      } finally {
        if (q && Array.isArray(q.options) && q.options.length) dbg(q, before, why);
      }
    }
    return questions;
  }

  /** One question asked on its own: returns the answer to use. */
  function fixOne(q, answer, profile) {
    const one = { question: q && q.question, options: q && q.options, answer };
    fix([one], profile);
    return one.answer;
  }

  // Questions where picking the first option when nothing matches could claim
  // something untrue (work rights, sponsorship, clearance, veteran, disability...).
  const SENSITIVE = /\b(passport|work permit|right to work|authori[sz]|eligible to work|legally|visa|sponsor|citizen|clearance|veteran|disab|criminal|convict|felony|security vetting)/;
  const sensitive = (q) => SENSITIVE.test(norm(q && typeof q === "object" ? q.question : q));

  g.__lazyAnswers = { fix, fixOne, answerFor, rights, pick, sensitive };
  if (typeof module !== "undefined" && module.exports) module.exports = g.__lazyAnswers;
})(typeof self !== "undefined" ? self : globalThis);
