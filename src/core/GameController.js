import { state, resetPlayers } from './GameState.js';
import {
    GATE_POS, GATE_THRESHOLD, GATE_NUM_DICE, MAX_INV,
    MINIGAME_EVERY_N_TURNS, SHOP_SPACES, ITEMS, SPACE_META, SPACE_DESCS,
} from '../config/GameConfig.js';
import { sfx, haptic } from '../engine/AudioManager.js';
import * as Renderer from '../engine/Renderer.js';
import * as Physics from '../engine/Physics.js';
import * as UIManager from '../ui/UIManager.js';
import * as ModalManager from '../ui/ModalManager.js';
import * as MinigameManager from '../minigames/MinigameManager.js';

// Make SPACE_META available globally for UIManager map tooltips
window.SPACE_META_REF = SPACE_META;

// ---- pass-through shop state (not in GameState to avoid polluting it) ----
let _passThroughResumeHop = null;

// ============================================================
// FLOW ENTRY POINTS (called from main.js / ModalManager)
// ============================================================

export function selectMode(m) { state.playStyle = m; }

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
            const types = ['slime', 'ghost', 'boxy', 'bunny'].filter(t => t !== state.p1CharSelection);
            state.players[1].charType = types[Math.floor(Math.random() * types.length)];
            startGame();
        } else {
            state.charSelectStep = 2;
            document.getElementById('cs-title').textContent = 'PLAYER 2: CHOOSE CHARACTER';
            document.getElementById('cs-title').style.color = 'var(--p2)';
            state.p2CharSelection = state.p1CharSelection === 'slime' ? 'boxy' : 'slime';
        }
    } else {
        state.players[1].charType = state.p2CharSelection;
        startGame();
    }
}

export function startGame() {
    if (state.gameStarted) return;
    state.gameStarted = true;
    if (state.playStyle === 'tabletop') document.body.classList.add('tabletop-mode');
    document.getElementById('splash').style.display = 'none';
    document.getElementById('char-select').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';
    setTimeout(() => {
        if (!state.gameStarted) return;
        UIManager.setPlayerNames();
        state.activePlayer = Math.floor(Math.random() * 2);
        generateBoard();
        Renderer.init(document.getElementById('game-container'));
        UIManager.initCoinDisplays();
        UIManager.updateUI();
        Renderer.startFlyover(() => {
            document.getElementById('ui-layer').style.display = 'block';
            state.cameraState = 'FOLLOW';
            UIManager.toast(`${state.players[state.activePlayer].name} goes first!`, state.activePlayer === 0 ? '#ff3b3b' : '#3b8eff');
            proceedTurn();
        });
    }, 100);
}

// ============================================================
// BOARD GENERATION
// ============================================================

export function generateBoard() {
    state.board = [{ type: 'start' }];
    const earlyPool = [
        ...Array(20).fill('coin'), ...Array(10).fill('coin_big'),
        ...Array(8).fill('mystery'), ...Array(6).fill('boost'),
        ...Array(5).fill('shortcut'), ...Array(4).fill('cfwd'),
        ...Array(3).fill('truce'), ...Array(2).fill('lose'), ...Array(2).fill('trap'),
    ];
    while (earlyPool.length < 49) earlyPool.push('coin');
    earlyPool.sort(() => Math.random() - 0.5);

    const latePool = [
        ...Array(12).fill('lose'), ...Array(10).fill('lose_big'),
        ...Array(10).fill('trap'), ...Array(6).fill('magnet'),
        ...Array(4).fill('cbwd'), ...Array(2).fill('mystery'),
        ...Array(2).fill('truce'), ...Array(3).fill('coin'),
        ...Array(3).fill('swap_space'),
    ];
    while (latePool.length < 49) latePool.push('lose');
    latePool.sort(() => Math.random() - 0.5);

    for (let i = 1; i <= 49; i++) state.board.push({ type: earlyPool[i - 1] });
    for (let i = 50; i <= 98; i++) state.board.push({ type: latePool[i - 50] });
    state.board.push({ type: 'start', n: 'FINISH', ic: '👑' });

    state.board[GATE_POS] = { type: 'gate' };
    [20, 40, 60, 80].forEach(i => { if (i !== GATE_POS) state.board[i] = { type: 'shop' }; });
}

