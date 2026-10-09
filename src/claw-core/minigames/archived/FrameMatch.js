// ============================================================
// FRAME MATCH — one picture, everybody watching it, first to see
// it whole. For TWO, THREE OR FOUR on one screen.
//
// A single portrait sits in the middle of the table, cut into three
// horizontal bands. The top and bottom bands are the TARGET's, and
// they never change. The middle band is somebody else's, and it
// swaps for a new one every second. When the middle band is the
// target's own, the face is whole for exactly one second — and the
// first person to tap their pad in that second takes the round.
//
// SHARED, not split: there is one picture, in one place, and the
// only thing partitioned is where you put your thumb. That is what
// lets four people play it on a phone — nobody needs a playfield of
// their own, because the playfield is the thing in the middle they
// are all already looking at.
//
// The pressure comes from that being true of everyone at once. You
// are not racing a clock, you are racing three other people who can
// see exactly what you can see, and the wrong tap costs a second
// and a half you cannot get back.
//
// Built on src/minigames/_template.js — see docs/MINIGAME_STANDARD.md.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, slotCount, isBotSlot, seatFor } from './MinigameManager.js';
import { zonesFor } from '../config/MinigameLayout.js';

// ── Tunables ─────────────────────────────────────────────────────────────────
const WINS_NEEDED = 3;      // best of five
const MAX_ROUNDS  = 5;
// A second a frame, and it stays a second a frame. Speeding up would turn the
// last round into a reaction test, and this is not one: the thing being tested
// is whether you can tell two similar middles apart at a glance, which does not
// get more interesting when you are given less time to do it. What escalates is
// the DECOYS — see _castFor.
const FRAME_MS    = 1000;
const STUDY_MS    = 1700;   // how long the target is shown whole before it starts
const PENALTY_MS  = 1500;   // lockout for tapping on somebody else's middle
// The manager force-ends any game at 90 s and reaching that is meant to read as
// a bug, so both ceilings below are set to keep a perfectly normal match well
// inside it. A round usually resolves in six or seven frames; sixteen is the
// point at which the dice have clearly not cooperated and the round is scrubbed.
const MATCH_TIME  = 72;     // s hard ceiling; settles on rounds won
const ROUND_MAX_FRAMES = 16; // no-score ceiling, so a round cannot run forever
const GAP_MS      = 1250;   // between rounds

// The chrome each player's pad needs at its outer edge: the target thumbnail,
// their name and their pips. The picture in the middle gets what is left.
const PAD_CHROME  = 92;

// ── Module state ──────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _isBot = false, _botSkill = 0.55;
let _overlay = null, _canvas = null, _ctx = null, _dpr = 1;
let _af = null, _last = 0, _t = 0;

let _n = 2;                 // slots, not seats
let _wins = [];
let _round = 0;
let _phase = 'study';       // 'study' | 'run' | 'over'
let _cast = [];             // the faces in play this round; _cast[0] is the target
let _order = [];            // which cast index the middle band shows, frame by frame
let _frame = 0;             // index into _order
let _frameT = 0;            // s spent on the current frame
let _lockedUntil = [];      // performance.now() while a wrong tap is being served
let _wrongFlash = [];       // s of red left on a pad
let _hitFlash = 0;          // s of green left on the picture
let _banner = '';
let _zones = [];
let _botPlan = [];          // per bot: ms of reaction it will need this frame

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
    _last = 0; _t = 0; _round = 0;
    _wins = new Array(_n).fill(0);
    _lockedUntil = new Array(_n).fill(0);
    _wrongFlash = new Array(_n).fill(0);
    _botPlan = new Array(_n).fill(0);
    _hitFlash = 0; _banner = '';
    registerMinigameCleanup(_destroy);
    _build();
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (_done) return;
        _resize();
        _startRound();
        _af = requestAnimationFrame(_tick);
    }));
}

