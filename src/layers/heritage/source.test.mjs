import test from 'node:test';
import assert from 'node:assert/strict';
import { createHeritageSource } from './source.js';

const box = { south: 53.85, west: -9.65, north: 53.92, east: -9.5 };

test('fetch calls the fixed points route with the box and limit', async () => {
  let seen;
  const source = createHeritageSource({
    fetchImpl: async (url, options) => {
      seen = { url: new URL(url, 'http://x'), signal: options.signal };
      return Response.json({ total: 1, saturated: false, records: [{ id: 'smr:MA1', monumentClass: 'Ringfort - rath', latitude: 53.88, longitude: -9.55 }] });
    },
  });
  const signal = new AbortController().signal;
  const result = await source.fetch(box, signal);
  assert.equal(seen.url.pathname, '/api/heritage/smr/points');
  assert.equal(seen.url.searchParams.get('south'), '53.8500');
  assert.equal(seen.url.searchParams.get('limit'), '1000');
  assert.equal(seen.signal, signal);
  assert.equal(result.records.length, 1);
});

test('invalid records are dropped', async () => {
  const source = createHeritageSource({
    fetchImpl: async () => Response.json({ total: 2, records: [{ id: 'smr:1', monumentClass: 'X', latitude: 'bad', longitude: 1 }, { id: 'smr:2', monumentClass: 'X', latitude: 53, longitude: -9 }] }),
  });
  assert.deepEqual((await source.fetch(box)).records.map((r) => r.id), ['smr:2']);
});

test('a missing snapshot rejects with a recognisable code', async () => {
  const source = createHeritageSource({ fetchImpl: async () => Response.json({ error: 'smr_snapshot_missing' }, { status: 503 }) });
  await assert.rejects(source.fetch(box), (error) => error.code === 'smr_snapshot_missing');
});

test('describe calls the fixed record route with the SMR number and signal', async () => {
  let seen;
  const record = { id: 'smr:MA070-110----', smrs: 'MA070-110----', description: 'In pasture.' };
  const source = createHeritageSource({
    fetchImpl: async (url, options) => {
      seen = { url: new URL(url, 'http://x'), signal: options.signal };
      return Response.json(record);
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await source.describe('MA070-110----', signal), record);
  assert.equal(seen.url.pathname, '/api/heritage/smr/record');
  assert.equal(seen.url.searchParams.get('smrs'), 'MA070-110----');
  assert.equal(seen.signal, signal);
});

test('describe rejects a busy upstream with a recognisable code and other failures plainly', async () => {
  const busy = createHeritageSource({ fetchImpl: async () => Response.json({ error: 'description_busy' }, { status: 503 }) });
  await assert.rejects(busy.describe('MA1'), (error) => error.code === 'description_busy');
  const failed = createHeritageSource({ fetchImpl: async () => Response.json({ error: 'description_unavailable' }, { status: 502 }) });
  await assert.rejects(failed.describe('MA1'), (error) => error instanceof Error && error.code === undefined);
});
