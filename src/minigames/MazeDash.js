// MazeDash — Race through a 20×20 maze to snatch the gem! Top-down split-screen + minimap.
// P1 (red) bottom half, P2 (blue) top half. Gem glows at the maze center.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const CELL_SIZE    = 2;
const MAZE_W       = 20;
const MAZE_H       = 20;
const WALL_H       = 1.5;
const WALL_T       = 0.18;
const PLAYER_R     = 0.38;
const PLAYER_SPEED = 5.2;
const GEM_R        = 0.24;
const GAME_DURATION = 50000;
const JOY_R        = 56;

// World units visible from player center to each edge of the camera view.
// 20×20 grid = 40 world units total. CAM_HALF=14 shows 28 of those 40 units.
const CAM_HALF = 14;

const MX = -(MAZE_W * CELL_SIZE) / 2;   // -20
const MZ = -(MAZE_H * CELL_SIZE) / 2;   // -20
const MAZE_W_WORLD = MAZE_W * CELL_SIZE; // 40
const MAZE_H_WORLD = MAZE_H * CELL_SIZE; // 40

let _done = false, _onWin = null, _isBot = false;
let _overlay = null, _renderer = null, _scene = null;
const _cameras = [null, null];
let _camHalfW = CAM_HALF; // computed from actual canvas aspect at init
let _canvasW = 390, _canvasH = 680;
let _af = null, _startTime = 0, _lastTime = 0;
let _cells = null;
let _wallBoxes = [];
const _players = [
    { x: 0, z: 0, mesh: null, light: null },
    { x: 0, z: 0, mesh: null, light: null },
];
let _gemMesh = null, _gemLight = null;
let _botDir = { dx: 0, dz: 0 }, _botTimer = 0;
let _timerEl = null, _neutralEl = null;
let _minimapCanvas = null;
const _joy = [
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0, knob: null },
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0, knob: null },
];
const _cleanups = [];
const _timers   = [];

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
    const ot = 0.5;
    _wallBoxes.push({ minX: MX - ot, maxX: MX + MAZE_W_WORLD + ot, minZ: MZ - ot,                maxZ: MZ + hw                    });
    _wallBoxes.push({ minX: MX - ot, maxX: MX + MAZE_W_WORLD + ot, minZ: MZ + MAZE_H_WORLD - hw, maxZ: MZ + MAZE_H_WORLD + ot     });
    _wallBoxes.push({ minX: MX - ot, maxX: MX + hw,                minZ: MZ - ot,                maxZ: MZ + MAZE_H_WORLD + ot     });
    _wallBoxes.push({ minX: MX + MAZE_W_WORLD - hw, maxX: MX + MAZE_W_WORLD + ot, minZ: MZ - ot, maxZ: MZ + MAZE_H_WORLD + ot    });
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

    // Thin divider lines flanking the minimap
    const divL = document.createElement('div');
    divL.style.cssText = 'position:absolute;top:50%;left:0;right:calc(50% + 70px);height:2px;background:linear-gradient(to right,#ff3b3b,rgba(255,255,255,0.5));transform:translateY(-50%);z-index:8;pointer-events:none;';
    _overlay.appendChild(divL);
    const divR = document.createElement('div');
    divR.style.cssText = 'position:absolute;top:50%;left:calc(50% + 70px);right:0;height:2px;background:linear-gradient(to right,rgba(255,255,255,0.5),#3b8eff);transform:translateY(-50%);z-index:8;pointer-events:none;';
    _overlay.appendChild(divR);

    // Minimap — 2D canvas centered on the divider
    const MAP_SIZE = 130;
    _minimapCanvas = document.createElement('canvas');
    _minimapCanvas.width  = MAP_SIZE * 2; // retina
    _minimapCanvas.height = MAP_SIZE * 2;
    _minimapCanvas.style.cssText = [
        `position:absolute;`,
        `width:${MAP_SIZE}px;height:${MAP_SIZE}px;`,
        `left:50%;top:50%;transform:translate(-50%,-50%);`,
        'z-index:9;pointer-events:none;border-radius:50%;',
        'border:2px solid rgba(255,255,255,0.55);',
        'box-shadow:0 0 14px 3px rgba(255,255,255,0.25);',
    ].join('');
    _overlay.appendChild(_minimapCanvas);

    // Timer — top-left of P1's half
    _timerEl = document.createElement('div');
    _timerEl.style.cssText = [
        'position:absolute;left:10px;bottom:calc(50% + 8px);',
        'background:#000d;border:1.5px solid #fbbf24;border-radius:8px;',
        'padding:2px 9px;font-size:0.85rem;font-weight:900;',
        'color:#fbbf24;text-shadow:0 0 8px #fbbf24;z-index:10;pointer-events:none;',
    ].join('');
    _timerEl.textContent = '50s';
    _overlay.appendChild(_timerEl);

    // Player labels
    const p1Label = document.createElement('div');
    p1Label.style.cssText = 'position:absolute;left:10px;bottom:8px;font-size:0.85rem;font-weight:900;color:#ff3b3b;text-shadow:0 0 8px #ff3b3b;z-index:10;pointer-events:none;';
    p1Label.textContent = 'P1';
    _overlay.appendChild(p1Label);

    const p2Label = document.createElement('div');
    p2Label.style.cssText = 'position:absolute;left:10px;top:8px;font-size:0.85rem;font-weight:900;color:#3b8eff;text-shadow:0 0 8px #3b8eff;z-index:10;pointer-events:none;';
    p2Label.textContent = 'P2';
    _overlay.appendChild(p2Label);

    // Joystick zones: P1 = bottom half, P2 = top half
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
            joy.bx = rb.left + rb.width  / 2;
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

