// ============================================================
// SACK RACE — two lanes across the hay meadow on the Longhorn Ranch.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Side-on hold, side by side. Both racers hop left to right, P1 in the near
// lane, P2 in the far one.
//
//   TAP on your half to hop.
//
// The race is a RHYTHM. A hop takes the same time every time, and a ring over
// your head closes in to meet you as you land: tap as it lands (green) and the
// next hop is a chain — longer and higher, up to a flat-out bound. Tap late and
// the chain starts again from a shuffle. Tap while you are still in the air and
// the sack wobbles; do it twice and you faceplant.
//
// Hay bales cross both lanes. Only a chained hop (two in a row or more) is high
// enough to clear one; anything lower bounces off it. First to the flag wins.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, sideHud, touch, effects } from '../engine/StageKit.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const START_X = -18, FINISH_X = 18;
const LANE_Z = [1.1, -1.1];              // P1 near, P2 far
const BALES = [-9, 0, 9];                // x of each line of bales, both lanes
const BALE_W = 0.9, BALE_H = 0.5;
const HOP_T = 0.42;                      // s in the air, every hop
const EARLY_OK = 0.10;                   // s before landing a tap still counts as on the beat
const LATE_OK = 0.14;                    // ...and after it
const DIST = s => Math.min(1.85, 0.95 + 0.15 * s);
const HEIGHT = s => Math.min(0.95, 0.32 + 0.1 * s);
const WOBBLE_T = 1.1;                    // s an early tap is remembered for
const PLANT_T = 1.3;                     // s face down in the grass
const BUMP_T = 0.4;                      // s of stagger after hitting a bale
// Knocked back this far in front of the bale: room for two hops of run-up,
// so a chain started from here clears it on the third (0.95 + 1.10 < 2.25).
const KNOCK_BACK = 2.25;
const MATCH_TIME = 45;
const READY_TIME = 2.4;
const FIG_SCALE = 0.85;

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _in = null, _fx = null;
let _look = null, _r = [], _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _winner = -1, _endAt = 0, _count = 0, _frozen = false;

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _winner = -1; _endAt = 0; _count = 0; _frozen = false;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#aee0ff;z-index:5;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0xaee0ff });
    _hud = sideHud(_stage, { padWidth: 240 });
    _in = touch(_stage, { split: 'x', floating: false, onDown: slot => _tap(slot) });
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    if (_stage.gl) _buildMeadow();
    _r = [0, 1].map(_buildRacer);
    _look = _stage.gl ? new THREE.Vector3(..._cam().look) : null;
    [0, 1].forEach(slot => _hud.hint(slot, seat(slot).bot ? '' : 'TAP IN RHYTHM TO HOP'));

    _dir.open({
        place: 'LONGHORN RANCH · THE HAY MEADOW', title: 'SACK RACE',
        sub: 'HOP IN RHYTHM · CLEAR THE BALES',
        from: { pos: [FINISH_X - 2, 5, 10], look: [FINISH_X - 6, 0.8, 0] },
        to: _cam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _r = []; _dir = null; _hud = null; _in = null; _fx = null;
}
function _finish(w) { if (_done) return; _destroy(); _onWin?.(w); }

// The camera sits side-on over the middle of the pack, and pulls back as the
// two racers spread so both stay in frame. It follows where the racers ARE
// (mid-hop), not where they will land, which jumped a whole hop at a time.
function _cam() {
    const xs = _r.length ? _r.map(r => (r.drawX != null ? r.drawX : r.x)) : [START_X, START_X];
    const mid = (xs[0] + xs[1]) / 2, spread = Math.abs(xs[0] - xs[1]);
    const cx = Math.max(START_X + 5, Math.min(FINISH_X - 4, mid + 1.5));
    const back = 10.5 + Math.min(10, spread * 0.55);
    return { pos: [cx, 3.4 + back * 0.12, back], look: [cx, 0.7, 0] };
}

// ── The meadow ───────────────────────────────────────────────────────────────
function _buildMeadow() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0xaee0ff, 30, 70);
    scene.add(new THREE.HemisphereLight(0xf2f9ff, 0x6a8a3a, 0.8));
    const sun = new THREE.DirectionalLight(0xfff1d0, 0.75); sun.position.set(-8, 14, 10); sun.castShadow = true;
    const sc = sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 10; sc.bottom = -10; scene.add(sun);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    const grass = add(new THREE.PlaneGeometry(90, 50), new THREE.MeshStandardMaterial({ color: 0x77b84a, roughness: 1 }), 0, 0, -8);
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true;
    // Mown lanes, chalk lines, and each lane's colour at the start.
    const chalk = new THREE.MeshBasicMaterial({ color: 0xffffff });
    [0, 1].forEach(i => {
        const lane = add(new THREE.PlaneGeometry(FINISH_X - START_X + 4, 1.9), new THREE.MeshStandardMaterial({ color: i ? 0x6aa842 : 0x86c457, roughness: 1 }), 0, 0.005, LANE_Z[i]);
        lane.rotation.x = -Math.PI / 2; lane.receiveShadow = true;
        const tag = add(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: seat(i).color }), START_X - 2.2, 0.25, LANE_Z[i]);
        tag.castShadow = true;
    });
    [-2.1, 0, 2.1].forEach(z => { const l = add(new THREE.PlaneGeometry(FINISH_X - START_X + 4, 0.06), chalk, 0, 0.01, z); l.rotation.x = -Math.PI / 2; });
    const line = add(new THREE.PlaneGeometry(0.16, 4.2), chalk, START_X, 0.012, 0); line.rotation.x = -Math.PI / 2;
    // Finish: chequered strip, two poles and a banner.
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16;
    const cx = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { cx.fillStyle = (i + j) % 2 ? '#111' : '#fff'; cx.fillRect(i * 8, j * 8, 8, 8); }
    const tex = new THREE.CanvasTexture(cv);
    const fin = add(new THREE.PlaneGeometry(4.2, 0.5), new THREE.MeshBasicMaterial({ map: tex }), FINISH_X, 0.013, 0);
    fin.rotation.x = -Math.PI / 2; fin.rotation.z = Math.PI / 2;
    const pole = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
    [-2.3, 2.3].forEach(z => { const p = add(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 8), pole, FINISH_X, 1.7, z); p.castShadow = true; });
    const ban = add(new THREE.BoxGeometry(0.06, 0.6, 4.7), new THREE.MeshBasicMaterial({ map: tex }), FINISH_X, 3.1, 0);
    ban.rotation.x = 0;
    const flag = add(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ color: 0xef4444, side: THREE.DoubleSide }), FINISH_X + 0.55, 3.05, 2.3);
    flag.userData.flag = true;
    // Hay bales: a line across both lanes at each mark.
    const hay = new THREE.MeshStandardMaterial({ color: 0xe8c15a, roughness: 1 });
    const twine = new THREE.MeshStandardMaterial({ color: 0x9a6b2f });
    BALES.forEach(x => [0, 1].forEach(i => {
        const b = add(new THREE.BoxGeometry(BALE_W, BALE_H, 1.6), hay, x, BALE_H / 2, LANE_Z[i]);
        b.castShadow = true; b.receiveShadow = true;
        [-0.45, 0.45].forEach(dz => add(new THREE.BoxGeometry(BALE_W + 0.02, BALE_H + 0.02, 0.05), twine, x, BALE_H / 2, LANE_Z[i] + dz));
    }));
    // A post-and-rail fence behind, a red barn, a few trees.
    const wood = new THREE.MeshStandardMaterial({ color: 0x9b6b3d, roughness: 0.9 });
    for (let x = START_X - 6; x <= FINISH_X + 6; x += 3) add(new THREE.BoxGeometry(0.18, 1.2, 0.18), wood, x, 0.6, -3.4);
    [0.45, 0.95].forEach(y => add(new THREE.BoxGeometry(FINISH_X - START_X + 12, 0.12, 0.08), wood, 0, y, -3.4));
    const barnM = new THREE.MeshStandardMaterial({ color: 0xb4332b, roughness: 0.8 });
    add(new THREE.BoxGeometry(7, 4.2, 5), barnM, -4, 2.1, -13);
    const gable = new THREE.Shape([new THREE.Vector2(-3.9, 0), new THREE.Vector2(3.9, 0), new THREE.Vector2(0, 2.4)]);
    add(new THREE.ExtrudeGeometry(gable, { depth: 5.4, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0x5a3a2a }), -4, 4.2, -15.7);
    add(new THREE.BoxGeometry(2.2, 2.8, 0.1), new THREE.MeshStandardMaterial({ color: 0xf5f5f0 }), -4, 1.4, -10.45);
    const leafM = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.9 });
    [[-20, -9], [-14, -16], [8, -12], [15, -8], [22, -15], [30, -10], [-28, -12]].forEach(([x, z]) => {
        add(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 7), wood, x, 1.2, z);
        add(new THREE.SphereGeometry(1.8, 10, 8), leafM, x, 3.2, z);
    });
}

