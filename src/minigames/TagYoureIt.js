// ============================================================
// TAG, YOU'RE IT! — four places to play it, picked at random.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, seen from above. One of you is IT: a yellow ring underfoot and
// a touch quicker. Touch the other to pass it on; the new IT is frozen for a
// moment so the tagger can get away.
//
//   DRAG on your half to run.
//
// THE SCORE is time: the clock runs on whoever is IT, and after 45 s the one
// who was IT for LESS time wins — so getting rid of it fast matters as much as
// not getting it back.
//
// THE MAPS (one per play): the Playground, a Construction Site, a Backyard and a
// Snowy Park. Each is built from the same kit:
//   walls — block;  decks — raised platforms you can stand on;
//   ladders/ramps — the way up to a deck (and back down);
//   slides — one way down from a deck, fast: you can't stop, and you shoot off
//            the bottom with a burst of speed;
//   slow ground (sand, a paddling pool), ice (you slide about), hiding places
//   (a tunnel, a pipe) and the roundabout, which carries you round.
// You can only tag somebody at about your own height: up on a deck is safe
// from IT on the ground, until IT climbs up after you.
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
const MATCH_TIME = 45;
const READY_TIME = 1.4;
const SPEED = 4.0, IT_BONUS = 1.1;
const CLIMB = 0.6;                      // speed on a ladder or ramp
const SLIDE_V = 7.5, SLIDE_OUT = 0.45;  // down a slide, and the burst off the bottom
const BODY = 0.45;
const REACH_Y = 0.9;                    // how far apart in height a tag can still reach
const FREEZE = 1.3;                     // s the newly tagged stands still
const IMMUNE = 0.6;                     // s before the tag can come straight back
const FIG_SCALE = 1.1;

