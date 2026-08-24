// ============================================================
// ACTIVE MAP — the one place that answers "which board is this?"
//
// Before this, the answer was 47 copies of
//     state.selectedMap === 'hundred_block_dash'
// spread over seven modules, with `else` silently meaning City Circuit. That
// made a third board impossible to add without auditing every one of them to
// work out which were really asking "is this linear?", which meant "does this
// board have bounties?", and which meant "is this specifically HBD?".
//
// Two rules for call sites:
//
//   1. If the check is about HOW THE BOARD IS SHAPED — numeric positions, a
//      generated layout, no junctions — ask isLinear() / isGraph().
//   2. If the check is about WHETHER A SYSTEM RUNS — bounties, buddies, HQ
//      bonuses, a finish bonus — ask has('feature'). Never compare ids.
//
// Comparing against a literal map id is reserved for things that really are
// about one specific board and nothing else.
// ============================================================

import { state } from '../core/GameState.js';
import { MAPS, DEFAULT_MAP } from './maps/index.js';

export function def(id) { return MAPS[id] || MAPS[DEFAULT_MAP]; }
export function active() { return def(state.selectedMap); }

export function id()       { return active().id; }
export function kind()     { return active().kind; }
export function isLinear() { return active().kind === 'linear'; }
export function isGraph()  { return active().kind === 'graph'; }
export function has(feature) { return !!active().features[feature]; }

export function graph()       { return active().graph || {}; }
export function pools()       { return active().pools || {}; }
export function junctions()   { return active().junctions; }
export function branches()    { return active().branches; }
export function regionKeys()  { return active().regionKeys; }

// The "everyone uses it" road — City's ring, Star Territory's hub. Scenery
// treats it differently (lamps on both sides, dressing pushed further back,
// buildings facing inward), and that used to be the literal string 'ring'
// compared in four places in the renderer.
export function hubKey()      { return active().hubKey; }
export function isHubRegion(k){ return k === active().hubKey; }
export function regionNames() { return active().regionNames; }
export function botBias()     { return active().botBias; }
export function layout()      { return active().layout; }
export function startPos()    { return active().start; }
export function gateNode()    { return active().gateNode; }

// The Rift is the harder wall (20): it gates the run to the Crown and a player
// who cannot break it loses real ground. City's Gate only guards one district
// on a lap map, so it stays at 15. This used to be a function in GameConfig
// that switched on the map id — the last piece of per-map tuning that lived
// outside the map.
export function gateThreshold() { return active().gateThreshold; }

// What the map view calls this board and the two ends of its track.
export function mapLabels() {
    return active().mapLabels || { title: 'MAP', start: 'START', middle: '', end: 'END' };
}

// The lap/track order. On a graph board this is the authored node order that
// drives the camera curve, the map slider and lap progress. A linear board has
// no such list — positions there are numbers — so this returns an EMPTY ARRAY
// rather than null: several callers do `.indexOf(pos)` or read `.length`
// without branching first, and on a linear board those should come back -1 and
// 0 rather than throwing. The guard is deliberate, not defensive habit.
export function ordered() { return active().ordered || []; }

// ---- graph walking, shared by everything that traces the track ----
// The rule that a junction is never a landable position was open-coded in four
// places — Renderer (three) and Bot — each writing its own "step to next, and
// if that is a junction, step again". They all call this now.
//
// UIManager._anchorNode deliberately does NOT: it walks a road and STOPS at a
// junction rather than through it, because it is placing a signpost on one road
// rather than tracing a route. Same three lines, different rule — worth leaving
// apart rather than forcing into a shared helper with a flag.
export function nextNode(nodeId, branchIdx = 0) {
    const g = graph();
    let n = g[nodeId]?.next?.[branchIdx] ?? g[nodeId]?.next?.[0];
    if (n && junctions().has(n)) n = g[n]?.next?.[0];
    return n;
}

export function isJunction(nodeId) { return junctions().has(nodeId); }

export function regionOf(nodeId) { return graph()[nodeId]?.district; }

export function regionName(key) {
    return regionNames()[key] || key;
}

// Nodes belonging to one region, in track order.
export function nodesInRegion(key) {
    return ordered().filter(nid => graph()[nid]?.district === key);
}
