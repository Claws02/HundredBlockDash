// ============================================================
// TAG, YOU'RE IT! — the playground in the fountain park.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, seen from above. One of you is IT: a yellow ring underfoot and a
// touch quicker. Touch the other to pass it on; the new IT is frozen for a
// moment so the tagger can get away.
//
//   DRAG on your half to run.
//
// The playground is the game: the slide and the tunnel's walls block, the
// tunnel hides whoever is inside it from above, and the roundabout carries
// anyone standing on it round. Whoever is IT when the whistle blows loses.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const W = 11, D = 16;
const MATCH_TIME = 40;
const READY_TIME = 1.4;
const SPEED = 4.0, IT_BONUS = 1.1;
const BODY = 0.45;
const FREEZE = 1.3;                     // s the newly tagged stands still
const IMMUNE = 0.6;                     // s before the tag can come straight back
const FIG_SCALE = 1.1;
// The playground. Boxes block (x, z, half-width, half-depth); the roundabout
// carries. The tunnel is two walls with a roof: a way through, and cover.
const BLOCKS = [
    { x: -3.2, z: 3.4, hw: 0.7, hd: 1.9, kind: 'slide' },
    { x: 2.6, z: -3.9, hw: 1.9, hd: 0.18, kind: 'wall' },
    { x: 2.6, z: -2.3, hw: 1.9, hd: 0.18, kind: 'wall' },
];
const TUNNEL = { x: 2.6, z: -3.1, hw: 1.9, hd: 0.62 };
const ROUND = { x: 2.4, z: 3.6, r: 1.7, spin: 1.6 };

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _it = 0, _bot = [], _ring = null, _roundMesh = null, _tunnelRoof = null;
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _tags = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _tags = 0;
    _it = Math.random() < 0.5 ? 0 : 1;
    _bot = [0, 1].map(() => ({ think: 0, tx: 0, tz: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0xa9d4f2 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);
        _set = STAGE_SETS.ring(_stage, { w: W, d: D });
        _buildPlayground();
    }
    _figs = [0, 1].map(_buildFig);
    _figs.forEach(f => { f.immune = 0; f.frozen = 0; });
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO RUN'));

    _dir.open({
        place: 'CITY RING ROAD · THE PLAYGROUND', title: 'TAG, YOU’RE IT!',
        sub: 'DON’T BE IT AT THE WHISTLE',
        from: { pos: [7, 6, 12], look: [0, 0, 0] },
        to: overheadCam(_stage, W, D, 7),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _ring = null; _roundMesh = null; _tunnelRoof = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The playground ───────────────────────────────────────────────────────────
function _buildPlayground() {
    // Safety surfacing under the play area.
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.95 }));
    mat.rotation.x = -Math.PI / 2; mat.position.y = 0.01; mat.receiveShadow = true; _stage.add(mat);
    const blue = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.5 });
    const red = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 });
    const yellow = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.6 });
    // The slide: a platform with a ladder, and the chute down one side.
    const sl = BLOCKS[0];
    const plat = new THREE.Mesh(new THREE.BoxGeometry(sl.hw * 2, 1.6, 1.2), blue); plat.position.set(sl.x, 0.8, sl.z + sl.hd - 0.6); plat.castShadow = true; _stage.add(plat);
    const chute = new THREE.Mesh(new THREE.BoxGeometry(sl.hw * 1.6, 0.12, sl.hd * 2 - 1.0), yellow);
    chute.position.set(sl.x, 0.8, sl.z - 0.55); chute.rotation.x = -0.42; chute.castShadow = true; _stage.add(chute);
    [-1, 1].forEach(k => { const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, sl.hd * 2 - 1.0), steel); rail.position.set(sl.x + k * sl.hw * 0.8, 0.95, sl.z - 0.55); rail.rotation.x = -0.42; _stage.add(rail); });
    // The tunnel: two walls and a curved roof, which hides whoever is in it.
    BLOCKS.slice(1).forEach(b => { const w = new THREE.Mesh(new THREE.BoxGeometry(b.hw * 2, 1.1, b.hd * 2), red); w.position.set(b.x, 0.55, b.z); w.castShadow = true; _stage.add(w); });
    _tunnelRoof = new THREE.Mesh(new THREE.CylinderGeometry(TUNNEL.hd + 0.2, TUNNEL.hd + 0.2, TUNNEL.hw * 2, 20, 1, true, 0, Math.PI),
        new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 1 }));
    _tunnelRoof.rotation.set(0, 0, Math.PI / 2);     // the half-cylinder's axis along x, the arc on top
    _tunnelRoof.position.set(TUNNEL.x, 1.1, TUNNEL.z); _tunnelRoof.castShadow = true; _stage.add(_tunnelRoof);
    // The roundabout: a disc with rails, turning.
    _roundMesh = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(ROUND.r, ROUND.r, 0.18, 32), new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.5 }));
    disc.position.y = 0.12; disc.receiveShadow = true; _roundMesh.add(disc);
    for (let k = 0; k < 4; k++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(ROUND.r * 1.7, 0.08, 0.08), steel);
        bar.position.y = 0.8; bar.rotation.y = k * Math.PI / 4; _roundMesh.add(bar);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8), steel); hub.position.y = 0.5; _roundMesh.add(hub);
    _roundMesh.position.set(ROUND.x, 0, ROUND.z);
    _stage.add(_roundMesh);
    // IT's ring.
    // Yellow, not red: it has to read under every character, the red one included.
    _ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.15, 36), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.95, depthWrite: false }));
    _ring.rotation.x = -Math.PI / 2; _ring.position.y = 0.05; _stage.add(_ring);
}

