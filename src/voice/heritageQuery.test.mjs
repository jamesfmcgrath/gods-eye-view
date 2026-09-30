import test from 'node:test';
import assert from 'node:assert/strict';
import { runHeritageQuery } from './heritageQuery.js';

const mayoView = { lat: 53.88, lon: -9.55, box: { south: 53.8, west: -9.7, north: 53.95, east: -9.4 }, radiusKm: 20 };
const bounds = { south: 51.4, west: -10.6, north: 55.4, east: -6.0 };
const reply = (body, status = 200) => async (url) => {
  reply.last = new URL(url, 'http://x');
  return Response.json(body, { status });
};

test('count in view sends the view box and the chosen types', async () => {
  const result = await runHeritageQuery(
    { mode: 'count', types: ['ringfort'] },
    { getView: () => mayoView, fetchImpl: reply({ total: 57, byClass: [{ monumentClass: 'Ringfort - rath', count: 50 }], bounds }) },
  );
  assert.equal(reply.last.pathname, '/api/heritage/smr/stats');
  assert.equal(reply.last.searchParams.get('south'), '53.8000');
  assert.equal(reply.last.searchParams.get('types'), 'ringfort');
  assert.equal(result.count, 57);
  assert.equal(result.what, 'ringforts');
  assert.equal(result.scopeLabel, 'in the current view');
  assert.match(result.attribution, /National Monuments Service/);
});

test('count falls back to a radius when there is no usable view box', async () => {
  const result = await runHeritageQuery(
    { mode: 'count' },
    { getView: () => ({ ...mayoView, box: null }), fetchImpl: reply({ total: 3, byClass: [], bounds }) },
  );
  assert.equal(reply.last.searchParams.get('km'), '20');
  assert.equal(reply.last.searchParams.get('south'), null);
  assert.equal(result.scopeLabel, 'within 20 km of the view centre');
});

test('an explicit radius overrides the view', async () => {
  await runHeritageQuery(
    { mode: 'count', scope: { kind: 'radius', km: 10 } },
    { getView: () => mayoView, fetchImpl: reply({ total: 1, byClass: [], bounds }) },
  );
  assert.equal(reply.last.searchParams.get('km'), '10');
});

test('nearest returns coordinates the model can fly to', async () => {
  const record = { smrs: 'MA4', monumentClass: 'Castle - tower house', townland: 'Rockfleet', county: 'Mayo', latitude: 53.896, longitude: -9.627, distanceKm: 5.3 };
  const result = await runHeritageQuery(
    { mode: 'nearest', types: ['tower-house'], limit: 1 },
    { getView: () => mayoView, fetchImpl: reply({ total: 40, records: [record], bounds }) },
  );
  assert.equal(reply.last.pathname, '/api/heritage/smr/nearest');
  assert.equal(reply.last.searchParams.get('limit'), '1');
  assert.deepEqual(result.items[0], { name: 'Castle - tower house, Rockfleet', ...record });
});

test('unknown types are dropped before calling the server', async () => {
  await runHeritageQuery(
    { mode: 'count', types: ['forts', 'holy-well'] },
    { getView: () => mayoView, fetchImpl: reply({ total: 0, byClass: [], bounds }) },
  );
  assert.equal(reply.last.searchParams.get('types'), 'holy-well');
});

test('zero results carry the coverage note', async () => {
  const london = { lat: 51.5, lon: -0.12, box: { south: 51.4, west: -0.3, north: 51.6, east: 0.1 }, radiusKm: 20 };
  const result = await runHeritageQuery(
    { mode: 'count' },
    { getView: () => london, fetchImpl: reply({ total: 0, byClass: [], bounds }) },
  );
  assert.match(result.note, /Republic of Ireland/);
});

test('a missing snapshot tells the user how to fix it', async () => {
  const result = await runHeritageQuery(
    { mode: 'count' },
    { getView: () => mayoView, fetchImpl: reply({ error: 'smr_snapshot_missing' }, 503) },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /npm run smr:snapshot/);
});

test('no camera gives a clear failure', async () => {
  const result = await runHeritageQuery({ mode: 'count' }, { getView: () => null, fetchImpl: reply({}) });
  assert.equal(result.ok, false);
});

const record = { smrs: 'MA070-110----', monumentClass: 'Castle - tower house', townland: 'Rockfleet', county: 'Mayo', link: 'https://example.test/r', description: 'A tower house on the shore.' };
const describeNoView = { getView: () => null };

test('describe fetches the record and returns its description', async () => {
  const result = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply(record) },
  );
  assert.equal(reply.last.pathname, '/api/heritage/smr/record');
  assert.equal(reply.last.searchParams.get('smrs'), 'MA070-110----');
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'describe');
  assert.equal(result.name, 'Castle - tower house, Rockfleet');
  assert.equal(result.hasDescription, true);
  assert.equal(result.description, 'A tower house on the shore.');
  assert.equal(result.truncated, false);
  assert.equal(result.link, record.link);
  assert.match(result.attribution, /National Monuments Service/);
});

test('describe cuts a long description to 3000 characters', async () => {
  const result = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply({ ...record, description: 'x'.repeat(3500) }) },
  );
  assert.equal(result.description.length, 3000);
  assert.equal(result.truncated, true);
});

test('describe without a description says so', async () => {
  const result = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply({ ...record, description: null }) },
  );
  assert.equal(result.hasDescription, false);
  assert.equal(result.description, null);
  assert.equal(result.truncated, false);
  assert.equal(result.note, 'The record has no published description for this site yet.');
});

test('describe rejects a missing or malformed smrs without fetching', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return Response.json({}); };
  for (const smrs of [undefined, '', "MA1' OR 1=1", 'ma070-110----']) {
    const result = await runHeritageQuery({ mode: 'describe', smrs }, { ...describeNoView, fetchImpl });
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test('describe maps 404 and 503 to plain errors', async () => {
  const notFound = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply({ error: 'unknown_smrs' }, 404) },
  );
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /record/);
  const busy = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply({ error: 'description_busy' }, 503) },
  );
  assert.equal(busy.ok, false);
  assert.match(busy.error, /busy.*try again/i);
});

test('describe with a missing snapshot tells the user how to fix it', async () => {
  const result = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: reply({ error: 'smr_snapshot_missing' }, 503) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'The monuments data has not been downloaded. Tell the user to run npm run smr:snapshot and restart the app.');
});

test('describe treats a 503 without JSON as busy', async () => {
  const result = await runHeritageQuery(
    { mode: 'describe', smrs: 'MA070-110----' },
    { ...describeNoView, fetchImpl: async () => new Response('down', { status: 503 }) },
  );
  assert.match(result.error, /busy.*try again/i);
});
