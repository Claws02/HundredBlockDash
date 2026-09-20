// ============================================================
// STAR TERRITORY — the map module.
//
// The third board, specced in docs/STAR_TERRITORY_SPEC.md. A Wild West lap map
// where COINS ARE NOT THE SCORE: you spend them on Sheriff's Stars at the four
// Territory Offices, and the player wearing the most Stars when the judge
// arrives takes the badge.
//
// THE CLOVER
//
// 12-node hub ring (Perdition) with four 12-node territory lobes hanging off
// four invisible junctions. 60 playable nodes, the same budget as City Circuit,
// plus the 4 junctions = 64 graph nodes.
//
// The one real difference from City Circuit is what a branch MEANS. A City
// district is a PARALLEL ROUTE — taking it still carries you round the ring, so
// the two roads out of a junction are two ways of covering the same ground. A
// Territory is a DETOUR: it leaves at its junction, runs twelve spaces out and
// back, and rejoins the ring at exactly the node the ring branch reached in one
// step. You are spending twelve turns' worth of board to go and get something,
// not routing through it — which is what makes the Star at the far end of it
// worth going for rather than free.
//
//     Junction   ring option   territory option              rejoins at
//     jn_a       h4            rail_0  🚂 Ironwood Railyard   h4
//     jn_b       h7            mine_0  ⛏️ Cinder Mine 🔒      h7
//     jn_c       h10           ranch_0 🐎 Longhorn Ranch      h10
//     jn_d       h1            bad_0   🏜️ Boot Hill Badlands  h1
//
// WHERE THIS DIFFERS FROM THE SPEC, AND WHY
//
// §2.2 of the spec carries two sets of distances that cannot both be true of
// the same board. Walking the real directed graph:
//
//     lobe size        spec says 12 nodes (4×12 + 12 hub = the stated 60)
//     office→office    15 / 18 / 21 — EXACT with 12-node lobes
//     lap + 1 lobe     spec says 23 ("11 extra spaces"); really 24
//     lap + all four   spec says 56; really 60
//
// The office-to-office figures are the ones §4.5's whole balance model is built
// on, and they only come out at 15/18/21 with twelve-node lobes. The lap
// figures were computed against an eleven-node draft that the node budget
// rules out. Twelve wins; the lap table is off by one per lobe and
// docs/STAR_TERRITORY_SPEC.md has been corrected to match this file.
// qa/star.js walks the graph and asserts all of it rather than trusting either.
// ============================================================

export const JUNCTIONS = new Set(['jn_a', 'jn_b', 'jn_c', 'jn_d']);

export const REGION_NAMES = {
    hub:   'Perdition',
    rail:  'Ironwood Railyard',
    mine:  'Cinder Mine',
    ranch: 'Longhorn Ranch',
    bad:   'Boot Hill Badlands',
};

// The four TERRITORIES. Perdition is the hub and is deliberately not one of
// them — it is the road everybody is always on, the way City's ring road is.
export const REGION_KEYS = ['rail', 'mine', 'ranch', 'bad'];

// ---- Branch options shown on the on-board arrows ----------------------------
// `spaces` is what the road actually costs: 1 for staying on the ring (the
// junction feeds straight into the rejoin node), 13 for the detour (twelve lobe
// nodes plus the step back onto the ring). Naming the real number is the point
// — a player choosing a territory is choosing to spend twelve extra spaces and
// should be told so before they commit.
export const BRANCHES = {
    jn_a: [
        { nodeId: 'h4',      label: 'Perdition Road',      short: 'RIDE ON',   desc: 'Stay on the ring · 1 space',    icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'rail_0',  label: 'Ironwood Railyard',   short: 'RAILYARD',  desc: 'Office + outfitter · 13 spaces', icon: '🚂', district: 'rail',  spaces: 13 },
    ],
    jn_b: [
        { nodeId: 'h7',      label: 'Perdition Road',      short: 'RIDE ON',   desc: 'Stay on the ring · 1 space',    icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'mine_0',  label: 'Cinder Mine',         short: 'THE MINE',  desc: 'Behind the rockslide 🔒',        icon: '⛏️', district: 'mine',  spaces: 13 },
    ],
    jn_c: [
        { nodeId: 'h10',     label: 'Perdition Road',      short: 'RIDE ON',   desc: 'Stay on the ring · 1 space',    icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'ranch_0', label: 'Longhorn Ranch',      short: 'THE RANCH', desc: 'The safe road · 13 spaces',     icon: '🐎', district: 'ranch', spaces: 13 },
    ],
    jn_d: [
        { nodeId: 'h1',      label: 'Perdition Road',      short: 'RIDE ON',   desc: 'Stay on the ring · 1 space',    icon: '🤠', district: 'hub',   spaces: 1  },
        { nodeId: 'bad_0',   label: 'Boot Hill Badlands',  short: 'BOOT HILL', desc: 'Magnets, swaps & graves',       icon: '🏜️', district: 'bad',   spaces: 13 },
    ],
};

