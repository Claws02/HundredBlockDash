// ============================================================
// RENDERER — Three.js scene, city circuit + hundred block dash
// ============================================================

import { state } from '../core/GameState.js';
import { SPACE_META, DISTRICT_BIOMES, getBiomeForDistrict, HBD_BIOMES, getBiomeForSpace, ALLIES, CHAR_ICONS, HBD_DEFAULT_CONFIG } from '../config/GameConfig.js';
import { CITY_GRAPH, ALL_NODES_ORDERED, JUNCTION_IDS } from '../config/BoardGraph.js';
import { SCENE } from '../config/SceneTiming.js';
import * as Physics from './Physics.js';
import { sfx } from './AudioManager.js';   // set pieces cue their own sound

let scene, camera, renderer, clock;
let boardGrp, diceGrp;
let _prevActivePlayer = -1;
const activeAnims   = [];
const floatingIcons = [];
const tileMeshes    = [];
const textureCache  = {};
const _camHelper    = new THREE.PerspectiveCamera();

// Node position map: nodeId → THREE.Vector3 (City Circuit)
const nodePositions = new Map();
// HBD linear path positions: index 0..(length-1) → THREE.Vector3
const hbdPositions  = [];
let _hbdMax = 99;             // highest valid HBD index (length - 1); set in buildHBDPositions
export let boardCurve = null; // HBD CatmullRom curve, null for City Circuit
// Ally mesh markers on map: nodeId → mesh
const allyMarkers   = new Map();

export function getActiveAnims() { return activeAnims; }
// The render loop animates everything in `floatingIcons` every frame, forever.
// A row that outlives the mesh it points at is invisible in every screenshot and
// in the scene-graph census — the only way to see it is to count the rows. The
// ally marker leaked one per spawn until 2026-08.
export function getFloatingIconCount() { return floatingIcons.length; }

// Shared geometries
const GEOS = {
    torus:        new THREE.TorusGeometry(0.6, 0.2, 8, 16),
    double_torus: new THREE.TorusGeometry(0.8, 0.3, 10, 20),
    tetra:        new THREE.TetrahedronGeometry(0.8),
    icosa:        new THREE.IcosahedronGeometry(0.8),
    box:          new THREE.BoxGeometry(1, 1, 1),
    cone_up:      new THREE.ConeGeometry(0.6, 1.5, 8),
    cone_down:    new THREE.ConeGeometry(0.6, 1.5, 8),
    knot:         new THREE.TorusKnotGeometry(0.5, 0.15, 32, 8),
    crystal:      new THREE.OctahedronGeometry(0.8),
};
GEOS.cone_down.rotateX(Math.PI);
GEOS.crystal.applyMatrix4(new THREE.Matrix4().makeScale(1, 2, 1));

const _hexGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.4, 6);
_hexGeo.rotateY(Math.PI / 6);

// Geometries and textures owned by the module and reused across every redraw.
// A tile teardown must never dispose these — only the per-tile materials it
// created. (textureCache entries are shared the same way and are only released
// by cleanup().)
const _SHARED_GEOS = new Set([...Object.values(GEOS), _hexGeo]);

// Floating icons created *by drawTiles* — bobbing gems, shop signs, HQ stars and
// space icons. Tracked separately from the permanent scenery icons built during
// init() so a redraw can tear down exactly its own meshes. Before this existed,
// drawTiles() cleared the `floatingIcons` tracking array without removing the
// meshes from the scene, so every updateSingleTile() left a full set of frozen
// duplicate icons behind and stopped the ambient scenery animating.
const _tileIcons = [];

// Register a drawTiles-owned floating icon.
function _pushTileIcon(entry) {
    _tileIcons.push(entry);
    floatingIcons.push(entry);
    return entry;
}

// Remove and release everything drawTiles() added last time round.
function _clearTileObjects() {
    tileMeshes.forEach(m => {
        boardGrp.remove(m);
        _disposeTree(m);
    });
    tileMeshes.length = 0;

    _tileIcons.forEach(entry => {
        const idx = floatingIcons.indexOf(entry);
        if (idx >= 0) floatingIcons.splice(idx, 1);
        // Group-owned icons are children of a tileMesh group already disposed above.
        if (!entry.group && entry.mesh) {
            boardGrp.remove(entry.mesh);
            _disposeTree(entry.mesh);
        }
    });
    _tileIcons.length = 0;
}

// Dispose an object's own GPU resources, skipping anything shared module-wide.
function _disposeTree(root) {
    if (!root || !root.traverse) return;
    root.traverse(n => {
        if (n.geometry && !_SHARED_GEOS.has(n.geometry)) {
            try { n.geometry.dispose(); } catch (e) {}
        }
        const mats = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
        mats.forEach(m => { try { m.dispose(); } catch (e) {} });   // .map is cached; left alone
    });
}

// ---- Position computation ----
// Arc points on a circle: count points exclusive of start/end
function _arcPts(startDeg, endDeg, count, radius) {
    const pts = [];
    for (let i = 1; i <= count; i++) {
        const t = i / (count + 1);
        const deg = startDeg + (endDeg - startDeg) * t;
        const rad = deg * Math.PI / 180;
        pts.push(new THREE.Vector3(radius * Math.cos(rad), 0, -radius * Math.sin(rad)));
    }
    return pts;
}

function buildNodePositions() {
    const R  = 32;  // ring road radius
    const DR = 58;  // district arc radius

    // Branch junctions (on ring circle)
    nodePositions.set('bp_a', new THREE.Vector3(0,   0, -R));
    nodePositions.set('bp_b', new THREE.Vector3(R,   0,  0));
    nodePositions.set('bp_c', new THREE.Vector3(0,   0,  R));
    nodePositions.set('bp_d', new THREE.Vector3(-R,  0,  0));

    // Ring road — 4 arcs of 5 spaces each
    const rA = _arcPts(90, 0,   5, R); // bp_a → bp_b (north-east)
    const rB = _arcPts(0, -90,  5, R); // bp_b → bp_c (south-east)
    const rC = _arcPts(-90, -180, 5, R); // bp_c → bp_d (south-west)
    const rD = _arcPts(180, 90, 5, R); // bp_d → bp_a (north-west)
    ['r1','r2','r3','r4','r5'].forEach((id,i) => nodePositions.set(id, rA[i]));
    ['r6','r7','r8','r9','r10'].forEach((id,i) => nodePositions.set(id, rB[i]));
    ['r11','r12','r13','r14','r15'].forEach((id,i) => nodePositions.set(id, rC[i]));
    ['r16','r17','r18','r19','r20'].forEach((id,i) => nodePositions.set(id, rD[i]));

    // Districts — same angular span as corresponding ring segment but larger radius
    const dFin  = _arcPts(90, 0,   10, DR);
    const dBA   = _arcPts(0, -90,  12, DR);
    const dShop = _arcPts(-90, -180, 10, DR);
    const dInd  = _arcPts(180, 90,  8,  DR);
    ['fin_0','fin_1','fin_2','fin_3','fin_4','fin_5','fin_6','fin_7','fin_8','fin_9'].forEach((id,i) => nodePositions.set(id, dFin[i]));
    ['ba_0','ba_1','ba_2','ba_3','ba_4','ba_5','ba_6','ba_7','ba_8','ba_9','ba_10','ba_11'].forEach((id,i) => nodePositions.set(id, dBA[i]));
    ['shop_0','shop_1','shop_2','shop_3','shop_4','shop_5','shop_6','shop_7','shop_8','shop_9'].forEach((id,i) => nodePositions.set(id, dShop[i]));
    ['ind_0','ind_1','ind_2','ind_3','ind_4','ind_5','ind_6','ind_7'].forEach((id,i) => nodePositions.set(id, dInd[i]));
}

export function getPos(nodeId) {
    if (typeof nodeId === 'number') return hbdPositions[Math.max(0, Math.min(nodeId, _hbdMax))] || new THREE.Vector3();
    return nodePositions.get(nodeId) || new THREE.Vector3(0, 0, 0);
}

// Camera reference curve — loop following ALL_NODES_ORDERED for smooth interpolation
let _camCurve;
let _camCurveLen;

function buildCamCurve() {
    const pts = ALL_NODES_ORDERED.map(id => getPos(id).clone().setY(0));
    pts.push(pts[0].clone()); // close the loop
    _camCurve = new THREE.CatmullRomCurve3(pts, true);
    _camCurveLen = ALL_NODES_ORDERED.length;
}

export function getNodeT(nodeId) {
    if (typeof nodeId === 'number') return nodeId / _hbdMax;
    const idx = ALL_NODES_ORDERED.indexOf(nodeId);
    if (idx < 0) return 0;
    return idx / _camCurveLen;
}

// ---- HBD board ----

function buildHBDPositions() {
    const waypoints = [
        new THREE.Vector3(0, 0, 0),     new THREE.Vector3(0, 0, -30),
        new THREE.Vector3(40, 0, -60),  new THREE.Vector3(60, 0, -100),
        new THREE.Vector3(20, 0, -140), new THREE.Vector3(-40, 0, -160),
        new THREE.Vector3(-60, 0, -200),new THREE.Vector3(-20, 0, -240),
        new THREE.Vector3(30, 0, -280), new THREE.Vector3(40, 0, -320),
        new THREE.Vector3(0, 0, -360),  new THREE.Vector3(-40, 0, -400),
    ];
    boardCurve = new THREE.CatmullRomCurve3(waypoints);
    const len = (state.hbd || HBD_DEFAULT_CONFIG).length;
    _hbdMax = len - 1;
    const pts = boardCurve.getSpacedPoints(_hbdMax);
    hbdPositions.length = 0;
    pts.forEach(p => hbdPositions.push(p.clone()));
}

function _buildHBDPath() {
    const tubeGeo = new THREE.TubeGeometry(boardCurve, 200, 1.5, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x6366f1, emissive: 0x6366f1, transparent: true, opacity: 0.15, roughness: 0.8,
    });
    const mesh = new THREE.Mesh(tubeGeo, tubeMat);
    mesh.position.y = -0.5;
    boardGrp.add(mesh);
}

// ============================================================
// HUNDRED BLOCK DASH SCENE ENVIRONMENT — a themed world per realm:
// a tinted ground ribbon that follows the path, plus realm-specific
// scenery (forest / volcano / fae glade / void) lining both sides.
// ============================================================

const GROUND_Y = -1.1;

// Per-realm palette (ground, accent, glow) keyed by biome.key
const HBD_REALM_STYLE = {
    woods: { ground: 0x1f5c1f, ground2: 0x14431a, accent: 0x4ade80 },
    ember: { ground: 0x4a160c, ground2: 0x2c0d08, accent: 0xf97316 },
    fae:   { ground: 0x3a1448, ground2: 0x230d30, accent: 0xd946ef },
    void:  { ground: 0x0c0c22, ground2: 0x060614, accent: 0x60a5fa },
};

// Stable pseudo-random from an integer seed (no flicker frame-to-frame).
function _sr(n) { const x = Math.sin(n * 127.1 + 0.7) * 43758.5453; return x - Math.floor(x); }

// Perpendicular (in XZ) to the path at parametric t.
function _pathNormal(t) {
    const tan = boardCurve.getTangent(Math.max(0.001, Math.min(t, 0.999))).setY(0).normalize();
    return new THREE.Vector3(0, 1, 0).cross(tan).normalize();
}

function _buildHBDScene() {
    const cfg     = state.hbd || HBD_DEFAULT_CONFIG;
    const realmGroups = {};   // key → list of block indices
    for (let i = 0; i <= cfg.finish; i++) {
        const key = getBiomeForSpace(i).key;
        (realmGroups[key] ||= []).push(i);
    }

    // 1) Dark base ground under everything (fills gaps beyond the ribbons).
    _buildHBDBase();

    // 2) Per-realm layers: ground ribbon, ambient motes, accent light, landmark.
    Object.entries(realmGroups).forEach(([key, idxs]) => {
        const ext = [idxs[0] - 1, ...idxs, idxs[idxs.length - 1] + 1].filter(i => i >= 0 && i <= cfg.finish);
        _buildHBDRibbon(ext, key);
        _buildRealmParticles(idxs, key);
        _buildRealmAccentLight(idxs, key);
        _buildRealmLandmark(idxs, key);
    });

    // 3) Glowing walking path on top of the ground.
    _buildHBDPath();

    // 4) Scenery lining both sides of every block.
    for (let i = 1; i < cfg.finish; i++) {
        const key = getBiomeForSpace(i).key;
        const t   = i / _hbdMax;
        const nrm = _pathNormal(t);
        const base = getPos(i).clone(); base.y = GROUND_Y;
        // Place decor on each side at a varied distance.
        [-1, 1].forEach(side => {
            if (_sr(i * 2 + (side > 0 ? 1 : 0)) > 0.82) return; // leave some gaps
            const dist = 9 + _sr(i * 7 + side) * 10;
            const pos  = base.clone().addScaledVector(nrm, side * dist);
            const deco = _mkRealmDecor(key, i * 13 + side);
            if (deco) { deco.position.copy(pos); boardGrp.add(deco); }
        });
    }

    // 5) Dense low-cost ground scatter (grass / embers / sparkles) near the path.
    _buildGroundScatter(cfg);

    // 6) The Crown beacon at the finish.
    _buildCrownBeacon(getPos(cfg.finish).clone());
}

// Bounding box (XZ) of the whole path, with padding.
function _hbdBounds(pad = 0) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    hbdPositions.forEach(p => {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
    });
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad,
             cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: (maxX - minX) + pad * 2, h: (maxZ - minZ) + pad * 2 };
}

function _buildHBDBase() {
    const b = _hbdBounds(70);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h),
        new THREE.MeshStandardMaterial({ color: 0x05060f, roughness: 1.0, metalness: 0.0 }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(b.cx, GROUND_Y - 0.9, b.cz);
    plane.receiveShadow = true;
    boardGrp.add(plane);
}

// Soft round sprite texture for particle motes (shared).
let _dotTex = null;
function _dotTexture() {
    if (_dotTex) return _dotTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    _dotTex = new THREE.CanvasTexture(c);
    return _dotTex;
}

// Drifting motes filling a realm's region (pollen / embers / sparks / stars).
function _buildRealmParticles(idxs, key) {
    const st = HBD_REALM_STYLE[key] || HBD_REALM_STYLE.woods;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const c = new THREE.Vector3();
    idxs.forEach(i => { const p = getPos(i); c.add(p);
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z; });
    c.multiplyScalar(1 / idxs.length);
    const N   = Math.min(80, idxs.length * 4);
    const arr = new Float32Array(N * 3);
    const spanX = (maxX - minX) + 30, spanZ = (maxZ - minZ) + 30;
    for (let i = 0; i < N; i++) {
        arr[i * 3]     = (minX - 15 + _sr(i * 1.3 + key.length) * spanX) - c.x;
        arr[i * 3 + 1] = 1.5 + _sr(i * 2.1) * 13;
        arr[i * 3 + 2] = (minZ - 15 + _sr(i * 3.7 + key.length * 2) * spanZ) - c.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const m = new THREE.PointsMaterial({
        color: st.accent, size: key === 'void' ? 1.0 : 0.7, map: _dotTexture(),
        transparent: true, opacity: 0.85, depthWrite: false,
        blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(g, m);
    pts.position.copy(c);
    boardGrp.add(pts);
    floatingIcons.push({ mesh: pts, baseY: c.y, speed: 0.22, phase: _sr(key.length) * 6 });
}

function _buildRealmAccentLight(idxs, key) {
    const st = HBD_REALM_STYLE[key] || HBD_REALM_STYLE.woods;
    const c = new THREE.Vector3();
    idxs.forEach(i => c.add(getPos(i))); c.multiplyScalar(1 / idxs.length);
    const inten = key === 'ember' ? 1.4 : key === 'woods' ? 0.5 : 0.95;
    const light = new THREE.PointLight(st.accent, inten, 90, 2);
    light.position.set(c.x, 11, c.z);
    boardGrp.add(light);
}

// ---- Big realm landmarks ----

function _buildRealmLandmark(idxs, key) {
    const mid = idxs[Math.floor(idxs.length / 2)];
    const nrm = _pathNormal(mid / _hbdMax);
    const side = _sr(mid) > 0.5 ? 1 : -1;
    const pos  = getPos(mid).clone().addScaledVector(nrm, side * 36); pos.y = GROUND_Y;
    let lm = null;
    if (key === 'woods') lm = _lmGiantTree();
    else if (key === 'ember') lm = _lmVolcano();
    else if (key === 'fae') lm = _lmCrystalCluster();
    else if (key === 'void') lm = _lmPlanet();
    if (lm) { lm.position.copy(pos); boardGrp.add(lm); }
}

function _lmGiantTree() {
    const grp = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.7, 11, 8),
        new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.95 }));
    trunk.position.y = 5.5; grp.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f7a2e, roughness: 0.9 });
    [[0, 12, 0, 6], [-3.5, 10.5, 1, 4.5], [3.5, 11, -1, 4.8], [0, 14.5, 0, 4]].forEach(([x, y, z, r]) => {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 9), leafMat);
        s.position.set(x, y, z); s.scale.y = 0.9; grp.add(s);
    });
    return grp;
}

function _lmVolcano() {
    const grp = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(13, 17, 16, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2a1410, roughness: 1.0, side: THREE.DoubleSide,
            emissive: 0xff2200, emissiveIntensity: 0.12 }));
    cone.position.y = 8.5; grp.add(cone);
    // Glowing crater
    const crater = new THREE.Mesh(new THREE.CircleGeometry(4.2, 16),
        new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4400, emissiveIntensity: 1.6 }));
    crater.rotation.x = -Math.PI / 2; crater.position.y = 16.8; grp.add(crater);
    // Lava trickle on a flank
    const lava = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 11, 6),
        new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3300, emissiveIntensity: 1.3 }));
    lava.position.set(5.5, 8, 4); lava.rotation.z = 0.5; lava.rotation.x = 0.2; grp.add(lava);
    // Smoke puff
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(3.5, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0x333333, transparent: true, opacity: 0.35, roughness: 1 }));
    smoke.position.y = 22; grp.add(smoke);
    return grp;
}

function _lmCrystalCluster() {
    const grp = new THREE.Group();
    const cols = [0xd946ef, 0xc084fc, 0xf472b6, 0x8b5cf6];
    for (let i = 0; i < 6; i++) {
        const col = cols[i % cols.length];
        const h = 7 + _sr(i * 4) * 9;
        const cr = new THREE.Mesh(new THREE.ConeGeometry(1.2 + _sr(i) * 0.8, h, 5),
            new THREE.MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 0.7,
                metalness: 0.3, roughness: 0.12, transparent: true, opacity: 0.9 }));
        const a = (i / 6) * Math.PI * 2;
        cr.position.set(Math.cos(a) * (2 + _sr(i + 1) * 3), h * 0.5, Math.sin(a) * (2 + _sr(i + 2) * 3));
        cr.rotation.z = (_sr(i) - 0.5) * 0.5;
        grp.add(cr);
    }
    return grp;
}

function _lmPlanet() {
    const grp = new THREE.Group();
    const planet = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 20),
        new THREE.MeshStandardMaterial({ color: 0x1b2358, emissive: 0x2a3a8a, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.3 }));
    planet.position.y = 19; grp.add(planet);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.7, 10, 40),
        new THREE.MeshStandardMaterial({ color: 0x60a5fa, emissive: 0x3b82f6, emissiveIntensity: 0.8, transparent: true, opacity: 0.8 }));
    ring.rotation.x = Math.PI / 2.4; ring.position.y = 19; grp.add(ring);
    floatingIcons.push({ mesh: planet, baseY: 19, speed: 0.3, phase: 0 });
    return grp;
}

// ---- Dense, cheap ground scatter ----

let _scatterShared = null;
function _scatterRes() {
    if (_scatterShared) return _scatterShared;
    _scatterShared = {
        grass:  new THREE.ConeGeometry(0.14, 0.8, 4),
        pebble: new THREE.DodecahedronGeometry(0.28, 0),
        dot:    new THREE.SphereGeometry(0.22, 6, 5),
        mGrass:   new THREE.MeshStandardMaterial({ color: 0x3a9a3a, roughness: 0.95 }),
        mPebble:  new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 1.0 }),
        mEmber:   new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff3a00, emissiveIntensity: 1.5 }),
        mEmRock:  new THREE.MeshStandardMaterial({ color: 0x281410, roughness: 1.0, emissive: 0xff3300, emissiveIntensity: 0.3 }),
        mSpark:   new THREE.MeshStandardMaterial({ color: 0xf0a0ff, emissive: 0xe060ff, emissiveIntensity: 1.4 }),
        mVoid:    new THREE.MeshStandardMaterial({ color: 0x88c0ff, emissive: 0x4488ff, emissiveIntensity: 1.4 }),
    };
    return _scatterShared;
}

function _buildGroundScatter(cfg) {
    const R = _scatterRes();
    for (let i = 1; i < cfg.finish; i++) {
        const key = getBiomeForSpace(i).key;
        const t   = i / _hbdMax;
        const nrm = _pathNormal(t);
        const tan = boardCurve.getTangent(Math.max(0.001, Math.min(t, 0.999))).setY(0).normalize();
        const base = getPos(i).clone(); base.y = GROUND_Y;
        for (let k = 0; k < 2; k++) {
            if (_sr(i * 31 + k * 7) > 0.62) continue;     // ~40% fill per slot
            const side  = _sr(i * 9 + k) > 0.5 ? 1 : -1;
            const dist  = 4.2 + _sr(i * 11 + k) * 3.2;
            const along = (_sr(i * 13 + k) - 0.5) * 2.4;
            const pos   = base.clone().addScaledVector(nrm, side * dist).addScaledVector(tan, along);
            const prop  = _mkScatterProp(key, i * 17 + k, R);
            if (prop) { prop.position.copy(pos); boardGrp.add(prop); }
        }
    }
}

