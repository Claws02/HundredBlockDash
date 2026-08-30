// ============================================================
// In-page autoplay agent for Hundred Block Dash QA.
// Injected as a string; exposes window.__QA
// ============================================================
window.__QA = (function () {
    const log = [];
    const errors = [];
    const seenStates = new Set();
    const seenSpaceTypes = new Set();
    const seenMinigames = new Set();
    let acted = 0;
    let lastActionAt = Date.now();
    let invariantViolations = [];

    function note(kind, msg) {
        log.push({ t: Date.now(), kind, msg });
        if (log.length > 4000) log.shift();
    }
    function vis(el) {
        if (!el) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    }
    function byId(id) { return document.getElementById(id); }
    function visId(id) { return vis(byId(id)); }

    function fire(el, type) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y,
                       pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0 };
        el.dispatchEvent(new PointerEvent(type, opts));
        return true;
    }
    function tap(el, why) {
        if (!el) return false;
        fire(el, 'pointerdown');
        fire(el, 'pointerup');
        el.click();
        acted++; lastActionAt = Date.now();
        note('tap', why || (el.id || el.className));
        return true;
    }

    // ---------- state access (live module singletons) ----------
    let S = null, GC = null, CFG = null, MGM = null, REG = null, SOLO = null;
    async function bind() {
        S = (await import('/src/core/GameState.js')).state;
        GC = await import('/src/core/GameController.js');
        CFG = await import('/src/config/GameConfig.js');
        MGM = await import('/src/minigames/MinigameManager.js');
        REG = await import('/src/config/MinigameRegistry.js');
        // A relay leg reports a score rather than naming a winner, so the
        // force-resolve has to be able to tell the two apart.
        SOLO = await import('/src/minigames/SoloArena.js');
        return REG.MG_TYPES.slice();
    }
    // When false, the agent stops tapping through the *bot's* result cards, so a
    // timing probe can measure the dwell the game actually guarantees.
    let autoAck = true;
    function setAutoAckResults(v) { autoAck = !!v; }

    // Board-loop mode: after `ms` of genuine play, force the minigame to resolve so
    // full board games finish inside a test budget. Minigames get their own runs.
    let mgFastMs = 0, mgStartedAt = 0, mgLast = '';
    function setMinigameFastResolve(ms) { mgFastMs = ms; }
    // Reaching the arcade in the real game goes through the splash's own button,
    // which hides the splash on the way. Calling triggerStandalone directly
    // skipped that, so #splash stayed on top of #minigame-layer and swallowed
    // every pointer event the sweep dispatched — for as long as every game had a
    // clock of its own, they all still finished and nobody noticed that the
    // "plays each game with synthetic input" sweep was delivering no input at
    // all. Penalty, with its shot clock removed, is what finally showed it.
    function launchArcade(type) {
        const splash = byId('splash');
        if (splash) splash.style.display = 'none';
        const sel = byId('mg-select-overlay');
        if (sel) sel.style.display = 'none';
        MGM.triggerStandalone(type);
    }

    function snapshot() {
        if (!S) return {};
        const p = S.players;
        return {
            gameState: S.gameState, activePlayer: S.activePlayer, totalTurns: S.totalTurns,
            round: S.currentRound, map: S.selectedMap, mgType: S.mgType, mgActive: S.mgActive,
            gateOpen: S.gateOpen, allyOnMap: S.allyOnMap && S.allyOnMap.allyType,
            contracts: (S.activeContracts || []).map(c => c.id + ':' + (c._progress || 0)),
            activeIsBot: !!p[S.activePlayer].isBot,
            p: p.map(x => ({ pos: x.pos, coins: x.coins, inv: x.inv.slice(), isBot: !!x.isBot,
                             allies: x.allies.map(a => a.type + '/' + a.turnsRemaining),
                             mgWins: x.mgWins })),
        };
    }

    function checkInvariants() {
        if (!S || !S.gameStarted || S.gameState === 'INIT') return;
        const cfg = S.hbd;
        S.players.forEach((p, i) => {
            if (p.coins < 0) push(`P${i + 1} coins negative: ${p.coins}`);
            if (!Number.isFinite(p.coins)) push(`P${i + 1} coins not finite: ${p.coins}`);
            if (p.inv.length > 3) push(`P${i + 1} inventory over MAX_INV: ${p.inv.length}`);
            if (p.allies.length > 2) push(`P${i + 1} allies over MAX_ALLIES: ${p.allies.length}`);
            p.inv.forEach(it => { if (!CFG.ITEMS[it]) push(`P${i + 1} unknown item id: ${it}`); });
            if (S.selectedMap === 'hundred_block_dash') {
                if (typeof p.pos !== 'number') push(`P${i + 1} HBD pos not a number: ${p.pos}`);
                else if (cfg && (p.pos < 0 || p.pos > cfg.finish)) push(`P${i + 1} HBD pos out of range: ${p.pos}`);
                else if (!S.board[p.pos]) push(`P${i + 1} HBD standing on undefined board space ${p.pos}`);
            } else {
                if (typeof p.pos !== 'string') push(`P${i + 1} City pos not a node id: ${p.pos}`);
                else if (!window.CITY_GRAPH_REF[p.pos]) push(`P${i + 1} City pos not in graph: ${p.pos}`);
                // A junction is a fork, not a tile. It is IN the graph, which is
                // why "pos is in the graph" passed while a failed gate roll
                // parked the player on bp_d — a node with no board space, and
                // one moveThroughGraph steps off without offering a choice.
                else if (window.CITY_GRAPH_REF[p.pos].isJunction) push(`P${i + 1} parked on junction node: ${p.pos}`);
                else if (!S.board[p.pos]) push(`P${i + 1} City standing on node with no board space: ${p.pos}`);
            }
        });
        seenStates.add(S.gameState);
        if (S.mgType) seenMinigames.add(S.mgType);
        const sp = S.board && S.board[S.players[S.activePlayer].pos];
        if (sp && sp.type) seenSpaceTypes.add(sp.type);
        function push(m) { if (!invariantViolations.includes(m)) { invariantViolations.push(m); note('INVARIANT', m); } }
    }

    // ---------- one decision step ----------
    let mgTapPhase = 0;
    function step() {
        checkInvariants();

        // 0. Win screen -> finished
        if (visId('win-screen')) return 'WIN_SCREEN';
        if (visId('boot-error')) return 'BOOT_ERROR';

        // 1. Full-screen overlays / onboarding
        const closers = { 'howto-overlay': 'htp-close', 'rules-overlay': 'rules-close', 'settings-overlay': 'settings-close' };
        for (const id of Object.keys(closers)) {
            if (visId(id)) {
                const close = byId(closers[id]) || byId(id).querySelector('button');
                if (close) return tap(close, 'close ' + id) && 'CLOSED_' + id;
            }
        }
        if (visId('hbd-story-overlay')) {
            const b = byId('btn-hbd-story-begin');
            if (b) return tap(b, 'story begin') && 'STORY';
        }

        // 2. The round board — three or four players, one minigame.
        //
        // Above two seats a round is a relay or a bracket and there is a card
        // between every leg: hand the phone on, the next pairing, the final
        // standings. A harness that does not press them stalls at the first
        // round of every three- and four-player match, which looks exactly like
        // a soft lock in the board code.
        if (visId('round-layer')) {
            const go = byId('btn-round-go');
            if (vis(go) && !go.disabled) return tap(go, 'round card') && 'ROUND_CARD';
            return 'ROUND_WAIT';   // a simulated leg takes itself down
        }

        // 2a. Minigame flow
        if (visId('mg-intro-overlay')) {
            if (vis(byId('btn-mg-launch'))) return tap(byId('btn-mg-launch'), 'mg launch') && 'MG_LAUNCH';
            if (vis(byId('btn-mg-intro-next'))) return tap(byId('btn-mg-intro-next'), 'mg next') && 'MG_NEXT';
            return 'MG_INTRO_WAIT';
        }
        if (visId('minigame-layer')) {
            const rd1 = byId('mg-ready-1'), rd2 = byId('mg-ready-2');
            if (vis(rd1) && !S.mgReady[0]) return tap(rd1, 'ready P1') && 'MG_READY1';
            if (vis(rd2) && !S.mgReady[1]) return tap(rd2, 'ready P2') && 'MG_READY2';
            if (S.mgActive) {
                if (mgLast !== S.mgType || mgStartedAt === 0) { mgLast = S.mgType; mgStartedAt = Date.now(); }
                mgPlay();
                if (mgFastMs && Date.now() - mgStartedAt > mgFastMs) {
                    note('mg', 'force-resolve ' + S.mgType);
                    mgStartedAt = 0;
                    // A RELAY leg is one person alone with the whole screen and
                    // it does not end through winMinigame — it reports a score.
                    // Calling the 1v1 exit on it would resolve a game that has
                    // no second slot, and pay out a round that is not over.
                    if (SOLO && SOLO.isSolo()) { SOLO.forceEnd(); return 'MG_FORCED_SOLO:' + S.mgType; }
                    MGM.winMinigame(Math.random() < 0.5 ? 0 : 1);
                    return 'MG_FORCED:' + S.mgType;
                }
                return 'MG_PLAY:' + S.mgType;
            }
            mgStartedAt = 0;
            return 'MG_WAIT';
        }

        // 3. Gate overlay
        if (visId('gate-overlay')) {
            if (vis(byId('gate-continue-btn'))) return tap(byId('gate-continue-btn'), 'gate continue') && 'GATE_CONT';
            if (vis(byId('gate-roll-btn'))) return tap(byId('gate-roll-btn'), 'gate roll') && 'GATE_ROLL';
            return 'GATE_WAIT';
        }

        // 3a. Ally arrival — holds the minigame hand-off until pressed.
        if (visId('ally-arrival')) {
            const b = byId('btn-ally-arrival');
            if (b) return tap(b, 'ally arrival') && 'ALLY_ARRIVAL';
        }

        // 3b. City briefing (shown once, before the first roll)
        if (visId('city-briefing')) {
            // Take the map tour some of the time so that path gets exercised too.
            if (Math.random() < 0.25 && vis(byId('btn-cb-tour'))) {
                return tap(byId('btn-cb-tour'), 'briefing tour') && 'BRIEF_TOUR';
            }
            return tap(byId('btn-cb-start'), 'briefing start') && 'BRIEFING';
        }

        // 4. Branch / path choice. Ordinary junctions are arrows over the board;
        // the Cabbie's teleport picker still uses the card overlay.
        if (visId('junction-layer')) {
            const arrows = [...byId('junction-arrows').querySelectorAll('[data-node]')];
            if (arrows.length) {
                if (Math.random() < 0.15 && vis(byId('btn-junction-map'))) {
                    return tap(byId('btn-junction-map'), 'junction scout') && 'JUNCTION_MAP';
                }
                return tap(arrows[Math.floor(Math.random() * arrows.length)], 'junction arrow') && 'BRANCH';
            }
        }
        if (visId('branch-choice-overlay')) {
            const cards = [...byId('branch-cards').querySelectorAll('[data-node]')];
            if (cards.length) return tap(cards[Math.floor(Math.random() * cards.length)], 'branch') && 'BRANCH';
        }
        if (visId('bounty-panel')) return tap(byId('btn-close-bounties'), 'close bounties') && 'BOUNTY_CLOSE';

        // 5. Modals
        if (visId('ally-encounter-modal')) {
            const b = Math.random() < 0.8 ? byId('btn-ally-claim') : byId('btn-ally-pass');
            return tap(b, 'ally encounter') && 'ALLY_ENC';
        }
        if (visId('ally-steal-modal')) {
            const btns = [...byId('ally-steal-list').querySelectorAll('[data-ally-idx]')];
            if (btns.length && Math.random() < 0.8) return tap(btns[0], 'ally steal') && 'ALLY_STEAL';
            return tap(byId('btn-ally-steal-cancel'), 'ally steal cancel') && 'ALLY_STEAL_CANCEL';
        }
        if (visId('duel-modal')) {
            const bets = [...byId('duel-bet-options').querySelectorAll('[data-bet]:not([disabled])')];
            if (bets.length) return tap(bets[Math.floor(Math.random() * bets.length)], 'duel bet') && 'DUEL_BET';
            // No affordable bet means the opponent is broke; the modal must then
            // offer a way out. If it doesn't, that is the old hard lock.
            const out = byId('btn-duel-skip');
            if (out && out.offsetParent !== null) return tap(out, 'duel no-wager continue') && 'DUEL_SKIP';
            note('STUCK', 'duel modal open with no enabled bet buttons and no exit');
            return 'DUEL_NO_OPTION';
        }
        if (visId('drop-modal')) {
            // Two presses now: a card only SELECTS, and DISCARD commits. Tapping
            // a card and walking away used to be enough, which meant this branch
            // silently stopped resolving when the picker gained its confirm.
            const confirm = byId('btn-confirm-drop');
            if (confirm && !confirm.disabled) return tap(confirm, 'drop confirm') && 'DROP';
            const items = [...byId('drop-inv-row').querySelectorAll('[data-drop-idx]')];
            if (items.length && Math.random() < 0.85) {
                return tap(items[Math.floor(Math.random() * items.length)], 'drop select') && 'DROP_SELECT';
            }
            return tap(byId('btn-cancel-drop'), 'drop cancel') && 'DROP_CANCEL';
        }
        if (visId('custom-dice-modal')) {
            const picks = [...byId('custom-dice-modal').querySelectorAll('[data-pick]')];
            return tap(picks[Math.floor(Math.random() * picks.length)], 'custom dice') && 'CUSTOM_DICE';
        }
        if (visId('use-modal')) {
            const items = [...byId('use-inv-row').querySelectorAll('[data-use-idx]')];
            if (items.length) return tap(items[Math.floor(Math.random() * items.length)], 'use item') && 'USE_ITEM';
            return tap(byId('btn-cancel-use'), 'use cancel') && 'USE_CANCEL';
        }
        if (visId('shop-offer-modal')) {
            const b = Math.random() < 0.5 ? byId('btn-shop-offer-enter') : byId('btn-shop-offer-skip');
            return tap(b, 'shop offer') && 'SHOP_OFFER';
        }
        if (visId('shop-modal')) {
            const buys = [...byId('shop-items-list').querySelectorAll('.btn-buy:not([disabled])')];
            if (buys.length && Math.random() < 0.55) return tap(buys[Math.floor(Math.random() * buys.length)], 'buy') && 'BUY';
            return tap(byId('btn-close-shop'), 'leave shop') && 'SHOP_LEAVE';
        }
        if (visId('pass-modal')) return tap(byId('btn-resolve-pass'), 'pass ready') && 'PASS';
        if (visId('msg-modal')) {
            // With autoAck off, leave the bot's result card alone so its full
            // dwell can be measured. A human doesn't have to tap it either — it
            // times out on its own.
            if (!autoAck && S.players[S.activePlayer] && S.players[S.activePlayer].isBot) return 'MSG_WAIT';
            return tap(byId('btn-msg-continue'), 'msg continue') && 'MSG';
        }

        // 6. Map view open -> close
        if (visId('map-ui')) return tap(byId('btn-close-map'), 'close map') && 'MAP_CLOSE';

        // 7. Normal turn: roll (occasionally poke items/map to exercise them)
        if (S.gameState === 'PRE_ROLL') {
            const pid = S.activePlayer;
            if (S.players[pid].isBot) return 'BOT_TURN';
            const roll = document.querySelector(`[data-roll="${pid}"]`);
            if (vis(roll) && !roll.disabled) {
                const r = Math.random();
                if (r < 0.05) { const m = document.querySelector(`[data-map="${pid}"]`); if (vis(m)) return tap(m, 'open map') && 'MAP_OPEN'; }
                if (r < 0.14 && S.players[pid].inv.length) { const it = document.querySelector(`[data-items="${pid}"]`); if (vis(it)) return tap(it, 'open items') && 'ITEMS_OPEN'; }
                if (r < 0.20) { const cb = document.querySelector(`[data-cabbie="${pid}"]`); if (vis(cb)) return tap(cb, 'cabbie') && 'CABBIE'; }
                if (r < 0.25) { const bq = document.querySelector(`[data-bounties="${pid}"]`); if (vis(bq)) return tap(bq, 'open bounties') && 'BOUNTY_OPEN'; }
                return tap(roll, 'roll') && 'ROLL';
            }
            return 'PRE_ROLL_NO_BTN';
        }
        return 'WAIT:' + S.gameState;
    }

    // Generic minigame input: taps + drags, alternating between the two halves.
    //
    // This used to hammer P1's half only. That was invisible for as long as every
    // game had a clock that carried it along regardless — but a turn-based game
    // needs BOTH players to act, so Four in a Row, Memory Match and Penalty were
    // only ever finishing because a timer took the move for the side the agent
    // never touched. Remove the timers and the sweep stalls on P2's turn
    // forever. Driving both halves is what "plays every game" was supposed to
    // mean, and it exercises both input paths besides.
    function mgPlay() {
        const layer = byId('minigame-layer');
        const overlay = [...layer.children].find(el => !el.id) || layer;
        const r = layer.getBoundingClientRect();
        const bottom = mgTapPhase % 4 < 2;      // two goes each, so drags land in one half
        const y0 = r.top + r.height * (bottom ? 0.55 : 0.06);
        const y1 = r.top + r.height * (bottom ? 0.94 : 0.45);
        const x = r.left + r.width * (0.1 + Math.random() * 0.8);
        const y = y0 + Math.random() * (y1 - y0);
        const target = document.elementFromPoint(Math.round(x), Math.round(y)) || overlay;
        const mk = (type, cx, cy) => new PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: cx, clientY: cy,
            pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1,
        });
        target.dispatchEvent(mk('pointerdown', x, y));
        // Half the time drag, half the time quick tap (covers drag & tap games).
        if (mgTapPhase++ % 2 === 0) {
            for (let i = 1; i <= 3; i++) {
                const nx = x + (Math.random() - 0.5) * 90, ny = y + (Math.random() - 0.5) * 60;
                target.dispatchEvent(mk('pointermove', nx, ny));
            }
        }
        target.dispatchEvent(mk('pointerup', x, y));
        acted++; lastActionAt = Date.now();
    }

    // ---------- menu navigation ----------
    // The City briefing holds the match at gameState 'INIT' until somebody
    // presses START — correct for a player, fatal for the many probes that call
    // startRun and then wait on state without driving step(). The harness
    // dismisses it automatically; `keepBriefing: true` opts out, which is what
    // city.js (the probe that actually tests the briefing) passes.
    function _autoDismissBriefing() {
        const el = byId('city-briefing');
        if (!el) return;
        const iv = setInterval(() => {
            if (getComputedStyle(el).display === 'none') return;
            const go = byId('btn-cb-start');
            if (go) { tap(go, 'auto-dismiss briefing'); clearInterval(iv); }
        }, 150);
        setTimeout(() => clearInterval(iv), 90000);
    }

    // The character each seat picks, in seat order. Nine are available; taking
    // them off the front guarantees no two seats want the same one, which the
    // screen forbids.
    const SEAT_CHARS = ['slime', 'ghost', 'boxy', 'bunny', 'cabbie', 'vendor', 'banker', 'bodyguard', 'investor'];

    function startRun(opts) {
        if (!opts.keepBriefing) _autoDismissBriefing();
        const modeBtn = document.querySelector(`[data-mode="${opts.mode}"]`);
        tap(modeBtn, 'mode ' + opts.mode);
        if (opts.mode === '1p' && opts.difficulty) tap(document.querySelector(`[data-diff="${opts.diff || opts.difficulty}"]`), 'diff');
        // Seat count, for the modes that offer it. Anything else is two.
        const seats = Math.max(2, Math.min(4, opts.players || 2));
        if (seats > 2) {
            const pc = document.querySelector(`[data-players="${seats}"]`);
            if (pc) tap(pc, 'players ' + seats);
        }
        tap(byId('btn-next'), 'next');
        // Character select: one step per human seat. 1P picks for the bot.
        const humanSeats = opts.mode === '1p' ? 1 : seats;
        for (let i = 0; i < humanSeats; i++) {
            const want = (i === 0 ? opts.char1 : i === 1 ? opts.char2 : null) || SEAT_CHARS[i];
            const cardEl = document.querySelector(`[data-char="${want}"]`);
            tap(cardEl || document.querySelector(`[data-char="${SEAT_CHARS[i]}"]`), 'char' + (i + 1));
            tap(byId('btn-char-confirm'), 'confirm char' + (i + 1));
        }
        // map select
        const card = document.querySelector(`[data-map-id="${opts.map}"]`);
        if (card) tap(card, 'map ' + opts.map);
        if (opts.map === 'hundred_block_dash' && opts.len) {
            const c = document.querySelector(`[data-hbd-len="${opts.len}"]`);
            if (c) tap(c, 'len ' + opts.len);
        }
        // City match length. A four-player match at 12 rounds is 48 board turns
        // plus 12 minigames — too long for a probe budget, so the seat-count
        // configs ask for the short one.
        if (opts.map === 'city_circuit' && opts.rounds) {
            const c = document.querySelector(`[data-city-rounds="${opts.rounds}"]`);
            if (c) tap(c, 'rounds ' + opts.rounds);
        }
        tap(byId('btn-map-confirm'), 'go');
    }

    return {
        bind, step, snapshot, startRun, setMinigameFastResolve, launchArcade, setAutoAckResults,
        // Scene-graph / GPU-object census — used to prove or disprove leak claims.
        sceneCensus: async () => {
            const R = await import('/src/engine/Renderer.js');
            let meshes = 0, materials = 0, geos = 0;
            const seenM = new Set(), seenG = new Set();
            // The camera is NOT a child of the scene in this renderer, so
            // walking up from it to find a root found only the camera — this
            // census counted zero meshes for months while reporting "no leak".
            // Ask the renderer for the scene.
            const root = R.getScene ? R.getScene() : null;
            (root ? [root] : []).forEach(function walk(o) {
                o.traverse(n => {
                    if (n.isMesh || n.isPoints || n.isLine) {
                        meshes++;
                        if (n.geometry && !seenG.has(n.geometry.uuid)) { seenG.add(n.geometry.uuid); geos++; }
                        const ms = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
                        ms.forEach(m => { if (!seenM.has(m.uuid)) { seenM.add(m.uuid); materials++; } });
                    }
                });
            });
            return { meshes, materials, geos, activeAnims: R.getActiveAnims().length };
        },
        report: () => ({
            acted, lastActionAt,
            states: [...seenStates], spaceTypes: [...seenSpaceTypes], minigames: [...seenMinigames],
            invariantViolations, log: log.slice(-160),
        }),
        resetLog: () => { log.length = 0; },
    };
})();
