// ============================================================
// BLOCK PARTY — the Promenade dance-off on the shared stage, side-on hold.
//
//   1. Built, and turned sideways in portrait.
//   2. The DJ dances the call, one move per beat.
//   3. Real swipes on P1's half dance the move they point at (up, down, left,
//      right in the landscape view) and are judged in the response.
//   4. On the beat is PERFECT, 0.12 s off is GOOD, 0.3 s off or the wrong move
//      is a MISS, and no move at all is a MISS.
//   5. A phrase with no misses pays the FULL COMBO bonus.
//   5b. Every move is called out big over the player's own half (★ PERFECT /
//      ✓ GOOD / ✗ WRONG MOVE, with the right move), and marked on its card.
//   5c. Over a whole game, every move the DJ has danced is up on its card,
//      on every frame, in every phrase.
//   6. A hard bot beats an idle player; nothing leaks; no errors.
//
// usage: node blockparty.js          (screenshots: qa/shot-blockparty-*.png)
// ============================================================
require('./stageprobe').run('blockparty', async ({ page, ok, launch, state, shot, forceEnd, waitResult, cleanup }) => {
    const waitFor = async (fn, ms = 20000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const s = await state(); if (s && fn(s)) return s; await page.waitForTimeout(40); }
        return state();
    };
    // Stage (lx, ly) sits at screen (412 - ly, lx): the landscape view's "up"
    // is the portrait screen's right, its "left" the screen's top. P1's half is
    // the screen's bottom half.
    const swipe = async (dx, dy) => {
        const x = 206, y = 680;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 3 });
        await page.mouse.up();
    };

    await launch();
    await page.waitForTimeout(900);
    await shot('intro');
    let s = await state();
    ok('the party is built, turned sideways in portrait', s.gl && s.turned);

    // Phrase 1: the call, then real swipes.
    s = await waitFor(st => st.part === 'call');
    await page.waitForTimeout(150);
    s = await state();
    ok('the DJ dances the call', ['raise', 'drop', 'pointL', 'pointR', 'clap'].includes(s.dj), `dj=${s.dj}`);
    await shot('call');
    // A real swipe, judged. A software renderer takes longer over four mouse
    // gestures than the response lasts, so the music is held at the first
    // response beat (from inside the page, the moment it arrives) while the
    // probe swipes the move the DJ called.
    const DIR = { raise: [60, 0], drop: [-60, 0], pointL: [0, -60], pointR: [0, 60] };
    const first = await page.evaluate(() => new Promise(res => {
        const tick = () => {
            const st = window.__G._debugState();
            if (st.part !== 'resp') return requestAnimationFrame(tick);
            window.__G._debugHold(true);
            res(st.moves[0]);
        };
        tick();
    }));
    if (DIR[first]) await swipe(...DIR[first]); else { await page.mouse.move(206, 680); await page.mouse.down(); await page.mouse.up(); }
    s = await state();
    ok('a real swipe of the called move on the beat is a hit', s.resp[0][0] === 'perfect' || s.resp[0][0] === 'good', `${first} → ${s.resp[0][0]}`);
    // Every direction, sampled every frame (the clock is still held, so the
    // pose stays up until the next one).
    const poses = [];
    for (const want of ['raise', 'drop', 'pointL', 'pointR']) {
        await swipe(...DIR[want]);
        poses.push(`${want}:${(await state()).pose[0]}`);
    }
    await shot('resp');
    ok('real swipes dance up / down / left / right', poses.every(p => p.split(':')[0] === p.split(':')[1]), poses.join(' '));
    await page.evaluate(() => window.__G._debugHold(false));
    await forceEnd();

    // Judgments, danced at exact musical positions from inside the page and
    // read back while the phrase is still up.
    await launch();
    s = await waitFor(st => st.phrase === 0 && st.part === 'resp', 30000);
    const got = await page.evaluate(() => {
        const G = window.__G, st = G._debugState();
        const b0 = st.respBeat0, k = st.bpm / 60, m = st.moves;
        const wrong = x => ['raise', 'drop', 'pointL', 'pointR'].find(y => y !== x);
        const before = st.score[0];
        G._debugMove(0, m[0], b0);                    // on the beat
        G._debugMove(0, m[1], b0 + 1 + 0.12 * k);     // 0.12 s late
        G._debugMove(0, m[2], b0 + 2 + 0.3 * k);      // 0.3 s late
        G._debugMove(0, wrong(m[3]), b0 + 3);         // on the beat, wrong move
        const after = G._debugState();
        return { resp: after.resp[0], pts: after.score[0] - before, pop: after.pops[0] };
    });
    ok('on the beat PERFECT, 0.12 s GOOD, 0.3 s MISS, wrong move MISS',
        got.resp.join() === 'perfect,good,miss,miss' && got.pts === 5, `${got.resp.join()} → +${got.pts}`);
    ok('each move is called out big over your half: a wrong one says so', /^✗ WRONG MOVE/.test(got.pop), `pop "${got.pop}"`);
    await page.waitForTimeout(100);
    await shot('feedback');
    const marks = await page.evaluate(() => [...document.querySelectorAll('#minigame-layer div')].filter(d => /^[★✓✗]$/.test(d.textContent)).map(d => d.textContent).join(''));
    ok('…and each card is marked ★ / ✓ / ✗ for that player', marks.includes('★') && marks.includes('✓') && marks.includes('✗'), `marks ${marks}`);
    s = await waitFor(st => st.phrase === 0 && st.part === 'tally');
    ok('no move at all is a miss', s.resp[1].length > 0 && s.resp[1].every(j => j === 'miss'), `P2 ${s.resp[1].join()}`);

    // Phrase 2 danced clean by P1: the full combo pays.
    s = await waitFor(st => st.phrase === 1 && st.part === 'resp', 20000);
    const combo = await page.evaluate(() => new Promise(res => {
        const G = window.__G, st = G._debugState();
        const before = st.score[0], p1 = st.phrase;
        st.moves.forEach((m, i) => G._debugMove(0, m, st.respBeat0 + i));
        const wait = () => { const s2 = G._debugState(); if (s2.phrase !== p1) res({ gained: s2.score[0] - before, n: st.moves.length }); else requestAnimationFrame(wait); };
        wait();
    }));
    ok('a phrase with no misses pays the FULL COMBO bonus', combo.gained === combo.n * 3 + 2, `+${combo.gained} for ${combo.n} perfects`);
    await forceEnd();

    await launch({ bot: true, skill: 0.85 });
    let verdict = false;
    const gaps = []; let samples = 0;
    // Watch the cards from inside the page, every frame, for the whole game.
    await page.evaluate(() => {
        window.__cardGaps = []; window.__cardSamples = 0;
        const tick = () => {
            const st = window.__G && window.__G._debugState && window.__G._debugState();
            if (!st || st.phase === 'over') return;
            if (st.part === 'call' || (st.part === 'resp' && !st.hide)) {
                window.__cardSamples++;
                const need = st.part === 'call' ? st.idx + 1 : st.moves.length;
                for (let j = 0; j < need; j++) if (!st.shown[j]) { window.__cardGaps.push(`${st.phrase}:${st.part}${st.idx} card ${j}`); break; }
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    const r = await waitResult(110000, async () => {
        const st = await state();
        if (st && st.phase === 'over' && !verdict) { verdict = true; await page.waitForTimeout(1300); await shot('verdict'); }
    });
    const cg = await page.evaluate(() => ({ gaps: window.__cardGaps.slice(0, 5), n: window.__cardGaps.length, samples: window.__cardSamples }));
    ok('every move the DJ has danced is up on its card, every frame, all game', cg.samples > 200 && cg.n === 0, `${cg.samples} frames sampled, ${cg.n} gaps ${JSON.stringify(cg.gaps)}`);
    ok('a hard bot beats an idle player', !!r && r.winner === 1, r ? `winner=${r.winner} in ${(r.ms / 1000).toFixed(1)}s` : 'timed out');
    await cleanup();
});
