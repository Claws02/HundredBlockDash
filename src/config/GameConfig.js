// ============================================================
// TUNABLE CONSTANTS
// ============================================================
// Coin penalties, named once so the effect, the blurb and every realm's flavour
// text can never drift apart (they had, in eight places).
export const FINE_AMOUNT     = 3;    // was 4
export const BIG_FINE_AMOUNT = 8;    // was 10
export const TRAP_AMOUNT     = 5;

// The Gate's dice count is shared; the THRESHOLD is per-map and now lives on
// the map module (ActiveMap.gateThreshold()). It used to be a function here
// that switched on the map id — the last piece of per-map tuning outside the
// map, and one more place a third board would have had to be added by hand.
export const GATE_NUM_DICE       = 5;

// Hundred Block Dash — selectable linear-map lengths.
// Realms are always 25 blocks: 50→2 realms, 75→3, 100→4.
export const HBD_LENGTHS        = [50, 75, 100];
export const HBD_DEFAULT_LENGTH = 100;
export const HBD_FINISH_BONUS   = 50;  // bonus coins for reaching the Crown first

// Build the runtime layout for a given length. The Gate (The Rift) guards the
// entrance to the final realm; shops sit on every 20th block (never on the Gate).
export function buildHbdConfig(length) {
    const len        = HBD_LENGTHS.includes(length) ? length : HBD_DEFAULT_LENGTH;
    const realmCount = Math.round(len / 25);
    const gatePos    = (realmCount - 1) * 25;
    const shopSpaces = new Set();
    for (let s = 20; s < len; s += 20) if (s !== gatePos) shopSpaces.add(s);
    return { length: len, finish: len - 1, gatePos, shopSpaces, realmCount };
}

// Back-compat default config (full 100-block run). Live games read state.hbd.
export const HBD_DEFAULT_CONFIG = buildHbdConfig(HBD_DEFAULT_LENGTH);
export const MAX_INV             = 3;
export const MINIGAME_REWARD     = 10;
export const MINIGAME_EVERY_N_TURNS = 4;

// City Circuit scoring.
// A "round" is MINIGAME_EVERY_N_TURNS board turns plus one head-to-head
// minigame, so round count is the dominant term in total session length.
// Measured on the QA harness at roughly 2.5–3 min per round, which put the
// original fixed 20 rounds near an hour — far past a mobile party-game sitting.
// The length is now player-chosen, mirroring the Hundred Block Dash picker.
export const CITY_LENGTHS        = [6, 12, 20];
export const CITY_DEFAULT_ROUNDS = 12;
export const CITY_LENGTH_LABELS  = {
    6:  { name: 'SPRINT',   blurb: '~15 min' },
    12: { name: 'STANDARD', blurb: '~30 min' },
    20: { name: 'MARATHON', blurb: '~50 min' },
};
export const DISTRICT_HQ_FIRST_BONUS  = 15;
export const DISTRICT_HQ_REVISIT_BONUS = 5;
export const DISTRICT_DOMINANCE_BONUS  = 15;
export const FULL_CIRCUIT_BONUSES     = [25, 15, 8]; // diminishing per circuit
export const CONTRACT_COUNT           = 3;
export const MAX_ALLIES               = 2;
export const ALLY_TURNS               = 3; // turns before an ally expires
export const DUEL_BET_OPTIONS         = [1, 3, 5, 8, 10];
// Landing on a DUEL hands you a stake before the bet is set. Without it a
// player on zero coins met a bet screen with every option disabled and no way
// out — a hard lock, and the one place on the board where being broke stopped
// the game rather than just costing you. Three is the smallest amount that
// clears the lowest bet with something left over.
export const DUEL_STAKE               = 3;
export const ALLY_SPAWN_DELAY_TURNS   = 2; // turns after claim before next ally spawns

