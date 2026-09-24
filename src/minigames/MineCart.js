// Mine Cart Mayhem — the Cinder Mine, and one set of switches for both of you.
//
// The fifth game on the shared 3D stage, face-off and seen from above like
// Vault Heist. Each player's figure rides a mine cart that never stops rolling
// round a grid of track. Gems glow on the rails; TNT crates sit on some.
//
//   TAP   flips the switch at the junction YOUR cart is heading for. Your
//         colour on the floor shows which way you will go.
//
// The switches are shared. A junction you flip is flipped for whoever reaches
// it next — which is how you send a rival into the TNT, or take the branch
// with the big gem on it away from them. Hit TNT and you stop, and two of
// your gems spill onto the track. Meet head-on and you both bounce back.
//
// Most gems when the clock runs out.
//
// STRUCTURAL CEILING
//   A fixed MATCH_TIME clock.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, seatFor } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const MATCH_TIME = 40;
const READY_TIME = 1.2;
const SPEED      = 5.0;        // units / s along the rails
const CRASH_T    = 1.3;
const BUMP_T     = 0.8;
const PICK_R     = 0.6;
const GEMS_LIVE  = 6;
const TNT_LIVE   = 3;
const SPILL      = 2;
const BIG_CHANCE = 0.2;
const FIG_SCALE  = 0.75;
const CART_SCALE = 1.35;

// ── The track: a 3 × 5 grid of junctions, 4 units apart ─────────────────────
const G = (() => {
    const nodes = [], edges = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) nodes.push({ x: (c - 1) * 4, z: (r - 2) * 4, r, c });
    const id = (r, c) => r * 3 + c;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if (c < 2) edges.push([id(r, c), id(r, c + 1)]);
        if (r < 4) edges.push([id(r, c), id(r + 1, c)]);
    }
    const nbrs = nodes.map(() => []);
    edges.forEach(([a, b]) => {
        const A = nodes[a], B = nodes[b], L = Math.hypot(B.x - A.x, B.z - A.z);
        nbrs[a].push({ to: b, dx: (B.x - A.x) / L, dz: (B.z - A.z) / L });
        nbrs[b].push({ to: a, dx: (A.x - B.x) / L, dz: (A.z - B.z) / L });
    });
    nodes.forEach((n, i) => { n.exits = nbrs[i].length; });
    return { nodes, edges, nbrs, w: 8, d: 16 };
})();

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null;
let _carts = [];
let _sw = [];                  // per node: the exit it is set to, as a neighbour index
let _gems = [], _tnt = [];
let _bot = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0;
let _dirOwns = false;
let _fx = [];
let _tntDue = [];              // clock times at which a blown crate comes back

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _fx = [];
    _gems = []; _tnt = []; _tntDue = [];
    _sw = G.nodes.map((n, i) => Math.floor(Math.random() * G.nbrs[i].length));
    _bot = [0, 1].map(() => ({ wait: 0 }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0c0806;z-index:5;';
    mg.appendChild(_overlay);

    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x0c0806 });
    _buildHud();
    _dir = createDirector(_stage);
    if (_stage.gl) {
        _stage.camera.up.set(0, 0, -1);          // P2's end is up, for every shot (see Vault Heist)
        _set = STAGE_SETS.mine(_stage, G);
    }
    _carts = [0, 1].map(slot => _buildCart(slot));
    for (let i = 0; i < GEMS_LIVE; i++) _spawnGem();
    for (let i = 0; i < TNT_LIVE; i++) _spawnTnt();
    _syncArrows();

    _stage.listen('pointerdown', _onDown);
    _stage.onResize(() => {});

    _dir.open({
        place: 'CINDER MINE · THE WORKINGS', title: 'MINE CART MAYHEM',
        sub: 'TAP TO THROW YOUR NEXT SWITCH',
        from: { pos: [5, 7, 14], look: [0, 0, 2] },
        to: _playCam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _carts = []; _gems = []; _tnt = []; _fx = []; _set = null; _dir = null; _hud = null;
}

function _finish(winner) {
    if (_done) return;                           // R6
    _destroy();
    _onWin?.(winner);
}

function _playCam() {
    const fov = (_stage?.camera?.fov ?? 38) * Math.PI / 180;
    const aspect = (_stage?.width || 412) / Math.max(1, _stage?.height || 892);
    const t = Math.tan(fov / 2);
    // Room for each end's panel, and not much more: carts and gems are small
    // things seen from high up.
    const h = Math.max((G.d + 8) / (2 * t), (G.w + 2.4) / (2 * t * aspect));
    const tilt = 0.3;
    return { pos: [h * Math.sin(tilt), h * Math.cos(tilt), 0], look: [0, 0, 0] };
}

// ── Carts ────────────────────────────────────────────────────────────────────
function _css(slot) {
    const c = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return c;
}

function _buildCart(slot) {
    // P1 starts at the bottom middle heading right; P2 is the same turned 180°.
    const from = slot === 0 ? 13 : 1, to = slot === 0 ? 14 : 0;
    const c = { slot, from, to, s: 0, stun: 0, gems: 0, flip: 0 };
    if (_stage.gl) {
        const g = new THREE.Group();
        const iron = new THREE.MeshStandardMaterial({ color: 0x4a4e55, roughness: 0.5, metalness: 0.7 });
        const band = new THREE.MeshStandardMaterial({ color: _css(slot), roughness: 0.5 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 1.2), iron);
        body.position.y = 0.45; g.add(body);
        const rim = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.12, 1.28), band);
        rim.position.y = 0.72; g.add(rim);
        [[-0.42, -0.4], [0.42, -0.4], [-0.42, 0.4], [0.42, 0.4]].forEach(([x, z]) => {
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 12), iron);
            w.rotation.z = Math.PI / 2; w.position.set(x, 0.18, z); g.add(w);
        });
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        g.scale.setScalar(CART_SCALE);
        _stage.add(g);
        const ch = _stage.character(slot);
        _stage.scene.remove(ch.rig.root);
        ch.rig.root.scale.setScalar(FIG_SCALE / CART_SCALE);
        ch.rig.root.position.y = 0.35;
        g.add(ch.rig.root);
        ch.anim.play('ready');
        // Your next junction, and the way you will leave it, in your colour.
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.95, 24),
            new THREE.MeshBasicMaterial({ color: _css(slot), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; _stage.add(ring);
        const route = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.6),
            new THREE.MeshBasicMaterial({ color: _css(slot), transparent: true, opacity: 0.8, depthWrite: false }));
        route.rotation.x = -Math.PI / 2; route.position.y = 0.07; _stage.add(route);
        Object.assign(c, { group: g, rig: ch.rig, anim: ch.anim, ring, route });
    }
    return c;
}

