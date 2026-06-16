// ============================================================
// RENDERER — Three.js scene, city circuit + hundred block dash
// ============================================================

import { state } from '../core/GameState.js';
import { SPACE_META, DISTRICT_BIOMES, getBiomeForDistrict, HBD_BIOMES, getBiomeForSpace, ALLIES, CHAR_ICONS, HBD_GATE_POS } from '../config/GameConfig.js';
import { CITY_GRAPH, ALL_NODES_ORDERED, JUNCTION_IDS } from '../config/BoardGraph.js';
import * as Physics from './Physics.js';

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
// HBD linear path positions: index 0-99 → THREE.Vector3
const hbdPositions  = [];
export let boardCurve = null; // HBD CatmullRom curve, null for City Circuit
// Ally mesh markers on map: nodeId → mesh
const allyMarkers   = new Map();

export function getActiveAnims() { return activeAnims; }

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
    if (typeof nodeId === 'number') return hbdPositions[Math.max(0, Math.min(nodeId, 99))] || new THREE.Vector3();
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
    if (typeof nodeId === 'number') return nodeId / 99;
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
    const pts = boardCurve.getSpacedPoints(99);
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
    scene.add(new THREE.AmbientLight(isHBD ? 0x9977bb : 0xfff0d0, isHBD ? 0.52 : 1.2));
    const sun = new THREE.DirectionalLight(isHBD ? 0xfff4d0 : 0xfff8e8, isHBD ? 1.05 : 2.0);
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

    if (isHBD) {
        _buildHBDPath();
    } else {
        buildCamCurve();
        _buildPathTubes();
        _buildCityScene();
    }

    Physics.init();
    drawTiles();
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
    tileMeshes.forEach(m => boardGrp.remove(m));
    tileMeshes.length = 0;

    if (Array.isArray(state.board)) {
        // ---- HBD: integer-indexed array ----
        floatingIcons.length = 0;
        state.board.forEach((b, i) => {
            const isGate = (i === HBD_GATE_POS);
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
            if (i < 99) baseMesh.lookAt(getPos(i + 1).clone().setY(0));
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
    floatingIcons.splice(4); // keep the 4 junction spheres at the front

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
    const t = Math.max(0.001, Math.min(idx / 99, 0.999));
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
        floatingIcons.push({ mesh: gem, baseY: 7.6, speed: 1.1, phase: x > 0 ? Math.PI : 0, group: gateGrp });
    });
    boardGrp.add(gateGrp); tileMeshes.push(gateGrp);
}

function _buildHBDShopMesh(idx, pos) {
    const shopGrp = new THREE.Group();
    const t = Math.max(0.001, Math.min(idx / 99, 0.999));
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
        floatingIcons.push({ mesh: gem, baseY: 7.6, speed: 1.1, phase: x > 0 ? Math.PI : 0, group: gateGrp });
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
    floatingIcons.push({ mesh: sign, baseY: 3.6, speed: 1.6, phase: Math.random() * Math.PI * 2, group: shopGrp });
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
    floatingIcons.push({ mesh: star, baseY: 5.8, speed: 1.2, phase: Math.random() * Math.PI * 2, group: hqGrp });
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
    floatingIcons.push({ mesh: iconMesh, baseY: 2.0, speed: 1.4 + Math.random() * 0.6, phase: Math.random() * Math.PI * 2 });
}

// ---- Character meshes ----

