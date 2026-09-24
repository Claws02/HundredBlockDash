// Turf War — the paint works yard, and a roller each.
//
// A stage game, face-off, seen from above. Each player's figure pushes a
// paint roller across a yard of concrete tiles; every tile it rolls over
// becomes that player's colour — including the ones the other player just
// painted. Most of the yard in your colour at the whistle wins.
//
//   DRAG  on your half to run.
//
// Two things make it more than a race to cover ground:
//   · Your rival's wet paint is slippery: you run slower across their colour,
//     so cutting through their territory costs you.
//   · Paint bombs drop into the yard. Run over one and it splats a big patch
//     round you in your colour.
//
// Bumping shoves you both apart. The clock is fixed: MATCH_TIME.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const COLS = 10, ROWS = 18, TILE = 1;
const W = COLS * TILE, D = ROWS * TILE;
const MATCH_TIME = 35;
const READY_TIME = 1.2;
const SPEED = 4.8, SLICK = 0.55;   // on the rival's paint
const SCRUB = 0.25;                // s to roll over a tile of theirs
const BODY = 0.45;
const BOMB_EVERY = 5, BOMBS_MAX = 2, BOMB_R = 2.2;
const FIG_SCALE = 1.25;
const NEUTRAL = 0x5f646b;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _figs = [], _owner = null, _tiles = null, _bombs = [], _bot = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _nextBomb = 0;
let _dirOwns = false;
const _tmpColor = typeof THREE !== 'undefined' ? new THREE.Color() : null;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _nextBomb = 3; _bombs = [];
    _owner = new Int8Array(COLS * ROWS).fill(-1);
    _bot = [0, 1].map(() => ({ plan: 0, tx: 0, tz: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#8a5a20;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x8a5a20 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P2's end is up for every shot
        _set = STAGE_SETS.ind(_stage, { w: W, d: D });
        _buildTiles();
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO RUN · PAINT THE YARD'));

    _dir.open({
        place: 'INDUSTRIAL ZONE · THE PAINT WORKS', title: 'TURF WAR',
        sub: 'PAINT THE MOST GROUND',
        from: { pos: [6, 8, 16], look: [0, 0, 2] },
        to: overheadCam(_stage, W, D, 8),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _bombs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _tiles = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── The yard ─────────────────────────────────────────────────────────────────
const _tileAt = (x, z) => {
    const c = Math.floor((x + W / 2) / TILE), r = Math.floor((z + D / 2) / TILE);
    return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : r * COLS + c;
};
const _tileXZ = i => ({ x: -W / 2 + (i % COLS + 0.5) * TILE, z: -D / 2 + (Math.floor(i / COLS) + 0.5) * TILE });

function _buildTiles() {
    _tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(TILE * 0.94, 0.06, TILE * 0.94),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), COLS * ROWS);
    const m = new THREE.Matrix4();
    for (let i = 0; i < COLS * ROWS; i++) {
        const p = _tileXZ(i);
        m.makeTranslation(p.x, 0.03, p.z);
        _tiles.setMatrixAt(i, m);
        _tiles.setColorAt(i, _tmpColor.setHex(NEUTRAL));
    }
    _tiles.receiveShadow = true;
    _stage.add(_tiles);
}

function _paint(i, slot) {
    if (i < 0 || _owner[i] === slot) return false;
    _owner[i] = slot;
    if (_tiles) {
        _tiles.setColorAt(i, _tmpColor.setHex(seat(slot).color));
        _tiles.instanceColor.needsUpdate = true;
    }
    return true;
}

function _count() {
    const n = [0, 0];
    for (let i = 0; i < _owner.length; i++) if (_owner[i] >= 0) n[_owner[i]]++;
    return n;
}

// ── Figures ──────────────────────────────────────────────────────────────────
function _buildFig(slot) {
    const f = { slot, x: 0, z: (slot === 0 ? 1 : -1) * (D / 2 - 1.5), face: slot === 0 ? Math.PI : 0, vx: 0, vz: 0 };
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        // A paint roller in the player's colour, held out in front.
        const roller = new THREE.Group();
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 12),
            new THREE.MeshStandardMaterial({ color: seat(slot).color, roughness: 0.8 }));
        drum.rotation.z = Math.PI / 2; drum.position.set(-0.25, -0.35, 0.35); roller.add(drum);
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), new THREE.MeshStandardMaterial({ color: 0x3a3a3a }));
        handle.rotation.x = 0.9; handle.position.set(0, -0.12, 0.15); roller.add(handle);
        c.rig.hold(1, roller);
        Object.assign(f, { rig: c.rig, anim: c.anim });
        c.rig.root.position.set(f.x, 0, f.z);
        c.anim.face(f.face, true);
    }
    return f;
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// Heads for the richest nearby patch of tiles that are not yet its colour —
// the rival's count double, a bomb counts most — and re-plans on a delay.
function _botMove(slot, dt) {
    const f = _figs[slot], b = _bot[slot];
    b.plan -= dt;
    if (b.plan <= 0) {
        b.plan = 0.75 - _botSkill * 0.45 + Math.random() * 0.2;
        let best = -Infinity;
        for (let k = 0; k < 40; k++) {
            const i = Math.floor(Math.random() * _owner.length);
            const p = _tileXZ(i);
            const d = Math.hypot(p.x - f.x, p.z - f.z);
            let v = 0;
            for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
                const j = _tileAt(p.x + dx, p.z + dz);
                if (j >= 0 && _owner[j] !== slot) v += _owner[j] === 1 - slot ? 2 : 1;
            }
            const score = v - d * (0.5 + _botSkill * 0.4);
            if (score > best) { best = score; b.tx = p.x; b.tz = p.z; }
        }
        _bombs.forEach(bm => {
            const d = Math.hypot(bm.x - f.x, bm.z - f.z);
            if (d < 6 + _botSkill * 6 && 14 - d > best) { best = 14 - d; b.tx = bm.x; b.tz = bm.z; }
        });
    }
    const dx = b.tx - f.x, dz = b.tz - f.z, d = Math.hypot(dx, dz) || 1;
    const sp = 0.75 + 0.25 * _botSkill;
    return d < 0.3 ? { dx: 0, dz: 0 } : { dx: dx / d * sp, dz: dz / d * sp };
}

