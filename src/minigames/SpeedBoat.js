// ============================================================
// SPEED BOAT — one river, everybody on it, a camera each.
// For TWO, THREE OR FOUR on one screen.
//
// The river is SHARED: one course, one set of rocks, and boats
// that shove each other when they touch. What is partitioned is
// the VIEW — each seat's zone is a camera locked to its own boat,
// so four people race the same water without four playfields.
//
// Two things in one thumb:
//   DRAG sideways to steer across the river.
//   TAP to change gear — SLOW, CRUISE, FLAT OUT, and round again.
//
// And the whole game is in the tension between them. Flat out
// finishes the course in about fifteen seconds and is the fastest
// anything can go. It is also the gear in which the next line of
// rocks arrives before you can get across to the gap in it, and a
// hit at speed costs more than a hit at a crawl. Cruise takes a
// third longer and gets hit a quarter as often, which on the
// numbers below comes out ahead — so the thing a new player learns
// is that the throttle is a decision and not a direction.
//
// That is only true of an AVERAGE player. Somebody reading two
// lines of rocks ahead can hold flat out through a stretch they
// are already lined up for, and they will win. The gear is meant
// to be worth thinking about, not to have one right answer.
//
// It is drawn in 3D, on its own Three.js scene, with the seat
// zones rendered as VIEWPORTS of one scene rather than as separate
// pictures — that is what makes "a camera each" literally true
// instead of a figure of speech, and it costs one context and one
// scene however many people are playing.
//
// The simulation underneath is unchanged and deliberately still
// flat: everything moves in `u` (across, 0..1) and `d` (along, in
// river widths), and 3D is a projection of that. The tuning above
// was measured, and a renderer is not allowed to quietly change a
// number somebody raced against.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
//
// The world's unit of length is ONE RIVER WIDTH, across and along, so every
// number below is a fraction or a multiple of the thing on screen it describes.
const COURSE      = 30;     // river widths from the line to the flag
const GEARS       = [0.90, 1.40, 2.00];   // widths per second
const GEAR_NAME   = ['SLOW', 'CRUISE', 'FLAT OUT'];
// COURSE / top gear = 15 s, which is the brief: the fastest a clean run can be.
const STEER       = 0.50;   // widths per second across the river
const ROW_GAP     = 1.15;   // widths between lines of rocks
// The hole in a line of rocks, and how many of them there are. Two players race
// for one hole, which is the fight the game is about. Three or four cannot: a
// hole is not quite two boats wide, so a single one turns every row into a
// four-way shunt and the race becomes about who got there first rather than
// about the river. Above two seats each row gets two holes, narrower to keep the
// crossing honest, and the choice of WHICH hole is the new decision that
// replaces the queue.
// Two boats abreast need 0.26 of a river width, so a hole at two seats is 0.30:
// wide enough that both can go through it TOGETHER if they are level. At 0.24 it
// was not, and two boats aiming at the one hole simply jammed in front of it,
// shunting each other and going nowhere. A contested hole should be a race for
// the better line through it, not a door only one boat fits.
const GAP_W       = 0.30;   // width of a hole, at two seats
const GAP_W_MANY  = 0.26;   // ...and at three or four, where there are two
const GAP_MIN     = 0.14;   // a hole never hugs a bank, so there is always a
const GAP_MAX     = 0.86;   // way through from either side
// A hit stops you dead for this long, and it costs more the faster you were
// going. Without the speed term the top gear simply wins: it takes more hits but
// each one is the same price, and more speed beats more hits. Paying for the
// impact is what makes cruise the percentage play.
const HIT_BASE    = 0.70;   // s
const HIT_SPEED   = 1.30;   // s more, at full gear
const BUMP_PUSH   = 0.55;   // widths/s of shove when two boats touch
const BUMP_COST   = 0.35;   // s of stall for both of them
const BOAT_W      = 0.13;   // widths — the hull, for hit tests
const ROCK_R      = 0.075;  // widths
// How much of the river ahead a zone shows. Held constant in WORLD units rather
// than derived from the zone's shape: a two-player zone is wide and short and a
// four-player zone is narrow and tall, and if the visible distance came out of
// the pixels, the same gear would give two players different amounts of warning.
// The picture is stretched instead, which nobody racing notices and which keeps
// the game the same game on every seat count.
const VIEW_D      = 1.95;   // widths of river visible in a zone
const BOAT_Y      = 0.74;   // where your own boat sits down the zone
const MATCH_TIME  = 52;     // s hard ceiling; settles on distance
const FINISH_GRACE = 2600;  // ms the race runs on after the first boat lands

// ── The 3D world ─────────────────────────────────────────────────────────────
//
// One river width is U three-units, across AND along, so the world is not
// stretched the way the flat version's picture had to be. Everything in the
// simulation is still measured in river widths; these convert.
const U           = 10;                 // three-units per river width
const RIVER_W     = U;                  // the water between the banks
const COURSE_Z    = COURSE * U;         // start line to flag
const posX        = u => (u - 0.5) * RIVER_W;
const posZ        = d => -d * U;        // forward is -Z, the way a camera looks

// The chase camera. Close and low: it is a speedboat, and the horizon is not
// the interesting part of one.
const CAM_BACK    = 5.0;    // units behind the boat
const CAM_UP      = 2.5;    // units above the water
// How far ahead the camera aims. This sets where the boat sits in frame, and
// the boat has to sit high enough that its own wake is on screen — at 9 the
// hull was on the bottom edge and the foam behind it was never seen, which
// threw away the best cue the scene has that any of this is water.
const CAM_LOOK    = 7.6;
const CAM_FOV     = 58;
// A zone's SHAPE changes what a fixed camera shows, and it changes it in the
// worst direction. A four-player zone is half as wide as a two-player one, and
// with the vertical field fixed that halves the horizontal field too: the boat
// came out twice the size it should be and the banks were outside the frame, so
// a player could not see the river they were crossing.
//
// A wider lens alone fixes the width and distorts everything; moving the camera
// back alone fixes it and shows too much river. So both, in proportion to how
// narrow the zone is, tuned so a two-player zone is exactly the framing above
// (which is the one that was looked at and liked) and a four-player zone sees
// bank to bank at the boat's own distance.
const AR_REF      = 1.0;    // the aspect the framing above was judged at
const FOV_MAX     = 76;

