import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { LEVELS, START } from './levels.js';

/* ============================================================
   基本工具
   ============================================================ */
const V = a => new THREE.Vector3(a[0], a[2] ?? 0, -a[1]);       // Blender (x,y,z) → three.js
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = n => String(n).padStart(2, '0');
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const app = $('#app'), canvas = $('#c');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;
const EYE = 1.6;

/* ============================================================
   進度（存在瀏覽器）
   ============================================================ */
const KEY = 'dnn-safety-quest-v1';
const fresh = () => ({ name: '', idx: 0, scores: {}, pos: null });
let S = fresh();
try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(fresh(), JSON.parse(raw)); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
const hasProgress = () => S.idx > 0 || Object.keys(S.scores).length > 0;
const totalScore = () => Object.values(S.scores).reduce((a, s) => a + s.score, 0);
const maxOf = lv => lv.tasks.length * 100;
const totalMax = () => LEVELS.reduce((a, lv) => a + maxOf(lv), 0);
const starsOf = (score, max) => score >= max * 0.9 ? 3 : score >= max * 0.6 ? 2 : 1;

/* ============================================================
   場景
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !new URLSearchParams(location.search).has('lowfx');
if (!renderer.shadowMap.enabled) renderer.setPixelRatio(0.5);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x8a7a66, 0.55));
const sun = new THREE.DirectionalLight(0xfff4e6, 1.6);
sun.position.copy(V([2.0, -3.0, 9.0])); sun.target.position.copy(V([6.0, 3.0, 0.0]));
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 20 });
scene.add(sun, sun.target);
const graze = new THREE.DirectionalLight(0xffffff, 1.1);
graze.position.copy(V([12.5, 2.6, 2.0])); graze.target.position.copy(V([4.7, -0.46, 1.3]));
scene.add(graze, graze.target);

const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function applySceneColor() { scene.background = new THREE.Color(css('--scene') || '#e8ecf5'); }
applySceneColor();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySceneColor);
new MutationObserver(applySceneColor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);

function resize() {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  const panel = $('#panel'), uiOn = !$('#ui').hidden;
  let fw = w, fh = h, ox = 0, oy = 0;
  if (uiOn && panel && w > 760) { ox = panel.offsetWidth + 16; fw = w + ox; }
  else if (uiOn && panel) { oy = Math.min(h * 0.4, panel.offsetHeight + 12); fh = h + oy; }
  camera.aspect = fw / fh;
  camera.fov = Math.min(85, Math.max(60, 2 * Math.atan(Math.tan(30 * Math.PI / 180) / camera.aspect) * 180 / Math.PI));
  camera.setViewOffset(fw, fh, ox, oy, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', () => requestAnimationFrame(resize));

/* ============================================================
   第一人稱移動
   ============================================================ */
const fp = { yaw: 0, pitch: 0, keys: new Set(), drag: null };
const colliders = [], ray = new THREE.Raycaster();
const outside = p => { const bx = p.x, by = -p.z; return bx < 0.3 || bx > 16.4 || by < -0.3 || by > 7.4; };
function lookAt(b) {                       // b: Blender [x,y,z]
  const d = V(b).sub(camera.position);
  fp.yaw = Math.atan2(-d.x, -d.z);
  fp.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6;
}
function blocked(dx, dz) {
  const len = Math.hypot(dx, dz); if (!len || !colliders.length) return false;
  const dir = new THREE.Vector3(dx, 0, dz).normalize();
  for (const h of [0.45, 1.25]) {
    ray.set(new THREE.Vector3(camera.position.x, h, camera.position.z), dir); ray.far = len + 0.3;
    if (ray.intersectObjects(colliders, false).length) return true;
  }
  return false;
}
function tryMove(dx, dz) {
  if (blocked(dx, dz)) return;
  const n = camera.position.clone(); n.x += dx; n.z += dz;
  if (!outside(n)) camera.position.copy(n);
}
let walking = null;                          // 自動前往的路徑
let paused = true;                           // 對話框開啟時暫停移動
function stepWalk(dt) {
  if (fp.keys.has('tl')) fp.yaw += 1.6 * dt;
  if (fp.keys.has('tr')) fp.yaw -= 1.6 * dt;
  let f = 0, r = 0;
  if (fp.keys.has('f')) f += 1; if (fp.keys.has('b')) f -= 1;
  if (fp.keys.has('sl')) r -= 1; if (fp.keys.has('sr')) r += 1;
  if ((f || r) && walking) walking = null;
  if (walking) stepAuto(dt);
  else if (f || r) {
    const fwd = new THREE.Vector3(-Math.sin(fp.yaw), 0, -Math.cos(fp.yaw));
    const right = new THREE.Vector3(Math.cos(fp.yaw), 0, -Math.sin(fp.yaw));
    const mv = fwd.multiplyScalar(f).add(right.multiplyScalar(r)).normalize().multiplyScalar(1.7 * dt);
    tryMove(mv.x, 0); tryMove(0, mv.z);
  }
  camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
}
// 沿中央走道（y = 2.8）前往站點，避開桌子與櫃台
function walkTo(lv) {
  const p = camera.position, bx = p.x, by = -p.z, CY = 2.8, [tx, ty] = lv.beacon;
  const pts = [];
  if (Math.abs(by - CY) > 0.4 && Math.abs(bx - tx) > 0.6) pts.push([bx, CY]);
  if (Math.abs(bx - tx) > 0.6) pts.push([tx, CY]);
  pts.push([tx, ty]);
  walking = { pts: pts.map(q => V([q[0], q[1], EYE])), look: lv.look };
  if (reduce) { camera.position.copy(walking.pts.at(-1)); lookAt(lv.look); walking = null; }
}
function stepAuto(dt) {
  const tgt = walking.pts[0], d = tgt.clone().sub(camera.position); d.y = 0;
  const dist = d.length(), sp = 2.4 * dt;
  const want = Math.atan2(-d.x, -d.z);
  let dy = want - fp.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  if (dist > 0.05) { fp.yaw += dy * Math.min(1, dt * 6); fp.pitch *= 0.9; }
  if (dist <= sp) {
    camera.position.x = tgt.x; camera.position.z = tgt.z; walking.pts.shift();
    if (!walking.pts.length) { const lk = walking.look; walking = null; lookAt(lk); }
  } else { d.normalize().multiplyScalar(sp); camera.position.add(d); }
}

