// ============================================================
// MUSICAL CHAIRS — round the chairs in the fountain park.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Face-off hold, seen from above. Both players' characters and three park-goers
// circle a ring of chairs while the band plays: five walkers, four chairs.
//
//   When the music STOPS, DRAG on your half to run for a chair. Reach a free
//   one and you sit.
//
// Whoever is left standing is out, and a chair goes. The first player out
// loses. Outlast the park-goers and the last round is the two of you and one
// chair.
//
// Fake-outs: the music dips and the lanterns flicker, but the walking goes on.
// Running before the real stop is a false start: frozen for a moment. The
// stop never depends on the sound: the walkers halt, the lanterns go out and
// SIT! goes up for both ends.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic, mgMusic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, faceoffHud, touch, effects, overheadCam } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const W = 10, D = 13;               // the lawn the camera frames
const NPCS = 3;                    // park-goers; chairs start at walkers − 1
const RC = 2.1;                    // chair ring radius
const RW = 3.8;                    // walking circle radius
const OMEGA = 0.6;                 // rad/s round the circle
const MUSIC_MIN = 3.5, MUSIC_MAX = 8;
const RUN = 5.0;                   // a player's sprint, units/s
const NPC_RUN = 3.5;
const REACT_MIN = 0.35, REACT_SPREAD = 0.55;   // park-goers' reaction to the stop
const FREEZE = 1.2;                // s frozen for a false start
const SCRAMBLE_MAX = 7;            // s before a stalled scramble is called
const RESULT = 1.9;
const SIT_R = 0.55, BODY = 0.34;
const FIG_SCALE = 0.95;
const CHAIR_SCALE = 1.55;
const NPC_TYPES = ['cabbie', 'vendor', 'banker', 'investor', 'bodyguard'];
const NPC_COLS = [0x9ca3af, 0xd6b98c, 0x8fb3c9];

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null, _in = null, _fx = null;
let _walkers = [], _chairs = [], _dips = [], _out = null;
let _phase = 'intro', _sub = '', _subT = 0, _t = 0, _round = 0, _musicLen = 5, _flicker = 0;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _sub = ''; _subT = 0; _t = 0; _round = 0; _out = null; _dips = []; _flicker = 0;
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
    }
    // Players first (slots 0, 1), then the park-goers.
    const n = 2 + NPCS;
    _walkers = [];
    for (let i = 0; i < n; i++) _walkers.push(_buildWalker(i, i < 2 ? i : -1, (i / n) * Math.PI * 2 + (i === 1 ? Math.PI / n : 0)));
    _chairs = [];
    for (let i = 0; i < n - 1; i++) _chairs.push(_buildChair((i / (n - 1)) * Math.PI * 2));
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'WHEN THE MUSIC STOPS · DRAG TO A CHAIR'));

    _dir.open({
        place: 'CITY RING ROAD · THE FOUNTAIN PARK', title: 'MUSICAL CHAIRS',
        sub: 'DON’T BE LEFT STANDING',
        from: { pos: [7, 7, 11], look: [0, 0, 0] },
        to: overheadCam(_stage, W, D, 7),
        onDone: () => { if (!_done) { _phase = 'play'; _nextRound(); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    mgMusic('off');
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _walkers = []; _chairs = []; _set = null; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// ── Walkers and chairs ───────────────────────────────────────────────────────
function _buildWalker(i, slot, theta) {
    const w = { i, slot, human: slot >= 0, theta, x: Math.cos(theta) * RW, z: Math.sin(theta) * RW,
                face: 0, seated: -1, out: false, frozen: 0, react: 0, tx: 0, tz: 0, moving: false };
    if (!_stage.gl) return w;
    const c = slot >= 0 ? _stage.character(slot) : _stage.figure(NPC_TYPES[(i * 2) % NPC_TYPES.length], NPC_COLS[(i - 2) % NPC_COLS.length]);
    c.rig.root.scale.setScalar(slot >= 0 ? FIG_SCALE : FIG_SCALE * 0.92);
    Object.assign(w, { rig: c.rig, anim: c.anim });
    return w;
}

function _buildChair(angle) {
    const ch = { a: angle, ta: angle, by: -1, mesh: null };
    if (!_stage.gl) return ch;
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.6 });
    const leg = new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.4, metalness: 0.5 });
    const seatM = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.62), wood); seatM.position.y = 0.5; g.add(seatM);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.62, 0.08), wood); back.position.set(0, 0.85, -0.28); g.add(back);
    [[-0.3, -0.26], [0.3, -0.26], [-0.3, 0.26], [0.3, 0.26]].forEach(([x, z]) => {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), leg); l.position.set(x, 0.25, z); g.add(l);
    });
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(CHAIR_SCALE);
    _stage.add(g);
    ch.mesh = g; ch.wood = wood;
    _placeChair(ch);
    return ch;
}
function _placeChair(ch) {
    if (!ch.mesh) return;
    // Seat facing outward: the back to the middle of the ring.
    ch.mesh.position.set(Math.cos(ch.a) * RC, 0, Math.sin(ch.a) * RC);
    ch.mesh.rotation.y = Math.atan2(Math.cos(ch.a), Math.sin(ch.a));
}
const _spot = ch => ({ x: Math.cos(ch.a) * (RC + 0.15), z: Math.sin(ch.a) * (RC + 0.15) });
// A taken chair wears its sitter's colour, so who is seated reads from above.
const _paintChair = (ch, w) => { if (ch.wood) ch.wood.color.setHex(w ? (w.human ? seat(w.slot).color : 0x9ca3af) : 0xf5f0e6); };

