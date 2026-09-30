# SMR Descriptions and Record Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a monument is selected, show its published description and a link to its full record, and let voice describe a monument from that description.

**Architecture:** A new server route `/api/heritage/smr/record?smrs=` fetches one record's description from the National Monuments Service on demand, caches it on disk, and enforces a small global request budget. The Monuments layer requests it on selection, shows a short excerpt on the map card, and publishes the full text and a link through a new, reusable "detail" block in the layers panel row (real HTML: readable by screen readers, keyboard-scrollable, with a real link). The `heritage_query` voice tool gains a `describe` mode.

**Tech Stack:** Node 24, Vite plugin middleware, CesiumJS, DOM (layers panel), `node:test`, OpenAI Realtime tool schemas.

**Spec:** Agreed in conversation on 2026-09-30 (options "1 plus 3"). Builds on `docs/superpowers/plans/2026-09-29-smr-heritage-layer.md` and the code on branch `feat/smr-heritage-layer`.

## Design decisions

1. **Correction to the first plan.** About 88% of SMR records have a real description in `WEB_NOTES` (133,776 of 151,308 on 2026-09-30); the rest carry a placeholder containing "has not been uploaded". Median length about 560 characters, 90th percentile about 1,150, maximum 8,000.
2. **On demand, cached, budgeted.** One upstream request per newly selected record, cached on disk for 30 days under `.gev-cache/smr/records/`, at most 30 upstream requests per minute across all clients, and a 60-second cool-down after any upstream 429. The shared upstream quota is 3,000 request units per minute.
3. **The client never names a URL or query.** It sends an SMR number, which must use only capitals, digits, hyphens and `*` (6 to 20 characters; checked against all 140,428 snapshot ids on 2026-09-30) and exist in the local snapshot before the server builds the fixed upstream query.
4. **Canvas card gets an excerpt only.** The tracked readout card is canvas-drawn, non-interactive and `aria-hidden`, with single-line details and no wrapping. It shows up to 3 wrapped lines of the description.
5. **Full text and link live in the layers panel row.** A generic `detail` block in `getRowControls()` renders as HTML under the legend: heading, meta line, scrollable text, and an `https:` link that opens in a new tab.
6. **Voice describes, not recites.** `heritage_query{mode:"describe", smrs}` returns the description (up to 3,000 characters). The model summarises it in two or three spoken sentences.
7. **No new `src/` modules**, so `scripts/package-boundaries.json` should need no edits (agents cannot edit that file; James does).

## Global Constraints

- Node 24 through nvm. Prefix node/npm/npx commands with: `unset -f node npm npx nvm _load_nvm 2>/dev/null; export NVM_DIR="$HOME/.nvm"; . /opt/homebrew/opt/nvm/nvm.sh >/dev/null; nvm use 24 >/dev/null;`
- Unit tests are `*.test.mjs` under `src/` only. Server modules are tested from `src/data/*.test.mjs`.
- `src/**/*.js` must not import `node:*`; `src/` may not import `server/`.
- Server routes fetch no client-supplied URL, sanitise errors, and send `Cache-Control: no-store`.
- Attribution text verbatim: `National Monuments Service, Government of Ireland`; licence `CC BY 4.0`.
- Native Cesium entity labels are forbidden (`src/noCesiumLabels.test.mjs`).
- Do not edit `scripts/package-boundaries.json`. If `npm run check:boundaries` fails, stop and report the exact group and line needed.
- Run `npm run format` before each commit; CI runs `npm run format:check`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Stage only files the task names. Work happens in the worktree `~/Projects/gods-eye-view-feat` on branch `feat/smr-heritage-layer`.

## Review Focus

1. **Upstream busy or offline.** Selecting a monument must still show class, townland and link, with "Description unavailable right now" rather than an empty or stuck "Loading" state. Tests: Task 1 (503/502), Task 3 (error state).
2. **Fast clicking between monuments.** A slow response for monument A must never overwrite the panel for monument B. Test: Task 3 (stale response ignored).
3. **Hostile or malformed SMR numbers** (`MA1' OR 1=1`, `../../etc`, unknown ids). Rejected with 400 or 404 before any upstream request or file path is built. Tests: Task 1.
4. **Placeholder descriptions.** "has not been uploaded" text must become "No description has been published for this record yet", never be shown or read aloud. Tests: Task 1, Task 4.
5. **Screen reader and keyboard users.** The detail text is real HTML text, the scrollable text is focusable, and the link text says it opens a new tab. Test: Task 2.

