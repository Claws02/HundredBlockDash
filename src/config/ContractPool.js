// ============================================================
// BOUNTY POOL — the shuffled deck of City Bounties
//
// (The code still says "contract" throughout — that was the internal name
// before these became BOUNTIES on screen. The identifiers are load-bearing in
// the QA harness; only the player-facing copy changed.)
//
// Each bounty: { id, icon, desc, reward, type, param, hint }
//   desc — what the player must do, in the fewest words that fit a pill
//   hint — how to actually go about it, shown in the bounty panel
//
// Every `type` below MUST have a matching checkContract() emitter in the game
// code, or the bounty is undealable-but-drawable and permanently clogs a
// slot — that is QA-001, and qa/verify.js fails loudly if it comes back.
// Emitters live in GameController (movement/spaces/shops/HQs/gate/items/allies),
// Economy (block_space) and the minigame result handler.
// ============================================================

// Bounty types whose `param` is a target COUNT rather than a value to match.
// Progress for these is tracked per player in `contract._prog[playerId]`.
// Lives here (not in Contracts.js) so the UI can read it without creating a
// UIManager ⇄ Contracts import cycle.
export const COUNTED_TYPES = new Set([
    'land_coin', 'land_coin_big', 'visit_shops', 'earn_coins_round', 'win_minigames',
    'buy_item', 'visit_hq_any',
    // Star Territory
    'buy_star', 'hold_shards',
]);

// ============================================================
// WHICH BOARD A BOUNTY IS VALID ON
// ============================================================
// About half of these cards name City's district keys — `fin`, `ba`, `shop`,
// `ind` — or its District HQs, and those cannot be dealt on a board that has no
// such regions. Before this they could be: the pool was one flat list, so a
// second graph board would have dealt "Reach the Financial HQ" onto a map with
// no Financial District, and the card would have clogged a slot for the whole
// match with no way to claim it. That is QA-001 with a different cause.
//
// A card with no `maps` is MAP-AGNOSTIC and deals anywhere — coins, shops,
// minigames, duels, items, the Gate. Fifteen of the thirty-one are, and they
// carry over free.
export function validOn(card, mapId) {
    return !card.maps || card.maps.includes(mapId);
}

// Some agnostic cards give directions that are true on one board and wrong on
// another ("Back Alley has three of them"). The card stays shared; only the
// line of advice is swapped. Keyed by card id, then map id.
const HINT_OVERRIDES = {
    star_territory: {
        c05: 'Perdition and the Longhorn Ranch are thick with them.',
        c06: 'The Cinder Mine has three big seams — but the Gate is in the way.',
        c18: 'Boot Hill has three of them, and the hub has one.',
        c19: 'The Railyard has two, the Mine and the Ranch one each.',
        c20: 'Boot Hill and the Mine. Best used when you are behind.',
        c21: 'One on the Longhorn Ranch. Pays you both.',
        c27: 'The Railyard is full of them — free items before the Office.',
        c28: 'Perdition, the Railyard and Boot Hill have one each.',
        c16: 'Sold at the territory outfitters — every lobe has one.',
        c22: 'The Perdition general stores carry the full rack.',
        c24: 'Roll 15 or more at the rockslide. It opens a fourth Office.',
    },
};

export function hintFor(card, mapId) {
    return HINT_OVERRIDES[mapId]?.[card.id] || card.hint;
}

