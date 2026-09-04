import { state, resetPlayers, setPlayerCount, playerCount } from './GameState.js';
import * as Targeting from './Targeting.js';
import * as Commands from './Commands.js';
import * as Scenes from '../ui/Scenes.js';
import {
    GATE_NUM_DICE, FINE_AMOUNT, BIG_FINE_AMOUNT, TRAP_AMOUNT, DUEL_STAKE,
    MAX_INV, MAX_ALLIES, ALLY_TURNS, ALLY_SPAWN_DELAY_TURNS, BUDDY_MAP_ROUNDS,
    BUDDY_NEAR_STEPS, BUDDY_MAX_STEPS,
    MINIGAME_EVERY_N_TURNS, ITEMS, SPACE_META, SPACE_DESCS,
    DISTRICT_HQ_FIRST_BONUS, DISTRICT_HQ_REVISIT_BONUS,
    FULL_CIRCUIT_BONUSES,
    ALLIES, BA_DISCOUNT, GRAND_MALL_DISCOUNT,
    ALL_CHAR_TYPES, HQ_META, CHAR_ICONS, CHAR_NAMES, DISTRICT_BIOMES,
    CITY_LENGTHS, CITY_DEFAULT_ROUNDS, HBD_LENGTHS,
    PLAYER_SLOTS, MIN_PLAYERS, MAX_PLAYERS, botName,
    buildHbdConfig, setHbdRealmCount, HBD_DEFAULT_CONFIG, HBD_FINISH_BONUS,
    hbdSpaceLabel, hbdShopKey, getRealmForSpace,
} from '../config/GameConfig.js';
import { MAP_REGISTRY } from '../config/MapRegistry.js';
import * as Bot from './Bot.js';
import { initCityBoard, generateBoard } from './BoardSetup.js';
import { calculateWinner } from './WinScreen.js';
import { initContracts, checkContract as _checkContract } from './Contracts.js';
import { earnCoins, loseCoins } from './Economy.js';
import * as Storage from './Storage.js';
import * as Director from './Director.js';
import { SCENE, BOT_THINK } from '../config/SceneTiming.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import * as Renderer from '../engine/Renderer.js';
import * as SetPieces from '../engine/SetPieces.js';
import * as Fx from '../engine/Fx.js';
import * as Physics from '../engine/Physics.js';
import * as UIManager from '../ui/UIManager.js';
import * as ModalManager from '../ui/ModalManager.js';
import * as MinigameManager from '../minigames/MinigameManager.js';
import * as MinigameLayout from '../config/MinigameLayout.js';
import * as ActiveMap from '../config/ActiveMap.js';

window.SPACE_META_REF  = SPACE_META;
window.CITY_GRAPH_REF  = ActiveMap.graph();

let _passThroughResumeHop = null;
let _branchChoiceCallback = null;
let _allyMgCallback       = null;
let _duelMgCallback       = null;
let _pendingStepsAfterGate = 0;
// True when the gate challenge was raised at the START of a turn (the player was
// already parked on it) rather than mid-move. It decides whether opening the
// gate should end the turn or hand the player their roll — see closeGate().
let _gateFromTurnStart = false;
let _rollAgainActive = false;
let _skipStory = false;   // rematch fast-path skips the HBD story intro

// ============================================================
// FLOW ENTRY POINTS
// ============================================================

export function selectMode(m) {
    state.playStyle = m;
    // Every local mode is two seats. Online sets its own count from the lobby
    // (selectPlayerCount), so it is deliberately not touched here.
    if (m !== 'online') setPlayerCount(2);
}

// How many seats this match is played with. Online lobbies call this once the
// room roster is settled; local modes never do.
export function selectPlayerCount(n) { return setPlayerCount(n); }

export function selectDifficulty(level) {
    if (['easy', 'medium', 'hard'].includes(level)) state.botDifficulty = level;
}

// Paint the real 3D piece into every card, in the colour the player about to
// choose will actually be. Nine emoji told you nothing about what you were
// picking; these are the same meshes the board will draw.
function _paintCharPortraits(playerIdx) {
    const cards = [...document.querySelectorAll('#char-select [data-char]')];
    if (!cards.length) return;
    const types = cards.map(c => c.dataset.char);
    const shots = Renderer.renderCharacterPortraits(types, state.players[playerIdx].color);
    cards.forEach(c => {
        // Names come from CHAR_NAMES so the picker, the board and the docs can
        // never drift apart the way the hardcoded markup did.
        const nameEl = c.querySelector('.char-name');
        if (nameEl && CHAR_NAMES[c.dataset.char]) nameEl.textContent = CHAR_NAMES[c.dataset.char];
        const url = shots[c.dataset.char];
        // No WebGL, or a context we could not get: the emoji stays. A picker
        // that renders nothing is worse than one that renders the old thing.
        if (!url) return;
        let img = c.querySelector('.char-shot');
        if (!img) {
            img = document.createElement('img');
            img.className = 'char-shot';
            img.alt = '';
            c.insertBefore(img, c.firstChild);
        }
        img.src = url;
        c.classList.add('has-shot');
    });
}

export function goToCharSelect() {
    if (!state.playStyle) { UIManager.toast('Please select a game mode first!', '#ef4444'); return; }
    document.getElementById('splash').style.display = 'none';
    document.getElementById('char-select').style.display = 'flex';

    // WHO IS HOLDING THE DEVICE, AND WHO IS THE COMPUTER.
    //
    // This was one line — `players[1].isBot = (playStyle === '1p')` — and that
    // line is why a solo player could never have more than one opponent. It
    // named seat 1 specifically, so the seat picker could hand the match three
    // more seats and there was nothing to put in them.
    //
    // Seat 0 is always the person who pressed the button. Everything after it
    // is a bot in 1P and a human everywhere else, and any of those human seats
    // can be handed to a bot on its own step (seatAsBot).
    state.players.forEach((p, i) => {
        p.isBot = i > 0 && state.playStyle === '1p';
        p.name  = p.isBot ? botName(i) : PLAYER_SLOTS[i].name;
    });
    state.charSelectStep = 1;
    _paintCharSelectStep(0);
}

// Dress the character screen for seat `idx`: whose turn it is to pick, in their
// colour, with everything already claimed marked as taken. Was two hard-coded
// blocks that named Player 1 and Player 2 by hand.
function _paintCharSelectStep(idx) {
    const slot = PLAYER_SLOTS[idx] || PLAYER_SLOTS[0];
    const t = document.getElementById('cs-title');
    // "PLAYER 2 OF 4". At two seats the picker was a two-step sequence everybody
    // could hold in their head; at four, a screen that only says whose turn it
    // is does not say how many are left, and handing the phone on is the one
    // thing this screen is for.
    //
    // The instruction drops to a second line rather than joining the first.
    // "PLAYER 2 OF 4: CHOOSE CHARACTER" is three wrapped lines of 32px type on
    // a 390px phone, which pushed the buttons under it off the bottom.
    const total = playerCount();
    const who   = total > 2 ? `${slot.name.toUpperCase()} OF ${total}` : slot.name.toUpperCase();
    t.innerHTML = `${who}<span class="cs-sub">CHOOSE CHARACTER</span>`;
    t.style.color  = slot.hex;

    // Any seat but the first can be given to the computer. In 1P they already
    // are, so those steps never come up and the button would be offering
    // something that has happened.
    const botBtn = document.getElementById('btn-seat-bot');
    if (botBtn) {
        const offer = idx > 0 && state.playStyle !== '1p' && state.playStyle !== 'online';
        botBtn.style.display = offer ? '' : 'none';
        botBtn.textContent = `🤖 LET A BOT PLAY ${slot.name.toUpperCase()}`;
    }
    _paintCharPortraits(idx);
    const taken = new Set(state.charSelections.slice(0, idx));
    document.querySelectorAll('#char-select [data-char]').forEach(c => {
        c.classList.toggle('taken', taken.has(c.dataset.char));
    });
}

// First character not already spoken for, so seat N never opens on a taken pick.
function _firstFreeChar(taken) {
    return ALL_CHAR_TYPES.find(t => !taken.includes(t)) || ALL_CHAR_TYPES[0];
}

export function selectChar(type) {
    state.charSelections[state.charSelectStep - 1] = type;
}

export function confirmCharSelect() {
    const idx = state.charSelectStep - 1;
    state.players[idx].charType = state.charSelections[idx];
    _advanceCharSelect(idx);
}

/**
 * Hand this seat to the computer and move on.
 *
 * The seat picker says how many are PLAYING; this says how many of them are
 * people. Without it the only mixed table available was one human and one bot,
 * because 1P meant "two seats, the second is Borat" rather than "one human".
 * Three friends and a bot to round out the table is a real thing to want.
 */
export function seatAsBot() {
    const idx = state.charSelectStep - 1;
    // Seat 0 is whoever pressed the button. A match with nobody in it is the
    // arcade, not a match.
    if (idx <= 0 || idx >= playerCount()) return false;
    const p = state.players[idx];
    p.isBot = true;
    p.name  = botName(idx);
    p.charType = _firstFreeChar(state.charSelections.slice(0, idx));
    state.charSelections[idx] = p.charType;
    _advanceCharSelect(idx);
    return true;
}

// Walk to the next seat that needs a person, choosing for every bot on the way.
// Extracted so CONFIRM and "let a bot play it" cannot drift apart — they are the
// same step with a different answer.
function _advanceCharSelect(idx) {
    let next = idx + 1;
    while (next < playerCount() && state.players[next].isBot) {
        const types = ALL_CHAR_TYPES.filter(t => !state.charSelections.includes(t));
        state.players[next].charType = types[Math.floor(Math.random() * types.length)] || 'slime';
        state.charSelections[next] = state.players[next].charType;
        next++;
    }
    if (next >= playerCount()) { goToMapSelect(); return; }

    state.charSelectStep = next + 1;
    state.charSelections[next] = _firstFreeChar(state.charSelections.slice(0, next));
    _paintCharSelectStep(next);
    // The card for the pre-selected character has to light up too, or the
    // CONFIRM button commits a choice nothing on screen is showing.
    document.querySelectorAll('#char-select [data-char]').forEach(c => {
        c.classList.toggle('sel', c.dataset.char === state.charSelections[next]);
    });
}

// ============================================================
// MAP SELECT
// ============================================================

export function goToMapSelect() {
    document.getElementById('char-select').style.display = 'none';
    document.getElementById('map-select').style.display  = 'flex';
    _populateMapSelectScreen();
}

function _populateMapSelectScreen() {
    const grid = document.getElementById('map-select-grid');
    if (!grid) return;
    grid.innerHTML = '';
    MAP_REGISTRY.forEach(map => {
        const card = document.createElement('div');
        card.className = `map-card bfont${!map.available ? ' map-card-locked' : ''}`;
        card.dataset.mapId = map.id;
        if (!map.available) card.setAttribute('aria-disabled', 'true');
        card.style.setProperty('--map-color', map.color || '#60a5fa');
        card.innerHTML =
            `<span class="map-card-icon">${map.icon}</span>` +
            `<span class="map-card-name">${map.name}</span>` +
            `<span class="map-card-desc">${map.desc}</span>` +
            (!map.available ? '<span class="map-card-soon">COMING SOON</span>' : '');
        if (map.available) {
            card.addEventListener('click', () => selectMap(map.id));
        }
        grid.appendChild(card);
    });

    // Pre-select first available map
    const first = MAP_REGISTRY.find(m => m.available);
    if (first) selectMap(first.id);
}

export function selectMap(mapId) {
    state.selectedMap = mapId;
    // Update card selection
    document.querySelectorAll('.map-card').forEach(c => c.classList.toggle('sel', c.dataset.mapId === mapId));

    // Update preview panel
    const map = MAP_REGISTRY.find(m => m.id === mapId);
    if (!map) return;
    const preview = document.getElementById('map-preview-panel');
    if (preview) {
        preview.innerHTML =
            `<div class="map-preview-icon">${map.icon}</div>` +
            `<div class="map-preview-name bfont">${map.name}</div>` +
            `<div class="map-preview-desc">${map.longDesc}</div>` +
            `<div class="map-preview-tags">${map.tags.map(t => `<span class="map-tag">${t}</span>`).join('')}</div>`;
    }

    const confirmBtn = document.getElementById('btn-map-confirm');
    if (confirmBtn) confirmBtn.disabled = false;

    // Each map names its own length picker on its registry card, so showing the
    // right one is a lookup rather than one `if` per map. This was the last
    // place in src/ that compared against a map id to decide behaviour.
    const pickers = new Set(MAP_REGISTRY.map(m => m.lengthPicker).filter(Boolean));
    for (const id of pickers) {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === map.lengthPicker) ? 'block' : 'none';
    }
}

export function selectHbdLength(len) {
    if (HBD_LENGTHS.includes(len)) state.hbdLength = len;
}

export function selectCityRounds(rounds) {
    if (CITY_LENGTHS.includes(rounds)) state.cityRounds = rounds;
}

// Total rounds for the running City Circuit game.
function _cityRounds() {
    return CITY_LENGTHS.includes(state.cityRounds) ? state.cityRounds : CITY_DEFAULT_ROUNDS;
}

export function confirmMapSelect() {
    if (!state.selectedMap) { UIManager.toast('Pick a map first!', '#ef4444'); return; }
    document.getElementById('map-select').style.display = 'none';
    startGame();
}

// Remember this game's setup so REMATCH can skip the menus.
//
// Online matches are deliberately NOT remembered. REMATCH reloads the page, and
// a saved online setup would come back up with playStyle 'online' and no room
// behind it — a hot-seat match wearing the online HUD, with three seats nobody
// is holding. Coming back to online means going through the lobby again, which
// is correct: the room has to be re-made anyway.
function _savePrefs() {
    if (state.playStyle === 'online') { Storage.remove('prefs'); return; }
    Storage.save('prefs', {
        mode:       state.playStyle,
        difficulty: state.botDifficulty,
        map:        state.selectedMap,
        hbdLength:  state.hbdLength,
        cityRounds: state.cityRounds,
        players:    playerCount(),
        chars:      state.players.map(p => p.charType),
        // Which seats the computer was playing. Without this a rematch of a
        // one-human-three-bots match came back as four humans, and the board
        // sat waiting for three people who were never there.
        bots:       state.players.map(p => !!p.isBot),
    });
}

// Re-launch straight into a game with a saved setup (used by REMATCH).
export function quickStart(prefs) {
    if (!prefs || !prefs.mode) return false;
    if (prefs.mode === 'online') return false;   // see _savePrefs
    state.playStyle     = prefs.mode;
    state.botDifficulty = prefs.difficulty || 'medium';
    state.selectedMap   = prefs.map || 'city_circuit';
    state.hbdLength     = prefs.hbdLength || 100;
    state.cityRounds    = prefs.cityRounds || CITY_DEFAULT_ROUNDS;
    // `chars` replaced charP1/charP2 when seats became variable; a prefs blob
    // saved by the two-player build still has the old keys, so read both.
    const savedChars = Array.isArray(prefs.chars)
        ? prefs.chars
        : [prefs.charP1 || 'slime', prefs.charP2 || 'boxy'];
    setPlayerCount(prefs.players || savedChars.length || 2);
    // Seat 0 is whoever pressed REMATCH. Everything else is what it was last
    // time — read from `bots` where the blob has it, and falling back to the
    // old rule (1P means seat 1 is the computer) for a blob saved before seats
    // could be mixed.
    const savedBots = Array.isArray(prefs.bots)
        ? prefs.bots
        : state.players.map((_, i) => i === 1 && prefs.mode === '1p');
    state.players.forEach((p, i) => {
        p.charType = savedChars[i] || PLAYER_SLOTS[i].charType;
        p.isBot    = i > 0 && !!savedBots[i];
        p.name     = p.isBot ? botName(i) : PLAYER_SLOTS[i].name;
        state.charSelections[i] = p.charType;
    });
    document.getElementById('splash').style.display = 'none';
    _skipStory = true;   // rematch jumps straight back into the action
    startGame();
    return true;
}

