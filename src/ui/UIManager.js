// ============================================================
// UI MANAGER — HUD, toasts, space card, map, branch choice, allies
// Reads GameState; never contains game rules.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, ALLIES, SPACE_META, SPACE_DESCS, DISTRICT_BIOMES, HQ_META, CHAR_ICONS,
         getActiveRealms, HBD_FINISH_BONUS, CITY_DEFAULT_ROUNDS,
         hbdSpaceLabel, getRealmForSpace } from '../config/GameConfig.js';
import { COUNTED_TYPES } from '../config/ContractPool.js';
import { SCENE } from '../config/SceneTiming.js';
import * as DualRead from './DualRead.js';
import { getPos, getTileMeshes, setMapCameraTarget, mapCamera, onResize, getCamera,
         clampMapTarget, worldToScreen, focusJunction, clearJunctionFocus } from '../engine/Renderer.js';
import * as ActiveMap from '../config/ActiveMap.js';

// World units panned per pixel of drag on the map view.
const MAP_DRAG_GAIN = 0.055;

let _controller = null;
const _coinTargets = [0, 0];
const _coinCurrent = [0, 0];
let   _coinFrame   = null;

// Path choice overlay — one stored callback handles both branch choice and Cabbie picker
let _pathChoiceCb = null;

// Ally modal callbacks
let _allyEncounterCb = null;
let _allyStealCb     = null;

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

export function init(controller) {
    _controller = controller;
    _initBackground();
    _wireMapEvents();
    _wireSwipeEvents();
    _wireBranchChoiceEvents();
    _wireJunctionEvents();
    _wirePanelEvents();
    _wireAllyModalEvents();
    window.addEventListener('resize', onResize);
}

// ---- HUD ----

export function updateUI() {
    state.players.forEach((p, i) => {
        if (_coinTargets[i] !== p.coins) animateCoinDisplay(i, p.coins);
        document.getElementById(`p${i + 1}-inv`).innerHTML = p.inv
            .map(it => `<div class="inv-slot" title="${ITEMS[it]?.name || it}">${ITEMS[it]?.icon || '?'}</div>`)
            .join('');
        const isActive = i === state.activePlayer;
        document.getElementById(`hud-p${i + 1}`).classList.toggle('active-turn', isActive);
        document.getElementById(`p${i + 1}-actions`).style.display =
            (isActive && state.gameState === 'PRE_ROLL' && !p.isBot) ? 'flex' : 'none';

        // The bag carries its own count. Players were reaching the end of a
        // match holding three unused items because nothing on screen said they
        // had any — the button looked identical full or empty.
        const itemsBtn = document.querySelector(`[data-items="${i}"]`);
        if (itemsBtn) {
            // Only the label span — the button also holds its icon, and
            // rewriting textContent would throw both away.
            const tx = itemsBtn.querySelector('.ba-tx');
            if (tx) tx.textContent = p.inv.length ? `ITEMS ${p.inv.length}` : 'ITEMS';
            itemsBtn.classList.toggle('empty', p.inv.length === 0);
        }

        // Position badge
        let districtLabel;
        if (ActiveMap.isLinear()) {
            // Read the finish from the live layout — a 50- or 75-block run never
            // reaches space 99, so a hardcoded 99 never showed "FINISHED!".
            const finish = state.hbd ? state.hbd.finish : 99;
            districtLabel = typeof p.pos === 'number'
                ? (p.pos >= finish ? 'FINISHED!' : `Space ${p.pos} / ${finish}`)
                : 'Space 0';
        } else {
            const node = ActiveMap.graph()[p.pos];
            const districtKey = node?.district || 'ring';
            const biome = DISTRICT_BIOMES[districtKey];
            districtLabel = biome?.name || ActiveMap.regionName(districtKey) || districtKey;
        }
        document.getElementById(`p${i + 1}-pos-badge`).textContent = districtLabel;

        // Ally HUD slots
        _updateAllySlots(i, p);

        // The map view works on both boards, so the button is always available
        // on your own turn. (It used to be a dead control on HBD.)
        const mapBtn = document.querySelector(`[data-map="${i}"]`);
        if (mapBtn) mapBtn.style.display = '';

        // Bounties are a City Circuit rule, so the button only exists there.
        const bqBtn = document.querySelector(`[data-bounties="${i}"]`);
        if (bqBtn) bqBtn.style.display = ActiveMap.has('bounties') ? '' : 'none';

        // Show Cabbie button if player has Cabbie ally and hasn't used it this round
        const cabbieBtn = document.querySelector(`[data-cabbie="${i}"]`);
        if (cabbieBtn) {
            const hasCabbie = p.allies.some(a => a.type === 'cabbie') && !p.cabbieUsedThisRound;
            cabbieBtn.style.display = (isActive && state.gameState === 'PRE_ROLL' && !p.isBot && hasCabbie) ? '' : 'none';
        }
    });

    updateShieldMarker();

    if (state.gameState === 'PRE_ROLL' || state.gameState === 'ACKNOWLEDGE') {
        updateContracts();
    }
    if (ActiveMap.has('bounties')) {
        updateRoundCounter(state.currentRound, state.cityRounds || CITY_DEFAULT_ROUNDS);
    } else {
        const el = document.getElementById('round-counter');
        // Keep the +finish-bonus goal visible at all times so players know the
        // race to the Crown is worth a big coin boost (even though coins win).
        if (el) el.textContent = (state.totalTurns > 0 ? `TURN ${state.totalTurns}` : 'TURN 1') + `  ·  🏁 Crown +${HBD_FINISH_BONUS}`;
    }

    applyOrientation();
}

// ---- Screen orientation ----
//
// In tabletop mode the device lies flat between two players, so everything the
// ACTIVE player has to read must be rotated to face them. This used to be a
// single line at the bottom of updateUI(), which meant any scene that didn't
// call updateUI() — the gate overlay above all — kept whatever rotation was
// last applied. The gate then presented Player 1's dice roll upside-down.
//
// Call this on entry to every scene that shows text, not just on HUD refresh.
export function applyOrientation() {
    if (state.playStyle !== 'tabletop') {
        document.body.classList.remove('tabletop-p2-turn');
        return;
    }
    document.body.classList.toggle('tabletop-p2-turn', state.activePlayer === 1);
}

// Force the orientation to a specific player — used when a scene belongs to
// someone who isn't `state.activePlayer` yet (the gate reads its player from
// the overlay's dataset, and minigame results belong to the winner).
export function orientTo(playerIdx) {
    if (state.playStyle !== 'tabletop') return;
    document.body.classList.toggle('tabletop-p2-turn', playerIdx === 1);
}

// ---- Shield marker -----------------------------------------------------------
//
// A Shield is bought and used a turn or more before the hit it stops, and
// nothing on screen said you were still carrying an active one: `_shielded` is
// a flag, and the item leaves the bag the instant it is used, so the ITEMS
// count drops and the bag looks empty. Players re-bought shields they already
// had up, and were surprised when a fine did nothing.
//
// Bottom-left corner, out of the way of the action buttons (which live on the
// right half) and the toast rail (centred). It belongs to the ACTIVE player, so
// in tabletop it flips with everything else.
export function updateShieldMarker() {
    const el = document.getElementById('shield-marker');
    if (!el) return;
    const p = state.players[state.activePlayer];
    // It lives outside #ui-layer (like the toast rail), so it has to respect the
    // same hide: a minigame, the gate and the win screen all take the whole
    // screen and hide the HUD, and a badge floating over them is a bug.
    const uiLayer = document.getElementById('ui-layer');
    const hudUp = !!uiLayer && getComputedStyle(uiLayer).display !== 'none';
    // The Bodyguard buddy is the same idea with a charge count, and hiding it
    // here while showing the item would be arbitrary. Item shield first — it is
    // the one with no other readout anywhere.
    const bg = p && p.allies ? p.allies.find(a => a.type === 'bodyguard' && a.shieldCharges > 0) : null;
    const on = hudUp && !!(p && (p._shielded || bg));
    el.style.display = on ? '' : 'none';
    if (!on) return;
    const tx = document.getElementById('shield-marker-tx');
    if (tx) {
        tx.textContent = p._shielded
            ? (bg ? `SHIELD UP · ${bg.shieldCharges} MORE` : 'SHIELD UP')
            : `BODYGUARD · ${bg.shieldCharges}`;
    }
}