let downAt = null;
canvas.addEventListener('pointerdown', e => {
  if (paused) return;
  downAt = { x: e.clientX, y: e.clientY, moved: 0 };
  fp.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!fp.drag || e.pointerId !== fp.drag.id) return;
  const dx = e.clientX - fp.drag.x, dy = e.clientY - fp.drag.y; fp.drag.x = e.clientX; fp.drag.y = e.clientY;
  if (downAt) downAt.moved += Math.abs(dx) + Math.abs(dy);
  fp.yaw += dx * 0.004; fp.pitch = Math.max(-1.1, Math.min(1.1, fp.pitch + dy * 0.004));
});
const endDrag = e => {
  if (fp.drag && e.pointerId === fp.drag.id) fp.drag = null;
  if (e.type === 'pointerup' && downAt && downAt.moved < 8) pick(e);
  downAt = null;
};
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'sl', KeyD: 'sr', ArrowLeft: 'tl', ArrowRight: 'tr' };
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input')) return;
  if (!paused) {
    const k = KEYS[e.code]; if (k) { fp.keys.add(k); e.preventDefault(); return; }
    if (e.code === 'KeyE' && !hunt) { const n = nearLevel(); if (n) { e.preventDefault(); openStage(n); } }
  } else if (rhythmKey && (e.code === 'Space' || e.code === 'Enter') && !e.repeat) {
    if (!(e.target.closest && e.target.closest('button'))) { e.preventDefault(); rhythmKey(); }
  }
});
addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) fp.keys.delete(k); });
addEventListener('blur', () => fp.keys.clear());
const PADK = { f: 'f', b: 'b', l: 'tl', r: 'tr' };
document.querySelectorAll('#pad button').forEach(b => {
  const k = PADK[b.dataset.k];
  b.addEventListener('pointerdown', e => { e.preventDefault(); fp.keys.add(k); b.setPointerCapture(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => fp.keys.delete(k));
});

/* ============================================================
   站點標記
   ============================================================ */
const ACCENT = new THREE.Color('#4a6cf7'), OK = new THREE.Color('#14915f');
const beacons = LEVELS.map(lv => {
  const g = new THREE.Group(); g.position.copy(V([lv.beacon[0], lv.beacon[1], 0.012]));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 48),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 48),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.18, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.4, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 1.2;
  g.add(disc, ring, beam); g.visible = false; scene.add(g);
  return { g, ring, disc, beam, lv };
});

/* ============================================================
   危害道具（第 2 關）
   ============================================================ */
const hazards = {};
const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.6, metalness: 0 }, o));
function box(w, d, h, mat, at) {                         // Blender 尺寸 w(x) d(y) h(z)，at 為底面中心
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.copy(V([at[0], at[1], at[2] + h / 2])); m.castShadow = true; m.receiveShadow = true; return m;
}
function tube(pts, r, mat) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => V(p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, r, 8, false), mat); m.castShadow = true; return m;
}
function hazard(key, group, proxy) {
  const pm = new THREE.Mesh(new THREE.BoxGeometry(proxy[3], proxy[5], proxy[4]), proxyMat);
  pm.position.copy(V([proxy[0], proxy[1], proxy[2] + proxy[5] / 2])); pm.userData.hazard = key;
  group.add(pm); scene.add(group);
  const glowMats = []; group.traverse(o => { if (o.isMesh && o !== pm && o.material !== proxyMat && o.material.emissive && !glowMats.includes(o.material)) { o.material.userData.e0 = o.material.emissive.clone(); glowMats.push(o.material); } });
  hazards[key] = { key, group, proxy: pm, glowMats, center: V([proxy[0], proxy[1], proxy[2] + proxy[5] / 2]) };
}
function textTexture(lines, bg, fg, w = 512, h = 200) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => { x.font = l.font; x.fillText(l.text, w / 2, h * (i + 1) / (lines.length + 1)); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function buildHazards() {
  // 1. 延長線串接（展示長桌螢幕下方地面）
  {
    const g = new THREE.Group(), white = std('#f2f2ee'), black = std('#1b1d22'), red = std('#d23a2a', { emissive: '#000000' });
    const s1 = box(0.42, 0.08, 0.05, white, [3.0, 0.62, 0]); const s2 = box(0.42, 0.08, 0.05, white, [3.42, 0.86, 0]);
    s2.rotation.y = 0.5; g.add(s1, s2);
    g.add(box(0.03, 0.03, 0.02, red, [2.82, 0.62, 0.05]), box(0.03, 0.03, 0.02, red, [3.25, 0.8, 0.05]));
    for (let i = 0; i < 4; i++) g.add(box(0.05, 0.05, 0.06, black, [2.9 + i * 0.075, 0.62, 0.05]));
    for (let i = 0; i < 3; i++) g.add(box(0.05, 0.05, 0.06, black, [3.38 + i * 0.07, 0.83 + i * 0.035, 0.05]));
    const cord = std('#202228');
    g.add(tube([[3.2, 0.62, 0.03], [3.22, 0.75, 0.01], [3.3, 0.86, 0.03]], 0.012, cord));
    for (let i = 0; i < 4; i++) g.add(tube([[2.9 + i * 0.075, 0.62, 0.1], [2.88 + i * 0.09, 0.4, 0.25], [2.85 + i * 0.12, 0.18, 0.72]], 0.008, cord));
    for (let i = 0; i < 3; i++) g.add(tube([[3.38 + i * 0.07, 0.83, 0.1], [3.45 + i * 0.08, 0.5, 0.3], [3.4 + i * 0.1, 0.17, 0.72]], 0.008, cord));
    g.add(tube([[3.62, 0.95, 0.03], [3.9, 1.1, 0.01], [4.4, 1.0, 0.01]], 0.012, cord));
    hazard('powerstrip', g, [3.2, 0.7, 0, 1.0, 0.6, 0.45]);
  }
  // 2. 紙箱堵住出入口（玻璃門內側北半邊）＋門上安全門標示
  {
    const g = new THREE.Group(), card = std('#b98a55', { roughness: 0.9 }), card2 = std('#a8794a', { roughness: 0.9 }), tape = std('#d8c79e');
    g.add(box(0.55, 0.45, 0.45, card, [10.55, 3.95, 0]), box(0.5, 0.42, 0.4, card2, [10.52, 3.95, 0.45]), box(0.42, 0.4, 0.35, card, [10.15, 4.05, 0]));
    g.add(box(0.56, 0.06, 0.005, tape, [10.55, 3.95, 0.45]), box(0.51, 0.06, 0.005, tape, [10.52, 3.95, 0.85]));
    hazard('exitblock', g, [10.4, 3.98, 0, 1.0, 0.75, 1.0]);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24),
      new THREE.MeshBasicMaterial({ map: textTexture([{ text: '安全門  EXIT', font: '900 82px "Noto Sans TC", sans-serif' }], '#0f8a4c', '#ffffff') }));
    sign.position.copy(V([10.9, 3.0, 2.72])); sign.rotation.y = -Math.PI / 2; scene.add(sign);
    for (const b of g.children) if (b.isMesh && b.material !== proxyMat) colliders.push(b);
  }
  // 3. 沒有標示的化學品瓶（展示長桌東側桌面）
  {
    const g = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: '#8a5a24', roughness: 0.15, transmission: 0.35, thickness: 0.02, transparent: true, opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.17, 24), glass); body.position.copy(V([6.35, -0.02, 0.74 + 0.085]));
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.04, 0.05, 24), glass); neck.position.copy(V([6.35, -0.02, 0.74 + 0.195]));
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.03, 24), std('#22252b')); cap.position.copy(V([6.35, -0.02, 0.74 + 0.235]));
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.1, 24), std('#d9c46a', { roughness: 0.2 })); liquid.position.copy(V([6.35, -0.02, 0.74 + 0.055]));
    g.add(liquid, body, neck, cap);
    const g2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 20), glass); g2.position.copy(V([6.48, 0.03, 0.74 + 0.06])); g.add(g2);
    hazard('bottle', g, [6.4, 0.0, 0.74, 0.45, 0.4, 0.4]);
  }
  // 4. 橫跨走道的電線（長桌東端拉到訪談區的落地燈）
  {
    const g = new THREE.Group(), orange = std('#f07b16', { roughness: 0.45 });
    g.add(tube([[7.55, 0.12, 0.74], [7.58, 0.3, 0.3], [7.6, 0.45, 0.012], [7.7, 1.4, 0.012], [7.62, 2.4, 0.012], [7.75, 3.4, 0.012], [7.7, 4.3, 0.012]], 0.02, orange));
    const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 28), std('#2a2d33')); lampBase.position.copy(V([7.7, 4.45, 0.02]));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.5, 12), std('#2a2d33')); pole.position.copy(V([7.7, 4.45, 0.78]));
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.25, 28, 1, true), std('#f5f2ea', { side: THREE.DoubleSide, emissive: '#fff2cc', emissiveIntensity: 0.4 }));
    shade.position.copy(V([7.7, 4.45, 1.6])); g.add(lampBase, pole, shade);
    hazard('cable', g, [7.66, 2.3, 0, 0.5, 4.2, 0.15]);
  }
}
function resetHazards() { for (const h of Object.values(hazards)) { h.group.visible = true; h.found = false; } }
function clearHazards() { for (const h of Object.values(hazards)) { h.group.visible = false; h.found = true; } }