---

### Task 0: Worktree

**Files:** none.

- [ ] **Step 1: Create a worktree for the feature branch** (the main folder stays on `local/notes-and-scenes` with the dev server running)
```bash
cd ~/Projects/gods-eye-view
git worktree add ~/Projects/gods-eye-view-feat feat/smr-heritage-layer
cd ~/Projects/gods-eye-view-feat
npm ci
mkdir -p .gev-cache && ln -s ~/Projects/gods-eye-view/.gev-cache/smr .gev-cache/smr
npm test
```
Expected: the suite passes on the branch head before any change.

---

### Task 1: Record route with cache and budget

**Files:**
- Create: `server/providers/heritage/records.js`
- Modify: `server/providers/heritage/smrIndex.js` (add `find`)
- Modify: `server/providers/heritage.js` (add `/record` route)
- Test: `src/data/heritageSmrRecords.test.mjs`; extend `src/data/heritageSmrIndex.test.mjs` and `src/data/heritageSmrProxy.test.mjs`

**Interfaces:**
- Produces:
  - `index.find(smrs): SmrRecord | null`
  - `isSmrsId(value): boolean`, `cleanDescription(notes): string | null`, `smrRecordUrl(smrs): string`
  - `createSmrRecordFetcher({ fetchImpl, now?, fs?, cacheDir?, budgetPerMinute? })` → `{ get(smrs): Promise<{ smrs, description, fetchedAt, cached }> }`; throws an error with `code === 'SMR_UPSTREAM_BUSY'` when budgeted out, cooling down, or rate limited upstream
  - `GET /api/heritage/smr/record?smrs=<SMRS>` → 200 `{ ...SmrRecord, description: string|null, descriptionFetchedAt, cached, fetchedAt, bounds, attribution, licence }`; 400 `invalid_smrs`; 404 `unknown_smrs`; 503 `description_busy` with `Retry-After: 60`; 502 `description_unavailable`

- [ ] **Step 1: Write the failing tests**

`src/data/heritageSmrRecords.test.mjs`:
```js
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
```

Add to `src/data/heritageSmrIndex.test.mjs`:
```js
test('find returns a record by SMR number, or null', () => {
  assert.equal(index.find('MA4').townland, 'Rockfleet');
  assert.equal(index.find('NOPE'), null);
});
```

Add to `src/data/heritageSmrProxy.test.mjs` (extend `install` so it forwards a `recordFetcher` option; the fixture snapshot's ids `MA1`/`MA4` fail `isSmrsId`, so add a row `['MA070-110----', 0, 0, 'Corraun', 53.93, -9.8]` to the fixture's `rows` and update the two existing count assertions that change as a result):
```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test src/data/heritageSmrRecords.test.mjs src/data/heritageSmrIndex.test.mjs src/data/heritageSmrProxy.test.mjs`
Expected: FAIL (module not found; `find` and `/record` missing).

- [ ] **Step 3: Implement**

