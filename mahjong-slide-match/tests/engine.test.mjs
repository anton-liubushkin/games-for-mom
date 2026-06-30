// Lightweight assertion tests for the engine and generator.
// Run with: node tests/engine.test.mjs

import {
  DIRECTIONS,
  getDirectionalGroup,
  matchPartners,
  resolveClick,
  resolveMove,
  resolveSelection,
  listLegalActions,
  applyAction,
  stateKey,
  solve,
  findSafeHint,
  isSolvable,
  countTiles,
  isCleared,
} from "../js/engine.js";
import { generateLevel, LEVELS } from "../js/generator.js";

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}

let nextId = 1;
function makeGrid(rows) {
  nextId = 1;
  return rows.map((row) =>
    [...row].map((ch) => (ch === "." ? null : { id: nextId++, type: ch }))
  );
}

// --- getDirectionalGroup: only the tile + the run ahead of it (in dir) ---
{
  const g = makeGrid(["AB.C"]);
  assert(getDirectionalGroup(g, 0, 0, DIRECTIONS.right).length === 2, "right group from the edge spans the contiguous run (A,B)");
  assert(getDirectionalGroup(g, 0, 1, DIRECTIONS.right).length === 1, "right group from B stops at the gap (B only)");
  assert(getDirectionalGroup(g, 0, 1, DIRECTIONS.left).length === 2, "left group from B includes the tile behind it (B,A)");
}

// --- resolveMove: only tiles in the drag direction move; the rest stay put ---
{
  const g = makeGrid(["XA.A"]); // drag the A at (0,1) right into the gap toward (0,3)
  const res = resolveMove(g, 0, 1, "right", 1);
  assert(res.status === "cleared", "the directional slide that forms a match commits");
  assert(res.grid[0][0] && res.grid[0][0].type === "X", "the tile behind the drag (X) does not move");
  assert(res.cleared.length === 2, "only the matched pair is cleared (even count)");
}

// --- matchPartners: same-type nearest neighbour across empties ---
{
  const g = makeGrid(["AA."]);
  assert(matchPartners(g, 0, 0).length === 1, "adjacent same type is a partner");

  const gap = makeGrid(["A.A"]);
  assert(matchPartners(gap, 0, 0).length === 1, "same type across empty cells is a partner");

  const blocked = makeGrid(["ABA"]);
  assert(matchPartners(blocked, 0, 0).length === 0, "a different tile between blocks the match");
}

// --- resolveClick: clears the tapped tile and its single nearest partner ---
{
  const g = makeGrid(["AA."]);
  const res = resolveClick(g, 0, 0);
  assert(res.status === "cleared" && res.cleared.length === 2, "tapping one of an adjacent pair clears both");
  assert(isCleared(res.grid), "both tiles are gone afterwards");

  const noMatch = makeGrid(["AB."]);
  assert(resolveClick(noMatch, 0, 0).status === "none", "tapping a tile with no match does nothing");
}

// --- resolveClick: only the nearest partner is removed (always an even count) ---
{
  const g = makeGrid(["AA.A"]); // (0,0)A next to (0,1)A; a farther A at (0,3)
  const res = resolveClick(g, 0, 1);
  assert(res.status === "cleared" && res.cleared.length === 2, "the closer partner wins; exactly two tiles clear");
  assert(res.grid[0][3] && res.grid[0][3].type === "A", "the farther A is left untouched");
}

// --- resolveClick: equidistant partners trigger a selection instead of clearing 3 ---
{
  const between = makeGrid(["AAA"]); // tapping the middle has two partners at distance 1
  const res = resolveClick(between, 0, 1);
  assert(res.status === "select", "a tie opens the match-selection mode");
  assert(res.candidates.length === 2, "both equidistant partners are offered");
  assert(countTiles(res.grid) === 3, "nothing is cleared until the player picks");

  const picked = resolveSelection(res.grid, res.active, res.candidates[0]);
  assert(picked.cleared.length === 2, "completing the selection clears exactly the chosen pair");
  assert(countTiles(picked.grid) === 1, "one tile of the trio remains — even parity per type is preserved");
}

// --- resolveClick: cross/intersection tie (one vertical, one horizontal) ---
{
  const cross = makeGrid([
    ".A.",
    "AA.",
    "...",
  ]);
  const res = resolveClick(cross, 1, 1); // partners above (0,1) and left (1,0), both distance 1
  assert(res.status === "select" && res.candidates.length === 2, "an intersection tie also opens selection");
}

// --- resolveMove: a slide that forms a unique match commits and clears a pair ---
{
  const g = makeGrid([
    "A..",
    "...",
    "A..",
  ]);
  const res = resolveMove(g, 2, 0, "up", 1); // bring the lower A next to the upper A
  assert(res.status === "cleared", "a slide that lines up a pair is committed");
  assert(res.cleared.length === 2, "the matched pair is cleared");
  assert(isCleared(res.grid), "nothing else remains");
}

