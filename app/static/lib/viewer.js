import * as dutils from './dom-utils.js';
import * as prs from './page-range-selector.js';
import * as speed from './speed.js';
import * as utils from './utils.js';
import { getControlMenuState, showPdfButtons, setControlMenuState, setCheckbox } from './control-menu.js';
import { alert, download, info, success, verified, unverified, xCircleFill } from '../css/icons.js';
import { highlightZone } from './facsimile.js';
import {
  cm,
  cmd,
  commonSchemas,
  isSafari,
  meiFileName,
  rngLoader,
  platform,
  storage,
  tkVersion,
  v,
  validate,
  validator,
  version,
  versionDate,
} from './main.js';
import { selectMarkup } from './markup.js';
import { startMidiTimeout } from './midi-player.js';
import { getNotationProportion, setNotationProportion, setOrientation } from './resizer.js';

export default class Viewer {
  constructor(vrvWorker, spdWorker) {
    this.vrvWorker = vrvWorker;
    this.spdWorker = spdWorker;
    this.validatorInitialized = false;
    this.validatorWithSchema = false;
    this.currentSchema = '';
    this.xmlIdStyle; // xml:id style (Original, Base36, mei-friend)
    this.updateLinting; // CodeMirror function for linting
    this.currentPage = 1;
    this.pageCount = 0;
    this.selectedElements = [];
    this.lastNoteId = '';
    this.notationNightMode = false;
    this.allowCursorActivity = true; // whether or not notation gets re-rendered after text changes
    this.allowNotationInteraction = true; // allow mouse drag-select and click on notation
    this.speedMode = true; // speed mode (just feeds on page to Verovio to reduce drawing time)
    this.parser = new DOMParser();
    this.xmlDoc;
    this.xmlDocOutdated = true; // to limit recalculation of DOM or pageLists
    this.toolkitDataOutdated = true; // to control re-loading of toolkit data in the worker
    this.pageBreaks = {}; // object of page number and last measure id '1': 'measure-000423', ...
    this.pageSpanners = {
      // object storing all time-spannind elements spanning across pages
      start: {},
      end: {},
    };
    // this.scoreDefList = []; // list of xmlNodes, one for each change, referenced by 5th element of pageList
    this.meiHeadRange = [];
    this.vrvOptions; // all verovio options
    this.vrvTimeout; // time out task for updating verovio settings
    this.timeoutDelay = 300; // ms, window in which concurrent clicks are treated as one update
    this.verovioIcon = document.getElementById('verovio-icon');
    this.breaksSelect = /** @type HTMLSelectElement */ (document.getElementById('breaks-select'));
    this.respId = '';
    this.alertCloser;
    this.pdfMode = false;
    this.controlMenuState = {};
    this.settingsReplaceFriendContainer = false; // whether or not the settings panel is over the mei-friend window (false) or replaces it (true)
    this.notationProportion = 0.5; // remember proportion during pdf mode
  } // constructor()

  // change options, load new data, render current page, add listeners, highlight
  updateAll(cm, options = {}, xmlId = '') {
    this.setVerovioOptions(options);
    let computePageBreaks = false;
    let p = this.currentPage;
    if (this.speedMode && Object.keys(this.pageBreaks).length === 0 && this.breaksSelect.value === 'auto') {
      computePageBreaks = true;
      p = 1; // request page one, but leave currentPage unchanged
    }
    if (this.speedMode && xmlId) {
      const breaksOption = this.breaksSelect.value;
      speed.getPageWithElement(this.xmlDoc, this.breaksValue(), xmlId, breaksOption).then((p) => {
        this.changeCurrentPage(p);
        this.postUpdateAllMessage(xmlId, p, computePageBreaks);
      });
    } else {
      this.postUpdateAllMessage(xmlId, p, computePageBreaks);
    }
  } // updateAll()

  // helper function to send a message to the worker
  postUpdateAllMessage(xmlId, p, computePageBreaks) {
    let message = {
      cmd: 'updateAll',
      options: this.vrvOptions,
      mei: this.speedFilter(cm.getValue()),
      pageNo: p,
      xmlId: xmlId,
      speedMode: this.speedMode,
      computePageBreaks: computePageBreaks,
    };
    this.busy();
    this.vrvWorker.postMessage(message);
  } // postUpdateAllMessage()

  updateData(cm, setCursorToPageBeg = true, setFocusToVerovioPane = true, withMidiSeek = false) {
    let message = {
      breaks: this.breaksSelect.value,
      cmd: 'updateData',
      mei: this.speedFilter(cm.getValue()),
      pageNo: this.currentPage,
      xmlId: '',
      setCursorToPageBeginning: setCursorToPageBeg,
      setFocusToVerovioPane: setFocusToVerovioPane,
      speedMode: this.speedMode,
      withMidiSeek: withMidiSeek,
    };
    this.busy();
    this.vrvWorker.postMessage(message);
  } // updateData()

  updatePage(cm, page, xmlId = '', setFocusToVerovioPane = true, withMidiSeek = true) {
    if (this.changeCurrentPage(page) || xmlId) {
      if (!this.speedMode) {
        let message = {
          cmd: 'updatePage',
          pageNo: this.currentPage,
          xmlId: xmlId,
          setFocusToVerovioPane: setFocusToVerovioPane,
        };
        this.busy();
        this.vrvWorker.postMessage(message);
      } else {
        // speed mode
        this.loadXml(cm.getValue());
        if (xmlId) {
          speed
            .getPageWithElement(this.xmlDoc, this.breaksValue(), xmlId, this.breaksSelect.value)
            .then((pageNumber) => {
              this.changeCurrentPage(pageNumber);
              console.info('UpdatePage(speedMode=true): page: ' + this.currentPage + ', xmlId: ' + xmlId);
              this.updateData(cm, xmlId ? false : true, setFocusToVerovioPane);
            });
        } else {
          withMidiSeek = withMidiSeek && document.getElementById('showMidiPlaybackControlBar').checked;
          this.updateData(cm, xmlId ? false : true, setFocusToVerovioPane, withMidiSeek);
        }
      }
    }
    if (withMidiSeek && document.getElementById('showMidiPlaybackControlBar').checked) {
      // start a new midi playback time-out (re-rendering if we're in speedmode)
      startMidiTimeout(this.speedMode ? true : false);
    }
  } // updatePage()

  // update: options, redoLayout, page/xml:id, render page
  updateLayout(options = {}) {
    this.updateQuick(options, 'updateLayout');
  } // updateLayout()

  // update: options, page/xml:id, render page
  updateOption(options = {}) {
    this.updateQuick(options, 'updateOption');
  } // updateOption()

  // updateLayout and updateOption
  updateQuick(options, what) {
    // if (!this.speedMode) {
    let id = '';
    if (this.selectedElements[0]) id = this.selectedElements[0];
    this.setVerovioOptions(options);
    let message = {
      cmd: what,
      options: this.vrvOptions,
      pageNo: this.currentPage,
      xmlId: id,
      speedMode: this.speedMode,
    };
    this.busy();
    this.vrvWorker.postMessage(message);
  } // updateQuick()

  async getPageWithElement(xmlId) {
    let pageNumber = -1;
    if (this.speedMode) {
      pageNumber = speed.getPageWithElement(this.xmlDoc, this.breaksValue(), xmlId, this.breaksSelect.value);
    } else {
      pageNumber = await this.getPageWithElementFromVrvWorker(xmlId);
    }
    return pageNumber;
  } // getPageWithElement()