function _mkScatterProp(key, seed, R) {
    const r = _sr(seed);
    let mesh;
    if (key === 'woods') {
        if (r < 0.7) { mesh = new THREE.Mesh(R.grass, R.mGrass); mesh.position.y = 0.4; mesh.scale.y = 0.8 + _sr(seed) * 0.8; }
        else         { mesh = new THREE.Mesh(R.pebble, R.mPebble); mesh.position.y = 0.2; }
    } else if (key === 'ember') {
        if (r < 0.5) { mesh = new THREE.Mesh(R.dot, R.mEmber); mesh.position.y = 0.25; }
        else         { mesh = new THREE.Mesh(R.pebble, R.mEmRock); mesh.position.y = 0.2; }
    } else if (key === 'fae') {
        mesh = new THREE.Mesh(R.dot, R.mSpark); mesh.position.y = 0.3 + _sr(seed) * 1.2;
    } else { // void
        mesh = new THREE.Mesh(R.dot, R.mVoid); mesh.position.y = 0.3 + _sr(seed) * 1.5;
    }
    mesh.rotation.set(_sr(seed) * 3, _sr(seed + 1) * 3, _sr(seed + 2) * 3);
    return mesh;
}

// Build a flat tinted ground strip following the given block indices.
function _buildHBDRibbon(indices, key) {
    const st = HBD_REALM_STYLE[key] || HBD_REALM_STYLE.woods;
    const HALF = 26;
    const verts = [], idx = [];
    indices.forEach((blockI, k) => {
        const t = blockI / _hbdMax;
        const p = getPos(blockI).clone();
        const n = _pathNormal(t);
        const L = p.clone().addScaledVector(n,  HALF);
        const R = p.clone().addScaledVector(n, -HALF);
        verts.push(L.x, GROUND_Y, L.z, R.x, GROUND_Y, R.z);
        if (k > 0) {
            const a = (k - 1) * 2, b = a + 1, c = a + 2, d = a + 3;
            idx.push(a, b, c, b, d, c);
        }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: st.ground, roughness: 0.95, metalness: 0.0,
        emissive: st.ground2, emissiveIntensity: 0.25, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    boardGrp.add(mesh);
}

// Dispatch to a realm-specific decor maker. Returns a Group (or null).
function _mkRealmDecor(key, seed) {
    switch (key) {
        case 'woods': return _mkWoodsDecor(seed);
        case 'ember': return _mkEmberDecor(seed);
        case 'fae':   return _mkFaeDecor(seed);
        case 'void':  return _mkVoidDecor(seed);
        default:      return _mkWoodsDecor(seed);
    }
}

function _mkPineTree(seed) {
    const grp = new THREE.Group();
    const h = 2.4 + _sr(seed) * 1.8;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, h * 0.5, 6),
        new THREE.MeshStandardMaterial({ color: 0x5a3318, roughness: 0.95 }));
    trunk.position.y = h * 0.25; trunk.castShadow = true; grp.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x1f7a2e, roughness: 0.9 });
    for (let c = 0; c < 3; c++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4 - c * 0.35, 1.5, 7), leafMat);
        cone.position.y = h * 0.5 + c * 0.9; cone.castShadow = true; grp.add(cone);
    }
    return grp;
}

function _mkWoodsDecor(seed) {
    const r = _sr(seed);
    if (r < 0.6) return _mkPineTree(seed);
    if (r < 0.85) {
        // bush cluster
        const grp = new THREE.Group();
        const m = new THREE.MeshStandardMaterial({ color: 0x2f8a35, roughness: 0.95 });
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.6 + _sr(seed + i) * 0.4, 7, 6), m);
            b.position.set((_sr(seed + i) - 0.5) * 1.2, 0.5, (_sr(seed - i) - 0.5) * 1.2);
            b.castShadow = true; grp.add(b);
        }
        return grp;
    }
    // mossy rock
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 + _sr(seed) * 0.6, 0),
        new THREE.MeshStandardMaterial({ color: 0x556b4a, roughness: 1.0 }));
    rock.position.y = 0.5; rock.rotation.set(_sr(seed), _sr(seed + 1), _sr(seed + 2)); rock.castShadow = true;
    const g = new THREE.Group(); g.add(rock); return g;
}

function _mkEmberDecor(seed) {
    const r = _sr(seed);
    const grp = new THREE.Group();
    if (r < 0.4) {
        // lava pool — glowing flat disc on the ground
        const pool = new THREE.Mesh(new THREE.CircleGeometry(1.4 + _sr(seed) * 1.2, 14),
            new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 1.4, roughness: 0.5 }));
        pool.rotation.x = -Math.PI / 2; pool.position.y = 0.06; grp.add(pool);
        return grp;
    }
    if (r < 0.75) {
        // charred volcanic rock with glowing cracks
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + _sr(seed) * 0.7, 0),
            new THREE.MeshStandardMaterial({ color: 0x241010, roughness: 1.0, emissive: 0xff3300, emissiveIntensity: 0.25 }));
        rock.position.y = 0.6; rock.rotation.set(_sr(seed), _sr(seed + 1), _sr(seed + 2)); rock.castShadow = true; grp.add(rock);
        return grp;
    }
    // dead/charred tree
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 2.6 + _sr(seed) * 1.2, 5),
        new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1.0 }));
    trunk.position.y = 1.4; trunk.castShadow = true; grp.add(trunk);
    for (let i = 0; i < 2; i++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.1, 4),
            new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 1.0 }));
        br.position.set(0, 2.0 + i * 0.5, 0); br.rotation.z = (i ? 1 : -1) * 0.9; grp.add(br);
    }
    return grp;
}

function _mkFaeDecor(seed) {
    const r = _sr(seed);
    const grp = new THREE.Group();
    const glow = [0xd946ef, 0xc084fc, 0xf472b6, 0x8b5cf6][Math.floor(_sr(seed + 5) * 4)];
    if (r < 0.5) {
        // glowing mushroom
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.0 + _sr(seed), 6),
            new THREE.MeshStandardMaterial({ color: 0xe8d8f0, roughness: 0.7 }));
        stem.position.y = 0.6; stem.castShadow = true; grp.add(stem);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.6 + _sr(seed) * 0.3, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.9, roughness: 0.5 }));
        cap.position.y = 1.1 + _sr(seed); grp.add(cap);
        return grp;
    }
    // crystal spire
    const h = 1.8 + _sr(seed) * 2.0;
    const crystal = new THREE.Mesh(new THREE.ConeGeometry(0.5, h, 5),
        new THREE.MeshPhysicalMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.7, metalness: 0.3, roughness: 0.15, transparent: true, opacity: 0.9 }));
    crystal.position.y = h * 0.5; crystal.rotation.y = _sr(seed) * 3; crystal.castShadow = true; grp.add(crystal);
    return grp;
}

function _mkVoidDecor(seed) {
    const grp = new THREE.Group();
    const r = _sr(seed);
    const glow = [0x60a5fa, 0x3b82f6, 0xa855f7, 0x22d3ee][Math.floor(_sr(seed + 3) * 4)];
    if (r < 0.55) {
        // floating shard that slowly bobs
        const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.6 + _sr(seed) * 0.8, 0),
            new THREE.MeshPhysicalMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.92 }));
        const baseY = 1.5 + _sr(seed) * 2.5;
        shard.position.y = baseY; shard.castShadow = true; grp.add(shard);
        floatingIcons.push({ mesh: shard, baseY, speed: 0.5 + _sr(seed), phase: _sr(seed) * 6 });
        return grp;
    }
    // dark spire tipped with light
    const h = 2.2 + _sr(seed) * 2.0;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, h, 5),
        new THREE.MeshStandardMaterial({ color: 0x10122e, roughness: 0.6, metalness: 0.4 }));
    spire.position.y = h * 0.5; spire.castShadow = true; grp.add(spire);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 1.4 }));
    tip.position.y = h; grp.add(tip);
    return grp;
}

function _buildCrownBeacon(pos) {
    const grp = new THREE.Group();
    grp.position.set(pos.x, 0, pos.z);
    // Light pillar
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 24, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true, opacity: 0.16, side: THREE.DoubleSide }));
    pillar.position.y = 11; grp.add(pillar);
    // Floating gold ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.18, 10, 28),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.2 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 3.0;
    grp.add(ring);
    floatingIcons.push({ mesh: ring, baseY: 3.0, speed: 0.7, phase: 0 });
    boardGrp.add(grp);
}

// ---- Scene init ----

export function init(container) {
    container.innerHTML = '';
    const isHBD = state.selectedMap === 'hundred_block_dash';

    if (isHBD) {
        buildHBDPositions();
        boardCurve = boardCurve; // already set
    } else {
        buildNodePositions();
    }
    _measureBoardExtent();
    resetCameraSmoothing();
    // A new match builds a new scene, so anything cached against the old one has
    // to go — the saucer's `parent` would still point at the discarded scene and
    // it would never be re-added.
    _swapUfo = null;

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(isHBD ? 0x0f380f : 0xa8d4f0, isHBD ? 0.005 : 0.003);

    const W = Math.max(window.innerWidth  || 300, 300);
    const H = Math.max(window.innerHeight || 500, 500);
    camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
    camera.position.set(0, isHBD ? 30 : 50, isHBD ? 40 : 60);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    // 3-light rig
    // City ambient was 1.2 — so high that every surface came back the same flat
    // value and the four districts differed only in the colour of the sky. The
    // per-district light rigs (_buildDistrictLights) supply the local colour;
    // the global fill only has to keep shadows from going black.
    scene.add(new THREE.AmbientLight(isHBD ? 0x9977bb : 0xdfe6f0, isHBD ? 0.52 : 0.75));
    const sun = new THREE.DirectionalLight(isHBD ? 0xfff4d0 : 0xfff8e8, isHBD ? 1.05 : 1.55);
    sun.position.set(isHBD ? 20 : 60, 60, isHBD ? 30 : -30); sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = isHBD ? -30 : -100;
    sun.shadow.camera.right = sun.shadow.camera.top = isHBD ? 30 : 100;
    sun.shadow.mapSize.width = sun.shadow.mapSize.height = 2048;
    scene.add(sun);
    const rimLight = new THREE.DirectionalLight(isHBD ? 0x4466ee : 0x88bbff, isHBD ? 0.36 : 0.5);
    rimLight.position.set(-25, 15, -35);
    scene.add(rimLight);

    boardGrp = new THREE.Group();
    diceGrp  = new THREE.Group();
    scene.add(boardGrp, diceGrp);

    if (!isHBD) {
        buildCamCurve();
        _buildPathTubes();
        _buildCityScene();
    }

    Physics.init();
    drawTiles();
    // HBD scenery is built after drawTiles() because drawTiles() resets the
    // floatingIcons list — building afterwards keeps the bobbing void shards
    // and the Crown beacon ring animating.
    if (isHBD) _buildHBDScene();
    buildPlayerMeshes();

    clock = new THREE.Clock();
    startLoop();
}

// ---- Path tube rendering ----

const _pathTubes = [];

function _buildPathTubes() {
    _pathTubes.forEach(m => boardGrp.remove(m));
    _pathTubes.length = 0;

    // One tube per graph edge, colored by district
    const edges = [
        // Ring road segments
        { nodes: ['bp_a','r1','r2','r3','r4','r5','bp_b'],            district: 'ring' },
        { nodes: ['bp_b','r6','r7','r8','r9','r10','bp_c'],           district: 'ring' },
        { nodes: ['bp_c','r11','r12','r13','r14','r15','bp_d'],       district: 'ring' },
        { nodes: ['bp_d','r16','r17','r18','r19','r20','bp_a'],       district: 'ring' },
        // Districts
        { nodes: ['bp_a','fin_0','fin_1','fin_2','fin_3','fin_4','fin_5','fin_6','fin_7','fin_8','fin_9','bp_b'],        district: 'fin'  },
        { nodes: ['bp_b','ba_0','ba_1','ba_2','ba_3','ba_4','ba_5','ba_6','ba_7','ba_8','ba_9','ba_10','ba_11','bp_c'], district: 'ba'   },
        { nodes: ['bp_c','shop_0','shop_1','shop_2','shop_3','shop_4','shop_5','shop_6','shop_7','shop_8','shop_9','bp_d'], district: 'shop' },
        { nodes: ['bp_d','ind_0','ind_1','ind_2','ind_3','ind_4','ind_5','ind_6','ind_7','bp_a'],                       district: 'ind'  },
    ];

    edges.forEach(({ nodes, district }) => {
        const pts = nodes.map(id => getPos(id).clone().setY(-0.3));
        const curve = new THREE.CatmullRomCurve3(pts);
        const tint  = DISTRICT_BIOMES[district].pathTint;
        const geo   = new THREE.TubeGeometry(curve, pts.length * 3, 1.2, 6, false);
        const mat   = new THREE.MeshStandardMaterial({
            color: tint, emissive: tint, transparent: true, opacity: 0.14, roughness: 0.9,
        });
        const mesh  = new THREE.Mesh(geo, mat);
        boardGrp.add(mesh);
        _pathTubes.push(mesh);
    });

    // Junction sphere markers
    ['bp_a','bp_b','bp_c','bp_d'].forEach(id => {
        const pos = getPos(id);
        const mat = new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.5, metalness: 0.9 });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 12), mat);
        mesh.position.copy(pos);
        mesh.position.y = 0.5;
        boardGrp.add(mesh);
        floatingIcons.push({ mesh, baseY: 0.5, speed: 0.8, phase: Math.random() * Math.PI * 2 });
    });
}

// ---- Tile texture ----

function _drawRichTile(tcx, colorHex, borderHex, icon, label) {
    const W = 256, H = 256;
    const r = (colorHex >> 16) & 0xff, g = (colorHex >> 8) & 0xff, b = colorHex & 0xff;
    const lr = Math.min(255, r + 48), lg = Math.min(255, g + 48), lb = Math.min(255, b + 48);
    // Radial gradient: lighter center fading to base color
    const grad = tcx.createRadialGradient(W * 0.5, H * 0.38, 0, W * 0.5, H * 0.5, W * 0.78);
    grad.addColorStop(0, `rgb(${lr},${lg},${lb})`);
    grad.addColorStop(1, `#${colorHex.toString(16).padStart(6, '0')}`);
    tcx.fillStyle = grad; tcx.fillRect(0, 0, W, H);
    // Vignette at corners
    const vig = tcx.createRadialGradient(W/2, H/2, W * 0.28, W/2, H/2, W * 0.84);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    tcx.fillStyle = vig; tcx.fillRect(0, 0, W, H);
    // Top specular highlight
    const topG = tcx.createLinearGradient(0, 0, 0, 58);
    topG.addColorStop(0, 'rgba(255,255,255,0.14)'); topG.addColorStop(1, 'rgba(255,255,255,0)');
    tcx.fillStyle = topG; tcx.fillRect(0, 0, W, 58);
    // Outer border
    tcx.strokeStyle = '#' + borderHex.toString(16).padStart(6, '0');
    tcx.lineWidth = 11; tcx.strokeRect(6, 6, 244, 244);
    // Inner white highlight border
    tcx.strokeStyle = 'rgba(255,255,255,0.22)'; tcx.lineWidth = 2; tcx.strokeRect(14, 14, 228, 228);
    // Icon with drop shadow
    tcx.save();
    tcx.textAlign = 'center'; tcx.textBaseline = 'middle';
    tcx.shadowColor = 'rgba(0,0,0,0.88)'; tcx.shadowBlur = 18; tcx.shadowOffsetY = 5; tcx.shadowOffsetX = 2;
    tcx.font = '90px serif'; tcx.fillText(icon, W / 2, 95);
    tcx.restore();
    // Label with drop shadow
    tcx.save();
    tcx.textAlign = 'center'; tcx.textBaseline = 'middle';
    tcx.fillStyle = '#fff';
    tcx.shadowColor = 'rgba(0,0,0,0.95)'; tcx.shadowBlur = 10; tcx.shadowOffsetY = 3;
    tcx.font = 'bold 27px "Bebas Neue",sans-serif';
    const words = label.split(' ');
    if (words.length > 1) { tcx.fillText(words[0], W/2, 168); tcx.fillText(words.slice(1).join(' '), W/2, 200); }
    else tcx.fillText(label, W / 2, 186);
    tcx.restore();
}

function _getCachedTileTexture(spc, bInfo, overrideLabel, b) {
    const label = overrideLabel || spc.n;
    const key   = `rich2_${spc.e}_${bInfo.floorEdge}_${spc.ic}_${label}_${b?.owner ?? ''}`;
    if (textureCache[key]) return textureCache[key];
    const tcx = document.createElement('canvas').getContext('2d');
    tcx.canvas.width = tcx.canvas.height = 256;
    _drawRichTile(tcx, spc.e, bInfo.floorEdge, spc.ic, label);
    const tex = new THREE.CanvasTexture(tcx.canvas);
    textureCache[key] = tex;
    return tex;
}

// ---- Draw tiles ----

export function drawTiles() {
    _clearTileObjects();

    if (Array.isArray(state.board)) {
        // ---- HBD: integer-indexed array ----
        const _gatePos = (state.hbd || HBD_DEFAULT_CONFIG).gatePos;
        state.board.forEach((b, i) => {
            const isGate = (i === _gatePos);
            const spc    = SPACE_META[b.type] || SPACE_META.coin;
            const bInfo  = getBiomeForSpace(i);
            const label  = b.type === 'player_trap' ? 'TOLL' : (isGate && state.gateOpen ? 'OPEN' : null);
            const key    = `rich2_hbd_${spc.e}_${bInfo.floorEdge}_${spc.ic}_${label}_${b.owner ?? ''}`;
            if (!textureCache[key]) {
                const tcx = document.createElement('canvas').getContext('2d');
                tcx.canvas.width = tcx.canvas.height = 256;
                _drawRichTile(tcx, spc.e, bInfo.floorEdge, spc.ic, label || spc.n);
                textureCache[key] = new THREE.CanvasTexture(tcx.canvas);
            }
            let emColor = isGate ? (state.gateOpen ? 0x22c55e : 0xb45309) : spc.e;
            if (b.type === 'player_trap') emColor = state.players[b.owner]?.color ?? 0xf97316;
            const baseMat  = new THREE.MeshPhysicalMaterial({ map: textureCache[key], roughness: 0.22, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.2, emissive: emColor, emissiveIntensity: 0.55 });
            const baseMesh = new THREE.Mesh(_hexGeo, baseMat);
            baseMesh.receiveShadow = true; baseMesh.castShadow = true;
            const pos = getPos(i).clone();
            baseMesh.position.copy(pos);
            if (i < _hbdMax) baseMesh.lookAt(getPos(i + 1).clone().setY(0));
            baseMesh.userData = { idx: i };
            tileMeshes.push(baseMesh);
            boardGrp.add(baseMesh);
            if (isGate) _buildHBDGateMesh(i, pos);
            else if (b.type === 'shop') _buildHBDShopMesh(i, pos);
            else if (spc.geo && GEOS[spc.geo]) _buildFloatingIcon(pos, spc, b);
        });
        return;
    }

    // ---- City Circuit: string-keyed object ----
    Object.entries(state.board).forEach(([nodeId, b]) => {
        if (JUNCTION_IDS.has(nodeId)) return;
        const graphNode = CITY_GRAPH[nodeId];
        const isGate    = b.type === 'gate';
        const spc       = SPACE_META[b.type] || SPACE_META.coin;
        const bInfo     = DISTRICT_BIOMES[graphNode?.district || 'ring'];
        const label     = b.type === 'player_trap' ? 'TOLL' : (isGate && state.gateOpen ? 'OPEN' : null);
        const tex       = _getCachedTileTexture(spc, bInfo, label, b);

        let emColor = spc.e;
        if (isGate) emColor = state.gateOpen ? 0x22c55e : 0xb45309;
        if (b.type === 'player_trap') emColor = state.players[b.owner]?.color ?? 0xf97316;
        if (b.type === 'hq') emColor = 0xa37810;

        const baseMat  = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.22, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.2, emissive: emColor, emissiveIntensity: 0.55 });
        const baseMesh = new THREE.Mesh(_hexGeo, baseMat);
        baseMesh.receiveShadow = true; baseMesh.castShadow = true;
        const pos = getPos(nodeId);
        baseMesh.position.copy(pos);
        // Orient tile to face next node
        const nextId = CITY_GRAPH[nodeId]?.next?.[0];
        if (nextId) {
            const nextPos = getPos(nextId);
            if (!JUNCTION_IDS.has(nextId)) baseMesh.lookAt(nextPos.clone().setY(0));
            else {
                const nn = CITY_GRAPH[nextId]?.next?.[0];
                if (nn) baseMesh.lookAt(getPos(nn).clone().setY(0));
            }
        }
        baseMesh.userData = { nodeId };
        tileMeshes.push(baseMesh);
        boardGrp.add(baseMesh);

        if (isGate) _buildGateMesh(nodeId, pos);
        else if (b.type === 'shop') _buildShopMesh(nodeId, pos, graphNode?.district);
        else if (b.type === 'hq') _buildHQMesh(nodeId, pos, graphNode?.district);
        else if (spc.geo && GEOS[spc.geo]) _buildFloatingIcon(pos, spc, b);
    });
}

export function updateSingleTile() { drawTiles(); }
export function getTileMeshes()    { return tileMeshes; }

// ---- HBD-specific tile decorations ----

