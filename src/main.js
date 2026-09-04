import * as GameController from './core/GameController.js';
import * as UIManager from './ui/UIManager.js';
import * as ModalManager from './ui/ModalManager.js';
import * as MinigameManager from './minigames/MinigameManager.js';
import * as Settings from './core/Settings.js';
import * as Onboarding from './ui/Onboarding.js';
import * as Storage from './core/Storage.js';
import * as Commands from './core/Commands.js';
import { MG_INFO, MG_TYPES, MG_GENRES, MG_WIRE_ORDER,
         profileOf, surfacesOf, blockedReason } from './config/MinigameRegistry.js';
import * as Lobby from './ui/Lobby.js';
import * as MinigameLayout from './config/MinigameLayout.js';
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
        // Seats: every local mode that can seat more than two (see the note on
        // #players-select — tabletop is the one that cannot). Changing mode
        // resets the count, so the chips are put back to 2 with it.
        const seats = document.getElementById('players-select');
        seats.style.display = ['pass', '1p'].includes(btn.dataset.mode) ? 'block' : 'none';
        _paintSeatDepth(2);
        document.querySelectorAll('[data-players]').forEach(b2 =>
            b2.classList.toggle('sel', b2.dataset.players === '2'));
    });
});

document.querySelectorAll('[data-players]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-players]').forEach(b => b.classList.remove('sel'));
        btn.classList.add('sel');
        GameController.selectPlayerCount(parseInt(btn.dataset.players));
        _paintSeatDepth(parseInt(btn.dataset.players));
    });
});

/**
 * How many games this screen can deal at this seat count.
 *
 * At three or four players sharing one screen, the games that need a private
 * playfield each only fit if the screen is big enough — 410x544 quarters on a
 * tablet clear the floor, 206x400 quarters on a phone do not. Rather than
 * recommend a tablet and leave the reason implied, say the number.
 */
function _paintSeatDepth(seats) {
    const el = document.getElementById('seat-depth');
    if (!el) return;
    if (seats <= 2) { el.innerHTML = ''; return; }
    const w = Math.max(window.innerWidth || 0, 320);
    const h = Math.max(window.innerHeight || 0, 480);
    const big = MinigameLayout.frameFor(MinigameLayout.SHAPES.SPLIT, seats, w, h).ok;
    const many = MG_TYPES.filter(t => surfacesOf(t).sharedMany);
    const here = big ? many : many.filter(t => surfacesOf(t).manyDevice !== 'tablet');
    el.innerHTML = big
        ? `<b>${here.length} minigames</b> at ${seats} players on a screen this size.`
        : `<b>${here.length} minigames</b> at ${seats} players on a screen this size — ` +
          `a tablet fits ${many.length}, because ${many.length - here.length} of them need a playfield each.`;
}

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
document.getElementById('btn-seat-bot').addEventListener('click', () => GameController.seatAsBot());

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
// The two filters and the sort. Surface is the primary axis — it is what the
// people in the room actually are — and genre is how anybody browses.
let _surface = 'all';       // all | two | many | online
let _genre   = 'all';
let _sort    = 0;           // index into SORTS

// A–Z is the default because it is the one a tester can predict. READINESS is
// the useful one: it orders by how close a game is to playing across devices,
// which is the build queue.
const SORTS = [
    { id: 'az',    label: 'A–Z' },
    { id: 'genre', label: 'GENRE' },
    { id: 'ready', label: 'READINESS' },
];

/** Is `type` playable on the surface currently filtered to? */
function _eligible(type) {
    if (_surface === 'all') return true;
    const s = surfacesOf(type);
    if (_surface === 'many')   return s.sharedMany;
    if (_surface === 'online') return s.online;
    return s.sharedTwo;
}

