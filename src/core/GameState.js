// ============================================================
// GAME STATE — single source of truth for all mutable data
// ============================================================

import { MAPS, DEFAULT_MAP } from '../config/maps/index.js';
import { PLAYER_SLOTS, DEFAULT_PLAYERS, MIN_PLAYERS, MAX_PLAYERS } from '../config/GameConfig.js';

// The active map module, read DIRECTLY rather than through ActiveMap.js —
// which imports this file, and a cycle that happens to resolve at runtime is
// still a cycle. Same reasoning resetPlayers() already used for the start
// square; it is now a helper because a second thing needs it.
function _map() {
    // `state` is still in its temporal dead zone while the object literal below
    // is being evaluated, and makePlayer() runs there to build the opening two
    // seats. `typeof` does not help — it throws on a TDZ binding too — so the
    // read is guarded and falls back to the default map, which resetPlayers()
    // then overwrites with the real one before any match starts.
    let id = null;
    try { id = state.selectedMap; } catch (_) { /* module init */ }
    return MAPS[id] || MAPS[DEFAULT_MAP];
}

// A fresh visit tally, keyed by whatever regions THIS board has. It used to be
// the literal `{ fin: 0, ba: 0, shop: 0, ind: 0 }` in two places, so a board
// with different regions counted visits into keys nothing ever read and the
// dominance/bounty passes saw four zeroes forever.
function _freshVisits() {
    return Object.fromEntries((_map().regionKeys || []).map(k => [k, 0]));
}

// ============================================================
// PLAYER FACTORY
// ============================================================
// One seat, built from its slot. This replaced two hand-written literals that
// had drifted apart once already; every field a player carries is now declared
// in exactly one place, so a third and fourth seat cost nothing to add and
// cannot be built subtly differently from the first two.
export function makePlayer(id) {
    const slot = PLAYER_SLOTS[id] || PLAYER_SLOTS[0];
    return {
        id, name: slot.name, color: slot.color, charType: slot.charType, isBot: false,
        coins: 10, coinsEarned: 10, mgWins: 0,
        pos: 'r1',           // string node ID
        prevPos: 'r1',       // for camera direction
        inv: [], mesh: null,
        _shielded: false,
        // City Circuit tracking
        allies: [],          // up to MAX_ALLIES: { type, turnsRemaining, shieldCharges?, mesh }
        districtsVisited: _freshVisits(),
        // ---- Star Territory ----
        // Stars are the SCORE on that board and can never be taken. Shards can:
        // four of them redeem into a Star for free, and a duel may be staked
        // with one instead of coins. Both are carried by every seat on every
        // board so nothing has to branch before reading them — they simply stay
        // at zero where the map has no Offices.
        stars:  0,
        shards: 0,
        starsBought: 0,      // travel-lane Stars, for the win card
        shardStars:  0,      // Stars that came from redeeming four Shards
        districtHQsThisLoop: new Set(),
        fullCircuitsCompleted: 0,
        contractsClaimed: 0,
        alliesClaimed: 0,
        duelsWon: 0,
        itemsBought: 0,
        shopsVisitedThisLap: 0,
        coinsEarnedThisRound: 0,
        consecutiveMgWins: 0,
        cabbieUsedThisRound: false,
        _lastDistrictEntered: null,
    };
}

// How many seats are in play. Everything that used to say `% 2` asks this.
export function playerCount() { return state.players.length; }

// Resize the table to `n` seats, keeping any choices already made in the seats
// that survive. Called by the mode/lobby screens before a match is set up —
// never mid-match, which is why it rebuilds rather than patching.
export function setPlayerCount(n) {
    const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n | 0));
    const kept  = state.players.slice(0, count);
    while (kept.length < count) kept.push(makePlayer(kept.length));
    state.players = kept;
    state.charSelections    = state.charSelections.slice(0, count);
    while (state.charSelections.length < count) {
        state.charSelections.push(PLAYER_SLOTS[state.charSelections.length].charType);
    }
    state.cursedTarget          = state.players.map(() => false);
    state.investorUsedThisRound = state.players.map(() => false);
    state.mgReady               = state.players.map(() => false);
    return count;
}

