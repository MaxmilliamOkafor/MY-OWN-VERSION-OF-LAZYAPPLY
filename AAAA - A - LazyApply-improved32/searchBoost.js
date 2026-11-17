/*
 * Search Boost — extra job source for the LazyApply dashboard search.
 *
 * LazyApply's own "All Platforms" search runs a few pages of a web search
 * and usually returns only a handful of jobs. This module pulls live jobs
 * straight from the public job-board APIs of Greenhouse, Lever and Ashby
 * (the same sites LazyApply auto-applies on), filters them by the search's
 * title, skills, location, date and excluded companies, and hands them back
 * in the shape the dashboard already understands.
 *
 * Loaded into the background service worker with importScripts(), after
 * searchBoostBoards.js. Also runs under Node for testing.
 */
(function (root) {
  "use strict";

  const BASE_BOARDS =
    root.LAZYAPPLY_BOOST_BOARDS ||
    (typeof require === "function" ? require("./searchBoostBoards.js") : {});

  const CACHE_TTL_MS = 30 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 12000;
  const TOTAL_BUDGET_MS = 34000;
  const CONCURRENCY = 40;
  const DETAIL_LIMIT = 1500; // Greenhouse job pages fetched for skill matching
  const KW_TTL_MS = 7 * 24 * 3600 * 1000; // a job's description keywords do not change
  const MAX_RESULTS = 2000;
  const WORKDAY_PAGE = 20; // the most Workday returns per request
  const WORKDAY_PAGES = 5; // pages per company and keyword
  const WORKDAY_WAVE = 4; // pages fetched at once after the first
  const WORKDAY_CONCURRENCY = 48; // Workday companies searched at once (each has its own limits)
  const LEARNED_KEY = "searchBoostLearnedBoards";
  const LEARNED_MAX = 3000;

  // ---------------------------------------------------------------- text --
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ø/g, "o").replace(/ł/g, "l").replace(/æ/g, "ae").replace(/ß/g, "ss").replace(/œ/g, "oe").replace(/đ/g, "d")
      .replace(/c\+\+/g, " cplusplus ")
      .replace(/c#/g, " csharp ")
      .replace(/\.net\b/g, " dotnet ")
      .replace(/node\.js|nodejs/g, " node ")
      .replace(/react\.js|reactjs/g, " react ")
      .replace(/vue\.js|vuejs/g, " vue ")
      .replace(/next\.js|nextjs/g, " nextjs ")
      .replace(/front[\s-]?end/g, "frontend")
      .replace(/back[\s-]?end/g, "backend")
      .replace(/full[\s-]?stack/g, "fullstack")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z#0-9]+;/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const words = (s) => norm(s).split(" ").filter(Boolean);

  const SENIORITY = new Set(["senior","sr","junior","jr","lead","staff","principal","mid","level","entry","graduate","grad","intern","internship","associate","head","i","ii","iii","iv","1","2","3"]);
  const FILLER = new Set(["a","an","the","of","and","or","for","in","at","to","with","remote","hybrid","onsite","job","jobs","role"]);
  // Words naming the kind of role rather than the specialty; interchangeable,
  // so "Python Developer" also finds "Python Engineer".
  const ROLE = new Set(["developer","engineer","engineering","programmer","dev","swe","sde","coder"]);
  const TECHNICAL_TITLE = new Set(["developer","engineer","engineering","programmer","swe","sde","architect","scientist","software","backend","frontend","fullstack","platform","infrastructure","sre","devops","data","ml","ai","security","mobile","ios","android","sdet","qa","firmware","embedded","cloud"]);
  const SYNONYMS = {
    software: ["software","swe","sde","backend","frontend","fullstack"],
    ml: ["ml","machine","learning","ai"],
    ai: ["ai","ml","machine","llm","genai"],
    devops: ["devops","devsecops","sre","reliability"],
    sre: ["sre","reliability","devops"],
    js: ["javascript","js","typescript","node","react"],
    javascript: ["javascript","js","typescript","node"],
    golang: ["go","golang"],
    go: ["go","golang"],
    k8s: ["kubernetes","k8s"],
    kubernetes: ["kubernetes","k8s"],
    qa: ["qa","test","testing","quality","sdet"],
    postgres: ["postgres","postgresql"],
    postgresql: ["postgres","postgresql"],
    // Business titles: the same job under another name. "Compliance Analyst"
    // also finds "Compliance Specialist", "Risk Manager" also "Risk Lead",
    // "IT Audit" also "IT Auditor".
    analyst: ["analyst","specialist","associate"],
    specialist: ["specialist","analyst"],
    officer: ["officer","analyst","specialist"],
    consultant: ["consultant","advisor","adviser","specialist"],
    manager: ["manager","lead","leader"],
    audit: ["audit","auditor","auditing","audits"],
    auditor: ["auditor","audit","auditing"],
  };
  // Skills worth spotting inside job descriptions. A searched skill from this
  // list may match the description when the job title is technical.
  const SKILLS = new Set(("python java javascript typescript go golang rust ruby rails php scala kotlin swift objective cplusplus csharp dotnet elixir erlang haskell clojure perl lua dart r matlab julia " +
    "react angular vue svelte nextjs node django flask fastapi spring springboot laravel express nestjs graphql grpc rest " +
    "kubernetes k8s docker terraform ansible helm aws gcp azure lambda serverless linux unix bash " +
    "sql postgres postgresql mysql mongodb redis kafka rabbitmq elasticsearch cassandra dynamodb snowflake bigquery redshift spark hadoop airflow dbt databricks flink " +
    "pytorch tensorflow keras jax llm llms nlp cv rag langchain huggingface pandas numpy scikit " +
    "ios android flutter reactnative xamarin unity unreal " +
    "salesforce sap servicenow workday hubspot shopify wordpress figma").split(" "));

  function skillSet(text) {
    const out = new Set();
    for (const w of words(text)) if (SKILLS.has(w)) out.add(w);
    return [...out];
  }

  // A level typed into the search ("Senior Data Analyst") must be in the
  // job title too; these are the spellings that count as the same level.
  const LEVELS = {
    senior: ["senior", "sr"], sr: ["senior", "sr"], junior: ["junior", "jr", "entry"], jr: ["junior", "jr", "entry"],
    lead: ["lead"], staff: ["staff"], principal: ["principal"], head: ["head"],
    intern: ["intern", "internship", "interns"], internship: ["intern", "internship", "interns"],
  };
  const PEOPLE_MANAGER = ["manager","managers","director","head","vp","president","chief"];
  function compileTitle(title) {
    const ws = words(title).filter((w) => !FILLER.has(w));
    const core = ws.filter((w) => !SENIORITY.has(w) && !ROLE.has(w));
    const wantsRole = ws.some((w) => ROLE.has(w));
    const levels = [...new Set(ws.filter((w) => LEVELS[w]))].map((w) => LEVELS[w]);
    const managerial = ws.some((w) => PEOPLE_MANAGER.includes(w));
    return { raw: title, nraw: norm(title), core, wantsRole, levels, managerial };
  }

  const hasAny = (set, list) => list.some((a) => set.has(a));

  // Extra points for jobs most likely to turn into a finished application
  // and a reply: forms that need no account, and recent postings.
  // Every supported job site counts the same: no site is ranked above another.
  const EASE = {};
  const MAX_PER_COMPANY = 4;
  function applyBonus(job, now) {
    let b = EASE[job.platform] || 0;
    if (job.posted) {
      const days = (now - job.posted) / 86400000;
      b += days <= 3 ? 4 : days <= 7 ? 3 : days <= 14 ? 2 : days <= 30 ? 1 : 0;
    }
    return b;
  }

  // 0 = no match. Title matches score higher than description matches.
  // A job's title words, worked out once (jobs are cached between searches).
  const titleWords = (job) =>
    job._tw && job._twFor === job.title ? job._tw : ((job._twFor = job.title), (job._nt = norm(job.title)), (job._tw = new Set(job._nt.split(" ").filter(Boolean))));

  // Searched titles grouped by a word the job title must contain, so each job
  // is only checked against the few titles it could match (156 titles x 50,000
  // jobs one by one took minutes).
  function buildTitleIndex(titles) {
    const idx = new Map();
    const always = [];
    for (const m of titles) {
      const key = m.core.find((c) => !SKILLS.has(c));
      if (!key) {
        always.push(m);
        continue;
      }
      for (const a of SYNONYMS[key] || [key]) {
        if (!idx.has(a)) idx.set(a, []);
        idx.get(a).push(m);
      }
    }
    return { idx, always };
  }
  function candidateTitles(ix, job) {
    const out = new Set(ix.always);
    for (const w of titleWords(job)) {
      const l = ix.idx.get(w);
      if (l) for (const m of l) out.add(m);
    }
    return out;
  }

  function matchScore(job, m) {
    const tw = titleWords(job);
    if (!tw.size) return 0;
    const technical = [...tw].some((w) => TECHNICAL_TITLE.has(w));
    if (m.wantsRole && ![...tw].some((w) => ROLE.has(w) || w === "architect" || w === "scientist")) return 0;
    if (m.levels && m.levels.some((alts) => !hasAny(tw, alts))) return 0;
    // "Software Engineer" / "Python Developer" searched: people-manager roles
    // ("Senior Manager, Software Engineering") only when a manager was searched.
    if (m.wantsRole && !m.managerial && hasAny(tw, PEOPLE_MANAGER)) return 0;
    const kw = new Set(job.kw || []);
    const skillOnly = (!m.wantsRole && m.core.length === 1) || (m.wantsRole && softwareTitle(tw));
    let score = 20;
    for (const c of m.core) {
      const alts = SYNONYMS[c] || [c];
      if (hasAny(tw, alts)) score += 6;
      else if (skillOnly && technical && SKILLS.has(c) && hasAny(kw, alts)) score += 1;
      else return 0;
    }
    if (!m.core.length && !m.wantsRole) return 0;
    // Several words searched ("Product Manager", "Data Analyst"): they must
    // read as that phrase, not be scattered ("Product Marketing Manager",
    // "Legal Engineering Manager, Product Specialist"). "Analyst, Data" and
    // "Manager of Product" also count.
    if (m.core.length >= 2 && !phraseIn(job.title, m.core)) return 0;
    titleWords(job);
    if (job._nt.includes(m.nraw != null ? m.nraw : norm(m.raw))) score += 10;
    score -= Math.min(5, Math.max(0, tw.size - 5));
    return score;
  }

  // A hands-on software role (not a manager), where a searched skill may be
  // named only in the description: "Backend Engineer" asking for Python.
  const SOFTWARE_WORDS = ["software","backend","frontend","fullstack","developer","programmer","swe","sde","web","mobile","ios","android"];
  const MANAGER_WORDS = ["manager","director","head","vp","president","chief","recruiter","sales","account","marketing"];
  function softwareTitle(tw) {
    return hasAny(tw, SOFTWARE_WORDS) && !hasAny(tw, MANAGER_WORDS);
  }

  // Is the phrase (words in order, side by side) in the title? Synonyms count
  // for each word; the phrase may also be split around a comma / "of" / "-"
  // with its last part first ("Analyst, Data", "Manager of Product").
  function phraseIn(title, core) {
    const alts = core.map((c) => SYNONYMS[c] || [c]);
    const seq = (ws, from, k0, k1) => {
      for (let k = k0; k < k1; k++) if (!alts[k].includes(ws[from + k - k0])) return false;
      return true;
    };
    const has = (ws, k0, k1) => {
      for (let i = 0; i + (k1 - k0) <= ws.length; i++) if (seq(ws, i, k0, k1)) return true;
      return false;
    };
    // "Entry" is a level only in "Entry Level"; "Data Entry Analyst" is not a Data Analyst.
    // "Lead" / "Associate" at the end name the job ("Risk Lead"), not a level.
    const keep = (w, i, ws) =>
      !FILLER.has(w) && !(SENIORITY.has(w) && (w !== "entry" || ws[i + 1] === "level") && !((w === "lead" || w === "associate") && i === ws.length - 1 && i > 0));
    const kept = (x) => {
      const ws = words(x).filter((w) => !FILLER.has(w));
      return ws.filter((w, i) => keep(w, i, ws));
    };
    // French gender forms: "Consultant(e) Fonctionnel(le)", "Chargé·e".
    const clean = String(title || "").replace(/\((?:e|le|ne|se|re|ère|euse|rice|trice|in|nnes?)\)|[·.](?:e|le|ne)\b/gi, "");
    const parts = clean.split(/,|\s[-–|/]\s|\(|\)|\bof\b|\bfor\b|:/i);
    const raw = parts
      .map((x) => ({ ws: kept(x), head: kept(x.split(/\s(?:&|and)\s/i)[0]) }))
      .filter((x) => x.ws.length);
    const segs = raw.map((x) => x.ws);
    const n = core.length;
    if (segs.some((ws) => has(ws, 0, n))) return true;
    // "Change & Release Manager" is a Change Manager; "Risk and Controls
    // Analyst" a Risk Analyst: each side of the "&" with the shared ending.
    for (const x of parts) {
      const sides = x.split(/\s(?:&|and|\+)\s/i);
      if (sides.length < 2) continue;
      const last = kept(sides[sides.length - 1]);
      if (last.length < 2) continue;
      for (const side of sides.slice(0, -1)) {
        const v = kept(side).concat(last.slice(1));
        if (has(v, 0, n)) return true;
      }
    }
    for (let k = 1; k < n; k++) {
      // "Manager, Product" / "Analyst - Data & AI": one part is exactly
      // words[k..n), and a later part is words[0..k) (alone, or joined by
      // "and"/"&" to another area). "Analyst - Data Management" is not a Data Analyst.
      for (let a = 0; a < segs.length; a++) {
        if (segs[a].length !== n - k || !seq(segs[a], 0, k, n)) continue;
        // Only the very next part: "Manager, Technical Recruiting (Product & Design)" is not a Product Manager.
        for (let b = a + 1; b < Math.min(a + 2, segs.length); b++) {
          if (segs[b].length < k || !seq(segs[b], 0, 0, k)) continue;
          if (segs[b].length === k || raw[b].head.length === k) return true;
        }
      }
    }
    return false;
  }

  // Could this job still match once its description is known?
  function couldMatchWithDetails(job, m) {
    if (m.core.length !== 1 || !SKILLS.has(m.core[0])) return false;
    if (m.wantsRole && !softwareTitle(titleWords(job))) return false;
    const tw = titleWords(job);
    if (![...tw].some((w) => TECHNICAL_TITLE.has(w))) return false;
    if (m.wantsRole && ![...tw].some((w) => ROLE.has(w) || w === "architect" || w === "scientist")) return false;
    return m.core.every((c) => hasAny(tw, SYNONYMS[c] || [c]) || SKILLS.has(c));
  }

  // ------------------------------------------------------------ location --
  const COUNTRY_ALIASES = {
    ireland: ["ireland","dublin","cork","galway","limerick","waterford","ie","irl","emea","europe","eu"],
    "republic of ireland": ["ireland","dublin","cork","galway","limerick","ie","emea","europe"],
    "united kingdom": ["united kingdom","uk","england","scotland","wales","northern ireland","great britain","britain","gb","london","manchester","edinburgh","glasgow","bristol","cambridge","oxford","belfast","birmingham","leeds","reading","cardiff","liverpool","newcastle","nottingham","sheffield","milton keynes","brighton","southampton","aberdeen","leicester","coventry","bath","guildford","slough","swindon","emea","europe"],
    uk: ["united kingdom","uk","england","scotland","wales","northern ireland","great britain","britain","gb","london","manchester","edinburgh","glasgow","bristol","cambridge","oxford","belfast","birmingham","leeds","reading","cardiff","liverpool","newcastle","nottingham","sheffield","milton keynes","brighton","southampton","aberdeen","leicester","coventry","bath","guildford","slough","swindon","emea","europe"],
    england: ["united kingdom","uk","england","scotland","wales","northern ireland","great britain","britain","gb","london","manchester","edinburgh","glasgow","bristol","cambridge","oxford","belfast","birmingham","leeds","reading","cardiff","liverpool","newcastle","nottingham","sheffield","milton keynes","brighton","southampton","aberdeen","leicester","coventry","bath","guildford","slough","swindon","emea","europe"],
    "great britain": ["united kingdom","uk","england","scotland","wales","northern ireland","great britain","britain","gb","london","manchester","edinburgh","glasgow","bristol","cambridge","oxford","belfast","birmingham","leeds","reading","cardiff","liverpool","newcastle","nottingham","sheffield","milton keynes","brighton","southampton","aberdeen","leicester","coventry","bath","guildford","slough","swindon","emea","europe"],
    "united states": ["united states","usa","us","america","united states of america","new york","san francisco","seattle","austin","boston","chicago","los angeles","denver","atlanta","washington","nyc","sf","bay area","north america","americas"],
    usa: ["united states","usa","us","new york","san francisco","seattle","austin","boston","chicago","los angeles","denver","nyc","sf","north america","americas"],
    us: ["united states","usa","us","new york","san francisco","seattle","austin","boston","chicago","los angeles","denver","nyc","sf","north america","americas"],
    canada: ["canada","toronto","vancouver","montreal","ottawa","calgary","edmonton","waterloo","kitchener","mississauga","winnipeg","halifax","quebec","ontario","british columbia","alberta","nova scotia","manitoba","saskatchewan","new brunswick","victoria bc","markham","burnaby","north america","americas"],
    germany: ["germany","deutschland","berlin","munich","munchen","hamburg","frankfurt","cologne","koln","stuttgart","dusseldorf","leipzig","nuremberg","nurnberg","dresden","hannover","bonn","karlsruhe","emea","europe","dach"],
    france: ["france","paris","lyon","emea","europe"],
    netherlands: ["netherlands","amsterdam","rotterdam","utrecht","emea","europe"],
    spain: ["spain","madrid","barcelona","emea","europe"],
    portugal: ["portugal","lisbon","porto","emea","europe"],
    poland: ["poland","warsaw","krakow","emea","europe"],
    sweden: ["sweden","stockholm","emea","europe","nordics"],
    india: ["india","bangalore","bengaluru","hyderabad","pune","mumbai","delhi","new delhi","gurgaon","gurugram","noida","chennai","kolkata","ahmedabad","kochi","jaipur","apac","asia"],
    australia: ["australia","sydney","melbourne","brisbane","perth","adelaide","canberra","new south wales","victoria australia","queensland","apac"],
    singapore: ["singapore","apac","asia"],
    ie: ["ireland","dublin","cork","galway","limerick","waterford","ie","irl","emea","europe","eu"],
    italy: ["italy","italia","rome","milan","milano","turin","emea","europe"],
    belgium: ["belgium","brussels","antwerp","ghent","emea","europe","benelux"],
    luxembourg: ["luxembourg","emea","europe","benelux"],
    austria: ["austria","vienna","wien","emea","europe","dach"],
    switzerland: ["switzerland","zurich","geneva","basel","lausanne","emea","europe","dach"],
    denmark: ["denmark","copenhagen","emea","europe","nordics"],
    norway: ["norway","oslo","emea","europe","nordics"],
    finland: ["finland","helsinki","emea","europe","nordics"],
    iceland: ["iceland","reykjavik","emea","europe","nordics"],
    "czech republic": ["czech republic","czechia","prague","brno","emea","europe"],
    czechia: ["czech republic","czechia","prague","brno","emea","europe"],
    slovakia: ["slovakia","bratislava","emea","europe"],
    hungary: ["hungary","budapest","emea","europe"],
    romania: ["romania","bucharest","cluj","emea","europe"],
    bulgaria: ["bulgaria","sofia","emea","europe"],
    croatia: ["croatia","zagreb","emea","europe"],
    slovenia: ["slovenia","ljubljana","emea","europe"],
    greece: ["greece","athens","emea","europe"],
    cyprus: ["cyprus","limassol","nicosia","emea","europe"],
    malta: ["malta","emea","europe"],
    estonia: ["estonia","tallinn","emea","europe","baltics"],
    latvia: ["latvia","riga","emea","europe","baltics"],
    lithuania: ["lithuania","vilnius","emea","europe","baltics"],
  };
  // More cities, and the local names job ads use ("Lisboa", "Wien", "Praha",
  // "Bruxelles"), so a country or "Europe" finds them too.
  const MORE_CITIES = {
    ireland: ["drogheda","dundalk","kilkenny","athlone","sligo","shannon","swords","dun laoghaire","sandyford","leopardstown","maynooth","naas","wexford","tralee","letterkenny"],
    "united kingdom": ["york","exeter","norwich","plymouth","derby","stoke","wolverhampton","sunderland","hull","dundee","inverness","stirling","warrington","chester","harrogate","basingstoke","bracknell","maidenhead","watford","st albans","stevenage","luton","peterborough","ipswich","chelmsford","canary wharf","city of london"],
    germany: ["essen","dortmund","duisburg","bochum","wuppertal","bielefeld","mannheim","heidelberg","darmstadt","wiesbaden","mainz","bremen","munster","freiburg","augsburg","regensburg","ingolstadt","walldorf","potsdam","kiel","lubeck","rostock","erlangen","wolfsburg","braunschweig","gottingen","aachen","ulm","jena","chemnitz","magdeburg","saarbrucken","osnabruck","paderborn","eschborn","unterschleissheim","garching"],
    france: ["toulouse","lille","nantes","bordeaux","marseille","nice","sophia antipolis","grenoble","rennes","strasbourg","montpellier","la defense","boulogne billancourt","issy les moulineaux","neuilly sur seine","levallois perret","courbevoie","puteaux","saint denis","massy","sophia","aix en provence","clermont ferrand","dijon","tours","angers","rouen","metz","nancy","caen","brest","le mans","reims","annecy"],
    netherlands: ["eindhoven","the hague","den haag","delft","groningen","leiden","haarlem","arnhem","nijmegen","tilburg","breda","maastricht","amstelveen","hoofddorp","schiphol","almere","zwolle","enschede","s hertogenbosch","den bosch","hilversum","amersfoort"],
    spain: ["valencia","sevilla","seville","bilbao","malaga","zaragoza","alicante","palma","las palmas","murcia","granada","san sebastian","donostia","vigo","a coruna","valladolid","pamplona","santander","gijon","oviedo","tarragona","girona","sant cugat"],
    portugal: ["lisboa","braga","coimbra","aveiro","faro","funchal","setubal","guimaraes","leiria","oeiras","matosinhos","sintra","cascais","vila nova de gaia","evora"],
    poland: ["warszawa","krakow","cracow","wroclaw","gdansk","gdynia","poznan","lodz","katowice","lublin","szczecin","bydgoszcz","bialystok","rzeszow","gliwice","torun","olsztyn","opole","kielce"],
    sweden: ["gothenburg","goteborg","malmo","uppsala","linkoping","lund","vasteras","orebro","helsingborg","norrkoping","jonkoping","umea","sundsvall","solna","kista"],
    italy: ["roma","torino","napoli","naples","firenze","florence","bologna","genova","genoa","venezia","venice","verona","padova","padua","trieste","bari","palermo","catania","bergamo","brescia","modena","parma","pisa","trento","bolzano","cagliari"],
    belgium: ["bruxelles","brussel","antwerpen","gent","leuven","liege","luik","mechelen","charleroi","namur","bruges","brugge","hasselt","kortrijk","louvain la neuve","zaventem","diegem","wavre","mons"],
    luxembourg: ["luxembourg city","esch sur alzette","kirchberg","strassen","bertrange"],
    austria: ["graz","linz","salzburg","innsbruck","klagenfurt","villach","wels","st polten","dornbirn","leoben"],
    switzerland: ["zug","bern","berne","lugano","lucerne","luzern","winterthur","st gallen","geneve","genf","schaffhausen","baar","neuchatel","fribourg","aarau","rotkreuz"],
    denmark: ["kobenhavn","aarhus","odense","aalborg","esbjerg","lyngby","kongens lyngby","ballerup","horsens","vejle","kolding","billund"],
    norway: ["norway","oslo","bergen","trondheim","stavanger","kristiansand","tromso","drammen","fornebu","lysaker","sandvika","emea","europe","nordics"],
    finland: ["finland","helsinki","espoo","tampere","vantaa","oulu","turku","jyvaskyla","lahti","kuopio","emea","europe","nordics"],
    iceland: ["iceland","reykjavik","emea","europe","nordics"],
    "czech republic": ["czech republic","czechia","prague","praha","brno","ostrava","plzen","olomouc","liberec","emea","europe"],
    slovakia: ["slovakia","bratislava","kosice","zilina","emea","europe"],
    hungary: ["hungary","budapest","debrecen","szeged","miskolc","pecs","gyor","emea","europe"],
    romania: ["romania","bucharest","bucuresti","cluj","cluj napoca","iasi","timisoara","brasov","constanta","sibiu","oradea","craiova","emea","europe"],
    bulgaria: ["bulgaria","sofia","plovdiv","varna","burgas","ruse","emea","europe"],
    croatia: ["croatia","zagreb","split","rijeka","osijek","zadar","emea","europe"],
    slovenia: ["slovenia","ljubljana","maribor","kranj","emea","europe"],
    greece: ["greece","athens","athina","thessaloniki","patras","heraklion","emea","europe"],
    cyprus: ["cyprus","nicosia","limassol","larnaca","paphos","emea","europe"],
    malta: ["malta","valletta","sliema","st julians","birkirkara","gzira","msida","emea","europe"],
    estonia: ["tartu","narva","parnu"],
    latvia: ["daugavpils","jelgava","liepaja"],
    lithuania: ["kaunas","klaipeda","siauliai","panevezys"],
  };
  for (const c of Object.keys(MORE_CITIES)) {
    const base = COUNTRY_ALIASES[c] || [];
    COUNTRY_ALIASES[c] = [...new Set(base.concat(MORE_CITIES[c]))];
  }
  for (const [alias, c] of [["czechia", "czech republic"], ["deutschland", "germany"], ["espana", "spain"], ["italia", "italy"], ["osterreich", "austria"], ["schweiz", "switzerland"], ["suisse", "switzerland"], ["nederland", "netherlands"], ["holland", "netherlands"], ["polska", "poland"], ["sverige", "sweden"], ["danmark", "denmark"], ["norge", "norway"], ["suomi", "finland"], ["belgique", "belgium"], ["belgie", "belgium"], ["eire", "ireland"]]) {
    if (!COUNTRY_ALIASES[alias] && COUNTRY_ALIASES[c]) COUNTRY_ALIASES[alias] = COUNTRY_ALIASES[c];
  }
  // Remote jobs that only name a European time zone ("Remote, CET +/- 2h").
  // Tested on the raw lower-case text (norm() drops the "+").
  const EURO_TZ_RE = /\b(cet|cest|eet|eest|bst)\b|\b(utc|gmt) ?(\+ ?[0-3]\b|\+0?[0-3]:00|$|[^-\d+])|european time ?zones?|europe(an)? hours|central europe(an)? time|eastern europe(an)? time|western europe(an)? time/;
  // Whole regions: every country in them, so "Europe" finds jobs in Dublin,
  // Berlin or Lisbon, not only jobs whose location literally says "Europe".
  const REGIONS = {
    europe: ["ireland","united kingdom","germany","france","netherlands","spain","portugal","poland","sweden","italy",
      "belgium","luxembourg","austria","switzerland","denmark","norway","finland","iceland","czech republic","slovakia",
      "hungary","romania","bulgaria","croatia","slovenia","greece","cyprus","malta","estonia","latvia","lithuania"],
  };
  REGIONS.eu = REGIONS.europe;
  REGIONS.emea = REGIONS.europe;
  REGIONS["european union"] = REGIONS.europe;
  REGIONS["north america"] = ["united states","canada"];
  // No location filter at all.
  const ANYWHERE = new Set(["worldwide","worlddwide","world wide","anywhere","global","globally","international","all","any","everywhere","remote worldwide","worldwide remote"]);
  const OPEN_REMOTE = ["anywhere","worldwide","global","international"];

  // Words naming a whole region rather than a place. A job whose location is
  // only a region ("EMEA", "Remote - Europe") counts for a country in it only
  // when the job is remote; an office somewhere in "EMEA" could be anywhere.
  const REGION_WORDS = new Set(["emea","europe","eu","european union","dach","nordics","baltics","benelux","apac","asia","americas","north america","latam"]);
  // Other names a searched city goes by in job listings.
  const NYC = ["new york","nyc","new york city","manhattan","brooklyn"];
  const CITY_ALIASES = {
    "new york": NYC, "new york city": NYC, nyc: NYC,
    "san francisco": ["san francisco","sf","san francisco bay area"], sf: ["san francisco","sf","san francisco bay area"],
    "washington dc": ["washington dc","washington d c","district of columbia"], dc: ["washington dc","washington d c","district of columbia"],
    bangalore: ["bangalore","bengaluru"], bengaluru: ["bangalore","bengaluru"],
    gurgaon: ["gurgaon","gurugram"], gurugram: ["gurgaon","gurugram"],
    munich: ["munich","munchen"], munchen: ["munich","munchen"],
    cologne: ["cologne","koln"], koln: ["cologne","koln"],
  };
  const US_STATE_NAMES = ["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming","district of columbia"];
  const US_CITIES = ["nyc","san francisco","seattle","austin","boston","chicago","los angeles","denver","atlanta","miami","dallas","houston","phoenix","san diego","san jose","philadelphia","minneapolis","detroit","nashville","raleigh","salt lake city","pittsburgh","charlotte","palo alto","mountain view","menlo park","sunnyvale","cupertino","redwood city","santa clara","san mateo","oakland","brooklyn","bay area","silicon valley","st louis","kansas city","indianapolis","baltimore","tampa","orlando","sacramento","las vegas","cincinnati","cleveland","milwaukee","boulder","irvine","santa monica","jersey city","hoboken","mclean","reston","herndon","plano","scottsdale","tempe","ann arbor","omaha","new orleans","somerville","waltham","stamford","washington dc"];
  const US_CODES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";
  // "Austin, TX", "McLean VA", "US-OH-Columbus", "WA - Seattle", "New York, NY 10001"
  const US_CODE_RE = new RegExp(
    "(?:^|,\\s*|\\bUSA?[-\\s,]+|[a-z]\\s)(?:" + US_CODES + ")(?=\\s*(?:$|[,;|/)]|\\d{5}|-\\s|\\s-|\\s+(?:USA?|United States)\\b))|^(?:" + US_CODES + ")\\s+-\\s"
  );
  const US_CODE_ONLY_RE = new RegExp("^(?:" + US_CODES + ")$", "i");
  // US state name -> postal code, so "Texas" also finds "Dallas, TX" / "TX - Houston" / "US-TX-Austin".
  const STATE_CODE = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
    florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
    louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
    montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
    washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  };
  const stateRe = (code) =>
    new RegExp(
      "(?:^|,\\s*|\\bUSA?[-\\s,]+|[a-z]\\s)" + code + "(?=\\s*(?:$|[,;|/)]|\\d{5}|-|\\s-|\\s+(?:USA?|United States)\\b))|^" + code + "\\s+-\\s|^" + code + "\\s+[A-Z][a-z]"
    );
  const CANADA_RE = /\bcanada\b|,\s*(?:ON|BC|AB|QC|NS|MB|SK|NB|NL|PE)\b/i;
  const US_TERMS = new Set(["us", "usa", "united states", "united states of america", "america", "u s"]);
  // Is this job location in the United States?
  function inUSA(raw) {
    const r = String(raw || "");
    if (CANADA_RE.test(r) && !/\b(usa|united states)\b/i.test(r)) return false;
    if (US_CODE_RE.test(r)) return true;
    const t = " " + norm(r) + " ";
    if (/ (us|usa|united states|united states of america|u s a) /.test(t)) return true;
    return (
      US_STATE_NAMES.some((n) => n !== "washington" && n !== "new york" && n !== "georgia" && t.includes(" " + n + " ")) ||
      US_CITIES.some((c) => t.includes(" " + c + " "))
    );
  }

  const REMOTE_WORD_RE = /\b(remote|wfh|work from home|home ?office|teletravail|télétravail|remoto|fernarbeit)\b/i;
  const EURO_SET = new Set(REGIONS.europe.concat(["europe", "eu", "emea", "european union"]));
  function compileLocation(locations) {
    const list = (locations || []).map((l) => String(l || "").trim()).filter(Boolean);
    if (!list.length || list.some((l) => ANYWHERE.has(norm(l)))) return null;
    const terms = new Set();
    const regions = new Set();
    const states = new Set();
    let wantsUS = false;
    const addPlace = (p) => {
      if (!p || p === "remote") return;
      if (US_TERMS.has(p)) wantsUS = true;
      // A US state ("Texas", or "TX" with the US named): its code counts too.
      const code = STATE_CODE[p] || (US_CODE_ONLY_RE.test(p) ? p.toUpperCase() : "");
      if (code && p !== "new york") {
        states.add(code);
        wantsUS = true;
      }
      terms.add(p);
      (CITY_ALIASES[p] || []).forEach((a) => terms.add(a));
      for (const a of COUNTRY_ALIASES[p] || []) (REGION_WORDS.has(a) ? regions : terms).add(a);
      if (REGIONS[p]) {
        // A whole region searched ("Europe"): every country in it.
        for (const c of REGIONS[p]) {
          terms.add(c);
          for (const a of COUNTRY_ALIASES[c] || []) terms.add(a);
        }
      }
    };
    for (const l of list) {
      const parts = String(l)
        .split(/[,/|]| - /)
        .map((x) => norm(x).replace(/\b(remote|hybrid|on ?site|only)\b/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (!parts.length) continue;
      // "Toronto, Canada" / "Austin, TX, USA": the place is the first part; the
      // rest only says which country it is in (so "Dublin, Ireland" is not
      // Dublin, Ohio). A single part ("Canada", "Germany") is the place itself.
      const i = 0;
      addPlace(parts[i]);
      for (const ctx of parts.slice(i + 1)) {
        if (US_TERMS.has(ctx) || US_CODE_ONLY_RE.test(ctx) || US_STATE_NAMES.includes(ctx)) wantsUS = true;
      }
      if (i > 0 && parts.slice(0, i).some((x) => US_CODE_ONLY_RE.test(x))) wantsUS = true;
    }
    const pureRemote = (l) => /^\s*(fully\s+|100%?\s+)?remote(\s+only)?\s*$/i.test(l);
    // "Remote" on its own: any remote job. "Remote, Europe" / "Ireland (Remote)":
    // remote jobs there (or open to anyone), not every remote job in the world.
    const remote = list.some(pureRemote);
    const remoteOnly = list.every(pureRemote);
    const placed = list.filter((l) => !pureRemote(l));
    const needRemote = !remote && placed.length > 0 && placed.every((l) => REMOTE_WORD_RE.test(l));
    const euro = [...terms].some((t) => EURO_SET.has(t));
    const stateList = [...states];
    return {
      terms: [...terms].filter((t) => t.length >= 2 && !(states.size && US_CODE_ONLY_RE.test(t))),
      regions: [...regions],
      remote,
      remoteOnly,
      needRemote,
      euro,
      wantsUS,
      states: stateList,
      stateRes: stateList.map(stateRe),
    };
  }

  const SHARED_CITY_NAMES = new Set([
    "dublin", "cork", "galway", "limerick", "waterford", "london", "paris", "berlin", "birmingham",
    "cambridge", "manchester", "richmond", "athens", "rome", "milan", "dover", "belfast", "edinburgh",
    "toronto", "waterloo", "hamilton", "victoria", "perth", "melbourne", "sydney", "kingston", "vancouver",
    "reading", "bath", "oxford", "newcastle", "aberdeen", "brighton", "leicester", "coventry", "bristol", "cardiff",
    "york", "derby", "chester", "hull", "plymouth", "exeter", "norwich", "warrington", "peterborough", "stoke", "valencia", "bergen", "florence", "naples", "venice", "nice", "verona", "modena", "palermo", "leiden", "delft", "utrecht", "hamburg", "frankfurt", "potsdam", "lucerne", "geneva", "zurich", "stockholm", "oslo", "bremen", "munster", "aachen", "windsor", "kingston", "durham", "lancaster", "salem", "sterling",
  ]);

  const REMOTE_RE = /\b(remote|remotely|anywhere|worldwide|work from home|work from anywhere|wfh|distributed|home based|homebased|telecommute|telework|teleworker|remoteteleworker|virtual|home office|homeoffice|mobile office|mobiles arbeiten|fernarbeit|telearbeit|teletravail|teletrabajo|remoto|da remoto|smart working|thuiswerk|thuiswerken|zdalna|zdalnie)\b/;

  function locationMatches(jobLocations, isRemote, loc) {
    if (!loc) return true;
    const raws = jobLocations.map((x) => String(x || "")).filter((x) => x.trim());
    const texts = raws.map(norm).filter(Boolean);
    const remoteish = !!isRemote || texts.some((t) => REMOTE_RE.test(t));
    // "Remote" chosen as the location: any job the board marks as remote or
    // whose location says so, wherever its company is based.
    if (loc.remote && remoteish) return true;
    if (loc.remoteOnly) return false;
    if (loc.needRemote && !remoteish) return false;
    const jobInUS = raws.some(inUSA);
    // The United States searched: any US place counts ("Raleigh, NC", "Remote - US").
    if (loc.wantsUS && jobInUS && loc.terms.some((t) => US_TERMS.has(t))) return true;
    // A US state searched: its postal code in the job's place ("Dallas, TX").
    if (loc.stateRes && loc.stateRes.length && raws.some((r) => !CANADA_RE.test(r) && loc.stateRes.some((re) => re.test(r)))) return true;
    const padded = texts.map((t) => " " + t + " ");
    const hit = (term) => padded.some((t) => t.includes(" " + term + " "));
    // "Dublin, CA" / "US-OH-Dublin" is not Dublin, Ireland: when the job is
    // in the US and the US was not searched, a shared city name is not enough.
    const terms = jobInUS && !loc.wantsUS ? loc.terms.filter((t) => !SHARED_CITY_NAMES.has(t)) : loc.terms;
    if (terms.some(hit)) return true;
    // Remote jobs open to the searched country's region, or to everyone
    // ("Anywhere in the U.S." / "Anywhere in Belgium" is not everyone).
    if (remoteish) {
      const open = padded.map((t) => t.replace(/ (anywhere|remote) (in|within|across) (the )?[a-z ]+/g, " "));
      if (loc.regions.some(hit) || OPEN_REMOTE.some((o) => open.some((t) => t.includes(" " + o + " ")))) return true;
      // "Remote, CET +/- 2 hours" when a European place was searched.
      if (loc.euro && raws.some((r) => EURO_TZ_RE.test(r.toLowerCase()))) return true;
      // Remote + a place asked for: a job that says only "Remote" may be open there.
      if (loc.needRemote && texts.every((t) => !t.replace(new RegExp(REMOTE_RE.source, "g"), " ").replace(/\b(fully|only|first|friendly|position|role|job|based|100)\b/g, " ").trim())) return true;
    }
    return false;
  }

  // ------------------------------------------------- Additional Filters --
  // The dashboard's "Additional Filters" (Job Type, Work Type, Experience
  // Level), applied to every job the same way, whichever site it came from.
  // A job is dropped only when what it says clearly conflicts with the choice.
  const INTERN_RE = /\b(intern|interns|internship|internships|placement|co-?op|co op|apprentice|apprenticeship|working student|werkstudent|stagiaire|stage|praktikum|summer analyst)\b/;
  const CONTRACT_RE = /\b(contract|contractor|contracting|freelance|freelancer|temporary|temp|fixed[- ]term|ftc|interim|consultant \(contract\)|c2c|1099|maternity cover|locum)\b/;
  const PART_RE = /\b(part[- ]?time|parttime|half[- ]time)\b/;
  const FULL_RE = /\b(full[- ]?time|fulltime|permanent|regular)\b/;
  const HYBRID_RE = /\bhybrid\b/;
  const ONSITE_RE = /\b(on[- ]?site|onsite|in[- ]office|office based)\b/;
  const SENIOR_RE = /\b(senior|sr|lead|principal|staff|manager|mgr|director|head|vp|vice president|chief|architect|expert|distinguished|fellow|partner|avp|svp|evp|executive|president|cto|cfo|ceo|coo|cio|ciso|iii|iv|v|3|4|5)\b/;
  const NOT_ASSOCIATE_RE = /\b(principal|director|head|vp|vice president|chief|distinguished|fellow|partner|svp|evp|executive director|president|cto|cfo|ceo|coo|cio|ciso)\b/;
  const EXEC_RE = /\b(director|head|vp|vice president|chief|executive|president|partner|managing director|md|svp|evp|avp|cto|cfo|ceo|coo|cio|ciso|cxo|general manager)\b/;

  function compileFilters(f) {
    if (!f || typeof f !== "object") return null;
    const pick = (v) => String((v && typeof v === "object" ? v.selected || v.value : v) || "").toLowerCase().replace(/[^a-z]/g, "");
    const out = { jobType: pick(f.jobType), workType: pick(f.workType), experience: pick(f.experienceLevel) };
    if (!["fulltime", "parttime", "contract", "internship"].includes(out.jobType)) out.jobType = "";
    if (!["remote", "hybrid", "onsite"].includes(out.workType)) out.workType = "";
    if (!["entrylevel", "associate", "executive"].includes(out.experience)) out.experience = "";
    return out.jobType || out.workType || out.experience ? out : null;
  }

  // One job: { title, locations[], remote, type } -> keep?
  function filtersAllow(job, f) {
    if (!f) return true;
    const title = " " + norm(job.title) + " ";
    const type = norm(job.type);
    const place = norm((job.locations || []).join(" ") + " " + (job.pathPlace || ""));
    const all = title + " " + type + " " + place;
    if (f.jobType) {
      const intern = INTERN_RE.test(title) || /\bintern/.test(type);
      const contract = CONTRACT_RE.test(title) || /contract|temporary|temp|freelance|fixed/.test(type);
      const part = PART_RE.test(title) || /part/.test(type);
      if (f.jobType === "internship" && !intern) return false;
      if (f.jobType === "contract" && !contract) return false;
      if (f.jobType === "parttime" && !part) return false;
      if (f.jobType === "fulltime" && (intern || contract || (part && !FULL_RE.test(type)))) return false;
    }
    if (f.workType) {
      const remote = !!job.remote || REMOTE_RE.test(place) || /\b(remote|wfh|work from home)\b/.test(title);
      const hybrid = HYBRID_RE.test(all);
      if (f.workType === "remote" && (!remote || (hybrid && !/\b(fully remote|100 remote|remote first)\b/.test(all)))) return false;
      if (f.workType === "hybrid" && remote && !hybrid) return false;
      if (f.workType === "onsite" && remote && !ONSITE_RE.test(all)) return false;
    }
    if (f.experience) {
      if (f.experience === "entrylevel" && SENIOR_RE.test(title)) return false;
      if (f.experience === "associate" && NOT_ASSOCIATE_RE.test(title)) return false;
      if (f.experience === "executive" && !EXEC_RE.test(title)) return false;
    }
    return true;
  }

  // Work Type "Remote" with a place chosen (e.g. Ireland): remote jobs there,
  // plus remote jobs open everywhere or across a wider region ("Remote",
  // "Remote - EMEA", "Europe (Remote)").
  const OPEN_REGION_RE = /^(remote|fully remote|anywhere|worldwide|global|international|emea|europe|eu|european union|apac|americas|north america|latam|uk ireland|uk and ireland|uk ie|ireland uk)?$/;
  function remoteOpenTo(job) {
    const texts = (job.locations || []).concat(job.pathPlace ? [job.pathPlace] : []).map(norm).filter(Boolean);
    if (!texts.length) return !!job.remote;
    return texts.some((t) => OPEN_REGION_RE.test(t.replace(/\b(remote|fully|only|based|home|work from|wfh|first|friendly)\b/g, " ").replace(/\s+/g, " ").trim()));
  }

  // ---------------------------------------------------------------- time --
  const DAY = 86400000;
  // Hour / minute windows with fewer than MIN_IN_WINDOW jobs widen step by
  // step, up to a week (the dashboard says how far).
  const HOUR = DAY / 24;
  const WIDEN_STEPS = [5, 10, 15, 20, 30, 45, 60, 180, 360, 720, 1440, 2880, 4320, 10080].map((m) => m * 60000);
  const MIN_IN_WINDOW = 10; // widen an hour window only when it has fewer jobs than this
  // A minute window (under an hour) is what was asked for: it widens only when
  // it holds no job at all, and then in small steps (20, 30, 45 minutes...).
  const minInWindow = (asked, limit) => (asked < HOUR ? 1 : Math.min(MIN_IN_WINDOW, limit));
  function windowMs(timeFilter) {
    const t = String(timeFilter || "").toLowerCase();
    if (!t || t === "all" || t === "any") return null;
    const m = { "qdr:h": DAY / 24, "qdr:d": DAY, "qdr:w": 7 * DAY, "qdr:m": 30 * DAY, "qdr:y": 365 * DAY }[t];
    if (m) return m;
    const r = /^r(\d+)$/.exec(t); // LinkedIn style, seconds (r86400)
    if (r) return Number(r[1]) * 1000;
    const hm = /^qdr:([hn])(\d+)$/.exec(t); // qdr:h6 = 6 hours, qdr:n30 = 30 minutes
    if (hm) return Number(hm[2]) * (hm[1] === "h" ? DAY / 24 : 60000);
    return null;
  }

  // ------------------------------------------------------------- storage --
  // Board lists add up to tens of MB for a few thousand boards, far more
  // than chrome.storage.session holds (10 MB), so they live in IndexedDB.
  // A bounded in-memory copy (least recently used out first) serves repeat
  // searches while the worker is awake.
  const MEM_MAX_ITEMS = 90000; // cached jobs kept in memory at most
  const memCache = new Map();
  let memItems = 0;
  const itemCount = (v) => (Array.isArray(v) ? v.length : 1);
  function memPut(key, entry) {
    const old = memCache.get(key);
    if (old) {
      memItems -= itemCount(old.v);
      memCache.delete(key);
    }
    memCache.set(key, entry);
    memItems += itemCount(entry.v);
    while (memItems > MEM_MAX_ITEMS && memCache.size > 1) {
      const [k, e] = memCache.entries().next().value;
      memCache.delete(k);
      memItems -= itemCount(e.v);
    }
  }
  function memGet(key) {
    const m = memCache.get(key);
    if (!m) return null;
    memCache.delete(key); // most recently used goes to the end
    memCache.set(key, m);
    return m;
  }

  const hasChrome = typeof chrome !== "undefined" && chrome.storage;
  const sessionStore = () => hasChrome && (chrome.storage.session || chrome.storage.local);
  const hasIDB = typeof indexedDB !== "undefined";
  let dbPromise = null;
  function idb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const r = indexedDB.open("lazyapply-search-boost", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("cache");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.onblocked = () => resolve(null);
        } catch (e) {
          resolve(null);
        }
      });
    }
    return dbPromise;
  }
  async function idbGet(key) {
    const d = await idb();
    if (!d) return undefined;
    return new Promise((resolve) => {
      try {
        const q = d.transaction("cache", "readonly").objectStore("cache").get(key);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => resolve(undefined);
      } catch (e) {
        resolve(undefined);
      }
    });
  }
  async function idbSet(key, entry) {
    const d = await idb();
    if (!d) return false;
    return new Promise((resolve) => {
      try {
        const tx = d.transaction("cache", "readwrite");
        tx.objectStore("cache").put(entry, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  }
  // Drops entries older than a day, and the board lists earlier versions
  // left in session storage (they filled its 10 MB).
  async function pruneCache() {
    const d = await idb();
    if (d) {
      await new Promise((resolve) => {
        try {
          const tx = d.transaction("cache", "readwrite");
          const now = Date.now();
          tx.objectStore("cache").openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (!c) return;
            const keep = String(c.key).startsWith("boostkw:") ? KW_TTL_MS : STALE_MAX_MS;
            if (!c.value || !(c.value.at > now - keep)) c.delete();
            c.continue();
          };
          tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        } catch (e) {
          resolve();
        }
      });
    }
    if (hasIDB && hasChrome && chrome.storage.session) {
      try {
        const all = await chrome.storage.session.get(null);
        const old = Object.keys(all || {}).filter((k) => /^boost(kw)?:/.test(k));
        if (old.length) await chrome.storage.session.remove(old);
      } catch (e) {}
    }
  }

  async function cacheGet(key, ttl = CACHE_TTL_MS) {
    const m = memGet(key);
    if (m && Date.now() - m.at < ttl) return m.v;
    let v;
    if (hasIDB) v = await idbGet(key);
    else {
      const s = sessionStore();
      if (!s) return null;
      try {
        v = (await s.get(key))[key];
      } catch (e) {}
    }
    if (v && Date.now() - v.at < ttl) {
      memPut(key, v);
      return v.v;
    }
    return null;
  }

  async function cacheSet(key, v) {
    const entry = { at: Date.now(), v };
    memPut(key, entry);
    if (hasIDB) {
      await idbSet(key, entry);
      return;
    }
    const s = sessionStore();
    if (s) {
      try {
        await s.set({ [key]: entry });
      } catch (e) {
        // Session storage is small; the in-memory copy still works.
      }
    }
  }

  // A job site that answers 429 (too many requests) is left alone for 10
  // minutes; searches carry on with the cache and the other sites.
  const BACKOFF_MS = 10 * 60 * 1000;
  const pausedUntil = {};
  const siteOf = (url) => {
    const m = /^https:\/\/([^/]+)/.exec(url);
    const h = m ? m[1] : "";
    // Workday: each company has its own limits, so a 429 pauses only that company.
    if (/\.myworkdayjobs\.com$/.test(h)) {
      const t = /^https:\/\/[^/]+\/wday\/cxs\/([^/]+)/.exec(url);
      return h + (t ? "/" + t[1] : "");
    }
    return (/(greenhouse\.io|lever\.co|ashbyhq\.com|rippling\.com|smartrecruiters\.com)$/.exec(h) || [h])[0];
  };
  const paused = (url) => (pausedUntil[siteOf(url)] || 0) > Date.now();
  const noteStatus = (url, status) => {
    if (status === 429) pausedUntil[siteOf(url)] = Date.now() + BACKOFF_MS;
  };

  async function getJson(url) {
    if (paused(url)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      noteStatus(url, r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------------------------------------------------- learned boards --
  // Company boards seen in LazyApply's own results are remembered, so the
  // boost covers more companies the more you search.
  const TOKEN_RE = /^[a-z0-9][a-z0-9_-]{0,60}$/;

  function boardFromUrl(u) {
    let url;
    try {
      url = new URL(u);
    } catch (e) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const host = url.hostname;
    let kind = null;
    let token = null;
    if (/(^|\.)greenhouse\.io$/.test(host)) {
      kind = "greenhouse";
      token = url.searchParams.get("for") || (parts[0] !== "embed" ? parts[0] : null);
    } else if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
      kind = "lever";
      token = parts[0];
    } else if (host === "jobs.ashbyhq.com") {
      kind = "ashby";
      token = parts[0];
    } else if (host === "ats.rippling.com") {
      kind = "rippling";
      token = parts[0] && /^[a-z]{2}-[A-Z]{2}$/.test(parts[0]) ? parts[1] : parts[0];
    } else {
      // Workday: https://{tenant}.wd5.myworkdayjobs.com/[en-US/]{site}/job/...
      const wd = /^([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com$/i.exec(host);
      if (wd) {
        const p = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0] || "") ? parts.slice(1) : parts;
        if (p[0] && p[1] === "job" && /^[A-Za-z0-9_-]{1,80}$/.test(p[0])) {
          const wdn = wd[2].toLowerCase();
          return { kind: "workday", token: wd[1].toLowerCase() + "/" + p[0] + (wdn === "wd5" ? "" : "/" + wdn) };
        }
      }
      // SmartRecruiters: https://jobs.smartrecruiters.com/{Company}/{id}-...
      if (host === "jobs.smartrecruiters.com" && parts[0] && /^[A-Za-z0-9_-]{2,60}$/.test(parts[0]) && parts[1]) {
        return { kind: "smartrecruiters", token: parts[0] };
      }
      return null;
    }
    token = token && decodeURIComponent(token).toLowerCase();
    return kind && token && TOKEN_RE.test(token) ? { kind, token } : null;
  }

  async function getLearned() {
    if (!hasChrome) return {};
    try {
      const v = (await chrome.storage.local.get(LEARNED_KEY))[LEARNED_KEY];
      return v && typeof v === "object" ? v : {};
    } catch (e) {
      return {};
    }
  }

  async function learnFromUrls(urls) {
    if (!hasChrome || !Array.isArray(urls)) return 0;
    const learned = await getLearned();
    let added = 0;
    for (const u of urls.slice(0, 500)) {
      const b = boardFromUrl(u);
      if (!b) continue;
      const list = (learned[b.kind] = learned[b.kind] || []);
      if (!list.includes(b.token) && !(BASE_BOARDS[b.kind] || []).includes(b.token)) {
        list.push(b.token);
        added++;
      }
    }
    if (added) {
      for (const k of Object.keys(learned)) learned[k] = learned[k].slice(-LEARNED_MAX);
      await chrome.storage.local.set({ [LEARNED_KEY]: learned });
    }
    return added;
  }

  // ------------------------------------------------------------- loaders --
  const COMPANY_NAMES = {
    jll: "JLL", iqvia: "IQVIA", rsm: "RSM", bdo: "BDO", wexinc: "WEX", roberthalf: "Robert Half", trendmicro: "Trend Micro",
    cartrawler: "CarTrawler", learnupon: "LearnUpon", getyourguide: "GetYourGuide", clearbank: "ClearBank", seon: "SEON",
    jj: "Johnson & Johnson", lseg: "LSEG", dxctechnology: "DXC Technology", fmr: "Fidelity Investments",
    mmc: "Marsh McLennan", aig: "AIG", "3m": "3M", kla: "KLA", hp: "HP", hpe: "HPE", gdit: "GDIT", gsk: "GSK",
    pnc: "PNC", ebay: "eBay", citi: "Citi", pwc: "PwC", statestreet: "State Street", analogdevices: "Analog Devices",
    paypal: "PayPal", blackrock: "BlackRock", transunion: "TransUnion", troweprice: "T. Rowe Price",
    homedepot: "The Home Depot", redhat: "Red Hat", crowdstrike: "CrowdStrike", motorolasolutions: "Motorola Solutions",
    thermofisher: "Thermo Fisher", gevernova: "GE Vernova", warnerbros: "Warner Bros. Discovery", nvidia: "NVIDIA",

    // Workday career sites
    "2020companies": "2020 Companies", "abb": "ABB", "academy": "Academy Sports + Outdoors", "advanceauto": "Advance Auto Parts", "ag": "Airbus", "airliquidehr": "Air Liquide", "albanymed": "Albany Med", "amat": "Applied Materials", "amcor": "Amcor", "aptiv": "Aptiv", "arrow": "Arrow Electronics", "asda": "Asda", "asmglobal": "ASM Global", "asml": "ASML", "aspendental": "Aspen Dental", "att": "AT&T", "autonation": "AutoNation", "avisbudget": "Avis Budget Group", "bah": "Booz Allen Hamilton", "bakerhughes": "Baker Hughes", "bannerhealth": "Banner Health", "barclays": "Barclays", "basspro": "Bass Pro Shops", "baxter": "Baxter", "bbva": "BBVA", "bdx": "BD", "bilh": "Beth Israel Lahey Health", "bjswholesaleclub": "BJ's Wholesale Club", "blueorigin": "Blue Origin", "bmc": "Boston Medical Center", "boeing": "Boeing", "boydgroup": "Boyd Group", "bristolmyerssquibb": "Bristol Myers Squibb", "brownhealth": "Brown University Health", "bupa": "Bupa", "caci": "CACI", "cadence": "Cadence", "capitalhealth": "Capital Health", "capitalone": "Capital One", "cardinalhealth": "Cardinal Health", "carmax": "CarMax", "carters": "Carter's", "cat": "Caterpillar", "cc": "Chanel", "ccf": "Cleveland Clinic", "cecentertainment": "CEC Entertainment", "chenmed": "ChenMed", "cincinnatichildrens": "Cincinnati Children's", "circlek": "Circle K", "conehealth": "Cone Health", "cox": "Cox Enterprises", "coxhealth": "CoxHealth", "cvshealth": "CVS Health", "danaher": "Danaher", "daveandbusters": "Dave & Buster's", "davita": "DaVita", "db": "Deutsche Bank", "dentsuaegis": "Dentsu", "dickssportinggoods": "Dick's Sporting Goods", "dollartree": "Dollar Tree", "drivenbrands": "Driven Brands", "dutchbros": "Dutch Bros", "ecolab": "Ecolab", "entegris": "Entegris", "erickson": "Erickson Senior Living", "erm": "ERM", "extraspace": "Extra Space Storage", "ferrovial": "Ferrovial", "fifththird": "Fifth Third Bank", "fis": "FIS", "flextronics": "Flex", "flir": "Teledyne FLIR", "fourseasons": "Four Seasons", "freight": "FedEx Freight", "freseniusmedicalcare": "Fresenius Medical Care", "freudenberg": "Freudenberg", "geaerospace": "GE Aerospace", "gehc": "GE HealthCare", "geisinger": "Geisinger", "generalmotors": "General Motors", "genpt": "Genuine Parts", "gfs": "Gordon Food Service", "global": "Global Partners", "globalfoundries": "GlobalFoundries", "globalhr": "RTX", "goodwillaz": "Goodwill of Central & Northern Arizona", "guidehouse": "Guidehouse", "heidelbergmaterials": "Heidelberg Materials", "heinz": "Kraft Heinz", "highmarkhealth": "Highmark Health", "hitachi": "Hitachi", "hntb": "HNTB", "hyvee": "Hy-Vee", "icon": "ICON plc", "ilitch": "Ilitch Companies", "imh": "Intermountain Health", "ing": "ING", "ivytech": "Ivy Tech Community College", "jabil": "Jabil", "jci": "Johnson Controls", "jcrew": "J.Crew", "jeffersonhealth": "Jefferson Health", "kansashealthsystem": "The University of Kansas Health System", "kbr": "KBR", "kencogroup": "Kenco", "keybank": "KeyBank", "kiongroup": "KION Group", "labcorp": "Labcorp", "leonardocompany": "Leonardo", "levistraussandco": "Levi Strauss & Co.", "lifetime": "Life Time", "livenation": "Live Nation", "lowes": "Lowe's", "maersk": "Maersk", "magna": "Magna", "manulife": "Manulife", "marmon": "Marmon Holdings", "mars": "Mars", "massgeneralbrigham": "Mass General Brigham", "mckesson": "McKesson", "medline": "Medline", "memorialhealthcare": "Memorial Healthcare System", "memorialhermann": "Memorial Hermann", "methodisthealth": "Methodist Le Bonheur Healthcare", "mgmresorts": "MGM Resorts", "michelinhr": "Michelin", "moffitt": "Moffitt Cancer Center", "moog": "Moog", "ms": "Morgan Stanley", "msd": "MSD", "mufgub": "MUFG", "multicare": "MultiCare", "musc": "MUSC Health", "my7elevenhr": "7-Eleven", "mydpr": "DPR Construction", "myhrabc": "Cencora", "mymvw": "Marriott Vacations Worldwide", "myview": "Paradox", "nationwidechildrens": "Nationwide Children's Hospital", "nc": "State of North Carolina", "nexstar": "Nexstar Media", "ngc": "Northrop Grumman", "nike": "Nike", "ntrs": "Northern Trust", "nvent": "nVent", "ochsner": "Ochsner Health", "ohiohealth": "OhioHealth", "okgov": "State of Oklahoma", "onehealthineers": "Siemens Healthineers", "oreillyauto": "O'Reilly Auto Parts", "oshkoshcorporation": "Oshkosh Corporation", "osu": "Ohio State University", "pae": "Amentum", "paloaltonetworks": "Palo Alto Networks", "panerabread": "Panera Bread", "papajohns": "Papa John's", "parsons": "Parsons", "pg": "Procter & Gamble", "philips": "Philips", "ppg": "PPG", "prysmiangroup": "Prysmian", "psu": "Penn State", "pvh": "PVH", "regalrexnord": "Regal Rexnord", "republic": "Republic Services", "richemont": "Richemont", "rochester": "University of Rochester", "rrhs": "Rochester Regional Health", "saintlukes": "Saint Luke's Health System", "saks": "Saks", "sanford": "Sanford Health", "sanofi": "Sanofi", "sbdinc": "Stanley Black & Decker", "sci": "Service Corporation International", "sec": "Samsung", "sedgwick": "Sedgwick", "seminolehardrock": "Seminole Hard Rock", "sentara": "Sentara Health", "shakeshack": "Shake Shack", "skechers": "Skechers", "sluhn": "St. Luke's University Health Network", "smithfieldfoods": "Smithfield Foods", "spartannash": "SpartanNash", "spectrumhealth": "Corewell Health", "syneoshealth": "Syneos Health", "synnex": "TD SYNNEX", "tamus": "Texas A&M University System", "tapestry": "Tapestry", "td": "TD Bank", "thales": "Thales", "thomsonreuters": "Thomson Reuters", "tjx": "TJX Companies", "tmobile": "T-Mobile", "topgolf": "Topgolf", "tsys": "TSYS", "tysonfoods": "Tyson Foods", "uasys": "University of Arkansas System", "uhaul": "U-Haul", "umiami": "University of Miami", "ummc": "University of Mississippi Medical Center", "uottawa": "University of Ottawa", "upenn": "University of Pennsylvania", "usbank": "U.S. Bank", "usc": "University of Southern California", "usfoods": "US Foods", "valeo": "Valeo", "verizon": "Verizon", "vfc": "VF Corporation", "vishay": "Vishay", "vumc": "Vanderbilt University Medical Center", "walmart": "Walmart", "whataburger": "Whataburger", "whitecap": "White Cap", "wustl": "Washington University in St. Louis", "yai": "YAI", "zeissgroup": "ZEISS",
  };
  const pretty = (token) =>
    COMPANY_NAMES[String(token).toLowerCase()] ||
    token
      .replace(/(industries|inc|hq|jobs|careers)$/i, "")
      .replace(/(^|[-_])([a-z0-9])/g, (_, a, b) => (a ? " " : "") + b.toUpperCase());

  const time = (v) => {
    const t = typeof v === "number" ? v : Date.parse(v || "");
    return Number.isFinite(t) ? t : null;
  };

  const LOADERS = {
    async greenhouse(token) {
      const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`);
      if (!j || !Array.isArray(j.jobs)) return null;
      return j.jobs.map((x) => {
        const name = (x.location && x.location.name) || "";
        // Jobs whose page redirects to the company's own site are sent to
        // Greenhouse's hosted application form instead, which autofill handles.
        const hosted = /greenhouse\.io/i.test(x.absolute_url || "");
        return {
          id: String(x.id),
          title: x.title || "",
          company: x.company_name || pretty(token),
          locations: name ? [name] : [],
          remote: REMOTE_RE.test(norm(name)),
          posted: time(x.first_published) || time(x.updated_at),
          editedOnly: !time(x.first_published),
          url: hosted ? x.absolute_url : `https://job-boards.greenhouse.io/embed/job_app?for=${token}&token=${x.id}`,
          platform: "greenhouse",
          board: token,
          kw: null, // filled on demand from the job page
        };
      });
    },
    async lever(token) {
      const j = await getJson(`https://api.lever.co/v0/postings/${token}?mode=json`);
      if (!Array.isArray(j)) return null;
      return j.map((x) => {
        const c = x.categories || {};
        const locs = [...new Set([].concat(c.allLocations || [], c.location ? [c.location] : []))].filter(Boolean);
        return {
          id: String(x.id),
          title: x.text || "",
          company: pretty(token),
          locations: locs,
          remote: x.workplaceType === "remote" || REMOTE_RE.test(norm(locs.join(" "))),
          posted: time(x.createdAt),
          url: x.hostedUrl,
          platform: "lever",
          board: token,
          type: c.commitment || "",
          department: c.team || "",
          kw: skillSet([x.descriptionPlain, x.additionalPlain, (x.lists || []).map((l) => l.text + " " + l.content).join(" ")].join(" ")),
        };
      });
    },
    async ashby(token) {
      const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${token}`);
      if (!j || !Array.isArray(j.jobs)) return null;
      return j.jobs
        .filter((x) => x.isListed !== false && x.jobUrl)
        .map((x) => {
          const pa = x.address && x.address.postalAddress;
          const locs = [...new Set(
            [x.location]
              .concat((x.secondaryLocations || []).map((s) => s.location))
              .concat(pa ? [pa.addressLocality, pa.addressCountry] : [])
              .filter(Boolean)
          )];
          return {
            id: String(x.id),
            title: x.title || "",
            company: pretty(token),
            locations: locs,
            remote: !!x.isRemote || x.workplaceType === "Remote",
            posted: time(x.publishedAt),
            url: x.jobUrl,
            platform: "ashby",
            board: token,
            type: x.employmentType || "",
            department: x.department || "",
            kw: skillSet(x.descriptionPlain || x.descriptionHtml || ""),
          };
        });
    },
    async rippling(token) {
      const byId = new Map();
      for (let page = 0, pages = 1; page < pages && page < 30; page++) {
        const j = await getJson(`https://ats.rippling.com/api/v2/board/${token}/jobs?page=${page}&pageSize=100`);
        if (!j || !Array.isArray(j.items)) return page ? [...byId.values()] : null;
        pages = Number(j.totalPages) || 1;
        for (const x of j.items) {
          if (!x || !x.id || !x.url) continue;
          const locs = (x.locations || []).map((l) => l && l.name).filter(Boolean);
          const remote = (x.locations || []).some((l) => l && /remote/i.test(l.workplaceType || ""));
          const prev = byId.get(x.id);
          if (prev) {
            prev.locations = [...new Set(prev.locations.concat(locs))];
            prev.remote = prev.remote || remote;
            continue;
          }
          byId.set(x.id, {
            id: String(x.id),
            title: x.name || "",
            company: pretty(token),
            locations: locs,
            remote,
            posted: null, // Rippling's board API gives no dates
            url: x.url,
            platform: "rippling",
            board: token,
            department: (x.department && x.department.name) || "",
            kw: [],
          });
        }
      }
      return [...byId.values()];
    },
  };

  // ------------------------------------------------------------- workday --
  // Workday has no "list every job" API, but each company's career site has
  // a keyword search (the same one its own page uses), so it is asked per
  // searched keyword, filtered to the searched country when the site allows.
  const REGION_TERMS = new Set(["emea","europe","eu","apac","asia","americas","north america","nordics","dach"]);

  function workdayAge(postedOn) {
    const t = String(postedOn || "").toLowerCase();
    if (!t) return null;
    if (/today|just posted|hour/.test(t)) return 0;
    if (/yesterday/.test(t)) return 1;
    const m = /(\d+)\+?\s*day/.exec(t);
    if (m) return /\+/.test(t) ? Math.max(35, Number(m[1]) + 5) : Number(m[1]);
    return null;
  }

  async function postJson(url, body) {
    if (paused(url)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      noteStatus(url, r.status);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // Leaf facets of a Workday search answer (some are nested in groups).
  function workdayFacets(facets, out = []) {
    for (const f of facets || []) {
      if (!f || !Array.isArray(f.values)) continue;
      if (f.values.length && Array.isArray(f.values[0].values)) workdayFacets(f.values, out);
      else out.push(f);
    }
    return out;
  }

  // appliedFacets limiting the site to the searched location: {} when no
  // location was searched, undefined when unknown (filter by text instead),
  // or null when the site has no jobs there.
  async function workdayLocationFacets(tenant, site, loc, wdHost = `${tenant}.wd5.myworkdayjobs.com`) {
    if (!loc) return {};
    if (loc.remoteOnly || !loc.terms.length) return undefined; // "Remote": filter by text instead
    const key = `boostwd:facets:${tenant}/${site}`;
    let facets = await cacheGet(key, 24 * 3600 * 1000); // a site's office list rarely changes
    if (!facets) {
      const j = await postJson(`https://${wdHost}/wday/cxs/${tenant}/${site}/jobs`, {
        appliedFacets: {}, limit: 1, offset: 0, searchText: "",
      });
      if (!j) return undefined;
      facets = workdayFacets(j.facets).map((f) => ({
        p: f.facetParameter,
        d: f.descriptor || "",
        v: f.values.map((v) => [v.id, v.descriptor || ""]),
      }));
      await cacheSet(key, facets);
    }
    const exact = loc.terms.filter((t) => !REGION_TERMS.has(t) && t.length > 2);
    const usa = exact.some((t) => t === "united states" || t === "usa");
    const pick = (f, fn) => f.v.filter(([, d]) => fn(norm(d))).map(([id]) => id);
    // Country-level facets first, then the list of offices.
    const countryLike = facets.filter((f) => /countr|hierarchy1/i.test(f.p + " " + f.d));
    for (const f of countryLike) {
      const ids = pick(f, (d) => exact.includes(d) || (usa && d === "united states of america"));
      if (ids.length) return { [f.p]: ids };
    }
    const offices = facets.find((f) => f.p === "locations");
    if (offices) {
      const ids = offices.v
        .filter(([, raw]) => {
          const d = norm(raw);
          return exact.some((t) => (" " + d + " ").includes(" " + t + " ")) || (loc.stateRes || []).some((re) => re.test(raw));
        })
        .map(([id]) => id);
      if (ids.length) return { locations: ids.slice(0, 200) };
    }
    return countryLike.length || offices ? null : undefined;
  }

  // Newest jobs read per company when many keywords are searched at once (or
  // a short date window): up to 1000, stopping at the end of the date window.
  const WORKDAY_RECENT_PAGES = 50;

  async function searchWorkday(tenantSite, keywords, loc, deadline, win) {
    const [tenant, site, wdn] = tenantSite.split("/");
    const wdHost = `${tenant}.${/^wd\d{1,3}$/.test(wdn || "") ? wdn : "wd5"}.myworkdayjobs.com`;
    if (!tenant || !site) return [];
    const applied = await workdayLocationFacets(tenant, site, loc, wdHost);
    if (applied === null) return [];
    const filtered = !!(applied && Object.keys(applied).length);
    const out = [];
    // Many keywords or a short date window: read the company's newest jobs
    // once (Workday lists newest first when no keyword is given) and let the
    // title matching pick from them, instead of one search per keyword.
    const recent = keywords.length > 6 || (win && win <= 2 * DAY);
    if (recent) keywords = [""];
    const maxPages = recent ? WORKDAY_RECENT_PAGES : WORKDAY_PAGES;
    const wantDays = win ? Math.ceil(win / DAY) + 1 : Infinity;
    const maxAgeDays = [2, 4, 8, 32, 366].find((d) => d >= wantDays) || Infinity;
    for (const kw of keywords) {
      if (Date.now() > deadline) break;
      const key = `boostwd:${tenantSite}:${recent ? "*recent*" + maxAgeDays : norm(kw)}:${filtered ? JSON.stringify(applied) : ""}`;
      let list = await cacheGet(key);
      // Reads the company's list from Workday, until `until`; cached when complete.
      const fetchList = async (until) => {
        const list = [];
        let complete = true;
        // Page 0 first (it carries the total), then the rest in parallel
        // waves of WORKDAY_WAVE, stopping once a wave is past the date window.
        const fetchPage = (page) =>
          postJson(`https://${wdHost}/wday/cxs/${tenant}/${site}/jobs`, {
            appliedFacets: applied || {}, limit: WORKDAY_PAGE, offset: page * WORKDAY_PAGE, searchText: kw,
          });
        const take = (j) => {
          let youngest = Infinity;
          for (const x of (j && j.jobPostings) || []) {
            if (!x || !x.title || !x.externalPath) continue;
            const age = workdayAge(x.postedOn);
            if (age !== null) youngest = Math.min(youngest, age);
            const place = String(x.locationsText || "");
            list.push({
              id: (x.bulletFields && x.bulletFields[0]) || x.externalPath,
              title: x.title,
              company: pretty(tenant),
              locations: !place.trim() || /^\d+ locations?$/i.test(place) ? [] : [place],
              pathPlace: (x.externalPath.split("/")[2] || "").replace(/-/g, " "),
              remote: REMOTE_RE.test(norm(place + " " + (x.remoteType || ""))),
              posted: age === null ? null : Date.now() - age * DAY,
              ageDays: age,
              url: `https://${wdHost}/en-US/${site}${x.externalPath}`,
              platform: "workday",
              board: tenantSite,
              type: x.timeType || "",
              kw: [],
              locFiltered: filtered,
              dayPrecision: true, // Workday only says "Posted Today / 3 Days Ago"
            });
          }
          return youngest;
        };
        const first = Date.now() > until ? null : await fetchPage(0);
        if (!first) complete = false;
        else {
          const total = first.total || 0;
          let youngest = take(first);
          const pages = Math.min(maxPages, Math.ceil(total / WORKDAY_PAGE));
          for (let start = 1; start < pages; start += WORKDAY_WAVE) {
            if (recent && youngest > maxAgeDays) break; // past the date window
            if (Date.now() > until) { complete = false; break; }
            const wave = [];
            for (let pg = start; pg < Math.min(pages, start + WORKDAY_WAVE); pg++) wave.push(fetchPage(pg));
            const res = await Promise.all(wave);
            if (res.some((r) => !r)) complete = false;
            youngest = Infinity;
            for (const r of res) if (r) youngest = Math.min(youngest, take(r));
            if (!complete) break;
          }
        }
        if (complete) await cacheSet(key, list);
        return list;
      };
      if (!list) {
        // An older saved copy answers now; a fresh one loads in the background.
        const stale = await cacheGet(key, STALE_MAX_MS);
        if (stale) {
          list = stale;
          refreshLater(key, () => fetchList(Date.now() + 60000));
        } else {
          list = await fetchList(deadline);
          // Cut off by the time budget: finish it in the background.
          if (Date.now() > deadline) refreshLater(key, () => fetchList(Date.now() + 60000));
        }
      }
      out.push(...list);
    }
    return out;
  }

  // ------------------------------------------------------ smartrecruiters --
  // Public postings API, filtered by country on the server and listed newest
  // first, with exact posting times (good for hour / minute windows).
  const SR_COUNTRY = {
    ireland: "ie", "united kingdom": "gb", uk: "gb", england: "gb", scotland: "gb", wales: "gb", "northern ireland": "gb",
    germany: "de", deutschland: "de", france: "fr", netherlands: "nl", belgium: "be", luxembourg: "lu", spain: "es",
    portugal: "pt", italy: "it", austria: "at", switzerland: "ch", poland: "pl", czechia: "cz", "czech republic": "cz",
    slovakia: "sk", hungary: "hu", romania: "ro", bulgaria: "bg", croatia: "hr", slovenia: "si", greece: "gr",
    cyprus: "cy", malta: "mt", denmark: "dk", sweden: "se", norway: "no", finland: "fi", iceland: "is",
    estonia: "ee", latvia: "lv", lithuania: "lt", liechtenstein: "li", "united states": "us", usa: "us", us: "us",
    canada: "ca", dublin: "ie", cork: "ie", galway: "ie", limerick: "ie", london: "gb", berlin: "de", paris: "fr",
    amsterdam: "nl", madrid: "es", lisbon: "pt", warsaw: "pl", munich: "de",
  };
  // Off until the auto-apply automation supports SmartRecruiters forms; jobs
  // it cannot apply to would only stall the queue.
  const SR_ENABLED = false;
  const SR_PAGE = 100;
  const SR_MAX_PAGES = 8;

  function srCountries(loc) {
    if (!loc) return [null];
    const cc = new Set();
    for (const t of loc.terms) if (SR_COUNTRY[t]) cc.add(SR_COUNTRY[t]);
    return cc.size ? [...cc] : [];
  }

  async function searchSmartRecruiters(company, loc, deadline, win) {
    const countries = srCountries(loc);
    const out = [];
    for (const cc of countries) {
      if (Date.now() > deadline) break;
      const key = `boostsr:${company}:${cc || "*"}`;
      let list = await cacheGet(key);
      if (!list) {
        list = [];
        let complete = true;
        const maxPages = cc ? SR_MAX_PAGES : 3;
        for (let page = 0; page < maxPages; page++) {
          if (Date.now() > deadline) { complete = false; break; }
          const j = await getJson(
            `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${SR_PAGE}&offset=${page * SR_PAGE}` +
              (cc ? `&country=${cc}` : "")
          );
          if (!j || !Array.isArray(j.content)) { complete = page > 0; break; }
          for (const x of j.content) {
            if (!x || !x.id || !x.name) continue;
            const l = x.location || {};
            list.push({
              id: String(x.id),
              title: x.name,
              company: (x.company && x.company.name) || pretty(company),
              locations: [l.fullLocation || [l.city, l.region, l.country].filter(Boolean).join(", ")].filter(Boolean),
              remote: !!l.remote,
              posted: x.releasedDate ? Date.parse(x.releasedDate) || null : null,
              url: `https://jobs.smartrecruiters.com/${company}/${x.id}`,
              platform: "smartrecruiters",
              board: company,
              department: (x.department && x.department.label) || "",
              type: (x.typeOfEmployment && x.typeOfEmployment.label) || "",
              kw: [],
              locFiltered: !!cc,
            });
          }
          if (j.content.length < SR_PAGE || (page + 1) * SR_PAGE >= (j.totalFound || 0)) break;
        }
        if (complete) await cacheSet(key, list);
      }
      out.push(...list);
    }
    return win ? out.filter((x) => x.posted && Date.now() - x.posted <= win) : out;
  }

  // A board list older than CACHE_TTL_MS is still used (up to STALE_MAX_MS)
  // so the first search after a break answers at once from the saved copy,
  // while a fresh copy loads in the background for the next round. Each job
  // keeps its own posting time, so date filters stay exact.
  const STALE_MAX_MS = 48 * 3600 * 1000;
  const REFRESH_CONCURRENCY = 24;
  const refreshQueue = [];
  let refreshing = 0;
  function refreshLater(key, run) {
    if (inflight.has(key) || refreshQueue.some((q) => q[0] === key)) return;
    refreshQueue.push([key, run]);
    pumpRefresh();
  }
  function pumpRefresh() {
    while (refreshing < REFRESH_CONCURRENCY && refreshQueue.length) {
      const [key, run] = refreshQueue.shift();
      if (inflight.has(key)) continue;
      refreshing++;
      const p = run().catch(() => null);
      inflight.set(key, p);
      p.finally(() => {
        inflight.delete(key);
        refreshing--;
        pumpRefresh();
      });
    }
  }

  const inflight = new Map();
  // freshMs: for minute / hour searches, a saved copy older than this cannot
  // hold the newest jobs, so the board is fetched again now (the old copy is
  // used only if the fetch does not answer within a few seconds).
  async function loadBoard(kind, token, freshMs, deadline) {
    const key = `boost:${kind}:${token}`;
    const cached = await cacheGet(key, freshMs || CACHE_TTL_MS);
    if (cached) return cached;
    const fetchFresh = async () => {
      const jobs = await LOADERS[kind](token);
      if (jobs) await cacheSet(key, jobs);
      return jobs || [];
    };
    if (freshMs) {
      const old = await cacheGet(key, STALE_MAX_MS);
      let p = inflight.get(key);
      if (!p) {
        p = fetchFresh().catch(() => null);
        inflight.set(key, p);
        p.finally(() => inflight.delete(key));
      }
      const wait = Math.max(500, Math.min(6000, (deadline || Date.now() + 6000) - Date.now() - 300));
      const got = await Promise.race([p, new Promise((res) => setTimeout(() => res(undefined), wait))]);
      return got || old || []; // no answer in time, or the fetch failed: the saved copy
    }
    if (inflight.has(key)) return inflight.get(key);
    const stale = await cacheGet(key, STALE_MAX_MS);
    if (stale) {
      refreshLater(key, fetchFresh);
      return stale;
    }
    const p = fetchFresh();
    inflight.set(key, p);
    try {
      return await p;
    } finally {
      inflight.delete(key);
    }
  }

  async function greenhouseSkills(job) {
    const key = `boostkw:gh:${job.board}:${job.id}`;
    const cached = await cacheGet(key, KW_TTL_MS);
    if (cached) return cached;
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${job.board}/jobs/${job.id}`);
    const kw = j && j.content ? skillSet(j.content) : [];
    await cacheSet(key, kw);
    return kw;
  }

  // Runs fn over items, `size` at a time, and returns at the deadline even if
  // some requests are still in flight: those finish in the background and
  // land in the cache, so the next search picks them up instantly.
  // Resolves true when every item was started and finished in time.
  async function runPool(items, size, deadline, fn) {
    let i = 0;
    let done = 0;
    const work = Promise.all(
      Array.from({ length: size }, async () => {
        while (i < items.length && Date.now() < deadline) {
          try {
            await fn(items[i++]);
          } catch (e) {}
          done++;
        }
      })
    );
    let timer;
    const late = new Promise((r) => (timer = setTimeout(r, Math.max(0, deadline - Date.now()) + 250)));
    await Promise.race([work, late]);
    clearTimeout(timer);
    return done >= items.length;
  }

  async function loadAll(deadline, keep, freshMs) {
    const learned = await getLearned();
    const tasks = [];
    for (const kind of Object.keys(LOADERS)) {
      const tokens = new Set([...(BASE_BOARDS[kind] || []), ...(learned[kind] || [])]);
      for (const t of tokens) tasks.push([kind, t]);
    }
    const out = [];
    const complete = await runPool(tasks, CONCURRENCY, deadline, async ([kind, t]) => {
      for (const j of await loadBoard(kind, t, freshMs, deadline)) if (!keep || keep(j)) out.push(j);
    });
    return { jobs: out.slice(), boards: tasks.length, complete };
  }

  // Loads every board into the cache in the background while the dashboard
  // is open, so searches read from the cache instead of the network. At most
  // once every WARM_EVERY_MS; boards already fresh in the cache are skipped.
  const WARM_EVERY_MS = 20 * 60 * 1000;
  let warming = null;
  async function warmUp() {
    if (warming) return warming;
    warming = (async () => {
      const s = hasChrome && chrome.storage.session;
      try {
        const last = s ? (await s.get("boostWarmAt")).boostWarmAt : 0;
        if (last && Date.now() - last < WARM_EVERY_MS) return { ok: true, skipped: true };
        if (s) await s.set({ boostWarmAt: Date.now() });
      } catch (e) {}
      await pruneCache();
      const t0 = Date.now();
      const fresh = [];
      const since = Date.now() - 3 * DAY;
      const { boards, complete } = await loadAll(Date.now() + 150000, (j) => {
        if (j.platform === "greenhouse" && j.kw === null && j.posted > since && [...titleWords(j)].some((w) => TECHNICAL_TITLE.has(w))) fresh.push(j);
        return false;
      });
      // Descriptions of new technical jobs, so skill searches ("python",
      // "sql") match from the cache. Cached for KW_TTL_MS; newest first.
      fresh.sort((a, b) => b.posted - a.posted);
      const list = fresh.slice(0, 4000);
      await runPool(list, 16, Date.now() + 150000, async (j) => {
        j.kw = await greenhouseSkills(j);
      });
      return { ok: true, boards, complete, details: list.length, ms: Date.now() - t0 };
    })();
    try {
      return await warming;
    } finally {
      warming = null;
    }
  }

  // --------------------------------------------------------------- search --
  const BOARD_LABEL = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby", rippling: "Rippling", smartrecruiters: "SmartRecruiters", workday: "Workday" };

  // "Posted 42 min ago" / "Posted 5 h ago" / "Posted 3 days ago"
  function postedAgo(j) {
    if (!j.posted) return "";
    const ms = Math.max(0, Date.now() - j.posted);
    if (j.dayPrecision) {
      const d = Math.round(ms / DAY);
      return d <= 0 ? "Posted today" : d === 1 ? "Posted yesterday" : `Posted ${d} days ago`;
    }
    const min = Math.round(ms / 60000);
    if (min < 60) return `Posted ${Math.max(1, min)} min ago`;
    if (min < 48 * 60) return `Posted ${Math.floor(min / 60)} h ${min % 60} min ago`;
    return `Posted ${Math.round(ms / DAY)} days ago`;
  }

  /**
   * Which of these job titles match the searched keywords? Used to drop
   * off-topic results from LazyApply's own server search.
   * @returns {boolean[]} one flag per title
   */
  function filterTitles(keywordList, jobTitles) {
    const compiled = splitKeywords(keywordList).map(compileTitle).filter((m) => m.core.length || m.wantsRole);
    if (!compiled.length) return (jobTitles || []).map(() => true);
    return (jobTitles || []).map((t) => {
      const job = { title: String(t || ""), kw: [] };
      return compiled.some((m) => matchScore(job, m) > 0);
    });
  }

  /**
   * Location and Additional Filters for jobs from LazyApply's own server
   * (which also brings the iCIMS jobs). A job with no location field is
   * placed by its description ("Job Locations US-NE | US-Remote"); with a
   * location searched and no place found in either, it is left out.
   * @param {{title:string, location?:string, description?:string, employment_type?:string}[]} jobs
   * @returns {boolean[]} one flag per job
   */
  function filterJobs(jobs, filters, locations) {
    const f = compileFilters(filters);
    const loc = compileLocation(locations);
    const remoteWanted = !!(f && f.workType === "remote" && loc);
    return (jobs || []).map((j) => {
      if (!j) return true;
      const place = String(j.location || "").trim() || (loc ? String(j.description || "").trim() : "");
      if (loc && !place) return false;
      const job = { title: j.title || "", locations: place ? [place] : [], remote: REMOTE_RE.test(norm(place)), type: j.employment_type || "" };
      if (loc && place && !locationMatches(job.locations, job.remote, loc) && !(remoteWanted && job.remote && remoteOpenTo(job))) return false;
      return filtersAllow(job, f);
    });
  }

  // One key per job, whichever of its links is used.
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

  function splitKeywords(list) {
    return [...new Set(
      (Array.isArray(list) ? list : [list])
        .flatMap((t) => String(t || "").split(/[,;|\n]+/))
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )];
  }

  // "Asks for Python": a searched skill found in the description, not the title.
  function skillNote(j, titles) {
    const tw = titleWords(j);
    const kw = new Set(j.kw || []);
    for (const m of titles) {
      if (m.core.length !== 1 || !SKILLS.has(m.core[0])) continue;
      const alts = SYNONYMS[m.core[0]] || [m.core[0]];
      if (!hasAny(tw, alts) && hasAny(kw, alts)) {
        const w = m.raw.split(/\s+/).find((x) => alts.includes(norm(x))) || m.core[0];
        return "Asks for " + w.charAt(0).toUpperCase() + w.slice(1);
      }
    }
    return "";
  }

  // The place a job card shows: its locations, or the one in its link.
  function shownPlace(j) {
    const l = j.locations.filter((x) => String(x || "").trim());
    return l.length ? l : [(j.pathPlace || "").replace(/\s+/g, " ").trim()];
  }

  function toDashboardJob(j, rank, alsoIn, note) {
    let loc = shownPlace(j).join(" / ");
    // Workday lists only a job's first office ("McLean VA") even when it is
    // also open in the searched place; say so instead of looking wrong.
    if (alsoIn) loc = loc ? `${alsoIn} (also ${loc})` : alsoIn;
    // The site marks the job remote but its place text does not say so.
    if (j.remote && !/remote/i.test(loc)) loc = loc ? "Remote / " + loc : "Remote";
    let host = "";
    try {
      host = new URL(j.url).host;
    } catch (e) {}
    return {
      title: j.title,
      company: j.company,
      location: loc,
      description: [postedAgo(j), note, j.title, j.company, loc, j.department].filter(Boolean).join(" · "),
      date_posted: j.posted ? new Date(j.posted).toISOString().slice(0, 10) : "NA",
      posted_ms: j.posted && !j.dayPrecision ? j.posted : null,
      apply_url: j.url,
      ats_platform: j.platform,
      jobId: j.id,
      jobBoard: BOARD_LABEL[j.platform] || j.platform,
      employment_type: j.type || "",
      department: j.department || "",
      displayed_link: host ? `https://${host} › ${j.board}` : "",
      favicon: host ? `https://www.google.com/s2/favicons?domain=${host}` : "",
      rank,
      page_rank: rank,
      missing: [],
      extended_sitelinks: [],
      source: "lazyapply-search-boost",
    };
  }

  // Round robin across job sites, keeping each site's own order.
  function fairByPlatform(list, siteOf) {
    const groups = new Map();
    for (const x of list) {
      const k = siteOf(x) || "other";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(x);
    }
    if (groups.size < 2) return list;
    const qs = [...groups.values()];
    const out = [];
    for (let i = 0; out.length < list.length; i++) for (const g of qs) if (i < g.length) out.push(g[i]);
    return out;
  }

  /**
   * @param {object} q
   * @param {string[]} q.titles
   * @param {string[]} [q.locations]
   * @param {string}   [q.timeFilter]   qdr:d | qdr:w | qdr:m | qdr:y | all | r86400 ...
   * @param {string[]} [q.companiesToExclude]
   * @param {string[]} [q.excludeUrls]  links the dashboard already has
   * @param {number}   [q.limit]
   */
  async function searchJobs(q) {
    const started = Date.now();
    // q.budgetMs lets the dashboard ask for a quick first answer: boards not
    // loaded by then keep loading into the cache for the next call.
    const budget = Number(q.budgetMs) > 0 ? Math.max(3000, Math.min(TOTAL_BUDGET_MS, Number(q.budgetMs))) : TOTAL_BUDGET_MS;
    const deadline = started + budget;
    // Every comma / semicolon / "|" / new-line separated keyword is its own
    // search term, with no limit on how many: "Python, SQL, Data".
    const keywords = [...new Set(
      (Array.isArray(q.titles) ? q.titles : [q.titles])
        .flatMap((t) => String(t || "").split(/[,;|\n]+/))
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )];
    const titles = keywords.map(compileTitle).filter((m) => m.core.length || m.wantsRole);
    if (!titles.length) return { jobs: [], matched: 0, scanned: 0, boards: 0, ms: 0 };
    const loc = compileLocation(q.locations);
    const flt = compileFilters(q.filters);
    const remoteWanted = !!(flt && flt.workType === "remote" && loc);
    // Minute / hour windows are searched over the past day, then narrowed
    // back below (widened step by step only if the chosen window is empty).
    const asked = windowMs(q.timeFilter);
    const subDay = !!(asked && asked < DAY);
    const win = subDay ? WIDEN_STEPS[WIDEN_STEPS.length - 1] : asked; // room to widen; narrowed below
    // How old a saved board list may be: a third of a minute window (at least
    // 2 minutes), 10 minutes for hour windows, the usual 30 otherwise.
    const fresh = subDay ? (asked <= HOUR ? Math.max(2 * 60000, Math.round(asked / 3)) : 10 * 60000) : 0;
    const now = Date.now();
    const exclude = new Set((q.companiesToExclude || []).map(norm).filter(Boolean));
    const known = new Set((q.excludeUrls || []).map((u) => String(u).split("?")[0] + "?" + (String(u).split("?")[1] || "")));
    const limit = Math.max(1, Math.min(MAX_RESULTS, Number(q.limit) || 100));

    const learnedNow = await getLearned();
    // Workday dates are whole days only, so they cannot be placed inside an
    // hour / minute window: skip it there.
    const allWorkdaySites = [...new Set([...(BASE_BOARDS.workday || []), ...(learnedNow.workday || [])])];
    const workdaySites = allWorkdaySites;
    const workdayJobs = [];
    const workdayRun = runPool(workdaySites, WORKDAY_CONCURRENCY, deadline, async (ts) => {
      for (const j of await searchWorkday(ts, titles.map((m) => m.raw), loc, deadline, win)) workdayJobs.push(j);
    });
    const srCompanies = SR_ENABLED
      ? [...new Set([...(BASE_BOARDS.smartrecruiters || []), ...(learnedNow.smartrecruiters || [])])]
      : [];
    const srJobs = [];
    const srRun = runPool(srCompanies, 10, deadline, async (c) => {
      for (const j of await searchSmartRecruiters(c, loc, deadline, win)) srJobs.push(j);
    });
    // Cheap filters first (applied while boards load, so only these are kept).
    const cheap = (j) =>
        j.url &&
        j.title &&
        !known.has(j.url) &&
        !(exclude.size && exclude.has(norm(j.company))) &&
        // Day-only dates (Workday): "today" / "yesterday" / "N days ago",
        // judged by the day count so a cached copy gives the same answer.
        !(win && (j.dayPrecision && j.ageDays != null ? j.ageDays * DAY > win : !j.posted || now - j.posted > win)) &&
        (j.locFiltered ||
          locationMatches(j.pathPlace ? j.locations.concat(j.pathPlace) : j.locations, j.remote, loc) ||
          (remoteWanted && j.remote && remoteOpenTo(j))) &&
        filtersAllow(j, flt);
    // The same checks against another date window (an hour search widened past a day).
    const cheapFor = (j, w) =>
      j.url &&
      j.title &&
      !known.has(j.url) &&
      !(exclude.size && exclude.has(norm(j.company))) &&
      !(j.dayPrecision && j.ageDays != null ? j.ageDays * DAY > w : !j.posted || now - j.posted > w) &&
      (j.locFiltered ||
        locationMatches(j.pathPlace ? j.locations.concat(j.pathPlace) : j.locations, j.remote, loc) ||
        (remoteWanted && j.remote && remoteOpenTo(j))) &&
      filtersAllow(j, flt);
    const timing = { boardsMs: 0, workdayMs: 0 };
    const tStart = Date.now();
    const [{ jobs: boardJobs, boards, complete }, wdComplete, srComplete] = await Promise.all([
      loadAll(deadline, cheap, fresh).then((r) => ((timing.boardsMs = Date.now() - tStart), r)),
      workdayRun.then((r) => ((timing.workdayMs = Date.now() - tStart), r)),
      srRun,
    ]);
    timing.boardsComplete = complete;
    timing.workdayComplete = wdComplete;
    const partial = !(complete && wdComplete && srComplete);
    const all = boardJobs.concat(workdayJobs.slice(), srJobs.slice());
    const pool = boardJobs.concat(workdayJobs.slice().filter(cheap), srJobs.slice().filter(cheap));

    // Greenhouse lists carry no description; fetch the job page for jobs that
    // could match on skills alone (e.g. "Backend Engineer" for "Python").
    const tix = buildTitleIndex(titles);
    const needDetails = pool.filter((j) => {
      if (j.kw !== null) return false;
      const cands = candidateTitles(tix, j);
      for (const m of cands) if (matchScore(j, m)) return false;
      // A skills-only match needs a technical title; check those few against all titles.
      if (![...titleWords(j)].some((w) => TECHNICAL_TITLE.has(w))) return false;
      return titles.some((m) => couldMatchWithDetails(j, m));
    });
    needDetails.sort((a, b) => (b.posted || 0) - (a.posted || 0));
    timing.details = Math.min(needDetails.length, DETAIL_LIMIT) + "/" + needDetails.length;
    await runPool(needDetails.slice(0, DETAIL_LIMIT), CONCURRENCY, Math.max(Date.now() + 2000, deadline + Math.min(8000, budget / 3)), async (j) => {
      j.kw = await greenhouseSkills(j);
    });

    const picked = [];
    const seen = new Set();
    for (const j of pool) {
      let best = 0;
      for (const m of candidateTitles(tix, j)) best = Math.max(best, matchScore(j, m));
      if (!best) continue;
      const key = norm(j.company) + "|" + norm(j.title) + "|" + norm(j.locations[0] || "");
      const id = jobKey(j.url);
      if (seen.has(key) || seen.has(id)) continue;
      seen.add(key);
      seen.add(id);
      picked.push({ j, best: best + applyBonus(j, now) });
    }

    if (asked && asked <= DAY) picked.sort((a, b) => (b.j.posted || 0) - (a.j.posted || 0) || b.best - a.best);
    else picked.sort((a, b) => b.best - a.best || (b.j.posted || 0) - (a.j.posted || 0));
    // Spread the list across companies: a few roles per company first, the
    // rest after, so one big employer does not fill the whole target.
    const perCompany = new Map();
    const first = [];
    const later = [];
    for (const p of picked) {
      const c = norm(p.j.company);
      const n = (perCompany.get(c) || 0) + 1;
      perCompany.set(c, n);
      (n <= MAX_PER_COMPANY ? first : later).push(p);
    }
    picked.length = 0;
    picked.push(...first, ...later);

    // Minute / hour windows: keep the chosen window when it has jobs;
    // otherwise widen one step at a time so the newest jobs still show.
    let used = asked;
    let final = picked;
    if (subDay) {
      // Only jobs posted inside the chosen window. When it holds fewer than
      // MIN_IN_WINDOW, widen one step at a time (the page says so).
      const steps = [asked, ...WIDEN_STEPS.filter((s) => s > asked)];
      // Under an hour, a job dated only by its last edit (Greenhouse without a
      // first-published time) is not counted as new.
      const inside = (p, s) => !p.j.dayPrecision && p.j.posted && now - p.j.posted <= s && !(s < HOUR && p.j.editedOnly);
      used = steps[steps.length - 1];
      for (const s of steps) {
        if (picked.filter((p) => inside(p, s)).length >= minInWindow(asked, limit)) {
          used = s;
          break;
        }
      }
      // Widened to the whole day: Workday's "posted today" jobs now count.
      if (used >= DAY && !workdaySites.length && Date.now() < deadline) {
        const extra = [];
        await runPool(allWorkdaySites, WORKDAY_CONCURRENCY, deadline, async (ts) => {
          for (const j of await searchWorkday(ts, titles.map((m) => m.raw), loc, deadline, used)) if (cheapFor(j, used)) extra.push(j);
        });
        for (const j of extra) {
          let best = 0;
          for (const m of candidateTitles(tix, j)) best = Math.max(best, matchScore(j, m));
          if (!best) continue;
          const key = norm(j.company) + "|" + norm(j.title) + "|" + norm(j.locations[0] || "");
          if (seen.has(key) || seen.has(j.url)) continue;
          seen.add(key);
          seen.add(j.url);
          picked.push({ j, best: best + applyBonus(j, now) });
        }
      }
      // Newest first. "Posted today" jobs (Workday gives only the day) can
      // only be placed once the window is the whole day.
      final = picked
        // Day-only dates (Workday): "today" fits a 1-day window, "yesterday" a 2-day one, and so on.
        // Under a day, Workday's "posted today" jobs are kept too, after the exactly-timed ones.
        .filter((p) => inside(p, used) || (p.j.dayPrecision && (p.j.ageDays || 0) <= Math.max(0, Math.floor(used / DAY) - 1)))
        .sort((a, b) => (a.j.dayPrecision ? 1 : 0) - (b.j.dayPrecision ? 1 : 0) || (b.j.posted || 0) - (a.j.posted || 0));
    }
    // Every job site gets its share of the list (one from each in turn, each
    // site's own order kept), so a target smaller than the matches never cuts
    // a whole site, such as Workday, out of the results.
    final = fairByPlatform(final, (p) => p.j.platform);
    const placeLabel = loc ? String((q.locations || []).find((l) => String(l || "").trim()) || "").trim() : "";
    const jobs = final.slice(0, limit).map((p, i) =>
      toDashboardJob(
        p.j,
        i + 1,
        loc && p.j.locFiltered && !locationMatches(shownPlace(p.j), p.j.remote, loc) ? placeLabel : "",
        skillNote(p.j, titles)
      )
    );
    return {
      jobs,
      matched: final.length,
      scanned: all.length,
      boards: boards + workdaySites.length + srCompanies.length,
      ms: Date.now() - started,
      partial,
      timing,
      window: subDay ? { askedMs: asked, usedMs: used, widened: used > asked } : null,
    };
  }

  const api = {
    searchJobs,
    filterTitles,
    filterJobs,
    learnFromUrls,
    boardFromUrl,
    warmUp,
    jobKey,
    _internal: { fairByPlatform, siteOf, paused, inUSA, compileTitle, matchScore, buildTitleIndex, candidateTitles, compileLocation, locationMatches, windowMs, skillSet, compileFilters, filtersAllow, remoteOpenTo },
  };

  // Background wiring: requests forwarded from the dashboard page.
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    // Loaded from a folder (no store update_url): when the files in that
    // folder are a newer version than the one running, reload so the new
    // version takes over without a trip to chrome://extensions.
    let lastUpdateCheck = 0;
    const checkForUpdate = () => {
      try {
        const running = chrome.runtime.getManifest();
        if (running.update_url || Date.now() - lastUpdateCheck < 5000) return;
        lastUpdateCheck = Date.now();
        fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" })
          .then((r) => r.json())
          .then((m) => {
            if (m && m.version && m.version !== running.version) chrome.runtime.reload();
          })
          .catch(() => {});
      } catch (e) {}
    };
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!request || !["SEARCH_BOOST", "SEARCH_BOOST_LEARN", "SEARCH_BOOST_FILTER", "SEARCH_BOOST_WARM", "OPEN_ATS_CREDENTIALS"].includes(request.type)) return;
      const origin = (sender && (sender.origin || sender.url)) || "";
      if (!/^https:\/\/(app|beta)\.lazyapply\.com(\/|$)/.test(origin)) return;
      checkForUpdate();
      if (request.type === "OPEN_ATS_CREDENTIALS") {
        try {
          chrome.runtime.openOptionsPage();
        } catch (e) {}
        sendResponse({ ok: true });
        return;
      }
      if (request.type === "SEARCH_BOOST_FILTER") {
        try {
          if (Array.isArray(request.jobs)) sendResponse({ ok: true, keep: filterJobs(request.jobs, request.filters, request.locations) });
          else sendResponse({ ok: true, keep: filterTitles(request.titles, request.jobTitles) });
        } catch (e) {
          sendResponse({ ok: false });
        }
        return;
      }
      if (request.type === "SEARCH_BOOST_WARM") {
        // The reply is held until the warm-up ends, which keeps the worker awake.
        warmUp()
          .then((r) => sendResponse(r))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
      if (request.type === "SEARCH_BOOST_LEARN") {
        learnFromUrls(request.urls)
          .then((added) => sendResponse({ ok: true, added }))
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
      searchJobs(request.query || {})
        .then((res) => sendResponse({ ok: true, version: chrome.runtime.getManifest().version, ...res }))
        .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e), jobs: [] }));
      return true;
    });
  }

  root.LazyApplySearchBoost = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