function _updateAllySlots(playerIdx, p) {
    const slotsEl = document.getElementById(`p${playerIdx + 1}-ally-slots`);
    if (!slotsEl) return;
    if (!ActiveMap.has('bounties')) { slotsEl.innerHTML = ''; return; }
    const MAX = 2;
    let html = '';
    for (let i = 0; i < MAX; i++) {
        const a = p.allies[i];
        if (a) {
            const info = ALLIES[a.type] || {};
            html += `<div class="ally-slot-badge" title="${info.name || a.type}">${info.icon || '?'}<span class="ally-turns">${a.turnsRemaining}</span></div>`;
        } else {
            html += `<div class="ally-slot-empty"></div>`;
        }
    }
    slotsEl.innerHTML = html;
}

export function setPlayerNames() {
    document.getElementById('hud-name-p1').textContent = `🚗 ${state.players[0].name.toUpperCase()}`;
    document.getElementById('hud-name-p2').innerHTML   =
        `🎩 ${state.players[1].name.toUpperCase()}${state.players[1].isBot ? ' <span class="bot-badge">BOT</span>' : ''}`;
}

// ---- Round Counter ----

// `state.currentRound` counts rounds COMPLETED, not the round being played: it
// starts at 0 and is incremented at the close of each round. Printing it raw
// meant the opening round read "ROUND 0/12" and the final one "ROUND 11/12" —
// the counter was a round behind the game all the way through, and a match
// never showed its own last round as the last one.
//
// The number a player wants is the round they are IN, which is one more, capped
// so the final round reads 12/12 rather than 13/12.
export function displayRound(completed, total) {
    return Math.min((completed || 0) + 1, total || 1);
}

export function updateRoundCounter(current, total) {
    const el = document.getElementById('round-counter');
    const max = total || 20;
    if (el) el.textContent = `ROUND ${displayRound(current, max)}/${max}`;
}

// ---- Contracts Strip ----

export function updateContracts() {
    const strip = document.getElementById('contracts-strip');
    if (!strip) return;
    if (!ActiveMap.has('bounties') || !state.activeContracts || state.activeContracts.length === 0) {
        strip.style.display = 'none';
        return;
    }
    strip.style.display = 'flex';
    // Counted bounties track progress per player; the strip shows the active
    // player's — the full both-player read lives in the 🎯 BOUNTIES panel.
    const pid = state.activePlayer;
    strip.innerHTML = state.activeContracts.map(c => {
        const counted  = COUNTED_TYPES.has(c.type);
        const needed   = counted ? Math.max(1, c.param || 1) : 1;
        const progress = counted ? ((c._prog && c._prog[pid]) || 0) : 0;
        const progStr  = needed > 1 ? ` (${Math.min(progress, needed)}/${needed})` : '';
        const close    = counted && progress >= needed - 1 && needed > 1;
        return `<div class="contract-pill${close ? ' contract-close' : ''}" title="${c.desc}${c.hint ? ' — ' + c.hint : ''}">
            <span class="contract-icon">${c.icon}</span>
            <span class="contract-text">${c.desc}${progStr}</span>
            <span class="contract-reward">+${c.reward}💰</span>
        </div>`;
    }).join('');
    if (state.gameState === 'BOUNTIES') _renderBountyList();
}

// ---- Branch / Path Choice Overlay ----

export function showBranchChoice(options) {
    _pathChoiceCb = null; // use _controller.onBranchChosen
    _renderPathOverlay(options, 'CHOOSE YOUR PATH');
}

export function hideBranchChoice() {
    const overlay = document.getElementById('branch-choice-overlay');
    if (overlay) overlay.style.display = 'none';
}

export function showCabbieJunctionPicker(callback) {
    _pathChoiceCb = callback;
    _renderPathOverlay([
        { nodeId: 'bp_a', label: 'Junction A', desc: 'Financial District entrance', icon: '💹', district: 'fin' },
        { nodeId: 'bp_b', label: 'Junction B', desc: 'Back Alley entrance',         icon: '🏚️', district: 'ba'  },
        { nodeId: 'bp_c', label: 'Junction C', desc: 'Shopping Promenade entrance', icon: '🛍️', district: 'shop'},
        { nodeId: 'bp_d', label: 'Junction D', desc: 'Industrial Zone entrance',    icon: '⚙️', district: 'ind' },
    ], '🚕 CABBIE — TELEPORT TO');
}

function _renderPathOverlay(options, title) {
    const overlay = document.getElementById('branch-choice-overlay');
    if (!overlay) return;
    const titleEl = document.getElementById('branch-title');
    if (titleEl) titleEl.textContent = title;
    const cardsEl = document.getElementById('branch-cards');
    if (cardsEl) {
        cardsEl.innerHTML = options.map(opt => {
            const dist    = opt.district || 'ring';
            const spacesHtml = opt.spaces
                ? `<span class="bc-spaces">${opt.spaces} spaces</span>`
                : '';
            return `<button class="branch-card branch-${dist} bfont" data-node="${opt.nodeId}">
                <span class="bc-icon">${opt.icon || '⬤'}</span>
                <span class="bc-body">
                    <span class="bc-name">${opt.label}</span>
                    <span class="bc-details">${spacesHtml}<span class="bc-desc">${opt.desc}</span></span>
                </span>
                <span class="bc-chev">›</span>
            </button>`;
        }).join('');
    }
    overlay.style.display = 'flex';
}

function _wireBranchChoiceEvents() {
    const overlay = document.getElementById('branch-choice-overlay');
    if (!overlay) return;
    overlay.addEventListener('click', e => {
        const btn = e.target.closest('[data-node]');
        if (!btn) return;
        overlay.style.display = 'none';
        const nodeId = btn.dataset.node;
        if (_pathChoiceCb) {
            const cb = _pathChoiceCb;
            _pathChoiceCb = null;
            cb(nodeId);
        } else {
            _controller.onBranchChosen(nodeId);
        }
    });
}

// ---- Junction arrows -------------------------------------------------------
//
// The old junction was a full-screen card listing two options — which covered
// the board at the exact moment the board's shape is the thing you need to
// look at. The choice now happens ON the map: an arrow sits over each road
// leaving the fork, pointing the way that road actually goes, with the district
// name and its length on it. The camera lifts to put both roads in shot
// (Renderer.focusJunction), and SCOUT THE MAP hands the player the full map
// view and brings them straight back here afterwards.

let _junction = null;   // { junctionId, fromNodeId, options, frame }
let _seenAFork = false; // the primer under the banner shows once per match

