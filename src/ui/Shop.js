// ============================================================
// SHOP — boards, minigame packs, looks and Tickets in one screen.
// ============================================================
//
// Three tabs (docs/LAUNCH_PLAN.md §3):
//   GAMES    the City Circuit board and the four minigame packs, each for
//            Tickets OR a direct purchase, plus the Everything bundle
//   LOOKS    cosmetics per seat on this device (P1–P4), bought with Tickets
//   TICKETS  the opt-in rewarded ad, Ticket packs, Restore Purchases
//
// Rules the screen keeps:
//   · spending Tickets takes two taps (the button turns into CONFIRM), so a
//     stray thumb can never empty a balance;
//   · real-money buttons always show the store's own localised price;
//   · nothing is random, and the Ticket line under the header says Tickets
//     have no cash value (terms.html §3).
//
// The overlay is built here rather than in index.html so the whole shop is one
// file: open() makes it on first use.
// ============================================================

import * as Wallet from '../meta/Wallet.js';
import * as Unlocks from '../meta/Unlocks.js';
import * as Store from '../meta/Store.js';
import * as Ads from '../meta/Ads.js';
import * as Cosmetics from '../meta/Cosmetics.js';
import { MINIGAME_PACKS, MAP_UNLOCKS, PRODUCTS, EARN, ticketPrice, productForKey } from '../meta/Catalog.js';
import { MAP_REGISTRY } from '../config/MapRegistry.js';
import { MG_INFO } from '../config/MinigameRegistry.js';
import { PLAYER_SLOTS } from '../config/GameConfig.js';
import { state } from '../core/GameState.js';
import * as Renderer from '../engine/Renderer.js';

let _root = null;
let _tab = 'games';
let _seat = 0;
let _confirmKey = null, _confirmTimer = null;
let _onClose = null;

const $ = sel => _root.querySelector(sel);

/** Open the shop. `focus` is an entitlement key to jump to and highlight. */
export function open(opts = {}) {
    _build();
    _onClose = opts.onClose || null;
    if (opts.focus) _tab = opts.focus.startsWith('cos:') ? 'looks' : 'games';
    if (opts.tab) _tab = opts.tab;
    _root.style.display = 'flex';
    Store.init().then(_render);   // prices arrive late on device: paint twice
    _render();
    if (opts.focus) {
        requestAnimationFrame(() => {
            const el = _root.querySelector(`[data-item="${CSS.escape(opts.focus)}"]`);
            if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('shop-focus'); }
        });
    }
}

export function close() {
    if (!_root) return;
    _root.style.display = 'none';
    _clearConfirm();
    const cb = _onClose; _onClose = null;
    if (cb) cb();
}

export function isOpen() { return !!_root && _root.style.display !== 'none'; }

// ---- build -----------------------------------------------------------------

function _build() {
    if (_root) return;
    _root = document.createElement('div');
    _root.id = 'shop-overlay';
    _root.style.display = 'none';
    _root.setAttribute('role', 'dialog');
    _root.setAttribute('aria-label', 'Shop');
    _root.innerHTML = `
        <div class="mg-sel-header">
            <button class="mg-sel-back bfont" id="btn-shop-back">← BACK</button>
            <div class="mg-sel-title bfont">🛒 SHOP</div>
            <div class="shop-balance bfont" id="shop-balance"></div>
        </div>
        <div class="shop-tabs" role="tablist">
            <button class="mg-chip bfont" data-tab="games" role="tab">🎮 GAMES</button>
            <button class="mg-chip bfont" data-tab="looks" role="tab">✨ LOOKS</button>
            <button class="mg-chip bfont" data-tab="tickets" role="tab">🎟️ TICKETS</button>
        </div>
        <div class="shop-body" id="shop-body"></div>
        <div class="shop-foot">Tickets have no cash value. Nothing in the shop is random.
            <a href="terms.html" target="_blank" rel="noopener">Terms</a></div>`;
    document.body.appendChild(_root);

    $('#btn-shop-back').addEventListener('click', close);
    _root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
        _tab = b.dataset.tab; _clearConfirm(); _render();
        $('#shop-body').scrollTop = 0;
    }));
    $('#shop-body').addEventListener('click', _onClick);
    Wallet.onChange(() => { if (isOpen()) _paintBalance(); });
    Unlocks.onChange(() => { if (isOpen()) _render(); });
}

function _paintBalance() { $('#shop-balance').textContent = `${Wallet.balance()} 🎟️`; }

