// Rift Dive — a race straight down through the Void.
//
// A stage game, face-off, and the first one SPLIT-SCREEN: each half of the
// phone is its own camera, following its own diver down the same shaft. The
// shaft is shared — the rings, the shards and the other diver are all really
// there — so you can see your rival below you, and dive into them.
//
//   DRAG  on your half to steer (it is your view: drag the way you want to go).
//
// Fly through a RING for a burst of speed. Clip a SHARD and you tumble and
// slow right down. Bump the other diver and you both bounce apart. First to
// the core at the bottom wins.
//
// THE HOLD
//   FACE-OFF: phone flat between the two of you, P1 the bottom half, P2 the
//   top half turned to face them. Each half's camera is turned with it, so
//   "up" on your half is always "away from you".
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const DEPTH      = 420;
const RADIUS     = 7, ROAM = 5.9;            // shaft wall; how far out a diver can go
const FALL       = 17, BOOST = 9, BOOST_DECAY = 1.1, MAX_FALL = 32;
const STEER      = 8.5, ACCEL = 22;
const RING_EVERY = 11, RING_R = 1.45;
const SHARD_R    = 0.95, BODY_R = 0.45;
const STUN_T     = 0.75, STUN_K = 0.35;
const BUMP_V     = 6.5;
const READY_TIME = 1.4;
const FIG_SCALE  = 0.9;
const CAP_T      = 45;                       // nobody at the bottom by now: deeper wins

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _divers = [], _bot = [], _rings = [], _shards = [], _cams = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _dirOwns = false, _winner = -1;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1;
    _bot = [0, 1].map(() => ({ plan: 0, tx: 0, tz: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0a0a1a;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 50, background: 0x0a0a1a, shadows: false });
    _hud = faceoffHud(_stage, { bg: 'rgba(14,10,36,.72)' });
    _in = touch(_stage, { split: 'y', stick: 55 });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _set = STAGE_SETS.void(_stage, { depth: DEPTH, radius: RADIUS });
        // One camera per half. P1's "up" is -z, P2's is +z: each looks at the
        // shaft from their own side of the phone.
        _cams = [0, 1].map(slot => {
            const c = new THREE.PerspectiveCamera(62, 1, 0.1, 160);
            c.up.set(0, 0, slot === 0 ? -1 : 1);
            return c;
        });
    }
    _layCourse();
    _divers = [0, 1].map(_buildDiver);
    [0, 1].forEach(slot => { _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO STEER · RINGS = SPEED'); });

    _dir.open({
        place: 'THE VOID · THE EDGE OF EVERYTHING', title: 'RIFT DIVE',
        sub: 'FIRST TO THE CORE',
        from: { pos: [10, 9, 12], look: [0, -2, 0] },
        to: { pos: [0, 11, 7], look: [0, -14, 0] },
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.views = null; _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _divers = []; _rings = []; _shards = []; _cams = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The course ───────────────────────────────────────────────────────────────
// A ring every RING_EVERY units, wandering but never more than a steer away
// from the last; a shard or two between each pair, some of them right on the
// line from one ring to the next.
function _layCourse() {
    _rings = []; _shards = [];
    let px = 0, pz = 0, id = 0;
    for (let y = -16; y > -DEPTH + 8; y -= RING_EVERY) {
        const a = Math.random() * Math.PI * 2, step = 1.5 + Math.random() * 2.5;
        let x = px + Math.cos(a) * step, z = pz + Math.sin(a) * step;
        const r = Math.hypot(x, z); if (r > 4.2) { x *= 4.2 / r; z *= 4.2 / r; }
        const ring = { id: id++, x, y, z, taken: [false, false] };
        if (_stage.gl) {
            const m = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.13, 8, 30),
                new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 1.1, roughness: 0.3 }));
            m.rotation.x = Math.PI / 2; m.position.set(x, y, z);
            _stage.add(m); ring.mesh = m;
        }
        _rings.push(ring);
        // Shards between this ring and the next.
        const n = 1 + (Math.random() < 0.5 ? 1 : 0) + (y < -DEPTH / 2 && Math.random() < 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) {
            const sy = y - RING_EVERY * (0.3 + Math.random() * 0.45);
            let sx, sz;
            if (k === 0 && Math.random() < 0.6) {       // on the line, a little off it
                sx = x + (Math.random() - 0.5) * 1.6; sz = z + (Math.random() - 0.5) * 1.6;
            } else {
                const b = Math.random() * Math.PI * 2, rr = Math.random() * 5;
                sx = Math.cos(b) * rr; sz = Math.sin(b) * rr;
            }
            const sh = { x: sx, y: sy, z: sz, hit: [false, false] };
            if (_stage.gl) {
                const m = new THREE.Mesh(new THREE.OctahedronGeometry(SHARD_R, 0),
                    new THREE.MeshStandardMaterial({ color: 0xe0346b, emissive: 0x8a1040, emissiveIntensity: 0.9, roughness: 0.25, metalness: 0.4 }));
                m.position.set(sx, sy, sz); m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
                _stage.add(m); sh.mesh = m;
            }
            _shards.push(sh);
        }
        px = x; pz = z;
    }
}

