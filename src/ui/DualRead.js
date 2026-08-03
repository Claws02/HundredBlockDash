// ============================================================
// DUAL READ — making a message readable by both players.
//
// Tabletop mode lays the phone flat between two people facing each other, so
// exactly one of them can read any given card. The fix is not one mechanism but
// a split by *whose information it is*:
//
//   SHARED — both players need it at the same moment: minigame rules, minigame
//            outcome, the gate result, realm banners. The card is drawn twice,
//            the top copy rotated 180°, exactly the way #minigame-layer already
//            splits the screen. Both read it at once; nothing costs extra time.
//
//   OWNER  — it belongs to the player taking the turn: space results, item
//            pickups, the shop. They get the full card. The opponent gets a
//            slim mirrored strip on their own edge carrying the headline, so
//            they always know what just happened without the card shrinking to
//            half height for information only one player acts on.
//
// A ⟳ flip button rides on every card that is NOT mirrored — that means the
// owner cards in tabletop, and *all* cards in pass-and-play and 1P, where the
// phone gets handed around. A mirrored card does not get one: both people can
// already read it, and a control that visibly does nothing is worse than no
// control. The first few times a flip button appears, a small note points it
// out; after that it stays quiet.
//
// Nothing here fires outside tabletop except the flip button, so pass-and-play
// keeps its full-size single card.
// ============================================================

import { state } from '../core/GameState.js';
import * as Storage from '../core/Storage.js';

// How many times the "you can flip this" note appears before it stops.
const HINT_LIMIT   = 3;
const HINT_KEY     = 'flip_hint_seen';
const HINT_MS      = 5200;

const _mirrors    = new WeakMap();   // original card → its mirrored copy
const _decorators = new WeakMap();   // original card → fn(mirrorEl) run after each snapshot
let   _pressedSide = 0;              // 0 = the real card (P1 edge), 1 = the mirror (P2 edge)
let   _hintTimer   = null;

// Two humans actually sharing one screen. Pass-and-play hands the device over,
// so mirroring there is clutter, not help.
export function isMirrorMode() {
    return state.playStyle === 'tabletop' && !state.players[1].isBot;
}

// Which copy of a mirrored card was just pressed. Only meaningful inside a
// button handler; a dual-confirm prompt uses it to tell the two sides apart.
export function pressedSide() { return _pressedSide; }

// ---------------------------------------------------------------------------
// The one call sites make.
//
//   present(cardEl, { tier: 'shared' | 'owner', decorate })
//
// Returns true if the card ended up mirrored. `decorate(mirrorEl)` runs after
// every snapshot so a card can show different text on each side (used by the
// minigame dual-confirm, where each player's button tracks their own state).
// ---------------------------------------------------------------------------
export function present(cardEl, opts = {}) {
    if (!cardEl) return false;
    const tier = opts.tier || 'owner';
    cardEl.classList.remove('flipped');
    if (opts.decorate) _decorators.set(cardEl, opts.decorate);
    else               _decorators.delete(cardEl);

    if (tier === 'shared' && isMirrorMode()) {
        _detachFlip(cardEl);
        _mirror(cardEl);
        return true;
    }
    unmirror(cardEl);
    _attachFlip(cardEl);
    _maybeHint(cardEl);
    return false;
}

// Re-snapshot a mirrored card after its content changed. No-op if not mirrored.
export function refresh(cardEl) {
    if (!cardEl || !_mirrors.has(cardEl)) return;
    const m = _mirrors.get(cardEl);
    if (m.style.display === 'none') return;
    _snapshot(cardEl, m);
}

// Drop every mirror and the opponent strip. Called whenever modals close, so a
// stale copy can never outlive the card it was cloned from.
export function clearAll() {
    document.querySelectorAll('.dual-mirror').forEach(m => {
        m.style.display = 'none';
        if (m.parentNode) m.parentNode.classList.remove('dual-mode');
    });
    document.querySelectorAll('.dual-host').forEach(h => h.classList.remove('dual-host'));
    hideTicker();
    _dismissHint();
}

// ---------------------------------------------------------------------------
// SHARED tier — the mirrored copy
// ---------------------------------------------------------------------------

function _mirror(el) {
    let m = _mirrors.get(el);
    if (!m) {
        m = document.createElement('div');
        m._dualHost = el;
        // Presses land on a static clone, so they are forwarded to the real
        // element rather than handled here.
        m.addEventListener('pointerdown', _forward);
        _mirrors.set(el, m);
    }
    if (m.parentNode !== el.parentNode || m.nextSibling !== el) {
        el.parentNode.insertBefore(m, el);
    }
    el.parentNode.classList.add('dual-mode');
    el.classList.add('dual-host');
    _snapshot(el, m);
    m.style.display = 'block';
}

export function unmirror(el) {
    const m = _mirrors.get(el);
    if (m) {
        m.style.display = 'none';
        if (m.parentNode) m.parentNode.classList.remove('dual-mode');
    }
    el.classList.remove('dual-host');
}