const G = {};

// ---- The four junctions (invisible; nobody ever lands on one) ----
G.jn_a = { id: 'jn_a', isJunction: true, district: 'hub', next: ['h4',  'rail_0']  };
G.jn_b = { id: 'jn_b', isJunction: true, district: 'hub', next: ['h7',  'mine_0']  };
G.jn_c = { id: 'jn_c', isJunction: true, district: 'hub', next: ['h10', 'ranch_0'] };
G.jn_d = { id: 'jn_d', isJunction: true, district: 'hub', next: ['h1',  'bad_0']   };

// ---- Perdition, the hub ring — h1 … h12 ----
// h1 is START (the Marshal's Office steps). h5 and h11 are the two general
// stores. The junctions sit BETWEEN h3/h4, h6/h7, h9/h10 and h12/h1.
G.h1  = { id: 'h1',  type: 'start', district: 'hub', next: ['h2']   };
G.h2  = { id: 'h2',  type: null,    district: 'hub', next: ['h3']   };
G.h3  = { id: 'h3',  type: null,    district: 'hub', next: ['jn_a'] };
G.h4  = { id: 'h4',  type: null,    district: 'hub', next: ['h5']   };
G.h5  = { id: 'h5',  type: 'shop',  district: 'hub', shopDistrict: 'hub', next: ['h6'] };
G.h6  = { id: 'h6',  type: null,    district: 'hub', next: ['jn_b'] };
G.h7  = { id: 'h7',  type: null,    district: 'hub', next: ['h8']   };
G.h8  = { id: 'h8',  type: null,    district: 'hub', next: ['h9']   };
G.h9  = { id: 'h9',  type: null,    district: 'hub', next: ['jn_c'] };
G.h10 = { id: 'h10', type: null,    district: 'hub', next: ['h11']  };
G.h11 = { id: 'h11', type: 'shop',  district: 'hub', shopDistrict: 'hub', next: ['h12'] };
G.h12 = { id: 'h12', type: null,    district: 'hub', next: ['jn_d'] };

// ---- The four lobes ----
//
// THE SHOP SITS AT NODE 2 AND THE OFFICE AT NODE 6, DELIBERATELY. You walk past
// the outfitter BEFORE you reach the Office, so "spend it on an item or save it
// for the Star" is a live question at the moment you have to answer it. That
// tension does not exist on either other board.
//
// `_buildLobe` writes twelve nodes and the step back onto the ring, so the four
// territories cannot quietly differ in length — which is exactly how the spec's
// two distance tables came to disagree.
function _buildLobe(key, rejoinId, { shopAt = 2, plinthAt = 6, gateAt = -1 } = {}) {
    for (let i = 0; i < 12; i++) {
        const id   = `${key}_${i}`;
        const next = i === 11 ? rejoinId : `${key}_${i + 1}`;
        let type = null;
        if (i === gateAt)        type = 'gate';
        else if (i === shopAt)   type = 'shop';
        else if (i === plinthAt) type = 'plinth';
        G[id] = { id, type, district: key, next: [next] };
        if (type === 'shop')   G[id].shopDistrict = key;
        if (type === 'plinth') G[id].isPlinth = true;
    }
}

_buildLobe('rail',  'h4');                   // 🚂 dawn, steam and low sun
_buildLobe('mine',  'h7',  { gateAt: 0 });   // ⛏️ behind the rockslide
_buildLobe('ranch', 'h10');                  // 🐎 golden hour
_buildLobe('bad',   'h1');                   // 🏜️ high noon

