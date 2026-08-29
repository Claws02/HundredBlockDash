// ============================================================
// NET SYNC — the host broadcasts the game; a client becomes it
// ============================================================
// HOST SIDE: a poll, not an emit.
//
//   The obvious design is to call "broadcast now" from every place the turn
//   flow changes something. There are about forty such places across
//   GameController, Economy, Contracts and the buddy system, and the first one
//   anybody forgets is a silent desync that shows up as one phone's token
//   sitting on the wrong square with no error anywhere. So instead the host
//   samples its own state at a fixed rate, and sends when the signature moved.
//   It cannot be forgotten, it needs no imports in the game code, and it costs
//   one JSON.stringify of a few KB per tick.
//
//   The rate is set by what has to LOOK right rather than by what has to BE
//   right. A token hop is ~350 ms, and a walk advances one node at a time, so
//   sampling at 20 Hz sees every intermediate square and the clients animate
//   the same hops the host does.
//
// CLIENT SIDE: apply, then let the existing renderer and HUD do their job.
//
//   The snapshot is written INTO the live `state` object rather than replacing
//   it — `state` is a module singleton that thirty files hold a reference to,
//   and `p.mesh` is a live THREE object the client owns and the host knows
//   nothing about. So every field is copied across by hand and the mesh is left
//   alone; when a position changes, the client plays the same hop animation the
//   host is playing.

import { state } from '../core/GameState.js';
import * as Commands from '../core/Commands.js';
import * as Session from './NetSession.js';
import { snapshot, signature, BEAT_OVERLAYS } from './NetProtocol.js';
import { CONTRACT_POOL } from '../config/ContractPool.js';
import * as Renderer from '../engine/Renderer.js';
import * as UIManager from '../ui/UIManager.js';
import * as ModalManager from '../ui/ModalManager.js';
import * as NetDice from './NetDice.js';
import * as NetMinigame from './NetMinigame.js';
import * as ReadyGate from './ReadyGate.js';

const SNAP_HZ = 20;

let _timer   = null;
let _lastSig = '';
let _applying = false;

// ── Host ────────────────────────────────────────────────────────────────────

export function startHostLoop() {
    stop();
    _lastSig = '';
    _timer = setInterval(() => {
        if (!Session.isHost()) return;
        const snap = snapshot(state);
        const sig  = signature(snap);
        if (sig === _lastSig) return;
        _lastSig = sig;
        Session.pushSnapshot(snap);
    }, Math.round(1000 / SNAP_HZ));
}

export function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

/**
 * Host: a client asked for something. Authorise it, then run it locally.
 *
 * The whole security model of the match is this function. A client cannot make
 * anything happen except by sending an intent, and an intent is only obeyed
 * when it is that player's turn — so a modified client can spam the wire and
 * still not roll on somebody else's go.
 */
export function applyIntent({ seat, name, args }) {
    if (!Session.isHost()) return;
    // A ready-gate vote is the one intent that is ABOUT the seat rather than
    // performed by it, and Commands.runLocal() drops the envelope's seat. So it
    // is answered here, where the seat is still in hand.
    // A ready vote is ABOUT a seat rather than performed by it, and
    // Commands.runLocal() drops the envelope's seat — so running it through the
    // ordinary path made the host re-run its OWN press, find it already spent,
    // and silently discard the client's vote. Answered here, where the seat is
    // still in hand.
    if (name === 'briefingReady') { ReadyGate.voteBriefing(seat); return; }
    if (name === 'gateAck')       { ReadyGate.ack(args[0], seat); return; }
    // A minigame score is the other intent that carries its own seat rather
    // than being a decision the active player makes. It is deliberately NOT a
    // command: no seat may run it locally, and the seat it claims is checked
    // against the envelope's rather than taken on trust — a client reporting a
    // score on somebody else's behalf would decide a round it was not in.
    if (name === 'mgScore') {
        if (args[0] !== seat) return;
        NetMinigame.hostScore(seat, args[1]);
        return;
    }
    // A running score, for the standings rail. Same rule as the final one: the
    // seat it claims is checked against the envelope's, so nobody can move
    // another player's number on the rail. A tick decides nothing — the round
    // is still settled by mgScore — so a lost one costs a frame of a readout.
    if (name === 'mgTick') {
        if (args[0] !== seat) return;
        NetMinigame.hostTick(seat, args[1]);
        return;
    }
    if (!Commands.has(name)) return;
    if (!authorised(seat, name, args)) return;
    Commands.runLocal(name, ...args);
}

// Which commands a given seat may issue right now.
//
// Almost everything is "it has to be your turn". The exceptions are the beats
// where the game is waiting on somebody who is NOT the active player: the
// minigame ready buttons belong to the two seats playing it, and the shared
// result cards can be dismissed by anyone who is looking at them, because
// holding a match up because one person put their phone down is worse than
// letting the other three move it along.
const ANY_SEAT = new Set([
    'msgContinue', 'passContinue', 'buddyReportAck', 'mgIntroNext', 'mgLaunch',
    // A ready vote is not a turn action — it is every seat's to cast, and the
    // whole point is that the beat waits for all of them. Left out of this set
    // it fell through to "it has to be your turn", so only whichever seat won
    // the random start could vote and every other press was refused in
    // silence: the briefing sat there and the match never began.
    'briefingReady',
]);

