// MazeDash — Race through a 3D maze to snatch the gem first! 30-second limit.
// P1 (red) starts bottom-left, P2 (blue) starts top-right. Gem glows at the center.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const CELL_SIZE    = 2;
const MAZE_W       = 7;
const MAZE_H       = 7;
const WALL_H       = 1.5;
const WALL_T       = 0.18;
const PLAYER_R     = 0.38;
const PLAYER_SPEED = 4.8;
const GEM_R        = 0.24;
const GAME_DURATION = 30000;
const JOY_R        = 56;

// World origin: maze is centered at (0,0)
const MX = -(MAZE_W * CELL_SIZE) / 2;   // -7
const MZ = -(MAZE_H * CELL_SIZE) / 2;   // -7

let _done = false, _onWin = null, _isBot = false;
let _overlay = null, _renderer = null, _scene = null;
const _cameras = [null, null];
let _W = 0, _H = 0;
let _af = null, _startTime = 0, _lastTime = 0;
let _cells = null;      // [row][col] { R: bool, B: bool }
let _wallBoxes = [];    // [{minX,maxX,minZ,maxZ}] AABBs for collision
const _players = [
    { x: 0, z: 0, mesh: null, light: null },
    { x: 0, z: 0, mesh: null, light: null },
];
let _gemMesh = null, _gemLight = null;
let _botDir = { dx: 0, dz: 0 }, _botTimer = 0;
let _timerEl = null, _neutralEl = null;
const _joy = [
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0, knob: null },
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0, knob: null },
];
const _cleanups = [];
const _timers   = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
}

// ── Maze generation (recursive backtracking DFS) ──────────────────────────────

function _genMaze() {
    _cells = Array.from({ length: MAZE_H }, () =>
        Array.from({ length: MAZE_W }, () => ({ R: true, B: true }))
    );
    const vis = Array.from({ length: MAZE_H }, () => new Uint8Array(MAZE_W));

    function carve(c, r) {
        vis[r][c] = 1;
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]].sort(() => Math.random() - 0.5);
        for (const [dc, dr] of dirs) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nc >= MAZE_W || nr < 0 || nr >= MAZE_H || vis[nr][nc]) continue;
            if (dc ===  1) _cells[r][c].R   = false;
            if (dc === -1) _cells[r][nc].R  = false;
            if (dr ===  1) _cells[r][c].B   = false;
            if (dr === -1) _cells[nr][c].B  = false;
            carve(nc, nr);
        }
    }
    carve(0, 0);
}

// ── Wall collision AABBs ──────────────────────────────────────────────────────

function _buildWallBoxes() {
    _wallBoxes = [];
    const hw = WALL_T / 2;
    for (let r = 0; r < MAZE_H; r++) {
        for (let c = 0; c < MAZE_W; c++) {
            if (_cells[r][c].R && c < MAZE_W - 1) {
                const wx = MX + (c + 1) * CELL_SIZE;
                _wallBoxes.push({ minX: wx - hw, maxX: wx + hw, minZ: MZ + r * CELL_SIZE, maxZ: MZ + (r + 1) * CELL_SIZE });
            }
            if (_cells[r][c].B && r < MAZE_H - 1) {
                const wz = MZ + (r + 1) * CELL_SIZE;
                _wallBoxes.push({ minX: MX + c * CELL_SIZE, maxX: MX + (c + 1) * CELL_SIZE, minZ: wz - hw, maxZ: wz + hw });
            }
        }
    }
    // Outer boundary (thick enough to never escape)
    const ot = 0.5, tw = MAZE_W * CELL_SIZE, th = MAZE_H * CELL_SIZE;
    _wallBoxes.push({ minX: MX - ot, maxX: MX + tw + ot, minZ: MZ - ot,      maxZ: MZ + hw       });
    _wallBoxes.push({ minX: MX - ot, maxX: MX + tw + ot, minZ: MZ + th - hw, maxZ: MZ + th + ot  });
    _wallBoxes.push({ minX: MX - ot, maxX: MX + hw,      minZ: MZ - ot,      maxZ: MZ + th + ot  });
    _wallBoxes.push({ minX: MX + tw - hw, maxX: MX + tw + ot, minZ: MZ - ot, maxZ: MZ + th + ot  });
}