// Fog does two jobs and they pull against each other.
//
// It is the PLANNING HORIZON: the flat version showed just under two river
// widths and no further, and the balance — cruise beating flat out — was
// measured against exactly that much warning. It is also the only thing that
// makes a river look like it goes somewhere.
//
// Two widths of visible river, tried first, gave a white wall forty units out
// and no river at all. So the horizon is longer than the flat version's and the
// race was RE-MEASURED against it rather than assumed; what keeps the top gear
// honest is that a buoy five widths away is a few pixels tall, so you can see
// that a line of rocks is coming a long way off and still cannot judge where
// its hole is until you are close.
const FOG_NEAR    = VIEW_D * U * 1.15;
const FOG_FAR     = VIEW_D * U * 5.60;
const FOG_COLOR   = 0x93b9cc;

let _renderer = null, _scene = null, _cam = null;
let _water = null, _waterBase = null, _waterMat = null, _envRT = null;
let _boatObjs = [];
let _hudCanvas = null;

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0, _t0 = 0;
let _W = 0, _H = 0;

let _n = 2;                 // slots, not seats
let _boats = [];            // { u, d, gear, stall, finished, hits, wake }
let _rows = [];             // { d, gaps } — a line of rocks with holes in it
let _gapW = GAP_W;          // this match's hole width, set from the seat count
let _zones = [];
let _drag = new Map();      // pointerId → { pid, x0, y0, u0, moved }
let _banner = '';
let _firstHome = 0;         // performance.now() when somebody crossed
let _botAim = [];

const _cleanups = [];
const _timers   = [];
function _after(fn, ms) {
    const id = setTimeout(() => { _timers.splice(_timers.indexOf(id), 1); fn(); }, ms);
    _timers.push(id);
    return id;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot; _botSkill = botSkill;
    _n = Math.max(2, Math.min(4, slotCount()));
    _last = 0; _elapsed = 0; _t0 = 0; _banner = ''; _firstHome = 0;
    _drag = new Map();
    _buildRiver();
    // Spread across the start line so nobody begins inside anybody else.
    _boats = Array.from({ length: _n }, (_, i) => ({
        u: (i + 1) / (_n + 1), d: 0, gear: 1, stall: 0, bumpAt: 0, wall: null,
        finished: 0, hits: 0, wake: 0,
    }));
    _botAim = new Array(_n).fill(0.5);
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── The river ────────────────────────────────────────────────────────────────
//
// Lines of rocks with a hole in each, and the hole moves between lines. That is
// the whole course: there is nothing to memorise and nothing to learn about a
// particular stretch, only the distance from where you are to where the next
// hole is, measured against the time your gear leaves you to get there.
function _buildRiver() {
    _rows = [];
    _gapW = _n > 2 ? GAP_W_MANY : GAP_W;
    const holes = _n > 2 ? 2 : 1;
    const span = GAP_MAX - GAP_MIN;
    // The first two widths are clear, so nobody is thrown into a wall of rock
    // before the boat has moved.
    for (let d = 2.4; d < COURSE - 1.2; d += ROW_GAP) {
        const gaps = [];
        if (holes === 1) {
            gaps.push(GAP_MIN + Math.random() * span);
        } else {
            // One hole in each half of the river, so the two are never so close
            // together that they read as one wide one.
            gaps.push(GAP_MIN + Math.random() * (span * 0.38));
            gaps.push(GAP_MIN + span * 0.62 + Math.random() * (span * 0.38));
        }
        _rows.push({ d, gaps });
    }
}

/**
 * True when a boat at lateral `u` would be in the rocks of row `r`.
 *
 * The whole HULL has to fit inside a hole, which is why the boat's half-width is
 * subtracted from the hole's rather than added to it. Added, the test passed any
 * boat that merely overlapped the hole at all — a window nearly half the river
 * wide, against a hole drawn a third that size. Boats sailed straight through
 * the rocks they were drawn hitting, nobody was ever slowed down, and the race
 * came down to the tie-break in the bump rule.
 */
function _blocked(r, u) {
    return !r.gaps.some(g => Math.abs(u - g) <= _gapW / 2 - BOAT_W / 2);
}

/** The hole in `r` that a boat at `u` is closest to. */
function _nearestGap(r, u) {
    let best = r.gaps[0], bd = Infinity;
    for (const g of r.gaps) {
        const d = Math.abs(g - u);
        if (d < bd) { bd = d; best = g; }
    }
    return best;
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#08131f;touch-action:none;';

    // The world, and then the HUD on a transparent 2D canvas over the top of
    // it. Two canvases rather than one because the readouts are per-seat, flat,
    // and rotated for whoever they belong to — none of which a 3D camera does
    // well, and all of which a 2D context does for free.
    _buildScene();
    _overlay.appendChild(_renderer.domElement);
    const rs = _renderer.domElement.style;
    rs.position = 'absolute'; rs.inset = '0'; rs.width = '100%'; rs.height = '100%';

    _hudCanvas = document.createElement('canvas');
    _hudCanvas.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    _overlay.appendChild(_hudCanvas);
    _canvas = _hudCanvas;
    _ctx = _hudCanvas.getContext('2d');

    // A press that travels is a steer; a press that does not is a gear change.
    // Both live in the same thumb because there is only one thumb — a quarter of
    // a phone does not have room for a wheel and a lever.
    const down = e => {
        if (_done) return;
        e.preventDefault();
        const r = _overlay.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const pid = _zoneAt(x, y);
        if (pid < 0 || isBotSlot(pid)) return;
        _drag.set(e.pointerId, { pid, x0: x, y0: y, u0: _boats[pid].u, moved: false });
    };
    const move = e => {
        const g = _drag.get(e.pointerId);
        if (!g || _done) return;
        e.preventDefault();
        const r = _overlay.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        if (Math.hypot(x - g.x0, y - g.y0) > 9) g.moved = true;
        const z = _zones[g.pid];
        if (!z) return;
        // A far seat holds the table upside down, so their sideways runs the
        // other way.
        const dx = (x - g.x0) / z.rect.w * (z.rot === 180 ? -1 : 1);
        _boats[g.pid].u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, g.u0 + dx));
    };
    const up = e => {
        const g = _drag.get(e.pointerId);
        if (!g) return;
        _drag.delete(e.pointerId);
        if (_done || g.moved) return;
        const b = _boats[g.pid];
        b.gear = (b.gear + 1) % GEARS.length;
        sfx('tick'); haptic([10]);
    };
    _overlay.addEventListener('pointerdown', down);
    _overlay.addEventListener('pointermove', move);
    _overlay.addEventListener('pointerup', up);
    _overlay.addEventListener('pointercancel', up);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', down));
    _cleanups.push(() => _overlay.removeEventListener('pointermove', move));
    _cleanups.push(() => _overlay.removeEventListener('pointerup', up));
    _cleanups.push(() => _overlay.removeEventListener('pointercancel', up));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'DRAG TO STEER · TAP TO CHANGE GEAR';
}

