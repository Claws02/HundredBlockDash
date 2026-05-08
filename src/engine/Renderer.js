// ============================================================
// RENDERER — all Three.js: scene, meshes, tiles, camera, loop
// Knows nothing about game rules. Reads state; draws pixels.
// ============================================================

import { state } from '../core/GameState.js';
import { SPACE_META, BIOMES, getBiomeForSpace, GATE_POS, SHOP_SPACES, EARLY_POOL_WEIGHTS, LATE_POOL_WEIGHTS } from '../config/GameConfig.js';
import * as Physics from './Physics.js';

let scene, camera, renderer, clock;
let boardGrp, diceGrp;
export let boardCurve, boardPoints;
let pathMesh;
const activeAnims  = [];
const floatingIcons = [];
const tileMeshes   = [];
const textureCache = {};
const _camHelper   = new THREE.PerspectiveCamera();
let _onPhysicsSettle = null;

export function getActiveAnims() { return activeAnims; }

// Shared geometries (created once, reused across tiles)
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

export function getPos(idx) {
    return boardPoints[Math.max(0, Math.min(idx, 99))];
}

// ---- Scene init ----

export function init(container) {
    container.innerHTML = '';
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(BIOMES[0].fog, 0.014);

    const W = Math.max(window.innerWidth  || 300, 300);
    const H = Math.max(window.innerHeight || 500, 500);
    camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 1000);
    camera.position.set(0, 30, 35); camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 50, 20); sun.castShadow = true;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
    sun.shadow.camera.right = sun.shadow.camera.top = 30;
    scene.add(sun);

    boardGrp = new THREE.Group();
    diceGrp  = new THREE.Group();
    scene.add(boardGrp, diceGrp);

    buildBoardCurve();

    const tubeGeo = new THREE.TubeGeometry(boardCurve, 200, 1.5, 8, false);
    const tubeMat = new THREE.MeshStandardMaterial({
        color: BIOMES[0].pathTint, emissive: BIOMES[0].pathTint,
        transparent: true, opacity: 0.15, roughness: 0.8,
    });
    pathMesh = new THREE.Mesh(tubeGeo, tubeMat);
    pathMesh.position.y = -0.5;
    boardGrp.add(pathMesh);

    Physics.init();
    drawTiles();
    buildPlayerMeshes();

    clock = new THREE.Clock();
    startLoop();
}

function buildBoardCurve() {
    const waypoints = [
        new THREE.Vector3(0, 0, 0),    new THREE.Vector3(0, 0, -30),
        new THREE.Vector3(40, 0, -60), new THREE.Vector3(60, 0, -100),
        new THREE.Vector3(20, 0, -140), new THREE.Vector3(-40, 0, -160),
        new THREE.Vector3(-60, 0, -200), new THREE.Vector3(-20, 0, -240),
        new THREE.Vector3(30, 0, -280), new THREE.Vector3(40, 0, -320),
        new THREE.Vector3(0, 0, -360), new THREE.Vector3(-40, 0, -400),
    ];
    boardCurve  = new THREE.CatmullRomCurve3(waypoints);
    boardPoints = boardCurve.getSpacedPoints(99);
}

// ---- Tile texture cache ----

function getCachedTileTexture(spc, bInfo, overrideLabel = null, b = {}) {
    const label = overrideLabel || spc.n;
    const key   = `${spc.e}_${bInfo.floorEdge}_${spc.ic}_${label}_${state.gateOpen ? 'o' : 'c'}_${b.owner ?? ''}`;
    if (textureCache[key]) return textureCache[key];
    const tcx = document.createElement('canvas').getContext('2d');
    tcx.canvas.width = tcx.canvas.height = 256;
    tcx.fillStyle = '#' + spc.e.toString(16).padStart(6, '0');
    tcx.fillRect(0, 0, 256, 256);
    tcx.strokeStyle = '#' + bInfo.floorEdge.toString(16).padStart(6, '0');
    tcx.lineWidth = 14; tcx.strokeRect(7, 7, 242, 242);
    tcx.textAlign = 'center'; tcx.textBaseline = 'middle';
    tcx.font = '80px serif';
    tcx.fillText(spc.ic, 128, 90);
    tcx.font = 'bold 34px "Bebas Neue",sans-serif';
    tcx.fillStyle = '#fff';
    const words = label.split(' ');
    if (words.length > 1) {
        tcx.fillText(words[0], 128, 168);
        tcx.fillText(words.slice(1).join(' '), 128, 208);
    } else {
        tcx.fillText(words[0], 128, 188);
    }
    const tex = new THREE.CanvasTexture(tcx.canvas);
    textureCache[key] = tex;
    return tex;
}

// ---- Tile drawing ----

