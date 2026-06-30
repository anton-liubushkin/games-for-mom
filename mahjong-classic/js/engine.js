// Pure rules for classic Mahjong Solitaire. Coordinates use half-tile units:
// each tile occupies [x, x + 2) by [y, y + 2), while z is the layer.

export function makeBoard(tiles) {
  return {
    tiles: tiles.map((tile) => ({ ...tile, removed: Boolean(tile.removed) })),
  };
}

export function cloneBoard(board) {
  return makeBoard(board.tiles);
}

export function activeTiles(board) {
  return board.tiles.filter((tile) => !tile.removed);
}

export function getTile(board, id) {
  return board.tiles.find((tile) => tile.id === id && !tile.removed) || null;
}

export function countTiles(board) {
  return activeTiles(board).length;
}

export function isCleared(board) {
  return countTiles(board) === 0;
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

function footprintsOverlap(a, b) {
  return rangesOverlap(a.x, a.x + 2, b.x, b.x + 2) &&
    rangesOverlap(a.y, a.y + 2, b.y, b.y + 2);
}

function sameLayerSideBlock(tile, other, side) {
  if (tile.id === other.id || tile.z !== other.z) return false;
  if (!rangesOverlap(tile.y, tile.y + 2, other.y, other.y + 2)) return false;
  return side === "left" ? other.x + 2 === tile.x : other.x === tile.x + 2;
}

export function isFree(board, id) {
  const tile = getTile(board, id);
  if (!tile) return false;

  const tiles = activeTiles(board);
  const covered = tiles.some((other) =>
    other.id !== tile.id && other.z > tile.z && footprintsOverlap(tile, other)
  );
  if (covered) return false;

  const leftBlocked = tiles.some((other) => sameLayerSideBlock(tile, other, "left"));
  const rightBlocked = tiles.some((other) => sameLayerSideBlock(tile, other, "right"));
  return !leftBlocked || !rightBlocked;
}

export function matchingFreeTiles(board, id) {
  const tile = getTile(board, id);
  if (!tile || !isFree(board, id)) return [];
  return activeTiles(board).filter((other) =>
    other.id !== id && other.type === tile.type && isFree(board, other.id)
  );
}

export function listFreePairs(board) {
  const free = activeTiles(board).filter((tile) => isFree(board, tile.id));
  const pairs = [];
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      if (free[i].type === free[j].type) pairs.push([free[i].id, free[j].id]);
    }
  }
  return pairs;
}

export function applyPair(board, aId, bId) {
  const a = getTile(board, aId);
  const b = getTile(board, bId);
  if (!a || !b) return { ok: false, reason: "missing", board, cleared: [] };
  if (a.id === b.id) return { ok: false, reason: "same-tile", board, cleared: [] };
  if (a.type !== b.type) return { ok: false, reason: "different-type", board, cleared: [] };
  if (!isFree(board, a.id) || !isFree(board, b.id)) {
    return { ok: false, reason: "blocked", board, cleared: [] };
  }

  const next = cloneBoard(board);
  const cleared = [];
  for (const tile of next.tiles) {
    if (tile.id === a.id || tile.id === b.id) {
      tile.removed = true;
      cleared.push({ id: tile.id, type: tile.type, x: tile.x, y: tile.y, z: tile.z });
    }
  }
  return { ok: true, board: next, cleared };
}

export function findHint(board, solution = null) {
  if (solution) {
    for (const [a, b] of solution) {
      if (applyPair(board, a, b).ok) return [a, b];
    }
  }
  return listFreePairs(board)[0] || null;
}

