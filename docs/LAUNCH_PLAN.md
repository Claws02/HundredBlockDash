# Launch plan — from repo to App Store and Google Play

This is the master plan for publishing Hundred Block Dash commercially. It
covers the business setup, the accounts, the monetization design that was
chosen (2026-10-07), the legal documents, and the order to do it all in.
`STORE_RELEASE.md` stays the build-and-submit checklist; this is everything
around it.

> **Not legal advice.** The documents in this repo (`privacy.html`,
> `terms.html`, `credits.html`) are drafted to current store rules and common
> practice, but a one-hour review by a lawyer who does app/consumer work is
> cheap insurance before launch. Every placeholder is written `[[LIKE THIS]]`
> so `grep -rn '\[\[' *.html docs/` finds them all.

---

## 1. Publisher: individual or LLC

| | Individual | LLC |
|---|---|---|
| Cost | Apple $99/yr, Google $25 once | Same, **plus** state filing (~$50–$500) and any annual fee (e.g. California $800/yr franchise tax; most states $0–$300) |
| Time | Days | 1–4 weeks: file LLC → EIN (free, IRS, same day online) → D-U-N-S (free, Dun & Bradstreet, ~1–2 weeks; Apple requires it for organizations) |
| Personal liability | Unlimited. A lawsuit over the app (IP claim, privacy complaint, consumer dispute) can reach personal assets | Limited to the LLC, provided money is kept separate (own bank account, no commingling) |
| Seller name shown | Your legal name | The LLC's name |
| Address shown publicly | **Google shows your full address once the app monetizes** (IAP or paid). Apple's EU listing (Digital Services Act) needs an address too (a PO box is accepted) | The business address. Use a registered-agent / virtual office address to keep home private |
| Google Play testing gate | **Applies:** new personal accounts must run a closed test with 12+ testers opted in for 14 consecutive days, and Google checks they actually played | **Exempt** (organization accounts) |
| Taxes | Schedule C | A single-member LLC is "disregarded" by default: same Schedule C, no extra return |
| Switching later | Both stores support transferring an app to another account, so you can start individual and move it, keeping reviews and players | — |

**Recommendation: LLC.** The app sells IAP and shows ads, which is real
commerce with real consumers. The LLC keeps your home address off two public
storefronts and skips the 12-tester gate. A sensible middle path is to start
building and testing now and form the LLC in parallel; it only has to exist
before the first store upload.

**LLC steps (US):**
1. Pick the state (normally your home state; "Delaware/Wyoming" only adds a
   foreign-registration fee for a one-person studio).
2. Name search on the Secretary of State site + USPTO trademark search (§6).
3. File Articles of Organization; appoint a registered agent (you, or a
   service for ~$50–$150/yr to keep your address private).
4. Write a short single-member operating agreement.
5. EIN from irs.gov (free). Open a business bank account.
6. Request a D-U-N-S number via Apple's lookup tool (free).
7. Enroll the Apple Developer Program **as an organization**; create the Google
   Play Console account **as an organization**.

---

## 2. Accounts and money

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99/yr | Enroll as organization (D-U-N-S). Then apply to the **App Store Small Business Program** → 15% commission instead of 30% under $1M/yr |
| Google Play Console | $25 once | Organization account. Google charges 15% on the first $1M/yr automatically |
| Google AdMob | Free | For the rewarded ads. Link to the Play/App Store listing after launch |
| Domain + hosting for legal pages | ~$12/yr (or free via GitHub Pages) | Privacy and Terms must be at public URLs |
| Support email | Free | e.g. `support@[[yourdomain]]` |
| Tax / banking forms | — | W-9 (Google), US tax forms in App Store Connect → Agreements, Tax and Banking. **Paid Apps agreement must be active before IAP works at all** |

Payouts: Apple pays ~33 days after each fiscal month; Google monthly once over
the threshold. Both handle sales tax/VAT collection for you.

---