// ── Racers ───────────────────────────────────────────────────────────────────
function _buildRacer(slot) {
    const r = { slot, x: START_X - 0.6, streak: 0, hop: null, landedAt: -9, wobble: 0, wobbleT: 0, plant: 0, bump: 0,
                finished: 0, hops: 0, perfect: 0, bot: { at: null } };
    if (!_stage.gl) return r;
    const g = new THREE.Group();
    _stage.add(g);
    const ch = _stage.character(slot);
    ch.rig.root.scale.setScalar(FIG_SCALE);
    g.add(ch.rig.root);
    ch.anim.face(Math.PI / 2, true);             // facing down the course, +x
    ch.anim.play('ready');
    // Characters range from a squat slime to a banker in a top hat, and not
    // all of them are centred on their root: measure this one, stand it in the
    // middle of the sack, and cut the sack to fit round it.
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(ch.rig.root), mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    ch.rig.root.position.set(-mid.x, 0.12, -mid.z);
    const R = Math.max(size.x, size.z) / 2 + 0.08, H = Math.max(0.8, size.y * 0.55);
    // Gathered at the top, the player's colour stitched round it.
    const burlap = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 1 });
    const sack = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.88, H, 16), burlap);
    sack.position.y = H / 2; sack.castShadow = true; g.add(sack);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 0.97, 0.08, 6, 18), burlap);
    rim.rotation.x = Math.PI / 2; rim.position.y = H; g.add(rim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.012, R * 0.97, 0.16, 16), new THREE.MeshStandardMaterial({ color: seat(slot).color }));
    band.position.y = H * 0.66; g.add(band);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.04, H * 0.85, 0.04), new THREE.MeshStandardMaterial({ color: 0x8a6a3a }));
    seam.position.set(0, H * 0.45, R * 0.95); g.add(seam);
    // The beat ring: closes in over the head to meet the landing.
    const cue = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    _stage.add(cue);
    Object.assign(r, { g, sack, rig: ch.rig, anim: ch.anim, cue });
    return r;
}

