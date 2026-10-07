// ============================================================
// BRAINROT TOWER — the Prize Arcade's claw machine, and one tower for everyone.
// (Scaffolded from _template3d.js; see docs/MINIGAME_3D_PLAYBOOK.md.)
//
// Upright hold: the phone stands portrait and is passed round. Two, three or
// four players take TURNS. On your turn the claw carries a plush critter in
// from the side of the machine:
//
//   SLIDE (anywhere on the screen, or the slider at the bottom) to aim it,
//   then press DROP.
//
// Everything moves in the picture's own plane: critters slide, fall and tip
// left, right, up and down, never towards or away from you, so what you see
// side-on is all there is.
//
// The critters are real bodies and every one is a different awkward shape:
// twenty-four of them (BrainrotCast.js), from a flat pizza-hippo you can build
// on to a cheese wheel that rolls and a taco that catches. They land on
// whatever is already there. There is no match clock: the game goes on until
// ANYTHING falls off the plinth (your critter, or the tower under it), and the
// player who dropped last knocked it over and loses. Each turn has its own
// clock: hesitate and the claw lets go wherever it is, and it starts each turn
// out past the plinth's edge.
//
// The cast is our own: absurd mash-up plushies in the "brainrot" style, with
// names made up here (see the note at the top of BrainrotCast.js).
//
// Two players: the other one wins. Three or four: the one who knocked it over
// is last and everybody else shares the win (standings pay the ladder).
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, slotCount } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { createDirector } from '../engine/StageDirector.js';
import { seat, uprightHud, effects } from '../engine/StageKit.js';
import { CAST } from './BrainrotCast.js';

// ── Tuning (seconds and world units) ─────────────────────────────────────────
const PLINTH_TOP = 1.0, PLINTH_W = 4.0, PLINTH_D = 1.8;   // the shared plinth
const FALL_Y = PLINTH_TOP - 0.3;     // a critter's centre below this has fallen off
const CLAW_ABOVE = 1.8;              // claw tip above the top of the tower: a short fall, so a drop doesn't hammer the stack
const AIM_RANGE = 2.65;               // the claw travels this far either side, past the plinth's edge
const TURN_0 = 6.5, TURN_MIN = 3.5, TURN_STEP = 0.15;        // s before the claw lets go by itself
const SETTLE_SPEED = 0.18, SETTLE_HOLD = 0.5, SETTLE_MAX = 4.0;
const READY_TIME = 1.3;                  // no match clock: it goes until something falls off
const TOPPLE_WAIT = 1.5;                 // s of watching it fall before the verdict

// ── The cast: 24 plush mash-ups, each its own awkward shape (BrainrotCast.js) ─
// Drawn and simulated a size up from their own numbers, so they still read on
// a phone with the camera back far enough for the wider plinth.
const K = 1.15;

// ── Module state — start() resets all of it, _destroy() clears it ───────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _dir = null, _hud = null, _fx = null;
let _world = null, _plushMat = null, _claw = null;
let _n = 2, _pieces = [], _held = null, _turn = 0, _drops = 0, _deck = [];
let _phase = 'intro', _phaseT = 0, _t = 0, _clock = 0, _aim = 0, _turnT = 0, _frozen = false;
let _settle = null, _toppler = -1, _look = null, _shake = 0, _bot = { wait: 0, target: 0 };
let _ui = null, _drag = null, _lineup = false;            // the slider and DROP button; the finger aiming

