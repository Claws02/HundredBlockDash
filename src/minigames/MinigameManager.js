// ============================================================
// MINIGAME MANAGER — intro sequence, orientation, countdown,
// and the final win/lose handoff back to GameController.
// Adding a new minigame: register it in MinigameRegistry.js
// and create a new file in src/minigames/. That's it.
// ============================================================

import { state } from '../core/GameState.js';
import { MG_TYPES, MG_INFO, MG_ORIENTATIONS, MG_ORIENTATION_MAP } from '../config/MinigameRegistry.js';
import { MINIGAME_REWARD } from '../config/GameConfig.js';
import { sfx, haptic } from '../engine/AudioManager.js';

// Lazy-loaded minigame modules
const MG_MODULES = {
    sumospheres: () => import('./SumoSpheres.js'),
    tankclash:   () => import('./TankClash.js'),
    rhythmforge: () => import('./RhythmForge.js'),
    orbdeflect:  () => import('./OrbDeflect.js'),
};

let _controller   = null;
let _onComplete   = null;
let _botTraceInt  = null;
let _standaloneMode = false;
let _countdownActive = false;
let _countdownIv  = null;
let _botReadyTimeout = null;
let _minigameTimeout = null;
const _minigameCleanups = [];

export function init(controller) {
    _controller = controller;
    document.getElementById('mg-ready-1').addEventListener('pointerdown', e => { e.preventDefault(); setReady(0); });
    document.getElementById('mg-ready-2').addEventListener('pointerdown', e => { e.preventDefault(); setReady(1); });
    document.getElementById('btn-mg-intro-next').addEventListener('pointerdown', e => { e.preventDefault(); mgIntroNext(); });
    document.getElementById('btn-mg-launch').addEventListener('pointerdown', e => { e.preventDefault(); launchMinigameUI(); });

    const blockBrowserGestures = e => {
        if (state.gameState === 'MINIGAME' || state.gameState === 'MINIGAME_INTRO') e.preventDefault();
    };
    document.addEventListener('touchstart', blockBrowserGestures, { passive: false });
    document.addEventListener('touchmove', blockBrowserGestures, { passive: false });
    document.addEventListener('gesturestart', blockBrowserGestures, { passive: false });
    document.addEventListener('contextmenu', blockBrowserGestures);

    document.addEventListener('visibilitychange', () => {
        if (state.gameState === 'MINIGAME' && document.hidden) {
            document.getElementById('mg-neutral').textContent = 'PAUSED BY BROWSER';
        }
    });
}

// ---- Standalone entry point (called from minigame selector on main screen) ----

export function triggerStandalone(mgType) {
    _standaloneMode = true;
    _onComplete = () => {
        document.getElementById('mg-select-overlay').style.display = 'flex';
    };

    state.gameState   = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    state.mgType      = mgType;
    state.players[1].isBot = false;

    document.getElementById('mg-select-overlay').style.display = 'none';
    document.getElementById('mg-intro-overlay').style.display  = 'flex';
    document.getElementById('mg-countdown').style.display      = 'none';
    document.getElementById('mg-page-info').style.display      = 'block';
    document.getElementById('mg-page-hold').style.display      = 'none';
    [0, 1, 2].forEach(i => document.getElementById(`mg-step-${i}`).classList.remove('done'));

    const info = MG_INFO[mgType];
    document.getElementById('mg-intro-icon').textContent  = info.icon;
    document.getElementById('mg-intro-title').textContent = info.title;
    document.getElementById('mg-intro-desc').textContent  = info.desc;
    document.getElementById('mg-step-0').classList.add('done');
    sfx('mg_start');
}

// ---- Entry point called by GameController ----