function _resize() {
    if (!_canvas || !_overlay) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    if (_renderer) { _renderer.setPixelRatio(Math.min(_dpr, 1.5)); _renderer.setSize(_W, _H, false); }
    _zones = zonesFor(_n, _W, _H);
}

function _zoneAt(x, y) {
    for (let i = 0; i < _zones.length; i++) {
        const r = _zones[i].rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    let best = -1, bestD = Infinity;
    _zones.forEach((z, i) => {
        const cy = z.rect.y + z.rect.h / 2;
        const d = Math.abs(y - cy) + (x < z.rect.x || x > z.rect.x + z.rect.w ? 1e4 : 0);
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

// ── Loop ──────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    // The STEP is clamped, because a long frame must not let a boat tunnel
    // through a line of rocks. The match CLOCK is not: it is wall time since the
    // first frame.
    //
    // Those used to be the same number — _elapsed was the sum of the clamped
    // steps — and that quietly made the length of a race depend on how fast the
    // device could draw it. Once this game became 3D, a software renderer took
    // three hundred milliseconds a frame, each one crediting the clock with a
    // hundred, and a fifty-second race took two and a half minutes of real time;
    // the arcade sweep timed out on it. A player waiting for a round to end is
    // waiting in seconds, not in frames.
    const dt = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now;
    if (!_t0) _t0 = now;
    _elapsed = (now - _t0) / 1000;

    for (let pid = 0; pid < _n; pid++) {
        if (isBotSlot(pid)) _botDrive(pid, dt);
        _run(pid, dt);
    }
    _bumps(dt);

    if (_firstHome && now - _firstHome > FINISH_GRACE) _settleOnDistance();
    else if (_boats.every(b => b.finished))            _settleOnDistance();
    else if (_elapsed >= MATCH_TIME)                   _settleOnDistance();

    _animateWater(_elapsed);
    _placeBoats(_elapsed);
    _render();
    _drawHud();
}

function _run(pid, dt) {
    const b = _boats[pid];
    if (b.finished) return;

    if (b.stall > 0) { b.stall = Math.max(0, b.stall - dt); b.wake = 0; return; }

    // PINNED. A boat that hit a line of rocks is stopped against it and stays
    // there until it has steered its hull over a hole — you do not reverse out
    // of a rock, you slide along it looking for the way through.
    //
    // Without this the boat was placed just short of the row and then simply
    // drove into it again on the next frame, faster than it could possibly
    // steer clear: the hit repeated forever and no boat ever finished the
    // course. Holding the pin makes the real cost of a hit the thing it should
    // be — the stall, plus however long it takes to find the gap — and steering
    // is what gets you out, which is the input the game already has.
    if (b.wall) {
        if (_blocked(b.wall, b.u)) { b.d = b.wall.d - ROCK_R; b.wake = 0; return; }
        b.wall = null;
    }

    const v = GEARS[b.gear];
    const before = b.d;
    b.d += v * dt;
    b.wake = v;

    // Rocks. Tested per row crossed rather than per frame, so a boat can never
    // step over a line of them however long the frame was.
    for (const r of _rows) {
        if (r.d <= before || r.d > b.d) continue;
        if (_blocked(r, b.u)) {
            b.d = r.d - ROCK_R;                       // stopped against it
            b.wall = r;
            b.stall = HIT_BASE + HIT_SPEED * (v / GEARS[GEARS.length - 1]);
            b.gear = 0;                               // and knocked out of gear
            b.hits++;
            sfx('land_bad');
            if (!isBotSlot(pid)) haptic([50, 40, 50]);
            break;
        }
    }

    if (b.d >= COURSE) {
        b.d = COURSE;
        b.finished = _elapsed;
        if (!_firstHome) {
            _firstHome = performance.now();
            _banner = `${_nameOf(pid)} TAKES IT`;
            sfx('mg_win');
        }
    }
}

// Hulls that overlap shove each other apart and both lose a beat. This is the
// only way one boat can act on another, and it is the reason the river is shared
// rather than four copies of the same water.
function _bumps(dt) {
    for (let a = 0; a < _n; a++) {
        for (let b = a + 1; b < _n; b++) {
            const A = _boats[a], B = _boats[b];
            if (A.finished || B.finished) continue;
            if (Math.abs(A.d - B.d) > BOAT_W * 1.9) continue;   // hull length
            const du = A.u - B.u;
            if (Math.abs(du) > BOAT_W) continue;
            const s = du === 0 ? (a < b ? -1 : 1) : Math.sign(du);
            A.u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, A.u + s * BUMP_PUSH * dt));
            B.u = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, B.u - s * BUMP_PUSH * dt));
            // The stall goes to whoever is BEHIND, not to both. Stalling both
            // meant two boats going for the same hole deadlocked in front of it,
            // each one's stall holding it there for the next collision — and it
            // is also just wrong: the boat that got there first is the one that
            // gets through. The follower pays for the contact it caused.
            // Level boats both pay. Handing the stall to "whoever is behind"
            // when the two are dead level meant handing it to the higher slot
            // every time, because that is how the comparison falls out on a
            // tie — and slot 0 then led forever. A length is a real lead; a
            // thousandth of one is not.
            const now = performance.now();
            const level = Math.abs(A.d - B.d) < BOAT_W * 0.5;
            const pays = level ? [A, B] : [A.d < B.d ? A : B];
            let hit = false;
            for (const p of pays) {
                if (p.stall > 0 || now - (p.bumpAt || 0) <= 500) continue;
                p.stall = BUMP_COST;
                p.bumpAt = now;
                hit = true;
            }
            if (hit) sfx('dice_land');
        }
    }
}

