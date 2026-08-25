// ============================================================
// FX — the effects, described as data so another phone can play them
// ============================================================
// A snapshot says what the game IS. `Scenes` says which card is on screen.
// Neither says that five coins just flew out of Ana's pocket, that the saucer
// is overhead, or that the gate has shattered — and those are most of what a
// turn actually looks like.
//
// Reported from two devices: the host phone showed every animation, the
// computer that joined showed nothing but the pop-ups. The board was correct on
// both — the client's token really does walk, and its camera really does follow
// (qa/netfx.js measures both, and they match the host's). What was missing was
// everything AROUND the token, which is what made a live board look dead.
//
// So: one call that plays an effect here AND tells everybody else to play it.
//
// THE RULE THAT MAKES THIS WORK: an effect is named by DATA a client can
// resolve on its own — a node id, a seat number, a count. Never a world
// vector, never a mesh, never a player object. `Renderer.getPos('r14')` gives
// the same point on every device; a `THREE.Vector3` sent over the wire is three
// numbers that were true on one phone's board at one instant.
//
// The `onDone` continuations stay local and are the host's alone. They advance
// the turn, and a client must never advance anything — its copy runs for the
// look of the thing and hands back to nobody.

import * as SetPieces from './SetPieces.js';
import * as Renderer from './Renderer.js';
import * as Scenes from '../ui/Scenes.js';
import { state } from '../core/GameState.js';

const _pos  = node => Renderer.getPos(node);
const _seat = id => state.players[id];

// Every effect, and how to play one from its data. Anything not in here is not
// mirrored — the same safe default as SCENE_TIER.
const FX = {
    coinPop:      (a, done) => { SetPieces.coinPop(_pos(a.node), !!a.big); done && done(); },
    finePop:      (a, done) => { SetPieces.finePop(_pos(a.node), !!a.big, a.lost !== false); done && done(); },
    trucePop:     (a, done) => { SetPieces.trucePop(_pos(a.a), _pos(a.b)); done && done(); },
    shopGlow:     (a, done) => { SetPieces.shopGlow(_pos(a.node)); done && done(); },
    mysteryUnbox: (a, done) => SetPieces.mysteryUnbox(_pos(a.node), done || (() => {})),
    anchorSpring: (a, done) => SetPieces.anchorSpring(_pos(a.node), done || (() => {})),
    gateBreach:   (a, done) => SetPieces.gateBreach(_pos(a.node), done || (() => {})),
    allyArrival:  (a, done) => SetPieces.allyArrival(_pos(a.node), done || (() => {})),
    magnetPull:   (a, done) => SetPieces.magnetPull(_seat(a.thief), _seat(a.victim), a.coins, done || (() => {})),
    hqPayout:     (a, done) => SetPieces.hqPayout(_seat(a.seat), a.amount, done || (() => {})),
    duelFaceoff:  (a, done) => SetPieces.duelFaceoff(_seat(a.a), _seat(a.b), done || (() => {})),
    swap:         (a, done) => Renderer.playSwapCinematic(_seat(a.a), _seat(a.b), done || (() => {})),
};

export const FX_NAMES = Object.keys(FX);

/**
 * Play `name` here, and mirror it to every other device.
 *
 * `done` is the host's continuation and never crosses the wire. A replayed
 * effect gets a no-op, so the animation runs and then stops — which is exactly
 * right, because whatever happens next is the host's decision and arrives as a
 * snapshot.
 */
export function play(name, args, done) {
    const fn = FX[name];
    if (!fn) { console.warn('[fx] unknown effect', name); done && done(); return; }
    Scenes.emit('fx', { fx: name, args: args || {} });
    fn(args || {}, done);
}

/** Replay an effect that arrived from the host. Continuations are not ours. */
export function replay(name, args) {
    const fn = FX[name];
    if (!fn) return;
    // A set piece that throws on a client must not take the render loop with
    // it: the client is a spectator here and a missing prop is cosmetic.
    try { fn(args || {}, null); }
    catch (e) { console.warn('[fx] replay failed:', name, e); }
}