export function trigger(onComplete) {
    _onComplete = onComplete;
    state.gameState  = 'MINIGAME_INTRO';
    state.cameraState = 'MINIGAME';
    state.mgType = MG_TYPES[Math.floor(Math.random() * MG_TYPES.length)];

    document.getElementById('ui-layer').style.display  = 'none';
    document.getElementById('mg-intro-overlay').style.display = 'flex';
    document.getElementById('mg-countdown').style.display = 'none';
    document.getElementById('mg-page-info').style.display  = 'block';
    document.getElementById('mg-page-hold').style.display  = 'none';
    [0, 1, 2].forEach(i => document.getElementById(`mg-step-${i}`).classList.remove('done'));

    const titleEl = document.getElementById('mg-intro-title');
    titleEl.textContent = 'SELECTING...';
    document.getElementById('mg-intro-desc').textContent = '';

    const allNames = Object.values(MG_INFO).map(m => m.title);
    let ticks = 0;
    const iv = setInterval(() => {
        titleEl.textContent = allNames[Math.floor(Math.random() * allNames.length)];
        if (++ticks >= 15) {
            clearInterval(iv);
            const info = MG_INFO[state.mgType];
            document.getElementById('mg-intro-icon').textContent   = info.icon;
            titleEl.textContent = info.title;
            document.getElementById('mg-intro-desc').textContent   = info.desc;
            document.getElementById('mg-step-0').classList.add('done');
            sfx('mg_start');
        }
    }, 100);

    if (state.players[1].isBot) {
        setTimeout(() => {
            if (state.gameState === 'MINIGAME_INTRO') { mgIntroNext(); setTimeout(launchMinigameUI, 800); }
        }, 3000);
    }
}

// ---- Step 2: orientation screen ----

function mgIntroNext() {
    document.getElementById('mg-page-info').style.display = 'none';
    document.getElementById('mg-page-hold').style.display = 'block';
    document.getElementById('mg-step-1').classList.add('done');
    _renderOrientationDiagram(state.mgType);
}

function _renderOrientationDiagram(mgTypeKey) {
    const orientKey = MG_ORIENTATION_MAP[mgTypeKey] || 'faceoff';
    const orient    = MG_ORIENTATIONS[orientKey];
    document.getElementById('orient-name').textContent    = orient.name;
    document.getElementById('orient-subtitle').textContent = orient.subtitle;
    document.getElementById('orient-instructions').innerHTML = orient.instructions;
    const diag = document.getElementById('phone-diagram');
    diag.innerHTML = '';
    diag.className = 'phone-diagram' + (orient.huddle ? ' huddle' : '');
    if (orient.huddle) {
        diag.innerHTML = `<div class="ph-body"></div><div class="ph-screen" style="inset:8px 12px;"><div style="width:100%;height:100%;background:linear-gradient(90deg,rgba(255,59,59,.08),rgba(59,142,255,.08));display:flex;align-items:center;justify-content:center;font-size:22px;letter-spacing:2px;font-family:'Bebas Neue';color:rgba(255,255,255,.3);">CARDS</div></div><div class="ph-grip holder" style="left:-3px;top:-3px;bottom:-3px;right:auto;width:36px;height:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:18px 4px 4px 18px;background:rgba(255,59,59,.85);border:2px solid #ff3b3b;"><span style="font-size:11px;font-family:'Bebas Neue';color:#fff;writing-mode:vertical-rl;text-orientation:mixed;">P1</span></div>`;
    } else {
        const anim1 = orient.thumbAnim === 'strike' ? 'strike'     : 'pulse';
        const anim2 = orient.thumbAnim === 'strike' ? 'strike-rot' : 'pulse-rot';
        diag.innerHTML = `<div class="ph-body"></div><div class="ph-camera"></div><div class="ph-screen"><div class="ph-screen-p2"><span style="font-size:11px;font-family:'Bebas Neue';color:rgba(59,142,255,.6);letter-spacing:1px;">P2 ZONE</span></div><div class="ph-divider"></div><div class="ph-screen-p1"><span style="font-size:11px;font-family:'Bebas Neue';color:rgba(255,59,59,.6);letter-spacing:1px;">P1 ZONE</span></div></div><div class="ph-home"></div><div class="ph-grip p1"><span>👍</span><span>P1</span></div><div class="ph-grip p2"><span>P2</span><span>👍</span></div><div class="ph-thumb p1 ${anim1}" style="left:50%;transform:translateX(-50%);">👆</div><div class="ph-thumb p2 ${anim2}" style="left:50%;transform:translateX(-50%) rotate(180deg);">👆</div>`;
    }
}

// ---- Step 3: launch the actual game ----

function launchMinigameUI() {
    document.getElementById('mg-page-hold').style.display  = 'none';
    document.getElementById('mg-step-2').classList.add('done');
    document.getElementById('mg-intro-overlay').style.display = 'none';
    _startMinigameLayer();
}