export const GRAPH = G;

// ---- Randomisable slots per territory (type === null nodes) ----
//
// 48 random slots over 60 nodes, the same budget City Circuit runs.
//
// SIX RED SPACES — exactly one per ten, the rule docs/THIRD_MAP_DESIGN.md §5
// states and the City audit paid for. And NOTHING HERE MOVES A PLAYER ALONG THE
// TRACK: no shortcut, no cfwd, no cbwd. This is a lap map, the detour you chose
// is the whole decision, and a tile that fires you eleven nodes down the road
// cancels a choice you already committed twelve spaces to. Movement comes from
// the die, from BOOST (a real extra roll) and from items you bought.
export const POOLS = {
    // PERDITION IS NOT THE SAFE LAP.
    //
    // Twelve nodes everybody crosses constantly, so it is where you meet your
    // rival — and it is the only pool outside Boot Hill carrying two reds, plus
    // a duel and a magnet. The Ranch is the safe road, and it is a twelve-space
    // detour to reach it.
    // 9 slots: h2, h3, h4, h6, h7, h8, h9, h10, h12
    hub: [
        ...Array(2).fill('coin'),    ...Array(1).fill('coin_big'),
        ...Array(1).fill('duel'),    ...Array(1).fill('magnet'),
        ...Array(1).fill('mystery'), ...Array(1).fill('boost'),
        ...Array(1).fill('trap'),    ...Array(1).fill('lose'),
    ],
    // 10 slots: rail_0, rail_1, rail_3..rail_5, rail_7..rail_11
    // Dawn on the yard: the road that pays in things rather than coins.
    rail: [
        ...Array(2).fill('boost'), ...Array(3).fill('mystery'),
        ...Array(2).fill('coin'),  ...Array(1).fill('coin_big'),
        ...Array(1).fill('duel'),  ...Array(1).fill('trap'),
    ],
    // 9 slots: mine_1, mine_3..mine_5, mine_7..mine_11
    // You spent a Gate roll to get in here, so it pays. Three big coins is the
    // richest stretch on the board and the reason the rockslide is worth 5d6.
    mine: [
        ...Array(3).fill('coin_big'), ...Array(2).fill('coin'),
        ...Array(1).fill('boost'),    ...Array(1).fill('mystery'),
        ...Array(1).fill('swap_space'),
        ...Array(1).fill('lose_big'),
    ],
    // 10 slots: ranch_0, ranch_1, ranch_3..ranch_5, ranch_7..ranch_11
    // ZERO RED. The Ranch is the road you take when you are ahead and want to
    // stay that way, and it is the longest way round to anywhere.
    ranch: [
        ...Array(3).fill('coin'),    ...Array(2).fill('coin_big'),
        ...Array(2).fill('mystery'), ...Array(1).fill('truce'),
        ...Array(1).fill('boost'),   ...Array(1).fill('magnet'),
    ],
    // 10 slots: bad_0, bad_1, bad_3..bad_5, bad_7..bad_11
    // High noon with nothing to hide behind: three magnets and two swaps make
    // Boot Hill the road where position and coins both stop being yours.
    bad: [
        ...Array(1).fill('duel'),    ...Array(3).fill('magnet'),
        ...Array(2).fill('swap_space'), ...Array(1).fill('mystery'),
        ...Array(1).fill('coin'),
        ...Array(1).fill('trap'),    ...Array(1).fill('lose_big'),
    ],
};

// BOARD TOTALS, counted rather than claimed:
//   10 coin · 7 coin_big · 8 mystery · 5 magnet · 5 boost · 3 swap_space
//   3 duel · 1 truce · 6 red (3 trap, 1 lose, 2 lose_big) = 48
// The echoes of City's tuned numbers — 6 red, 3 duels, 5 magnets — are
// deliberate. They came out of a real audit; there is no reason to re-derive
// them for a board of the same size.