export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _phase = 'intro'; _phaseT = 0; _t = 0; _clock = 0; _aim = 0; _turnT = 0; _frozen = false; _drag = null; _ui = null;
    _pieces = []; _held = null; _turn = 0; _drops = 0; _deck = []; _settle = null; _toppler = -1;
    _look = null; _shake = 0; _bot = { wait: 0, target: 0 }; _claw = null;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1a1033;z-index:5;touch-action:none;';
    mg.appendChild(_overlay);
    _stage = createStage(_overlay, { hold: 'upright', fov: 50, background: 0x1a1033 });
    _hud = uprightHud(_stage);
    _ui = _buildControls();
    _fx = effects(_stage);
    _dir = createDirector(_stage);
    _world = typeof CANNON !== 'undefined' ? _buildWorld() : null;
    if (_stage.gl) _buildArcade();
    // One tower, one claw: whoever's turn it is slides anywhere to aim, and
    // presses DROP.
    _stage.listen('pointerdown', e => {
        e.preventDefault();
        const p = _stage.toLocal(e.clientX, e.clientY);
        if (_onDrop(p)) { _tap(); return; }
        if (!_canAim()) return;
        _drag = e.pointerId; _aimAt(p.x);
    });
    _stage.listen('pointermove', e => { if (e.pointerId === _drag && _canAim()) _aimAt(_stage.toLocal(e.clientX, e.clientY).x); });
    const up = e => { if (e.pointerId === _drag) _drag = null; };
    _stage.listen('pointerup', up); _stage.listen('pointercancel', up);

    _dir.open({
        place: 'SHOPPING PROMENADE · THE PRIZE ARCADE', title: 'BRAINROT TOWER',
        sub: 'TAKE TURNS · KNOCK ANYTHING OFF AND YOU LOSE',
        from: { pos: [3.5, 2.6, 5.5], look: [0, 1.6, 0] },
        to: _cam(),
        onDone: () => { if (!_done) _enter('ready'); },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _world = null; _pieces = []; _held = null; _claw = null;
    _dir = null; _hud = null; _fx = null; _ui = null; _drag = null;
}
function _finish(w, standings) { if (_done) return; _destroy(); _onWin?.(w, null, standings); }

// ── Escalation: every drop the claw waits a little less ─────────────────────
const _turnTime = () => Math.max(TURN_MIN, TURN_0 - _drops * TURN_STEP);
const _clawX = () => _aim;

/** The top of the tower: the highest point of anything resting on the plinth. */
function _top() {
    let top = PLINTH_TOP;
    for (const p of _pieces) if (p.body && p.landed && !p.off) top = Math.max(top, p.body.position.y + p.reach);
    return top;
}
const _clawY = () => _top() + CLAW_ABOVE;

// The camera frames the claw's whole reach across, and the tower from its
// last few critters up to the claw, whatever the screen's shape: on a tall
// phone the width decides how far back it stands, on a tablet the height.
const HALF_W = AIM_RANGE + 0.75, TAN = Math.tan(25 * Math.PI / 180);   // fov 50
function _cam() {
    const top = _top();
    const lo = Math.max(0.1, top - 4.2), hi = top + CLAW_ABOVE + 0.7;
    const cy = (lo + hi) / 2;
    const aspect = _stage?.camera ? _stage.camera.aspect : 0.5;
    const dist = Math.max(HALF_W / (TAN * aspect), (hi - lo) / 2 / TAN) + 1.0;
    return { pos: [0, cy + 0.9, dist], look: [0, cy, 0] };
}

// ── Physics ──────────────────────────────────────────────────────────────────
function _buildWorld() {
    const w = new CANNON.World();
    w.gravity.set(0, -9.8, 0);
    w.broadphase = new CANNON.NaiveBroadphase();
    w.solver.iterations = 30;         // tall stacks need the extra passes to stay stiff
    w.allowSleep = true;
    // The game is played in the picture's plane. cannon.js 0.6 has no axis
    // locks, so after every step each critter is put back on it: no depth
    // drift, no depth speed, and only the roll that faces the camera.
    w.addEventListener('postStep', () => {
        for (const p of _pieces) {
            const b = p.body; if (!b || p.locked) continue;
            b.position.z = 0; b.velocity.z = 0;
            b.angularVelocity.x = 0; b.angularVelocity.y = 0;
            const q = b.quaternion, roll = 2 * Math.atan2(q.z, q.w);
            q.set(0, 0, Math.sin(roll / 2), Math.cos(roll / 2));
        }
    });
    _plushMat = new CANNON.Material('plush');
    const hard = new CANNON.Material('hard');
    // Stiff contacts: cannon's soft defaults let a tall stack sink into itself.
    const stiff = { contactEquationStiffness: 5e7, contactEquationRelaxation: 3, frictionEquationStiffness: 5e7, frictionEquationRelaxation: 3 };
    w.addContactMaterial(new CANNON.ContactMaterial(_plushMat, _plushMat, { friction: 0.85, restitution: 0.02, ...stiff }));
    w.addContactMaterial(new CANNON.ContactMaterial(_plushMat, hard, { friction: 0.75, restitution: 0.05, ...stiff }));
    const floor = new CANNON.Body({ mass: 0, material: hard });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    w.addBody(floor);
    // The plinth: nothing else holds the tower up, so a critter past its edge falls.
    const plinth = new CANNON.Body({ mass: 0, material: hard });
    plinth.addShape(new CANNON.Box(new CANNON.Vec3(PLINTH_W / 2, PLINTH_TOP / 2, PLINTH_D / 2)));
    plinth.position.set(0, PLINTH_TOP / 2, 0);
    w.addBody(plinth);
    return w;
}

/** How far the critter reaches above and below its centre, upright. */
function _reach(c) {
    let r = 0;
    for (const s of c.shapes) {
        const oy = s.off ? s.off[1] : 0;
        r = Math.max(r, s.sphere ? s.sphere + Math.abs(oy) : Math.abs(oy) + s.box[1] + Math.abs(Math.sin(s.roll || 0)) * s.box[0]);
    }
    return r * K;
}

function _lookOf(c) { const g = c.look(); g.scale.setScalar(K); return g; }

function _body(c) {
    const b = new CANNON.Body({ mass: c.mass, material: _plushMat, linearDamping: 0.08, angularDamping: 0.45 });
    for (const s of c.shapes) {
        const shape = s.sphere ? new CANNON.Sphere(s.sphere * K) : new CANNON.Box(new CANNON.Vec3(...s.box.map(v => v * K)));
        const off = new CANNON.Vec3(...(s.off || [0, 0, 0]).map(v => v * K));
        const q = new CANNON.Quaternion(); q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), s.roll || 0);
        b.addShape(shape, off, q);
    }
    b.sleepSpeedLimit = 0.06; b.sleepTimeLimit = 0.5;
    return b;
}

