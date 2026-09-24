// ============================================================
// CRASH REPORT — know when the shipped game breaks (RELEASE_AUDIT T-02).
// ============================================================
//
// Before this, an uncaught error was a console line on a phone nobody was
// watching. Now every error goes to a short local log (the last 20, readable
// with `hbdDiagnostics()` in a remote-debug session or from a tester's device),
// and — only if RELEASE.sentryDsn is set — to Sentry, with player names scrubbed.
// ============================================================

import { RELEASE } from '../config/Release.js';
import * as Storage from './Storage.js';

const LOG_KEY = 'error_log';
const LOG_MAX = 20;
let _sentry = null;

function _scrub(text) {
    // Player names are the only personal data in the game; they never leave.
    try {
        const names = (window.__hbdPlayerNames || []).filter(n => n && n.length > 1);
        return names.reduce((t, n) => t.split(n).join('<player>'), String(text));
    } catch (e) { return String(text); }
}

function _log(kind, message, stack) {
    const log = Storage.load(LOG_KEY, []) || [];
    log.push({ t: new Date().toISOString(), kind, message: _scrub(message).slice(0, 300), stack: _scrub(stack || '').slice(0, 800), v: RELEASE.version });
    while (log.length > LOG_MAX) log.shift();
    Storage.save(LOG_KEY, log);
}

export function init() {
    window.addEventListener('error', e => _log('error', e.message, e.error?.stack || `${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', e => _log('rejection', e.reason?.message || String(e.reason), e.reason?.stack));
    window.hbdDiagnostics = () => Storage.load(LOG_KEY, []);
    if (!RELEASE.sentryDsn) return;
    const s = document.createElement('script');
    s.src = RELEASE.sentryBundle;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
        if (!window.Sentry) return;
        _sentry = window.Sentry;
        _sentry.init({
            dsn: RELEASE.sentryDsn, release: `hundred-block-dash@${RELEASE.version}`,
            sendDefaultPii: false,
            beforeSend(ev) {
                try { ev.message = ev.message && _scrub(ev.message); (ev.exception?.values || []).forEach(v => { v.value = _scrub(v.value); }); } catch (e) {}
                return ev;
            },
        });
    };
    document.head.appendChild(s);
}
