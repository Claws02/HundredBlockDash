import { state, resetPlayers } from './GameState.js';
import {
    GATE_THRESHOLD, GATE_NUM_DICE, MAX_INV, MAX_ALLIES, ALLY_TURNS, ALLY_SPAWN_DELAY_TURNS,
    MINIGAME_EVERY_N_TURNS, ITEMS, SPACE_META, SPACE_DESCS,
    DISTRICT_HQ_FIRST_BONUS, DISTRICT_HQ_REVISIT_BONUS,
    FULL_CIRCUIT_BONUSES,
    ALLIES, BA_DISCOUNT, GRAND_MALL_DISCOUNT,
    ALL_CHAR_TYPES, HQ_META, CHAR_ICONS,
    CITY_LENGTHS, CITY_DEFAULT_ROUNDS, HBD_LENGTHS,
    buildHbdConfig, setHbdRealmCount, HBD_DEFAULT_CONFIG, HBD_FINISH_BONUS,
    hbdSpaceLabel, hbdShopKey, getRealmForSpace,
} from '../config/GameConfig.js';
import { CITY_GRAPH, JUNCTION_IDS, DISTRICT_NAMES, DISTRICT_KEYS, BRANCH_OPTIONS, ALL_NODES_ORDERED } from '../config/BoardGraph.js';
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
import * as Physics from '../engine/Physics.js';
import * as UIManager from '../ui/UIManager.js';
import * as ModalManager from '../ui/ModalManager.js';
import * as MinigameManager from '../minigames/MinigameManager.js';

window.SPACE_META_REF  = SPACE_META;
window.CITY_GRAPH_REF  = CITY_GRAPH;

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

export function selectMode(m) { state.playStyle = m; }

export function selectDifficulty(level) {
    if (['easy', 'medium', 'hard'].includes(level)) state.botDifficulty = level;
}

export function goToCharSelect() {
    if (!state.playStyle) { UIManager.toast('Please select a game mode first!', '#ef4444'); return; }
    document.getElementById('splash').style.display = 'none';
    document.getElementById('char-select').style.display = 'flex';
    state.charSelectStep = 1;
    document.getElementById('cs-title').textContent = 'PLAYER 1: CHOOSE CHARACTER';
    document.getElementById('cs-title').style.color = 'var(--p1)';
    state.players[1].isBot = (state.playStyle === '1p');
    if (state.players[1].isBot) state.players[1].name = 'Borat the Bot';
}

export function selectChar(type) {
    if (state.charSelectStep === 1) state.p1CharSelection = type;
    else state.p2CharSelection = type;
}

