// let baseUrl = "";
// let indeedTabId;
// let indeedTabId1;
// let linkedinBaseUrl = "";
// let linkedinTabId;
// let linkedinTabId1;

// let diceTabId1;
// let diceTabId;
// let diceBaseUrl = "";

// let ziprecruiterTabId1;
// let ziprecruiterTabId;
// let ziprecruiterBaseUrl = "";

// let debugObj = {};
// let datamainlinkedin = {};
// let userDetails = {};
// let uploadapidebug = null;
// let uploadapitoken = null;
// let debugSessionJobs = [];
// let globalTabId = null;

// Debugger: records everything the extension does (see debugRecorder.js).
// Loaded first so its hooks see all that follows.
try {
  importScripts("debugCore.js", "debugRecorder.js");
} catch (error) {
  console.error("Debugger failed to load", error);
}
// Extra job source for the dashboard search (see searchBoost.js).
try {
  importScripts("searchBoostBoards.js", "searchBoost.js");
} catch (error) {
  console.error("Search boost failed to load", error);
}
// Optional LeadOcean contact finder for referral emails (see leadOcean.js).
try {
  importScripts("emailVars.js", "leadOcean.js", "ownMail.js");
} catch (error) {
  console.error("LeadOcean finder failed to load", error);
}
// What happened to every job of a run (see runReport.js).
try {
  importScripts("runReport.js");
} catch (error) {
  console.error("Run report failed to load", error);
}
// Several tabs applying at once for long job lists (see parallelApply.js).
try {
  importScripts("parallelApply.js");
} catch (error) {
  console.error("Parallel applying failed to load", error);
}

const indeedString = "||indeed.com/cdn-cgi";
// const mainurl = "https://app.lazyapply.com";
const mainurl = "https://app.lazyapply.com";

console.log = function () {};
console.info = function () {};

// Messages are often sent to tabs that have already closed or reloaded.
// Those rejections are expected; swallow them so real errors stay visible.
self.addEventListener("unhandledrejection", (event) => {
  const text = String(event?.reason?.message || event?.reason || "");
  if (
    text.includes("Receiving end does not exist") ||
    text.includes("message port closed") ||
    text.includes("No tab with id") ||
    text.includes("message channel closed")
  ) {
    event.preventDefault();
  }
});

console.log("mainurl", mainurl, indeedString);
let uamain =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";
// let uamain = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36";
// "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36";
let DEFAULT_UA = navigator.userAgent;
let CUSTOM_UA = DEFAULT_UA;
// window.confirm = () => true;
// if (confirm("OK?")) {
//   console.log("Going...");
// }
let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
/**
 * Retrieve object from Chrome's Local StorageArea
 * @param {{string or array of string keys}} keys
 */
async function getObjectFromLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.get(keys, function (values) {
        resolve(values);
      });
    } catch (ex) {
      reject(ex);
    }
  });
}

/**
 * Save Object in Chrome's Local StorageArea
 * @param {*} obj
 */
async function saveObjectInLocalStorage(obj) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.set(obj, function () {
        resolve();
      });
    } catch (ex) {
      reject(ex);
    }
  });
}

/**
 * Removes Object from Chrome Local StorageArea.
 *
 * @param {string or array of string keys} keys
 */
async function removeObjectFromLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    try {
      chrome.storage.local.remove(keys, function () {
        resolve();
      });
    } catch (ex) {
      reject(ex);
    }
  });
}

chrome.action.onClicked.addListener(function (tab) {
  console.log(tab);
  console.log("tabid-- " + tab.id);
  chrome.storage.local.set({ maintabid: tab.id }, () => {
    chrome.tabs.create({
      url: mainurl,
      active: true,
    });
  });
});

//uninstall url
chrome.runtime.setUninstallURL(
  "https://docs.google.com/forms/d/e/1FAIpQLSesSYraSHOupjdTFX6NNUC9o65SZ3o46A_E6m6QErBgmEbogQ/viewform",
  () => {
    console.log("extension uninstalled");
  }
);

