// ============================================================
// MINIGAME REGISTRY — add a new minigame by adding an entry
// here and a corresponding file in src/minigames/
// ============================================================

export const MG_TYPES = [
    'sumospheres',
    'tankclash',
    'rhythmforge',
    'orbdeflect',
    'snapstrike',
    'quickdraw',
    'gridrecall',
];

export const MG_INFO = {
    sumospheres: { icon: '⭕', title: 'SUMO SPHERES',  desc: 'Drag your half to roll your sphere and knock the opponent off the arena! Build momentum for bigger hits. The arena shrinks after 30 seconds — last one standing wins!' },
    tankclash:   { icon: '🎯', title: 'TANK CLASH',    desc: 'Use the left joystick to move and aim your tank, tap the right side to fire! Use cover to dodge shots. First to land 3 hits wins!' },
    rhythmforge: { icon: '🥁', title: 'RHYTHM FORGE',  desc: 'Tap the correct lane as notes reach the hit zone! 3 rounds of increasing difficulty — each player takes a turn. Perfect, Great, and Good hits score 3, 2, and 1 points. Most points overall wins!' },
    orbdeflect:  { icon: '🌀', title: 'ORB DEFLECT',   desc: 'Draw glowing barriers with your finger to deflect the orb into your opponent\'s core! P1 owns the bottom half, P2 the top. 3 HP each — first to lose all HP loses, or most HP after 30 seconds wins!' },
    snapstrike:  { icon: '💥', title: 'SNAP STRIKE',   desc: 'A needle sweeps your bar — tap to lock it on the bullseye! PERFECT, GREAT, and GOOD snaps score 3, 2, and 1 points. The bar speeds up and the target shrinks across 5 rounds. Highest total wins!' },
    quickdraw:   { icon: '🤠', title: 'QUICK DRAW',    desc: 'Both halves say WAIT. The instant they flip to DRAW, tap as fast as you can — first finger wins the round! But tap too early and you false-start and lose it. Best of 3 wins the duel.' },
    gridrecall:  { icon: '🧠', title: 'GRID RECALL',   desc: 'A pattern of tiles flashes on your 3×3 grid, then vanishes — tap them back from memory! Every correct tile scores. The pattern grows and the flash gets shorter across 4 rounds. Highest total wins.' },
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
    tankclash:   'faceoff',
    rhythmforge: 'faceoff',
    orbdeflect:  'faceoff',
    snapstrike:  'faceoff',
    quickdraw:   'quickdraw',
    gridrecall:  'faceoff',
};

export const FALLBACK_TRIVIA = [
    { q: 'What planet is closest to the Sun?',      a: 'Mercury',          w: ['Venus', 'Earth', 'Mars'] },
    { q: 'How many sides does a hexagon have?',     a: '6',                w: ['5', '7', '8'] },
    { q: 'What is the chemical symbol for water?',  a: 'H2O',              w: ['CO2', 'O2', 'NaCl'] },
    { q: 'Who painted the Mona Lisa?',              a: 'Leonardo da Vinci', w: ['Michelangelo', 'Raphael', 'Picasso'] },
    { q: 'What is 7 x 8?',                          a: '56',               w: ['54', '48', '63'] },
];
