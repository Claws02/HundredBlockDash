// ============================================================
// MINIGAME MANAGER — intro sequence, orientation, countdown,
// and the final win/lose handoff back to GameController.
// Adding a new minigame: register it in MinigameRegistry.js
// and create a new file in src/minigames/. That's it.
// ============================================================

import { state } from '../core/GameState.js';
import * as Bot from '../core/Bot.js';
import { MG_TYPES, MG_INFO, MG_ORIENTATIONS, MG_ORIENTATION_MAP, MG_WATCHDOG_MS } from '../config/MinigameRegistry.js';
import { MINIGAME_REWARD } from '../config/GameConfig.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import * as DualRead from '../ui/DualRead.js';

// Lazy-loaded minigame modules
const MG_MODULES = {
    sumospheres: () => import('./SumoSpheres.js'),
    tankclash:   () => import('./TankClash.js'),
    rhythmforge: () => import('./RhythmForge.js'),
    orbdeflect:  () => import('./OrbDeflect.js'),
    snapstrike:  () => import('./SnapStrike.js'),
    quickdraw:   () => import('./QuickDraw.js'),
    gridrecall:  () => import('./GridRecall.js'),
    oddoneout:   () => import('./OddOneOut.js'),
    steadyhand:  () => import('./SteadyHand.js'),
    sortrush:    () => import('./SortRush.js'),
    meteordodge: () => import('./MeteorDodge.js'),
    lootcatch:   () => import('./LootCatch.js'),
    freeze:      () => import('./Freeze.js'),
    clearout:    () => import('./ClearOut.js'),
    puck:        () => import('./Puck.js'),
    penalty:     () => import('./Penalty.js'),
    lightcycles: () => import('./LightCycles.js'),
    fourinarow:  () => import('./FourInARow.js'),
    memorymatch: () => import('./MemoryMatch.js'),
    bombpass:    () => import('./BombPass.js'),
    grandprix:   () => import('./GrandPrix.js'),
    treeclimb:   () => import('./TreeClimb.js'),
};

// The single place that knows which file a game lives in. Exported so the QA
// probes don't each keep their own copy of the table — botcheck.js did, and it
// silently went stale the moment a game was added.
export function loadMinigame(type) {
    const loader = MG_MODULES[type] || MG_MODULES[MG_TYPES[0]];
    return loader();
}

// ============================================================
// THE ROSTER — which two seats are playing this minigame
// ============================================================
// Every minigame in the roster is 1v1: two halves of one screen, `_p1`/`_p2`,
// a bot in slot 1. Making all 22 of them four-player is Phase C/D work
// (docs/MULTIPLAYER_PLAN.md); it is not a prerequisite for playing the BOARD
// with three or four people.
//
// So a minigame keeps its two SLOTS, and this table says which real SEAT is
// sitting in each. At two players it is the identity mapping and nothing about
// the existing behaviour changes. At three or four the round's minigame is a
// duel between two of them, picked by a fixed rotation so everybody gets the
// same number of turns and every device computes the same pairing.
//
// The contract, because getting it backwards is the obvious bug here:
//   • a minigame module calls winMinigame(SLOT)  — 0 or 1
//   • endMinigame() and _onComplete take a real SEAT id
let _seats = [0, 1];

/** Real seat id sitting in minigame slot `slot`. */
export function seatFor(slot) {
    const id = _seats[slot];
    return (typeof id === 'number' && state.players[id]) ? id : slot;
}
/** The player object in slot `slot`. */
function _sp(slot) { return state.players[seatFor(slot)] || state.players[0]; }
/** The two seats playing, in slot order. */
export function roster() { return _seats.slice(); }

function _setRoster(seats) {
    const n = state.players.length;
    const ok = Array.isArray(seats) && seats.length === 2
        && seats.every(i => typeof i === 'number' && i >= 0 && i < n)
        && seats[0] !== seats[1];
    _seats = ok ? seats.slice() : [0, Math.min(1, n - 1)];
}

// Round-robin pairings. Every pair appears the same number of times, and the
// cycle is indexed off the round counter so the host and every client pick the
// same two players without exchanging a message about it.
const PAIR_CYCLE = {
    3: [[0, 1], [0, 2], [1, 2]],
    4: [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]],
};

/** Who plays this round's minigame when nobody named a pair. */
export function chooseParticipants() {
    const n = state.players.length;
    if (n <= 2) return [0, 1];
    const cyc = PAIR_CYCLE[n] || PAIR_CYCLE[4];
    return cyc[(state.currentRound || 0) % cyc.length].slice();
}

let _controller   = null;
let _onComplete   = null;
let _botTraceInt  = null;
let _standaloneMode = false;
// Practice runs the real game with the real bot, but nothing it produces counts:
// no coins, no turn order, no board consequence. Set for both the arcade's
// PRACTICE button and the "TRY IT FIRST" option on the in-match intro card.
let _practiceMode   = false;
let _practiceReturn = null;   // called when a practice round finishes
let _countdownActive = false;
let _countdownIv  = null;
let _botReadyTimeout = null;
let _minigameTimeout = null;
let _resolving = false;   // true once a minigame's result is being finalised
const _minigameCleanups = [];
// Dual confirm on the rules card: in tabletop mode BOTH players have to press
// GOT IT before the intro advances. Without this the active player could tap
// straight through the explanation of a game the other one has never seen.
let _introReady = [false, false];
// Arcade-only scoreline. Deliberately separate from anything the board reads:
// player.coins and player.mgWins belong to a match and must not move here.
let _arcadeWins  = [0, 0];
let _arcadeDraws = 0;

