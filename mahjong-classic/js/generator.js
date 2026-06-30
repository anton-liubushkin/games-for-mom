import { applyPair, isFree, makeBoard } from "./engine.js";

const MAHJONG_SIGNS = [
  "🀇", "🀈", "🀉", "🀊", "🀋", "🀌", "🀍", "🀎", "🀏",
  "🀙", "🀚", "🀛", "🀜", "🀝", "🀞", "🀟", "🀠", "🀡",
  "🀐", "🀑", "🀒", "🀓", "🀔", "🀕", "🀖", "🀗", "🀘",
  "🀀", "🀁", "🀂", "🀃", "🀄", "🀅", "🀆", "🀢", "🀣", "🀤", "🀥",
];
const FLOWERS = ["🌸", "🌹", "🌻", "🌷", "🌼", "🌺", "🪷", "💮", "🏵️", "💐"];
const ANIMALS = ["🐉", "🐢", "🦋", "🦊", "🐼", "🐯", "🦁", "🐸", "🦚", "🦜", "🐠", "🦀"];
const SEASONS = ["❄️", "🌱", "☀️", "🍂", "🌙", "⭐", "🔥", "💧", "⛰️", "🌊", "🍃", "⚡"];

export const SYMBOLS = Object.freeze([...MAHJONG_SIGNS, ...FLOWERS, ...ANIMALS, ...SEASONS]);

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rect(w, h, z, ox = 0, oy = 0) {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.push({ x: ox + x * 2, y: oy + y * 2, z });
  }
  return out;
}

function rows(widths, z, ox = 0, oy = 0) {
  const max = Math.max(...widths);
  const out = [];
  for (let r = 0; r < widths.length; r++) {
    const start = ox + (max - widths[r]);
    for (let c = 0; c < widths[r]; c++) out.push({ x: start + c * 2, y: oy + r * 2, z });
  }
  return out;
}