export function showJunctionArrows(junctionId, fromNodeId, options, stepsLeft) {
    const layer = document.getElementById('junction-layer');
    const box   = document.getElementById('junction-arrows');
    if (!layer || !box) return;

    _junction = { junctionId, fromNodeId, options, frame: null };

    box.innerHTML = options.map(opt => {
        const locked = /Locked/i.test(opt.desc || '');
        return `<button class="j-arrow j-${opt.district || 'ring'}${locked ? ' j-locked' : ''}" data-node="${opt.nodeId}">
            <span class="j-head">➤</span>
            <span class="j-label">
                <span class="j-name bfont">${opt.short || opt.label}</span>
                <span class="j-meta">${opt.spaces ? `${opt.spaces} spaces` : ''}</span>
                <span class="j-desc">${opt.desc || ''}</span>
            </span>
        </button>`;
    }).join('');

    document.getElementById('junction-banner').textContent =
        `${state.players[state.activePlayer].name.toUpperCase()} — CHOOSE YOUR ROAD`;

    // The first fork of a match can land on turn one: players start on r1, r5
    // feeds bp_b, so a roll of 5 or 6 reaches a junction before anyone has taken
    // an ordinary turn. That is the rule working, but arriving cold — straight
    // out of the briefing into a full-screen decision — is what reads as "the
    // junction scene popped up at the start of the match". Naming it the first
    // time turns a surprise into an instruction.
    const primer = document.getElementById('junction-primer');
    if (primer) {
        const first = !_seenAFork;
        _seenAFork = true;
        primer.style.display = first ? '' : 'none';
    }

    // How far the roll still carries you. A fork is a choice about which run of
    // tiles to spend the REST of the roll on, and that number was nowhere on
    // screen: the player had to remember the die and subtract the steps already
    // walked, at the one moment the game asks them to plan.
    const stepsEl = document.getElementById('junction-steps');
    if (stepsEl) {
        const n = Number(stepsLeft);
        if (Number.isFinite(n) && n > 0) {
            document.getElementById('junction-steps-num').textContent = String(n);
            document.getElementById('junction-steps-cap').textContent =
                n === 1 ? 'SPACE LEFT' : 'SPACES LEFT';
            stepsEl.style.display = '';
        } else {
            stepsEl.style.display = 'none';
        }
    }

    state.cameraState = 'JUNCTION';
    focusJunction(junctionId, fromNodeId);
    layer.style.display = 'block';
    applyOrientation();
    _positionJunctionArrows();
}

export function hideJunctionArrows() {
    const layer = document.getElementById('junction-layer');
    if (layer) layer.style.display = 'none';
    if (_junction && _junction.frame) cancelAnimationFrame(_junction.frame);
    _junction = null;
    clearJunctionFocus();
}

// True while a junction choice is waiting — the map view uses this to know it
// has to come back here instead of returning to the roll screen.
export function junctionPending() { return !!_junction; }

function _positionJunctionArrows() {
    if (!_junction) return;
    _junction.frame = requestAnimationFrame(_positionJunctionArrows);
    const layer = document.getElementById('junction-layer');
    if (!layer || layer.style.display === 'none') return;

    const W = window.innerWidth || 300, H = window.innerHeight || 500;
    const flipped = _boardFlipped();
    const jScreen = worldToScreen(getPos(_junction.junctionId));

    const placed = [];
    _junction.options.forEach(opt => {
        const btn = layer.querySelector(`[data-node="${opt.nodeId}"]`);
        if (!btn) return;
        const pt = worldToScreen(getPos(_anchorNode(opt.nodeId)));
        if (!pt || !jScreen) { btn.style.opacity = '0'; return; }
        btn.style.opacity = '1';

        // The board canvas is turned a half turn for Player 2 in tabletop mode,
        // so a world point projected at (x, y) is actually drawn at (W−x, H−y).
        // These buttons live outside that rotation and have to undo it, or the
        // arrow labelling the Back Alley ends up sitting over the Ring Road.
        const sx = flipped ? W - pt.x : pt.x;
        const sy = flipped ? H - pt.y : pt.y;
        const jx = flipped ? W - jScreen.x : jScreen.x;
        const jy = flipped ? H - jScreen.y : jScreen.y;

        // Point the arrowhead along the road, in screen space.
        const ang = Math.atan2(sy - jy, sx - jx) * 180 / Math.PI;
        btn.querySelector('.j-head').style.transform = `rotate(${ang}deg)`;

        placed.push({
            btn,
            x: Math.max(100, Math.min(sx, W - 100)),
            y: Math.max(100, Math.min(sy, H - 136)),
        });
    });

    // The two roads leave the junction close together and only fan out further
    // along, so anchoring three nodes in is usually enough — but on the two
    // tightest forks the labels still touched. Push overlapping pairs apart
    // along the line between them; the arrowheads still point the right way,
    // which is what actually identifies each road.
    if (placed.length === 2) {
        const [a, b] = placed;
        const MIN = 118;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d < MIN) {
            const ux = d > 0.5 ? dx / d : 1, uy = d > 0.5 ? dy / d : 0;
            const push = (MIN - d) / 2;
            a.x -= ux * push; a.y -= uy * push;
            b.x += ux * push; b.y += uy * push;
        }
    }
    placed.forEach(p => {
        p.btn.style.left = `${Math.max(100, Math.min(p.x, W - 100))}px`;
        p.btn.style.top  = `${Math.max(100, Math.min(p.y, H - 136))}px`;
    });
}

// Where to hang the arrow for a road: a few nodes in, not the very first one.
// Adjacent to the fork the two roads are almost on top of each other; three
// nodes down they have visibly diverged, which is the whole point of the arrow.
function _anchorNode(nodeId) {
    let cur = nodeId;
    for (let i = 0; i < 3; i++) {
        const nxt = ActiveMap.graph()[cur]?.next?.[0];
        if (!nxt || ActiveMap.isJunction(nxt)) break;
        cur = nxt;
    }
    return cur;
}

function _wireJunctionEvents() {
    const layer = document.getElementById('junction-layer');
    if (!layer) return;
    layer.addEventListener('click', e => {
        const btn = e.target.closest('[data-node]');
        if (btn) {
            const nodeId = btn.dataset.node;
            hideJunctionArrows();
            state.cameraState = 'FOLLOW';
            _controller.onBranchChosen(nodeId);
            return;
        }
        if (e.target.closest('#btn-junction-map')) {
            // Keep the choice alive: the map is a look, not an answer.
            layer.style.display = 'none';
            openMap();
        }
    });
}

// ---- Final round ------------------------------------------------------------
//
// The one moment in a City match where every remaining plan changes: nothing
// left to bank for, nothing left to walk to, and whatever you are holding is
// what you finish with. It went by unmarked — the round counter ticked over and
// that was the whole announcement, and it was ticking a round behind anyway.
//
// Both players need it, so it is drawn twice in tabletop. It does not wait for a
// press: it owns the screen for SCENE.FINAL_ROUND and then the turn begins.

export function showFinalRoundBanner(total) {
    const el = document.getElementById('final-round');
    if (!el) return;
    el.innerHTML = DualRead.dualHTML(
        `<div class="fr-tag bfont">ROUND ${total} OF ${total}</div>`
        + `<div class="fr-name bfont">FINAL ROUND</div>`
        + `<div class="fr-sub">Most coins at the end wins the city. Spend what you have.</div>`);
    el.style.display = 'flex';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    applyOrientation();
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, SCENE.FINAL_ROUND);
}

export function hideFinalRoundBanner() {
    const el = document.getElementById('final-round');
    if (!el) return;
    clearTimeout(el._hideTimer);
    el.style.display = 'none';
}

export function finalRoundBannerUp() {
    const el = document.getElementById('final-round');
    return !!el && getComputedStyle(el).display !== 'none';
}

// ---- Roll callout ----------------------------------------------------------
//
// The number you rolled was one line of toast text on the rail, the same weight
// as "+3 coins" and "Passed the Grand Mall". It is not the same weight — it is
// what the whole turn is about — and the token deliberately does not move for
// DICE_READ (1500 ms) after the dice settle. That beat had nothing in it.
//
// It is safe to put this in the middle of the screen, which nothing else that
// fires during a turn is: the rule that keeps notifications off the board is
// about things that appear WHILE the board is moving, and this is gone before
// the token takes its first step.

let _rollOutTimer = null;

export function showRollCallout(n) {
    const el = document.getElementById('roll-callout');
    if (!el) return;
    clearTimeout(_rollOutTimer);
    const num = document.getElementById('rc-num');
    const cap = document.getElementById('rc-cap');
    const pip = document.getElementById('rc-pips');
    if (num) num.textContent = String(n);
    if (cap) cap.textContent = `${(state.players[state.activePlayer]?.name || 'YOU').toUpperCase()} ROLLED`;
    // Pips under the digit, so it reads as a die face rather than a number.
    if (pip) pip.innerHTML = '<i></i>'.repeat(Math.max(0, Math.min(6, n)));
    applyOrientation();
    el.classList.remove('out');
    el.classList.add('up');
}