function _edgeLen(a, b) { const A = G.nodes[a], B = G.nodes[b]; return Math.hypot(B.x - A.x, B.z - A.z); }
function _posOf(c) {
    const A = G.nodes[c.from], B = G.nodes[c.to], k = c.s / _edgeLen(c.from, c.to);
    return { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k };
}
function _approach(c) {
    const A = G.nodes[c.from], B = G.nodes[c.to], L = _edgeLen(c.from, c.to);
    return { dx: (B.x - A.x) / L, dz: (B.z - A.z) / L };
}

// The ways out of `node` for something arriving along `d`: never straight back.
function _cands(node, d) { return G.nbrs[node].filter(n => !(Math.abs(n.dx + d.dx) < 1e-6 && Math.abs(n.dz + d.dz) < 1e-6)); }

// Where the switch sends something arriving along `d`: the set exit if it is
// a way out for them, else straight on if there is one, else the first way.
function _exitFor(node, d) {
    const cands = _cands(node, d);
    const set = G.nbrs[node][_sw[node]];
    if (cands.includes(set)) return set;
    return cands.find(n => Math.abs(n.dx - d.dx) < 1e-6 && Math.abs(n.dz - d.dz) < 1e-6) || cands[0];
}

// A tap: throw the switch ahead of `slot` to its next way out.
function _flip(slot) {
    const c = _carts[slot];
    if (_phase !== 'play' || c.stun > 0) return false;
    const node = c.to, d = _approach(c);
    const cands = _cands(node, d);
    if (cands.length < 2) return false;             // a corner: nothing to throw
    const cur = _exitFor(node, d);
    const next = cands[(cands.indexOf(cur) + 1) % cands.length];
    _sw[node] = G.nbrs[node].indexOf(next);
    c.flip = 0.15;
    sfx('seq_lit'); haptic([12]);
    _syncArrows();
    return true;
}

