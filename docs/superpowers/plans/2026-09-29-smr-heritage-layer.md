# SMR Heritage Layer and Voice Queries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Monuments (SMR)" map layer and a `heritage_query` voice tool to God's Eye View, so a user can see Irish national monuments on the globe and ask "how many ringforts are in view" or "take me to the nearest tower house".

**Architecture:** A one-off script downloads the National Monuments Service Sites and Monuments Record (151,308 records) into a local snapshot file. A new dev/preview server route loads that snapshot into an in-memory grid index and answers bounded point, count, and nearest queries, so the government service is never queried at runtime. A viewport-driven Cesium layer draws points coloured by monument family, and a voice tool calls the same server route and hands coordinates to the existing `fly_to_location` tool.

**Tech Stack:** Node 24, Vite 6 plugin middleware, CesiumJS entities, `node:test`, OpenAI Realtime tool schemas.

**Spec:** No separate spec document. The design was agreed in conversation on 2026-09-29 and is recorded in "Design decisions" below. Executors read this whole file.

## Design decisions

1. **Local snapshot, not a live proxy.** The upstream ArcGIS account enforces 3,000 request units per minute, shared by every consumer (observed HTTP 429: "API calls quota exceeded (3229 request units)! maximum allowed request units (3000) per Minute"). Only `npm run smr:snapshot` contacts it.
2. **Dedicated voice tool.** `analyst_query` reads layer records synchronously, caps them at 2,000, treats "view" as a radius, and never returns coordinates (`src/data/analystEngine.js:206`, `src/voice/gevActions.js:4338-4373`). `heritage_query` is separate and leaves `analyst_query` untouched.
3. **"Take me to" reuses `fly_to_location`.** `heritage_query` returns latitude and longitude; the model then calls `fly_to_location`. No new camera code.
4. **Coverage.** The SMR covers the Republic of Ireland only. Zero results always carry a coverage note so the model does not claim an area has no monuments.
5. **Descriptions.** Most SMR records have no public description (the `WEB_NOTES` field is a boilerplate "not uploaded" message), so the snapshot omits notes. The model describes the monument class in general terms and must say so.

## Global Constraints

- Node 24.x (`nvm use 24`). CI runs Node 24.14.0 and 26.x.
- Unit tests are `*.test.mjs` files under `src/` only (`scripts/run-unit-tests.mjs:25-39` scans `src/`). Server modules are tested from `src/data/*.test.mjs`, as `src/data/firePerimetersProxy.test.mjs` does.
- `src/**/*.js` must not import `node:*` (`src/browserModuleBoundary.test.mjs`). `src/` may not import `server/`. `server/providers/` may import `src/`.
- Server routes fetch no client-supplied URLs, return sanitized errors, and send `Cache-Control: no-store` (SECURITY.md:60-73).
- Attribution text, verbatim: `National Monuments Service, Government of Ireland`. Licence: `CC BY 4.0`. Credit URL: `https://www.archaeology.ie/collections-and-publications/open-data/`.
- Snapshot path: `.gev-cache/smr/snapshot.json` (`.gev-cache/` is already in `.gitignore:16`). Never commit it.
- Snapshot download: pause 3,000 ms between pages, back off 65,000 ms on HTTP 429 or an ArcGIS JSON error with code 429, at most 5 attempts per page.
- Identifiers: layer id `heritage-smr`, API prefix `/api/heritage/smr`, voice tool `heritage_query`, credit key `nms-smr`.
- Formatting: run `npm run format` before each commit; CI runs `npm run format:check`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage only the files each task names. The working tree also holds local, untracked files (`LOCAL-SETUP.md`, `public/scene-assets/clew-bay/`) that must not be committed.

## Review Focus

1. **Snapshot not downloaded yet.** The layer row must say "SMR snapshot missing: run npm run smr:snapshot" and voice must tell the user the same, not fail silently. Tests: Task 4 (503 body), Task 5 (layer status), Task 7 (voice message).
2. **Camera looking at the horizon or zoomed out over all of Ireland.** `computeViewRectangle` returns `undefined` or a huge box. The layer must show "Zoom in to see monuments" and voice counts must fall back to a radius. Tests: Task 5 (`viewBox` returns null), Task 7 (radius fallback).
3. **Camera outside the Republic (London, Belfast).** A zero count must carry the coverage note. Test: Task 7.
4. **Spoken types the vocabulary does not know ("forts", "abbeys", "dolmens").** The tool description maps them; the server rejects unknown keys with a 400 naming them, and the voice handler drops unknown keys before calling. Tests: Task 1 (`parseHeritageTypes`), Task 4 (400), Task 7 (dropped keys).
5. **Snapshot download interrupted.** A failed or partial download must not replace a good snapshot. Tests: Task 2 (retry, then rejection; atomic write order).

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `src/data/heritageClasses.js` | Create | Spoken type vocabulary, family colours, type parsing. Pure, shared by browser, server, and tests |
| `server/providers/heritage/snapshot.js` | Create | Page URL, record normalisation, snapshot build/validate/load/write, paged download |
| `scripts/smr-snapshot.mjs` | Create | CLI wrapper: download, write, report unmatched vocabulary |
| `server/providers/heritage/smrIndex.js` | Create | Grid index with `points`, `stats`, `nearest` |
| `server/providers/heritage.js` | Create | Vite plugin for `/api/heritage/smr/{status,points,stats,nearest}` |
| `server/providers/local.js` | Modify | Register the plugin |
| `src/layers/heritage/policy.js` | Create | Layer constants |
| `src/layers/heritage/source.js` | Create | Browser fetch of `/points` and response validation |
| `src/layers/heritage/index.js` | Create | Cesium layer: viewport loading, rendering, selection, stats |
| `src/app/layers/heritage.js` | Create | Inject application services |
| `src/app/constructCatalog.js`, `src/standalone/layerSources.js` | Modify | Register source and layer |
| `src/data/layerState.js`, `src/data/layerStateTokenReservations.json` | Modify | Layer state token |
| `src/ui/layerPanel.js`, `src/ui/styles/cyber.css` | Modify | Panel group, label, icon |
| `src/data/dataCredits.js`, `DATA_SOURCES.md`, `SECURITY.md` | Modify | Attribution and proxy documentation |
| `src/voice/heritageQuery.js` | Create | Voice tool handler |
| `src/voice/actionSchemas.js`, `src/voice/gevActions.js` | Modify | Tool schema, enums, aliases, dispatch |
| `server/providers/openai/toolDescriptions.js`, `server/providers/openai/instructions.js` | Modify | Model guidance |
| `package.json` | Modify | `smr:snapshot` script |
| `docs/CURRENT-STATE.md` | Modify | Layer table row |

---

### Task 0: Fork and branch

**Files:** none.

- [ ] **Step 1: Confirm with James before forking.** Forking creates a public GitHub repository under his account. Ask, and wait for a yes.

- [ ] **Step 2: Fork and re-point remotes**

