// Boot Hill Barrage — two forts across a dry wash, and a cannon on each.
//
// The second game on the shared 3D stage. Each player's own figure stands on
// top of their fort beside a cannon. Drag BACK anywhere on your half — the
// further you pull, the harder it fires, and the angle you pull at is the
// angle it flies — then let go. Shells burst on whatever they hit. Each fort
// stands on a stone PEDESTAL, and to win you have to knock the whole of the
// rival's fort off theirs: every leg, plank, crate and the top. Sniping the
// top layer doesn't do it any more.
//
// Both cannons fire at once, on a reload. Nobody waits for a turn.
//
// THE PHYSICS
//   Every plank, post and crate is a cannon.js body. The forts start ASLEEP,
//   so an untouched fort stands perfectly still instead of settling and
//   creeping for the whole match; a blast wakes what it touches, and anything
//   that falls on a sleeping block wakes that too. The blast is an impulse
//   with falloff, not a real explosion — what it has to be is readable: hit
//   the legs and the fort comes down, hit the roof and it shrugs.
//
// THE HOLD
//   SIDE-ON, like High Noon: P1's fort is on the right, P2's on the left.
//
// CLEARED
//   A fort is DOWN when not one of its blocks is left on its pedestal. At
//   MATCH_TIME the clock settles it on who has more of their fort still on
//   their pedestal. Two forts cleared within the same moment is a draw.
// ============================================================

import { state } from '../core/GameState.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import { registerMinigameCleanup, isBotSlot, seatFor } from './MinigameManager.js';
import { createStage } from '../engine/Stage.js';
import { STAGE_SETS } from '../engine/StageSets.js';
import { createDirector } from '../engine/StageDirector.js';

// ── Tuning ───────────────────────────────────────────────────────────────────
const FORT_X      = 10;       // fort centres at ±FORT_X; P1 (+x) is the right
const GRAVITY     = -18;
const RELOAD      = 1.1;      // s between shots
const MATCH_TIME  = 60;
const POWDER_AT   = 40;       // bigger shells for the last stretch
const PED_H = 1.3, PED_HW = 2.1;   // each fort's stone pedestal: height, half-width (just wider than the fort)
const PUSH = 0.6;                  // a blast's extra shove in the shell's direction of travel
const V_MIN = 7, V_MAX = 21;  // muzzle speed range, world units / s
const PULL_PX     = 170;      // a full-power pull, in stage px
const ELEV_MIN = 0.09, ELEV_MAX = 1.45;   // radians above the horizontal
const SHELL_R     = 0.3;
const BLAST_R     = 1.6;
const BLAST_J     = 19;       // impulse at the centre of a blast
const PREVIEW_T   = 0.36;     // s of trajectory shown while aiming

// ── Module state ─────────────────────────────────────────────────────────────
let _done = false, _onWin = null, _botSkill = 0.55;
let _overlay = null, _stage = null, _set = null, _dir = null, _hud = null;
let _world = null;
let _forts = [];               // per slot: { blocks:[{body,mesh}], top, topY0, x, dir, cannon, fig, down }
let _shells = [];              // { body, mesh, slot, age, boom }
let _fx = [];
let _aim = [];                 // per slot: { pid, ax, ay, elev, power, active }
let _reload = [0, 0];
let _shots = [0, 0];
let _bot = [];
let _phase = 'intro', _t = 0, _clock = 0;
let _powder = false;
let _shake = 0;
let _flash = null, _flashT = 0;
let _dirOwns = false;
let _result = null;
let _preview = [];             // per slot: dot meshes

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function start(isBot, onWin, botSkill = 0.55) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _botSkill = botSkill;
    _forts = []; _shells = []; _fx = []; _preview = [];
    _aim = [0, 1].map(() => ({ pid: null, ax: 0, ay: 0, elev: 0.7, power: 0, active: false }));
    _reload = [0.6, 0.6]; _shots = [0, 0];
    _phase = 'intro'; _t = 0; _clock = 0; _powder = false; _shake = 0; _result = null;
    registerMinigameCleanup(_destroy);           // R3

    const mg = document.getElementById('minigame-layer');
    _overlay = document.createElement('div');    // R2
    _overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#e9dcc0;z-index:5;';
    mg.appendChild(_overlay);

    _stage = createStage(_overlay, { hold: 'side', fov: 34, background: 0xefe2c2 });
    _buildHud();
    _dir = createDirector(_stage);

    _world = (typeof CANNON !== 'undefined') ? _buildWorld() : null;
    if (_stage.gl) {
        _set = STAGE_SETS.bad(_stage);
        _flash = new THREE.PointLight(0xffc16b, 0, 12);
        _stage.add(_flash);
    }
    for (let slot = 0; slot < 2; slot++) _forts.push(_buildFort(slot));
    if (_stage.gl) for (let slot = 0; slot < 2; slot++) _preview.push(_buildPreview(slot));
    _bot = [0, 1].map(slot => isBotSlot(slot) ? { nextAt: 1.2 + Math.random() * 0.8 } : null);

    _stage.listen('pointerdown', _onDown);
    _stage.listen('pointermove', _onMove);
    _stage.listen('pointerup', _onUp);
    _stage.listen('pointercancel', _onUp);
    _stage.onResize(() => _layoutHud());

    _dir.open({
        place: 'BOOT HILL BADLANDS · HIGH NOON', title: 'BOOT HILL BARRAGE',
        sub: 'KNOCK THEIR FORT DOWN FIRST',
        from: { pos: [0, 16, 40], look: [0, 3, -20] },
        to:   { pos: [0, 5.2, 21], look: [0, 4.2, 0] },
        onDone: () => { if (!_done) { _phase = 'play'; _say('FIRE!', 900); } },
    });
    _stage.start(_frame);
}

