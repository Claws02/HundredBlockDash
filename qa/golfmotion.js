// Mini golf: the travel animations — a ball fired into the cannon, down the
// hedge-maze hose, the loop, the candy-cane slide, a powder keg, a teleporter —
// filmed a frame every 0.3 s.
// usage: node golfmotion.js [outdir]
const path = require('path');
const OUT = process.argv[2] || __dirname;
const SHOTS = [
    { key: 'cannon', at: [8.2, 0], p: 0.25 },     // into the red cannon (it lands you 6+ away, wherever)
    { key: 'maze', at: [4.2, -8.7], p: 0.2 },     // into the yellow hose (every exit's 6+ away; Backyard is built 1.5×)
    { key: 'slide', at: [7.5, -1], p: 0.3 },
    { key: 'powder', at: [4.2, -1.2], p: 0.3, blast: true },
    { key: 'donut', at: [6.5, 0], p: 0.75 },
    { key: 'hub', at: [4.3, -1.8], p: 0.35 },
];
require('./stageprobe').run('minigolf', async ({ page, ok, launch, state }) => {
    for (const sh of SHOTS) {
        await page.evaluate(async k => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles([k]); M.configure({ mode: 'turns', round: true }); }, sh.key);
        await launch();
        const t0 = Date.now();
        let s;
        while (Date.now() - t0 < 20000) { s = await state(); if (s && s.sub === 'fly') break; await page.waitForTimeout(100); }
        await page.evaluate(() => window.__G._debugSkip());
        await page.waitForTimeout(400);
        await page.evaluate(() => window.__G._debugTakePass());
        await page.evaluate(([x, z]) => window.__G._debugBall(0, x, z), sh.at);
        await page.waitForTimeout(500);
        await page.evaluate(p => window.__G._debugShoot(0, 1, 0, p), sh.p);
        const track = [];
        for (let i = 0; i < 12; i++) {
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(OUT, `motion-${sh.key}-${String(i).padStart(2, '0')}.png`) });
            const b = (await state()).balls[0];
            track.push(`${b.x},${b.z},${b.y}${b.air ? '^' : ''}`);
        }
        const end = (await state()).balls[0];
        // A keg blows the ball back up the deck: it flew, that's the test.
        if (sh.blast) ok(`${sh.key}: the keg went off and the ball flew`, track.some(t => t.endsWith('^')), track.join(' '));
        else ok(`${sh.key}: the ball came out the far end`, Math.hypot(end.x - sh.at[0], end.z - sh.at[1]) > 6 || end.holed, track.join(' '));
        await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); });
        await page.waitForTimeout(300);
    }
    await page.evaluate(async () => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(null); });
    // The physics, played out: a ball stopped on the raft rides it; the cannon's lands going its way.
    const phys = await page.evaluate(async () => {
        const P = await import('/src/claw-core/minigames/golf/Physics.js');
        const { COURSES } = await import('/src/claw-core/minigames/golf/Courses.js');
        const hole = k => COURSES.flatMap(c => c.holes).find(h => h.key === k);
        const raft = P.compile(hole('raft')), rt = raft.tiles.find(t => t.move);
        const T = 2 * Math.PI / rt.move.speed;
        const b = P.newBall(6, 0); let t = T - 0.6; P.strike(b, 1, 0, 0.3);
        let rest = null, moved = 0, drift = 0;
        for (let i = 0; i < 600; i++) {
            P.step(raft, b, 1 / 60, t); t += 1 / 60;
            if (b.rest && !rest) rest = { x: b.x, off: b.x - P.tileOffset(rt, t).dx };
            if (rest) { moved = Math.max(moved, Math.abs(b.x - rest.x)); drift = Math.max(drift, Math.abs((b.x - P.tileOffset(rt, t).dx) - rest.off)); }
        }
        const ride = { kind: b.kind, moved, drift: rest ? drift : 99 };
        const can = P.compile(hole('cannon')), cb = P.newBall(7, 0); let ct = 0; P.strike(cb, 1, 0, 0.35);
        let out = null, dest = null;
        for (let i = 0; i < 600 && !out; i++) { const ev = P.step(can, cb, 1 / 60, ct); ct += 1 / 60; const pe = ev.find(e => e.type === 'pipe'); if (pe) dest = pe.dest; if (ev.some(e => e.type === 'pipeout')) out = { vx: cb.vx, vz: cb.vz }; }
        // A loose cannon fires wherever it ends up pointing: measure against where it fired you.
        const p = can.pipes[0], to = dest || p.b, fx = to[0] - p.a[0], fz = to[1] - p.a[1];
        const along = out ? (out.vx * fx + out.vz * fz) / Math.hypot(fx, fz) / Math.hypot(out.vx, out.vz) : 0;
        return { ride, along };
    });
    ok('raft: a ball stopped on the deck rides it and stays put on it', phys.ride.kind === 'raft' && phys.ride.moved > 2 && phys.ride.drift < 0.05, JSON.stringify(phys.ride));
    ok('cannon: the ball lands still going the way it was fired', phys.along > 0.99, phys.along.toFixed(3));
    const barrel = await page.evaluate(async () => {
        const T = await import('/src/claw-core/minigames/golf/Toys.js');
        const g = T.cannon(); return Number.isFinite(g.userData.recoil);
    });
    ok('cannon: the barrel is drawn before its first shot (no NaN recoil)', barrel);
    // No-stop zones and plinko's teleporters, in the physics.
    const rules = await page.evaluate(async () => {
        const P = await import('/src/claw-core/minigames/golf/Physics.js');
        const { COURSES } = await import('/src/claw-core/minigames/golf/Courses.js');
        const C = k => P.compile(COURSES.flatMap(c => c.holes).find(h => h.key === k));
        const river = C('river'), plinko = C('plinko');
        let shelf = 0;
        for (let i = 0; i < 30 && !shelf; i++) { const r = P.simulate(plinko, { x: 0, y: plinko.tee.y, z: 0 }, 1, (i - 15) * 0.003, 0.3 + (i % 5) * 0.02, 0, { maxT: 30 }); if (r.result === 'rest' && r.y > 12) shelf++; }
        return { creek: P.noRest(river, 10.5, 0, 1.45), green: P.noRest(river, 25, 4, 1.5), shelf };
    });
    ok('chocolate river: the current is somewhere you can\'t stop (it carries you on)', rules.creek && !rules.green, JSON.stringify(rules));
    ok('plinko: a teleporter sets you down on the top shelf, at rest, to shoot again', rules.shelf > 0, JSON.stringify(rules));
    // See-through: a ball deep in the skull cave fades the rock that hides it.
    await page.evaluate(async () => { const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(['skull']); M.configure({ mode: 'turns', round: true }); });
    await launch();
    const t1 = Date.now();
    while (Date.now() - t1 < 20000) { const s = await state(); if (s && s.sub === 'fly') break; await page.waitForTimeout(100); }
    await page.evaluate(() => window.__G._debugSkip()); await page.waitForTimeout(400);
    await page.evaluate(() => window.__G._debugTakePass()); await page.waitForTimeout(500);
    await page.evaluate(() => window.__G._debugBall(0, 15, 0)); await page.waitForTimeout(1600);
    const see = await page.evaluate(() => window.__G._debugScene());
    ok('see-through: what hides the ball fades', see && see.faded > 0 && !see.bad.length, JSON.stringify(see));
    await page.screenshot({ path: path.join(OUT, 'golfmotion-see.png') });
    await page.evaluate(async () => { const MM = await import('/src/claw-core/minigames/MinigameManager.js'); MM.forceEndMinigame(); const M = await import('/src/claw-core/minigames/MiniGolf.js'); M._debugForceHoles(null); });
});
