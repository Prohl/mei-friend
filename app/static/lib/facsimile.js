// Facsimile support: 
// Handles display of sources score images as referenced through zone and surface elements.

var facs = {}; // facsimile structure in MEI file
var sourceImages = {}; // object of source images
const rectangleLineWidth = 6; // width of bounding box rectangles in px
const rectangleColor = 'darkred';
var listenerHandles = {};
var resize = ''; // west, east, north, south, northwest, southeast etc
var ulx, uly;

import {
    rmHash,
    setCursorToId
} from './utils.js';
import {
    svgNameSpace,
    xmlToString
} from './dom-utils.js'
import {
    transformCTM,
    updateRect
} from './drag-selector.js';
import {
    cm,
    fileLocationType,
    github,
    meiFileLocation,
    v
} from './main.js';
import {
    addZone,
    replaceInEditor
} from './editor.js';


let warningSvgText = document.createElementNS(svgNameSpace, 'text');
warningSvgText.setAttribute('font-size', '24px');
warningSvgText.setAttribute('font-weight', 'bold');
warningSvgText.setAttribute('fill', 'var(--textColor)');
warningSvgText.setAttribute('x', 30);
warningSvgText.setAttribute('y', 30);
warningSvgText.textContent = 'No facsimile content available.';

// clear main variables
export function clearFacsimile() {
    facs = {};
    sourceImages = {};
}

// loads facsimile content of xmlDoc into an object
export function loadFacsimile(xmlDoc) {
    clearFacsimile();
    let facsimile = xmlDoc.querySelector('facsimile');
    if (facsimile) {
        let zones = facsimile.querySelectorAll('zone');
        zones.forEach(z => {
            let id, ulx, uly, lrx, lry;
            if (z.hasAttribute('xml:id')) id = z.getAttribute('xml:id');
            if (z.hasAttribute('ulx')) ulx = z.getAttribute('ulx');
            if (z.hasAttribute('uly')) uly = z.getAttribute('uly');
            if (z.hasAttribute('lrx')) lrx = z.getAttribute('lrx');
            if (z.hasAttribute('lry')) lry = z.getAttribute('lry');
            let graphic = z.parentElement.querySelector('graphic');
            if (graphic) {
                let target, width, height;
                if (graphic.hasAttribute('target')) target = graphic.getAttribute('target');
                if (graphic.hasAttribute('width')) width = graphic.getAttribute('width');
                if (graphic.hasAttribute('height')) height = graphic.getAttribute('height');
                if (id) {
                    facs[id] = {};
                    if (target) facs[id]['target'] = target;
                    if (width) facs[id]['width'] = width;
                    if (height) facs[id]['height'] = height;
                    if (ulx) facs[id]['ulx'] = ulx;
                    if (uly) facs[id]['uly'] = uly;
                    if (lrx) facs[id]['lrx'] = lrx;
                    if (lry) facs[id]['lry'] = lry;
                    let measure = xmlDoc.querySelector('[facs="#' + id + '"]');
                    if (measure) {
                        if (measure.hasAttribute('xml:id')) facs[id]['measureId'] = measure.getAttribute('xml:id');
                        if (measure.hasAttribute('n')) facs[id]['measureN'] = measure.getAttribute('n');
                    }
                }
            }
        });
    }
    return facs;
}


