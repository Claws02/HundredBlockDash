# Vendored Trystero bundles

`trystero-nostr.min.js` and `trystero-torrent.min.js` are the two WebRTC
matchmaking strategies the online mode uses. They are pre-bundled and committed
for the same reason `three.min.js` and `cannon.min.js` are: this game is a
static site with no build step, and a CDN that is unreachable must not be able
to take the game with it.

**They are bundles, not the published files.** As of 0.25.3 the `trystero`
package on npm is a shim that throws, and the real strategies live in
`@trystero-p2p/*` with unbundled ESM dists that import `@trystero-p2p/core`,
`@noble/secp256k1` and `mqtt` by bare specifier — none of which a browser can
resolve. So each strategy is bundled into one self-contained ES module.

## Rebuilding

```bash
npm install @trystero-p2p/nostr @trystero-p2p/torrent esbuild

echo 'export { joinRoom, selfId, getRelaySockets } from "@trystero-p2p/nostr";' > entry-nostr.mjs
echo 'export { joinRoom, selfId } from "@trystero-p2p/torrent";'               > entry-torrent.mjs

npx esbuild entry-nostr.mjs   --bundle --format=esm --minify --outfile=vendor/trystero-nostr.min.js
npx esbuild entry-torrent.mjs --bundle --format=esm --minify --outfile=vendor/trystero-torrent.min.js
```

Both export `joinRoom(config, roomId, callbacks?) -> Room` and `selfId`.
Trystero is MIT licensed; see `TRYSTERO-LICENSE`.
