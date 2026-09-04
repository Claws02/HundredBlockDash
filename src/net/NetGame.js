// ============================================================
// NET GAME — the wiring between a room and a match
// ============================================================
// Everything else in src/net/ does one job. This is the file that knows how
// they fit together, and it is the only one the rest of the game loads.
//
//   Commands  → dispatcher: a client's button press becomes an intent
//   Session   → intents in (host), snapshots in (client), the roster
//   NetSync   → state on the wire
//   Scenes    → what is on screen on the wire
//
// THE TWO ROLES, in one paragraph each.
//
//   HOST runs the game exactly as a local match does. It additionally: obeys
//   authorised intents from clients as though they had been pressed here,
//   samples its own state 20× a second and pushes what changed, and mirrors
//   every full-screen beat as it raises it.
//
//   CLIENT boots the same match — same map, same board geometry, same meshes —
//   and then never advances it. Its turn engine is never entered: the one
//   entry point (startPreRoll, at the end of startGame) is skipped, and every
//   player decision leaves as an intent instead of running. What it renders is
//   whatever the last snapshot said, and what it shows is whatever beat the
//   host last mirrored to it.

import { state, setPlayerCount } from '../core/GameState.js';
import * as Commands from '../core/Commands.js';
import * as Scenes from '../ui/Scenes.js';
import * as Session from './NetSession.js';
import * as Sync from './NetSync.js';
import * as NetMinigame from './NetMinigame.js';
import * as GC from '../core/GameController.js';
import * as ReadyGate from './ReadyGate.js';
import { MSG, PROTOCOL_VERSION } from './NetProtocol.js';
import * as T from './NetTransport.js';
import { PLAYER_SLOTS } from '../config/GameConfig.js';
import { SCENE } from '../config/SceneTiming.js';

export { ROLE } from './NetSession.js';

// The opening briefing — the four roads, read by everybody before anybody
// rolls. One id because it is one gate; more will want their own.
export const BRIEFING_GATE = ReadyGate.BRIEFING;

// The one beat the whole table has to acknowledge before anybody rolls.
// Registered here rather than in UIManager because only this layer knows
// whether "ready" is a press or a vote — offline it closes the card, online it
// waits for everybody.
// A client never reaches this: the dispatcher forwards the press, and the host
// applies it for that seat through the same ReadyGate.voteBriefing() this uses.
// Offline there is no gate to hold — one player, one press, straight through.
// The generic ready-gate vote. NetSync already answers this intent on the host
// with the envelope's seat in hand; this is the definition that lets a CLIENT
// send it at all, and that lets the host cast its own vote through the same
// name. Offline there is no gate, so it is a no-op — the caller has already
// done whatever the press meant.
Commands.define({
    gateAck: (id) => {
        if (!Session.isOnline()) return;
        ReadyGate.ack(id, Session.mySeat());
    },
});

Commands.define({
    briefingReady: () => {
        if (!Session.isOnline()) { _closeBriefingHere(); return; }
        ReadyGate.voteBriefing(Session.mySeat());
        // The host's own `gateCount` only travels outward, so its button is
        // repainted here.
        if (_ui) _ui.UI.markBriefingWaiting(ReadyGate.pending(BRIEFING_GATE));
    },
});

function _closeBriefingHere() {
    if (_ui) { _ui.UI.closeBriefingNow(); return; }
    _uiReady.then(() => _ui && _ui.UI.closeBriefingNow());
}

let _controller = null;
let _wired = false;

