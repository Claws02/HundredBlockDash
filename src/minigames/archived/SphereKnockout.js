// Sphere Knockout — Roll your glowing sphere to knock the opponent off the platform!
// P1 controls bottom half, P2 controls top half (upside-down faceoff). Best of 3 rounds.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_ROUNDS       = 2;
const PLATFORM_R       = 4.6;
const SPHERE_R         = 0.52;
const ACCEL            = 22;
// DAMPING = 0.985 per 60-fps frame — spheres slide for ~3s after a collision.
// Formula: Math.pow(DAMPING, dt*60).  Old value 0.78 stopped spheres in < 1 s.
const DAMPING          = 0.985;
const JOY_RADIUS       = 58;        // px
const ROUND_TIMEOUT_MS = 25000;     // 25 s per round; tiebreak by center distance

let _done = false, _roundsWon = [0, 0], _onWin = null, _isBot = false;
let _overlay = null, _renderer = null, _scene = null, _camera = null;
let _sphereMeshes = [null, null], _sphereLights = [null, null], _shadowMeshes = [null, null];
let _neutralEl = null, _scoreEls = [null, null];
let _af = null, _lastTime = 0, _roundActive = false;
const _cleanups = [];
const _timers   = []; // every setTimeout ID → all cleared in _destroy()

const _sp = [
    { x: 0, z: 0, vx: 0, vz: 0, fallY: 0, fallen: false },
    { x: 0, z: 0, vx: 0, vz: 0, fallY: 0, fallen: false },
];
const _joy = [
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0 },
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0 },
];
let _joyKnobs = [null, null];

// ── Helpers ──────────────────────────────────────────────────────────────────

function _resetSphere(pid) {
    const sp = _sp[pid];
    sp.x = 0; sp.z = pid === 0 ? 2.8 : -2.8;
    sp.vx = (Math.random() - 0.5) * 2; sp.vz = pid === 0 ? -0.5 : 0.5;
    sp.fallY = 0; sp.fallen = false;
}

