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
