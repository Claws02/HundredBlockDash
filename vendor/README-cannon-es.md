# Vendored cannon-es

`cannon-es.min.js` is the physics engine, loaded by `index.html` as the global
`CANNON`. It replaces `cannon.js` 0.6.2, which has had no release since 2015;
cannon-es 0.20.0 is the maintained fork with the same API.

The published package is an ES module. The game loads its engine libraries as
classic scripts (so a missing file shows the boot error instead of a blank
page), so the package is wrapped as one self-contained script.

## Rebuilding

```bash
npm install cannon-es esbuild
echo 'export * from "cannon-es";' > entry-cannon.mjs
npx esbuild entry-cannon.mjs --bundle --format=iife --global-name=CANNON \
    --minify --legal-comments=none --outfile=vendor/cannon-es.min.js
```

## The two differences from cannon.js 0.6.2

`src/claw-core` is shared with an app that may still load the old library, so
the two places that differ check which one is present (`CANNON.BODY_TYPES`
exists only in cannon-es):

- `Cylinder` is built along Y, not Z (`Bowling.js`: the pins no longer need
  standing up).
- `applyImpulse(impulse, point)` takes the point relative to the body, not in
  world space (`Barrage.js`).

cannon-es is MIT licensed; see `CANNON-ES-LICENSE`.
