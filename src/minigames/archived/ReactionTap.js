import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const MAX_WINS = 2; // best of 3
const TIE_WINDOW_MS = 45;

let _done = false, _roundDone = false, _timer = null, _tapFlush = null, _onWin = null, _isBot = false;
let _wins = [0, 0];
let _tapBatch = [];
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _wins = [0, 0];
    registerMinigameCleanup(_cleanup);
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;
    _tapBatch = [];
    clearTimeout(_tapFlush); _tapFlush = null;
    clearTimeout(_timer);
    _cleanups.forEach(f => f()); _cleanups.length = 0;

    [1, 2].forEach(i => {
        const z = document.getElementById(`react-z-${i}`);
        z.style.display = 'flex';
        z.className = 'reaction-zone waiting';
        z.textContent = 'WAIT...';
    });
    document.getElementById('mg-neutral').textContent = `P1 ${_wins[0]} - P2 ${_wins[1]}  |  WAIT FOR IT...`;

    [0, 1].forEach(pid => {
        const z = document.getElementById(`react-z-${pid + 1}`);
        const handler = e => {
            e.preventDefault();
            if (_done || _roundDone) return;
            if (!z.classList.contains('go')) {
                _earlyTap(pid, z);
            } else {
                _queueTap(pid);
            }
        };
        z.addEventListener('pointerdown', handler, { once: true });
        _cleanups.push(() => z.removeEventListener('pointerdown', handler));
    });

    const delay = 1500 + Math.random() * 2500;
    _timer = setTimeout(() => {
        sfx('react_go');
        [1, 2].forEach(i => {
            const z = document.getElementById(`react-z-${i}`);
            z.className = 'reaction-zone go';
            z.textContent = 'TAP!';
        });
        document.getElementById('mg-neutral').textContent = 'NOW!';
        if (_isBot) setTimeout(() => {
            if (state.mgActive && !_done && !_roundDone) _queueTap(1);
        }, 200 + Math.random() * 500);
    }, delay);
}

function _earlyTap(pid, zone) {
    _roundDone = true;
    clearTimeout(_timer);
    const roundWinner = pid === 0 ? 1 : 0;
    _wins[roundWinner]++;
    zone.className = 'reaction-zone too-early';
    zone.textContent = 'TOO EARLY!';
    document.getElementById('mg-neutral').textContent =
        `P${pid + 1} TAPPED EARLY!  ${_wins[0]}-${_wins[1]}`;
    sfx('land_bad');
    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1200);
    } else {
        setTimeout(_startRound, 1500);
    }
}

function _queueTap(pid) {
    const now = performance.now();
    _tapBatch.push({ pid, time: now });
    if (_tapFlush) return;
    _tapFlush = setTimeout(() => {
        _tapFlush = null;
        const first = Math.min(..._tapBatch.map(t => t.time));
        const winners = [...new Set(_tapBatch.filter(t => t.time - first <= TIE_WINDOW_MS).map(t => t.pid))];
        _tapBatch = [];
        _scoreTap(winners);
    }, TIE_WINDOW_MS + 5);
}

function _scoreTap(winners) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;
    clearTimeout(_timer);
    winners.forEach(pid => {
        _wins[pid]++;
        const z = document.getElementById(`react-z-${pid + 1}`);
        z.className = 'reaction-zone won';
        z.textContent = winners.length > 1 ? 'TIE!' : 'FIRST!';
    });
    if (winners.length === 1) document.getElementById(`react-z-${winners[0] === 0 ? 2 : 1}`).textContent = 'TOO SLOW';

    document.getElementById('mg-neutral').textContent = winners.length > 1
        ? `FRAME TIE! BOTH SCORE  ${_wins[0]}-${_wins[1]}`
        : `P${winners[0] + 1} WINS!  ${_wins[0]}-${_wins[1]}`;
    sfx('coin_gain');

    const gameWinners = [0, 1].filter(pid => _wins[pid] >= MAX_WINS);
    if (gameWinners.length) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(gameWinners.length === 1 ? gameWinners[0] : -1), 1200);
    } else {
        setTimeout(_startRound, 1500);
    }
}

function _cleanup() {
    clearTimeout(_timer);
    clearTimeout(_tapFlush);
    _timer = null;
    _tapFlush = null;
    _tapBatch = [];
    _cleanups.forEach(f => f());
    _cleanups.length = 0;
}