// ── The arcade: a claw-machine cabinet, a prize pit, neon ───────────────────
function _buildArcade() {
    const scene = _stage.scene;
    scene.fog = new THREE.Fog(0x1a1033, 32, 80);   // the camera stands well back for the wide plinth
    _stage.light({ sun: 0xfff3e0, sunI: 1.15, sky: 0xd9c8ff, ground: 0x3a2050, hemiI: 0.75, dir: [3, 11, 8], span: 7 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); _stage.add(m); return m; };
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
    // Floor and back wall, with a stripe of arcade carpet.
    const floor = add(new THREE.PlaneGeometry(30, 18), std(0x2b1b4d, { roughness: 0.95 }), 0, 0, 0); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    // The back wall runs far up: a tower with no clock can get very tall.
    add(new THREE.BoxGeometry(30, 80, 0.3), std(0x3b1f66), 0, 40, -3.4);
    // The cabinet: corner posts, a top header, the claw's rail.
    const chrome = std(0xe6e6f0, { metalness: 0.7, roughness: 0.25 });
    // Back posts only: front ones would stand between the camera and the tower.
    [[-4.3, -2.2], [4.3, -2.2]].forEach(([x, z]) => add(new THREE.BoxGeometry(0.16, 80, 0.16), chrome, x, 40, z).castShadow = true);   // up past any tower
    // The cabinet's top (header and sign) rides with the claw's rail, so a tall
    // tower never grows through it.
    const crown = new THREE.Group(); _stage.add(crown);
    const head = new THREE.Mesh(new THREE.BoxGeometry(9.0, 0.7, 4.0), std(0xff4fa3, { emissive: 0xff4fa3, emissiveIntensity: 0.25 }));
    head.position.set(0, 0.4, -0.3); crown.add(head);
    // The sign.
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff6b0'; g.shadowColor = '#ffde59'; g.shadowBlur = 16;
    g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BRAINROT TOWER', 256, 50);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.98), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true }));
    sign.position.set(0, 0.4, 1.72); crown.add(sign);
    // Neon strips up the back wall.
    [0x5ef2ff, 0xffde59, 0xff4fa3, 0x7cff6b].forEach((c, i) => add(new THREE.BoxGeometry(0.08, 7, 0.08), new THREE.MeshBasicMaterial({ color: c }), -5.5 + i * 3.6 + (i > 1 ? 0.4 : 0), 4.2, -3.2));
    // The plinth, striped like a prize podium.
    add(new THREE.BoxGeometry(PLINTH_W, PLINTH_TOP, PLINTH_D), std(0xffde59), 0, PLINTH_TOP / 2, 0).receiveShadow = true;
    add(new THREE.BoxGeometry(PLINTH_W + 0.04, 0.12, PLINTH_D + 0.04), std(0xff4fa3), 0, PLINTH_TOP - 0.06, 0);
    add(new THREE.BoxGeometry(PLINTH_W + 0.04, 0.12, PLINTH_D + 0.04), std(0xff4fa3), 0, 0.2, 0);
    // The prize pit: a carpet of plush balls round the plinth, one draw call.
    const N = 170, ball = new THREE.SphereGeometry(0.22, 10, 8);
    const pit = new THREE.InstancedMesh(ball, std(0xffffff, { roughness: 0.9 }), N);
    const m = new THREE.Matrix4(), col = new THREE.Color(), cols = [0xff4fa3, 0x5ef2ff, 0xffde59, 0x7cff6b, 0xb68cff, 0xff8a4c];
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
        const x = (Math.random() - 0.5) * 8.8, z = -2.1 + Math.random() * 3.9;
        if (Math.abs(x) < PLINTH_W / 2 + 0.25 && Math.abs(z) < PLINTH_D / 2 + 0.25) continue;
        m.makeTranslation(x, 0.16 + Math.random() * 0.12, z); pit.setMatrixAt(k, m);
        pit.setColorAt(k, col.setHex(cols[k % cols.length])); k++;
    }
    pit.count = k; pit.receiveShadow = true; _stage.add(pit);
    // The claw: a carriage on the rail, a cable, three fingers.
    _claw = new THREE.Group();
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.5), chrome); carriage.position.y = 0; _claw.add(carriage);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), std(0x222222)); _claw.add(cable);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.18, 12), chrome); _claw.add(hub);
    const fingers = [0, 1, 2].map(i => {
        const f = new THREE.Group(); f.rotation.y = i * Math.PI * 2 / 3;
        const bone = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.05), chrome); bone.position.set(0.12, -0.15, 0); f.add(bone);
        _claw.add(f); return f;
    });
    Object.assign(_claw.userData, { carriage, cable, hub, fingers });
    _stage.add(_claw);
    // The rail the claw rides along; it climbs with the tower (_draw).
    _claw.userData.crown = crown;
    crown.position.y = 8.8;
    _claw.userData.rail = add(new THREE.BoxGeometry(8.6, 0.08, 0.08), chrome, 0, 8.8, 0);
}