## 3. Monetization design (decided 2026-10-07)

**Free to download. No forced ads, ever.** One soft currency, Tickets, plus
optional real-money shortcuts.

### Free content
- **Map:** Hundred Block Dash.
- **Minigames (12):** all nine 3–4-player games (Sumo Spheres, Snap Strike,
  Grid Recall, Odd One Out, Steady Hand, Shape Snap, Loot Catch, Light Cycles,
  Brainrot Tower) plus Go-Kart Grand Prix, Bowling and High Noon. The nine
  four-player games *must* be free, or a free 3–4-player table has nothing to
  deal.

### Unlockable content (Tickets **or** real money)
| Unlock | Contents | Tickets | Direct IAP |
|---|---|---|---|
| City Circuit map | the map | 1500 | $1.99 |
| Frontier pack | Boot Hill Barrage, The 4:15, Mine Cart, Vault Heist, Tank Clash, Clear Out, Tree Climb | 800 | $1.99 |
| Fairground pack | Bumper Cars, Musical Chairs, Red Light, Tag, Water Balloon Toss, Balloon Pump, Sack Race, Mini Golf | 800 | $1.99 |
| City Nights pack | Rooftop Run, Block Party, Turf War, Speed Boat, Rift Dive, Lily Pad, Snowball Fight | 800 | $1.99 |
| Table Classics pack | Puck, Four in a Row, Memory Match, Shell Game, Penalty, Hot Potato, Rhythm Forge, Orb Deflect, Pancake Stack | 800 | $1.99 |
| **Everything** | all of the above + a supporter badge | — | $6.99 |

Direct purchases are **non-consumable** (permanent, restorable on any device
with the same Apple ID / Google account). Unlocking with Tickets is permanent
on that device.

### Earning Tickets
- Finish a match: +25 · each minigame a human on this device wins: +10
- First match of the day: +50
- Opt-in rewarded ad ("Watch an ad: +50 🎟️"): max 5 a day, only offered from
  the shop / win screen, never mid-match
- Optional ticket packs (consumable): 500 / $0.99, 1200 / $1.99, 3500 / $4.99

### Cosmetics (Tickets only in v1)
Character finishes (colours, metallic, glow, gold), hats & accessories, dice
skins, board trails, victory emotes. Bought directly, **no randomized boxes**:
paid random items require odds disclosure (Apple 3.1.1) and are banned in
Belgium.

### Online
The **host's** library decides the maps and minigames for the room; guests play
free. Everyone shows their own cosmetics. This makes a single purchase worth
more and makes free guests the marketing.

### Store-rule notes
- Unlocking digital content must use Apple/Google IAP. No outside payment links
  or prices in-app.
- A **Restore Purchases** button is mandatory (Settings and the shop).
- Virtual currency has no cash value, cannot be transferred, does not expire
  (written into `terms.html`).
- Each IAP product needs a name, description, price tier, review screenshot,
  and (Texas) an age rating. Apple's questionnaire covers this.

### Where it lives in the code

| Piece | File |
|---|---|
| Prices, packs, product ids, earn rates | `src/meta/Catalog.js` (the one table to edit) |
| Ticket balance, match reward, ad cap | `src/meta/Wallet.js` |
| Ownership and the game's gates | `src/meta/Unlocks.js`, used by `MinigameManager.eligibleTypes`, the map picker and the arcade |
| Cosmetics and per-seat loadouts | `src/meta/Cosmetics.js` (data), `src/engine/CosmeticsFx.js` (3D) |
| Store / ads / age signal adapters | `src/meta/Store.js`, `src/meta/Ads.js`, `src/meta/AgeGate.js` |
| Shop screen | `src/ui/Shop.js` |
| Probe | `qa/shop.js` (runs in CI; `?devstore` simulates the store and ads) |