// Fifteen games write their clock and score into #mg-neutral with plain
// textContent. Rather than change all of them, mirror the element: an observer
// copies whatever they write into a second, 180°-rotated copy on the far side of
// the centre line, so the player at the other end reads the same status.
let _neutralObserver = null;

function _syncNeutralMirror() {
    const src = document.getElementById('mg-neutral');
    const dst = document.getElementById('mg-neutral-mirror');
    if (!src || !dst) return;
    const txt = src.textContent || '';
    dst.textContent = txt;
    // An empty strip should not leave two empty pills floating over the game.
    const show = txt.trim() ? '' : 'none';
    src.style.display = show; dst.style.display = show;
    if (!_neutralObserver) {
        _neutralObserver = new MutationObserver(() => _syncNeutralMirror());
        _neutralObserver.observe(src, { childList: true, characterData: true, subtree: true });
    }
}

export function init(controller) {
    _controller = controller;
    _syncNeutralMirror();
    document.getElementById('mg-ready-1').addEventListener('pointerdown', e => { e.preventDefault(); setReady(0); });
    document.getElementById('mg-ready-2').addEventListener('pointerdown', e => { e.preventDefault(); setReady(1); });
    document.getElementById('btn-mg-intro-next').addEventListener('pointerdown', e => {
        e.preventDefault();
        _confirmIntro(DualRead.pressedSide());
    });
    document.getElementById('btn-mg-launch').addEventListener('pointerdown', e => { e.preventDefault(); launchMinigameUI(); });

    const blockBrowserGestures = e => {
        if (state.gameState === 'MINIGAME' || state.gameState === 'MINIGAME_INTRO') e.preventDefault();
    };
    document.addEventListener('touchstart', blockBrowserGestures, { passive: false });
    document.addEventListener('touchmove', blockBrowserGestures, { passive: false });
    document.addEventListener('gesturestart', blockBrowserGestures, { passive: false });
    document.addEventListener('contextmenu', blockBrowserGestures);

    document.addEventListener('visibilitychange', () => {
        if (state.gameState === 'MINIGAME' && document.hidden) {
            document.getElementById('mg-neutral').textContent = 'PAUSED BY BROWSER';
        }
    });
}

export function isPractice() { return _practiceMode; }

// ---- Practice ----------------------------------------------------------------
// Runs `mgType` with no stakes. `onDone` is called once the round is over so the
// caller can put the player back where they were — the arcade grid, or the
// pre-match intro card so they can then play it for real.
export function triggerPractice(mgType, isBotOpponent, onDone) {
    _practiceMode   = true;
    _practiceReturn = onDone || null;
    _standaloneMode = true;         // reuse the standalone teardown path
    _onComplete     = () => {};

    state.gameState   = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    state.mgType      = mgType;
    _setRoster([0, 1]);
    state.players[1].isBot = !!isBotOpponent;

    document.getElementById('mg-select-overlay').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'none';
    _showPracticeHold(mgType);
}

// Practice skips the rules card. Whoever pressed practice has just read those
// rules (or picked the game off the arcade grid), and re-showing the same card
// meant confirming twice in a row — in tabletop mode, twice from BOTH players.
// Straight to the orientation/ready screen with one small tag, and one READY.
function _showPracticeHold(mgType) {
    DualRead.clearAll();
    const info = document.getElementById('mg-page-info');
    document.getElementById('mg-intro-overlay').style.display = 'flex';
    document.getElementById('mg-countdown').style.display     = 'none';
    info.style.display = 'none';
    DualRead.unmirror(info);          // its copy must not outlive it
    document.getElementById('mg-page-hold').style.display = 'block';
    document.getElementById('mg-step-0').classList.add('done');
    document.getElementById('mg-step-1').classList.add('done');
    document.getElementById('mg-step-2').classList.remove('done');
    _introReady = [false, false];
    _setPracticeButton(false);
    _setPracticeBanner(true);         // before the snapshot, so the mirror has it
    _renderOrientationDiagram(mgType);
    DualRead.present(document.getElementById('mg-page-hold'), { tier: 'shared' });
    sfx('mg_start');
}

// ---- Standalone entry point (called from minigame selector on main screen) ----

export function triggerStandalone(mgType, isBotOpponent = false) {
    _practiceMode = false;
    _standaloneMode = true;
    _onComplete = () => {
        document.getElementById('mg-select-overlay').style.display = 'flex';
    };

    state.gameState   = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    state.mgType      = mgType;
    _setRoster([0, 1]);
    state.players[1].isBot = !!isBotOpponent;

    document.getElementById('mg-select-overlay').style.display = 'none';
    _showIntroCard(mgType);
}

// ---- Dual read: the rules card is a SHARED beat ---------------------------
//
// Both players are about to play this game, so in tabletop mode the card is
// drawn twice (top copy rotated) and BOTH have to press GOT IT before the intro
// advances. Anywhere else it is one card with one button, exactly as before.

