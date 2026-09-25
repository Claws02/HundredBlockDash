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

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _elapsed = 0;
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
    _last = 0; _elapsed = 0; _banner = ''; _firstHome = 0;
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

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

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
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    _W = _overlay.clientWidth; _H = _overlay.clientHeight;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
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
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _elapsed += dt;

    for (let pid = 0; pid < _n; pid++) {
        if (isBotSlot(pid)) _botDrive(pid, dt);
        _run(pid, dt);
    }
    _bumps(dt);

    if (_firstHome && now - _firstHome > FINISH_GRACE) _settleOnDistance();
    else if (_boats.every(b => b.finished))            _settleOnDistance();
    else if (_elapsed >= MATCH_TIME)                   _settleOnDistance();

    _draw();
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

// ── Draw ──────────────────────────────────────────────────────────────────────
const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _draw() {
    const ctx = _ctx;
    ctx.clearRect(0, 0, _W, _H);
    if (!_zones.length) _zones = zonesFor(_n, _W, _H);

    _zones.forEach((z, pid) => {
        const r = z.rect;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        if (z.rot === 180) { ctx.translate(r.x + r.w, r.y + r.h); ctx.rotate(Math.PI); }
        else               { ctx.translate(r.x, r.y); }
        _camera(pid, r.w, r.h);
        ctx.restore();
    });

    // Zone edges, so four cameras of the same river do not read as one picture.
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 1;
    _zones.forEach(z => ctx.strokeRect(z.rect.x + 0.5, z.rect.y + 0.5, z.rect.w - 1, z.rect.h - 1));
}

/** One seat's camera: the shared river, from its own boat's shoulder. */
function _camera(pid, zw, zh) {
    const ctx = _ctx;
    const me = _boats[pid];
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    const pxU = zw;                 // px per width, across
    const pxD = zh / VIEW_D;        // px per width, along
    const eye = me.d;               // world distance at the boat
    const by  = zh * BOAT_Y;
    // World distance → y in the zone. Ahead of you is up.
    const Y = d => by - (d - eye) * pxD;

    // Water, and banks that are visibly moving so speed is felt and not only
    // read off a label.
    ctx.fillStyle = '#0d2438';
    ctx.fillRect(0, 0, zw, zh);
    ctx.strokeStyle = 'rgba(120,190,235,.10)'; ctx.lineWidth = 1;
    ctx.beginPath();
    const first = Math.floor((eye - VIEW_D) / 0.25) * 0.25;
    for (let d = first; d < eye + VIEW_D; d += 0.25) {
        const y = Y(d);
        ctx.moveTo(0, y); ctx.lineTo(zw, y);
    }
    ctx.stroke();

    // Banks
    ctx.fillStyle = '#123024';
    ctx.fillRect(0, 0, zw * 0.045, zh);
    ctx.fillRect(zw * 0.955, 0, zw * 0.045, zh);

    // The finish, once it is in view.
    if (COURSE < eye + VIEW_D) {
        const y = Y(COURSE);
        ctx.fillStyle = '#f8fafc';
        for (let k = 0; k < 8; k++) {
            ctx.fillStyle = k % 2 ? '#f8fafc' : '#0f172a';
            ctx.fillRect(k * zw / 8, y - 5, zw / 8, 10);
        }
    }

    // Rocks, only the rows in view. A row is drawn as the rock BETWEEN its
    // holes, so however many holes it has the picture comes out of the same
    // numbers the collision test uses.
    for (const r of _rows) {
        if (r.d < eye - 0.4 || r.d > eye + VIEW_D) continue;
        const y = Y(r.d);
        const holes = r.gaps.map(g => [(g - _gapW / 2) * pxU, (g + _gapW / 2) * pxU])
                            .sort((a, b) => a[0] - b[0]);
        ctx.fillStyle = '#3b4a5c';
        let x = 0;
        for (const [h0, h1] of holes) { _rocks(ctx, x, h0, y, r.d + x, pxU, pxD); x = h1; }
        _rocks(ctx, x, zw, y, r.d + x, pxU, pxD);
        // The holes, marked — at speed a gap in a dark line is not something
        // anybody finds in time.
        ctx.strokeStyle = 'rgba(120,230,180,.55)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [h0, h1] of holes) { ctx.moveTo(h0 + 2, y); ctx.lineTo(h1 - 2, y); }
        ctx.stroke();
    }

    // Every boat in view, yours brightest.
    for (let i = 0; i < _n; i++) {
        const b = _boats[i];
        if (b.d < eye - 0.5 || b.d > eye + VIEW_D) continue;
        _boat(ctx, b, i, b.u * pxU, Y(b.d), pxU, pxD, i === pid);
    }

    _hud(pid, zw, zh, accent);
}

// ACROSS the river is measured in pxU and ALONG it in pxD, and the two are not
// the same number — a zone shows a fixed distance of river however wide it is,
// so the picture is stretched. Anything with size in both directions has to be
// drawn with the right scale in each or it comes out looking like a boulder.
function _rocks(ctx, x0, x1, y, seed, pxU, pxD) {
    if (x1 - x0 < 2) return;
    const rx = ROCK_R * pxU, ry = ROCK_R * pxD;
    const step = rx * 1.7;
    let k = 0;
    for (let x = x0 + rx * 0.6; x < x1 - rx * 0.2; x += step, k++) {
        // A fixed wobble per rock from its position, so rocks do not shimmer as
        // the camera moves past them.
        const w = Math.sin((seed * 37 + k) * 12.9898) * ry * 0.28;
        ctx.beginPath();
        ctx.ellipse(x, y + w, rx * 0.9, ry * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
    }
}

function _boat(ctx, b, i, x, y, pxU, pxD, mine) {
    const w = BOAT_W * pxU, l = BOAT_W * 1.9 * pxD;
    ctx.save();
    ctx.translate(x, y);
    // Wake, scaled by how fast this boat is actually going.
    if (b.wake > 0) {
        ctx.globalAlpha = 0.30;
        ctx.fillStyle = '#bfe6ff';
        ctx.beginPath();
        ctx.moveTo(-w * 0.4, l * 0.4);
        ctx.lineTo(0, l * 0.4 + b.wake * pxD * 0.16);
        ctx.lineTo(w * 0.4, l * 0.4);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
    }
    ctx.fillStyle = mine ? (SLOT_ACCENT[i] || '#fff') : 'rgba(255,255,255,.42)';
    ctx.beginPath();
    ctx.moveTo(0, -l * 0.6);
    ctx.lineTo(w * 0.5, l * 0.2);
    ctx.lineTo(w * 0.3, l * 0.4);
    ctx.lineTo(-w * 0.3, l * 0.4);
    ctx.lineTo(-w * 0.5, l * 0.2);
    ctx.closePath(); ctx.fill();
    if (mine) {
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (b.stall > 0) {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.85 + Math.sin(performance.now() / 60) * 2,
                    l * 0.75 + Math.sin(performance.now() / 60) * 2, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * The strip along the outer edge of a seat's camera: what gear it is in, where
 * it is in the field, and where everybody is on the course.
 *
 * The ladder is the part that matters. Four people looking at four different
 * cameras cannot see each other's boats, so without it the race would be four
 * solitaires that happen to share a screen — and knowing you are second by half
 * a length is most of the reason to take the risk.
 */
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
    _ctx = null; _canvas = null;
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _last = 0; _boats = []; _rows = []; _zones = []; _drag = new Map();
}