`server/providers/heritage/records.js`:
```js
import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { SMR_QUERY_URL } from './snapshot.js';

export const SMR_RECORD_CACHE_DIR = path.join(process.cwd(), '.gev-cache', 'smr', 'records');
const USER_AGENT =
  'gods-eye-view-smr-record/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
// Real SMR numbers use capitals, digits, hyphens and (rarely) '*', e.g.
// MA076-009----, CL003A001----, CL062-001---*. No quotes, dots or slashes,
// so the id is safe in the fixed query and in a cache file name.
const SMRS_PATTERN = /^[A-Z0-9*-]{6,20}$/;
const cacheName = (smrs) => `${encodeURIComponent(smrs).replace(/\*/g, '%2A')}.json`;
const PLACEHOLDER = /has not been uploaded/i;
const MAX_DESCRIPTION = 8000;
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;
const COOL_DOWN_MS = 60_000;
const MEMORY_ENTRIES = 500;

const busy = () =>
  Object.assign(new Error('SMR service busy'), { code: 'SMR_UPSTREAM_BUSY' });

export function isSmrsId(value) {
  return typeof value === 'string' && SMRS_PATTERN.test(value);
}

export function smrRecordUrl(smrs) {
  return `${SMR_QUERY_URL}?${new URLSearchParams({
    where: `SMRS='${smrs}'`,
    outFields: 'SMRS,WEB_NOTES',
    returnGeometry: 'false',
    f: 'json',
  })}`;
}

export function cleanDescription(notes) {
  if (typeof notes !== 'string') return null;
  const text = notes.replace(/\s+/g, ' ').trim();
  if (!text || PLACEHOLDER.test(text)) return null;
  return text.slice(0, MAX_DESCRIPTION);
}

/** One-record description fetcher: memory and disk cache, coalescing, global budget. */
export function createSmrRecordFetcher({
  fetchImpl,
  now = () => Date.now(),
  fs = nodeFs,
  cacheDir = SMR_RECORD_CACHE_DIR,
  budgetPerMinute = 30,
}) {
  const memory = new Map();
  const inFlight = new Map();
  let windowStart = -Infinity;
  let used = 0;
  let coolUntil = -Infinity;

  const fresh = (value) => now() - Date.parse(value.fetchedAt) < CACHE_TTL_MS;

  function remember(value) {
    memory.delete(value.smrs);
    memory.set(value.smrs, value);
    if (memory.size > MEMORY_ENTRIES) memory.delete(memory.keys().next().value);
  }

  async function readDisk(smrs) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(cacheDir, cacheName(smrs)), 'utf8'));
      return value?.smrs === smrs && fresh(value) ? value : null;
    } catch {
      return null;
    }
  }

  async function writeDisk(value) {
    const file = path.join(cacheDir, cacheName(value.smrs));
    try {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(`${file}.tmp`, JSON.stringify(value));
      await fs.rename(`${file}.tmp`, file);
    } catch {
      // A cache write failure only costs a refetch later.
    }
  }

  function spend() {
    const t = now();
    if (t < coolUntil) throw busy();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      used = 0;
    }
    if (used >= budgetPerMinute) throw busy();
    used++;
  }

  async function fetchUpstream(smrs) {
    spend();
    const response = await fetchImpl(smrRecordUrl(smrs), {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429) {
      await response.body?.cancel();
      coolUntil = now() + COOL_DOWN_MS;
      throw busy();
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SMR record HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body?.error?.code === 429) {
      coolUntil = now() + COOL_DOWN_MS;
      throw busy();
    }
    if (body?.error || !Array.isArray(body?.features))
      throw new Error('SMR record error');
    const attributes = body.features.find((f) => f?.attributes?.SMRS === smrs)?.attributes;
    return {
      smrs,
      description: cleanDescription(attributes?.WEB_NOTES),
      fetchedAt: new Date(now()).toISOString(),
    };
  }

  return {
    async get(smrs) {
      const held = memory.get(smrs);
      if (held && fresh(held)) return { ...held, cached: true };
      const disk = await readDisk(smrs);
      if (disk) {
        remember(disk);
        return { ...disk, cached: true };
      }
      if (!inFlight.has(smrs))
        inFlight.set(
          smrs,
          fetchUpstream(smrs)
            .then(async (value) => {
              remember(value);
              await writeDisk(value);
              return value;
            })
            .finally(() => inFlight.delete(smrs)),
        );
      return { ...(await inFlight.get(smrs)), cached: false };
    },
  };
}
```

`server/providers/heritage/smrIndex.js`: build `const bySmrs = new Map(rows.map((row, i) => [row[0], i]));` next to the grid, and add to the returned object:
```js
    find(smrs) {
      const i = bySmrs.get(smrs);
      return i === undefined ? null : toRecord(i);
    },
```