function _presentIntroCard() {
    const card = document.getElementById('mg-page-info');
    if (!card) return;
    const dual = DualRead.isMirrorMode();
    _paintIntroConfirm(card, 0, dual, false);
    DualRead.present(card, {
        tier: 'shared',
        // The two copies show different text: each side tracks its own player.
        decorate: m => _paintIntroConfirm(m, 1, dual, true),
    });
}

// `side` 0 is the real card at Player 1's edge, 1 is the mirrored copy at
// Player 2's. `isMirror` says which DOM we are painting — the mirror's ids have
// been demoted to data-mirror-id so they cannot shadow the real elements.
function _paintIntroConfirm(root, side, dual, isMirror) {
    const q = id => isMirror ? root.querySelector(`[data-mirror-id="${id}"]`)
                             : document.getElementById(id);
    const btn = q('btn-mg-intro-next');
    let note  = q('mg-intro-ready-note');
    if (!dual) {
        if (btn) { btn.textContent = 'GOT IT →'; btn.classList.remove('dual-done'); }
        if (note) note.style.display = 'none';
        return;
    }
    if (!note && !isMirror && btn) {
        note = document.createElement('div');
        note.id = 'mg-intro-ready-note';
        note.className = 'dual-ready-note';
        btn.parentNode.insertBefore(note, btn.nextSibling);
    }
    const me = _introReady[side], them = _introReady[1 - side];
    if (btn) {
        btn.textContent = me ? '✓ READY' : 'GOT IT →';
        btn.classList.toggle('dual-done', me);
    }
    if (note) {
        note.style.display = '';
        note.textContent = me
            ? (them ? 'Both ready!' : 'Waiting for the other player…')
            : 'Both players tap once you have read it';
    }
}

function _confirmIntro(side) {
    if (!DualRead.isMirrorMode()) { mgIntroNext(); return; }
    _introReady[side] = true;
    if (_introReady[0] && _introReady[1]) {
        _introReady = [false, false];
        mgIntroNext();
        return;
    }
    _presentIntroCard();   // repaint both sides and re-snapshot the mirror
}

// Builds the rules card. Practice never comes through here — it goes straight to
// the ready screen — so this is always the real thing.
function _showIntroCard(mgType) {
    document.getElementById('mg-intro-overlay').style.display  = 'flex';
    document.getElementById('mg-countdown').style.display      = 'none';
    document.getElementById('mg-page-info').style.display      = 'block';
    document.getElementById('mg-page-hold').style.display      = 'none';
    [0, 1, 2].forEach(i => document.getElementById(`mg-step-${i}`).classList.remove('done'));

    const info = MG_INFO[mgType];
    document.getElementById('mg-intro-icon').textContent  = info.icon;
    document.getElementById('mg-intro-title').textContent = info.title;
    document.getElementById('mg-intro-desc').textContent  = info.desc;
    _setPracticeBanner(false);
    _setPracticeButton(false);
    document.getElementById('mg-step-0').classList.add('done');
    _introReady = [false, false];
    _presentIntroCard();
    sfx('mg_start');
}

// The "this one is for practice" tag on the ready screen. Deliberately a small
// pill rather than a strip of prose: a full-width banner above the orientation
// diagram pushed the READY button off the bottom of a 412×892 phone.
function _setPracticeBanner(on) {
    let el = document.getElementById('mg-practice-banner');
    if (!on) { if (el) el.style.display = 'none'; return; }
    if (!el) {
        el = document.createElement('div');
        el.id = 'mg-practice-banner';
        el.className = 'mg-practice-banner';
        const page = document.getElementById('mg-page-hold');
        page.insertBefore(el, page.firstChild);
    }
    el.textContent = '🎯 PRACTICE — no stakes';
    el.style.display = '';     // '' keeps the stylesheet's inline-block, not 'block'
}

// "TRY IT FIRST" button on the in-match intro card.
function _setPracticeButton(on) {
    let btn = document.getElementById('btn-mg-practice');
    if (!on) { if (btn) btn.style.display = 'none'; return; }
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'btn-mg-practice';
        btn.className = 'btn-close mg-practice-btn';
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            _startInMatchPractice();
        });
        const next = document.getElementById('btn-mg-intro-next');
        next.parentNode.insertBefore(btn, next.nextSibling);
    }
    btn.textContent = '🎯 TRY IT FIRST (no stakes)';
    btn.style.display = 'block';
    DualRead.refresh(document.getElementById('mg-page-info'));
}

// From the pre-match intro: play a no-stakes round, then come back to the card
// so the real match can start when the player is ready.
function _startInMatchPractice() {
    const type = state.mgType;
    const wasBot = _sp(1).isBot;
    const resume = _onComplete;              // the real match's continuation
    const wasStandalone = _standaloneMode;
    triggerPractice(type, wasBot, () => {
        // Restore the real match's hand-off and show the card again.
        _practiceMode   = false;
        _practiceReturn = null;
        _standaloneMode = wasStandalone;
        _onComplete     = resume;
        state.gameState = 'MINIGAME_INTRO';
        state.cameraState = 'MINIGAME';
        state.mgType    = type;
        _sp(1).isBot = wasBot;
        _showIntroCard(type);
        _setPracticeButton(true);
        _presentIntroCard();          // the practice button changed the card
        document.getElementById('mg-intro-overlay').style.display = 'flex';
    });
}

