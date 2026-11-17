// Adds the extension's email variables to LazyApply's template editor
// (Profile > Email Settings > Edit Template): buttons that insert each
// variable at the cursor, and a preview that fills them in the same way the
// referral pop-up does when it sends. It only adds its own elements and hides
// the site's preview; it never saves anything.
(function () {
  "use strict";
  if (window.__lazyDashVars) return;
  window.__lazyDashVars = true;

  var VARS = [
    ["greeting_name", "Greeting name"],
    ["recipient_first_name", "Recipient first name"],
    ["job_title", "Job title"],
    ["job_id_suffix", "Job ID (or place and team)"],
    ["company_name", "Company"],
    ["job_url", "Job link"],
    ["reference_block", "Application details"],
    ["job_location", "Job location"],
    ["job_team", "Job team"],
    ["proof_line", "Why I fit"],
    ["attachment_note", "CV attached note"],
    ["my_first_name", "My first name"],
    ["my_name", "My full name"],
    ["my_phone", "My phone"],
    ["my_email", "My email"],
    ["my_linkedin", "My LinkedIn"],
    ["headline", "My headline"],
    ["today", "Today's date"],
  ];
  var CSS =
    // Sizes and shapes copy the site's own variable chips; the site's classes are
    // reused for the preview boxes (see render), so these are mostly fallbacks.
    ".lz-vars{margin:16px 0 4px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}" +
    ".lz-vars .lz-vars-title{flex-basis:100%;font-size:14px;line-height:21px;margin:0 0 4px}" +
    ".lz-vars .lz-var{appearance:none;font:400 14px/21px Roboto,Helvetica,Arial,sans-serif;color:rgb(64,156,255);background:rgba(64,156,255,.063);border:1px solid rgb(64,156,255);border-radius:20px;padding:8px 16px;margin:0;cursor:pointer;transition:background .15s}" +
    ".lz-vars .lz-var:hover{background:rgba(64,156,255,.18)}" +
    ".lz-vars .lz-var:focus-visible{outline:2px solid rgb(64,156,255);outline-offset:2px}" +
    ".lz-prev .lz-prev-subject,.lz-prev .lz-prev-body{white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".lz-prev-box{background:rgba(127,127,127,.12);border-radius:8px;padding:8px 16px;font:400 16px/28.8px Roboto,Helvetica,Arial,sans-serif;margin:0 0 8px}" +
    ".lz-prev-box.lz-prev-body{max-height:300px;overflow:auto}" +
    ".lz-prev .lz-val{display:inline-block;font-size:14px;line-height:21px;padding:1px 8px;margin:0 2px;border-radius:12px;border:1px solid rgb(64,156,255);color:rgb(64,156,255);background:rgba(64,156,255,.063);white-space:normal;overflow-wrap:anywhere;vertical-align:baseline}" +
    ".lz-prev .lz-val.lz-site{border-color:rgb(80,184,60);color:rgb(80,184,60);background:rgba(80,184,60,.063)}" +
    ".lz-prev .lz-val.lz-long{display:inline;border:0;background:none;padding:0;margin:0;font-size:inherit;line-height:inherit}" + // a sentence reads better as coloured text than as a pill
    ".lz-prev .lz-prev-body{max-height:340px;overflow-y:auto}" +
    ".lz-prev .lz-prev-note{margin-top:8px}" +
    ".lz-prev-note.lz-plain{font:italic 13px Roboto,Helvetica,Arial,sans-serif;opacity:.7}";

  var settings = { proof: "", headline: "" };
  function loadSettings() {
    try {
      chrome.storage.local.get(["lazyReferralProof", "lazyReferralHeadline"], function (r) {
        settings.proof = r && typeof r.lazyReferralProof === "string" ? r.lazyReferralProof.trim() : "";
        settings.headline = r && typeof r.lazyReferralHeadline === "string" ? r.lazyReferralHeadline.trim() : "";
        render();
      });
    } catch (e) {}
  }

  function byText(tag, text) {
    var list = document.querySelectorAll(tag);
    for (var i = 0; i < list.length; i++) if (list[i].textContent.trim() === text) return list[i];
    return null;
  }
  function labelledInput(text) {
    var labels = document.querySelectorAll("label");
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].textContent.trim() === text && labels[i].htmlFor) {
        var el = document.getElementById(labels[i].htmlFor);
        if (el && el.tagName === "INPUT") return el;
      }
    }
    return null;
  }
  function parts() {
    var contentTitle = byText("p", "Template Content"), previewTitle = byText("p", "Email Preview");
    if (!contentTitle || !previewTitle) return null;
    var content = contentTitle.parentElement, preview = previewTitle.parentElement;
    var subject = content.querySelector('input[placeholder="Enter email subject"]');
    var body = null, areas = content.querySelectorAll("textarea");
    for (var i = 0; i < areas.length; i++) if (!areas[i].readOnly && areas[i].getAttribute("aria-hidden") !== "true") body = areas[i];
    if (!subject || !body) return null;
    var attach = null, labels = content.querySelectorAll("label");
    for (var j = 0; j < labels.length; j++) if (/Attach Resume/.test(labels[j].textContent)) attach = labels[j].querySelector('input[type="checkbox"]');
    return { content: content, preview: preview, previewTitle: previewTitle, subject: subject, body: body, attach: attach };
  }

  // Types into a field the way a person would, so the site's own editor sees it.
  function insertAtCursor(el, text) {
    var start = el.selectionStart == null ? el.value.length : el.selectionStart;
    var end = el.selectionEnd == null ? start : el.selectionEnd;
    var next = el.value.slice(0, start) + text + el.value.slice(end);
    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    try { el.setSelectionRange(start + text.length, start + text.length); } catch (e) {}
  }

  var lastField = null;
  document.addEventListener("focusin", function (e) {
    var p = parts();
    if (p && (e.target === p.subject || e.target === p.body)) lastField = e.target;
  }, true);

  function sampleValues(p) {
    var company = labelledInput("Company Name"), recipient = labelledInput("Recipient Name");
    var name = (recipient && recipient.value.trim()) || "John Smith";
    return {
      recipient_first_name: name.split(/\s+/)[0],
      greeting_name: name.split(/\s+/)[0],
      reference_block: "Job ID: 8129702\nRole: Data Analyst\nLocation: Dublin, Ireland\nJob posting: https://careers.example.com/jobs/8129702\nApplied on: " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
      recipient_name: name,
      recipient_role: "Engineering Manager",
      job_title: "Data Analyst",
      company_name: (company && company.value.trim()) || "Google",
      job_url: "https://careers.example.com/jobs/8129702",
      job_id: "8129702",
      job_id_suffix: " (Job ID 8129702)",
      job_location: "Dublin, Ireland",
      job_team: "Data & Analytics",
      proof_line: settings.proof,
      attachment_note: p.attach && !p.attach.checked ? "" : "I have attached my CV in case it helps.",
      my_first_name: "your first name",
      my_name: "your full name",
      my_phone: "your phone",
      my_email: "your email",
      my_linkedin: "your LinkedIn link",
      headline: settings.headline || "your headline",
      today: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    };
  }

  var SITE = { company_name: 1, recipient_name: 1 };
  function paint(box, text, values) {
    var filled = window.__lazyEmail.fill(text, null, values, function (value, name) {
      return "\u0001" + name + "\u0003" + value + "\u0002";
    });
    box.textContent = "";
    filled.split(/(\u0001[^\u0002]*\u0002)/).forEach(function (piece) {
      if (!piece) return;
      if (piece.charAt(0) === "\u0001") {
        var cut = piece.indexOf("\u0003");
        var span = document.createElement("span");
        var name = piece.slice(1, cut);
        var shown = piece.slice(cut + 1, -1);
        span.className = "lz-val" + (SITE[name] ? " lz-site" : "") + (shown.length > 45 ? " lz-long" : "");
        span.title = name;
        span.textContent = shown;
        box.appendChild(span);
      } else box.appendChild(document.createTextNode(piece));
    });
  }

  function render() {
    var p = parts();
    if (!p || !window.__lazyEmail) return;
    if (!document.getElementById("lz-vars-style")) {
      var st = document.createElement("style");
      st.id = "lz-vars-style";
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    // Variable buttons, placed under the site's own two.
    if (!document.querySelector(".lz-vars")) {
      var row = document.createElement("div");
      row.className = "lz-vars";
      var title = document.createElement("p");
      var hintForStyle = null, allP = document.querySelectorAll("p");
      for (var h = 0; h < allP.length; h++) if (/^Click on any variable below/.test(allP[h].textContent.trim())) hintForStyle = allP[h];
      title.className = ((hintForStyle && hintForStyle.className) || "") + " lz-vars-title"; // same grey text as the site's hint
      title.textContent = "More variables from the LazyApply extension (filled in when the email is sent):";
      row.appendChild(title);
      VARS.forEach(function (v) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "lz-var";
        b.textContent = v[1];
        b.title = "{{" + v[0] + "}}";
        b.addEventListener("mousedown", function (e) { e.preventDefault(); }); // keep the cursor where it is
        b.addEventListener("click", function () {
          var now = parts();
          if (!now) return;
          var target = lastField && document.contains(lastField) ? lastField : now.body;
          insertAtCursor(target, "{{" + v[0] + "}}");
        });
        row.appendChild(b);
      });
      var hint = byText("p", "Click on any variable below to insert it at cursor position. Use backspace to remove a variable. Variables will be replaced with their values in the preview.");
      if (!hint) {
        var ps = document.querySelectorAll("p");
        for (var i = 0; i < ps.length; i++) if (/^Click on any variable below/.test(ps[i].textContent.trim())) hint = ps[i];
      }
      var after = hint && hint.nextElementSibling ? hint.nextElementSibling : null;
      if (after && after.parentElement) after.parentElement.insertBefore(row, after.nextSibling);
      else p.content.parentElement.parentElement.insertBefore(row, p.content.parentElement);
    }

    // Our preview takes the place of the site's, which cannot fill these variables.
    var mine = p.preview.querySelector(".lz-prev");
    if (!mine) {
      // Built from the site's own preview elements (their classes), so it looks
      // the same in any theme. Plain fallbacks are used where one is missing.
      var site = [];
      for (var s = 0; s < p.preview.children.length; s++) if (p.preview.children[s] !== p.previewTitle) site.push(p.preview.children[s]);
      var sSubj = site[0], sBody = site[1], sNote = site[2];
      var cls = function (el, fallback) { return el && el.className ? String(el.className) : fallback; };
      var make = function (tag, className, parent) { var el = document.createElement(tag); el.className = className; parent.appendChild(el); return el; };
      mine = document.createElement("div");
      mine.className = "lz-prev";
      var subjWrap = make("div", cls(sSubj, ""), mine);
      make("p", cls(sSubj && sSubj.children[0], "lz-prev-label"), subjWrap).textContent = "Subject:";
      make("p", cls(sSubj && sSubj.children[1], "lz-prev-box") + " lz-prev-subject", subjWrap);
      var sBodyText = sBody && sBody.querySelector("p");
      if (sBodyText && sBodyText.parentElement === sBody) {
        make("p", cls(sBodyText, "") + " lz-prev-body", make("div", cls(sBody, ""), mine));
      } else make("p", "lz-prev-box lz-prev-body", mine);
      make("p", sNote && sNote.className ? sNote.className + " lz-prev-note" : "lz-prev-note lz-plain", mine);
      p.previewTitle.insertAdjacentElement("afterend", mine);
    }
    for (var k = 0; k < p.preview.children.length; k++) {
      var child = p.preview.children[k];
      if (child !== p.previewTitle && child !== mine && child.style.display !== "none") child.style.display = "none";
    }
    var values = sampleValues(p);
    paint(mine.querySelector(".lz-prev-subject"), p.subject.value, values);
    paint(mine.querySelector(".lz-prev-body"), p.body.value, values);
    var notes = [values.attachment_note ? "Your CV will be attached to this email." : "No CV attached."];
    notes.push("Sample values shown. The extension fills the real job, contact and profile details when it sends.");
    if (/\{\{\s*proof_line\s*\}\}/.test(p.subject.value + p.body.value) && !settings.proof)
      notes.push('"Why I fit" is empty, so that line is left out. Set it on the extension\'s options page.');
    mine.querySelector(".lz-prev-note").textContent = notes.join(" ");
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    setTimeout(function () { queued = false; try { render(); } catch (e) {} }, 120);
  }
  document.addEventListener("input", schedule, true);
  document.addEventListener("change", schedule, true);
  document.addEventListener("click", schedule, true);
  new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i].target;
      if (t && t.nodeType === 1 && t.closest && t.closest(".lz-prev,.lz-vars")) continue; // our own changes
      return schedule();
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  try { chrome.storage.onChanged.addListener(function (c) { if (c.lazyReferralProof || c.lazyReferralHeadline) loadSettings(); }); } catch (e) {}
  loadSettings();
  schedule();
})();
