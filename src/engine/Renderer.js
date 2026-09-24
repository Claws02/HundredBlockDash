// ============================================================
// RENDERER — Three.js scene, city circuit + hundred block dash
// ============================================================

import { state } from '../core/GameState.js';
import { SPACE_META, DISTRICT_BIOMES, getBiomeForDistrict, HBD_BIOMES, getBiomeForSpace, ALLIES, CHAR_ICONS, HBD_DEFAULT_CONFIG } from '../config/GameConfig.js';
import { SCENE } from '../config/SceneTiming.js';
import * as Physics from './Physics.js';
import { sfx } from './AudioManager.js';   // set pieces cue their own sound
import * as ActiveMap from '../config/ActiveMap.js';
import * as Stars from '../core/Stars.js';

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

// Board layout is DATA now, declared by the map module and laid out here.
// This function used to write City's ring (R=32) and district arcs (R=58)
// straight into the module-level map, which meant the renderer knew one graph
// board's geometry by heart and a second one had nowhere to go.
// Exported so the layout can be built and inspected WITHOUT standing up a whole
// scene. It is a pure function of the map module's layout table, and
// qa/mapmodules.js compares its output against the geometry that used to be
// hardcoded here — which it can only do if it can run it on its own.
export function buildLayout() { buildNodePositions(); return nodePositions; }

// One point on a district's lobe. `t` runs 0 at the leaving junction to 1 at
// the arriving one, so t=0 and t=1 are the tucked-in ends and t=0.5 is the far
// point of the bow. The nodes sit strictly between the ends; the ground builder
// samples the whole span including them, which is why this takes a raw `t`
// rather than a node index.
function _lobePoint(run, t, pow) {
    const [a, b] = run.deg;
    const rad = (a + (b - a) * t) * Math.PI / 180;
    const [near, far] = run.lobe;
    const r = near + (far - near) * Math.pow(Math.sin(Math.PI * t), pow);
    return new THREE.Vector3(r * Math.cos(rad), 0, -r * Math.sin(rad));
}

/**
 * A district lobe, sampled end to end.
 *
 * The road under a district has to be the same curve the tiles sit on, or the
 * board looks like squares scattered near a road rather than a street with
 * buildings along it. The old ground was a RingGeometry that happened to be
 * wide enough to cover four quadrants of tiles; nothing tied the two together.
 * Exported so _buildCityGround draws from the same source the layout does.
 */
export function lobeSamples(run, n = 40) {
    const L = ActiveMap.layout() || {};
    const pow = L.lobePow || 1.3;
    const out = [];
    for (let i = 0; i <= n; i++) out.push(_lobePoint(run, i / n, pow));
    return out;
}

/** The district runs of the active map, or [] on a board that has none. */
export function districtRuns() {
    const L = ActiveMap.layout();
    return (L && L.kind === 'city_arcs' && Array.isArray(L.arcs)) ? L.arcs : [];
}

// ---- The Clover (Star Territory) ----------------------------------------
//
// A hub ring with four circular lobes hanging off it, each tangent-ish to the
// ring at its junction's angle. City's lobes are ARCS bowing off a band; these
// are whole CIRCLES the road runs all the way around, which is what makes a
// territory a detour you come back out of rather than a parallel route.
//
// The spec (§2) explains why they are circles: the first draft drew teardrops,
// and the two sides of a teardrop run 2–6 units apart at every parameter tried
// — against a 16×13 tile, the roads overlap. A circle has no such neck and its
// node spacing is uniform by construction.
function _deg(d) { return d * Math.PI / 180; }

function _onCircle(cx, cz, r, deg) {
    const a = _deg(deg);
    return new THREE.Vector3(cx + r * Math.cos(a), 0, cz - r * Math.sin(a));
}

/** Where a lobe's centre sits: straight out along its junction's angle. */
function _lobeCentre(L, jnDeg) {
    const a = _deg(jnDeg);
    return { x: L.LOBE_C * Math.cos(a), z: -L.LOBE_C * Math.sin(a) };
}

/**
 * One point on a lobe, by node index — including fractional indices, which is
 * how the ground ribbon samples the road between the tiles.
 */
export function cloverLobePoint(L, jnDeg, i) {
    const c = _lobeCentre(L, jnDeg);
    return _onCircle(c.x, c.z, L.LOBE_R, jnDeg + L.lobeStartDeg + i * L.lobeStepDeg);
}

/** The lobe runs of a clover board, or [] on any other. */
export function cloverLobes() {
    const L = ActiveMap.layout();
    return (L && L.kind === 'clover' && Array.isArray(L.lobes)) ? L.lobes : [];
}

function _buildCloverPositions(L) {
    // The hub ring: twelve nodes at a constant radius, h1 at the top.
    (L.hub.ids || []).forEach((id, i) => {
        nodePositions.set(id, _onCircle(0, 0, L.HUB_R, L.hub.startDeg + i * L.hub.stepDeg));
    });
    // The junctions sit ON the hub ring, halfway between the two hub nodes they
    // separate. Nobody ever stands on one, but the token WALKS THROUGH it on a
    // route choice, so its position has to be a real point on the road.
    for (const [id, deg] of Object.entries(L.junctions || {})) {
        nodePositions.set(id, _onCircle(0, 0, L.HUB_R, deg));
    }
    for (const lobe of (L.lobes || [])) {
        const jnDeg = L.junctions[lobe.jn];
        lobe.ids.forEach((id, i) => nodePositions.set(id, cloverLobePoint(L, jnDeg, i)));
    }
}

function buildNodePositions() {
    nodePositions.clear();
    const L = ActiveMap.layout();
    if (L && L.kind === 'clover') { _buildCloverPositions(L); return; }
    if (!L || L.kind !== 'city_arcs') return;
    const radius = { R: L.R, DR: L.DR };
    const pow = L.lobePow || 1.3;

    for (const [id, [rx, rz]] of Object.entries(L.junctions || {})) {
        nodePositions.set(id, new THREE.Vector3(rx * L.R, 0, rz * L.R));
    }
    // The ring is a plain arc at a constant radius — it is the one part of the
    // board that is still a circle, and it is the centre road.
    for (const run of (L.ring || [])) {
        const [startDeg, endDeg, count, radiusKey, ...ids] = run;
        const pts = _arcPts(startDeg, endDeg, count, radius[radiusKey]);
        ids.forEach((id, i) => nodePositions.set(id, pts[i]));
    }
    // The districts bow away from it. `count` is not carried in the data: the
    // id list IS the count, and two places to say the same number is two places
    // for them to disagree.
    for (const run of (L.arcs || [])) {
        const n = run.ids.length;
        run.ids.forEach((id, i) => nodePositions.set(id, _lobePoint(run, (i + 1) / (n + 1), pow)));
    }
}

export function getPos(nodeId) {
    if (typeof nodeId === 'number') return hbdPositions[Math.max(0, Math.min(nodeId, _hbdMax))] || new THREE.Vector3();
    return nodePositions.get(nodeId) || new THREE.Vector3(0, 0, 0);
}

// Camera reference curve — loop following ActiveMap.ordered() for smooth interpolation
let _camCurve;
let _camCurveLen;

function buildCamCurve() {
    const pts = ActiveMap.ordered().map(id => getPos(id).clone().setY(0));
    pts.push(pts[0].clone()); // close the loop
    _camCurve = new THREE.CatmullRomCurve3(pts, true);
    _camCurveLen = ActiveMap.ordered().length;
}

export function getNodeT(nodeId) {
    if (typeof nodeId === 'number') return nodeId / _hbdMax;
    const idx = ActiveMap.ordered().indexOf(nodeId);
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
    const isHBD = ActiveMap.isLinear();

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
    // City fog is LINEAR, not exponential, and the difference is the whole point.
    //
    // 0.003 exponential barely touched the far skyline — the towers at the rim
    // came back as saturated as the ones you are standing next to, so the city
    // read as a flat sticker rather than as somewhere with distance in it. But
    // winding the density up to fix that fogged the middle of the board as
    // well, and the map view and the opening flyover both look at the board
    // from 170+ units out: the whole city came back as milk.
    //
    // Exponential fog cannot separate those two cases, because it starts at the
    // camera. Linear fog can: nothing inside 150 units is touched at all, which
    // covers the follow camera and everything near it, and the fade runs out to
    // 460 where the rim of the ground disc dissolves into the horizon.
    //
    // The range is deliberately wide. A first pass at 110–330 looked right from
    // the street and turned the MAP view — the shot a player uses to decide
    // which district to run — into milk, because that camera sits 200+ units up
    // and fog is measured from the camera, not from the ground. The skyline's
    // sense of distance is carried by its muted colours instead (see
    // _buildBackgroundSkyline); fog only has to supply the air between.
    //
    // HBD keeps the exponential haze its realms were tuned against.
    scene.fog = isHBD
        ? new THREE.FogExp2(0x0f380f, 0.005)
        : new THREE.Fog(0xbfe0f5, 150, 460);

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

    // THE SKY IS THE BIOME'S, FROM THE FIRST FRAME.
    //
    // `#bg-gradient` is what you actually see behind the board — the canvas is
    // rendered with `alpha: true` and has no background of its own — and it was
    // left on the SPLASH SCREEN's purple until the first turn began, because
    // nothing called updateBiomeVisuals until startPreRoll. So the map select,
    // the whole opening flyover and the city briefing — a player's first sight
    // of City Circuit — showed a bright midday city standing in a nightclub
    // void, with the scene's pale blue fog fading the far towers toward a
    // colour that was nowhere on the screen.
    updateBiomeVisuals(isHBD ? 0 : 'ring');

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

    // One smoothed tube per ROAD, coloured by the region it belongs to. The runs
    // used to be this function's own hardcoded list of City node ids, so a
    // second graph board would have drawn City's roads on top of its own tiles.
    // They are declared on the map module now (`LAYOUT.roads`).
    ActiveMap.roads().forEach(({ nodes, district }) => {
        const pts = nodes.map(id => getPos(id).clone().setY(-0.3));
        if (pts.length < 2) return;
        const curve = new THREE.CatmullRomCurve3(pts);
        const tint  = (DISTRICT_BIOMES[district] || DISTRICT_BIOMES.ring).pathTint;
        const geo   = new THREE.TubeGeometry(curve, pts.length * 3, 1.2, 6, false);
        const mat   = new THREE.MeshStandardMaterial({
            color: tint, emissive: tint, transparent: true, opacity: 0.14, roughness: 0.9,
        });
        const mesh  = new THREE.Mesh(geo, mat);
        boardGrp.add(mesh);
        _pathTubes.push(mesh);
    });

    // Junction sphere markers — every fork this board has, not City's four.
    [...ActiveMap.junctions()].forEach(id => {
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
        if (ActiveMap.isJunction(nodeId)) return;
        const graphNode = ActiveMap.graph()[nodeId];
        const isGate    = b.type === 'gate';
        const spc       = SPACE_META[b.type] || SPACE_META.coin;
        const bInfo     = DISTRICT_BIOMES[graphNode?.district || 'ring'];
        const label     = b.type === 'player_trap' ? 'TOLL' : (isGate && state.gateOpen ? 'OPEN' : null);
        const tex       = _getCachedTileTexture(spc, bInfo, label, b);

        let emColor = spc.e;
        if (isGate) emColor = state.gateOpen ? 0x22c55e : 0xb45309;
        if (b.type === 'player_trap') emColor = state.players[b.owner]?.color ?? 0xf97316;
        if (b.type === 'hq') emColor = 0xa37810;
        // A LIT OFFICE MEANS THE STAR IS HERE. The Offices are identical
        // furniture and only one of them matters at a time, so the empty three
        // are deliberately dull and the live one burns — it is the cheapest
        // version of "its location is never hidden" and it works from the
        // flyover, where no HUD is on screen.
        if (b.type === 'plinth') emColor = Stars.isLiveOffice(nodeId) ? 0xb45309 : 0x33302a;

        const baseMat  = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.22, metalness: 0.18, clearcoat: 0.45, clearcoatRoughness: 0.2, emissive: emColor, emissiveIntensity: 0.55 });
        const baseMesh = new THREE.Mesh(_hexGeo, baseMat);
        baseMesh.receiveShadow = true; baseMesh.castShadow = true;
        const pos = getPos(nodeId);
        baseMesh.position.copy(pos);
        // Orient tile to face next node
        const nextId = ActiveMap.nextNode(nodeId);
        if (nextId) baseMesh.lookAt(getPos(nextId).clone().setY(0));
        baseMesh.userData = { nodeId };
        tileMeshes.push(baseMesh);
        boardGrp.add(baseMesh);

        if (isGate) _buildGateMesh(nodeId, pos);
        else if (b.type === 'plinth') _buildPlinthMesh(nodeId, pos, graphNode?.district);
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

    const nextId  = ActiveMap.graph()[nodeId]?.next?.[0];
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

/**
 * A TERRITORY OFFICE — the plinth, its case, and the Star if it is here.
 *
 * Deliberately NOT a variant of the HQ mesh. An HQ is a building that pays you
 * for walking past it and looks the same every lap; a plinth is a pedestal that
 * is either holding the only thing worth points on this board or standing
 * empty, and those two states have to be tellable apart across a whole board.
 * So: stone base and a glass case always, and the Star only when it is here.
 */
function _buildPlinthMesh(nodeId, pos, district) {
    const grp = new THREE.Group();
    grp.position.copy(pos); grp.position.y = 0;
    const live = Stars.isLiveOffice(nodeId);

    const stone = new THREE.MeshStandardMaterial({ color: 0xbdae92, roughness: 0.82 });
    const step  = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.6, 0.45, 12), stone);
    step.position.y = 0.22; step.receiveShadow = true; grp.add(step);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 2.4, 12), stone);
    column.position.y = 1.6; column.castShadow = true; grp.add(column);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.1, 0.35, 12), stone);
    cap.position.y = 2.95; grp.add(cap);

    // The case. Glass either way — an empty case is what tells you the Star has
    // been and gone rather than that there was never one here.
    const glass = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 2.2, 12, 1, true),
        new THREE.MeshPhysicalMaterial({
            color: live ? 0xfff0c2 : 0xaab2bd, transparent: true,
            opacity: live ? 0.24 : 0.13, roughness: 0.05, metalness: 0.2,
            side: THREE.DoubleSide, depthWrite: false }));
    glass.position.y = 4.2; grp.add(glass);
    const brass = new THREE.MeshStandardMaterial({
        color: live ? 0xd6a441 : 0x6b6558, roughness: 0.35, metalness: 0.8 });
    [3.1, 5.3].forEach(y => {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(1.06, 0.07, 6, 16), brass);
        hoop.rotation.x = Math.PI / 2; hoop.position.y = y; grp.add(hoop);
    });

    if (live) {
        const star = _mkSheriffStar(1.0);
        star.position.y = 4.2;
        grp.add(star);
        _pushTileIcon({ mesh: star, baseY: 4.2, speed: 1.0, phase: 0, group: grp });
        // A shaft up out of the case, so the live Office is findable from the
        // far side of the board without opening the map.
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(1.0, 0.5, 11, 14, 1, true),
            new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.1,
                side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        shaft.position.y = 9.5; grp.add(shaft);
    }

    grp.userData = { nodeId, type: '_plinth' };
    boardGrp.add(grp); tileMeshes.push(grp);
}