// Is the screen this table is sharing big enough for a playfield each?
//
// Not a guess about phone-versus-tablet from a user agent — the actual
// question is whether four private playfields clear the 300x300 floor on THIS
// viewport, and MinigameLayout answers exactly that. A 412x892 phone gives
// 206x400 and fails; an 820x1180 tablet gives 410x544 and passes. Measured, so
// a big phone in landscape or a small tablet gets the right answer rather than
// the answer its name implies.
function _measureShareDevice() {
    const w = Math.max(window.innerWidth  || 0, 320);
    const h = Math.max(window.innerHeight || 0, 480);
    const seats = Math.max(2, playerCount());
    state.mgDevice = MinigameLayout.frameFor(
        MinigameLayout.SHAPES.SPLIT, seats, w, h).ok ? 'tablet' : 'phone';
}

export function startGame() {
    if (state.gameStarted) return;
    _measureShareDevice();
    Director.reset();          // no beat from a previous match may fire into this one
    _gateFromTurnStart = false;
    _pendingStepsAfterGate = 0;
    _buddyRemindedRound = -1;
    _finalRoundAnnounced = false;
    state.gameStarted = true;
    window.CITY_GRAPH_REF = ActiveMap.graph();   // the QA harness boots off this
    _savePrefs();
    if (state.playStyle === 'tabletop') document.body.classList.add('tabletop-mode');
    document.getElementById('splash').style.display      = 'none';
    document.getElementById('char-select').style.display  = 'none';
    document.getElementById('map-select').style.display   = 'none';
    document.getElementById('game-container').style.display = 'block';
    setTimeout(() => {
        if (!state.gameStarted) return;
        UIManager.setPlayerNames();
        state.activePlayer = Math.floor(Math.random() * playerCount());
        resetPlayers();
        UIManager.resetTurnAnnouncer();   // a new match announces its first turn
        UIManager.resetForkPrimer();      // ...and explains its first fork
        if (ActiveMap.isLinear()) {
            state.hbd = buildHbdConfig(state.hbdLength);
            setHbdRealmCount(state.hbd.realmCount);
            generateBoard();
        } else {
            initCityBoard();
        }
        Renderer.init(document.getElementById('game-container'));
        UIManager.initCoinDisplays();
        UIManager.updateUI();
        Renderer.startFlyover(() => {
            document.getElementById('ui-layer').style.display = 'block';
            state.cameraState = 'FOLLOW';
            const begin = () => {
                UIManager.toast(`${state.players[state.activePlayer].name} goes first!`,
                    PLAYER_SLOTS[state.activePlayer].hex);
                // A networked client is a replica: it draws the match but never
                // advances it. This is the ONE place the turn engine is
                // entered, so not entering it here is what keeps a client's
                // copy of GameController inert for the whole match — no bot
                // timers, no dice, no turn hand-over, nothing to fight the
                // snapshots with.
                if (state.netReplica) { UIManager.updateUI(); return; }
                proceedTurn();
            };
            if (ActiveMap.isGraph()) {
                if (ActiveMap.has('buddies'))  _scheduleAllySpawn(1);
                if (ActiveMap.has('bounties')) initContracts();
                // City Circuit is the only board where the player routes
                // themselves. Show them the shape of it — and offer the map —
                // before the first junction springs the decision on them.
                // A rematch has already seen it.
                if (_skipStory) { _skipStory = false; begin(); }
                else {
                    document.getElementById('ui-layer').style.display = 'none';
                    state.cameraState = 'INIT';
                    UIManager.showCityBriefing(() => {
                        document.getElementById('ui-layer').style.display = 'block';
                        state.cameraState = 'FOLLOW';
                        Renderer.snapCameraToActive();
                        begin();
                    });
                }
            } else if (_skipStory) {
                _skipStory = false;
                begin();
            } else {
                // Story intro sets the scene before the first roll.
                UIManager.showHbdStory(begin);
            }
        });
    }, 100);
}

// Board generation lives in BoardSetup.js (initCityBoard / generateBoard).

// ============================================================
// TURN FLOW
// ============================================================

export function isMyTurn(pIdx) {
    if (state.gameState !== 'PRE_ROLL') return false;
    if (state.activePlayer !== pIdx) return false;
    if (state.players[pIdx].isBot) return false;
    // Online: the controls only answer to the phone that seat belongs to. The
    // HUD already only paints one seat's row, but the check has to be here too
    // — the row is the same DOM on every device and a stale dataset would
    // otherwise let the wrong phone roll.
    if (typeof state.localSeat === 'number' && state.localSeat !== pIdx) return false;
    return true;
}

// Is this player standing in front of a gate that is still shut? Both maps have
// one; they just express it differently — HBD by track index, City by node id.
function _atClosedGate(p) {
    if (state.gateOpen) return false;
    return ActiveMap.isLinear()
        ? p.pos === (state.hbd || HBD_DEFAULT_CONFIG).gatePos
        : p.pos === ActiveMap.gateNode();
}

export function startPreRoll() {
    // SAFETY NETS FIRST, before either of the two branches below can return.
    //
    // Every full-screen scene parks the camera in its own mode and is
    // responsible for handing it back — and the ally minigame did not, so a
    // single encounter left cameraState stuck on 'FLYOVER' and the follow camera
    // never ran again for the rest of the match. The same argument covers the
    // HUD and the roll callout.
    //
    // These used to sit further down, after the gate and buddy checks. Moving
    // the buddy report in above them meant a round that opened with a report
    // returned early and skipped the restore — qa/city.js caught it as a camera
    // left dead on FLYOVER. Nothing may start a turn OR raise a turn-opening
    // scene in a camera mode that is not following anybody.
    if (state.cameraState !== 'FOLLOW' && state.cameraState !== 'CINEMATIC') {
        state.cameraState = 'FOLLOW';
        Renderer.snapCameraToActive();
    }
    {
        const uiL = document.getElementById('ui-layer');
        if (uiL && uiL.style.display === 'none') uiL.style.display = 'block';
    }
    UIManager.hideRollCallout();
    UIManager.hideFinalRoundBanner();
    // No move is in progress at the top of a turn, so no continuation from one
    // may still be parked — closeShopModal() reads this slot to decide whether
    // the turn is over, and a stale one would resume a walk that ended turns ago.
    _clearPassThroughResume();

    // A player parked at a shut gate does not get an ordinary turn — they get
    // the gate. This lived in proceedTurn() and covered ONLY Hundred Block Dash,
    // so in City a failed gate roll left the player with a normal roll the next
    // turn and the gate simply forgotten. It also sat BEFORE the pass-the-device
    // prompt, which meant in pass-and-play the gate scene was raised for the
    // player who hadn't picked the phone up yet. Here it is after the handoff
    // and on both maps.
    {
        const gp = state.players[state.activePlayer];
        if (gp && _atClosedGate(gp)) {
            _gateFromTurnStart = true;
            triggerGateChallenge(gp);
            return;
        }
    }
    // The last round announces itself, once, before anything else about the
    // round. It does not wait for a press — it owns the screen for its floor and
    // then the turn begins — but it does hold the beat, because a three-second
    // banner nobody has time to read is not an announcement.
    if (_finalRoundDue()) {
        _finalRoundAnnounced = true;
        state.gameState = 'ACKNOWLEDGE';
        UIManager.showFinalRoundBanner(_cityRounds());
        sfx('land_bad');
        Director.hold('FINAL_ROUND', startPreRoll);
        return;
    }
    // The round's buddy news, before anybody rolls — and before PRE_ROLL is
    // entered, so no roll control can appear behind the card. It takes the
    // screen and hands control back through its own callback, which calls this
    // function again with the round already marked as reported.
    if (_buddyReportDue()) {
        state.gameState = 'ACKNOWLEDGE';
        _showBuddyReportThen(startPreRoll);
        return;
    }
    state.gameState = 'PRE_ROLL';
    // The camera can legitimately be CINEMATIC on the way back from the buddy
    // report — its own resume hands it back. By the time play actually begins it
    // must be following somebody.
    if (state.cameraState !== 'FOLLOW') {
        state.cameraState = 'FOLLOW';
        Renderer.snapCameraToActive();
    }
    UIManager.applyOrientation();
    // Say whose turn it is. Whose it was had only ever been implied — by which
    // HUD bar lit up and which edge the buttons appeared on — and that is easy
    // to miss coming back from a minigame. Only fires when the turn actually
    // changed hands, so a BOOST re-roll does not re-announce the same player.
    UIManager.announceTurnIfChanged(state.activePlayer);
    UIManager.flushToasts();     // nothing queued mid-move may be stranded
    state.rollAgainPending = false;
    state.rollAgainSamePlayer = false;
    UIManager.updateUI();
    Physics.clearDice(Renderer.getDiceGroup());
    const p = state.players[state.activePlayer];
    if (p.isBot) {
        Director.wait(BOT_THINK.PRE_ROLL, () => {
            if (state.gameState !== 'PRE_ROLL') return;
            // Bot ally activation (Cabbie)
            if (Bot.shouldUseCabbie(p)) activateCabbie_bot(p);
            const useId = Bot.preRollItem(p);
            if (useId !== null) {
                const idx = p.inv.indexOf(useId);
                if (idx >= 0) {
                    p.inv.splice(idx, 1);
                    UIManager.toast(`${p.name} used ${ITEMS[useId].name}!`, '#f5c842');
                    _applyItemEffect(p, useId, true);
                    if (useId === 'rocket' || useId === 'custom_dice') return;
                }
            }
            if (state.gameState === 'PRE_ROLL') executeRoll(0.8 + Math.random() * 1.5);
        });
    } else {
        UIManager.showSwipeZone();
    }
}

export function executeRoll(flickVelocity) {
    const p = state.players[state.activePlayer];
    state.gameState = 'ROLLING';
    UIManager.hideSwipeZone();
    UIManager.hideActionRows();
    Physics.clearDice(Renderer.getDiceGroup());
    UIManager.hideSpaceInfoCard();

    let numDice = 1;
    if (state.cursedTarget[state.activePlayer]) {
        state.cursedTarget[state.activePlayer] = false;
        state.currentRollMode = 'cursed_forced';
        // Also urgent: it explains the roll that is about to happen, so it is
        // worthless once the roll has happened.
        UIManager.toast('💀 Cursed Die forces a bad roll!', '#ef4444', { urgent: true });
    } else {
        state.currentRollMode = 'normal';
    }

    const strength = Math.max(0.4, Math.min(flickVelocity, 3.5));
    const camera   = Renderer.getCamera();
    const pm       = p.mesh;
    Physics.positionWalls(pm.position.x, 0, pm.position.z, 8);
    let flickDir = pm.position.clone().sub(camera.position);
    flickDir.y = 0;
    if (flickDir.lengthSq() < 0.001) flickDir.set(0, 0, -1); else flickDir.normalize();
    const diceGrp = Renderer.getDiceGroup();

    for (let i = 0; i < numDice; i++) {
        const d = Physics.spawnDie(diceGrp);
        const offset = numDice > 1 ? (i === 0 ? -1.2 : 1.2) : 0;
        const right  = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), flickDir).normalize();
        const sp = 8 + strength * 10, up = 10 + strength * 7, spin = 10 + strength * 12;
        d.body.position.x = pm.position.x + flickDir.x * 1.5 + right.x * offset;
        d.body.position.y = pm.position.y + 2.5;
        d.body.position.z = pm.position.z + flickDir.z * 1.5 + right.z * offset;
        const sc = (Math.random()-0.5)*2;
        d.body.velocity.x = flickDir.x*sp + right.x*sc; d.body.velocity.y = up; d.body.velocity.z = flickDir.z*sp + right.z*sc;
        d.body.angularVelocity.x = (Math.random()-0.5)*spin*2; d.body.angularVelocity.y = (Math.random()-0.5)*spin*2; d.body.angularVelocity.z = (Math.random()-0.5)*spin*2;
    }
    sfx('dice_throw');

    Physics.onSettle(state.currentRollMode, (result) => {
        sfx('dice_land'); haptic([10]);
        let finalResult = result;
        // URGENT: the number you rolled is the one notification that must be
        // read BEFORE the token moves, not after it stops. The queue that keeps
        // mid-move chatter off the board swallowed this one — gameState is
        // 'ROLLING' when the dice settle — so the result appeared once the
        // player had already arrived somewhere, which is exactly backwards.
        // The number owns the screen for a beat before the token sets off —
        // on every device, not just the one that threw the dice.
        Scenes.emit('rollCallout', { n: finalResult });
        UIManager.showRollCallout(finalResult);
        // Beat: the number owns the screen, at size, and comes down the moment
        // the token sets off. It used to be a toast — urgent, so it at least got
        // through, but the same size and the same place as every other line of
        // chatter, for a beat in which nothing else was happening.
        const mover = ActiveMap.isLinear() ? _movePlayerHBD : moveThroughGraph;
        Director.hold('DICE_READ', () => {
            UIManager.hideRollCallout();
            mover(state.players[state.activePlayer], finalResult);
        });
    });
}

// ============================================================
// GRAPH-BASED MOVEMENT
// ============================================================

export function moveThroughGraph(player, stepsTotal) {
    state.gameState = 'MOVING';
    let stepsLeft = stepsTotal;

    function advance() {
        if (stepsLeft <= 0) {
            _onLand(player);
            return;
        }
        const graphNode = ActiveMap.graph()[player.pos];
        if (!graphNode) { _onLand(player); return; }
        const nextId = graphNode.next[0];

        // About to step into a junction?
        if (ActiveMap.isJunction(nextId)) {
            // stepsLeft counts the step INTO the fork, so it is exactly how many
            // more tiles this roll covers once the road is chosen.
            _offerBranchChoice(nextId, (chosenId) => {
                _noteDistrictEntry(player, chosenId);
                // If entering Industrial and gate is closed
                if (ActiveMap.graph()[nextId]?.next?.includes(chosenId) && ActiveMap.graph()[chosenId]?.district === 'ind' && chosenId === 'ind_0' && !state.gateOpen) {
                    _pendingStepsAfterGate = stepsLeft - 1;
                    player.pos = 'ind_0'; // position them at gate
                    Renderer.animatePlayerHop(player, 'ind_0', () => {
                        triggerGateChallenge(player);
                    });
                    return;
                }
                // Normal advance onto the chosen road.
                //
                // This used to be one 0.35 s hop straight from the node before
                // the fork to the first node of the chosen road — skipping the
                // fork itself and covering up to 26 units (against ~10 for an
                // ordinary step) in the same time. Combined with the camera
                // still travelling down from the junction's overhead shot, the
                // player was somewhere else before the view caught up, and the
                // space they landed on resolved before they saw it.
                //
                // Now: the camera turns to face the chosen road and eases back
                // onto the player FIRST, then the token walks to the fork, then
                // down the road. Two legs, one board step.
                stepsLeft--;
                _walkThroughJunction(player, nextId, chosenId, () => {
                    player.pos = chosenId;
                    _checkPassThroughShop(player, chosenId, stepsLeft, advance);
                });
            }, stepsLeft);
            return;
        }

        // Regular single-path step
        stepsLeft--;
        Renderer.animatePlayerHop(player, nextId, () => {
            player.pos = nextId;
            _checkPassThroughShop(player, nextId, stepsLeft, advance);
        });
    }

    advance();
}

