var vrvWorker;
var spdWorker;
var tkVersion = '';
var tkAvailableOptions;
var mei;
var elementAtCursor;

// guidelines base URL, needed to construct element / attribute URLs
// TODO ideally determine version part automatically
const guidelinesBase = "https://music-encoding.org/guidelines/v4/";

// exports
export var cm;
export var v; // viewer instance
export let github; // github API wrapper object
export let storage = new Storage();
export let meiFileName = '';
export let meiFileLocation = '';
export let meiFileLocationPrintable = '';

export function setFileChangedState(fileChangedState) {
  fileChanged = fileChangedState;
  const fileStatusElement = document.querySelector(".fileStatus");
  const fileChangedIndicatorElement = document.querySelector("#fileChanged");
  const fileStorageExceededIndicatorElement = document.querySelector("#fileStorageExceeded");
  const commitUI = document.querySelector("#commitUI");
  if (fileChanged) {
    fileStatusElement.classList.add("changed");
    fileChangedIndicatorElement.innerText = "*";
  } else {
    fileStatusElement.classList.remove("changed");
    fileChangedIndicatorElement.innerText = "";
  }
  if (isLoggedIn && github && github.filepath && commitUI) {
    document.getElementById("commitMessageInput").disabled = !fileChanged;
    document.getElementById("commitButton").disabled = !fileChanged;
  }
  if (storage.supported) {
    storage.fileChanged = fileChanged ? 1 : 0;
    if (storage.override) {
      // unable to write to local storage, probably because quota exceeded
      // warn user...
      fileStatusElement.classList.add("warn");
      fileStorageExceededIndicatorElement.innerText = "LOCAL-STORAGE DISABLED!";
      fileStorageExceededIndicatorElement.classList.add("warn");
      fileStorageExceededIndicatorElement.title = "Your MEI content exceeds " +
        "the browser's local storage space. Please ensure changes are saved " +
        "manually or committed to Github before refreshing or leaving " +
        "the page!";
    } else {
      fileStatusElement.classList.remove("warn");
      fileStorageExceededIndicatorElement.innerText = "";
      fileStorageExceededIndicatorElement.classList.remove("warn");
      fileStorageExceededIndicatorElement.title = "";
    }
  }
}

export function setGithubInstance(new_github) {
  // update github instance (from other modules)
  github = new_github;
}

export function setMeiFileInfo(fName, fLocation, fLocationPrintable) {
  meiFileName = fName;
  meiFileLocation = fLocation;
  meiFileLocationPrintable = fLocationPrintable;
}

export function updateFileStatusDisplay() {
  document.querySelector("#fileName").innerText =
    meiFileName.substr(meiFileName.lastIndexOf("/") + 1);
  document.querySelector("#fileLocation").innerText = meiFileLocationPrintable || "";
  document.querySelector("#fileLocation").title = meiFileLocation || "";
}

export function loadDataInEditor(mei, setFreshlyLoaded = true) {
  if (storage.supported) {
    storage.override = false;
  }
  freshlyLoaded = setFreshlyLoaded;
  cm.setValue(mei);
  v.loadXml(mei);
  let bs = document.getElementById('breaks-select');
  if (bs) bs.value = v.containsBreaks() ? 'line' : 'auto';
  v.setRespSelectOptions();
}

export function updateLocalStorage(meiXml) {
  // if storage is available, save file name, location, content
  // if we're working with github, save github metadata
  if (storage.supported && !storage.override) {
    try {
      storage.fileName = meiFileName;
      storage.fileLocation = meiFileLocation;
      storage.content = meiXml;
      if (isLoggedIn) {
        updateGithubInLocalStorage();
      }
    } catch (err) {
      console.warn("Could not save file content to local storage. Content may be too big? Content length: ", meiXml.length, err);
      setFileChangedState(fileChanged); // flags any storage-exceeded issues
      storage.clear();
    }
  }
}

export function updateGithubInLocalStorage() {
  if (storage.supported && !storage.override && isLoggedIn) {
    const author = github.author;
    const name = author.name;
    const email = author.email;
    storage.github = {
      githubRepo: github.githubRepo,
      githubToken: github.githubToken,
      branch: github.branch,
      filepath: github.filepath,
      userLogin: github.userLogin,
      userName: name,
      userEmail: email
    }
    if (github.filepath) {
      storage.fileLocationType = "github";
    }
  }
}

import {
  setOrientation,
  addResizerHandlers
} from './resizer.js'
import {
  dropHandler,
  dragEnter,
  dragOverHandler,
  dragLeave
} from './dragger.js';
import {
  openUrl,
  openUrlCancel
} from './open-url.js';
import {
  createControlsMenu,
  setBreaksOptions,
  handleSmartBreaksOption,
  addModifyerKeys,
  manualCurrentPage,
  generateSectionSelect
} from './control-menu.js';
import {
  setCursorToId
} from './utils.js';
import {
  getInMeasure,
  navElsSelector,
  getElementAtCursor
} from './dom-utils.js';
import {
  addDragSelector
} from './drag-selector.js';
import * as e from './editor.js'
import Viewer from './viewer.js';
import Storage from './storage.js';
import Github from './github.js';
import * as att from './attribute-classes.js';
import {
  fillInBranchContents,
  logoutFromGithub,
  refreshGithubMenu
} from './github-menu.js';


// schemas for autocompletion
import default_schema from '../schemaInfo/mei-CMN-4.0.1.schemaInfo.js';

