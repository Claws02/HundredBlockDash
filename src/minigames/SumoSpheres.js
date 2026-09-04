// Sumo Spheres — Drag your half to move. Knock the opponent off the arena!
// P1 holds the bottom, P2 holds the top (face-off). The arena starts closing in
// at 22 s and is fully shrunk by 34 s, so a stand-off always gets resolved.
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
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';

const ARENA_RADIUS   = 15;
const SPHERE_RADIUS  = 1.5;

// ── Feel tuning ───────────────────────────────────────────────────────────────
// Terminal speed ≈ BASE_ACCEL × MAX_MOMENTUM / (1 − FRICTION), in units/frame.
// The original 0.001 accel topped out around 5 units/s, so crossing the 30-unit
// arena took ~6 s and the spheres read as barely moving. It also took 5.5 s of
// held input just to reach full momentum. Now: ~12 units/s top speed (≈2.5 s to
// cross) and full momentum in ~1.5 s, while FRICTION stays at 0.94 to keep the
// heavy, slidey sumo weight that makes the knockbacks land.
const BASE_ACCEL     = 0.0024;   // was 0.001  — 2.4× top speed
const MOMENTUM_GAIN  = 0.050;    // was 0.015  — full charge in ~1.5 s, not ~5.5 s
const MOMENTUM_DECAY = 0.070;    // was 0.05   — lets go a touch more crisply
const MAX_MOMENTUM   = 5.0;
const FRICTION       = 0.94;
const BOUNCE_BASE    = 0.13;     // was 0.10   — even a light nudge registers
const BOUNCE_MULT    = 0.038;    // was 0.04   — trimmed so faster play isn't pinball
const MIN_ARENA_R    = 4.0;
const SHRINK_START   = 22;   // s before the arena starts closing (was 30)
const SHRINK_DUR     = 12;   // s to fully close (was 15)

// One colour per slot, in the two forms the game needs them: a CSS string for
// the joystick and a hex number for the sphere material.
const BALL_CSS = ['#ff3b3b', '#3b8eff', '#4ade80', '#fbbf24'];
const BALL_HEX = [0xff3b3b, 0x3b8eff, 0x4ade80, 0xfbbf24];

let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _renderer = null, _scene = null, _camera = null;
let _n = 2;                  // slots, not seats
let _balls = [];             // one sphere mesh per slot
let _arenaMesh = null, _ringMesh = null;
let _af = null, _startTime = 0, _currentArenaRadius = ARENA_RADIUS;
let _lastTick = 0;
let _vel = [], _input = [], _mom = [];
let _falling = [];           // per slot: out of the ring
let _outAt = [];             // when each sphere went over, so last-out can be read
let _activeTouches = {};
let _knobs = [];             // joystick knobs, so a bot's stick can be animated
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
    _n = Math.max(2, Math.min(4, slotCount()));
    _vel   = Array.from({ length: _n }, () => new THREE.Vector3());
    _input = Array.from({ length: _n }, () => new THREE.Vector2());
    _mom   = new Array(_n).fill(0);
    _falling = new Array(_n).fill(false);
    _outAt = new Array(_n).fill(0);
    _knobs = new Array(_n).fill(null);
    _activeTouches = {};
    _currentArenaRadius = ARENA_RADIUS;
    _lastTick = 0;
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        _initThree();
        _startTime = performance.now();
        _botTick();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────