function _buildHBDGateMesh(idx, pos) {
    const gateOpen  = state.gateOpen;
    const gateColor = gateOpen ? 0x4ade80 : 0xfbbf24;
    const gateEmit  = gateOpen ? 0x22c55e : 0xb45309;
    const gateMat   = new THREE.MeshPhysicalMaterial({ color: gateColor, emissive: gateEmit, emissiveIntensity: 1.2, metalness: 0.95, roughness: 0.05 });
    const gateGrp   = new THREE.Group();
    gateGrp.position.copy(pos);
    const t = Math.max(0.001, Math.min(idx / _hbdMax, 0.999));
    const tangent = boardCurve.getTangent(t).normalize();
    gateGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    const pillarGeo = new THREE.BoxGeometry(0.55, 7, 0.55);
    [-2.2, 2.2].forEach(x => {
        const p = new THREE.Mesh(pillarGeo, gateMat); p.position.set(x, 3.5, 0); p.castShadow = true; gateGrp.add(p);
    });
    const cross = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.6, 0.55), gateMat); cross.position.set(0, 7.2, 0); cross.castShadow = true; gateGrp.add(cross);
    const barMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0x86efac : 0xfcd34d, emissive: gateEmit, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.15, transparent: gateOpen, opacity: gateOpen ? 0.35 : 1.0 });
    const barGeo = new THREE.BoxGeometry(0.22, 4.2, 0.22);
    for (let b = -2; b <= 2; b++) { const bar = new THREE.Mesh(barGeo, barMat); bar.position.set(b * 0.88, 3.1, 0); gateGrp.add(bar); }
    const gemMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0xffffff : 0xfef08a, emissive: gateOpen ? 0x4ade80 : 0xfbbf24, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 });
    [-2.2, 2.2].forEach(x => {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), gemMat);
        gem.position.set(x, 7.6, 0);
        gateGrp.add(gem);
        _pushTileIcon({ mesh: gem, baseY: 7.6, speed: 1.1, phase: x > 0 ? Math.PI : 0, group: gateGrp });
    });
    boardGrp.add(gateGrp); tileMeshes.push(gateGrp);
}

function _buildHBDShopMesh(idx, pos) {
    const shopGrp = new THREE.Group();
    const t = Math.max(0.001, Math.min(idx / _hbdMax, 0.999));
    const tangent = boardCurve.getTangent(t).normalize();
    const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    shopGrp.position.copy(pos).addScaledVector(right, 3.2); shopGrp.position.y = 0;
    shopGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    const counterMat = new THREE.MeshPhysicalMaterial({ color: 0x78350f, emissive: 0x3b1a06, emissiveIntensity: 0.3, roughness: 0.7 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.2, 1.5), counterMat); counter.position.set(0, 0.6, 0); counter.castShadow = true; shopGrp.add(counter);
    const awningMat = new THREE.MeshPhysicalMaterial({ color: 0xa855f7, emissive: 0x7c3aed, emissiveIntensity: 0.6 });
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.2, 2), awningMat); awning.position.set(0, 2.2, 0); shopGrp.add(awning);
    const signMat = new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.5 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 0.1), signMat); sign.position.set(0, 2.8, -0.9); shopGrp.add(sign);
    shopGrp.userData = { idx, type: '_shop' };
    boardGrp.add(shopGrp); tileMeshes.push(shopGrp);
}

function _buildGateMesh(nodeId, pos) {
    const gateOpen = state.gateOpen;
    const gateColor = gateOpen ? 0x4ade80 : 0xfbbf24;
    const gateEmit  = gateOpen ? 0x22c55e : 0xb45309;
    const gateMat   = new THREE.MeshPhysicalMaterial({ color: gateColor, emissive: gateEmit, emissiveIntensity: 1.2, metalness: 0.95, roughness: 0.05 });
    const gateGrp   = new THREE.Group();
    gateGrp.position.copy(pos);

    const nextId  = CITY_GRAPH[nodeId]?.next?.[0];
    const nextPos = nextId ? getPos(nextId) : pos.clone().add(new THREE.Vector3(1, 0, 0));
    const tangent = new THREE.Vector3().subVectors(nextPos, pos).normalize();
    gateGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const pillarGeo = new THREE.BoxGeometry(0.55, 7, 0.55);
    [-2.2, 2.2].forEach(x => {
        const p = new THREE.Mesh(pillarGeo, gateMat); p.position.set(x, 3.5, 0); p.castShadow = true; gateGrp.add(p);
    });
    const cross = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.6, 0.55), gateMat); cross.position.set(0, 7.2, 0); cross.castShadow = true; gateGrp.add(cross);
    const arch  = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.28, 8, 20, Math.PI), gateMat); arch.position.set(0, 7.2, 0); arch.rotation.z = Math.PI; arch.castShadow = true; gateGrp.add(arch);

    const barMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0x86efac : 0xfcd34d, emissive: gateEmit, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.15, transparent: gateOpen, opacity: gateOpen ? 0.35 : 1.0 });
    const barGeo = new THREE.BoxGeometry(0.22, 4.2, 0.22);
    for (let b = -2; b <= 2; b++) { const bar = new THREE.Mesh(barGeo, barMat); bar.position.set(b * 0.88, 3.1, 0); gateGrp.add(bar); }

    const gemMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0xffffff : 0xfef08a, emissive: gateOpen ? 0x4ade80 : 0xfbbf24, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 });
    [-2.2, 2.2].forEach(x => {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), gemMat);
        gem.position.set(x, 7.6, 0);
        gateGrp.add(gem);
        _pushTileIcon({ mesh: gem, baseY: 7.6, speed: 1.1, phase: x > 0 ? Math.PI : 0, group: gateGrp });
    });
    gateGrp.userData = { nodeId, type: '_gate' };
    boardGrp.add(gateGrp); tileMeshes.push(gateGrp);
}

function _buildShopMesh(nodeId, pos, district) {
    const shopGrp = new THREE.Group();
    const nextId  = CITY_GRAPH[nodeId]?.next?.[0];
    const nextPos = nextId ? getPos(nextId) : pos.clone().add(new THREE.Vector3(1, 0, 0));
    const tangent = new THREE.Vector3().subVectors(nextPos, pos).normalize();
    const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    shopGrp.position.copy(pos).addScaledVector(right, 3.2); shopGrp.position.y = 0;
    shopGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const colors = { fin: 0x3b82f6, ba: 0xef4444, shop: 0xec4899, ind: 0xeab308, ring: 0xa855f7 };
    const awningColor = colors[district] || 0xa855f7;

    const counterMat = new THREE.MeshPhysicalMaterial({ color: 0x78350f, emissive: 0x3b1a06, emissiveIntensity: 0.3, roughness: 0.7 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 1.4), counterMat); counter.position.set(0, 1.5, 0); counter.castShadow = true; shopGrp.add(counter);
    const legGeo  = new THREE.BoxGeometry(0.18, 1.5, 0.18);
    [[-1.3, 0.75, -0.55],[1.3, 0.75, -0.55],[-1.3, 0.75, 0.55],[1.3, 0.75, 0.55]].forEach(([x,y,z]) => {
        const leg = new THREE.Mesh(legGeo, counterMat); leg.position.set(x,y,z); shopGrp.add(leg);
    });
    const awningMat = new THREE.MeshPhysicalMaterial({ color: awningColor, emissive: awningColor, emissiveIntensity: 0.4, roughness: 0.6 });
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.8), awningMat); awning.position.set(0, 2.55, -0.2); awning.rotation.x = -0.18; shopGrp.add(awning);
    const signMat = new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.8, metalness: 0.9, roughness: 0.05 });
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12), signMat); sign.position.set(0, 3.6, 0); sign.rotation.x = Math.PI / 2; shopGrp.add(sign);
    _pushTileIcon({ mesh: sign, baseY: 3.6, speed: 1.6, phase: Math.random() * Math.PI * 2, group: shopGrp });
    shopGrp.userData = { nodeId, type: '_shop' };
    boardGrp.add(shopGrp); tileMeshes.push(shopGrp);
}

function _buildHQMesh(nodeId, pos, district) {
    const hqGrp = new THREE.Group();
    hqGrp.position.copy(pos); hqGrp.position.y = 0;
    const colors = { fin: 0x3b82f6, ba: 0xef4444, shop: 0xec4899, ind: 0xeab308 };
    const col    = colors[district] || 0xfbbf24;
    const mat    = new THREE.MeshPhysicalMaterial({ color: col, emissive: col, emissiveIntensity: 1.0, metalness: 0.8, roughness: 0.1 });
    // Crown pillars
    [[-1.5,0,0],[1.5,0,0],[0,0,-1.5],[0,0,1.5]].forEach(([x,,z]) => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 4, 8), mat); p.position.set(x, 2, z); hqGrp.add(p);
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI*2, 0, Math.PI/2), mat); dome.position.set(0, 4, 0); hqGrp.add(dome);
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 3.0 }));
    star.position.set(0, 5.8, 0);
    hqGrp.add(star);
    _pushTileIcon({ mesh: star, baseY: 5.8, speed: 1.2, phase: Math.random() * Math.PI * 2, group: hqGrp });
    hqGrp.userData = { nodeId, type: '_hq' };
    boardGrp.add(hqGrp); tileMeshes.push(hqGrp);
}

function _buildFloatingIcon(pos, spc, b) {
    let iconCol = 0xffffff;
    if (b.type === 'player_trap') iconCol = state.players[b.owner]?.color ?? 0xffffff;
    const iconMat  = new THREE.MeshPhysicalMaterial({ color: iconCol, emissive: spc.c, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.2 });
    const iconMesh = new THREE.Mesh(GEOS[spc.geo], iconMat);
    iconMesh.position.copy(pos); iconMesh.position.y += 2.0;
    iconMesh.castShadow = true;
    boardGrp.add(iconMesh);
    _pushTileIcon({ mesh: iconMesh, baseY: 2.0, speed: 1.4 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 });
}

// ---- Character meshes ----
//
// These are the only things on screen a player looks at for a whole match, and
// they were nine primitives with two black dots on the front: a squashed sphere,
// a cylinder-plus-sphere, a plain cube. Every one of them also carried a white
// 0.1×0.1×0.6 box floating at ankle height as a "which way am I facing" marker,
// which read as a rendering fault rather than as part of the character.
//
// The rebuild keeps the silhouettes recognisable — the slime is still a blob,
// Boxy is still a cube — and puts a real toy figure inside each one:
//
//   · a shared BODY KIT, so the nine read as one cast rather than nine sketches
//   · rounded geometry instead of hard primitives (see _roundedBox)
//   · clearcoat physical material, for moulded vinyl instead of matte clay
//   · eyes with a white, a pupil and a catchlight — the single biggest change,
//     because two flat black spheres cannot look at anything
//   · a contact shadow under every figure, which is what stops them reading as
//     hovering above the tile
//   · the facing cue built INTO the character (a nose, a brim, a visor, a tie)
//     instead of bolted on as a white plank
//
// Budget: a character is 12–22 small meshes. Seven exist at once in the worst
// case (2 players + 4 attached buddies + 1 board buddy), which is well inside
// what the board already draws for tiles.

// Cheap darker/lighter relatives of the player colour, so every figure gets
// shading that belongs to it rather than a shared grey.
function _tint(hex, f) {
    const c = new THREE.Color(hex);
    if (f < 1) c.multiplyScalar(f);
    else c.lerp(new THREE.Color(0xffffff), Math.min(1, (f - 1) / 1.2));
    return c.getHex();
}

// A box whose corners are actually round. three r128 has no RoundedBoxGeometry,
// so this spherifies the shell of a segmented box: every vertex is pushed out to
// radius r from its clamped position on the inner box. Hard edges are what made
// Boxy and the Bodyguard look unfinished next to everything else on the board.
function _roundedBox(w, h, d, r, seg = 4) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = g.attributes.position;
    const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
    const v = new THREE.Vector3(), c = new THREE.Vector3(), o = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        c.set(Math.max(-ix, Math.min(ix, v.x)),
              Math.max(-iy, Math.min(iy, v.y)),
              Math.max(-iz, Math.min(iz, v.z)));
        o.copy(v).sub(c);
        if (o.lengthSq() > 1e-9) { o.setLength(r); v.copy(c).add(o); pos.setXYZ(i, v.x, v.y, v.z); }
    }
    g.computeVertexNormals();
    return g;
}

// Eyes that can look at something: a white, a pupil set forward inside it, and
// a small offset catchlight. Returned as a group so a character can tilt them.
function _eyeball(x, y, z, r, look = 0) {
    const g = new THREE.Group();
    const white = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 14),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }));
    g.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(r * 0.56, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x0d1117, roughness: 0.15 }));
    pupil.position.set(look * r * 0.34, 0, r * 0.62);
    g.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(look * r * 0.34 + r * 0.22, r * 0.26, r * 0.86);
    g.add(glint);
    g.position.set(x, y, z);
    return g;
}

export function createCharacterMesh(type, colorCode) {
    const group = new THREE.Group();

    // Moulded-vinyl body. Clearcoat is what separates a toy figure from a lump
    // of clay under the board's single key light.
    const mat = new THREE.MeshPhysicalMaterial({
        color: colorCode, roughness: 0.34, metalness: 0.02,
        clearcoat: 0.7, clearcoatRoughness: 0.3,
    });
    const shade = new THREE.MeshPhysicalMaterial({
        color: _tint(colorCode, 0.62), roughness: 0.45, metalness: 0.02, clearcoat: 0.4,
    });
    const pale = new THREE.MeshStandardMaterial({ color: _tint(colorCode, 1.7), roughness: 0.4 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2130, roughness: 0.45, metalness: 0.15 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f7fb, roughness: 0.4 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 0.45, metalness: 0.5, roughness: 0.3 });

    const add = (geo, m, x, y, z, rx, ry, rz) => {
        const msh = new THREE.Mesh(geo, m);
        msh.position.set(x || 0, y || 0, z || 0);
        if (rx || ry || rz) msh.rotation.set(rx || 0, ry || 0, rz || 0);
        group.add(msh);
        return msh;
    };
    const eyes = (y, z, r, spread) => {
        group.add(_eyeball(spread, y, z, r, -1));
        group.add(_eyeball(-spread, y, z, r, 1));
    };
    // A small dark mouth line reads as a face far more cheaply than geometry.
    const smile = (y, z, w) => {
        const m = add(new THREE.TorusGeometry(w, w * 0.16, 6, 12, Math.PI), dark, 0, y, z, 0, 0, Math.PI);
        return m;
    };

    if (type === 'slime') {
        // A droplet, not a squashed ball: wide wobbly base, tapered peak.
        const body = add(new THREE.SphereGeometry(0.72, 22, 18), mat, 0, 0.66);
        body.scale.set(1.06, 0.9, 1.0);
        add(new THREE.ConeGeometry(0.3, 0.55, 16), mat, 0, 1.38);
        add(new THREE.SphereGeometry(0.12, 10, 10), mat, 0, 1.68);
        // Lighter belly so the front face is not one flat colour.
        const belly = add(new THREE.SphereGeometry(0.55, 18, 14), pale, 0, 0.52, 0.3);
        belly.scale.set(0.92, 0.72, 0.5);
        eyes(0.84, 0.6, 0.15, 0.26);
        smile(0.56, 0.66, 0.15);
    } else if (type === 'ghost') {
        // A lathe profile in three explicit parts: scalloped hem, straight
        // sheet, round dome. Two earlier attempts drove the radius from a single
        // curve in `t` while y stayed linear, which cannot produce a circle —
        // both came out as a tent. The dome is now swept in its own angle, so it
        // is an actual quarter-circle of radius R sitting on the shoulder.
        const R = 0.62, HEM = 0.14, SHOULDER = 0.98;
        const pts = [];
        for (let i = 0; i <= 5; i++) {           // hem: waves along the bottom
            const t = i / 5;
            pts.push(new THREE.Vector2(R + Math.sin(t * Math.PI * 2.4) * 0.08, t * HEM));
        }
        for (let i = 1; i <= 3; i++) {           // sheet: straight sides
            pts.push(new THREE.Vector2(R, HEM + (SHOULDER - HEM) * (i / 3)));
        }
        for (let i = 1; i <= 10; i++) {          // dome: a real quarter-circle
            const a = (i / 10) * (Math.PI / 2);
            pts.push(new THREE.Vector2(Math.max(0.02, R * Math.cos(a)), SHOULDER + R * Math.sin(a)));
        }
        const sheet = new THREE.MeshPhysicalMaterial({
            color: colorCode, roughness: 0.28, metalness: 0, clearcoat: 0.55,
            transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        });
        add(new THREE.LatheGeometry(pts, 26), sheet, 0, 0.03);
        // Nub arms out to the sides of the SHEET, not the dome.
        [-1, 1].forEach(s => {
            const arm = add(new THREE.SphereGeometry(0.19, 12, 10), sheet, s * 0.6, 0.72, 0.06);
            arm.scale.set(1.15, 0.85, 0.9);
        });
        eyes(1.22, 0.5, 0.15, 0.22);
        // An open "oooo" mouth is the one ghost expression everybody reads.
        const mouth = add(new THREE.SphereGeometry(0.12, 12, 10), dark, 0, 1.0, 0.58);
        mouth.scale.set(0.85, 1.15, 0.5);
    } else if (type === 'boxy') {
        // Still a cube — but a moulded one, with a screen for a face.
        add(_roundedBox(1.24, 1.2, 1.16, 0.2, 5), mat, 0, 0.72);
        // A screen INSET in the front face, sized so the eyes read as eyes
        // rather than merging with the mouth bar into one bright slab.
        add(_roundedBox(0.86, 0.56, 0.08, 0.11, 3), dark, 0, 0.82, 0.58);
        const px = new THREE.MeshBasicMaterial({ color: 0x8ef2ff });
        add(_roundedBox(0.12, 0.24, 0.05, 0.04, 2), px, 0.2, 0.9, 0.63);
        add(_roundedBox(0.12, 0.24, 0.05, 0.04, 2), px, -0.2, 0.9, 0.63);
        add(_roundedBox(0.26, 0.05, 0.05, 0.02, 2), px, 0, 0.7, 0.63);
        // Feet and a top vent, so it is a character and not a crate.
        add(_roundedBox(0.34, 0.18, 0.42, 0.07, 2), shade, 0.36, 0.11, 0.02);
        add(_roundedBox(0.34, 0.18, 0.42, 0.07, 2), shade, -0.36, 0.11, 0.02);
        add(_roundedBox(0.66, 0.1, 0.48, 0.05, 2), shade, 0, 1.36, 0);
        add(new THREE.SphereGeometry(0.07, 10, 10), gold, 0, 1.5, 0);
    } else if (type === 'bunny') {
        const body = add(new THREE.SphereGeometry(0.6, 20, 16), mat, 0, 0.7);
        body.scale.set(1, 1.05, 0.95);
        // Ears with a pink inner panel — the detail that makes them ears.
        [-1, 1].forEach(s => {
            const ear = add(new THREE.SphereGeometry(0.17, 12, 12), mat, s * 0.27, 1.54, -0.02, 0, 0, -s * 0.16);
            ear.scale.set(1, 2.6, 0.62);
            const inner = add(new THREE.SphereGeometry(0.11, 10, 10),
                new THREE.MeshStandardMaterial({ color: 0xf9a8d4, roughness: 0.5 }),
                s * 0.3, 1.54, 0.07, 0, 0, -s * 0.16);
            inner.scale.set(1, 2.4, 0.35);
        });
        // Muzzle + nose, so the face has a front.
        const muz = add(new THREE.SphereGeometry(0.22, 14, 12), pale, 0, 0.64, 0.48);
        muz.scale.set(1.25, 0.85, 0.8);
        add(new THREE.SphereGeometry(0.075, 10, 10),
            new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.4 }), 0, 0.72, 0.64);
        add(new THREE.SphereGeometry(0.24, 12, 12), pale, 0, 0.54, -0.62);  // tail puff
        add(new THREE.SphereGeometry(0.17, 10, 10), mat, 0.26, 0.18, 0.16);  // feet
        add(new THREE.SphereGeometry(0.17, 10, 10), mat, -0.26, 0.18, 0.16);
        eyes(0.9, 0.44, 0.13, 0.24);
    } else if (type === 'cabbie') {
        add(new THREE.SphereGeometry(0.62, 20, 16), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.46, 18, 14), mat, 0, 1.3);
        // A peaked cap that sits ON the head instead of over the eyes.
        add(new THREE.SphereGeometry(0.47, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark, 0, 1.48);
        const brim = add(new THREE.CylinderGeometry(0.46, 0.46, 0.055, 16, 1, false, -0.9, 1.8), dark, 0, 1.47, 0.2);
        brim.scale.set(1, 1, 1.3);
        add(new THREE.TorusGeometry(0.465, 0.05, 8, 20), gold, 0, 1.5, 0, Math.PI / 2);
        // Fare badge on the CHEST, well clear of the mouth it used to sit on.
        add(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12), gold, 0, 0.62, 0.58, Math.PI / 2);
        eyes(1.33, 0.4, 0.13, 0.21);
        smile(1.16, 0.42, 0.11);
    } else if (type === 'vendor') {
        const body = add(new THREE.SphereGeometry(0.68, 20, 16), mat, 0, 0.66);
        body.scale.set(1.1, 0.95, 1);
        add(new THREE.SphereGeometry(0.42, 18, 14), mat, 0, 1.3);
        // Apron as a curved front panel that hugs the belly. The sphere-segment
        // version wrapped the wrong way and read as a white lump on his side.
        // phi 0 is -X and phi pi/2 is +Z, so a panel centred on the FRONT starts
        // at pi/2 minus half its sweep. The first version started at 0.72pi and
        // wrapped his right side instead.
        const apron = add(new THREE.SphereGeometry(0.72, 20, 16, Math.PI * 0.30, Math.PI * 0.40, Math.PI * 0.30, Math.PI * 0.38), white, 0, 0.66);
        apron.scale.set(1.02, 0.98, 1.02);
        add(_roundedBox(0.22, 0.15, 0.06, 0.05, 2), _mkMat(0xd1d5db), 0, 0.48, 0.72);
        // Toque, seated on the head with the band overlapping the skull so
        // there is no gap between hat and character.
        add(new THREE.CylinderGeometry(0.4, 0.4, 0.18, 16), white, 0, 1.6);
        const puff = add(new THREE.SphereGeometry(0.4, 16, 12), white, 0, 1.82);
        puff.scale.set(1, 0.8, 1);
        add(new THREE.SphereGeometry(0.21, 12, 10), white, 0.21, 1.9);
        add(new THREE.SphereGeometry(0.21, 12, 10), white, -0.21, 1.9);
        eyes(1.34, 0.36, 0.12, 0.19);
        smile(1.17, 0.38, 0.11);
    } else if (type === 'banker') {
        // Tall and narrow: the one figure with a real posture.
        add(_roundedBox(0.74, 1.02, 0.58, 0.22, 4), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.4, 18, 14), mat, 0, 1.44);
        // Lapels + bow tie, all in the darker relative of the player colour.
        add(_roundedBox(0.46, 0.62, 0.1, 0.06, 3), shade, 0, 0.74, 0.31);
        add(new THREE.SphereGeometry(0.085, 10, 10), dark, 0.085, 1.1, 0.33);
        add(new THREE.SphereGeometry(0.085, 10, 10), dark, -0.085, 1.1, 0.33);
        // Top hat, seated on the crown rather than hovering over it.
        add(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 20), dark, 0, 1.72);
        add(new THREE.CylinderGeometry(0.34, 0.36, 0.6, 20), dark, 0, 2.03);
        add(new THREE.TorusGeometry(0.355, 0.035, 8, 20), gold, 0, 1.8, 0, Math.PI / 2);
        // Briefcase at his side, held, not embedded in his chest.
        add(_roundedBox(0.42, 0.32, 0.14, 0.05, 3), _mkMat(0x7c4a21), 0.56, 0.42, 0.05);
        add(new THREE.TorusGeometry(0.08, 0.022, 6, 12, Math.PI), _mkMat(0x3f2410), 0.56, 0.58, 0.05);
        eyes(1.5, 0.32, 0.12, 0.18);
        smile(1.34, 0.34, 0.1);
    } else if (type === 'bodyguard') {
        // Broad, low, heavy. The only figure wider than it is tall at the chest.
        add(_roundedBox(1.3, 1.02, 0.86, 0.24, 5), mat, 0, 0.76);
        // High-vis vest as two FRONT panels, so the player colour still shows at
        // the sides. The first version was a slab wider than the body itself,
        // which turned the whole figure yellow whoever was playing it.
        const hiviz = _mkMat(0xfacc15, 0.35);
        add(_roundedBox(0.34, 0.8, 0.12, 0.06, 3), hiviz, 0.32, 0.78, 0.42);
        add(_roundedBox(0.34, 0.8, 0.12, 0.06, 3), hiviz, -0.32, 0.78, 0.42);
        // Bands across the FRONT only. Wrapping them right round the figure
        // turned him into a striped barrel and hid the player colour entirely.
        const band = _mkMat(0xe5e7eb, 0.2, 0.6);
        add(_roundedBox(0.92, 0.08, 0.1, 0.03, 2), band, 0, 0.98, 0.44);
        add(_roundedBox(0.92, 0.08, 0.1, 0.03, 2), band, 0, 0.6, 0.44);
        // Shoulder pads, a squared head and a live visor across the FRONT face.
        add(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), shade, 0.68, 1.2, 0);
        add(new THREE.SphereGeometry(0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), shade, -0.68, 1.2, 0);
        add(_roundedBox(0.9, 0.78, 0.8, 0.24, 4), dark, 0, 1.72);
        add(_roundedBox(0.66, 0.19, 0.1, 0.07, 3),
            new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4d00, emissiveIntensity: 1.1 }),
            0, 1.74, 0.41);
        // Earpiece — the small detail that sells the job.
        add(new THREE.SphereGeometry(0.07, 8, 8), _mkMat(0x111827), 0.45, 1.7, 0.02);
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.4, 6), _mkMat(0x111827), 0.45, 1.44, 0.02, 0, 0, 0.18);
    } else if (type === 'investor') {
        add(_roundedBox(0.78, 1.0, 0.6, 0.24, 4), mat, 0, 0.62);
        add(new THREE.SphereGeometry(0.4, 18, 14), mat, 0, 1.4);
        // Collar + tie: the forward cue, and it says "suit" in two meshes.
        add(_roundedBox(0.44, 0.16, 0.1, 0.05, 2), white, 0, 1.04, 0.3);
        const tie = add(new THREE.ConeGeometry(0.11, 0.5, 4), _mkMat(0xdc2626), 0, 0.76, 0.33, Math.PI, 0, 0);
        tie.rotation.y = Math.PI / 4;
        // The rising chart, as three steps and an arrow rather than a lollipop.
        const green = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x15803d, emissiveIntensity: 0.7 });
        [0, 1, 2].forEach(i => add(_roundedBox(0.14, 0.14 + i * 0.16, 0.14, 0.04, 2), green,
            -0.24 + i * 0.24, 1.9 + i * 0.08, 0));
        add(new THREE.ConeGeometry(0.16, 0.3, 4), green, 0.36, 2.28, 0, 0, Math.PI / 4, -0.5);
        eyes(1.45, 0.32, 0.12, 0.18);
        smile(1.3, 0.34, 0.1);
    }

    // Contact shadow. Without it every figure looks like it is hovering a few
    // centimetres above the tile — the receiveShadow pass alone is too soft at
    // this camera distance to plant them.
    const contact = new THREE.Mesh(
        new THREE.CircleGeometry(0.62, 20),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.03;
    contact.renderOrder = -1;
    group.add(contact);

    group.traverse(o => {
        if (!o.isMesh || o === contact) return;
        o.castShadow = true; o.receiveShadow = true;
    });
    return group;
}

