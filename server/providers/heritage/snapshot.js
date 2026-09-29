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
export const SMR_ATTRIBUTION =
  'National Monuments Service, Government of Ireland';
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
    ? value
        .trim()
        .toLowerCase()
        .replace(/\b\p{L}/gu, (c) => c.toUpperCase())
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
  const smrs =
    typeof attributes?.SMRS === 'string' ? attributes.SMRS.trim() : '';
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
      typeof attributes.WEBSITE_LINK === 'string'
        ? attributes.WEBSITE_LINK
        : null,
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
    unique.every(
      (r) => !r.link || r.link === template.replace('{SMRS}', r.smrs),
    );
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
        if (body?.error)
          throw new Error(`SMR service error ${body.error.code}`);
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
    if (!Array.isArray(body?.features))
      throw new Error('SMR page has no features');
    for (const feature of body.features) {
      const record = normalizeSmrAttributes(feature?.attributes);
      if (record) records.push(record);
    }
    log(`page ${page + 1}: ${records.length} records`);
    if (
      body.features.length < pageSize &&
      body.exceededTransferLimit !== true
    ) {
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
