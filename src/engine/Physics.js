// ============================================================
// PHYSICS — Cannon.js dice simulation
// Relies on the global CANNON object from the CDN script.
// Call init() once, then use the public API.
// ============================================================

let world, floorMat, diceMat;
let w1, w2, w3, w4; // wall bodies for bounding the dice roll
const activeDice = [];
let _onSettle  = null;
let _rollMode  = 'normal';
let _settled   = false;
let _settleDeadline = 0;

export function init() {
    world = new CANNON.World();
    world.gravity.set(0, -60, 0);
    // Per-body allowSleep only takes effect when the world permits sleeping.
    world.allowSleep = true;

    floorMat = new CANNON.Material('floor');
    diceMat  = new CANNON.Material('dice');
    world.addContactMaterial(
        new CANNON.ContactMaterial(floorMat, diceMat, { friction: 0.3, restitution: 0.4 })
    );

    const floorBody = new CANNON.Body({ mass: 0, material: floorMat });
    floorBody.addShape(new CANNON.Plane());
    floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(floorBody);

    const ws = new CANNON.Box(new CANNON.Vec3(20, 20, 1));
    w1 = new CANNON.Body({ mass: 0 }); w1.addShape(ws); world.addBody(w1);
    w2 = new CANNON.Body({ mass: 0 }); w2.addShape(ws); world.addBody(w2);
    w3 = new CANNON.Body({ mass: 0 }); w3.addShape(ws);
    w3.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2); world.addBody(w3);
    w4 = new CANNON.Body({ mass: 0 }); w4.addShape(ws);
    w4.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2); world.addBody(w4);
}

// Position the wall cage around a point so dice stay near the player
export function positionWalls(x, y, z, radius = 8) {
    w1.position.set(x,     0, z - radius);
    w2.position.set(x,     0, z + radius);
    w3.position.set(x - radius, 0, z);
    w4.position.set(x + radius, 0, z);
}

const diceFaceCache = {};
function getCachedDiceFace(v) {
    if (diceFaceCache[v]) return diceFaceCache[v];
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, 64, 64);
    cx.fillStyle = '#000';
    const dots = [
        [], [[28, 28]], [[12, 12], [44, 44]], [[12, 12], [28, 28], [44, 44]],
        [[12, 12], [44, 12], [12, 44], [44, 44]],
        [[12, 12], [44, 12], [28, 28], [12, 44], [44, 44]],
        [[12, 8], [44, 8], [12, 28], [44, 28], [12, 48], [44, 48]],
    ];
    (dots[v] || []).forEach(([dx, dy]) => cx.fillRect(dx, dy, 8, 8));
    const tex = new THREE.CanvasTexture(c);
    diceFaceCache[v] = tex;
    return tex;
}

export function spawnDie(diceGroup) {
    const size = 0.9;
    const geo  = new THREE.BoxGeometry(size * 2, size * 2, size * 2);
    const mats = [4, 3, 1, 6, 2, 5].map(v =>
        new THREE.MeshStandardMaterial({ color: 0xffffff, map: getCachedDiceFace(v) })
    );
    const mesh = new THREE.Mesh(geo, mats);
    mesh.castShadow = true;
    diceGroup.add(mesh);

    // Damping governs how fast a die actually comes to rest, and it has to be
    // strong enough to reach the sleep threshold in a readable amount of time.
    // At angularDamping 0.4 spin decays as e^(-0.4t), so falling from ~22 rad/s
    // to the old 0.1 rad/s threshold took ~13 s — the dice never settled on
    // their own and every single roll sat until the safety timeout. Measured
    // median for the whole rolling beat was 7.4 s. At 0.85 the same decay takes
    // ~1.4 s, which is what a thrown die actually looks like.
    const body = new CANNON.Body({
        mass: 1, material: diceMat,
        linearDamping: 0.42, angularDamping: 0.85,
        allowSleep: true, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.15,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(size, size, size)));
    world.addBody(body);

    const die = { mesh, body };
    activeDice.push(die);
    return die;
}

export function clearDice(diceGroup) {
    activeDice.forEach(d => { diceGroup.remove(d.mesh); world.removeBody(d.body); });
    activeDice.length = 0;
    _onSettle = null;
    _settled  = false;
    _settleDeadline = 0;
}