// Small material factory used by the figures above for their non-body parts.
function _mkMat(color, rough = 0.42, metal = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function buildPlayerMeshes() {
    const isHBD = state.selectedMap === 'hundred_block_dash';
    state.players.forEach(p => {
        p.mesh = createCharacterMesh(p.charType, p.color);
        if (isHBD) {
            const idx = typeof p.pos === 'number' ? p.pos : 0;
            const pos = getPos(idx).clone();
            const tangent = boardCurve.getTangent(Math.max(0, Math.min(1, idx / _hbdMax)));
            const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
            pos.addScaledVector(right, p.id === 0 ? -0.7 : 0.7);
            p.mesh.position.set(pos.x, 0, pos.z);
        } else {
            const pos = getPos(p.pos || 'r1').clone();
            pos.x += p.id === 0 ? -1.2 : 1.2;
            p.mesh.position.set(pos.x, 0, pos.z);
        }
        scene.add(p.mesh);
    });
}

// ---- Ally markers on map ----

// An ally waiting on the board used to be an anonymous gold octahedron. Deciding
// whether to detour for it — and whether to spend a minigame on it — depends
// entirely on WHICH ally it is: the Bodyguard soaks two hits, the Cabbie
// teleports you, the Banker pays interest. The marker is now the ally's own
// character model, standing on the tile under a floating gold ring so it still
// reads as something to go and get.
export function placeAllyMarker(nodeId, allyType) {
    removeAllyMarker();
    const ally = ALLIES[allyType];
    if (!ally || !nodeId) return;

    const grp = new THREE.Group();
    const tile = getPos(nodeId).clone().setY(0);
    grp.position.copy(tile);

    // The buddy stands BESIDE the tile, not on it. Standing on it meant the
    // model sat in the same place a player token lands, so on arrival the two
    // occupied one square and the buddy read as scenery rather than as somebody
    // waiting by the road. Offset outward, away from the middle of the board,
    // which is the open side on a ring map.
    const side = _outwardDir(tile);
    const model = createCharacterMesh(allyType, 0xfbbf24);
    model.scale.setScalar(0.85);
    model.position.copy(side).multiplyScalar(BUDDY_STAND_OFF);
    // Face the road they are waiting beside.
    model.rotation.y = Math.atan2(-side.x, -side.z);
    grp.add(model);

    // A halo above the head: the "there is something here" signal the octahedron
    // used to carry on its own.
    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.09, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.6 }));
    ring.position.copy(model.position).setY(2.5);
    ring.rotation.x = Math.PI / 2;
    grp.add(ring);

    // The BUDDY SPACE itself. The tile the buddy is standing next to is marked
    // for as long as they are there: a bright ring on the tile, a soft fill, and
    // a link from the tile to the figure so it is unambiguous WHICH space the
    // buddy belongs to.
    const padMat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false });
    const pad = new THREE.Mesh(new THREE.CircleGeometry(1.9, 24), padMat);
    pad.rotation.x = -Math.PI / 2; pad.position.y = 0.07; pad.renderOrder = 2;
    grp.add(pad);

    const rim = new THREE.Mesh(
        new THREE.RingGeometry(1.9, 2.25, 28),
        new THREE.MeshBasicMaterial({ color: 0xfde68a, transparent: true, opacity: 0.85,
                                      side: THREE.DoubleSide, depthWrite: false }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.08; rim.renderOrder = 3;
    grp.add(rim);

    // A short walkway from the marked tile to the figure standing off it.
    const link = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, BUDDY_STAND_OFF),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.22,
                                      side: THREE.DoubleSide, depthWrite: false }));
    link.rotation.x = -Math.PI / 2;
    link.rotation.z = -Math.atan2(side.z, side.x) + Math.PI / 2;
    link.position.copy(side).multiplyScalar(BUDDY_STAND_OFF / 2).setY(0.075);
    link.renderOrder = 2;
    grp.add(link);

    scene.add(grp);
    allyMarkers.set('current', grp);
    // Bob the ring, not the whole group — a hovering character reads as a ghost.
    floatingIcons.push({ mesh: ring, group: grp, baseY: 2.5, speed: 2.0, phase: 0 });
    // Pulse the tile marking so a BUDDY SPACE reads as live rather than painted.
    _buddyPulse = { pad: padMat, rim: rim.material, t: 0 };
}

// How far off the tile the figure stands. Far enough to read as "beside the
// road" and not far enough to look like it belongs to the next tile along.
const BUDDY_STAND_OFF = 2.6;
let _buddyPulse = null;

export function removeAllyMarker() {
    const m = allyMarkers.get('current');
    if (!m) return;
    // The old order deleted the map entry FIRST and then looked the mesh up
    // again to find its floatingIcons row — which by then returned undefined, so
    // the row was never removed. Every ally spawn leaked one animated entry
    // pointing at a mesh no longer in the scene. Drop the row first.
    for (let i = floatingIcons.length - 1; i >= 0; i--) {
        const f = floatingIcons[i];
        if (f.group === m || f.mesh === m) floatingIcons.splice(i, 1);
    }
    scene.remove(m);
    _disposeTree(m);
    allyMarkers.delete('current');
    _buddyPulse = null;
}

// ---- Character portraits -------------------------------------------------
//
// The character picker was nine emoji. An emoji says nothing about what the
// piece you will spend a whole match looking at actually is — the Vendor's chef
// hat, the Banker's top hat and briefcase, the Bunny's ears are all invisible
// until the board loads. These are the real meshes, rendered offscreen once.
//
// A throwaway WebGL context is created, used and released inside this call, so
// it never competes with the board renderer (which does not exist yet at char
// select) and cannot leak a context if the player backs out.
export function renderCharacterPortraits(types, colorCode, size = 176) {
    const out = {};
    if (typeof THREE === 'undefined' || !types || !types.length) return out;
    let gl = null;
    try {
        gl = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        gl.setSize(size, size, false);
        gl.setClearColor(0x000000, 0);

        const s = new THREE.Scene();
        s.add(new THREE.AmbientLight(0xffffff, 0.95));
        const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2.5, 4, 3.5); s.add(key);
        const rim = new THREE.DirectionalLight(0xbcd8ff, 0.55); rim.position.set(-3, 2, -2); s.add(rim);
        const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 60);

        types.forEach(t => {
            const grp = createCharacterMesh(t, colorCode);
            s.add(grp);
            // Frame from the bounding SPHERE, not a fixed multiple of height —
            // a fixed pull-back crops the tall ones (the bunny loses its ears,
            // the cabbie half its cap) and leaves the squat ones tiny.
            const sph = new THREE.Box3().setFromObject(grp).getBoundingSphere(new THREE.Sphere());
            const dist = (sph.radius * 1.12) / Math.sin((cam.fov * Math.PI / 180) / 2);
            cam.position.set(sph.center.x + dist * 0.20, sph.center.y + dist * 0.13, sph.center.z + dist);
            cam.lookAt(sph.center);
            gl.render(s, cam);
            out[t] = gl.domElement.toDataURL('image/png');
            s.remove(grp);
            _disposeTree(grp);
        });
    } catch (e) {
        console.warn('[Renderer] character portraits unavailable:', e);
    } finally {
        // Browsers cap live WebGL contexts hard; forcing the loss frees this one
        // immediately rather than whenever GC gets round to it.
        if (gl) {
            try { gl.forceContextLoss(); } catch (e) {}
            try { gl.dispose(); } catch (e) {}
        }
    }
    return out;
}

// ---- Ally follower meshes ----

export function attachAllyMesh(player, allySlotIdx, allyType) {
    const ally = ALLIES[allyType];
    if (!ally) return null;
    const allyColor = 0xffd700;
    const mesh = createCharacterMesh(allyType, allyColor);
    mesh.scale.setScalar(0.55);
    const pos = player.mesh.position.clone();
    pos.x += (allySlotIdx === 0 ? -1.8 : 1.8);
    mesh.position.copy(pos);
    scene.add(mesh);
    return mesh;
}

export function detachAllyMesh(mesh, onDone) {
    if (!mesh) { if (onDone) onDone(); return; }
    const start = mesh.position.clone();
    activeAnims.push({
        obj: { t: 0 }, start: { t: 0 }, to: { t: 1 }, dur: 0.8,
        onUpdate: (p) => {
            mesh.position.y = start.y + p * 5;
            mesh.material && (mesh.material.opacity = 1 - p);
        },
        onComplete: () => { scene.remove(mesh); if (onDone) onDone(); },
    });
}

export function updateAllyPositions(player) {
    if (!player.mesh) return;
    const pPos = player.mesh.position;
    const prevPos = getPos(player.prevPos || player.pos);
    const fwd = new THREE.Vector3().subVectors(pPos, prevPos).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
    if (right.lengthSq() < 0.001) right.set(1, 0, 0);

    player.allies.forEach((ally, i) => {
        if (!ally.mesh) return;
        const side  = i === 0 ? -1 : 1;
        const target = pPos.clone()
            .addScaledVector(fwd, -1.5)
            .addScaledVector(right, side * 1.8);
        ally.mesh.position.lerp(target, 0.12);
        ally.mesh.position.y = 0;
    });
}

// ---- Biome visuals ----

export function updateBiomeVisuals(districtOrIdx) {
    let b;
    if (typeof districtOrIdx === 'number') {
        b = getBiomeForSpace(districtOrIdx);
        if (scene && scene.fog) scene.fog.color.set(b.fog);
    } else {
        b = getBiomeForDistrict(districtOrIdx || 'ring');
        if (scene && scene.fog) scene.fog.color.set(b.fog);
    }
    document.getElementById('bg-gradient').style.background = `linear-gradient(to bottom, ${b.bgTop}, ${b.bgBot})`;
}

// ---- Player hop animation ----

// `opts.faceToward` overrides where the token turns to look on arrival, and
// `opts.dur` overrides the hop length. Both exist for the junction walk: a
// token stepping onto the fork is heading down whichever road was chosen, not
// down `next[0]`, and the fork-to-district leg covers 26 units where an
// ordinary hop covers about 10 — at a fixed 0.35 s that read as a teleport.
export function animatePlayerHop(player, targetNodeId, onComplete, opts = {}) {
    const dest = getPos(targetNodeId).clone();
    dest.y = 0;
    if (typeof targetNodeId === 'number') {
        // HBD: use curve tangent for orientation
        if (boardCurve) {
            const t = Math.max(0.001, Math.min(targetNodeId / _hbdMax, 0.999));
            const tangent = boardCurve.getTangent(t).normalize();
            const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
            dest.addScaledVector(right, player.id === 0 ? -0.7 : 0.7);
            player.mesh.lookAt(dest.clone().add(tangent));
        }
    } else {
        // City Circuit: use graph next node for orientation
        let nextId = opts.faceToward || CITY_GRAPH[targetNodeId]?.next?.[0];
        if (nextId && JUNCTION_IDS.has(nextId)) nextId = CITY_GRAPH[nextId]?.next?.[0];
        if (nextId) {
            const nextPos = getPos(nextId);
            const fwd     = new THREE.Vector3().subVectors(nextPos, dest).normalize();
            const right   = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
            if (right.lengthSq() > 0.001) dest.addScaledVector(right, player.id === 0 ? -0.7 : 0.7);
            player.mesh.lookAt(dest.clone().add(fwd));
        }
    }
    player.prevPos = player.pos;
    // Keep the token's ground speed roughly constant. Every hop used to take
    // 0.35 s regardless of distance, so the long fork-to-district leg travelled
    // three times faster than a normal step and read as a jump cut.
    let dur = opts.dur;
    if (dur === undefined) {
        const d = player.mesh.position.distanceTo(dest);
        dur = Math.max(0.28, Math.min(0.9, 0.28 + (d - 10) * 0.022));
    }
    activeAnims.push({
        obj: player.mesh.position, start: player.mesh.position.clone(), to: dest,
        dur, isHop: true, hopH: opts.hopH, onComplete,
    });
}

// ============================================================
// SWAP SPACE — the abduction
// ============================================================
//
// A Swap used to be instantaneous: two `mesh.position.copy()` calls and a
// toast. Both tokens simply appeared somewhere else, which is the single most
// dramatic thing that can happen on the board delivered as a rendering glitch.
//
// It is now a set piece the camera actually watches. The shape is a round trip:
//
//   1. a saucer drops out of the sky over whoever landed on the tile
//   2. it beams them up — they rise into the light and vanish
//   3. it flies to the opponent, the camera travelling with it
//   4. it sets the first player down there
//   5. it beams the opponent up
//   6. it flies back, again with the camera
//   7. it sets them down on the tile the first player came from
//
// The camera rides the saucer rather than either player, because the saucer is
// the thing that is moving. cameraState is parked on 'CINEMATIC', which the
// render loop deliberately does not drive — this function owns the camera for
// its duration and hands it back at the end.

// Seven legs, ~5.9 s all told. It is a set piece and it should feel like one,
// but it also fires on a tile you can land on more than once in a match, so it
// is paced to be watched twice rather than admired once.
const SWAP = {
    DESCEND: 0.70,   // saucer drops out of the sky
    BEAM:    0.65,   // player rises into the light
    TRAVEL:  1.15,   // saucer crosses the board
    DROP:    0.55,   // player is set down
    LIFT:    0.45,   // saucer pulls back up at the end
};

function _buildUfo() {
    const g = new THREE.Group();
    // Bright and only lightly metallic: there is no environment map in this
    // scene, so a shiny metal saucer renders as a black disc.
    const hull = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 22, 12),
        new THREE.MeshStandardMaterial({ color: 0x8f9ab5, metalness: 0.5, roughness: 0.35,
                                         emissive: 0x141a2a, emissiveIntensity: 0.5 }));
    hull.scale.set(1, 0.26, 1);
    g.add(hull);
    const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.15, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: 0x7ee7ff, transparent: true, opacity: 0.55,
                                         emissive: 0x1a6b7d, emissiveIntensity: 0.7, roughness: 0.1 }));
    dome.position.y = 0.35;
    g.add(dome);
    // Running lights around the rim.
    const lampGeo = new THREE.SphereGeometry(0.2, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x9df7ff });
    const lamps = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const l = new THREE.Mesh(lampGeo, lampMat.clone());
        l.position.set(Math.cos(a) * 2.35, -0.15, Math.sin(a) * 2.35);
        g.add(l); lamps.push(l);
    }
    // The tractor beam: a cone from the saucer to the ground, scaled in and out.
    // Apex at the ship, base on the ground, and wider than the hull so it is
    // not hidden inside the saucer's own silhouette from every angle.
    const beam = new THREE.Mesh(
        new THREE.ConeGeometry(3.4, 1, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x8ef0ff, transparent: true, opacity: 0.0,
                                      side: THREE.DoubleSide, depthWrite: false,
                                      blending: THREE.AdditiveBlending }));
    beam.position.y = -0.5;
    g.add(beam);
    g.userData.beam  = beam;
    g.userData.lamps = lamps;
    return g;
}

let _swapUfo = null;

