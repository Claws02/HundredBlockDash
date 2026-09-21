// ============================================================
// THE SHERIFF'S STAR — Star Territory's scoring system
// ============================================================
//
// On City Circuit and Hundred Block Dash, coins ARE the score, so spending them
// is a trade against winning. On Star Territory coins are only currency: the
// score is Stars, and a Star is bought with a bond posted at a Territory
// Office. That one change is what the whole board is built around.
//
// THE FOUR LEVERS (spec §4.3), each answering the two-player problem from a
// different side and each legible on its own:
//
//   dispatch away from the buyer   "whoever is closer just wins forever"
//   escalating price               "whoever gets the first Star snowballs"
//   Shards from minigames + duels  "I'm behind on coins with no path"
//   pass-through purchase          "one pip on a die decided the match"
//
// THE RULES, in the order they matter:
//
//   1. ONE Star is live at a time, at one of the four Offices, and its location
//      is NEVER hidden. HUD, map view, round report, briefing.
//   2. PASSING the Office is enough. You do not have to land on it.
//   3. Buying is a CHOICE. Reaching it with the money raises BUY / RIDE ON.
//   4. Price is 20 + 5 x Stars held — a visible handicap on the leader,
//      expressed as a number they can plan around rather than as hidden
//      rubber-banding.
//   5. On purchase the Star is dispatched to the Office FARTHEST from the
//      buyer. Never the same one, never one behind a closed Gate, and never
//      into a rival's lap if there is any alternative.
//   6. Cannot afford it? Nothing happens and nothing is refunded. The trip was
//      the gamble.
//   7. Win a round minigame or a duel -> +1 Shard. Four Shards redeem into a
//      Star for free, wherever you are.
//   8. STARS CAN NEVER BE TAKEN. Shards can — a duel may be staked with one.
//      Stars are the record of what you did; the Shard is where the risk lives.
//
// This module owns the rules and the arithmetic and nothing else: no DOM, no
// meshes, no turn flow. GameController drives it, Renderer draws where it says
// the Star is, and everything reaches the per-map constants through ActiveMap
// so no other board has to know this file exists.
// ============================================================

import { state } from './GameState.js';
import * as ActiveMap from '../config/ActiveMap.js';

/** Is the Star system running on this board at all? */
export function enabled() { return ActiveMap.has('stars') && !!ActiveMap.stars(); }

export function config() { return ActiveMap.stars() || {}; }

/** What the next Star costs this player: 20 / 25 / 30 / 35. */
export function priceFor(p) {
    const c = config();
    return (c.priceBase ?? 20) + (c.priceStep ?? 5) * (p?.stars || 0);
}

export function shardsPerStar() { return config().shardsPerStar ?? 4; }

/** Where the live Star is standing, or null. */
export function liveNode() { return enabled() ? state.starNode : null; }

/** Is this node an Office? */
export function isOffice(nodeId) { return config().plinths?.includes(nodeId) || false; }

/** Is this node the Office currently holding the Star? */
export function isLiveOffice(nodeId) {
    return !!nodeId && enabled() && state.starNode === nodeId;
}

/**
 * Is this Office shut off by a Gate that has not been broken?
 *
 * The Cinder Mine holds one of the four Offices, so while the rockslide stands
 * only three are in rotation. Breaking the Gate opens a fourth destination for
 * the rest of the match — which is why THIS board's Gate is worth score and
 * City's is only worth coins.
 */
export function isLocked(nodeId) {
    if (state.gateOpen) return false;
    return (config().lockedBehindGate || []).includes(nodeId);
}

/** Every Office the Star could currently be dispatched to. */
export function openOffices() {
    return (config().plinths || []).filter(id => !isLocked(id));
}

// ---- Distance on the real board ----------------------------------------
//
// BOARD STEPS, not lap-order index difference and not straight-line units.
// A junction is not a landable square, so stepping through one is free; the
// distances the whole design hangs on (15 / 18 / 21 between Offices) only come
// out right when junctions cost nothing.
//
// Dijkstra rather than a plain BFS for exactly that reason: with zero-weight
// edges in the graph, a breadth-first frontier can reach a node by a longer
// route first and never correct itself.
export function boardSteps(fromId, toId) {
    const G = ActiveMap.graph();
    if (!G[fromId] || !G[toId]) return Infinity;
    const dist = { [fromId]: 0 };
    const queue = [fromId];
    while (queue.length) {
        const u = queue.shift();
        for (const v of (G[u].next || [])) {
            const w = ActiveMap.isJunction(v) ? 0 : 1;
            if (dist[v] === undefined || dist[v] > dist[u] + w) {
                dist[v] = dist[u] + w;
                queue.push(v);
            }
        }
    }
    return dist[toId] ?? Infinity;
}

/**
 * How far the live Star is from a player, in board steps. Infinity when there
 * is no Star or no route — the HUD prints a dash rather than a number.
 */
export function stepsToStar(p) {
    const at = liveNode();
    if (!at || !p) return Infinity;
    return boardSteps(p.pos, at);
}

// ---- Dispatch ----------------------------------------------------------

