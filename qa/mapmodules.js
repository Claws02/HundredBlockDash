// ============================================================
// MAP MODULES — the phase-0 refactor's safety net.
//
// BoardGraph.js exported one hardcoded City graph that six modules imported
// directly, and the renderer wrote City's ring and district arcs straight into
// its own module scope. Both are now data on a map module, reached through
// ActiveMap.js. This probe exists to prove that MOVING that data did not CHANGE
// it — the single risk of a refactor whose whole point is that nothing happens.
//
// The oracle is the PRE-REFACTOR source, transcribed below. If the layout ever
// legitimately changes, this file is where you say so on purpose.
//
// usage: node mapmodules.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';

const results = [];
const ok = (name, cond, detail) => { results.push({ name, pass: !!cond, detail }); };

// ---- the oracle: City Circuit's layout exactly as Renderer.js hardcoded it ----
// WHAT THIS USED TO CHECK, AND WHY IT NO LONGER CAN.
//
// There was an oracle here: a second, hand-written copy of City's geometry as
// BoardGraph.js hardcoded it, asserted equal to the renderer's output to within
// 1e-9 units. That was the right test for the job it was written for — proving
// that moving the geometry out of the renderer and into map data changed
// nothing — and it did that job.
//
// But it froze the board. Any change to City's shape failed it, and the failure
// said "drift" as though the map had broken rather than been edited. A test
// that can only ever be satisfied by never changing the thing it tests is not
// protecting the thing, it is preventing it.
//
// So the geometry checks below assert PROPERTIES instead: the ring is a circle,
// the districts are not, each district hangs off the ring near its own two
// junctions, and the four of them do not overlap. Those hold for the bullseye
// the board used to be and for the four lobes it is now — and they would still
// catch the failures that actually happen, which are a run of nodes stacked at
// the origin, a district laid out backwards, or an arc that has quietly lost
// its radius.

