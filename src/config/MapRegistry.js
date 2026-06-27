// ============================================================
// MAP REGISTRY — add new maps here; the UI auto-generates cards
//
// Each entry:
//   id         — unique string key, used by GameController
//   name       — display name shown on card
//   icon       — emoji shown large on card
//   desc       — one-line teaser
//   longDesc   — shown in the preview panel when card is selected
//   tags       — short info chips (spaces, rounds, theme, etc.)
//   color      — accent color for the card border / highlight
//   available  — false shows a "COMING SOON" badge and disables selection
// ============================================================

export const MAP_REGISTRY = [
    {
        id:        'hundred_block_dash',
        name:      'Hundred Block Dash',
        icon:      '👑',
        desc:      'Dash through living realms to seize the Crown!',
        longDesc:  'A breakneck run across living realms — the 🌲 Whispering Woods, 🌋 Ember Wastes, ✨ Fae Glade, and the 🌌 Void where the Crown waits. Each realm has its own dangers, its own shop, and far more fortune than ruin. The Rift seals the final realm until someone rolls 15+ on 5 dice. Pick your length — 50, 75 or 100 blocks. Most coins wins, and reaching the Crown first banks a big +50 bonus!',
        tags:      ['50 / 75 / 100', 'Themed Realms', 'The Rift', '+50 Finish Bonus'],
        color:     '#f59e0b',
        available: true,
    },
    {
        id:        'city_circuit',
        name:      'City Circuit',
        icon:      '🏙️',
        desc:      'Navigate 4 city districts in a circular board.',
        longDesc:  'Explore the Financial District, Back Alley, Shopping Promenade, and Industrial Zone. Earn coins through District HQ bonuses, City Contracts, Ally powers, and Duels. The player with the most coins after 20 rounds wins.',
        tags:      ['4 Districts', '~64 Spaces', '20 Rounds', 'Allies & Duels'],
        color:     '#60a5fa',
        available: true,
    },

    // ─── Add future maps below this line ───────────────────────
    // {
    //     id:        'wild_west',
    //     name:      'Wild West',
    //     icon:      '🤠',
    //     desc:      'Stake gold claims across frontier territories.',
    //     longDesc:  'Coming soon!',
    //     tags:      ['5 Territories', '25 Rounds', 'Coming Soon'],
    //     color:     '#f59e0b',
    //     available: false,
    // },
];
