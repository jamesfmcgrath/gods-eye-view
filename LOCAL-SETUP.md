# God's Eye View: Local Setup Notes

Local install of https://github.com/bilawalsidhu/gods-eye-view, set up on 2026-09-29.

## What was done

1. Read the README. Prerequisite: Node.js 24.x (24.14.0 or later) or 26.x.
2. Found that nvm only had Node up to v22 (the default), so installed Node 24.21.0 with `nvm install 24`. The nvm default was left at 22.
3. Cloned the repo into `~/Projects/gods-eye-view`.
4. Ran `npm ci` under Node 24: 129 packages installed, 0 vulnerabilities.
   - npm 11 skipped install scripts for `esbuild`, `fsevents`, and `puppeteer` (not approved via `allowScripts`). They were left unapproved; the dev server runs without them.
5. Ran `npm run doctor`: all checks passed, keyless mode confirmed.
6. Started `npm run dev` and confirmed the app responds at http://localhost:4173 (Vite 6.4.3).

No API keys have been added yet. No tracked repo files were changed. Added files (untracked): this file and `public/scene-assets/clew-bay/` (see [Custom scene: Clew Bay](#custom-scene-clew-bay)).

## Start and stop

Start:

```bash
cd ~/Projects/gods-eye-view
nvm use 24
npm run dev
```

Then open http://localhost:4173.

Alternative on macOS (clears the Vite cache and loads any keys saved in Keychain):

```bash
cd ~/Projects/gods-eye-view
nvm use 24
./scripts/dev-fresh.sh
```

Stop: press `Ctrl+C` in the terminal running it, or close that terminal.

If it was started somewhere you cannot reach (for example a background task), stop whatever is using port 4173:

```bash
lsof -ti :4173 | xargs kill
```

Check setup and which keys are configured (key values are not printed):

```bash
npm run doctor
```

## Keyless mode (default)

Works without any keys: Esri satellite imagery, keyless terrain, flights (anonymous OpenSky), military traffic, satellites, earthquakes, public cameras, radio, launches, weather layers, and simulated traffic.

## Adding keys (POWER UP panel)

Keys are entered in the app, not in a file by hand.

1. Click the **POWER UP** chip at the bottom right. If it is hidden, open http://localhost:4173/?setup=1.
2. Paste a key into its row and click **SAVE KEYS**.
3. The app writes the key to the repo-root `.env` (Git-ignored, owner-only permissions) and restarts itself.

Keys already set in your shell or macOS Keychain show as "configured externally" and cannot be edited in the panel.

### Photorealistic 3D: Cesium ion token (free for eligible personal, non-commercial use)

1. Sign up at https://cesium.com/ion and go to **Access Tokens**.
2. Create a token with only the `assets:read` scope. Add `http://localhost:4173` as an allowed URL.
3. Paste it into the **Cesium ion** row in POWER UP, then click **SAVE KEYS**.

This token is sent to the browser and is visible in devtools. The scope and URL restriction are what protect it.

The app loads Cesium ion asset 2275207 (Google Photorealistic 3D Tiles). If 3D does not appear, check whether that asset needs to be added to your account from the ion **Asset Depot**. This step was not verified.

Alternative: a direct Google Maps key (metered, billing required). Only needed for Google place search or commercial use. If you use one, restrict it by HTTP referrer and API in Google Cloud Console, and set a budget alert.

### Voice: OpenAI API key (metered)

1. At https://platform.openai.com, create a key under **API keys**. Set a monthly usage limit under Billing.
2. Paste it into the **OpenAI** row in POWER UP, then click **SAVE KEYS**.
3. Click **GEV MIC** and allow microphone access.

The key stays on the server; the browser receives only a short-lived session token. Spend is shown next to the mic, with a warning at $2 and a hard stop at $5 per session. The **MINI** toggle uses a cheaper model.

The chip reads **POWERED UP** once every key is configured.

### Other optional keys

| Key | Enables | Where |
| --- | --- | --- |
| AISStream | Live ships | https://aisstream.io (free) |
| NASA FIRMS | Active fires | https://firms.modaps.eosdis.nasa.gov/api/map_key/ (free) |
| TomTom | Live traffic flow colours | https://developer.tomtom.com (free tier) |
| OpenSky | More flight polling credits | https://opensky-network.org |
| Launch Library 2 | Higher launch data allowance | https://thespacedevs.com |

## Using the app

- **First-run panel:** choose Live Contacts, Space Missions, Environmental, or Explore Manually.
- **Track aircraft:** turn on **Flights** and click a plane to lock on and see its telemetry. **COCKPIT** (or `C`) rides along with it. **Contacts** lists other aircraft within 250 km.
- **Cameras:** turn on **Cameras** over Austin, London, California, Finland, or Delaware (Delaware has live video). Switch coverage to **VIEWSHED** to see what each camera can see.
- **Satellites:** turn them on and click the ISS to follow it.
- **Draw:** under DISPLAY, choose **Draw**, then Area, Line, or Pin. Click to add points, double-click to finish, then add a label.
- **Reset:** **Reset Globe** returns to the starting view.

Keyboard:

| Key | Action |
| --- | --- |
| `1` to `7` | Visual styles (CRT, NVG, FLIR, and others) |
| `H` | HUD |
| `D` | Detection overlay |
| `C` | Cockpit |
| `` ` `` | Frame rate |
| `Esc` | Exit current mode |

Voice examples (requires OpenAI key):

- "Take me to LAX and select the nearest airborne aircraft."
- "Switch to night vision and turn on the flights layer."
- "How many flights are over Texas right now?"
- "Outline the state of Texas."
- "Clear the map."
- "Zoom out to a globe view."

## Custom scene: Clew Bay

A scripted camera tour, "Granuaile's Clew Bay", built with the app's Scenes feature and GeoJSON data packs. No app code was changed.

### Files

All in `public/scene-assets/clew-bay/`:

| File | Purpose |
| --- | --- |
| `clew-bay.scene.json` | Scene document (version 6): 1 scene, 11 shots, 3 data packs |
| `sites.geojson` | 8 heritage points |
| `greenway.geojson` | Great Western Greenway line (approximate) |
| `smr-monuments.geojson` | 1,008 Sites and Monuments Record points around Clew Bay |
| `fetch_smr.py` | Downloads the SMR points and writes `smr-monuments.geojson` |
| `build_clew_bay.py` | Writes the scene document, `sites.geojson`, and `greenway.geojson` |

Tour order: Atlantic overview, Croagh Patrick, Murrisk Abbey, Westport House, Burrishoole Friary, Rockfleet Castle, Greenway overview, Kildavnet Castle (Achill), Granuaile's Castle (Clare Island), Clare Island Abbey, closing wide shot.

### Run the tour

1. Start the app (see [Start and stop](#start-and-stop)).
2. Open the **SCENES** panel.
3. Optional: click **EXPORT PRESETS** first. Importing replaces the current scenes project, including the built-in scenes.
4. Click **IMPORT** and choose `public/scene-assets/clew-bay/clew-bay.scene.json`. In the file picker, `Cmd+Shift+G` lets you paste the folder path.
5. Review the preview and click **Apply import**.
6. Select "Granuaile's Clew Bay" and click **START**. **NEXT** skips a shot, **STOP** ends the tour.

The data packs load from `/scene-assets/` on the local dev server, so the scene only works on this install. To share it, use **SHARE SCENE**, then **Download asset bundle**, and select the three `.geojson` files (or the `clew-bay` folder). Bundles must be re-imported after reloading the app.

### How the data was built

- Site coordinates: OpenStreetMap, via the Nominatim search API.
- Ground heights: Open-Meteo elevation API. Croagh Patrick uses the published 764 m, because the elevation model returns 722 m.
- The app places data by height above the WGS84 ellipsoid, not sea level. The script adds about 57 m (approximate geoid height for west Mayo), plus 30 m for points and 15 m for the line so they sit above the ground.
- Camera positions are calculated from each target, a heading, a pitch, and a height above it.

Sites and Monuments Record (SMR) pack:

- Source: National Monuments Service `SMROpenData` ArcGIS FeatureServer (151,308 records nationally). Licence: CC BY 4.0, attributed to "National Monuments Service, Government of Ireland". See https://www.archaeology.ie/collections-and-publications/open-data/.
- Filter: an ArcGIS envelope query for the box west -10.05, south 53.72, east -9.45, north 54.0. The service projects the box into the Irish grid, so it returns a slightly larger area: 1,008 records, of which 906 lie strictly inside the latitude/longitude box (the new `/api/heritage/smr` route reports 906 for the same box).
- Most common classes: enclosure (166), hut site (63), fulacht fia (61), ringfort - rath (57).
- Feature IDs read "Class, Townland (SMR number)", for example "Megalithic structure, Keel East (MA042-021002-)". Look up an SMR number in the Historic Environment Viewer for full details.
- Heights: Open-Meteo elevation, plus 57 m geoid offset, plus 20 m lift. Open-Meteo rate-limits bulk requests, so the script pauses between batches and retries on HTTP 429. A full run takes a few minutes.
- A data pack holds at most 2,000 features. The script stops with an error if the box contains more.

### Limitations

- The Greenway line is a placeholder: 8 village waypoints (Westport, Kilmeena, Newport, Burrishoole Bridge, Rosturk, Mulranny, Tonragee, Achill Sound) joined by straight lines. Some segments cross land or water. Replace it with the official GPX track.
- The app ignores GeoJSON properties. All points are cyan dots and the line is cyan, with no on-screen labels. A point's name appears only as its entity name when selected, so the feature `id` values are the place names.
- Camera framing was calculated, not checked by eye. Adjust shots in the app with **UPDATE SHOT**, then export.
- Google Photorealistic 3D coverage in rural Mayo is likely limited, so expect satellite imagery on terrain rather than modelled buildings.
- The 8 tour points and the 1,008 SMR points are both cyan, so they look the same. Different colours need a code change in `src/scenes/dataPacks/geometry.js` (fork).
- Historical claims in the shot titles have not been verified.
- Attribution: tour point coordinates and the Greenway waypoints are OpenStreetMap contributors (ODbL-1.0); SMR points are National Monuments Service, Government of Ireland (CC BY 4.0). Keep both if you share the scene.

### Edit and regenerate

Edit the `SITES`, `GREENWAY`, or `shots` lists in `build_clew_bay.py`, or `BBOX` in `fetch_smr.py`, then run:

```bash
cd ~/Projects/gods-eye-view/public/scene-assets/clew-bay
python3 fetch_smr.py        # only needed when BBOX changes or to refresh SMR data
python3 build_clew_bay.py
```

Each script overwrites its own output files in that folder. Re-import the scene afterwards.

Format references in the repo: `docs/SCENE-DOCUMENT.md`, `docs/DIRECTOR-DATA-PACKS.md`, `docs/DIRECTOR-SHARING.md`.

## SMR heritage layer and voice (feature branch)

Branch `feat/smr-heritage-layer` adds a **Monuments (SMR)** map layer and a `heritage_query` voice tool, built from the plan at `docs/superpowers/plans/2026-09-29-smr-heritage-layer.md`. Full usage, API and testing guide: `docs/HERITAGE-SMR.md` (committed on the branch).

Quick start:

```bash
cd ~/Projects/gods-eye-view
git switch feat/smr-heritage-layer
nvm use 24
npm run smr:snapshot   # once; about 5 minutes; writes .gev-cache/smr/snapshot.json
npm run dev
```

Then turn on **Monuments (SMR)** under **Heritage** in the layers panel and zoom in over Ireland.

Status (2026-09-29):

- 22 commits on the feature branch; all CI-equivalent checks pass (tests, format, boundaries, layer tokens, build).
- Pushed to your public fork https://github.com/jamesfmcgrath/gods-eye-view (branch `feat/smr-heritage-layer`) on 2026-09-30. Nothing has been proposed upstream.
- Remotes: `origin` = your fork, `upstream` = bilawalsidhu/gods-eye-view with pushing disabled (`upstream DISABLE (push)`). Get upstream updates with `git fetch upstream` then `git merge upstream/main` on `main`, and `git push origin main`.
- Not yet checked by hand: the browser checks and voice checks listed in `docs/HERITAGE-SMR.md`.
- The snapshot holds 140,428 located records; about 10,900 service records have no mapped location and are excluded.
- Follow-up: on-map class labels (native Cesium labels are banned by the repo; needs the world-overlay label system).
- 2026-09-30: added monument descriptions and record links. Select a monument: the Monuments row in the layers panel shows its published description (about 88% of records have one) and a "View full record in the Historic Environment Viewer" link; the map card shows a short excerpt; voice "what is this?" summarises the description. Descriptions are fetched on demand from the National Monuments Service and cached for 30 days in `.gev-cache/smr/records/`, so the first view of each monument needs a connection. Plan: `docs/superpowers/plans/2026-09-30-smr-descriptions.md`.
- Next planned: flag the 100 "Monuments to Visit" sites, and Wikipedia/Wikidata summaries for notable sites.
- To return to the main app: `git switch main`.

## Security notes

- The server binds to localhost only. Keep it that way.
- Running with `--host 0.0.0.0` exposes it on your network, and anyone who can reach it can use your configured keys. See `SECURITY.md` before doing that.
- `.env` holds keys in plaintext. It is Git-ignored; do not commit or share it.

## Updating

```bash
cd ~/Projects/gods-eye-view
git pull
nvm use 24
npm ci
npm run doctor
```