Run from `~/Projects/gods-eye-view`:
```bash
gh repo fork bilawalsidhu/gods-eye-view --remote --remote-name origin
git remote -v
```
Expected: `origin` points at `jamesfmcgrath/gods-eye-view` (or James's account), `upstream` at `bilawalsidhu/gods-eye-view`.

- [ ] **Step 3: Branch and baseline**
```bash
git switch -c feat/smr-heritage-layer
nvm use 24
npm ci
npm test
```
Expected: the full suite passes before any change. If it does not, stop and report which tests fail; do not start Task 1 on a red baseline.

---

### Task 1: Monument type vocabulary

**Files:**
- Create: `src/data/heritageClasses.js`
- Test: `src/data/heritageClasses.test.mjs`

**Interfaces:**
- Produces: `HERITAGE_TYPES` (object keyed by type key, each `{ label: string, match(monumentClass: string): boolean }`), `HERITAGE_TYPE_KEYS: string[]`, `MAX_HERITAGE_TYPES = 8`, `classMatchesTypes(monumentClass, keys): boolean`, `parseHeritageTypes(value): { ok: true, keys: string[] } | { ok: false, error: 'too_many_types' | 'unknown_type', unknown?: string[] }`, `heritageFamily(monumentClass): 'ringfort'|'castle'|'ecclesiastical'|'ritual'|'other'`, `HERITAGE_FAMILY_COLORS`.

Class names below were verified against the live service on 2026-09-29 (470 distinct classes).

- [ ] **Step 1: Write the failing test**

`src/data/heritageClasses.test.mjs`:
```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/data/heritageClasses.test.mjs`
Expected: FAIL, `Cannot find module ... heritageClasses.js`.

- [ ] **Step 3: Write the implementation**

`src/data/heritageClasses.js`:
```js
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
  'high-cross': { label: 'high crosses', match: startsWith('Cross - High cross') },
  church: {
    label: 'churches',
    match: (value) => value === 'Church' || value === 'Church (present location)',
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

export const HERITAGE_FAMILY_COLORS = Object.freeze({
  ringfort: '#d9a441',
  castle: '#e2574c',
  ecclesiastical: '#6fa8ff',
  ritual: '#b388ff',
  other: '#9ca6b0',
});

/** Colour family for a class; colour is never the only cue (labels carry the class). */
export function heritageFamily(monumentClass) {
  if (typeof monumentClass !== 'string') return 'other';
  for (const [family, rule] of FAMILY_RULES)
    if (rule(monumentClass)) return family;
  return 'other';
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test src/data/heritageClasses.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Format and commit**
```bash
npm run format
git add src/data/heritageClasses.js src/data/heritageClasses.test.mjs
git commit -m "feat(heritage): add SMR monument type vocabulary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Snapshot download and storage

**Files:**
- Create: `server/providers/heritage/snapshot.js`
- Create: `scripts/smr-snapshot.mjs`
- Modify: `package.json` (`scripts`)
- Test: `src/data/heritageSnapshot.test.mjs`

**Interfaces:**
- Consumes: `HERITAGE_TYPES` (Task 1).
- Produces:
  - `SMR_SNAPSHOT_PATH: string`, `SMR_ATTRIBUTION`, `SMR_LICENCE`
  - `smrPageUrl(offset: number, pageSize?: number): string`
  - `normalizeSmrAttributes(attributes): { smrs, monumentClass, county, townland, latitude, longitude, link } | null`
  - `buildSmrSnapshot(records, { fetchedAt }): Snapshot`
  - `validateSmrSnapshot(value): Snapshot` (throws `Error('invalid_smr_snapshot')`)
  - `downloadSmrSnapshot({ fetchImpl, sleep, pageSize?, pauseMs?, maxPages?, minRecords?, log?, now? }): Promise<Snapshot>` (`minRecords` defaults to 100,000; tests lower it)
  - `writeSmrSnapshot(snapshot, filePath, fs?): Promise<void>`
  - `loadSmrSnapshotFile(filePath): Promise<object>` (throws an error with `code === 'SMR_SNAPSHOT_MISSING'` when absent)
  - `Snapshot = { version: 1, source, licence, attribution, fetchedAt, linkTemplate: string|null, classes: string[], counties: string[], rows: [smrs, classIndex, countyIndex, townland, latitude, longitude][] }`

- [ ] **Step 1: Write the failing test**

`src/data/heritageSnapshot.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  smrPageUrl,
  normalizeSmrAttributes,
  buildSmrSnapshot,
  validateSmrSnapshot,
  downloadSmrSnapshot,
  writeSmrSnapshot,
} from '../../server/providers/heritage/snapshot.js';

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/data/heritageSnapshot.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

`server/providers/heritage/snapshot.js`:
```js
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';

export const SMR_QUERY_URL =
  'https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/arcgis/rest/services/' +
  'SMROpenData/FeatureServer/0/query';
export const SMR_SNAPSHOT_PATH = path.join(
  process.cwd(),
  '.gev-cache',
  'smr',
  'snapshot.json',
);
export const SMR_ATTRIBUTION = 'National Monuments Service, Government of Ireland';
export const SMR_LICENCE = 'CC-BY-4.0';

const FIELDS =
  'OBJECTID,SMRS,MONUMENT_CLASS,COUNTY,TOWNLAND,LATITUDE,LONGITUDE,WEBSITE_LINK';
const USER_AGENT =
  'gods-eye-view-smr-snapshot/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
// Island of Ireland with a margin; rejects zero, swapped or projected values.
const BOUNDS = { south: 51.2, north: 55.6, west: -11.0, east: -5.3 };
const RATE_LIMIT_WAIT_MS = 65_000;
const MAX_ATTEMPTS = 5;

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const titleCase = (value) =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
    : '';

export function smrPageUrl(offset, pageSize = 2000) {
  return `${SMR_QUERY_URL}?${new URLSearchParams({
    where: '1=1',
    outFields: FIELDS,
    returnGeometry: 'false',
    orderByFields: 'OBJECTID',
    resultOffset: String(offset),
    resultRecordCount: String(pageSize),
    f: 'json',
  })}`;
}

export function normalizeSmrAttributes(attributes) {
  const lat = Number(attributes?.LATITUDE);
  const lon = Number(attributes?.LONGITUDE);
  const smrs = typeof attributes?.SMRS === 'string' ? attributes.SMRS.trim() : '';
  const monumentClass =
    typeof attributes?.MONUMENT_CLASS === 'string'
      ? attributes.MONUMENT_CLASS.trim()
      : '';
  if (!smrs || !monumentClass || !Number.isFinite(lat) || !Number.isFinite(lon))
    return null;
  if (
    lat < BOUNDS.south ||
    lat > BOUNDS.north ||
    lon < BOUNDS.west ||
    lon > BOUNDS.east
  )
    return null;
  return {
    smrs,
    monumentClass,
    county: titleCase(attributes.COUNTY),
    townland: titleCase(attributes.TOWNLAND),
    latitude: round6(lat),
    longitude: round6(lon),
    link:
      typeof attributes.WEBSITE_LINK === 'string' ? attributes.WEBSITE_LINK : null,
  };
}

export function buildSmrSnapshot(records, { fetchedAt }) {
  const unique = [];
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.smrs)) continue;
    seen.add(record.smrs);
    unique.push(record);
  }
  const classes = [...new Set(unique.map((r) => r.monumentClass))].sort();
  const counties = [...new Set(unique.map((r) => r.county))].sort();
  const classIndex = new Map(classes.map((c, i) => [c, i]));
  const countyIndex = new Map(counties.map((c, i) => [c, i]));
  // Store one link pattern instead of 151k near-identical URLs when possible.
  const sample = unique.find((r) => r.link && r.link.includes(r.smrs));
  const template = sample ? sample.link.replace(sample.smrs, '{SMRS}') : null;
  const templated =
    template &&
    unique.every((r) => !r.link || r.link === template.replace('{SMRS}', r.smrs));
  return {
    version: 1,
    source: SMR_QUERY_URL,
    licence: SMR_LICENCE,
    attribution: SMR_ATTRIBUTION,
    fetchedAt,
    linkTemplate: templated ? template : null,
    classes,
    counties,
    rows: unique.map((r) => [
      r.smrs,
      classIndex.get(r.monumentClass),
      countyIndex.get(r.county),
      r.townland,
      r.latitude,
      r.longitude,
    ]),
  };
}

export function validateSmrSnapshot(value) {
  const bad = () => {
    throw new Error('invalid_smr_snapshot');
  };
  if (
    value?.version !== 1 ||
    !Array.isArray(value.classes) ||
    !Array.isArray(value.counties) ||
    !Array.isArray(value.rows)
  )
    bad();
  for (const row of value.rows) {
    if (
      !Array.isArray(row) ||
      row.length !== 6 ||
      typeof row[0] !== 'string' ||
      !Number.isInteger(row[1]) ||
      row[1] < 0 ||
      row[1] >= value.classes.length ||
      !Number.isInteger(row[2]) ||
      row[2] < 0 ||
      row[2] >= value.counties.length ||
      !Number.isFinite(row[4]) ||
      !Number.isFinite(row[5])
    )
      bad();
  }
  return value;
}

async function fetchPage(url, { fetchImpl, sleep }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      await response.body?.cancel();
    } else {
      if (!response.ok) throw new Error(`SMR service HTTP ${response.status}`);
      const body = await response.json();
      // ArcGIS reports quota errors inside a 200 JSON body.
      if (body?.error?.code !== 429) {
        if (body?.error) throw new Error(`SMR service error ${body.error.code}`);
        return body;
      }
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RATE_LIMIT_WAIT_MS);
  }
  throw new Error('SMR service rate limited; try again later');
}

export async function downloadSmrSnapshot({
  fetchImpl,
  sleep,
  pageSize = 2000,
  pauseMs = 3000,
  maxPages = 200,
  minRecords = 100_000,
  log = () => {},
  now = () => new Date().toISOString(),
}) {
  const records = [];
  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await sleep(pauseMs);
    const body = await fetchPage(smrPageUrl(page * pageSize, pageSize), {
      fetchImpl,
      sleep,
    });
    if (!Array.isArray(body?.features)) throw new Error('SMR page has no features');
    for (const feature of body.features) {
      const record = normalizeSmrAttributes(feature?.attributes);
      if (record) records.push(record);
    }
    log(`page ${page + 1}: ${records.length} records`);
    if (body.features.length < pageSize && body.exceededTransferLimit !== true) {
      if (records.length < minRecords)
        throw new Error(`SMR snapshot too small (${records.length} records)`);
      return buildSmrSnapshot(records, { fetchedAt: now() });
    }
  }
  throw new Error('SMR download exceeded the page limit');
}

export async function writeSmrSnapshot(snapshot, filePath, fs = nodeFs) {
  const temporary = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temporary, JSON.stringify(snapshot));
  await fs.rename(temporary, filePath);
}