// ── The maps ─────────────────────────────────────────────────────────────────
// Rectangles are centre (x, z) and half-sizes (hw, hd). A connector (ladder,
// ramp, slide) runs along `axis`, with its HIGH end on the `hi` side (+1/−1)
// and that end touching its deck.
const MAPS = {
    playground: {
        name: 'THE PLAYGROUND', place: 'CITY RING ROAD · THE PLAYGROUND', ground: 0xb4532a,
        walls: [{ x: 2.6, z: -3.9, hw: 1.9, hd: 0.18, h: 1.1, look: 'tunnel' }, { x: 2.6, z: -2.3, hw: 1.9, hd: 0.18, h: 1.1, look: 'tunnel' }],
        decks: [{ id: 'tower', x: -3.2, z: 4.6, hw: 0.75, hd: 0.6, h: 1.6, look: 'tower' }],
        conns: [{ kind: 'ladder', deck: 'tower', x: -3.2, z: 5.75, hw: 0.42, hd: 0.55, axis: 'z', hi: -1 },
                { kind: 'slide', deck: 'tower', x: -3.2, z: 2.7, hw: 0.42, hd: 1.3, axis: 'z', hi: 1 }],
        hides: [{ x: 2.6, z: -3.1, hw: 1.9, hd: 0.62, look: 'tunnel' }],
        carry: { x: 2.4, z: 3.6, r: 1.7, spin: 1.6 },
    },
    construction: {
        name: 'THE BUILDING SITE', place: 'THE WORKS · THE BUILDING SITE', ground: 0x9b7b55,
        walls: [{ x: 0.2, z: -4.3, hw: 2.3, hd: 0.15, h: 1.3, look: 'pipe' }, { x: 0.2, z: -2.7, hw: 2.3, hd: 0.15, h: 1.3, look: 'pipe' },
                { x: 3.7, z: 5.6, hw: 0.7, hd: 0.7, h: 1.4, look: 'crane' }, { x: -4.2, z: -1.6, hw: 0.5, hd: 0.9, h: 1.0, look: 'bricks' }],
        decks: [{ id: 'scaffold', x: -3.1, z: 2.8, hw: 1.0, hd: 0.8, h: 1.8, look: 'scaffold' }],
        conns: [{ kind: 'ramp', deck: 'scaffold', x: -3.1, z: 4.85, hw: 0.55, hd: 1.25, axis: 'z', hi: -1 },
                { kind: 'slide', deck: 'scaffold', x: -3.1, z: 0.7, hw: 0.42, hd: 1.3, axis: 'z', hi: 1 }],
        hides: [{ x: 0.2, z: -3.5, hw: 2.3, hd: 0.65, look: 'pipe' }],
        slows: [{ x: -2.8, z: -6.0, r: 1.5, k: 0.55, look: 'sand' }, { x: 3.2, z: 1.0, r: 1.4, k: 0.55, look: 'sand' }],
    },
    backyard: {
        name: 'THE BACKYARD', place: 'PERDITION · A BACKYARD', ground: 0x6fb24a,
        walls: [{ x: 0.9, z: -0.9, hw: 1.8, hd: 0.35, h: 1.0, look: 'hedge' }, { x: 2.9, z: 2.6, hw: 0.35, hd: 1.6, h: 1.0, look: 'hedge' },
                { x: -1.2, z: -5.6, hw: 1.4, hd: 0.35, h: 1.0, look: 'hedge' }],
        decks: [{ id: 'treehouse', x: -3.0, z: 4.3, hw: 0.9, hd: 0.9, h: 2.0, look: 'treehouse' }],
        conns: [{ kind: 'ladder', deck: 'treehouse', x: -1.65, z: 4.3, hw: 0.45, hd: 0.45, axis: 'x', hi: -1 },
                { kind: 'slide', deck: 'treehouse', x: -3.0, z: 2.1, hw: 0.42, hd: 1.3, axis: 'z', hi: 1 }],
        slows: [{ x: 2.5, z: -3.6, r: 1.5, k: 0.45, look: 'pool' }],
    },
    snowpark: {
        name: 'THE SNOWY PARK', place: 'THE TERRITORY · THE SNOWY PARK', ground: 0xd5e1ec,
        walls: [{ x: -3.0, z: -4.2, hw: 1.3, hd: 0.3, h: 1.0, look: 'fort' }, { x: 2.9, z: 5.0, hw: 1.2, hd: 0.3, h: 1.0, look: 'fort' },
                { x: -3.2, z: 1.3, hw: 0.3, hd: 1.0, h: 1.0, look: 'fort' }],
        decks: [{ id: 'hill', x: 3.0, z: 2.2, hw: 0.9, hd: 0.8, h: 1.3, look: 'hill' }],
        conns: [{ kind: 'ramp', deck: 'hill', x: 4.6, z: 2.2, hw: 0.7, hd: 0.55, axis: 'x', hi: -1 },
                { kind: 'slide', deck: 'hill', x: 1.25, z: 2.2, hw: 0.85, hd: 0.45, axis: 'x', hi: 1, look: 'sled' }],
        ices: [{ x: 0.2, z: -1.8, hw: 2.4, hd: 1.7 }],
    },
};
const MAP_KEYS = Object.keys(MAPS);
let _forceMap = null;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _map = null, _mapKey = '', _figs = [], _it = 0, _bot = [], _ring = null, _roundMesh = null, _roofs = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _tags = 0, _itTime = [0, 0];

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _tags = 0; _itTime = [0, 0]; _roofs = []; _roundMesh = null;
    _mapKey = _forceMap && MAPS[_forceMap] ? _forceMap : MAP_KEYS[(Math.random() * MAP_KEYS.length) | 0];
    _map = MAPS[_mapKey];
    _grid = null;
    _it = Math.random() < 0.5 ? 0 : 1;
    _bot = [0, 1].map(() => ({ think: 0, tx: 0, tz: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#a9d4f2;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: _mapKey === 'snowpark' ? 0xcfe6f7 : 0xa9d4f2 });
    _hud = faceoffHud(_stage);
    _in = touch(_stage, { split: 'y' });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);
        if (_mapKey === 'playground') _set = STAGE_SETS.ring(_stage, { w: W, d: D });
        else _buildSurround();
        _buildMap();
    }
    _figs = [0, 1].map(_buildFig);
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'DRAG TO RUN · CLIMB UP · TAKE THE SLIDE'));

    _dir.open({
        place: _map.place, title: 'TAG, YOU’RE IT!',
        sub: 'LEAST TIME AS IT WINS',
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
    _figs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null; _ring = null; _roundMesh = null; _roofs = [];
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Geometry ─────────────────────────────────────────────────────────────────
const _inRect = (r, x, z, pad = 0) => Math.abs(x - r.x) <= r.hw + pad && Math.abs(z - r.z) <= r.hd + pad;
const _deck = id => _map.decks.find(d => d.id === id);
/** 0 at a connector's low end, 1 at its high end. */
function _along(c, x, z) {
    const a = c.axis === 'x' ? x - c.x : z - c.z, half = c.axis === 'x' ? c.hw : c.hd;
    return (a * c.hi + half) / (2 * half);
}
/** A point just off the low end of a connector, on the ground. */
function _foot(c) {
    const half = c.axis === 'x' ? c.hw : c.hd, o = -c.hi * (half + 0.35);
    return c.axis === 'x' ? { x: c.x + o, z: c.z } : { x: c.x, z: c.z + o };
}
/** A point just inside the high end, on the deck. */
function _top(c) {
    const half = c.axis === 'x' ? c.hw : c.hd, o = c.hi * (half + 0.3);
    return c.axis === 'x' ? { x: c.x + o, z: c.z } : { x: c.x, z: c.z + o };
}

// Everything a runner on the GROUND can't walk through.
function _groundBlocks() {
    return [..._map.walls, ..._map.decks, ..._map.conns.filter(c => c.kind === 'slide')];
}
function _pushOut(f, boxes) {
    boxes.forEach(b => {
        const cx = Math.max(b.x - b.hw, Math.min(b.x + b.hw, f.x)), cz = Math.max(b.z - b.hd, Math.min(b.z + b.hd, f.z));
        const dx = f.x - cx, dz = f.z - cz, d = Math.hypot(dx, dz);
        if (d >= BODY) return;
        if (d < 1e-4) {
            const px = b.hw + BODY - Math.abs(f.x - b.x), pz = b.hd + BODY - Math.abs(f.z - b.z);
            if (px < pz) f.x += Math.sign(f.x - b.x || 1) * px; else f.z += Math.sign(f.z - b.z || 1) * pz;
            return;
        }
        f.x = cx + dx / d * BODY; f.z = cz + dz / d * BODY;
    });
}
// Sideways only: along a ladder or slide the ENDS are where you get on and off.
const _clampLat = (f, c, pad) => { if (c.axis === 'x') f.z = Math.max(c.z - c.hd + pad, Math.min(c.z + c.hd - pad, f.z)); else f.x = Math.max(c.x - c.hw + pad, Math.min(c.x + c.hw - pad, f.x)); };
const _clampTo = (f, r, pad) => { f.x = Math.max(r.x - r.hw + pad, Math.min(r.x + r.hw - pad, f.x)); f.z = Math.max(r.z - r.hd + pad, Math.min(r.z + r.hd - pad, f.z)); };

/**
 * Move a figure by (dx, dz), on whatever it is standing on. `f.on` is null on
 * the ground, or the deck/connector it is on; f.y follows.
 */
function _step(f, dx, dz) {
    const on = f.on;
    const nx = f.x + dx, nz = f.z + dz;
    if (!on) {
        // Onto a ladder or ramp from its low end.
        const c = _map.conns.find(c => c.kind !== 'slide' && _inRect(c, nx, nz, -0.05) && _along(c, nx, nz) < 0.6);
        if (c) { f.on = c; f.x = nx; f.z = nz; _clampLat(f, c, 0.12); f.y = _deck(c.deck).h * Math.max(0, _along(c, f.x, f.z)); return; }
        f.x = nx; f.z = nz;
        f.x = Math.max(-W / 2 + BODY, Math.min(W / 2 - BODY, f.x));
        f.z = Math.max(-D / 2 + BODY, Math.min(D / 2 - BODY, f.z));
        _pushOut(f, _groundBlocks());
        f.y = 0;
        return;
    }
    if (on.kind) {                                               // a connector
        const c = on, dk = _deck(c.deck);
        const t = _along(c, nx, nz);
        if (t >= 1 && _inRect(dk, nx, nz, 0.05)) { f.on = dk; f.x = nx; f.z = nz; f.y = dk.h; return; }
        if (t <= 0) { f.on = null; f.x = nx; f.z = nz; f.y = 0; _pushOut(f, _groundBlocks()); return; }
        f.x = nx; f.z = nz; _clampLat(f, c, 0.12);
        f.y = dk.h * Math.max(0, Math.min(1, _along(c, f.x, f.z)));
        return;
    }
    // On a deck: stay on it, or step onto one of its connectors.
    const dk = on;
    if (_inRect(dk, nx, nz, -0.05)) { f.x = nx; f.z = nz; f.y = dk.h; return; }
    const c = _map.conns.find(c => c.deck === dk.id && _inRect(c, nx, nz, 0.05));
    if (c) {
        f.on = c; f.x = nx; f.z = nz; _clampLat(f, c, 0.12);
        if (c.kind === 'slide') { f.sliding = true; sfx('boost'); }
        f.y = dk.h * Math.max(0, Math.min(1, _along(c, f.x, f.z)));
        return;
    }
    f.x = nx; f.z = nz; _clampTo(f, dk, 0.08);
}

/** Down a slide: no stopping, a little steering, and out fast at the bottom. */
function _slide(f, dt, steer) {
    const c = f.on, dir = -c.hi;                       // toward the low end
    const vx = c.axis === 'x' ? dir * SLIDE_V : steer.dx * 1.2, vz = c.axis === 'z' ? dir * SLIDE_V : steer.dz * 1.2;
    f.x += vx * dt; f.z += vz * dt; _clampLat(f, c, 0.12);
    const t = _along(c, f.x, f.z);
    f.y = _deck(c.deck).h * Math.max(0, t);
    if (t <= 0.02) {
        f.on = null; f.sliding = false; f.y = 0;
        const out = _foot(c); f.x = out.x; f.z = out.z;
        f.burst = SLIDE_OUT; f.bx = c.axis === 'x' ? dir : 0; f.bz = c.axis === 'z' ? dir : 0;
        _pushOut(f, _groundBlocks());
    }
    f.face = Math.atan2(c.axis === 'x' ? dir : 0, c.axis === 'z' ? dir : 0);
}

const _inHide = f => !f.on && (_map.hides || []).some(h => _inRect(h, f.x, f.z));
const _onCarry = f => !f.on && _map.carry && Math.hypot(f.x - _map.carry.x, f.z - _map.carry.z) < _map.carry.r;
const _slowAt = f => (f.on ? 1 : (_map.slows || []).reduce((k, s) => (Math.hypot(f.x - s.x, f.z - s.z) < s.r ? Math.min(k, s.k) : k), 1));
const _onIce = f => !f.on && (_map.ices || []).some(r => _inRect(r, f.x, f.z));

// ── The map, built ───────────────────────────────────────────────────────────
function _buildSurround() {
    const scene = _stage.scene;
    const snow = _mapKey === 'snowpark';
    scene.background = new THREE.Color(snow ? 0xcfe6f7 : 0xa9d4f2);
    _stage.light({ sun: 0xfff3dd, sunI: snow ? 0.85 : 1.2, sky: snow ? 0xe6f0fa : 0xbfe0f5, ground: snow ? 0x8ea3b8 : 0x4a5a38, hemiI: 0.75, dir: [-6, 16, 8], span: 14 });
    const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: snow ? 0xf2f6fa : _mapKey === 'backyard' ? 0x5b9e3f : 0xa38a66, roughness: 1 }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.02; g.receiveShadow = true; scene.add(g);
    // A fence round the play area.
    const post = new THREE.MeshStandardMaterial({ color: _mapKey === 'construction' ? 0xf97316 : snow ? 0x8a6a4a : 0xe8dcc4, roughness: 0.8 });
    const around = [];
    for (let x = -W / 2; x <= W / 2 + 0.01; x += 1.1) around.push([x, -D / 2 - 0.4], [x, D / 2 + 0.4]);
    for (let z = -D / 2; z <= D / 2 + 0.01; z += 1.1) around.push([-W / 2 - 0.4, z], [W / 2 + 0.4, z]);
    around.forEach(([x, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 0.14), post); m.position.set(x, 0.45, z); scene.add(m); });
    // Trees (snowy ones in the park), outside the fence.
    const leaf = new THREE.MeshStandardMaterial({ color: snow ? 0x2f6b4a : 0x3f8f3a, roughness: 0.9 }), bark = new THREE.MeshStandardMaterial({ color: 0x6b4423 });
    [[-8, -6], [-8.5, 3], [-7.5, 9], [8, -8], [8.5, 1], [7.8, 7], [-3, -11], [4, 11]].forEach(([x, z]) => {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.6, 7), bark); t.position.set(x, 0.8, z); scene.add(t);
        const l = new THREE.Mesh(snow ? new THREE.ConeGeometry(1.4, 3, 8) : new THREE.SphereGeometry(1.5, 10, 8), leaf); l.position.set(x, snow ? 2.9 : 2.5, z); l.castShadow = true; scene.add(l);
    });
}

