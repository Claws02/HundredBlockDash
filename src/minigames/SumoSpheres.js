// ============================================================
// SUMO SPHERES — everybody in a glass ball, one crumbling ring.
// (Rebuilt on the stage; the earlier version is in archived/SumoSpheres.js.)
//
// TWO, THREE OR FOUR players on one phone, one shared camera over the ring.
// Each player's character rides upright inside a see-through sphere.
//
//   DRAG in your zone: a stick appears under your thumb and rolls your ball
//   that way. Holding a direction builds momentum, and momentum is what makes a
//   hit knock somebody back.
//
// The ring is stone tiles inside a straw rope. From 22 s the outer bands
// crumble away and the rope pulls in, fully closed by 34 s, so a stand-off
// always gets resolved. Last one in the ring wins.
//
// LIVE (MG_PROFILE.live): the physics and the zones are unchanged from the
// N-slot version; only the picture moved onto the stage.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, effects, overheadCam } from '../engine/StageKit.js';

// ── Physics (as before: per-60 Hz-frame units, scaled by f = dt × 60) ────────
const ARENA_RADIUS = 15, SPHERE_RADIUS = 1.5;
const BASE_ACCEL = 0.0024, MOMENTUM_GAIN = 0.050, MOMENTUM_DECAY = 0.070, MAX_MOMENTUM = 5.0;
const FRICTION = 0.94, BOUNCE_BASE = 0.13, BOUNCE_MULT = 0.038;
const MIN_ARENA_R = 4.0, SHRINK_START = 22, SHRINK_DUR = 12;
const BANDS = 11;                       // concentric rings of tiles, outermost first to go
const READY_TIME = 1.2;
const FIG_SCALE = 1.35;
const JOY_R = 52;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _fx = null, _label = null;
let _n = 2, _balls = [], _tiles = [], _rope = null, _shake = 0;
let _vel = [], _input = [], _mom = [], _falling = [], _outAt = [], _knobs = [], _touches = {};
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _radius = ARENA_RADIUS, _warned = false, _botT = 0, _winner = -2;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _vel = Array.from({ length: _n }, () => new THREE.Vector3());
    _input = Array.from({ length: _n }, () => new THREE.Vector2());
    _mom = new Array(_n).fill(0); _falling = new Array(_n).fill(false); _outAt = new Array(_n).fill(0);
    _knobs = new Array(_n).fill(null); _touches = {};
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _radius = ARENA_RADIUS; _warned = false; _botT = 0; _winner = -2; _shake = 0;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#171428;z-index:5;touch-action:none;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0x171428 });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // screen up is −z, so a drag reads as it looks
        _buildRing();
    }
    _balls = Array.from({ length: _n }, (_, pid) => _buildBall(pid));
    _buildZones();

    _dir.open({
        place: 'THE TERRITORY · THE SUMO RING', title: 'SUMO SPHERES',
        sub: _n > 2 ? `${_n} BALLS · LAST ONE IN THE RING` : 'LAST ONE IN THE RING',
        from: { pos: [18, 12, 18], look: [0, 0, 0] },
        to: _cam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _balls = []; _tiles = []; _rope = null; _knobs = []; _touches = {}; _label = null; _dir = null; _fx = null;
}
function _finish(w, rank) { if (_done) return; _destroy(); _onWin?.(w, null, rank); }

const _cam = () => overheadCam(_stage, ARENA_RADIUS * 2, ARENA_RADIUS * 2, 1.5, 0.32);

// ── The ring: tiles in bands, a straw rope, a drop all round ─────────────────
function _buildRing() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0x171428, 55, 130);
    _stage.light({ sun: 0xfff1d6, sunI: 1.0, sky: 0xcdd6ff, ground: 0x2a2140, hemiI: 0.55, dir: [-10, 30, 14], span: 22 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    // Stone tiles: each band a ring of segments, alternating shades.
    const stone = [0x8f7d62, 0x7d6c54, 0x9c8a6e].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }));
    const bw = (ARENA_RADIUS - MIN_ARENA_R) / (BANDS - 1);
    for (let b = 0; b < BANDS; b++) {
        const outer = ARENA_RADIUS - b * bw, inner = b === BANDS - 1 ? 0 : outer - bw;
        const segs = Math.max(6, Math.round(outer * 1.1));
        for (let s = 0; s < segs; s++) {
            const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
            const shape = new THREE.Shape();
            shape.absarc(0, 0, outer - 0.04, a0 + 0.004, a1 - 0.004, false);
            shape.absarc(0, 0, Math.max(0, inner + 0.04), a1 - 0.004, a0 + 0.004, true);
            const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false, curveSegments: 4 });
            geo.rotateX(Math.PI / 2);                             // extrude downward from y = 0
            const m = add(geo, stone[(b + s) % 3], 0, 0, 0);
            m.receiveShadow = true;
            _tiles.push({ m, outer, fall: 0, spin: (Math.random() - 0.5) * 2, drift: new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)) });
        }
    }
    // The straw rope (tawara) at the live edge, and a painted centre mark.
    _rope = add(new THREE.TorusGeometry(ARENA_RADIUS - 0.5, 0.32, 8, 72), new THREE.MeshStandardMaterial({ color: 0xe8c15a, roughness: 1 }), 0, 0.15, 0);
    _rope.rotation.x = Math.PI / 2;
    [-1, 1].forEach(s => { const l = add(new THREE.BoxGeometry(0.25, 0.02, 2.4), new THREE.MeshBasicMaterial({ color: 0xf8fafc }), s * 1.8, 0.01, 0); });
    // The pillar the ring stands on, and lanterns out in the dark.
    add(new THREE.CylinderGeometry(ARENA_RADIUS * 0.7, ARENA_RADIUS * 0.4, 30, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a2f55, roughness: 1, side: THREE.DoubleSide }), 0, -16.2, 0);
    for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2, r = ARENA_RADIUS + 7 + (k % 3) * 2;
        const lamp = add(new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshBasicMaterial({ color: k % 2 ? 0xff7a59 : 0xffd166 }), Math.cos(a) * r, -2 - (k % 4) * 1.5, Math.sin(a) * r);
        lamp.userData.bob = k;
    }
}

