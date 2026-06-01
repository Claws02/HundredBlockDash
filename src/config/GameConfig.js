// ============================================================
// TUNABLE CONSTANTS
// ============================================================
export const GATE_THRESHOLD      = 15;
export const GATE_NUM_DICE       = 5;
export const MAX_INV             = 3;
export const MINIGAME_REWARD     = 10;
export const MINIGAME_EVERY_N_TURNS = 4;

// City Circuit scoring
export const TOTAL_ROUNDS            = 20;
export const DISTRICT_HQ_FIRST_BONUS  = 15;
export const DISTRICT_HQ_REVISIT_BONUS = 5;
export const DISTRICT_DOMINANCE_BONUS  = 15;
export const FULL_CIRCUIT_BONUSES     = [25, 15, 8]; // diminishing per circuit
export const CONTRACT_COUNT           = 3;
export const MAX_ALLIES               = 2;
export const ALLY_TURNS               = 3; // turns before an ally expires
export const DUEL_BET_OPTIONS         = [1, 3, 5, 8, 10];
export const ALLY_SPAWN_DELAY_TURNS   = 2; // turns after claim before next ally spawns

// ============================================================
// ITEMS
// ============================================================
export const ITEMS = {
    warp_drive:  { icon: '🚀', name: 'Warp Drive',  desc: 'Forces your next roll to be a 5',            price: 12 },
    double_die:  { icon: '💥', name: 'Double Die',  desc: 'Roll 2 dice, move the sum',                  price: 15 },
    cursed_die:  { icon: '💀', name: 'Cursed Die',  desc: "Force opponent's next roll to 1 or 2",       price: 18 },
    tollbooth:   { icon: '🚧', name: 'Tollbooth',   desc: 'Place on current space — enemies pay 5c',    price: 10 },
    shield:      { icon: '🛡️', name: 'Shield',       desc: 'Block the next negative space effect',       price: 8  },
    rocket:      { icon: '🛸', name: 'Rocket',       desc: 'Instantly move forward 8 spaces',            price: 20 },
    anchor:      { icon: '⚓', name: 'Anchor',       desc: 'Place trap — sends opponent back 5 spaces',  price: 14 },
    swap:        { icon: '🔄', name: 'Swap',         desc: 'Swap board positions with your opponent',    price: 25 },
    steal:       { icon: '🐷', name: 'Steal',        desc: 'Take 10 coins from your opponent',           price: 22 },
    mirror:      { icon: '🪞', name: 'Mirror',       desc: 'Reflect the next item used against you',     price: 16 },
    custom_dice: { icon: '🎯', name: 'Custom Dice',  desc: 'Pick any number 1–6 as your next roll',      price: 20 },
    overcharge:  { icon: '⚡', name: 'Overcharge',   desc: 'Your next roll result is doubled (max 12)',  price: 18 },
};

// District-specific shop inventories (null = full shop at regular price)
export const DISTRICT_SHOPS = {
    ring: null,
    // Wall Street Exchange — economic/defensive items, expensive
    fin:  ['steal', 'mirror', 'swap', 'custom_dice'],
    // Underground Market — trap/aggressive items, discounted
    ba:   ['tollbooth', 'anchor', 'cursed_die', 'shield'],
    // Grand Mall — full shop at 50% off (handled via isGrandMall flag in HQ)
    shop: null,
    // Power Plant — best movement items + exclusive Overcharge
    ind:  ['rocket', 'warp_drive', 'double_die', 'overcharge'],
};

export const BA_DISCOUNT = 0.75;   // 25% off in Back Alley
export const GRAND_MALL_DISCOUNT = 0.5; // 50% off at Grand Mall HQ

// ============================================================
// ALLIES
// ============================================================
export const ALLIES = {
    cabbie:    {
        icon: '🚕', name: 'The Cabbie',
        powerType: 'active',
        desc: 'Once per round, teleport to any junction on the map.',
        turns: ALLY_TURNS,
    },
    vendor:    {
        icon: '🌮', name: 'Street Vendor',
        powerType: 'coin_bonus',
        desc: '+2 extra coins whenever you land on a coin space.',
        turns: ALLY_TURNS,
    },
    banker:    {
        icon: '💼', name: 'The Banker',
        powerType: 'interest',
        desc: 'Earn 1 bonus coin per 10 coins you hold at each round end.',
        turns: ALLY_TURNS,
    },
    bodyguard: {
        icon: '🦺', name: 'The Bodyguard',
        powerType: 'shield_all',
        desc: 'Automatically absorbs your next 3 negative space effects.',
        turns: ALLY_TURNS,
        shieldCharges: 3,
    },
    investor:  {
        icon: '📈', name: 'The Investor',
        powerType: 'contract_x2',
        desc: 'The first City Contract you claim each round pays double.',
        turns: ALLY_TURNS,
    },
};

// All character types (original 4 + 5 ally characters)
export const ALL_CHAR_TYPES = ['slime', 'ghost', 'boxy', 'bunny', 'cabbie', 'vendor', 'banker', 'bodyguard', 'investor'];

export const CHAR_ICONS = {
    slime:     '💧', ghost:     '👻', boxy:      '🧊', bunny:     '🐰',
    cabbie:    '🚕', vendor:    '🌮', banker:    '💼', bodyguard: '🦺', investor:  '📈',
};