export const CONTRACT_POOL = [
    // ---- District travel -------------------------------------------------
    { id: 'c01', icon: '💹', desc: 'Reach the Financial HQ',        reward: 20, type: 'visit_hq',       param: 'fin',  hint: 'Take the Financial District at junction A — passing the HQ counts.', maps: ['city_circuit'] },
    { id: 'c02', icon: '🏚️', desc: 'Reach the Back Alley HQ',       reward: 18, type: 'visit_hq',       param: 'ba',   hint: 'Take the Back Alley at junction B and ride it to the far end.', maps: ['city_circuit'] },
    { id: 'c03', icon: '🛍️', desc: 'Reach the Grand Mall',          reward: 18, type: 'visit_hq',       param: 'shop', hint: 'The Promenade at junction C ends at the Mall — half-price shopping.', maps: ['city_circuit'] },
    { id: 'c04', icon: '⚙️',  desc: 'Reach the Industrial HQ',       reward: 22, type: 'visit_hq',       param: 'ind',  hint: 'The Gate has to be open first. Junction D, then all the way through.', maps: ['city_circuit'] },
    { id: 'c09', icon: '🗺️',  desc: 'Enter the Financial District',  reward: 12, type: 'enter_district', param: 'fin',  hint: 'Just take that path at the junction — one step in is enough.', maps: ['city_circuit'] },
    { id: 'c10', icon: '🗺️',  desc: 'Enter the Back Alley',         reward: 12, type: 'enter_district', param: 'ba',   hint: 'Just take that path at the junction — one step in is enough.', maps: ['city_circuit'] },
    { id: 'c11', icon: '🗺️',  desc: 'Enter the Shopping Promenade', reward: 12, type: 'enter_district', param: 'shop', hint: 'Just take that path at the junction — one step in is enough.', maps: ['city_circuit'] },
    { id: 'c12', icon: '🗺️',  desc: 'Enter the Industrial Zone',    reward: 14, type: 'enter_district', param: 'ind',  hint: 'Needs the Gate open. Break it with a 20+ roll first.', maps: ['city_circuit'] },
    { id: 'c15', icon: '🔄',  desc: 'Complete a full circuit',       reward: 22, type: 'complete_circuit', param: null, hint: 'Get all the way back round to the start line.', maps: ['city_circuit'] },
    { id: 'c26', icon: '🏛️',  desc: 'Reach 2 different District HQs', reward: 26, type: 'visit_hq_any',  param: 2,     hint: 'Two districts, two laps — the biggest payout on the board.', maps: ['city_circuit'] },

    // ---- Spaces ----------------------------------------------------------
    { id: 'c05', icon: '🪙',  desc: 'Land on 3 coin spaces',         reward: 15, type: 'land_coin',      param: 3,     hint: 'The Ring Road is thick with them.' },
    { id: 'c06', icon: '💰',  desc: 'Land on 2 big-coin spaces',     reward: 14, type: 'land_coin_big',  param: 2,     hint: 'The Financial District is stacked with big-coin tiles.' },
    { id: 'c18', icon: '🧲',  desc: 'Land on a Magnet space',       reward: 13, type: 'land_type',      param: 'magnet',     hint: 'Back Alley has three of them.' },
    { id: 'c19', icon: '⚡',  desc: 'Land on a Boost space',        reward: 11, type: 'land_type',      param: 'boost',      hint: 'Ring Road and the Industrial Zone. A free extra roll on top.' },
    { id: 'c20', icon: '🔀',  desc: 'Land on a Swap space',         reward: 14, type: 'land_type',      param: 'swap_space', hint: 'Back Alley mostly. Best used when you are behind.' },
    { id: 'c21', icon: '🕊️',  desc: 'Land on a Truce space',        reward: 12, type: 'land_type',      param: 'truce',      hint: 'One on the Ring Road. Pays you both.' },
    { id: 'c27', icon: '❓',  desc: 'Land on a Mystery space',      reward: 12, type: 'land_type',      param: 'mystery',    hint: 'The Promenade is full of them — free items.' },
    { id: 'c17', icon: '🛡️',  desc: 'Block a negative space',       reward: 12, type: 'block_space',    param: null,  hint: 'Carry a Shield and walk into a fine on purpose.' },

    // ---- Fights ----------------------------------------------------------
    { id: 'c07', icon: '🏆',  desc: 'Win the next minigame',         reward: 12, type: 'win_minigame',   param: null,  hint: 'One good round is all this asks for.' },
    { id: 'c08', icon: '🏆',  desc: 'Win 2 minigames in a row',      reward: 20, type: 'win_minigames',  param: 2,     hint: 'Back-to-back. A loss resets the streak.' },
    { id: 'c13', icon: '⚔️',  desc: 'Win a Duel',                   reward: 16, type: 'duel_win',       param: null,  hint: 'Land on a Duel tile and take the bet.' },
    { id: 'c28', icon: '⚔️',  desc: 'Land on a Duel space',         reward: 11, type: 'land_type',      param: 'duel',       hint: 'Every district has one. You do not have to win it.' },
    { id: 'c14', icon: '🤝',  desc: 'Claim a Buddy',               reward: 14, type: 'claim_ally',     param: null,  hint: 'Buddies appear on the board — land on one and beat the minigame.' },
    { id: 'c29', icon: '🥷',  desc: 'Steal a Buddy from your rival', reward: 20, type: 'steal_ally',     param: null,  hint: 'Pass or land on a rival who is holding one, then win the minigame.' },
    { id: 'c24', icon: '🔒',  desc: 'Break through the Gate',       reward: 18, type: 'open_gate',      param: null,  hint: 'Roll 20 or more at the Gate. Double Die helps.' },

    // ---- Economy ---------------------------------------------------------
    { id: 'c16', icon: '🛸',  desc: 'Use a Rocket item',            reward: 13, type: 'use_item',       param: 'rocket',     hint: 'Sold at the Power Plant in the Industrial Zone.' },
    { id: 'c22', icon: '🎯',  desc: 'Use a Custom Dice item',       reward: 12, type: 'use_item',       param: 'custom_dice', hint: 'Financial, Industrial, or any full shop.' },
    { id: 'c23', icon: '🏪',  desc: 'Visit 2 shops in one round',   reward: 16, type: 'visit_shops',    param: 2,     hint: 'Walking past a shop counts if you stop in.' },
    { id: 'c30', icon: '🛒',  desc: 'Buy 2 items',                  reward: 15, type: 'buy_item',       param: 2,     hint: 'Any two purchases, any two shops.' },
    { id: 'c25', icon: '💸',  desc: 'Earn 20 coins in one round',   reward: 15, type: 'earn_coins_round', param: 20,  hint: 'HQ payouts and big-coin tiles get you there fastest.' },
    { id: 'c31', icon: '💎',  desc: 'Earn 35 coins in one round',   reward: 24, type: 'earn_coins_round', param: 35,  hint: 'A ride with a big-coin stretch in the middle of it.' },

    // ---- Star Territory ---------------------------------------------------
    //
    // The Wild West twins of the ten City-specific cards above, plus three that
    // only this board can ask for. EVERY ONE HAS A LIVE EMITTER — `buy_star` and
    // `visit_plinth` fire from the purchase handler and the Office pass-through,
    // `hold_shards` from the shard grant — because a data row with no code path
    // is exactly what qa/verify.js exists to catch.
    { id: 'w01', icon: '⭐', desc: 'Pin on a Sheriff\u2019s Star',  reward: 30, type: 'buy_star',       param: 1,      maps: ['star_territory'], hint: 'Ride to the Office holding the Star and post the bond. Passing it is enough.' },
    { id: 'w02', icon: '🌟', desc: 'Pin on two Stars',              reward: 55, type: 'buy_star',       param: 2,      maps: ['star_territory'], hint: 'The second costs 25. The dispatch sends it as far from you as the board allows.' },
    { id: 'w03', icon: '✨', desc: 'Hold 3 Star Shards at once',    reward: 18, type: 'hold_shards',    param: 3,      maps: ['star_territory'], hint: 'Win round minigames and duels. The fourth redeems them, so claim this on the third.' },
    { id: 'w04', icon: '🏛️', desc: 'Reach a Territory Office',      reward: 14, type: 'visit_plinth',   param: null,   maps: ['star_territory'], hint: 'Any of the four, holding a Star or not. Node 6 of any territory.' },
    { id: 'w05', icon: '🚂', desc: 'Ride into the Ironwood Railyard', reward: 12, type: 'enter_district', param: 'rail',  maps: ['star_territory'], hint: 'Take the territory road at the first junction — one step in is enough.' },
    { id: 'w06', icon: '⛏️', desc: 'Ride into the Cinder Mine',     reward: 14, type: 'enter_district', param: 'mine',  maps: ['star_territory'], hint: 'Needs the rockslide broken. Roll 15+ at the Gate first.' },
    { id: 'w07', icon: '🐎', desc: 'Ride into the Longhorn Ranch',  reward: 12, type: 'enter_district', param: 'ranch', maps: ['star_territory'], hint: 'The safe road — twelve spaces and not one of them red.' },
    { id: 'w08', icon: '🏜️', desc: 'Ride into Boot Hill',           reward: 13, type: 'enter_district', param: 'bad',   maps: ['star_territory'], hint: 'High noon, three magnets and two swaps. Bring something to lose.' },
];

/**
 * The deck for ONE board, shuffled.
 *
 * `mapId` is required in practice — omitting it deals the whole pool, which is
 * only ever right for the probe that walks every card.
 */
export function getShuffledPool(mapId) {
    const pool = CONTRACT_POOL
        .filter(c => !mapId || validOn(c, mapId))
        .map(c => (mapId ? { ...c, hint: hintFor(c, mapId) } : c));
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
}
