import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSmrsId,
  cleanDescription,
  smrRecordUrl,
  createSmrRecordFetcher,
} from '../../server/providers/heritage/records.js';

function memoryFs() {
  const files = new Map();
  return {
    files,
    mkdir: async () => {},
    readFile: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files.get(file);
    },
    writeFile: async (file, text) => files.set(file, text),
    rename: async (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}
const reply = (notes) => Response.json({ features: [{ attributes: { SMRS: 'MA070-110----', WEB_NOTES: notes } }] });

test('SMR ids accept real formats and reject injection and paths', () => {
  for (const ok of ['MA076-009----', 'MA042-021002-', 'CL003A001----', 'CL062-001---*']) assert.equal(isSmrsId(ok), true, ok);
  for (const bad of ["MA1' OR 1=1", '../../etc/passwd', '', 'ma076-009----', 'MA1', 'MA076.009', null])
    assert.equal(isSmrsId(bad), false, String(bad));
});

test('placeholder and empty notes become null; whitespace collapses', () => {
  assert.equal(cleanDescription('Currently the information for this record has not been uploaded.'), null);
  assert.equal(cleanDescription('   '), null);
  assert.equal(cleanDescription(null), null);
  assert.equal(cleanDescription('In  pasture\n at the W edge.'), 'In pasture at the W edge.');
});

test('record URL is the fixed service with a single quoted id', () => {
  const url = new URL(smrRecordUrl('MA070-110----'));
  assert.equal(url.hostname, 'services-eu1.arcgis.com');
  assert.equal(url.searchParams.get('where'), "SMRS='MA070-110----'");
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
});

test('get fetches once, then serves memory and disk caches', async () => {
  let calls = 0;
  const fs = memoryFs();
  const make = () => createSmrRecordFetcher({ fetchImpl: async () => { calls++; return reply('A tower house.'); }, fs, cacheDir: '/c', now: () => 1_000_000 });
  const first = make();
  assert.deepEqual(await first.get('MA070-110----'), { smrs: 'MA070-110----', description: 'A tower house.', fetchedAt: new Date(1_000_000).toISOString(), cached: false });
  assert.equal((await first.get('MA070-110----')).cached, true);
  const second = make();
  assert.equal((await second.get('MA070-110----')).description, 'A tower house.');
  assert.equal(calls, 1);
});

test('concurrent requests for one id share a single upstream call', async () => {
  let calls = 0;
  const fetcher = createSmrRecordFetcher({ fetchImpl: async () => { calls++; return reply('X'); }, fs: memoryFs(), cacheDir: '/c' });
  await Promise.all([fetcher.get('MA070-110----'), fetcher.get('MA070-110----')]);
  assert.equal(calls, 1);
});

test('the per-minute budget and an upstream 429 both refuse with SMR_UPSTREAM_BUSY', async () => {
  let t = 0;
  const ids = ['MA001-001----', 'MA001-002----', 'MA001-003----'];
  const budgeted = createSmrRecordFetcher({ fetchImpl: async () => reply('X'), fs: memoryFs(), cacheDir: '/c', budgetPerMinute: 2, now: () => t });
  await budgeted.get(ids[0]);
  await budgeted.get(ids[1]);
  await assert.rejects(budgeted.get(ids[2]), { code: 'SMR_UPSTREAM_BUSY' });
  t = 61_000;
  await budgeted.get(ids[2]);

  const limited = createSmrRecordFetcher({ fetchImpl: async () => Response.json({ error: { code: 429 } }), fs: memoryFs(), cacheDir: '/c', now: () => 0 });
  await assert.rejects(limited.get(ids[0]), { code: 'SMR_UPSTREAM_BUSY' });
});

test('stale disk entries are refetched after 30 days', async () => {
  let calls = 0;
  let t = 0;
  const fs = memoryFs();
  const fetcher = () => createSmrRecordFetcher({ fetchImpl: async () => { calls++; return reply('X'); }, fs, cacheDir: '/c', now: () => t });
  await fetcher().get('MA070-110----');
  t = 31 * 24 * 3600 * 1000;
  await fetcher().get('MA070-110----');
  assert.equal(calls, 2);
});