Everything is local to the device: no server, no account. Tickets and
Ticket-bought unlocks do not survive a wipe; money purchases come back through
the store. A cloud save (iCloud key-value / Play Games Saved Games) is the
natural follow-up if players ask for it.

---

## 4. Privacy changes that come with ads

Today the app truthfully collects nothing. Rewarded ads change that, **only
when a player chooses to watch one**, and only via Google's SDK:

| Requirement | What we do |
|---|---|
| EU/UK/Swiss consent (GDPR, IAB TCF) | Google UMP consent form shown on first launch in those regions, before any ad request. "Privacy choices" button in Settings to change it |
| US state privacy laws (CCPA/CPRA etc.) | UMP's US regulations message; "Do not sell or share" toggle via the same Privacy choices entry |
| iOS App Tracking Transparency | **Not requested.** We serve ads without IDFA (no ATT prompt). Simpler, friendlier, and Apple-compliant |
| Apple privacy label | Changes from *Data Not Collected* to: Identifiers (Device ID), Usage Data (Advertising data, Product interaction), Diagnostics. Purpose: Third-Party Advertising. "Used to track you": **No** (no ATT) |
| Google Data safety | Collected & shared with AdMob: Device or other IDs, App interactions, Diagnostics. Purpose: Advertising. Encrypted in transit: Yes. Optional: No (if ads shown). Deletion: via Google ad settings |
| Children | Google Play target audience **13+** (keeps out of the Families ad program). Apple age rating computed by the questionnaire (expect 9+ for cartoon mischief, with "In-App Purchases" and "Advertising" declared). Not in the Kids Category. AdMob tagged `tagForUnderAgeOfConsent=false`, `maxAdContentRating=PG` |
| IAP | Purchases are processed by Apple/Google. We receive a receipt token, verified on device. No payment details ever reach us |

`privacy.html` is updated to say all of this.

---

## 5. Age-rating and age-signal laws (2026)

- **Apple:** new questionnaire (13+/16+/18+ tiers). Answer it honestly in App
  Store Connect; declare IAP and ads.
- **Google Play:** IARC questionnaire; expect *Everyone* / PEGI 3–7.
- **Texas SB 2420 (live since June 2026), Utah, Louisiana:** developers must
  assign the app and each IAP an age rating, and must honour the store's age
  signal and parental-consent result. For us this means: read the age range
  from Apple's Declared Age Range API / Google's Play Age Signals API at
  launch; if the player is a minor in a covered state and consent is not
  granted, **hide the IAP and ad buttons** (the game stays fully playable).
  Use the signal for nothing else and keep nothing. Implemented in Phase 4.

---

## 6. Intellectual property checklist

| Item | Status |
|---|---|
| Name "Hundred Block Dash" | **To do:** search USPTO (tmsearch.uspto.gov), App Store and Google Play for conflicts. Optional: file a US trademark (~$350/class, class 9 + 41) once revenue justifies it |
| Brainrot Tower cast | Original names and models (Sardino Pianino etc.). Keep it that way: don't use the viral characters' names (Tralalero Tralala, Tung Tung Tung Sahur, Bombardiro Crocodilo…), some of which have trademark filings |
| Minigame names | Generic game names (Musical Chairs, Red Light Green Light, Four in a Row, Mini Golf) are fine. Don't reference other franchises in store text |
| three.js, cannon.js, Trystero | MIT. Notice required → `credits.html` |
| Nunito, Bebas Neue | SIL Open Font License 1.1 → `credits.html`, licence texts already in `assets/fonts/` |
| Music & sound effects | Synthesized at runtime by `AudioManager.js` (Web Audio oscillators): original, no licences needed |
| App icon & store art | Generated by `scripts/render-store-art.js` (ours) |
| Copyright | `© 2026 [[PUBLISHER]]`. Copyright exists automatically; registration (copyright.gov, $45–65) is optional and only matters if you ever sue |

---

## 7. Documents and pages