// ── Minimap (2D canvas) ───────────────────────────────────────────────────────

function _drawMinimap() {
    if (!_minimapCanvas || !_cells) return;
    const S   = _minimapCanvas.width;  // canvas pixel size (retina ×2)
    const ctx = _minimapCanvas.getContext('2d');

    // Clip to circle
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    ctx.clip();

    // Background
    ctx.fillStyle = 'rgba(2,4,18,0.92)';
    ctx.fillRect(0, 0, S, S);

    // World → minimap pixel  (Z+ goes DOWN to match camera orientation: up=(0,0,-1))
    const toM = (wx, wz) => [
        ((wx - MX) / MAZE_W_WORLD) * S,
        ((wz - MZ) / MAZE_H_WORLD) * S,
    ];

    // Outer border wall
    ctx.strokeStyle = 'rgba(60,100,220,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, S, S);

    // Internal walls
    ctx.strokeStyle = 'rgba(50,90,200,0.65)';
    ctx.lineWidth = 1;
    for (let r = 0; r < MAZE_H; r++) {
        for (let c = 0; c < MAZE_W; c++) {
            if (_cells[r][c].R && c < MAZE_W - 1) {
                const [x0, y0] = toM(MX + (c + 1) * CELL_SIZE, MZ + r * CELL_SIZE);
                const [x1, y1] = toM(MX + (c + 1) * CELL_SIZE, MZ + (r + 1) * CELL_SIZE);
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            }
            if (_cells[r][c].B && r < MAZE_H - 1) {
                const [x0, y0] = toM(MX + c * CELL_SIZE,       MZ + (r + 1) * CELL_SIZE);
                const [x1, y1] = toM(MX + (c + 1) * CELL_SIZE, MZ + (r + 1) * CELL_SIZE);
                ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            }
        }
    }

    // Gem (gold dot)
    const [gx, gy] = toM(0, 0);
    ctx.fillStyle = '#ffd700';
    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(gx, gy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Players
    const colors = ['#ff3b3b', '#3b8eff'];
    for (let i = 0; i < 2; i++) {
        const [px, py] = toM(_players[i].x, _players[i].z);
        ctx.fillStyle = colors[i];
        ctx.shadowColor = colors[i]; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }

    ctx.restore();
}

// ── Three.js scene ────────────────────────────────────────────────────────────

function _initThree() {
    _canvasW = _overlay.clientWidth  || 390;
    _canvasH = _overlay.clientHeight || 680;

    // Each camera covers half the screen height → compute horizontal half-size
    _camHalfW = CAM_HALF * (_canvasW / (_canvasH / 2));

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(_canvasW, _canvasH);
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.autoClear = false;
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x030308);

    // Two independent top-down orthographic cameras, one per player
    for (let i = 0; i < 2; i++) {
        const cam = new THREE.OrthographicCamera(
            -_camHalfW, _camHalfW,
             CAM_HALF, -CAM_HALF,
            0.1, 120
        );
        cam.up.set(0, 0, -1);  // Z- is screen-up (north)
        cam.position.set(0, 40, 0);
        cam.lookAt(new THREE.Vector3(0, 0, 0));
        _cameras[i] = cam;
    }

    // Lights
    _scene.add(new THREE.AmbientLight(0x1a2045, 7));
    const sun = new THREE.DirectionalLight(0x8888ff, 2.5);
    sun.position.set(5, 20, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
    sun.shadow.camera.right = sun.shadow.camera.top   =  30;
    sun.shadow.camera.near = 1; sun.shadow.camera.far  = 80;
    _scene.add(sun);

    _buildMazeMeshes();
    _buildPlayerMeshes();
    _buildGem();
}

// Move a camera to track its player, clamped so view never exits the maze.
function _updateCamera(cam, player) {
    const cx = Math.max(MX + _camHalfW,  Math.min(MX + MAZE_W_WORLD - _camHalfW,  player.x));
    const cz = Math.max(MZ + CAM_HALF,   Math.min(MZ + MAZE_H_WORLD - CAM_HALF,   player.z));
    cam.position.set(cx, 40, cz);
    cam.lookAt(new THREE.Vector3(cx, 0, cz));
}

function _buildMazeMeshes() {
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(MAZE_W_WORLD + 3, MAZE_H_WORLD + 3),
        new THREE.MeshStandardMaterial({ color: 0x070b16, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    _scene.add(floor);

    // Subtle cell grid lines
    const lineMat = new THREE.LineBasicMaterial({ color: 0x1a2060, transparent: true, opacity: 0.35 });
    for (let i = 0; i <= MAZE_W; i++) {
        const x = MX + i * CELL_SIZE;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(x, 0.01, MZ), new THREE.Vector3(x, 0.01, MZ + MAZE_H_WORLD)
        ]);
        _scene.add(new THREE.Line(g, lineMat));
    }
    for (let j = 0; j <= MAZE_H; j++) {
        const z = MZ + j * CELL_SIZE;
        const g = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(MX, 0.01, z), new THREE.Vector3(MX + MAZE_W_WORLD, 0.01, z)
        ]);
        _scene.add(new THREE.Line(g, lineMat));
    }

    // Start zone rings
    _addZoneRing(MX + 0.5 * CELL_SIZE,            MZ + (MAZE_H - 0.5) * CELL_SIZE, 0xff3b3b);
    _addZoneRing(MX + (MAZE_W - 0.5) * CELL_SIZE, MZ + 0.5 * CELL_SIZE,            0x3b8eff);

    const wallMat = new THREE.MeshStandardMaterial({
        color: 0x0c1430, roughness: 0.45, metalness: 0.35,
        emissive: 0x1a3060, emissiveIntensity: 0.55,
    });
    const outerMat = new THREE.MeshStandardMaterial({
        color: 0x0a1128, roughness: 0.4, metalness: 0.45,
        emissive: 0x0a1f80, emissiveIntensity: 0.75,
    });

    for (let r = 0; r < MAZE_H; r++) {
        for (let c = 0; c < MAZE_W; c++) {
            if (_cells[r][c].R && c < MAZE_W - 1) {
                _addWall(MX + (c + 1) * CELL_SIZE, MZ + r * CELL_SIZE + CELL_SIZE / 2, WALL_T, CELL_SIZE, wallMat);
            }
            if (_cells[r][c].B && r < MAZE_H - 1) {
                _addWall(MX + c * CELL_SIZE + CELL_SIZE / 2, MZ + (r + 1) * CELL_SIZE, CELL_SIZE, WALL_T, wallMat);
            }
        }
    }

    _addWall(MX + MAZE_W_WORLD / 2, MZ,                   MAZE_W_WORLD + WALL_T, WALL_T, outerMat);
    _addWall(MX + MAZE_W_WORLD / 2, MZ + MAZE_H_WORLD,    MAZE_W_WORLD + WALL_T, WALL_T, outerMat);
    _addWall(MX,                    MZ + MAZE_H_WORLD / 2, WALL_T, MAZE_H_WORLD + WALL_T, outerMat);
    _addWall(MX + MAZE_W_WORLD,     MZ + MAZE_H_WORLD / 2, WALL_T, MAZE_H_WORLD + WALL_T, outerMat);

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
            new THREE.MeshStandardMaterial({ color: c.color, emissive: c.emissive, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.4 })
        );
        p.mesh.castShadow = true;
        p.mesh.position.set(p.x, PLAYER_R, p.z);
        _scene.add(p.mesh);

        p.light = new THREE.PointLight(c.light, 3.0, 5.0);
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

    _gemLight = new THREE.PointLight(0xffaa00, 4.0, 7);
    _gemLight.position.set(0, 1, 0);
    _scene.add(_gemLight);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 0.6, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, 0);
    _scene.add(ring);
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
        if (!_cells[r][c].R && c + 1 < MAZE_W)        nbrs.push([c + 1, r]);
        if (c > 0 && !_cells[r][c - 1].R)              nbrs.push([c - 1, r]);
        if (!_cells[r][c].B && r + 1 < MAZE_H)         nbrs.push([c, r + 1]);
        if (r > 0 && !_cells[r - 1][c].B)              nbrs.push([c, r - 1]);
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
            const d    = Math.sqrt(d2);
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
        _gemLight.intensity = 3.5 + Math.sin(elapsed * 0.006) * 1.0;
    }

    // Win check
    for (let pid = 0; pid < 2; pid++) {
        if (Math.hypot(_players[pid].x, _players[pid].z) < PLAYER_R + GEM_R + 0.12) {
            _resolve(pid); return;
        }
    }

    if (remaining <= 0) {
        const d0 = Math.hypot(_players[0].x, _players[0].z);
        const d1 = Math.hypot(_players[1].x, _players[1].z);
        _resolve(Math.abs(d0 - d1) < 0.5 ? -1 : d0 < d1 ? 0 : 1);
        return;
    }

    _renderSplitScreen();
    _drawMinimap();
    _af = requestAnimationFrame(_tick);
}

function _renderSplitScreen() {
    if (!_renderer || !_scene) return;
    const halfH = Math.floor(_canvasH / 2);

    _renderer.setScissorTest(true);

    // P1 — bottom half (WebGL y=0 is screen bottom)
    _updateCamera(_cameras[0], _players[0]);
    _renderer.setScissor(0, 0, _canvasW, halfH);
    _renderer.setViewport(0, 0, _canvasW, halfH);
    _renderer.clear(true, true, true);
    _renderer.render(_scene, _cameras[0]);

    // P2 — top half
    _updateCamera(_cameras[1], _players[1]);
    _renderer.setScissor(0, halfH, _canvasW, halfH);
    _renderer.setViewport(0, halfH, _canvasW, halfH);
    _renderer.clear(true, true, true);
    _renderer.render(_scene, _cameras[1]);

    _renderer.setScissorTest(false);
}

// ── Resolution ────────────────────────────────────────────────────────────────

function _resolve(winnerId) {
    if (_done) return;
    _done = true; state.mgActive = false;
    cancelAnimationFrame(_af); _af = null;
    _renderSplitScreen();
    _drawMinimap();
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
    _cameras[0] = _cameras[1] = null;
    _minimapCanvas = null; _timerEl = null;
}
