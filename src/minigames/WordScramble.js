import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const WORDS = [
    'PLANET','CASTLE','BRIDGE','JUNGLE','FROZEN','GARDEN','MIRROR','ROCKET','SHADOW','THUNDER',
    'CANDLE','DRAGON','GALAXY','HELMET','ISLAND','LANTERN','MARBLE','NEEDLE','ORANGE','PILLOW',
    'QUARTZ','RIBBON','SILVER','TEMPLE','VIOLET','WALNUT','YELLOW','BONFIRE','COSMIC','DESERT',
];
const MAX_ROUNDS = 5;

let _done = false, _round = 0, _wins = [0, 0], _onWin = null;
let _roundActive = false, _currentWord = '', _usedWords = new Set();
let _isBot = false, _roundTimer = null;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _round = 0; _wins = [0, 0]; _onWin = onWin; _isBot = isBot;
    _roundActive = false; _currentWord = ''; _usedWords = new Set();

    [1, 2].forEach(pi => {
        document.getElementById(`ws-scramble-${pi}`).style.display = 'block';
        document.getElementById(`ws-options-${pi}`).style.display = 'grid';
        document.getElementById(`ws-score-${pi}`).style.display = 'block';
        document.getElementById(`ws-score-${pi}`).textContent = '0 wins';
    });

    document.getElementById('mg-neutral').textContent = 'FIRST CORRECT ANSWER WINS!';
    _nextRound();
}

function _scramble(word, depth = 0) {
    const arr = word.split('');
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('') === word && depth < 10 ? _scramble(word, depth + 1) : arr.join('');
}

function _nextRound() {
    if (!state.mgActive || _done) return;
    _round++;
    _roundActive = true;

    const available = WORDS.filter(w => !_usedWords.has(w));
    if (!available.length) _usedWords.clear();
    const pool = available.length ? available : WORDS;
    _currentWord = pool[Math.floor(Math.random() * pool.length)];
    _usedWords.add(_currentWord);

    const wrongs = WORDS.filter(w => w !== _currentWord).sort(() => Math.random() - 0.5).slice(0, 3);
    const opts   = [_currentWord, ...wrongs].sort(() => Math.random() - 0.5);
    const scrambled = _scramble(_currentWord);

    [1, 2].forEach(pi => {
        document.getElementById(`ws-scramble-${pi}`).textContent = scrambled;
        const grid = document.getElementById(`ws-options-${pi}`);
        grid.innerHTML = '';
        opts.forEach(word => {
            const btn = document.createElement('button');
            btn.className = 'ws-option-btn';
            btn.textContent = word;
            btn.addEventListener('pointerdown', () => _tap(pi - 1, word === _currentWord));
            grid.appendChild(btn);
        });
    });

    document.getElementById('mg-neutral').textContent = `ROUND ${_round}/${MAX_ROUNDS}`;

    clearTimeout(_roundTimer);
    _roundTimer = setTimeout(() => {
        if (state.mgActive && !_done && _roundActive) {
            _roundActive = false;
            document.getElementById('mg-neutral').textContent = `TIME'S UP!`;
            setTimeout(_nextRound, 1000);
        }
    }, 8000);

    if (_isBot) {
        setTimeout(() => {
            if (state.mgActive && !_done && _roundActive) _tap(1, Math.random() < 0.72);
        }, 1400 + Math.random() * 2200);
    }
}

function _tap(pid, correct) {
    if (_done || !_roundActive) return;
    _roundActive = false;
    clearTimeout(_roundTimer);

    if (correct) {
        sfx('coin_gain');
        _wins[pid]++;
        document.getElementById(`ws-score-${pid + 1}`).textContent = `${_wins[pid]} wins`;
        document.getElementById('mg-neutral').textContent = `✓ P${pid + 1} WINS ROUND!`;
    } else {
        sfx('land_bad');
        document.getElementById('mg-neutral').textContent = `✗ P${pid + 1} WRONG!`;
    }

    const winsNeeded = Math.ceil(MAX_ROUNDS / 2);
    if (_wins[0] >= winsNeeded || _wins[1] >= winsNeeded || _round >= MAX_ROUNDS) {
        _done = true; state.mgActive = false;
        const winner = _wins[0] > _wins[1] ? 0 : _wins[1] > _wins[0] ? 1 : -1;
        setTimeout(() => _onWin(winner), 800);
    } else {
        setTimeout(_nextRound, 1200);
    }
}

export function destroy() {
    clearTimeout(_roundTimer); _roundTimer = null;
    _done = true;
}