// ── Bombs ────────────────────────────────────────────────────────────────────
function _spawnBomb() {
    const x = (Math.random() - 0.5) * (W - 2), z = (Math.random() - 0.5) * (D - 4);
    const bm = { x, z, mesh: null };
    if (_stage.gl) {
        const g = new THREE.Group();
        const can = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.6, 14),
            new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4, metalness: 0.3 }));
        can.position.y = 0.45; g.add(can);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.22, 14),
            new THREE.MeshStandardMaterial({ color: 0xff3fa4, emissive: 0x8a1a5a, emissiveIntensity: 0.6 }));
        band.position.y = 0.45; g.add(band);
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 24),
            new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; g.add(ring);
        g.position.set(x, 0, z);
        g.traverse(o => { if (o.isMesh && o !== ring) o.castShadow = true; });
        _stage.add(g);
        bm.mesh = g; bm.ring = ring;
    }
    _bombs.push(bm);
}

function _splat(f) {
    let n = 0;
    for (let dz = -BOMB_R; dz <= BOMB_R; dz++) for (let dx = -BOMB_R; dx <= BOMB_R; dx++) {
        if (Math.hypot(dx, dz) > BOMB_R + 0.3) continue;
        if (_paint(_tileAt(f.x + dx, f.z + dz), f.slot)) n++;
    }
    sfx('boom'); haptic([60]);
    if (_stage?.gl) {
        const at = new THREE.Vector3(f.x, 0.5, f.z);
        _fx.burst(at, seat(f.slot).color, 0.6, 0.3);
        _fx.confetti(at, [seat(f.slot).color, 0xffffff], 22, 5);
    }
    return n;
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _hud.say('GO!', 'PAINT THE YARD', READY_TIME * 1000, _t);
    else if (phase === 'play') sfx('go');
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');

    if (_phase === 'play') {
        _clock += dt;
        if (_clock >= _nextBomb && _bombs.length < BOMBS_MAX) { _spawnBomb(); _nextBomb = _clock + BOMB_EVERY; }
        if (MATCH_TIME - _clock < 5.05 && MATCH_TIME - _clock > 4.95) _hud.say('5 SECONDS!', '', 900, _t, '#facc15');
        _figs.forEach(f => {
            let mv;
            if (isBotSlot(f.slot)) mv = _botMove(f.slot, dt);
            else { const s = _in.seat(f.slot); mv = { dx: s.dx, dz: s.dy }; }
            const m = Math.hypot(mv.dx, mv.dz);
            // Their paint is wet: a tile of theirs takes SCRUB seconds to
            // roll over, and you are slow while you do it. Painting it the
            // instant you touched it meant you were never on their colour for
            // a whole frame, and the slowdown never happened.
            const here = _tileAt(f.x, f.z);
            const theirs = _owner[here] === 1 - f.slot;
            if (here !== f.tile) { f.tile = here; f.scrub = 0; }
            const sp = SPEED * (theirs ? SLICK : 1);
            f.vx = m > 0.12 ? mv.dx * sp : 0; f.vz = m > 0.12 ? mv.dz * sp : 0;
            f.x = Math.max(-W / 2 + BODY, Math.min(W / 2 - BODY, f.x + f.vx * dt));
            f.z = Math.max(-D / 2 + BODY, Math.min(D / 2 - BODY, f.z + f.vz * dt));
            if (m > 0.12) {
                const want = Math.atan2(mv.dx, mv.dz);
                let d = want - f.face; d = Math.atan2(Math.sin(d), Math.cos(d));
                f.face += Math.max(-12 * dt, Math.min(12 * dt, d));
            }
            f.moving = m > 0.12;
            if (theirs) { f.scrub = (f.scrub || 0) + dt; if (f.scrub >= SCRUB) _paint(here, f.slot); }
            else _paint(here, f.slot);      // the tile we were on this frame, not the one just stepped onto
            // A roller is a metre wide: the tile beside you, across your path, too.
            const px = Math.cos(f.face) * 0.5, pz = -Math.sin(f.face) * 0.5;
            if (f.moving) {
                [_tileAt(f.x + px, f.z + pz), _tileAt(f.x - px, f.z - pz)].forEach(i => {
                    if (_owner[i] !== 1 - f.slot || f.scrub >= SCRUB) _paint(i, f.slot);
                });
            }
        });
        const [a, b] = _figs;
        const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
        if (d < BODY * 2 && d > 1e-4) {
            const push = (BODY * 2 - d) / 2 + 0.05;
            a.x += dx / d * push; a.z += dz / d * push; b.x -= dx / d * push; b.z -= dz / d * push;
        }
        for (let i = _bombs.length - 1; i >= 0; i--) {
            const bm = _bombs[i];
            const f = _figs.find(q => Math.hypot(q.x - bm.x, q.z - bm.z) < 0.75);
            if (!f) continue;
            if (bm.mesh) { _stage.scene.remove(bm.mesh); bm.mesh.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); }); }
            _bombs.splice(i, 1);
            _splat(f);
        }
        if (_clock >= MATCH_TIME) _end();
    }

    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, 0, f.z);
        f.anim.face(f.face, true);
        f.anim.play(f.moving ? 'walk' : 'ready', { rate: 3.4 });
    });
    _bombs.forEach(bm => { if (bm.mesh) { bm.mesh.rotation.y += dt * 2; bm.ring.scale.setScalar(1 + Math.sin(_t * 5) * 0.12); } });
    _fx?.update(dt);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = overheadCam(_stage, W, D, 8);
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
        _stage.camera.userData.look = [0, 0, 0];
    }
    _renderHud();
}