export function hideRollCallout() {
    const el = document.getElementById('roll-callout');
    if (!el || !el.classList.contains('up')) return;
    el.classList.add('out');
    clearTimeout(_rollOutTimer);
    // Let the shrink-and-fade play out before the element leaves the layout,
    // so the number does not simply vanish on the frame the token sets off.
    _rollOutTimer = setTimeout(() => { el.classList.remove('up', 'out'); }, 220);
}

export function rollCalloutUp() {
    const el = document.getElementById('roll-callout');
    return !!el && el.classList.contains('up') && !el.classList.contains('out');
}

// ---- Buddy report ----------------------------------------------------------
//
// A buddy spawns at the END of a round — which is the same moment the minigame
// takes the whole screen. The announcement was a toast, so it was covered 1.1 s
// later and the player never saw *where* the buddy had landed, and could not go
// and look because the board was gone. That became a card; this is the card
// grown into a per-round report.
//
// The arrival-only version fired on exactly one round per buddy. After that a
// buddy could sit on the board for the rest of a match with nothing on screen
// saying so, and a buddy at your side could expire with no warning at all. Now
// every round says: who is out there, where, how many rounds before they give
// up waiting, and what each player is holding with the clock on it.
//
// Both players are about to race for the same buddy, so it is a SHARED card:
// drawn twice in tabletop, and the hand-off to the minigame waits for a press.

let _allyArrivalCb = null;

export function showBuddyReport(rep, isNew, onDone) {
    const el = document.getElementById('ally-arrival');
    if (!el || !rep) { if (onDone) onDone(); return; }
    _allyArrivalCb = onDone || null;

    const set = (id, txt) => { const n = document.getElementById(id); if (n) n.textContent = txt; };
    const show = (id, on) => { const n = document.getElementById(id); if (n) n.style.display = on ? '' : 'none'; };

    const b = rep.onMap ? ALLIES[rep.onMap.type] : null;
    if (b) {
        set('aa-tag', isNew ? 'A NEW BUDDY IS ON THE BOARD' : 'BUDDY STILL UP FOR GRABS');
        set('aa-icon', b.icon || '🤝');
        set('aa-name', (b.name || 'A BUDDY').toUpperCase());
        set('aa-power', b.desc || '');
        set('aa-where', `Waiting near the ${rep.onMap.where}.`);
        const r = rep.onMap.roundsLeft;
        set('aa-clock', r <= 1 ? 'Leaves at the end of this round — last chance.'
                               : `Leaves in ${r} rounds if nobody claims them.`);
        set('aa-race', 'First one to reach them and win the minigame keeps them.');
        show('aa-icon', true); show('aa-name', true); show('aa-power', true);
        show('aa-where', true); show('aa-clock', true); show('aa-race', true);
    } else {
        // No buddy out there. The card still has a job: the held list, and
        // saying that somebody walked off rather than leaving it a mystery.
        set('aa-tag', 'BUDDY REPORT');
        set('aa-icon', '🤝');
        set('aa-name', rep.departed ? 'BUDDY MOVED ON' : 'NO BUDDY ON THE BOARD');
        set('aa-power', rep.departed ? `${rep.departed} got tired of waiting and left.` : '');
        set('aa-race', 'A new one turns up soon.');
        show('aa-power', !!rep.departed);
        show('aa-where', false); show('aa-clock', false); show('aa-race', true);
    }

    // Who is holding what, and for how much longer. This is the half that was
    // never shown anywhere except a two-character badge in the HUD.
    const heldEl = document.getElementById('aa-held');
    if (heldEl) {
        const rows = rep.held.map(h => {
            if (!h.buddies.length) return '';
            const chips = h.buddies.map(x => {
                const d = ALLIES[x.type] || {};
                const charge = x.charges !== null && x.charges !== undefined ? ` · ${x.charges} blocks` : '';
                return `<span class="aa-chip">${d.icon || '?'} ${d.name || x.type}`
                     + `<b>${x.turnsLeft} turn${x.turnsLeft === 1 ? '' : 's'}${charge}</b></span>`;
            }).join('');
            return `<div class="aa-held-row"><span class="aa-held-who">${h.name}</span>${chips}</div>`;
        }).join('');
        heldEl.innerHTML = rows;
        heldEl.style.display = rows ? '' : 'none';
    }

    el.style.display = 'flex';
    document.body.classList.add('buddy-report');   // moves the toast rail off the card
    DualRead.present(document.getElementById('aa-card'), { tier: 'shared' });
}

function _closeAllyArrival() {
    const el = document.getElementById('ally-arrival');
    DualRead.unmirror(document.getElementById('aa-card'));
    document.body.classList.remove('buddy-report');
    if (el) el.style.display = 'none';
    const cb = _allyArrivalCb; _allyArrivalCb = null;
    if (cb) cb();
}

export function allyArrivalPending() { return !!_allyArrivalCb; }

// ---- Bounty panel ----------------------------------------------------------
//
// The strip along the top can only ever show a truncated line per bounty, and
// on a phone in tabletop mode it is upside down for one of the two players half
// the time. The panel is the full read: what each bounty wants, how to go about
// it, what it pays, and where BOTH players are on the counted ones — a bounty
// is a race, so knowing your rival is one coin space from claiming it is half
// the information.

export function openBounties() {
    const panel = document.getElementById('bounty-panel');
    if (!panel) return;
    _renderBountyList();
    panel.style.display = 'flex';
    state.gameState = 'BOUNTIES';
    applyOrientation();
}

export function closeBounties() {
    const panel = document.getElementById('bounty-panel');
    if (panel) panel.style.display = 'none';
    state.gameState = 'PRE_ROLL';
    updateUI();
}

function _renderBountyList() {
    const list = document.getElementById('bounty-list');
    const sub  = document.getElementById('bounty-sub');
    if (!list) return;
    const cards = state.activeContracts || [];
    if (!ActiveMap.has('bounties') || cards.length === 0) {
        list.innerHTML = `<div class="bounty-empty">No bounties on this board.</div>`;
        if (sub) sub.textContent = 'Bounties are a City Circuit rule.';
        return;
    }
    if (sub) sub.textContent = `${cards.length} live · first player to finish one takes the coins · a new bounty replaces it`;

    list.innerHTML = cards.map(c => {
        const counted = COUNTED_TYPES.has(c.type);
        const need    = Math.max(1, c.param || 1);
        const bars = counted ? state.players.map((p, i) => {
            const got = Math.min((c._prog && c._prog[i]) || 0, need);
            return `<div class="bq-track">
                <span class="bq-who" style="color:${i === 0 ? '#ff6b6b' : '#6ba7ff'}">${p.name}</span>
                <span class="bq-bar"><span class="bq-fill" style="width:${(got / need) * 100}%;background:${i === 0 ? '#ff6b6b' : '#6ba7ff'}"></span></span>
                <span class="bq-num">${got}/${need}</span>
            </div>`;
        }).join('') : '';
        return `<div class="bounty-card">
            <div class="bq-icon">${c.icon}</div>
            <div class="bq-body">
                <div class="bq-desc bfont">${c.desc}</div>
                ${c.hint ? `<div class="bq-hint">${c.hint}</div>` : ''}
                ${bars}
            </div>
            <div class="bq-reward bfont">+${c.reward}<span>💰</span></div>
        </div>`;
    }).join('');
}

// ---- City briefing ---------------------------------------------------------
//
// Shown once, after the opening flyover, before the first roll. City Circuit is
// the only board where the player makes a routing decision, and until now
// nothing told them that before the first junction sprang one on them.

let _briefingOpen = false;
let _briefingDone = null;

