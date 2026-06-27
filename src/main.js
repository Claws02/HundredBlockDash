import * as GameController from './core/GameController.js';
import * as UIManager from './ui/UIManager.js';
import * as ModalManager from './ui/ModalManager.js';
import * as MinigameManager from './minigames/MinigameManager.js';
import * as Settings from './core/Settings.js';
import * as Onboarding from './ui/Onboarding.js';
import * as Storage from './core/Storage.js';
import { MG_INFO, MG_TYPES } from './config/MinigameRegistry.js';

window.addEventListener('error', e => {
    console.error('[HundredBlockDash] Uncaught error:', e.message, e.filename, e.lineno);
});
window.addEventListener('unhandledrejection', e => {
    console.error('[HundredBlockDash] Unhandled promise rejection:', e.reason);
});

// Wire all managers with the controller reference
Settings.init();          // load + apply audio/motion prefs before anything plays
UIManager.init(GameController);
ModalManager.init(GameController);
MinigameManager.init(GameController);
Onboarding.init();
Onboarding.refreshSplashStats();

// ============================================================
// REMATCH FAST-PATH & FIRST-RUN ONBOARDING
// ============================================================

if (Storage.load('intent', null) === 'rematch') {
    Storage.remove('intent');
    const prefs = Storage.load('prefs', null);
    // If the saved setup can't launch, fall through to the normal splash.
    if (!GameController.quickStart(prefs)) Onboarding.maybeShowFirstRun();
} else {
    Onboarding.maybeShowFirstRun();
}

// Splash: how-to-play / settings
document.getElementById('btn-how-to-play').addEventListener('click', () => Onboarding.openHowToPlay());
document.getElementById('btn-settings').addEventListener('click', () => Onboarding.openSettings());
// In-game rules reference
document.getElementById('btn-rules').addEventListener('click', () => Onboarding.openRules());

// ============================================================
// SPLASH SCREEN
// ============================================================

document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mode]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectMode(btn.dataset.mode);
        // Bot difficulty only applies when playing against the bot
        document.getElementById('difficulty-select').style.display =
            btn.dataset.mode === '1p' ? 'block' : 'none';
    });
});

document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectDifficulty(btn.dataset.diff);
    });
});

document.getElementById('btn-next').addEventListener('click', () => GameController.goToCharSelect());

// ============================================================
// CHARACTER SELECT
// ============================================================

document.querySelectorAll('[data-char]').forEach(card => {
    card.addEventListener('click', () => {
        document.querySelectorAll('[data-char]').forEach(c => c.classList.remove('sel'));
        card.classList.add('sel');
        GameController.selectChar(card.dataset.char);
    });
});

document.getElementById('btn-char-confirm').addEventListener('click', () => GameController.confirmCharSelect());

// ============================================================
// MAP SELECT
// ============================================================

// Map cards are generated dynamically by GameController._populateMapSelectScreen
// so we use event delegation on the grid container
document.getElementById('map-select-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-map-id]');
    if (card && !card.hasAttribute('aria-disabled')) GameController.selectMap(card.dataset.mapId);
});

document.getElementById('btn-map-confirm').addEventListener('click', () => GameController.confirmMapSelect());

// HBD run-length chips (50 / 75 / 100)
document.querySelectorAll('[data-hbd-len]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-hbd-len]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectHbdLength(parseInt(btn.dataset.hbdLen));
    });
});

// ============================================================
// HUD ACTION BUTTONS
// ============================================================

document.querySelectorAll('[data-roll]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.roll);
        if (!GameController.isMyTurn(pid)) return;
        btn.disabled = true;
        setTimeout(() => { btn.disabled = false; }, 1500);
        GameController.executeRoll(1.2);
    });
});

document.querySelectorAll('[data-map]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.map);
        if (!GameController.isMyTurn(pid)) return;
        UIManager.openMap();
    });
});

document.querySelectorAll('[data-items]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.items);
        if (!GameController.isMyTurn(pid)) return;
        ModalManager.openUseModal();
    });
});

document.querySelectorAll('[data-cabbie]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.cabbie);
        if (!GameController.isMyTurn(pid)) return;
        GameController.activateCabbie(pid);
    });
});

// ============================================================
// GATE OVERLAY  (not managed by ModalManager)
// ============================================================

document.getElementById('gate-roll-btn').addEventListener('click', () => GameController.rollGate());
document.getElementById('gate-continue-btn').addEventListener('click', () => GameController.closeGate());

// ============================================================
// WIN SCREEN
// ============================================================

document.getElementById('btn-rematch').addEventListener('click', () => GameController.rematch());
document.getElementById('btn-main-menu').addEventListener('click', () => GameController.mainMenu());

// ============================================================
// MINIGAME ARCADE SELECTOR
// ============================================================

let _selectedMgType = null;

function _populateMgGrid() {
    const grid = document.getElementById('mg-sel-grid');
    grid.innerHTML = '';
    MG_TYPES.forEach(type => {
        const info = MG_INFO[type];
        const card = document.createElement('div');
        card.className = 'mg-sel-card';
        card.dataset.type = type;
        card.innerHTML =
            `<span class="mg-sel-icon">${info.icon}</span>` +
            `<span class="mg-sel-name bfont">${info.title}</span>` +
            `<span class="mg-sel-desc">${info.desc}</span>`;
        card.addEventListener('click', () => {
            document.querySelectorAll('.mg-sel-card').forEach(c => c.classList.remove('sel'));
            card.classList.add('sel');
            _selectedMgType = type;
            document.getElementById('btn-mg-select-play').disabled = false;
        });
        grid.appendChild(card);
    });
}

document.getElementById('btn-minigames').addEventListener('click', () => {
    _selectedMgType = null;
    document.getElementById('btn-mg-select-play').disabled = true;
    _populateMgGrid();
    document.getElementById('splash').style.display = 'none';
    document.getElementById('mg-select-overlay').style.display = 'flex';
});

document.getElementById('btn-mg-select-back').addEventListener('click', () => {
    document.getElementById('mg-select-overlay').style.display = 'none';
    document.getElementById('splash').style.display = '';
});

document.getElementById('btn-mg-select-play').addEventListener('click', () => {
    if (!_selectedMgType) return;
    MinigameManager.triggerStandalone(_selectedMgType);
});
