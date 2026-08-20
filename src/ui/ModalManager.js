// ============================================================
// MODAL MANAGER — shop, inventory, messages, pass prompts, duel
// All modal HTML is in index.html; this file wires it up.
// ============================================================

import { state } from '../core/GameState.js';
import { ITEMS, MAX_INV, DISTRICT_SHOPS, BA_DISCOUNT, GRAND_MALL_DISCOUNT, DUEL_BET_OPTIONS } from '../config/GameConfig.js';
import * as DualRead from './DualRead.js';

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
    const box = document.getElementById(id);
    box.style.display = 'block';
    document.getElementById('modal-overlay').classList.add('act');
    // Toasts are pinned dead centre, which is exactly where a card sits — they
    // were landing on top of the text. Move them off the card while one is up.
    document.body.classList.add('modal-open');
    // Every modal gets the ⟳ flip button, in every play mode. msg-modal is the
    // exception: showMessage() presents it itself because it is the one that
    // carries a tier.
    if (id !== 'msg-modal') DualRead.present(box, { tier: 'owner' });
}

export function closeAllModals() {
    document.getElementById('modal-overlay').classList.remove('act');
    document.querySelectorAll('.modal-box').forEach(b => b.style.display = 'none');
    document.body.classList.remove('modal-open');
    DualRead.clearAll();
}