// ============================================================
// TURN FLOW
// ============================================================

export function isMyTurn(pIdx) {
    return state.gameState === 'PRE_ROLL' && state.activePlayer === pIdx && !state.players[pIdx].isBot;
}

export function startPreRoll() {
    state.gameState = 'PRE_ROLL';
    state.rollAgainPending = false;
    state.rollAgainSamePlayer = false;
    UIManager.updateUI();
    Physics.clearDice(Renderer.getDiceGroup());
    const p = state.players[state.activePlayer];
    if (p.isBot) {
        setTimeout(() => {
            if (state.gameState !== 'PRE_ROLL') return;
            if (p.inv.length > 0 && Math.random() < 0.3) {
                const idx = Math.floor(Math.random() * p.inv.length);
                const itemId = p.inv[idx]; p.inv.splice(idx, 1);
                UIManager.toast(`${p.name} used ${ITEMS[itemId].name}!`, '#f5c842');
                _applyItemEffect(p, itemId, true);
                if (itemId === 'rocket' || itemId === 'custom_dice') return;
            }
            if (state.gameState === 'PRE_ROLL') executeRoll(0.8 + Math.random() * 1.5);
        }, 1200);
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
        UIManager.toast('\ud83d� Cursed Die forces a bad roll!', '#ef4444');
    } else if (p._warpNextRoll) {
        p._warpNextRoll = false; state.currentRollMode = 'forced_5';
    } else if (p._doubleNextRoll) {
        p._doubleNextRoll = false; state.currentRollMode = 'double'; numDice = 2;
    } else {
        state.currentRollMode = 'normal';
    }

    const strength = Math.max(0.4, Math.min(flickVelocity, 3.5));
    const fwdSpeed = 8 + strength * 10;
    const upSpeed = 10 + strength * 7;
    const spinSpeed = 10 + strength * 12;

    const camera = Renderer.getCamera();
    const pm = p.mesh;
    Physics.positionWalls(pm.position.x, 0, pm.position.z, 8);

    let flickDir = pm.position.clone().sub(camera.position);
    flickDir.y = 0;
    if (flickDir.lengthSq() < 0.001) flickDir.set(0, 0, -1);
    else flickDir.normalize();

    const diceGrp = Renderer.getDiceGroup();
    for (let i = 0; i < numDice; i++) {
        const d = Physics.spawnDie(diceGrp);
        const offset = numDice > 1 ? (i === 0 ? -1.2 : 1.2) : 0;
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), flickDir).normalize();
        d.body.position.x = pm.position.x + flickDir.x * 1.5 + right.x * offset;
        d.body.position.y = pm.position.y + 2.5;
        d.body.position.z = pm.position.z + flickDir.z * 1.5 + right.z * offset;
        const scatter = (Math.random() - 0.5) * 2;
        d.body.velocity.x = flickDir.x * fwdSpeed + right.x * scatter;
        d.body.velocity.y = upSpeed;
        d.body.velocity.z = flickDir.z * fwdSpeed + right.z * scatter;
        d.body.angularVelocity.x = (Math.random() - 0.5) * spinSpeed * 2;
        d.body.angularVelocity.y = (Math.random() - 0.5) * spinSpeed * 2;
        d.body.angularVelocity.z = (Math.random() - 0.5) * spinSpeed * 2;
    }
    sfx('dice_throw');

    Physics.onSettle(state.currentRollMode, (result) => {
        sfx('dice_land'); haptic([10]);
        UIManager.toast(`Rolled a ${result}!`, '#fff');
        setTimeout(() => movePlayer(state.players[state.activePlayer], result), 500);
    });
}

// ============================================================
// PLAYER MOVEMENT
// ============================================================