export function playSwapCinematic(playerA, playerB, onDone) {
    const done = () => { try { onDone && onDone(); } catch (e) { console.error(e); } };
    if (!scene || !camera || !playerA?.mesh || !playerB?.mesh) { done(); return; }

    const aStart = playerA.mesh.position.clone().setY(0);
    const bStart = playerB.mesh.position.clone().setY(0);
    // Standing on the same tile: there is nothing to watch, so don't.
    if (aStart.distanceTo(bStart) < 0.8) { done(); return; }

    const HOVER = 9;
    const ufo = _swapUfo || (_swapUfo = _buildUfo());
    if (!ufo.parent) scene.add(ufo);
    ufo.visible = true;
    ufo.position.copy(aStart).setY(HOVER + 26);      // drops in from above
    const beam = ufo.userData.beam;
    const setBeam = (v) => {
        beam.material.opacity = 0.26 * v;   // additive over a daylit city: less is more
        // x/z only — scale.y is the beam's reach and is set by stretchBeam().
        beam.scale.x = beam.scale.z = 0.45 + v * 0.75;
    };
    setBeam(0);

    state.cameraState = 'CINEMATIC';

    // Ride alongside the saucer, aimed at the ground beneath it. Two things had
    // to be got right here:
    //
    //   * Looking DOWN at the saucer hides the beam inside the hull's own
    //     silhouette and hides whoever is being lifted. The shot is side-on.
    //   * A fixed world-space offset (`+z`) puts the camera inside a building
    //     on whichever part of the board happens to have one there. The offset
    //     is instead perpendicular to the saucer's flight path, on the side
    //     facing the middle of the board — which on a ring map is the open
    //     plaza, and on a linear one is the inside of the curve.
    const travel = bStart.clone().sub(aStart).setY(0).normalize();
    const side   = new THREE.Vector3(0, 1, 0).cross(travel).normalize();
    const centre = new THREE.Vector3(_panBounds.cx, 0, _panBounds.cz);
    if (side.dot(centre.clone().sub(aStart).setY(0)) < 0) side.negate();
    const shot = (at, ease = 1) => {
        const want = at.clone().addScaledVector(side, 21);
        want.y = at.y + 5.5;
        camera.position.lerp(want, ease);
        camera.lookAt(at.x, at.y - 6.5, at.z);
    };
    // Height of the beam cone so it always reaches the ground.
    const stretchBeam = () => { beam.scale.y = Math.max(0.1, ufo.position.y); beam.position.y = -ufo.position.y / 2; };

    const step = (o, from, to, dur, onUpdate, then) => {
        activeAnims.push({
            obj: o, start: from, to, dur,
            onUpdate: (t) => { onUpdate && onUpdate(t); },
            onComplete: then,
        });
    };

    // Carried token: hidden inside the saucer between legs.
    const carry = (mesh, visible) => { mesh.visible = visible; };

    const t = { v: 0 };

    // 1 — descend over A
    step(ufo.position, ufo.position.clone(), aStart.clone().setY(HOVER), SWAP.DESCEND,
        () => { stretchBeam(); shot(ufo.position, 0.22); }, () => {
        sfx('swap');
        // 2 — beam A up
        const aFrom = playerA.mesh.position.clone();
        step(t, { v: 0 }, { v: 1 }, SWAP.BEAM, (pr) => {
            setBeam(Math.sin(pr * Math.PI) * 1.0 + 0.25);
            stretchBeam();
            playerA.mesh.position.set(aFrom.x, aFrom.y + pr * (HOVER - 1.2), aFrom.z);
            playerA.mesh.rotation.y += 0.22;
            playerA.mesh.scale.setScalar(Math.max(0.02, 1 - pr));
            shot(ufo.position, 0.18);
        }, () => {
            carry(playerA.mesh, false);
            playerA.mesh.scale.setScalar(1);
            setBeam(0);
            // 3 — fly to B, camera along for the ride
            step(ufo.position, ufo.position.clone(), bStart.clone().setY(HOVER), SWAP.TRAVEL,
                () => { stretchBeam(); shot(ufo.position, 0.14); }, () => {
                // 4 — set A down where B was standing
                carry(playerA.mesh, true);
                playerA.mesh.position.set(bStart.x, HOVER - 1.2, bStart.z);
                playerA.mesh.scale.setScalar(0.02);
                step(t, { v: 0 }, { v: 1 }, SWAP.DROP, (pr) => {
                    setBeam(Math.sin(pr * Math.PI));
                    stretchBeam();
                    playerA.mesh.position.y = (HOVER - 1.2) * (1 - pr);
                    playerA.mesh.scale.setScalar(Math.max(0.02, pr));
                    shot(ufo.position, 0.18);
                }, () => {
                    playerA.mesh.position.set(bStart.x, 0, bStart.z);
                    playerA.mesh.scale.setScalar(1);
                    sfx('swap');
                    // 5 — beam B up
                    const bFrom = playerB.mesh.position.clone();
                    step(t, { v: 0 }, { v: 1 }, SWAP.BEAM, (pr) => {
                        setBeam(Math.sin(pr * Math.PI) * 1.0 + 0.25);
                        stretchBeam();
                        playerB.mesh.position.set(bFrom.x, bFrom.y + pr * (HOVER - 1.2), bFrom.z);
                        playerB.mesh.rotation.y += 0.22;
                        playerB.mesh.scale.setScalar(Math.max(0.02, 1 - pr));
                        shot(ufo.position, 0.18);
                    }, () => {
                        carry(playerB.mesh, false);
                        playerB.mesh.scale.setScalar(1);
                        setBeam(0);
                        // 6 — fly back
                        step(ufo.position, ufo.position.clone(), aStart.clone().setY(HOVER), SWAP.TRAVEL,
                            () => { stretchBeam(); shot(ufo.position, 0.14); }, () => {
                            // 7 — set B down where A came from
                            carry(playerB.mesh, true);
                            playerB.mesh.position.set(aStart.x, HOVER - 1.2, aStart.z);
                            playerB.mesh.scale.setScalar(0.02);
                            step(t, { v: 0 }, { v: 1 }, SWAP.DROP, (pr) => {
                                setBeam(Math.sin(pr * Math.PI));
                                stretchBeam();
                                playerB.mesh.position.y = (HOVER - 1.2) * (1 - pr);
                                playerB.mesh.scale.setScalar(Math.max(0.02, pr));
                                shot(ufo.position, 0.18);
                            }, () => {
                                playerB.mesh.position.set(aStart.x, 0, aStart.z);
                                playerB.mesh.scale.setScalar(1);
                                setBeam(0);
                                // 8 — the saucer leaves
                                step(ufo.position, ufo.position.clone(),
                                     ufo.position.clone().setY(HOVER + 30), SWAP.LIFT,
                                    () => { stretchBeam(); shot(ufo.position, 0.10); }, () => {
                                    ufo.visible = false;
                                    endSwapCinematic();
                                    done();
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

// Put everything back the way a cinematic found it. Called on completion and,
// defensively, by anything that interrupts one — a half-finished abduction must
// never leave a token invisible or scaled to nothing.
export function endSwapCinematic() {
    if (_swapUfo) {
        _swapUfo.visible = false;
        if (_swapUfo.userData.beam) _swapUfo.userData.beam.material.opacity = 0;
    }
    state.players.forEach(p => {
        if (!p.mesh) return;
        p.mesh.visible = true;
        p.mesh.scale.setScalar(1);
        p.mesh.position.y = 0;
    });
    if (state.cameraState === 'CINEMATIC') {
        state.cameraState = 'FOLLOW';
        resetCameraSmoothing();
        snapCameraToActive();
    }
}

// Hand the camera back after any set piece that parked it on 'CINEMATIC'.
// Snapping rather than easing: the shot could be anywhere on the board, and
// easing back across it is a long drift with nothing happening in it.
export function endCinematic() {
    if (state.cameraState !== 'CINEMATIC') return;
    state.cameraState = 'FOLLOW';
    resetCameraSmoothing();
    snapCameraToActive();
}

// Total run time, so the caller can size its beat from the animation rather
// than guessing a number that then drifts out of sync with it.
export function swapCinematicMs() {
    return Math.round((SWAP.DESCEND + SWAP.BEAM * 2 + SWAP.TRAVEL * 2 + SWAP.DROP * 2 + SWAP.LIFT) * 1000);
}

// ---- Flyover (game start) ----

export function startFlyover(onComplete) {
    if (state.selectedMap === 'hundred_block_dash') {
        // Linear flyover: sweep along boardCurve
        const flyObj = { p: 0 };
        activeAnims.push({
            obj: flyObj, start: { p: 0 }, to: { p: 1.0 }, dur: SCENE.FLYOVER_HBD / 1000,
            onUpdate: () => {
                const safeT   = Math.max(0.001, Math.min(flyObj.p, 0.999));
                const pt      = boardCurve.getPoint(safeT);
                const tangent = boardCurve.getTangent(safeT).normalize();
                if (pt && !isNaN(pt.x)) {
                    camera.position.copy(pt).add(new THREE.Vector3(0, 65, 0));
                    camera.lookAt(pt.clone().add(tangent.clone().multiplyScalar(40)).setY(0));
                }
            },
            onComplete,
        });
    } else {
        // City Circuit: circular flyover
        const flyObj = { angle: 0, height: 90, dist: 110 };
        activeAnims.push({
            obj: flyObj, start: { angle: 0, height: 90, dist: 110 }, to: { angle: Math.PI * 1.5, height: 28, dist: 55 },
            dur: SCENE.FLYOVER_CITY / 1000,
            onUpdate: () => {
                camera.position.set(
                    Math.cos(flyObj.angle) * flyObj.dist,
                    flyObj.height,
                    Math.sin(flyObj.angle) * flyObj.dist
                );
                camera.lookAt(0, 0, 0);
            },
            onComplete,
        });
    }
}

// ---- Post-minigame flyover (HBD: sweep from near end back to rearmost player) ----

export function startPostMinigameFlyover(onComplete) {
    if (state.selectedMap !== 'hundred_block_dash' || !boardCurve) {
        // City has no reverse sweep, so hand the camera straight back — but put
        // it where it belongs first. Returning it in FOLLOW while it is still
        // parked at whatever the minigame left behind meant a long swooping
        // drift across the city on every single minigame result.
        if (onComplete) { snapCameraToActive(); onComplete(); }
        return;
    }
    const rearPos = Math.min(...state.players
        .filter(p => typeof p.pos === 'number')
        .map(p => p.pos));
    const rearT = Math.max(0.001, Math.min(rearPos / _hbdMax, 0.999));
    const flyObj = { p: 0.985 };
    activeAnims.push({
        obj: flyObj, start: { p: 0.985 }, to: { p: rearT }, dur: 3.5,
        onUpdate: () => {
            const safeT   = Math.max(0.001, Math.min(flyObj.p, 0.999));
            const pt      = boardCurve.getPoint(safeT);
            const tangent = boardCurve.getTangent(safeT).normalize();
            if (pt && !isNaN(pt.x)) {
                camera.position.copy(pt).add(new THREE.Vector3(0, 55, 0));
                // Look backward (direction of travel during this reverse sweep)
                camera.lookAt(pt.clone().addScaledVector(tangent, -40).setY(0));
            }
        },
        onComplete,
    });
}

// ============================================================
// CAMERA
// ============================================================
//
// Every camera lerp in here used to be a fixed per-frame fraction — position at
// 0.055, rotation at 0.07, map at 0.10. A per-frame fraction makes the camera's
// speed a function of the display's refresh rate: on the 120 Hz phones this is
// actually played on it converged twice as fast as it did in testing, and on a
// dropped frame it lurched. _damp() restates the same numbers as a half-life the
// frame rate cannot change, so the feel is identical at 30, 60 and 144 Hz.
function _damp(perFrameAt60, dt) {
    return 1 - Math.pow(1 - perFrameAt60, Math.min(dt, 0.1) * 60);
}

// City Circuit framing. Sits further back and higher than the old 14/22 so a
// whole corner of the ring is in shot — the closer the camera, the more a small
// change of heading swings the view.
const CAM = {
    city: { back: 19, up: 26, lead: 7 },
    hbd:  { back: 14, up: 22, lead: 10 },
};

// Beyond this much ground to make up in one frame, the follow camera cuts
// rather than eases. One hop moves the target ~10 units; only a teleport or a
// change of turn across the board exceeds this.
const CAM_CUT = 40;

// The camera's own heading, smoothed. This is the single biggest cause of the
// touchiness: the old code recomputed the heading every frame as
// (mesh position − previous NODE position). While a token is mid-hop the mesh is
// moving, so that vector swung through the whole arc of every jump and the
// camera swung with it. Worse, adjacent nodes on a 32-unit ring are ~18° apart
// and district entries much more, so each landing snapped the view to a new
// bearing. The heading now comes off the board graph — constant for a whole hop
// — and is itself eased, so a corner is turned through rather than cut to.
const _camFwd     = new THREE.Vector3(0, 0, -1);
let   _camFwdInit = false;
const _tmpGround  = new THREE.Vector3();
const _tmpHead    = new THREE.Vector3();

export function resetCameraSmoothing() { _camFwdInit = false; }

// Which way is this player facing, per the board itself?
function _rawHeading(p) {
    if (state.selectedMap === 'hundred_block_dash' && boardCurve && typeof p.pos === 'number') {
        const t = Math.max(0.001, Math.min(p.pos / _hbdMax, 0.999));
        return _tmpHead.copy(boardCurve.getTangent(t)).setY(0).normalize();
    }
    // City: ask the graph where this node points. Resolve through the invisible
    // junction nodes so the heading never aims at a node nobody can stand on.
    let nid = CITY_GRAPH[p.pos]?.next?.[0];
    if (nid && JUNCTION_IDS.has(nid)) nid = CITY_GRAPH[nid]?.next?.[0];
    if (!nid) return null;
    _tmpHead.copy(getPos(nid)).sub(getPos(p.pos)).setY(0);
    return _tmpHead.lengthSq() > 1e-6 ? _tmpHead.normalize() : null;
}

// Where the follow camera wants to be, and what it wants to look at, for the
// heading currently held in _camFwd. Both the per-frame follow and the hard snap
// go through this, so resuming play after a full-screen scene lands on exactly
// the pose the loop would have eased to — no jump on the first frame back.
function _followPose(p) {
    const isHBD = state.selectedMap === 'hundred_block_dash';
    const f = isHBD ? CAM.hbd : CAM.city;
    // Flattened: the hop animation bobs the token 2.5 units into the air, and
    // reading its live y made the camera bob with it on every single move.
    const ground = _tmpGround.set(p.mesh.position.x, 0, p.mesh.position.z);
    const pos  = ground.clone().addScaledVector(_camFwd, -f.back);
    pos.y = f.up;
    const look = ground.clone().addScaledVector(_camFwd, f.lead);
    look.y = 1.2;
    return { pos, look };
}

// ---- Gate camera ----
//
// The gate scene used to be a full-screen black panel, so where the camera was
// pointing did not matter. Now that the card is transparent, it does: this
// frames the player and the gate they are standing at, low enough that the
// structure itself fills the shot rather than being a tile seen from above.
const gateCam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), active: false };

export function focusOnGate(player) {
    if (!player || !player.mesh || !camera) return;
    const at = player.mesh.position.clone().setY(0);
    // Look at it from the side the player came from, so their token is in shot.
    const back = _rawHeading(player);
    const dir = back && back.lengthSq() > 0.1 ? back.clone() : new THREE.Vector3(0, 0, -1);
    gateCam.look.copy(at).setY(2.2);
    gateCam.pos.copy(at).addScaledVector(dir, -15).setY(11);
    gateCam.active = true;
    state.cameraState = 'GATE';
}

export function clearGateFocus() {
    gateCam.active = false;
    if (state.cameraState === 'GATE') state.cameraState = 'FOLLOW';
}

// ---- Junction camera ----
//
// A junction used to be presented as a full-screen card, which meant the one
// moment in the match where the board's shape actually matters was the one
// moment you couldn't see it. The choice now happens over the board, so the
// camera has to put both roads on screen: it lifts to 44 units and pulls back
// along the road the player arrived on, centred on the fork itself.
const junctionCam = {
    pos:    new THREE.Vector3(),
    look:   new THREE.Vector3(),
    active: false,
};

export function focusJunction(junctionId, fromNodeId) {
    const j    = getPos(junctionId).clone().setY(0);
    const from = getPos(fromNodeId).clone().setY(0);
    const fwd  = j.clone().sub(from);
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); else fwd.normalize();
    // High and well back: both roads and a few nodes of each have to be in shot
    // or the arrows are pointing at things the player cannot see.
    junctionCam.look.copy(j).addScaledVector(fwd, 12);
    junctionCam.pos.copy(j).addScaledVector(fwd, -34);
    junctionCam.pos.y = 58;
    junctionCam.active = true;
}

export function clearJunctionFocus() { junctionCam.active = false; }

// Point the follow camera down a specific road before the token starts walking
// it. Without this the camera keeps whatever heading the previous node had and
// only turns as the token moves — so the player set off down a road they could
// not yet see, and the camera arrived after they had already landed.
export function aimAlongRoad(fromNodeId, toNodeId) {
    const a = getPos(fromNodeId).clone().setY(0);
    const b = getPos(toNodeId).clone().setY(0);
    const d = b.sub(a);
    if (d.lengthSq() < 1e-6) return;
    _camFwd.copy(d.normalize());
    _camFwdInit = true;
}

// True once the follow camera has essentially arrived at where it wants to be,
// so a caller can wait for the shot to settle instead of guessing a delay.
export function followCameraSettled(tolerance = 3.5) {
    const p = state.players[state.activePlayer];
    if (!p || !p.mesh || !camera) return true;
    const { pos } = _followPose(p);
    return camera.position.distanceTo(pos) <= tolerance;
}

// ---- Map camera ----

const mapCam = {
    targetPos:  new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    dragging:   false,
    dragStart:  { x: 0, y: 0 },
    dragCamStart:  new THREE.Vector3(),
    dragLookStart: new THREE.Vector3(),
};
export const mapCamera = mapCam;

// How far off the board the map view may be dragged. Measured from the real
// layout rather than hardcoded, because HBD is a long ribbon and City is a disc.
// Without this the map could be flung into empty ground with the board nowhere
// on screen and no way back but the slider — which read as the drag being broken.
let _panBounds = { cx: 0, cz: 0, r: 120 };

function _measureBoardExtent() {
    const pts = state.selectedMap === 'hundred_block_dash'
        ? hbdPositions
        : [...nodePositions.values()];
    if (!pts.length) { _panBounds = { cx: 0, cz: 0, r: 120 }; return; }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    pts.forEach(p => {
        if (!p) return;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    });
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const r  = Math.max(maxX - minX, maxZ - minZ) / 2 + 26;  // a little slack past the edge
    _panBounds = { cx, cz, r };
}

// Pull the map target back inside the board's own footprint.
export function clampMapTarget() {
    const dx = mapCam.targetLook.x - _panBounds.cx;
    const dz = mapCam.targetLook.z - _panBounds.cz;
    const d  = Math.hypot(dx, dz);
    if (d <= _panBounds.r || d === 0) return;
    const pull = 1 - _panBounds.r / d;
    const ox = dx * pull, oz = dz * pull;
    mapCam.targetLook.x -= ox; mapCam.targetLook.z -= oz;
    mapCam.targetPos.x  -= ox; mapCam.targetPos.z  -= oz;
}

export function setMapCameraTarget(nodeId, offsetY = 50, offsetZ = 30) {
    // getPos() already resolves both address spaces: a string is a City node id,
    // a number is a Hundred Block Dash board index. The old numeric branch went
    // through ALL_NODES_ORDERED (City-only), so on HBD it aimed the map camera at
    // an unrelated city node — which is why the map view was disabled there.
    const pt = getPos(nodeId);
    mapCam.targetPos.copy(pt).add(new THREE.Vector3(0, offsetY, offsetZ));
    mapCam.targetLook.copy(pt);
    mapCam.dragCamStart.copy(mapCam.targetPos);
    mapCam.dragLookStart.copy(mapCam.targetLook);
}

// Put the follow camera exactly where it belongs for the active player, with no
// lerp. Play resuming after a full-screen scene (the gate, a minigame) used to
// start with the camera still parked where that scene left it, so the token
// walked off-screen while the camera crawled after it at 0.055/frame.
export function snapCameraToActive() {
    const p = state.players[state.activePlayer];
    if (!p || !p.mesh || !camera) return;
    const raw = _rawHeading(p);
    if (raw) { _camFwd.copy(raw); _camFwdInit = true; }
    const { pos, look } = _followPose(p);
    if (isNaN(pos.x)) return;
    camera.position.copy(pos);
    camera.lookAt(look);
}

// Project a world point to viewport pixels. Returns null when the point is
// behind the camera. Used to hang the junction arrows over the board itself.
export function worldToScreen(worldPos) {
    if (!camera) return null;
    const v = worldPos.clone().project(camera);
    if (v.z > 1) return null;
    const W = window.innerWidth || 300, H = window.innerHeight || 500;
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
}

export function getDiceGroup() { return diceGrp; }
export function getCamera()    { return camera;  }
// The camera is deliberately NOT a child of the scene, so walking up from it to
// find a root finds only the camera. Every scene-graph census in the QA harness
// did exactly that and had been counting zero meshes for months while reporting
// "no leak". Hand out the scene itself.
export function getScene()     { return scene;   }

export function onResize() {
    if (!camera || !renderer) return;
    const W = Math.max(window.innerWidth || 300, 300);
    const H = Math.max(window.innerHeight || 500, 500);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    renderer.setSize(W, H);
}

// ---- Main render loop ----

function startLoop() { requestAnimationFrame(_loop); }

function _loop() {
    requestAnimationFrame(_loop);
    if (!clock) return;
    const dt   = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    floatingIcons.forEach(f => {
        const grp = f.group || null;
        const ref = grp ? grp.position : f.mesh.position;
        f.mesh.position.y = (grp ? f.baseY : f.mesh.position.y = f.baseY) + Math.sin(time * f.speed + (f.phase || 0)) * 0.35;
        if (!grp) f.mesh.position.y = f.baseY + Math.sin(time * f.speed + (f.phase || 0)) * 0.35;
        f.mesh.rotation.y += 1.4 * dt * f.speed;
    });

    if (_cityLive.length) _animateCityLife(time, dt);

    // A BUDDY SPACE breathes, so it reads as live rather than painted on.
    if (_buddyPulse) {
        const b = (Math.sin(time * 2.2) + 1) * 0.5;
        _buddyPulse.pad.opacity = 0.20 + b * 0.16;
        _buddyPulse.rim.opacity = 0.62 + b * 0.32;
    }

    // The saucer keeps turning and its rim lights chase while it is on screen.
    if (_swapUfo && _swapUfo.visible) {
        _swapUfo.rotation.y += dt * 1.5;
        const lamps = _swapUfo.userData.lamps || [];
        lamps.forEach((l, i) => {
            const on = (Math.sin(time * 6 - i * 0.8) + 1) * 0.5;
            l.material.color.setRGB(0.35 + on * 0.3, 0.85 + on * 0.15, 1);
        });
    }

    Physics.step(dt);

    for (let i = activeAnims.length - 1; i >= 0; i--) {
        const a = activeAnims[i];
        a.t = (a.t || 0) + dt;
        const p    = a.dur > 0 ? Math.min(a.t / a.dur, 1) : 1;
        const ease = 1 - Math.pow(1 - p, 3);
        if (a.obj && a.to) {
            if (a.obj.isVector3) {
                a.obj.lerpVectors(a.start, a.to, ease);
                if (a.isHop) a.obj.y = a.to.y + Math.sin(p * Math.PI) * (a.hopH || 2.5);
            } else {
                for (const k in a.to) a.obj[k] = a.start[k] + (a.to[k] - a.start[k]) * ease;
            }
        }
        if (a.onUpdate) a.onUpdate(p);
        if (p >= 1) { activeAnims.splice(i, 1); if (a.onComplete) a.onComplete(); }
    }

    // Update ally follower positions
    state.players.forEach(p => { if (p.mesh) updateAllyPositions(p); });

    // Active player emissive glow — traverse only on turn change
    if (state.activePlayer !== _prevActivePlayer) {
        _prevActivePlayer = state.activePlayer;
        state.players.forEach((p, i) => {
            if (!p.mesh) return;
            const isActive = i === state.activePlayer;
            p.mesh.traverse(o => {
                if (o.isMesh && o.material && !o.material.isMeshBasicMaterial) {
                    o.material.emissive = new THREE.Color(isActive ? p.color : 0x000000);
                    o.material.emissiveIntensity = isActive ? 0.38 : 0;
                }
            });
        });
    }

    const cs = state.cameraState;
    if (cs === 'FOLLOW') {
        const p = state.players[state.activePlayer];
        if (p?.mesh?.position && camera) {
            const raw = _rawHeading(p);
            if (raw) {
                if (!_camFwdInit) { _camFwd.copy(raw); _camFwdInit = true; }
                else { _camFwd.lerp(raw, _damp(0.055, dt)); if (_camFwd.lengthSq() > 1e-6) _camFwd.normalize(); }
            }
            const { pos, look } = _followPose(p);
            if (!isNaN(pos.x)) {
                // Tokens do not only hop. A Swap space, a Rocket, an Anchor, the
                // Cabbie and a change of turn can all put the target on the far
                // side of the city in one frame, and easing across that is a long
                // disorienting drift whose first frames lurch. Past a distance no
                // ordinary hop can produce, cut instead — including the heading,
                // so the camera arrives already facing the right way.
                if (camera.position.distanceTo(pos) > CAM_CUT) {
                    if (raw) _camFwd.copy(raw);
                    const snapped = _followPose(p);
                    camera.position.copy(snapped.pos);
                    camera.lookAt(snapped.look);
                    look.copy(snapped.look);
                } else {
                    camera.position.lerp(pos, _damp(0.07, dt));
                }
            }
            _camHelper.position.copy(camera.position);
            _camHelper.lookAt(look);
            camera.quaternion.slerp(_camHelper.quaternion, _damp(0.09, dt));
        }
    } else if (cs === 'MAP') {
        const k = _damp(0.10, dt);
        camera.position.lerp(mapCam.targetPos, k);
        _camHelper.position.copy(camera.position);
        _camHelper.lookAt(mapCam.targetLook);
        camera.quaternion.slerp(_camHelper.quaternion, k);
    } else if (cs === 'GATE' && gateCam.active) {
        const k = _damp(0.075, dt);
        camera.position.lerp(gateCam.pos, k);
        _camHelper.position.copy(camera.position);
        _camHelper.lookAt(gateCam.look);
        camera.quaternion.slerp(_camHelper.quaternion, k);
    } else if (cs === 'JUNCTION' && junctionCam.active) {
        const k = _damp(0.085, dt);
        camera.position.lerp(junctionCam.pos, k);
        _camHelper.position.copy(camera.position);
        _camHelper.lookAt(junctionCam.look);
        camera.quaternion.slerp(_camHelper.quaternion, k);
    }

    if (renderer && scene && camera) renderer.render(scene, camera);
}

// ============================================================
// CITY CIRCUIT SCENE ENVIRONMENT
// ============================================================

let _cityEnvGroup = null;
let _CM = null; // city materials

function _initCityMaterials() {
    return {
        asphalt:    new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.95, metalness: 0.0 }),
        concrete:   new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.85 }),
        sidewalk:   new THREE.MeshStandardMaterial({ color: 0xb0a898, roughness: 0.80 }),
        grass:      new THREE.MeshStandardMaterial({ color: 0x3d8a28, roughness: 0.95 }),
        water:      new THREE.MeshPhysicalMaterial({ color: 0x3399cc, transparent: true, opacity: 0.72, roughness: 0.08, metalness: 0.2 }),
        treeTrunk:  new THREE.MeshStandardMaterial({ color: 0x5a3010, roughness: 0.9 }),
        treeLeaf:   new THREE.MeshStandardMaterial({ color: 0x2a7a18, roughness: 0.9 }),
        bench:      new THREE.MeshStandardMaterial({ color: 0x8a6030, roughness: 0.8 }),
        benchMetal: new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.7, roughness: 0.4 }),
        lampPole:   new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 }),
        lampGlow:   new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffff44, emissiveIntensity: 1.0 }),
        // Financial
        finGlass:   new THREE.MeshPhysicalMaterial({ color: 0x5588cc, emissive: 0x113366, emissiveIntensity: 0.08, metalness: 0.75, roughness: 0.08, transparent: true, opacity: 0.88 }),
        finFrame:   new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.5, metalness: 0.6 }),
        // Back Alley
        baBrick:    new THREE.MeshStandardMaterial({ color: 0x7a3020, roughness: 0.92 }),
        baBrickAlt: new THREE.MeshStandardMaterial({ color: 0x5a2010, roughness: 0.95 }),
        baMetal:    new THREE.MeshStandardMaterial({ color: 0x404040, roughness: 0.6, metalness: 0.5 }),
        // Shopping
        shopColors: [0xcc3388, 0x33aa55, 0x3377dd, 0xdd7700, 0x9933bb].map(c =>
            new THREE.MeshStandardMaterial({ color: c, roughness: 0.55 })),
        shopWindow: new THREE.MeshPhysicalMaterial({ color: 0xaaddff, transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.2 }),
        shopSign:   new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 }),
        // Industrial
        indWall:    new THREE.MeshStandardMaterial({ color: 0x9a8840, roughness: 0.88 }),
        indMetal:   new THREE.MeshStandardMaterial({ color: 0x556060, roughness: 0.5, metalness: 0.65 }),
        indDoor:    new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 }),
        // Ring road civic
        civicStone: new THREE.MeshStandardMaterial({ color: 0xccbba8, roughness: 0.82 }),
        civicAccent:new THREE.MeshStandardMaterial({ color: 0x8a6a40, roughness: 0.7 }),
    };
}

