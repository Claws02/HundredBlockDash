// ============================================================
// UI MANAGER — HUD, toasts, space card, map, coin animation
// Reads GameState; never contains game rules.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, SPACE_DESCS } from '../config/GameConfig.js';
import { getPos, boardCurve, getTileMeshes, setMapCameraTarget, mapCamera, onResize, getCamera } from '../engine/Renderer.js';

let _controller = null;
const _coinTargets = [0, 0];
const _coinCurrent = [0, 0];
let   _coinFrame   = null;

const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

export function init(controller) {
    _controller = controller;
    _initBackground();
    _wireMapEvents();
    _wireSwipeEvents();
    window.addEventListener('resize', onResize);
}

// ---- HUD ----

export function updateUI() {
    state.players.forEach((p, i) => {
        if (_coinTargets[i] !== p.coins) animateCoinDisplay(i, p.coins);
        document.getElementById(`p${i + 1}-inv`).innerHTML = p.inv
            .map(it => `<div class="inv-slot" title="${ITEMS[it].name}">${ITEMS[it].icon}</div>`)
            .join('');
        const isActive = i === state.activePlayer;
        document.getElementById(`hud-p${i + 1}`).classList.toggle('active-turn', isActive);
        document.getElementById(`p${i + 1}-actions`).style.display =
            (isActive && state.gameState === 'PRE_ROLL' && !p.isBot) ? 'flex' : 'none';
        const spacesLeft = 99 - p.pos;
        document.getElementById(`p${i + 1}-pos-badge`).textContent =
            p.pos === 0 ? 'START' : p.pos >= 99 ? 'FINISHED!' : `${spacesLeft} left`;
    });
}

export function setPlayerNames() {
    document.getElementById('hud-name-p1').textContent = `🚗 ${state.players[0].name.toUpperCase()}`;
    document.getElementById('hud-name-p2').innerHTML   =
        `🎩 ${state.players[1].name.toUpperCase()}${state.players[1].isBot ? ' <span class="bot-badge">BOT</span>' : ''}`;
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
    state.gameState  = 'MAP';
    state.cameraState = 'MAP';
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('map-ui').style.display   = 'flex';
    const slider = document.getElementById('map-slider');
    slider.value = state.players[state.activePlayer].pos;
    document.getElementById('map-tooltip').style.display = 'none';
    setMapCameraTarget(state.players[state.activePlayer].pos, 50, 20);
    updateMapSlider();
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
    setMapCameraTarget(val, 40, 25);
    document.getElementById('map-tooltip').style.display = 'none';
    const spacesLeft = 99 - state.players[state.activePlayer].pos;
    document.getElementById('map-counter').textContent = `${spacesLeft} to finish`;
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
        const hits = raycaster.intersectObjects(getTileMeshes());
        const tt   = document.getElementById('map-tooltip');
        if (hits.length > 0) {
            const td   = hits[0].object.userData;
            if (td.idx === undefined) { tt.style.display = 'none'; return; }
            const dist = td.idx - state.players[state.activePlayer].pos;
            const tile = state.board[td.idx];
            const meta = (window.SPACE_META_REF || {})[tile?.type] || { ic: '❓', n: tile?.type || '?', c: 0xffffff };
            const distText = dist === 0 ? '📍 YOU ARE HERE' : (dist > 0 ? `${dist} AHEAD` : `${Math.abs(dist)} BEHIND`);
            const cStr = meta.c.toString(16).padStart(6, '0');
            tt.innerHTML = `<span style="color:#${cStr}">${meta.ic} ${meta.n}</span><br><span class="map-dist">${distText}</span>`;
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
        const dy  = sy - e.changedTouches[0].clientY;
        const dt  = Math.max(Date.now() - st, 16);
        const vel = dy / dt;
        if (dy > 20 && vel > 0.2) _controller.executeRoll(Math.min(vel, 3.5));
    });
    zone.addEventListener('mousedown', e => { sy = e.clientY; st = Date.now(); });
    zone.addEventListener('mouseup', e => {
        if (state.gameState !== 'PRE_ROLL' || state.players[state.activePlayer].isBot) return;
        const dy  = sy - e.clientY;
        const dt  = Math.max(Date.now() - st, 16);
        const vel = dy / dt;
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
    _coinTargets[pid] = target;
    if (!_coinFrame) _coinFrame = requestAnimationFrame(_tickCoin);
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