// ── Turns ────────────────────────────────────────────────────────────────────
// The next critter comes off a shuffled deck, so no shape repeats until the
// deck runs out and a run of meatballs can't decide a match.
function _nextCritter() {
    if (!_deck.length) { _deck = CAST.map((_, i) => i); for (let i = _deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [_deck[i], _deck[j]] = [_deck[j], _deck[i]]; } }
    return CAST[_deck.pop()];
}

function _newTurn() {
    const c = _nextCritter();
    _held = { c, reach: _reach(c), mesh: null };
    if (_stage?.gl) { _held.mesh = _lookOf(c); _stage.add(_held.mesh); }
    _turnT = 0;
    // The claw brings it in from the side, past the plinth's edge, from the
    // left and the right in turn: leaving it there loses.
    _aim = (_drops % 2 ? -1 : 1) * AIM_RANGE;
    _drag = null;
    _bot = { wait: 0.4 + Math.random() * 0.4 + (1 - _botSkill) * 0.6, target: null, dwell: 0 };
    const s = seat(_turn);
    _hud.say(`${s.name}'S TURN`, c.name, 900, _t, s.css);
    sfx('seq_lit');
    if (!isBotSlot(_turn)) haptic([12]);
}

function _tap() {
    if (!_canAim()) return;
    _drop();
}

