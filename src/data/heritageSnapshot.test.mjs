import test from 'node:test';
import assert from 'node:assert/strict';
import {
  smrPageUrl,
  normalizeSmrAttributes,
  buildSmrSnapshot,
  validateSmrSnapshot,
  downloadSmrSnapshot,
  writeSmrSnapshot,
  loadSmrSnapshotFile,
} from '../../server/providers/heritage/snapshot.js';
import os from 'node:os';
import path from 'node:path';

const LINK = (smrs) =>
  `https://heritagedata.maps.arcgis.com/apps/webappviewer/index.html?id=x&query=layer%2CSMRS%2C${smrs}`;
const attrs = (n, extra = {}) => ({
  OBJECTID: n,
  SMRS: `MA076-${String(n).padStart(3, '0')}----`,
  MONUMENT_CLASS: n % 2 ? 'Ringfort - rath' : 'Castle - tower house',
  COUNTY: 'MAYO',
  TOWNLAND: 'ARDKEEN',
  LATITUDE: 53.8 + n / 1e4,
  LONGITUDE: -9.6,
  WEBSITE_LINK: LINK(`MA076-${String(n).padStart(3, '0')}----`),
  ...extra,
});

test('page URL targets the fixed service with paging and no geometry', () => {
  const url = new URL(smrPageUrl(4000, 2000));
  assert.equal(url.hostname, 'services-eu1.arcgis.com');
  assert.equal(url.searchParams.get('resultOffset'), '4000');
  assert.equal(url.searchParams.get('resultRecordCount'), '2000');
  assert.equal(url.searchParams.get('returnGeometry'), 'false');
  assert.equal(url.searchParams.get('orderByFields'), 'OBJECTID');
});

test('normalisation title-cases names and rejects bad or out-of-Ireland points', () => {
  const r = normalizeSmrAttributes(attrs(1));
  assert.equal(r.county, 'Mayo');
  assert.equal(r.townland, 'Ardkeen');
  assert.equal(normalizeSmrAttributes(attrs(1, { LATITUDE: 0, LONGITUDE: 0 })), null);
  assert.equal(normalizeSmrAttributes(attrs(1, { SMRS: '' })), null);
  assert.equal(normalizeSmrAttributes(attrs(1, { LATITUDE: 'x' })), null);
});

test('snapshot build indexes classes and counties and detects the link template', () => {
  const records = [1, 2, 3].map((n) => normalizeSmrAttributes(attrs(n)));
  const snap = buildSmrSnapshot(records, { fetchedAt: '2026-09-29T00:00:00Z' });
  assert.deepEqual(snap.classes, ['Castle - tower house', 'Ringfort - rath']);
  assert.equal(snap.rows.length, 3);
  assert.equal(snap.linkTemplate, LINK('{SMRS}'));
  assert.equal(validateSmrSnapshot(snap), snap);
});

test('duplicate SMR numbers keep the first record', () => {
  const a = normalizeSmrAttributes(attrs(1));
  const b = { ...a, townland: 'Other' };
  assert.equal(buildSmrSnapshot([a, b], { fetchedAt: 'x' }).rows.length, 1);
});

test('validation rejects malformed snapshots', () => {
  assert.throws(() => validateSmrSnapshot({ version: 2 }), /invalid_smr_snapshot/);
  const snap = buildSmrSnapshot([normalizeSmrAttributes(attrs(1))], { fetchedAt: 'x' });
  snap.rows[0][1] = 99;
  assert.throws(() => validateSmrSnapshot(snap), /invalid_smr_snapshot/);
});

test('download pages until a short page, pausing between pages', async () => {
  const pauses = [];
  const pages = [
    { features: [1, 2].map((n) => ({ attributes: attrs(n) })), exceededTransferLimit: true },
    { features: [3].map((n) => ({ attributes: attrs(n) })) },
  ];
  const snap = await downloadSmrSnapshot({
    fetchImpl: async () => Response.json(pages.shift()),
    sleep: async (ms) => pauses.push(ms),
    pageSize: 2,
    minRecords: 1,
  });
  assert.equal(snap.rows.length, 3);
  assert.deepEqual(pauses, [3000]);
});

test('download backs off on HTTP 429 and on an ArcGIS JSON 429, then succeeds', async () => {
  const pauses = [];
  const replies = [
    new Response('busy', { status: 429 }),
    Response.json({ error: { code: 429, message: 'quota' } }),
    Response.json({ features: [{ attributes: attrs(1) }] }),
  ];
  const snap = await downloadSmrSnapshot({
    fetchImpl: async () => replies.shift(),
    sleep: async (ms) => pauses.push(ms),
    minRecords: 1,
  });
  assert.equal(snap.rows.length, 1);
  assert.deepEqual(pauses, [65000, 65000]);
});

test('download gives up after five rate-limited attempts', async () => {
  await assert.rejects(
    downloadSmrSnapshot({
      fetchImpl: async () => new Response('busy', { status: 429 }),
      sleep: async () => {},
      minRecords: 1,
    }),
    /rate limited/,
  );
});

test('a suspiciously small download is rejected', async () => {
  await assert.rejects(
    downloadSmrSnapshot({
      fetchImpl: async () => Response.json({ features: [{ attributes: attrs(1) }] }),
      sleep: async () => {},
    }),
    /too small/,
  );
});

test('write goes to a temporary file first, then renames over the target', async () => {
  const calls = [];
  const fs = {
    mkdir: async (dir) => calls.push(['mkdir', dir]),
    writeFile: async (file) => calls.push(['writeFile', file]),
    rename: async (from, to) => calls.push(['rename', from, to]),
  };
  await writeSmrSnapshot({ version: 1 }, '/x/smr/snapshot.json', fs);
  assert.deepEqual(calls, [
    ['mkdir', '/x/smr'],
    ['writeFile', '/x/smr/snapshot.json.tmp'],
    ['rename', '/x/smr/snapshot.json.tmp', '/x/smr/snapshot.json'],
  ]);
});

test('a missing snapshot file is reported as SMR_SNAPSHOT_MISSING', async () => {
  const missing = path.join(os.tmpdir(), `gev-smr-missing-${process.pid}-${Date.now()}`, 'snapshot.json');
  await assert.rejects(loadSmrSnapshotFile(missing), { code: 'SMR_SNAPSHOT_MISSING' });
});