// Walk a token from wherever it is, through the invisible fork node, and out
// onto the first node of the chosen road — with the camera arriving first.
//
// The fork is a real position on the ring even though nobody can stand on it,
// so travelling through it is what makes a route choice look like a turn rather
// than a cut. `player.pos` is deliberately NOT parked on the fork: no board tile
// exists there, and anything that read the position mid-animation would find a
// space that cannot resolve.
function _walkThroughJunction(player, junctionId, chosenId, onDone) {
    // Turn the camera down the chosen road and hand it back to FOLLOW. It eases
    // from the junction's overhead shot to the walking shot during this beat.
    Renderer.aimAlongRoad(junctionId, chosenId);
    state.cameraState = 'FOLLOW';
    Director.hold('JUNCTION_COMMIT', () => {
        Renderer.animatePlayerHop(player, junctionId, () => {
            Renderer.animatePlayerHop(player, chosenId, onDone, { faceToward: chosenId });
        }, { faceToward: chosenId });
    });
}

// Fires the `enter_district` contract event the first time a player steps off
// the Ring Road into a named district on this trip. Without this, contracts
// c09–c12 ("Enter the ... District") could never be claimed.
function _noteDistrictEntry(player, nodeId) {
    const dist = ActiveMap.graph()[nodeId]?.district;
    if (!dist) return;
    // Back on the Ring Road: clear the latch so the next entry counts again
    // (a contract for this district may not have been dealt yet).
    if (dist === 'ring') { player._lastDistrictEntered = null; return; }
    if (player._lastDistrictEntered === dist) return;
    player._lastDistrictEntered = dist;
    _checkContract(player, 'enter_district', dist);
    // Say where you have arrived. Turning off the ring into a district is the
    // one deliberate journey a player makes on this board, and it used to
    // happen in silence — the sky changed colour and that was the whole
    // announcement. Hundred Block Dash has announced its realms since the
    // story pass; this is the same banner, reused.
    UIManager.showRealmBanner(DISTRICT_BIOMES[dist]);
}

// Everything that can interrupt a single STEP of a move, run one at a time.
//
// Reported: "there was a glitch when a player hit the store, the game glitched
// and went to the end of their turn and skipped over an ally."
//
// This used to be three nested branches, each capturing the next as a closure —
// steal wrapped buddy wrapped shop — with the shop leg parking its continuation
// in a module-level slot (`_passThroughResumeHop`) and the turn's end reachable
// from closeShopModal() whenever one string flag failed to match. Two globals
// and three closures deciding between "carry on walking" and "end the turn" is
// exactly how a shop swallows a buddy and finishes the turn early.
//
// Now: build the list of interruptions this square owes, in a fixed order, and
// walk it with an index. One continuation, one place that decides the turn is
// over, and each step gets the whole screen until it hands back.
const PASS_STEPS = ['hq', 'steal', 'buddy', 'shop'];

function _checkPassThroughShop(player, nodeId, stepsLeft, continueMove) {
    const b   = state.board[nodeId];
    // Whoever else is standing on this square with a buddy to lose. At two
    // seats this is the other player; at four it is the one you actually
    // brushed past, which is the rule the effect always meant.
    const mark = Targeting.stealableRivalOn(player, nodeId);
    const hasBuddies = ActiveMap.has('buddies');

    // Which of them actually apply here. Decided ONCE, up front, from the board
    // as it is at this instant — so a buddy claimed by the steal step cannot
    // also fire the buddy step, and nothing re-reads state a later step changed.
    const due = PASS_STEPS.filter(k => {
        if (stepsLeft <= 0) return false;
        if (k === 'hq')    return b?.type === 'hq' && !!ActiveMap.regionOf(nodeId);
        if (k === 'steal') return hasBuddies && !!mark;
        if (k === 'buddy') return hasBuddies && state.allyOnMap && state.allyOnMap.nodeId === nodeId;
        if (k === 'shop')  return b?.type === 'shop';
        return false;
    });

    let idx = 0;
    // The ONE continuation. Every step calls this and only this; nothing else in
    // here may resume the move or end the turn.
    const next = () => {
        if (idx >= due.length) { state.gameState = 'MOVING'; continueMove(); return; }
        const step = due[idx++];
        state.gameState = 'MOVING';

        if (step === 'hq') {
            // District HQ pays for PASSING it, not just for stopping on it.
            // Landing exactly on one of four HQs on a 60-node ring was a coin
            // flip you had no control over; now the reward is for choosing the
            // route that goes through the district.
            const dist   = ActiveMap.regionOf(nodeId);
            const before = player.districtsVisited[dist] || 0;
            _onDistrictHQReached(player, dist);
            const bonus = before === 0 ? DISTRICT_HQ_FIRST_BONUS : DISTRICT_HQ_REVISIT_BONUS;
            const info  = HQ_META[dist] || { name: 'HQ', icon: '🏛️' };
            UIManager.toast(`${info.icon} Passed ${info.name} — +${bonus} coins!`, '#fbbf24');
            UIManager.animateCoinDisplay(player.id, player.coins);
            sfx('coin_gain');
            next();
            return;
        }

        if (step === 'steal') {
            // Brushing past a rival is enough to go for their buddy. It used to
            // need an exact landing on their square — one node in sixty, on the
            // one turn they happened to be holding something.
            state.gameState = 'ACKNOWLEDGE';
            if (player.isBot) {
                if (Bot.shouldAttemptAllySteal()) _startAllySteal(player, mark, Bot.allyStealIndex(mark), next);
                else next();
                return;
            }
            UIManager.toast(`🥷 You brushed past ${mark.name} — go for a Buddy?`, '#f97316', { urgent: true });
            _offerAllySteal(player, mark, next);
            return;
        }

        if (step === 'buddy') {
            // Same rule for the buddy waiting on the board: walking past the
            // BUDDY SPACE is enough to challenge for them.
            if (!state.allyOnMap || state.allyOnMap.nodeId !== nodeId) { next(); return; }
            state.gameState = 'ACKNOWLEDGE';
            _offerAllyEncounter(player, next);
            return;
        }

        // shop
        if (player.isBot) {
            if (!Bot.shopPassThrough()) { Director.hold('PASSTHROUGH', next); return; }
            state.gameState = 'SHOP';
            _noteShopVisit(player);
            Director.hold('PASSTHROUGH', () => {
                if (state.gameState !== 'SHOP') { next(); return; }
                _botShop(player);
                Director.wait(BOT_THINK.SHOP, next);
            });
            return;
        }
        // The offer names WHICH shop it is. It used to leave
        // pendingShopDistrict alone, so entering picked up whatever district the
        // last shop visit had left behind — the Back Alley's discount on the
        // Promenade's stock, and vice versa.
        state.pendingShopDistrict = ActiveMap.graph()[nodeId]?.shopDistrict
            || ActiveMap.regionOf(nodeId) || 'ring';
        state.pendingShopDiscount = state.pendingShopDistrict === 'ba' ? BA_DISCOUNT : 1.0;
        _passThroughResumeHop = next;
        state.gameState = 'SHOP';
        ModalManager.showModal('shop-offer-modal');
    };

    next();
}

function _onLand(player) {
    // Check for same-space ally steal BEFORE resolving the space
    const mark = Targeting.stealableRivalOn(player, player.pos);
    if (mark && !player.isBot) {
        _offerAllySteal(player, mark, () => resolveSpace(player));
        return;
    }
    if (mark && player.isBot) {
        if (Bot.shouldAttemptAllySteal()) _startAllySteal(player, mark, Bot.allyStealIndex(mark), () => resolveSpace(player));
        else resolveSpace(player);
        return;
    }
    // Check for ally on this node
    if (state.allyOnMap && state.allyOnMap.nodeId === player.pos) {
        _offerAllyEncounter(player, () => resolveSpace(player));
        return;
    }
    resolveSpace(player);
}

// ============================================================
// BRANCH CHOICE
// ============================================================

function _offerBranchChoice(junctionId, onChosen, stepsLeft) {
    const options = ActiveMap.branches()[junctionId];
    if (!options) { onChosen(ActiveMap.graph()[junctionId].next[0]); return; }

    // Check if Industrial path is locked
    const displayOptions = options.map(opt => {
        if (opt.nodeId === 'ind_0' && !state.gateOpen) {
            return { ...opt, label: 'Industrial Zone', desc: 'Locked by The Gate 🔒' };
        }
        return opt;
    });

    const p = state.players[state.activePlayer];
    if (p.isBot) {
        const pick = Bot.branch(p, displayOptions);
        Director.wait(BOT_THINK.BRANCH, () => onChosen(pick));
        return;
    }

    _branchChoiceCallback = onChosen;
    // Arrows over the board, not a card on top of it — the player is choosing a
    // direction, so let them see the directions.
    UIManager.showJunctionArrows(junctionId, p.pos, displayOptions, stepsLeft);
}

export function onBranchChosen(nodeId) {
    UIManager.hideBranchChoice();
    UIManager.hideJunctionArrows();
    // hideJunctionArrows drops the junction focus, so the camera must be handed
    // back to a mode that actually drives it, or it freezes mid-fork.
    state.cameraState = 'FOLLOW';
    if (_branchChoiceCallback) { const cb = _branchChoiceCallback; _branchChoiceCallback = null; cb(nodeId); }
}

// ============================================================
// HBD LINEAR MOVEMENT
// ============================================================

function _movePlayerHBD(p, steps, isForced = false) {
    state.gameState = 'MOVING';
    const cfg      = state.hbd || HBD_DEFAULT_CONFIG;
    const startPos = p.pos;
    const stepDir  = Math.sign(steps);
    let curr   = p.pos;
    let target = Math.max(0, Math.min(cfg.finish, curr + steps));
    const realmBefore = getRealmForSpace(startPos).key;

    if (stepDir === 0) { _resolveHBDSpace(p); return; }
    // Gate blocks forward movement past the Rift until it's open. Bank the steps
    // it eats so a successful Rift roll spends them (City Circuit already did
    // this; HBD used to silently swallow the rest of the roll).
    _pendingStepsAfterGate = 0;
    if (!state.gateOpen && stepDir > 0 && startPos < cfg.gatePos && target >= cfg.gatePos) {
        _pendingStepsAfterGate = target - cfg.gatePos;
        target = cfg.gatePos;
    }

    function hopNext() {
        if (curr === target) { p.pos = target; _announceRealmChange(p, realmBefore); _resolveHBDSpace(p); return; }
        curr += stepDir;
        // Offer shop pass-through on intermediate shop spaces
        if (curr !== target && cfg.shopSpaces.has(curr) && stepDir > 0) {
            Renderer.animatePlayerHop(p, curr, () => {
                if (p.isBot) {
                    // Inline buy — must NOT call openShop/finishTurn mid-movement
                    if (Bot.shopPassThrough()) _botPassThroughBuy(p);
                    setTimeout(hopNext, 300);
                } else {
                    _passThroughResumeHop = hopNext;
                    state.pendingShopDistrict = hbdShopKey(curr);
                    state.pendingShopDiscount = 1.0;
                    state.gameState = 'SHOP';
                    ModalManager.showModal('shop-offer-modal');
                }
            });
            return;
        }
        Renderer.animatePlayerHop(p, curr, hopNext);
    }
    hopNext();
}

function _resolveHBDSpace(p) {
    const cfg = state.hbd || HBD_DEFAULT_CONFIG;
    // Win condition: reach the Crown
    if (p.pos >= cfg.finish) {
        sfx('win'); haptic([100, 50, 100, 50, 200]);
        state.gameState = 'GAME_OVER';
        ModalManager.showMessage(`👑 ${p.name} REACHED THE CROWN!`, `+${HBD_FINISH_BONUS} finish bonus — but the most coins still wins!`, '👑', { tier: 'shared' });
        Director.hold('WIN_SCREEN', calculateWinner);
        return;
    }
    // Gate check
    if (!state.gateOpen && p.pos === cfg.gatePos) {
        _gateFromTurnStart = false;
        triggerGateChallenge(p); return;
    }
    resolveSpace(p);
}

// Cinematic banner when a player crosses into a new realm (HBD only).
function _announceRealmChange(p, prevKey) {
    if (!ActiveMap.has('realms')) return;
    const realm = getRealmForSpace(p.pos);
    if (!realm || realm.key === prevKey) return;
    UIManager.showRealmBanner(realm);
}

// Dispatcher: call the right movement function based on selected map
function _doMove(p, steps) {
    if (ActiveMap.isLinear()) _movePlayerHBD(p, steps, true);
    else moveThroughGraph(p, steps);
}

// ============================================================
// SPACE RESOLUTION
// ============================================================

export function resolveSpace(p) {
    state.msgModalResolving = false;
    const space = state.board[p.pos];
    if (!space) { finishTurn(); return; }

    state.gameState = 'ACKNOWLEDGE';

    // Landing is three beats, in this order, and the order is the whole point:
    //
    //   ARRIVE  — the token is down and the camera is on it. The tile names
    //             itself. NOTHING has happened to the player yet.
    //   RESOLVE — the effect fires: coins move, items are granted, the result
    //             card appears.
    //   RESULT  — the card owns the screen for its floor.
    //
    // resolveSpaceEffect() used to be called at the top of this function,
    // before any of that: the coin counter moved, the HUD updated and the item
    // landed in the bag while the token was still mid-hop and, after a junction,
    // while the camera was still travelling. You were told what happened before
    // you could see where you were.
    const spc = SPACE_META[space.type] || SPACE_META.coin;
    const lbl = ActiveMap.has('realms') ? hbdSpaceLabel(p.pos, space.type) : null;
    const tileName = lbl ? lbl.name : (spc.n || space.type.toUpperCase());
    const tileDesc = lbl ? lbl.desc : (SPACE_DESCS[space.type] || '');
    if (ActiveMap.has('realms')) Renderer.updateBiomeVisuals(typeof p.pos === 'number' ? p.pos : 0);
    else Renderer.updateBiomeVisuals(ActiveMap.graph()[p.pos]?.district || 'ring');

    // ARRIVE — name the tile you are standing on, and release anything that was
    // held back while the board was moving. Passing an HQ, claiming a bounty and
    // gaining an ally all fire mid-walk; they now arrive here, where the player
    // is looking, instead of over the top of the token they were watching.
    UIManager.flushToasts();
    UIManager.showSpaceInfoCard(tileName, tileDesc);
    Director.hold('LAND_ARRIVE', () => {
        if (state.gameState !== 'ACKNOWLEDGE') return;

        // RESOLVE — now do the thing.
        const msg = resolveSpaceEffect(p, space.type, space);
        UIManager.updateUI();
        // null means the effect took the screen for itself (shop, duel, a
        // cinematic) and will drive the rest of the turn.
        if (msg === null) return;

        const goodTypes = ['coin','coin_big','shortcut','cfwd','mystery','truce','gate_open','hq','finish'];
        const badTypes  = ['lose','lose_big','trap','cbwd','magnet','player_trap','anchor_trap','duel'];
        if (goodTypes.includes(space.type))  sfx('land_good');
        else if (badTypes.includes(space.type)) sfx('land_bad');

        // An item pickup renames the card after itself, so this has to be read
        // after the effect has run.
        const ovr       = state.pendingResultOverride; state.pendingResultOverride = null;
        const titleName = ovr ? ovr.title : tileName;
        const iconChar  = ovr ? ovr.icon : (lbl ? lbl.icon : spc.ic);

        // A mystery crate lands and cracks open before the item names itself.
        // The item is already in the bag by now — this is the reveal, not the
        // grant, so an interrupted animation cannot cost anybody anything.
        const unboxAt = state.pendingUnbox; state.pendingUnbox = null;
        const thenShow = () => Director.hold('LAND_SETTLE', () => {
            if (state.gameState !== 'ACKNOWLEDGE') return;
            // A full bag: the discard picker is the result card for this space.
            const pick = state.pendingDropPick; state.pendingDropPick = null;
            if (pick) {
                ModalManager.openDropModal(p, pick, 0, 'finish_turn');
                Director.begin('LAND_RESULT');
                return;
            }
            // Owner tier: the card is this player's, the opponent gets the
            // headline on their own edge — first line only, so it stays one
            // glanceable strip.
            ModalManager.showMessage(titleName, msg || 'Nothing happens.', iconChar, {
                tier:   'owner',
                ticker: `${p.name}: ${(msg || titleName).split('\n')[0]}`,
            });
            Director.begin('LAND_RESULT');
            if (p.isBot) {
                // No tap is coming, so this floor is the whole readable window.
                Director.hold(space.type === 'boost' ? 'BOOST_RESULT' : 'BOT_RESULT', () => {
                    if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal();
                });
            }
        });
        if (unboxAt) Fx.play('mysteryUnbox', { node: p.pos, seat: p.id }, () => { Renderer.endCinematic(); thenShow(); });
        else thenShow();
    });
}