`server/providers/heritage.js`:
- import `{ createSmrRecordFetcher, isSmrsId }` from `./heritage/records.js`;
- add `'/record'` to `ROUTES`;
- add an option `recordFetcher = createSmrRecordFetcher({ fetchImpl: (...args) => globalThis.fetch(...args) })` to `heritageProxy`;
- give `json` a third `headers = {}` argument merged into `writeHead`;
- after the `/status` branch and before `/points`:
```js
    if (route === '/record') {
      const smrs = params.get('smrs') || '';
      if (!isSmrsId(smrs)) return json(400, { error: 'invalid_smrs' });
      const record = index.find(smrs);
      if (!record) return json(404, { error: 'unknown_smrs' });
      try {
        const found = await recordFetcher.get(smrs);
        return json(200, {
          ...record,
          description: found.description,
          descriptionFetchedAt: found.fetchedAt,
          cached: found.cached,
          ...meta,
        });
      } catch (error) {
        if (error?.code === 'SMR_UPSTREAM_BUSY')
          return json(503, { error: 'description_busy' }, { 'Retry-After': '60' });
        return json(502, { error: 'description_unavailable' });
      }
    }
```

Update the SECURITY.md heritage bullet: replace "never contacts the National Monuments Service at runtime" with "contacts the fixed SMR host at runtime only for `/record`: one request per newly selected monument, cached on disk for 30 days, at most 30 upstream requests per minute, with a 60-second pause after any upstream rate limit".

