# Malad City

Top-down GTA-style game set in Malad, Mumbai. Single file, no dependencies.

## Run
```
cd malad-gta
python3 -m http.server 8000     # then open http://localhost:8000
```
Opening `index.html` directly also works, using the built-in schematic map.

## Real Malad street layout (optional)
```
node tools/fetch-osm.js         # writes malad-osm.json (roads, rail, water, parks from OpenStreetMap)
```
The game loads `malad-osm.json` automatically if it exists and is served over http.
Map data (c) OpenStreetMap contributors, ODbL. Landmark positions are approximate.

## Why not Street View?
The Street View Static API needs a billing-enabled API key, and Google's terms don't allow
bulk-downloading or redistributing the imagery inside a game. OSM data has no such restriction.

## Controls
WASD/arrows move and drive, E enter/exit vehicle, Space/click shoot (on foot) or handbrake, Shift sprint, H horn.