// Direction from origin outward through pos (XZ plane)
function _outwardDir(pos) {
    const d = new THREE.Vector3(pos.x, 0, pos.z);
    if (d.lengthSq() < 0.001) d.set(1, 0, 0);
    return d.normalize();
}

// Rotation so a building's +Z face points toward origin
function _facingAngle(pos) {
    return Math.atan2(-pos.x, -pos.z);
}

// ---- Ground ----

function _buildCityGround() {
    // Base asphalt disk
    const base = new THREE.Mesh(new THREE.CircleGeometry(130, 64), _CM.asphalt);
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.62;
    base.receiveShadow = true;
    _cityEnvGroup.add(base);

    // Center park (grass)
    const park = new THREE.Mesh(new THREE.CircleGeometry(20, 32), _CM.grass);
    park.rotation.x = -Math.PI / 2;
    park.position.y = -0.59;
    _cityEnvGroup.add(park);

    // Sidewalk ring around park
    const sw1 = new THREE.Mesh(new THREE.RingGeometry(20, 24, 64), _CM.sidewalk);
    sw1.rotation.x = -Math.PI / 2; sw1.position.y = -0.60;
    _cityEnvGroup.add(sw1);

    // Road ring (ring road band)
    const road1 = new THREE.Mesh(new THREE.RingGeometry(24, 42, 64), _CM.asphalt);
    road1.rotation.x = -Math.PI / 2; road1.position.y = -0.61;
    _cityEnvGroup.add(road1);

    // Sidewalk between ring and districts
    const sw2 = new THREE.Mesh(new THREE.RingGeometry(42, 50, 64), _CM.sidewalk);
    sw2.rotation.x = -Math.PI / 2; sw2.position.y = -0.60;
    _cityEnvGroup.add(sw2);

    // District road band
    const road2 = new THREE.Mesh(new THREE.RingGeometry(50, 72, 64), _CM.asphalt);
    road2.rotation.x = -Math.PI / 2; road2.position.y = -0.61;
    _cityEnvGroup.add(road2);

    // Outer sidewalk
    const sw3 = new THREE.Mesh(new THREE.RingGeometry(72, 82, 64), _CM.sidewalk);
    sw3.rotation.x = -Math.PI / 2; sw3.position.y = -0.60;
    _cityEnvGroup.add(sw3);

    // Road markings on ring road — dashed center line (white segments)
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const dashCount = 32;
    for (let i = 0; i < dashCount; i++) {
        const angle = (i / dashCount) * Math.PI * 2;
        const dashGeo = new THREE.PlaneGeometry(0.25, 2.5);
        const dash = new THREE.Mesh(dashGeo, dashMat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -angle;
        dash.position.set(Math.cos(angle) * 33, -0.58, Math.sin(angle) * 33);
        _cityEnvGroup.add(dash);
    }
}

// ---- Center plaza (fountain + park) ----

function _buildCityCenter() {
    // Raised platform
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.4, 32), _CM.concrete);
    platform.position.y = -0.38;
    _cityEnvGroup.add(platform);

    // Fountain basin wall
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 1.0, 32), _CM.concrete);
    basin.position.y = 0.28;
    _cityEnvGroup.add(basin);

    // Water surface
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.2, 32), _CM.water);
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.82;
    _cityEnvGroup.add(water);

    // Fountain column
    const colMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.5, roughness: 0.4 });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 3.5, 8), colMat);
    col.position.y = 2.35;
    _cityEnvGroup.add(col);

    // Water spray (translucent cone)
    const sprayMat = new THREE.MeshPhysicalMaterial({ color: 0x99ccff, transparent: true, opacity: 0.35, roughness: 0.1 });
    const spray = new THREE.Mesh(new THREE.ConeGeometry(1.0, 2.2, 16), sprayMat);
    spray.position.y = 5.1;
    _cityEnvGroup.add(spray);

    // Park trees (8 around perimeter)
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        _cityEnvGroup.add(_mkTree(new THREE.Vector3(Math.cos(a) * 14, 0, Math.sin(a) * 14)));
    }

    // Benches facing fountain
    for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        const bPos = new THREE.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 10);
        _cityEnvGroup.add(_mkBench(bPos, a + Math.PI));
    }
}

// ---- Street lamps ----

function _buildStreetLamps() {
    const ringNodeIds = ['r1','r2','r3','r4','r5','r6','r7','r8','r9','r10',
                         'r11','r12','r13','r14','r15','r16','r17','r18','r19','r20'];
    ringNodeIds.forEach((id, idx) => {
        if (idx % 2 !== 0) return; // every other node
        const pos = getPos(id).clone();
        const out = _outwardDir(pos);
        // Lamp on outer side of ring road
        const lPos = pos.clone().addScaledVector(out, 6);
        lPos.y = 0;
        _cityEnvGroup.add(_mkLampPost(lPos));
        // Lamp on inner side
        const lPos2 = pos.clone().addScaledVector(out, -6);
        lPos2.y = 0;
        _cityEnvGroup.add(_mkLampPost(lPos2));
    });
}

// ---- Small helpers ----

function _mkTree(pos) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6), _CM.treeTrunk);
    trunk.position.y = 1.1; trunk.castShadow = true;
    grp.add(trunk);
    const leaves = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), _CM.treeLeaf);
    leaves.position.y = 3.3; leaves.scale.y = 1.15; leaves.castShadow = true;
    grp.add(leaves);
    return grp;
}

function _mkBench(pos, rotY) {
    const grp = new THREE.Group();
    grp.position.copy(pos); grp.rotation.y = rotY;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.65), _CM.bench);
    seat.position.y = 0.72; grp.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.1), _CM.bench);
    back.position.set(0, 1.14, -0.27); grp.add(back);
    const legGeo = new THREE.BoxGeometry(0.14, 0.72, 0.65);
    [-0.8, 0.8].forEach(x => { const leg = new THREE.Mesh(legGeo, _CM.benchMetal); leg.position.set(x, 0.36, 0); grp.add(leg); });
    return grp;
}

function _mkLampPost(pos) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 8.5, 7), _CM.lampPole);
    pole.position.y = 4.25; pole.castShadow = true; grp.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6), _CM.lampPole);
    arm.rotation.z = Math.PI / 2; arm.position.set(1.1, 8.4, 0); grp.add(arm);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.55, 8), _CM.lampPole);
    head.position.set(2.1, 8.2, 0); grp.add(head);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), _CM.lampGlow);
    glow.position.set(2.1, 8.1, 0); grp.add(glow);
    return grp;
}

// ---- District buildings ----

function _mkSkyscraper(pos, isHQ) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const s = Math.abs(Math.round(pos.x * 7 + pos.z * 13)) % 100;
    const h  = isHQ ? 32 : 15 + (s % 8) * 2;
    const w  = isHQ ? 7  : 4 + (s % 3);
    const d  = isHQ ? 7  : 4 + ((s + 2) % 3);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _CM.finGlass);
    tower.position.y = h / 2; tower.castShadow = true; grp.add(tower);

    // Setback crown
    const crown = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, h * 0.28, d * 0.62), _CM.finGlass);
    crown.position.y = h + h * 0.14; grp.add(crown);

    // Spire
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.16, h * (isHQ ? 0.28 : 0.2), 6), _CM.finFrame);
    spire.position.y = h * (isHQ ? 1.46 : 1.38); grp.add(spire);

    // Horizontal window bands (frame strips)
    const bandCount = Math.floor(h / 3);
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, emissive: 0x223366, emissiveIntensity: 0.12, metalness: 0.8, roughness: 0.1 });
    for (let b = 1; b < bandCount; b++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.05, 0.12, d + 0.05), bandMat);
        band.position.y = b * 3; grp.add(band);
    }

    // LIT WINDOWS. Without these the Financial District is a dark canyon: the
    // towers are tall, they stand on both sides of a narrow road, and there is
    // no global illumination to bounce anything back down. A grid of emissive
    // panes is what makes a stylised glass tower read as an office tower rather
    // than as a black slab, and it is the only light the district gets at street
    // level from its own buildings.
    const lit  = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
    const cool = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
    const cols = Math.max(2, Math.round(w / 1.5));
    for (let b = 1; b < bandCount; b++) {
        for (let c = 0; c < cols; c++) {
            const r = _seeded(s * 3 + b * 11 + c * 7);
            if (r > 0.62) continue;                 // most panes are dark
            const pane = new THREE.Mesh(new THREE.PlaneGeometry(w / cols * 0.55, 1.5),
                                        r > 0.34 ? cool : lit);
            pane.position.set(-w / 2 + (c + 0.5) * (w / cols), b * 3 - 1.4, d / 2 + 0.03);
            grp.add(pane);
            // And the same on the back face, so a tower reads from both sides.
            const back = pane.clone();
            back.position.z = -d / 2 - 0.03; back.rotation.y = Math.PI;
            grp.add(back);
        }
    }
    // A red aircraft light on the taller ones.
    if (h > 22) {
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), lampMat);
        lamp.position.y = h * (isHQ ? 1.62 : 1.5); grp.add(lamp);
        _cityLive.push({ kind: 'beacon', mat: lampMat, seed: s });
    }

    return grp;
}

// Lit-window grid shared by the brick and factory builders. A district lit only
// from above reads as a set; windows are what make it read as a place with
// people in it.
function _addLitWindows(grp, w, h, d, seed, warm = 0xffd07a, chance = 0.45) {
    const lit = new THREE.MeshBasicMaterial({ color: warm });
    const dark = new THREE.MeshBasicMaterial({ color: 0x141821 });
    const cols = Math.max(2, Math.round(w / 1.8));
    const rows = Math.max(1, Math.floor(h / 3));
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const on = _seeded(seed * 5 + r * 13 + c * 3) < chance;
            const pane = new THREE.Mesh(new THREE.PlaneGeometry(w / cols * 0.5, 1.2),
                                        on ? lit : dark);
            pane.position.set(-w / 2 + (c + 0.5) * (w / cols), 2.0 + r * 3, d / 2 + 0.04);
            grp.add(pane);
        }
    }
}

function _mkBrickBuilding(pos, isHQ) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const s = Math.abs(Math.round(pos.x * 5 + pos.z * 11)) % 100;
    const h = isHQ ? 14 : 6 + (s % 6);
    const w = isHQ ? 9  : 5 + (s % 4);
    const d = isHQ ? 7  : 4 + (s % 3);

    const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), s % 2 === 0 ? _CM.baBrick : _CM.baBrickAlt);
    main.position.y = h / 2; main.castShadow = true; grp.add(main);

    // Flat roof parapet
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5), _CM.baBrickAlt);
    parapet.position.y = h + 0.25; grp.add(parapet);

    // Water tower (~every other)
    if (s % 2 === 0 || isHQ) {
        const tkMat = new THREE.MeshStandardMaterial({ color: 0x5a3010, roughness: 0.9 });
        const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.8, 8), tkMat);
        tk.position.y = h + 2.3; grp.add(tk);
        const tkRoof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.9, 8), _CM.baMetal);
        tkRoof.position.y = h + 3.65; grp.add(tkRoof);
        const legGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.8, 4);
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
            const leg = new THREE.Mesh(legGeo, _CM.baMetal);
            leg.position.set(Math.cos(a) * 0.7, h + 1.3, Math.sin(a) * 0.7); grp.add(leg);
        }
    }

    // Fire escape (side ladder)
    if (s % 3 === 0) {
        const escGrp = new THREE.Group();
        escGrp.position.set(w / 2 + 0.06, 0, 0);
        const rGeo = new THREE.BoxGeometry(0.07, h - 0.5, 0.07);
        [[-0.55, h/2, 0],[0.55, h/2, 0]].forEach(([x,y,z]) => {
            const r = new THREE.Mesh(rGeo, _CM.baMetal); r.position.set(x,y,z); escGrp.add(r);
        });
        for (let rr = 1; rr < h - 0.5; rr += 1.1) {
            const rung = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), _CM.baMetal);
            rung.position.set(0, rr, 0); escGrp.add(rung);
        }
        grp.add(escGrp);
    }

    _addLitWindows(grp, w, h, d, Math.abs(Math.round(pos.x * 5 + pos.z * 11)) % 100, 0xffc46a, 0.4);

    return grp;
}

function _mkShopBuilding(pos, colorIdx, isHQ) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const s = Math.abs(Math.round(pos.x * 3 + pos.z * 9)) % 100;
    const ci  = colorIdx !== undefined ? colorIdx : s % _CM.shopColors.length;
    const mat = _CM.shopColors[ci];
    const h = isHQ ? 12 : 5 + (s % 5);
    const w = isHQ ? 10 : 6 + (s % 4);
    const d = isHQ ? 6  : 4 + (s % 2);

    const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    main.position.y = h / 2; main.castShadow = true; grp.add(main);

    // Display window
    const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.68, h * 0.44, 0.13), _CM.shopWindow);
    win.position.set(0, h * 0.3, d / 2 + 0.07); grp.add(win);

    // Awning
    const awningMat = new THREE.MeshStandardMaterial({ color: mat.color, roughness: 0.55, emissive: mat.color, emissiveIntensity: 0.18 });
    const awning = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.14, 1.8), awningMat);
    awning.rotation.x = -0.28; awning.position.set(0, h * 0.56, d / 2 + 0.8); grp.add(awning);

    // Sign
    const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, 0.75, 0.12), _CM.shopSign);
    sign.position.set(0, h * 0.76, d / 2 + 0.07); grp.add(sign);

    // Dome for mall HQ
    if (isHQ) {
        const domeMat = new THREE.MeshPhysicalMaterial({ color: 0xaaddff, transparent: true, opacity: 0.5, roughness: 0.05, metalness: 0.3 });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(3.5, 16, 8, 0, Math.PI*2, 0, Math.PI/2), domeMat);
        dome.position.set(0, h, 0); grp.add(dome);
    }

    return grp;
}

function _mkFactory(pos, isHQ) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const s = Math.abs(Math.round(pos.x * 11 + pos.z * 7)) % 100;
    const h = isHQ ? 10 : 6 + (s % 5);
    const w = isHQ ? 14 : 8 + (s % 6);
    const d = isHQ ? 8  : 6 + (s % 3);

    // Main warehouse body
    const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _CM.indWall);
    main.position.y = h / 2; main.castShadow = true; grp.add(main);

    // Corrugated roof (slight triangular ridge)
    const roofGeo = new THREE.CylinderGeometry(0, w * 0.52, h * 0.2, 3);
    const roof = new THREE.Mesh(roofGeo, _CM.indMetal);
    roof.position.y = h + h * 0.1; roof.rotation.y = Math.PI / 6; grp.add(roof);

    // Smokestacks
    const numStacks = isHQ ? 3 : 1 + (s % 2);
    for (let i = 0; i < numStacks; i++) {
        const sx = (i - (numStacks - 1) / 2) * 2.8;
        const sh = h * (isHQ ? 0.9 : 0.75);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.5, sh, 8), _CM.indMetal);
        stack.position.set(sx, h + sh / 2, 0); stack.castShadow = true; grp.add(stack);
        // Smoke cap ring
        const capMat = new THREE.MeshStandardMaterial({ color: 0x998888, transparent: true, opacity: 0.5 });
        const cap = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.18, 6, 12), capMat);
        cap.position.set(sx, h + sh, 0); cap.rotation.x = Math.PI / 2; grp.add(cap);
    }

    // Loading dock
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.2, 0.14), _CM.indDoor);
    door.position.set(0, 1.6, d / 2 + 0.08); grp.add(door);
    // Door frame
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.6 });
    const frameH = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, 0.14), frameMat);
    frameH.position.set(0, 3.3, d / 2 + 0.09); grp.add(frameH);

    return grp;
}