// ============================================================
// ITEMS
// Prices follow four clean impact tiers so the shop reads consistently:
//   8  — Utility   (cheap, situational)
//   12 — Tactical  (solid, repositioning / control)
//   16 — Strong    (high-value movement & denial)
//   20 — Power     (game-swinging)
// ============================================================
// The shop, narrowed to ONE ITEM PER VERB.
//
// It used to carry twelve, and five of them did the same job: warp_drive forced
// a 5, custom_dice picked any number (strictly better, for four more coins),
// double_die rolled two, overcharge doubled the result, and rocket jumped eight.
// Five ways to say "move further" is not five choices — it is one choice with
// four decoys, and it made the shop a wall of text to read on someone else's
// turn. Cut to seven, each of which does something none of the others can:
//
//   defend · trap their path · sabotage their roll · control your own roll ·
//   jump forward · take their coins · trade places
//
// Removed: Warp Drive (dominated by Custom Dice), Double Die and Overcharge
// (both "bigger roll" again), Tollbooth (a second, weaker trap, and a coin tax
// at a time when coin taxes are deliberately scarce), Mirror (a reactive counter
// that does nothing on most turns and asks you to predict an item you cannot
// see). They are gone from ITEMS entirely, so Mystery spaces cannot grant them
// either — the roster is the roster.
export const ITEMS = {
    // Utility — 8
    shield:      { icon: '🛡️', name: 'Shield',      desc: 'Block the next negative space effect',      price: 8,  tier: 'Utility'  },
    // Tactical — 12
    anchor:      { icon: '⚓', name: 'Anchor',       desc: 'Place trap — sends opponent back 5 spaces', price: 12, tier: 'Tactical' },
    // Strong — 16
    cursed_die:  { icon: '💀', name: 'Cursed Die',  desc: "Force opponent's next roll to 1 or 2",      price: 16, tier: 'Strong'   },
    custom_dice: { icon: '🎯', name: 'Custom Dice', desc: 'Pick any number 1–6 as your next roll',     price: 16, tier: 'Strong'   },
    // Power — 20
    rocket:      { icon: '🛸', name: 'Rocket',      desc: 'Instantly move forward 8 spaces',           price: 20, tier: 'Power'    },
    steal:       { icon: '🐷', name: 'Steal',       desc: 'Take 10 coins from your opponent',          price: 20, tier: 'Power'    },
    swap:        { icon: '🔄', name: 'Swap',        desc: 'Swap board positions with your opponent',   price: 20, tier: 'Power'    },
};

// District-specific shop inventories (null = full shop at regular price)
export const DISTRICT_SHOPS = {
    ring: null,
    // Wall Street Exchange — money and position, expensive
    fin:  ['steal', 'swap', 'custom_dice'],
    // Underground Market — dirty tricks, discounted
    ba:   ['anchor', 'cursed_die', 'shield'],
    // Grand Mall — full shop at 50% off (handled via isGrandMall flag in HQ)
    shop: null,
    // Power Plant — movement
    ind:  ['rocket', 'custom_dice', 'swap'],
    // Hundred Block Dash realm shops — full inventory, themed title only.
    woods: null, ember: null, fae: null, void: null,
};

export const BA_DISCOUNT = 0.75;   // 25% off in Back Alley
export const GRAND_MALL_DISCOUNT = 0.5; // 50% off at Grand Mall HQ

// ============================================================
// BUDDIES
//
// Called "allies" throughout the code — state keys, DOM ids and the ALLIES map
// keep that name because renaming them buys the player nothing and would break
// every probe that reads them. Everything a PLAYER reads says Buddy.
//
// Each `desc` is a contract with the player. The audit that produced this pass
// found one that wasn't kept: the Bodyguard promised to absorb "negative space
// effects" but only ever fired inside loseCoins(), so it stopped fines, traps
// and magnets and did nothing at all about an Anchor dragging you back five
// spaces — the one board effect people most expect a bodyguard to handle. That
// is now a charge it can spend (see resolveSpaceEffect, case 'anchor_trap').
// ============================================================
export const ALLIES = {
    cabbie:    {
        icon: '🚕', name: 'The Cabbie',
        powerType: 'active',
        desc: 'Once per round, ride to any junction — change districts for free.',
        turns: ALLY_TURNS,
    },
    vendor:    {
        icon: '🌮', name: 'Street Vendor',
        powerType: 'coin_bonus',
        desc: '+2 extra coins every time you land on a coin space.',
        turns: ALLY_TURNS,
    },
    banker:    {
        icon: '💼', name: 'The Banker',
        powerType: 'interest',
        desc: 'At each round end, collect 1 coin for every 10 you are holding.',
        turns: ALLY_TURNS,
    },
    bodyguard: {
        icon: '🦺', name: 'The Bodyguard',
        powerType: 'shield_all',
        desc: 'Blocks your next 3 hits — coin losses and Anchor traps alike.',
        turns: ALLY_TURNS,
        shieldCharges: 3,
    },
    investor:  {
        icon: '📈', name: 'The Investor',
        powerType: 'contract_x2',
        desc: 'The first Bounty you claim each round pays double.',
        turns: ALLY_TURNS,
    },
};

// A buddy waiting on the board used to wait forever: spawnAlly() only ran when
// the board was empty, and nothing ever cleared an unclaimed one. "How long
// until it goes away" had no answer because the answer was "never". It now
// leaves after this many ROUNDS unclaimed, which is what makes the round report
// worth reading and what makes ignoring a buddy an actual decision.
export const BUDDY_MAP_ROUNDS         = 3;