// ── Bot (§5) ──────────────────────────────────────────────────────────────────
//
// It plays the same two decisions a person does, badly in the same ways. It aims
// for the hole in the next line it can still reach, and it picks a gear from
// whether it is going to reach it — which is the reasoning the game is trying to
// teach, so a bot that did anything else would be teaching the wrong thing.
function _botDrive(pid, dt) {
    const b = _boats[pid];
    if (b.finished) return;
    // Note it steers while stalled and while pinned. A boat sitting against the
    // rocks that could not turn its wheel would sit there forever, and a person
    // holding the screen can steer whenever they like.

    const next = b.wall || _rows.find(r => r.d > b.d + ROCK_R);
    if (!next) { b.gear = GEARS.length - 1; return; }

    const gap = _nearestGap(next, b.u);
    // How far off a hole's centre a HULL can sit and still get through. Every
    // aim below is clamped inside it, which matters more than it looks: a target
    // outside this window does not free the boat, so a boat pinned against the
    // rocks steering at one would sit there for the rest of the race. Nothing
    // the bot aims at may be somewhere that cannot work.
    const tol = Math.max(0.01, _gapW / 2 - BOAT_W / 2);

    let aim;
    if (b.wall) {
        // Already on the rocks. Finding the hole is the one moment not to be
        // sloppy about it — the error below exists to make the bot MISS
        // sometimes, not to make it stuck.
        aim = gap;
    } else {
        // A racing line, not the middle of the hole: every boat aiming at the
        // exact centre of the same hole is every boat in the same place, and
        // half a hull off centre, one each way, is how two of them fit through
        // it abreast. The error is re-rolled per row rather than per frame — a
        // bot whose aim jitters every frame is a bot that never commits.
        const err  = (1 - _botSkill) * 0.16 * (Math.random() + Math.random() - 1);
        const side = (pid % 2 ? 1 : -1) * BOAT_W / 2;
        aim = gap + side + err;
    }
    aim = Math.max(gap - tol * 0.92, Math.min(gap + tol * 0.92, aim));
    _botAim[pid] = Math.max(BOAT_W / 2, Math.min(1 - BOAT_W / 2, aim));

    const need = Math.abs(_botAim[pid] - b.u);
    // The fastest gear that still leaves time to get across. A weak bot
    // overestimates how much time it has, which is exactly the mistake the game
    // is built to punish.
    const slack = 1 + (1 - _botSkill) * 0.55;
    let want = 0;
    for (let g = GEARS.length - 1; g >= 0; g--) {
        const t = (next.d - b.d) / GEARS[g];
        if (STEER * t * slack >= need) { want = g; break; }
    }
    b.gear = want;

    const step = STEER * dt;
    const dv = _botAim[pid] - b.u;
    b.u += Math.max(-step, Math.min(step, dv));
}

// ── End ───────────────────────────────────────────────────────────────────────
function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

/** One number per boat, bigger is better: finishers first, by their time. */
function _standings() {
    return _boats.map(b => (b.finished ? 1e6 - b.finished * 100 : b.d));
}

function _settleOnDistance() {
    if (_done) return;
    const sc = _standings();
    const top = Math.max(...sc);
    const tied = sc.reduce((a, v, i) => (v === top ? [...a, i] : a), []);
    _settle(tied.length === 1 ? tied[0] : -1, sc);
}

function _settle(winnerId, sc) {
    if (_done) return;
    _done = true;
    state.mgActive = false;
    _banner = winnerId < 0 ? 'DEAD HEAT!' : `${_nameOf(winnerId)} WINS!`;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = _banner;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win'); haptic('heavy');
    _after(() => { _destroy(); _onWin(winnerId, null, sc.slice(0, _n)); }, 1400);
}

// ── The scene ─────────────────────────────────────────────────────────────────
const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];
const SLOT_HEX    = [0xff5a5a, 0x5a9bff, 0x5fd68a, 0xffd45f];

function _buildScene() {
    _renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    // 1.5, not 2. This scene is drawn once per seat per frame, so at four seats
    // the fill cost is four times a normal minigame's, and the difference
    // between 1.5x and 2x is a third of every pixel for a sharpness nobody can
    // see on a low-poly river.
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    _renderer.setSize(_overlay.clientWidth || 412, _overlay.clientHeight || 800, false);
    _renderer.shadowMap.enabled = false;   // four viewports; shadows are not worth it

    _scene = new THREE.Scene();
    _scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    _scene.background = new THREE.Color(FOG_COLOR);
    _cam = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.5, 900);

    // Light: a low sun down the river so the water has a specular path running
    // toward the camera. That streak is most of what makes a surface read as
    // water rather than as a coloured floor.
    _scene.add(new THREE.HemisphereLight(0xbfe0f5, 0x21414f, 0.72));
    const sun = new THREE.DirectionalLight(0xfff2d8, 0.62);
    // Well off to one side. Straight down the river it put its highlight in the
    // middle of the lane and blew the whole centre of the picture out to white —
    // the specular path is what makes water look wet, and it is also what will
    // flood the screen if you point it at the camera.
    sun.position.set(-85, 48, -34);
    _scene.add(sun);

    // The sky, and then the sky AS LIGHT. Everything below reflects it, which
    // is the whole reason the water looks like water — see _addWater.
    const skyTex = _addSky();
    _envFromSky(skyTex);
    _addWater();
    _addBanks();
    _addRocks();
    _addFinish();
    _addBoats();
}

/**
 * A vertical gradient on the inside of a big sphere, with a sun in it.
 *
 * `fog = false` keeps it out of the haze — everything else fades INTO this,
 * which is what makes the haze look like distance rather than a grey wash. The
 * sun blob is not for looking at directly; it is there so the environment map
 * built from this has a bright spot to scatter across the water.
 */
function _addSky() {
    const W = 256, H = 128;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    const g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0.00, '#2f6ea8');
    g.addColorStop(0.42, '#79aac9');
    g.addColorStop(0.62, '#a8c9d9');
    g.addColorStop(1.00, '#c6dae2');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    const sx = W * 0.17, sy = H * 0.30;
    const sun = cx.createRadialGradient(sx, sy, 0, sx, sy, H * 0.44);
    sun.addColorStop(0.00, 'rgba(255,250,228,1)');
    sun.addColorStop(0.22, 'rgba(255,240,200,0.55)');
    sun.addColorStop(1.00, 'rgba(255,235,190,0)');
    cx.fillStyle = sun; cx.fillRect(0, 0, W, H);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(700, 16, 10),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
    );
    _scene.add(sky);
    return tex;
}

/**
 * The sky, prefiltered into an environment map.
 *
 * This is the change that made the water stop looking like a painted floor, and
 * it is worth saying why, because two obvious fixes had already failed. With a
 * low roughness and a DIRECTIONAL light, the sun's highlight blew the centre of
 * the river out to white. Turning the roughness up killed the highlight and left
 * dark grey asphalt. Neither is wrong about water, they are both wrong about
 * what water is REFLECTING: a sky, not a lamp.
 *
 * Given the sky as an environment, a nearly-smooth surface reflects it — softly
 * overhead and almost mirror-bright at the grazing angle a chase camera looks
 * down a river at, because Fresnel does that for free. The bright sun blob in
 * the gradient becomes a broken glitter path across the ripples. Nothing else in
 * the scene had to change.
 */