// Draw the source image with bounding boxes for each zone
export async function drawFacsimile() {
    busy();
    let fullPage = document.getElementById('showFacsimileFullPage').checked;
    ulx = Number.MAX_VALUE; // boundary values for image envelope
    uly = Number.MAX_VALUE;
    let lrx = 0;
    let lry = 0;
    let zoneId;
    let svgFacs = document.querySelectorAll('[data-facs]'); // list displayed zones
    if (svgFacs && fullPage) {
        let firstZone = svgFacs.item(0);
        if (firstZone && firstZone.hasAttribute('data-facs'))
            zoneId = rmHash(firstZone.getAttribute('data-facs'));
    } else {
        svgFacs.forEach((f) => { // go through displayed zones and find envelope
            if (f.hasAttribute('data-facs'))
                zoneId = rmHash(f.getAttribute('data-facs'));
            if (facs[zoneId]) {
                if (parseFloat(facs[zoneId].ulx) < ulx) ulx = parseFloat(facs[zoneId].ulx) - rectangleLineWidth / 2;
                if (parseFloat(facs[zoneId].uly) < uly) uly = parseFloat(facs[zoneId].uly) - rectangleLineWidth / 2;
                if (parseFloat(facs[zoneId].lrx) > lrx) lrx = parseFloat(facs[zoneId].lrx) + rectangleLineWidth / 2;
                if (parseFloat(facs[zoneId].lry) > lry) lry = parseFloat(facs[zoneId].lry) + rectangleLineWidth / 2;
            }
        });
    }
    let svgContainer = document.getElementById('source-image-container');
    let svg = document.getElementById('source-image-svg');
    if (!svg) return;
    if (facs[zoneId]) {
        svg.innerHTML = '';
        // find the correct path of the image file
        let img;
        let imgName = facs[zoneId].target;
        if (!imgName.startsWith('http')) { // relative file paths in surface@target
            if (fileLocationType === 'github') {
                let url = new URL('https://raw.githubusercontent.com/' + github.githubRepo + '/' +
                    github.branch + '/' + facs[zoneId].target);
                url.searchParams.append('token', github.githubToken);
                imgName = url.href;
                img = await loadImage(imgName);
                if (!img) { // try to find images in the 'img' folder on github repo
                    url = new URL('https://raw.githubusercontent.com/' + github.githubRepo + '/' +
                        github.branch + '/img/' + facs[zoneId].target);
                    url.searchParams.append('token', github.githubToken);
                    imgName = url.href;
                } else {
                    sourceImages[imgName] = img;
                }
            } else if (fileLocationType === 'url') {
                let url = new URL(meiFileLocation);
                imgName = url.origin + url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1) + imgName;
            } else {
                imgName = `${root}local/` + facs[zoneId].target;
                imgName = imgName.replace('.tif', '.jpg'); // hack for some DIME files...
            }
        } else if (imgName.startsWith('https://raw.githubusercontent.com/') && github.githubToken) { // absolute file paths
            let url = new URL('https://raw.githubusercontent.com/' + github.githubRepo + '/' +
                github.branch + github.filepath);
            url.searchParams.append('token', github.githubToken);
            imgName = url.href;
        }

        // load image asynchronously
        if (!sourceImages.hasOwnProperty(imgName)) {
            console.log('Loading image from ' + imgName);
            img = await loadImage(imgName);
            sourceImages[imgName] = img;
        } else {
            img = sourceImages[imgName]
        }
        svg.appendChild(img);

        if (fullPage) {
            let bb = img.getBBox();
            ulx = 0;
            uly = 0;
            lrx = bb.width;
            lry = bb.height;
        }
        let width = lrx - ulx;
        let height = lry - uly;
        // svgContainer.setAttribute("transform", "translate(" + (ulx / 2) + " " + (uly / 2 ) + ") scale(" + zoomFactor + ")");
        let zoomFactor = document.getElementById('facsimileZoomInput').value / 100;
        svgContainer.setAttribute("transform-origin", "left top");
        svgContainer.setAttribute("transform", "scale(" + zoomFactor + ")");
        svgContainer.setAttribute('width', width);
        svgContainer.setAttribute('height', height);
        // svgContainer.appendChild(document.createAttributeNS(svgNameSpace, 'circle'))
        svg.setAttribute('viewBox', ulx + ' ' + uly + ' ' + width + ' ' + height);

        if (false) { // show page name on svg
            let lbl = document.getElementById('source-image-svg-label');
            if (!lbl) {
                lbl = document.createElementNS(svgNameSpace, 'text');
                lbl.setAttribute('id', 'source-image-svg-label')
            }
            lbl.textContent = imgName.split('\\').pop().split('/').pop();
            lbl.setAttribute('font-size', '28px');
            lbl.setAttribute('font-weight', 'bold');
            lbl.setAttribute('x', ulx + 7);
            lbl.setAttribute('y', uly + 29);
            svg.appendChild(lbl);
        }

        // go through displayed zones and draw bounding boxes with number-like label
        if (fullPage) {
            for (let z in facs) {
                if (facs[z]['target'] === facs[zoneId]['target'])
                    drawBoundingBox(z, facs[z]['measureId'], facs[z]['measureN']);
            }
        } else {
            svgFacs.forEach(m => {
                if (m.hasAttribute('data-facs')) zoneId = rmHash(m.getAttribute('data-facs'));
                drawBoundingBox(zoneId, facs[zoneId]['measureId'], facs[zoneId]['measureN'])
            });
        }
        // console.log('ulx/uly//lrx/lry;w/h: ' + ulx + '/' + uly + '; ' + lrx + '/' + lry + '; ' + width + '/' + height);
    } else {
        svgContainer.removeAttribute('transform-origin');
        svgContainer.removeAttribute('transform');
        svg.removeAttribute('viewBox');
        svg.innerHTML = '';
        svg.appendChild(warningSvgText);
    }
    busy(false);
}

