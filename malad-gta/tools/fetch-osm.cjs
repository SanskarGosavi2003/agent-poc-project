// Downloads Malad (Mumbai) roads, rail, water, parks and building footprints from OpenStreetMap
// and writes a compact ../map.json (coordinates in metres) for the game.
// Usage (Node 18+):  node tools/fetch-osm.cjs
// Data (c) OpenStreetMap contributors, ODbL.
const fs = require('fs'), path = require('path');
const BBOX = [19.168, 72.828, 19.196, 72.858]; // south, west, north, east
const b = BBOX.join(',');
const q = `[out:json][timeout:180];(
 way["highway"]["highway"!~"footway|path|steps|cycleway|pedestrian|track|bridleway|corridor|proposed|construction|elevator"](${b});
 way["railway"="rail"](${b});
 way["natural"="water"](${b});
 way["waterway"~"river|stream|canal|drain"](${b});
 way["leisure"~"park|garden|pitch|playground"](${b});
 way["landuse"~"grass|recreation_ground|village_green|forest"](${b});
 way["natural"~"wood|scrub|grassland|wetland"](${b});
 way["building"](${b});
);out geom;`;
const MIRRORS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function convert(elements) {
  const [S, W, N, E] = BBOX, lat0 = (S + N) / 2 * Math.PI / 180;
  const mx = 111320 * Math.cos(lat0), my = 110574, r1 = v => Math.round(v * 10) / 10;
  const out = { v: 2, bbox: BBOX, size: [r1((E - W) * mx), r1((N - S) * my)], attribution: '(c) OpenStreetMap contributors, ODbL', roads: [], rails: [], water: [], parks: [], buildings: [] };
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry || el.geometry.length < 2) continue;
    const t = el.tags || {}, g = el.geometry, p = [];
    for (const n of g) p.push(r1((n.lon - W) * mx), r1((N - n.lat) * my));
    const closed = g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
    if (t.building) {
      if (!closed) continue;
      let h = parseFloat(t.height) || (parseFloat(t['building:levels']) * 3.2) || 0;
      out.buildings.push({ h: r1(h), p });
    } else if (t.highway) { const w0 = parseFloat(t.width) || (parseFloat(t.lanes) * 3.2) || 0; out.roads.push(w0 ? { k: t.highway, n: t.name || '', w0: r1(w0), p } : { k: t.highway, n: t.name || '', p }); }
    else if (t.railway === 'rail') out.rails.push({ p });
    else if (t.natural === 'water') out.water.push({ a: closed ? 1 : 0, w: 6, p });
    else if (t.waterway) out.water.push({ a: 0, w: t.waterway === 'river' ? 30 : 6, p });
    else if (closed) out.parks.push({ p });
  }
  return out;
}

(async () => {
  for (let round = 0; round < 3; round++) for (const url of MIRRORS) {
    try {
      console.log('Querying', url);
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'malad-gta-map-fetch/1.0' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j.elements || !j.elements.length) throw new Error('empty response');
      const m = convert(j.elements), out = path.join(__dirname, '..', 'map.json');
      fs.writeFileSync(out, JSON.stringify(m));
      console.log(`Wrote ${out}: ${m.roads.length} roads, ${m.buildings.length} buildings, ${m.rails.length} rail, ${m.water.length} water, ${m.parks.length} parks (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
      return;
    } catch (e) { console.error('Failed:', e.message); await sleep(5000 * (round + 1)); }
  }
  console.error('All mirrors failed. Wait a few minutes and rerun.');
  process.exit(1);
})();