  getPageWithElementFromVrvWorker(xmlId) {
    let that = this;
    return new Promise(
      function (resolve, reject) {
        let taskId = Math.random();
        const msg = {
          cmd: 'getPageWithElement',
          msg: xmlId,
          taskId: taskId,
        };
        that.vrvWorker.addEventListener('message', function handle(ev) {
          if (ev.data.cmd === 'pageWithElement' && ev.data.taskId === taskId) {
            let p = ev.data.msg;
            that.vrvWorker.removeEventListener('message', handle);
            resolve(p);
          }
        });
        that.vrvWorker.postMessage(msg);
      }.bind(that)
    );
  } // getPageWithElementFromVrvWorker()

  // with normal mode: load DOM and pass-through the MEI code;
  // with speed mode: load into DOM (if xmlDocOutdated) and
  // return MEI excerpt of currentPage page
  // (including dummy measures before and after current page by default)
  speedFilter(mei, includeDummyMeasures = true) {
    // update DOM only if encoding has been edited or
    this.loadXml(mei);
    let breaks = this.breaksValue();
    let breaksSelectVal = this.breaksSelect.value;
    if (!this.speedMode || breaksSelectVal === 'none') return mei;
    this.xmlDoc = selectMarkup(this.xmlDoc); // select markup
    // count pages from system/pagebreaks
    if (Array.isArray(breaks)) {
      let music = this.xmlDoc.querySelector('music score');
      let elements;
      if (music) elements = music.querySelectorAll('measure, sb, pb');
      else return '';
      // count pages
      this.pageCount = 1; // pages are one-based
      let countBreaks = false;
      for (let e of elements) {
        if (e.nodeName === 'measure') countBreaks = true; // skip leading breaks
        if (countBreaks && breaks.includes(e.nodeName)) {
          // if within app, increment only if inside lem or 1st rdg
          if (dutils.countAsBreak(e)) this.pageCount++;
        }
      }
      for (let e of Array.from(elements).reverse()) {
        // skip trailing breaks
        if (e.nodeName === 'measure') break;
        if (countBreaks && breaks.includes(e.nodeName)) this.pageCount--;
      }
    }
    if (this.pageCount > 0 && (this.currentPage < 1 || this.currentPage > this.pageCount)) this.currentPage = 1;
    console.info('xmlDOM pages counted: currentPage: ' + this.currentPage + ', pageCount: ' + this.pageCount);
    // compute time-spanning elements object in speed-worker
    if (
      tkVersion &&
      this.pageSpanners.start &&
      Object.keys(this.pageSpanners.start).length === 0 &&
      (breaksSelectVal !== 'auto' || Object.keys(this.pageBreaks).length > 0)
    ) {
      // use worker solution with swift txml parsing
      let message = {
        cmd: 'listPageSpanningElements',
        mei: mei,
        breaks: breaks,
        breaksOpt: breaksSelectVal,
      };
      this.busy(true, true); // busy with anti-clockwise rotation
      this.spdWorker.postMessage(message);
      // this.pageSpanners = speed
      //   .listPageSpanningElements(this.xmlDoc, breaks, breaksSelectVal);
      // if (Object.keys(this.pageSpanners).length > 0)
      //   console.log('pageSpanners object size: ' +
      //     Object.keys(this.pageSpanners.start).length + ', ', this.pageSpanners);
      // else console.log('pageSpanners empty: ', this.pageSpanners);
    }
    // retrieve requested MEI page from DOM
    return speed.getPageFromDom(this.xmlDoc, this.currentPage, breaks, this.pageSpanners, includeDummyMeasures);
  } // speedFilter()

  loadXml(mei, forceReload = false) {
    if (this.xmlDocOutdated || forceReload) {
      this.xmlDoc = this.parser.parseFromString(mei, 'text/xml');
      this.xmlDocOutdated = false;
    }
  } // loadXml()

  // returns true if sb/pb elements are contained (more than the leading pb)
  containsBreaks() {
    let music = this.xmlDoc.querySelector('music');
    let elements;
    if (music) elements = music.querySelectorAll('measure, sb, pb');
    else return false;
    let countBreaks = false;
    for (let e of elements) {
      if (e.nodeName === 'measure') countBreaks = true; // skip leading breaks
      if (countBreaks && ['sb', 'pb'].includes(e.nodeName)) return true;
    }
    return false;
  } // containsBreaks()

  clear() {
    this.selectedElements = [];
    this.lastNoteId = '';
    this.currentPage = 1;
    this.pageCount = -1;
    this.pageBreaks = {};
    this.pageSpanners = {
      start: {},
      end: {},
    };
  } // clear()

  // re-render MEI through Verovio, while removing or adding xml:ids
  reRenderMei(cm, removeIds = false) {
    let message = {
      cmd: 'reRenderMei',
      format: 'mei',
      mei: cm.getValue(),
      pageNo: this.currentPage,
      removeIds: removeIds,
    };
    if (false && !removeIds) message.xmlId = this.selectedElements[0]; // TODO
    this.busy();
    this.vrvWorker.postMessage(message);
  } // reRenderMei()

  computePageBreaks(cm) {
    let message = {
      cmd: 'computePageBreaks',
      options: this.vrvOptions,
      format: 'mei',
      mei: cm.getValue(),
    };
    this.busy();
    this.vrvWorker.postMessage(message);
  } // computePageBreaks()

  // update options in viewer from user interface
  setVerovioOptions(newOptions = {}) {
    if (Object.keys(newOptions).length > 0)
      this.vrvOptions = {
        ...newOptions,
      };
    let zoom = document.getElementById('verovio-zoom');
    if (zoom) this.vrvOptions.scale = parseInt(zoom.value);
    let fontSel = document.getElementById('font-select');
    if (fontSel) this.vrvOptions.font = fontSel.value;
    let bs = this.breaksSelect;
    if (bs) this.vrvOptions.breaks = bs.value;

    // update page dimensions, only if not in pdf mode
    if (this.pdfMode) {
      let vpw = document.getElementById('vrv-pageWidth');
      if (vpw) this.vrvOptions.pageWidth = vpw.value;
      let vph = document.getElementById('vrv-pageHeight');
      if (vph) this.vrvOptions.pageHeight = vph.value;
    } else {
      let dimensions = {}; // = getVerovioContainerSize();
      let vp = document.getElementById('verovio-panel');
      dimensions.width = vp.clientWidth;
      dimensions.height = vp.clientHeight;
      // console.info('client size: ' + dimensions.width + '/' + dimensions.height);
      if (this.vrvOptions.breaks !== 'none') {
        this.vrvOptions.pageWidth = Math.max(Math.round(dimensions.width * (100 / this.vrvOptions.scale)), 100);
        this.vrvOptions.pageHeight = Math.max(Math.round(dimensions.height * (100 / this.vrvOptions.scale)), 100);
      }
      // console.info('Vrv pageWidth/Height: ' + this.vrvOptions.pageWidth + '/' + this.vrvOptions.pageHeight);
    }
    // overwrite existing options if new ones are passed in
    // for (let key in newOptions) { this.vrvOptions[key] = newOptions[key]; }
    console.info('Verovio options updated: ', this.vrvOptions);
  } // setVerovioOptions()

