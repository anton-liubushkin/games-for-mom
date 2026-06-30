// Board rendering, pointer input and animations.
// Knows nothing about game rules — it only draws state and reports user intent.

import { SYMBOLS } from "./generator.js";
import { DIRECTIONS, getDirectionalGroup, computeShift, previewMove } from "./engine.js";

// Pale pastel background per symbol, derived from its index so the same symbol
// always gets the same colour and the palette scales to any number of symbols.
function tileColors(idx) {
  const hue = ((idx < 0 ? 0 : idx) * 47) % 360;
  return [`hsl(${hue} 60% 82%)`, `hsl(${hue} 52% 72%)`];
}

const AXIS_LOCK_THRESHOLD = 6; // px of movement before the drag axis is decided

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cssMs(el, name) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  return raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
}

export class BoardView {
  constructor({ board, slots, tiles }, handlers = {}) {
    this.board = board;
    this.slots = slots;
    this.tiles = tiles;
    this.handlers = handlers;
    this.elements = new Map(); // id -> tile element
    this.interactive = true;
    this.drag = null;
    this.grid = null; // current grid, kept in sync for drag math

    this._buildGuides();
    this._bindInput();
  }

  // Translucent overlay bars marking the row + column the grabbed tile will land
  // in. They sit above resting tiles but below the dragged/matched tiles.
  _buildGuides() {
    this.guides = document.createElement("div");
    this.guides.className = "guides";
    this.rowBar = document.createElement("div");
    this.rowBar.className = "guide-bar guide-bar-row";
    this.colBar = document.createElement("div");
    this.colBar.className = "guide-bar guide-bar-col";
    this.guides.append(this.rowBar, this.colBar);
    this.board.appendChild(this.guides);
  }

  setInteractive(value) {
    this.interactive = value;
  }

  setGrid(grid) {
    this.grid = grid;
  }