function parseJwt(token) {
  var base64Url = token.split(".")[1];
  var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  var jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map(function (c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join("")
  );

  return jsonPayload;
}

// After an update or reload, open dashboard tabs still run the previous copy
// of the bridge, which can no longer reach the extension (searches lose the
// extra jobs, and Save in "Applications Account" cannot store anything).
// Give those tabs a fresh copy so they keep working without a page reload.
function refreshDashboardTabs() {
  try {
    chrome.tabs.query({ url: ["https://app.lazyapply.com/*", "https://beta.lazyapply.com/*"] }, (tabs) => {
      if (chrome.runtime.lastError || !tabs) return;
      for (const t of tabs) {
        chrome.scripting
          .executeScript({ target: { tabId: t.id }, files: ["searchBoostBridge.js"] })
          .catch(() => {});
      }
    });
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(function (details) {
  if (details.reason !== "install") refreshDashboardTabs();
  if (details.reason == "install") {
    chrome.tabs.create({
      url: mainurl,
      active: true,
    });
    console.log("This is a first install!");
  } else if (details.reason == "update") {
    var thisVersion = chrome.runtime.getManifest().version;
    console.log(
      "Updated from " + details.previousVersion + " to " + thisVersion + "!"
    );
    chrome.storage.local.set({
      version: thisVersion,
      previousVersion: details.previousVersion,
    });
  }
});

function resetVariables() {
  resetUA(indeedString);
  // linkedinTabId = undefined;
  // linkedinTabId1 = undefined;
  // linkedinBaseUrl = "";
  // indeedTabId = undefined;
  // indeedTabId1 = undefined;
  // baseUrl = "";
  // ziprecruiterTabId = undefined;
  // ziprecruiterTabId1 = undefined;
  // ziprecruiterBaseUrl = "";
  // debugObj = {};
  // debugSessionJobs = [];
  // userDetails = {};
}

function globalReset() {
  resetUA(indeedString);
  console.log("Global Reset");
  chrome?.power?.releaseKeepAwake();
  chrome.storage.local.set(
    {
      excludeKeywords: [],
      mayIncludeKeywords: [],
      uniquesessionid: null,
      linkedinSessionId: null,
      sessionIdSaved: null,
      linkedinb: 0,
      linkedinData: {},
      linkedinJobLinks: [],
      linkedinLinkNo: 0,
      linkedinLimit: 0,
      linkedinBaseUrl: "",
      linkedinFetchFilters: 0,
      linkedinSkipState: false,
      linkedinPause: false,

      glassdoorSessionId: null,
      glassdoorFetchFilters: 0,
      glassdoorFiltersSet: 0,
      glassdoorSetFilters: null,
      glassdoorJobLinks: [],
      glassdoorLocation: "",
      glassdoorBaseUrl: "",
      glassdoorLimit: 0,
      glassdoorResumeUrlId: "",
      glassdoorLinkNo: 0,
      glassdoorPageNumber: 1,
      glassdoorb: 0,

      diceResumeId: "",
      diceb: 0,
      diceSessionId: null,
      diceData: {},
      diceJobLinks: [],
      diceLinkNo: 0,
      diceLimit: 0,
      diceBaseUrl: "",
      diceFetchFilters: 0,

      simplyHiredResumeId: "",
      simplyHiredb: 0,
      simplyHiredSessionId: null,
      simplyHiredLocation: "",
      simplyHiredData: {},
      simplyHiredJobLinks: [],
      simplyHiredLinkNo: 0,
      simplyHiredLimit: 0,
      simplyHiredBaseUrl: "",
      simplyHiredFetchFilters: 0,
      closedUrl: "",

      seekSessionId: null,
      seekFetchFilters: 0,
      seekJobLinks: [],
      seekLocation: "",
      seekBaseUrl: "",
      seekLimit: 0,
      seekLinkNo: 0,
      seekPageNumber: 1,
      seekb: 0,

      careerBuilderSessionId: null,
      careerBuilderFetchFilters: 0,
      careerBuilderJobLinks: [],
      careerBuilderLocation: "",
      careerBuilderBaseUrl: "",
      careerBuilderLimit: 0,
      careerBuilderLinkNo: 0,
      careerBuilderPageNumber: 1,
      careerBuilderb: 0,

      monsterSessionId: null,
      monsterFetchFilters: 0,
      monsterJobLinks: [],
      monsterLocation: "",
      monsterBaseUrl: "",
      monsterLimit: 0,
      monsterLinkNo: 0,
      monsterPageNumber: 1,
      monsterb: 0,
      monsterProgrammaticRemoval: false,

      indeedSessionId: null,
      data: {},
      jobLinks: [],
      linkNo: 0,
      limit: 0,
      fetchFilters: 0,
      baseURL: "",
      indeedFiltersSet: 0,
      indeedFiltersToApply: {},
      filtersApplied: {},
      indeedSetFilters: null,

      ziprecruiterSessionId: null,
      ziprecruiterb: 0,
      ziprecruiterData: {},
      ziprecruiterJobLinks: [],
      ziprecruiterLinkNo: 0,
      ziprecruiterApplyButtonsLength: 0,
      ziprecruiterLimit: 0,
      ziprecruiterBaseUrl: "",
      ziprecruiterApplyButtons: [],
      ziprecruiterPause: false,
    },
    () => {
      console.log("storage resetted");
    }
  );
}

async function saveSession(platformName) {
  getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
    console.log(platformName, "saveSession");
    if (platformName === "linkedin") {
      console.log("platform is linkedin");
      chrome.runtime.sendMessage({
        linkedin: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          linkedin: "true",
          message: "applypage",
          message2: "completed",
        });
    }
    if (platformName === "dice") {
      console.log("platform is dice");
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          dice: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "ziprecruiter") {
      console.log("platform is ziprecruiter");
      chrome.runtime.sendMessage({
        ziprecruiter: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          ziprecruiter: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "glassdoor") {
      console.log("platform is glassdoor");
      chrome.runtime.sendMessage({
        glassdoor: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          glassdoor: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "seek") {
      console.log("platform is seek");
      chrome.runtime.sendMessage({
        seek: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          seek: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "careerBuilder") {
      console.log("platform is careerBuilder");
      chrome.runtime.sendMessage({
        careerBuilder: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          careerBuilder: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "monster") {
      console.log("platform is monster");
      chrome.runtime.sendMessage({
        monster: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          monster: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "foundit") {
      console.log("platform is foundit");
      chrome.runtime.sendMessage({
        foundit: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          foundit: "true",
          message: "applypage",
          message2: "completed",
        });
    } else if (platformName === "simplyHired") {
      console.log("platform is simplyHired");
      chrome.runtime.sendMessage({
        simplyHired: "true",
        message: "applypage",
        message2: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          simplyHired: "true",
          message: "applypage",
          message2: "completed",
        });
    } else {
      chrome.runtime.sendMessage({
        indeed: "true",
        message: "completed",
      });
      if (storageResult.globalTabId)
        chrome.tabs.sendMessage(storageResult.globalTabId, {
          indeed: "true",
          message: "completed",
        });
    }
  });
}

// const saveSessionDebug = (obj, platform) => {
//   const api = obj.api;
//   const token = obj.token;
//   delete obj["api"];
//   delete obj["token"];
//   const body = {
//     email: obj.email,
//     sessionId: obj.sessionId,
//     sessionData: obj[obj.sessionId],
//     datamainlinkedin: datamainlinkedin,
//     restartSession: {
//       jobs: debugSessionJobs,
//       email: obj.email,
//       sessionId: obj.sessionId,
//       platformName: platform,
//     },
//   };

//   console.info("finalapicall", datamainlinkedin);
//   fetch(api, {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: `Bearer ${token}`,
//     },
//     body: JSON.stringify(body),
//   })
//     .then((response) => {
//       if (!response.ok) {
//         throw new Error("Network response was not ok");
//       }
//       console.log("success");
//     })
//     .catch((error) => {
//       console.log(error.message, "error in getting company emails");
//     });
// };

let closedTabId = "";
chrome.tabs.onRemoved.addListener(async (tabCurrent, removed) => {
  getObjectFromLocalStorage([
    "globalTabId",
    "linkedinTabId",
    "diceTabId",
    "ziprecruiterTabId",
    "indeedTabId",
    "indeedTabId1",
    "glassdoorTabId",
    "seekTabId",
    "careerBuilderTabId",
    "monsterTabId",
    "founditTabId",
    "simplyHiredTabId",
    "monsterProgrammaticRemoval",
  ]).then((storageResult) => {
    console.log(
      "tab closed",
      tabCurrent,
      storageResult.linkedinTabId,
      "tab closed"
      // datamainlinkedin
    );
    if (
      storageResult.linkedinTabId &&
      tabCurrent == storageResult.linkedinTabId
    ) {
      console.log("Resetting linkedin");
      chrome?.power?.releaseKeepAwake();
      saveSession("linkedin");
      // saveSessionDebug(debugObj, "linkedin");
      resetVariables();
      globalReset();
    } else if (
      storageResult.diceTabId &&
      tabCurrent == storageResult.diceTabId
    ) {
      console.log("Resetting dice");
      chrome?.power?.releaseKeepAwake();
      saveSession("dice");
      resetVariables();
      globalReset();
    } else if (
      storageResult.ziprecruiterTabId &&
      tabCurrent == storageResult.ziprecruiterTabId
    ) {
      console.log("Resetting ziprecruiter");
      chrome?.power?.releaseKeepAwake();
      saveSession("ziprecruiter");
      resetVariables();
      globalReset();
    } else if (
      storageResult.glassdoorTabId &&
      tabCurrent == storageResult.glassdoorTabId
    ) {
      console.log("Resetting glassdoor");
      chrome?.power?.releaseKeepAwake();
      saveSession("glassdoor");
      resetVariables();
      globalReset();
    } else if (
      storageResult.seekTabId &&
      tabCurrent == storageResult.seekTabId
    ) {
      console.log("Resetting seek");
      chrome?.power?.releaseKeepAwake();
      saveSession("seek");
      resetVariables();
      globalReset();
    } else if (
      storageResult.careerBuilderTabId &&
      tabCurrent == storageResult.careerBuilderTabId
    ) {
      console.log("Resetting careerBuilder");
      chrome?.power?.releaseKeepAwake();
      saveSession("careerBuilder");
      resetVariables();
      globalReset();
    } else if (
      storageResult.monsterTabId &&
      tabCurrent == storageResult.monsterTabId
    ) {
      if (!storageResult.monsterProgrammaticRemoval) {
        console.log("Resetting monster");
        chrome?.power?.releaseKeepAwake();
        saveSession("monster");
        resetVariables();
        globalReset();
      } else {
        let sampleObject = {
          monsterProgrammaticRemoval: false,
        };
        saveObjectInLocalStorage(sampleObject);
      }
    } else if (
      storageResult.founditTabId &&
      tabCurrent == storageResult.founditTabId
    ) {
      console.log("Resetting foundit");
      chrome?.power?.releaseKeepAwake();
      saveSession("foundit");
      resetVariables();
      globalReset();
    } else if (
      storageResult.simplyHiredTabId &&
      tabCurrent == storageResult.simplyHiredTabId
    ) {
      console.log("Resetting simplyHired");
      chrome?.power?.releaseKeepAwake();
      saveSession("simplyHired");
      resetVariables();
      globalReset();
    } else if (
      storageResult.indeedTabId &&
      tabCurrent == storageResult.indeedTabId
    ) {
      console.log("Resetting indeed");
      chrome?.power?.releaseKeepAwake();
      saveSession("indeed");
      // saveSessionDebug(debugObj, "indeed");
      resetVariables();
      globalReset();
    } else if (
      storageResult.indeedTabId1 &&
      tabCurrent == storageResult.indeedTabId1
    ) {
      resetUA(indeedString);
    } else if (
      storageResult.globalTabId != null &&
      tabCurrent == storageResult.globalTabId
    ) {
      console.log("globaltabclose");
      resetVariables();
      globalReset();
      // globalTabId = null;
      chrome.storage.local.set(
        {
          globalTabId: null,
        },
        () => {
          console.log("storage resetted");
        }
      );
    }
  });

  const state = await chrome.storage.local.get([
    "automationTabId",
    "applicationState",
    "automationTabId1",
    "scrapingStarted",
  ]);
  if (
    tabCurrent === state.automationTabId &&
    state.applicationState?.isAutomationActive
  ) {
    console.log("Automation tab was closed midway");
    await handleAutomationInterrupted(state.applicationState);
    return true;
  }
  if (
    closedTabId != "" &&
    closedTabId === tabCurrent &&
    state.applicationState?.isAutomationActive
  ) {
    console.log("Automation tab was closed midway");
    await handleAutomationInterrupted(state.applicationState);
    return true;
  }
  if (tabCurrent === state.automationTabId1 && state.scrapingStarted) {
    console.log("Automation scanning tab was closed miday");
    await handleAutomationScanningInterrupted();
    return true;
  }
});

async function updateUrl(link, message2) {
  getObjectFromLocalStorage(["globalTabId", "indeedTabId"]).then(
    (storageResult) => {
      if (link == "index.html") {
        chrome.tabs.remove(parseInt(storageResult.indeedTabId), function () {
          console.log("Finally Completed");
          if (message2 == "unauthorized") {
            if (storageResult.globalTabId)
              chrome.tabs.sendMessage(storageResult.globalTabId, {
                message: "unauthorized",
              });
            chrome.runtime.sendMessage({ message: "unauthorized" });
          } else chrome.runtime.sendMessage({ message: "completed" });
        });
      } else {
        // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        //   var currTab = tabs[0];
        //   if (currTab) {
        //     // Sanity check
        //     /* do stuff */
        //     console.log(currTab);
        chrome.tabs.update(parseInt(storageResult.indeedTabId), {
          active: true,
          url: link,
          active: true,
        });
        // }
        // });
      }
    }
  );
}

function updateUrlDebug(link, debugTabId, message, platform) {
  if (link == "index.html") {
    chrome.tabs.remove(parseInt(debugTabId), function () {
      resetVariables();
      globalReset();
      chrome.runtime.sendMessage({ [platform]: true, message });
    });
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var currTab = tabs[0];
      console.log("tabid", currTab);
      if (currTab) {
        chrome.tabs.update(parseInt(debugTabId), {
          active: true,
          url: link,
          active: true,
        });
      }
    });
  }
}

function executeScripts(
  tabId,
  injectDetailsArray,
  callBackFn = null,
  frameIds = []
) {
  // The application script and its panel keep their progress in shared keys;
  // workerShim.js (first) gives each parallel-applying tab its own copy.
  if (
    Array.isArray(injectDetailsArray) &&
    injectDetailsArray.some((d) => d && /^(atsAutomation|autoFillTemplate)\.bundle\.js$|^inject-autofill-template\.js$/.test(d.file)) &&
    !injectDetailsArray.some((d) => d && d.file === "workerShim.js")
  ) {
    injectDetailsArray = [{ file: "workerShim.js" }].concat(injectDetailsArray);
  }
  // Debugger page recorder first, so it sees everything the scripts do.
  if (Array.isArray(injectDetailsArray) && injectDetailsArray.length && !injectDetailsArray.some((d) => d && d.file === "debugHook.js")) {
    injectDetailsArray = [{ file: "debugCore.js" }, { file: "debugHook.js" }].concat(injectDetailsArray);
  }
  // atsControls.js (before the application script) supplies its safer Workday controls.
  if (
    Array.isArray(injectDetailsArray) &&
    injectDetailsArray.some((d) => d && d.file === "atsAutomation.bundle.js") &&
    !injectDetailsArray.some((d) => d && d.file === "atsControls.js")
  ) {
    const at = injectDetailsArray.findIndex((d) => d && d.file === "atsAutomation.bundle.js");
    injectDetailsArray = injectDetailsArray.slice(0, at).concat([{ file: "atsControls.js" }], injectDetailsArray.slice(at));
  }
  function createCallback(tabId, injectDetails, innerCallback) {
    const src = chrome.runtime.getURL(injectDetails.file);
    console.log("src", src, injectDetails.file);
    return function () {
      const next = function () {
        // Reading lastError marks it as handled; one failed file must not
        // stop the rest of the chain.
        if (chrome.runtime.lastError) {
          console.warn(
            "Injection failed for",
            injectDetails.file,
            chrome.runtime.lastError.message
          );
        }
        if (typeof innerCallback === "function") innerCallback();
      };
      // Stylesheets cannot be run as scripts; skip them instead of erroring.
      if (/\.css$/i.test(injectDetails.file)) {
        next();
        return;
      }
      // The panel's own <style> tags get thrown away by sites that rebuild
      // their page (Greenhouse confirmation pages, for one), leaving it as
      // plain text. A copy added through insertCSS is not part of the page,
      // so nothing the site does can remove it.
      if (injectDetails.file === "autoFillTemplate.bundle.js") {
        try {
          chrome.scripting.insertCSS(
            { target: { tabId: tabId, frameIds: frameIds.length > 0 ? frameIds : [0] }, files: ["panelStyles.css"] },
            function () { void chrome.runtime.lastError; }
          );
        } catch (e) {}
      }
      try {
        chrome.scripting.executeScript(
          {
            world: "ISOLATED",
            target: {
              tabId: tabId,
              frameIds: frameIds.length > 0 ? frameIds : [0],
            },
            files: [injectDetails.file],
            injectImmediately: true, // Chrome 102+
          },
          next
        );
      } catch (error) {
        console.warn("Injection threw for", injectDetails.file, error);
        if (typeof innerCallback === "function") innerCallback();
      }
    };

    // return function () {
    //   chrome.tabs.executeScript(tabId, injectDetails, innerCallback);
    // };
  }

  var callback = callBackFn;
  for (var i = injectDetailsArray.length - 1; i >= 0; --i)
    callback = createCallback(tabId, injectDetailsArray[i], callback);

  if (callback !== null) callback(); // execute outermost function
}

const allUrls = [
  // "*://recruiting.adp.com/srccar/public/*?appUI*",
  // "*://recruiting.adp.com/srccar/public/*&appUI=*",
  // "*://*.amazon.jobs/*/apply*",
  // "*://*.amazonuniversity.jobs/profile*",
  // "*://jobs.apple.com/*/*",
  // "*://*.avature.net/*/ApplicationForm*",
  // "*://*.avature.net/*/ApplicationMethods*",
  // "*://*.avature.net/*/ApplicationQuestions*",
  // "*://*.avature.net/*/Register*",
  // "*://*.avature.net/campusApply*",
  // "*://*.avature.net/*/GeneralInfo*",
  // "*://*.bamboohr.com/jobs*",
  // "*://*.bamboohr.com/careers/*",
  // "*://*.brassring.com/*Applypage",
  // "*://*.brassring.com/TGNewUI/Profile/Home/ProfileBuilder*",
  // "*://*.breezy.hr/*/apply*",
  // "*://*.comeet.com/jobs/*/*/*/*",
  // "*://*.comeet.co/jobs/*/*/apply*",
  // "*://*/**gh_jid**",
  // "*://recruiting.adp.com/srccar/public/*?appUI*",
  // "*://recruiting.adp.com/srccar/public/*&appUI=*",
  // "*://*.amazon.jobs/*/apply*",
  // "*://*.amazonuniversity.jobs/profile*",
  // "*://jobs.apple.com/*/*",
  // "*://*.avature.net/*/ApplicationForm*",
  // "*://*.avature.net/*/ApplicationMethods*",
  // "*://*.avature.net/*/ApplicationQuestions*",
  // "*://*.avature.net/*/Register*",
  // "*://*.avature.net/campusApply*",
  // "*://*.avature.net/*/GeneralInfo*",
  // "*://*.bamboohr.com/jobs*",
  // "*://*.bamboohr.com/careers/*",
  // "*://*.brassring.com/*Applypage",
  // "*://*.brassring.com/TGNewUI/Profile/Home/ProfileBuilder*",
  // "*://*.breezy.hr/*/apply*",
  // "*://*.comeet.com/jobs/*/*/*/*",
  // "*://*.comeet.co/jobs/*/*/apply*",
  // "*://*/**gh_jid**",
  // "*://jobs.ashbyhq.com/*",
  // "*://*.freshteam.com/jobs/*",
  // "*://boards.eu.greenhouse.io/*",
  // "*://boards.greenhouse.io/*",
  // "*://job-boards.greenhouse.io/*",
  // "*://jobs.workable.com/*",
  // "*://*.uber.com/careers/apply*",
  // "*://ats.rippling.com/*",
  // "*://wellfound.com/*",
  // "*://job-boards.greenhouse.io/*",
  // "*://jobs.workable.com/*",
  // "*://*.uber.com/careers/apply*",
  // "*://ats.rippling.com/*",
  // "*://wellfound.com/*",
  // "*://careers.jobscore.com/apply_flow/*",
  // "*://careers.jobscore.com/careers/*/jobs/*",
  // "*://careers.jobscore.com/*/*/*apply*job_id=*",
  // "*://*.recruitee.com/*/c/new*",
  // "*://jobs.lever.co/*",
  // "*://jobs.jobvite.com/*/apply*",
  // "*://jobs.dropbox.com/listing/*/apply*",
  // "*://careers.withwaymo.com/jobs/*",
  // "https://vivahr.com/careers/#/apply_job/*",
  // "https://recruitcrm.io/apply/*",
  // "*://jobs.lever.co/*",
  // "*://jobs.jobvite.com/*/apply*",
  // "*://jobs.dropbox.com/listing/*/apply*",
  // "*://careers.withwaymo.com/jobs/*",
  // "https://vivahr.com/careers/#/apply_job/*",
  // "https://recruitcrm.io/apply/*",
  // "*://jobs.workable.com/search?*selectedJobId=*",
  // "*://careers.gohire.io/",
  "https://ats.rippling.com/*/*/jobs/*/*",
  "https://ats.rippling.com/*/jobs/*/*",
  "https://ats.rippling.com/*/*/jobs/*",
  "https://ats.rippling.com/*/jobs/*",
  "https://jobs.lever.co/*/*/*",
  "https://jobs.lever.co/*/*",
  "https://jobs.ashbyhq.com/*/*/*",
  "https://jobs.ashbyhq.com/*/*",
  "https://jobs.vivahr.com/*/*/*",
  "https://jobs.vivahr.com/*/*",
  "https://job-boards.greenhouse.io/*/jobs/*",
  "https://job-boards.greenhouse.io/*",
  "https://boards.greenhouse.io/*/jobs/*",
  "https://boards.greenhouse.io/*",
  "https://wellfound.com/jobs/*",
  "https://*.icims.com/jobs/*/*/job*",
  "https://*.icims.com/jobs/*/*/login",
  "https://*.icims.com/jobs/*/*/candidate*",
  "https://*.icims.com/jobs/*/*/questions*",
  "https://login.icims.com/u/login/password*",
  "https://*.myworkdayjobs.com/en-US/*/job/*",
  "https://*.myworkdayjobs.com/en-US/*/login*",
  "https://*.myworkdayjobs.com/en-US/*/job/*/apply/autofillWithResume",
  "https://*.myworkdayjobs.com/en-US/*/job/*/*/apply/autofillWithResume",
  // "https://recruitcrm.io/apply/*/*",
  // "*://www.linkedin.com/jobs/view/*",
  // // "*://in.indeed.com/viewjob*",
  // "*://smartapply.indeed.com/beta/indeedapply/*",
  // // "*://www.linkedin.com/jobs/*",
  // // "*://*.indeed.com/viewjob*",
  // // "*://*.indeed.com/jobs?*",
  // "*://*.linkedin.com/jobs/collections/*",
  // // "*://*.linkedin.com/jobs/*",
  // "*://*.linkedin.com/jobs/view/*",
  // "*://jobs.dropbox.com/listing/*/apply*",
  // "*://*.icims.com/jobs/*/*/candidate*",
  // "*://*.icims.com/jobs/*/*/eeo*",
  // "*://*.icims.com/jobs/*/*/form*",
  // "*://*.icims.com/jobs/*/*/questions*",
  // "*://*.icims.com/forms*",
  // "*://*.applytojob.com/apply/*/*",
  // "*://jobs.jobvite.com/*/apply*",
  // "*://jobs.lever.co/*",
  // "*://jobs.eu.lever.co/*/*",
  // "*://*.facebookcareers.com/*",
  // "*://*.metacareers.com/*",
  // "*://www.okta.com/company/careers/*/*",
  // "*://*.pinpointhq.com/*/postings/*",
  // "*://*.pinpointhq.com/postings/*",
  // "*://jobs.polymer.co/*/*",
  // "https://careers.bullhorn.com/us/en/apply?*",
  // "*://*.rippling-ats.com/job/*/*",
  // "*://*.rippling-ats.com/jobs/eop_survey/*",
  // "*://jobs.roblox.com/careers*",
  // "*://jobs.smartrecruiters.com/oneclick-ui/company/*",
  // "*://*.successfactors.com/*",
  // "*://*.successfactors.eu/*",
  // "*://*.sapsf.com/career?*",
  // "*://*.sapsf.com/portalcareer?_s.crb=*",
  // "*://*.taleo.net/*/application.jss*",
  // "*://*.taleo.net/*/flow.jsf*",
  // "*://*.taleo.net/*/jobapply*",
  // "*://*.taleo.net/*/ats/careers/*",
  // "*://*.taleo.net/*/htmlResourceViewer.jss*",
  // // "*://*.uber.com/careers/apply*",
  // "*://waymo.com/joinus/*",
  // "*://apply.workable.com/*",
  // "*://jobs.workable.com/search?*selectedJobId=*",
  // // "*://*.myworkdayjobs.com/*/apply*",
  // "*://*.myworkdaysite.com/*/apply*",
  // "*://*.joinhandshake.com/stu/jobs/*",
  // "*://*.joinhandshake.com/stu/postings*",
  // "*://*.indeed.com/m/basecamp/viewjob*",
  // "*://*.indeed.com/viewjob*",
  // "*://*.indeed.com/jobs?*",
  // "*://*.linkedin.com/jobs/collections/*",
  // "*://*.linkedin.com/jobs/search/*",
  // "*://*.linkedin.com/jobs/view/*",
  // "*://app.otta.com/dashboard/jobs*",
  // "*://app.otta.com/jobs*",
  // "*://*oraclecloud.com/*/apply*",
];

const allExcludedUrls = [
  "*://*.breezy.hr/*/submitted*",
  "*://boards.greenhouse.io/*/confirmation",
  "*://*.uber.com/careers/apply/dashboard/*",
  "*://*.facebookcareers.com/*/response*",
  "*://*.metacareers.com/*/response*",
  "*://jobs.jobvite.com/*/applyConfirmation*",
  "*://*.avature.net/*/SuccessfulRegistration",
];

// Retrieve the CSRF token from the JSESSIONID cookie
async function getCsrfToken() {
  const cookies = await chrome.cookies.getAll({
    url: "https://www.linkedin.com",
    name: "JSESSIONID",
  });

  if (cookies.length > 0) {
    const csrfToken = cookies[0].value.replace(/"/g, "");
    return csrfToken;
  }

  return null;
}

// Workday links without "/en-US/" (e.g. /en-GB/..., or no language at all) were
// skipped: the application script only runs on /en-US/ pages, and it reads
// English button text. Open every Workday job in its English (US) form.
function workdayEnglishUrl(link) {
  try {
    const u = new URL(link);
    if (!/\.myworkdayjobs\.com$/i.test(u.hostname)) return link;
    const parts = u.pathname.split("/").filter(Boolean);
    if (!parts.length) return link;
    if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0])) {
      if (parts[0] === "en-US") return link;
      parts[0] = "en-US";
    } else parts.unshift("en-US");
    u.pathname = "/" + parts.join("/");
    return u.toString();
  } catch (e) {
    return link;
  }
}

function processUrl(url, tabId) {
  if (url && url.includes("LeverAppId=")) {
    console.log("Found LeverAppId URL:", url);
    try {
      const urlObj = new URL(url);
      const leverAppId = urlObj.searchParams.get("LeverAppId");
      const matchesExcludePattern = allUrls.some((pattern) => {
        const regexPattern = pattern
          .replace(/\*/g, "[^/]+")
          .replace(/\//g, "\\/")
          .replace(/\./g, "\\.");

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(url);
      });

      if (leverAppId && leverAppId.trim() !== "" && !matchesExcludePattern) {
        console.log("Valid URL found:", url);
        executeScripts(
          tabId,
          [
            { file: "jquery.min.js" },
            { file: "atsAutomation.bundle.js" },
            { file: "debug.bundle.js" },
          ],
          () => {
            console.log("Autofill Added");
          }
        );
      }
    } catch (error) {
      console.error("Error processing URL:", error);
    }
  }
}

let timeoutCheckInterval = null;
const JOB_TIMEOUT_ALARM = "lazyapply-job-timeout";
let jobTimeoutCheckRunning = false;

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One pass of the stuck-job check. Moves the automation on to the next job
// when the current one has been open longer than its timeout.
async function checkJobTimeout() {
  if (jobTimeoutCheckRunning) return;
  jobTimeoutCheckRunning = true;
  try {
    const timeoutInfo = await chrome.storage.local.get("jobTimeoutSet");
    if (!timeoutInfo?.jobTimeoutSet) return;

    const { time, jobIndex, timeoutMs } = timeoutInfo.jobTimeoutSet;
    if (!(Date.now() - time > timeoutMs)) return;

    console.log(
      `Job at index ${jobIndex} has exceeded timeout of ${
        timeoutMs / 1000
      } seconds`
    );

    let state = await chrome.storage.local.get("applicationState");
    // Make sure we're still on the same job
    if (state?.applicationState?.currentIndex !== jobIndex) return;

    await moveOnFromJob(jobIndex, { main: "Application took too long", status: "timeout", list: "timedOutLinks" });
  } catch (error) {
    console.error("Error in timeout monitoring:", error);
  } finally {
    jobTimeoutCheckRunning = false;
  }
}

// Leaves job `jobIndex` (marked with opts.status, recorded in opts.list) and
// opens the next one, or ends the run after the last.
async function moveOnFromJob(jobIndex, opts) {
  {
    const tabState = await chrome.storage.local.get("automationTabId");
    // Debugger: the page as it was when the job was left.
    if (self.LazyDebug && tabState.automationTabId) await self.LazyDebug.snapshot(tabState.automationTabId, "Before leaving job: " + opts.main);

    // Show message to user
    if (tabState.automationTabId) {
      chrome.tabs
        .sendMessage(tabState.automationTabId, {
          type: "AUTOMATION_CONTROL_MESSAGE",
          message: {
            automationControlMessageMain: opts.main,
            automationControlMessage: "Moving to the next job...",
            automationControlProgressBar: false,
          },
        })
        .catch(() => {});
    }

    // Let the user see the message
    await sleepMs(1000);

    // Re-read the state: the job may have finished during the wait, and
    // writing back the old copy would undo that progress.
    const state = await chrome.storage.local.get("applicationState");
    const applicationState = state?.applicationState;
    if (!applicationState || applicationState.currentIndex !== jobIndex) {
      return false;
    }

    await chrome.storage.local.remove("jobTimeoutSet");

    if (!applicationState.links || !applicationState.links[jobIndex]) return false;

    applicationState.links[jobIndex].status = opts.status;

    // Track timeouts / skips for analytics
    if (!applicationState[opts.list]) {
      applicationState[opts.list] = [];
    }
    applicationState[opts.list].push({
      url: applicationState.links[jobIndex].url,
      timestamp: new Date().toISOString(),
      jobBoard: applicationState.links[jobIndex].jobBoard || "unknown",
      title: applicationState.links[jobIndex].title || "unknown",
      ...(opts.reason ? { reason: opts.reason } : {}),
    });

    if (jobIndex + 1 < applicationState.links.length) {
      // Move to next job
      applicationState.currentIndex = jobIndex + 1;
      await chrome.storage.local.set({ applicationState });
      const nextLink = applicationState.links[applicationState.currentIndex];
      await closeAutomationChildTabs(tabState.automationTabId);
      await chrome.tabs.update(tabState.automationTabId, {
        url: nextLink.url,
      });
    } else {
      // Automation complete
      await chrome.storage.local.set({ applicationState });
      stopTimeoutMonitoring();
      await handleAutomationComplete(tabState.automationTabId);
    }
    return true;
  }
}

// A Workday application that stopped moving (atsControls.js watches the page)
// is left at once instead of waiting out the full job timeout.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!request || request.type !== "LAZY_STUCK_SKIP") return;
  (async () => {
    const tabId = sender && sender.tab && sender.tab.id;
    const reason = String(request.reason || "no progress").slice(0, 160);
    try {
      // A tab of a parallel run.
      if (self.LazyParallel && tabId != null) {
        await self.LazyParallel.ready;
        if (self.LazyParallel.isWorker(tabId)) {
          const r = await self.LazyParallel.skipStuck(tabId, reason, request.url);
          return sendResponse(r);
        }
      }
      const { applicationState: st } = await chrome.storage.local.get("applicationState");
      const { automationTabId } = await chrome.storage.local.get("automationTabId");
      if (!st || !st.isAutomationActive || tabId !== automationTabId) return sendResponse({ skipped: false, why: "not the automation tab" });
      if (st.isPaused) return sendResponse({ skipped: false, paused: true });
      if (jobTimeoutCheckRunning) return sendResponse({ skipped: false, why: "busy" });
      jobTimeoutCheckRunning = true;
      try {
        const ok = await moveOnFromJob(st.currentIndex, { main: String(request.site || "Workday").slice(0, 30) + " got stuck (" + reason + ")", status: "skipped", list: "skippedLinks", reason: "Stuck: " + reason });
        sendResponse({ skipped: !!ok });
      } finally {
        jobTimeoutCheckRunning = false;
      }
    } catch (e) {
      sendResponse({ skipped: false, why: String((e && e.message) || e) });
    }
  })();
  return true;
});

function startTimeoutMonitoring() {
  // Clear any existing monitor first
  stopTimeoutMonitoring();

  console.log("Starting timeout monitoring...");

  // Check every minute. An alarm keeps firing after the service worker has
  // been shut down for inactivity, which is exactly when a job is stuck.
  if (chrome.alarms) {
    chrome.alarms.create(JOB_TIMEOUT_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: 1,
    });
  } else {
    timeoutCheckInterval = setInterval(checkJobTimeout, 60000);
  }
}

function stopTimeoutMonitoring() {
  if (chrome.alarms) {
    chrome.alarms.clear(JOB_TIMEOUT_ALARM);
  }
  if (timeoutCheckInterval) {
    console.log("Stopping timeout monitoring...");
    clearInterval(timeoutCheckInterval);
    timeoutCheckInterval = null;
  }
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== JOB_TIMEOUT_ALARM) return;
    const state = await chrome.storage.local.get("applicationState");
    if (!state?.applicationState?.isAutomationActive) {
      // Nothing is running any more; do not keep waking the worker.
      stopTimeoutMonitoring();
      return;
    }
    await checkJobTimeout();
  });
}

// The user's own job-site sign-in (set on credentials.html). iCIMS needs an
// account before applying; without the user's own details the automation
// would sign in with a built-in address that is not theirs, so those jobs
// are skipped until a sign-in is saved.
const USER_ATS_CREDS_KEY = "lazyUserAtsCredentials";
let userAtsCredsSet = false;
const readUserAtsCreds = (v) => {
  userAtsCredsSet = !!(v && v.email && v.password);
};
// Workday also needs an account. With no email known at all (none from the
// dashboard, none saved), the automation would open one under a built-in
// address that is not the user's, so those jobs are skipped too.
let workdayEmailSet = false;
const readWorkdayEmail = (v) => {
  workdayEmailSet = typeof v === "string" && !!v.trim();
};
// A change seen while the first read is still on its way is newer than that
// read, so the read must not overwrite it.
const atsGateChanged = { creds: false, email: false };
Promise.resolve(chrome.storage.local.get([USER_ATS_CREDS_KEY, "workdayEmail"]))
  .then((r) => {
    if (!atsGateChanged.creds) readUserAtsCreds(r && r[USER_ATS_CREDS_KEY]);
    if (!atsGateChanged.email) readWorkdayEmail(r && r.workdayEmail);
  })
  .catch(() => {});
if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[USER_ATS_CREDS_KEY]) {
      atsGateChanged.creds = true;
      readUserAtsCreds(changes[USER_ATS_CREDS_KEY].newValue);
    }
    if (area === "local" && changes.workdayEmail) {
      atsGateChanged.email = true;
      readWorkdayEmail(changes.workdayEmail.newValue);
    }
  });
}

function isUrlInAllowedPatterns(url) {
  if (!userAtsCredsSet && /^https:\/\/[^/]*\.icims\.com\//i.test(String(url || ""))) {
    return false;
  }
  if (!userAtsCredsSet && !workdayEmailSet && /^https:\/\/[^/]*\.myworkdayjobs\.com\//i.test(String(url || ""))) {
    return false;
  }
  // Add your actual patterns from manifest
  const patterns = [
    "https://ats.rippling.com/*/*/jobs/*/*",
    "https://ats.rippling.com/*/jobs/*/*",
    "https://ats.rippling.com/*/*/jobs/*",
    "https://ats.rippling.com/*/jobs/*",
    "https://jobs.lever.co/*/*/*",
    "https://jobs.lever.co/*/*",
    "https://jobs.ashbyhq.com/*/*/*",
    "https://jobs.ashbyhq.com/*/*",
    "https://jobs.vivahr.com/*/*/*",
    "https://jobs.vivahr.com/*/*",
    "https://job-boards.greenhouse.io/*/jobs/*",
    "https://boards.greenhouse.io/*/jobs/*",
    "https://boards.greenhouse.io/embed/job_app*",
    "https://job-boards.greenhouse.io/embed/job_app*",
    "https://job-boards.eu.greenhouse.io/*/jobs/*",
    "https://job-boards.eu.greenhouse.io/embed/job_app*",
    "https://jobs.eu.lever.co/*/*",
    "https://wellfound.com/jobs/*",
    "https://*.icims.com/jobs/*/*/job*",
    "https://*.icims.com/jobs/*/*/login",
    "https://*.icims.com/jobs/*/*/candidate*",
    "https://*.icims.com/jobs/*/*/questions*",
    "https://login.icims.com/u/login/password*",
    "https://*.myworkdayjobs.com/en-US/*/job/*",
    "https://*.myworkdayjobs.com/en-US/*/login*",
    "https://*.myworkdayjobs.com/en-US/*/job/*/apply/autofillWithResume",
    "https://*.myworkdayjobs.com/en-US/*/job/*/*/apply/autofillWithResume",
    "https://*.indeed.com/*",
    "https://*.simplyhired.com/*",
    "https://*.linkedin.com/jobs/*",
    "https://*.glassdoor.ca/job-listing/*",
    "https://*.glassdoor.ca/Job/*",
    "https://*.glassdoor.com.au/job-listing/*",
    "https://*.glassdoor.com.au/Job/*",
    "https://*.glassdoor.co.in/job-listing/*",
    "https://*.glassdoor.co.in/Job/*",
    "https://*.glassdoor.co.nz/job-listing/*",
    "https://*.glassdoor.co.nz/Job/*",
    "https://*.glassdoor.co.uk/job-listing/*",
    "https://*.glassdoor.co.uk/Job/*",
    "https://*.glassdoor.com/job-listing/*",
    "https://*.glassdoor.com/Job/*",
    "https://*.glassdoor.ie/job-listing/*",
    "https://*.glassdoor.ie/Job/*",
    "https://*.glassdoor.sg/job-listing/*",
    "https://*.glassdoor.sg/Job/*",
    "https://www.glassdoor.fr/job-listing/*",
    "https://www.glassdoor.fr/Job/*",
    "https://www.glassdoor.de/job-listing/*",
    "https://www.glassdoor.de/Job/*",
    "https://www.glassdoor.it/Lavoro/*",
    "https://www.glassdoor.it/Job/*",
    "https://www.glassdoor.it/job-listing/*",
    "https://www.glassdoor.es/Empleo/*",
    "https://www.glassdoor.es/Job/*",
    "https://www.glassdoor.es/job-listing/*",
    "https://www.glassdoor.nl/Vacature/*",
    "https://www.glassdoor.nl/Job/*",
    "https://www.glassdoor.nl/job-listing/*",
    "https://*.ziprecruiter.com/jobs-search*",
    "https://*.ziprecruiter.com/jobs*",
    "https://www.dice.com/*",
  ];

  return patterns.some((pattern) => {
    // Convert pattern to regex
    const regexStr =
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$";
    const regex = new RegExp(regexStr);
    return regex.test(url);
  });
}