function _resolveWalls(p) {
    for (const w of _wallBoxes) {
        const cx = Math.max(w.minX, Math.min(w.maxX, p.x));
        const cz = Math.max(w.minZ, Math.min(w.maxZ, p.z));
        const dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < PLAYER_R * PLAYER_R && d2 > 1e-10) {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (PLAYER_R - d);
            p.z += (dz / d) * (PLAYER_R - d);
        }
    }
}

// ── DOM + Joysticks ───────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#030308;touch-action:none;';

    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;top:0;left:0;right:0;height:32px;display:flex;justify-content:space-between;align-items:center;padding:0 14px;box-sizing:border-box;z-index:10;pointer-events:none;';
    const mkLbl = (t, c) => {
        const el = document.createElement('div');
        el.style.cssText = `font-size:1rem;font-weight:900;color:${c};text-shadow:0 0 8px ${c};`;
        el.textContent = t; return el;
    };
    hud.appendChild(mkLbl('P1', '#ff3b3b'));
    _timerEl = mkLbl('30s', '#fbbf24');
    hud.appendChild(_timerEl);
    hud.appendChild(mkLbl('P2', '#3b8eff'));
    _overlay.appendChild(hud);

    for (let pid = 0; pid < 2; pid++) {
        const zone = document.createElement('div');
        zone.style.cssText = `position:absolute;${pid === 0 ? 'top:50%;bottom:0;' : 'top:0;bottom:50%;'}left:0;right:0;z-index:5;`;
        const kColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        const base = document.createElement('div');
        base.style.cssText = [
            'position:absolute;',
            pid === 0 ? 'bottom:28px;' : 'top:28px;',
            'left:50%;transform:translateX(-50%);',
            `width:${JOY_R * 2}px;height:${JOY_R * 2}px;border-radius:50%;`,
            `background:rgba(255,255,255,0.03);border:2px solid ${kColor}55;pointer-events:none;`,
        ].join('');
        const knob = document.createElement('div');
        knob.style.cssText = [
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            'width:44px;height:44px;border-radius:50%;',
            `background:${kColor};box-shadow:0 0 18px ${kColor};opacity:0.9;pointer-events:none;`,
        ].join('');
        base.appendChild(knob);
        zone.appendChild(base);
        _overlay.appendChild(zone);
        _joy[pid].knob = knob;

        const joy = _joy[pid];
        const kOff = JOY_R - 22;
        const onDown = e => {
            if (_done || joy.active) return;
            e.preventDefault();
            const rb = base.getBoundingClientRect();
            joy.active = true; joy.id = e.pointerId;
            joy.bx = rb.left + rb.width / 2;
            joy.by = rb.top  + rb.height / 2;
        };
        const onMove = e => {
            if (!joy.active || e.pointerId !== joy.id) return;
            e.preventDefault();
            const rx = e.clientX - joy.bx, ry = e.clientY - joy.by;
            const mag = Math.hypot(rx, ry);
            const s   = Math.min(1, mag / JOY_R);
            const ang = Math.atan2(ry, rx);
            joy.dx = Math.cos(ang) * s;
            joy.dy = Math.sin(ang) * s;
            knob.style.transform = `translate(calc(-50% + ${joy.dx * kOff}px),calc(-50% + ${joy.dy * kOff}px))`;
        };
        const onUp = e => {
            if (e.pointerId !== joy.id) return;
            e.preventDefault();
            joy.active = false; joy.dx = 0; joy.dy = 0;
            knob.style.transform = 'translate(-50%,-50%)';
        };
        zone.addEventListener('pointerdown',   onDown);
        zone.addEventListener('pointermove',   onMove);
        zone.addEventListener('pointerup',     onUp);
        zone.addEventListener('pointercancel', onUp);
        _cleanups.push(() => {
            zone.removeEventListener('pointerdown',   onDown);
            zone.removeEventListener('pointermove',   onMove);
            zone.removeEventListener('pointerup',     onUp);
            zone.removeEventListener('pointercancel', onUp);
        });
    }
    mg.appendChild(_overlay);
}