// ---- Which game comes next -------------------------------------------------
//
// A draw bag, not a die roll. Uniform random on an 18-game roster still repeats
// itself inside the first four minigames more than half the time, and a repeat
// reads as the game being broken rather than as luck. Every game is dealt once
// before any is dealt twice.
//
// Exported so the QA sweep can assert the guarantee over a whole match.
export function nextMgType() {
    if (!Array.isArray(state.mgBag) || state.mgBag.length === 0) {
        state.mgBag = _shuffled(MG_TYPES);
        // Refilling can otherwise put the previous bag's last game first in the
        // new one — a back-to-back repeat, which is the exact thing this is for.
        if (state.mgBag.length > 1 && state.mgBag[state.mgBag.length - 1] === state.mgLastType) {
            const last = state.mgBag.length - 1;
            const swap = Math.floor(Math.random() * last);
            [state.mgBag[last], state.mgBag[swap]] = [state.mgBag[swap], state.mgBag[last]];
        }
    }
    state.mgLastType = state.mgBag.pop();
    return state.mgLastType;
}

// How many games are still undealt in this match's bag. Only for the QA sweep
// and the debug readout.
export function mgBagRemaining() { return (state.mgBag || []).length; }

function _shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---- Entry point called by GameController ----

// `seats` names the two players. A duel and a buddy fight both know exactly who
// is involved and pass it; the round-end minigame does not, and takes the
// rotation. Two-player matches always resolve to [0, 1].
export function trigger(onComplete, seats) {
    _practiceMode = false;
    _standaloneMode = false;
    _setRoster(seats || chooseParticipants());
    _onComplete = onComplete;
    state.gameState  = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    state.mgType = nextMgType();

    document.getElementById('ui-layer').style.display  = 'none';
    document.getElementById('mg-intro-overlay').style.display = 'flex';
    document.getElementById('mg-countdown').style.display = 'none';
    document.getElementById('mg-page-info').style.display  = 'block';
    document.getElementById('mg-page-hold').style.display  = 'none';
    [0, 1, 2].forEach(i => document.getElementById(`mg-step-${i}`).classList.remove('done'));

    const titleEl = document.getElementById('mg-intro-title');
    titleEl.textContent = 'SELECTING...';
    document.getElementById('mg-intro-desc').textContent = '';

    const allNames = Object.values(MG_INFO).map(m => m.title);
    let ticks = 0;
    const iv = setInterval(() => {
        titleEl.textContent = allNames[Math.floor(Math.random() * allNames.length)];
        if (++ticks >= 15) {
            clearInterval(iv);
            const info = MG_INFO[state.mgType];
            document.getElementById('mg-intro-icon').textContent   = info.icon;
            titleEl.textContent = info.title;
            document.getElementById('mg-intro-desc').textContent   = info.desc;
            document.getElementById('mg-step-0').classList.add('done');
            _setPracticeBanner(false);
            // Once the game is known, offer a no-stakes run of it first.
            _setPracticeButton(true);
            _introReady = [false, false];
            _presentIntroCard();
            sfx('mg_start');
        }
    }, 100);

    // The intro used to auto-advance after 3 s against the bot, which would blow
    // straight past the practice offer. It now waits for the player to choose
    // GOT IT or TRY IT FIRST — the countdown still runs itself after that.
}

// ---- Step 2: orientation screen ----

function mgIntroNext() {
    const info = document.getElementById('mg-page-info');
    info.style.display = 'none';
    DualRead.unmirror(info);          // its copy must not outlive it
    document.getElementById('mg-page-hold').style.display = 'block';
    document.getElementById('mg-step-1').classList.add('done');
    _setPracticeBanner(false);        // the tag lives on this page; this is the real match
    _renderOrientationDiagram(state.mgType);
    // "We're ready" is already a both-of-you prompt, so it mirrors but keeps a
    // single confirm.
    DualRead.present(document.getElementById('mg-page-hold'), { tier: 'shared' });
}

function _renderOrientationDiagram(mgTypeKey) {
    const orientKey = MG_ORIENTATION_MAP[mgTypeKey] || 'faceoff';
    const orient    = MG_ORIENTATIONS[orientKey];
    document.getElementById('orient-name').textContent    = orient.name;
    document.getElementById('orient-subtitle').textContent = orient.subtitle;
    document.getElementById('orient-instructions').innerHTML = orient.instructions;
    const diag = document.getElementById('phone-diagram');
    diag.innerHTML = '';
    diag.className = 'phone-diagram' + (orient.huddle ? ' huddle' : '');
    if (orient.huddle) {
        diag.innerHTML = `<div class="ph-body"></div><div class="ph-screen" style="inset:8px 12px;"><div style="width:100%;height:100%;background:linear-gradient(90deg,rgba(255,59,59,.08),rgba(59,142,255,.08));display:flex;align-items:center;justify-content:center;font-size:22px;letter-spacing:2px;font-family:'Bebas Neue';color:rgba(255,255,255,.3);">CARDS</div></div><div class="ph-grip holder" style="left:-3px;top:-3px;bottom:-3px;right:auto;width:36px;height:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:18px 4px 4px 18px;background:rgba(255,59,59,.85);border:2px solid #ff3b3b;"><span style="font-size:11px;font-family:'Bebas Neue';color:#fff;writing-mode:vertical-rl;text-orientation:mixed;">P1</span></div>`;
    } else {
        const anim1 = orient.thumbAnim === 'strike' ? 'strike'     : 'pulse';
        const anim2 = orient.thumbAnim === 'strike' ? 'strike-rot' : 'pulse-rot';
        diag.innerHTML = `<div class="ph-body"></div><div class="ph-camera"></div><div class="ph-screen"><div class="ph-screen-p2"><span style="font-size:11px;font-family:'Bebas Neue';color:rgba(59,142,255,.6);letter-spacing:1px;">P2 ZONE</span></div><div class="ph-divider"></div><div class="ph-screen-p1"><span style="font-size:11px;font-family:'Bebas Neue';color:rgba(255,59,59,.6);letter-spacing:1px;">P1 ZONE</span></div></div><div class="ph-home"></div><div class="ph-grip p1"><span>👍</span><span>P1</span></div><div class="ph-grip p2"><span>P2</span><span>👍</span></div><div class="ph-thumb p1 ${anim1}" style="left:50%;transform:translateX(-50%);">👆</div><div class="ph-thumb p2 ${anim2}" style="left:50%;transform:translateX(-50%) rotate(180deg);">👆</div>`;
    }
}

