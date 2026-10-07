// ============================================================
// CATALOG — everything that can be owned, and what it costs.
// ============================================================
//
// One table for the whole meta economy (docs/LAUNCH_PLAN.md §3). Ownership is
// recorded as entitlement KEYS, never as minigame ids or map ids directly:
//
//   map:<mapId>       a board
//   pack:<packId>     a minigame pack
//   cos:<cosmeticId>  a cosmetic (Phase 3)
//   badge:supporter   bought the Everything bundle
//
// A key can be reached two ways — Tickets, or a store product that grants it —
// and the rest of the game only ever asks "is this key owned?" (Unlocks.js).
//
// PRODUCT IDS ARE PERMANENT. They are created by hand in App Store Connect and
// the Play Console with exactly these strings, and once a product has been sold
// its id can never be reused or renamed. Add new ones; never edit these.
// ============================================================

/** Free from the first launch. The nine 3–4-seat games must stay in this list:
 *  they are the only games a 3–4 player table on one phone can be dealt. */
export const FREE_MINIGAMES = [
    'sumospheres', 'snapstrike', 'gridrecall', 'oddoneout', 'steadyhand',
    'sortrush', 'lootcatch', 'lightcycles', 'brainrot',
    'kartgp', 'bowling', 'highnoon',
];

export const FREE_MAPS = ['hundred_block_dash'];

export const MINIGAME_PACKS = {
    frontier: {
        name: 'Frontier', icon: '🤠', color: '#d97706', tickets: 800,
        blurb: 'Cannons, train roofs, mine carts and a bank job.',
        games: ['barrage', 'express', 'minecart', 'vaultheist', 'tankclash', 'clearout', 'treeclimb'],
    },
    fairground: {
        name: 'Fairground', icon: '🎡', color: '#ec4899', tickets: 800,
        blurb: 'Bumper cars, sack races and a soaking.',
        games: ['bumpercars', 'musicalchairs', 'redlight', 'tag', 'balloontoss', 'balloonpump', 'sackrace', 'minigolf'],
    },
    citynights: {
        name: 'City Nights', icon: '🌃', color: '#6366f1', tickets: 800,
        blurb: 'Rooftops, dance-offs and paint wars after dark.',
        games: ['rooftop', 'blockparty', 'turfwar', 'speedboat', 'riftdive', 'lilypad', 'snowball'],
    },
    tableclassics: {
        name: 'Table Classics', icon: '🃏', color: '#10b981', tickets: 800,
        blurb: 'Air hockey, four in a row, the shell game and more.',
        games: ['puck', 'fourinarow', 'memorymatch', 'shellgame', 'penalty', 'bombpass', 'rhythmforge', 'orbdeflect', 'pancakes'],
    },
};

export const MAP_UNLOCKS = {
    city_circuit: { tickets: 1500 },
};

// ---- Store products -------------------------------------------------------
// `price` is only the fallback label shown before the store answers; the real,
// localised price always comes from the store (Store.js).
export const PRODUCTS = [
    { id: 'hbd.map.city_circuit',     kind: 'nonconsumable', price: '$1.99', grants: ['map:city_circuit'],     title: 'City Circuit' },
    { id: 'hbd.pack.frontier',        kind: 'nonconsumable', price: '$1.99', grants: ['pack:frontier'],        title: 'Frontier Pack' },
    { id: 'hbd.pack.fairground',      kind: 'nonconsumable', price: '$1.99', grants: ['pack:fairground'],      title: 'Fairground Pack' },
    { id: 'hbd.pack.citynights',      kind: 'nonconsumable', price: '$1.99', grants: ['pack:citynights'],      title: 'City Nights Pack' },
    { id: 'hbd.pack.tableclassics',   kind: 'nonconsumable', price: '$1.99', grants: ['pack:tableclassics'],   title: 'Table Classics Pack' },
    { id: 'hbd.bundle.everything',    kind: 'nonconsumable', price: '$6.99', title: 'Everything Unlocked',
      grants: ['map:city_circuit', 'pack:frontier', 'pack:fairground', 'pack:citynights', 'pack:tableclassics', 'badge:supporter'] },
    { id: 'hbd.tickets.500',          kind: 'consumable',    price: '$0.99', tickets: 500,  title: '500 Tickets' },
    { id: 'hbd.tickets.1200',         kind: 'consumable',    price: '$1.99', tickets: 1200, title: '1,200 Tickets' },
    { id: 'hbd.tickets.3500',         kind: 'consumable',    price: '$4.99', tickets: 3500, title: '3,500 Tickets' },
];

// ---- Earning --------------------------------------------------------------
export const EARN = {
    matchFinished:  25,
    minigameWin:    10,
    firstOfDay:     50,
    rewardedAd:     50,
    adsPerDay:      5,
    matchCap:       250,    // a 20-round City match with every game won is still one match
};

// ---- Lookups --------------------------------------------------------------
const _packOf = {};
for (const [id, p] of Object.entries(MINIGAME_PACKS)) for (const g of p.games) _packOf[g] = id;

/** The pack a minigame is sold in, or null if it is free (or unlisted). */
export function packOf(type) { return _packOf[type] || null; }

/** The entitlement key that unlocks a minigame, or null if it is free. */
export function keyForMinigame(type) {
    if (FREE_MINIGAMES.includes(type)) return null;
    const p = packOf(type);
    // A game added to the registry but to no pack is free until it is placed:
    // safer than shipping a game nobody can reach.
    return p ? `pack:${p}` : null;
}

/** The entitlement key that unlocks a map, or null if it is free. */
export function keyForMap(mapId) {
    return FREE_MAPS.includes(mapId) || !MAP_UNLOCKS[mapId] ? null : `map:${mapId}`;
}

/** The Ticket price of a key, or null when it cannot be bought with Tickets. */
export function ticketPrice(key) {
    const [kind, id] = key.split(':');
    if (kind === 'pack') return MINIGAME_PACKS[id]?.tickets ?? null;
    if (kind === 'map')  return MAP_UNLOCKS[id]?.tickets ?? null;
    if (kind === 'cos')  return _cosmeticPrice(id);
    return null;
}

/** The single-item store product for a key (not the bundle), if any. */
export function productForKey(key) {
    return PRODUCTS.find(p => p.kind === 'nonconsumable' && p.grants.length === 1 && p.grants[0] === key) || null;
}

export function product(id) { return PRODUCTS.find(p => p.id === id) || null; }

// Cosmetic prices are registered by Cosmetics.js so this file does not have to
// import the 3D side of the game.
let _cosmeticPrice = () => null;
export function registerCosmeticPricing(fn) { _cosmeticPrice = fn; }