// Opens the first job of a batch in the automation tab that is already open
// (from an earlier batch), so every batch keeps to one tab; a new tab is
// created only when there is none.
async function openAutomationTab(url) {
  try {
    const { automationTabId } = await chrome.storage.local.get("automationTabId");
    if (automationTabId) {
      const existing = await chrome.tabs.get(automationTabId).catch(() => null);
      if (existing) {
        await closeAutomationChildTabs(automationTabId);
        return await chrome.tabs.update(automationTabId, { url, active: true });
      }
    }
  } catch (error) {
    console.log("Could not reuse the automation tab", error);
  }
  try {
    return await chrome.tabs.create({ url });
  } catch (error) {
    console.error("Failed to create automation tab", error);
    return null;
  }
}

// Closes tabs that the job in the automation tab opened (an "Apply" button
// that opens a new tab, a sign-in pop-up, ...) once that job is finished, so
// tabs do not pile up from one application to the next.
async function closeAutomationChildTabs(automationTabId) {
  try {
    await smartApplyTabsReady;
    const children = indeedSmartApplyTabs
      .filter((tab) => tab.openerTabId === automationTabId && tab.id !== automationTabId)
      .map((tab) => tab.id);
    for (const id of children) {
      try {
        await chrome.tabs.remove(id);
      } catch (error) {
        // already closed
      }
    }
  } catch (error) {
    console.log("Could not close leftover tabs", error);
  }
}

async function skipToNextUrl(applicationState, tabId) {
  console.log("Skipping current job");

  try {
    // Get fresh state
    const state = await chrome.storage.local.get("applicationState");
    const { applicationState } = state;

    if (!applicationState || !applicationState.links) {
      console.error("Invalid application state");
      return;
    }

    const { currentIndex, links } = applicationState;
    if (self.LazyDebug) await self.LazyDebug.snapshot(tabId, "Before skipping: the page is not an application form");

    if (currentIndex + 1 < links.length) {
      // Mark current as skipped
      links[currentIndex].status = "skipped";
      // Where the link ended up, for the run report.
      try {
        const t = await chrome.tabs.get(tabId);
        links[currentIndex].lastUrl = String((t && t.url) || "").slice(0, 200);
      } catch (e) {}

      // Initialize skipped links array if needed
      if (!applicationState.skippedLinks) {
        applicationState.skippedLinks = [];
      }

      // Add to skipped links
      applicationState.skippedLinks.push({
        url: links[currentIndex].url,
        timestamp: new Date().toISOString(),
        reason: "URL pattern not allowed",
      });

      // Move to next
      applicationState.currentIndex += 1;

      // Update state before navigation
      await chrome.storage.local.set({ applicationState });

      console.log(
        `Moving to next URL: ${links[applicationState.currentIndex].url}`
      );

      // Navigate to next URL
      await closeAutomationChildTabs(tabId);
      await chrome.tabs.update(tabId, {
        url: links[applicationState.currentIndex].url,
      });
    } else {
      console.log("All links processed");

      if (links[currentIndex] && (!links[currentIndex].status || links[currentIndex].status === "pending")) {
        links[currentIndex].status = "skipped";
        (applicationState.skippedLinks = applicationState.skippedLinks || []).push({ url: links[currentIndex].url, timestamp: new Date().toISOString(), reason: "URL pattern not allowed" });
      }
      applicationState.isAutomationActive = false;
      await chrome.storage.local.set({ applicationState });
      await handleAutomationComplete(tabId);
    }
  } catch (error) {
    console.error("Error skipping URL:", error);
  }
}

chrome.tabs.onUpdated.addListener(async function (tabId, changeInfo, tab) {
  // Worker tabs of a parallel run are handled by parallelApply.js.
  if (globalThis.LazyParallel && (await globalThis.LazyParallel.onTabUpdated(tabId, changeInfo, tab))) return;
  if (changeInfo.url || changeInfo.status === "complete") {
    const state = await chrome.storage.local.get([
      "automationTabId",
      "applicationState",
    ]);

    if (
      tabId === state.automationTabId &&
      state.applicationState?.isAutomationActive &&
      tab.url
    ) {
      // Keep the "Automation In Progress" panel on every page the automation
      // tab loads (redirects, company career sites, error pages), not only
      // where the application script runs. Injecting twice is harmless: the
      // panel mounts once per page.
      if (changeInfo.status === "complete" && /^https?:/i.test(tab.url)) {
        executeScripts(tabId, [
          { file: "jquery.min.js" },
          { file: "inject-autofill-template.js" },
          { file: "autoFillTemplate.bundle.js" },
        ]);
      }
      console.log(`Checking URL pattern match for: ${tab.url}`);

      const isAllowed = isUrlInAllowedPatterns(tab.url);

      if (!isAllowed) {
        console.log(
          `URL ${tab.url} does not match allowed patterns. Skipping...`
        );

        setTimeout(async () => {
          try {
            const currentTab = await chrome.tabs.get(tabId);
            if (
              currentTab.url === tab.url &&
              !isUrlInAllowedPatterns(currentTab.url)
            ) {
              skipToNextUrl(state.applicationState, tabId);
            }
          } catch (err) {
            console.error("Error checking tab:", err);
          }
        }, 1000);
      } else if (changeInfo.status === "complete") {
        console.log("Processing matching URL:", tab.url);
        processUrl(tab.url, tabId);
      }
    } else if (changeInfo.status === "complete") {
      processUrl(tab.url, tabId);
    }
  }

  // if (changeInfo.status == "complete") {
  //   console.log("updated");
  //   processUrl(tab.url, tabId);
  //   // if (tab.url.includes("linkedin.com/jobs/")) {
  //   //   chrome.tabs.sendMessage(tabId, {
  //   //     message: "sendAiEmail",
  //   //   });
  //   // }
  //   // if (tab.url.includes("linkedin.com/in/")) {
  //   //   chrome.tabs.sendMessage(tabId, {
  //   //     message: "referralRequest",
  //   //   });
  //   // }
  //   chrome.webNavigation.getAllFrames(
  //     {
  //       tabId: tabId,
  //     },
  //     (response) => {
  //       console.log("response", response);
  //       const allFrameIds = response.filter((x) => {
  //         const matchedAllUrls = allUrls.some((urlPattern) => {
  //           const regex = new RegExp(urlPattern.replace(/\*/g, ".*"), "i");
  //           return regex.test(x.url);
  //         });

  //         console.log("all matched urls", matchedAllUrls);

  //         const matchedExcludedUrls = allExcludedUrls.some((urlPattern) => {
  //           const regex = new RegExp(urlPattern.replace(/\*/g, ".*"), "i");
  //           return regex.test(x.url);
  //         });

  //         if (matchedAllUrls && !matchedExcludedUrls) {
  //           return true;
  //         }
  //       });

  //       console.log("allframeids", allFrameIds);
  //       if (allFrameIds.length > 0) {
  //         // executeScripts(
  //         //   tabId,
  //         //   [
  //         //     { file: "jquery.min.js" },
  //         //     { file: "inject-autofill-template.js" },
  //         //     { file: "autoFillTemplate.bundle.js" },
  //         //   ],
  //         //   () => {
  //         //     console.log("Autofill Button Added");
  //         //   }
  //         // );
  //       }
  //     }
  //   );
  //   // const tabUrl = tab.url;
  //   // const matchedAllUrls = allUrls.some((urlPattern) => {
  //   //   const regex = new RegExp(urlPattern.replace(/\*/g, ".*"), "i");
  //   //   return regex.test(tabUrl);
  //   // });

  //   // const matchedExcludedUrls = allExcludedUrls.some((urlPattern) => {
  //   //   const regex = new RegExp(urlPattern.replace(/\*/g, ".*"), "i");
  //   //   return regex.test(tabUrl);
  //   // });

  //   // if (matchedAllUrls && !matchedExcludedUrls) {
  //   //   console.log("Tab URL matched allUrls and not excluded URLs:", tabUrl);
  //   //   executeScripts(
  //   //     tab.id,
  //   //     [
  //   //       { file: "jquery.min.js" },
  //   //       { file: "inject-autofill-template.js" },
  //   //       { file: "autoFillTemplate.bundle.js" },
  //   //     ],
  //   //     () => {
  //   //       console.log("Autofill Button Added", tabUrl);
  //   //     }
  //   //   );
  //   // }
  //   // if (tab.url && tab.url.startsWith(mainurl)) {
  //   //   const tabs = await chrome.tabs.query({ url: mainurl + "/*" });
  //   //   if (tabs.length > 1) {
  //   //     const notActiveTab = tabs.filter((tabDetails) => {
  //   //       return tabDetails.active == false;
  //   //     });
  //   //     await chrome.tabs.remove(notActiveTab[0].id);
  //   //     // await chrome.tabs.update(tabs[0].id, { active: true });
  //   //   }
  //   // }
  // }
});

async function showAutomationPopup(platformName) {
  getObjectFromLocalStorage([
    "linkedinTabId",
    "diceTabId",
    "ziprecruiterTabId",
    "indeedTabId",
    "glassdoorTabId",
    "seekTabId",
    "careerBuilderTabId",
    "monsterTabId",
    "founditTabId",
    "simplyHiredTabId",
  ]).then((storageResult) => {
    let executeScriptId;
    if (platformName === "linkedin") {
      executeScriptId = storageResult.linkedinTabId;
    } else if (platformName === "dice") {
      executeScriptId = storageResult.diceTabId;
    } else if (platformName === "ziprecruiter") {
      executeScriptId = storageResult.ziprecruiterTabId;
    } else if (platformName === "glassdoor") {
      executeScriptId = storageResult.glassdoorTabId;
    } else if (platformName === "seek") {
      executeScriptId = storageResult.seekTabId;
    } else if (platformName === "careerBuilder") {
      executeScriptId = storageResult.careerBuilderTabId;
    } else if (platformName === "monster") {
      executeScriptId = storageResult.monsterTabId;
    } else if (platformName === "foundit") {
      executeScriptId = storageResult.founditTabId;
    } else if (platformName === "simplyHired") {
      executeScriptId = storageResult.simplyHiredTabId;
    } else {
      executeScriptId = storageResult.indeedTabId;
    }
    console.log("showAutomationPopup", executeScriptId);
    executeScripts(
      executeScriptId,
      [
        { file: "jquery.min.js" },
        { file: "inject-template.js" },
        { file: "popupTemplate.bundle.js" },
      ],
      () => {
        chrome.tabs.sendMessage(executeScriptId, {
          [platformName]: "true",
          message: "scanJobs",
        });
      }
    );
  });
}

async function showScanningPopupV2() {
  const storageResult = await getObjectFromLocalStorage(["automationTabId1"]);

  console.log("hello from background");

  if (storageResult.automationTabId1) {
    chrome.tabs.sendMessage(
      storageResult.automationTabId1,
      { type: "CHECK_IF_SCANNING_POPUP_INJECTED" },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error sending message to tab:",
            chrome.runtime.lastError
          );
          console.log("Proceeding to inject scripts...");
          injectScripts(storageResult.automationTabId1);
          return;
        }

        if (response && response.injected) {
          console.log("Scanning popup is already injected.");
        } else {
          console.log("Scanning popup not found. Injecting now...");
          injectScripts(storageResult.automationTabId1);
        }
      }
    );
  } else {
    console.warn("No automation tab ID found in storage.");
  }
}

function injectScripts(tabId) {
  executeScripts(
    tabId,
    [
      { file: "jquery.min.js" },
      { file: "inject-template-v2.js" },
      { file: "popupTemplateV2.bundle.js" },
    ],
    () => {
      console.log("Scanning popup injected successfully");
    }
  );
}

async function showReferralAutomationPop(tabId) {
  executeScripts(
    tabId,
    [
      { file: "jquery.min.js" },
      { file: "inject-template.js" },
      { file: "popupTemplate.bundle.js" },
    ],
    () => {
      chrome.tabs.sendMessage(tabId, {
        referral: "true",
        message: "scanJobs",
      });
    }
  );
}

var activeTabId;

chrome.tabs.onActivated.addListener(function (activeInfo) {
  activeTabId = activeInfo.tabId;
});

function showAutomationPopupDebug(platformName) {
  chrome.tabs.query({ currentWindow: true, active: true }, function (tabs) {
    console.log("tabs", tabs, tabs?.[0]?.id, platformName);
    if (tabs && tabs.length > 0) {
      executeScripts(tabs?.[0]?.id, [
        { file: "jquery.min.js" },
        { file: "inject-template-debug.js" },
        { file: "debugTemplate.bundle.js" },
      ]);
    } else {
      chrome.tabs.get(activeTabId, function (tab) {
        console.log("tabs0", tab);
        if (tab) {
          executeScripts(tab?.id, [
            { file: "jquery.min.js" },
            { file: "inject-template-debug.js" },
            { file: "debugTemplate.bundle.js" },
          ]);
        } else {
          console.log("No active tab identified.");
        }
      });
    }
  });
}

async function pauseAutomation() {
  getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
    executeScripts(storageResult.ziprecruiterTabId, [
      { file: "inject-template1.js" },
      { file: "pauseTemplate.bundle.js" },
    ]);
  });
}

async function addDebugScript(fnName) {
  getObjectFromLocalStorage(["indeedTabId1", "indeedTabId"]).then(
    (storageResult) => {
      const debugTabId =
        fnName === "FILTERFN"
          ? storageResult.indeedTabId1
          : storageResult.indeedTabId;
      executeScripts(debugTabId, [
        { file: "inject-debugtemplate.js" },
        { file: "debugTemplateUi.bundle.js" },
      ]);
    }
  );
}

async function linkedinUpdateUrl(link, message2) {
  getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.linkedinTabId), function () {
        console.log("Finally Completed");
        //chrome.runtime.sendMessage({ linkedin: "true", message: "completed" ,message2 : message2});
      });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var currTab = tabs[0];
        if (currTab) {
          // Sanity check
          /* do stuff */
          console.log(currTab);
          chrome.tabs.update(parseInt(storageResult.linkedinTabId), {
            active: true,
            url: link,
            active: true,
          });
        }
      });
    }
  });
}

function updateUrlAtTabId(link, tabID) {
  console.info("updating url at tabid", tabID, link);
  chrome.tabs.update(tabID, {
    active: true,
    url: link,
    active: true,
  });
}

