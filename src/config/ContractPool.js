// ============================================================
// CONTRACT POOL — shuffled deck of City Contracts
// Each contract: { id, icon, desc, reward, type, param }
// type: 'visit_hq' | 'land_coin' | 'win_minigame' | 'enter_district'
//       | 'use_item' | 'complete_circuit' | 'duel_win' | 'claim_ally'
// ============================================================

export const CONTRACT_POOL = [
    { id: 'c01', icon: '💹', desc: 'Visit the Financial HQ',        reward: 20, type: 'visit_hq',       param: 'fin'  },
    { id: 'c02', icon: '🏚️', desc: 'Visit the Back Alley HQ',       reward: 18, type: 'visit_hq',       param: 'ba'   },
    { id: 'c03', icon: '🛍️', desc: 'Visit the Shopping Promenade HQ', reward: 18, type: 'visit_hq',     param: 'shop' },
    { id: 'c04', icon: '⚙️',  desc: 'Visit the Industrial HQ',       reward: 22, type: 'visit_hq',       param: 'ind'  },
    { id: 'c05', icon: '🪙',  desc: 'Land on 3 coin spaces',         reward: 15, type: 'land_coin',      param: 3     },
    { id: 'c06', icon: '💰',  desc: 'Land on 2 big-coin spaces',     reward: 14, type: 'land_coin_big',  param: 2     },
    { id: 'c07', icon: '🏆',  desc: 'Win the next minigame',         reward: 12, type: 'win_minigame',   param: null  },
    { id: 'c08', icon: '🏆',  desc: 'Win 2 minigames in a row',      reward: 20, type: 'win_minigames',  param: 2     },
    { id: 'c09', icon: '🗺️',  desc: 'Enter the Financial District',  reward: 12, type: 'enter_district', param: 'fin'  },
    { id: 'c10', icon: '🗺️',  desc: 'Enter the Back Alley',         reward: 12, type: 'enter_district', param: 'ba'   },
    { id: 'c11', icon: '🗺️',  desc: 'Enter the Shopping Promenade', reward: 12, type: 'enter_district', param: 'shop' },
    { id: 'c12', icon: '🗺️',  desc: 'Enter the Industrial Zone',    reward: 14, type: 'enter_district', param: 'ind'  },
    { id: 'c13', icon: '⚔️',  desc: 'Win a Duel',                   reward: 16, type: 'duel_win',       param: null  },
    { id: 'c14', icon: '🤝',  desc: 'Claim an Ally',                reward: 14, type: 'claim_ally',     param: null  },
    { id: 'c15', icon: '🔄',  desc: 'Complete a full circuit',       reward: 22, type: 'complete_circuit', param: null },
    { id: 'c16', icon: '🛸',  desc: 'Use a Rocket item',            reward: 13, type: 'use_item',       param: 'rocket'     },
    { id: 'c17', icon: '🛡️',  desc: 'Block a negative space',       reward: 12, type: 'block_space',    param: null  },
    { id: 'c18', icon: '🧲',  desc: 'Land on a Magnet space',       reward: 13, type: 'land_type',      param: 'magnet'     },
    { id: 'c19', icon: '⚡',  desc: 'Land on a Boost space',        reward: 11, type: 'land_type',      param: 'boost'      },
    { id: 'c20', icon: '🌀',  desc: 'Land on a Shortcut space',     reward: 11, type: 'land_type',      param: 'shortcut'   },
    { id: 'c21', icon: '🕊️',  desc: 'Land on a Truce space',        reward: 12, type: 'land_type',      param: 'truce'      },
    { id: 'c22', icon: '💥',  desc: 'Use a Double Die item',        reward: 12, type: 'use_item',       param: 'double_die' },
    { id: 'c23', icon: '🏪',  desc: 'Visit 2 shops in one lap',     reward: 16, type: 'visit_shops',    param: 2     },
    { id: 'c24', icon: '🔒',  desc: 'Break through the Gate',       reward: 18, type: 'open_gate',      param: null  },
    { id: 'c25', icon: '💸',  desc: 'Earn 20 coins in one round',   reward: 15, type: 'earn_coins_round', param: 20  },
];

export function getShuffledPool() {
    const pool = [...CONTRACT_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
}