export function resolveSpaceEffect(p, spaceType, space) {
    // "The opponent" at two seats. At three or four, each hostile space names
    // the rule it wants (Targeting.js) — this stays only as the fallback for
    // effects that genuinely do not care which rival they mention.
    const opp = Targeting.anyRival(p) || p;
    switch (spaceType) {
        case 'start':      return ActiveMap.isLinear() ? 'Back at the start!' : 'Back at the city start!';
        // Landing here is handled by the win check in _resolveHBDSpace before the
        // space ever resolves; this only fires if something reaches it another way.
        case 'finish':     return 'The Crown!';
        case 'coin': {
            const bonus = _allyPassive(p, 'coin_bonus');
            earnCoins(p, 3 + bonus);
            Fx.play('coinPop', { node: p.pos, seat: p.id, big: false });
            _checkContract(p, 'land_coin'); _checkContract(p, 'land_type', 'coin');
            return `+${3+bonus} coins!${bonus ? ' (Vendor +'+bonus+')' : ''}`;
        }
        case 'coin_big': {
            const bonus = _allyPassive(p, 'coin_bonus');
            earnCoins(p, 8 + bonus);
            Fx.play('coinPop', { node: p.pos, seat: p.id, big: true });
            _checkContract(p, 'land_coin_big'); _checkContract(p, 'land_type', 'coin_big');
            return `+${8+bonus} coins!${bonus ? ' (Vendor +'+bonus+')' : ''}`;
        }
        // A shield turning a fine into nothing is a good moment too; the seal
        // still stamps, but no coins fall out of it.
        case 'lose':     { const l = loseCoins(p, FINE_AMOUNT);     Fx.play('finePop', { node: p.pos, seat: p.id, big: false, lost: l > 0 }); return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'lose_big': { const l = loseCoins(p, BIG_FINE_AMOUNT); Fx.play('finePop', { node: p.pos, seat: p.id, big: true, lost: l > 0 }); return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'trap':     { const l = loseCoins(p, TRAP_AMOUNT);     Fx.play('finePop', { node: p.pos, seat: p.id, big: false, lost: l > 0 }); return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'mystery': {
            const ids  = Object.keys(ITEMS);
            const pick = ids[Math.floor(Math.random() * ids.length)];
            const it   = ITEMS[pick];
            const took = tryGrantItem(p, pick);
            _checkContract(p, 'land_type', 'mystery');
            state.pendingUnbox = Renderer.getPos(p.pos).clone();
            // Receiving an item is its own moment — show what it is and what it
            // does, under the item's own name, and make the player confirm it.
            state.pendingResultOverride = { title: `YOU GOT: ${it.name.toUpperCase()}`, icon: it.icon };
            // A full bag hands this beat to the discard picker, which names and
            // describes the item itself — so the card would be a duplicate.
            if (state.pendingDropPick) return '';
            if (!took) return `${it.name} — ${it.desc}\n\nYour bag was full, so it was left behind.`;
            return `${it.name} — ${it.desc}\n\nIt's in your bag. Open 🎒 ITEMS on your turn to use it.`;
        }
        case 'boost': {
            state.rollAgainPending = true; sfx('boost'); haptic([30,50,30]);
            _checkContract(p, 'land_type', 'boost');
            return `⚡ BOOST! ${p.name} rolls again!`;
        }
        case 'shortcut': {
            _checkContract(p, 'land_type', 'shortcut');
            const skip = 3 + Math.floor(Math.random() * 6);
            state.pendingForcedMove = skip;
            return `🌀 A shortcut! Skipping ahead ${skip} spaces.`;
        }
        // These two used to return null, which meant no notification at all —
        // you were silently moved 10 spaces and only saw wherever you ended up.
        case 'cfwd': {
            state.pendingForcedMove = 10;
            return '🚀 LAUNCH! Blasted 10 spaces forward.';
        }
        case 'cbwd': {
            state.pendingForcedMove = -10;
            return '🌑 PULLED BACK! Dragged 10 spaces backward.';
        }
        case 'swap_space': {
            // The single most dramatic thing on the board used to be delivered
            // as two `position.copy()` calls and a toast: both tokens simply
            // appeared somewhere else, which reads as a rendering glitch rather
            // than an event. The state swaps here (so the rules stay consistent
            // from this instant) but the MESHES are left where they are and
            // handed to the cinematic, which flies them across itself.
            // Trades places with whoever is winning, not with whoever happens
            // to sit next in the array — see Targeting.js. At two seats these
            // are the same player.
            const mark = Targeting.leadingRival(p) || opp;
            const tmp = p.pos; p.pos = mark.pos; mark.pos = tmp;
            _checkContract(p, 'land_type', 'swap_space');
            haptic([50, 30, 50]);
            _playSwap(p, mark, `🛸 Abducted and re-filed — ${p.name} and ${mark.name} have traded places.`);
            return null;   // the cinematic owns the screen and raises its own card
        }
        case 'anchor_trap': {
            const owner = space?.owner !== undefined ? state.players[space.owner] : null;
            if (owner && owner.id !== p.id) {
                // The Bodyguard says it blocks hits. It used to live entirely
                // inside loseCoins(), so it stopped every fine and did nothing
                // about the one board effect people most expect a bodyguard to
                // handle: being dragged backwards. Spending a charge here is
                // what makes the card honest.
                if (_spendBodyguard(p, 'Anchor')) return `🦺 Bodyguard holds you steady — the Anchor slides off.`;
                state.pendingForcedMove = -5;
                // Springing it BEFORE the drag is the point: without this the
                // token simply appears five spaces earlier and it is genuinely
                // hard to tell why you moved backwards.
                _playSetPiece(done => Fx.play('anchorSpring', { node: p.pos, seat: p.id }, done),
                              '⚓ ANCHOR', `${owner.name}'s Anchor caught you — dragged back 5 spaces.`, p, 'owner');
                return null;
            }
            return 'Your own Anchor.';
        }
        case 'magnet': {
            // Reaches into the fullest pocket in the game, which at two seats
            // is the only other pocket.
            const mark   = Targeting.richestRival(p) || opp;
            const stolen = Math.min(5, mark.coins);
            loseCoins(mark, stolen); earnCoins(p, stolen);
            _checkContract(p, 'land_type', 'magnet');
            // The satisfying half of a magnet is watching the OTHER number go
            // down, so the coins have to be seen leaving them.
            if (stolen > 0) {
                _playSetPiece(done => Fx.play('magnetPull', { thief: p.id, victim: mark.id, coins: stolen }, done),
                              'MAGNET', `🧲 Pulled ${stolen} coins straight out of ${mark.name}'s pocket.`, p, 'owner');
                return null;
            }
            return `${mark.name} had nothing left to take.`;
        }
        case 'truce': {
            // A truce is a truce with the whole table, not with seat 1.
            state.players.forEach(q => earnCoins(q, 5));
            // The pop is drawn between the two players furthest apart, so the
            // effect still reads as a handshake across the board rather than
            // three overlapping bursts on one tile.
            const near = Targeting.nearestRival(p) || p;
            Fx.play('trucePop', { a: p.pos, b: near.pos });
            _checkContract(p, 'land_type', 'truce');
            return playerCount() > 2 ? 'Everyone gains 5 coins!' : 'Both players gain 5 coins!';
        }
        case 'player_trap': {
            if (space?.owner !== undefined && space.owner !== p.id) {
                const owner = state.players[space.owner];
                const fee   = loseCoins(p, 5);
                if (fee > 0) earnCoins(owner, fee);
                return fee === 0 ? '🛡️ Shielded from Tollbooth!' : `Paid ${fee} coins to ${owner.name}!`;
            }
            return 'Your own Tollbooth.';
        }
        // Landing on an already-broken gate is a non-event, but it still needs
        // real copy — returning '' fell through to the generic "Nothing happens."
        case 'gate': case 'gate_open':
            return ActiveMap.isLinear()
                ? 'The Rift hangs open — you pass straight through.'
                : 'The Gate stands open — you pass straight through.';
        case 'shop': {
            _noteShopVisit(p);
            if (ActiveMap.has('realms')) {
                Fx.play('shopGlow', { node: p.pos });
            Director.hold('SHOP_OPEN', () => openShop(hbdShopKey(p.pos), 1.0)); return null;
            }
            const gNode   = ActiveMap.graph()[p.pos];
            const distKey = gNode?.shopDistrict || 'ring';
            const disc    = distKey === 'ba' ? BA_DISCOUNT : 1.0;
            Fx.play('shopGlow', { node: p.pos });
            Director.hold('SHOP_OPEN', () => openShop(distKey, disc)); return null;
        }
        case 'hq': {
            const gNode  = ActiveMap.graph()[p.pos];
            const dist   = gNode?.district;
            const isGM   = gNode?.isGrandMall;
            _onDistrictHQReached(p, dist);
            if (isGM) { _noteShopVisit(p); Director.hold('SHOP_OPEN', () => openShop('shop', GRAND_MALL_DISCOUNT)); }
            const hqInfo = HQ_META[dist] || { name: 'HQ', icon: '🏛️' };
            const visits = p.districtsVisited[dist] || 1;
            const bonus  = visits <= 1 ? DISTRICT_HQ_FIRST_BONUS : DISTRICT_HQ_REVISIT_BONUS;
            return `${hqInfo.icon} ${hqInfo.name}! +${bonus} coins${isGM ? ' · Grand Mall opens!' : ''}`;
        }
        case 'duel': {
            _checkContract(p, 'land_type', 'duel');
            // Stepping into the ring pays a stake FIRST. A player on zero coins
            // used to meet a bet screen with every option disabled and no close
            // button — a hard lock, and the one place on the board where being
            // broke stopped the game rather than just costing you.
            earnCoins(p, DUEL_STAKE);
            Fx.play('coinPop', { node: p.pos, seat: p.id, big: false });
            UIManager.updateUI();
            UIManager.toast(`⚔️ Ante up! +${DUEL_STAKE} coins to bet with.`, '#fbbf24', { urgent: true });
            // Stage it. The bet picker used to appear with no lead-in at all,
            // which made the biggest voluntary risk on the board feel like a
            // form. This costs nothing: the minigame follows either way.
            // The challenger is picked ONCE, here, and remembered on state.
            // The bet screen, the face-off and the payout all read that one
            // field — recomputing "the opponent" in each of them was safe at
            // two seats and would let a duel pay out against a different
            // player than the one it staged at four.
            const foe = Targeting.nearestRival(p) || opp;
            state.pendingDuelTarget = foe.id;
            Fx.play('duelFaceoff', { a: p.id, b: foe.id }, () => {
                Renderer.endCinematic();
                if (state.gameState !== 'ACKNOWLEDGE') return;
                if (p.isBot) _startDuel(p, Bot.duelBet(p, foe));
                else Director.hold('DUEL_OPEN', () => _openDuelModal(p));
            });
            return null;
        }
        default: return '';
    }
}

// Play a set piece that OWNS the screen, then raise its card. The caller has
// already applied the effect to the game state, so the rules are consistent from
// the moment the animation starts — the animation is a retelling, never the
// source of truth. Whatever happens, the camera comes back and the turn carries
// on from the card.
//
// `run(done)` is the animation; `done` must be called exactly once.
function _playSetPiece(run, title, message, p, tier) {
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        SetPieces.clearSetPieces();
        Renderer.endCinematic();
        UIManager.updateUI();
        if (state.gameState !== 'ACKNOWLEDGE') return;
        ModalManager.showMessage(title, message, '', { tier: tier || 'owner',
            ticker: `${p.name}: ${message.split('\n')[0]}` });
        Director.begin('LAND_RESULT');
        if (p.isBot) {
            Director.hold('BOT_RESULT', () => {
                if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal();
            });
        }
    };
    try { run(finish); } catch (e) { console.error('[SetPiece] failed:', e); finish(); }
}

// Run the abduction and raise the card when the saucer has gone. Shared by the
// SWAP ZONE space and the Swap item, because they are the same event and should
// not look like two different ones.
//
// It is a SHARED-tier card: a swap happens TO both players, so both need to
// read the outcome, not just whoever triggered it.
function _playSwap(p, opp, message) {
    Fx.play('swap', { a: p.id, b: opp.id }, () => {
        // Belt and braces: whatever the animation did, the tokens end on their
        // nodes. An interrupted cinematic must not leave the board lying.
        if (p.mesh)   p.mesh.position.copy(Renderer.getPos(p.pos));
        if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos));
        Renderer.snapCameraToActive();
        UIManager.updateUI();
        if (state.gameState !== 'ACKNOWLEDGE') return;
        ModalManager.showMessage('SWAP ZONE', message, '🛸', { tier: 'shared' });
        Director.begin('LAND_RESULT');
        if (p.isBot) {
            Director.hold('BOT_RESULT', () => {
                if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal();
            });
        }
    });
}

// ---- Forced movement helpers (graph-aware) ----

function _skipForward(p, steps) {
    if (ActiveMap.isLinear()) { _movePlayerHBD(p, steps, true); return; }
    let cur = p.pos;
    let left = steps;
    while (left > 0) {
        const gn = ActiveMap.graph()[cur];
        if (!gn) break;
        const nextId = gn.next[0];
        if (ActiveMap.isJunction(nextId)) {
            cur = ActiveMap.graph()[nextId].next[0];
        } else {
            cur = nextId;
        }
        left--;
    }
    p.pos = cur;
    if (p.mesh) p.mesh.position.copy(Renderer.getPos(cur));
    resolveSpace(p);
}

function _skipBackward(p, steps) {
    if (ActiveMap.isLinear()) { _movePlayerHBD(p, -steps, true); return; }
    let idx = ActiveMap.ordered().indexOf(p.pos);
    if (idx < 0) idx = 0;
    idx = ((idx - steps) % ActiveMap.ordered().length + ActiveMap.ordered().length) % ActiveMap.ordered().length;
    p.pos = ActiveMap.ordered()[idx];
    if (p.mesh) p.mesh.position.copy(Renderer.getPos(p.pos));
    resolveSpace(p);
}


// Coin gains/losses live in Economy.js (earnCoins / loseCoins).

// ============================================================
// TURN COMPLETION
// ============================================================

