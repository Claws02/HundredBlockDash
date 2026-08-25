// ============================================================
// NET PROTOCOL — what goes on the wire, and what a snapshot is
// ============================================================
// Two directions and one shape.
//
//   client → host   INTENT   "I pressed ROLL"
//   host   → client SNAP     "here is the game"
//
// Plus the lobby handshake either side of a match. Everything carries `v`, and
// a peer on a different `v` is refused at the door rather than allowed to
// desync in some subtler way ten minutes later.
//
// WHY A SNAPSHOT AND NOT A LIST OF EVENTS. An event log has to be replayed
// perfectly by every client or the divergence compounds, and this game's state
// is touched from about forty places across the turn flow — the first missed
// emit would be a silent desync. A snapshot cannot drift: it is the host's
// state, and applying it makes the client's state that. The cost is bandwidth,
// and at ~4 KB a few times a second between four phones on one WiFi that is not
// a cost worth optimising before it is measured.

export const PROTOCOL_VERSION = 1;

export const MSG = {
    HELLO:  'hello',    // client → host: I am here, this is my name
    LOBBY:  'lobby',    // host → all:   the roster as it stands
    PICK:   'pick',     // client → host: my character
    READY:  'ready',    // client → host: I am ready / not ready
    START:  'start',    // host → all:   the match is beginning, with this setup
    SNAP:   'snap',     // host → all:   the game
    SCENE:  'scene',    // host → all or one: a full-screen beat to replay
    INTENT: 'intent',   // client → host: a named command from Commands.js
    KICK:   'kick',     // host → one:   you cannot join (version, room full)
    BYE:    'bye',      // either:       leaving cleanly
};

export const KICK_REASON = {
    VERSION: 'version',
    FULL:    'full',
    STARTED: 'started',
};

// ── Snapshot ────────────────────────────────────────────────────────────────
//
// Everything a client needs to DRAW the game and decide what its own player is
// allowed to press. Explicitly not the whole `state` object: that carries three
// kinds of thing that must never cross the wire —
//
//   • live references — `mesh` is a THREE.Object3D, `contractPool` holds the
//     objects `activeContracts` points at, timers are numbers that mean
//     something only in the process that set them;
//   • `Set`s, which JSON silently turns into `{}`;
//   • the host's private turn-flow bookkeeping (pendingReturnState and the
//     rest), which describes a continuation that lives in the host's closures
//     and would be meaningless — or actively misleading — on a client.
//
// So the snapshot is a hand-written list. That is on purpose: a field only
// reaches a client because somebody decided it should.

export function snapshot(state) {
    return {
        v: PROTOCOL_VERSION,
        // Flow
        gs:    state.gameState,
        // The camera MODE, not its position. A set piece parks the camera on
        // 'CINEMATIC' — a mode the render loop deliberately does not drive —
        // and hands it back through a continuation that belongs to the host. A
        // client replaying that set piece has no such continuation, so its
        // camera stayed parked and the board froze while the game carried on.
        // Sending the mode makes the host's camera authoritative and the
        // client self-corrects on the very next snapshot.
        cam:   state.cameraState,
        ap:    state.activePlayer,
        turns: state.totalTurns,
        round: state.currentRound,
        started: state.gameStarted,
        // Setup (a client that joined late still needs to build the same board)
        map:   state.selectedMap,
        hbdLen: state.hbdLength,
        rounds: state.cityRounds,
        // Board
        gate:  state.gateOpen,
        board: _boardOf(state),
        buddy: state.allyOnMap ? { ...state.allyOnMap } : null,
        // Bounties: the card ids and per-seat progress, not the whole pool.
        bounties: (state.activeContracts || []).map(c => ({ id: c.id, prog: (c._prog || []).slice() })),
        // Players
        p: state.players.map(_playerOf),
        // The end-of-match chart is drawn from this, so it has to arrive before
        // the win screen does.
        hist: (state.history || []).slice(-120),
    };
}

function _playerOf(p) {
    return {
        id: p.id, name: p.name, char: p.charType, bot: !!p.isBot,
        coins: p.coins, earned: p.coinsEarned, mgWins: p.mgWins,
        pos: p.pos, prev: p.prevPos,
        inv: p.inv.slice(),
        // The mesh belongs to the client's own renderer and must not be sent;
        // the client re-attaches its own when a buddy appears.
        allies: p.allies.map(a => ({ type: a.type, turnsRemaining: a.turnsRemaining, shieldCharges: a.shieldCharges })),
        shield: !!p._shielded,
        districts: { ...p.districtsVisited },
        laps: p.fullCircuitsCompleted,
        claimed: p.contractsClaimed,
        buddies: p.alliesClaimed,
        duels: p.duelsWon,
        bought: p.itemsBought,
        streak: p.consecutiveMgWins,
        cab: !!p.cabbieUsedThisRound,
    };
}

// Only the squares whose type or owner can change during a match — traps,
// bought tiles, the gate. Sending all 100 every snapshot is affordable but
// pointless; sending the ones that move is both.
function _boardOf(state) {
    const out = {};
    for (const id in state.board) {
        const b = state.board[id];
        if (!b) continue;
        out[id] = b.owner === undefined ? b.type : [b.type, b.owner];
    }
    return out;
}

// A cheap change detector. The host polls rather than emitting from forty call
// sites (see NetSync), so it needs to know whether anything actually moved
// without diffing two object graphs.
export function signature(snap) {
    return JSON.stringify([
        snap.gs, snap.cam, snap.ap, snap.turns, snap.round, snap.gate,
        snap.p.map(p => [p.pos, p.coins, p.inv.length, p.allies.length, p.shield, p.mgWins, p.cab]),
        snap.buddy && [snap.buddy.nodeId, snap.buddy.roundsLeft],
        snap.bounties.map(b => [b.id, b.prog.join('/')]),
    ]);
}
