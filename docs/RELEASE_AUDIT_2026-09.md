# Hundred Block Dash — Release-Readiness Audit (City Circuit)

**Date:** 2026-09-24
**Branch:** `claude/minigames-qa-audit-dty9wd`
**Target:** iOS App Store and Google Play, shipped as a **Capacitor-wrapped web app**
**Status after the fix pass:** every finding with a code fix is implemented. The score is now **72 / 100** (was 52) and the recommendation is **Ready with Minor Fixes, after a device pass**. §15 lists each finding's status and proof; `STORE_RELEASE.md` has the steps that need devices and accounts. Sections 1–14 below are the audit as it was found.
**Scope:** the board game: the City Circuit, the turn loop, camera, HUD and menus, buddies, bounties, the story framing (city briefing, district banners), and audio/visual polish. **Minigames are excluded** (audited separately in `MINIGAME_AUDIT_2026-09.md`).

---

## How this was audited

| Method | What it produced |
|---|---|
| **Instrumented full playthrough** (`qa/auditplay.js`) | A 6-round City match, P1 played through **real pointer taps** on whatever the screen offered, vs a medium bot, at 390×844 (iPhone 14 class). Reached the win screen. Per-frame telemetry: frame time, camera position and rotation rate, camera state, whether the active token was on screen or hidden behind scenery, token step per frame, every game-state beat, every message the player saw, every tap with its target size, and an accessibility scan of each new screen. |
| **First-run playthrough** | The same with storage cleared, so onboarding shows. |
| **Layout sweep** (`qa/auditlayout.js`) | Splash, settings, board HUD, rules, map, items and bounties at 375×667 (iPhone SE), 360×780 (small Android), 430×932 (Pro Max), 768×1024 (iPad), 1024×1366 (iPad Pro) and 844×390 (landscape phone). Overflow, cut-off buttons, text under 12 px, targets under 44 px. |
| **Targeted probes** | Raycast to identify an unexplained on-screen object; `elementFromPoint` on the rules button; the position of the briefing's START button on four screen sizes; a scene census (meshes, materials, lights, shadow casters). |
| **Source review** | Camera, token movement, turn pacing (`SceneTiming.js`), audio, haptics, settings, error handling, persistence, packaging, fonts, the online transport. |
| **Prior audits** | `QA_REPORT.md`, `CITY_CIRCUIT_AUDIT.md`, `TURN_FLOW.md`, `BUDDIES.md`. Issues those fixed are not re-reported. |

**The limits of this environment matter for reading the report.** Everything ran in headless Chromium with a software GPU (SwiftShader), which draws the city at 1–3 frames per second. So **no frame-rate, thermal or battery number in this report is a device measurement**. The performance findings come from the scene census and the code, and are labelled as risks. Touch, haptics, audio and notch behaviour were not tested on hardware. See §12.

---

## 1. Executive summary

The game is **stable and its core loop is sound.** A full six-round match played through real taps finished at the win screen with **zero errors**. It passed through 160 turn beats, every space type the match rolled, a shop, the Gate, a swap, a duel, a buddy, bounties and six minigame hand-offs. Earlier audits already fixed the worst City problems (a dead follow camera, dead contracts, the junction covering the board), and it shows. The turn has a clear shape (roll → hop → land → payoff). Pacing floors keep beats from trampling each other. Token movement keeps a constant ground speed, and the follow camera is frame-rate independent.

What stands between this and a store listing falls into four groups:

1. **It is not yet an app.** There is no Capacitor project, icon set, launch screen, app ID or privacy policy. Nothing handles the app lifecycle: backgrounding does not pause the match, the board has no WebGL context-loss recovery, a match cannot be saved or resumed, and on Android the hardware Back button will simply close it. On iOS, where the OS routinely suspends backgrounded apps, every interrupted match is lost.
2. **The board is expensive to draw.** The City scene has **2,189 separate meshes, 1,277 unique materials, 1,007 shadow casters and 17 lights, with no instancing**. That is roughly 3,000 draw calls a frame, at a fixed pixel ratio of up to 2 and with no adaptive quality. Mid-range Android phones and older iPhones are the likely casualties: low frame rate, heat and battery drain. It could not be measured on a device here, but the numbers are well past a comfortable budget for a phone WebView.
3. **Several first-impression screens are broken in small, visible ways:**
   - The first match's START button is below the fold on every phone.
   - Every match makes you sit through a 9-second flyover and a page of lore.
   - The turn banner tells you "waiting on them" on your own turn.
   - The in-game rules button is dead during your turn.
   - The win screen comes up sideways on a phone held upright.
4. **Polish and identity gaps a reviewer or player will notice:**
   - The bot is named "Borat the Bot", which is an IP risk.
   - Offline, all text falls back to a serif (Times) font.
   - Audio is synthesised beeps, with no music and no ambience.
   - There are no haptics on iPhone.
   - The city has no moving traffic or people.
   - The iPad and landscape layouts are unscaled or crowded.
   - The Reduce Motion setting does not reach the 3D camera.

None of these is deep. Most of the UI items are one-line or one-function fixes, and **ten of them are fixed in this branch** (§13). Packaging, the privacy policy, audio content and the rendering-cost work are the real schedule items.

## 2. Overall readiness score

## **52 / 100**

| Area | Score | Notes |
|---|---:|---|
| Stability and correctness | 9 / 10 | Zero errors or soft-locks over a full match; state machine sound |
| Core gameplay loop | 7 / 10 | Clear, readable, well paced; decisions at junctions matter |
| Controls and responsiveness | 6 / 10 | ROLL and junction work well. The rules button is dead on your turn, and swipe hints sit over the play |
| City flow and environment | 5 / 10 | Legible ring-and-districts structure, but a static city: no traffic, occluding alleys, glitch-like junction markers |
| Camera | 5 / 10 | Smooth follow, but hard 60-unit / 160° cuts, landings that frame the ground, and no Reduce Motion |
| UX and onboarding | 4 / 10 | Text-wall onboarding, START below the fold, sideways win screen, no pause, stale copy |
| Visual and audio polish | 4 / 10 | Distinctive toy-town art, but serif fallback offline, beeps only, no music |
| Performance and technical | 3 / 10 | ~3,000 draw calls a frame, no lifecycle handling, no crash reporting (device-unverified) |
| Accessibility and mobile usability | 4 / 10 | 66 text elements under 12 px, zoom disabled, motion setting partial, iPad and landscape unscaled |
| Store compliance | 2 / 10 | No packaging, no privacy policy, IP-risk name, online uses public relays undisclosed |

## 3. App-store release recommendation

## **Not Ready**

This is not "High Risk". The game does not crash and its loop works, so the remaining work is predictable. But it cannot be submitted as it stands, because packaging and a privacy policy are store prerequisites. It should also not ship before the lifecycle and rendering-cost items are dealt with: those are what produce one-star "lost my game" and "my phone got hot" reviews in week one.

**Path to "Ready with Minor Fixes":**

1. Capacitor packaging with the lifecycle work (§4: RA-01, RA-02, RA-04).
2. The rendering budget (RA-03), measured on two real devices.
3. Rename the bot (RA-05, done here).
4. The Major UX items in §8; five of them are done here.

With those, the score lands in the mid-70s.

---

## Reading the findings

Each finding uses this shape:

> **ID · Title** — Severity · *Location*
> **Problem.** … **Expected:** … **Actual:** … **Repro:** … **Effect:** … **Fix:** … **Verify:** …

**Severity scale:**