export function confirmCharSelect() {
    if (state.charSelectStep === 1) {
        state.players[0].charType = state.p1CharSelection;
        if (state.playStyle === '1p') {
            const types = ALL_CHAR_TYPES.filter(t => t !== state.p1CharSelection);
            state.players[1].charType = types[Math.floor(Math.random() * types.length)];
            goToMapSelect();
        } else {
            state.charSelectStep = 2;
            document.getElementById('cs-title').textContent = 'PLAYER 2: CHOOSE CHARACTER';
            document.getElementById('cs-title').style.color = 'var(--p2)';
            state.p2CharSelection = state.p1CharSelection === 'slime' ? 'boxy' : 'slime';
        }
    } else {
        state.players[1].charType = state.p2CharSelection;
        goToMapSelect();
    }
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

    // Each map has its own length picker; show only the relevant one.
    const lenSel = document.getElementById('hbd-length-select');
    if (lenSel) lenSel.style.display = mapId === 'hundred_block_dash' ? 'block' : 'none';
    const citySel = document.getElementById('city-length-select');
    if (citySel) citySel.style.display = mapId === 'city_circuit' ? 'block' : 'none';
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
function _savePrefs() {
    Storage.save('prefs', {
        mode:       state.playStyle,
        difficulty: state.botDifficulty,
        map:        state.selectedMap,
        hbdLength:  state.hbdLength,
        cityRounds: state.cityRounds,
        charP1:     state.players[0].charType,
        charP2:     state.players[1].charType,
    });
}

// Re-launch straight into a game with a saved setup (used by REMATCH).
export function quickStart(prefs) {
    if (!prefs || !prefs.mode) return false;
    state.playStyle     = prefs.mode;
    state.botDifficulty = prefs.difficulty || 'medium';
    state.selectedMap   = prefs.map || 'city_circuit';
    state.hbdLength     = prefs.hbdLength || 100;
    state.cityRounds    = prefs.cityRounds || CITY_DEFAULT_ROUNDS;
    state.players[0].charType = prefs.charP1 || 'slime';
    state.players[1].isBot    = (prefs.mode === '1p');
    if (state.players[1].isBot) {
        state.players[1].name = 'Borat the Bot';
        const types = ALL_CHAR_TYPES.filter(t => t !== prefs.charP1);
        state.players[1].charType = types[Math.floor(Math.random() * types.length)];
    } else {
        state.players[1].name = 'Player 2';
        state.players[1].charType = prefs.charP2 || 'boxy';
    }
    document.getElementById('splash').style.display = 'none';
    _skipStory = true;   // rematch jumps straight back into the action
    startGame();
    return true;
}

export function startGame() {
    if (state.gameStarted) return;
    Director.reset();          // no beat from a previous match may fire into this one
    _gateFromTurnStart = false;
    _pendingStepsAfterGate = 0;
    state.gameStarted = true;
    _savePrefs();
    if (state.playStyle === 'tabletop') document.body.classList.add('tabletop-mode');
    document.getElementById('splash').style.display      = 'none';
    document.getElementById('char-select').style.display  = 'none';
    document.getElementById('map-select').style.display   = 'none';
    document.getElementById('game-container').style.display = 'block';
    setTimeout(() => {
        if (!state.gameStarted) return;
        UIManager.setPlayerNames();
        state.activePlayer = Math.floor(Math.random() * 2);
        resetPlayers();
        if (state.selectedMap === 'hundred_block_dash') {
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
                    state.activePlayer === 0 ? '#ff3b3b' : '#3b8eff');
                proceedTurn();
            };
            if (state.selectedMap !== 'hundred_block_dash') {
                _scheduleAllySpawn(1);
                initContracts();
                begin();
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
    return state.gameState === 'PRE_ROLL' && state.activePlayer === pIdx && !state.players[pIdx].isBot;
}

export function startPreRoll() {
    state.gameState = 'PRE_ROLL';
    UIManager.applyOrientation();
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
                    // Respect the opponent's Mirror just like the human use-path does,
                    // otherwise a player's Mirror is useless against the bot.
                    if (_reflectIfMirrored(p, useId)) { UIManager.updateUI(); }
                    else {
                        UIManager.toast(`${p.name} used ${ITEMS[useId].name}!`, '#f5c842');
                        _applyItemEffect(p, useId, true);
                        if (useId === 'rocket' || useId === 'custom_dice') return;
                    }
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
        UIManager.toast('💀 Cursed Die forces a bad roll!', '#ef4444');
    } else if (p._warpNextRoll) {
        p._warpNextRoll = false; state.currentRollMode = 'forced_5';
    } else if (p._doubleNextRoll) {
        p._doubleNextRoll = false; state.currentRollMode = 'double'; numDice = 2;
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
        if (p._overchargeNextRoll) { p._overchargeNextRoll = false; finalResult = Math.min(result * 2, 12); UIManager.toast(`⚡ Overcharged! ${result}×2 = ${finalResult}`, '#eab308'); }
        else UIManager.toast(`Rolled a ${finalResult}!`, '#fff');
        // Beat: the number is on the table and legible before anything moves.
        const mover = state.selectedMap === 'hundred_block_dash' ? _movePlayerHBD : moveThroughGraph;
        Director.hold('DICE_READ', () => mover(state.players[state.activePlayer], finalResult));
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
        const graphNode = CITY_GRAPH[player.pos];
        if (!graphNode) { _onLand(player); return; }
        const nextId = graphNode.next[0];

        // About to step into a junction?
        if (JUNCTION_IDS.has(nextId)) {
            _offerBranchChoice(nextId, (chosenId) => {
                _noteDistrictEntry(player, chosenId);
                // If entering Industrial and gate is closed
                if (CITY_GRAPH[nextId]?.next?.includes(chosenId) && CITY_GRAPH[chosenId]?.district === 'ind' && chosenId === 'ind_0' && !state.gateOpen) {
                    _pendingStepsAfterGate = stepsLeft - 1;
                    player.pos = 'ind_0'; // position them at gate
                    Renderer.animatePlayerHop(player, 'ind_0', () => {
                        triggerGateChallenge(player);
                    });
                    return;
                }
                // Normal advance to chosen node
                stepsLeft--;
                Renderer.animatePlayerHop(player, chosenId, () => {
                    player.pos = chosenId;
                    _checkPassThroughShop(player, chosenId, stepsLeft, advance);
                });
            });
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

// Fires the `enter_district` contract event the first time a player steps off
// the Ring Road into a named district on this trip. Without this, contracts
// c09–c12 ("Enter the ... District") could never be claimed.
function _noteDistrictEntry(player, nodeId) {
    const dist = CITY_GRAPH[nodeId]?.district;
    if (!dist) return;
    // Back on the Ring Road: clear the latch so the next entry counts again
    // (a contract for this district may not have been dealt yet).
    if (dist === 'ring') { player._lastDistrictEntered = null; return; }
    if (player._lastDistrictEntered === dist) return;
    player._lastDistrictEntered = dist;
    _checkContract(player, 'enter_district', dist);
}

function _checkPassThroughShop(player, nodeId, stepsLeft, continueMove) {
    const b = state.board[nodeId];
    if (stepsLeft > 0 && b?.type === 'shop') {
        if (player.isBot) {
            if (Bot.shopPassThrough()) {
                state.gameState = 'SHOP';
                _noteShopVisit(player);
                setTimeout(() => {
                    if (state.gameState !== 'SHOP') return;
                    _botShop(player);
                    Director.wait(BOT_THINK.SHOP, () => { state.gameState = 'MOVING'; continueMove(); });
                }, 400);
            } else setTimeout(continueMove, 300);
        } else {
            _passThroughResumeHop = continueMove;
            state.gameState = 'SHOP';
            ModalManager.showModal('shop-offer-modal');
        }
    } else {
        continueMove();
    }
}

function _onLand(player) {
    // Check for same-space ally steal BEFORE resolving the space
    const opp = state.players[(player.id + 1) % 2];
    if (player.pos === opp.pos && opp.allies.length > 0 && !player.isBot) {
        _offerAllySteal(player, opp, () => resolveSpace(player));
        return;
    }
    if (player.pos === opp.pos && opp.allies.length > 0 && player.isBot) {
        if (Bot.shouldAttemptAllySteal()) _startAllySteal(player, opp, Bot.allyStealIndex(opp), () => resolveSpace(player));
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

function _offerBranchChoice(junctionId, onChosen) {
    const options = BRANCH_OPTIONS[junctionId];
    if (!options) { onChosen(CITY_GRAPH[junctionId].next[0]); return; }

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
    UIManager.showBranchChoice(displayOptions);
}

export function onBranchChosen(nodeId) {
    UIManager.hideBranchChoice();
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
    if (state.selectedMap !== 'hundred_block_dash') return;
    const realm = getRealmForSpace(p.pos);
    if (!realm || realm.key === prevKey) return;
    UIManager.showRealmBanner(realm);
}

// Dispatcher: call the right movement function based on selected map
function _doMove(p, steps) {
    if (state.selectedMap === 'hundred_block_dash') _movePlayerHBD(p, steps, true);
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
    const msg = resolveSpaceEffect(p, space.type, space);
    UIManager.updateUI();
    if (msg === null) return;

    const spc = SPACE_META[space.type] || SPACE_META.coin;
    const goodTypes = ['coin','coin_big','shortcut','cfwd','mystery','truce','gate_open','hq'];
    const badTypes  = ['lose','lose_big','trap','cbwd','magnet','player_trap','anchor_trap','duel'];
    if (goodTypes.includes(space.type))  sfx('land_good');
    else if (badTypes.includes(space.type)) sfx('land_bad');

    // Hundred Block Dash spaces carry realm-themed names/copy.
    const lbl       = state.selectedMap === 'hundred_block_dash' ? hbdSpaceLabel(p.pos, space.type) : null;
    const ovr       = state.pendingResultOverride; state.pendingResultOverride = null;
    const titleName = ovr ? ovr.title : (lbl ? lbl.name : (spc.n || space.type.toUpperCase()));
    const descText  = lbl ? lbl.desc : (SPACE_DESCS[space.type] || '');
    const iconChar  = ovr ? ovr.icon : (lbl ? lbl.icon : spc.ic);
    if (state.selectedMap === 'hundred_block_dash') Renderer.updateBiomeVisuals(typeof p.pos === 'number' ? p.pos : 0);
    else Renderer.updateBiomeVisuals(CITY_GRAPH[p.pos]?.district || 'ring');

    // Beat: let the token visibly arrive, THEN say what the space did. The
    // result then owns the screen for its full floor — nothing else may start.
    Director.hold('LAND_SETTLE', () => {
        if (state.gameState !== 'ACKNOWLEDGE') return;
        UIManager.showSpaceInfoCard(titleName, descText);
        // Owner tier: the card is this player's, the opponent gets the headline
        // on their own edge — first line only, so it stays one glanceable strip.
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
}

export function resolveSpaceEffect(p, spaceType, space) {
    const opp = state.players[(p.id + 1) % 2];
    switch (spaceType) {
        case 'start':      return state.selectedMap === 'hundred_block_dash' ? 'Back at the start!' : 'Back at the city start!';
        case 'coin': {
            const bonus = _allyPassive(p, 'coin_bonus');
            earnCoins(p, 3 + bonus);
            _checkContract(p, 'land_coin'); _checkContract(p, 'land_type', 'coin');
            return `+${3+bonus} coins!${bonus ? ' (Vendor +'+bonus+')' : ''}`;
        }
        case 'coin_big': {
            const bonus = _allyPassive(p, 'coin_bonus');
            earnCoins(p, 8 + bonus);
            _checkContract(p, 'land_coin_big'); _checkContract(p, 'land_type', 'coin_big');
            return `+${8+bonus} coins!${bonus ? ' (Vendor +'+bonus+')' : ''}`;
        }
        case 'lose':     { const l = loseCoins(p, 4);  return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'lose_big': { const l = loseCoins(p, 10); return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'trap':     { const l = loseCoins(p, 5);  return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'mystery': {
            const ids  = Object.keys(ITEMS);
            const pick = ids[Math.floor(Math.random() * ids.length)];
            const it   = ITEMS[pick];
            tryGrantItem(p, pick);
            // Receiving an item is its own moment — show what it is and what it
            // does, under the item's own name, and make the player confirm it.
            state.pendingResultOverride = { title: `YOU GOT: ${it.name.toUpperCase()}`, icon: it.icon };
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
            const tmp = p.pos; p.pos = opp.pos; opp.pos = tmp;
            if (p.mesh) p.mesh.position.copy(Renderer.getPos(p.pos));
            if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos));
            sfx('swap'); haptic([50,30,50]);
            return `Positions swapped with ${opp.name}!`;
        }
        case 'anchor_trap': {
            const owner = space?.owner !== undefined ? state.players[space.owner] : null;
            if (owner && owner.id !== p.id) {
                state.pendingForcedMove = -5;
                return `⚓ ${owner.name}'s Anchor! Dragged back 5 spaces.`;
            }
            return 'Your own Anchor.';
        }
        case 'magnet': {
            const stolen = Math.min(5, opp.coins);
            loseCoins(opp, stolen); earnCoins(p, stolen);
            _checkContract(p, 'land_type', 'magnet');
            return `Stole ${stolen} coins from ${opp.name}!`;
        }
        case 'truce': {
            earnCoins(state.players[0], 5); earnCoins(state.players[1], 5);
            _checkContract(p, 'land_type', 'truce');
            return 'Both players gain 5 coins!';
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
            return state.selectedMap === 'hundred_block_dash'
                ? 'The Rift hangs open — you pass straight through.'
                : 'The Gate stands open — you pass straight through.';
        case 'shop': {
            _noteShopVisit(p);
            if (state.selectedMap === 'hundred_block_dash') {
                Director.hold('SHOP_OPEN', () => openShop(hbdShopKey(p.pos), 1.0)); return null;
            }
            const gNode   = CITY_GRAPH[p.pos];
            const distKey = gNode?.shopDistrict || 'ring';
            const disc    = distKey === 'ba' ? BA_DISCOUNT : 1.0;
            Director.hold('SHOP_OPEN', () => openShop(distKey, disc)); return null;
        }
        case 'hq': {
            const gNode  = CITY_GRAPH[p.pos];
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
            if (p.isBot) { _startDuel(p, Bot.duelBet(p, opp)); return null; }
            Director.hold('DUEL_OPEN', () => _openDuelModal(p)); return null;
        }
        default: return '';
    }
}

// ---- Forced movement helpers (graph-aware) ----

function _skipForward(p, steps) {
    if (state.selectedMap === 'hundred_block_dash') { _movePlayerHBD(p, steps, true); return; }
    let cur = p.pos;
    let left = steps;
    while (left > 0) {
        const gn = CITY_GRAPH[cur];
        if (!gn) break;
        const nextId = gn.next[0];
        if (JUNCTION_IDS.has(nextId)) {
            cur = CITY_GRAPH[nextId].next[0];
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
    if (state.selectedMap === 'hundred_block_dash') { _movePlayerHBD(p, -steps, true); return; }
    let idx = ALL_NODES_ORDERED.indexOf(p.pos);
    if (idx < 0) idx = 0;
    idx = ((idx - steps) % ALL_NODES_ORDERED.length + ALL_NODES_ORDERED.length) % ALL_NODES_ORDERED.length;
    p.pos = ALL_NODES_ORDERED[idx];
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
            state.activePlayer = state.lastMinigameWinner >= 0 ? state.lastMinigameWinner : (state.activePlayer+1)%2;
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
    if (state.selectedMap === 'hundred_block_dash') {
        const fin = (state.hbd || HBD_DEFAULT_CONFIG).finish || 99;
        return typeof p.pos === 'number' ? Math.max(0, Math.min(1, p.pos / fin)) : 0;
    }
    const i = ALL_NODES_ORDERED.indexOf(p.pos);
    const lapProgress = i < 0 ? 0 : i / (ALL_NODES_ORDERED.length - 1);
    // City Circuit loops, so add completed laps to keep the line monotonic.
    return p.fullCircuitsCompleted + lapProgress;
}

function _recordTurn() {
    state.history.push({
        turn:  state.totalTurns,
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
    state.activePlayer = (state.activePlayer + 1) % 2;
    maybeTriggerMinigame();
}

export function maybeTriggerMinigame() {
    if (state.totalTurns > 0 && state.totalTurns % MINIGAME_EVERY_N_TURNS === 0) {
        if (state.selectedMap !== 'hundred_block_dash') {
            state.currentRound++;
            _onRoundEnd();
            if (state.currentRound >= _cityRounds()) {
                // Beat: the board is allowed to breathe before the minigame
                // takes the screen. Without this the payoff for the turn that
                // just happened is cut off mid-read.
                Director.hold('PRE_MINIGAME', () => MinigameManager.trigger((winnerId) => {
                    _resolveMinigameResult(winnerId);
                    Director.hold('WIN_SCREEN', calculateWinner);
                }));
                return;
            }
        }
        UIManager.announceMinigameIncoming();
        Director.hold('PRE_MINIGAME', () =>
            MinigameManager.trigger((winnerId) => _resolveMinigameResult(winnerId)));
    } else {
        Director.hold('TURN_HANDOFF', proceedTurn);
    }
}

function _resolveMinigameResult(winnerId) {
    state.mgContext = null;
    let msg, icon;
    if (state.lastMinigameTied) {
        state.lastMinigameTied = false;
        msg = `It's a tie! Both players got coins — ${state.players[winnerId].name} goes first!`;
        icon = '🪙';
    } else {
        msg = `${state.players[winnerId].name} wins — they roll first next turn!`;
        icon = '🏆';
    }
    // Track consecutive wins for contracts
    state.players.forEach((p, i) => {
        if (i === winnerId) { p.consecutiveMgWins++; }
        else { p.consecutiveMgWins = 0; }
    });
    if (state.selectedMap !== 'hundred_block_dash') {
        _checkContract(state.players[winnerId], 'win_minigame');
        _checkContract(state.players[winnerId], 'win_minigames', null, state.players[winnerId].consecutiveMgWins);
    }
    ModalManager.showMessage('MINIGAME OVER', msg, icon, { tier: 'shared' });
    Renderer.startPostMinigameFlyover(() => { state.cameraState = 'FOLLOW'; });
    if (state.selectedMap !== 'hundred_block_dash') UIManager.updateRoundCounter(state.currentRound, _cityRounds());
    if (state.players[1].isBot) {
        Director.hold('BOT_RESULT', () => { if (state.gameState === 'MINIGAME_ACK') resolveMsgModal(); });
    }
    // Reset per-round state
    state.investorUsedThisRound = [false, false];
    state.players.forEach(p => { p.coinsEarnedThisRound = 0; p.shopsVisitedThisLap = 0; p.cabbieUsedThisRound = false; });
}

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
    // Maybe spawn ally
    if (state.allySpawnCountdown > 0) {
        state.allySpawnCountdown--;
        if (state.allySpawnCountdown === 0 && !state.allyOnMap) spawnAlly();
    } else if (!state.allyOnMap) {
        spawnAlly();
    }
}

export function proceedTurn() {
    UIManager.hideActionRows();
    UIManager.applyOrientation();
    const p = state.players[state.activePlayer];

    if (state.selectedMap === 'hundred_block_dash') {
        Renderer.updateBiomeVisuals(typeof p.pos === 'number' ? p.pos : 0);
        // Gate check at the start of turn (player parked on gate)
        if (!state.gateOpen && p.pos === (state.hbd || HBD_DEFAULT_CONFIG).gatePos) {
            _gateFromTurnStart = true;
            triggerGateChallenge(p); return;
        }
        if (state.playStyle === 'pass' && state.totalTurns > 0 && !state.rollAgainSamePlayer) {
            state.gameState = 'PASS_PROMPT';
            ModalManager.showPassModal(`Pass the device to ${p.name}.`, false);
        } else {
            state.rollAgainSamePlayer = false;
            startPreRoll();
        }
        return;
    }

    if (state.selectedMap === 'hundred_block_dash') Renderer.updateBiomeVisuals(typeof p.pos === 'number' ? p.pos : 0);
    else Renderer.updateBiomeVisuals(CITY_GRAPH[p.pos]?.district || 'ring');
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
    state.msgModalResolving = false;
    state.gameState = 'GATE'; state.gateRolling = false;
    // The gate is a full-screen scene that never called updateUI(), so in
    // tabletop mode it inherited whatever rotation was last applied and could
    // show Player 1 their own roll upside-down. Orient to the roller explicitly.
    UIManager.orientTo(p.id);
    Physics.clearDice(Renderer.getDiceGroup());
    document.getElementById('ui-layer').style.display = 'none';
    const isHBD = state.selectedMap === 'hundred_block_dash';
    const gateTitleEl = document.getElementById('gate-title');
    if (gateTitleEl) gateTitleEl.textContent = isHBD ? 'THE RIFT' : 'THE GATE';
    const gateMsg = isHBD
        ? `Roll ${GATE_NUM_DICE} dice. Score ${GATE_THRESHOLD}+ to tear through The Rift into the Void!`
        : `Roll ${GATE_NUM_DICE} dice. Score ${GATE_THRESHOLD}+ to break through the Industrial Zone!`;
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
        const succeeded = total >= GATE_THRESHOLD;
        const overlay = document.getElementById('gate-overlay');
        overlay.style.display = 'flex';
        document.getElementById('gate-roll-btn').style.display = 'none';
        document.getElementById('gate-open-banner').style.display = 'none';
        document.getElementById('gate-result').textContent = '';
        document.getElementById('gate-sum').textContent = '';
        let dieStr = '';
        faceValues.forEach((val,i) => { setTimeout(() => { dieStr += (i>0?' + ':'')+val; document.getElementById('gate-sum').textContent = `🎲 ${dieStr}`; }, i*500); });
        setTimeout(() => { document.getElementById('gate-sum').textContent = `Total: ${total}  (need ≥ ${GATE_THRESHOLD})`; }, faceValues.length*500+300);
        setTimeout(() => {
            if (succeeded) {
                state.gateOpen = true; sfx('gate_open');
                document.getElementById('gate-result').textContent = '🔓 INDUSTRIAL ZONE OPEN!';
                document.getElementById('gate-result').style.color = '#4ade80';
                document.getElementById('gate-open-banner').style.display = 'block';
                document.getElementById('gate-continue-btn').textContent = 'ENTER ZONE';
                UIManager.toast(`${p.name} BREAKS THROUGH! Score: ${total}`, '#4ade80');
                Renderer.updateSingleTile();
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
    document.getElementById('gate-overlay').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    Physics.clearDice(Renderer.getDiceGroup());
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
        const openMsg = state.selectedMap === 'hundred_block_dash'
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
        // Failed the roll — the banked steps are forfeit either way.
        _pendingStepsAfterGate = 0;
        ModalManager.showMessage('🔒 GATE HOLDS', `${p.name} couldn't break through. Try again next turn!`, '🔒', { tier: 'shared' });
        if (state.selectedMap !== 'hundred_block_dash') {
            // City Circuit: push player back out of Industrial
            p.pos = 'bp_d';
            if (p.mesh) p.mesh.position.copy(Renderer.getPos('bp_d'));
            Renderer.snapCameraToActive();
        }
    }
    if (p.isBot) Director.hold('BOT_RESULT', () => { if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal(); });
}

// ============================================================
// ITEM SHOP
// ============================================================

export function tryGrantItem(p, itemId) {
    if (p.inv.length >= MAX_INV) {
        if (!p.isBot) ModalManager.openDropModal(p, itemId, 0, 'finish_turn');
    } else {
        p.inv.push(itemId); UIManager.updateUI();
    }
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
        ModalManager.openDropModal(p, itemId, cost, 'shop');
        return;
    }
    p.coins -= cost; p.inv.push(itemId);
    sfx('buy'); UIManager.toast(`Bought ${ITEMS[itemId].name}!`, '#a855f7');
    UIManager.updateUI(); openShop(state.pendingShopDistrict, state.pendingShopDiscount);
}

export function closeShopModal() {
    const wasPassThrough = state.pendingReturnState === 'pass_through_done';
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    if (wasPassThrough) { _afterPassThroughShop(); return; }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn); }
}

export function shopOfferEnter() {
    ModalManager.closeAllModals();
    _noteShopVisit(state.players[state.activePlayer]);
    state.pendingReturnState = 'pass_through_done';
    openShop(state.pendingShopDistrict, state.pendingShopDiscount);
}

export function shopOfferSkip() { ModalManager.closeAllModals(); _afterPassThroughShop(); }

function _afterPassThroughShop() {
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    state.gameState = 'MOVING';
    const resume = _passThroughResumeHop; _passThroughResumeHop = null;
    if (resume) Director.hold('PASSTHROUGH', resume);
}

export function confirmDrop(pid, dropIdx, newItemId) {
    const p = state.players[pid];
    const dropped = p.inv.splice(dropIdx, 1)[0];
    p.inv.push(newItemId);
    UIManager.toast(`Dropped ${ITEMS[dropped].name}, got ${ITEMS[newItemId].name}!`, '#f97316');
    UIManager.updateUI(); ModalManager.closeAllModals();
    _afterDropReturn(p);
}

export function cancelDrop() {
    state.pendingBuyId = null; state.pendingBuyCost = null; state.pendingShopAfterDrop = false;
    const ret = state.pendingReturnState; state.pendingReturnState = null;
    ModalManager.closeAllModals();
    if (ret === 'shop') { openShop(state.pendingShopDistrict, state.pendingShopDiscount); return; }
    if (ret === 'pass_through_done') { _afterPassThroughShop(); return; }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn); return; }
    if (state.gameState === 'ACKNOWLEDGE') Director.hold('POST_RESULT', finishTurn);
}

function _afterDropReturn(p) {
    state.pendingBuyId = null;
    const ret = state.pendingReturnState; state.pendingReturnState = null;
    if (state.pendingShopAfterDrop && state.pendingBuyCost !== null) {
        p.coins -= state.pendingBuyCost; state.pendingBuyCost = null; state.pendingShopAfterDrop = false;
        openShop(state.pendingShopDistrict, state.pendingShopDiscount); return;
    }
    if (ret === 'shop') { openShop(state.pendingShopDistrict, state.pendingShopDiscount); return; }
    if (ret === 'pass_through_done') { _afterPassThroughShop(); return; }
    if (state.gameState === 'ACKNOWLEDGE' || state.gameState === 'SHOP') {
        state.gameState = 'ACKNOWLEDGE'; Director.hold('POST_RESULT', finishTurn);
    }
}

export function executeUseItem(pid, itemIdx) {
    if (pid !== state.activePlayer) return;
    const p = state.players[pid], opp = state.players[(pid+1)%2];
    const itemId = p.inv[itemIdx]; p.inv.splice(itemIdx, 1);
    if (_reflectIfMirrored(p, itemId)) {
        UIManager.updateUI(); ModalManager.closeAllModals(); return;
    }
    UIManager.toast(`Used ${ITEMS[itemId].name}!`, '#f5c842'); sfx('buy');
    _checkContract(p, 'use_item', itemId);
    _applyItemEffect(p, itemId, false, opp);
    if (itemId === 'rocket' || itemId === 'custom_dice') return;
    UIManager.updateUI(); ModalManager.closeAllModals();
}

// Targeted items can be bounced by the opponent's Mirror. Returns true if the
// item was reflected (and thus should NOT be applied). Used by both the human
// use-path and the bot pre-roll path so Mirror works consistently in all modes.
const MIRRORABLE = ['cursed_die', 'anchor', 'swap', 'steal'];
function _reflectIfMirrored(p, itemId) {
    const opp = state.players[(p.id + 1) % 2];
    if (opp._mirrored && MIRRORABLE.includes(itemId)) {
        opp._mirrored = false;
        UIManager.toast(`🪞 ${opp.name}'s Mirror reflected ${ITEMS[itemId].name}!`, '#60a5fa');
        sfx('shield');
        return true;
    }
    return false;
}

function _applyItemEffect(p, itemId, isBot, opp) {
    opp = opp || state.players[(p.id+1)%2];
    if (itemId === 'warp_drive')    p._warpNextRoll = true;
    if (itemId === 'double_die')    p._doubleNextRoll = true;
    if (itemId === 'overcharge')    p._overchargeNextRoll = true;
    if (itemId === 'cursed_die')  { state.cursedTarget[(p.id+1)%2] = true; UIManager.toast(`💀 Cursed Die!`, '#ef4444'); }
    if (itemId === 'tollbooth')   { state.board[p.pos].type = 'player_trap'; state.board[p.pos].owner = p.id; Renderer.updateSingleTile(); }
    if (itemId === 'shield')        p._shielded = true;
    if (itemId === 'rocket')      { _doMove(p, 8); UIManager.updateUI(); ModalManager.closeAllModals(); }
    if (itemId === 'anchor')      { if (state.board[opp.pos]) { state.board[opp.pos].type = 'anchor_trap'; state.board[opp.pos].owner = p.id; Renderer.updateSingleTile(); UIManager.toast('⚓ Anchor placed!', '#f97316'); } }
    if (itemId === 'swap')        {
        const tmp = p.pos; p.pos = opp.pos; opp.pos = tmp;
        if (p.mesh) p.mesh.position.copy(Renderer.getPos(p.pos));
        if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos));
        sfx('swap'); haptic([50,30,50]);
    }
    if (itemId === 'steal')       { const s = Math.min(10, opp.coins); loseCoins(opp, s); earnCoins(p, s); }
    if (itemId === 'mirror')        p._mirrored = true;
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
    if (!district || !DISTRICT_KEYS.includes(district)) return;
    p.districtsVisited[district] = (p.districtsVisited[district] || 0) + 1;
    const visits = p.districtsVisited[district];
    const bonus  = visits === 1 ? DISTRICT_HQ_FIRST_BONUS : DISTRICT_HQ_REVISIT_BONUS;
    earnCoins(p, bonus);
    p.districtHQsThisLoop.add(district);
    _checkContract(p, 'visit_hq', district);
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

export function spawnAlly() {
    if (state.allyOnMap) return;
    const allyTypes  = Object.keys(ALLIES);
    const allyType   = allyTypes[Math.floor(Math.random() * allyTypes.length)];
    const realNodes  = ALL_NODES_ORDERED;
    // Prefer nodes not occupied by players
    const occupied = new Set(state.players.map(p => p.pos));
    const candidates = realNodes.filter(id => !occupied.has(id) && state.board[id]?.type !== 'gate');
    const nodeId = candidates[Math.floor(Math.random() * candidates.length)] || realNodes[0];

    state.allyOnMap = { nodeId, allyType };
    Renderer.placeAllyMarker(nodeId, allyType);

    const ally   = ALLIES[allyType];
    const gNode  = CITY_GRAPH[nodeId];
    const hint   = gNode ? DISTRICT_NAMES[gNode.district] || 'the city' : 'the city';
    UIManager.toast(`${ally.icon} ${ally.name} has appeared near ${hint}!`, '#fbbf24');
    sfx('land_good');
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
    MinigameManager.trigger((winnerId) => {
        state.mgContext = null;
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
            UIManager.toast(isSteal ? `${ALLIES[allyType]?.icon} Steal failed!` : `${ALLIES[allyType]?.icon} Ally minigame lost!`, '#ef4444');
        }
        UIManager.updateUI();
        if (onDone) setTimeout(onDone, 400);
    });
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
    if (state.selectedMap === 'hundred_block_dash') return;
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
        p.pos = junctionId;
        // Move to first ring road node after junction
        const firstNode = CITY_GRAPH[junctionId]?.next?.[0];
        if (firstNode && !JUNCTION_IDS.has(firstNode)) {
            Renderer.animatePlayerHop(p, firstNode, () => { p.pos = firstNode; UIManager.updateUI(); });
        } else {
            if (p.mesh) p.mesh.position.copy(Renderer.getPos(junctionId));
        }
        UIManager.toast(`🚕 Cabbie: teleported to ${junctionId.replace('bp_','Junction ').toUpperCase()}!`, '#fbbf24');
        UIManager.updateUI();
    });
}

function activateCabbie_bot(p) {
    const pick = Bot.cabbieJunction(p);
    p.cabbieUsedThisRound = true;
    const firstNode = CITY_GRAPH[pick]?.next?.[0];
    if (firstNode) { p.pos = firstNode; if (p.mesh) p.mesh.position.copy(Renderer.getPos(firstNode)); }
    UIManager.toast(`${p.name}'s Cabbie teleports them!`, '#fbbf24');
}

// Ally passive effect checks
function _allyPassive(player, powerType) {
    if (state.selectedMap === 'hundred_block_dash') return 0;
    const idx = player.allies.findIndex(a => ALLIES[a.type]?.powerType === powerType);
    if (idx < 0) return 0;
    if (powerType === 'coin_bonus') return 2;
    return 0;
}

// ============================================================
// DUEL SYSTEM
// ============================================================

function _openDuelModal(p) {
    const opp = state.players[(p.id+1)%2];
    ModalManager.showDuelModal(p, opp, (betAmount) => {
        _startDuel(p, betAmount);
    });
}

function _startDuel(p, betAmount) {
    const opp  = state.players[(p.id+1)%2];
    const safe = Math.min(betAmount, Math.min(p.coins, opp.coins), 10);
    if (safe <= 0) { finishTurn(); return; }
    state.pendingDuelBet = safe;
    state.mgContext = 'duel';
    UIManager.toast(`⚔️ DUEL! Both players bet ${safe} coins!`, '#ef4444');
    MinigameManager.trigger((winnerId) => {
        state.mgContext = null;
        const winner  = state.players[winnerId];
        const loser   = state.players[(winnerId+1)%2];
        const actual  = Math.min(state.pendingDuelBet, loser.coins);
        loseCoins(loser, actual); earnCoins(winner, actual);
        winner.duelsWon++;
        UIManager.toast(`${winner.name} wins the duel! +${actual} coins!`, '#fbbf24');
        _checkContract(winner, 'duel_win');
        state.pendingDuelBet = 0;
        state.gameState = 'ACKNOWLEDGE';
        Renderer.startPostMinigameFlyover(() => { state.cameraState = 'FOLLOW'; });
        Director.hold('POST_RESULT', finishTurn);
    });
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