export function init(controller) {
    _controller = controller;
    if (_wired) return;
    _wired = true;

    // A client's presses never run here. `runLocal` is how the host executes
    // one that has arrived over the wire, so this only ever sees a press made
    // on this device.
    Commands.setDispatcher((name, args) => {
        if (Session.isClient()) { Session.sendIntent(name, args); return true; }

        // The HOST is a player too, and its presses were the one path into the
        // game with no authority behind them at all: a client's intent is
        // checked by Sync.authorised(), but the host called straight through.
        // Locally that was invisible, because a control is only rendered for
        // the seat whose turn it is — over the wire "the button was not on
        // screen" guarantees nothing, and the host could roll on somebody
        // else's go. Same rule, same function, applied to its own seat.
        if (Session.isHost() && !Sync.authorised(Session.mySeat(), name, args)) return true;

        // Offline: every local mode passes one device around, so the seat that
        // may act is whichever one is up — there is nothing to check here.
        return false;
    });

    // How a networked round is played. src/core knows nothing about src/net,
    // so the board asks for this rather than importing it: GameController
    // calls the hook and falls back to a draw if nobody registered one.
    //
    // Returning false means "not mine" — an offline match, or a client, which
    // never decides what the round is. The host picks the game and the seed;
    // every other device hears about both in the announcement.
    GC.setOnlineContest((seats, done) => {
        if (!Session.isHost()) return true;   // a client waits to be told
        const type = NetMinigame.pickGame(state.totalTurns + (state.currentRound || 0) * 7);
        if (!type) return false;
        NetMinigame.hostRun(type, seats, done);
        return true;
    });

    Session.on('intent', payload => Sync.applyIntent(payload));
    Session.on('snap',   snap    => Sync.applySnapshot(snap));
    Session.on('start',  info    => _beginMatch(info));

    // Host: mirror every beat as it goes up. OWNER beats go to the one phone
    // whose decision it is; SHARED beats go to everybody.
    Scenes.onScene((name, payload, tier) => {
        if (!Session.isHost()) return;
        let target;
        if (tier === 'owner') {
            // An owner beat with no seat on it used to fall through this and be
            // dropped in silence, which is how every result card stopped
            // reaching the player it was about. Default to whoever is up —
            // that is what an owner beat means — and say so when it happens,
            // because a beat that has to be guessed at is a missing `seat`.
            let seat = payload.seat;
            if (typeof seat !== 'number') {
                console.warn(`[net] owner scene "${name}" carried no seat; assuming the active player`);
                seat = state.activePlayer;
            }
            if (seat === Session.mySeat()) return;   // it is the host's own beat
            target = _peerForSeat(seat);
            if (!target) return;                     // that seat has no phone on it
        }
        T.send({ t: MSG.SCENE, v: PROTOCOL_VERSION, k: name, p: _stripPayload(payload) }, target);
    });

    // Client: replay a mirrored beat.
    //
    // The UI modules are loaded ONCE, here, rather than awaited inside the
    // handler. Two reasons, and the second is the important one: an async
    // replay lands a frame or two late for no reason, and — because
    // `Scenes.replaying()` restores its flag synchronously — an awaited replay
    // would call the UI *after* the guard had already been lifted, so the
    // re-announcement it exists to suppress would fire anyway.
    T.onMessage(msg => {
        if (!msg || msg.t !== MSG.SCENE || !Session.isClient()) return;
        if (!_ui) { _uiReady.then(() => _replayNow(msg.k, msg.p || {})); return; }
        _replayNow(msg.k, msg.p || {});
    });
}