// Tracked setTimeout — every ID is stored so _destroy() can cancel the lot.
function _after(fn, ms) {
    const id = setTimeout(() => {
        _timers.splice(_timers.indexOf(id), 1);
        fn();
    }, ms);
    _timers.push(id);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _roundsWon = [0, 0]; _onWin = onWin; _isBot = isBot;
    _neutralEl = document.getElementById('mg-neutral');
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _initThree();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM Build ─────────────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#04040e;touch-action:none;';

    // Score HUD — sits above the canvas
    const hud = document.createElement('div');
    hud.style.cssText = [
        'position:absolute;inset:0;pointer-events:none;',
        'display:flex;justify-content:space-between;align-items:flex-start;',
        'padding:6px 14px;box-sizing:border-box;z-index:10;',
    ].join('');
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);

    // One joystick zone per player half
    for (let pid = 0; pid < 2; pid++) {
        const zone = document.createElement('div');
        zone.style.cssText = [
            'position:absolute;',
            pid === 0 ? 'top:50%;bottom:0;' : 'top:0;bottom:50%;',
            'left:0;right:0;z-index:5;',
        ].join('');

        const base = document.createElement('div');
        base.style.cssText = [
            'position:absolute;',
            pid === 0 ? 'bottom:28px;' : 'top:28px;',
            `left:50%;transform:translateX(-50%);`,
            `width:${JOY_RADIUS * 2}px;height:${JOY_RADIUS * 2}px;border-radius:50%;`,
            'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.13);',
            'pointer-events:none;',
        ].join('');

        const kColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        const knob = document.createElement('div');
        knob.style.cssText = [
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            'width:46px;height:46px;border-radius:50%;',
            `background:${kColor};box-shadow:0 0 16px ${kColor};opacity:0.85;`,
            'pointer-events:none;',
        ].join('');
        base.appendChild(knob);
        zone.appendChild(base);
        _overlay.appendChild(zone);
        _joyKnobs[pid] = knob;

        const joy = _joy[pid];
        const kOff = JOY_RADIUS - 23;

        const onDown = e => {
            if (_done || joy.active) return;
            e.preventDefault();
            const r = base.getBoundingClientRect();
            joy.active = true; joy.id = e.pointerId;
            joy.bx = r.left + r.width / 2;
            joy.by = r.top  + r.height / 2;
        };
        const onMove = e => {
            if (!joy.active || e.pointerId !== joy.id) return;
            e.preventDefault();
            const rx = e.clientX - joy.bx, ry = e.clientY - joy.by;
            const mag = Math.sqrt(rx * rx + ry * ry);
            const s   = Math.min(1, mag / JOY_RADIUS);
            const a   = Math.atan2(ry, rx);
            joy.dx = Math.cos(a) * s;
            joy.dy = Math.sin(a) * s;
            knob.style.transform = `translate(calc(-50% + ${joy.dx * kOff}px), calc(-50% + ${joy.dy * kOff}px))`;
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

function _mkLabel(text, color) {
    const el = document.createElement('div');
    el.style.cssText = `font-size:1.2rem;font-weight:900;color:${color};font-family:inherit;text-shadow:0 0 10px ${color};`;
    el.textContent = text;
    return el;
}

// ── Three.js Scene ────────────────────────────────────────────────────────────

function _initThree() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / h;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x04040e);
    // Linear fog starts well beyond camera distance (15 u) — zero fog on any scene object.
    _scene.fog = new THREE.Fog(0x04040e, 40, 80);

    // ── Camera ──
    // Isometric-ish view from front-above (~40° elevation).
    // Camera-right = world +X, so joystick X maps cleanly regardless of tilt.
    // P1 (z=+2.8) projects to screen-bottom; P2 (z=-2.8) projects to screen-top ✓
    const minWorldWidth = PLATFORM_R * 2 + 7;  // 16.2 — "further away" generous margin
    const vH = minWorldWidth / Math.min(aspect, 1.0);

    _camera = new THREE.OrthographicCamera(
        -vH * aspect / 2,  vH * aspect / 2,
         vH / 2,          -vH / 2,
        0.1, 120
    );
    _camera.position.set(0, 10, 13);
    _camera.lookAt(0, 0, 0);
    // Default up = (0,1,0) — correct for iso view; do NOT set up to (0,0,-1)

    // ── Lights ──
    _scene.add(new THREE.AmbientLight(0x2a3050, 5));
    const sun = new THREE.DirectionalLight(0xffffff, 3.5);
    sun.position.set(5, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    _scene.add(sun);

    // ── Platform ──
    const platGeo = new THREE.CylinderGeometry(PLATFORM_R, PLATFORM_R * 0.92, 0.4, 64);
    const platMat = new THREE.MeshPhongMaterial({ color: 0x111830, shininess: 55, specular: 0x2244bb });
    const plat    = new THREE.Mesh(platGeo, platMat);
    plat.receiveShadow = true;
    plat.position.y = -0.2;
    _scene.add(plat);

    // Edge ring — glows blue
    const edgeMesh = new THREE.Mesh(
        new THREE.TorusGeometry(PLATFORM_R, 0.13, 8, 80),
        new THREE.MeshBasicMaterial({ color: 0x3366ff })
    );
    edgeMesh.rotation.x = Math.PI / 2;
    _scene.add(edgeMesh);

    // Center divider (shows where P1/P2 zones split)
    const divMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PLATFORM_R * 2, 0.08),
        new THREE.MeshBasicMaterial({ color: 0x4466cc, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    divMesh.rotation.x = -Math.PI / 2;
    divMesh.position.y = 0.01;
    _scene.add(divMesh);

    // Subtle grid
    const grid = new THREE.GridHelper(PLATFORM_R * 2, 6, 0x1a2855, 0x1a2855);
    grid.position.y = 0.02;
    _scene.add(grid);

    // Star field — distant; unaffected by scene fog (distance >> fog start)
    const sv = [];
    for (let i = 0; i < 600; i++) {
        const phi = Math.acos(2 * Math.random() - 1), theta = Math.random() * Math.PI * 2;
        const r = 50 + Math.random() * 20;
        sv.push(Math.sin(phi) * Math.cos(theta) * r, Math.cos(phi) * r, Math.sin(phi) * Math.sin(theta) * r);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
    _scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22 })));

    // ── Spheres, shadow discs, and glow lights ──
    const sColor    = [0xff3b3b, 0x3b8eff];
    const sEmissive = [0x551111, 0x112255];
    for (let pid = 0; pid < 2; pid++) {
        const mat = new THREE.MeshPhongMaterial({
            color: sColor[pid], emissive: sEmissive[pid],
            emissiveIntensity: 1.0, shininess: 120, specular: 0xffffff,
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_R, 26, 18), mat);
        mesh.castShadow = true;
        _sphereMeshes[pid] = mesh;
        _scene.add(mesh);

        // Under-shadow disc — gives top-down depth cue
        const shadow = new THREE.Mesh(
            new THREE.CircleGeometry(SPHERE_R * 0.82, 18),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.022;
        _shadowMeshes[pid] = shadow;
        _scene.add(shadow);

        // Per-sphere coloured point light
        const light = new THREE.PointLight(sColor[pid], 4, 7);
        _sphereLights[pid] = light;
        _scene.add(light);
    }
}

