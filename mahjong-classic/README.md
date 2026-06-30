# Mahjong Classic

An offline-first **classic Mahjong Solitaire** puzzle. Remove matching free pairs
from stacked multi-layer layouts. Pure client-side: no server, no build step, no
dependencies. Installable to the iPhone home screen and playable offline as a PWA.

## Rules

- **Layers.** Tiles use classic Mahjong Solitaire coordinates: `x`, `y`, and `z`.
- **Free tiles.** A tile is playable only when no tile overlaps it from above and
  at least its left or right side is open.
- **Matching.** Tap one free tile, then tap a matching free tile. Each action clears
  one pair; matches never cascade.
- **Goal.** Remove every tile from the board. Levels are always solvable.

Controls: tap two matching free tiles. Buttons: **New game** (pick a difficulty and
layout family), **Undo** (step back one move), **Hint** (highlight a playable pair).

## Run locally

A service worker needs `http(s)://` (it will not register from `file://`).

```bash
# any static server works; for example:
python3 -m http.server 8000
# then open http://127.0.0.1:8000
```

## Tests

Pure game logic (classic free-tile rules + solvable layout generator) is covered by Node tests:

```bash
node tests/engine.test.mjs
```

## Install on iPhone (home screen + offline)

iOS Safari only enables service workers over **HTTPS** (or `localhost`), so host the
folder on any static HTTPS host — GitHub Pages, Netlify, Cloudflare Pages, etc.

1. Deploy the project root as static files (e.g. push to a GitHub repo and enable
   GitHub Pages).
2. Open the HTTPS URL in Safari on the iPhone.
3. Share → **Add to Home Screen**.
4. Launch from the icon. After the first load everything is cached and the game runs
   fully offline.

## How levels stay solvable

Each layout stores a list of 3D tile coordinates. The generator first finds a valid
removal order using the real classic free-tile rule, then assigns one picture to
each pair in that order. Replaying the stored pairs therefore clears the board.

The catalog ships 12 layouts with different silhouettes and heights: gates,
pyramids, butterflies, bridges, crosses, fortresses, dragons, flowers, towers,
crabs, temples, and a 144-tile turtle-inspired expert layout.

## Project structure

```
index.html              # markup + PWA meta tags
css/styles.css          # responsive dark UI, layer depth, clear animations
js/engine.js            # pure rules: free tiles, pair matching, hints (no DOM)
js/generator.js         # layout catalog + solvable pair assignment
js/ui.js                # rendering, tap input, animations
js/app.js               # state, controls, persistence, SW registration
sw.js                   # offline cache (app shell)
manifest.webmanifest    # installable PWA metadata
icons/                  # app icons (SVG sources + PNGs)
tests/engine.test.mjs   # Node assertions for engine + generator
```
