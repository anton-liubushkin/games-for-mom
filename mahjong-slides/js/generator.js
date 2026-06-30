// Board generator: every cell is filled at the start of the game.
//
// Levels are built "backwards" (retrograde construction) — the standard way to
// make puzzles with irreversible moves provably solvable (see Sokoban level
// generation): we start from the solved (empty) board and apply INVERSE moves
// until the board is full. Replaying the forward moves in reverse order is then
// a guaranteed solution.
//
// The interesting inverse move is the reverse SLIDE. A forward slide grabs a
// tile and pushes it — together with the contiguous run of tiles ahead of it —
// across empty cells until the grabbed tile lines up with its matching partner.
// Because a whole GROUP can be pushed, the partner does not need a clear lane:
// tiles in the way are shoved aside. Reversing such a move pulls the group back
// and inserts the matched pair on an "L" (different row AND column), so forward
// it can only be cleared by sliding — never by a tap.
//
// A full board cannot slide (nothing to push into), so the first moves must be
// taps; every board therefore keeps a few adjacent TAP pairs (found by a perfect
// matching of the leftover cells) that open up the space the slides need.
//
// Each reverse slide is built then VERIFIED with the real engine (applyAction
// must reproduce the previous state), and the whole reference solution is checked
// to clear the board, so a construction slip can never ship an unsolvable level.

import { createGrid, cloneGrid, applyAction, isCleared } from "./engine.js";

const FRUITS = [
  "🍎", "🍊", "🍋", "🍇", "🍉", "🍓", "🫐", "🥝", "🍏",
  "🍑", "🍒", "🥥", "🍍", "🥭", "🍈", "🍌", "🍐", "🫒",
];
const VEGETABLES = [
  "🥕", "🌶️", "🍅", "🥦", "🌽", "🥒", "🍆", "🧅",
  "🥔", "🫑", "🥬", "🍄", "🧄", "🫛", "🍠",
];
const FLOWERS = ["🌸", "🌹", "🌻", "🌷", "🌼", "🌺", "💐", "🏵️", "🪷", "💮", "🥀"];

// Master list — used for stable per-symbol colouring in the UI.
export const SYMBOLS = Object.freeze([...FRUITS, ...VEGETABLES, ...FLOWERS]);

// Each distinct picture is used for two pairs, so the board shows FOUR tiles of
// every kind. More identical tiles means more matching options, which makes the
// puzzle a bit easier and friendlier to read.
const PAIRS_PER_SYMBOL = 2;

// Portrait boards (rows > cols) for mobile screens. `slideRatio` is the share of
// pairs we try to make slide-only: easy keeps about half as easy tap pairs, hard
// pushes almost everything to slides (only a few tap pairs to open the board).
// `unique` is the number of distinct pictures (each appears as two pairs / four
// tiles), i.e. half the pair count.
export const LEVELS = Object.freeze({
  easy: { label: "Лёгкая", cols: 5, rows: 8, unique: 10, pool: SYMBOLS, slideRatio: 0.5 },
  medium: { label: "Средняя", cols: 6, rows: 10, unique: 15, pool: SYMBOLS, slideRatio: 0.8 },
  hard: { label: "Сложная", cols: 7, rows: 12, unique: 21, pool: SYMBOLS, slideRatio: 0.97 },
});

const GENERATION_ATTEMPTS = 12;
const MAX_SLIDE_STEPS = 10; // longest single push we attempt (capped per board below)
const PARTNER_FAR_BIAS = 2.2; // >1 skews the partner pick toward the far end of its lane
const DISTANCE_WEIGHT = 0.32; // how much pair distance outweighs empty-area fragmentation
const CANDIDATE_POOL = 26; // valid candidates gathered per slide; the best-scoring one wins
const CANDIDATE_GUARD = 900; // cap on raw attempts while gathering that pool