// ── Three.js scene ────────────────────────────────────────────────────────────

function _initThree() {
    _W = _overlay.clientWidth  || 390;
    _H = _overlay.clientHeight || 680;
    const halfAspect = _W / (_H / 2);   // each player's viewport is half-height

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(_W, _H);
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.autoClear = false;
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x030308);
    _scene.fog = new THREE.Fog(0x030308, 36, 65);

    // Two independent top-down cameras — one per player half.
    // Pure top-down: position directly above player, up=(0,0,-1) so world -z = screen up.
    // Each camera shows a ~10-unit radius window around its player.
    const vH = 10;
    for (let pid = 0; pid < 2; pid++) {
        _cameras[pid] = new THREE.OrthographicCamera(
            -vH * halfAspect / 2,  vH * halfAspect / 2,
             vH / 2,               -vH / 2,
            0.1, 60
        );
        _cameras[pid].up.set(0, 0, -1);
        _cameras[pid].position.set(0, 15, 0);
        _cameras[pid].lookAt(0, 0, 0);
    }

    // Lights
    _scene.add(new THREE.AmbientLight(0x1a2045, 6));
    const sun = new THREE.DirectionalLight(0x8888ff, 2.8);
    sun.position.set(5, 14, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -18;
    sun.shadow.camera.right = sun.shadow.camera.top   =  18;
    sun.shadow.camera.near = 1; sun.shadow.camera.far  = 50;
    _scene.add(sun);

    // Stars
    const sPos = new Float32Array(600 * 3);
    for (let i = 0; i < sPos.length; i++) sPos[i] = (Math.random() - 0.5) * 120;
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    _scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 })));

    _buildMazeMeshes();
    _buildPlayerMeshes();
    _buildGem();
}

function _buildMazeMeshes() {
    // Dark floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(MAZE_W * CELL_SIZE + 3, MAZE_H * CELL_SIZE + 3),
        new THREE.MeshStandardMaterial({ color: 0x070b16, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    _scene.add(floor);

    // Subtle grid lines on floor
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1a2060, transparent: true, opacity: 0.35 });
    for (let i = 0; i <= MAZE_W; i++) {
        const x = MX + i * CELL_SIZE;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0.01, MZ), new THREE.Vector3(x, 0.01, MZ + MAZE_H * CELL_SIZE)
        ]);
        _scene.add(new THREE.Line(g, lineMat));
    }
    for (let j = 0; j <= MAZE_H; j++) {
        const z = MZ + j * CELL_SIZE;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(MX, 0.01, z), new THREE.Vector3(MX + MAZE_W * CELL_SIZE, 0.01, z)
        ]);
        _scene.add(new THREE.Line(g, lineMat));
    }

    // Start zone indicators
    _addZoneRing(-6, 6,   0xff3b3b); // P1
    _addZoneRing( 6, -6,  0x3b8eff); // P2

    // Shared wall material (neon teal glow)
    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x0c1430, roughness: 0.45, metalness: 0.35,
        emissive: 0x1a3060, emissiveIntensity: 0.55,
    });
    const outerMat = new THREE.MeshStandardMaterial({
        color: 0x0a1128, roughness: 0.4, metalness: 0.45,
        emissive: 0x0a1f80, emissiveIntensity: 0.75,
    });

    // Internal walls
    for (let r = 0; r < MAZE_H; r++) {
        for (let c = 0; c < MAZE_W; c++) {
            if (_cells[r][c].R && c < MAZE_W - 1) {
                const wx = MX + (c + 1) * CELL_SIZE;
                const wz = MZ + r * CELL_SIZE + CELL_SIZE / 2;
                _addWall(wx, wz, WALL_T, CELL_SIZE, wallMat);
            }
            if (_cells[r][c].B && r < MAZE_H - 1) {
                const wx = MX + c * CELL_SIZE + CELL_SIZE / 2;
                const wz = MZ + (r + 1) * CELL_SIZE;
                _addWall(wx, wz, CELL_SIZE, WALL_T, wallMat);
            }
        }
    }

    // Outer walls
    const tw = MAZE_W * CELL_SIZE, th = MAZE_H * CELL_SIZE;
    _addWall(MX + tw / 2, MZ,       tw + WALL_T, WALL_T, outerMat);
    _addWall(MX + tw / 2, MZ + th,  tw + WALL_T, WALL_T, outerMat);
    _addWall(MX,          MZ + th / 2, WALL_T, th + WALL_T, outerMat);
    _addWall(MX + tw,     MZ + th / 2, WALL_T, th + WALL_T, outerMat);

    // Corner posts
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x0a1030, emissive: 0x0a1f80, emissiveIntensity: 0.9,
    });
    for (let r = 0; r <= MAZE_H; r++) {
        for (let c = 0; c <= MAZE_W; c++) {
            const m = new THREE.Mesh(
                new THREE.BoxGeometry(WALL_T * 1.8, WALL_H, WALL_T * 1.8), pillarMat
            );
            m.position.set(MX + c * CELL_SIZE, WALL_H / 2, MZ + r * CELL_SIZE);
            _scene.add(m);
        }
    }
}

