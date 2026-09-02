// ============================================================
// MINIGAME LAYOUT — where each player's hands and eyes go
// ============================================================
// Every minigame in the roster was laid out by hand, and every one of them made
// the same two assumptions: there are exactly two players, and the screen is cut
// in half across the middle. Both are true of the game that shipped and neither
// survives a third player.
//
// This module is the geometry those assumptions were hiding. It answers one
// question — GIVEN a play structure, a number of seats, and a viewport, where
// does each seat's content go, how is it rotated, and is the result big enough
// to actually play — and it answers it as arithmetic rather than as a guess, so
// the answer can be checked (`qa/layout.js`) rather than argued about.
//
// It is deliberately pure: no DOM, no state, no imports. A game asks it for
// rectangles and draws into them.
//
// The rules it encodes are written up in docs/MINIGAME_RULEBOOK.md. The one
// worth knowing before reading any of this:
//
//   A PHONE HOLDS AT MOST TWO PRIVATE PLAYFIELDS. Past two, the playfield has
//   to be SHARED or TAKEN IN TURNS.
//
// That is not a taste call, it is `MIN_PLAY` divided into 412 CSS pixels. The
// module works it out from the viewport it is handed, so a tablet gets a
// different — and correct — answer.
// ============================================================

// ── The four structures, and the two modifiers ──────────────────────────────
//
// Two questions make the whole taxonomy:
//
//                    │ ONE SHARED PLAYFIELD │ ONE PLAYFIELD EACH
//   ─────────────────┼──────────────────────┼────────────────────
//   everyone at once │        ARENA         │       SPLIT
//   one at a time    │        TABLE         │       RELAY
//
// ASYM and TEAMS are not a fifth and sixth cell — they are modifiers that can
// be laid over ARENA or TABLE, changing what a seat's job is without changing
// where it sits.
export const SHAPES = {
    ARENA: 'arena',   // one playfield, everyone acting at once. Puck, Sumo, Tank Clash.
    SPLIT: 'split',   // a playfield each, everyone acting at once. Meteor Dodge, Loot Catch.
    TABLE: 'table',   // one playfield, taken in turns. Four in a Row, Memory Match.
    RELAY: 'relay',   // a playfield each, taken in turns. Rhythm Forge.
};

export const MODIFIERS = {
    ASYM:  'asym',    // the seats do not have the same job. Penalty.
    TEAMS: 'teams',   // four seats, two sides.
};

/** Where a game is being played: one screen shared, or one screen each. */
export const CONTEXTS = { DEVICE: 'device', PHONES: 'phones' };

// ── The chrome budget ───────────────────────────────────────────────────────
//
// Every number here is either measured off something already shipped or derived
// from a rule in docs/MINIGAME_STANDARD.md. None of them is a preference.
export const CHROME = {
    // R1b. `#mg-neutral` floats at each outer edge at about 42 px including its
    // margin; Puck and Penalty already reserve 46 (`PAD_Y`) and that is the
    // number the shipped games are drawn against, so it is the number here.
    EDGE_RESERVE: 46,

    // The pressure rail (see `railFor`). Costs nothing across phones, because
    // alone on your own screen the mirrored status strip is hidden and this
    // takes the band it vacates.
    RAIL: 34,

    // Whose turn it is, at their own edge. Memory Match's banner, generalised.
    BANNER: 34,

    // A control strip at one seat's edge in an ARENA: one 44 px target with
    // 16 px of padding either side.
    CTRL_BAND: 76,

    // §4 of the standard: minimum touch target, and the gap that keeps two of
    // them from being one fat thumb.
    MIN_TARGET: 44,
    TARGET_GAP: 8,

    // THE LINE. Below this on either axis, a private playfield is not a
    // playfield — it is a strip you can lose in.
    //
    // Derived rather than picked: five 44 px targets and their gaps is 252 px,
    // and anything with motion in it needs headroom over the bare minimum. The
    // two halves the game ships with are 412 x 400 on the QA phone, so 300 sits
    // comfortably under what already works — and comfortably over the 206 px a
    // quarter of that same screen would give you.
    MIN_PLAY: 300,
};

