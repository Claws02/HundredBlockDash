# Handoff prompt: finish Hundred Block Dash for the App Store

Paste everything below the line into a new session on this repository.

---

You are finishing the App Store preparation of **Hundred Block Dash**, a party board game. Work on branch `claude/exciting-darwin-0tw3wx` in both `Claws02/HundredBlockDash` and `Claws02/claw-core`. Do not open a pull request unless asked. Work through the task list in order, one task per commit, and stop after each numbered group to report.

## What the project is

- A static web app with no bundler: plain ES modules under `src/`, three.js r128 and cannon-es 0.20 loaded as the globals `THREE` and `CANNON` from `vendor/`, wrapped for the stores by Capacitor 8.
- `src/claw-core` is a git submodule (`Claws02/claw-core`) holding the 43 minigames and the transport. It is shared with another app, CLAWGames. Core files may import only each other and `src/AppHost.js`.
- Every 3D model is built in code. `src/engine/CityKit.js` is the model kit: a model is at most three meshes (`body`, `sheen`, `glow`) with colour in the vertices and materials shared by the whole city.
- Online play is phone to phone over WebRTC (Trystero 0.25, vendored). The host is authoritative: guests send intents, the host sends snapshots and mirrored scenes.

## Decisions already made by the owner. Do not reopen them.

- Stay on three.js r128 for the first release.
- Ship online play in 1.0, hardened.
- Keep Trystero at 0.25. Version 0.27 changed its exports and real connections cannot be tested without two devices.
- Models stay procedural. No model files.

## What is already done on this branch

- **Online security.** `src/net/NetGuard.js` validates and scrubs every roster, snapshot, intent and scene from the wire. `NetSession.js` pins the host on a guest and ignores other peers. `NetGame.js` only replays known scenes from the host. Names are escaped where printed (`src/core/Html.js`, claw-core `config/Text.js`).
- **Content-Security-Policy** in `index.html`. The boot script moved to `src/boot.js`. QA probes open pages with `bypassCSP: true`; `qa/ci-smoke.js` runs with the policy live and asserts it blocks an inline script.
- **cannon.js 0.6.2 replaced by cannon-es 0.20** (`vendor/cannon-es.min.js`, see `vendor/README-cannon-es.md`). Bowling and Barrage in claw-core detect the library with `CANNON.BODY_TYPES`.
- **Minified release build.** `scripts/build-web.js` minifies each file in place with esbuild (4.1 MB to 2.4 MB). CI installs with `npm ci` and smokes `www/` as well as the dev tree. `package-lock.json` is new.
- **Models.** `CityKit.gate`, `CityKit.stall` and `CityKit.pavilion` replace the old Gate, shop stall and HQ in `Renderer.js`. Tokens have a seat-colour pawn base and a turn ring (`_addTokenBase`).

Verified: static sweep, smoke on the dev tree and on `www/`, and the bowling, barrage, brainrot and pancakes physics probes all pass on cannon-es.

## How to test (the environment has a software GPU; probes are slow)

```bash
git submodule update --init
python3 -m http.server 8129 &            # the probes expect this port
bash qa/parsecheck.sh src                # static sweep, seconds
node qa/ci-smoke.js                      # boot to first roll, under a minute
node scripts/build-web.js                # writes www/
```

- Probes hardcode `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. If that path is missing, symlink the installed Chromium's folder to it rather than editing 60 files.
- Never write `\uXXXX` escapes into source through a tool call that decodes them. Build such strings in a script, then grep the file to confirm the escape is literal.
- Frame rate cannot be measured here. Do not claim performance results.

## Tasks

### 1. Check the unverified work from the last session

1. Render the board and look at it: the stall's awning pitch was changed after its last render, and the token bases and turn ring have never been rendered. Start a City Circuit match, pause the board, and use `Renderer.qaRenderFrom(camPos, lookAt)` on groups from `Renderer.getTileMeshes()` whose `userData.type` is `_gate`, `_shop` or `_hq`. Fix anything that floats, clips or z-fights.
2. Run `node qa/zfight.js` and `node qa/optimise.js`. Both must stay passing; draw calls at street view were 124 before the model change.
3. `qa/net.js 3` passed 16 of 17 checks. The failure is "the match advances": it stalled on `duel-pick-modal`, which the probe never presses (there is no duel handling in `qa/net.js`). Confirm whether that is a gap in the probe by running it against `main`. If it is, teach the probe to click a `.duel-pick` button on the active seat's page. If `main` passes, the cause is the scrub in `NetGuard.js` or the intent check in `NetSession.js`; fix it there.
4. Run `qa/netduel.js`, `qa/netfx.js` and `qa/netmg.js`.
5. Add a probe `qa/netguard.js` that joins a loopback room as a third page and sends hostile messages straight through the transport: a `lobby` and a `snap` from a non-host peer, and from the host a snapshot whose name and inventory contain `<img src=x onerror=...>`. Assert the guest's state and DOM are unchanged or contain no element created from that text.

### 2. Close the remaining online gaps

1. **Room codes are four characters** (`CODE_LENGTH` in `src/claw-core/net/NetTransport.js`), about 920,000 combinations, so a stranger can join by guessing. Raise to six. Update the lobby input, `normaliseCode`, the `#join=` link and every probe that types a code. This changes the room namespace, so it must land before release and in CLAWGames at the same time.
2. **Add a host "lock room" control** in `src/ui/Lobby.js` and `NetSession.js`: once locked, a new `HELLO` is answered with `KICK`. Lock automatically at START (already the behaviour once `_started` is true).
3. **Name filter.** Apple guideline 1.2 can apply to typed names shown to other players. In `NetGuard.cleanName`, replace a name that matches a small blocklist with the seat default. Keep the list in its own file under `src/config/`.
4. **Rate-limit intents on the host**: drop more than about 30 per second from one peer in `NetSession._hostRecv`.

