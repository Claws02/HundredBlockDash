// ============================================================
// UI MANAGER — HUD, toasts, space card, map, branch choice, allies
// Reads GameState; never contains game rules.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, ALLIES, SPACE_META, SPACE_DESCS, DISTRICT_BIOMES, HQ_META } from '../config/GameConfig.js';
import { CITY_GRAPH, ALL_NODES_ORDERED, BRANCH_OPTIONS, JUNCTION_IDS, DISTRICT_NAMES } from '../config/BoardGraph.js';
import { getPos, getTileMeshes, setMapCameraTarget, setHBDOverviewCamera, mapCamera, onResize, getCamera } from '../engine/Renderer.js';

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

        // Position badge
        let districtLabel;
        if (state.selectedMap === 'hundred_block_dash') {
            districtLabel = typeof p.pos === 'number'
                ? (p.pos >= 99 ? 'FINISHED!' : `Space ${p.pos}`)
                : 'Space 0';
        } else {
            const node = CITY_GRAPH[p.pos];
            const districtKey = node?.district || 'ring';
            const biome = DISTRICT_BIOMES[districtKey];
            districtLabel = biome?.name || DISTRICT_NAMES[districtKey] || districtKey;
        }
        document.getElementById(`p${i + 1}-pos-badge`).textContent = districtLabel;

        // Ally HUD slots
        _updateAllySlots(i, p);

        // Show Cabbie button if player has Cabbie ally and hasn't used it this round
        const cabbieBtn = document.querySelector(`[data-cabbie="${i}"]`);
        if (cabbieBtn) {
            const hasCabbie = p.allies.some(a => a.type === 'cabbie') && !p.cabbieUsedThisRound;
            cabbieBtn.style.display = (isActive && state.gameState === 'PRE_ROLL' && !p.isBot && hasCabbie) ? '' : 'none';
        }
    });

    if (state.gameState === 'PRE_ROLL' || state.gameState === 'ACKNOWLEDGE') {
        updateContracts();
    }
    if (state.selectedMap !== 'hundred_block_dash') {
        updateRoundCounter(state.currentRound, 20);
    } else {
        const el = document.getElementById('round-counter');
        if (el) el.textContent = state.totalTurns > 0 ? `TURN ${state.totalTurns}` : '';
    }

    if (state.playStyle === 'tabletop') {
        document.body.classList.toggle('tabletop-p2-turn', state.activePlayer === 1);
    }
}