export function showCityBriefing(onDone) {
    const el = document.getElementById('city-briefing');
    if (!el || !ActiveMap.has('routeChoice')) { if (onDone) onDone(); return; }
    _briefingOpen = true;
    _briefingDone = onDone || null;

    // One card per road you can actually choose, in lap order, so the briefing
    // reads in the same order the junctions will come at you.
    // The briefing is where a player decides what kind of match they want, so
    // each road gets its own STORY line rather than a mechanical blurb. The
    // taglines live with the district in DISTRICT_BIOMES, next to the colours
    // and the props, so the copy and the place can never drift apart.
    const rows = [
        { icon: DISTRICT_BIOMES.ring.icon, name: DISTRICT_BIOMES.ring.name, spaces: 20,
          desc: DISTRICT_BIOMES.ring.tagline, lore: DISTRICT_BIOMES.ring.lore },
        ...ActiveMap.regionKeys().map(k => {
            const opt = Object.values(ActiveMap.branches()).flat().find(o => o.district === k);
            const b = DISTRICT_BIOMES[k] || {};
            return {
                icon: b.icon || opt?.icon || '⬤',
                name: b.name || ActiveMap.regionName(k) || k,
                spaces: opt?.spaces || 0,
                desc: b.tagline || opt?.desc || '',
                lore: b.lore || '',
                hq: HQ_META[k]?.name,
            };
        }),
    ];
    document.getElementById('cb-paths').innerHTML = rows.map(r => `
        <div class="cb-path">
            <span class="cb-ic">${r.icon}</span>
            <span class="cb-body">
                <span class="cb-name bfont">${r.name}</span>
                <span class="cb-desc">${r.desc}</span>
                ${r.lore ? `<span class="cb-lore">${r.lore}</span>` : ''}
                ${r.hq ? `<span class="cb-hq">🏛️ ${r.hq} at the far end — coins for passing it</span>` : ''}
            </span>
            <span class="cb-len bfont">${r.spaces}</span>
        </div>`).join('');

    el.style.display = 'flex';
    // Both players are about to play this board, so in tabletop mode the card
    // is drawn twice, the top copy turned to face Player 2.
    DualRead.present(document.getElementById('cb-sheet'), { tier: 'shared' });
}

function _closeBriefing() {
    const el = document.getElementById('city-briefing');
    DualRead.unmirror(document.getElementById('cb-sheet'));
    if (el) el.style.display = 'none';
    _briefingOpen = false;
    const done = _briefingDone; _briefingDone = null;
    if (done) done();
}

function _wirePanelEvents() {
    document.getElementById('btn-ally-arrival')?.addEventListener('click', () => _closeAllyArrival());
    document.getElementById('btn-close-bounties')?.addEventListener('click', () => closeBounties());
    document.getElementById('btn-cb-start')?.addEventListener('click', () => _closeBriefing());
    document.getElementById('btn-cb-tour')?.addEventListener('click', () => {
        document.getElementById('city-briefing').style.display = 'none';
        openMap();
    });
}

// ---- Ally Encounter Modal ----

export function showAllyEncounterModal(ally, playerAllies, callback) {
    _allyEncounterCb = callback;
    const modal = document.getElementById('ally-encounter-modal');
    if (!modal) return;
    const slotsLeft = 2 - (playerAllies ? playerAllies.length : 0);
    const iconEl   = document.getElementById('ally-enc-icon');
    const nameEl   = document.getElementById('ally-enc-name');
    const descEl   = document.getElementById('ally-enc-desc');
    const slotsEl  = document.getElementById('ally-enc-slots');
    if (iconEl)  iconEl.textContent  = ally?.icon  || '?';
    if (nameEl)  nameEl.textContent  = ally?.name  || 'Buddy';
    if (descEl)  descEl.textContent  = ally?.desc  || '';
    if (slotsEl) slotsEl.textContent = slotsLeft > 0
        ? `You have ${slotsLeft} Buddy slot${slotsLeft !== 1 ? 's' : ''} free.`
        : 'Your Buddy slots are full — your oldest Buddy will be replaced.';
    document.querySelectorAll('.modal-box').forEach(b => b.style.display = 'none');
    modal.style.display = 'block';
    document.getElementById('modal-overlay').classList.add('act');
}

// ---- Ally Steal Modal ----

export function showAllyStealModal(target, callback) {
    _allyStealCb = callback;
    const modal = document.getElementById('ally-steal-modal');
    if (!modal) return;
    const pnameEl = document.getElementById('ally-steal-pname');
    const listEl  = document.getElementById('ally-steal-list');
    if (pnameEl) pnameEl.textContent = `Choose which of ${target.name}'s Buddies to go after:`;
    if (listEl) {
        listEl.innerHTML = target.allies.map((a, idx) => {
            const info = ALLIES[a.type] || {};
            return `<button class="ally-steal-btn" data-ally-idx="${idx}">
                <span class="ally-steal-icon">${info.icon || '?'}</span>
                <div class="ally-steal-info">
                    <b>${info.name || a.type}</b>
                    <small>${info.desc || ''} &middot; ${a.turnsRemaining} turn${a.turnsRemaining !== 1 ? 's' : ''} left</small>
                </div>
            </button>`;
        }).join('');
    }
    document.querySelectorAll('.modal-box').forEach(b => b.style.display = 'none');
    modal.style.display = 'block';
    document.getElementById('modal-overlay').classList.add('act');
}

function _wireAllyModalEvents() {
    // Ally encounter buttons
    document.getElementById('btn-ally-claim')?.addEventListener('click', () => {
        document.getElementById('modal-overlay').classList.remove('act');
        document.getElementById('ally-encounter-modal').style.display = 'none';
        if (_allyEncounterCb) { const cb = _allyEncounterCb; _allyEncounterCb = null; cb(true); }
    });
    document.getElementById('btn-ally-pass')?.addEventListener('click', () => {
        document.getElementById('modal-overlay').classList.remove('act');
        document.getElementById('ally-encounter-modal').style.display = 'none';
        if (_allyEncounterCb) { const cb = _allyEncounterCb; _allyEncounterCb = null; cb(false); }
    });

    // Ally steal list (event delegation)
    document.getElementById('ally-steal-list')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-ally-idx]');
        if (!btn) return;
        document.getElementById('modal-overlay').classList.remove('act');
        document.getElementById('ally-steal-modal').style.display = 'none';
        const idx = parseInt(btn.dataset.allyIdx);
        if (_allyStealCb) { const cb = _allyStealCb; _allyStealCb = null; cb(idx); }
    });
    document.getElementById('btn-ally-steal-cancel')?.addEventListener('click', () => {
        document.getElementById('modal-overlay').classList.remove('act');
        document.getElementById('ally-steal-modal').style.display = 'none';
        if (_allyStealCb) { const cb = _allyStealCb; _allyStealCb = null; cb(-1); }
    });
}

// ---- Hundred Block Dash: story intro + realm-entry banner ----

let _storyWired = false;
export function showHbdStory(onBegin) {
    const ov = document.getElementById('hbd-story-overlay');
    if (!ov) { onBegin(); return; }
    const realms  = getActiveRealms();
    const realmsHtml = realms.map((r, i) => {
        const edge = '#' + (r.floorEdge ?? 0xffffff).toString(16).padStart(6, '0');
        return `<div class="hbd-story-realm" style="border-left-color:${edge};animation-delay:${0.1 + i * 0.08}s">
            <span class="r-ic">${r.icon}</span>
            <span><span class="r-name">${r.name}</span><br><span class="r-tag">${r.tagline || ''}</span></span>
        </div>`;
    }).join('');
    ov.innerHTML = `
        <div class="hbd-story-crown">👑</div>
        <div class="hbd-story-title bfont">THE CROWN<br>OF A HUNDRED BLOCKS</div>
        <div class="hbd-story-sub">The Crown waits at the end of the road. Dash through ${realms.length} living realms, scooping up every coin you can, and tear through the Rift to reach it.</div>
        <div class="hbd-story-bonus">🏁 First to seize the Crown earns <b>+${HBD_FINISH_BONUS} coins</b> — a huge boost. But the player holding the <b>most coins</b> wins the hustle, so grab loot the whole way down!</div>
        <div class="hbd-story-realms">${realmsHtml}</div>
        <button class="bfont" id="btn-hbd-story-begin">BEGIN THE DASH →</button>`;
    ov.style.display = 'flex';
    const begin = () => { ov.style.display = 'none'; onBegin(); };
    // Re-query the button each show (innerHTML was rebuilt) and wire once.
    document.getElementById('btn-hbd-story-begin').addEventListener('click', begin, { once: true });
    _storyWired = true;
}