- [ ] **Step 4: Run the tests** — the three files pass.
- [ ] **Step 5: Live check** in the worktree: `npm run dev -- --port 4174` in the background, then `curl -s "http://localhost:4174/api/heritage/smr/record?smrs=MA070-110----"` (expect a description beginning "In pasture at the W edge"), run it a second time (expect `"cached":true`), and `curl -s "http://localhost:4174/api/heritage/smr/record?smrs=MA076-009----"` (expect `"description":null`, the Ardkeen rath placeholder). Stop the server.
- [ ] **Step 6: Format, full suite, commit**
```bash
npm run format && npm run format:check && npm test
git add server/providers/heritage/records.js server/providers/heritage/smrIndex.js server/providers/heritage.js SECURITY.md src/data/heritageSmrRecords.test.mjs src/data/heritageSmrIndex.test.mjs src/data/heritageSmrProxy.test.mjs
git commit -m "feat(heritage): fetch and cache SMR descriptions on demand

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reusable detail block in the layers panel row

**Files:**
- Modify: `src/ui/layerPanel.js` (`_syncRowControls`, about lines 406-470)
- Modify: `src/ui/styles/radio.css` (after `.data-toggle-controls-info`, about line 903)
- Test: `src/ui/layerPanel.test.mjs`

**Interfaces:**
- Produces: a layer's `getRowControls()` may return `detail: { label?, heading, meta?, text?, link?: { href, label } }`. It renders as `<section class="data-toggle-detail" aria-label="{label or 'Selected item'}" aria-live="polite">` containing `p.data-toggle-detail-heading`, `p.data-toggle-detail-meta`, `p.data-toggle-detail-text` (`tabindex="0"`) and `a.data-toggle-detail-link` (`target="_blank"`, `rel="noopener noreferrer"`, text `"{label} (opens in a new tab)"`). Only `https:` links render. Empty parts are `hidden`. Nodes are reused across refreshes, so focus is not lost.

- [ ] **Step 1: Write the failing test.** Read `src/ui/layerPanel.test.mjs` first and copy its harness (how it builds a panel, a fake layer with `getRowControls`, and triggers a refresh; see the test around line 160 that asserts `.data-toggle-controls-info`). Add a test that:
  1. returns `detail: { heading: 'Castle - tower house, Corraun', meta: 'Co. Mayo · SMR MA070-110----', text: 'In pasture…', link: { href: 'https://example.org/r', label: 'View full record' } }` and asserts the four nodes' text, `tabIndex === 0` on the text, the link's `href`, `target`, `rel`, and text `View full record (opens in a new tab)`;
  2. refreshes with a different `text` and asserts the same `section` node object is reused;
  3. refreshes with `link: { href: 'javascript:alert(1)' }` and asserts the link is `hidden`;
  4. refreshes with `detail: null` and asserts the section is `hidden`.
- [ ] **Step 2: Run it to verify it fails:** `node --test src/ui/layerPanel.test.mjs`
- [ ] **Step 3: Implement** in `src/ui/layerPanel.js`:
  - In `_syncRowControls`, read `const detail = controls?.detail || null;` and include it in the hidden test: `container.hidden = chips.length === 0 && legend.length === 0 && !infoText && !detail;`
  - At the end of `_syncRowControls`, call `this._syncRowDetail(container, detail);`
  - Add the method:
```js
  /**
   * Render a row's selected-item detail (heading, meta, scrollable text, link).
   * Real HTML so screen readers and keyboards reach it; nodes are reused so a
   * refresh never drops focus from the scrollable text or the link.
   * @param {HTMLElement} container The row's `.data-toggle-controls` node.
   * @param {object|null} detail `{ label, heading, meta, text, link: { href, label } }`.
   */
  _syncRowDetail(container, detail) {
    let node = container._rowDetail || null;
    if (!detail) {
      if (node && !node.hidden) node.hidden = true;
      return;
    }
    const part = (tag, className) => {
      const element = document.createElement(tag);
      element.className = className;
      node.appendChild(element);
      return element;
    };
    if (!node) {
      node = document.createElement('section');
      node.className = 'data-toggle-detail';
      node.setAttribute('aria-live', 'polite');
      node._heading = part('p', 'data-toggle-detail-heading');
      node._meta = part('p', 'data-toggle-detail-meta');
      node._text = part('p', 'data-toggle-detail-text');
      node._text.tabIndex = 0;
      node._link = part('a', 'data-toggle-detail-link');
      node._link.target = '_blank';
      node._link.rel = 'noopener noreferrer';
      container.appendChild(node);
      container._rowDetail = node;
    }
    const setText = (element, value) => {
      const text = value ? String(value) : '';
      if (element.textContent !== text) element.textContent = text;
      if (element.hidden !== !text) element.hidden = !text;
    };
    if (node.hidden) node.hidden = false;
    const label = detail.label || 'Selected item';
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
    setText(node._heading, detail.heading);
    setText(node._meta, detail.meta);
    setText(node._text, detail.text);
    let href = null;
    try {
      const url = new URL(detail.link?.href || '');
      if (url.protocol === 'https:') href = url.href;
    } catch {
      href = null;
    }
    setText(node._link, href ? `${detail.link.label || 'Open record'} (opens in a new tab)` : '');
    if (href && node._link.getAttribute('href') !== href) node._link.setAttribute('href', href);
    if (!href) node._link.removeAttribute('href');
  }
```
  In `src/ui/styles/radio.css`, after the `.data-toggle-controls-info` rule:
```css
.data-toggle-detail {
  flex-basis: 100%;
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.45;
}
.data-toggle-detail p {
  margin: 0 0 4px;
}
.data-toggle-detail-heading {
  font-weight: 600;
}
.data-toggle-detail-meta {
  opacity: 0.8;
}
.data-toggle-detail-text {
  max-height: 12em;
  overflow-y: auto;
}
.data-toggle-detail-text:focus-visible,
.data-toggle-detail-link:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.data-toggle-detail-link {
  color: inherit;
  text-decoration: underline;
}
```
- [ ] **Step 4: Run the test**, then `npm test` once.
- [ ] **Step 5: Format and commit**
```bash
npm run format && npm run format:check
git add src/ui/layerPanel.js src/ui/styles/radio.css src/ui/layerPanel.test.mjs
git commit -m "feat(ui): add an accessible selected-item detail block to layer rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Monuments layer shows the description and link

**Files:**
- Modify: `src/layers/heritage/source.js` (add `describe`)
- Modify: `src/layers/heritage/index.js` (selection → detail, card excerpt, row controls listener)
- Modify: `src/app/layers/heritage.js` (inject `overlays.refreshReadout`)
- Test: `src/layers/heritage/source.test.mjs`, `src/layers/heritage/layer.test.mjs`