function _envFromSky(skyTex) {
    try {
        const pmrem = new THREE.PMREMGenerator(_renderer);
        pmrem.compileEquirectangularShader();
        _envRT = pmrem.fromEquirectangular(skyTex);
        _scene.environment = _envRT.texture;
        pmrem.dispose();
    } catch (e) {
        // Prefiltering is a nicety, not a requirement. If this build of three
        // cannot do it, the scene still renders — flatter, but it renders.
        _envRT = null;
    }
}

/**
 * A tiling ripple normal map, generated rather than loaded.
 *
 * Built from sine waves at INTEGER frequencies across the canvas, which is what
 * makes it tile without a seam, and turned into normals by finite differences on
 * that height field. Scrolled every frame, this is what carries the fine detail
 * of the surface — the geometry underneath is deliberately coarse, because the
 * eye reads water off its highlights and not off its silhouette.
 */
function _rippleNormals(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx2 = c.getContext('2d');
    const img = ctx2.createImageData(size, size);
    const waves = [
        { kx: 3, ky: 2, a: 1.00, p: 0.0 },
        { kx: -2, ky: 5, a: 0.70, p: 1.7 },
        { kx: 7, ky: -3, a: 0.42, p: 3.1 },
        { kx: 5, ky: 9, a: 0.26, p: 0.9 },
        { kx: -11, ky: 6, a: 0.16, p: 2.2 },
    ];
    const h = (x, y) => {
        let v = 0;
        for (const w of waves) {
            v += w.a * Math.sin(2 * Math.PI * (w.kx * x / size + w.ky * y / size) + w.p);
        }
        return v;
    };
    const S = 0.55;   // how pronounced the ripples are
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const hl = h((x - 1 + size) % size, y), hr = h((x + 1) % size, y);
            const hd = h(x, (y - 1 + size) % size), hu = h(x, (y + 1) % size);
            let nx = (hl - hr) * S, ny = (hd - hu) * S, nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;
            const i = (y * size + x) * 4;
            img.data[i]     = (nx * 0.5 + 0.5) * 255;
            img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
            img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
            img.data[i + 3] = 255;
        }
    }
    ctx2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

function _addWater() {
    const w = 78, len = COURSE_Z + 160;
    // Coarse on purpose. The swell below moves these vertices for parallax and
    // for the horizon's silhouette; the ripples people actually see are in the
    // normal map, which costs nothing per frame to scroll.
    const geo = new THREE.PlaneGeometry(w, len, 20, 90);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -COURSE_Z / 2 + 40);
    _waterBase = Float32Array.from(geo.attributes.position.array);

    // Ripples big enough to read as ripples. At one tile every seven units the
    // surface came out as crumpled foil — a hard cyan sparkle with a grain far
    // finer than anything on real water at this distance — so the tile is more
    // than twice as wide now and the normals are a third as deep. Water is
    // mostly a dark mirror with a few bright lines on it; the temptation is to
    // turn everything up, and turning it up is exactly what made it metal.
    const nrm = _rippleNormals(256);
    nrm.repeat.set(w / 15, len / 15);
    // Dark water, smooth water. The colour is what you see looking straight
    // down into it and the sky is what you see looking along it; the roughness
    // is low because that is what lets the environment map do the work.
    _waterMat = new THREE.MeshStandardMaterial({
        color: 0x0a3446,
        roughness: 0.17,
        metalness: 0.0,
        normalMap: nrm,
        envMapIntensity: 1.15,
    });
    _waterMat.normalScale.set(0.5, 0.5);
    _water = new THREE.Mesh(geo, _waterMat);
    _scene.add(_water);
}

// The swell, as one function of place and time. The water plane is displaced by
// it and every boat is floated on it, so a hull always sits on the surface it is
// drawn against rather than on an average of it.
function _waveH(x, z, t) {
    return Math.sin(x * 0.085 + t * 1.15) * 0.30
         + Math.sin(z * 0.055 - t * 1.70) * 0.42
         + Math.sin((x * 0.041 + z * 0.052) + t * 0.75) * 0.26;
}

function _animateWater(t) {
    if (!_water) return;
    const pos = _water.geometry.attributes.position;
    const a = pos.array;
    for (let i = 0; i < a.length; i += 3) {
        a[i + 1] = _waterBase[i + 1] + _waveH(_waterBase[i], _waterBase[i + 2], t);
    }
    pos.needsUpdate = true;
    // Two scroll rates on one map: the surface drifts downstream while the
    // ripples run across it, which is enough to stop the pattern reading as a
    // sheet of wallpaper sliding past.
    _waterMat.normalMap.offset.set(Math.sin(t * 0.13) * 0.06, -t * 0.045);
}

// Everything from here down names its own `envMapIntensity`, and the reason is
// worth one comment rather than twelve. Giving the scene a sky as an environment
// lit the WATER beautifully and washed everything else out with it — rock went
// pale blue, the banks went acid green, and a red hull came out pink. Only the
// water is supposed to be a mirror. Everything else gets a fraction of the sky,
// which is what a rough surface actually reflects.
const ENV_MATTE = 0.22;   // rock, earth, foliage
const ENV_PAINT = 0.42;   // painted or moulded surfaces

function _addBanks() {
    const len = COURSE_Z + 200;
    const bankGeo = new THREE.BoxGeometry(26, 3.4, len);
    const bankMat = new THREE.MeshStandardMaterial({ color: 0x3d5b33, roughness: 1, envMapIntensity: ENV_MATTE });
    for (const s of [-1, 1]) {
        const m = new THREE.Mesh(bankGeo.clone(), bankMat);
        m.position.set(s * (RIVER_W / 2 + 13), 0.4, -COURSE_Z / 2 + 40);
        _scene.add(m);
    }
    // A lip of wet sand at the waterline, so the bank meets the river instead of
    // being a wall standing in it.
    const lipGeo = new THREE.BoxGeometry(2.2, 0.7, len);
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 1, envMapIntensity: ENV_MATTE });
    for (const s of [-1, 1]) {
        const m = new THREE.Mesh(lipGeo.clone(), lipMat);
        m.position.set(s * (RIVER_W / 2 + 0.9), 0.15, -COURSE_Z / 2 + 40);
        _scene.add(m);
    }

    // Trees, as one instanced draw for the lot. They exist for MOTION: at speed
    // the bank streaming past is the only thing telling you how fast you are
    // going, because the water itself has no landmarks in it.
    // Dark, because they have to survive the haze. At the green they started
    // out they fogged to within a shade of the sky by the middle distance and
    // the treeline read as a row of pale gaps rather than as trees.
    const n = 110;
    const tree = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1.6, 7.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x1b3a22, roughness: 1, flatShading: true, envMapIntensity: ENV_MATTE }),
        n,
    );
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1;
        const z = 30 - (i / n) * (COURSE_Z + 150) - Math.random() * 6;
        const k = 0.72 + Math.random() * 0.65;
        pos.set(side * (RIVER_W / 2 + 3.5 + Math.random() * 9), 2.0 + k * 2.6, z);
        scl.set(k, k, k);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
        tree.setMatrixAt(i, m4.compose(pos, q, scl));
    }
    tree.instanceMatrix.needsUpdate = true;
    _scene.add(tree);
}