// ── DOM ───────────────────────────────────────────────────────────────────────
function _build() {
    const mg = document.getElementById('minigame-layer');
    if (_overlay) { _overlay.remove(); _overlay = null; }

    _overlay = document.createElement('div');
    _overlay.style.cssText =
        'position:absolute;inset:0;overflow:hidden;background:#0e1220;touch-action:none;';

    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    _overlay.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');

    // Anywhere in your zone is your pad, including the part of it the picture is
    // drawn over. There is nothing to aim at — the whole point is that your eyes
    // are on the middle of the table, not on your thumb.
    const onDown = e => {
        if (_done) return;
        e.preventDefault();
        const r = _overlay.getBoundingClientRect();
        const pid = _zoneAt(e.clientX - r.left, e.clientY - r.top);
        if (pid < 0 || isBotSlot(pid)) return;
        _tap(pid);
    };
    _overlay.addEventListener('pointerdown', onDown);
    _cleanups.push(() => _overlay.removeEventListener('pointerdown', onDown));

    const onResize = () => _resize();
    window.addEventListener('resize', onResize);
    _cleanups.push(() => window.removeEventListener('resize', onResize));

    mg.appendChild(_overlay);
    document.getElementById('mg-neutral').textContent = 'TAP WHEN THE FACE IS WHOLE!';
}

function _resize() {
    if (!_canvas) return;
    _dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = _overlay.clientWidth, h = _overlay.clientHeight;
    _canvas.width  = Math.round(w * _dpr);
    _canvas.height = Math.round(h * _dpr);
    _ctx.setTransform(_dpr, 0, 0, _dpr, 0, 0);
    _zones = zonesFor(_n, w, h);
}

/** Which slot's zone contains this point, or the nearest one. */
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

// ── The faces ────────────────────────────────────────────────────────────────
//
// Drawn rather than loaded: a picture the game can generate is a picture whose
// three bands are guaranteed to line up, and which can be varied in exactly the
// way the round needs. Each face is a set of choices, and the MIDDLE band holds
// only the eyes — which is the band that swaps, so the eyes are what you are
// reading. Everything else is there to make the face a face.

const SKIN  = ['#f2c9a0', '#d9a273', '#a9714a', '#7a4a2c', '#c7d7e8', '#b7e3c9', '#e7c2dd'];
const HAIR  = ['#2b2b33', '#5b3a1e', '#c9a227', '#b5473a', '#3b6bb5', '#6b3b8f', '#d8dde6'];
const EYES  = ['#2f3b4d', '#2f6b4d', '#7a4a9e', '#b5473a', '#2f6bb5', '#c9a227'];
const BROW  = ['flat', 'raised', 'angry', 'arch'];
const SHAPE = ['round', 'wide', 'narrow'];
const MOUTH = ['smile', 'flat', 'open', 'frown'];

/**
 * The cast for a round: the target first, then the decoys whose middles will be
 * cut in over it.
 *
 * The decoys are built to be WRONG IN ONE THING. A cast of faces that differ in
 * everything makes the game trivial — the eyes are a different colour and you
 * are done in a frame — and the difficulty has to come from somewhere other than
 * the clock, which never changes. So each decoy takes the target's eyes and
 * alters exactly one property of them, and the LATER the round, the smaller the
 * property it is allowed to alter.
 */
function _castFor(round) {
    const target = {
        skin:  SKIN[Math.floor(Math.random() * SKIN.length)],
        hair:  HAIR[Math.floor(Math.random() * HAIR.length)],
        eye:   EYES[Math.floor(Math.random() * EYES.length)],
        brow:  BROW[Math.floor(Math.random() * BROW.length)],
        shape: SHAPE[Math.floor(Math.random() * SHAPE.length)],
        mouth: MOUTH[Math.floor(Math.random() * MOUTH.length)],
        gaze:  0,
        lid:   1,
    };
    // Which properties of the eyes a decoy may differ in. Round one allows the
    // loudest difference there is; by round five all that separates a decoy from
    // the real thing is where it is looking.
    const dials = round <= 1 ? ['eye', 'brow', 'gaze', 'lid']
                : round <= 3 ? ['eye', 'brow', 'gaze']
                :              ['brow', 'gaze', 'lid'];
    const cast = [target];
    for (let i = 0, guard = 0; i < 4 && guard < 40; i++, guard++) {
        const d = { ...target };
        const dial = dials[Math.floor(Math.random() * dials.length)];
        if (dial === 'eye') {
            const others = EYES.filter(c => c !== target.eye);
            d.eye = others[Math.floor(Math.random() * others.length)];
        } else if (dial === 'brow') {
            const others = BROW.filter(b => b !== target.brow);
            d.brow = others[Math.floor(Math.random() * others.length)];
        } else if (dial === 'gaze') {
            d.gaze = target.gaze === 0 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        } else {
            d.lid = target.lid === 1 ? 0.55 : 1;
        }
        // A decoy identical to the target after all that would be a frame the
        // round could be won on by accident, so it is thrown back.
        if (_sameEyes(d, target)) { i--; continue; }
        cast.push(d);
    }
    return cast;
}

