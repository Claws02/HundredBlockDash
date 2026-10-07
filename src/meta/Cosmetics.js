// ============================================================
// COSMETICS — the looks a device can own, and which seat wears what.
// ============================================================
//
// Pure data and bookkeeping. The 3D side (hats, finishes, dice, trails) lives
// in src/engine/CosmeticsFx.js and reads only the ids defined here.
//
// Five slots. Finishes change the SURFACE, never the hue: the seat colour is
// how every HUD bar, ring and chart tells players apart, so a cosmetic must
// not be able to make two players look alike.
//
// Loadouts are per seat on this device (pass-and-play shares one phone, and
// every human at it should be able to dress up). Online, a device only sends
// its seat-0 loadout: that is "my look". Bots wear nothing.
// ============================================================

import * as Storage from '../core/Storage.js';
import * as Unlocks from './Unlocks.js';
import { registerCosmeticPricing } from './Catalog.js';

export const SLOTS = {
    finish: { name: 'FINISH',  icon: '✨', none: 'glossy' },
    hat:    { name: 'HAT',     icon: '🎩', none: 'none' },
    dice:   { name: 'DICE',    icon: '🎲', none: 'classic' },
    trail:  { name: 'TRAIL',   icon: '💫', none: 'none' },
    emote:  { name: 'VICTORY', icon: '🏆', none: 'none' },
};

// `tickets: 0` is a default every device owns. `supporter: true` is granted by
// the Everything bundle instead of being sold.
export const COSMETICS = [
    // Finishes
    { id: 'glossy',    slot: 'finish', name: 'Glossy',     icon: '🟣', tickets: 0 },
    { id: 'matte',     slot: 'finish', name: 'Matte',      icon: '🟤', tickets: 150 },
    { id: 'metallic',  slot: 'finish', name: 'Metallic',   icon: '⚙️', tickets: 300 },
    { id: 'pearl',     slot: 'finish', name: 'Pearl',      icon: '🫧', tickets: 400 },
    { id: 'neon',      slot: 'finish', name: 'Neon Glow',  icon: '💡', tickets: 500 },
    { id: 'gilded',    slot: 'finish', name: 'Gilded',     icon: '🪙', tickets: 800 },
    // Hats & accessories
    { id: 'none',      slot: 'hat',    name: 'No hat',     icon: '🚫', tickets: 0 },
    { id: 'party',     slot: 'hat',    name: 'Party Hat',  icon: '🥳', tickets: 150 },
    { id: 'beanie',    slot: 'hat',    name: 'Beanie',     icon: '🧶', tickets: 200 },
    { id: 'shades',    slot: 'hat',    name: 'Shades',     icon: '🕶️', tickets: 250 },
    { id: 'cowboy',    slot: 'hat',    name: 'Stetson',    icon: '🤠', tickets: 300 },
    { id: 'chef',      slot: 'hat',    name: 'Chef Hat',   icon: '👨‍🍳', tickets: 300 },
    { id: 'tophat',    slot: 'hat',    name: 'Top Hat',    icon: '🎩', tickets: 400 },
    { id: 'viking',    slot: 'hat',    name: 'Viking',     icon: '🪖', tickets: 500 },
    { id: 'propeller', slot: 'hat',    name: 'Propeller',  icon: '🚁', tickets: 500 },
    { id: 'halo',      slot: 'hat',    name: 'Halo',       icon: '😇', tickets: 600 },
    { id: 'crown',     slot: 'hat',    name: 'Supporter Crown', icon: '👑', tickets: null, supporter: true },
    // Dice
    { id: 'classic',   slot: 'dice',   name: 'Classic',    icon: '🎲', tickets: 0 },
    { id: 'midnight',  slot: 'dice',   name: 'Midnight',   icon: '⬛', tickets: 200 },
    { id: 'ruby',      slot: 'dice',   name: 'Ruby',       icon: '🟥', tickets: 300 },
    { id: 'ocean',     slot: 'dice',   name: 'Ocean',      icon: '🟦', tickets: 300 },
    { id: 'wood',      slot: 'dice',   name: 'Oak',        icon: '🟫', tickets: 300 },
    { id: 'neon',      slot: 'dice',   name: 'Neon',       icon: '🟩', tickets: 500 },
    { id: 'gold',      slot: 'dice',   name: 'Solid Gold', icon: '🟨', tickets: 1000 },
    // Trails (a puff where you land, every hop)
    { id: 'none',      slot: 'trail',  name: 'No trail',   icon: '🚫', tickets: 0 },
    { id: 'sparkle',   slot: 'trail',  name: 'Sparkle',    icon: '✨', tickets: 300 },
    { id: 'hearts',    slot: 'trail',  name: 'Hearts',     icon: '💖', tickets: 300 },
    { id: 'bubbles',   slot: 'trail',  name: 'Bubbles',    icon: '🫧', tickets: 300 },
    { id: 'confetti',  slot: 'trail',  name: 'Confetti',   icon: '🎊', tickets: 400 },
    { id: 'flames',    slot: 'trail',  name: 'Flames',     icon: '🔥', tickets: 500 },
    // Victory emotes (the win screen, when you win)
    { id: 'none',      slot: 'emote',  name: 'Confetti',   icon: '🎉', tickets: 0 },
    { id: 'dance',     slot: 'emote',  name: 'Victory Dance', icon: '💃', tickets: 300 },
    { id: 'trumpet',   slot: 'emote',  name: 'Fanfare',    icon: '🎺', tickets: 300 },
    { id: 'rainbow',   slot: 'emote',  name: 'Rainbow',    icon: '🌈', tickets: 400 },
    { id: 'fireworks', slot: 'emote',  name: 'Fireworks',  icon: '🎆', tickets: 500 },
    { id: 'micdrop',   slot: 'emote',  name: 'Mic Drop',   icon: '🎤', tickets: 600 },
];