export function resolveMsgModal() {
    if (state.msgModalResolving) return;
    state.msgModalResolving = true;
    // A human tapping CONTINUE has read it — compress what's left of the floor
    // rather than ignoring it, so the next scene still can't render underneath.
    Director.ack();
    ModalManager.closeAllModals();
    UIManager.hideSpaceInfoCard();
    if (state.gameState === 'GAME_OVER') return;
    if (state.gameState === 'MINIGAME_ACK') {
        Director.hold('POST_MINIGAME', () => {
            state.activePlayer = state.lastMinigameWinner >= 0 ? state.lastMinigameWinner : (state.activePlayer+1)%playerCount();
            state.lastMinigameWinner = -1;
            state.lastMinigameTied   = false;
            proceedTurn();
        });
        return;
    }
    state.gameState = 'ACKNOWLEDGE';
    // A forced move waited for this acknowledgement — now do the moving, and
    // let the space it lands on resolve normally.
    if (state.pendingForcedMove) {
        const steps = state.pendingForcedMove;
        state.pendingForcedMove = 0;
        const mover = state.players[state.activePlayer];
        Director.hold('POST_RESULT', () => {
            state.msgModalResolving = false;
            if (steps >= 0) _skipForward(mover, steps);
            else            _skipBackward(mover, -steps);
        });
        return;
    }
    // Beat: the board on its own for a moment before the turn moves on.
    Director.hold('POST_RESULT', finishTurn);
}

// Board progress as 0..1, so one chart shape works for both maps.
function _progressOf(p) {
    if (ActiveMap.isLinear()) {
        const fin = (state.hbd || HBD_DEFAULT_CONFIG).finish || 99;
        return typeof p.pos === 'number' ? Math.max(0, Math.min(1, p.pos / fin)) : 0;
    }
    const i = ActiveMap.ordered().indexOf(p.pos);
    const lapProgress = i < 0 ? 0 : i / (ActiveMap.ordered().length - 1);
    // City Circuit loops, so add completed laps to keep the line monotonic.
    return p.fullCircuitsCompleted + lapProgress;
}

function _recordTurn() {
    state.history.push({
        turn:  state.totalTurns,
        // The round this turn belonged to. City Circuit is scored on coins and
        // played in rounds, so its end-of-match chart plots the coin totals at
        // each round boundary — board position on a lap map says very little
        // about who is winning.
        round: state.currentRound || 0,
        prog:  state.players.map(_progressOf),
        coins: state.players.map(p => p.coins),
    });
    // A long City Circuit match could otherwise grow this unbounded.
    if (state.history.length > 400) state.history.shift();
}

export function finishTurn() {
    if (!_rollAgainActive) {
        state.totalTurns++;
        _tickAllyTurns(state.activePlayer);
        _recordTurn();
    }
    _rollAgainActive = false;

    if (state.rollAgainPending) {
        state.rollAgainPending = false;
        state.rollAgainSamePlayer = true;
        _rollAgainActive = true; // next finishTurn skips totalTurns++ so minigame count isn't skewed
        proceedTurn(); // let the player re-roll; minigame check fires after that turn completes
        return;
    }
    state.rollAgainSamePlayer = false;
    state.activePlayer = (state.activePlayer + 1) % playerCount();
    maybeTriggerMinigame();
}

export function maybeTriggerMinigame() {
    if (state.totalTurns > 0 && state.totalTurns % MINIGAME_EVERY_N_TURNS === 0) {
        if (ActiveMap.has('roundLimit')) {
            state.currentRound++;
            _onRoundEnd();
            if (state.currentRound >= _cityRounds()) {
                // Last round: an ally that just landed can never be claimed, so
                // do not stop the match to announce it.
                state.pendingAllyReveal = null;
                Renderer.removeAllyMarker();
                state.allyOnMap = null;
                // Beat: the board is allowed to breathe before the minigame
                // takes the screen. Without this the payoff for the turn that
                // just happened is cut off mid-read.
                Director.hold('PRE_MINIGAME', () => _runRoundContest(winnerId => {
                    _resolveMinigameResult(winnerId);
                    Director.hold('WIN_SCREEN', calculateWinner);
                }));
                return;
            }
        }
        // The buddy report used to be raised HERE, holding the minigame back at
        // the close of the round. It now waits for the start of the next round —
        // the minigame is the round's payoff and should not be queued behind
        // news about the round that has not started yet, and a card read four
        // turns before anybody can act on it is a card people forget.
        // Decide the pair BEFORE the banner so it can name them, and hand the
        // same pair to the contest — deriving it twice would risk the banner
        // and the game disagreeing about who is playing.
        // Offline this names the two who are about to play. Online everybody
        // plays, so the banner names the table.
        // EVERYBODY IS IN THE ROUND.
        //
        // This used to pick two of the table by rotation and leave the rest
        // watching, because every game was built for two. The round is now one
        // LIVE game with every seat in it at the same time, so the roster is
        // simply the table.
        const pair = state.players.map((_, i) => i);
        UIManager.announceMinigameIncoming(pair);
        Director.hold('PRE_MINIGAME', () =>
            _runRoundContest(winnerId => _resolveMinigameResult(winnerId), pair));
    } else {
        Director.hold('TURN_HANDOFF', proceedTurn);
    }
}

// The buddy report. Once per round, before the minigame takes the screen, say
// what the buddy situation is and WAIT for a press.
//
// This started as an arrival-only card: it fired on the one round a buddy
// spawned and never again, so a buddy could sit on the board for the rest of
// the match with nobody reminded it was there, and a buddy at your side could
// expire without warning. Now it reports every round there is anything to
// report — who is on the board, where, how many rounds before they leave, and
// what each player is holding with the turns left on it. Both players are about
// to race for the same buddy, so it is a shared card.
// The round's contest between two players.
//
// OFFLINE this is the minigame, exactly as it always was.
//
// ONLINE it is not — yet. All 22 minigames are 1v1 split-screen games that
// read local touches and simulate locally; making them play across devices is
// Phase C (docs/MULTIPLAYER_PLAN.md), and it is a bigger job than the whole
// board was. Launching one anyway would put a playable game on the host's
// phone and a frozen board on everybody else's, which is worse than not
// launching it: a client would hang at every round end with nothing to press.
//
// So online, the round is decided by a draw between the two players whose turn
// it is in the rotation, announced as exactly that. The board match is whole
// and playable end to end; the round's payoff is honest about being a
// placeholder rather than pretending to be a contest of skill.
function _runRoundContest(done, pair) {
    // ACROSS PHONES, EVERYBODY PLAYS.
    //
    // Offline the round is a duel between two of the seats, picked by rotation,
    // because the game is one screen two people share and a third person has
    // nowhere to put their hands. A parallel game has no such limit: four
    // solitaires run as happily as two, so the reason for the pairing is gone
    // and sitting two of four players out of every round would be a rule kept
    // only out of habit.
    const seats = pair || state.players.map((_, i) => i);
    _contest(seats, done, {
        title: '🎲 ROUND DRAW',
        award: true,
    });
}

// EVERY route into a minigame goes through here.
//
// There are three — the round-end contest, a Duel space, and a fight over a
// Buddy — and online mode has to intercept all three, not one. Handling only
// the round-end one is what left a networked match frozen on MINIGAME_INTRO
// the first time anybody landed on a Duel tile: the host launched a real 1v1
// split-screen game, every phone showed the intro card, and nothing could
// finish it. qa/net.js caught it as a stall.
//
// `opts.award` pays the standard minigame reward, which the round-end contest
// does and the other two do not — a duel settles its own wager and a buddy
// fight hands over the buddy.
// How a networked round is actually played, registered by src/net at startup.
//
// Deliberately a hook rather than an import. Everything under src/net knows
// about src/core; nothing under src/core knows about src/net, which is what
// lets the whole board be played, tested and reasoned about offline. A direct
// import here would invert that for one function.
//
// It is handed the seats, and calls back with the winning seat.
let _onlineContest = null;
export function setOnlineContest(fn) { _onlineContest = fn; }

// Who actually played the last contest.
//
// Offline this is MinigameManager's roster, because the manager ran the game
// and knows. Online it did not: the round is run by src/net and the manager's
// roster is still whatever it was left at — which is [0, 1], so a four-player
// online round would have broken the streaks of two players who had just won
// it and left the other two untouched.
let _lastContestSeats = null;

function _contest(pair, done, opts = {}) {
    _lastContestSeats = pair.slice();
    if (state.playStyle !== 'online') {
        // ONE GAME, EVERY SEAT IN IT, EVERYBODY PLAYING AT ONCE.
        //
        // This used to branch at three seats into RoundFormat — a bracket of
        // 1v1 legs, or a relay of solo turns. Both were answers to "everybody
        // plays" and both got "nobody waits" wrong: a bracket has two people
        // watching for two thirds of the round and a relay has three.
        //
        // There is no branch now. The draw bag above two seats holds only LIVE
        // games (MG_PROFILE.live — games whose code actually has N slots), so
        // the round is simply that game with every seat in it. A duel or a
        // buddy fight still passes an explicit pair and still gets a two-slot
        // game, which is right: those ARE between two people.
        MinigameManager.trigger(done, pair);
        return;
    }

    // A game the whole table can actually play. The parallel games never let
    // one player's half touch another's, so every phone runs the same challenge
    // from the same seed and the scores are compared — which is both playable
    // across devices and the only version that works at four seats.
    if (_onlineContest) {
        const started = _onlineContest(pair, (winner, table) => {
            if (opts.award) {
                state.players[winner].mgWins++;
                // PAID BY PLACE, the same ladder the shared-screen rounds use.
                // The online round has a real table of scores, so the ranking
                // is the honest one rather than "winner and everybody else".
                const seats = Array.isArray(table) && table.length
                    ? table.map(t => t.seat) : pair.slice();
                const scores = Array.isArray(table) && table.length
                    ? table.map(t => Number(t.score) || 0)
                    : pair.map(id => (id === winner ? 1 : 0));
                const coins = MinigameManager.placeCoins(scores);
                seats.forEach((seat, i) => {
                    if (coins[i] > 0 && state.players[seat]) earnCoins(state.players[seat], coins[i]);
                });
            }
            UIManager.updateUI();
            done(winner);
        }, opts);
        if (started) return;
    }

    // No networked game available — the old draw, kept as the fallback so a
    // registry change can never leave a networked round with no way to finish.
    // Names everybody in it, not the first two: online rounds are the whole
    // table now, and a card reading "Ana vs Mo" in a four-player match would be
    // wrong about who just lost.
    const who = pair.map(id => state.players[id].name).join(' · ');
    const winner = pair[Math.floor(Math.random() * pair.length)];
    ModalManager.showMessage(
        opts.title || '🎲 DRAW',
        `${who} — ${state.players[winner].name} takes it.`,
        '🎲', { tier: 'shared' });
    if (opts.award) {
        state.players[winner].mgWins++;
        // No game was played, so there is no ranking to pay from — the winner
        // takes first place and the rest share what is left, which is what the
        // ladder does with a result it cannot rank.
        const coins = MinigameManager.placeCoins(pair.map(id => (id === winner ? 1 : 0)));
        pair.forEach((seat, i) => {
            if (coins[i] > 0 && state.players[seat]) earnCoins(state.players[seat], coins[i]);
        });
    }
    UIManager.updateUI();
    Director.hold('POST_RESULT', () => { ModalManager.closeAllModals(); done(winner); });
}

function _afterAllyReveal(then) {
    const reveal = state.pendingAllyReveal; state.pendingAllyReveal = null;
    const rep    = buddyReport();
    state.pendingBuddyDeparture = null;
    const anythingToSay = rep.onMap || rep.departed || rep.held.some(h => h.buddies.length);
    if (!anythingToSay) { then(); return; }

    const resume = () => {
        SetPieces.clearSetPieces();
        Renderer.endCinematic();
        then();
    };
    // The camera swoops to the tile under the card, so "near the Back Alley" is
    // backed by actually seeing it. Only for a NEW arrival — flying to the same
    // tile every round for a buddy nobody has claimed is noise.
    if (reveal) Fx.play('allyArrival', { node: reveal.nodeId }, () => {});
    UIManager.showBuddyReport(rep, !!reveal, resume);
}

function _resolveMinigameResult(winnerId) {
    state.mgContext = null;
    let msg, icon;
    if (state.lastMinigameTied) {
        state.lastMinigameTied = false;
        msg = playerCount() > 2
            ? `It's a tie! Everyone got coins — ${state.players[winnerId].name} goes first!`
            : `It's a tie! Both players got coins — ${state.players[winnerId].name} goes first!`;
        icon = '🪙';
    } else {
        msg = `${state.players[winnerId].name} wins — they roll first next turn!`;
        icon = '🏆';
    }
    // Track consecutive wins for contracts. Only the two who actually played
    // move: in a three- or four-player match the spectators neither won nor
    // lost, and breaking their streak for a game they were not in is wrong.
    const played = _lastContestSeats && state.playStyle === 'online'
        ? _lastContestSeats : MinigameManager.roster();
    played.forEach(seat => {
        const q = state.players[seat];
        if (!q) return;
        if (seat === winnerId) q.consecutiveMgWins++;
        else q.consecutiveMgWins = 0;
    });
    if (ActiveMap.has('bounties')) {
        _checkContract(state.players[winnerId], 'win_minigame');
        _checkContract(state.players[winnerId], 'win_minigames', null, state.players[winnerId].consecutiveMgWins);
    }
    ModalManager.showMessage('MINIGAME OVER', msg, icon, { tier: 'shared' });
    Renderer.startPostMinigameFlyover(() => { state.cameraState = 'FOLLOW'; });
    if (ActiveMap.has('roundLimit')) UIManager.updateRoundCounter(state.currentRound, _cityRounds());
    // Nobody is going to press CONTINUE for a bot, so the card dismisses
    // itself in any match where no human is watching for it.
    if (state.players.every(pl => pl.isBot) || (playerCount() === 2 && state.players[1].isBot)) {
        Director.hold('BOT_RESULT', () => { if (state.gameState === 'MINIGAME_ACK') resolveMsgModal(); });
    }
    // Reset per-round state
    state.investorUsedThisRound = state.players.map(() => false);
    state.players.forEach(p => { p.coinsEarnedThisRound = 0; p.shopsVisitedThisLap = 0; p.cabbieUsedThisRound = false; });
}

// Exported because it is a real lifecycle step — round-end interest, the buddy
// expiry clock and the next spawn all hang off it — and the buddy probe needs to
// advance rounds without playing four minigames to get there.
export function onRoundEnd() { _onRoundEnd(); }

function _onRoundEnd() {
    // Round-total contract (c25) — checked before _resolveMinigameResult clears
    // the per-round tally.
    state.players.forEach(p => _checkContract(p, 'earn_coins_round', null, p.coinsEarnedThisRound));
    // Banker ally: interest on coins
    state.players.forEach(p => {
        const bankerIdx = p.allies.findIndex(a => a.type === 'banker');
        if (bankerIdx >= 0) {
            const interest = Math.floor(p.coins / 10);
            if (interest > 0) { earnCoins(p, interest); UIManager.toast(`💼 Banker: +${interest} coins interest!`, '#fbbf24'); }
        }
    });
    // A buddy left waiting on the board runs out of patience. Without this the
    // board buddy was permanent — nothing ever cleared an unclaimed one — so
    // "how long until it leaves" had no answer and ignoring it cost nothing.
    if (state.allyOnMap) {
        state.allyOnMap.roundsLeft = (state.allyOnMap.roundsLeft ?? BUDDY_MAP_ROUNDS) - 1;
        if (state.allyOnMap.roundsLeft <= 0) {
            const gone = ALLIES[state.allyOnMap.allyType];
            Renderer.removeAllyMarker();
            state.allyOnMap = null;
            state.pendingAllyReveal = null;
            state.pendingBuddyDeparture = gone ? `${gone.icon} ${gone.name}` : null;
            _scheduleAllySpawn(ALLY_SPAWN_DELAY_TURNS);
        }
    }

    // Maybe spawn ally
    if (state.allySpawnCountdown > 0) {
        state.allySpawnCountdown--;
        if (state.allySpawnCountdown === 0 && !state.allyOnMap) spawnAlly();
    } else if (!state.allyOnMap) {
        spawnAlly();
    }
}

