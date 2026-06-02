// Sumo Spheres — Drag your half to move. Knock the opponent off the arena!
// P1 holds the bottom, P2 holds the top (face-off). Arena shrinks after 30s.
import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';

const ARENA_RADIUS   = 15;
const SPHERE_RADIUS  = 1.5;
const BASE_ACCEL     = 0.001;
const MOMENTUM_GAIN  = 0.015;
const MAX_MOMENTUM   = 5.0;
const FRICTION       = 0.94;
const BOUNCE_BASE    = 0.10;
const BOUNCE_MULT    = 0.04;
const MIN_ARENA_R    = 4.0;

let _done = false, _onWin = null, _isBot = false;
let _overlay = null, _renderer = null, _scene = null, _camera = null;
let _p1 = null, _p2 = null, _arenaMesh = null, _ringMesh = null;
let _af = null, _startTime = 0, _currentArenaRadius = ARENA_RADIUS;
let _vel1, _vel2, _input1, _input2, _mom1 = 0, _mom2 = 0;
let _falling = { p1: false, p2: false };
let _activeTouches = {};
const _cleanups = [];
const _timers   = [];

function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _vel1 = new THREE.Vector3(); _vel2 = new THREE.Vector3();
    _input1 = new THREE.Vector2(); _input2 = new THREE.Vector2();
    _mom1 = 0; _mom2 = 0;
    _falling = { p1: false, p2: false };
    _activeTouches = {};
    _currentArenaRadius = ARENA_RADIUS;
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _initThree();
        _startTime = performance.now();
        if (isBot) _botTick();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a1a2e;touch-action:none;';

    // Touch zones — P2 on top, P1 on bottom
    for (let pid = 0; pid < 2; pid++) {
        const zone = document.createElement('div');
        zone.style.cssText = [
            'position:absolute;left:0;right:0;z-index:5;',
            pid === 0 ? 'top:50%;bottom:0;' : 'top:0;bottom:50%;',
        ].join('');
        zone.dataset.pid = pid;

        const onDown = e => {
            if (_done || _activeTouches[e.pointerId]) return;
            if (pid === 1 && _isBot) return;
            e.preventDefault();
            _activeTouches[e.pointerId] = { pid, startX: e.clientX, startY: e.clientY };
        };
        const onMove = e => {
            const t = _activeTouches[e.pointerId];
            if (!t) return;
            e.preventDefault();
            let dx = e.clientX - t.startX, dy = e.clientY - t.startY;
            const dist = Math.sqrt(dx*dx + dy*dy), max = 40;
            if (dist > max) { dx = dx/dist*max; dy = dy/dist*max; }
            if (t.pid === 0) _input1.set(dx/max, dy/max);
            else             _input2.set(dx/max, dy/max);
        };
        const onUp = e => {
            const t = _activeTouches[e.pointerId];
            if (!t) return;
            e.preventDefault();
            if (t.pid === 0) _input1.set(0, 0);
            else             _input2.set(0, 0);
            delete _activeTouches[e.pointerId];
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
        _overlay.appendChild(zone);
    }

    // Label strip dividing the two halves
    const divider = document.createElement('div');
    divider.style.cssText = [
        'position:absolute;top:50%;left:0;right:0;z-index:6;pointer-events:none;',
        'border-top:2px dashed rgba(255,255,255,0.18);',
        'display:flex;justify-content:space-between;padding:4px 16px;box-sizing:border-box;',
    ].join('');
    divider.innerHTML = `
        <span style="font-size:.75rem;color:rgba(255,100,100,.7);font-family:inherit;">P1 ↑</span>
        <span style="font-size:.75rem;color:rgba(100,150,255,.7);font-family:inherit;">↓ P2</span>
    `;
    _overlay.appendChild(divider);

    // Shrink warning label (hidden until shrink starts)
    const shrinkLabel = document.createElement('div');
    shrinkLabel.id = 'sumo-shrink-label';
    shrinkLabel.style.cssText = [
        'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
        'z-index:20;pointer-events:none;',
        'font-size:1.4rem;font-weight:900;color:#ff4444;',
        'text-shadow:0 0 12px #ff0000;opacity:0;transition:opacity .5s;',
        'font-family:inherit;text-align:center;',
    ].join('');
    shrinkLabel.textContent = '⚠ ARENA SHRINKING';
    _overlay.appendChild(shrinkLabel);

    mg.appendChild(_overlay);
}

