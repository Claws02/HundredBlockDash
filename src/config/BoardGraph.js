// ============================================================
// BOARD GRAPH — City Circuit map topology
// Nodes: { id, type, district, isJunction?, isHQ?, isGrandMall?, shopDistrict?, next[] }
// Junctions (isJunction=true) are invisible path forks — players never land on them.
// 'next' has 2 entries at junctions (ring road vs district), 1 elsewhere.
// ============================================================

export const JUNCTION_IDS = new Set(['bp_a', 'bp_b', 'bp_c', 'bp_d']);

export const DISTRICT_NAMES = {
    fin:  'Financial District',
    ba:   'Back Alley',
    shop: 'Shopping Promenade',
    ind:  'Industrial Zone',
    ring: 'City Ring Road',
};

export const DISTRICT_KEYS = ['fin', 'ba', 'shop', 'ind'];

// Branch junction descriptions shown in the path-choice UI
export const BRANCH_OPTIONS = {
    bp_a: [
        { nodeId: 'r1',    label: 'Ring Road',          desc: 'Safe & consistent',         icon: '🛣️', district: 'ring', spaces: 5  },
        { nodeId: 'fin_0', label: 'Financial District', desc: 'High risk, high reward',    icon: '💹', district: 'fin',  spaces: 10 },
    ],
    bp_b: [
        { nodeId: 'r6',   label: 'Ring Road',           desc: 'Safe & consistent',         icon: '🛣️', district: 'ring', spaces: 5  },
        { nodeId: 'ba_0', label: 'Back Alley',          desc: 'Traps & shortcuts',         icon: '🏚️', district: 'ba',   spaces: 12 },
    ],
    bp_c: [
        { nodeId: 'r11',    label: 'Ring Road',          desc: 'Safe & consistent',         icon: '🛣️', district: 'ring', spaces: 5  },
        { nodeId: 'shop_0', label: 'Shopping Promenade', desc: 'Coins & mystery spaces',    icon: '🛍️', district: 'shop', spaces: 10 },
    ],
    bp_d: [
        { nodeId: 'r16',   label: 'Ring Road',          desc: 'Safe & consistent',          icon: '🛣️', district: 'ring', spaces: 5 },
        { nodeId: 'ind_0', label: 'Industrial Zone',    desc: 'Locked by The Gate 🔒',      icon: '⚙️', district: 'ind',  spaces: 8 },
    ],
};

const G = {};

// ---- Branch junctions (invisible) ----
G.bp_a = { id: 'bp_a', isJunction: true, district: 'ring', next: ['r1',    'fin_0']  };
G.bp_b = { id: 'bp_b', isJunction: true, district: 'ring', next: ['r6',    'ba_0']   };
G.bp_c = { id: 'bp_c', isJunction: true, district: 'ring', next: ['r11',   'shop_0'] };
G.bp_d = { id: 'bp_d', isJunction: true, district: 'ring', next: ['r16',   'ind_0']  };

// ---- Ring Road — 20 spaces, 5 per quadrant (clockwise A→B→C→D→A) ----
// A→B quadrant (r1=START, r3=shop)
G.r1  = { id: 'r1',  type: 'start', district: 'ring', next: ['r2']   };
G.r2  = { id: 'r2',  type: null,    district: 'ring', next: ['r3']   };
G.r3  = { id: 'r3',  type: 'shop',  district: 'ring', shopDistrict: 'ring', next: ['r4']   };
G.r4  = { id: 'r4',  type: null,    district: 'ring', next: ['r5']   };
G.r5  = { id: 'r5',  type: null,    district: 'ring', next: ['bp_b'] };
// B→C quadrant (r8=shop? no — only 2 ring shops: r3 and r13)
G.r6  = { id: 'r6',  type: null,    district: 'ring', next: ['r7']   };
G.r7  = { id: 'r7',  type: null,    district: 'ring', next: ['r8']   };
G.r8  = { id: 'r8',  type: null,    district: 'ring', next: ['r9']   };
G.r9  = { id: 'r9',  type: null,    district: 'ring', next: ['r10']  };
G.r10 = { id: 'r10', type: null,    district: 'ring', next: ['bp_c'] };
// C→D quadrant (r13=shop)
G.r11 = { id: 'r11', type: null,    district: 'ring', next: ['r12']  };
G.r12 = { id: 'r12', type: null,    district: 'ring', next: ['r13']  };
G.r13 = { id: 'r13', type: 'shop',  district: 'ring', shopDistrict: 'ring', next: ['r14']  };
G.r14 = { id: 'r14', type: null,    district: 'ring', next: ['r15']  };
G.r15 = { id: 'r15', type: null,    district: 'ring', next: ['bp_d'] };
// D→A quadrant
G.r16 = { id: 'r16', type: null,    district: 'ring', next: ['r17']  };
G.r17 = { id: 'r17', type: null,    district: 'ring', next: ['r18']  };
G.r18 = { id: 'r18', type: null,    district: 'ring', next: ['r19']  };
G.r19 = { id: 'r19', type: null,    district: 'ring', next: ['r20']  };
G.r20 = { id: 'r20', type: null,    district: 'ring', next: ['bp_a'] };

