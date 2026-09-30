import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { createSmrRecordFetcher, isSmrsId } from './heritage/records.js';
import { createSmrIndex } from './heritage/smrIndex.js';
import {
  loadSmrSnapshotFile,
  validateSmrSnapshot,
  SMR_SNAPSHOT_PATH,
  SMR_ATTRIBUTION,
  SMR_LICENCE,
} from './heritage/snapshot.js';
import { parseHeritageTypes } from '../../src/data/heritageClasses.js';

const ROUTES = new Set(['/status', '/points', '/stats', '/nearest', '/record']);
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
  return Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
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

/**
 * SMR queries for dev and preview: points, stats and nearest use the local
 * snapshot; /record fetches one description on demand, cached and budgeted.
 */
export function heritageProxy({
  loadSnapshot = () => loadSmrSnapshotFile(SMR_SNAPSHOT_PATH),
  recordFetcher = createSmrRecordFetcher({
    fetchImpl: (...args) => globalThis.fetch(...args),
  }),
} = {}) {
  let indexPromise = null;
  const allow = makeRateLimiter({
    windowMs: 60_000,
    max: 240,
    globalMax: 2400,
  });

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
    const json = (status, value, headers = {}) => {
      if (res.destroyed) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(status === 405 ? { Allow: 'GET' } : {}),
        ...(status === 429 ? { 'Retry-After': '60' } : {}),
        ...headers,
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
          return json(
            503,
            { error: 'description_busy' },
            { 'Retry-After': '60' },
          );
        return json(502, { error: 'description_unavailable' });
      }
    }

    if (route === '/points') {
      const box = readBox(params, POINTS_MAX_SPAN_DEG);
      if (!box) return json(400, { error: 'invalid_box' });
      const limit = intParam(params, 'limit', 1, 1500, 1000);
      return json(200, {
        ...index.points({ box, types: types.keys, limit }),
        ...meta,
      });
    }

    if (route === '/stats') {
      const box = readBox(params, STATS_MAX_SPAN_DEG);
      const lat = numberParam(params, 'lat', -90, 90);
      const lon = numberParam(params, 'lon', -180, 180);
      const km = numberParam(params, 'km', 0.1, 500);
      const circle =
        lat !== null && lon !== null && km !== null ? { lat, lon, km } : null;
      if (Boolean(box) === Boolean(circle))
        return json(400, { error: 'invalid_scope' });
      return json(200, {
        ...index.stats({ box, circle, types: types.keys }),
        ...meta,
      });
    }

    const lat = numberParam(params, 'lat', -90, 90);
    const lon = numberParam(params, 'lon', -180, 180);
    if (lat === null || lon === null)
      return json(400, { error: 'invalid_point' });
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