/* ============================================================
   頭頂標籤（投影到畫面）
   ============================================================ */
const pinsEl = $('#pins');
const tags = [];
function addTag(html, pos, cls = '') {
  const el = document.createElement('div'); el.className = 'tag ' + cls;
  el.innerHTML = `<div class="lbl">${html}</div><div class="stem"></div>`; pinsEl.appendChild(el);
  const t = { el, p: pos.clone(), on: true }; tags.push(t); return t;
}
const pv = new THREE.Vector3(), tray = new THREE.Raycaster(), tdir = new THREE.Vector3(); let tagTick = 0;
function updateTags() {
  const w = app.clientWidth, h = app.clientHeight, check = (tagTick++ % 3 === 0) && colliders.length > 0;
  for (const t of tags) {
    if (!t.on) { t.el.style.visibility = 'hidden'; continue; }
    pv.copy(t.p); const d = pv.distanceTo(camera.position);
    if (check) { tdir.copy(pv).sub(camera.position).normalize(); tray.set(camera.position, tdir); tray.far = Math.max(0, d - 0.3); t.hid = tray.intersectObjects(colliders, false).length > 0; }
    pv.project(camera);
    const vis = !t.hid && pv.z > -1 && pv.z < 1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05 && d > 0.6 && d < 24;
    t.el.style.visibility = vis ? 'visible' : 'hidden';
    if (vis) { t.el.style.left = ((pv.x * 0.5 + 0.5) * w).toFixed(1) + 'px'; t.el.style.top = ((-pv.y * 0.5 + 0.5) * h).toFixed(1) + 'px'; }
  }
}
const stageTags = LEVELS.map(lv => addTag(`<b>${pad2(lv.id)}</b>${esc(lv.station)}`, V([lv.beacon[0], lv.beacon[1], 2.35])));
const foundTags = {};

/* ============================================================
   面板與進度
   ============================================================ */
const cur = () => LEVELS[Math.min(S.idx, LEVELS.length - 1)];
const list = $('#list');
LEVELS.forEach((lv, i) => {
  const li = document.createElement('li');
  li.innerHTML = `<button type="button"><span class="n">${pad2(lv.id)}</span><span class="t"></span><span class="st"></span></button>`;
  li.querySelector('.t').textContent = lv.name;
  li.firstChild.addEventListener('click', () => { if (i <= S.idx) { closeDialog(); walkTo(lv); canvas.focus({ preventScroll: true }); } });
  list.appendChild(li);
});
function renderPanelText() {
  const all = S.idx >= LEVELS.length, lv = cur();
  if (all) {
    $('#stageEn').textContent = 'Complete';
    $('#stageTitle').textContent = '全部過關';
    $('#stageDesc').textContent = `9 關全數完成，總分 ${totalScore()} / ${totalMax()}。可以再次挑戰任何一關刷新分數。`;
    $('#goStage').textContent = '結業證明';
  } else {
    $('#stageEn').textContent = `Stage ${pad2(lv.id)} / ${lv.en}`;
    $('#stageTitle').textContent = lv.name;
    $('#stageDesc').textContent = `前往「${lv.station}」，站上藍色光圈開始關卡。`;
    $('#goStage').textContent = '自動前往';
  }
}
function renderPanel() {
  const done = Object.keys(S.scores).length;
  $('#score').textContent = totalScore();
  $('#prog').style.width = (Math.min(done, LEVELS.length) / LEVELS.length * 100) + '%';
  renderPanelText(); wasReplay = false;
  [...list.children].forEach((li, i) => {
    const b = li.firstChild, sc = S.scores[LEVELS[i].id];
    b.disabled = i > S.idx;
    b.setAttribute('aria-current', i === S.idx ? 'true' : 'false');
    const st = b.querySelector('.st');
    st.textContent = sc ? '★'.repeat(sc.stars) : i === S.idx ? '進行中' : i > S.idx ? '未解鎖' : '';
    st.className = 'st' + (sc ? ' done' : '');
  });
  beacons.forEach((b, i) => {
    const active = i === S.idx, done = !!S.scores[LEVELS[i].id];
    b.g.visible = active || done;
    b.beam.visible = active;
    const c = active ? ACCENT : OK;
    b.ring.material.color.copy(c); b.disc.material.color.copy(c);
    b.g.scale.setScalar(active ? 1 : 0.6);
    stageTags[i].on = active || done;
    stageTags[i].el.classList.toggle('done', done && !active);
  });
  updateNear();
}
function nearLevel() {
  const top = Math.min(S.idx, LEVELS.length - 1);
  let best = null, bd = 1.4;
  for (let i = 0; i <= top; i++) {
    const lv = LEVELS[i], p = V([lv.beacon[0], lv.beacon[1], EYE]);
    const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
    if (d < bd) { bd = d; best = lv; }
  }
  return best;
}
let wasNear = null, wasReplay = false;
function updateNear() {
  const n = hunt ? null : nearLevel(), all = S.idx >= LEVELS.length;
  const replay = n && S.scores[n.id] && LEVELS.indexOf(n) !== S.idx;
  if (replay && n !== wasNear) {
    $('#stageEn').textContent = `Stage ${pad2(n.id)} / ${n.en} · 已過關`;
    $('#stageTitle').textContent = n.name;
    $('#stageDesc').textContent = `你在「${n.station}」，可以重玩本關刷新分數，或前往下一站。`;
    $('#goStage').textContent = all ? '結業證明' : '前往下一站';
  } else if (!replay && wasReplay) renderPanelText();
  wasReplay = !!replay;
  $('#near').classList.toggle('on', !!n && !touch);
  if (n) $('#near span').textContent = `已抵達「${n.station}」，${replay ? '重玩本關' : '開始關卡'}`;
  $('#startStage').disabled = !!hunt || !(n || all);
  $('#startStage').textContent = n ? (replay ? '重玩本關' : '開始關卡') : all ? '查看結業證明' : '開始關卡';
  if (n && n !== wasNear && !paused) setHint(touch ? `已抵達「${n.station}」，按「${replay ? '重玩本關' : '開始關卡'}」` : `已抵達「${n.station}」，按 <b>E</b> 或「${replay ? '重玩本關' : '開始關卡'}」`);
  if (!n && wasNear && !hunt) setHint(defaultHint());
  wasNear = n;
}
const defaultHint = () => touch ? '拖曳看四周、方向鍵移動，或按「自動前往」' : '拖曳畫面看四周，<b>W A S D</b> 移動，<b>← →</b> 轉向；也可以按「自動前往」';
let hintTimer = null;
function setHint(html, cls = '') {
  const h = $('#hint'); h.innerHTML = html; h.className = cls; h.hidden = !html;
  clearTimeout(hintTimer);                       // 手機畫面小，一般提示幾秒後自動收起；找危害時保留
  if (html && cls !== 'hunt' && matchMedia('(max-width:760px), (max-height:500px)').matches) hintTimer = setTimeout(() => { h.hidden = true; }, 4500);
}
$('#startStage').addEventListener('click', () => { const n = nearLevel(); if (hunt) return; if (n) openStage(n); else if (S.idx >= LEVELS.length) showCert(); });
$('#goStage').addEventListener('click', () => { if (S.idx >= LEVELS.length) { showCert(); return; } walkTo(cur()); canvas.focus({ preventScroll: true }); });

