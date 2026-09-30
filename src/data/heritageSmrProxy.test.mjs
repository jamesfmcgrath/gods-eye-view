import test from 'node:test';
import assert from 'node:assert/strict';
import { heritageProxy } from '../../server/providers/heritage.js';

const snapshot = {
  version: 1,
  fetchedAt: '2026-09-29T00:00:00Z',
  linkTemplate: null,
  classes: ['Castle - tower house', 'Ringfort - rath'],
  counties: ['Mayo'],
  rows: [
    ['MA1', 1, 0, 'A', 53.88, -9.55],
    ['MA4', 0, 0, 'Rockfleet', 53.896, -9.627],
    ['MA070-110----', 0, 0, 'Corraun', 53.93, -9.8],
  ],
};

function install(options) {
  let handler;
  heritageProxy(options).configureServer({
    middlewares: { use: (path, cb) => { assert.equal(path, '/api/heritage/smr'); handler = cb; } },
  });
  return async (url, { method = 'GET', ip = '127.0.0.1' } = {}) => {
    const res = { status: 0, headers: {}, body: '' };
    await handler(
      { method, url, socket: { remoteAddress: ip } },
      { writeHead: (s, h) => { res.status = s; res.headers = h; }, end: (b) => { res.body = b; } },
    );
    return { ...res, json: res.body ? JSON.parse(res.body) : null };
  };
}

test('status reports the loaded snapshot with attribution', async () => {
  const get = install({ loadSnapshot: async () => snapshot });
  const res = await get('/status');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.json.count, 3);
  assert.equal(res.json.attribution, 'National Monuments Service, Government of Ireland');
});

test('points, stats and nearest answer from the index', async () => {
  const get = install({ loadSnapshot: async () => snapshot });
  const box = 'south=53.85&west=-9.65&north=53.92&east=-9.5';
  assert.equal((await get(`/points?${box}`)).json.total, 2);
  assert.equal((await get(`/stats?${box}&types=ringfort`)).json.total, 1);
  assert.equal((await get('/stats?lat=53.88&lon=-9.55&km=1')).json.total, 1);
  const near = await get('/nearest?lat=53.88&lon=-9.55&types=tower-house&limit=1');
  assert.equal(near.json.records[0].smrs, 'MA4');
});

test('a missing snapshot gives an actionable 503 and is retried later', async () => {
  let available = false;
  const get = install({
    loadSnapshot: async () => {
      if (!available) throw Object.assign(new Error('missing'), { code: 'SMR_SNAPSHOT_MISSING' });
      return snapshot;
    },
  });
  const res = await get('/status');
  assert.equal(res.status, 503);
  assert.equal(res.json.error, 'smr_snapshot_missing');
  assert.match(res.json.hint, /npm run smr:snapshot/);
  available = true;
  assert.equal((await get('/status')).status, 200);
});

test('other load failures are sanitised', async () => {
  const get = install({ loadSnapshot: async () => { throw new Error('/secret/path exploded'); } });
  const res = await get('/status');
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { error: 'heritage_unavailable' });
});

test('invalid boxes, scopes, points and types are rejected before querying', async () => {
  const get = install({ loadSnapshot: async () => snapshot });
  assert.equal((await get('/points?south=53&west=-10&north=55&east=-8')).json.error, 'invalid_box');
  assert.equal((await get('/points?south=54&west=-9&north=53&east=-8')).json.error, 'invalid_box');
  assert.equal((await get('/stats')).json.error, 'invalid_scope');
  assert.equal(
    (await get('/stats?south=53.85&west=-9.65&north=53.92&east=-9.5&lat=1&lon=1&km=1')).json.error,
    'invalid_scope',
  );
  assert.equal((await get('/nearest?lat=abc&lon=1')).json.error, 'invalid_point');
  const unknown = await get('/nearest?lat=53.88&lon=-9.55&types=forts');
  assert.equal(unknown.status, 400);
  assert.deepEqual(unknown.json, { error: 'unknown_type', unknown: ['forts'] });
});

test('unknown routes and non-GET methods never load the snapshot', async () => {
  let loads = 0;
  const get = install({ loadSnapshot: async () => { loads++; return snapshot; } });
  assert.equal((await get('/anything')).status, 404);
  assert.equal((await get('/status', { method: 'POST' })).status, 405);
  assert.equal(loads, 0);
});

test('the per-client limit stops a loop', async () => {
  const get = install({ loadSnapshot: async () => snapshot });
  let last;
  for (let i = 0; i < 241; i++) last = await get('/status', { ip: '10.0.0.9' });
  assert.equal(last.status, 429);
  assert.equal((await get('/status', { ip: '10.0.0.10' })).status, 200);
});

test('record returns the local record plus its description', async () => {
  const get = install({ loadSnapshot: async () => snapshot, recordFetcher: { get: async (smrs) => ({ smrs, description: 'A tower house.', fetchedAt: 'x', cached: false }) } });
  const res = await get('/record?smrs=MA070-110----');
  assert.equal(res.status, 200);
  assert.equal(res.json.townland, 'Corraun');
  assert.equal(res.json.description, 'A tower house.');
  assert.equal(res.json.attribution, 'National Monuments Service, Government of Ireland');
});

test('record rejects malformed and unknown ids without fetching', async () => {
  let fetched = 0;
  const get = install({ loadSnapshot: async () => snapshot, recordFetcher: { get: async () => { fetched++; return {}; } } });
  assert.equal((await get("/record?smrs=MA1'%20OR%201=1")).json.error, 'invalid_smrs');
  assert.equal((await get('/record?smrs=MA999-999----')).status, 404);
  assert.equal(fetched, 0);
});

test('record maps busy and failed upstreams to 503 and 502', async () => {
  const busy = install({ loadSnapshot: async () => snapshot, recordFetcher: { get: async () => { throw Object.assign(new Error('x'), { code: 'SMR_UPSTREAM_BUSY' }); } } });
  const res = await busy('/record?smrs=MA070-110----');
  assert.equal(res.status, 503);
  assert.equal(res.headers['Retry-After'], '60');
  const failed = install({ loadSnapshot: async () => snapshot, recordFetcher: { get: async () => { throw new Error('/secret'); } } });
  assert.deepEqual((await failed('/record?smrs=MA070-110----')).json, { error: 'description_unavailable' });
});