/** The games the current filters admit, in the current sort order. */
function _filteredTypes() {
    const genreOrder = Object.keys(MG_GENRES);
    const list = MG_TYPES.filter(t => _genre === 'all' || profileOf(t).genre === _genre);
    const sort = SORTS[_sort].id;
    return list.slice().sort((a, b) => {
        // Whatever the sort, playable games come before blocked ones — a grid
        // that opens on four greyed cards reads as broken.
        const ea = _eligible(a), eb = _eligible(b);
        if (ea !== eb) return ea ? -1 : 1;
        if (sort === 'genre') {
            const d = genreOrder.indexOf(profileOf(a).genre) - genreOrder.indexOf(profileOf(b).genre);
            if (d) return d;
        }
        if (sort === 'ready') {
            const d = MG_WIRE_ORDER.indexOf(profileOf(a).wire) - MG_WIRE_ORDER.indexOf(profileOf(b).wire);
            if (d) return d;
        }
        return MG_INFO[a].title.localeCompare(MG_INFO[b].title);
    });
}

function _pipRow(type) {
    const s = surfacesOf(type);
    // Three states, not two: off, on, and on-if-the-screen-is-big-enough. The
    // third is amber and the card spells it out underneath — a glyph inside a
    // 10px pip is not something anybody can read.
    const many = !s.sharedMany ? ''
        : (s.manyDevice === 'tablet' ? ' on-many-tablet' : ' on-many');
    return '<span class="mg-pips">' +
        `<span class="mg-pip on-two">2P</span>` +
        `<span class="mg-pip${many}">3–4</span>` +
        `<span class="mg-pip${s.online ? ' on-online' : ''}">NET</span></span>`;
}

function _populateMgGrid() {
    const grid = document.getElementById('mg-sel-grid');
    grid.innerHTML = '';
    const types = _filteredTypes();
    if (!types.length) {
        grid.innerHTML = '<div class="mg-sel-empty">Nothing in this genre plays on that surface. Try ALL.</div>';
        _paintCount(0, 0);
        return;
    }
    let playable = 0;
    types.forEach(type => {
        const info = MG_INFO[type];
        const okHere = _eligible(type);
        if (okHere) playable++;
        // Blocked games are shown greyed with the reason, never hidden. In a
        // testing area especially, "why is this not here" is the question.
        const why = okHere ? '' : blockedReason(type, _surface);
        // Eligible, but only on a big enough screen. Worth saying on the card
        // while the 3–4P filter is the one being looked at.
        const sf = surfacesOf(type);
        const tabletNote = (okHere && _surface === 'many' && sf.manyDevice === 'tablet')
            ? '<span class="mg-sel-note">Needs a tablet at 3–4.</span>' : '';
        const card = document.createElement('div');
        card.className = 'mg-sel-card' + (okHere ? '' : ' blocked');
        card.dataset.type = type;
        card.innerHTML =
            `<span class="mg-sel-icon">${info.icon}</span>` +
            `<span class="mg-sel-name bfont">${info.title}</span>` +
            `<span class="mg-sel-genre">${MG_GENRES[profileOf(type).genre].name}</span>` +
            (why ? `<span class="mg-sel-why">${why}</span>`
                 : tabletNote || `<span class="mg-sel-desc">${info.desc}</span>`) +
            _pipRow(type);
        // A blocked card still selects and still plays: this is the arcade, and
        // being able to run a game the current filter excludes is the whole
        // point of a testing area. The grey says "not for that surface", not
        // "not for you".
        card.addEventListener('click', () => _selectMg(type));
        grid.appendChild(card);
    });
    _paintCount(playable, types.length);
    // A filter change can strip the selection out from under the buttons.
    if (_selectedMgType && !types.includes(_selectedMgType)) _selectedMgType = null;
    _markSelected();
}

function _paintCount(playable, total) {
    const el = document.getElementById('mg-sel-count');
    if (!el) return;
    el.textContent = _surface === 'all'
        ? `${total} GAMES`
        : `${playable} OF ${total} PLAY HERE`;
}

function _markSelected() {
    document.querySelectorAll('.mg-sel-card').forEach(c =>
        c.classList.toggle('sel', c.dataset.type === _selectedMgType));
    document.getElementById('btn-mg-select-play').disabled = !_selectedMgType;
}

function _selectMg(type) {
    _selectedMgType = type;
    _markSelected();
}

// ---- the two filters and the sort ----