/**
 * The rocks, and the buoys that mark the way through.
 *
 * Both are instanced: one draw call each for the whole river, which matters
 * because the scene is rendered once per seat and a four-player round draws it
 * four times a frame.
 *
 * The buoys are the important half. A hole is an ABSENCE, and an absence is not
 * something anybody picks out of a dark line at speed — the flat version drew a
 * green bar across it for exactly this reason. In 3D the same job is done by two
 * posts standing in the water, which read as a gate from any angle and get
 * swallowed by the haze at the same distance everything else does.
 */
function _addRocks() {
    const per = [];
    for (const r of _rows) {
        const holes = r.gaps.map(g => [g - _gapW / 2, g + _gapW / 2]).sort((a, b) => a[0] - b[0]);
        let u = 0;
        const spans = [];
        for (const [h0, h1] of holes) { spans.push([u, h0]); u = h1; }
        spans.push([u, 1]);
        for (const [a, b] of spans) {
            const step = ROCK_R * 1.55;
            for (let x = a + ROCK_R * 0.5; x < b - ROCK_R * 0.1; x += step) per.push({ u: x, d: r.d });
        }
    }
    const rock = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(ROCK_R * U * 1.25, 0),
        new THREE.MeshStandardMaterial({ color: 0x555f6b, roughness: 0.95, flatShading: true, envMapIntensity: ENV_MATTE }),
        Math.max(1, per.length),
    );
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pv = new THREE.Vector3(), sv = new THREE.Vector3();
    per.forEach((p, i) => {
        const seed = Math.sin(i * 12.9898) * 43758.5453;
        const f = seed - Math.floor(seed);
        pv.set(posX(p.u), -0.15 + f * 0.5, posZ(p.d));
        sv.set(0.75 + f * 0.6, 0.6 + f * 0.5, 0.8 + f * 0.5);
        q.setFromEuler(new THREE.Euler(f * 3, f * 5, f * 2));
        rock.setMatrixAt(i, m4.compose(pv, q, sv));
    });
    rock.instanceMatrix.needsUpdate = true;
    _scene.add(rock);

    const posts = [];
    for (const r of _rows) for (const g of r.gaps) {
        posts.push({ u: g - _gapW / 2, d: r.d }, { u: g + _gapW / 2, d: r.d });
    }
    const buoy = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.19, 0.30, 2.9, 7),
        new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0x7a5600, roughness: 0.45, envMapIntensity: ENV_PAINT }),
        Math.max(1, posts.length),
    );
    posts.forEach((p, i) => {
        pv.set(posX(p.u), 0.95, posZ(p.d));
        sv.set(1, 1, 1);
        q.identity();
        buoy.setMatrixAt(i, m4.compose(pv, q, sv));
    });
    buoy.instanceMatrix.needsUpdate = true;
    _scene.add(buoy);
}

function _addFinish() {
    const mat = [
        new THREE.MeshStandardMaterial({ color: 0xf4f7ff, roughness: 0.6, envMapIntensity: ENV_PAINT }),
        new THREE.MeshStandardMaterial({ color: 0x1a1f2b, roughness: 0.6, envMapIntensity: ENV_PAINT }),
    ];
    const geo = new THREE.BoxGeometry(RIVER_W / 10, 0.9, 1.6);
    for (let k = 0; k < 10; k++) {
        const m = new THREE.Mesh(geo.clone(), mat[k % 2]);
        m.position.set(-RIVER_W / 2 + RIVER_W / 20 + k * (RIVER_W / 10), 0.45, posZ(COURSE));
        _scene.add(m);
    }
    // Two pylons, so the flag is visible over the rocks before you reach it.
    const pyGeo = new THREE.CylinderGeometry(0.5, 0.7, 11, 8);
    const pyMat = new THREE.MeshStandardMaterial({ color: 0xf05b4a, roughness: 0.7, envMapIntensity: ENV_PAINT });
    for (const s of [-1, 1]) {
        const m = new THREE.Mesh(pyGeo.clone(), pyMat);
        m.position.set(s * (RIVER_W / 2 + 1.2), 5.5, posZ(COURSE));
        _scene.add(m);
    }
}

/**
 * A speedboat hull, lofted from stations.
 *
 * Not a box and not a cone: a boat is one of the shapes everybody has seen, and
 * a wrong one is noticed immediately even by somebody who could not say what is
 * wrong with it. So the hull is built the way a hull is drawn — a cross-section
 * swept along the centreline, narrowing and lifting toward the bow, with a deep
 * V forward that flattens aft. Seven stations of eight points is fifty-six
 * vertices, which is nothing, and it is unmistakably a boat.
 */
function _hullGeometry(len, halfW, depth) {
    // One cross-section, as fractions: keel, chines, gunwales, deck crown.
    const SECTION = [
        [0.00, -1.00], [0.55, -0.62], [1.00, -0.08], [1.00, 0.42],
        [0.00, 0.58], [-1.00, 0.42], [-1.00, -0.08], [-0.55, -0.62],
    ];
    // t runs 0 at the bow to 1 at the transom.
    const STATIONS = [0, 0.07, 0.18, 0.34, 0.54, 0.76, 1.0];
    const widthAt = t => 0.10 + 0.90 * Math.pow(Math.sin(Math.min(1, t * 1.12) * Math.PI / 2), 0.75);
    const keelAt  = t => 0.34 + 0.66 * Math.pow(Math.min(1, t * 1.5), 0.8);
    const sheerAt = t => 0.42 * Math.pow(1 - t, 1.6);   // the bow rides higher

    const verts = [], idx = [];
    const ring = SECTION.length;
    STATIONS.forEach(t => {
        const hw = halfW * widthAt(t), kd = depth * keelAt(t), sh = depth * sheerAt(t);
        const z = -len * (0.5 - t);      // bow at -len/2 (forward), transom at +len/2
        SECTION.forEach(([sx, sy]) => {
            verts.push(sx * hw, (sy < 0 ? sy * kd : sy * depth) + sh, z);
        });
    });
    for (let s = 0; s < STATIONS.length - 1; s++) {
        for (let k = 0; k < ring; k++) {
            const a = s * ring + k, b = s * ring + (k + 1) % ring;
            const c = (s + 1) * ring + k, d = (s + 1) * ring + (k + 1) % ring;
            idx.push(a, c, b, b, c, d);
        }
    }
    // Cap the transom so the stern is not an open tube.
    const base = (STATIONS.length - 1) * ring;
    for (let k = 1; k < ring - 1; k++) idx.push(base, base + k, base + k + 1);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
}

