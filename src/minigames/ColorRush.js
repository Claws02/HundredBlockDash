// Stroop-effect reaction game: tap your zone only when the word text MATCHES its ink color.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const COLORS = [
    { name: 'RED',    hex: '#ef4444' },
    { name: 'BLUE',   hex: '#3b82f6' },
    { name: 'GREEN',  hex: '#4ade80' },
    { name: 'YELLOW', hex: '#fbbf24' },
    { name: 'PURPLE', hex: '#a855f7' },
];
const GAME_MS  = 20000;
const WORD_MS  = 950;

let _done = false, _scores = [0, 0], _onWin = null;
let _seq = 0, _wordIsMatch = false, _tapped = [false, false];
let _isBot = false, _endTimer = null;

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _done = false; _scores = [0, 0]; _onWin = onWin; _isBot = isBot;
    _seq = 0; _wordIsMatch = false; _tapped[0] = false; _tapped[1] = false;
    clearTimeout(_endTimer);

    [1, 2].forEach(pi => {
        const pid = pi - 1;
        document.getElementById(`cr-word-${pi}`).style.display = 'block';
        document.getElementById(`cr-word-${pi}`).textContent  = '';
        document.getElementById(`cr-score-${pi}`).style.display = 'block';
        document.getElementById(`cr-score-${pi}`).textContent   = '0';
        const tap = document.getElementById(`cr-tap-${pi}`);
        tap.style.display = 'flex';
        tap.className = 'cr-tap-zone';
        tap.addEventListener('pointerdown', () => _onTap(pid));
    });

    document.getElementById('mg-neutral').textContent = 'TAP WHEN COLORS MATCH!';

    _endTimer = setTimeout(() => {
        if (_done) return;
        _done = true; state.mgActive = false;
        const winner = _scores[0] > _scores[1] ? 0 : _scores[1] > _scores[0] ? 1 : -1;
        document.getElementById('mg-neutral').textContent = 'TIME UP!';
        setTimeout(() => _onWin(winner), 500);
    }, GAME_MS);

    _nextWord();
}

function _nextWord() {
    if (_done) return;
    _seq++;
    const mySeq = _seq;
    _tapped[0] = false; _tapped[1] = false;

    const wordColor = COLORS[Math.floor(Math.random() * COLORS.length)];
    const isMatch   = Math.random() < 0.35;
    const ink       = isMatch ? wordColor : COLORS.filter(c => c.name !== wordColor.name)[Math.floor(Math.random() * (COLORS.length - 1))];
    _wordIsMatch = isMatch;

    [1, 2].forEach(pi => {
        const el = document.getElementById(`cr-word-${pi}`);
        el.textContent  = wordColor.name;
        el.style.color  = ink.hex;
        document.getElementById(`cr-tap-${pi}`).className = 'cr-tap-zone';
    });

    if (_isBot && isMatch) {
        setTimeout(() => {
            if (state.mgActive && !_done && _seq === mySeq) _onTap(1);
        }, 160 + Math.random() * 320);
    }

    setTimeout(() => { if (!_done && _seq === mySeq) _nextWord(); }, WORD_MS);
}

function _onTap(pid) {
    if (_done || _tapped[pid]) return;
    _tapped[pid] = true;

    if (_wordIsMatch) {
        _scores[pid]++;
        sfx('land_good');
        document.getElementById(`cr-tap-${pid + 1}`).classList.add('cr-correct');
    } else {
        if (_scores[pid] > 0) _scores[pid]--;
        sfx('land_bad');
        document.getElementById(`cr-tap-${pid + 1}`).classList.add('cr-wrong');
    }
    document.getElementById(`cr-score-${pid + 1}`).textContent = `${_scores[pid]}`;
}
