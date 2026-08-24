// ============================================================
// STAR TERRITORY — the Clover.
//
// A twelve-node hub ring (Perdition) with four twelve-node territory LOBES.
// 60 playable nodes, the same budget as City Circuit, plus 4 invisible
// junctions. Full design in docs/STAR_TERRITORY_SPEC.md.
//
// The one real difference from City Circuit, and it is the point: a City
// district is a PARALLEL ROUTE — taking it still carries you round the ring. A
// Territory is a DETOUR. It leaves at its junction and rejoins the hub at the
// same node the ring branch reaches, so it costs eleven extra spaces and buys
// you nothing positional. You are spending time, not routing through it, which
// is what makes the Territory Office at the far end of it worth going for.
//
// WHY THE LOBES ARE CIRCLES. The first draft drew each territory as a teardrop
// leaving and rejoining the ring. Laying the nodes out numerically killed it:
// the two sides of a teardrop run 2-6 units apart at every parameter setting
// tried, against a 16x13 tile — the roads sit on top of each other. A circular
// lobe tangent to the ring has no such neck and its node spacing is uniform by
// construction. Measured: 10.4-11.4 units per step (City runs ~10), and the
// closest NON-adjacent pair is 10.4 — a full step apart.
// ============================================================

export const JUNCTIONS = new Set(['jn_a', 'jn_b', 'jn_c', 'jn_d']);

export const REGION_NAMES = {
    hub:   'Perdition',
    rail:  'Ironwood Railyard',
    mine:  'Cinder Mine',
    ranch: 'Longhorn Ranch',
    bad:   'Boot Hill Badlands',
};

// The hub is excluded, the same way City's ring is: these are the roads you can
// choose to take, and the ones progress is counted against.
export const REGION_KEYS = ['rail', 'mine', 'ranch', 'bad'];

export const BRANCHES = {
    jn_a: [
        { nodeId: 'h4',      label: 'Stay in town',       short: 'TOWN',    desc: 'Straight on · quick',        icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'rail_0',  label: 'Ironwood Railyard',  short: 'RAILYARD',desc: 'Mysteries & momentum',       icon: '🚂', district: 'rail',  spaces: 12 },
    ],
    jn_b: [
        { nodeId: 'h7',      label: 'Stay in town',       short: 'TOWN',    desc: 'Straight on · quick',        icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'mine_0',  label: 'Cinder Mine',        short: 'MINE',    desc: 'Rich — past the rockslide 🔒', icon: '⛏️', district: 'mine',  spaces: 12 },
    ],
    jn_c: [
        { nodeId: 'h10',     label: 'Stay in town',       short: 'TOWN',    desc: 'Straight on · quick',        icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'ranch_0', label: 'Longhorn Ranch',     short: 'RANCH',   desc: 'Safe money · nothing bites', icon: '🐎', district: 'ranch', spaces: 12 },
    ],
    jn_d: [
        { nodeId: 'h1',      label: 'Stay in town',       short: 'TOWN',    desc: 'Straight on · quick',        icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'bad_0',   label: 'Boot Hill Badlands', short: 'BADLANDS',desc: 'Thieves, swaps & a duel',    icon: '🏜️', district: 'bad',   spaces: 12 },
    ],
};

const G = {};

// ---- Hub ring: Perdition, 12 nodes ----
// h1 is START. h5 and h11 are the town's general stores.
// A junction sits BETWEEN h3/h4, h6/h7, h9/h10 and h12/h1.
const HUB_FIXED = { h1: 'start', h5: 'shop', h11: 'shop' };
const HUB_TO_JN = { 3: 'jn_a', 6: 'jn_b', 9: 'jn_c', 12: 'jn_d' };
for (let i = 1; i <= 12; i++) {
    const id = 'h' + i;
    G[id] = {
        id, type: HUB_FIXED[id] || null, district: 'hub',
        next: [HUB_TO_JN[i] || ('h' + (i % 12 + 1))],
    };
}

// ---- The four lobes ----
// Each is a teardrop-free loop of 12: leaves at its junction, rejoins the hub
// at the node the "stay in town" branch also reaches.
//
// x_2 is the outfitter and x_6 is the Territory Office, deliberately in that
// order: you walk past the shop BEFORE you reach the Office, so "spend it on an
// item or save it for the Star" is a live question at the moment you have to
// answer it. Neither existing board has that decision.
const LOBES = [
    { key: 'rail',  junction: 'jn_a', rejoin: 'h4'  },
    { key: 'mine',  junction: 'jn_b', rejoin: 'h7'  },
    { key: 'ranch', junction: 'jn_c', rejoin: 'h10' },
    { key: 'bad',   junction: 'jn_d', rejoin: 'h1'  },
];
for (const { key, junction, rejoin } of LOBES) {
    G[junction] = { id: junction, isJunction: true, district: 'hub', next: [rejoin, key + '_0'] };
    for (let i = 0; i < 12; i++) {
        const id = `${key}_${i}`;
        // The Cinder Mine's mouth is the Gate — a rockslide. Because the Mine
        // holds one of the four Offices, this Gate is worth SCORE and not just
        // coins: while it is shut, only three Offices are in rotation.
        const type = (key === 'mine' && i === 0) ? 'gate'
                   : i === 2 ? 'shop'
                   : i === 6 ? 'plinth'
                   : null;
        G[id] = {
            id, type, district: key,
            shopDistrict: i === 2 ? key : undefined,
            next: [i === 11 ? rejoin : `${key}_${i + 1}`],
        };
    }
}

export const GRAPH = G;