// ---- The lap order: camera curve, map slider, lap progress ----
// The long way round — through every territory — because this list has to be a
// continuous path for the camera curve to interpolate along, and the hub-only
// lap is a subset of it rather than the other way round.
export const ORDERED = [
    'h1', 'h2', 'h3',
    'rail_0','rail_1','rail_2','rail_3','rail_4','rail_5','rail_6','rail_7','rail_8','rail_9','rail_10','rail_11',
    'h4', 'h5', 'h6',
    'mine_0','mine_1','mine_2','mine_3','mine_4','mine_5','mine_6','mine_7','mine_8','mine_9','mine_10','mine_11',
    'h7', 'h8', 'h9',
    'ranch_0','ranch_1','ranch_2','ranch_3','ranch_4','ranch_5','ranch_6','ranch_7','ranch_8','ranch_9','ranch_10','ranch_11',
    'h10', 'h11', 'h12',
    'bad_0','bad_1','bad_2','bad_3','bad_4','bad_5','bad_6','bad_7','bad_8','bad_9','bad_10','bad_11',
];

// ------------------------------------------------------------
// Bot routing bias.
//
// Lower than City's across the board, because on THIS map the bot's real reason
// to leave the ring is the Star — Bot._branchScore() adds +9 when the live
// Office is down a road it can afford. These are the tie-breakers for when it
// is not: the Mine pays best, the Ranch is safe, Boot Hill is where you go to
// take something off somebody.
// ------------------------------------------------------------
export const BOT_BIAS = { mine: 2, ranch: 1, rail: 1, hub: 1, bad: 0 };

// ------------------------------------------------------------
// THE LAYOUT — a clover, not a bullseye and not four teardrops.
//
// The first draft of the spec drew each territory as a teardrop leaving and
// rejoining the ring. Laying the nodes out numerically killed it: the two sides
// of a teardrop run 2–6 units apart at every parameter setting tried, against a
// 16×13 tile — the roads overlap and the board reads as a tangle.
//
// A lobe that is a plain CIRCLE tangent to the ring has no such neck, and its
// node spacing is uniform by construction:
//
//     hub step   2·22·sin(15°) = 11.39 u
//     lobe step  2·20·sin(15°) = 10.35 u
//     lobe inner extremity     52 − 20 = 32, a clear 10 u outside the hub ring
//     board radius             52 + 20 = 72   (City Circuit's is 58)
//
// The closest NON-adjacent pair on the whole board is rail_0/rail_11 at 10.35 u
// — a full step apart, so nothing crowds. qa/star.js measures all of this off
// the real positions rather than trusting the arithmetic in this comment.
// ------------------------------------------------------------
export const LAYOUT = {
    kind: 'clover',
    HUB_R:  22,     // the hub ring
    LOBE_C: 52,     // how far out a lobe's centre sits, along its junction's angle
    LOBE_R: 20,     // the lobe circle itself

    // h1 at the top, running the same way round as City's ring road.
    hub: { startDeg: 90, stepDeg: -30,
           ids: ['h1','h2','h3','h4','h5','h6','h7','h8','h9','h10','h11','h12'] },

    // Each junction sits on the hub ring halfway between the two hub nodes it
    // separates, and its lobe's centre is straight out along that same angle.
    junctions: { jn_a: 15, jn_b: -75, jn_c: -165, jn_d: 105 },

    // Node i of a lobe sits at (junctionAngle + 165° − i·30°) around the lobe
    // centre. i=0 and i=11 land either side of the inner extremity, nearest the
    // ring; the sweep carries the road out round the far side, which is where
    // the Office at i=6 ends up.
    lobeStartDeg: 165,
    lobeStepDeg:  -30,
    lobes: [
        { key: 'rail',  jn: 'jn_a', ids: ['rail_0','rail_1','rail_2','rail_3','rail_4','rail_5','rail_6','rail_7','rail_8','rail_9','rail_10','rail_11'] },
        { key: 'mine',  jn: 'jn_b', ids: ['mine_0','mine_1','mine_2','mine_3','mine_4','mine_5','mine_6','mine_7','mine_8','mine_9','mine_10','mine_11'] },
        { key: 'ranch', jn: 'jn_c', ids: ['ranch_0','ranch_1','ranch_2','ranch_3','ranch_4','ranch_5','ranch_6','ranch_7','ranch_8','ranch_9','ranch_10','ranch_11'] },
        { key: 'bad',   jn: 'jn_d', ids: ['bad_0','bad_1','bad_2','bad_3','bad_4','bad_5','bad_6','bad_7','bad_8','bad_9','bad_10','bad_11'] },
    ],

    // The faint guide tubes under the board, one run per road. Declared rather
    // than derived: a run is a smoothed curve through a sequence, and deriving
    // "which nodes belong to one road" from the graph gets the shared hub
    // stretches wrong in both directions.
    roads: [
        { district: 'hub',   nodes: ['jn_d','h1','h2','h3','jn_a'] },
        { district: 'hub',   nodes: ['jn_a','h4','h5','h6','jn_b'] },
        { district: 'hub',   nodes: ['jn_b','h7','h8','h9','jn_c'] },
        { district: 'hub',   nodes: ['jn_c','h10','h11','h12','jn_d'] },
        { district: 'rail',  nodes: ['jn_a','rail_0','rail_1','rail_2','rail_3','rail_4','rail_5','rail_6','rail_7','rail_8','rail_9','rail_10','rail_11','h4'] },
        { district: 'mine',  nodes: ['jn_b','mine_0','mine_1','mine_2','mine_3','mine_4','mine_5','mine_6','mine_7','mine_8','mine_9','mine_10','mine_11','h7'] },
        { district: 'ranch', nodes: ['jn_c','ranch_0','ranch_1','ranch_2','ranch_3','ranch_4','ranch_5','ranch_6','ranch_7','ranch_8','ranch_9','ranch_10','ranch_11','h10'] },
        { district: 'bad',   nodes: ['jn_d','bad_0','bad_1','bad_2','bad_3','bad_4','bad_5','bad_6','bad_7','bad_8','bad_9','bad_10','bad_11','h1'] },
    ],
};

