// Referral-email variables and the built-in "Referral request" template.
// Loaded before emailAutomationTemplate.bundle.js, which calls __lazyEmail.
// Every value comes from the job, the contact or the user's own profile;
// a variable with no value is left out, never invented.
(function () {
  "use strict";
  if (globalThis.__lazyEmail) return;

  var KEY_ON = "lazyReferralTemplate"; // false turns the built-in template off
  var KEY_PROOF = "lazyReferralProof"; // the user's own "why I fit" sentence
  var KEY_HEADLINE = "lazyReferralHeadline"; // the user's one-line headline, for {{headline}}
  var settings = { on: true, proof: "", headline: "", page: null };
  var seen = { emailOptions: [], templates: {} }; // what the pop-up loaded
  try {
    chrome.storage.local.get([KEY_ON, KEY_PROOF, KEY_HEADLINE, "lazyJobId"], function (r) {
      if (!r) return;
      settings.page = r.lazyJobId && typeof r.lazyJobId === "object" ? r.lazyJobId : null; // read on the job page by atsControls.js
      settings.on = r[KEY_ON] !== false;
      settings.proof = typeof r[KEY_PROOF] === "string" ? r[KEY_PROOF].trim() : "";
      settings.headline = typeof r[KEY_HEADLINE] === "string" ? r[KEY_HEADLINE].trim() : "";
    });
  } catch (e) {}

  var BUILTIN_ID = "lazy-referral";
  var SUBJECT = "My application for {{job_title}}{{job_id_suffix}} at {{company_name}}";
  var BODY = [
    "Dear {{greeting_name}},",
    "",
    "I applied for the {{job_title}} role at {{company_name}} today and wanted to flag it in case it helps to have it on your radar.",
    "",
    "Details to locate my application:",
    "{{reference_block}}",
    "",
    "I submitted my application through the careers page using the email ID: (maxokafordev@gmail.com).",
    "",
    "{{attachment_note}}",
    "",
    "I am {{headline}}, and I would be glad to walk through how that maps to what the team needs. Happy to send anything further that would be useful.",
    "",
    "Kind regards,",
    "",
    "Maxmilliam",
    "+353 874 261 508",
    "Maxokafordev@gmail.com",
    "https://www.linkedin.com/in/maxokafor/",
  ].join("\n");

  function str(v) {
    return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  }
  // "JOHN" / "john" / "o'brien" -> "John" / "O'Brien"; mixed case is kept as written.
  function wordCase(w) {
    if (w !== w.toUpperCase() && w !== w.toLowerCase()) return w;
    return w.toLowerCase().replace(/(^|['\-])([a-zà-þ])/g, function (_, a, b) { return a + b.toUpperCase(); });
  }
  // The first name to greet, or "" when the name is not usable.
  function greetName(name) {
    var parts = str(name).replace(/[(),"]/g, " ").split(" ").filter(Boolean);
    while (parts.length && /^(dr|mr|mrs|ms|miss|mx|prof|sir|dame)\.?$/i.test(parts[0])) parts.shift();
    var f = (parts[0] || "").replace(/\.$/, "");
    if (!f || f.indexOf("@") >= 0 || /\d/.test(f) || f.length < 2 || !/^[A-Za-zÀ-ɏ'\-]+$/.test(f)) return "";
    return wordCase(f);
  }
  // A shouted title ("SENIOR DATA ANALYST") is put in title case; short
  // all-caps words (SRE, AI, II) stay as they are.
  function titleCase(t) {
    t = str(t);
    if (!t || t !== t.toUpperCase() || !/[A-Z]{4,}/.test(t)) return t;
    return t.split(" ").map(function (w) { return w.length <= 3 && !/^(AND|THE|FOR|OF)$/.test(w) ? w : wordCase(w); })
      .join(" ").replace(/\b(And|The|For|Of)\b/g, function (m, x, i) { return i ? m.toLowerCase() : m; });
  }
  // The headline reads after "I am ": lower-case start, an article, no final full stop.
  function headlineText(h) {
    h = str(h).replace(/^(i am|i'm)\s+/i, "").replace(/[.;,!]+$/, "");
    if (!h) return "";
    if (!/^[A-Z]{2}/.test(h)) h = h.charAt(0).toLowerCase() + h.slice(1);
    if (!/^(a|an|the|someone|somebody|my|one|currently|now)\b/i.test(h)) h = (/^[aeiou]/i.test(h) && !/^(uni|use|eu|one)/i.test(h) ? "an " : "a ") + h;
    return h;
  }
  // Last check before anything is sent: returns what is wrong, or "".
  function lint(subject, body, v) {
    v = v || {};
    if (!str(v.job_title)) return "the job title is unknown";
    if (!str(v.company_name)) return "the company name is unknown";
    var all = subject + "\n" + body;
    if (/\{\{|\}\}/.test(all)) return "a template variable was left unfilled";
    if (/\[(Company Name|Recipient Name|Job Title|Your Name|Your name|Role)\]/.test(all)) return "a [placeholder] was left unfilled";
    var lines = all.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (/\S {2,}\S/.test(lines[i])) return "a double space in \"" + lines[i].slice(0, 60) + "\"";
      if (/\s[,.;:!?](\s|$)/.test(lines[i])) return "a space before punctuation in \"" + lines[i].slice(0, 60) + "\"";
      if (/[.,]{2,}|,\./.test(lines[i].replace(/\.\.\./g, "").replace(/https?:\/\/\S+/g, ""))) return "doubled punctuation in \"" + lines[i].slice(0, 60) + "\"";
      if (/\b(the|for|at|a|an)\s+(role|at|today)\b/i.test(lines[i]) && /for at|the role|at today|for \(/i.test(lines[i])) return "a missing word in \"" + lines[i].slice(0, 60) + "\"";
    }
    if (/^Dear ,|^Hi ,/m.test(body)) return "an empty greeting";
    return "";
  }
  function pick(obj, names) {
    if (!obj) return "";
    for (var i = 0; i < names.length; i++) {
      var v = str(obj[names[i]]);
      if (v) return v;
    }
    return "";
  }

  // A job ID is used only when the link entry carries one or the URL shows it
  // in a recognised place. Anything less certain gives no ID.
  var BOARDS = /(^|\.)(linkedin|indeed|glassdoor|ziprecruiter|dice|simplyhired|careerbuilder|wellfound|monster|foundit|seek)\./i;
  function hostOf(u) {
    var m = String(u || "").match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1] : "";
  }
  function cleanId(v) {
    v = str(v);
    if (!v || v.length > 30 || /^no_?jobid$/i.test(v) || v === "unknown" || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v)) return "";
    return v;
  }
  // The employer's job ID where the link shows it in a recognised place.
  function urlJobId(url) {
    var u = str(url), m;
    if (!u || BOARDS.test(hostOf(u))) return "";
    var path = u.split(/[?#]/)[0];
    if ((m = u.match(/[?&](?:gh_jid|jobId|job_id|jid|reqId|req_id|requisitionId|jobReqId|career_job_req_id|jobreq|job)=([A-Za-z0-9_-]{2,30})(?:&|#|$)/i)) && /\d/.test(m[1])) return cleanId(m[1]);
    if (/myworkdayjobs\.com/i.test(u) && (m = path.match(/_((?:[A-Z]{1,6}-?)?\d{3,}(?:-\d+)?)(?:\/.*)?$/))) return m[1];
    if (/icims\.com/i.test(u) && (m = path.match(/\/jobs\/(\d{2,})(?:\/|$)/))) return m[1];
    if (/greenhouse\.io/i.test(u) && (m = path.match(/\/jobs\/(\d{4,})/))) return m[1];
    if (/smartrecruiters\.com/i.test(u) && (m = path.match(/\/(\d{9,})(?:-|\/|$)/))) return m[1];
    if (/bamboohr\.com/i.test(u) && (m = path.match(/\/(?:careers|jobs)\/(\d{1,8})(?:\/|$)/))) return m[1];
    if (/oraclecloud\.com/i.test(u) && (m = path.match(/\/job\/(\d{2,})(?:\/|$)/))) return m[1];
    if (/successfactors\.|jobs2web\./i.test(u) && (m = path.match(/\/(\d{5,})\/?$/))) return m[1];
    if (/workable\.com/i.test(u) && (m = path.match(/\/j\/([A-Z0-9]{8,12})(?:\/|$)/))) return m[1];
    if (/jobvite\.com/i.test(u) && (m = path.match(/\/job\/(o[A-Za-z0-9]{6,12})(?:\/|$)/))) return m[1];
    return "";
  }

  // Order of trust: what the job page itself labelled as the ID, then the
  // address of the page applied on, then the queued link, and last the ID
  // LazyApply stored, unless that came from a job board (a LinkedIn or Indeed
  // number means nothing to someone inside the company).
  function jobIdFrom(link, url, page) {
    page = page || {};
    var stored = cleanId(pick(link, ["jobId", "job_id", "requisitionId", "reqId"]));
    var linkUrl = str(url) || pick(link, ["url", "link", "jobLink"]);
    return cleanId(page.pageId) || urlJobId(page.firstUrl) || urlJobId(page.url) || urlJobId(linkUrl) ||
      (stored && !BOARDS.test(hostOf(linkUrl)) ? stored : "");
  }

  function whereSuffix(place, team) {
    var both = [place, team].filter(Boolean).join(", ");
    if (!both) return "";
    return " (" + (both.length <= 60 ? both : place || team) + ")";
  }

  function currentLink(state) {
    try {
      return (state && state.links && state.links[state.currentIndex]) || null;
    } catch (e) {
      return null;
    }
  }

  function values(ctx) {
    ctx = ctx || {};
    var job = ctx.job || {}, rec = ctx.recipient || {}, resume = ctx.resume || {};
    var pi = resume.personalInformation || {}, misc = resume.miscellaneous || {};
    var link = currentLink(ctx.state) || {};
    var url = pick(job, ["url", "link"]) || pick(link, ["url", "link", "jobLink"]);
    // The page reading counts only if it was taken for this same job, recently.
    var page = settings.page;
    var idx = ctx.state && typeof ctx.state.currentIndex === "number" ? ctx.state.currentIndex : -1;
    if (!page || page.index !== idx || Date.now() - page.at > 3 * 3600e3) page = null;
    var jobId = jobIdFrom(link, url, page);
    var jobPlace = pick(link, ["location", "jobLocation"]) || str(page && page.location);
    var jobTeam = str(page && page.team);
    var first = str(pi.firstName), last = str(pi.lastName);
    var recName = str(rec.name);
    var recFirst = greetName(recName);
    var jobTitle = titleCase(pick(job, ["title"]) || pick(link, ["title"]));
    var company = titleCase(pick(job, ["company"]) || pick(link, ["companyName"]));
    var myEmail = senderEmail(seen.emailOptions, ctx.emailId) || pick(pi, ["email", "emailAddress"]);
    return {
      recipient_first_name: recFirst || "Hiring Manager",
      greeting_name: recFirst || "Hiring Manager",
      // The lines that let the reader find this application.
      reference_block: [
        jobId ? "Job ID: " + jobId : "",
        jobTitle ? "Role: " + jobTitle : "",
        jobPlace ? "Location: " + jobPlace : "",
        jobTeam ? "Team: " + jobTeam : "",
        url ? "Job posting: " + url : "",
        "Applied on: " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      ].filter(Boolean).join("\n"),
      recipient_name: recName || "Hiring Manager",
      recipient_role: str(rec.role),
      job_title: jobTitle,
      company_name: company,
      job_url: url,
      job_id: jobId,
      // With no job ID, the place and team say which posting is meant.
      job_id_suffix: jobId ? " (Job ID " + jobId + ")" : whereSuffix(jobPlace, jobTeam),
      job_location: jobPlace,
      job_team: jobTeam,
      proof_line: settings.proof,
      attachment_note: attachFor(ctx) ? "I have attached my CV in case it helps." : "",
      my_first_name: first,
      my_name: (first + " " + last).trim(),
      my_phone: pick(pi, ["phoneNumber", "phone", "mobile"]),
      my_email: myEmail,
      my_linkedin: pick(misc, ["linkedinUrl", "linkedin"]) || pick(pi, ["linkedinUrl", "linkedin"]),
      // Only a headline you wrote: a bare resume title ("Software Engineer") reads badly here.
      headline: headlineText(settings.headline || pick(resume, ["headline"]) || pick(pi, ["headline"])),
      today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    };
  }

  // Whether the CV really goes with this email: the template's own setting
  // when it has one, else the pop-up's current state.
  function attachFor(ctx) {
    try {
      for (var id in seen.templates) {
        var t = seen.templates[id];
        if (t && (t.content === ctx.text || t.subject === ctx.text) && t.attachResume !== undefined) return !!t.attachResume;
      }
    } catch (e) {}
    return !!ctx.attach;
  }

  // The dashboard's older [Bracket] names keep working.
  var LEGACY = {
    "Company Name": "company_name",
    "Recipient Name": "recipient_name",
    "Job Title": "job_title",
    Role: "recipient_role",
    "Your Name": "my_name",
    "Your name": "my_name",
  };

  // preset: values to use instead of reading them from ctx (the dashboard preview).
  // mark: wraps each filled-in value, so a preview can highlight it.
  function fill(text, ctx, preset, mark) {
    if (typeof text !== "string" || !text) return text || "";
    ctx = ctx || {};
    ctx.text = text;
    var v = preset || values(ctx);
    var show = function (val, name) { return val ? (mark ? mark(val, name) : val) : ""; };
    // No headline saved: reword the sentence instead of leaving "I am , and".
    if (!v.headline) text = text.replace(/I am\s*\{\{\s*headline\s*\}\},?\s*and I would be glad to walk through how that maps/gi, "I would be glad to walk through how my background maps").replace(/I am\s*\{\{\s*headline\s*\}\},?\s*and\s+/gi, "");
    var out = [];
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var hadEmpty = false;
      var line = lines[i].replace(/\{\{\s*([A-Za-z_]+)\s*\}\}/g, function (_, name) {
        var val = v[name.toLowerCase()];
        if (!val) hadEmpty = true;
        return show(val, name.toLowerCase());
      });
      line = line.replace(/\[(Company Name|Recipient Name|Job Title|Role|Your Name|Your name)\]/g, function (_, name) {
        return show(v[LEGACY[name]], LEGACY[name]);
      });
      if (hadEmpty) {
        line = line.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
        // A line left blank, or left as a bare label ("Link:"), is dropped.
        if (!line || /:$/.test(line)) {
          if (out.length && out[out.length - 1] === "" && lines[i + 1] === "") i++;
          continue;
        }
      }
      out.push(line);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  }

  // Adds the built-in template to what the pop-up loaded and selects it.
  // The dashboard's own template stays in the list and is what the server is
  // told was chosen (__lazyBase), so its attach-CV setting still applies.
  function addBuiltin(stored) {
    try {
      if (!stored) return;
      if (Array.isArray(stored.emailOptions)) seen.emailOptions = stored.emailOptions;
      if (stored.emailTemplates) seen.templates = stored.emailTemplates;
      if (!settings.on) return;
      var options = stored.templateOptions, map = stored.emailTemplates;
      if (!Array.isArray(options) || !map || map[BUILTIN_ID]) return;
      var chosen = null;
      for (var i = 0; i < options.length; i++) if (options[i] && options[i].selected) chosen = options[i];
      var base = (chosen && map[chosen.id]) || null;
      var tpl = { id: BUILTIN_ID, name: "Referral request", label: "Referral request", subject: SUBJECT, content: BODY };
      if (base && base.attachResume !== undefined) tpl.attachResume = base.attachResume;
      if (base) tpl.__lazyBase = base;
      for (var j = 0; j < options.length; j++) if (options[j]) options[j].selected = false;
      options.unshift({ id: BUILTIN_ID, name: tpl.name, label: tpl.label, selected: true });
      map[BUILTIN_ID] = tpl;
    } catch (e) {}
  }

  function senderEmail(emailOptions, id) {
    try {
      for (var i = 0; i < emailOptions.length; i++) {
        var o = emailOptions[i];
        if (o && o.id === id) {
          var e = pick(o, ["email", "label", "name"]);
          return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : "";
        }
      }
    } catch (e) {}
    return "";
  }

  // ---- Choosing who to email -------------------------------------------
  // The server returns a list of people at the company. The pop-up emails the
  // first two, so the list is re-ordered here: the likely hiring manager for
  // this role first, then the recruiter who covers it. Location and how close
  // the person's title is to the job break ties. Nothing is added to the list.
  var FUNCTIONS = {
    engineering: /\b(engineer\w*|developer|software|devops|sre|platform|backend|back-end|frontend|front-end|full ?stack|qa|quality assurance|architect|infrastructure|cloud|programmer|technical|technology|tech|it)\b/,
    data: /\b(data|analyst|analytics|scientist|bi|business intelligence|machine learning|ml|ai|insights?|reporting|quantitative|statistic\w*)\b/,
    product: /\b(product|program manager|project manager|scrum|delivery)\b/,
    design: /\b(design\w*|ux|ui|creative|research(er)?)\b/,
    marketing: /\b(marketing|brand|content|seo|growth|communications?|social media|pr)\b/,
    sales: /\b(sales|account executive|account manager|business development|bdr|sdr|partnerships?|revenue)\b/,
    finance: /\b(financ\w*|account(ing|ant)|risk|audit\w*|treasury|tax|credit|controller|fp&a|compliance|actuar\w*|underwrit\w*)\b/,
    people: /\b(hr|human resources|people|talent|recruit\w*|learning)\b/,
    operations: /\b(operations?|supply chain|logistics|procurement|facilities)\b/,
    support: /\b(support|customer success|customer service|customer experience|helpdesk|service desk)\b/,
    legal: /\b(legal|counsel|lawyer|paralegal|solicitor)\b/,
    security: /\b(security|infosec|cyber\w*)\b/,
  };
  var RECRUITER = /\b(recruit\w*|talent|sourc(er|ing)|people partner|hr business partner|human resources|hr (manager|generalist|advisor|specialist))\b/;
  var LEAD = /\b(manager|lead|head|supervisor|team leader)\b/;
  var DIRECTOR = /\b(director|principal)\b/;
  var VP = /\b(vp|svp|evp|vice president)\b/;
  var CHIEF = /\b(chief|ceo|cto|cfo|coo|cio|cmo|founder|co-founder|president|owner|partner)\b/;
  var EARLY = /\b(intern\w*|graduate|grad|junior|entry|trainee|apprentice|campus|university|early careers?)\b/;
  var SENIOR_JOB = /\b(director|head|vp|vice president|chief|principal)\b/;
  var STOP = /^(and|of|the|for|in|at|to|a|an|senior|sr|junior|jr|lead|principal|staff|associate|assistant|manager|head|director|i|ii|iii|iv|\d+)$/;

  function low(v) {
    return str(v).toLowerCase().replace(/[^a-z0-9&+ -]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function functionsOf(title) {
    var found = [];
    for (var k in FUNCTIONS) if (FUNCTIONS[k].test(title)) found.push(k);
    return found;
  }
  function words(title) {
    return title.split(/[ -]+/).filter(function (w) { return w && !STOP.test(w); });
  }
  function overlap(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i++) if (b.indexOf(a[i]) >= 0) n++;
    return n;
  }
  function placeWords(v) {
    return low(v).split(/[ ,-]+/).filter(function (w) { return w.length > 2 && !/^(remote|hybrid|onsite|office|area|greater|city|county|the)$/.test(w); });
  }

  function scoreProfile(p, job) {
    var title = low(p.role || p.title);
    var isRecruiter = RECRUITER.test(title);
    var fns = functionsOf(title).filter(function (f) { return !(isRecruiter && f === "people"); });
    var jobIsPeople = job.fns.indexOf("people") >= 0;
    var sameFn = overlap(job.fns, fns) > 0;
    var score, kind;

    if (isRecruiter && !jobIsPeople) {
      kind = "recruiter";
      score = 60;
      if (sameFn) score += 15; // "Technical Recruiter" for an engineering role
      if (EARLY.test(title)) score += EARLY.test(job.title) ? 10 : -25;
      if (/\bexecutive\b/.test(title) && !SENIOR_JOB.test(job.title)) score -= 20;
      if (/\b(coordinator|assistant|admin\w*)\b/.test(title)) score -= 10;
    } else {
      kind = "team";
      var level = CHIEF.test(title) ? "chief" : VP.test(title) ? "vp" : DIRECTOR.test(title) ? "director" : LEAD.test(title) ? "lead" : "peer";
      if (sameFn) score = { lead: 80, director: 70, vp: 50, chief: 30, peer: 45 }[level];
      else if (!fns.length) score = { lead: 25, director: 25, vp: 20, chief: 20, peer: 10 }[level];
      else score = { lead: 15, director: 15, vp: 12, chief: 20, peer: 5 }[level];
      // A senior opening is more likely to report to a director or VP.
      if (sameFn && SENIOR_JOB.test(job.title) && (level === "director" || level === "vp")) score += 15;
    }

    score += Math.min(15, 5 * overlap(job.words, words(title)));
    var place = placeWords(p.location);
    if (place.length && job.place.length) score += overlap(job.place, place) > 0 ? 15 : -5;
    return { score: score, kind: kind };
  }

  function rank(profiles, jobDetails, state) {
    try {
      if (!Array.isArray(profiles) || profiles.length < 2) return profiles || [];
      var link = currentLink(state) || {};
      var jt = low(pick(jobDetails, ["title"]) || pick(link, ["title"]));
      var job = { title: jt, fns: functionsOf(jt), words: words(jt), place: placeWords(pick(link, ["location", "jobLocation"])) };
      var seen = {}, list = [];
      for (var i = 0; i < profiles.length; i++) {
        var p = profiles[i];
        var email = p && str(p.email).toLowerCase();
        if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || seen[email]) continue; // nothing to send to, or a repeat
        seen[email] = true;
        var s = scoreProfile(p, job);
        list.push({ p: p, score: s.score, kind: s.kind, at: i });
      }
      list.sort(function (a, b) { return b.score - a.score || a.at - b.at; });
      // Second contact: the best person of the other kind, when they are a
      // reasonable match, so one email reaches the team and one the recruiter.
      if (list.length > 2) {
        for (var j = 1; j < list.length; j++) {
          if (list[j].kind !== list[0].kind && list[j].score >= 40) {
            list.splice(1, 0, list.splice(j, 1)[0]);
            break;
          }
        }
      }
      return list.map(function (x) {
        var copy = {};
        for (var k in x.p) if (k !== "location") copy[k] = x.p[k]; // used for ranking only
        return copy;
      });
    } catch (e) {
      return profiles || [];
    }
  }

  // Referral log. Pages send their lines to the background worker, which is
  // the only writer, so lines arriving close together are all kept.
  var inWorker = typeof ServiceWorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof ServiceWorkerGlobalScope;
  var chain = Promise.resolve();
  function append(entry) {
    chain = chain.then(function () {
      return chrome.storage.local.get("lazyEmailLog").then(function (r) {
        var list = Array.isArray(r && r.lazyEmailLog) ? r.lazyEmailLog : [];
        list.push(Object.assign({ at: Date.now() }, entry));
        return chrome.storage.local.set({ lazyEmailLog: list.slice(-80) });
      });
    }).catch(function () {});
    return chain;
  }
  if (inWorker) {
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
      if (!request || request.type !== "LAZY_EMAIL_LOG" || !request.entry) return;
      if (sender && sender.id && sender.id !== chrome.runtime.id) return;
      append(request.entry).then(function () { sendResponse({ ok: true }); });
      return true;
    });
  }
  function logLine(entry) {
    try {
      if (inWorker) return void append(entry);
      chrome.runtime.sendMessage({ type: "LAZY_EMAIL_LOG", entry: entry }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }
  // One line for each email the pop-up sends.
  function logSend(recipient, job, ok) {
    logLine({
      kind: "email", status: ok ? "sent" : "send_failed",
      company: str(job && job.company), title: str(job && job.title),
      text: (ok ? "Sent to " : "Could not send to ") + str(recipient && recipient.name) +
        (recipient && recipient.role ? " (" + str(recipient.role) + ")" : "") + (recipient && recipient.email ? ", " + str(recipient.email) : ""),
    });
  }
  // Re-reads the saved settings (the background worker lives longer than one job).
  function reload() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([KEY_ON, KEY_PROOF, KEY_HEADLINE, "lazyJobId"], function (r) {
          r = r || {};
          settings.on = r[KEY_ON] !== false;
          settings.proof = typeof r[KEY_PROOF] === "string" ? r[KEY_PROOF].trim() : "";
          settings.headline = typeof r[KEY_HEADLINE] === "string" ? r[KEY_HEADLINE].trim() : "";
          settings.page = r.lazyJobId && typeof r.lazyJobId === "object" ? r.lazyJobId : null;
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  globalThis.__lazyEmail = {
    logSend: logSend,
    logLine: logLine,
    reload: reload,
    rank: rank,
    fill: fill,
    values: values,
    lint: lint,
    addBuiltin: addBuiltin,
    senderEmail: senderEmail,
    jobIdFrom: jobIdFrom,
    urlJobId: urlJobId,
    settings: settings,
    BUILTIN_ID: BUILTIN_ID,
    SUBJECT: SUBJECT,
    BODY: BODY,
    version: 1,
  };
})();