export function movePlayer(p, steps, isForced = false) {
    state.gameState = 'MOVING';
    const startPos = p.pos;
    let curr = p.pos;
    const stepDir = Math.sign(steps);
    let target = Math.max(0, Math.min(99, curr + steps));

    if (stepDir === 0) { resolveSpace(p); return; }
    if (!state.gateOpen && stepDir > 0 && startPos < GATE_POS && target >= GATE_POS) {
        target = GATE_POS;
    }

    function hopNext() {
        if (curr === target) { p.pos = target; resolveSpace(p); return; }
        curr += stepDir;

        // Offer shop pass-through for intermediate spaces
        if (curr !== target && SHOP_SPACES.has(curr) && stepDir > 0) {
            Renderer.animatePlayerHop(p, curr, () => {
                if (p.isBot) {
                    if (Math.random() < 0.4) {
                        state.gameState = 'SHOP';
                        setTimeout(() => {
                            if (state.gameState !== 'SHOP') return;
                            _botShop(); setTimeout(() => { _afterPassThroughShop(); hopNext(); }, 2000);
                        }, 400);
                    } else { setTimeout(hopNext, 300); }
                } else {
                    _offerPassThroughShop(p, hopNext);
                }
            });
            return;
        }
        Renderer.animatePlayerHop(p, curr, hopNext);
    }
    hopNext();
}

function _offerPassThroughShop(p, resumeHop) {
    _passThroughResumeHop = resumeHop;
    state.gameState = 'SHOP';
    ModalManager.showModal('shop-offer-modal');
}

export function shopOfferEnter() {
    ModalManager.closeAllModals();
    state.pendingReturnState = 'pass_through_done';
    openShop();
}

export function shopOfferSkip() {
    ModalManager.closeAllModals();
    _afterPassThroughShop();
}

function _afterPassThroughShop() {
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    state.gameState = 'MOVING';
    const resume = _passThroughResumeHop;
    _passThroughResumeHop = null;
    if (resume) setTimeout(resume, 200);
}

// ============================================================
// SPACE RESOLUTION
// ============================================================

export function resolveSpace(p) {
    state.msgModalResolving = false;
    if (p.pos >= 99) {
        sfx('win'); haptic([100, 50, 100, 50, 200]);
        state.gameState = 'GAME_OVER';
        ModalManager.showMessage(`👑 ${p.name} REACHED THE CROWN!`, 'Winner by total coins!', '👑');
        setTimeout(calculateWinner, 2800);
        return;
    }
    if (!state.gateOpen && p.pos === GATE_POS) { triggerGateChallenge(p); return; }

    const space = state.board[p.pos];
    state.gameState = 'ACKNOWLEDGE';
    const msg = resolveSpaceEffect(p, space.type, space);
    UIManager.updateUI();
    if (msg === null) return;

    const spc = SPACE_META[space.type] || SPACE_META.coin;
    const goodTypes = ['coin', 'coin_big', 'shortcut', 'cfwd', 'mystery', 'truce', 'gate_open'];
    const badTypes  = ['lose', 'lose_big', 'trap', 'cbwd', 'magnet', 'player_trap', 'anchor_trap'];
    if (goodTypes.includes(space.type)) sfx('land_good');
    else if (badTypes.includes(space.type)) sfx('land_bad');

    UIManager.showSpaceInfoCard(spc.n || space.type, SPACE_DESCS[space.type] || '');
    ModalManager.showMessage(spc.n || space.type.toUpperCase(), msg || 'Nothing happens.', spc.ic);
    Renderer.updateBiomeVisuals(p.pos);

    if (p.isBot && state.gameState === 'ACKNOWLEDGE') {
        const delay = space.type === 'boost' ? 2500 : 1500;
        setTimeout(() => { if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal(); }, delay);
    }
}

