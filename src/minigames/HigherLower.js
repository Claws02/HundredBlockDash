import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const HL_MAX = 7;
let _secret = [0, 0], _guesses = [0, 0], _done = [false, false], _currentGuess = ['', ''], _onWin = null;
let _foundAnswer = [false, false], _gameOver = false;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin;
    _secret = [Math.floor(Math.random() * 100) + 1, Math.floor(Math.random() * 100) + 1];
    _guesses = [0, 0]; _done = [false, false]; _currentGuess = ['', ''];
    _foundAnswer = [false, false]; _gameOver = false;

    [1, 2].forEach(pi => {
        document.getElementById(`hl-secret-${pi}`).style.display = 'block';
        document.getElementById(`hl-secret-${pi}`).textContent = '1 – 100';
        document.getElementById(`hl-feedback-${pi}`).style.display = 'block';
        document.getElementById(`hl-feedback-${pi}`).textContent = '';
        document.getElementById(`hl-guesses-${pi}`).style.display = 'block';
        document.getElementById(`hl-guesses-${pi}`).textContent = HL_MAX + ' guesses left';
        _buildInput(pi - 1);
    });
    document.getElementById('mg-neutral').textContent = 'GUESS YOUR NUMBER!';
    if (isBot) setTimeout(() => _botGuess(1, 1, 100), 600);
}

function _buildInput(pid) {
    const row = document.getElementById(`hl-input-${pid + 1}`);
    row.style.display = 'flex'; row.innerHTML = '';
    const disp = document.createElement('div');
    disp.className = 'hl-guess-display'; disp.id = `hl-disp-${pid + 1}`; disp.textContent = '?';
    row.appendChild(disp);
    const pad = document.createElement('div');
    pad.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:6px;';
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].forEach(n => {
        const b = document.createElement('button'); b.className = 'hl-num-btn'; b.textContent = n;
        b.addEventListener('pointerdown', () => _digit(pid, n)); pad.appendChild(b);
    });
    const del = document.createElement('button'); del.className = 'hl-num-btn'; del.textContent = '⌫'; del.style.color = '#ef4444';
    del.addEventListener('pointerdown', () => _delete(pid)); pad.appendChild(del);
    const sub = document.createElement('button'); sub.className = 'hl-submit-btn'; sub.textContent = 'GUESS →';
    sub.addEventListener('pointerdown', () => _submit(pid)); row.appendChild(sub);
    row.appendChild(pad);
}

function _digit(pid, n) {
    if (_done[pid]) return;
    if (_currentGuess[pid].length < 3) _currentGuess[pid] += n;
    document.getElementById(`hl-disp-${pid + 1}`).textContent = _currentGuess[pid] || '?';
}

function _delete(pid) {
    if (_done[pid]) return;
    _currentGuess[pid] = _currentGuess[pid].slice(0, -1);
    document.getElementById(`hl-disp-${pid + 1}`).textContent = _currentGuess[pid] || '?';
}

function _submit(pid) {
    if (_done[pid] || !_currentGuess[pid]) return;
    const guess = parseInt(_currentGuess[pid]);
    if (isNaN(guess) || guess < 1 || guess > 100) {
        _currentGuess[pid] = '';
        document.getElementById(`hl-disp-${pid + 1}`).textContent = '?';
        return;
    }
    _guesses[pid]++;
    _currentGuess[pid] = '';
    document.getElementById(`hl-disp-${pid + 1}`).textContent = '?';
    const left = HL_MAX - _guesses[pid];
    const fb = document.getElementById(`hl-feedback-${pid + 1}`);
    if (guess === _secret[pid]) {
        _done[pid] = true; _foundAnswer[pid] = true;
        fb.textContent = `✅ GOT IT in ${_guesses[pid]}!`; fb.style.color = '#4ade80';
        document.getElementById(`hl-guesses-${pid + 1}`).textContent = '';
        document.getElementById(`hl-input-${pid + 1}`).style.display = 'none';
        document.getElementById(`hl-secret-${pid + 1}`).textContent = _secret[pid];
        sfx('coin_gain');
        if (_done[0] && _done[1]) _resolve();
    } else if (_guesses[pid] >= HL_MAX) {
        _done[pid] = true;
        fb.textContent = (guess < _secret[pid] ? '↑ HIGHER' : '↓ LOWER') + ' — OUT OF GUESSES!'; fb.style.color = '#ef4444';
        document.getElementById(`hl-guesses-${pid + 1}`).textContent = `The number was ${_secret[pid]}`;
        document.getElementById(`hl-input-${pid + 1}`).style.display = 'none';
        if (_done[0] && _done[1]) _resolve();
    } else {
        fb.textContent = guess < _secret[pid] ? '↑ HIGHER' : '↓ LOWER';
        fb.style.color = guess < _secret[pid] ? '#fbbf24' : '#60a5fa';
        document.getElementById(`hl-guesses-${pid + 1}`).textContent = `${left} guess${left !== 1 ? 'es' : ''} left`;
    }
}

function _resolve() {
    if (_gameOver) return; _gameOver = true;
    state.mgActive = false;
    let winner = -1;
    if (_foundAnswer[0] && _foundAnswer[1]) winner = _guesses[0] < _guesses[1] ? 0 : _guesses[1] < _guesses[0] ? 1 : -1;
    else if (_foundAnswer[0]) winner = 0;
    else if (_foundAnswer[1]) winner = 1;
    setTimeout(() => _onWin(winner), 1200);
}

function _botGuess(pid, lo, hi) {
    if (!state.mgActive || _done[pid] || _gameOver) return;
    const guess = Math.floor((lo + hi) / 2);
    _currentGuess[pid] = String(guess);
    _submit(pid);
    if (_done[pid]) return;
    const newLo = guess < _secret[pid] ? guess + 1 : lo;
    const newHi = guess > _secret[pid] ? guess - 1 : hi;
    setTimeout(() => _botGuess(pid, newLo, newHi), 1200 + Math.random() * 600);
}
