// Tank Clash — Joystick to move/aim, tap right side to fire. First to 3 hits wins,
// or most HP left when the 42 s clock runs out. A short mercy window after each
// hit stops point-blank melts. P1 holds the bottom, P2 the top (face-off).
//
// ⚠️  SPEED / FRAME-RATE RULE (apply to every minigame):
//   All movement values must be expressed as units-per-SECOND, not units-per-frame.
//   Multiply every position delta by `dt` (elapsed seconds since last frame).
//   Compute dt at the top of the game loop:
//     const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
//     _lastTick = now;
//   Cap dt at 0.1 s so a tab-switch never causes a huge jump.
//   This keeps speed identical on 60 Hz phones, 120 Hz tablets, and desktop browsers.
import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const ARENA_W      = 28;
const ARENA_H      = 40;
const TANK_RADIUS  = 1.2;
// ── Feel tuning ───────────────────────────────────────────────────────────────
// At the original 3.0 u/s a tank needed 13 s to drive the 40-unit length of the
// arena, which read as crawling and made cover useless — you could not reach it
// before being shot. 8.0 u/s crosses the arena in 5 s and makes flanking a real
// option. Bullets keep a >4× speed advantage so they still read as projectiles.
const TANK_SPEED   = 8.0;    // world-units per second (was 3.0)
const BULLET_R     = 0.55;
const BULLET_SPEED = 34;     // world-units per second (was 27)
const FIRE_CD      = 600; // ms (was 700)
// Post-hit mercy window. Without it, two point-blank shots could end the game in
// ~4 s — below the 15 s floor in docs/MINIGAME_STANDARD.md §3 — and a player who
// looked away lost before they looked back. (QA design finding DF-05.)
const HIT_IFRAME   = 900; // ms of invulnerability after taking a hit
// Hard ceiling. Without one, two cautious players could ride the manager's 90 s
// tie watchdog — a bug indicator, not a game rule (docs/MINIGAME_STANDARD.md §3).
// At the cap the player with more HP wins outright.
const MATCH_TIME   = 42;  // seconds
const JOY_R        = 50;  // joystick base radius px

// Each map is an array of axis-aligned box obstacles { minX, maxX, minZ, maxZ }.
// Rules: keep a clear corridor through the center so tanks can never fully cage
// each other, and always leave each player a safe spawn zone near ±ARENA_H/2.
const MAPS = [
    // 0 — "Bunkers" (original): two side walls + two top/bottom pillars
    [
        { minX: -10, maxX: -4, minZ: -3, maxZ:  3 },
        { minX:   4, maxX: 10, minZ: -3, maxZ:  3 },
        { minX:  -3, maxX:  3, minZ:-12, maxZ: -9 },
        { minX:  -3, maxX:  3, minZ:  9, maxZ: 12 },
    ],
    // 1 — "Cross": a plus-sign barrier forcing flanking routes
    [
        { minX:  -2, maxX:  2, minZ: -10, maxZ: 10 }, // vertical bar
        { minX: -10, maxX: -4, minZ:  -2, maxZ:  2 }, // left arm
        { minX:   4, maxX: 10, minZ:  -2, maxZ:  2 }, // right arm
    ],
    // 2 — "Diagonal gauntlet": staggered pillars left and right
    [
        { minX: -11, maxX: -6, minZ: -14, maxZ: -10 },
        { minX:   6, maxX: 11, minZ:  -7, maxZ:  -3 },
        { minX:  -3, maxX:  2, minZ:  -2, maxZ:   2 },
        { minX:  -11, maxX: -6, minZ:   3, maxZ:   7 },
        { minX:   6, maxX: 11, minZ:  10, maxZ:  14 },
    ],
    // 3 — "Box ring": ring of four small pillars around center
    [
        { minX:  -8, maxX: -5, minZ:  -8, maxZ: -5 },
        { minX:   5, maxX:  8, minZ:  -8, maxZ: -5 },
        { minX:  -8, maxX: -5, minZ:   5, maxZ:  8 },
        { minX:   5, maxX:  8, minZ:   5, maxZ:  8 },
        { minX:  -2, maxX:  2, minZ:  -2, maxZ:  2 }, // center block
    ],
    // 4 — "Corridor": two long parallel walls leaving narrow side lanes
    [
        { minX:  -7, maxX: -4, minZ: -16, maxZ:  16 },
        { minX:   4, maxX:  7, minZ: -16, maxZ:  16 },
    ],
    // 5 — "Zigzag": alternating offset barriers
    [
        { minX: -12, maxX: -4, minZ: -14, maxZ: -11 },
        { minX:   4, maxX: 12, minZ:  -5, maxZ:  -2 },
        { minX: -12, maxX: -4, minZ:   2, maxZ:   5 },
        { minX:   4, maxX: 12, minZ:  11, maxZ:  14 },
    ],
];