/**
 * A five-pointed sheriff's star, built as a proper star rather than as two
 * crossed boxes — this is the object the board is named after and the one thing
 * every set piece on it moves, so it is worth ten vertices of its own.
 */
export function _mkSheriffStar(scale = 1) {
    const shape = new THREE.Shape();
    const R = 1.15 * scale, r = 0.48 * scale;
    for (let i = 0; i < 10; i++) {
        const rad = (i % 2 ? r : R);
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.16 * scale, bevelEnabled: true,
        bevelThickness: 0.05 * scale, bevelSize: 0.06 * scale, bevelSegments: 2 });
    geo.center();
    const mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0xfde68a, emissive: 0xf59e0b, emissiveIntensity: 1.5,
        metalness: 0.85, roughness: 0.18, clearcoat: 0.6 }));
    mesh.castShadow = true;
    // The balls on the points — the detail that makes it a SHERIFF'S star and
    // not a gold star sticker.
    const ballMat = new THREE.MeshPhysicalMaterial({
        color: 0xfff3c4, emissive: 0xfbbf24, emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.1 });
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.13 * scale, 8, 6), ballMat);
        b.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        mesh.add(b);
    }
    return mesh;
}

function _buildShopMesh(nodeId, pos, district) {
    const shopGrp = new THREE.Group();
    const nextId  = ActiveMap.graph()[nodeId]?.next?.[0];
    const nextPos = nextId ? getPos(nextId) : pos.clone().add(new THREE.Vector3(1, 0, 0));
    const tangent = new THREE.Vector3().subVectors(nextPos, pos).normalize();
    const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    shopGrp.position.copy(pos).addScaledVector(right, 3.2); shopGrp.position.y = 0;
    shopGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const colors = { fin: 0x3b82f6, ba: 0xef4444, shop: 0xec4899, ind: 0xeab308, ring: 0xa855f7,
                     hub: 0xb45309, rail: 0x60a5fa, mine: 0xf97316, ranch: 0x84cc16, bad: 0xfbbf24 };
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
    // Tagged so a minigame rig can find them and make them blink and look.
    // The board never reads the tag.
    const eyes = (y, z, r, spread) => {
        [[spread, -1], [-spread, 1]].forEach(([x, look]) => {
            const e = _eyeball(x, y, z, r, look);
            e.userData.eye = true;
            group.add(e);
        });
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

    contact.userData.contact = true;

    group.traverse(o => {
        if (!o.isMesh || o === contact) return;
        o.castShadow = true; o.receiveShadow = true;
    });
    // What CharacterRig needs to re-parent the parts into something it can
    // animate. The board ignores this.
    group.userData.charType = type;
    return group;
}

// Small material factory used by the figures above for their non-body parts.
function _mkMat(color, rough = 0.42, metal = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

// Where a seat's token stands relative to the centre of its tile.
//
// Two seats keep the exact left/right offsets the game shipped with — every
// camera probe and every screenshot in qa/ is framed around them, and a
// gratuitous change would invalidate all of it for no gain. Three and four
// spread around a small ring instead: four tokens on one lateral line overlap
// on a tile this size, and a token you cannot see is a token you cannot follow.
//
// `unit` is the board's own idea of "one token to the side" — 0.7 along the
// linear track, 1.2 on a city block.
export function seatOffset(seatId, unit) {
    const n = state.players.length;
    if (n <= 2) return { lat: seatId === 0 ? -unit : unit, fwd: 0 };
    const r = unit * 1.35;
    const a = (Math.PI * 2 * seatId) / n - Math.PI / 2;
    return { lat: Math.cos(a) * r, fwd: Math.sin(a) * r };
}

function buildPlayerMeshes() {
    const isHBD = ActiveMap.isLinear();
    state.players.forEach(p => {
        p.mesh = createCharacterMesh(p.charType, p.color);
        if (isHBD) {
            const idx = typeof p.pos === 'number' ? p.pos : 0;
            const pos = getPos(idx).clone();
            const tangent = boardCurve.getTangent(Math.max(0, Math.min(1, idx / _hbdMax)));
            const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
            const off = seatOffset(p.id, 0.7);
            pos.addScaledVector(right, off.lat).addScaledVector(tangent, off.fwd);
            p.mesh.position.set(pos.x, 0, pos.z);
        } else {
            const pos = getPos(p.pos || 'r1').clone();
            const off = seatOffset(p.id, 1.2);
            pos.x += off.lat; pos.z += off.fwd;
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
    // Three stops, not two. The bottom one is the biome's FOG colour, which is
    // by definition what distance fades to — so the horizon the board's rim
    // dissolves into is the same colour as the sky directly above it, and the
    // board stops reading as a disc cut out and pasted on. With two stops the
    // fog faded towers toward a colour the sky never reached.
    document.getElementById('bg-gradient').style.background =
        `linear-gradient(to bottom, ${b.bgTop} 0%, ${b.bgBot} 58%, ${b.fog} 100%)`;
    // The starfield behind the sky was invisible for the same reason the sky
    // was, and now that it is not, it has to know what time of day it is: sixty
    // white dots over the Ring Road's midday blue is not a starfield, it is
    // dust on the lens. It comes out with the light.
    const bgc = document.getElementById('bg-canvas');
    if (bgc) bgc.style.opacity = _skyStars(b.bgTop).toFixed(2);
}

// How much starfield a sky can carry, from the luminance of its top colour.
// Full at the Back Alley's near-black, nothing by the time it is daylight.
function _skyStars(hex) {
    const h = String(hex || '').replace('#', '');
    if (h.length !== 6) return 0;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), bl = parseInt(h.slice(4, 6), 16);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255;
    return Math.max(0, Math.min(1, 1 - lum / 0.42));
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
            const off = seatOffset(player.id, 0.7);
            dest.addScaledVector(right, off.lat).addScaledVector(tangent, off.fwd);
            player.mesh.lookAt(dest.clone().add(tangent));
        }
    } else {
        // City Circuit: use graph next node for orientation
        let nextId = opts.faceToward || ActiveMap.nextNode(targetNodeId);
        if (nextId && ActiveMap.isJunction(nextId)) nextId = ActiveMap.nextNode(nextId);
        if (nextId) {
            const nextPos = getPos(nextId);
            const fwd     = new THREE.Vector3().subVectors(nextPos, dest).normalize();
            const right   = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
            if (right.lengthSq() > 0.001) {
                const off = seatOffset(player.id, 0.7);
                dest.addScaledVector(right, off.lat).addScaledVector(fwd, off.fwd);
            }
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

// ============================================================
// CAMERA WATCHDOG — the last line, when everything else has failed
// ============================================================
// 'CINEMATIC' is a mode the render loop does not drive, on purpose: whatever
// set piece took the camera owns it, and hands it back when it finishes. That
// is a contract, and a contract has a way of not being kept — a continuation
// that never fires, an animation interrupted by a force-end, a client
// replaying a set piece whose exit path belonged to somebody else. When it is
// broken the symptom is total: the camera stops moving for the rest of the
// match and the board looks frozen even though the game is fine.
//
// The longest set piece in the game is the Swap, at ~5.9 s. Anything still
// holding the camera at three times that is not holding it, it has dropped it.
//
// Nothing should ever reach this. It is here because something did, and
// because "the scene forgot to hand back" is invisible until somebody is
// staring at a dead screen wondering whether the game crashed.
const CINEMATIC_MAX_S = 18;
let _cinematicHeld = 0;

function _cameraWatchdog(dt) {
    if (state.cameraState !== 'CINEMATIC') { _cinematicHeld = 0; return; }
    _cinematicHeld += dt;
    if (_cinematicHeld < CINEMATIC_MAX_S) return;
    console.warn(`[renderer] camera held on CINEMATIC for ${_cinematicHeld.toFixed(1)}s — taking it back`);
    _cinematicHeld = 0;
    state.cameraState = 'FOLLOW';
    resetCameraSmoothing();
    snapCameraToActive();
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
    if (ActiveMap.isLinear()) {
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
    if (!ActiveMap.isLinear() || !boardCurve) {
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
    if (ActiveMap.isLinear() && boardCurve && typeof p.pos === 'number') {
        const t = Math.max(0.001, Math.min(p.pos / _hbdMax, 0.999));
        return _tmpHead.copy(boardCurve.getTangent(t)).setY(0).normalize();
    }
    // City: ask the graph where this node points. Resolve through the invisible
    // junction nodes so the heading never aims at a node nobody can stand on.
    const nid = ActiveMap.nextNode(p.pos);
    if (!nid) return null;
    _tmpHead.copy(getPos(nid)).sub(getPos(p.pos)).setY(0);
    return _tmpHead.lengthSq() > 1e-6 ? _tmpHead.normalize() : null;
}

// Where the follow camera wants to be, and what it wants to look at, for the
// heading currently held in _camFwd. Both the per-frame follow and the hard snap
// go through this, so resuming play after a full-screen scene lands on exactly
// the pose the loop would have eased to — no jump on the first frame back.
function _followPose(p) {
    const isHBD = ActiveMap.isLinear();
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
    const pts = ActiveMap.isLinear()
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
    // through ActiveMap.ordered() (City-only), so on HBD it aimed the map camera at
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

// A 3D minigame covers the whole screen with its own WebGL scene. Drawing the
// board underneath it as well is two full scenes a frame on a phone, for a
// picture nobody can see. Stage.js pauses the board while it is up.
let _boardPaused = false;
export function setBoardPaused(on) {
    _boardPaused = !!on;
    if (!_boardPaused && clock) clock.getDelta();   // no dt jump on the way back
}
export function isBoardPaused() { return _boardPaused; }

function _loop() {
    requestAnimationFrame(_loop);
    if (!clock || _boardPaused) return;
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
    _fadeOccluders(dt);

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

    _cameraWatchdog(dt);

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
        // What the city is BUILT ON, as opposed to what it is paved with. When
        // the districts were one solid band this was never visible and could
        // safely be asphalt too; now that there is ground between them, a road
        // the same colour as the gaps between roads is no road at all.
        ground:     new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.98 }),
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

// Pavement tints, so the four districts differ in what they are MADE of and
// not only in what has been built on them. Deliberately close in value — the
// districts are told apart by shape first; this is the second signal, not the
// first.
let _DISTRICT_GROUND = {};

function _buildDistrictGroundMaterials() {
    const pave = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
    _DISTRICT_GROUND = {
        // Darker than they look written down. The city's key light is strong
        // and these are large flat areas facing straight up at it, so a stone
        // that reads as mid-grey on paper renders as white and swallows the
        // buildings standing on it.
        fin:  { pave: pave(0x5c6470) },   // clean grey stone
        ba:   { pave: pave(0x463c33) },   // stained brick dust
        shop: { pave: pave(0x6b5563) },   // promenade paving, faintly pink
        ind:  { pave: pave(0x565139) },   // dirty concrete
    };
}

/**
 * A flat road surface that follows a curve.
 *
 * Given the centre line and a width, this walks the points, works out which way
 * is sideways at each one, and emits a strip. It is the only way to get a road
 * that actually sits under the tiles: a RingGeometry can only ever be a circle,
 * which is precisely why the old ground forced every district to be one.
 *
 * Corners on a tight curve overlap slightly on the inside. At these widths and
 * radii that is invisible and cheaper than mitring every joint.
 */
function _ribbon(points, width, material, y) {
    const half = width / 2;
    const pos = [], idx = [];
    for (let i = 0; i < points.length; i++) {
        // The tangent, from whichever neighbours exist.
        const a = points[Math.max(0, i - 1)];
        const b = points[Math.min(points.length - 1, i + 1)];
        const tx = b.x - a.x, tz = b.z - a.z;
        const len = Math.hypot(tx, tz) || 1;
        // Sideways is the tangent turned a quarter turn in the XZ plane.
        const nx = -tz / len * half, nz = tx / len * half;
        pos.push(points[i].x + nx, y, points[i].z + nz);
        pos.push(points[i].x - nx, y, points[i].z - nz);
        if (i < points.length - 1) {
            const k = i * 2;
            idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
}

/** Where a district's lobe meets the city — end 0 is its start, end 1 its finish. */
function _lobeEnd(run, end) {
    return lobeSamples(run, 1)[end ? 1 : 0];
}

// Lane markings along a road, spaced by arc length so the dashes stay evenly
// spread whether the curve is bowing out or tucking in.
function _dashesAlong(points) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.12 });
    const STEP = 5.5;
    let carried = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i], b = points[i + 1];
        const seg = Math.hypot(b.x - a.x, b.z - a.z);
        carried += seg;
        if (carried < STEP || seg < 0.001) continue;
        carried = 0;
        const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.2), mat);
        dash.rotation.x = -Math.PI / 2;
        dash.rotation.z = -Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2;
        dash.position.set((a.x + b.x) / 2, -0.58, (a.z + b.z) / 2);
        _cityEnvGroup.add(dash);
    }
}

// City blocks, seen from above, drawn once and tiled across the ground.
//
// The disc the city stands on was one flat colour, and most of it is visible:
// the four district arcs and the ring road cover maybe a third of the board and
// everything between them was an empty slab. From the map view — which is the
// shot a player uses to decide where to go — the board read as four islands on
// a plate rather than as a city with roads through it.
let _blockTex = null;
function _cityBlockTexture() {
    if (_blockTex || typeof document === 'undefined') return _blockTex;
    // THE GROUND BETWEEN THE DISTRICTS IS THE REST OF THE CITY.
    //
    // It used to be four flat squares on a flat field, a few percent apart in
    // tone. From the street that is fine — you are looking at buildings — but
    // from the map view, which is where anybody actually reads the board, the
    // whole area between the four districts was a grey disc with a suggestion
    // of a grid on it, and the city stopped existing anywhere the tiles did
    // not go.
    //
    // Same idea, drawn properly: a street grid with centre lines, blocks in a
    // spread of tones rather than two, and the occasional park and reservoir
    // so the eye has something to land on. Still one 256px canvas, still
    // multiplied by nothing, still costs one texture.
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');

    // Asphalt underneath — everything else is a block sitting on it.
    g.fillStyle = '#2a2f3d'; g.fillRect(0, 0, S, S);

    // Six blocks per tile rather than four, and the texture repeated four
    // times rather than six: the same block size on the ground, but the
    // REPEAT is much less frequent, which is what stops a lattice appearing.
    const N = 6, CELL = S / N;
    for (let bx = 0; bx < N; bx++) {
        for (let by = 0; by < N; by++) {
            const n = _sr(bx * 31 + by * 17);
            const pad = 5 + n * 4;
            const x = bx * CELL + pad, y = by * CELL + pad;
            const w = CELL - pad * 2, h = CELL - pad * 2;
            // The first draft of this made one block in six a park and one in
            // eight a reservoir, at full saturation. Tiled six times across the
            // disc that is thirty-six bright green squares in a regular lattice
            // — the ground stopped reading as a city and started reading as a
            // quilt, and at street level the parks sat in the roadway like
            // pasted-on lawn. They are BACKGROUND. One of each per texture at
            // most, and close enough in tone to the blocks that they read as
            // variation rather than as decoration.
            if (n > 0.955) {
                // A reservoir — the only cool note down there.
                g.fillStyle = '#2c3a4a'; g.fillRect(x, y, w, h);
                g.fillStyle = 'rgba(150,190,225,.10)';
                for (let k = 0; k < 3; k++) g.fillRect(x + 3, y + 5 + k * 7, w - 6, 1.5);
            } else if (n > 0.90) {
                // A park.
                g.fillStyle = '#36423a'; g.fillRect(x, y, w, h);
                g.fillStyle = 'rgba(120,160,110,.16)';
                for (let k = 0; k < 4; k++) {
                    const tx = x + 4 + _sr(bx * 7 + by * 13 + k) * (w - 8);
                    const ty = y + 4 + _sr(bx * 11 + by * 5 + k) * (h - 8);
                    g.beginPath(); g.arc(tx, ty, 2.2, 0, Math.PI * 2); g.fill();
                }
            } else {
                // An ordinary block. Four tones rather than two, and a couple
                // of rooftop marks so it is not a plain rectangle from above.
                const tone = ['#333a4d', '#2f3646', '#39415670', '#353d51'][Math.floor(n * 4) % 4];
                g.fillStyle = tone; g.fillRect(x, y, w, h);
                g.fillStyle = 'rgba(255,255,255,.045)';
                g.fillRect(x + 2, y + 2, w - 4, 3);
                if (n > 0.45) g.fillRect(x + w * 0.55, y + 6, w * 0.3, h * 0.35);
            }
        }
    }

    // Street centre lines, down the middle of every road the blocks left. This
    // is the detail that makes it read as STREETS rather than as gaps.
    g.strokeStyle = 'rgba(214,224,240,.20)';
    g.lineWidth = 1;
    g.setLineDash([6, 7]);
    for (let i = 0; i < N; i++) {
        const at = i * CELL;
        g.beginPath(); g.moveTo(at, 0); g.lineTo(at, S); g.stroke();
        g.beginPath(); g.moveTo(0, at); g.lineTo(S, at); g.stroke();
    }
    g.setLineDash([]);

    _blockTex = new THREE.CanvasTexture(c);
    _blockTex.wrapS = _blockTex.wrapT = THREE.RepeatWrapping;
    // Fewer repeats than the old 9×: at 9 the grid was finer than the roads
    // the board itself is made of, which made it read as wallpaper; at 6 the
    // tile itself became legible and read as a quilt. Four, with more blocks
    // inside each tile, is the size where it is a city.
    _blockTex.repeat.set(4, 4);
    _blockTex.anisotropy = 4;
    return _blockTex;
}

function _buildCityGround() {
    _buildDistrictGroundMaterials();
    // The ground the whole city stands on.
    const groundTex = _cityBlockTexture();
    if (groundTex && !_CM.ground.map) {
        _CM.ground.map = groundTex;
        // A map is MULTIPLIED by the material's colour, and this material's is
        // 0x232833. Times a texture that is itself dark, the blocks came out
        // black on black and the ground looked exactly as flat as before. The
        // texture carries the colour now; the material gets out of its way.
        _CM.ground.color.set(0xffffff);
        _CM.ground.needsUpdate = true;
    }
    const base = new THREE.Mesh(new THREE.CircleGeometry(130, 64), _CM.ground);
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

    // ---- The districts -------------------------------------------------
    //
    // This used to be three concentric rings: a sidewalk band, one wide road
    // band, an outer sidewalk. Four districts sat on the same band and were
    // told apart only by the colour of the buildings standing on them, which is
    // why the board read as a bullseye rather than as a city.
    //
    // Now each district gets its own road, drawn along the lobe its tiles
    // actually sit on, with its own pavement either side. The gaps between
    // them are real gaps — you can see the ground between the Financial
    // District and the Back Alley — and the ring road in the middle is the one
    // thing that touches all four.
    districtRuns().forEach(run => {
        const pts = lobeSamples(run, 56);
        const tint = _DISTRICT_GROUND[run.ids[0].split('_')[0]] || {};
        _cityEnvGroup.add(_ribbon(pts, 23, tint.pave || _CM.sidewalk, -0.60));
        // No asphalt or lane markings under a district: _buildDistrictSurfaces
        // lays a slab per tile on top of this, and a road nobody can see is
        // just triangles. The pavement is the part that shows, and its job is
        // to draw the district's outline on the ground.
    });

    // ---- The spurs -------------------------------------------------------
    //
    // Four short roads from the ring out to where each district begins. The
    // junctions were always there in the graph — turning off the ring into a
    // district is the whole decision the board is built around — but on a solid
    // band there was nothing to see, so the choice had no place attached to it.
    districtRuns().forEach(run => {
        [0, 1].forEach(end => {
            const outer = _lobeEnd(run, end);
            const inner = outer.clone().normalize().multiplyScalar(34);
            _cityEnvGroup.add(_ribbon([inner, outer], 11, _CM.sidewalk, -0.60));
            _cityEnvGroup.add(_ribbon([inner, outer], 6, _CM.asphalt, -0.605));
        });
    });

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
    // The hub's own nodes, whatever this board calls them. This used to be
    // City's twenty ring-road ids written out, which is a list that cannot be
    // right on two boards at once.
    const hubNodes = _districtNodes(ActiveMap.hubKey());
    if (!hubNodes.length) return;
    // A city has electric lamps; Perdition has lantern posts, and a shorter
    // hub ring means every node gets one rather than every other.
    const post = _isClover() ? _mkLanternPost : _mkLampPost;
    const every = hubNodes.length > 14 ? 2 : 1;
    const reach = _isClover() ? 5 : 6;
    hubNodes.forEach((id, idx) => {
        if (idx % every !== 0) return;
        const pos = getPos(id).clone();
        const out = _outwardDir(pos);
        [reach, -reach].forEach(d => {
            const at = pos.clone().addScaledVector(out, d);
            at.y = 0;
            _cityEnvGroup.add(post(at));
        });
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

// ============================================================
// NOTHING STANDS BETWEEN YOU AND YOUR PIECE
// ============================================================
// The city is built close to the road on purpose — a board you look down at
// from orbit is a diagram, not a place — but "close" and "in the way" are one
// bad camera angle apart. On the ring road especially the follow camera sits
// outside the circle looking in, so the block on the near side of the street is
// squarely between the lens and the token, and the player is steering something
// they cannot see.
//
// Moving the buildings back is the wrong fix twice over: far enough to never
// occlude is far enough to look like a ring road through a car park, and it
// cannot work anyway because the camera swings. So the buildings stay where
// they are and GET OUT OF THE WAY instead — anything between the camera and the
// active token fades to a ghost and comes back the moment the shot clears.
//
// A cylinder rather than a ray: a token is not a point, and a corner clipping
// the edge of the frame is as bad as a wall across it.
const OCCLUDE_R    = 4.2;    // world units either side of the camera→token line
const OCCLUDE_MIN  = 0.20;   // how solid a faded prop stays — never invisible,
                             // because a building that vanishes reads as a bug
const OCCLUDE_RATE = 5.5;    // how fast it fades, per second

const _occTmpA = new THREE.Vector3();
const _occTmpB = new THREE.Vector3();
const _occTmpC = new THREE.Vector3();

/** Distance from `pt` to the segment a→b. */
function _distToSeg(pt, a, b) {
    _occTmpA.subVectors(b, a);
    const lenSq = _occTmpA.lengthSq();
    if (lenSq < 1e-6) return pt.distanceTo(a);
    let t = _occTmpB.subVectors(pt, a).dot(_occTmpA) / lenSq;
    t = Math.max(0, Math.min(1, t));
    _occTmpC.copy(a).addScaledVector(_occTmpA, t);
    return pt.distanceTo(_occTmpC);
}

function _fadeOccluders(dt) {
    if (!_cityEnvGroup || !camera) return;
    const p = state.players[state.activePlayer];
    const token = p && p.mesh ? p.mesh.position : null;
    const k = Math.min(1, OCCLUDE_RATE * dt);

    _cityEnvGroup.children.forEach(m => {
        if (!m.userData || !m.userData.occludes) return;
        let want = 1;
        if (token) {
            // Only things actually BETWEEN the two — a building behind the
            // token is part of the backdrop and must not flicker.
            const dCam = m.position.distanceTo(camera.position);
            const dTok = m.position.distanceTo(token);
            const span = camera.position.distanceTo(token);
            if (dCam < span && dTok < span &&
                _distToSeg(m.position, camera.position, token) < OCCLUDE_R + (m.userData.occR || 0)) {
                want = OCCLUDE_MIN;
            }
        }
        const cur = m.userData.occNow === undefined ? 1 : m.userData.occNow;
        const next = cur + (want - cur) * k;
        if (Math.abs(next - cur) < 0.002 && (next > 0.995 || next < OCCLUDE_MIN + 0.005)) {
            m.userData.occNow = next;
            return;                                  // settled; nothing to write
        }
        m.userData.occNow = next;
        // The materials this building OWNS. A building is a Group — it has no
        // `.material` of its own, which is what the first version of this
        // reached for, so it wrote opacity onto `undefined` and nothing ever
        // faded. And its meshes share the district materials with every other
        // building on the street, so writing to those would have ghosted the
        // whole district at once. _canOcclude clones them per building; this
        // walks that list.
        const mats = m.userData.occMats;
        if (!mats) return;
        // Only pay for transparency while it is actually being used: a
        // transparent material is sorted every frame and the city has
        // hundreds of them.
        const solid = next > 0.995;
        for (let i = 0; i < mats.length; i++) {
            const mat = mats[i];
            if (mat.transparent === solid) { mat.transparent = !solid; mat.needsUpdate = true; }
            mat.opacity = next;
            mat.depthWrite = solid;
        }
    });
}

/**
 * Mark a prop as something the camera may need to see past, and say how wide it
 * is so the test can account for its footprint rather than its centre.
 */
function _canOcclude(mesh, radius) {
    if (!mesh) return mesh;
    mesh.userData = mesh.userData || {};
    mesh.userData.occludes = true;
    mesh.userData.occR = radius || 0;
    mesh.userData.occNow = 1;

    // GIVE IT ITS OWN MATERIALS. The district materials in _CM are shared by
    // every building on the street — the whole point of them — so fading "this
    // building" through a shared material would fade the entire district. One
    // clone per unique material per building, collected once here so the
    // per-frame path is a flat array walk rather than a traverse.
    const owned = [];
    const seen = new Map();
    mesh.traverse(n => {
        if (!n.material) return;
        const list = Array.isArray(n.material) ? n.material : [n.material];
        const next = list.map(mat => {
            if (!mat) return mat;
            if (!seen.has(mat)) {
                const c = mat.clone();
                seen.set(mat, c);
                owned.push(c);
                _occOwned.push(c);
            }
            return seen.get(mat);
        });
        n.material = Array.isArray(n.material) ? next : next[0];
    });
    mesh.userData.occMats = owned;
    return mesh;
}

// Every material cloned for a fadeable prop, so a map rebuild can hand them
// back rather than leaving one set per City Circuit match on the GPU.
const _occOwned = [];
function _disposeOccluderMaterials() {
    _occOwned.forEach(m => { try { m.dispose(); } catch (e) {} });
    _occOwned.length = 0;
}

// ---- Background skyline ----

// A window grid, drawn once and shared by every tower on the horizon.
//
// The skyline was thirty untextured boxes, and at any camera angle that put the
// horizon in shot they read as coloured cardboard standing on end — the one
// part of the city with no detail at all, in the part of the frame that has the
// most sky behind it. One 32×64 canvas fixes all thirty for the cost of a
// single texture: lit and unlit windows, tiled up each face.
let _skylineTex = null;
function _skylineTexture() {
    if (_skylineTex || typeof document === 'undefined') return _skylineTex;
    const c = document.createElement('canvas');
    c.width = 32; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 32, 64);
    // Four windows across, sixteen up. About a third are lit, which is what a
    // city looks like and also what stops the grid reading as a regular
    // pattern — a fully lit tower is a chequerboard.
    for (let row = 0; row < 16; row++) {
        for (let col = 0; col < 4; col++) {
            const lit = _sr(row * 41 + col * 7 + 3) < 0.34;
            g.fillStyle = lit ? '#fff3c4' : '#6f7c93';
            g.fillRect(col * 8 + 2, row * 4 + 1, 4, 2);
        }
    }
    _skylineTex = new THREE.CanvasTexture(c);
    _skylineTex.wrapS = _skylineTex.wrapT = THREE.RepeatWrapping;
    _skylineTex.magFilter = THREE.NearestFilter;
    return _skylineTex;
}

function _buildBackgroundSkyline() {
    const count = 34;
    const tex = _skylineTexture();
    // The horizon is not four districts, it is the rest of the city. Its
    // colours are muted versions of theirs — a tower two hundred units away
    // that is as saturated as the one you are standing next to is the single
    // strongest cue that a scene has no depth in it, and no amount of fog
    // rescues a full-strength magenta slab.
    const tints = [0x6f8199, 0x7d6f86, 0x8a7f74, 0x6b7d8a, 0x84758c];
    const mats = tints.map(c => new THREE.MeshStandardMaterial({
        color: c, roughness: 0.85, metalness: 0.05,
        map: tex || null, emissive: 0xffe6a8, emissiveIntensity: 0.30,
        emissiveMap: tex || null,
    }));
    for (let i = 0; i < count; i++) {
        // Jitter, so it is a skyline and not a picket fence. The old ring put a
        // tower at every exact 12° and cycled four radii and ten heights in
        // lockstep, which from a low camera is a fence with a sawtooth top.
        const angle = (i / count) * Math.PI * 2 + (_sr(i * 3 + 1) - 0.5) * 0.16;
        const r = 96 + _sr(i * 5 + 2) * 34;
        const pos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        // Mostly mid-rise with a few real towers, rather than an even spread.
        const tall = _sr(i * 7 + 4) > 0.78;
        const h = tall ? 34 + _sr(i * 11 + 5) * 26 : 11 + _sr(i * 13 + 6) * 18;
        const w = 5 + _sr(i * 17 + 7) * 5;
        const d = 5 + _sr(i * 19 + 8) * 4;
        const mat = mats[i % mats.length].clone();
        // One texture, many towers: the repeat is per-material so a tall tower
        // gets more rows of windows rather than four stretched ones.
        if (tex) {
            mat.map = tex.clone(); mat.map.needsUpdate = true;
            mat.map.repeat.set(Math.max(1, Math.round(w / 5)), Math.max(2, Math.round(h / 6)));
            mat.emissiveMap = mat.map;
        }
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.copy(pos); mesh.position.y = h / 2;
        // SQUARE TO THE CITY, NOT TO NOTHING.
        //
        // The yaw used to be `_sr(...) * 0.5` — up to 29° of free rotation on
        // every tower, independently. From the street that reads as jitter and
        // is fine; from above, which is how anybody reading the board sees it,
        // thirty-four boxes at thirty-four unrelated angles read as debris
        // orbiting the map rather than as a city around it. Towers face the
        // centre now, with a couple of degrees of slop so it is still a skyline
        // and not a paling fence.
        mesh.rotation.y = -angle + (_sr(i * 23 + 9) - 0.5) * 0.14;
        _cityEnvGroup.add(mesh);
    }
}

// ---- Per-node building placement ----

/**
 * Half the width of what each district puts on a plot, so the setback can be
 * measured to the building's FACE rather than to its origin. Deliberately a
 * table rather than a bounding-box measurement: the meshes are built after the
 * position is chosen, and a generous constant costs a metre of pavement while
 * measuring costs a build-then-move-then-rebuild.
 */
const _FOOTPRINT = {
    ind: 6.5, fin: 5.0, ba: 5.5, shop: 5.0,
    // Star Territory. A false-front store is narrow, a barn is not, and nothing
    // in the Badlands is a building at all — it is a rock, and rocks are wide.
    hub: 4.8, rail: 6.0, mine: 5.5, ranch: 6.5, bad: 5.5,
};

function _footprintHalf(district, isHQ) {
    const base = _FOOTPRINT[district] ?? 4.5;           // ring / civic
    return isHQ ? base * 1.35 : base;
}

// What each region builds on its plots. A missing entry means the region puts
// nothing beside the road, which is a legitimate answer and used to be an
// unreachable `default: return`.
const _PLOT_BUILDER = {
    fin:  (pos, isHQ) => _mkSkyscraper(pos, isHQ),
    ba:   (pos, isHQ) => _mkBrickBuilding(pos, isHQ),
    shop: (pos, isHQ) => _mkShopBuilding(pos, undefined, isHQ),
    ind:  (pos, isHQ) => _mkFactory(pos, isHQ),
    ring: (pos)       => _mkCivicBuilding(pos),
    // ---- Star Territory ----
    hub:   (pos, _h, seed) => _mkFalseFront(pos, seed),
    rail:  (pos, _h, seed) => _mkRailShed(pos, seed),
    mine:  (pos, _h, seed) => _mkMineWorks(pos, seed),
    ranch: (pos, _h, seed) => _mkRanchBuilding(pos, seed),
    bad:   (pos, _h, seed) => _mkBadlandsRock(pos, seed),
};

function _buildAllDistrictBuildings() {
    const boardData = state.board;
    let plotSeed = 0;
    Object.keys(ActiveMap.graph()).forEach(nodeId => {
        if (ActiveMap.isJunction(nodeId)) return;
        const graphNode = ActiveMap.graph()[nodeId];
        const district  = graphNode?.district || 'ring';
        const spaceType = boardData[nodeId]?.type;
        const isHQ      = spaceType === 'hq';
        const pos       = getPos(nodeId).clone();

        const outDir = _outwardDir(pos);
        // THE PAVEMENT IS NOT NEGOTIABLE.
        //
        // The offset used to be a flat -10 inward on the ring and +12 outward
        // in the districts, measured from the node to the building's ORIGIN —
        // which says nothing about where its wall ends up. A factory is a good
        // deal wider than a shopfront, so the same number put one politely back
        // from the kerb and drove the other through it. The setback is measured
        // to the FACE now: a fixed pavement, plus however much the building
        // itself takes up.
        const half   = _footprintHalf(district, isHQ);
        const pave   = district === 'ring' ? 7.5 : 8.5;
        const offset = (district === 'ring' ? -1 : 1) * (pave + half);
        const bPos = pos.clone().addScaledVector(outDir, offset);
        bPos.y = 0;

        const make = _PLOT_BUILDER[district];
        if (!make) return;
        const building = make(bPos, isHQ, plotSeed++);

        if (building) {
            building.rotation.y = _facingAngle(pos);
            // Every block is something the camera may have to see past.
            _canOcclude(building, half);
            _cityEnvGroup.add(building);
        }
    });

    // What stands on the horizon behind the board: the rest of the city, or the
    // mesas the Territory is cut out of.
    if (_isClover()) _buildMesaHorizon();
    else             _buildBackgroundSkyline();
}

// ---- Main entry ----

function _buildCityScene() {
    if (_cityEnvGroup) { scene.remove(_cityEnvGroup); _cityEnvGroup = null; }
    // The per-building material clones belong to the city that is going away.
    _disposeOccluderMaterials();
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

    // WHAT THE BOARD IS MADE OF IS THE MAP'S BUSINESS; HOW IT IS DRESSED IS NOT.
    //
    // Six of these eight passes are already data-driven: they iterate
    // DISTRICT_BIOMES and ask _districtNodes(key) which nodes on the CURRENT
    // board belong to each key, so a region that is not on this map contributes
    // nothing and costs nothing. Only the ground and the centrepiece are
    // genuinely per-board geometry — a city has a ring road and a fountain, a
    // territory has a hub ring and a town square — so only those two branch.
    if (_isClover()) { _buildTerritoryGround(); _buildTerritoryCentre(); }
    else             { _buildCityGround();      _buildCityCenter(); }
    _buildAllDistrictBuildings();
    _buildStreetLamps();
    _buildDistrictSurfaces();
    _buildDistrictDressing();
    _buildDistrictLandmarks();
    _buildDistrictLights();
    _buildOverheads();
    _buildDistrictMotes();
}

/** Is the active board the Clover (Star Territory)? */
function _isClover() { return ActiveMap.layout()?.kind === 'clover'; }

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
                   ind: _spanPipeBridge, ring: _spanGantrySign,
                   hub: _spanGallowsSign, rail: _spanSignalGantry, mine: _spanShoring,
                   ranch: _spanLogGate, bad: _spanDeadCottonwood };
    Object.keys(SPAN).forEach(key => {
        const nodes = _districtNodes(key);
        if (nodes.length < 3) return;
        // The hub carries its spans further apart, because everybody crosses it
        // every lap and two arches four nodes apart would read as a tunnel.
        const at = ActiveMap.isHub(key)
            ? [nodes[Math.min(3, nodes.length - 1)], nodes[Math.min(nodes.length - 1, Math.floor(nodes.length * 0.75))]]
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
    return ActiveMap.ordered().filter(id => ActiveMap.graph()[id]?.district === key);
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
        // ---- Star Territory. Nothing out here is paved, so the "seam" is a
        // wagon rut, a rail, an ore-cart track or a crack in the hardpan.
        dirt:      { col: 0x6b4f33, rough: 0.98, metal: 0, seam: 0x8a6a45 },  // rutted township dirt
        ballast:   { col: 0x4a4a4e, rough: 0.95, metal: 0, seam: 0x8a7a5c },  // stone chip and sleepers
        wetrock:   { col: 0x2b2420, rough: 0.55, metal: 0.1, seam: 0x6a5a48 },// wet rock, cart rails
        grassdirt: { col: 0x4d5a2c, rough: 0.96, metal: 0, seam: 0x7a6b3a },  // packed earth through grass
        hardpan:   { col: 0xa08f6c, rough: 0.99, metal: 0, seam: 0xc9b68c },  // cracked salt flat
    };
    // Every region on THIS board that names a surface — it used to be City's
    // four district keys written out, which is the one line in the dressing
    // passes that a second graph board could not reach.
    [...ActiveMap.regionKeys(), ActiveMap.hubKey()].filter(Boolean).forEach(key => {
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
            const seams = (key === 'ind' || key === 'mine') ? 3 : 1;
            for (let s = 0; s < seams; s++) {
                const line = new THREE.Mesh(
                    new THREE.PlaneGeometry((key === 'ind' || key === 'mine') ? 1.1 : 0.35, 12),
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
                    works: _propWorks, civic: _propCivic,
                    township: _propTownship, railyard: _propRailyard, mine: _propMine,
                    ranch: _propRanch, badlands: _propBadlands };
    Object.keys(DISTRICT_BIOMES).forEach(key => {
        const make = MAKER[DISTRICT_BIOMES[key].props];
        if (!make) return;
        _districtNodes(key).forEach((id, i) => {
            const pos = getPos(id).clone().setY(0);
            const out = _outwardDir(pos);
            const ang = _facingAngle(pos);
            // Two props per node, one each side of the road. The ring already
            // carries lamps on both sides, so it gets one and further out.
            const sides = ActiveMap.isHub(key) ? [1] : [1, -1];
            sides.forEach((s, k) => {
                const r = _seeded(i * 31 + k * 7 + key.length * 13);
                if (r > 0.86) return;                       // gaps, so it is not a fence
                const dist = (ActiveMap.isHub(key) ? 9 : 6.2) + _seeded(i * 17 + k) * 1.6;
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
    const BUILD = { fin: _lmExchange, ba: _lmNeonArch, shop: _lmArcade, ind: _lmCoolingTowers,
                    rail: _lmWaterTower, mine: _lmHeadframe, ranch: _lmGreatBarn, bad: _lmMesa };
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
        } else if (e.kind === 'windmill') {
            // The one thing on the Ranch that moves, and the reason golden hour
            // out there does not read as a photograph. Seeded speed so a row of
            // pumps does not turn in lockstep.
            e.fan.rotation.z = time * (0.7 + _seeded(e.seed) * 0.6);
        } else if (e.kind === 'devil') {
            // A dust devil: spheres spiralling up a cone, widening and fading.
            // It walks a little, because a stationary one reads as a smoke
            // machine rather than as weather.
            const drift = Math.sin(time * 0.22 + e.seed) * 3.2;
            e.parts.forEach((p, k) => {
                const t = ((time * 0.35 + k / e.parts.length) % 1);
                const spin = t * 9 + e.seed;
                const r = 0.4 + t * 1.9;
                p.position.set(drift + Math.cos(spin) * r, 0.4 + t * 6.5,
                               Math.sin(spin) * r);
                p.material.opacity = Math.sin(t * Math.PI) * 0.22;
                p.scale.setScalar(0.6 + t * 1.1);
            });
        }
    }
}


// ============================================================
// STAR TERRITORY — the Clover, dressed
// ============================================================
//
// Five places, five times of day, and the rule docs/DISTRICTS.md established:
// a region is told apart by its SHAPE first, its LIGHT second and its props
// third. A follow camera nineteen units back and twenty-six up cannot see the
// sky gradient at all, so everything below is aimed at what is actually in
// frame — the ground under the tiles and the six metres either side of the
// road.
//
// Nothing here is new architecture. The six data-driven dressing passes above
// (surfaces, props, landmarks, lights, spans, motes) reach these builders by
// name off DISTRICT_BIOMES, exactly as they already did for City's four. Only
// the ground and the centrepiece are per-board geometry, because a city has a
// ring road and a fountain and a territory has a hub ring and a town square.

// ---- The ground the Territory stands on --------------------------------
//
// City's base disc carries a block texture — roads and rooftops seen from
// above, which is what the gaps between its districts should look like. Out
// here the gaps are scrub and dry grass, and the single strongest cue that this
// is not the city is that the ground between the roads has nothing on it.
let _prairieTex = null;
function _prairieTexture() {
    if (_prairieTex || typeof document === 'undefined') return _prairieTex;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#8a7048'; g.fillRect(0, 0, S, S);
    // Big soft blotches rather than per-pixel noise: noise at this scale reads
    // as static from the map view and as nothing at all from the follow camera.
    const tints = ['#7d6a44', '#95805a', '#6f5e3c', '#a08b62'];
    for (let i = 0; i < 90; i++) {
        const x = _sr(i * 3 + 1) * S, y = _sr(i * 5 + 2) * S;
        const r = 10 + _sr(i * 7 + 3) * 26;
        g.globalAlpha = 0.35 + _sr(i * 11) * 0.3;
        g.fillStyle = tints[Math.floor(_sr(i * 13) * tints.length)];
        g.beginPath();
        g.ellipse(x, y, r, r * (0.5 + _sr(i * 17) * 0.7), _sr(i * 19) * 3.14, 0, 6.29);
        g.fill();
    }
    // Sage clumps: sparse dark-green specks, enough to read as plants.
    g.globalAlpha = 0.5;
    for (let i = 0; i < 220; i++) {
        g.fillStyle = _sr(i * 23) > 0.5 ? '#5f6b36' : '#4d5a2c';
        const x = _sr(i * 29 + 4) * S, y = _sr(i * 31 + 5) * S;
        g.beginPath(); g.arc(x, y, 1.2 + _sr(i * 37) * 2.2, 0, 6.29); g.fill();
    }
    g.globalAlpha = 1;
    _prairieTex = new THREE.CanvasTexture(c);
    _prairieTex.wrapS = _prairieTex.wrapT = THREE.RepeatWrapping;
    _prairieTex.repeat.set(6, 6);
    return _prairieTex;
}

// Per-territory ground tints — the second signal after shape. Deliberately
// close in value for the same reason City's are: the light out here is strong
// and these are large flat areas facing straight up at it, so a colour that
// reads as mid-tone written down renders as glare.
const _TERR_GROUND = {
    rail:  0x4f4a44,   // oiled ballast
    mine:  0x2e2723,   // wet rock and spoil
    ranch: 0x55602f,   // grazed grass over packed earth
    bad:   0x9e8d6a,   // salt hardpan
};

function _buildTerritoryGround() {
    const L = ActiveMap.layout();
    if (!L) return;

    // The plain everything stands on.
    const tex = _prairieTexture();
    // WIDE ENOUGH TO PUT THE HORIZON ON. The first pass made this 150 and then
    // moved the mesas out to 155–210 to stop them crowding the lobes, which
    // left every one of them standing on nothing — photographed at
    // qa/shot-map-star_territory-top.png as a visible disc edge with rock
    // floating past it.
    const base = new THREE.Mesh(
        new THREE.CircleGeometry(260, 72),
        new THREE.MeshStandardMaterial({
            color: tex ? 0xffffff : 0x8a7048, roughness: 0.98, map: tex || null }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.62;
    base.receiveShadow = true;
    _cityEnvGroup.add(base);

    // ---- Perdition: the hub ring road ----------------------------------
    // A plain band, and deliberately the only plain circle on the board — the
    // lobes hang off it and the town square sits inside it.
    const road = new THREE.Mesh(
        new THREE.RingGeometry(L.HUB_R - 7, L.HUB_R + 7, 64),
        new THREE.MeshStandardMaterial({ color: 0x6b4f33, roughness: 0.98 }));
    road.rotation.x = -Math.PI / 2; road.position.y = -0.61;
    road.receiveShadow = true;
    _cityEnvGroup.add(road);

    // Wagon ruts, not a painted centre line: out here the road is not marked,
    // it is worn. Two continuous tracks either side of the crown of the road.
    const rutMat = new THREE.MeshStandardMaterial({ color: 0x53402a, roughness: 1 });
    [L.HUB_R - 2.4, L.HUB_R + 2.4].forEach(r => {
        const rut = new THREE.Mesh(new THREE.RingGeometry(r - 0.28, r + 0.28, 64), rutMat);
        rut.rotation.x = -Math.PI / 2; rut.position.y = -0.595;
        _cityEnvGroup.add(rut);
    });

    // ---- The four lobes ------------------------------------------------
    //
    // A lobe's road is a FULL CIRCLE: its twelve nodes run from +165 degrees
    // round to -165 about the lobe centre, which is 330 degrees of it, and the
    // missing 30 is where the junction and the rejoin node sit on the hub ring.
    // So the band is a plain ring rather than a sampled ribbon — the one place
    // the Clover's geometry is simpler than City's rather than harder.
    cloverLobes().forEach(lobe => {
        const a  = (L.junctions[lobe.jn] || 0) * Math.PI / 180;
        const cx = L.LOBE_C * Math.cos(a), cz = -L.LOBE_C * Math.sin(a);
        const col = _TERR_GROUND[lobe.key] ?? 0x6b4f33;

        const band = new THREE.Mesh(
            new THREE.RingGeometry(L.LOBE_R - 8, L.LOBE_R + 8, 56),
            new THREE.MeshStandardMaterial({ color: col, roughness: 0.97 }));
        band.rotation.x = -Math.PI / 2;
        band.position.set(cx, -0.605, cz);
        band.receiveShadow = true;
        _cityEnvGroup.add(band);

        // The corral in the middle — the hole a ring leaves. A shade darker, so
        // the lobe reads as an enclosure you ride around rather than as a road
        // that happens to curve.
        const inner = new THREE.Mesh(
            new THREE.CircleGeometry(L.LOBE_R - 8, 40),
            new THREE.MeshStandardMaterial({ color: _tint(col, 0.74), roughness: 0.99 }));
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(cx, -0.615, cz);
        _cityEnvGroup.add(inner);
    });
}

// ---- Perdition's town square -------------------------------------------
//
// City's centrepiece is a fountain in a park, and you see it over the top of
// the ring road on every lap. Perdition's is the courthouse and the gallows
// frame — the two things the Territory has instead of law, standing in the one
// part of the board nobody can walk on.
function _buildTerritoryCentre() {
    const wood  = _dressMat(0x6b4a2c, { rough: 0.9 });
    const dark  = _dressMat(0x4a3320, { rough: 0.92 });
    const stone = _dressMat(0xbdae92, { rough: 0.85 });

    // Packed square inside the ring.
    const sq = new THREE.Mesh(new THREE.CircleGeometry(13, 40),
        new THREE.MeshStandardMaterial({ color: 0x7d6444, roughness: 0.98 }));
    sq.rotation.x = -Math.PI / 2; sq.position.y = -0.585;
    _cityEnvGroup.add(sq);

    // Courthouse: a squat stone block with a clock tower. The clock is what
    // makes it read as a courthouse from the flyover rather than as a shed.
    const court = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(11, 6, 8), stone);
    body.position.y = 3; court.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, 9), dark);
    roof.position.y = 6.3; court.add(roof);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(3.6, 7, 3.6), stone);
    tower.position.y = 9.5; court.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.0, 3.0, 4), dark);
    cap.position.y = 14.4; cap.rotation.y = Math.PI / 4; court.add(cap);
    // Stuck at ten to four, which is the hour the whole board is lit for.
    [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach(rot => {
        const face = new THREE.Mesh(new THREE.CircleGeometry(1.35, 20),
            new THREE.MeshStandardMaterial({ color: 0xf6ecd2, emissive: 0xf0d9a0, emissiveIntensity: 0.35 }));
        face.position.set(Math.sin(rot) * 1.85, 10.2, Math.cos(rot) * 1.85);
        face.rotation.y = rot;
        court.add(face);
        const hands = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.06), dark);
        hands.position.set(Math.sin(rot) * 1.92, 10.2, Math.cos(rot) * 1.92);
        hands.rotation.y = rot; hands.rotation.z = 0.5;
        court.add(hands);
    });
    court.position.set(0, 0, -3.5);
    court.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    _cityEnvGroup.add(court);

    // The gallows frame, empty. Two posts and a beam — the silhouette does the
    // work and nothing hangs from it.
    const gal = new THREE.Group();
    [-2.2, 2.2].forEach(x => {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.5), wood);
        post.position.set(x, 3.2, 0); gal.add(post);
    });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.5, 0.5), wood);
    beam.position.y = 6.5; gal.add(beam);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.8, 6),
        _dressMat(0xbba475, { rough: 1 }));
    rope.position.set(1.2, 5.4, 0); gal.add(rope);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.4, 3.2), dark);
    deck.position.y = 0.2; gal.add(deck);
    gal.position.set(7.5, 0, 6.0); gal.rotation.y = -0.5;
    gal.traverse(o => { if (o.isMesh) o.castShadow = true; });
    _cityEnvGroup.add(gal);

    // A well, so the square is a place people use rather than a stage set.
    const well = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.2, 14), stone);
    ring.position.y = 0.6; well.add(ring);
    [-1.4, 1.4].forEach(x => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.6, 0.26), wood);
        p.position.set(x, 1.3, 0); well.add(p);
    });
    const wroof = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.1, 4), dark);
    wroof.position.y = 3.0; wroof.rotation.y = Math.PI / 4; well.add(wroof);
    well.position.set(-7.5, 0, 5.5);
    well.traverse(o => { if (o.isMesh) o.castShadow = true; });
    _cityEnvGroup.add(well);
}