function glassdoorUpdateUrl2(link) {
  getObjectFromLocalStorage(["glassdoorTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.glassdoorTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.glassdoorTabId, link);
      chrome.tabs.update(parseInt(storageResult.glassdoorTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function seekUpdateUrl2(link) {
  getObjectFromLocalStorage(["seekTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.seekTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.seekTabId, link);
      chrome.tabs.update(parseInt(storageResult.seekTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function careerBuilderUpdateUrl2(link) {
  getObjectFromLocalStorage(["careerBuilderTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(
        parseInt(storageResult.careerBuilderTabId),
        function () {
          console.log("Finally Completed");
        }
      );
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.careerBuilderTabId, link);
      chrome.tabs.update(parseInt(storageResult.careerBuilderTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function monsterUpdateUrl2(link) {
  getObjectFromLocalStorage(["monsterTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.monsterTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.monsterTabId, link);
      chrome.tabs.update(parseInt(storageResult.monsterTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function founditUpdateUrl2(link) {
  getObjectFromLocalStorage(["founditTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.founditTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.founditTabId, link);
      chrome.tabs.update(parseInt(storageResult.founditTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function simplyHiredUpdateUrl2(link) {
  getObjectFromLocalStorage(["simplyHiredTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.simplyHiredTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      console.log("currTab", storageResult.simplyHiredTabId, link);
      chrome.tabs.update(parseInt(storageResult.simplyHiredTabId), {
        active: true,
        url: link,
        active: true,
      });
      // }
      // });
    }
  });
}

function modifyUrl(url, num) {
  const ipPattern = /_IP\d+/;
  const koPattern = /(KO0,\d+)/;

  if (ipPattern.test(url)) {
    // Replace the 'IP' followed by a number with 'IP' followed by 'num'
    return url.replace(ipPattern, `_IP${num}`);
  } else if (koPattern.test(url)) {
    // Add '_IP' followed by 'num' after 'KO0,<number>'
    return url.replace(koPattern, `$1_IP${num}`);
  } else {
    // If neither pattern is found, return the original url
    return url;
  }
}

function glassdoorUpdateUrl(pageNumber) {
  getObjectFromLocalStorage(["glassdoorBaseUrl"]).then((storageResult) => {
    ///// send -1 as pageNumber to remove tab and log completed.
    console.info("updating glassdoor url", pageNumber);
    // Replace the number in the URL with the provided value
    const newURL = modifyUrl(storageResult.glassdoorBaseUrl, pageNumber);
    console.log("newurl", newURL);
    glassdoorUpdateUrl2(newURL);
  });
}

async function diceUpdateUrl(link, message2) {
  getObjectFromLocalStorage(["diceTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(parseInt(storageResult.diceTabId), function () {
        console.log("Finally Completed");
      });
    } else {
      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   var currTab = tabs[0];
      //   if (currTab) {
      // Sanity check
      /* do stuff */
      // console.log(currTab);
      chrome.tabs.update(parseInt(storageResult.diceTabId), {
        active: true,
        url: link,
        active: true,
      });
      //   }
      // });
    }
  });
}

async function ziprecruiterUpdateUrl(link, message2) {
  console.log("987654321");
  getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
    if (link == "index.html") {
      chrome.tabs.remove(
        parseInt(storageResult.ziprecruiterTabId),
        function () {
          console.log("Finally Completed");
          //chrome.runtime.sendMessage({ linkedin: "true", message: "completed" ,message2 : message2});
        }
      );
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        var currTab = tabs[0];
        if (currTab) {
          // Sanity check
          /* do stuff */
          console.log(currTab);
          chrome.tabs.update(parseInt(storageResult.ziprecruiterTabId), {
            active: true,
            url: link,
            active: true,
          });
        }
      });
    }
  });
}

const downloadHtml = async (platform, htmlContent) => {
  // console.log(userDetails, platform, ,, uploadapitoken);
  getObjectFromLocalStorage(["uploadapidebug", "uploadapitoken"]).then(
    (storageResult) => {
      let blob = new Blob([htmlContent], {
        type: "text/html;charset=utf-8",
      });
      // uploadDebug(
      //   blob,
      //   storageResult.uploadapidebug,
      //   storageResult.uploadapitoken
      // );
    }
  );
};

async function resetUA(stringmain) {
  return 1;
  CUSTOM_UA = DEFAULT_UA;
  try {
    await extension.updateUserAgent(CUSTOM_UA, stringmain); // fn is your function that returns a Promise
    console.log("promise fullfilled"); // This will be logged after the Promise is fulfilled
    return 1;
  } catch (error) {
    console.error(error); // If the Promise is rejected, the error will be logged here
    return 0;
  }
}

async function changeUA(ua, stringmain) {
  return 1;
  CUSTOM_UA = ua;
  try {
    await extension.updateUserAgent(CUSTOM_UA, stringmain); // fn is your function that returns a Promise
    console.log("promise fullfilled"); // This will be logged after the Promise is fulfilled
    return 1;
  } catch (error) {
    console.error(error); // If the Promise is rejected, the error will be logged here
    return 0;
  }
}

var extension = {};
extension.updateUserAgent = function (string, stringmain) {
  return chrome.declarativeNetRequest.updateDynamicRules({
    addRules: [
      {
        id: 1001,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "User-Agent",
              operation: "set",
              value: string,
            },
          ],
        },
        condition: {
          urlFilter: "||indeed.com",
          resourceTypes: [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "webtransport",
            "webbundle",
            "other",
          ],
        },
      },
      {
        id: 1002,
        priority: 2,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            {
              header: "User-Agent",
              operation: "set",
              value: DEFAULT_UA, // the default User-Agent string
            },
          ],
        },
        condition: {
          urlFilter: stringmain,
          resourceTypes: [
            "main_frame",
            "sub_frame",
            "stylesheet",
            "script",
            "image",
            "font",
            "object",
            "xmlhttprequest",
            "ping",
            "csp_report",
            "media",
            "websocket",
            "webtransport",
            "webbundle",
            "other",
          ],
        },
      },
    ],
    removeRuleIds: [1001, 1002],
  });
};

const waitForSetting = async (id) => {
  return new Promise((resolve, reject) => {
    // globalTabId = id;
    chrome.storage.local.set({ globalTabId: id }, () => {
      resolve();
    });
  });
};

const waitForTabId = async () => {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      resolve(tabs[0]?.id || -1);
    });
  });
};

async function resetHandleScrappingComplete() {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set(
        {
          allLinks: [],
          pageNumber: 1,
          isScrapingComplete: false,
          scrapingStarted: false,
          jobLimitV2: 0,
          filtersAppliedV2: 0,
          glassdoorLocationAppliedV2: 0,
          filters: {},
          indeedFiltersToApply: {},
          filtersApplied: {},
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        }
      );
    });
    await chrome.storage.local.remove([
      "automationTabId1",
      "indeedFiltersToApply",
      "filtersApplied",
    ]);
    chrome?.power?.releaseKeepAwake();
  } catch (error) {
    console.error("Error during reset:", error);
  }
}

// What happened to each job (runReport.js), kept for the breakdown card.
async function saveRunReport(applicationState, status) {
  try {
    if (!self.LazyRunReport || !applicationState) return null;
    const report = self.LazyRunReport.build(applicationState, { status });
    await chrome.storage.local.set({ lazyLastRun: report });
    return report;
  } catch (e) {
    console.error("Run report failed", e);
    return null;
  }
}

async function handleAutomationComplete(tabId) {
  // Stop timeout monitoring
  stopTimeoutMonitoring();

  const state = await chrome.storage.local.get([
    "applicationState",
    "globalTabId",
  ]); // Get the stored tab ID
  const links = state.applicationState?.links || [];
  const report = await saveRunReport(state.applicationState, "completed");

  const results = {
    type: "AUTOMATION_RESULTS",
    data: {
      status: "completed",
      processedLinks: links.filter((link) => link.status === "completed"),
      // Every job not applied, with its reason, so the totals add up.
      failedLinks: report ? self.LazyRunReport.failedForDashboard(report, state.applicationState?.failedLinks) : state.applicationState?.failedLinks || [],
      stoppedAt: null,
      totalLinks: links.length,
    },
  };

  // Send results to React app using chrome.tabs.sendMessage

  if (state.globalTabId) {
    try {
      // The dashboard only answers while its Jobs page is open. On any other
      // page (Profile, Email Settings) the answer never comes, which used to
      // leave the last job's tab open for ever with "moving to next job".
      const sent = chrome.tabs.sendMessage(Number(state.globalTabId), results);
      sent.catch(() => {});
      const delivered = await Promise.race([
        sent.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (!delivered) throw new Error("dashboard did not answer");
    } catch (error) {
      console.log(
        "Could not send results to React app tab - tab might be closed or refreshed"
      );
      await chrome.storage.local.set({ lastAutomationResults: results });
    }
    try {
      await chrome.tabs.update(Number(state.globalTabId), {
        active: true,
      });
    } catch (error) {
      console.log("Could not focus the dashboard tab");
    }
  }

  if (tabId == null) {
    console.log("No automation tab to close");
  } else chrome.tabs.remove(tabId, () => {
    if (chrome.runtime.lastError) {
      console.error("Error closing tab:", chrome.runtime.lastError.message);
    } else {
      console.log("Tab closed successfully.");
    }
  });
  indeedSmartApplyTabs = [];
  persistSmartApplyTabs();
  await chrome.storage.local.remove([
    "applicationState",
    "automationControlView",
    "automationTabId",
    "jobTimeoutSet",
    "automationControlMessage",
    "automationControlJobDetails",
    "applicationSessionId",
    "automationControlProgressBar",
  ]);
  chrome?.power?.releaseKeepAwake();
}

async function handleAutomationInterrupted(state) {
  // Stop timeout monitoring
  stopTimeoutMonitoring();

  const links = state?.links || [];
  const currentIndex = state?.currentIndex ?? null;
  const globalTabId = await chrome.storage.local.get("globalTabId");
  const report = await saveRunReport(state, "interrupted");

  const results = {
    type: "AUTOMATION_RESULTS",
    data: {
      status: "interrupted",
      processedLinks: links.filter((link) => link.status === "completed"),
      failedLinks: report ? self.LazyRunReport.failedForDashboard(report, state?.failedLinks) : state?.failedLinks || [],
      stoppedAt: currentIndex,
      totalLinks: links.length,
    },
  };

  // Send results to React app
  if (globalTabId.globalTabId) {
    try {
      await chrome.tabs.sendMessage(Number(globalTabId.globalTabId), results);
    } catch (error) {
      console.log(
        "Could not send interrupted status to React app tab - tab might be closed or refreshed"
      );
      // Optionally store the interrupted state
      await chrome.storage.local.set({ lastAutomationResults: results });
    }
  }

  // focus on global tab id
  if (globalTabId.globalTabId)
    try {
      await chrome.tabs.update(Number(globalTabId.globalTabId), {
        active: true,
      });
    } catch (err) {
      console.log("err", err);
    }

  // Clear states
  chrome?.power?.releaseKeepAwake();
  await chrome.storage.local.remove([
    "applicationState",
    "automationControlView",
    "automationTabId",
    "jobTimeoutSet",
  ]);
}

async function handleAutomationScanningInterrupted() {
  try {
    const storageResult = await getObjectFromLocalStorage([
      "globalTabId",
      "automationTabId1",
      "allLinks",
    ]);

    if (!storageResult.globalTabId) {
      await resetHandleScrappingComplete();
      return;
    }

    const results = {
      type: "SCANNING_RESULTS",
      data: {
        jobLinks: storageResult?.allLinks || [],
      },
    };

    // Send a message to the tab and activate it
    chrome.tabs.sendMessage(Number(storageResult.globalTabId), results);
    chrome.tabs.update(Number(storageResult.globalTabId), { active: true });

    // Reset scraping process
    await resetHandleScrappingComplete();
    chrome?.power?.releaseKeepAwake();
  } catch (error) {
    console.error("An error occurred:", error);
    await resetHandleScrappingComplete();
  }
}

const JOB_BOARDS = {
  lever: {
    urlPattern: "jobs.lever.co",
  },
  greenhouse: {
    urlPattern: "boards.greenhouse.io",
  },
  icims: {
    urlPattern: "icims.com",
  },
  workday: {
    urlPattern: "myworkdayjobs.com",
  },
  wellfound: {
    urlPattern: "wellfound.com",
  },
  rippling: {
    urlPattern: "ats.rippling.com",
  },
  ashby: {
    urlPattern: "jobs.ashbyhq.com",
  },
  vivahr: {
    urlPattern: "jobs.vivahr.com",
  },
  linkedin: {
    urlPattern: "linkedin.com",
  },
  indeed: {
    urlPattern: "indeed.com",
  },
  dice: {
    urlPattern: "dice.com",
  },
  ziprecruiter: {
    urlPattern: "ziprecruiter.com",
  },
  glassdoor: {
    urlPatterns: [
      "glassdoor.com",
      "glassdoor.co.uk",
      "glassdoor.ca",
      "glassdoor.com.au",
      "glassdoor.co.in",
      "glassdoor.sg",
      "glassdoor.co.nz",
      "glassdoor.ie",
      "glassdoor.fr",
      "glassdoor.de",
      "glassdoor.it",
      "glassdoor.es",
      "glassdoor.nl",
    ],
  },
  simplyhired: {
    urlPattern: "simplyhired.com",
  },
};

function detectJobBoard(url) {
  for (const [board, config] of Object.entries(JOB_BOARDS)) {
    const patterns = config.urlPatterns || [config.urlPattern];
    if (patterns.some((pattern) => url.includes(pattern))) {
      return board;
    }
  }
  return null;
}

let indeedSmartApplyTabs = [];
const SMART_APPLY_TABS_KEY = "indeedSmartApplyTabs";
const SMART_APPLY_TABS_MAX = 200;
const sessionStore = chrome.storage.session || chrome.storage.local;

function persistSmartApplyTabs() {
  try {
    sessionStore.set({ [SMART_APPLY_TABS_KEY]: indeedSmartApplyTabs });
  } catch (error) {
    console.warn("Could not save smart apply tabs", error);
  }
}

// Resolves once the list saved by a previous run of the worker is merged in.
const smartApplyTabsReady = (async () => {
  try {
    const saved = await sessionStore.get(SMART_APPLY_TABS_KEY);
    const previous = Array.isArray(saved?.[SMART_APPLY_TABS_KEY])
      ? saved[SMART_APPLY_TABS_KEY]
      : [];
    const known = new Set(indeedSmartApplyTabs.map((tab) => tab.id));
    indeedSmartApplyTabs = previous
      .filter((tab) => tab && !known.has(tab.id))
      .concat(indeedSmartApplyTabs);
  } catch (error) {
    console.warn("Could not restore smart apply tabs", error);
  }
})();

chrome.tabs.onCreated.addListener(async (newTab) => {
  if (newTab.openerTabId && newTab.id) {
    await smartApplyTabsReady;
    indeedSmartApplyTabs.push({
      id: newTab.id,
      openerTabId: newTab.openerTabId,
    });
    if (indeedSmartApplyTabs.length > SMART_APPLY_TABS_MAX) {
      indeedSmartApplyTabs = indeedSmartApplyTabs.slice(-SMART_APPLY_TABS_MAX);
    }
    persistSmartApplyTabs();
  }
});

chrome.tabs.onRemoved.addListener(async (removedTabId) => {
  await smartApplyTabsReady;
  const remaining = indeedSmartApplyTabs.filter(
    (tab) => tab.id !== removedTabId
  );
  if (remaining.length !== indeedSmartApplyTabs.length) {
    indeedSmartApplyTabs = remaining;
    persistSmartApplyTabs();
  }
});

chrome.runtime.onMessageExternal.addListener(function (
  request,
  sender,
  sendResponse
) {
  console.log(request);
  if ("lazyapply" in request) {
    if (request.message == "check") {
      console.log("execute script", request?.injected);
      if ("injected" in request && !request.injected) {
        waitForTabId().then((id) => {
          executeScripts(id, [{ file: "globalDash.bundle.js" }]);
          sendResponse({ status: "installed" });
        });
        return true;
      }
      sendResponse({ status: "installed" });
      return true;
    }
    if (request.message == "auth") {
      chrome.storage.local.set(
        {
          token: request.token,
          user: request.user,
        },
        () => {
          sendResponse("success");
        }
      );
      return true;
    }
    if (request.message == "openpage") {
      //Dont open the page
      chrome.tabs.create({
        url: mainurl,
        active: true,
      });
      sendResponse({ status: "opened" });
      return true;
    }
  } else if ("dashboard" in request) {
    if ("saveValues" in request) {
      console.log("savevalues", request.saveValues);
      chrome.storage.local.set(request.saveValues, async () => {
        if ("global" in request) {
          if (request.message == "initialToken") {
            sendResponse({ message: "tokenSavedInitial" });
          }
          if (request.message == "loginToken") {
            const id = await waitForTabId();
            if (id != -1) {
              if ("injected" in request && !request.injected) {
                executeScripts(id, [{ file: "globalDash.bundle.js" }]);
              }
              console.log("tabid", id);
              await waitForSetting(id);
              console.log("waited for saved setting");
            }
            sendResponse({ message: "tokenSaved", globalTabId: id });
            return true;
          }
        } else if ("linkedin" in request) {
          if (request.message == "linkedinFetchFilters") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                if (request.data.message == "tabid") {
                  chrome?.power?.requestKeepAwake("display");
                  console.log("save filter id", tab.id);
                  // linkedinTabId1 = tab.id;
                  let sampleObject = {
                    linkedinTabId1: tab.id,
                  };
                  saveObjectInLocalStorage(sampleObject);
                }
              }
            );
            return true;
          } else if (request.message == "linkedinStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                if (request.data.message == "setBaseUrl") {
                  const sampleObject = {
                    linkedinTabId: tab.id,
                    linkedinBaseUrl: request.data.linkedinBaseUrl,
                  };
                  saveObjectInLocalStorage(sampleObject);
                  console.log("saveobject,linkedinStartApplying");
                }
              }
            );
            return true;
          } else if (request.message == "linkedinFiltersFetched") {
            console.log("linkedinFetchFilters");
          }
        } else if ("dice" in request) {
          if (request.message == "diceFetchFilters") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                if (request.data.message == "tabid") {
                  chrome?.power?.requestKeepAwake("display");
                  console.log("save filter id", tab.id);
                  // diceTabId1 = tab.id;
                  let sampleObject = {
                    diceTabId1: tab.id,
                  };
                  saveObjectInLocalStorage(sampleObject);
                }
              }
            );
            return true;
          } else if (request.message == "diceStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                if (request.data.message == "setBaseUrl") {
                  // diceTabId = tab.id;
                  // diceBaseUrl = request.data.diceBaseUrl;
                  let sampleObject = {
                    diceTabId: tab.id,
                    diceBaseUrl: request.data.diceBaseUrl,
                  };

                  saveObjectInLocalStorage(sampleObject);
                }
              }
            );
            return true;
          } else if (request.message == "diceFiltersFetched") {
            console.log("diceFetchFilters");
          }
        } else if ("indeed" in request) {
          if (request.message == "indeedFetchFilters") {
            console.log("fetchfiltersindeed", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            changeUA(uamain, indeedString).then((result) => {
              chrome.tabs.create(
                {
                  url: request.data.url,
                  active: true,
                  active: true,
                },
                async (tab) => {
                  indeedTabId1 = tab.id;
                  let sampleObject = {
                    indeedTabId1: tab.id,
                  };

                  saveObjectInLocalStorage(sampleObject);
                }
              );
            });
            return true;
          } else if (request.message == "indeedStartApplying") {
            changeUA(uamain, indeedString).then((result) => {
              chrome.tabs.create(
                {
                  url: request.data.url,
                  active: true,
                },
                async function (tab) {
                  // indeedTabId = tab.id;
                  // baseUrl = request.data.url;
                  let sampleObject = {
                    indeedTabId: tab.id,
                    baseUrl: request.data.url,
                  };

                  saveObjectInLocalStorage(sampleObject);
                }
              );
            });
            return true;
          } else if (request.message == "indeedFiltersFetched") {
            console.log("indeedFetchFilters");
          }
        } else if ("glassdoor" in request) {
          if (request.message == "glassdoorFetchFilters") {
            console.log("fetchfiltersglassdoor", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  glassdoorTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "glassdoorStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  glassdoorTabId: tab.id,
                  glassdoorBaseUrl: request.data.url,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "glassdoorFiltersFetched") {
            console.log("glassdoorFetchFilters");
          }
        } else if ("seek" in request) {
          if (request.message == "seekFetchFilters") {
            console.log("fetchfiltersseek", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  seekTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "seekStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  seekTabId: tab.id,
                  seekBaseUrl: request.data.url,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "seekFiltersFetched") {
            console.log("seekFetchFilters");
          }
        } else if ("careerBuilder" in request) {
          if (request.message == "careerBuilderFetchFilters") {
            console.log("fetchfilterscareerBuilder", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  careerBuilderTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "careerBuilderStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  careerBuilderTabId: tab.id,
                  careerBuilderBaseUrl: request.data.url,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "careerBuilderFiltersFetched") {
            console.log("careerBuilderFetchFilters");
          }
        } else if ("monster" in request) {
          if (request.message == "monsterFetchFilters") {
            console.log("fetchfiltersmonster", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  monsterTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "monsterStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  monsterTabId: tab.id,
                  monsterBaseUrl: request.data.url,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "monsterFiltersFetched") {
            console.log("monsterFetchFilters");
          }
        } else if ("foundit" in request) {
          if (request.message == "founditFetchFilters") {
            console.log("fetchfiltersfoundit", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  founditTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "founditStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  founditTabId: tab.id,
                  founditBaseUrl: request.data.url,
                };
                console.log(
                  "saving foundit tabid - ",
                  tab.id,
                  request.data.url
                );

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "founditFiltersFetched") {
            console.log("founditFetchFilters");
          }
        } else if ("simplyHired" in request) {
          if (request.message == "simplyHiredFetchFilters") {
            console.log("fetchfilterssimplyHired", request);
            chrome?.power?.requestKeepAwake("display");
            console.log("save filter id", request.tabID);
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
                active: true,
              },
              async (tab) => {
                let sampleObject = {
                  simplyHiredTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "simplyHiredStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: true,
              },
              async function (tab) {
                let sampleObject = {
                  simplyHiredTabId: tab.id,
                  simplyHiredBaseUrl: request.data.url,
                };
                console.log(
                  "saving simplyHired tabid - ",
                  tab.id,
                  request.data.url
                );

                saveObjectInLocalStorage(sampleObject);
              }
            );

            return true;
          } else if (request.message == "simplyHiredFiltersFetched") {
            console.log("simplyHiredFetchFilters");
          }
        } else if ("ziprecruiter" in request) {
          if (request.message == "ziprecruiterFetchFilters") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                chrome?.power?.requestKeepAwake("display");
                console.log("save filter id", tab.id);

                let sampleObject = {
                  ziprecruiterTabId1: tab.id,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "ziprecruiterStartApplying") {
            chrome.tabs.create(
              {
                url: request.data.url,
                active: request.data.selected !== false,
              },
              async function (tab) {
                // ziprecruiterTabId = tab.id;
                // ziprecruiterBaseUrl = request.data.ziprecruiterBaseUrl;
                let sampleObject = {
                  ziprecruiterTabId: tab.id,
                  ziprecruiterBaseUrl: request.data.ziprecruiterBaseUrl,
                };

                saveObjectInLocalStorage(sampleObject);
              }
            );
            return true;
          } else if (request.message == "ziprecruiterFiltersFetched") {
            console.log("ziprecruiterFetchFilters");
          }
        }
      });
      return true;
    } else {
      if ("global" in request) {
        if (request.message == "currentTabId") {
          console.log("currenttabid");
          waitForTabId().then(async (id) => {
            if (id != -1) {
              console.log("tabid", id);
              await waitForSetting(id);
              console.log("waited for saved setting");
              sendResponse({ globalTabId: id });
            }
          });
          return true;
        }
        if (request.message == "getEmployeesReferral") {
          chrome.tabs
            .create({
              url: request.url,
              active: true,
              active: true,
            })
            .then((tab) => {
              chrome.tabs.onUpdated.addListener(function (
                tabId,
                changeInfo,
                updatedTab
              ) {
                if (tabId === tab.id && changeInfo.status === "complete") {
                  console.log("updated", updatedTab.id, tab.id);
                  chrome.tabs.onUpdated.removeListener(arguments.callee);
                  chrome.tabs.sendMessage(tab.id, {
                    ...request,
                    tabId: tab.id,
                    message: "getEmployees",
                  });
                }
              });
            });
          return true;
        }
      } else if ("linkedin" in request) {
        if (request.message == "resetlinkedin") {
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],

              linkedinResumeId: "",
              linkedinb: 0,
              uniquesessionid: null,
              linkedinSessionId: null,
              sessionIdSaved: null,
              linkedinData: {},
              linkedinJobLinks: [],
              linkedinLinkNo: 0,
              linkedinLimit: 0,
              linkedinBaseUrl: "",
              linkedinFetchFilters: 0,
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        } else if (request.message == "openSettingsUrl") {
          chrome.storage.local.set(
            {
              linkedinResumeSelection: 1,
            },
            function () {
              chrome.tabs.create({
                url: request.url,
                active: true,
                active: true,
              });
            }
          );
        }
      } else if ("dice" in request) {
        if (request.message == "resetdice") {
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              diceResumeId: "",
              diceb: 0,
              diceSessionId: null,
              sessionIdSaved: null,
              uniquesessionid: null,
              diceData: {},
              diceJobLinks: [],
              diceLinkNo: 0,
              diceLimit: 0,
              diceBaseUrl: "",
              diceFetchFilters: 0,
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        }
      } else if ("indeed" in request) {
        if (request.message == "resetUA") {
          console.log("reset ua");
          resetUA(indeedString);
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        } else if (request.message == "resetindeed") {
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              indeedSessionId: null,
              sessionIdSaved: null,
              indeedResumeId: "",
              value: 0,
              data: {},
              jobLinks: [],
              linkNo: 0,
              limit: 0,
              fetchFilters: 0,
              baseURL: "",
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
              indeedSetFilters: null,
            },
            () => {
              console.log("storage resetted");
            }
          );
        }
      } else if ("glassdoor" in request) {
        if (request.message == "resetglassdoor") {
          console.log("reset glassdoor");
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              glassdoorResumeId: "",
              glassdoorb: 0,
              glassdoorSessionId: null,
              sessionIdSaved: null,
              glassdoorLocation: "",
              uniquesessionid: null,
              glassdoorData: {},
              glassdoorJobLinks: [],
              glassdoorLinkNo: 0,
              glassdoorLimit: 0,
              glassdoorResumeUrlId: "",
              glassdoorBaseUrl: "",
              glassdoorFetchFilters: 0,
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        }
      } else if ("seek" in request) {
        if (request.message == "resetseek") {
          console.log("reset seek");
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              seekResumeId: "",
              seekb: 0,
              seekLocation: "",
              uniquesessionid: null,
              seekData: {},
              seekJobLinks: [],
              seekLinkNo: 0,
              seekLimit: 0,
              seekBaseUrl: "",
              seekFetchFilters: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        }
      } else if ("careerBuilder" in request) {
        if (request.message == "resetcareerBuilder") {
          console.log("reset careerBuilder");
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              careerBuilderResumeId: "",
              careerBuilderb: 0,
              careerBuilderSessionId: null,
              sessionIdSaved: null,
              careerBuilderLocation: "",
              uniquesessionid: null,
              careerBuilderData: {},
              careerBuilderJobLinks: [],
              careerBuilderLinkNo: 0,
              careerBuilderLimit: 0,
              careerBuilderBaseUrl: "",
              careerBuilderFetchFilters: 0,
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        }
      } else if ("monster" in request) {
        if (request.message == "resetmonster") {
          console.log("reset monster");
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              monsterResumeId: "",
              monsterb: 0,
              monsterLocation: "",
              uniquesessionid: null,
              monsterData: {},
              monsterJobLinks: [],
              monsterLinkNo: 0,
              monsterLimit: 0,
              monsterBaseUrl: "",
              monsterFetchFilters: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        }
      } else if ("foundit" in request) {
        if (request.message == "resetfoundit") {
          console.log("resetting foundit", request);
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              founditResumeId: "",
              founditb: 0,
              founditLocation: "",
              uniquesessionid: null,
              founditData: {},
              founditJobLinks: [],
              founditLinkNo: 0,
              founditLimit: 0,
              founditBaseUrl: "",
              founditFetchFilters: 0,
              closedUrl: "",
            },
            () => {
              console.log("storage resetted");
            }
          );
        }
      } else if ("simplyHired" in request) {
        if (request.message == "resetsimplyHired") {
          console.log("resetting simplyHired", request);
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              simplyHiredResumeId: "",
              simplyHiredb: 0,
              simplyHiredSessionId: null,
              sessionIdSaved: null,
              simplyHiredLocation: "",
              uniquesessionid: null,
              simplyHiredData: {},
              simplyHiredJobLinks: [],
              simplyHiredLinkNo: 0,
              simplyHiredLimit: 0,
              simplyHiredBaseUrl: "",
              simplyHiredFetchFilters: 0,
              closedUrl: "",
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        }
      } else if ("ziprecruiter" in request) {
        if (request.message == "resetziprecruiter") {
          chrome.storage.local.set(
            {
              excludeKeywords: [],
              mayIncludeKeywords: [],
              ziprecruiterResumeId: "",
              ziprecruiterb: 0,
              ziprecruiterSessionId: null,
              sessionIdSaved: null,
              ziprecruiterData: {},
              ziprecruiterJobLinks: [],
              ziprecruiterLinkNo: 0,
              ziprecruiterApplyButtonsLength: 0,
              ziprecruiterLimit: 0,
              ziprecruiterBaseUrl: "",
              ziprecruiterFetchFilters: 0,
              resumeJobScore: 0,
              userProvidedJobTitle: "",
              unappliedJobsDueToScore: 0,
            },
            () => {
              console.log("storage resetted");
            }
          );
        } else if (request.message == "totalUnappliedJobsDueToResumeScore") {
          chrome.storage.local.get(["unappliedJobsDueToScore"], (result) => {
            if (chrome.runtime.lastError) {
              // console.error(chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError });
            } else {
              const responseData = {
                success: true,
                data: result,
              };

              sendResponse(responseData);
            }
          });

          return true;
        }
      }
    }
  } else if (request.type === "START_AUTOMATION") {
    console.log("helloooo");

    const links = request.data.map((job) => ({
      companyName: job.companyName,
      title: job.title,
      jobId: job.jobId,
      url: workdayEnglishUrl(job.link),
      jobBoard: detectJobBoard(job.link),
      status: "pending",
      currentState: "initial",
      analyticCall: false,
      emailStatus: "pending",
      error: null,
      current_progress: 0,
    }));

    // Long job lists (400+) are worked through by several tabs at once.
    const parallelMeta = {
      emailApplyOption:
        request.emailApplyOption !== undefined && request.emailApplyOption !== null
          ? request.emailApplyOption
          : false,
      emailApplyDetails: request.emailApplyDetails ? { ...request.emailApplyDetails } : {},
    };
    if (globalThis.LazyParallel && links.length >= globalThis.LazyParallel.MIN_JOBS) {
      chrome.storage.local.set(
        {
          workdayEmail: request?.workdayEmail || "",
          routeHeaders: request?.routeHeaders || {},
          resumeMeta: request.resumeMeta,
          trendingQuestions: request?.trendingQuestions || [],
          applicationSessionId: request.sessionId,
        },
        () => {
          globalThis.LazyParallel.start(request, links, parallelMeta).then((r) => {
            if (!r) return startSingleRun();
            chrome?.power?.requestKeepAwake("display");
            sendResponse({ message: "automationStarted", tabId: r.tabId, parallelTabs: r.tabs });
          }, startSingleRun);
        }
      );
      return true;
    }
    startSingleRun();
    function startSingleRun() {
    chrome.storage.local.set(
      {
        workdayEmail: request?.workdayEmail || "",
        routeHeaders: request?.routeHeaders || {},
        resumeMeta: request.resumeMeta,
        trendingQuestions: request?.trendingQuestions || [],
        automationControlMessage: "",
        automationControlJobDetails: {
          companyName: "",
          title: "",
        },
        automationControlProgressBar: false,
        applicationSessionId: request.sessionId,
        applicationState: {
          emailApplyOption:
            request.emailApplyOption !== undefined &&
              request.emailApplyOption !== null
              ? request.emailApplyOption
              : false,
          emailApplyDetails: request.emailApplyDetails
            ? { ...request.emailApplyDetails }
            : {},
          links,
          currentIndex: 0,
          failedLinks: [],
          isAutomationActive: true,
        },
      },
      () => {
        // Create new tab after state is set
        // display awake
        chrome?.power?.requestKeepAwake("display");
        openAutomationTab(links[0].url).then((tab) => {
          if (!tab) {
            console.error("Failed to create automation tab");
            sendResponse({ error: "Failed to create tab" });
            return;
          }
          chrome.storage.local.set({ automationTabId: tab.id }, () => {
            // Start the timeout monitoring
            startTimeoutMonitoring();
            sendResponse({ message: "automationStarted", tabId: tab.id });
          });
        });
      }
    );
    }

    return true;
  } else if (request.type === "STOP_AUTOMATION") {
    const legacyStop = () => {
      // Stop timeout monitoring
      stopTimeoutMonitoring();

      chrome.storage.local.get("automationTabId").then(async (state) => {
        try {
          if (state.automationTabId)
            await chrome.tabs.remove(state.automationTabId);
        } catch (error) {
          console.log("Automation tab was already closed");
        }
        sendResponse({ message: "stopped" });
      });
    };
    if (globalThis.LazyParallel && globalThis.LazyParallel.stopFromDashboard(sendResponse, legacyStop)) return true;
    legacyStop();
    return true;
  } else if (request.type === "Scanning_Jobs") {
    console.log("helloooo");

    chrome.storage.local.set(
      {
        scrapingStarted: true,
        jobLimitV2: request.jobLimitV2,
        platform: request.platform,
        filtersRaw: request.filtersRaw,
        token: request.token,
        sessionId: request.sessionId,
        resumeMeta: request.resumeMeta,
        filters: request.filters,
        jobTitle: request.jobTitle,
        jobLocation: request.jobLocation,
        filtersAppliedV2: 0,
        glassdoorLocationAppliedV2: 0,
        routeHeaders: request?.routeHeaders || {},
      },
      () => {
        // display awake
        chrome?.power?.requestKeepAwake("display");
        chrome.tabs.create(
          {
            url: request.url,
            // url: "https://www.linkedin.com/jobs/search/?currentJobId=4117372060&distance=25&f_AL=true&geoId=102713980&keywords=Software%20Developer&origin=JOB_COLLECTION_PAGE_KEYWORD_HISTORY&refresh=true",
          },
          (tab) => {
            if (chrome.runtime.lastError || !tab) {
              console.error("Failed to create scanning tab");
              sendResponse({ error: "Failed to create tab" });
              return;
            }
            chrome.storage.local.set({ automationTabId1: tab.id }, () => {
              sendResponse({ message: "automationStarted", tabId: tab.id });
            });
          }
        );
      }
    );

    return true;
  }
});

