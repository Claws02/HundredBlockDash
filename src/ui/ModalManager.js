// ============================================================
// MODAL MANAGER — shop, inventory, messages, pass prompts
// All modal HTML is in index.html; this file wires it up.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, MAX_INV } from '../config/GameConfig.js';

let _controller = null;
let _wired      = false;

export function init(controller) {
    _controller = controller;
    if (!_wired) { _wireStaticButtons(); _wired = true; }
}

// ---- Low-level helpers ----

export function showModal(id) {
    document.querySelectorAll('.modal-box').forEach(b => b.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    document.getElementById('modal-overlay').classList.add('act');
}

export function closeAllModals() {
    document.getElementById('modal-overlay').classList.remove('act');
    document.querySelectorAll('.modal-box').forEach(b => b.style.display = 'none');
}

// ---- Message modal ----

export function showMessage(title, desc, icon) {
    state.msgModalResolving = false;
    document.getElementById('msg-icon').textContent  = icon || '';
    document.getElementById('msg-title').textContent = title;
    document.getElementById('msg-desc').textContent  = desc;
    showModal('msg-modal');
}

// ---- Shop ----

export function openShop() {
    const p = state.players[state.activePlayer];
    state.gameState = 'SHOP';

    if (p.isBot) {
        _botShop(p);
        return;
    }

    document.getElementById('shop-player-label').textContent = `${p.name} — ${p.coins} coins available`;
    const isFull = p.inv.length >= MAX_INV;
    document.getElementById('inv-full-note').style.display = isFull ? 'block' : 'none';
    Object.entries(ITEMS).forEach(([id, item]) => {
        const btn = document.getElementById(`buy-${id}`);
        if (btn) btn.disabled = p.coins < item.price || isFull;
    });
    showModal('shop-modal');
}

function _botShop(p) {
    const opp = state.players[(state.activePlayer + 1) % 2];
    const affordable = Object.keys(ITEMS).filter(k => p.coins >= ITEMS[k].price);
    if (affordable.length > 0 && p.inv.length < MAX_INV) {
        const ahead     = p.pos > opp.pos;
        const preferred = ahead
            ? affordable.filter(k => ['cursed_die', 'anchor', 'swap', 'steal'].includes(k))
            : affordable.filter(k => ['shield', 'rocket', 'warp_drive', 'double_die'].includes(k));
        const pool = preferred.length > 0 ? preferred : affordable;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        p.coins -= ITEMS[pick].price;
        p.inv.push(pick);
        import('../ui/UIManager.js').then(({ toast }) => toast(`${p.name} bought ${ITEMS[pick].name}!`, '#a855f7'));
    }
    state.gameState = 'ACKNOWLEDGE';
    setTimeout(() => { if (state.gameState === 'ACKNOWLEDGE') _controller.finishTurn(); }, 1000);
}

// ---- Drop modal (inventory full) ----

export function openDropModal(player, newItemId, cost, returnState) {
    state.pendingBuyId         = newItemId;
    if (cost !== undefined && cost !== null) state.pendingBuyCost = cost;
    state.pendingShopAfterDrop = false;
    state.pendingReturnState   = returnState || (state.gameState === 'SHOP' ? 'shop' : 'finish_turn');
    document.getElementById('drop-inv-row').innerHTML = player.inv
        .map((it, idx) => `<button class="drop-item-btn" data-drop-pid="${player.id}" data-drop-idx="${idx}" data-drop-new="${newItemId}">${ITEMS[it].icon} ${ITEMS[it].name}</button>`)
        .join('');
    showModal('drop-modal');
}

// ---- Use item modal ----

export function openUseModal() {
    const p = state.players[state.activePlayer];
    if (p.inv.length === 0) {
        import('../ui/UIManager.js').then(({ toast }) => toast('Inventory empty!', '#fff'));
        return;
    }
    document.getElementById('use-player-label').textContent = `${p.name} — choose an item:`;
    document.getElementById('use-inv-row').innerHTML = p.inv
        .map((it, idx) => `<button class="drop-item-btn" data-use-pid="${p.id}" data-use-idx="${idx}" style="flex-direction:column;align-items:flex-start;"><span>${ITEMS[it].icon} ${ITEMS[it].name}</span><small style="color:#999;font-size:11px;">${ITEMS[it].desc}</small></button>`)
        .join('');
    showModal('use-modal');
}

// ---- Pass modal ----

export function showPassModal(desc, gateNext = false) {
    state.gameState = 'PASS_PROMPT';
    document.getElementById('pass-desc').textContent = desc;
    document.getElementById('pass-modal').dataset.gateNext = gateNext ? 'true' : 'false';
    showModal('pass-modal');
}

// ---- Custom dice modal ----

export function openCustomDiceModal() {
    showModal('custom-dice-modal');
}

// ---- Shop offer (pass-through) ----

export function showShopOffer() {
    state.gameState = 'SHOP';
    showModal('shop-offer-modal');
}

// ---- Wire static buttons (called once at init) ----

function _wireStaticButtons() {
    // Message continue
    document.getElementById('btn-msg-continue').addEventListener('click', () => _controller.resolveMsgModal());

    // Shop close
    document.getElementById('btn-close-shop').addEventListener('click', () => _controller.closeShopModal());

    // Shop buy buttons (delegated)
    document.getElementById('shop-modal').addEventListener('click', e => {
        const btn = e.target.closest('[data-item]');
        if (btn) _controller.buyItem(btn.dataset.item, parseInt(btn.dataset.cost));
    });

    // Shop offer
    document.getElementById('btn-shop-offer-enter').addEventListener('click', () => _controller.shopOfferEnter());
    document.getElementById('btn-shop-offer-skip').addEventListener('click',  () => _controller.shopOfferSkip());

    // Custom dice
    document.getElementById('custom-dice-modal').addEventListener('click', e => {
        const btn = e.target.closest('[data-pick]');
        if (btn) _controller.confirmCustomDice(parseInt(btn.dataset.pick));
    });
    document.getElementById('btn-cancel-custom-dice').addEventListener('click', () => closeAllModals());

    // Pass modal
    document.getElementById('btn-resolve-pass').addEventListener('click', () => _controller.resolvePassModal());

    // Drop modal
    document.getElementById('drop-inv-row').addEventListener('click', e => {
        const btn = e.target.closest('[data-drop-pid]');
        if (btn) _controller.confirmDrop(parseInt(btn.dataset.dropPid), parseInt(btn.dataset.dropIdx), btn.dataset.dropNew);
    });
    document.getElementById('btn-cancel-drop').addEventListener('click', () => _controller.cancelDrop());

    // Use modal
    document.getElementById('use-inv-row').addEventListener('click', e => {
        const btn = e.target.closest('[data-use-pid]');
        if (btn) _controller.executeUseItem(parseInt(btn.dataset.usePid), parseInt(btn.dataset.useIdx));
    });
    document.getElementById('btn-cancel-use').addEventListener('click', () => closeAllModals());
}