function drawBoundingBox(zoneId, measureId, measureN) {
    if (facs[zoneId]) {
        let rect = document.createElementNS(svgNameSpace, 'rect');
        rect.setAttribute('rx', rectangleLineWidth / 2);
        rect.setAttribute('ry', rectangleLineWidth / 2);
        rect.addEventListener('click', (e) => v.handleClickOnNotation(e, cm));
        let editFacsimileZones = document.getElementById('editFacsimileZones').checked;
        let svg = document.getElementById('source-image-svg');
        svg.appendChild(rect);
        let x = parseFloat(facs[zoneId].ulx);
        let y = parseFloat(facs[zoneId].uly);
        let width = parseFloat(facs[zoneId].lrx) - x;
        let height = parseFloat(facs[zoneId].lry) - y;
        updateRect(rect, x, y, width, height, rectangleColor, rectangleLineWidth, 'none');
        if (editFacsimileZones) rect.id = zoneId;
        else if (measureId) rect.id = measureId;
        if (measureN) { // draw number-like info from measure
            let txt = document.createElementNS(svgNameSpace, 'text');
            svg.appendChild(txt);
            txt.setAttribute('font-size', '28px');
            txt.setAttribute('font-weight', 'bold');
            txt.setAttribute('fill', rectangleColor);
            txt.setAttribute('x', x + 7);
            txt.setAttribute('y', y + 29);
            txt.addEventListener('click', (e) => v.handleClickOnNotation(e, cm));
            txt.textContent = measureN;
            if (measureId) txt.id = editFacsimileZones ? zoneId : measureId;
        }
    }
}

async function loadImage(url) {
    return new Promise((resolve) => {
        const img = document.createElementNS(svgNameSpace, 'image');
        img.setAttribute('id', 'source-image');
        img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', url);
        img.onload = () => resolve(img);
        img.onerror = (err) => {
            console.log('Cannot load image file ' + url + ', error: ', err);
            resolve(null);
        }
    });
}


export function zoomFacsimile(deltaPercent) {
    let facsimileZoomInput = document.getElementById('facsimileZoomInput');
    let facsZoom = document.getElementById('facsimile-zoom');
    if (facsimileZoomInput && deltaPercent) {
        facsimileZoomInput.value =
            Math.min(parseInt(facsimileZoomInput.max),
                Math.max(parseInt(facsimileZoomInput.min),
                    parseInt(facsimileZoomInput.value) + deltaPercent)
            );
    }
    if (facsZoom && deltaPercent) {
        facsZoom.value = facsimileZoomInput.value;
    }
    let svgContainer = document.getElementById('source-image-container');
    svgContainer.setAttribute("transform", "scale(" + facsimileZoomInput.value / 100 + ")");
}

export function highlightZone(rect) {
    let svg = document.getElementById('source-image-svg');
    // remove event listerners
    for (let key in listenerHandles) {
        if (key === 'mousedown') { // remove mousedown listener from all rectangles
            svg.querySelectorAll('rect').forEach(r => r.removeEventListener(key, listenerHandles[key]));
        } else { // and the other two from the facsimile-panel
            let ip = document.getElementById('facsimile-panel')
            if (ip) ip.removeEventListener(key, listenerHandles[key]);
        }
    }
    // add zone resizer for selected zone box (only when linked to zone rather than to measure)
    if (document.getElementById('editFacsimileZones').checked)
        listenerHandles = addZoneResizer(v, rect);
}