// ── Three.js ──────────────────────────────────────────────────────────────────

function _initThree() {
    const w = window.innerWidth, h = window.innerHeight;

    _renderer = new THREE.WebGLRenderer({ antialias: true });
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.setSize(w, h);
    _renderer.shadowMap.enabled = true;
    _renderer.domElement.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;';
    _overlay.insertBefore(_renderer.domElement, _overlay.firstChild);

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x1a1a2e);
    _scene.fog = new THREE.Fog(0x1a1a2e, 30, 70);

    _camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
    _camera.position.set(0, 40, 10);
    _camera.lookAt(0, 0, 0);

    _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 30, 20);
    dir.castShadow = true;
    dir.shadow.camera.left = dir.shadow.camera.bottom = -25;
    dir.shadow.camera.right = dir.shadow.camera.top = 25;
    _scene.add(dir);

    // Arena platform
    _arenaMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS, 2, 64),
        new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8, metalness: 0.2 })
    );
    _arenaMesh.position.y = -1;
    _arenaMesh.receiveShadow = true;
    _scene.add(_arenaMesh);

    // Gold ring decoration near edge
    _ringMesh = new THREE.Mesh(
        new THREE.RingGeometry(ARENA_RADIUS - 1.5, ARENA_RADIUS - 1, 64),
        new THREE.MeshBasicMaterial({ color: 0xffcc00, side: THREE.DoubleSide })
    );
    _ringMesh.rotation.x = -Math.PI / 2;
    _ringMesh.position.y = 0.01;
    _scene.add(_ringMesh);

    const sphereGeo = new THREE.SphereGeometry(SPHERE_RADIUS, 32, 32);

    _p1 = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.3, metalness: 0.6 }));
    _p1.position.set(0, SPHERE_RADIUS,  8);
    _p1.castShadow = true;
    _scene.add(_p1);

    _p2 = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({ color: 0x3b8eff, roughness: 0.3, metalness: 0.6 }));
    _p2.position.set(0, SPHERE_RADIUS, -8);
    _p2.castShadow = true;
    _scene.add(_p2);

    const onResize = () => {
        if (!_camera || !_renderer) return;
        _camera.aspect = window.innerWidth / window.innerHeight;
        _camera.updateProjectionMatrix();
        _renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));
}

// ── Bot ───────────────────────────────────────────────────────────────────────

function _botTick() {
    if (_done || !state.mgActive) return;
    if (!_falling.p2 && !_falling.p1) {
        const distToCenter = Math.sqrt(_p2.position.x**2 + _p2.position.z**2);
        let tx, tz;
        if (distToCenter > _currentArenaRadius * 0.6) { tx = 0; tz = 0; }
        else { tx = _p1.position.x; tz = _p1.position.z; }
        const dx = tx - _p2.position.x, dz = tz - _p2.position.z;
        const d = Math.sqrt(dx*dx + dz*dz);
        if (d > 0) _input2.set(dx/d + (Math.random()-.5)*.3, dz/d + (Math.random()-.5)*.3).normalize();
    }
    _after(_botTick, 100);
}

// ── Game Loop ─────────────────────────────────────────────────────────────────

let _shrinkWarned = false;