// A lantern on a post — Perdition's street lighting. Shorter and warmer than
// City's electric lamp, and the glass is the only thing on it that glows.
function _mkLanternPost(pos) {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 4.2, 7),
        _dressMat(0x5a4029, { rough: 0.92 }));
    post.position.y = 2.1; g.add(post);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.9),
        _dressMat(0x3a3a3a, { rough: 0.6, metal: 0.5 }));
    arm.position.set(0, 4.1, 0.45); g.add(arm);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xffe4a8, emissive: 0xffb03a, emissiveIntensity: 1.1 }));
    glass.position.set(0, 3.75, 0.9); g.add(glass);
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4),
        _dressMat(0x2f2f2f, { rough: 0.6, metal: 0.4 }));
    hood.position.set(0, 4.35, 0.9); hood.rotation.y = Math.PI / 4; g.add(hood);
    g.position.copy(pos);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
}

// ---- What stands on each territory's plots -----------------------------

const _WOOD = [0x8a6239, 0x6f4c2b, 0x9a7548, 0x5d4126];

/** Perdition: a false-front store with a boardwalk. */
function _mkFalseFront(pos, seed) {
    const g = new THREE.Group();
    const wood = _dressMat(_WOOD[Math.floor(_seeded(seed * 5 + 1) * _WOOD.length)], { rough: 0.9 });
    const h = 4.6 + _seeded(seed * 7) * 2.2;
    const w = 6.5 + _seeded(seed * 11) * 2.0;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), wood);
    body.position.y = h / 2; g.add(body);
    // THE FALSE FRONT IS THE WHOLE POINT. A western storefront is a one-storey
    // shed with a flat parapet nailed to the front so it looks like two — it is
    // the single silhouette that says "frontier town", and nothing else does.
    const front = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h * 0.55, 0.4),
        _dressMat(0xa5804f, { rough: 0.88 }));
    front.position.set(0, h + h * 0.26, 3.1); g.add(front);
    // Boardwalk, awning and its posts.
    const walk = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.3, 2.2),
        _dressMat(0x7a5a36, { rough: 0.95 }));
    walk.position.set(0, 0.15, 4.2); g.add(walk);
    const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, 0.22, 2.6),
        _dressMat(0x513824, { rough: 0.9 }));
    awn.position.set(0, 3.1, 4.3); g.add(awn);
    [-(w / 2) + 0.3, (w / 2) - 0.3].forEach(x => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.0, 0.24), _dressMat(0x513824, { rough: 0.9 }));
        p.position.set(x, 1.5, 5.3); g.add(p);
    });
    // Door and two windows, warm inside.
    const lit = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffb545, emissiveIntensity: 0.6 });
    [-1.9, 1.9].forEach(x => {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.3), lit);
        win.position.set(x, 2.1, 3.02); g.add(win);
    });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.3, 0.14), _dressMat(0x3e2c1b, { rough: 0.9 }));
    door.position.set(0, 1.15, 3.05); g.add(door);
    g.position.copy(pos);
    return g;
}

