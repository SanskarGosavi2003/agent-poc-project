# Malad Vice

Third-person 3D open-world game set in Malad, Mumbai, with a Vice City sunset look. Three.js (vendored), no build step.

## Run
```
cd malad-gta
node tools/fetch-osm.cjs        # once: writes map.json (real Malad roads, rail, water, parks, building footprints)
python3 -m http.server 8000     # then open http://localhost:8000
```
Without `map.json` the game falls back to a schematic map. It must be served over http (not opened as a file).

## Deploy (Vercel)
Commit `map.json`, import the repo in Vercel, set Root Directory to `malad-gta`, Framework "Other", no build command.

## Map data
Roads and building footprints come from OpenStreetMap ((c) OpenStreetMap contributors, ODbL). Building heights use OSM tags
where present and are estimated otherwise; where OSM has no buildings mapped, generic ones are generated along the roads.
Landmark positions are approximate. Google Street View imagery is not used: it needs a paid API key and Google's terms
don't allow downloading it to reconstruct or redistribute a city.

## Controls
WASD move/drive, mouse look, E enter/exit vehicle, click or F shoot, Shift sprint, Space handbrake, H horn.