// ---- Step 3: launch the actual game ----

function launchMinigameUI() {
    DualRead.clearAll();
    document.getElementById('mg-page-hold').style.display  = 'none';
    document.getElementById('mg-step-2').classList.add('done');
    document.getElementById('mg-intro-overlay').style.display = 'none';
    _startMinigameLayer();
}

function _startMinigameLayer() {
    _runMinigameCleanups();
    clearTimeout(_minigameTimeout);
    clearInterval(_countdownIv); _countdownIv = null;
    clearTimeout(_botReadyTimeout); _botReadyTimeout = null;
    _countdownActive = false;
    _resolving = false;
    _lastPayouts = [0, 0];
    state.gameState = 'MINIGAME';

    // Sweep any orphaned game overlay left by a force-ended minigame.
    // Game overlays (appended by each module's _build/_buildDOM) have no element ID;
    // every permanent child of #minigame-layer does. Removing ID-less children
    // prevents the previous game's end-state from reappearing as a ghost.
    const layer = document.getElementById('minigame-layer');
    Array.from(layer.children).filter(el => !el.id).forEach(el => el.remove());
    // Also ensure a stale countdown element is hidden.
    const cd = document.getElementById('mg-countdown');
    if (cd) cd.style.display = 'none';

    layer.style.display = 'flex';
    state.mgReady  = [false, false];
    state.mgActive = false;

    [1, 2].forEach(i => {
        const rd = document.getElementById(`mg-ready-${i}`);
        rd.style.display = 'block'; rd.classList.remove('ready'); rd.textContent = 'READY';
    });
    document.getElementById('mg-neutral').textContent = 'BOTH PLAYERS TAP READY!';

    if (_sp(1).isBot) _botReadyTimeout = setTimeout(() => { _botReadyTimeout = null; setReady(1); }, 800);
}

// ---- Ready + countdown ----

export function setReady(pid) {
    if (_countdownActive || state.mgReady?.[pid]) return;
    state.mgReady[pid] = true;
    const btn = document.getElementById(`mg-ready-${pid + 1}`);
    btn.classList.add('ready'); btn.textContent = '✓ READY';
    sfx('countdown');

    if (state.mgReady[0] && state.mgReady[1]) {
        _countdownActive = true;
        document.getElementById('mg-neutral').textContent = 'GET SET...';
        const cd = document.getElementById('mg-countdown');
        cd.style.display = 'block'; cd.textContent = '3'; sfx('countdown');
        document.getElementById('minigame-layer').appendChild(cd);
        let count = 3;
        _countdownIv = setInterval(() => {
            count--;
            if (count > 0) {
                cd.textContent = count; cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = 'countPop .4s ease'; sfx('countdown');
            } else if (count === 0) {
                cd.textContent = 'GO!'; cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = 'countPop .4s ease'; sfx('go');
            } else {
                clearInterval(_countdownIv); _countdownIv = null;
                cd.style.display = 'none';
                [1, 2].forEach(i => document.getElementById(`mg-ready-${i}`).style.display = 'none');
                state.mgActive = true;
                document.getElementById('mg-neutral').textContent = 'MINIGAME TIME';
                _launchGame();
            }
        }, 900);
    }
}

async function _launchGame() {
    try {
        const loader = MG_MODULES[state.mgType] || MG_MODULES[MG_TYPES[0]];
        const mod    = await loader();
        // RhythmForge legitimately takes ~57 s (3 rounds × 2 players + transitions).
        // 90 s gives every game a comfortable safety margin — except the four
        // that deliberately run to a conclusion instead of to a clock, which
        // declare their own in MG_WATCHDOG_MS.
        _minigameTimeout = setTimeout(() => {
            if (state.gameState === 'MINIGAME' && state.mgActive) {
                document.getElementById('mg-neutral').textContent = 'TIME\'S UP! TIE!';
                sfx('land_bad');
                winMinigame(-1);
            }
        }, MG_WATCHDOG_MS[state.mgType] || 90000);
        mod.start(_sp(1).isBot, winMinigame, Bot.skill());
    } catch (e) {
        console.error('[MinigameManager] _launchGame failed:', e);
        endMinigame(-1);
    }
}

