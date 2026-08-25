// ============================================================
// NET TRANSPORT — getting bytes between phones, and nothing else
// ============================================================
// The whole point of this file is that the rest of the game never imports
// Trystero. Everything above it sees five things: connect, send, onMessage,
// onPeerJoin, onPeerLeave. Swapping the strategy — or replacing WebRTC with a
// WebSocket relay if public signaling turns out to be unreliable in the field —
// is a change confined to this file.
//
// WHY PEER-TO-PEER AND NOT A SERVER (docs/MULTIPLAYER_PLAN.md §2):
//   Free permanently, with no account to hold and no deploy step bolted onto a
//   static site, and for four phones on one home WiFi it is also the fastest
//   option — the packets never leave the building. The cost is that roughly one
//   network in ten (symmetric NAT, strict corporate WiFi) cannot hole-punch
//   without a TURN relay, and TURN is not free. That is the trade, taken
//   deliberately, and this interface is the escape hatch if it proves wrong.
//
// SIGNALING is only used to introduce two phones to each other. Once the WebRTC
// connection is up, no game data touches a relay: it goes phone to phone,
// encrypted. So a flaky relay costs you a JOIN, never a match in progress.

const APP_ID = 'hundred-block-dash';

// Strategy bundles, loaded on demand — the online path should cost an offline
// player nothing. Nostr first: WebSocket relays are steadier in practice than
// BitTorrent tracker sockets, which are what the torrent strategy needs.
const STRATEGIES = {
    nostr:   () => import('../../vendor/trystero-nostr.min.js'),
    torrent: () => import('../../vendor/trystero-torrent.min.js'),
    // Same browser only, no network. Never tried automatically — it is opted
    // into by `?net=local` or by the QA harness. See LoopbackStrategy.js.
    local:   () => import('./LoopbackStrategy.js'),
};
export const STRATEGY_ORDER = ['nostr', 'torrent'];

// `?net=local` forces the loopback transport, which is how two tabs on one
// machine play each other and how qa/net.js drives four of them.
export function forcedStrategy() {
    try {
        const v = new URLSearchParams(location.search).get('net');
        return v && STRATEGIES[v] ? v : null;
    } catch (e) { return null; }
}

// Room codes people read out loud across a table. No 0/O or 1/I/L, because
// "was that a one or an ell" is the single most common way a four-letter code
// gets typed wrong.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export function makeRoomCode() {
    const buf = new Uint32Array(CODE_LENGTH);
    (globalThis.crypto || {}).getRandomValues?.(buf);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
        const n = buf[i] || Math.floor(Math.random() * 0xffffffff);
        out += CODE_ALPHABET[n % CODE_ALPHABET.length];
    }
    return out;
}

export function normaliseCode(raw) {
    return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isValidCode(raw) {
    const c = normaliseCode(raw);
    return c.length === CODE_LENGTH && [...c].every(ch => CODE_ALPHABET.includes(ch));
}

// ── One connection ───────────────────────────────────────────────────────────

let _room      = null;
let _action    = null;   // the single game-message channel
let _selfId    = null;
let _code      = null;
let _strategy  = null;
const _peers   = new Set();

const _handlers = { message: [], join: [], leave: [], error: [] };

function _emit(kind, ...args) {
    _handlers[kind].slice().forEach(fn => {
        try { fn(...args); } catch (e) { console.error(`[net] ${kind} handler failed:`, e); }
    });
}

export function onMessage(fn)  { _handlers.message.push(fn); return () => _off('message', fn); }
export function onPeerJoin(fn) { _handlers.join.push(fn);    return () => _off('join', fn); }
export function onPeerLeave(fn){ _handlers.leave.push(fn);   return () => _off('leave', fn); }
export function onError(fn)    { _handlers.error.push(fn);   return () => _off('error', fn); }

function _off(kind, fn) {
    const i = _handlers[kind].indexOf(fn);
    if (i >= 0) _handlers[kind].splice(i, 1);
}

export function selfId()    { return _selfId; }
export function roomCode()  { return _code; }
export function strategy()  { return _strategy; }
export function peerIds()   { return [..._peers]; }
export function isOpen()    { return !!_room; }

/**
 * Join (or create — they are the same operation) the room named by `code`.
 *
 * Tries each strategy in turn and keeps the first that produces a room. A
 * strategy failing here means its signaling relays are unreachable, which says
 * nothing about whether the next one's are.
 *
 * Resolves once the room object exists — NOT once anybody else has joined.
 * There is no such thing as "the room already has three people in it" to wait
 * for: peers arrive through onPeerJoin whenever they arrive.
 */
export async function connect(code, opts = {}) {
    if (_room) await disconnect();
    const roomId = normaliseCode(code);
    if (!isValidCode(roomId)) throw new Error(`bad room code: ${code}`);

    const forced = opts.strategy || forcedStrategy();
    const order = forced ? [forced] : STRATEGY_ORDER;
    let lastErr = null;

    for (const name of order) {
        try {
            const mod = await STRATEGIES[name]();
            const room = mod.joinRoom(
                {
                    appId: APP_ID,
                    // The code doubles as the room's password, so two groups
                    // that pick the same four letters at the same moment still
                    // cannot read each other's traffic.
                    password: `hbd-${roomId}`,
                    ...(opts.rtcConfig ? { rtcConfig: opts.rtcConfig } : {}),
                },
                `${APP_ID}-${roomId}`,
                { onJoinError: e => _emit('error', e) },
            );

            _room     = room;
            _selfId   = mod.selfId;
            _code     = roomId;
            _strategy = name;
            _peers.clear();

            // ONE action for everything. Trystero namespaces are capped at a
            // dozen bytes and each one costs a handshake; the protocol's own
            // `t` field is a cheaper discriminator than a channel per message
            // type, and it keeps ordering intact across message kinds.
            const [send, onMsg] = _makeAction(room, 'hbd');
            _action = send;
            onMsg((data, peerId) => _emit('message', data, peerId));

            room.onPeerJoin = id => { _peers.add(id); _emit('join', id); };
            room.onPeerLeave = id => { _peers.delete(id); _emit('leave', id); };

            return { selfId: _selfId, code: roomId, strategy: name };
        } catch (e) {
            lastErr = e;
            console.warn(`[net] strategy "${name}" failed:`, e && e.message);
        }
    }
    throw lastErr || new Error('no signaling strategy could be reached');
}

// Trystero 0.25 returns an action OBJECT ({send, onMessage}); older builds
// returned a [send, onMessage, onProgress] tuple. Both shapes are handled so a
// re-vendored bundle from either era works without a hunt through this file.
function _makeAction(room, ns) {
    const a = room.makeAction(ns);
    if (Array.isArray(a)) {
        const [send, onMsg] = a;
        return [send, onMsg];
    }
    return [
        (data, target) => a.send(data, target ? { target } : undefined),
        fn => { a.onMessage = (data, ctx) => fn(data, ctx && ctx.peerId); },
    ];
}

/**
 * Send one message. `target` omitted broadcasts to every peer.
 *
 * Deliberately fire-and-forget: a rejected send is a peer that has gone, which
 * onPeerLeave is already about to tell us. Awaiting every snapshot at 20 Hz
 * would build a queue of promises nobody reads.
 */
export function send(msg, target) {
    if (!_action) return false;
    try { _action(msg, target); return true; }
    catch (e) { console.warn('[net] send failed:', e && e.message); return false; }
}

export async function disconnect() {
    const room = _room;
    _room = null; _action = null; _peers.clear();
    _code = null; _strategy = null;
    if (room) { try { await room.leave(); } catch (e) { /* already gone */ } }
}
