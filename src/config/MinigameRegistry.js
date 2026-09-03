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
    fourinarow:  { icon: '🔴', title: 'FOUR IN A ROW', desc: 'The classic, on one shared board you both read from your own edge. Tap a column on your side to drop a disc. First to line up four — across, down or diagonally — wins. No clock on this one: take as long over a move as you need.' },
    memorymatch: { icon: '🃏', title: 'MEMORY MATCH',  desc: '🪙 COIN GAME — lay the phone flat and both lean in. 25 cards: twelve pairs and one lone JACKPOT. Turn two on your go; match them and you keep the coins AND go again. Miss and they flip back — but now you both know what\'s there. Every pair pays, win or lose, and the jackpot pays triple. Most pairs takes it.' },
    bombpass:    { icon: '💣', title: 'BOMB PASS',     desc: 'One lit bomb, and neither of you wants it. While it\'s on YOUR side, tap to smack it back — every return sends it faster. Let it reach the wall behind you and it goes off in your hands. Swing while it\'s on their side and you whiff, and you\'re locked out just long enough to regret it. Watch the fuse: when it burns out the bomb blows wherever it is. Best of 3!' },
    grandprix:   { icon: '🏎️', title: 'GRAND PRIX',    desc: 'One circuit, both cars, one view — the whole track is on screen and you can see the race. HOLD your half for gas and let go to slow: there is no brake and no steering. Every corner has a speed painted on it, and arriving over that speed spins you out for a full second. Lift too early and they\'re gone; lift too late and you\'re facing the wrong way. Whoever\'s behind gets a slipstream. 2 laps!' },
    treeclimb:   { icon: '🌳', title: 'TREE CLIMB',    desc: '🪙 COIN GAME — 30 SECONDS, and whoever is HIGHEST when it runs out wins. A leaf sprouts LEFT or RIGHT — tap that side and you jump onto it, and only then does the next one grow. Sides don\'t just alternate, so watch it: two in a row happens. Grab the wrong side and you fall to the last branch on THAT side. Coins bank as you climb and a fall never takes them back.' },
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

// ============================================================
// WHICH GAMES CAN BE PLAYED ACROSS PHONES
// ============================================================
// Every game in the roster was built as ONE screen shared by two people: the
// bottom half is P1, the top half is P2, and both are simulated in the same
// browser. That is a fine design for two people on a sofa and a useless one for
// four people each holding their own phone.
//
// Two kinds of game, and only one of them crosses the wire cheaply:
//
//   'parallel'  The two halves never touch. Nothing P1 does changes anything on
//               P2's side — they are two solitaires racing a clock, compared at
//               the end. Meteor Dodge, Loot Catch, Steady Hand, Odd One Out,
//               Snap Strike and Tree Climb are all of this shape, and every one
//               of them says so in its own description: "most caught", "highest
//               when it runs out", "most correct in 30 seconds".
//
//               A game like that needs no netcode at all. Every phone plays the
//               same challenge from the same seed at the same time, alone, and
//               the scores are compared — which is also the only version that
//               scales past two players, because there is no reason four
//               solitaires cannot run at once.
//
//   'local'     Everything else. Air hockey, tank duels, sumo, Four in a Row —
//               these are one simulation two people reach into. Playing them
//               across devices means agreeing on a physics step and reconciling
//               input latency, which is a different and much larger job. They
//               remain two-player games on one phone, where they work.
//
// This table is the one place that distinction is written down. `_contest()`
// in GameController asks it what to do with a round.
export const MG_NET = {
    sumospheres: 'local',
    tankclash:   'local',
    rhythmforge: 'local',
    orbdeflect:  'local',
    snapstrike:  'parallel',
    quickdraw:   'local',      // "first finger wins" — a race, not two scores
    gridrecall:  'local',      // likewise: the round goes to whoever finishes first
    oddoneout:   'parallel',
    steadyhand:  'parallel',
    sortrush:    'local',
    meteordodge: 'parallel',
    lootcatch:   'parallel',
    freeze:      'local',
    clearout:    'local',
    puck:        'local',
    penalty:     'local',
    lightcycles: 'local',
    fourinarow:  'local',
    memorymatch: 'local',
    bombpass:    'local',
    grandprix:   'local',
    treeclimb:   'parallel',
};