function _updateAllySlots(playerIdx, p) {
    const slotsEl = document.getElementById(`p${playerIdx + 1}-ally-slots`);
    if (!slotsEl) return;
    if (state.selectedMap === 'hundred_block_dash') { slotsEl.innerHTML = ''; return; }
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

export function updateRoundCounter(current, total) {
    const el = document.getElementById('round-counter');
    if (el) el.textContent = `ROUND ${current || 0}/${total || 20}`;
}

// ---- Contracts Strip ----

export function updateContracts() {
    const strip = document.getElementById('contracts-strip');
    if (!strip) return;
    if (state.selectedMap === 'hundred_block_dash' || !state.activeContracts || state.activeContracts.length === 0) {
        strip.style.display = 'none';
        return;
    }
    strip.style.display = 'flex';
    strip.innerHTML = state.activeContracts.map(c => {
        const progress = c._progress || 0;
        const needed   = (c.type === 'land_coin' || c.type === 'land_coin_big' || c.type === 'win_minigames' || c.type === 'visit_shops') ? (c.param || 1) : 1;
        const progStr  = needed > 1 ? ` (${progress}/${needed})` : '';
        return `<div class="contract-pill" title="${c.desc}">
            <span class="contract-icon">${c.icon}</span>
            <span class="contract-text">${c.desc}${progStr}</span>
            <span class="contract-reward">+${c.reward}💰</span>
        </div>`;
    }).join('');
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
    if (nameEl)  nameEl.textContent  = ally?.name  || 'Ally';
    if (descEl)  descEl.textContent  = ally?.desc  || '';
    if (slotsEl) slotsEl.textContent = slotsLeft > 0
        ? `You have ${slotsLeft} ally slot${slotsLeft !== 1 ? 's' : ''} available.`
        : 'Your ally slots are full — an old ally will be replaced.';
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
    if (pnameEl) pnameEl.textContent = `Choose which of ${target.name}'s allies to target:`;
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

// ---- Toasts ----

export function toast(msg, color) {
    const box = document.getElementById('toast-box');
    while (box.children.length >= 5) box.removeChild(box.firstChild);
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    el.style.color = color || '#fff';
    el.style.borderColor = color || 'rgba(255,255,255,0.4)';
    box.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
}

// ---- Space info card ----

export function showSpaceInfoCard(typeName, desc) {
    const card = document.getElementById('space-info-card');
    document.getElementById('sic-type').textContent = typeName;
    document.getElementById('sic-desc').textContent  = desc;
    card.style.display = 'flex';
    clearTimeout(card._hideTimer);
    card._hideTimer = setTimeout(() => { card.style.display = 'none'; }, 3500);
}

export function hideSpaceInfoCard() { document.getElementById('space-info-card').style.display = 'none'; }

// ---- Map ----

export function openMap() {
    if (state.selectedMap === 'hundred_block_dash') {
        _openHBDMap();
        return;
    }
    state.gameState  = 'MAP';
    state.cameraState = 'MAP';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('map-ui').style.display   = 'flex';

    document.querySelector('#map-ui .map-title').textContent = '🗺️ CITY MAP';
    document.getElementById('map-drag-hint').textContent = '👆 Drag the 3D board to explore · Tap a tile for details';
    document.querySelector('.map-labels').innerHTML = '<span>START</span><span>DISTRICTS</span><span>LOOP</span>';

    const playerPos = state.players[state.activePlayer].pos;
    const posIdx    = ALL_NODES_ORDERED.indexOf(playerPos);
    const slider    = document.getElementById('map-slider');
    slider.max      = ALL_NODES_ORDERED.length - 1;
    slider.value    = posIdx >= 0 ? posIdx : 0;
    document.getElementById('map-tooltip').style.display = 'none';
    setMapCameraTarget(posIdx >= 0 ? posIdx : 0, 50, 20);
    updateMapSlider();
}

function _openHBDMap() {
    state.gameState   = 'MAP';
    state.cameraState = 'MAP';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('map-ui').style.display   = 'flex';

    document.querySelector('#map-ui .map-title').textContent = '🗺️ BOARD MAP';
    document.getElementById('map-drag-hint').textContent = '👆 Drag to explore · Tap a space for details';
    document.querySelector('.map-labels').innerHTML = '<span>START</span><span>MIDWAY</span><span>FINISH</span>';

    const playerPos = typeof state.players[state.activePlayer].pos === 'number'
        ? state.players[state.activePlayer].pos : 0;
    const slider = document.getElementById('map-slider');
    slider.max   = 99;
    slider.value = playerPos;
    document.getElementById('map-tooltip').style.display = 'none';

    setHBDOverviewCamera();
    _updateHBDMapCounter(playerPos);
}

function _updateHBDMapCounter(idx) {
    const space = Array.isArray(state.board) ? state.board[idx] : null;
    const type  = space?.type || 'coin';
    const meta  = SPACE_META[type] || { ic: '❓', n: type };
    document.getElementById('map-counter').textContent = `Space ${idx}: ${meta.ic} ${meta.n}`;
}

export function closeMap() {
    mapCamera.dragging = false;
    document.getElementById('map-ui').style.display    = 'none';
    document.getElementById('map-tooltip').style.display = 'none';
    document.getElementById('ui-layer').style.display  = 'block';
    state.gameState  = 'PRE_ROLL';
    state.cameraState = 'FOLLOW';
    updateUI();
}

export function updateMapSlider() {
    const val = parseInt(document.getElementById('map-slider').value);
    document.getElementById('map-tooltip').style.display = 'none';
    if (state.selectedMap === 'hundred_block_dash') {
        setMapCameraTarget(val, 40, 20);
        _updateHBDMapCounter(val);
        return;
    }
    setMapCameraTarget(val, 40, 25);
    const nodeId = ALL_NODES_ORDERED[val];
    const node   = nodeId ? CITY_GRAPH[nodeId] : null;
    const label  = node ? (DISTRICT_BIOMES[node.district]?.name || DISTRICT_NAMES[node.district] || node.district) : '—';
    document.getElementById('map-counter').textContent = label;
}

function _wireMapEvents() {
    const slider = document.getElementById('map-slider');
    slider.addEventListener('input', updateMapSlider);

    document.getElementById('btn-close-map').addEventListener('click', () => closeMap());

    window.addEventListener('pointerdown', e => {
        if (state.gameState !== 'MAP') return;
        if (e.target.closest('#map-ui')) return;
        mapCamera.dragging   = true;
        mapCamera.dragStart  = { x: e.clientX, y: e.clientY };
        mapCamera.dragCamStart.copy(mapCamera.targetPos);
        mapCamera.dragLookStart.copy(mapCamera.targetLook);
    }, { passive: false });

    window.addEventListener('pointermove', e => {
        if (!mapCamera.dragging || state.gameState !== 'MAP') return;
        const dx = e.clientX - mapCamera.dragStart.x;
        const dy = e.clientY - mapCamera.dragStart.y;
        mapCamera.targetPos.copy(mapCamera.dragCamStart).add(new THREE.Vector3(-dx * 0.10, 0, -dy * 0.10));
        mapCamera.targetLook.copy(mapCamera.dragLookStart).add(new THREE.Vector3(-dx * 0.10, 0, -dy * 0.10));
    }, { passive: false });

    window.addEventListener('pointerup', e => {
        if (state.gameState !== 'MAP') return;
        const dx = e.clientX - mapCamera.dragStart.x;
        const dy = e.clientY - mapCamera.dragStart.y;
        const wasTap = Math.abs(dx) < 8 && Math.abs(dy) < 8;
        mapCamera.dragging = false;
        if (!wasTap) return;

        const W = window.innerWidth || 300, H = window.innerHeight || 500;
        mouse.x = (e.clientX / W) * 2 - 1;
        mouse.y = -(e.clientY / H) * 2 + 1;
        raycaster.setFromCamera(mouse, getCamera());
        const hits = raycaster.intersectObjects(getTileMeshes(), true);
        const tt   = document.getElementById('map-tooltip');
        if (hits.length > 0) {
            const td = hits[0].object.userData;

            if (state.selectedMap === 'hundred_block_dash') {
                const idx = td.idx;
                if (idx === undefined) { tt.style.display = 'none'; return; }
                const space  = Array.isArray(state.board) ? state.board[idx] : null;
                const type   = space?.type || 'coin';
                const meta   = SPACE_META[type] || { ic: '❓', n: type, c: 0xffffff };
                const cStr   = meta.c.toString(16).padStart(6, '0');
                const playerPos = typeof state.players[state.activePlayer].pos === 'number'
                    ? state.players[state.activePlayer].pos : 0;
                const dist = idx - playerPos;
                const distLabel = dist === 0 ? 'YOU ARE HERE'
                    : dist > 0 ? `${dist} space${dist !== 1 ? 's' : ''} ahead`
                    : `${-dist} space${-dist !== 1 ? 's' : ''} behind`;
                tt.innerHTML = `<span style="color:#${cStr}">${meta.ic} ${meta.n}</span><br><span class="map-dist">Space ${idx} · ${distLabel}</span>`;
            } else {
                const nodeId = td.nodeId;
                if (!nodeId) { tt.style.display = 'none'; return; }
                const node   = CITY_GRAPH[nodeId];
                const tile   = state.board[nodeId];
                const type   = tile?.type || node?.type || 'coin';
                const meta   = SPACE_META[type] || { ic: '❓', n: type, c: 0xffffff };
                const cStr   = meta.c.toString(16).padStart(6, '0');
                const dist   = node ? (DISTRICT_BIOMES[node.district]?.name || DISTRICT_NAMES[node.district] || '') : '';
                tt.innerHTML = `<span style="color:#${cStr}">${meta.ic} ${meta.n}</span><br><span class="map-dist">${dist}</span>`;
            }

            tt.style.left = Math.min(Math.max(e.clientX, 120), W - 120) + 'px';
            tt.style.top  = Math.min(e.clientY, H - 80) + 'px';
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