/** Ironwood Railyard: long timber sheds with corrugated roofs. */
function _mkRailShed(pos, seed) {
    const g = new THREE.Group();
    const plank = _dressMat(0x5d4c3a, { rough: 0.93 });
    const iron  = _dressMat(0x6a6f74, { rough: 0.55, metal: 0.6 });
    const h = 4.0 + _seeded(seed * 3) * 1.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(9, h, 6.5), plank);
    body.position.y = h / 2; g.add(body);
    // A BARREL VAULT, sunk into the body so only the crown shows.
    //
    // The first pass used a half-cylinder standing on the wall plate at full
    // radius, and after the quarter turn that puts its axis along the building
    // its open face pointed sideways — so every shed in the yard rendered as an
    // oil drum lying on its side. Photographed at qa/shot-map-star_territory-*
    // before the fix. A full cylinder pushed down into the walls gives the
    // corrugated crown a goods shed actually has, and the buried half costs
    // nothing because nothing can see it.
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 9.3, 14), iron);
    roof.rotation.z = Math.PI / 2;
    // Sunk most of the way into the walls. At radius 3.3 sitting 1.5 down it
    // was still wider than the 6.5-deep body and read as a drum lying on the
    // shed from directly above; this leaves a crown rather than a barrel.
    roof.position.y = h - 1.7; g.add(roof);
    // An eave lip either side, so the roof meets a wall instead of floating.
    [-3.1, 3.1].forEach(z => {
        const eave = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.22, 0.5), iron);
        eave.position.set(0, h - 0.1, z); g.add(eave);
    });
    // Sliding door on a rail.
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, h * 0.75, 0.2), _dressMat(0x46382b, { rough: 0.9 }));
    door.position.set(-1.4, h * 0.375, 3.3); g.add(door);
    const railBar = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.16, 0.16), iron);
    railBar.position.set(0, h * 0.78, 3.35); g.add(railBar);
    // Stacked sleepers against the wall.
    for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.4, 0.6), _dressMat(0x3f3128, { rough: 0.97 }));
        s.position.set(3.2, 0.2 + i * 0.42, 3.9 - (i % 2) * 0.3);
        s.rotation.y = (i % 2) * 0.08;
        g.add(s);
    }
    g.position.copy(pos);
    return g;
}