export function drawTiles() {
    tileMeshes.forEach(m => boardGrp.remove(m));
    floatingIcons.forEach(f => boardGrp.remove(f.mesh));
    tileMeshes.length = 0; floatingIcons.length = 0;

    state.board.forEach((b, i) => {
        const isGate = (i === GATE_POS);
        const spc    = SPACE_META[b.type] || SPACE_META.coin;
        const bInfo  = getBiomeForSpace(i);
        const label  = b.type === 'player_trap' ? 'TOLL' : (isGate && state.gateOpen ? 'OPEN GATE' : null);
        const tex    = getCachedTileTexture(spc, bInfo, label, b);

        let emColor = isGate ? (state.gateOpen ? 0x22c55e : 0xb45309) : spc.e;
        if (b.type === 'player_trap') emColor = state.players[b.owner] ? state.players[b.owner].color : 0xf97316;

        const baseMat  = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, metalness: 0.1, clearcoat: 0.2, emissive: emColor, emissiveIntensity: 0.4 });
        const baseMesh = new THREE.Mesh(_hexGeo, baseMat);
        baseMesh.receiveShadow = true; baseMesh.castShadow = true;
        const pos = getPos(i);
        baseMesh.position.copy(pos);
        if (i < 99) baseMesh.lookAt(getPos(i + 1));
        else baseMesh.lookAt(getPos(i).clone().add(boardCurve.getTangent(1)));
        baseMesh.userData = { idx: i };
        tileMeshes.push(baseMesh);
        boardGrp.add(baseMesh);

        if (isGate) _buildGateMesh(i, pos);
        else if (b.type === 'shop') _buildShopMesh(i, pos);
        else if (spc.geo && GEOS[spc.geo]) _buildFloatingIcon(i, pos, spc, b);
    });
}

export function updateSingleTile() { drawTiles(); }

export function getTileMeshes() { return tileMeshes; }

function _buildGateMesh(i, pos) {
    const gateOpen  = state.gateOpen;
    const gateColor = gateOpen ? 0x4ade80 : 0xfbbf24;
    const gateEmit  = gateOpen ? 0x22c55e : 0xb45309;
    const gateMat   = new THREE.MeshPhysicalMaterial({ color: gateColor, emissive: gateEmit, emissiveIntensity: 1.2, metalness: 0.95, roughness: 0.05 });
    const gateGrp   = new THREE.Group();
    gateGrp.position.copy(pos);
    const tangent = (i < 99)
        ? new THREE.Vector3().subVectors(getPos(i + 1), pos).normalize()
        : boardCurve.getTangent(0.999).normalize();
    gateGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const pillarGeo = new THREE.BoxGeometry(0.55, 7, 0.55);
    [-2.2, 2.2].forEach(x => {
        const p = new THREE.Mesh(pillarGeo, gateMat); p.position.set(x, 3.5, 0); p.castShadow = true; gateGrp.add(p);
    });
    const cross = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.6, 0.55), gateMat); cross.position.set(0, 7.2, 0); cross.castShadow = true; gateGrp.add(cross);
    const arch  = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.28, 8, 20, Math.PI), gateMat); arch.position.set(0, 7.2, 0); arch.rotation.z = Math.PI; arch.castShadow = true; gateGrp.add(arch);

    const barMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0x86efac : 0xfcd34d, emissive: gateEmit, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.15, transparent: gateOpen, opacity: gateOpen ? 0.35 : 1.0 });
    const barGeo = new THREE.BoxGeometry(0.22, 4.2, 0.22);
    for (let b = -2; b <= 2; b++) { const bar = new THREE.Mesh(barGeo, barMat); bar.position.set(b * 0.88, 3.1, 0); bar.castShadow = true; gateGrp.add(bar); }

    const gemMat = new THREE.MeshPhysicalMaterial({ color: gateOpen ? 0xffffff : 0xfef08a, emissive: gateOpen ? 0x4ade80 : 0xfbbf24, emissiveIntensity: 2.0, transparent: true, opacity: 0.9 });
    [-2.2, 2.2].forEach(x => {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), gemMat);
        gem.position.set(x, 7.6, 0);
        gateGrp.add(gem);
        floatingIcons.push({ mesh: gem, baseY: 7.6, speed: 1.1, phase: x > 0 ? Math.PI : 0, group: gateGrp });
    });
    gateGrp.userData = { idx: i, type: '_gate' };
    boardGrp.add(gateGrp);
    tileMeshes.push(gateGrp);
}