function unique(coords) {
  const seen = new Set();
  return coords.filter((p) => {
    const key = `${p.x},${p.y},${p.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function layout(id, label, coords) {
  return Object.freeze({ id, label, coords: Object.freeze(unique(coords)) });
}

function turtleCoords() {
  return [
    { x: 0, y: 7, z: 0 }, { x: 26, y: 7, z: 0 },
    ...rect(2, 1, 0, 2, 0), ...rect(2, 1, 0, 2, 14),
    ...rect(4, 1, 0, 4, 0), ...rect(4, 1, 0, 4, 14),
    ...rect(8, 8, 0, 6, 0),
    ...rect(6, 6, 1, 8, 2),
    ...rect(4, 4, 2, 10, 4),
    ...rect(2, 2, 3, 12, 6),
    { x: 13, y: 7, z: 4 }, { x: 15, y: 7, z: 4 },
    ...rect(4, 1, 0, 18, 0), ...rect(4, 1, 0, 18, 14),
    ...rect(2, 1, 0, 22, 0), ...rect(2, 1, 0, 22, 14),
    ...rect(6, 1, 0, 8, 16), ...rect(3, 1, 0, 11, 18), ...rect(3, 1, 0, 30, 7),
  ];
}

export const LAYOUTS = Object.freeze([
  layout("gate", "Ворота", [...rect(8, 5, 0), ...rect(6, 3, 1, 2, 2), ...rect(4, 2, 2, 4, 4)]),
  layout("pyramid", "Пирамида", [...rect(8, 6, 0), ...rect(6, 4, 1, 2, 2), ...rect(4, 3, 2, 4, 4), ...rect(2, 2, 3, 6, 6)]),
  layout("butterfly", "Бабочка", [...rows([3, 5, 7, 7, 5, 3], 0), ...rows([2, 4, 4, 2], 1, 3, 2), ...rect(2, 2, 2, 6, 4)]),
  layout("bridge", "Мост", [...rect(12, 4, 0), ...rect(8, 2, 1, 4, 2), ...rect(4, 2, 2, 8, 2), ...rect(2, 1, 3, 10, 3)]),
  layout("cross", "Крест", [...rows([4, 4, 10, 10, 10, 10, 4, 4], 0), ...rows([2, 6, 6, 2], 1, 4, 4), ...rect(2, 2, 2, 8, 6)]),
  layout("fortress", "Крепость", [...rect(10, 6, 0), ...rect(8, 4, 1, 2, 2), ...rect(6, 2, 2, 4, 4), ...rect(2, 2, 3, 8, 4)]),
  layout("dragon", "Дракон", [...rows([4, 6, 8, 10, 10, 8, 6, 4], 0), ...rows([2, 4, 6, 6, 4, 2], 1, 3, 2), ...rect(3, 2, 2, 8, 6), ...rect(1, 2, 3, 10, 6)]),
  layout("flower", "Цветок", [...rows([2, 6, 8, 10, 8, 6, 2], 0), ...rows([2, 4, 6, 4, 2], 1, 4, 2), ...rect(2, 2, 2, 8, 4)]),
  layout("tower", "Башня", [...rect(6, 8, 0), ...rect(6, 6, 1, 0, 2), ...rect(4, 4, 2, 2, 4), ...rect(2, 2, 3, 4, 6)]),
  layout("crab", "Краб", [...rows([4, 8, 10, 8, 10, 8, 4], 0), ...rows([2, 6, 6, 2], 1, 4, 3), ...rect(2, 2, 2, 8, 5)]),
  layout("temple", "Храм", [...rect(12, 5, 0), ...rect(10, 3, 1, 2, 2), ...rect(6, 2, 2, 6, 4), ...rect(2, 1, 3, 10, 5)]),
  layout("turtle", "Черепаха", turtleCoords()),
]);

export const LEVELS = Object.freeze({
  easy: { label: "Лёгкая", layouts: ["gate", "butterfly", "flower"] },
  medium: { label: "Средняя", layouts: ["pyramid", "bridge", "cross", "tower"] },
  hard: { label: "Сложная", layouts: ["fortress", "dragon", "crab", "temple"] },
  expert: { label: "Эксперт", layouts: ["turtle", "dragon", "fortress", "temple"] },
});

function solveShape(coords, rng) {
  let board = makeBoard(coords.map((p, i) => ({ id: i + 1, type: "?", ...p })));
  const solution = [];

  while (board.tiles.some((tile) => !tile.removed)) {
    const free = shuffle(board.tiles.filter((tile) => !tile.removed && isFree(board, tile.id)), rng);
    if (free.length < 2) return null;
    const topZ = Math.max(...free.map((tile) => tile.z));
    const preferred = free.filter((tile) => tile.z === topZ);
    const pool = preferred.length >= 2 ? preferred : free;
    pool.sort((a, b) => b.z - a.z || a.y - b.y || a.x - b.x);
    const a = pool[0];
    const b = pool[1];
    const res = applyPair(board, a.id, b.id);
    if (!res.ok) return null;
    solution.push([a.id, b.id]);
    board = res.board;
  }
  return solution;
}

function buildSolution(coords, rng) {
  for (let i = 0; i < 80; i++) {
    const solution = solveShape(coords, rng);
    if (solution) return solution;
  }
  throw new Error("Layout has no generated solution");
}

function pickLayout(cfg, rng) {
  const id = cfg.layouts[(rng() * cfg.layouts.length) | 0];
  return LAYOUTS.find((layout) => layout.id === id);
}

export function layoutBounds(coords) {
  const xs = coords.map((p) => p.x);
  const ys = coords.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    unitsX: Math.max(...xs) - Math.min(...xs) + 2,
    unitsY: Math.max(...ys) - Math.min(...ys) + 2,
    layers: Math.max(...coords.map((p) => p.z)) + 1,
  };
}

export function generateLevel(difficulty, rng = Math.random) {
  const cfg = LEVELS[difficulty];
  if (!cfg) throw new Error(`Unknown difficulty: ${difficulty}`);

  const selected = pickLayout(cfg, rng);
  const solution = buildSolution(selected.coords, rng);
  const symbols = shuffle(SYMBOLS.slice(), rng);
  if (symbols.length < solution.length) throw new Error("Symbol pool is too small");

  const typeById = new Map();
  solution.forEach(([a, b], idx) => {
    typeById.set(a, symbols[idx]);
    typeById.set(b, symbols[idx]);
  });

  const board = makeBoard(selected.coords.map((pos, i) => ({
    id: i + 1,
    type: typeById.get(i + 1),
    ...pos,
  })));

  return {
    board,
    difficulty,
    layout: selected,
    bounds: layoutBounds(selected.coords),
    solution,
  };
}