// ---- Win / end ----

const MINIGAME_TIE_REWARD = Math.floor(MINIGAME_REWARD / 2); // 5 coins each on tie

// What each player banked from a coin game this round, for the result screen.
let _lastPayouts = [0, 0];

export function lastPayouts() { return _lastPayouts.slice(); }

// Bank a coin game's per-player haul. Kept separate from the win reward so the
// result screen can show "caught 24" and "+10 for the win" as different things.
function _creditPayouts(payouts) {
    if (!Array.isArray(payouts)) return [0, 0];
    const out = [0, 0];
    for (let i = 0; i < 2; i++) {
        const n = Math.max(0, Math.round(payouts[i] || 0));
        out[i] = n;
        // Indexed by SLOT and paid to the SEAT sitting in it.
        if (n > 0) { const q = _sp(i); q.coins += n; q.coinsEarned += n; }
    }
    if (out[0] || out[1]) {
        sfx('coin_gain');
        import('../ui/UIManager.js').then(({ animateCoinDisplay, updateUI }) => {
            state.players.forEach((p, i) => animateCoinDisplay(i, p.coins));
            updateUI();
        });
    }
    return out;
}

// `payouts` is the coin-game extension: a game may pass [p1Coins, p2Coins] as a
// second argument, and BOTH players keep every coin they earned in it — not just
// the winner. The winner still takes the standard reward on top and still rolls
// first, so winning is worth something beyond the haul. Games that don't pass it
// behave exactly as before.
// `winnerId` is a SLOT (0, 1, or -1 for a tie) — that is what the minigame
// modules speak. Everything below translates it to a real seat before anything
// the board reads is touched.
export function winMinigame(winnerId, payouts) {
    if (_practiceMode) return _finishPractice(winnerId);
    // The arcade is a place to play the minigames, not a way to earn. It used to
    // run the full match payout — flat win reward, coin-game hauls, mgWins, the
    // lot — straight onto the real players, and those totals STACKED across
    // rounds because nothing reset them until a board match started. Playing the
    // arcade for ten minutes and then starting a game handed somebody a fortune.
    // It keeps a round tally instead and touches nothing the board cares about.
    if (_standaloneMode) return _finishArcade(winnerId);
    // Guard against double-resolution. Don't key this off state.mgActive:
    // most minigames clear mgActive in their own _finish() before calling
    // onWin, which previously made this early-return and strand the result.
    if (_resolving) return;
    _resolving = true;
    state.mgActive = false;
    _lastPayouts = _creditPayouts(payouts);
    if (winnerId < 0) {
        // TIE — both players get coins, coin flip decides who goes first.
        // "Both" means the two who played: in a four-player match the two
        // spectators did not draw anything and must not be paid for it.
        const flipSlot   = Math.random() < 0.5 ? 0 : 1;
        const flipWinner = seatFor(flipSlot);
        [0, 1].forEach(slot => {
            const p = _sp(slot);
            p.coins += MINIGAME_TIE_REWARD;
            p.coinsEarned += MINIGAME_TIE_REWARD;
        });
        import('../ui/UIManager.js').then(({ animateCoinDisplay, updateUI }) => {
            state.players.forEach((p, i) => animateCoinDisplay(i, p.coins));
            updateUI();
        });
        sfx('coin_gain');
        document.getElementById('mg-neutral').textContent = `TIE! 🪙 BOTH +${MINIGAME_TIE_REWARD} — COIN FLIP!`;
        // Flash both player zones
        const z1 = document.getElementById('mg-p1');
        const z2 = document.getElementById('mg-p2');
        z1?.classList.add('mg-victory');
        z2?.classList.add('mg-victory');
        state.lastMinigameTied = true;
        setTimeout(() => {
            z1?.classList.remove('mg-victory');
            z2?.classList.remove('mg-victory');
            document.getElementById('mg-neutral').textContent = `${state.players[flipWinner].name.toUpperCase()} GOES FIRST!`;
            _showScoreboard(-1, _lastPayouts, false, () => {
                _resultToast(`🤝 TIE! Both get ${MINIGAME_TIE_REWARD} coins — coin flip: ${state.players[flipWinner].name} goes first!`, '#a855f7');
                endMinigame(flipWinner);
            });
        }, 700);
        return;
    }
    const winSeat = seatFor(winnerId);
    const winner  = state.players[winSeat];
    winner.mgWins++;
    winner.coins += MINIGAME_REWARD;
    winner.coinsEarned += MINIGAME_REWARD;
    import('../ui/UIManager.js').then(({ animateCoinDisplay, updateUI }) => {
        animateCoinDisplay(winSeat, winner.coins);
        updateUI();
    });
    sfx('mg_win');
    const winZone  = document.getElementById(`mg-p${winnerId + 1}`);
    const loseZone = document.getElementById(`mg-p${2 - winnerId}`);
    winZone?.classList.add('mg-victory');
    loseZone?.classList.add('mg-defeat');
    document.getElementById('mg-neutral').textContent = `${winner.name.toUpperCase()} WINS! +${MINIGAME_REWARD} 🪙`;
    setTimeout(() => {
        winZone?.classList.remove('mg-victory');
        loseZone?.classList.remove('mg-defeat');
        _showScoreboard(winnerId, _lastPayouts, false, () => {
            const haul = _lastPayouts[winnerId]
                ? ` (+${_lastPayouts[winnerId]} caught — both players keep theirs)` : '';
            _resultToast(`🏆 ${winner.name} wins ${MINIGAME_REWARD} coins and goes first!${haul}`, '#f5c842');
            endMinigame(winSeat);
        });
    }, 800);
}

