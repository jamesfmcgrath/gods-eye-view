"""Fetch Sites and Monuments Record points around Clew Bay into a GEV data pack.

Source: National Monuments Service SMROpenData FeatureServer (CC BY 4.0,
National Monuments Service, Government of Ireland). Ground heights come from
the Open-Meteo elevation API. Writes smr-monuments.geojson next to this file.
"""
import json
import pathlib
import time
import urllib.parse
import urllib.request

OUT = pathlib.Path(__file__).resolve().parent / 'smr-monuments.geojson'
SERVICE = ('https://services-eu1.arcgis.com/HyjXgkV6KGMSF3jt/arcgis/rest/services/'
           'SMROpenData/FeatureServer/0/query')
BBOX = '-10.05,53.72,-9.45,54.0'  # west,south,east,north around Clew Bay.
N = 57.0  # Approximate geoid undulation for west Mayo, metres.
LIFT = 20.0  # Float markers above ground so they stay visible.
PACK_LIMIT = 2000  # GEV data pack feature cap.
UA = {'User-Agent': 'gev-clewbay-draft/0.1 (local)'}


def get_json(url, retries=6):
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt == retries - 1:
                raise
            time.sleep(15 * (attempt + 1))  # Rate limited: back off and retry.


def fetch_records():
    params = {
        'where': '1=1',
        'geometry': BBOX,
        'geometryType': 'esriGeometryEnvelope',
        'inSR': 4326,
        'spatialRel': 'esriSpatialRelIntersects',
        'outFields': 'SMRS,MONUMENT_CLASS,TOWNLAND,LATITUDE,LONGITUDE',
        'returnGeometry': 'false',
        'orderByFields': 'SMRS',
        'resultRecordCount': PACK_LIMIT,
        'f': 'json',
    }
    data = get_json(f'{SERVICE}?{urllib.parse.urlencode(params)}')
    if data.get('exceededTransferLimit'):
        raise SystemExit('More records than one pack allows; narrow BBOX.')
    return [f['attributes'] for f in data['features']]


def elevations(points):
    heights = []
    for i in range(0, len(points), 100):  # Open-Meteo accepts 100 points per call.
        chunk = points[i:i + 100]
        url = 'https://api.open-meteo.com/v1/elevation?' + urllib.parse.urlencode({
            'latitude': ','.join(f'{p[0]:.5f}' for p in chunk),
            'longitude': ','.join(f'{p[1]:.5f}' for p in chunk),
        })
        heights += get_json(url)['elevation']
        time.sleep(5)
    return heights


def main():
    records = [r for r in fetch_records() if r['LATITUDE'] and r['LONGITUDE']]
    heights = elevations([(r['LATITUDE'], r['LONGITUDE']) for r in records])
    features, seen = [], set()
    for r, ground in zip(records, heights):
        # Properties are ignored by GEV, so the ID is the only visible label.
        fid = f"{r['MONUMENT_CLASS']}, {r['TOWNLAND'].title()} ({r['SMRS']})"
        if fid in seen:
            continue
        seen.add(fid)
        z = round(max(ground, 0) + N + LIFT, 1)
        features.append({
            'type': 'Feature',
            'id': fid,
            'properties': {},
            'geometry': {'type': 'Point',
                         'coordinates': [round(r['LONGITUDE'], 6), round(r['LATITUDE'], 6), z]},
        })
    OUT.write_text(json.dumps({'type': 'FeatureCollection', 'features': features}) + '\n')
    print(f'{len(features)} features written to {OUT}')


if __name__ == '__main__':
    main()