/** Cinder Mine: a rock face with timber shoring and an adit mouth. */
function _mkMineWorks(pos, seed) {
    const g = new THREE.Group();
    const rock   = _dressMat(0x3a322c, { rough: 0.98 });
    const timber = _dressMat(0x5b452e, { rough: 0.94 });
    // THE ROCK FACE IS A BACKDROP, NOT A WALL.
    //
    // The first pass built three boxes up to 7 wide and 9.5 tall at every node,
    // set 14 units back — from the street camera they closed the road off
    // completely and read as grey crates rather than as rock
    // (qa/shot-map-star_territory-street.png). They are also registered with
    // the occluder fader at the region's footprint half of 5.5, which an
    // 11-unit spread badly underestimates, so the fade could not rescue them.
    //
    // Now: tapered, few-sided prisms — the same shape language as the buttes in
    // Boot Hill and the mesas on the horizon — kept inside the footprint they
    // declare, and low enough to see the board over.
    // Varied hard, and near-plumb. The first fix made them the right SIZE and
    // left them identical: the same 62%-taper hexagon twenty-four times over,
    // in one grey, reads as a row of chess pawns. Three tones, a wide height
    // spread, and walls that stand almost vertical — rock is cut back at the
    // top by weather, not moulded.
    const tones = [0x3a322c, 0x2f2823, 0x453b33];
    for (let i = 0; i < 3; i++) {
        const r = 1.4 + _seeded(seed * 5 + i) * 2.4;
        const h = 2.2 + _seeded(seed * 7 + i) * 5.2;
        const slab = new THREE.Mesh(
            new THREE.CylinderGeometry(r * 0.84, r, h, 5 + Math.floor(_seeded(seed * 9 + i) * 3)),
            _dressMat(tones[Math.floor(_seeded(seed * 11 + i) * tones.length)], { rough: 0.99 }));
        slab.position.set((i - 1) * 3.0, h / 2, -0.6 - _seeded(seed + i) * 1.4);
        slab.rotation.y = _seeded(seed * 3 + i) * 1.4;
        slab.scale.z = 0.7 + _seeded(seed * 13 + i) * 0.7;
        g.add(slab);
    }
    // The adit: a timber frame round a black hole, which is the one shape that
    // says "you are underground" to a camera that cannot see a ceiling.
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 3.0),
        new THREE.MeshBasicMaterial({ color: 0x08060a }));
    mouth.position.set(0, 1.5, 2.35); g.add(mouth);
    [-1.5, 1.5].forEach(x => {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.42, 3.4, 0.42), timber);
        p.position.set(x, 1.7, 2.4); g.add(p);
    });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.45, 0.45), timber);
    lintel.position.set(0, 3.55, 2.4); g.add(lintel);
    // One lantern on the frame. The Mine's only light is the one somebody hung.
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: 0xff8a2a, emissiveIntensity: 1.4 }));
    lamp.position.set(1.5, 3.1, 2.7); g.add(lamp);
    g.position.copy(pos);
    return g;
}

