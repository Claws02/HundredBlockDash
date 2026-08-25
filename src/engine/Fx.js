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

const _seat = id => state.players[id];

/**
 * Where an effect happens.
 *
 * A tile id resolves to the tile's centre, which is right for anything that
 * belongs to the SQUARE — a shop's glow, the gate shattering. But a burst of
 * coins belongs to the PLAYER, and above two seats the tokens stand offset
 * around the tile rather than on it, so a tile-centre pop would detach from
 * the piece it is about. Naming a seat uses that token's own position, which
 * is identical on every device (qa/netfx.js measures exactly this: the
 * client's token positions match the host's).
 */
function _pos(a) {
    if (typeof a.seat === 'number') {
        const p = state.players[a.seat];
        if (p && p.mesh) return p.mesh.position.clone();
    }
    return Renderer.getPos(a.node);
}

// Every effect, and how to play one from its data. Anything not in here is not
// mirrored — the same safe default as SCENE_TIER.
const FX = {
    coinPop:      (a, done) => { SetPieces.coinPop(_pos(a), !!a.big); done && done(); },
    finePop:      (a, done) => { SetPieces.finePop(_pos(a), !!a.big, a.lost !== false); done && done(); },
    trucePop:     (a, done) => { SetPieces.trucePop(Renderer.getPos(a.a), Renderer.getPos(a.b)); done && done(); },
    shopGlow:     (a, done) => { SetPieces.shopGlow(_pos(a)); done && done(); },
    mysteryUnbox: (a, done) => SetPieces.mysteryUnbox(_pos(a), done || (() => {})),
    anchorSpring: (a, done) => SetPieces.anchorSpring(_pos(a), done || (() => {})),
    gateBreach:   (a, done) => SetPieces.gateBreach(_pos(a), done || (() => {})),
    allyArrival:  (a, done) => SetPieces.allyArrival(_pos(a), done || (() => {})),
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

/**
 * Replay an effect that arrived from the host.
 *
 * The host's continuation is not ours — it advances the turn — but a replay
 * still needs ONE thing from it: the camera back.
 *
 * Most of these set pieces call `_takeCamera`, which parks `cameraState` on
 * 'CINEMATIC' precisely so the render loop stops driving it. On the host the
 * continuation ends with `endCinematic()`. Passing `null` here meant a client
 * that replayed a buddy arrival parked its camera and never moved it again —
 * reported from two devices as "the joined player's camera got stuck". So the
 * replay's continuation is exactly that one line and nothing else.
 *
 * This is belt; the braces are in NetSync, which mirrors the host's camera mode
 * on every snapshot and would fix a stuck camera even if this were forgotten.
 */
export function replay(name, args) {
    const fn = FX[name];
    if (!fn) return;
    const giveTheCameraBack = () => Renderer.endCinematic();
    // A set piece that throws on a client must not take the render loop with
    // it — nor may it strand the camera on the way out.
    try { fn(args || {}, giveTheCameraBack); }
    catch (e) { console.warn('[fx] replay failed:', name, e); giveTheCameraBack(); }
}