// The buddy report opens the round it belongs to.
//
// It used to be raised at the CLOSE of a round, in the same breath as the
// minigame — which meant the news about a buddy arrived four board turns before
// anybody could act on it, queued in front of the round's own payoff, and was
// long forgotten by the time the next player actually rolled. It is now the
// first thing a new round does: the board is up, the camera is free to swoop to
// the tile, and the very next thing that happens is somebody taking a turn.
//
// Returns true when it took the screen, in which case startPreRoll() steps back
// and lets the card's own callback restart it.
// currentRound counts rounds COMPLETED, so the last round being PLAYED is the
// one where that count is one short of the total.
let _finalRoundAnnounced = false;
function _finalRoundDue() {
    if (state.selectedMap === 'hundred_block_dash') return false;
    if (_finalRoundAnnounced) return false;
    const total = _cityRounds();
    return total > 1 && state.currentRound === total - 1;
}

let _buddyRemindedRound = -1;
function _buddyReportDue() {
    if (!ActiveMap.has('buddies')) return false;
    if (_buddyRemindedRound === state.currentRound) return false;
    const rep = buddyReport();
    return !!(rep.onMap || rep.departed || rep.held.some(h => h.buddies.length));
}
function _showBuddyReportThen(then) {
    _buddyRemindedRound = state.currentRound;
    _afterAllyReveal(then);
}

// Everything the round report needs to say, gathered in one place so the card
// and the QA probes read the same numbers.
export function buddyReport() {
    const onMap = state.allyOnMap ? {
        type:       state.allyOnMap.allyType,
        nodeId:     state.allyOnMap.nodeId,
        roundsLeft: state.allyOnMap.roundsLeft ?? BUDDY_MAP_ROUNDS,
        where:      ActiveMap.regionName(ActiveMap.graph()[state.allyOnMap.nodeId]?.district) || 'the city',
        isNew:      !!state.pendingAllyReveal,
    } : null;
    return {
        onMap,
        departed: state.pendingBuddyDeparture || null,
        held: state.players.map(p => ({
            name: p.name,
            buddies: p.allies.map(a => ({
                type: a.type,
                turnsLeft: a.turnsRemaining,
                charges: ALLIES[a.type]?.shieldCharges ? a.shieldCharges : null,
            })),
        })),
    };
}

export function proceedTurn() {
    UIManager.hideActionRows();
    UIManager.applyOrientation();
    const p = state.players[state.activePlayer];

    // The gate check used to live here, ahead of the pass prompt and on the HBD
    // branch only. It is now the first thing startPreRoll() does, for both maps
    // and after the device has changed hands.
    if (ActiveMap.has('realms')) Renderer.updateBiomeVisuals(typeof p.pos === 'number' ? p.pos : 0);
    else Renderer.updateBiomeVisuals(ActiveMap.graph()[p.pos]?.district || 'ring');
    if (state.playStyle === 'pass' && state.totalTurns > 0 && !state.rollAgainSamePlayer) {
        state.gameState = 'PASS_PROMPT';
        ModalManager.showPassModal(`Pass the device to ${p.name}.`, false);
    } else {
        state.rollAgainSamePlayer = false;
        startPreRoll();
    }
}

export function resolvePassModal() {
    ModalManager.closeAllModals();
    Director.hold('TURN_HANDOFF', startPreRoll);
}

// ============================================================
// GATE CHALLENGE
// ============================================================

export function triggerGateChallenge(p) {
    Scenes.emit('gate', { seat: p.id });
    state.msgModalResolving = false;
    state.gameState = 'GATE'; state.gateRolling = false;
    // The gate is a full-screen scene that never called updateUI(), so in
    // tabletop mode it inherited whatever rotation was last applied and could
    // show Player 1 their own roll upside-down. Orient to the roller explicitly.
    UIManager.orientTo(p.id);
    Physics.clearDice(Renderer.getDiceGroup());
    // #ui-layer stays hidden for the whole gate scene. That is what makes items,
    // the map and the ordinary roll unavailable here: the only control on screen
    // is the gate's own button, and the gate is a straight test of the dice.
    document.getElementById('ui-layer').style.display = 'none';
    // Put the camera on the gate. The overlay used to be an opaque black panel
    // over the entire screen, so the player rolled to break through a gate they
    // could not see; the card is now transparent and this is what makes that
    // worth doing.
    Renderer.focusOnGate(p);
    const isHBD = ActiveMap.isLinear();
    const gateTitleEl = document.getElementById('gate-title');
    if (gateTitleEl) gateTitleEl.textContent = isHBD ? 'THE RIFT' : 'THE GATE';
    const gateMsg = isHBD
        ? `Roll ${GATE_NUM_DICE} dice. Score ${ActiveMap.gateThreshold()}+ to tear through The Rift into the Void!`
        : `Roll ${GATE_NUM_DICE} dice. Score ${ActiveMap.gateThreshold()}+ to break through the Industrial Zone!`;
    document.getElementById('gate-sub').textContent = gateMsg;
    document.getElementById('gate-result').textContent = '';
    document.getElementById('gate-sum').textContent = '';
    document.getElementById('gate-open-banner').style.display = 'none';
    document.getElementById('gate-roll-btn').style.display = 'block';
    document.getElementById('gate-roll-btn').disabled = false;
    document.getElementById('gate-continue-btn').style.display = 'none';
    const overlay = document.getElementById('gate-overlay');
    overlay.style.display = 'flex';
    overlay.dataset.pid = p.id;
    // The gate card lives on the same edge as the toast rail; this moves the
    // rail to the opposite (empty) edge for the duration.
    document.body.classList.add('gate-scene');
    if (p.isBot) Director.wait(BOT_THINK.GATE_ROLL, () => { if (state.gameState === 'GATE') rollGate(); });
}

export function rollGate() {
    if (state.gateRolling) return;
    state.gateRolling = true;
    sfx('gate_roll');
    document.getElementById('gate-overlay').style.display = 'none';
    Physics.clearDice(Renderer.getDiceGroup());
    const p  = state.players[parseInt(document.getElementById('gate-overlay').dataset.pid)];
    const pm = p.mesh;
    Physics.positionWalls(pm.position.x, 0, pm.position.z, 12);
    const camera = Renderer.getCamera();
    const pPos   = pm.position.clone();
    let dir = pPos.clone().sub(camera.position); dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(0,0,-1); else dir.normalize();
    const diceGrp = Renderer.getDiceGroup();
    for (let i = 0; i < GATE_NUM_DICE; i++) {
        const d = Physics.spawnDie(diceGrp);
        const offset = (i-(GATE_NUM_DICE-1)/2)*2.5;
        const right  = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0), dir).normalize();
        d.body.position.set(pPos.x+dir.x*1.5+right.x*offset, pPos.y+3, pPos.z+dir.z*1.5+right.z*offset);
        const sp = 14+Math.random()*8;
        d.body.velocity.set(dir.x*sp+(Math.random()-0.5)*5, 16+Math.random()*8, dir.z*sp+(Math.random()-0.5)*5);
        d.body.angularVelocity.set((Math.random()-0.5)*30,(Math.random()-0.5)*30,(Math.random()-0.5)*30);
    }
    Physics.onSettle('gate', () => { sfx('dice_land'); haptic([10]); setTimeout(resolveGateRoll, 100); });
}

export function resolveGateRoll() {
    const activeDice = Physics.getActiveDice();
    activeDice.forEach(d => d.body.angularVelocity.set(0,0,0));
    setTimeout(() => {
        const faceValues = activeDice.map(d => Physics.readTopFace(d));
        const total = faceValues.reduce((s,v) => s+v, 0);
        const pid   = parseInt(document.getElementById('gate-overlay').dataset.pid);
        const p     = state.players[pid];
        const succeeded = total >= ActiveMap.gateThreshold();
        const overlay = document.getElementById('gate-overlay');
        overlay.style.display = 'flex';
        document.getElementById('gate-roll-btn').style.display = 'none';
        document.getElementById('gate-open-banner').style.display = 'none';
        document.getElementById('gate-result').textContent = '';
        document.getElementById('gate-sum').textContent = '';
        let dieStr = '';
        faceValues.forEach((val,i) => { setTimeout(() => { dieStr += (i>0?' + ':'')+val; document.getElementById('gate-sum').textContent = `🎲 ${dieStr}`; }, i*500); });
        setTimeout(() => { document.getElementById('gate-sum').textContent = `Total: ${total}  (need ≥ ${ActiveMap.gateThreshold()})`; }, faceValues.length*500+300);
        setTimeout(() => {
            if (succeeded) {
                state.gateOpen = true;
                // The breach. This is the only permanent change to the board in
                // a whole match, and it used to be a line of text on a card. The
                // gate shatters and the camera passes through the gap it leaves.
                Fx.play('gateBreach', { node: p.pos }, () => {
                    Renderer.updateSingleTile();
                    if (state.gameState === 'GATE') Renderer.focusOnGate(p);
                });
                document.getElementById('gate-result').textContent = '🔓 INDUSTRIAL ZONE OPEN!';
                document.getElementById('gate-result').style.color = '#4ade80';
                document.getElementById('gate-open-banner').style.display = 'block';
                document.getElementById('gate-continue-btn').textContent = 'ENTER ZONE';
                UIManager.toast(`${p.name} BREAKS THROUGH! Score: ${total}`, '#4ade80', { urgent: true });
                _checkContract(p, 'open_gate');
            } else {
                document.getElementById('gate-result').textContent = `❌ FAILED (${total})`;
                document.getElementById('gate-result').style.color = '#ef4444';
                document.getElementById('gate-continue-btn').textContent = 'WAIT FOR NEXT TURN';
                UIManager.toast(`${p.name} scored ${total} — gate holds!`, '#ef4444');
            }
            document.getElementById('gate-continue-btn').style.display = 'block';
            state.gameState = 'GATE'; state.gateRolling = false;
            if (p.isBot) Director.wait(BOT_THINK.GATE_CLOSE, () => { if (state.gameState === 'GATE') closeGate(); });
        }, faceValues.length*500+1000);
    }, 100);
}

export function closeGate() {
    Scenes.emit('gateEnd', {});
    document.getElementById('gate-overlay').style.display = 'none';
    document.body.classList.remove('gate-scene');
    document.getElementById('ui-layer').style.display = 'block';
    Physics.clearDice(Renderer.getDiceGroup());
    SetPieces.clearSetPieces();
    Renderer.clearGateFocus();
    state.cameraState = 'FOLLOW';
    const pid = parseInt(document.getElementById('gate-overlay').dataset.pid);
    const p   = state.players[pid];
    // The gate overlay owned the whole screen; put the camera back on the player
    // before anything moves, or the token walks off-frame while the follow
    // camera lerps after it at 0.055/frame.
    Renderer.snapCameraToActive();
    UIManager.orientTo(p.id);
    state.gameState = 'ACKNOWLEDGE';

    const fromTurnStart = _gateFromTurnStart;
    _gateFromTurnStart = false;

    if (state.gateOpen) {
        const openMsg = ActiveMap.isLinear()
            ? 'The Gate is open! Both players may now pass through.'
            : 'The Industrial Zone is accessible! Both players may now enter.';
        ModalManager.showMessage('🔓 GATE OPEN!', openMsg, '🔓', { tier: 'shared' });
        if (_pendingStepsAfterGate > 0) {
            const steps = _pendingStepsAfterGate; _pendingStepsAfterGate = 0;
            Director.hold('GATE_RESUME', () => {
                ModalManager.closeAllModals();
                Renderer.snapCameraToActive();
                _doMove(p, steps);
            });
            return;
        }
        if (fromTurnStart) {
            // The challenge was raised at the start of this player's turn, so
            // they have not rolled yet. Ending the turn here silently skipped
            // them: they spent a turn opening the gate and then the turn passed
            // to their opponent. Hand them their roll instead.
            Director.hold('GATE_RESUME', () => {
                ModalManager.closeAllModals();
                Renderer.snapCameraToActive();
                state.gameState = 'PRE_ROLL';
                UIManager.toast('🔓 Gate open — take your roll!', '#4ade80');
                startPreRoll();
            });
            return;
        }
    } else {
        // Failed the roll — the banked steps are forfeit either way, and the
        // player stays where they are: at the door.
        //
        // City used to teleport them to 'bp_d' here. bp_d is a JUNCTION — a fork
        // with no board tile, which nothing else in the game ever parks a token
        // on (see _walkThroughJunction). Two things went wrong from there. The
        // card said "try again next turn", but the player was no longer at the
        // gate and startPreRoll had no City gate check, so next turn was an
        // ordinary roll. And moveThroughGraph only offers a branch choice when
        // the NEXT node is a junction, so standing ON one meant taking next[0]
        // — the ring — with no choice offered at all. That is the reported
        // "stuck at the gate, then next round I was at the junction and could
        // just roll and move along."
        _pendingStepsAfterGate = 0;
        ModalManager.showMessage('🔒 GATE HOLDS',
            `${p.name} couldn't break through. You hold your ground at the gate — roll again next turn.`,
            '🔒', { tier: 'shared' });
    }
    if (p.isBot) Director.hold('BOT_RESULT', () => { if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal(); });
}

// ============================================================
// ITEM SHOP
// ============================================================

// Returns true if the item went straight into the bag. A full bag does NOT open
// the picker here: the result card for this space lands a beat later and would
// paint straight over it. resolveSpace reads `pendingDropPick` and gives the
// picker that beat instead.
export function tryGrantItem(p, itemId) {
    if (p.inv.length < MAX_INV) {
        p.inv.push(itemId); UIManager.updateUI();
        return true;
    }
    if (p.isBot) {
        // Bots used to lose the item silently while the card still claimed it
        // was "in your bag". They now make the same call a player does.
        const idx = Bot.dropChoice(p, itemId);
        if (idx >= 0) {
            const dropped = p.inv.splice(idx, 1)[0];
            p.inv.push(itemId);
            UIManager.toast(`${p.name} dropped ${ITEMS[dropped]?.name || dropped} for ${ITEMS[itemId]?.name || itemId}!`, '#f97316');
        }
        UIManager.updateUI();
        return idx >= 0;
    }
    // Found, not bought — nothing is owed when the picker resolves.
    state.pendingShopAfterDrop = false;
    state.pendingBuyCost       = null;
    state.pendingDropPick      = itemId;
    return false;
}

export function openShop(district, discount) {
    const p = state.players[state.activePlayer];
    state.gameState = 'SHOP';
    state.pendingShopDistrict = district || 'ring';
    state.pendingShopDiscount = discount || 1.0;
    if (p.isBot) { _botShop(p); return; }
    ModalManager.openShop(district, discount);
}

// Counts one shop *entry* and fires the `visit_shops` contract event (c23).
// `shopsVisitedThisLap` was previously reset each round but never incremented,
// so that contract was unclaimable.
//
// Must be called only from a genuine entry point — openShop() is re-invoked to
// re-render the modal after every purchase and after the inventory-full drop
// flow, so counting there would let a single shop satisfy a two-shop contract.
function _noteShopVisit(p) {
    p.shopsVisitedThisLap = (p.shopsVisitedThisLap || 0) + 1;
    _checkContract(p, 'visit_shops', null, p.shopsVisitedThisLap);
}

function _botShop(p) {
    const distKey = state.pendingShopDistrict || 'ring';
    const disc    = state.pendingShopDiscount || 1.0;
    const pick    = Bot.shopBuy(p, distKey, disc);
    if (pick) {
        p.coins -= Math.ceil(ITEMS[pick].price * disc);
        p.inv.push(pick);
        UIManager.toast(`${p.name} bought ${ITEMS[pick].name}!`, '#a855f7');
    }
    state.gameState = 'ACKNOWLEDGE';
    Director.wait(BOT_THINK.SHOP, () => { if (state.gameState === 'ACKNOWLEDGE') finishTurn(); });
}

