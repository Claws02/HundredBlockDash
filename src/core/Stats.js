// ============================================================
// STATS — lightweight, persisted player record (1-player vs Bot).
// Used for the splash "your record" line and win-screen streak feedback.
// ============================================================

import * as Storage from './Storage.js';

const DEFAULT = { games: 0, wins: 0, losses: 0, ties: 0, streak: 0, bestStreak: 0 };

export function get() {
    return { ...DEFAULT, ...(Storage.load('stats', {}) || {}) };
}

// Record a finished 1-player game from Player 1's perspective.
export function recordVsBot(playerWon, isTie) {
    const s = get();
    s.games++;
    if (isTie) {
        s.ties++; s.streak = 0;
    } else if (playerWon) {
        s.wins++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
    } else {
        s.losses++; s.streak = 0;
    }
    Storage.save('stats', s);
    return s;
}

export function reset() {
    Storage.save('stats', { ...DEFAULT });
}
