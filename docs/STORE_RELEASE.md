# Store release — build steps and store answers

This is the checklist for turning the repo into signed iOS and Android builds.
The code side is done (see `RELEASE_AUDIT_2026-09.md` §15). What is left needs
accounts, devices or decisions that live outside the repo.

## 1. One-time setup

```bash
npm install                     # Capacitor 8 + App, Haptics, SplashScreen, StatusBar
npm run build:web               # copies the game into www/ (Capacitor's webDir)
npx cap add android             # creates android/ — commit it
npx cap add ios                 # creates ios/ — commit it (needs a Mac with Xcode)
npm run cap:assets              # cuts every icon and splash size from resources/
```

Then, before every build: `npm run cap:sync`, and open the native project with
`npm run android` or `npm run ios`.

**Decisions to make first**

| Setting | Where | Current value |
|---|---|---|
| App ID / bundle ID | `capacitor.config.json` → `appId` | `com.hundredblockdash.game` (placeholder; it can never change after the first upload) |
| Version | `package.json` and `src/config/Release.js` | `1.0.0` |
| Build number | Xcode (`CURRENT_PROJECT_VERSION`) and `android/app/build.gradle` (`versionCode`) | set per upload |
| iPad support | Xcode → Deployment Info | The UI now scales on tablets (UX-10). If iPad stays on, App Store Connect needs 13″ iPad screenshots |
| Orientation | Xcode / `AndroidManifest.xml` | Allow all. The board asks landscape phones to turn upright; side-on minigames need landscape |
| Support contact | `privacy.html` → `#contact`, and both store listings | not set |

## 1b. Purchases and ads (native setup)

The JS side is in `src/meta/` (`Store.js`, `Ads.js`, `AgeGate.js`) and reaches the
plugins through `window.Capacitor.Plugins`, so `npm install` + `npx cap sync` is
all the wiring the web code needs. On the native side:

**In-app purchases (`@capgo/native-purchases`)**
- iOS: Xcode → target → Signing & Capabilities → **+ In-App Purchase**.
- Android: nothing beyond the plugin (it adds `com.android.vending.BILLING`).
- Create these products in App Store Connect (Features → In-App Purchases) and
  Play Console (Monetize → Products → In-app products) with **exactly** these ids:

  | Product id | Type | Price |
  |---|---|---|
  | `hbd.map.city_circuit` | Non-consumable | $1.99 |
  | `hbd.pack.frontier` | Non-consumable | $1.99 |
  | `hbd.pack.fairground` | Non-consumable | $1.99 |
  | `hbd.pack.citynights` | Non-consumable | $1.99 |
  | `hbd.pack.tableclassics` | Non-consumable | $1.99 |
  | `hbd.bundle.everything` | Non-consumable | $6.99 |
  | `hbd.tickets.500` | Consumable | $0.99 |
  | `hbd.tickets.1200` | Consumable | $1.99 |
  | `hbd.tickets.3500` | Consumable | $4.99 |

  Each needs a display name, description and (Apple) a review screenshot of the
  shop. The ids are permanent (`src/meta/Catalog.js`).
- Test with Apple sandbox testers (Users and Access → Sandbox) and Google
  licence testers (Play Console → Settings → License testing).

**Rewarded ads (`@capacitor-community/admob`)**
- AdMob console: add the iOS and Android apps, create one **Rewarded** ad unit
  each, put their ids in `src/config/Release.js → admobRewarded`, and set
  `adsTesting: false` for store builds.
- iOS `Info.plist`: `GADApplicationIdentifier` = the AdMob iOS **app** id, and the
  `SKAdNetworkItems` list from Google's docs. **Do not** add
  `NSUserTrackingUsageDescription`: the game never asks to track.
- Android `AndroidManifest.xml`:
  `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-…~…"/>`.
- AdMob → Privacy & messaging: create a **GDPR** message and a **US states**
  message. The game shows them through UMP on the first "watch an ad" tap, and
  Settings → Privacy choices reopens them.
- Publish `app-ads.txt` at the root of the developer website listed in both stores.

