import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_WINS = 2; // best of 3

let _startTime = 0, _stopped = [false, false], _stopTime = [0, 0];
let _done = false, _resolved = false, _rafId = null, _onWin = null;
let _wins = [0, 0], _isBot = false;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _wins = [0, 0]; _done = false;
    [1, 2].forEach(i => {
        document.getElementById(`cd-timer-${i}`).style.display = 'block';
        document.getElementById(`cd-tap-${i}`).style.display = 'block';
        document.getElementById(`cd-result-${i}`).style.display = 'none';
    });
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _stopped = [false, false]; _stopTime = [0, 0]; _resolved = false;
    cancelAnimationFrame(_rafId);
    _startTime = performance.now();

    [1, 2].forEach(i => {
        document.getElementById(`cd-timer-${i}`).textContent = '0.00';
        document.getElementById(`cd-result-${i}`).style.display = 'none';
        // Rebuild tap zone to clear prior listener
        const old = document.getElementById(`cd-tap-${i}`);
        const fresh = old.cloneNode(true);
        old.parentNode.replaceChild(fresh, old);
        fresh.className = 'cd-tap-zone'; fresh.textContent = 'TAP TO STOP';
        fresh.addEventListener('pointerdown', () => _tap(i - 1), { once: true });
    });
    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}  ·  STOP AT 5.00s!`;

    const tick = () => {
        if (!state.mgActive) { cancelAnimationFrame(_rafId); return; }
        const elapsed = (performance.now() - _startTime) / 1000;
        const display = elapsed <= 1.0 ? elapsed.toFixed(2) : '?.??';
        document.getElementById('cd-timer-1').textContent = display;
        document.getElementById('cd-timer-2').textContent = display;
        if (!_stopped[0] || !_stopped[1]) _rafId = requestAnimationFrame(tick);
        if (_stopped[0] && _stopped[1] && !_resolved) { _resolved = true; setTimeout(_resolve, 800); }
    };
    _rafId = requestAnimationFrame(tick);

    if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_stopped[1]) _tap(1); }, 4750 + Math.random() * 500);
}

function _tap(pid) {
    if (!state.mgActive || _stopped[pid] || _done) return;
    _stopped[pid] = true;
    _stopTime[pid] = (performance.now() - _startTime) / 1000;
    const z = document.getElementById(`cd-tap-${pid + 1}`);
    z.className = 'cd-tap-zone stopped'; z.textContent = _stopTime[pid].toFixed(2) + 's';
    const diff = Math.abs(_stopTime[pid] - 5.0);
    const r = document.getElementById(`cd-result-${pid + 1}`);
    r.style.display = 'block';
    r.textContent = diff < 0.1 ? 'PERFECT! 🎯' : diff < 0.35 ? 'CLOSE! 👌' : `OFF BY ${diff.toFixed(2)}s`;
    sfx('land_good');
}

function _resolve() {
    if (_done) return;
    cancelAnimationFrame(_rafId);
    const d0 = Math.abs(_stopTime[0] - 5.0), d1 = Math.abs(_stopTime[1] - 5.0);
    const roundWinner = d0 < d1 ? 0 : d1 < d0 ? 1 : -1;
    if (roundWinner >= 0) _wins[roundWinner]++;
    document.getElementById('mg-neutral').textContent =
        roundWinner >= 0
            ? `P${roundWinner + 1} CLOSER!  ${_wins[0]}–${_wins[1]}`
            : `DRAW!  ${_wins[0]}–${_wins[1]}`;
    if (roundWinner >= 0 && _wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1200);
    } else {
        setTimeout(_startRound, 2200);
    }
}