let toastTimer = null;
function toast(title, body) {
  const t = $('#toast'); t.innerHTML = `<b>${esc(title)}</b><span>${esc(body)}</span>`; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 4200);
}

/* ============================================================
   對話框
   ============================================================ */
const overlay = $('#overlay'), dlg = $('#dialog');
let rhythmKey = null;
function openDialog(html) {
  dlg.innerHTML = html; overlay.hidden = false; paused = true; fp.keys.clear(); walking = null;
  requestAnimationFrame(() => { const f = dlg.querySelector('[data-focus]') || dlg.querySelector('button,input'); f && f.focus({ preventScroll: true }); });
}
function closeDialog() { overlay.hidden = true; paused = false; rhythmKey = null; wasNear = undefined; }
overlay.addEventListener('keydown', e => {           // 焦點留在對話框內
  if (e.key !== 'Tab') return;
  const f = [...dlg.querySelectorAll('button:not([disabled]),input,a[href]')]; if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { f.at(-1).focus(); e.preventDefault(); }
  else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
});

/* ---------- 關卡流程 ---------- */
let run = null, hunt = null;
function openStage(lv) {
  run = { lv, i: 0, results: [] };
  if (lv.tasks.some(t => t.type === 'hunt')) resetHazards();
  openDialog(`
    <div class="eyebrow" style="color:var(--accent)">Stage ${pad2(lv.id)} / ${esc(lv.en)} · ${esc(lv.station)}</div>
    <h2 id="dlgTitle">${esc(lv.name)}</h2>
    <p>${esc(lv.intro)}</p>
    <p class="small">共 ${lv.tasks.length} 題，每題 100 分${lv.final ? `；答對 ${lv.pass} 題以上即通過` : ''}。</p>
    <div class="row"><button class="btn primary" data-focus id="go">開始</button><button class="btn" id="later">稍後再來</button></div>`);
  $('#go').onclick = () => renderTask();
  $('#later').onclick = () => { run = null; closeDialog(); };
}
function dotsHtml() {
  return `<div class="dots" aria-hidden="true">${run.lv.tasks.map((_, k) => {
    const r = run.results[k]; return `<i class="${k === run.i ? 'cur' : r == null ? '' : r >= 100 ? 'ok' : 'bad'}"></i>`;
  }).join('')}</div>`;
}
function head(t) {
  return `${dotsHtml()}<div class="eyebrow">第 ${run.i + 1} / ${run.lv.tasks.length} 題 · ${esc(run.lv.name)}</div><h3 id="dlgTitle">${esc(t.q)}</h3>`;
}
function finishTask(score, ok, explain, extraTitle) {
  run.results[run.i] = score;
  const fb = dlg.querySelector('.fbslot');
  fb.innerHTML = `<div class="fb ${ok ? 'ok' : 'bad'}"><b>${ok ? (extraTitle || '答對了！') : (extraTitle || '再加強一下')}</b>${esc(explain)}</div>
    <div class="row"><button class="btn primary" id="nextT" data-focus>${run.i + 1 < run.lv.tasks.length ? '下一題' : '看結果'}</button></div>`;
  $('#nextT').focus({ preventScroll: true });
  $('#nextT').onclick = () => { run.i++; run.i < run.lv.tasks.length ? renderTask() : stageResult(); };
}
function renderTask() {
  const t = run.lv.tasks[run.i];
  ({ mcq: taskMcq, order: taskOrder, match: taskMatch, rhythm: taskRhythm, hunt: taskHunt })[t.type](t);
}

/* ---------- 單選 ---------- */
function taskMcq(t) {
  dlg.innerHTML = `${head(t)}<div class="opts" role="group">${t.options.map((o, k) =>
    `<button class="opt" data-k="${k}"${k === 0 ? ' data-focus' : ''}><span class="k">${'ABC'[k]}</span><span>${esc(o)}</span></button>`).join('')}</div><div class="fbslot"></div>`;
  dlg.querySelector('[data-focus]').focus({ preventScroll: true });
  dlg.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const k = +b.dataset.k, ok = k === t.answer;
    dlg.querySelectorAll('.opt').forEach(x => { x.disabled = true; if (+x.dataset.k === t.answer) x.classList.add('right'); });
    if (!ok) b.classList.add('wrong');
    finishTask(ok ? 100 : 0, ok, ok ? t.explain : `正確答案是「${t.options[t.answer]}」。${t.explain}`);
  });
}