**Age signals (`AgeGate.js`): still to do.** Texas, Utah and Louisiana require
honouring the store's age range and parental consent. `AgeGate.js` expects a
plugin at `Capacitor.Plugins.AgeSignals` that wraps Apple's Declared Age Range
API and Google's Play Age Signals API; until one is added it allows everything.
That is correct outside those states, and the one code item to close before launch.

## 2. Optional services

| Service | Where | Notes |
|---|---|---|
| Crash reporting | `src/config/Release.js` → `sentryDsn` | Off while empty. If you set it, update the "Crash reports" section of `privacy.html` and the data-safety answers below (crash logs, diagnostics, not linked to identity) |
| TURN relay for online play | `src/config/Release.js` → `turnServers` | Without it, about one network in ten cannot connect phone-to-phone; the lobby now says so after 15 s. Use short-lived credentials if you run your own (coturn), or a hosted TURN service |

## 3. Store privacy answers (as the code stands, no Sentry DSN)

> **Superseded once Phase 4 (IAP + opt-in AdMob ads) lands.** The answers for the
> monetized build are in `LAUNCH_PLAN.md` §4. The ones below hold only for a build
> with no ads.

**Apple — App Privacy ("nutrition label"):** *Data Not Collected.*
Nothing leaves the device except online play, which goes phone to phone. The
signalling relays see an IP address, as any network connection does, but the
developer receives nothing.

**Google Play — Data safety:**
- Does your app collect or share any of the required user data types? **No**
- Is all of the user data collected by your app encrypted in transit? **Yes** (WebRTC is encrypted, DTLS/SRTP)
- Do you provide a way for users to request that their data is deleted? **Not applicable** (no data is collected; clearing app data removes the local save)

**Privacy policy URL:** host `privacy.html` (it ships in the app too) and paste
its public URL into both consoles.

**Age rating:** no chat, no user-generated content shared beyond typed display
names in a private room, cartoon mischief (coin fines, duels). Declare in-app
purchases and (opt-in) advertising in both questionnaires.
Expect 4+ on iOS and Everyone on Google Play.

## 4. Before submission — on real devices

These could not be tested in the build environment (headless Chromium, software GPU):

- [ ] Frame rate on a mid-range Android phone (for example a Pixel 6a) and an older iPhone (iPhone 11): a full City match, noting heat and battery. Check the draw-call cut (RA-03) and the adaptive resolution ladder
- [ ] Battery saver visibly drops shadows and holds 60 fps on the Android phone
- [ ] Android hardware Back: pause opens and closes mid-match; the menus exit the app
- [ ] iOS: swipe the app away mid-match, reopen, and RESUME MATCH restores it
- [ ] Haptics: a light tap on a coin landing, a heavy one on a fine (iPhone)
- [ ] Music respects the iOS silent switch and stops when the app is backgrounded
- [ ] Notch, Dynamic Island and gesture bar: nothing interactive sits under a system inset
- [ ] Online: two phones on different networks (one on mobile data) can join a room
- [ ] Fonts render in Nunito and Bebas Neue in airplane mode
- [ ] Sandbox purchase of a pack, the bundle and a Ticket pack on each platform; prices show in local currency
- [ ] Delete and reinstall: packs/maps come back on launch and via Restore Purchases; Tickets are (correctly) gone
- [ ] Android: a "slow test card" pending purchase unlocks once it completes
- [ ] Rewarded ad (test units): consent form appears first in the EEA (use a VPN or UMP debug geography), the reward lands only after watching to the end, the 6th ad of the day is refused
- [ ] Settings → Privacy choices reopens the consent form; Restore purchases reports correctly
- [ ] Online: a guest without packs plays the host's unlocked minigames; every phone shows everyone's hats

## 5. CI

`.github/workflows/ci.yml` runs on every push and PR: the static sweep
(`qa/parsecheck.sh`), the web build, and `qa/ci-smoke.js` (boot, bundled fonts,
a City match to its first roll). The long probes (`qa/city.js`, `qa/release.js`,
`qa/resume.js` and others) take 5–40 minutes each on a software GPU. Run them
by hand before a release (`qa/README.md`).