function _startMinigameLayer() {
    _runMinigameCleanups();
    clearTimeout(_minigameTimeout);
    clearInterval(_countdownIv); _countdownIv = null;
    clearTimeout(_botReadyTimeout); _botReadyTimeout = null;
    _countdownActive = false;
    state.gameState = 'MINIGAME';
    document.getElementById('minigame-layer').style.display = 'flex';
    state.mgReady  = [false, false];
    state.mgActive = false;

    // Hide all minigame content elements
    const hideSelectors = [
        '.math-question', '.math-answers', '.trivia-q', '.trivia-grid',
        '.trace-container', '.reaction-zone', '.color-word', '.color-btns',
        '.color-round-label', '.memory-grid', '.mem-score', '.seq-display',
        '.seq-btns', '.cd-timer', '.cd-tap-zone', '.cd-result',
        '.shape-target-label', '.shape-grid', '.ooo-label', '.ooo-grid',
        '.hl-secret', '.hl-feedback', '.hl-guesses-left', '.hl-input-row',
        // New games
        '.pulse-zone', '.pulse-score', '.grid-recall', '.grid-recall-score',
        '.ws-scramble', '.ws-options', '.ws-score',
        '.cr-word', '.cr-tap-zone', '.cr-score',
        '.rhythm-zone', '.rhythm-score',
        '.ss-grid', '.ss-score',
        '.fs-arena', '.fs-score',
        '.cb-history', '.cb-btns', '.cb-score',
        '.sm-options', '.sm-score',
        '.tt-zone', '.tt-score',
        '.mm-source', '.mm-options', '.mm-score',
        '.bb-canvas', '.bb-prompt', '.bb-score',
    ].join(',');
    document.querySelectorAll(hideSelectors).forEach(e => e.style.display = 'none');

    [1, 2].forEach(i => {
        const rd = document.getElementById(`mg-ready-${i}`);
        rd.style.display = 'block'; rd.classList.remove('ready'); rd.textContent = 'READY';
    });
    document.getElementById('mg-neutral').textContent = 'BOTH PLAYERS TAP READY!';

    if (state.players[1].isBot) _botReadyTimeout = setTimeout(() => { _botReadyTimeout = null; setReady(1); }, 800);
}

// ---- Ready + countdown ----

export function setReady(pid) {
    if (_countdownActive || state.mgReady?.[pid]) return;
    state.mgReady[pid] = true;
    const btn = document.getElementById(`mg-ready-${pid + 1}`);
    btn.classList.add('ready'); btn.textContent = '✓ READY';
    sfx('countdown');

    if (state.mgReady[0] && state.mgReady[1]) {
        _countdownActive = true;
        document.getElementById('mg-neutral').textContent = 'GET SET...';
        const cd = document.getElementById('mg-countdown');
        cd.style.display = 'block'; cd.textContent = '3'; sfx('countdown');
        document.getElementById('minigame-layer').appendChild(cd);
        let count = 3;
        _countdownIv = setInterval(() => {
            count--;
            if (count > 0) {
                cd.textContent = count; cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = 'countPop .4s ease'; sfx('countdown');
            } else if (count === 0) {
                cd.textContent = 'GO!'; cd.style.animation = 'none'; void cd.offsetWidth; cd.style.animation = 'countPop .4s ease'; sfx('go');
            } else {
                clearInterval(_countdownIv); _countdownIv = null;
                cd.style.display = 'none';
                [1, 2].forEach(i => document.getElementById(`mg-ready-${i}`).style.display = 'none');
                state.mgActive = true;
                document.getElementById('mg-neutral').textContent = 'MINIGAME TIME';
                _launchGame();
            }
        }, 900);
    }
}

async function _launchGame() {
    try {
        const loader = MG_MODULES[state.mgType] || MG_MODULES.math;
        const mod    = await loader();
        _minigameTimeout = setTimeout(() => {
            if (state.gameState === 'MINIGAME' && state.mgActive) {
                document.getElementById('mg-neutral').textContent = 'TIME\'S UP! TIE!';
                sfx('land_bad');
                winMinigame(-1);
            }
        }, 45000);
        mod.start(state.players[1].isBot, winMinigame);
    } catch (e) {
        console.error('[MinigameManager] _launchGame failed:', e);
        endMinigame(-1);
    }
}