**Interfaces:**
- Consumes: `/api/heritage/smr/record` (Task 1); `detail` row control (Task 2); `refreshTrackedReadout(entity)` from `src/data/trackedReadout.js` (pattern: `src/app/layers/localAdsb.js` passes `overlays: { refreshReadout: refreshTrackedReadout }`, and `src/layers/localAdsb/index.js` calls `services.overlays?.refreshReadout?.(entity)`).
- Produces:
  - `source.describe(smrs, signal)` → the `/record` JSON; rejects with `code === 'description_busy'` on 503, a plain `Error` otherwise.
  - `excerptLines(text, { width = 46, lines = 3 } = {}): string[]` exported from `src/layers/heritage/index.js` (word-wrapped, the last line ends with `…` when text remains).
  - `layer.setRowControlsListener(listener)`.
  - `getRowControls().detail`: `{ label: 'Selected monument', heading: '{class}, {townland}', meta: 'Co. {county} · SMR {smrs}', text, link: { href: record.link, label: 'View full record (Historic Environment Viewer)' } }`, where `text` is `'Loading description…'`, the description, `'No description has been published for this record yet.'`, or `'Description unavailable right now. Try selecting it again shortly.'`.

- [ ] **Step 1: Write the failing tests.**
  - `source.test.mjs`: `describe('MA070-110----', signal)` calls `/api/heritage/smr/record?smrs=MA070-110----` with the signal; a 503 rejects with `code === 'description_busy'`.
  - `layer.test.mjs` (reuse its fake viewer, services and click harness; add `overlays: { refreshReadout: (entity) => refreshed.push(entity) }` to the fake services, and a `describe` method on the fake source):
    1. `excerptLines` wraps at word boundaries, caps at 3 lines, and ends with `…` when truncated; short text returns one line without `…`.
    2. Clicking a monument sets `getRowControls().detail.text` to `'Loading description…'`, then, after `describe` resolves, to the description; the entity's `gevLabelModel.details` gains the excerpt lines; `refreshReadout` was called with the entity; the row-controls listener fired; the registered context properties include `description`.
    3. `describe` resolving with `description: null` gives the "No description has been published…" text and no excerpt lines.
    4. `describe` rejecting gives the "Description unavailable right now…" text; `detail.link.href` is still the record link.
    5. Stale guard: click A (describe pending), click B, resolve A's describe, and assert the detail heading and text still belong to B.
    6. Clicking empty space clears `detail` (returns no `detail`) and aborts the pending describe signal.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
  - `source.js`:
```js
    async describe(smrs, signal) {
      const response = await fetchImpl(
        `${baseUrl}/record?${new URLSearchParams({ smrs })}`,
        { signal },
      );
      if (response.status === 503) {
        await response.body?.cancel();
        throw Object.assign(new Error('SMR description busy'), { code: 'description_busy' });
      }
      if (!response.ok) throw new Error(`Heritage record failed (${response.status})`);
      return response.json();
    },
```
  - `index.js`, following its existing selection functions (read them first; after the final fix wave they include `clearSelection`, the click handler that sets `state.selectedId`, and `getRowControls`):
    - add `export function excerptLines(text, { width = 46, lines = 3 } = {})` (split on spaces, fill lines up to `width`, stop at `lines`, and append `…` to the last line when words remain; a single word longer than `width` is cut to `width - 1` plus `…`);
    - add state `detail: null`, `detailAbort: null`, `rowControlsListener: null`;
    - `setRowControlsListener(listener)` stores it; a `notifyRow()` helper calls it;
    - on selecting record `R`: abort any `detailAbort`; set `state.detail = { record: R, status: 'loading' }`; `notifyRow()`; call `source.describe(R.smrs, signal)`; when it settles, return early unless `state.selectedId === R.id` and the signal is not aborted; on success set `status` to `'ready'` or `'none'` (description null) and `description`; on failure set `'error'`; then rebuild the entity's `gevLabelModel.details` as the existing lines plus `excerptLines(description)` (only when ready), re-call `registerEntityContext` with the same metadata plus `properties.description` (the description, or null), call `services.overlays?.refreshReadout?.(entity)`, and `notifyRow()`;
    - `clearSelection` and `disable` abort `detailAbort`, set `state.detail = null`, and `notifyRow()`;
    - `getRowControls()` adds `detail` built from `state.detail` as in Interfaces.
  - `src/app/layers/heritage.js`: import `{ refreshTrackedReadout }` from `'../../data/trackedReadout.js'` and pass `overlays: { refreshReadout: refreshTrackedReadout }` in `services`.
