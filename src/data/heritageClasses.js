/**
 * @module heritageClasses
 * @description Spoken monument types for the Monuments (SMR) layer and the
 * heritage_query voice tool, mapped onto National Monuments Service
 * MONUMENT_CLASS values. Pure data and helpers: imported by the browser, the
 * server route and node:test.
 */

const is = (name) => (value) => value === name;
const startsWith = (prefix) => (value) => value.startsWith(prefix);

export const HERITAGE_TYPES = Object.freeze({
  ringfort: { label: 'ringforts', match: startsWith('Ringfort - ') },
  rath: { label: 'raths', match: is('Ringfort - rath') },
  cashel: { label: 'cashels', match: is('Ringfort - cashel') },
  castle: { label: 'castles', match: startsWith('Castle - ') },
  'tower-house': { label: 'tower houses', match: is('Castle - tower house') },
  'holy-well': { label: 'holy wells', match: is('Ritual site - holy well') },
  'stone-circle': { label: 'stone circles', match: startsWith('Stone circle') },
  'standing-stone': {
    label: 'standing stones',
    match: startsWith('Standing stone'),
  },
  'megalithic-tomb': {
    label: 'megalithic tombs',
    match: startsWith('Megalithic tomb - '),
  },
  'portal-tomb': {
    label: 'portal tombs',
    match: is('Megalithic tomb - portal tomb'),
  },
  'court-tomb': {
    label: 'court tombs',
    match: is('Megalithic tomb - court tomb'),
  },
  'passage-tomb': {
    label: 'passage tombs',
    match: is('Megalithic tomb - passage tomb'),
  },
  'wedge-tomb': {
    label: 'wedge tombs',
    match: startsWith('Megalithic tomb - wedge tomb'),
  },
  'round-tower': { label: 'round towers', match: is('Round tower') },
  'ogham-stone': { label: 'ogham stones', match: startsWith('Ogham stone') },
  'high-cross': {
    label: 'high crosses',
    match: startsWith('Cross - High cross'),
  },
  church: {
    label: 'churches',
    match: (value) =>
      value === 'Church' || value === 'Church (present location)',
  },
  'religious-house': {
    label: 'abbeys, priories and friaries',
    match: startsWith('Religious house - '),
  },
  graveyard: { label: 'graveyards', match: is('Graveyard') },
  crannog: { label: 'crannogs', match: is('Crannog') },
  hillfort: { label: 'hillforts', match: is('Hillfort') },
  'promontory-fort': {
    label: 'promontory forts',
    match: startsWith('Promontory fort - '),
  },
  souterrain: { label: 'souterrains', match: is('Souterrain') },
  'fulacht-fia': { label: 'fulachtaí fia', match: is('Fulacht fia') },
});

export const HERITAGE_TYPE_KEYS = Object.freeze(Object.keys(HERITAGE_TYPES));
export const MAX_HERITAGE_TYPES = 8;

/** True when the class matches any key; an empty key list matches every class. */
export function classMatchesTypes(monumentClass, keys) {
  if (typeof monumentClass !== 'string') return false;
  if (!keys || keys.length === 0) return true;
  return keys.some((key) => HERITAGE_TYPES[key]?.match(monumentClass) === true);
}

/** Parse a comma-separated `types` query value. Empty means every class. */
export function parseHeritageTypes(value) {
  if (value == null || value === '') return { ok: true, keys: [] };
  const keys = [
    ...new Set(
      String(value)
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  ];
  if (keys.length > MAX_HERITAGE_TYPES)
    return { ok: false, error: 'too_many_types' };
  const unknown = keys.filter((key) => !Object.hasOwn(HERITAGE_TYPES, key));
  if (unknown.length) return { ok: false, error: 'unknown_type', unknown };
  return { ok: true, keys };
}

const FAMILY_RULES = [
  [
    'ringfort',
    (c) =>
      c.startsWith('Ringfort - ') ||
      c === 'Hillfort' ||
      c.startsWith('Promontory fort - ') ||
      c === 'Crannog',
  ],
  ['castle', (c) => c.startsWith('Castle - ') || c === 'Bawn'],
  [
    'ecclesiastical',
    (c) =>
      c.startsWith('Church') ||
      c.startsWith('Religious house - ') ||
      c.startsWith('Cross') ||
      c === 'Graveyard' ||
      c === 'Ecclesiastical enclosure' ||
      c === 'Round tower' ||
      c === 'Ritual site - holy well',
  ],
  [
    'ritual',
    (c) =>
      c.startsWith('Megalithic tomb - ') ||
      c.startsWith('Stone circle') ||
      c.startsWith('Standing stone') ||
      c.startsWith('Ogham stone') ||
      c === 'Rock art',
  ],
];

/** Okabe-Ito based, chosen to stay distinct under deuteranopia and protanopia. */
export const HERITAGE_FAMILY_COLORS = Object.freeze({
  ringfort: '#e69f00',
  castle: '#cc79a7',
  ecclesiastical: '#56b4e9',
  ritual: '#009e73',
  other: '#bbbbbb',
});

/** Legend wording per family, in legend order. */
export const HERITAGE_FAMILY_LABELS = Object.freeze({
  ringfort: 'Ringforts and forts',
  castle: 'Castles',
  ecclesiastical: 'Church sites',
  ritual: 'Tombs and stones',
  other: 'Other',
});

/**
 * Colour family for a class. Colour is not the only cue: the layer legend names
 * each family and the selection readout names the class.
 */
export function heritageFamily(monumentClass) {
  if (typeof monumentClass !== 'string') return 'other';
  for (const [family, rule] of FAMILY_RULES)
    if (rule(monumentClass)) return family;
  return 'other';
}
