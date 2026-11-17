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
 *    the user chose to apply);
 *  - County / State / Province of the address: the profile's state;
 *  - name Prefix (Mr / Ms): from the profile's gender, else left alone;
 *  - "Have you (ever) worked for / been an employee of <Company>?": Yes only
 *    when <Company> is in the profile's work history, else No. Only when
 *    the question names the company; relatives, referrals and earlier
 *    applications are not touched;
 *  - "How did you hear about us?": a job-board / website / other option,
 *    only when the AI's answer matches none of the options.
 * Every answer is then matched to the exact option text ("Yes" -> "Yes, I am").
 *
 * Optional name / address fields (middle name, address line 2, extension,
 * suffix) are no longer filled with "NA" / "N/A": they are left empty.
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
  const MARKETING = /\b(whatsapp|sms|text messages?|newsletter|marketing|talent (community|pool)|future (opportunities|roles|vacancies)|job alerts?)\b/;
  const AGREE_OPT = /^(yes\b|i (have read|acknowledge|agree|accept|consent|confirm|understand)|agree|accept|acknowledge|confirm)/;
  const REFUSE_OPT = /\b(not|don'?t|do not|decline|disagree|refuse|withdraw)\b|^no\b/;
  const ACK_OPT =/^(i )?(acknowledge|confirm|agree|accept|consent|understand|yes|ok)\b|acknowledge|confirm/;

  // ---- Address region / prefix / past employer / source --------------------
  const REGION_Q = /^(county|state|province|region|state province|state or province|state region|county region|prefecture|territory)$/;
  const regionKey = (s) => norm(s).replace(/\b(county|co|state of|province of|province|region|city of)\b/g, " ").replace(/\s+/g, " ").trim();
  function regionOption(opts, profile) {
    const p = personal(profile);
    const wants = [p.state, p.county, p.region, p.province].map(regionKey).filter(Boolean);
    if (!wants.length) return null;
    for (const w of wants) {
      const hit = opts.find((o) => regionKey(o) === w);
      if (hit) return hit;
    }
    return null;
  }
  const PREFIX_Q = /^(prefix|title|salutation|name prefix|honorific)$/;
  function prefixOption(opts, profile) {
    const g = norm(personal(profile).gender || misc(profile).gender);
    const order = g === "male" || g === "man" ? ["mr"] : g === "female" || g === "woman" ? ["ms", "mrs", "miss"] : [];
    for (const w of order) {
      const hit = opts.find((o) => norm(o).replace(/\s+/g, "") === w);
      if (hit) return hit;
    }
    return null;
  }
  const NOT_EMPLOYER_Q = /\b(relative|relatives|family|spouse|partner|reseller|customer|client|vendor|supplier|friend|know anyone|referr|refer|applied|interview|government|public sector|military|competitor|non ?compete|restrict|agreement|clearance)\b/;
  // The company named right after "worked at / for", "employee of" or in
  // "a <Company> employee" (capitalised, so "working with Python" is not one).
  const NAME = "([A-Z][\\w&.'’-]*(?:\\s+(?:[A-Z][\\w&.'’-]*|&))*)";
  const ART = "(?:(?:the|a|an|either)\\s+)?";
  const EMP_AT = new RegExp(
    "\\b(?:work(?:ed|ing)?|employed|contracted|interned)\\s+(?:at|for|by)(?:\\s+or\\s+(?:at|for|by))?\\s+" + ART + NAME +
      "|\\b(?:employee|team member|contractor|intern)\\s+(?:of|at)\\s+" + ART + NAME +
      "|\\b(?:an?|current|former)\\s+([A-Z][\\w&.'’-]*(?:\\s+[A-Z][\\w&.'’-]*){0,3}?)\\s+(?:[Ee]mployee|[Tt]eam [Mm]ember|[Cc]ontractor)\\b"
  );
  const NOT_COMPANY = /^(any|our|this|the|a|an|us|you|your|company|organization|organisation|firm|group|employer|we|it|its)$/i;
  function companyAsked(question) {
    const m = EMP_AT.exec(String(question || ""));
    const name = m && (m[1] || m[2] || m[3]);
    if (!name) return "";
    const n = norm(name).replace(/\b(inc|ltd|llc|plc|corp|corporation|company|group|gmbh|ag|sa)\b/g, " ").replace(/\s+/g, " ").trim();
    return n && !NOT_COMPANY.test(n) && n.length >= 2 ? n : "";
  }
  function workedThere(profile, company) {
    const list = (profile && profile.resume_data && profile.resume_data.workExperience) || [];
    const key = (s) => norm(s).replace(/\b(inc|ltd|llc|plc|corp|corporation|company|group|gmbh|ag|sa)\b/g, " ").replace(/\s+/g, " ").trim();
    return list.some((w) => {
      const c = key(w && w.company && typeof w.company === "object" ? w.company.name || w.company.title : w && w.company);
      return c && (c === company || (" " + c + " ").includes(" " + company + " ") || (" " + company + " ").includes(" " + c + " "));
    });
  }
  const SOURCE_Q = /\b(how|where) did you (first )?(hear|learn|find out|come across)\b|\bsource\b|\breferral source\b/;
  const SOURCE_OPTS = [/\bjob ?board\b|\bjob site\b|\bonline job\b/, /\b(company|career|careers|corporate) (web)?site\b|\bwebsite\b|\binternet\b|\bonline\b/, /^other\b/];
  function sourceOption(opts) {
    for (const re of SOURCE_OPTS) {
      const hit = opts.find((o) => re.test(norm(o)));
      if (hit) return hit;
    }
    return null;
  }

  /** Answer for one question, or null to leave it as it is. */
  function answerFor(q, profile, jobPlace) {
    const question = String((q && (q.question || q.label)) || "");
    const opts = Array.isArray(q && q.options) ? q.options.map((o) => (typeof o === "object" && o ? o.label || o.text || o.value : o)).filter((o) => o != null && String(o).trim()) : [];
    const t = norm(question);
    if (!t || !opts.length) return null;
    const real = opts.filter((o) => !/^(select|select one|select an option|choose|please select|\-+)$/i.test(String(o).trim()));
    // 1. A notice whose only real option is "Acknowledge/Confirm".
    if (real.length === 1 && NOTICE.test(t) && ACK_OPT.test(norm(real[0]))) return real[0];
    // A privacy / terms notice with "I agree" and "I do not agree" style options:
    // agreeing is required to apply. (Not marketing: WhatsApp, newsletters...)
    if (NOTICE.test(t) && !MARKETING.test(t)) {
      const yes = real.filter((o) => AGREE_OPT.test(norm(o)) && !REFUSE_OPT.test(norm(o)));
      if (yes.length === 1 && real.length <= 4) return yes[0];
    }
    // Address region and name prefix: from the profile.
    if (REGION_Q.test(t)) return regionOption(real, profile);
    if (PREFIX_Q.test(t)) return prefixOption(real, profile);
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
    // 6. Worked for / employee of the named company: from the work history.
    if (!NOT_EMPLOYER_Q.test(t) && YES(opts) && NO(opts)) {
      const company = companyAsked(question);
      if (company) return workedThere(profile, company) ? YES(opts) : NO(opts);
    }
    // 7. How did you hear about us.
    if (SOURCE_Q.test(t)) return sourceOption(real);
    return null;
  }

  // Optional fields the AI fills with "NA": better left empty.
  const OPTIONAL_TEXT = /\b(middle name|address line ?[23]|extension|suffix|preferred name|nickname|apartment|suite|address 2)\b/;
  const FILLER = /^(n\/?a|na|none|null|nil|not applicable|-+|\.)$/i;
  // Removes those questions from the list (in place) so they are not typed.
  function dropFiller(questions) {
    for (let i = questions.length - 1; i >= 0; i--) {
      const q = questions[i];
      if (!q || (Array.isArray(q.options) && q.options.length)) continue;
      if (!/^(text|textarea)$/.test(String(q.type || "text"))) continue;
      if (OPTIONAL_TEXT.test(norm(q.question)) && FILLER.test(String(q.answer == null ? "" : q.answer).trim())) {
        try {
          if (self.__lazyDbg) self.__lazyDbg.log("ai", "info", 'Left "' + String(q.question).slice(0, 80) + '" empty instead of "' + String(q.answer) + '"');
        } catch (e) {}
        questions.splice(i, 1);
      }
    }
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
    try {
      dropFiller(questions);
    } catch (e) {}
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
        const tq = norm(q.question);
        if (ours && (WORK_RIGHT.test(tq) || SPONSOR.test(tq) || REGION_Q.test(tq) || PREFIX_Q.test(tq))) {
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

  g.__lazyAnswers = { fix, fixOne, answerFor, rights, pick, sensitive, companyAsked, regionOption, prefixOption, dropFiller };
  if (typeof module !== "undefined" && module.exports) module.exports = g.__lazyAnswers;
})(typeof self !== "undefined" ? self : globalThis);
