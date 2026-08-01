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
    let S = null, GC = null, CFG = null, MGM = null, REG = null;
    async function bind() {
        S = (await import('/src/core/GameState.js')).state;
        GC = await import('/src/core/GameController.js');
        CFG = await import('/src/config/GameConfig.js');
        MGM = await import('/src/minigames/MinigameManager.js');
        REG = await import('/src/config/MinigameRegistry.js');
        return REG.MG_TYPES.slice();
    }
    // Board-loop mode: after `ms` of genuine play, force the minigame to resolve so
    // full board games finish inside a test budget. Minigames get their own runs.
    let mgFastMs = 0, mgStartedAt = 0, mgLast = '';
    function setMinigameFastResolve(ms) { mgFastMs = ms; }
    function launchArcade(type) { MGM.triggerStandalone(type); }

    function snapshot() {
        if (!S) return {};
        const p = S.players;
        return {
            gameState: S.gameState, activePlayer: S.activePlayer, totalTurns: S.totalTurns,
            round: S.currentRound, map: S.selectedMap, mgType: S.mgType, mgActive: S.mgActive,
            gateOpen: S.gateOpen, allyOnMap: S.allyOnMap && S.allyOnMap.allyType,
            contracts: (S.activeContracts || []).map(c => c.id + ':' + (c._progress || 0)),
            p: p.map(x => ({ pos: x.pos, coins: x.coins, inv: x.inv.slice(),
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

        // 2. Minigame flow
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

        // 4. Branch / path choice
        if (visId('branch-choice-overlay')) {
            const cards = [...byId('branch-cards').querySelectorAll('[data-node]')];
            if (cards.length) return tap(cards[Math.floor(Math.random() * cards.length)], 'branch') && 'BRANCH';
        }

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
            note('STUCK', 'duel modal open with no enabled bet buttons and no exit');
            return 'DUEL_NO_OPTION';
        }
        if (visId('drop-modal')) {
            const items = [...byId('drop-inv-row').querySelectorAll('[data-drop-idx]')];
            if (items.length && Math.random() < 0.7) return tap(items[0], 'drop item') && 'DROP';
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
        if (visId('msg-modal')) return tap(byId('btn-msg-continue'), 'msg continue') && 'MSG';

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
                return tap(roll, 'roll') && 'ROLL';
            }
            return 'PRE_ROLL_NO_BTN';
        }
        return 'WAIT:' + S.gameState;
    }

    // Generic minigame input: hammer P1's half with taps + drags.
    function mgPlay() {
        const layer = byId('minigame-layer');
        const overlay = [...layer.children].find(el => !el.id) || layer;
        const r = layer.getBoundingClientRect();
        const y0 = r.top + r.height * 0.55, y1 = r.top + r.height * 0.95;
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
    function startRun(opts) {
        const modeBtn = document.querySelector(`[data-mode="${opts.mode}"]`);
        tap(modeBtn, 'mode ' + opts.mode);
        if (opts.mode === '1p' && opts.difficulty) tap(document.querySelector(`[data-diff="${opts.difficulty}"]`), 'diff');
        tap(byId('btn-next'), 'next');
        // char select (1 or 2 steps)
        tap(document.querySelector(`[data-char="${opts.char1 || 'slime'}"]`), 'char1');
        tap(byId('btn-char-confirm'), 'confirm char1');
        if (opts.mode !== '1p') {
            tap(document.querySelector(`[data-char="${opts.char2 || 'ghost'}"]`), 'char2');
            tap(byId('btn-char-confirm'), 'confirm char2');
        }
        // map select
        const card = document.querySelector(`[data-map-id="${opts.map}"]`);
        if (card) tap(card, 'map ' + opts.map);
        if (opts.map === 'hundred_block_dash' && opts.len) {
            const c = document.querySelector(`[data-hbd-len="${opts.len}"]`);
            if (c) tap(c, 'len ' + opts.len);
        }
        tap(byId('btn-map-confirm'), 'go');
    }

    return {
        bind, step, snapshot, startRun, setMinigameFastResolve, launchArcade,
        // Scene-graph / GPU-object census — used to prove or disprove leak claims.
        sceneCensus: async () => {
            const R = await import('/src/engine/Renderer.js');
            let meshes = 0, materials = 0, geos = 0;
            const seenM = new Set(), seenG = new Set();
            const cam = R.getCamera();
            let root = cam; while (root && root.parent) root = root.parent;
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
