// ============================================================
// NET SESSION — who is in the room, which seat they are, who decides
// ============================================================
// One phone is the HOST. It creates the room, it runs GameController, and its
// `state` is the game. Everyone else is a CLIENT: they render, they send what
// their player pressed, and they never mutate `state` themselves.
//
// Why host-authoritative rather than lockstep: the dice are a cannon.js rigid
// body simulation and every minigame integrates floating point per frame.
// Neither is bit-identical across two phones, so a deterministic lockstep would
// disagree within seconds. Making one device the truth removes the entire class
// of problem.
//
// The cost, stated where somebody will find it: if the host leaves, the match
// is over. Host migration means transplanting a live turn-flow continuation —
// half a dozen module-level closures in GameController — onto another device,
// and it is out of scope. What IS handled is a client leaving: their seat is
// handed to the bot and play carries on.

import * as T from './NetTransport.js';
import { MSG, PROTOCOL_VERSION, KICK_REASON } from './NetProtocol.js';
import { MAX_PLAYERS, MIN_PLAYERS } from '../config/GameConfig.js';

export const ROLE = { OFFLINE: 'offline', HOST: 'host', CLIENT: 'client' };

let _role = ROLE.OFFLINE;
let _seat = null;         // my seat index, once seats are dealt
let _name = 'Player';
let _started = false;

// Lobby roster. Host holds the authoritative copy; clients hold whatever the
// last LOBBY message said. Ordered — index IS the seat number.
//   { peerId, name, char, ready, connected, bot }
let _roster = [];

const _listeners = { roster: [], start: [], snap: [], intent: [], status: [], end: [] };

function _emit(k, ...a) {
    _listeners[k].slice().forEach(fn => {
        try { fn(...a); } catch (e) { console.error(`[net] ${k} listener failed:`, e); }
    });
}
export function on(kind, fn) {
    if (!_listeners[kind]) throw new Error('no such event: ' + kind);
    _listeners[kind].push(fn);
    return () => { const i = _listeners[kind].indexOf(fn); if (i >= 0) _listeners[kind].splice(i, 1); };
}

export function role()      { return _role; }
export function isHost()    { return _role === ROLE.HOST; }
export function isClient()  { return _role === ROLE.CLIENT; }
export function isOnline()  { return _role !== ROLE.OFFLINE; }
export function mySeat()    { return _seat; }
export function roster()    { return _roster.map(r => ({ ...r })); }
export function seatCount() { return _roster.length; }
export function code()      { return T.roomCode(); }
export function started()   { return _started; }

// ── Opening a room ──────────────────────────────────────────────────────────

export async function host(displayName) {
    _name = displayName || 'Player 1';
    const code = T.makeRoomCode();
    _wire();
    const info = await T.connect(code);
    _role = ROLE.HOST;
    _seat = 0;
    _started = false;
    // The host readies up the same way everybody else does. Seating them as
    // ready-by-default meant their own READY button had nothing to turn on and
    // toggled them OFF instead, so a full lobby could never satisfy canStart().
    _roster = [{ peerId: info.selfId, name: _name, char: null, ready: false, connected: true, bot: false }];
    _emit('roster', roster());
    _emit('status', { kind: 'hosting', code, strategy: info.strategy });
    return code;
}

export async function join(code, displayName) {
    _name = displayName || 'Player';
    _wire();
    const info = await T.connect(code);
    _role = ROLE.CLIENT;
    _seat = null;
    _started = false;
    _roster = [];
    _emit('status', { kind: 'joining', code: info.code, strategy: info.strategy });
    // The host may not have finished its side of the handshake yet, and there
    // is no "the room is ready" signal to wait on — so say hello now AND on
    // every peer that turns up, and let the host de-duplicate by peer id.
    T.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: _name });
    return info.code;
}

export async function leave() {
    if (_role !== ROLE.OFFLINE) T.send({ t: MSG.BYE });
    await T.disconnect();
    _role = ROLE.OFFLINE; _seat = null; _roster = []; _started = false;
    _emit('status', { kind: 'left' });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

let _wired = false;
function _wire() {
    if (_wired) return;
    _wired = true;

    T.onPeerJoin(id => {
        if (isHost()) {
            // A new peer knows nothing yet; it will say HELLO. Send the roster
            // anyway so a client that lost the reply still repaints.
            _broadcastLobby();
        } else {
            // The peer that just appeared is very likely the host.
            T.send({ t: MSG.HELLO, v: PROTOCOL_VERSION, name: _name });
        }
    });

    T.onPeerLeave(id => {
        if (!isHost()) {
            // Only the host matters to a client, and we do not track which peer
            // is the host beyond "the one sending snapshots" — so treat any
            // departure while online as possibly fatal and let the UI decide.
            _emit('status', { kind: 'peer-left', peerId: id });
            return;
        }
        const slot = _roster.find(r => r.peerId === id);
        if (!slot) return;
        slot.connected = false;
        if (_started) {
            // Mid-match: the bot takes over rather than the match stalling on
            // a seat nobody is holding.
            slot.bot = true;
            _emit('status', { kind: 'seat-dropped', seat: _roster.indexOf(slot), name: slot.name });
        } else {
            _roster.splice(_roster.indexOf(slot), 1);
        }
        _broadcastLobby();
        _emit('roster', roster());
    });

    T.onMessage((msg, peerId) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.v !== undefined && msg.v !== PROTOCOL_VERSION) {
            if (isHost()) T.send({ t: MSG.KICK, reason: KICK_REASON.VERSION }, peerId);
            return;
        }
        isHost() ? _hostRecv(msg, peerId) : _clientRecv(msg, peerId);
    });

    T.onError(e => _emit('status', { kind: 'error', error: e && (e.message || String(e)) }));
}

