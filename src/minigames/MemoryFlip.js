// Pass-and-play: one shared 18-card grid (9 pairs).
// Background turns red (P1) or blue (P2) to show whose turn it is.
// Match a pair → go again. No match → pass the phone to the other player.
import { state } from '../core/GameState.js';
import { sfx } from '../engine/AudioManager.js';

const MEM_EMOJIS = ['🐶','🐱','🌟','🍕','🎸','🚀','🦊','🐸','🌈'];
const COLS = 6; // 6×3 grid

let _cards = [], _firstIdx = null, _matched = [0, 0], _done = false;
let _flipping = false, _currentPlayer = 0, _onWin = null, _isBot = false;

function _buildGrid() {
    // Use mem-grid-1 as the single shared grid; hide mem-grid-2
    const g = document.getElementById('mem-grid-1');
    g.style.display = 'grid';
    g.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    g.style.gap = '5px';
    g.innerHTML = '';
    document.getElementById('mem-grid-2').style.display = 'none';
    _cards.forEach((_, i) => {
        const el = document.createElement('div');
        el.className = 'mem-card'; el.dataset.idx = i;
        el.addEventListener('pointerdown', () => _tapCard(i));
        g.appendChild(el);
    });
}

function _renderGrid() {
    const g = document.getElementById('mem-grid-1');
    [...g.children].forEach((el, i) => {
        const c = _cards[i];
        el.textContent = (c.revealed || c.matched) ? c.emoji : '';
        el.className = 'mem-card' + (c.matched ? ' matched' : c.revealed ? ' flipped' : '');
    });
}

function _setTheme(pid) {
    const layer = document.getElementById('minigame-layer');
    const p1c = 'rgba(239,68,68,0.18)', p2c = 'rgba(59,130,246,0.18)';
    layer.style.background = pid === 0
        ? `linear-gradient(180deg,${p1c} 0%,rgba(20,8,38,0.98) 40%)`
        : `linear-gradient(180deg,${p2c} 0%,rgba(20,8,38,0.98) 40%)`;
    const label = pid === 0 ? '🔴 P1' : '🔵 P2';
    document.getElementById('mg-neutral').textContent =
        `${label}'S TURN  ·  🔴 ${_matched[0]}  🔵 ${_matched[1]}`;
}

export function start(isBot, onWin) {
    if (!state.mgActive) return;
    _onWin = onWin; _isBot = isBot;
    _firstIdx = null; _matched = [0, 0]; _done = false; _flipping = false; _currentPlayer = 0;

    const deck = [...MEM_EMOJIS, ...MEM_EMOJIS].sort(() => Math.random() - 0.5);
    _cards = deck.map((e, i) => ({ emoji: e, idx: i, revealed: false, matched: false }));

    [1, 2].forEach(pi => {
        document.getElementById(`mem-score-${pi}`).style.display = 'block';
        document.getElementById(`mem-score-${pi}`).textContent = '0 pairs';
    });

    _buildGrid();
    _setTheme(0);

    // Flash all cards for memorize period
    _cards.forEach(c => c.revealed = true); _renderGrid();
    setTimeout(() => {
        _cards.forEach(c => c.revealed = false); _renderGrid();
        if (_isBot && _currentPlayer === 1) setTimeout(_botTurn, 500);
    }, 2000);
}

function _tapCard(idx) {
    if (!state.mgActive || _done || _flipping) return;
    if (_cards[idx].matched || _cards[idx].revealed) return;

    _cards[idx].revealed = true; _renderGrid();

    if (_firstIdx === null) { _firstIdx = idx; return; }

    const a = _cards[_firstIdx], b = _cards[idx];
    _firstIdx = null; _flipping = true;

    setTimeout(() => {
        _flipping = false;
        if (a.emoji === b.emoji) {
            a.matched = b.matched = true;
            _matched[_currentPlayer]++;
            document.getElementById(`mem-score-${_currentPlayer + 1}`).textContent =
                `${_matched[_currentPlayer]} pair${_matched[_currentPlayer] !== 1 ? 's' : ''}`;
            sfx('coin_gain');
            _renderGrid();
            if (_cards.every(c => c.matched)) {
                _done = true; state.mgActive = false;
                document.getElementById('minigame-layer').style.background = '';
                const winner = _matched[0] > _matched[1] ? 0 : _matched[1] > _matched[0] ? 1 : -1;
                setTimeout(() => _onWin(winner), 700);
                return;
            }
            // Match: same player goes again
            _setTheme(_currentPlayer);
            if (_isBot && _currentPlayer === 1) setTimeout(_botTurn, 700);
        } else {
            a.revealed = b.revealed = false;
            sfx('land_bad');
            _renderGrid();
            _currentPlayer = 1 - _currentPlayer;
            // "PASS THE PHONE" splash
            const layer = document.getElementById('minigame-layer');
            const passColor = _currentPlayer === 0 ? '#ef4444' : '#3b8eff';
            document.getElementById('mg-neutral').innerHTML =
                `<span style="color:${passColor};font-size:1.1em;">PASS THE PHONE → P${_currentPlayer + 1}!</span>`;
            layer.style.background = 'rgba(20,8,38,0.98)';
            setTimeout(() => {
                if (!state.mgActive || _done) return;
                _setTheme(_currentPlayer);
                if (_isBot && _currentPlayer === 1) _botTurn();
            }, 1400);
        }
    }, 900);
}

function _botTurn() {
    if (!state.mgActive || _done || _currentPlayer !== 1) return;
    // Build memory of seen cards
    const known = {};
    _cards.forEach((c, i) => {
        if (!c.matched) {
            if (!known[c.emoji]) known[c.emoji] = [];
            if (!known[c.emoji].includes(i)) known[c.emoji].push(i);
        }
    });
    // Try to match a known pair
    for (const em in known) {
        const indices = known[em].filter(i => !_cards[i].matched && !_cards[i].revealed);
        if (indices.length >= 2) {
            setTimeout(() => { if (state.mgActive && !_done && !_flipping) _tapCard(indices[0]); }, 500);
            setTimeout(() => { if (state.mgActive && !_done) _tapCard(indices[1]); }, 1300);
            return;
        }
    }
    // Flip a random unmatched card
    const candidates = _cards.map((c, i) => i).filter(i => !_cards[i].matched && !_cards[i].revealed);
    if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        setTimeout(() => { if (state.mgActive && !_done && !_flipping) _tapCard(pick); }, 700);
    }
}
