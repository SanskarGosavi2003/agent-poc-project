import * as THREE from 'three';
import { mergeGeometries } from './vendor/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from './vendor/jsm/utils/SkeletonUtils.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

/* ================= helpers ================= */
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.random() * a.length | 0];
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let seed = 1337; const srand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const sr = (a, b) => a + srand() * (b - a);

/* ================= map data ================= */
const BBOX = [19.168, 72.828, 19.196, 72.858];
const LMS = [ // approximate positions
  ['Malad Station', 19.1869, 72.8486], ['Inorbit Mall', 19.1729, 72.8355], ['Mindspace', 19.1765, 72.8335],
  ['Infiniti Mall', 19.1846, 72.8345], ['Natraj Market', 19.1866, 72.8468], ['Liberty Garden', 19.1832, 72.8440],
  ['Orlem', 19.1915, 72.8385], ['Chincholi Bunder', 19.1808, 72.8392], ['Malad East', 19.1862, 72.8530], ['Pushpa Park', 19.1885, 72.8562],
];
const ROADW = { motorway: 16, trunk: 16, primary: 14, secondary: 11, tertiary: 9, unclassified: 7, residential: 7, living_street: 5, service: 4.5 };
const roadW = k => ROADW[k] || (k.endsWith('_link') ? 7 : 5);

function fallbackMap() {
  const roads = [], R = (k, n, ...p) => roads.push({ k, n, p });
  R('primary', 'Link Road', 700, 0, 690, 1500, 760, 3100);
  R('primary', 'S.V. Road', 1950, 0, 2020, 1000, 2040, 2000, 2000, 3100);
  R('trunk', 'Western Express Hwy', 3040, 0, 3060, 3100);
  R('secondary', 'Marve Road', 0, 800, 700, 950, 2020, 1050);
  R('secondary', 'Station Road', 2020, 1050, 2330, 1010, 3050, 1000);
  R('secondary', 'Chincholi Bunder Road', 690, 2000, 1400, 1900, 2040, 1850);
  for (let x = 180; x < 2950; x += 250) { if (Math.abs(x - 700) < 120 || Math.abs(x - 2000) < 130 || Math.abs(x - 2180) < 110) continue; R('residential', '', x, 60, x + sr(-40, 40), 1500, x + sr(-40, 40), 3040); }
  for (let z = 150; z < 3050; z += 230) { const j = sr(-30, 30); R('residential', '', 40, z, 1000, z + j, 2110, z); R('residential', '', 2250, z, 3040, z + j); }
  return {
    size: [3155, 3096], roads, rails: [{ p: [2180, 0, 2180, 3096] }, { p: [2188, 0, 2188, 3096] }],
    water: [{ a: 1, p: [0, 2600, 500, 2520, 640, 3096, 0, 3096] }], parks: [{ p: [1100, 1200, 1400, 1200, 1400, 1450, 1100, 1450] }], buildings: [],
  };
}

/* ================= world grid ================= */
const C = 1.5, OPEN = 0, ROAD = 1, BLD = 2, WATER = 3, RAIL = 4, PAVE = 5, PARK = 6;
let SX, SZ, GW, GH, grid, mini, landmarks = [], startPt, railFit = null;
const cellAt = (x, z) => { const cx = x / C | 0, cz = z / C | 0; return (x < 0 || z < 0 || cx >= GW || cz >= GH) ? BLD : grid[cz * GW + cx]; };
const solid = (x, z) => { const t = cellAt(x, z); return t === BLD || t === WATER; };
const footFree = (x, z) => !(solid(x - .35, z - .35) || solid(x + .35, z - .35) || solid(x - .35, z + .35) || solid(x + .35, z + .35));
function tracePath(x, p, close) { x.beginPath(); for (let i = 0; i < p.length; i += 2) i ? x.lineTo(p[i], p[i + 1]) : x.moveTo(p[i], p[i + 1]); if (close) x.closePath(); }
function mask(draw) {
  const c = document.createElement('canvas'); c.width = GW; c.height = GH; const x = c.getContext('2d', { willReadFrequently: true });
  x.scale(1 / C, 1 / C); x.lineCap = x.lineJoin = 'round'; draw(x); return x.getImageData(0, 0, GW, GH).data;
}
function nearestCell(x, z, pred) {
  const cx = x / C | 0, cz = z / C | 0;
  for (let r = 0; r < 400; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx += (Math.abs(dz) === r ? 1 : 2 * r || 1)) {
    const X = cx + dx, Z = cz + dz; if (X >= 0 && Z >= 0 && X < GW && Z < GH && pred(grid[Z * GW + X])) return { x: (X + .5) * C, z: (Z + .5) * C };
  }
  return { x, z };
}

