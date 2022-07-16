// Handles display of sources score images as referenced through zone and surface elements.

var facs = {}; // facsimile structure in MEI file
var sourceImages = {}; // object of source images

import {
    rmHash
} from './utils.js';
import {
    svgNS
} from './dom-utils.js'
import {
    updateRect
} from './drag-selector.js';



// loads facsimile content of xmlDoc into an object
export function loadFacsimile(xmlDoc) {
    facs = {};
    sourceImages = {};
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
                if (id) facs[id] = {};
                if (id && target) facs[id]['target'] = target;
                if (id && width) facs[id]['width'] = width;
                if (id && height) facs[id]['height'] = height;
                if (id && ulx) facs[id]['ulx'] = ulx;
                if (id && uly) facs[id]['uly'] = uly;
                if (id && lrx) facs[id]['lrx'] = lrx;
                if (id && lry) facs[id]['lry'] = lry;
            }
        });
    }
    return facs;
}

// Draw the source image with bounding boxes for each zone
export async function drawSourceImage() {
    let rectangleLineWidth = 4;
    let fullPage = document.getElementById('showSourceImageFullPage').checked;
    let ulx = Number.MAX_VALUE; // boundary values for image envelope
    let uly = Number.MAX_VALUE;
    let lrx = 0;
    let lry = 0;
    let zoneId;
    let svgFacs = document.querySelectorAll('[data-facs]'); // list displayed zones
    if (fullPage && svgFacs) {
        let firstZone = svgFacs.item(0);
        if (firstZone.hasAttribute('data-facs'))
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
    if (svg) svg.innerHTML = '';
    if (facs[zoneId]) {
        let imgName = `${root}local/` + facs[zoneId].target;
        if (false) {
            imgName = imgName.replace('.tif', '.jpg'); // hack for some DIME files...
            let xfact = .33;
            let yfact = .67;
            ulx *= xfact;
            uly *= yfact;
            lrx *= xfact;
            lry *= yfact;
        }
        let img;
        if (!sourceImages.hasOwnProperty(imgName)) {
            img = document.createElementNS(svgNS, 'image');
            img.setAttribute('id', 'source-image');
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', imgName);
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
        let zoomFactor = document.getElementById('sourceImageZoom').value / 100;
        svgContainer.setAttribute("transform", "scale(" + zoomFactor + ")");
        svgContainer.setAttribute('width', width);
        svgContainer.setAttribute('height', height);
        // svgContainer.appendChild(document.createAttributeNS(svgNS, 'circle'))
        svg.setAttribute('viewBox', ulx + ' ' + uly + ' ' + width + ' ' + height);

        if (false) { // show page name on svg
            let lbl = document.getElementById('source-image-svg-label');
            if (!lbl) {
                lbl = document.createElementNS(svgNS, 'text');
                lbl.setAttribute('id', 'source-image-svg-label')
            }
            lbl.textContent = imgName.split('\\').pop().split('/').pop();
            lbl.setAttribute('font-size', '24px');
            lbl.setAttribute('x', ulx + 6);
            lbl.setAttribute('y', uly + 25);
            svg.appendChild(lbl);
        }
        // go through displayed zones and draw bounding boxes with number-like label
        svgFacs.forEach((f) => {
            if (f.hasAttribute('data-facs'))
                zoneId = rmHash(f.getAttribute('data-facs'));
            if (facs[zoneId]) {
                let rect = document.createElementNS(svgNS, 'rect');
                svg.appendChild(rect);
                let x = parseFloat(facs[zoneId].ulx);
                let y = parseFloat(facs[zoneId].uly);
                let width = parseFloat(facs[zoneId].lrx) - x;
                let height = parseFloat(facs[zoneId].lry) - y;
                updateRect(rect, x, y, width, height, 'darkred', rectangleLineWidth, 'none');
                if (f.hasAttribute('id')) rect.id = f.getAttribute('id');
                if (f.hasAttribute('data-n')) { // draw number-like info from measure
                    let txt = document.createElementNS(svgNS, 'text');
                    svg.appendChild(txt);
                    txt.setAttribute('font-size', '24px');
                    txt.setAttribute('font-weight', 'bold');
                    txt.setAttribute('fill', 'darkred');
                    txt.setAttribute('x', x + 6);
                    txt.setAttribute('y', y + 25);
                    txt.textContent = f.getAttribute('data-n');
                    if (f.hasAttribute('id')) txt.id = f.getAttribute('id');
                }
            }
        });
        // console.log('ulx/uly//lrx/lry;w/h: ' + ulx + '/' + uly + '; ' + lrx + '/' + lry + '; ' + width + '/' + height);
    }
}

async function loadImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = url;
        img.onload = () => resolve(img);
    });
}

export function zoomSourceImage(percent) {
    let sourceImageZoom = document.getElementById('sourceImageZoom');
    if (sourceImageZoom)
        sourceImageZoom.value = Math.min(parseInt(sourceImageZoom.max),
            Math.max(parseInt(sourceImageZoom.min), parseInt(sourceImageZoom.value) + percent));
    let svgContainer = document.getElementById('source-image-container');
    svgContainer.setAttribute("transform", "scale(" + sourceImageZoom.value / 100 + ")");
}