/**
 * Where the Star goes after `buyer` posts their bond.
 *
 * The board is a DIRECTED cycle, so these distances are asymmetric — rail_6 to
 * mine_6 is 15 steps and mine_6 to rail_6 is 21 — which is what makes "the
 * Office farthest from the buyer" a well-defined and always-distinct target,
 * and why the rule needs no tie-breaking in the ordinary case.
 *
 * Three exclusions, in order of how much they matter:
 *   - never the Office just bought from (rule 5),
 *   - never one behind a closed Gate (nobody can reach it),
 *   - never one a RIVAL is standing on, because a purchase must not gift the
 *     Star to the other player. If that rules out everything, the rival's
 *     Office is taken anyway — a Star that exists nowhere would be worse.
 */
export function dispatchTarget(buyer, fromNode) {
    const rivals = new Set(state.players.filter(q => q !== buyer).map(q => q.pos));
    const all = openOffices().filter(id => id !== fromNode);
    if (!all.length) return null;
    const byDistance = all
        .map(id => ({ id, d: boardSteps(buyer.pos, id) }))
        .sort((a, b) => (b.d - a.d) || (a.id < b.id ? -1 : 1));
    const clear = byDistance.filter(o => !rivals.has(o.id));
    return (clear[0] || byDistance[0]).id;
}

/**
 * Open the board with one Star already live, at the Office NEAREST the start.
 *
 * Deliberately the nearest and not the farthest. Everybody starts on the same
 * square, so "nearest" is the same distance for every seat and therefore fair;
 * and the first chase being the short one (nine spaces, under three turns) is
 * how the board teaches its own rule before the stakes are real. Every dispatch
 * after this one is the farthest, which is the rule that does the work.
 */
export function initStars() {
    if (!enabled()) { state.starNode = null; return; }
    const start = ActiveMap.startPos();
    const offices = openOffices();
    if (!offices.length) { state.starNode = null; return; }
    state.starNode = offices
        .map(id => ({ id, d: boardSteps(start, id) }))
        .sort((a, b) => (a.d - b.d) || (a.id < b.id ? -1 : 1))[0].id;
    state.starInFlight = null;
}

/**
 * The Gate has just been broken, so the Mine's Office joins the rotation.
 *
 * Nothing moves: the live Star stays where it is. All that changes is that the
 * next dispatch has a fourth place to go — which is the whole reward, and is
 * worth saying out loud rather than silently widening a list.
 */
export function officesOpenedByGate() {
    if (!enabled()) return [];
    return (config().lockedBehindGate || []).filter(id => !isLocked(id));
}

// ---- Buying ------------------------------------------------------------

/** Can this player post the bond where they are standing right now? */
export function canBuyAt(p, nodeId) {
    return enabled() && isLiveOffice(nodeId) && p.coins >= priceFor(p);
}

/**
 * Post the bond and take the Star.
 *
 * STATE IS APPLIED BEFORE THE ANIMATION STARTS, per TURN_FLOW.md §7: the set
 * piece is 4.4 seconds long and an interrupted one must never cost anybody a
 * Star. The caller gets back everything the cinematic and the cards need, so
 * nothing downstream has to re-derive a number that has already moved.
 */
export function buy(p, nodeId) {
    const price = priceFor(p);
    const to = dispatchTarget(p, nodeId);
    p.coins -= price;
    p.stars += 1;
    p.starsBought += 1;
    state.starNode = to;
    return { price, from: nodeId, to, stars: p.stars };
}

// ---- Shards — the second lane ------------------------------------------

/**
 * Award a Shard, redeeming four of them into a Star if that completes a set.
 *
 * Returns what happened so the caller can pick the right beat: a Shard is a
 * toast, a redemption is a set piece.
 */
export function grantShard(p, reason) {
    if (!enabled() || !p) return { granted: false, redeemed: false };
    p.shards = (p.shards || 0) + 1;
    const need = shardsPerStar();
    if (p.shards < need) return { granted: true, redeemed: false, shards: p.shards, reason };
    p.shards -= need;
    p.stars += 1;
    p.shardStars += 1;
    return { granted: true, redeemed: true, shards: p.shards, stars: p.stars, reason };
}

/**
 * Take a Shard off a player — the one thing a duel can stake on this board
 * that is not coins. Stars themselves are never at risk.
 */
export function takeShard(from, to) {
    if (!enabled() || !from || (from.shards || 0) <= 0) return false;
    from.shards -= 1;
    if (to) {
        const r = grantShard(to, 'duel_stake');
        return r.granted;
    }
    return true;
}

/** Can this player put a Shard up instead of coins? */
export function canStakeShard(p) { return enabled() && (p?.shards || 0) > 0; }

// ---- Readouts ----------------------------------------------------------

/** The line the HUD, the map view and the round report all print. */
export function statusLine() {
    if (!enabled()) return '';
    const at = liveNode();
    if (!at) return '⭐ No Star in the Territory';
    const region = ActiveMap.regionName(ActiveMap.regionOf(at));
    return `⭐ The Star is at the ${region} Office`;
}

/** Who is winning, as a sentence — used by the round report and the briefing. */
export function standings() {
    return state.players
        .map(p => ({ id: p.id, name: p.name, stars: p.stars || 0, shards: p.shards || 0, coins: p.coins }))
        .sort((a, b) => (b.stars - a.stars) || (b.coins - a.coins) || (a.id - b.id));
}