function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a1a2e;touch-action:none;';

    // Joystick zones — P2 on top, P1 on bottom
    const JOY_R = 52; // base radius px
    _knobs = new Array(_n).fill(null);

    // THE RING IS NOT DIVIDED. Sumo is one arena everybody is trying to shove
    // everybody else out of — quartering it would be four people rolling around
    // alone. Only the INPUT is divided: zonesFor hands out a quadrant each and
    // a thumb there drives that sphere.
    const zw = _overlay.clientWidth || window.innerWidth;
    const zh = _overlay.clientHeight || window.innerHeight;
    const zoneRects = zonesFor(_n, zw, zh);

    for (let pid = 0; pid < _n; pid++) {
        const color = BALL_CSS[pid] || '#ffffff';
        const zr = zoneRects[pid].rect;
        const far = zoneRects[pid].rot === 180;

        const zone = document.createElement('div');
        zone.style.cssText = [
            'position:absolute;z-index:5;',
            `left:${zr.x}px;top:${zr.y}px;width:${zr.w}px;height:${zr.h}px;`,
        ].join('');

        // Floating joystick. The stick is not a fixed pad at the bottom of the
        // half — it appears wherever the thumb first lands and the knob swings
        // in a circle around that point. A fixed pad meant looking down to find
        // it; this way you never take your eyes off your sphere.
        const base = document.createElement('div');
        base.style.cssText = [
            'position:absolute;left:50%;top:50%;',
            'transform:translate(-50%,-50%);',
            `width:${JOY_R * 2}px;height:${JOY_R * 2}px;border-radius:50%;`,
            'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.15);',
            'pointer-events:none;opacity:.35;',
            'transition:left .18s ease, top .18s ease, opacity .18s ease;',
        ].join('');

        const knob = document.createElement('div');
        knob.style.cssText = [
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);',
            'width:44px;height:44px;border-radius:50%;pointer-events:none;',
            `background:${color};box-shadow:0 0 14px ${color};opacity:0.85;`,
            'transition:transform .05s;',
        ].join('');
        base.appendChild(knob);
        zone.appendChild(base);
        _knobs[pid] = knob;
        _overlay.appendChild(zone);

        // Where the ring rests when nobody is touching: a visible hint at the
        // outer edge of the half, out of the way of the arena.
        const restLeft = '50%';
        const restTop  = far ? '84px' : 'calc(100% - 84px)';
        base.style.left = restLeft;
        base.style.top  = restTop;

        const park = () => {
            base.style.transition = 'left .18s ease, top .18s ease, opacity .18s ease';
            base.style.left = restLeft;
            base.style.top  = restTop;
            base.style.opacity = '.35';
            knob.style.transform = 'translate(-50%,-50%)';
        };

        const onDown = e => {
            if (_done || _activeTouches[e.pointerId]) return;
            if (isBotSlot(pid)) return;
            e.preventDefault();
            _activeTouches[e.pointerId] = { pid, startX: e.clientX, startY: e.clientY };
            // Without capture, dragging past the midline silently stops steering
            // because the moves are delivered to the other half's zone.
            try { zone.setPointerCapture(e.pointerId); } catch (err) {}
            // Snap the ring under the thumb, kept fully inside the half so it
            // never gets clipped at an edge.
            const r  = zone.getBoundingClientRect();
            const cx = Math.max(JOY_R, Math.min(r.width  - JOY_R, e.clientX - r.left));
            const cy = Math.max(JOY_R, Math.min(r.height - JOY_R, e.clientY - r.top));
            base.style.transition = 'opacity .12s ease';   // no glide to the thumb
            base.style.left = cx + 'px';
            base.style.top  = cy + 'px';
            base.style.opacity = '1';
            knob.style.transform = 'translate(-50%,-50%)';
            // The ring may have been clamped away from the finger; measure from
            // where it actually landed so the stick is centred on the ring.
            _activeTouches[e.pointerId].startX = r.left + cx;
            _activeTouches[e.pointerId].startY = r.top  + cy;
        };
        const onMove = e => {
            const t = _activeTouches[e.pointerId];
            if (!t) return;
            e.preventDefault();
            let dx = e.clientX - t.startX, dy = e.clientY - t.startY;
            const dist = Math.sqrt(dx*dx + dy*dy), max = JOY_R;
            if (dist > max) { dx = dx/dist*max; dy = dy/dist*max; }
            // Move knob visually (offset from center = dx/dy capped at JOY_R - knob_r)
            const kOff = JOY_R - 22;
            const nx = (dx / max) * kOff, ny = (dy / max) * kOff;
            knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
            _input[t.pid].set(dx / max, dy / max);
        };
        const onUp = e => {
            const t = _activeTouches[e.pointerId];
            if (!t) return;
            e.preventDefault();
            park();
            try { zone.releasePointerCapture(e.pointerId); } catch (err) {}
            _input[t.pid].set(0, 0);
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
    }

    // A name tag in each control zone, in that player's colour, so you can see
    // which stick is yours and which sphere it drives. This replaced a dashed
    // line across the middle labelled "P1 ↑ / ↓ P2" — a divider that described
    // two halves, on a screen that now has as many zones as there are players.
    zoneRects.forEach((z, pid) => {
        const tag = document.createElement('div');
        const r = z.rect;
        // At the player's OWN OUTER EDGE, beside where their stick rests —
        // never toward the middle, where the arena is. A far seat's tag is
        // rotated with them, about its own top-left, so its anchor is the
        // opposite corner of the zone.
        const far = z.rot === 180;
        tag.style.cssText = [
            'position:absolute;z-index:6;pointer-events:none;white-space:nowrap;',
            far ? `left:${r.x + r.w - 12}px;top:${r.y + 26}px;`
                + 'transform:rotate(180deg);transform-origin:left top;'
                : `left:${r.x + 12}px;top:${r.y + r.h - 26}px;`,
            'font-size:.75rem;font-weight:800;letter-spacing:.5px;',
            `color:${BALL_CSS[pid] || '#fff'};opacity:.75;`,
        ].join('');
        tag.textContent = _nameOf(pid);
        _overlay.appendChild(tag);
    });

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