// Fired after the scoreboard is dismissed, not before: a toast is pinned to the
// centre of the screen and sits above the scoreboard's z-index, so raising it
// alongside the cards laid a truncated duplicate of the result across them.
function _resultToast(msg, color) {
    import('../ui/UIManager.js').then(({ toast }) => toast(msg, color));
}

// ── Post-game scoreboard ────────────────────────────────────────────────────
//
// Every minigame used to end on a one-line flash in the status strip, which the
// losing player often never read. This is a proper result screen: both player
// cards, both coin totals, and a FIRST / SECOND badge saying who rolls next.
// The whole row is drawn twice — once rotated — so each end of the table gets
// the full comparison the right way up, the same idiom the minigames themselves
// use for their two halves.
//
// `payouts` is the per-player coin-game haul (see _creditPayouts); zero for the
// ordinary games, where only the winner's flat reward moved. `practice` is kept
// so a practice variant can be reinstated if it ever earns its place — today
// practice skips this screen entirely, because it pays out nothing.
function _showScoreboard(winnerId, payouts, practice, done) {
    const layer = document.getElementById('minigame-layer');
    if (!layer) { done(); return; }
    const old = layer.querySelector('.mg-score-screen');
    if (old) old.remove();

    const scr = document.createElement('div');
    scr.className = 'mg-score-screen';

    // `practice` doubles as the mode: 'arcade' shows a running scoreline and no
    // money at all, because nothing was ever at stake there.
    const arcade = practice === 'arcade';

    // Two cards, for the two SLOTS that played — not one per seat. A
    // four-player match has two spectators and they have no result to show.
    const cardsHTML = () => [0, 1].map((i) => {
        const p = arcade ? state.players[i] : _sp(i);
        const isWin  = winnerId === i;
        const isTie  = winnerId < 0;
        const rank   = isTie ? '🤝 DRAW' : isWin ? '🥇 WINNER' : '🥈 SECOND';
        const rankCls = isTie ? 'mg-sc-tie' : isWin ? 'mg-sc-first' : 'mg-sc-second';
        if (arcade) {
            return `<div class="mg-sc-card ${isWin && !isTie ? 'mg-sc-win' : ''}">
                <div class="mg-sc-rank ${rankCls}">${rank}</div>
                <div class="mg-sc-name" style="color:${i === 0 ? '#ff6b6b' : '#6ba7ff'}">${p.name}</div>
                <div class="mg-sc-coins">${_arcadeWins[i]}<span class="mg-sc-unit">won</span></div>
                <div class="mg-sc-line mg-sc-dim">rounds won in the arcade</div>
            </div>`;
        }
        const gained = (payouts && payouts[i]) || 0;
        const bonus  = practice ? 0
                     : isTie ? MINIGAME_TIE_REWARD
                     : isWin ? MINIGAME_REWARD : 0;
        const lines = [];
        if (gained) lines.push(`<span class="mg-sc-line">🪙 caught <b>+${gained}</b></span>`);
        if (bonus)  lines.push(`<span class="mg-sc-line">🏆 win bonus <b>+${bonus}</b></span>`);
        if (!lines.length) lines.push(`<span class="mg-sc-line mg-sc-dim">${practice ? 'practice — nothing at stake' : 'no coins this round'}</span>`);
        return `<div class="mg-sc-card ${isWin && !isTie ? 'mg-sc-win' : ''}">
            <div class="mg-sc-rank ${rankCls}">${rank}</div>
            <div class="mg-sc-name" style="color:${i === 0 ? '#ff6b6b' : '#6ba7ff'}">${p.name}</div>
            <div class="mg-sc-coins">${p.coins}<span class="mg-sc-unit">🪙</span></div>
            ${lines.join('')}
            <div class="mg-sc-line mg-sc-dim">minigames won: <b>${p.mgWins}</b></div>
        </div>`;
    }).join('');

    const headline = arcade
        ? (winnerId < 0 ? 'DRAWN ROUND' : `${state.players[winnerId].name.toUpperCase()} WINS THE ROUND`)
        : practice ? 'PRACTICE ROUND'
        : winnerId < 0 ? 'IT\'S A TIE!'
                       : `${_sp(winnerId).name.toUpperCase()} WINS!`;
    const total = _arcadeWins[0] + _arcadeWins[1] + _arcadeDraws;
    const sub = arcade
        ? `Arcade series ${_arcadeWins[0]}–${_arcadeWins[1]}${_arcadeDraws ? ` (${_arcadeDraws} drawn)` : ''} · round ${total} · no coins at stake`
        : practice ? 'Nothing at stake'
        : winnerId < 0 ? 'Coin flip decides who rolls first'
                       : 'Rolls first next turn';

    const panel = side => `<div class="mg-sc-panel ${side}">
        <div class="mg-sc-head">${headline}</div>
        <div class="mg-sc-sub">${sub}</div>
        <div class="mg-sc-row">${cardsHTML()}</div>
        <button class="mg-sc-btn" type="button">CONTINUE →</button>
    </div>`;

    scr.innerHTML = panel('mg-sc-top') + panel('mg-sc-bottom');
    layer.appendChild(scr);

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(autoId);
        scr.remove();
        done();
    };
    // A short floor before the buttons arm: an eager tapper on the winning side
    // must not be able to wipe the screen before the other player has read it.
    const ARM_MS = 700, AUTO_MS = 6000;
    const btns = [...scr.querySelectorAll('.mg-sc-btn')];
    btns.forEach(b => { b.disabled = true; });
    const armId = setTimeout(() => btns.forEach(b => { b.disabled = false; }), ARM_MS);
    btns.forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); finish(); }));
    const autoId = setTimeout(finish, AUTO_MS);
    // A force-end must not leave the screen (or its timers) behind.
    registerMinigameCleanup(() => { clearTimeout(armId); clearTimeout(autoId); scr.remove(); });
}