function _mkCivicBuilding(pos) {
    const grp = new THREE.Group();
    grp.position.copy(pos);
    const s = Math.abs(Math.round(pos.x * 7 + pos.z * 3)) % 100;

    // 1-in-4 chance: tree instead of building
    if (s % 4 === 0) { return _mkTree(pos); }

    const h = 8 + (s % 6);
    const w = 5 + (s % 3);
    const d = 5 + (s % 2);

    const main = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), _CM.civicStone);
    main.position.y = h / 2; main.castShadow = true; grp.add(main);

    // Columns on front face
    const pilGeo = new THREE.CylinderGeometry(0.19, 0.22, h * 0.72, 8);
    for (let p = -1; p <= 1; p++) {
        const pil = new THREE.Mesh(pilGeo, _CM.civicAccent);
        pil.position.set(p * (w / 3.2), h * 0.36, d / 2 + 0.25); grp.add(pil);
    }

    // Pediment
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0, w * 0.52, h * 0.22, 3), _CM.civicStone);
    ped.position.y = h + h * 0.11; ped.rotation.y = Math.PI / 6; grp.add(ped);

    return grp;
}

// ---- Background skyline ----

function _buildBackgroundSkyline() {
    const count = 30;
    const districtMats = { fin: _CM.finGlass, ba: _CM.baBrick, shop: _CM.shopColors[0], ind: _CM.indWall };
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const r = 88 + (i % 4) * 7;
        const pos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        const h = 8 + (i % 10) * 3.5;
        const w = 5 + (i % 5);
        const d = 5 + (i % 3);
        // assign district by quadrant
        const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
        let mat;
        if (deg < 90)       mat = districtMats.fin;
        else if (deg < 180) mat = districtMats.ba;
        else if (deg < 270) mat = districtMats.shop;
        else                mat = districtMats.ind;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.copy(pos); mesh.position.y = h / 2;
        _cityEnvGroup.add(mesh);
    }
}

// ---- Per-node building placement ----

function _buildAllDistrictBuildings() {
    const boardData = state.board;
    Object.keys(CITY_GRAPH).forEach(nodeId => {
        if (JUNCTION_IDS.has(nodeId)) return;
        const graphNode = CITY_GRAPH[nodeId];
        const district  = graphNode?.district || 'ring';
        const spaceType = boardData[nodeId]?.type;
        const isHQ      = spaceType === 'hq';
        const pos       = getPos(nodeId).clone();

        const outDir = _outwardDir(pos);
        // Ring road: push inward (toward center); districts: push outward
        const offset = district === 'ring' ? -10 : 12;
        const bPos = pos.clone().addScaledVector(outDir, offset);
        bPos.y = 0;

        let building;
        switch (district) {
            case 'fin':  building = _mkSkyscraper(bPos, isHQ); break;
            case 'ba':   building = _mkBrickBuilding(bPos, isHQ); break;
            case 'shop': building = _mkShopBuilding(bPos, undefined, isHQ); break;
            case 'ind':  building = _mkFactory(bPos, isHQ); break;
            case 'ring': building = _mkCivicBuilding(bPos); break;
            default:     return;
        }

        if (building) {
            building.rotation.y = _facingAngle(pos);
            _cityEnvGroup.add(building);
        }
    });

    _buildBackgroundSkyline();
}

// ---- Main entry ----

function _buildCityScene() {
    if (_cityEnvGroup) { scene.remove(_cityEnvGroup); _cityEnvGroup = null; }
    // Every animated prop holds a material reference. Rebuilding without
    // clearing these would keep ticking materials belonging to a disposed
    // scene — the same class of leak removeAllyMarker() once had.
    _cityLive.length = 0;
    _CM = _initCityMaterials();
    _cityEnvGroup = new THREE.Group();
    // Named so a probe can tell the CITY from the BOARD: tiles, tile icons and
    // player tokens all legitimately stand on a node, and the dressing must not.
    _cityEnvGroup.name = 'cityEnv';
    scene.add(_cityEnvGroup);

    _buildCityGround();
    _buildCityCenter();
    _buildAllDistrictBuildings();
    _buildStreetLamps();
    _buildDistrictSurfaces();
    _buildDistrictDressing();
    _buildDistrictLandmarks();
    _buildDistrictLights();
    _buildOverheads();
    _buildDistrictMotes();
}

// ---- 4. Light ----
//
// The single biggest reason the districts read as one road: there was one light
// rig for the whole city, ambient turned up to 1.2, and every surface came back
// the same flat value. Colour lived only in the sky gradient, which you cannot
// see from a follow camera aimed at the ground.
//
// Each district now has its own lamp hung over the middle of its arc, in its own
// colour, plus an optional warm bounce at street height — the Exchange's tickers,
// the alley's neon, the furnace glow. Four point lights and four bounces is
// nothing next to the shadow-casting sun that was already there.
function _buildDistrictLights() {
    Object.keys(DISTRICT_BIOMES).forEach(key => {
        const cfg = DISTRICT_BIOMES[key].light;
        if (!cfg || !cfg.intensity) return;
        const nodes = _districtNodes(key);
        if (!nodes.length) return;
        // Two lamps for a long district, one for a short one, so the far end of
        // the Back Alley is not left in the dark.
        const picks = nodes.length >= 9
            ? [nodes[Math.floor(nodes.length * 0.28)], nodes[Math.floor(nodes.length * 0.72)]]
            : [nodes[Math.floor(nodes.length / 2)]];
        picks.forEach(id => {
            const at = getPos(id).clone().setY(0);
            const lamp = new THREE.PointLight(cfg.color, cfg.intensity / picks.length,
                                              cfg.radius, 1.8);
            lamp.position.set(at.x, cfg.height, at.z);
            _cityEnvGroup.add(lamp);
            if (cfg.bounce) {
                const b = new THREE.PointLight(cfg.bounce, cfg.bounceI / picks.length,
                                               cfg.radius * 0.55, 2.0);
                b.position.set(at.x, 2.4, at.z);
                _cityEnvGroup.add(b);
            }
        });
    });
}

// ---- 5. Overhead structures ----
//
// The one element that makes a road feel like a PLACE rather than a surface:
// something you pass underneath. Every district gets a span across its road at
// two points along its length, and each span is the district's own story told in
// one object — a stock board, a washing line under dead neon, a bunting arch, a
// pipe bridge.
function _buildOverheads() {
    const SPAN = { fin: _spanTickerArch, ba: _spanLaundry, shop: _spanBunting,
                   ind: _spanPipeBridge, ring: _spanGantrySign };
    Object.keys(SPAN).forEach(key => {
        const nodes = _districtNodes(key);
        if (nodes.length < 3) return;
        const at = key === 'ring'
            ? [nodes[3], nodes[11]]
            : [nodes[1], nodes[Math.max(2, nodes.length - 2)]];
        at.forEach((id, i) => {
            if (!id) return;
            const pos = getPos(id).clone().setY(0);
            const g = SPAN[key](i);
            if (!g) return;
            g.position.copy(pos);
            // +PI/2 against the building convention. _facingAngle() rotates so
            // local +Z points at the city centre, which is what a BUILDING wants
            // — it faces the road. A SPAN has to straddle the road, so its legs
            // belong on the inward/outward axis: without the quarter turn the
            // legs stood on the tiles ahead of and behind the node and the deck
            // ran along the road instead of over it. The quarter turn also puts
            // every sign face down the road, where an approaching player sees it.
            g.rotation.y = _facingAngle(pos) + Math.PI / 2;
            g.traverse(o => { if (o.isMesh) o.castShadow = true; });
            _cityEnvGroup.add(g);
        });
    });
}

// A pair of legs either side of the road, at ±SPAN_HALF, with a deck across.
const SPAN_HALF = 7.4;

function _spanLegs(g, mat, height, thick = 0.55) {
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(thick, height, thick), mat);
        leg.position.set(x, height / 2, 0);
        g.add(leg);
    });
}

function _spanTickerArch(i) {                    // Financial: the boards overhead
    const g = new THREE.Group();
    const steel = _dressMat(0xb8c2cf, { rough: 0.35, metal: 0.7 });
    _spanLegs(g, steel, 8.4, 0.6);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.2, 0.5, 1.0), steel);
    deck.position.y = 8.4; g.add(deck);
    const face = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2, 1.9, 0.28),
        _dressMat(0x080d16, { rough: 0.45 }));
    face.position.set(0, 7.2, 0.62); g.add(face);
    const bars = [];
    for (let k = 0; k < 16; k++) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 1.1),
            new THREE.MeshBasicMaterial({ color: 0x22c55e }));
        bar.position.set(-SPAN_HALF + 0.75 + k * 0.94, 7.2, 0.78);
        g.add(bar); bars.push(bar);
    }
    _cityLive.push({ kind: 'ticker', bars, seed: 90 + i * 5 });
    // A gold band under the deck picks the district's colour out at night.
    const band = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.2, 0.16, 1.02),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));
    band.position.y = 8.1; g.add(band);
    return g;
}

function _spanLaundry(i) {                       // Back Alley: lines and dead neon
    const g = new THREE.Group();
    const brick = _dressMat(0x4a2018, { rough: 0.95 });
    // Two tenement walls right at the kerb, so the alley is enclosed.
    [-1, 1].forEach(sgn => {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(1.4, 13, 11), brick);
        wall.position.set(sgn * (SPAN_HALF + 0.7), 6.5, 0); g.add(wall);
        // Fire escape: three landings and their rails.
        for (let f = 0; f < 3; f++) {
            const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 3.2),
                _dressMat(0x2c2c2c, { rough: 0.6, metal: 0.55 }));
            deck.position.set(sgn * (SPAN_HALF - 0.6), 3.4 + f * 3.1, 0); g.add(deck);
            const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 3.2),
                _dressMat(0x2c2c2c, { rough: 0.6, metal: 0.55 }));
            rail.position.set(sgn * (SPAN_HALF - 1.3), 3.9 + f * 3.1, 0); g.add(rail);
        }
        // Lit window squares up the wall — the cheapest "people live here".
        for (let w = 0; w < 5; w++) {
            const lit = _seeded(i * 13 + w + (sgn > 0 ? 7 : 0)) > 0.45;
            const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1),
                new THREE.MeshBasicMaterial({ color: lit ? 0xffd88a : 0x14171f }));
            win.position.set(sgn * (SPAN_HALF - 0.05), 4.5 + w * 1.9, -3.4 + (w % 2) * 6.8);
            win.rotation.y = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
            g.add(win);
        }
    });
    // Three washing lines across, sagging.
    const rope = _dressMat(0x1e1e1e, { rough: 1 });
    [7.2, 9.6, 11.4].forEach((y, li) => {
        const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, SPAN_HALF * 2, 5), rope);
        line.rotation.z = Math.PI / 2;
        line.position.set(0, y, -2 + li * 2); g.add(line);
        for (let k = 0; k < 7; k++) {
            const t = (k + 0.5) / 7;
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.4),
                _dressMat([0xf1f5f9, 0x60a5fa, 0xfbbf24, 0xf87171, 0x86efac][(k + li) % 5], { rough: 0.9 }));
            cloth.material.side = THREE.DoubleSide;
            cloth.position.set(-SPAN_HALF + t * SPAN_HALF * 2,
                               y - 0.8 - Math.sin(t * Math.PI) * 0.5, -2 + li * 2);
            g.add(cloth);
        }
    });
    // A dead neon sign hanging over the middle of the road.
    const col = [0xff2d78, 0x35e0ff, 0xa855f7][i % 3];
    const signMat = new THREE.MeshBasicMaterial({ color: col });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.5, 0.22), signMat);
    sign.position.set(0, 5.6, 1.2); g.add(sign);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });
    for (let k = 0; k < 3; k++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 6, 14), tubeMat);
        t.position.set(-1.3 + k * 1.3, 4.2, 1.2); g.add(t);
    }
    _cityLive.push({ kind: 'neon', parts: [signMat, tubeMat], seed: 30 + i * 3 });
    return g;
}

function _spanBunting(i) {                       // Promenade: the parade arch
    const g = new THREE.Group();
    const pole = _dressMat(0xf5eaf8, { rough: 0.5 });
    _spanLegs(g, pole, 7.6, 0.4);
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        const finial = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
            _dressMat(0xfbbf24, { rough: 0.3, metal: 0.6 }));
        finial.position.set(x, 8.0, 0); g.add(finial);
    });
    // Three swags of bunting at different depths, each a catenary of triangles.
    const cols = [0xef4444, 0xfbbf24, 0x22c55e, 0x3b82f6, 0xf472b6];
    [0, 1, 2].forEach(row => {
        for (let k = 0; k < 13; k++) {
            const t = k / 12;
            const flag = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 3),
                _dressMat(cols[(k + row) % 5], { rough: 0.65 }));
            flag.position.set(-SPAN_HALF + t * SPAN_HALF * 2,
                              7.2 - Math.sin(t * Math.PI) * 1.7 - row * 0.15,
                              -2.2 + row * 2.2);
            flag.rotation.x = Math.PI;
            g.add(flag);
        }
    });
    // A banner across the top.
    const banner = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 1.5, 1.5, 0.2),
        _dressMat(0xf472b6, { rough: 0.6, emissive: 0xd6337f, ei: 0.35 }));
    banner.position.set(0, 8.3, 0); g.add(banner);
    // Balloon cluster tied to one leg.
    const side = i % 2 ? 1 : -1;
    for (let k = 0; k < 6; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8),
            _dressMat(cols[k % 5], { rough: 0.35 }));
        b.scale.y = 1.2;
        b.position.set(side * (SPAN_HALF - 0.9) + (_seeded(i * 9 + k) - 0.5) * 1.4,
                       5.6 + _seeded(i * 5 + k) * 1.5,
                       (_seeded(i * 3 + k) - 0.5) * 1.4);
        g.add(b);
    }
    return g;
}

function _spanPipeBridge(i) {                    // Industrial: the works overhead
    const g = new THREE.Group();
    const steel = _dressMat(0x6d7268, { rough: 0.55, metal: 0.6 });
    _spanLegs(g, steel, 7.0, 0.75);
    // Lattice deck.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.5, 0.4, 2.6), steel);
    deck.position.y = 7.0; g.add(deck);
    for (let k = 0; k < 9; k++) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), steel);
        brace.position.set(-SPAN_HALF + k * (SPAN_HALF * 2 / 8), 6.3, 0);
        brace.rotation.z = (k % 2 ? 1 : -1) * 0.7; g.add(brace);
    }
    // Three pipes running the span, one of them painted hazard orange.
    [[-0.8, 0x8a8f7a], [0, 0xb45309], [0.8, 0x7e8478]].forEach(([z, c], k) => {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, SPAN_HALF * 2 + 1.5, 10),
            _dressMat(c, { rough: 0.6, metal: 0.45 }));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(0, 7.9 + (k === 1 ? 0.1 : 0), z * 1.5); g.add(pipe);
    });
    // Floodlights aimed down at the road.
    [-1, 1].forEach(sgn => {
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), steel);
        head.position.set(sgn * (SPAN_HALF - 1.6), 6.6, 1.6);
        head.rotation.x = 0.5; g.add(head);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.5),
            new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
        glow.position.set(sgn * (SPAN_HALF - 1.6), 6.35, 1.9);
        glow.rotation.x = -1.1; g.add(glow);
    });
    // Hazard chevrons on the legs.
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        for (let k = 0; k < 3; k++) {
            const ch = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.8),
                _dressMat(k % 2 ? 0x111111 : 0xfacc15, { rough: 0.8 }));
            ch.position.set(x, 0.5 + k * 0.34, 0); g.add(ch);
        }
    });
    return g;
}

function _spanGantrySign(i) {                    // Ring road: motorway signage
    const g = new THREE.Group();
    const steel = _dressMat(0x9aa3ad, { rough: 0.4, metal: 0.65 });
    _spanLegs(g, steel, 6.6, 0.42);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.0, 0.32, 0.42), steel);
    beam.position.y = 6.6; g.add(beam);
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.0, 0.22),
        _dressMat(0x1b5e2a, { rough: 0.7 }));
    board.position.set(0, 5.4, 0.35); g.add(board);
    [0, 1].forEach(r => {
        const line = new THREE.Mesh(new THREE.PlaneGeometry(4.4 - r * 1.4, 0.3),
            new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }));
        line.position.set(-0.4 + r * 0.5, 5.8 - r * 0.75, 0.48); g.add(line);
    });
    return g;
}

// ---- 6. Ambient particles ----
//
// Gold motes over the Exchange, embers off the alley's barrel fires, confetti
// falling on the Promenade, sparks rising from the Works. Twenty-odd sprites per
// district, drifting on a seeded loop — the layer that stops a district reading
// as a still life.
function _buildDistrictMotes() {
    Object.keys(DISTRICT_BIOMES).forEach(key => {
        const cfg = DISTRICT_BIOMES[key].motes;
        if (!cfg) return;
        const nodes = _districtNodes(key);
        if (!nodes.length) return;
        const centre = nodes.reduce((a, id) => a.add(getPos(id)), new THREE.Vector3())
            .divideScalar(nodes.length).setY(0);
        const mat = new THREE.MeshBasicMaterial({
            color: cfg.color, transparent: true, opacity: 0.75, depthWrite: false });
        const geo = new THREE.PlaneGeometry(cfg.size, cfg.size);
        const parts = [];
        for (let i = 0; i < cfg.count; i++) {
            const m = new THREE.Mesh(geo, mat.clone());
            m.position.set(
                centre.x + (_seeded(i * 3 + key.length) - 0.5) * cfg.spread * 2,
                1 + _seeded(i * 7) * 10,
                centre.z + (_seeded(i * 11 + 2) - 0.5) * cfg.spread * 2);
            _cityEnvGroup.add(m);
            parts.push({ m, base: m.position.clone(), phase: _seeded(i * 13) });
        }
        _cityLive.push({ kind: 'motes', parts, rise: cfg.rise, seed: key.length });
    });
}

// ============================================================
// DISTRICT DRESSING — four places, not one road under four skies
// ============================================================
//
// Each district had exactly one thing of its own: a building type set back
// twelve units from the road. Everything at street level — the ground, the
// lamps, the props — was identical everywhere, so the districts differed only
// in the colour of the sky and the shape of a distant silhouette. Choosing a
// road was choosing a tint.
//
// Three layers go on top, all inside _cityEnvGroup so cleanup() still frees
// them in one go:
//
//   1. SURFACES  — the ground under each district arc is that district's own
//                  material: polished granite, wet cracked asphalt, patterned
//                  paving, hazard-striped concrete.
//   2. DRESSING  — roadside props, two per node, drawn from a per-district set
//                  and placed on alternating sides with a deterministic seed so
//                  a district looks the same every match but not repetitive.
//   3. LANDMARKS — one big silhouette per district, at its midpoint, readable
//                  from the map view and from the opening flyover.
//
// Budget: props are boxes and cylinders at 6–8 segments. The dressing adds
// roughly 350 meshes across 60 nodes, against ~750 already in the scene.

// Deterministic pseudo-random, so a district is identical every match.
function _seeded(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// Nodes of a district, in lap order.
function _districtNodes(key) {
    return ALL_NODES_ORDERED.filter(id => CITY_GRAPH[id]?.district === key);
}

function _dressMat(color, opts = {}) {
    return new THREE.MeshStandardMaterial({
        color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0,
        emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 0,
        transparent: !!opts.opacity, opacity: opts.opacity ?? 1,
    });
}

// ---- 1. Ground under each district ----
//
// A flat patch per node, laid just above the base disc, oriented along the
// road. Cheaper and far more controllable than re-texturing the ring bands,
// and it means the surface follows the road rather than a perfect annulus.
function _buildDistrictSurfaces() {
    const SURF = {
        granite:  { col: 0x3c4250, rough: 0.35, metal: 0.25, seam: 0xa9b6c8 },
        wet:      { col: 0x22252b, rough: 0.28, metal: 0.15, seam: 0x4d5460 },
        paving:   { col: 0x6f5f88, rough: 0.8,  metal: 0,    seam: 0xd8c4ea },
        concrete: { col: 0x6f6a5e, rough: 0.92, metal: 0,    seam: 0xd9b23a },
    };
    ['fin', 'ba', 'shop', 'ind'].forEach(key => {
        const cfg = SURF[DISTRICT_BIOMES[key]?.surface];
        if (!cfg) return;
        const mat = _dressMat(cfg.col, { rough: cfg.rough, metal: cfg.metal });
        const seamMat = _dressMat(cfg.seam, { rough: 0.6, opacity: 0.5 });
        _districtNodes(key).forEach((id, i) => {
            const pos = getPos(id).clone().setY(0);
            const ang = _facingAngle(pos);
            const slab = new THREE.Mesh(new THREE.PlaneGeometry(16, 13), mat);
            slab.rotation.x = -Math.PI / 2;
            slab.rotation.z = -ang;
            slab.position.set(pos.x, -0.55, pos.z);
            slab.receiveShadow = true;
            _cityEnvGroup.add(slab);
            // One seam line per slab, so the surface reads as laid rather than
            // painted. Hazard chevrons in Industrial, joints everywhere else.
            const seams = key === 'ind' ? 3 : 1;
            for (let s = 0; s < seams; s++) {
                const line = new THREE.Mesh(
                    new THREE.PlaneGeometry(key === 'ind' ? 1.1 : 0.35, 12),
                    seamMat);
                line.rotation.x = -Math.PI / 2;
                line.rotation.z = -ang;
                const off = new THREE.Vector3(Math.cos(ang), 0, -Math.sin(ang))
                    .multiplyScalar((s - (seams - 1) / 2) * 3.4);
                line.position.set(pos.x + off.x, -0.54, pos.z + off.z);
                _cityEnvGroup.add(line);
            }
            // Back Alley puddles: dark glossy discs that catch the key light.
            if (key === 'ba' && _seeded(i * 7 + 3) > 0.45) {
                const puddle = new THREE.Mesh(
                    new THREE.CircleGeometry(1.1 + _seeded(i * 11) * 1.3, 14),
                    new THREE.MeshPhysicalMaterial({ color: 0x141a22, roughness: 0.05,
                        metalness: 0.5, transparent: true, opacity: 0.85 }));
                puddle.rotation.x = -Math.PI / 2;
                const out = _outwardDir(pos).multiplyScalar(2.4 + _seeded(i * 5) * 2.6);
                puddle.position.set(pos.x + out.x, -0.53, pos.z + out.z);
                _cityEnvGroup.add(puddle);
            }
        });
    });
}

// ---- 2. Roadside props ----

function _buildDistrictDressing() {
    const MAKER = { finance: _propFinance, alley: _propAlley, market: _propMarket,
                    works: _propWorks, civic: _propCivic };
    Object.keys(DISTRICT_BIOMES).forEach(key => {
        const make = MAKER[DISTRICT_BIOMES[key].props];
        if (!make) return;
        _districtNodes(key).forEach((id, i) => {
            const pos = getPos(id).clone().setY(0);
            const out = _outwardDir(pos);
            const ang = _facingAngle(pos);
            // Two props per node, one each side of the road. The ring already
            // carries lamps on both sides, so it gets one and further out.
            const sides = key === 'ring' ? [1] : [1, -1];
            sides.forEach((s, k) => {
                const r = _seeded(i * 31 + k * 7 + key.length * 13);
                if (r > 0.86) return;                       // gaps, so it is not a fence
                const dist = (key === 'ring' ? 9 : 6.2) + _seeded(i * 17 + k) * 1.6;
                const p = pos.clone().addScaledVector(out, s * dist);
                const g = make(r, i * 3 + k);
                if (!g) return;
                g.position.copy(p).setY(0);
                g.rotation.y = ang + (s < 0 ? Math.PI : 0) + (_seeded(i + k) - 0.5) * 0.5;
                g.traverse(o => { if (o.isMesh) o.castShadow = true; });
                _cityEnvGroup.add(g);
            });
        });
    });
}

// Financial: planters, bollard rows, and a live stock ticker.
function _propFinance(r, seed) {
    const g = new THREE.Group();
    if (r < 0.34) {                                    // stone planter with a hedge
        const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 1.2), _dressMat(0xbfc6d1, { rough: 0.7 }));
        box.position.y = 0.45; g.add(box);
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.95), _dressMat(0x2f6b32, { rough: 0.95 }));
        hedge.position.y = 1.2; g.add(hedge);
    } else if (r < 0.66) {                             // bollard row
        for (let i = 0; i < 4; i++) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 8),
                _dressMat(0xd8dee8, { rough: 0.4, metal: 0.6 }));
            b.position.set((i - 1.5) * 0.95, 0.5, 0); g.add(b);
        }
    } else {                                            // ticker board
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 3.0, 8),
            _dressMat(0x5b6472, { rough: 0.4, metal: 0.7 }));
        post.position.y = 1.5; g.add(post);
        const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.95, 0.22), _dressMat(0x0b1220, { rough: 0.5 }));
        board.position.y = 3.1; g.add(board);
        const bars = [];
        for (let i = 0; i < 7; i++) {
            const up = _seeded(seed * 5 + i) > 0.45;
            const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5),
                new THREE.MeshBasicMaterial({ color: up ? 0x22c55e : 0xef4444 }));
            bar.position.set(-1.3 + i * 0.44, 3.1, 0.13);
            g.add(bar); bars.push(bar);
        }
        _cityLive.push({ kind: 'ticker', bars, seed });
    }
    return g;
}