// ---- Win / end ----

const MINIGAME_TIE_REWARD = Math.floor(MINIGAME_REWARD / 2); // 5 coins each on tie

export function winMinigame(winnerId) {
    if (!state.mgActive) return;
    state.mgActive = false;
    if (winnerId < 0) {
        // TIE — both players get coins, coin flip decides who goes first
        const flipWinner = Math.random() < 0.5 ? 0 : 1;
        state.players.forEach(p => {
            p.coins += MINIGAME_TIE_REWARD;
            p.coinsEarned += MINIGAME_TIE_REWARD;
        });
        import('../ui/UIManager.js').then(({ animateCoinDisplay, toast, updateUI }) => {
            state.players.forEach((p, i) => animateCoinDisplay(i, p.coins));
            toast(`🤝 TIE! Both get ${MINIGAME_TIE_REWARD} coins — coin flip: ${state.players[flipWinner].name} goes first!`, '#a855f7');
            updateUI();
        });
        sfx('coin_gain');
        document.getElementById('mg-neutral').textContent = `TIE! 🪙 BOTH +${MINIGAME_TIE_REWARD} — COIN FLIP!`;
        // Flash both player zones
        const z1 = document.getElementById('mg-p1');
        const z2 = document.getElementById('mg-p2');
        z1?.classList.add('mg-victory');
        z2?.classList.add('mg-victory');
        state.lastMinigameTied = true;
        setTimeout(() => {
            z1?.classList.remove('mg-victory');
            z2?.classList.remove('mg-victory');
            document.getElementById('mg-neutral').textContent = `${state.players[flipWinner].name.toUpperCase()} GOES FIRST!`;
            setTimeout(() => endMinigame(flipWinner), 600);
        }, 700);
        return;
    }
    const winner = state.players[winnerId];
    winner.mgWins++;
    winner.coins += MINIGAME_REWARD;
    winner.coinsEarned += MINIGAME_REWARD;
    import('../ui/UIManager.js').then(({ animateCoinDisplay, toast, updateUI }) => {
        animateCoinDisplay(winnerId, winner.coins);
        toast(`🏆 ${winner.name} wins ${MINIGAME_REWARD} coins and goes first!`, '#f5c842');
        updateUI();
    });
    sfx('mg_win');
    const winZone  = document.getElementById(`mg-p${winnerId + 1}`);
    const loseZone = document.getElementById(`mg-p${2 - winnerId}`);
    winZone?.classList.add('mg-victory');
    loseZone?.classList.add('mg-defeat');
    document.getElementById('mg-neutral').textContent = `${winner.name.toUpperCase()} WINS! +${MINIGAME_REWARD} 🪙`;
    setTimeout(() => {
        winZone?.classList.remove('mg-victory');
        loseZone?.classList.remove('mg-defeat');
        endMinigame(winnerId);
    }, 800);
}

export function endMinigame(winnerId) {
    clearTimeout(_minigameTimeout);
    _minigameTimeout = null;
    clearInterval(_botTraceInt);
    _botTraceInt = null;
    _runMinigameCleanups();
    state.mgActive = false;
    document.getElementById('minigame-layer').style.display = 'none';

    if (_standaloneMode) {
        _standaloneMode = false;
        state.gameState   = 'INIT';
        state.cameraState = 'INIT';
        if (_onComplete) _onComplete(winnerId);
        return;
    }

    document.getElementById('ui-layer').style.display = 'block';
    state.cameraState = 'FLYOVER';
    state.gameState   = 'MINIGAME_ACK';
    state.lastMinigameWinner = winnerId;
    if (_onComplete) _onComplete(winnerId);
}

export function getBotTraceIntervalRef() { return { set: v => { _botTraceInt = v; }, get: () => _botTraceInt }; }

export function registerMinigameCleanup(fn) {
    if (typeof fn === 'function') _minigameCleanups.push(fn);
}

function _runMinigameCleanups() {
    while (_minigameCleanups.length) {
        try { _minigameCleanups.pop()(); } catch (e) { console.warn('[MinigameManager] cleanup failed:', e); }
    }
}