/** Longhorn Ranch: barns and sheds under a gambrel roof. */
function _mkRanchBuilding(pos, seed) {
    const g = new THREE.Group();
    const red  = _dressMat(_seeded(seed * 3) > 0.45 ? 0x8e3a26 : 0x7d5232, { rough: 0.92 });
    const dark = _dressMat(0x46362a, { rough: 0.9 });
    const h = 4.4 + _seeded(seed * 5) * 2.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(9.5, h, 7), red);
    body.position.y = h / 2; g.add(body);
    // A GAMBREL ROOF, not a gable — two pitches a side. It is the barn
    // silhouette; a plain triangle reads as a house instead.
    [[-1, 0.9, 3.0, 0.85], [1, 0.9, 3.0, 0.85], [-1, 2.5, 1.0, 0.42], [1, 2.5, 1.0, 0.42]]
        .forEach(([sx, dy, dz, rot]) => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(9.8, 0.35, dz === 3.0 ? 3.0 : 2.6), dark);
            p.position.set(0, h + dy, sx * dz);
            p.rotation.x = sx * rot;
            g.add(p);
        });
    // Big double doors with an X brace, white-painted.
    const white = _dressMat(0xe4d9c2, { rough: 0.85 });
    [-1.3, 1.3].forEach(x => {
        const d = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.18), white);
        d.position.set(x, 1.7, 3.55); g.add(d);
        const br = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 0.06), dark);
        br.position.set(x, 1.7, 3.66); br.rotation.z = x > 0 ? 0.9 : -0.9; g.add(br);
    });
    // The loft door, up in the gable.
    const loft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.16), dark);
    loft.position.set(0, h + 0.4, 3.55); g.add(loft);
    g.position.copy(pos);
    return g;
}

/** Boot Hill: nothing is built out here. What stands beside the road is rock. */
function _mkBadlandsRock(pos, seed) {
    const g = new THREE.Group();
    const strata = [0xb09774, 0x967c58, 0xc2ad89, 0x7f6848];
    // ONE butte per plot, occasionally two. The first pass built two or three
    // small ones at every node and the whole territory read as gravel — twelve
    // nodes times two sides times three columns is seventy-odd rocks, which is
    // scree, not landscape.
    const n = _seeded(seed * 19) > 0.72 ? 2 : 1;
    for (let i = 0; i < n; i++) {
        // A butte is flat-topped and layered, which is what tells it apart from
        // a boulder — so these are stacked slabs of decreasing width, not a
        // sphere with noise on it.
        const h = 5.0 + _seeded(seed * 5 + i) * 8.0;
        const layers = 3 + Math.floor(_seeded(seed * 7 + i) * 3);
        const col = new THREE.Group();
        let y = 0;
        for (let k = 0; k < layers; k++) {
            const r = (5.2 - k * 0.6) * (0.75 + _seeded(seed + i * 3 + k) * 0.45);
            const lh = h / layers;
            const slab = new THREE.Mesh(
                new THREE.CylinderGeometry(r * 0.94, r, lh, 5 + (k % 3)),
                _dressMat(strata[(k + i) % strata.length], { rough: 0.99 }));
            slab.position.y = y + lh / 2;
            slab.rotation.y = _seeded(seed * 11 + k) * 1.2;
            col.add(slab);
            y += lh;
        }
        col.position.set((i - (n - 1) / 2) * 6.5, 0, (_seeded(seed * 13 + i) - 0.5) * 3);
        g.add(col);
    }
    // A leaning grave marker, because the road is called Boot Hill.
    if (_seeded(seed * 17) > 0.55) {
        const cross = new THREE.Group();
        const wood = _dressMat(0x6f5b3f, { rough: 0.97 });
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.0, 0.18), wood);
        up.position.y = 1.0; cross.add(up);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.16), wood);
        arm.position.y = 1.45; cross.add(arm);
        cross.position.set(4.6, 0, 3.4);
        cross.rotation.z = 0.18;
        g.add(cross);
    }
    g.position.copy(pos);
    return g;
}

// ---- The horizon --------------------------------------------------------
//
// City's is thirty-four towers facing the centre. The Territory's is the rock
// the whole board was cut out of: mesas and buttes, low and wide, in a much
// tighter colour range — a saturated silhouette two hundred units out is the
// strongest cue that a scene has no depth in it, and no amount of fog rescues
// it.
function _buildMesaHorizon() {
    const tints = [0x8d7554, 0x7a6349, 0x9c8462, 0x6d5a45, 0xa08a66];
    const mats = tints.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.98 }));
    const count = 24;
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (_sr(i * 3 + 1) - 0.5) * 0.2;
        // FAR ENOUGH TO BE HORIZON. The first pass put these at 118–158 against
        // a board of radius 72, and they crowded the lobes — from above they
        // read as beige boxes stacked round the tiles rather than as distance.
        // The board is bigger than City's, so its horizon has to be further out
        // than City's, not the same.
        const r = 155 + _sr(i * 5 + 2) * 55;
        // Mesas are WIDE and FLAT-TOPPED. The height range is deliberately
        // narrow and the width range is not: a horizon of tall thin shapes is a
        // skyline, and this one must not read as one.
        // WIDE AND LOW. At 30–50 units tall against a 22–56 width these still
        // read as slabs on end from the street camera — which is the one thing
        // a mesa horizon must not do, because a slab on end is a tower. The
        // height band is cut hard and the width band is not: the silhouette has
        // to be wider than it is tall, always.
        const tall = _sr(i * 7 + 4) > 0.8;
        const h = tall ? 17 + _sr(i * 11 + 5) * 10 : 8 + _sr(i * 13 + 6) * 7;
        const w = 40 + _sr(i * 17 + 7) * 50;
        // A TAPERED, FEW-SIDED PRISM, not a box. Cutting the top back and giving
        // it six faces is what makes a shape read as weathered rock; a box at
        // this distance reads as a building no matter what colour it is.
        // NEAR-VERTICAL WALLS. The taper was 0.34 top against 0.5 bottom — a 68%
        // ratio, which is a cooling tower, and photographing the street camera
        // showed a horizon of them. Real strata are cut back by weather at the
        // top and stand almost plumb below it, so the top is barely narrower
        // than the base and the flat cap does the talking.
        const mesa = new THREE.Mesh(
            new THREE.CylinderGeometry(w * 0.45, w * 0.5, h, 6, 1),
            mats[i % mats.length]);
        mesa.position.set(Math.cos(angle) * r, h / 2 - 1, Math.sin(angle) * r);
        mesa.rotation.y = _sr(i * 23 + 9) * 1.2;
        mesa.scale.z = 0.7 + _sr(i * 31) * 0.8;          // not one of them circular
        _cityEnvGroup.add(mesa);
        // A talus skirt at the foot, so the mesa grows out of the plain rather
        // than being set down on it.
        const skirt = new THREE.Mesh(
            new THREE.CylinderGeometry(w * 0.52, w * 0.78, h * 0.2, 6),
            mats[(i + 2) % mats.length]);
        skirt.position.set(mesa.position.x, h * 0.1 - 1, mesa.position.z);
        skirt.rotation.y = _sr(i * 29) * 1.0;
        skirt.scale.z = mesa.scale.z;
        _cityEnvGroup.add(skirt);
    }
}

// ---- Roadside props, one set per territory -----------------------------
//
// Two per node, one each side of the road, with gaps so it is not a fence.
// `r` is the seeded roll that chose this prop; `seed` varies everything else.

/** Perdition: hitching rails, troughs, barrels, a buckboard, boardwalk posts. */
function _propTownship(r, seed) {
    const g = new THREE.Group();
    const wood = _dressMat(0x6f5335, { rough: 0.94 });
    if (r < 0.26) {                                     // hitching rail
        [-1.5, 1.5].forEach(x => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.22), wood);
            p.position.set(x, 0.75, 0); g.add(p);
        });
        const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.18), wood);
        bar.position.y = 1.35; g.add(bar);
    } else if (r < 0.46) {                              // water trough
        const t = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 1.0), wood);
        t.position.y = 0.4; g.add(t);
        const water = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.78),
            new THREE.MeshPhysicalMaterial({ color: 0x4b6a63, roughness: 0.12, metalness: 0.2 }));
        water.rotation.x = -Math.PI / 2; water.position.y = 0.76; g.add(water);
    } else if (r < 0.62) {                              // stacked barrels
        const nb = 2 + Math.floor(_seeded(seed * 3) * 2);
        for (let i = 0; i < nb; i++) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 1.15, 10),
                _dressMat(0x7d4e2a, { rough: 0.9 }));
            b.position.set((i - (nb - 1) / 2) * 1.0, 0.58, _seeded(seed + i) * 0.4);
            g.add(b);
            const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.05, 5, 12),
                _dressMat(0x4a4a4a, { rough: 0.5, metal: 0.6 }));
            hoop.rotation.x = Math.PI / 2; hoop.position.copy(b.position); g.add(hoop);
        }
    } else if (r < 0.76) {                              // buckboard wagon
        const bed = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 1.6), wood);
        bed.position.y = 1.0; g.add(bed);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 1.5), _dressMat(0x54402a, { rough: 0.9 }));
        seat.position.set(-1.1, 1.6, 0); g.add(seat);
        [[-1.1, 0.85], [-1.1, -0.85], [1.2, 0.85], [1.2, -0.85]].forEach(([x, z], i) => {
            const rw = i < 2 ? 0.55 : 0.8;
            const wheel = new THREE.Mesh(new THREE.TorusGeometry(rw, 0.09, 6, 14),
                _dressMat(0x4a3520, { rough: 0.92 }));
            wheel.position.set(x, rw, z); g.add(wheel);
        });
    } else {                                            // boardwalk post + sign
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.6, 0.24), wood);
        p.position.y = 1.3; g.add(p);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 0.1),
            _dressMat(0xd8c49a, { rough: 0.85 }));
        sign.position.set(0.5, 2.2, 0); sign.rotation.z = -0.06; g.add(sign);
    }
    return g;
}

/** Ironwood Railyard: rail stacks, signal posts, a steaming stack, coal, handcars. */
function _propRailyard(r, seed) {
    const g = new THREE.Group();
    const iron = _dressMat(0x6a6f74, { rough: 0.5, metal: 0.65 });
    const tie  = _dressMat(0x3f3128, { rough: 0.97 });
    if (r < 0.24) {                                     // stacked rails
        for (let i = 0; i < 5; i++) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.22, 0.22), iron);
            bar.position.set(0, 0.12 + Math.floor(i / 2) * 0.26, (i % 2) * 0.32);
            g.add(bar);
        }
    } else if (r < 0.42) {                              // signal post with a lamp
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 4.0, 8), iron);
        p.position.y = 2.0; g.add(p);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.12),
            _dressMat(0xc2452c, { rough: 0.7 }));
        arm.position.set(0.7, 3.4, 0.14); g.add(arm);
        const lensMat = new THREE.MeshStandardMaterial({
            color: 0x3ddc6a, emissive: 0x22c55e, emissiveIntensity: 1.5 });
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), lensMat);
        lens.position.set(0, 3.85, 0.22); g.add(lens);
        _cityLive.push({ kind: 'beacon', mat: lensMat, seed: seed * 2 + 5 });
    } else if (r < 0.60) {                              // a stack, steaming
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 1.2, 10), tie);
        base.position.y = 0.6; g.add(base);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.62, 3.2, 10), iron);
        stack.position.y = 2.6; g.add(stack);
        const puffs = [];
        for (let i = 0; i < 5; i++) {
            const puff = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xe6e9ee, transparent: true, opacity: 0, depthWrite: false }));
            g.add(puff); puffs.push(puff);
        }
        _cityLive.push({ kind: 'steam', puffs, seed, rise: 7.5, base: 4.2, spread: 0.9 });
    } else if (r < 0.78) {                              // coal heap
        const heap = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.4, 9),
            _dressMat(0x1d1b1a, { rough: 0.98 }));
        heap.position.y = 0.7; g.add(heap);
        for (let i = 0; i < 5; i++) {
            const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + _seeded(seed + i) * 0.2),
                _dressMat(0x262322, { rough: 0.95 }));
            lump.position.set((_seeded(seed * 3 + i) - 0.5) * 3.2, 0.2, (_seeded(seed * 5 + i) - 0.5) * 2.2);
            g.add(lump);
        }
    } else {                                            // handcar on a short rail
        [-0.6, 0.6].forEach(z => {
            const rail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 0.14), iron);
            rail.position.set(0, 0.06, z); g.add(rail);
        });
        for (let i = 0; i < 4; i++) {
            const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 1.9), tie);
            t.position.set(-1.4 + i * 0.95, 0.02, 0); g.add(t);
        }
        const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.24, 1.4), _dressMat(0x6b5136, { rough: 0.9 }));
        bed.position.y = 0.5; g.add(bed);
        const lever = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.3, 0.14), iron);
        lever.position.set(0, 1.1, 0); lever.rotation.z = 0.35; g.add(lever);
    }
    return g;
}

/** Cinder Mine: ore carts, timber props, lantern hooks, spoil heaps, a winch. */
function _propMine(r, seed) {
    const g = new THREE.Group();
    const timber = _dressMat(0x5b452e, { rough: 0.94 });
    const iron   = _dressMat(0x4d4a46, { rough: 0.55, metal: 0.6 });
    if (r < 0.26) {                                     // ore cart
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.2), iron);
        body.position.y = 0.85; g.add(body);
        const ore = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.5, 7),
            _dressMat(0x6b4a30, { rough: 0.95 }));
        ore.position.y = 1.5; g.add(ore);
        [[-0.55, 0.5], [-0.55, -0.5], [0.55, 0.5], [0.55, -0.5]].forEach(([x, z]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10), iron);
            w.rotation.z = Math.PI / 2; w.position.set(x, 0.3, z); g.add(w);
        });
    } else if (r < 0.46) {                              // timber prop set
        [-0.8, 0.8].forEach(x => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.8, 0.34), timber);
            p.position.set(x, 1.4, 0); p.rotation.z = -x * 0.07; g.add(p);
        });
        const cap = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.34, 0.34), timber);
        cap.position.y = 2.9; g.add(cap);
    } else if (r < 0.66) {                              // lantern on a hook
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.4, 0.22), timber);
        p.position.y = 1.2; g.add(p);
        const hook = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), iron);
        hook.position.set(0, 2.3, 0.35); g.add(hook);
        const lampMat = new THREE.MeshStandardMaterial({
            color: 0xffd8a0, emissive: 0xff8f2a, emissiveIntensity: 1.6 });
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.42), lampMat);
        lamp.position.set(0, 1.95, 0.6); g.add(lamp);
        // The Mine's light is a flicker, not a glow — the 'neon' rig repurposed,
        // which is exactly what the spec asked for (lantern, not signage).
        _cityLive.push({ kind: 'neon', parts: [lampMat], seed: seed + 3 });
    } else if (r < 0.84) {                              // spoil heap
        const heap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.3, 8),
            _dressMat(0x453a31, { rough: 0.99 }));
        heap.position.y = 0.65; g.add(heap);
        for (let i = 0; i < 4; i++) {
            const r2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + _seeded(seed + i) * 0.25),
                _dressMat(0x3b332c, { rough: 0.98 }));
            r2.position.set((_seeded(seed * 3 + i) - 0.5) * 3, 0.25, (_seeded(seed * 7 + i) - 0.5) * 2);
            g.add(r2);
        }
    } else {                                            // hand winch over a shaft
        const hole = new THREE.Mesh(new THREE.CircleGeometry(0.9, 14),
            new THREE.MeshBasicMaterial({ color: 0x07060a }));
        hole.rotation.x = -Math.PI / 2; hole.position.y = 0.02; g.add(hole);
        [-1.1, 1.1].forEach(x => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.2, 0.26), timber);
            p.position.set(x, 1.1, 0); g.add(p);
        });
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.9, 10), timber);
        drum.rotation.z = Math.PI / 2; drum.position.y = 2.1; g.add(drum);
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6),
            _dressMat(0xbba475, { rough: 1 }));
        rope.position.y = 1.15; g.add(rope);
    }
    return g;
}