// Back Alley: dumpsters, crate stacks, steam vents, flickering neon.
function _propAlley(r, seed) {
    const g = new THREE.Group();
    if (r < 0.3) {                                      // dumpster
        const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.3), _dressMat(0x2f5f3a, { rough: 0.8 }));
        body.position.y = 0.7; g.add(body);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 1.4), _dressMat(0x24482d, { rough: 0.8 }));
        lid.position.set(0, 1.5, -0.1); lid.rotation.x = -0.25; g.add(lid);
    } else if (r < 0.55) {                              // crates and a barrel
        for (let i = 0; i < 3; i++) {
            const s = 0.7 + _seeded(seed + i) * 0.4;
            const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), _dressMat(0x8a6a3c, { rough: 0.95 }));
            c.position.set((i - 1) * 0.85, s / 2 + (i === 1 ? 0.75 : 0), _seeded(seed * 3 + i) * 0.5);
            c.rotation.y = _seeded(seed + i * 2) * 0.7; g.add(c);
        }
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 10),
            _dressMat(0x7a3b22, { rough: 0.85 }));
        barrel.position.set(1.5, 0.55, 0.2); g.add(barrel);
    } else if (r < 0.72) {                              // steam vent
        const grate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.14, 12),
            _dressMat(0x3a3a3a, { rough: 0.7, metal: 0.5 }));
        grate.position.y = 0.07; g.add(grate);
        const puffs = [];
        for (let i = 0; i < 4; i++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xd8dde5, transparent: true,
                    opacity: 0.0, depthWrite: false }));
            puff.position.y = 0.3; g.add(puff); puffs.push(puff);
        }
        _cityLive.push({ kind: 'steam', puffs, seed, rise: 4.5, spread: 0.5 });
    } else {                                            // neon sign on a bracket
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.4), _dressMat(0x333333, { rough: 0.6, metal: 0.5 }));
        arm.position.set(0, 3.0, 0.7); g.add(arm);
        const col = [0xff2d78, 0x2ddcff, 0xffd12d, 0x8b5cf6][Math.floor(_seeded(seed * 9) * 4)];
        const tube = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 6, 18),
            new THREE.MeshBasicMaterial({ color: col }));
        tube.position.set(0, 2.8, 1.4); g.add(tube);
        const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.13, 0.13),
            new THREE.MeshBasicMaterial({ color: col }));
        bar.position.set(0, 2.8, 1.4); g.add(bar);
        _cityLive.push({ kind: 'neon', parts: [tube.material, bar.material], seed });
    }
    return g;
}

// Promenade: market stalls, kiosks, planters, sandwich boards.
function _propMarket(r, seed) {
    const g = new THREE.Group();
    const stripe = [0xef4444, 0x22c55e, 0x3b82f6, 0xf59e0b][Math.floor(_seeded(seed * 3) * 4)];
    if (r < 0.5) {                                      // stall with a striped awning
        for (let i = 0; i < 4; i++) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.0, 6),
                _dressMat(0xd6d3d1, { rough: 0.6, metal: 0.3 }));
            leg.position.set(i < 2 ? -1.1 : 1.1, 1.0, i % 2 ? -0.7 : 0.7); g.add(leg);
        }
        const table = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.12, 1.6), _dressMat(0xa1854f, { rough: 0.9 }));
        table.position.y = 1.0; g.add(table);
        // Awning: two sloped panels in the stall's colour and white.
        [-1, 1].forEach(s => {
            const panel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.05),
                _dressMat(s > 0 ? stripe : 0xf8fafc, { rough: 0.7 }));
            panel.position.set(0, 2.25, s * 0.5);
            panel.rotation.x = s * 0.42; g.add(panel);
        });
        // Goods on the table.
        for (let i = 0; i < 3; i++) {
            const b = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6),
                _dressMat([0xef4444, 0xfbbf24, 0x22c55e][i], { rough: 0.7 }));
            b.position.set(-0.7 + i * 0.7, 1.2, 0); g.add(b);
        }
    } else if (r < 0.75) {                              // kiosk
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 2.4, 10),
            _dressMat(0xe8e2ee, { rough: 0.7 }));
        body.position.y = 1.2; g.add(body);
        const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 10), _dressMat(stripe, { rough: 0.7 }));
        roof.position.y = 2.8; g.add(roof);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7),
            _dressMat(0xffffff, { rough: 0.5, emissive: 0xffffff, ei: 0.25 }));
        board.position.set(0, 1.6, 1.02); g.add(board);
    } else {                                            // planter + sandwich board
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.45, 0.8, 10),
            _dressMat(0xb08968, { rough: 0.9 }));
        pot.position.y = 0.4; g.add(pot);
        const bush = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), _dressMat(0x2f6b32, { rough: 0.95 }));
        bush.position.y = 1.25; bush.scale.y = 1.15; g.add(bush);
        [-1, 1].forEach(s => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.06), _dressMat(0x6b4f2a, { rough: 0.9 }));
            p.position.set(1.6, 0.65, s * 0.16); p.rotation.x = s * 0.22; g.add(p);
        });
    }
    return g;
}

// Industrial: pipe runs, containers, cones, and a smoking stack.
function _propWorks(r, seed) {
    const g = new THREE.Group();
    if (r < 0.32) {                                     // pipe run on trestles
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.2, 10),
            _dressMat(0x8a8f7a, { rough: 0.6, metal: 0.5 }));
        pipe.rotation.z = Math.PI / 2; pipe.position.y = 1.35; g.add(pipe);
        [-1.9, 1.9].forEach(x => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.35, 0.2), _dressMat(0x5c6157, { rough: 0.7, metal: 0.4 }));
            leg.position.set(x, 0.68, 0); g.add(leg);
        });
        const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.2, 10),
            _dressMat(0xb45309, { rough: 0.6, metal: 0.4 }));
        flange.rotation.z = Math.PI / 2; flange.position.y = 1.35; g.add(flange);
    } else if (r < 0.6) {                               // cargo containers
        const cols = [0xb45309, 0x1d4ed8, 0x15803d, 0x991b1b];
        for (let i = 0; i < 2; i++) {
            const c = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.5, 1.5),
                _dressMat(cols[Math.floor(_seeded(seed * 3 + i) * 4)], { rough: 0.85, metal: 0.2 }));
            c.position.set(_seeded(seed + i) * 0.5, 0.75 + i * 1.55, 0);
            c.rotation.y = (_seeded(seed * 7 + i) - 0.5) * 0.25; g.add(c);
        }
    } else if (r < 0.78) {                              // hazard cones and a barrier
        for (let i = 0; i < 3; i++) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.85, 8), _dressMat(0xf97316, { rough: 0.8 }));
            cone.position.set((i - 1) * 1.1, 0.42, _seeded(seed + i) * 0.4); g.add(cone);
            const band = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.14, 8), _dressMat(0xf8fafc, { rough: 0.7 }));
            band.position.copy(cone.position).setY(0.52); g.add(band);
        }
    } else {                                            // smoking stack
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.78, 5.2, 12),
            _dressMat(0x8a8070, { rough: 0.9 }));
        stack.position.y = 2.6; g.add(stack);
        [1.5, 3.2, 4.6].forEach(y => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.09, 6, 14), _dressMat(0x59544a, { rough: 0.8 }));
            ring.position.y = y; ring.rotation.x = Math.PI / 2; g.add(ring);
        });
        const puffs = [];
        for (let i = 0; i < 5; i++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xc9ccd2, transparent: true, opacity: 0, depthWrite: false }));
            puff.position.y = 5.2; g.add(puff); puffs.push(puff);
        }
        _cityLive.push({ kind: 'steam', puffs, seed, rise: 7.0, base: 5.2, spread: 1.1 });
    }
    return g;
}

// Ring road: the civic baseline — hedges, benches, parked cars, crossings.
function _propCivic(r, seed) {
    const g = new THREE.Group();
    if (r < 0.4) {                                      // hedge run
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.0, 1.0), _dressMat(0x2f6b32, { rough: 0.95 }));
        hedge.position.y = 0.5; g.add(hedge);
    } else if (r < 0.72) {                              // parked car
        const cols = [0xdc2626, 0x2563eb, 0xf8fafc, 0x111827, 0x16a34a];
        const col = cols[Math.floor(_seeded(seed * 5) * 5)];
        const body = new THREE.Mesh(_roundedBox(3.9, 1.0, 1.7, 0.32, 4), _dressMat(col, { rough: 0.35, metal: 0.35 }));
        body.position.y = 0.78; g.add(body);
        const cabin = new THREE.Mesh(_roundedBox(2.0, 0.8, 1.5, 0.3, 4),
            _dressMat(0x93c5fd, { rough: 0.15, metal: 0.2, opacity: 0.85 }));
        cabin.position.set(-0.25, 1.5, 0); g.add(cabin);
        [[-1.3, 0.65], [1.3, 0.65], [-1.3, -0.65], [1.3, -0.65]].forEach(([x, z]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10), _dressMat(0x1c1c1c, { rough: 0.9 }));
            w.rotation.x = Math.PI / 2; w.position.set(x, 0.38, z); g.add(w);
        });
    } else {                                            // bench and a bin
        g.add(_mkBench(new THREE.Vector3(0, 0, 0), 0));
        const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.9, 10),
            _dressMat(0x4b5563, { rough: 0.7, metal: 0.3 }));
        bin.position.set(1.7, 0.45, 0); g.add(bin);
    }
    return g;
}

// ---- 3. One landmark per district ----
//
// Placed at the district's midpoint and set well back, so it reads as the thing
// the district is named after from the flyover and from the map view.
function _buildDistrictLandmarks() {
    const BUILD = { fin: _lmExchange, ba: _lmNeonArch, shop: _lmArcade, ind: _lmCoolingTowers };
    Object.keys(BUILD).forEach(key => {
        const nodes = _districtNodes(key);
        if (!nodes.length) return;
        const mid = getPos(nodes[Math.floor(nodes.length / 2)]).clone().setY(0);
        const g = BUILD[key]();
        if (!g) return;
        g.position.copy(mid).addScaledVector(_outwardDir(mid), 30).setY(0);
        g.rotation.y = _facingAngle(mid);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        _cityEnvGroup.add(g);
    });
}

function _lmExchange() {                                 // colonnaded exchange
    const g = new THREE.Group();
    const stone = _dressMat(0xd7d2c6, { rough: 0.75 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(22, 2, 13), stone);
    base.position.y = 1; g.add(base);
    const body = new THREE.Mesh(new THREE.BoxGeometry(19, 11, 11), stone);
    body.position.y = 7.5; g.add(body);
    for (let i = 0; i < 7; i++) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 11, 12), stone);
        col.position.set(-8.4 + i * 2.8, 7.5, 6.2); g.add(col);
    }
    const ped = new THREE.Mesh(new THREE.ConeGeometry(11.5, 3.6, 4), stone);
    ped.position.y = 14.6; ped.rotation.y = Math.PI / 4; g.add(ped);
    // A gold arrow over the pediment: the district's own emblem.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 4),
        _dressMat(0xfbbf24, { rough: 0.3, metal: 0.7, emissive: 0xb45309, ei: 0.4 }));
    arrow.position.y = 18.4; arrow.rotation.y = Math.PI / 4; g.add(arrow);
    return g;
}

function _lmNeonArch() {                                 // market gate over the alley
    const g = new THREE.Group();
    const brick = _dressMat(0x5a2417, { rough: 0.95 });
    [-6.5, 6.5].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 12, 2.2), brick);
        leg.position.set(x, 6, 0); g.add(leg);
    });
    const span = new THREE.Mesh(new THREE.BoxGeometry(15, 2.4, 2.2), brick);
    span.position.y = 13.2; g.add(span);
    const signMat = new THREE.MeshBasicMaterial({ color: 0xff2d78 });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(11, 2.6, 0.3), signMat);
    sign.position.set(0, 13.2, 1.3); g.add(sign);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0x2ddcff });
    for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.11, 6, 16), tubeMat);
        t.position.set(-4 + i * 2, 10.6, 1.3); g.add(t);
    }
    // Washing lines strung between the legs — the detail that says "lived in".
    const line = _dressMat(0x2a2a2a, { rough: 1 });
    [8.6, 6.4].forEach((y, li) => {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 13, 5), line);
        rope.rotation.z = Math.PI / 2; rope.position.set(0, y, li ? 1.2 : -1.2); g.add(rope);
        for (let i = 0; i < 6; i++) {
            const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3),
                _dressMat([0xf8fafc, 0x60a5fa, 0xfbbf24, 0xf87171][i % 4],
                          { rough: 0.9, opacity: 0.95 }));
            cloth.material.side = THREE.DoubleSide;
            cloth.position.set(-5 + i * 2, y - 0.75, li ? 1.2 : -1.2); g.add(cloth);
        }
    });
    _cityLive.push({ kind: 'neon', parts: [signMat, tubeMat], seed: 4 });
    return g;
}

function _lmArcade() {                                   // glass arcade with bunting
    const g = new THREE.Group();
    const frame = _dressMat(0xf2e9f7, { rough: 0.5 });
    [-8, 8].forEach(x => {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12, 10), frame);
        w.position.set(x, 6, 0); g.add(w);
    });
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 10, 20, 1, true, 0, Math.PI),
        new THREE.MeshPhysicalMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.42,
            roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide }));
    glass.rotation.z = Math.PI / 2; glass.rotation.y = Math.PI / 2;
    glass.position.y = 12; g.add(glass);
    for (let i = 0; i < 6; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(8.4, 0.16, 6, 18, Math.PI), frame);
        rib.position.set(0, 12, -4.6 + i * 1.85); g.add(rib);
    }
    // Bunting between the two piers.
    for (let i = 0; i < 11; i++) {
        const flag = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.9, 3),
            _dressMat([0xef4444, 0xfbbf24, 0x22c55e, 0x3b82f6][i % 4], { rough: 0.7 }));
        const t = i / 10;
        flag.position.set(-7.5 + t * 15, 13.2 - Math.sin(t * Math.PI) * 1.8, 5.4);
        flag.rotation.x = Math.PI; g.add(flag);
    }
    return g;
}

function _lmCoolingTowers() {                            // the power plant
    const g = new THREE.Group();
    const shell = _dressMat(0x9c968a, { rough: 0.92 });
    [-7.5, 7.5].forEach((x, i) => {
        const pts = [];
        for (let s = 0; s <= 10; s++) {
            const t = s / 10;
            const rr = 5.4 - Math.sin(t * Math.PI) * 2.2 + t * 1.1;
            pts.push(new THREE.Vector2(rr, t * 18));
        }
        const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 18), shell);
        tower.position.set(x, 0, i ? 2.5 : -2.5); g.add(tower);
        const puffs = [];
        for (let k = 0; k < 4; k++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(3.0, 10, 8),
                new THREE.MeshBasicMaterial({ color: 0xdfe3e8, transparent: true, opacity: 0, depthWrite: false }));
            puff.position.set(x, 18, i ? 2.5 : -2.5); g.add(puff); puffs.push(puff);
        }
        _cityLive.push({ kind: 'steam', puffs, seed: 20 + i * 3, rise: 13, base: 18,
                         spread: 2.2, x, z: i ? 2.5 : -2.5 });
    });
    // A red aircraft beacon on a gantry between them.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 22, 8),
        _dressMat(0x6b6f66, { rough: 0.6, metal: 0.5 }));
    mast.position.y = 11; g.add(mast);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), lampMat);
    lamp.position.y = 22.4; g.add(lamp);
    _cityLive.push({ kind: 'beacon', mat: lampMat, seed: 1 });
    return g;
}

// ---- Motion ----
//
// Four cheap systems, all driven from _loop(). A city that never moves reads as
// a diorama; these are what make it read as a place with something going on.
const _cityLive = [];

function _animateCityLife(time, dt) {
    for (let i = 0; i < _cityLive.length; i++) {
        const e = _cityLive[i];
        if (e.kind === 'steam') {
            // Puffs march up on staggered phases, fading as they rise.
            const base = e.base ?? 0.3;
            e.puffs.forEach((p, k) => {
                const t = ((time * 0.32 + k / e.puffs.length + _seeded(e.seed + k)) % 1);
                p.position.y = base + t * e.rise;
                p.position.x = (e.x ?? 0) + Math.sin(t * 3 + k) * e.spread * t;
                p.position.z = (e.z ?? 0) + Math.cos(t * 2.2 + k) * e.spread * t;
                p.scale.setScalar(0.5 + t * 1.4);
                p.material.opacity = Math.sin(t * Math.PI) * 0.34;
            });
        } else if (e.kind === 'neon') {
            // Dead tubes: mostly lit, with an occasional stutter.
            const n = _seeded(Math.floor(time * 9) + e.seed);
            const on = n > 0.12 ? 1 : 0.15;
            e.parts.forEach(m => { m.opacity = on; m.transparent = on < 1; });
        } else if (e.kind === 'ticker') {
            // Bars step every ~0.9 s, so the board is always saying something.
            const step = Math.floor(time / 0.9);
            e.bars.forEach((bar, k) => {
                const v = _seeded(step + e.seed * 3 + k * 11);
                bar.scale.y = 0.4 + v * 1.3;
                bar.material.color.setHex(v > 0.45 ? 0x22c55e : 0xef4444);
            });
        } else if (e.kind === 'motes') {
            // Drift on a loop, always facing the camera so a flat plane reads as
            // a speck of light from any angle.
            e.parts.forEach((p, k) => {
                const t = (time * 0.09 * (e.rise >= 0 ? 1 : -1) + p.phase) % 1;
                const u = t < 0 ? t + 1 : t;
                p.m.position.y = p.base.y + (u - 0.5) * Math.abs(e.rise) * 12;
                p.m.position.x = p.base.x + Math.sin(time * 0.3 + k) * 1.6;
                p.m.position.z = p.base.z + Math.cos(time * 0.24 + k * 1.3) * 1.6;
                p.m.material.opacity = 0.15 + Math.sin(u * Math.PI) * 0.6;
                if (camera) p.m.quaternion.copy(camera.quaternion);
            });
        } else if (e.kind === 'beacon') {
            const b = (Math.sin(time * 2.4) + 1) * 0.5;
            e.mat.color.setRGB(1, 0.15 + b * 0.1, 0.1 + b * 0.08);
        }
    }
}

export function cleanup() {
    if (_cityEnvGroup) { scene?.remove(_cityEnvGroup); _cityEnvGroup = null; }
    _cityLive.length = 0;
    if (_CM) { Object.values(_CM).forEach(m => { try { m.dispose?.(); } catch(e){} }); _CM = null; }
    Object.values(textureCache).forEach(t => t.dispose());
    Object.keys(textureCache).forEach(k => delete textureCache[k]);
    tileMeshes.forEach(m => _disposeTree(m));
    tileMeshes.length = 0;
    _tileIcons.forEach(e => { if (!e.group) _disposeTree(e.mesh); });
    _tileIcons.length = 0;
    floatingIcons.length = 0;
    activeAnims.length = 0;
    if (renderer) { renderer.dispose(); renderer = null; }
}