function _destroy() {
    _done = true;
    if (_stage) { _stage.dispose(); _stage = null; }
    if (_overlay) { _overlay.remove(); _overlay = null; }
    _world = null; _forts = []; _shells = []; _fx = []; _preview = [];
    _set = null; _dir = null; _hud = null; _flash = null;
}

function _finish(winner) {
    if (_done) return;                           // R6
    _destroy();
    _onWin?.(winner);
}

// ── Physics world ────────────────────────────────────────────────────────────
let _woodMat = null;
function _buildWorld() {
    const w = new CANNON.World();
    w.gravity.set(0, GRAVITY, 0);
    w.broadphase = new CANNON.NaiveBroadphase();
    w.solver.iterations = 12;
    w.allowSleep = true;
    _woodMat = new CANNON.Material('wood');
    const groundMat = new CANNON.Material('ground');
    w.addContactMaterial(new CANNON.ContactMaterial(_woodMat, _woodMat, { friction: 0.6, restitution: 0.02 }));
    w.addContactMaterial(new CANNON.ContactMaterial(_woodMat, groundMat, { friction: 0.7, restitution: 0.02 }));
    const ground = new CANNON.Body({ mass: 0, material: groundMat });
    ground.addShape(new CANNON.Plane());
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    w.addBody(ground);
    return w;
}

const _dirOf = slot => (slot === 0 ? -1 : 1);   // the way a fort FIRES: P1 fires left
const _xOf = slot => (slot === 0 ? FORT_X : -FORT_X);