// ── Divers ───────────────────────────────────────────────────────────────────
function _buildDiver(slot) {
    const d = { slot, x: 0, z: slot === 0 ? 1.2 : -1.2, y: 0, vx: 0, vz: 0, vy: 0,
                boost: 0, stun: 0, rings: 0, done: false, doneT: 0 };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        const holder = new THREE.Group();
        holder.rotation.order = 'YXZ';
        holder.add(c.rig.root);                   // re-parented: the holder does the lying down
        _stage.add(holder);
        c.anim.face(slot === 0 ? Math.PI : 0, true);
        c.anim.play('idle');
        Object.assign(d, { rig: c.rig, anim: c.anim, holder });
    }
    return d;
}

// Standing (the start, the verdict) or flat out, belly down, head away from
// its own player.
function _pose(d, diving) {
    if (!d.holder) return;
    if (diving) { d.holder.rotation.set(Math.PI / 2, d.slot === 0 ? Math.PI : 0, 0); d.rig.root.rotation.set(0, 0, 0); d.anim.face(0, true); }
    else { d.holder.rotation.set(0, 0, 0); }
}

// ── Phases ───────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') {
        if (_stage?.gl) _stage.views = [0, 1].map(slot => ({ camera: _cams[slot], rect: slot === 0 ? [0, 0, 1, 0.5] : [0, 0.5, 1, 0.5] }));
        _hud.say('READY…', 'THE CORE IS 420 METRES DOWN', READY_TIME * 1000, _t, '#9ad8ff');
    } else if (phase === 'dive') {
        _hud.say('DIVE!', '', 700, _t, '#ffd12d');
        sfx('go'); haptic([40]);
        if (_set?.disc) { _set.disc.visible = false; _fx.burst(new THREE.Vector3(0, 0, 0), 0x9ad8ff, 1.2, 0.35); }
        _divers.forEach(d => { d.vy = -FALL * 0.4; _pose(d, true); d.anim?.play('jump', { restart: true }); });
    }
}

