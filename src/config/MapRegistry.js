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
//   lengthPicker — id of the match-length chip row to reveal for this map
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
        lengthPicker: 'hbd-length-select',
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
        lengthPicker: 'city-length-select',
        available: true,
    },

    // ─── Add future maps below this line ───────────────────────
    //
    // Star Territory. The board, its four territories and the routing are
    // built; the Star itself is phase 3 of docs/STAR_TERRITORY_SPEC.md, so the
    // Offices currently say they are shut rather than paying a stand-in bonus.
    {
        id:        'star_territory',
        name:      'Star Territory',
        icon:      '🤠',
        desc:      'Ride four territories and pin on the most Stars.',
        longDesc:  'The Territory has no law and four days before the circuit judge arrives. Ride out from 🤠 Perdition through the 🚂 Ironwood Railyard, the ⛏️ Cinder Mine, the 🐎 Longhorn Ranch and the 🏜️ Boot Hill Badlands. A hub ring with four loop roads — take one and it costs you eleven spaces out of your way, which is what makes what waits at the far end worth the ride. PREVIEW: the Sheriff\'s Star itself is not in yet.',
        tags:      ['4 Territories', '60 Spaces', '6 / 12 / 20 Rounds', 'Preview'],
        color:     '#d97706',
        lengthPicker: 'city-length-select',
        available: true,
    },
];