// ── The slider ───────────────────────────────────────────────────────────────
const _canAim = () => _phase === 'play' && !!_held && !_settle && !isBotSlot(_turn);
/** A finger at stage x aims the claw: the slider's track maps onto its reach. */
function _aimAt(px) {
    if (!_ui) return;
    const { l, r } = _ui.track();
    _aim = Math.max(-1, Math.min(1, ((px - l) / Math.max(1, r - l)) * 2 - 1)) * AIM_RANGE;
}
function _onDrop(p) {
    if (!_ui) return false;
    const b = _ui.button();
    return Math.hypot(p.x - b.x, p.y - b.y) <= b.r;
}
// A track along the bottom with a knob in the player's colour, and a round
// DROP button above it. The HUD layer takes no touches itself: the stage's
// own listener reads where a finger is and asks these two where they are.
function _buildControls() {
    const root = _stage.hud;
    const el = (css, parent = root) => { const e = document.createElement('div'); e.style.cssText = css; parent.appendChild(e); return e; };
    const wrap = el('position:absolute;left:0;right:0;bottom:0;height:170px;transition:opacity .2s;');
    const label = el('position:absolute;left:0;right:0;bottom:62px;text-align:center;font:400 14px/1 "Bebas Neue",sans-serif;letter-spacing:2px;color:#fff8ee;opacity:.85;', wrap);
    label.textContent = '◀ SLIDE TO AIM ▶';
    const track = el('position:absolute;left:34px;right:34px;bottom:30px;height:12px;border-radius:6px;background:rgba(255,255,255,.18);box-shadow:inset 0 1px 3px rgba(0,0,0,.5);', wrap);
    const mid = el('position:absolute;left:50%;top:-6px;width:2px;height:24px;margin-left:-1px;background:rgba(255,222,89,.55);', track);
    const knob = el('position:absolute;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.5);', track);
    const btn = el('position:absolute;left:50%;bottom:84px;width:96px;height:96px;margin-left:-48px;border-radius:50%;display:flex;align-items:center;justify-content:center;' +
        'font:400 30px/1 "Bebas Neue",sans-serif;letter-spacing:2px;color:#1a1033;background:#ffde59;border:4px solid #fff;box-shadow:0 6px 0 #c9a227,0 10px 18px rgba(0,0,0,.45);', wrap);
    btn.textContent = 'DROP';
    mid.style.pointerEvents = 'none';
    return {
        track() { const W = _stage.width; return { l: 34 + 12, r: W - 34 - 12 }; },
        button() { const W = _stage.width, H = _stage.height; return { x: W / 2, y: H - 84 - 48, r: 58 }; },
        draw(aim, color, live, bot) {
            knob.style.left = `${((aim / AIM_RANGE) + 1) * 50}%`;
            knob.style.background = color;
            wrap.style.opacity = live ? '1' : bot ? '.55' : '.3';
            label.textContent = bot ? 'THE BOT IS AIMING…' : '◀ SLIDE TO AIM ▶';
            btn.style.filter = live && !bot ? '' : 'grayscale(.8)';
        },
    };
}

function _drop(forceX = null) {
    if (!_held || _settle) return;
    const x = forceX != null ? forceX : _clawX();
    const h = _held;
    _held = null;
    const p = { c: h.c, slot: _turn, reach: h.reach, mesh: h.mesh, body: null, landed: false, off: false };
    const y = _clawY() - 0.25 - h.reach;
    if (_world) {
        const b = _body(h.c);
        // Straight down from where the claw let go: the swing is the timing
        // test, and a throw on top of it made the drop unreadable on a phone.
        b.position.set(x, y, 0);
        _world.addBody(b); p.body = b;
        b.addEventListener('collide', () => { if (!p.landed) { p.landed = true; sfx('dice_land'); } });
    } else {
        p.landed = true; p.x = x;
    }
    _pieces.push(p);
    _drops++;
    _settle = { t: 0, calm: 0, slot: _turn };
    _claw && (_claw.userData.open = 0.35);
    sfx('dice_throw');
    if (!isBotSlot(_turn)) haptic([10]);
}

