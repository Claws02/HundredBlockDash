// ============================================================
// MATCH SAVE — a local match survives the app being closed.
// ============================================================
//
// A phone OS reclaims a backgrounded app whenever it likes; iOS does it within
// minutes under memory pressure. The match lived only in memory, so every one of
// those was a lost game — the most common reason people give a turn-based
// mobile game one star (RELEASE_AUDIT RA-04).
//
// The save point is the top of a turn (proceedTurn): the one moment when no
// scene, hop, modal or minigame is in flight and the whole match is plain data
// in `state`. What is not data — the 3D figures — is rebuilt from it on resume.
//
// Online matches are never saved: a replica cannot resume a room that is gone.
// ============================================================

import { state } from './GameState.js';
import * as Storage from './Storage.js';

const KEY = 'saved_match';
const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;   // a week-old match is not one anybody is coming back to

// Keys that are runtime handles, not match data.
const SKIP = new Set(['mesh', 'minigameTimeout', 'allyMesh', 'meshes']);

function _replacer(k, v) {
    if (SKIP.has(k)) return undefined;
    if (v && typeof v === 'object' && (v.isObject3D || v.isMaterial || v.isBufferGeometry || v instanceof Node)) return undefined;
    if (v instanceof Set) return { __set: [...v] };
    if (v instanceof Map) return { __map: [...v] };
    return v;
}
function _reviver(k, v) {
    if (v && typeof v === 'object' && Array.isArray(v.__set)) return new Set(v.__set);
    if (v && typeof v === 'object' && Array.isArray(v.__map)) return new Map(v.__map);
    return v;
}

function _online() { return state.playStyle === 'online' || typeof state.localSeat === 'number' || !!state.netReplica; }

/** Save the match as it stands. `extra` is the controller's own turn memory. */
export function save(extra = {}) {
    if (_online() || !state.gameStarted) return false;
    try {
        const blob = JSON.stringify({ v: VERSION, at: Date.now(), extra, state }, _replacer);
        return Storage.save(KEY, blob);
    } catch (e) {
        console.warn('[MatchSave] could not save:', e);
        return false;
    }
}

/** The saved match, or null. Never throws. */
export function load() {
    try {
        const blob = Storage.load(KEY, null);
        if (!blob || typeof blob !== 'string') return null;
        const snap = JSON.parse(blob, _reviver);
        if (!snap || snap.v !== VERSION || !snap.state || !Array.isArray(snap.state.players)) return null;
        if (Date.now() - (snap.at || 0) > MAX_AGE_MS) { clear(); return null; }
        return snap;
    } catch (e) {
        return null;
    }
}

export function has() { return !!load(); }
export function clear() { try { Storage.remove(KEY); } catch (e) {} }

/** A line for the splash button: "City Circuit · round 4 of 12". */
export function describe(snap = load()) {
    if (!snap) return '';
    const s = snap.state;
    const map = { city_circuit: 'City Circuit', hundred_block_dash: 'Hundred Block Dash', star_territory: 'Star Territory' }[s.selectedMap] || 'Match';
    const where = s.selectedMap === 'hundred_block_dash'
        ? `turn ${s.totalTurns || 1}`
        : `round ${Math.max(1, s.currentRound || 1)}${s.cityRounds ? ` of ${s.cityRounds}` : ''}`;
    return `${map} · ${where}`;
}
