// ============================================================
// RENDERER — Three.js scene, circular city circuit map
// ============================================================

import { state } from '../core/GameState.js';
import { SPACE_META, DISTRICT_BIOMES, getBiomeForDistrict, ALLIES, CHAR_ICONS } from '../config/GameConfig.js';
import { CITY_GRAPH, ALL_NODES_ORDERED, JUNCTION_IDS } from '../config/BoardGraph.js';
import * as Physics from './Physics.js';

let scene, camera, renderer, clock;
let boardGrp, diceGrp;
const activeAnims   = [];
const floatingIcons = [];
const tileMeshes    = [];
const textureCache  = {};
const _camHelper    = new THREE.PerspectiveCamera();

// Node position map: nodeId → THREE.Vector3
const nodePositions = new Map();
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
    const idx = ALL_NODES_ORDERED.indexOf(nodeId);
    if (idx < 0) return 0;
    return idx / _camCurveLen;
}

// ---- Scene init ----

export function init(container) {
    container.innerHTML = '';
    buildNodePositions();

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0f0f1e, 0.008);

    const W = Math.max(window.innerWidth  || 300, 300);
    const H = Math.max(window.innerHeight || 500, 500);
    camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
    camera.position.set(0, 50, 60);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 60, 30); sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
    sun.shadow.camera.right = sun.shadow.camera.top = 80;
    scene.add(sun);

    boardGrp = new THREE.Group();
    diceGrp  = new THREE.Group();
    scene.add(boardGrp, diceGrp);

    buildCamCurve();
    _buildPathTubes();

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

function _getCachedTileTexture(spc, bInfo, overrideLabel, b) {
    const label = overrideLabel || spc.n;
    const key   = `${spc.e}_${bInfo.floorEdge}_${spc.ic}_${label}_${b?.owner ?? ''}`;
    if (textureCache[key]) return textureCache[key];
    const tcx = document.createElement('canvas').getContext('2d');
    tcx.canvas.width = tcx.canvas.height = 256;
    tcx.fillStyle = '#' + spc.e.toString(16).padStart(6, '0');
    tcx.fillRect(0, 0, 256, 256);
    tcx.strokeStyle = '#' + bInfo.floorEdge.toString(16).padStart(6, '0');
    tcx.lineWidth = 14; tcx.strokeRect(7, 7, 242, 242);
    tcx.textAlign = 'center'; tcx.textBaseline = 'middle';
    tcx.font = '80px serif'; tcx.fillText(spc.ic, 128, 90);
    tcx.font = 'bold 34px "Bebas Neue",sans-serif'; tcx.fillStyle = '#fff';
    const words = label.split(' ');
    if (words.length > 1) { tcx.fillText(words[0], 128, 168); tcx.fillText(words.slice(1).join(' '), 128, 208); }
    else tcx.fillText(words[0], 128, 188);
    const tex = new THREE.CanvasTexture(tcx.canvas);
    textureCache[key] = tex;
    return tex;
}

// ---- Draw tiles ----

export function drawTiles() {
    tileMeshes.forEach(m => boardGrp.remove(m));
    floatingIcons.splice(4); // keep the 4 junction spheres at the front
    tileMeshes.length = 0;

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

        const baseMat  = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, metalness: 0.1, clearcoat: 0.2, emissive: emColor, emissiveIntensity: 0.45 });
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
    state.players.forEach(p => {
        p.mesh = createCharacterMesh(p.charType, p.color);
        const pos = getPos('r1').clone();
        pos.x += p.id === 0 ? -1.2 : 1.2;
        p.mesh.position.set(pos.x, 0, pos.z);
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

export function updateBiomeVisuals(district) {
    const b = getBiomeForDistrict(district || 'ring');
    document.getElementById('bg-gradient').style.background = `linear-gradient(to bottom, ${b.bgTop}, ${b.bgBot})`;
    if (scene && scene.fog) scene.fog.color.set(b.fog);
}

// ---- Player hop animation ----

export function animatePlayerHop(player, targetNodeId, onComplete) {
    const dest = getPos(targetNodeId).clone();
    // Side offset so two players don't overlap
    const nextId = CITY_GRAPH[targetNodeId]?.next?.[0];
    if (nextId && !JUNCTION_IDS.has(nextId)) {
        const nextPos = getPos(nextId);
        const fwd     = new THREE.Vector3().subVectors(nextPos, dest).normalize();
        const right   = new THREE.Vector3(0, 1, 0).cross(fwd).normalize();
        if (right.lengthSq() > 0.001) dest.addScaledVector(right, player.id === 0 ? -0.7 : 0.7);
        player.mesh.lookAt(dest.clone().add(fwd));
    }
    dest.y = 0;
    player.prevPos = player.pos;
    activeAnims.push({
        obj: player.mesh.position, start: player.mesh.position.clone(), to: dest,
        dur: 0.35, isHop: true, onComplete,
    });
}

// ---- Flyover (game start) ----

export function startFlyover(onComplete) {
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

    const cs = state.cameraState;
    if (cs === 'FOLLOW') {
        const p = state.players[state.activePlayer];
        if (p?.mesh?.position) {
            const prevPt  = getPos(p.prevPos || p.pos);
            const currPt  = p.mesh.position;
            const fwd     = new THREE.Vector3().subVectors(currPt, prevPt).normalize();
            if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1);
            const behind  = (state.playStyle === 'tabletop' && state.activePlayer === 1) ? 14 : -14;
            const camTgt  = currPt.clone().addScaledVector(fwd, behind).add(new THREE.Vector3(0, 22, 0));
            if (!isNaN(camTgt.x)) camera.position.lerp(camTgt, 0.055);
            _camHelper.position.copy(camera.position);
            _camHelper.lookAt(currPt.clone().add(new THREE.Vector3(0, 1, 0)));
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

export function cleanup() {
    Object.values(textureCache).forEach(t => t.dispose());
    Object.keys(textureCache).forEach(k => delete textureCache[k]);
    tileMeshes.forEach(m => { try { m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); } catch(e){} });
    tileMeshes.length = 0;
    floatingIcons.length = 0;
    activeAnims.length = 0;
    if (renderer) { renderer.dispose(); renderer = null; }
}
