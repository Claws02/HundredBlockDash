// Vault Heist — the Financial District, ten past two in the morning.
//
// The third game on the shared 3D stage, and the roster's second asymmetric
// one (after Penalty). One player is the GUARD with a torch; the other is the
// THIEF. The thief comes in through their own door, gets to the vault at the
// guard's end, and has to get back out with the gold. Then they swap.
//
//   THIEF   drag to move. Gold only counts once you are back out of your own
//           door. The vault stack is worth 3; the cash bags on the desks are
//           worth 1 each. Everything you carry slows you down.
//   GUARD   drag to move; the torch points the way you walk. Hold the thief
//           in the beam for a full second and they are caught with nothing.
//           Walking into them only shoves them — the thief is faster, so the
//           guard has to aim the light, not win a footrace. Columns and the teller counter block the
//           beam — which is exactly where a good thief will be.
//
// Two rounds, one in each role. Most gold banked wins; level on gold, the
// faster escape wins.
//
// THE HOLD
//   FACE-OFF, flat on the table: P1 at the bottom edge, P2 at the top. The
//   camera looks almost straight down, tilted slightly from the long side, so
//   neither end is favoured and a drag on the glass moves your figure the
//   same way across the floor for both players (screen space IS the floor —
//   the Light Cycles lesson in MINIGAME_STANDARD R1a).
//
// STRUCTURAL CEILING
//   Each round is on a ROUND_TIME clock, and the match is exactly two rounds.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, seatFor } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const ROUND_TIME   = 20;
const BRIEF_TIME   = 1.8;
const RESULT_TIME  = 2.0;
const THIEF_SPEED  = 5.2;
const GUARD_SPEED  = 3.8;
const CARRY_SLOW   = 0.045;     // per unit of loot carried
const BEAM_HALF    = 24 * Math.PI / 180;
const BEAM_RANGE   = 5.8;
const SPOT_FILL    = 1.0;       // s of unbroken light to be caught
const SPOT_DRAIN   = 0.9;       // s to cool off completely
const BODY_R       = 0.45;
const PICK_DIST    = 0.95;
const STICK_PX     = 55;        // a full-speed drag
const FIG_SCALE    = 1.4;