let _obstacles = MAPS[0]; // set per-round in start()

let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _renderer = null, _scene = null, _camera = null;
let _tanks = [], _bullets = [], _hp = [3, 3], _lastFire = [0, 0];
let _invulnUntil = [0, 0];   // performance.now() timestamps — post-hit mercy window
let _input = [], _activeTouches = {};
let _botWanderTarget = null;
let _af = null, _lastTick = 0, _elapsed = 0;
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    registerMinigameCleanup(_destroy);
    _hp = [3, 3]; _lastFire = [0, 0]; _invulnUntil = [0, 0];
    _tanks = []; _bullets = []; _activeTouches = {};
    _obstacles = MAPS[Math.floor(Math.random() * MAPS.length)];
    _input = [new THREE.Vector2(), new THREE.Vector2()];
    _botWanderTarget = new THREE.Vector3();
    _lastTick = 0; _elapsed = 0;
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _initThree();
        if (isBot) _botTick();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0f172a;touch-action:none;';

    // Half-zones: P2 top (rotated 180°), P1 bottom
    for (let pid = 0; pid < 2; pid++) {
        const half = document.createElement('div');
        half.style.cssText = [
            'position:absolute;left:0;right:0;z-index:5;display:flex;',
            pid === 0 ? 'top:50%;bottom:0;' : 'top:0;bottom:50%;',
            pid === 1 ? 'transform:rotate(180deg);' : '',
        ].join('');

        // Left half = joystick, right half = fire
        const joyZone  = _mkZone(pid, 'joy',  'MOVE');
        const fireZone = _mkZone(pid, 'fire', 'FIRE');
        half.appendChild(joyZone);
        half.appendChild(fireZone);

        // Static joystick visual inside joyZone
        const joyBase = document.createElement('div');
        joyBase.style.cssText = [
            `width:${JOY_R*2}px;height:${JOY_R*2}px;border-radius:50%;`,
            'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.15);',
            'position:absolute;left:50%;top:65%;transform:translate(-50%,-50%);pointer-events:none;',
        ].join('');
        const joyKnob = document.createElement('div');
        const kColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        joyKnob.style.cssText = [
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            `width:40px;height:40px;border-radius:50%;background:${kColor};`,
            `box-shadow:0 0 12px ${kColor};pointer-events:none;transition:transform .05s;`,
        ].join('');
        joyBase.appendChild(joyKnob);
        joyZone.appendChild(joyBase);

        // Fire button visual
        const fireBtn = document.createElement('div');
        const fColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        fireBtn.style.cssText = [
            'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
            `width:70px;height:70px;border-radius:50%;`,
            `background:${fColor};opacity:0.25;border:3px solid ${fColor};`,
            'pointer-events:none;',
        ].join('');
        const fireLabel = document.createElement('div');
        fireLabel.style.cssText = [
            'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);',
            `color:${fColor};font-weight:900;font-size:1rem;pointer-events:none;font-family:inherit;`,
        ].join('');
        fireLabel.textContent = 'FIRE';
        fireZone.appendChild(fireBtn);
        fireZone.appendChild(fireLabel);

        // Health pips
        const hpRow = document.createElement('div');
        hpRow.id = `tc-hp-${pid}`;
        hpRow.style.cssText = [
            'position:absolute;left:12px;',
            pid === 0 ? 'top:12px;' : 'bottom:12px;',
            'display:flex;flex-direction:column;gap:6px;pointer-events:none;z-index:10;',
        ].join('');
        for (let i = 0; i < 3; i++) {
            const pip = document.createElement('div');
            pip.id = `tc-hp-${pid}-${i}`;
            pip.style.cssText = [
                'width:18px;height:18px;border-radius:3px;',
                `background:${kColor};box-shadow:0 0 7px ${kColor};transition:all .2s;`,
            ].join('');
            hpRow.appendChild(pip);
        }
        half.appendChild(hpRow);

        // Divider line between halves (only on P1 side)
        if (pid === 0) {
            const div = document.createElement('div');
            div.style.cssText = 'position:absolute;top:0;left:0;right:0;border-top:2px dashed rgba(255,255,255,0.2);pointer-events:none;';
            half.appendChild(div);
        }

        // Joystick input
        const onJoyDown = e => {
            if (_done || _activeTouches[e.pointerId]) return;
            if (pid === 1 && _isBot) return;
            e.preventDefault();
            _activeTouches[e.pointerId] = { role: 'joy', pid, startX: e.clientX, startY: e.clientY, knob: joyKnob };
        };
        const onJoyMove = e => {
            const t = _activeTouches[e.pointerId];
            if (!t || t.role !== 'joy') return;
            e.preventDefault();
            let dx = e.clientX - t.startX, dy = e.clientY - t.startY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > JOY_R) { dx = dx/dist*JOY_R; dy = dy/dist*JOY_R; }
            const kOff = JOY_R - 20;
            t.knob.style.transform = `translate(calc(-50% + ${(dx/JOY_R)*kOff}px), calc(-50% + ${(dy/JOY_R)*kOff}px))`;
            _input[t.pid].set(dx/JOY_R, dy/JOY_R);
        };
        const onJoyUp = e => {
            const t = _activeTouches[e.pointerId];
            if (!t || t.role !== 'joy') return;
            e.preventDefault();
            t.knob.style.transform = 'translate(-50%,-50%)';
            _input[t.pid].set(0, 0);
            delete _activeTouches[e.pointerId];
        };
        const onFireDown = e => {
            if (_done) return;
            if (pid === 1 && _isBot) return;
            e.preventDefault();
            // Flash the button
            fireBtn.style.opacity = '0.7';
            _after(() => { if (fireBtn) fireBtn.style.opacity = '0.25'; }, 120);
            _fire(pid);
        };

        joyZone.addEventListener('pointerdown',   onJoyDown);
        joyZone.addEventListener('pointermove',   onJoyMove);
        joyZone.addEventListener('pointerup',     onJoyUp);
        joyZone.addEventListener('pointercancel', onJoyUp);
        fireZone.addEventListener('pointerdown',  onFireDown);

        _cleanups.push(() => {
            joyZone.removeEventListener('pointerdown',   onJoyDown);
            joyZone.removeEventListener('pointermove',   onJoyMove);
            joyZone.removeEventListener('pointerup',     onJoyUp);
            joyZone.removeEventListener('pointercancel', onJoyUp);
            fireZone.removeEventListener('pointerdown',  onFireDown);
        });

        _overlay.appendChild(half);
    }

    mg.appendChild(_overlay);
}