function _tap(slot) {
    const r = _r[slot];
    if (!r || _phase !== 'race' || r.finished || r.plant > 0 || r.bump > 0) return;
    if (r.hop) {
        const left = r.hop.T - r.hop.t;
        if (left <= EARLY_OK) { r.hop.queued = true; return; }          // on the beat: chain on landing
        // In the air: the sack wobbles; twice and you go down.
        r.wobble++; r.wobbleT = WOBBLE_T;
        if (r.wobble >= 2) { r.hop.plant = true; if (!isBotSlot(slot)) _hud.say('TOO FAST!', seat(slot).name, 800, _t, '#f87171'); }
        else sfx('tick');
        return;
    }
    _launch(r, _t - r.landedAt <= LATE_OK && r.hops > 0);
}

function _launch(r, onBeat) {
    r.streak = onBeat ? r.streak + 1 : 0;
    if (onBeat) r.perfect++;
    r.hops++;
    const H = HEIGHT(r.streak);
    let x1 = r.x + DIST(r.streak), blocked = null;
    for (const bx of BALES) {
        const front = bx - BALE_W / 2 - 0.3;
        if (front <= r.x || front > x1) continue;
        if (H < BALE_H) { blocked = bx; x1 = front - KNOCK_BACK; }        // bounces off the bale, well back
        else if (x1 < bx + BALE_W / 2 + 0.35) x1 = bx + BALE_W / 2 + 0.4; // clears it, lands past it
        break;
    }
    r.hop = { t: 0, T: HOP_T, x0: r.x, x1, H, blocked, queued: false, plant: false };
    sfx(onBeat && r.streak >= 2 ? 'land_good' : 'seq_lit');
    if (!isBotSlot(r.slot)) haptic([10]);
    if (isBotSlot(r.slot)) _botPlan(r);
}

