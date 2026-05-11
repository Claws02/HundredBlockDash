import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_WINS = 2; // best of 3

let _done = false, _roundDone = false, _timer = null, _onWin = null, _isBot = false;
let _wins = [0, 0];
const _cleanups = [];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _wins = [0, 0];
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;
    clearTimeout(_timer);
    _cleanups.forEach(f => f()); _cleanups.length = 0;

    [1, 2].forEach(i => {
        const z = document.getElementById(`react-z-${i}`);
        z.style.display = 'flex'; z.className = 'reaction-zone waiting'; z.textContent = 'WAIT...';
    });
    document.getElementById('mg-neutral').textContent = `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  WAIT FOR IT...`;

    [0, 1].forEach(pid => {
        const z = document.getElementById(`react-z-${pid + 1}`);
        const handler = () => {
            if (_done || _roundDone) return;
            if (!z.classList.contains('go')) {
                // Early tap — other player wins this round
                _roundDone = true;
                clearTimeout(_timer);
                const roundWinner = pid === 0 ? 1 : 0;
                _wins[roundWinner]++;
                z.className = 'reaction-zone too-early'; z.textContent = 'TOO EARLY!';
                document.getElementById('mg-neutral').textContent =
                    `P${pid + 1} TAPPED EARLY!  ${_wins[0]}–${_wins[1]}`;
                sfx('land_bad');
                if (_wins[roundWinner] >= MAX_WINS) {
                    _done = true; state.mgActive = false;
                    setTimeout(() => _onWin(roundWinner), 1200);
                } else {
                    setTimeout(_startRound, 1500);
                }
            } else {
                _tap(pid);
            }
        };
        z.addEventListener('pointerdown', handler, { once: true });
        _cleanups.push(() => z.removeEventListener('pointerdown', handler));
    });

    const delay = 1500 + Math.random() * 2500;
    _timer = setTimeout(() => {
        sfx('react_go');
        [1, 2].forEach(i => { const z = document.getElementById(`react-z-${i}`); z.className = 'reaction-zone go'; z.textContent = 'TAP!'; });
        document.getElementById('mg-neutral').textContent = 'NOW!';
        if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1); }, 200 + Math.random() * 500);
        // Nobody tapped in time — redo round as a draw (no win awarded)
        const goTimeout = setTimeout(() => {
            if (!_done && !_roundDone) {
                _roundDone = true;
                _cleanups.forEach(f => f()); _cleanups.length = 0;
                document.getElementById('mg-neutral').textContent = 'NO RESPONSE — RETRY!';
                setTimeout(_startRound, 1200);
            }
        }, 3000);
        _cleanups.push(() => clearTimeout(goTimeout));
    }, delay);
}

export function destroy() {
    clearTimeout(_timer); _cleanups.forEach(f => f()); _cleanups.length = 0; _done = true;
}

function _tap(pid) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;
    clearTimeout(_timer);
    _wins[pid]++;
    document.getElementById(`react-z-${pid + 1}`).className = 'reaction-zone won';
    document.getElementById(`react-z-${pid + 1}`).textContent = 'FIRST!';
    document.getElementById(`react-z-${(pid === 0 ? 2 : 1)}`).textContent = 'TOO SLOW';
    document.getElementById('mg-neutral').textContent = `P${pid + 1} WINS!  ${_wins[0]}–${_wins[1]}`;
    sfx('coin_gain');
    if (_wins[pid] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(pid), 1200);
    } else {
        setTimeout(_startRound, 1500);
    }
}