// ── The seat ring ───────────────────────────────────────────────────────────
//
// Where people physically are around a phone lying flat. The order matters: the
// bottom/top axis is the one every shipped game is built on, so it is filled
// first and never disturbed. A 3- or 4-player layout is the shipped face-off
// with more people leaning in, not a different arrangement.
//
// Four people do NOT sit one to an edge. A phone's short edges are 412 px of
// screen and about a hand-width of table; four edge bands leave an arena 260 px
// wide, which is narrower than the two-player game's playfield. Four people
// crowd a phone the way they crowd anything small — two along each long side —
// so the fourth seat goes to a corner, not to the left edge.
//
// `span` is the fraction of the edge this seat occupies, in DEVICE coordinates.
// `rot` is degrees clockwise: the transform that makes this seat's content read
// right-side up from where they are sitting.
const RINGS = {
    1: [{ edge: 'bottom', span: [0, 1], rot: 0 }],
    2: [{ edge: 'bottom', span: [0, 1], rot: 0 },
        { edge: 'top',    span: [0, 1], rot: 180 }],
    // The odd seat takes the near edge alone. Online that edge is always the
    // seat this device is playing, which is the same rule the HUD follows.
    3: [{ edge: 'bottom', span: [0, 1],   rot: 0 },
        { edge: 'top',    span: [0, 0.5], rot: 180 },
        { edge: 'top',    span: [0.5, 1], rot: 180 }],
    4: [{ edge: 'bottom', span: [0, 0.5], rot: 0 },
        { edge: 'bottom', span: [0.5, 1], rot: 0 },
        { edge: 'top',    span: [0, 0.5], rot: 180 },
        { edge: 'top',    span: [0.5, 1], rot: 180 }],
};

/** Where `n` people sit around one device, in seat order. */
export function seatRing(n) {
    const r = RINGS[Math.max(1, Math.min(4, n | 0))] || RINGS[2];
    return r.map(s => ({ ...s, span: s.span.slice() }));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const rect = (x, y, w, h) => ({
    x: Math.round(x), y: Math.round(y),
    w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)),
});

/** The screen minus the two status pills. Everything below lives in here. */
export function innerBox(w, h) {
    return rect(0, CHROME.EDGE_RESERVE, w, h - CHROME.EDGE_RESERVE * 2);
}

/** A band of `thickness` at one edge of `box`, across `span` of that edge. */
function band(box, edge, span, thickness) {
    const [a, b] = span;
    if (edge === 'bottom') return rect(box.x + box.w * a, box.y + box.h - thickness, box.w * (b - a), thickness);
    if (edge === 'top')    return rect(box.x + box.w * a, box.y, box.w * (b - a), thickness);
    if (edge === 'left')   return rect(box.x, box.y + box.h * a, thickness, box.h * (b - a));
    return rect(box.x + box.w - thickness, box.y + box.h * a, thickness, box.h * (b - a));
}

/** Does a rect clear the playfield floor on both axes? */
export function bigEnough(r) {
    return r.w >= CHROME.MIN_PLAY && r.h >= CHROME.MIN_PLAY;
}

// ── The pressure rail ───────────────────────────────────────────────────────
//
// The problem it exists to solve: across phones every player has a whole screen
// and nobody can see anybody. A minigame round that used to be two people
// elbowing each other becomes four people alone in a room, and the score at the
// end is the first time anyone learns they were losing.
//
// The rail is the smallest thing that fixes that: one chip per rival carrying
// their live number and a bar, along the edge of your own screen. You do not
// see their screen — you see the only part of it that is aimed at you.
//
// It is free. Played alone the mirrored status strip is hidden (SoloArena calls
// MinigameManager.setSoloMode), so this takes a band already reserved and the
// playfield is exactly the size it is today.
export function railFor(w, h, rivals) {
    const n = Math.max(0, rivals | 0);
    if (!n) return null;
    const box = rect(0, 0, w, CHROME.EDGE_RESERVE);
    return {
        box,
        // Chips share the band. Three rivals on a 412 px phone is 137 px each:
        // a colour, an icon, a number and a bar, which is the whole job.
        chip: rect(0, 0, box.w / n, CHROME.RAIL),
        chips: n,
        // Below this a chip is a colour and nothing legible, and the rail should
        // drop to the leader alone rather than show four unreadable ones.
        readable: box.w / n >= 96,
    };
}

// ── The layouts ─────────────────────────────────────────────────────────────

/**
 * The frame for one round.
 *
 * `shape`   one of SHAPES.
 * `n`       how many seats are IN the game (spectators are not seats).
 * `w`, `h`  the viewport, in CSS pixels.
 * `opts`    { ctx: CONTEXTS.DEVICE | CONTEXTS.PHONES, active: seat index,
 *             rivals: how many other players exist, for the rail }
 *
 * Returns:
 *   shape, ctx, n
 *   inner    the box everything is laid out inside
 *   shared   the one playfield everybody is fighting over, or null
 *   seats[]  { seat, rect, rot, role }  — role: 'play' | 'control' | 'banner'
 *   rail     the pressure rail, or null
 *   ok       is this playable at this size
 *   why      when it is not
 */