function _addWall(cx, cz, wx, wz, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(wx, WALL_H, wz), mat);
    m.position.set(cx, WALL_H / 2, cz);
    m.castShadow = m.receiveShadow = true;
    _scene.add(m);
}

function _addZoneRing(x, z, color) {
    const geo = new THREE.RingGeometry(CELL_SIZE * 0.3, CELL_SIZE * 0.45, 32);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    _scene.add(ring);
}

function _buildPlayerMeshes() {
    const cfg = [
        { color: 0xff3b3b, emissive: 0xff2200, light: 0xff5555 },
        { color: 0x3b8eff, emissive: 0x0044ff, light: 0x5599ff },
    ];
    for (let pid = 0; pid < 2; pid++) {
        const p = _players[pid];
        const c = cfg[pid];
        p.mesh = new THREE.Mesh(
            new THREE.SphereGeometry(PLAYER_R, 16, 12),
            new THREE.MeshStandardMaterial({ color: c.color, emissive: c.emissive, emissiveIntensity: 0.7, roughness: 0.35, metalness: 0.4 })
        );
        p.mesh.castShadow = true;
        p.mesh.position.set(p.x, PLAYER_R, p.z);
        _scene.add(p.mesh);

        p.light = new THREE.PointLight(c.light, 2.8, 4.5);
        p.light.position.set(p.x, PLAYER_R + 0.4, p.z);
        _scene.add(p.light);
    }
}

function _buildGem() {
    _gemMesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(GEM_R, 1),
        new THREE.MeshStandardMaterial({
            color: 0xffd700, emissive: 0xff7700, emissiveIntensity: 1.4,
            roughness: 0.08, metalness: 0.85,
        })
    );
    _gemMesh.position.set(0, GEM_R + 0.3, 0);
    _gemMesh.castShadow = true;
    _scene.add(_gemMesh);

    _gemLight = new THREE.PointLight(0xffaa00, 3.5, 6);
    _gemLight.position.set(0, 1, 0);
    _scene.add(_gemLight);

    // Gold floor ring under gem
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.6, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, 0);
    _scene.add(ring);
}

// ── Split-screen render ───────────────────────────────────────────────────────