// Returns the camera height needed to see the full arena on any screen aspect ratio.
function _camHeightForAspect(aspect) {
    const vFovHalf = 30 * Math.PI / 180; // half of 60° FOV
    const r = ARENA_RADIUS + 7; // arena radius + comfortable margin; *1.1 safety for iOS quirks
    // Portrait (aspect<1): width is the tight dimension, compute height to fit it.
    // Landscape (aspect>=1): clamp aspect to 1 so height stays reasonable.
    return Math.max(40, (r / (Math.tan(vFovHalf) * Math.min(aspect, 1))) * 1.1);
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
    _scene.background = new THREE.Color(0x1a1a2e);

    const aspect = w / h;
    const camH = _camHeightForAspect(aspect);
    _scene.fog = new THREE.Fog(0x1a1a2e, camH * 1.5, camH * 4);
    // 60° FOV; camera straight overhead — no z-offset, simpler geometry.
    _camera = new THREE.PerspectiveCamera(60, aspect, 0.1, camH * 6);
    _camera.position.set(0, camH, 0);
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

    // Spread evenly round the ring, facing the middle: at two that is the
    // north-south face-off the game shipped with, at four it is the compass.
    _balls = [];
    for (let pid = 0; pid < _n; pid++) {
        const a = Math.PI / 2 + (pid * Math.PI * 2) / _n;
        const b = new THREE.Mesh(sphereGeo, new THREE.MeshStandardMaterial({
            color: BALL_HEX[pid] || 0xffffff, roughness: 0.3, metalness: 0.6,
        }));
        b.position.set(Math.cos(a) * 8, SPHERE_RADIUS, Math.sin(a) * 8);
        b.castShadow = true;
        _scene.add(b);
        _balls.push(b);
    }

    const onResize = () => {
        if (!_camera || !_renderer) return;
        const rw = _overlay.clientWidth  || window.innerWidth;
        const rh = _overlay.clientHeight || window.innerHeight;
        const asp = rw / rh;
        const rCamH = _camHeightForAspect(asp);
        _camera.aspect = asp;
        _camera.position.set(0, rCamH, 0);
        _scene.fog = new THREE.Fog(0x1a1a2e, rCamH * 1.5, rCamH * 4);
        _camera.updateProjectionMatrix();
        _renderer.setSize(rw, rh);
    };
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));
}

// ── Bot ───────────────────────────────────────────────────────────────────────

