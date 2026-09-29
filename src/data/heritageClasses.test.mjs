import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERITAGE_TYPES,
  HERITAGE_TYPE_KEYS,
  classMatchesTypes,
  parseHeritageTypes,
  heritageFamily,
  HERITAGE_FAMILY_COLORS,
} from './heritageClasses.js';

test('ringfort covers rath, cashel and unclassified but not hillforts', () => {
  for (const c of ['Ringfort - rath', 'Ringfort - cashel', 'Ringfort - unclassified'])
    assert.equal(classMatchesTypes(c, ['ringfort']), true, c);
  assert.equal(classMatchesTypes('Hillfort', ['ringfort']), false);
});

test('tower-house is exact while castle covers every castle class', () => {
  assert.equal(classMatchesTypes('Castle - tower house', ['tower-house']), true);
  assert.equal(classMatchesTypes('Castle - motte', ['tower-house']), false);
  assert.equal(classMatchesTypes('Castle - motte', ['castle']), true);
});

test('moved objects still match their type', () => {
  assert.equal(classMatchesTypes('Ogham stone (present location)', ['ogham-stone']), true);
  assert.equal(classMatchesTypes('Cross - High cross (present location)', ['high-cross']), true);
});

test('no keys matches every class; a non-string class matches nothing', () => {
  assert.equal(classMatchesTypes('Enclosure', []), true);
  assert.equal(classMatchesTypes(null, []), false);
});

test('parseHeritageTypes accepts known keys, trims and de-duplicates', () => {
  assert.deepEqual(parseHeritageTypes(' ringfort,holy-well,ringfort '), {
    ok: true,
    keys: ['ringfort', 'holy-well'],
  });
  assert.deepEqual(parseHeritageTypes(null), { ok: true, keys: [] });
  assert.deepEqual(parseHeritageTypes(''), { ok: true, keys: [] });
});

test('parseHeritageTypes names unknown keys and rejects long lists', () => {
  assert.deepEqual(parseHeritageTypes('ringfort,forts,abbey'), {
    ok: false,
    error: 'unknown_type',
    unknown: ['forts', 'abbey'],
  });
  assert.equal(parseHeritageTypes(HERITAGE_TYPE_KEYS.slice(0, 9).join(',')).error, 'too_many_types');
});

test('every type has a label and a family colour exists for every family', () => {
  for (const key of HERITAGE_TYPE_KEYS) assert.equal(typeof HERITAGE_TYPES[key].label, 'string');
  for (const c of ['Ringfort - rath', 'Castle - tower house', 'Round tower', 'Stone circle', 'Enclosure'])
    assert.match(HERITAGE_FAMILY_COLORS[heritageFamily(c)], /^#[0-9a-f]{6}$/);
  assert.equal(heritageFamily('Round tower'), 'ecclesiastical');
  assert.equal(heritageFamily('Megalithic tomb - portal tomb'), 'ritual');
  assert.equal(heritageFamily('Enclosure'), 'other');
});