function _land(r) {
    const h = r.hop;
    r.x = h.x1; r.hop = null; r.landedAt = _t;
    if (_stage?.gl) _fx.puff(new THREE.Vector3(r.x, 0.1, LANE_Z[r.slot]), 0xd9cfa0, 3, 0.4, 0.3);
    if (h.plant) {
        r.plant = PLANT_T; r.streak = 0; r.wobble = 0; r.bot.at = null;
        sfx('land_bad'); if (!isBotSlot(r.slot)) haptic([40, 30, 40]);
        r.anim?.play('hit', { restart: true });
        return;
    }
    if (h.blocked != null) {
        // Start the approach again: back from the bale, chain at zero.
        r.bump = BUMP_T; r.streak = 0;
        sfx('dice_land'); if (!isBotSlot(r.slot)) haptic([30]);
        if (_stage?.gl) _fx.puff(new THREE.Vector3(h.blocked - 0.5, 0.5, LANE_Z[r.slot]), 0xe8c15a, 5, 0.4, 0.6);
        r.anim?.play('hit', { restart: true });
        return;
    }
    if (r.x >= FINISH_X && !r.finished) {
        r.finished = _clock;
        if (_winner < 0) {
            _winner = r.slot; _endAt = _clock + 1.5;
            sfx('mg_win'); _hud.say('FINISH!', seat(r.slot).name, 1400, _t, seat(r.slot).css);
        }
        r.anim?.play('victory');
        return;
    }
    if (h.queued) _launch(r, true);
}