// Commands that are only legal at a particular beat. Locally the control simply
// is not on screen at any other time, which is why these were never checked —
// over the wire "the button was not on screen" is not a guarantee of anything,
// and a client that sends `roll` during the opening flyover would otherwise
// throw dice into a match that has not started.
const ONLY_IN = {
    roll:       new Set(['PRE_ROLL']),
    useItem:    new Set(['PRE_ROLL']),
    cabbie:     new Set(['PRE_ROLL']),
    gateRoll:   new Set(['GATE']),
    pathChoice: new Set(['MOVING', 'BRANCH', 'MAP', 'PRE_ROLL']),
};

export function authorised(seat, name, args) {
    if (typeof seat !== 'number' || !state.players[seat]) return false;
    const beats = ONLY_IN[name];
    if (beats && !beats.has(state.gameState)) return false;
    if (ANY_SEAT.has(name)) return true;
    if (name === 'mgReady') return true;           // slot ownership is checked by the manager
    // Commands that name a player in their arguments must name themselves.
    if (name === 'useItem' || name === 'cabbie' || name === 'dropConfirm') {
        if (args.length && args[0] !== seat) return false;
    }
    return seat === state.activePlayer;
}

// ── Client ──────────────────────────────────────────────────────────────────

/** True while a snapshot is being written in, so nothing mistakes it for play. */
export function isApplying() { return _applying; }

export function applySnapshot(s) {
    if (!s || !Array.isArray(s.p)) return;
    _applying = true;
    try { _apply(s); } finally { _applying = false; }
}

function _apply(s) {
    // Flow
    state.gameState   = s.gs;
    state.activePlayer = s.ap;
    state.totalTurns  = s.turns;
    state.currentRound = s.round;
    state.gameStarted = s.started;
    state.gateOpen    = s.gate;
    state.cityRounds  = s.rounds;
    state.hbdLength   = s.hbdLen;
    state.history     = s.hist || [];

    // Board. Rebuilt in place: the renderer reads `state.board[id].type` and a
    // wholesale replacement would leave any held reference pointing at the old
    // object.
    let tilesChanged = false;
    for (const id in s.board) {
        const v = s.board[id];
        const type  = Array.isArray(v) ? v[0] : v;
        const owner = Array.isArray(v) ? v[1] : undefined;
        const cur = state.board[id];
        if (!cur) { state.board[id] = { type, ...(owner === undefined ? {} : { owner }) }; tilesChanged = true; continue; }
        if (cur.type !== type || cur.owner !== owner) tilesChanged = true;
        cur.type = type;
        if (owner === undefined) delete cur.owner; else cur.owner = owner;
    }

    // Buddy on the board
    const hadBuddy = state.allyOnMap && state.allyOnMap.nodeId;
    state.allyOnMap = s.buddy ? { ...s.buddy } : null;
    const hasBuddy = state.allyOnMap && state.allyOnMap.nodeId;
    if (hadBuddy !== hasBuddy) {
        if (hasBuddy) Renderer.placeAllyMarker(state.allyOnMap.nodeId, state.allyOnMap.allyType);
        else Renderer.removeAllyMarker();
    }

    // Bounties. The client keeps its own card objects (they carry the copy the
    // player reads); the wire only says which cards and how far along each seat is.
    state.activeContracts = (s.bounties || []).map(b => {
        const card = CONTRACT_POOL.find(c => c.id === b.id);
        return card ? { ...card, _prog: (b.prog || []).slice() } : null;
    }).filter(Boolean);

    // Players
    _syncPlayers(s.p);

    if (tilesChanged) Renderer.updateSingleTile();
    _reconcile(s);
    UIManager.updateUI();
}