// mei-friend version and date
const version = 'develop-0.3.9';
const versionDate = '17 March 2022';
// const defaultMeiFileName = `${root}Beethoven_WoOAnh5_Nr1_1-Breitkopf.mei`;
const defaultMeiFileName = `${root}Beethoven_WoO70-Breitkopf.mei`;
const defaultVerovioOptions = {
  scale: 55,
  breaks: "line",
  header: "encoded",
  footer: "encoded",
  inputFrom: "mei",
  adjustPageHeight: true,
  mdivAll: true,
  outputIndent: 3,
  pageMarginLeft: 50,
  pageMarginRight: 25,
  pageMarginBottom: 10,
  pageMarginTop: 25,
  spacingLinear: .2,
  spacingNonLinear: .5,
  minLastJustification: 0,
  clefChangeFactor: .83,
  svgAdditionalAttribute: ["layer@n", "staff@n",
    "dir@vgrp", "dynam@vgrp", "hairpin@vgrp", "pedal@vgrp"
  ],
  bottomMarginArtic: 1.2,
  topMarginArtic: 1.2
};
const defaultCodeMirrorOptions = {
  lineNumbers: true,
  lineWrapping: false,
  styleActiveLine: true,
  mode: "xml",
  indentUnit: 3,
  smartIndent: true,
  tabSize: 3,
  autoCloseBrackets: true,
  autoCloseTags: true,
  matchTags: {
    bothTags: true
  },
  showTrailingSpace: true,
  foldGutter: true,
  gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
  extraKeys: {
    "'<'": completeAfter,
    "'/'": completeIfAfterLt,
    "' '": completeIfInTag,
    "'='": completeIfInTag,
    "Ctrl-Space": "autocomplete",
    "Alt-.": consultGuidelines
  },
  hintOptions: 'schema_meiCMN_401', // not cm conform: just provide schema name
  theme: 'default',
  zoomFont: 100, // my own option
  matchTheme: false, // notation matches editor theme (my option)
  defaultBrightTheme: 'default', // default theme for OS bright mode
  defaultDarkTheme: 'paraiso-dark' // 'base16-dark', // default theme for OS dark mode
};
const defaultKeyMap = `${root}keymaps/default-keymap.json`;
let fileChanged = false; // flag to track whether unsaved changes to file exist
let freshlyLoaded = false; // flag to ignore a cm.on("changes") event on file load

function completeAfter(cm, pred) {
  if (!pred || pred()) setTimeout(function() {
    if (!cm.state.completionActive)
      cm.showHint({
        completeSingle: false
      });
  }, 100);
  return CodeMirror.Pass;
}

function completeIfAfterLt(cm) {
  return completeAfter(cm, function() {
    var cur = cm.getCursor();
    return cm.getRange(CodeMirror.Pos(cur.line, cur.ch - 1), cur) == "<";
  });
}