export function resolveSpaceEffect(p, spaceType, space) {
    const opp = state.players[(p.id + 1) % 2];
    switch (spaceType) {
        case 'start': return '';
        case 'coin':      { earnCoins(p, 3); return '+3 coins!'; }
        case 'coin_big':  { earnCoins(p, 8); return '+8 coins!'; }
        case 'lose':      { const l = loseCoins(p, 4);  return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'lose_big':  { const l = loseCoins(p, 10); return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'trap':      { const l = loseCoins(p, 5);  return l === 0 ? '🛡️ Shielded!' : `-${l} coins!`; }
        case 'mystery': {
            const ids = Object.keys(ITEMS);
            const pick = ids[Math.floor(Math.random() * ids.length)];
            tryGrantItem(p, pick);
            return `Got a ${ITEMS[pick].name}!`;
        }
        case 'boost': {
            state.rollAgainPending = true; sfx('boost'); haptic([30, 50, 30]);
            return `⚡ BOOST! ${p.name} landed on a Boost space and gets to roll again immediately!`;
        }
        case 'shortcut': {
            const skip = 3 + Math.floor(Math.random() * 6);
            movePlayer(p, skip, true); return null;
        }
        case 'cfwd':  { movePlayer(p, 10, true);  return null; }
        case 'cbwd':  { movePlayer(p, -10, true); return null; }
        case 'swap_space': {
            const tmp = p.pos; p.pos = opp.pos; opp.pos = tmp;
            if (p.mesh) p.mesh.position.copy(Renderer.getPos(p.pos));
            if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos));
            sfx('swap'); haptic([50, 30, 50]);
            return `Positions swapped with ${opp.name}!`;
        }
        case 'anchor_trap': {
            const owner = space && space.owner !== undefined ? state.players[space.owner] : null;
            if (owner && owner.id !== p.id) { movePlayer(p, -5, true); return null; }
            return 'Your own Anchor.';
        }
        case 'magnet': {
            const stolen = Math.min(5, opp.coins);
            loseCoins(opp, stolen); earnCoins(p, stolen);
            return `Stole ${stolen} coins from ${opp.name}!`;
        }
        case 'truce': {
            earnCoins(state.players[0], 5); earnCoins(state.players[1], 5);
            return 'Both players gain 5 coins!';
        }
        case 'player_trap': {
            if (space && space.owner !== undefined && space.owner !== p.id) {
                const owner = state.players[space.owner];
                const fee = loseCoins(p, 5);
                if (fee > 0) earnCoins(owner, fee);
                return fee === 0 ? '🛡️ Shielded from Tollbooth!' : `Paid ${fee} coins to ${owner.name}!`;
            }
            return 'Your own Tollbooth.';
        }
        case 'gate':      return '';
        case 'gate_open': return '';
        case 'shop':      { setTimeout(() => openShop(), 400); return null; }
        default:          return '';
    }
}

// ============================================================
// COINS
// ============================================================

export function earnCoins(p, amount) {
    p.coins += amount; p.coinsEarned += amount;
    UIManager.animateCoinDisplay(p.id, p.coins);
}

export function loseCoins(p, amount) {
    if (p._shielded) { p._shielded = false; sfx('shield'); return 0; }
    const lost = Math.min(p.coins, amount);
    p.coins -= lost;
    UIManager.animateCoinDisplay(p.id, p.coins);
    return lost;
}

// ============================================================
// TURN COMPLETION
// ============================================================

export function resolveMsgModal() {
    if (state.msgModalResolving) return;
    state.msgModalResolving = true;
    ModalManager.closeAllModals();
    UIManager.hideSpaceInfoCard();
    if (state.gameState === 'GAME_OVER') return;
    if (state.gameState === 'ACKNOWLEDGE') { setTimeout(finishTurn, 300); return; }
    if (state.gameState === 'MINIGAME_ACK') {
        setTimeout(() => {
            state.activePlayer = state.lastMinigameWinner >= 0 ? state.lastMinigameWinner : (state.activePlayer + 1) % 2;
            state.lastMinigameWinner = -1;
            state.lastMinigameTied   = false;
            proceedTurn();
        }, 300);
        return;
    }
    state.gameState = 'ACKNOWLEDGE';
    setTimeout(finishTurn, 300);
}

export function finishTurn() {
    state.totalTurns++;
    if (state.rollAgainPending) {
        state.rollAgainPending = false;
        state.rollAgainSamePlayer = true;
        maybeTriggerMinigame();
        return;
    }
    state.rollAgainSamePlayer = false;
    state.activePlayer = (state.activePlayer + 1) % 2;
    maybeTriggerMinigame();
}

export function maybeTriggerMinigame() {
    if (state.totalTurns > 0 && state.totalTurns % MINIGAME_EVERY_N_TURNS === 0) {
        MinigameManager.trigger((winnerId) => {
            let msg, icon;
            if (state.lastMinigameTied) {
                state.lastMinigameTied = false;
                msg = `It's a tie! Both players got coins — ${state.players[winnerId].name} goes first (coin flip)!`;
                icon = '🪙';
            } else {
                msg = `${state.players[winnerId].name} wins — they roll first next turn!`;
                icon = '🏆';
            }
            ModalManager.showMessage('MINIGAME OVER', msg, icon);
            // Auto-dismiss in 1P mode when there's no human input needed
            if (state.players[1].isBot) {
                setTimeout(() => { if (state.gameState === 'MINIGAME_ACK') resolveMsgModal(); }, 1800);
            }
        });
    } else {
        proceedTurn();
    }
}