/** Longhorn Ranch: fence runs, hay bales, windmill pumps, troughs, feed sacks. */
function _propRanch(r, seed) {
    const g = new THREE.Group();
    const rail = _dressMat(0x8a6f4a, { rough: 0.94 });
    if (r < 0.30) {                                     // split-rail fence run
        for (let i = 0; i < 3; i++) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.5, 0.22), rail);
            p.position.set((i - 1) * 2.2, 0.75, 0); g.add(p);
        }
        [0.7, 1.25].forEach(y => {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.14, 0.14), rail);
            bar.position.y = y; g.add(bar);
        });
    } else if (r < 0.52) {                              // hay bales
        const nb = 2 + Math.floor(_seeded(seed * 3) * 2);
        for (let i = 0; i < nb; i++) {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12),
                _dressMat(0xc9a44e, { rough: 0.98 }));
            b.rotation.z = Math.PI / 2;
            b.position.set((i - (nb - 1) / 2) * 1.5, 0.75, _seeded(seed + i) * 0.5);
            g.add(b);
        }
    } else if (r < 0.70) {                              // windmill pump
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 5.0, 0.12),
                _dressMat(0x8a8f95, { rough: 0.55, metal: 0.5 }));
            leg.position.set(x * 0.55, 2.5, z * 0.55);
            leg.rotation.x = z * 0.07; leg.rotation.z = -x * 0.07;
            g.add(leg);
        });
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.3, 10),
            _dressMat(0x6f7378, { rough: 0.5, metal: 0.6 }));
        hub.rotation.x = Math.PI / 2; hub.position.set(0, 5.3, 0.3); g.add(hub);
        const fan = new THREE.Group();
        for (let i = 0; i < 10; i++) {
            const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 1.5),
                new THREE.MeshStandardMaterial({ color: 0xcfd4da, roughness: 0.6, side: THREE.DoubleSide }));
            blade.position.set(Math.cos(i / 10 * 6.283) * 0.85, Math.sin(i / 10 * 6.283) * 0.85, 0);
            blade.rotation.z = i / 10 * 6.283;
            fan.add(blade);
        }
        fan.position.set(0, 5.3, 0.45); g.add(fan);
        const vane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.7),
            new THREE.MeshStandardMaterial({ color: 0xb0453a, roughness: 0.8, side: THREE.DoubleSide }));
        vane.position.set(0, 5.3, -1.4); g.add(vane);
        _cityLive.push({ kind: 'windmill', fan, seed });
    } else if (r < 0.86) {                              // cattle trough
        const t = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.1),
            _dressMat(0x77603f, { rough: 0.94 }));
        t.position.y = 0.35; g.add(t);
        const water = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.9),
            new THREE.MeshPhysicalMaterial({ color: 0x53756b, roughness: 0.1, metalness: 0.2 }));
        water.rotation.x = -Math.PI / 2; water.position.y = 0.67; g.add(water);
    } else {                                            // feed sacks
        for (let i = 0; i < 3; i++) {
            const sack = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.7),
                _dressMat(0xd8c9a6, { rough: 0.97 }));
            sack.position.set((_seeded(seed + i) - 0.5) * 1.2, 0.28 + i * 0.5, (_seeded(seed * 3 + i) - 0.5) * 0.6);
            sack.rotation.y = _seeded(seed * 5 + i) * 0.6;
            g.add(sack);
        }
    }
    return g;
}

/** Boot Hill: cactus, steer skulls, boulders, dust devils, grave markers. */
function _propBadlands(r, seed) {
    const g = new THREE.Group();
    if (r < 0.26) {                                     // saguaro
        const green = _dressMat(0x4f7042, { rough: 0.95 });
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 3.4, 9), green);
        trunk.position.y = 1.7; g.add(trunk);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 9, 7), green);
        cap.position.y = 3.4; g.add(cap);
        [[-1, 0.35], [1, -0.15]].forEach(([sx, dy], i) => {
            if (_seeded(seed * 7 + i) < 0.35) return;
            const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.28, 1.3, 8), green);
            arm.position.set(sx * 0.72, 1.9 + dy, 0); arm.rotation.z = -sx * 1.15; g.add(arm);
            const up = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 1.1, 8), green);
            up.position.set(sx * 1.28, 2.5 + dy, 0); g.add(up);
            const tip = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), green);
            tip.position.set(sx * 1.28, 3.05 + dy, 0); g.add(tip);
        });
    } else if (r < 0.44) {                              // steer skull on the ground
        const bone = _dressMat(0xe4dcc4, { rough: 0.9 });
        const skull = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), bone);
        skull.scale.set(1, 0.7, 1.25); skull.position.y = 0.35; g.add(skull);
        const snout = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.6), bone);
        snout.position.set(0, 0.3, 0.75); g.add(snout);
        [-1, 1].forEach(sx => {
            const horn = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 5, 10, Math.PI * 0.8), bone);
            horn.position.set(sx * 0.45, 0.55, -0.1);
            horn.rotation.set(Math.PI / 2, 0, sx * 0.6);
            g.add(horn);
        });
    } else if (r < 0.62) {                              // boulder cluster
        for (let i = 0; i < 3; i++) {
            const s = 0.5 + _seeded(seed * 3 + i) * 1.1;
            const b = new THREE.Mesh(new THREE.DodecahedronGeometry(s),
                _dressMat([0x9c8462, 0x7f6848, 0xb09774][i % 3], { rough: 0.99 }));
            b.position.set((_seeded(seed * 5 + i) - 0.5) * 3.2, s * 0.7, (_seeded(seed * 7 + i) - 0.5) * 2.4);
            b.rotation.set(_seeded(seed + i) * 3, _seeded(seed * 2 + i) * 3, _seeded(seed * 4 + i) * 3);
            g.add(b);
        }
    } else if (r < 0.78) {                              // dust devil
        const parts = [];
        for (let i = 0; i < 6; i++) {
            const d = new THREE.Mesh(new THREE.SphereGeometry(0.45 + i * 0.12, 8, 6),
                new THREE.MeshBasicMaterial({ color: 0xd9c9a4, transparent: true, opacity: 0.16, depthWrite: false }));
            g.add(d); parts.push(d);
        }
        _cityLive.push({ kind: 'devil', parts, seed });
    } else {                                            // leaning grave marker
        const wood = _dressMat(0x6f5b3f, { rough: 0.97 });
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.1, 0.2), wood);
        up.position.y = 1.05; g.add(up);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.18), wood);
        arm.position.y = 1.55; g.add(arm);
        const mound = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 6),
            _dressMat(0x8d7a58, { rough: 0.99 }));
        mound.scale.set(1.3, 0.28, 0.9); mound.position.set(0, 0.1, 0.8); g.add(mound);
        g.rotation.z = (_seeded(seed * 11) - 0.5) * 0.36;
    }
    return g;
}

// ---- One landmark per territory ----------------------------------------
//
// Set well back from the road at the region's midpoint, so it reads as the
// thing the territory is named after from the flyover and from the map view.

/** Ironwood: the water tower, with a locomotive standing under the spout. */
function _lmWaterTower() {
    const g = new THREE.Group();
    const timber = _dressMat(0x6b4f33, { rough: 0.93 });
    const iron   = _dressMat(0x54595e, { rough: 0.5, metal: 0.65 });
    // Tank on four braced legs.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, 15, 0.7), timber);
        leg.position.set(x * 3.4, 7.5, z * 3.4);
        leg.rotation.x = z * 0.05; leg.rotation.z = -x * 0.05;
        g.add(leg);
    });
    [5, 10].forEach(y => {
        [[1, 0], [0, 1]].forEach(([ax, az]) => {
            const br = new THREE.Mesh(new THREE.BoxGeometry(ax ? 7.4 : 0.3, 0.3, az ? 7.4 : 0.3), timber);
            br.position.set(0, y, 0); g.add(br);
        });
    });
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(5.0, 5.0, 8.0, 16), timber);
    tank.position.y = 19; g.add(tank);
    const lid = new THREE.Mesh(new THREE.ConeGeometry(5.4, 2.4, 16), iron);
    lid.position.y = 24.2; g.add(lid);
    [16.2, 21.8].forEach(y => {
        const hoop = new THREE.Mesh(new THREE.TorusGeometry(5.05, 0.16, 6, 20), iron);
        hoop.rotation.x = Math.PI / 2; hoop.position.y = y; g.add(hoop);
    });
    // The spout, swung out over where the tender would stand.
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6.0, 8), iron);
    spout.position.set(6.5, 15.5, 0); spout.rotation.z = -0.9; g.add(spout);

    // A locomotive: boiler, cab, stack, wheels. Small beside the tower, which
    // is the right relationship — the tower is the landmark.
    const loco = new THREE.Group();
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 8, 14),
        _dressMat(0x23262a, { rough: 0.6, metal: 0.4 }));
    boiler.rotation.z = Math.PI / 2; boiler.position.set(1.5, 2.2, 0); loco.add(boiler);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.6, 3.4), _dressMat(0x5a2a22, { rough: 0.8 }));
    cab.position.set(-3.4, 3.0, 0); loco.add(cab);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.55, 2.6, 10),
        _dressMat(0x1d2024, { rough: 0.7 }));
    stack.position.set(4.4, 4.4, 0); loco.add(stack);
    const headlamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.9),
        new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffbe55, emissiveIntensity: 1.3 }));
    headlamp.position.set(5.6, 3.6, 0); loco.add(headlamp);
    for (let i = 0; i < 4; i++) {
        [-1.7, 1.7].forEach(z => {
            const r = i < 2 ? 1.1 : 0.8;
            const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 12),
                _dressMat(0x2e3237, { rough: 0.6, metal: 0.5 }));
            w.rotation.x = Math.PI / 2; w.position.set(-3.8 + i * 2.6, r, z); loco.add(w);
        });
    }
    const puffs = [];
    for (let i = 0; i < 6; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(1.0, 8, 6),
            new THREE.MeshBasicMaterial({ color: 0xe8ecf1, transparent: true, opacity: 0, depthWrite: false }));
        loco.add(puff); puffs.push(puff);
    }
    _cityLive.push({ kind: 'steam', puffs, seed: 61, rise: 12, base: 5.8, spread: 1.4, x: 4.4 });
    loco.position.set(-2, 0, 11);
    loco.rotation.y = 0.2;
    g.add(loco);
    return g;
}

/** Cinder Mine: the headframe over the shaft, and the tailings below it. */
function _lmHeadframe() {
    const g = new THREE.Group();
    const timber = _dressMat(0x5b452e, { rough: 0.95 });
    const iron   = _dressMat(0x4a4e52, { rough: 0.5, metal: 0.6 });
    // The A-frame: four legs raking in to a head. That is the silhouette.
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([x, z]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.75, 20, 0.75), timber);
        leg.position.set(x * 3.0, 10, z * 3.0);
        leg.rotation.x = z * 0.13; leg.rotation.z = -x * 0.13;
        g.add(leg);
    });
    [6, 12, 17].forEach(y => {
        [[1, 0], [0, 1]].forEach(([ax, az]) => {
            const br = new THREE.Mesh(new THREE.BoxGeometry(ax ? 6.6 : 0.35, 0.35, az ? 6.6 : 0.35), timber);
            br.position.y = y; g.add(br);
        });
    });
    const head = new THREE.Mesh(new THREE.BoxGeometry(5.0, 1.0, 5.0), timber);
    head.position.y = 20.2; g.add(head);
    // The sheave wheel — the one part everybody recognises.
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(3.0, 0.45, 8, 22), iron);
    wheel.position.set(0, 22.6, 0); g.add(wheel);
    for (let i = 0; i < 6; i++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.22, 0.22), iron);
        spoke.position.set(0, 22.6, 0); spoke.rotation.z = i * Math.PI / 6; g.add(spoke);
    }
    // The hoist cable running down the frame into the dark.
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 21, 6), iron);
    cable.position.set(0, 11, 0); g.add(cable);
    // Headhouse, with the furnace visible through the doorway.
    const shed = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 6), _dressMat(0x4b3d2d, { rough: 0.94 }));
    shed.position.set(-7.5, 2.5, 0); g.add(shed);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.4, 6.6), iron);
    roof.position.set(-7.5, 5.2, 0); g.add(roof);
    const glowMat = new THREE.MeshStandardMaterial({
        color: 0xff9a3c, emissive: 0xff6a12, emissiveIntensity: 1.8 });
    const furnace = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.0), glowMat);
    furnace.position.set(-4.0, 1.6, 0); furnace.rotation.y = Math.PI / 2; g.add(furnace);
    _cityLive.push({ kind: 'beacon', mat: glowMat, seed: 12 });
    const tailings = new THREE.Mesh(new THREE.ConeGeometry(9, 5.5, 12),
        _dressMat(0x453a31, { rough: 0.99 }));
    tailings.position.set(9, 2.4, 4); g.add(tailings);
    return g;
}