/* ---------- 排序 ---------- */
function taskOrder(t) {
  let pool = shuffle(t.items.map((s, k) => ({ s, k })));
  while (t.items.length > 1 && pool.every((p, i) => p.k === i)) pool = shuffle(pool);
  const seq = [];
  dlg.innerHTML = `${head(t)}<p class="small">依序點選下方項目排出順序；點已選的項目可以移除。</p>
    <ol class="seq" id="seq"></ol><div class="chips" id="pool"></div>
    <div class="row"><button class="btn primary" id="chk" disabled>確認順序</button><button class="btn" id="clr">清除</button></div><div class="fbslot"></div>`;
  const draw = () => {
    $('#seq').innerHTML = seq.length ? seq.map((p, i) => `<li><button data-i="${i}">${esc(p.s)}</button></li>`).join('') : '<div class="empty">尚未選擇</div>';
    $('#pool').innerHTML = pool.map(p => `<button class="chip" data-k="${p.k}"${seq.includes(p) ? ' disabled' : ''}>${esc(p.s)}</button>`).join('');
    $('#chk').disabled = seq.length !== t.items.length;
    $('#seq').querySelectorAll('button').forEach(b => b.onclick = () => { seq.splice(+b.dataset.i, 1); draw(); });
    $('#pool').querySelectorAll('.chip:not([disabled])').forEach(b => b.onclick = () => { seq.push(pool.find(p => p.k === +b.dataset.k)); draw(); const n = $('#pool').querySelector('.chip:not([disabled])'); n ? n.focus() : $('#chk').focus(); });
  };
  draw();
  $('#pool').querySelector('.chip').focus({ preventScroll: true });
  $('#clr').onclick = () => { seq.length = 0; draw(); };
  $('#chk').onclick = () => {
    const ok = seq.every((p, i) => p.k === i);
    $('#seq').className = 'seq ' + (ok ? 'ok' : 'bad');
    $('#seq').innerHTML = (ok ? seq : t.items.map((s, k) => ({ s, k }))).map(p => `<li><button disabled>${esc(p.s)}</button></li>`).join('');
    $('#pool').innerHTML = ''; $('#chk').remove(); $('#clr').remove();
    finishTask(ok ? 100 : 0, ok, ok ? t.explain : `上面是正確順序。${t.explain}`);
  };
}

/* ---------- 配對 ---------- */
function taskMatch(t) {
  const right = shuffle(t.pairs.map((p, k) => ({ s: p[1], k })));
  const link = {}; let sel = null;
  dlg.innerHTML = `${head(t)}<p class="small">先點左邊的危害圖式，再點右邊對應的危害。</p>
    <div class="match"><div class="col" id="L"></div><div class="col" id="R"></div></div>
    <div class="row"><button class="btn primary" id="chk" disabled>確認配對</button></div><div class="fbslot"></div>`;
  const draw = () => {
    $('#L').innerHTML = t.pairs.map((p, k) => `<button class="chip${sel === k ? ' sel' : ''}${link[k] != null ? ' paired' : ''}" data-k="${k}">${esc(p[0])}${link[k] != null ? `<small>→ ${esc(t.pairs[link[k]][1])}</small>` : ''}</button>`).join('');
    const used = new Set(Object.values(link));
    $('#R').innerHTML = right.map(r => `<button class="chip${used.has(r.k) ? ' paired' : ''}" data-k="${r.k}"${sel == null ? ' disabled' : ''}>${esc(r.s)}</button>`).join('');
    $('#chk').disabled = Object.keys(link).length !== t.pairs.length;
    $('#L').querySelectorAll('.chip').forEach(b => b.onclick = () => { sel = +b.dataset.k; draw(); $('#R').querySelector('.chip').focus(); });
    $('#R').querySelectorAll('.chip:not([disabled])').forEach(b => b.onclick = () => {
      const k = +b.dataset.k; for (const a in link) if (link[a] === k) delete link[a];
      link[sel] = k; sel = null; draw();
      const nx = $('#L').querySelector('.chip:not(.paired)'); nx ? nx.focus() : $('#chk').focus();
    });
  };
  draw(); $('#L').querySelector('.chip').focus({ preventScroll: true });
  $('#chk').onclick = () => {
    let good = 0;
    t.pairs.forEach((p, k) => { if (link[k] === k) good++; });
    $('#L').innerHTML = t.pairs.map((p, k) => `<button class="chip ${link[k] === k ? 'right' : 'wrong'}" disabled>${esc(p[0])}<small>→ ${esc(p[1])}</small></button>`).join('');
    $('#R').innerHTML = ''; $('#chk').remove();
    const score = Math.round(good / t.pairs.length * 100);
    finishTask(score, good === t.pairs.length, `${good === t.pairs.length ? '' : '左側已列出正確對應。'}${t.explain}`,
      good === t.pairs.length ? '全部配對正確！' : `配對對了 ${good} / ${t.pairs.length} 組`);
  };
}

/* ---------- 按壓節奏 ---------- */
function taskRhythm(t) {
  let taps = [], tries = 0;
  const lo = 70, hi = 150, pct = v => (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * 100;
  dlg.innerHTML = `${head(t)}<p class="small">${touch ? '點擊下方按鈕' : '點擊下方按鈕，或按 <kbd>空白鍵</kbd>'}，像做胸部按壓一樣穩定地連續按 ${t.count} 下。</p>
    <div class="rhythm">
      <div class="bpm" id="bpm">— <small>次／分鐘</small></div>
      <div class="gauge" aria-hidden="true"><div class="band" style="left:${pct(t.min)}%;width:${pct(t.max) - pct(t.min)}%"></div><div class="needle" id="needle" style="left:0%"></div>
        <div class="ticks"><span>70</span><span>90</span><span>110</span><span>130</span><span>150</span></div></div>
      <button class="press" id="press" data-focus>按壓</button>
      <div class="small" id="cnt">0 / ${t.count}</div>
    </div><div class="fbslot"></div>`;
  const bpmOf = arr => { const iv = []; for (let i = 1; i < arr.length; i++) iv.push(arr[i] - arr[i - 1]); iv.sort((a, b) => a - b); const m = iv[Math.floor(iv.length / 2)]; return 60000 / m; };
  const tap = () => {
    if ($('#press').disabled) return;
    const now = performance.now();
    if (taps.length && now - taps.at(-1) > 2000) taps = [];
    taps.push(now);
    const p = $('#press'); p.classList.add('hit'); setTimeout(() => p.classList.remove('hit'), 90);
    if (taps.length > 2) { const b = bpmOf(taps.slice(-6)); $('#bpm').innerHTML = `${Math.round(b)} <small>次／分鐘</small>`; $('#needle').style.left = pct(b) + '%'; }
    $('#cnt').textContent = `${taps.length} / ${t.count}`;
    if (taps.length >= t.count) {
      tries++;
      const b = Math.round(bpmOf(taps)), ok = b >= t.min && b <= t.max;
      $('#bpm').innerHTML = `${b} <small>次／分鐘</small>`; $('#needle').style.left = pct(b) + '%';
      if (ok || tries >= 2) {
        $('#press').disabled = true; rhythmKey = null;
        finishTask(ok ? (tries === 1 ? 100 : 60) : 0, ok,
          ok ? t.explain : `速率 ${b} 次／分鐘，${b < t.min ? '太慢了' : '太快了'}。${t.explain}`,
          ok ? `速率 ${b} 次／分鐘，節奏正確！` : null);
      } else {
        taps = []; $('#cnt').textContent = `0 / ${t.count}`;
        dlg.querySelector('.fbslot').innerHTML = `<div class="fb bad"><b>速率 ${b} 次／分鐘，${b < t.min ? '太慢了' : '太快了'}</b>目標是每分鐘 ${t.min}～${t.max} 下，大約每秒 2 下。再試一次。</div>`;
      }
    }
  };
  $('#press').addEventListener('pointerdown', e => { e.preventDefault(); tap(); });
  $('#press').addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); tap(); } });
  rhythmKey = tap;
}