// ------------------------------------------------------------
// THE STAR
//
// Constants live on the map because they ARE the map: a board without Offices
// has no use for them, and src/core/Stars.js reads them through ActiveMap
// rather than importing this file.
// ------------------------------------------------------------
export const STARS = {
    priceBase:     20,   // the first Star
    priceStep:     5,    // +5 per Star already held → 20 / 25 / 30 / 35
    shardsPerStar: 4,    // an open tuning knob — see spec §4.5. Measure, do not feel.
    plinths:       ['rail_6', 'mine_6', 'ranch_6', 'bad_6'],
    // The Mine's Office is behind the Gate. While the rockslide holds, only
    // three Offices are in rotation and the Star can never be dispatched there
    // — which is what makes this Gate worth SCORE rather than only coins.
    lockedBehindGate: ['mine_6'],
};

export default {
    id:      'star_territory',
    kind:    'graph',
    start:   'h1',
    graph:   G,
    pools:   POOLS,
    ordered: ORDERED,
    junctions:   JUNCTIONS,
    branches:    BRANCHES,
    regionKeys:  REGION_KEYS,
    regionNames: REGION_NAMES,
    // The road everybody is always on. City calls it the ring; this board calls
    // it Perdition. Every "is this the hub or a district?" test asks the map
    // rather than comparing against the literal 'ring'.
    hub:     'hub',
    botBias: BOT_BIAS,
    layout:  LAYOUT,
    gateNode: 'mine_0',
    gateThreshold: 15,
    stars:   STARS,
    features: {
        bounties:      true,
        buddies:       true,
        duels:         true,
        gate:          true,
        // THE OFFICES REPLACE THE HQs, ON PURPOSE. Two competing "go round and
        // collect the landmarks" systems would blunt each other, and the Star is
        // the one the board is built for. Region-visit TRACKING stays, because
        // the bounties read it.
        hqBonus:       false,
        circuitBonus:  false,
        stars:         true,
        roundLimit:    true,
        finishBonus:   false,
        realms:        false,
        routeChoice:   true,
    },

    // Most Stars. Tiebreak coins, then hub laps completed.
    //
    // Returned as a chain rather than a single number because coins are NOT
    // worth a fraction of a Star — a player on 2 Stars and 3 coins beats one on
    // 1 Star and 300, and folding that into one figure means inventing an
    // exchange rate the game never states.
    score(p) {
        return { value: p.stars || 0, tiebreak: [p.coins, p.fullCircuitsCompleted || 0] };
    },
};