function completeIfInTag(cm) {
  return completeAfter(cm, function() {
    var tok = cm.getTokenAt(cm.getCursor());
    if (tok.type == "string" && (!/['"]/.test(tok.string.charAt(tok.string.length - 1)) || tok.string.length == 1)) return false;
    var inner = CodeMirror.innerMode(cm.getMode(), tok.state).state;
    return inner.tagName;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  let myTextarea = document.getElementById("editor");

  cm = CodeMirror.fromTextArea(myTextarea, defaultCodeMirrorOptions);

  // check for parameters passed through URL
  let searchParams = new URLSearchParams(window.location.search);
  let scaleParam = searchParams.get('scale');

  createControlsMenu(document.querySelector('.notation'),
    scaleParam ? scaleParam : defaultVerovioOptions.scale);
  addModifyerKeys(document); //

  console.log('DOMContentLoaded. Trying now to load Verovio...');
  document.querySelector(".statusbar").innerHTML = "Loading Verovio.";
  document.querySelector(".rightfoot").innerHTML =
    "<a href='https://github.com/wergo/mei-friend-online'>mei-friend " +
    version + "</a> (" + versionDate + ").&nbsp;";

  vrvWorker = new Worker(`${root}lib/worker.js`);
  vrvWorker.onmessage = vrvWorkerEventsHandler;

  spdWorker = new Worker(`${root}lib/speed-worker.js`);
  spdWorker.postMessage({
    cmd: 'variables',
    var: att.timeSpanningElements
  });
  spdWorker.onmessage = speedWorkerEventsHandler;

  v = new Viewer(vrvWorker, spdWorker);
  v.vrvOptions = {
    ...defaultVerovioOptions
  };
  v.addCmOptionsToSettingsPanel(cm, defaultCodeMirrorOptions);

  let or = 'bottom'; // default layout orientation
  if (searchParams.get('orientation')) or = searchParams.get('orientation');
  let urlFileName = searchParams.get('file');
  if (urlFileName) {
    openUrlFetch(new URL(urlFileName));
  }
  // restore localStorage if we have it
  if (storage.supported) {
    storage.read();
    // orientation: use URI param if specified;
    //  else use stored orientation if specified;
    //  else use default
    or = searchParams.get('orientation') || storage.orientation || or;
    setFileChangedState(storage.fileChanged);
    if (!urlFileName) {
      // no URI param specified - try to restore from storage
      if (storage.content) {
        // restore file name and content from storage
        // unless a URI param was specified
        meiFileName = storage.fileName;
        meiFileLocation = storage.fileLocation;
        meiFileLocationPrintable = storage.fileLocationPrintable;
        updateFileStatusDisplay();
        // on initial page load, CM doesn't fire a "changes" event
        // so we don't need to skip the "freshly loaded" change
        // hence the "false" on the following line:
        loadDataInEditor(storage.content, false);
      } else {
        meiFileLocation = "";
        meiFileLocationPrintable = "";
        openFile(undefined, false); // default MEI, skip freshly loaded (see comment above)
        setFileChangedState(false);
      }
    }
    if (storage.github) {
      // use github object from local storage if available
      isLoggedIn = true;
      github = new Github(
        storage.github.githubRepo,
        storage.github.githubToken,
        storage.github.branch,
        storage.github.filepath,
        storage.github.userLogin,
        storage.github.userName,
        storage.github.userEmail
      )
      //document.querySelector("#fileLocation").innerText = meiFileLocationPrintable;
    } else if (isLoggedIn) {
      // initialise and store new github object
      github = new Github("", githubToken, "", "", userLogin, userName, userEmail);
      storage.github = {
        githubRepo: github.githubRepo,
        githubToken: github.githubToken,
        branch: github.branch,
        filepath: github.filepath,
        userLogin: github.userLogin,
        userName: userName,
        userEmail: userEmail
      };
    }
  } else { // no local storage
    if (isLoggedIn) { // initialise new github object
      github = new Github("", githubToken, "", "", userLogin, userName, userEmail);
    }
    meiFileLocation = "";
    meiFileLocationPrintable = "";
    openFile(); // default MEI
  }
  if (isLoggedIn) {
    // regardless of storage availability:
    // if we are logged in, refresh github menu
    refreshGithubMenu();
    if (github.githubRepo && github.branch && github.filepath) {
      // preset github menu to where the user left off, if we can
      fillInBranchContents();
    }
  }

  setOrientation(cm, or, v);
  addEventListeners(v, cm);
  addResizerHandlers(v, cm);
  let doit;
  window.onresize = () => {
    clearTimeout(doit); // wait half a second before re-calculating orientation
    doit = setTimeout(() => setOrientation(cm, '', v, storage), 500);
  };

  // ask worker to load Verovio
  v.busy();
  vrvWorker.postMessage({
    'cmd': 'loadVerovio'
  });

  setKeyMap(defaultKeyMap);
});

export async function openUrlFetch(url = '') {
  let urlInput = document.querySelector("#openUrlInput");
  let urlStatus = document.querySelector("#openUrlStatus");
  try {
    if (!url) url = new URL(urlInput.value);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/xml, text/xml, application/mei+xml'
      }
    });
    if (response.status >= 400) {
      console.warn("Fetching URL produced error status: ", response.status);
      urlStatus.innerHTML =
        `${response.status}: ${response.statusText.toLowerCase()}`
      urlStatus.classList.add("warn");
      urlInput.classList.add("warn");
    } else {
      urlStatus.innerHTML = "";
      urlStatus.classList.remove("warn");
      urlInput.classList.remove("warn");
      response.text().then((data) => {
        meiFileLocation = url.href;
        meiFileLocationPrintable = url.hostname;
        meiFileName =
          url.pathname.substr(url.pathname.lastIndexOf("/") + 1);
        if (storage.github && isLoggedIn) {
          // re-initialise github menu since we're now working from a URL
          github.filepath = "";
          github.branch = "";
          if (storage.supported) {
            updateGithubInLocalStorage();
          }
          refreshGithubMenu();
        }
        updateFileStatusDisplay();
        handleEncoding(data);
        if (storage.supported) {
          storage.fileLocationType = "url";
        }
        openUrlCancel(); //hide open URL UI elements
      });
    }
  } catch (err) {
    console.warn("Error opening URL provided by user: ", err);
    if (err instanceof TypeError) {
      urlStatus.innerHTML = "CORS error";
    } else {
      urlStatus.innerHTML = "Invalid URL, please fix..."
    }
    urlInput.classList.add("warn");
    urlStatus.classList.add("warn");
  }
}

function speedWorkerEventsHandler(ev) {
  console.log('main() speedWorkerHandler received: ' + ev.data.cmd);
  if (ev.data.cmd === 'listPageSpanningElements') {
    console.log('main() speedWorkerHandler pageSpanners: ', ev.data.pageSpanners);
    v.pageSpanners = {
      ...ev.data.pageSpanners
    };
    v.updateAll(cm, {}, v.selectedElements[0]);
    v.busy(false, true);
  }
}

function vrvWorkerEventsHandler(ev) {
  console.log('main(). Handler received: ' + ev.data.cmd, ev.data);
  switch (ev.data.cmd) {
    case 'vrvLoaded':
      console.info('main(). Handler vrvLoaded: ', this);
      tkVersion = ev.data.version;
      tkAvailableOptions = ev.data.availableOptions;
      v.addVrvOptionsToSettingsPanel(tkAvailableOptions, defaultVerovioOptions);
      v.addMeiFriendOptionsToSettingsPanel();
      document.querySelector(".rightfoot").innerHTML +=
        `&nbsp;<a href="https://www.verovio.org/">Verovio ${tkVersion}</a>.`;
      document.querySelector(".statusbar").innerHTML =
        `Verovio ${tkVersion} loaded.`;
      setBreaksOptions(tkAvailableOptions, defaultVerovioOptions.breaks);
      if (!storage.supported || !meiFileName) {
        // open default mei file
        openFile();
      } else {
        // open stored data, setting vrv options first
        v.clear();
        v.updateNotation = false;
        loadDataInEditor(storage.content);
        v.updateNotation = true;
        v.updateAll(cm);
      }
      v.busy(false);
      break;
    case 'mei': // returned from importData, importBinaryData
      mei = ev.data.mei;
      v.pageCount = ev.data.pageCount;
      v.updateNotation = false;
      loadDataInEditor(mei);
      setFileChangedState(false);
      updateLocalStorage(mei);
      v.updateNotation = true;
      v.updateAll(cm, defaultVerovioOptions);
      //v.busy(false);
      break;
    case 'updated': // display SVG data on site
      if (ev.data.mei) { // from reRenderMEI
        v.updateNotation = false;
        loadDataInEditor(ev.data.mei);
        setFileChangedState(false);
        updateLocalStorage(ev.data.mei);
        v.updateNotation = true;
        v.selectedElements = [];
        if (!ev.data.removeIds) v.selectedElements.push(ev.data.xmlId);
      }
      // add section selector
      let ss = document.getElementById('section-selector');
      while (ss.options.length > 0) ss.remove(0); // clear existing options
      let sections = generateSectionSelect(v.xmlDoc);
      if (sections.length > 1) {
        sections.forEach(opt => ss.options.add(new Option(opt[0], opt[1])));
        ss.style.display = 'block';
      } else {
        ss.style.display = 'none';
      }
      let bs = document.getElementById('breaks-select').value;
      if (ev.data.pageCount && !v.speedMode)
        v.pageCount = ev.data.pageCount;
      else if (bs == 'none') v.pageCount = 1;
      else if (v.speedMode && bs == 'auto' &&
        Object.keys(v.pageBreaks).length > 0)
        v.pageCount = Object.keys(v.pageBreaks).length;
      // update only if still same page
      if (v.currentPage == ev.data.pageNo || ev.data.forceUpdate) {
        v.currentPage = ev.data.pageNo;
        updateStatusBar();
        document.querySelector('title').innerHTML = 'mei-friend: ' +
          meiFileName.substr(meiFileName.lastIndexOf("/") + 1);
        document.querySelector('.verovio-panel').innerHTML = ev.data.svg;
        if (ev.data.setCursorToPageBeginning) v.setCursorToPageBeginning(cm);
        v.updatePageNumDisplay();
        v.addNotationEventListeners(cm);
        v.updateHighlight(cm);
        v.scrollSvg(cm);
      }
      if (!"setFocusToVerovioPane" in ev.data || ev.data.setFocusToVerovioPane)
        v.setFocusToVerovioPane();
      if (ev.data.computePageBreaks) v.computePageBreaks(cm);
      else v.busy(false);
      break;
    case 'navigatePage': // resolve navigation with page turning
      updateStatusBar();
      document.querySelector('.verovio-panel').innerHTML = ev.data.svg;
      let ms = document.querySelectorAll('.measure'); // find measures on page
      if (ms.length > 0) {
        let m = ms[0];
        if (ev.data.dir == 'backwards') m = ms[ms.length - 1]; // last measure
        let id = getInMeasure(m, navElsSelector,
          ev.data.stNo, ev.data.lyNo, ev.data.what);
        if (id) v.findClosestNoteInChord(id, ev.data.y);
        setCursorToId(cm, id);
        v.selectedElements = [];
        v.selectedElements.push(id);
        v.lastNoteId = id;
      }
      v.addNotationEventListeners(cm);
      v.scrollSvg(cm);
      v.updateHighlight(cm);
      v.setFocusToVerovioPane();
      v.busy(false);
      break;
    case 'midi': // export MIDI file
      const byteCharacters = atob(ev.data.midi);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: 'audio/midi'
      });
      var a = document.createElement('a');
      a.download = meiFileName
        .substr(meiFileName.lastIndexOf("/") + 1)
        .replace(/\.[^/.]+$/, '.mid');
      a.href = window.URL.createObjectURL(blob);
      a.click();
      v.busy(false);
      break;
    case 'computePageBreaks':
      v.pageBreaks = ev.data.pageBreaks;
      v.pageCount = ev.data.pageCount;
      // console.log('Page breaks computed for ' +
      //   meiFileName.substr(meiFileName.lastIndexOf("/") + 1) +
      //   ', pageBreaks', v.pageBreaks);
      v.updateData(cm, false, true);
      updateStatusBar();
      v.updatePageNumDisplay();
      v.busy(false);
      break;
    case 'updateProgressbar':
      document.querySelector(".statusbar").innerHTML =
        "Compute page breaks: " + Math.round(ev.data.percentage) + "%";
      setProgressBar(ev.data.percentage);
      break;
    case 'error':
      document.querySelector('.verovio-panel').innerHTML =
        "<h3>Invalid MEI in " + meiFileName +
        " (" + ev.data.msg + ")</h3>";
      v.busy(false);
      break;
  }
}