// ---- Randomisable slots per region (type === null nodes) ----
//
// The red budget is 6 of 60 — exactly one per ten, the rule the City Circuit
// audit established because a punishing tile on a LAP map is a recurring tax
// rather than a one-off. Duels (3), magnets (5) and swaps (3) also echo City's
// tuned counts: those came out of a real audit and there is no reason to
// re-derive them for a board of the same size.
//
// NOTHING HERE MOVES A PLAYER ALONG THE TRACK. No shortcut, no launch, no
// pull-back. This is a lap map with a routing decision, and a tile that fires
// you past the rest of a road cancels a choice you already committed to.
export const POOLS = {
    // 9 slots: h2, h3, h4, h6, h7, h8, h9, h10, h12
    // The crossroads everybody uses, so it is the road where you MEET — and the
    // only pool outside Boot Hill carrying two reds. Twelve nodes that everyone
    // crosses constantly must not be filler.
    hub: [
        ...Array(2).fill('coin'),   ...Array(1).fill('coin_big'),
        ...Array(1).fill('duel'),   ...Array(1).fill('magnet'),
        ...Array(1).fill('mystery'),...Array(1).fill('boost'),
        ...Array(1).fill('trap'),   ...Array(1).fill('lose'),
    ],
    // 10 slots — machinery and momentum.
    rail: [
        ...Array(3).fill('mystery'), ...Array(2).fill('boost'),
        ...Array(2).fill('coin'),    ...Array(1).fill('coin_big'),
        ...Array(1).fill('duel'),    ...Array(1).fill('trap'),
    ],
    // 9 slots — behind the rockslide, and it pays for the roll it cost you.
    mine: [
        ...Array(3).fill('coin_big'), ...Array(2).fill('coin'),
        ...Array(1).fill('boost'),    ...Array(1).fill('mystery'),
        ...Array(1).fill('swap_space'), ...Array(1).fill('lose_big'),
    ],
    // 10 slots — the friendly road. ZERO red, the way the Promenade is.
    ranch: [
        ...Array(3).fill('coin'),    ...Array(2).fill('coin_big'),
        ...Array(2).fill('mystery'), ...Array(1).fill('truce'),
        ...Array(1).fill('boost'),   ...Array(1).fill('magnet'),
    ],
    // 10 slots — lawless. Nastiness that is positional rather than a coin tax.
    bad: [
        ...Array(3).fill('magnet'), ...Array(2).fill('swap_space'),
        ...Array(1).fill('duel'),   ...Array(1).fill('mystery'),
        ...Array(1).fill('coin'),   ...Array(1).fill('trap'),
        ...Array(1).fill('lose_big'),
    ],
};

// Flat lap order: camera curve, map slider, lap progress. Hub arc, then the
// lobe hanging off it, then the next hub arc — so the curve reads as a route
// somebody could actually walk.
export const ORDERED = [
    'h1', 'h2', 'h3',
    ...Array.from({ length: 12 }, (_, i) => 'rail_' + i),
    'h4', 'h5', 'h6',
    ...Array.from({ length: 12 }, (_, i) => 'mine_' + i),
    'h7', 'h8', 'h9',
    ...Array.from({ length: 12 }, (_, i) => 'ranch_' + i),
    'h10', 'h11', 'h12',
    ...Array.from({ length: 12 }, (_, i) => 'bad_' + i),
];

// Bot routing preference per road. The Mine pays best but costs a gate roll;
// Boot Hill is where you get robbed. Phase 3 adds the Star term on top, which
// will outweigh all of these.
export const BOT_BIAS = { mine: 2, ranch: 1, rail: 1, hub: 1, bad: -1 };

// ---- Layout ----
// Hub ring r22 (12 nodes -> 11.4 u/step), lobes r20 (12 nodes -> 10.4 u/step),
// 10 units of clearance between them, and the whole plate turned -15 degrees so
// the four lobes land on the axes and it reads as a clover rather than as a
// tilted accident. Board radius 72; City Circuit's is 58.
export const LAYOUT = {
    kind: 'clover',
    hubRadius: 22, lobeRadius: 20, lobeGap: 10, rotDeg: -15,
    hub: Array.from({ length: 12 }, (_, i) => 'h' + (i + 1)),
    // junction id -> which hub node it sits just past
    junctionAfter: { jn_a: 3, jn_b: 6, jn_c: 9, jn_d: 12 },
    lobes: LOBES.map(l => ({
        key: l.key, after: { jn_a: 3, jn_b: 6, jn_c: 9, jn_d: 12 }[l.junction],
        ids: Array.from({ length: 12 }, (_, i) => `${l.key}_${i}`),
    })),
};

export default {
    id:      'star_territory',
    kind:    'graph',
    start:   'h1',
    graph:   G,
    pools:   POOLS,
    ordered: ORDERED,
    junctions: JUNCTIONS,
    branches:  BRANCHES,
    hubKey:      'hub',
    regionKeys:  REGION_KEYS,
    regionNames: REGION_NAMES,
    botBias: BOT_BIAS,
    layout:  LAYOUT,
    gateNode: 'mine_0',
    gateThreshold: 15,
    mapLabels: { title: 'THE TERRITORY', start: 'PERDITION', middle: 'TERRITORIES', end: 'BACK TO TOWN' },
    features: {
        bounties:      true,
        buddies:       true,
        duels:         true,
        gate:          true,
        // The Offices replace the District HQ and the full-circuit bonus. Two
        // competing "go round and collect the landmarks" systems would blunt
        // each other, and the Star is the one that should win.
        hqBonus:       false,
        circuitBonus:  false,
        stars:         true,
        roundLimit:    true,
        finishBonus:   false,
        realms:        false,
        routeChoice:   true,
    },
};