export async function loadSmrSnapshotFile(filePath) {
  let text;
  try {
    text = await nodeFs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT')
      throw Object.assign(new Error('smr_snapshot_missing'), {
        code: 'SMR_SNAPSHOT_MISSING',
      });
    throw error;
  }
  return JSON.parse(text);
}
```

`scripts/smr-snapshot.mjs`:
```js
#!/usr/bin/env node
// Download the National Monuments Service Sites and Monuments Record into
// .gev-cache/smr/snapshot.json. This is the only code that contacts the
// shared, quota-limited SMR service; the app reads the local file.
import {
  downloadSmrSnapshot,
  writeSmrSnapshot,
  SMR_SNAPSHOT_PATH,
} from '../server/providers/heritage/snapshot.js';
import { HERITAGE_TYPES } from '../src/data/heritageClasses.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const snapshot = await downloadSmrSnapshot({
  fetchImpl: (...args) => fetch(...args),
  sleep,
  log: (message) => console.log(message),
});
await writeSmrSnapshot(snapshot, SMR_SNAPSHOT_PATH);
console.log(
  `Wrote ${snapshot.rows.length} records (${snapshot.classes.length} classes) to ${SMR_SNAPSHOT_PATH}`,
);
const unmatched = Object.entries(HERITAGE_TYPES)
  .filter(([, type]) => !snapshot.classes.some((c) => type.match(c)))
  .map(([key]) => key);
if (unmatched.length)
  console.warn(`Voice types with no matching class: ${unmatched.join(', ')}`);
```

`package.json`, add to `scripts` after `"qa:transit"`:
```json
"smr:snapshot": "node scripts/smr-snapshot.mjs"
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/data/heritageSnapshot.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Run the real download once**

Run: `npm run smr:snapshot`
Expected: about 76 "page N" lines over 4 to 5 minutes, then `Wrote 151xxx records (470 classes) to .../.gev-cache/smr/snapshot.json`, and no "Voice types with no matching class" warning. If that warning appears, fix the named entries in `src/data/heritageClasses.js` to match the class names in the snapshot, rerun Task 1's tests, and amend Task 1's commit in a new commit. Run this step only once; it uses the shared quota.

- [ ] **Step 6: Format and commit**
```bash
npm run format
git add server/providers/heritage/snapshot.js scripts/smr-snapshot.mjs package.json src/data/heritageSnapshot.test.mjs
git commit -m "feat(heritage): download the SMR into a local snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Spatial index

**Files:**
- Create: `server/providers/heritage/smrIndex.js`
- Test: `src/data/heritageSmrIndex.test.mjs`

**Interfaces:**
- Consumes: `Snapshot` (Task 2), `classMatchesTypes` (Task 1), `haversineKm(lat1, lon1, lat2, lon2)` from `server/providers/common/geo.js:10`.
- Produces: `createSmrIndex(snapshot)` returning:
  - `count: number`, `bounds: { south, west, north, east }`, `fetchedAt: string`
  - `points({ box, types, limit }): { total, saturated, records: SmrRecord[] }`
  - `stats({ box?, circle?, types }): { total, byClass: { monumentClass, count }[], classCount }` (`byClass` holds the top 12)
  - `nearest({ lat, lon, types, limit, maxKm }): { total, records: (SmrRecord & { distanceKm })[] }`
  - `SmrRecord = { id: 'smr:<SMRS>', smrs, monumentClass, county, townland, latitude, longitude, link: string|null }`

- [ ] **Step 1: Write the failing test**

`src/data/heritageSmrIndex.test.mjs`:
```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/data/heritageSmrIndex.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

`server/providers/heritage/smrIndex.js`:
```js
import { haversineKm } from '../common/geo.js';
import { classMatchesTypes } from '../../../src/data/heritageClasses.js';

const CELL_DEG = 0.1;
const cellOf = (deg) => Math.floor(deg / CELL_DEG);
const TOP_CLASSES = 12;

/** In-memory grid index over a validated SMR snapshot. */
export function createSmrIndex(snapshot) {
  const { rows, classes, counties, linkTemplate, fetchedAt } = snapshot;
  const grid = new Map();
  const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
  rows.forEach((row, i) => {
    const key = `${cellOf(row[4])}:${cellOf(row[5])}`;
    let cell = grid.get(key);
    if (!cell) grid.set(key, (cell = []));
    cell.push(i);
    bounds.south = Math.min(bounds.south, row[4]);
    bounds.north = Math.max(bounds.north, row[4]);
    bounds.west = Math.min(bounds.west, row[5]);
    bounds.east = Math.max(bounds.east, row[5]);
  });

  const masks = new Map();
  function classMask(types = []) {
    const key = types.join(',');
    if (!masks.has(key))
      masks.set(key, classes.map((c) => classMatchesTypes(c, types)));
    return masks.get(key);
  }

  function* inBox(box) {
    for (let a = cellOf(box.south); a <= cellOf(box.north); a++) {
      for (let b = cellOf(box.west); b <= cellOf(box.east); b++) {
        const cell = grid.get(`${a}:${b}`);
        if (!cell) continue;
        for (const i of cell) {
          const r = rows[i];
          if (r[4] >= box.south && r[4] <= box.north && r[5] >= box.west && r[5] <= box.east)
            yield i;
        }
      }
    }
  }

  function circleBox({ lat, lon, km }) {
    const dLat = km / 111.32;
    const dLon = km / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
  }

  function matching({ box, circle, types }) {
    const mask = classMask(types);
    const found = [];
    for (const i of inBox(box || circleBox(circle))) {
      if (!mask[rows[i][1]]) continue;
      if (circle && haversineKm(circle.lat, circle.lon, rows[i][4], rows[i][5]) > circle.km)
        continue;
      found.push(i);
    }
    return found;
  }

  function sortByDistance(ids, point) {
    const distance = new Map(
      ids.map((i) => [i, haversineKm(point.lat, point.lon, rows[i][4], rows[i][5])]),
    );
    ids.sort((a, b) => distance.get(a) - distance.get(b) || (rows[a][0] < rows[b][0] ? -1 : 1));
    return distance;
  }

  function toRecord(i, distance) {
    const [smrs, c, co, townland, latitude, longitude] = rows[i];
    const record = {
      id: `smr:${smrs}`,
      smrs,
      monumentClass: classes[c],
      county: counties[co],
      townland,
      latitude,
      longitude,
      link: linkTemplate ? linkTemplate.replace('{SMRS}', smrs) : null,
    };
    if (distance) record.distanceKm = Math.round(distance.get(i) * 10) / 10;
    return record;
  }

  return {
    count: rows.length,
    bounds,
    fetchedAt,
    points({ box, types, limit }) {
      const ids = matching({ box, types });
      if (ids.length > limit)
        sortByDistance(ids, {
          lat: (box.south + box.north) / 2,
          lon: (box.west + box.east) / 2,
        });
      return {
        total: ids.length,
        saturated: ids.length > limit,
        records: ids.slice(0, limit).map((i) => toRecord(i)),
      };
    },
    stats({ box, circle, types }) {
      const counts = new Map();
      const ids = matching({ box, circle, types });
      for (const i of ids) counts.set(rows[i][1], (counts.get(rows[i][1]) || 0) + 1);
      const byClass = [...counts]
        .map(([c, count]) => ({ monumentClass: classes[c], count }))
        .sort((a, b) => b.count - a.count || a.monumentClass.localeCompare(b.monumentClass));
      return { total: ids.length, byClass: byClass.slice(0, TOP_CLASSES), classCount: byClass.length };
    },
    nearest({ lat, lon, types, limit, maxKm }) {
      const ids = matching({ circle: { lat, lon, km: maxKm }, types });
      const distance = sortByDistance(ids, { lat, lon });
      return { total: ids.length, records: ids.slice(0, limit).map((i) => toRecord(i, distance)) };
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test src/data/heritageSmrIndex.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check performance against the real snapshot**

Run:
```bash
node -e "
import('./server/providers/heritage/snapshot.js').then(async (s) => {
  const { createSmrIndex } = await import('./server/providers/heritage/smrIndex.js');
  let t = performance.now();
  const index = createSmrIndex(s.validateSmrSnapshot(await s.loadSmrSnapshotFile(s.SMR_SNAPSHOT_PATH)));
  console.log('build ms', Math.round(performance.now() - t), 'count', index.count);
  t = performance.now();
  console.log(index.stats({ box: { south: 51.3, west: -10.7, north: 55.5, east: -5.9 }, types: ['ringfort'] }).total, 'ringforts; stats ms', Math.round(performance.now() - t));
  t = performance.now();
  console.log(index.nearest({ lat: 53.88, lon: -9.55, types: ['tower-house'], limit: 1, maxKm: 150 }).records[0], 'nearest ms', Math.round(performance.now() - t));
});"
```
Expected: count about 151,000, build under 1,000 ms, about 31,000 ringforts (26,000 raths + 3,551 cashels + 1,880 unclassified), each query under 200 ms. If a query is slower, report the numbers before optimising.

- [ ] **Step 6: Format and commit**
```bash
npm run format
git add server/providers/heritage/smrIndex.js src/data/heritageSmrIndex.test.mjs
git commit -m "feat(heritage): add grid index for SMR point, count and nearest queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server route `/api/heritage/smr`