/* ---------- 場景找危害 ---------- */
function taskHunt(t) {
  hunt = { t, found: new Set() };
  for (const k in foundTags) { foundTags[k].el.remove(); tags.splice(tags.indexOf(foundTags[k]), 1); delete foundTags[k]; }
  closeDialog();
  huntHint();
  toast('開始找危害', t.hint);
}
function huntHint() {
  if (!hunt) return;
  $('#stageDesc').textContent = `在展示間裡走動，找出 ${hunt.t.targets.length} 個危害並點擊。已找到 ${hunt.found.size} 個。`;
  setHint(`<b>找出危害 ${hunt.found.size} / ${hunt.t.targets.length}</b>　${esc(hunt.t.hint)}`, 'hunt');
}
const picker = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  if (!hunt || paused) return;
  const r = canvas.getBoundingClientRect();
  // projectionMatrix 已含 setViewOffset，直接用畫布座標
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  picker.setFromCamera(ndc, camera);
  const targets = Object.values(hazards).filter(h => h.group.visible && !hunt.found.has(h.key)).map(h => h.proxy);
  const hits = picker.intersectObjects([...targets, ...colliders], false);
  const hit = hits.find(h => h.object.userData.hazard || colliders.includes(h.object));
  if (!hit || !hit.object.userData.hazard) return;
  if (hit.distance > 5.5) { toast('再靠近一點', '走近一些再點擊。'); return; }
  const key = hit.object.userData.hazard, info = hunt.t.targets.find(x => x.key === key);
  hunt.found.add(key);
  const h = hazards[key];
  foundTags[key] = addTag(`✓ ${esc(info.label)}`, h.center.clone().add(new THREE.Vector3(0, 0.55, 0)), 'found');
  toast(`找到了：${info.label}`, info.explain);
  huntHint();
  if (hunt.found.size === hunt.t.targets.length) {
    const t = hunt.t; hunt = null;
    setTimeout(() => {
      clearHazards();
      for (const k in foundTags) foundTags[k].on = false;
      setHint(defaultHint());
      openDialog(''); renderAfterHunt(t);
    }, 1400);
  }
}
function renderAfterHunt(t) {
  dlg.innerHTML = `${head(t)}<div class="fbslot"></div>`;
  finishTask(100, true, '', '4 個危害全部找到，已經排除！');
  dlg.querySelector('.fb').insertAdjacentHTML('beforeend', `<ul class="list">${t.targets.map(x => `<li><b>${esc(x.label)}</b>${esc(x.explain)}</li>`).join('')}</ul>`);
}

/* ---------- 關卡結算 ---------- */
function stageResult() {
  const lv = run.lv, max = maxOf(lv), score = run.results.reduce((a, b) => a + (b || 0), 0);
  const correct = run.results.filter(r => r >= 100).length;
  if (lv.final && correct < lv.pass) {
    dlg.innerHTML = `<div class="eyebrow">Stage ${pad2(lv.id)} / ${esc(lv.en)}</div><h2 id="dlgTitle">差一點就過關</h2>
      <p>答對 ${correct} / ${lv.tasks.length} 題，需要答對 ${lv.pass} 題才能通過。看完每題的解說後再挑戰一次。</p>
      <div class="row"><button class="btn primary" id="retry" data-focus>再挑戰一次</button><button class="btn" id="later">先去複習</button></div>`;
    $('#retry').onclick = () => openStage(lv); $('#later').onclick = () => { run = null; closeDialog(); };
    $('#retry').focus({ preventScroll: true });
    return;
  }
  const prev = S.scores[lv.id], stars = starsOf(score, max);
  if (!prev || score > prev.score) S.scores[lv.id] = { score, max, stars };
  const firstClear = S.idx === LEVELS.indexOf(lv);
  if (firstClear) S.idx++;
  save(); renderPanel();
  const best = S.scores[lv.id];
  const next = LEVELS[S.idx];
  dlg.innerHTML = `<div class="eyebrow">Stage ${pad2(lv.id)} Clear</div><h2 id="dlgTitle">${esc(lv.name)}　過關！</h2>
    <div class="stars" aria-label="${stars} 顆星">${[1, 2, 3].map(k => `<span class="${k <= stars ? '' : 'off'}">★</span>`).join('')}</div>
    <div class="result"><div><b>${score}</b><span>本關得分</span></div><div><b>${correct}/${lv.tasks.length}</b><span>答對題數</span></div><div><b>${totalScore()}</b><span>累計總分</span></div></div>
    ${prev && score <= prev.score ? `<p class="small">最佳紀錄維持 ${best.score} 分。</p>` : ''}
    <p>${lv.final ? '恭喜完成全部 9 關！' : next ? `下一站：「${esc(next.station)}」的「${esc(next.name)}」。` : ''}</p>
    <div class="row">${lv.final ? '<button class="btn primary" id="cert" data-focus>領取結業證明</button>' : '<button class="btn primary" id="cont" data-focus>前往下一站</button>'}<button class="btn" id="stay">留在這裡</button></div>`;
  run = null;
  if (lv.final) $('#cert').onclick = showCert;
  else $('#cont').onclick = () => { closeDialog(); if (S.idx < LEVELS.length) walkTo(cur()); canvas.focus({ preventScroll: true }); };
  $('#stay').onclick = () => { closeDialog(); canvas.focus({ preventScroll: true }); };
  dlg.querySelector('[data-focus]').focus({ preventScroll: true });
}