function _makeBoat(pid) {
    const g = new THREE.Group();
    const len = BOAT_W * 1.95 * U, halfW = BOAT_W * U / 2, depth = BOAT_W * U * 0.46;
    const hue = SLOT_HEX[pid] || 0xffffff;

    const hull = new THREE.Mesh(
        _hullGeometry(len, halfW, depth),
        new THREE.MeshStandardMaterial({ color: hue, roughness: 0.32, metalness: 0.08, flatShading: true, envMapIntensity: ENV_PAINT }),
    );
    g.add(hull);

    // A white deck sunk into the sheer, which is what stops the hull reading as
    // a solid lozenge from the one angle the player always sees it from.
    // Both of these were big enough to bury the hull: from the one angle the
    // player ever sees the boat from, a wide white deck and a deep black
    // cockpit were the whole object and the coloured hull was a thin trim round
    // the outside. The slot colour has to be the thing you recognise, so the
    // deck is narrower and the cockpit is a footwell rather than a hold.
    // Narrow and set back, so the hull's taper is what you see at the bow. A
    // wide deck plate reaching forward made the boat read as a blunt hexagon
    // from the one angle it is ever seen from.
    const deck = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 0.78, 0.09, len * 0.30),
        new THREE.MeshStandardMaterial({ color: 0xd8e2ec, roughness: 0.6, envMapIntensity: ENV_PAINT }),
    );
    deck.position.set(0, depth * 0.60, len * 0.16);
    g.add(deck);

    const pit = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 0.62, 0.34, len * 0.15),
        new THREE.MeshStandardMaterial({ color: 0x16222f, roughness: 0.9, envMapIntensity: ENV_MATTE }),
    );
    pit.position.set(0, depth * 0.62, len * 0.15);
    g.add(pit);

    const glass = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 0.92, 0.34, 0.07),
        new THREE.MeshStandardMaterial({
            color: 0xbfe4ff, roughness: 0.08, metalness: 0.35,
            transparent: true, opacity: 0.45, envMapIntensity: 1.0,
        }),
    );
    glass.position.set(0, depth * 0.62 + 0.17, len * 0.02);
    glass.rotation.x = -0.40;
    g.add(glass);

    // Small. At 0.85 tall this stood higher than the hull it was bolted to and,
    // since the stern is the end nearest the camera, a black slab was the first
    // thing anybody saw of their own boat.
    const motor = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 0.46, 0.40, 0.34),
        new THREE.MeshStandardMaterial({ color: 0x22262e, roughness: 0.7, envMapIntensity: ENV_MATTE }),
    );
    motor.position.set(0, depth * 0.52, len * 0.52);
    g.add(motor);

    // Wake: a quad on the water behind the transom, stretched by speed. It is
    // drawn without writing depth so it lies ON the swell instead of fighting
    // the water plane for the same pixels.
    const wake = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
            map: _foamTexture(), transparent: true, opacity: 0.0,
            depthWrite: false, fog: true,
        }),
    );
    wake.rotation.x = -Math.PI / 2;

    // The holder sits at the boat's position on the flat river; the body heaves
    // and heels inside it, and the wake stays level with the water rather than
    // rolling with the hull. Both are read off `holder.userData`, which is the
    // only place _placeBoats looks.
    const holder = new THREE.Group();
    holder.add(g);
    holder.add(wake);
    holder.userData.body = g;
    holder.userData.wake = wake;
    holder.userData.hull = hull;
    return holder;
}

// A soft white streak, widening away from the transom.
function _foamTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 128;
    const x = c.getContext('2d');
    const img = x.createImageData(64, 128);
    for (let j = 0; j < 128; j++) {
        const along = j / 127;                        // 0 at the transom
        // Two lobes rather than one wedge: a wake is a pair of diverging bow
        // waves with disturbed water between them, and drawing it as a single
        // solid triangle is what made it read as a beam.
        const spread = 0.20 + along * 0.74;
        const fade = Math.pow(1 - along, 1.2) * Math.min(1, along * 6);
        for (let i = 0; i < 64; i++) {
            const u2 = (i / 63) * 2 - 1;
            const arm = Math.exp(-Math.pow((Math.abs(u2) - spread * 0.82) / 0.26, 2));
            const wash = Math.max(0, 1 - Math.abs(u2) / spread) * 0.35;
            const noise = 0.80 + 0.20 * Math.sin(i * 1.3 + j * 0.45);
            const k = (j * 64 + i) * 4;
            img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
            img.data[k + 3] = Math.max(0, Math.min(255, (arm + wash) * fade * noise * 255));
        }
    }
    x.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
}

function _addBoats() {
    _boatObjs = [];
    for (let i = 0; i < _n; i++) {
        const o = _makeBoat(i);
        _scene.add(o);
        _boatObjs.push(o);
    }
}

/**
 * Put every boat where the simulation says it is, and let the water decide the
 * rest — height, pitch and roll all come from sampling `_waveH` at the hull's
 * own bow, stern and beam. A boat that heaves on the same swell the surface is
 * drawn with is the single strongest cue that this is water; a boat sliding at a
 * fixed height across a moving texture reads as a sticker every time.
 */
function _placeBoats(t) {
    const len = BOAT_W * 1.95 * U;
    for (let i = 0; i < _n; i++) {
        const b = _boats[i], o = _boatObjs[i];
        if (!o) continue;
        const x = posX(b.u), z = posZ(b.d);
        const hMid = _waveH(x, z, t);
        const hBow = _waveH(x, z - len * 0.5, t);
        const hAft = _waveH(x, z + len * 0.5, t);
        const hPort = _waveH(x - BOAT_W * U * 0.5, z, t);
        const hStbd = _waveH(x + BOAT_W * U * 0.5, z, t);

        const body = o.userData.body;
        o.position.set(x, 0, z);
        body.position.y = hMid + 0.18;
        body.rotation.x = Math.atan2(hAft - hBow, len) * 0.75;
        body.rotation.z = Math.atan2(hPort - hStbd, BOAT_W * U) * 0.75;
        // Nose up under power, and a shove sideways when it is being bumped.
        body.rotation.x -= (b.stall > 0 ? -0.10 : b.wake * 0.055);
        body.rotation.y = b.stall > 0 ? Math.sin(t * 22) * 0.09 : 0;

        // Foam, not a searchlight. At two and a half hull-lengths and an
        // opacity of point six this ran past the camera and off the bottom of
        // the zone as a hard white beam — the chase camera sits BEHIND the boat,
        // so your own wake is always in the foreground and anything overdone
        // about it is overdone right in front of your face.
        const wake = o.userData.wake;
        const spd = b.stall > 0 ? 0 : b.wake;
        const wlen = len * (0.9 + spd * 1.15);
        wake.scale.set(BOAT_W * U * (1.15 + spd * 0.55), wlen, 1);
        wake.position.set(0, hMid + 0.06, len * 0.5 + wlen * 0.5);
        wake.material.opacity = Math.min(0.38, spd * 0.21);
        wake.visible = spd > 0.02;
    }
}