export const state = {
    // Flow
    playStyle:           null,
    botDifficulty:       'medium', // 'easy' | 'medium' | 'hard' — used in 1P mode
    selectedMap:         'city_circuit',
    hbdLength:           100,  // 50 | 75 | 100 — chosen on the HBD map-select screen
    cityRounds:          12,   // 6 | 12 | 20 — chosen on the City Circuit map-select screen
    hbd:                 null, // runtime layout (buildHbdConfig): { length, finish, gatePos, shopSpaces, realmCount }
    gameState:           'INIT',
    cameraState:         'INIT',
    activePlayer:        0,
    totalTurns:          0,
    currentRound:        0,
    gameStarted:         false,
    // Online play. `localSeat` is which seat THIS device is playing (null for
    // every local mode, where the device is passed around). `netReplica` is the
    // one flag that keeps a client out of the turn engine — see NetGame.js.
    localSeat:           null,
    netReplica:          false,

    // Roll flags
    rollAgainPending:    false,
    rollAgainSamePlayer: false,
    currentRollMode:     'normal',
    cursedTarget:        [],   // per seat; sized by setPlayerCount()

    // Gate
    gateOpen:    false,
    gateRolling: false,

    // Character selection
    charSelectStep:  1,   // 1-based seat currently choosing
    // One entry per seat. Was p1CharSelection / p2CharSelection — two named
    // fields that could not grow a third.
    charSelections:  PLAYER_SLOTS.slice(0, DEFAULT_PLAYERS).map(s => s.charType),

    // Modal / shop flow helpers
    pendingBuyId:          null,
    pendingBuyCost:        null,
    pendingShopAfterDrop:  false,
    pendingReturnState:    null,
    msgModalResolving:     false,
    pendingShopDistrict:   null,
    pendingShopDiscount:   1.0,

    // A forced move (Launch / Pulled Back / Shortcut / Anchor) that must wait for
    // the player to acknowledge the notification before it happens. Previously
    // these spaces resolved silently — you were moved 10 spaces with no message
    // at all, and only saw the result of wherever you ended up.
    pendingForcedMove:     0,
    // Overrides the title/icon of the next result card (used so an item pickup
    // reads as the item, not as the space that produced it).
    pendingResultOverride: null,
    // An item was granted with a full bag, so the discard picker owns the next
    // beat instead of the usual result card. Set by tryGrantItem, consumed by
    // resolveSpace — opening the picker directly would just have it painted
    // over by the result card, which lands a beat later.
    pendingDropPick:       null,
    // Where a mystery crate should land, set when the item is granted and
    // consumed by the reveal. The item is already in the bag by then.
    pendingUnbox:          null,

    // Duel
    pendingDuelBet:        0,
    // Which player the active duel is against. Fixed when the duel space
    // resolves so the face-off, the bet screen and the payout can never
    // disagree about who the two duellists are.
    pendingDuelTarget:     null,

    // Minigame
    mgActive:            false,
    mgType:              '',
    // Draw bag for minigame selection. A minigame cannot come up twice in a
    // match until every other one has been played — picking uniformly at random
    // meant an 18-game roster still repeated itself inside four minigames more
    // often than not.
    mgBag:               [],
    // 'phone' | 'tablet' — what the table is sharing at three or four seats.
    // Decides whether the games that need a private playfield each are in the
    // draw bag: quarters of a phone are 206x400 and under the floor, quarters
    // of a tablet are 410x544 and over it. Measured on the viewport at setup;
    // it means nothing at two seats or online, where nobody shares a screen.
    mgDevice:            'phone',
    mgLastType:          '',
    mgReady:             [],   // per seat; sized by setPlayerCount()
    lastMinigameWinner:  -1,
    lastMinigameTied:    false,
    minigameTimeout:     null,
    mgContext:           null, // 'duel' | 'ally_claim' | 'ally_steal' | null

    // Buddy on map (called "ally" in code; every player-facing string says Buddy)
    allyOnMap:           null,  // { nodeId, allyType, roundsLeft } | null
    allySpawnCountdown:  0,     // turns until next buddy spawns (0 = spawn now)
    // Set when a buddy lands on the board at the close of a round; consumed by
    // maybeTriggerMinigame(), which waits for the player to press through the
    // round report before the minigame takes the screen.
    pendingAllyReveal:   null,
    // Set when an unclaimed board buddy runs out of rounds, so the same report
    // can say they left rather than having them silently disappear.
    pendingBuddyDeparture: null,

    // City contracts
    activeContracts:     [],    // up to CONTRACT_COUNT active contracts
    contractPool:        [],    // remaining shuffled contracts
    investorUsedThisRound: [], // per seat, resets each round

    // Players — 2, 3 or 4 seats. Built by makePlayer(), resized by
    // setPlayerCount(). Two seats is the default so every existing mode
    // (1P vs bot, tabletop, pass-and-play) starts exactly as it always did.
    players: Array.from({ length: DEFAULT_PLAYERS }, (_, i) => makePlayer(i)),

    // Turn-by-turn record for the end-of-match graph. One entry per completed
    // turn: { turn, prog: [p1, p2], coins: [p1, p2] }. `prog` is normalised
    // 0..1 board progress so the same chart works for both maps.
    history: [],

    // ---- Star Territory ----
    // Which Office is holding the live Star. ONE Star is live at a time and its
    // location is never hidden: the HUD, the map view, the round report and the
    // briefing all read this. null means the board has no Star system running.
    starNode:        null,
    // Set while the dispatch set piece is in flight, so the HUD can say where
    // the Star is GOING before the comet lands. Cleared when it arrives.
    starInFlight:    null,

    // Board — map of nodeId → { type, owner? }
    board: {},
};

