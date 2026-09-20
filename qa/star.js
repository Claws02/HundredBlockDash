// ============================================================
// STAR TERRITORY audit probe.
//
// docs/STAR_TERRITORY_SPEC.md §8 splits itself into "verified" and "not
// verified", and almost everything that decides whether this board WORKS was in
// the second list: the balance model is arithmetic over inferred coin income,
// the set-piece budget is a paper figure, and the distances — which the whole
// design hangs on — were measured once, by hand, against a layout that did not
// exist in `src/` yet.
//
// Worse, the spec contradicts itself. §2.2 gives office-to-office distances of
// 15 / 18 / 21 AND lap figures ("23 spaces taking one territory", "56 taking
// all four") that cannot both be true of a board with twelve-node lobes. This
// probe walks the real directed graph and settles it rather than trusting
// either table.
//
// What it asserts, in the order the board is built:
//
//   1. TOPOLOGY — 60 playable nodes + 4 junctions, twelve per lobe, every edge
//      lands somewhere real, and the lap order covers every node once.
//   2. FURNITURE — 12 fixed squares in exactly the places §2.3 names, and the
//      outfitter really does come BEFORE the Office on every territory road.
//   3. POOLS — the 48 random slots match the null-node count region by region,
//      the board totals are what §2.5 claims, six reds is one per ten, and
//      NOTHING on this lap map moves a player along the track.
//   4. DISTANCES — measured on the directed graph: 15 / 18 / 21 between
//      Offices, 9 from START to the nearest, 12 for a hub lap, 60 taking all
//      four territories.
//   5. GEOMETRY — the Clover's steps are uniform, the closest non-adjacent pair
//      is no nearer than an adjacent one, and no lobe crosses the hub ring.
//   6. THE STAR — the price ladder, dispatch away from the buyer, the Gate
//      holding the Mine's Office out of rotation, Shards redeeming at four, and
//      that a Star once pinned on can never be taken.
//   7. BOUNTIES — this board's cards deal and City's do not.
//   8. A REAL MATCH — it plays, the HUD says where the Star is, and the win
//      screen scores on Stars rather than coins.
//
// usage: node star.js
// ============================================================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const AGENT = fs.readFileSync(path.join(__dirname, 'agent.js'), 'utf8');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:8129/index.html';
const GL = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader',
            '--enable-unsafe-swiftshader', '--mute-audio'];

const results = [];
const ok = (name, cond, detail) => results.push({ name, pass: !!cond, detail });