// Payloads cross the wire, so anything in one has to survive JSON. Callbacks
// and mesh references do not; they are the host's own continuation and mean
// nothing on another device.
function _stripPayload(p) {
    const out = {};
    for (const k in p) {
        const v = p[k];
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}

function _peerForSeat(seat) {
    if (typeof seat !== 'number') return undefined;
    const row = Session.roster()[seat];
    if (!row || seat === Session.mySeat()) return undefined;
    return row.peerId;
}

// ── Starting a match ────────────────────────────────────────────────────────

/**
 * Both roles run this. The client builds the same match the host does — same
 * map, same length, same seats, same characters — because the board geometry,
 * the meshes and the camera all have to exist before a snapshot can be drawn
 * into them. Everything random about the setup (the board's space types, the
 * bounty draw, who goes first) is then corrected by the first snapshot, which
 * lands within a frame or two.
 */
function _beginMatch({ seats, setup, mySeat }) {
    state.playStyle = 'online';
    state.localSeat = typeof mySeat === 'number' ? mySeat : 0;
    setPlayerCount(seats.length);
    seats.forEach((row, i) => {
        const p = state.players[i];
        if (!p) return;
        p.name     = row.name || PLAYER_SLOTS[i].name;
        p.charType = row.char || PLAYER_SLOTS[i].charType;
        // A seat whose player has dropped is played by the bot — but only on
        // the host, which is the device that actually runs the bot's turns.
        p.isBot    = !!row.bot && Session.isHost();
    });
    state.selectedMap = setup.map;
    state.hbdLength   = setup.hbdLength;
    state.cityRounds  = setup.cityRounds;

    // The client's turn engine must never be entered. This is the single flag
    // that keeps it out: startGame() checks it instead of opening the first
    // turn, and nothing else in the flow can start without that.
    state.netReplica = Session.isClient();

    if (Session.isHost()) Sync.startHostLoop();
    _controller.startGame();
}

/** Host: gather the setup the clients need and start. */
export function hostStartMatch() {
    return Session.startMatch({
        map:       state.selectedMap,
        hbdLength: state.hbdLength,
        cityRounds: state.cityRounds,
    });
}

let _ui = null;
const _uiReady = Promise.all([
    import('../ui/ModalManager.js'),
    import('../ui/UIManager.js'),
]).then(([Modal, UI]) => { _ui = { Modal, UI }; });

function _replayNow(kind, payload) {
    if (!_ui) return;
    Scenes.replaying(() => _replayScene(kind, payload, _ui.Modal, _ui.UI));
}

export function teardown() {
    // A round in progress holds a grace timer and a continuation into the turn
    // flow. Leaving a match without dropping them fires that continuation into
    // a game that no longer exists.
    NetMinigame.abort();
    Sync.stop();
    Commands.setDispatcher(null);
    state.netReplica = false;
    state.localSeat  = null;
    return Session.leave();
}

// ── Replaying a mirrored beat on a client ───────────────────────────────────
//
// Each case reproduces the beat from the host's own payload. The continuations
// passed in are no-ops: pressing CONTINUE on a client sends an intent, and the
// host's real continuation runs there.

function _replayScene(kind, p, Modal, UI) {
    switch (kind) {
        case 'message':
            Modal.showMessage(p.title, p.desc, p.icon, { tier: p.tier, ticker: p.ticker });
            return;
        case 'closeAll':
            Modal.closeAllModals();
            return;

        // A round played on every phone at once. The GAME is not mirrored —
        // each device runs its own copy from the announced seed, which is the
        // whole reason a parallel game crosses the wire cheaply. What is
        // mirrored is the announcement and, later, the scores.
        case 'soloGame':
            import('./NetMinigame.js').then(N => N.playLocally(p.game, p.seed, p.seats || []));
            return;
        // The gate opened. Every device takes its card down and starts the
        // same game on this beat, which is what makes the clocks comparable.
        case 'soloGo':
            import('./NetMinigame.js').then(N => N.beginLocally(p.game, p.seed));
            return;
        case 'soloStand':
            import('./NetMinigame.js').then(N => N.showStandings(p));
            return;
        case 'soloResult':
            import('./NetMinigame.js').then(N => N.showResults(p));
            return;
        case 'soloClose':
            import('./NetMinigame.js').then(N => N.clearScreens());
            return;
        case 'shop':
            Modal.openShop(p.district, p.discount);
            return;
        case 'modal':
            // Reproduced from its id alone. Everything with content a snapshot
            // cannot carry has its own case below.
            Modal.showModal(p.id);
            return;
        case 'useItems':
            Modal.openUseModal();
            return;

        case 'dropPick': {
            const player = state.players[p.seat];
            if (player) Modal.openDropModal(player, p.newItemId, p.cost, p.returnState);
            return;
        }
        case 'duelBet': {
            const me = state.players[p.seat], foe = state.players[p.foe];
            // The wager is sent as an intent, so the callback here only has to
            // put the card away — the host runs the duel.
            if (me && foe) Modal.showDuelModal(me, foe, () => {});
            return;
        }
        case 'junction':
            UI.showJunctionArrows(p.junctionId, p.fromNodeId, p.options, p.stepsLeft);
            return;
        case 'buddyReport':
            UI.showBuddyReport(p.rep, p.isNew, () => {});
            return;
        case 'allyEncounter':
            UI.showAllyEncounterModal(p.ally, p.playerAllies, () => {});
            return;
        case 'allySteal': {
            const target = state.players[p.targetSeat];
            if (target) UI.showAllyStealModal(target, () => {});
            return;
        }
        case 'gate':
            // The gate overlay is raised by the controller, not by a modal
            // call, so the client reproduces just the parts that are visual.
            document.getElementById('ui-layer').style.display = 'none';
            document.getElementById('gate-overlay').style.display = 'flex';
            return;
        case 'winScreen':
            // Render the HOST's final figures, never re-score. `false` skips
            // the end-of-match bonuses, which the host has already paid and
            // which arrive in a snapshot — paying them twice would inflate
            // every number on the card. The short wait is for that snapshot:
            // the scene and the state it describes are separate messages and
            // arrive in whichever order they arrive.
            setTimeout(async () => {
                const { calculateWinner } = await import('../core/WinScreen.js');
                calculateWinner(false);
            }, 500);
            return;
        case 'fx': {
            // The board's own animations. Fired and forgotten: the host owns
            // what happens next and it arrives as a snapshot.
            import('../engine/Fx.js').then(F => F.replay(p.fx, p.args));
            return;
        }
        case 'rollCallout':
            // The real number has landed, so the spectator's props come down.
            // A die is only readable at rest and these never reach it — which
            // is what makes throwing them honest.
            import('./NetDice.js').then(D => D.stop());
            UI.showRollCallout(p.n);
            // The host takes it down when the token sets off; a client has no
            // such moment, so it holds for the same beat and then clears.
            setTimeout(() => UI.hideRollCallout(), SCENE.DICE_READ);
            return;
        case 'gateCount':
            // Somebody pressed; say how many the table is still waiting on.
            // The count is the table's; whether the button is spent is this
            // device's. Passing only the count disabled the button belonging to
            // the very player everybody was waiting for.
            if (p.id === BRIEFING_GATE) UI.markBriefingWaiting(p.waiting);
            else import('../ui/SoloRound.js').then(S => S.markWaiting(p.waiting));
            return;
        case 'gateOpen':
            // Everybody is in. Every device moves on at the same instant,
            // which is the whole point of the gate.
            if (p.id === BRIEFING_GATE) UI.closeBriefingNow();
            return;
        case 'turnBanner':
            UI.showTurnBanner(p.seat, { sub: p.sub });
            return;
        case 'gateEnd':
            document.getElementById('gate-overlay').style.display = 'none';
            document.getElementById('ui-layer').style.display = 'block';
            document.body.classList.remove('gate-scene');
            return;
        default:
            return;
    }
}
