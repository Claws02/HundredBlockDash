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
    'oddoneout',
    'steadyhand',
    'sortrush',
    'meteordodge',
    'lootcatch',
    'freeze',
    'clearout',
    // The four classic formats the genre is built on, added to fix the roster's
    // structural gaps (docs/MINIGAME_BACKLOG.md): a paddle-and-ball rally,
    // asymmetric roles, spatial denial, and a shared board taken in turns.
    'puck',
    'penalty',
    'lightcycles',
    'fourinarow',
    // Round two. Memory Match is the first game to use the HUDDLE hold, which
    // had been defined and unused since the orientation config was written.
    'memorymatch',
    'bombpass',
    'grandprix',
    'treeclimb',
];

export const MG_INFO = {
    sumospheres: { icon: '⭕', title: 'SUMO SPHERES',  desc: 'Drag your half to roll your sphere and knock the opponent off the arena! Build momentum for bigger hits. The arena shrinks after 30 seconds — last one standing wins!' },
    tankclash:   { icon: '🎯', title: 'TANK CLASH',    desc: 'Use the left joystick to move and aim your tank, tap the right side to fire! Use cover to dodge shots. First to land 3 hits wins!' },
    rhythmforge: { icon: '🥁', title: 'RHYTHM FORGE',  desc: 'Tap the correct lane as notes reach the hit zone! 3 rounds of increasing difficulty — each player takes a turn. Perfect, Great, and Good hits score 3, 2, and 1 points. Most points overall wins!' },
    orbdeflect:  { icon: '🌀', title: 'ORB DEFLECT',   desc: 'Draw glowing barriers with your finger to deflect the orb into your opponent\'s core! P1 owns the bottom half, P2 the top. 3 HP each — first to lose all HP loses, or most HP after 30 seconds wins!' },
    snapstrike:  { icon: '💥', title: 'SNAP STRIKE',   desc: 'A needle sweeps your bar — tap to lock it on the bullseye! PERFECT, GREAT, and GOOD snaps score 3, 2, and 1 points. The bar speeds up and the target shrinks across 5 rounds. Highest total wins!' },
    quickdraw:   { icon: '🤠', title: 'QUICK DRAW',    desc: 'Both halves say WAIT. The instant they flip to DRAW, tap as fast as you can — first finger wins the round! But tap too early and you false-start and lose it. Best of 3 wins the duel.' },
    gridrecall:  { icon: '🧠', title: 'GRID RECALL',   desc: 'A pattern of tiles flashes on your 3×3 grid, then vanishes — race to tap it all back from memory! The FIRST player to nail the whole pattern wins the round, but one wrong tile knocks you out. The pattern grows and the flash shortens across 4 rounds. Win the most rounds to take it!' },
    oddoneout:   { icon: '🔍', title: 'ODD ONE OUT',   desc: 'Every tile on your grid is the same shade except one. Tap the odd tile to score and get a fresh, harder grid — more tiles, subtler difference. A wrong tap locks you briefly. Most correct in 30 seconds wins!' },
    steadyhand:  { icon: '🎯', title: 'STEADY HAND',   desc: 'A target drifts around your half — keep your finger on it to bank time! It speeds up as the round goes on. Whoever holds the target longest after 22 seconds wins.' },
    sortrush:    { icon: '🔺', title: 'SHAPE SNAP',    desc: 'One shape flashes up in the middle — both of you are looking at the same one. Slam the matching button on your side before your rival does to take the round. The four buttons get shuffled every round, so you have to actually find it. Wrong button locks you out; jumping early hands them the round. FIRST TO 3 WINS!' },
    meteordodge: { icon: '☄️', title: 'METEOR DODGE',  desc: 'Drag your pod along the base of your half to dodge falling meteors. Three lives each — lose them all and you\'re out. The storm gets faster and thicker over time. Survive with the most lives after 30 seconds to win!' },
    lootcatch:   { icon: '🧺', title: 'LOOT CATCH',    desc: '💰 PAYDAY ROUND — every coin you catch is REAL money, and BOTH players keep every coin they scoop, win or lose. Slide your basket to grab 🪙 coins and 💎 gems (worth 3) and dodge every 💣. The exact same loot falls on both sides. Most caught after 34 seconds wins the bonus and rolls first — but nobody leaves empty-handed.' },
    freeze:      { icon: '👁️', title: 'FREEZE',        desc: 'One Crown in the middle, one track, and an Eye that picks a side. HOLD your half to creep toward the Crown — but when the Eye turns and looks at YOU, freeze or get sent back. It does not always watch both of you: when it stares at your rival, that is your free run. Get spotted and your scuffle covers their footsteps and hands them a free step. First to the Crown wins!' },
    clearout:    { icon: '🥏', title: 'CLEAR OUT',     desc: 'A wall splits the arena with one small gap. You start with 4 discs on your side — drag back and release to slingshot them through the gap onto your rival\'s side. Discs collide and ricochet! First to empty their own side wins (or fewest discs on your side when the clock runs out).' },
    puck:        { icon: '🏒', title: 'PUCK',          desc: 'Air hockey. One puck, one table, a goal at each end. Drag your mallet anywhere in your half — the puck bounces off the walls and off whoever gets to it. Strike on the move to add pace, use the side walls for angles, and don\'t get caught upfield. FIRST TO 5 GOALS!' },
    penalty:     { icon: '⚽', title: 'PENALTY',       desc: 'One shoots, one keeps, then you swap. The SHOOTER drags to aim and releases to strike. The KEEPER slides along the line and commits the instant the ball is hit — so it\'s a read of each other, not a test of your thumbs. Aim near a post and the keeper can\'t reach it, but the woodwork can. 3 kicks each, most goals wins!' },
    lightcycles: { icon: '🏍️', title: 'LIGHT CYCLES',  desc: 'Two cycles, one arena, solid trails behind both. Push your stick to steer — up, down, left, right. Crash into any wall — theirs, yours, or the arena\'s — and you lose the round. Every metre you take is a metre they can\'t have. Best of 3, and the arena closes in each round.' },
    fourinarow:  { icon: '🔴', title: 'FOUR IN A ROW', desc: 'The classic, on one shared board you both read from your own edge. Tap a column on your side to drop a disc. First to line up four — across, down or diagonally — wins. There\'s a shot clock, so don\'t sit on it: run it out and the move gets made for you.' },
    memorymatch: { icon: '🃏', title: 'MEMORY MATCH',  desc: '🪙 COIN GAME — lay the phone flat and both lean in. 25 cards: twelve pairs and one lone JACKPOT. Turn two on your go; match them and you keep the coins AND go again. Miss and they flip back — but now you both know what\'s there. Every pair pays, win or lose, and the jackpot pays triple. Most pairs takes it.' },
    bombpass:    { icon: '💣', title: 'BOMB PASS',     desc: 'One lit bomb, and neither of you wants it. While it\'s on YOUR side, tap to smack it back — every return sends it faster. Let it reach the wall behind you and it goes off in your hands. Swing while it\'s on their side and you whiff, and you\'re locked out just long enough to regret it. Watch the fuse: when it burns out the bomb blows wherever it is. Best of 3!' },
    grandprix:   { icon: '🏎️', title: 'GRAND PRIX',    desc: 'One track, one pedal. HOLD your half for gas, let go to slow down — there is no brake and no steering. Every corner has a speed on the board: arrive over it and you spin out for a full second. Lift too early and they\'re gone; lift too late and you\'re in the wall. Whoever\'s behind gets a slipstream, so it\'s never over. First to the flag!' },
    treeclimb:   { icon: '🌳', title: 'TREE CLIMB',    desc: '🪙 COIN GAME — race your rival up your own stem. A leaf sprouts LEFT or RIGHT — tap that side to swing onto it, and only then does the next one grow. Tap the wrong side and you slip and lose a moment, but never your height. Every branch is coins in your pocket whether you win or lose. First to the top takes the bonus!' },
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
        instructions: 'Lay the phone <b>flat on the table</b> between you and both lean in from the side — nobody holds an end for this one.<br><br>You take it in <b>turns</b>. The banner at your own edge says when it\'s your move, and <b>only the player whose turn it is</b> should be tapping.',
        thumbAnim: 'pulse',
    },
};

