// lists of elements contained by attribute classes

export const attCurvature = ['bend', 'curve', 'lv', 'phrase', 'slur', 'tie'];

// see att.placement in MEI 4.0.1 definition: 'measure' taken out
export const attPlacement = [
  'accid', 'artic', 'attacca', 'breath', 'caesura', 'cpMark', 'dir', 'dynam',
  'dynam', 'f', 'fermata', 'fing', 'fingGrp', 'hairpin', 'harm', 'harpPedal',
  'lg', 'line', 'metaMark', 'mNum', 'mordent', 'ornam', 'pedal',
  'refrain', 'reh', 'sp', 'stageDir', 'syl', 'tempo', 'trill', 'turn', 'verse'
];

// pedal not yet in vertical group, but supported by Verovio; attacca, tempo not supported
export const attVerticalGroup = [
  'attacca', 'dir', 'dynam', 'hairpin', 'tempo', 'pedal'
];

export const dataPlacement = ['above', 'within', 'between', 'below'];

export const attStems = ['note', 'chord', 'ambNote'];

// not sure whether all listed...
export const modelControlEvents = ['anchoredText', 'arpeg', 'bracket',
  'bracketspan', 'breath', 'dir', 'dynam', 'fermata', 'fing', 'gliss',
  'hairpin', 'harm', 'mordent', 'mnum', 'octave', 'pedal', 'phrase', 'reh',
  'slur', 'tempo', 'tie', 'trill', 'turn'
];

export const pnames = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];

// according to Verovio 3.9's implementation of timeSpanningInterface()
// better: att.startEndId and att.timestamp2.logical
export const timeSpanningElements = [
  'bracketspan', 'dir', 'dynam', 'gliss', 'hairpin', 'harm', 'lv', 'octave',
  'pedal', 'pitchinflection', 'slur', 'tie', 'trill', 'syl'
];