// key is the input-from option in Verovio, value the distinctive string
let inputFormats = {
  mei: "<mei",
  xml: "<score-partwise", // the only musicXML flavor supported by Verovio
  // xml: "<score-timewise", // does Verovio import timewise musicXML?
  humdrum: "**kern",
  pae: "@clef",
};

export function openFile(file = defaultMeiFileName, setFreshlyLoaded = true) {
  if (typeof file === "string") { // with fileName string
    meiFileName = file;
    console.info('openMei ' + meiFileName + ', ', cm);
    fetch(meiFileName)
      .then((response) => response.text())
      .then((meiXML) => {
        console.log('MEI file ' + meiFileName + ' loaded.');
        mei = meiXML;
        v.clear();
        v.updateNotation = false;
        loadDataInEditor(mei, setFreshlyLoaded);
        setFileChangedState(false);
        updateLocalStorage(mei)
        v.updateNotation = true;
        v.updateAll(cm);
      });
  } else { // if a file
    let readingPromise = new Promise(function(loaded, notLoaded) {
      meiFileName = file.name;
      console.info('openMei ' + meiFileName + ', ', cm);
      let reader = new FileReader();
      mei = '';
      reader.onload = (event) => {
        mei = event.target.result;
        console.info('Reader read ' + meiFileName); // + ', mei: ', mei);
        if (mei) loaded(mei);
        else notLoaded();
      }
      if (meiFileName.endsWith('.mxl')) {
        reader.readAsArrayBuffer(file);
      } else {
        reader.readAsText(file);
      }
    });
    readingPromise.then(
      function(mei) {
        handleEncoding(mei, setFreshlyLoaded);
      },
      function() {
        log('Loading dragged file ' + meiFileName + ' failed.');
        v.busy(false);
      }
    );
  }
  meiFileLocation = '';
  meiFileLocationPrintable = '';
  updateFileStatusDisplay();
}

// checks format of encoding string and imports or loads data/notation
// mei argument may be MEI or any other supported format (text/binary)
export function handleEncoding(mei, setFreshlyLoaded = true) {
  let found = false;
  v.clear();
  v.busy();
  if (meiFileName.endsWith('.mxl')) { // compressed MusicXML file
    console.log('Load compressed XML file.', mei.slice(0, 128));
    vrvWorker.postMessage({
      'cmd': 'importBinaryData',
      'format': 'xml',
      'mei': mei
    });
    found = true;
  } else if (meiFileName.endsWith('.abc')) { // abc notation file
    console.log('Load ABC file.', mei.slice(0, 128));
    vrvWorker.postMessage({
      'cmd': 'importData',
      'format': 'abc',
      'mei': mei
    });
    found = true;
  } else { // all other formats are found by search term in text file
    for (const [key, value] of Object.entries(inputFormats)) {
      if (mei.includes(value)) { // a hint that it is a MEI file
        found = true;
        console.log(key + ' file loading: ' + meiFileName);
        if (key == "mei") { // if already a mei file
          v.updateNotation = false;
          loadDataInEditor(mei, setFreshlyLoaded);
          setFileChangedState(false);
          updateLocalStorage(mei);
          v.updateNotation = true;
          v.updateAll(cm, defaultVerovioOptions);
          break;
        } else { // all other formats that Verovio imports
          vrvWorker.postMessage({
            'cmd': 'importData',
            'format': key,
            'mei': mei
          });
          break;
        }
      }
    }
  }
  if (!found) {
    if (mei.includes('<score-timewise'))
      log('Loading ' + meiFileName + 'did not succeed. ' +
        'No support for timewise MusicXML files.');
    else {
      log('Format not recognized: ' + meiFileName + '.');
    }
    v.busy(false);
  }
}

function openFileDialog(accept = '*') {
  let input = document.createElement('input');
  input.type = 'file';
  if (accept !== '*') input.accept = accept;
  input.onchange = _ => {
    let files = Array.from(input.files);
    console.log('OpenFile Dialog: ', files);
    if (files.length == 1) {
      meiFileName = files[0].name;
      meiFileLocation = "";
      meiFileLocationPrintable = "";
      openFile(files[0]);
      if (storage.supported) {
        storage.fileLocationType = "file";
      }
      if (isLoggedIn) {
        // re-initialise github menu since we're now working locally
        github.filepath = "";
        github.branch = "";
        if (storage.supported) {
          updateGithubInLocalStorage();
        }
        refreshGithubMenu();
      }
    } else {
      log('OpenFile Dialog: Multiple files not supported.');
    }
  };
  input.click();
}

function downloadMei() {
  let blob = new Blob([cm.getValue()], {
    type: 'text/plain'
  });
  let a = document.createElement('a');
  a.download = meiFileName
    .substr(meiFileName.lastIndexOf("/") + 1)
    .replace(/\.[^/.]+$/, '.mei');
  a.href = window.URL.createObjectURL(blob);
  a.click();
  // Now that the user has "saved" the MEI, clear the file change indicator
  setFileChangedState(false);
}

