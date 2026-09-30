import * as Cesium from 'cesium';
import { HERITAGE_TYPES, MAX_HERITAGE_TYPES } from '../data/heritageClasses.js';

const API = '/api/heritage/smr';
const STATS_MAX_SPAN_DEG = 12;
const ATTRIBUTION =
  'Sites and Monuments Record: National Monuments Service, Government of Ireland (CC BY 4.0)';
const DESCRIBE_LIMIT = 3000;
const SMRS_PATTERN = /^[A-Z0-9*-]{6,20}$/;
const NO_DESCRIPTION =
  'The record has no published description for this site yet.';
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
    if (candidate.north > candidate.south && candidate.east > candidate.west)
      box = candidate;
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
  if (args?.mode === 'describe') {
    const smrs = typeof args.smrs === 'string' ? args.smrs.trim() : '';
    if (!SMRS_PATTERN.test(smrs))
      return {
        ok: false,
        error:
          'Say which monument: select it on the map, or find one with the nearest mode first.',
      };
    const response = await fetchImpl(
      `${API}/record?${new URLSearchParams({ smrs })}`,
      { signal },
    );
    if (response.status === 404)
      return { ok: false, error: 'That monument is not in the record.' };
    if (response.status === 503)
      return {
        ok: false,
        error: 'The monument service is busy. Try again in a minute.',
      };
    if (!response.ok)
      return { ok: false, error: 'Monument data is unavailable right now.' };
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
  const mode = args?.mode === 'nearest' ? 'nearest' : 'count';
  const types = (Array.isArray(args?.types) ? args.types : [])
    .filter((key) => Object.hasOwn(HERITAGE_TYPES, key))
    .slice(0, MAX_HERITAGE_TYPES);
  const view = getView();
  if (!view)
    return { ok: false, error: 'The camera position is not available yet.' };

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
      const km =
        Math.round(clamp(args?.scope?.km, 0.1, 500, view.radiusKm) * 10) / 10;
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
  if (!response.ok)
    return { ok: false, error: 'Monument data is unavailable right now.' };
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
