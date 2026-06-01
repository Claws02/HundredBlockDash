// ============================================================
// MODAL MANAGER — shop, inventory, messages, pass prompts, duel
// All modal HTML is in index.html; this file wires it up.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, MAX_INV, DISTRICT_SHOPS, BA_DISCOUNT, GRAND_MALL_DISCOUNT, DUEL_BET_OPTIONS } from '../config/GameConfig.js';

let _controller    = null;
let _wired         = false;
let _duelBetCb     = null;

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

export function openShop(district, discount) {
    const p           = state.players[state.activePlayer];
    const distKey     = district || 'ring';
    const disc        = discount || 1.0;
    const isFull      = p.inv.length >= MAX_INV;
    const isGrandMall = distKey === 'shop' && disc <= GRAND_MALL_DISCOUNT + 0.01;

    // District title
    const distTitles = {
        ring: '🏪 ITEM SHOP',
        fin:  '💹 WALL STREET EXCHANGE',
        ba:   '🏚️ UNDERGROUND MARKET',
        shop: isGrandMall ? '🛍️ GRAND MALL' : '🏪 SHOPPING PROMENADE',
        ind:  '⚙️ POWER PLANT SUPPLY',
    };
    const titleEl = document.getElementById('shop-modal-title');
    if (titleEl) titleEl.textContent = distTitles[distKey] || '🏪 ITEM SHOP';

    document.getElementById('shop-player-label').textContent = `${p.name} — ${p.coins} coins available`;
    document.getElementById('inv-full-note').style.display = isFull ? 'block' : 'none';

    // Build item list for this district
    const allowedKeys = DISTRICT_SHOPS[distKey] || Object.keys(ITEMS);
    const listEl = document.getElementById('shop-items-list');
    if (listEl) {
        listEl.innerHTML = allowedKeys.map(id => {
            const item = ITEMS[id];
            if (!item) return '';
            const rawPrice  = item.price;
            const price     = disc < 1.0 ? Math.ceil(rawPrice * disc) : rawPrice;
            const canBuy    = p.coins >= price && !isFull;
            const discLabel = disc < 1.0 ? ` <span class="shop-discount">(${Math.round((1 - disc) * 100)}% off)</span>` : '';
            return `<div class="m-row">
                <div class="m-row-info">
                    <b>${item.icon} ${item.name}${discLabel}</b>
                    <small>${item.desc}</small>
                </div>
                <button class="btn-buy" id="buy-${id}" data-item="${id}" data-cost="${price}"${canBuy ? '' : ' disabled'}>${price}💰</button>
            </div>`;
        }).join('');
    }

    if (disc < 1.0) {
        const pct = Math.round((1 - disc) * 100);
        const noteEl = document.getElementById('inv-full-note');
        if (noteEl && !isFull) {
            // show discount banner above full note area
            const discBanner = document.getElementById('shop-discount-banner');
            if (discBanner) { discBanner.style.display = 'block'; discBanner.textContent = `✨ ${pct}% discount applied!`; }
        }
    } else {
        const discBanner = document.getElementById('shop-discount-banner');
        if (discBanner) discBanner.style.display = 'none';
    }

    showModal('shop-modal');
}

// ---- Duel Modal ----

export function showDuelModal(p, opp, callback) {
    const infoEl = document.getElementById('duel-info');
    if (infoEl) infoEl.textContent = `${p.name} vs ${opp.name} — ${p.name} sets the bet!`;

    const betsEl = document.getElementById('duel-bet-options');
    if (betsEl) {
        betsEl.innerHTML = DUEL_BET_OPTIONS.map(amount => {
            const maxBet = Math.min(p.coins, opp.coins);
            const valid  = amount <= maxBet;
            return `<button class="duel-bet-btn bfont" data-bet="${amount}"${valid ? '' : ' disabled'}>${amount}<br><span style="font-size:11px;font-family:'Nunito'">coins</span></button>`;
        }).join('');
    }

    _duelBetCb = callback;
    showModal('duel-modal');

    // Bot auto-selects highest affordable bet
    if (p.isBot) {
        const maxBet = Math.min(p.coins, opp.coins);
        const botBet = [...DUEL_BET_OPTIONS].reverse().find(a => a <= maxBet) || DUEL_BET_OPTIONS[0];
        setTimeout(() => {
            closeAllModals();
            const cb = _duelBetCb; _duelBetCb = null;
            if (cb) cb(botBet);
        }, 800);
    }
}

// ---- Drop modal (inventory full) ----

export function openDropModal(player, newItemId, cost, returnState) {
    state.pendingBuyId         = newItemId;
    if (cost !== undefined && cost !== null) state.pendingBuyCost = cost;
    state.pendingShopAfterDrop = false;
    state.pendingReturnState   = returnState || (state.gameState === 'SHOP' ? 'shop' : 'finish_turn');
    document.getElementById('drop-inv-row').innerHTML = player.inv
        .map((it, idx) => `<button class="drop-item-btn" data-drop-pid="${player.id}" data-drop-idx="${idx}" data-drop-new="${newItemId}">${ITEMS[it]?.icon || '?'} ${ITEMS[it]?.name || it}</button>`)
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
        .map((it, idx) => `<button class="drop-item-btn" data-use-pid="${p.id}" data-use-idx="${idx}" style="flex-direction:column;align-items:flex-start;"><span>${ITEMS[it]?.icon || '?'} ${ITEMS[it]?.name || it}</span><small style="color:#999;font-size:11px;">${ITEMS[it]?.desc || ''}</small></button>`)
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

    // Shop buy buttons (delegated on shop-modal)
    document.getElementById('shop-modal').addEventListener('click', e => {
        const btn = e.target.closest('[data-item]');
        if (btn && !btn.disabled) _controller.buyItem(btn.dataset.item, parseInt(btn.dataset.cost));
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

    // Duel modal — bet buttons (delegated)
    document.getElementById('duel-modal')?.addEventListener('click', e => {
        const btn = e.target.closest('[data-bet]');
        if (!btn || btn.disabled) return;
        const amount = parseInt(btn.dataset.bet);
        closeAllModals();
        if (_duelBetCb) { const cb = _duelBetCb; _duelBetCb = null; cb(amount); }
        else _controller.confirmDuelBet(amount);
    });
}