// Fills the PRE_MINIGAME beat: says what is about to happen so the gap between
// the turn's payoff and the minigame reads as a scene change, not a stall.
export function announceMinigameIncoming() {
    const el = document.getElementById('realm-banner');
    if (!el) return;
    // Shared beat: both players are about to play. dualHTML draws it twice in
    // tabletop mode, the top copy rotated, so neither has to read it upside down.
    el.innerHTML = DualRead.dualHTML(
        '<div class="rb-ic">⚔️</div><div class="rb-name">MINIGAME NEXT</div>' +
        '<div class="rb-tag">Winner takes the coins — and rolls first</div>');
    el.style.display = 'flex';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, SCENE.PRE_MINIGAME);
}

export function showRealmBanner(realm) {
    const el = document.getElementById('realm-banner');
    if (!el || !realm) return;
    el.innerHTML = DualRead.dualHTML(
        `<div class="rb-ic">${realm.icon}</div><div class="rb-name">${realm.name}</div>`
        + `<div class="rb-tag">${realm.tagline || ''}</div>`
        + (realm.lore ? `<div class="rb-lore">${realm.lore}</div>` : ''));
    el.style.display = 'flex';
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, SCENE.REALM_BANNER);
}

// ---- Turn banner --------------------------------------------------------
//
// Whose turn it is was only ever implied — by which HUD bar lit up, and by
// which side of the screen the action buttons appeared on. Both are easy to
// miss when you have just looked away for a minigame result. This says it out
// loud on every hand-over.
//
// Two copies, one at each edge, because it matters to BOTH players: the one
// taking the turn needs to know they are up, and the one who just finished
// needs to know they are done. The top copy is turned in tabletop so it faces
// Player 2. It never takes pointer events — a roll must never land on it.

let _lastAnnouncedTurn = -1;

export function showTurnBanner(playerIdx, opts = {}) {
    const el = document.getElementById('turn-banner');
    if (!el) return;
    const p = state.players[playerIdx];
    if (!p) return;

    const icon = CHAR_ICONS[p.charType] || (playerIdx === 0 ? '🚗' : '🎩');
    const col  = playerIdx === 0 ? '#ff6b6b' : '#6ba7ff';
    const sub  = opts.sub || (p.isBot ? 'thinking…' : 'your move');

    el.querySelectorAll('.tb-card').forEach(card => {
        const mine = Number(card.dataset.tb) === playerIdx;
        card.innerHTML =
            `<span class="tb-ic">${icon}</span>` +
            `<span class="tb-txt"><span class="tb-name bfont">${p.name.toUpperCase()}</span>` +
            `<span class="tb-sub">${mine ? sub : 'their turn'}</span></span>`;
        card.style.setProperty('--tb-col', col);
        card.classList.toggle('tb-active', mine);
    });

    el.style.display = 'block';
    // Restart the animation even if the banner is already up.
    el.classList.remove('tb-show'); void el.offsetWidth; el.classList.add('tb-show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
        el.classList.remove('tb-show');
        el.style.display = 'none';
    }, SCENE.TURN_BANNER || 1700);
}

export function hideTurnBanner() {
    const el = document.getElementById('turn-banner');
    if (!el) return;
    clearTimeout(el._hideTimer);
    el.classList.remove('tb-show');
    el.style.display = 'none';
}

// Announce only when the turn actually changed hands. A BOOST re-roll, or the
// gate handing a player their roll back, is the same player continuing — saying
// "PLAYER 1" again there is noise, not information.
export function announceTurnIfChanged(playerIdx) {
    if (playerIdx === _lastAnnouncedTurn) return false;
    _lastAnnouncedTurn = playerIdx;
    showTurnBanner(playerIdx);
    return true;
}

// A new match has not seen a fork yet, so the primer is due again.
export function resetForkPrimer() { _seenAFork = false; }

export function resetTurnAnnouncer() { _lastAnnouncedTurn = -1; }

// ---- Toasts ----

// Toasts had two problems, and between them they made the board unwatchable
// while anything was happening on it:
//
//   1. `#toast-box` sat at top:50%, left:50% — dead centre of the screen, which
//      is exactly where the token, the dice and the tile you are moving toward
//      all are. Up to five of them could stack there at once.
//   2. Nothing stopped one appearing mid-move. Passing an HQ, claiming a bounty
//      and gaining an ally all fire DURING the walk, so the board disappeared
//      behind a black pill at the precise moment the player was trying to watch
//      it.
//
// The box is now a rail on the active player's own edge, clear of the middle of
// the screen (see the CSS), and anything that is not urgent WAITS while the
// board is animating. Nothing is lost — the queue is flushed the moment the
// token lands, which is when the player is looking for it anyway.

const _toastQueue = [];
const TOAST_MAX_QUEUE = 6;

// States in which the board itself is the thing to look at.
function _boardIsBusy() {
    return state.gameState === 'MOVING' || state.gameState === 'ROLLING';
}

export function toast(msg, color, opts = {}) {
    // `urgent` is for things the player must see AS they happen rather than
    // after — currently only the shield absorbing a hit, which explains why a
    // fine cost them nothing.
    if (!opts.urgent && _boardIsBusy()) {
        _toastQueue.push({ msg, color });
        while (_toastQueue.length > TOAST_MAX_QUEUE) _toastQueue.shift();
        return;
    }
    _emitToast(msg, color);
}

function _emitToast(msg, color) {
    const box = document.getElementById('toast-box');
    if (!box) return;
    // Two at a time. Five stacked pills is not a notification, it is a wall.
    while (box.children.length >= 2) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    el.style.color = color || '#fff';
    el.style.borderColor = color || 'rgba(255,255,255,0.4)';
    box.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, SCENE.TOAST);
}

// Release anything that was held back while the board was moving. Called when
// the token lands and again at the top of every turn, so a queued line can
// never be stranded by a scene that took an unusual exit.
export function flushToasts() {
    if (!_toastQueue.length) return;
    const batch = _toastQueue.splice(0, _toastQueue.length);
    batch.forEach((t, i) => setTimeout(() => _emitToast(t.msg, t.color), i * 220));
}

export function pendingToastCount() { return _toastQueue.length; }
export function clearToastQueue() { _toastQueue.length = 0; }

// ---- Space info card ----

export function showSpaceInfoCard(typeName, desc) {
    const card = document.getElementById('space-info-card');
    document.getElementById('sic-type').textContent = typeName;
    document.getElementById('sic-desc').textContent  = desc;
    card.style.display = 'flex';
    clearTimeout(card._hideTimer);
    card._hideTimer = setTimeout(() => { card.style.display = 'none'; }, SCENE.SPACE_CARD);
}

export function hideSpaceInfoCard() { document.getElementById('space-info-card').style.display = 'none'; }

// ---- Map ----

// True when the running board is the linear Hundred Block Dash track.
function _isHBD() { return ActiveMap.isLinear(); }

// Highest slider index for the running board.
function _mapMaxIndex() {
    return _isHBD() ? ((state.hbd ? state.hbd.finish : 99)) : (ActiveMap.ordered().length - 1);
}

// Slider index → the address the renderer and board use (number on HBD,
// node-id string on City Circuit).
function _mapAddress(idx) {
    return _isHBD() ? idx : ActiveMap.ordered()[idx];
}

// Where the active player currently sits, as a slider index.
function _playerMapIndex() {
    const pos = state.players[state.activePlayer].pos;
    if (_isHBD()) return typeof pos === 'number' ? pos : 0;
    const i = ActiveMap.ordered().indexOf(pos);
    return i >= 0 ? i : 0;
}

