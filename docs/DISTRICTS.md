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
| `icon`, `tagline`, `lore`, `story` | the arrival banner and the opening briefing |
| `surface` | which ground material is laid under that arc |
| `props` | which roadside prop set dresses it |
| `light` | the district's own lamp — colour, height, radius, and a street-level bounce |
| `motes` | the ambient particles drifting through it |

### The five stories

Each district is written as a **time of day** as much as a place. That is what
keeps them apart at a glance: the Ring Road is midday, the Exchange is a crisp
cold morning, the Night Market is night, the Grand Parade is a warm afternoon,
and the Works is sodium dusk.

> **🛣️ THE LOOP** — Every road in the city eventually comes back to this one. It
> is the safe way round and the slow way round, and the four turnings off it are
> the only real decisions on the board.
>
> **🏦 THE EXCHANGE** — Ten blocks of glass and granite where the numbers on the
> boards decide who eats. Come here to make money fast, and know that the boards
> are watching you do it.
>
> **🌃 THE NIGHT MARKET** — Twelve blocks of somebody else's business. Nothing
> here is bolted down — including you. The longest road on the board and the only
> one where a rival can take something off you.
>
> **🎪 THE GRAND PARADE** — Everything is for sale and half of it is half price.
> The friendliest road on the board — no coin losses at all — and the Grand Mall
> at the end sells the whole shop at half price.
>
> **⚙️ THE WORKS** — Behind the Gate, and worth the roll to get in. Five blocks,
> every one of them pays, and the cooling towers never stop breathing.

| | District | Time of day | Surface | Landmark | Span |
|---|---|---|---|---|---|
| 🛣️ | **City Ring Road** | midday | asphalt | the fountain plaza (centre) | motorway gantry |
| 🏦 | **Financial District** | crisp cold morning | mirror granite | colonnaded Exchange | ticker gantry |
| 🌃 | **Back Alley** | night | wet asphalt, puddles | neon market gate | washing lines + fire escapes |
| 🎪 | **Shopping Promenade** | warm afternoon | patterned paving | glass arcade | bunting arch |
| ⚙️ | **Industrial Zone** | sodium dusk | hazard concrete | twin cooling towers | pipe bridge |

---

## 2. The layers

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

### `_buildDistrictLights()` and lit windows

**The single biggest reason four roads read as one road.** There was one light
rig for the whole city with ambient turned up to 1.2, so every surface came back
the same flat value and the only colour was in the sky gradient — which you
cannot see from a follow camera aimed at the ground.

Ambient dropped to 0.75, and each district now hangs its own lamp over the middle
of its arc in its own colour, plus a warm bounce at street height: the Exchange's
tickers, the alley's neon, the furnace glow. Long districts get two lamps so the
far end of the Back Alley is not left dark.

These are **accents, not floods**. A first pass ran them at 1.5–2.4 and every
surface in a district came back the same single hue — Industrial in particular
went uniformly orange. They now sit at 0.7–1.6.

The other half is **lit windows**. Financial and the Back Alley are canyons —
tall buildings on both sides of a narrow road, and no global illumination to
bounce anything back down — so both were black slabs whatever the lamp did. A
seeded grid of emissive panes (most dark, some warm, some cool) is what makes a
stylised tower read as an office tower, and it is the only light either district
gets at street level from its own buildings. Towers over 22 units also carry a
pulsing red aircraft light.

### `_buildOverheads()`

The element that makes a road feel like a *place* rather than a surface:
something you pass underneath. Two spans per district:

| District | Span |
|---|---|
| Financial | steel gantry carrying a 16-bar ticker board and a gold band |
| Back Alley | tenement walls at the kerb with fire escapes and lit windows, three sagging washing lines, a dead neon sign |
| Promenade | a parade arch with three swags of bunting, a banner and a balloon cluster |
| Industrial | a lattice pipe bridge with three pipes, hazard-striped legs and floodlights aimed at the road |
| Ring Road | motorway gantry signage |

> **The quarter turn matters.** `_facingAngle()` rotates so local +Z points at
> the city centre, which is what a *building* wants — it faces the road. A *span*
> straddles the road, so its legs belong on the inward/outward axis. Without the
> `+ PI/2` the legs stood on the tiles ahead of and behind the node and the deck
> ran along the road instead of over it. `qa/districts.js` caught this as eight
> props standing on playable squares.

## 3. Motion

A city that never moves is a diorama. Four cheap systems run from `_loop()` via
`_animateCityLife()`, all driven off `clock.getElapsedTime()`:

| Kind | What it does |
|---|---|
| `steam` | Puffs march up on staggered phases, scaling and fading as they rise. Used by alley vents, factory stacks and the cooling towers. |
| `neon` | Mostly lit, with an occasional stutter — dead tubes, not a disco. |
| `ticker` | Bars step every ~0.9 s and recolour green or red, so the Exchange is always saying something. |
| `beacon` | Aircraft warning lights — the cooling-tower mast and every tall tower. |
| `motes` | Gold over the Exchange, embers off the alley, confetti on the Promenade, sparks from the Works. Camera-facing quads on a seeded drift, so a flat plane reads as a speck of light from any angle. |

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
- every district has something you pass **underneath**, at least 5 units up
- the districts are lit by their own lamps — at least four distinct light colours,
  not one global rig
- the scenery group is identifiable, and **no prop stands on a playable square**
- every district has a landmark at its midpoint, tall enough to read
- the smoke and steam are actually running (sampled twice, 700 ms apart)
- entering a district announces it, and every district has icon, tagline, lore
- redrawing the board does not duplicate the city

```bash
npx http-server -p 8129 -c-1 &
node qa/districts.js
```

> **Note on the screenshots.** Getting an angle that actually shows a district
> took three tries. The follow camera sits close and steep, so roadside dressing
> at ±6 units falls outside its frame. Placing the camera *outward* puts it
> behind — usually inside — the district buildings, and photographs a wall.
> Placing it *inward* from the city centre photographs the backs of everything.
> The `-wide` shots stand back **along the road and look down it**, which is the
> only angle that shows what a player sees: the span you walk under and the props
> down both kerbs. The HUD is hidden for them, because the action column owns the
> right half of the screen.