function _renderHud() {
    if (!_hud) return;
    const n = _count(), tot = COLS * ROWS;
    const left = Math.max(0, Math.ceil(MATCH_TIME - _clock));
    [0, 1].forEach(slot => {
        _hud.line(slot, `🎨 YOU ${Math.round(n[slot] / tot * 100)}% · ${left}s · THEM ${Math.round(n[1 - slot] / tot * 100)}%`);
        if (_clock > 6) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${left}s · ${seat(0).name} ${Math.round(n[0] / tot * 100)}% – ${Math.round(n[1] / tot * 100)}% ${seat(1).name}`;
}

function _end() {
    _phase = 'over';
    _hud.say('');
    const n = _count();
    const w = n[0] > n[1] ? 0 : n[1] > n[0] ? 1 : -1;
    const tot = COLS * ROWS;
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? 'HALF THE YARD EACH' : `${Math.round(n[w] / tot * 100)}% OF THE YARD`,
        closeUp: (f, p) => {
            const end = f.slot === 0 ? 1 : -1;
            return { pos: [p.x + 1.4, p.y + 6.5, p.z + end * 6], look: [p.x, p.y + 0.8, p.z] };
        },
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// For probes.
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), count: _owner ? _count() : [0, 0], bombs: _bombs.length,
             pos: _figs.map(f => [+f.x.toFixed(2), +f.z.toFixed(2)]), gl: !!_stage?.gl, turned: !!_stage?.turned,
             under: _figs.map(f => _owner ? _owner[_tileAt(f.x, f.z)] : -1) };
}
/** Probes: drop a bomb at a spot. */
export function _debugBomb(x, z) { _spawnBomb(); const b = _bombs[_bombs.length - 1]; b.x = x; b.z = z; b.mesh?.position.set(x, 0, z); }
/** Probes: paint a rectangle of tiles for a seat, and put a figure somewhere. */
export function _debugPaint(slot, x0, z0, x1, z1) {
    for (let z = z0; z <= z1; z += 0.5) for (let x = x0; x <= x1; x += 0.5) _paint(_tileAt(x, z), slot);
}
export function _debugPlace(slot, x, z) { const f = _figs[slot]; if (f) { f.x = x; f.z = z; } }
