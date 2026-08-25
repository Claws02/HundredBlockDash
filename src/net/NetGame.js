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
import { MSG, PROTOCOL_VERSION } from './NetProtocol.js';
import * as T from './NetTransport.js';
import { PLAYER_SLOTS } from '../config/GameConfig.js';

export { ROLE } from './NetSession.js';

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
        if (!Session.isClient()) return false;      // host and offline: run it
        Session.sendIntent(name, args);
        return true;                                // handled — do not run locally
    });

    Session.on('intent', payload => Sync.applyIntent(payload));
    Session.on('snap',   snap    => Sync.applySnapshot(snap));
    Session.on('start',  info    => _beginMatch(info));

    // Host: mirror every beat as it goes up. OWNER beats go to the one phone
    // whose decision it is; SHARED beats go to everybody.
    Scenes.onScene((name, payload, tier) => {
        if (!Session.isHost()) return;
        const target = tier === 'owner' ? _peerForSeat(payload.seat) : undefined;
        if (tier === 'owner' && !target) return;    // it is the host's own beat
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
        case 'shop':
            Modal.openShop(p.district, p.discount);
            return;
        case 'shopOffer':
            Modal.showShopOffer();
            return;
        case 'useItems':
            Modal.openUseModal();
            return;
        case 'customDice':
            Modal.openCustomDiceModal();
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
        default:
            return;
    }
}
