// Sphere Knockout — Roll your sphere to knock the opponent off the floating platform!
// Use the joystick on your half. P1 at bottom, P2 at top (upside-down). Best of 3.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WIN_ROUNDS  = 2;   // first to 2 round wins
const PLATFORM_R  = 4.6;
const SPHERE_R    = 0.52;
const ACCEL       = 22;
const DAMPING     = 0.78; // base damping per frame (applied as pow(d, dt*60))
const JOY_RADIUS  = 58;   // joystick zone radius in px

let _done = false, _roundsWon = [0, 0], _onWin = null, _isBot = false;
let _overlay = null, _renderer = null, _scene = null, _camera = null;
let _sphereMeshes = [null, null], _sphereLights = [null, null];
let _neutralEl = null, _scoreEls = [null, null];
let _af = null, _lastTime = 0, _roundActive = false;
const _cleanups = [];

// Physics state per sphere
const _sp = [
    { x: 0, z: 0, vx: 0, vz: 0, fallY: 0, fallen: false },
    { x: 0, z: 0, vx: 0, vz: 0, fallY: 0, fallen: false },
];
// Joystick state per player
const _joy = [
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0 },
    { dx: 0, dy: 0, active: false, id: -1, bx: 0, by: 0 },
];
let _joyKnobs = [null, null];

