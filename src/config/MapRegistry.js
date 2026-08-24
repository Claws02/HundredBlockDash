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
        longDesc:  'Explore the Financial District, Back Alley, Shopping Promenade, and Industrial Zone. Earn coins through District HQ bonuses, City Contracts, Buddy powers, and Duels. Pick your match length — 6, 12 or 20 rounds. The player with the most coins when the clock runs out wins the city.',
        tags:      ['4 Districts', '~64 Spaces', '6 / 12 / 20 Rounds', 'Buddies & Duels'],
        color:     '#60a5fa',
        available: true,
    },

    // ─── Add future maps below this line ───────────────────────
    //
    // Star Territory is specced in docs/STAR_TERRITORY_SPEC.md but not built.
    // `available: false` renders it as a disabled COMING SOON card with no
    // click handler, so this entry is inert until the map module exists.
    {
        id:        'star_territory',
        name:      'Star Territory',
        icon:      '🤠',
        desc:      'Ride four territories and pin on the most Stars.',
        longDesc:  'The Territory has no law and four days before the circuit judge arrives. Ride out from 🤠 Perdition through the 🚂 Ironwood Railyard, the ⛏️ Cinder Mine, the 🐎 Longhorn Ranch and the 🏜️ Boot Hill Badlands. Post a bond at a Territory Office to pin on a Sheriff\'s Star — and the next one is dispatched to the Office farthest from you. Coins are what you spend; Stars are what you score.',
        tags:      ['4 Territories', 'The Sheriff\'s Star', '6 / 12 / 20 Rounds', 'Coming Soon'],
        color:     '#d97706',
        available: false,
    },
];