| Page | File | Store field |
|---|---|---|
| Privacy Policy | `privacy.html` | App Store Connect → App Privacy → Privacy Policy URL; Play Console → App content → Privacy policy |
| Terms of Use (EULA) | `terms.html` | App Store: add a custom EULA in App Information, or keep Apple's standard EULA and link `terms.html` in the description. Play: link in description |
| Credits / licences | `credits.html` | In-app (Settings → Credits) |
| Support | `support.html` | App Store "Support URL"; Play "Website" + support email |

Host them: enable **GitHub Pages** on this repo (Settings → Pages → main →
root) and they are live at `https://<user>.github.io/<repo>/privacy.html`.
They also ship inside the app.

Fill every `[[PLACEHOLDER]]` before submitting.

---

## 8. Store listing assets

| Asset | Apple | Google |
|---|---|---|
| Icon | 1024×1024 (from `resources/icon.png`) | 512×512 |
| Screenshots | 6.9″ iPhone (1320×2868) required; 13″ iPad if iPad stays on | 2–8 phone shots; 7″/10″ tablet if you want the tablet badge |
| Feature graphic | — | 1024×500 |
| Preview video | optional, 15–30 s | optional YouTube link |
| Text | Name (30), Subtitle (30), Keywords (100), Description, Promotional text | Title (30), Short description (80), Full description (4000) |

Draft copy is in §11.

---

## 9. Order of work

| # | Step | Who | Est. |
|---|---|---|---|
| 1 | Decide LLC → file, EIN, bank, D-U-N-S | you | 1–4 wk (parallel) |
| 2 | Phase 2–5 code (economy, shop, cosmetics, IAP, ads, online) | us | in progress |
| 3 | Apple + Google developer accounts; Paid Apps / payments profile; tax forms | you | 1–3 days after D-U-N-S |
| 4 | Create IAP products in both consoles with the IDs in `src/meta/Catalog.js` | you (I'll give the exact list) | 1 hr |
| 5 | AdMob account, app + rewarded ad unit IDs, UMP messages (GDPR + US states) | you | 1 hr |
| 6 | `npx cap add ios/android`, signing, first internal builds | together, on your Mac | 1 day |
| 7 | Device test pass (`STORE_RELEASE.md` §4 + purchases in sandbox/licence testers) | you + me | 2–3 days |
| 8 | TestFlight external + Play closed test (open to friends for feedback) | you | 1–2 wk |
| 9 | Store listings, privacy forms, age questionnaires, submit | together | 1 day + review (Apple ~1–2 days) |
| 10 | Lawyer review of Terms & Privacy (optional but recommended) | you | — |

---

## 10. After launch

- Answer reviews; Apple and Google both weigh responsiveness.
- Keep the age-rating answers and privacy labels in sync with every SDK change.
- Re-check AdMob policy emails; an ad account strike can freeze payouts.
- Update the SDKs yearly (Apple and Google raise minimum SDK/API targets every
  year: Google Play requires targeting the latest Android API within a year).
- Keep `Release.js` version and the store build numbers in step.

---

## 11. Draft store copy

**Name:** Hundred Block Dash
**Subtitle (iOS, 30):** Party board game for 1–4
**Short description (Play, 80):** Roll, race and duel through 40+ minigames. Pass-and-play or online with friends.

**Description:**
> Grab your friends — or take on the bots — in a party board game that never
> sits still. Roll the dice, dash across living realms, and fight for every coin
> in 40+ minigames: go-karts, high-noon duels, sumo spheres, bowling, a wobbling
> tower of brainrot snacks, and plenty more.
>
> • 1–4 players on one phone, or each on their own phone online
> • Friends join your online room for free, and play everything you've unlocked
> • Two boards: dash through Hundred Block Dash, unlock City Circuit
> • Earn Tickets just by playing, and spend them on hats, dice, trails and victory dances
> • No forced ads: the only ads are the ones you choose to watch for bonus Tickets
>
> Free to play with optional in-app purchases.
