// ============================================================
// UNLOCKS — what this device owns, and the questions the game asks of it.
// ============================================================
//
// Ownership is a set of entitlement keys (Catalog.js) saved in
// `hbd_meta_owned` as { key: source }, where source is 'tickets' or 'iap'. The
// source matters for one thing: Restore Purchases re-grants 'iap' keys from the
// store's own record, and must never touch what was earned with Tickets.
//
// ONLINE. The host deals every minigame and picks the map, so the host's
// library is the room's library without any extra protocol: a guest's own
// locks are never consulted during an online match. The gates below are only
// ever asked on the device that makes the decision.
// ============================================================

import * as Storage from '../core/Storage.js';
import * as Wallet from './Wallet.js';
import { keyForMinigame, keyForMap, ticketPrice, FREE_MINIGAMES } from './Catalog.js';

const KEY = 'meta_owned';

let _owned = null;
const _listeners = new Set();

function _load() {
    if (_owned) return _owned;
    const raw = Storage.load(KEY, null);
    _owned = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return _owned;
}

function _commit() {
    Storage.save(KEY, _owned);
    _listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}

/** Called after any ownership change. Returns an unsubscribe. */
export function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/** Is this entitlement key owned? A null key means "free" and is always owned. */
export function has(key) { return key == null || !!_load()[key]; }

/** Every owned key. */
export function ownedKeys() { return Object.keys(_load()); }

/** Record ownership. `source` is 'tickets' or 'iap'. Never downgrades iap → tickets. */
export function grant(keys, source) {
    const o = _load();
    let changed = false;
    for (const k of [].concat(keys)) {
        if (o[k] === 'iap') continue;
        if (o[k] !== source) { o[k] = source; changed = true; }
    }
    if (changed) _commit();
    return changed;
}

/**
 * Buy a key with Tickets. Returns 'ok', 'owned', 'unavailable' (no Ticket
 * price) or 'short' (not enough Tickets). Nothing changes unless 'ok'.
 */
export function buyWithTickets(key) {
    if (has(key)) return 'owned';
    const price = ticketPrice(key);
    if (price == null) return 'unavailable';
    if (!Wallet.spend(price)) return 'short';
    grant(key, 'tickets');
    return 'ok';
}

// ---- The game's questions -------------------------------------------------

export function minigameOwned(type) { return has(keyForMinigame(type)); }
export function mapOwned(mapId)     { return has(keyForMap(mapId)); }

/** Filter a list of minigame types down to the owned ones. Never returns empty
 *  while any free game is in the input: a pool must always be dealable. */
export function ownedMinigames(types) {
    const own = types.filter(minigameOwned);
    if (own.length) return own;
    const free = types.filter(t => FREE_MINIGAMES.includes(t));
    return free.length ? free : types;
}

/** QA / settings reset only. Does not touch purchases recorded by the store. */
export function _reset() { _owned = {}; _commit(); }