function _buildGenreChips() {
    const host = document.getElementById('mg-genre-chips');
    if (!host || host.childElementCount) return;   // built once
    const mk = (id, label) => {
        const b = document.createElement('button');
        b.className = 'mg-chip' + (id === 'all' ? ' sel' : '');
        b.dataset.genre = id;
        b.textContent = label;
        b.addEventListener('click', () => {
            _genre = id;
            host.querySelectorAll('.mg-chip').forEach(c => c.classList.toggle('sel', c === b));
            _populateMgGrid();
        });
        return b;
    };
    host.appendChild(mk('all', 'ALL'));
    Object.entries(MG_GENRES).forEach(([id, g]) => host.appendChild(mk(id, g.name)));
}

document.querySelectorAll('[data-surface]').forEach(btn => {
    btn.addEventListener('click', () => {
        _surface = btn.dataset.surface;
        document.querySelectorAll('[data-surface]').forEach(b => {
            const on = b === btn;
            b.classList.toggle('sel', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        _populateMgGrid();
    });
});

document.getElementById('btn-mg-sort').addEventListener('click', () => {
    _sort = (_sort + 1) % SORTS.length;
    document.getElementById('btn-mg-sort').textContent = `SORT · ${SORTS[_sort].label}`;
    _populateMgGrid();
});

document.getElementById('btn-minigames').addEventListener('click', () => {
    // A fresh visit to the arcade starts a fresh series.
    MinigameManager.resetArcadeScores();
    _selectedMgType = null;
    document.getElementById('btn-mg-select-play').disabled = true;
    _buildGenreChips();
    _populateMgGrid();
    document.getElementById('splash').style.display = 'none';
    document.getElementById('mg-select-overlay').style.display = 'flex';
});

document.getElementById('btn-mg-select-back').addEventListener('click', () => {
    document.getElementById('mg-select-overlay').style.display = 'none';
    document.getElementById('splash').style.display = '';
});

// The seat count the arcade should run a game at. Filtering to 3-4P and then
// being handed the two-player face-off makes the filter a label: the whole
// reason to press PLAY on that filter is to see the game with three or four
// zones on it. Four where the screen has the room, three where it does not.
function _arcadeSeats(type) {
    // Only a game that can actually seat everybody. A card can be selected
    // while greyed out — the grid greys rather than hides, so "why is this not
    // here" has an answer — and handing four slots to a two-slot game would
    // write past the end of its arrays.
    if (_surface !== 'many' || !surfacesOf(type).sharedMany) return 2;
    const w = Math.max(window.innerWidth || 0, 320);
    const h = Math.max(window.innerHeight || 0, 480);
    return MinigameLayout.frameFor(MinigameLayout.SHAPES.SPLIT, 4, w, h).ok ? 4 : 3;
}

document.getElementById('btn-mg-select-play').addEventListener('click', () => {
    if (!_selectedMgType) return;
    MinigameManager.triggerStandalone(_selectedMgType, false, _arcadeSeats(_selectedMgType));
});

// RANDOM: pick one of the games the current filters admit, and play it.
//
// This replaced PRACTICE, which in the arcade was very nearly a duplicate of
// PLAY — the arcade already pays nothing and keeps its own scoreline, so
// "practice" there differed only in facing a bot. (In-match practice, the TRY
// IT FIRST option on the rules card, is untouched and is where that feature
// actually earns its place.)
//
// It draws only from the PLAYABLE half of the filter. Rolling a game the
// current surface has just greyed out would make the filter a suggestion.
document.getElementById('btn-mg-select-random').addEventListener('click', () => {
    const pool = _filteredTypes().filter(_eligible);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    _selectMg(pick);
    // Show what came up before it takes the screen: the card lights, scrolls
    // into view and pulses, and is still selected when you come back — so you
    // can see what you just played without remembering it.
    const card = document.querySelector(`.mg-sel-card[data-type="${pick}"]`);
    if (card) {
        card.scrollIntoView({ block: 'center', behavior: 'smooth' });
        card.classList.remove('picked'); void card.offsetWidth; card.classList.add('picked');
    }
    setTimeout(() => MinigameManager.triggerStandalone(pick, false, _arcadeSeats(pick)), 480);
});
