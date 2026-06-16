// ============================================================
// TUNABLE CONSTANTS
// ============================================================
export const GATE_THRESHOLD      = 15;
export const GATE_NUM_DICE       = 5;

// Hundred Block Dash — classic 100-space linear map
export const HBD_GATE_POS    = 75;
export const HBD_SHOP_SPACES = new Set([20, 40, 60, 80]);
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
// Prices follow four clean impact tiers so the shop reads consistently:
//   8  — Utility   (cheap, situational)
//   12 — Tactical  (solid, repositioning / control)
//   16 — Strong    (high-value movement & denial)
//   20 — Power     (game-swinging)
// ============================================================
export const ITEMS = {
    // Utility — 8
    shield:      { icon: '🛡️', name: 'Shield',       desc: 'Block the next negative space effect',       price: 8,  tier: 'Utility'  },
    tollbooth:   { icon: '🚧', name: 'Tollbooth',   desc: 'Place on current space — enemies pay 5c',    price: 8,  tier: 'Utility'  },
    // Tactical — 12
    warp_drive:  { icon: '🚀', name: 'Warp Drive',  desc: 'Forces your next roll to be a 5',            price: 12, tier: 'Tactical' },
    anchor:      { icon: '⚓', name: 'Anchor',       desc: 'Place trap — sends opponent back 5 spaces',  price: 12, tier: 'Tactical' },
    mirror:      { icon: '🪞', name: 'Mirror',       desc: 'Reflect the next item used against you',     price: 12, tier: 'Tactical' },
    // Strong — 16
    double_die:  { icon: '💥', name: 'Double Die',  desc: 'Roll 2 dice, move the sum',                  price: 16, tier: 'Strong'   },
    overcharge:  { icon: '⚡', name: 'Overcharge',   desc: 'Your next roll result is doubled (max 12)',  price: 16, tier: 'Strong'   },
    custom_dice: { icon: '🎯', name: 'Custom Dice',  desc: 'Pick any number 1–6 as your next roll',      price: 16, tier: 'Strong'   },
    cursed_die:  { icon: '💀', name: 'Cursed Die',  desc: "Force opponent's next roll to 1 or 2",       price: 16, tier: 'Strong'   },
    // Power — 20
    rocket:      { icon: '🛸', name: 'Rocket',       desc: 'Instantly move forward 8 spaces',            price: 20, tier: 'Power'    },
    steal:       { icon: '🐷', name: 'Steal',        desc: 'Take 10 coins from your opponent',           price: 20, tier: 'Power'    },
    swap:        { icon: '🔄', name: 'Swap',         desc: 'Swap board positions with your opponent',    price: 20, tier: 'Power'    },
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
    // Hundred Block Dash realm shops — full inventory, themed title only.
    woods: null, ember: null, fae: null, void: null,
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

// Characters are purely cosmetic — they carry no gameplay abilities.

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
    ring:  { name: 'City Ring Road',     bgTop: '#5b9bd5', bgBot: '#87bce8', fog: '#a8d4f0', floorEdge: 0x94a3b8, pathTint: 0xcbd5e1 },
    fin:   { name: 'Financial District', bgTop: '#2e6da4', bgBot: '#5491c8', fog: '#8ab8e0', floorEdge: 0x3b82f6, pathTint: 0x60a5fa },
    ba:    { name: 'Back Alley',         bgTop: '#5a4040', bgBot: '#7a5555', fog: '#9a7070', floorEdge: 0xef4444, pathTint: 0xf87171 },
    shop:  { name: 'Shopping Promenade', bgTop: '#6040a0', bgBot: '#8060c0', fog: '#b090d8', floorEdge: 0xec4899, pathTint: 0xf472b6 },
    ind:   { name: 'Industrial Zone',    bgTop: '#8a7040', bgBot: '#a89060', fog: '#c8b080', floorEdge: 0xeab308, pathTint: 0xfbbf24 },
};

export function getBiomeForDistrict(district) {
    return DISTRICT_BIOMES[district] || DISTRICT_BIOMES.ring;
}

