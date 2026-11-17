/*
 * Workday "My Experience": Work Experience, Education and Websites entries.
 *
 * The answers for this page come back from an AI service one field at a time,
 * without knowing which entry a field belongs to, so every Work Experience
 * entry got the same job and invented dates, and the same website was added
 * twice. Here each entry is filled from the matching profile entry instead
 * (entry 1 from the first job, entry 2 from the second, ...):
 *  - job title, company, location, from / to, description: from the profile;
 *  - school, degree, field of study, GPA, years: from the profile;
 *  - websites: each profile link once.
 * A field the profile has no value for is left empty (never guessed), and
 * extra entries (more than the profile has, or duplicate websites) are
 * deleted. Nothing is made up: dates come only from the profile, and an entry
 * whose end date is before its start date gets no dates at all.
 *
 * Copied into atsAutomation.bundle.js (between the LAZY_WD_SECTIONS markers)
 * and loaded on its own by the tests.
 */
(function (g) {
  "use strict";
  if (g.__lazyWdSections) return;

  const str = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

  // "2023-01", "2023-01-15", "01/2023", "1/2023", "Jan 2023", "January 2023", "2023" -> {m, y} or null.
  function parseDate(v) {
    const s = str(v).toLowerCase();
    if (!s || /^(present|current|now|today)$/.test(s)) return null;
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/.exec(s))) return ok(+m[2], +m[1]);
    if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s))) return ok(+m[1], +m[2]);
    if ((m = /^(\d{1,2})[-/.]\d{1,2}[-/.](\d{4})$/.exec(s))) return ok(+m[1], +m[2]);
    if ((m = /^([a-z]{3,9})\.?,? (\d{4})$/.exec(s)) && MONTHS[m[1].slice(0, m[1] === "sept" ? 4 : 3)]) return ok(MONTHS[m[1].slice(0, 3)], +m[2]);
    if ((m = /^(\d{4})$/.exec(s))) return { m: 0, y: +m[1] };
    const t = Date.parse(s);
    if (!isNaN(t)) {
      const d = new Date(t);
      return ok(d.getUTCMonth() + 1, d.getUTCFullYear());
    }
    return null;
    function ok(mo, y) {
      return mo >= 1 && mo <= 12 && y >= 1900 && y <= 2100 ? { m: mo, y } : null;
    }
  }
  const mmYYYY = (d) => (d && d.m ? String(d.m).padStart(2, "0") + "/" + d.y : "");
  const isCurrent = (w) => w.currentlyWorkHere === true || /^(present|current|now)$/i.test(str(w.endDate));
  const nameOf = (v) => (v && typeof v === "object" ? str(v.name || v.title || "") : str(v));

  function jobs(profile) {
    const list = (profile && profile.resume_data && profile.resume_data.workExperience) || [];
    return list.filter((w) => w && (str(w.jobTitle) || nameOf(w.company)));
  }
  function schools(profile) {
    const list = (profile && profile.resume_data && profile.resume_data.education) || [];
    return list.filter((e) => e && nameOf(e.institution));
  }
  // Every link in the profile, each once (LinkedIn first).
  function links(profile) {
    const rd = (profile && profile.resume_data) || {};
    // Links live in "miscellaneous" (linkedinUrl, portfolioUrl, githubUrl...);
    // older profiles kept some in personal information.
    const p = Object.assign({}, rd.personalInformation || {}, rd.miscellaneous || {});
    const out = [];
    const seen = new Set();
    const add = (u) => {
      u = str(u);
      if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(u)) return;
      const k = u.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
      if (seen.has(k)) return;
      seen.add(k);
      out.push(u);
    };
    const keys = Object.keys(p).sort((a, b) => (/linkedin/i.test(b) ? 1 : 0) - (/linkedin/i.test(a) ? 1 : 0));
    for (const k of keys) {
      const v = p[k];
      if (Array.isArray(v)) v.forEach(add);
      else if (typeof v === "string" && /linkedin|github|portfolio|website|url|link|site|blog|twitter/i.test(k)) add(v);
    }
    return out;
  }

  // Degree text for the Degree list: "Master of Science" / "BSc ..." / degree type.
  function degreeText(e) {
    const d = e.degree;
    if (d && typeof d === "object") return str(d.degreeName) || str(d.degreeType);
    return str(d);
  }
  // Field of study: the profile's specialisation, else what follows the degree
  // in its name ("BSc Exercise and Sport Sciences" -> "Exercise and Sport Sciences").
  function fieldOfStudy(e) {
    const d = e.degree && typeof e.degree === "object" ? e.degree : {};
    const sp = Array.isArray(d.specialization) ? d.specialization.map(str).filter(Boolean) : str(d.specialization) ? [str(d.specialization)] : [];
    if (sp.length) return sp[0];
    const name = str(d.degreeName || e.degree);
    const m = /^(?:b\.?\s?sc|bsc|b\.?\s?a|ba|b\.?\s?eng|beng|m\.?\s?sc|msc|m\.?\s?a|ma|mba|meng|m\.?\s?eng|phd|ph\.?d\.?|llb|llm|bachelor(?:'s)?(?: of [a-z]+)?|master(?:'s)?(?: of [a-z]+)?|doctor(?:ate)?(?: of [a-z]+)?|postgraduate (?:diploma|certificate)|graduate diploma|diploma|certificate(?: [ivx]+)?)\.?\s+(?:in\s+|of\s+)?(.{3,})$/i.exec(name);
    return m ? str(m[1]) : "";
  }

  // Which entry an element belongs to: {kind, index, group, section} or null.
  // Workday labels each entry panel "Work-Experience-2-...", "Education-1-...",
  // "Websites-3-..." (aria-labelledby) inside a "...-section" group.
  const KIND_RE = [
    ["work", /^work-?experience/i],
    ["edu", /^education/i],
    ["web", /^web-?sites?|^web-?address/i],
  ];
  const kindOf = (label) => {
    for (const [k, re] of KIND_RE) if (re.test(label)) return k;
    return "";
  };
  function entryOf(el) {
    if (!el || !el.closest) return null;
    for (let n = el.closest('[role="group"][aria-labelledby]'); n; n = n.parentElement && n.parentElement.closest('[role="group"][aria-labelledby]')) {
      const label = n.getAttribute("aria-labelledby") || "";
      if (/-section$/i.test(label)) return null; // in a section but not in an entry
      const kind = kindOf(label);
      if (!kind) continue;
      const section = n.parentElement && n.parentElement.closest('[role="group"][aria-labelledby$="-section"]');
      const all = section ? groupsIn(section, kind) : [n];
      let index = all.indexOf(n);
      if (index < 0) {
        const d = /-(\d+)(?:-|$)/.exec(label);
        index = d ? +d[1] - 1 : 0;
      }
      return { kind, index, group: n, section };
    }
    return null;
  }
  function groupsIn(section, kind) {
    return Array.from(section.querySelectorAll('[role="group"][aria-labelledby]')).filter((x) => {
      const l = x.getAttribute("aria-labelledby") || "";
      if (x === section || /-section$/i.test(l) || kindOf(l) !== kind) return false;
      // Only entries directly in this section (not groups nested inside an entry).
      const up = x.parentElement && x.parentElement.closest('[role="group"][aria-labelledby]');
      return up === section;
    });
  }

  // Should this Work Experience entry have "I currently work here" ticked?
  function isCurrentGroup(profile, group) {
    const at = entryOf(group.querySelector("input, textarea, button") || group);
    const W = jobs(profile);
    if (!at || at.kind !== "work" || !W.length) return true; // no profile to go by: as before
    return at.index < W.length && isCurrent(W[at.index]);
  }

  // The profile field an element stands for, from its id / automation id / label.
  function fieldOf(el, question) {
    const id = [el.id, el.getAttribute && el.getAttribute("data-automation-id"), el.getAttribute && el.getAttribute("name"), el.getAttribute && el.getAttribute("data-fkit-id")]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const q = str(question).toLowerCase();
    const t = id + " | " + q;
    if (/jobtitle|job title/.test(t)) return "title";
    if (/companyname|\bcompany\b/.test(t)) return "company";
    if (/currentlyworkhere|currently work/.test(t)) return "current";
    if (/startdate|start date|\bfrom\b/.test(t)) return "start";
    if (/enddate|end date|\bto\b/.test(t)) return "end";
    if (/roledescription|role description|description/.test(t)) return "description";
    if (/schoolname|school|university|college|institution/.test(t)) return "school";
    if (/fieldofstudy|field of study|major/.test(t)) return "field";
    if (/degree/.test(t)) return "degree";
    if (/gradeaverage|gpa|overall result|grade/.test(t)) return "gpa";
    if (/firstyearattended|first year|from year/.test(t)) return "firstYear";
    if (/lastyearattended|last year|to year|graduat/.test(t)) return "lastYear";
    if (/\burl\b|webaddress|website/.test(t)) return "url";
    if (/location|city/.test(t)) return "location";
    return "";
  }

  function workValue(w, field) {
    if (!w) return null;
    const s = parseDate(w.startDate);
    const e = isCurrent(w) ? null : parseDate(w.endDate);
    const datesOk = !(s && e && (e.y < s.y || (e.y === s.y && e.m && s.m && e.m < s.m)));
    switch (field) {
      case "title":
        return str(w.jobTitle);
      case "company":
        return nameOf(w.company);
      case "location":
        return str(w.workLocation || w.location);
      case "start":
        return mmYYYY(s);
      case "end":
        return datesOk && !isCurrent(w) ? mmYYYY(e) : "";
      case "description":
        return Array.isArray(w.description) ? w.description.map(str).filter(Boolean).join("\n") : str(w.description);
      default:
        return null; // not a field this entry decides
    }
  }
  function eduValue(e, field) {
    if (!e) return null;
    const s = parseDate(e.startDate);
    const en = parseDate(e.endDate);
    switch (field) {
      case "school":
        return nameOf(e.institution);
      case "degree":
        return degreeText(e);
      case "field":
        return fieldOfStudy(e);
      case "gpa":
        return str(e.gpa);
      case "firstYear":
        return s ? String(s.y) : "";
      case "lastYear":
        return en ? String(en.y) : "";
      default:
        return null;
    }
  }

  function clickDelete(group) {
    const b =
      group.querySelector('button[data-automation-id="panel-set-delete-button"]') ||
      Array.from(group.querySelectorAll("button")).find((x) => /^delete$/i.test(str(x.textContent)) || /delete/i.test(x.getAttribute("aria-label") || ""));
    if (b) {
      b.click();
      return true;
    }
    return false;
  }

  /**
   * @param {object} profile  LazyApply profile ({resume_data: {...}})
   * @param {Array}  questions the page's fields with the AI's answers
   *                 ({type, question, element, answer, checkboxOptions, ...})
   * @returns {Array} the questions to fill, with entry fields answered from the profile
   */
  function fix(profile, questions) {
    if (!Array.isArray(questions) || !questions.length) return questions;
    const W = jobs(profile);
    const E = schools(profile);
    const L = links(profile);
    const keep = [];
    const extra = new Set(); // groups to delete
    for (const q of questions) {
      const el = q && (q.element || (q.checkboxOptions && q.checkboxOptions[0]) || (q.radioOptions && q.radioOptions[0]));
      const at = entryOf(el);
      if (!at) {
        keep.push(q);
        continue;
      }
      const field = fieldOf(el, q.question);
      let value = null;
      if (at.kind === "work") {
        if (at.index >= W.length) {
          if (W.length) extra.add(at.group);
          if (!W.length) keep.push(q); // no jobs in the profile: leave the page as it was
          continue;
        }
        if (field === "current") {
          // Ticked only for a job that is current in the profile (set here,
          // not left to the AI answer).
          const box = q.checkboxOptions && q.checkboxOptions[0];
          if (box && !!box.checked !== isCurrent(W[at.index])) {
            try {
              box.click();
            } catch (e) {}
          }
          continue;
        }
        value = workValue(W[at.index], field);
      } else if (at.kind === "edu") {
        if (at.index >= E.length) {
          if (E.length) extra.add(at.group);
          if (!E.length) keep.push(q);
          continue;
        }
        value = eduValue(E[at.index], field);
      } else if (at.kind === "web") {
        if (field === "url" || !field) {
          if (at.index >= L.length) {
            extra.add(at.group);
            continue;
          }
          value = L[at.index];
        }
      }
      if (value === null) {
        keep.push(q); // a field this module does not decide
        continue;
      }
      if (!value) continue; // the profile has nothing for it: left empty, never guessed
      q.answer = value;
      q.__lazyFromProfile = true;
      keep.push(q);
    }
    try {
      if (self.__lazyDbg) self.__lazyDbg.log("field", "info", "Workday My Experience: " + questions.filter((q) => q && q.__lazyFromProfile).length + " fields set from your profile (" + W.length + " jobs, " + E.length + " schools, " + L.length + " links), " + extra.size + " extra entries removed, " + (questions.length - keep.length) + " fields left empty");
    } catch (e) {}
    // Extra entries are removed, last first so the others keep their place.
    Array.from(extra)
      .reverse()
      .forEach((grp) => {
        try {
          clickDelete(grp);
        } catch (e) {}
      });
    return keep;
  }

  g.__lazyWdSections = { fix, isCurrentGroup, parseDate, links, fieldOfStudy, entryOf, fieldOf, mmYYYY };
  if (typeof module !== "undefined" && module.exports) module.exports = g.__lazyWdSections;
})(typeof self !== "undefined" ? self : globalThis);
