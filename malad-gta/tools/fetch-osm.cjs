// Downloads Malad (Mumbai) roads, rail, water and parks from OpenStreetMap via Overpass.
// Usage (Node 18+):  node tools/fetch-osm.cjs   ->  writes ../malad-osm.json
// Data (c) OpenStreetMap contributors, ODbL.
const fs = require('fs'), path = require('path');
const BBOX = [19.168, 72.825, 19.205, 72.870]; // south, west, north, east
const b = BBOX.join(',');
const q = `[out:json][timeout:180];(
 way["highway"]["highway"!~"footway|path|steps|cycleway|pedestrian|track|bridleway|corridor|proposed|construction|elevator"](${b});
 way["railway"="rail"](${b});
 way["natural"="water"](${b});
 way["waterway"~"river|stream|canal|drain"](${b});
 way["leisure"~"park|garden|pitch|playground"](${b});
 way["landuse"~"grass|recreation_ground|village_green|forest"](${b});
 way["natural"~"wood|scrub|grassland|wetland"](${b});
);out geom;`;
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let round = 0; round < 3; round++) for (const url of MIRRORS) {
    try {
      console.log('Querying', url);
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'malad-gta-map-fetch/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const out = path.join(__dirname, '..', 'malad-osm.json');
      fs.writeFileSync(out, JSON.stringify({ bbox: BBOX, attribution: '(c) OpenStreetMap contributors, ODbL', elements: j.elements }));
      console.log('Wrote', out, j.elements.length, 'ways');
      return;
    } catch (e) { console.error('Failed:', e.message); await sleep(5000 * (round + 1)); }
  }
  console.error('All mirrors failed. Wait a few minutes and rerun.');
  process.exit(1);
})();