// ── Rounds ───────────────────────────────────────────────────────────────────
function _nextRound() {
    _round++;
    _musicLen = MUSIC_MIN + Math.random() * (MUSIC_MAX - MUSIC_MIN);
    // Fake-outs: none in the first round, up to two after, never in the first
    // 1.5 s or the last second.
    _dips = [];
    const nDips = _round === 1 ? 0 : Math.floor(Math.random() * 3);
    for (let k = 0; k < nDips; k++) _dips.push(1.5 + Math.random() * Math.max(0.2, _musicLen - 2.5));
    _dips.sort((a, b) => a - b);
    _chairs.forEach(c => { c.by = -1; _paintChair(c, null); });
    _walkers.forEach(w => { if (!w.out) { w.seated = -1; w.frozen = 0; w.react = 0; } });
    _sub = 'walk'; _subT = 0;
    mgMusic('play');
    _set?.lights(1);
    const left = _walkers.filter(w => !w.out).length;
    const final = left === 2;
    _hud.say(final ? 'FINAL CHAIR!' : `ROUND ${_round}`, `${_chairs.length} CHAIR${_chairs.length === 1 ? '' : 'S'} · ${left} WALKERS`, 1400, _t, final ? '#ff4fa3' : '#ffd12d');
}

function _stop() {
    _sub = 'scramble'; _subT = 0;
    mgMusic('stop');
    sfx('slam'); haptic([40]);
    _set?.lights(0.12);
    _hud.say('SIT!', '', 1100, _t, '#ff4f4f');
    _walkers.forEach(w => {
        if (w.out) return;
        if (!w.human || isBotSlot(w.slot)) {
            const skill = w.human ? _botSkill : 0.5;
            w.react = (w.human ? 0.55 - skill * 0.3 : REACT_MIN) + Math.random() * REACT_SPREAD * (w.human ? 1 - skill * 0.5 : 1);
        }
    });
}

function _falseStart(w) {
    w.frozen = FREEZE;
    sfx('land_bad'); haptic([30, 20, 30]);
    w.anim?.play('fall');
    if (w.human && _hud) _hud.say('NO RUNNING!', seat(w.slot).name, 900, _t, '#facc15');
}