export function resetPlayers() {
    // The start square belongs to the map. Reads maps/index.js directly rather
    // than ActiveMap, which imports THIS file — a cycle that would resolve at
    // runtime but reads as an accident waiting to happen.
    const startPos = (MAPS[state.selectedMap] || MAPS[DEFAULT_MAP]).start;
    state.players.forEach(p => {
        p.coins = 10; p.coinsEarned = 10; p.mgWins = 0;
        p.pos = startPos; p.prevPos = startPos;
        p.inv = []; p.mesh = null;
        p._shielded = false;
        p.allies = [];
        p.districtsVisited = _freshVisits();
        p.stars = 0; p.shards = 0; p.starsBought = 0; p.shardStars = 0;
        p.districtHQsThisLoop = new Set();
        p.fullCircuitsCompleted = 0;
        p.contractsClaimed = 0;
        p.alliesClaimed = 0;
        p.duelsWon = 0;
        p.itemsBought = 0;
        p.shopsVisitedThisLap = 0;
        p.coinsEarnedThisRound = 0;
        p.consecutiveMgWins = 0;
        p.cabbieUsedThisRound = false;
        p._lastDistrictEntered = null;
    });
    state.gateOpen           = false;
    state.gateRolling        = false;
    state.cursedTarget       = state.players.map(() => false);
    state.totalTurns         = 0;
    state.currentRound       = 0;
    state.rollAgainPending   = false;
    state.rollAgainSamePlayer = false;
    state.lastMinigameWinner = -1;
    state.lastMinigameTied   = false;
    state.mgBag              = [];   // a fresh match deals a fresh bag
    state.mgLastType         = '';
    state.pendingDropPick    = null;
    state.pendingUnbox       = null;
    state.allyOnMap          = null;
    state.allySpawnCountdown = 0;
    state.pendingAllyReveal  = null;
    state.pendingBuddyDeparture = null;
    state.activeContracts    = [];
    state.contractPool       = [];
    state.investorUsedThisRound = state.players.map(() => false);
    state.mgContext          = null;
    state.pendingDuelBet     = 0;
    state.pendingDuelTarget  = null;
    state.pendingShopDistrict = null;
    state.pendingShopDiscount = 1.0;
    state.pendingForcedMove   = 0;
    state.pendingResultOverride = null;
    state.starNode           = null;
    state.starInFlight       = null;
    state.history            = [];
}