// ── Bot: wait a beat, then let go when the claw is over the tower's top ─────
function _botStep(dt) {
    if (!_held || _settle) return;
    _bot.wait -= dt;
    if (_bot.wait > 0) return;
    // Aim for the middle of the top critter, pulled toward the plinth's centre,
    // missing by up to a skill-sized slip of the thumb.
    if (_bot.target == null) {
        let top = null;
        for (const p of _pieces) if (p.body && !p.off && p.landed && (!top || p.body.position.y > top.body.position.y)) top = p;
        _bot.target = (top ? top.body.position.x * 0.6 : 0) + (Math.random() * 2 - 1) * (1 - _botSkill) * 0.55;
    }
    // Slide there like a thumb would, settle for a beat, press DROP.
    const speed = 2.2 + _botSkill * 2.5, d = _bot.target - _aim;
    _aim += Math.sign(d) * Math.min(Math.abs(d), speed * dt);
    if (Math.abs(d) < 0.01) { _bot.dwell += dt; if (_bot.dwell > 0.25 + (1 - _botSkill) * 0.3) _drop(); }
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _enter(phase) {
    _phase = phase; _phaseT = 0;
    if (phase === 'ready') { _hud.say('READY…', 'SLIDE TO AIM · DROP · DON\'T KNOCK IT OVER', 1300, _t, '#ffde59'); sfx('countdown'); }
    else if (phase === 'play') { sfx('go'); haptic([40]); _turn = 0; _newTurn(); }
}

function _frame(dt) {
    if (_done) return;
    _t += dt; _phaseT += dt;
    _hud.tick(_t);
    if (_phase === 'ready' && _phaseT >= READY_TIME) _enter('play');
    if (_phase === 'play') {
        _clock += dt;
        if (_held && !_settle) {
            if (!_frozen) _turnT += dt;
            if (isBotSlot(_turn)) _botStep(dt);
            if (_turnT >= _turnTime()) { _hud.say('TOO SLOW!', 'THE CLAW LET GO', 700, _t, '#ff8a4c'); _drop(); }
        }
    }
    if (_world) _world.step(1 / 60, dt, 6);
    if (_phase === 'play') _rules(dt);
    else if (_phase === 'toppling' && _phaseT >= TOPPLE_WAIT) _end(_toppler);
    _draw(dt);
    _fx?.update(dt);
    const dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!dirOwns && _stage?.gl && _phase !== 'over' && !_lineup) {
        const c = _cam(), cam = _stage.camera;
        cam.position.lerp(new THREE.Vector3(...c.pos), Math.min(1, dt * 1.6));
        if (!_look) _look = new THREE.Vector3(...c.look);
        _look.lerp(new THREE.Vector3(...c.look), Math.min(1, dt * 1.6));
        if (_shake > 0) { _shake = Math.max(0, _shake - dt); cam.position.x += (Math.random() - 0.5) * _shake * 0.5; cam.position.y += (Math.random() - 0.5) * _shake * 0.4; }
        cam.lookAt(_look);
    }
    _renderHud();
}

function _rules(dt) {
    // Anything off the plinth knocks the tower over, whoever's piece it was:
    // the blame goes to whoever dropped last.
    for (const p of _pieces) {
        if (p.off || !p.body) continue;
        if (p.body.position.y < FALL_Y) { p.off = true; _topple(p); return; }
    }
    if (_settle) {
        _settle.t += dt;
        const me = _pieces[_pieces.length - 1];
        const moving = _pieces.some(p => p.body && !p.off && (p.body.velocity.length() > SETTLE_SPEED || p.body.angularVelocity.length() > SETTLE_SPEED * 3));
        _settle.calm = moving || (me && !me.landed) ? 0 : _settle.calm + dt;
        if (_settle.calm >= SETTLE_HOLD || _settle.t >= SETTLE_MAX) {
            _settle = null;
            _lockDeep();
            sfx('land_good');
            _turn = (_turn + 1) % _n;
            _newTurn();
        }
    }
}

// Critters more than LIVE drops deep that are resting become part of the
// furniture: static, so a tall tower can't sink into itself and fall over on
// nobody's turn. Only the top few can wobble, which is where the game is.
const LIVE = 4;
function _lockDeep() {
    if (typeof CANNON === 'undefined') return;
    const on = _pieces.filter(p => p.body && !p.off && !p.locked);
    on.slice(0, Math.max(0, on.length - LIVE)).forEach(p => {
        const b = p.body;
        if (b.velocity.length() > SETTLE_SPEED || b.angularVelocity.length() > SETTLE_SPEED * 3) return;
        b.velocity.set(0, 0, 0); b.angularVelocity.set(0, 0, 0);
        b.mass = 0; b.type = CANNON.Body.STATIC; b.updateMassProperties();
        p.locked = true;
    });
}

function _topple(p) {
    if (_phase !== 'play') return;
    _toppler = _settle ? _settle.slot : (_turn + _n - 1) % _n;
    _settle = null;
    if (_held?.mesh) _held.mesh.visible = false;
    _held = null;
    sfx('slam'); sfx('boom'); haptic([60, 40, 80]);
    _shake = 0.6;
    if (_stage?.gl) {
        const at = new THREE.Vector3(p.body.position.x, Math.max(0.3, p.body.position.y), 0);
        _fx?.burst(at, seat(_toppler).color, 0.4, 0.35);
        _fx?.puff(at, 0xff9ad5, 9, 0.8, 0.9);
    }
    _hud.say('TIMBER!', `${seat(_toppler).name} KNOCKED IT OVER`, 1400, _t, seat(_toppler).css);
    // Let the tower finish falling before the verdict (_frame counts it down).
    _phase = 'toppling'; _phaseT = 0;
}