// event listeners for resizing a zone bounding box
export function addZoneResizer(v, rect) {
    let txt = document.querySelector('text[id="' + rect.id + '"]');
    let txtX, txtY;
    if (txt) {
        txtX = parseFloat(txt.getAttribute('x'));
        txtY = parseFloat(txt.getAttribute('y'));
    }
    var ip = document.getElementById('facsimile-panel');
    var svg = document.getElementById('source-image-svg');
    var start = {}; // starting point start.x, start.y
    var end = {}; // ending point
    var bb;

    function mouseDown(ev) {
        let bcr = rect.getBoundingClientRect();
        bb = rect.getBBox();
        start.x = ev.clientX + ip.scrollLeft;
        start.y = ev.clientY + ip.scrollTop;
        let thres = rectangleLineWidth * 2;
        let xl = Math.abs(ev.clientX - bcr.x);
        let xr = Math.abs(ev.clientX - bcr.x - bcr.width);
        let yu = Math.abs(ev.clientY - bcr.y);
        let yl = Math.abs(ev.clientY - bcr.y - bcr.height);
        if (ev.clientX > bcr.x && ev.clientX < (bcr.x + bcr.width) &&
            ev.clientY > bcr.y && ev.clientY < (bcr.y + bcr.height))
            resize = 'pan';
        if (xl < thres) resize = 'west';
        if (yu < thres) resize = 'north';
        if (xr < thres) resize = 'east';
        if (yl < thres) resize = 'south';
        if (xl < thres && yu < thres) resize = 'northwest';
        if (xr < thres && yu < thres) resize = 'northeast';
        if (xl < thres && yl < thres) resize = 'southwest';
        if (xr < thres && yl < thres) resize = 'southeast';
        console.log('ZoneResizer: Mouse down ' + resize + ' ev.clientX/Y:' + ev.clientX + '/' + ev.clientX + ', rect:', rect);
    };

    function mouseMove(ev) {
        let bcr = rect.getBoundingClientRect();
        let thres = rectangleLineWidth * 2;
        let xl = Math.abs(ev.clientX - bcr.x);
        let xr = Math.abs(ev.clientX - bcr.x - bcr.width);
        let yu = Math.abs(ev.clientY - bcr.y);
        let yl = Math.abs(ev.clientY - bcr.y - bcr.height);
        rect.style.cursor = 'default';
        if (ev.clientX > bcr.x && ev.clientX < (bcr.x + bcr.width) &&
            ev.clientY > bcr.y && ev.clientY < (bcr.y + bcr.height) &&
            ev.target === rect)
            rect.style.cursor = 'move';
        if (xl < thres) rect.style.cursor = 'ew-resize';
        if (yu < thres) rect.style.cursor = 'ns-resize';
        if (xr < thres) rect.style.cursor = 'ew-resize';
        if (yl < thres) rect.style.cursor = 'ns-resize';
        if (xl < thres && yu < thres) rect.style.cursor = 'nwse-resize';
        if (xr < thres && yu < thres) rect.style.cursor = 'nesw-resize';
        if (xl < thres && yl < thres) rect.style.cursor = 'nesw-resize';
        if (xr < thres && yl < thres) rect.style.cursor = 'nwse-resize';
        // console.log('ZoneResizer: Mouse Move ' + resize + ' ev.clientX/Y:' + ev.clientX + '/' + ev.clientY + ', rect:', bcr);

        if (bb && resize) {
            let thisStart = {}; // adjust starting point to scroll of verovio-panel
            thisStart.x = start.x - ip.scrollLeft;
            thisStart.y = start.y - ip.scrollTop;
            end.x = ev.clientX;
            end.y = ev.clientY;

            var mx = svg.getScreenCTM().inverse();
            let s = transformCTM(thisStart, mx);
            let e = transformCTM(end, mx);
            let dx = e.x - s.x;
            let dy = e.y - s.y;

            let x, y, width, height;
            switch (resize) {
                case 'west':
                    x = bb.x + dx, y = bb.y, width = bb.width - dx, height = bb.height;
                    break;
                case 'east':
                    x = bb.x, y = bb.y, width = bb.width + dx, height = bb.height;
                    break;
                case 'north':
                    x = bb.x, y = bb.y + dy, width = bb.width, height = bb.height - dy;
                    break;
                case 'south':
                    x = bb.x, y = bb.y, width = bb.width, height = bb.height + dy;
                    break;
                case 'northwest':
                    x = bb.x + dx, y = bb.y + dy, width = bb.width - dx, height = bb.height - dy;
                    break;
                case 'northeast':
                    x = bb.x, y = bb.y + dy, width = bb.width + dx, height = bb.height - dy;
                    break;
                case 'southwest':
                    x = bb.x + dx, y = bb.y, width = bb.width - dx, height = bb.height + dy;
                    break;
                case 'southeast':
                    x = bb.x, y = bb.y, width = bb.width + dx, height = bb.height + dy;
                    break;
                case 'pan':
                    x = bb.x + dx, y = bb.y + dy, width = bb.width, height = bb.height;
                    break;
            }
            x = Math.round(x), y = Math.round(y), width = Math.round(width), height = Math.round(height);
            let c = adjustCoordinates(x, y, width, height);
            updateRect(rect, c.x, c.y, c.width, c.height, rectangleColor, rectangleLineWidth, 'none');
            if (txt && (resize === 'northwest' || resize === 'west' || resize === 'pan'))
                txt.setAttribute('x', txtX + dx);
            if (txt && (resize === 'north' || resize === 'northwest' || resize === 'pan'))
                txt.setAttribute('y', txtY + dy);

            let zone = v.xmlDoc.querySelector('[*|id=' + rect.id + ']');
            zone.setAttribute('ulx', c.x);
            zone.setAttribute('uly', c.y);
            zone.setAttribute('lrx', c.x + c.width);
            zone.setAttribute('lry', c.y + c.height);
            // edit in CodeMirror
            v.updateNotation = false;
            replaceInEditor(cm, zone, true);
            v.updateNotation = true;
            // console.log('Dragging: ' + resize + ' ' + dx + '/' + dy);
        }
    };

    function mouseUp(ev) {
        resize = '';
        loadFacsimile(v.xmlDoc);
        // console.log('mouse up');
    };

    rect.addEventListener('mousedown', mouseDown);
    ip.addEventListener('mousemove', mouseMove);
    ip.addEventListener('mouseup', mouseUp);

    return {
        'mousedown': mouseDown,
        'mousemove': mouseMove,
        'mouseup': mouseUp
    };

} // addZoneResizer()