function _buildFig(slot) {
    const f = { slot, x: slot === 0 ? -1.2 : 1.2, z: (slot === 0 ? 1 : -1) * (D / 2 - 1.6), face: slot === 0 ? Math.PI : 0, moving: false, hidden: false };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(f.x, 0, f.z);
        c.anim.face(f.face, true);
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

// ── Collisions ───────────────────────────────────────────────────────────────
function _collide(f) {
    f.x = Math.max(-W / 2 + BODY, Math.min(W / 2 - BODY, f.x));
    f.z = Math.max(-D / 2 + BODY, Math.min(D / 2 - BODY, f.z));
    BLOCKS.forEach(b => {
        const cx = Math.max(b.x - b.hw, Math.min(b.x + b.hw, f.x)), cz = Math.max(b.z - b.hd, Math.min(b.z + b.hd, f.z));
        const dx = f.x - cx, dz = f.z - cz, d = Math.hypot(dx, dz);
        if (d >= BODY) return;
        if (d < 1e-4) {
            // Inside the box: out by the shortest way.
            const px = b.hw + BODY - Math.abs(f.x - b.x), pz = b.hd + BODY - Math.abs(f.z - b.z);
            if (px < pz) f.x += Math.sign(f.x - b.x || 1) * px; else f.z += Math.sign(f.z - b.z || 1) * pz;
            return;
        }
        f.x = cx + dx / d * BODY; f.z = cz + dz / d * BODY;
    });
}
const _inTunnel = f => Math.abs(f.x - TUNNEL.x) < TUNNEL.hw && Math.abs(f.z - TUNNEL.z) < TUNNEL.hd;
const _onRound = f => Math.hypot(f.x - ROUND.x, f.z - ROUND.z) < ROUND.r;

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// IT chases where the other is heading (a better bot leads further); the
// runner looks round for the direction that keeps it furthest from IT
// without running into a wall.
function _botMove(slot, dt) {
    const me = _figs[slot], them = _figs[1 - slot], b = _bot[slot];
    b.think -= dt;
    if (b.think <= 0) {
        b.think = 0.35 - _botSkill * 0.2 + Math.random() * 0.15;
        if (_it === slot) {
            const lead = 0.2 + _botSkill * 0.5;
            b.tx = them.x + (them.vx || 0) * lead; b.tz = them.z + (them.vz || 0) * lead;
        } else {
            let best = -Infinity;
            for (let k = 0; k < 12; k++) {
                const a = (k / 12) * Math.PI * 2, tx = me.x + Math.sin(a) * 2.5, tz = me.z + Math.cos(a) * 2.5;
                const edge = Math.min(W / 2 - Math.abs(tx), D / 2 - Math.abs(tz));
                const score = Math.hypot(tx - them.x, tz - them.z) + Math.min(0, edge - 1.2) * 3 + (Math.random() - 0.5) * (1 - _botSkill) * 3;
                if (score > best) { best = score; b.tx = tx; b.tz = tz; }
            }
        }
    }
    const dx = b.tx - me.x, dz = b.tz - me.z, d = Math.hypot(dx, dz) || 1;
    const k = 0.72 + 0.28 * _botSkill;
    return d < 0.2 ? { dx: 0, dz: 0 } : { dx: dx / d * k, dz: dz / d * k };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _hud.say(`${seat(_it).name} IS IT!`, 'RUN!', READY_TIME * 1000, _t, seat(_it).css);
    else if (phase === 'play') sfx('go');
}

function _tag(from, to) {
    _it = to.slot; _tags++;
    to.frozen = FREEZE; from.immune = IMMUNE;
    sfx('slam'); haptic([50]);
    if (_stage?.gl) { _fx.burst(new THREE.Vector3(to.x, 1, to.z), 0xff2d2d, 0.6, 0.22); to.anim?.flinch?.(); }
    _hud.say('TAG!', `${seat(to.slot).name} IS IT`, 900, _t, seat(to.slot).css);
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');
    const spin = ROUND.spin * dt;

    if (_phase === 'play') {
        _clock += dt;
        _figs.forEach(f => {
            f.frozen = Math.max(0, f.frozen - dt); f.immune = Math.max(0, f.immune - dt);
            let mv = { dx: 0, dz: 0 };
            if (f.frozen <= 0) mv = isBotSlot(f.slot) ? _botMove(f.slot, dt) : (s => ({ dx: s.dx, dz: s.dy }))(_in.seat(f.slot));
            const m = Math.min(1, Math.hypot(mv.dx, mv.dz));
            const sp = SPEED * (_it === f.slot ? IT_BONUS : 1);
            f.moving = m > 0.12;
            f.vx = f.moving ? mv.dx / Math.hypot(mv.dx, mv.dz) * m * sp : 0;
            f.vz = f.moving ? mv.dz / Math.hypot(mv.dx, mv.dz) * m * sp : 0;
            f.x += f.vx * dt; f.z += f.vz * dt;
            // The roundabout carries whoever is on it round its hub.
            if (_onRound(f)) {
                const rx = f.x - ROUND.x, rz = f.z - ROUND.z;
                const c = Math.cos(spin), s = Math.sin(spin);
                f.x = ROUND.x + rx * c - rz * s; f.z = ROUND.z + rx * s + rz * c;
            }
            _collide(f);
            if (f.moving) {
                let d = Math.atan2(mv.dx, mv.dz) - f.face; d = Math.atan2(Math.sin(d), Math.cos(d));
                f.face += Math.max(-12 * dt, Math.min(12 * dt, d));
            }
            f.hidden = _inTunnel(f);
        });
        const [a, b] = _figs, d = Math.hypot(a.x - b.x, a.z - b.z);
        const itF = _figs[_it], runner = _figs[1 - _it];
        if (d < BODY * 2 + 0.1 && itF.frozen <= 0 && itF.immune <= 0) _tag(itF, runner);
        else if (d < BODY * 2 && d > 1e-4) {
            const push = (BODY * 2 - d) / 2;
            const nx = (a.x - b.x) / d, nz = (a.z - b.z) / d;
            a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push;
        }
        if (MATCH_TIME - _clock < 5.05 && MATCH_TIME - _clock > 4.95) _hud.say('5 SECONDS!', `${seat(_it).name} IS IT`, 900, _t, '#facc15');
        if (_clock >= MATCH_TIME) _end();
    }

    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, _onRound(f) ? 0.2 : 0, f.z);
        if (_phase === 'over') return;
        f.anim.face(f.face, true);
        f.anim.play(f.frozen > 0 ? 'hit' : f.moving ? 'run' : 'ready', { rate: 3.2 });
    });
    if (_roundMesh) _roundMesh.rotation.y -= spin;
    if (_ring && _figs[_it]) {
        const f = _figs[_it];
        _ring.position.set(f.x, 0.05, f.z);
        _ring.scale.setScalar(1 + Math.sin(_t * 8) * 0.08);
        _ring.material.color.setHex(f.frozen > 0 ? 0xfff3b0 : 0xffe14d);
    }
    // See into the tunnel while somebody is in it.
    if (_tunnelRoof) {
        const want = _figs.some(f => f.hidden) ? 0.35 : 1;
        const m = _tunnelRoof.material; m.opacity += (want - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.98;
    }
    _set?.update?.(dt, _t);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 7);
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, Math.ceil(MATCH_TIME - _clock));
    [0, 1].forEach(slot => {
        const me = _figs[slot];
        _hud.line(slot, `${_it === slot ? '🟡 YOU’RE IT' : '🏃 RUN'} · ${left}s${me?.frozen > 0 ? ' · FROZEN' : ''}`);
        if (_clock > 5) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${left}s · ${seat(_it).name} IS IT`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    sfx('whistle');
    const w = 1 - _it;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: `${seat(_it).name} WAS IT · ${_tags} TAG${_tags === 1 ? '' : 'S'}`,
        closeUp: (f, p) => ({ pos: [p.x + 2, p.y + 8.5 * FIG_SCALE, p.z + (f.slot === 0 ? 1 : -1) * 8 * FIG_SCALE], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), it: _it, tags: _tags,
             figs: _figs.map(f => ({ x: +f.x.toFixed(2), z: +f.z.toFixed(2), frozen: +f.frozen.toFixed(2), hidden: f.hidden })),
             round: { x: ROUND.x, z: ROUND.z }, tunnel: { x: TUNNEL.x, z: TUNNEL.z },
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
export function _debugPlace(slot, x, z) { const f = _figs[slot]; if (f) { f.x = x; f.z = z; } }
export function _debugIt(slot) { _it = slot; _figs.forEach(f => { f.frozen = 0; f.immune = 0; }); }
export function _debugClock(t) { _clock = t; }