export function proceedTurn() {
    UIManager.hideActionRows();
    const p = state.players[state.activePlayer];
    Renderer.updateBiomeVisuals(p.pos);

    if (!state.gateOpen && p.pos === GATE_POS && p.pos < 99) {
        if (state.playStyle === 'pass' && state.totalTurns > 0) {
            state.gameState = 'PASS_PROMPT';
            ModalManager.showPassModal(`Pass to ${p.name} — they must attempt The Gate!`, true);
        } else {
            triggerGateChallenge(p);
        }
        return;
    }
    if (state.playStyle === 'pass' && state.totalTurns > 0 && !state.rollAgainSamePlayer) {
        state.gameState = 'PASS_PROMPT';
        ModalManager.showPassModal(`Pass the device to ${p.name}.`, false);
    } else {
        state.rollAgainSamePlayer = false;
        startPreRoll();
    }
}

export function resolvePassModal() {
    const gateNext = document.getElementById('pass-modal').dataset.gateNext === 'true';
    ModalManager.closeAllModals();
    if (gateNext) setTimeout(() => triggerGateChallenge(state.players[state.activePlayer]), 300);
    else setTimeout(startPreRoll, 300);
}

// ============================================================
// GATE CHALLENGE
// ============================================================

export function triggerGateChallenge(p) {
    state.msgModalResolving = false;
    state.gameState = 'GATE'; state.gateRolling = false;
    Physics.clearDice(Renderer.getDiceGroup());
    document.getElementById('ui-layer').style.display = 'none';
    const bothAtGate = state.players[0].pos === GATE_POS && state.players[1].pos === GATE_POS;
    document.getElementById('gate-sub').textContent = bothAtGate
        ? `Both players stuck! ${p.name}'s turn. Score ${GATE_THRESHOLD} or higher!`
        : `Roll ${GATE_NUM_DICE} dice. Score ${GATE_THRESHOLD} or higher to break through!`;
    document.getElementById('gate-result').textContent = '';
    document.getElementById('gate-sum').textContent = '';
    document.getElementById('gate-open-banner').style.display = 'none';
    document.getElementById('gate-roll-btn').style.display = 'block';
    document.getElementById('gate-roll-btn').disabled = false;
    document.getElementById('gate-continue-btn').style.display = 'none';
    const overlay = document.getElementById('gate-overlay');
    overlay.style.display = 'flex';
    overlay.dataset.pid = p.id;
    if (p.isBot) setTimeout(() => { if (state.gameState === 'GATE') rollGate(); }, 1500);
}

export function rollGate() {
    if (state.gateRolling) return;
    state.gateRolling = true;
    sfx('gate_roll');
    document.getElementById('gate-overlay').style.display = 'none';
    Physics.clearDice(Renderer.getDiceGroup());
    const p = state.players[parseInt(document.getElementById('gate-overlay').dataset.pid)];
    const pm = p.mesh;
    Physics.positionWalls(pm.position.x, 0, pm.position.z, 12);

    const camera = Renderer.getCamera();
    const pPos = pm.position.clone();
    let dirToPlayer = pPos.clone().sub(camera.position);
    dirToPlayer.y = 0;
    if (dirToPlayer.lengthSq() < 0.001) dirToPlayer.set(0, 0, -1);
    else dirToPlayer.normalize();

    const diceGrp = Renderer.getDiceGroup();
    for (let i = 0; i < GATE_NUM_DICE; i++) {
        const d = Physics.spawnDie(diceGrp);
        const offset = (i - (GATE_NUM_DICE - 1) / 2) * 2.5;
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dirToPlayer).normalize();
        d.body.position.x = pPos.x + dirToPlayer.x * 1.5 + right.x * offset;
        d.body.position.y = pPos.y + 3;
        d.body.position.z = pPos.z + dirToPlayer.z * 1.5 + right.z * offset;
        const speed = 14 + Math.random() * 8;
        d.body.velocity.x = dirToPlayer.x * speed + (Math.random() - 0.5) * 5;
        d.body.velocity.y = 16 + Math.random() * 8;
        d.body.velocity.z = dirToPlayer.z * speed + (Math.random() - 0.5) * 5;
        d.body.angularVelocity.x = (Math.random() - 0.5) * 30;
        d.body.angularVelocity.y = (Math.random() - 0.5) * 30;
        d.body.angularVelocity.z = (Math.random() - 0.5) * 30;
    }

    Physics.onSettle('gate', () => {
        sfx('dice_land'); haptic([10]);
        setTimeout(resolveGateRoll, 100);
    });
}