/** Entitlement key for a cosmetic. Ids repeat across slots ('none', 'neon'), so the slot is part of it. */
export const keyOf = c => `cos:${c.slot}.${c.id}`;

export function find(slot, id) { return COSMETICS.find(c => c.slot === slot && c.id === id) || null; }
export function inSlot(slot)   { return COSMETICS.filter(c => c.slot === slot); }

registerCosmeticPricing(id => {
    const [slot, cid] = id.split('.');
    const c = find(slot, cid);
    return c && c.tickets > 0 ? c.tickets : null;
});

/** Does this device own the cosmetic? Defaults are owned; the crown comes with the bundle. */
export function owned(c) {
    if (!c) return false;
    if (c.tickets === 0) return true;
    if (c.supporter) return Unlocks.has('badge:supporter');
    return Unlocks.has(keyOf(c));
}

// ---- Loadouts ---------------------------------------------------------------

const KEY = 'meta_loadout';
const SEATS = 4;

function _blank() {
    const o = {};
    for (const [slot, s] of Object.entries(SLOTS)) o[slot] = s.none;
    return o;
}

let _lo = null;
function _load() {
    if (_lo) return _lo;
    const raw = Storage.load(KEY, null);
    _lo = Array.from({ length: SEATS }, (_, i) => ({ ..._blank(), ...((Array.isArray(raw) && raw[i]) || {}) }));
    return _lo;
}

/**
 * The look a seat on this device wears. Anything no longer owned (a reset, a
 * refunded bundle) silently falls back to the default, so a loadout can never
 * show something the device does not have.
 */
export function lookFor(seat = 0) {
    const lo = _load()[seat] || _blank();
    const out = {};
    for (const [slot, s] of Object.entries(SLOTS)) {
        const c = find(slot, lo[slot]);
        out[slot] = c && owned(c) ? c.id : s.none;
    }
    return out;
}

export function equip(seat, slot, id) {
    const c = find(slot, id);
    if (!c || !owned(c)) return false;
    _load()[seat][slot] = id;
    Storage.save(KEY, _lo);
    return true;
}

/**
 * Clean a look that arrived from somewhere else (another phone, a saved match):
 * only known ids survive. Never trust a peer's object as-is.
 */
export function sanitize(look) {
    const out = _blank();
    if (!look || typeof look !== 'object') return out;
    for (const slot of Object.keys(SLOTS)) {
        if (typeof look[slot] === 'string' && find(slot, look[slot])) out[slot] = look[slot];
    }
    return out;
}
