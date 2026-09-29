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
      const response = await fetchImpl(`${baseUrl}/points?${params}`, {
        signal,
      });
      if (response.status === 503) {
        await response.body?.cancel();
        throw Object.assign(new Error('SMR snapshot missing'), {
          code: 'smr_snapshot_missing',
        });
      }
      if (!response.ok)
        throw new Error(`Heritage request failed (${response.status})`);
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