export function resolveGateRoll() {
    const activeDice = Physics.getActiveDice();
    activeDice.forEach(d => { d.body.angularVelocity.set(0, 0, 0); });
    setTimeout(() => {
        const faceValues = activeDice.map(d => Physics.readTopFace(d));
        const total = faceValues.reduce((s, v) => s + v, 0);
        const pid = parseInt(document.getElementById('gate-overlay').dataset.pid);
        const p = state.players[pid];
        const succeeded = total >= GATE_THRESHOLD;
        const overlay = document.getElementById('gate-overlay');
        overlay.style.display = 'flex';
        document.getElementById('gate-roll-btn').style.display = 'none';
        document.getElementById('gate-open-banner').style.display = 'none';
        document.getElementById('gate-result').textContent = '';
        document.getElementById('gate-sum').textContent = '';

        let dieStr = '';
        faceValues.forEach((val, i) => {
            setTimeout(() => {
                dieStr += (i > 0 ? ' + ' : '') + val;
                document.getElementById('gate-sum').textContent = `🎲 ${dieStr}`;
            }, i * 500);
        });
        setTimeout(() => {
            document.getElementById('gate-sum').textContent = `Total: ${total}  (need ≥ ${GATE_THRESHOLD})`;
        }, faceValues.length * 500 + 300);
        setTimeout(() => {
            if (succeeded) {
                state.gateOpen = true; sfx('gate_open');
                document.getElementById('gate-result').textContent = '🔓 GATE BROKEN!';
                document.getElementById('gate-result').style.color = '#4ade80';
                document.getElementById('gate-open-banner').style.display = 'block';
                document.getElementById('gate-continue-btn').textContent = 'CONTINUE';
                UIManager.toast(`${p.name} OPENS THE GATE! Score: ${total}`, '#4ade80');
                Renderer.updateSingleTile(GATE_POS);
            } else {
                document.getElementById('gate-result').textContent = `❌ FAILED (${total})`;
                document.getElementById('gate-result').style.color = '#ef4444';
                document.getElementById('gate-continue-btn').textContent = 'WAIT FOR NEXT TURN';
                UIManager.toast(`${p.name} scored ${total} — gate holds!`, '#ef4444');
            }
            document.getElementById('gate-continue-btn').style.display = 'block';
            state.gameState = 'GATE'; state.gateRolling = false;
            if (p.isBot) setTimeout(() => { if (state.gameState === 'GATE') closeGate(); }, 2500);
        }, faceValues.length * 500 + 1000);
    }, 100);
}

