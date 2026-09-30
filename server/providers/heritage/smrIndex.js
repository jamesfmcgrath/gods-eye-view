import { haversineKm } from '../common/geo.js';
import { classMatchesTypes } from '../../../src/data/heritageClasses.js';

const CELL_DEG = 0.1;
const cellOf = (deg) => Math.floor(deg / CELL_DEG);
const TOP_CLASSES = 12;

/** In-memory grid index over a validated SMR snapshot. */
export function createSmrIndex(snapshot) {
  const { rows, classes, counties, linkTemplate, fetchedAt } = snapshot;
  const grid = new Map();
  const bounds = {
    south: Infinity,
    west: Infinity,
    north: -Infinity,
    east: -Infinity,
  };
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

  const bySmrs = new Map(rows.map((row, i) => [row[0], i]));

  const masks = new Map();
  function classMask(types = []) {
    const key = types.join(',');
    if (!masks.has(key))
      masks.set(
        key,
        classes.map((c) => classMatchesTypes(c, types)),
      );
    return masks.get(key);
  }

  function* inBox(box) {
    for (let a = cellOf(box.south); a <= cellOf(box.north); a++) {
      for (let b = cellOf(box.west); b <= cellOf(box.east); b++) {
        const cell = grid.get(`${a}:${b}`);
        if (!cell) continue;
        for (const i of cell) {
          const r = rows[i];
          if (
            r[4] >= box.south &&
            r[4] <= box.north &&
            r[5] >= box.west &&
            r[5] <= box.east
          )
            yield i;
        }
      }
    }
  }

  function circleBox({ lat, lon, km }) {
    const dLat = km / 111.32;
    const dLon = km / (111.32 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return {
      south: lat - dLat,
      north: lat + dLat,
      west: lon - dLon,
      east: lon + dLon,
    };
  }

  function matching({ box, circle, types }) {
    const mask = classMask(types);
    const found = [];
    for (const i of inBox(box || circleBox(circle))) {
      if (!mask[rows[i][1]]) continue;
      if (
        circle &&
        haversineKm(circle.lat, circle.lon, rows[i][4], rows[i][5]) > circle.km
      )
        continue;
      found.push(i);
    }
    return found;
  }

  function sortByDistance(ids, point) {
    const distance = new Map(
      ids.map((i) => [
        i,
        haversineKm(point.lat, point.lon, rows[i][4], rows[i][5]),
      ]),
    );
    ids.sort(
      (a, b) =>
        distance.get(a) - distance.get(b) || (rows[a][0] < rows[b][0] ? -1 : 1),
    );
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
    find(smrs) {
      const i = bySmrs.get(smrs);
      return i === undefined ? null : toRecord(i);
    },
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
      for (const i of ids)
        counts.set(rows[i][1], (counts.get(rows[i][1]) || 0) + 1);
      const byClass = [...counts]
        .map(([c, count]) => ({ monumentClass: classes[c], count }))
        .sort(
          (a, b) =>
            b.count - a.count || a.monumentClass.localeCompare(b.monumentClass),
        );
      return {
        total: ids.length,
        byClass: byClass.slice(0, TOP_CLASSES),
        classCount: byClass.length,
      };
    },
    nearest({ lat, lon, types, limit, maxKm }) {
      const ids = matching({ circle: { lat, lon, km: maxKm }, types });
      const distance = sortByDistance(ids, { lat, lon });
      return {
        total: ids.length,
        records: ids.slice(0, limit).map((i) => toRecord(i, distance)),
      };
    },
  };
}