/* ============================================================
   結業證明
   ============================================================ */
const logo = new Image(); logo.src = 'assets/dnn-logo.webp';
async function drawCert() {
  try { await document.fonts.ready; await Promise.all([document.fonts.load('900 60px "Noto Sans TC"'), document.fonts.load('500 30px "JetBrains Mono"')]); } catch (e) {}
  if (!logo.complete) await new Promise(r => { logo.onload = logo.onerror = r; });
  const W = 1600, H = 1130, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const sans = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif', mono = '"JetBrains Mono",monospace';
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#009fdc'); g.addColorStop(0.5, '#1d5fb0'); g.addColorStop(1, '#5a3d99');
  x.fillStyle = g; x.fillRect(0, 0, W, 18); x.fillRect(0, H - 18, W, 18);
  x.strokeStyle = '#e2e6f1'; x.lineWidth = 2; x.strokeRect(60, 60, W - 120, H - 120);
  if (logo.naturalWidth) { const lh = 92, lw = lh * logo.naturalWidth / logo.naturalHeight; x.drawImage(logo, (W - lw) / 2, 130, lw, lh); }
  x.textAlign = 'center'; x.fillStyle = '#5e6a8a'; x.font = `500 26px ${mono}`; x.fillText('SAFETY QUEST CERTIFICATE', W / 2, 290);
  x.fillStyle = '#12152b'; x.font = `900 76px ${sans}`; x.fillText('闖關結業證明', W / 2, 385);
  x.fillStyle = '#4a6cf7'; x.font = `900 64px ${sans}`; x.fillText(S.name || '學員', W / 2, 520);
  x.fillStyle = '#d6dbea'; x.fillRect(W / 2 - 260, 548, 520, 3);
  x.fillStyle = '#12152b'; x.font = `500 32px ${sans}`;
  x.fillText('已完成 DNN 3F 展示間「一般安全衛生教育訓練」闖關', W / 2, 625);
  x.fillText('9 關全數通過', W / 2, 678);
  const d = new Date(), ds = `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  const cells = [[`${totalScore()} / ${totalMax()}`, '總分'], [`${Object.values(S.scores).reduce((a, s) => a + s.stars, 0)} / 27`, '星數'], [ds, '完成日期']];
  cells.forEach((cl, i) => {
    const cx = W / 2 + (i - 1) * 400;
    x.fillStyle = '#f3f5fb'; if (x.roundRect) { x.beginPath(); x.roundRect(cx - 175, 730, 350, 130, 16); x.fill(); } else x.fillRect(cx - 175, 730, 350, 130);
    x.fillStyle = '#12152b'; x.font = `700 ${i === 2 ? 34 : 44}px ${i === 2 ? sans : mono}`; x.fillText(cl[0], cx, 800);
    x.fillStyle = '#5e6a8a'; x.font = `500 24px ${sans}`; x.fillText(cl[1], cx, 840);
  });
  x.fillStyle = '#12152b'; x.font = `700 30px ${sans}`; x.fillText('歐耀科技有限公司', W / 2, 950);
  x.fillStyle = '#8c96b8'; x.font = `400 21px ${sans}`; x.fillText('本證明為課程輔助活動紀錄，不取代法定教育訓練的簽到與訓練紀錄。', W / 2, 1000);
  return c;
}
let certUrl = null;
async function showCert() {
  openDialog(`<div class="eyebrow">Certificate</div><h2 id="dlgTitle">闖關結業證明</h2><p class="small">正在產生證明…</p>`);
  const c = await drawCert();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const d = new Date(), fname = `DNN_Safety_Quest_Certificate_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.png`;
  const file = new File([blob], fname, { type: 'image/png' });
  if (certUrl) URL.revokeObjectURL(certUrl);
  certUrl = URL.createObjectURL(blob);
  // 手機（尤其 iPhone 的 App 內瀏覽器）不支援網頁直接下載，改用系統分享選單存圖
  const share = touch && !!(navigator.canShare && navigator.canShare({ files: [file] }));
  dlg.innerHTML = `<div class="eyebrow">Certificate</div><h2 id="dlgTitle">恭喜過關！</h2>
    <div class="cert"><img src="${certUrl}" alt="闖關結業證明，${esc(S.name || '學員')}，總分 ${totalScore()} 分"></div>
    ${touch ? '<p class="small">存不下來的話，長按上方圖片，選「加入照片」或「儲存影像」。</p>' : ''}
    <div class="field"><label for="certName">證明上的名字</label><input id="certName" maxlength="20" value="${esc(S.name)}" placeholder="輸入你的名字"></div>
    <div class="row"><button class="btn primary" id="dl" data-focus>${share ? '儲存證明圖片' : '下載證明圖片'}</button><button class="btn" id="redraw">更新名字</button><button class="btn" id="close">關閉</button></div>`;
  $('#dl').onclick = () => {
    if (share) { navigator.share({ files: [file], title: '安全衛生闖關結業證明' }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = certUrl; a.download = fname;
    a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a); a.click(); setTimeout(() => a.remove(), 1000);
  };
  $('#redraw').onclick = () => { S.name = $('#certName').value.trim(); save(); showCert(); };
  $('#close').onclick = () => { closeDialog(); canvas.focus({ preventScroll: true }); };
}

/* ============================================================
   開始畫面、說明、重設
   ============================================================ */
function helpHtml() {
  return `<div class="keys">
    ${touch ? '<span>拖曳畫面</span><span>看四周</span><span>▲ ▼</span><span>前進、後退</span><span>◀ ▶</span><span>轉向</span>'
      : '<span>拖曳畫面</span><span>看四周</span><span>W S / ↑ ↓</span><span>前進、後退</span><span>A D</span><span>左右平移</span><span>← →</span><span>轉向</span><span>E</span><span>抵達站點後開始關卡</span>'}
    <span>自動前往</span><span>直接走到下一個站點</span></div>`;
}
function showStart(ready) {
  const cont = hasProgress();
  openDialog(`<div class="eyebrow" style="color:var(--accent)">DNN 3F Showroom · Safety Quest</div>
    <h2 id="dlgTitle">安全衛生闖關</h2>
    <p>在 3F 展示間裡走一圈，跟著藍色光圈走到 9 個站點，闖過法規、找危害、消防、急救等關卡。最後通過結業測驗，就能領取結業證明。</p>
    ${ready ? `<div class="field"><label for="nm">你的名字（會印在結業證明上）</label><input id="nm" maxlength="20" value="${esc(S.name)}" placeholder="例如：王小明"></div>
    ${helpHtml()}
    <div class="row">${cont ? `<button class="btn primary" id="cont" data-focus>繼續闖關（第 ${Math.min(S.idx + 1, 9)} 關）</button><button class="btn" id="new">從頭開始</button>` : '<button class="btn primary" id="new" data-focus>開始闖關</button>'}</div>`
      : `<div class="load"><div class="meter"><i id="bar"></i></div><div class="msg" id="loadMsg">正在載入展示間模型…</div></div>`}`);
  if (!ready) return;
  const begin = reset => {
    const nm = $('#nm').value.trim();
    if (reset) { const keepName = nm; S = fresh(); S.name = keepName; } else S.name = nm;
    save(); $('#ui').hidden = false; resize(); placeAtStart(); renderPanel(); closeDialog();
    setHint(defaultHint()); canvas.focus({ preventScroll: true });
  };
  if (cont) $('#cont').onclick = () => begin(false);
  $('#new').onclick = () => begin(true);
}
function placeAtStart() {
  const lv = S.idx > 0 && S.idx <= LEVELS.length ? LEVELS[S.idx - 1] : null;
  if (lv) {
    const nx = LEVELS[S.idx], from = V([lv.beacon[0], lv.beacon[1], EYE]);
    if (nx) { const to = V([nx.beacon[0], nx.beacon[1], EYE]), d = to.clone().sub(from); from.add(d.setLength(Math.min(1.7, d.length()))); }
    camera.position.copy(from); lookAt(nx ? [nx.beacon[0], nx.beacon[1], 1.2] : lv.look);
  }
  else { camera.position.copy(V([START.pos[0], START.pos[1], EYE])); lookAt(START.look); }
  if (S.idx > 1) clearHazards(); else resetHazards();
}
$('#btnHelp').onclick = () => {
  openDialog(`<div class="eyebrow">How to play</div><h2 id="dlgTitle">操作說明</h2>${helpHtml()}
    <p class="small">進度會存在這台裝置的瀏覽器裡，下次打開可以接著玩。</p><div class="row"><button class="btn primary" id="ok" data-focus>知道了</button></div>`);
  $('#ok').onclick = closeDialog;
};
$('#btnReset').onclick = () => {
  openDialog(`<h2 id="dlgTitle">重新開始？</h2><p>會清除目前的分數與進度，從第 1 關重新開始。</p>
    <div class="row"><button class="btn primary" id="yes">重新開始</button><button class="btn" id="no" data-focus>取消</button></div>`);
  $('#no').onclick = closeDialog;
  $('#yes').onclick = () => { const n = S.name; S = fresh(); S.name = n; hunt = null; run = null; for (const k in foundTags) foundTags[k].on = false; save(); placeAtStart(); renderPanel(); closeDialog(); setHint(defaultHint()); };
};

/* ============================================================
   載入模型
   ============================================================ */
showStart(false);
camera.position.copy(V([START.pos[0], START.pos[1], EYE])); lookAt(START.look);
camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
resize();
$('#pad').hidden = !touch;

function onModel(g) {
  const root = g.scene, bx = new THREE.Box3(), aniso = renderer.capabilities.getMaxAnisotropy();
  root.updateMatrixWorld(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let glass = false;
    for (const m of mats) {
      if (m.name === 'Table_Marble') { m.color.set('#efece6'); m.roughness = 0.25; }
      if (m.transparent || m.opacity < 1) { m.depthWrite = false; glass = true; }
      if (m.map) m.map.anisotropy = aniso;
    }
    if (glass) { o.castShadow = false; return; }
    bx.setFromObject(o);
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    if (bx.max.y - bx.min.y > 0.6 && bx.min.y < 0.3 && tris < 6000) colliders.push(o);
  });
  scene.add(root);
  let floorMat = null;
  root.traverse(o => { if (o.isMesh && !floorMat) { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (m && m.name === 'Floor_Wood') floorMat = m; } });
  if (floorMat) {                               // 門外走道地板
    const C = [[13.05, -0.7], [16.5, -0.7], [16.5, 7.6], [13.05, 7.6]], z = -0.013;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(C.flatMap(([x, y]) => { const p = V([x, y, z]); return [p.x, p.y, p.z]; }), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(C.flatMap(([x, y]) => [x / 1.835, 1 - y / 1.17]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]); geo.computeVertexNormals();
    const ext = new THREE.Mesh(geo, floorMat); ext.receiveShadow = true; scene.add(ext);
  }
  buildHazards();
  renderPanel();
  showStart(true);
}
(async () => {
  try {
    const res = await fetch('assets/showroom.glb');
    const total = +res.headers.get('content-length') || 1900000;
    const reader = res.body.getReader(); const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      chunks.push(value); got += value.length;
      const bar = $('#bar'); if (bar) bar.style.width = Math.min(95, got / total * 90) + '%';
    }
    const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
    gl.parse(buf.buffer, '', onModel, () => { const m = $('#loadMsg'); if (m) m.textContent = '模型載入失敗，請重新整理頁面。'; });
  } catch (e) { const m = $('#loadMsg'); if (m) m.textContent = '模型載入失敗，請重新整理頁面。'; }
})();

/* ============================================================
   主迴圈
   ============================================================ */
const clock = new THREE.Clock();
let frame = 0;
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  // 對話框開著時場景只是背景，降低重繪頻率以省電
  if (paused && !overlay.hidden && (frame++ % 20)) return;
  if (!paused) stepWalk(dt); else camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
  const b = beacons[S.idx];
  if (b && b.g.visible) {
    const s = 1 + Math.sin(t * 2.4) * 0.06; b.ring.scale.set(s, s, 1);
    b.beam.material.opacity = 0.09 + 0.05 * (0.5 + 0.5 * Math.sin(t * 2.4));
  }
  if (hunt) for (const h of Object.values(hazards)) {
    if (!h.group.visible || hunt.found.has(h.key)) continue;
    const near = camera.position.distanceTo(h.center) < 2.6;
    const k = near ? 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(t * 5)) : 0;
    for (const m of h.glowMats) { const e = m.userData.e0; m.emissive.setRGB(e.r + k, e.g + k * 0.6, e.b); }
  }
  if (!paused) updateNear();
  updateTags();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(loop);

/* 測試用：網址加上 ?debug 才會開放 */
if (new URLSearchParams(location.search).has('debug')) {
  window.__q = {
    tp(i) { const lv = LEVELS[i]; walking = null; camera.position.copy(V([lv.beacon[0], lv.beacon[1], EYE])); lookAt(lv.look); },
    tpAt(b, look) { walking = null; camera.position.copy(V([b[0], b[1], EYE])); lookAt(look); },
    screenOf(key) {
      const h = hazards[key]; const v = h.center.clone(); v.project(camera);
      return { x: (v.x * 0.5 + 0.5) * app.clientWidth, y: (-v.y * 0.5 + 0.5) * app.clientHeight, z: v.z };
    },
    state: () => JSON.parse(JSON.stringify(S)),
    freeze(on) { renderer.setAnimationLoop(on ? null : loop); },
  };
}