// Pool sizes as BoardGraph.js declared them, pre-refactor.
const EXPECTED_POOLS = { ring: 17, fin: 8, ba: 10, shop: 8, ind: 5 };

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
               '--enable-unsafe-swiftshader', '--mute-audio'],
    });
    const ctx  = await browser.newContext({ viewport: { width: 412, height: 892 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text()); });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });

    // ---- 1. registry ⇄ module parity --------------------------------------
    const parity = await page.evaluate(async () => {
        const { MAP_REGISTRY } = await import('/src/config/MapRegistry.js');
        const { MAPS }         = await import('/src/config/maps/index.js');
        return {
            available: MAP_REGISTRY.filter(m => m.available).map(m => m.id),
            missing:   MAP_REGISTRY.filter(m => m.available && !MAPS[m.id]).map(m => m.id),
            orphan:    Object.keys(MAPS).filter(id => !MAP_REGISTRY.some(m => m.id === id)),
            kinds:     Object.fromEntries(Object.entries(MAPS).map(([k, v]) => [k, v.kind])),
            // Every selectable map must name a length picker that exists in the
            // DOM — selectMap() now looks it up instead of branching on the id,
            // so a card that names nothing silently gets no picker at all.
            noPicker:  MAP_REGISTRY.filter(m => m.available && !m.lengthPicker).map(m => m.id),
            badPicker: MAP_REGISTRY.filter(m => m.lengthPicker && !document.getElementById(m.lengthPicker)).map(m => m.id),
        };
    });
    ok('every selectable map has a module', parity.missing.length === 0, JSON.stringify(parity.missing));
    ok('every module has a registry card',  parity.orphan.length === 0,  JSON.stringify(parity.orphan));
    ok('every selectable map names a length picker', parity.noPicker.length === 0, JSON.stringify(parity.noPicker));
    ok('every named length picker exists in the DOM', parity.badPicker.length === 0, JSON.stringify(parity.badPicker));
    ok('both maps declare a kind', parity.kinds.city_circuit === 'graph' && parity.kinds.hundred_block_dash === 'linear',
        JSON.stringify(parity.kinds));

    // ---- 2. the City data survived the move --------------------------------
    const city = await page.evaluate(async () => {
        const M = (await import('/src/config/maps/city_circuit.js')).default;
        return {
            nodes:      Object.keys(M.graph).length,
            junctions:  [...M.junctions].sort(),
            ordered:    M.ordered.length,
            orderedSet: M.ordered.length === new Set(M.ordered).size,
            poolSizes:  Object.fromEntries(Object.entries(M.pools).map(([k, v]) => [k, v.length])),
            branches:   Object.keys(M.branches).sort(),
            regionKeys: M.regionKeys,
            start:      M.start,
            gateNode:   M.gateNode,
            gateThresh: M.gateThreshold,
            // every ordered node must exist in the graph and not be a junction
            orphans:    M.ordered.filter(id => !M.graph[id] || M.graph[id].isJunction),
            // every `next` must point somewhere real
            dangling:   Object.values(M.graph).flatMap(n => (n.next || []).filter(x => !M.graph[x]).map(x => n.id + '->' + x)),
        };
    });
    ok('City graph still has 64 nodes', city.nodes === 64, `got ${city.nodes}`);
    ok('City still has 60 ordered playable nodes', city.ordered === 60, `got ${city.ordered}`);
    ok('ordered list has no duplicates', city.orderedSet);
    ok('no ordered node is a junction or missing', city.orphans.length === 0, JSON.stringify(city.orphans));
    ok('no edge points at a node that does not exist', city.dangling.length === 0, JSON.stringify(city.dangling));
    ok('the four junctions are intact',
        JSON.stringify(city.junctions) === JSON.stringify(['bp_a','bp_b','bp_c','bp_d']), JSON.stringify(city.junctions));
    ok('every junction has branch options',
        JSON.stringify(city.branches) === JSON.stringify(['bp_a','bp_b','bp_c','bp_d']), JSON.stringify(city.branches));
    ok('pool sizes unchanged', JSON.stringify(city.poolSizes) === JSON.stringify(EXPECTED_POOLS),
        JSON.stringify(city.poolSizes));
    ok('start square is r1', city.start === 'r1', city.start);
    ok('gate node is ind_0', city.gateNode === 'ind_0', String(city.gateNode));
    ok('City gate threshold is still 15', city.gateThresh === 15, String(city.gateThresh));

    // ---- 3. THE GEOMETRY IS A CITY SHAPE -----------------------------------
    const geo = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        // Positions are only written during Renderer.init(), which stands up the
        // whole scene. buildLayout() is that step on its own — without it this
        // probe read every node as (0,0), which is a 58-unit "drift" that says
        // nothing.
        R.buildLayout();
        const M = (await import('/src/config/maps/city_circuit.js')).default;
        const L = M.layout;
        const at = id => { const p = R.getPos(id); return { x: p.x, z: p.z, r: Math.hypot(p.x, p.z),
                                                           a: Math.atan2(-p.z, p.x) * 180 / Math.PI }; };
        const ringIds = L.ring.flatMap(run => run.slice(4));
        const out = {
            ring: ringIds.map(at),
            junctions: Object.keys(L.junctions).map(at),
            districts: L.arcs.map(run => ({
                key: run.ids[0].split('_')[0],
                pts: run.ids.map(at),
            })),
            allIds: [...M.ordered, ...M.junctions],
        };
        out.atOrigin = out.allIds.filter(id => { const p = R.getPos(id); return p.x === 0 && p.z === 0; });
        return out;
    });

    ok('no node sits at the origin', geo.atOrigin.length === 0, JSON.stringify(geo.atOrigin));

    // The ring road is the centre road: a circle, all of it the same distance out.
    const ringR = geo.ring.map(p => p.r);
    const ringSpread = Math.max(...ringR) - Math.min(...ringR);
    ok('the ring road is a circle', ringSpread < 1e-6,
        `radius varies by ${ringSpread.toFixed(4)} across ${ringR.length} nodes`);
    ok('the junctions sit on the ring',
        geo.junctions.every(j => Math.abs(j.r - ringR[0]) < 1e-6),
        JSON.stringify(geo.junctions.map(j => +j.r.toFixed(3))));

    // Every district is OUTSIDE the ring — nothing may cut through the middle.
    const inside = geo.districts.flatMap(d => d.pts.filter(p => p.r <= ringR[0]).map(() => d.key));
    ok('every district is outside the ring road', inside.length === 0, JSON.stringify(inside));

    // And every district BOWS: its middle is further out than its ends. This is
    // the difference between four lobes and four quadrants of one band, and it
    // is the thing that made the board read as a bullseye when it was missing.
    geo.districts.forEach(d => {
        const ends = Math.max(d.pts[0].r, d.pts[d.pts.length - 1].r);
        const mid  = d.pts[Math.floor(d.pts.length / 2)].r;
        ok(`${d.key} bows away from the ring rather than tracking it`, mid > ends + 5,
            `ends at ${ends.toFixed(1)}, middle at ${mid.toFixed(1)}`);
    });

    // The four of them occupy four separate wedges, with a gap between each.
    // Overlapping angular spans is what "quadrants of one band" looked like.
    const spans = geo.districts.map(d => {
        const angs = d.pts.map(p => p.a);
        return { key: d.key, lo: Math.min(...angs), hi: Math.max(...angs) };
    });
    // Normalise onto a line so neighbours can be compared without wrap-around
    // tripping the comparison at the -180/180 seam.
    const norm = spans.map(s => ({ ...s, lo: ((s.lo % 360) + 360) % 360, hi: ((s.hi % 360) + 360) % 360 }))
                      .filter(s => s.hi - s.lo < 180)
                      .sort((a, b) => a.lo - b.lo);
    let overlaps = [];
    for (let i = 1; i < norm.length; i++) {
        if (norm[i].lo < norm[i - 1].hi) overlaps.push(`${norm[i - 1].key}/${norm[i].key}`);
    }
    ok('the districts do not overlap each other', overlaps.length === 0, JSON.stringify(overlaps));
    ok('there is a gap between neighbouring districts',
        norm.length > 1 && norm.every((s, i) => i === 0 || s.lo - norm[i - 1].hi > 3),
        JSON.stringify(norm.map(s => `${s.key} ${s.lo.toFixed(0)}..${s.hi.toFixed(0)}`)));

    // ---- 4. ActiveMap answers the two questions correctly -------------------
    const am = await page.evaluate(async () => {
        const A = await import('/src/config/ActiveMap.js');
        const { state } = await import('/src/core/GameState.js');
        const read = () => ({
            kind: A.kind(), linear: A.isLinear(), graphNodes: Object.keys(A.graph()).length,
            ordered: A.ordered().length, bounties: A.has('bounties'), buddies: A.has('buddies'),
            realms: A.has('realms'), roundLimit: A.has('roundLimit'), finishBonus: A.has('finishBonus'),
            gate: A.gateThreshold(), start: A.startPos(),
            next_r5: A.nextNode('r5'),      // r5 -> bp_b (junction) -> r6
            bias: A.botBias().fin,
        });
        const prev = state.selectedMap;
        state.selectedMap = 'city_circuit';       const c = read();
        state.selectedMap = 'hundred_block_dash'; const h = read();
        state.selectedMap = 'nonexistent_map';    const f = read();
        state.selectedMap = prev;
        return { c, h, f };
    });
    ok('City reads as a graph board', am.c.kind === 'graph' && !am.c.linear && am.c.graphNodes === 64);
    ok('HBD reads as a linear board', am.h.kind === 'linear' && am.h.linear && am.h.graphNodes === 0);
    ok('HBD ordered() is empty, not null', am.h.ordered === 0);
    ok('features follow the map, not the id',
        am.c.bounties && am.c.buddies && am.c.roundLimit && !am.c.realms && !am.c.finishBonus &&
        !am.h.bounties && !am.h.buddies && !am.h.roundLimit && am.h.realms && am.h.finishBonus,
        JSON.stringify({ city: am.c, hbd: am.h }));
    ok('gate thresholds follow the map (City 15, Rift 20)', am.c.gate === 15 && am.h.gate === 20,
        `${am.c.gate} / ${am.h.gate}`);
    ok('start squares follow the map (r1 / 0)', am.c.start === 'r1' && am.h.start === 0,
        `${am.c.start} / ${am.h.start}`);
    ok('nextNode() steps THROUGH a junction', am.c.next_r5 === 'r6', String(am.c.next_r5));
    ok('bot bias comes off the map module', am.c.bias === 2, String(am.c.bias));
    ok('an unknown map id falls back rather than throwing', am.f.kind === 'graph', am.f.kind);

    // selectMap() drives the DOM — check the swap really happens both ways.
    const pick = await page.evaluate(async () => {
        const GC = await import('/src/core/GameController.js');
        const read = () => ['hbd-length-select', 'city-length-select']
            .map(id => getComputedStyle(document.getElementById(id)).display);
        GC.selectMap('hundred_block_dash'); const h = read();
        GC.selectMap('city_circuit');       const c = read();
        return { h, c };
    });
    ok('selecting HBD shows only the run-length picker',
        pick.h[0] === 'block' && pick.h[1] === 'none', JSON.stringify(pick.h));
    ok('selecting City shows only the round picker',
        pick.c[0] === 'none' && pick.c[1] === 'block', JSON.stringify(pick.c));

    ok('no page errors', errors.length === 0, errors.join(' | '));
    await browser.close();

    const failed = results.filter(r => !r.pass);
    results.forEach(r => console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? '  — ' + r.detail : ''}`));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
})();