// ── The balls ────────────────────────────────────────────────────────────────
function _buildBall(pid) {
    // Spread evenly round the ring, facing the middle.
    const a = Math.PI / 2 + (pid * Math.PI * 2) / _n;
    const b = { pos: new THREE.Vector3(Math.cos(a) * 8, SPHERE_RADIUS, Math.sin(a) * 8), spin: new THREE.Quaternion(), face: a + Math.PI };
    if (!_stage.gl) return b;
    const g = new THREE.Group();
    const col = seat(pid).color;
    const glass = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_RADIUS, 32, 24),
        new THREE.MeshStandardMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.34, roughness: 0.05, metalness: 0.2, depthWrite: false }));
    glass.renderOrder = 2; g.add(glass);
    // A band round the ball in the player's colour, which rolls with it.
    const band = new THREE.Mesh(new THREE.TorusGeometry(SPHERE_RADIUS * 0.99, 0.09, 8, 40), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35 }));
    const roll = new THREE.Group(); roll.add(band);
    const band2 = band.clone(); band2.rotation.y = Math.PI / 2; roll.add(band2);
    g.add(roll);
    g.position.copy(b.pos);
    _stage.add(g);
    // The rider stays upright inside; only the ball rolls.
    const ch = _stage.character(pid);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    ch.rig.root.position.set(b.pos.x, b.pos.y - SPHERE_RADIUS * 0.85, b.pos.z);
    ch.anim.play('ready');
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(SPHERE_RADIUS * 0.9, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; _stage.add(shadow);
    Object.assign(b, { g, roll, rig: ch.rig, anim: ch.anim, shadow });
    return b;
}