function _block(fort, w, h, d, x, y, color, mass) {
    let body = null, mesh = null;
    if (_world) {
        body = new CANNON.Body({ mass, material: _woodMat, linearDamping: 0.05, angularDamping: 0.12 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
        body.position.set(x, y, 0);
        body.allowSleep = true;
        body.sleepSpeedLimit = 0.25;
        body.sleepTimeLimit = 0.4;
        _world.addBody(body);
        body.sleep();                           // stands still until something hits it
    }
    if (_stage.gl) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
            new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.position.set(x, y, 0);
        // Plank grain: two thin dark lines, so a block reads as timber.
        if (w > 1.5 || h > 1.2) {
            const lineMat = new THREE.MeshStandardMaterial({ color: 0x3f2a18, roughness: 1 });
            const long = w > h;
            [-0.22, 0.22].forEach(o => {
                const l = new THREE.Mesh(new THREE.BoxGeometry(long ? w * 0.96 : 0.04, long ? 0.04 : h * 0.96, d + 0.02), lineMat);
                if (long) l.position.y = o * h; else l.position.x = o * w;
                mesh.add(l);
            });
        }
        _stage.add(mesh);
    }
    const b = { body, mesh, x0: x, y0: y };
    fort.blocks.push(b);
    return b;
}

function _buildFort(slot) {
    const x0 = _xOf(slot), dir = _dirOf(slot);
    const fort = { slot, x: x0, dir, blocks: [], down: false, downAt: 0 };
    const POST = [0.45, 1.5, 1.1], PLANK = [2.9, 0.34, 1.3];
    const posts = [0x6b4a2c, 0x5d4126], planks = [0x9a7548, 0x8a6239];
    // The pedestal: static stone, and the fort is built on top of it.
    if (_world) {
        const ped = new CANNON.Body({ mass: 0, material: _woodMat });
        ped.addShape(new CANNON.Box(new CANNON.Vec3(PED_HW, PED_H / 2, 1.0)));
        ped.position.set(x0, PED_H / 2, 0);
        _world.addBody(ped);
    }
    if (_stage.gl) {
        const rock = new THREE.MeshStandardMaterial({ color: 0x9a8570, roughness: 1 });
        const p = new THREE.Mesh(new THREE.BoxGeometry(PED_HW * 2, PED_H, 2.0), rock);
        p.position.set(x0, PED_H / 2, 0); p.castShadow = true; p.receiveShadow = true; _stage.add(p);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(PED_HW * 2 + 0.2, 0.12, 2.2), new THREE.MeshStandardMaterial({ color: 0x7d6a55, roughness: 1 }));
        cap.position.set(x0, PED_H - 0.04, 0); cap.receiveShadow = true; _stage.add(cap);
    }
    let y = PED_H;
    for (let layer = 0; layer < 3; layer++) {
        // Three legs a storey: one shot takes a leg, not the storey. Two
        // legs brought a fort down in three hits and four seconds.
        // Even timber all the way up. Light upper storeys made the top legs a
        // six-shot shortcut that players would find in one match.
        const m = 3.8;
        [-1.1, 0, 1.1].forEach((ox, i) => _block(fort, ...POST, x0 + ox, y + POST[1] / 2, posts[i % 2], m));
        y += POST[1];
        _block(fort, ...PLANK, x0, y + PLANK[1] / 2, planks[layer % 2], 3.0);
        y += PLANK[1];
    }
    // Cover: a short stack of crates on the side facing the enemy.
    for (let k = 0; k < 2; k++) _block(fort, 0.9, 0.9, 1.0, x0 + dir * 1.65, PED_H + 0.45 + k * 0.9, 0xb08a58, 1.6);
    // The top: the block the fort is judged by, with the figure and cannon on it.
    const TOP = [1.9, 0.5, 1.3];
    fort.top = _block(fort, ...TOP, x0, y + TOP[1] / 2, 0x7a5a36, 3.2);
    fort.topY0 = y + TOP[1] / 2;

    if (_stage.gl) {
        const top = fort.top.mesh;
        // The cannon: carriage, wheels, and a barrel on an elevation pivot.
        const cannon = new THREE.Group();
        const iron = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.4, metalness: 0.8 });
        const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.85 });
        const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.28, 0.6), wood);
        carriage.position.y = 0.18; cannon.add(carriage);
        [-0.32, 0.32].forEach(z => {
            const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 14), wood);
            wh.rotation.x = Math.PI / 2; wh.position.set(0.05, 0.2, z); cannon.add(wh);
        });
        const pivot = new THREE.Group();
        pivot.position.set(0.05, 0.42, 0);
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 14), iron);
        barrel.rotation.z = -Math.PI / 2; barrel.position.x = 0.45; pivot.add(barrel);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 14), iron);
        lip.rotation.y = Math.PI / 2; lip.position.x = 1.05; pivot.add(lip);
        const muzzle = new THREE.Object3D(); muzzle.position.x = 1.2; pivot.add(muzzle);
        cannon.add(pivot);
        cannon.traverse(o => { if (o.isMesh) o.castShadow = true; });
        // +x in the cannon's frame points at the enemy.
        cannon.rotation.y = dir > 0 ? 0 : Math.PI;
        cannon.position.set(dir * 0.25, 0.25, 0);
        top.add(cannon);
        fort.cannon = { group: cannon, pivot, muzzle };

        // The flag, in the player's colour, at the back of the top block.
        const col = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.7, 6),
            new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
        pole.position.set(-dir * 0.85, 1.1, -0.5); top.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45),
            new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.8 }));
        flag.position.set(-dir * 0.85 - dir * 0.36, 1.7, -0.5); top.add(flag);
        fort.flag = flag;

        // The figure, standing behind its cannon, turned three-quarters to us.
        const c = _stage.character(slot);
        _stage.scene.remove(c.rig.root);
        top.add(c.rig.root);
        c.rig.root.scale.setScalar(0.72);
        c.rig.root.position.set(-dir * 0.5, 0.25, 0.1);
        c.anim.face(dir > 0 ? Math.PI / 2 - 0.75 : -Math.PI / 2 + 0.75, true);
        c.anim.play('idle');
        fort.fig = c;
        _setElevation(fort, 0.7);
    }
    return fort;
}

function _setElevation(fort, elev) {
    if (fort.cannon) fort.cannon.pivot.rotation.z = elev;
}

function _buildPreview(slot) {
    const col = state.players[seatFor(slot)]?.color ?? 0xffffff;
    const dots = [];
    for (let i = 0; i < 7; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6),
            new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9 - i * 0.1 }));
        m.visible = false;
        _stage.add(m);
        dots.push(m);
    }
    return dots;
}

