// ============================================================
// MINIGAME REGISTRY — add a new minigame by adding an entry
// here and a corresponding file in src/minigames/
// ============================================================

export const MG_TYPES = [
    'sumospheres',
];

export const MG_INFO = {
    sumospheres: { icon: '⭕', title: 'SUMO SPHERES', desc: 'Drag your half to roll your sphere and knock the opponent off the arena! Build momentum for bigger hits. The arena shrinks after 30 seconds — last one standing wins!' },
};

// ============================================================
// ORIENTATION CONFIGS — how players hold the phone per game
// ============================================================
export const MG_ORIENTATIONS = {
    faceoff: {
        name: 'FACE-OFF',
        subtitle: 'Each player holds one end',
        huddle: false,
        instructions: '<b style="color:#ff3b3b">P1 (Red)</b> grips the <b>bottom</b> of the phone with both thumbs on the lower half of the screen.<br><br><b style="color:#3b8eff">P2 (Blue)</b> grips the <b>top</b> — the phone is upside-down from their view. Both players face their own half.',
        thumbAnim: 'pulse',
    },
    quickdraw: {
        name: 'QUICK-DRAW',
        subtitle: 'Hold your end — thumbs ready',
        huddle: false,
        instructions: '<b style="color:#ff3b3b">P1 (Red)</b> grips the <b>bottom</b>, thumb hovering over your zone.<br><br><b style="color:#3b8eff">P2 (Blue)</b> grips the <b>top</b> upside-down, thumb hovering over your zone.<br><br>Do <b>NOT</b> tap until you see GO — false tap loses!',
        thumbAnim: 'strike',
    },
    stargazer: {
        name: 'STARGAZER',
        subtitle: 'Each player gets their own star map',
        huddle: false,
        instructions: '<b style="color:#ff3b3b">P1 (Red)</b> holds the <b>bottom</b> — your constellation is on your half.<br><br><b style="color:#3b8eff">P2 (Blue)</b> holds the <b>top</b> upside-down — your constellation is on your half.<br><br>Tap the glowing stars in order as fast as you can!',
        thumbAnim: 'pulse',
    },
    huddle: {
        name: 'HUDDLE',
        subtitle: 'One holder, both players lean in',
        huddle: true,
        instructions: '<b style="color:#ff3b3b">P1 (Red)</b> holds the phone with both hands — keep it flat and steady so both players can see the screen.<br><br><b style="color:#3b8eff">P2 (Blue)</b> leans in from the side. <b>Both players tap the cards</b> to flip pairs — most matched pairs wins!',
        thumbAnim: 'pulse',
    },
};

export const MG_ORIENTATION_MAP = {
    sumospheres: 'faceoff',
};

export const FALLBACK_TRIVIA = [
    { q: 'What planet is closest to the Sun?',      a: 'Mercury',          w: ['Venus', 'Earth', 'Mars'] },
    { q: 'How many sides does a hexagon have?',     a: '6',                w: ['5', '7', '8'] },
    { q: 'What is the chemical symbol for water?',  a: 'H2O',              w: ['CO2', 'O2', 'NaCl'] },
    { q: 'Who painted the Mona Lisa?',              a: 'Leonardo da Vinci', w: ['Michelangelo', 'Raphael', 'Picasso'] },
    { q: 'What is 7 x 8?',                          a: '56',               w: ['54', '48', '63'] },
];
