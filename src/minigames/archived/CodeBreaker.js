// Bulls-and-cows code cracker. Each player cracks their own 3-digit code (digits 1-4).
// First to crack their code wins the round. Best of 3 rounds.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const CODE_LEN    = 3;
const MAX_GUESSES = 7;
const MAX_ROUNDS  = 3;

let _done = false, _round = 0, _wins = [0, 0], _onWin = null;
let _codes = ['', ''], _guesses = [0, 0], _solved = [false, false];
let _input = ['', ''], _roundOver = false, _isBot = false;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _codes = ['', '']; _guesses = [0, 0]; _solved = [false, false];
    _input = ['', '']; _roundOver = false;

    [1, 2].forEach(pi => {
        document.getElementById(`cb-history-${pi}`).style.display = 'block';
        document.getElementById(`cb-history-${pi}`).innerHTML = '';
        document.getElementById(`cb-btns-${pi}`).style.display  = 'flex';
        document.getElementById(`cb-score-${pi}`).style.display = 'block';
        document.getElementById(`cb-score-${pi}`).textContent   = '0 wins';
        _buildBtns(pi);
    });

    document.getElementById('mg-neutral').textContent = 'CRACK THE CODE! (✓=right place ~=right digit)';
    _startRound();
}

function _buildBtns(pi) {
    const pid = pi - 1;
    const c = document.getElementById(`cb-btns-${pi}`);
    c.innerHTML = '';
    for (let d = 1; d <= 4; d++) {
        const btn = document.createElement('button');
        btn.className = 'cb-digit-btn';
        btn.textContent = d;
        btn.addEventListener('pointerdown', () => _inputDigit(pid, d));
        c.appendChild(btn);
    }
    const del = document.createElement('button');
    del.className = 'cb-digit-btn cb-del';
    del.textContent = '⌫';
    del.addEventListener('pointerdown', () => { _input[pid] = _input[pid].slice(0, -1); _renderInput(pid); });
    c.appendChild(del);

    const sub = document.createElement('button');
    sub.className = 'cb-digit-btn cb-sub';
    sub.textContent = '✓';
    sub.addEventListener('pointerdown', () => _submitGuess(pid));
    c.appendChild(sub);
}

function _startRound() {
    if (!state.mgActive || _done || _round >= MAX_ROUNDS) return;
    _round++;
    _solved = [false, false]; _guesses = [0, 0]; _input = ['', '']; _roundOver = false;

    // Generate codes with unique digits (1-4)
    _codes = [0, 1].map(() => {
        const d = [1,2,3,4].sort(() => Math.random() - 0.5);
        return d.slice(0, CODE_LEN).join('');
    });

    [1, 2].forEach(pi => {
        const hist = document.getElementById(`cb-history-${pi}`);
        hist.innerHTML = `<div class="cb-hint">Guess the ${CODE_LEN}-digit code! (digits 1–4, no repeats)</div>`;
        _renderInput(pi - 1);
    });

    document.getElementById('mg-neutral').textContent = `ROUND ${_round}/${MAX_ROUNDS}`;
    if (_isBot) setTimeout(() => _botPlay(), 400);
}

function _renderInput(pid) {
    const hist = document.getElementById(`cb-history-${pid + 1}`);
    let el = hist.querySelector('.cb-current-input');
    if (!el) { el = document.createElement('div'); el.className = 'cb-current-input bfont'; hist.appendChild(el); }
    el.textContent = _input[pid].padEnd(CODE_LEN, '_');
}

function _inputDigit(pid, d) {
    if (_done || _solved[pid] || _input[pid].length >= CODE_LEN) return;
    _input[pid] += d;
    _renderInput(pid);
}

function _getBullsCows(guess, code) {
    let bulls = 0, cows = 0;
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === code[i]) bulls++;
        else if (code.includes(guess[i])) cows++;
    }
    return { bulls, cows };
}

function _submitGuess(pid) {
    if (_done || _solved[pid] || _input[pid].length < CODE_LEN || _roundOver) return;
    const guess = _input[pid];
    _input[pid] = '';
    _guesses[pid]++;

    const { bulls, cows } = _getBullsCows(guess, _codes[pid]);
    const hist = document.getElementById(`cb-history-${pid + 1}`);
    const inputEl = hist.querySelector('.cb-current-input');
    if (inputEl) hist.removeChild(inputEl);

    const row = document.createElement('div');
    row.className = 'cb-guess-row';
    row.textContent = `${guess.split('').join(' ')}  ${'✓'.repeat(bulls)}${'~'.repeat(cows)}${bulls + cows === 0 ? '✗' : ''}`;
    hist.appendChild(row);

    if (bulls === CODE_LEN) {
        _solved[pid] = true;
        hist.innerHTML += `<div class="cb-solved">CRACKED in ${_guesses[pid]}! 🔓</div>`;
        sfx('coin_gain');
        _wins[pid]++;
        document.getElementById(`cb-score-${pid + 1}`).textContent = `${_wins[pid]} wins`;
        _checkRoundEnd();
    } else if (_guesses[pid] >= MAX_GUESSES) {
        _solved[pid] = true;
        hist.innerHTML += `<div class="cb-failed">CODE: ${_codes[pid]}</div>`;
        sfx('land_bad');
        _checkRoundEnd();
    } else {
        _renderInput(pid);
    }
}

function _checkRoundEnd() {
    if (!_solved[0] || !_solved[1]) return;
    _roundOver = true;

    if (_round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 1000);
    } else {
        setTimeout(_startRound, 2200);
    }
}

function _botPlay() {
    if (!state.mgActive || _done || _solved[1] || _roundOver) return;
    // Intelligent bot: builds a candidate list and narrows with each result
    const remaining = [];
    for (let a = 1; a <= 4; a++)
        for (let b = 1; b <= 4; b++)
            for (let c = 1; c <= 4; c++)
                if (a !== b && b !== c && a !== c) remaining.push(`${a}${b}${c}`);

    const previous = [];

    const guessNext = () => {
        if (!state.mgActive || _done || _solved[1] || _roundOver) return;
        // Filter remaining by previous results
        const candidates = remaining.filter(cand =>
            previous.every(({ guess, bulls, cows }) => {
                const r = _getBullsCows(guess, cand);
                return r.bulls === bulls && r.cows === cows;
            })
        );
        const pick = candidates[Math.floor(Math.random() * candidates.length)] || remaining[0];

        // Type it in
        let i = 0;
        const typeNext = () => {
            if (!state.mgActive || _done || _solved[1] || _roundOver) return;
            if (i < CODE_LEN) {
                _inputDigit(1, parseInt(pick[i++]));
                setTimeout(typeNext, 180 + Math.random() * 140);
            } else {
                setTimeout(() => {
                    if (!state.mgActive || _done || _solved[1] || _roundOver) return;
                    const { bulls, cows } = _getBullsCows(pick, _codes[1]);
                    previous.push({ guess: pick, bulls, cows });
                    _submitGuess(1);
                    if (!_solved[1] && !_roundOver) setTimeout(guessNext, 700 + Math.random() * 500);
                }, 250);
            }
        };
        typeNext();
    };

    setTimeout(guessNext, 600 + Math.random() * 400);
}