function _syncArrows() {
    if (!_set) return;
    _set.arrows.forEach((a, i) => {
        const n = G.nbrs[i][_sw[i]];
        a.rotation.y = Math.atan2(n.dx, n.dz);
    });
}

// ── Gems and TNT ─────────────────────────────────────────────────────────────
function _freeEdge() {
    for (let tries = 0; tries < 40; tries++) {
        const e = G.edges[Math.floor(Math.random() * G.edges.length)];
        const busy = [..._gems, ..._tnt].some(o => o.a === e[0] && o.b === e[1])
            || _carts.some(c => (c.from === e[0] && c.to === e[1]) || (c.from === e[1] && c.to === e[0]));
        if (!busy) return e;
    }
    return G.edges[Math.floor(Math.random() * G.edges.length)];
}
function _mid(a, b) { const A = G.nodes[a], B = G.nodes[b]; return { x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 }; }

function _spawnGem(value, near) {
    const e = near || _freeEdge();
    const p = _mid(e[0], e[1]);
    const v = value ?? (Math.random() < BIG_CHANCE ? 3 : 1);
    const g = { a: e[0], b: e[1], x: p.x, z: p.z, v, mesh: null };
    if (_stage?.gl) {
        const big = v >= 3;
        const m = new THREE.Mesh(big ? new THREE.OctahedronGeometry(0.55, 0) : new THREE.OctahedronGeometry(0.4, 0),
            new THREE.MeshStandardMaterial({ color: big ? 0x4fd1ff : 0xff9a3c, emissive: big ? 0x0a6a9a : 0x8a3a00,
                                            emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.3 }));
        m.position.set(p.x, 0.7, p.z);
        const glow = new THREE.Mesh(new THREE.CircleGeometry(big ? 1.0 : 0.75, 20),
            new THREE.MeshBasicMaterial({ color: big ? 0x4fd1ff : 0xffb057, transparent: true, opacity: 0.35, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2; glow.position.set(p.x, 0.03, p.z);
        _stage.add(m); _stage.add(glow);
        g.mesh = m; g.glow = glow;
    }
    _gems.push(g);
}

function _spawnTnt() {
    const e = _freeEdge();
    const p = _mid(e[0], e[1]);
    const t = { a: e[0], b: e[1], x: p.x, z: p.z, mesh: null };
    if (_stage?.gl) {
        const g = new THREE.Group();
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7),
            new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.7 }));
        crate.position.y = 0.3; g.add(crate);
        const label = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.72), new THREE.MeshStandardMaterial({ color: 0xf5e6c8 }));
        label.position.y = 0.36; g.add(label);
        const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd060 }));
        fuse.position.set(0, 0.68, 0); g.add(fuse);
        g.position.set(p.x, 0, p.z);
        g.traverse(o => { if (o.isMesh) o.castShadow = true; });
        _stage.add(g);
        t.mesh = g; t.fuse = fuse;
    }
    _tnt.push(t);
}

function _drop(o) {
    if (!o.mesh) return;
    [o.mesh, o.glow].forEach(m => {
        if (!m) return;
        _stage?.scene?.remove(m);
        m.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); });
    });
}

function _boom(at) {
    sfx('boom'); haptic([80]);
    if (!_stage?.gl) return;
    const burst = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true }));
    burst.position.set(at.x, 0.6, at.z);
    _stage.add(burst);
    _fx.push({ obj: burst, t: 0, life: 0.35, update: (o, t) => { o.scale.setScalar(1 + t * 10); o.material.opacity = 1 - t / 0.35; } });
    for (let i = 0; i < 8; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6),
            new THREE.MeshStandardMaterial({ color: 0x6a5a4a, transparent: true, opacity: 0.8 }));
        m.position.set(at.x, 0.5, at.z);
        const v = new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 3);
        _stage.add(m);
        _fx.push({ obj: m, t: 0, life: 1.2, update: (o, t, dt) => { o.position.addScaledVector(v, dt); o.scale.setScalar(1 + t * 2); o.material.opacity = 0.8 * (1 - t / 1.2); } });
    }
}

function _crash(c, why) {
    c.stun = why === 'tnt' ? CRASH_T : BUMP_T;
    c.lastCrash = why;
    c.anim?.play('hit', { restart: true });
    if (why === 'tnt') {
        // Spill: the gems land on the track nearby for anybody to take.
        const lose = Math.min(SPILL, c.gems);
        c.gems -= lose;
        c.spilled = (c.spilled || 0) + lose;
        for (let i = 0; i < lose; i++) {
            const around = G.edges.filter(e => e.includes(c.from) || e.includes(c.to));
            _spawnGem(1, around[Math.floor(Math.random() * around.length)]);
        }
    } else sfx('slam');
}

