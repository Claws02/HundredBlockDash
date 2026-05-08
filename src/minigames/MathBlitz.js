import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MAX_WINS = 2; // best of 3

let _done = false, _roundDone = false, _onWin = null, _isBot = false;
let _wins = [0, 0], _answer = 0;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _wins = [0, 0];
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;

    const ops = ['+', '-', '×'];
    const op  = ops[Math.floor(Math.random() * 3)];
    let a, b;
    if (op === '+')      { a = Math.floor(Math.random() * 20) + 1;  b = Math.floor(Math.random() * 20) + 1; _answer = a + b; }
    else if (op === '-') { a = Math.floor(Math.random() * 20) + 10; b = Math.floor(Math.random() * a) + 1;  _answer = a - b; }
    else                 { a = Math.floor(Math.random() * 9)  + 2;  b = Math.floor(Math.random() * 9)  + 2; _answer = a * b; }

    const q = `${a} ${op} ${b} = ?`;
    const wrongs = new Set(); let safe = 0;
    while (wrongs.size < 3 && safe++ < 100) {
        const w = _answer + (Math.floor(Math.random() * 18) - 9);
        if (w !== _answer && w > 0 && !wrongs.has(w)) wrongs.add(w);
    }
    let pad = 1; while (wrongs.size < 3) { if (pad !== _answer) wrongs.add(pad); pad++; }
    const choices = [_answer, ...wrongs].sort(() => Math.random() - 0.5);

    [1, 2].forEach(p => {
        const qEl = document.getElementById(`math-q-${p}`);
        qEl.textContent = q; qEl.style.display = 'block';
        const aEl = document.getElementById(`math-a-${p}`);
        aEl.style.display = 'grid'; aEl.innerHTML = '';
        choices.forEach(ch => {
            const btn = document.createElement('button');
            btn.className = 'math-ans-btn bfont'; btn.textContent = ch;
            btn.addEventListener('pointerdown', () => _tap(p - 1, ch));
            aEl.appendChild(btn);
        });
    });

    document.getElementById('mg-neutral').textContent = `P1 ${_wins[0]} — P2 ${_wins[1]}`;

    if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1, _answer); }, 3000 + Math.random() * 2000);
}

function _tap(pid, val) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;

    const correct = +val === _answer;
    const roundWinner = correct ? pid : (pid === 0 ? 1 : 0);
    _wins[roundWinner]++;

    document.querySelectorAll(`#math-a-${pid + 1} .math-ans-btn`).forEach(b => {
        b.classList.add(+b.textContent === _answer ? 'correct-ans' : 'wrong-ans');
    });

    document.getElementById('mg-neutral').textContent =
        `P${roundWinner + 1} WINS THE ROUND!  ${_wins[0]}–${_wins[1]}`;
    sfx(correct ? 'coin_gain' : 'land_bad');

    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1200);
    } else {
        setTimeout(_startRound, 1800);
    }
}