function _eliminate(w) {
    w.out = true; w.moving = false;
    sfx('mg_lose');
    w.anim?.play('defeat');
    _sub = 'result'; _subT = 0;
    if (w.human) {
        _hud.say(`${seat(w.slot).name} IS OUT!`, '', RESULT * 1000, _t, seat(w.slot).css);
        _out = w;
        return;
    }
    _hud.say('A PARK-GOER IS OUT', 'ONE MORE CHAIR GOES', RESULT * 1000, _t);
    // A chair goes: the one furthest from anyone, then the rest spread out.
    let far = 0, best = -1;
    _chairs.forEach((c, k) => { const d = Math.min(..._walkers.filter(q => !q.out).map(q => Math.hypot(q.x - Math.cos(c.a) * RC, q.z - Math.sin(c.a) * RC))); if (d > best) { best = d; far = k; } });
    const gone = _chairs.splice(far, 1)[0];
    if (gone?.mesh) { _stage.scene.remove(gone.mesh); gone.mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); _fx.puff(gone.mesh.position.clone(), 0xffffff, 6, 0.4, 0.8); }
    const n = _chairs.length;
    _chairs.sort((a, b) => a.a - b.a).forEach((c, k) => { c.ta = (k / n) * Math.PI * 2 + (_round * 0.4); });
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt; _subT += dt;
    _hud.tick(_t);
    const live = _walkers.filter(w => !w.out);

    if (_phase === 'play') {
        if (_sub === 'walk') {
            while (_dips.length && _subT >= _dips[0]) { _dips.shift(); mgMusic('dip'); _flicker = 0.45; }
            live.forEach(w => {
                if (w.frozen > 0) { w.frozen -= dt; if (w.frozen <= 0) w.anim?.play('walk'); w.moving = false; return; }
                // A player who runs for it while the music plays has false-started.
                if (w.human && !isBotSlot(w.slot)) {
                    const s = _in.seat(w.slot);
                    if (s.down && Math.hypot(s.dx, s.dy) > 0.6) { _falseStart(w); return; }
                } else if (w.human && _flicker > 0 && Math.random() < (1 - _botSkill) * 0.02) { _falseStart(w); return; }
                w.theta += OMEGA * dt;
                // Ease back onto the circle after sitting.
                const tx = Math.cos(w.theta) * RW, tz = Math.sin(w.theta) * RW;
                const k = Math.min(1, dt * 4);
                w.x += (tx - w.x) * k; w.z += (tz - w.z) * k;
                w.face = Math.atan2(-Math.sin(w.theta), Math.cos(w.theta));   // heading along the circle
                w.moving = true;
            });
            if (_subT >= _musicLen) _stop();
        } else if (_sub === 'scramble') {
            live.forEach(w => { if (w.seated < 0) _scrambleMove(w, dt); });
            // Bodies bump.
            for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
                const p = live[a], q = live[b];
                if (p.seated >= 0 || q.seated >= 0) continue;
                const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
                if (d < BODY * 2 && d > 1e-4) { const push = (BODY * 2 - d) / 2; p.x += dx / d * push; p.z += dz / d * push; q.x -= dx / d * push; q.z -= dz / d * push; }
            }
            const standing = live.filter(w => w.seated < 0);
            if (_chairs.every(c => c.by >= 0) && standing.length === 1) _eliminate(standing[0]);
            else if (_subT > SCRAMBLE_MAX && standing.length) {
                // Stalled: whoever is furthest from a free chair is out.
                const free = _chairs.filter(c => c.by < 0);
                standing.sort((a, b) => _nearestFree(b, free).d - _nearestFree(a, free).d);
                _eliminate(standing[0]);
            }
        } else if (_sub === 'result' && _subT >= RESULT) {
            const humans = _walkers.filter(w => w.human);
            if (_out) _end();
            else if (live.length < 2) _end();
            else _nextRound();
        }
    }

    // Chairs slide to their new places after one is taken away.
    _chairs.forEach(c => { let d = c.ta - c.a; d = Math.atan2(Math.sin(d), Math.cos(d)); c.a += d * Math.min(1, dt * 3); _placeChair(c); });
    if (_flicker > 0) { _flicker -= dt; _set?.lights(Math.random() < 0.5 ? 0.2 : 1); if (_flicker <= 0) _set?.lights(1); }

    _walkers.forEach(w => {
        if (!w.rig) return;
        if (w.out) {
            // Leave the ring, outward, and fade from the scene.
            const r = Math.hypot(w.x, w.z) || 1;
            if (r < 9) { w.x += w.x / r * dt * 1.8; w.z += w.z / r * dt * 1.8; }
            else w.rig.root.visible = false;
        }
        w.rig.root.position.set(w.x, w.seated >= 0 ? 0.18 : 0, w.z);
        w.anim.face(w.face, true);
        if (w.out) w.anim.play('walk', { rate: 2 });
        else if (w.seated >= 0) w.anim.play('duck');
        else if (w.frozen > 0) { /* fall plays out */ }
        else w.anim.play(w.moving ? (_sub === 'scramble' ? 'run' : 'walk') : 'ready', { rate: _sub === 'scramble' ? 3.6 : 2.2 });
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

function _nearestFree(w, free) {
    let best = null, d = Infinity;
    free.forEach(c => { const s = _spot(c), dd = Math.hypot(s.x - w.x, s.z - w.z); if (dd < d) { d = dd; best = c; } });
    return { c: best, d };
}

function _scrambleMove(w, dt) {
    if (w.frozen > 0) { w.frozen -= dt; w.moving = false; return; }
    let mv = { dx: 0, dz: 0 }, speed = RUN;
    if (w.human && !isBotSlot(w.slot)) {
        const s = _in.seat(w.slot); mv = { dx: s.dx, dz: s.dy };
    } else {
        if (w.react > 0) { w.react -= dt; w.moving = false; return; }
        const { c } = _nearestFree(w, _chairs.filter(q => q.by < 0));
        if (c) { const s = _spot(c), dx = s.x - w.x, dz = s.z - w.z, d = Math.hypot(dx, dz) || 1; mv = { dx: dx / d, dz: dz / d }; }
        speed = w.human ? RUN * (0.78 + 0.22 * _botSkill) : NPC_RUN;
    }
    const m = Math.hypot(mv.dx, mv.dz);
    w.moving = m > 0.12;
    if (w.moving) {
        const k = Math.min(1, m);
        w.x += mv.dx / m * k * speed * dt; w.z += mv.dz / m * k * speed * dt;
        const lim = 4.8; const r = Math.hypot(w.x, w.z); if (r > lim) { w.x *= lim / r; w.z *= lim / r; }
        w.face = Math.atan2(mv.dx, mv.dz);
    }
    // Reach a free chair: sit.
    for (let k = 0; k < _chairs.length; k++) {
        const c = _chairs[k];
        if (c.by >= 0) continue;
        const s = _spot(c);
        if (Math.hypot(s.x - w.x, s.z - w.z) < SIT_R) {
            c.by = w.i; w.seated = k; w.x = s.x; w.z = s.z; w.moving = false;
            _paintChair(c, w);
            w.face = Math.atan2(Math.cos(c.a), Math.sin(c.a));
            if (w.human) { sfx('land_good'); haptic([15]); }
            break;
        }
    }
}

function _renderHud() {
    if (!_hud) return;
    const left = _walkers.filter(w => !w.out).length;
    [0, 1].forEach(slot => {
        const me = _walkers[slot];
        const st = me?.out ? 'OUT' : me?.seated >= 0 ? 'SEATED' : me?.frozen > 0 ? 'FROZEN!' : '';
        _hud.line(slot, `🪑 ${_chairs.length} CHAIR${_chairs.length === 1 ? '' : 'S'} · ${left} WALKING${st ? ' · ' + st : ''}`);
        if (_round > 1) _hud.hint(slot, '');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `ROUND ${_round} · ${_chairs.length} CHAIR${_chairs.length === 1 ? '' : 'S'}`;
}

function _end() {
    _phase = 'over';
    mgMusic('stop');
    _hud.say('');
    const humans = _walkers.slice(0, 2);
    let w = -1;
    if (_out) w = 1 - _out.slot;
    else if (humans.filter(h => !h.out).length === 1) w = humans.find(h => !h.out).slot;
    _dir.close({
        winner: w,
        figs: humans.filter(h => h.rig).map(h => ({ slot: h.slot, rig: h.rig, anim: h.anim })),
        sub: w < 0 ? 'NOBODY SAT' : 'NEVER LEFT STANDING',
        closeUp: (f, p) => ({ pos: [p.x + 2, p.y + 8.5 * FIG_SCALE, p.z + (f.slot === 0 ? 1 : -1) * 8 * FIG_SCALE], look: [p.x, p.y + 0.8, p.z] }),
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, sub: _sub, round: _round, chairs: _chairs.length, musicLen: +_musicLen.toFixed(2),
             walkers: _walkers.map(w => ({ slot: w.slot, seated: w.seated, out: w.out, frozen: +Math.max(0, w.frozen).toFixed(2), x: +w.x.toFixed(2), z: +w.z.toFixed(2) })),
             gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: stop the music now. */
export function _debugStop() { if (_sub === 'walk') _stop(); }
/** Probes: stand a walker next to a chair (index into the free chairs). */
export function _debugNear(i, k = 0) {
    const free = _chairs.filter(c => c.by < 0); const c = free[k % free.length]; if (!c) return;
    const s = _spot(c), w = _walkers[i]; w.x = s.x + 0.9 * Math.cos(c.a); w.z = s.z + 0.9 * Math.sin(c.a);
}