// ── Bots (§5) ────────────────────────────────────────────────────────────────
// Looks a few junctions ahead for the best-value gem it can reach without
// driving through TNT, and throws its switch that way after a reaction delay.
// At hard it also counts the rival's route, and will take a gem away from them.
function _edgeHas(list, a, b) { return list.find(o => (o.a === a && o.b === b) || (o.a === b && o.b === a)); }

function _valueOf(node, d, depth, seen) {
    if (depth === 0) return 0;
    let best = -Infinity;
    _cands(node, d).forEach(n => {
        if (_edgeHas(_tnt, node, n.to)) { best = Math.max(best, -6); return; }
        const gem = _edgeHas(_gems, node, n.to);
        const here = gem ? gem.v * 3 / (4 - depth + 1) : 0;
        best = Math.max(best, here + 0.7 * _valueOf(n.to, n, depth - 1, seen));
    });
    return best === -Infinity ? 0 : best;
}

function _botStep(slot, dt) {
    const c = _carts[slot], b = _bot[slot];
    if (c.stun > 0) return;
    const node = c.to, d = _approach(c);
    const cands = _cands(node, d);
    if (cands.length < 2) return;
    const depth = 2 + Math.round(_botSkill * 2);
    let want = cands[0], best = -Infinity;
    // Following the rival is worth nothing: they get there first.
    const rival = _carts[1 - slot];
    const theirs = rival.to === node ? _exitFor(node, _approach(rival)) : null;
    cands.forEach(n => {
        let v = _edgeHas(_tnt, node, n.to) ? -10 : 0;
        if (n === theirs && rival.stun <= 0) v -= 3;
        const gem = _edgeHas(_gems, node, n.to);
        if (gem) v += gem.v * 3;
        v += 0.7 * _valueOf(n.to, n, depth - 1);
        v += Math.random() * (1 - _botSkill) * 3;         // noise: easy guesses more
        if (v > best) { best = v; want = n; }
    });
    if (_exitFor(node, d) === want) { b.wait = 0; return; }
    b.wait += dt;
    if (b.wait > 0.55 - _botSkill * 0.4) { _flip(slot); b.wait = 0; }
}

