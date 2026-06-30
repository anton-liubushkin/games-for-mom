// Pure game engine for Mahjong Slide Match.
// No DOM access here so the logic stays testable and reusable.
//
// Grid model: a 2D array `grid[r][c]` where each cell is either `null` (empty)
// or a tile object `{ id, type }`. `id` is a stable unique identifier used for
// animation tracking, `type` is the tile kind (e.g. an emoji string).

export const DIRECTIONS = Object.freeze({
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
});

export const DIRECTION_NAMES = Object.freeze(["up", "down", "left", "right"]);

export function createGrid(rows, cols) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

export function cloneGrid(grid) {
  return grid.map((row) => row.map((cell) => (cell ? { id: cell.id, type: cell.type } : null)));
}

export function inBounds(grid, r, c) {
  return r >= 0 && r < grid.length && c >= 0 && c < grid[0].length;
}

export function countTiles(grid) {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell) n++;
  return n;
}

export function isCleared(grid) {
  return countTiles(grid) === 0;
}

/**
 * The tile at (r, c) plus the contiguous run of tiles that follow it in the
 * `dir` direction (a gap or wall ends the run). Only these tiles move when the
 * player drags toward `dir` — tiles on the opposite side stay put. Returns an
 * array of positions, or an empty array if (r, c) holds no tile.
 */
export function getDirectionalGroup(grid, r, c, dir) {
  if (!inBounds(grid, r, c) || !grid[r][c]) return [];
  const positions = [{ r, c }];
  let nr = r + dir.dr;
  let nc = c + dir.dc;
  while (inBounds(grid, nr, nc) && grid[nr][nc]) {
    positions.push({ r: nr, c: nc });
    nr += dir.dr;
    nc += dir.dc;
  }
  return positions;
}

/** How many cells the block can travel in `dir` before hitting a wall or tile. */
export function computeShift(grid, group, dir) {
  if (group.length === 0) return 0;
  const { dr, dc } = dir;
  // Leading cell is the one furthest along dir.
  const lead = group.reduce((best, p) =>
    (p.r * dr + p.c * dc) > (best.r * dr + best.c * dc) ? p : best
  );
  let shift = 0;
  let nr = lead.r + dr;
  let nc = lead.c + dc;
  while (inBounds(grid, nr, nc) && !grid[nr][nc]) {
    shift++;
    nr += dr;
    nc += dc;
  }
  return shift;
}

/**
 * Slide the block that contains (r, c) in direction `dir`.
 * `steps` caps the travel distance; it is clamped to [0, maxShift].
 * Defaults to Infinity, i.e. slide all the way to the wall/obstacle.
 * Returns the new grid and the per-tile movements (for animation).
 */
export function applySlide(grid, r, c, dirName, steps = Infinity) {
  const dir = DIRECTIONS[dirName];
  const group = getDirectionalGroup(grid, r, c, dir);
  if (group.length === 0) return { grid, moved: false, movedTiles: [], shift: 0 };

  const maxShift = computeShift(grid, group, dir);
  const shift = Math.max(0, Math.min(steps, maxShift));
  if (shift === 0) return { grid, moved: false, movedTiles: [], shift: 0 };

  const next = cloneGrid(grid);
  const moves = group.map((p) => ({
    id: grid[p.r][p.c].id,
    type: grid[p.r][p.c].type,
    from: { r: p.r, c: p.c },
    to: { r: p.r + dir.dr * shift, c: p.c + dir.dc * shift },
  }));

  for (const p of group) next[p.r][p.c] = null;
  for (const m of moves) next[m.to.r][m.to.c] = { id: m.id, type: m.type };

  return { grid: next, moved: true, movedTiles: moves, shift };
}

// ---------- Matching ----------
//
// Matching never happens automatically and never cascades. A tile is cleared
// only as the direct result of an explicit player action — a tap (resolveClick)
// or a drag that lands it next to a same-type tile (resolveMove).
//
// A match is always a PAIR: the active tile plus exactly one partner of the same
// type. Removing two tiles of one type keeps every type's count even, so the
// board can never be left with a single unmatchable tile. When the active tile
// has several equidistant partners the player chooses one (see `nearestPartners`
// and the "select" status returned below).

// Nearest occupied cell from (r, c) along `dir`, skipping empty cells in
// between. Returns its position, or null when the wall is reached first.
function nearestOccupied(grid, r, c, dir) {
  let nr = r + dir.dr;
  let nc = c + dir.dc;
  while (inBounds(grid, nr, nc)) {
    if (grid[nr][nc]) return { r: nr, c: nc };
    nr += dir.dr;
    nc += dir.dc;
  }
  return null;
}