function _renderSplit() {
    if (!_renderer || !_scene) return;
    const halfH = Math.floor(_H / 2);
    _renderer.clear();
    for (let pid = 0; pid < 2; pid++) {
        const p = _players[pid];
        // Snap camera above this player each frame
        _cameras[pid].position.set(p.x, 15, p.z);
        _cameras[pid].lookAt(p.x, 0, p.z);
        // P1 = bottom half (WebGL y=0 is canvas bottom); P2 = top half
        const vy = pid === 0 ? 0 : halfH;
        _renderer.setViewport(0, vy, _W, halfH);
        _renderer.setScissor(0, vy, _W, halfH);
        _renderer.setScissorTest(true);
        _renderer.render(_scene, _cameras[pid]);
    }
}

// ── Bot AI (BFS toward gem cell) ──────────────────────────────────────────────

function _bfsNextStep(fc, fr, tc, tr) {
    if (fc === tc && fr === tr) return null;
    const dist = Array.from({ length: MAZE_H }, () => new Int32Array(MAZE_W).fill(-1));
    const prev = Array.from({ length: MAZE_H }, () => Array(MAZE_W).fill(null));
    dist[fr][fc] = 0;
    const q = [[fc, fr]];
    outer: while (q.length) {
        const [c, r] = q.shift();
        const nbrs = [];
        if (!_cells[r][c].R && c + 1 < MAZE_W)         nbrs.push([c + 1, r]);
        if (c > 0 && !_cells[r][c - 1].R)               nbrs.push([c - 1, r]);
        if (!_cells[r][c].B && r + 1 < MAZE_H)          nbrs.push([c, r + 1]);
        if (r > 0 && !_cells[r - 1][c].B)               nbrs.push([c, r - 1]);
        for (const [nc, nr] of nbrs) {
            if (dist[nr][nc] !== -1) continue;
            dist[nr][nc] = dist[r][c] + 1;
            prev[nr][nc] = [c, r];
            if (nc === tc && nr === tr) break outer;
            q.push([nc, nr]);
        }
    }
    if (dist[tr][tc] === -1) return null;
    let cur = [tc, tr];
    while (prev[cur[1]][cur[0]] && (prev[cur[1]][cur[0]][0] !== fc || prev[cur[1]][cur[0]][1] !== fr)) {
        cur = prev[cur[1]][cur[0]];
    }
    return cur;
}