// The room. Walls at ±w/2, ±d/2; P1's door is at +z (the bottom of the glass).
const L = {
    w: 12, d: 24, exit: 1.6,
    // The thieves' doors are the two corners of their own end, either side of
    // that end's vault — the vault stands between them.
    doorX: 4.1, doorHalf: 1.7,
    pillars: [
        { x: -3.6, z: -4.6, r: 0.62 }, { x: 3.6, z: -4.6, r: 0.62 },
        { x: -3.6, z: 4.6, r: 0.62 }, { x: 3.6, z: 4.6, r: 0.62 },
    ],
    // The teller counter. Short enough that the lanes either side are wide
    // enough to dodge in: at 5.2 wide it made two chokepoints and a guard in
    // the middle reached either one first.
    boxes: [{ x: 0, z: 0, w: 3.2, d: 0.9 }],
    vaults: [{ x: 0, z: -9.6, face: 1 }, { x: 0, z: 9.6, face: -1 }],
    // Spread out on purpose. With one prize in a dead end the guard just stood
    // in front of the vault and caught everything; three kinds of loot in
    // three places means the guard has to choose what to cover.
    loot: [
        { kind: 'bar', x: 0, z: -9.9, v: 3, vault: 0 },
        { kind: 'bar', x: 0, z: 9.9, v: 3, vault: 1 },
        { kind: 'box', x: -5.1, z: -7.2, v: 2, vault: 0 },
        { kind: 'box', x: 5.1, z: -7.2, v: 2, vault: 0 },
        { kind: 'box', x: -5.1, z: 7.2, v: 2, vault: 1 },
        { kind: 'box', x: 5.1, z: 7.2, v: 2, vault: 1 },
        { kind: 'bag', x: -4.7, z: -1.7, v: 1 },
        { kind: 'bag', x: 4.7, z: 1.7, v: 1 },
    ],
};
// Vault walls collide and block the beam like any wall.
const WALLS = [...L.boxes];
L.vaults.forEach(v => {
    WALLS.push({ x: v.x, z: v.z - v.face * 1.4, w: 4.4, d: 0.4 });
    WALLS.push({ x: v.x - 2.0, z: v.z, w: 0.4, d: 2.8 });
    WALLS.push({ x: v.x + 2.0, z: v.z, w: 0.4, d: 2.8 });
});

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null;
let _figs = [];              // per slot: { slot, rig, anim, torch, sack, x, z, vx, vz, face }
let _round = 0;              // 1 or 2
let _thief = 0;              // slot playing the thief this round
let _phase = 'intro', _phaseT = 0, _t = 0;
let _clock = 0;
let _banked = [0, 0];
let _escapeT = [Infinity, Infinity];
let _carry = 0;              // loot value the thief holds
let _taken = [];             // loot indices taken this round
let _suspicion = 0;
let _result = null;          // { kind: 'caught'|'escaped'|'time', value }
let _stick = [];             // per slot: { pid, ax, ay, dx, dy }
let _bot = [];
let _spot = null, _fan = null, _ring = null;
let _dirOwns = false;

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _figs = []; _round = 0; _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0;
    _banked = [0, 0]; _escapeT = [Infinity, Infinity]; _result = null;
    _stick = [0, 1].map(() => ({ pid: null, ax: 0, ay: 0, dx: 0, dy: 0 }));
    _bot = [0, 1].map(() => ({ plan: 0, tx: 0, tz: 0, side: 1, stage: 'in' }));
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#05070d;z-index:5;';
    mg.appendChild(_overlay);

    _stage = createStage(_overlay, { hold: 'faceoff', fov: 38, background: 0x05070d });
    _buildHud();
    _dir = createDirector(_stage);
    if (_stage.gl) {
        // Screen-up is the far (P2) end for every shot in this game, the
        // opening and the verdict included. A camera pitched down reads the
        // right way up from whichever end it stands at: from P1's end the
        // picture is upright on the glass, from P2's end it comes out upside
        // down on the glass — which is upright for P2, sitting at the top.
        _stage.camera.up.set(0, 0, -1);
        _set = STAGE_SETS.fin(_stage, L);
        _buildTorch();
        for (let slot = 0; slot < 2; slot++) _figs.push(_buildFigure(slot));
    } else {
        _figs = [0, 1].map(slot => ({ slot, x: 0, z: 0, vx: 0, vz: 0, face: 0 }));
    }

    _stage.listen('pointerdown', _onDown);
    _stage.listen('pointermove', _onMove);
    _stage.listen('pointerup', _onUp);
    _stage.listen('pointercancel', _onUp);
    _stage.onResize(() => _layoutHud());

    _setupRound(1);
    const play = _playCam();
    _dir.open({
        place: 'FINANCIAL DISTRICT · 2:10 AM', title: 'VAULT HEIST',
        sub: 'ONE GUARDS · ONE STEALS · THEN SWAP',
        from: { pos: [7, 9, 17], look: [0, 0.5, -4] },
        to: play,
        onDone: () => { if (!_done) _enter('brief'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _figs = []; _set = null; _dir = null; _hud = null; _spot = null; _fan = null; _ring = null;
}

function _finish(winner) {
    if (_done) return;                           // R6
    _destroy();
    _onWin?.(winner);
}

// ── Scene pieces ─────────────────────────────────────────────────────────────
function _playCam() {
    // Near-overhead, leaning in from the +x long side so neither END is favoured.
    const fov = (_stage?.camera?.fov ?? 38) * Math.PI / 180;
    const aspect = (_stage?.width || 412) / Math.max(1, _stage?.height || 892);
    const t = Math.tan(fov / 2);
    const h = Math.max((L.d + 2.4) / (2 * t), (L.w + 1.6) / (2 * t * aspect));
    const tilt = 0.3;
    return { pos: [h * Math.sin(tilt), h * Math.cos(tilt), 0], look: [0, 0, 0] };
}

function _buildTorch() {
    _spot = new THREE.SpotLight(0xfff1c4, 2.4, BEAM_RANGE + 3, BEAM_HALF, 0.35, 1.2);
    _spot.castShadow = true;
    _spot.shadow.mapSize.set(512, 512);
    _spot.shadow.camera.near = 0.5;
    _stage.add(_spot);
    _stage.add(_spot.target);
    // The beam drawn on the floor, so it reads on any screen whatever the light
    // does: a fan the size and shape of what the guard can actually see.
    _fan = new THREE.Mesh(new THREE.CircleGeometry(BEAM_RANGE, 28, -BEAM_HALF, BEAM_HALF * 2),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.16, depthWrite: false }));
    _fan.rotation.x = -Math.PI / 2;
    _fan.position.y = 0.03;
    _stage.add(_fan);
    // The suspicion ring around the thief's feet.
    _ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 28),
        new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    _ring.rotation.x = -Math.PI / 2;
    _ring.position.y = 0.04;
    _stage.add(_ring);
}

