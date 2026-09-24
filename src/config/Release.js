// ============================================================
// RELEASE — build-time settings for the shipped app.
// ============================================================
//
// Crash reporting is OFF until a DSN is set here. With it empty the game sends
// nothing anywhere; errors are kept in a short local log only (see
// src/core/CrashReport.js and privacy.html). Set it for store builds, and say
// so in the privacy policy and the store's data-safety answers.
// ============================================================

export const RELEASE = {
    version: '1.0.0',
    // e.g. 'https://<key>@o000000.ingest.sentry.io/0000000'
    sentryDsn: '',
    // Pinned Sentry browser bundle, loaded only when sentryDsn is set.
    sentryBundle: 'https://browser.sentry-cdn.com/8.33.1/bundle.min.js',
    // WebRTC relay for online play, for the networks that cannot connect
    // phone-to-phone (RELEASE_AUDIT RA-02). Empty = public STUN only.
    // e.g. [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }]
    turnServers: [],
};