function _draw(dt) {
    for (const p of _pieces) if (p.mesh && p.body) { p.mesh.position.copy(p.body.position); p.mesh.quaternion.copy(p.body.quaternion); }
    if (!_claw) return;
    const x = _held || _settle ? _clawX() : _claw.position.x;
    const tipY = _clawY();
    // The rail climbs once the tower nears the top of the cabinet.
    const railY = Math.max(8.8, tipY + 1.6);
    if (_claw.userData.rail) _claw.userData.rail.position.y = railY;
    if (_claw.userData.crown) _claw.userData.crown.position.y = railY;
    _claw.position.set(x, tipY, 0);
    const u = _claw.userData;
    u.carriage.position.y = railY - tipY;
    u.cable.scale.y = Math.max(0.01, railY - tipY - 0.1);
    u.cable.position.y = (railY - tipY) / 2;
    u.hub.position.y = 0.05;
    u.open = Math.max(0, (u.open || 0) - dt);
    const spread = _held ? 0.15 : 0.55;
    u.fingers.forEach(f => { f.children[0].rotation.z = spread; });
    _claw.rotation.z = 0;
    if (_held?.mesh) {
        _held.mesh.position.set(x, tipY - 0.25 - _held.reach, 0);
        _held.mesh.rotation.set(0, 0, Math.sin(_t * 3) * 0.05);
        _held.mesh.visible = _phase === 'play';
    }
}

function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, Math.ceil(_turnTime() - _turnT));
    const chips = Array.from({ length: _n }, (_, i) => {
        const s = seat(i), on = _phase === 'play' && i === _turn;
        return `<span style="color:${s.css};${on ? 'text-decoration:underline;text-underline-offset:4px;' : 'opacity:.7;'}">${on ? '▶ ' : ''}${s.name}</span>`;
    });
    _hud.bar(chips.join('') + `<span>🧸 ${_pieces.filter(p => !p.off).length}</span>` + (_held && _phase === 'play' ? `<span>⏱ ${left}s</span>` : ''));
    const el = document.getElementById('mg-neutral');
    if (el && _phase === 'play') el.textContent = `${seat(_turn).name}'S TURN · ${_pieces.length} STACKED`;
    _ui?.draw(_aim, seat(_turn).css, _canAim(), _phase === 'play' && !!_held && isBotSlot(_turn));
}

/** `loser` is the slot that knocked it over (−1, a shared result, is kept for safety only). */
function _end(loser) {
    if (_phase === 'over') return;
    _phase = 'over';
    _hud.say('');
    if (_held?.mesh) _held.mesh.visible = false;
    _held = null;
    // Standings: everybody who didn't knock it over shares first.
    const standings = Array.from({ length: _n }, (_, i) => (i === loser ? 0 : 1));
    const w = loser < 0 ? -1 : _n === 2 ? 1 - loser : -1;
    const stacked = _pieces.length - (loser >= 0 ? 1 : 0);
    const sub = loser < 0 ? `${stacked} CRITTERS AND STILL STANDING`
              : `${seat(loser).name} KNOCKED IT OVER · ${stacked} STACKED`;
    _dir.close({
        winner: w, figs: [],                      // no figures in this one: the tower is the picture
        sub, onDone: () => _finish(w, standings),
    });
    const el = document.getElementById('mg-neutral');
    if (el) el.textContent = w >= 0 ? `${seat(w).name} WINS!` : loser >= 0 ? `${seat(loser).name} KNOCKED IT OVER!` : 'STILL STANDING!';
}