// enables new zone drawing with mouse click-and-drag
export function addZoneDrawer() {
    let ip = document.getElementById('facsimile-panel');
    let svg = document.getElementById('source-image-svg');
    let start = {}; // starting point start.x, start.y
    let end = {}; // ending point
    let drawing = '';
    let minSize = 20; // px, minimum width and height for a zone

    function mouseDown(ev) {
        ev.preventDefault();
        if (document.getElementById('editFacsimileZones').checked && !resize) {
            start.x = ev.clientX; // + ip.scrollLeft;
            start.y = ev.clientY; // + ip.scrollTop;

            var mx = svg.getScreenCTM().inverse();
            let s = transformCTM(start, mx);

            let rect = document.createElementNS(svgNameSpace, 'rect');
            rect.id = 'new-rect';
            rect.setAttribute('rx', rectangleLineWidth / 2);
            rect.setAttribute('ry', rectangleLineWidth / 2);
            rect.setAttribute('x', s.x + ulx);
            rect.setAttribute('y', s.y + uly);
            rect.setAttribute('stroke', rectangleColor);
            rect.setAttribute('stroke-width', rectangleLineWidth);
            rect.setAttribute('fill', 'none');
            svg.appendChild(rect);
            drawing = 'new';
            console.log('ZoneDrawer mouse down: ' + drawing + '; ' +
                ev.clientX + '/' + ev.clientY + ', scroll: ' + ip.scrollLeft + '/' + ip.scrollTop + ', start: ', start);
        }
    }

    function mouseMove(ev) {
        ev.preventDefault();
        if (document.getElementById('editFacsimileZones').checked && drawing === 'new') {
            let rect = document.getElementById('new-rect');
            if (rect && !resize) {
                end.x = ev.clientX;
                end.y = ev.clientY;
                var mx = svg.getScreenCTM().inverse();
                let s = transformCTM(start, mx);
                let e = transformCTM(end, mx);
                let c = adjustCoordinates(s.x, s.y, e.x - s.x, e.y - s.y);
                rect.setAttribute('x', c.x + ulx);
                rect.setAttribute('y', c.y + uly);
                rect.setAttribute('width', c.width);
                rect.setAttribute('height', c.height);
            }
        }
    }

    function mouseUp(ev) {
        if (document.getElementById('editFacsimileZones').checked && !resize) {
            let rect = document.getElementById('new-rect');
            if (rect && (Math.round(rect.getAttribute('width'))) > minSize &&
                (Math.round(rect.getAttribute('height'))) > minSize) {
                // add zone and a measure
                if (!addZone(v, cm, rect)) {
                    if (rect) rect.remove();
                    let warning = `Cannot add a zone element. Please select a zone element first.`;
                    v.showAlert(warning, 'warning', 10000);
                    console.warn(warning);
                }
            } else if (rect) {
                rect.remove();
            }
            drawing = '';
        }
    }

    svg.addEventListener('mousedown', mouseDown);
    svg.addEventListener('mousemove', mouseMove);
    svg.addEventListener('mouseup', mouseUp);
}