function _sameEyes(a, b) {
    return a.eye === b.eye && a.brow === b.brow && a.gaze === b.gaze && a.lid === b.lid;
}

/**
 * The order the middles are shown in.
 *
 * The target's own middle has to come up, more than once, and not on a beat
 * anybody can count. It is placed at a few random frames with at least two
 * decoys between them, and never on the first frame — the first second is for
 * finding the picture, not for winning on.
 */
function _orderFor(cast) {
    const order = [];
    let sinceTarget = 0;
    for (let f = 0; f < ROUND_MAX_FRAMES; f++) {
        const canTarget = f >= 2 && sinceTarget >= 2;
        if (canTarget && Math.random() < 0.26) {
            order.push(0);
            sinceTarget = 0;
        } else {
            order.push(1 + Math.floor(Math.random() * (cast.length - 1)));
            sinceTarget++;
        }
    }
    // Guarantee at least one, in case the dice never came up.
    if (!order.includes(0)) order[4 + Math.floor(Math.random() * 6)] = 0;
    return order;
}

// ── Rounds ────────────────────────────────────────────────────────────────────
function _startRound() {
    if (_done) return;
    _round++;
    _phase = 'study';
    _cast = _castFor(_round);
    _order = _orderFor(_cast);
    _frame = 0; _frameT = 0;
    _banner = '';
    _hitFlash = 0;
    _lockedUntil = new Array(_n).fill(0);
    _wrongFlash = new Array(_n).fill(0);
    sfx('react_go');
    document.getElementById('mg-neutral').textContent =
        `ROUND ${_round} — LEARN THE FACE…`;
    _after(() => {
        if (_done || _phase !== 'study') return;
        _phase = 'run';
        _frameT = 0;
        _newFrame();
        document.getElementById('mg-neutral').textContent = _n > 2
            ? `ROUND ${_round} — TAP WHEN IT'S WHOLE`
            : `ROUND ${_round} — TAP WHEN IT'S WHOLE   ${_scoreLine()}`;
    }, STUDY_MS);
}

/** Called when the middle band changes, including the first one. */
function _newFrame() {
    const whole = _order[_frame] === 0;
    sfx('tick');
    // Every bot decides afresh whether it is going to see THIS frame, and how
    // long it takes to be sure. A bot that always answered at the same moment
    // would be a metronome the others could play against. (§5)
    for (let pid = 0; pid < _n; pid++) {
        if (!isBotSlot(pid)) continue;
        _botPlan[pid] = 0;
        if (performance.now() < _lockedUntil[pid]) continue;
        if (whole) {
            // Recognising it. Skill is how quickly, and whether at all — even a
            // strong bot lets one go by, which is what leaves the frame open.
            if (Math.random() < 0.10 + (1 - _botSkill) * 0.42) continue;
            _botPlan[pid] = 260 + (1 - _botSkill) * 520 + Math.random() * 220;
        } else if (Math.random() < (1 - _botSkill) * 0.10) {
            // ...and sometimes it is wrong, which costs it the same second and a
            // half it costs anybody.
            _botPlan[pid] = 300 + Math.random() * 400;
        }
    }
}

function _nameOf(pid) {
    const p = state.players[seatFor(pid)];
    return (p && p.name ? p.name : `P${pid + 1}`).toUpperCase();
}

function _scoreLine() {
    return _n > 2 ? _wins.join('·') : _wins.map((w, i) => `P${i + 1} ${w}`).join(' · ');
}

function _tap(pid) {
    if (_done || _phase !== 'run') return;
    const now = performance.now();
    if (now < _lockedUntil[pid]) return;

    if (_order[_frame] === 0) {
        _hitFlash = 0.7;
        sfx('coin_gain'); if (!isBotSlot(pid)) haptic([25]);
        _endRound(pid);
    } else {
        _lockedUntil[pid] = now + PENALTY_MS;
        _wrongFlash[pid] = PENALTY_MS / 1000;
        sfx('land_bad'); if (!isBotSlot(pid)) haptic([60]);
    }
}

function _endRound(winnerId) {
    if (_done || _phase === 'over') return;
    _phase = 'over';
    if (winnerId >= 0) {
        _wins[winnerId]++;
        _banner = `${_nameOf(winnerId)} SPOTTED IT`;
    } else {
        _banner = 'NOBODY SPOTTED IT';
        sfx('land_bad');
    }
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = _n > 2
        ? `${_banner}   ${_wins.join('·')}`
        : `${_banner}   ${_scoreLine()}`;

    if (winnerId >= 0 && _wins[winnerId] >= WINS_NEEDED) { _finish(); return; }
    if (_round >= MAX_ROUNDS)                            { _finishOnScore(); return; }
    _after(_startRound, GAP_MS);
}

