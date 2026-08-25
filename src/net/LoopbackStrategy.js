// ============================================================
// LOOPBACK — a room between tabs of the same browser
// ============================================================
// Presents the same three things NetTransport wants from a Trystero room —
// `makeAction`, `onPeerJoin`, `onPeerLeave` — over a `BroadcastChannel`, which
// carries messages between pages of one origin in one browser and touches no
// network at all.
//
// It exists for two reasons, and both are honest uses rather than test scaffolding
// smuggled into the shipped code:
//
//   1. IT IS HOW THE NETCODE IS TESTED. Every QA probe in this repo drives the
//      real game in a real browser. A networked probe that needed public relays
//      and successful NAT traversal to run would be testing somebody else's
//      infrastructure, and would go red on a train. Over loopback the protocol,
//      the session, the snapshot sync and the scene mirror are all exercised for
//      real — end to end, four pages, one room — and only the WebRTC hop is
//      substituted. That hop is the one part of this that is somebody else's
//      well-tested code.
//
//   2. IT IS USEFUL ON A DESKTOP. Two tabs side by side is the fastest way to
//      look at what a client sees while changing what the host does.
//
// What it does NOT prove: that two PHONES can find each other. Nothing run in
// one browser can prove that. See docs/MULTIPLAYER_PLAN.md.

const CHANNEL_PREFIX = 'hbd-loopback:';

// Stable per-page identity. `crypto.randomUUID` is not available on every
// browser this game runs on, so it is not depended on.
export const selfId = 'lb-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function joinRoom(config, roomId) {
    const chan = new BroadcastChannel(CHANNEL_PREFIX + roomId);
    const peers = new Set();
    const actions = new Map();      // namespace → onMessage handler
    const room = { onPeerJoin: null, onPeerLeave: null };

    let closed = false;

    const post = obj => { if (!closed) chan.postMessage(obj); };

    chan.onmessage = e => {
        const m = e.data;
        if (!m || m.from === selfId) return;
        // A message addressed to somebody else is not ours to read. This is the
        // loopback equivalent of a targeted send; unlike WebRTC there is no
        // separate connection, so the filter has to be here.
        if (m.to && m.to !== selfId) return;

        switch (m.k) {
            case 'hello':
                // Somebody arrived. Answer so they learn about us too — that
                // reply is what makes discovery symmetric without a directory.
                if (!peers.has(m.from)) { peers.add(m.from); room.onPeerJoin && room.onPeerJoin(m.from); }
                post({ k: 'here', from: selfId, to: m.from });
                return;
            case 'here':
                if (!peers.has(m.from)) { peers.add(m.from); room.onPeerJoin && room.onPeerJoin(m.from); }
                return;
            case 'bye':
                if (peers.delete(m.from)) room.onPeerLeave && room.onPeerLeave(m.from);
                return;
            case 'data': {
                const fn = actions.get(m.ns);
                if (fn) fn(m.d, m.from);
                return;
            }
        }
    };

    // A page that goes away without saying so would otherwise sit in every
    // other page's roster forever.
    const onUnload = () => post({ k: 'bye', from: selfId });
    globalThis.addEventListener?.('pagehide', onUnload);

    post({ k: 'hello', from: selfId });

    room.makeAction = ns => {
        const action = {
            onMessage: null,
            onReceiveProgress: null,
            send(data, opts) {
                post({ k: 'data', ns, from: selfId, to: opts && opts.target, d: data });
                return Promise.resolve();
            },
        };
        // NetTransport sets `action.onMessage` after makeAction returns, so the
        // handler is read at delivery time rather than captured here.
        actions.set(ns, (d, from) => action.onMessage && action.onMessage(d, { peerId: from }));
        return action;
    };

    room.getPeers = () => Object.fromEntries([...peers].map(id => [id, null]));
    room.ping = () => Promise.resolve(0);
    room.isPassive = () => false;
    room.leave = () => {
        if (closed) return Promise.resolve();
        closed = true;
        post({ k: 'bye', from: selfId });
        globalThis.removeEventListener?.('pagehide', onUnload);
        chan.close();
        return Promise.resolve();
    };

    return room;
}