function _render() {
    if (!_root) return;
    _paintBalance();
    _root.querySelectorAll('[data-tab]').forEach(b => {
        const on = b.dataset.tab === _tab;
        b.classList.toggle('sel', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const body = $('#shop-body');
    body.innerHTML = _tab === 'games' ? _gamesTab() : _tab === 'looks' ? _looksTab() : _ticketsTab();
    if (_tab === 'looks') _paintPreview();
}

// ---- tab: games --------------------------------------------------------------

function _gamesTab() {
    const bundle = PRODUCTS.find(p => p.id === 'hbd.bundle.everything');
    const allOwned = bundle.grants.every(k => Unlocks.has(k));
    let h = '';
    if (!allOwned) {
        h += `<div class="shop-card shop-bundle" data-item="bundle">
            <div class="shop-card-head"><span class="shop-icon">🌟</span>
                <div><div class="shop-name bfont">EVERYTHING UNLOCKED</div>
                <div class="shop-blurb">City Circuit, all four minigame packs, and the Supporter Crown 👑. Friends in your online rooms play all of it too.</div></div></div>
            <div class="shop-buy">${_moneyBtn(bundle.id)}</div></div>`;
    }
    h += `<div class="shop-section bfont">BOARDS</div>`;
    for (const mapId of Object.keys(MAP_UNLOCKS)) {
        const map = MAP_REGISTRY.find(m => m.id === mapId);
        if (!map || map.archived) continue;
        const key = `map:${mapId}`;
        h += _itemCard(key, map.icon, map.name.toUpperCase(), map.desc);
    }
    h += `<div class="shop-section bfont">MINIGAME PACKS</div>`;
    for (const [id, p] of Object.entries(MINIGAME_PACKS)) {
        const list = p.games.map(g => `${MG_INFO[g]?.icon || ''} ${_title(MG_INFO[g]?.title || g)}`).join(' · ');
        h += _itemCard(`pack:${id}`, p.icon, `${p.name.toUpperCase()} · ${p.games.length} GAMES`, `${p.blurb}<div class="shop-games">${list}</div>`);
    }
    return h;
}

function _title(t) { return t.charAt(0) + t.slice(1).toLowerCase(); }

function _itemCard(key, icon, name, blurb) {
    const owned = Unlocks.has(key);
    const prod = productForKey(key);
    return `<div class="shop-card${owned ? ' owned' : ''}" data-item="${key}">
        <div class="shop-card-head"><span class="shop-icon">${icon}</span>
            <div><div class="shop-name bfont">${name}</div><div class="shop-blurb">${blurb}</div></div></div>
        <div class="shop-buy">${owned ? '<span class="shop-owned bfont">✓ OWNED</span>'
            : _ticketBtn(key) + (prod ? _moneyBtn(prod.id) : '')}</div></div>`;
}

function _ticketBtn(key) {
    const price = ticketPrice(key);
    if (price == null) return '';
    const can = Wallet.balance() >= price;
    const confirming = _confirmKey === key;
    return `<button class="shop-btn shop-btn-tix bfont${confirming ? ' confirm' : ''}" data-tix="${key}"${can ? '' : ' disabled'}>` +
        (confirming ? `CONFIRM · ${price} 🎟️` : `${price} 🎟️`) + `</button>`;
}

function _moneyBtn(productId) {
    if (!Store.available()) return '';
    return `<button class="shop-btn shop-btn-money bfont" data-buy="${productId}">${Store.price(productId)}</button>`;
}

// ---- tab: looks --------------------------------------------------------------

function _looksTab() {
    const seats = PLAYER_SLOTS.map((s, i) =>
        `<button class="shop-seat bfont${i === _seat ? ' sel' : ''}" data-seat="${i}" style="--seat:${s.hex}">P${i + 1}</button>`).join('');
    let h = `<div class="shop-looks-top">
        <div class="shop-preview" id="shop-preview"></div>
        <div class="shop-seat-col"><div class="shop-seat-label">DRESSING</div><div class="shop-seats">${seats}</div>
        <div class="shop-seat-note">Each player on this phone has their own look. Online, everyone sees P1's.</div></div></div>`;
    const look = Cosmetics.lookFor(_seat);
    for (const [slot, meta] of Object.entries(Cosmetics.SLOTS)) {
        h += `<div class="shop-section bfont">${meta.icon} ${meta.name}</div><div class="shop-grid">`;
        for (const c of Cosmetics.inSlot(slot)) {
            if (c.supporter && !Cosmetics.owned(c)) {
                h += `<div class="shop-cos locked" data-item="${Cosmetics.keyOf(c)}"><span class="shop-cos-icon">${c.icon}</span>
                    <span class="shop-cos-name">${c.name}</span><span class="shop-cos-note">With Everything Unlocked</span></div>`;
                continue;
            }
            const key = Cosmetics.keyOf(c);
            const owned = Cosmetics.owned(c);
            const on = look[slot] === c.id;
            h += `<div class="shop-cos${on ? ' on' : ''}${owned ? '' : ' locked'}" data-item="${key}">
                <span class="shop-cos-icon">${c.icon}</span><span class="shop-cos-name">${c.name}</span>` +
                (on ? '<span class="shop-cos-tag bfont">✓ ON</span>'
                    : owned ? `<button class="shop-btn shop-btn-equip bfont" data-equip="${slot}:${c.id}">WEAR</button>`
                    : _ticketBtn(key)) + `</div>`;
        }
        h += `</div>`;
    }
    return h;
}

let _previewTimer = null;
function _paintPreview() {
    clearTimeout(_previewTimer);
    // Rendering a portrait spins up a WebGL context: debounce, and never block
    // the tap that caused it.
    _previewTimer = setTimeout(() => {
        const el = _root && _root.querySelector('#shop-preview');
        if (!el) return;
        const type = state.charSelections?.[_seat] || PLAYER_SLOTS[_seat].charType;
        const look = Cosmetics.lookFor(_seat);
        const pics = Renderer.renderCharacterPortraits([type], PLAYER_SLOTS[_seat].color, 200, look);
        el.innerHTML = pics[type] ? `<img alt="Player ${_seat + 1} preview" src="${pics[type]}">` : '';
    }, 30);
}

// ---- tab: tickets ------------------------------------------------------------

function _ticketsTab() {
    let h = '';
    if (Ads.supported()) {
        const left = Wallet.adsLeftToday();
        h += `<div class="shop-card shop-ad">
            <div class="shop-card-head"><span class="shop-icon">📺</span>
                <div><div class="shop-name bfont">WATCH AN AD · +${EARN.rewardedAd} 🎟️</div>
                <div class="shop-blurb">Only when you choose to. ${left} of ${EARN.adsPerDay} left today.</div></div></div>
            <div class="shop-buy"><button class="shop-btn shop-btn-ad bfont" data-ad="1"${Ads.canWatch() ? '' : ' disabled'}>${left ? '▶ WATCH' : 'BACK TOMORROW'}</button></div></div>`;
    }
    h += `<div class="shop-card"><div class="shop-card-head"><span class="shop-icon">🏁</span>
        <div><div class="shop-name bfont">EARN BY PLAYING</div>
        <div class="shop-blurb">+${EARN.matchFinished} for every match · +${EARN.minigameWin} for every minigame you win · +${EARN.firstOfDay} for your first match each day.</div></div></div></div>`;
    if (Store.available()) {
        h += `<div class="shop-section bfont">TICKET PACKS</div>`;
        for (const p of PRODUCTS.filter(p => p.kind === 'consumable')) {
            h += `<div class="shop-card shop-row"><div class="shop-card-head"><span class="shop-icon">🎟️</span>
                <div><div class="shop-name bfont">${p.title.toUpperCase()}</div></div></div>
                <div class="shop-buy">${_moneyBtn(p.id)}</div></div>`;
        }
    } else {
        h += `<div class="shop-note">${Store.unavailableReason()}</div>`;
    }
    h += `<button class="splash-link bfont shop-restore" data-restore="1">↺ RESTORE PURCHASES</button>`;
    return h;
}

// ---- actions -----------------------------------------------------------------

function _clearConfirm() { _confirmKey = null; clearTimeout(_confirmTimer); }

async function _onClick(e) {
    const t = e.target.closest('button');
    if (!t || t.disabled) return;

    if (t.dataset.seat != null) { _seat = +t.dataset.seat; _render(); return; }

    if (t.dataset.equip) {
        const [slot, id] = t.dataset.equip.split(':');
        Cosmetics.equip(_seat, slot, id);
        _render();
        return;
    }

    if (t.dataset.tix) {
        const key = t.dataset.tix;
        if (_confirmKey !== key) {
            _clearConfirm();
            _confirmKey = key;
            _confirmTimer = setTimeout(() => { _confirmKey = null; _render(); }, 3500);
            _render();
            return;
        }
        _clearConfirm();
        const r = Unlocks.buyWithTickets(key);
        if (r === 'ok') {
            // A look is worn the moment it is bought: that is why it was bought.
            if (key.startsWith('cos:')) {
                const [slot, id] = key.slice(4).split('.');
                Cosmetics.equip(_seat, slot, id);
            }
            _toast('🔓 Unlocked!');
        } else if (r === 'short') _toast('Not enough Tickets yet.');
        _render();
        return;
    }

    if (t.dataset.buy) {
        t.disabled = true;
        const r = await Store.buy(t.dataset.buy);
        if (r.ok) _toast('🎉 Thank you! Unlocked.');
        else if (r.pending) _toast('Purchase pending: it unlocks as soon as the store confirms it.');
        else if (!r.cancelled) _toast(r.error || 'Purchase failed.');
        _render();
        return;
    }

    if (t.dataset.ad) {
        t.disabled = true; t.textContent = 'LOADING…';
        const r = await Ads.watch();
        if (r.ok) _toast(`+${EARN.rewardedAd} 🎟️`);
        else if (r.reason === 'skipped') _toast('Watch to the end to get the Tickets.');
        else if (r.reason === 'consent') _toast('Ads are off for your privacy choice. Change it in Settings.');
        else if (r.reason !== 'cap') _toast('No ad available right now. Try again later.');
        _render();
        return;
    }

    if (t.dataset.restore) {
        t.disabled = true; t.textContent = 'RESTORING…';
        try {
            const n = await Store.restore();
            _toast(n ? `Restored ${n} purchase${n === 1 ? '' : 's'}.` : 'Everything you bought is already unlocked.');
        } catch (err) {
            _toast(err.message || 'Could not reach the store.');
        }
        _render();
    }
}

function _toast(msg) {
    // UIManager's toast lives in the board's UI layer, which is hidden on the
    // menus. The shop has its own.
    let el = document.getElementById('shop-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'shop-toast';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        _root.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}