function _updateBot(now) {
    if (now - _botTimer < 450) return;
    _botTimer = now;
    const p  = _players[1];
    const c  = Math.max(0, Math.min(MAZE_W - 1, Math.floor((p.x - MX) / CELL_SIZE)));
    const r  = Math.max(0, Math.min(MAZE_H - 1, Math.floor((p.z - MZ) / CELL_SIZE)));
    const gc = Math.floor(MAZE_W / 2);
    const gr = Math.floor(MAZE_H / 2);
    const next = _bfsNextStep(c, r, gc, gr);
    if (!next) { _botDir = { dx: 0, dz: 0 }; return; }
    const tx = MX + next[0] * CELL_SIZE + CELL_SIZE / 2;
    const tz = MZ + next[1] * CELL_SIZE + CELL_SIZE / 2;
    const dx = tx - p.x, dz = tz - p.z;
    const len = Math.hypot(dx, dz) || 1;
    _botDir = { dx: dx / len, dz: dz / len };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _lastTime = 0; _botTimer = 0; _botDir = { dx: 0, dz: 0 };
    _neutralEl = document.getElementById('mg-neutral');

    _genMaze();
    _buildWallBoxes();

    // Reset player positions to opposite corners
    _players[0].x = MX + 0.5 * CELL_SIZE;
    _players[0].z = MZ + (MAZE_H - 0.5) * CELL_SIZE;
    _players[1].x = MX + (MAZE_W - 0.5) * CELL_SIZE;
    _players[1].z = MZ + 0.5 * CELL_SIZE;

    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _initThree();
        if (_neutralEl) _neutralEl.textContent = 'RACE TO THE GEM!';
        _startTime = performance.now();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _tick(now) {
    if (_done || !state.mgActive) return;
    const dt = Math.min((now - (_lastTime || now)) / 1000, 0.05);
    _lastTime = now;
    const elapsed   = now - _startTime;
    const remaining = Math.max(0, GAME_DURATION - elapsed);
    if (_timerEl) _timerEl.textContent = `${Math.ceil(remaining / 1000)}s`;

    if (_isBot) _updateBot(now);

    // Move each player
    for (let pid = 0; pid < 2; pid++) {
        const p = _players[pid];
        let mdx, mdz;
        if (_isBot && pid === 1) {
            mdx = _botDir.dx; mdz = _botDir.dz;
        } else {
            mdx = _joy[pid].dx; mdz = _joy[pid].dy;
        }
        p.x += mdx * PLAYER_SPEED * dt;
        p.z += mdz * PLAYER_SPEED * dt;
        _resolveWalls(p);
        if (p.mesh)  p.mesh.position.set(p.x, PLAYER_R, p.z);
        if (p.light) p.light.position.set(p.x, PLAYER_R + 0.5, p.z);
    }

    // Player–player separation
    {
        const a = _players[0], b = _players[1];
        const dx = a.x - b.x, dz = a.z - b.z;
        const d2 = dx * dx + dz * dz;
        const minD = PLAYER_R * 2;
        if (d2 < minD * minD && d2 > 1e-10) {
            const d  = Math.sqrt(d2);
            const push = (minD - d) / 2;
            const nx = dx / d, nz = dz / d;
            a.x += nx * push; a.z += nz * push;
            b.x -= nx * push; b.z -= nz * push;
            _resolveWalls(a); _resolveWalls(b);
            if (a.mesh) a.mesh.position.set(a.x, PLAYER_R, a.z);
            if (b.mesh) b.mesh.position.set(b.x, PLAYER_R, b.z);
        }
    }

    // Gem animation
    if (_gemMesh) {
        _gemMesh.rotation.y += 0.045;
        _gemMesh.position.y  = GEM_R + 0.3 + Math.sin(elapsed * 0.0022) * 0.14;
    }
    if (_gemLight) {
        _gemLight.intensity = 3.0 + Math.sin(elapsed * 0.006) * 0.9;
    }

    // Win check: first player to reach gem
    for (let pid = 0; pid < 2; pid++) {
        if (Math.hypot(_players[pid].x, _players[pid].z) < PLAYER_R + GEM_R + 0.12) {
            _resolve(pid); return;
        }
    }

    // Timer expiry: closest player wins (tie if equidistant)
    if (remaining <= 0) {
        const d0 = Math.hypot(_players[0].x, _players[0].z);
        const d1 = Math.hypot(_players[1].x, _players[1].z);
        _resolve(Math.abs(d0 - d1) < 0.5 ? -1 : d0 < d1 ? 0 : 1);
        return;
    }

    _renderSplit();
    _af = requestAnimationFrame(_tick);
}

// ── Resolution ────────────────────────────────────────────────────────────────

function _resolve(winnerId) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    _renderSplit();
    if (_neutralEl) {
        _neutralEl.textContent = winnerId >= 0
            ? `P${winnerId + 1} GRABS THE GEM! 💎`
            : `NOBODY REACHED IT — SO CLOSE!`;
    }
    sfx(winnerId >= 0 ? 'mg_win' : 'land_good');
    _after(() => { _destroy(); _onWin(winnerId); }, 1400);
}

function _destroy() {
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_scene) {
        _scene.traverse(obj => {
            obj.geometry?.dispose();
            if (obj.material) {
                (Array.isArray(obj.material) ? obj.material : [obj.material])
                    .forEach(m => m.dispose());
            }
        });
        _scene.clear(); _scene = null;
    }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    if (_overlay)  { _overlay.remove();   _overlay  = null; }
    _players[0].mesh = _players[0].light = null;
    _players[1].mesh = _players[1].light = null;
    _gemMesh = null; _gemLight = null;
    _cameras[0] = _cameras[1] = null; _timerEl = null;
}