export function createCharacterMesh(type, colorCode) {
    const group  = new THREE.Group();
    const mat    = new THREE.MeshStandardMaterial({ color: colorCode, roughness: 0.5, metalness: 0.1 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const eye = (x,y,z,r=0.1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r), eyeMat); m.position.set(x,y,z); group.add(m); };

    if (type === 'slime') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 16), mat); body.scale.set(1, 0.7, 1); body.position.y = 0.5; group.add(body);
        eye(0.3, 0.6, 0.5); eye(-0.3, 0.6, 0.5);
    } else if (type === 'ghost') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.2, 16), mat); body.position.y = 0.6; group.add(body);
        const top  = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), mat); top.position.y = 1.2; group.add(top);
        eye(0.25, 1.1, 0.5, 0.12); eye(-0.25, 1.1, 0.5, 0.12);
    } else if (type === 'boxy') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat); body.position.y = 0.6; group.add(body);
        const eyeMp = new THREE.MeshBasicMaterial({ color: 0x000000 });
        const e1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), eyeMp); e1.position.set(0.3, 0.7, 0.61); group.add(e1);
        const e2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), eyeMp); e2.position.set(-0.3, 0.7, 0.61); group.add(e2);
    } else if (type === 'bunny') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), mat); body.position.y = 0.6; group.add(body);
        const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.8);
        const ear1   = new THREE.Mesh(earGeo, mat); ear1.position.set(0.3, 1.4, 0); ear1.rotation.z = -0.2; group.add(ear1);
        const ear2   = new THREE.Mesh(earGeo, mat); ear2.position.set(-0.3, 1.4, 0); ear2.rotation.z = 0.2; group.add(ear2);
        eye(0.2, 0.6, 0.55, 0.08); eye(-0.2, 0.6, 0.55, 0.08);
    } else if (type === 'cabbie') {
        // Round body + taxi-cap disc + yellow accent
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 14), mat); body.position.y = 0.65; group.add(body);
        const cap  = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.12, 12), new THREE.MeshStandardMaterial({ color: 0x1a1a1a })); cap.position.y = 1.4; group.add(cap);
        const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.06, 6, 12), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 0.6 })); stripe.position.y = 1.4; stripe.rotation.x = Math.PI/2; group.add(stripe);
        eye(0.28, 0.7, 0.55); eye(-0.28, 0.7, 0.55);
    } else if (type === 'vendor') {
        // Rounder body + apron + chef hat
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 14), mat); body.scale.set(1.1, 0.9, 1); body.position.y = 0.65; group.add(body);
        const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide })); apron.position.set(0, 0.55, 0.62); group.add(apron);
        const hatBrim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xffffff })); hatBrim.position.y = 1.35; group.add(hatBrim);
        const hatTop  = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0xffffff })); hatTop.position.y = 1.7; group.add(hatTop);
        eye(0.28, 0.68, 0.62); eye(-0.28, 0.68, 0.62);
    } else if (type === 'banker') {
        // Tall slim cylinder body + top hat + briefcase
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 1.3, 10), mat); body.position.y = 0.65; group.add(body);
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x111111 })); brim.position.y = 1.45; group.add(brim);
        const hatBody = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0x111111 })); hatBody.position.y = 1.85; group.add(hatBody);
        const brief  = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.15), new THREE.MeshStandardMaterial({ color: 0x78350f })); brief.position.set(0, 0.5, 0.55); group.add(brief);
        const briefHandle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 10, Math.PI), new THREE.MeshStandardMaterial({ color: 0x4a2008 })); briefHandle.position.set(0, 0.72, 0.55); group.add(briefHandle);
        eye(0.2, 0.95, 0.42); eye(-0.2, 0.95, 0.42);
    } else if (type === 'bodyguard') {
        // Wide boxy body + shoulder pads + visor
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.0), mat); body.position.y = 0.7; group.add(body);
        const shMat = new THREE.MeshStandardMaterial({ color: 0x374151 });
        const sh1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.9), shMat); sh1.position.set( 1.0, 1.05, 0); group.add(sh1);
        const sh2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.9), shMat); sh2.position.set(-1.0, 1.05, 0); group.add(sh2);
        const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0x1e293b })); head.position.y = 1.7; group.add(head);
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.15), new THREE.MeshStandardMaterial({ color: 0xff6b00, emissive: 0xff4400, emissiveIntensity: 1.0, transparent: true, opacity: 0.7 })); visor.position.set(0, 1.75, 0.5); group.add(visor);
    } else if (type === 'investor') {
        // Normal sphere body + upward arrow on top
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.65, 14, 14), mat); body.position.y = 0.65; group.add(body);
        const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x15803d, emissiveIntensity: 0.8 })); arrowShaft.position.y = 1.7; group.add(arrowShaft);
        const arrowHead  = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x15803d, emissiveIntensity: 0.8 })); arrowHead.position.y = 2.3; group.add(arrowHead);
        eye(0.28, 0.7, 0.55); eye(-0.28, 0.7, 0.55);
    }

    const dir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dir.position.set(0, 0.1, 0.6); group.add(dir);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
}