| Severity | Meaning |
|---|---|
| **Blocker** | Cannot ship or submit |
| **Critical** | Likely rejection, data loss, or widespread bad reviews |
| **Major** | Visibly hurts the experience for many players |
| **Minor** | Noticeable, limited impact |
| **Polish** | Finish |

Items marked **✅ Fixed in this branch** were changed and verified; see §13.

---

## 4. Critical release blockers

> **RA-01 · There is no app package** — **Blocker** · *repository root*
> **Problem.** The repo is a static site. It has no `capacitor.config`, no `ios/` or `android/` projects, no app icon set (1024 px iOS plus Android adaptive icons), no launch screen, no bundle ID, version or build numbers, and no web manifest.
> **Expected:** a buildable Capacitor project that produces signed builds.
> **Actual:** none.
> **Effect:** nothing can be submitted.
> **Fix:**
> - `npm init` + `@capacitor/core`, `@capacitor/ios`, `@capacitor/android`.
> - `webDir: "."`, or copy `index.html`, `css`, `src`, `vendor` and `assets` into `www/`.
> - Icons and a launch screen with `@capacitor/assets`.
> - Set `ios.contentInset: "never"` and handle safe areas in CSS (§11).
> - Lock iPhone to portrait for the board but allow landscape (see UX-09), or implement per-screen orientation with `@capacitor/screen-orientation`.
> **Verify:** release builds install and launch on one iPhone and one Android device, go through airplane mode on first launch, and pass TestFlight and Play internal-testing processing.

> **RA-02 · No privacy policy; the online mode's data flow is undisclosed** — **Blocker** · *`src/net/NetTransport.js`, store listings*
> **Problem.** Both stores require a privacy policy URL and data-safety or privacy-label answers. Online play finds peers through **public Nostr relays or BitTorrent trackers** (Trystero) and then connects phone to phone over WebRTC, which exposes each player's IP address to third-party relays and to the other players. There is no TURN server, so by the code's own estimate about one network in ten cannot connect.
> **Expected:** a policy and store answers that describe this, and an online mode that degrades clearly.
> **Actual:** no policy. A failed connection shows only a generic lobby state.
> **Effect:** submission is rejected or held. A misdeclared privacy label is a removal risk. The failed-connection rate yields "online doesn't work" reviews.
> **Fix:**
> - Write the policy: local-only stats and settings, and for online play, the IP address shared with relays and peers.
> - Answer the labels accordingly: "Data not collected" is only true if the IP exposure is disclosed as third-party.
> - Add a TURN fallback (paid or self-hosted), or label online as "same Wi-Fi recommended".
> - Show a specific error after 15 s without a peer.
> **Verify:** policy URL live. Two phones on different carriers (cellular) connect, or show the specific error.

> **RA-03 · The board is ~3,000 draw calls a frame, at a fixed pixel ratio of 2** — **Critical** · *`src/engine/Renderer.js` (whole scene)*
> **Problem.** Scene census at a normal turn (`qa`, scene probe):
> - 2,189 visible meshes, 0 instanced, and 1,277 unique materials.
> - 1,007 meshes cast shadows into a shadow map, so they are drawn a second time.
> - 17 lights, meaning a heavy fragment shader on every standard material.
> - 66k triangles, which is modest; the cost is in call count, not geometry.
>
> The board renderer is created with `setPixelRatio(min(dpr, 2))` and never adapts. The minigame stage already steps its resolution down under load; the board does not.
> **Expected:** on a mid-range phone, under about 500 draw calls, a single shadow light with a short caster list, at most 4 dynamic lights, adaptive resolution, and a steady 60 fps or a deliberate 30.
> **Actual:** about 3,000 calls. Frame rate on devices is unmeasured here, since the software GPU runs at 1–3 fps for everyone.
> **Effect:** likely low frame rate, heat and battery drain on mid and low Android and on iPhones older than about the 12; the lower-end devices may also crash from memory pressure. This is the classic source of 1–2-star reviews and "app not responding" (ANR) warnings.
> **Fix (in order of return):**
> 1. Adaptive pixel ratio on the board, the same ladder as `Stage.js` (2 → 1.5 → 1). ✅ **Fixed in this branch:** on a DPR-2 context with long frames it stepped 2 → 1 in two drops.
> 2. Shadows only on tokens, dice and large buildings. ✅ **Fixed in this branch:** small props no longer cast shadows; measured **1,007 → 372** shadow casters.
> 3. Merge static scenery per material with `BufferGeometryUtils.mergeBufferGeometries`, and use `InstancedMesh` for repeated props (trees, lamps, bollards, windows, parked cars).
> 4. Collapse the material set, since most of the 1,277 are duplicate colour variants.
> 5. Cap point lights at 4 and bake the rest into emissive colour.
> 6. A "Graphics: Battery saver" toggle that turns off shadows and caps DPR at 1.
> **Verify:** on a Pixel 6a–class Android and an iPhone 11, record 5 minutes of play. The target is p95 frame time under 20 ms and no thermal-throttle warning. Also log `renderer.info.render.calls` at a normal turn and aim for under 600.

> **RA-04 · No app-lifecycle handling: no pause, no resume, no context-loss recovery, Back exits** — **Critical** · *`src/main.js`, `src/core/Director.js`, `src/engine/Renderer.js`*
> **Problem:**
> - Nothing pauses the match when the app goes to the background. Turn pacing runs on `setTimeout` (`Director.js`), so bot turns keep advancing unseen.
> - The board's WebGL context has no `webglcontextlost` handler, and iOS drops WebGL contexts under memory pressure and on background. Only the minigame stage handles it.
> - A match is never saved: `Storage` holds only prefs, stats and settings.
> - There is no pause menu or quit-to-menu mid-match, and Settings is reachable only from the splash.
> - In a Capacitor Android build, the hardware Back button exits the app, since there is no history to pop.
> **Expected:**
> - Backgrounding pauses the match, and returning offers "Resume".
> - A lost context recovers, or reloads into the saved match.
> - A pause button gives Resume / Settings / How to play / Quit.
> - Back opens that menu.
> **Actual:** play continues while hidden. A lost context leaves a black or frozen board. There is no pause UI. Back closes the app and loses the match.
> **Repro:**
> - (a) Start a City match, switch apps for 30 s during the bot's turn, and return: the bot has played on.
> - (b) Android build: press Back during a turn and the app exits.
> **Effect:** lost matches, which is the most common cause of angry reviews for turn-based mobile games.
> **Fix:**
> 1. ✅ **Fixed in this branch:**
>    - A HUD ⏸ button and pause menu (Resume / Settings / How to play / Quit to menu).
>    - `Director.pause()`/`resume()` hold every scheduled beat.
>    - The board render loop freezes animations while paused.
>    - It auto-pauses on `visibilitychange` → hidden.
>    - The board renderer handles `webglcontextlost` with a "The display was reset — TAP TO CONTINUE" screen instead of a black board. The tap reloads the game, so the match itself is still lost until autosave exists.
>    - Back (`popstate`) opens the pause menu.
> 2. Still to do: autosave the match state after each turn (`state` is plain data plus a board graph) and offer "Resume match" on the splash. In the Capacitor build, wire `@capacitor/app` `backButton` and `appStateChange` to the same pause.
> **Verify:** `qa/release.js` pauses during the bot's turn, checks nothing changes for 6 s, checks play continues after RESUME, and checks that a hidden page and Back both open the pause menu. On devices: background for 60 s during a bot turn, return, and the match is still on that turn. On Android, Back opens the pause menu.