// ── Bot (§5): tap on the beat, with a skill-sized error; a weak bot sometimes
// double-taps in the air, which is the mistake the wobble exists to punish. ──
function _botPlan(r) {
    const err = (Math.random() + Math.random() - 1) * (0.02 + (1 - _botSkill) * 0.2);
    r.bot.at = HOP_T - 0.03 + err;                                        // hop-relative
    r.bot.double = Math.random() < (1 - _botSkill) * 0.1 ? 0.12 + Math.random() * 0.1 : null;
}
function _botStep(r, dt) {
    if (r.finished || r.plant > 0 || r.bump > 0) return;
    if (r.hop) {
        if (r.bot.double != null && r.hop.t >= r.bot.double) { r.bot.double = null; _tap(r.slot); }
        if (r.bot.at != null && r.bot.at < r.hop.T && r.hop.t >= r.bot.at) { r.bot.at = null; _tap(r.slot); }
    } else {
        // On the ground: its planned tap, or a restart after a stumble.
        const since = _t - r.landedAt, want = r.bot.at != null ? r.bot.at - HOP_T : 0.15 + (1 - _botSkill) * 0.3;
        if (since >= Math.max(0, want)) { r.bot.at = null; _tap(r.slot); }
    }
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _count = 3; _hud.say('3', 'TAP AS YOU LAND', 800, _t, '#ff4f4f'); sfx('countdown'); }
    else if (phase === 'race') { _hud.say('GO!', '', 700, _t, '#4ade80'); sfx('go'); haptic([40]); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready') {
        const n = 3 - Math.floor(_phaseT / (READY_TIME / 3));
        if (n !== _count && n > 0) { _count = n; _hud.say(String(n), 'TAP AS YOU LAND', 800, _t, n === 1 ? '#4ade80' : n === 2 ? '#facc15' : '#ff4f4f'); sfx('countdown'); }
        if (_phaseT >= READY_TIME) _enter('race');
    }
    if (_phase === 'race') {
        if (!_frozen) _clock += dt;
        _r.forEach(r => {
            r.wobbleT = Math.max(0, r.wobbleT - dt); if (!r.wobbleT) r.wobble = 0;
            if (r.plant > 0) { r.plant = Math.max(0, r.plant - dt); if (!r.plant) { r.landedAt = -9; r.anim?.play('ready'); } }
            if (r.bump > 0) {
                r.bump = Math.max(0, r.bump - dt);
                if (!r.bump) {
                    r.landedAt = _t; r.anim?.play('ready');
                    // A bot back on its feet goes again on the beat; a weak one sometimes misses it.
                    if (isBotSlot(r.slot)) r.bot.at = HOP_T + 0.02 + Math.random() * (0.05 + (1 - _botSkill) * 0.14);
                }
            }
            if (r.hop && !_frozen) { r.hop.t += dt; if (r.hop.t >= r.hop.T) _land(r); }
            if (isBotSlot(r.slot)) _botStep(r, dt);
        });
        if (_endAt && _clock >= _endAt) _end();
        else if (_clock >= MATCH_TIME && _winner < 0) { _winner = _r[0].x > _r[1].x ? 0 : _r[1].x > _r[0].x ? 1 : -1; _end(); }
    }
    _r.forEach(r => _draw(r, dt));
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over') {
        const c = _cam(), cam = _stage.camera;
        // Smoothed position AND aim: easing the position but snapping the
        // look-at was the other half of the jump.
        cam.position.lerp(new THREE.Vector3(...c.pos), Math.min(1, dt * 1.6));
        if (!_look) _look = new THREE.Vector3(...c.look);
        _look.lerp(new THREE.Vector3(...c.look), Math.min(1, dt * 1.6));
        cam.lookAt(_look);
    }
    _renderHud();
}

function _draw(r, dt) {
    if (!r.g) return;
    const h = r.hop;
    let x = r.x, y = 0, sq = 1;
    if (h) {
        const u = Math.min(1, h.t / h.T);
        if (h.blocked != null) {
            // Into the bale and back off it.
            const front = h.blocked - BALE_W / 2 - 0.3;
            x = u < 0.6 ? h.x0 + (front - h.x0) * (u / 0.6) : front + (h.x1 - front) * ((u - 0.6) / 0.4);
        } else x = h.x0 + (h.x1 - h.x0) * u;
        y = Math.sin(u * Math.PI) * h.H;
        sq = 1 + Math.sin(u * Math.PI) * 0.12;
    } else {
        const since = _t - r.landedAt;
        sq = since < 0.12 ? 1 - Math.sin(since / 0.12 * Math.PI) * 0.18 : 1;
    }
    r.drawX = x;
    r.g.position.set(x, y, LANE_Z[r.slot]);
    r.g.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    const tilt = r.plant > 0 ? -Math.min(1.35, (PLANT_T - r.plant) * 8) : r.wobble ? Math.sin(_t * 30) * 0.18 : 0;
    r.g.rotation.z = tilt;
    // The beat ring: over the head, closing to meet the landing.
    const cue = r.cue;
    if (cue) {
        const show = h && h.blocked == null && !h.plant && !r.finished && _phase === 'race' && !isBotSlot(r.slot);
        const left = h ? h.T - h.t : 0;
        cue.visible = !!show;
        if (show) {
            cue.position.set(x, 2.05 + y, LANE_Z[r.slot]);
            cue.scale.setScalar(1 + Math.min(1, left / h.T) * 2.2);
            const inWin = left <= EARLY_OK;
            cue.material.color.setHex(h.queued ? 0xfacc15 : inWin ? 0x4ade80 : 0xffffff);
            cue.material.opacity = h.queued ? 0.9 : 0.35 + (1 - left / h.T) * 0.6;
            cue.lookAt(_stage.camera.position);
        }
    }
}