// Used only for HBD bot pass-through shops — does NOT call finishTurn
function _botPassThroughBuy(p) {
    const pick = Bot.passThroughBuy(p);
    if (!pick) return;
    p.coins -= ITEMS[pick].price;
    p.inv.push(pick);
    UIManager.toast(`${p.name} grabbed ${ITEMS[pick].name}!`, '#a855f7');
    UIManager.updateUI();
}

export function buyItem(itemId, cost) {
    const p = state.players[state.activePlayer];
    if (p.coins < cost) return;
    if (p.inv.length >= MAX_INV) {
        state.pendingBuyCost = cost; state.pendingShopAfterDrop = true;
        ModalManager.closeAllModals();
        // A pass-through shop is entered mid-move; forcing the return state to
        // 'shop' here dropped that fact, and closing the shop afterwards ended
        // the turn instead of resuming the rest of the hop.
        const ret = state.pendingReturnState === 'pass_through_done' ? 'pass_through_done' : 'shop';
        ModalManager.openDropModal(p, itemId, cost, ret);
        return;
    }
    p.coins -= cost; p.inv.push(itemId);
    p.itemsBought = (p.itemsBought || 0) + 1;
    _checkContract(p, 'buy_item', null, p.itemsBought);
    sfx('buy'); UIManager.toast(`Bought ${ITEMS[itemId].name}!`, '#a855f7');
    UIManager.updateUI(); openShop(state.pendingShopDistrict, state.pendingShopDiscount);
}

export function closeShopModal() {
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    // A MOVE STILL OWED OUTRANKS EVERYTHING. This used to decide between
    // "carry on walking" and "end the turn" by comparing one string flag
    // (`pendingReturnState === 'pass_through_done'`), and any path that opened a
    // shop without setting it — or that cleared it in between — closed the shop
    // straight into finishTurn(), ending the turn with steps still on the clock
    // and every later interruption on the square skipped. That is the reported
    // "hit the store, the game went to the end of their turn and skipped an
    // ally". The pending continuation is now the authority: if one exists, the
    // move is not finished, whatever any flag says.
    if (_passThroughResumeHop) { _afterPassThroughShop(); return; }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn); }
}

export function shopOfferEnter() {
    ModalManager.closeAllModals();
    _noteShopVisit(state.players[state.activePlayer]);
    state.pendingReturnState = 'pass_through_done';
    openShop(state.pendingShopDistrict, state.pendingShopDiscount);
}

export function shopOfferSkip() { ModalManager.closeAllModals(); _afterPassThroughShop(); }

// Drop a continuation that no longer belongs to the move in progress. A slot
// left set from an abandoned move would make the NEXT shop close resume a walk
// that finished several turns ago.
function _clearPassThroughResume() { _passThroughResumeHop = null; }

function _afterPassThroughShop() {
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    state.gameState = 'MOVING';
    const resume = _passThroughResumeHop; _passThroughResumeHop = null;
    if (resume) Director.hold('PASSTHROUGH', resume);
}

// `dropIdx` of -1 means the player chose to throw away the item they just got
// and keep all three they were carrying. On a shop purchase that also means no
// coins change hands — buying something and immediately binning it is a trap,
// not a decision.
export function confirmDrop(pid, dropIdx, newItemId) {
    const p = state.players[pid];
    // The picker is built from a snapshot of the bag. If anything moved
    // underneath it, back out cleanly rather than splicing a hole in the
    // inventory — this used to throw on ITEMS[undefined].name.
    if (!p || !newItemId || !ITEMS[newItemId] || dropIdx < -1 || dropIdx >= p.inv.length) {
        cancelDrop();
        return;
    }
    if (dropIdx === -1) {
        UIManager.toast(`Left the ${ITEMS[newItemId]?.name || 'item'} behind.`, '#94a3b8');
        state.pendingShopAfterDrop = false; state.pendingBuyCost = null;
        UIManager.updateUI(); ModalManager.closeAllModals();
        _afterDropReturn(p);
        return;
    }
    const dropped = p.inv.splice(dropIdx, 1)[0];
    p.inv.push(newItemId);
    UIManager.toast(`Dropped ${ITEMS[dropped].name}, got ${ITEMS[newItemId].name}!`, '#f97316');
    sfx('buy');
    UIManager.updateUI(); ModalManager.closeAllModals();
    _afterDropReturn(p);
}

export function cancelDrop() {
    state.pendingBuyId = null; state.pendingBuyCost = null; state.pendingShopAfterDrop = false;
    const ret = state.pendingReturnState; state.pendingReturnState = null;
    ModalManager.closeAllModals();
    // CANCEL means "not this item", not "I'm done shopping" — go back to the
    // shop, still mid-move if that's how you got here.
    if (ret === 'shop' || ret === 'pass_through_done') {
        if (ret === 'pass_through_done') state.pendingReturnState = 'pass_through_done';
        openShop(state.pendingShopDistrict, state.pendingShopDiscount); return;
    }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn); return; }
    if (state.gameState === 'ACKNOWLEDGE') Director.hold('POST_RESULT', finishTurn);
}

function _afterDropReturn(p) {
    state.pendingBuyId = null;
    const ret = state.pendingReturnState; state.pendingReturnState = null;
    if (state.pendingShopAfterDrop && state.pendingBuyCost !== null) {
        p.coins -= state.pendingBuyCost; state.pendingBuyCost = null; state.pendingShopAfterDrop = false;
        // A full-bag purchase completes HERE, not in buyItem — the bounty has to
        // be credited on this path too or buying with three items held never counts.
        p.itemsBought = (p.itemsBought || 0) + 1;
        _checkContract(p, 'buy_item', null, p.itemsBought);
        // Going back to the shop must not lose "we are mid-move"; the rest of
        // the hop is resumed when the shop is finally closed.
        if (ret === 'pass_through_done') state.pendingReturnState = 'pass_through_done';
        openShop(state.pendingShopDistrict, state.pendingShopDiscount); return;
    }
    // Backing out of a purchase returns you to the shop you were standing in,
    // rather than throwing you out of it.
    if (ret === 'shop' || ret === 'pass_through_done') {
        if (ret === 'pass_through_done') state.pendingReturnState = 'pass_through_done';
        openShop(state.pendingShopDistrict, state.pendingShopDiscount); return;
    }
    if (state.gameState === 'ACKNOWLEDGE' || state.gameState === 'SHOP') {
        state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn);
    }
}

export function executeUseItem(pid, itemIdx) {
    if (pid !== state.activePlayer) return;
    // No items at the gate. #ui-layer is hidden for the whole gate scene so the
    // bag is unreachable anyway, but the gate is meant to be a straight test of
    // the dice and that should not depend on a display property.
    if (state.gameState === 'GATE') { UIManager.toast('No items at the gate.', '#ef4444', { urgent: true }); return; }
    const p = state.players[pid];
    const itemId = p.inv[itemIdx]; p.inv.splice(itemIdx, 1);
    UIManager.toast(`Used ${ITEMS[itemId].name}!`, '#f5c842'); sfx('buy');
    _checkContract(p, 'use_item', itemId);
    _applyItemEffect(p, itemId, false);
    if (itemId === 'rocket' || itemId === 'custom_dice') return;
    UIManager.updateUI(); ModalManager.closeAllModals();
}

// Targeted items can be bounced by the opponent's Mirror. Returns true if the
// item was reflected (and thus should NOT be applied). Used by both the human
// use-path and the bot pre-roll path so Mirror works consistently in all modes.


// `override` forces a target; nothing passes it today. Left in the signature
// because the Mirror rework and the online path both need a way to say "this
// item was aimed at THIS player" rather than re-deriving it.
function _applyItemEffect(p, itemId, isBot, override) {
    // Each hostile item names the rule it wants. At two seats every rule below
    // resolves to the only other player, so nothing about a 1v1 match changes.
    const leader  = override || Targeting.leadingRival(p) || p;
    const richest = override || Targeting.richestRival(p) || p;
    const opp     = leader;   // for the shared cinematic/toast copy below

    if (itemId === 'cursed_die')  {
        state.cursedTarget[leader.id] = true;
        UIManager.toast(`💀 Cursed Die on ${leader.name}!`, '#ef4444');
    }
    if (itemId === 'shield')        p._shielded = true;
    if (itemId === 'rocket')      { _doMove(p, 8); UIManager.updateUI(); ModalManager.closeAllModals(); }
    if (itemId === 'anchor')      { if (state.board[leader.pos]) { state.board[leader.pos].type = 'anchor_trap'; state.board[leader.pos].owner = p.id; Renderer.updateSingleTile(); UIManager.toast(`⚓ Anchor set under ${leader.name}!`, '#f97316'); } }
    if (itemId === 'swap')        {
        // The same event as the SWAP ZONE space, so the same set piece — a
        // player should not have to learn two visual languages for one thing.
        // The difference is what happens afterwards: this is used BEFORE the
        // roll, so the turn hands back to PRE_ROLL rather than to a result card.
        const tmp = p.pos; p.pos = opp.pos; opp.pos = tmp;
        haptic([50, 30, 50]);
        const resume = state.gameState;
        state.gameState = 'ACKNOWLEDGE';     // no input while the saucer is up
        UIManager.hideActionRows();
        UIManager.hideSwipeZone();
        ModalManager.closeAllModals();
        Fx.play('swap', { a: p.id, b: opp.id }, () => {
            if (p.mesh)   p.mesh.position.copy(Renderer.getPos(p.pos));
            if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos));
            Renderer.snapCameraToActive();
            state.gameState = resume;
            UIManager.updateUI();
            if (resume === 'PRE_ROLL') {
                if (p.isBot) Director.wait(300, () => {
                    if (state.gameState === 'PRE_ROLL') executeRoll(0.8 + Math.random() * 1.5);
                });
                else UIManager.showSwipeZone();
            }
        });
    }
    if (itemId === 'steal')       { const s = Math.min(10, richest.coins); loseCoins(richest, s); earnCoins(p, s); if (s > 0) UIManager.toast(`🕵️ Lifted ${s} coins from ${richest.name}.`, '#f5c842'); }
    if (itemId === 'custom_dice') {
        if (isBot) {
            const pick = Bot.customDice(p);
            UIManager.toast(`${p.name} picks ${pick} with Custom Dice!`, '#f5c842'); UIManager.updateUI();
            if (state.gameState === 'PRE_ROLL') setTimeout(() => _doMove(p, pick), 400);
        } else {
            ModalManager.closeAllModals(); UIManager.updateUI(); ModalManager.openCustomDiceModal();
        }
    }
}

export function confirmCustomDice(num) {
    ModalManager.closeAllModals();
    UIManager.toast(`🎯 Custom Dice: moving ${num} spaces!`, '#f5c842');
    sfx('buy'); haptic([30,50,30]);
    setTimeout(() => _doMove(state.players[state.activePlayer], num), 300);
}

// ============================================================
// DISTRICT TRACKING & SCORING
// ============================================================

function _onDistrictHQReached(p, district) {
    if (!district || !ActiveMap.regionKeys().includes(district)) return;
    p.districtsVisited[district] = (p.districtsVisited[district] || 0) + 1;
    const visits = p.districtsVisited[district];
    const bonus  = visits === 1 ? DISTRICT_HQ_FIRST_BONUS : DISTRICT_HQ_REVISIT_BONUS;
    earnCoins(p, bonus);
    // The single biggest coin event in the game. A first visit gets the crane
    // shot; a revisit is worth a third as much and gets a coin spray instead —
    // frequency sets the budget, and you can pass the same HQ every lap.
    if (visits === 1 && p.mesh) Fx.play('hqPayout', { seat: p.id, amount: bonus }, () => Renderer.endCinematic());
    else if (p.mesh) Fx.play('coinPop', { node: p.pos, seat: p.id, big: true });
    p.districtHQsThisLoop.add(district);
    _checkContract(p, 'visit_hq', district);
    // "Reach 2 different District HQs" counts DISTINCT districts, so send the
    // running total of distinct HQs rather than ticking by one — otherwise two
    // trips through the same district would claim it.
    _checkContract(p, 'visit_hq_any', null,
        ActiveMap.regionKeys().filter(d => (p.districtsVisited[d] || 0) > 0).length);
    // Check for full circuit
    if (p.districtHQsThisLoop.size >= 4) {
        const circuitIdx = Math.min(p.fullCircuitsCompleted, FULL_CIRCUIT_BONUSES.length - 1);
        const circBonus  = FULL_CIRCUIT_BONUSES[circuitIdx];
        earnCoins(p, circBonus);
        p.fullCircuitsCompleted++;
        p.districtHQsThisLoop = new Set();
        UIManager.toast(`🔄 Full Circuit! ${p.name} earns +${circBonus} coins!`, '#fbbf24');
        sfx('land_good');
        _checkContract(p, 'complete_circuit');
    }
    UIManager.updateUI();
}

// ============================================================
// ALLY SYSTEM
// ============================================================

function _scheduleAllySpawn(turnsDelay) {
    state.allySpawnCountdown = turnsDelay;
}

// How many board steps forward from `fromId` to every node the player can reach,
// taking BOTH roads at every junction. A lap-order index difference is not this:
// the districts branch, so "twelve places along the flat list" can be a road the
// player would have to choose and then walk, or a road they cannot reach at all
// this lap. Capped, because the far side of the ring is not worth measuring.
export function stepsFrom(fromId, cap = BUDDY_MAX_STEPS) {
    const dist = {};
    const G = ActiveMap.graph();
    if (!G[fromId]) return dist;
    let frontier = [fromId];
    dist[fromId] = 0;
    for (let d = 1; d <= cap && frontier.length; d++) {
        const next = [];
        for (const id of frontier) {
            for (const n of (G[id]?.next || [])) {
                if (dist[n] !== undefined) continue;
                dist[n] = d;
                next.push(n);
            }
        }
        frontier = next;
    }
    return dist;
}

export function spawnAlly() {
    if (state.allyOnMap) return;
    const allyTypes  = Object.keys(ALLIES);
    const allyType   = allyTypes[Math.floor(Math.random() * allyTypes.length)];
    const realNodes  = ActiveMap.ordered();
    // Prefer nodes not occupied by players
    const occupied = new Set(state.players.map(p => p.pos));
    let candidates = realNodes.filter(id => !occupied.has(id) && state.board[id]?.type !== 'gate');

    // A buddy nobody can reach is a buddy nobody plays for. Placed at random on a
    // 60-node lap, most spawns landed most of a circuit away — the report told
    // you where they were, the countdown told you they were leaving in three
    // rounds, and the two facts did not fit together.
    //
    // Two tiers. Preferred: within BUDDY_NEAR_STEPS of somebody, which is a
    // couple of turns of ordinary rolling. Hard limit: BUDDY_MAX_STEPS, six
    // maximum rolls, so a claim is always at least theoretically possible in the
    // rounds the buddy is around for. Junction distances count both roads, so a
    // node "twenty along the flat list" is only twenty if a real route gets there.
    const reach = state.players.map(p => stepsFrom(p.pos));
    const stepsTo = id => Math.min(...reach.map(r => r[id] === undefined ? Infinity : r[id]));
    const near = candidates.filter(id => stepsTo(id) <= BUDDY_NEAR_STEPS);
    const ok   = candidates.filter(id => stepsTo(id) <= BUDDY_MAX_STEPS);
    // Fall back down the tiers rather than off a cliff: on a board where nobody
    // can reach anything (a player parked at a shut gate, say) an unreachable
    // buddy still beats no buddy.
    if (near.length)    candidates = near;
    else if (ok.length) candidates = ok;

    const nodeId = candidates[Math.floor(Math.random() * candidates.length)] || realNodes[0];

    state.allyOnMap = { nodeId, allyType, roundsLeft: BUDDY_MAP_ROUNDS };
    Renderer.placeAllyMarker(nodeId, allyType);

    const ally   = ALLIES[allyType];
    const gNode  = ActiveMap.graph()[nodeId];
    const hint   = gNode ? ActiveMap.regionName(gNode.district) || 'the city' : 'the city';
    // The announcement is NOT a toast. An ally spawns at the end of a round,
    // which is the same moment the minigame takes the screen — a toast here was
    // covered 1.1 s later and the player never saw where the ally landed, with
    // no way to go and look. maybeTriggerMinigame() waits on this.
    state.pendingAllyReveal = { nodeId, allyType, hint };
}