// ---- Financial District (bp_a → bp_b, outer arc north-east) ----
// fin_4=shop (Wall Street Exchange), fin_9=HQ
G.fin_0 = { id: 'fin_0', type: null,   district: 'fin', next: ['fin_1'] };
G.fin_1 = { id: 'fin_1', type: null,   district: 'fin', next: ['fin_2'] };
G.fin_2 = { id: 'fin_2', type: null,   district: 'fin', next: ['fin_3'] };
G.fin_3 = { id: 'fin_3', type: null,   district: 'fin', next: ['fin_4'] };
G.fin_4 = { id: 'fin_4', type: 'shop', district: 'fin', shopDistrict: 'fin', next: ['fin_5'] };
G.fin_5 = { id: 'fin_5', type: null,   district: 'fin', next: ['fin_6'] };
G.fin_6 = { id: 'fin_6', type: null,   district: 'fin', next: ['fin_7'] };
G.fin_7 = { id: 'fin_7', type: null,   district: 'fin', next: ['fin_8'] };
G.fin_8 = { id: 'fin_8', type: null,   district: 'fin', next: ['fin_9'] };
G.fin_9 = { id: 'fin_9', type: 'hq',   district: 'fin', isHQ: true, next: ['bp_b'] };

// ---- Back Alley (bp_b → bp_c, outer arc south-east) ----
// ba_5=shop (Underground Market), ba_11=HQ
G.ba_0  = { id: 'ba_0',  type: null,   district: 'ba', next: ['ba_1']  };
G.ba_1  = { id: 'ba_1',  type: null,   district: 'ba', next: ['ba_2']  };
G.ba_2  = { id: 'ba_2',  type: null,   district: 'ba', next: ['ba_3']  };
G.ba_3  = { id: 'ba_3',  type: null,   district: 'ba', next: ['ba_4']  };
G.ba_4  = { id: 'ba_4',  type: null,   district: 'ba', next: ['ba_5']  };
G.ba_5  = { id: 'ba_5',  type: 'shop', district: 'ba', shopDistrict: 'ba', next: ['ba_6']  };
G.ba_6  = { id: 'ba_6',  type: null,   district: 'ba', next: ['ba_7']  };
G.ba_7  = { id: 'ba_7',  type: null,   district: 'ba', next: ['ba_8']  };
G.ba_8  = { id: 'ba_8',  type: null,   district: 'ba', next: ['ba_9']  };
G.ba_9  = { id: 'ba_9',  type: null,   district: 'ba', next: ['ba_10'] };
G.ba_10 = { id: 'ba_10', type: null,   district: 'ba', next: ['ba_11'] };
G.ba_11 = { id: 'ba_11', type: 'hq',   district: 'ba', isHQ: true, next: ['bp_c'] };

// ---- Shopping Promenade (bp_c → bp_d, outer arc south-west) ----
// shop_4=shop, shop_9=HQ (Grand Mall — discounted shop)
G.shop_0 = { id: 'shop_0', type: null,   district: 'shop', next: ['shop_1'] };
G.shop_1 = { id: 'shop_1', type: null,   district: 'shop', next: ['shop_2'] };
G.shop_2 = { id: 'shop_2', type: null,   district: 'shop', next: ['shop_3'] };
G.shop_3 = { id: 'shop_3', type: null,   district: 'shop', next: ['shop_4'] };
G.shop_4 = { id: 'shop_4', type: 'shop', district: 'shop', shopDistrict: 'shop', next: ['shop_5'] };
G.shop_5 = { id: 'shop_5', type: null,   district: 'shop', next: ['shop_6'] };
G.shop_6 = { id: 'shop_6', type: null,   district: 'shop', next: ['shop_7'] };
G.shop_7 = { id: 'shop_7', type: null,   district: 'shop', next: ['shop_8'] };
G.shop_8 = { id: 'shop_8', type: null,   district: 'shop', next: ['shop_9'] };
G.shop_9 = { id: 'shop_9', type: 'hq',   district: 'shop', isHQ: true, isGrandMall: true, next: ['bp_d'] };