// ── Input: a tap anywhere on your half ───────────────────────────────────────
function _onDown(e) {
    if (_done) return;
    e.preventDefault();
    const p = _stage.toLocal(e.clientX, e.clientY);
    const slot = p.y >= _stage.height / 2 ? 0 : 1;
    if (isBotSlot(slot)) return;
    _flip(slot);
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') _say('ROLL OUT!', 'TAP TO THROW YOUR SWITCH', READY_TIME * 1000);
    else if (phase === 'play') sfx('go');
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    if (_hud?.clearAt && _t > _hud.clearAt) _say('');
    if (_phase === 'ready' && _phaseT > READY_TIME) _enter('play');

    if (_phase === 'play') {
        _clock += dt;
        [0, 1].forEach(slot => { if (isBotSlot(slot)) _botStep(slot, dt); });
        _carts.forEach(c => {
            c.flip = Math.max(0, c.flip - dt);
            if (c.stun > 0) { c.stun -= dt; if (c.stun <= 0) c.anim?.play('ready'); return; }
            c.s += SPEED * dt;
            let L = _edgeLen(c.from, c.to);
            while (c.s >= L) {
                c.s -= L;
                const next = _exitFor(c.to, _approach(c));
                c.from = c.to; c.to = next.to;
                L = _edgeLen(c.from, c.to);
            }
        });
        // Nose to tail on one edge: the one behind is held back a cart's
        // length. It never passes through, so it has to peel off at a switch.
        {
            const [p, q] = _carts;
            if (p.from === q.from && p.to === q.to) {
                const back = p.s < q.s ? p : q, front = back === p ? q : p;
                if (front.s - back.s < 1.3) back.s = Math.max(0, front.s - 1.3);
            }
        }
        // Head on: two carts on one edge, facing, close.
        const [a, b] = _carts;
        // Only while they are CLOSING: after a bump both are reversed and
        // still side by side on the same edge, and without this they met
        // again the instant the stun wore off — two carts bouncing on one
        // edge for the rest of the match, which two bots found.
        if (a.stun <= 0 && b.stun <= 0 && a.from === b.to && a.to === b.from) {
            const L = _edgeLen(a.from, a.to);
            const closing = a.s + b.s < L;
            if (closing && L - (a.s + b.s) < 0.9) {
                [a, b].forEach(c => {
                    const f = c.from; c.from = c.to; c.to = f;
                    c.s = Math.min(L, L - c.s + 0.35);      // and a little apart
                    _crash(c, 'bump');
                });
            }
        }
        // Pickups and TNT.
        _carts.forEach(c => {
            if (c.stun > 0) return;
            const p = _posOf(c);
            for (let i = _gems.length - 1; i >= 0; i--) {
                const g = _gems[i];
                if (Math.hypot(g.x - p.x, g.z - p.z) < PICK_R) {
                    c.gems += g.v; _drop(g); _gems.splice(i, 1);
                    sfx(g.v >= 3 ? 'coin_gain' : 'land_good'); haptic([15]);
                    c.anim?.flinch();
                }
            }
            for (let i = _tnt.length - 1; i >= 0; i--) {
                const t = _tnt[i];
                if (Math.hypot(t.x - p.x, t.z - p.z) < PICK_R) {
                    _boom(t); _drop(t); _tnt.splice(i, 1);
                    _crash(c, 'tnt');
                    _tntDue.push(_clock + 1.8);     // in the loop, not a timer: R3
                }
            }
        });
        while (_gems.length < GEMS_LIVE) _spawnGem();
        _tntDue = _tntDue.filter(t => { if (_clock >= t) { _spawnTnt(); return false; } return true; });
        if (_clock >= MATCH_TIME) _end();
    }

    // Draw.
    _carts.forEach(c => {
        if (!c.group) return;
        const p = _posOf(c), d = _approach(c);
        c.group.position.set(p.x, c.stun > 0 ? Math.abs(Math.sin(_t * 18)) * 0.08 : 0, p.z);
        c.group.rotation.y = Math.atan2(d.dx, d.dz);
        const n = G.nodes[c.to], ex = _exitFor(c.to, d);
        c.ring.position.set(n.x, 0.06, n.z);
        c.ring.scale.setScalar(1 + c.flip * 2);
        c.route.position.set(n.x + ex.dx * 1.2, 0.07, n.z + ex.dz * 1.2);
        // The plane's long axis, laid flat, pointing along the exit.
        c.route.rotation.set(-Math.PI / 2, 0, Math.atan2(-ex.dx, -ex.dz));
    });
    _gems.forEach((g, i) => { if (g.mesh) { g.mesh.rotation.y += dt * 2; g.mesh.position.y = 0.7 + Math.sin(_t * 3 + i) * 0.1; } });
    _tnt.forEach(t => { if (t.fuse) t.fuse.scale.setScalar(0.8 + Math.abs(Math.sin(_t * 12)) * 0.6); });
    for (let i = _fx.length - 1; i >= 0; i--) {
        const f = _fx[i];
        f.t += dt; f.update(f.obj, f.t, dt);
        if (f.t >= f.life) { _stage?.scene?.remove(f.obj); f.obj.geometry?.dispose(); f.obj.material?.dispose(); _fx.splice(i, 1); }
    }
    _set?.update(dt, _t);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _playCam();
        _stage.camera.position.fromArray(c.pos);
        _stage.camera.lookAt(0, 0, 0);
        _stage.camera.userData.look = [0, 0, 0];
    }
    _renderHud();
}

function _end() {
    _phase = 'over';
    _say('');
    const [a, b] = _carts;
    const w = a.gems > b.gems ? 0 : b.gems > a.gems ? 1 : -1;
    _dir.close({
        winner: w, figs: _carts.filter(c => c.rig).map(c => ({ slot: c.slot, rig: c.rig, anim: c.anim })),
        sub: w < 0 ? `${a.gems} GEMS EACH` : `${_carts[w].gems} GEMS OUT OF THE MINE`,
        closeUp: (f, p) => {
            const end = f.slot === 0 ? 1 : -1;
            // Steep, so nothing on the track between the lens and the winner
            // (a crate, the other cart) gets in the shot.
            return { pos: [p.x + 1.2, p.y + 7.5, p.z + end * 4.2], look: [p.x, p.y + 0.5, p.z] };
        },
        onDone: () => _finish(w),
    });
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = w < 0 ? 'DRAW!' : `${_name(w)} WINS!`;
}

