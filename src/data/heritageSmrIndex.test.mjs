import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmrIndex } from '../../server/providers/heritage/smrIndex.js';

// Three raths and a tower house near Newport, Co. Mayo, and one rath in Cork.
const snapshot = {
  version: 1,
  fetchedAt: '2026-09-29T00:00:00Z',
  linkTemplate: 'https://hev.example/?q={SMRS}',
  classes: ['Castle - tower house', 'Ringfort - rath'],
  counties: ['Cork', 'Mayo'],
  rows: [
    ['MA1', 1, 1, 'A', 53.88, -9.55],
    ['MA2', 1, 1, 'B', 53.89, -9.56],
    ['MA3', 1, 1, 'C', 53.95, -9.70],
    ['MA4', 0, 1, 'Rockfleet', 53.896, -9.627],
    ['CO1', 1, 0, 'D', 51.9, -8.47],
  ],
};
const index = createSmrIndex(snapshot);
const newport = { south: 53.85, west: -9.65, north: 53.92, east: -9.5 };

test('bounds and count describe the snapshot', () => {
  assert.equal(index.count, 5);
  assert.deepEqual(index.bounds, { south: 51.9, west: -9.7, north: 53.95, east: -8.47 });
});

test('points returns records inside the box with ids and links', () => {
  const result = index.points({ box: newport, types: [], limit: 10 });
  assert.equal(result.total, 3);
  assert.equal(result.saturated, false);
  const rath = result.records.find((r) => r.smrs === 'MA1');
  assert.deepEqual(rath, {
    id: 'smr:MA1',
    smrs: 'MA1',
    monumentClass: 'Ringfort - rath',
    county: 'Mayo',
    townland: 'A',
    latitude: 53.88,
    longitude: -9.55,
    link: 'https://hev.example/?q=MA1',
  });
});

test('points keeps the records nearest the box centre when saturated', () => {
  const result = index.points({ box: newport, types: [], limit: 1 });
  assert.equal(result.total, 3);
  assert.equal(result.saturated, true);
  assert.equal(result.records.length, 1);
  // Centre (53.885, -9.575): MA2 is about 0.8 km away, MA1 about 1.7 km, MA4 about 3.6 km.
  assert.equal(result.records[0].smrs, 'MA2');
});

test('types filter by vocabulary key', () => {
  assert.equal(index.points({ box: newport, types: ['tower-house'], limit: 10 }).total, 1);
  assert.equal(index.points({ box: newport, types: ['ringfort'], limit: 10 }).total, 2);
});

test('stats counts by class in a box or a circle', () => {
  const inBox = index.stats({ box: newport, types: [] });
  assert.equal(inBox.total, 3);
  assert.deepEqual(inBox.byClass[0], { monumentClass: 'Ringfort - rath', count: 2 });
  const inCircle = index.stats({ circle: { lat: 53.88, lon: -9.55, km: 2 }, types: [] });
  assert.equal(inCircle.total, 2);
});

test('nearest sorts by distance and respects maxKm and types', () => {
  const result = index.nearest({ lat: 53.88, lon: -9.55, types: ['tower-house'], limit: 3, maxKm: 150 });
  assert.equal(result.records[0].smrs, 'MA4');
  assert.ok(result.records[0].distanceKm > 4 && result.records[0].distanceKm < 6);
  const none = index.nearest({ lat: 53.88, lon: -9.55, types: ['ringfort'], limit: 3, maxKm: 1 });
  assert.equal(none.records.length, 1);
});

test('a missing link template gives null links', () => {
  const plain = createSmrIndex({ ...snapshot, linkTemplate: null });
  assert.equal(plain.points({ box: newport, types: [], limit: 1 }).records[0].link, null);
});

test('find returns a record by SMR number, or null', () => {
  assert.equal(index.find('MA4').townland, 'Rockfleet');
  assert.equal(index.find('NOPE'), null);
});