function _mkZone(pid, type, label) {
    const z = document.createElement('div');
    z.dataset.pid  = pid;
    z.dataset.type = type;
    z.style.cssText = [
        'flex:1;height:100%;position:relative;',
        type === 'joy' ? 'border-right:1px solid rgba(255,255,255,0.07);' : '',
    ].join('');
    return z;
}

// ── Three.js ──────────────────────────────────────────────────────────────────

// Returns the camera height needed to see the full arena on any screen aspect ratio.
function _camHeightForAspect(aspect) {
    const vFovHalf = 30 * Math.PI / 180; // half of 60° FOV
    const halfW = ARENA_W / 2 + 5; // comfortable margin; *1.1 safety for iOS quirks
    const halfD = ARENA_H / 2 + 5;
    const hForWidth = halfW / (Math.tan(vFovHalf) * aspect);
    const hForDepth = halfD / Math.tan(vFovHalf);
    return Math.max(50, Math.max(hForWidth, hForDepth) * 1.1);
}

function _initThree() {
    const w = _overlay.clientWidth  || window.innerWidth;
    const h = _overlay.clientHeight || window.innerHeight;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _renderer.shadowMap.enabled = true;
    // Set only positional styles — do NOT use style.cssText which would wipe
    // the width/height that setSize() wrote, leaving the canvas at its DPR-scaled
    // attribute size (2-3× too large on Retina phones, clipped by overflow:hidden).
    const cs = _renderer.domElement.style;
    cs.position = 'absolute'; cs.top = '0'; cs.left = '0';
    cs.zIndex = '1'; cs.pointerEvents = 'none';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x0f172a);

    const aspect = w / h;
    const camH = _camHeightForAspect(aspect);
    // 60° FOV; camera straight overhead — no z-offset, simpler geometry.
    _camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 500);
    _camera.position.set(0, camH, 0);
    _camera.lookAt(0, 0, 0);

    _scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(10, 30, 10);
    dir.castShadow = true;
    dir.shadow.camera.left = dir.shadow.camera.bottom = -25;
    dir.shadow.camera.right = dir.shadow.camera.top = 25;
    _scene.add(dir);

    // Floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(ARENA_W, ARENA_H),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    _scene.add(floor);

    const grid = new THREE.GridHelper(Math.max(ARENA_W, ARENA_H), 20, 0x334155, 0x1e293b);
    grid.position.y = 0.01;
    _scene.add(grid);

    // Walls
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x475569 });
    [
        [ARENA_W, 2, 1, 0, 1, -ARENA_H/2],
        [ARENA_W, 2, 1, 0, 1,  ARENA_H/2],
        [1, 2, ARENA_H,  ARENA_W/2, 1, 0],
        [1, 2, ARENA_H, -ARENA_W/2, 1, 0],
    ].forEach(([wx, wy, wz, px, py, pz]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(wx, wy, wz), wallMat);
        m.position.set(px, py, pz);
        m.castShadow = true;
        _scene.add(m);
    });

    // Obstacles
    const obsMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.2 });
    _obstacles.forEach(obs => {
        const w2 = obs.maxX - obs.minX, d = obs.maxZ - obs.minZ;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w2, 3, d), obsMat);
        m.position.set(obs.minX + w2/2, 1.5, obs.minZ + d/2);
        m.castShadow = true; m.receiveShadow = true;
        _scene.add(m);
    });

    // Tanks
    _tanks[0] = _mkTank(0xff3b3b);
    _tanks[0].position.set(0, 0,  ARENA_H/2 - 3);
    _tanks[0].rotation.y = Math.PI;
    _scene.add(_tanks[0]);

    _tanks[1] = _mkTank(0x3b8eff);
    _tanks[1].position.set(0, 0, -ARENA_H/2 + 3);
    _scene.add(_tanks[1]);

    const onResize = () => {
        if (!_camera || !_renderer) return;
        const rw = _overlay.clientWidth  || window.innerWidth;
        const rh = _overlay.clientHeight || window.innerHeight;
        const asp = rw / rh;
        const rCamH = _camHeightForAspect(asp);
        _camera.aspect = asp;
        _camera.position.set(0, rCamH, 0);
        _camera.updateProjectionMatrix();
        _renderer.setSize(rw, rh);
    };
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));
}