function _box(w, h, d, color, x, y, z, rough = 0.8) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: rough }));
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; _stage.add(m);
    return m;
}
/** A sloped plank for a connector: low end on the ground, high end at the deck. */
function _sloped(c, h, color, width) {
    const L = 2 * (c.axis === 'x' ? c.hw : c.hd), len = Math.hypot(L, h);
    const g = new THREE.Group();
    const plank = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, len), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    plank.castShadow = true; plank.receiveShadow = true; g.add(plank);
    // Along its own z, rising toward the high end.
    g.rotation.x = -Math.atan2(h, L);
    const holder = new THREE.Group(); holder.add(g);
    holder.position.set(c.x, h / 2, c.z);
    // Point its +z at the high end.
    holder.rotation.y = c.axis === 'z' ? (c.hi > 0 ? 0 : Math.PI) : (c.hi > 0 ? Math.PI / 2 : -Math.PI / 2);
    _stage.add(holder);
    return { holder, g, len };
}

function _buildMap() {
    const m = _map;
    // Play surface.
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: m.ground, roughness: 0.95 }));
    surf.rotation.x = -Math.PI / 2; surf.position.y = 0.01; surf.receiveShadow = true; _stage.add(surf);
    const looks = { tunnel: 0xef4444, pipe: 0xf97316, crane: 0xfacc15, bricks: 0xb45a3c, hedge: 0x2f7a32, fort: 0xa9c1da };
    m.walls.forEach(w => { if (w.look !== 'tunnel' && w.look !== 'pipe') _box(w.hw * 2, w.h, w.hd * 2, looks[w.look] || 0x888888, w.x, w.h / 2, w.z); else _box(w.hw * 2, w.h, w.hd * 2, looks[w.look], w.x, w.h / 2, w.z, 0.5); });
    // The crane: a mast and a jib over the site.
    m.walls.filter(w => w.look === 'crane').forEach(w => {
        // The mast only: a jib across the yard read, from above, as a wall.
        _box(0.35, 3.5, 0.35, 0xfacc15, w.x, 1.75 + w.h, w.z);
    });
    // Decks.
    m.decks.forEach(d => {
        const col = { tower: 0x3b82f6, scaffold: 0x9ca3af, treehouse: 0x8b5a2b, hill: 0xeaf1f8 }[d.look] || 0x999999;
        if (d.look === 'hill') {
            const hill = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(d.hw, d.hd) * 0.95, Math.max(d.hw, d.hd) * 1.35, d.h, 20), new THREE.MeshStandardMaterial({ color: col, roughness: 1 }));
            hill.position.set(d.x, d.h / 2, d.z); hill.receiveShadow = true; hill.castShadow = true; _stage.add(hill);
        } else {
            _box(d.hw * 2, 0.16, d.hd * 2, col, d.x, d.h - 0.08, d.z, 0.6);
            [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => _box(0.14, d.h, 0.14, d.look === 'treehouse' ? 0x5a3b1c : 0x6b7280, d.x + a * (d.hw - 0.1), d.h / 2, d.z + b * (d.hd - 0.1)));
            if (d.look === 'treehouse') {
                const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, d.h + 2.5, 10), new THREE.MeshStandardMaterial({ color: 0x5a3b1c }));
                trunk.position.set(d.x - d.hw - 0.4, (d.h + 2.5) / 2, d.z - d.hd - 0.4); _stage.add(trunk);
                // A light crown, off to the side: it mustn't hide the deck (or whoever is on it).
                const crown = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), new THREE.MeshStandardMaterial({ color: 0x3f8f3a, transparent: true, opacity: 0.4, depthWrite: false }));
                crown.position.set(d.x - d.hw - 0.6, d.h + 3.0, d.z - d.hd - 0.6); _stage.add(crown);
            }
            // A low rail round the edge, so a deck reads as a place to stand.
            const rail = new THREE.MeshStandardMaterial({ color: 0xfacc15 });
            [[0, -d.hd, d.hw * 2, 0.06], [0, d.hd, d.hw * 2, 0.06], [-d.hw, 0, 0.06, d.hd * 2], [d.hw, 0, 0.06, d.hd * 2]].forEach(([ox, oz, w, dd]) => {
                const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, dd), rail); r.position.set(d.x + ox, d.h + 0.35, d.z + oz); _stage.add(r);
            });
        }
    });
    // Connectors.
    m.conns.forEach(c => {
        const h = _deck(c.deck).h, width = 2 * (c.axis === 'x' ? c.hd : c.hw);
        if (c.kind === 'slide') {
            const s = _sloped(c, h, c.look === 'sled' ? 0x7dd3fc : 0xfacc15, width);
            [-1, 1].forEach(k => { const r = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, s.len), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.5, roughness: 0.3 })); r.position.x = k * width / 2; r.position.y = 0.1; s.g.add(r); });
        } else if (c.kind === 'ramp') {
            _sloped(c, h, 0xa0784a, width);
        } else {
            const s = _sloped(c, h, 0x7c5a3a, width * 0.25);
            s.g.children[0].position.x = -width * 0.38;
            const side = s.g.children[0].clone(); side.position.x = width * 0.38; s.g.add(side);
            for (let k = 0; k < 6; k++) { const r = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0x7c5a3a })); r.position.z = -s.len / 2 + (k + 0.5) * s.len / 6; r.position.y = 0.05; s.g.add(r); }
        }
    });
    // Hiding places: a roof that fades while somebody is under it.
    (m.hides || []).forEach(hd => {
        const pipe = hd.look === 'pipe';
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(hd.hd + 0.25, hd.hd + 0.25, hd.hw * 2, 20, 1, true, 0, Math.PI),
            new THREE.MeshStandardMaterial({ color: pipe ? 0xf97316 : 0xef4444, roughness: 0.5, side: THREE.DoubleSide, transparent: true, opacity: 1 }));
        roof.rotation.set(0, 0, Math.PI / 2);
        roof.position.set(hd.x, pipe ? 1.3 : 1.1, hd.z); roof.castShadow = true; _stage.add(roof);
        _roofs.push({ roof, zone: hd });
    });
    // Slow ground and ice.
    (m.slows || []).forEach(s => {
        if (s.look === 'pool') {
            const water = new THREE.Mesh(new THREE.CircleGeometry(s.r, 28), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, transparent: true, opacity: 0.85 }));
            water.rotation.x = -Math.PI / 2; water.position.set(s.x, 0.06, s.z); _stage.add(water);
            const rim = new THREE.Mesh(new THREE.TorusGeometry(s.r, 0.12, 8, 32), new THREE.MeshStandardMaterial({ color: 0x60a5fa }));
            rim.rotation.x = Math.PI / 2; rim.position.set(s.x, 0.12, s.z); _stage.add(rim);
        } else {
            const pile = new THREE.Mesh(new THREE.SphereGeometry(s.r, 16, 10), new THREE.MeshStandardMaterial({ color: 0xc49a5e, roughness: 1 }));
            pile.scale.y = 0.22; pile.position.set(s.x, 0, s.z); pile.receiveShadow = true; _stage.add(pile);
        }
    });
    (m.ices || []).forEach(r => {
        const ice = new THREE.Mesh(new THREE.PlaneGeometry(r.hw * 2, r.hd * 2), new THREE.MeshStandardMaterial({ color: 0x6fb8ef, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.75 }));
        ice.rotation.x = -Math.PI / 2; ice.position.set(r.x, 0.03, r.z); _stage.add(ice);
    });
    // The roundabout.
    if (m.carry) {
        const c = m.carry, steel = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.6 });
        _roundMesh = new THREE.Group();
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, 0.18, 32), new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.5 }));
        disc.position.y = 0.12; disc.receiveShadow = true; _roundMesh.add(disc);
        for (let k = 0; k < 4; k++) { const bar = new THREE.Mesh(new THREE.BoxGeometry(c.r * 1.7, 0.08, 0.08), steel); bar.position.y = 0.8; bar.rotation.y = k * Math.PI / 4; _roundMesh.add(bar); }
        _roundMesh.position.set(c.x, 0, c.z); _stage.add(_roundMesh);
    }
    // A snowman or two in the park, cones on the site.
    if (_mapKey === 'snowpark') [[-4.4, 6.4], [4.5, -6.6]].forEach(([x, z]) => [[0.5, 0.45], [0.36, 1.15], [0.25, 1.65]].forEach(([r, y]) => { const s = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), new THREE.MeshStandardMaterial({ color: 0xffffff })); s.position.set(x, y, z); _stage.add(s); }));
    if (_mapKey === 'construction') [[4.6, -6.8], [-4.6, 6.9], [4.7, -1.5]].forEach(([x, z]) => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.7, 10), new THREE.MeshStandardMaterial({ color: 0xf97316 })); c.position.set(x, 0.35, z); _stage.add(c); });
    // IT's ring. Yellow: it has to read under every character, the red one included.
    _ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.15, 36), new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.95, depthWrite: false }));
    _ring.rotation.x = -Math.PI / 2; _ring.position.y = 0.05; _stage.add(_ring);
}