// ── Probe hooks ──────────────────────────────────────────────────────────────
export function _debugState() {
    return { phase: _phase, n: _n, turn: _turn, drops: _drops, toppler: _toppler, clock: +_clock.toFixed(2),
             held: _held ? _held.c.key : null, settling: !!_settle, clawX: +_clawX().toFixed(3),
             turnT: +_turnT.toFixed(2), turnTime: +_turnTime().toFixed(2), top: +_top().toFixed(3),
             camY: _stage?.camera ? +_stage.camera.position.y.toFixed(3) : 0,
             pieces: _pieces.map(p => ({ key: p.c.key, slot: p.slot, off: p.off, landed: p.landed,
                                          x: p.body ? +p.body.position.x.toFixed(2) : p.x, y: p.body ? +p.body.position.y.toFixed(2) : 0 })),
             // How far anything has strayed out of the picture's plane: depth, and tilt toward the camera.
             depth: +Math.max(0, ..._pieces.filter(p => p.body).map(p => Math.abs(p.body.position.z))).toFixed(4),
             tilt: +Math.max(0, ..._pieces.filter(p => p.body).map(p => Math.hypot(p.body.quaternion.x, p.body.quaternion.y))).toFixed(4),
             physics: !!_world, gl: !!_stage?.gl, turned: !!_stage?.turned, hold: _stage?.hold };
}
/** Probes: stop the turn clock (and park the claw at x). */
export function _debugFreeze(on, x = null) {
    _frozen = !!on;
    if (x != null) _aim = Math.max(-AIM_RANGE, Math.min(AIM_RANGE, x));
}
/** Probes: where the slider's track and the DROP button are, in page pixels. */
export function _debugControls() {
    if (!_ui || !_stage) return null;
    const r = _stage.frame.getBoundingClientRect(), t = _ui.track(), b = _ui.button();
    return { l: r.left + t.l, r: r.left + t.r, y: r.top + _stage.height - 36, bx: r.left + b.x, by: r.top + b.y };
}
/** Probes: drop the held critter at plinth x = `x`, from code (any seat). */
export function _debugDropAt(x) { if (_phase === 'play' && _held && !_settle) _drop(x); }
/** Probes: put this critter (a CAST key) on the claw now, so a test stacks known shapes. */
export function _debugHold(key) {
    const c = CAST.find(x => x.key === key);
    if (!c || !_held || _settle) return;
    if (_held.mesh) { _held.mesh.parent?.remove(_held.mesh); _held.mesh = null; }
    _held = { c, reach: _reach(c), mesh: _stage?.gl ? _stage.add(_lookOf(c)) : null };
}
/** Probes: knock the last critter dropped sideways. */
// A hop as well as a push: a box sliding flat on a box is all friction in
// cannon.js, which eats a pure sideways shove before it reaches the edge.
export function _debugShove(vx, vy = 3) { const p = [..._pieces].reverse().find(q => q.body && !q.off); if (p) { p.body.wakeUp(); p.body.velocity.x = vx; p.body.velocity.y = vy; } }
/** Probes: set the play clock (there is no cap; a probe checks that). */
export function _debugClock(s) { _clock = s; }
/** Probes: the whole cast in rows in front of the machine, for a contact sheet. */
export function _debugLineup(cols = 4) {
    if (!_stage?.gl) return 0;
    _lineup = true; _frozen = true;
    if (_held?.mesh) _held.mesh.visible = false;
    const rows = Math.ceil(CAST.length / cols), dx = 1.7, dy = 1.35;
    CAST.forEach((c, i) => {
        const g = _lookOf(c), col = i % cols, row = Math.floor(i / cols);
        g.position.set((col - (cols - 1) / 2) * dx, 14 + (rows - 1 - row) * dy, 3);
        _stage.add(g);
    });
    const cy = 14 + (rows - 1) * dy / 2, cam = _stage.camera;
    const t = Math.tan(25 * Math.PI / 180), d = Math.max((rows * dy / 2 + 0.8) / t, (cols * dx / 2 + 0.6) / (t * cam.aspect));
    cam.position.set(0, cy, 3 + d);
    cam.lookAt(0, cy, 3);
    return CAST.length;
}
/** Probes: the cast's keys. */
export function _debugCast() { return CAST.map(c => c.key); }
/**
 * Probes: drop one critter on an empty plinth in a world of its own and let it
 * settle for 4 s. Where does it end up, and is it resting on the plinth?
 */
export function _debugSettleTest(key, x = 0) {
    const c = CAST.find(q => q.key === key);
    if (!c || typeof CANNON === 'undefined') return null;
    const saved = { world: _world, pieces: _pieces, mat: _plushMat };   // _buildWorld replaces the plush material
    const w = _buildWorld();
    const p = { c, body: _body(c), reach: _reach(c) };
    p.body.position.set(x, PLINTH_TOP + p.reach + 0.6, 0);
    w.addBody(p.body);
    _pieces = [p];
    for (let i = 0; i < 240; i++) w.step(1 / 60);
    _pieces = saved.pieces; _world = saved.world; _plushMat = saved.mat;
    const b = p.body;
    return { key, y: +b.position.y.toFixed(3), x: +b.position.x.toFixed(3), onPlinth: b.position.y > PLINTH_TOP && Math.abs(b.position.x) < PLINTH_W / 2,
             speed: +b.velocity.length().toFixed(3), depth: +Math.abs(b.position.z).toFixed(4) };
}