// ── Host side ───────────────────────────────────────────────────────────────

function _hostRecv(msg, peerId) {
    switch (msg.t) {
        case MSG.HELLO: {
            const existing = _roster.find(r => r.peerId === peerId);
            if (existing) {                 // a repeat hello: reconnect, not a new seat
                existing.connected = true;
                existing.bot = false;
                _broadcastLobby();
                _emit('roster', roster());
                return;
            }
            if (_started)                { T.send({ t: MSG.KICK, reason: KICK_REASON.STARTED }, peerId); return; }
            if (_roster.length >= MAX_PLAYERS) { T.send({ t: MSG.KICK, reason: KICK_REASON.FULL }, peerId); return; }
            _roster.push({
                peerId, name: String(msg.name || 'Player').slice(0, 14),
                char: null, ready: false, connected: true, bot: false,
            });
            _broadcastLobby();
            _emit('roster', roster());
            return;
        }
        case MSG.PICK: {
            const slot = _roster.find(r => r.peerId === peerId);
            if (!slot || _started) return;
            // Two people cannot take the same character; last one to ask loses.
            if (_roster.some(r => r !== slot && r.char === msg.char)) return;
            slot.char = msg.char;
            _broadcastLobby();
            _emit('roster', roster());
            return;
        }
        case MSG.READY: {
            const slot = _roster.find(r => r.peerId === peerId);
            if (!slot || _started) return;
            slot.ready = !!msg.ready;
            _broadcastLobby();
            _emit('roster', roster());
            return;
        }
        case MSG.INTENT: {
            const seat = _roster.findIndex(r => r.peerId === peerId);
            if (seat < 0) return;
            _emit('intent', { seat, name: msg.n, args: Array.isArray(msg.a) ? msg.a : [] });
            return;
        }
        case MSG.BYE: {
            const slot = _roster.find(r => r.peerId === peerId);
            if (slot) { slot.connected = false; if (_started) slot.bot = true; else _roster.splice(_roster.indexOf(slot), 1); }
            _broadcastLobby();
            _emit('roster', roster());
            return;
        }
    }
}

function _broadcastLobby() {
    if (!isHost()) return;
    T.send({
        t: MSG.LOBBY, v: PROTOCOL_VERSION, code: T.roomCode(),
        seats: _roster.map(r => ({ peerId: r.peerId, name: r.name, char: r.char, ready: r.ready, connected: r.connected, bot: r.bot })),
    });
}

/**
 * Host only: change one seat's own lobby choices and re-broadcast.
 *
 * The host is a player, and its picks do not travel over the wire the way a
 * client's do. Rather than let the lobby keep a second copy of seat 0 that
 * could disagree with this one, it asks here.
 */
export function hostUpdateSeat(seat, patch) {
    if (!isHost() || _started) return false;
    const row = _roster[seat];
    if (!row) return false;
    if (patch.char !== undefined) {
        if (_roster.some((r, i) => i !== seat && r.char === patch.char)) return false;
        row.char = patch.char;
    }
    if (patch.ready !== undefined) row.ready = !!patch.ready;
    if (patch.name !== undefined)  row.name = String(patch.name).slice(0, 14);
    _broadcastLobby();
    _emit('roster', roster());
    return true;
}

/** Host only: can the match begin? */
export function canStart() {
    return isHost() && !_started
        && _roster.length >= MIN_PLAYERS
        && _roster.every(r => r.ready && r.char);
}

/** Host only: lock the roster and tell everybody the setup. */
export function startMatch(setup) {
    if (!isHost()) return false;
    _started = true;
    const payload = {
        t: MSG.START, v: PROTOCOL_VERSION,
        seats: _roster.map(r => ({ peerId: r.peerId, name: r.name, char: r.char, bot: r.bot })),
        setup,
    };
    T.send(payload);
    _emit('start', { seats: payload.seats, setup, mySeat: 0 });
    return true;
}

/** Host only: push a snapshot to every client. */
export function pushSnapshot(snap) {
    if (!isHost()) return;
    T.send({ t: MSG.SNAP, v: PROTOCOL_VERSION, s: snap });
}

// ── Client side ─────────────────────────────────────────────────────────────

function _clientRecv(msg) {
    switch (msg.t) {
        case MSG.LOBBY:
            _roster = msg.seats || [];
            _seat = _roster.findIndex(r => r.peerId === T.selfId());
            if (_seat < 0) _seat = null;
            _emit('roster', roster());
            return;
        case MSG.START:
            _started = true;
            _roster = msg.seats || [];
            _seat = _roster.findIndex(r => r.peerId === T.selfId());
            _emit('start', { seats: msg.seats, setup: msg.setup, mySeat: _seat });
            return;
        case MSG.SNAP:
            _emit('snap', msg.s);
            return;
        case MSG.KICK:
            _emit('status', { kind: 'kicked', reason: msg.reason });
            leave();
            return;
        case MSG.BYE:
            _emit('end', { reason: 'host-left' });
            return;
    }
}

/** Client only: my player pressed something. */
export function sendIntent(name, args) {
    if (!isClient()) return false;
    return T.send({ t: MSG.INTENT, v: PROTOCOL_VERSION, n: name, a: args || [] });
}

export function sendPick(char)   { if (isClient()) T.send({ t: MSG.PICK,  v: PROTOCOL_VERSION, char }); }
export function sendReady(ready) { if (isClient()) T.send({ t: MSG.READY, v: PROTOCOL_VERSION, ready: !!ready }); }