// How far from a player a buddy is allowed to turn up, measured in real board
// steps through the graph (both roads at every junction), not in lap-order index.
//
// Placed at random on a 60-node lap, most spawns landed most of a circuit away.
// The report said where they were and the countdown said they leave in three
// rounds, and those two facts did not fit together — the buddy was information
// rather than an opportunity.
//
// NEAR is the preferred band: a couple of turns of ordinary rolling. MAX is six
// maximum rolls, so a claim is always at least theoretically possible inside the
// rounds the buddy is around for.
export const BUDDY_NEAR_STEPS         = 20;
export const BUDDY_MAX_STEPS          = 36;

// All character types (original 4 + 5 ally characters)
export const ALL_CHAR_TYPES = ['slime', 'ghost', 'boxy', 'bunny', 'cabbie', 'vendor', 'banker', 'bodyguard', 'investor'];

export const CHAR_ICONS = {
    slime:     '💧', ghost:     '👻', boxy:      '🧊', bunny:     '🐰',
    cabbie:    '🚕', vendor:    '🌮', banker:    '💼', bodyguard: '🦺', investor:  '📈',
};

// Display names. The ids stay slime/ghost/boxy/bunny — saves, probes and every
// charType comparison read those — but the four starters were bare nouns
// ("Slime", "Boxy") sitting next to five buddies with proper names, so the cast
// read as four placeholders and five characters. These are names.
export const CHAR_NAMES = {
    slime:     'Bloop',   ghost:     'Spook',    boxy:      'Crate',
    bunny:     'Thumper', cabbie:    'Cabbie',   vendor:    'Vendor',
    banker:    'Banker',  bodyguard: 'Bodyguard', investor: 'Investor',
};

// Characters are purely cosmetic — they carry no gameplay abilities.

// ============================================================
// SPACE METADATA
// ============================================================
export const SPACE_META = {
    start:       { ic: '🏁', n: 'START',         e: 0x1e293b, c: 0xfbbf24, geo: null         },
    // The Crown was previously stored as a 'start' tile with an overridden name,
    // which meant every count and every map label reported two START spaces per
    // board and never named the finish.
    finish:      { ic: '👑', n: 'THE CROWN',     e: 0x2a2000, c: 0xfbbf24, geo: null         },
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
    lose:        `Pay up. −${FINE_AMOUNT} coins.`,
    lose_big:    `Ouch. Big loss. −${BIG_FINE_AMOUNT} coins.`,
    cfwd:        'Launches you forward through the district!',
    cbwd:        'Pulls you back through the district.',
    trap:        `A trap! Lose ${TRAP_AMOUNT} coins.`,
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
    duel:        'DUEL! Take 3 coins to ante up, set a bet, then compete in a minigame. Winner takes the pot!',
    start:       'Back at the start of the City Ring Road.',
    finish:      'The Crown. Reach it for the finish bonus — but the most coins still wins.',
};