function _buildFigure(slot) {
    const c = _stage.character(slot);
    c.rig.root.scale.setScalar(FIG_SCALE);
    // Both props on both figures; the round decides which one shows.
    const torch = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.45, 10),
        new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.4, metalness: 0.7 }));
    body.rotation.x = Math.PI / 2; torch.add(body);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.1, 12),
        new THREE.MeshBasicMaterial({ color: 0xfff4c8 }));
    lens.rotation.x = Math.PI / 2; lens.position.z = 0.26; torch.add(lens);
    c.rig.hold(1, torch);
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 }));
    sack.position.set(0, -0.1, -0.15);
    c.rig.hold(-1, sack);
    return Object.assign(c, { torch, sack, x: 0, z: 0, vx: 0, vz: 0, face: 0 });
}

// ── Rounds ───────────────────────────────────────────────────────────────────
// P1's door is at +z. Round 1: P1 steals, so the vault in play is P2's (-z).
const _doorZ = slot => (slot === 0 ? 1 : -1) * (L.d / 2 - 1);
const _isGuard = slot => slot !== _thief;

function _setupRound(n) {
    _round = n;
    _thief = n === 1 ? 0 : 1;
    const guard = 1 - _thief;
    _carry = 0; _taken = []; _suspicion = 0; _clock = 0; _result = null;
    _bot = [0, 1].map(() => ({ plan: 0, tx: 0, tz: 0, side: Math.random() < 0.5 ? -1 : 1, stage: 'in', greedy: Math.random() < 0.3 + _botSkill * 0.4 }));
    _figs.forEach(f => {
        const thief = f.slot === _thief;
        f.x = thief ? (Math.random() < 0.5 ? -1 : 1) * L.doorX : 0;
        f.z = thief ? _doorZ(f.slot) : _doorZ(guard) - Math.sign(_doorZ(guard)) * 5.2;
        f.vx = f.vz = 0;
        // Face into the room.
        f.face = thief ? (f.z > 0 ? Math.PI : 0) : (f.z > 0 ? Math.PI : 0);
        if (f.rig) {
            f.rig.root.position.set(f.x, 0, f.z);
            f.anim.face(f.face, true);
            f.anim.play('idle', { restart: true });
            f.torch.visible = !thief;
            f.sack.visible = thief;
            f.sack.scale.setScalar(0.6);
        }
    });
    // Loot: this round's vault and the desk bags.
    const vaultInPlay = _thief === 0 ? 0 : 1;
    _lootActive = L.loot.map(l => l.vault === undefined || l.vault === vaultInPlay);
    _set?.loot.forEach((g, i) => { g.visible = _lootActive[i]; });
}
let _lootActive = [];

