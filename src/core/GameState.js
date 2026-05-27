// ============================================================
// GAME STATE — the single source of truth for all mutable data
// No DOM, no THREE, no CANNON references live here.
// ============================================================

export const state = {
    // Flow
    playStyle:           null,    // '1p' | 'tabletop' | 'pass'
    gameState:           'INIT',
    cameraState:         'INIT',
    activePlayer:        0,
    totalTurns:          0,
    gameStarted:         false,

    // Roll flags
    rollAgainPending:    false,
    rollAgainSamePlayer: false,
    currentRollMode:     'normal', // 'normal' | 'forced_5' | 'double' | 'cursed_forced'
    cursedTarget:        [false, false],

    // Gate
    gateOpen:    false,
    gateRolling: false,

    // Character selection (pre-game)
    charSelectStep:    1,
    p1CharSelection:   'slime',
    p2CharSelection:   'boxy',

    // Modal / shop flow helpers
    pendingBuyId:          null,
    pendingBuyCost:        null,
    pendingShopAfterDrop:  false,
    pendingReturnState:    null,
    msgModalResolving:     false,

    // Minigame
    mgActive:            false,
    mgType:              '',
    mgReady:             [false, false],
    lastMinigameWinner:  -1,
    lastMinigameTied:    false,
    minigameTimeout:     null,

    // Players — mesh reference populated by Renderer.init()
    players: [
        {
            id: 0, name: 'Player 1', color: 0xff3b3b, charType: 'slime', isBot: false,
            coins: 10, coinsEarned: 10, mgWins: 0, pos: 0,
            inv: [], mesh: null,
            _warpNextRoll: false, _doubleNextRoll: false, _shielded: false, _mirrored: false,
        },
        {
            id: 1, name: 'Player 2', color: 0x3b8eff, charType: 'boxy', isBot: false,
            coins: 10, coinsEarned: 10, mgWins: 0, pos: 0,
            inv: [], mesh: null,
            _warpNextRoll: false, _doubleNextRoll: false, _shielded: false, _mirrored: false,
        },
    ],

    // Board — array of { type: string, owner?: number }
    board: [],
};

export function resetPlayers() {
    state.players.forEach(p => {
        p.coins = 10; p.coinsEarned = 10; p.mgWins = 0; p.pos = 0;
        p.inv = []; p.mesh = null;
        p._warpNextRoll = false; p._doubleNextRoll = false;
        p._shielded = false; p._mirrored = false;
    });
    state.gateOpen        = false;
    state.gateRolling     = false;
    state.cursedTarget    = [false, false];
    state.totalTurns      = 0;
    state.rollAgainPending = false;
    state.rollAgainSamePlayer = false;
    state.lastMinigameWinner  = -1;
    state.lastMinigameTied    = false;
}
