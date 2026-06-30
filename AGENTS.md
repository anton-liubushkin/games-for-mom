# Games for Mom

A collection of small, self-contained browser-based mini-games. Each game lives in its
own folder under the repo root with its own README. Currently the only game is
`mahjong-slide-match/`.

## Cursor Cloud specific instructions

### Overview
- `mahjong-slide-match/` is a pure client-side PWA: plain HTML/CSS/ES modules, **no build
  step and no third-party dependencies** (the `package.json` only defines `test`/`serve`
  scripts and has zero dependencies). Node and Python are pre-installed in the base image,
  so there is nothing to install — the startup update script is a no-op.

### Tests
- Pure game-logic tests (engine + solvable-board generator) run with Node, no deps:
  `node tests/engine.test.mjs` from `mahjong-slide-match/` (or `npm test`).

### Run / serve
- Serve as static files; a service worker requires `http(s)://` and will **not** register
  from `file://`. Use the documented `npm run serve` (`python3 -m http.server 8000`) from
  `mahjong-slide-match/`, then open `http://127.0.0.1:8000/`.
- The UI is in Russian: `Новая игра` = New game, `↶` = Undo, `💡` = Hint.

### Lint
- There is no configured linter or lint script in this repo.