// ── HUD: a strip at each end, the far one turned ─────────────────────────────
function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _buildHud() {
    const root = _stage.hud;
    root.classList.add('bfont');
    const txt = 'color:#fff1dc;text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 12px rgba(0,0,0,.6);letter-spacing:2px;';
    _hud = { root, halves: [] };
    [0, 1].forEach(slot => {
        const half = document.createElement('div');
        half.style.cssText = 'position:absolute;left:0;right:0;height:50%;pointer-events:none;' +
            (slot === 0 ? 'bottom:0;' : 'top:0;transform:rotate(180deg);');
        const strip = document.createElement('div');
        const col = '#' + _css(slot).toString(16).padStart(6, '0');
        strip.style.cssText = 'position:absolute;left:50%;bottom:52px;transform:translateX(-50%);padding:3px 12px;' +
            `border-radius:14px;background:rgba(20,12,8,.72);border:2px solid ${col};white-space:nowrap;text-align:center;` + txt;
        const line = document.createElement('div'); line.style.fontSize = '15px';
        const hint = document.createElement('div'); hint.style.cssText = 'font-size:12px;opacity:.9;';
        hint.textContent = 'TAP · THROW YOUR NEXT SWITCH';
        strip.appendChild(line); strip.appendChild(hint);
        half.appendChild(strip);
        const bigBox = document.createElement('div');
        bigBox.style.cssText = 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;opacity:0;transition:opacity .2s;white-space:nowrap;' + txt;
        const big = document.createElement('div'); big.style.cssText = 'font-size:44px;display:inline-block;';
        const sub = document.createElement('div'); sub.style.fontSize = '15px';
        bigBox.appendChild(big); bigBox.appendChild(sub);
        half.appendChild(bigBox);
        root.appendChild(half);
        _hud.halves.push({ line, hint, bigBox, big, sub });
    });
}
function _say(msg, sub = '', ms = 0) {
    if (!_hud) return;
    _hud.halves.forEach(h => {
        h.big.textContent = msg; h.sub.textContent = sub;
        h.bigBox.style.opacity = msg ? '1' : '0';
        h.big.style.animation = 'none'; void h.big.offsetWidth;
        h.big.style.animation = msg ? 'countPop .35s ease' : 'none';
    });
    _hud.clearAt = ms ? _t + ms / 1000 : 0;
}
function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, Math.ceil(MATCH_TIME - _clock));
    _hud.halves.forEach((h, slot) => {
        const me = _carts[slot], them = _carts[1 - slot];
        h.line.textContent = `💎 ${me?.gems ?? 0} · ${left}s · THEM ${them?.gems ?? 0}`;
        if (_clock > 8) h.hint.style.display = 'none';
    });
    const n = document.getElementById('mg-neutral');
    if (n && _phase === 'play') n.textContent = `${left}s · ${_name(0)} ${_carts[0].gems} – ${_carts[1].gems} ${_name(1)}`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, clock: +_clock.toFixed(2), gems: _carts.map(c => c.gems), stun: _carts.map(c => +Math.max(0, c.stun).toFixed(2)),
        next: _carts.map(c => c.to), edge: _carts.map(c => [c.from, c.to]), why: _carts.map(c => c.lastCrash || null), spilled: _carts.map(c => c.spilled || 0),
        exit: _carts.map(c => _exitFor(c.to, _approach(c)).to), sw: _sw.slice(),
        tnt: _tnt.map(t => [t.a, t.b]), gemsOn: _gems.map(g => [g.a, g.b, g.v]),
        gl: !!_stage?.gl, turned: !!_stage?.turned,
    };
}
/** Probes: put TNT on an edge. */
export function _debugTnt(a, b) {
    _tnt.forEach(_drop); _tnt = [];
    const p = _mid(a, b);
    _tnt.push({ a, b, x: p.x, z: p.z, mesh: null });
}
/** Probes: hand a cart some gems. */
export function _debugGive(slot, n) { if (_carts[slot]) _carts[slot].gems += n; }
/** Probes: put a cart on an edge. */
export function _debugPut(slot, from, to, s) { const c = _carts[slot]; if (c) Object.assign(c, { from, to, s, stun: 0 }); }