/** Longhorn Ranch: the great barn, with the corral fence running off it. */
function _lmGreatBarn() {
    const g = new THREE.Group();
    const red   = _dressMat(0x93402a, { rough: 0.92 });
    const dark  = _dressMat(0x3f3228, { rough: 0.9 });
    const white = _dressMat(0xe8ddc6, { rough: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 15), red);
    body.position.y = 6; g.add(body);
    // Gambrel roof — four slabs, two pitches a side.
    [[-1, 2.0, 5.2, 0.85], [1, 2.0, 5.2, 0.85], [-1, 5.0, 2.2, 0.40], [1, 5.0, 2.2, 0.40]]
        .forEach(([sx, dy, dz, rot]) => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(22.6, 0.5, dz === 5.2 ? 6.4 : 5.2), dark);
            p.position.set(0, 12 + dy, sx * dz);
            p.rotation.x = sx * rot;
            g.add(p);
        });
    // Big doors with the X brace, and a hay hood over the loft.
    [-2.9, 2.9].forEach(x => {
        const d = new THREE.Mesh(new THREE.BoxGeometry(5.4, 8, 0.3), white);
        d.position.set(x, 4, 7.6); g.add(d);
        const br = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.35, 0.1), dark);
        br.position.set(x, 4, 7.8); br.rotation.z = x > 0 ? 0.97 : -0.97; g.add(br);
    });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 2.4), dark);
    hood.position.set(0, 15.6, 8.4); hood.rotation.x = 0.35; g.add(hood);
    const loft = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.0, 0.3), dark);
    loft.position.set(0, 13.4, 7.6); g.add(loft);
    // Cupola and weather vane on the ridge.
    const cup = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), white);
    cup.position.y = 18.3; g.add(cup);
    const cupRoof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 4), dark);
    cupRoof.position.y = 20.2; cupRoof.rotation.y = Math.PI / 4; g.add(cupRoof);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.1), dark);
    vane.position.y = 21.4; g.add(vane);
    // The corral: a fence run off the side of the barn.
    const post = _dressMat(0x8a6f4a, { rough: 0.94 });
    for (let i = 0; i < 7; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.8, 0.3), post);
        p.position.set(-13 - i * 0.2, 0.9, -7 + i * 2.6); g.add(p);
        if (i > 0) {
            [0.85, 1.5].forEach(y => {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.6), post);
                bar.position.set(-13 - i * 0.2, y, -8.3 + i * 2.6); g.add(bar);
            });
        }
    }
    return g;
}

/** Boot Hill: the mesa, with the graves at its foot. */
function _lmMesa() {
    const g = new THREE.Group();
    const strata = [0xb09774, 0x967c58, 0xc2ad89, 0x7f6848, 0xa58c68];
    // Layered, flat-topped and WIDE. The layers make it a mesa rather than a
    // hill, and the flat top is what makes it Western.
    // THREE UNEQUAL BANDS, NOT SIX EVEN ONES.
    //
    // The first pass stepped six equal layers in by a constant each time, and it
    // rendered as a wedding cake — the regularity is the tell. Real strata are a
    // thick soft base, a thin hard ledge and a broad cap, and the cap being the
    // WIDEST thing above the ledge is what makes the silhouette a mesa.
    const bands = [
        { r0: 17.5, r1: 14.5, h: 7.0 },   // talus-buried base, tapering hard
        { r0: 14.5, r1: 13.6, h: 1.6 },   // the hard ledge that holds the rest up
        { r0: 13.4, r1: 12.4, h: 5.2 },   // the wall
    ];
    let y = 0;
    bands.forEach((b, k) => {
        const slab = new THREE.Mesh(new THREE.CylinderGeometry(b.r1, b.r0, b.h, 7),
            _dressMat(strata[k % strata.length], { rough: 0.99 }));
        slab.position.y = y + b.h / 2;
        slab.rotation.y = k * 0.3;
        slab.scale.z = 0.82;
        g.add(slab);
        y += b.h;
    });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(12.8, 13.0, 1.8, 7),
        _dressMat(0x8a7252, { rough: 0.99 }));
    cap.position.y = y + 0.9; cap.scale.z = 0.82; g.add(cap);
    // Boot Hill itself: a row of leaning crosses on the near slope.
    const wood = _dressMat(0x6f5b3f, { rough: 0.97 });
    for (let i = 0; i < 6; i++) {
        const cross = new THREE.Group();
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.24), wood);
        up.position.y = 1.2; cross.add(up);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.26, 0.2), wood);
        arm.position.y = 1.75; cross.add(arm);
        cross.position.set(-9 + i * 3.6, 0, 17 + _sr(i * 7) * 3.5);
        cross.rotation.z = (_sr(i * 11) - 0.5) * 0.5;
        cross.rotation.y = (_sr(i * 13) - 0.5) * 0.8;
        g.add(cross);
    }
    // A dead cottonwood on the flat, because the mesa on its own is geology.
    const bone = _dressMat(0x8c7a5e, { rough: 0.98 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 7, 8), bone);
    trunk.position.set(13, 3.5, 14); g.add(trunk);
    [[-1, 0.9], [1, 1.2], [-0.6, -0.8]].forEach(([sx, sz], i) => {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 3.6, 6), bone);
        br.position.set(13 + sx * 1.2, 6.4 + i * 0.5, 14 + sz * 1.0);
        br.rotation.set(sz * 0.7, 0, -sx * 0.8);
        g.add(br);
    });
    return g;
}

// ---- One span across each territory's road ------------------------------
//
// The element that makes a road feel like a PLACE rather than a surface:
// something you pass underneath. Each is the region's story in one object.

/** Perdition: the gallows-frame street sign over the road. */
function _spanGallowsSign(i) {
    const g = new THREE.Group();
    const wood = _dressMat(0x6b4a2c, { rough: 0.92 });
    _spanLegs(g, wood, 6.8, 0.5);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.2, 0.5, 0.5), wood);
    beam.position.y = 6.8; g.add(beam);
    // The board hangs from the beam on two chains, which is what makes it read
    // as a gallows frame rather than as a gateway.
    const board = new THREE.Mesh(new THREE.BoxGeometry(6.0, 1.8, 0.2),
        _dressMat(0xd6c19a, { rough: 0.88 }));
    board.position.set(0, 4.9, 0); g.add(board);
    [-2.2, 2.2].forEach(x => {
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 6),
            _dressMat(0x3f3f3f, { rough: 0.5, metal: 0.7 }));
        ch.position.set(x, 5.3, 0); g.add(ch);
    });
    const word = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x3a2a18 }));
    word.position.set(0, 5.0, 0.12); g.add(word);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.3),
        new THREE.MeshBasicMaterial({ color: 0x3a2a18 }));
    under.position.set(0, 4.4, 0.12); g.add(under);
    // A lantern on one leg, lit as the afternoon goes.
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffa93a, emissiveIntensity: 1.2 }));
    lamp.position.set(i ? SPAN_HALF : -SPAN_HALF, 5.6, 0.6); g.add(lamp);
    return g;
}

/** Ironwood: the signal gantry, arms out over the road. */
function _spanSignalGantry(i) {
    const g = new THREE.Group();
    const iron = _dressMat(0x6a6f74, { rough: 0.45, metal: 0.7 });
    _spanLegs(g, iron, 7.4, 0.42);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.0, 0.3, 0.9), iron);
    deck.position.y = 7.4; g.add(deck);
    // A lattice under the deck — a plain bar reads as scaffolding, a zigzag
    // reads as a railway structure.
    for (let k = -4; k <= 4; k++) {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.5, 0.18), iron);
        br.position.set(k * 1.6, 6.7, 0); br.rotation.z = (k % 2 ? 1 : -1) * 0.6; g.add(br);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.0, 0.14, 0.14), iron);
    rail.position.set(0, 8.3, 0.4); g.add(rail);
    // Two semaphore arms and their lamps, one stop, one clear.
    [[-3.2, 0xd63b22, 0xef4444], [3.2, 0x3ddc6a, 0x22c55e]].forEach(([x, col, em], k) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 0.12),
            _dressMat(col, { rough: 0.7 }));
        arm.position.set(x + 0.9, 6.2, 0.5); arm.rotation.z = k ? 0 : -0.55; g.add(arm);
        const lensMat = new THREE.MeshStandardMaterial({
            color: col, emissive: em, emissiveIntensity: 1.6 });
        const lens = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lensMat);
        lens.position.set(x, 5.6, 0.55); g.add(lens);
        if (k === (i % 2)) _cityLive.push({ kind: 'beacon', mat: lensMat, seed: 40 + k });
    });
    return g;
}

/** Cinder Mine: timber shoring over the road, and it is holding something up. */
function _spanShoring(i) {
    const g = new THREE.Group();
    const timber = _dressMat(0x5b452e, { rough: 0.95 });
    _spanLegs(g, timber, 5.6, 0.75);
    // A capping beam and a run of close-set planks — the shoring reads as
    // LOAD-BEARING, which is the whole feeling of being underground.
    const cap = new THREE.Mesh(new THREE.BoxGeometry(SPAN_HALF * 2 + 1.6, 0.7, 0.9), timber);
    cap.position.y = 5.9; g.add(cap);
    for (let k = -5; k <= 5; k++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 2.6),
            _dressMat(0x4a3826, { rough: 0.96 }));
        plank.position.set(k * 1.32, 6.4, 0);
        plank.rotation.x = (_seeded(k * 3 + i) - 0.5) * 0.1;
        g.add(plank);
    }
    // Angle braces into the walls.
    [-1, 1].forEach(sx => {
        const br = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.2, 0.5), timber);
        br.position.set(sx * (SPAN_HALF - 1.1), 4.2, 0);
        br.rotation.z = sx * 0.55;
        g.add(br);
    });
    // Two lanterns hung off the cap. The road below them is the only lit part.
    [-3.4, 3.4].forEach((x, k) => {
        const lampMat = new THREE.MeshStandardMaterial({
            color: 0xffd08a, emissive: 0xff8f2a, emissiveIntensity: 1.5 });
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), lampMat);
        lamp.position.set(x, 5.0, 0.5); g.add(lamp);
        _cityLive.push({ kind: 'neon', parts: [lampMat], seed: 70 + k + i * 2 });
    });
    return g;
}

/** Longhorn Ranch: the log gateway arch, with the brand hung under it. */
function _spanLogGate(i) {
    const g = new THREE.Group();
    const log = _dressMat(0x7d6142, { rough: 0.95 });
    // Round posts, not square — these are logs, and a box reads as milled.
    [-SPAN_HALF, SPAN_HALF].forEach(x => {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 6.4, 9), log);
        p.position.set(x, 3.2, 0); g.add(p);
        const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 1.0, 8),
            _dressMat(0x8a8474, { rough: 0.97 }));
        stone.position.set(x, 0.5, 0); g.add(stone);
    });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, SPAN_HALF * 2 + 1.0, 9), log);
    top.rotation.z = Math.PI / 2; top.position.y = 6.4; g.add(top);
    // The brand: a ring with a horn through it, hung on two chains.
    const brandMat = _dressMat(0x2f2a24, { rough: 0.6, metal: 0.4 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.16, 7, 18), brandMat);
    ring.position.set(0, 4.6, 0); g.add(ring);
    const horn = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.13, 6, 14, Math.PI), brandMat);
    horn.position.set(0, 4.8, 0.02); g.add(horn);
    [-1.0, 1.0].forEach(x => {
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6),
            _dressMat(0x3f3f3f, { rough: 0.5, metal: 0.7 }));
        ch.position.set(x, 5.7, 0); g.add(ch);
    });
    // A rail fence running away from the gate on one side.
    if (i === 0) {
        for (let k = 1; k <= 3; k++) {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.6, 0.26),
                _dressMat(0x8a6f4a, { rough: 0.94 }));
            p.position.set(SPAN_HALF + k * 2.2, 0.8, 0); g.add(p);
        }
    }
    return g;
}

/** Boot Hill: a dead cottonwood arched over the road, and one vulture on it. */
function _spanDeadCottonwood(i) {
    const g = new THREE.Group();
    const bone = _dressMat(0x9c8a6c, { rough: 0.98 });
    // Two trunks leaning in until their branches meet over the road. A dead
    // tree that has grown into an arch reads as a place nobody tends.
    [-1, 1].forEach(sx => {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.85, 7.2, 8), bone);
        trunk.position.set(sx * (SPAN_HALF - 0.4), 3.4, 0);
        trunk.rotation.z = -sx * 0.22;
        g.add(trunk);
        for (let k = 0; k < 3; k++) {
            const br = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.3, 3.6 + k * 0.9, 6), bone);
            br.position.set(sx * (SPAN_HALF - 1.6 - k * 0.8), 5.6 + k * 1.0, (_seeded(k * 3 + i) - 0.5) * 1.6);
            br.rotation.set((_seeded(k * 5 + i) - 0.5) * 0.5, 0, -sx * (0.85 + k * 0.16));
            g.add(br);
        }
    });
    // The two longest branches actually touch, which is what makes it a span.
    const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, SPAN_HALF * 1.5, 6), bone);
    cross.rotation.z = Math.PI / 2; cross.position.set(0, 8.2, 0.3); g.add(cross);
    // One vulture, hunched.
    const dark = _dressMat(0x2c2822, { rough: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 9, 7), dark);
    body.scale.set(1, 1.2, 0.8); body.position.set(1.4, 8.8, 0.3); g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6),
        _dressMat(0x8a5a4a, { rough: 0.9 }));
    head.position.set(1.4, 9.5, 0.45); g.add(head);
    return g;
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

// ---- Set dressing, lent to minigame stages ------------------------------
//
// StageSets builds a minigame's scenery from the same pieces the board's
// territories are dressed with, so High Noon's street is Perdition's street and
// not a lookalike. Every builder makes fresh geometry and materials, so a stage
// can dispose what it was given without touching the board.
export const PROP_KIT = {
    falseFront:  (pos, seed) => _mkFalseFront(pos, seed),
    lanternPost: pos => _mkLanternPost(pos),
    township:    (r, seed) => _propTownship(r, seed),
    badlandsRock: (pos, seed) => _mkBadlandsRock(pos, seed),
    // r in [0.62, 0.78) is the dust devil, which registers itself in the
    // board's own animation list — a stage must never ask for that one.
    badlands:    (r, seed) => _propBadlands(r >= 0.62 && r < 0.78 ? 0.9 : r, seed),
    // r in [0.24, 0.60) is the signal lamp and the steaming stack, which both
    // register in the board's animation list; a stage gets rails, coal or the
    // handcar.
    railyard:    (r, seed) => _propRailyard(r >= 0.24 && r < 0.6 ? 0.7 : r, seed),
    railShed:    (pos, seed) => _mkRailShed(pos, seed),
    // r in [0.46, 0.66) is the hanging lantern, which registers itself.
    mine:        (r, seed) => _propMine(r >= 0.46 && r < 0.66 ? 0.8 : r, seed),
};