**Files:**
- Create: `server/providers/heritage.js`
- Modify: `server/providers/local.js` (imports at lines 1-27, plugin array at lines 30-59)
- Modify: `SECURITY.md` ("Server-side proxy hardening", lines 60-73)
- Test: `src/data/heritageSmrProxy.test.mjs`

**Interfaces:**
- Consumes: `createSmrIndex` (Task 3), `loadSmrSnapshotFile`, `validateSmrSnapshot`, `SMR_SNAPSHOT_PATH` (Task 2), `parseHeritageTypes` (Task 1), `makeRateLimiter({ windowMs, max, globalMax })` and `clientKey(req)` from `server/providers/common/rate-limit.js`.
- Produces: `heritageProxy({ loadSnapshot? })`, a Vite plugin serving:
  - `GET /api/heritage/smr/status` → `{ ready: true, count, bounds, fetchedAt, attribution, licence }`
  - `GET /api/heritage/smr/points?south&west&north&east[&types][&limit]` → `{ total, saturated, records, ...meta }` (box span at most 1.5°, limit 1 to 1500, default 1000)
  - `GET /api/heritage/smr/stats?(south&west&north&east | lat&lon&km)[&types]` → `{ total, byClass, classCount, ...meta }` (box span at most 12°, km 0.1 to 500)
  - `GET /api/heritage/smr/nearest?lat&lon[&types][&limit][&maxKm]` → `{ total, records, ...meta }` (limit 1 to 10, default 3; maxKm 1 to 300, default 150)
  - `meta = { fetchedAt, bounds, attribution, licence }`
  - Errors: 400 `invalid_box` / `invalid_scope` / `invalid_point` / `unknown_type` (with `unknown`) / `too_many_types`; 404 `unknown_route`; 405; 429 `rate_limited`; 503 `smr_snapshot_missing` with `hint`; 500 `heritage_unavailable`.

- [ ] **Step 1: Write the failing test**

`src/data/heritageSmrProxy.test.mjs`:
```js
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
  assert.equal(res.json.count, 2);
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/data/heritageSmrProxy.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

`server/providers/heritage.js`:
```js
import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { createSmrIndex } from './heritage/smrIndex.js';
import {
  loadSmrSnapshotFile,
  validateSmrSnapshot,
  SMR_SNAPSHOT_PATH,
  SMR_ATTRIBUTION,
  SMR_LICENCE,
} from './heritage/snapshot.js';
import { parseHeritageTypes } from '../../src/data/heritageClasses.js';

const ROUTES = new Set(['/status', '/points', '/stats', '/nearest']);
const POINTS_MAX_SPAN_DEG = 1.5;
const STATS_MAX_SPAN_DEG = 12;

function numberParam(params, key, min, max) {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function intParam(params, key, min, max, fallback) {
  const value = Number.parseInt(params.get(key) ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function readBox(params, maxSpan) {
  const south = numberParam(params, 'south', -90, 90);
  const north = numberParam(params, 'north', -90, 90);
  const west = numberParam(params, 'west', -180, 180);
  const east = numberParam(params, 'east', -180, 180);
  if ([south, north, west, east].includes(null)) return null;
  if (south >= north || west >= east) return null;
  if (north - south > maxSpan || east - west > maxSpan) return null;
  return { south, west, north, east };
}

/** Local-snapshot SMR queries for dev and preview; never contacts the SMR service. */
export function heritageProxy({
  loadSnapshot = () => loadSmrSnapshotFile(SMR_SNAPSHOT_PATH),
} = {}) {
  let indexPromise = null;
  const allow = makeRateLimiter({ windowMs: 60_000, max: 240, globalMax: 2400 });

  function getIndex() {
    if (!indexPromise) {
      indexPromise = (async () =>
        createSmrIndex(validateSmrSnapshot(await loadSnapshot())))();
      // A missing or broken snapshot is retried on the next request.
      indexPromise.catch(() => {
        indexPromise = null;
      });
    }
    return indexPromise;
  }

  async function handler(req, res) {
    const json = (status, value) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
      });
      res.end(JSON.stringify(value));
    };
    if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' });
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (!ROUTES.has(route)) return json(404, { error: 'unknown_route' });
    if (!allow(clientKey(req))) return json(429, { error: 'rate_limited' });
    const params = url.searchParams;
    const types = parseHeritageTypes(params.get('types'));
    if (!types.ok)
      return json(400, {
        error: types.error,
        ...(types.unknown ? { unknown: types.unknown } : {}),
      });

    let index;
    try {
      index = await getIndex();
    } catch (error) {
      if (error?.code === 'SMR_SNAPSHOT_MISSING')
        return json(503, {
          error: 'smr_snapshot_missing',
          hint: 'Run npm run smr:snapshot, then restart the dev server.',
        });
      return json(500, { error: 'heritage_unavailable' });
    }
    const meta = {
      fetchedAt: index.fetchedAt,
      bounds: index.bounds,
      attribution: SMR_ATTRIBUTION,
      licence: SMR_LICENCE,
    };

    if (route === '/status')
      return json(200, { ready: true, count: index.count, ...meta });

    if (route === '/points') {
      const box = readBox(params, POINTS_MAX_SPAN_DEG);
      if (!box) return json(400, { error: 'invalid_box' });
      const limit = intParam(params, 'limit', 1, 1500, 1000);
      return json(200, { ...index.points({ box, types: types.keys, limit }), ...meta });
    }

    if (route === '/stats') {
      const box = readBox(params, STATS_MAX_SPAN_DEG);
      const lat = numberParam(params, 'lat', -90, 90);
      const lon = numberParam(params, 'lon', -180, 180);
      const km = numberParam(params, 'km', 0.1, 500);
      const circle = lat !== null && lon !== null && km !== null ? { lat, lon, km } : null;
      if (Boolean(box) === Boolean(circle))
        return json(400, { error: 'invalid_scope' });
      return json(200, { ...index.stats({ box, circle, types: types.keys }), ...meta });
    }

    const lat = numberParam(params, 'lat', -90, 90);
    const lon = numberParam(params, 'lon', -180, 180);
    if (lat === null || lon === null) return json(400, { error: 'invalid_point' });
    return json(200, {
      ...index.nearest({
        lat,
        lon,
        types: types.keys,
        limit: intParam(params, 'limit', 1, 10, 3),
        maxKm: numberParam(params, 'maxKm', 1, 300) ?? 150,
      }),
      ...meta,
    });
  }

  return {
    name: 'heritage-smr',
    configureServer({ middlewares }) {
      middlewares.use('/api/heritage/smr', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/heritage/smr', handler);
    },
  };
}
```

Note: the "invalid box" test uses `south=53&north=55`, a 2° span, to prove the 1.5° points limit.

- [ ] **Step 4: Register the plugin**

In `server/providers/local.js`, add next to the other imports:
```js
import { heritageProxy } from './heritage.js';
```
and in the array returned by `localProviderPlugins()`, directly before `keySetupEndpoint(),`:
```js
    heritageProxy(),
```

- [ ] **Step 5: Document the route in SECURITY.md**

Add a bullet to the per-proxy list under "Server-side proxy hardening" (SECURITY.md:60-73), matching the style of the Transit bullet at line 68:
```markdown
- **Heritage (SMR)** (`/api/heritage/smr`) answers from a local snapshot at `.gev-cache/smr/snapshot.json` and never contacts the National Monuments Service at runtime. Only `npm run smr:snapshot` fetches from the fixed SMR host, paced to respect its shared quota. Box spans, radii and result counts are bounded; errors are sanitised.
```

- [ ] **Step 6: Run the tests**

Run: `node --test src/data/heritageSmrProxy.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 7: Check the live route**

Run `npm run dev` in one terminal, then:
```bash
curl -s http://localhost:4173/api/heritage/smr/status
curl -s "http://localhost:4173/api/heritage/smr/stats?south=53.72&west=-10.05&north=54.0&east=-9.45"
```
Expected: status shows about 151,000 records; the Clew Bay stats total is 1,008 (the same box the Clew Bay scene used on 2026-09-29), give or take records added since.

- [ ] **Step 8: Format and commit**
```bash
npm run format
git add server/providers/heritage.js server/providers/local.js SECURITY.md src/data/heritageSmrProxy.test.mjs
git commit -m "feat(heritage): serve SMR queries from the local snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Browser source and map layer

**Files:**
- Create: `src/layers/heritage/policy.js`, `src/layers/heritage/source.js`, `src/layers/heritage/index.js`
- Test: `src/layers/heritage/source.test.mjs`, `src/layers/heritage/layer.test.mjs`

**Interfaces:**
- Consumes: `/api/heritage/smr/points` (Task 4), `HERITAGE_FAMILY_COLORS`, `heritageFamily` (Task 1). Services with the shapes used by `src/app/layers/alprCameras.js`: `services.render.governorRequestRender(reason)`, `services.picking.registerPickOwner(layerId, predicate)` / `unregisterPickOwner(layerId)`, `services.context.registerEntityContext(entity, metadata)` / `selectEntityContext(entity)` / `clearSelectedEntityContextForLayer(layerId)` / `removeEntityContextsForLayer(layerId, { retainIds })`.
- Produces:
  - `createHeritageSource({ fetchImpl?, baseUrl? })` → `{ fetch(box, signal): Promise<{ records, total, saturated }> }`; a missing snapshot rejects with `error.code === 'smr_snapshot_missing'`.
  - `viewBox(viewer): { south, west, north, east } | null`
  - `createHeritageLayer({ source, services })` → layer object with `id: 'heritage-smr'`, `init`, `enable`, `disable`, `update`, `destroy`, `getStats`.

Before writing code, read `src/layers/alpr/index.js:130-230` (debounce, abort, status flow) and `src/data/alprCameras.test.mjs:300-340` (fake viewer). This layer follows the same flow with simpler rendering: native Cesium point and label entities instead of the ALPR overlay system.

- [ ] **Step 1: Write the failing tests**

`src/layers/heritage/source.test.mjs`:
```js
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
```

`src/layers/heritage/layer.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createHeritageLayer, viewBox } from './index.js';

