import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';
import { FALLBACK_TRIVIA } from '../config/MinigameRegistry.js';

const MAX_WINS = 2; // best of 3

let _answer = '', _done = false, _roundDone = false, _onWin = null, _isBot = false;
let _wins = [0, 0];

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _onWin = onWin; _isBot = isBot;
    _wins = [0, 0];
    _startRound();
}

function _startRound() {
    if (!state.mgActive || _done) return;
    _roundDone = false;
    _showScore('FETCHING...');
    [1, 2].forEach(p => {
        document.getElementById(`trivia-q-${p}`).textContent = '...';
        document.getElementById(`trivia-g-${p}`).innerHTML = '';
    });
    fetch('https://opentdb.com/api.php?amount=1&type=multiple')
        .then(r => r.json())
        .then(d => { if (!_done && d.results?.length > 0) _setup(d.results[0]); else if (!_done) _setup(_rand()); })
        .catch(() => { if (!_done) _setup(_rand()); });
    if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1, _answer); }, 4500 + Math.random() * 2500);
}

function _rand() { return FALLBACK_TRIVIA[Math.floor(Math.random() * FALLBACK_TRIVIA.length)]; }
function _decode(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
function _showScore(label) {
    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} — P2 ${_wins[1]}` + (label ? `  ·  ${label}` : '');
}

function _setup(data) {
    if (!state.mgActive || _done) return;
    _answer = _decode(data.correct_answer || data.a);
    const q = _decode(data.question || data.q);
    const wrongs = (data.incorrect_answers || data.w).map(_decode);
    const choices = [_answer, ...wrongs].sort(() => Math.random() - 0.5);
    [1, 2].forEach(p => {
        const qEl = document.getElementById(`trivia-q-${p}`); qEl.textContent = q; qEl.style.display = 'block';
        const gEl = document.getElementById(`trivia-g-${p}`); gEl.style.display = 'grid'; gEl.innerHTML = '';
        choices.forEach(ch => {
            const b = document.createElement('button'); b.className = 'trivia-btn'; b.textContent = ch;
            b.addEventListener('pointerdown', () => _tap(p - 1, ch)); gEl.appendChild(b);
        });
    });
    _showScore('ANSWER QUICK!');
}

function _tap(pid, ans) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;
    const correct = ans === _answer;
    const roundWinner = correct ? pid : (pid === 0 ? 1 : 0);
    _wins[roundWinner]++;
    document.querySelectorAll(`#trivia-g-${pid + 1} .trivia-btn`).forEach(b => {
        b.classList.add(b.textContent === _answer ? 'correct' : 'wrong');
    });
    document.getElementById('mg-neutral').textContent =
        `P${roundWinner + 1} WINS THE ROUND!  ${_wins[0]}–${_wins[1]}`;
    sfx(correct ? 'coin_gain' : 'land_bad');
    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1500);
    } else {
        setTimeout(_startRound, 2000);
    }
}