/**
 * Same-type "match partners" of the tile at (r, c): for each of the four
 * directions, the nearest occupied cell counts as a partner when it shares the
 * tile's type (with nothing but empty cells between them). Tiles whose id is in
 * `excludeIds` are skipped — used to ignore other tiles of the same dragged
 * block. Returns an array of partner positions.
 */
export function matchPartners(grid, r, c, excludeIds = null) {
  const tile = grid[r][c];
  if (!tile) return [];
  const partners = [];
  for (const name of DIRECTION_NAMES) {
    const pos = nearestOccupied(grid, r, c, DIRECTIONS[name]);
    if (!pos) continue;
    const neighbor = grid[pos.r][pos.c];
    if (neighbor.type === tile.type && !(excludeIds && excludeIds.has(neighbor.id))) {
      partners.push(pos);
    }
  }
  return partners;
}

// Remove the tiles at `positions` from a (cloned) grid, returning their
// descriptors for animation. Skips empty cells and duplicates.
function removeTiles(grid, positions) {
  const cleared = [];
  for (const p of positions) {
    const cell = grid[p.r][p.c];
    if (!cell) continue;
    cleared.push({ id: cell.id, type: cell.type, r: p.r, c: p.c });
    grid[p.r][p.c] = null;
  }
  return cleared;
}

/**
 * Same-type partners of (r, c) that sit at the *minimum* cell distance. Looks
 * one tile deep in each direction (across empty cells); keeps only the closest,
 * which may be a tie of several. Tiles in `excludeIds` (e.g. the dragged block)
 * are ignored. Returns { partners, distance }.
 */
export function nearestPartners(grid, r, c, excludeIds = null) {
  const tile = grid[r][c];
  if (!tile) return { partners: [], distance: 0 };
  let best = Infinity;
  let partners = [];
  for (const name of DIRECTION_NAMES) {
    const pos = nearestOccupied(grid, r, c, DIRECTIONS[name]);
    if (!pos) continue;
    const neighbor = grid[pos.r][pos.c];
    if (neighbor.type !== tile.type) continue;
    if (excludeIds && excludeIds.has(neighbor.id)) continue;
    const dist = Math.abs(pos.r - r) + Math.abs(pos.c - c);
    if (dist < best) {
      best = dist;
      partners = [pos];
    } else if (dist === best) {
      partners.push(pos);
    }
  }
  return { partners, distance: best === Infinity ? 0 : best };
}

// Remove the pair (active + chosen) from a fresh grid. Always clears two tiles.
export function resolveSelection(grid, active, chosen) {
  const next = cloneGrid(grid);
  const cleared = removeTiles(next, [active, chosen]);
  return { grid: next, cleared };
}

/**
 * Resolve an explicit tap on (r, c).
 * Returns a status:
 *  - "none"    : no match, nothing changes.
 *  - "cleared" : the tile and its single nearest partner are removed
 *                ({ grid, cleared }).
 *  - "select"  : several equidistant partners — the caller must let the player
 *                pick one ({ active, candidates }); the grid is unchanged.
 */
export function resolveClick(grid, r, c) {
  if (!inBounds(grid, r, c) || !grid[r][c]) return { status: "none", grid, cleared: [] };

  const { partners } = nearestPartners(grid, r, c);
  if (partners.length === 0) return { status: "none", grid, cleared: [] };
  if (partners.length > 1) {
    return { status: "select", grid, active: { r, c }, candidates: partners };
  }

  const next = cloneGrid(grid);
  const cleared = removeTiles(next, [{ r, c }, partners[0]]);
  return { status: "cleared", grid: next, cleared };
}

/**
 * Resolve a drag: slide the dragged block by up to `steps` cells in `dir`, then
 * match the grabbed tile (now at its new position) against the nearest same-type
 * tile outside the block.
 *
 * Returns a status alongside the attempted slide in `movedTiles`:
 *  - "reverted": the slide forms no match — the caller animates the block back.
 *  - "cleared" : a unique nearest partner — the slide is kept and the pair
 *                removed ({ grid, movedTiles, cleared }).
 *  - "select"  : several equidistant partners — the slide is kept and the player
 *                picks one ({ grid, movedTiles, active, candidates }).
 */