### 3. App Store packaging (needs the owner for the items marked OWNER)

1. OWNER: choose the real bundle ID. `capacitor.config.json` has the placeholder `com.hundredblockdash.game`; it can never change after the first upload.
2. OWNER: supply a support email or URL. Put it in `privacy.html` (`#contact`) and `docs/STORE_RELEASE.md`.
3. Add a GitHub Actions workflow on `macos-latest` that runs `npm ci`, `npm run build:web`, `npx cap add ios`, `npm run cap:assets`, `npx cap sync ios`, and an unsigned `xcodebuild` for the simulator. This proves the iOS project builds. Signing and upload need the owner's Apple certificates as repository secrets; document the secret names, do not invent values.
4. Commit the generated `ios/` and `android/` projects once they build (the `.gitignore` comment says to).
5. Add `ios/App/App/PrivacyInfo.xcprivacy`. Read Apple's current required-reason API list and Capacitor's own manifest before writing it; the game itself stores only `localStorage` data and collects nothing.
6. In Xcode settings: allow all orientations, set the deployment target Capacitor 8 requires, and decide iPad support with the owner (iPad needs 13-inch screenshots).
7. Update the privacy policy's effective date and check every claim in it against the code after tasks 2.1 to 2.3.
8. Re-read `docs/STORE_RELEASE.md` section 4 (the on-device checklist). None of it can be done here; leave it for the owner and keep it accurate.

### 4. Models and visuals

Follow `docs/MODEL_UPGRADE.md`: same footprints, three layers, moving parts as separate small meshes, `qa/zfight.js` at zero pairs, render before and after.

1. Star Territory buildings in `Renderer.js`: `_mkFalseFront`, `_mkRailShed`, `_mkMineWorks`, `_mkRanchBuilding`, `_mkLanternPost`. Move each to a `CityKit` builder.
2. The Territory plinth (`_buildPlinthMesh`): keep the glass case and the live Star as separate meshes, rebuild the stone on the kit.
3. The City background skyline (`_buildBackgroundSkyline`).
4. The park fountain, bench and lamp in `CityKit.js` still use their own materials; move them onto the kit layers.

### 5. Engine, after release unless the owner says otherwise

1. Port `NetTransport.js` to Trystero 0.27 and rebuild the vendor bundles (`vendor/README-trystero.md`). Test on two real devices on different networks.
2. Add a TURN server to `RELEASE.turnServers`; without one about one network in ten cannot connect.
3. A single bundled build (esbuild with code splitting) instead of per-file minification. The QA probes import modules by path, so they need a path map first.
4. three.js r128 to current. Colour management changed in r152 and light units in r155, so every board and all 43 minigames need a visual check on a real device.
5. Dev-only advisories remain in `@capacitor/assets` (`sharp`, `tar`). `npm audit --omit=dev` is clean. Bump `@capacitor/assets` when a fixed release exists.

## Reference projects

These are the upstream projects the work leans on; read their docs rather than guessing an API: `mrdoob/three.js`, `pmndrs/cannon-es`, `dmotz/trystero`, `ionic-team/capacitor`, `evanw/esbuild`, `cure53/DOMPurify` (as a model for sanitising, not a dependency). The owner asked for a survey of open-source repositories with over 1,000 stars for further ideas; that survey has not been done.

## Rules

- Report failures with their output. Do not skip or weaken a probe to get a pass.
- Any change inside `src/claw-core` is committed and pushed in that repository first, then the submodule pointer is bumped here.
- Do not put secrets in the repository, the environment or a workflow file.
- Ask the owner before anything marked OWNER, and before any change that alters the room namespace or the wire protocol version.