  // accepts number or string (first, last, forwards, backwards)
  changeCurrentPage(newPage) {
    let targetpage = -1;
    if (Number.isInteger(newPage)) {
      targetpage = newPage;
      // console.info('targetPage: ', targetpage);
    } else if (typeof newPage === 'string') {
      newPage = newPage.toLowerCase();
      if (newPage === 'first') {
        targetpage = 1;
      } else if (newPage === 'last') {
        targetpage = this.pageCount;
      } else if (newPage === 'forwards') {
        if (this.currentPage < this.pageCount) {
          targetpage = this.currentPage + 1;
        }
      } else if (newPage === 'backwards') {
        if (this.currentPage > 1) {
          targetpage = this.currentPage - 1;
        }
      }
    }
    // if within a sensible range, update and return true
    if (targetpage > 0 && targetpage <= this.pageCount && targetpage != this.currentPage) {
      this.currentPage = targetpage;
      if (storage && storage.supported) storage.page = this.currentPage;
      this.updatePageNumDisplay();
      return true;
    }
    // dont update and return false otherwise
    return false;
  } // changeCurrentPage()

  updatePageNumDisplay() {
    let pg = this.pageCount < 0 ? '?' : this.pageCount;
    document.getElementById('pagination1').innerHTML = 'Page&nbsp;';
    document.getElementById('pagination2').innerHTML = `&nbsp;${this.currentPage}&nbsp;`;
    document.getElementById('pagination3').innerHTML = `&nbsp;of ${pg}`;
    prs.updatePageRangeSelector(this);
  } // updatePageNumDisplay()

  // set cursor to first note id in page, taking st/ly of id, if possible
  setCursorToPageBeginning(cm) {
    this.selectedElements = [];
    if (!v.allowNotationInteraction) return;
    let id = this.lastNoteId;
    let stNo, lyNo;
    let sc;
    if (id === '') {
      let note = document.querySelector('.note');
      if (note) id = note.getAttribute('id');
      else return '';
    } else {
      sc = cm.getSearchCursor('xml:id="' + id + '"');
      if (sc.findNext()) {
        const p = sc.from();
        stNo = utils.getElementAttributeAbove(cm, p.line, 'staff')[0];
        lyNo = utils.getElementAttributeAbove(cm, p.line, 'layer')[0];
        let m = document.querySelector('.measure');
        // console.info('setCursorToPgBg st/ly;m: ' + stNo + '/' + lyNo + '; ', m);
        if (m) {
          id = dutils.getFirstInMeasure(m, dutils.navElsSelector, stNo, lyNo);
        }
      }
    }
    utils.setCursorToId(cm, id);
    // console.info('setCrsrToPgBeg(): lastNoteId: ' + this.lastNoteId + ', new id: ' + id);
    this.selectedElements.push(id);
    this.lastNoteId = id;
    return id;
  } // setCursorToPageBeginning()

  addNotationEventListeners(cm) {
    let vp = document.getElementById('verovio-panel');
    if (vp) {
      let elements = vp.querySelectorAll('g[id],rect[id],text[id]');
      elements.forEach((item) => {
        item.addEventListener('click', (event) => this.handleClickOnNotation(event, cm));
      });
    }
  } // addNotationEventListeners()

  handleClickOnNotation(e, cm) {
    if (!this.allowNotationInteraction) return;
    e.stopImmediatePropagation();
    this.hideAlerts();
    let point = {};
    point.x = e.clientX;
    point.y = e.clientY;
    var matrix = document.querySelector('g.page-margin').getScreenCTM().inverse();
    let r = {};
    r.x = matrix.a * point.x + matrix.c * point.y + matrix.e;
    r.y = matrix.b * point.x + matrix.d * point.y + matrix.f;
    console.log('Click on ' + e.srcElement.id + ', x/y: ' + r.x + '/' + r.y);

    this.allowCursorActivity = false;
    // console.info('click: ', e);
    let itemId = String(e.currentTarget.id);
    if (itemId === 'undefined') return;
    // take chord rather than note xml:id, when ALT is pressed
    let chordId = utils.insideParent(itemId);
    if (e.altKey && chordId) itemId = chordId;
    // select tuplet when clicking on tupletNum
    if (e.currentTarget.getAttribute('class') === 'tupletNum') itemId = utils.insideParent(itemId, 'tuplet');

    if ((platform.startsWith('mac') && e.metaKey) || e.ctrlKey) {
      this.selectedElements.push(itemId);
      console.info(
        'handleClickOnNotation() added: ' +
          this.selectedElements[this.selectedElements.length - 1] +
          ', size now: ' +
          this.selectedElements.length
      );
    } else {
      // set cursor position in buffer
      utils.setCursorToId(cm, itemId);
      this.selectedElements = [];
      this.selectedElements.push(itemId);
      console.info(
        'handleClickOnNotation() newly created: ' +
          this.selectedElements[this.selectedElements.length - 1] +
          ', size now: ' +
          this.selectedElements.length
      );
    }
    this.updateHighlight(cm);
    if (document.getElementById('showMidiPlaybackControlBar').checked) {
      console.log('v.handleClickOnNotation(): HANDLE CLICK MIDI TIMEOUT');
      startMidiTimeout();
    }
    this.setFocusToVerovioPane();
    // set lastNoteId to @startid or @staff of control element
    let startid = utils.getAttributeById(cm, itemId, 'startid');
    if (startid && startid.startsWith('#')) startid = startid.split('#')[1];

    // if (!startid) { // work around for tstamp/staff
    // TODO: find note corresponding to @staff/@tstamp
    // startid = utils.getAttributeById(txtEdr.getBuffer(), itemId, attribute = 'tstamp');
    // console.info('staff: ', startid);
    // }
    if (startid) this.lastNoteId = startid;
    else this.lastNoteId = itemId;
    this.allowCursorActivity = true;
  } // handleClickOnNotation()

  // when cursor pos in editor changed, update notation location / highlight
  cursorActivity(cm, forceFlip = false) {
    if (this.allowCursorActivity) {
      let id = utils.getElementIdAtCursor(cm);
      // console.log('cursorActivity forceFlip: ' + forceFlip + ' to: ' + id);
      this.selectedElements = [];
      if (id) {
        this.selectedElements.push(id);
        let fl = document.getElementById('flip-checkbox');
        if (
          !document.querySelector('g#' + utils.escapeXmlId(id)) && // when not on current page
          ((fl && fl.checked) || forceFlip)
        ) {
          this.updatePage(cm, '', id, false);
        } else {
          // on current page
          this.scrollSvg(cm);
          this.updateHighlight(cm);
        }
      }
    }
  } // cursorActivity()