function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'brief') {
        const t = _name(_thief), g = _name(1 - _thief);
        _say(`ROUND ${_round}`, `${t} STEALS · ${g} GUARDS`, BRIEF_TIME * 1000);
        _neutral();
    } else if (phase === 'play') {
        _say('');
        sfx('go');
    } else if (phase === 'result') {
        const r = _result;
        const t = _thief;
        if (r.kind === 'escaped') {
            _banked[t] += r.value;
            _escapeT[t] = _clock;
            _say(`${_name(t)} GOT OUT`, `+${r.value} GOLD`, RESULT_TIME * 1000);
            sfx('coin_gain');
            _figs[t]?.anim?.play('victory');
        } else if (r.kind === 'caught') {
            _say(`CAUGHT!`, `${_name(1 - t)} KEEPS THE VAULT`, RESULT_TIME * 1000);
            sfx('land_bad'); haptic([80, 40, 80]);
            _figs[t]?.anim?.flinch();
            _figs[t]?.anim?.play('defeat');
            _figs[1 - t]?.anim?.play('aim');
        } else {
            _say('TIME', 'THE ALARM BEAT THEM', RESULT_TIME * 1000);
            sfx('land_bad');
            _figs[t]?.anim?.play('defeat');
        }
        _neutral();
    }
}

function _endMatch() {
    _phase = 'over';
    _say('');
    let w;
    if (_banked[0] !== _banked[1]) w = _banked[0] > _banked[1] ? 0 : 1;
    else if (_banked[0] > 0 && _escapeT[0] !== _escapeT[1]) w = _escapeT[0] < _escapeT[1] ? 0 : 1;
    else w = -1;
    const figs = _figs.filter(f => f.rig);
    _dir.close({
        winner: w, figs,
        sub: w < 0 ? 'THE BANK KEEPS IT ALL' : `${_banked[w]} GOLD BANKED`,
        // Shoot the winner from their own end of the table, so the moment
        // reads the right way up for the person it belongs to.
        closeUp: (f, p) => {
            const end = f.slot === 0 ? 1 : -1;
            // Wide enough that the bank is in the shot: a portrait frame makes
            // any close-up tight.
            return { pos: [p.x + 2, p.y + 7.5, p.z + end * 11.5], look: [p.x, p.y + 1.0, p.z] };
        },
        onDone: () => _finish(w),
    });
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = w < 0 ? 'DRAW!' : `${_name(w)} WINS!`;
}

// ── Input: a floating stick on your own half ─────────────────────────────────
function _slotAt(p) { return p.y >= _stage.height / 2 ? 0 : 1; }

function _onDown(e) {
    if (_done) return;
    e.preventDefault();
    const p = _stage.toLocal(e.clientX, e.clientY);
    const slot = _slotAt(p);
    if (isBotSlot(slot) || _stick[slot].pid !== null) return;
    Object.assign(_stick[slot], { pid: e.pointerId, ax: p.x, ay: p.y, dx: 0, dy: 0 });
}
function _onMove(e) {
    if (_done) return;
    const s = _stick.find(x => x.pid === e.pointerId);
    if (!s) return;
    const p = _stage.toLocal(e.clientX, e.clientY);
    let dx = p.x - s.ax, dy = p.y - s.ay;
    const len = Math.hypot(dx, dy);
    // Floating: drag past the edge of the stick and the stick follows.
    if (len > STICK_PX) { s.ax = p.x - dx / len * STICK_PX; s.ay = p.y - dy / len * STICK_PX; dx = dx / len * STICK_PX; dy = dy / len * STICK_PX; }
    s.dx = dx; s.dy = dy;
}
function _onUp(e) {
    const s = _stick.find(x => x.pid === e.pointerId);
    if (s) Object.assign(s, { pid: null, dx: 0, dy: 0 });
}

// ── Geometry ─────────────────────────────────────────────────────────────────
function _atDoor(f, slot) {
    return Math.sign(f.z) === Math.sign(_doorZ(slot)) && Math.abs(f.z) > L.d / 2 - L.exit
        && Math.abs(Math.abs(f.x) - L.doorX) < L.doorHalf;
}

function _collide(f) {
    const W = L.w / 2 - BODY_R, D = L.d / 2 - BODY_R;
    f.x = Math.max(-W, Math.min(W, f.x));
    f.z = Math.max(-D, Math.min(D, f.z));
    L.pillars.forEach(p => {
        const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz), min = p.r + BODY_R;
        if (d < min && d > 1e-4) { f.x = p.x + dx / d * min; f.z = p.z + dz / d * min; }
    });
    WALLS.forEach(b => {
        const hx = b.w / 2 + BODY_R, hz = b.d / 2 + BODY_R;
        const dx = f.x - b.x, dz = f.z - b.z;
        if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
            const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
            if (px < pz) f.x = b.x + Math.sign(dx || 1) * hx; else f.z = b.z + Math.sign(dz || 1) * hz;
        }
    });
}

