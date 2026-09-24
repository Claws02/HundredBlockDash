// ============================================================
// PAUSE MENU — the match stops, and the player can leave it properly.
// ============================================================
//
// There was no way to stop a match. Settings lived only on the splash, there was
// no quit short of closing the app, and when the app went to the background the
// turn engine carried on: bot turns played themselves out unseen. On Android the
// hardware Back button would have closed the app mid-match (RELEASE_AUDIT RA-04).
//
// Opening this menu stops the match clock (Director.pause — every scheduled beat
// comes off the clock) and freezes the board (Renderer.setGamePaused — hops,
// dice, camera and set pieces stand still while the scene keeps drawing).
// It opens by itself when the page is hidden, and on Back.
//
// Online matches are not paused: one phone cannot stop everybody else's clock,
// and a local pause there would only desync this replica. The button is hidden.
// ============================================================

import { state } from '../core/GameState.js';
import * as Director from '../core/Director.js';
import * as Renderer from '../engine/Renderer.js';
import * as Onboarding from './Onboarding.js';
import { sfx } from '../engine/AudioManager.js';

let _open = false;
let _onQuit = null;

function _online() { return typeof state.localSeat === 'number' || !!state.netReplica; }

// A match is on the board: not the menus, not the win screen, not a minigame
// (a minigame has its own clock and its own "paused by browser" notice).
function _inMatch() {
    return !!state.gameStarted && !state.mgActive &&
        !['INIT', 'WIN', 'GAME_OVER'].includes(state.gameState) &&
        getComputedStyle(document.getElementById('win-screen')).display === 'none';
}

export function isOpen() { return _open; }

export function init({ onQuit }) {
    _onQuit = onQuit;
    const btn = document.getElementById('btn-pause');
    if (btn) btn.addEventListener('click', () => open());

    const ov = document.getElementById('pause-overlay');
    ov.innerHTML = `
        <div class="ob-panel pause-panel" role="dialog" aria-modal="true" aria-labelledby="pause-title">
            <div class="ob-title bfont" id="pause-title">⏸ PAUSED</div>
            <div class="pause-sub">The match is on hold. Nothing moves until you come back.</div>
            <button class="ob-btn ob-btn-primary pause-btn" id="pause-resume">▶ RESUME</button>
            <button class="ob-btn pause-btn" id="pause-rules">❓ RULES &amp; SPACES</button>
            <button class="ob-btn pause-btn" id="pause-howto">📖 HOW TO PLAY</button>
            <button class="ob-btn pause-btn" id="pause-settings">⚙️ SETTINGS</button>
            <button class="ob-btn ob-btn-ghost pause-btn" id="pause-quit">🏠 QUIT TO MENU</button>
            <div class="pause-confirm" id="pause-confirm" style="display:none;">
                <div>Leave this match? It can't be picked up again later.</div>
                <div class="pause-row">
                    <button class="ob-btn ob-btn-ghost pause-btn" id="pause-quit-no">STAY</button>
                    <button class="ob-btn ob-btn-danger pause-btn" id="pause-quit-yes">LEAVE</button>
                </div>
            </div>
        </div>`;
    document.getElementById('pause-resume').addEventListener('click', close);
    document.getElementById('pause-rules').addEventListener('click', () => Onboarding.openRules());
    document.getElementById('pause-howto').addEventListener('click', () => Onboarding.openHowToPlay());
    document.getElementById('pause-settings').addEventListener('click', () => Onboarding.openSettings());
    document.getElementById('pause-quit').addEventListener('click', () => {
        document.getElementById('pause-confirm').style.display = '';
    });
    document.getElementById('pause-quit-no').addEventListener('click', () => {
        document.getElementById('pause-confirm').style.display = 'none';
    });
    document.getElementById('pause-quit-yes').addEventListener('click', () => { _onQuit && _onQuit(); });

    // The app went to the background: stop the match where it stands.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) open({ quiet: true });
    });
    // Back (Android hardware Back in a wrapper, the browser's Back on the web)
    // opens the pause menu instead of leaving; Back again while it is open
    // resumes. A history entry is kept under the match for that to work.
    window.addEventListener('popstate', () => {
        if (!_inMatch() && !_open) return;
        if (_open) close(); else open();
        _guardHistory();
    });
}

// Call when a match begins, so Back has something to pop.
export function armBackButton() { _guardHistory(); _syncButton(); }

function _guardHistory() {
    try { history.pushState({ hbd: 'match' }, ''); } catch (e) {}
}

function _syncButton() {
    const btn = document.getElementById('btn-pause');
    if (btn) btn.style.display = _online() ? 'none' : '';
}

export function open(opts = {}) {
    if (_open || _online() || !_inMatch()) return false;
    _open = true;
    Director.pause();
    Renderer.setGamePaused(true);
    document.getElementById('pause-confirm').style.display = 'none';
    document.getElementById('pause-overlay').style.display = 'flex';
    if (!opts.quiet) sfx('countdown');
    return true;
}

export function close() {
    if (!_open) return;
    _open = false;
    document.getElementById('pause-overlay').style.display = 'none';
    Renderer.setGamePaused(false);
    Director.resume();
    sfx('go');
}