function fakeViewer(box) {
  let dataSource;
  return {
    camera: {
      moveEnd: new Cesium.Event(),
      computeViewRectangle: () => (box ? Cesium.Rectangle.fromDegrees(box.west, box.south, box.east, box.north) : undefined),
    },
    scene: { canvas: { addEventListener() {}, removeEventListener() {} }, globe: { ellipsoid: Cesium.Ellipsoid.WGS84 }, pick: () => undefined },
    dataSources: { add: (v) => { dataSource = v; }, remove() {} },
    get dataSource() { return dataSource; },
  };
}

function fakeServices() {
  const registered = [];
  return {
    registered,
    render: { governorRequestRender() {} },
    picking: { registerPickOwner() {}, unregisterPickOwner() {} },
    context: {
      registerEntityContext: (entity, meta) => registered.push(meta),
      selectEntityContext() {},
      clearSelectedEntityContextForLayer() {},
      removeEntityContextsForLayer() {},
    },
  };
}

const rath = { id: 'smr:MA1', smrs: 'MA1', monumentClass: 'Ringfort - rath', townland: 'Ardkeen', county: 'Mayo', latitude: 53.88, longitude: -9.55, link: null };

test('viewBox rejects the sky and views wider than 1.5 degrees', () => {
  assert.equal(viewBox(fakeViewer(null)), null);
  assert.equal(viewBox(fakeViewer({ south: 51, west: -10, north: 55, east: -6 })), null);
  const box = viewBox(fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 }));
  assert.ok(Math.abs(box.south - 53.85) < 1e-9);
});

test('update loads the view, draws entities and registers context', async () => {
  const services = fakeServices();
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const layer = createHeritageLayer({ source: { fetch: async () => ({ records: [rath], total: 1, saturated: false }) }, services });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(viewer.dataSource.entities.values.length, 1);
  assert.equal(services.registered[0].layerId, 'heritage-smr');
  assert.equal(services.registered[0].properties.name, 'Ringfort - rath, Ardkeen');
  assert.equal(layer.getStats().count, 1);
});

