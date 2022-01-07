let orientation = 'bottom';
let notationProportion = .5; // proportion notation div takes from container
let resizerWidth = 8; // 8 px, attention hard-coded also in 4 css files

export function setOrientation(cm, o = '', v = null) {
  if (o) orientation = o;
  let friendSz = document.querySelector(".friendContainer");
  var stylesheet = document.getElementById("orientationCSS");
  stylesheet.setAttribute('href', root + 'css/' + orientation + '.css');
  // TODO: find a better solution for changing css and awaiting changes
  // $("#orientationCSS").load(function() {
  // v.updateLayout();
  // }).attr('href', root + '/css/' + orientation + '.css');
  let sz = calcSizeOfContainer();
  sz.width = sz.width*.85; // HACK DW - make space for annotation sidebar
  friendSz.style.width = sz.width;
  friendSz.style.height = sz.height;
  let notation = document.querySelector(".notation");
  console.log('setOrientation(' + o + ') container size:', sz);
  if (orientation == "top" || orientation == "bottom") {
    notation.style.width = sz.width; //- 6; // TODO: remove when border removed
    notation.style.height = sz.height * notationProportion;
    cm.setSize(sz.width, sz.height * (1 - notationProportion) - resizerWidth);
  }
  if (orientation == "left" || orientation == "right") {
    notation.style.width = sz.width * notationProportion;
    notation.style.height = sz.height; //- 6; TODO: remove when border removed
    cm.setSize(sz.width * (1 - notationProportion), sz.height);
  }
  // console.info('Notation size: ' + notation.style.width + '/' + notation.style.height);
  // redoLayout when done with loading TODO
  if (v) setTimeout(() => v.updateLayout(), 33);
}

export function calcSizeOfContainer() {
  let bodySz = document.querySelector('body').getBoundingClientRect();
  let friendSz = document.querySelector(".friendContainer")
    .getBoundingClientRect();
  let headerSz = document.querySelector('.header').getBoundingClientRect();
  //let sizerSz = document.querySelector('.resizer').getBoundingClientRect();
  let footerSz = document.querySelector('.footer').getBoundingClientRect();
  friendSz.height = bodySz.height - headerSz.height - footerSz.height -
    resizerWidth;
  friendSz.width = bodySz.width - resizerWidth;
  console.log('calcSizeOfContainer(' + orientation +
    ') bodySz, header, sizer, footer: ' +
    Math.round(bodySz.width) + '/' + Math.round(bodySz.height) + ', ' +
    Math.round(headerSz.width) + '/' + Math.round(headerSz.height) + ', ' +
    Math.round(footerSz.width) + '/' + Math.round(footerSz.height) + ', ' +
    Math.round(friendSz.width) + '/' + Math.round(friendSz.height) + '.');
  return friendSz;
}

export function getVerovioContainerSize() {
  let v = document.querySelector('.notation');
  let c = document.getElementById('verovio-controls-form');
  if (!c || !v) return false;
  let vbox = v.getBoundingClientRect();
  let cbox = c.getBoundingClientRect();
  vbox.height -= cbox.height;
  return vbox;
}

export function addResizerHandlers(cm, v) {
  const resizer = document.getElementById('dragMe');
  const notation = resizer.previousElementSibling;
  const encoding = resizer.nextElementSibling;
  let x = 0;
  let y = 0;
  let notationSize = 0;

  const mouseDownHandler = function(e) {
    x = e.clientX;
    y = e.clientY;
    if (orientation == "top" || orientation == "bottom")
      notationSize = notation.getBoundingClientRect().height;
    if (orientation == "left" || orientation == "right")
      notationSize = notation.getBoundingClientRect().width;
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseUpHandler);
    // console.log("Mouse down x/y: " + x + "/" + y + ', ' + notationSize);
  };

  const mouseMoveHandler = function(e) {
    const dx = e.clientX - x;
    const dy = e.clientY - y;
    let sz = resizer.parentNode.getBoundingClientRect();
    let szSz = resizer.getBoundingClientRect();
    console.log("Mouse move dx/dy: " + dx + "/" + dy +
      ', Container: ' + sz.width + '/' + sz.height);
    switch (orientation) {
      case 'top':
        notation.style.height = (notationSize + dy);
        notationProportion = (notationSize + dy) / sz.height;
        cm.setSize(sz.width, sz.height - (notationSize + dy) - szSz.height);
        break;
      case 'bottom':
        notation.style.height = (notationSize - dy);
        console.log('notation height: ' + notation.style.height);
        notationProportion = (notationSize - dy) / sz.height;
        cm.setSize(sz.width, sz.height - (notationSize - dy) - szSz.height);
        break;
      case 'right':
        notation.style.width = (notationSize - dx);
        notationProportion = (notationSize - dx) / sz.width;
        cm.setSize(sz.width - (notationSize - dx), sz.height - szSz.width);
        break;
      case 'left':
      default:
        notation.style.width = (notationSize + dx);
        notationProportion = (notationSize + dx) / sz.width;
        cm.setSize(sz.width - (notationSize + dx), sz.height - szSz.width);
        break;
    }
    const cursor = (orientation == "left" || orientation == "right") ?
      'col-resize' : 'row-resize';
    resizer.style.cursor = cursor;
    document.body.style.cursor = cursor;
    notation.style.userSelect = 'none';
    notation.style.pointerEvents = 'none';
    encoding.style.userSelect = 'none';
    encoding.style.pointerEvents = 'none';
  };

  const mouseUpHandler = function() {
    resizer.style.removeProperty('cursor');
    document.body.style.removeProperty('cursor');
    notation.style.removeProperty('user-select');
    notation.style.removeProperty('pointer-events');
    encoding.style.removeProperty('user-select');
    encoding.style.removeProperty('pointer-events');
    document.removeEventListener('mousemove', mouseMoveHandler);
    document.removeEventListener('mouseup', mouseUpHandler);
    if (v) v.updateLayout();
  };

  resizer.addEventListener('mousedown', mouseDownHandler);
}
