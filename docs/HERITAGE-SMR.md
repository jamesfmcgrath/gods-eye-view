# Monuments (SMR) layer and heritage voice queries

Irish national monuments on the globe, plus voice questions such as "how many ringforts are in view?" and "take me to the nearest tower house".

Data: the National Monuments Service **Sites and Monuments Record (SMR)**, Republic of Ireland only. Licence: CC BY 4.0, attributed to "National Monuments Service, Government of Ireland" (<https://www.archaeology.ie/collections-and-publications/open-data/>).

## How it works

```
npm run smr:snapshot            (run once; the only step that contacts the SMR service)
        |
        v
.gev-cache/smr/snapshot.json    (about 9 MB, git-ignored)
        |
        v
/api/heritage/smr/...           (dev/preview server, in-memory grid index)
    |                     |
    v                     v
Monuments (SMR) layer    heritage_query voice tool
(points for the view)    (counts, nearest; coordinates -> fly_to_location)
```

- **Why a local snapshot.** The SMR ArcGIS service allows 3,000 request units per minute, shared by every consumer, including the government's own viewer. The app never queries it at runtime. Only `npm run smr:snapshot` does, and it pauses between pages and backs off on rate limits.
- **What is counted.** The service lists about 151,300 records. About 10,900 have no mapped location in the national record and are excluded, leaving about 140,400 located records. Every map point and voice count covers located records only.
- **Coverage.** The Republic of Ireland only. Northern Ireland is a separate dataset and is not included.

## Setup

1. Use Node 24: `nvm use 24`.
2. Download the snapshot (4 to 6 minutes):
   ```bash
   npm run smr:snapshot
   ```
   Expected output: about 76 `page N` lines, then `Wrote 140428 records (466 classes) to .../.gev-cache/smr/snapshot.json`. If a "Voice types with no matching class" warning appears, the service has renamed a class; update `src/data/heritageClasses.js`.
3. Start the app: `npm run dev`, then open <http://localhost:4173>.

Refresh the data by running `npm run smr:snapshot` again, then restarting the dev server. The server loads the snapshot once, on the first heritage request.

## Using the map layer

1. Open the data layers panel and turn on **Monuments (SMR)** in the **Heritage** group.
2. Zoom in to an area in Ireland. Points load for the current view, up to 1,000 at a time, nearest the centre first. The row shows `N in view`, or `N of M in view` when more exist.
3. If the view is wider than about 1.5 degrees, or you are looking at the sky, the row shows **Zoom in to see monuments** and no points are drawn.
4. Point colours show the monument family. The layer row shows a legend with counts:

   | Family              | Colour                   | Includes                                                                     |
   | ------------------- | ------------------------ | ---------------------------------------------------------------------------- |
   | Ringforts and forts | orange `#e69f00`         | raths, cashels, hillforts, promontory forts, crannogs                        |
   | Castles             | reddish purple `#cc79a7` | tower houses, mottes, hall-houses, bawns                                     |
   | Church sites        | sky blue `#56b4e9`       | churches, abbeys and friaries, graveyards, round towers, crosses, holy wells |
   | Tombs and stones    | bluish green `#009e73`   | megalithic tombs, stone circles, standing stones, ogham stones, rock art     |
   | Other               | grey `#bbbbbb`           | enclosures, fulachtaí fia, hut sites, souterrains and the rest               |

   The palette is based on Okabe-Ito, so the families stay distinguishable under common colour-vision deficiencies. Colour is not the only cue: the class shows on the selection card and in voice answers.

5. Click a point to select it. A card shows the class, townland, county and SMR number. Clicking empty space clears the selection. Clicks are ignored while another tool holds the pointer, such as Directions SET A/B or drawing.
6. To read the full record for a site, search its SMR number (for example `MA076-009----`) in the Historic Environment Viewer. Many records have no public description yet.

## Using voice

This needs an OpenAI key, added in POWER UP. Click **GEV MIC**, then ask, for example:

| You say                                          | What happens                                                                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "How many ringforts are in view?"                | A count for the current view, with the most common classes and a National Monuments Service credit                                                   |
| "How many holy wells are within ten kilometres?" | A count within a radius of the view centre                                                                                                           |
| "Take me to the nearest tower house."            | Finds the nearest one within 150 km, flies there, and turns on the Monuments layer if it is off                                                      |
| "What is this?" (after clicking a point)         | Class, townland and county, a general explanation of that type of monument, and a statement that the record has no detail about this particular site |
| "Where are the nearest stone circles?"           | Up to three nearest, with distances                                                                                                                  |

Spoken words are mapped to types: forts, raths and cashels; castles and tower houses; abbeys, friaries and priories (religious houses); dolmens (portal tombs); holy wells; stone circles; standing stones; ogham stones; round towers; high crosses; crannogs; hillforts; promontory forts; souterrains; fulachtaí fia; churches; graveyards; and megalithic, court, passage and wedge tombs. The full list is in `src/data/heritageClasses.js`.

Voice queries work whether or not the layer is on. Outside the Republic, a zero result comes with a note that the record does not cover that area.

Known limitation: "view centre" is the ground point under the camera. With a steeply tilted camera, that can be a few km from the point you are looking at.

## API reference

All routes are `GET`, localhost only (dev and preview servers), and send `Cache-Control: no-store`. `types` is an optional comma-separated list of up to 8 keys from `src/data/heritageClasses.js`.

| Route                       | Parameters                                                                                        | Returns                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `/api/heritage/smr/status`  | none                                                                                              | `{ ready, count, bounds, fetchedAt, attribution, licence }` |
| `/api/heritage/smr/points`  | `south, west, north, east` (span at most 1.5 degrees), `types`, `limit` (1 to 1500, default 1000) | `{ total, saturated, records[] }`                           |
| `/api/heritage/smr/stats`   | either a box (span at most 12 degrees) or `lat, lon, km` (0.1 to 500), plus `types`               | `{ total, byClass[] (top 12), classCount }`                 |
| `/api/heritage/smr/nearest` | `lat, lon`, `types`, `limit` (1 to 10, default 3), `maxKm` (1 to 300, default 150)                | `{ total, records[] with distanceKm }`                      |

Errors: 400 (`invalid_box`, `invalid_scope`, `invalid_point`, `unknown_type` with `unknown`, `too_many_types`), 404, 405, 429 (per-client limit of 240 per minute), 503 `smr_snapshot_missing` with a `hint`, and 500 `heritage_unavailable`.

## Testing

### Automated

```bash
nvm use 24
npm test                     # full suite (includes every heritage test)
npm run format:check
npm run check:boundaries
npm run layer-token:check -- --base-ref origin/main
npm run build
```

Heritage tests only:

```bash
node --test src/data/heritageClasses.test.mjs src/data/heritageSnapshot.test.mjs \
  src/data/heritageSmrIndex.test.mjs src/data/heritageSmrProxy.test.mjs \
  src/layers/heritage/source.test.mjs src/layers/heritage/layer.test.mjs \
  src/voice/heritageQuery.test.mjs src/voice/actionSchemas.test.mjs
```

### Server smoke test (with `npm run dev` running)

```bash
curl -s http://localhost:4173/api/heritage/smr/status
curl -s "http://localhost:4173/api/heritage/smr/stats?south=53.72&west=-10.05&north=54.0&east=-9.45"
curl -s "http://localhost:4173/api/heritage/smr/nearest?lat=53.88&lon=-9.55&types=tower-house&limit=1"
curl -s "http://localhost:4173/api/heritage/smr/nearest?lat=53.88&lon=-9.55&types=forts"
```

Expected, in order:

1. `count` is 140428.
2. The Clew Bay box total is 906.
3. The nearest tower house to Newport is returned, with `distanceKm`.
4. HTTP 400 with `"unknown":["forts"]`.

### Manual browser checks

These have not been run yet.

1. Turn on **Monuments (SMR)**, search "Newport, Mayo" and zoom in. Coloured points appear, and the legend shows five families with counts.
2. Zoom out past about 1.5 degrees. The row reads "Zoom in to see monuments" and the points clear.
3. Click a point. A card shows the class, townland, county and SMR number. Click empty ground and the card clears.
4. Arm Directions **SET A** and click a monument. The monument is not selected.
5. Check that the credits list includes "Monuments: National Monuments Service, Government of Ireland (CC BY 4.0)".
6. Stop the server, rename `.gev-cache/smr/snapshot.json`, restart, and turn on the layer. The row shows "SMR snapshot missing: run npm run smr:snapshot". Rename the file back.

### Manual voice checks

These need an OpenAI key and have not been run yet.

1. Over Newport, Mayo: "How many ringforts are in view?" You get a count and a credit.
2. "Take me to the nearest tower house." The camera flies there and the layer turns on.
3. Click a point, then ask "What is this?" The answer is general, with the no-detail statement.
4. Over London: "How many ringforts are in view?" You get zero, with the coverage note.
5. With the snapshot missing, ask any heritage question. The assistant says to run `npm run smr:snapshot`.
6. Optional routing check (small OpenAI cost): `node scripts/qa-voice-routing.mjs`. The three heritage phrases should route to `heritage_query`.

## Files

| Area                               | Files                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vocabulary, colours, legend labels | `src/data/heritageClasses.js`                                                                                                                                                                                             |
| Snapshot download                  | `server/providers/heritage/snapshot.js`, `scripts/smr-snapshot.mjs`                                                                                                                                                       |
| Index and route                    | `server/providers/heritage/smrIndex.js`, `server/providers/heritage.js` (registered in `server/providers/local.js`)                                                                                                       |
| Map layer                          | `src/layers/heritage/{policy,source,index}.js`, `src/app/layers/heritage.js`                                                                                                                                              |
| Voice                              | `src/voice/heritageQuery.js`, `src/voice/actionSchemas.js`, `src/voice/gevActions.js`, `server/providers/openai/{toolDescriptions,instructions}.js`                                                                       |
| Registration                       | `src/app/constructCatalog.js`, `src/standalone/layerSources.js`, `src/data/layerState.js` (token `0`), `src/ui/layerPanel.js`, `src/ui/styles/cyber.css`, `src/data/trackedReadout.js`, `scripts/package-boundaries.json` |
| Attribution                        | `src/data/dataCredits.js`, `DATA_SOURCES.md`, `SECURITY.md`                                                                                                                                                               |

## Known limitations and follow-ups

- No on-map text labels. The repo forbids native Cesium entity labels (`src/noCesiumLabels.test.mjs`). Class labels through the world-overlay label system are a follow-up.
- The selection card's ground anchor is sampled once per point. Terrain tiles that stream in later do not re-anchor it.
- Counts cover located records only (about 140k of about 151k).
- Voice "view centre" is the point under the camera, not the screen centre.
- Not yet done: Northern Ireland coverage, county-scoped voice counts ("how many castles in Mayo"), and snapshot age in `npm run doctor`.