- [ ] **Step 4: Run the tests, then `npm test` and `npm run check:boundaries`.** If boundaries fails (for example the application-layer-construction group now reaching `src/data/trackedReadout.js`), stop and report the exact group and module line; do not edit `scripts/package-boundaries.json`.
- [ ] **Step 5: Format and commit**
```bash
npm run format && npm run format:check
git add src/layers/heritage/source.js src/layers/heritage/index.js src/app/layers/heritage.js src/layers/heritage/source.test.mjs src/layers/heritage/layer.test.mjs
git commit -m "feat(heritage): show monument descriptions and record links on selection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Voice `describe` mode

**Files:**
- Modify: `src/voice/actionSchemas.js` (`heritage_query`), `src/voice/heritageQuery.js`, `server/providers/openai/toolDescriptions.js`, `server/providers/openai/instructions.js`
- Modify: `src/voice/actionSchemas.test.mjs` (re-pin the complete-payload digest only)
- Test: `src/voice/heritageQuery.test.mjs`

**Interfaces:**
- Produces: `heritage_query` `mode` enum `['count', 'nearest', 'describe']` and a new `smrs: { type: 'string' }` property. `runHeritageQuery({ mode: 'describe', smrs })` resolves to `{ ok: true, mode: 'describe', name, monumentClass, townland, county, smrs, hasDescription, description, truncated, link, attribution, note? }` or `{ ok: false, error }`.

- [ ] **Step 1: Write the failing tests** in `src/voice/heritageQuery.test.mjs`:
  1. describe calls `/api/heritage/smr/record?smrs=MA070-110----` and returns the fields above with `hasDescription: true`;
  2. a description longer than 3,000 characters is cut to 3,000 with `truncated: true`;
  3. `description: null` gives `hasDescription: false` and `note: 'The record has no published description for this site yet.'`;
  4. a missing or malformed `smrs` (for example `"MA1' OR 1=1"`) returns `ok: false` without calling fetch;
  5. 404 → `ok: false` with an error mentioning the record; 503 → `ok: false` with an error saying the service is busy and to try again shortly.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
  - `actionSchemas.js`: change `mode.enum` to `['count', 'nearest', 'describe']`; add `smrs: { type: 'string' }` to `heritage_query`'s `properties`.
  - `heritageQuery.js`: before the existing count/nearest logic:
```js
const DESCRIBE_LIMIT = 3000;
const SMRS_PATTERN = /^[A-Z0-9*-]{6,20}$/;
const NO_DESCRIPTION = 'The record has no published description for this site yet.';
```
  and, as the first branch in `runHeritageQuery` (it does not need the camera view):
```js
  if (args?.mode === 'describe') {
    const smrs = typeof args.smrs === 'string' ? args.smrs.trim() : '';
    if (!SMRS_PATTERN.test(smrs))
      return {
        ok: false,
        error: 'Say which monument: select it on the map, or find one with the nearest mode first.',
      };
    const response = await fetchImpl(`${API}/record?${new URLSearchParams({ smrs })}`, { signal });
    if (response.status === 404)
      return { ok: false, error: 'That monument is not in the record.' };
    if (response.status === 503)
      return { ok: false, error: 'The monument service is busy. Try again in a minute.' };
    if (!response.ok) return { ok: false, error: 'Monument data is unavailable right now.' };
    const r = await response.json();
    const text = typeof r.description === 'string' ? r.description : null;
    return {
      ok: true,
      mode: 'describe',
      name: `${r.monumentClass}, ${r.townland}`,
      monumentClass: r.monumentClass,
      townland: r.townland,
      county: r.county,
      smrs: r.smrs,
      hasDescription: Boolean(text),
      description: text ? text.slice(0, DESCRIBE_LIMIT) : null,
      truncated: Boolean(text && text.length > DESCRIBE_LIMIT),
      link: r.link,
      attribution: ATTRIBUTION,
      ...(text ? {} : { note: NO_DESCRIPTION }),
    };
  }