// ── Loop ──────────────────────────────────────────────────────────────────────
function _tick() {
    if (!state.mgActive || _done) return;
    _af = requestAnimationFrame(_tick);

    const now = performance.now();
    const dt  = _last === 0 ? 1 / 60 : Math.min((now - _last) / 1000, 0.1);
    _last = now; _t += dt;

    for (let i = 0; i < _n; i++) _wrongFlash[i] = Math.max(0, _wrongFlash[i] - dt);
    _hitFlash = Math.max(0, _hitFlash - dt);

    if (_phase === 'run') {
        _frameT += dt;
        // Bots answer inside the frame they planned for, never across it.
        for (let pid = 0; pid < _n; pid++) {
            if (!isBotSlot(pid) || !_botPlan[pid]) continue;
            if (_frameT * 1000 >= _botPlan[pid]) { _botPlan[pid] = 0; _tap(pid); }
        }
        if (_frameT >= FRAME_MS / 1000) {
            _frameT -= FRAME_MS / 1000;
            _frame++;
            if (_frame >= _order.length) { _endRound(-1); }
            else _newFrame();
        }
    }

    if (_t >= MATCH_TIME && !_done) _finishOnScore();
    _draw();
}

// ── End ───────────────────────────────────────────────────────────────────────
function _finish() {
    const best = _wins.indexOf(Math.max(..._wins));
    _settle(best);
}

function _finishOnScore() {
    const top = Math.max(..._wins);
    const tied = _wins.reduce((a, w, i) => (w === top ? [...a, i] : a), []);
    _settle(tied.length === 1 ? tied[0] : -1);
}

function _settle(winnerId) {
    if (_done) return;
    _done = true;
    _phase = 'over';
    state.mgActive = false;
    const neu = document.getElementById('mg-neutral');
    if (neu) neu.textContent = winnerId < 0
        ? `DRAW!   ${_scoreLine()}`
        : `${_nameOf(winnerId)} WINS!   ${_scoreLine()}`;
    _banner = winnerId < 0 ? 'DRAW!' : `${_nameOf(winnerId)} WINS!`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win'); haptic('heavy');
    _after(() => { _destroy(); _onWin(winnerId, null, _wins.slice(0, _n)); }, 1400);
}

// ── Draw ──────────────────────────────────────────────────────────────────────
const SLOT_ACCENT = ['#ff5a5a', '#5a9bff', '#5fd68a', '#ffd45f'];

function _draw() {
    const ctx = _ctx, w = _overlay.clientWidth, h = _overlay.clientHeight;
    ctx.clearRect(0, 0, w, h);
    if (!_zones.length) _zones = zonesFor(_n, w, h);

    // The picture: centred, and sized to leave every pad its chrome band at the
    // outer edge. A 3:4 portrait, because that is the shape a face is.
    const availW = w - PAD_CHROME * (_n > 2 ? 1.2 : 0.5);
    const availH = h - PAD_CHROME * 2;
    let pw = Math.min(availW * 0.82, availH * 0.72 * 0.75);
    let ph = pw / 0.75;
    if (ph > availH * 0.72) { ph = availH * 0.72; pw = ph * 0.75; }
    const px = (w - pw) / 2, py = (h - ph) / 2;

    _picture(px, py, pw, ph);

    // Each pad's chrome, drawn upright from where that player is sitting.
    _zones.forEach((z, pid) => {
        const r = z.rect;
        ctx.save();
        ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
        if (z.rot === 180) { ctx.translate(r.x + r.w, r.y + r.h); ctx.rotate(Math.PI); }
        else               { ctx.translate(r.x, r.y); }
        _pad(pid, r.w, r.h);
        ctx.restore();
    });

    // The result goes above the picture AND below it, the top copy turned over.
    // Anything written once across a shared table is upside down for half of it,
    // and this is the line that says who took the round.
    if (_banner) {
        _plate(_banner, w / 2, py - 30, false, w, h);
        _plate(_banner, w / 2, py + ph + 30, true, w, h);
    }
}