// The parallel games whose SCORE is also a coin haul.
//
// Loot Catch and Tree Climb are the roster's payday games: what you catch or
// climb past is money, and everybody keeps theirs whether they win the round or
// not. Offline the game hands the manager a payout array. Played across phones
// there is no such array — each device reports one number — so this says which
// games' numbers are coins, and what the most any one round may pay is.
//
// The cap matters. A score is reported by a client, and a client is a device
// somebody else is holding: an uncapped payout would make "how many coins do I
// have" a thing another player's phone gets to assert.
export const MG_PAYOUT = {
    // Each game's own ceiling, matched to the MAX_PAYOUT it enforces offline —
    // a cap here that is higher than the one the game applies would pay out
    // amounts the game cannot actually produce, and would only ever be reached
    // by a score that did not come from playing it.
    lootcatch: 30,
    treeclimb: 30,
};

// How a parallel game is described when it is being played ACROSS PHONES.
//
// Every description in MG_INFO was written for two people sharing one screen,
// and says so: "your half", "three lives each", "both of you are looking at the
// same one". Alone on your own phone, with three other people doing the same
// thing on theirs, all of that is wrong — and it is wrong in the specific way
// that makes somebody look for a second player who is not there.
export const MG_NET_INFO = {
    meteordodge: 'Drag your pod along the bottom to dodge the falling meteors. Three lives — lose them all and your round is over. The storm gets faster and thicker as it goes. Everyone is dodging the same storm at the same time: survive longest with the most lives.',
    lootcatch:   '💰 PAYDAY — every coin you catch is REAL money and you keep it whatever happens. Slide your basket to grab 🪙 coins and 💎 gems (worth 3), and dodge every 💣. The same loot falls on every phone. Biggest haul takes the round — but nobody leaves empty-handed.',
    steadyhand:  'A target drifts around your screen — keep your finger on it to bank time. It speeds up as the round goes on. The same target, on the same path, on every phone: whoever holds it longest wins.',
    oddoneout:   'Every tile on your grid is the same shade except one. Tap the odd tile and a fresh, harder grid appears — more tiles, subtler difference. A wrong tap locks you out briefly. Everyone gets the same grids: most found in 30 seconds wins.',
    snapstrike:  'A needle sweeps your bar — tap to lock it on the bullseye. PERFECT, GREAT and GOOD snaps score 3, 2 and 1. Five rounds, the bar speeding up and the target shrinking. The same bullseye on every phone: highest total wins.',
    treeclimb:   '🪙 PAYDAY — 30 seconds, and coins bank as you climb. A leaf sprouts LEFT or RIGHT: tap that side to jump onto it. Sides do not just alternate, so watch it. Grab the wrong side and you fall to the last branch on THAT side — but a fall never takes your coins back. Everyone climbs the same tree; highest takes the round.',
};

// ============================================================
// WHAT SHAPE EACH GAME IS
// ============================================================
// Two questions decide everything about how a minigame scales past two people,
// and neither of them is about the verb:
//
//                    │ ONE SHARED PLAYFIELD │ ONE PLAYFIELD EACH
//   ─────────────────┼──────────────────────┼────────────────────
//   everyone at once │        ARENA         │       SPLIT
//   one at a time    │        TABLE         │       RELAY
//
// The whole roster was built as SPLIT-or-ARENA at exactly two seats, because
// two seats is what a face-off screen has. The table below is the audit: what
// each game actually IS, which is what says whether a third player costs a
// 76 px control band (ARENA), a 34 px banner (TABLE, RELAY), or half of
// somebody's playfield (SPLIT — the only one that does not fit on a phone).
//
// docs/MINIGAME_RULEBOOK.md is the long version; src/config/MinigameLayout.js
// is the geometry. This is only the classification.
//
// It lines up with MG_NET, and it explains it: every 'parallel' game is a
// SPLIT, because a game with no shared playfield is exactly the game that needs
// no netcode. The reverse does not hold — Grid Recall is a SPLIT whose rounds
// are decided by who finishes FIRST, so its finish line is shared even though
// its grids are not, and that is what keeps it 'local'.
export const MG_SHAPE = {
    sumospheres: 'arena',   // one arena, both spheres in it
    tankclash:   'arena',   // one battlefield, shots cross it
    rhythmforge: 'relay',   // alternating turns; one player plays at a time
    orbdeflect:  'arena',   // one orb crossing one middle
    snapstrike:  'split',   // a bar each, a shared clock
    quickdraw:   'arena',   // one signal, first finger takes it
    gridrecall:  'split',   // a grid each — but the ROUND goes to whoever finishes first
    oddoneout:   'split',
    steadyhand:  'split',
    sortrush:    'arena',   // one shape in the middle, both racing for it
    meteordodge: 'split',
    lootcatch:   'split',
    freeze:      'arena',   // one crown, one track, one eye watching both
    clearout:    'arena',   // discs cross the wall onto their side
    puck:        'arena',
    penalty:     'arena',   // + ASYM: the two seats are doing different jobs
    lightcycles: 'arena',
    fourinarow:  'table',
    memorymatch: 'table',
    bombpass:    'arena',
    grandprix:   'arena',   // one track, both cars, one camera
    treeclimb:   'split',
};