// fetch() with a few retries for network errors and 5xx / 429 answers.
async function fetchWithRetry(url, options, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        return response;
      }
      lastError = new Error(`HTTP error! status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts - 1) await sleepMs(800 * (attempt + 1));
  }
  throw lastError;
}

const fn = (message) => {
  if (message === "APPLYFROMHERE_DEBUG_1") {
    console.log("tab close applyfromhere_debug");
    linkedinUpdateUrl("index.html");
  }
};

async function upload(blob, api, token, message = "") {
  // const { data } = await axios.get(api, {
  //   headers: { Authorization: `Bearer ${token}` },
  // });
  const response = await fetch(api, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error("Network response was not ok");
  }

  const data = await response.json();
  console.log("data", data);

  if ("error" in data) {
    console.log("url not found, some error occured");
    fn(message);
  } else {
    const url = data.url;
    console.log("data", data, data.url);
    fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": blob.type,
      },
      body: blob,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        console.log("blob uploaded successfully", response.data);
        fn(message);
      })
      .catch((error) => {
        console.log("blob uploaded error", error.message);
        fn(message);
      });

    // axios
    //   .put(url, blob, {
    //     headers: {
    //       "Content-Type": blob.type,
    //     },
    //   })
    //   .then((response) => {
    //     console.log("blob uploaded successfully", response.data);
    //     fn(message);
    //   })
    //   .catch((error) => {
    //     console.log("blob uploaded error", error.message);
    //     fn(message);
    //   });
  }
}

async function uploadDebug(blob, api, token) {
  // const { data } = await axios.get(api, {
  //   headers: { Authorization: `Bearer ${token}` },
  // });
  const response = await fetch(api, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error("Network response was not ok");
  }

  const data = await response.json();
  console.log(data);

  if ("error" in data) {
    console.log("url not found, some error occured");
  } else {
    const url = data.url;
    console.log("data", data, data.url);
    // axios
    //   .put(url, blob, {
    //     headers: {
    //       "Content-Type": blob.type,
    //     },
    //   })
    //   .then((response) => {
    //     // alert("success");
    //     console.log("blob uploaded successfully", response.data);
    //   })
    //   .catch((error) => {
    //     // alert("some error occured");
    //     console.log("blob uploaded error", error.message);
    //   });
    // axios
    //   .put(url, blob, {
    //     headers: {
    //       "Content-Type": blob.type,
    //     },
    //   })
    //   .then((response) => {
    //     // alert("success");
    //     console.log("blob uploaded successfully", response.data);
    //   })
    //   .catch((error) => {
    //     // alert("some error occured");
    //     console.log("blob uploaded error", error.message);
    //   });
  }
}

let loadcall = 0;
let applycall0 = 0;
let applycall1 = 0;
let applycall3 = 0;
// The original message handler. Messages from parallel-applying worker tabs
// are taken by parallelApply.js first; everything else comes here unchanged.
const legacyOnMessage = (request, sender, sendResponse) => {
  if (request.type === "GET_CURRENT_TAB") {
    // Wait for the saved list so a freshly restarted worker does not answer
    // with an empty one.
    smartApplyTabsReady.then(() => {
      sendResponse({
        tabId: sender.tab?.id,
        indeedSmartApplyTabs: indeedSmartApplyTabs,
      });
    });
    return true;
  }

  if (request.type === "OPEN_NEXT_LINK") {
    const url = request.url;
    (async () => {
      try {
        const result = await new Promise((resolve) =>
          chrome.storage.local.get("automationTabId", resolve)
        );
        const automationTabId = result.automationTabId;

        let jobBoard = detectJobBoard(url);
        if (jobBoard && jobBoard === "glassdoor") {
          const state = await chrome.storage.local.get("applicationState");
          const tabId = state.applicationState?.toBeClosedTabId;
          if (tabId) {
            const updatedState = {
              applicationState: {
                ...(state.applicationState || {}),
                toBeClosedTabId: "",
                isAutomationActive: true,
              },
            };
            await chrome.storage.local.set(updatedState);
            await chrome.tabs.remove(tabId);
          }
        }

        if (automationTabId) {
          await closeAutomationChildTabs(automationTabId);
          try {
            const updatedTab = await new Promise((resolve, reject) => {
              chrome.tabs.update(
                automationTabId,
                { url: url, active: true },
                (tab) => {
                  if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                  } else {
                    resolve(tab);
                  }
                }
              );
            });

            console.log("Updated automation tab:", updatedTab);
            sendResponse({ success: true, tabId: updatedTab.id });
          } catch (error) {
            console.error("Error updating tab:", error);
            // Uncomment if you want fallback behavior
            // await createNewAutomationTab(url);
            sendResponse({ success: false, error: error.message });
          }
        } else {
          console.log("No automation tab ID found");
          sendResponse({
            success: false,
            reason: "No automation tab ID found",
          });
        }
      } catch (error) {
        console.error("Error in OPEN_NEXT_LINK handler:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep the message channel open for async response
  }

  if (request.type == "REMOVE_TAB_AND_MAKE_FOCUS_ON_AUTOMATION_TAB") {
    if (request.tabId)
      chrome.tabs.remove(request.tabId, function () {
        try {
          chrome.storage.local
            .get("automationTabId")
            .then((response) => {
              if (response.automationTabId) {
                chrome.tabs.update(
                  response.automationTabId,
                  { active: true },
                  () => {
                    sendResponse({
                      success: true,
                      message: "Automation tab focused successfully.",
                    });
                  }
                );
              } else {
                sendResponse({
                  success: false,
                  message: "Automation tab ID not found in storage.",
                });
              }
            })
            .catch((err) => {
              console.error("Error retrieving automationTabId:", err);
              sendResponse({
                success: false,
                message: "Failed to retrieve automationTabId.",
              });
            });
        } catch (err) {
          console.error("Error in updating globalTabId:", err);
          sendResponse({
            success: false,
            message: "An unexpected error occurred.",
          });
        }
      });

    return true;
  }

  if (request.type === "UPDATE_LOCATION_DICE") {
    chrome.tabs.update(parseInt(sender.tab.id), {
      active: true,
      url: request.location,
      active: true,
    });
  }

  if (request.type === "AUTOMATION_COMPLETE") {
    handleAutomationComplete(sender.tab.id);
    return true;
  }

  if (request.type === "AUTOMATION_CONTROL") {
    if (request.action === "PAUSE" || request.action === "RESUME") {
      const isPaused = request.action === "PAUSE";
      console.log(`Automation ${isPaused ? "paused" : "resumed"}`);

      // Update application state using Promises
      chrome.storage.local.get("applicationState", function (state) {
        if (state.applicationState) {
          state.applicationState.isPaused = isPaused;

          chrome.storage.local.set(
            { applicationState: state.applicationState },
            function () {
              chrome.storage.local.get("automationTabId", function (tabState) {
                if (tabState.automationTabId) {
                  chrome.tabs.sendMessage(tabState.automationTabId, {
                    type: "AUTOMATION_STATE_CHANGED",
                    isPaused: isPaused,
                  });
                }
              });
            }
          );
        }
      });
    }
  }

  if (request.type === "QUIT_AUTOMATION_BUTTON") {
    closedTabId = sender.tab.id;
    chrome.tabs.remove(sender.tab.id, function () {
      if (chrome.runtime.lastError) {
        console.log("Quit: tab already closed");
      }
      try {
        getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
          console.log(storageResult, "storage result");
          if (storageResult.globalTabId)
            chrome.tabs.update(storageResult.globalTabId, { active: true });
        });
      } catch (err) {
        console.log("Error in updating globalTabId");
      }
    });
  }

  if (request.type === "AUTOMATION_CONTROL_TAB") {
    chrome.tabs
      .sendMessage(request.tabId, {
        ...request.message,
      })
      .then(() => {
        sendResponse({ message: "success" });
      })
      .catch((error) => {
        sendResponse({ message: "error", error: error.message });
      });

    return true;
  }

  if (request.type === "INJECT_EMAIL_MODAL") {
    const tabId = sender.tab.id;
    executeScripts(tabId, [
      { file: "jquery.min.js" },
      { file: "inject-email-automation-template.js" },
      { file: "emailVars.js" },
      { file: "emailAutomationTemplate.bundle.js" },
    ]);
  }

  if (request.type === "EMAIL_AUTOMATION_COMPLETE") {
    // Send to the automation tab
    chrome.tabs.sendMessage(sender.tab.id, {
      type: "EMAIL_AUTOMATION_COMPLETE",
      data: request.data,
    });
  }

  if (request.type === "MAKE_ANALYTICS_CALL") {
    // Make analytics call from background script (survives page redirects)
    (async () => {
      const doesUrlMatchPattern = (url, pattern) => {
        if (pattern.endsWith("*")) {
          return url.startsWith(pattern.slice(0, -1));
        }
        return url === pattern;
      };

      const getHeadersForUrl = (routeHeaders, url) => {
        const headers = {};
        if (!routeHeaders || typeof routeHeaders !== "object") {
          return headers;
        }

        for (const [route, routeHeaderMap] of Object.entries(routeHeaders)) {
          if (doesUrlMatchPattern(url, route)) {
            Object.assign(headers, routeHeaderMap);
            break;
          }
        }

        return headers;
      };

      try {
        // Check if analytics already completed to prevent duplicate calls
        // A worker tab of a parallel run keeps its own copy of the state.
        const K = globalThis.LazyParallel
          ? await globalThis.LazyParallel.keysFor(sender)
          : { state: "applicationState", pending: "pendingAnalytics" };
        const raw = await chrome.storage.local.get([K.state, "routeHeaders"]);
        const state = { applicationState: raw[K.state], routeHeaders: raw.routeHeaders };
        if (state?.applicationState?.links) {
          const currentIndex = state.applicationState.currentIndex;
          if (
            state.applicationState.links[currentIndex] &&
            state.applicationState.links[currentIndex].analyticCall
          ) {
            console.log("Analytics already completed, skipping duplicate call");
            sendResponse({ success: true, skipped: true });
            return;
          }
        }

        const apiUrl = `https://backend.lazyapply.com/lazyapplyV2/job-applications/${request.v2Id}`;
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${request.token}`,
            ...getHeadersForUrl(state.routeHeaders || {}, apiUrl),
          },
          body: JSON.stringify(request.analyticsData),
        });

        if (response.ok) {
          console.log("Analytics call successful from background script");
          sendResponse({ success: true });

          // Update state to mark analytics as complete (double-check to prevent race conditions)
          const updatedRaw = await chrome.storage.local.get(K.state);
          const updatedState = { applicationState: updatedRaw[K.state] };
          if (updatedState?.applicationState?.links) {
            const currentIndex = updatedState.applicationState.currentIndex;
            if (
              updatedState.applicationState.links[currentIndex] &&
              !updatedState.applicationState.links[currentIndex].analyticCall
            ) {
              updatedState.applicationState.links[currentIndex].analyticCall = true;
              await chrome.storage.local.set({
                [K.state]: updatedState.applicationState,
              });
            }
          }

          // Clear pending analytics
          await chrome.storage.local.remove(K.pending);
        } else {
          console.error("Analytics call failed:", response.statusText);
          sendResponse({ success: false, error: response.statusText });
        }
      } catch (error) {
        console.error("Error making analytics call:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (request.type == "AUTOMATION_CONTROL_INJECT") {
    (async () => {
      try {
        const currentTabId = sender.tab.id;
        const checkIfCurrentTabIdIsOpenedFromAutomationTabId = () => {
          return indeedSmartApplyTabs.some(
            (tab) =>
              tab.id === currentTabId && tab.openerTabId === request.tabId
          );
        };

        await new Promise((resolve) => {
          executeScripts(
            request.tabId,
            [
              { file: "jquery.min.js" },
              { file: "inject-autofill-template.js" },
              { file: "autoFillTemplate.bundle.js" },
            ],
            () => {
              console.log("Autofill Button Added");
              resolve();
            }
          );
        });

        if (checkIfCurrentTabIdIsOpenedFromAutomationTabId()) {
          await new Promise((resolve) => {
            executeScripts(
              currentTabId,
              [
                { file: "jquery.min.js" },
                { file: "inject-autofill-template.js" },
                { file: "autoFillTemplate.bundle.js" },
              ],
              () => {
                console.log("Autofill Button Added");
                resolve();
              }
            );
          });
        }

        sendResponse({ message: "added success" });
      } catch (error) {
        console.error("Error injecting scripts:", error);
        sendResponse({ message: "error", error: error.message });
      }
    })();

    return true;
  }

  if (request.type == "SHOW_SCANNING_POPUP") {
    showScanningPopupV2();
  }

  if (request.type == "SCRAPPING_COMPLETE") {
    const handleScrappingComplete = async () => {
      try {
        const storageResult = await getObjectFromLocalStorage([
          "globalTabId",
          "automationTabId1",
        ]);

        if (!storageResult.globalTabId) {
          return { status: "error", message: "Global tab ID does not exist" };
        }

        const results = {
          type: "SCANNING_RESULTS",
          data: {
            jobLinks: request?.jobsMain || [],
            platform: request.platform,
          },
        };

        chrome.tabs.sendMessage(Number(storageResult.globalTabId), results);

        if (storageResult.automationTabId1) {
          await new Promise((resolve) => {
            chrome.tabs.remove(storageResult.automationTabId1, () => {
              chrome.tabs.update(Number(storageResult.globalTabId), {
                active: true,
              });
              resolve();
            });
          });
          return {
            status: "success",
            message: "Data processed and tab removed",
          };
        }

        return { status: "success", message: "Data processed" };
      } catch (error) {
        return {
          status: "error",
          message: error.message || "An error occurred",
        };
      }
    };

    handleScrappingComplete().then((response) => {
      resetHandleScrappingComplete();
      sendResponse(response);
    });

    return true;
  }

  if (request?.method == "getFile") {
    fetchWithRetry(request.fileURL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        console.log("response", response);
        let type = response.headers.get("Content-Type") || "";
        let extension = "";

        if (
          !type ||
          type === "application/octet-stream" ||
          type === "binary/octet-stream"
        ) {
          const lowerName = String(request.name || "").toLowerCase();
          if (lowerName.endsWith(".pdf") || lowerName.includes("pdf")) {
            type = "application/pdf";
          } else if (lowerName.endsWith(".docx")) {
            type =
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          } else if (lowerName.endsWith(".doc")) {
            type = "application/msword";
          } else if (lowerName.endsWith(".txt")) {
            type = "text/plain";
          } else if (
            lowerName.endsWith(".html") ||
            lowerName.endsWith(".htm")
          ) {
            type = "text/html";
          } else {
            type = "application/pdf";
          }
        }

        if (type === "application/pdf") {
          extension = ".pdf";
        } else if (
          type ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ) {
          extension = ".docx";
        } else if (type === "application/msword") {
          extension = ".doc";
        }

        let fileName = String(request.name || "resume");
        if (!fileName.toLowerCase().endsWith(extension)) {
          fileName = fileName + extension;
        }
        return response
          .arrayBuffer()
          .then((arrayBuffer) => ({ type, arrayBuffer, fileName }));
      })
      .then((fileData) => {
        // Convert the arrayBuffer to Array
        console.log("fileData", fileData);
        fileData.arrayBuffer = Array.from(new Uint8Array(fileData.arrayBuffer));
        console.log("final response", fileData);
        sendResponse(fileData);
      })
      .catch((error) => {
        console.error(error);
        sendResponse(null);
      });

    // Indicate that the response is sent asynchronously
    return true;
  }

  if (
    "referral" in request &&
    request.message == "showReferralAutomationPopup"
  ) {
    showReferralAutomationPop(request.tabId);
  }
  if ("referral" in request && request.message == "removeTab") {
    getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
      if (storageResult.globalTabId)
        chrome.tabs
          .sendMessage(storageResult.globalTabId, {
            referral: true,
            message: "employeesData",
            employeesData: request.employeesData,
          })
          .then(() => {
            chrome.tabs.remove(request.tabId, function () {
              chrome.tabs.update(storageResult.globalTabId, { active: true });
            });
          });
    });
  }

  if ("debug" in request && request?.uniquesessionid) {
    if (request.message === "SUBMITAPPLICATION_CALL") {
      // console.info("maindatalinkedin0", request.message, request.datamain);
      // if (Object.keys(request.datamain).length > 0) {
      //   const email = Object.keys(request.datamain)[0];
      //   if ("linkedin" in request.datamain[email]) {
      //     datamainlinkedin = {
      //       [email]: {
      //         linkedin: {
      //           ...datamainlinkedin?.[email]?.linkedin,
      //           ...request.datamain[email]?.linkedin,
      //         },
      //       },
      //     };
      //   } else {
      //     datamainlinkedin = {
      //       [email]: {
      //         indeed: {
      //           ...datamainlinkedin?.[email]?.indeed,
      //           ...request.datamain[email]?.indeed,
      //         },
      //       },
      //     };
      //   }
      // }
      // console.info("maindatalinkedin", datamainlinkedin);
    }
    if (request.message1 === "SKIP_APPLICATION_CALL") {
      // if (Object.keys(request.datamain).length > 0) {
      //   const email = Object.keys(request.datamain)[0];
      //   if ("linkedin" in request.datamain[email]) {
      //     datamainlinkedin = {
      //       [email]: {
      //         linkedin: {
      //           ...datamainlinkedin?.[email]?.linkedin,
      //           ...request.datamain[email]?.linkedin,
      //         },
      //       },
      //     };
      //   }
      // }
    }
    if (request.message === "START_SESSION") {
      // if (Object.keys(request.datamain).length > 0) {
      //   const email = Object.keys(request.datamain)[0];
      //   if ("linkedin" in request.datamain[email]) {
      //     datamainlinkedin = {
      //       [email]: {
      //         linkedin: {
      //           ...datamainlinkedin?.[email]?.linkedin,
      //           ...request.datamain[email]?.linkedin,
      //         },
      //       },
      //     };
      //   }
      // }
    }
    if (request.message === "SUBMITAPPLICATION_CALL_RESTART") {
      // debugSessionJobs.push(request?.link);
      // if (Object.keys(request.datamain).length > 0) {
      //   const email = Object.keys(request.datamain)[0];
      //   if ("linkedin" in request.datamain[email]) {
      //     datamainlinkedin = {
      //       [email]: {
      //         linkedin: {
      //           ...datamainlinkedin?.[email]?.linkedin,
      //           ...request.datamain[email]?.linkedin,
      //         },
      //       },
      //     };
      //   } else {
      //     datamainlinkedin = {
      //       [email]: {
      //         indeed: {
      //           ...datamainlinkedin?.[email]?.indeed,
      //           ...request.datamain[email]?.indeed,
      //         },
      //       },
      //     };
      //   }
      // }
      // console.info("maindatalinkedin", datamainlinkedin);
    }

    if (request.message === "ONLOAD_CALL") {
      // debugObj.api = request.api;
      // debugObj.token = request.token;
      // debugObj.sessionId = request.uniquesessionid;
      // if (request.uniquesessionid in debugObj) {
      //   debugObj[request.uniquesessionid].platformName = request.platformName;
      //   debugObj[request.uniquesessionid][request.message] = request.details;
      // } else {
      //   debugObj[request.uniquesessionid] = {
      //     [request.message]: request.details,
      //     platformName: request.platformName,
      //   };
      // }
      // console.log("onloadcall", request.details);
    }
    if (request.message === "SETUSERDATA_CALL") {
      // debugObj.email = request.email;
      // debugObj[request.uniquesessionid].email = request.email;
    } else if (
      request.message === "CHECKSELECTOR_CALL_1" ||
      request.message === "CHECKSELECTOR_CALL"
    ) {
      console.log("joblinkslength", request?.linkedinJobLinks?.length);
      // console.log('linkedinjoblinks', request?.linkedinJobLinks)
      // if (request.element) {
      //   let blob = new Blob([request.element], {
      //     type: "text/html;charset=utf-8",
      //   });
      //   if (applycall3 === 0) {
      //     applycall3 = 1;
      //     upload(blob, request.uploadapi, request.token, request.message);
      //   }
      // }
      // if (request.uniquesessionid in debugObj) {
      //   if ("check" in debugObj[request.uniquesessionid]) {
      //     debugObj[request.uniquesessionid].check.push({
      //       [request.message]: request.details,
      //     });
      //   } else {
      //     const a = [];
      //     a.push({
      //       [request.message]: request.details,
      //     });
      //     debugObj[request.uniquesessionid].check = a;
      //   }
      // }
    } else if (
      request.message === "APPLYFROMHERE_CALL" ||
      request.message === "APPLYFROMHERE_DEBUG_1"
    ) {
      // if (request.element) {
      //   let blob = new Blob([request.element], {
      //     type: "text/html;charset=utf-8",
      //   });
      //   if (applycall1 === 0) {
      //     applycall1 = 1;
      //     upload(blob, request.uploadapi, request.token, request.message);
      //   }
      // }
      // debugObj[request.uniquesessionid][request.message] = request.details;
    } else if (request.message === "APPLYFROMHERE_DEBUG_0") {
      // if (request.element) {
      //   let blob = new Blob([request.element], {
      //     type: "text/html;charset=utf-8",
      //   });
      //   if (applycall0 === 0) {
      //     applycall0 = 1;
      //     upload(blob, request.uploadapi, request.token, request.message);
      //   }
      // }
      // debugObj[request.uniquesessionid][request.message] = request.details;
    } else {
      // debugObj[request.uniquesessionid][request.message] = request.details;
    }
  }
  if ("linkedinSendEmail" in request) {
    if (request.message == "showPopup") {
      const tabId = sender.tab.id;
      console.log("linkedinSendEmailTabId", tabId);
      executeScripts(
        tabId,
        [
          { file: "bootstrap.min.js" },
          { file: "bootstrap.min.css" },
          { file: "jquery.min.js" },
          { file: "inject-linkedinSendEmailTemplate.js" },
          { file: "linkedinSendEmail.bundle.js" },
        ],
        () => {
          console.log("added linkedinSendEmailTemplate");
        }
      );
    }
    if (
      request.message == "firstResumeSetForJobQ" ||
      request.message == "firstResumeSetForReferralQ"
    ) {
      const tabId = sender.tab.id;
      console.log("send to tab linkedinsendemail", tabId);
      chrome.tabs.sendMessage(tabId, {
        ...request,
      });
    }
    if (
      request.message == "openModal" ||
      request.message == "openSettingsModal" ||
      request.message == "openFeedbackModal" ||
      request.message == "openLimitReachedModal" ||
      request.message == "openNoAccessModal" ||
      request.message == "job-openModal" ||
      request.message == "job-openSettingsModal" ||
      request.message == "job-openFeedbackModal" ||
      request.message == "job-openLimitReachedModal" ||
      request.message == "job-openNoAccessModal" ||
      request.message == "job-openReferralSettingsModal" ||
      request.message == "referral-openModal" ||
      request.message == "referral-openSettingsModal" ||
      request.message == "referral-openFeedbackModal" ||
      request.message == "referral-openLimitReachedModal" ||
      request.message == "referral-openNoAccessModal" ||
      request.message == "referral-openReferralSettingsModal"
    ) {
      const tabId = sender.tab.id;
      console.log("send to tab linkedinsendemail", tabId);
      chrome.tabs.sendMessage(tabId, {
        ...request,
      });
    }
  }
  if ("autoFill" in request) {
    if (request.message == "showAutofillBar") {
      const tabId = sender.tab.id;
      executeScripts(
        tabId,
        [
          { file: "jquery.min.js" },
          { file: "inject-autofill-template.js" },
          { file: "autoFillTemplate.bundle.js" },
        ],
        () => {
          console.log("Autofill Button Added");
        }
      );
    }

    if (request.message == "Script_Finished") {
      console.log("hello there");
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
          autoFill: true,
          message: "Script has finished",
        });
      });
    }

    if (request.message == "speed_changed") {
      console.log("hello there");
      chrome.storage.local.get("automationTabId", (result) => {
        if (result.automationTabId) {
          chrome.tabs
            .sendMessage(result.automationTabId, {
              message: "Update the timer",
              timer: request.speed,
            })
            .catch((error) => {
              console.log(
                "Tab not ready yet, will retry when content script loads"
              );
            });
        }
      });

      // chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      //   chrome.tabs.sendMessage(tabs[0].id, {
      //     autoFill: true,
      //     message: "Update the timer",
      //     timer: request.speed,
      //   });
      //   console.log("Sent new timer value to tabs:", request.speed);
      // });
    }

    if (request.message == "autoFillInThisTab") {
      console.log("Autofilling Now", request.message);
      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        async (tabs) => {
          if (tabs[0]?.id) {
            const mainid = tabs[0]?.id;

            const sampleObject = {
              automationMainTabId: mainid,
            };
            // console.log(linkedinBaseUrl, linkedinTabId);
            console.log("automation tab id saved");
            await saveObjectInLocalStorage(sampleObject);

            chrome.webNavigation.getAllFrames(
              {
                tabId: mainid,
              },
              (response) => {
                console.log("response", response);

                const allFrameIds = response.filter((x) => {
                  const matchedAllUrls = allUrls.some((urlPattern) => {
                    const regex = new RegExp(
                      urlPattern.replace(/\*/g, ".*"),
                      "i"
                    );
                    return regex.test(x.url);
                  });

                  const matchedExcludedUrls = allExcludedUrls.some(
                    (urlPattern) => {
                      const regex = new RegExp(
                        urlPattern.replace(/\*/g, ".*"),
                        "i"
                      );
                      return regex.test(x.url);
                    }
                  );

                  if (matchedAllUrls && !matchedExcludedUrls) {
                    return true;
                  }
                });

                console.log("allframeids", allFrameIds);
                // const allFrameIdsMains = allFrameIds.filter(
                //   (x) => x.frameId != 0
                // );

                const frameIds = allFrameIds.map((x) => x.frameId);
                console.log("allnewframeids", frameIds);
                executeScripts(
                  mainid,
                  [
                    { file: "jquery.min.js" },
                    { file: "autoFillScript.bundle.js" },
                  ],
                  () => {
                    console.log("Autofill Script Injected");
                  },
                  frameIds
                );
              }
            );
          }
        }
      );

      return true;
    }
    if (request.message == "getCookie") {
      // Retrieve the CSRF token from the JSESSIONID cookie
      async function getCsrfToken() {
        const cookies = await chrome.cookies.getAll({
          url: "https://www.linkedin.com",
          name: "JSESSIONID",
        });

        if (cookies.length > 0) {
          const csrfToken = cookies[0].value.replace(/"/g, "");
          return csrfToken;
        }

        return null;
      }

      // Main function to execute when the content script runs
      async function main() {
        const csrfToken = await getCsrfToken();
        if (csrfToken) {
          sendResponse({ found: true, token: csrfToken });
        } else {
          sendResponse({ found: false, token: null });
        }
      }

      main();
    }
    if (request.message == "processName") {
      console.log("processName", request, request.automationTabId);
      chrome.tabs.sendMessage(request.automationTabId, {
        ...request,
      });
    }
  }
  if ("profileData" in request) {
    if (request.message == "getCompanyDomains") {
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse(data);
        })
        .catch((error) => {
          console.log(error.message, "error in getting company domains");
          sendResponse([]);
        });
      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse(response.data);
      //   })
      //   .catch((error) => {
      //     console.log(error.message, "error in getting company domains");
      //     sendResponse([]);
      //   });
      return true;
    } else if (request.message == "getCompanyEmails") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          to_emails: request.result,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse(data);
        })
        .catch((error) => {
          console.log(error.message, "error in getting company emails");
          sendResponse([]);
        });
      // axios
      //   .post(
      //     request.api,
      //     JSON.stringify({
      //       to_emails: request.result,
      //     })
      //   )
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse(response.data);
      //   })
      //   .catch((error) => {
      //     console.log(error.message, "error in getting company emails");
      //     sendResponse([]);
      //   });
      return true;
    } else if (request.message == "openViewEmails") {
      chrome.tabs.create({
        url: mainurl,
        active: true,
      });
    } else if (request.message == "getCompanyEmailsFromApollo") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify(request.data),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse(data);
        })
        .catch((error) => {
          console.log(error.message, "error in getting company emails");
          sendResponse({ errorMessage: error?.message });
        });

      // axios
      //   .post(request.api, request.data, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse(response.data);
      //   })
      //   .catch((error) => {
      //     console.log(error.message, "error in getting company emails");
      //     sendResponse({ errorMessage: error?.message });
      //   });
      return true;
    } else if (request.message == "openExtension") {
      chrome.tabs.create({
        url: mainurl,
        active: true,
      });
    }
  } else if ("dice" in request) {
    if (!("message" in request)) {
      console.log("location", request.location, request.diceCount);
      diceUpdateUrl(request.location);
      return true;
    } else if (request.message == "print") {
      console.log("printObj", request.printObj);
    } else if (request.message == "updateLocationUrl") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "executeScript") {
      showAutomationPopup("dice");
    } else if (request.message == "getUserData") {
      console.log("Get user data, dicecall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse({ errorMessage: error?.message });
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        console.log("quit");
        getObjectFromLocalStorage(["diceTabId"]).then((storageResult) => {
          chrome.tabs.remove(parseInt(storageResult.diceTabId), function () {
            console.log("Finally closed tab zip");
          });
        });
      } else {
        saveSession("dice");
      }
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "diceTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "diceSessionId",
        "session",
        "diceMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.diceMessageId) {
          return;
        }
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        } else
          sendResponse("Updated the count on the frontend along with links");

        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        let sessionId = storageResult.diceSessionId;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { diceMessageId: request.messageId },
                function () {
                  console.log("saved diceMessageId as", request.messageId);
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });
      return true;
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["diceTabId1", "globalTabId"]).then(
        (storageResult) => {
          console.log(
            storageResult.diceTabId1,
            "fetch filters complete dice",
            storageResult.globalTabId
          );
          if (storageResult.globalTabId) {
            console.log("send message to tab");
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.diceTabId1, function () {
                  console.log("filters fetched ---- closed dice url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          } else {
            chrome.tabs.remove(storageResult.diceTabId1, function () {
              console.log("filters fetched ---- closed dice url");
            });
          }
        }
      );
      return true;
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        } else {
          sendResponse("Already applied before now restart");
        }
      });

      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, dicecall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse({ error });
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page");
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              diceUpdateUrl(request.link, request.message2);
            });
        } else {
          diceUpdateUrl(request.link, request.message2);
        }
      });
      return true;
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("linkedin" in request) {
    // { baseURL: url,linkedinLimit: numberOfJobs.value, linkedinJobLinks: []},
    if (!("message" in request)) {
      console.log(
        "Background script has received a message from contentscript:'" +
        request.linkedinCount +
        "'"
      );
      console.log("currentpage -->" + request.linkedinCount);
      console.log(request.linkedinData);
      console.log("limit -->" + request.linkedinLimit);
      getObjectFromLocalStorage(["linkedinBaseUrl"]).then((storageResult) => {
        linkedinUpdateUrl(
          `${storageResult.linkedinBaseUrl}&start=${request.linkedinCount * 25}`
        );
      });

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      // linkedinTabId1 = request.tabID;
      let sampleObject = {
        linkedinTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.linkedinTabId, {
          linkedin: "true",
          message: "showFillDetailsMessage",
          name: request.name,
          text: request?.text || "",
        });
      });
      return true;
    } else if (request.message == "hideFillDetailsMessage") {
      getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.linkedinTabId, {
          linkedin: "true",
          message: "hideFillDetailsMessage",
        });
      });

      return true;
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.linkedinTabId, {
          linkedin: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("linkedin");
      return true;
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("linkedin");
      // userDetails = request.data;
      // uploadapidebug = request.uploadapi;
      // uploadapitoken = request.token;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("linkedin", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        console.log("quit");
        getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
          chrome.tabs.remove(
            parseInt(storageResult.linkedinTabId),
            function () {
              console.log("Finally closed tab zip");
            }
          );
        });
      } else {
        saveSession("linkedin");
      }
      return true;
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          linkedinTotalLinks: request.linkedinTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee linkedintotallinks");
            console.log(data.linkedinTotalLinks);
            sendResponse({
              linkedinTotalLinks: data.linkedinTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      // linkedinTabId = request.linkedinTabID;
      // linkedinBaseUrl = request.linkedinBaseUrl;
      const sampleObject = {
        linkedinTabId: request.linkedinTabID,
        linkedinBaseUrl: request.linkedinBaseUrl,
      };
      // console.log(linkedinBaseUrl, linkedinTabId);
      console.log("base url setted");
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_LINKEDIN",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["linkedinTabId", "linkedinTabId1"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.linkedinTabId1,
            storageResult.linkedinTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.linkedinTabId1
              : storageResult.linkedinTabId;
          if (storageResult.linkedinTabId) {
            debugTabId = storageResult.linkedinTabId;
          }
          updateUrlDebug(
            request.link,
            debugTabId,
            request.message2,
            "linkedin"
          );
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page");
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              linkedinUpdateUrl(request.link, request.message2);
            });
        else linkedinUpdateUrl(request.link, request.message2);
      });

      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      linkedinUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, linkedincall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log("data", data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log("error", error);
          sendResponse({ error });
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, linkedincall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "linkedinTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "linkedinSessionId",
        "session",
        "linkedinMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.linkedinMessageId) {
          console.log("returned early from background");
          return;
        }
        if (request.message1 == "hideAutomationButtons") {
          chrome.tabs.sendMessage(storageResult.linkedinTabId, {
            linkedin: "true",
            message: "hideAutomationButtons",
          });
        }
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        } else {
          sendResponse("Updated the count on the frontend along with links");
        }

        console.log("made it here before sending request to backend");
        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.linkedinSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;

        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          console.log("sending request to backend");
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { linkedinMessageId: request.messageId },
                function () {
                  console.log("saved linkedinMessageId as", request.messageId);
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });

      return true;
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        } else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      getObjectFromLocalStorage(["linkedinTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.linkedinTabId, {
          linkedin: "true",
          message: "hideAutomationButtons",
        });
      });

      return true;
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["linkedinTabId1", "globalTabId"]).then(
        (storageResult) => {
          console.log(
            storageResult.linkedinTabId1,
            "fetch filters complete",
            storageResult.globalTabId
          );
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                console.log("response", response);
                chrome.tabs.remove(storageResult.linkedinTabId1, function () {
                  console.log("filters fetched ---- closed linkedin url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          } else {
            chrome.tabs.remove(storageResult.linkedinTabId1, function () {
              console.log("filters fetched ---- closed linkedin url");
            });
          }
        }
      );

      return true;
    } else if (request.message == "resumeArr") {
      console.log("received resume arr", request.resumeArr);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs
          .sendMessage(storageResult.globalTabId, {
            ...request,
          })
          .then(function () {
            chrome.storage.local.set(
              {
                linkedinResumeSelection: 0,
              },
              function () {
                chrome.tabs.remove(sender.tab.id);
              }
            );
          });
      });
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("glassdoor" in request) {
    // { baseURL: url,glassdoorLimit: numberOfJobs.value, glassdoorJobLinks: []},
    console.log("glassdoor has received request", request);
    if (!("message" in request)) {
      console.log(
        "Background script has received a message from contentscript: for pagenumber'" +
        request.pageNumber
      );

      glassdoorUpdateUrl(request.pageNumber);
      return true;
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log(
        "Message received from tab ID: glassdoor",
        tabId,
        request.href
      );
      if (request.href.includes("apply.indeed")) {
        getObjectFromLocalStorage("glassdoorTabId").then(
          async (storageResult) => {
            const previousTabId = storageResult.glassdoorTabId;
            let sampleObject = {
              glassdoorTabId: tabId,
            };
            await saveObjectInLocalStorage(sampleObject);
            console.log("saved now", tabId, previousTabId);
            // saved, now remove
            if (previousTabId !== tabId)
              chrome.tabs.remove(parseInt(previousTabId));
            if (previousTabId !== tabId)
              chrome.tabs.remove(parseInt(previousTabId));
            sendResponse({ message: "Save New Tab Id" });
          }
        );
      } else {
        sendResponse({ message: "Save New Tab Id" });
      }
      return true;
    } else if (request.message == "m5TabOpened") {
      let intervalId = setInterval(() => {
        getObjectFromLocalStorage(["glassdoorTabId"]).then((storageResult) => {
          chrome.tabs.query(
            { active: true, currentWindow: true },
            function (tabs) {
              console.log(
                "comparing current tab with glassdoortab",
                storageResult.glassdoorTabId,
                tabs[0].id
              );
              if (storageResult.glassdoorTabId != tabs[0].id) {
                glassdoorUpdateUrl2("index.html"); // removing current glassdoor tab
                let sampleObject = {
                  glassdoorTabId: tabs[0].id,
                };
                saveObjectInLocalStorage(sampleObject);
                clearInterval(intervalId); // Remove the interval
              }
            }
          );
        });
      }, 1000);
      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        glassdoorTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(glassdoorTabId, {
        glassdoor: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(glassdoorTabId, {
        glassdoor: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["glassdoorTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.glassdoorTabId, {
          glassdoor: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("glassdoor");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("glassdoor");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("glassdoor", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["glassdoorTabId"]).then((storageResult) => {
          console.log("quit");
          chrome.tabs.remove(
            parseInt(storageResult.glassdoorTabId),
            function () {
              console.log("Finally closed tab zip");
            }
          );
        });
      } else {
        saveSession("glassdoor");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          glassdoorTotalLinks: request.glassdoorTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.glassdoorTotalLinks);
            sendResponse({
              glassdoorTotalLinks: data.glassdoorTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        glassdoorTabId: request.glassdoorTabID,
        glassdoorBaseUrl: request.glassdoorBaseUrl,
      };
      saveObjectInLocalStorage(sampleObject);
      // glassdoorTabId = request.glassdoorTabID;
      // glassdoorBaseUrl = request.glassdoorBaseUrl;
      // console.log(glassdoorBaseUrl, glassdoorTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_GLASSDOOR",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["glassdoorTabId1", "glassdoorTabId"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.glassdoorTabId1,
            storageResult.glassdoorTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.glassdoorTabId1
              : storageResult.glassdoorTabId;
          if (storageResult.glassdoorTabId) {
            debugTabId = storageResult.glassdoorTabId;
          }
          updateUrlDebug(
            request.link,
            debugTabId,
            request.message2,
            "glassdoor"
          );
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["glassdoorTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                glassdoorUpdateUrl2(request.link);
              });
          } else {
            glassdoorUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      glassdoorUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, glassdoorcall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, glassdoorcall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "glassdoorTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "glassdoorSessionId",
        "session",
        "glassdoorMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.glassdoorMessageId) {
          return;
        }
        if (request.message1 == "hideAutomationButtons") {
          chrome.tabs.sendMessage(storageResult.glassdoorTabId, {
            glassdoor: "true",
            message: "hideAutomationButtons",
          });
        }
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        else {
          sendResponse("Updated the count on the frontend along with links");
        }

        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.glassdoorSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { glassdoorMessageId: request.messageId },
                function () {
                  console.log("saved glassdoorMessageId as", request.messageId);
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(glassdoorTabId, {
        glassdoor: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "glassdoorTabId1"]).then(
        (storageResult) => {
          console.log(storageResult?.glassdoorTabId1, "fetch filters complete");
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.glassdoorTabId1, function () {
                  console.log("filters fetched ---- closed glassdoor url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          else {
            chrome.tabs.remove(glassdoorTabId1, function () {
              console.log("filters fetched ---- closed glassdoor url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("seek" in request) {
    // { baseURL: url,seekLimit: numberOfJobs.value, seekJobLinks: []},
    console.log("seek has received request", request);
    if (!("message" in request)) {
      console.log(
        "Background script has received a message from contentscript: for pagenumber'" +
        request.pageNumber
      );

      seekUpdateUrl(request.pageNumber);
      return true;
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log("Message received from tab ID: seek", tabId, request.href);
      getObjectFromLocalStorage("seekTabId").then(async (storageResult) => {
        const previousTabId = storageResult.seekTabId;
        let sampleObject = {
          seekTabId: tabId,
        };
        await saveObjectInLocalStorage(sampleObject);
        console.log("saved now", tabId, previousTabId);
        sendResponse({ message: "Save New Tab Id" });
      });
      return true;
    } else if (request.message == "m5TabOpened") {
      let intervalId = setInterval(() => {
        getObjectFromLocalStorage(["seekTabId"]).then((storageResult) => {
          chrome.tabs.query(
            { active: true, currentWindow: true },
            function (tabs) {
              console.log(
                "comparing current tab with seektab",
                storageResult.seekTabId,
                tabs[0].id
              );
              if (storageResult.seekTabId != tabs[0].id) {
                seekUpdateUrl2("index.html"); // removing current seek tab
                let sampleObject = {
                  seekTabId: tabs[0].id,
                };
                saveObjectInLocalStorage(sampleObject);
                clearInterval(intervalId); // Remove the interval
              }
            }
          );
        });
      }, 1000);
      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        seekTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(seekTabId, {
        seek: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(seekTabId, {
        seek: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["seekTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.seekTabId, {
          seek: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("seek");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("seek");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("seek", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["seekTabId"]).then((storageResult) => {
          console.log("quit");
          chrome.tabs.remove(parseInt(storageResult.seekTabId), function () {
            console.log("Finally closed tab zip");
          });
        });
      } else {
        saveSession("seek");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          seekTotalLinks: request.seekTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.seekTotalLinks);
            sendResponse({
              seekTotalLinks: data.seekTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        seekTabId: request.seekTabID,
        seekBaseUrl: request.seekBaseUrl,
      };
      saveObjectInLocalStorage(sampleObject);
      // seekTabId = request.seekTabID;
      // seekBaseUrl = request.seekBaseUrl;
      // console.log(seekBaseUrl, seekTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_SEEK",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["seekTabId1", "seekTabId"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.seekTabId1,
            storageResult.seekTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.seekTabId1
              : storageResult.seekTabId;
          if (storageResult.seekTabId) {
            debugTabId = storageResult.seekTabId;
          }
          updateUrlDebug(request.link, debugTabId, request.message2, "seek");
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["seekTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                seekUpdateUrl2(request.link);
              });
          } else {
            seekUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      seekUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, seekcall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, seekcall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage(["seekTabId", "globalTabId"]).then(
        (storageResult) => {
          if (request.message1 == "hideAutomationButtons") {
            chrome.tabs.sendMessage(storageResult.seekTabId, {
              seek: "true",
              message: "hideAutomationButtons",
            });
          }
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                sendResponse(
                  "Updated the count on the frontend along with links"
                );
              });
          else {
            sendResponse("Updated the count on the frontend along with links");
          }
        }
      );
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(seekTabId, {
        seek: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "seekTabId1"]).then(
        (storageResult) => {
          console.log(storageResult?.seekTabId1, "fetch filters complete");
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.seekTabId1, function () {
                  console.log("filters fetched ---- closed seek url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          else {
            chrome.tabs.remove(seekTabId1, function () {
              console.log("filters fetched ---- closed seek url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("careerBuilder" in request) {
    // { baseURL: url,careerBuilderLimit: numberOfJobs.value, careerBuilderJobLinks: []},
    console.log("careerBuilder has received request", request);
    if (!("message" in request)) {
      console.log(
        "Background script has received a message from contentscript: for pagenumber'" +
        request.pageNumber
      );

      careerBuilderUpdateUrl(request.pageNumber);
      return true;
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log(
        "Message received from tab ID: careerBuilder",
        tabId,
        request.href
      );

      getObjectFromLocalStorage("careerBuilderTabId").then(
        async (storageResult) => {
          const previousTabId = storageResult.careerBuilderTabId;
          let sampleObject = {
            careerBuilderTabId: tabId,
          };
          await saveObjectInLocalStorage(sampleObject);
          console.log("saved now", tabId, previousTabId);
          // saved, now remove
          sendResponse({ message: "Save New Tab Id" });
        }
      );

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        careerBuilderTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(careerBuilderTabId, {
        careerBuilder: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(careerBuilderTabId, {
        careerBuilder: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["careerBuilderTabId"]).then(
        (storageResult) => {
          chrome.tabs.sendMessage(storageResult.careerBuilderTabId, {
            careerBuilder: "true",
            message: "showAutomationButtons",
            message1: request?.message1 || "",
          });
        }
      );
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("careerBuilder");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("careerBuilder");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("careerBuilder", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["careerBuilderTabId"]).then(
          (storageResult) => {
            console.log("quit");
            chrome.tabs.remove(
              parseInt(storageResult.careerBuilderTabId),
              function () {
                console.log("Finally closed tab zip");
              }
            );
          }
        );
      } else {
        saveSession("careerBuilder");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          careerBuilderTotalLinks: request.careerBuilderTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.careerBuilderTotalLinks);
            sendResponse({
              careerBuilderTotalLinks: data.careerBuilderTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        careerBuilderTabId: request.careerBuilderTabID,
        careerBuilderBaseUrl: request.careerBuilderBaseUrl,
      };
      saveObjectInLocalStorage(sampleObject);
      // careerBuilderTabId = request.careerBuilderTabID;
      // careerBuilderBaseUrl = request.careerBuilderBaseUrl;
      // console.log(careerBuilderBaseUrl, careerBuilderTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_CAREERBUILDER",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage([
        "careerBuilderTabId1",
        "careerBuilderTabId",
      ]).then((storageResult) => {
        console.log(
          "tabidyo",
          storageResult.careerBuilderTabId1,
          storageResult.careerBuilderTabId
        );
        let debugTabId =
          request.whichTabId == "first"
            ? storageResult.careerBuilderTabId1
            : storageResult.careerBuilderTabId;
        if (storageResult.careerBuilderTabId) {
          debugTabId = storageResult.careerBuilderTabId;
        }
        updateUrlDebug(
          request.link,
          debugTabId,
          request.message2,
          "careerBuilder"
        );
      });

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["careerBuilderTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                careerBuilderUpdateUrl2(request.link);
              });
          } else {
            careerBuilderUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      careerBuilderUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, careerBuildercall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, careerBuildercall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "careerBuilderTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "careerBuilderSessionId",
        "session",
        "careerBuilderMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.careerBuilderMessageId) {
          return;
        }
        if (request.message1 == "hideAutomationButtons") {
          chrome.tabs.sendMessage(storageResult.careerBuilderTabId, {
            careerBuilder: "true",
            message: "hideAutomationButtons",
          });
        }
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        else {
          sendResponse("Updated the count on the frontend along with links");
        }
        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.careerBuilderSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { careerBuilderMessageId: request.messageId },
                function () {
                  console.log(
                    "saved careerBuilderMessageId as",
                    request.messageId
                  );
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(careerBuilderTabId, {
        careerBuilder: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "careerBuilderTabId1"]).then(
        (storageResult) => {
          console.log(
            storageResult?.careerBuilderTabId1,
            "fetch filters complete"
          );
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(
                  storageResult.careerBuilderTabId1,
                  function () {
                    console.log(
                      "filters fetched ---- closed careerBuilder url"
                    );
                    console.log(
                      "making global tabid active",
                      storageResult.globalTabId
                    );
                    chrome.tabs.update(storageResult.globalTabId, {
                      active: true,
                    });
                  }
                );
              });
          else {
            chrome.tabs.remove(careerBuilderTabId1, function () {
              console.log("filters fetched ---- closed careerBuilder url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("monster" in request) {
    // { baseURL: url,monsterLimit: numberOfJobs.value, monsterJobLinks: []},
    console.log("monster has received request", request);
    if (!("message" in request)) {
      console.log("message to background, without message");
      return true;
    } else if (request.message == "closeThisTab") {
      console.log("removing successfully applied job tab");
      chrome.tabs.remove(sender.tab.id);
    } else if (request.message == "replaceMonsterTab") {
      getObjectFromLocalStorage("monsterTabId").then(async (storageResult) => {
        let sampleObject = {
          monsterProgrammaticRemoval: true,
        };
        await saveObjectInLocalStorage(sampleObject);

        chrome.tabs.remove(storageResult.monsterTabId);
        sampleObject = {
          monsterTabId: sender.tab.id,
        };

        await saveObjectInLocalStorage(sampleObject);
        console.log("replaced monster tab to", sender.tab.id);
      });
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log("Message received from tab ID: monster", tabId, request.href);

      getObjectFromLocalStorage("monsterTabId").then(async (storageResult) => {
        const previousTabId = storageResult.monsterTabId;
        let sampleObject = {
          monsterTabId: tabId,
        };
        await saveObjectInLocalStorage(sampleObject);
        console.log("saved now", tabId, previousTabId);
        sendResponse({ message: "Save New Tab Id" });
      });

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        monsterTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(monsterTabId, {
        monster: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(monsterTabId, {
        monster: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["monsterTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.monsterTabId, {
          monster: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("monster");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("monster");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("monster", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["monsterTabId"]).then((storageResult) => {
          console.log("quit");
          chrome.tabs.remove(parseInt(storageResult.monsterTabId), function () {
            console.log("Finally closed tab zip");
          });
        });
      } else {
        saveSession("monster");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          monsterTotalLinks: request.monsterTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.monsterTotalLinks);
            sendResponse({
              monsterTotalLinks: data.monsterTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        monsterTabId: request.monsterTabID,
        monsterBaseUrl: request.monsterBaseUrl,
      };
      saveObjectInLocalStorage(sampleObject);
      // monsterTabId = request.monsterTabID;
      // monsterBaseUrl = request.monsterBaseUrl;
      // console.log(monsterBaseUrl, monsterTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_MONSTER",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["monsterTabId1", "monsterTabId"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.monsterTabId1,
            storageResult.monsterTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.monsterTabId1
              : storageResult.monsterTabId;
          if (storageResult.monsterTabId) {
            debugTabId = storageResult.monsterTabId;
          }
          updateUrlDebug(request.link, debugTabId, request.message2, "monster");
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["monsterTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                monsterUpdateUrl2(request.link);
              });
          } else {
            monsterUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      monsterUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, monstercall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, monstercall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage(["monsterTabId", "globalTabId"]).then(
        (storageResult) => {
          if (request.message1 == "hideAutomationButtons") {
            chrome.tabs.sendMessage(storageResult.monsterTabId, {
              monster: "true",
              message: "hideAutomationButtons",
            });
          }
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                sendResponse(
                  "Updated the count on the frontend along with links"
                );
              });
          else {
            sendResponse("Updated the count on the frontend along with links");
          }
        }
      );
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(monsterTabId, {
        monster: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "monsterTabId1"]).then(
        (storageResult) => {
          console.log(storageResult?.monsterTabId1, "fetch filters complete");
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.monsterTabId1, function () {
                  console.log("filters fetched ---- closed monster url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          else {
            chrome.tabs.remove(monsterTabId1, function () {
              console.log("filters fetched ---- closed monster url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("foundit" in request) {
    // { baseURL: url,founditLimit: numberOfJobs.value, founditJobLinks: []},
    console.log("foundit has received request", request);
    if (!("message" in request)) {
      console.log("message to background, without message");
      return true;
    } else if (request.message == "closeThisTab") {
      console.log("removing successfully applied job tab");
      let sampleObject = {
        closedUrl: sender.tab.url,
      };
      saveObjectInLocalStorage(sampleObject).then(function () {
        chrome.tabs.remove(sender.tab.id);
      });
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log("Message received from tab ID: foundit", tabId, request.href);

      getObjectFromLocalStorage("founditTabId").then(async (storageResult) => {
        const previousTabId = storageResult.founditTabId;
        let sampleObject = {
          founditTabId: tabId,
        };
        console.log("savenewTabid - ", tabId, sender.tab.url);
        await saveObjectInLocalStorage(sampleObject);
        console.log("saved now", tabId, previousTabId);
        sendResponse({ message: "Save New Tab Id" });
      });

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        founditTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(founditTabId, {
        foundit: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(founditTabId, {
        foundit: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["founditTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.founditTabId, {
          foundit: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("foundit");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("foundit");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("foundit", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["founditTabId"]).then((storageResult) => {
          console.log("quit");
          chrome.tabs.remove(parseInt(storageResult.founditTabId), function () {
            console.log("Finally closed tab zip");
          });
        });
      } else {
        saveSession("foundit");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          founditTotalLinks: request.founditTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.founditTotalLinks);
            sendResponse({
              founditTotalLinks: data.founditTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        founditTabId: request.founditTabID,
        founditBaseUrl: request.founditBaseUrl,
      };
      console.log("savebaseurl - ", request.founditTabID, sender.tab.url);
      saveObjectInLocalStorage(sampleObject);
      // founditTabId = request.founditTabID;
      // founditBaseUrl = request.founditBaseUrl;
      // console.log(founditBaseUrl, founditTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_FOUNDIT",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["founditTabId1", "founditTabId"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.founditTabId1,
            storageResult.founditTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.founditTabId1
              : storageResult.founditTabId;
          if (storageResult.founditTabId) {
            debugTabId = storageResult.founditTabId;
          }
          updateUrlDebug(request.link, debugTabId, request.message2, "foundit");
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["founditTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                founditUpdateUrl2(request.link);
              });
          } else {
            founditUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      founditUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, founditcall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, founditcall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage(["founditTabId", "globalTabId"]).then(
        (storageResult) => {
          if (request.message1 == "hideAutomationButtons") {
            chrome.tabs.sendMessage(storageResult.founditTabId, {
              foundit: "true",
              message: "hideAutomationButtons",
            });
          }
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                sendResponse(
                  "Updated the count on the frontend along with links"
                );
              });
          else {
            sendResponse("Updated the count on the frontend along with links");
          }
        }
      );
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(founditTabId, {
        foundit: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "founditTabId1"]).then(
        (storageResult) => {
          console.log(storageResult?.founditTabId1, "fetch filters complete");
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.founditTabId1, function () {
                  console.log("filters fetched ---- closed foundit url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          else {
            chrome.tabs.remove(founditTabId1, function () {
              console.log("filters fetched ---- closed foundit url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("simplyHired" in request) {
    // { baseURL: url,simplyHiredLimit: numberOfJobs.value, simplyHiredJobLinks: []},
    console.log("simplyHired has received request", request);
    if (!("message" in request)) {
      console.log("message to background, without message");
      return true;
    } else if (request.message == "closeThisTab") {
      console.log("removing successfully applied job tab");
      let sampleObject = {
        closedUrl: sender.tab.url,
      };
      saveObjectInLocalStorage(sampleObject).then(function () {
        chrome.tabs.remove(sender.tab.id);
      });
    } else if (request.message == "print") {
      console.log("printobj", request.printObj);
    } else if (request.message == "updateUrlForEasyApply") {
      updateUrlAtTabId(request.link, sender.tab.id);
      console.log("did update the url to ", request.link);
    } else if (request.message == "updateLocationUrl") {
      console.log("herelocation", request);
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.globalTabId, { ...request });
      });
    } else if (request.message == "saveNewTabId") {
      // Access the tab ID from where the message is sent
      const tabId = sender.tab.id;
      console.log(
        "Message received from tab ID: simplyHired",
        tabId,
        request.href
      );

      getObjectFromLocalStorage("simplyHiredTabId").then(
        async (storageResult) => {
          const previousTabId = storageResult.simplyHiredTabId;
          let sampleObject = {
            simplyHiredTabId: tabId,
          };
          console.log("savenewTabid - ", tabId, sender.tab.url);
          await saveObjectInLocalStorage(sampleObject);
          console.log("saved now", tabId, previousTabId);
          sendResponse({ message: "Save New Tab Id" });
        }
      );

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      let sampleObject = {
        simplyHiredTabId1: request.tabID,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "showFillDetailsMessage") {
      chrome.tabs.sendMessage(simplyHiredTabId, {
        simplyHired: "true",
        message: "showFillDetailsMessage",
        name: request.name,
        text: request?.text || "",
      });
    } else if (request.message == "hideFillDetailsMessage") {
      chrome.tabs.sendMessage(simplyHiredTabId, {
        simplyHired: "true",
        message: "hideFillDetailsMessage",
      });
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["simplyHiredTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.simplyHiredTabId, {
          simplyHired: "true",
          message: "showAutomationButtons",
          message1: request?.message1 || "",
        });
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("simplyHired");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("simplyHired");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("simplyHired", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["simplyHiredTabId"]).then(
          (storageResult) => {
            console.log("quitting simplyhired");
            chrome.tabs.remove(
              parseInt(storageResult.simplyHiredTabId),
              function () {
                console.log("Finally closed tab zip");
              }
            );
          }
        );
      } else {
        saveSession("simplyHired");
      }
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          simplyHiredTotalLinks: request.simplyHiredTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.simplyHiredTotalLinks);
            sendResponse({
              simplyHiredTotalLinks: data.simplyHiredTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      return true;
    } else if (request.message == "setBaseUrl") {
      let sampleObject = {
        simplyHiredTabId: request.simplyHiredTabID,
        simplyHiredBaseUrl: request.simplyHiredBaseUrl,
      };
      console.log("savebaseurl - ", request.simplyHiredTabID, sender.tab.url);
      saveObjectInLocalStorage(sampleObject);
      // simplyHiredTabId = request.simplyHiredTabID;
      // simplyHiredBaseUrl = request.simplyHiredBaseUrl;
      // console.log(simplyHiredBaseUrl, simplyHiredTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_SIMPLYHIRED",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["simplyHiredTabId1", "simplyHiredTabId"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.simplyHiredTabId1,
            storageResult.simplyHiredTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.simplyHiredTabId1
              : storageResult.simplyHiredTabId;
          if (storageResult.simplyHiredTabId) {
            debugTabId = storageResult.simplyHiredTabId;
          }
          updateUrlDebug(
            request.link,
            debugTabId,
            request.message2,
            "simplyHired"
          );
        }
      );

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };
      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page", request);
      getObjectFromLocalStorage(["simplyHiredTabId", "globalTabId"]).then(
        (storageResult) => {
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                simplyHiredUpdateUrl2(request.link);
              });
          } else {
            simplyHiredUpdateUrl2(request.link);
          }
        }
      );
      return true;
    } else if (request.message == "applypagedebug") {
      console.log("apply page");
      simplyHiredUpdateUrl(request.link, request.message2);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, simplyHiredcall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, simplyHiredcall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "simplyHiredTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "simplyHiredSessionId",
        "session",
        "simplyHiredMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.simplyHiredMessageId) {
          return;
        }
        if (request.message1 == "hideAutomationButtons") {
          chrome.tabs.sendMessage(storageResult.simplyHiredTabId, {
            simplyHired: "true",
            message: "hideAutomationButtons",
          });
        }
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        else {
          sendResponse("Updated the count on the frontend along with links");
        }
        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.simplyHiredSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { simplyHiredMessageId: request.messageId },
                function () {
                  console.log(
                    "saved simplyHiredMessageId as",
                    request.messageId
                  );
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId)
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        else sendResponse("Already applied before now restart");
      });
      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      chrome.tabs.sendMessage(simplyHiredTabId, {
        simplyHired: "true",
        message: "hideAutomationButtons",
      });
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["globalTabId", "simplyHiredTabId1"]).then(
        (storageResult) => {
          console.log(
            storageResult?.simplyHiredTabId1,
            "fetch filters complete"
          );
          if (storageResult.globalTabId)
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(
                  storageResult.simplyHiredTabId1,
                  function () {
                    console.log("filters fetched ---- closed simplyHired url");
                    console.log(
                      "making global tabid active",
                      storageResult.globalTabId
                    );
                    chrome.tabs.update(storageResult.globalTabId, {
                      active: true,
                    });
                  }
                );
              });
          else {
            chrome.tabs.remove(simplyHiredTabId1, function () {
              console.log("filters fetched ---- closed simplyHired url");
            });
          }
        }
      );
    } else {
      console.log("nothing to do");
    }
    return true;
  } else if ("ziprecruiter" in request) {
    if (!("message" in request)) {
      console.log(
        "Background script has received a message from contentscript:'" +
        request.linkedinCount +
        "'"
      );
      console.log("currentpage -->" + request.linkedinCount);
      console.log(request.linkedinData);
      console.log("limit -->" + request.linkedinLimit);
      getObjectFromLocalStorage(["linkedinBaseUrl"]).then((storageResult) => {
        linkedinUpdateUrl(
          `${storageResult.linkedinBaseUrl}&start=${request.linkedinCount * 25}`
        );
      });

      return true;
    } else if (request.message == "resetwhy") {
      console.log("reset why", request.flow);
    } else if (request.message == "showpopup") {
      console.log("showpopup", request);
    } else if (request.message == "showFillDetailsMessage") {
      getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.ziprecruiterTabId, {
          ziprecruiter: "true",
          message: "showFillDetailsMessage",
          name: request.name,
        });
      });

      return true;
    } else if (request.message == "hideFillDetailsMessage") {
      getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.ziprecruiterTabId, {
          ziprecruiter: "true",
          message: "hideFillDetailsMessage",
        });
      });

      return true;
    } else if (request.message == "showAutomationButtons") {
      getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.ziprecruiterTabId, {
          ziprecruiter: "true",
          message: "showAutomationButtons",
        });
      });

      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      // ziprecruiterTabId1 = request.tabID;
      let sampleObject = {
        ziprecruiterTabId1: request.tabID,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("ziprecruiter");
      // pauseAutomation();
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("ziprecruiter");
      // userDetails = request.data;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "downloadHtmlFile") {
      downloadHtml("ziprecruiter", request.htmlContent);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        getObjectFromLocalStorage(["ziprecruiterTabId"]).then(
          (storageResult) => {
            console.log("quit");
            chrome.tabs.remove(
              parseInt(storageResult.ziprecruiterTabId),
              function () {
                console.log("Finally closed tab zip");
              }
            );
          }
        );
      } else {
        saveSession("ziprecruiter");
      }
      return true;
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          ziprecruiterTotalLinks: request.ziprecruiterTotalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee ziprecruitertotallinks");
            console.log(data.ziprecruiterTotalLinks);
            sendResponse({
              ziprecruiterTotalLinks: data.ziprecruiterTotalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      // axios
      //   .post(
      //     request.api,
      //     {
      //       ziprecruiterTotalLinks: request.ziprecruiterTotalLinks,
      //     },
      //     {
      //       headers: { Authorization: `Bearer ${request.token}` },
      //     }
      //   )
      //   .then(function (response) {
      //     console.log(response.data);
      //     if (response.data == "no data") {
      //       console.log("nooooo dataaaaa");
      //       sendResponse("no data");
      //     } else {
      //       console.log("elseeee ziprecruitertotallinks");
      //       console.log(response.data.ziprecruiterTotalLinks);
      //       sendResponse({
      //         ziprecruiterTotalLinks: response.data.ziprecruiterTotalLinks,
      //       });
      //     }
      //   })
      //   .catch(function (error) {
      //     sendResponse({ error: "ok" });
      //     console.log(error);
      //   });
      return true;
    } else if (request.message == "setBaseUrl") {
      // ziprecruiterTabId = request.ziprecruiterTabID;
      // ziprecruiterBaseUrl = request.ziprecruiterBaseUrl;
      let sampleObject = {
        ziprecruiterTabId: request.ziprecruiterTabID,
        ziprecruiterBaseUrl: request.ziprecruiterBaseUrl,
      };

      saveObjectInLocalStorage(sampleObject);
      console.log(ziprecruiterBaseUrl, ziprecruiterTabId);
      console.log("base url setted");
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, ziprecruitercall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "applypage") {
      console.log("apply page");
      console.log("hello 123456789");
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        console.log("34556");
        if (storageResult.globalTabId) {
          console.log("5678");
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              console.log("9876");
              ziprecruiterUpdateUrl(request.link, request.message2);
            });
        } else {
          ziprecruiterUpdateUrl(request.link, request.message2);
        }
      });
      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG_ZIPRECRUITER",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage([
        "ziprecruiterTabId1",
        "ziprecruiterTabId",
      ]).then((storageResult) => {
        let debugTabId =
          request.whichTabId == "first"
            ? storageResult.ziprecruiterTabId1
            : storageResult.ziprecruiterTabId;
        if (storageResult.ziprecruiterTabId) {
          debugTabId = storageResult.ziprecruiterTabId;
        }
        updateUrlDebug(
          request.link,
          debugTabId,
          request.message2,
          "ziprecruiter"
        );
      });

      return true;
    } else if (request.message == "debugScript") {
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, ziprecruitercall");
      console.log("axios call");
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "Applied successfully") {
      console.log("hello from applied successfully");
      getObjectFromLocalStorage([
        "ziprecruiterTabId",
        "globalTabId",
        "formData",
        "resumeData",
        "sessionIdSaved",
        "ziprecruiterSessionId",
        "session",
        "ziprecruiterMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.ziprecruiterMessageId) {
          return;
        }
        if (request.message1 == "hideAutomationButtons") {
          chrome.tabs.sendMessage(storageResult.ziprecruiterTabId, {
            ziprecruiter: "true",
            message: "hideAutomationButtons",
          });
        }
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              console.log("hello from applies");
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        } else {
          sendResponse("Updated the count on the frontend along with links");
        }

        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.ziprecruiterSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { ziprecruiterMessageId: request.messageId },
                function () {
                  console.log(
                    "saved ziprecruiterMessageId as",
                    request.messageId
                  );
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });

      return true;
    } else if (request.message == "hideAutomationButtonsOnly") {
      getObjectFromLocalStorage(["ziprecruiterTabId"]).then((storageResult) => {
        chrome.tabs.sendMessage(storageResult.ziprecruiterTabId, {
          ziprecruiter: "true",
          message: "hideAutomationButtons",
        });
      });

      return true;
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["ziprecruiterTabId1", "globalTabId"]).then(
        (storageResult) => {
          console.log(
            storageResult.ziprecruiterTabId1,
            "fetch filters complete"
          );
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(
                  storageResult.ziprecruiterTabId1,
                  function () {
                    console.log("filters fetched ---- closed ziprec url");
                    console.log(
                      "making global tabid active",
                      storageResult.globalTabId
                    );
                    chrome.tabs.update(storageResult.globalTabId, {
                      active: true,
                    });
                  }
                );
              });
          } else {
            chrome.tabs.remove(storageResult.ziprecruiterTabId1, function () {
              console.log("filters fetched ---- closed linkedin url");
            });
          }
        }
      );

      return true;
    } else {
      console.log("nothing to do");
    }
    return true;
  } else {
    console.log("request", request);
    if (!("message" in request) && "debug" in request) {
      console.log(
        "Background script has received a message from contentscript:'" +
        request.count +
        "'"
      );
      console.log("currentpage -->" + request.count);
      console.log(request.data);
      console.log("limit -->" + request.limit);
      getObjectFromLocalStorage(["baseUrl"]).then((storageResult) => {
        updateUrl(`${storageResult.baseUrl}&start=${request.count * 10}`);
      });

      return true;
    } else if (request.message == "nextPageUrl") {
      console.log("go to next page", request.url);
      const url = request.url;
      updateUrl(url);
      return true;
    } else if (request.message == "tabid") {
      chrome?.power?.requestKeepAwake("display");
      console.log("save filter id", request.tabID);
      changeUA(uamain, indeedString).then((result) => {
        console.log("result promise fullfilled", result);
        chrome.tabs.create(
          {
            url: request.url,
            active: true,
            active: true,
          },
          async (tab) => {
            // indeedTabId1 = tab.id;
            let sampleObject = {
              indeedTabId1: tab.id,
            };

            saveObjectInLocalStorage(sampleObject);
          }
        );
      });
      return true;
    } else if (request.message == "executeScript") {
      showAutomationPopup("indeed");
    } else if (request.message == "changeUA") {
      changeUA(request.UAString, indeedString);
    } else if (request.message == "resetUA") {
      console.log("reset ua");
      resetUA(indeedString);
    } else if (request.message == "downloadHtmlFile") {
      console.log("download file");
      downloadHtml("indeed", request.htmlContent);
    } else if (request.message == "executeScriptDebug") {
      showAutomationPopupDebug("indeed");
      // userDetails = request.data;
      // uploadapidebug = request.uploadapi;
      // uploadapitoken = request.token;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
    } else if (request.message == "debugScript") {
      // uploadapidebug = request.uploadapi;
      // uploadapitoken = request.token;
      let sampleObject = {
        uploadapidebug: request.uploadapi,
        uploadapitoken: request.token,
      };

      saveObjectInLocalStorage(sampleObject);
      return true;
      // addDebugScript(request.name);
    } else if (request.message == "saveSession") {
      if ("message2" in request && request.message2 == "quitclicked") {
        console.log("quit");
        getObjectFromLocalStorage(["indeedTabId"]).then((storageResult) => {
          chrome.tabs.remove(parseInt(storageResult.indeedTabId), function () {
            console.log("Finally closed tab zip");
          });
        });
      } else {
        saveSession("indeed");
      }
      return true;
    } else if (request.message == "Save job links in db") {
      fetch(request.api, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${request.token}`,
        },
        body: JSON.stringify({
          totalLinks: request.totalLinks,
        }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          if (data === "no data") {
            console.log("nooooo dataaaaa");
            sendResponse("no data");
          } else {
            console.log("elseeee indeedtotallinks");
            console.log(data.totalLinks);
            sendResponse({
              totalLinks: data.totalLinks,
            });
          }
        })
        .catch((error) => {
          sendResponse({ error: "ok" });
          console.log(error);
        });
      // axios
      //   .post(
      //     request.api,
      //     {
      //       totalLinks: request.totalLinks,
      //     },
      //     {
      //       headers: { Authorization: `Bearer ${request.token}` },
      //     }
      //   )
      //   .then(function (response) {
      //     console.log(response.data);
      //     if (response.data == "no data") {
      //       console.log("nooooo dataaaaa");
      //       sendResponse("no data");
      //     } else {
      //       console.log("elseeee indeedtotallinks");
      //       console.log(response.data.totalLinks);
      //       sendResponse({
      //         totalLinks: response.data.totalLinks,
      //       });
      //     }
      //   })
      //   .catch(function (error) {
      //     sendResponse({ error: "ok" });
      //     console.log(error);
      //   });
      return true;
    } else if (request.message == "getSessionLinks") {
      console.log("Get session links, indeedcall");
      console.log("axios call", request);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "applypage") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              if (request?.message2 && request?.message2 != "") {
                resetUA(indeedString);
              }
              updateUrl(request.link, request.message2);
            });
        } else {
          if (request?.message2 && request?.message2 != "") {
            resetUA(indeedString);
          }
          updateUrl(request.link, request.message2);
        }
      });

      //sendResponse("ok");
      return true;
    } else if (request.message == "Already Applied Before") {
      getObjectFromLocalStorage(["globalTabId"]).then((storageResult) => {
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse("Already applied before now restart");
            });
        } else {
          sendResponse("Already applied before now restart");
        }
      });

      return true;
    } else if (request.message == "deubgApplyPage") {
      // window.analytics.track(
      //   "USER_DEBUG",
      //   {
      //     label: "debug sessin",
      //     fnName: request.fnName,
      //     data: parseJwt(request.token),
      //   },
      //   {},
      //   () => {
      //     console.log("success call analytics");
      //   }
      // );
      getObjectFromLocalStorage(["indeedTabId", "indeedTabId1"]).then(
        (storageResult) => {
          console.log(
            "tabidyo",
            storageResult.indeedTabId1,
            storageResult.indeedTabId
          );
          let debugTabId =
            request.whichTabId == "first"
              ? storageResult.indeedTabId1
              : storageResult.indeedTabId;
          if (storageResult.indeedTabId) {
            debugTabId = storageResult.indeedTabId;
          }
          updateUrlDebug(request.link, debugTabId, request.message2, "indeed");
        }
      );

      return true;
    } else if (request.message == "getUserData") {
      console.log("Get user data, indeed call");
      console.log("axios call");
      console.log(request.token);
      fetch(request.api, {
        headers: { Authorization: `Bearer ${request.token}` },
      })
        .then((response) => {
          console.log("response", response);
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }
          return response.json();
        })
        .then((data) => {
          console.log(data);
          sendResponse({ data });
        })
        .catch((error) => {
          console.log(error);
          sendResponse(error);
        });

      // axios
      //   .get(request.api, {
      //     headers: { Authorization: `Bearer ${request.token}` },
      //   })
      //   .then((response) => {
      //     console.log(response.data);
      //     sendResponse({ data: response.data });
      //   })
      //   .catch((error) => {
      //     console.log(error);
      //     sendResponse(error);
      //   });
      return true;
    } else if (request.message == "Applied successfully") {
      getObjectFromLocalStorage([
        "globalTabId",
        "indeedTabId1",
        "formData",
        "resumeData",
        "indeedSessionId",
        "sessionIdSaved",
        "session",
        "indeedMessageId",
      ]).then((storageResult) => {
        if (request.messageId === storageResult.indeedMessageId) {
          return;
        }
        if (storageResult.globalTabId) {
          chrome.tabs
            .sendMessage(storageResult.globalTabId, {
              ...request,
            })
            .then((response) => {
              sendResponse(
                "Updated the count on the frontend along with links"
              );
            });
        } else {
          sendResponse("Updated the count on the frontend along with links");
        }
        let bodyObj = {};
        if (request.sessionLink) bodyObj["sessionLink"] = request.sessionLink;
        if (request.sessionLinkBefore)
          bodyObj["sessionLinkBefore"] = request.sessionLinkBefore;

        let sessionId = storageResult.indeedSessionId;
        if (storageResult.resumeData)
          bodyObj["resumeData"] = storageResult.resumeData;
        bodyObj["timeZone"] = timeZone;

        if (storageResult.session) bodyObj["session"] = storageResult.session;
        if (sessionId) {
          bodyObj["sessionId"] = sessionId;
          console.log("session Id", sessionId);
        }

        let sessionIdSaved = storageResult.sessionIdSaved;
        if (sessionIdSaved) {
          bodyObj["sessionIdSaved"] = sessionIdSaved;
          console.log("session Id", sessionIdSaved);
        }

        if (request.api) {
          fetch(request.api, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${request.token}`,
            },
            body: JSON.stringify(bodyObj),
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error("Network response was not ok");
              }
              return response.json();
            })
            .then((data) => {
              console.log("response from mongo api", data);
              if (data.sessionIdSaved) {
                chrome.storage.local.set(
                  { sessionIdSaved: data.sessionIdSaved },
                  function () {
                    console.log("saved sessionId as", data.sessionIdSaved);
                  }
                );
              }
              chrome.storage.local.set(
                { indeedMessageId: request.messageId },
                function () {
                  console.log("saved indeedMessageId as", request.messageId);
                }
              );
              sendResponse("job saved in mongodb");
            })
            .catch((error) => {
              console.log(error.message, "error in saving session link");
              sendResponse([]);
            });
        }
      });

      return true;
    } else if (request.message == "filterValues") {
      getObjectFromLocalStorage(["indeedTabId1", "globalTabId"]).then(
        (storageResult) => {
          console.log(
            storageResult.indeedTabId1,
            "fetch filters complete",
            storageResult.globalTabId,
            request
          );
          if (storageResult.globalTabId) {
            chrome.tabs
              .sendMessage(storageResult.globalTabId, {
                ...request,
              })
              .then((response) => {
                chrome.tabs.remove(storageResult.indeedTabId1, function () {
                  resetUA(indeedString);
                  console.log("filters fetched ---- closed indeed url");
                  console.log(
                    "making global tabid active",
                    storageResult.globalTabId
                  );
                  chrome.tabs.update(storageResult.globalTabId, {
                    active: true,
                  });
                });
              });
          } else {
            chrome.tabs.remove(storageResult.indeedTabId1, function () {
              resetUA(indeedString);
              console.log("filters fetched ---- closed indeed url");
            });
          }
        }
      );

      return true;
    } else if (request.message == "setBaseUrl") {
      changeUA(uamain, indeedString).then((result) => {
        chrome.tabs.create(
          {
            url: request.baseURL,
            active: true,
          },
          async function (tab) {
            indeedTabId = tab.id;
            baseUrl = request.baseURL;
            let sampleObject = {
              indeedTabId: tab.id,
              baseUrl: request.baseURL,
            };

            saveObjectInLocalStorage(sampleObject);
          }
        );
      });

      console.log("base url setted");
      return true;
    } else if (request.message == "setBaseUrlMain") {
      const finalurl = request.url;
      getObjectFromLocalStorage(["indeedTabId"]).then((storageResult) => {
        chrome.tabs.update(storageResult.indeedTabId, {
          url: finalurl,
          active: true,
          active: true,
        });
      });

      return true;
    } else if (request.message == "restartCycle") {
      console.log(request.jobLinks);
      console.log(request.linkNo);
    } else {
      console.log("ok");
      return true;
      // sendResponse("ok");
    }
  }
};
chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>
  globalThis.LazyParallel
    ? globalThis.LazyParallel.route(request, sender, sendResponse, legacyOnMessage)
    : legacyOnMessage(request, sender, sendResponse)
);
