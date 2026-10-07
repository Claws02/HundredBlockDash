// ============================================================
// WALLET — the Ticket balance, and the daily counters around it.
// ============================================================
//
// Tickets are the one soft currency (docs/LAUNCH_PLAN.md §3). They live only on
// this device, in `hbd_meta_wallet`; there is no server and no account, which is
// what lets the privacy policy say we hold nothing. terms.html says the flip
// side: a wiped phone loses its Tickets, and Restore Purchases only brings back
// what was bought with money.
//
// Every change goes through `_commit`, which saves and then tells listeners, so
// a balance on screen can never disagree with the saved one.
// ============================================================

import * as Storage from '../core/Storage.js';
import { EARN } from './Catalog.js';

const KEY = 'meta_wallet';
const DEFAULT = { tickets: 0, earnedTotal: 0, day: '', adsToday: 0, playedToday: false };

let _w = null;
const _listeners = new Set();

function _today() {
    // Local calendar day: "first match of the day" should roll over at the
    // player's midnight, not UTC's.
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function _load() {
    if (_w) return _w;
    const raw = Storage.load(KEY, null);
    _w = { ...DEFAULT, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!Number.isFinite(_w.tickets) || _w.tickets < 0) _w.tickets = 0;
    _w.tickets = Math.floor(_w.tickets);
    return _w;
}

function _rollDay() {
    const w = _load();
    const t = _today();
    if (w.day !== t) { w.day = t; w.adsToday = 0; w.playedToday = false; }
    return w;
}

function _commit() {
    Storage.save(KEY, _w);
    _listeners.forEach(fn => { try { fn(_w.tickets); } catch (e) { console.error(e); } });
}

/** Current balance. */
export function balance() { return _load().tickets; }

/** Called with the new balance after every change. Returns an unsubscribe. */
export function onChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/** Add Tickets. `amount` must be a positive integer. */
export function earn(amount) {
    amount = Math.floor(amount);
    if (!(amount > 0)) return balance();
    const w = _load();
    w.tickets += amount;
    w.earnedTotal += amount;
    _commit();
    return w.tickets;
}

/** Take Tickets if the balance covers it. Returns true when spent. */
export function spend(amount) {
    amount = Math.floor(amount);
    const w = _load();
    if (!(amount > 0) || w.tickets < amount) return false;
    w.tickets -= amount;
    _commit();
    return true;
}

// ---- Match reward ---------------------------------------------------------

/**
 * Pay out for a finished match. `mgWins` is the minigames won by the humans on
 * THIS device (every human seat in pass-and-play; only my own seat online).
 * Returns the breakdown so the win screen can show where the Tickets came from.
 */
export function rewardMatch(mgWins) {
    const w = _rollDay();
    const lines = [{ label: 'Match played', amount: EARN.matchFinished }];
    const wins = Math.max(0, Math.floor(mgWins || 0));
    if (wins) lines.push({ label: `${wins} minigame win${wins === 1 ? '' : 's'}`, amount: wins * EARN.minigameWin });
    if (!w.playedToday) {
        w.playedToday = true;
        lines.push({ label: 'First match today', amount: EARN.firstOfDay });
    }
    let total = lines.reduce((s, l) => s + l.amount, 0);
    total = Math.min(total, EARN.matchCap);
    earn(total);   // saves the day flags too
    return { total, lines };
}

// ---- Rewarded ads ---------------------------------------------------------

export function adsLeftToday() { return Math.max(0, EARN.adsPerDay - _rollDay().adsToday); }

/** Credit one completed rewarded ad. Returns false once today's cap is reached. */
export function rewardAd() {
    const w = _rollDay();
    if (w.adsToday >= EARN.adsPerDay) return false;
    w.adsToday++;
    earn(EARN.rewardedAd);
    return true;
}

/** QA / settings reset only. */
export function _reset() { _w = { ...DEFAULT }; _commit(); }
