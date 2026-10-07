// ============================================================
// ADS — the one ad the game shows: rewarded, and only when asked for.
// ============================================================
//
// @capacitor-community/admob through `window.Capacitor.Plugins.AdMob`. Nothing
// ad-related runs until the player taps "watch an ad": the SDK is initialised
// and the consent form (Google UMP: GDPR in the UK/EEA/Switzerland, the US
// state-privacy message elsewhere) is gathered on that first tap, never at
// launch. A player who never wants Tickets from ads never meets an ad SDK.
//
// No App Tracking Transparency prompt: we never ask for the iOS advertising
// id, so iOS ads are served without it (privacy.html, LAUNCH_PLAN §4).
//
// `?devstore` simulates a 2-second ad in a browser, for QA.
// ============================================================

import * as Wallet from './Wallet.js';
import * as AgeGate from './AgeGate.js';
import { RELEASE } from '../config/Release.js';

const AD = () => window.Capacitor?.Plugins?.AdMob || null;

// Google's public test units: always fill, never pay. Used while adsTesting.
const TEST_UNITS = {
    ios:     'ca-app-pub-3940256099942544/1712485313',
    android: 'ca-app-pub-3940256099942544/5224354917',
};

let _inited = null;      // Promise once started
let _canRequest = false;
let _privacyRequired = false;
let _busy = false;

function _dev() {
    try {
        return /[?&]devstore\b/.test(location.search) || localStorage.getItem('hbd_devstore') === '1';
    } catch (e) { return false; }
}

function _platform() { return window.Capacitor?.getPlatform?.() || 'web'; }

function _unitId() {
    const p = _platform() === 'ios' ? 'ios' : 'android';
    return RELEASE.adsTesting ? TEST_UNITS[p] : (RELEASE.admobRewarded?.[p] || '');
}

/** Should the shop show the "watch an ad" button at all? */
export function supported() {
    if (!AgeGate.allowsAds()) return false;
    if (_dev() && !AD()) return true;
    return !!AD() && !!_unitId();
}

/** Can one be watched right now? */
export function canWatch() { return supported() && !_busy && Wallet.adsLeftToday() > 0; }

/** Settings shows "Privacy choices" when the SDK is present (and UMP says it applies). */
export function hasPrivacyChoices() { return !!AD(); }

async function _ensure() {
    if (_inited) return _inited;
    _inited = (async () => {
        const ad = AD();
        if (!ad) { _canRequest = _dev(); return; }
        try {
            let info = await ad.requestConsentInfo({ tagForUnderAgeOfConsent: false });
            if (info.isConsentFormAvailable && info.status === 'REQUIRED') info = await ad.showConsentForm();
            _canRequest = !!info.canRequestAds;
            _privacyRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
        } catch (e) {
            console.warn('[Ads] consent failed', e);
            _canRequest = false;
        }
        if (_canRequest) {
            await ad.initialize({
                initializeForTesting: !!RELEASE.adsTesting,
                tagForChildDirectedTreatment: false,
                tagForUnderAgeOfConsent: false,
                maxAdContentRating: 'ParentalGuidance',
            });
        }
    })();
    return _inited;
}

/**
 * Show one rewarded ad. Resolves to { ok, reason? }. Tickets are credited here,
 * and only when the network reports the reward (watching to the end).
 */
export async function watch() {
    if (!canWatch()) return { ok: false, reason: Wallet.adsLeftToday() ? 'unavailable' : 'cap' };
    _busy = true;
    try {
        await _ensure();
        if (!_canRequest) { _inited = null; return { ok: false, reason: 'consent' }; }

        if (!AD()) {   // simulated
            await new Promise(r => setTimeout(r, 2000));
            Wallet.rewardAd();
            return { ok: true };
        }
        const ad = AD();
        let rewarded = false;
        const h = await ad.addListener('onRewardedVideoAdReward', () => { rewarded = true; });
        try {
            await ad.prepareRewardVideoAd({ adId: _unitId(), isTesting: !!RELEASE.adsTesting });
            const item = await ad.showRewardVideoAd();
            if (item && item.amount > 0) rewarded = true;
        } finally {
            h?.remove?.();
        }
        if (!rewarded) return { ok: false, reason: 'skipped' };
        Wallet.rewardAd();
        return { ok: true };
    } catch (e) {
        console.warn('[Ads] rewarded failed', e);
        return { ok: false, reason: 'nofill' };
    } finally {
        _busy = false;
    }
}

/** Settings → Privacy choices. Opens Google's privacy options form. */
export async function openPrivacyChoices() {
    const ad = AD();
    if (!ad) return false;
    try {
        await _ensure();
        await ad.showPrivacyOptionsForm();
        // Re-read: the player may have just withdrawn consent.
        const info = await ad.requestConsentInfo({ tagForUnderAgeOfConsent: false });
        _canRequest = !!info.canRequestAds;
        _privacyRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
        return true;
    } catch (e) {
        console.warn('[Ads] privacy form failed', e);
        return false;
    }
}