// Modifiers laid over a shape: the seats do not have the same job (ASYM), or
// four seats play as two sides (TEAMS). Neither changes where anybody sits.
export const MG_MODIFIER = {
    penalty: 'asym',        // one shoots, one keeps, then they swap
};

/** Games of one shape, in registry order. */
export const shapeIs = shape => MG_TYPES.filter(t => MG_SHAPE[t] === shape);

/** The games that can be played across phones, in registry order. */
export const MG_PARALLEL = MG_TYPES.filter(t => MG_NET[t] === 'parallel');

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

// ============================================================
// THE PROFILE — four properties per game, three surfaces derived
// ============================================================
// A game is playable on three surfaces and each is blocked by something
// completely different (docs/MINIGAME_LIBRARY_PLAN.md):
//
//   SHARED · 2P     nothing blocks it. A phone half is 412x400 and the whole
//                   roster was built for exactly that.
//   SHARED · 3-4P   the CONTROL LAW — a quarter screen holds one thumb — and
//                   the SPLIT LAW — a private playfield each needs a tablet.
//   SEPARATE · 2-4P netcode. Command versus contact.
//
// Those three could be three hand-written lists. They are not, because this
// repo has stored the same fact twice before — MG_NET and MG_SHAPE — and they
// drifted, and a probe had to be written to catch it. Three lists over
// twenty-two games would drift by the third new game.
//
// So four properties are AUTHORED per game and the three surfaces are DERIVED
// from them plus the shape MG_SHAPE already carries. Adding a game means
// answering four questions; its badges then compute themselves.
//
//   genre    what the player DOES. The visible sub-category, and the only one
//            of the four a player ever sees. People browse by verb.
//   control  how much of a screen one player's controls need:
//              'tap'   one finger, anywhere in your zone      (Quick Draw)
//              'thumb' one continuous drag or hold            (Sumo, Puck)
//              'dual'  two hands — a stick AND an action      (Tank Clash)
//            Only 'dual' fails the control law, because two hands do not fit
//            in a quarter screen. It says nothing about separate devices,
//            where everybody has a whole screen and both hands.
//   wire     what has to cross the wire for this to be played on four devices,
//            cheapest first — see docs/MINIGAME_CATEGORIES.md §3:
//              'none'     seeded solitaire; nothing crosses at all
//              'stamp'    a timestamp per player (a signal race)
//              'scalar'   one number per player, a few times a second
//              'events'   discrete decisions, replayed identically everywhere
//              'snapshot' host-authoritative entity state at ~20 Hz
//              'exact'    the player's own timing IS the collision. Not online.
//   seats    what the MECHANIC supports, which is neither of the above. Puck
//            is one thumb and would fit four quarter-screens; two goals and
//            four mallets is still a maul.
//   roomy    TRUE when this game's per-player ZONE needs more than a quarter
//            of a phone — a playfield with motion in it rather than a bar or a
//            button cluster. Only meaningful on a converted game, and it is
//            what puts one behind a tablet.
//   live     TRUE when the game actually plays every seat AT ONCE, on one
//            shared screen, right now — N slots, N zones, one winner.
//
//            This is the honest one, and it is deliberately not derived from
//            anything. A game can pass the control law, support four seats in
//            principle, and still be two hard-coded halves in its source; that
//            game is not playable by four people and no amount of reasoning
//            about its mechanic changes it. `live` is a statement about the
//            CODE, set only when the conversion is done.
//
//            It is also why the earlier "a tablet fits 14" claim has come down.
//            Seven of those fourteen are seeded solitaires, and the plan for
//            them at 3-4 was a relay — one player at a time. Under "nobody
//            waits" a relay is not an answer, and running four at once is not
//            available either: each game is a module-level singleton with one
//            set of state, so there is no way to have four of it on a screen.
//            They stay two-player on one device and four-player across four.
export const MG_GENRES = {
    reflex:   { name: 'REFLEX',   blurb: 'Fastest finger wins.' },
    nerve:    { name: 'NERVE',    blurb: 'Hold it, time it, don\'t flinch.' },
    scramble: { name: 'SCRAMBLE', blurb: 'Dodge the falling, grab the good.' },
    aim:      { name: 'AIM',      blurb: 'Hit the thing you are pointing at.' },
    push:     { name: 'PUSH',     blurb: 'Take the space, shove them out.' },
    race:     { name: 'RACE',     blurb: 'First past the post.' },
    brain:    { name: 'BRAIN',    blurb: 'Remember it, outthink them.' },
};

