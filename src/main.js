import * as GameController from './core/GameController.js';
import * as UIManager from './ui/UIManager.js';
import * as ModalManager from './ui/ModalManager.js';
import * as MinigameManager from './minigames/MinigameManager.js';
import * as Settings from './core/Settings.js';
import * as Onboarding from './ui/Onboarding.js';
import * as Storage from './core/Storage.js';
import * as Commands from './core/Commands.js';
import { MG_INFO, MG_TYPES } from './config/MinigameRegistry.js';
import * as Lobby from './ui/Lobby.js';
import * as NetGame from './net/NetGame.js';
import * as Session from './net/NetSession.js';

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
// ONLINE
// ============================================================
// The lobby settles WHO is playing; the map screens that already exist settle
// WHAT is being played. So START in the lobby does not begin a match — it hands
// the host to the map picker, and the match begins when that is confirmed,
// which is also the moment every client learns the setup.
NetGame.init(GameController);
Lobby.init(GameController, () => {
    GameController.selectMode('online');
    GameController.selectPlayerCount(Session.seatCount());
    GameController.goToMapSelect();
});

// A link with #join=CODE in it drops straight into that room.
{
    const joinCode = Lobby.codeFromUrl();
    if (joinCode) {
        Lobby.open();
        const input = document.getElementById('lobby-code-input');
        if (input) {
            input.value = joinCode;
            input.dispatchEvent(new Event('input'));
        }
    }
}

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
        // Seats: pass-and-play only (see the note on #players-select). Changing
        // mode resets the count, so the chips are put back to 2 with it.
        const seats = document.getElementById('players-select');
        seats.style.display = btn.dataset.mode === 'pass' ? 'block' : 'none';
        document.querySelectorAll('[data-players]').forEach(b2 =>
            b2.classList.toggle('sel', b2.dataset.players === '2'));
    });
});

document.querySelectorAll('[data-players]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-players]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectPlayerCount(parseInt(btn.dataset.players));
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

document.getElementById('btn-map-confirm').addEventListener('click', () => {
    // Online: the host's confirmation is what starts everybody. NetGame.START
    // carries the setup, and every device (the host included) begins the match
    // from the same message, so nobody starts a beat ahead of anybody else.
    if (Session.isHost() && !Session.started()) {
        document.getElementById('map-select').style.display = 'none';
        NetGame.hostStartMatch();
        return;
    }
    GameController.confirmMapSelect();
});

// HBD run-length chips (50 / 75 / 100)
document.querySelectorAll('[data-hbd-len]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-hbd-len]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectHbdLength(parseInt(btn.dataset.hbdLen));
    });
});

// City Circuit match-length chips (6 / 12 / 20 rounds)
document.querySelectorAll('[data-city-rounds]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-city-rounds]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectCityRounds(parseInt(btn.dataset.cityRounds));
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
        // Through the bus, not straight into the controller: online this leaves
        // the phone as an intent and the HOST throws the dice. Calling
        // executeRoll here would have every client simulate its own roll.
        Commands.run('roll', 1.2);
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

document.querySelectorAll('[data-bounties]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.bounties);
        if (!GameController.isMyTurn(pid)) return;
        UIManager.openBounties();
    });
});

document.querySelectorAll('[data-cabbie]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pid = parseInt(btn.dataset.cabbie);
        if (!GameController.isMyTurn(pid)) return;
        Commands.run('cabbie', pid);
    });
});

// ============================================================
// GATE OVERLAY  (not managed by ModalManager)
// ============================================================

document.getElementById('gate-roll-btn').addEventListener('click', () => Commands.run('gateRoll'));
document.getElementById('gate-continue-btn').addEventListener('click', () => Commands.run('gateClose'));

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
            document.getElementById('btn-mg-select-practice').disabled = false;
        });
        grid.appendChild(card);
    });
}

document.getElementById('btn-minigames').addEventListener('click', () => {
    // A fresh visit to the arcade starts a fresh series.
    MinigameManager.resetArcadeScores();
    _selectedMgType = null;
    document.getElementById('btn-mg-select-play').disabled = true;
    document.getElementById('btn-mg-select-practice').disabled = true;
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

// Practice: the same game against the bot, but nothing is at stake. Returns to
// the arcade grid so the player can go again immediately.
document.getElementById('btn-mg-select-practice').addEventListener('click', () => {
    if (!_selectedMgType) return;
    MinigameManager.triggerPractice(_selectedMgType, true, () => {
        document.getElementById('mg-select-overlay').style.display = 'flex';
    });
});
