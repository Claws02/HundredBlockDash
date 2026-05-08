// ============================================================
// MINIGAME REGISTRY — add a new minigame by adding an entry
// here and a corresponding file in src/minigames/
// ============================================================

export const MG_TYPES = [
    'math', 'trivia', 'trace', 'reaction', 'colormatch',
    'memory', 'sequence', 'countdown', 'shapetap', 'oddoneout', 'highlow',
    'pulsehold', 'gridrecall', 'wordscramble', 'colorrush', 'rhythmtap',
    'speedsort', 'flickshot', 'codebreaker', 'soundmatch',
    'tethertap', 'mirrormatch', 'blindbuild',
    'paintwar', 'asteroidodge', 'gravitywell', 'snakebattle',
];

export const MG_INFO = {
    math:       { icon: '🔢', title: 'MATH BLITZ',       desc: 'An equation appears. Solve it and tap the correct answer. Wrong tap = instant loss!' },
    trivia:     { icon: '❓',  title: 'TRIVIA SHOOTOUT',  desc: 'A question appears. Tap the correct answer before your opponent. Wrong answer loses!' },
    trace:      { icon: '✨',  title: 'CONSTELLATION',    desc: 'Tap the glowing nodes in order from 1 to 5. Fastest correct completion wins!' },
    reaction:   { icon: '⚡',  title: 'REACTION TAP',     desc: 'Watch your zone. When it flashes GREEN — tap as fast as possible! Tap too early and you lose.' },
    colormatch: { icon: '🎨', title: 'COLOR MATCH',       desc: 'A color word appears in different ink. Tap the button matching the INK COLOR — not the word! Best of 3 wins.' },
    memory:     { icon: '🧠', title: 'MEMORY FLIP',       desc: '6 cards flash briefly then hide. Flip matching pairs simultaneously. Most pairs wins!' },
    sequence:   { icon: '🔁', title: 'SEQUENCE REPEAT',   desc: 'Watch 4 colored lights flash in order. Repeat the sequence correctly. First correct wins!' },
    countdown:  { icon: '⏱️', title: 'COUNTDOWN STOP',   desc: 'A timer starts at 0. It shows for 1 second then hides. Tap your zone to stop it as close to exactly 5.00 seconds as possible. Closest wins!' },
    shapetap:   { icon: '🔷', title: 'SHAPE TAP',          desc: 'A shape name appears in the middle. Tap the matching shape on your half as fast as possible. Best of 3 rounds wins!' },
    oddoneout:  { icon: '🔍', title: 'ODD ONE OUT',        desc: '4 items appear — 3 share a category, 1 doesn\'t belong. Tap the odd one out first to win the round. Best of 3!' },
    highlow:     { icon: '🎯', title: 'HIGHER OR LOWER',  desc: 'You each get a secret number (1–100). Guess it in as few tries as possible — you\'ll be told HIGHER or LOWER after each guess. Fewest guesses wins!' },
    pulsehold:   { icon: '💓', title: 'PULSE HOLD',       desc: 'Hold the pulsing circle and release exactly at its BIGGEST size. Closest to peak wins the round. Best of 5!' },
    gridrecall:  { icon: '🔲', title: 'GRID RECALL',      desc: 'A 4×4 grid flashes highlighted cells for 2 seconds. Memorize it — then recreate the pattern! Most correct cells wins. 3 rounds.' },
    wordscramble:{ icon: '🔤', title: 'WORD SCRAMBLE',    desc: 'Scrambled letters appear. First player to tap the correct unscrambled word wins the round! Best of 5.' },
    colorrush:   { icon: '🌈', title: 'COLOR RUSH',       desc: 'Color words flash by. TAP only when the word\'s meaning MATCHES its ink color — tap the wrong moment and you lose a point! 20 seconds.' },
    rhythmtap:   { icon: '🥁', title: 'RHYTHM TAP',       desc: 'Watch the beat pattern flash, then replicate it on your zone! Scored by timing accuracy across 3 rounds.' },
    speedsort:   { icon: '🔢', title: 'SPEED SORT',       desc: 'Numbers 1–9 appear scrambled. Tap them in order as fast as possible! First to finish wins the round. Best of 3.' },
    flickshot:   { icon: '🏓', title: 'BRICK PONG',        desc: 'Pong meets Brick Breaker! Move your paddle to bounce the ball past your opponent. Break bricks in the center as the ball flies through. First to 3 points wins!' },
    codebreaker: { icon: '🔐', title: 'CODE BREAKER',     desc: 'Crack a secret 3-digit code using ✓ (right place) and ~ (right digit) hints. First to crack their code wins! Best of 3.' },
    soundmatch:  { icon: '🎵', title: 'SOUND MATCH',      desc: 'Listen to a sequence of HIGH and LOW tones, then tap the matching H/L pattern from 4 choices. First correct wins! Best of 5.' },
    tethertap:   { icon: '🪢', title: 'TETHER TAP',       desc: 'A ring drifts outward — hold your thumb down and release exactly when the ring hits the target line! Overshoot = miss. Best of 5.' },
    mirrormatch: { icon: '🪞', title: 'MIRROR MATCH',     desc: 'A grid pattern appears on one half. The other player must tap the HORIZONTALLY MIRRORED version from 3 choices! Roles swap. Best of 3.' },
    blindbuild:   { icon: '🎨', title: 'BLIND BUILD',      desc: 'P1 memorizes a shape shown for 3 seconds, then P2 must redraw it from memory! Scored by pixel accuracy. Best of 3 rounds.' },
    paintwar:     { icon: '🖌️', title: 'PAINT WAR',        desc: 'Drag your finger to paint the canvas your color! P1 owns the bottom half, P2 the top. Most territory after 15 seconds wins.' },
    asteroidodge: { icon: '☄️', title: 'ASTEROID DODGE',   desc: 'Slide your ship to dodge falling asteroids! Asteroids speed up over time. 3 hits = destroyed. Last ship flying (or most health after 30s) wins.' },
    gravitywell:  { icon: '🌀', title: 'GRAVITY WELL',     desc: 'Tap your half to place a REPULSION well that blasts the ball away! Use up to 2 wells to strategically push the ball into the opponent\'s goal zone. First to 5 points wins!' },
    snakebattle:  { icon: '🐍', title: 'SNAKE BATTLE',     desc: 'Two snakes share one arena! Swipe your half to steer. Eat dots to grow longer. Crash into a wall or either snake and you lose. Most dots after 30s wins.' },
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
    math:        'faceoff',
    trivia:      'faceoff',
    trace:       'stargazer',
    reaction:    'quickdraw',
    colormatch:  'faceoff',
    memory:      'huddle',
    sequence:    'faceoff',
    countdown:   'faceoff',
    shapetap:    'faceoff',
    oddoneout:   'faceoff',
    highlow:     'faceoff',
    pulsehold:   'faceoff',
    gridrecall:  'huddle',
    wordscramble:'faceoff',
    colorrush:   'quickdraw',
    rhythmtap:   'faceoff',
    speedsort:   'faceoff',
    flickshot:   'faceoff',
    codebreaker:  'faceoff',
    soundmatch:   'faceoff',
    tethertap:    'faceoff',
    mirrormatch:  'quickdraw',
    blindbuild:   'stargazer',
    paintwar:     'faceoff',
    asteroidodge: 'faceoff',
    gravitywell:  'faceoff',
    snakebattle:  'faceoff',
};

export const FALLBACK_TRIVIA = [
    { q: 'What planet is closest to the Sun?',      a: 'Mercury',          w: ['Venus', 'Earth', 'Mars'] },
    { q: 'How many sides does a hexagon have?',     a: '6',                w: ['5', '7', '8'] },
    { q: 'What is the chemical symbol for water?',  a: 'H2O',              w: ['CO2', 'O2', 'NaCl'] },
    { q: 'Who painted the Mona Lisa?',              a: 'Leonardo da Vinci', w: ['Michelangelo', 'Raphael', 'Picasso'] },
    { q: 'What is 7 x 8?',                          a: '56',               w: ['54', '48', '63'] },
];
