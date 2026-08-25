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
import { snapshot, signature } from './NetProtocol.js';
import { CONTRACT_POOL } from '../config/ContractPool.js';
import * as Renderer from '../engine/Renderer.js';
import * as UIManager from '../ui/UIManager.js';

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
    if (!Commands.has(name)) return;
    if (!_authorised(seat, name, args)) return;
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
const ANY_SEAT = new Set(['msgContinue', 'passContinue', 'buddyReportAck', 'mgIntroNext', 'mgLaunch']);

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

function _authorised(seat, name, args) {
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
    UIManager.updateUI();
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