function _buildShopMesh(i, pos) {
    const shopGrp = new THREE.Group();
    const tangent = (i < 99) ? new THREE.Vector3().subVectors(getPos(i + 1), pos).normalize() : boardCurve.getTangent(0.999).normalize();
    const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    shopGrp.position.copy(pos).addScaledVector(right, 3.2); shopGrp.position.y = 0;
    shopGrp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);

    const counterMat = new THREE.MeshPhysicalMaterial({ color: 0x78350f, emissive: 0x3b1a06, emissiveIntensity: 0.3, roughness: 0.7, metalness: 0.1 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.35, 1.4), counterMat); counter.position.set(0, 1.5, 0); counter.castShadow = true; shopGrp.add(counter);
    const legGeo  = new THREE.BoxGeometry(0.18, 1.5, 0.18);
    [[-1.3, 0.75, -0.55], [1.3, 0.75, -0.55], [-1.3, 0.75, 0.55], [1.3, 0.75, 0.55]].forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeo, counterMat); leg.position.set(x, y, z); leg.castShadow = true; shopGrp.add(leg);
    });
    const awningMat = new THREE.MeshPhysicalMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 0.5, roughness: 0.6 });
    const awning = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.8), awningMat); awning.position.set(0, 2.55, -0.2); awning.rotation.x = -0.18; awning.castShadow = true; shopGrp.add(awning);
    const stripeMat = new THREE.MeshPhysicalMaterial({ color: 0xf0abfc, emissive: 0xd946ef, emissiveIntensity: 0.6 });
    [-1.0, 0, 1.0].forEach(x => { const s = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.14, 1.82), stripeMat); s.position.set(x, 2.56, -0.2); s.rotation.x = -0.18; shopGrp.add(s); });
    const signMat = new THREE.MeshPhysicalMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.8, metalness: 0.9, roughness: 0.05 });
    const sign = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12), signMat); sign.position.set(0, 3.6, 0); sign.rotation.x = Math.PI / 2; shopGrp.add(sign);
    floatingIcons.push({ mesh: sign, baseY: 3.6, speed: 1.6, phase: Math.random() * Math.PI * 2, group: shopGrp });
    shopGrp.userData = { idx: i, type: '_shop' };
    boardGrp.add(shopGrp); tileMeshes.push(shopGrp);
}

function _buildFloatingIcon(i, pos, spc, b) {
    let iconCol = 0xffffff;
    if (b.type === 'player_trap') iconCol = state.players[b.owner] ? state.players[b.owner].color : 0xffffff;
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

    if (type === 'slime') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 16), mat);
        body.scale.set(1, 0.7, 1); body.position.y = 0.5; group.add(body);
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.1), eyeMat); e1.position.set(0.3, 0.6, 0.5); group.add(e1);
        const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.1), eyeMat); e2.position.set(-0.3, 0.6, 0.5); group.add(e2);
    } else if (type === 'ghost') {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 1.2, 16), mat); body.position.y = 0.6; group.add(body);
        const top  = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), mat); top.position.y = 1.2; group.add(top);
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.12), eyeMat); e1.position.set(0.25, 1.1, 0.5); group.add(e1);
        const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.12), eyeMat); e2.position.set(-0.25, 1.1, 0.5); group.add(e2);
    } else if (type === 'boxy') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat); body.position.y = 0.6; group.add(body);
        const e1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), eyeMat); e1.position.set(0.3, 0.7, 0.61); group.add(e1);
        const e2 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.4), eyeMat); e2.position.set(-0.3, 0.7, 0.61); group.add(e2);
    } else if (type === 'bunny') {
        const body = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 16), mat); body.position.y = 0.6; group.add(body);
        const earGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.8);
        const ear1   = new THREE.Mesh(earGeo, mat); ear1.position.set(0.3, 1.4, 0); ear1.rotation.z = -0.2; group.add(ear1);
        const ear2   = new THREE.Mesh(earGeo, mat); ear2.position.set(-0.3, 1.4, 0); ear2.rotation.z = 0.2; group.add(ear2);
        const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.08), eyeMat); e1.position.set(0.2, 0.6, 0.55); group.add(e1);
        const e2 = new THREE.Mesh(new THREE.SphereGeometry(0.08), eyeMat); e2.position.set(-0.2, 0.6, 0.55); group.add(e2);
    }
    const dir = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dir.position.set(0, 0.1, 0.6); group.add(dir);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
}

function buildPlayerMeshes() {
    state.players.forEach(p => {
        p.mesh = createCharacterMesh(p.charType, p.color);
        const pos     = getPos(0).clone();
        const tangent = boardCurve.getTangent(0);
        const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
        pos.add(right.multiplyScalar(p.id === 0 ? -0.7 : 0.7));
        p.mesh.position.set(pos.x, 0, pos.z);
        scene.add(p.mesh);
    });
}

// ---- Biome visuals ----