function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const elapsed = (performance.now() - _startTime) / 1000;

    // Arena shrink (30s → 45s)
    if (elapsed > 30 && _currentArenaRadius > MIN_ARENA_R) {
        if (!_shrinkWarned) {
            _shrinkWarned = true;
            const lbl = document.getElementById('sumo-shrink-label');
            if (lbl) { lbl.style.opacity = '1'; _after(() => { if (lbl) lbl.style.opacity = '0'; }, 2500); }
            sfx('warning');
        }
        const progress = Math.min((elapsed - 30) / 15, 1.0);
        _currentArenaRadius = ARENA_RADIUS - (ARENA_RADIUS - MIN_ARENA_R) * progress;
        const s = _currentArenaRadius / ARENA_RADIUS;
        _arenaMesh.scale.set(s, 1, s);
        _ringMesh.scale.set(s, s, 1);
        _ringMesh.material.color.lerpColors(new THREE.Color(0xffcc00), new THREE.Color(0xff2200), progress);
    }

    // Momentum build / decay
    if (_input1.lengthSq() > 0 && !_falling.p1) _mom1 = Math.min(_mom1 + MOMENTUM_GAIN, MAX_MOMENTUM);
    else _mom1 = Math.max(_mom1 - 0.05, 0);
    if (_input2.lengthSq() > 0 && !_falling.p2) _mom2 = Math.min(_mom2 + MOMENTUM_GAIN, MAX_MOMENTUM);
    else _mom2 = Math.max(_mom2 - 0.05, 0);

    // Apply input acceleration
    if (!_falling.p1) { _vel1.x += _input1.x * BASE_ACCEL * _mom1; _vel1.z += _input1.y * BASE_ACCEL * _mom1; }
    if (!_falling.p2) { _vel2.x += _input2.x * BASE_ACCEL * _mom2; _vel2.z += _input2.y * BASE_ACCEL * _mom2; }

    // Friction
    _vel1.multiplyScalar(FRICTION);
    _vel2.multiplyScalar(FRICTION);

    // Gravity while falling
    if (_falling.p1) _vel1.y -= 0.04;
    if (_falling.p2) _vel2.y -= 0.04;

    _p1.position.add(_vel1);
    _p2.position.add(_vel2);

    // Collision
    if (!_falling.p1 && !_falling.p2) {
        const delta = new THREE.Vector3().subVectors(_p1.position, _p2.position);
        const dist = delta.length();
        if (dist < SPHERE_RADIUS * 2) {
            haptic('heavy');
            sfx('jump');
            const overlap = SPHERE_RADIUS * 2 - dist;
            const normal = delta.normalize();
            _p1.position.addScaledVector(normal,  overlap / 2);
            _p2.position.addScaledVector(normal, -overlap / 2);
            const knock = BOUNCE_BASE + (_mom1 + _mom2) * BOUNCE_MULT;
            _vel1.addScaledVector(normal,  knock);
            _vel2.addScaledVector(normal, -knock);
            _mom1 = 0; _mom2 = 0;
        }
    }

    // Rolling animation
    if (!_falling.p1) { _p1.rotation.x += _vel1.z * 0.2; _p1.rotation.z -= _vel1.x * 0.2; }
    if (!_falling.p2) { _p2.rotation.x += _vel2.z * 0.2; _p2.rotation.z -= _vel2.x * 0.2; }

    // Fall check
    const d1 = Math.sqrt(_p1.position.x**2 + _p1.position.z**2);
    const d2 = Math.sqrt(_p2.position.x**2 + _p2.position.z**2);
    if (d1 > _currentArenaRadius && !_falling.p1) {
        _falling.p1 = true; sfx('land_bad'); haptic('heavy');
        _vel1.set((Math.random()-.5)*.2, 0, (Math.random()-.5)*.2);
        _checkWin();
    }
    if (d2 > _currentArenaRadius && !_falling.p2) {
        _falling.p2 = true; sfx('land_bad'); haptic('heavy');
        _vel2.set((Math.random()-.5)*.2, 0, (Math.random()-.5)*.2);
        _checkWin();
    }

    _renderer.render(_scene, _camera);
}

function _checkWin() {
    _after(() => {
        if (_done) return;
        const neutralEl = document.getElementById('mg-neutral');
        let winner;
        if (_falling.p1 && _falling.p2) { winner = -1; if (neutralEl) neutralEl.textContent = "DRAW!"; }
        else if (_falling.p2)            { winner = 0;  if (neutralEl) neutralEl.textContent = "P1 WINS!"; sfx('mg_win'); }
        else                             { winner = 1;  if (neutralEl) neutralEl.textContent = "P2 WINS!"; sfx('mg_win'); }
        _after(() => { _destroy(); _onWin(winner); }, 1500);
    }, 900);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

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
    _camera = null; _p1 = null; _p2 = null; _arenaMesh = null; _ringMesh = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _shrinkWarned = false;
}