// ============================================================
// RECONCILE — every snapshot is a chance to notice we drifted
// ============================================================
// A snapshot is not only new state, it is a statement about what the host is
// DOING. That is enough to check a client is showing the same kind of screen,
// and to put it right when it is not.
//
// This exists because of a specific failure and a general lesson. The failure:
// a buddy arrival parks the camera on 'CINEMATIC' and hands it back through a
// continuation that only the host has, so a client's camera stuck looking at
// the buddy for the rest of the match. The lesson: every mirrored beat has a
// way in and needs a way out, and "the client replays the way in" is only half
// of it. Rather than chase each beat's exit path one at a time — which is the
// same mistake three times over already — the host's presentation state is
// treated as authoritative and re-asserted continuously.
//
// Deliberately narrow. It corrects things that are WRONG, never things that
// are merely different: a client's own map view, its scroll position, which
// card it has open for its own decision, are all its business.
function _reconcile(s) {
    // 0. THE DICE. A spectator's own tumble, started and stopped from the
    //    host's rolling state — no extra message, and nothing is read off it.
    NetDice.syncFromSnapshot(s.gs);

    // 1. THE CAMERA. Cheap, and the one that actually broke.
    if (s.cam === 'FOLLOW' && state.cameraState === 'CINEMATIC') {
        Renderer.endCinematic();
    } else if (s.cam && s.cam !== state.cameraState && s.cam !== 'CINEMATIC') {
        // Never copy CINEMATIC across: that mode belongs to a set piece that
        // is playing HERE, and stealing it mid-animation would stutter. Every
        // other mode is just "where should this be pointing".
        state.cameraState = s.cam;
        if (s.cam === 'FOLLOW') Renderer.snapCameraToActive();
    }

    // 2. BEATS THE HOST HAS LEFT.
    //
    //    The host names what is on its screen; anything up here that is not up
    //    there is over. This replaced a per-beat list that was wrong four
    //    times: the buddy report had no take-down at all, so a client's card
    //    sat there with an OK button whose press went to a host that had long
    //    since moved on.
    //
    //    ONE DIRECTION ONLY. Closing is safe because the host having left a
    //    beat is a fact about the game. Opening is not: a card needs content
    //    the snapshot does not carry, which is what the scene mirror is for.
    if (Array.isArray(s.ov)) {
        const up = new Set(s.ov);
        BEAT_OVERLAYS.forEach(id => { if (!up.has(id)) _hideIfStale(id, true); });
    }

    // 3. The board is playable again, so nothing may still be covering it.
    const gs = s.gs;
    if (gs === 'PRE_ROLL' || gs === 'MOVING' || gs === 'ROLLING') {
        const ui = document.getElementById('ui-layer');
        if (ui && ui.style.display === 'none') ui.style.display = 'block';
    }
}

// Some beats are more than an element. A raw `display: none` on the modal
// container leaves `body.modal-open` set and the toast rail shoved aside; on
// the buddy report it orphans the mirrored copy DualRead made. Each of those
// has a real close, and it is used.
const CLOSERS = {
    'modal-overlay': () => ModalManager.closeAllModals(),
    'ally-arrival':  () => UIManager.closeBuddyReportNow(),
    'city-briefing': () => UIManager.closeBriefingNow(),
};

// Only touches something that is actually on screen when it should not be, so
// a healthy client does no DOM work at 20 Hz.
function _hideIfStale(id, shouldBeGone) {
    if (!shouldBeGone) return;
    const el = document.getElementById(id);
    if (!el || el.style.display === 'none' || getComputedStyle(el).display === 'none') return;
    const closer = CLOSERS[id];
    if (closer) closer(); else el.style.display = 'none';
}

function _syncPlayers(list) {
    // The seat count is fixed at START, so a mismatch here means a snapshot
    // from a different match. Ignore it rather than building half a table.
    if (list.length !== state.players.length) return;

    list.forEach(np => {
        const p = state.players[np.id];
        if (!p) return;
        const moved = p.pos !== np.pos;

        p.name = np.name; p.charType = np.char; p.isBot = np.bot;
        p.coins = np.coins; p.coinsEarned = np.earned; p.mgWins = np.mgWins;
        p.prevPos = np.prev;
        p.inv = np.inv.slice();
        p._shielded = np.shield;
        p.districtsVisited = { ...np.districts };
        p.fullCircuitsCompleted = np.laps;
        p.contractsClaimed = np.claimed;
        p.alliesClaimed = np.buddies;
        p.duelsWon = np.duels;
        p.itemsBought = np.bought;
        p.consecutiveMgWins = np.streak;
        p.cabbieUsedThisRound = np.cab;

        _syncAllies(p, np.allies);

        if (moved) {
            p.pos = np.pos;
            // Walk the token rather than teleporting it. The host advances one
            // square at a time and this samples at 20 Hz, so a client sees the
            // same sequence of squares and plays the same sequence of hops.
            if (p.mesh) {
                try { Renderer.animatePlayerHop(p, p.pos, () => {}); }
                catch (e) { p.mesh.position.copy(Renderer.getPos(p.pos)); }
            }
        } else {
            p.pos = np.pos;
        }
    });
}

// Buddies carry a 3D model that belongs to this device. Only the difference is
// applied, so a buddy that is still there keeps the mesh it already has —
// rebuilding them every snapshot at 20 Hz would leak a model per frame, which
// is the exact failure qa/polish.js was written to catch.
function _syncAllies(p, incoming) {
    const want = incoming || [];
    while (p.allies.length > want.length) {
        const gone = p.allies.pop();
        if (gone && gone.mesh) Renderer.detachAllyMesh(gone.mesh);
    }
    want.forEach((a, i) => {
        const cur = p.allies[i];
        if (cur && cur.type === a.type) {
            cur.turnsRemaining = a.turnsRemaining;
            cur.shieldCharges = a.shieldCharges;
            return;
        }
        if (cur && cur.mesh) Renderer.detachAllyMesh(cur.mesh);
        const mesh = Renderer.attachAllyMesh(p, i, a.type);
        p.allies[i] = { type: a.type, turnsRemaining: a.turnsRemaining, shieldCharges: a.shieldCharges, mesh };
    });
}