const DIRS = Object.freeze([
  { dr: 0, dc: 1, name: "right" },
  { dr: 0, dc: -1, name: "left" },
  { dr: 1, dc: 0, name: "down" },
  { dr: -1, dc: 0, name: "up" },
]);
const ADJ = Object.freeze([[0, 1], [0, -1], [1, 0], [-1, 0]]);

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function inBounds(grid, r, c) {
  return r >= 0 && r < grid.length && c >= 0 && c < grid[0].length;
}

function sameTypes(a, b) {
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[0].length; c++) {
      const x = a[r][c];
      const y = b[r][c];
      if ((x ? x.type : null) !== (y ? y.type : null)) return false;
    }
  }
  return true;
}

// Maximum matching of empty cells via grid adjacency (bipartite by checkerboard
// colour). A complete matching is a domino tiling of the empty region. Returns
// { complete, pairs } where each pair is two adjacent empty cells.
function computeMatching(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const blacks = [];
  const whites = [];
  const whiteIndex = new Map();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) continue;
      if ((r + c) & 1) {
        whiteIndex.set(r * cols + c, whites.length);
        whites.push({ r, c });
      } else {
        blacks.push({ r, c });
      }
    }
  }
  if (blacks.length !== whites.length) return { complete: false, pairs: [] };

  const matchOfWhite = new Array(whites.length).fill(-1);
  const augment = (bi, seen) => {
    const b = blacks[bi];
    for (const [dr, dc] of ADJ) {
      const nr = b.r + dr;
      const nc = b.c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc]) continue;
      const wi = whiteIndex.get(nr * cols + nc);
      if (wi === undefined || seen[wi]) continue;
      seen[wi] = true;
      if (matchOfWhite[wi] === -1 || augment(matchOfWhite[wi], seen)) {
        matchOfWhite[wi] = bi;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let bi = 0; bi < blacks.length; bi++) {
    if (augment(bi, new Array(whites.length).fill(false))) matched++;
  }
  if (matched !== blacks.length) return { complete: false, pairs: [] };

  const pairs = [];
  for (let wi = 0; wi < whites.length; wi++) pairs.push([blacks[matchOfWhite[wi]], whites[wi]]);
  return { complete: true, pairs };
}

// Number of connected (orthogonally adjacent) empty regions. A less fragmented
// empty area leaves more room for further slides, so we prefer placements that
// keep this small.
function emptyComponents(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const seen = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] || seen[r][c]) continue;
      count++;
      const stack = [[r, c]];
      seen[r][c] = true;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        for (const [dr, dc] of ADJ) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (inBounds(grid, nr, nc) && !grid[nr][nc] && !seen[nr][nc]) {
            seen[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }
    }
  }
  return count;
}