function downloadMidi() {
  let message = {
    'cmd': 'exportMidi',
    'options': v.vrvOptions,
    'mei': cm.getValue()
  };
  vrvWorker.postMessage(message);
}

function downloadSvg() {
  let svg = document.querySelector('.verovio-panel').innerHTML;
  let blob = new Blob([svg], {
    type: 'image/svg+xml'
  });
  let a = document.createElement('a');
  a.download = meiFileName
    .substr(meiFileName.lastIndexOf("/") + 1)
    .replace(/\.[^/.]+$/, '.svg');
  a.href = window.URL.createObjectURL(blob);
  a.click();
}

function consultGuidelines() {
  if (elementAtCursor) {
    // cursor is currently positioned on an element
    // move up to the closest "presentation" (codemirror line)
    const presentation = elementAtCursor.closest('span[role="presentation"]');
    if (presentation) {
      // choose the first XML element (a "tag" that isn't a "bracket")
      const xmlEl = presentation.querySelector(".cm-tag:not(.cm-bracket)");
      if (xmlEl) {
        let xmlElName = xmlEl.innerText;
        if (xmlElName.length && !(xmlElName.includes(":"))) {
          // it's an element in the default (hopefully MEI...) namespace
          window.open(
            guidelinesBase + "elements/" + xmlElName.toLowerCase(),
            "_blank"
          );
        }
      }
    }
  }
}


// object of interface command functions for buttons and key bindings
let cmd = {
  'firstPage': () => v.updatePage(cm, 'first'),
  'previousPage': () => v.updatePage(cm, 'backwards'),
  'nextPage': () => v.updatePage(cm, 'forwards'),
  'lastPage': () => v.updatePage(cm, 'last'),
  'nextNote': () => v.navigate(cm, 'note', 'forwards'),
  'previousNote': () => v.navigate(cm, 'note', 'backwards'),
  'nextMeasure': () => v.navigate(cm, 'measure', 'forwards'),
  'previousMeasure': () => v.navigate(cm, 'measure', 'backwards'),
  'layerUp': () => v.navigate(cm, 'layer', 'upwards'),
  'layerDown': () => v.navigate(cm, 'layer', 'downwards'),
  'notationTop': () => setOrientation(cm, "top", v, storage),
  'notationBottom': () => setOrientation(cm, "bottom", v, storage),
  'notationLeft': () => setOrientation(cm, "left", v, storage),
  'showSettingsPanel': () => v.showSettingsPanel(),
  'hideSettingsPanel': () => v.hideSettingsPanel(),
  'toggleSettingsPanel': (ev) => v.toggleSettingsPanel(ev),
  'notationRight': () => setOrientation(cm, "right", v, storage),
  'moveProgBar': () => moveProgressBar(),
  'open': () => openFileDialog(),
  'openUrl': () => openUrl(),
  'openUrlFetch': () => openUrlFetch(),
  'openUrlCancel': () => openUrlCancel(),
  'openMusicXml': () => openFileDialog('.xml,.musicxml,.mxl'),
  'openHumdrum': () => openFileDialog('.krn,.hum'),
  'openPae': () => openFileDialog('.pae,.abc'),
  'downloadMei': () => downloadMei(),
  'zoomIn': () => v.zoom(+1),
  'zoomOut': () => v.zoom(-1),
  'zoom50': () => v.zoom(50),
  'zoom100': () => v.zoom(100),
  'zoomSlider': () => v.updateLayout(),
  // add control elements
  'addSlur': () => e.addCtrlEl(v, cm, 'slur', ''),
  'addSlurBelow': () => e.addCtrlEl(v, cm, 'slur', 'below'),
  'addTie': () => e.addCtrlEl(v, cm, 'tie', ''),
  'addTieBelow': () => e.addCtrlEl(v, cm, 'tie', 'below'),
  'addCresHairpin': () => e.addCtrlEl(v, cm, 'hairpin', '', 'cres'),
  'addDimHairpin': () => e.addCtrlEl(v, cm, 'hairpin', '', 'dim'),
  'addCresHairpinBelow': () => e.addCtrlEl(v, cm, 'hairpin', 'below', 'cres'),
  'addDimHairpinBelow': () => e.addCtrlEl(v, cm, 'hairpin', 'below', 'dim'),
  'addFermata': () => e.addCtrlEl(v, cm, 'fermata', 'above', 'norm'),
  'addFermataBelow': () => e.addCtrlEl(v, cm, 'fermata', 'below', 'inv'),
  'addDirective': () => e.addCtrlEl(v, cm, 'dir', 'above', 'dolce'),
  'addDirectiveBelow': () => e.addCtrlEl(v, cm, 'dir', 'below', 'dolce'),
  'addDynamics': () => e.addCtrlEl(v, cm, 'dynam', 'above', 'mf'),
  'addDnamicsBelow': () => e.addCtrlEl(v, cm, 'dynam', 'below', 'mf'),
  'addTempo': () => e.addCtrlEl(v, cm, 'tempo', 'above', 'Allegro'),
  'addArpeggio': () => e.addCtrlEl(v, cm, 'arpeg'),
  'addGlissando': () => e.addCtrlEl(v, cm, 'gliss'),
  'addPedalDown': () => e.addCtrlEl(v, cm, 'pedal', 'down'),
  'addPedalUp': () => e.addCtrlEl(v, cm, 'pedal', 'up'),
  'addTrillAbove': () => e.addCtrlEl(v, cm, 'trill', 'above'),
  'addTrillBelow': () => e.addCtrlEl(v, cm, 'trill', 'below'),
  'addTurnAbove': () => e.addCtrlEl(v, cm, 'turn', 'above', 'upper'),
  'addTurnBelow': () => e.addCtrlEl(v, cm, 'turn', 'below', 'upper'),
  'addTurnAboveLower': () => e.addCtrlEl(v, cm, 'turn', 'above', 'lower'),
  'addTurnBelowLower': () => e.addCtrlEl(v, cm, 'turn', 'below', 'lower'),
  'addMordentAbove': () => e.addCtrlEl(v, cm, 'mordent', 'above', 'lower'),
  'addMordentBelow': () => e.addCtrlEl(v, cm, 'mordent', 'below', 'lower'),
  'addMordentAboveUpper': () => e.addCtrlEl(v, cm, 'mordent', 'above', 'upper'),
  'addMordentBelowUpper': () => e.addCtrlEl(v, cm, 'mordent', 'below', 'upper'),
  //
  'delete': () => e.delEl(v, cm),
  'invertPlacement': () => e.invertPlacement(v, cm),
  'addVerticalGroup': () => e.addVerticalGroup(v, cm),
  'toggleStacc': () => e.toggleArtic(v, cm, 'stacc'),
  'toggleAccent': () => e.toggleArtic(v, cm, 'acc'),
  'toggleTenuto': () => e.toggleArtic(v, cm, 'ten'),
  'toggleMarcato': () => e.toggleArtic(v, cm, 'marc'),
  'toggleStacciss': () => e.toggleArtic(v, cm, 'stacciss'),
  'toggleSpicc': () => e.toggleArtic(v, cm, 'spicc'),
  'shiftPitchNameUp': () => e.shiftPitch(v, cm, 1),
  'shiftPitchNameDown': () => e.shiftPitch(v, cm, -1),
  'shiftOctaveUp': () => e.shiftPitch(v, cm, 7),
  'shiftOctaveDown': () => e.shiftPitch(v, cm, -7),
  'moveElementStaffUp': () => e.moveElementToNextStaff(v, cm, true),
  'moveElementStaffDown': () => e.moveElementToNextStaff(v, cm, false),
  'addOctave8Above': () => e.addOctaveElement(v, cm, 'above', 8),
  'addOctave8Below': () => e.addOctaveElement(v, cm, 'below', 8),
  'addOctave15Above': () => e.addOctaveElement(v, cm, 'above', 15),
  'addOctave15Below': () => e.addOctaveElement(v, cm, 'below', 15),
  'addGClefChangeBefore': () => e.addClefChange(v, cm, 'G', '2', true),
  'addCClefChangeBefore': () => e.addClefChange(v, cm, 'C', '3', true),
  'addFClefChangeBefore': () => e.addClefChange(v, cm, 'F', '4', true),
  'addGClefChangeAfter': () => e.addClefChange(v, cm, 'G', '2', false),
  'addCClefChangeAfter': () => e.addClefChange(v, cm, 'C', '3', false),
  'addFClefChangeAfter': () => e.addClefChange(v, cm, 'F', '4', false),
  'addBeam': () => e.addBeamElement(v, cm),
  'addBeamSpan': () => e.addBeamSpan(v, cm),
  'addSupplied': () => e.addSuppliedElement(v, cm),
  'cleanAccid': () => e.cleanAccid(v, cm),
  'renumberMeasuresTest': () => e.renumberMeasures(v, cm, false),
  'renumberMeasures': () => e.renumberMeasures(v, cm, true),
  'reRenderMei': () => v.reRenderMei(cm, false),
  'reRenderMeiWithout': () => v.reRenderMei(cm, true),
  'resetDefault': () => {
    // we're in a clickhandler, so our storage object is out of scope
    // but we only need to clear it, so just grab the window's storage
    storage = window.localStorage;
    if (storage) {
      storage.clear();
    }
    logoutFromGithub();
  },
  'consultGuidelines': () => consultGuidelines()
};

