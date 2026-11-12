// ============================================================
// NET GUARD — nothing from another phone is trusted until it has been here
// ============================================================
// Online play is phone to phone, and a room is open to anyone who has (or
// guesses) its four-letter code. So every message is treated as written by a
// stranger: it is checked for shape and scrubbed before any of it reaches
// `state` or the page.
//
// Three rules, applied at the one place bytes come in:
//
//   1. NAMES are the only free text a player types. They are reduced to plain
//      characters here, so no screen that prints one has to remember to.
//   2. STRINGS inside a snapshot or a mirrored scene can never carry markup:
//      angle brackets are swapped for look-alikes. Nothing the host sends is
//      HTML (payloads are ids, numbers and plain sentences), so this changes
//      nothing for an honest host and defuses a dishonest one.
//   3. SHAPE: sizes are capped, numbers must be finite, ids must look like ids.
//      A message that fails is dropped whole rather than half-applied.
//
// The page's Content-Security-Policy (index.html) is the second line behind
// this: even markup that slipped through could not run script.
// ============================================================

import { MAX_PLAYERS, MAX_INV, ITEMS, ALLIES, playableChar } from '../config/GameConfig.js';

export const NAME_MAX = 14;

const ID_RE = /^[A-Za-z0-9_:.\-]{1,64}$/;
const MAX_DEPTH = 8;
const MAX_KEYS = 600;         // a full board is ~130 squares
const MAX_STRING = 600;

/** A display name: printable, no markup characters, at most NAME_MAX long. */
export function cleanName(raw, fallback = '') {
    const s = String(raw == null ? '' : raw)
        .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g, '')
        .replace(/[<>&"'`\\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return [...s].slice(0, NAME_MAX).join('') || fallback;
}

export function isId(v) { return typeof v === 'string' && ID_RE.test(v); }

function _text(s) {
    return (s.length > MAX_STRING ? s.slice(0, MAX_STRING) : s).replace(/</g, '\u2039').replace(/>/g, '\u203a');
}

/**
 * A deep copy of `v` that is safe to hand to the game: plain JSON only, strings
 * de-fanged, sizes capped. Returns undefined for anything that is not data.
 */
export function scrub(v, depth = 0) {
    if (v === null) return null;
    switch (typeof v) {
        case 'string':  return _text(v);
        case 'number':  return Number.isFinite(v) ? v : 0;
        case 'boolean': return v;
        case 'object':  break;
        default:        return undefined;
    }
    if (depth >= MAX_DEPTH) return undefined;
    if (Array.isArray(v)) {
        return v.slice(0, MAX_KEYS).map(x => { const c = scrub(x, depth + 1); return c === undefined ? null : c; });
    }
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
        if (++n > MAX_KEYS) break;
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        const c = scrub(v[k], depth + 1);
        if (c !== undefined) out[_text(k)] = c;
    }
    return out;
}

/** The lobby roster a host sent. Null when it is not a roster at all. */
export function cleanRoster(seats) {
    if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_PLAYERS) return null;
    const out = [];
    for (const r of seats) {
        if (!r || typeof r !== 'object' || !isId(r.peerId)) return null;
        out.push({
            peerId: r.peerId,
            name: cleanName(r.name, `Player ${out.length + 1}`),
            char: r.char == null ? null : (isId(r.char) ? playableChar(r.char) : null),
            ready: !!r.ready, connected: r.connected !== false, bot: !!r.bot,
        });
    }
    return out;
}

const _int = (v, lo, hi, d = 0) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.trunc(v))) : d);

/** A snapshot from the host, checked and scrubbed. Null when it must be ignored. */
export function cleanSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.p)) return null;
    if (raw.p.length < 1 || raw.p.length > MAX_PLAYERS) return null;
    const s = scrub(raw);
    if (!s || !Array.isArray(s.p)) return null;

    if (typeof s.gs !== 'string') return null;
    s.ap = _int(s.ap, 0, s.p.length - 1);
    if (!s.board || typeof s.board !== 'object' || Array.isArray(s.board)) s.board = {};
    for (const id of Object.keys(s.board)) {
        const v = s.board[id];
        const type = Array.isArray(v) ? v[0] : v;
        if (!isId(id) || !isId(String(type))) delete s.board[id];
    }
    if (!Array.isArray(s.bounties)) s.bounties = [];
    s.bounties = s.bounties.filter(b => b && typeof b === 'object' && (isId(b.id) || Number.isFinite(b.id)))
        .map(b => ({ id: b.id, prog: Array.isArray(b.prog) ? b.prog.slice(0, MAX_PLAYERS) : [] }));
    if (!Array.isArray(s.hist)) s.hist = [];
    if (!Array.isArray(s.ov)) s.ov = [];
    s.ov = s.ov.filter(isId);
    if (s.buddy && (typeof s.buddy !== 'object' || Array.isArray(s.buddy))) s.buddy = null;

    for (let i = 0; i < s.p.length; i++) {
        const p = s.p[i];
        if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
        p.id = _int(p.id, 0, s.p.length - 1, i);
        p.name = cleanName(raw.p[i] && raw.p[i].name, `Player ${i + 1}`);
        p.char = isId(p.char) ? playableChar(p.char) : playableChar(null);
        p.inv = (Array.isArray(p.inv) ? p.inv : []).filter(it => typeof it === 'string' && Object.prototype.hasOwnProperty.call(ITEMS, it)).slice(0, MAX_INV + 1);
        p.allies = (Array.isArray(p.allies) ? p.allies : [])
            .filter(a => a && typeof a === 'object' && typeof a.type === 'string' && Object.prototype.hasOwnProperty.call(ALLIES, a.type))
            .slice(0, 8);
        if (!p.districts || typeof p.districts !== 'object' || Array.isArray(p.districts)) p.districts = {};
    }
    return s;
}