// ── Aiming and firing ────────────────────────────────────────────────────────
function _muzzleState(slot, elev, power) {
    const f = _forts[slot];
    let p;
    if (f.cannon) {
        _setElevation(f, elev);
        f.cannon.group.updateMatrixWorld(true);
        p = f.cannon.muzzle.getWorldPosition(new THREE.Vector3());
    } else {
        const top = f.top.body ? f.top.body.position : { x: f.x, y: f.topY0 };
        p = { x: top.x + f.dir * 1.4, y: top.y + 0.7, z: 0 };
    }
    const v = V_MIN + power * (V_MAX - V_MIN);
    return { p, vx: f.dir * Math.cos(elev) * v, vy: Math.sin(elev) * v };
}

function _aimFrom(slot, dx, dy) {
    // Pull back to fire: the shot goes the opposite way to the drag. Screen y
    // is down and world y is up, so a pull DOWN fires UP.
    const fx = -dx, fy = dy;
    const len = Math.hypot(dx, dy);
    const toward = fx * _dirOf(slot);            // how much of the pull points at them
    // Past vertical (pulled toward them) clamps to the steepest lob; below the
    // horizon clamps to the flattest shot. Nothing ever fires backwards.
    const elev = Math.max(ELEV_MIN, Math.min(ELEV_MAX, Math.atan2(fy, toward)));
    return { elev, power: Math.min(1, len / PULL_PX) };
}

function _fire(slot, elev, power) {
    if (_done || _phase !== 'play' || _reload[slot] > 0 || power < 0.12) return false;
    const f = _forts[slot];
    if (f.down) return false;
    const m = _muzzleState(slot, elev, power);
    _reload[slot] = RELOAD;
    _shots[slot]++;
    sfx('gunshot'); haptic([30]);
    let body = null, mesh = null;
    const r = _powder ? SHELL_R * 1.35 : SHELL_R;
    if (_world) {
        // Light on purpose. At 3 kg and 19 m/s the shell was a wrecking ball
        // and the contact alone felled a storey before the blast went off; the
        // blast is the damage, because the blast is what can be tuned.
        body = new CANNON.Body({ mass: 0.35, material: _woodMat, linearDamping: 0 });
        body.addShape(new CANNON.Sphere(r));
        body.position.set(m.p.x, m.p.y, 0);
        body.velocity.set(m.vx, m.vy, 0);
        body.allowSleep = false;
        _world.addBody(body);
    }
    if (_stage.gl) {
        mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10),
            new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.7 }));
        mesh.castShadow = true;
        mesh.position.copy(m.p);
        _stage.add(mesh);
        _smoke(new THREE.Vector3(m.p.x, m.p.y, m.p.z), 5, 0xf0ece4, 0.6, 0.8);
        if (_flash) { _flash.position.set(m.p.x, m.p.y, 0.4); _flashT = 0.1; }
        f.fig?.anim.fire();
        if (f.cannon) f.cannon.group.userData.kick = 1;
    }
    const s = { body, mesh, slot, age: 0, boom: false, x: m.p.x, y: m.p.y, vx: m.vx, vy: m.vy, big: _powder };
    if (body) body.addEventListener('collide', () => { if (s.age > 0.06) s.boom = true; });
    _shells.push(s);
    return true;
}

// ── Input ────────────────────────────────────────────────────────────────────
function _slotAt(e) {
    const p = _stage.toLocal(e.clientX, e.clientY);
    return { slot: p.x >= _stage.width / 2 ? 0 : 1, p };
}

function _onDown(e) {
    if (_done) return;
    e.preventDefault();
    const { slot, p } = _slotAt(e);
    if (isBotSlot(slot) || _aim[slot].active) return;
    Object.assign(_aim[slot], { pid: e.pointerId, ax: p.x, ay: p.y, active: true, power: 0 });
}

function _onMove(e) {
    if (_done) return;
    const a = _aim.find(x => x.active && x.pid === e.pointerId);
    if (!a) return;
    const slot = _aim.indexOf(a);
    const p = _stage.toLocal(e.clientX, e.clientY);
    const r = _aimFrom(slot, p.x - a.ax, p.y - a.ay);
    a.elev = r.elev; a.power = r.power;
    _setElevation(_forts[slot], a.elev);
}

function _onUp(e) {
    if (_done) return;
    const a = _aim.find(x => x.active && x.pid === e.pointerId);
    if (!a) return;
    const slot = _aim.indexOf(a);
    a.active = false; a.pid = null;
    _fire(slot, a.elev, a.power);
    _hideHint(slot);
}

// ── Bot (§5) ─────────────────────────────────────────────────────────────────
// A gunner that solves the ballistic arc to a block in the rival fort and then
// misses by an amount set by skill. It picks the upper legs more often at hard
// — that is the actual technique — and the roof more often at easy.
function _gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; }