```
  Keep the existing `getView()` check after this branch.
  - `toolDescriptions.js` `heritage_query`: append to the description `' mode "describe" with smrs returns the published description of one monument; get smrs from get_entity_context (selected.properties.smrs) or from a nearest result.'`, and add `smrs: { description: 'describe only. The SMR number, for example MA070-110----.', $position: <key count of the smrs schema> }` under `parameters.properties` (with `smrs: { type: 'string' }` the key count is 1, so `$position: 1`).
  - `instructions.js`: in the heritage line, replace the sentence that begins `The record holds no description of individual sites` (through `this particular site.`) with:
    `When asked what a monument is, or to tell the user about one, call heritage_query{mode:"describe",smrs} using selected.properties.smrs from get_entity_context or the smrs of a nearest result. Summarise the description in two or three plain spoken sentences (setting, what survives, any history); do not read it verbatim or spell out abbreviations such as "c." or "int.". If hasDescription is false, say the record has no published description yet and that the full record link is in the Monuments row of the layers panel.`
- [ ] **Step 4: Re-pin the complete-payload digest** in `src/voice/actionSchemas.test.mjs` using the digest the failing test prints; do not change any other digest (the legacy test already filters out `heritage_query`). Run `node --test src/voice/heritageQuery.test.mjs src/voice/actionSchemas.test.mjs src/radioMarkup.test.mjs src/firstRunExperience.test.mjs`, then `npm test`.
- [ ] **Step 5: Format and commit**
```bash
npm run format && npm run format:check
git add src/voice/actionSchemas.js src/voice/heritageQuery.js src/voice/heritageQuery.test.mjs src/voice/actionSchemas.test.mjs server/providers/openai/toolDescriptions.js server/providers/openai/instructions.js
git commit -m "feat(heritage): let voice describe a monument from its record

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Documentation and checks

**Files:**
- Modify: `docs/HERITAGE-SMR.md`, `DATA_SOURCES.md` (heritage row)

- [ ] **Step 1: Update `docs/HERITAGE-SMR.md`:** the "How it works" section (the new `/record` route contacts the service per newly selected monument, cached 30 days, 30 per minute), the map layer section (the Monuments row shows the selected monument's description and a "View full record" link; the card shows a 3-line excerpt), the voice table ("What is this?" now summarises the published description; remove the "no detail about this particular site" wording), the API table (`/record` with its errors), the curl smoke tests (the two `/record` calls from Task 1 Step 5), the manual browser checklist (description appears in the Monuments row after clicking; link opens the Historic Environment Viewer in a new tab; Tab reaches the text and link), and "Known limitations" (remove the "Many records have no public description" sentence; add "the first view of each monument needs a connection to the SMR service").
- [ ] **Step 2: Update the `DATA_SOURCES.md` heritage row** to say descriptions are fetched on demand per selected monument and cached locally (keep the attribution column unchanged).
- [ ] **Step 3: Checks**
```bash
npm run format:check && npm run check:boundaries && npm run layer-token:check -- --base-ref upstream/main && npm test && npm run build
```
Expected: all pass. Report any failure with its output; do not weaken tests.
- [ ] **Step 4: Commit**
```bash
git add docs/HERITAGE-SMR.md DATA_SOURCES.md
git commit -m "docs(heritage): document monument descriptions and record links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## After the plan (controller)

Push `feat/smr-heritage-layer` to `origin`, merge it into `local/notes-and-scenes` in the main folder, push that branch, restart the dev server, and remove the worktree (`git worktree remove ~/Projects/gods-eye-view-feat`).
