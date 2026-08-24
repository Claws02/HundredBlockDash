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
function expectedCityPositions() {
    const R = 32, DR = 58, out = {};
    const arc = (a, b, n, r) => {
        const pts = [];
        for (let i = 1; i <= n; i++) {
            const t = i / (n + 1), deg = a + (b - a) * t, rad = deg * Math.PI / 180;
            pts.push([r * Math.cos(rad), -r * Math.sin(rad)]);
        }
        return pts;
    };
    out.bp_a = [0, -R]; out.bp_b = [R, 0]; out.bp_c = [0, R]; out.bp_d = [-R, 0];
    const put = (ids, pts) => ids.forEach((id, i) => { out[id] = pts[i]; });
    put(['r1','r2','r3','r4','r5'],      arc(90, 0, 5, R));
    put(['r6','r7','r8','r9','r10'],     arc(0, -90, 5, R));
    put(['r11','r12','r13','r14','r15'], arc(-90, -180, 5, R));
    put(['r16','r17','r18','r19','r20'], arc(180, 90, 5, R));
    put(['fin_0','fin_1','fin_2','fin_3','fin_4','fin_5','fin_6','fin_7','fin_8','fin_9'], arc(90, 0, 10, DR));
    put(['ba_0','ba_1','ba_2','ba_3','ba_4','ba_5','ba_6','ba_7','ba_8','ba_9','ba_10','ba_11'], arc(0, -90, 12, DR));
    put(['shop_0','shop_1','shop_2','shop_3','shop_4','shop_5','shop_6','shop_7','shop_8','shop_9'], arc(-90, -180, 10, DR));
    put(['ind_0','ind_1','ind_2','ind_3','ind_4','ind_5','ind_6','ind_7'], arc(180, 90, 8, DR));
    return out;
}
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

    // ---- 3. THE ONE THAT MATTERS: geometry is bit-identical ----------------
    const got = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        // Positions are only written during Renderer.init(), which stands up the
        // whole scene. buildLayout() is that step on its own — without it this
        // probe compared the oracle against an empty map and every node read
        // (0,0), which is a 58-unit "drift" that says nothing.
        R.buildLayout();
        const M = (await import('/src/config/maps/city_circuit.js')).default;
        const ids = [...M.ordered, ...M.junctions];
        const out = {};
        for (const id of ids) { const p = R.getPos(id); out[id] = [p.x, p.z]; }
        return out;
    });
    const want = expectedCityPositions();
    let worst = 0, worstId = null, missing = [];
    for (const id of Object.keys(want)) {
        // getPos() returns a zero vector for an unknown node, so "it returned
        // something" is not evidence. Only a node genuinely AT the origin could
        // be a false positive here, and City has none.
        if (!got[id] || (got[id][0] === 0 && got[id][1] === 0)) { missing.push(id); continue; }
        const d = Math.hypot(got[id][0] - want[id][0], got[id][1] - want[id][1]);
        if (d > worst) { worst = d; worstId = id; }
    }
    ok('every pre-refactor node id has a real (non-origin) position', missing.length === 0, JSON.stringify(missing));
    ok('layout is identical to the hardcoded original (<1e-9 u)', worst < 1e-9,
        `worst drift ${worst.toExponential(2)} at ${worstId}`);

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