function _resetSphere(pid) {
    const z = pid === 0 ? 2.8 : -2.8;
    const sp = _sp[pid];
    sp.x = 0; sp.z = z;
    sp.vx = (Math.random() - 0.5) * 1.5; sp.vz = 0;
    sp.fallY = 0; sp.fallen = false;
}

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

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#04040e;touch-action:none;';

    // Score HUD
    const hud = document.createElement('div');
    hud.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;justify-content:space-between;align-items:flex-start;padding:6px 14px;box-sizing:border-box;z-index:10;';
    _scoreEls[1] = _mkLabel('P2: 0', '#93c5fd');
    _scoreEls[0] = _mkLabel('P1: 0', '#fca5a5');
    hud.appendChild(_scoreEls[1]);
    hud.appendChild(_scoreEls[0]);
    _overlay.appendChild(hud);

    // Joystick zones — one per player half
    for (let pid = 0; pid < 2; pid++) {
        const zone = document.createElement('div');
        zone.style.cssText = `position:absolute;${pid === 0 ? 'top:50%;bottom:0' : 'top:0;bottom:50%'};left:0;right:0;z-index:5;`;

        const base = document.createElement('div');
        const basePos = pid === 0 ? 'bottom:28px;' : 'top:28px;';
        base.style.cssText = `
            position:absolute;${basePos}left:50%;transform:translateX(-50%);
            width:${JOY_RADIUS * 2}px;height:${JOY_RADIUS * 2}px;border-radius:50%;
            background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.13);
            pointer-events:none;
        `;
        const knob = document.createElement('div');
        const kColor = pid === 0 ? '#ff3b3b' : '#3b8eff';
        knob.style.cssText = `
            position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
            width:46px;height:46px;border-radius:50%;
            background:${kColor};box-shadow:0 0 16px ${kColor};opacity:0.8;
            pointer-events:none;
        `;
        base.appendChild(knob);
        zone.appendChild(base);
        _overlay.appendChild(zone);
        _joyKnobs[pid] = knob;

        const joy = _joy[pid];
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
            const rawX = e.clientX - joy.bx, rawY = e.clientY - joy.by;
            const dist  = Math.sqrt(rawX * rawX + rawY * rawY);
            const clamp = Math.min(1, dist / JOY_RADIUS);
            const angle = Math.atan2(rawY, rawX);
            joy.dx = Math.cos(angle) * clamp;
            joy.dy = Math.sin(angle) * clamp;
            const kOff = JOY_RADIUS - 23;
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

function _initThree() {
    const w = _overlay.clientWidth  || 390;
    const h = _overlay.clientHeight || 680;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _renderer.shadowMap.enabled = true;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x04040e);
    _scene.fog = new THREE.FogExp2(0x04040e, 0.045);

    // Orthographic top-down camera — world +Z is at screen bottom (P1's side)
    const aspect = w / h;
    const vH     = 13;
    _camera = new THREE.OrthographicCamera(
        -vH * aspect / 2,  vH * aspect / 2,
         vH / 2,           -vH / 2,
        0.1, 100
    );
    _camera.position.set(0, 15, 0);
    _camera.lookAt(0, 0, 0);
    _camera.up.set(0, 0, -1); // world -Z points to screen top → P1 (z=+2.8) appears at bottom

    // Lights
    _scene.add(new THREE.AmbientLight(0x2a3050, 4));
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.position.set(5, 14, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    _scene.add(sun);

    // Platform body
    const platGeo = new THREE.CylinderGeometry(PLATFORM_R, PLATFORM_R * 0.93, 0.45, 64);
    const platMat = new THREE.MeshPhongMaterial({ color: 0x111830, shininess: 50, specular: 0x2244bb });
    const plat    = new THREE.Mesh(platGeo, platMat);
    plat.receiveShadow = true;
    plat.position.y = -0.23;
    _scene.add(plat);

    // Platform edge ring
    const edgeGeo = new THREE.TorusGeometry(PLATFORM_R, 0.1, 8, 80);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x2255dd });
    const edge    = new THREE.Mesh(edgeGeo, edgeMat);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.0;
    _scene.add(edge);

    // Center divider line
    const divGeo = new THREE.PlaneGeometry(PLATFORM_R * 2, 0.07);
    const divMat = new THREE.MeshBasicMaterial({ color: 0x3355bb, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
    const div    = new THREE.Mesh(divGeo, divMat);
    div.rotation.x = -Math.PI / 2;
    div.position.y = 0.01;
    _scene.add(div);

    // Subtle grid overlay
    const grid = new THREE.GridHelper(PLATFORM_R * 2, 6, 0x1a2855, 0x1a2855);
    grid.position.y = 0.02;
    _scene.add(grid);

    // Star field
    const starVerts = [];
    for (let i = 0; i < 600; i++) {
        const phi   = Math.acos(2 * Math.random() - 1);
        const theta = Math.random() * Math.PI * 2;
        const r     = 45 + Math.random() * 20;
        starVerts.push(
            Math.sin(phi) * Math.cos(theta) * r,
            Math.cos(phi) * r,
            Math.sin(phi) * Math.sin(theta) * r
        );
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    _scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.18 })));

    // Spheres + sphere glow lights
    const colors   = [0xff3b3b, 0x3b8eff];
    const emissive = [0x441111, 0x112244];
    for (let pid = 0; pid < 2; pid++) {
        const geo = new THREE.SphereGeometry(SPHERE_R, 24, 16);
        const mat = new THREE.MeshPhongMaterial({
            color: colors[pid], emissive: emissive[pid],
            emissiveIntensity: 0.9, shininess: 100, specular: 0xffffff,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        _sphereMeshes[pid] = mesh;
        _scene.add(mesh);

        const light = new THREE.PointLight(colors[pid], 3, 5.5);
        _sphereLights[pid] = light;
        _scene.add(light);
    }
}

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
    }

    if (_neutralEl) _neutralEl.textContent = 'KNOCK THEM OFF!';
    setTimeout(() => { if (!_done && state.mgActive) _roundActive = true; }, 600);
}

function _tick(now) {
    if (_done || !state.mgActive) return;

    const dt = Math.min((now - (_lastTime || now)) / 1000, 0.05);
    _lastTime = now;

    if (_roundActive) {
        _updatePhysics(dt);
        _checkFalls();
    }

    // Update 3D mesh positions
    for (let pid = 0; pid < 2; pid++) {
        const sp = _sp[pid];
        const m  = _sphereMeshes[pid];
        const l  = _sphereLights[pid];
        if (m) {
            const py = sp.fallen ? Math.max(SPHERE_R - 15, SPHERE_R - sp.fallY * 7) : SPHERE_R;
            m.position.set(sp.x, py, sp.z);
            if (!sp.fallen) {
                m.rotation.x += sp.vz * dt * 1.8;
                m.rotation.z -= sp.vx * dt * 1.8;
            }
        }
        if (l) {
            l.position.set(sp.x, SPHERE_R + 0.8, sp.z);
            l.intensity = sp.fallen ? Math.max(0, 3 - sp.fallY * 2) : 3;
        }
    }

    if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
    _af = requestAnimationFrame(_tick);
}

