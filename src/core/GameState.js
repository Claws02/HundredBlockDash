// ============================================================
// GAME STATE — single source of truth for all mutable data
// ============================================================

export const state = {
    // Flow
    playStyle:           null,
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

    // Duel
    pendingDuelBet:        0,

    // Minigame
    mgActive:            false,
    mgType:              '',
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
            _warpNextRoll: false, _doubleNextRoll: false, _shielded: false, _mirrored: false,
            _overchargeNextRoll: false,
            // City Circuit tracking
            allies: [],          // up to MAX_ALLIES: { type, turnsRemaining, shieldCharges?, mesh }
            districtsVisited: { fin: 0, ba: 0, shop: 0, ind: 0 },
            districtHQsThisLoop: new Set(),
            fullCircuitsCompleted: 0,
            contractsClaimed: 0,
            alliesClaimed: 0,
            duelsWon: 0,
            shopsVisitedThisLap: 0,
            coinsEarnedThisRound: 0,
            consecutiveMgWins: 0,
            cabbieUsedThisRound: false,
        },
        {
            id: 1, name: 'Player 2', color: 0x3b8eff, charType: 'boxy', isBot: false,
            coins: 10, coinsEarned: 10, mgWins: 0,
            pos: 'r1',
            prevPos: 'r1',
            inv: [], mesh: null,
            _warpNextRoll: false, _doubleNextRoll: false, _shielded: false, _mirrored: false,
            _overchargeNextRoll: false,
            allies: [],
            districtsVisited: { fin: 0, ba: 0, shop: 0, ind: 0 },
            districtHQsThisLoop: new Set(),
            fullCircuitsCompleted: 0,
            contractsClaimed: 0,
            alliesClaimed: 0,
            duelsWon: 0,
            shopsVisitedThisLap: 0,
            coinsEarnedThisRound: 0,
            consecutiveMgWins: 0,
            cabbieUsedThisRound: false,
        },
    ],

    // Board — map of nodeId → { type, owner? }
    board: {},
};

export function resetPlayers() {
    state.players.forEach(p => {
        p.coins = 10; p.coinsEarned = 10; p.mgWins = 0;
        p.pos = 'r1'; p.prevPos = 'r1';
        p.inv = []; p.mesh = null;
        p._warpNextRoll = false; p._doubleNextRoll = false;
        p._shielded = false; p._mirrored = false;
        p._overchargeNextRoll = false;
        p.allies = [];
        p.districtsVisited = { fin: 0, ba: 0, shop: 0, ind: 0 };
        p.districtHQsThisLoop = new Set();
        p.fullCircuitsCompleted = 0;
        p.contractsClaimed = 0;
        p.alliesClaimed = 0;
        p.duelsWon = 0;
        p.shopsVisitedThisLap = 0;
        p.coinsEarnedThisRound = 0;
        p.consecutiveMgWins = 0;
        p.cabbieUsedThisRound = false;
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
    state.allyOnMap          = null;
    state.allySpawnCountdown = 0;
    state.activeContracts    = [];
    state.contractPool       = [];
    state.investorUsedThisRound = [false, false];
    state.mgContext          = null;
    state.pendingDuelBet     = 0;
    state.pendingShopDistrict = null;
    state.pendingShopDiscount = 1.0;
}