// --- resolveMove: a slide into an equidistant tie opens selection (slide kept) ---
{
  const g = makeGrid([
    "A.A",
    ".A.",
  ]);
  const res = resolveMove(g, 1, 1, "up", 1); // move centre A up to (0,1), between the two A's
  assert(res.status === "select", "a slide that ties two partners opens selection");
  assert(res.candidates.length === 2, "both equidistant partners are offered");
  assert(countTiles(res.grid) === 3, "the slide is kept but nothing clears yet");
}

// --- resolveMove: a slide with no resulting match is rejected (revert) ---
{
  const g = makeGrid([
    "B..",
    "...",
    "A..",
  ]);
  const before = JSON.stringify(g);
  const res = resolveMove(g, 2, 0, "up", 1);
  assert(res.status === "reverted", "a slide that matches nothing is not committed");
  assert(JSON.stringify(res.grid) === before, "the board is left untouched on a rejected move");
}

// --- resolveMove: a completely full board cannot move ---
{
  const full = makeGrid(["AB", "CD"]);
  assert(resolveMove(full, 0, 0, "right", 1).status === "reverted", "no slide is possible on a full board");
}

// --- listLegalActions/applyAction: enumerate committed tap and drag outcomes ---
{
  const tapGrid = makeGrid(["AA."]);
  const tapActions = listLegalActions(tapGrid);
  const tap = tapActions.find((action) => action.kind === "tap");
  assert(tap, "legal actions include a committed tap-match");
  assert(isCleared(applyAction(tapGrid, tap)), "applying a tap action clears the pair");

  const dragGrid = makeGrid([
    "A..",
    "...",
    ".A.",
  ]);
  const dragActions = listLegalActions(dragGrid);
  const drag = dragActions.find(
    (action) => action.kind === "drag" && action.dir === "left" && action.steps === 1
  );
  assert(drag && drag.dir === "left" && drag.steps === 1, "legal actions include a committed drag-match");
  assert(isCleared(applyAction(dragGrid, drag)), "applying a drag action clears the pair");
}

// --- listLegalActions/applyAction: selection outcomes are explicit actions ---
{
  const tie = makeGrid(["AAA"]);
  const middleActions = listLegalActions(tie).filter(
    (action) => action.kind === "tap" && action.r === 0 && action.c === 1
  );
  assert(middleActions.length === 2, "a tie is represented as one legal action per candidate");
  assert(middleActions.every((action) => action.chosen), "selection actions include the chosen partner");
  for (const action of middleActions) {
    assert(countTiles(applyAction(tie, action)) === 1, "applying a selection action clears exactly one pair");
  }
}

// --- stateKey: stable across tile ids, sensitive to positions and types ---
{
  const a = [[{ id: 1, type: "A" }, null, { id: 2, type: "B" }]];
  const b = [[{ id: 9, type: "A" }, null, { id: 10, type: "B" }]];
  const moved = [[null, { id: 9, type: "A" }, { id: 10, type: "B" }]];
  assert(stateKey(a) === stateKey(b), "state keys ignore animation ids");
  assert(stateKey(a) !== stateKey(moved), "state keys include tile positions");
}

// --- solve: returns a winning action sequence or null on deadlock ---
{
  const easy = makeGrid(["AA."]);
  const sol = solve(easy);
  assert(Array.isArray(sol) && sol.length === 1, "solve returns a one-move solution for a single pair");
  let g = easy;
  for (const action of sol) g = applyAction(g, action);
  assert(isCleared(g), "replaying the solution clears the board");

  assert(solve(makeGrid(["AB", "CD"])) === null, "solve returns null on a deadlocked board");

  const ordered = makeGrid([
    ".A.D",
    "CB.C",
    ".DBA",
  ]);
  const sol2 = solve(ordered);
  assert(sol2 !== null, "solve finds a solution for an order-dependent board");
  let g2 = ordered;
  for (const action of sol2) g2 = applyAction(g2, action);
  assert(isCleared(g2), "replaying the found solution clears the order-dependent board");
}

// --- findSafeHint: returns a move on a solution path, null when stuck ---
{
  const board = makeGrid([
    ".A.D",
    "CB.C",
    ".DBA",
  ]);
  const hint = findSafeHint(board);
  assert(hint, "hint exists on a solvable board");
  assert(solve(applyAction(board, hint)) !== null, "the hinted move keeps the board solvable");

  assert(findSafeHint(makeGrid(["AB", "CD"])) === null, "no hint on a dead board");

  const sol = solve(board);
  const reference = new Map();
  let cur = board;
  for (const action of sol) {
    reference.set(stateKey(cur), action);
    cur = applyAction(cur, action);
  }
  assert(findSafeHint(board, reference) === reference.get(stateKey(board)), "reference map provides the canonical hint");
}