// ── Round flow ────────────────────────────────────────────────────────────────

function _startRound() {
    if (_done || !state.mgActive) return;
    _roundActive = false;

    _resetSphere(0);
    _resetSphere(1);

    for (let pid = 0; pid < 2; pid++) {
        _joy[pid].active = false; _joy[pid].dx = 0; _joy[pid].dy = 0;
        if (_joyKnobs[pid]) _joyKnobs[pid].style.transform = 'translate(-50%,-50%)';
        const m = _sphereMeshes[pid];
        if (m) { m.position.set(_sp[pid].x, SPHERE_R, _sp[pid].z); m.visible = true; }
        const s = _shadowMeshes[pid];
        if (s) { s.position.set(_sp[pid].x, 0.022, _sp[pid].z); s.visible = true; }
    }

    if (_neutralEl) _neutralEl.textContent = 'KNOCK THEM OFF!';

    // 600 ms grace period before round goes live
    _after(() => {
        if (_done || !state.mgActive) return;
        _roundActive = true;
        // 25-second timeout: tiebreak by proximity to centre
        _after(_onRoundTimeout, ROUND_TIMEOUT_MS);
    }, 600);
}

function _onRoundTimeout() {
    if (!_roundActive || _done) return;
    _roundActive = false;
    sfx('countdown');
    const d0 = Math.hypot(_sp[0].x, _sp[0].z);
    const d1 = Math.hypot(_sp[1].x, _sp[1].z);
    if (Math.abs(d0 - d1) < 0.4) {
        if (_neutralEl) _neutralEl.textContent = 'TIME — TOO CLOSE! REPLAY!';
        _after(() => { if (!_done && state.mgActive) _startRound(); }, 2000);
    } else {
        _resolveRound(d0 < d1 ? 0 : 1, 'TIME! ');
    }
}

function _resolveRound(winner, prefix = '') {
    _roundsWon[winner]++;
    if (_scoreEls[winner]) _scoreEls[winner].textContent = `P${winner + 1}: ${_roundsWon[winner]}`;
    if (_neutralEl) _neutralEl.textContent = `${prefix}P${winner + 1} WINS! ${_roundsWon[0]}–${_roundsWon[1]}`;

    if (_roundsWon[winner] >= WIN_ROUNDS) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        _after(() => { _destroy(); _onWin(winner); }, 1800);
    } else {
        _after(() => { if (!_done && state.mgActive) _startRound(); }, 2000);
    }
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _tick(now) {
    if (_done || !state.mgActive) return;

    const dt = Math.min((now - (_lastTime || now)) / 1000, 0.05);
    _lastTime = now;

    if (_roundActive) {
        _updatePhysics(dt);
        _checkFalls();
    }

    // Sync 3D positions with physics state
    for (let pid = 0; pid < 2; pid++) {
        const sp = _sp[pid];
        const m  = _sphereMeshes[pid];
        const l  = _sphereLights[pid];
        const sh = _shadowMeshes[pid];

        if (m) {
            // Parabolic drop when fallen; drift in X,Z carried by physics
            const py = sp.fallen ? SPHERE_R - 4.8 * sp.fallY * sp.fallY : SPHERE_R;
            m.position.set(sp.x, py, sp.z);
            if (!sp.fallen) {
                // Rolling rotation — visually satisfying even in top-down view
                m.rotation.x += sp.vz * dt * 1.9;
                m.rotation.z -= sp.vx * dt * 1.9;
                // Pulse emissive when near the edge (danger warning)
                const distFromCentre = Math.hypot(sp.x, sp.z);
                const danger = Math.max(0, Math.min(1, (distFromCentre / PLATFORM_R - 0.65) / 0.35));
                m.material.emissiveIntensity = 1.0 + danger * 3.0 * (0.5 + 0.5 * Math.sin(now * 0.014));
            }
        }

        if (l) {
            const py = sp.fallen ? SPHERE_R - 4.8 * sp.fallY * sp.fallY + 1.2 : SPHERE_R + 1.2;
            l.position.set(sp.x, py, sp.z);
            l.intensity = sp.fallen ? Math.max(0, 4 - sp.fallY * 3) : 4;
        }

        if (sh) {
            sh.position.set(sp.x, 0.022, sp.z);
            sh.visible = !sp.fallen;
        }
    }

    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
    _af = requestAnimationFrame(_tick);
}

