# The four districts

City Circuit is a lap map whose only real decision is *which road to take*. That
decision is only interesting if the roads are different places.

Before this pass they were not. A district was a name and four colours in
`DISTRICT_BIOMES`: a background gradient, a fog colour, a floor edge and a path
tint. Everything at street level was identical everywhere — the same asphalt, the
same lamps, nothing else — and each district had exactly one thing of its own: a
building type set twelve units back from the road. All four were the same road
under a different sky, and choosing between them was choosing a tint.

---

## 1. What a district is now

`DISTRICT_BIOMES[key]` carries, on top of the colours:

| Field | Used by |
|---|---|
| `icon`, `tagline`, `lore` | the arrival banner and the opening briefing |
| `surface` | which ground material is laid under that arc |
| `props` | which roadside prop set dresses it |

| | District | Tagline | Surface | Landmark |
|---|---|---|---|---|
| 🛣️ | **City Ring Road** | The long way round, and the safe one. | asphalt | the fountain plaza (centre) |
| 📈 | **Financial District** | Where the money is, and the money knows it. | polished granite | colonnaded Exchange with a gold arrow |
| 🌃 | **Back Alley** | Nothing here is bolted down. Including you. | wet cracked asphalt, puddles | neon market gate with washing lines |
| 🎪 | **Shopping Promenade** | Everything is for sale and half of it is half price. | patterned paving | glass arcade with bunting |
| ⚙️ | **Industrial Zone** | Behind the Gate, and worth the roll. | concrete with hazard chevrons | twin cooling towers with a beacon |

---

## 2. The three layers

All of it lives inside `_cityEnvGroup` (named `cityEnv`) so `cleanup()` still
frees the city in one go, and so a probe can tell the **city** from the **board** —
tiles, tile icons and player tokens all legitimately stand on a node, and the
dressing must not.

### `_buildDistrictSurfaces()`

A 16×13 slab per node, laid at y −0.55 and rotated along the road, in that
district's own material — plus seams. Industrial gets three wide yellow chevrons
per slab instead of one joint; the Back Alley gets glossy near-black puddles
scattered by a seeded hash.

Per-node slabs rather than re-texturing the ring bands: the surface then follows
the *road* instead of a perfect annulus, and each district can be laid
independently.

### `_buildDistrictDressing()`

Two props per node, one each side, at 6.2 units out (the ring gets one, at 9,
because it already carries lamps on both sides). About one placement in seven is
skipped so the roadside reads as a street rather than a fence.

| Set | Props |
|---|---|
| `finance` | stone planters with clipped hedges · bollard rows · **live stock tickers** |
| `alley` | dumpsters · crate stacks and barrels · **steam vents** · **flickering neon** on brackets |
| `market` | stalls with striped awnings and goods · kiosks · planters · sandwich boards |
| `works` | pipe runs on trestles · stacked cargo containers · hazard cones · **smoking stacks** |
| `civic` | hedge runs · **parked cars** · benches and bins |

Placement is driven by `_seeded()`, a sine hash — so a district looks the same in
every match, but not repetitive within itself.

### `_buildDistrictLandmarks()`

One per district, at its midpoint, 30 units back. Big enough to read from the
opening flyover and from the map view: the Exchange tops out at 18 units, the
cooling towers at 28.

---

## 3. Motion

A city that never moves is a diorama. Four cheap systems run from `_loop()` via
`_animateCityLife()`, all driven off `clock.getElapsedTime()`:

| Kind | What it does |
|---|---|
| `steam` | Puffs march up on staggered phases, scaling and fading as they rise. Used by alley vents, factory stacks and the cooling towers. |
| `neon` | Mostly lit, with an occasional stutter — dead tubes, not a disco. |
| `ticker` | Bars step every ~0.9 s and recolour green or red, so the Exchange is always saying something. |
| `beacon` | The aircraft warning light on the cooling-tower mast. |

`_cityLive` holds a material reference per animated prop, and is cleared in both
`_buildCityScene()` and `cleanup()` — rebuilding without clearing would keep
ticking materials belonging to a disposed scene, which is exactly the leak
`removeAllyMarker()` once had.

---

## 4. Arrival

Turning off the ring into a district used to happen in silence: the sky changed
colour and that was the whole announcement. `_noteDistrictEntry()` now raises the
same banner Hundred Block Dash uses for its realms — icon, name, tagline — the
first time a player enters a district on a lap.

---

## 5. What the probe covers

`qa/districts.js` — 13 assertions, plus ten screenshots (a follow-cam view and a
raised three-quarter view per district):

- every district carries street-level furniture, with a palette of its own and
  props tall enough to be seen over the tiles
- the scenery group is identifiable, and **no prop stands on a playable square**
- every district has a landmark at its midpoint, tall enough to read
- the smoke and steam are actually running (sampled twice, 700 ms apart)
- entering a district announces it, and every district has icon, tagline, lore
- redrawing the board does not duplicate the city

```bash
npx http-server -p 8129 -c-1 &
node qa/districts.js
```

> **Note on the screenshots.** The follow camera sits close and steep, so
> roadside dressing at ±6 units falls outside its frame — a follow-cam
> screenshot cannot show whether a district is dressed. The `-wide` shots use a
> camera set back *inside* the ring looking out; placing it outward puts it
> behind (and usually inside) the district buildings, which is what the first
> pass photographed.
