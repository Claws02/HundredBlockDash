// ============================================================
// AGE GATE — whether this player may see purchases and ads.
// ============================================================
//
// US state app-store laws (Texas SB 2420, Utah, Louisiana) make the stores
// collect an age range and parental consent, and make developers honour it
// (docs/LAUNCH_PLAN.md §5). The game is fully playable at any age; what a
// minor without consent loses is the shop's buy buttons and the ad button.
//
// The signal comes from the OS (Apple's Declared Age Range API, Google's Play
// Age Signals API) through a native plugin. Until that plugin is installed this
// module answers "allowed", which is correct everywhere the laws do not reach
// and is the one thing to finish before shipping to those states.
//
// Whatever the store says is kept in memory only, used for nothing else, and
// never stored or sent: that is what privacy.html promises.
// ============================================================

let _minorWithoutConsent = false;

/**
 * Ask the OS once at launch. `window.Capacitor.Plugins.AgeSignals` is the
 * expected bridge: { getAgeSignal() → { isMinor: bool, consentGranted: bool } }.
 */
export async function init() {
    const plugin = window.Capacitor?.Plugins?.AgeSignals;
    if (!plugin?.getAgeSignal) return;
    try {
        const r = await plugin.getAgeSignal();
        _minorWithoutConsent = !!(r && r.isMinor && !r.consentGranted);
    } catch (e) { /* no signal: the law applies only where the store supplies one */ }
}

export function allowsPurchases() { return !_minorWithoutConsent; }
export function allowsAds()       { return !_minorWithoutConsent; }