// ── Physics ───────────────────────────────────────────────────────────────────

function _updatePhysics(dt) {
    for (let pid = 0; pid < 2; pid++) {
        const sp = _sp[pid];
        if (sp.fallen) {
            sp.fallY += dt;          // fall duration in seconds
            sp.x += sp.vx * dt;      // keep drifting outward from edge
            sp.z += sp.vz * dt;
            continue;
        }

        // Compute input force — bot and human handled in same loop so damping is uniform
        let fx = 0, fz = 0;
        if (_isBot && pid === 1) {
            const dx = _sp[0].x - sp.x, dz = _sp[0].z - sp.z;
            const dist = Math.hypot(dx, dz);
            if (dist > 0.1) { fx = (dx / dist) * ACCEL * 0.80; fz = (dz / dist) * ACCEL * 0.80; }
        } else {
            const joy = _joy[pid];
            // P2 holds phone upside-down → their visual "right" = world -X
            const xSign = pid === 0 ? 1 : -1;
            fx = joy.dx * xSign * ACCEL;
            fz = joy.dy         * ACCEL;
        }

        sp.vx += fx * dt;
        sp.vz += fz * dt;

        // Frame-rate-independent damping — sliding feel, not instant stop
        const d = Math.pow(DAMPING, dt * 60);
        sp.vx *= d;
        sp.vz *= d;

        sp.x += sp.vx * dt;
        sp.z += sp.vz * dt;
    }

    // Elastic sphere-sphere collision (equal mass, restitution 1.15 = slightly superelastic)
    const dx = _sp[1].x - _sp[0].x, dz = _sp[1].z - _sp[0].z;
    const dist = Math.hypot(dx, dz);
    const minD = SPHERE_R * 2;
    if (dist < minD && dist > 0.001 && !_sp[0].fallen && !_sp[1].fallen) {
        const overlap = (minD - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        // Push apart so they don't overlap next frame
        _sp[0].x -= nx * overlap; _sp[0].z -= nz * overlap;
        _sp[1].x += nx * overlap; _sp[1].z += nz * overlap;
        const dvx = _sp[1].vx - _sp[0].vx, dvz = _sp[1].vz - _sp[0].vz;
        const dot = dvx * nx + dvz * nz;
        if (dot < 0) {
            const imp = dot * 1.15;
            _sp[0].vx += imp * nx; _sp[0].vz += imp * nz;
            _sp[1].vx -= imp * nx; _sp[1].vz -= imp * nz;
            sfx('land_good');
        }
    }
}

function _checkFalls() {
    if (!_roundActive) return;
    const fell = [false, false];
    for (let pid = 0; pid < 2; pid++) {
        if (_sp[pid].fallen) continue;
        if (Math.hypot(_sp[pid].x, _sp[pid].z) > PLATFORM_R + SPHERE_R * 0.3) {
            _sp[pid].fallen = true;
            fell[pid] = true;
            sfx('land_bad');
        }
    }
    if (!fell[0] && !fell[1]) return;

    _roundActive = false;

    if (fell[0] && fell[1]) {
        if (_neutralEl) _neutralEl.textContent = 'BOTH FELL! REPLAY!';
        _after(() => { if (!_done && state.mgActive) _startRound(); }, 2000);
        return;
    }

    _resolveRound(fell[0] ? 1 : 0);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function _destroy() {
    _done = true;                                     // block any deferred callbacks
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_scene) {
        _scene.traverse(obj => {
            obj.geometry?.dispose();
            if (obj.material) {
                (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
            }
        });
        _scene.clear();
        _scene = null;
    }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    _camera = null;
    _sphereMeshes = [null, null]; _sphereLights = [null, null]; _shadowMeshes = [null, null];
    _joyKnobs = [null, null]; _scoreEls = [null, null];
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