function _botStep(dt) {
    [0, 1].forEach(slot => {
        const b = _bot[slot];
        if (!b || _phase !== 'play' || _forts[slot].down) return;
        b.nextAt -= dt;
        if (b.nextAt > 0 || _reload[slot] > 0) return;
        const enemy = _forts[1 - slot];
        // Whatever is still up on their pedestal, the lowest first: a clear
        // pedestal is the win, so the footings matter as much as the roof.
        const left = enemy.blocks.filter(k => _onPed(enemy, k)).sort((a, b) => (a.body?.position.y ?? a.y0) - (b.body?.position.y ?? b.y0));
        if (!left.length) return;
        const pick = Math.random() < 0.35 + _botSkill * 0.45 ? left[0] : left[Math.floor(Math.random() * left.length)];
        const shot = _solve(slot, pick, 0.03 + (1 - _botSkill) * 0.13, (1 - _botSkill) * 0.06);   // ~5% at hard, ~13% at easy
        if (shot) _fire(slot, shot.elev, shot.power);
        b.nextAt = 0.25 + Math.random() * 0.5 + (1 - _botSkill) * 1.3;
    });
}

// The arc from `slot`'s muzzle to a block, at a few random elevations until
// one is inside the cannon's speed range. `err` scales muzzle speed and
// `aimErr` the elevation, both as Gaussian noise.
function _solve(slot, block, err, aimErr) {
    const tp = block.body ? block.body.position : { x: block.x0, y: block.y0 };
    for (let tries = 0; tries < 8; tries++) {
        const elev = 0.45 + Math.random() * 0.6;
        const m = _muzzleState(slot, elev, 1);
        const dx = Math.abs(tp.x - m.p.x), dy = tp.y - m.p.y;
        const c = Math.cos(elev), den = 2 * c * c * (dx * Math.tan(elev) - dy);
        if (den <= 0) continue;
        const v = Math.sqrt(-GRAVITY * dx * dx / den);
        if (v < V_MIN || v > V_MAX) continue;
        const vv = Math.max(V_MIN, Math.min(V_MAX, v * (1 + _gauss() * err)));
        return { elev: elev + _gauss() * aimErr, power: (vv - V_MIN) / (V_MAX - V_MIN) };
    }
    return null;
}

// ── Blasts and effects ───────────────────────────────────────────────────────
function _addFx(obj, life, update) {
    if (!_stage?.gl) return;
    _stage.add(obj);
    _fx.push({ obj, t: 0, life, update });
}

function _smoke(at, n, color, spread, rise) {
    if (!_stage?.gl) return;
    for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.18 + Math.random() * 0.14, 8, 6),
            new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, roughness: 1 }));
        m.position.copy(at);
        const v = new THREE.Vector3((Math.random() - 0.5) * spread * 2, Math.random() * rise + 0.3, (Math.random() - 0.5) * spread);
        _addFx(m, 1.2 + Math.random() * 0.6, (o, t, dt) => {
            o.position.addScaledVector(v, dt);
            o.scale.setScalar(1 + t * 2.4);
            o.material.opacity = Math.max(0, 0.85 * (1 - t / 1.6));
        });
    }
}

function _blast(s) {
    const pos = s.body ? s.body.position : { x: s.x, y: s.y, z: 0 };
    const R = s.big ? BLAST_R * 1.3 : BLAST_R, J = s.big ? BLAST_J * 1.4 : BLAST_J;
    if (_world) {
        _forts.forEach(f => f.blocks.forEach(k => {
            if (!k.body) return;
            const dx = k.body.position.x - pos.x, dy = k.body.position.y - pos.y, dz = k.body.position.z - pos.z;
            const d = Math.hypot(dx, dy, dz);
            if (d > R) return;
            const fall = 1 - d / R;
            const n = Math.max(0.001, d);
            k.body.wakeUp();
            const along = s.slot != null ? _dirOf(s.slot) * J * PUSH * fall : 0;
            k.body.applyImpulse(new CANNON.Vec3(dx / n * J * fall + along, (dy / n * 0.6 + 0.4) * J * fall, dz / n * J * fall * 0.3),
                                k.body.position);
        }));
    }
    sfx('boom');
    _shake = Math.max(_shake, s.big ? 0.55 : 0.4);
    if (!_stage?.gl) return;
    const at = new THREE.Vector3(pos.x, pos.y, pos.z);
    const burst = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true }));
    burst.position.copy(at);
    _addFx(burst, 0.22, (o, t) => { o.scale.setScalar(1 + t * 16); o.material.opacity = 1 - t / 0.22; });
    if (_flash) { _flash.position.copy(at); _flashT = 0.16; }
    _smoke(at, 9, 0x9a8a70, 1.1, 1.6);
    // Splinters.
    for (let i = 0; i < 10; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x8a6239, roughness: 1 }));
        m.position.copy(at);
        const v = new THREE.Vector3((Math.random() - 0.5) * 9, 3 + Math.random() * 6, (Math.random() - 0.5) * 4);
        _addFx(m, 1.1, (o, t, dt) => {
            v.y += GRAVITY * dt;
            o.position.addScaledVector(v, dt);
            o.rotation.x += dt * 12; o.rotation.z += dt * 9;
            if (o.position.y < 0.05) { o.position.y = 0.05; v.set(0, 0, 0); }
        });
    }
}

