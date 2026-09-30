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

test('the budget is a sliding 60 s window over the last calls', async () => {
  let t = 0;
  const ids = ['MA002-001----', 'MA002-002----', 'MA002-003----', 'MA002-004----'];
  const fetcher = createSmrRecordFetcher({ fetchImpl: async () => reply('X'), fs: memoryFs(), cacheDir: '/c', budgetPerMinute: 2, now: () => t });
  await fetcher.get(ids[0]);
  t = 30_000;
  await fetcher.get(ids[1]);
  t = 59_000;
  await assert.rejects(fetcher.get(ids[2]), { code: 'SMR_UPSTREAM_BUSY' });
  t = 60_500;
  assert.equal((await fetcher.get(ids[2])).cached, false);
  // A fixed window would have reset at 60.5 s; the 30 s call still counts.
  t = 61_000;
  await assert.rejects(fetcher.get(ids[3]), { code: 'SMR_UPSTREAM_BUSY' });
  t = 90_500;
  assert.equal((await fetcher.get(ids[3])).cached, false);
});

test('an upstream HTTP 429 cools down for 60 s without calling upstream', async () => {
  let t = 0;
  let calls = 0;
  let status = 429;
  const fetcher = createSmrRecordFetcher({
    fetchImpl: async () => { calls++; return status === 200 ? reply('X') : new Response('slow down', { status }); },
    fs: memoryFs(), cacheDir: '/c', now: () => t,
  });
  await assert.rejects(fetcher.get('MA003-001----'), { code: 'SMR_UPSTREAM_BUSY' });
  assert.equal(calls, 1);
  t = 30_000;
  await assert.rejects(fetcher.get('MA003-002----'), { code: 'SMR_UPSTREAM_BUSY' });
  assert.equal(calls, 1);
  t = 60_000;
  status = 200;
  assert.equal((await fetcher.get('MA003-002----')).cached, false);
  assert.equal(calls, 2);
});

test('an upstream 500 rejects with a plain error, not busy', async () => {
  const fetcher = createSmrRecordFetcher({ fetchImpl: async () => new Response('oops', { status: 500 }), fs: memoryFs(), cacheDir: '/c', now: () => 0 });
  await assert.rejects(fetcher.get('MA004-001----'), (error) => {
    assert.ok(error instanceof Error);
    assert.notEqual(error.code, 'SMR_UPSTREAM_BUSY');
    return true;
  });
});

test('a request that arrives while the disk read is pending joins the in-flight fetch', async () => {
  let calls = 0;
  const fs = memoryFs();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  // The first read starts before any cache file exists but resolves late.
  const slowFs = {
    ...fs,
    readFile: async (file) => {
      if (reads++ > 0) return fs.readFile(file);
      const result = fs.readFile(file).then((text) => ({ text }), (error) => ({ error }));
      await gate;
      const { text, error } = await result;
      if (error) throw error;
      return text;
    },
  };
  const fetcher = createSmrRecordFetcher({ fetchImpl: async () => { calls++; return reply('X'); }, fs: slowFs, cacheDir: '/c', now: () => 0 });
  const first = fetcher.get('MA070-110----');
  await fetcher.get('MA070-110----');
  release();
  assert.equal((await first).description, 'X');
  assert.equal(calls, 1);
});