// convert negative width/height to correct left-upper corner & width/height values
function adjustCoordinates(x, y, width, height) {
    let c = {};
    c.x = Math.min(x, x + width);
    c.y = Math.min(y, y + height);
    c.width = Math.abs(width);
    c.height = Math.abs(height);
    return c;
}

export function ingestFacsimile() {
    let reply = {};
    let input = document.createElement('input');
    input.type = 'file';
    let accept = '.mei,.xml,.musicxml,.txt';
    input.accept = accept;
    input.addEventListener('change', ev => ingestionInputHandler(ev));
    input.click();
}

function ingestionInputHandler(ev) {
    let files = Array.from(ev.target.files);
    let reply = {};

    let readingPromise = new Promise(function (loaded, notLoaded) {
        reply.fileName = files[0].name;
        let reader = new FileReader();
        reader.onload = (event) => {
            reply.mei = event.target.result;
            if (reply.mei) loaded(reply);
            else notLoaded();
        }
        reader.readAsText(files[0]);
    });
    readingPromise.then(
        function (reply) {
            handleFacsimileIngestion(reply)
        },
        function () {
            log('Loading of ingestion file ' + reply.fileName + ' failed.');
        }
    );
}

function handleFacsimileIngestion(reply) {
    busy();
    console.log('Skeleton MEI file ' + reply.fileName + ' loaded.');
    let skelXml = new DOMParser().parseFromString(reply.mei, "text/xml");
    let facsimile = skelXml.querySelector('facsimile');
    let zones = facsimile.querySelectorAll('zone');
    let music = v.xmlDoc.querySelector('music');
    if (!music) return;
    v.updateNotation = false;
    zones.forEach(z => {
        let zoneId = '';
        if (z.hasAttribute('xml:id')) zoneId = z.getAttribute('xml:id');
        let ms = skelXml.querySelectorAll('[facs="#' + zoneId + '"]');
        ms.forEach(m => {
            let n = m.getAttribute('n');
            let targetMeasure = music.querySelectorAll('measure[n="' + n + '"]');
            if (targetMeasure.length < 1)
                console.warn('Measure number not found: n=' + n + ', ', targetMeasure);
            if (targetMeasure.length > 1)
                console.warn('Measure number not unique: n=' + n + ', ', targetMeasure);
            if (targetMeasure.length === 1) {
                // console.info('Adding @facs=' + zoneId + ' to ', targetMeasure)
                targetMeasure.item(0).setAttribute('facs', '#' + zoneId);
                replaceInEditor(cm, targetMeasure.item(0));
            }
        });
    });

    // ingest facsimile into target MEI (in music before body)
    let body = music.querySelector('body');
    if (body) {
        music.insertBefore(facsimile, body);
        let id = body.getAttribute('xml:id');
        if (!id) {
            console.warn('Please put @xml:id to body element');
            // id = 'body-' + generateUUID();
            // body.setAttributeNS(xmlNameSpace, 'id', id);
            // replaceInEditor(cm, body);
        }
        if (id) {
            setCursorToId(cm, id);
            let cr = cm.getCursor();
            cm.replaceRange(xmlToString(facsimile) + '\n', cr);
            let cr2 = cm.getCursor();
            for (let l = cr.line; l < cr2.line; l++) cm.indentLine(l);
            loadFacsimile(v.xmlDoc);
            console.log('Adding facsimile before body', facsimile);
        }
    }
    // uncheck edit zones after ingest
    document.getElementById('editFacsimileZones').checked = false;
    v.updateData(cm, false, true);
    v.updateNotation = true;
    busy(false);
}

function busy(active = true) {
    let facsimileIcon = document.getElementById('facsimile-icon');
    if (facsimileIcon && active) {
        facsimileIcon.classList.add('clockwise');
    } else if (facsimileIcon && !active)
        facsimileIcon.classList.remove('clockwise');
}