// ── Fort state ───────────────────────────────────────────────────────────────
function _topOf(f) {
    if (!f.top.body) return { y: f.topY0, up: 1, x: f.x };
    const b = f.top.body;
    const q = b.quaternion;
    // World-up component of the block's own up axis.
    const up = 1 - 2 * (q.x * q.x + q.z * q.z);
    return { y: b.position.y, up, x: b.position.x };
}

function _standing(f) {
    // 1 = untouched, 0 = flat. The top block's height is what counts.
    return Math.max(0, Math.min(1, _topOf(f).y / f.topY0));
}

// How much of the fort is still where it was built: every block counts, so
// each hit that lands moves the bar. The top block's height is what decides
// DOWN; this is what shows the damage on the way there.
function _integrity(f) {
    if (!f.blocks[0]?.body) return 1;
    let home = 0;
    f.blocks.forEach(k => {
        const p = k.body.position;
        if (Math.hypot(p.x - k.x0, p.y - k.y0) < 0.35) home++;
    });
    return home / f.blocks.length;
}

/** Is this block still up on its fort's pedestal? */
function _onPed(f, k) {
    const p = k.body ? k.body.position : { x: k.x0, y: k.y0 };
    return p.y > PED_H - 0.1 && Math.abs(p.x - f.x) < PED_HW + 0.05;
}
/** The share of the fort still on its pedestal: 1 untouched, 0 cleared. */
function _remaining(f) {
    return f.blocks.length ? f.blocks.filter(k => _onPed(f, k)).length / f.blocks.length : 1;
}