function _offerAllyEncounter(player, onDone) {
    if (!state.allyOnMap) { onDone(); return; }
    const { allyType } = state.allyOnMap;
    const ally = ALLIES[allyType];
    if (!ally) { onDone(); return; }

    if (player.isBot) {
        if (Bot.allyFight(player)) _startAllyMinigame(player, allyType, false, null, onDone);
        else onDone();
        return;
    }

    _allyMgCallback = onDone;
    UIManager.showAllyEncounterModal(ally, player.allies, (fight) => {
        if (fight) _startAllyMinigame(player, allyType, false, null, onDone);
        else onDone();
    });
}

function _offerAllySteal(stealer, target, onDone) {
    if (target.allies.length === 0) { onDone(); return; }
    if (stealer.isBot) {
        _startAllySteal(stealer, target, Bot.allyStealIndex(target), onDone);
        return;
    }
    UIManager.showAllyStealModal(target, (allyIdx) => {
        if (allyIdx < 0) { onDone(); return; }
        _startAllySteal(stealer, target, allyIdx, onDone);
    });
}

function _startAllySteal(stealer, target, allyIdx, onDone) {
    const allyType = target.allies[allyIdx]?.type;
    if (!allyType) { onDone(); return; }
    _startAllyMinigame(stealer, allyType, true, { target, allyIdx }, onDone);
}

function _startAllyMinigame(player, allyType, isSteal, stealCtx, onDone) {
    state.mgContext = isSteal ? 'ally_steal' : 'ally_claim';
    // A steal is against the player being robbed. A claim is a fight for a
    // buddy nobody owns yet, so the challenger takes on whoever is winning —
    // at two seats both rules pick the only other player, as they always did.
    const foe = isSteal && stealCtx?.target
        ? stealCtx.target
        : (Targeting.leadingRival(player) || state.players[(player.id + 1) % playerCount()]);
    _contest([player.id, foe.id], (winnerId) => {
        state.mgContext = null;
        // endMinigame() hands the camera over in 'FLYOVER' and expects whoever
        // asked for the minigame to put it back. The board-minigame handler does
        // that through startPostMinigameFlyover; this one never did, so one ally
        // encounter froze the camera where the minigame left it — it stopped
        // following the players for the rest of the match. The turn carries on
        // from here mid-move, so it has to be restored now, not at the next roll.
        state.cameraState = 'FOLLOW';
        Renderer.snapCameraToActive();
        const won = winnerId === player.id;
        if (won) {
            if (isSteal && stealCtx) {
                // Steal: inherit clock from target.
                // The victim's 3D marker must always be released — the old check
                // looked at whatever ally shifted into the spliced index, so
                // stealing a player's *last* ally left an orphan model on the board.
                const stolen = stealCtx.target.allies.splice(stealCtx.allyIdx, 1)[0];
                if (!stolen) { UIManager.updateUI(); if (onDone) setTimeout(onDone, 400); return; }
                if (stolen.mesh) {
                    Renderer.detachAllyMesh(stolen.mesh);
                    stolen.mesh = null;
                }
                _grantAlly(player, stolen.type, stolen.turnsRemaining, stolen.shieldCharges);
                _checkContract(player, 'steal_ally');
                UIManager.toast(`${player.name} stole ${ALLIES[allyType]?.icon} ${ALLIES[allyType]?.name}!`, '#ef4444');
            } else {
                // Claim new ally from map
                _grantAlly(player, allyType, ALLY_TURNS);
                state.allyOnMap = null;
                Renderer.removeAllyMarker();
                _scheduleAllySpawn(ALLY_SPAWN_DELAY_TURNS);
                _checkContract(player, 'claim_ally');
            }
        } else {
            UIManager.toast(isSteal ? `${ALLIES[allyType]?.icon} Steal failed!` : `${ALLIES[allyType]?.icon} They stayed put — Buddy not claimed.`, '#ef4444');
        }
        UIManager.updateUI();
        if (onDone) setTimeout(onDone, 400);
    }, { title: '🤝 BUDDY DRAW' });
}

function _grantAlly(player, allyType, turnsRemaining, shieldCharges) {
    if (player.allies.length >= MAX_ALLIES) {
        // Replace oldest ally (first in array)
        const old = player.allies.shift();
        if (old.mesh) Renderer.detachAllyMesh(old.mesh);
    }
    const allyDef  = ALLIES[allyType];
    const charges  = shieldCharges !== undefined ? shieldCharges : (allyDef.shieldCharges || 0);
    const slotIdx  = player.allies.length;
    const mesh     = Renderer.attachAllyMesh(player, slotIdx, allyType);
    player.allies.push({ type: allyType, turnsRemaining: turnsRemaining || ALLY_TURNS, shieldCharges: charges, mesh });
    player.alliesClaimed++;
    UIManager.toast(`${player.name} gained ${allyDef.icon} ${allyDef.name}!`, '#fbbf24');
    UIManager.updateUI();
}

function _tickAllyTurns(playerIdx) {
    if (!ActiveMap.has('buddies')) return;
    const p = state.players[playerIdx];
    for (let i = p.allies.length - 1; i >= 0; i--) {
        p.allies[i].turnsRemaining--;
        if (p.allies[i].turnsRemaining <= 0) expireAlly(p, i);
    }
    UIManager.updateUI();
}

export function expireAlly(player, allyIdx) {
    const ally = player.allies[allyIdx];
    if (!ally) return;
    UIManager.toast(`${ALLIES[ally.type]?.icon} ${ALLIES[ally.type]?.name} has left ${player.name}'s side.`, '#94a3b8');
    if (ally.mesh) Renderer.detachAllyMesh(ally.mesh);
    player.allies.splice(allyIdx, 1);
    UIManager.updateUI();
}

// Cabbie active use
export function activateCabbie(playerIdx) {
    const p = state.players[playerIdx];
    if (p.cabbieUsedThisRound) { UIManager.toast('Cabbie already used this round!', '#ef4444'); return; }
    const cabIdx = p.allies.findIndex(a => a.type === 'cabbie');
    if (cabIdx < 0) return;
    if (p.isBot) { activateCabbie_bot(p); return; }
    UIManager.showCabbieJunctionPicker((junctionId) => {
        p.cabbieUsedThisRound = true;
        // Land on the first real node past the fork, never on the fork itself.
        // This used to set p.pos = junctionId and only correct it in the hop's
        // callback; a junction has no board tile, so anything reading the
        // position during the hop found a space that cannot resolve.
        const firstNode = ActiveMap.graph()[junctionId]?.next?.find(n => !ActiveMap.isJunction(n));
        if (firstNode) {
            if (p.mesh) p.mesh.position.copy(Renderer.getPos(junctionId));
            p.pos = firstNode;
            Renderer.animatePlayerHop(p, firstNode, () => UIManager.updateUI());
        }
        UIManager.toast(`🚕 Cabbie: teleported to ${junctionId.replace('bp_','Junction ').toUpperCase()}!`, '#fbbf24');
        UIManager.updateUI();
    });
}

function activateCabbie_bot(p) {
    const pick = Bot.cabbieJunction(p);
    p.cabbieUsedThisRound = true;
    const firstNode = ActiveMap.graph()[pick]?.next?.find(n => !ActiveMap.isJunction(n));
    if (firstNode) { p.pos = firstNode; if (p.mesh) p.mesh.position.copy(Renderer.getPos(firstNode)); }
    UIManager.toast(`${p.name}'s Cabbie teleports them!`, '#fbbf24');
}

// Spend one Bodyguard charge, if there is one, and report whether it fired.
// loseCoins() has its own copy of this for coin damage; this is the hook for
// board effects that never touch a coin counter.
function _spendBodyguard(p, whatFor) {
    const idx = p.allies.findIndex(a => a.type === 'bodyguard' && a.shieldCharges > 0);
    if (idx < 0) return false;
    p.allies[idx].shieldCharges--;
    sfx('shield');
    UIManager.toast(`🦺 Bodyguard blocks the ${whatFor}! (${p.allies[idx].shieldCharges} left)`, '#22c55e');
    _checkContract(p, 'block_space');
    if (p.allies[idx].shieldCharges <= 0) expireAlly(p, idx);
    UIManager.updateUI();
    return true;
}

// Buddy passive effect checks
function _allyPassive(player, powerType) {
    if (!ActiveMap.has('buddies')) return 0;
    const idx = player.allies.findIndex(a => ALLIES[a.type]?.powerType === powerType);
    if (idx < 0) return 0;
    if (powerType === 'coin_bonus') return 2;
    return 0;
}

// ============================================================
// DUEL SYSTEM
// ============================================================

// Who `p` is duelling. Set when the duel space resolves; falls back to the
// nearest rival so a duel raised by any other route still has a challenger.
function _duelFoe(p) {
    const id = state.pendingDuelTarget;
    if (id !== null && id !== undefined && state.players[id] && id !== p.id) return state.players[id];
    return Targeting.nearestRival(p) || state.players[(p.id + 1) % playerCount()];
}

// WHO DO YOU WANT? The beat before the wager.
//
// At two seats there is exactly one rival and nothing to decide, so the picker
// is skipped entirely and the flow is the one that always shipped. Above two it
// is the whole point of the square: the nearest rival is not always the one
// worth fighting, and the person standing on the tile should be the one to say
// so.
function _openDuelModal(p) {
    const foes = _duelCandidates(p);
    if (foes.length <= 1) {
        state.pendingDuelTarget = foes.length ? foes[0].id : null;
        _openDuelBet(p);
        return;
    }
    ModalManager.showDuelPicker(p, foes.map(f => _rivalCard(p, f)), rivalId => {
        const chosen = state.players[rivalId] ? rivalId : foes[0].id;
        state.pendingDuelTarget = chosen;
        // A short hold so the choice lands before the wager card replaces it —
        // the two screens are different beats and a straight swap reads as one
        // flicker rather than as a decision that was made.
        Director.hold('DUEL_OPEN', () => _openDuelBet(p));
    });
}

function _openDuelBet(p) {
    const opp = _duelFoe(p);
    ModalManager.showDuelModal(p, opp, (betAmount) => {
        _startDuel(p, betAmount);
    });
}

/** Everybody who could actually be fought — a rival with nothing to stake
 *  cannot be duelled, and offering them is offering a dead end. */
function _duelCandidates(p) {
    const able = Targeting.rivals(p).filter(q => q.coins > 0);
    return able.length ? able : Targeting.rivals(p);
}

/**
 * One rival, described for the choice: how far ahead or behind they are, what
 * they are carrying, and the one thing that makes them stand out. `hot` marks
 * the rival a bot takes and the card the eye should land on first.
 */
function _rivalCard(p, q) {
    const lead = Targeting.leadingRival(p);
    const rich = Targeting.richestRival(p);
    const near = Targeting.nearestRival(p);
    const gap  = Math.round((Targeting.progressOf(q) - Targeting.progressOf(p)) * 100);
    let tag;
    if (q.coins <= 0)          tag = 'nothing to stake';
    else if (lead && q.id === lead.id) tag = gap > 0 ? `out in front — ${gap}% ahead` : 'leading the match';
    else if (rich && q.id === rich.id) tag = 'the fattest purse';
    else if (near && q.id === near.id) tag = 'right beside you';
    else tag = gap >= 0 ? `${gap}% ahead of you` : `${-gap}% behind you`;
    return { id: q.id, name: q.name, coins: q.coins, tag, hot: !!(rich && q.id === rich.id) };
}

function _startDuel(p, betAmount) {
    const opp  = _duelFoe(p);
    state.pendingDuelTarget = opp.id;
    const safe = Math.min(betAmount, Math.min(p.coins, opp.coins), 10);
    if (safe <= 0) {
        // A duel needs two stakes. The lander is handed DUEL_STAKE on arrival so
        // this can only mean the opponent is broke — say so rather than ending
        // the turn in silence right after the faceoff.
        UIManager.toast(`No wager — ${opp.name} has nothing to stake.`, '#94a3b8', { urgent: true });
        state.pendingDuelTarget = null;
        Director.hold('POST_RESULT', finishTurn);
        return;
    }
    state.pendingDuelBet = safe;
    state.mgContext = 'duel';
    const duelSeats = [p.id, opp.id];
    UIManager.toast(`⚔️ DUEL! ${p.name} and ${opp.name} bet ${safe} coins!`, '#ef4444');
    _contest(duelSeats, (winnerId) => {
        state.mgContext = null;
        // A duel is between exactly these two, whoever else is in the match:
        // the loser is the other duellist, not "whoever did not win".
        const winner  = state.players[winnerId] === p || state.players[winnerId] === opp
            ? state.players[winnerId] : p;
        const loser   = winner === p ? opp : p;
        const actual  = Math.min(state.pendingDuelBet, loser.coins);
        loseCoins(loser, actual); earnCoins(winner, actual);
        winner.duelsWon++;
        UIManager.toast(`${winner.name} wins the duel! +${actual} coins!`, '#fbbf24');
        _checkContract(winner, 'duel_win');
        state.pendingDuelBet = 0;
        state.pendingDuelTarget = null;
        state.gameState = 'ACKNOWLEDGE';
        Renderer.startPostMinigameFlyover(() => { state.cameraState = 'FOLLOW'; });
        Director.hold('POST_RESULT', finishTurn);
    }, { title: '⚔️ DUEL DRAW' });
}

export function confirmDuelBet(betAmount) {
    ModalManager.closeAllModals();
    _startDuel(state.players[state.activePlayer], betAmount);
}

// Contracts live in Contracts.js (_checkContract is imported as checkContract).

// ============================================================
// WIN SCREEN  (calculateWinner lives in WinScreen.js)
// ============================================================

// Win-screen actions. Rematch flags an intent the next page-load honours
// (main.js → quickStart); both reload to guarantee a clean engine reset.
export function rematch()  { Storage.save('intent', 'rematch'); window.location.reload(); }
export function mainMenu() { Storage.remove('intent'); window.location.reload(); }

// ============================================================
// MAP
// ============================================================

export function openMapView() { UIManager.openMap(); }

// ============================================================
// COMMAND REGISTRATION
// ============================================================
// Every player decision the board understands, named. UI handlers go through
// Commands.run(); online, the net layer intercepts the same names and forwards
// them to the host, which applies them here with Commands.runLocal().
//
// The names are the wire protocol. Renaming one is a breaking change for a
// client on an older build, which is what NetProtocol's version check is for.
// `pathChoice` and `duelBet` are deliberately NOT here. Both have a
// continuation the UI is holding (the Cabbie picker, the bet callback), so
// UIManager and ModalManager register those two themselves. Registering them
// here as well would silently win the race — GameController's body runs after
// theirs — and drop the callback path.
Commands.define({
    roll:          executeRoll,
    useItem:       executeUseItem,
    buy:           buyItem,
    closeShop:     closeShopModal,
    shopEnter:     shopOfferEnter,
    shopSkip:      shopOfferSkip,
    dropConfirm:   confirmDrop,
    dropCancel:    cancelDrop,
    customDice:    confirmCustomDice,
    msgContinue:   resolveMsgModal,
    passContinue:  resolvePassModal,
    gateRoll:      rollGate,
    gateClose:     closeGate,
    cabbie:        activateCabbie,
});
