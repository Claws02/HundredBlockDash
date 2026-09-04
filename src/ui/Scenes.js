// ============================================================
// SCENES — the beats of a turn, named so they can be mirrored
// ============================================================
// A snapshot says what the game IS. It does not say what is on screen, and in
// this game those are different things: "the result card is up, headed MAGNET,
// reading you pulled 5 coins out of Ana's pocket" is presentation the host
// composed, not state a client can derive from coin totals.
//
// So every full-screen beat announces itself here on the way up. Offline
// nothing is listening and this costs one function call. Online the host mirrors
// the announcement to the other phones, which replay it locally.
//
// SHARED vs OWNER — this is the whole design, and getting it wrong makes the
// game unplayable rather than merely wrong:
//
//   SHARED beats belong to the table. A minigame result, the gate opening, the
//   buddy report, the win screen: everybody looks at these at the same time, so
//   they go to every phone.
//
//   OWNER beats belong to one player. The shop, the item bag, the discard
//   picker, the duel wager, the junction fork: these are one person's decision.
//   Putting the shop on all four phones would not be "the same screen", it
//   would be three people staring at somebody else's shopping. The other
//   phones get a waiting line instead.
//
// This module holds no DOM and no game state. It is a named hook and a
// classification, so `src/net/` can subscribe without `src/ui/` importing it.

export const TIER = { SHARED: 'shared', OWNER: 'owner' };

// Every mirrored beat, and who it belongs to. A beat that is not in this table
// is NOT mirrored — that is the safe default, because a beat nobody thought
// about showing on the other phones is better than one that hijacks them.
export const SCENE_TIER = {
    message:      TIER.SHARED,   // the result / announcement card
    buddyReport:  TIER.SHARED,
    turnBanner:   TIER.SHARED,   // whose go it is — everybody needs to know
    // A beat the whole table has to acknowledge before anybody moves on.
    // `gateCount` keeps the waiting visible; `gateOpen` releases it. See
    // net/ReadyGate.js.
    gateCount:    TIER.SHARED,
    gateOpen:     TIER.SHARED,
    // Every animation on the board: the coin burst, the magnet, the saucer,
    // the gate shattering. SHARED because the board belongs to the table —
    // watching somebody else's turn is most of what a party game is, and a
    // spectator with a still board is watching nothing. See engine/Fx.js.
    fx:           TIER.SHARED,
    rollCallout:  TIER.SHARED,   // the number, at size, before the token moves
    gate:         TIER.SHARED,   // the gate scene opens
    gateEnd:      TIER.SHARED,   // ...and closes. A scene that can be raised on
                                 // another device has to be dismissable there
                                 // too, or it sits over the board forever.
    minigameIntro:TIER.SHARED,
    // A round of a parallel minigame. SHARED because everybody has to hear
    // about it at the same moment — the ones playing so they can start, and
    // the ones not playing so they are shown who is rather than a dead board.
    // The game itself is not mirrored: each device runs its own copy from the
    // announced seed, which is the whole point of a parallel game.
    soloGame:     TIER.SHARED,
    soloGo:       TIER.SHARED,   // the gate opened — everybody starts on this beat
    // The standings WHILE the round is being played. SHARED because it is the
    // only thing anybody can see of anybody else: on four phones a parallel
    // round is four people alone in a room, and a scoreboard that only appears
    // at the end is a contest nobody could feel while it was happening. It
    // paints a rail; it raises no overlay, so it is deliberately NOT in
    // BEAT_OVERLAYS — the devices are meant to differ underneath it.
    soloStand:    TIER.SHARED,
    soloResult:   TIER.SHARED,   // the scoreboard, which everybody reads
    // ...and the instruction to put it away. A round's screens are the one
    // beat the devices are deliberately out of step on — each player dismisses
    // their own card when they start playing — so the host cannot say "it is
    // over" merely by not having it up any more. It has to say so.
    soloClose:    TIER.SHARED,
    winScreen:    TIER.SHARED,   // the match is over — see NetGame's replay:
                                 // clients render the host's final figures
                                 // rather than re-scoring the match.
    closeAll:     TIER.SHARED,   // "whatever was up, take it down"

    // Any modal raised through showModal() that needs nothing but its own id
    // to be reproduced — the shop offer, the dice picker, the pass prompt.
    modal:        TIER.OWNER,
    shop:         TIER.OWNER,
    useItems:     TIER.OWNER,
    dropPick:     TIER.OWNER,
    duelBet:      TIER.OWNER,
    junction:     TIER.OWNER,
    allyEncounter:TIER.OWNER,
    allySteal:    TIER.OWNER,
};

// Modals whose OPENER announces them with content the client cannot rebuild
// from a snapshot — the shop's stock and discount, the bag's contents, the
// wager's limits, the card's own text. Those keep their own scene above and are
// skipped by the generic announcement in showModal(), or they would go out
// twice.
//
// Everything NOT in here is announced by showModal() itself. That is the point:
// three separate stalls in networked play were a modal raised through a path
// that forgot to announce it, the last one because `_checkPassThroughShop`
// calls showModal('shop-offer-modal') directly rather than going through
// showShopOffer(). Announcing at the single place a modal actually goes up is
// the only version of this that cannot be forgotten.
export const SELF_ANNOUNCING = new Set([
    'msg-modal', 'shop-modal', 'use-modal', 'drop-modal', 'duel-modal',
]);

const _subs = [];
let _replaying = false;

/** Subscribe to beats. `fn(name, payload, tier)`. */
export function onScene(fn) {
    _subs.push(fn);
    return () => { const i = _subs.indexOf(fn); if (i >= 0) _subs.splice(i, 1); };
}

/**
 * Announce a beat. Called by whoever raises it, immediately before it goes up.
 *
 * `_replaying` guards the obvious loop: a client replaying a mirrored beat
 * calls the same UI function, which announces the beat again. Without this the
 * first mirrored modal would echo back and forth forever.
 */
export function emit(name, payload) {
    if (_replaying) return;
    const tier = SCENE_TIER[name];
    if (!tier) return;
    _subs.slice().forEach(fn => {
        try { fn(name, payload || {}, tier); }
        catch (e) { console.error('[scene] listener failed:', name, e); }
    });
}

/** Run `fn` without its beats being re-announced. Used by the client replayer. */
export function replaying(fn) {
    _replaying = true;
    try { return fn(); } finally { _replaying = false; }
}

export function isReplaying() { return _replaying; }
