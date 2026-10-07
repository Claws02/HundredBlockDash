// ============================================================
// STORE — real-money purchases through Apple / Google.
// ============================================================
//
// Talks to @capgo/native-purchases (StoreKit 2 on iOS, Play Billing on
// Android) through `window.Capacitor.Plugins.NativePurchases`, the same way
// PauseMenu reaches App and AudioManager reaches Haptics. There is no bundler
// and no server: StoreKit 2 transactions arrive already signature-checked by
// the OS, and Play purchases are checked for `purchaseState === "1"`. That is
// the right weight for a game with no accounts; a receipt-validation server is
// the upgrade if fraud ever matters (docs/LAUNCH_PLAN.md §3).
//
// In a browser there is no store. `available()` is false and the shop says the
// purchases live in the app. `?devstore` in the URL (or hbd_devstore=1 in
// localStorage) switches on a simulated store so the QA probes and a desktop
// browser can drive every purchase path.
// ============================================================

import * as Storage from '../core/Storage.js';
import * as Unlocks from './Unlocks.js';
import * as Wallet from './Wallet.js';
import * as AgeGate from './AgeGate.js';
import { PRODUCTS, product } from './Catalog.js';

const NP = () => window.Capacitor?.Plugins?.NativePurchases || null;
const INAPP = 'inapp';
const SEEN_KEY = 'meta_txn_seen';    // consumable transactions already credited

let _prices = {};                    // productId → localised price string
let _ready = false;

function _dev() {
    try {
        return /[?&]devstore\b/.test(location.search) || localStorage.getItem('hbd_devstore') === '1';
    } catch (e) { return false; }
}

/** Is there a store to buy from on this device right now? */
export function available() {
    return (!!NP() || _dev()) && AgeGate.allowsPurchases();
}

/** Why `available()` is false, in words for the shop. */
export function unavailableReason() {
    if (!AgeGate.allowsPurchases()) return 'Purchases need a parent or guardian\'s approval on this account.';
    return 'Purchases are available in the app from the App Store or Google Play.';
}

/** The price to show: the store's localised one once it has answered. */
export function price(productId) {
    return _prices[productId] || product(productId)?.price || '';
}

/** Load prices and quietly re-grant anything already owned. Safe to call twice. */
export async function init() {
    if (_ready) return;
    _ready = true;
    const np = NP();
    if (!np) return;
    try {
        const { products } = await np.getProducts({
            productIdentifiers: PRODUCTS.map(p => p.id), productType: INAPP,
        });
        for (const p of products || []) _prices[p.identifier] = p.priceString;
    } catch (e) { console.warn('[Store] getProducts failed', e); }
    // A reinstall, or a purchase that completed while the app was closed.
    // Non-consumables only: Restore Purchases is still offered as a button,
    // which App Review requires, but nobody should have to find it.
    try { await _reconcile(); } catch (e) { console.warn('[Store] reconcile failed', e); }
}

/**
 * Buy a product. Resolves to { ok, pending?, cancelled?, error? }.
 * Grants happen here, before resolving, so the caller only has to repaint.
 */
export async function buy(productId) {
    const prod = product(productId);
    if (!prod) return { ok: false, error: 'Unknown product.' };
    if (!available()) return { ok: false, error: unavailableReason() };

    if (!NP()) {   // simulated store
        _apply(prod, `dev-${productId}-${Date.now()}`);
        return { ok: true };
    }
    try {
        const t = await NP().purchaseProduct({
            productIdentifier: productId,
            productType: INAPP,
            quantity: 1,
            isConsumable: prod.kind === 'consumable',
        });
        if (t?.purchaseState && t.purchaseState !== '1') {
            // Android "pending" (cash payment, a parent's approval). It lands
            // later and is picked up by the next init/restore.
            return { ok: false, pending: true };
        }
        _apply(prod, t?.transactionId);
        return { ok: true };
    } catch (e) {
        const msg = String(e?.message || e || '');
        if (/cancel/i.test(msg)) return { ok: false, cancelled: true };
        return { ok: false, error: 'The store could not complete the purchase. You have not been charged.' };
    }
}

/** Restore Purchases. Resolves to the number of items re-granted. */
export async function restore() {
    if (!NP()) {
        if (_dev()) return 0;
        throw new Error(unavailableReason());
    }
    try { await NP().restorePurchases(); } catch (e) { /* Android has nothing to sync; carry on */ }
    return _reconcile();
}

// ---- internals ------------------------------------------------------------

async function _reconcile() {
    const { purchases } = await NP().getPurchases({ productType: INAPP, onlyCurrentEntitlements: true });
    let n = 0;
    for (const t of purchases || []) {
        if (t.revocationDate) continue;                          // refunded (iOS)
        if (t.purchaseState && t.purchaseState !== '1') continue; // pending (Android)
        const prod = product(t.productIdentifier);
        if (!prod) continue;
        if (prod.kind === 'nonconsumable') {
            if (Unlocks.grant(prod.grants, 'iap')) n++;
        } else {
            // A consumable still listed was paid for and never finished (the
            // app died mid-purchase). Credit it if it has not been, and consume
            // it either way: Android will not sell it again until it is.
            if (_apply(prod, t.transactionId)) n++;
            try { if (t.purchaseToken) await NP().consumePurchase({ purchaseToken: t.purchaseToken }); } catch (e) {}
        }
    }
    return n;
}

/** Grant what a product gives. Consumables are credited once per transaction. */
function _apply(prod, txnId) {
    if (prod.kind === 'nonconsumable') return Unlocks.grant(prod.grants, 'iap');
    const seen = Storage.load(SEEN_KEY, []) || [];
    if (txnId && seen.includes(txnId)) return false;
    Wallet.earn(prod.tickets);
    if (txnId) Storage.save(SEEN_KEY, seen.concat(txnId).slice(-200));
    return true;
}