function _segBlocked(ax, az, bx, bz) {
    for (const p of L.pillars) {
        const vx = bx - ax, vz = bz - az, wx = p.x - ax, wz = p.z - az;
        const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz || 1)));
        if (Math.hypot(ax + vx * t - p.x, az + vz * t - p.z) < p.r) return true;
    }
    for (const b of WALLS) {
        // Slab test against the box's footprint.
        let t0 = 0, t1 = 1;
        const d = [bx - ax, bz - az], o = [ax, az], mn = [b.x - b.w / 2, b.z - b.d / 2], mx = [b.x + b.w / 2, b.z + b.d / 2];
        let hit = true;
        for (let i = 0; i < 2; i++) {
            if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) { hit = false; break; } continue; }
            let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit) return true;
    }
    return false;
}

function _inBeam(g, t) {
    const dx = t.x - g.x, dz = t.z - g.z, d = Math.hypot(dx, dz);
    if (d > BEAM_RANGE || d < 0.01) return false;
    const fx = Math.sin(g.face), fz = Math.cos(g.face);
    const cos = (dx * fx + dz * fz) / d;
    if (cos < Math.cos(BEAM_HALF)) return false;
    return !_segBlocked(g.x, g.z, t.x, t.z);
}

// ── Bots (§5) ────────────────────────────────────────────────────────────────
// The guard chases where the thief is GOING and keeps its torch on them; the
// thief takes the lane away from the guard, ducks behind columns when the beam
// swings its way, and gets greedier the better it is.
function _steer(f, tx, tz) {
    let dx = tx - f.x, dz = tz - f.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // Push off anything close ahead.
    L.pillars.forEach(p => {
        const ox = f.x - p.x, oz = f.z - p.z, od = Math.hypot(ox, oz);
        if (od < p.r + 1.3) { dx += ox / od * 0.9; dz += oz / od * 0.9; }
    });
    const m = Math.hypot(dx, dz) || 1;
    return { dx: dx / m, dz: dz / m, dist: d };
}

