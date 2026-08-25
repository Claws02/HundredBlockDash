// ============================================================
// NET DICE — a real throw on the phone that did not throw it
// ============================================================
// The dice were the last thing a joined player could not see, and the first
// answer here was that they could not have them: cannon.js is not
// deterministic across devices, so a client cannot reproduce the host's throw,
// and inventing one risks showing a face that disagrees with the result.
//
// That reasoning was right about determinism and wrong about what to do with
// it. The dice are not how the number is decided — the host decided it before
// any client hears anything. The dice are the SEVEN SECONDS in which nobody
// knows it yet, and cutting a spectator out of those is cutting them out of the
// only suspense in a turn. Watching the other player's roll is most of what
// sitting out a turn is for.
//
// So a client throws its own dice, and never reads them:
//
//   • They start when a snapshot says the host is ROLLING — no new message is
//     needed, the state was arriving anyway.
//   • They tumble with their own random velocities, which is fine precisely
//     because nothing is read off them.
//   • They are cleared the instant the roll callout arrives with the real
//     number. A die is only readable at rest, and these never get there.
//
// The number of record is the host's, arrives as its own mirrored beat, and is
// the only thing on screen that ever states a value.

import { state } from '../core/GameState.js';
import * as Physics from '../engine/Physics.js';
import * as Renderer from '../engine/Renderer.js';

let _rolling = false;

/**
 * Called on every applied snapshot. Starts a tumble when the host begins
 * rolling and stops one when it is no longer rolling for any reason — the
 * result arriving, the turn being abandoned, a disconnect mid-throw.
 */
export function syncFromSnapshot(gs) {
    const shouldRoll = gs === 'ROLLING';
    if (shouldRoll === _rolling) return;
    _rolling = shouldRoll;
    shouldRoll ? _throw() : stop();
}

/** The real number has arrived; the props have done their job. */
export function stop() {
    _rolling = false;
    try { Physics.clearDice(Renderer.getDiceGroup()); }
    catch (e) { /* the board may not be built yet */ }
}

function _throw() {
    const p = state.players[state.activePlayer];
    if (!p || !p.mesh) { _rolling = false; return; }
    try {
        const group = Renderer.getDiceGroup();
        Physics.clearDice(group);
        // Thrown from the roller's token toward the camera, the same shape the
        // host's throw has — the point is that it looks like somebody over
        // there threw them, not that it matches frame for frame.
        const cam = Renderer.getCamera();
        const from = p.mesh.position;
        Physics.positionWalls(from.x, 0, from.z, 8);
        const dir = cam
            ? from.clone().sub(cam.position).setY(0).normalize()
            : new THREE.Vector3(0, 0, -1);
        if (!isFinite(dir.x) || dir.lengthSq() < 0.001) dir.set(0, 0, -1);

        const d = Physics.spawnDie(group);
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
        const sp = 8 + Math.random() * 12, up = 10 + Math.random() * 6, spin = 14 + Math.random() * 12;
        d.body.position.set(from.x + dir.x * 1.5, from.y + 2.5, from.z + dir.z * 1.5);
        const sc = (Math.random() - 0.5) * 2;
        d.body.velocity.set(dir.x * sp + right.x * sc, up, dir.z * sp + right.z * sc);
        d.body.angularVelocity.set(
            (Math.random() - 0.5) * spin * 2,
            (Math.random() - 0.5) * spin * 2,
            (Math.random() - 0.5) * spin * 2);
    } catch (e) {
        console.warn('[netdice] could not throw:', e);
        _rolling = false;
    }
}
