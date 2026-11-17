/*
 * Dashboard additions:
 *  - "250", "500", "700" and "1000 jobs" in the "Target N jobs" list, which is
 *    hard-coded to 50 / 100;
 *  - hour and minute choices in "Date Posted" (past 15 min ... past 12 hours).
 *
 * Runs in the page's own JavaScript world before the dashboard starts. It
 * holds back the dashboard's main script, fetches the same file, adds the two
 * options, and runs that copy instead.
 *
 * What it does NOT touch: the check of applications used against the
 * account's allowance, and the rule that greys out targets above 50 on
 * accounts with a small daily allowance (the new options obey the same rule).
 *
 * If anything is not exactly as expected (file not found, the list not where
 * it should be) the original script is loaded unchanged, so the dashboard
 * never breaks because of this file.
 */
(function () {
  "use strict";
  if (window.__lazyApplyDashTargets) return;
  window.__lazyApplyDashTargets = true;

  const MAIN_RE = /\/static\/js\/main\.[0-9a-f]+\.js(\?.*)?$/i;
  const EXTRA_TARGETS = [250, 500, 700, 1000];

  // [{...50 jobs...},{value:"100 jobs",label:"100 jobs",count:100,disabled:X}]
  const LIST_RE = /(\{value:"100 jobs",label:"100 jobs",count:100,disabled:([A-Za-z_$][\w$]*)\})\]/;
  // "Load more" stops at 300 jobs on screen.
  const MORE_RE = /([A-Za-z_$][\w$]*\.length>=)300(\)[A-Za-z_$][\w$]*\(!0\))/;

  // Date Posted: hour and minute windows, for applying while a job is new.
  const TIME_OPTIONS = [
    ["Past 5 minutes", "qdr:n5"],
    ["Past 10 minutes", "qdr:n10"],
    ["Past 15 minutes", "qdr:n15"],
    ["Past 20 minutes", "qdr:n20"],
    ["Past 30 minutes", "qdr:n30"],
    ["Past 45 minutes", "qdr:n45"],
    ["Past hour", "qdr:h1"],
    ["Past 3 hours", "qdr:h3"],
    ["Past 6 hours", "qdr:h6"],
    ["Past 12 hours", "qdr:h12"],
  ];
  const TIME_LIST = '{label:"Any time",value:"all"},{label:"Past 24 hours",value:"qdr:d"}';
  const TIME_NAMES = '{"qdr:d":"past 24 hours",';

  // Search bar: how many job titles can be added (the dashboard allows 3).
  const MAX_TITLES = 300;
  const TITLE_PLACEHOLDER = 'placeholder:"Enter job title (e.g., Software Engineer )"';

  // Each change is applied only if the code is exactly where it is expected;
  // returns null when nothing could be applied.
  function patch(code) {
    let out = code;
    let applied = 0;

    const m = LIST_RE.exec(out);
    if (m && out.split("count:100,disabled:").length === 2) {
      const extra = EXTRA_TARGETS.map(
        (n) => `,{value:"${n} jobs",label:"${n} jobs",count:${n},disabled:${m[2]}}`
      ).join("");
      out = out.replace(LIST_RE, `$1${extra}]`).replace(MORE_RE, "$12000$2");
      applied++;
    }

    if (out.split(TIME_LIST).length === 2) {
      const options = TIME_OPTIONS.map(([label, value]) => `{label:"${label}",value:"${value}"}`).join(",");
      out = out.replace(TIME_LIST, `{label:"Any time",value:"all"},${options},{label:"Past 24 hours",value:"qdr:d"}`);
      const names = TIME_OPTIONS.map(([label, value]) => `"${value}":"${label.toLowerCase()}"`).join(",");
      out = out.split(TIME_NAMES).join(`{${names},"qdr:d":"past 24 hours",`);
      applied++;
    }

    // Search bar: up to MAX_TITLES job titles instead of 3, and a pasted
    // "Python, SQL, Data Analyst" list becomes one title chip per entry.
    const ph = out.indexOf(TITLE_PLACEHOLDER);
    if (ph >= 0 && out.split(TITLE_PLACEHOLDER).length === 2) {
      const w = out.slice(ph, ph + 2800);
      const onChange = /onChange:e=>\(\(e,t\)=>\{const n=\[\.\.\.([\w$]+)\];n\[e\]=t,([\w$]+)\(n\)/;
      if (w.split(".length<3").length === 6 && w.split(".length>=3").length === 2 && onChange.test(w)) {
        const nw = w
          .split(".length<3").join(`.length<${MAX_TITLES}`)
          .split(".length>=3").join(`.length>=${MAX_TITLES}`)
          .replace(onChange, "onChange:e=>((e,t)=>{const n=[...$1];window.__lazySplitTitles(n,e,t),$2(n)");
        // The chips sat on one clipped line; let them wrap (scrolling after
        // about three rows) so every added title stays visible.
        const pre = out.slice(Math.max(0, ph - 1200), ph);
        const ROW = 'gap:.5,overflow:"hidden",ml:1}';
        const CHIP = 'maxWidth:"120px",overflow:"hidden"}';
        // The box itself is a fixed 54px high; let it grow with the chips.
        const BOX = "(Yh,{sx:{flex:2}";
        let npre = pre;
        if (pre.split(ROW).length === 2 && pre.split(CHIP).length === 2 && pre.split(BOX).length === 2) {
          npre = pre
            .replace(BOX, '(Yh,{sx:{flex:2,height:"auto",minHeight:"54px",py:"6px"}')
            .replace(ROW, 'gap:.5,flexWrap:"wrap",rowGap:"4px",maxHeight:"150px",overflowY:"auto",ml:1}')
            .replace(CHIP, 'maxWidth:"180px",flexShrink:0,overflow:"hidden"}');
        }
        // Each chip was a tooltip + styled box + icon button, all rebuilt on
        // every keystroke: with 150+ titles typing lagged ~0.5 s per key.
        // Plain elements look the same (hover still shows the full title).
        const HEAVY_CHIP = new RegExp(
          '\\(0,([\\w$]+)\\.jsx\\)\\([\\w$]+,\\{title:e,placement:"top",children:\\(0,\\1\\.jsxs\\)\\([\\w$]+,\\{sx:\\{display:"flex",alignItems:"center",gap:\\.5,backgroundColor:"#E3F2FD"[^}]*\\},' +
            'children:\\[\\(0,\\1\\.jsx\\)\\("span",\\{style:\\{[^}]*\\},children:e\\}\\),\\(0,\\1\\.jsx\\)\\([\\w$]+,\\{size:"small",onClick:(\\(\\)=>\\(e=>\\{[^]*?\\}\\)\\(t\\)),sx:\\{[^}]*\\},children:"\\\\xd7"\\}\\)\\]\\}\\)\\},t\\)'
        );
        if ((npre.match(new RegExp(HEAVY_CHIP.source, "g")) || []).length === 1) {
          npre = npre.replace(
            HEAVY_CHIP,
            (m, X, click) =>
              `(0,${X}.jsxs)("span",{title:e,style:{display:"inline-flex",alignItems:"center",gap:"4px",backgroundColor:"#E3F2FD",borderRadius:"12px",padding:"2px 8px",fontSize:"12px",color:"#1976D2",maxWidth:"180px",flexShrink:0,overflow:"hidden",lineHeight:"18px",boxSizing:"border-box"},children:[` +
              `(0,${X}.jsx)("span",{style:{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:e}),` +
              `(0,${X}.jsx)("button",{type:"button","aria-label":"Remove "+e,onClick:${click},style:{border:0,background:"none",padding:0,margin:0,width:"16px",height:"16px",fontSize:"13px",lineHeight:"16px",color:"#1976D2",cursor:"pointer",flexShrink:0},children:"\\xd7"})]},t)`
          );
        }
        out = out.slice(0, Math.max(0, ph - 1200)) + npre + nw + out.slice(ph + 2800);
        applied++;
      }
    }

    // Email templates: LazyApply's delete only removed the card from the screen
    // (it came back on reload) and there was no way to pick a default. Deleted
    // templates are now remembered and kept hidden, and each card gets a
    // "Make default" button; the default carries the "Default" badge and is
    // pre-selected in "Configure Referral Options".
    const TPL = [
      // Manage Templates: delete / make default, and hide deleted ones on load.
      ["u=n=>{t(e.filter((e=>e.id!==n)))}",
        'u=(n,k)=>{k==="default"?(window.__lazyTpl.setDefault(n),t([...e])):(window.__lazyTpl.hide(n),t(e.filter((e=>e.id!==n))))}'],
      ["t([...o,...a])", "t(window.__lazyTpl.visible([...o,...a]))"],
      // Card: the badge marks your default; every other card can be deleted.
      ['t.isDefault?(0,$n.jsx)(Gh,{label:"Default"', 'window.__lazyTpl.isDefault(t.id)?(0,$n.jsx)(Gh,{label:"Default"'],
      ['(0,$n.jsx)(n3,{disableRipple:!0,onClick:r,children:"Edit Template"})',
        '(0,$n.jsxs)("div",{style:{display:"flex",gap:"8px"},children:[(0,$n.jsx)(n3,{disableRipple:!0,onClick:r,children:"Edit Template"}),window.__lazyTpl.isDefault(t.id)?null:(0,$n.jsx)(n3,{disableRipple:!0,onClick:e=>{e.stopPropagation(),a(t.id,"default")},sx:{backgroundColor:"#fff",color:"#2D2D2D",border:"1px solid #2D2D2D","&:hover":{backgroundColor:"#f0f0f0"}},children:"Make default"})]})'],
      // Referral dialog: no deleted templates, and your default selected.
      ['console.log("transformed",s),l(s),s.connectedEmails.length>0&&c(s.connectedEmails[0].id),s.templates.length>0&&d(s.templates[0].id)',
        's.templates=window.__lazyTpl.visible(s.templates),console.log("transformed",s),l(s),s.connectedEmails.length>0&&c(s.connectedEmails[0].id),s.templates.length>0&&d(window.__lazyTpl.pick(s.templates))'],
    ];
    if (TPL.every(([a]) => out.split(a).length === 2)) {
      for (const [a, b] of TPL) out = out.split(a).join(b);
      applied++;
    }

    return applied ? out : null;
  }

  // Template choices, kept in this browser for app.lazyapply.com.
  window.__lazyTpl = (function () {
    const KEY = "lazyTemplatePrefs";
    const load = () => {
      try {
        const v = JSON.parse(localStorage.getItem(KEY) || "{}");
        return { hidden: Array.isArray(v.hidden) ? v.hidden.map(String) : [], def: v.def == null ? null : String(v.def) };
      } catch (e) {
        return { hidden: [], def: null };
      }
    };
    const save = (p) => {
      try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {}
    };
    return {
      hide(id) {
        const p = load();
        id = String(id);
        if (p.hidden.indexOf(id) < 0) p.hidden.push(id);
        if (p.def === id) p.def = null;
        save(p);
      },
      setDefault(id) {
        const p = load();
        id = String(id);
        p.def = id;
        p.hidden = p.hidden.filter((x) => x !== id);
        save(p);
      },
      isDefault(id) {
        return load().def === String(id);
      },
      visible(list) {
        const h = load().hidden;
        return (list || []).filter((t) => t && h.indexOf(String(t.id)) < 0);
      },
      pick(list) {
        const d = load().def;
        const hit = d && (list || []).find((t) => String(t.id) === d);
        return (hit || list[0]).id;
      },
      restoreAll() {
        const p = load();
        p.hidden = [];
        save(p);
      },
    };
  })();

  // Used by the patched search bar (see above).
  window.__lazySplitTitles = function (arr, i, text) {
    text = String(text == null ? "" : text);
    if (!/[,;|\n]/.test(text)) {
      arr[i] = text;
      return;
    }
    const parts = text.split(/[,;|\n]+/);
    const last = parts.pop().replace(/^\s+/, "");
    const before = arr.slice(0, i).filter((x) => String(x).trim());
    const seen = new Set(before.map((x) => String(x).trim().toLowerCase()));
    const add = [];
    for (const part of parts) {
      const v = part.replace(/\s+/g, " ").trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      add.push(v);
    }
    const room = Math.max(0, MAX_TITLES - before.length);
    arr.splice(i, 1, ...add.slice(0, room), room > add.length ? last : "");
  };

  function loadOriginal(src) {
    const s = document.createElement("script");
    s.src = src;
    (document.head || document.documentElement).appendChild(s);
  }

  const domReady = new Promise((resolve) => {
    if (document.readyState !== "loading") resolve();
    else document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });

  let handled = false;

  async function replace(src) {
    let code = null;
    try {
      const r = await fetch(src, { credentials: "same-origin" });
      if (r.ok) code = patch(await r.text());
    } catch (e) {}
    await domReady; // the original was a deferred script
    if (!code) return loadOriginal(src);
    try {
      const s = document.createElement("script");
      s.textContent = code + "\n//# sourceURL=" + src;
      (document.head || document.documentElement).appendChild(s);
      window.__lazyApplyDashTargets = "patched";
    } catch (e) {
      loadOriginal(src);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (handled || node.nodeName !== "SCRIPT" || !node.src) continue;
        let url;
        try {
          url = new URL(node.src, location.href);
        } catch (e) {
          continue;
        }
        if (url.origin !== location.origin || !MAIN_RE.test(url.pathname)) continue;
        handled = true;
        observer.disconnect();
        // Seen before the browser prepares the script: an unknown type keeps
        // it from running, and the patched copy runs in its place.
        node.type = "javascript/blocked";
        replace(url.href);
        return;
      }
    }
  });
  observer.observe(document.documentElement || document, { childList: true, subtree: true });
  // Nothing to do on pages without the dashboard script.
  domReady.then(() => observer.disconnect());
})();
