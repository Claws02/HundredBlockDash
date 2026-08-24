// ============================================================
// MAP MODULES — the code behind MapRegistry's cards.
//
// MapRegistry.js is the map-SELECT screen: name, icon, blurb, accent colour.
// This is the map itself: topology, pools, layout, and the feature flags that
// decide which systems a board runs. They are keyed by the same id, and
// qa/mapmodules.js asserts that every registry entry marked `available` has a
// module here — the same "every data row needs a live code path" rule that
// qa/verify.js already enforces for bounties.
// ============================================================

import city_circuit       from './city_circuit.js';
import star_territory     from './star_territory.js';
import hundred_block_dash from './hundred_block_dash.js';

export const MAPS = { city_circuit, hundred_block_dash, star_territory };
export const DEFAULT_MAP = 'city_circuit';
