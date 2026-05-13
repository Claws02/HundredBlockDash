// Race to tap numbers 1–9 in ascending order. First to finish wins the round.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_ROUNDS = 3;
let _done = false, _round = 0, _wins = [0, 0], _next = [1, 1], _onWin = null;
let _roundWon = false, _isBot = false;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _next = [1, 1]; _onWin = onWin; _isBot = isBot;
    _roundWon = false;

    [1, 2].forEach(pi => {
        document.getElementById(`ss-grid-${pi}`).style.display = 'grid';
        document.getElementById(`ss-score-${pi}`).style.display = 'block';
        document.getElementById(`ss-score-${pi}`).textContent = '0 wins';
    });

    document.getElementById('mg-neutral').textContent = 'TAP  1 → 2 → … → 9  FASTEST!';
    _startRound();
}

function _buildGrid(pi) {
    const nums = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
    const grid = document.getElementById(`ss-grid-${pi}`);
    grid.innerHTML = '';
    nums.forEach(n => {
        const btn = document.createElement('button');
        btn.className = 'ss-num-btn';
        btn.textContent = n;
        btn.dataset.num = n;
        btn.addEventListener('pointerdown', () => _tap(pi - 1, n));
        grid.appendChild(btn);
    });
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _next = [1, 1];
    _roundWon = false;

    [1, 2].forEach(pi => _buildGrid(pi));
    document.getElementById('mg-neutral').textContent = `ROUND ${_round} — GO!`;
    sfx('go');

    if (_isBot) _botPlay();
}

function _botPlay() {
    if (!state.mgActive || _done || _roundWon) return;
    const n = _next[1];
    if (n > 9) return;
    setTimeout(() => {
        if (!state.mgActive || _done || _roundWon) return;
        _tap(1, _next[1]);
        if (_next[1] <= 9) _botPlay();
    }, 280 + Math.random() * 340);
}

function _tap(pid, num) {
    if (_done || _roundWon || num !== _next[pid]) {
        // Wrong tap feedback
        document.querySelectorAll(`#ss-grid-${pid + 1} .ss-num-btn`).forEach(b => {
            if (parseInt(b.dataset.num) === num) {
                b.classList.add('ss-wrong');
                setTimeout(() => b.classList.remove('ss-wrong'), 280);
            }
        });
        return;
    }

    // Correct
    document.querySelectorAll(`#ss-grid-${pid + 1} .ss-num-btn`).forEach(b => {
        if (parseInt(b.dataset.num) === num) { b.classList.add('ss-done'); b.disabled = true; }
    });
    _next[pid]++;
    sfx('land_good');

    if (_next[pid] > 9) {
        _roundWon = true;
        _wins[pid]++;
        document.getElementById(`ss-score-${pid + 1}`).textContent = `${_wins[pid]} wins`;
        document.getElementById('mg-neutral').textContent = `P${pid + 1} FINISHED! 🎉`;

        const winsNeeded = Math.ceil(MAX_ROUNDS / 2);
        if (_wins[0] >= winsNeeded || _wins[1] >= winsNeeded || _round >= MAX_ROUNDS) {
            _done = true; state.mgActive = false;
            const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
            setTimeout(() => _onWin(winner), 800);
        } else {
            setTimeout(_startRound, 1500);
        }
    }
}