// ============================================================
// SPACE METADATA
// ============================================================
export const SPACE_META = {
    start:       { ic: '🏁', n: 'START',         e: 0x1e293b, c: 0xfbbf24, geo: null         },
    coin:        { ic: '🪙', n: 'COIN',           e: 0x1c3a1c, c: 0xfbbf24, geo: 'torus'      },
    coin_big:    { ic: '💰', n: 'BIG COIN',       e: 0x14451a, c: 0xf59e0b, geo: 'double_torus'},
    lose:        { ic: '💸', n: 'FINE',           e: 0x3b0f0f, c: 0xef4444, geo: 'cone_down'  },
    lose_big:    { ic: '🔥', n: 'BIG FINE',       e: 0x4b0000, c: 0xdc2626, geo: 'tetra'      },
    trap:        { ic: '⚠️', n: 'TRAP',           e: 0x3b2000, c: 0xf97316, geo: 'crystal'    },
    mystery:     { ic: '🎁', n: 'MYSTERY',        e: 0x1e1050, c: 0xa855f7, geo: 'icosa'      },
    boost:       { ic: '⚡', n: 'BOOST',          e: 0x1a1a00, c: 0xeab308, geo: 'knot'       },
    shortcut:    { ic: '🌀', n: 'SHORTCUT',       e: 0x001a2e, c: 0x38bdf8, geo: 'cone_up'    },
    cfwd:        { ic: '🚀', n: 'LAUNCH',         e: 0x001438, c: 0x60a5fa, geo: 'cone_up'    },
    cbwd:        { ic: '🌑', n: 'PULLED BACK',    e: 0x200020, c: 0x9333ea, geo: 'cone_down'  },
    swap_space:  { ic: '🔄', n: 'SWAP ZONE',      e: 0x0a1a30, c: 0x38bdf8, geo: 'crystal'    },
    anchor_trap: { ic: '⚓', n: 'ANCHOR TRAP',    e: 0x1a0a00, c: 0xf97316, geo: 'crystal'    },
    magnet:      { ic: '🧲', n: 'MAGNET',         e: 0x002020, c: 0x06b6d4, geo: 'box'        },
    truce:       { ic: '🕊️', n: 'TRUCE',          e: 0x0a2010, c: 0x4ade80, geo: 'icosa'      },
    player_trap: { ic: '🚧', n: 'TOLLBOOTH',      e: 0x2a1000, c: 0xf97316, geo: 'box'        },
    gate:        { ic: '🔒', n: 'THE GATE',       e: 0x2a1800, c: 0xb45309, geo: null         },
    gate_open:   { ic: '🔓', n: 'GATE (OPEN)',    e: 0x0f2a0f, c: 0x22c55e, geo: null         },
    shop:        { ic: '🏪', n: 'ITEM SHOP',      e: 0x1a0a2e, c: 0xa855f7, geo: 'knot'       },
    hq:          { ic: '🏛️', n: 'DISTRICT HQ',   e: 0x1a1500, c: 0xfbbf24, geo: 'double_torus'},
    duel:        { ic: '⚔️', n: 'DUEL',           e: 0x2a0a2a, c: 0xff6b35, geo: 'crystal'    },
};

export const SPACE_DESCS = {
    coin:        'Pocket some change. +3 coins.',
    coin_big:    'Big coin haul! +8 coins.',
    lose:        'Pay up. −4 coins.',
    lose_big:    'Ouch. Big loss. −10 coins.',
    cfwd:        'Launches you forward through the district!',
    cbwd:        'Pulls you back through the district.',
    trap:        'A trap! Lose 5 coins.',
    mystery:     'Random free item from any shop.',
    magnet:      'Steal 5 coins from your opponent.',
    boost:       'Roll again immediately!',
    shortcut:    'Skip ahead 3–8 spaces.',
    truce:       'Both players gain 5 coins.',
    player_trap: 'A placed Tollbooth! Pay the owner 5 coins.',
    anchor_trap: 'An Anchor trap! Sent back 5 spaces.',
    swap_space:  'Swap board positions with your opponent!',
    gate:        'The Gate blocks the Industrial Zone. Roll 5 dice and score ≥15 to break through!',
    gate_open:   'Gate is open — pass freely.',
    shop:        'Browse and buy items with your coins!',
    hq:          'District HQ! First visit: +15 coins. Revisit: +5 coins.',
    duel:        'DUEL! Set a coin bet — then compete in a minigame. Winner takes the pot!',
    start:       'Back at the start of the City Ring Road.',
};

// ============================================================
// DISTRICT BIOMES — visual theming per district
// ============================================================
export const DISTRICT_BIOMES = {
    ring:  { name: 'City Ring Road',     bgTop: '#0f0f1e', bgBot: '#1a1a38', fog: '#0f0f1e', floorEdge: 0x94a3b8, pathTint: 0xcbd5e1 },
    fin:   { name: 'Financial District', bgTop: '#0c1f3e', bgBot: '#1e3a5f', fog: '#0c1f3e', floorEdge: 0x3b82f6, pathTint: 0x60a5fa },
    ba:    { name: 'Back Alley',         bgTop: '#2d0a0a', bgBot: '#4a1010', fog: '#2d0a0a', floorEdge: 0xef4444, pathTint: 0xf87171 },
    shop:  { name: 'Shopping Promenade', bgTop: '#2d0a3e', bgBot: '#4a1560', fog: '#2d0a3e', floorEdge: 0xec4899, pathTint: 0xf472b6 },
    ind:   { name: 'Industrial Zone',    bgTop: '#1a1500', bgBot: '#2d2200', fog: '#1a1500', floorEdge: 0xeab308, pathTint: 0xfbbf24 },
};

export function getBiomeForDistrict(district) {
    return DISTRICT_BIOMES[district] || DISTRICT_BIOMES.ring;
}

// HQ display names and icons for win screen / toasts
export const HQ_META = {
    fin:  { name: 'Wall Street Exchange', icon: '💹' },
    ba:   { name: 'Underground Market',   icon: '🏚️' },
    shop: { name: 'Grand Mall',           icon: '🛍️' },
    ind:  { name: 'Power Plant',          icon: '⚙️'  },
};