function _botTick() {
    if (_done || !state.mgActive) return;
    // §5 botSkill: a low-skill bot re-aims slowly, steers sloppily, and hugs the
    // centre instead of committing to a ram; a high-skill bot chases hard.
    const noise      = (1 - _botSkill) * 0.8;                 // 0.60 easy → 0.12 hard
    const safeMargin = 0.45 + _botSkill * 0.25;               // hard rides closer to the rim
    for (let pid = 0; pid < _n; pid++) {
        if (!isBotSlot(pid) || _falling[pid]) continue;
        const me = _balls[pid];
        const distToCenter = Math.hypot(me.position.x, me.position.z);
        let tx = 0, tz = 0;
        if (distToCenter > _currentArenaRadius * safeMargin) { tx = 0; tz = 0; }
        else if (Math.random() > _botSkill * 0.5 + 0.5) { tx = 0; tz = 0; }   // hesitates
        else {
            // Shove the NEAREST rival still in the ring, rather than a fixed
            // opponent — with four spheres "the other one" does not exist.
            let best = null, bestD = Infinity;
            for (let j = 0; j < _n; j++) {
                if (j === pid || _falling[j]) continue;
                const d = me.position.distanceTo(_balls[j].position);
                if (d < bestD) { bestD = d; best = _balls[j]; }
            }
            if (best) { tx = best.position.x; tz = best.position.z; }
        }
        const dx = tx - me.position.x, dz = tz - me.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0) _input[pid].set(dx / d + (Math.random() - .5) * noise,
                                   dz / d + (Math.random() - .5) * noise).normalize();
        // Drive the bot's knob too, so its zone doesn't look like dead UI.
        if (_knobs[pid]) {
            const k = 30;
            _knobs[pid].style.transform =
                `translate(calc(-50% + ${(_input[pid].x * k).toFixed(1)}px), ` +
                `calc(-50% + ${(_input[pid].y * k).toFixed(1)}px))`;
        }
    }
    _after(_botTick, 220 - _botSkill * 140);                  // 185 ms easy → 100 ms hard
}

// ── Game Loop ─────────────────────────────────────────────────────────────────

let _shrinkWarned = false;

function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    // Frame-rate normalisation: f = 1.0 at 60 Hz, ~0.5 at 120 Hz, ~2 at 30 Hz.
    // Every per-frame physics step below is scaled by f (and friction is raised
    // to the f power) so the feel is identical regardless of refresh rate.
    const dtSec = _lastTick === 0 ? 1 / 60 : Math.min((now - _lastTick) / 1000, 0.1);
    _lastTick = now;
    const f = dtSec * 60;

    const elapsed = (now - _startTime) / 1000;

    // Arena shrink. Starts at 22 s and completes by 34 s, so a stalemate is
    // squeezed out inside the 15–40 s design window (docs/MINIGAME_STANDARD.md
    // §3) instead of drifting toward the manager's 90 s tie watchdog.
    if (elapsed > SHRINK_START && _currentArenaRadius > MIN_ARENA_R) {
        if (!_shrinkWarned) {
            _shrinkWarned = true;
            const lbl = document.getElementById('sumo-shrink-label');
            if (lbl) { lbl.style.opacity = '1'; _after(() => { if (lbl) lbl.style.opacity = '0'; }, 2500); }
            sfx('land_bad');
        }
        const progress = Math.min((elapsed - SHRINK_START) / SHRINK_DUR, 1.0);
        _currentArenaRadius = ARENA_RADIUS - (ARENA_RADIUS - MIN_ARENA_R) * progress;
        const s = _currentArenaRadius / ARENA_RADIUS;
        _arenaMesh.scale.set(s, 1, s);
        _ringMesh.scale.set(s, s, 1);
        _ringMesh.material.color.lerpColors(new THREE.Color(0xffcc00), new THREE.Color(0xff2200), progress);
    }

    for (let i = 0; i < _n; i++) {
        // Momentum build / decay
        if (_input[i].lengthSq() > 0 && !_falling[i]) _mom[i] = Math.min(_mom[i] + MOMENTUM_GAIN * f, MAX_MOMENTUM);
        else _mom[i] = Math.max(_mom[i] - MOMENTUM_DECAY * f, 0);

        // Apply input acceleration
        if (!_falling[i]) {
            _vel[i].x += _input[i].x * BASE_ACCEL * _mom[i] * f;
            _vel[i].z += _input[i].y * BASE_ACCEL * _mom[i] * f;
        }
        // Friction (raised to the f power so decay-per-second is frame-rate independent)
        _vel[i].multiplyScalar(Math.pow(FRICTION, f));
        // Gravity while falling
        if (_falling[i]) _vel[i].y -= 0.04 * f;
        _balls[i].position.addScaledVector(_vel[i], f);
    }

    // Collision — EVERY pair, not just the one. Four spheres in a shrinking
    // ring means three-way pile-ups are the normal case, and resolving only one
    // pairing would let the others interpenetrate.
    for (let i = 0; i < _n; i++) {
        for (let j = i + 1; j < _n; j++) {
            if (_falling[i] || _falling[j]) continue;
            const delta = new THREE.Vector3().subVectors(_balls[i].position, _balls[j].position);
            const dist = delta.length();
            if (dist >= SPHERE_RADIUS * 2 || dist === 0) continue;
            haptic('heavy');
            sfx('boost');
            const overlap = SPHERE_RADIUS * 2 - dist;
            const normal = delta.normalize();
            _balls[i].position.addScaledVector(normal,  overlap / 2);
            _balls[j].position.addScaledVector(normal, -overlap / 2);
            const knock = BOUNCE_BASE + (_mom[i] + _mom[j]) * BOUNCE_MULT;
            _vel[i].addScaledVector(normal,  knock);
            _vel[j].addScaledVector(normal, -knock);
            _mom[i] = 0; _mom[j] = 0;
        }
    }

    for (let i = 0; i < _n; i++) {
        // Rolling animation (scaled by f to match the frame-rate-independent motion)
        if (!_falling[i]) {
            _balls[i].rotation.x += _vel[i].z * 0.2 * f;
            _balls[i].rotation.z -= _vel[i].x * 0.2 * f;
        }
        // Fall check
        if (_falling[i]) continue;
        const d = Math.hypot(_balls[i].position.x, _balls[i].position.z);
        if (d > _currentArenaRadius) {
            _falling[i] = true; _outAt[i] = performance.now();
            sfx('land_bad'); haptic('heavy');
            _vel[i].set((Math.random() - .5) * .2, 0, (Math.random() - .5) * .2);
            _checkWin();
        }
    }

    _renderer.render(_scene, _camera);
}