> **RA-05 · "Borat the Bot"** — **Critical** · *`src/config/GameConfig.js` `BOT_NAMES`, `src/core/Bot.js`*
> **Problem.** The default bot, which is the opponent in every 1-player match, is named after a well-known film character. Review guidelines on third-party IP (Apple 5.2, Google's IP policy) make this a rejection and takedown risk. This is not legal advice; a lawyer should confirm any borderline names.
> **Expected:** original names.
> **Actual:** "Borat the Bot" on the HUD, in toasts, on the win screen and in the splash record ("Record vs Bot").
> **Fix:** ✅ **Fixed in this branch.** Renamed to "Bolt the Bot"; the other seats stay "Nadia the Nav" and "Klaus the Cog".
> **Verify:** `grep -ri borat src` finds nothing. `qa/release.js` reads the rival bar in a 1P match.

> **RA-06 · Fonts come from Google at runtime; 101 declarations have no fallback, so offline the whole game renders in a serif** — **Major** (release-visible) · *`index.html:14`, `css/styles.css`, inline styles*
> **Problem.** Bebas Neue and Nunito load from `fonts.googleapis.com`. There are 71 `font-family: 'Nunito'` and 30 `font-family: 'Bebas Neue'` declarations with no fallback family, so when the request fails the browser uses its default serif (Times). This environment has no Google Fonts access, and every screenshot in this audit shows it: "SELECT PLAY MODE", the duel sheet, the shop prompt, the map sheet, the bounty text.
> **Expected:** fonts bundled in the app and correct offline.
> **Actual:** a network dependency on first launch, with a serif fallback.
> **Effect:** a Capacitor app launched offline, or in a region that blocks Google, looks broken. Reviewers do test in airplane mode.
> **Fix:** ✅ **Fixed in this branch.** A global fallback stack now applies wherever these fonts are named: Bebas Neue falls back to Oswald, Arial Narrow and Impact; Nunito falls back to system-ui and sans-serif. Still to do: bundle the two OFL font files under `assets/fonts/` with `@font-face`, and delete the Google link. This environment could not download them.
> **Verify:** airplane mode on first launch, with no serif text anywhere. `qa/release.js` asks Chromium (via DevTools `CSS.getPlatformFontsForNode`) which platform font actually rendered the splash text with Google Fonts unreachable.

---

## 5. Gameplay and controls findings

**Core loop assessment.** Roll, hop, land and resolve is clear, and on City the junction choice makes the board a decision rather than a track: district versus ring, risk versus steady coins. The loop gets its variety from items, bounties, buddies, the Gate and duels, and its pacing floors (`SceneTiming.js`) keep the payoff readable. Turn cost works out to roughly 9–11 s per board turn, so a 6-round two-player match is about 10 minutes of board play plus minigames, which matches the "~15 min" label. Rolling is responsive: tap ROLL or swipe up, the dice fly within 220 ms and hold 1.5 s for the read. Junction arrows are clear, and each is labelled with spaces and risk. Item use, shops and buddies all worked end-to-end through real taps.

> **G-01 · The rules button is dead during your turn** — **Major** · *board HUD, top right ❓* — ✅ **Fixed in this branch**
> **Problem.** `#swipe-zone` (`z-index: 15`, covering the whole board area during PRE_ROLL) sits on top of `#btn-rules` (`z-index: 12`). `elementFromPoint` at the button's centre returns `swipe-zone`, and a real tap leaves the rules overlay at `display: none`. The button is also 38×38 px, under the 44 pt minimum.
> **Expected:** the rules open whenever the button is visible.
> **Actual:** they cannot be opened on your own turn, which is exactly when you'd want them.
> **Repro:** start a City match, and on "YOUR TURN" tap ❓. Nothing happens.
> **Effect:** in-game help is unreachable, and the button reads as broken.
> **Fix:** raise the rules button above the swipe zone and make it 44×44.
> **Verify:** `qa/release.js` taps ❓ at PRE_ROLL with a real pointer and asserts the rules sheet opens.

> **G-02 · Your own turn banner says "waiting on them"** — **Major** · *turn banner, 1P and pass-and-play* — ✅ **Fixed in this branch**
> **Problem.** `isMySeat()` is only true in online play (`state.localSeat`), so in 1P and pass-and-play the human's own banner takes the "not me" branch. Captured on screen: "💧 PLAYER 1 · WAITING ON THEM" at the human's first turn.
> **Expected:** "PLAYER 1 · YOU · YOUR TURN — roll the dice".
> **Actual:** "waiting on them".
> **Effect:** at the one moment the game tells you it's your move, it says the opposite.
> **Fix:** off the network, any human seat is "me" when it is active.
> **Verify:** `qa/release.js` records every turn banner and checks P1's.

> **G-03 · The swipe hint is drawn over the tokens every turn** — **Minor** · *board, PRE_ROLL*
> **Problem.** "👆 SWIPE UP OR TAP ROLL" at 36 px, 40 % white, sits in the middle of the swipe zone, which is where the camera puts your token.
> **Expected:** a hint that stops after the player has rolled a few times, placed away from the token.
> **Actual:** it shows every turn for the whole match, covering the token.
> **Fix:** show it for the first 3 human rolls per install (a `Storage` counter), anchored above the ROLL button.
> **Verify:** after 3 rolls the hint no longer appears.

> **G-04 · The board can't be touched on your turn** — **Minor** · *PRE_ROLL*
> **Problem.** The swipe zone swallows every tap on the board, so there is no tap-a-tile-for-info except inside MAP.
> **Fix:** treat a short tap (under 150 ms, under 10 px of movement) on the swipe zone as a raycast "inspect" that opens `#space-info-card`.
> **Verify:** tapping a tile during PRE_ROLL shows its card, and a swipe still rolls.

> **G-05 · Rematch and Main Menu reload the whole app** — **Minor** · *win screen*
> **Problem.** `rematch()` and `mainMenu()` call `location.reload()`: a blank flash, the engine rebuilt, and fonts refetched. In a native wrapper this reads as a crash-and-restart.
> **Fix:** tear down with `Renderer.cleanup()`, `Director.reset()` and state reset, then show the splash, without a reload.
> **Verify:** rematch with no white flash, and the scene census returns to its first-match count.

## 6. City-circuit and environmental-flow findings

**How the circuit reads.** The layout is a 20-space ring road with four district loops (Financial 10 spaces, Back Alley 12, Promenade 10, Industrial 8 behind the Gate). It is easy to understand once seen, and each district has a strong identity of palette, props and lore. It reads more as a **toy city board** than a functioning city. The roads are clean arcs, and nothing moves on them except the players. The ambient life is steam, neon flicker, tickers and beacons, but there are no cars, buses, trams or pedestrians. The districts are dressed up to the road edge, which is where the camera problems below come from.

> **C-01 · A city with no traffic or people** — **Major** · *all districts*
> **Problem.** The ambient systems are `beacon`, `neon`, `steam`, `ticker`, `motes`, `windmill` and `devil`. The cars are parked, and there is no moving vehicle or figure.
> **Expected:** a city that feels active.
> **Actual:** a still diorama.
> **Effect:** "functioning city" is the stated fantasy, and stillness undercuts it on every turn.
> **Fix:** one `InstancedMesh` of about 12 low-poly cars looping on a spline just outside the ring (never on player roads), plus 20–30 pedestrian billboards or instanced capsules drifting along district pavements. Pause both off-screen, and stop them under Battery saver. Budget: 2 draw calls.
> **Verify:** census +2 calls. A 60 s capture shows movement in frame at every district.

> **C-02 · Junction markers look like a rendering glitch** — **Minor** · *each fork (bp_a–bp_d)* — ✅ **Fixed in this branch**
> **Problem.** Each fork has an unlabelled gold sphere, 1.8 units in radius with emissive 1.5, sitting on the road. Near the start the camera is right on top of one, so a bright yellow blob fills the bottom-centre of almost every opening frame. A raycast through that point returns `SphereGeometry r=1.8` at (0, 0.5, −32), which is junction `bp_a`.
> **Expected:** a readable fork signpost.
> **Actual:** a blown-out ball.
> **Fix:** replace it with a flat glowing ring decal on the road plus a low signpost; the decal radius is 1.6 at y 0.06.
> **Verify:** screenshot of the first turn with no blob.

> **C-03 · Back Alley walls and bunting fill the camera** — **Major** · *Back Alley (ba_0…ba_11)*
> **Problem.** (An occluder-fade pass, `_fadeOccluders`, already exists, which is why only 2 % of follow samples were fully hidden.) The alley's buildings and strung washing stand at the road edge, higher than the camera's 26-unit follow height on bends. Screenshots at landing and rolling show two-thirds of the frame taken up by a brick wall or bunting. Telemetry recorded occlusion samples at ba_0 and ba_10.
> **Expected:** the token and the road ahead visible.
> **Actual:** walls across most of the frame.
> **Fix:**
> - Pull alley façades back 2 units from the road on the camera side.
> - Or fade occluders: raycast camera → token each frame and set the hit mesh's material opacity to 0.25.
> - Raise the bunting above 30 units, or clip it on the camera side.
> **Verify:** occlusion telemetry under 1 % of follow samples inside the district.

> **C-04 · Every district entry shows a paragraph of lore** — **Minor** · *realm banner*
> **Problem.** Entering a district shows a banner with 30+ words of prose, for example "Wet black brick, neon in six languages, steam off the grates…". It is written well, but it appears every time, mid-turn.
> **Fix:** full lore the first time per install, then only the district name and its one-line rule ("Traps, duels & swaps").
> **Verify:** second entry shows the short form.

> **C-05 · The map view is not a city overview** — **Major** · *MAP button*
> **Problem.** MAP opens a low, perspective shot near the player, under a bottom sheet that covers about 45 % of the screen. The sheet's text is 9–11 px, and in fallback serif offline. The whole city is never on screen at once, so "scout the map" at a junction does not answer "where do these roads go?".
> **Expected:** a top-down whole-circuit view with district labels, both tokens, the Star and bounty targets, and a compact sheet.
> **Actual:** a street-level peek.
> **Fix:** open the map at a fitted overhead (camera y ≈ 150, looking straight down, distance fitted to the circuit's bounds and the aspect ratio). Collapse the sheet to a 64 px strip, and let the player pinch to zoom in.
> **Verify:** the map screenshot shows all four districts and both tokens on 375×667 and on 1024×1366.

> **C-06 · A token was not in frame when a landing result appeared** — **Major** · *landing (ACKNOWLEDGE)*
> **Problem.** At the first landing in the playthrough (Back Alley entry, ba_0) the result screen framed a ground plane and a tower, with no token and no board. Across the whole match the active token was off-screen in 4 % of follow samples and hidden behind scenery in 2 %.
> **Expected:** the landing always framed on the token.
> **Actual:** occasional empty frames.
> **Fix:** at LAND_ARRIVE, if the token projects outside the centre 60 % of the view, snap the follow pose (a short ease, see CAM-01) before the result card shows. The same occlusion fade as C-03 applies.
> **Verify:** the telemetry's off-screen samples at 0 during ACKNOWLEDGE.

## 7. Movement and animation findings

Token movement is in good shape. Hops keep a constant ground speed (0.28–0.9 s by distance), orientation follows the graph instead of the jittering mesh, and the dice are thrown away from the camera. The swap set piece (a saucer abduction, about 5.9 s) is the best animated moment on the board. The telemetry flagged one token step of 10.6 units in a single frame. At the 151 ms frame it happened on, that is an ordinary hop squeezed into one sample, so it is **not confirmed** as a teleport.

> **M-01 · There are no idle or reaction animations for tokens on the board** — **Polish** · *board tokens*
> **Problem.** The minigame stage has a full animator (idle, walk, victory, defeat, flinch). Board tokens are static meshes that only hop. They do not react to coins, fines, traps, being swapped or winning a duel.
> **Fix:** reuse `CharacterRig`/`CharacterAnimator` on the board for the two active tokens only (budget: a few more draw calls): idle bob, a victory hop on coins, a flinch on a fine.
> **Verify:** a visual check on each result type.

> **M-02 · Rematch flashes white** (see G-05) — **Minor**.

## 8. Camera findings

**Good:** the follow camera is frame-rate independent (a damped half-life, not a per-frame lerp). Heading comes from the board graph, so it doesn't swing with each hop's arc. Junctions lift to an overhead that shows both roads, and the camera aims down the chosen road before the token sets off. Median follow rotation was a calm 34°/s at p95.

> **CAM-01 · Hard camera cuts of up to 60 units and 160° in one frame** — **Major** · *turn hand-over, post-event (swap, gate, magnet)*
> **Problem.** `CAM_CUT = 40`: beyond 40 units of catch-up the camera jumps rather than eases. The playthrough logged cuts of 60 u / 161° (at PRE_ROLL, turn hand-over), 34 u / 152° (Gate opened), 61 u / 139°, 45 u / 112° and 41 u / 102°: about 8 per 6-round match.
> **Expected:** a quick, readable move.
> **Actual:** an instant cut across the city, with no fade, which disorients and is a known motion-comfort trigger.
> **Fix:** ✅ **Fixed in this branch.** A large gap now runs a short eased transition instead of a cut: 0.6 s, with an ease-in-out on both position and heading and a lift of 12 units at the midpoint so the move reads as a pan over the city. Under Reduce Motion it is a 0.22 s move with no lift.
> **Verify:** `qa/release.js` throws the camera's target 60 units and checks that no single frame covers half the distance and that the move spans at least 3 frames. Measured: 59.4 units over 6 frames, the largest a 21-unit frame (it was 60 units in one).

> **CAM-02 · The FOV is fixed at 50° vertical, so the horizontal view varies 3× by device** — **Minor** · *`Renderer.init`*
> **Problem.** On a 390×844 phone the horizontal FOV is about 24°, against about 90° on a 844×390 landscape phone. Tall phones see a narrow slice. At junctions the side roads fall off-screen on narrow devices.
> **Fix:** keep a *horizontal* FOV of at least 38°: `camera.fov = max(50, 2·atan(tan(19°)/aspect))`, recomputed on resize.
> **Verify:** at a junction on 360×780 both roads' first nodes project inside the view.

> **CAM-03 · Reduce Motion does not reach the 3D camera** — see A-01.

## 9. UI and user-experience findings

> **UX-01 · The first match's START button is below the fold on every phone** — **Major** · *City briefing sheet* — ✅ **Fixed in this branch**
> **Problem.** The briefing lists five routes with lore and ends in START THE MATCH. Measured positions:

> | Screen | Button top | Viewport height | Sheet scroll height / visible |
> |---|---:|---:|---:|
> | 375×667 (iPhone SE) | 1004 | 667 | 1104 / 598 |
> | 390×844 (iPhone 14) | 984 | 844 | 1075 / 758 |
> | 430×932 (Pro Max) | 931 | 932 | — |
> | 844×390 (landscape) | 790 | 390 | 904 / 349 |

> The sheet scrolls, but nothing says so.
> **Expected:** the primary action always visible.
> **Actual:** a first-time player sees five cards of lore and no way forward. The automated player itself got stuck here twice.
> **Fix:** pin START and TOUR in a sticky footer, and let the list scroll above them.
> **Verify:** `qa/release.js` checks the button is inside the viewport at all four sizes, then taps it without scrolling.

> **UX-02 · Every new match plays a 9 s unskippable flyover and the full briefing** — **Major** · *match start* — ✅ **Fixed in this branch** (skip)
> **Problem.** `FLYOVER_CITY = 9000`, and it can't be skipped by tapping. The briefing then reappears for every non-rematch match, forever.
> **Expected:** skippable, and short on repeat plays.
> **Actual:** about 9 s of flyover plus a read-and-scroll, every time.
> **Fix:** a tap during the flyover jumps to its end. From the second City match on, the briefing opens collapsed: the headline, the five route chips and START. Still to do: a "Don't show again" option.
> **Verify:** `qa/release.js` taps 1.5 s into the flyover; the briefing appeared **915 ms** later (the flyover alone is 9,000 ms of game time).

> **UX-03 · The onboarding is a 7-slide text wall with stale copy** — **Minor** · *How to Play* — ✅ copy **fixed in this branch**
> **Problem:**
> - It says "a **shortcut**", but City removed shortcut spaces.
> - It says "for **1–2 players**", but the game seats 1–4 plus online.
> - It says "Most coins after **20 rounds**", but the default is 12 (6/12/20).
> - "LET'S GO ✓" wraps to two lines at 390 px.
>
> Beyond the copy, the tutorial teaches by reading, not by playing.
> **Fix:** correct the copy (done). For release, replace slides 2–5 with a **coached first turn**: highlight ROLL, then the junction arrows, then the result card, each with one line. Keep "How to play" as the reference.
> **Verify:** a first-run screenshot sequence, and a copy grep for "shortcut", "1–2 players" and "20 rounds".

> **UX-04 · The win screen is sideways on a phone held upright** — **Major** · *win screen* — ✅ **Fixed in this branch**
> **Problem.** `.win-inner` is rotated 90° in CSS unconditionally ("Landscape by default"), with a small 31×99 px ROTATE toggle. On every portrait phone the match's payoff screen appears on its side.
> **Expected:** upright in the orientation the phone is held.
> **Actual:** sideways until the player finds ROTATE.
> **Fix:** start upright whenever `innerHeight > innerWidth`, except in TABLETOP, where the rotated read was the design (phone flat between two players). ROTATE flips either way.
> **Verify:** `qa/winscreen.js` (updated: it used to assert the sideways default) and `qa/release.js` check that a 1P match on a phone held upright opens upright.

> **UX-05 · The top rival bar wraps at 390 px, and a "YOUR TURN" pill appears on the bot's bar** — **Minor** · *top HUD*
> **Problem.** "BORAT THE / BOT", "YOUR / TURN" and "City Ring / Road" each wrap to two lines. The pill on the bot's bar says "YOUR TURN" during the bot's turn.
> **Fix:** `white-space: nowrap` with an ellipsis on the name. Change the pill copy to "THEIR TURN", or show the bot's name.
> **Verify:** 360×780 screenshot with a single-line bar.

> **UX-06 · The bounty pills are clipped at the right edge** — **Minor** · *contracts strip*
> **Problem.** The third pill, for example "Land on a Mystery space +…", runs past the viewport with no scroll affordance.
> **Fix:** make the strip horizontally scrollable with an edge fade, or wrap to two rows.
> **Verify:** at 375 px the last pill is fully visible or visibly scrollable.

> **UX-07 · Copy defects** — **Polish** · *toasts* — ✅ **Fixed in this branch** (plurals)
> **Problem:**
> - "Pulled **1 coins**", "bet **1 coins**", "+1 coins": no singular form.
> - "⚔️ Ante up! +3 coins to bet with." toasted twice for one landing.
> - Two unrelated events were merged into one toast ("⚙️ Passed Power Plant — +15 coins! ⚔️ Ante up! …").
>
> **Fix:** a `coins(n)` helper for plurals (done). Deduplicate identical toasts within 2 s, and queue rather than concatenate.
> **Verify:** a grep for `${n} coins` in templates, and a toast log without duplicates.

> **UX-08 · The splash is cut off on small phones** — **Minor** · *375×667*
> **Problem.** The title is clipped at the top, and HOW TO PLAY and SETTINGS are below the fold (rects at y = 657 on a 667 screen).
> **Fix:** compress the title with `clamp()`, and put the secondary buttons in a row that always fits.
> **Verify:** layout sweep with `cut: 0` on the splash at 375×667 and 844×390.

> **UX-09 · There is no landscape layout for the board** — **Major** · *844×390*
> **Problem.** The HUD bars take about 40 % of the height. The action column overlaps the rival bar and covers the ❓ button. The briefing needs 2.6 screens of scrolling. The app cannot simply lock to portrait, because the side-on minigames need landscape.
> **Fix:** decide per screen. Either a landscape board layout (side rail HUD, action buttons in a bottom-right cluster, bars merged into one 40 px strip), or an explicit "Rotate to portrait" prompt on board screens while landscape stays allowed for side-on minigames.
> **Verify:** layout sweep at 844×390 with no overlap and no cut buttons.

> **UX-10 · The iPad UI is unscaled** — **Major** if iPad is supported · *768×1024, 1024×1366*
> **Problem.** HUD, buttons and text stay at phone pixel sizes: small islands in a big screen. The splash menu occupies the middle third.
> **Fix:** either ship iPhone-only (`UIDeviceFamily = 1`; the app then runs in compatibility mode on iPad), or scale the HUD with a root `font-size` / CSS `zoom` step at 700 px and above.
> **Verify:** iPad screenshots at the 13″ size, which App Store Connect requires if iPad is supported.

> **UX-11 · No pause, quit or settings during a match** — see RA-04 (✅ pause menu added).

## 10. Visual and audio findings

**Visual identity is a strength.** The low-poly toy city is coherent, every district has its own palette and props, and the character roster is charming.

> **VA-01 · Audio is synthesised beeps only: no music, no ambience** — **Major** · *`AudioManager.js`*
> **Problem.** Every sound is an oscillator or noise burst: `_beep()` and `_noise()`. There is no music track, no district ambience (traffic hum, market chatter, alley drips) and no sampled SFX.
> **Expected:** a store-grade game has a theme, district ambience and a few signature sounds (dice, coins, fanfare).
> **Actual:** functional feedback that sounds like a prototype.
> **Effect:** audio is a large part of how "finished" a mobile game feels, and store reviewers notice.
> **Fix:** license or commission a menu theme, a board loop with a per-district stem and a win sting, plus ~15 sampled SFX (dice, coin, fine, trap, swap, gate, buddy). Duck the music under sfx, add a separate Music slider in Settings, and respect the iOS silent switch (Capacitor native audio or `AudioContext` category).
> **Verify:** Settings has separate Music and SFX sliders. Muting music leaves sfx playing.

> **VA-02 · No haptics on iPhone** — **Minor** · *`AudioManager.haptic()`*
> **Problem.** Haptics call `navigator.vibrate`, which iOS WebViews do not implement, so every "haptic" is silent on iPhone.
> **Fix:** in the Capacitor build, route `haptic()` through `@capacitor/haptics` (`impact` light, medium or heavy by pattern length), keeping `navigator.vibrate` for web.
> **Verify:** on an iPhone, a coin landing gives a light tap and a fine gives a heavy one.

> **VA-03 · Serif fallback text** — see RA-06 (✅ fallback fixed).

> **VA-04 · Junction blob** — see C-02 (✅ fixed).

> **VA-05 · Dark scrims hide the board during prompts** — **Polish** · *shop-nearby, duel, messages*
> **Problem.** Modal prompts dim the board to near-black, so you lose sight of where you are for a yes/no question.
> **Fix:** use a 55 % scrim for small prompts, or turn them into bottom sheets over a visible board.

## 11. Performance and technical findings

> **T-01 · Board rendering cost** — see RA-03 (**Critical**; adaptive DPR and shadow pruning ✅ fixed, merging and instancing still to do).

> **T-02 · No crash or error reporting** — **Major** · *`src/main.js`*
> **Problem.** `error` and `unhandledrejection` are only `console.error`ed. After release you will not know it crashed.
> **Fix:** add Sentry (or Firebase Crashlytics through Capacitor) with source maps, sample 100 % in the first month, and scrub player names. Disclose it in the privacy policy (RA-02).
> **Verify:** a test exception from a TestFlight build shows up in the dashboard.

> **T-03 · WebGL context loss on the board** — see RA-04 (✅ recovery handler added).

> **T-04 · Safe areas are handled in two places only** — **Major** · *CSS*
> **Problem.** `env(safe-area-inset-*)` appears twice in `styles.css`, and `index.html`'s viewport lacks `viewport-fit=cover`. In a Capacitor build with an edge-to-edge WebView, the notch or Dynamic Island will cover the top rival bar, and the home indicator will overlap the P1 bar and ROLL.
> **Fix:** ✅ **Fixed in this branch.** `viewport-fit=cover` is added, and the HUD bars, action column and full-screen sheets are padded with `env(safe-area-inset-*)`.
> **Verify:** on an iPhone 15 (Dynamic Island) and an Android phone with gesture navigation, nothing interactive sits under a system inset.

> **T-05 · Online connections: no TURN, public signalling** — see RA-02.

> **T-06 · No CI** — **Minor** · *repo*
> **Problem.** A strong probe suite exists (`qa/`), but it only runs by hand.
> **Fix:** a GitHub Action that runs `parsecheck.sh`, `surfaces.js`, `city.js` and the new `release.js` on each PR.

**What is technically solid:**
- **Stability:** zero page errors or console errors across the full match and the first-run flow.
- **Boot and memory:** boot to menu in 0.5–0.7 s (local), and no scene leaks (earlier leak probes still pass).
- **Robustness:** the state machine never entered an illegal state, and engine libraries are self-hosted with a friendly boot-failure screen.

## 12. Accessibility findings

> **A-01 · Reduce Motion stops at CSS** — **Major** · *Settings → Reduce motion* — ✅ **Fixed in this branch** (flyover, swap cinematic, camera transitions)
> **Problem.** The toggle, which is seeded from `prefers-reduced-motion`, only adds `body.reduce-motion` for CSS. The renderer never reads it. The 9 s orbiting flyover, the saucer swap's travelling camera and the hard cuts (CAM-01) all still play.
> **Fix:** under Reduce Motion:
> - the flyover becomes a 0.35 s move (done);
> - the swap set piece runs all seven legs at under a third of the length, about 1.8 s instead of 5.9 s (done);
> - camera transits become 0.22 s moves with no lift (done);
> - still to do: a cross-fade swap and no camera push on dice.
> **Verify:** with Reduce Motion on, the telemetry shows no follow rotation above 90°/s and the opening reaches the briefing in under 1 s.

> **A-02 · Small text: 66 distinct text elements under 12 px during play** — **Major**
> **Problem.** Examples:
> - junction road descriptions: 10.5 px ("Traps, duels & swaps", "12 spaces");
> - buddy notices: 10.5 px;
> - bounty rewards and bodies: 11–11.5 px;
> - the BOT badge: 10 px;
> - action-button labels: 11 px;
> - win-screen stats: 10 px;
> - map-view instructions: about 9 px.
>
> **Fix:** raise the floor to 12 px (13 px for body copy), and make the root font size follow the OS text size. On iOS use `-apple-system-body`; in a Capacitor build, use the `TextZoom` plugin to read the system scale.
> **Verify:** the layout sweep's `small` count is 0 on the HUD and 5 or fewer elsewhere.

> **A-03 · Zoom disabled, and no text-size setting** — **Minor** · *`index.html` viewport*
> **Problem.** `maximum-scale=1, user-scalable=no` blocks pinch-zoom (WCAG 1.4.4). That is normal for games, but with no in-game text-size option it leaves low-vision players nothing.
> **Fix:** add Settings → Text size (100 / 115 / 130 %) driving a root CSS variable.

> **A-04 · Touch targets** — **Minor**
> **Problem:**
> - The ❓ button was 38×38 (✅ now 44).
> - The primary modal buttons (CONTINUE, ENTER SHOP, LEAVE SHOP) are 42 px tall.
> - The win-screen ROTATE is 31 px wide.
> - Settings close ✕ is 34×34.
>
> **Fix:** a minimum of 44 pt on every tappable control, 48 dp on Android.

> **A-05 · Colour dependence is handled well** — the players have names, icons and edge colours; district chips pair emoji with names. **No finding.**

> **A-06 · No screen-reader support** — **Minor** (for a 3D party game)
> **Problem.** Buttons with emoji-only labels (❓, ✕, ⟳) lack `aria-label`. VoiceOver would read "question mark".
> **Fix:** add `aria-label`s to the icon buttons. Full VoiceOver play is not a realistic target for this genre, but the menus should be navigable.

> **A-07 · Audio dependence** — **No finding.** Every sound has a visual counterpart (toast, card or banner).

---

## 13. Prioritised list of the 10 most important improvements

| # | Improvement | Severity | Status in this branch |
|---|---|---|---|
| 1 | **App lifecycle.** Pause menu; auto-pause on background; Back opens pause; board WebGL context-loss recovery. Then match autosave and resume. (RA-04) | Critical | ✅ Pause, background pause, Back and context loss done · autosave to do |
| 2 | **Rendering budget.** Adaptive DPR and shadow pruning, then merge and instance static scenery, collapse materials, cap lights, add a Battery saver toggle. (RA-03) | Critical | ✅ Adaptive DPR and shadow pruning done · merging and instancing to do |
| 3 | **Store packaging and compliance.** Capacitor project, icons, launch screen, privacy policy, privacy labels, TURN or clear online messaging, safe areas. (RA-01, RA-02, T-04) | Blocker | ✅ Safe areas done · packaging and policy to do (outside code) |
| 4 | **Rename "Borat the Bot".** (RA-05) | Critical | ✅ Done |
| 5 | **Offline fonts.** Fallback stacks now, bundled files next. (RA-06) | Major | ✅ Fallback done · bundle to do |
| 6 | **First-match flow.** START always visible, skippable flyover, collapsed briefing on repeat. (UX-01, UX-02) | Major | ✅ Done |
| 7 | **HUD correctness.** Rules button reachable and 44 px; the turn banner says YOUR TURN. (G-01, G-02) | Major | ✅ Done |
| 8 | **Win screen upright by default.** (UX-04) | Major | ✅ Done |
| 9 | **Camera comfort.** Eased transitions instead of 60-unit cuts; Reduce Motion in 3D; junction markers that don't look like glitches. (CAM-01, A-01, C-02) | Major | ✅ Done |
| 10 | **Copy accuracy.** Onboarding facts; "1 coin". (UX-03, UX-07) | Minor | ✅ Done |

**Next ten, after these:**
- Audio identity (VA-01)
- The map as a real overview (C-05)
- Back Alley occlusion and landing framing (C-03, C-06)
- Moving traffic and pedestrians (C-01)
- A coached first turn (UX-03)
- Landscape and iPad layouts (UX-09, UX-10)
- A 12 px text floor and a text-size setting (A-02, A-03)
- iOS haptics (VA-02)
- Crash reporting (T-02)
- Match autosave (RA-04)

## 14. Final pre-release testing checklist

**Build and store**
- [ ] Capacitor iOS and Android release builds install and launch; bundle ID, version and build numbers set
- [ ] App icons (iOS 1024 and all sizes, Android adaptive) and launch screens on both platforms
- [ ] Privacy policy URL live; App Store privacy labels and Play data-safety form match it (online IP exposure, crash reporting)
- [ ] Age rating questionnaires answered (simulated gambling? The coin "bets" in duels need a "No real money" answer)
- [ ] No third-party names or trademarks in player-visible text (grep for character, brand and celebrity names)
- [ ] Store screenshots at the required sizes (6.9″, 6.5″, and 13″ iPad if iPad is supported; Play phone and 7″/10″ tablet)

**Lifecycle**
- [ ] Background during a bot turn for 60 s → returns paused, on the same turn
- [ ] Force-quit mid-match → splash offers Resume (after autosave lands)
- [ ] Android Back during a turn → pause menu; Back again → quit confirm
- [ ] Incoming call, notification pull-down and Control Centre → pause, then resume cleanly
- [ ] WebGL context loss (simulate with `WEBGL_lose_context`) → recovery prompt → game continues

**Performance (on real devices: one low Android, one mid Android, one older and one current iPhone)**
- [ ] 10-minute City match: p95 frame time under 20 ms (mid) / under 33 ms (low); no thermal warning
- [ ] `renderer.info.render.calls` at a normal turn under 600
- [ ] Memory stable across three consecutive matches (no growth over 10 %)
- [ ] Cold start to menu under 3 s on the low device

**Offline and network**
- [ ] Airplane mode on first launch: correct fonts, full local play
- [ ] Online: same Wi-Fi join; different carriers join, or show the specific error within 15 s

**Screens and input**
- [ ] 375×667, 390×844, 430×932, 360×780, iPad (if supported), landscape: no clipped buttons; primary action visible on every sheet
- [ ] Dynamic Island and home indicator: no control under an inset
- [ ] Every tappable control at least 44 pt / 48 dp; no body text under 12 px
- [ ] ❓ rules, ⏸ pause, MAP, ITEMS, BOUNTIES all respond during your turn

**Accessibility**
- [ ] Reduce Motion on: no flyover, no camera travel, fades only
- [ ] OS large text: HUD still fits
- [ ] VoiceOver / TalkBack reach every menu button with a spoken label

**Audio and haptics**
- [ ] Music and SFX sliders independent; iOS silent switch respected
- [ ] Haptics fire on iPhone (Capacitor Haptics)

**Regression (automated, this repo)**
- [ ] `bash qa/parsecheck.sh`, `node qa/surfaces.js`, `node qa/city.js`, `node qa/release.js`, `node qa/winscreen.js city_circuit`
- [ ] `node qa/auditplay.js` reaches WIN_SCREEN with 0 errors

---

## 15. Fix verification (this branch)

`node qa/release.js` drives the real game with real pointer input. **23 of 23 checks pass.** One check failed on the first run because of how it was written, not because of the game: it tested adaptive resolution in a context already at pixel ratio 1, where there is nothing to step down from. It now runs at DPR 2.

| Check | Result |
|---|---|
| RA-06 no splash text renders in a serif face (Google Fonts unreachable) | all sans (DevTools platform-font query) |
| UX-01 START on screen at 375×667 / 390×844 / 430×932 / 844×390 | bottoms at 617 / 785 / 868 / 354, all inside the viewport |
| UX-02 a tap skips the flyover | briefing 915 ms after the tap |
| UX-02 first briefing full, returning briefing compact | ✓ / ✓ |
| G-02 the human's own turn banner | "PLAYER 1 · YOU · YOUR TURN — ROLL THE DICE" |
| G-01 real tap on ❓ during your turn | rules open; 44×44 |
| RA-05 bot name | "BOLT THE BOT" |
| C-02 junction spheres | 0 |
| RA-03 shadow casters | 1,007 → 372 |
| RA-03 adaptive resolution (DPR 2) | 2 → 1.5 → 1 |
| RA-04 ⏸ opens pause and stops the match clock | ✓ |
| RA-04 a bot turn during pause | unchanged for 6 s, then continues after RESUME |
| RA-04 page hidden / Back | both open the pause menu |
| CAM-01 60-unit target jump | 59.4 u over 6 frames, largest 21 u (was one 60 u frame) |
| UX-04 win screen, 1P, phone upright | opens upright |
| A-01 Reduce Motion flyover | reaches the briefing with no tap |
| Page errors | none |

## Appendix: evidence

- Playthrough telemetry: `qa/audit-m6.json` (ignored by git; regenerate with `node qa/auditplay.js m6 3300 390x844 0 6`)
- Layout sweep: `qa/audit-layout.json` and `qa/shot-layout-*.png` (`node qa/auditlayout.js`)
- Screenshots: `qa/shot-audit-*.png`
- Key measurements quoted above:
  - scene census: 2,189 meshes, 1,277 materials, 1,007 shadow casters, 17 lights;
  - START button at y = 984 on an 844-high screen;
  - `elementFromPoint(❓) = #swipe-zone`;
  - raycast blob = `SphereGeometry r=1.8` at (0, 0.5, −32);
  - largest camera cut: 60.5 u / 160.7°.

---

## 15. Implementation pass — every finding, its status and its proof

After the audit, every finding with a code fix was implemented on this branch.
Each row names the probe that proves it. All probes are in `qa/` and run
against the real game in headless Chromium with real pointer input where a
player would tap. What cannot be settled in this environment (real devices,
store accounts) is listed at the end, with the steps in `docs/STORE_RELEASE.md`.

**Status key:** ✅ done and verified here · 🟡 done in code, needs a device, an account or a final test run to confirm · ⏭ not applicable

**Where this leaves the score: 72 / 100** (was 52). Controls 8, city 7,
camera 7, UX 8, visual and audio 7, performance 6, accessibility 7, store 6; the
rest unchanged. **Recommendation: Ready with Minor Fixes, after a device pass.**
Nothing left in the code blocks a submission. What blocks it is outside the
repo: signed builds, the store listings, and one session on a real mid-range
Android phone to confirm the rendering budget.

**Not re-run at the end of this pass (owner's call, testing by hand):** the
older regression probes (`release.js`, `city.js`, `winscreen.js`, `buddy.js`,
`gate.js`, `surfaces.js`) and a final `resume.js`. Every change since they last
passed is covered by its own probe below, but the combination hasn't been
swept.

### Release blockers

| ID | Status | What changed | Proof |
|---|---|---|---|
| RA-01 App package | 🟡 | `package.json` (Capacitor 8 + App, Haptics, SplashScreen, StatusBar), `capacitor.config.json`, `scripts/build-web.js` → `www/`, store icon and splash source art in `resources/` (`npm run art`, `npm run cap:assets`). `npx cap add ios/android` and signing need a Mac, an Android SDK and store accounts | `node scripts/build-web.js`: 105 files, 3.2 MB, no import leaves the build |
| RA-02 Privacy and online | 🟡 | `privacy.html` (ships in the app, linked from Settings); store data-safety answers in `STORE_RELEASE.md`; `RELEASE.turnServers` feeds WebRTC ICE; the lobby times out after 15 s and tells a joiner what to try when no host answers | Contact address and hosting URL still to fill |
| RA-03 Draw calls | ✅ (🟡 on device) | Static scenery merged by material and 48-unit cell; animated props, transparent meshes and occluders left alone. Battery saver (Settings) drops the shadow pass and holds 1× | `qa/optimise.js`: meshes 2,193 → 1,250; calls at fixed viewpoints 188 → 135 (street), 762 → 509 (raised), 2,194 → 1,254 (overview); 234 animated meshes still move; 70 occluders keep 498 fade materials; saver toggles shadows off and back |
| RA-04 Lifecycle | 🟡 | Local matches autosave at the top of every turn (7-day expiry, never online) and the splash offers RESUME MATCH; Capacitor Back opens/closes pause and exits from menus; the app going inactive pauses; quitting clears the save | `qa/resume.js` is written and its stalls were probe bugs (fixed: a synthetic click cannot press the minigame intro's `pointerdown` button). A final full pass was **not run**; the owner is testing resume by hand |
| RA-05 Bot name | ✅ | Bolt the Bot | earlier pass |
| RA-06 Fonts | ✅ | Nunito (variable) and Bebas Neue bundled as woff2 in `assets/fonts` with their OFL licences; Google Fonts removed | `qa/ci-smoke.js`: both faces load, zero requests to Google |

### Gameplay, city, movement, camera

| ID | Status | What changed | Proof |
|---|---|---|---|
| G-01, G-02 | ✅ | earlier pass | `qa/release.js` |
| G-03 Swipe hint | ✅ | Retires after three human rolls | Wave 1 layout sweep |
| G-04 Board untouchable on your turn | ✅ | A short tap in the swipe zone inspects the space under it | Wave 1 |
| G-05 Reload flash | ✅ | Rematch and Main Menu fade out before reloading (no white flash) | Wave 1 |
| C-01 Static city | ✅ | 12 cars on four avenues through the gaps between districts (closed out-and-back loops, so none pop in) and 28 pedestrians on the districts' inner pavements, as three instanced draws; frozen when paused or on Battery saver | `qa/traffic.js`: 12/12 cars and 28/28 people move; nearest approach to any player tile 17.7 units; no car inside any building's bounds; paused and saver freeze them |
| C-02 Junction blob | ✅ | earlier pass | |
| C-03 Back Alley occlusion | ✅ | Overhead spans (bunting, wires, gantries) now fade like buildings when they come between camera and token | Wave 3 |
| C-04 Lore every time | ✅ | A district's lore line shows on the first visit only | Wave 1 |
| C-05 Map not an overview | ✅ | The map opens on a fitted top-down view of the whole circuit, clear of the map sheet. The probe caught that the first version never showed: refreshing the slider flew the camera back to the player's space. Fixed; the hint no longer sits under the slider either | `qa/wave3.js`: all 60 spaces in frame, none under the sheet, the circuit spans 86 % of the width |
| C-06 Token out of frame | ✅ | The follow camera re-frames with a short transit when the token sits outside the central 80 % for 0.35 s | `qa/wave3.js`: a token thrown 70 units off is back in frame in about 1.1 s |
| M-01 No reactions | ✅ | Tokens hop on a coin gain, squash and shake on a fine, and breathe while waiting to roll; played through the mirrored effects, so online clients see them too | `qa/wave5.js`: jump peak 1.53 units, squash to 0.79, exact settle |
| M-02 | ✅ | see G-05 | |
| CAM-01, CAM-03 | ✅ | earlier pass | `qa/release.js` |
| CAM-02 FOV | ✅ | Vertical FOV derived from aspect so at least 30° horizontal, clamped 50–62° | Wave 1 |

### UI, audio, technical, accessibility

| ID | Status | What changed | Proof |
|---|---|---|---|
| UX-01, UX-02, UX-04 | ✅ | earlier pass | `qa/release.js`, `qa/winscreen.js` |
| UX-03 Text-wall onboarding | ✅ | First launch no longer opens the seven slides. The first match coaches itself on the real controls: ROLL, the first fork, the first result card, one line each, never blocking a touch, once per install. A step counts only after 1.2 s on screen, and the coach bows out after 12 turns | `qa/coach.js` 8/8 |
| UX-05 HUD wraps, wrong pill | ✅ | Single-line bars with ellipsis; the badge reads YOUR TURN / THEIR TURN / THINKING… | Wave 1 layout sweep |
| UX-06 Bounty pills clipped | ✅ | The strip wraps | Wave 1 layout sweep |
| UX-07 Copy | ✅ | Plurals (earlier); identical toasts within 2 s are dropped. **Correction:** the "merged toast" in the audit was a capture artefact (the probe read the whole toast stack as one string), not a game defect | Wave 1 |
| UX-08 Splash cut off | ✅ | Title clamps to the viewport; compact splash rules below 700 px and 430 px tall | Wave 1 sweep: 0 cut buttons at 375×667 |
| UX-09 Landscape board | ✅ | Board screens on a landscape phone show a "turn upright" card; the splash and side-on minigames still allow landscape | `qa/wave3.js` 11/11 |
| UX-10 iPad | ✅ | Tablets (shortest side ≥ 700 px) get `html.is-tablet` and 1.25× text on top of the player's text size | `qa/wave3.js` |
| UX-11 Pause | ✅ | earlier pass, plus Capacitor Back | `qa/release.js`; Back with a mocked plugin in `qa/resume.js` (not re-run) |
| VA-01 No music | ✅ (🟡 on device) | A procedural score in the game's own synth voice (menu theme, board loop: pad, bass, arpeggio, hats) on its own bus with a Music slider; ducks under every effect, silent during minigames and when the app is hidden | `qa/wave5.js`: 21 notes in 3 s on the menu, board loop after a match starts, 0 notes with the slider at 0, with mute, and during a minigame |
| VA-02 iPhone haptics | 🟡 | Routed to Capacitor Haptics (LIGHT / MEDIUM / HEAVY by pattern length) | Needs an iPhone; the mocked-plugin check in `qa/resume.js` was not re-run |
| VA-05 Dark scrims | ✅ | Lighter scrim for prompts | Wave 1 |
| T-01 | ✅ | see RA-03 | |
| T-02 Crash reporting | 🟡 | Local log of the last 20 errors (`hbdDiagnostics()`); Sentry loads only when `RELEASE.sentryDsn` is set, with player names scrubbed | Needs a DSN to prove end to end |
| T-04 Safe areas | ✅ | earlier pass | |
| T-05 Online | 🟡 | see RA-02; a TURN server needs provisioning | |
| T-06 CI | ✅ | `.github/workflows/ci.yml`: static sweep, web build, `qa/ci-smoke.js` on every push and PR | First run on GitHub: green |
| A-01 Reduce Motion | ✅ | The swap is now a 0.6 s fade with the camera still. **Correction:** the audit's "camera push on dice" does not exist: the follow camera does not react to a roll, so there was nothing to remove | `qa/wave5.js`: tokens swap, camera moves 0 units |
| A-02 Small text | ✅ | Every font size scales with `--ts`, with a 12 px floor (11 px in three dense layouts) | Wave 1 sweep: 0 text elements under 12 px at 375, 390 and 844 wide |
| A-03 Text size | ✅ | Settings → Text size 100 / 115 / 130 % | Wave 1 |
| A-04 Targets | ✅ | 44 px minimum on board controls | Wave 1 |
| A-06 Labels | ✅ | `aria-label`s on every icon button | Wave 1 |

### Left for devices and accounts

These need hardware or accounts and are listed with their steps in `docs/STORE_RELEASE.md`:
- frame rate, heat and battery on a mid-range Android phone and an older iPhone;
- Back, resume and haptics on real phones;
- the iOS silent switch and music;
- insets on a Dynamic Island iPhone and a gesture-navigation Android phone;
- online play across two carriers;
- bundle ID, signing, store listings, the privacy-policy URL and a support contact;
- optionally a Sentry DSN and a TURN server.