export function frameFor(shape, n, w, h, opts = {}) {
    const ctx    = opts.ctx || CONTEXTS.DEVICE;
    const seats  = Math.max(1, Math.min(4, n | 0));
    const inner  = innerBox(w, h);
    const active = typeof opts.active === 'number' ? opts.active : 0;

    // ACROSS PHONES every structure collapses to the same picture: this device
    // draws ONE seat, at full size, with the rail above it. That is the whole
    // reason parallel play scales to four players and split-screen does not —
    // there is no dividing up to do.
    if (ctx === CONTEXTS.PHONES) {
        const rivals = typeof opts.rivals === 'number' ? opts.rivals : seats - 1;
        const rail   = railFor(w, h, rivals);
        const play   = rect(inner.x, inner.y, inner.w, inner.h);
        return _out(shape, ctx, seats, inner, null,
            [{ seat: active, rect: play, rot: 0, role: 'play' }], rail,
            bigEnough(play), bigEnough(play) ? '' : _tooSmall(play));
    }

    const ring = seatRing(seats);

    if (shape === SHAPES.SPLIT) {
        // The only structure that divides the screen, and therefore the only one
        // with a hard ceiling on how many people can be in it at once.
        //
        // It does NOT use the seat ring. A race is only fair if the playfields
        // are identical (R5), so this divides the screen evenly and takes only
        // the ROTATION from where people are sitting.
        //
        // Three is not a size failure, it is a geometry one: a rectangle has no
        // three-way even division that gives every seat an outside edge. The odd
        // player ends up in a middle band with nothing to brace a thumb against
        // and no way to read their own half right-side up.
        if (seats === 3) {
            return _out(shape, ctx, seats, inner, null, [], null, false,
                'a rectangle has no three-way even division that gives every seat its own edge — ' +
                'the third player lands in the middle band. Use TABLE or RELAY, or give them their own phone.');
        }
        const cols = seats >= 4 ? 2 : 1;
        const rows = seats >= 2 ? 2 : 1;
        const cw = inner.w / cols, ch = inner.h / rows;
        const out = [];
        for (let i = 0; i < seats; i++) {
            // Seats fill the near edge first, then the far one — same order as
            // the ring, so a 4-player split is the shipped face-off with each
            // half cut down the middle.
            const col = cols === 1 ? 0 : i % 2;
            const near = i < cols;                       // bottom row?
            out.push({
                seat: i,
                rect: rect(inner.x + col * cw, inner.y + (near ? inner.h - ch : 0), cw, ch),
                rot: near ? 0 : 180,
                role: 'play',
            });
        }
        const ok = out.every(o => bigEnough(o.rect));
        const worst = out.reduce((a, b) => (a.rect.w * a.rect.h <= b.rect.w * b.rect.h ? a : b));
        return _out(shape, ctx, seats, inner, null, out, null, ok,
            ok ? '' : `${seats} private playfields on a ${w}x${h} screen gives each one ${_dim(worst.rect)} — ` +
                      `under the ${CHROME.MIN_PLAY}x${CHROME.MIN_PLAY} floor. Share the playfield or take turns.`);
    }

    if (shape === SHAPES.ARENA) {
        // One playfield, everyone at once. Nothing is divided except the CONTROLS,
        // which is why this is the structure that scales on one device: a third
        // player costs a 76 px band, not half of somebody's game.
        const bands = ring.map((s, i) => ({
            seat: i, rect: band(inner, s.edge, s.span, CHROME.CTRL_BAND), rot: s.rot, role: 'control',
        }));
        // Whatever the ring uses, take it off that side once — two seats sharing
        // the bottom edge cost one band between them, not two.
        const eat = { top: 0, bottom: 0, left: 0, right: 0 };
        ring.forEach(s => { eat[s.edge] = CHROME.CTRL_BAND; });
        const shared = rect(
            inner.x + eat.left,
            inner.y + eat.top,
            inner.w - eat.left - eat.right,
            inner.h - eat.top - eat.bottom);
        const ok = bigEnough(shared);
        return _out(shape, ctx, seats, inner, shared, bands, null, ok,
            ok ? '' : `the shared arena comes out ${_dim(shared)} once ${seats} control bands are taken off it.`);
    }

    if (shape === SHAPES.TABLE) {
        // One board, taken in turns, read from any side. Nobody needs a control
        // zone — you touch the board itself — so a seat costs a 34 px banner
        // saying whether it is your go. Four seats cost 68 px in total.
        const banners = ring.map((s, i) => ({
            seat: i, rect: band(inner, s.edge, s.span, CHROME.BANNER), rot: s.rot,
            role: 'banner', active: i === active,
        }));
        const boardBox = rect(inner.x, inner.y + CHROME.BANNER, inner.w, inner.h - CHROME.BANNER * 2);
        // A shared board is read from four sides, so it wants to be square: a
        // long thin board is upside-down AND stretched for half the table.
        const side  = Math.min(boardBox.w, boardBox.h);
        const board = rect(boardBox.x + (boardBox.w - side) / 2, boardBox.y + (boardBox.h - side) / 2, side, side);
        const ok = bigEnough(board);
        return _out(shape, ctx, seats, inner, board, banners, null, ok,
            ok ? '' : `the shared board comes out ${_dim(board)}.`);
    }

    if (shape === SHAPES.RELAY) {
        // One player at a time, on the WHOLE screen, with everybody watching.
        // The cheapest structure there is: it costs one banner, it scales to any
        // number of people, and the pressure is free because they are all
        // looking at the same screen you are playing on.
        const bannerRect = band(inner, 'top', [0, 1], CHROME.BANNER);
        const play = rect(inner.x, inner.y + CHROME.BANNER, inner.w, inner.h - CHROME.BANNER);
        const out = [{ seat: active, rect: play, rot: 0, role: 'play' },
                     { seat: active, rect: bannerRect, rot: 0, role: 'banner', active: true }];
        const ok = bigEnough(play);
        // `shared` stays null: the playfield belongs to whoever is up, and the
        // others are watching it rather than reaching into it. What they share
        // is the SCREEN, which is the whole point of the structure and is not a
        // rectangle anybody draws into.
        return _out(shape, ctx, seats, inner, null, out, null, ok, ok ? '' : _tooSmall(play));
    }

    return _out(shape, ctx, seats, inner, null, [], null, false, `unknown shape "${shape}"`);
}

