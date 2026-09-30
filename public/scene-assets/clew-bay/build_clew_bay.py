"""Generate the Clew Bay GEV scene document and GeoJSON data packs."""
import json
import math
import pathlib

OUT = pathlib.Path('/Users/jamesmcgrath/Projects/gods-eye-view/public/scene-assets/clew-bay')
N = 57.0  # Approximate geoid undulation (EGM96) for west Mayo, metres.
MARKER_LIFT = 30.0  # Float point markers above ground so they stay visible.
LINE_LIFT = 15.0

# (id, lat, lon, ground metres above sea level). Coordinates from OSM Nominatim;
# ground heights from Open-Meteo elevation API (Croagh Patrick uses published 764 m).
SITES = [
    ('Croagh Patrick summit', 53.76003, -9.65925, 764),
    ('Murrisk Abbey', 53.78207, -9.63947, 3),
    ('Westport House', 53.80069, -9.53552, 4),
    ('Burrishoole Friary', 53.89882, -9.57226, 0),
    ('Rockfleet Castle', 53.89599, -9.62704, 6),
    ("Granuaile's Castle, Clare Island", 53.79968, -9.95104, 0),
    ('Clare Island Abbey', 53.79324, -9.98899, 28),
    ('Kildavnet Castle, Achill', 53.88085, -9.94589, 8),
]

# Rough waypoints only. Replace with the official GPX track.
GREENWAY = [
    (53.8045, -9.5215, 40),   # Westport
    (53.83538, -9.54963, 32),  # Kilmeena
    (53.8848, -9.54667, 14),  # Newport
    (53.90214, -9.57211, 0),  # Burrishoole Bridge
    (53.9, -9.71778, 13),     # Rosturk
    (53.90741, -9.77011, 19),  # Mulranny
    (53.94917, -9.86528, 25),  # Tonragee
    (53.92964, -9.92745, 7),  # Achill Sound
]


def ell(ground, lift):
    return round(ground + N + lift, 1)


def camera(lat, lon, ground, heading, pitch, height_above):
    """Place the camera so it looks at (lat, lon) from height_above metres."""
    horizontal = height_above / math.tan(math.radians(abs(pitch)))
    back = math.radians(heading + 180)
    dlat = horizontal * math.cos(back) / 111320
    dlon = horizontal * math.sin(back) / (111320 * math.cos(math.radians(lat)))
    return {
        'lat': round(lat + dlat, 5),
        'lon': round(lon + dlon, 5),
        'alt': round(ground + N + height_above),
        'heading': heading,
        'pitch': pitch,
        'roll': 0,
    }


sites = {
    'type': 'FeatureCollection',
    'features': [
        {
            'type': 'Feature',
            'id': name,
            'properties': {},
            'geometry': {'type': 'Point', 'coordinates': [lon, lat, ell(g, MARKER_LIFT)]},
        }
        for name, lat, lon, g in SITES
    ],
}
greenway = {
    'type': 'FeatureCollection',
    'features': [{
        'type': 'Feature',
        'id': 'Great Western Greenway (approximate)',
        'properties': {},
        'geometry': {
            'type': 'LineString',
            'coordinates': [[lon, lat, ell(g, LINE_LIFT)] for lat, lon, g in GREENWAY],
        },
    }],
}

osm = 'Coordinates: OpenStreetMap contributors via Nominatim. Heights: Open-Meteo elevation API.'
packs = [
    {
        'id': 'heritage-sites',
        'version': 1,
        'format': 'geojson',
        'source': {'adapter': 'assets', 'path': 'clew-bay/sites.geojson'},
        'attribution': {'text': osm, 'license': 'ODbL-1.0', 'url': 'https://www.openstreetmap.org/copyright'},
        'placement': {'altitudeReference': 'ellipsoid'},
    },
    {
        'id': 'greenway',
        'version': 1,
        'format': 'geojson',
        'source': {'adapter': 'assets', 'path': 'clew-bay/greenway.geojson'},
        'attribution': {
            'text': 'Approximate route sketched from village waypoints (OpenStreetMap contributors). Not the official track.',
            'license': 'ODbL-1.0',
            'url': 'https://www.openstreetmap.org/copyright',
        },
        'placement': {'altitudeReference': 'ellipsoid'},
    },
    {
        # Written by fetch_smr.py; run that first.
        'id': 'smr-monuments',
        'version': 1,
        'format': 'geojson',
        'source': {'adapter': 'assets', 'path': 'clew-bay/smr-monuments.geojson'},
        'attribution': {
            'text': 'Sites and Monuments Record: National Monuments Service, Government of Ireland. Heights: Open-Meteo elevation API.',
            'license': 'CC-BY-4.0',
            'url': 'https://www.archaeology.ie/collections-and-publications/open-data/',
        },
        'placement': {'altitudeReference': 'ellipsoid'},
    },
]
ALL = ['heritage-sites', 'greenway', 'smr-monuments']
S = {name: (lat, lon, g) for name, lat, lon, g in SITES}


def shot(sid, title, cam, flight=6, hold=4):
    return {
        'id': sid,
        'title': title,
        'durationSec': flight,
        'holdSec': hold,
        'camera': cam,
        'visual': {'style': 'normal'},
        'dataPackIds': ALL,
    }


shots = [
    shot('overview', 'Clew Bay from the Atlantic',
         camera(53.84, -9.72, 0, 75, -30, 14000), flight=4, hold=5),
    shot('croagh-patrick', 'Croagh Patrick, the Reek',
         camera(*S['Croagh Patrick summit'], 190, -20, 900)),
    shot('murrisk', 'Murrisk Abbey, pilgrim start of the Reek',
         camera(*S['Murrisk Abbey'], 210, -35, 350)),
    shot('westport-house', 'Westport House, seat of Granuaile\'s descendants',
         camera(*S['Westport House'], 20, -35, 400)),
    shot('burrishoole', 'Burrishoole Friary',
         camera(*S['Burrishoole Friary'], 340, -35, 350)),
    shot('rockfleet', 'Rockfleet Castle, Granuaile\'s stronghold',
         camera(*S['Rockfleet Castle'], 30, -30, 300)),
    shot('greenway', 'The Great Western Greenway, Westport to Achill',
         camera(53.87, -9.72, 0, 350, -35, 18000), flight=7, hold=5),
    shot('kildavnet', 'Kildavnet Castle, Achill',
         camera(*S['Kildavnet Castle, Achill'], 280, -30, 300)),
    shot('clare-island', "Granuaile's Castle, Clare Island",
         camera(*S["Granuaile's Castle, Clare Island"], 270, -30, 400)),
    shot('clare-abbey', 'Clare Island Abbey, her reputed resting place',
         camera(*S['Clare Island Abbey'], 250, -35, 350)),
    shot('finale', 'Clew Bay and its islands',
         camera(53.83, -9.72, 0, 100, -45, 30000), flight=8, hold=6),
]

project = {
    'version': 6,
    'scenes': [{
        'id': 'clew-bay-granuaile',
        'title': "Granuaile's Clew Bay",
        'dataPacks': packs,
        'shots': shots,
    }],
}

OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'sites.geojson').write_text(json.dumps(sites, indent=2) + '\n')
(OUT / 'greenway.geojson').write_text(json.dumps(greenway, indent=2) + '\n')
(OUT / 'clew-bay.scene.json').write_text(json.dumps(project, indent=2, ensure_ascii=False) + '\n')
print('written to', OUT)