// add event listeners when controls menu has been instantiated
function addEventListeners(v, cm) {
  let vp = document.querySelector('.verovio-panel');

  // layout notation position
  document.getElementById('top').addEventListener('click', cmd.notationTop);
  document.getElementById('bottom').addEventListener('click', cmd.notationBottom);
  document.getElementById('left').addEventListener('click', cmd.notationLeft);
  document.getElementById('right').addEventListener('click', cmd.notationRight);

  // show settings panel
  document.getElementById('showSettingsMenu').addEventListener('click', cmd.showSettingsPanel);
  document.getElementById('showSettingsButton').addEventListener('click', cmd.showSettingsPanel);
  document.getElementById('hideSettingsButton').addEventListener('click', cmd.hideSettingsPanel);
  document.getElementById('closeSettingsButton').addEventListener('click', cmd.hideSettingsPanel);

  // open dialogs
  document.getElementById('OpenMei').addEventListener('click', cmd.open);
  document.getElementById('OpenUrl').addEventListener('click', cmd.openUrl);
  document.getElementById('ImportMusicXml').addEventListener('click', cmd.openMusicXml);
  document.getElementById('ImportHumdrum').addEventListener('click', cmd.openHumdrum);
  document.getElementById('ImportPae').addEventListener('click', cmd.openPae);
  document.getElementById('SaveMei').addEventListener('click', downloadMei);
  document.getElementById('SaveSvg').addEventListener('click', downloadSvg);
  document.getElementById('SaveMidi').addEventListener('click', downloadMidi);

  // edit dialogs
  document.getElementById('startSearch').addEventListener('click', () => CodeMirror.commands.find(cm));
  document.getElementById('findNext').addEventListener('click', () => CodeMirror.commands.findNext(cm));
  document.getElementById('findPrevious').addEventListener('click', () => CodeMirror.commands.findPrev(cm));
  document.getElementById('replace').addEventListener('click', () => CodeMirror.commands.replace(cm));
  document.getElementById('replaceAll').addEventListener('click', () => CodeMirror.commands.replaceAll(cm));
  document.getElementById('jumpToLine').addEventListener('click', () => CodeMirror.commands.jumpToLine(cm));
  document.querySelectorAll('.keyShortCut').forEach(e => e.classList.add(navigator.platform.startsWith('Mac') ? 'platform-mac' : 'platform-nonmac'));

  // open URL interface
  document.getElementById('openUrlButton').addEventListener('click', cmd.openUrlFetch);
  document.getElementById('openUrlCancel').addEventListener('click', cmd.openUrlCancel);
  document.getElementById('openUrlInput').addEventListener('input', (e) => {
    e.target.classList.remove("warn");
    document.getElementById("openUrlStatus").classList.remove("warn");
  });

  // drag'n'drop handlers
  let fc = document.querySelector('.dragContainer');
  fc.addEventListener('drop', () => dropHandler(event));
  fc.addEventListener('dragover', () => dragOverHandler(event));
  fc.addEventListener("dragenter", () => dragEnter(event));
  fc.addEventListener("dragleave", () => dragLeave(event));
  fc.addEventListener("dragstart", (ev) => console.log('Drag Start', ev));
  fc.addEventListener("dragend", (ev) => console.log('Drag End', ev));

  // Zooming with buttons
  document.getElementById('decrease-scale-btn').addEventListener('click', cmd.zoomOut);
  document.getElementById('increase-scale-btn').addEventListener('click', cmd.zoomIn);
  document.getElementById('verovio-zoom').addEventListener('click', cmd.zoomSlider);

  // Zooming notation with mouse wheel
  vp.addEventListener('wheel', ev => {
    if ((navigator.platform.toLowerCase().startsWith('mac') && ev.metaKey) ||
      !navigator.platform.toLowerCase().startsWith('mac') && ev.ctrlKey) {
      ev.preventDefault();
      ev.stopPropagation();
      v.zoom(Math.sign(ev.deltaY) * -5); // scrolling towards user = increase
    }
  });

  // Page turning
  let ss = document.getElementById('section-selector');
  ss.addEventListener('change', () => {
    v.updateNotation = false;
    setCursorToId(cm, ss.value);
    v.updatePage(cm, '', ss.value);
    v.updateNotation = true;
  });
  document.getElementById('first-page-btn').addEventListener('click', cmd.firstPage);
  document.getElementById('prev-page-btn').addEventListener('click', cmd.previousPage);
  document.getElementById('next-page-btn').addEventListener('click', cmd.nextPage);
  document.getElementById('last-page-btn').addEventListener('click', cmd.lastPage);
  // manual page entering
  document.getElementById('pagination2').addEventListener('keydown', ev => manualCurrentPage(v, cm, ev));
  document.getElementById('pagination2').addEventListener('blur', ev => manualCurrentPage(v, cm, ev));
  // font selector
  document.getElementById('font-select').addEventListener('change', () => v.updateOption());
  // breaks selector
  document.getElementById('breaks-select').addEventListener('change', () => {
    v.pageSpanners = {};
    v.updateAll(cm, {}, v.selectedElements[0]);
  });
  // navigation
  document.getElementById('backwards-btn').addEventListener('click', cmd.previousNote);
  document.getElementById('forwards-btn').addEventListener('click', cmd.nextNote);
  document.getElementById('upwards-btn').addEventListener('click', cmd.layerUp);
  document.getElementById('downwards-btn').addEventListener('click', cmd.layerDown);
  // manipulation
  document.getElementById('invertPlacement').addEventListener('click', cmd.invertPlacement);
  document.getElementById('addVerticalGroup').addEventListener('click', cmd.addVerticalGroup);
  document.getElementById('delete').addEventListener('click', cmd.delete);
  document.getElementById('pitchUp').addEventListener('click', cmd.shiftPitchNameUp);
  document.getElementById('pitchDown').addEventListener('click', cmd.shiftPitchNameDown);
  document.getElementById('pitchOctaveUp').addEventListener('click', cmd.shiftOctaveUp);
  document.getElementById('pitchOctaveDown').addEventListener('click', cmd.shiftOctaveDown);
  document.getElementById('staffUp').addEventListener('click', cmd.moveElementStaffUp);
  document.getElementById('staffDown').addEventListener('click', cmd.moveElementStaffDown);
  // Manipulate encoding methods
  document.getElementById('cleanAccid').addEventListener('click', () => e.cleanAccid(v, cm));
  document.getElementById('renumTest').addEventListener('click', () => e.renumberMeasures(v, cm, false));
  document.getElementById('renumExec').addEventListener('click', () => e.renumberMeasures(v, cm, true));
  // re-render through Verovio
  document.getElementById('reRenderMei').addEventListener('click', cmd.reRenderMei);
  document.getElementById('reRenderMeiWithout').addEventListener('click', cmd.reRenderMeiWithout);
  // insert control elements
  document.getElementById('addTempo').addEventListener('click', cmd.addTempo);
  document.getElementById('addDirective').addEventListener('click', cmd.addDirective);
  document.getElementById('addDynamics').addEventListener('click', cmd.addDynamics);
  document.getElementById('addSlur').addEventListener('click', cmd.addSlur);
  document.getElementById('addTie').addEventListener('click', cmd.addTie);
  document.getElementById('addCresHairpin').addEventListener('click', cmd.addCresHairpin);
  document.getElementById('addDimHairpin').addEventListener('click', cmd.addDimHairpin);
  document.getElementById('addBeam').addEventListener('click', cmd.addBeam);
  document.getElementById('addBeamSpan').addEventListener('click', cmd.addBeamSpan);
  document.getElementById('addSupplied').addEventListener('click', cmd.addSupplied);
  document.getElementById('addArpeggio').addEventListener('click', cmd.addArpeggio);
  // more control elements
  document.getElementById('addFermata').addEventListener('click', cmd.addFermata);
  document.getElementById('addGlissando').addEventListener('click', cmd.addGlissando);
  document.getElementById('addPedalDown').addEventListener('click', cmd.addPedalDown);
  document.getElementById('addPedalUp').addEventListener('click', cmd.addPedalUp);
  document.getElementById('addTrillAbove').addEventListener('click', cmd.addTrillAbove);
  document.getElementById('addTurnAbove').addEventListener('click', cmd.addTurnAbove);
  document.getElementById('addTurnAboveLower').addEventListener('click', cmd.addTurnAboveLower);
  document.getElementById('addMordentAbove').addEventListener('click', cmd.addMordentAbove);
  document.getElementById('addMordentAboveUpper').addEventListener('click', cmd.addMordentAboveUpper);
  document.getElementById('addOctave8Above').addEventListener('click', cmd.addOctave8Above);
  document.getElementById('addOctave15Above').addEventListener('click', cmd.addOctave15Above);
  document.getElementById('addOctave8Below').addEventListener('click', cmd.addOctave8Below);
  document.getElementById('addOctave15Below').addEventListener('click', cmd.addOctave15Below);
  // add clef change
  document.getElementById('addGClefChangeBefore').addEventListener('click', cmd.addGClefChangeBefore);
  document.getElementById('addCClefChangeBefore').addEventListener('click', cmd.addCClefChangeBefore);
  document.getElementById('addFClefChangeBefore').addEventListener('click', cmd.addFClefChangeBefore);
  document.getElementById('addGClefChangeAfter').addEventListener('click', cmd.addGClefChangeAfter);
  document.getElementById('addCClefChangeAfter').addEventListener('click', cmd.addCClefChangeAfter);
  document.getElementById('addFClefChangeAfter').addEventListener('click', cmd.addFClefChangeAfter);
  // toggle articulation
  document.getElementById('toggleStacc').addEventListener('click', cmd.toggleStacc);
  document.getElementById('toggleAccent').addEventListener('click', cmd.toggleAccent);
  document.getElementById('toggleTenuto').addEventListener('click', cmd.toggleTenuto);
  document.getElementById('toggleMarcato').addEventListener('click', cmd.toggleMarcato);
  document.getElementById('toggleStacciss').addEventListener('click', cmd.toggleStacciss);
  document.getElementById('toggleSpicc').addEventListener('click', cmd.toggleSpicc);

  // consult guidelines
  document.getElementById('consultGuidelines')
    .addEventListener('click', cmd.consultGuidelines);

  // reset application
  document.getElementById('resetDefault').addEventListener('click', cmd.resetDefault);

  // editor activity
  cm.on('cursorActivity', () => {
    v.cursorActivity(cm);
    // determine element at encoding cursor
    // (to offer guidelines page if requested)
    elementAtCursor = getElementAtCursor(cm);
  });

  // flip button updates manually notation location to cursor pos in encoding
  document.getElementById('flip-btn').addEventListener('click', () => {
    v.cursorActivity(cm, true);
  });

  // when activated, update notation location once
  let fl = document.getElementById('flip-checkbox');
  fl.addEventListener('change', () => {
    if (fl.checked) v.cursorActivity(cm, true)
  });

  // editor reports changes
  cm.on('changes', () => {
    const commitUI = document.querySelector("#commitUI");
    let changeIndicator = false;
    let meiXml = cm.getValue();
    if (isLoggedIn && github.filepath && commitUI) {
      // fileChanged flag may have been set from storage - if so, run with it
      // otherwise set it to true if we've changed the file content this session
      changeIndicator = fileChanged || meiXml !== github.content;
    } else {
      // interpret any CodeMirror change as a file changed state
      changeIndicator = true;
    }
    if (freshlyLoaded) {
      // ignore changes resulting from fresh file load
      freshlyLoaded = false;
    } else {
      setFileChangedState(changeIndicator);
    }
    v.notationUpdated(cm);
    if (storage.supported) {
      // on every set of changes, save editor content
      updateLocalStorage(meiXml);
    }
  })

  // Editor font size zooming
  document.querySelector('.encoding').addEventListener('wheel', ev => {
    if ((navigator.platform.toLowerCase().startsWith('mac') && ev.metaKey) ||
      !navigator.platform.toLowerCase().startsWith('mac') && ev.ctrlKey) {
      ev.preventDefault();
      ev.stopPropagation();
      v.changeEditorFontSize(Math.sign(ev.deltaY) * -5);
    }
  });
  document.querySelector('.encoding').addEventListener('keydown', ev => {
    if ((navigator.platform.toLowerCase().startsWith('mac') && ev.metaKey) ||
      !navigator.platform.toLowerCase().startsWith('mac') && ev.ctrlKey) {
      if (ev.key === '-') {
        ev.preventDefault();
        ev.stopPropagation();
        v.changeEditorFontSize(-5);
      }
      if (ev.key === '+') {
        ev.preventDefault();
        ev.stopPropagation();
        v.changeEditorFontSize(+5);
      }
      if (ev.key === '0') {
        ev.preventDefault();
        ev.stopPropagation();
        v.changeEditorFontSize(100);
      }
    }
  });

  // manually update notation rendering from encoding
  document.getElementById('code-update-btn').addEventListener('click', () => {
    v.notationUpdated(cm, true);
  });

  // when activated, update notation once
  let ch = document.getElementById('live-update-checkbox');
  ch.addEventListener('change', () => {
    if (ch.checked) v.notationUpdated(cm, true);
  });

  // speedmode checkbox
  document.getElementById('speed-checkbox').addEventListener('change', (ev) => {
    v.speedMode = ev.target.checked;
    handleSmartBreaksOption(v.speedMode);
    if (v.speedMode && Object.keys(v.pageBreaks).length > 0)
      v.pageCount = Object.keys(v.pageBreaks).length;
    // else
    //   v.pageBreaks = {};
    v.updateAll(cm, {}, v.selectedElements[0]);
  });

  addDragSelector(v, vp);
} // addEventListeners()