export function openMap() {
    state.gameState  = 'MAP';
    state.cameraState = 'MAP';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('map-ui').style.display   = 'flex';

    const posIdx = _playerMapIndex();
    const slider = document.getElementById('map-slider');
    slider.max   = _mapMaxIndex();
    slider.value = posIdx;

    // Track ends are labelled for the board you're actually on.
    const labels = document.querySelector('.map-labels');
    if (labels) {
        labels.innerHTML = _isHBD()
            ? '<span>START</span><span>REALMS</span><span>👑 CROWN</span>'
            : '<span>START</span><span>DISTRICTS</span><span>LOOP</span>';
    }
    const title = document.querySelector('.map-title');
    if (title) title.textContent = _isHBD() ? '🗺️ THE ROAD' : '🗺️ CITY MAP';
    const hint = document.getElementById('map-drag-hint');
    if (hint) hint.textContent = _isHBD()
        ? '👆 Drag to scout the road ahead · Tap a block for details'
        : '👆 Drag the 3D board to explore · Tap a tile for details';

    document.getElementById('map-tooltip').style.display = 'none';
    setMapCameraTarget(_mapAddress(posIdx), _isHBD() ? 34 : 50, _isHBD() ? 26 : 20);
    updateMapSlider();
}

export function closeMap() {
    mapCamera.dragging = false;
    document.getElementById('map-ui').style.display    = 'none';
    document.getElementById('map-tooltip').style.display = 'none';

    // The map can be opened FROM a junction choice, and from the opening
    // briefing. Neither of those is the roll screen, so closing the map has to
    // return to whatever asked for it rather than assuming it was a scout
    // between rolls — which used to drop the player straight into PRE_ROLL with
    // an unanswered junction still pending behind it.
    if (_junction) {
        document.getElementById('junction-layer').style.display = 'block';
        state.gameState   = 'MOVING';
        state.cameraState = 'JUNCTION';
        applyOrientation();
        return;
    }
    if (_briefingOpen) {
        document.getElementById('city-briefing').style.display = 'flex';
        state.gameState   = 'INIT';
        state.cameraState = 'INIT';
        return;
    }

    document.getElementById('ui-layer').style.display  = 'block';
    state.gameState  = 'PRE_ROLL';
    state.cameraState = 'FOLLOW';
    updateUI();
}

export function updateMapSlider() {
    const val = parseInt(document.getElementById('map-slider').value);
    setMapCameraTarget(_mapAddress(val), _isHBD() ? 30 : 40, _isHBD() ? 22 : 25);
    document.getElementById('map-tooltip').style.display = 'none';

    let label;
    if (_isHBD()) {
        const realm  = getRealmForSpace(val);
        const finish = state.hbd ? state.hbd.finish : 99;
        const you    = _playerMapIndex();
        const ahead  = val - you;
        const rel    = ahead === 0 ? 'you are here'
                     : ahead > 0   ? `${ahead} ahead`
                                   : `${-ahead} behind`;
        label = `${realm.icon} ${realm.name} · Block ${val}/${finish} · ${rel}`;
    } else {
        const node = ActiveMap.graph()[ActiveMap.ordered()[val]];
        label = node ? (DISTRICT_BIOMES[node.district]?.name || ActiveMap.regionName(node.district) || node.district) : '—';
    }
    document.getElementById('map-counter').textContent = label;
}

// What this space does to you, in one line. Prefers the realm-flavoured blurb on
// HBD and falls back to the generic one; owned traps name their owner, because
// whose Tollbooth it is changes whether you care.
function _spaceEffectText(addr, type) {
    const tile = state.board[addr];
    if (typeof addr === 'number') {
        const lbl = hbdSpaceLabel(addr, type);
        if (lbl && lbl.desc) return lbl.desc;
    }
    let txt = SPACE_DESCS[type] || '';
    if ((type === 'player_trap' || type === 'anchor_trap') && tile && tile.owner !== undefined) {
        const owner = state.players[tile.owner];
        if (owner) txt = `${owner.name}'s. ${txt}`;
    }
    return txt;
}

// How many spaces ahead of (or behind) the ACTIVE player this space is, and
// whether a single roll can reach it. On City Circuit the count follows the
// canonical lap order, which is the order you actually travel.
function _distanceText(addr) {
    const you = _playerMapIndex();
    let idx;
    if (typeof addr === 'number') idx = addr;
    else {
        idx = ActiveMap.ordered().indexOf(addr);
        if (idx < 0) return '';
    }
    let ahead = idx - you;
    // The City board loops, so "12 behind" on a 60-node ring is really 48 ahead.
    if (!_isHBD() && ahead < 0) ahead += ActiveMap.ordered().length;

    if (ahead === 0) return '📍 You are standing here';
    if (ahead < 0)   return `↩︎ ${-ahead} space${-ahead === 1 ? '' : 's'} behind you`;
    const reach = ahead <= 6 ? `  ·  reachable with a ${ahead}` : '';
    return `➜ ${ahead} space${ahead === 1 ? '' : 's'} ahead${reach}`;
}

// In tabletop mode on Player 2's turn the board canvas is turned a half turn by
// CSS (`.tabletop-p2-turn #game-container canvas`) so P2 sees the board the right
// way up from their end. The canvas pixels move; the pointer coordinates do not.
// Anything that converts a screen position into a position ON the board has to
// undo that rotation, or it works on the mirror image — which is why P2's drag
// went the wrong way and tapping a tile either selected the wrong one or nothing.
function _boardFlipped() {
    return document.body.classList.contains('tabletop-p2-turn');
}