function _out(shape, ctx, n, inner, shared, seats, rail, ok, why) {
    return { shape, ctx, n, inner, shared, seats, rail, ok, why };
}
const _dim = r => `${r.w}x${r.h}`;
const _tooSmall = r => `the playfield comes out ${_dim(r)}, under the ${CHROME.MIN_PLAY}x${CHROME.MIN_PLAY} floor.`;

/**
 * One zone per seat, covering the screen, laid out where people are sitting.
 *
 * This is what a LIVE game — one everybody plays at once on a shared screen —
 * asks for. It is not `frameFor(SPLIT)`: a zone is a place to put a thumb and a
 * word, not a private playfield, so the 300x300 floor does not apply to it.
 * Quick Draw's zone needs to hold the word TAP and a finger; Meteor Dodge's
 * playfield needs to hold a storm. Both are "one area each" and only one of
 * them has a minimum size.
 *
 * The arrangement is the seat ring: at two, the shipped face-off exactly — one
 * full-width half each, the far one rotated. At three, the near edge belongs to
 * one player and the far edge is shared. At four, corners, because that is how
 * four people actually stand around something small.
 *
 * Returns [{ seat, rect, rot, edge }] in seat order.
 */
export function zonesFor(n, w, h) {
    const seats = Math.max(1, Math.min(4, n | 0));
    const inner = innerBox(w, h);
    const half  = inner.h / 2;
    return seatRing(seats).map((s, i) => {
        const [a, b] = s.span;
        const top = s.edge === 'top';
        return {
            seat: i,
            rect: rect(inner.x + inner.w * a,
                       top ? inner.y : inner.y + half,
                       inner.w * (b - a), half),
            rot: s.rot,
            edge: s.edge,
        };
    });
}

/**
 * Which structures can carry `n` players on this screen, in this context.
 *
 * This is the function a designer actually wants: "I have four people and a
 * phone — what am I allowed to build?"
 */
export function shapesFor(n, w, h, ctx = CONTEXTS.DEVICE) {
    return Object.values(SHAPES)
        .map(s => ({ shape: s, ...frameFor(s, n, w, h, { ctx }) }))
        .filter(f => f.ok)
        .map(f => f.shape);
}