// --- isSolvable: agrees with the hint oracle and uses the reference shortcut ---
{
  assert(isSolvable(makeGrid(["AA."])) === true, "a one-pair board is solvable");
  assert(isSolvable(makeGrid(["AB", "CD"])) === false, "a deadlocked board is not solvable");

  const board = makeGrid([
    ".A.D",
    "CB.C",
    ".DBA",
  ]);
  assert(isSolvable(board) === (findSafeHint(board) !== null), "isSolvable agrees with findSafeHint");

  // A state on the reference path is reported solvable without invoking the solver.
  const sol = solve(board);
  const reference = new Map();
  let cur = board;
  for (const action of sol) {
    reference.set(stateKey(cur), action);
    cur = applyAction(cur, action);
  }
  assert(isSolvable(board, reference) === true, "a state on the reference path is solvable in O(1)");

  // Smart-undo invariant: the freshly generated board is always solvable, so
  // rewinding out of a dead end is guaranteed to reach a solvable state.
  for (const difficulty of Object.keys(LEVELS)) {
    assert(isSolvable(generateLevel(difficulty).grid), `${difficulty} starts solvable (smart-undo always terminates)`);
  }
}

function referenceMap(level) {
  const ref = new Map();
  let cur = level.grid;
  for (const action of level.solution) {
    ref.set(stateKey(cur), action);
    cur = applyAction(cur, action);
  }
  return ref;
}

// --- generator: full board, configured tiles per picture, portrait, solvable via reference solution ---
for (const difficulty of Object.keys(LEVELS)) {
  const cfg = LEVELS[difficulty];
  const total = cfg.rows * cfg.cols;
  const tilesPerSymbol = cfg.pairsPerSymbol * 2; // one pair = two tiles
  const expectedUnique = total / tilesPerSymbol;
  let ok = true;
  for (let i = 0; i < 5; i++) {
    const level = generateLevel(difficulty);
    if (countTiles(level.grid) !== total) ok = false; // every cell filled
    if (level.rows !== cfg.rows || level.cols !== cfg.cols) ok = false;
    const counts = new Map();
    for (const row of level.grid) {
      for (const cell of row) counts.set(cell.type, (counts.get(cell.type) || 0) + 1);
    }
    for (const n of counts.values()) if (n !== tilesPerSymbol) ok = false; // configured pairs per picture
    if (counts.size !== expectedUnique) ok = false;

    // the bundled reference solution (taps AND slides) actually clears the board
    let g = level.grid;
    for (const action of level.solution) g = applyAction(g, action);
    if (!isCleared(g)) ok = false;

    if (!findSafeHint(level.grid, referenceMap(level))) ok = false; // never dead on arrival
  }
  assert(total % 2 === 0, `${difficulty} board has an even number of cells`);
  assert(ok, `generator produces solvable full ${difficulty} boards`);
}

// --- slides are mandatory: harder boards force more drags in their solution ---
{
  const countDrags = (solution) => solution.filter((a) => a.kind === "drag").length;
  const avg = (difficulty, fn, n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += fn(generateLevel(difficulty));
    return sum / n;
  };

  for (let i = 0; i < 6; i++) {
    assert(countDrags(generateLevel("hard").solution) >= 1, "every hard board requires at least one slide");
  }

  const hardDrags = avg("hard", (l) => countDrags(l.solution), 8);
  const easyDrags = avg("easy", (l) => countDrags(l.solution), 8);
  assert(hardDrags > easyDrags, "hard needs more slides than easy");
}

// --- difficulty: the symbol pool covers the distinct pictures each board needs, portrait ---
for (const difficulty of Object.keys(LEVELS)) {
  const cfg = LEVELS[difficulty];
  const distinct = Math.ceil((cfg.rows * cfg.cols) / 2 / cfg.pairsPerSymbol);
  assert(cfg.pool.length >= distinct, `${difficulty} symbol pool covers its ${distinct} distinct pictures`);
  assert(cfg.rows > cfg.cols, `${difficulty} board is portrait (rows > cols)`);
}

// --- difficulty: the two hardest levels use a single (unique) pair per picture ---
assert(LEVELS.hard.pairsPerSymbol === 1, "hard uses one pair (two tiles) per picture");
assert(LEVELS.expert.pairsPerSymbol === 1, "expert uses one pair (two tiles) per picture");
assert(LEVELS.easy.pairsPerSymbol === 2 && LEVELS.medium.pairsPerSymbol === 2, "easier levels keep four tiles per picture");

// --- difficulty escalates board size with a clear step ---
assert(LEVELS.easy.rows * LEVELS.easy.cols < LEVELS.medium.rows * LEVELS.medium.cols, "medium is bigger than easy");
assert(LEVELS.medium.rows * LEVELS.medium.cols < LEVELS.hard.rows * LEVELS.hard.cols, "hard is bigger than medium");
assert(LEVELS.hard.rows * LEVELS.hard.cols < LEVELS.expert.rows * LEVELS.expert.cols, "expert is bigger than hard");

// --- difficulty: easy leans on simple tap pairs, hard forces slides (averaged) ---
{
  const tapCount = (level) => level.solution.filter((a) => a.kind === "tap").length;
  const avgTaps = (difficulty, n) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += tapCount(generateLevel(difficulty));
    return sum / n;
  };
  assert(avgTaps("easy", 8) > avgTaps("hard", 8), "easy keeps more tap pairs than hard");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