export function updateBiomeVisuals(spaceIdx) {
    const b = getBiomeForSpace(spaceIdx);
    document.getElementById('bg-gradient').style.background = `linear-gradient(to bottom, ${b.bgTop}, ${b.bgBot})`;
    if (scene && scene.fog) scene.fog.color.set(b.fog);
    if (pathMesh) {
        pathMesh.material.color.setHex(b.pathTint);
        pathMesh.material.emissive.setHex(b.pathTint);
    }
}

// ---- Player hop animation ----

export function animatePlayerHop(player, targetIdx, onComplete) {
    const dest    = getPos(targetIdx).clone();
    const t       = Math.max(0.001, Math.min(targetIdx / 99, 0.999));
    const tangent = boardCurve.getTangent(t).normalize();
    const right   = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
    dest.add(right.multiplyScalar(player.id === 0 ? -0.7 : 0.7));
    dest.y = 0.0;
    player.mesh.lookAt(dest.clone().add(tangent));
    activeAnims.push({
        obj: player.mesh.position, start: player.mesh.position.clone(), to: dest,
        dur: 0.35, isHop: true, onComplete,
    });
}

// ---- Flyover ----

export function startFlyover(onComplete) {
    const flyObj = { p: 0 };
    activeAnims.push({
        obj: flyObj, start: { p: 0 }, to: { p: 1 }, dur: 4.0,
        onUpdate: () => {
            const safeT  = Math.max(0.001, Math.min(flyObj.p, 0.999));
            const pt     = boardCurve.getPoint(safeT);
            const tangent = boardCurve.getTangent(safeT).normalize();
            if (pt && tangent && !isNaN(pt.x)) {
                camera.position.copy(pt).add(new THREE.Vector3(0, 30, 20));
                camera.lookAt(pt.clone().add(tangent.clone().multiplyScalar(20)));
            }
        },
        onComplete,
    });
}

// ---- Map camera state ----

const mapCam = {
    targetPos:  new THREE.Vector3(),
    targetLook: new THREE.Vector3(),
    dragging:   false,
    dragStart:  { x: 0, y: 0 },
    dragCamStart:  new THREE.Vector3(),
    dragLookStart: new THREE.Vector3(),
};
export const mapCamera = mapCam;

export function setMapCameraTarget(spaceIdx, offsetY = 40, offsetZ = 25) {
    const pt = getPos(spaceIdx);
    mapCam.targetPos.copy(pt).add(new THREE.Vector3(0, offsetY, offsetZ));
    mapCam.targetLook.copy(pt);
    mapCam.dragCamStart.copy(mapCam.targetPos);
    mapCam.dragLookStart.copy(mapCam.targetLook);
}

// ---- Dice group accessor ----

export function getDiceGroup() { return diceGrp; }
export function getCamera() { return camera; }

// ---- Resize ----

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

    // Animate floating icons
    floatingIcons.forEach(f => {
        f.mesh.position.y = f.baseY + Math.sin(time * f.speed + (f.phase || 0)) * 0.4;
        f.mesh.rotation.y += 1.4 * dt * f.speed;
        f.mesh.rotation.x += 0.4 * dt * f.speed;
    });

    Physics.step(dt);

    // Tween animations
    for (let i = activeAnims.length - 1; i >= 0; i--) {
        const a  = activeAnims[i];
        a.t      = (a.t || 0) + dt;
        const p  = a.dur > 0 ? Math.min(a.t / a.dur, 1) : 1;
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

    // Camera
    const cs = state.cameraState;
    if (cs === 'FOLLOW') {
        const p = state.players[state.activePlayer];
        if (p && p.mesh && p.mesh.position) {
            const curveT  = Math.max(0.001, Math.min(p.pos / 99, 0.999));
            const tangent = boardCurve.getTangent(curveT).normalize();
            const behind  = (state.playStyle === 'tabletop' && state.activePlayer === 1) ? 18 : -18;
            const camTarget = p.mesh.position.clone().add(tangent.clone().multiplyScalar(behind)).add(new THREE.Vector3(0, 20, 0));
            if (!isNaN(camTarget.x)) camera.position.lerp(camTarget, 0.06);
            _camHelper.position.copy(camera.position);
            _camHelper.lookAt(p.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));
            camera.quaternion.slerp(_camHelper.quaternion, 0.08);
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
    tileMeshes.forEach(m => { m.geometry.dispose(); if (m.material.map) m.material.map.dispose(); m.material.dispose(); });
    tileMeshes.length = 0;
    floatingIcons.forEach(f => { f.mesh.geometry.dispose(); f.mesh.material.dispose(); });
    floatingIcons.length = 0;
    activeAnims.length = 0;
    if (renderer) { renderer.dispose(); renderer = null; }
}
