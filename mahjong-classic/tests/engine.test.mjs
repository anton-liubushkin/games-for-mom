// Lightweight assertion tests for the classic Mahjong engine and level set.
// Run with: node tests/engine.test.mjs

import {
  applyPair,
  countTiles,
  findHint,
  getTile,
  isCleared,
  isFree,
  listFreePairs,
  makeBoard,
} from "../js/engine.js";
import { generateLevel, LAYOUTS, LEVELS, SYMBOLS } from "../js/generator.js";

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

function boardFromTiles(tiles) {
  return makeBoard(tiles.map((tile, id) => ({ id: id + 1, ...tile })));
}

function replay(level) {
  let board = level.board;
  for (const pair of level.solution) {
    const res = applyPair(board, pair[0], pair[1]);
    if (!res.ok) return { ok: false, board, reason: res.reason };
    board = res.board;
  }
  return { ok: isCleared(board), board };
}

// --- classic freedom: a tile needs a clear top and at least one open side ---
{
  const board = boardFromTiles([
    { x: 0, y: 0, z: 0, type: "A" },
    { x: -2, y: 0, z: 0, type: "B" },
    { x: 2, y: 0, z: 0, type: "C" },
    { x: 0, y: 0, z: 1, type: "D" },
  ]);
  assert(!isFree(board, 1), "a tile covered from above is not free");
  assert(isFree(board, 4), "the covering tile is free");

  const sides = boardFromTiles([
    { x: 0, y: 0, z: 0, type: "A" },
    { x: -2, y: 0, z: 0, type: "B" },
    { x: 2, y: 0, z: 0, type: "C" },
  ]);
  assert(!isFree(sides, 1), "a tile blocked on both horizontal sides is not free");
  assert(isFree(sides, 2), "a tile with its left side open is free");
}

// --- matching: only two equal free tiles can be removed ---
{
  const board = boardFromTiles([
    { x: 0, y: 0, z: 0, type: "A" },
    { x: 4, y: 0, z: 0, type: "A" },
    { x: 8, y: 0, z: 0, type: "B" },
  ]);
  const ok = applyPair(board, 1, 2);
  assert(ok.ok && ok.cleared.length === 2, "two equal free tiles clear as a pair");
  assert(countTiles(ok.board) === 1, "clearing a pair removes exactly two tiles");
  assert(!applyPair(board, 1, 3).ok, "different pictures cannot be paired");
}

// --- legal moves and hints expose only free equal pairs ---
{
  const board = boardFromTiles([
    { x: 0, y: 0, z: 0, type: "A" },
    { x: 4, y: 0, z: 0, type: "A" },
    { x: 0, y: 0, z: 1, type: "B" },
    { x: 4, y: 0, z: 1, type: "B" },
  ]);
  const pairs = listFreePairs(board);
  assert(pairs.length === 1 && pairs[0][0] === 3 && pairs[0][1] === 4, "only the top free pair is listed");
  assert(findHint(board)?.[0] === 3, "hint points to a currently playable pair");
}

// --- level catalog: many varied layouts with even tile counts and layers ---
{
  const names = new Set(LAYOUTS.map((layout) => layout.id));
  assert(LAYOUTS.length >= 12, "classic ships with many layouts");
  assert(names.size === LAYOUTS.length, "layout ids are unique");
  assert(LAYOUTS.some((layout) => layout.coords.length >= 144), "catalog includes full 144-tile layouts");
  assert(LAYOUTS.every((layout) => layout.coords.length % 2 === 0), "every layout has an even number of tiles");
  assert(LAYOUTS.every((layout) => Math.max(...layout.coords.map((p) => p.z)) >= 1), "every layout uses multiple layers");
  for (const layout of LAYOUTS) {
    for (let i = 0; i < layout.coords.length; i++) {
      for (let j = i + 1; j < layout.coords.length; j++) {
        const a = layout.coords[i];
        const b = layout.coords[j];
        const overlap = a.z === b.z && a.x < b.x + 2 && b.x < a.x + 2 && a.y < b.y + 2 && b.y < a.y + 2;
        assert(!overlap, `${layout.id} has no same-layer overlapping tiles`);
      }
    }
  }
}

// --- generator: levels are built from layouts, use broad picture pool and replay cleanly ---
for (const difficulty of Object.keys(LEVELS)) {
  const cfg = LEVELS[difficulty];
  for (let i = 0; i < 4; i++) {
    const level = generateLevel(difficulty);
    assert(level.difficulty === difficulty, `${difficulty} level keeps its difficulty key`);
    assert(cfg.layouts.includes(level.layout.id), `${difficulty} selects one of its configured layouts`);
    assert(countTiles(level.board) === level.layout.coords.length, `${difficulty} fills every layout position`);
    assert(level.solution.length === level.layout.coords.length / 2, `${difficulty} stores one solution pair per pair of tiles`);
    assert(findHint(level.board, level.solution), `${difficulty} starts with a playable hint`);
    assert(replay(level).ok, `${difficulty} reference solution clears the board`);
  }
}

assert(SYMBOLS.length >= 72, "symbol pool covers a 144-tile board with unique pair art");

// --- lookup: tile ids remain stable until removal ---
{
  const board = boardFromTiles([{ x: 0, y: 0, z: 0, type: "A" }]);
  assert(getTile(board, 1)?.type === "A", "tiles are addressable by stable id");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