function _botMove(slot, dt) {
    const f = _figs[slot], b = _bot[slot];
    const other = _figs[1 - slot];
    b.plan -= dt;
    const open = L.loot.map((l, i) => i).filter(i => _lootActive[i] && !_taken.includes(i));
    if (_isGuard(slot)) {
        if (b.plan <= 0) {
            b.plan = 0.75 - _botSkill * 0.45 + Math.random() * 0.15;
            const d = Math.hypot(other.x - f.x, other.z - f.z);
            // Chase only what it can see: in range and not behind a column.
            // A guard that tracked a loaded thief across the whole floor, walls
            // or not, ran every round out to the clock.
            if (d < 6 && !_segBlocked(f.x, f.z, other.x, other.z)) {
                // Chase where they are going, not where they are.
                const lead = 0.25 + _botSkill * 0.35;
                b.tx = other.x + other.vx * lead; b.tz = other.z + other.vz * lead;
            } else {
                // Cover the loot the thief is closest to.
                let best = null, bd = Infinity;
                open.forEach(i => {
                    const l = L.loot[i], dd = Math.hypot(l.x - other.x, l.z - other.z);
                    if (dd < bd) { bd = dd; best = l; }
                });
                if (best) { b.tx = best.x * 0.7; b.tz = best.z * 0.75; }
            }
        }
        const s = _steer(f, b.tx, b.tz);
        const speed = s.dist < 1.6 ? 0.3 : (0.7 + 0.3 * _botSkill);
        return { dx: s.dx * speed, dz: s.dz * speed };
    }
    // Thief: choose loot the guard is not standing on, take enough, get out.
    const door = _doorZ(slot), toward = -Math.sign(door);
    const guard = other;
    if (b.plan <= 0) {
        b.plan = 0.5;
        if (Math.abs(f.z) > 3.2) b.side = guard.x > 0.5 ? -1 : guard.x < -0.5 ? 1 : b.side;
        const want = b.greedy ? 4 : 3;
        // Watch the clock: with loot in hand and the time running down, leave.
        const late = ROUND_TIME - _clock < 8 - _botSkill * 2;
        if (b.stage === 'in' && (_carry >= want || (late && _carry > 0))) b.stage = 'out';
        if (b.stage === 'in') {
            let best = null, bs = -Infinity;
            open.forEach(i => {
                const l = L.loot[i];
                const gd = Math.hypot(l.x - guard.x, l.z - guard.z);
                const md = Math.hypot(l.x - f.x, l.z - f.z);
                const sc = l.v * 2 - md * 0.25 - (gd < 3.8 ? 8 : 0);
                if (sc > bs) { bs = sc; best = i; }
            });
            if (best === null || bs < -3) b.stage = _carry > 0 ? 'out' : 'in';
            b.goal = best;
        }
    }
    let tx = f.x, tz = f.z;
    const laneX = b.side * 3.9;
    const onFar = Math.sign(f.z) === toward && Math.abs(f.z) > 0.6;
    if (b.stage === 'in') {
        const l = b.goal != null && !_taken.includes(b.goal) ? L.loot[b.goal] : null;
        if (!onFar) { tx = laneX; tz = toward * 1.4; }
        else if (l) { tx = l.x; tz = l.z; }
        else b.plan = 0;
    }
    if (b.stage === 'out') {
        const home = Math.sign(f.z) === Math.sign(door) && Math.abs(f.z) > 0.6;
        if (!home) { tx = laneX; tz = Math.sign(door) * 1.4; }
        else {
            // The nearer door, unless the guard is standing in it.
            let dx = (Math.sign(f.x) || b.side) * L.doorX;
            if (Math.hypot(guard.x - dx, guard.z - door) < 2.6) dx = -dx;
            tx = dx; tz = door + Math.sign(door);
        }
    }
    const s = _steer(f, tx, tz);
    // Keep away from the guard, and above all from the space in front of the
    // torch: a push straight away from them, strongest up close, plus a push
    // sideways out of the beam's axis when they are facing us. A thief that
    // only side-stepped once lit walked head-on into every guard.
    const gx = f.x - guard.x, gz = f.z - guard.z, gd = Math.hypot(gx, gz) || 1;
    let ax = s.dx, az = s.dz;
    const near = 2.6 + _botSkill * 1.6;
    if (gd < near) {
        const w = (near - gd) / near * (1.2 + _botSkill * 1.4);
        ax += gx / gd * w; az += gz / gd * w;
    }
    // The whole reach of the beam, not just close range: step off its axis.
    const reach = BEAM_RANGE + 0.8;
    const fx = Math.sin(guard.face), fz = Math.cos(guard.face);
    const facing = (gx * fx + gz * fz) / gd;
    if (gd < reach && facing > 0.55) {
        const w = (reach - gd) / reach * (1.0 + _botSkill * 2.0) + (_suspicion > 0.2 ? 0.8 : 0);
        const side = Math.sign(gx * fz - gz * fx) || 1;     // which side of the beam's axis we are on
        ax += fz * side * w; az += -fx * side * w;
    }
    const m = Math.hypot(ax, az) || 1;
    const out = { dx: ax / m, dz: az / m };
    const speed = 0.8 + 0.2 * _botSkill;
    return { dx: out.dx * speed, dz: out.dz * speed };
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    if (_hud?.clearAt && _t > _hud.clearAt) _say('');

    if (_phase === 'brief' && _phaseT > BRIEF_TIME) _enter('play');
    else if (_phase === 'result' && _phaseT > RESULT_TIME) {
        if (_round === 1) { _setupRound(2); _enter('brief'); }
        else _endMatch();
    }

    if (_phase === 'play') {
        _clock += dt;
        const thief = _figs[_thief], guard = _figs[1 - _thief];
        [0, 1].forEach(slot => {
            const f = _figs[slot];
            let mv;
            if (isBotSlot(slot)) mv = _botMove(slot, dt);
            else {
                const s = _stick[slot];
                const m = Math.hypot(s.dx, s.dy) / STICK_PX;
                mv = m > 0.12 ? { dx: s.dx / STICK_PX, dz: s.dy / STICK_PX } : { dx: 0, dz: 0 };
            }
            const base = _isGuard(slot) ? GUARD_SPEED : THIEF_SPEED * Math.max(0.62, 1 - CARRY_SLOW * _carry);
            f.vx = mv.dx * base; f.vz = mv.dz * base;
            f.x += f.vx * dt; f.z += f.vz * dt;
            _collide(f);
            const moving = Math.hypot(mv.dx, mv.dz) > 0.1;
            if (moving) {
                const want = Math.atan2(mv.dx, mv.dz);
                let d = want - f.face; d = Math.atan2(Math.sin(d), Math.cos(d));
                // The torch swings slowly. A beam that snapped to wherever the
                // guard pushed caught everything in five seconds; one with
                // weight gives a thief the moment to cut behind a column.
                const rate = (_isGuard(slot) ? 3.4 : 9) * dt;
                f.face += Math.abs(d) < rate ? d : Math.sign(d) * rate;
            }
            if (f.rig) {
                f.rig.root.position.set(f.x, 0, f.z);
                f.anim.face(f.face, true);
                f.anim.play(moving ? 'walk' : (_isGuard(slot) ? 'aim' : 'ready'), { rate: 3.2 });
            }
        });

        // Loot.
        L.loot.forEach((l, i) => {
            if (!_lootActive[i] || _taken.includes(i)) return;
            if (Math.hypot(thief.x - l.x, thief.z - l.z) < PICK_DIST + (l.kind === 'bar' ? 0.4 : 0)) {
                _taken.push(i); _carry += l.v;
                if (_set) _set.loot[i].visible = false;
                sfx('coin_gain'); haptic([25]);
                if (thief.sack) thief.sack.scale.setScalar(0.6 + _carry * 0.14);
            }
        });

        // The beam, and being caught.
        const seen = _inBeam(guard, thief);
        _suspicion = seen ? Math.min(1, _suspicion + dt / SPOT_FILL) : Math.max(0, _suspicion - dt / SPOT_DRAIN);
        // Bodies do not pass through each other; they shove apart. Being walked
        // into is not being caught — the torch is the only way to catch, and
        // the thief is faster, so a guard has to aim rather than chase. With a
        // tag as well, the guard won nearly every round.
        const bx = thief.x - guard.x, bz = thief.z - guard.z, bd = Math.hypot(bx, bz);
        if (bd < BODY_R * 2 && bd > 1e-4) {
            const push = (BODY_R * 2 - bd) / 2;
            thief.x += bx / bd * push; thief.z += bz / bd * push;
            guard.x -= bx / bd * push; guard.z -= bz / bd * push;
            _collide(thief); _collide(guard);
        }
        if (_suspicion >= 1) { _result = { kind: 'caught', value: 0, by: 'beam' }; _enter('result'); }
        else if (_carry > 0 && _atDoor(thief, _thief)) {
            _result = { kind: 'escaped', value: _carry }; _enter('result');
        } else if (_clock >= ROUND_TIME) { _result = { kind: 'time', value: 0 }; _enter('result'); }
    }

    // Torch, fan and ring follow the guard and thief.
    if (_stage?.gl && _figs[0]?.rig) {
        const guard = _figs[1 - _thief], thief = _figs[_thief];
        const fx = Math.sin(guard.face), fz = Math.cos(guard.face);
        _spot.position.set(guard.x + fx * 0.4, 2.2, guard.z + fz * 0.4);
        _spot.target.position.set(guard.x + fx * 5, 0, guard.z + fz * 5);
        _fan.position.set(guard.x, 0.03, guard.z);
        _fan.rotation.z = guard.face - Math.PI / 2;
        const hot = _suspicion > 0.02;
        _fan.material.color.setHex(hot ? 0xff9a3c : 0xffe9a8);
        _fan.material.opacity = _phase === 'play' ? (hot ? 0.24 : 0.16) : 0.08;
        _ring.position.set(thief.x, 0.04, thief.z);
        _ring.material.opacity = _phase === 'play' ? 0.25 + _suspicion * 0.7 : 0;
        _ring.material.color.setHex(_suspicion > 0.5 ? 0xff3b3b : 0xffb020);
        _ring.scale.setScalar(1 + (1 - _suspicion) * 0.4);
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

// ── HUD: one strip per player, at their own end, the far one turned ──────────
function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _css(slot) {
    const c = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return '#' + c.toString(16).padStart(6, '0');
}

function _buildHud() {
    const root = _stage.hud;
    root.classList.add('bfont');
    const txt = 'color:#f4f1ff;text-shadow:0 2px 0 rgba(0,0,0,.6),0 0 12px rgba(0,0,0,.6);letter-spacing:2px;';
    _hud = { root, halves: [] };
    [0, 1].forEach(slot => {
        const half = document.createElement('div');
        // Inset past the manager's status pills at the outer edge (R1b).
        half.style.cssText = 'position:absolute;left:0;right:0;height:50%;pointer-events:none;' +
            (slot === 0 ? 'bottom:0;' : 'top:0;transform:rotate(180deg);');
        const strip = document.createElement('div');
        strip.style.cssText = 'position:absolute;left:50%;bottom:58px;transform:translateX(-50%);padding:6px 14px;' +
            `border-radius:14px;background:rgba(8,10,20,.7);border:2px solid ${_css(slot)};white-space:nowrap;text-align:center;` + txt;
        const role = document.createElement('div'); role.style.fontSize = '18px';
        const info = document.createElement('div'); info.style.cssText = 'font-size:14px;opacity:.9;';
        strip.appendChild(role); strip.appendChild(info);
        half.appendChild(strip);
        const bigBox = document.createElement('div');
        bigBox.style.cssText = 'position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;opacity:0;transition:opacity .2s;white-space:nowrap;' + txt;
        const big = document.createElement('div'); big.style.cssText = 'font-size:46px;display:inline-block;';
        const sub = document.createElement('div'); sub.style.fontSize = '17px';
        bigBox.appendChild(big); bigBox.appendChild(sub);
        half.appendChild(bigBox);
        root.appendChild(half);
        _hud.halves.push({ role, info, bigBox, big, sub });
    });
}
function _layoutHud() {}

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
    const left = Math.max(0, ROUND_TIME - _clock);
    _hud.halves.forEach((h, slot) => {
        const thief = slot === _thief;
        h.role.textContent = thief ? '💰 THIEF · GRAB IT, GET OUT' : '🔦 GUARD · LIGHT THEM UP';
        h.info.textContent = `BANKED ${_banked[slot]} · ${thief ? `CARRYING ${_carry}` : 'SPOTTED ' + Math.round(_suspicion * 100) + '%'}`;
    });
    if (_phase === 'play') _neutral();
}

function _neutral() {
    const n = document.getElementById('mg-neutral');
    if (!n) return;
    n.textContent = `R${_round} · ${Math.ceil(Math.max(0, ROUND_TIME - _clock))}s · ${_name(0)} ${_banked[0]} – ${_banked[1]} ${_name(1)}`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, round: _round, thief: _thief, clock: +_clock.toFixed(2), banked: _banked.slice(),
        carry: _carry, taken: _taken.slice(), suspicion: +_suspicion.toFixed(2),
        pos: _figs.map(f => [+f.x.toFixed(2), +f.z.toFixed(2)]), result: _result,
        gl: !!_stage?.gl, turned: !!_stage?.turned, quality: _stage?.quality ? { ..._stage.quality } : null,
        cam: _stage?.camera ? _stage.camera.position.toArray().map(v => +v.toFixed(2)) : null,
        figs: _figs.filter(f => f.rig).map(f => f.rig.root.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(2))),
    };
}
/** Probes: put a figure somewhere, facing somewhere, and stop it. */
export function _debugPlace(slot, x, z, face) {
    const f = _figs[slot];
    if (!f) return;
    f.x = x; f.z = z; f.face = face; f.vx = f.vz = 0;
    if (f.rig) { f.rig.root.position.set(x, 0, z); f.anim.face(face, true); }
}