function _end() {
    _phase = 'over';
    _hud.say('');
    const w = _winner;
    // Everyone on the core floor for the verdict, standing, the full-frame camera back.
    if (_stage) _stage.views = null;
    const coreY = _set?.coreY ?? -DEPTH;
    _divers.forEach(d => {
        Object.assign(d, { x: d.slot === 0 ? 1.4 : -1.4, z: 0.6, y: coreY });
        _pose(d, false);
        if (d.rig) { d.holder.position.set(d.x, d.y, d.z); d.anim.face(0, true); }
    });
    if (_stage?.gl) {
        _stage.camera.position.set(0, coreY + 3.5, 8);
        _stage.camera.lookAt(0, coreY + 1, 0);
        _stage.camera.userData.look = [0, coreY + 1, 0];
    }
    _dir.close({
        winner: w, figs: _divers.filter(d => d.rig).map(d => ({ slot: d.slot, rig: d.rig, anim: d.anim })),
        sub: w < 0 ? 'SIDE BY SIDE INTO THE CORE' : 'FIRST TO THE CORE',
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Every so often: find the next ring below, work out whether it can be
// reached in the time left to fall to it, and aim there — a little off, by
// more the weaker it is. A shard close below and near the line pushes it
// sideways first.
function _botSteer(d, dt) {
    const b = _bot[d.slot];
    b.plan -= dt;
    if (b.plan <= 0) {
        b.plan = 0.32 - _botSkill * 0.2 + Math.random() * 0.1;
        const fall = Math.max(8, -d.vy);
        const ring = _rings.find(r => r.y < d.y - 1.2 && !r.taken[d.slot] && Math.hypot(r.x - d.x, r.z - d.z) / ((d.y - r.y) / fall) < STEER * 1.05);
        const err = (1 - _botSkill) * 1.6;
        if (ring) { b.tx = ring.x + (Math.random() - 0.5) * err; b.tz = ring.z + (Math.random() - 0.5) * err; }
        // A shard near the PATH to there (where it will be at the shard's
        // depth), not just near the target.
        const look = 6 + _botSkill * 9;
        const sh = _shards.find(q => {
            if (q.hit[d.slot] || q.y > d.y || q.y < d.y - look) return false;
            const k = Math.min(1, ((d.y - q.y) / fall) * STEER / Math.max(0.5, Math.hypot(b.tx - d.x, b.tz - d.z)));
            return Math.hypot(q.x - (d.x + (b.tx - d.x) * k), q.z - (d.z + (b.tz - d.z) * k)) < 1.9;
        });
        if (sh && Math.random() < 0.3 + _botSkill * 0.65) {
            let ax = d.x - sh.x, az = d.z - sh.z, l = Math.hypot(ax, az);
            if (l < 0.2) { ax = -sh.z || 1; az = sh.x; l = Math.hypot(ax, az); }      // dead on: go round it
            b.tx = sh.x + ax / l * 2.4; b.tz = sh.z + az / l * 2.4;
        }
    }
    const dx = b.tx - d.x, dz = b.tz - d.z, l = Math.hypot(dx, dz);
    const k = Math.min(1, l / 1.2);
    return l > 0.05 ? [dx / l * k, dz / l * k] : [0, 0];
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('dive');

    if (_phase === 'dive') {
        _clock += dt;
        _divers.forEach(d => {
            if (d.done) return;
            // Steering: the drag on your own half, turned into the world.
            let sx = 0, sz = 0;
            if (isBotSlot(d.slot)) [sx, sz] = _botSteer(d, dt);
            else {
                const s = _in.seat(d.slot);
                if (s.down && s.moved) { const f = d.slot === 0 ? 1 : -1; sx = s.dx * f; sz = s.dy * f; }
            }
            const stunned = d.stun > 0;
            const tvx = stunned ? 0 : sx * STEER, tvz = stunned ? 0 : sz * STEER;
            const a = ACCEL * dt;
            d.vx += Math.max(-a, Math.min(a, tvx - d.vx));
            d.vz += Math.max(-a, Math.min(a, tvz - d.vz));
            d.x += d.vx * dt; d.z += d.vz * dt;
            const r = Math.hypot(d.x, d.z);
            if (r > ROAM) { d.x *= ROAM / r; d.z *= ROAM / r; const vn = (d.vx * d.x + d.vz * d.z) / ROAM; if (vn > 0) { d.vx -= vn * d.x / ROAM; d.vz -= vn * d.z / ROAM; } }
            // Falling.
            d.boost = Math.max(0, d.boost - BOOST_DECAY * BOOST * dt * 0.5);
            d.stun = Math.max(0, d.stun - dt);
            const target = -(FALL + d.boost) * (stunned ? STUN_K : 1);
            d.vy += (target - d.vy) * Math.min(1, dt * 3);
            d.vy = Math.max(-MAX_FALL, d.vy);
            const y0 = d.y;
            d.y += d.vy * dt;
            // Rings and shards crossed this frame.
            _rings.forEach(rg => {
                if (rg.taken[d.slot] || !(y0 > rg.y && d.y <= rg.y)) return;
                if (Math.hypot(d.x - rg.x, d.z - rg.z) > RING_R) return;
                rg.taken[d.slot] = true; d.rings++;
                d.boost = Math.min(BOOST * 1.6, d.boost + BOOST);
                sfx('boost'); haptic([15]);
                if (rg.mesh) { rg.mesh.material.color.setHex(seat(d.slot).color); rg.mesh.material.emissive.setHex(seat(d.slot).color); rg.flash = 0.4; }
            });
            _shards.forEach(sh => {
                // Swept: a slow frame at full speed covers more than a shard is tall.
                const k = SHARD_R + 0.4;
                if (sh.hit[d.slot] || Math.max(y0, d.y) < sh.y - k || Math.min(y0, d.y) > sh.y + k) return;
                if (Math.hypot(d.x - sh.x, d.z - sh.z) > SHARD_R + BODY_R) return;
                sh.hit[d.slot] = true;
                d.stun = STUN_T; d.boost = 0;
                const ax = d.x - sh.x, az = d.z - sh.z, l = Math.hypot(ax, az) || 1;
                d.vx = ax / l * 5; d.vz = az / l * 5;
                d.anim?.play('hit', { restart: true });
                sfx('slam'); haptic([60]);
                if (_stage?.gl) _fx.burst(new THREE.Vector3(sh.x, sh.y, sh.z), 0xe0346b, 0.6, 0.25);
            });
            if (d.y <= -DEPTH) { d.done = true; d.doneT = _clock; }
        });
        // Divers bump.
        const [a, b] = _divers;
        const dx = a.x - b.x, dz = a.z - b.z, dist = Math.hypot(dx, dz);
        if (!a.done && !b.done && Math.abs(a.y - b.y) < 1.3 && dist < BODY_R * 2.3 && !(a.bumpT > 0)) {
            const nx = dist > 0.01 ? dx / dist : 1, nz = dist > 0.01 ? dz / dist : 0;
            a.vx = nx * BUMP_V; a.vz = nz * BUMP_V; b.vx = -nx * BUMP_V; b.vz = -nz * BUMP_V;
            a.bumpT = b.bumpT = 0.35;
            sfx('slam'); haptic([30]);
            if (_stage?.gl) _fx.burst(new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), 0xffffff, 0.4, 0.2);
        }
        _divers.forEach(d => { d.bumpT = Math.max(0, (d.bumpT || 0) - dt); });
        const done = _divers.filter(d => d.done);
        if (done.length) {
            _winner = done.length === 2 && Math.abs(a.doneT - b.doneT) < 1e-3 ? -1 : done.sort((p, q) => p.doneT - q.doneT)[0].slot;
            sfx('coin_gain');
            _end();
        } else if (_clock > CAP_T) {
            _winner = Math.abs(a.y - b.y) < 0.5 ? -1 : (a.y < b.y ? 0 : 1);
            _end();
        }
    }

    // Figures and cameras.
    _divers.forEach(d => {
        if (!d.holder || _phase === 'over') return;
        d.holder.position.set(d.x, d.y, d.z);
        if (_phase === 'dive') {
            // Bank into the steer.
            const side = d.slot === 0 ? 1 : -1;
            d.holder.rotation.z = -d.vx * 0.05 * side;
            const want = d.stun > 0 ? d.anim.state : d.boost > BOOST * 0.5 ? 'raise' : 'jump';
            if (d.anim.state !== want && d.stun <= 0) d.anim.play(want, { restart: true });
        }
        const cam = _cams[d.slot];
        if (cam) {
            const s = d.slot === 0 ? 1 : -1;
            cam.position.set(d.x * 0.55, d.y + 7.2, d.z * 0.55 + s * 2.4);
            cam.lookAt(d.x * 0.8, d.y - 10, d.z * 0.8 - s * 1.2);
        }
    });
    _rings.forEach(rg => {
        if (!rg.mesh) return;
        rg.mesh.rotation.z += dt * 0.8;
        if (rg.flash > 0) { rg.flash -= dt; rg.mesh.scale.setScalar(1 + rg.flash); }
    });
    _set?.update(dt, _t);
    _fx?.update(dt);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    _renderHud();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function _renderHud() {
    if (!_hud || !_divers.length) return;
    const pct = d => Math.round(Math.min(1, Math.max(0, -d.y / DEPTH)) * 100);
    [0, 1].forEach(slot => {
        const d = _divers[slot], o = _divers[1 - slot];
        const gap = Math.round(o.y - d.y);
        const rel = _phase !== 'dive' ? '' : gap > 1 ? ` · ${gap}m AHEAD` : gap < -1 ? ` · ${-gap}m BEHIND` : ' · NECK AND NECK';
        _hud.line(slot, `▼ ${pct(d)}% · 💠 ${d.rings}${rel}`);
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'dive') el.textContent = `${seat(0).name} ${pct(_divers[0])}% · ${pct(_divers[1])}% ${seat(1).name}`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, clock: +_clock.toFixed(2),
        pos: _divers.map(d => [+d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)]),
        vel: _divers.map(d => [+d.vx.toFixed(2), +d.vy.toFixed(2), +d.vz.toFixed(2)]),
        rings: _divers.map(d => d.rings), stun: _divers.map(d => d.stun > 0), boost: _divers.map(d => +d.boost.toFixed(2)),
        done: _divers.map(d => d.done), views: _stage?.views ? _stage.views.length : 0,
        gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: put a diver somewhere in the shaft, still. */
export function _debugPlace(slot, x, y, z) {
    const d = _divers[slot];
    if (!d) return;
    Object.assign(d, { x, y, z, vx: 0, vz: 0, stun: 0 });
}
/** Probes: the course. */
export function _debugCourse() {
    return { rings: _rings.map(r => [r.x, r.y, r.z]), shards: _shards.map(s => [s.x, s.y, s.z]) };
}
