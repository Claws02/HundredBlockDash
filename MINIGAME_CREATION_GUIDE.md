# HundredBlockDash — Ultimate Minigame Creation Guide
> Use this document as a prompt for AI to create new minigames that drop directly into the game.

---

## GAME CONTEXT

**HundredBlockDash** is a 2-player mobile board game running in the browser. It's built on Three.js for the board and vanilla JS/HTML/CSS for minigames. Two players share one phone — P1 holds the bottom, P2 holds the top (upside-down). The screen is split horizontally: **P1 zone = bottom half, P2 zone = top half.**

Minigames are triggered between board turns and award coins to the winner. Each minigame is a **self-contained ES module** with a single `start()` export. The rest of the system handles setup, countdown, teardown, coin rewards, and return to the board automatically.

---

## ARCHITECTURE OVERVIEW

```
GameController.js
    └─► MinigameManager.trigger(onComplete)
            ├─ Shows intro screen (game name, icon, description)
            ├─ Shows orientation screen (how to hold the phone)
            ├─ Both players tap READY → 3-2-1-GO countdown
            ├─ Sets state.mgActive = true
            └─► mod.start(isBot, onWin)   ← YOUR CODE RUNS HERE
                    └─► onWin(0 | 1 | -1) ← YOU CALL THIS WHEN DONE
                            └─ MinigameManager handles coin award,
                               victory animation, endMinigame(), cleanup
```

---

## ADDING A NEW MINIGAME — 3-FILE CHECKLIST

### File 1: `src/config/MinigameRegistry.js`

**1a. Add key to `MG_TYPES` array:**
```js
export const MG_TYPES = [
  // ... existing entries ...
  'yourminigame',   // ← add here
];
```
The key must be lowercase alphanumeric, no spaces. This is the internal ID used everywhere.

**1b. Add metadata to `MG_INFO`:**
```js
export const MG_INFO = {
  // ...
  yourminigame: {
    icon:  '🎯',                            // single emoji shown on intro screen
    title: 'YOUR MINIGAME',                 // ALL CAPS title, shown large
    desc:  'Description shown to players.   // 1-2 sentences max, explains rules
             Wrong tap loses!',
  },
};
```

**1c. Add orientation to `MG_ORIENTATION_MAP`:**
```js
export const MG_ORIENTATION_MAP = {
  // ...
  yourminigame: 'faceoff',   // see orientation options below
};
```

---

### File 2: `src/minigames/MinigameManager.js`

Add one line to the `MG_MODULES` object (lazy import):
```js
const MG_MODULES = {
  // ...
  yourminigame: () => import('./YourMinigame.js'),
};
```
That's it for this file.

---

### File 3: `src/minigames/YourMinigame.js` ← CREATE THIS

See the full template and contracts below.

---

## ORIENTATION REFERENCE

The orientation is shown to players *before* the game starts so they know how to hold the phone. Choose the one that matches your game's input style:

| Key | Display Name | When to Use |
|-----|-------------|-------------|
| `faceoff` | FACE-OFF | Default for most games. P1 grips bottom, P2 grips top. Each player taps their own half. Use for any competitive game with independent actions. |
| `quickdraw` | QUICK-DRAW | Same as faceoff, but the instructions specifically warn players NOT to tap until GO — and that a false tap loses. Use for reaction games or games where early tapping is a meaningful penalty. |
| `stargazer` | STARGAZER | Use when each player has their own spatial play area that can be rotated (e.g. P2's content is rendered upside-down on the top half). |
| `huddle` | HUDDLE | One player holds the phone flat, both players lean in and share the entire screen. Use for collaborative or memory games where a divided view doesn't make sense. |

---

## THE MINIGAME MODULE CONTRACT

### Function Signature
```js
export function start(isBot, onWin) { ... }
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `isBot` | `boolean` | `true` if the opponent (P2) is a bot. P1 is always a human. In some integrations both can be bots — check per-player via `state.players[i].isBot` if you need per-player bot state. |
| `onWin` | `function(winnerId)` | Call this **exactly once** when the game resolves. `0` = P1 wins, `1` = P2 wins, `-1` = tie/draw. |

### Hard Rules

| Rule | Why |
|------|-----|
| **Always check `state.mgActive` first** | The manager can end the game at any time (e.g. 45-second global timeout, app going to background). If `state.mgActive` is false, stop all logic immediately. |
| **Register cleanup before doing anything** | Call `registerMinigameCleanup(_cleanup)` at the top of `start()`. The manager calls this exactly once when the game ends, regardless of how it ends. |
| **Call `onWin` exactly once** | Never call it twice. After calling it, stop all loops, timeouts, and event listeners — cleanup will handle final teardown. |
| **Clean up absolutely everything** | Cancel all `requestAnimationFrame`, `setTimeout`, `setInterval`. Remove all event listeners. Remove all DOM nodes you created. Dispose Three.js renderers/scenes. |
| **Never modify `state.players[i].coins` directly** | Coin awards are handled by `winMinigame()` in MinigameManager after you call `onWin`. |
| **45-second hard cap** | MinigameManager automatically calls `winMinigame(-1)` (tie) at 45 seconds. You do not need your own max-time logic unless you want a shorter game limit. |
| **No global side effects** | Keep all state in module-level variables. Do not write to globals or mutate shared state. |

---

## CANONICAL MODULE TEMPLATE

```js
// src/minigames/YourMinigame.js
import { state }                    from '../core/GameState.js';
import { sfx }                      from '../engine/AudioManager.js';
import { registerMinigameCleanup }  from './MinigameManager.js';

// ─── Module-level state (so _cleanup can reach everything) ───────────────────
let _root      = null;   // top-level DOM node we create
let _animId    = null;   // requestAnimationFrame handle
let _timers    = [];     // all setTimeout/setInterval handles
let _listeners = [];     // [{el, type, fn}] for removeEventListener
let _onWin     = null;   // captured from start()
let _resolved  = false;  // guard against calling onWin twice

// ─── Entry point ─────────────────────────────────────────────────────────────
export function start(isBot, onWin) {
    if (!state.mgActive) return;         // hard guard — always first line

    _onWin    = onWin;
    _resolved = false;
    registerMinigameCleanup(_cleanup);   // register before ANY side effects

    // ── Build DOM ──────────────────────────────────────────────────────────────
    // #minigame-layer is the full-screen flex container (display:flex)
    // #mg-p1 = bottom half (P1, red)
    // #mg-p2 = top half    (P2, blue — content appears upside-down to P2)
    // #mg-neutral = centered overlay label
    //
    // You can create children inside any of these, or append a full-screen
    // canvas/div directly to #minigame-layer for games that own the whole screen.

    _root = document.createElement('div');
    _root.style.cssText = `
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
    `;
    document.getElementById('minigame-layer').appendChild(_root);

    // ── Build game UI ──────────────────────────────────────────────────────────
    // ... create your elements, append to _root or the zone divs ...

    // ── Wire up input ──────────────────────────────────────────────────────────
    // Track listeners so _cleanup can remove them:
    const onTap = (e) => {
        if (!state.mgActive) return;
        // ... handle tap ...
    };
    _root.addEventListener('pointerdown', onTap);
    _listeners.push({ el: _root, type: 'pointerdown', fn: onTap });

    // ── Bot AI ─────────────────────────────────────────────────────────────────
    // isBot = true when P2 is AI. Use realistic delays (600ms–2000ms).
    // Bot actions must also check state.mgActive before doing anything.
    if (isBot) {
        const t = setTimeout(() => {
            if (!state.mgActive || _resolved) return;
            _resolve(1);   // bot wins (or pick randomly, or simulate gameplay)
        }, 800 + Math.random() * 1200);
        _timers.push(t);
    }

    // ── Start game loop (if needed) ────────────────────────────────────────────
    _loop();
}

function _loop() {
    if (!state.mgActive) return;     // stop if manager ended the game
    _animId = requestAnimationFrame(_loop);
    // ... update game state, redraw canvas, etc. ...
}

// ─── Resolution ───────────────────────────────────────────────────────────────
function _resolve(winnerId) {
    if (_resolved) return;   // prevent double-call
    _resolved = true;
    // Optional: play a sound, show a brief flash before handing off
    sfx(winnerId === -1 ? 'land_bad' : 'mg_win');
    _onWin(winnerId);        // hand off to MinigameManager — it handles the rest
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────
// Called automatically by MinigameManager when the game ends (any path).
function _cleanup() {
    // 1. Stop animation loop
    if (_animId !== null) { cancelAnimationFrame(_animId); _animId = null; }

    // 2. Clear all timers
    _timers.forEach(t => clearTimeout(t));
    _timers = [];

    // 3. Remove all event listeners
    _listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
    _listeners = [];

    // 4. Remove DOM
    _root?.remove();
    _root = null;

    // 5. Reset module state
    _onWin = null;
    _resolved = false;
}
```

---

## DOM LAYOUT DURING A MINIGAME

```
<div id="minigame-layer">          ← full-screen, position:absolute, display:flex
  <div id="mg-p1">                 ← bottom half, P1 (red) — flex-direction:column
    <div id="mg-ready-1">          ← READY button (manager controls this)
  </div>
  <div id="mg-neutral">            ← centered label strip (manager writes text here)
  </div>
  <div id="mg-p2">                 ← top half, P2 (blue) — content is upside-down from P2's POV
    <div id="mg-ready-2">          ← READY button (manager controls this)
  </div>
  <div id="mg-countdown">          ← 3-2-1-GO overlay (manager controls this)
</div>
```

**P2 content is upside-down from P2's perspective.** When you render content in `#mg-p2`, apply `transform: rotate(180deg)` to text/images so P2 can read them right-side-up.

**Do not touch `#mg-ready-*` or `#mg-countdown`** — the manager owns those elements.

You can:
- Append children to `#mg-p1` and `#mg-p2` for split-screen games
- Append to `#mg-neutral` for shared center content
- Append a full-screen `<canvas>` or `<div>` directly to `#minigame-layer` for games that own the whole display

---

## AVAILABLE IMPORTS

```js
// Global game state
import { state } from '../core/GameState.js';

state.mgActive              // boolean — false means stop NOW
state.mgType                // string — current minigame key e.g. 'yourminigame'
state.mgReady               // [bool, bool] — per-player ready status (read-only in your game)
state.players[0].isBot      // boolean — P1 is bot
state.players[1].isBot      // boolean — P2 is bot
state.players[0].coins      // number — current coin count (read-only; manager awards coins)
state.players[1].coins      // number
state.players[0].name       // string — player name e.g. 'Player 1'
state.players[1].name       // string

// Audio + haptics
import { sfx, haptic } from '../engine/AudioManager.js';

sfx('mg_win')       // victory fanfare
sfx('mg_start')     // game start sting
sfx('coin_gain')    // coin pickup sound
sfx('countdown')    // tick sound for countdowns
sfx('go')           // GO! sound
sfx('land_bad')     // failure / time's up
sfx('jump')         // jump / boing
sfx('coin')         // soft coin clink
haptic('light')     // light vibration
haptic('medium')    // medium vibration
haptic('heavy')     // heavy vibration

// Minigame lifecycle
import { registerMinigameCleanup } from './MinigameManager.js';
registerMinigameCleanup(fn)   // register ONE cleanup function — called on game end
```

---

## SPLIT-SCREEN INPUT PATTERNS

### Basic tap (touch/pointer)
```js
// Use 'pointerdown' for both touch and mouse
element.addEventListener('pointerdown', (e) => {
    e.preventDefault();   // prevent scroll/zoom on mobile
    const rect = element.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // ... handle tap at (x, y) ...
});
```

### P1 vs P2 zone detection (full-screen tap)
```js
document.addEventListener('pointerdown', (e) => {
    const y = e.clientY;
    const pid = y > window.innerHeight / 2 ? 0 : 1;  // bottom = P1, top = P2
    // ... handle player pid tapping ...
});
```

### Keyboard (desktop testing)
```js
window.addEventListener('keydown', (e) => {
    if (e.key === 'q' || e.key === 'Q') { /* P1 action */ }
    if (e.key === 'p' || e.key === 'P') { /* P2 action */ }
});
```

---

## BOT IMPLEMENTATION PATTERNS

Bots receive `isBot = true`. They should behave like a player with realistic reaction time.

### Simple random delay
```js
if (isBot) {
    setTimeout(() => {
        if (!state.mgActive) return;
        _playerAction(1);  // bot is always P2
    }, 800 + Math.random() * 1500);
}
```

### Skill-based bot (competitive games)
```js
// Bot difficulty: easy = slow + random errors, hard = fast + accurate
const BOT_REACTION = 600 + Math.random() * 800;  // 0.6s–1.4s base delay
const BOT_ACCURACY = 0.75;  // 75% chance of correct answer

if (isBot) {
    setTimeout(() => {
        if (!state.mgActive) return;
        const answer = Math.random() < BOT_ACCURACY
            ? _correctAnswer
            : _wrongAnswers[Math.floor(Math.random() * _wrongAnswers.length)];
        _submitAnswer(1, answer);
    }, BOT_REACTION);
}
```

### Continuous bot (games with ongoing actions)
```js
function _botLoop() {
    if (!state.mgActive || !_botActive) return;
    _botAction();
    setTimeout(_botLoop, 200 + Math.random() * 300);  // action every 200-500ms
}
if (isBot) _botLoop();
```

---

## THREE.JS MINIGAMES (3D / Canvas)

For games that need a 3D scene or a full `<canvas>`:

### Basic setup
```js
import * as THREE from 'three';

let _renderer, _scene, _camera, _animId;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    registerMinigameCleanup(_cleanup);

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    document.getElementById('minigame-layer').appendChild(canvas);

    _renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    _renderer.setSize(window.innerWidth, window.innerHeight);
    _renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    _renderer.autoClear = false;   // required for split-screen multi-camera

    _scene = new THREE.Scene();
    _camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
    _camera.position.set(0, 10, 0);
    _camera.lookAt(0, 0, 0);

    // ... build scene ...

    _loop();
}

function _loop() {
    if (!state.mgActive) return;
    _animId = requestAnimationFrame(_loop);
    _renderer.clear(true, true, true);
    _renderer.render(_scene, _camera);
}

function _cleanup() {
    cancelAnimationFrame(_animId);
    _renderer?.dispose();
    _renderer?.domElement?.remove();
    _renderer = null; _scene = null; _camera = null; _animId = null;
}
```

### Split-screen 3D (two independent cameras)
```js
// renderer.autoClear = false — set once at init
// Then in render loop:
function _renderSplitScreen() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const halfH = Math.floor(H / 2);

    _renderer.setScissorTest(true);

    // P1: bottom half (WebGL y=0 is bottom of screen)
    _renderer.setScissor(0, 0, W, halfH);
    _renderer.setViewport(0, 0, W, halfH);
    _renderer.clear(true, true, true);
    _renderer.render(_scene, _cameraP1);

    // P2: top half
    _renderer.setScissor(0, halfH, W, halfH);
    _renderer.setViewport(0, halfH, W, halfH);
    _renderer.clear(true, true, true);
    _renderer.render(_scene, _cameraP2);

    _renderer.setScissorTest(false);
}
```

### Top-down orthographic camera that follows a player (reliable matrix approach)
```js
// The only approach that guarantees camera follows reliably in Three.js
// (position.set + lookAt can silently fail to update view matrix in some versions)
const CAM_HALF = 8;  // half-height of orthographic view in world units

function _makeCamera(aspect) {
    const cam = new THREE.OrthographicCamera(
        -CAM_HALF * aspect, CAM_HALF * aspect,  // left, right
        CAM_HALF, -CAM_HALF,                     // top, bottom
        0.1, 120
    );
    cam.matrixAutoUpdate = false;   // disable Three.js auto-update
    return cam;
}

function _updateCamera(cam, playerX, playerZ) {
    const H = 40;  // height above ground
    // World matrix: camera looks straight down (+Y is north on minimap)
    cam.matrixWorld.set(
        1,  0,  0,  playerX,
        0,  0,  1,  H,
        0, -1,  0,  playerZ,
        0,  0,  0,  1
    );
    // Closed-form inverse (transpose rotation, negate translation in cam space)
    cam.matrixWorldInverse.set(
        1,  0,  0, -playerX,
        0,  0, -1,  playerZ,
        0,  1,  0, -H,
        0,  0,  0,  1
    );
}
// Call _updateCamera(cam, player.x, player.z) every frame before rendering
```

---

## WORKED EXAMPLE — "BUTTON MASH" (complete, ready to use)

A simple competitive game: first player to tap 20 times wins.

### `MinigameRegistry.js` additions:
```js
// In MG_TYPES array:
'buttonmash',

// In MG_INFO object:
buttonmash: {
    icon: '👊',
    title: 'BUTTON MASH',
    desc: 'TAP YOUR ZONE AS FAST AS YOU CAN! First to 20 taps wins!',
},

// In MG_ORIENTATION_MAP:
buttonmash: 'quickdraw',
```

### `MinigameManager.js` addition:
```js
// In MG_MODULES:
buttonmash: () => import('./ButtonMash.js'),
```

### `src/minigames/ButtonMash.js`:
```js
import { state }                   from '../core/GameState.js';
import { sfx, haptic }             from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const GOAL = 20;

let _counts, _onWin, _resolved, _root, _listeners, _timers, _botTimeout;

export function start(isBot, onWin) {
    if (!state.mgActive) return;

    _onWin     = onWin;
    _resolved  = false;
    _counts    = [0, 0];
    _listeners = [];
    _timers    = [];
    registerMinigameCleanup(_cleanup);

    // Build UI — two tap zones, one per player
    _root = document.createElement('div');
    _root.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;';

    // P2 zone (top, rendered upside-down for P2)
    const z2 = document.createElement('div');
    z2.id = 'bm-zone-2';
    z2.style.cssText = `
        flex: 1; display:flex; align-items:center; justify-content:center;
        background: rgba(59,142,255,0.15); transform: rotate(180deg);
        font-family: 'Bebas Neue', sans-serif; font-size: 80px; color: #3b8eff;
        user-select:none; -webkit-user-select:none;
    `;
    z2.textContent = '0';

    // Divider
    const div = document.createElement('div');
    div.style.cssText = 'height:4px;background:#fff3;flex-shrink:0;';

    // P1 zone (bottom)
    const z1 = document.createElement('div');
    z1.id = 'bm-zone-1';
    z1.style.cssText = `
        flex: 1; display:flex; align-items:center; justify-content:center;
        background: rgba(255,59,59,0.15);
        font-family: 'Bebas Neue', sans-serif; font-size: 80px; color: #ff3b3b;
        user-select:none; -webkit-user-select:none;
    `;
    z1.textContent = '0';

    _root.append(z2, div, z1);
    document.getElementById('minigame-layer').appendChild(_root);

    // Tap handlers
    const tap = (pid) => (e) => {
        e.preventDefault();
        if (!state.mgActive || _resolved) return;
        _counts[pid]++;
        haptic('light');
        sfx('countdown');
        document.getElementById(`bm-zone-${pid + 1}`).textContent = _counts[pid];
        if (_counts[pid] >= GOAL) _resolve(pid);
    };

    const fn1 = tap(0); z1.addEventListener('pointerdown', fn1);
    const fn2 = tap(1); z2.addEventListener('pointerdown', fn2);
    _listeners.push({ el: z1, type: 'pointerdown', fn: fn1 });
    _listeners.push({ el: z2, type: 'pointerdown', fn: fn2 });

    // Bot: mashes at ~10 taps/sec with some variance
    if (isBot) _botMash();
}

function _botMash() {
    if (!state.mgActive || _resolved || _counts[1] >= GOAL) return;
    _counts[1]++;
    const el = document.getElementById('bm-zone-2');
    if (el) el.textContent = _counts[1];
    if (_counts[1] >= GOAL) { _resolve(1); return; }
    _botTimeout = setTimeout(_botMash, 80 + Math.random() * 60);  // ~12 taps/sec
    _timers.push(_botTimeout);
}

function _resolve(winnerId) {
    if (_resolved) return;
    _resolved = true;
    sfx(winnerId === -1 ? 'land_bad' : 'mg_win');
    _onWin(winnerId);
}

function _cleanup() {
    _timers.forEach(t => clearTimeout(t));
    _timers = [];
    _listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
    _listeners = [];
    _root?.remove();
    _root = null;
    _onWin = null;
    _resolved = false;
    _counts = null;
}
```

---

## GAME DESIGN GUIDELINES

### Do
- Keep rules explainable in 2 sentences (they're shown on the intro screen)
- Make the winner deterministic by ~15–30 seconds at most
- Give clear visual feedback on every player action (flash, number change, etc.)
- Use `sfx()` calls for key moments (tap, score, win)
- Handle the case where both players trigger a win condition simultaneously (call `_resolve(-1)` for tie)
- Test that your game works with `isBot = true` (bot should eventually resolve the game)

### Don't
- Don't use `alert()`, `confirm()`, or `prompt()` — they block the thread
- Don't use CSS transitions/animations that prevent taps from registering (`pointer-events:none` issues)
- Don't assume a specific screen size — use `window.innerWidth` / `window.innerHeight` and percentages
- Don't leave event listeners or timers running after `_cleanup()` — they'll cause memory leaks and ghost events in the next minigame
- Don't put game logic in `_cleanup()` — only teardown goes there
- Don't reference DOM elements by ID that the manager already uses (`mg-ready-1`, `mg-ready-2`, `mg-countdown`, `mg-neutral`) unless you're just reading them

### Screen Coordinates
- P1 (bottom half): `clientY > window.innerHeight / 2`
- P2 (top half):   `clientY < window.innerHeight / 2`
- P2's content should be `transform: rotate(180deg)` so it reads right-side-up to P2

### Timing Reference
- Reaction games: bot delay 400–900ms (realistic human reaction)
- Skill games: bot delay 800–1500ms for moderate difficulty
- Continuous action: bot interval 80–200ms per action
- Global hard cap: 45 seconds (MinigameManager auto-calls `winMinigame(-1)`)
- Recommended game length: 10–30 seconds of active play

---

## QUICK REFERENCE CHECKLIST

When an AI creates a new minigame, verify:

- [ ] Key added to `MG_TYPES` in `MinigameRegistry.js`
- [ ] `MG_INFO` entry added (icon, title, desc)
- [ ] `MG_ORIENTATION_MAP` entry added (faceoff / quickdraw / stargazer / huddle)
- [ ] Lazy import added to `MG_MODULES` in `MinigameManager.js`
- [ ] `start(isBot, onWin)` is the only export
- [ ] First line of `start()` is `if (!state.mgActive) return;`
- [ ] `registerMinigameCleanup(_cleanup)` called immediately after guard
- [ ] `onWin` called with `0`, `1`, or `-1` exactly once
- [ ] `_cleanup()` cancels all RAF, timeouts, intervals, removes listeners and DOM
- [ ] Bot (`isBot === true`) eventually resolves the game without human input
- [ ] No direct writes to `state.players[i].coins`
- [ ] No calls to `winMinigame()` directly — only call the `onWin` parameter
- [ ] No DOM IDs that conflict with existing minigame-layer elements