function _buildFig(slot) {
    const f = { slot, x: slot === 0 ? 1.2 : -1.2, z: (slot === 0 ? 1 : -1) * (D / 2 - 1.6), y: 0, on: null, sliding: false, burst: 0, bx: 0, bz: 0,
                face: slot === 0 ? Math.PI : 0, moving: false, hidden: false, frozen: 0, immune: 0, vx: 0, vz: 0 };
    _pushOut(f, _groundBlocks());
    if (_stage.gl) {
        const c = _stage.character(slot);
        c.rig.root.scale.setScalar(FIG_SCALE);
        c.rig.root.position.set(f.x, 0, f.z);
        c.anim.face(f.face, true);
        Object.assign(f, { rig: c.rig, anim: c.anim });
    }
    return f;
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// IT chases where the other is heading (a better bot leads further), and goes
// up the ladder after somebody on a deck. The runner looks round for the
// direction that keeps it furthest from IT, and a good one takes to a deck or
// a slide when IT is close.
function _botMove(slot, dt) {
    const me = _figs[slot], them = _figs[1 - slot], b = _bot[slot];
    b.think -= dt;
    if (b.think <= 0) {
        b.think = 0.35 - _botSkill * 0.2 + Math.random() * 0.15;
        if (_it === slot) {
            const lead = 0.2 + _botSkill * 0.5;
            b.tx = them.x + (them.vx || 0) * lead; b.tz = them.z + (them.vz || 0) * lead;
            // They're up high: the way up is the ladder (or ramp) to their deck.
            const theirDeck = them.on && (them.on.id ? them.on : _deck(them.on.deck));
            if (theirDeck && !me.on) {
                const up = _map.conns.find(c => c.deck === theirDeck.id && c.kind !== 'slide');
                if (up) { const p = _foot(up); b.tx = p.x; b.tz = p.z; }
            } else if (me.on && !me.on.kind && them.y < 0.3) {
                // Up on a deck and they're below: take the slide down.
                const down = _map.conns.find(c => c.deck === me.on.id && c.kind === 'slide') || _map.conns.find(c => c.deck === me.on.id);
                if (down) { const p = _top(down); b.tx = p.x - (down.axis === 'x' ? down.hi : 0) * 0.8; b.tz = p.z - (down.axis === 'z' ? down.hi : 0) * 0.8; }
            }
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
    const k = 0.72 + 0.28 * _botSkill;
    if (Math.hypot(b.tx - me.x, b.tz - me.z) < 0.2) return { dx: 0, dz: 0 };
    // On the ground, go round walls by the grid; up on a deck or a ladder, straight.
    let wx = b.tx, wz = b.tz;
    if (!me.on) { const p = _nextWaypoint(me.x, me.z, b.tx, b.tz); if (p) { wx = p.x; wz = p.z; } }
    const dx = wx - me.x, dz = wz - me.z, d = Math.hypot(dx, dz) || 1;
    return { dx: dx / d * k, dz: dz / d * k };
}

// ── Getting round walls: a coarse grid of the yard and a flood from the target ─
const CELL = 0.5, GX = Math.round(W / CELL), GZ = Math.round(D / CELL);
let _grid = null;
function _buildGrid() {
    _grid = new Uint8Array(GX * GZ);
    for (let i = 0; i < GX; i++) for (let j = 0; j < GZ; j++) {
        const x = -W / 2 + (i + 0.5) * CELL, z = -D / 2 + (j + 0.5) * CELL;
        const blocked = Math.abs(x) > W / 2 - BODY || Math.abs(z) > D / 2 - BODY || _groundBlocks().some(r => _inRect(r, x, z, BODY * 0.85));
        _grid[i * GZ + j] = blocked ? 1 : 0;
    }
}
const _cellOf = (x, z) => [Math.max(0, Math.min(GX - 1, Math.floor((x + W / 2) / CELL))), Math.max(0, Math.min(GZ - 1, Math.floor((z + D / 2) / CELL)))];
function _nextWaypoint(sx, sz, tx, tz) {
    if (!_grid) _buildGrid();
    const [ti, tj] = _cellOf(tx, tz), [si, sj] = _cellOf(sx, sz);
    const dist = new Int16Array(GX * GZ).fill(-1), q = [ti * GZ + tj];
    dist[ti * GZ + tj] = 0;
    for (let h = 0; h < q.length; h++) {
        const c = q[h], i = (c / GZ) | 0, j = c % GZ;
        if (i === si && j === sj) break;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= GX || nj >= GZ) continue;
            const n = ni * GZ + nj;
            if (dist[n] >= 0 || (_grid[n] && n !== si * GZ + sj)) continue;
            dist[n] = dist[c] + 1; q.push(n);
        }
    }
    if (dist[si * GZ + sj] < 0) return null;
    // Walk downhill a few cells, and aim there: smooth, and round the corner.
    let i = si, j = sj;
    for (let step = 0; step < 3; step++) {
        let bi = i, bj = j, bd = dist[i * GZ + j];
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= GX || nj >= GZ) continue;
            const v = dist[ni * GZ + nj];
            if (v >= 0 && v < bd) { bd = v; bi = ni; bj = nj; }
        }
        if (bi === i && bj === j) break;
        i = bi; j = bj;
    }
    return { x: -W / 2 + (i + 0.5) * CELL, z: -D / 2 + (j + 0.5) * CELL };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _hud.say(`${seat(_it).name} IS IT!`, `${_map.name} · RUN!`, READY_TIME * 1000, _t, seat(_it).css);
    else if (phase === 'play') sfx('go');
}

