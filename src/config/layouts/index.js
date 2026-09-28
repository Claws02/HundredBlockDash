// ============================================================
// MAP LAYOUTS — where each building and landmark stands
// ============================================================
//
// A layout replaces a board's automatic plot placement with a hand-made one:
// every item names a model from CityKit.MODELS, the seed that picks its
// variant, and its position, facing and size. Layouts are made in the map
// editor (docs/LAYOUTS.md; the editor is its own repo,
// https://github.com/Claws02/hundredblockdash-map-editor) and written here by scripts/apply-layout.js;
// don't hand-edit the generated files.
//
// A map with no entry here keeps its automatic placement. `?nolayout` in the
// URL forces automatic placement too, which is how the first layout was
// exported (the editor repo's scripts/export-reference.js).
// ============================================================

import city_circuit from './city_circuit.js';

export const LAYOUTS = { city_circuit };

export function layoutFor(mapId) {
    try { if (new URLSearchParams(location.search).has('nolayout')) return null; } catch (e) {}
    return LAYOUTS[mapId] || null;
}