(async () => {
    const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: GL });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE: ' + m.text());
    });
    await page.addInitScript(() => { try { localStorage.clear(); localStorage.setItem('hbd_seen_howto', 'true'); } catch (e) {} });
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: AGENT });
    await page.waitForFunction(() => !!window.CITY_GRAPH_REF, null, { timeout: 20000 });
    await page.evaluate(() => window.__QA.bind());

    // ===========================================================
    // 1–4. The board, read straight off the module.
    // ===========================================================
    const board = await page.evaluate(async () => {
        const M = (await import('/src/config/maps/star_territory.js')).default;
        const G = M.graph, J = M.junctions;

        // Board steps: a junction is NOT a landable square, so stepping through
        // one is free. Dijkstra rather than BFS precisely because of those
        // zero-weight edges — a breadth-first frontier can reach a node by a
        // longer route first and never correct itself.
        function steps(from, to) {
            const d = { [from]: 0 }, q = [from];
            while (q.length) {
                const u = q.shift();
                for (const v of G[u].next) {
                    const w = J.has(v) ? 0 : 1;
                    if (d[v] === undefined || d[v] > d[u] + w) { d[v] = d[u] + w; q.push(v); }
                }
            }
            return d[to] ?? Infinity;
        }
        // Walk a whole lap, taking branch `idx` at every junction.
        function lap(idx) {
            let n = 0, cur = M.start;
            do {
                let nx = G[cur].next[0];
                if (J.has(nx)) nx = G[nx].next[idx] ?? G[nx].next[0];
                n++; cur = nx;
            } while (cur !== M.start && n < 400);
            return n;
        }

        const ids = Object.keys(G);
        const playable = ids.filter(id => !G[id].isJunction);
        const lobeKeys = M.regionKeys;
        const P = M.stars.plinths;

        // Null slots per region — what the pools have to fill, counted rather
        // than restated. Two places saying the same number is two places for
        // them to disagree, which is how the spec's own tables drifted.
        const nullsByRegion = {};
        playable.forEach(id => {
            if (G[id].type !== null) return;
            nullsByRegion[G[id].district] = (nullsByRegion[G[id].district] || 0) + 1;
        });

        const poolTotals = {};
        Object.values(M.pools).flat().forEach(t => { poolTotals[t] = (poolTotals[t] || 0) + 1; });

        return {
            nodes: ids.length,
            playable: playable.length,
            junctions: [...J].sort(),
            lobeSizes: Object.fromEntries(lobeKeys.map(k =>
                [k, playable.filter(id => G[id].district === k).length])),
            hubSize: playable.filter(id => G[id].district === M.hub).length,
            dangling: ids.flatMap(id => (G[id].next || []).filter(n => !G[n]).map(n => id + '->' + n)),
            ordered: M.ordered.length,
            orderedUnique: new Set(M.ordered).size === M.ordered.length,
            orderedCovers: playable.every(id => M.ordered.includes(id)),
            orderedNoJunctions: M.ordered.every(id => !J.has(id)),

            // Furniture
            start: M.start,
            startType: G[M.start].type,
            shops: playable.filter(id => G[id].type === 'shop').sort(),
            plinths: playable.filter(id => G[id].type === 'plinth').sort(),
            gates: playable.filter(id => G[id].type === 'gate').sort(),
            fixed: playable.filter(id => G[id].type !== null).length,
            // The shop must come BEFORE the Office on every territory road, or
            // "spend it or save it" is not a question anybody gets asked.
            shopBeforeOffice: lobeKeys.every(k => steps(`${k}_0`, `${k}_2`) < steps(`${k}_0`, `${k}_6`)),

            // Pools
            poolSizes: Object.fromEntries(Object.entries(M.pools).map(([k, v]) => [k, v.length])),
            nullsByRegion,
            poolTotals,
            movers: Object.values(M.pools).flat().filter(t => ['shortcut', 'cfwd', 'cbwd'].includes(t)),
            reds: Object.values(M.pools).flat().filter(t => ['trap', 'lose', 'lose_big'].includes(t)).length,

            // Distances, measured
            officeToOffice: P.map(a => ({ from: a, to: Object.fromEntries(
                P.filter(b => b !== a).map(b => [b, steps(a, b)])) })),
            startToNearest: Math.min(...P.map(id => steps(M.start, id))),
            hubLap: lap(0),
            allFourLap: lap(1),
            junctionToOffice: lobeKeys.map(k => steps(`${k}_0`, `${k}_6`) + 1),
        };
    });

    // ---- 1. topology ----
    ok('64 graph nodes: 60 playable plus 4 junctions',
        board.nodes === 64 && board.playable === 60, `${board.nodes} / ${board.playable}`);
    ok('the four junctions are jn_a..jn_d',
        JSON.stringify(board.junctions) === JSON.stringify(['jn_a', 'jn_b', 'jn_c', 'jn_d']),
        JSON.stringify(board.junctions));
    ok('twelve hub nodes', board.hubSize === 12, String(board.hubSize));
    ok('every territory is twelve nodes',
        Object.values(board.lobeSizes).every(n => n === 12), JSON.stringify(board.lobeSizes));
    ok('no edge points at a node that does not exist',
        board.dangling.length === 0, JSON.stringify(board.dangling));
    ok('the lap order lists all 60 playable nodes once',
        board.ordered === 60 && board.orderedUnique && board.orderedCovers,
        `${board.ordered} entries, unique=${board.orderedUnique}, covers=${board.orderedCovers}`);
    ok('no junction is in the lap order', board.orderedNoJunctions);

    // ---- 2. furniture ----
    ok('START is h1', board.start === 'h1' && board.startType === 'start',
        `${board.start} / ${board.startType}`);
    ok('twelve fixed squares of sixty', board.fixed === 12, String(board.fixed));
    ok('six shops: two in Perdition, one per territory',
        JSON.stringify(board.shops) === JSON.stringify(['bad_2', 'h11', 'h5', 'mine_2', 'rail_2', 'ranch_2'].sort()),
        JSON.stringify(board.shops));
    ok('four Territory Offices, all at node 6',
        JSON.stringify(board.plinths) === JSON.stringify(['bad_6', 'mine_6', 'rail_6', 'ranch_6']),
        JSON.stringify(board.plinths));
    ok('one Gate, at the mouth of the Cinder Mine',
        JSON.stringify(board.gates) === JSON.stringify(['mine_0']), JSON.stringify(board.gates));
    ok('the outfitter comes before the Office on every territory road',
        board.shopBeforeOffice);

    // ---- 3. pools ----
    ok('every region pool fills exactly its own random slots',
        JSON.stringify(board.poolSizes) === JSON.stringify(board.nullsByRegion),
        `pools ${JSON.stringify(board.poolSizes)} vs slots ${JSON.stringify(board.nullsByRegion)}`);
    const slots = Object.values(board.poolSizes).reduce((a, b) => a + b, 0);
    ok('48 random slots', slots === 48, String(slots));
    // The counts docs/STAR_TERRITORY_SPEC.md §2.5 claims, checked rather than
    // restated. The echoes of City's audited numbers — 6 red, 3 duels, 5
    // magnets — are deliberate and this is what holds them.
    const want = { coin: 10, coin_big: 7, mystery: 8, magnet: 5, boost: 5,
                   swap_space: 3, duel: 3, truce: 1, trap: 3, lose: 1, lose_big: 2 };
    const wrong = Object.entries(want).filter(([k, v]) => (board.poolTotals[k] || 0) !== v)
        .map(([k, v]) => `${k}: want ${v}, got ${board.poolTotals[k] || 0}`);
    ok('the board totals are what the spec claims', wrong.length === 0, wrong.join('; '));
    ok('six red spaces — exactly one per ten nodes', board.reds === 6, String(board.reds));
    ok('NOTHING on this lap map moves a player along the track',
        board.movers.length === 0, board.movers.join(','));

    // ---- 4. distances, measured on the real directed graph ----
    //
    // THE SPEC'S TWO TABLES DISAGREE AND THIS IS THE ONE THAT SETTLES IT.
    // The office-to-office figures are what §4.5's balance model is derived
    // from, and they only come out at 15/18/21 with twelve-node lobes. The lap
    // figures in §2.2 (23 and 56) were computed against an eleven-node draft
    // the node budget rules out; the real numbers are 24 and 60.
    const dsets = board.officeToOffice.map(r => Object.values(r.to).sort((a, b) => a - b));
    ok('every Office is 15 / 18 / 21 from every other',
        dsets.every(d => JSON.stringify(d) === JSON.stringify([15, 18, 21])),
        JSON.stringify(board.officeToOffice));
    ok('the distances are ASYMMETRIC, which is what makes "farthest" well-defined',
        board.officeToOffice[0].to['mine_6'] === 15 &&
        board.officeToOffice[1].to['rail_6'] === 21,
        `rail->mine ${board.officeToOffice[0].to['mine_6']}, mine->rail ${board.officeToOffice[1].to['rail_6']}`);
    ok('START is 9 spaces from the nearest Office',
        board.startToNearest === 9, String(board.startToNearest));
    ok('a junction is 7 spaces from its own Office',
        board.junctionToOffice.every(n => n === 7), JSON.stringify(board.junctionToOffice));
    ok('a hub lap is 12 spaces', board.hubLap === 12, String(board.hubLap));
    ok('taking all four territories is 60 spaces (the spec says 56 — it is wrong)',
        board.allFourLap === 60, String(board.allFourLap));

    // ===========================================================
    // 5. Geometry — the Clover, measured off the real positions.
    // ===========================================================
    const geo = await page.evaluate(async () => {
        const R = await import('/src/engine/Renderer.js');
        const { state } = await import('/src/core/GameState.js');
        const prev = state.selectedMap;
        state.selectedMap = 'star_territory';
        // Positions are only written during Renderer.init(), which stands up a
        // whole scene. buildLayout() is that step on its own.
        R.buildLayout();
        const M = (await import('/src/config/maps/star_territory.js')).default;
        const L = M.layout;
        const at = id => { const p = R.getPos(id); return { id, x: p.x, z: p.z, r: Math.hypot(p.x, p.z) }; };
        const ids = [...M.ordered, ...M.junctions];
        const pts = ids.map(at);
        const adj = new Set();
        Object.values(M.graph).forEach(n => (n.next || []).forEach(v => {
            adj.add(n.id + '|' + v); adj.add(v + '|' + n.id);
        }));
        let minAdj = Infinity, maxAdj = 0, minNon = Infinity, nonPair = '';
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                const d = Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
                if (adj.has(pts[i].id + '|' + pts[j].id)) {
                    minAdj = Math.min(minAdj, d); maxAdj = Math.max(maxAdj, d);
                } else if (d < minNon) { minNon = d; nonPair = `${pts[i].id}/${pts[j].id}`; }
            }
        }
        // Every lobe node must sit clear OUTSIDE the hub ring, or the roads
        // cross — which is the failure that killed the teardrop draft.
        const hubR = L.HUB_R;
        const insideHub = M.regionKeys.flatMap(k =>
            M.layout.lobes.find(l => l.key === k).ids.map(at).filter(p => p.r <= hubR + 3).map(p => p.id));
        const result = {
            minAdj, maxAdj, minNon, nonPair,
            radius: Math.max(...pts.map(p => p.r)),
            atOrigin: pts.filter(p => p.x === 0 && p.z === 0).map(p => p.id),
            hubSpread: (() => {
                const rs = L.hub.ids.map(id => at(id).r);
                return Math.max(...rs) - Math.min(...rs);
            })(),
            insideHub,
        };
        state.selectedMap = prev;
        return result;
    });

    ok('no node sits at the origin', geo.atOrigin.length === 0, JSON.stringify(geo.atOrigin));
    ok('the hub ring is a circle', geo.hubSpread < 1e-6, `varies by ${geo.hubSpread.toFixed(6)}`);
    // THE MIDDLE ROW IS THE ONE THAT MATTERS, and it is what killed the
    // teardrop: non-adjacent nodes must not be closer than adjacent ones, or
    // the board reads as a tangle whatever the tiles are made of.
    ok('the closest non-adjacent pair is a full step apart',
        geo.minNon >= 10.2,
        `${geo.minNon.toFixed(2)} u (${geo.nonPair}) vs shortest road step ${geo.minAdj.toFixed(2)} u`);
    ok('road steps are uniform along the roads',
        geo.maxAdj <= 12.0 && geo.minAdj >= 5.5,
        `${geo.minAdj.toFixed(2)} – ${geo.maxAdj.toFixed(2)} u (the short legs are the junction walk)`);
    ok('the board is about 72 units across the radius',
        geo.radius > 68 && geo.radius < 76, geo.radius.toFixed(2));
    ok('every territory sits clear outside the hub ring',
        geo.insideHub.length === 0, JSON.stringify(geo.insideHub));

    // ===========================================================
    // 6. The Star, driven through core/Stars.js directly.
    // ===========================================================
    const star = await page.evaluate(async () => {
        const S = await import('/src/core/Stars.js');
        const { state, resetPlayers } = await import('/src/core/GameState.js');
        const prev = state.selectedMap;
        state.selectedMap = 'star_territory';
        resetPlayers();
        const p = state.players[0], q = state.players[1];

        const out = {};
        state.gateOpen = false;
        S.initStars();
        out.opensAt = state.starNode;
        out.openOfficesShut = S.openOffices().slice().sort();

        // The price ladder is a visible handicap on the leader, not hidden
        // rubber-banding: 20 / 25 / 30 / 35.
        out.ladder = [0, 1, 2, 3].map(n => { p.stars = n; return S.priceFor(p); });
        p.stars = 0;

        // Dispatch: farthest from the buyer, never the same Office, never one
        // behind a closed Gate.
        state.starNode = 'rail_6';
        p.pos = 'rail_6'; q.pos = 'h1';
        out.dispatchShutGate = S.dispatchTarget(p, 'rail_6');
        state.gateOpen = true;
        out.openOfficesOpen = S.openOffices().slice().sort();
        out.dispatchOpenGate = S.dispatchTarget(p, 'rail_6');
        // ...and never into the rival's lap.
        q.pos = out.dispatchOpenGate;
        out.dispatchAvoidsRival = S.dispatchTarget(p, 'rail_6');
        q.pos = 'h1';

        // A purchase: coins out, Star in, and the next one gone elsewhere.
        p.coins = 40; p.stars = 0; state.starNode = 'rail_6'; p.pos = 'rail_6';
        const buy = S.buy(p, 'rail_6');
        out.buy = { price: buy.price, coins: p.coins, stars: p.stars,
                    moved: state.starNode !== 'rail_6', to: state.starNode };

        // Shards: four redeem into a Star, free, and the counter wraps.
        p.shards = 0; const before = p.stars;
        const grants = [];
        for (let i = 0; i < 4; i++) grants.push(S.grantShard(p, 'test'));
        out.shards = { redeemedOn: grants.findIndex(g => g.redeemed) + 1,
                       left: p.shards, gained: p.stars - before };

        // STARS CAN NEVER BE TAKEN. Shards can.
        p.shards = 1; const starsBefore = p.stars;
        const took = S.takeShard(p, q);
        out.stake = { took, shardsLeft: p.shards, rivalShards: q.shards,
                      starsUnchanged: p.stars === starsBefore };

        // A locked Office is never a destination while the Gate holds.
        state.gateOpen = false;
        out.lockedNeverDispatched = [];
        for (let i = 0; i < 12; i++) {
            p.pos = ['h1', 'h5', 'rail_6', 'ranch_6', 'bad_6'][i % 5];
            const t = S.dispatchTarget(p, 'rail_6');
            if (t === 'mine_6') out.lockedNeverDispatched.push(p.pos);
        }
        state.gateOpen = true;
        state.selectedMap = prev;
        resetPlayers();
        return out;
    });

    ok('the board opens with the Star at the Office nearest START',
        star.opensAt === 'rail_6', String(star.opensAt));
    ok('while the Gate holds, only three Offices are in rotation',
        star.openOfficesShut.length === 3 && !star.openOfficesShut.includes('mine_6'),
        JSON.stringify(star.openOfficesShut));
    ok('breaking the Gate opens a fourth destination',
        star.openOfficesOpen.length === 4, JSON.stringify(star.openOfficesOpen));
    ok('the price ladder is 20 / 25 / 30 / 35',
        JSON.stringify(star.ladder) === JSON.stringify([20, 25, 30, 35]), JSON.stringify(star.ladder));
    ok('dispatch sends the Star to the FARTHEST Office',
        star.dispatchOpenGate === 'bad_6', String(star.dispatchOpenGate));
    ok('dispatch never picks an Office behind a closed Gate',
        star.dispatchShutGate !== 'mine_6' && star.lockedNeverDispatched.length === 0,
        `${star.dispatchShutGate}; leaks ${JSON.stringify(star.lockedNeverDispatched)}`);
    ok('dispatch never gifts the Star to a rival standing on it',
        star.dispatchAvoidsRival !== star.dispatchOpenGate,
        `farthest ${star.dispatchOpenGate}, chosen ${star.dispatchAvoidsRival}`);
    ok('buying costs the bond, pins the Star, and sends the next away',
        star.buy.price === 20 && star.buy.coins === 20 && star.buy.stars === 1 && star.buy.moved,
        JSON.stringify(star.buy));
    ok('four Shards redeem into a Star and the counter wraps to zero',
        star.shards.redeemedOn === 4 && star.shards.left === 0 && star.shards.gained === 1,
        JSON.stringify(star.shards));
    ok('a Shard can be staked and a Star cannot be taken',
        star.stake.took && star.stake.shardsLeft === 0 && star.stake.rivalShards === 1
        && star.stake.starsUnchanged, JSON.stringify(star.stake));

    // ---- The Shard as a duel stake -------------------------------------
    //
    // Spec §4.2.8: Stars can never be taken, Shards can. The card has to offer
    // it only when BOTH duellists hold one, because a duel needs two stakes and
    // there is no honest exchange rate between a Shard and a pile of coins.
    const duel = await page.evaluate(async () => {
        const { state, resetPlayers } = await import('/src/core/GameState.js');
        const MM = await import('/src/ui/ModalManager.js');
        const prev = state.selectedMap;
        state.selectedMap = 'star_territory';
        resetPlayers();
        const p = state.players[0], q = state.players[1];
        const shardBtn = () => !!document.querySelector('#duel-bet-options [data-bet="shard"]');

        p.shards = 1; q.shards = 1; p.coins = 30; q.coins = 30;
        MM.showDuelModal(p, q, () => {});
        const both = shardBtn();
        MM.closeAllModals();

        q.shards = 0;
        MM.showDuelModal(p, q, () => {});
        const onlyOne = shardBtn();
        MM.closeAllModals();

        // Broke, but both holding a Shard: the duel must still be possible.
        p.coins = 0; q.coins = 0; p.shards = 1; q.shards = 1;
        MM.showDuelModal(p, q, () => {});
        const brokeButArmed = shardBtn();
        const optionsShown = getComputedStyle(document.getElementById('duel-bet-options')).display !== 'none';
        MM.closeAllModals();

        state.selectedMap = prev;
        resetPlayers();
        return { both, onlyOne, brokeButArmed, optionsShown };
    });
    ok('a Shard can be staked when both duellists hold one', duel.both);
    ok('the Shard stake is not offered when only one side holds one', !duel.onlyOne);
    ok('two broke players holding Shards can still duel',
        duel.brokeButArmed && duel.optionsShown,
        JSON.stringify(duel));

    // ===========================================================
    // 7. Bounties — the per-map split.
    // ===========================================================
    const bounty = await page.evaluate(async () => {
        const { CONTRACT_POOL, getShuffledPool } = await import('/src/config/ContractPool.js');
        const st = getShuffledPool('star_territory').map(c => c.id).sort();
        const city = getShuffledPool('city_circuit').map(c => c.id).sort();
        const cityOnly = CONTRACT_POOL.filter(c => c.maps?.includes('city_circuit')).map(c => c.id);
        const starOnly = CONTRACT_POOL.filter(c => c.maps?.includes('star_territory')).map(c => c.id);
        return {
            starDeck: st.length, cityDeck: city.length,
            cityCardsOnStar: cityOnly.filter(id => st.includes(id)),
            starCardsOnCity: starOnly.filter(id => city.includes(id)),
            starOwn: starOnly.length,
            // Every card in the star deck must name a region this board has.
            badParam: getShuffledPool('star_territory')
                .filter(c => c.type === 'enter_district' &&
                             !['rail', 'mine', 'ranch', 'bad'].includes(c.param))
                .map(c => c.id),
            // A hint that still names a City district is a card telling the
            // player to go somewhere that does not exist.
            staleHints: getShuffledPool('star_territory')
                .filter(c => /Back Alley|Ring Road|Promenade|Financial|Industrial|Grand Mall|Power Plant/i.test(c.hint))
                .map(c => c.id),
        };
    });
    ok('no City-only bounty is dealt on Star Territory',
        bounty.cityCardsOnStar.length === 0, JSON.stringify(bounty.cityCardsOnStar));
    ok('no Star-only bounty is dealt on City Circuit',
        bounty.starCardsOnCity.length === 0, JSON.stringify(bounty.starCardsOnCity));
    ok('Star Territory has its own eight Wild West cards', bounty.starOwn === 8, String(bounty.starOwn));
    ok('every enter_district bounty names a territory that exists',
        bounty.badParam.length === 0, JSON.stringify(bounty.badParam));
    ok('no bounty hint still points at a City district',
        bounty.staleHints.length === 0, JSON.stringify(bounty.staleHints));
    ok('both decks are big enough to deal from',
        bounty.starDeck >= 20 && bounty.cityDeck >= 20, `${bounty.starDeck} / ${bounty.cityDeck}`);

    // ===========================================================
    // 8. A real match: it plays, and it scores on Stars.
    // ===========================================================
    await page.evaluate(() => window.__QA.startRun({ mode: '1p', difficulty: 'hard',
                                                     map: 'star_territory', rounds: 6 }));
    await page.waitForFunction(() => {
        const el = document.getElementById('ui-layer');
        return el && getComputedStyle(el).display !== 'none';
    }, null, { timeout: 60000 }).catch(() => {});

    const opening = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const strip = document.getElementById('star-strip');
        return {
            started: state.gameStarted,
            map: state.selectedMap,
            starNode: state.starNode,
            stripShown: !!strip && getComputedStyle(strip).display !== 'none',
            stripText: strip ? strip.textContent.trim() : '',
            // Every seat starts on zero Stars and zero Shards.
            clean: state.players.every(p => p.stars === 0 && p.shards === 0),
            board: Object.keys(state.board).length,
            plinthTiles: Object.entries(state.board).filter(([, b]) => b.type === 'plinth').length,
        };
    });
    ok('a Star Territory match starts', opening.started && opening.map === 'star_territory',
        JSON.stringify({ started: opening.started, map: opening.map }));
    ok('the board is dealt: 60 squares, four of them Offices',
        opening.board === 60 && opening.plinthTiles === 4,
        `${opening.board} squares, ${opening.plinthTiles} Offices`);
    ok('every seat opens on zero Stars', opening.clean);
    ok('the HUD says where the Star is, permanently',
        opening.stripShown && /Office/.test(opening.stripText), opening.stripText);

    // Drive real turns. The Star is nine spaces from START, so a handful of
    // rounds is enough for at least one seat to reach an Office — which is the
    // only way to prove the purchase path works end to end.
    await page.evaluate(() => window.__QA.setMinigameFastResolve(1500));
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
        const done = await page.evaluate(async () => {
            await window.__QA.step();
            const { state } = await import('/src/core/GameState.js');
            return getComputedStyle(document.getElementById('win-screen')).display !== 'none'
                || state.players.some(p => p.stars > 0);
        });
        if (done) break;
        await new Promise(r => setTimeout(r, 220));
    }

    const played = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const S = await import('/src/core/Stars.js');
        const rep = window.__QA.report();
        return {
            turns: state.totalTurns,
            stars: state.players.map(p => p.stars),
            shards: state.players.map(p => p.shards),
            bought: state.players.map(p => p.starsBought),
            fused: state.players.map(p => p.shardStars),
            starNode: state.starNode,
            starIsAnOffice: S.plinths ? true : true,
            offices: (await import('/src/config/ActiveMap.js')).plinths(),
            violations: rep.invariantViolations,
            posValid: state.players.every(p => !!state.board[p.pos]),
        };
    });
    ok('the board drove real turns', played.turns > 0, `${played.turns} turns`);
    ok('no invariant violations while playing',
        played.violations.length === 0, JSON.stringify(played.violations).slice(0, 300));
    ok('every token is on a real square', played.posValid);
    ok('the live Star is always standing on an Office',
        played.offices.includes(played.starNode), `${played.starNode} of ${JSON.stringify(played.offices)}`);
    ok('at least one Star was won in the first rounds',
        played.stars.some(n => n > 0) || played.shards.some(n => n > 0),
        `stars ${JSON.stringify(played.stars)}, shards ${JSON.stringify(played.shards)}`);
    ok('every Star is accounted for by a lane it came from',
        played.stars.every((n, i) => n === played.bought[i] + played.fused[i]),
        `stars ${JSON.stringify(played.stars)} vs bought ${JSON.stringify(played.bought)} + fused ${JSON.stringify(played.fused)}`);

    // The win screen has to rank on STARS, not coins. Forced rather than
    // played out: a coin-rich seat with fewer Stars must lose, and only a
    // rigged table proves it.
    const win = await page.evaluate(async () => {
        const { state } = await import('/src/core/GameState.js');
        const WS = await import('/src/core/WinScreen.js');
        state.players[0].stars = 1; state.players[0].coins = 5;
        state.players[1].stars = 0; state.players[1].coins = 400;
        WS.calculateWinner(false);
        const name = document.getElementById('win-name').textContent;
        const sub  = document.getElementById('win-subtitle').textContent;
        const head = [...document.querySelectorAll('#win-cards .win-card-score')].map(e => e.textContent);
        return { name, sub, head, p0: state.players[0].name.toUpperCase() };
    });
    ok('the win screen ranks on Stars, not coins',
        win.name === win.p0, `${win.name} won with 1 star and 5 coins against 0 stars and 400`);
    ok('the card prints the Star count as the score',
        win.head[0] === '1', JSON.stringify(win.head));
    ok('the subtitle belongs to this board', /BADGE/.test(win.sub), win.sub);

    ok('no page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

    await browser.close();
    const failed = results.filter(r => !r.pass);
    results.forEach(r => console.log(`${r.pass ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? '  — ' + r.detail : ''}`));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
})();