/** A centred caption, optionally turned over for the far side of the table. */
function _plate(text, cx, cy, flip, w, h) {
    const ctx = _ctx;
    ctx.save();
    ctx.translate(cx, cy);
    if (flip) ctx.rotate(Math.PI);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 26px "Bebas Neue", sans-serif';
    const tw = ctx.measureText(text).width + 30;
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    _rrect(ctx, -tw / 2, -19, tw, 38, 9); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 0, 1);
    ctx.restore();
}

/** The three-band portrait everybody is looking at. */
function _picture(x, y, w, h) {
    const ctx = _ctx;
    const band = h / 3;
    const whole = _phase === 'study' || (_phase === 'run' && _order[_frame] === 0);
    const mid = _phase === 'study' ? _cast[0] : _cast[_order[_frame]] || _cast[0];

    ctx.save();
    ctx.beginPath(); _rrect(ctx, x, y, w, h, 14); ctx.clip();
    // Top and bottom are always the target's — they are the half of the picture
    // you are matching AGAINST.
    _band(ctx, 0, _cast[0], x, y, w, h);
    _band(ctx, 2, _cast[0], x, y, w, h);
    _band(ctx, 1, mid, x, y, w, h);
    ctx.restore();

    // The seams. Loud enough that the middle reads as a separate strip, faint
    // enough that a whole face still reads as one picture.
    ctx.strokeStyle = 'rgba(8,10,18,.55)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + band);     ctx.lineTo(x + w, y + band);
    ctx.moveTo(x, y + band * 2); ctx.lineTo(x + w, y + band * 2);
    ctx.stroke();

    // The frame around it says whether the picture is whole, and it is the only
    // thing on screen that does — no countdown, no marker. You are reading the
    // face, and that is the game.
    ctx.lineWidth = 4;
    ctx.strokeStyle = _hitFlash > 0 ? '#4ade80'
                    : whole ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.16)';
    ctx.beginPath(); _rrect(ctx, x, y, w, h, 14); ctx.stroke();

}

/**
 * One horizontal third of a face, drawn from `face`.
 *
 * The face is drawn whole into a clipped strip rather than as three separate
 * pictures, which is the only way the bands line up at the seams however the
 * picture is scaled.
 */
function _band(ctx, i, face, x, y, w, h) {
    const band = h / 3;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y + band * i - 1, w, band + 2); ctx.clip();
    _portrait(ctx, face, x, y, w, h);
    ctx.restore();
}

