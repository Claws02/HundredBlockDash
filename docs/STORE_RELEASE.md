# Store release — build steps and store answers

This is the checklist for turning the repo into signed iOS and Android builds.
The code side is done (see `RELEASE_AUDIT_2026-09.md` §15). What is left needs
accounts, devices or decisions that live outside the repo.

## 1. One-time setup

```bash
git submodule update --init     # the minigames: src/claw-core is github.com/Claws02/claw-core
npm install                     # Capacitor 8 + App, Haptics, SplashScreen, StatusBar
npm run build:web               # copies the game into www/ (Capacitor's webDir) and minifies it
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

## 2. Optional services

| Service | Where | Notes |
|---|---|---|
| Crash reporting | `src/config/Release.js` → `sentryDsn` | Off while empty. If you set it, update the "Crash reports" section of `privacy.html` and the data-safety answers below (crash logs, diagnostics, not linked to identity) |
| TURN relay for online play | `src/config/Release.js` → `turnServers` | Without it, about one network in ten cannot connect phone-to-phone; the lobby now says so after 15 s. Use short-lived credentials if you run your own (coturn), or a hosted TURN service |

## 2a. Security of the shipped app

- **Content-Security-Policy** (`index.html`): scripts run only from the app's own files. No inline script, no inline event handlers, no `eval`, nothing from another origin. `connect-src` allows `wss:` for the online matchmaking relays. `qa/ci-smoke.js` runs with the policy live and fails if an inline script is allowed to run.
- **Turning on crash reporting needs a policy change.** If `sentryDsn` is set, add the Sentry script host to `script-src` and its ingest host to `connect-src`, or the reporter will be blocked.
- **Online play trusts nobody** (`src/net/NetGuard.js`). A guest pins the host from the first roster and ignores every other peer. Names, rosters, snapshots and mirrored scenes are checked for shape and stripped of markup before they reach the game or the page. Names are also escaped where they are printed.
- **Not covered:** a room code is four characters, so a stranger can still join a room by guessing it and then play as a guest. They cannot run code or act for another seat. A longer code or a host "lock room" button would close that.
- **Build tooling:** `npm audit --omit=dev` is clean. The remaining advisories are inside `@capacitor/assets` (`sharp`, `tar`), which only runs on the developer's machine to cut icons.

## 3. Store privacy answers (as the code stands, no Sentry DSN)

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
names in a private room, no purchases, cartoon mischief (coin fines, duels).
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

## 5. CI

`.github/workflows/ci.yml` runs on every push and PR: the static sweep
(`qa/parsecheck.sh`), the web build, and `qa/ci-smoke.js` (boot, bundled fonts,
a City match to its first roll). It checks out with `submodules: true`,
because the minigames live in `src/claw-core`, a submodule shared with
CLAWGames. The long probes (`qa/city.js`, `qa/release.js`,
`qa/resume.js` and others) take 5–40 minutes each on a software GPU. Run them
by hand before a release (`qa/README.md`).
