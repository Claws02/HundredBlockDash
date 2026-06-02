import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';
import { FALLBACK_TRIVIA } from '../config/MinigameRegistry.js';
import { registerMinigameCleanup } from './MinigameManager.js';

const MAX_WINS = 2; // best of 3
const TIE_WINDOW_MS = 45;
const BOT_MISTAKE_RATE = 0.2;

let _answer = '', _done = false, _roundDone = false, _onWin = null, _isBot = false;
let _wins = [0, 0], _choices = [], _tapBatch = [], _tapFlush = null, _botTimer = null;

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
    clearTimeout(_botTimer); _botTimer = null;
    _showScore('FETCHING...');
    [1, 2].forEach(p => {
        document.getElementById(`trivia-q-${p}`).textContent = '...';
        document.getElementById(`trivia-g-${p}`).innerHTML = '';
    });
    fetch('https://opentdb.com/api.php?amount=1&type=multiple')
        .then(r => r.json())
        .then(d => { if (!_done && d.results?.length > 0) _setup(d.results[0]); else if (!_done) _setup(_rand()); })
        .catch(() => { if (!_done) _setup(_rand()); });
}

function _rand() { return FALLBACK_TRIVIA[Math.floor(Math.random() * FALLBACK_TRIVIA.length)]; }
function _decode(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }
function _showScore(label) {
    document.getElementById('mg-neutral').textContent =
        `P1 ${_wins[0]} - P2 ${_wins[1]}` + (label ? `  |  ${label}` : '');
}

function _setup(data) {
    if (!state.mgActive || _done) return;
    _answer = _decode(data.correct_answer || data.a);
    const q = _decode(data.question || data.q);
    const wrongs = (data.incorrect_answers || data.w).map(_decode);
    _choices = [_answer, ...wrongs].sort(() => Math.random() - 0.5);
    [1, 2].forEach(p => {
        const qEl = document.getElementById(`trivia-q-${p}`);
        qEl.textContent = q;
        qEl.style.display = 'block';
        const gEl = document.getElementById(`trivia-g-${p}`);
        gEl.style.display = 'grid';
        gEl.innerHTML = '';
        _choices.forEach(ch => {
            const b = document.createElement('button');
            b.className = 'trivia-btn';
            b.textContent = ch;
            b.addEventListener('pointerdown', e => {
                e.preventDefault();
                b.classList.add('cm-tapped');
                _queueTap(p - 1, ch);
            });
            gEl.appendChild(b);
        });
    });
    _showScore('ANSWER QUICK!');

    if (_isBot) {
        _botTimer = setTimeout(() => {
            if (!state.mgActive || _done || _roundDone) return;
            const wrongChoices = _choices.filter(c => c !== _answer);
            const pick = Math.random() < BOT_MISTAKE_RATE && wrongChoices.length
                ? wrongChoices[Math.floor(Math.random() * wrongChoices.length)]
                : _answer;
            _queueTap(1, pick);
        }, 1800 + Math.random() * 2600);
    }
}

function _queueTap(pid, ans) {
    if (!state.mgActive || _done || _roundDone) return;
    const now = performance.now();
    _tapBatch.push({ pid, ans, time: now });
    if (_tapFlush) return;
    _tapFlush = setTimeout(() => {
        _tapFlush = null;
        const first = Math.min(..._tapBatch.map(t => t.time));
        const taps = [];
        _tapBatch
            .filter(t => t.time - first <= TIE_WINDOW_MS)
            .forEach(t => { if (!taps.some(existing => existing.pid === t.pid)) taps.push(t); });
        _tapBatch = [];
        _scoreRound(taps);
    }, TIE_WINDOW_MS + 5);
}

function _scoreRound(taps) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true;
    clearTimeout(_botTimer);

    const winners = new Set();
    taps.forEach(t => winners.add(t.ans === _answer ? t.pid : 1 - t.pid));
    winners.forEach(pid => _wins[pid]++);

    [1, 2].forEach(p => {
        document.querySelectorAll(`#trivia-g-${p} .trivia-btn`).forEach(b => {
            b.classList.add(b.textContent === _answer ? 'correct' : 'wrong');
            if (taps.some(t => t.pid === p - 1 && t.ans === b.textContent && t.ans !== _answer)) b.classList.add('cm-wrong');
        });
    });

    const label = winners.size > 1 ? 'TIE! BOTH SCORE' : `P${[...winners][0] + 1} WINS THE ROUND!`;
    document.getElementById('mg-neutral').textContent = `${label}  ${_wins[0]}-${_wins[1]}`;
    sfx(taps.every(t => t.ans === _answer) ? 'coin_gain' : 'land_bad');

    const gameWinners = [0, 1].filter(pid => _wins[pid] >= MAX_WINS);
    if (gameWinners.length) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(gameWinners.length === 1 ? gameWinners[0] : -1), 1500);
    } else {
        setTimeout(_startRound, 2000);
    }
}

function _cleanup() {
    clearTimeout(_tapFlush);
    clearTimeout(_botTimer);
    _tapFlush = null;
    _botTimer = null;
    _tapBatch = [];
}