/**
 * One scene, one pass per seat, scissored to that seat's zone.
 *
 * A far seat gets its camera rolled over rather than its picture flipped: with
 * `up` pointing down, `lookAt` produces exactly the view somebody sitting on the
 * other side of the table should have, and the water, the haze and the lighting
 * all stay correct — which they would not if the finished image were mirrored.
 */
function _render() {
    if (!_renderer || !_scene || !_cam) return;
    if (!_zones.length) _zones = zonesFor(_n, _W, _H);
    _renderer.setScissorTest(true);
    const look = new THREE.Vector3();
    for (let pid = 0; pid < _n; pid++) {
        const z = _zones[pid], r = z.rect, b = _boats[pid];
        if (!r || !b) continue;
        const vy = _H - (r.y + r.h);          // WebGL counts up from the bottom
        _renderer.setViewport(r.x, vy, r.w, r.h);
        _renderer.setScissor(r.x, vy, r.w, r.h);

        const bx = posX(b.u), bz = posZ(b.d);
        const aspect = r.w / Math.max(1, r.h);
        const k = Math.min(2.2, Math.max(1, AR_REF / aspect));   // how narrow this zone is
        _cam.aspect = aspect;
        _cam.fov = Math.min(FOV_MAX, CAM_FOV * (0.82 + 0.18 * k));
        _cam.up.set(0, z.rot === 180 ? -1 : 1, 0);
        _cam.position.set(
            bx * 0.72,
            CAM_UP * (0.80 + 0.20 * k) + _waveH(bx, bz, _elapsed) * 0.35,
            bz + CAM_BACK * (0.55 + 0.45 * k),
        );
        look.set(bx * 0.35, 0.9, bz - CAM_LOOK);
        _cam.lookAt(look);
        _cam.updateProjectionMatrix();
        _renderer.render(_scene, _cam);
    }
    _renderer.setScissorTest(false);
}

// ── HUD (2D, over the top) ────────────────────────────────────────────────────
function _drawHud() {
    const ctx = _ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, _W, _H);
    if (!_zones.length) _zones = zonesFor(_n, _W, _H);

    _zones.forEach((z, pid) => {
        const r = z.rect;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        if (z.rot === 180) { ctx.translate(r.x + r.w, r.y + r.h); ctx.rotate(Math.PI); }
        else               { ctx.translate(r.x, r.y); }
        _hud(pid, r.w, r.h, SLOT_ACCENT[pid] || '#ffffff');
        ctx.restore();
    });

    // Zone edges, so several cameras on the same river do not read as one
    // picture with a seam in it.
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
    _zones.forEach(z => ctx.strokeRect(z.rect.x + 0.5, z.rect.y + 0.5, z.rect.w - 1, z.rect.h - 1));
}

function _hud(pid, zw, zh, accent) {
    const ctx = _ctx;
    const me = _boats[pid];
    const sc = _standings();
    const place = 1 + sc.filter(v => v > sc[pid]).length;
    const small = zw < 300;

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `900 ${small ? 16 : 20}px "Bebas Neue", sans-serif`;
    ctx.fillStyle = me.stall > 0 ? '#ef4444' : accent;
    ctx.fillText(me.stall > 0 ? 'HIT!' : GEAR_NAME[me.gear], 12, zh - 30);

    ctx.textAlign = 'right';
    ctx.fillStyle = accent;
    ctx.fillText(`${place}${['ST', 'ND', 'RD', 'TH'][Math.min(place - 1, 3)]}`, zw - 12, zh - 30);

    // The ladder: the whole course as a line, with a pip per boat on it.
    const lw = zw - 24, lx = 12, ly = zh - 16;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    _rrect(ctx, lx, ly, lw, 6, 3); ctx.fill();
    for (let i = 0; i < _n; i++) {
        const b = _boats[i];
        const px = lx + lw * Math.min(1, b.d / COURSE);
        ctx.beginPath();
        ctx.arc(px, ly + 3, i === pid ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = SLOT_ACCENT[i] || '#fff';
        ctx.globalAlpha = i === pid ? 1 : 0.65;
        ctx.fill();
        ctx.globalAlpha = 1;
    }

    if (_banner) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `900 ${small ? 20 : 26}px "Bebas Neue", sans-serif`;
        const tw = ctx.measureText(_banner).width + 26;
        ctx.fillStyle = 'rgba(0,0,0,.62)';
        _rrect(ctx, zw / 2 - tw / 2, zh * 0.34 - 18, tw, 36, 9); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(_banner, zw / 2, zh * 0.34);
    }
}

function _rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
function _destroy() {
    _done = true;
    _timers.forEach(clearTimeout); _timers.length = 0;
    _cleanups.forEach(f => { try { f(); } catch (e) {} }); _cleanups.length = 0;
    if (_af) { cancelAnimationFrame(_af); _af = null; }
    // Every geometry, material and texture this scene made, given back. A
    // minigame borrows a WebGL context from a board that wants it back — see
    // the same courtesy in TreeClimb — so the context is dropped explicitly
    // rather than left for the collector to notice eventually.
    if (_scene) {
        _scene.traverse(o => {
            if (o.geometry) o.geometry.dispose();
            const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
            ms.forEach(m => {
                ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap'].forEach(k => {
                    if (m[k]) m[k].dispose();
                });
                m.dispose();
            });
        });
        _scene.clear(); _scene = null;
    }
    if (_envRT) { _envRT.dispose(); _envRT = null; }
    if (_renderer) {
        const gl = _renderer.getContext();
        _renderer.dispose();
        try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {}
        _renderer = null;
    }
    _cam = null; _water = null; _waterBase = null; _waterMat = null; _boatObjs = [];
    _ctx = null; _canvas = null; _hudCanvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _t0 = 0; _boats = []; _rows = []; _zones = []; _drag = new Map();
}
