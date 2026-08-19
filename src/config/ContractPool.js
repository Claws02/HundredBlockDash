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
]);

export const CONTRACT_POOL = [
    // ---- District travel -------------------------------------------------
    { id: 'c01', icon: '💹', desc: 'Reach the Financial HQ',        reward: 20, type: 'visit_hq',       param: 'fin',  hint: 'Take the Financial District at junction A — passing the HQ counts.' },
    { id: 'c02', icon: '🏚️', desc: 'Reach the Back Alley HQ',       reward: 18, type: 'visit_hq',       param: 'ba',   hint: 'Take the Back Alley at junction B and ride it to the far end.' },
    { id: 'c03', icon: '🛍️', desc: 'Reach the Grand Mall',          reward: 18, type: 'visit_hq',       param: 'shop', hint: 'The Promenade at junction C ends at the Mall — half-price shopping.' },
    { id: 'c04', icon: '⚙️',  desc: 'Reach the Industrial HQ',       reward: 22, type: 'visit_hq',       param: 'ind',  hint: 'The Gate has to be open first. Junction D, then all the way through.' },
    { id: 'c09', icon: '🗺️',  desc: 'Enter the Financial District',  reward: 12, type: 'enter_district', param: 'fin',  hint: 'Just take that path at the junction — one step in is enough.' },
    { id: 'c10', icon: '🗺️',  desc: 'Enter the Back Alley',         reward: 12, type: 'enter_district', param: 'ba',   hint: 'Just take that path at the junction — one step in is enough.' },
    { id: 'c11', icon: '🗺️',  desc: 'Enter the Shopping Promenade', reward: 12, type: 'enter_district', param: 'shop', hint: 'Just take that path at the junction — one step in is enough.' },
    { id: 'c12', icon: '🗺️',  desc: 'Enter the Industrial Zone',    reward: 14, type: 'enter_district', param: 'ind',  hint: 'Needs the Gate open. Break it with a 20+ roll first.' },
    { id: 'c15', icon: '🔄',  desc: 'Complete a full circuit',       reward: 22, type: 'complete_circuit', param: null, hint: 'Get all the way back round to the start line.' },
    { id: 'c26', icon: '🏛️',  desc: 'Reach 2 different District HQs', reward: 26, type: 'visit_hq_any',  param: 2,     hint: 'Two districts, two laps — the biggest payout on the board.' },

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
    { id: 'c14', icon: '🤝',  desc: 'Claim an Ally',                reward: 14, type: 'claim_ally',     param: null,  hint: 'Allies appear on the board — land on one and beat the minigame.' },
    { id: 'c29', icon: '🥷',  desc: 'Steal an Ally from your rival', reward: 20, type: 'steal_ally',     param: null,  hint: 'Land on the same space as an opponent who has one.' },
    { id: 'c24', icon: '🔒',  desc: 'Break through the Gate',       reward: 18, type: 'open_gate',      param: null,  hint: 'Roll 20 or more at the Gate. Double Die helps.' },

    // ---- Economy ---------------------------------------------------------
    { id: 'c16', icon: '🛸',  desc: 'Use a Rocket item',            reward: 13, type: 'use_item',       param: 'rocket',     hint: 'Sold at the Power Plant in the Industrial Zone.' },
    { id: 'c22', icon: '🎯',  desc: 'Use a Custom Dice item',       reward: 12, type: 'use_item',       param: 'custom_dice', hint: 'Financial, Industrial, or any full shop.' },
    { id: 'c23', icon: '🏪',  desc: 'Visit 2 shops in one round',   reward: 16, type: 'visit_shops',    param: 2,     hint: 'Walking past a shop counts if you stop in.' },
    { id: 'c30', icon: '🛒',  desc: 'Buy 2 items',                  reward: 15, type: 'buy_item',       param: 2,     hint: 'Any two purchases, any two shops.' },
    { id: 'c25', icon: '💸',  desc: 'Earn 20 coins in one round',   reward: 15, type: 'earn_coins_round', param: 20,  hint: 'HQ payouts and big-coin tiles get you there fastest.' },
    { id: 'c31', icon: '💎',  desc: 'Earn 35 coins in one round',   reward: 24, type: 'earn_coins_round', param: 35,  hint: 'A district run with an HQ at the end of it.' },
];

export function getShuffledPool() {
    const pool = [...CONTRACT_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
}