export function closeGate() {
    document.getElementById('gate-overlay').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    Physics.clearDice(Renderer.getDiceGroup());
    state.cameraState = 'FOLLOW';
    const pid = parseInt(document.getElementById('gate-overlay').dataset.pid);
    state.gameState = 'ACKNOWLEDGE';
    if (state.gateOpen) {
        ModalManager.showMessage('🔓 GATE OPEN!', 'The path is clear! Both players may now pass through.', '🔓');
    } else {
        ModalManager.showMessage('\ud83d� GATE HOLDS', `${state.players[pid].name} couldn't break through. Try again next turn!`, '\ud83d�');
    }
    if (state.players[pid].isBot) setTimeout(() => { if (state.gameState === 'ACKNOWLEDGE') resolveMsgModal(); }, 1500);
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

export function openShop() {
    const p = state.players[state.activePlayer];
    state.gameState = 'SHOP';
    if (p.isBot) { _botShop(); return; }
    ModalManager.openShop();
}

function _botShop() {
    const p = state.players[state.activePlayer];
    const opp = state.players[(state.activePlayer + 1) % 2];
    const affordable = Object.keys(ITEMS).filter(k => p.coins >= ITEMS[k].price);
    if (affordable.length > 0 && p.inv.length < MAX_INV) {
        const ahead = p.pos > opp.pos;
        const preferred = ahead
            ? affordable.filter(k => ['cursed_die', 'anchor', 'swap', 'steal'].includes(k))
            : affordable.filter(k => ['shield', 'rocket', 'warp_drive', 'double_die'].includes(k));
        const pool = preferred.length > 0 ? preferred : affordable;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        p.coins -= ITEMS[pick].price; p.inv.push(pick);
        UIManager.toast(`${p.name} bought ${ITEMS[pick].name}!`, '#a855f7');
    }
    state.gameState = 'ACKNOWLEDGE';
    setTimeout(() => { if (state.gameState === 'ACKNOWLEDGE') finishTurn(); }, 1000);
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
    UIManager.updateUI(); openShop();
}

export function closeShopModal() {
    const wasPassThrough = state.pendingReturnState === 'pass_through_done';
    state.pendingReturnState = null;
    ModalManager.closeAllModals();
    if (wasPassThrough) { _afterPassThroughShop(); return; }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; setTimeout(finishTurn, 200); }
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
    if (ret === 'shop') { openShop(); return; }
    if (ret === 'pass_through_done') { _afterPassThroughShop(); return; }
    if (state.gameState === 'SHOP') { state.gameState = 'ACKNOWLEDGE'; setTimeout(finishTurn, 200); return; }
    if (state.gameState === 'ACKNOWLEDGE') setTimeout(finishTurn, 200);
}

function _afterDropReturn(p) {
    state.pendingBuyId = null;
    const ret = state.pendingReturnState; state.pendingReturnState = null;
    if (state.pendingShopAfterDrop && state.pendingBuyCost !== null) {
        p.coins -= state.pendingBuyCost; state.pendingBuyCost = null; state.pendingShopAfterDrop = false;
        openShop(); return;
    }
    if (ret === 'shop') { openShop(); return; }
    if (ret === 'pass_through_done') { _afterPassThroughShop(); return; }
    if (state.gameState === 'ACKNOWLEDGE' || state.gameState === 'SHOP') {
        state.gameState = 'ACKNOWLEDGE'; setTimeout(finishTurn, 200);
    }
}

export function executeUseItem(pid, itemIdx) {
    if (pid !== state.activePlayer) return;
    const p = state.players[pid], opp = state.players[(pid + 1) % 2];
    const itemId = p.inv[itemIdx]; p.inv.splice(itemIdx, 1);
    if (opp._mirrored && ['cursed_die', 'anchor', 'swap', 'steal'].includes(itemId)) {
        opp._mirrored = false;
        UIManager.toast(`🪩 Mirror reflected ${ITEMS[itemId].name} back!`, '#60a5fa');
        sfx('shield'); UIManager.updateUI(); ModalManager.closeAllModals(); return;
    }
    UIManager.toast(`Used ${ITEMS[itemId].name}!`, '#f5c842'); sfx('buy');
    _applyItemEffect(p, itemId, false, opp);
    if (itemId === 'rocket' || itemId === 'custom_dice') return;
    UIManager.updateUI(); ModalManager.closeAllModals();
}