// progress bar demo
function moveProgressBar() {
  var elem = document.querySelector(".progressbar");
  var width = 0; // % progress
  var id = setInterval(frame, 10);

  function frame() {
    (width < 100) ? elem.style.width = (++width) + '%': clearInterval(id);
  }
}

// control progress bar progress/width (in percent)
function setProgressBar(percentage) {
  document.querySelector(".progressbar").style.width = percentage + '%';
}

function updateStatusBar() {
  document.querySelector(".statusbar").innerHTML =
    meiFileName.substr(meiFileName.lastIndexOf("/") + 1) +
    ", page " + v.currentPage + " of " +
    ((v.pageCount < 0) ? '?' : v.pageCount) + " loaded.";
}

export function log(s) {
  document.querySelector(".statusbar").innerHTML = s;
  document.querySelector(".verovio-panel").innerHTML = s;
  console.log(s);
}

// sets keyMap.json to target element and defines listeners
function setKeyMap(keyMapFilePath) {
  let os = navigator.platform;
  let vp = document.querySelector('.notation');
  if (os.startsWith('Mac')) vp.classList.add('platform-darwin');
  if (os.startsWith('Win')) vp.classList.add('platform-win32');
  if (os.startsWith('Linux')) vp.classList.add('platform-linux');
  fetch(keyMapFilePath)
    .then((resp) => {
      return resp.json();
    })
    .then((keyMap) => {
      // iterate all keys (element) in keymap.json
      for (const [key, value] of Object.entries(keyMap)) {
        let el = document.querySelector(key);
        if (el) {
          el.setAttribute('tabindex', '-1');
          el.addEventListener('keydown', (ev) => {
            if (document.activeElement.id !== 'pagination2') {
              ev.stopPropagation();
              ev.preventDefault();
            }
            let keyName = ev.key;
            if (ev.code.toLowerCase() == 'space') keyName = 'space';
            // arrowdown -> down
            keyName = keyName.toLowerCase().replace('arrow', '');
            let keyPress = '';
            if (ev.ctrlKey) keyPress += 'ctrl-';
            if (ev.metaKey) keyPress += 'cmd-';
            if (ev.shiftKey) keyPress += 'shift-';
            if (ev.altKey) keyPress += 'alt-';
            keyPress += keyName;
            console.info('keyPressString: "' + keyPress + '"');
            let methodName = value[keyPress];
            if (methodName !== undefined) {
              console.log('keyMap method ' + methodName + '.', cmd[methodName]);
              cmd[methodName]();
            }
          });
        }
      }
    });
}
