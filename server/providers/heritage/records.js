import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { SMR_QUERY_URL } from './snapshot.js';

export const SMR_RECORD_CACHE_DIR = path.join(
  process.cwd(),
  '.gev-cache',
  'smr',
  'records',
);
const USER_AGENT =
  'gods-eye-view-smr-record/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';
// Real SMR numbers use capitals, digits, hyphens and (rarely) '*', e.g.
// MA076-009----, CL003A001----, CL062-001---*. No quotes, dots or slashes,
// so the id is safe in the fixed query and in a cache file name.
const SMRS_PATTERN = /^[A-Z0-9*-]{6,20}$/;
const cacheName = (smrs) =>
  `${encodeURIComponent(smrs).replace(/\*/g, '%2A')}.json`;
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
      const value = JSON.parse(
        await fs.readFile(path.join(cacheDir, cacheName(smrs)), 'utf8'),
      );
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
    const attributes = body.features.find(
      (f) => f?.attributes?.SMRS === smrs,
    )?.attributes;
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
