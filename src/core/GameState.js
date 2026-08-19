// ============================================================
// GAME STATE — single source of truth for all mutable data
// ============================================================

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

    // Roll flags
    rollAgainPending:    false,
    rollAgainSamePlayer: false,
    currentRollMode:     'normal',
    cursedTarget:        [false, false],

    // Gate
    gateOpen:    false,
    gateRolling: false,

    // Character selection
    charSelectStep:  1,
    p1CharSelection: 'slime',
    p2CharSelection: 'boxy',

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

    // Minigame
    mgActive:            false,
    mgType:              '',
    // Draw bag for minigame selection. A minigame cannot come up twice in a
    // match until every other one has been played — picking uniformly at random
    // meant an 18-game roster still repeated itself inside four minigames more
    // often than not.
    mgBag:               [],
    mgLastType:          '',
    mgReady:             [false, false],
    lastMinigameWinner:  -1,
    lastMinigameTied:    false,
    minigameTimeout:     null,
    mgContext:           null, // 'duel' | 'ally_claim' | 'ally_steal' | null

    // Ally on map
    allyOnMap:           null,  // { nodeId, allyType } | null
    allySpawnCountdown:  0,     // turns until next ally spawns (0 = spawn now)

    // City contracts
    activeContracts:     [],    // up to CONTRACT_COUNT active contracts
    contractPool:        [],    // remaining shuffled contracts
    investorUsedThisRound: [false, false], // per player, resets each round

    // Players
    players: [
        {
            id: 0, name: 'Player 1', color: 0xff3b3b, charType: 'slime', isBot: false,
            coins: 10, coinsEarned: 10, mgWins: 0,
            pos: 'r1',           // string node ID
            prevPos: 'r1',       // for camera direction
            inv: [], mesh: null,
            _shielded: false,
            // City Circuit tracking
            allies: [],          // up to MAX_ALLIES: { type, turnsRemaining, shieldCharges?, mesh }
            districtsVisited: { fin: 0, ba: 0, shop: 0, ind: 0 },
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
        },
        {
            id: 1, name: 'Player 2', color: 0x3b8eff, charType: 'boxy', isBot: false,
            coins: 10, coinsEarned: 10, mgWins: 0,
            pos: 'r1',
            prevPos: 'r1',
            inv: [], mesh: null,
            _shielded: false,
            allies: [],
            districtsVisited: { fin: 0, ba: 0, shop: 0, ind: 0 },
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
        },
    ],

    // Turn-by-turn record for the end-of-match graph. One entry per completed
    // turn: { turn, prog: [p1, p2], coins: [p1, p2] }. `prog` is normalised
    // 0..1 board progress so the same chart works for both maps.
    history: [],

    // Board — map of nodeId → { type, owner? }
    board: {},
};

export function resetPlayers() {
    const startPos = state.selectedMap === 'hundred_block_dash' ? 0 : 'r1';
    state.players.forEach(p => {
        p.coins = 10; p.coinsEarned = 10; p.mgWins = 0;
        p.pos = startPos; p.prevPos = startPos;
        p.inv = []; p.mesh = null;
        p._shielded = false;
        p.allies = [];
        p.districtsVisited = { fin: 0, ba: 0, shop: 0, ind: 0 };
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
    state.cursedTarget       = [false, false];
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
    state.activeContracts    = [];
    state.contractPool       = [];
    state.investorUsedThisRound = [false, false];
    state.mgContext          = null;
    state.pendingDuelBet     = 0;
    state.pendingShopDistrict = null;
    state.pendingShopDiscount = 1.0;
    state.pendingForcedMove   = 0;
    state.pendingResultOverride = null;
    state.history            = [];
}