  setLevel(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.board.style.setProperty("--rows", rows);
    this.board.style.setProperty("--cols", cols);
    this.slots.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows * cols; i++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      frag.appendChild(slot);
    }
    this.slots.appendChild(frag);
  }

  renderAll(grid) {
    this.tiles.innerHTML = "";
    this.elements.clear();
    const frag = document.createDocumentFragment();
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) {
        const cell = grid[r][c];
        if (!cell) continue;
        const el = this._createTile(cell, r, c);
        this.elements.set(cell.id, el);
        frag.appendChild(el);
      }
    }
    this.tiles.appendChild(frag);
  }

  // Commit a drag: slide the moved tiles to their new cells, then clear matches.
  async animateCommit(movedTiles, cleared) {
    const slideMs = cssMs(this.board, "--slide-ms");
    for (const m of movedTiles) {
      const el = this.elements.get(m.id);
      if (!el) continue;
      el.classList.remove("dragging"); // re-enable the transition
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--dy", "0px");
      this._setPos(el, m.to.r, m.to.c);
    }
    if (movedTiles.length) await sleep(slideMs);
    await this._clear(cleared);
  }

  // Clear tiles from a tap (no movement).
  async animateClear(cleared) {
    await this._clear(cleared);
  }

  // Snap any lingering dragged tiles back to their original cells (invalid move).
  async revertDrag() {
    const dragged = this.tiles.querySelectorAll(".tile.dragging");
    if (!dragged.length) return;
    for (const el of dragged) {
      el.classList.remove("dragging");
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--dy", "0px");
    }
    await sleep(cssMs(this.board, "--slide-ms"));
  }

  // Tap with no match: pulse + glow the tapped tile and every identical tile on
  // the board, so the player can see where the matching cards are.
  signalNoMatch(r, c) {
    const tapped = this._elementAt(r, c);
    if (!tapped) return;
    const type = tapped.dataset.type;
    for (const el of this.elements.values()) {
      if (el.dataset.type === type) this._restartClass(el, "flash", 1000);
    }
  }

  _restartClass(el, cls, ms) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  highlightHint({ r, c }) {
    const el = this._elementAt(r, c);
    if (!el) return;
    el.classList.remove("hint");
    void el.offsetWidth; // restart the animation
    el.classList.add("hint");
    setTimeout(() => el.classList.remove("hint"), 2200);
  }

  // Highlight the tiles the player can choose between to complete a match.
  markSelectable(positions) {
    for (const { r, c } of positions) {
      this._elementAt(r, c)?.classList.add("selectable");
    }
  }

  clearSelectable() {
    for (const el of this.tiles.querySelectorAll(".tile.selectable")) {
      el.classList.remove("selectable");
    }
  }

  // ---------- internals ----------
  async _clear(cleared) {
    if (!cleared || !cleared.length) return;
    const clearMs = cssMs(this.board, "--clear-ms");
    for (const t of cleared) {
      const el = this.elements.get(t.id);
      if (el) el.classList.add("clearing");
    }
    await sleep(clearMs);
    for (const t of cleared) {
      const el = this.elements.get(t.id);
      if (el) el.remove();
      this.elements.delete(t.id);
    }
  }

  _createTile(cell, r, c) {
    const el = document.createElement("button");
    el.className = "tile";
    el.type = "button";
    const [c1, c2] = tileColors(SYMBOLS.indexOf(cell.type));
    const face = document.createElement("span");
    face.className = "tile-face";
    face.style.setProperty("--c1", c1);
    face.style.setProperty("--c2", c2);
    face.textContent = cell.type;
    el.appendChild(face);
    el.dataset.id = cell.id;
    el.dataset.type = cell.type;
    this._setPos(el, r, c);
    return el;
  }

  _setPos(el, r, c) {
    el.style.setProperty("--r", r);
    el.style.setProperty("--c", c);
    el.dataset.r = r;
    el.dataset.c = c;
  }

  _elementAt(r, c) {
    for (const el of this.elements.values()) {
      if (Number(el.dataset.r) === r && Number(el.dataset.c) === c) return el;
    }
    return null;
  }

  _cellSize() {
    const rect = this.tiles.getBoundingClientRect();
    return { w: rect.width / this.cols, h: rect.height / this.rows };
  }

  _tileFromEvent(e) {
    const node = e.target.closest(".tile");
    if (!node) return null;
    return {
      id: Number(node.dataset.id),
      r: Number(node.dataset.r),
      c: Number(node.dataset.c),
    };
  }

  _bindInput() {
    this.tiles.addEventListener("pointerdown", (e) => {
      if (!this.interactive) return;
      const tile = this._tileFromEvent(e);
      if (!tile) return;
      this.drag = {
        id: tile.id,
        r: tile.r,
        c: tile.c,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        axis: null,
        sign: 0,
        dirName: null,
        group: null,
        max: 0,
        cell: 0,
        offsetCells: 0,
        lastSteps: -1,
      };
      this.tiles.setPointerCapture(e.pointerId);
    });

    this.tiles.addEventListener("pointermove", (e) => {
      const drag = this.drag;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;

      if (drag.axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_THRESHOLD) return;
        const axis = Math.abs(dx) >= Math.abs(dy) ? "h" : "v";
        const sign = (axis === "h" ? dx : dy) >= 0 ? 1 : -1;
        this._beginDrag(drag, axis, sign);
      }

      // Movement projected onto the locked direction (>= 0 means "toward dir").
      const delta = drag.axis === "h" ? dx : dy;
      const along = Math.max(0, Math.min(drag.max, (delta * drag.sign) / drag.cell));
      drag.offsetCells = along;
      const prop = drag.axis === "h" ? "--dx" : "--dy";
      const px = `${along * drag.sign * drag.cell}px`;
      for (const el of drag.group) el.style.setProperty(prop, px);
      this._updateDragGuide(drag);
    });

    this.tiles.addEventListener("pointerup", (e) => {
      const drag = this.drag;
      this.drag = null;
      this._clearDragGuide();
      if (!drag || e.pointerId !== drag.pointerId || !this.interactive) return;

      // No axis lock means the pointer barely moved — treat it as a tap.
      if (drag.axis === null) {
        this.handlers.onClick?.(drag.r, drag.c);
        return;
      }

      const steps = Math.round(drag.offsetCells);
      if (steps === 0) {
        this._snapBack(drag);
        return;
      }
      this.handlers.onMove?.(drag.r, drag.c, drag.dirName, steps);
    });

    this.tiles.addEventListener("pointercancel", (e) => {
      const drag = this.drag;
      this.drag = null;
      this._clearDragGuide();
      if (drag && drag.axis !== null) this._snapBack(drag);
    });
  }

  // Lock the drag to one direction; only the grabbed tile and the tiles ahead
  // of it (in that direction) move.
  _beginDrag(drag, axis, sign) {
    drag.axis = axis;
    drag.sign = sign;
    drag.dirName =
      axis === "h" ? (sign > 0 ? "right" : "left") : sign > 0 ? "down" : "up";
    const dir = DIRECTIONS[drag.dirName];
    const cells = getDirectionalGroup(this.grid, drag.r, drag.c, dir);
    drag.group = cells.map((p) => this._elementAt(p.r, p.c)).filter(Boolean);
    drag.max = computeShift(this.grid, cells, dir);
    const size = this._cellSize();
    drag.cell = axis === "h" ? size.w : size.h;
    for (const el of drag.group) el.classList.add("dragging");
  }

  // Highlight the row + column the grabbed tile will land in, plus any tile the
  // move would match. Recomputed only when the rounded landing cell changes.
  _updateDragGuide(drag) {
    const steps = Math.round(drag.offsetCells);
    if (steps === drag.lastSteps) return;
    drag.lastSteps = steps;
    const { dest, partners } = previewMove(this.grid, drag.r, drag.c, drag.dirName, steps);
    this.rowBar.style.setProperty("--gr", dest.r);
    this.colBar.style.setProperty("--gc", dest.c);
    this.rowBar.classList.add("show");
    this.colBar.classList.add("show");
    this._clearMatchHighlight();
    for (const p of partners) this._elementAt(p.r, p.c)?.classList.add("match-hl");
  }

  _clearDragGuide() {
    this.rowBar.classList.remove("show");
    this.colBar.classList.remove("show");
    this._clearMatchHighlight();
  }

  _clearMatchHighlight() {
    for (const el of this.tiles.querySelectorAll(".tile.match-hl")) {
      el.classList.remove("match-hl");
    }
  }

  // Animate the dragged group back to whole-cell rest (no committed move).
  _snapBack(drag) {
    for (const el of drag.group) {
      el.classList.remove("dragging");
      el.style.setProperty("--dx", "0px");
      el.style.setProperty("--dy", "0px");
    }
  }
}