// ── Zones: a floating stick per player, in the zone layout for this count ────
function _buildZones() {
    const zw = _overlay.clientWidth || window.innerWidth, zh = _overlay.clientHeight || window.innerHeight;
    const zones = zonesFor(_n, zw, zh);
    for (let pid = 0; pid < _n; pid++) {
        const color = seat(pid).css, zr = zones[pid].rect, far = zones[pid].rot === 180;
        const zone = document.createElement('div');
        zone.style.cssText = `position:absolute;z-index:5;left:${zr.x}px;top:${zr.y}px;width:${zr.w}px;height:${zr.h}px;`;
        zone.dataset.slot = pid;
        const base = document.createElement('div');
        base.style.cssText = `position:absolute;transform:translate(-50%,-50%);width:${JOY_R * 2}px;height:${JOY_R * 2}px;border-radius:50%;` +
            'background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.2);pointer-events:none;opacity:.35;transition:left .18s ease, top .18s ease, opacity .18s ease;';
        const knob = document.createElement('div');
        knob.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;pointer-events:none;background:${color};box-shadow:0 0 14px ${color};opacity:0.85;`;
        base.appendChild(knob); zone.appendChild(base);
        _knobs[pid] = knob;
        const restTop = far ? '84px' : 'calc(100% - 84px)';
        const park = () => { base.style.transition = 'left .18s ease, top .18s ease, opacity .18s ease'; base.style.left = '50%'; base.style.top = restTop; base.style.opacity = '.35'; knob.style.transform = 'translate(-50%,-50%)'; };
        park();
        const onDown = e => {
            if (_done || _touches[e.pointerId] || isBotSlot(pid)) return;
            e.preventDefault();
            try { zone.setPointerCapture(e.pointerId); } catch (err) {}
            const r = zone.getBoundingClientRect();
            const cx = Math.max(JOY_R, Math.min(r.width - JOY_R, e.clientX - r.left));
            const cy = Math.max(JOY_R, Math.min(r.height - JOY_R, e.clientY - r.top));
            base.style.transition = 'opacity .12s ease'; base.style.left = cx + 'px'; base.style.top = cy + 'px'; base.style.opacity = '1';
            _touches[e.pointerId] = { pid, x: r.left + cx, y: r.top + cy };
        };
        const onMove = e => {
            const t = _touches[e.pointerId];
            if (!t) return;
            e.preventDefault();
            let dx = e.clientX - t.x, dy = e.clientY - t.y;
            const d = Math.hypot(dx, dy);
            if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
            const k = JOY_R - 22;
            knob.style.transform = `translate(calc(-50% + ${dx / JOY_R * k}px), calc(-50% + ${dy / JOY_R * k}px))`;
            // Screen directions, for every seat: the ball goes where the thumb points.
            _input[pid].set(dx / JOY_R, dy / JOY_R);
        };
        const onUp = e => {
            const t = _touches[e.pointerId];
            if (!t) return;
            park();
            try { zone.releasePointerCapture(e.pointerId); } catch (err) {}
            _input[pid].set(0, 0);
            delete _touches[e.pointerId];
        };
        zone.addEventListener('pointerdown', onDown);
        zone.addEventListener('pointermove', onMove);
        zone.addEventListener('pointerup', onUp);
        zone.addEventListener('pointercancel', onUp);
        _overlay.appendChild(zone);
        // The player's name at their own outer edge.
        const tag = document.createElement('div');
        tag.className = 'bfont';
        tag.style.cssText = 'position:absolute;z-index:6;pointer-events:none;white-space:nowrap;font-size:13px;letter-spacing:1.5px;' +
            `color:${color};text-shadow:0 2px 0 rgba(0,0,0,.6);` +
            (far ? `left:${zr.x + zr.w - 12}px;top:${zr.y + 26}px;transform:rotate(180deg);transform-origin:left top;` : `left:${zr.x + 12}px;top:${zr.y + zr.h - 26}px;`);
        tag.textContent = seat(pid).name + (seat(pid).bot ? ' · BOT' : '');
        _overlay.appendChild(tag);
    }
    _label = document.createElement('div');
    _label.className = 'bfont';
    _label.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;pointer-events:none;' +
        'font-size:30px;letter-spacing:3px;color:#fff8ee;text-shadow:0 0 14px rgba(0,0,0,.8),0 3px 0 rgba(0,0,0,.6);opacity:0;transition:opacity .3s;text-align:center;';
    _overlay.appendChild(_label);
}
function _say(text, ms, color = '#fff8ee') {
    if (!_label) return;
    _label.textContent = text; _label.style.color = color; _label.style.opacity = text ? '1' : '0';
    _label.dataset.until = ms ? String(_t + ms / 1000) : '';
}

// ── Bot: shove the nearest rival still in, unless near the rim ──────────────
function _botThink() {
    const noise = (1 - _botSkill) * 0.8, safe = 0.45 + _botSkill * 0.25;
    for (let pid = 0; pid < _n; pid++) {
        if (!isBotSlot(pid) || _falling[pid]) continue;
        const me = _balls[pid].pos, dc = Math.hypot(me.x, me.z);
        let tx = 0, tz = 0;
        if (dc > _radius * safe || Math.random() > _botSkill * 0.5 + 0.5) { tx = 0; tz = 0; }
        else {
            let best = null, bd = Infinity;
            for (let j = 0; j < _n; j++) {
                if (j === pid || _falling[j]) continue;
                const d = me.distanceTo(_balls[j].pos);
                if (d < bd) { bd = d; best = _balls[j].pos; }
            }
            if (best) { tx = best.x; tz = best.z; }
        }
        const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz);
        if (d > 0) _input[pid].set(dx / d + (Math.random() - 0.5) * noise, dz / d + (Math.random() - 0.5) * noise).normalize();
        if (_knobs[pid]) _knobs[pid].style.transform = `translate(calc(-50% + ${(_input[pid].x * 30).toFixed(1)}px), calc(-50% + ${(_input[pid].y * 30).toFixed(1)}px))`;
    }
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _say('HAKKEYOI!', READY_TIME * 1000, '#facc15'); sfx('countdown'); }
    else if (phase === 'play') { _say(''); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    if (_label?.dataset.until && _t > +_label.dataset.until) _say('');
    if (_phase === 'ready' && _phaseT >= READY_TIME) _enter('play');
    if (_phase === 'play' || _phase === 'settle') _step(dt);
    _draw(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _cam(), cam = _stage.camera;
        _shake = Math.max(0, _shake - dt);
        const j = _shake * 1.2;
        cam.position.set(c.pos[0] + (Math.random() - 0.5) * j, c.pos[1], c.pos[2] + (Math.random() - 0.5) * j);
        cam.lookAt(...c.look);
    }
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') {
        const left = Math.max(0, Math.ceil(SHRINK_START - _clock));
        el.textContent = _clock < SHRINK_START ? `THE RING CRUMBLES IN ${left}s` : '⚠ THE RING IS CRUMBLING';
    }
}

function _step(dt) {
    const f = dt * 60;
    _clock += dt;
    if (_phase === 'play') {
        _botT -= dt;
        if (_botT <= 0) { _botThink(); _botT = (220 - _botSkill * 140) / 1000; }
    }
    // The ring closes from 22 s and is shut by 34 s.
    if (_clock > SHRINK_START && _radius > MIN_ARENA_R) {
        if (!_warned) { _warned = true; _say('⚠ THE RING IS CRUMBLING', 2200, '#ff6b4a'); sfx('land_bad'); }
        const p = Math.min((_clock - SHRINK_START) / SHRINK_DUR, 1);
        _radius = ARENA_RADIUS - (ARENA_RADIUS - MIN_ARENA_R) * p;
    }
    for (let i = 0; i < _n; i++) {
        const live = _phase === 'play' && !_falling[i];
        if (_input[i].lengthSq() > 0 && live) _mom[i] = Math.min(_mom[i] + MOMENTUM_GAIN * f, MAX_MOMENTUM);
        else _mom[i] = Math.max(_mom[i] - MOMENTUM_DECAY * f, 0);
        if (live) { _vel[i].x += _input[i].x * BASE_ACCEL * _mom[i] * f; _vel[i].z += _input[i].y * BASE_ACCEL * _mom[i] * f; }
        _vel[i].multiplyScalar(Math.pow(FRICTION, f));
        if (_falling[i]) _vel[i].y -= 0.04 * f;
        _balls[i].pos.addScaledVector(_vel[i], f);
    }
    // Every pair: four balls in a shrinking ring pile up three at a time.
    for (let i = 0; i < _n; i++) for (let j = i + 1; j < _n; j++) {
        if (_falling[i] || _falling[j]) continue;
        const delta = new THREE.Vector3().subVectors(_balls[i].pos, _balls[j].pos);
        const dist = delta.length();
        if (dist >= SPHERE_RADIUS * 2 || dist === 0) continue;
        const overlap = SPHERE_RADIUS * 2 - dist, normal = delta.normalize();
        _balls[i].pos.addScaledVector(normal, overlap / 2);
        _balls[j].pos.addScaledVector(normal, -overlap / 2);
        const hit = (_mom[i] + _mom[j]);
        const knock = BOUNCE_BASE + hit * BOUNCE_MULT;
        _vel[i].addScaledVector(normal, knock);
        _vel[j].addScaledVector(normal, -knock);
        _mom[i] = 0; _mom[j] = 0;
        sfx('boost'); haptic('heavy');
        if (hit > 2) { _shake = Math.max(_shake, 0.25); sfx('slam'); }
        if (_stage?.gl) _fx.burst(_balls[j].pos.clone().addScaledVector(normal, SPHERE_RADIUS), 0xffffff, 0.3, 0.18);
        [i, j].forEach(k => { const b = _balls[k]; b.anim?.play('hit', { restart: true }); b.pose = 'hit'; b.hitUntil = _t + 0.5; });
    }
    for (let i = 0; i < _n; i++) {
        if (_falling[i]) continue;
        if (Math.hypot(_balls[i].pos.x, _balls[i].pos.z) > _radius) {
            _falling[i] = true; _outAt[i] = _clock;
            sfx('land_bad'); haptic('heavy');
            _vel[i].set((Math.random() - 0.5) * 0.2, 0, (Math.random() - 0.5) * 0.2);
            _balls[i].anim?.play('fall', { restart: true });
            _checkWin();
        }
    }
    if (_phase === 'settle' && _phaseT >= 0.9) _end();
}

// Last one in the ring. If the last of them go over together, whoever
// survived longest wins; the same shove (within 120 ms) is a draw.
function _checkWin() {
    const standing = [];
    for (let i = 0; i < _n; i++) if (!_falling[i]) standing.push(i);
    if (standing.length > 1 || _phase !== 'play') return;
    if (standing.length === 1) _winner = standing[0];
    else {
        const latest = Math.max(..._outAt);
        const tied = _outAt.reduce((a, t, i) => (latest - t < 0.12 ? a.concat(i) : a), []);
        _winner = tied.length === 1 ? tied[0] : -1;
    }
    _phase = 'settle'; _phaseT = 0;
    if (_winner >= 0) sfx('mg_win');
}

function _draw(dt) {
    if (!_stage?.gl) return;
    const tmpQ = new THREE.Quaternion(), axis = new THREE.Vector3();
    _balls.forEach((b, i) => {
        if (!b.g) return;
        b.g.position.copy(b.pos);
        // Roll the band with the ball's travel.
        const v = _vel[i], sp = Math.hypot(v.x, v.z);
        if (sp > 1e-4 && !_falling[i]) {
            axis.set(v.z, 0, -v.x).normalize();
            tmpQ.setFromAxisAngle(axis, sp * dt * 60 / SPHERE_RADIUS);
            b.roll.quaternion.premultiply(tmpQ);
        }
        // The rider: upright, at the bottom of the ball, facing where it rolls.
        b.rig.root.position.set(b.pos.x, b.pos.y - SPHERE_RADIUS * 0.85, b.pos.z);
        if (sp > 0.02) b.face = Math.atan2(v.x, v.z);
        b.anim.face(b.face);
        const want = _falling[i] ? 'fall' : sp > 0.06 ? 'run' : 'ready';
        if (b.pose !== want && _t > (b.hitUntil || 0)) { b.pose = want; b.anim.play(want); }
        b.shadow.visible = !_falling[i];
        b.shadow.position.set(b.pos.x, 0.02, b.pos.z);
    });
    // Tiles beyond the live edge crumble and drop away.
    _tiles.forEach(t => {
        if (t.outer - 0.3 > _radius && !t.fall) { t.fall = 0.001; if (Math.random() < 0.15) _fx.puff(t.drift.clone().multiplyScalar(t.outer - 0.6), 0xb9a585, 2, 0.6, 0.6); }
        if (t.fall) {
            t.fall += dt;
            if (t.m.visible) {
                t.m.position.y -= t.fall * t.fall * 9 * dt + dt * 0.5;
                t.m.position.addScaledVector(t.drift, dt * 0.6);
                t.m.rotation.x += t.spin * dt * 0.3;
                if (t.m.position.y < -40) t.m.visible = false;
            }
        }
    });
    if (_rope) {
        const s = Math.max(0.2, (_radius - 0.5) / (ARENA_RADIUS - 0.5));
        _rope.scale.set(s, s, 1);
        const p = Math.min(1, Math.max(0, (_clock - SHRINK_START) / SHRINK_DUR));
        _rope.material.color.lerpColors(new THREE.Color(0xe8c15a), new THREE.Color(0xff4a2a), p);
    }
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _say('');
    // Standings are survival: still in the ring beats out of it, and among
    // those out, whoever lasted longest ranks higher (a finite sentinel, not
    // Infinity, so the comparator never sees NaN).
    const rank = _balls.map((_, i) => (_falling[i] ? _outAt[i] : Number.MAX_SAFE_INTEGER));
    const w = _winner;
    _overlay?.querySelectorAll('[data-slot]').forEach(z => { z.style.display = 'none'; });
    // Whoever went over climbs back onto the edge of what is left, for the bow.
    _balls.forEach((b, i) => {
        if (!_falling[i] || !b.rig) return;
        const a = Math.atan2(b.pos.z, b.pos.x), r = Math.max(MIN_ARENA_R, _radius) - 1;
        b.pos.set(Math.cos(a) * r, SPHERE_RADIUS, Math.sin(a) * r); _vel[i].set(0, 0, 0);
        b.rig.root.position.set(b.pos.x, 0, b.pos.z);
        if (b.g) b.g.visible = false;
    });
    _dir.close({
        winner: w, figs: _balls.map((b, slot) => ({ slot, rig: b.rig, anim: b.anim })).filter(f => f.rig),
        sub: w < 0 ? 'OVER TOGETHER' : 'LAST ONE IN THE RING',
        onDone: () => _finish(w, rank),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, n: _n, clock: +_clock.toFixed(2), radius: +_radius.toFixed(2), winner: _winner,
             balls: _balls.map((b, i) => ({ x: +b.pos.x.toFixed(2), z: +b.pos.z.toFixed(2), y: +b.pos.y.toFixed(2),
                                             vx: +_vel[i].x.toFixed(3), vz: +_vel[i].z.toFixed(3), mom: +_mom[i].toFixed(2), out: _falling[i] })),
             fallen: _tiles.filter(t => t.fall).length, tiles: _tiles.length, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a ball at (x, z) moving at (vx, vz) per 60 Hz frame, with momentum. */
export function _debugPlace(pid, x, z, vx = 0, vz = 0, mom = 0) {
    if (!_balls[pid]) return;
    _balls[pid].pos.set(x, SPHERE_RADIUS, z); _vel[pid].set(vx, 0, vz); _mom[pid] = mom;
}
/** Probes: jump the clock (to test the crumble). */
export function _debugClock(s) { _clock = s; }