function _checkDown(f) {
    if (f.down) return;
    if (_remaining(f) === 0) {
        f.down = true; f.downAt = _t;
        if (f.fig) f.fig.anim.play('hit', { restart: true });
        _say(`${_name(f.slot)}'S PEDESTAL IS CLEAR`, 1400);
    }
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function _name(slot) {
    const p = state.players[seatFor(slot)];
    return (p && p.name ? p.name : `P${slot + 1}`).toUpperCase();
}
function _css(slot) {
    const c = state.players[seatFor(slot)]?.color ?? (slot === 0 ? 0xff3b3b : 0x3b8eff);
    return '#' + c.toString(16).padStart(6, '0');
}
function _el(tag, css, parent) {
    const e = document.createElement(tag);
    e.style.cssText = css;
    (parent || _hud.root).appendChild(e);
    return e;
}

function _buildHud() {
    const root = _stage.hud;
    root.classList.add('bfont');
    _hud = { root };
    const txt = 'color:#fff8e6;text-shadow:0 2px 0 #3b2716,0 0 12px rgba(0,0,0,.5);letter-spacing:2px;';
    _hud.clock = _el('div', 'position:absolute;top:10px;left:50%;transform:translateX(-50%);font-size:28px;' +
        'padding:2px 14px;border-radius:12px;background:rgba(40,24,12,.6);' + txt);
    _hud.bars = [0, 1].map(slot => {
        const box = _el('div', `position:absolute;top:10px;width:210px;padding:5px 10px;border-radius:12px;` +
            `background:rgba(40,24,12,.6);border:2px solid ${_css(slot)};font-size:15px;` + txt);
        const n = _el('div', '', box);
        n.textContent = _name(slot) + (isBotSlot(slot) ? ' · BOT' : '');
        const track = _el('div', 'height:9px;border-radius:5px;background:rgba(255,255,255,.18);margin-top:4px;overflow:hidden;', box);
        const fill = _el('div', `height:100%;width:100%;background:${_css(slot)};transition:width .2s;`, track);
        const load = _el('div', 'font-size:13px;margin-top:3px;opacity:.9;', box);
        return { box, fill, load };
    });
    _hud.hints = [0, 1].map(slot => {
        const h = _el('div', 'position:absolute;bottom:14px;width:340px;text-align:center;font-size:17px;opacity:.95;white-space:nowrap;' +
            'transition:opacity .4s;' + txt);
        h.textContent = isBotSlot(slot) ? '' : '◀ DRAG BACK · LET GO TO FIRE';
        if (slot === 1) h.textContent = isBotSlot(slot) ? '' : 'DRAG BACK · LET GO TO FIRE ▶';
        return h;
    });
    const bigBox = _el('div', 'position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);font-size:52px;' +
        'white-space:nowrap;opacity:0;transition:opacity .2s;' + txt);
    _hud.bigBox = bigBox;
    _hud.big = _el('span', 'display:inline-block;', bigBox);
    _layoutHud();
}

function _layoutHud() {
    if (!_hud || !_stage) return;
    const W = _stage.width;
    _hud.bars[0].box.style.left = (W - 240) + 'px';
    _hud.bars[1].box.style.left = '20px';
    _hud.hints[0].style.left = (W * 0.75 - 170) + 'px';
    _hud.hints[1].style.left = (W * 0.25 - 170) + 'px';
}

function _hideHint(slot) { if (_hud) _hud.hints[slot].style.opacity = '0'; }

function _say(msg, ms = 0) {
    if (!_hud) return;
    _hud.big.textContent = msg;
    _hud.bigBox.style.opacity = msg ? '1' : '0';
    _hud.big.style.animation = 'none'; void _hud.big.offsetWidth;
    _hud.big.style.animation = msg ? 'countPop .35s ease' : 'none';
    _hud.clearAt = ms ? _t + ms / 1000 : 0;
}

function _renderHud() {
    if (!_hud) return;
    const left = Math.max(0, MATCH_TIME - _clock);
    _hud.clock.textContent = _phase === 'play' ? `${Math.ceil(left)}` : '';
    [0, 1].forEach(slot => {
        const f = _forts[slot], bar = _hud.bars[slot];
        bar.fill.style.width = `${Math.round((f.down ? 0 : _remaining(f)) * 100)}%`;
        bar.load.textContent = f.down ? 'PEDESTAL CLEAR' : _reload[slot] > 0 ? 'LOADING…' : 'READY TO FIRE';
    });
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = _phase === 'play' ? `${Math.ceil(left)}s` : 'BOOT HILL BARRAGE';
}

// ── The loop ─────────────────────────────────────────────────────────────────
function _frame(dt) {
    if (_done) return;
    _t += dt;
    if (_hud?.clearAt && _t > _hud.clearAt) _say('');

    if (_phase === 'play') {
        _clock += dt;
        _reload = _reload.map(r => Math.max(0, r - dt));
        _botStep(dt);
        if (!_powder && _clock >= POWDER_AT) { _powder = true; _say('BIGGER POWDER!', 1300); sfx('boost'); }
    }

    // Physics. Stepped only once play begins, so nothing moves in the opening.
    if (_world && _phase !== 'intro') _world.step(1 / 60, dt, 4);

    // Shells: follow the body (or fly a ballistic arc without physics).
    for (let i = _shells.length - 1; i >= 0; i--) {
        const s = _shells[i];
        s.age += dt;
        if (!s.body) { s.vy += GRAVITY * dt; s.x += s.vx * dt; s.y += s.vy * dt; if (s.y < 0.3) s.boom = true; }
        if (s.mesh && s.body) { s.mesh.position.copy(s.body.position); }
        const y = s.body ? s.body.position.y : s.y;
        if (s.boom || s.age > 5 || y < -2) {
            if (s.boom) _blast(s);
            if (s.body) _world.removeBody(s.body);
            if (s.mesh) { _stage.scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
            _shells.splice(i, 1);
        }
    }

    // Blocks: meshes follow bodies.
    _forts.forEach(f => f.blocks.forEach(k => {
        if (k.body && k.mesh) { k.mesh.position.copy(k.body.position); k.mesh.quaternion.copy(k.body.quaternion); }
    }));

    // Cannon recoil, flag flutter, the aim preview.
    _forts.forEach((f, slot) => {
        if (f.cannon) {
            const g = f.cannon.group;
            g.userData.kick = Math.max(0, (g.userData.kick || 0) - dt * 4);
            g.position.x = f.dir * (0.25 - 0.2 * g.userData.kick);
        }
        if (f.flag) f.flag.rotation.y = Math.sin(_t * 6 + slot) * 0.25;
        const dots = _preview[slot];
        if (!dots) return;
        const a = _aim[slot];
        const show = a.active && a.power >= 0.12 && _phase === 'play' && !f.down;
        if (show) {
            const m = _muzzleState(slot, a.elev, a.power);
            dots.forEach((d, i) => {
                const t = (i + 1) / dots.length * PREVIEW_T;
                d.visible = true;
                d.position.set(m.p.x + m.vx * t, m.p.y + m.vy * t + 0.5 * GRAVITY * t * t, 0);
            });
        } else dots.forEach(d => { d.visible = false; });
    });

    // Down?
    if (_phase === 'play') {
        _forts.forEach(_checkDown);
        const downs = _forts.filter(f => f.down);
        let winner = null;
        if (downs.length === 2) winner = Math.abs(downs[0].downAt - downs[1].downAt) < 0.25 ? -1
            : (downs[0].downAt < downs[1].downAt ? downs[1].slot : downs[0].slot);
        else if (downs.length === 1) {
            // Give the other fort a breath to come down too, so a trade is a draw.
            if (_t - downs[0].downAt > 0.6) winner = 1 - downs[0].slot;
        } else if (_clock >= MATCH_TIME) {
            // On the clock: more of your fort still on your pedestal wins.
            const a = _remaining(_forts[0]), b = _remaining(_forts[1]);
            winner = Math.abs(a - b) < 0.01 ? -1 : (a > b ? 0 : 1);
        }
        if (winner !== null) _end(winner);
    }

    // Effects.
    if (_flash) { _flashT = Math.max(0, _flashT - dt); _flash.intensity = 7 * (_flashT / 0.16); }
    for (let i = _fx.length - 1; i >= 0; i--) {
        const f = _fx[i];
        f.t += dt;
        f.update?.(f.obj, f.t, dt);
        if (f.t >= f.life) {
            _stage?.scene?.remove(f.obj);
            f.obj.geometry?.dispose(); f.obj.material?.dispose();
            _fx.splice(i, 1);
        }
    }
    _set?.update(dt, _t);
    _dirOwns = !!_dir && _dir.update(dt);
    if (_done) return;
    if (!_dirOwns && _stage?.gl) {
        const cam = _stage.camera;
        cam.position.set(0, 5.2, 21);
        if (_shake > 0) {
            cam.position.x += (Math.random() - 0.5) * _shake;
            cam.position.y += (Math.random() - 0.5) * _shake;
            _shake = Math.max(0, _shake - dt * 1.4);
        }
        cam.lookAt(0, 4.2, 0);
        cam.userData.look = [0, 4.2, 0];
    }
    _renderHud();
}

function _end(winner) {
    if (_phase !== 'play') return;
    _phase = 'over';
    _result = winner;
    _say('');
    _preview.forEach(ds => ds.forEach(d => { d.visible = false; }));
    const figs = _forts.map(f => f.fig).filter(Boolean);
    _dir.close({
        winner, figs,
        sub: winner < 0 ? 'BOTH FORTS IN THE DIRT' : 'THE LAST FLAG FLYING',
        onDone: () => _finish(winner),
    });
    const n = document.getElementById('mg-neutral');
    if (n) n.textContent = winner < 0 ? 'DRAW!' : `${_name(winner)} WINS!`;
}

// For probes.
export function _debugState() {
    return {
        phase: _phase, clock: +_clock.toFixed(2), shots: _shots.slice(), reload: _reload.slice(),
        standing: _forts.map(f => +_standing(f).toFixed(3)), down: _forts.map(f => f.down),
        remaining: _forts.map(f => +_remaining(f).toFixed(3)),
        integrity: _forts.map(f => +_integrity(f).toFixed(3)),
        shells: _shells.length, gl: !!_stage?.gl, turned: !!_stage?.turned, physics: !!_world,
        powder: _powder, result: _result, quality: _stage?.quality ? { ..._stage.quality } : null,
    };
}
/** Probes: fire as if a player had pulled back by (dx, dy) px. */
export function _debugFire(slot, dx, dy) {
    const r = _aimFrom(slot, dx, dy);
    return _fire(slot, r.elev, r.power);
}
/** Probes: wake every block in a fort without touching it — a stable fort stands. */
export function _debugWake(slot) {
    _forts[slot]?.blocks.forEach(k => k.body?.wakeUp());
}
/** Probes: fire a perfect shot from `slot` at the rival's upper legs. */
export function _debugFireAt(slot) {
    const enemy = _forts[1 - slot];
    const left = enemy.blocks.filter(k => _onPed(enemy, k));
    const shot = _solve(slot, left[Math.floor(Math.random() * left.length)] || enemy.top, 0, 0);
    return shot ? _fire(slot, shot.elev, shot.power) : false;
}
/** Probes: fire a perfect shot from `slot` at the rival's TOP block. */
export function _debugFireAtTop(slot) {
    const enemy = _forts[1 - slot];
    const shot = _solve(slot, enemy.top, 0, 0);
    return shot ? _fire(slot, shot.elev, shot.power) : false;
}