function _tag(from, to) {
    _it = to.slot; _tags++;
    to.frozen = FREEZE; from.immune = IMMUNE;
    sfx('slam'); haptic([50]);
    if (_stage?.gl) { _fx.burst(new THREE.Vector3(to.x, to.y + 1, to.z), 0xff2d2d, 0.6, 0.22); to.anim?.flinch?.(); }
    _hud.say('TAG!', `${seat(to.slot).name} IS IT`, 900, _t, seat(to.slot).css);
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');
    const spin = _map.carry ? _map.carry.spin * dt : 0;

    if (_phase === 'play') {
        _clock += dt;
        _itTime[_it] += dt;
        _figs.forEach(f => {
            f.frozen = Math.max(0, f.frozen - dt); f.immune = Math.max(0, f.immune - dt); f.burst = Math.max(0, f.burst - dt);
            let mv = { dx: 0, dz: 0 };
            if (f.frozen <= 0) mv = isBotSlot(f.slot) ? _botMove(f.slot, dt) : (s => ({ dx: s.dx, dz: s.dy }))(_in.seat(f.slot));
            if (f.sliding) { _slide(f, dt, mv); f.moving = true; return; }
            const m = Math.min(1, Math.hypot(mv.dx, mv.dz));
            const sp = SPEED * (_it === f.slot ? IT_BONUS : 1) * (f.on && f.on.kind ? CLIMB : 1) * _slowAt(f);
            f.moving = m > 0.12;
            let wx = f.moving ? mv.dx / Math.hypot(mv.dx, mv.dz) * m * sp : 0;
            let wz = f.moving ? mv.dz / Math.hypot(mv.dx, mv.dz) * m * sp : 0;
            if (f.burst > 0) { wx += f.bx * SLIDE_V * 0.7 * (f.burst / SLIDE_OUT); wz += f.bz * SLIDE_V * 0.7 * (f.burst / SLIDE_OUT); }
            // On ice you can't change direction quickly: you slide about.
            const grip = _onIce(f) ? Math.min(1, dt * 1.4) : 1;
            f.vx += (wx - f.vx) * grip; f.vz += (wz - f.vz) * grip;
            _step(f, f.vx * dt, f.vz * dt);
            // The roundabout carries whoever is on it round its hub.
            if (_onCarry(f)) {
                const c = _map.carry, rx = f.x - c.x, rz = f.z - c.z, cs = Math.cos(spin), sn = Math.sin(spin);
                f.x = c.x + rx * cs - rz * sn; f.z = c.z + rx * sn + rz * cs;
            }
            if (f.moving) {
                let d = Math.atan2(mv.dx, mv.dz) - f.face; d = Math.atan2(Math.sin(d), Math.cos(d));
                f.face += Math.max(-12 * dt, Math.min(12 * dt, d));
            }
            f.hidden = _inHide(f);
        });
        const [a, b] = _figs, d = Math.hypot(a.x - b.x, a.z - b.z), level = Math.abs(a.y - b.y) < REACH_Y;
        const itF = _figs[_it], runner = _figs[1 - _it];
        if (d < BODY * 2 + 0.1 && level && itF.frozen <= 0 && itF.immune <= 0) _tag(itF, runner);
        else if (d < BODY * 2 && d > 1e-4 && level && !a.on && !b.on) {
            const push = (BODY * 2 - d) / 2;
            const nx = (a.x - b.x) / d, nz = (a.z - b.z) / d;
            a.x += nx * push; a.z += nz * push; b.x -= nx * push; b.z -= nz * push;
        }
        if (MATCH_TIME - _clock < 5.05 && MATCH_TIME - _clock > 4.95) _hud.say('5 SECONDS!', `${seat(_it).name} IS IT`, 900, _t, '#facc15');
        if (_clock >= MATCH_TIME) _end();
    }

    _figs.forEach(f => {
        if (!f.rig) return;
        f.rig.root.position.set(f.x, f.y + (_onCarry(f) ? 0.2 : 0), f.z);
        if (_phase === 'over') return;
        f.anim.face(f.face, true);
        f.anim.play(f.frozen > 0 ? 'hit' : f.sliding ? 'duck' : f.moving ? 'run' : 'ready', { rate: 3.2 });
    });
    if (_roundMesh) _roundMesh.rotation.y -= spin;
    if (_ring && _figs[_it]) {
        const f = _figs[_it];
        _ring.position.set(f.x, f.y + 0.05, f.z);
        _ring.scale.setScalar(1 + Math.sin(_t * 8) * 0.08);
        _ring.material.color.setHex(f.frozen > 0 ? 0xfff3b0 : 0xffe14d);
    }
    // See under a roof while somebody is under it.
    _roofs.forEach(r => {
        const want = _figs.some(f => f.hidden && _inRect(r.zone, f.x, f.z)) ? 0.35 : 1;
        const m = r.roof.material; m.opacity += (want - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.98;
    });
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
        _hud.line(slot, `${_it === slot ? '🟡 YOU’RE IT' : '🏃 RUN'} · IT ${_itTime[slot].toFixed(1)}s vs ${_itTime[1 - slot].toFixed(1)}s · ${left}s${me?.frozen > 0 ? ' · FROZEN' : ''}`);
        if (_clock > 6) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${left}s · ${seat(_it).name} IS IT`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    sfx('whistle');
    // Least time as IT wins; within a tenth of a second is a dead heat.
    const [t0, t1] = _itTime;
    const w = Math.abs(t0 - t1) < 0.1 ? -1 : t0 < t1 ? 0 : 1;
    _figs.forEach(f => { f.sliding = false; });
    _dir.close({
        winner: w, figs: _figs.filter(f => f.rig).map(f => ({ slot: f.slot, rig: f.rig, anim: f.anim })),
        sub: w < 0 ? `BOTH IT FOR ${t0.toFixed(1)}s` : `IT FOR ${_itTime[w].toFixed(1)}s TO ${_itTime[1 - w].toFixed(1)}s`,
        closeUp: (f, p) => ({ pos: [p.x + 2, p.y + 8.5 * FIG_SCALE, p.z + (f.slot === 0 ? 1 : -1) * 8 * FIG_SCALE], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), it: _it, tags: _tags, map: _mapKey, itTime: _itTime.map(t => +t.toFixed(2)),
             figs: _figs.map(f => ({ x: +f.x.toFixed(2), z: +f.z.toFixed(2), y: +f.y.toFixed(2), on: f.on ? (f.on.id || f.on.kind) : null,
                                     sliding: f.sliding, frozen: +f.frozen.toFixed(2), hidden: f.hidden })),
             decks: _map.decks.map(d => ({ id: d.id, x: d.x, z: d.z, h: d.h })),
             conns: _map.conns.map(c => ({ kind: c.kind, deck: c.deck, foot: _foot(c), top: _top(c) })),
             hide: _map.hides?.[0] ? { x: _map.hides[0].x, z: _map.hides[0].z } : null,
             round: _map.carry ? { x: _map.carry.x, z: _map.carry.z } : null,
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: put a figure on the ground at (x, z). */
export function _debugPlace(slot, x, z) { const f = _figs[slot]; if (f) Object.assign(f, { x, z, y: 0, on: null, sliding: false, burst: 0, vx: 0, vz: 0 }); }
/** Probes: put a figure up on a deck. */
export function _debugOnDeck(slot, id) { const f = _figs[slot], d = _deck(id); if (f && d) Object.assign(f, { x: d.x, z: d.z, y: d.h, on: d, sliding: false, vx: 0, vz: 0 }); }
export function _debugIt(slot) { _it = slot; _figs.forEach(f => { f.frozen = 0; f.immune = 0; }); }
export function _debugClock(t) { _clock = t; }
export function _debugItTime(a, b) { _itTime = [a, b]; }
/** Probes: the map the NEXT start() builds (null = random). */
export function _debugForceMap(key) { _forceMap = key; }