// ============================================================
// WATCHDOG OVERRIDES
//
// MinigameManager force-ends a game after 90 s as a safety net — reaching it is
// meant to be a bug signal, not a game rule. These four have no clock of their
// own by design: they run until somebody wins, and terminate because their board
// or arena strictly fills up rather than because time is called on them. They
// need a net that a slow but perfectly normal game cannot trip.
// ============================================================
export const MG_WATCHDOG_MS = {
    memorymatch: 240000,   // 25 cards, taken in turns
    fourinarow:  240000,   // 30 cells, taken in turns
    lightcycles: 240000,   // best of 3, each round ends on a crash
    penalty:     240000,   // no shot clock — the taker shoots when ready
};

export const MG_ORIENTATION_MAP = {
    sumospheres: 'faceoff',
    tankclash:   'faceoff',
    rhythmforge: 'faceoff',
    orbdeflect:  'faceoff',
    snapstrike:  'faceoff',
    quickdraw:   'quickdraw',
    gridrecall:  'faceoff',
    oddoneout:   'faceoff',
    steadyhand:  'faceoff',
    sortrush:    'faceoff',
    meteordodge: 'faceoff',
    lootcatch:   'faceoff',
    freeze:      'faceoff',
    clearout:    'faceoff',
    puck:        'faceoff',
    penalty:     'faceoff',
    lightcycles: 'faceoff',
    fourinarow:  'faceoff',
    memorymatch: 'huddle',
    bombpass:    'faceoff',
    grandprix:   'faceoff',
    treeclimb:   'faceoff',
};

export const FALLBACK_TRIVIA = [
    { q: 'What planet is closest to the Sun?',      a: 'Mercury',          w: ['Venus', 'Earth', 'Mars'] },
    { q: 'How many sides does a hexagon have?',     a: '6',                w: ['5', '7', '8'] },
    { q: 'What is the chemical symbol for water?',  a: 'H2O',              w: ['CO2', 'O2', 'NaCl'] },
    { q: 'Who painted the Mona Lisa?',              a: 'Leonardo da Vinci', w: ['Michelangelo', 'Raphael', 'Picasso'] },
    { q: 'What is 7 x 8?',                          a: '56',               w: ['54', '48', '63'] },
];