// ── Arcade teardown: a scoreline, and nothing else ──────────────────────────
//
// Who won this round, and how many rounds each player has won since the arcade
// was opened. No coins move, no match statistics move.
function _finishArcade(winnerId) {
    if (_resolving) return;
    _resolving = true;
    state.mgActive = false;
    _lastPayouts = [0, 0];
    if (winnerId >= 0) _arcadeWins[winnerId]++;
    else _arcadeDraws++;

    const neutral = document.getElementById('mg-neutral');
    if (neutral) {
        neutral.textContent = winnerId < 0
            ? `DRAW — ${_arcadeWins[0]}–${_arcadeWins[1]}`
            : `${state.players[winnerId].name.toUpperCase()} WINS THE ROUND — ${_arcadeWins[0]}–${_arcadeWins[1]}`;
    }
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    const z = [document.getElementById('mg-p1'), document.getElementById('mg-p2')];
    if (winnerId >= 0) {
        z[winnerId]?.classList.add('mg-victory');
        z[1 - winnerId]?.classList.add('mg-defeat');
    }
    setTimeout(() => {
        z.forEach(e => e?.classList.remove('mg-victory', 'mg-defeat'));
        _showScoreboard(winnerId, [0, 0], 'arcade', () => endMinigame(winnerId));
    }, 800);
}

// Called when the arcade is opened from the splash, so a session's tally starts
// at nil rather than carrying over from the last time it was browsed.
export function resetArcadeScores() { _arcadeWins = [0, 0]; _arcadeDraws = 0; }
export function arcadeScores() { return { wins: _arcadeWins.slice(), draws: _arcadeDraws }; }

// Practice teardown: show the result, award nothing, hand control back.
function _finishPractice(winnerId) {
    if (_resolving) return;
    _resolving = true;
    state.mgActive = false;
    const neutral = document.getElementById('mg-neutral');
    if (neutral) neutral.textContent = winnerId < 0
        ? 'PRACTICE — DRAW (nothing at stake)'
        : `PRACTICE — ${state.players[winnerId].name.toUpperCase()} WINS (nothing at stake)`;
    sfx(winnerId < 0 ? 'land_bad' : 'mg_win');
    const z = [document.getElementById('mg-p1'), document.getElementById('mg-p2')];
    if (winnerId >= 0) z[winnerId]?.classList.add('mg-victory');
    setTimeout(() => {
        z.forEach(e => e?.classList.remove('mg-victory', 'mg-defeat'));
        // No scoreboard in practice. The screen exists to show what the round
        // paid out, and practice pays nothing — a card full of coin totals after
        // a round that changed none of them is exactly the confusion it was
        // built to remove. Practice also wants to hand control straight back so
        // you can go again.
        endMinigame(winnerId);
    }, 1100);
}

export function endMinigame(winnerId) {
    clearTimeout(_minigameTimeout);
    _minigameTimeout = null;
    clearInterval(_botTraceInt);
    _botTraceInt = null;
    _runMinigameCleanups();
    state.mgActive = false;
    document.getElementById('minigame-layer').style.display = 'none';

    if (_practiceMode) {
        // Practice never touches coins, turn order or the board.
        const back = _practiceReturn;
        _practiceMode = false; _practiceReturn = null; _standaloneMode = false;
        state.gameState   = 'INIT';
        state.cameraState = 'INIT';
        if (back) back(winnerId);
        else document.getElementById('mg-select-overlay').style.display = 'flex';
        return;
    }

    if (_standaloneMode) {
        _standaloneMode = false;
        state.gameState   = 'INIT';
        state.cameraState = 'INIT';
        if (_onComplete) _onComplete(winnerId);
        return;
    }

    document.getElementById('ui-layer').style.display = 'block';
    state.cameraState = 'FLYOVER';
    state.gameState   = 'MINIGAME_ACK';
    state.lastMinigameWinner = winnerId;
    if (_onComplete) _onComplete(winnerId);
}

export function getBotTraceIntervalRef() { return { set: v => { _botTraceInt = v; }, get: () => _botTraceInt }; }

export function registerMinigameCleanup(fn) {
    if (typeof fn === 'function') _minigameCleanups.push(fn);
}

function _runMinigameCleanups() {
    while (_minigameCleanups.length) {
        try { _minigameCleanups.pop()(); } catch (e) { console.warn('[MinigameManager] cleanup failed:', e); }
    }
}