test('a wide view shows the zoom-in guidance and draws nothing', async () => {
  let fetched = false;
  const viewer = fakeViewer({ south: 51, west: -10, north: 55, east: -6 });
  const layer = createHeritageLayer({ source: { fetch: async () => { fetched = true; return { records: [] }; } }, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(fetched, false);
  assert.equal(layer.getStats().status, 'zoom-in');
  assert.equal(layer.getStats().countLabel, 'Zoom in to see monuments');
});

test('a missing snapshot is reported as unavailable with the fix', async () => {
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const source = { fetch: async () => { throw Object.assign(new Error('x'), { code: 'smr_snapshot_missing' }); } };
  const layer = createHeritageLayer({ source, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getStats().error, /npm run smr:snapshot/);
});

test('disable clears entities and ignores a late response', async () => {
  let resolve;
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const layer = createHeritageLayer({ source: { fetch: () => new Promise((r) => { resolve = r; }) }, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  const pending = layer.update(viewer);
  layer.disable(viewer);
  resolve({ records: [rath], total: 1, saturated: false });
  await pending;
  assert.equal(viewer.dataSource.entities.values.length, 0);
  assert.equal(layer.getStats().status, 'idle');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test src/layers/heritage/source.test.mjs src/layers/heritage/layer.test.mjs`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the implementation**

`src/layers/heritage/policy.js`:
```js
export const LAYER_ID = 'heritage-smr';
export const LAYER_NAME = 'Monuments (SMR)';
export const API_BASE = '/api/heritage/smr';
export const REQUEST_DEBOUNCE_MS = 300;
export const QUERY_LIMIT = 1000;
/** Views wider than this show zoom-in guidance instead of a partial sample. */
export const MAX_VIEW_SPAN_DEG = 1.5;
/** Class labels appear only when the camera is this close, in metres. */
export const LABEL_MAX_DISTANCE_M = 6000;
export const SNAPSHOT_MISSING_MESSAGE =
  'SMR snapshot missing: run npm run smr:snapshot';
```

`src/layers/heritage/source.js`:
```js
import { API_BASE, QUERY_LIMIT } from './policy.js';

/** Browser source for the local /api/heritage/smr/points route. */
export function createHeritageSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
  baseUrl = API_BASE,
} = {}) {
  return {
    async fetch(box, signal) {
      const params = new URLSearchParams({
        south: box.south.toFixed(4),
        west: box.west.toFixed(4),
        north: box.north.toFixed(4),
        east: box.east.toFixed(4),
        limit: String(QUERY_LIMIT),
      });
      const response = await fetchImpl(`${baseUrl}/points?${params}`, { signal });
      if (response.status === 503) {
        await response.body?.cancel();
        throw Object.assign(new Error('SMR snapshot missing'), {
          code: 'smr_snapshot_missing',
        });
      }
      if (!response.ok) throw new Error(`Heritage request failed (${response.status})`);
      return validateHeritagePoints(await response.json());
    },
  };
}

export function validateHeritagePoints(body) {
  if (!body || !Array.isArray(body.records))
    throw new Error('Invalid heritage response');
  const records = body.records.filter(
    (r) =>
      typeof r?.id === 'string' &&
      typeof r.monumentClass === 'string' &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude),
  );
  return {
    records,
    total: Number.isFinite(body.total) ? body.total : records.length,
    saturated: body.saturated === true,
  };
}
```

`src/layers/heritage/index.js`:
```js
import * as Cesium from 'cesium';
import {
  HERITAGE_FAMILY_COLORS,
  heritageFamily,
} from '../../data/heritageClasses.js';
import {
  LAYER_ID,
  LAYER_NAME,
  REQUEST_DEBOUNCE_MS,
  MAX_VIEW_SPAN_DEG,
  LABEL_MAX_DISTANCE_M,
  SNAPSHOT_MISSING_MESSAGE,
} from './policy.js';

const toDeg = Cesium.Math.toDegrees;

/** Current view as a degree box, or null for the sky or a view too wide to sample. */
export function viewBox(viewer) {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return null;
  const box = {
    south: toDeg(rect.south),
    west: toDeg(rect.west),
    north: toDeg(rect.north),
    east: toDeg(rect.east),
  };
  if (!Object.values(box).every(Number.isFinite)) return null;
  if (box.north <= box.south || box.east <= box.west) return null;
  if (box.north - box.south > MAX_VIEW_SPAN_DEG || box.east - box.west > MAX_VIEW_SPAN_DEG)
    return null;
  return box;
}

function heritageDetails(record) {
  return [
    `${record.townland}, CO. ${record.county}`.toUpperCase(),
    `SMR ${record.smrs}`,
    'SOURCE: NATIONAL MONUMENTS SERVICE',
  ];
}

/** Viewport-driven Sites and Monuments Record points from the local snapshot route. */
export function createHeritageLayer({ source, services } = {}) {
  if (typeof source?.fetch !== 'function')
    throw new TypeError('Heritage requires a monument source');
  const { governorRequestRender } = services.render;
  const { registerPickOwner, unregisterPickOwner } = services.picking;
  const {
    registerEntityContext,
    selectEntityContext,
    clearSelectedEntityContextForLayer,
    removeEntityContextsForLayer,
  } = services.context;

  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    recordById: new Map(),
    abort: null,
    timer: null,
    removeMoveEnd: null,
    clickHandler: null,
    status: 'idle',
    error: null,
    lastUpdate: null,
    total: 0,
    saturated: false,
    loading: false,
  };

  function setStatus(status, error = null) {
    state.status = status;
    state.error = error;
    governorRequestRender('heritage-status');
  }

  function schedule() {
    if (!state.enabled) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(load, REQUEST_DEBOUNCE_MS);
  }

  function addEntity(record) {
    const color = Cesium.Color.fromCssColorString(
      HERITAGE_FAMILY_COLORS[heritageFamily(record.monumentClass)],
    );
    const entity = state.dataSource.entities.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(record.longitude, record.latitude),
      point: {
        pixelSize: 8,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: record.monumentClass,
        font: '12px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_MAX_DISTANCE_M),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entity.gevTrackedId = record.id;
    entity.gevLabelModel = {
      title: record.monumentClass.toUpperCase(),
      details: heritageDetails(record),
      accent: color.toCssColorString(),
    };
    registerEntityContext(entity, {
      id: record.id,
      layerId: LAYER_ID,
      dataSource: state.dataSource,
      layerName: LAYER_NAME,
      source: 'National Monuments Service SMR',
      label: record.monumentClass,
      latitude: record.latitude,
      longitude: record.longitude,
      properties: {
        name: `${record.monumentClass}, ${record.townland}`,
        monumentClass: record.monumentClass,
        townland: record.townland,
        county: record.county,
        smrs: record.smrs,
        link: record.link,
      },
    });
  }

  function render(records) {
    if (!state.dataSource) return;
    const next = new Map(records.map((record) => [record.id, record]));
    const entities = state.dataSource.entities;
    entities.suspendEvents();
    for (const id of state.recordById.keys())
      if (!next.has(id)) entities.removeById(id);
    for (const record of records)
      if (!state.recordById.has(record.id)) addEntity(record);
    entities.resumeEvents();
    state.recordById = next;
    removeEntityContextsForLayer(LAYER_ID, { retainIds: new Set(next.keys()) });
    governorRequestRender('heritage-render');
  }

  async function load() {
    if (!state.enabled || !state.viewer) return;
    const box = viewBox(state.viewer);
    if (!box) {
      state.abort?.abort();
      render([]);
      state.total = 0;
      state.saturated = false;
      setStatus('zoom-in');
      return;
    }
    state.abort?.abort();
    const request = new AbortController();
    state.abort = request;
    state.loading = true;
    try {
      const result = await source.fetch(box, request.signal);
      if (request.signal.aborted || state.abort !== request || !state.enabled) return;
      render(result.records);
      state.total = result.total;
      state.saturated = result.saturated;
      state.lastUpdate = Date.now();
      setStatus('idle');
    } catch (error) {
      if (request.signal.aborted || error?.name === 'AbortError') return;
      setStatus(
        'unavailable',
        error?.code === 'smr_snapshot_missing'
          ? SNAPSHOT_MISSING_MESSAGE
          : 'Heritage data unavailable',
      );
    } finally {
      if (state.abort === request) {
        state.abort = null;
        state.loading = false;
      }
    }
  }

  function onClick({ position }) {
    if (!state.enabled) return;
    const picked = state.viewer.scene.pick(position);
    const id = picked?.id?.id;
    if (!state.recordById.has(id)) return;
    selectEntityContext(state.dataSource.entities.getById(id));
    governorRequestRender('heritage-selection');
  }

  return {
    id: LAYER_ID,
    name: LAYER_NAME,
    icon: '⌂',
    source: 'NMS',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    init(viewer) {
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.removeMoveEnd = viewer.camera.moveEnd.addEventListener(schedule);
      state.clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      state.clickHandler.setInputAction(onClick, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    },
    enable() {
      state.enabled = true;
      registerPickOwner(LAYER_ID, (id) => state.recordById.has(id));
      if (state.dataSource) state.dataSource.show = true;
      setStatus('loading');
    },
    disable() {
      state.enabled = false;
      clearTimeout(state.timer);
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
      render([]);
      if (state.dataSource) state.dataSource.show = false;
      setStatus('idle');
    },
    // DataLayerManager calls update() right after enable(); it owns the first fetch.
    update() {
      return load();
    },
    destroy(viewer) {
      this.disable();
      state.removeMoveEnd?.();
      state.clickHandler?.destroy();
      if (state.dataSource) viewer?.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.viewer = null;
    },
    getStats() {
      const shown = state.recordById.size;
      let countLabel = '';
      if (state.enabled && state.status === 'zoom-in') countLabel = 'Zoom in to see monuments';
      else if (state.enabled && state.lastUpdate)
        countLabel = state.saturated ? `${shown} of ${state.total} in view` : `${shown} in view`;
      return {
        count: shown,
        shown,
        countLabel,
        status: state.status,
        error: state.error,
        loading: state.loading,
        lastUpdate: state.lastUpdate,
        saturated: state.saturated,
        stale: false,
      };
    },
  };
}
```

If `new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)` throws in the node test with the fake canvas, copy the approach in `src/data/alprCameras.test.mjs` (it patches `Cesium.ScreenSpaceEventHandler.prototype.setInputAction`) rather than changing the layer.

- [ ] **Step 4: Run the tests**

Run: `node --test src/layers/heritage/source.test.mjs src/layers/heritage/layer.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Format and commit**
```bash
npm run format
git add src/layers/heritage/
git commit -m "feat(heritage): add viewport-driven Monuments (SMR) layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Register the layer in the app

**Files:**
- Create: `src/app/layers/heritage.js`
- Modify: `src/app/constructCatalog.js` (imports, `SOURCE_METHODS` at lines 33-58, catalog list near line 150)
- Modify: `src/standalone/layerSources.js` (source map near line 41)
- Modify: `src/data/layerState.js` (`LAYER_STATE_REGISTRY`), `src/data/layerStateTokenReservations.json`
- Modify: `src/ui/layerPanel.js` (`PANEL_GROUPS`, `PANEL_LABELS`), `src/ui/styles/cyber.css`
- Modify: `src/data/dataCredits.js` (`DATA_CREDITS`, starts line 94), `DATA_SOURCES.md`

**Interfaces:**
- Consumes: `createHeritageLayer`, `createHeritageSource` (Task 5).
- Produces: `createApplicationHeritage({ source })`; the layer toggle "Monuments (SMR)" in a new "Heritage" panel group; layer-state token for `heritage-smr`.

- [ ] **Step 1: Application wiring**

`src/app/layers/heritage.js`:
```js
import * as credits from '../../data/dataCredits.js';
import * as render from '../../renderGovernor.js';
import * as context from '../../data/contextStore.js';
import * as picking from '../../data/pickRegistry.js';
import { createHeritageLayer } from '../../layers/heritage/index.js';

/** Construct the Monuments (SMR) layer with the application scene owners. */
export function createApplicationHeritage({ source }) {
  return createHeritageLayer({
    source,
    services: { credits, render, context, picking },
  });
}
```

In `src/app/constructCatalog.js`:
- add `import { createApplicationHeritage } from './layers/heritage.js';` after the `createApplicationAlpr` import;
- add `heritage: ['fetch'],` to `SOURCE_METHODS` after `alpr: ['fetch'],`;
- add `createApplicationHeritage({ source: sources.heritage }),` directly after `createApplicationAlpr({ surface, source: sources.alpr }),`.

In `src/standalone/layerSources.js`:
- add `import { createHeritageSource } from '../layers/heritage/source.js';` with the other imports;
- add `heritage: createHeritageSource(),` after `alpr: createAlprTileSource(),`.

- [ ] **Step 2: Layer state token**

Run: `npm run layer-token:next -- heritage-smr`
It prints the next free token (expected: a digit, since new single-character tokens must match `/^[0-9]$/` and `1` and `2` are taken). Using that token, call it `T`:
- in `src/data/layerState.js`, add to `LAYER_STATE_REGISTRY`, keeping alphabetical order by id (after the `flights` entry, before `local-dams`):
  ```js
  Object.freeze({ id: 'heritage-smr', token: 'T', disposition: 'enabled-only' }),
  ```
- in `src/data/layerStateTokenReservations.json`, add `["heritage-smr", "T"]` in alphabetical position.

Run: `npm run layer-token:check`
Expected: passes.

- [ ] **Step 3: Panel group, label and icon**

In `src/ui/layerPanel.js`, add a group after the Infrastructure group in `PANEL_GROUPS`:
```js
  {
    label: 'Heritage',
    ids: ['heritage-smr'],
  },
```
and add to `PANEL_LABELS`:
```js
  'heritage-smr': 'Monuments (SMR)',
```

In `src/ui/styles/cyber.css`, after the `local-dams` icon rule (around line 598):
```css
:root[data-ui-theme='cyber']
  .data-toggle-row[data-layer-id='heritage-smr']
  .data-icon::before {
  content: '⌂';
}
```

- [ ] **Step 4: Attribution**

`DATA_SOURCES.md`: add a row to the main sources table, in the same four-column format as the NIFC WFIGS row (line 35):
```markdown
| **National Monuments Service, Sites and Monuments Record** (ArcGIS feature service `SMROpenData`) | Monuments (SMR) layer and `heritage_query` voice answers: 151k recorded archaeological monuments, Republic of Ireland | CC BY 4.0; downloaded keyless by `npm run smr:snapshot` into `.gev-cache/smr/snapshot.json` and served locally through `/api/heritage/smr` | "Monuments: National Monuments Service, Government of Ireland (CC BY 4.0)" |
```

`src/data/dataCredits.js`: add to `DATA_CREDITS`, copying the attribution string verbatim from the row above:
```js
  {
    key: 'nms-smr',
    html:
      'Monuments: ' +
      '<a href="https://www.archaeology.ie/collections-and-publications/open-data/" target="_blank" rel="noopener">National Monuments Service, Government of Ireland</a>' +
      ' (CC BY 4.0)',
  },
```

- [ ] **Step 5: Run the affected suites**

Run:
```bash
node --test src/data/dataCredits.test.mjs src/data/layerState.test.mjs
npm test
npm run check:boundaries
```
Expected: all pass. If `dataCredits.test.mjs` fails on the verbatim-match rule, make the DATA_SOURCES.md attribution column and the credit text identical in the form the test expects (read the failing assertion). If `check:boundaries` reports `src/layers/heritage/*` or `src/data/heritageClasses.js` outside a group's declared modules, add those paths to the `modules` array of the group it names in `scripts/package-boundaries.json`, as `src/layers/alpr/*.js` are listed under `alpr-cameras` (line 1137).

- [ ] **Step 6: Check in the browser**

Run `npm run dev`, open http://localhost:4173, open the data layers panel, and turn on **Monuments (SMR)** under **Heritage**. Search "Newport, Mayo" and zoom in.
Expected: coloured points appear; labels show the class when close in; clicking a point shows a card with class, townland, county and SMR number; zooming out past about 1.5° shows "Zoom in to see monuments"; the credits list includes the National Monuments Service line. Take a screenshot for the PR.

- [ ] **Step 7: Format and commit**
```bash
npm run format
git add src/app/layers/heritage.js src/app/constructCatalog.js src/standalone/layerSources.js src/data/layerState.js src/data/layerStateTokenReservations.json src/ui/layerPanel.js src/ui/styles/cyber.css src/data/dataCredits.js DATA_SOURCES.md
git add scripts/package-boundaries.json  # only if Step 5 changed it
git commit -m "feat(heritage): register the Monuments (SMR) layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `heritage_query` voice tool

**Files:**
- Create: `src/voice/heritageQuery.js`
- Modify: `src/voice/actionSchemas.js` (the `schemas` array starting at line 4; enums at lines 127-145 and 162-178)
- Modify: `src/voice/gevActions.js` (`LAYER_ALIASES` at lines 188-236; dispatch before `if (name === 'analyst_query')` at line 989)
- Modify: `server/providers/openai/toolDescriptions.js` (after `next_satellite_pass`)
- Modify: `server/providers/openai/instructions.js` (after the analytical-questions line, about line 21)
- Modify: `src/voice/actionSchemas.test.mjs` (lines 18-33 and 88-124)
- Modify: `scripts/qa-voice-routing.mjs` (phrase table near lines 145-180)
- Test: `src/voice/heritageQuery.test.mjs`

**Interfaces:**
- Consumes: `/api/heritage/smr/stats` and `/nearest` (Task 4), `HERITAGE_TYPES`, `HERITAGE_TYPE_KEYS` (Task 1).
- Produces:
  - `heritageViewContext(viewer): { lat, lon, box: {south,west,north,east}|null, radiusKm } | null`
  - `runHeritageQuery(args, { getView, fetchImpl?, signal? })` resolving to either
    `{ ok: true, mode: 'count', what, scopeLabel, count, byClass, note?, attribution }` or
    `{ ok: true, mode: 'nearest', what, scopeLabel, total, items: [{ name, monumentClass, townland, county, smrs, latitude, longitude, distanceKm }], note?, attribution }` or
    `{ ok: false, error }`.
  - Tool schema `heritage_query { mode: 'count'|'nearest', types?: string[], scope?: { kind: 'view'|'radius', km? }, limit? }`.

- [ ] **Step 1: Write the failing test**

`src/voice/heritageQuery.test.mjs`:
```js
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test src/voice/heritageQuery.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the handler**

`src/voice/heritageQuery.js`:
```js
import * as Cesium from 'cesium';
import { HERITAGE_TYPES, MAX_HERITAGE_TYPES } from '../data/heritageClasses.js';

const API = '/api/heritage/smr';
const STATS_MAX_SPAN_DEG = 12;
const ATTRIBUTION =
  'Sites and Monuments Record: National Monuments Service, Government of Ireland (CC BY 4.0)';
const COVERAGE_NOTE =
  'The Sites and Monuments Record covers the Republic of Ireland only. Zero here does not mean there are no monuments outside that coverage.';

const clamp = (value, min, max, fallback) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Camera position, view box and a fallback radius for heritage queries. */
export function heritageViewContext(viewer) {
  const carto = viewer?.camera?.positionCartographic;
  if (!carto) return null;
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  let box = null;
  if (rect) {
    const candidate = {
      south: Cesium.Math.toDegrees(rect.south),
      west: Cesium.Math.toDegrees(rect.west),
      north: Cesium.Math.toDegrees(rect.north),
      east: Cesium.Math.toDegrees(rect.east),
    };
    if (candidate.north > candidate.south && candidate.east > candidate.west) box = candidate;
  }
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
    box,
    radiusKm: Math.round(clamp((carto.height / 1000) * 1.6, 5, 500, 25)),
  };
}

function describeTypes(keys) {
  return keys.length
    ? keys.map((key) => HERITAGE_TYPES[key].label).join(' and ')
    : 'recorded monuments';
}

/** Answer heritage_query from the local /api/heritage/smr route. */
export async function runHeritageQuery(
  args,
  { getView, fetchImpl = (...a) => globalThis.fetch(...a), signal } = {},
) {
  const mode = args?.mode === 'nearest' ? 'nearest' : 'count';
  const types = (Array.isArray(args?.types) ? args.types : [])
    .filter((key) => Object.hasOwn(HERITAGE_TYPES, key))
    .slice(0, MAX_HERITAGE_TYPES);
  const view = getView();
  if (!view) return { ok: false, error: 'The camera position is not available yet.' };

  const params = new URLSearchParams();
  if (types.length) params.set('types', types.join(','));
  let scopeLabel;
  if (mode === 'nearest') {
    params.set('lat', view.lat.toFixed(5));
    params.set('lon', view.lon.toFixed(5));
    params.set('limit', String(Math.round(clamp(args?.limit, 1, 10, 3))));
    params.set('maxKm', '150');
    scopeLabel = 'within 150 km of the view centre';
  } else {
    const box = view.box;
    const boxUsable =
      box &&
      box.north - box.south <= STATS_MAX_SPAN_DEG &&
      box.east - box.west <= STATS_MAX_SPAN_DEG;
    if (args?.scope?.kind !== 'radius' && boxUsable) {
      for (const key of ['south', 'west', 'north', 'east'])
        params.set(key, box[key].toFixed(4));
      scopeLabel = 'in the current view';
    } else {
      const km = Math.round(clamp(args?.scope?.km, 0.1, 500, view.radiusKm) * 10) / 10;
      params.set('lat', view.lat.toFixed(5));
      params.set('lon', view.lon.toFixed(5));
      params.set('km', String(km));
      scopeLabel = `within ${km} km of the view centre`;
    }
  }

  const response = await fetchImpl(
    `${API}/${mode === 'nearest' ? 'nearest' : 'stats'}?${params}`,
    { signal },
  );
  if (response.status === 503)
    return {
      ok: false,
      error:
        'The monuments data has not been downloaded. Tell the user to run npm run smr:snapshot and restart the app.',
    };
  if (!response.ok) return { ok: false, error: 'Monument data is unavailable right now.' };
  const body = await response.json();
  const empty = mode === 'nearest' ? !body.records?.length : body.total === 0;
  const base = {
    ok: true,
    mode,
    what: describeTypes(types),
    scopeLabel,
    attribution: ATTRIBUTION,
    ...(empty ? { note: COVERAGE_NOTE } : {}),
  };
  if (mode === 'nearest')
    return {
      ...base,
      total: body.total,
      items: (body.records || []).map((r) => ({
        name: `${r.monumentClass}, ${r.townland}`,
        monumentClass: r.monumentClass,
        townland: r.townland,
        county: r.county,
        smrs: r.smrs,
        latitude: r.latitude,
        longitude: r.longitude,
        distanceKm: r.distanceKm,
      })),
    };
  return { ...base, count: body.total, byClass: body.byClass || [] };
}
```

- [ ] **Step 4: Run the handler tests**

Run: `node --test src/voice/heritageQuery.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the schema and layer enums**

In `src/voice/actionSchemas.js`:
- add `import { HERITAGE_TYPE_KEYS } from '../data/heritageClasses.js';` at the top;
- add `'heritage-smr'` to the `layerId` enum of `set_layer_visibility` (lines 127-145) and of `show_data_layers_menu` (lines 162-178), after `'local-dams'`;
- append this object as the last element of the `schemas` array (after `next_satellite_pass`):
```js
  {
    name: 'heritage_query',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: { type: 'string', enum: ['count', 'nearest'] },
        types: {
          type: 'array',
          items: { type: 'string', enum: [...HERITAGE_TYPE_KEYS] },
        },
        scope: {
          type: 'object',
          additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: ['view', 'radius'] },
            km: { type: 'number' },
          },
        },
        limit: { type: 'number' },
      },
      required: ['mode'],
    },
  },
```

- [ ] **Step 6: Update the pinned schema tests**

In `src/voice/actionSchemas.test.mjs`, test "all legacy action arguments are byte-identical after removing the deliberate additions" (lines 88-124): extend the first filter and the visibility filter so the legacy hash is unchanged:
```js
  const legacy = structuredClone(GEV_ACTION_SCHEMAS).filter(
    (tool) =>
      !['next_satellite_pass', 'set_cyber_sonar', 'heritage_query'].includes(tool.name),
  );
```
and inside the existing `for (const tool of legacy)` loop, change the filter to:
```js
        value.enum = value.enum.filter(
          (key) => key !== 'fire-perimeters' && key !== 'heritage-smr',
        );
```
Run: `node --test src/voice/actionSchemas.test.mjs`
Expected: the legacy test passes; "the complete Realtime tool payload pins ..." fails with a new digest (it also changes after Step 8's description). Do not update that digest yet.

- [ ] **Step 7: Dispatch and aliases**

In `src/voice/gevActions.js`:
- add `import { runHeritageQuery, heritageViewContext } from './heritageQuery.js';` with the other imports;
- add to `LAYER_ALIASES` (lines 188-236):
```js
  ['monuments', 'heritage-smr'],
  ['national monuments', 'heritage-smr'],
  ['heritage', 'heritage-smr'],
  ['smr', 'heritage-smr'],
```
- directly before `if (name === 'analyst_query') {` (line 989):
```js
    if (name === 'heritage_query') {
      return runHeritageQuery(args, {
        getView: () => heritageViewContext(viewer),
        signal: runOptions.signal,
      });
    }
```

- [ ] **Step 8: Model guidance**

In `server/providers/openai/toolDescriptions.js`, after the `next_satellite_pass` entry:
```js
  heritage_query: {
    description:
      'Answer questions about recorded archaeological monuments in Ireland from the National Monuments Service Sites and Monuments Record (Republic of Ireland only): "how many ringforts are in view", "where is the nearest tower house", "how many holy wells within 10 km". mode "count" returns a total and the most common classes; mode "nearest" returns the closest monuments with latitude and longitude. Map spoken words to types: forts, raths and cashels to ringfort, rath or cashel; abbeys, friaries, priories and monasteries to religious-house; dolmens to portal-tomb; wells to holy-well; castles to castle, and tower houses to tower-house. Omit types for all monuments. Works whether or not the Monuments layer is on.',
    $position: 1,
    parameters: {
      properties: {
        mode: {
          description: '"count" for how many; "nearest" for where is the closest or take me to.',
          $position: 3,
        },
        types: {
          description: 'Monument types to include. Omit for every recorded monument.',
          $position: 3,
        },
        scope: {
          description: 'count only. Omit for the current view; use kind "radius" with km for "within N km".',
          $position: 3,
        },
        limit: {
          description: 'nearest only. How many to return, 1 to 10. Use 1 for "take me to".',
          $position: 3,
        },
      },
    },
  },
```

In `server/providers/openai/instructions.js`, add this string to the array returned by `realtimeInstructions()`, directly after the line that begins `'For ANALYTICAL questions about layer data`:
```js
    'For questions about monuments, ringforts, castles, tower houses, holy wells, stone circles, abbeys or other archaeological sites in Ireland, call heritage_query, never analyst_query. For "take me to" or "show me" the nearest one, call heritage_query{mode:"nearest",limit:1}, then fly_to_location with that item\'s latitude and longitude, and turn on the heritage-smr layer with set_layer_visibility if it is off. Name a site by its class and townland. The record holds no description of individual sites: when asked what a monument is, explain what that class of monument generally is and say that the record gives no detail about this particular site. If the result has a note, say it. Credit the National Monuments Service when giving counts.',
```

- [ ] **Step 9: Re-pin the full payload digest**

Run: `node --test src/voice/actionSchemas.test.mjs`
The "complete Realtime tool payload" test fails and prints the actual digest. Replace the expected value at line 32 with it and update the comment above it:
```js
    // Re-derived for the additive heritage_query tool and heritage-smr layer
    // enum values; the separate sonar tool is excluded above.
```
Run the file again. Expected: PASS.

- [ ] **Step 10: Routing phrases**

In `scripts/qa-voice-routing.mjs`, add to the phrase table next to the ISS entry (line 145):
```js
  { phrase: 'How many ringforts are in view?', expect: 'heritage_query' },
  { phrase: 'Take me to the nearest tower house.', expect: 'heritage_query' },
  { phrase: 'How many holy wells are within ten kilometres?', expect: 'heritage_query' },
```

- [ ] **Step 11: Run the voice suites**

Run:
```bash
node --test src/voice/heritageQuery.test.mjs src/voice/actionSchemas.test.mjs src/voice/gevActions.test.mjs
npm test
```
Expected: all pass.

- [ ] **Step 12: Format and commit**
```bash
npm run format
git add src/voice/heritageQuery.js src/voice/heritageQuery.test.mjs src/voice/actionSchemas.js src/voice/actionSchemas.test.mjs src/voice/gevActions.js server/providers/openai/toolDescriptions.js server/providers/openai/instructions.js scripts/qa-voice-routing.mjs
git commit -m "feat(heritage): add heritage_query voice tool

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation and full verification

**Files:**
- Modify: `docs/CURRENT-STATE.md` (layer table, around line 2864)

- [ ] **Step 1: Layer table row**

Add a row to the layer table in `docs/CURRENT-STATE.md`, in the same column order as its neighbours (layer, source, module, route, cadence):
```markdown
| Monuments (SMR) | National Monuments Service Sites and Monuments Record (local snapshot) | `src/layers/heritage/` | `/api/heritage/smr` | On camera move; snapshot refreshed manually with `npm run smr:snapshot` |
```

- [ ] **Step 2: Full CI-equivalent run**
```bash
npm run doctor -- --json
npm run format:check
npm run check:boundaries
npm run layer-token:check -- --base-ref upstream/main
npm test
npm run build
```
Expected: every command succeeds. `--base-ref upstream/main` because `origin` is now the fork. Paste failures into the task report; do not weaken tests to pass.

- [ ] **Step 3: Manual voice check (needs an OpenAI key in POWER UP)**

With `npm run dev` running and the Monuments layer off:
1. Fly to Newport, Co. Mayo. Say "How many ringforts are in view?" Expected: a count with the most common classes and a National Monuments Service credit.
2. Say "Take me to the nearest tower house." Expected: the camera flies to Rockfleet or another tower house, and the Monuments layer turns on.
3. Click a point and say "What is this?" Expected: the class, townland and county, a general explanation of the class, and a statement that the record has no detail about this site.
4. Fly to London and repeat step 1. Expected: zero, with the coverage note.
5. Stop the server, move `.gev-cache/smr/snapshot.json` aside, restart, and repeat step 1. Expected: the assistant says to run `npm run smr:snapshot`. Move the file back.

Optionally run `node scripts/qa-voice-routing.mjs` if it is configured; it uses the OpenAI key and costs a small amount.

- [ ] **Step 4: Commit**
```bash
npm run format
git add docs/CURRENT-STATE.md
git commit -m "docs(heritage): record the Monuments (SMR) layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Before any upstream pull request**

Open an issue on `bilawalsidhu/gods-eye-view` describing the layer and asking whether the maintainer wants it, before opening a PR. Confirm with James before posting either; both are public.

## Out of scope (follow-ups)

- Styled labels through the app's world-overlay label system instead of native Cesium labels.
- Showing snapshot age in `npm run doctor` and a scheduled refresh.
- Northern Ireland coverage (HERoNI, a separate dataset and licence).
- County and region scopes for voice counts ("how many castles in Mayo").