// Build ONE candidate reverse slide on `grid` (the post-move state). Picks a
// landing L, a slide direction/length, the contiguous group just past L, and a
// perpendicular partner Q; pulls the group back so the pair sits on an L, then
// asks the engine to play the move forward and checks it reproduces `grid`.
// Returns { grid: prevState, action } or null when the random pick is invalid.
function reverseSlideCandidate(grid, rng, type, nextId) {
  const rows = grid.length;
  const cols = grid[0].length;
  const empties = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!grid[r][c]) empties.push({ r, c });
  if (empties.length < 3) return null;

  const L = empties[(rng() * empties.length) | 0];
  const dir = DIRS[(rng() * DIRS.length) | 0];
  const maxStep = Math.min(MAX_SLIDE_STEPS, Math.max(rows, cols) - 1);
  const s = 1 + ((rng() * maxStep) | 0);
  const A = { r: L.r - s * dir.dr, c: L.c - s * dir.dc };
  if (!inBounds(grid, A.r, A.c)) return null;

  // Corridor A..L (the vacated lane + landing) must be empty.
  for (let t = 0; t <= s; t++) {
    if (grid[A.r + t * dir.dr][A.c + t * dir.dc]) return null;
  }

  // The contiguous group of tiles just past the landing (pushed forward by s).
  const group = [];
  let gr = L.r + dir.dr;
  let gc = L.c + dir.dc;
  while (inBounds(grid, gr, gc) && grid[gr][gc]) {
    group.push({ r: gr, c: gc });
    gr += dir.dr;
    gc += dir.dc;
  }

  // Perpendicular partner Q: an empty cell co-linear with the landing across
  // empty cells (a clear match line). Different row AND column from A => L-shape.
  // Bias the pick toward the far end of the lane so pairs are spread apart, up to
  // opposite edges of the board.
  const perps = dir.dr !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
  const qcands = [];
  for (const [er, ec] of perps) {
    let qr = L.r + er;
    let qc = L.c + ec;
    while (inBounds(grid, qr, qc) && !grid[qr][qc]) {
      qcands.push({ r: qr, c: qc });
      qr += er;
      qc += ec;
    }
  }
  if (qcands.length === 0) return null;
  qcands.sort((p, q) =>
    (Math.abs(q.r - L.r) + Math.abs(q.c - L.c)) - (Math.abs(p.r - L.r) + Math.abs(p.c - L.c))
  );
  const Q = qcands[(rng() ** PARTNER_FAR_BIAS * qcands.length) | 0]; // index 0 = farthest

  // Construct the previous state: pull the group back by s, drop T at A and Q.
  const prev = cloneGrid(grid);
  for (const g of group) prev[g.r][g.c] = null;
  for (let i = 0; i < group.length; i++) {
    const cell = grid[group[i].r][group[i].c];
    prev[A.r + (i + 1) * dir.dr][A.c + (i + 1) * dir.dc] = { id: cell.id, type: cell.type };
  }
  prev[A.r][A.c] = { id: nextId(), type };
  prev[Q.r][Q.c] = { id: nextId(), type };

  // `chosen` pins the exact partner so replay stays deterministic even when the
  // same picture appears elsewhere (several pairs share a symbol now).
  const action = { kind: "drag", r: A.r, c: A.c, dir: dir.name, steps: s, chosen: { r: Q.r, c: Q.c } };
  const dist = Math.abs(A.r - Q.r) + Math.abs(A.c - Q.c); // span of the L-shaped pair
  try {
    if (sameTypes(applyAction(prev, action), grid)) return { grid: prev, action, dist };
  } catch {
    // Forward move can't reproduce this state (e.g. a nearer same-type tile would
    // be matched instead): discard this candidate.
  }
  return null;
}

// Gather a pool of valid candidate slides and return the best-scoring one. The
// score rewards a wide L-shaped pair (harder to spot) while penalising a
// fragmented empty area (so the next slides still have room) — lower is better.
// With `requireTileable` every accepted state is provably domino-tileable, so the
// build can never strand an untileable remainder (used as a guaranteed fallback);
// the cheaper default packs denser and lets the caller retry on a dead end.
// Returns null when no candidate exists, which ends the slide phase.
function bestReverseSlide(grid, rng, type, nextId, requireTileable) {
  let best = null;
  let bestScore = Infinity;
  let found = 0;
  for (let guard = 0; guard < CANDIDATE_GUARD && found < CANDIDATE_POOL; guard++) {
    const cand = reverseSlideCandidate(grid, rng, type, nextId);
    if (!cand || !fillable(cand.grid)) continue; // cheap necessary pre-filter
    if (requireTileable && !computeMatching(cand.grid).complete) continue;
    found++;
    const score = emptyComponents(cand.grid) - DISTANCE_WEIGHT * cand.dist;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

// Cheap necessary condition for a domino fill: an even number of empty cells and
// no empty cell stranded without an empty orthogonal neighbour.
function fillable(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  let empties = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c]) continue;
      empties++;
      let hasEmptyNeighbour = false;
      for (const [dr, dc] of ADJ) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBounds(grid, nr, nc) && !grid[nr][nc]) { hasEmptyNeighbour = true; break; }
      }
      if (!hasEmptyNeighbour) return false;
    }
  }
  return empties % 2 === 0;
}

