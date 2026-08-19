// ============================================================
// SCENE TIMING — how long each beat of a turn is allowed to hold the screen.
//
// A turn is a short scene with a fixed shape:
//
//   PRE_ROLL → dice fly → dice read → token hops → token lands → result card
//            → board breathes → (minigame | shop | next player)
//
// Every value below is a FLOOR in milliseconds: the minimum time that beat owns
// the screen before the next one is allowed to start. They are floors, not
// fixed waits — if the animation or the player takes longer, the beat lasts
// longer. Nothing here delays a player's own input; the floors govern how fast
// the *game* is allowed to move on.
//
// These were previously ~30 anonymous setTimeout literals scattered through
// GameController, with no rule that two beats couldn't overlap. The result was
// that tapping CONTINUE on "+8 coins" handed the screen to the minigame
// selector 300 ms later, so the payoff was never actually read.
//
// Tuned against measurements from `qa/scenes.js`. Re-run it after changing
// anything here.
// ============================================================

export const SCENE = {
    // ── Rolling ──────────────────────────────────────────────────────────────
    // Beat between committing to the roll and the dice leaving the hand. Short:
    // the player just acted and wants to see a reaction.
    ROLL_LAUNCH:     220,
    // The dice have settled and the number is legible. Holding here is what
    // makes the roll feel like a result rather than a loading step. 850 ms was
    // not enough to read a number and register it before the token set off;
    // a second and a half is.
    DICE_READ:      1500,

    // ── Moving ───────────────────────────────────────────────────────────────
    // Between the token arriving and the result card appearing. Long enough to
    // register *where* you landed before being told what it means.
    LAND_SETTLE:     420,
    // Pass-through shop prompt gets its own beat so it doesn't collide with the
    // hop that triggered it.
    PASSTHROUGH:     320,
    // A route has been chosen at a fork. The camera turns to face the chosen
    // road and eases down from the junction's overhead shot BEFORE the token
    // starts walking it. Without this the player set off down a road the camera
    // had not reached yet, and landed before the view caught up.
    JUNCTION_COMMIT: 620,
    // The token has arrived and the camera is on it. This is the window in which
    // you see WHERE you are, before anything is done to you.
    LAND_ARRIVE:     500,

    // ── The payoff ───────────────────────────────────────────────────────────
    // THE important one. The result card must own the screen for this long
    // before anything else may start — including the minigame hand-off. On a
    // human turn the card also waits for a tap; this floor is what protects the
    // bot's turns and stops the next scene starting underneath.
    LAND_RESULT:    3000,
    // A bot turn has no tap to wait for, so this is the whole readable window.
    // Deliberately equal to LAND_RESULT: you should be able to read what your
    // opponent got just as easily as what you got.
    BOT_RESULT:     3000,
    // Boost re-rolls chain into another roll, so they get a touch more air.
    BOOST_RESULT:   3400,

    // ── Between scenes ───────────────────────────────────────────────────────
    // The board on its own after a result closes. Without this the screen never
    // rests and the whole match reads as one continuous smear.
    POST_RESULT:     650,
    // Beat before the minigame takes over the screen. This is the gap the
    // original flow did not have at all.
    PRE_MINIGAME:   1100,
    // Beat after a minigame result modal closes, before play resumes.
    POST_MINIGAME:   700,
    // Handing the turn over — long enough to notice the HUD change hands.
    TURN_HANDOFF:    600,

    // ── Opening ──────────────────────────────────────────────────────────────
    // The establishing shot. It is the only chance to see the whole board, so
    // it is paced to be read, not skipped past — the previous 5.5 s / 4.5 s
    // sweeps moved faster than you can take a board in.
    FLYOVER_HBD:    11000,
    FLYOVER_CITY:    9000,

    // ── Set pieces ───────────────────────────────────────────────────────────
    REALM_BANNER:   2400,   // realm-entry cinematic
    GATE_RESULT:    2200,   // gate roll succeeded/failed, before the modal
    GATE_RESUME:    1600,   // gate opened, before banked movement resumes
    SHOP_OPEN:       400,   // landing resolves, then the shop slides in
    DUEL_OPEN:       450,
    WIN_SCREEN:     2800,   // final result modal before the win screen

    // ── UI element lifetimes ─────────────────────────────────────────────────
    SPACE_CARD:     3600,   // the on-board "what this space does" card
    TOAST:          2600,
    // Whose-turn banner. Long enough to read across a table, short enough that
    // it is gone before anyone reaches for the roll button.
    TURN_BANNER:    1700,
};

// Bot "thinking" pauses. Separate from the beat floors because these are about
// making the opponent feel like it is deciding, not about readability.
export const BOT_THINK = {
    PRE_ROLL:       1200,
    BRANCH:          600,
    GATE_ROLL:      1400,
    GATE_CLOSE:     2200,
    SHOP:           1000,
};

// A scene may be skipped to this fraction of its floor when the player has
// already acknowledged it (tapped CONTINUE). Keeps an eager tapper moving
// without letting two scenes render at once.
export const ACK_SKIP = 0.34;