function buildPlayerMeshes() {
    const isHBD = state.selectedMap === 'hundred_block_dash';
    state.players.forEach(p => {
        p.mesh = createCharacterMesh(p.charType, p.color);
        if (isHBD) {
            const idx = typeof p.pos === 'number' ? p.pos : 0;
            const pos = getPos(idx).clone();
            const tangent = boardCurve.getTangent(Math.max(0, Math.min(1, idx / 99)));
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

export function placeAllyMarker(nodeId, allyType) {
    removeAllyMarker();
    const ally = ALLIES[allyType];
    if (!ally || !nodeId) return;
    const pos  = getPos(nodeId).clone(); pos.y = 3.5;
    const mat  = new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 2.0, metalness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.9), mat);
    mesh.position.copy(pos);
    scene.add(mesh);
    allyMarkers.set('current', mesh);
    floatingIcons.push({ mesh, baseY: 3.5, speed: 2.0, phase: 0 });
}

export function removeAllyMarker() {
    const m = allyMarkers.get('current');
    if (m) { scene.remove(m); allyMarkers.delete('current'); }
    const idx = floatingIcons.findIndex(f => f.mesh === allyMarkers.get('current'));
    if (idx >= 0) floatingIcons.splice(idx, 1);
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

export function animatePlayerHop(player, targetNodeId, onComplete) {
    const dest = getPos(targetNodeId).clone();
    dest.y = 0;
    if (typeof targetNodeId === 'number') {
        // HBD: use curve tangent for orientation
        if (boardCurve) {
            const t = Math.max(0.001, Math.min(targetNodeId / 99, 0.999));
            const tangent = boardCurve.getTangent(t).normalize();
            const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
            dest.addScaledVector(right, player.id === 0 ? -0.7 : 0.7);
            player.mesh.lookAt(dest.clone().add(tangent));
        }
    } else {
        // City Circuit: use graph next node for orientation
        const nextId = CITY_GRAPH[targetNodeId]?.next?.[0];
        if (nextId && !JUNCTION_IDS.has(nextId)) {
            const nextPos = getPos(nextId);
            const fwd     = new THREE.Vector3().subVectors(nextPos, dest).normalize();
            const right   = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
            if (right.lengthSq() > 0.001) dest.addScaledVector(right, player.id === 0 ? -0.7 : 0.7);
            player.mesh.lookAt(dest.clone().add(fwd));
        }
    }
    player.prevPos = player.pos;
    activeAnims.push({
        obj: player.mesh.position, start: player.mesh.position.clone(), to: dest,
        dur: 0.35, isHop: true, onComplete,
    });
}

// ---- Flyover (game start) ----

export function startFlyover(onComplete) {
    if (state.selectedMap === 'hundred_block_dash') {
        // Linear flyover: sweep along boardCurve
        const flyObj = { p: 0 };
        activeAnims.push({
            obj: flyObj, start: { p: 0 }, to: { p: 1.0 }, dur: 5.5,
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
            dur: 4.5,
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
        if (onComplete) onComplete();
        return;
    }
    const rearPos = Math.min(...state.players
        .filter(p => typeof p.pos === 'number')
        .map(p => p.pos));
    const rearT = Math.max(0.001, Math.min(rearPos / 99, 0.999));
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

export function setMapCameraTarget(nodeId, offsetY = 50, offsetZ = 30) {
    const pt = typeof nodeId === 'string' ? getPos(nodeId) : (nodePositions.get(ALL_NODES_ORDERED[nodeId]) || new THREE.Vector3());
    mapCam.targetPos.copy(pt).add(new THREE.Vector3(0, offsetY, offsetZ));
    mapCam.targetLook.copy(pt);
    mapCam.dragCamStart.copy(mapCam.targetPos);
    mapCam.dragLookStart.copy(mapCam.targetLook);
}

export function getDiceGroup() { return diceGrp; }
export function getCamera()    { return camera;  }

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

    Physics.step(dt);

    for (let i = activeAnims.length - 1; i >= 0; i--) {
        const a = activeAnims[i];
        a.t = (a.t || 0) + dt;
        const p    = a.dur > 0 ? Math.min(a.t / a.dur, 1) : 1;
        const ease = 1 - Math.pow(1 - p, 3);
        if (a.obj && a.to) {
            if (a.obj.isVector3) {
                a.obj.lerpVectors(a.start, a.to, ease);
                if (a.isHop) a.obj.y = a.to.y + Math.sin(p * Math.PI) * 2.5;
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
        if (p?.mesh?.position) {
            const currPt = p.mesh.position;
            let fwd;
            if (state.selectedMap === 'hundred_block_dash' && boardCurve && typeof p.pos === 'number') {
                const t = Math.max(0.001, Math.min(p.pos / 99, 0.999));
                fwd = boardCurve.getTangent(t).clone().normalize();
            } else {
                const prevPt = getPos(p.prevPos || p.pos);
                fwd = new THREE.Vector3().subVectors(currPt, prevPt).normalize();
                if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
            }
            const camOffset = -14;
            const camTgt = currPt.clone().addScaledVector(fwd, camOffset).add(new THREE.Vector3(0, 22, 0));
            if (!isNaN(camTgt.x)) camera.position.lerp(camTgt, 0.055);
            _camHelper.position.copy(camera.position);
            const lookTarget = state.selectedMap === 'hundred_block_dash'
                ? currPt.clone().addScaledVector(fwd, 10)
                : currPt.clone().add(new THREE.Vector3(0, 1, 0));
            _camHelper.lookAt(lookTarget);
            camera.quaternion.slerp(_camHelper.quaternion, 0.07);
        }
    } else if (cs === 'MAP') {
        camera.position.lerp(mapCam.targetPos, 0.1);
        _camHelper.position.copy(camera.position);
        _camHelper.lookAt(mapCam.targetLook);
        camera.quaternion.slerp(_camHelper.quaternion, 0.1);
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

    return grp;
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
    _CM = _initCityMaterials();
    _cityEnvGroup = new THREE.Group();
    scene.add(_cityEnvGroup);

    _buildCityGround();
    _buildCityCenter();
    _buildAllDistrictBuildings();
    _buildStreetLamps();
}

export function cleanup() {
    if (_cityEnvGroup) { scene?.remove(_cityEnvGroup); _cityEnvGroup = null; }
    if (_CM) { Object.values(_CM).forEach(m => { try { m.dispose?.(); } catch(e){} }); _CM = null; }
    Object.values(textureCache).forEach(t => t.dispose());
    Object.keys(textureCache).forEach(k => delete textureCache[k]);
    tileMeshes.forEach(m => { try { m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); } catch(e){} });
    tileMeshes.length = 0;
    floatingIcons.length = 0;
    activeAnims.length = 0;
    if (renderer) { renderer.dispose(); renderer = null; }
}
