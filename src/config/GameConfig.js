// ============================================================
// TUNABLE CONSTANTS — change these to rebalance the game
// ============================================================
export const GATE_POS            = 75;
export const GATE_THRESHOLD      = 15;
export const GATE_NUM_DICE       = 5;
export const MAX_INV             = 3;
export const MINIGAME_REWARD     = 10;
export const MINIGAME_TIMEOUT_MS = 25000;
export const MINIGAME_EVERY_N_TURNS = 4;

// ============================================================
// ITEMS — icon, name, description, price
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
};

// ============================================================
// SPACE METADATA — pure display/visual data only
// Effect logic lives in GameController.resolveSpaceEffect()
// ============================================================
export const SPACE_META = {
    start:       { ic: '🏁', n: 'START',       e: 0x1e293b, c: 0xfbbf24, geo: null        },
    coin:        { ic: '🪙', n: 'COIN',         e: 0x1c3a1c, c: 0xfbbf24, geo: 'torus'     },
    coin_big:    { ic: '💰', n: 'BIG COIN',     e: 0x14451a, c: 0xf59e0b, geo: 'double_torus' },
    lose:        { ic: '💸', n: 'FINE',         e: 0x3b0f0f, c: 0xef4444, geo: 'cone_down' },
    lose_big:    { ic: '🔥', n: 'BIG FINE',     e: 0x4b0000, c: 0xdc2626, geo: 'tetra'     },
    trap:        { ic: '⚠️', n: 'TRAP',         e: 0x3b2000, c: 0xf97316, geo: 'crystal'   },
    mystery:     { ic: '🎁', n: 'MYSTERY',      e: 0x1e1050, c: 0xa855f7, geo: 'icosa'     },
    boost:       { ic: '⚡', n: 'BOOST',        e: 0x1a1a00, c: 0xeab308, geo: 'knot'      },
    shortcut:    { ic: '🌀', n: 'SHORTCUT',     e: 0x001a2e, c: 0x38bdf8, geo: 'cone_up'   },
    cfwd:        { ic: '🚀', n: 'LAUNCH',       e: 0x001438, c: 0x60a5fa, geo: 'cone_up'   },
    cbwd:        { ic: '🌑', n: 'PULLED BACK',  e: 0x200020, c: 0x9333ea, geo: 'cone_down' },
    swap_space:  { ic: '🔄', n: 'SWAP ZONE',    e: 0x0a1a30, c: 0x38bdf8, geo: 'crystal'   },
    anchor_trap: { ic: '⚓', n: 'ANCHOR TRAP',  e: 0x1a0a00, c: 0xf97316, geo: 'crystal'   },
    magnet:      { ic: '🧲', n: 'MAGNET',       e: 0x002020, c: 0x06b6d4, geo: 'box'       },
    truce:       { ic: '🕊️', n: 'TRUCE',        e: 0x0a2010, c: 0x4ade80, geo: 'icosa'     },
    player_trap: { ic: '🚧', n: 'TOLLBOOTH',    e: 0x2a1000, c: 0xf97316, geo: 'box'       },
    gate:        { ic: '🚪', n: 'THE GATE',     e: 0x2a1800, c: 0xb45309, geo: null        },
    gate_open:   { ic: '🔓', n: 'GATE (OPEN)',  e: 0x0f2a0f, c: 0x22c55e, geo: null        },
    shop:        { ic: '🏪', n: 'ITEM SHOP',    e: 0x1a0a2e, c: 0xa855f7, geo: 'knot'      },
};

export const SPACE_DESCS = {
    coin:        'Pocket some change.',
    coin_big:    'Big coin haul!',
    lose:        'Pay up.',
    lose_big:    'Ouch. Big loss.',
    cfwd:        'Launches you 10 spaces ahead!',
    cbwd:        'Pulls you 10 spaces back.',
    trap:        'Lose 5 coins.',
    mystery:     'Random free item from the shop.',
    magnet:      'Steal 5 coins from opponent.',
    boost:       'Roll again immediately!',
    shortcut:    'Skip ahead 3–8 random spaces.',
    truce:       'Both players gain 5 coins.',
    player_trap: 'A placed Tollbooth! Pay the owner 5 coins.',
    anchor_trap: 'An Anchor trap! Sent back 5 spaces.',
    swap_space:  'Swap board positions with your opponent!',
    gate:        'The Gate blocks the path. Roll 5 dice and score ≥15 to break through!',
    gate_open:   'Gate is open — pass freely.',
    shop:        'Browse and buy items with your coins!',
};

// ============================================================
// BIOMES — visual theming per board segment
// ============================================================
export const BIOMES = [
    { name: 'Lush Forest', bgTop: '#0f380f', bgBot: '#1b4a1b', fog: '#0f380f', floorEdge: 0x22c55e, pathTint: 0x4ade80 },
    { name: 'Magma Core',  bgTop: '#3f0f0f', bgBot: '#6b1313', fog: '#3f0f0f', floorEdge: 0xf97316, pathTint: 0xf59e0b },
    { name: 'Magic Glade', bgTop: '#380f3f', bgBot: '#5c126b', fog: '#380f3f', floorEdge: 0xd946ef, pathTint: 0xc084fc },
    { name: 'The Void',    bgTop: '#0a0a1a', bgBot: '#141433', fog: '#0a0a1a', floorEdge: 0x3b82f6, pathTint: 0x60a5fa },
];

export function getBiomeForSpace(spaceIdx) {
    if (spaceIdx < 25) return BIOMES[0];
    if (spaceIdx < 50) return BIOMES[1];
    if (spaceIdx < 75) return BIOMES[2];
    return BIOMES[3];
}

// ============================================================
// BOARD GENERATION POOLS — tweak to change difficulty curve
// ============================================================
export const EARLY_POOL_WEIGHTS = {
    coin: 20, coin_big: 10, mystery: 8, boost: 6,
    shortcut: 5, cfwd: 4, truce: 3, lose: 2, trap: 2,
};

export const LATE_POOL_WEIGHTS = {
    lose: 12, lose_big: 10, trap: 10, magnet: 6,
    cbwd: 4, mystery: 2, truce: 2, coin: 3, swap_space: 3,
};

export const SHOP_SPACES = new Set([20, 40, 60, 80]);