function _wireMapEvents() {
    const slider = document.getElementById('map-slider');
    slider.addEventListener('input', updateMapSlider);

    document.getElementById('btn-close-map').addEventListener('click', () => closeMap());

    window.addEventListener('pointerdown', e => {
        if (state.gameState !== 'MAP') return;
        // e.target is only guaranteed to be an Element for real input; guard so a
        // synthetic event (or one retargeted to the document) can't throw here.
        if (e.target && e.target.closest && e.target.closest('#map-ui')) return;
        mapCamera.dragging   = true;
        mapCamera.dragStart  = { x: e.clientX, y: e.clientY };
        mapCamera.dragCamStart.copy(mapCamera.targetPos);
        mapCamera.dragLookStart.copy(mapCamera.targetLook);
    }, { passive: false });

    window.addEventListener('pointermove', e => {
        if (!mapCamera.dragging || state.gameState !== 'MAP') return;
        // Drag the board the way the finger moves, in the direction the player
        // is actually looking at it from.
        const f  = _boardFlipped() ? -1 : 1;
        const dx = (e.clientX - mapCamera.dragStart.x) * f;
        const dy = (e.clientY - mapCamera.dragStart.y) * f;
        // 0.10 world units per pixel meant a single thumb swipe on a phone threw
        // the view most of the way across a 116-unit board. MAP_DRAG_GAIN keeps
        // a swipe to about a district, and clampMapTarget stops the board being
        // flung off screen entirely.
        mapCamera.targetPos.copy(mapCamera.dragCamStart).add(new THREE.Vector3(-dx * MAP_DRAG_GAIN, 0, -dy * MAP_DRAG_GAIN));
        mapCamera.targetLook.copy(mapCamera.dragLookStart).add(new THREE.Vector3(-dx * MAP_DRAG_GAIN, 0, -dy * MAP_DRAG_GAIN));
        clampMapTarget();
    }, { passive: false });

    window.addEventListener('pointerup', e => {
        if (state.gameState !== 'MAP') return;
        const dx = e.clientX - mapCamera.dragStart.x;
        const dy = e.clientY - mapCamera.dragStart.y;
        const wasTap = Math.abs(dx) < 8 && Math.abs(dy) < 8;
        mapCamera.dragging = false;
        if (!wasTap) return;

        const W = window.innerWidth || 300, H = window.innerHeight || 500;
        // Undo the canvas's half turn before casting, or P2 picks the tile
        // diagonally opposite the one they touched.
        const flipped = _boardFlipped();
        const px = flipped ? W - e.clientX : e.clientX;
        const py = flipped ? H - e.clientY : e.clientY;
        mouse.x = (px / W) * 2 - 1;
        mouse.y = -(py / H) * 2 + 1;
        raycaster.setFromCamera(mouse, getCamera());
        const hits = raycaster.intersectObjects(getTileMeshes());
        const tt   = document.getElementById('map-tooltip');
        if (hits.length > 0) {
            const td = hits[0].object.userData;
            // HBD tiles carry a numeric `idx`; City tiles carry a `nodeId`.
            const addr = td.nodeId !== undefined ? td.nodeId : td.idx;
            if (addr === undefined) { tt.style.display = 'none'; return; }
            const tile = state.board[addr];
            const node = typeof addr === 'string' ? ActiveMap.graph()[addr] : null;
            const type = tile?.type || node?.type || 'coin';
            const meta = SPACE_META[type] || { ic: '❓', n: type, c: 0xffffff };
            const cStr = meta.c.toString(16).padStart(6, '0');
            let title, sub;
            if (typeof addr === 'number') {
                // Realm-flavoured name and the block number, so scouting ahead
                // tells you something the board itself doesn't.
                const lbl = hbdSpaceLabel(addr, type);
                const realm = getRealmForSpace(addr);
                title = `${lbl.icon} ${lbl.name}`;
                sub   = `${realm.icon} ${realm.name} · Block ${addr}`;
            } else {
                title = `${meta.ic} ${meta.n}`;
                sub   = node ? (DISTRICT_BIOMES[node.district]?.name || ActiveMap.regionName(node.district) || '') : '';
            }
            // What the space actually DOES, and how far away it is. Scouting the
            // road was previously a name and a block number — you could see that
            // block 31 was "The Ember Toll" without any way to know it costs you
            // four coins, or that it is exactly one 6 away.
            const effect = _spaceEffectText(addr, type);
            const dist   = _distanceText(addr);
            // While a buddy is standing beside a tile, that tile IS the buddy
            // space — the one square on the board worth routing towards — so
            // scouting has to say so, not just report whatever it normally is.
            const buddyHere = state.allyOnMap && state.allyOnMap.nodeId === addr
                ? ALLIES[state.allyOnMap.allyType] : null;
            tt.innerHTML =
                (buddyHere ? `<span class="map-buddy">🤝 BUDDY SPACE · ${buddyHere.name}</span><br>` : '') +
                `<span style="color:#${cStr}">${title}</span>` +
                `<br><span class="map-dist">${sub}</span>` +
                (effect ? `<br><span class="map-effect">${effect}</span>` : '') +
                (dist ? `<br><span class="map-range">${dist}</span>` : '');
            // The card is taller now that it carries an effect line, so keep it
            // clear of both edges rather than only the bottom. The control panel
            // sits at whichever edge belongs to the player whose turn it is, so
            // the bigger margin swaps ends with it.
            const nearPad = flipped ? 90 : 170, farPad = flipped ? 170 : 90;
            tt.style.left = Math.min(Math.max(e.clientX, 140), W - 140) + 'px';
            tt.style.top  = Math.min(Math.max(e.clientY, nearPad), H - farPad) + 'px';
            tt.style.display = 'block';
            clearTimeout(tt._hideTimer);
            tt._hideTimer = setTimeout(() => { tt.style.display = 'none'; }, 3000);
        } else {
            tt.style.display = 'none';
        }
    });
}

// ---- Swipe zone ----

function _wireSwipeEvents() {
    const zone = document.getElementById('swipe-zone');
    let sy = 0, st = 0;
    zone.addEventListener('touchstart', e => { sy = e.touches[0].clientY; st = Date.now(); });
    zone.addEventListener('touchend', e => {
        if (state.gameState !== 'PRE_ROLL' || state.players[state.activePlayer].isBot) return;
        const rawDy = sy - e.changedTouches[0].clientY;
        const dt    = Math.max(Date.now() - st, 16);
        // In tabletop mode P2 swipes downward from their perspective (upward in screen coords
        // for P1, downward for P2). Accept either direction so both players can flick.
        const dy  = state.playStyle === 'tabletop' ? Math.abs(rawDy) : rawDy;
        const vel = dy / dt;
        if (dy > 20 && vel > 0.2) _controller.executeRoll(Math.min(vel, 3.5));
    });
    zone.addEventListener('mousedown', e => { sy = e.clientY; st = Date.now(); });
    zone.addEventListener('mouseup', e => {
        if (state.gameState !== 'PRE_ROLL' || state.players[state.activePlayer].isBot) return;
        const rawDy = sy - e.clientY;
        const dt    = Math.max(Date.now() - st, 16);
        const dy    = state.playStyle === 'tabletop' ? Math.abs(rawDy) : rawDy;
        const vel   = dy / dt;
        if (dy > 20 && vel > 0.2) _controller.executeRoll(Math.min(vel, 3.5));
    });
}

export function showSwipeZone()  { document.getElementById('swipe-zone').classList.add('act'); }
export function hideSwipeZone()  { document.getElementById('swipe-zone').classList.remove('act'); }
export function hideActionRows() {
    document.getElementById('p1-actions').style.display = 'none';
    document.getElementById('p2-actions').style.display = 'none';
}

// ---- Coin animation ----

export function initCoinDisplays() {
    state.players.forEach((p, i) => { _coinTargets[i] = p.coins; _coinCurrent[i] = p.coins; });
}

export function animateCoinDisplay(pid, target) {
    const gained = target - _coinTargets[pid];
    if (gained > 0) _spawnCoinParticles(pid, gained);
    _coinTargets[pid] = target;
    if (!_coinFrame) _coinFrame = requestAnimationFrame(_tickCoin);
}

function _spawnCoinParticles(pid, gained) {
    const el = document.getElementById(`p${pid + 1}-coins`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const count = gained >= 8 ? 7 : gained >= 3 ? 5 : 3;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'coin-particle';
        p.textContent = '🪙';
        const tx = (Math.random() - 0.5) * 72;
        const ty = -28 - Math.random() * 52;
        p.style.cssText = `left:${rect.left + rect.width * 0.5}px;top:${rect.top + rect.height * 0.5}px;--tx:${tx.toFixed(1)}px;--ty:${ty.toFixed(1)}px;animation-delay:${i * 58}ms;`;
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 900 + i * 60);
    }
}

function _tickCoin() {
    _coinFrame = null;
    let going = false;
    state.players.forEach((p, i) => {
        const cur = _coinCurrent[i], tgt = _coinTargets[i];
        if (cur === tgt) return;
        const diff = tgt - cur;
        const step = Math.sign(diff) * Math.max(1, Math.round(Math.abs(diff) * 0.2));
        const next = Math.abs(diff) <= Math.abs(step) ? tgt : cur + step;
        _coinCurrent[i] = next;
        const el = document.getElementById(`p${i + 1}-coins`);
        if (el) { el.textContent = next; el.classList.remove('coin-changed'); void el.offsetWidth; el.classList.add('coin-changed'); }
        if (next !== tgt) going = true;
    });
    if (going) _coinFrame = requestAnimationFrame(_tickCoin);
}

// ---- Starfield background canvas ----

function _initBackground() {
    const bgc = document.getElementById('bg-canvas');
    const bx  = bgc.getContext('2d');
    let W, H;
    const resize = () => { W = bgc.width = window.innerWidth || 300; H = bgc.height = window.innerHeight || 500; };
    resize(); window.addEventListener('resize', resize);
    const stars = Array.from({ length: 60 }, () => ({
        x: Math.random(), y: Math.random(), r: 0.5 + Math.random(),
        base: 0.15 + Math.random() * 0.5, phase: Math.random() * 6,
        speed: 0.007 + Math.random() * 0.006,
    }));
    let frame = 0;
    (function draw() {
        requestAnimationFrame(draw); frame++;
        bx.clearRect(0, 0, W, H);
        stars.forEach(s => {
            bx.fillStyle = `rgba(255,255,255,${s.base + Math.sin(frame * s.speed + s.phase) * 0.2})`;
            bx.beginPath(); bx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); bx.fill();
        });
    })();
}