function _portrait(ctx, f, x, y, w, h) {
    const cx = x + w / 2;
    // Background wash, per face, so a swapped middle is not only a change of
    // eyes but a barely-there change of ground — the thing you notice without
    // being able to say what you noticed.
    ctx.fillStyle = '#182238';
    ctx.fillRect(x, y, w, h);

    // Head. The three shapes change the silhouette enough to matter at a
    // glance, which keeps the TOP band doing work as well as the middle.
    const hw = w * (f.shape === 'wide' ? 0.80 : f.shape === 'narrow' ? 0.58 : 0.70);
    const hh = h * 0.78;
    const hx = cx, hy = y + h * 0.46;
    ctx.fillStyle = f.skin;
    ctx.beginPath();
    ctx.ellipse(hx, hy, hw / 2, hh / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hair across the top band.
    ctx.fillStyle = f.hair;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(hx, hy, hw / 2, hh / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillRect(hx - hw / 2, y + h * 0.07, hw, h * 0.17);
    ctx.beginPath();
    ctx.ellipse(hx, y + h * 0.235, hw * 0.5, h * 0.075, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ── The middle band: brows, eyes, nose ──────────────────────────────────
    const ey = y + h * 0.44;
    const eo = hw * 0.21;                 // eye offset from centre
    const er = Math.min(w, h) * 0.062;    // eye radius
    for (const s of [-1, 1]) {
        const ex = hx + s * eo;
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.ellipse(ex, ey, er, er * f.lid, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = f.eye;
        ctx.beginPath();
        ctx.arc(ex + f.gaze * er * 0.42, ey, er * 0.52 * Math.min(1, f.lid + 0.2), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#10151f';
        ctx.beginPath();
        ctx.arc(ex + f.gaze * er * 0.42, ey, er * 0.23 * Math.min(1, f.lid + 0.2), 0, Math.PI * 2);
        ctx.fill();

        // Brow
        ctx.strokeStyle = f.hair; ctx.lineWidth = Math.max(2.5, er * 0.34); ctx.lineCap = 'round';
        const by = ey - er * (f.brow === 'raised' ? 2.1 : 1.55);
        const tilt = f.brow === 'angry' ? s * er * 0.42 : f.brow === 'arch' ? -er * 0.30 : 0;
        ctx.beginPath();
        ctx.moveTo(ex - er * 0.95, by + (f.brow === 'angry' ? -tilt : 0) + (f.brow === 'arch' ? -tilt : 0));
        ctx.lineTo(ex + er * 0.95, by + tilt);
        ctx.stroke();
    }
    // Nose, sitting on the lower seam so the middle band always has a bottom.
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = Math.max(2, er * 0.28);
    ctx.beginPath();
    ctx.moveTo(hx, ey + er * 1.3);
    ctx.lineTo(hx + er * 0.42, y + h * 0.645);
    ctx.stroke();

    // ── The bottom band: mouth and shoulders ────────────────────────────────
    const my = y + h * 0.755, mw = hw * 0.30;
    ctx.strokeStyle = '#8a3b34'; ctx.lineWidth = Math.max(2.5, er * 0.38); ctx.lineCap = 'round';
    ctx.beginPath();
    if (f.mouth === 'smile')      ctx.arc(hx, my - mw * 0.35, mw, Math.PI * 0.18, Math.PI * 0.82);
    else if (f.mouth === 'frown') ctx.arc(hx, my + mw * 0.55, mw, Math.PI * 1.18, Math.PI * 1.82);
    else if (f.mouth === 'open')  ctx.ellipse(hx, my, mw * 0.55, mw * 0.52, 0, 0, Math.PI * 2);
    else { ctx.moveTo(hx - mw * 0.8, my); ctx.lineTo(hx + mw * 0.8, my); }
    if (f.mouth === 'open') { ctx.fillStyle = '#5c2420'; ctx.fill(); } else ctx.stroke();

    ctx.fillStyle = f.hair;
    ctx.beginPath();
    ctx.ellipse(hx, y + h * 1.16, hw * 0.86, h * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
}

/** One player's pad: the target to match against, their name, their pips. */
function _pad(pid, zw, zh) {
    const ctx = _ctx;
    const accent = SLOT_ACCENT[pid] || '#ffffff';
    const locked = performance.now() < _lockedUntil[pid];

    // A wrong tap is a red wash across that player's whole pad — everyone at the
    // table sees who went early, which is half of what makes it cost something.
    if (_wrongFlash[pid] > 0) {
        ctx.fillStyle = `rgba(239,68,68,${0.10 + 0.10 * (_wrongFlash[pid] / (PENALTY_MS / 1000))})`;
        ctx.fillRect(0, 0, zw, zh);
    }

    // The chrome sits at the pad's OUTER edge — the bottom of the zone in its
    // own rotated frame — so it never lands on the picture in the middle and is
    // always the right way up for the person it belongs to.
    const tw = Math.min(52, zw * 0.16), th = tw / 0.75;
    const ty = zh - th - 16, tx = 14;

    ctx.save();
    ctx.beginPath(); _rrect(ctx, tx, ty, tw, th, 6); ctx.clip();
    _portrait(ctx, _cast[0] || {}, tx, ty, tw, th);
    ctx.restore();
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.beginPath(); _rrect(ctx, tx, ty, tw, th, 6); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = '800 9px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.fillText('MATCH', tx + tw / 2, ty - 4);

    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${zw < 300 ? 15 : 18}px "Bebas Neue", sans-serif`;
    ctx.fillStyle = locked ? '#ef4444' : accent;
    ctx.fillText(locked ? 'LOCKED OUT' : _nameOf(pid), tx + tw + 12, ty + th * 0.34);

    // Pips: rounds won, out of the three it takes.
    for (let i = 0; i < WINS_NEEDED; i++) {
        const cx2 = tx + tw + 19 + i * 17, cy2 = ty + th * 0.72;
        ctx.beginPath(); ctx.arc(cx2, cy2, 6, 0, Math.PI * 2);
        ctx.fillStyle = i < _wins[pid] ? accent : 'rgba(255,255,255,.16)';
        ctx.fill();
    }

    if (locked) {
        const left = (_lockedUntil[pid] - performance.now()) / PENALTY_MS;
        const bw = Math.min(zw * 0.42, 150);
        ctx.fillStyle = 'rgba(255,255,255,.12)';
        _rrect(ctx, tx + tw + 12, ty + th - 6, bw, 6, 3); ctx.fill();
        ctx.fillStyle = '#ef4444';
        _rrect(ctx, tx + tw + 12, ty + th - 6, bw * Math.max(0, left), 6, 3); ctx.fill();
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
    _last = 0; _cast = []; _order = []; _zones = [];
}