export function readTopFace(d) {
    const faces = [
        { v: new THREE.Vector3(1, 0, 0),  val: 4 }, { v: new THREE.Vector3(-1, 0, 0), val: 3 },
        { v: new THREE.Vector3(0, 1, 0),  val: 1 }, { v: new THREE.Vector3(0, -1, 0), val: 6 },
        { v: new THREE.Vector3(0, 0, 1),  val: 2 }, { v: new THREE.Vector3(0, 0, -1), val: 5 },
    ];
    let mx = -1, val = 1;
    faces.forEach(f => {
        const dot = f.v.clone().applyQuaternion(d.mesh.quaternion).dot(new THREE.Vector3(0, 1, 0));
        if (dot > mx) { mx = dot; val = f.val; }
    });
    return val;
}

export function readResult(mode) {
    if (mode === 'cursed_forced') return Math.random() < 0.5 ? 1 : 2;
    if (mode === 'forced_5') return 5;
    if (mode === 'double' && activeDice.length === 2)
        return readTopFace(activeDice[0]) + readTopFace(activeDice[1]);
    // clearDice() can empty the array between settle detection and the deferred
    // face read (turn abandoned, minigame force-ended, rematch). Reading
    // activeDice[0].mesh then threw an uncaught TypeError and stranded the turn.
    if (activeDice.length === 0) {
        console.warn('[Physics] result read with no dice on the table — defaulting to 1');
        return 1;
    }
    return readTopFace(activeDice[0]);
}

// Register callback fired once all dice settle.
// A watchdog deadline guarantees the callback always fires: a die that jitters
// against a wall or lands on a corner can otherwise stay above the sleep
// threshold indefinitely, which strands the turn in the ROLLING state with no
// way out. On expiry we freeze the dice and read whatever faces are up.
// Below ~0.5 units/s a die's top face no longer changes.
const SETTLE_EPS2 = 0.25;
// Safety net only. With the damping above, a natural settle lands near 1.4 s,
// so reaching this means something is genuinely stuck.
const SETTLE_TIMEOUT_MS = 3200;
export function onSettle(mode, callback) {
    _rollMode  = mode;
    _onSettle  = callback;
    _settled   = false;
    _settleDeadline = performance.now() + SETTLE_TIMEOUT_MS;
}

export function getActiveDice() { return activeDice; }

// Called every frame by Renderer.step()
export function step(dt) {
    if (!world) return;
    // maxSubSteps must cover the worst frame time or the simulation silently
    // runs in slow motion: at 3 sub-steps a 100 ms frame advances only 50 ms of
    // physics, so on a slow device the dice take twice as long to settle as they
    // do on a fast one. 6 covers a 100 ms frame at the 1/60 fixed step.
    world.step(1 / 60, dt, 6);

    activeDice.forEach(d => {
        d.mesh.position.copy(d.body.position);
        d.mesh.quaternion.copy(d.body.quaternion);
    });

    if (_onSettle && activeDice.length > 0 && !_settled) {
        let allSleeping = true;
        activeDice.forEach(d => {
            if (d.body.sleepState === CANNON.Body.SLEEPING) return;
            const v = d.body.velocity, av = d.body.angularVelocity;
            // Squared magnitudes against SETTLE_EPS² — the face a die shows is
            // fixed long before it is perfectly still, so an over-tight
            // threshold only adds dead air.
            if (v.x * v.x + v.y * v.y + v.z * v.z > SETTLE_EPS2 ||
                av.x * av.x + av.y * av.y + av.z * av.z > SETTLE_EPS2) {
                allSleeping = false;
            }
        });
        const timedOut = _settleDeadline > 0 && performance.now() > _settleDeadline;
        if (allSleeping || timedOut) {
            _settled = true;
            if (timedOut) {
                console.warn('[Physics] dice did not settle in time — forcing a result');
                activeDice.forEach(d => { d.body.velocity.set(0, 0, 0); d.body.angularVelocity.set(0, 0, 0); });
            } else {
                activeDice.forEach(d => d.body.angularVelocity.set(0, 0, 0));
            }
            const cb = _onSettle;
            _onSettle = null;
            _settleDeadline = 0;
            // Double RAF ensures quaternion is fully flushed before reading faces
            requestAnimationFrame(() => requestAnimationFrame(() => cb(readResult(_rollMode))));
        }
    }
}
