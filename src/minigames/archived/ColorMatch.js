// Race game: both players see the same word/ink — first to tap ends the round.
// Correct tap = +1 for you. Wrong tap = +1 for opponent. First to 2 wins.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const CM_COLORS = [
    { name: 'RED',    hex: '#ef4444', symbol: 'R' },
    { name: 'BLUE',   hex: '#3b82f6', symbol: 'B' },
    { name: 'GREEN',  hex: '#22c55e', symbol: 'G' },
    { name: 'YELLOW', hex: '#fbbf24', symbol: 'Y' },
    { name: 'PURPLE', hex: '#a855f7', symbol: 'P' },
];

const MAX_WINS = 2; // best of 3

let _round = 0, _wins = [0, 0], _done = false, _roundDone = false, _onWin = null, _isBot = false;
let _inkName = '';

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _round = 0; _wins = [0, 0]; _done = false;
    [1, 2].forEach(i => {
        document.getElementById(`color-round-${i}`).style.display = 'block';
        document.getElementById(`color-word-${i}`).style.display = 'block';
        document.getElementById(`color-btns-${i}`).style.display = 'flex';
    });
    _nextRound();
}

function _nextRound() {
    if (!state.mgActive || _done) return;
    _round++; _roundDone = false;

    // Pick a word color and a different ink color
    const wi = Math.floor(Math.random() * CM_COLORS.length);
    let ii; do { ii = Math.floor(Math.random() * CM_COLORS.length); } while (ii === wi);
    const word = CM_COLORS[wi], ink = CM_COLORS[ii];
    _inkName = ink.name;
    const shuffled = [...CM_COLORS].sort(() => Math.random() - 0.5);

    [1, 2].forEach(i => {
        document.getElementById(`color-round-${i}`).textContent =
            `Round ${_round}   P1: ${_wins[0]}  P2: ${_wins[1]}`;
        // Word shown in ink color with explicit "TAP THIS COLOR ↑" label
        const cw = document.getElementById(`color-word-${i}`);
        cw.innerHTML =
            `<span style="color:${ink.hex};font-size:1.1em;letter-spacing:2px;">${word.name}</span>` +
            `<span class="cm-ink-hint" style="color:${ink.hex};">↑ TAP THE INK COLOR</span>`;
        // Rebuild buttons to clear old listeners
        const cb = document.getElementById(`color-btns-${i}`);
        cb.innerHTML = '';
        shuffled.forEach(c => {
            const b = document.createElement('button');
            b.className = 'color-btn';
            b.style.cssText = `background:${c.hex};border-color:${c.hex};`;
            b.dataset.colorName = c.name;
            b.dataset.symbol = c.symbol;
            b.title = c.name;
            b.setAttribute('aria-label', c.name);
            b.addEventListener('pointerdown', e => {
                e.preventDefault();
                b.classList.add('cm-tapped');
                _tap(i - 1, c.name, b);
            });
            cb.appendChild(b);
        });
    });
    document.getElementById('mg-neutral').textContent = 'TAP THE INK COLOR — NOT THE WORD!';
    if (_isBot) setTimeout(() => { if (state.mgActive && !_done && !_roundDone) _tap(1, _inkName); }, 1000 + Math.random() * 1200);
}

function _tap(pid, chosen, tappedButton = null) {
    if (!state.mgActive || _done || _roundDone) return;
    _roundDone = true; // first tap ends the round for both
    const correct = chosen === _inkName;
    const roundWinner = correct ? pid : (pid === 0 ? 1 : 0);
    _wins[roundWinner]++;

    // Highlight the correct button in tapper's grid
    document.querySelectorAll(`#color-btns-${pid + 1} .color-btn`).forEach(b => {
        if (b.dataset.colorName === _inkName) b.style.outline = '4px solid #fff';
    });
    if (!correct && tappedButton) tappedButton.classList.add('cm-wrong');

    document.getElementById('mg-neutral').textContent =
        correct
            ? `✓ P${pid + 1} CORRECT!  ${_wins[0]}–${_wins[1]}`
            : `✗ P${pid + 1} WRONG!  ${_wins[0]}–${_wins[1]}`;
    sfx(correct ? 'coin_gain' : 'land_bad');

    if (_wins[roundWinner] >= MAX_WINS) {
        _done = true; state.mgActive = false;
        setTimeout(() => _onWin(roundWinner), 1000);
    } else {
        setTimeout(_nextRound, 1600);
    }
}