export const MG_PROFILE = {
    quickdraw:   { genre: 'reflex',   control: 'tap',   wire: 'stamp',    seats: [2, 4], live: true },
    sortrush:    { genre: 'reflex',   control: 'tap',   wire: 'stamp',    seats: [2, 4], live: true },
    snapstrike:  { genre: 'reflex',   control: 'tap',   wire: 'none',     seats: [2, 4], live: true },

    // roomy: the target drifts, so a zone has to be somewhere to drift in. A
    // quarter of a phone is 206x400 and the target would be off a wall every
    // second.
    steadyhand:  { genre: 'nerve',    control: 'thumb', wire: 'none',     seats: [2, 4], live: true, roomy: true },
    rhythmforge: { genre: 'nerve',    control: 'tap',   wire: 'exact',    seats: [2, 2], live: false },
    freeze:      { genre: 'nerve',    control: 'thumb', wire: 'scalar',   seats: [2, 4], live: false },

    meteordodge: { genre: 'scramble', control: 'thumb', wire: 'none',     seats: [2, 4], live: false },
    lootcatch:   { genre: 'scramble', control: 'thumb', wire: 'none',     seats: [2, 4], live: false },
    // roomy: the stem scrolls vertically at 74 px a branch, so a zone needs
    // height to read as a climb. A phone quarter is 400 px — five branches of
    // visible tree — which is not a race you can see coming.
    treeclimb:   { genre: 'scramble', control: 'tap',   wire: 'none',     seats: [2, 4], live: true, roomy: true },

    tankclash:   { genre: 'aim',      control: 'dual',  wire: 'snapshot', seats: [2, 4], live: false },
    penalty:     { genre: 'aim',      control: 'thumb', wire: 'exact',    seats: [2, 2], live: false },
    clearout:    { genre: 'aim',      control: 'thumb', wire: 'events',   seats: [2, 4], live: false },
    orbdeflect:  { genre: 'aim',      control: 'thumb', wire: 'exact',    seats: [2, 2], live: false },

    sumospheres: { genre: 'push',     control: 'thumb', wire: 'snapshot', seats: [2, 4], live: false },
    lightcycles: { genre: 'push',     control: 'thumb', wire: 'events',   seats: [2, 4], live: false },
    puck:        { genre: 'push',     control: 'thumb', wire: 'exact',    seats: [2, 2], live: false },
    bombpass:    { genre: 'push',     control: 'tap',   wire: 'exact',    seats: [2, 2], live: false },

    grandprix:   { genre: 'race',     control: 'thumb', wire: 'scalar',   seats: [2, 4], live: false },

    memorymatch: { genre: 'brain',    control: 'tap',   wire: 'exact',    seats: [2, 2], live: false },
    fourinarow:  { genre: 'brain',    control: 'tap',   wire: 'exact',    seats: [2, 2], live: false },
    // 'stamp', not 'none'. The grids are private but the FINISH LINE is shared —
    // the round goes to whoever completes the pattern first — so it is a race
    // against the others rather than a score compared afterwards, and a race
    // needs each device to report when it finished. That shared finish is also
    // why MG_NET has always had it as 'local' rather than 'parallel'.
    gridrecall:  { genre: 'brain',    control: 'tap',   wire: 'stamp',    seats: [2, 4], live: false },
    // roomy: the grid climbs to 5x5 as you score, and a fifth of a phone quarter
    // is a 34 px tile — under the 44 px the control law asks for. On a tablet
    // quarter the same grid is 68 px a side, so 3-4 seats is a tablet game.
    oddoneout:   { genre: 'brain',    control: 'tap',   wire: 'none',     seats: [2, 4], live: true, roomy: true },
};