// Retrograde build: add slide pairs (group pushes allowed) while the leftover
// stays domino-fillable, then fill the rest with adjacent tap pairs. With
// `requireTileable` it always succeeds; otherwise it packs denser and returns
// null when the final tiling fails (the caller retries).
function build(rows, cols, symbols, rng, slideRatio, requireTileable = false) {
  let grid = createGrid(rows, cols);
  const pairs = (rows * cols) / 2;
  const slideTarget = Math.min(pairs - 1, Math.round(pairs * slideRatio));
  const forward = [];
  let symIdx = 0;
  let nextIdValue = 1;
  const nextId = () => nextIdValue++;

  while (symIdx < slideTarget) {
    const res = bestReverseSlide(grid, rng, symbols[symIdx], nextId, requireTileable);
    if (!res) break; // no further slide fits — fill the rest with taps
    grid = res.grid;
    forward.push(res.action);
    symIdx++;
  }

  const matching = computeMatching(grid);
  if (!matching.complete) return null; // only possible without requireTileable
  for (const [b, w] of matching.pairs) {
    const type = symbols[symIdx++];
    grid[b.r][b.c] = { id: nextId(), type };
    grid[w.r][w.c] = { id: nextId(), type };
    // `chosen` pins the adjacent partner so the tap clears this exact pair even
    // when another tile of the same picture is also next to it.
    forward.push({ kind: "tap", r: b.r, c: b.c, chosen: { r: w.r, c: w.c } });
  }

  return { grid, solution: forward.slice().reverse() };
}

// Replay the reference solution to be certain it clears the board.
function solutionClears(grid, solution) {
  let g = grid;
  for (const action of solution) g = applyAction(g, action);
  return isCleared(g);
}

// A shuffled list of `pairs` symbols where each picture is repeated
// PAIRS_PER_SYMBOL times, so the board ends up with four tiles of each kind. If
// `pairs` is not a multiple of PAIRS_PER_SYMBOL the trailing picture appears fewer
// times — never an odd tile, since the count is always a whole number of pairs.
function pickPairSymbols(pool, pairs, rng) {
  const distinct = Math.ceil(pairs / PAIRS_PER_SYMBOL);
  const picks = shuffle(pool.slice(), rng).slice(0, distinct);
  const list = [];
  for (const sym of picks) {
    for (let k = 0; k < PAIRS_PER_SYMBOL; k++) list.push(sym);
  }
  return shuffle(list, rng).slice(0, pairs);
}

/**
 * Generate a fully-filled, solvable level for the given difficulty.
 * Returns { grid, rows, cols, difficulty, solution } where `solution` is the
 * list of actions (tap/drag, with group pushes) that clears the board.
 */
export function generateLevel(difficulty, rng = Math.random) {
  const cfg = LEVELS[difficulty];
  if (!cfg) throw new Error(`Unknown difficulty: ${difficulty}`);

  const { rows, cols, pool, slideRatio } = cfg;
  const pairs = (rows * cols) / 2;
  const distinct = Math.ceil(pairs / PAIRS_PER_SYMBOL);
  if (pool.length < distinct) throw new Error(`Symbol pool too small for ${difficulty}`);

  let built = null;
  // Pack slides aggressively; a dense pack occasionally strands an untileable
  // remainder, so just try a few fresh boards.
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS && !built; attempt++) {
    const symbols = pickPairSymbols(pool, pairs, rng);
    const candidate = build(rows, cols, symbols, rng, slideRatio, false);
    if (candidate && solutionClears(candidate.grid, candidate.solution)) built = candidate;
  }
  if (!built) {
    // Guaranteed fallback: keeping every step domino-tileable always succeeds
    // (slightly fewer slides, never a slide-poor or unsolvable board).
    const symbols = pickPairSymbols(pool, pairs, rng);
    built = build(rows, cols, symbols, rng, slideRatio, true);
  }

  return { grid: built.grid, rows, cols, difficulty, solution: built.solution };
}