function _snapshot(el, m) {
    // Every button gets a stable id so the copy can find its counterpart.
    let n = 0;
    el.querySelectorAll('button').forEach(b => { b.dataset.dualId = 'd' + (++n); });
    // The copy carries the original's classes so it looks identical — minus the
    // ones that describe *this* element's role.
    m.className = 'dual-mirror ' +
        [...el.classList].filter(c => c !== 'flipped' && c !== 'dual-host').join(' ');
    m.innerHTML = el.innerHTML;
    // A clone carries its source's ids, and duplicate ids would make every
    // getElementById in the codebase resolve to the copy (the mirror sits
    // BEFORE the original in document order). Demote them to data-mirror-id so
    // the copy stays addressable without hijacking the real element.
    m.querySelectorAll('[id]').forEach(n => {
        n.dataset.mirrorId = n.id;
        n.removeAttribute('id');
    });
    m.querySelectorAll('.card-flip-btn').forEach(b => b.remove());
    const dec = _decorators.get(el);
    if (dec) { try { dec(m); } catch (e) { console.warn('[DualRead] decorate failed:', e); } }
}

function _forward(ev) {
    const proxy = ev.target.closest('[data-dual-id]');
    const host  = ev.currentTarget._dualHost;
    if (!proxy || !host) return;
    const real = host.querySelector(`[data-dual-id="${proxy.dataset.dualId}"]`);
    if (!real || real.disabled) return;
    ev.preventDefault();
    _pressedSide = 1;
    // Handlers in this codebase are split between 'pointerdown' (which always
    // calls preventDefault) and 'click'. Fire pointerdown first; only if nobody
    // consumed it fall back to a click — so either style works and neither
    // fires twice.
    const pd = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    real.dispatchEvent(pd);
    if (!pd.defaultPrevented) real.click();
    setTimeout(() => { _pressedSide = 0; }, 0);
}

// Build the inner HTML for a caption-style overlay that has no buttons (realm
// banner, "minigame next"). Two stacked copies, the top one rotated.
export function dualHTML(html) {
    if (!isMirrorMode()) return html;
    return `<div class="dual-cap mirror">${html}</div><div class="dual-cap">${html}</div>`;
}

// ---------------------------------------------------------------------------
// The ⟳ flip button
// ---------------------------------------------------------------------------

function _attachFlip(el) {
    let btn = el.querySelector(':scope > .card-flip-btn');
    if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'card-flip-btn';
        btn.textContent = '⟳';
        btn.title = 'Flip this card for the other player';
        btn.setAttribute('aria-label', 'Flip this card for the other player');
        btn.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            el.classList.toggle('flipped');
            // Using it is the same as reading the note.
            Storage.save(HINT_KEY, HINT_LIMIT);
            _dismissHint();
        });
        el.insertBefore(btn, el.firstChild);
    }
    btn.style.display = '';
}

function _detachFlip(el) {
    const btn = el.querySelector(':scope > .card-flip-btn');
    if (btn) btn.style.display = 'none';
}

// ---------------------------------------------------------------------------
// The first-few-times note
// ---------------------------------------------------------------------------

function _maybeHint(el) {
    const seen = Storage.load(HINT_KEY, 0);
    if (typeof seen === 'number' && seen >= HINT_LIMIT) return;
    Storage.save(HINT_KEY, (typeof seen === 'number' ? seen : 0) + 1);

    let h = document.getElementById('flip-hint');
    if (!h) {
        h = document.createElement('div');
        h.id = 'flip-hint';
        h.className = 'flip-hint';
    }
    h.innerHTML = '<span class="fh-arrow">↑</span>' +
                  '<span>Can\'t read it from your side? Tap <b>⟳</b> to flip the card.</span>';
    // Inside the card, so it turns with it.
    el.appendChild(h);
    h.style.display = 'flex';
    clearTimeout(_hintTimer);
    _hintTimer = setTimeout(_dismissHint, HINT_MS);
}

function _dismissHint() {
    clearTimeout(_hintTimer);
    const h = document.getElementById('flip-hint');
    if (h) h.style.display = 'none';
}

// Testing / new-device affordance: let the note appear again.
export function resetHint() { Storage.save(HINT_KEY, 0); }

// ---------------------------------------------------------------------------
// OWNER tier — the opponent's headline strip
// ---------------------------------------------------------------------------

export function ticker(icon, text) {
    if (!isMirrorMode() || !text) return;
    let t = document.getElementById('opp-ticker');
    if (!t) {
        t = document.createElement('div');
        t.id = 'opp-ticker';
        t.className = 'opp-ticker';
        document.body.appendChild(t);
    }
    t.innerHTML = '<span class="ot-ic"></span><span class="ot-tx"></span>';
    t.querySelector('.ot-ic').textContent = icon || '';
    t.querySelector('.ot-tx').textContent = text;
    // Sit on the opponent's edge of the table, facing them. Player 2 is at the
    // top of the device, Player 1 at the bottom.
    const oppIsP2 = state.activePlayer === 0;
    t.classList.toggle('at-top', oppIsP2);
    t.classList.toggle('at-bottom', !oppIsP2);
    t.style.display = 'flex';
}

export function hideTicker() {
    const t = document.getElementById('opp-ticker');
    if (t) t.style.display = 'none';
}