function _applyItemEffect(p, itemId, isBot, opp) {
    opp = opp || state.players[(p.id + 1) % 2];
    if (itemId === 'warp_drive') { p._warpNextRoll = true; }
    if (itemId === 'double_die') { p._doubleNextRoll = true; }
    if (itemId === 'cursed_die') { state.cursedTarget[(p.id + 1) % 2] = true; UIManager.toast(`\ud83d� Cursed Die!`, '#ef4444'); }
    if (itemId === 'tollbooth')  { state.board[p.pos].type = 'player_trap'; state.board[p.pos].owner = p.id; Renderer.updateSingleTile(p.pos); }
    if (itemId === 'shield')     { p._shielded = true; }
    if (itemId === 'rocket')     { movePlayer(p, 8, true); UIManager.updateUI(); ModalManager.closeAllModals(); }
    if (itemId === 'anchor')     { state.board[opp.pos].type = 'anchor_trap'; state.board[opp.pos].owner = p.id; Renderer.updateSingleTile(opp.pos); UIManager.toast('⚓ Anchor placed!', '#f97316'); }
    if (itemId === 'swap')       { const tmp = p.pos; p.pos = opp.pos; opp.pos = tmp; if (p.mesh) p.mesh.position.copy(Renderer.getPos(p.pos)); if (opp.mesh) opp.mesh.position.copy(Renderer.getPos(opp.pos)); sfx('swap'); haptic([50, 30, 50]); }
    if (itemId === 'steal')      { const s = Math.min(10, opp.coins); loseCoins(opp, s); earnCoins(p, s); }
    if (itemId === 'mirror')     { p._mirrored = true; }
    if (itemId === 'custom_dice') {
        if (isBot) {
            const distToGate = !state.gateOpen ? GATE_POS - p.pos : 999;
            const distToEnd = 99 - p.pos;
            const pick = [1, 2, 3, 4, 5, 6].find(n => n === distToGate || n === distToEnd) || 6;
            UIManager.toast(`${p.name} picks ${pick} with Custom Dice!`, '#f5c842');
            UIManager.updateUI();
            if (state.gameState === 'PRE_ROLL') setTimeout(() => movePlayer(p, pick), 400);
        } else {
            ModalManager.closeAllModals();
            UIManager.updateUI();
            ModalManager.openCustomDiceModal();
        }
    }
}

export function confirmCustomDice(num) {
    ModalManager.closeAllModals();
    UIManager.toast(`\ud83c� Custom Dice: moving ${num} spaces!`, '#f5c842');
    sfx('buy'); haptic([30, 50, 30]);
    setTimeout(() => movePlayer(state.players[state.activePlayer], num), 300);
}

// ============================================================
// WIN SCREEN
// ============================================================

export function calculateWinner() {
    const p1 = state.players[0], p2 = state.players[1];
    const p1f = p1.pos >= 99 ? 50 : 0, p2f = p2.pos >= 99 ? 50 : 0;
    const p1s = p1.coins + p1f, p2s = p2.coins + p2f;
    const winner = p1s > p2s ? p1 : p2s > p1s ? p2 : (p1.pos >= p2.pos ? p1 : p2);
    const isTie = p1s === p2s && p1.pos === p2.pos;
    ModalManager.closeAllModals();
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('win-name').textContent = isTie ? 'TIE GAME!' : winner.name.toUpperCase();
    document.getElementById('win-subtitle').textContent = isTie ? 'Both players go home legends.' : 'WINS THE HUSTLE!';
    function row(label, val) { return `<div class="win-card-stat"><span>${label}</span><span>${val}</span></div>`; }
    function card(p, s, f) {
        const isW = !isTie && p === winner;
        return `<div class="win-card${isW ? ' winner-card' : ''}"><div class="win-card-name">${isW ? '👑 ' : ''}${p.name}</div><div class="win-card-score">${s}</div>${row('💰 Coins earned', p.coinsEarned)}${row('\ud83d� Coins left', p.coins)}${f ? row('🏁 Finish bonus', '+' + f) : ''}${row('🏆 Minigames won', p.mgWins)}${row('\ud83d� Final space', p.pos >= 99 ? 'FINISHED' : p.pos)}</div>`;
    }
    document.getElementById('win-cards').innerHTML = card(p1, p1s, p1f) + card(p2, p2s, p2f);
    const confettiEl = document.getElementById('win-confetti'); confettiEl.innerHTML = '';
    const colors = ['#f59e0b', '#a855f7', '#3b82f6', '#ef4444', '#4ade80', '#fbbf24', '#ec4899'];
    for (let i = 0; i < 80; i++) {
        const el = document.createElement('div'); el.className = 'confetti-piece';
        el.style.cssText = `left:${Math.random() * 100}%;top:-10px;background:${colors[Math.floor(Math.random() * colors.length)]};width:${6 + Math.random() * 8}px;height:${6 + Math.random() * 8}px;animation-duration:${2 + Math.random() * 2}s;animation-delay:${Math.random() * 1.5}s;`;
        confettiEl.appendChild(el);
    }
    document.getElementById('win-screen').style.display = 'flex';
    sfx('win');
}

export function playAgain() { window.location.reload(); }