/* ================= three setup ================= */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xd88a64, 220, 1500);
const camera = new THREE.PerspectiveCamera(62, 1, .3, 4000);
const SUN = new THREE.Vector3(-1, .34, .25).normalize();
scene.add(new THREE.HemisphereLight(0xffe2d2, 0x5a4a58, 1.25));
const sun = new THREE.DirectionalLight(0xffc089, 3.0); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 700 }); sun.shadow.bias = -.0006; sun.shadow.normalBias = .4;
scene.add(sun, sun.target);
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { sun: { value: SUN } },
  vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform vec3 sun;varying vec3 vP;
    float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float ns(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hs(i),hs(i+vec2(1,0)),f.x),mix(hs(i+vec2(0,1)),hs(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float a=.5,v=0.;for(int i=0;i<5;i++){v+=a*ns(p);p*=2.03;a*=.5;}return v;}
    void main(){vec3 d=normalize(vP);float h=d.y;
    vec3 top=vec3(.07,.08,.26),mid=vec3(.55,.2,.42),hor=vec3(.85,.47,.28);
    vec3 c=mix(hor,mid,smoothstep(0.,.22,h));c=mix(c,top,smoothstep(.12,.75,h));
    float s=max(dot(d,sun),0.);c+=vec3(1.,.45,.25)*pow(s,8.)*.22;
    vec2 q=d.xz/(abs(h)+.12);float n=fbm(q*1.1+vec2(3.,7.));float cl=smoothstep(.5,.78,n)*smoothstep(.015,.22,h);
    c=mix(c,mix(vec3(.3,.16,.34),vec3(.95,.6,.42),clamp(pow(s,1.5)+.15,0.,1.)),cl*.8);
    c=mix(c,vec3(1.9,1.3,.7),smoothstep(.9992,.9996,s));
    if(h<0.)c=vec3(.8,.46,.32);gl_FragColor=vec4(c,1.);}`,
}));
scene.add(sky);
{ const pm = new THREE.PMREMGenerator(renderer), es = new THREE.Scene(); es.add(sky.clone()); scene.environment = pm.fromScene(es, 0, 1, 5000).texture; pm.dispose(); }
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .22, .6, 1.0)); composer.addPass(new OutputPass());
function resize() { renderer.setSize(innerWidth, innerHeight, false); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
let waterNormal = null;

const matCache = {};
const mat = (col, em) => matCache[col + (em || '')] || (matCache[col + (em || '')] = new THREE.MeshLambertMaterial({ color: col, emissive: em ? col : 0, emissiveIntensity: em ? 3 : 0 }));
const geoCache = {};
function box(w, h, d, col, x = 0, y = 0, z = 0, em) {
  const k = w + '_' + h + '_' + d, m = new THREE.Mesh(geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)), mat(col, em));
  m.position.set(x, y, z); m.castShadow = true; return m;
}

/* ================= world mesh building ================= */
function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
function speckle(x, w, h, n, a, lo = 0, hi = 255) { for (let i = 0; i < n; i++) { const v = sr(lo, hi) | 0; x.fillStyle = `rgba(${v},${v},${v},${a})`; x.fillRect(srand() * w, srand() * h, 1 + srand() * 2.5, 1 + srand() * 2.5); } }
function blotch(x, w, h, n, col) { x.fillStyle = col; for (let i = 0; i < n; i++) { x.beginPath(); x.ellipse(srand() * w, srand() * h, sr(12, 60), sr(8, 34), srand() * 3, 0, 6.3); x.fill(); } }
const TEX = {};
function makeTextures() {
  TEX.asphalt = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#4d4a55'; x.fillRect(0, 0, w, h); blotch(x, w, h, 16, 'rgba(0,0,0,.07)'); blotch(x, w, h, 9, 'rgba(255,255,255,.035)'); speckle(x, w, h, 16000, .1); x.strokeStyle = 'rgba(0,0,0,.28)'; x.lineWidth = 1; for (let i = 0; i < 8; i++) { x.beginPath(); let px = srand() * w, py = srand() * h; x.moveTo(px, py); for (let k = 0; k < 6; k++) { px += sr(-30, 30); py += sr(-30, 30); x.lineTo(px, py); } x.stroke(); } });
  TEX.pave = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#b3a79d'; x.fillRect(0, 0, w, h); speckle(x, w, h, 5000, .08); blotch(x, w, h, 5, 'rgba(60,40,30,.07)'); x.strokeStyle = 'rgba(0,0,0,.22)'; x.lineWidth = 2; for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 64, 0); x.lineTo(i * 64, h); x.moveTo(0, i * 64); x.lineTo(w, i * 64); x.stroke(); } });
  TEX.ground = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#a58c7a'; x.fillRect(0, 0, w, h); blotch(x, w, h, 22, 'rgba(60,40,25,.035)'); blotch(x, w, h, 12, 'rgba(255,240,220,.03)'); speckle(x, w, h, 14000, .07); });
  TEX.grass = canvasTex(256, 256, (x, w, h) => { x.fillStyle = '#4a8a48'; x.fillRect(0, 0, w, h); for (let i = 0; i < 9000; i++) { x.fillStyle = `hsla(${sr(85, 135)},45%,${sr(22, 48)}%,.5)`; x.fillRect(srand() * w, srand() * h, 2, 3); } });
}
function tri(out, ax, az, bx, bz, cx, cz, y) { // always facing up
  if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) > 0) out.push(ax, y, az, bx, y, bz, cx, y, cz); else out.push(ax, y, az, cx, y, cz, bx, y, bz);
}
function ribbon(out, p, hw, y) {
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1];
    if (i < n - 1) {
      const bx = p[i * 2 + 2], bz = p[i * 2 + 3]; let dx = bx - ax, dz = bz - az; const L = Math.hypot(dx, dz); if (L < .05) continue;
      const nx = -dz / L * hw, nz = dx / L * hw;
      tri(out, ax + nx, az + nz, bx + nx, bz + nz, ax - nx, az - nz, y); tri(out, ax - nx, az - nz, bx + nx, bz + nz, bx - nx, bz - nz, y);
    }
    if (hw > .5) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, b = a + Math.PI / 4; tri(out, ax, az, ax + Math.cos(a) * hw, az + Math.sin(a) * hw, ax + Math.cos(b) * hw, az + Math.sin(b) * hw, y); }
  }
}
function dashes(out, p, hw, y) {
  let carry = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], L = Math.hypot(p[i + 2] - ax, p[i + 3] - az); if (L < .05) continue; const dx = (p[i + 2] - ax) / L, dz = (p[i + 3] - az) / L;
    let s = carry; for (; s + 3 <= L; s += 8) ribbon(out, [ax + dx * s, az + dz * s, ax + dx * (s + 3), az + dz * (s + 3)], hw, y); carry = Math.max(0, s - L);
  }
}
function polyFill(out, p, y) {
  const pts = []; for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  if (pts.length > 3 && pts[0].equals(pts[pts.length - 1])) pts.pop(); if (pts.length < 3) return;
  try { for (const f of THREE.ShapeUtils.triangulateShape(pts, [])) tri(out, pts[f[0]].x, pts[f[0]].y, pts[f[1]].x, pts[f[1]].y, pts[f[2]].x, pts[f[2]].y, y); } catch (e) { }
}
function flatMesh(pos, col, order, tex, scale, matl) {
  if (!pos.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3, nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2); for (let i = 0; i < n; i++) { nrm[i * 3 + 1] = 1; uv[i * 2] = pos[i * 3] / (scale || 10); uv[i * 2 + 1] = pos[i * 3 + 2] / (scale || 10); }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mt = matl || new THREE.MeshLambertMaterial({ color: col, map: tex || null }); mt.polygonOffset = true; mt.polygonOffsetFactor = mt.polygonOffsetUnits = -order * 2;
  const m = new THREE.Mesh(g, mt); m.receiveShadow = true; m.renderOrder = order; m.frustumCulled = false; scene.add(m); return m;
}

const WALLC = ['#f3d9c4', '#f6e3b5', '#eac6c0', '#cfe3e6', '#f1ead8', '#d9cdea', '#f7c9a8', '#c4dccb', '#ffffff', '#f2b8c0', '#f5e0a0'];
const chunks = new Map(), CH = 400, tanks = [], WHITE = new THREE.Color(1, 1, 1);
const newArr = () => ({ p: [], n: [], c: [], u: [] });
const pick2 = (a, h) => a[Math.floor(h * a.length) % a.length];
function wallQuad(o, a, b, y0, y1, nx, nz, u0, u1, v0, v1, col) {
  o.p.push(a.x, y0, a.y, b.x, y1, b.y, b.x, y0, b.y, a.x, y0, a.y, a.x, y1, a.y, b.x, y1, b.y);
  o.u.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
  for (let k = 0; k < 6; k++) { o.n.push(nx, 0, nz); o.c.push(col.r, col.g, col.b); }
}
function addBuilding(p, h) {
  const pts = []; for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  if (pts.length > 3 && pts[0].equals(pts[pts.length - 1])) pts.pop(); if (pts.length < 3) return;
  const area = THREE.ShapeUtils.area(pts); if (area < 0) pts.reverse();
  let cx = 0, cz = 0; for (const q of pts) { cx += q.x; cz += q.y; } cx /= pts.length; cz /= pts.length;
  const key = (cx / CH | 0) + '_' + (cz / CH | 0); let ch = chunks.get(key); if (!ch) chunks.set(key, ch = { st: [newArr(), newArr(), newArr()], shop: newArr(), rp: [], rc: [] });
  const hsh = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453) % 1, h2 = (hsh * 7.31) % 1;
  const style = h > 45 ? (h2 < .5 ? 2 : 0) : h < 7 ? 1 : h2 < .55 ? 0 : 1, y0 = h >= 7.5 ? 3.6 : 0;
  const col = new THREE.Color(style === 2 ? pick2(['#cfe6f2', '#dde6ff', '#ffe0ea', '#e8fff6'], hsh) : pick2(WALLC, hsh));
  let u = hsh * 4, us = hsh * 4;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz); if (L < .05) continue;
    const nx = dz / L, nz = -dx / L;
    wallQuad(ch.st[style], a, b, y0, h, nx, nz, -u, -u - L / 14, 0, (h - y0) / 12.8, col); u += L / 14;
    if (y0) { wallQuad(ch.shop, a, b, 0, y0, nx, nz, -us, -us - L / 16, 0, 1, WHITE); us += L / 16; }
  }
  const n0 = ch.rp.length, g = .36 + hsh * .16;
  try { for (const f of THREE.ShapeUtils.triangulateShape(pts, [])) tri(ch.rp, pts[f[0]].x, pts[f[0]].y, pts[f[1]].x, pts[f[1]].y, pts[f[2]].x, pts[f[2]].y, h); } catch (e) { }
  for (let i = n0; i < ch.rp.length; i += 3) ch.rc.push(g, g * .95, g);
  if (h > 9 && Math.abs(area) > 70 && tanks.length < 2500 && h2 < .7) tanks.push([cx, h, cz]);
}
function facade(style) {
  const lit = [];
  const map = canvasTex(512, 512, (x, w, h) => {
    x.fillStyle = style === 2 ? '#aebfcb' : style === 1 ? '#e4d9c6' : '#efe9df'; x.fillRect(0, 0, w, h); speckle(x, w, h, 6000, .05);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
      const cx = c * 128, cy = r * 128;
      if (style === 2) { for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const px = cx + i * 64 + 3, py = cy + j * 64 + 3, g = x.createLinearGradient(0, py, 0, py + 58); g.addColorStop(0, '#7aa3bf'); g.addColorStop(1, '#2c4a63'); x.fillStyle = g; x.fillRect(px, py, 58, 58); if (srand() < .28) lit.push([px, py, 58, 58, '#cfeaff']); } continue; }
      x.fillStyle = 'rgba(0,0,0,.16)'; x.fillRect(cx, cy + 120, 128, 8); x.fillStyle = 'rgba(255,255,255,.25)'; x.fillRect(cx, cy + 118, 128, 2);
      if (style === 0 && srand() < .45) {
        x.fillStyle = '#39404f'; x.fillRect(cx + 12, cy + 26, 104, 92); x.fillStyle = '#5a7391'; x.fillRect(cx + 22, cy + 32, 46, 86); x.fillStyle = '#2b3140'; x.fillRect(cx + 44, cy + 32, 2, 86);
        if (srand() < .4) lit.push([cx + 22, cy + 32, 46, 50, '#ffd58a']);
        x.fillStyle = '#ddd6ca'; x.fillRect(cx + 8, cy + 82, 112, 5); x.fillStyle = 'rgba(225,218,205,.9)'; for (let b = 0; b < 14; b++) x.fillRect(cx + 10 + b * 8, cy + 86, 2, 34);
        if (srand() < .4) for (let k = 0; k < 3; k++) { x.fillStyle = pick2(['#e4572e', '#29a3a3', '#f2c14e', '#f7f7f7', '#7d5ba6'], srand()); x.fillRect(cx + 16 + k * 30, cy + 88, 22, 20); }
      } else {
        const ww = style === 1 ? 50 : 66, wh = style === 1 ? 58 : 60, wx = cx + (128 - ww) / 2, wy = cy + 30;
        x.fillStyle = style === 1 ? '#b9ad99' : '#d6cfc3'; x.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
        x.fillStyle = style === 1 ? pick2(['#5a3d2b', '#2f6d6a', '#34455f', '#34455f'], srand()) : '#31425c'; x.fillRect(wx, wy, ww, wh);
        x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(wx, wy, ww, 4); x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(wx + ww / 2 - 1, wy, 2, wh); x.fillRect(wx, wy + wh / 2, ww, 2);
        if (style === 1) { x.fillStyle = '#c9bfad'; x.fillRect(wx - 10, wy - 13, ww + 20, 7); }
        if (srand() < .36) lit.push([wx, wy, ww, wh, pick2(['#ffd58a', '#ffe9b8', '#bfe9ff', '#ffd58a'], srand())]);
        x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(wx - 8, wy + wh + 5, ww + 16, 4);
        const g = x.createLinearGradient(0, wy + wh + 9, 0, cy + 120); g.addColorStop(0, 'rgba(70,50,40,.24)'); g.addColorStop(1, 'rgba(70,50,40,0)'); x.fillStyle = g; x.fillRect(wx + sr(0, ww - 14), wy + wh + 9, 12, 26);
        if (srand() < .25) { x.fillStyle = '#d9d9d6'; x.fillRect(cx + 100, cy + 72, 24, 17); x.fillStyle = '#555'; x.fillRect(cx + 103, cy + 75, 18, 11); }
      }
    }
    if (style === 1) { x.fillStyle = 'rgba(60,50,45,.55)'; x.fillRect(6, 0, 4, h); x.fillRect(262, 0, 4, h); }
  });
  const em = canvasTex(512, 512, (x, w, h) => { x.fillStyle = '#000'; x.fillRect(0, 0, w, h); for (const [a, b, c, d, col] of lit) { x.fillStyle = col; x.fillRect(a, b, c, d); x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(a + c / 2 - 1, b, 2, d); } });
  return [map, em];
}
const SHOPS = ['SAI MEDICAL', 'JAI HIND VADA PAV', 'GUPTA SWEETS', 'MOBILE REPAIR', 'SHREE JEWELLERS', 'KIRANA STORE', 'CHAI  NASHTA', 'BOMBAY TAILORS'];
function shopTex() {
  const glow = [], off = srand() * 8 | 0;
  const map = canvasTex(1024, 256, (x) => {
    x.fillStyle = '#d6ccbe'; x.fillRect(0, 0, 1024, 256); speckle(x, 1024, 256, 5000, .06);
    for (let s = 0; s < 4; s++) {
      const sx = s * 256, col = pick2(['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#00838f', '#ad1457'], srand());
      x.fillStyle = col; x.fillRect(sx + 8, 10, 240, 56); x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(sx + 8, 10, 240, 3); x.fillRect(sx + 8, 63, 240, 3);
      x.fillStyle = '#fff'; x.font = 'bold 21px Rubik, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(SHOPS[(s + off) % 8], sx + 128, 39, 224); glow.push([sx + 8, 10, 240, 56, col, .9]);
      if (srand() < .4) { x.fillStyle = '#8d929a'; x.fillRect(sx + 14, 76, 228, 164); x.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 80; y < 240; y += 8) x.fillRect(sx + 14, y, 228, 2); }
      else {
        x.fillStyle = '#261e1a'; x.fillRect(sx + 14, 76, 228, 164); glow.push([sx + 14, 76, 228, 110, '#7a5222', 1]);
        for (let r = 0; r < 3; r++) { x.fillStyle = '#4a382c'; x.fillRect(sx + 20, 112 + r * 30, 216, 3); for (let k = 0; k < 13; k++) { x.fillStyle = `hsl(${srand() * 360},70%,${sr(45, 70)}%)`; x.fillRect(sx + 24 + k * 16, 94 + r * 30, 11, 18); } }
        x.fillStyle = '#6b4a32'; x.fillRect(sx + 14, 196, 228, 44); x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(sx + 14, 196, 228, 4);
      }
      if (srand() < .35) for (let k = 0; k < 12; k++) { x.fillStyle = k % 2 ? '#f4f4f4' : col; x.fillRect(sx + 8 + k * 20, 68, 20, 16); }
      x.fillStyle = '#c4b9aa'; x.fillRect(sx, 0, 7, 256); x.fillRect(sx + 249, 0, 7, 256);
    }
    x.fillStyle = '#93897f'; x.fillRect(0, 242, 1024, 14);
  });
  const em = canvasTex(1024, 256, (x) => { x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 256); for (const [a, b, c, d, col, al] of glow) { x.globalAlpha = al * .55; x.fillStyle = col; x.fillRect(a, b, c, d); } });
  return [map, em];
}
function geoFrom(o) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(o.u, 2)); return g;
}
function finishBuildings() {
  const mats = [0, 1, 2].map(s => { const [map, em] = facade(s); return new THREE.MeshLambertMaterial({ map, vertexColors: true, emissive: 0xffffff, emissiveMap: em, emissiveIntensity: s === 2 ? 1.1 : 1.5 }); });
  const [sm, se] = shopTex(), shopMat = new THREE.MeshLambertMaterial({ map: sm, emissive: 0xffffff, emissiveMap: se, emissiveIntensity: 1.3 });
  const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: TEX.ground });
  for (const ch of chunks.values()) {
    ch.st.forEach((o, s) => { if (!o.p.length) return; const w = new THREE.Mesh(geoFrom(o), mats[s]); w.castShadow = w.receiveShadow = true; scene.add(w); });
    if (ch.shop.p.length) { const w = new THREE.Mesh(geoFrom(ch.shop), shopMat); w.castShadow = w.receiveShadow = true; scene.add(w); }
    if (ch.rp.length) {
      const r = new THREE.BufferGeometry(), n = ch.rp.length / 3, nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2); for (let i = 0; i < n; i++) { nrm[i * 3 + 1] = 1; uv[i * 2] = ch.rp[i * 3] / 12; uv[i * 2 + 1] = ch.rp[i * 3 + 2] / 12; }
      r.setAttribute('position', new THREE.Float32BufferAttribute(ch.rp, 3)); r.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); r.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      r.setAttribute('color', new THREE.Float32BufferAttribute(ch.rc.map(v => v * 2.2), 3)); const rm = new THREE.Mesh(r, roofMat); rm.receiveShadow = true; scene.add(rm);
    }
  }
  chunks.clear();
}
function instanced(geo, material, list, shadow = true) { // list: [x,y,z,rotY,scale]
  if (!list.length) return; const im = new THREE.InstancedMesh(geo, material, list.length), o = new THREE.Object3D();
  list.forEach((q, i) => { o.position.set(q[0], q[1], q[2]); o.rotation.y = q[3] || 0; o.scale.setScalar(q[4] || 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.castShadow = shadow; im.frustumCulled = false; scene.add(im); return im;
}

function buildWorld(d) {
  SX = d.size[0]; SZ = d.size[1]; GW = Math.ceil(SX / C); GH = Math.ceil(SZ / C); grid = new Uint8Array(GW * GH);
  for (const r of d.roads) r.w = roadW(r.k);
  // --- collision / nav grid
  let m = mask(x => { for (const w of d.water) { if (w.a) { tracePath(x, w.p, true); x.fill(); } else { x.lineWidth = w.w || 6; tracePath(x, w.p); x.stroke(); } } });
  for (let i = 0; i < grid.length; i++) if (m[i * 4 + 3] > 100) grid[i] = WATER;
  m = mask(x => { for (const p of d.parks) { tracePath(x, p.p, true); x.fill(); } });
  for (let i = 0; i < grid.length; i++) if (m[i * 4 + 3] > 100 && !grid[i]) grid[i] = PARK;
  m = mask(x => { for (const b of d.buildings) { tracePath(x, b.p, true); x.fill(); } });
  for (let i = 0; i < grid.length; i++) if (m[i * 4 + 3] > 100) grid[i] = BLD;
  m = mask(x => { x.lineWidth = 5; for (const r of d.rails) { tracePath(x, r.p); x.stroke(); } });
  for (let i = 0; i < grid.length; i++) if (m[i * 4 + 3] > 100) grid[i] = RAIL;
  m = mask(x => { for (const r of d.roads) { x.lineWidth = r.w; tracePath(x, r.p); x.stroke(); } });
  for (let i = 0; i < grid.length; i++) if (m[i * 4 + 3] > 100) grid[i] = ROAD;
  m = null;
  for (let z = 2; z < GH - 2; z++) for (let x = 2; x < GW - 2; x++) if (grid[z * GW + x] === ROAD)
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const j = (z + dz) * GW + x + dx; if (grid[j] === OPEN || grid[j] === PARK) grid[j] = PAVE; }
  // --- filler buildings along roads where OSM has nothing mapped
  let filler = 0;
  for (const r of d.roads) {
    const big = r.w >= 11;
    for (let i = 0; i + 3 < r.p.length && filler < 7000; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 8) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let s = 8; s < L - 6; s += sr(15, 20)) for (const side of [1, -1]) {
        const fw = sr(10, 14), dp = sr(9, 16), off = r.w / 2 + 4.5 + dp / 2, cx = ax + dx * s - dz * off * side, cz = az + dz * s + dx * off * side;
        let ok = true;
        for (let u = -fw / 2 - 1; u <= fw / 2 + 1 && ok; u += C * .9) for (let v = -dp / 2 - 1; v <= dp / 2 + 1; v += C * .9) if (cellAt(cx + dx * u - dz * v, cz + dz * u + dx * v) !== OPEN) { ok = false; break; }
        if (!ok) continue;
        for (let u = -fw / 2; u <= fw / 2; u += C * .6) for (let v = -dp / 2; v <= dp / 2; v += C * .6) { const X = (cx + dx * u - dz * v) / C | 0, Z = (cz + dz * u + dx * v) / C | 0; grid[Z * GW + X] = BLD; }
        const t = srand(), h = t < .62 ? sr(7, 16) : t < .9 ? sr(18, big ? 46 : 30) : sr(big ? 50 : 30, big ? 95 : 55);
        const c = (u, v) => [cx + dx * u - dz * v, cz + dz * u + dx * v];
        d.buildings.push({ h, f: 1, p: [...c(-fw / 2, -dp / 2), ...c(fw / 2, -dp / 2), ...c(fw / 2, dp / 2), ...c(-fw / 2, dp / 2)] }); filler++;
      }
    }
  }
  // --- meshes
  makeTextures();
  const gt = TEX.ground.clone(); gt.repeat.set((SX + 4000) / 24, (SZ + 4000) / 24); gt.needsUpdate = true;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SX + 4000, SZ + 4000), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(SX / 2, 0, SZ / 2); ground.receiveShadow = true; scene.add(ground);
  const pv = [], rd = [], mk = [], wt = [], pk = [], rl = [], rr = [];
  for (const r of d.roads) { ribbon(pv, r.p, r.w / 2 + 2.6, .03); ribbon(rd, r.p, r.w / 2, .07); if (r.w >= 9) dashes(mk, r.p, .09, .09); }
  for (const w of d.water) w.a ? polyFill(wt, w.p, .04) : ribbon(wt, w.p, (w.w || 6) / 2, .04);
  for (const p of d.parks) polyFill(pk, p.p, .02);
  for (const r of d.rails) { ribbon(rl, r.p, 2.2, .05); const n = r.p.length / 2; for (const o of [-.75, .75]) { const q = []; for (let i = 0; i < n; i++) { const j = Math.min(i, n - 2) * 2, dx = r.p[j + 2] - r.p[j], dz = r.p[j + 3] - r.p[j + 1], L = Math.hypot(dx, dz) || 1; q.push(r.p[i * 2] - dz / L * o, r.p[i * 2 + 1] + dx / L * o); } ribbon(rr, q, .09, .05); } }
  waterNormal = new THREE.TextureLoader().load('assets/waternormals.jpg'); waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
  flatMesh(pk, 0xffffff, 1, TEX.grass, 9); flatMesh(wt, 0, 2, null, 40, new THREE.MeshStandardMaterial({ color: 0x157f96, roughness: .12, metalness: .55, normalMap: waterNormal, normalScale: new THREE.Vector2(.5, .5) }));
  flatMesh(pv, 0xffffff, 3, TEX.pave, 5); flatMesh(rl, 0x6a5a55, 4, TEX.ground, 6); flatMesh(rr, 0xc8ccd6, 5); flatMesh(rd, 0xffffff, 6, TEX.asphalt, 14); flatMesh(mk, 0xe9e4d6, 7);
  for (const b of d.buildings) {
    let h = b.h;
    if (!h) { let a = 0; const p = b.p; for (let i = 0; i + 3 < p.length; i += 2) a += p[i] * p[i + 3] - p[i + 2] * p[i + 1]; a = Math.abs(a / 2); const t = Math.abs(Math.sin(p[0] * 3.7 + p[1] * 1.3) * 9973) % 1; h = a < 60 ? 3 + t * 3 : t < .6 ? 9 + t * 22 : t < .9 || a < 250 ? 22 + t * 25 : 45 + t * 40; }
    addBuilding(b.p, h);
  }
  finishBuildings();
  // --- rooftop water tanks, park trees, palms, street lamps
  instanced(new THREE.CylinderGeometry(.75, .8, 1.4, 10).translate(0, .7, 0), new THREE.MeshLambertMaterial({ color: 0x15171c }), tanks.map(t => [t[0], t[1], t[2], 0, sr(.8, 1.3)]), false);
  const trees = []; for (let z = 3; z < GH - 3; z += 6) for (let x = 3; x < GW - 3; x += 6) if (grid[z * GW + x] === PARK && srand() < .3 && trees.length < 900) trees.push([(x + srand()) * C, 0, (z + srand()) * C, srand() * 6, sr(.8, 1.5)]);
  instanced(new THREE.CylinderGeometry(.18, .26, 3.2, 6).translate(0, 1.6, 0), new THREE.MeshLambertMaterial({ color: 0x6b4c36 }), trees);
  instanced(mergeGeometries([new THREE.IcosahedronGeometry(2.3, 1).translate(0, 4.6, 0), new THREE.IcosahedronGeometry(1.6, 1).translate(1.3, 3.8, .6), new THREE.IcosahedronGeometry(1.5, 1).translate(-1.1, 4, -.7)]), new THREE.MeshLambertMaterial({ color: 0x3f8f4f, flatShading: true }), trees);
  const palms = [], lamps = [];
  for (const r of d.roads) if (r.w >= 7) for (let i = 0, run = 0; i + 3 < r.p.length; i += 2) {
    const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue; const dx = (bx - ax) / L, dz = (bz - az) / L;
    for (let s = 6; s < L; s += 22, run++) {
      const side = run % 2 ? 1 : -1, o = r.w / 2 + 1.5, x = ax + dx * s - dz * o * side, z = az + dz * s + dx * o * side; if (cellAt(x, z) !== PAVE) continue;
      if (run % 2 === 0 && lamps.length < 1500) lamps.push([x, 0, z, Math.atan2(dx * side, dz * side)]); else if (r.w >= 9 && palms.length < 1500) palms.push([x, 0, z, srand() * 6, sr(.8, 1.25)]);
    }
  }
  const fr = []; for (let k = 0; k < 8; k++) { const g = new THREE.BoxGeometry(3.4, .06, .75, 4, 1, 1), ps = g.attributes.position; for (let i = 0; i < ps.count; i++) { const x = ps.getX(i) + 1.7; ps.setX(i, x); ps.setY(i, ps.getY(i) + .5 * x - .3 * x * x); } g.rotateY(k * Math.PI / 4 + .2); g.translate(0, 7, 0); fr.push(g); }
  instanced(new THREE.CylinderGeometry(.14, .28, 7, 7).translate(0, 3.5, 0), new THREE.MeshLambertMaterial({ color: 0x86694f }), palms);
  const lf = mergeGeometries(fr); lf.computeVertexNormals(); instanced(lf, new THREE.MeshLambertMaterial({ color: 0x2f9b62, side: THREE.DoubleSide }), palms);
  instanced(mergeGeometries([new THREE.CylinderGeometry(.07, .1, 7, 6).translate(0, 3.5, 0), new THREE.BoxGeometry(1.7, .08, .08).translate(.8, 7, 0)]), new THREE.MeshLambertMaterial({ color: 0x3a3a44 }), lamps);
  instanced(new THREE.SphereGeometry(.24, 8, 6).translate(1.6, 6.9, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 4.2, 2) }), lamps, false);
  // --- landmarks + neon signs
  const [S, W, N, E] = BBOX;
  landmarks = LMS.map(([n, la, lo], k) => {
    const x = clamp((lo - W) / (E - W) * SX, 20, SX - 20), z = clamp((N - la) / (N - S) * SZ, 20, SZ - 20), s = nearestCell(x, z, v => v === ROAD), col = k % 2 ? '#2de2e6' : '#ff5fa2';
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d'); g.font = '60px Pacifico, cursive'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = 18; g.fillStyle = col; g.fillText(n, 256, 48); g.shadowBlur = 0; g.fillStyle = '#fff'; g.globalAlpha = .75; g.fillText(n, 256, 48);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color: new THREE.Color(1.8, 1.8, 1.8), fog: false, depthWrite: false, transparent: true })); sp.scale.set(64, 12, 1); sp.position.set(s.x, 42, s.z); scene.add(sp);
    return { n, x: s.x, z: s.z, col };
  });
  startPt = { x: landmarks[0].x, z: landmarks[0].z };
  search: for (let r = 0; r < 200; r += 6) for (let a = 0; a < 6.28; a += .4) {
    const x = landmarks[0].x + Math.cos(a) * r, z = landmarks[0].z + Math.sin(a) * r; if (cellAt(x, z) !== ROAD) continue;
    let clear = true; for (let b = 0; b < 6.28 && clear; b += .5) for (const q of [8, 16, 24]) if (cellAt(x + Math.cos(b) * q, z + Math.sin(b) * q) === RAIL) { clear = false; break; }
    if (clear) { startPt = { x, z }; break search; }
  }
  // --- rail line fit for the train
  let n = 0, sz = 0, sx = 0, szz = 0, sxz = 0; for (const r of d.rails) for (let i = 0; i < r.p.length; i += 2) { n++; sx += r.p[i]; sz += r.p[i + 1]; szz += r.p[i + 1] ** 2; sxz += r.p[i] * r.p[i + 1]; }
  if (n > 1 && n * szz - sz * sz > 1) { const b = (n * sxz - sx * sz) / (n * szz - sz * sz), a = (sx - b * sz) / n; railFit = { a, b, ang: Math.atan2(1, b) }; }
  // --- radar image (1px = 3m)
  mini = document.createElement('canvas'); mini.width = Math.ceil(SX / 3); mini.height = Math.ceil(SZ / 3); const x = mini.getContext('2d');
  x.fillStyle = '#2a1746'; x.fillRect(0, 0, mini.width, mini.height); x.scale(1 / 3, 1 / 3); x.lineCap = x.lineJoin = 'round';
  x.fillStyle = x.strokeStyle = '#1fb6c9'; for (const w of d.water) { if (w.a) { tracePath(x, w.p, true); x.fill(); } else { x.lineWidth = w.w || 6; tracePath(x, w.p); x.stroke(); } }
  x.fillStyle = '#3f8f5d'; for (const p of d.parks) { tracePath(x, p.p, true); x.fill(); }
  x.fillStyle = '#5b3f86'; for (const b of d.buildings) { tracePath(x, b.p, true); x.fill(); }
  x.strokeStyle = '#8b7a6a'; x.lineWidth = 5; for (const r of d.rails) { tracePath(x, r.p); x.stroke(); }
  x.strokeStyle = '#ffc3dd'; for (const r of d.roads) { x.lineWidth = Math.max(6, r.w); tracePath(x, r.p); x.stroke(); }
  return { osm: d.buildings.length - filler, filler };
}

/* ================= models ================= */
const KIND = {
  car: { l: 4.4, w: 1.8, max: 38, acc: 14, turn: 2.2, cols: ['#b3122b', '#0d6e8c', '#e9e9ec', '#d9a400', '#5b3c9e', '#c9501e', '#1f8a5b', '#20242c', '#8a8f98', '#f2f0ea'] },
  taxi: { l: 4.2, w: 1.75, max: 36, acc: 13, turn: 2.2, cols: ['#141416'] },
  rick: { l: 2.8, w: 1.4, max: 20, acc: 8, turn: 2.9, cols: ['#141416'] },
  bus: { l: 10, w: 2.5, max: 22, acc: 6, turn: 1.25, cols: ['#c21f1f'] },
  cop: { l: 4.4, w: 1.8, max: 43, acc: 17, turn: 2.4, cols: ['#f2f2f2'] },
};
const paintCache = {}, paint = (col, m = .6, r = .3) => paintCache[col + m + r] || (paintCache[col + m + r] = new THREE.MeshStandardMaterial({ color: col, metalness: m, roughness: r }));
const GLASS = paint('#0a111d', .95, .05), DARK = paint('#17171b', .2, .7), CHROME = paint('#c9ccd2', .95, .2);
function prof(key, pts, depth, bevel) {
  if (geoCache[key]) return geoCache[key]; const s = new THREE.Shape(); pts.forEach((p, i) => i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1]));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 }); g.translate(0, 0, -depth / 2); return geoCache[key] = g;
}
function sbox(w, h, d, m, x, y, z) { const k = w + '_' + h + '_' + d, o = new THREE.Mesh(geoCache[k] || (geoCache[k] = new THREE.BoxGeometry(w, h, d)), m); o.position.set(x, y, z); return o; }
function wheel(x, z, r = .34) {
  const g = new THREE.Group(); g.add(new THREE.Mesh(geoCache['wt' + r] || (geoCache['wt' + r] = new THREE.CylinderGeometry(r, r, .26, 16).rotateX(Math.PI / 2)), DARK), new THREE.Mesh(geoCache['wh' + r] || (geoCache['wh' + r] = new THREE.CylinderGeometry(r * .58, r * .58, .28, 12).rotateX(Math.PI / 2)), CHROME));
  g.position.set(x, r, z); return g;
}
function makeVehMesh(c) {
  const K = KIND[c.k], g = new THREE.Group(), l = K.l, w = K.w, body = paint(c.col);
  if (c.k === 'bus') {
    g.add(new THREE.Mesh(prof('bus', [[-l / 2, .5], [-l / 2, 2.85], [l / 2, 2.85], [l / 2, .5]], w - .24, .12), body), sbox(l * .9, .8, w + .02, GLASS, -.02 * l, 2.1, 0), sbox(.08, 1.15, w * .86, GLASS, l / 2 + .1, 1.95, 0), sbox(l * .99, .14, w + .03, paint('#f1e9d2', .2, .5), 0, 1.5, 0), box(.06, .26, w * .7, '#ff9d2e', l / 2 + .12, 2.7, 0, 1));
    for (const x of [l * .33, -l * .33]) for (const z of [w / 2 - .1, -w / 2 + .1]) g.add(wheel(x, z, .48));
  } else if (c.k === 'rick') {
    g.add(new THREE.Mesh(prof('rick', [[-l * .48, .3], [-l * .48, 1.05], [.2 * l, 1.05], [.48 * l, .7], [.48 * l, .3]], w - .12, .06), body), sbox(l * .82, .08, w, paint('#e2b100', .3, .5), -.1 * l, 1.74, 0), sbox(.06, .66, w * .9, GLASS, l * .22, 1.38, 0), sbox(.08, .7, w, paint('#e2b100', .3, .5), -l * .46, 1.4, 0), sbox(l * .5, .12, w + .02, paint('#1f8a5b', .4, .4), 0, .62, 0));
    for (const z of [w / 2 - .05, -w / 2 + .05]) g.add(sbox(.06, .68, .06, DARK, l * .22, 1.38, z));
    g.add(wheel(l * .4, 0, .27), wheel(-l * .3, w / 2 - .08, .27), wheel(-l * .3, -w / 2 + .08, .27));
  } else {
    const roofc = c.k === 'taxi' ? paint('#e2b100', .4, .4) : body;
    g.add(new THREE.Mesh(prof('sedan' + l, [[-.5 * l, .3], [-.5 * l, .72], [-.45 * l, .86], [.27 * l, .84], [.46 * l, .74], [.5 * l, .58], [.5 * l, .3]], w - .12, .06), body),
      new THREE.Mesh(prof('cab' + l, [[-.38 * l, .86], [-.28 * l, 1.33], [.07 * l, 1.35], [.24 * l, .86]], w * .8, .03), GLASS), sbox(.35 * l, .06, w * .8, roofc, -.105 * l, 1.38, 0),
      sbox(.16, .2, w * .98, DARK, l / 2, .42, 0), sbox(.16, .2, w * .98, DARK, -l / 2, .42, 0), sbox(.05, .14, w * .45, DARK, l / 2 + .04, .64, 0), sbox(.04, .12, .5, paint(c.k === 'taxi' ? '#f5d90a' : '#f4f4f4', 0, .6), -l / 2 - .07, .56, 0));
    for (const z of [w * .4 - .02, -w * .4 + .02]) g.add(sbox(.05, .5, .05, body, -.33 * l, 1.1, z).rotateZ(-.2), sbox(.05, .52, .05, body, .155 * l, 1.1, z).rotateZ(.33), sbox(.04, .48, .04, body, -.1 * l, 1.1, z));
    if (c.k === 'taxi') g.add(sbox(l * .92, .16, w + .01, paint('#e2b100', .4, .4), 0, .8, 0));
    if (c.k === 'cop') { g.add(sbox(l * .7, .2, w + .01, paint('#1d3f8f', .4, .4), 0, .62, 0)); c.bar = new THREE.Mesh(new THREE.BoxGeometry(.3, .14, 1.1), new THREE.MeshBasicMaterial({ color: 0xff2222 })); c.bar.position.set(-.3, 1.48, 0); g.add(c.bar); }
    for (const x of [l * .31, -l * .31]) for (const z of [w / 2 - .08, -w / 2 + .08]) g.add(wheel(x, z));
  }
  const ly = c.k === 'bus' ? .85 : .66; for (const z of [w * .34, -w * .34]) g.add(box(.08, .15, .32, '#fff1c2', l / 2 + .05, ly, z, 1), box(.08, .13, .32, '#ff1f3d', -l / 2 - .05, ly, z, 1));
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g;
}
const SHIRTS = ['#ff5fa2', '#2de2e6', '#ffd23f', '#f4f4f4', '#9b5de5', '#ff7b54', '#3ddc97', '#e63946', '#f4a261'], PANTS = ['#2b2d42', '#3d405b', '#6b705c', '#1d3557', '#f1faee'], SKIN = ['#c68642', '#8d5524', '#e0ac69', '#a56b3f'];
const TINTS = ['#ffffff', '#ffffff', '#ffd9d0', '#d6e6ff', '#fff0c4', '#d8ffe0', '#f0d6ff', '#c9c9c9'];
const HUM = [];
async function loadHumans() {
  const L = new GLTFLoader(), load = u => new Promise((res, rej) => L.load(u, res, undefined, rej));
  const prep = (g, h, rot) => { g.scene.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(g.scene), s = h / Math.max(.01, b.max.y - b.min.y); return { scene: g.scene, scale: s, rot }; };
  try {
    const s = await load('assets/Soldier.glb'), clips = {}; for (const c of s.animations) clips[c.name] = c;
    HUM.push({ ...prep(s, 1.8, -Math.PI / 2), clips });
    try {
      const m = await load('assets/Michelle.glb'), strip = c => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter(t => t.name.endsWith('.quaternion') && !t.name.includes('Hips')));
      HUM.push({ ...prep(m, 1.68, Math.PI / 2), clips: { Idle: strip(clips.Idle), Walk: strip(clips.Walk), Run: strip(clips.Run) } });
    } catch (e) { console.warn('Michelle model failed', e); }
  } catch (e) { console.warn('character models failed, using box people', e); }
}
function makeHuman(shirt, pants, skin, player) {
  const g = new THREE.Group(), u = g.userData;
  if (HUM.length) {
    const T = player ? HUM[0] : pick(HUM), m = SkeletonUtils.clone(T.scene), tint = player ? null : pick(TINTS);
    m.scale.multiplyScalar(T.scale); m.rotation.y = T.rot;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (tint && tint !== '#ffffff') { o.material = o.material.clone(); o.material.color.set(tint); } } });
    g.add(m); u.mixer = new THREE.AnimationMixer(m); u.acts = {}; u.w = { Idle: 1, Walk: 0, Run: 0 };
    for (const k of ['Idle', 'Walk', 'Run']) { u.acts[k] = u.mixer.clipAction(T.clips[k]); u.acts[k].play(); u.acts[k].setEffectiveWeight(u.w[k]); u.acts[k].time = Math.random(); }
  } else {
    const limb = (w, h, col, y, z) => { const p = new THREE.Group(); p.position.set(0, y, z); p.add(box(w, h, w, col, 0, -h / 2, 0)); g.add(p); return p; };
    g.add(box(.3, .62, .52, shirt, 0, 1.13, 0), box(.27, .28, .27, skin, 0, 1.6, 0), box(.29, .1, .29, '#1a1210', -.01, 1.77, 0));
    u.legL = limb(.21, .82, pants, .82, .14); u.legR = limb(.21, .82, pants, .82, -.14); u.armL = limb(.16, .62, skin, 1.42, -.34); u.armR = limb(.16, .62, skin, 1.42, .34); u.ph = Math.random() * 6;
  }
  scene.add(g); return g;
}
function animHuman(g, speed, dt, aim) {
  const u = g.userData;
  if (u.mixer) {
    const tgt = speed < .3 ? 'Idle' : speed < 5 ? 'Walk' : 'Run';
    for (const k in u.acts) { u.w[k] += ((k === tgt ? 1 : 0) - u.w[k]) * Math.min(1, dt * 8); u.acts[k].setEffectiveWeight(u.w[k]); }
    u.acts.Walk.timeScale = clamp(speed / 1.5, .7, 2.6); u.acts.Run.timeScale = clamp(speed / 4.4, .8, 1.9); u.mixer.update(dt); return;
  }
  u.ph += speed * dt * 3.4; const s = Math.sin(u.ph) * Math.min(1, speed / 2) * .75;
  u.legL.rotation.z = s; u.legR.rotation.z = -s; u.armL.rotation.z = -s * .8; u.armR.rotation.z = aim ? Math.PI / 2 : s * .8;
}

/* ================= game state ================= */
let cars = [], peds = [], bullets = [], parts = [], cash = [];
const P = { x: 0, z: 0, a: 0, hp: 100, veh: null, money: 0, cd: 0, inv: 0, bust: 0, stars: 0, starT: 0, sp: 0, aimT: 0, mesh: null };
const state = { dead: 0, msg: '', started: false };
let time = 0, camYaw = 0, camPitch = .28, lastLook = -9;
const PTS = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
function mkVeh(k, x, z, a, ai) { const c = { k, x, z, a, v: 0, hp: k === 'bus' ? 170 : 100, ai, t: 0, tgt: a, stuck: 0, rev: 0, col: pick(KIND[k].cols) }; c.mesh = makeVehMesh(c); cars.push(c); return c; }
function vehFree(x, z, a, K) { const c = Math.cos(a), s = Math.sin(a), hl = K.l / 2, hw = K.w / 2; for (const [u, v] of PTS) { const lx = u * hl, lz = v * hw; if (solid(x + lx * c - lz * s, z + lx * s + lz * c)) return false; } return true; }

const partGeo = new THREE.BoxGeometry(1, 1, 1);
function burst(x, y, z, n, col, sp, life, size) {
  for (let i = 0; i < n && parts.length < 260; i++) {
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true })); m.position.set(x, y, z); scene.add(m);
    const a = rnd(0, 6.28), s = rnd(.2, 1) * sp; parts.push({ m, vx: Math.cos(a) * s, vy: rnd(.2, 1) * sp, vz: Math.sin(a) * s, life: life * rnd(.5, 1), max: life, size: size * rnd(.6, 1.3) });
  }
}
let ac; function beep(f, d, type = 'square', vol = .05) { if (!state.started) return; try { ac = ac || new AudioContext(); const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol; g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + d); } catch (e) { } }

function driveVeh(c, thr, steer, brake, dt) {
  const K = KIND[c.k]; let acc = thr * K.acc; if (thr * c.v < 0) acc *= 2.5; c.v += acc * dt;
  if (!thr || brake) { const f = (brake ? 28 : 4) * dt; c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), f); }
  c.v = clamp(c.v, -K.max * .35, K.max);
  const sp = Math.abs(c.v) / K.max, na = c.a + steer * K.turn * Math.min(1, Math.abs(c.v) / 6) * (c.v >= 0 ? 1 : -1) * dt * (1 - sp * .5);
  if (vehFree(c.x, c.z, na, K)) c.a = na;
  const nx = c.x + Math.cos(c.a) * c.v * dt, nz = c.z + Math.sin(c.a) * c.v * dt;
  if (vehFree(nx, nz, c.a, K)) { c.x = nx; c.z = nz; }
  else {
    if (vehFree(nx, c.z, c.a, K)) c.x = nx; else if (vehFree(c.x, nz, c.a, K)) c.z = nz;
    const imp = Math.abs(c.v); if (imp > 10) { hurtVeh(c, imp * .7); burst(c.x, .8, c.z, 4, 0xdddddd, 5, .4, .18); beep(90, .08, 'sawtooth', .06); }
    c.v *= -.25;
  }
}
function hurtVeh(c, n) { c.hp -= n; if (c.hp <= 0) explode(c); }
function explode(c) {
  if (c.dead) return; c.dead = true;
  burst(c.x, 1, c.z, 34, 0xff9f1a, 16, .9, .7); burst(c.x, 1, c.z, 20, 0x333333, 9, 1.5, .9); beep(60, .5, 'sawtooth', .12);
  const mine = c === P.veh;
  if (mine) { P.veh = null; P.x = c.x; P.z = c.z; hurtP(60); } else if (!P.veh && d2(c, P) < 8) hurtP(40);
  for (const p of peds) if (!p.dead && d2(p, c) < 8) killPed(p, mine || c.hurtByP);
  if (c.k === 'cop' && c.hurtByP) crime(2);
}
function hurtP(n) { if (P.inv > 0 || state.dead > 0) return; P.hp -= n; P.inv = .3; burst(P.x, 1.2, P.z, 5, 0xbb0000, 4, .4, .12); if (P.hp <= 0) wasted('Wasted'); }
function wasted(msg) { state.dead = 3.2; state.msg = msg; if (P.veh) { P.veh.ai = false; P.veh = null; } $('big').textContent = msg; $('big').style.display = 'flex'; $('big').style.color = msg === 'Busted' ? '#2de2e6' : '#ff5fa2'; beep(120, .6, 'sawtooth', .1); }
function respawn() {
  P.hp = 100; P.veh = null; P.stars = 0; P.bust = 0; P.inv = 1.5; P.money = Math.floor(P.money * (state.msg === 'Busted' ? .5 : .8));
  const s = nearestCell(startPt.x, startPt.z, v => v === PAVE); P.x = s.x; P.z = s.z; $('big').style.display = 'none'; state.msg = '';
  for (const c of cars) if (c.k === 'cop') c.far = true;
}
function crime(n) { P.stars = Math.min(5, P.stars + n); P.starT = 24; }
function killPed(p, byPlayer) {
  if (p.dead) return; p.dead = true; p.rot = 0; burst(p.x, 1, p.z, 8, 0xaa0000, 4, .5, .14); p.mesh.rotation.x = Math.PI / 2; p.mesh.position.y = .25;
  const m = box(.5, .06, .3, '#59f0a0', p.x, .5, p.z, 1); scene.add(m); cash.push({ x: p.x, z: p.z, v: Math.floor(rnd(20, 140)), t: 30, m }); beep(200, .08, 'square', .05);
  if (byPlayer) crime(1);
}

/* ---------- AI ---------- */
function rayLen(x, z, a) { let len = 0; const cx = Math.cos(a) * 3, cz = Math.sin(a) * 3; for (let d = 1; d <= 14; d++) { if (cellAt(x + cx * d, z + cz * d) !== ROAD) break; len = d; } return len; }
function pickDir(c) {
  const cop = c.k === 'cop', base = cop ? Math.atan2(P.z - c.z, P.x - c.x) : c.a;
  if (cop && d2(c, P) < 22) { c.tgt = base; return; }
  let best = -1e9, ba = c.a, mx = 0;
  for (let k = -4; k <= 4; k++) {
    const a = c.a + k * Math.PI / 8, len = rayLen(c.x, c.z, a); mx = Math.max(mx, len);
    let sc = len - Math.abs(angDiff(a, base)) * (cop ? 3.5 : 6) + Math.random(); if (!cop && k && len >= 9 && Math.random() < .02) sc += 14;
    if (sc > best) { best = sc; ba = a; }
  }
  c.tgt = mx < 2 ? c.a + Math.PI : ba;
}
function blockedAhead(c) {
  const K = KIND[c.k], cop = c.k === 'cop';
  for (const d of [K.l / 2 + 2.5, K.l / 2 + 6.5]) {
    const fx = c.x + Math.cos(c.a) * d, fz = c.z + Math.sin(c.a) * d;
    if (!cop && Math.hypot(P.x - fx, P.z - fz) < 2.4) return true;
    for (const p of peds) if (!p.dead && Math.abs(p.x - fx) < 1.8 && Math.abs(p.z - fz) < 1.8) return true;
    if (!cop) for (const o of cars) if (o !== c && Math.hypot(o.x - fx, o.z - fz) < 2.6 && Math.abs(angDiff(o.a, c.a)) < 1.2) return true;
  }
  return false;
}
function aiDrive(c, dt) {
  const K = KIND[c.k], cop = c.k === 'cop';
  if (c.rev > 0) { c.rev -= dt; driveVeh(c, -1, -Math.sign(angDiff(c.a, c.tgt)) || 1, false, dt); return; }
  c.t -= dt; if (c.t <= 0) { c.t = .22 + Math.random() * .15; pickDir(c); }
  const d = angDiff(c.a, c.tgt); let want = K.max * (cop ? .95 : .36) * (1 - Math.min(.7, Math.abs(d) * .8));
  if (blockedAhead(c)) want = 0;
  const thr = c.v < want ? 1 : (c.v > want + 3 ? -.6 : 0);
  driveVeh(c, (thr < 0 && c.v <= 0) ? 0 : thr, clamp(d * 2.4, -1, 1), want === 0 && c.v > 0, dt);
  if (Math.abs(c.v) < .8 && want > 0) { c.stuck += dt; if (c.stuck > 1.4) { c.stuck = 0; if (cop) c.rev = .9; else c.far = true; } } else c.stuck = 0;
}

/* ---------- spawning ---------- */
function spawnTraffic() {
  for (let n = 0; n < 30; n++) {
    const ang = rnd(0, 6.28), r = rnd(110, 230), x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r; if (cellAt(x, z) !== ROAD) continue;
    let best = 0, ba = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, l = rayLen(x, z, a); if (l > best) { best = l; ba = a; } }
    const kind = pick(['car', 'car', 'car', 'car', 'taxi', 'taxi', 'rick', 'rick', 'rick', 'bus']);
    if (best < 5 || !vehFree(x, z, ba, KIND[kind]) || cars.some(o => Math.hypot(o.x - x, o.z - z) < 9)) continue;
    mkVeh(kind, x, z, ba, true).v = 6; return;
  }
}
function spawnCop() {
  for (let n = 0; n < 30; n++) {
    const ang = rnd(0, 6.28), r = rnd(90, 170), x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r, a = Math.atan2(P.z - z, P.x - x);
    if (cellAt(x, z) !== ROAD || !vehFree(x, z, a, KIND.cop)) continue; mkVeh('cop', x, z, a, true).v = 8; return;
  }
}
function spawnPed(rmin = 45, rmax = 130) {
  for (let n = 0; n < 30; n++) {
    const ang = rnd(0, 6.28), r = rnd(rmin, rmax), x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r, t = cellAt(x, z); if (t !== PAVE && t !== PARK) continue;
    peds.push({ x, z, a: rnd(0, 6.28), t: rnd(1, 4), dead: false, sp: rnd(1.1, 1.8), flee: 0, mesh: makeHuman(pick(SHIRTS), pick(PANTS), pick(SKIN)) }); return;
  }
}

/* ---------- jobs ---------- */
const job = { st: 0, from: null, to: null, t: 0, cool: 1.5, msg: '' };
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 120, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
beacon.position.y = 60; beacon.visible = false; scene.add(beacon);
function updateJob(dt) {
  if (job.st === 0) { job.cool -= dt; if (job.cool <= 0) { job.from = pick(landmarks); do job.to = pick(landmarks); while (job.to === job.from); job.st = 1; job.msg = ''; } return; }
  if (job.st === 1) { if (d2(P, job.from) < 9) { job.st = 2; job.t = 35 + d2(job.from, job.to) / 9; beep(660, .12); } }
  else {
    job.t -= dt;
    if (d2(P, job.to) < 9) { const r = 150 + Math.floor(job.t * 5); P.money += r; job.msg = 'Delivered!  +₹' + r; job.st = 0; job.cool = 4; beep(880, .1); setTimeout(() => beep(1175, .15), 110); }
    else if (job.t <= 0) { job.msg = 'Too slow. Job failed.'; job.st = 0; job.cool = 4; beep(150, .3, 'sawtooth'); }
  }
}

/* ---------- train ---------- */
const train = { s: -400, on: false, timer: 20, mesh: null, len: 0 };
function initTrain() {
  if (!railFit) return; const g = new THREE.Group(); const n = 9;
  for (let i = 0; i < n; i++) { g.add(box(20, 3.1, 3, i % 3 === 1 ? '#7b3fa0' : '#f4efe2', -i * 21, 2.3, 0), box(19.4, .8, 3.06, '#1d2740', -i * 21, 2.9, 0), box(20, .5, 3.04, '#ffd23f', -i * 21, 1.35, 0)); }
  train.len = n * 21; g.visible = false; scene.add(g); train.mesh = g;
}
const trainPos = s => ({ x: railFit.a + railFit.b * s, z: s });
function updateTrain(dt) {
  if (!railFit) return;
  if (!train.on) { train.timer -= dt; if (train.timer <= 0) { train.on = true; train.s = -60; train.mesh.visible = true; beep(330, .9, 'sawtooth', .08); } return; }
  train.s += 27 * dt; const h = trainPos(train.s); train.mesh.position.set(h.x, 0, h.z); train.mesh.rotation.y = -Math.atan2(1, railFit.b);
  if (train.s - train.len > SZ + 60) { train.on = false; train.timer = 38; train.mesh.visible = false; }
}
function trainHits(o, r = 2.2) { if (!train.on) return false; const s = clamp(o.z, train.s - train.len, train.s), q = trainPos(s); return Math.hypot(o.x - q.x, o.z - q.z) < r && o.z <= train.s + 2 && o.z >= train.s - train.len - 2; }

/* ---------- input ---------- */
const keys = {}; let mouseDown = false;
const K_ = n => keys[n] ? 1 : 0;
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
  if (!state.started) return; if (!keys[k]) { if (k === 'e') enterExit(); if (k === 'h') horn(); } keys[k] = true;
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
$('c').addEventListener('mousedown', () => { mouseDown = true; if (state.started && document.pointerLockElement !== $('c')) $('c').requestPointerLock?.(); });
addEventListener('mouseup', () => { mouseDown = false; });
addEventListener('mousemove', e => { if (document.pointerLockElement === $('c') || mouseDown) { camYaw += e.movementX * .0026; camPitch = clamp(camPitch + e.movementY * .002, .06, 1.2); lastLook = time; } });
function horn() { beep(260, .3, 'sawtooth', .07); if (P.veh) for (const p of peds) if (d2(p, P) < 16) p.flee = 2; }
function enterExit() {
  if (state.dead > 0) return;
  if (P.veh) {
    const v = P.veh, K = KIND[v.k]; if (Math.abs(v.v) > 12) return; P.x = v.x; P.z = v.z;
    for (const s of [1, -1]) { const x = v.x - Math.sin(v.a) * (K.w / 2 + 1) * s, z = v.z + Math.cos(v.a) * (K.w / 2 + 1) * s; if (footFree(x, z)) { P.x = x; P.z = z; break; } }
    v.ai = false; P.veh = null; P.a = v.a;
  } else {
    let best = null, bd = 4.5; for (const c of cars) { const d = d2(c, P) - KIND[c.k].l * .25; if (d < bd) { bd = d; best = c; } }
    if (best) { P.veh = best; best.ai = false; best.far = false; if (best.k === 'cop') crime(1); beep(300, .08); }
  }
}
function shoot() {
  P.a = camYaw; P.aimT = .6; const dx = Math.cos(camYaw), dz = Math.sin(camYaw);
  const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xfff1a8 })); m.scale.set(1.2, .08, .08); m.rotation.y = -camYaw; scene.add(m);
  bullets.push({ x: P.x + dx, z: P.z + dz, vx: dx * 130, vz: dz * 130, life: .7, m }); beep(700, .05, 'square', .06);
  for (const p of peds) if (!p.dead && d2(p, P) < 28) p.flee = 4;
}

/* ================= update ================= */
function update(dt) {
  time += dt; P.cd -= dt; P.inv -= dt; P.aimT -= dt; updateTrain(dt);
  const fx = Math.cos(camYaw), fz = Math.sin(camYaw);
  if (state.dead > 0) { state.dead -= dt; if (state.dead <= 0) respawn(); }
  else {
    if (P.veh) {
      const v = P.veh; driveVeh(v, K_('w') + K_('arrowup') - K_('s') - K_('arrowdown'), K_('d') + K_('arrowright') - K_('a') - K_('arrowleft'), !!keys[' '], dt);
      if (P.veh) { P.x = v.x; P.z = v.z; P.a = v.a; }
    } else {
      const f = K_('w') + K_('arrowup') - K_('s') - K_('arrowdown'), r = K_('d') - K_('a'); camYaw += (K_('arrowright') - K_('arrowleft')) * 2 * dt;
      let mx = fx * f - fz * r, mz = fz * f + fx * r; const l = Math.hypot(mx, mz); P.sp = 0;
      if (l > 0) { P.sp = keys.shift ? 7.5 : 4.2; mx *= P.sp * dt / l; mz *= P.sp * dt / l; if (footFree(P.x + mx, P.z)) P.x += mx; if (footFree(P.x, P.z + mz)) P.z += mz; if (P.aimT <= 0) P.a += angDiff(P.a, Math.atan2(mz, mx)) * Math.min(1, dt * 12); }
      if ((keys.f || (mouseDown && document.pointerLockElement === $('c'))) && P.cd <= 0) { shoot(); P.cd = .2; }
      if (trainHits(P)) hurtP(200);
    }
    if (P.veh && trainHits(P.veh, 3)) hurtVeh(P.veh, 400);
    if (P.stars > 0) { P.starT -= dt; if (P.starT <= 0) { P.stars--; P.starT = 24; } }
    for (let i = cash.length - 1; i >= 0; i--) { const c = cash[i]; c.t -= dt; c.m.rotation.y += dt * 3; if (c.t <= 0 || Math.hypot(c.x - P.x, c.z - P.z) < 1.8) { if (c.t > 0) { P.money += c.v; beep(900, .06, 'sine', .06); } scene.remove(c.m); cash.splice(i, 1); } }
    updateJob(dt);
  }
  // cops
  const copN = cars.filter(c => c.k === 'cop' && c.ai).length;
  if (P.stars > 0 && state.dead <= 0 && copN < Math.min(6, P.stars * 1.4 + 1) && Math.random() < dt * 1.2) spawnCop();
  let traffic = 0;
  for (const c of cars) {
    const K = KIND[c.k];
    if (c.ai) { if (c.k === 'cop' && P.stars === 0) c.k2 = 1; aiDrive(c, dt); if (c.k !== 'cop') traffic++; }
    else if (c !== P.veh) { c.v *= Math.max(0, 1 - 3 * dt); if (Math.abs(c.v) > .3) driveVeh(c, 0, 0, false, dt); }
    if (c.dead) continue;
    if (c.k === 'cop' && c.ai && P.stars === 0 && d2(c, P) > 120) c.far = true;
    if (c.hp < 45 && Math.random() < dt * 8) burst(c.x + Math.cos(c.a) * K.l * .4, 1, c.z + Math.sin(c.a) * K.l * .4, 1, c.hp < 20 ? 0x222222 : 0x999999, 1.5, 1, .5);
    if (c !== P.veh && trainHits(c, 3)) { hurtVeh(c, 400); continue; }
    if (Math.abs(c.v) > 6) {
      const ca = Math.cos(c.a), sa = Math.sin(c.a);
      for (const p of peds) { if (p.dead) continue; const dx = p.x - c.x, dz = p.z - c.z, lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca; if (Math.abs(lx) < K.l / 2 + .4 && Math.abs(lz) < K.w / 2 + .4) { killPed(p, c === P.veh); if (c === P.veh) c.v *= .93; } }
      if (c !== P.veh && !P.veh && state.dead <= 0) { const dx = P.x - c.x, dz = P.z - c.z, lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca; if (Math.abs(lx) < K.l / 2 + .5 && Math.abs(lz) < K.w / 2 + .5) { hurtP(Math.abs(c.v) * 1.2); if (footFree(P.x + ca, P.z + sa)) { P.x += ca; P.z += sa; } } }
    }
    if (P.veh && c !== P.veh && d2(c, P.veh) < (K.l + KIND[P.veh.k].l) / 2) collide(P.veh, c);
    if (c.k === 'cop' && c.ai && !P.veh && state.dead <= 0 && P.stars > 0 && d2(c, P) < 4) P.bust += dt * 1.6;
    c.mesh.position.set(c.x, 0, c.z); c.mesh.rotation.y = -c.a;
    if (c.bar) c.bar.material.color.setHex((time * 8 | 0) % 2 ? 0xff2222 : 0x2266ff);
  }
  P.bust = Math.max(0, P.bust - dt * .6); if (P.bust > 1.3 && state.dead <= 0) { P.bust = 0; wasted('Busted'); }
  for (let i = cars.length - 1; i >= 0; i--) { const c = cars[i], d = d2(c, P); if (c.dead || (c.far && c !== P.veh && (c.dead || d > 70 || c.k !== 'cop')) || (c.ai && d > 320) || (!c.ai && c !== P.veh && d > 500)) { scene.remove(c.mesh); cars.splice(i, 1); } }
  if (traffic < 24 && Math.random() < dt * 4) spawnTraffic();
  // peds
  let pc = 0;
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i];
    if (p.dead) { p.rot += dt; if (p.rot > 14 || d2(p, P) > 200) { scene.remove(p.mesh); peds.splice(i, 1); } continue; }
    pc++; p.t -= dt; p.flee = Math.max(0, p.flee - dt); if (p.t <= 0) { p.t = rnd(1.5, 5); p.a += rnd(-1.6, 1.6); }
    const sp = p.sp * (p.flee > 0 ? 3.2 : 1), nx = p.x + Math.cos(p.a) * sp * dt, nz = p.z + Math.sin(p.a) * sp * dt, tt = cellAt(nx, nz), cur = cellAt(p.x, p.z);
    if (footFree(nx, nz) && ((tt !== ROAD && tt !== RAIL) || cur === ROAD || cur === RAIL || Math.random() < .004)) { p.x = nx; p.z = nz; } else p.a += Math.PI * rnd(.6, 1.4);
    if (trainHits(p)) { killPed(p, false); continue; }
    if (d2(p, P) > 190) { scene.remove(p.mesh); peds.splice(i, 1); continue; }
    p.mesh.position.set(p.x, 0, p.z); p.mesh.rotation.y = -p.a; animHuman(p.mesh, sp, dt);
  }
  if (pc < 46 && Math.random() < dt * 8) spawnPed();
  // bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.x += b.vx * dt; b.z += b.vz * dt; b.life -= dt; let hit = b.life <= 0 || solid(b.x, b.z);
    if (!hit) for (const p of peds) if (!p.dead && Math.abs(p.x - b.x) < .9 && Math.abs(p.z - b.z) < .9) { killPed(p, true); hit = true; break; }
    if (!hit) for (const c of cars) if (c !== P.veh && Math.hypot(c.x - b.x, c.z - b.z) < KIND[c.k].l / 2) { c.hurtByP = true; hurtVeh(c, 7); burst(b.x, 1, b.z, 3, 0xffee66, 4, .2, .1); if (c.k === 'cop') crime(1); hit = true; break; }
    if (hit) { scene.remove(b.m); bullets.splice(i, 1); } else b.m.position.set(b.x, 1.35, b.z);
  }
  for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.life -= dt; q.vy -= 9 * dt; q.m.position.x += q.vx * dt; q.m.position.y = Math.max(.05, q.m.position.y + q.vy * dt); q.m.position.z += q.vz * dt; const k = clamp(q.life / q.max, 0, 1); q.m.scale.setScalar(q.size * (.4 + k)); q.m.material.opacity = k; if (q.life <= 0) { scene.remove(q.m); q.m.material.dispose(); parts.splice(i, 1); } }
  // player mesh
  P.mesh.visible = !P.veh && state.dead <= 0 && (P.inv <= 0 || (time * 20 | 0) % 2 === 0);
  P.mesh.position.set(P.x, 0, P.z); P.mesh.rotation.y = -P.a; animHuman(P.mesh, P.sp, dt, P.aimT > 0);
}
function collide(a, b) {
  const Ka = KIND[a.k], Kb = KIND[b.k], ra = Ka.w / 2 + .2, rb = Kb.w / 2 + .2; let hit = false;
  for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const ax = a.x + Math.cos(a.a) * Ka.l / 4 * sa, az = a.z + Math.sin(a.a) * Ka.l / 4 * sa, bx = b.x + Math.cos(b.a) * Kb.l / 4 * sb, bz = b.z + Math.sin(b.a) * Kb.l / 4 * sb, d = Math.hypot(ax - bx, az - bz);
    if (d < ra + rb && d > .01) { hit = true; const o = (ra + rb - d) / 2, nx = (ax - bx) / d, nz = (az - bz) / d; if (vehFree(a.x + nx * o, a.z + nz * o, a.a, Ka)) { a.x += nx * o; a.z += nz * o; } if (vehFree(b.x - nx * o, b.z - nz * o, b.a, Kb)) { b.x -= nx * o; b.z -= nz * o; } }
  }
  if (hit) { const rel = Math.abs(a.v - b.v * Math.cos(angDiff(a.a, b.a))); if (rel > 8) { b.hurtByP = true; hurtVeh(a, rel * .55); hurtVeh(b, rel * .55); burst((a.x + b.x) / 2, 1, (a.z + b.z) / 2, 5, 0xdddddd, 5, .4, .16); beep(100, .07, 'sawtooth', .07); if (b.k === 'cop') crime(1); } a.v *= .8; b.v = b.v * .6 + a.v * .3 * Math.cos(angDiff(a.a, b.a)); }
}

/* ================= camera + hud ================= */
function updateCamera(dt) {
  const v = P.veh; let dist = v ? (v.k === 'bus' ? 17 : 9.5) : 5.2, h = v ? 1.9 : 1.6;
  if (v && time - lastLook > 1.5 && Math.abs(v.v) > 1) camYaw += angDiff(camYaw, v.v < -1 ? v.a + Math.PI : v.a) * Math.min(1, dt * 3.2);
  const fx = Math.cos(camYaw), fz = Math.sin(camYaw), cp = Math.cos(camPitch), spd = v ? Math.abs(v.v) / KIND[v.k].max : 0; dist += spd * 3;
  for (let d = 1; d <= dist; d += .5) if (solid(P.x - fx * d * cp, P.z - fz * d * cp)) { dist = Math.max(1.2, d - .7); break; }
  const tx = P.x - fx * dist * cp, ty = h + dist * Math.sin(camPitch) + (dist < 3 ? 1.5 : 0), tz = P.z - fz * dist * cp, k = Math.min(1, dt * 14);
  camera.position.x += (tx - camera.position.x) * k; camera.position.y += (ty - camera.position.y) * k; camera.position.z += (tz - camera.position.z) * k;
  camera.lookAt(P.x + fx * 3, h + .2, P.z + fz * 3); camera.fov += (62 + spd * 14 - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
  sky.position.copy(camera.position); sun.position.set(P.x + SUN.x * 300, SUN.y * 300, P.z + SUN.z * 300); sun.target.position.set(P.x, 0, P.z);
}
const rc = $('radar').getContext('2d');
function hud() {
  $('money').textContent = '₹' + P.money.toLocaleString('en-IN');
  $('stars').innerHTML = '<b>' + '★'.repeat(P.stars) + '</b>' + '★'.repeat(5 - P.stars);
  $('hp').firstChild.style.width = clamp(P.hp, 0, 100) + '%'; $('vhp').style.display = P.veh ? '' : 'none'; if (P.veh) $('vhp').firstChild.style.width = clamp(P.veh.hp, 0, 100) + '%';
  const txt = job.st === 1 ? 'Pick up the parcel at ' + job.from.n : job.st === 2 ? 'Deliver to ' + job.to.n + '  ·  ' + Math.max(0, job.t).toFixed(0) + 's' : job.msg;
  $('job').textContent = txt; $('job').style.display = txt ? '' : 'none';
  $('warn').textContent = train.on ? 'LOCAL TRAIN COMING THROUGH' : (railFit && train.timer < 5 ? 'Train approaching — stay off the tracks' : '');
  let near = null, nd = 1e9; for (const l of landmarks) { const d = d2(l, P); if (d < nd) { nd = d; near = l; } } $('near').textContent = near && nd < 260 ? near.n : 'Malad';
  $('help').textContent = P.veh ? 'W/S gas · brake   A/D steer   Space handbrake   E exit   H horn' : 'WASD move   Shift sprint   Click / F shoot   E enter vehicle';
  $('cross').style.display = P.veh ? 'none' : '';
  const tg = job.st === 1 ? job.from : job.st === 2 ? job.to : null; beacon.visible = !!tg; if (tg) { beacon.position.x = tg.x; beacon.position.z = tg.z; beacon.material.color.set(job.st === 1 ? 0x59f0a0 : 0xffd23f); }
  // radar: 184px shows 420m, rotated so camera-forward is up
  const S = 184, span = 420, sc = S / span; rc.save(); rc.clearRect(0, 0, S, S); rc.translate(S / 2, S / 2); rc.rotate(-camYaw - Math.PI / 2); rc.scale(sc, sc); rc.translate(-P.x, -P.z);
  rc.imageSmoothingEnabled = false; rc.drawImage(mini, 0, 0, mini.width * 3, mini.height * 3);
  const dot = (x, z, col, r) => { let dx = x - P.x, dz = z - P.z; const d = Math.hypot(dx, dz), m = span / 2 - 10; if (d > m) { dx *= m / d; dz *= m / d; } rc.fillStyle = col; rc.beginPath(); rc.arc(P.x + dx, P.z + dz, r / sc, 0, 6.3); rc.fill(); };
  for (const c of cars) if (c.k === 'cop' && c.ai) dot(c.x, c.z, (time * 4 | 0) % 2 ? '#ff3333' : '#3399ff', 4);
  if (tg) dot(tg.x, tg.z, job.st === 1 ? '#59f0a0' : '#ffd23f', 6);
  rc.restore(); rc.save(); rc.translate(S / 2, S / 2); rc.rotate(P.a - camYaw); rc.fillStyle = '#fff'; rc.beginPath(); rc.moveTo(0, -8); rc.lineTo(6, 6); rc.lineTo(-6, 6); rc.fill(); rc.restore();
}

/* ================= boot ================= */
let last = 0;
function frame(ts) { const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts; if (state.started) update(dt); updateCamera(dt); hud(); if (waterNormal) waterNormal.offset.set(ts * .00002, ts * .000013); composer.render(); requestAnimationFrame(frame); }
async function boot() {
  let d = null, real = false;
  try { const r = await fetch('map.json'); if (r.ok) { d = await r.json(); real = true; } } catch (e) { }
  if (!d || !d.roads || !d.roads.length) { d = fallbackMap(); real = false; }
  await (document.fonts?.load('60px Pacifico').catch(() => { })); await (document.fonts?.load('bold 21px Rubik').catch(() => { })); await loadHumans();
  const info = buildWorld(d); initTrain();
  $('mode').textContent = real ? `Real Malad from OpenStreetMap: ${d.roads.length} roads, ${info.osm} mapped buildings (+${info.filler} generated where unmapped)` : 'Schematic map — run "node tools/fetch-osm.cjs" to load real Malad streets and buildings';
  P.mesh = makeHuman('#2de2e6', '#f1faee', '#c68642', true);
  const s = nearestCell(startPt.x, startPt.z, v => v === PAVE); P.x = s.x; P.z = s.z;
  let ba = 0, bl = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, l = rayLen(startPt.x, startPt.z, a); if (l > bl) { bl = l; ba = a; } }
  mkVeh('taxi', startPt.x, startPt.z, ba, false); camYaw = ba; P.a = ba;
  for (let i = 0; i < 30; i++) spawnPed(10, 110); for (let i = 0; i < 12; i++) spawnTraffic();
  camera.position.set(P.x - Math.cos(camYaw) * 6, 4, P.z - Math.sin(camYaw) * 6);
  $('go').style.display = ''; window.__ready = true;
  $('ov').addEventListener('click', () => { state.started = true; $('ov').style.display = 'none'; $('c').requestPointerLock?.(); beep(500, .1); });
  Object.assign(window, { G: { P, cars, peds, state, job, update, get camYaw() { return camYaw; }, set camYaw(v) { camYaw = v; }, cellAt, train } });
  requestAnimationFrame(frame);
}
boot();