// LAST ONE IN THE RING. At two seats one sphere going over settled it, which
// is why this used to read the two flags directly. Above two it does not: the
// survivors keep shoving, and the round ends when one is left — or when the
// last of them go over together, which is a draw.
function _checkWin() {
    const standing = [];
    for (let i = 0; i < _n; i++) if (!_falling[i]) standing.push(i);
    if (standing.length > 1) return;

    _after(() => {
        if (_done) return;
        const neutralEl = document.getElementById('mg-neutral');
        // Nobody left standing means the last shove took the remainder over
        // together — but only the ones that fell on that same beat drew. Anyone
        // who went over earlier is still ranked below them, so the winner is
        // whoever survived longest.
        const winner = standing.length === 1 ? standing[0] : _lastOut();
        if (neutralEl) {
            neutralEl.textContent = winner < 0 ? 'DRAW!' : `${_nameOf(winner)} WINS!`;
        }
        if (winner >= 0) sfx('mg_win');
        // Standings are survival: still in the ring beats out of it, and among
        // those out, whoever lasted longest ranks higher.
        // A finite sentinel, not Infinity: two of those subtract to NaN and a
        // NaN comparator scrambles the sort rather than ranking anything.
        const rank = _balls.map((_, i) => (_falling[i] ? _outAt[i] : Number.MAX_SAFE_INTEGER));
        _after(() => { _destroy(); _onWin(winner, null, rank); }, 1500);
    }, 900);
}

/**
 * Nobody left standing: the win goes to whoever survived LONGEST.
 *
 * Two spheres shoved over on the same beat is a genuine draw, but at four the
 * usual case is that the last two went over a second apart and the later one
 * plainly outlasted the other — calling that a draw would throw away a result
 * everybody at the table just watched happen. The 120 ms band is what separates
 * "the same shove" from "hung on longer".
 */
function _lastOut() {
    const latest = Math.max(..._outAt);
    const tied = _outAt.reduce((a, t, i) => (latest - t < 120 ? a.concat(i) : a), []);
    return tied.length === 1 ? tied[0] : -1;
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
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
    _camera = null; _balls = []; _arenaMesh = null; _ringMesh = null;
    _vel = []; _input = []; _mom = []; _falling = []; _outAt = []; _knobs = [];
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _shrinkWarned = false;
}