// ---- Message modal ----
//
// `opts.tier` decides who this card is for (see DualRead):
//   'shared' — both players need it now (minigame outcome, gate result, the
//              crown). In tabletop the card is drawn twice, facing both ways.
//   'owner'  — the turn-taker's business (space result, item pickup). They get
//              the card; the opponent gets a headline strip on their own edge.
// Default is 'owner', which is what the great majority of these are.
export function showMessage(title, desc, icon, opts = {}) {
    state.msgModalResolving = false;
    document.getElementById('msg-icon').textContent  = icon || '';
    document.getElementById('msg-title').textContent = title;
    document.getElementById('msg-desc').textContent  = desc;
    showModal('msg-modal');
    const tier = opts.tier || 'owner';
    const mirrored = DualRead.present(document.getElementById('msg-modal'), { tier });
    // A mirrored card is already in front of both people; a strip on top of it
    // would just be a third copy of the same sentence.
    if (mirrored) DualRead.hideTicker();
    else          DualRead.ticker(icon, opts.ticker || title);
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
        // Hundred Block Dash realm shops
        woods: '🌲 FOREST CACHE',
        ember: '🌋 MAGMA FORGE',
        fae:   '✨ FAE BAZAAR',
        void:  '🌌 VOID EXCHANGE',
    };
    const titleEl = document.getElementById('shop-modal-title');
    if (titleEl) titleEl.textContent = distTitles[distKey] || '🏪 ITEM SHOP';

    document.getElementById('shop-player-label').textContent = `${p.name} — ${p.coins} coins available`;
    const fullNote = document.getElementById('inv-full-note');
    fullNote.textContent = `🎒 Bag full — buy anyway and you'll pick one of the ${MAX_INV + 1} to drop.`;
    fullNote.style.display = isFull ? 'block' : 'none';

    // Build item list for this district
    const allowedKeys = DISTRICT_SHOPS[distKey] || Object.keys(ITEMS);
    const listEl = document.getElementById('shop-items-list');
    if (listEl) {
        listEl.innerHTML = allowedKeys.map(id => {
            const item = ITEMS[id];
            if (!item) return '';
            const rawPrice  = item.price;
            const price     = disc < 1.0 ? Math.ceil(rawPrice * disc) : rawPrice;
            // A full bag no longer blocks the purchase. You buy, and the
            // discard picker opens with all four items so you choose what to
            // drop — which is the whole point of having built the picker. The
            // old behaviour greyed out the entire shop and left you to work out
            // that you had to leave, use something, and walk back.
            const canBuy    = p.coins >= price;
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

// A duel is a wager, and a wager needs both sides to have something to put up.
// This screen had no close button and disabled any bet neither player could
// cover — so a player on zero coins met a wall of dead buttons with no way out.
// Landing on the tile now pays a stake, which guarantees the LANDER can always
// afford the smallest bet; this handles the other half, where the OPPONENT is
// the one who is broke and no stake to the lander can fix it.
export function showDuelModal(p, opp, callback) {
    const maxBet = Math.min(p.coins, opp.coins);
    const canWager = maxBet >= Math.min(...DUEL_BET_OPTIONS);

    const infoEl = document.getElementById('duel-info');
    if (infoEl) {
        infoEl.textContent = canWager
            ? `${p.name} vs ${opp.name} — ${p.name} sets the bet!`
            : `${opp.name} has nothing left to put up. No wager this time.`;
    }
    const noteEl = document.getElementById('duel-note');
    if (noteEl) {
        noteEl.textContent = canWager
            ? 'Winner takes the pot — set your bet!'
            : 'A duel needs two stakes. Play on.';
    }

    const betsEl = document.getElementById('duel-bet-options');
    if (betsEl) {
        betsEl.style.display = canWager ? '' : 'none';
        betsEl.innerHTML = !canWager ? '' : DUEL_BET_OPTIONS.map(amount => {
            const valid = amount <= maxBet;
            return `<button class="duel-bet-btn bfont" data-bet="${amount}"${valid ? '' : ' disabled'}>${amount}<br><span style="font-size:11px;font-family:'Nunito'">coins</span></button>`;
        }).join('');
    }
    // The escape hatch. Present whenever no bet is possible, so this screen can
    // never be a dead end again whatever the coin counts do.
    const outEl = document.getElementById('btn-duel-skip');
    if (outEl) outEl.style.display = canWager ? 'none' : '';

    _duelBetCb = callback;
    showModal('duel-modal');

    if (!canWager) {
        // Nothing to bet: let a bot walk out on its own, and give a human a button.
        if (p.isBot) setTimeout(() => resolveDuelSkip(), 1200);
        return;
    }

    // Bot auto-selects highest affordable bet
    if (p.isBot) {
        const botBet = [...DUEL_BET_OPTIONS].reverse().find(a => a <= maxBet) || DUEL_BET_OPTIONS[0];
        setTimeout(() => {
            closeAllModals();
            const cb = _duelBetCb; _duelBetCb = null;
            if (cb) cb(botBet);
        }, 800);
    }
}

// Leave a duel that cannot be wagered. Calls back with 0, which _startDuel
// already treats as "no duel" — it just never had a way to be told so.
export function resolveDuelSkip() {
    closeAllModals();
    const cb = _duelBetCb; _duelBetCb = null;
    if (cb) cb(0);
}

// ---- Drop modal (bag full) ----
//
// All four items are on screen at once — the three you carry and the one you
// just picked up — because the decision is a comparison and you cannot make it
// against an item you can't see. Tapping only *selects*; a separate DISCARD
// press commits, so a mis-tap never throws away an item you paid for.
//
// Selecting the incoming item is a legal choice: it means "I'd rather keep what
// I have". For a shop purchase that also means you are not charged.

let _dropSel    = null;   // index into inv, or -1 for the incoming item
let _dropPlayer = null;

export function openDropModal(player, newItemId, cost, returnState) {
    state.pendingBuyId         = newItemId;
    if (cost !== undefined && cost !== null) state.pendingBuyCost = cost;
    state.pendingReturnState   = returnState || (state.gameState === 'SHOP' ? 'shop' : 'finish_turn');
    // NOTE: `pendingShopAfterDrop` is the caller's to set — buyItem() sets it
    // just before calling here. This used to overwrite it with `false`, so a
    // purchase made with a full bag was never charged for.
    _dropSel    = null;
    _dropPlayer = player;

    const incoming = ITEMS[newItemId] || { icon: '❓', name: newItemId, desc: '' };
    const bought   = state.pendingShopAfterDrop;
    document.getElementById('drop-desc').textContent =
        `${bought ? 'You bought' : 'You found'} ${incoming.name}, but you can only carry ${MAX_INV}. `
        + `Tap one to throw away — picking ${incoming.name} ${bought ? 'cancels the purchase' : 'leaves it behind'}.`;

    const card = (id, idx, isNew) => {
        const it = ITEMS[id] || { icon: '❓', name: id, desc: '' };
        return `<div class="drop-card${isNew ? ' incoming' : ''}" data-drop-pid="${player.id}" data-drop-idx="${idx}">
            ${isNew ? '<span class="dc-tag">NEW</span>' : ''}
            <span class="dc-toss">TOSS</span>
            <div class="dc-ic">${it.icon}</div>
            <div class="dc-name">${it.name}</div>
            <div class="dc-desc">${it.desc || ''}</div>
        </div>`;
    };
    document.getElementById('drop-inv-row').innerHTML =
        player.inv.map((it, idx) => card(it, idx, false)).join('') + card(newItemId, -1, true);

    _paintDropChoice();
    showModal('drop-modal');
}

// Called on every tap so the button always describes what it is about to do.
function _paintDropChoice() {
    const btn = document.getElementById('btn-confirm-drop');
    document.querySelectorAll('#drop-inv-row .drop-card').forEach(el => {
        el.classList.toggle('sel', _dropSel !== null && parseInt(el.dataset.dropIdx) === _dropSel);
    });
    if (_dropSel === null) {
        btn.disabled = true;
        btn.textContent = 'SELECT ONE TO DISCARD';
    } else {
        const p  = _dropPlayer || state.players[state.activePlayer];
        const id = _dropSel === -1 ? state.pendingBuyId : p.inv[_dropSel];
        btn.disabled = !id;
        btn.textContent = id ? `🗑️ DISCARD ${(ITEMS[id]?.name || id).toUpperCase()}`
                             : 'SELECT ONE TO DISCARD';
    }
    // The card changed, so the opponent's copy of it has to change too.
    DualRead.refresh(document.getElementById('drop-modal'));
}

function _selectDrop(idx) { _dropSel = idx; _paintDropChoice(); }

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

    // Duel escape hatch — shown only when the opponent has nothing to stake, so
    // there is no bet to set. Without it the duel modal has no exit at all.
    document.getElementById('btn-duel-skip').addEventListener('click', () => resolveDuelSkip());

    // Drop modal — tapping a card only selects it; DISCARD commits.
    document.getElementById('drop-inv-row').addEventListener('click', e => {
        const card = e.target.closest('[data-drop-pid]');
        if (card) _selectDrop(parseInt(card.dataset.dropIdx));
    });
    document.getElementById('btn-confirm-drop').addEventListener('click', () => {
        if (_dropSel === null) return;
        _controller.confirmDrop((_dropPlayer || state.players[state.activePlayer]).id,
                                _dropSel, state.pendingBuyId);
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