  // Scroll notation SVG into view, both vertically and horizontally
  scrollSvg(cmOrId) {
    let vp = document.getElementById('verovio-panel');
    let id = typeof cmOrId === 'string' ? cmOrId : utils.getElementIdAtCursor(cmOrId);
    if (!id) return;
    let el = document.querySelector('g#' + utils.escapeXmlId(id));
    if (el) {
      let changed = false;
      let scrollLeft, scrollTop;
      let vpRect = vp.getBoundingClientRect();
      let elRect = el.getBBox();
      var mx = el.getScreenCTM();
      // adjust scrolling only when element (close to or completely) outside
      const closeToPerc = 0.1;
      let sx = mx.a * (elRect.x + elRect.width / 2) + mx.c * (elRect.y + elRect.height / 2) + mx.e;
      // kind-of page-wise flipping for x
      if (sx < vpRect.x + vpRect.width * closeToPerc) {
        scrollLeft = vp.scrollLeft - (vpRect.x + vpRect.width * (1 - closeToPerc) - sx);
        changed = true;
      } else if (sx > vpRect.x + vpRect.width * (1 - closeToPerc)) {
        scrollLeft = vp.scrollLeft - (vpRect.x + vpRect.width * closeToPerc - sx);
        changed = true;
      }

      // y flipping
      let sy = mx.b * (elRect.x + elRect.width / 2) + mx.d * (elRect.y + elRect.height / 2) + mx.f;
      if (sy < vpRect.y + vpRect.height * closeToPerc || sy > vpRect.y + vpRect.height * (1 - closeToPerc)) {
        scrollTop = vp.scrollTop - (vpRect.y + vpRect.height / 2 - sy);
        changed = true;
      }

      if (changed) {
        vp.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'smooth' });
      }
    }
  } // scrollSvg()

  // when editor emits changes, update notation rendering
  notationUpdated(cm, forceUpdate = false) {
    // console.log('NotationUpdated forceUpdate:' + forceUpdate);
    this.xmlDocOutdated = true;
    this.toolkitDataOutdated = true;
    if (!isSafari) this.checkSchema(cm.getValue());
    let ch = document.getElementById('live-update-checkbox');
    if ((this.allowCursorActivity && ch && ch.checked) || forceUpdate) {
      this.updateData(cm, false, false);
    }
  } // notationUpdated()

  // highlight currently selected elements, if cm left out, all are cleared
  updateHighlight(cm) {
    // clear existing highlighted classes
    let highlighted = document.querySelectorAll('.highlighted');
    // console.info('updateHlt: highlighted: ', highlighted);
    highlighted.forEach((e) => e.classList.remove('highlighted'));
    let ids = [];
    if (this.selectedElements.length > 0) this.selectedElements.forEach((item) => ids.push(item));
    else if (cm) ids.push(utils.getElementIdAtCursor(cm));
    // console.info('updateHlt ids: ', ids);
    for (let id of ids) {
      if (id) {
        let el = document.querySelectorAll('#' + utils.escapeXmlId(id)); // was: 'g#'+id
        // console.info('updateHlt el: ', el);
        if (el) {
          el.forEach((e) => {
            e.classList.add('highlighted');
            if (e.nodeName === 'rect' && e.closest('#source-image-svg')) highlightZone(e);
            e.querySelectorAll('g').forEach((g) => g.classList.add('highlighted'));
          });
        }
      }
    }
  } // updateHighlight()

  setNotationColors(matchTheme = false, alwaysBW = false) {
    // work-around that booleans retrieved from storage are strings
    if (typeof matchTheme === 'string') matchTheme = matchTheme === 'true';
    if (typeof alwaysBW === 'string') alwaysBW = alwaysBW === 'true';
    let rt = document.querySelector(':root');
    if (alwaysBW) {
      rt.style.setProperty('--notationBackgroundColor', 'var(--defaultNotationBackgroundColor)');
      rt.style.setProperty('--notationColor', 'var(--defaultNotationColor)');
      rt.style.setProperty('--highlightColor', 'var(--defaultHighlightColor)');
      return;
    }
    if (matchTheme) {
      let cm = window.getComputedStyle(document.querySelector('.CodeMirror'));
      rt.style.setProperty('--notationBackgroundColor', cm.backgroundColor);
      rt.style.setProperty('--notationColor', cm.color);
      let cmAtt = document.querySelector('.cm-attribute');
      if (cmAtt) rt.style.setProperty('--highlightColor', window.getComputedStyle(cmAtt).color);
    } else {
      rt.style.setProperty('--notationBackgroundColor', 'var(--defaultBackgroundColor)');
      rt.style.setProperty('--notationColor', 'var(--defaultTextColor)');
      rt.style.setProperty('--highlightColor', 'var(--defaultHighlightColor)');
    }
  } // setNotationColors()

  // sets the color scheme of the active theme
  setMenuColors() {
    let rt = document.querySelector(':root');
    let cm = window.getComputedStyle(document.querySelector('.CodeMirror'));
    rt.style.setProperty('--backgroundColor', cm.backgroundColor);
    // rt.style.setProperty('color', cm.color);
    rt.style.setProperty('--textColor', cm.color);
    let cmAtt = document.querySelector('.cm-attribute');
    if (cmAtt) rt.style.setProperty('--highlightColor', window.getComputedStyle(cmAtt).color);
    let j = 0;
    cm.backgroundColor
      .slice(4, -1)
      .split(',')
      .forEach((i) => (j += parseInt(i)));
    j /= 3;
    // console.log('setMenuColors lightness: ' + j + ', ' + ((j < 128) ? 'dark' : 'bright') + '.');
    let els = document.querySelectorAll('.CodeMirror-scrollbar-filler');
    let owl = document.getElementById('mei-friend-logo');
    let owlSrc = owl.getAttribute('src');
    owlSrc = owlSrc.substring(0, owlSrc.lastIndexOf('/') + 1);
    if (env === environments.staging) owlSrc += 'staging-';
    if (j < 128) {
      // dark
      // wake up owl
      owlSrc += 'menu-logo' + (isSafari ? '.png' : '.svg');
      els.forEach((el) => el.style.setProperty('filter', 'invert(.8)'));
      rt.style.setProperty('--settingsLinkBackgroundColor', utils.brighter(cm.backgroundColor, 21));
      rt.style.setProperty('--settingsLinkHoverColor', utils.brighter(cm.backgroundColor, 36));
      rt.style.setProperty('--settingsBackgroundColor', utils.brighter(cm.backgroundColor, 36));
      rt.style.setProperty('--settingsBackgroundAlternativeColor', utils.brighter(cm.backgroundColor, 24));
      rt.style.setProperty('--controlMenuBackgroundColor', utils.brighter(cm.backgroundColor, 8));
      rt.style.setProperty('--navbarBackgroundColor', utils.brighter(cm.backgroundColor, 50));
      rt.style.setProperty('--dropdownHeadingColor', utils.brighter(cm.backgroundColor, 70));
      rt.style.setProperty('--dropdownBackgroundColor', utils.brighter(cm.backgroundColor, 50));
      rt.style.setProperty('--validationStatusBackgroundColor', utils.brighter(cm.backgroundColor, 50, 0.3));
      rt.style.setProperty('--dropdownBorderColor', utils.brighter(cm.backgroundColor, 100));
      let att = document.querySelector('.cm-attribute');
      if (att) rt.style.setProperty('--keyboardShortCutColor', utils.brighter(window.getComputedStyle(att).color, 40));
      let tag = document.querySelector('.cm-tag');
      if (tag) rt.style.setProperty('--fileStatusColor', utils.brighter(window.getComputedStyle(tag).color, 40));
      let str = document.querySelector('.cm-string');
      if (str) {
        rt.style.setProperty('--fileStatusChangedColor', utils.brighter(window.getComputedStyle(str).color, 40));
        rt.style.setProperty('--fileStatusWarnColor', utils.brighter(window.getComputedStyle(str).color, 10));
      }
      rt.style.setProperty(
        '--annotationPanelBackgroundColor',
        window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelDarkBackgroundColor')
      );
      // utils.brighter(window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelBackgroundColor'), -40));
      rt.style.setProperty(
        '--annotationPanelLinkBackgroundColor',
        utils.brighter(window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelDarkBackgroundColor'), -30)
      );
      rt.style.setProperty(
        '--annotationPanelHoverColor',
        utils.brighter(window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelDarkBackgroundColor'), -60)
      );
      rt.style.setProperty('--annotationPanelTextColor', 'white');
      rt.style.setProperty(
        '--annotationPanelBorderColor',
        utils.brighter(window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelDarkBackgroundColor'), 30)
      );
    } else {
      // bright mode
      // sleepy owl
      owlSrc += 'menu-logo-asleep' + (isSafari ? '.png' : '.svg');
      els.forEach((el) => el.style.removeProperty('filter'));
      rt.style.setProperty('--settingsLinkBackgroundColor', utils.brighter(cm.backgroundColor, -16));
      rt.style.setProperty('--settingsLinkHoverColor', utils.brighter(cm.backgroundColor, -24));
      rt.style.setProperty('--settingsBackgroundColor', utils.brighter(cm.backgroundColor, -36));
      rt.style.setProperty('--settingsBackgroundAlternativeColor', utils.brighter(cm.backgroundColor, -24));
      rt.style.setProperty('--controlMenuBackgroundColor', utils.brighter(cm.backgroundColor, -8));
      rt.style.setProperty('--navbarBackgroundColor', utils.brighter(cm.backgroundColor, -50));
      rt.style.setProperty('--dropdownHeadingColor', utils.brighter(cm.backgroundColor, -70));
      rt.style.setProperty('--dropdownBackgroundColor', utils.brighter(cm.backgroundColor, -50));
      rt.style.setProperty('--validationStatusBackgroundColor', utils.brighter(cm.backgroundColor, -50, 0.3));
      rt.style.setProperty('--dropdownBorderColor', utils.brighter(cm.backgroundColor, -100));
      let att = document.querySelector('.cm-attribute');
      if (att) rt.style.setProperty('--keyboardShortCutColor', utils.brighter(window.getComputedStyle(att).color, -40));
      let tag = document.querySelector('.cm-tag');
      if (tag) rt.style.setProperty('--fileStatusColor', utils.brighter(window.getComputedStyle(tag).color, -40));
      let str = document.querySelector('.cm-string');
      if (str) {
        rt.style.setProperty('--fileStatusChangedColor', utils.brighter(window.getComputedStyle(str).color, -40));
        rt.style.setProperty('--fileStatusWarnColor', utils.brighter(window.getComputedStyle(str).color, -10));
      }
      rt.style.setProperty(
        '--annotationPanelBackgroundColor',
        window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelBackgroundColor')
      );
      rt.style.setProperty(
        '--annotationPanelLinkBackgroundColor',
        window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelLinkBackgroundColor')
      );
      rt.style.setProperty(
        '--annotationPanelHoverColor',
        window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelHoverColor')
      );
      rt.style.setProperty(
        '--annotationPanelTextColor',
        window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelTextColor')
      );
      rt.style.setProperty(
        '--annotationPanelBorderColor',
        utils.brighter(window.getComputedStyle(rt).getPropertyValue('--defaultAnnotationPanelBackgroundColor'), -30)
      );
    }
    owl.setAttribute('src', owlSrc);
  } // setMenuColors()

  // Control zoom of notation display and update Verovio layout
  zoom(delta, storage = null) {
    let zoomCtrl = document.getElementById('verovio-zoom');
    if (zoomCtrl) {
      if (delta <= 30)
        // delta only up to 30% difference
        zoomCtrl.value = parseInt(zoomCtrl.value) + delta;
      // otherwise take it as the scaling value
      else zoomCtrl.value = delta;
      if (storage && storage.supported) storage.scale = zoomCtrl.value;
      this.updateLayout();
    }
  } // zoom()

  // change font size of editor panel (sign is direction
  // or percent when larger than 30)
  changeEditorFontSize(delta) {
    let zf = document.getElementById('zoomFont');
    let value = delta;
    if (delta < 30) value = parseInt(zf.value) + delta;
    value = Math.min(300, Math.max(45, value)); // 45---300, see #zoomFont
    document.getElementById('encoding').style.fontSize = value + '%';
    zf.value = value;
    cm.refresh(); // to align selections with new font size (24 Sept 2022)
  } // changeEditorFontSize()

  // set focus to verovioPane in order to ensure working key bindings
  setFocusToVerovioPane() {
    let el = document.getElementById('verovio-panel');
    el.setAttribute('tabindex', '-1');
    el.focus();
  } // setFocusToVerovioPane()

  showSettingsPanel() {
    let sp = document.getElementById('settingsPanel');
    if (sp.style.display !== 'block') sp.style.display = 'block';
    sp.classList.remove('out');
    sp.classList.add('in');
    document.getElementById('showSettingsButton').style.visibility = 'hidden';
    if (this.settingsReplaceFriendContainer) setOrientation(cm, '', '', this);
  } // showSettingsPanel()

  hideSettingsPanel() {
    let sp = document.getElementById('settingsPanel');
    sp.classList.add('out');
    sp.classList.remove('in');
    document.getElementById('showSettingsButton').style.visibility = 'visible';
    if (this.settingsReplaceFriendContainer) setOrientation(cm, '', '', this);
  } // hideSettingsPanel()

  toggleSettingsPanel(ev = null) {
    if (ev) {
      console.log('stop propagation');
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
    let sp = document.getElementById('settingsPanel');
    if (sp.classList && sp.classList.contains('in')) {
      this.hideSettingsPanel();
    } else {
      this.showSettingsPanel();
    }
  } // toggleSettingsPanel()

  // same as showSettingsPanel, but with Verovio tab activated
  showVerovioTabInSettingsPanel() {
    let containingElement = document.getElementById('settingsPanel');
    const tabId = 'verovioSettings';
    for (let cont of containingElement.getElementsByClassName('tabcontent')) {
      cont.style.display = cont.id === tabId ? 'block' : 'none';
    }
    // remove class "active" from tablinks except for current target
    for (let tab of containingElement.getElementsByClassName('tablink')) {
      tab.id === 'verovioOptionsTab' ? tab.classList.add('active') : tab.classList.remove('active');
    }
    this.showSettingsPanel();
  } // showVerovioTabInSettingsPanel()

  // Switches Viewer to pdfMode
  pageModeOn(pdfMode = true) {
    this.pdfMode = pdfMode;
    this.controlMenuState = getControlMenuState();
    console.log('pageModeOn: state ', this.controlMenuState);

    // modify vrv options
    this.vrvOptions.mmOutput = true;
    document.getElementById('vrv-mmOutput').checked = true;
    this.vrvOptions.adjustPageHeight = false;
    document.getElementById('vrv-adjustPageHeight').checked = false;

    if (this.pdfMode) {
      setCheckbox('controlMenuFlipToPageControls', false);
      setCheckbox('controlMenuUpdateNotation', false);
      setCheckbox('controlMenuFontSelector', true);
      setCheckbox('controlMenuNavigateArrows', false);
      setCheckbox('toggleSpeedMode', false);

      // hide editor and other panels
      this.notationProportion = getNotationProportion();
      setNotationProportion(1);
      this.hideEditorPanel();

      // behavior of settings panel
      this.settingsReplaceFriendContainer = true;
      cmd.hideFacsimilePanel();
      cmd.hideAnnotationPanel();
      this.showVerovioTabInSettingsPanel(); // make vrv settings visible

      showPdfButtons(true);
      this.allowNotationInteraction = false;
      document.getElementById('friendContainer')?.classList.add('pdfMode');
    }
  } // pageModeOn()

  // Switches back from pdfMode
  pageModeOff() {
    setControlMenuState(this.controlMenuState);
    // set vrv options back
    this.vrvOptions.mmOutput = false;
    document.getElementById('vrv-mmOutput').checked = false;
    this.vrvOptions.adjustPageHeight = true;
    document.getElementById('vrv-adjustPageHeight').checked = true;
    // settings behavior to default
    this.settingsReplaceFriendContainer = false;

    if (this.pdfMode) {
      // show editor panel with previous proportion
      setNotationProportion(this.notationProportion);
      this.showEditorPanel();
      // hide panels
      this.hideSettingsPanel();
      showPdfButtons(false);

      document.getElementById('friendContainer')?.classList.remove('pdfMode');
      setOrientation(cm, '', '', v);
      this.allowNotationInteraction = true;
    }
    this.pdfMode = false;
  } // pageModeOff()

  saveAsPdf() {
    this.vrvWorker.postMessage({
      cmd: 'renderPdf',
      msg: v.speedFilter(cm.getValue()),
      title: meiFileName,
      version: version,
      versionDate: versionDate,
      options: this.vrvOptions,
      speedMode: this.speedMode,
      pages: prs.getPages(),
    });
  } // saveAsPdf()

  showEditorPanel() {
    const encPanel = document.getElementById('encoding');
    if (encPanel) encPanel.style.display = 'flex';
    const rzr = document.getElementById('dragMe');
    if (rzr) rzr.style.display = 'flex';
  } // showEditorPanel()

  hideEditorPanel() {
    const encPanel = document.getElementById('encoding');
    if (encPanel) encPanel.style.display = 'none';
    const rzr = document.getElementById('dragMe');
    if (rzr) rzr.style.display = 'none';
  } // hideEditorPanel()

  toggleMidiPlaybackControlBar() {
    const midiPlaybackControlBar = document.getElementById('midiPlaybackControlBar');
    const showMidiPlaybackControlBar = document.getElementById('showMidiPlaybackControlBar');
    const midiSpeedmodeIndicator = document.getElementById('midiSpeedmodeIndicator');
    midiPlaybackControlBar.style.display = showMidiPlaybackControlBar.checked ? 'flex' : 'none';
    midiSpeedmodeIndicator.style.display = this.speedMode ? 'inline' : 'none';
    // console.log('toggle: ', midiPlaybackControlBar);
    setOrientation(cm);
  }

  toggleAnnotationPanel() {
    setOrientation(cm);
    if (this.speedMode && this.breaksSelect.value === 'auto') {
      this.pageBreaks = {};
      this.updateAll(cm);
    } else {
      this.updateLayout();
    }
  }

  // add responsibility statement to resp select dropdown
  setRespSelectOptions() {
    let rs = document.getElementById('respSelect');
    if (rs) {
      while (rs.length > 0) rs.options.remove(0);
      let optEls = this.xmlDoc.querySelectorAll('corpName[*|id],persName[*|id]');
      optEls.forEach((el) => {
        if (el.closest('respStmt')) {
          // only if inside a respStmt
          let id = el.getAttribute('xml:id');
          rs.add(new Option(id, id));
        }
      });
    }
  }

  // navigate forwards/backwards/upwards/downwards in the DOM, as defined
  // by 'dir' an by 'incrementElementName'
  navigate(cm, incElName = 'note', dir = 'forwards') {
    console.info('navigate(): lastNoteId: ', this.lastNoteId);
    this.allowCursorActivity = false;
    let id = this.lastNoteId;
    if (id === '') {
      // empty note id
      id = this.setCursorToPageBeginning(cm); // re-defines lastNotId
      if (!id) return;
    }
    let element;
    id = utils.escapeXmlId(id);
    if (id) element = document.querySelector('g#' + id);
    if (!element) {
      // element off-screen
      this.setCursorToPageBeginning(cm); // re-defines lastNotId
      id = utils.escapeXmlId(this.lastNoteId);
      element = document.querySelector('g#' + id);
    }
    if (!element) return;
    console.info('Navigate ' + dir + ' ' + incElName + '-wise for: ', element);
    let x = dutils.getX(element);
    let y = dutils.getY(element);
    let measure = element.closest('.measure');
    // in case no measure element is found
    if (!measure) {
      let firstNote = document.querySelector('.measure').querySelector('.note');
      if (firstNote) id = firstNote.getAttribute('id');
    } else {
      // find elements starting from current note id, element- or measure-wise
      if (incElName === 'note' || incElName === 'measure') {
        id = dutils.getIdOfNextSvgElement(element, dir, undefined, incElName);
        if (!id) {
          // when no id on screen, turn page
          let what = 'first'; // first/last note within measure
          if (dir === 'backwards' && incElName !== 'measure') what = 'last';
          let lyNo = 1;
          let layer = element.closest('.layer');
          if (layer) lyNo = layer.getAttribute('data-n');
          let staff = element.closest('.staff');
          let stNo = staff.getAttribute('data-n');
          this.navigateBeyondPage(cm, dir, what, stNo, lyNo, y);
          return;
        }
      }

      // up/down in layers
      if (incElName === 'layer') {
        // console.info('navigate(u/d): x/y: ' + x + '/' + y + ', el: ', element);
        let els = Array.from(measure.querySelectorAll(dutils.navElsSelector));
        els.sort(function (a, b) {
          if (Math.abs(dutils.getX(a) - x) > Math.abs(dutils.getX(b) - x)) return 1;
          if (Math.abs(dutils.getX(a) - x) < Math.abs(dutils.getX(b) - x)) return -1;
          if (dutils.getY(a) < dutils.getY(b)) return dir === 'upwards' ? 1 : -1;
          if (dutils.getY(a) > dutils.getY(b)) return dir === 'upwards' ? -1 : 1;
          return 0;
        });
        // console.info('els: ', els);
        let found = false;
        let yy = 0;
        for (let e of els) {
          // go thru all elements to find closest in x/y space
          if (found) {
            yy = dutils.getY(e);
            if (dir === 'upwards' && yy >= y) continue;
            if (dir === 'downwards' && yy <= y) continue;
            id = e.getAttribute('id');
            break;
          }
          if (e.getAttribute('id') === element.getAttribute('id')) found = true;
        }
      } // up/down in layers

      console.info('navigate() found this ID: ' + id);
    }
    // update cursor position in MEI file (buffer)
    utils.setCursorToId(cm, id);
    // this.allowCursorActivityToTextposition(txtEdr); TODO
    if (id) {
      this.selectedElements = [];
      this.selectedElements.push(id);
      this.lastNoteId = id;
      if (document.getElementById('showMidiPlaybackControlBar').checked) {
        startMidiTimeout();
      }
    }
    this.allowCursorActivity = true;
    this.scrollSvg(cm);
    this.updateHighlight(cm);
  } // navigate()

  // turn page for navigation and return svg directly
  navigateBeyondPage(cm, dir = 'forwards', what = 'first', stNo = 1, lyNo = 1, y = 0) {
    if (!this.changeCurrentPage(dir)) return; // turn page
    let message = {
      breaks: this.vrvOptions.breaks,
      cmd: 'navigatePage',
      pageNo: this.currentPage,
      dir: dir,
      what: what,
      stNo: stNo,
      lyNo: lyNo,
      y: y,
    };
    if (this.speedMode) {
      message.mei = this.speedFilter(cm.getValue());
      message.speedMode = this.speedMode;
    }
    this.busy();
    this.vrvWorker.postMessage(message);
  }

  getTimeForElement(id, triggerMidiSeekTo = false) {
    let that = this;
    let promise = new Promise(
      function (resolve) {
        let message = {
          cmd: 'getTimeForElement',
          msg: id,
          triggerMidiSeekTo: triggerMidiSeekTo,
        };
        that.vrvWorker.addEventListener('message', function handle(ev) {
          if ((ev.data.cmd = message.cmd)) {
            ev.target.removeEventListener('message', handle);
            resolve(ev.data.cmd);
          }
        });
        that.vrvWorker.postMessage(message);
      }.bind(that)
    );
    promise.then(function (time) {
      return time;
    });
  }

  findFirstNoteInSelection() {
    let firstNote;
    for (const elId of v.selectedElements) {
      let el = document.getElementById(elId);
      if (el) {
        if (el.classList.contains('note')) {
          firstNote = el;
          break;
        } else {
          const childNotes = el.getElementsByClassName('note');
          if (childNotes.length) {
            firstNote = childNotes[0];
            break;
          }
        }
      } else {
        console.warn("Couldn't find selected element on page: ", elId, v.selectedElements);
      }
    }
    return firstNote;
  }

  findClosestNoteInChord(id, y) {
    if (id) {
      // if id within chord, find y-closest note to previous
      let ch = document.querySelector('g#' + utils.escapeXmlId(id)).closest('.chord');
      if (ch) {
        // console.info('back/forwards within a chord (y: ' + y + '), ', ch);
        let diff = Number.MAX_VALUE;
        ch.querySelectorAll('.note').forEach((item) => {
          let newDiff = Math.abs(dutils.getY(item) - y);
          // console.info('note: diff: ' + newDiff, item);
          if (newDiff <= diff) {
            diff = newDiff;
            id = item.getAttribute('id');
          }
        });
      }
    }
  }

  busy(active = true, speedWorker = false) {
    let direction = speedWorker ? 'anticlockwise' : 'clockwise';
    if (active) this.verovioIcon.classList.add(direction);
    else this.verovioIcon.classList.remove(direction);
  }

  breaksValue() {
    let breaksSelectVal = this.breaksSelect.value;
    switch (breaksSelectVal) {
      case 'auto':
        return {
          ...this.pageBreaks,
        };
      case 'line':
        return ['sb', 'pb'];
      case 'encoded':
        return ['pb'];
      default:
        return '';
    }
  }

  // toggle disabled at one specific checkbox
  disableElementThroughCheckbox(checkbox, affectedElement) {
    let cont = document.getElementById(checkbox).checked;
    let el = document.getElementById(affectedElement);
    el.disabled = cont;
    if (cont) el.parentNode.classList.add('disabled');
    else el.parentNode.classList.remove('disabled');
  }

  // show alert to user in #alertOverlay
  // type: ['error'] 'warning' 'info' 'success'
  // disappearAfter: in milliseconds, when negative, no time out
  showAlert(message, type = 'error', disappearAfter = 30000) {
    if (this.alertCloser) clearTimeout(this.alertCloser);
    let alertOverlay = document.getElementById('alertOverlay');
    let alertIcon = document.getElementById('alertIcon');
    let alertMessage = document.getElementById('alertMessage');
    alertIcon.innerHTML = xCircleFill; // error as default icon
    alertOverlay.classList.remove('warning');
    alertOverlay.classList.remove('info');
    alertOverlay.classList.remove('success');
    switch (type) {
      case 'warning':
        alertOverlay.classList.add('warning');
        alertIcon.innerHTML = alert;
        break;
      case 'info':
        alertOverlay.classList.add('info');
        alertIcon.innerHTML = info;
        break;
      case 'success':
        alertOverlay.classList.add('success');
        alertIcon.innerHTML = success;
        break;
    }
    alertMessage.innerHTML = message;
    alertOverlay.style.display = 'flex';
    this.setFocusToVerovioPane();
    if (disappearAfter > 0) {
      this.alertCloser = setTimeout(() => (alertOverlay.style.display = 'none'), disappearAfter);
    }
  }

  // Update alert message of #alertOverlay
  updateAlert(newMsg) {
    let alertOverlay = document.getElementById('alertOverlay');
    alertOverlay.querySelector('span').innerHTML += '<br />' + newMsg;
  }

  // Hide all alert windows, such as alert overlay
  hideAlerts() {
    let btns = document.getElementsByClassName('alertCloseButton');
    for (let b of btns) {
      if (this.alertCloser) clearTimeout(this.alertCloser);
      b.parentElement.style.display = 'none';
    }
  }

  // Method to check from MEI whether the XML schema filename has changed
  async checkSchema(mei) {
    // console.log('Validation: checking for schema...')
    let vr = document.getElementById('validation-report');
    if (vr) vr.style.visibility = 'hidden';
    const hasSchema = /<\?xml-model.*schematypens=\"http?:\/\/relaxng\.org\/ns\/structure\/1\.0\"/;
    const hasSchemaMatch = hasSchema.exec(mei);
    const meiVersion = /<mei.*meiversion="([^"]*).*/;
    const meiVersionMatch = meiVersion.exec(mei);
    if (!hasSchemaMatch) {
      if (meiVersionMatch && meiVersionMatch[1]) {
        let sch = commonSchemas['All'][meiVersionMatch[1]];
        if (sch) {
          if (sch !== this.currentSchema) {
            this.currentSchema = sch;
            console.log('Validation: ...new schema from @meiversion ' + this.currentSchema);
            await this.replaceSchema(this.currentSchema);
            return;
          } else {
            // console.log('Validation: same schema.');
            return;
          }
        }
      }
      console.log('Validation: No schema information found in MEI.');
      this.currentSchema = '';
      this.throwSchemaError({
        schemaFile: 'No schema information found in MEI.',
      });
      return;
    }
    const schema = /<\?xml-model.*href="([^"]*).*/;
    const schemaMatch = schema.exec(mei);
    if (schemaMatch && schemaMatch[1] !== this.currentSchema) {
      this.currentSchema = schemaMatch[1];
      console.log('Validation: ...new schema ' + this.currentSchema);
      await this.replaceSchema(this.currentSchema);
    }
    //else {
    // console.log('Validation: same schema.');
    //}
  }

  // Loads and replaces XML schema; throws errors if not found/CORS error,
  // update validation-status icon
  async replaceSchema(schemaFile) {
    if (!this.validatorInitialized) return;
    let vs = document.getElementById('validation-status');
    vs.innerHTML = download;
    let msg = 'Loading schema ' + schemaFile;
    vs.setAttribute('title', msg);
    this.changeStatus(vs, 'wait', ['error', 'ok', 'manual']);
    this.updateSchemaStatusDisplay('wait', schemaFile, msg);

    console.log('Validation: Replace schema: ' + schemaFile);
    let data; // content of schema file
    try {
      const response = await fetch(schemaFile);
      if (!response.ok) {
        // schema not found
        this.throwSchemaError({
          response: response,
          schemaFile: schemaFile,
        });
        return;
      }
      data = await response.text();
      const res = await validator.setRelaxNGSchema(data);
    } catch (err) {
      this.throwSchemaError({
        err: 'Schema error at replacing schema: ' + err,
        schemaFile: schemaFile,
      });
      return;
    }
    msg = 'Schema loaded ' + schemaFile;
    vs.setAttribute('title', msg);
    vs.innerHTML = unverified;
    this.validatorWithSchema = true;
    const autoValidate = document.getElementById('autoValidate');
    if (autoValidate && autoValidate.checked) validate(cm.getValue(), this.updateLinting, true);
    else this.setValidationStatusToManual();
    console.log('New schema loaded to validator', schemaFile);
    rngLoader.setRelaxNGSchema(data);
    cm.options.hintOptions.schemaInfo = rngLoader.tags;
    console.log('New schema loaded for auto completion', schemaFile);
    this.updateSchemaStatusDisplay('ok', schemaFile, msg);
  }

  // Throw an schema error and update validation-status icon
  throwSchemaError(msgObj) {
    this.validatorWithSchema = false;
    if (this.updateLinting && typeof this.updateLinting === 'function') this.updateLinting(cm, []); // clear errors in CodeMirror
    // Remove schema from validator and hinting / code completion
    rngLoader.clearRelaxNGSchema();
    console.log('Schema removed from validator', this.currentSchema);
    cm.options.hintOptions = {};
    console.log('Schema removed from auto completion', this.currentSchema);
    // construct error message
    let msg = '';
    if (msgObj.hasOwnProperty('response'))
      msg = 'Schema not found (' + msgObj.response.status + ' ' + msgObj.response.statusText + '): ';
    if (msgObj.hasOwnProperty('err')) msg = msgObj.err + ' ';
    if (msgObj.hasOwnProperty('schemaFile')) msg += msgObj.schemaFile;
    // set icon to unverified and error color
    let vs = document.getElementById('validation-status');
    vs.innerHTML = unverified;
    vs.setAttribute('title', msg);
    console.warn(msg);
    this.changeStatus(vs, 'error', ['wait', 'ok', 'manual']);
    this.updateSchemaStatusDisplay('error', '', msg);
    return;
  }

  // helper function that adds addedClass (string)
  // after removing removedClasses (array of strings)
  // from el (DOM element)
  changeStatus(el, addedClass = '', removedClasses = []) {
    removedClasses.forEach((c) => el.classList.remove(c));
    el.classList.add(addedClass);
  }

  updateSchemaStatusDisplay(status = 'ok', schemaName, msg = '') {
    let el = document.getElementById('schemaStatus');
    if (el) {
      el.title = msg;
      switch (status) {
        case 'ok':
          this.changeStatus(el, 'ok', ['error', 'manual', 'wait']);
          // pretty-printing for known schemas from music-encoding.org
          if (schemaName.includes('music-encoding.org')) {
            let pathElements = schemaName.split('/');
            let type = pathElements.pop();
            if (type.toLowerCase().includes('anystart')) type = 'any';
            let noChars = 3;
            if (type.toLowerCase().includes('neumes') || type.toLowerCase().includes('mensural')) noChars = 4;
            let schemaVersion = pathElements.pop();
            el.innerHTML = type.split('mei-').pop().slice(0, noChars).toUpperCase() + ' ' + schemaVersion;
          } else {
            el.innerHTML = schemaName.split('/').pop().split('.').at(0);
          }
          break;
        case 'wait': // downloading schema
          this.changeStatus(el, 'wait', ['ok', 'manual', 'error']);
          el.innerHTML = '&nbsp;&#11015;&nbsp;'; // #8681 #8615
          break;
        case 'error': // no schema in MEI or @meiversion
          this.changeStatus(el, 'error', ['ok', 'manual', 'wait']);
          el.innerHTML = '&nbsp;?&nbsp;';
          break;
      }
    }
  }

  // Switch validation-status icon to manual mode and add click event handlers
  setValidationStatusToManual() {
    let vs = document.getElementById('validation-status');
    vs.innerHTML = unverified;
    vs.style.cursor = 'pointer';
    vs.setAttribute('title', 'Not validated. Press here to validate.');
    vs.removeEventListener('click', this.manualValidate);
    vs.removeEventListener('click', this.toggleValidationReportVisibility);
    vs.addEventListener('click', this.manualValidate);
    this.changeStatus(vs, 'manual', ['wait', 'ok', 'error']);
    let reportDiv = document.getElementById('validation-report');
    if (reportDiv) reportDiv.style.visibility = 'hidden';
    if (this.updateLinting && typeof this.updateLinting === 'function') this.updateLinting(cm, []); // clear errors in CodeMirror
  }

  // Callback for manual validation
  manualValidate() {
    validate(cm.getValue(), undefined, {
      forceValidate: true,
    });
  }

  // Highlight validation results in CodeMirror editor linting system
  highlightValidation(mei, messages) {
    let lines;
    let found = [];
    let i = 0;

    try {
      lines = mei.split('\n');
    } catch (err) {
      console.log('Could not split MEI json:', err);
      return;
    }

    // sort messages by line number
    messages.sort((a, b) => {
      if (a.line < b.line) return -1;
      if (a.line > b.line) return 1;
      return 0;
    });

    // parse error messages into an array for CodeMirror
    while (i < messages.length) {
      let line = Math.max(messages[i].line - 1, 0);
      found.push({
        from: new CodeMirror.Pos(line, 0),
        to: new CodeMirror.Pos(line, lines[line].length),
        severity: 'error',
        message: messages[i].message,
      });
      i += 1;
    }
    this.updateLinting(cm, found);

    // update overall status of validation
    let vs = document.getElementById('validation-status');
    vs.querySelector('svg').classList.remove('clockwise');
    let reportDiv = document.getElementById('validation-report');
    if (reportDiv) reportDiv.innerHTML = '';

    let msg = '';
    if (found.length === 0 && this.validatorWithSchema) {
      this.changeStatus(vs, 'ok', ['error', 'wait', 'manual']);
      vs.innerHTML = verified;
      msg = 'Everything ok, no errors.';
    } else {
      this.changeStatus(vs, 'error', ['wait', 'ok', 'manual']);
      vs.innerHTML = alert;
      vs.innerHTML += '<span>' + Object.keys(messages).length + '</span>';
      msg = 'Validation failed. ' + Object.keys(messages).length + ' validation messages:';
      messages.forEach((m) => (msg += '\nLine ' + m.line + ': ' + m.message));

      // detailed validation report
      if (!reportDiv) {
        reportDiv = document.createElement('div');
        reportDiv.id = 'validation-report';
        reportDiv.classList.add('validation-report');
        let CM = document.querySelector('.CodeMirror');
        CM.parentElement.insertBefore(reportDiv, CM);
      } else {
        reportDiv.style.visibility = 'visible';
      }
      let closeButton = document.createElement('span');
      closeButton.classList.add('rightButton');
      closeButton.innerHTML = '&times';
      closeButton.addEventListener('click', (ev) => (reportDiv.style.visibility = 'hidden'));
      reportDiv.appendChild(closeButton);
      let p = document.createElement('div');
      p.classList.add('validation-title');
      p.innerHTML = 'Validation failed. ' + Object.keys(messages).length + ' validation messages:';
      reportDiv.appendChild(p);
      messages.forEach((m, i) => {
        let p = document.createElement('div');
        p.classList.add('validation-item');
        p.id = 'error' + i;
        p.innerHTML = 'Line ' + m.line + ': ' + m.message;
        p.addEventListener('click', (ev) => {
          cm.scrollIntoView({
            from: {
              line: Math.max(0, m.line - 5),
              ch: 0,
            },
            to: {
              line: Math.min(cm.lineCount() - 1, m.line + 5),
              ch: 0,
            },
          });
        });
        reportDiv.appendChild(p);
      });
    }
    vs.setAttribute(
      'title',
      'Validated against ' + this.currentSchema + ': ' + Object.keys(messages).length + ' validation messages.'
    );
    if (reportDiv) {
      vs.removeEventListener('click', this.manualValidate);
      vs.removeEventListener('click', this.toggleValidationReportVisibility);
      vs.addEventListener('click', this.toggleValidationReportVisibility);
    }
  }

  // Show/hide #validation-report panel, or force visibility (by string)
  toggleValidationReportVisibility(forceVisibility = '') {
    let reportDiv = document.getElementById('validation-report');
    if (reportDiv) {
      if (typeof forceVisibility === 'string') {
        reportDiv.style.visibility = forceVisibility;
      } else {
        if (reportDiv.style.visibility === '' || reportDiv.style.visibility === 'visible')
          reportDiv.style.visibility = 'hidden';
        else reportDiv.style.visibility = 'visible';
      }
    }
  }
}