// The order the wire tiers come in, cheapest first. Used by the READINESS sort:
// the build queue for online play is exactly this order.
export const MG_WIRE_ORDER = ['none', 'stamp', 'scalar', 'events', 'snapshot', 'exact'];

/** The profile for `type`, with safe defaults for anything unclassified. */
export function profileOf(type) {
    return MG_PROFILE[type] || { genre: 'reflex', control: 'thumb', wire: 'exact', seats: [2, 2] };
}

/**
 * The three surfaces `type` can be played on.
 *
 * THIS IS THE DERIVATION. Nothing else in the codebase may hand-maintain a list
 * of what plays where; ask here instead. `qa/surfaces.js` holds it to a
 * hand-written expectation so a wrong property shows up as a failing assertion
 * rather than as a game nobody can start.
 */
export function surfacesOf(type) {
    const p = profileOf(type);
    const [minSeats, maxSeats] = p.seats;
    // Does this game's ZONE need more than a quarter of a phone?
    //
    // Not the same question as MG_SHAPE, and deriving it from there was wrong.
    // MG_SHAPE says whether players have private playfields; the split law's
    // 300x300 floor applies to a playfield with MOTION in it — a storm to dodge,
    // an arena to steer around. Snap Strike's private thing is a BAR and a tap
    // zone, and a bar is perfectly happy in 206x400.
    //
    // So it is authored, not inferred. `roomy` is set only when a game has been
    // converted AND its zone genuinely wants the room.
    const needsTablet = !!p.roomy;
    // LIVE is the gate, not a bonus on top of it. A game that is not live does
    // not play three or four people on one screen, whatever its mechanic could
    // support — the code has two slots and that is the whole story.
    const manyOk = !!p.live && maxSeats >= 3 && p.control !== 'dual';
    return {
        sharedTwo:  minSeats <= 2,
        sharedMany: manyOk,
        // 'tablet' where a private playfield each is needed, 'any' otherwise.
        manyDevice: manyOk ? (needsTablet ? 'tablet' : 'any') : null,
        online:     p.wire !== 'exact',
        onlineNow:  p.wire === 'none',   // the six that already run across phones
    };
}

/**
 * Why a game is NOT available on a surface, in the words a person would use.
 *
 * Greyed with a reason, never hidden — the documented practice for
 * context-dependent unavailability, and doubly so in a testing area where
 * "why isn't this here" is the question being asked.
 */
export function blockedReason(type, surface) {
    const p = profileOf(type);
    const s = surfacesOf(type);
    if (surface === 'many' && !s.sharedMany) {
        if (p.control === 'dual') return 'Two-handed controls — won\'t fit a quarter screen.';
        if (p.seats[1] <= 2)      return 'Built for two — the mechanic doesn\'t open up.';
        return 'Not converted yet — still two slots in code.';
    }
    if (surface === 'online' && !s.online) {
        return p.seats[1] <= 2 && MG_SHAPE[type] === 'table'
            ? 'Taken in turns — three would be watching.'
            : 'Frame-exact contact — 2P only.';
    }
    return '';
}

/** Every game playable on `surface` ('two' | 'many' | 'online'), in registry order. */
export function typesForSurface(surface) {
    return MG_TYPES.filter(t => {
        const s = surfacesOf(t);
        if (surface === 'many')   return s.sharedMany;
        if (surface === 'online') return s.online;
        return s.sharedTwo;
    });
}