function _mkTank(color) {
    const g = new THREE.Group();
    const mat     = new THREE.MeshStandardMaterial({ color, roughness: 0.5 });
    const matDark = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 2.4), mat);
    body.position.y = 0.6; body.castShadow = true; body.receiveShadow = true;

    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.6, 16), matDark);
    turret.position.y = 1.5; turret.castShadow = true;

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.8), matDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.5, 1.3); barrel.castShadow = true;

    g.add(body, turret, barrel);
    return g;
}

// ── Game Logic ────────────────────────────────────────────────────────────────

function _fire(pid) {
    const now = performance.now();
    if (now - _lastFire[pid] < FIRE_CD || _hp[pid] <= 0) return;

    // _build() attaches the fire-button listeners synchronously, but the tanks
    // are not created until _initThree() runs two animation frames later — and
    // a resolved game tears them down while the result banner is still up. A tap
    // in either window used to throw an uncaught TypeError on tank.rotation.
    const tank = _tanks[pid];
    if (!tank || _done || !state.mgActive) return;

    _lastFire[pid] = now;
    sfx('go'); haptic('light');

    const dir    = new THREE.Vector3(0, 0, 1).applyEuler(tank.rotation).normalize();
    const bColor = pid === 0 ? 0xff4422 : 0x22aaff;

    // Outer glow shell (larger, semi-transparent)
    const shell = new THREE.Mesh(
        new THREE.SphereGeometry(BULLET_R * 1.9, 12, 12),
        new THREE.MeshBasicMaterial({ color: bColor, transparent: true, opacity: 0.25 })
    );
    // Inner bright core
    const core = new THREE.Mesh(
        new THREE.SphereGeometry(BULLET_R, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    const b = new THREE.Group();
    b.add(shell, core);
    b.position.copy(tank.position).addScaledVector(dir, 1.8);
    b.position.y = 1.2;

    // Point light so bullet illuminates nearby surfaces
    const bLight = new THREE.PointLight(bColor, 2.5, 6);
    b.add(bLight);

    _scene.add(b);
    // vel is stored as a unit-direction; speed is applied per-second in _tick via dt
    _bullets.push({ mesh: b, dir: dir.clone(), pid, born: now });
}

function _tick(now) {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    // Delta-time capped at 100 ms so a tab-switch doesn't cause a huge jump
    const dt = _lastTick === 0 ? 1/60 : Math.min((now - _lastTick) / 1000, 0.1);
    _lastTick = now;
    _elapsed += dt;

    // Clock: surface it, and settle on HP when it expires.
    const remain = Math.max(0, MATCH_TIME - _elapsed);
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = `${Math.ceil(remain)}s   P1 ${'|'.repeat(Math.max(0,_hp[0]))} · ${'|'.repeat(Math.max(0,_hp[1]))} P2`;
    if (remain <= 0) {
        _resolve(_hp[0] > _hp[1] ? 0 : _hp[1] > _hp[0] ? 1 : -1);
        return;
    }

    // Move tanks
    for (let i = 0; i < 2; i++) {
        if (_hp[i] <= 0) continue;
        const inp  = _input[i];
        const tank = _tanks[i];

        if (inp.lengthSq() > 0.01) {
            tank.position.x += inp.x * TANK_SPEED * dt;
            tank.position.z += inp.y * TANK_SPEED * dt;
            tank.rotation.y  = Math.atan2(inp.x, inp.y);
        }

        // Arena bounds
        tank.position.x = Math.max(-ARENA_W/2 + TANK_RADIUS, Math.min(ARENA_W/2 - TANK_RADIUS, tank.position.x));
        tank.position.z = Math.max(-ARENA_H/2 + TANK_RADIUS, Math.min(ARENA_H/2 - TANK_RADIUS, tank.position.z));

        // Obstacle push-out
        for (const obs of _obstacles) {
            const cx = Math.max(obs.minX, Math.min(tank.position.x, obs.maxX));
            const cz = Math.max(obs.minZ, Math.min(tank.position.z, obs.maxZ));
            const dx = tank.position.x - cx, dz = tank.position.z - cz;
            const d  = Math.sqrt(dx*dx + dz*dz);
            if (d < TANK_RADIUS && d > 0.001) {
                tank.position.x += (dx/d) * (TANK_RADIUS - d);
                tank.position.z += (dz/d) * (TANK_RADIUS - d);
            }
        }
    }

    // Blink whoever is inside their mercy window (visibility, not colour, is the cue)
    for (let i = 0; i < 2; i++) {
        if (!_tanks[i]) continue;
        _tanks[i].visible = (_hp[i] > 0 && now < _invulnUntil[i])
            ? Math.floor(now / 90) % 2 === 0
            : true;
    }

    // Move bullets
    for (let i = _bullets.length - 1; i >= 0; i--) {
        const b = _bullets[i];
        b.mesh.position.addScaledVector(b.dir, BULLET_SPEED * dt);
        let destroy = false;

        // Wall
        if (Math.abs(b.mesh.position.x) > ARENA_W/2 || Math.abs(b.mesh.position.z) > ARENA_H/2) destroy = true;

        // Obstacle
        if (!destroy) {
            for (const obs of _obstacles) {
                if (b.mesh.position.x > obs.minX && b.mesh.position.x < obs.maxX &&
                    b.mesh.position.z > obs.minZ && b.mesh.position.z < obs.maxZ) { destroy = true; break; }
            }
        }

        // Tank hit
        if (!destroy) {
            for (let t = 0; t < 2; t++) {
                if (_hp[t] <= 0 || b.pid === t) continue;
                const dx = b.mesh.position.x - _tanks[t].position.x;
                const dz = b.mesh.position.z - _tanks[t].position.z;
                if (Math.sqrt(dx*dx + dz*dz) < TANK_RADIUS + BULLET_R) {
                    destroy = true;
                    // Mercy window: the shot still stops, but it does no damage.
                    if (now < _invulnUntil[t]) { sfx('shield'); break; }
                    _invulnUntil[t] = now + HIT_IFRAME;
                    _hp[t]--;
                    _refreshHP();
                    sfx('land_bad'); haptic('heavy');
                    // Flash white, then blink for the rest of the mercy window so
                    // the invulnerable state is legible without relying on colour.
                    _tanks[t].traverse(c => { if (c.material) c.material.emissive?.setHex(0xffffff); });
                    _after(() => {
                        if (_tanks[t]) _tanks[t].traverse(c => { if (c.material) c.material.emissive?.setHex(0x000000); });
                    }, 150);
                    if (_hp[t] <= 0) _resolve(b.pid);
                }
            }
        }

        // Lifetime
        if (performance.now() - b.born > 3000) destroy = true;

        if (destroy) {
            _scene.remove(b.mesh);
            b.mesh.traverse(c => {
                c.geometry?.dispose();
                if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
            });
            _bullets.splice(i, 1);
        }
    }

    _renderer.render(_scene, _camera);
}

function _refreshHP() {
    for (let pid = 0; pid < 2; pid++) {
        for (let i = 0; i < 3; i++) {
            const el = document.getElementById(`tc-hp-${pid}-${i}`);
            if (!el) continue;
            const alive = i < _hp[pid];
            el.style.background   = alive ? (pid === 0 ? '#ff3b3b' : '#3b8eff') : '#334155';
            el.style.boxShadow    = alive ? `0 0 7px ${pid === 0 ? '#ff3b3b' : '#3b8eff'}` : 'none';
        }
    }
}

// ── Bot ───────────────────────────────────────────────────────────────────────

function _botTick() {
    if (_done || !state.mgActive || _hp[1] <= 0) return;

    const bot = _tanks[1].position;
    const p1  = _tanks[0].position;

    // Line-of-sight check
    let los = true;
    for (let i = 1; i < 15 && los; i++) {
        const tx = bot.x + (p1.x - bot.x) * (i/15);
        const tz = bot.z + (p1.z - bot.z) * (i/15);
        for (const obs of _obstacles) {
            if (tx > obs.minX && tx < obs.maxX && tz > obs.minZ && tz < obs.maxZ) { los = false; break; }
        }
    }

    const dx0 = p1.x - bot.x, dz0 = p1.z - bot.z;
    const len0 = Math.sqrt(dx0*dx0 + dz0*dz0) || 1;

    if (los) {
        // §5 botSkill: aim error and trigger discipline scale with skill.
        //
        // NOTE the coupling: a hull faces the direction it is driving, so for this
        // bot "aim" and "move" are the same vector — it can only point at you by
        // driving at you. That makes the error scale very sensitive. The offset is
        // added to a UNIT direction, so 0.30 is an angular error of ~12.7° at easy
        // and ~2.6° at hard. At 0.9 (the old value) even the hard bot was ~7.7°
        // off, which is wider than a tank at across-the-arena range — it could not
        // land a hit on a stationary target in a whole match.
        const aimErr = (1 - _botSkill) * 0.30 * (Math.random() + Math.random() - 1);
        const strafe = Math.random() < 0.3 ? (Math.random()-.5)*0.5 : 0;
        _input[1].set(dx0/len0 + strafe + aimErr, dz0/len0 + aimErr*0.5).normalize();
        const fireGate  = FIRE_CD + 500 - _botSkill * 430;           // ~992 ms easy → ~735 ms hard
        const willFire  = Math.random() < (0.55 + _botSkill * 0.42); // sometimes just doesn't shoot
        if (willFire && performance.now() - _lastFire[1] > fireGate) _fire(1);
    } else {
        // No firing line — go and get one. Bias hard toward P1 rather than drifting.
        if (Math.random() < 0.2 || bot.distanceTo(_botWanderTarget) < 3)
            _botWanderTarget.set((Math.random()-.5)*15, 0, (Math.random()-.5)*20);
        const mx = p1.x*0.85 + _botWanderTarget.x*0.15 - bot.x;
        const mz = p1.z*0.85 + _botWanderTarget.z*0.15 - bot.z;
        const ml = Math.sqrt(mx*mx + mz*mz) || 1;
        _input[1].set(mx/ml, mz/ml);
    }

    _after(_botTick, 110 + Math.random()*130);
}

// ── Win / Cleanup ─────────────────────────────────────────────────────────────

function _resolve(winnerId) {
    if (_done) return;
    _done = true;
    // winnerId may be -1 when the match clock expires on equal HP.
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    const neutralEl = document.getElementById('mg-neutral');
    if (neutralEl) neutralEl.textContent = winnerId < 0
        ? `DRAW — ${_hp[0]} HP EACH`
        : `P${winnerId + 1} WINS!`;
    _after(() => { _destroy(); _onWin(winnerId); }, 1200);
}

function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_scene) {
        _scene.traverse(obj => {
            obj.geometry?.dispose();
            if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
        });
        _scene.clear(); _scene = null;
    }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    _camera = null; _tanks = []; _bullets = [];
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