// ============================================================
// DISTRICT BIOMES — visual theming per district
// ============================================================
// A district was a name and four colours. That is enough to tint the sky and
// nothing else, so all four read as the same road under different lighting —
// the player was choosing between "the blue one" and "the red one" rather than
// between places. Each one now also carries an icon, a tagline and a line of
// lore for the entry banner and the briefing, a SURFACE (what the ground is
// made of) and a PROPS key the renderer dresses the roadside with.
export const DISTRICT_BIOMES = {
    ring:  {
        name: 'City Ring Road', icon: '🛣️',
        tagline: 'Four lanes of ordinary, and that is the point.',
        lore: 'Traffic lights, bus shelters, street trees and the fountain plaza turning in the middle of it all. Nothing happens here. That is why everybody takes it.',
        story: 'THE LOOP · Every road in the city eventually comes back to this one. It is the safe way round and the slow way round, and the four turnings off it are the only real decisions on the board.',
        // Midday. The baseline every other district is read against.
        bgTop: '#63a6de', bgBot: '#a9d4f2', fog: '#bfe0f5', floorEdge: 0x94a3b8, pathTint: 0xcbd5e1,
        surface: 'asphalt', props: 'civic',
        light: { color: 0xfff3dd, intensity: 0.0, height: 26, radius: 60 },   // daylight is enough
        motes: null,
    },
    fin:   {
        name: 'Financial District', icon: '🏦',
        tagline: 'The money never sleeps, and neither do the tickers.',
        lore: 'Mirror-polished granite, gold inlay running to the Exchange steps, and a bronze bull everybody touches on the way past. Green and red light on every face.',
        story: 'THE EXCHANGE · Ten blocks of glass and granite where the numbers on the boards decide who eats. Come here to make money fast, and know that the boards are watching you do it.',
        // Crisp cold morning — bright and blue-white, high contrast off glass.
        bgTop: '#3f7fbe', bgBot: '#8ec4e8', fog: '#a7cbe8', floorEdge: 0x38bdf8, pathTint: 0x7dd3fc,
        surface: 'granite', props: 'finance',
        // An ACCENT, not a flood. The first pass ran these at 1.5–2.4 and every
        // surface in the district came back the same single hue.
        light: { color: 0x9fd0ff, intensity: 0.8, height: 22, radius: 66, bounce: 0xffc65c, bounceI: 0.7 },
        motes: { color: 0xffd782, count: 26, rise: 0.35, size: 0.22, spread: 26 },
    },
    ba:    {
        name: 'Back Alley', icon: '🌃',
        tagline: 'Where the city keeps what it does not want seen.',
        lore: 'Wet black brick, neon in six languages, steam off the grates and washing strung between the fire escapes. Somebody is always watching.',
        story: 'THE NIGHT MARKET · Twelve blocks of somebody else\'s business. Nothing here is bolted down — including you. It is the longest road on the board and the only one where a rival can take something off you.',
        // Night. The only district lit by its own signage rather than the sky.
        bgTop: '#150e1e', bgBot: '#33223f', fog: '#4c3350', floorEdge: 0xf472b6, pathTint: 0xfb7185,
        surface: 'wet', props: 'alley',
        light: { color: 0xff4fa3, intensity: 1.6, height: 13, radius: 52, bounce: 0x35e0ff, bounceI: 1.1 },
        motes: { color: 0xff9a4d, count: 34, rise: 1.5, size: 0.14, spread: 22 },
    },
    shop:  {
        name: 'Shopping Promenade', icon: '🎪',
        tagline: 'A street festival that never packs up.',
        lore: 'Bunting from lamp to lamp, striped awnings over every stall, a carousel turning at the far end and the Grand Mall\'s dome catching all of it.',
        story: 'THE GRAND PARADE · Everything is for sale and half of it is half price. The friendliest road on the board — no coin losses at all — and the Grand Mall at the end sells the whole shop at half price.',
        // Warm afternoon, high key. The brightest road on the board.
        bgTop: '#a06ad0', bgBot: '#e3bdf2', fog: '#e6c9f2', floorEdge: 0xf0abfc, pathTint: 0xf9a8d4,
        surface: 'paving', props: 'market',
        light: { color: 0xffd9f0, intensity: 0.7, height: 20, radius: 60, bounce: 0xffe08a, bounceI: 0.6 },
        motes: { color: 0xffffff, count: 40, rise: -0.5, size: 0.16, spread: 24 },   // falling confetti
    },
    ind:   {
        name: 'Industrial Zone', icon: '⚙️',
        tagline: 'The machines that keep the lights on.',
        lore: 'Pipework overhead, chain-link and hazard paint underfoot, and a permanent orange haze off the furnaces. It pays well because nobody wants to be here.',
        story: 'THE WORKS · Behind the Gate, and worth the roll to get in. Five blocks, every one of them pays, and the cooling towers never stop breathing.',
        // Sodium dusk, hard and hazy.
        bgTop: '#33220e', bgBot: '#8a5a20', fog: '#a8763a', floorEdge: 0xf97316, pathTint: 0xfb923c,
        surface: 'concrete', props: 'works',
        light: { color: 0xff9a3c, intensity: 1.3, height: 17, radius: 46, bounce: 0xffd08a, bounceI: 0.6 },
        motes: { color: 0xff7a1a, count: 30, rise: 2.2, size: 0.13, spread: 20 },
    },
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
        tagline: 'Where the dash begins.',
        lore: 'The old forest hums with secrets. Pocket what coins you can — the road only gets stranger from here.',
        bgTop: '#0f380f', bgBot: '#1b4a1b', fog: 0x0f380f, floorEdge: 0x22c55e, pathTint: 0x4ade80,
        flavor: {
            lose:     { n: 'BRAMBLE SNAG',  d: `Tangled in thorns. −${FINE_AMOUNT} coins.` },
            lose_big: { n: 'BEAR TRAP',     d: `Snapped a bear trap! −${BIG_FINE_AMOUNT} coins.` },
            trap:     { n: 'HIDDEN SNARE',  d: 'A hunter\'s snare. Lose 5 coins.' },
            shop:     { n: 'FOREST CACHE',  d: 'A hidden cache of supplies. Browse and buy!' },
        },
    },
    {
        name: 'Ember Wastes', icon: '🌋', key: 'ember', shopName: '🌋 MAGMA FORGE',
        tagline: 'The ground runs red.',
        lore: 'Cracked earth and rivers of fire. Tread carefully — a single misstep here costs dearly.',
        bgTop: '#3f0f0f', bgBot: '#6b1313', fog: 0x3f0f0f, floorEdge: 0xf97316, pathTint: 0xf59e0b,
        flavor: {
            lose:     { n: 'EMBER BURN',    d: `Singed by cinders. −${FINE_AMOUNT} coins.` },
            lose_big: { n: 'LAVA PLUNGE',   d: `Into the magma! −${BIG_FINE_AMOUNT} coins.` },
            trap:     { n: 'MAGMA CRACK',   d: 'The ground splits. Lose 5 coins.' },
            shop:     { n: 'MAGMA FORGE',   d: 'Gear forged in fire. Browse and buy!' },
        },
    },
    {
        name: 'Fae Glade', icon: '✨', key: 'fae', shopName: '✨ FAE BAZAAR',
        tagline: 'Nothing here plays fair.',
        lore: 'Glittering and treacherous, the Glade is ruled by tricksters who love nothing more than swapping your fortune for theirs.',
        bgTop: '#380f3f', bgBot: '#5c126b', fog: 0x380f3f, floorEdge: 0xd946ef, pathTint: 0xc084fc,
        flavor: {
            lose:     { n: 'FAE TRICK',     d: `A sprite filches your purse. −${FINE_AMOUNT} coins.` },
            lose_big: { n: 'CURSE HEX',     d: `Hexed! −${BIG_FINE_AMOUNT} coins.` },
            trap:     { n: 'PIXIE PRANK',   d: 'A prank trap. Lose 5 coins.' },
            shop:     { n: 'FAE BAZAAR',    d: 'Enchanted wares for sale. Browse and buy!' },
        },
    },
    {
        name: 'The Void', icon: '🌌', key: 'void', shopName: '🌌 VOID EXCHANGE',
        tagline: 'The Crown lies beyond.',
        lore: 'Reality frays at the edge of the Void. Push through the dark — the Crown of the Hundred Blocks waits at its heart.',
        bgTop: '#0a0a1a', bgBot: '#141433', fog: 0x0a0a1a, floorEdge: 0x3b82f6, pathTint: 0x60a5fa,
        flavor: {
            lose:     { n: 'ENTROPY TAX',   d: `Reality skims your coins. −${FINE_AMOUNT} coins.` },
            lose_big: { n: 'REALITY RIFT',  d: `Torn apart! −${BIG_FINE_AMOUNT} coins.` },
            trap:     { n: 'VOID SNARE',    d: 'Caught in the dark. Lose 5 coins.' },
            shop:     { n: 'VOID EXCHANGE', d: 'Trade at the edge of reality. Browse and buy!' },
            gate:     { n: 'THE RIFT',      d: 'The Rift seals the Void. Roll 5 dice, score ≥15 to tear through!' },
        },
    },
];
// Active realm count for the running game (50→2, 75→3, 100→4). The final realm
// is ALWAYS the Void (the Crown's realm); shorter maps drop the middle realms,
// so the story — race through the realms to the Crown beyond the Rift — holds at
// every length. Set at game start via setHbdRealmCount().
let _activeRealmCount = HBD_DEFAULT_CONFIG.realmCount;
export function setHbdRealmCount(n) {
    _activeRealmCount = Math.max(2, Math.min(HBD_BIOMES.length, n || HBD_BIOMES.length));
}

// Map a realm slot (0-based) to its biome index, keeping the Void last.
function _realmBiomeIndex(r, realmCount) {
    const last = HBD_BIOMES.length - 1;            // Void
    if (r >= realmCount - 1) return last;
    return Math.min(r, last - 1);                  // Woods / Ember / Fae
}

export function getBiomeForSpace(idx) {
    const i = typeof idx === 'number' ? idx : 0;
    const r = Math.floor(i / 25);
    return HBD_BIOMES[_realmBiomeIndex(r, _activeRealmCount)];
}

// The realm (biome) a Hundred Block Dash space belongs to.
export function getRealmForSpace(idx) {
    return getBiomeForSpace(typeof idx === 'number' ? idx : 0);
}

// Ordered list of realms in the active run (for the story intro).
export function getActiveRealms() {
    const out = [];
    for (let r = 0; r < _activeRealmCount; r++) out.push(HBD_BIOMES[_realmBiomeIndex(r, _activeRealmCount)]);
    return out;
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