// ---- Industrial Zone (bp_d → bp_a, outer arc north-west) ----
// ind_0=gate, ind_3=shop (Power Plant), ind_7=HQ
G.ind_0 = { id: 'ind_0', type: 'gate', district: 'ind', next: ['ind_1'] };
G.ind_1 = { id: 'ind_1', type: null,   district: 'ind', next: ['ind_2'] };
G.ind_2 = { id: 'ind_2', type: null,   district: 'ind', next: ['ind_3'] };
G.ind_3 = { id: 'ind_3', type: 'shop', district: 'ind', shopDistrict: 'ind', next: ['ind_4'] };
G.ind_4 = { id: 'ind_4', type: null,   district: 'ind', next: ['ind_5'] };
G.ind_5 = { id: 'ind_5', type: null,   district: 'ind', next: ['ind_6'] };
G.ind_6 = { id: 'ind_6', type: null,   district: 'ind', next: ['ind_7'] };
G.ind_7 = { id: 'ind_7', type: 'hq',   district: 'ind', isHQ: true, next: ['bp_a'] };

export const CITY_GRAPH = G;

// ---- Randomisable slots per district (type === null nodes) ----
// Counts must match pool sizes in DISTRICT_POOLS below.
export const DISTRICT_POOLS = {
    // 17 null nodes: r2, r4, r5, r6, r7, r8, r9, r10, r11, r12, r14, r15, r16, r17, r18, r19, r20
    ring: [
        ...Array(5).fill('coin'), ...Array(3).fill('coin_big'),
        ...Array(2).fill('trap'), ...Array(2).fill('lose'),
        ...Array(2).fill('mystery'), ...Array(1).fill('boost'),
        ...Array(1).fill('truce'), ...Array(1).fill('shortcut'),
    ],
    // 8 null nodes: fin_0-fin_3, fin_5-fin_8
    fin: [
        ...Array(3).fill('coin_big'), ...Array(2).fill('lose_big'),
        ...Array(1).fill('magnet'), ...Array(1).fill('duel'), ...Array(1).fill('coin'),
    ],
    // 10 null nodes: ba_0-ba_4, ba_6-ba_10
    ba: [
        ...Array(3).fill('trap'), ...Array(2).fill('lose'),
        ...Array(2).fill('magnet'), ...Array(2).fill('shortcut'), ...Array(1).fill('duel'),
    ],
    // 8 null nodes: shop_0-shop_3, shop_5-shop_8
    shop: [
        ...Array(3).fill('mystery'), ...Array(2).fill('coin'),
        ...Array(2).fill('coin_big'), ...Array(1).fill('duel'),
    ],
    // 5 null nodes: ind_1, ind_2, ind_4, ind_5, ind_6
    ind: [
        ...Array(1).fill('lose_big'), ...Array(1).fill('trap'),
        ...Array(1).fill('cfwd'),     ...Array(1).fill('coin_big'), ...Array(1).fill('duel'),
    ],
};

// Flat ordered list used for camera path and map slider
export const ALL_NODES_ORDERED = [
    'r1','r2','r3','r4','r5',
    'fin_0','fin_1','fin_2','fin_3','fin_4','fin_5','fin_6','fin_7','fin_8','fin_9',
    'r6','r7','r8','r9','r10',
    'ba_0','ba_1','ba_2','ba_3','ba_4','ba_5','ba_6','ba_7','ba_8','ba_9','ba_10','ba_11',
    'r11','r12','r13','r14','r15',
    'shop_0','shop_1','shop_2','shop_3','shop_4','shop_5','shop_6','shop_7','shop_8','shop_9',
    'r16','r17','r18','r19','r20',
    'ind_0','ind_1','ind_2','ind_3','ind_4','ind_5','ind_6','ind_7',
];