export function resolveMove(grid, r, c, dirName, steps = Infinity) {
  const slide = applySlide(grid, r, c, dirName, steps);
  if (!slide.moved) return { status: "reverted", grid, movedTiles: [] };

  const dir = DIRECTIONS[dirName];
  const active = { r: r + dir.dr * slide.shift, c: c + dir.dc * slide.shift };
  const groupIds = new Set(slide.movedTiles.map((m) => m.id));
  const { partners } = nearestPartners(slide.grid, active.r, active.c, groupIds);

  if (partners.length === 0) {
    return { status: "reverted", grid, movedTiles: slide.movedTiles };
  }
  if (partners.length > 1) {
    return {
      status: "select",
      grid: slide.grid,
      movedTiles: slide.movedTiles,
      active,
      candidates: partners,
    };
  }

  const next = cloneGrid(slide.grid);
  const cleared = removeTiles(next, [active, partners[0]]);
  return { status: "cleared", grid: next, movedTiles: slide.movedTiles, cleared };
}

/**
 * Non-mutating preview of a drag, used by the UI to highlight the landing lane
 * and any tile the move would clear while the player is still dragging.
 * Returns { dest, partners }; `partners` is empty when the move forms no match
 * (or does not move at all, i.e. it would snap back).
 */
export function previewMove(grid, r, c, dirName, steps) {
  const slide = applySlide(grid, r, c, dirName, steps);
  if (!slide.moved) return { dest: { r, c }, partners: [] };

  const dir = DIRECTIONS[dirName];
  const dest = { r: r + dir.dr * slide.shift, c: c + dir.dc * slide.shift };
  const groupIds = new Set(slide.movedTiles.map((m) => m.id));
  const { partners } = nearestPartners(slide.grid, dest.r, dest.c, groupIds);
  return { dest, partners };
}

// ---------- Analysis helpers ----------

export function stateKey(grid) {
  return grid
    .map((row) => row.map((cell) => (cell ? cell.type : ".")).join("\u0001"))
    .join("\u0002");
}

export function listLegalActions(grid) {
  const rows = grid.length;
  const cols = grid[0].length;
  const actions = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!grid[r][c]) continue;

      const click = resolveClick(grid, r, c);
      if (click.status === "cleared") {
        actions.push({ kind: "tap", r, c });
      } else if (click.status === "select") {
        for (const chosen of click.candidates) {
          actions.push({ kind: "tap", r, c, chosen });
        }
      }

      for (const dir of DIRECTION_NAMES) {
        const group = getDirectionalGroup(grid, r, c, DIRECTIONS[dir]);
        const maxShift = computeShift(grid, group, DIRECTIONS[dir]);
        for (let steps = 1; steps <= maxShift; steps++) {
          const move = resolveMove(grid, r, c, dir, steps);
          if (move.status === "cleared") {
            actions.push({ kind: "drag", r, c, dir, steps });
          } else if (move.status === "select") {
            for (const chosen of move.candidates) {
              actions.push({ kind: "drag", r, c, dir, steps, chosen });
            }
          }
        }
      }
    }
  }

  return actions;
}

export function applyAction(grid, action) {
  if (action.kind === "tap") {
    const result = resolveClick(grid, action.r, action.c);
    if (result.status === "select") {
      return resolveSelection(result.grid, result.active, action.chosen).grid;
    }
    return result.grid;
  }

  if (action.kind === "drag") {
    const result = resolveMove(grid, action.r, action.c, action.dir, action.steps);
    if (result.status === "select") {
      return resolveSelection(result.grid, result.active, action.chosen).grid;
    }
    return result.grid;
  }

  throw new Error(`Unknown action kind: ${action.kind}`);
}

/**
 * Bounded depth-first search for ONE winning sequence of actions that clears the
 * board. Returns an array of actions (empty when already cleared) or null when
 * no solution is found within `budget` expanded nodes. Failed states are
 * memoized so the search never revisits a proven-dead position.
 */
export function solve(grid, { budget = 100000 } = {}) {
  const dead = new Set();
  let nodes = 0;

  function search(current) {
    if (isCleared(current)) return [];
    if (nodes++ > budget) return null;

    const key = stateKey(current);
    if (dead.has(key)) return null;

    for (const action of listLegalActions(current)) {
      const tail = search(applyAction(current, action));
      if (tail) return [action, ...tail];
    }

    dead.add(key);
    return null;
  }

  return search(grid);
}

/**
 * A hint that always lies on a real solution path. When a `reference` map
 * (stateKey -> action) is supplied and contains the current state, that move is
 * returned in O(1). Otherwise the board is solved on demand and the first move
 * of the found solution is returned. Returns null when the board is already
 * cleared or genuinely stuck (the caller should prompt an undo).
 */
export function findSafeHint(grid, reference = null) {
  if (reference) {
    const move = reference.get(stateKey(grid));
    if (move) return move;
  }

  const solution = solve(grid);
  return solution && solution.length > 0 ? solution[0] : null;
}