function _updatePhysics(dt) {
    for (let pid = 0; pid < 2; pid++) {
        const sp  = _sp[pid];
        const joy = _joy[pid];
        if (sp.fallen) { sp.fallY += 5 * dt; continue; }

        // Joystick → world force.
        // P2 holds phone upside-down: their visual "right" is world -X, so invert X.
        // Their visual "forward" (toward P1) = joystick pushed down (positive joy.dy = world +Z) — no Z inversion needed.
        const xSign = pid === 0 ? 1 : -1;
        sp.vx += joy.dx * xSign * ACCEL * dt;
        sp.vz += joy.dy         * ACCEL * dt;

        const d = Math.pow(DAMPING, dt * 60);
        sp.vx *= d; sp.vz *= d;

        sp.x += sp.vx * dt;
        sp.z += sp.vz * dt;
    }

    // Bot AI: P2 chases P1
    if (_isBot && !_sp[1].fallen) {
        const dx = _sp[0].x - _sp[1].x, dz = _sp[0].z - _sp[1].z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 0.1) {
            _sp[1].vx += (dx / dist) * ACCEL * dt * 0.75;
            _sp[1].vz += (dz / dist) * ACCEL * dt * 0.75;
        }
    }

    // Elastic sphere-sphere collision
    const dx = _sp[1].x - _sp[0].x, dz = _sp[1].z - _sp[0].z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minD = SPHERE_R * 2;
    if (dist < minD && dist > 0.001 && !_sp[0].fallen && !_sp[1].fallen) {
        const overlap = (minD - dist) / 2;
        const nx = dx / dist, nz = dz / dist;
        _sp[0].x -= nx * overlap; _sp[0].z -= nz * overlap;
        _sp[1].x += nx * overlap; _sp[1].z += nz * overlap;
        const dvx = _sp[1].vx - _sp[0].vx, dvz = _sp[1].vz - _sp[0].vz;
        const dot = dvx * nx + dvz * nz;
        if (dot < 0) {
            const imp = dot * 1.15; // slightly superelastic for fun
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
        const r = Math.sqrt(_sp[pid].x * _sp[pid].x + _sp[pid].z * _sp[pid].z);
        if (r > PLATFORM_R + SPHERE_R * 0.3) {
            _sp[pid].fallen = true;
            fell[pid] = true;
            sfx('land_bad');
        }
    }
    if (!fell[0] && !fell[1]) return;

    _roundActive = false;

    if (fell[0] && fell[1]) {
        if (_neutralEl) _neutralEl.textContent = 'BOTH FELL! REPLAY!';
        setTimeout(() => { if (!_done && state.mgActive) _startRound(); }, 2000);
        return;
    }

    const winner = fell[0] ? 1 : 0;
    _roundsWon[winner]++;
    if (_scoreEls[winner]) _scoreEls[winner].textContent = `P${winner + 1}: ${_roundsWon[winner]}`;
    if (_neutralEl) _neutralEl.textContent = `P${winner + 1} WINS! ${_roundsWon[0]}–${_roundsWon[1]}`;

    if (_roundsWon[winner] >= WIN_ROUNDS) {
        _done = true; state.mgActive = false;
        cancelAnimationFrame(_af); _af = null;
        setTimeout(() => { _destroy(); _onWin(winner); }, 1800);
    } else {
        setTimeout(() => { if (!_done && state.mgActive) _startRound(); }, 2000);
    }
}

function _destroy() {
    _cleanups.forEach(f => f()); _cleanups.length = 0;
    cancelAnimationFrame(_af); _af = null;
    if (_scene) {
        _scene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        _scene.clear();
        _scene = null;
    }
    if (_renderer) { _renderer.dispose(); _renderer = null; }
    _camera = null;
    _sphereMeshes = [null, null]; _sphereLights = [null, null];
    _joyKnobs = [null, null]; _scoreEls = [null, null];
    if (_overlay) { _overlay.remove(); _overlay = null; }
}