function _renderHud() {
    if (!_hud) return;
    const m = r => Math.max(0, Math.round(((r.x - START_X) / (FINISH_X - START_X)) * 100));
    const chain = r => (r.streak >= 2 ? ` 🔥${r.streak}` : '');
    _hud.bar(`<span style="color:${seat(1).css}">${seat(1).name} ${m(_r[1])}%${chain(_r[1])}</span>` +
        `<span>🥔 SACK RACE</span>` +
        `<span style="color:${seat(0).css}">${chain(_r[0])} ${m(_r[0])}% ${seat(0).name}</span>`);
    _r.forEach(r => {
        if (seat(r.slot).bot) return;
        _hud.hint(r.slot, r.plant > 0 ? 'FACEPLANT!' : r.wobble ? 'WOBBLE — WAIT FOR THE LANDING' : r.bump > 0 ? 'CHAIN 2 HOPS TO CLEAR A BALE'
            : _clock < 6 || r.hops < 3 ? 'TAP AS YOU LAND' : '');
        _hud.lit(r.slot, !!(r.hop && r.hop.T - r.hop.t <= EARLY_OK), 'rgba(74,222,128,.35)');
    });
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'race') el.textContent = `${seat(0).name} ${m(_r[0])}% – ${m(_r[1])}% ${seat(1).name}`;
}

function _end() {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    _r.forEach(r => { if (r.cue) r.cue.visible = false; });
    const w = _winner;
    _dir.close({
        winner: w, figs: _r.filter(r => r.rig).map(r => ({ slot: r.slot, rig: r.rig, anim: r.anim })),
        sub: w < 0 ? 'DEAD HEAT' : 'FIRST TO THE FLAG',
        onDone: () => _finish(w),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w < 0 ? 'DRAW!' : `${seat(w).name} WINS!`;
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, clock: +_clock.toFixed(2), winner: _winner,
             racers: _r.map(r => ({ x: +r.x.toFixed(2), streak: r.streak, hops: r.hops, perfect: r.perfect, wobble: r.wobble,
                                    plant: +r.plant.toFixed(2), bump: +r.bump.toFixed(2), finished: r.finished,
                                    hop: r.hop ? { t: +r.hop.t.toFixed(3), T: r.hop.T, H: +r.hop.H.toFixed(2), x1: +r.hop.x1.toFixed(2), blocked: r.hop.blocked, queued: r.hop.queued, plant: r.hop.plant } : null })),
             bales: BALES, finish: FINISH_X, camX: _stage?.camera ? +_stage.camera.position.x.toFixed(3) : 0, gl: !!_stage?.gl, turned: !!_stage?.turned };
}
/** Probes: freeze hops and the clock, so a real tap can be timed on a slow renderer. */
export function _debugFreeze(on) { _frozen = !!on; }
/** Probes: set a hop's clock (s since take-off). */
export function _debugHopT(slot, t) { const r = _r[slot]; if (r && r.hop) r.hop.t = t; }
/** Probes: place a racer on the ground at x, with a chain of `streak`. */
export function _debugPlace(slot, x, streak = 0) { const r = _r[slot]; if (r) Object.assign(r, { x, streak, hop: null, plant: 0, bump: 0, wobble: 0, landedAt: -9 }); }
/** Probes: launch a hop from where the racer stands, on the beat or not. */
export function _debugLaunch(slot, onBeat) { const r = _r[slot]; if (r && !r.hop) _launch(r, onBeat); }