// ============================================================
// HUNDRED BLOCK DASH — the run to the Crown crosses four realms.
// Each biome keeps its colour identity but now has a name, an icon, a
// themed shop, and flavoured copy for its key spaces (§ themed names).
// `flavor[type]` overrides the display name/desc/icon for that realm;
// anything not overridden falls back to the global SPACE_META/SPACE_DESCS.
// ============================================================
export const HBD_BIOMES = [
    {
        name: 'Whispering Woods', icon: '🌲', key: 'woods', shopName: '🌲 FOREST CACHE',
        bgTop: '#0f380f', bgBot: '#1b4a1b', fog: 0x0f380f, floorEdge: 0x22c55e, pathTint: 0x4ade80,
        flavor: {
            lose:     { n: 'BRAMBLE SNAG',  d: 'Tangled in thorns. −4 coins.' },
            lose_big: { n: 'BEAR TRAP',     d: 'Snapped a bear trap! −10 coins.' },
            trap:     { n: 'HIDDEN SNARE',  d: 'A hunter\'s snare. Lose 5 coins.' },
            shop:     { n: 'FOREST CACHE',  d: 'A hidden cache of supplies. Browse and buy!' },
        },
    },
    {
        name: 'Ember Wastes', icon: '🌋', key: 'ember', shopName: '🌋 MAGMA FORGE',
        bgTop: '#3f0f0f', bgBot: '#6b1313', fog: 0x3f0f0f, floorEdge: 0xf97316, pathTint: 0xf59e0b,
        flavor: {
            lose:     { n: 'EMBER BURN',    d: 'Singed by cinders. −4 coins.' },
            lose_big: { n: 'LAVA PLUNGE',   d: 'Into the magma! −10 coins.' },
            trap:     { n: 'MAGMA CRACK',   d: 'The ground splits. Lose 5 coins.' },
            shop:     { n: 'MAGMA FORGE',   d: 'Gear forged in fire. Browse and buy!' },
        },
    },
    {
        name: 'Fae Glade', icon: '✨', key: 'fae', shopName: '✨ FAE BAZAAR',
        bgTop: '#380f3f', bgBot: '#5c126b', fog: 0x380f3f, floorEdge: 0xd946ef, pathTint: 0xc084fc,
        flavor: {
            lose:     { n: 'FAE TRICK',     d: 'A sprite filches your purse. −4 coins.' },
            lose_big: { n: 'CURSE HEX',     d: 'Hexed! −10 coins.' },
            trap:     { n: 'PIXIE PRANK',   d: 'A prank trap. Lose 5 coins.' },
            shop:     { n: 'FAE BAZAAR',    d: 'Enchanted wares for sale. Browse and buy!' },
        },
    },
    {
        name: 'The Void', icon: '🌌', key: 'void', shopName: '🌌 VOID EXCHANGE',
        bgTop: '#0a0a1a', bgBot: '#141433', fog: 0x0a0a1a, floorEdge: 0x3b82f6, pathTint: 0x60a5fa,
        flavor: {
            lose:     { n: 'ENTROPY TAX',   d: 'Reality skims your coins. −4 coins.' },
            lose_big: { n: 'REALITY RIFT',  d: 'Torn apart! −10 coins.' },
            trap:     { n: 'VOID SNARE',    d: 'Caught in the dark. Lose 5 coins.' },
            shop:     { n: 'VOID EXCHANGE', d: 'Trade at the edge of reality. Browse and buy!' },
            gate:     { n: 'THE RIFT',      d: 'The Rift seals the Void. Roll 5 dice, score ≥15 to tear through!' },
        },
    },
];
export function getBiomeForSpace(idx) {
    if (idx < 25) return HBD_BIOMES[0];
    if (idx < 50) return HBD_BIOMES[1];
    if (idx < 75) return HBD_BIOMES[2];
    return HBD_BIOMES[3];
}

// The realm (biome) a Hundred Block Dash space belongs to.
export function getRealmForSpace(idx) {
    return getBiomeForSpace(typeof idx === 'number' ? idx : 0);
}

// Themed display label for an HBD space: realm flavor first, then global defaults.
export function hbdSpaceLabel(idx, type) {
    const realm = getRealmForSpace(idx);
    const f     = realm.flavor && realm.flavor[type];
    const meta  = SPACE_META[type] || SPACE_META.coin;
    return {
        name: (f && f.n) || meta.n || type,
        desc: (f && f.d) || SPACE_DESCS[type] || '',
        icon: (f && f.ic) || meta.ic || '',
    };
}

// Themed shop key (drives the shop title) for an HBD space position.
export function hbdShopKey(idx) {
    return getRealmForSpace(idx).key || 'woods';
}

// HQ display names and icons for win screen / toasts
export const HQ_META = {
    fin:  { name: 'Wall Street Exchange', icon: '💹' },
    ba:   { name: 'Underground Market',   icon: '🏚️' },
    shop: { name: 'Grand Mall',           icon: '🛍️' },
    ind:  { name: 'Power Plant',          icon: '⚙️'  },
};
