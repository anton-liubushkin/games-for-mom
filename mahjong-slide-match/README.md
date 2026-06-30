# Mahjong Slide

An offline-first **Mahjong Slide Match** puzzle. Slide tiles like a 15-puzzle and
clear identical pairs that line up in a row or column. Pure client-side: no server,
no build step, no dependencies. Installable to the iPhone home screen and playable
offline as a PWA.

## Rules

- **Single layer.** All tiles sit flat on the board with empty cells around them.
- **Sliding.** Grab a tile and drag up / down / left / right. The tile — together
  with the contiguous run of tiles next to it along that axis — follows your pointer
  in real time across empty cells. You can drop it anywhere from one cell up to the
  wall or the next tile (the maximum). Release to snap to the nearest cell. While you
  drag, the row and column the tile will land in are highlighted, and any tile the
  move would match glows green.
- **Matching.** A tap clears the tapped tile with its nearest visible identical
  partner. A drag commits only when the grabbed tile lands in line with an
  identical partner. Each action clears one pair; matches never cascade. Tapping a
  tile with no available match pulses it and every other tile of the same kind.
- **Goal.** Remove every tile from the board. Levels are always solvable.

Controls: drag a tile (touch / mouse) any distance up to the limit, or tap a tile to
clear it with its nearest partner. Buttons: **New game** (pick a difficulty to build
a fresh solvable board), **Undo** (step back one move), **Hint** (highlight a move
that keeps the board solvable).

## Run locally

A service worker needs `http(s)://` (it will not register from `file://`).

```bash
# any static server works; for example:
python3 -m http.server 8000
# then open http://127.0.0.1:8000
```

## Tests

Pure game logic (engine + solvable-board generator) is covered by Node tests:

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

Boards are built by **retrograde construction**: starting from the solved (empty)
grid, the generator applies *inverse* moves until the board is full. Replaying those
moves forward, in reverse order, is therefore always a valid solution — every board
has **at least one solution** by design. Each tile type appears exactly twice, so
matches are never ambiguous.

The interesting inverse move is the reverse **slide**. A forward slide grabs a tile
and pushes it — together with the contiguous run of tiles ahead of it — across empty
cells until the grabbed tile lines up with its partner. Because a whole **group** can
be shoved at once, the partner does not need a clear lane (no direct line of sight
required); tiles in the way are pushed aside. Reversing such a move pulls the group
back and drops the matched pair on an "L" (different row *and* column), so forward it
can only be cleared by sliding, never by a tap. Every candidate slide is verified by
replaying it through the real engine, and the whole reference solution is checked to
clear the board, so a construction slip can never ship an unsolvable level.

A completely full board cannot slide (nothing to push into), so the first moves must
be taps. The generator keeps a few adjacent **tap pairs** (found by a perfect matching
of the leftover cells) to open up the space the slides need.

Difficulty is tuned by board size, the slide-to-tap ratio, and how many tiles share
each picture:

- **Easy** (5×8) and **Medium** (6×10) repeat every picture as two pairs (four tiles),
  so there are many matching options — friendlier to scan. Easy keeps about half the
  board as easy tap pairs (many opening moves, forgiving).
- **Hard** (7×12) and **Expert** (8×12) drop to a single unique pair per picture (two
  tiles), so there is no duplicate to lean on while scanning, and they push almost
  everything to group slides, leaving only a handful of tap pairs to bootstrap — far
  more planning. Expert also packs the most tiles (96) and needs 48 distinct pictures.

Two safeguards mean you never get stuck:

- **Hint** uses the bundled solution for an instant on-path move; if you have strayed
  off that path it runs a bounded solver to find another safe move. It shows the move
  so it is actually followable: the tile to act on pulses, its matching partner gets a
  green ring, and a slide also lights its landing lane with a direction arrow. If the
  solver proves no solution remains, the hint says so up front — the board is a dead end.
- **Undo** steps back through your moves. Once a hint has flagged a dead end, a single
  **Undo** rewinds straight to the most recent solvable position (popping as many moves
  as it takes), so escaping a dead end never means tapping Undo over and over. The rewind
  always succeeds because the starting board is solvable by construction.

## Project structure

```
index.html              # markup + PWA meta tags
css/styles.css          # responsive dark UI, slide/clear animations
js/engine.js            # pure rules: slide, match, solver, hint (no DOM)
js/generator.js         # retrograde generation (group-slide pushes + tap pairs)
js/ui.js                # rendering, swipe/keyboard input, animations
js/app.js               # state, controls, persistence, SW registration
sw.js                   # offline cache (app shell)
manifest.webmanifest    # installable PWA metadata
icons/                  # app icons (SVG sources + PNGs)
tests/engine.test.mjs   # Node assertions for engine + generator
```
