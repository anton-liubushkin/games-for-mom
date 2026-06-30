// Board rendering and tap input for classic Mahjong Solitaire.
// Knows nothing about pair validity; game rules stay in engine.js.

import { SYMBOLS } from "./generator.js";
import { activeTiles, isFree, matchingFreeTiles } from "./engine.js";

// Pale pastel background per symbol, derived from its index so the same symbol
// always gets the same colour and the palette scales to any number of symbols.
function tileColors(idx) {
  const hue = ((idx < 0 ? 0 : idx) * 47) % 360;
  return [`hsl(${hue} 60% 82%)`, `hsl(${hue} 52% 72%)`];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cssMs(el, name) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  return raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
}

export class BoardView {
  constructor({ board, tiles }, handlers = {}) {
    this.board = board;
    this.tiles = tiles;
    this.handlers = handlers;
    this.elements = new Map(); // id -> tile element
    this.interactive = true;
    this.boardState = null;
    this.bounds = null;
    this._bindInput();
  }

  setInteractive(value) {
    this.interactive = value;
  }

  setBoardState(board) {
    this.boardState = board;
  }

  setLayout(bounds) {
    this.bounds = bounds;
    this.board.style.setProperty("--units-x", bounds.unitsX);
    this.board.style.setProperty("--units-y", bounds.unitsY);
    this.board.style.setProperty("--layers", bounds.layers);
    this.board.style.aspectRatio = `${bounds.unitsX} / ${bounds.unitsY}`;
  }

  renderAll(board) {
    this.setBoardState(board);
    this.tiles.innerHTML = "";
    this.elements.clear();
    const frag = document.createDocumentFragment();
    const sorted = activeTiles(board).sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
    for (const tile of sorted) {
      const el = this._createTile(tile);
      this.elements.set(tile.id, el);
      frag.appendChild(el);
    }
    this.tiles.appendChild(frag);
    this.refreshAvailability(board);
  }

  async animateClear(cleared) {
    await this._clear(cleared);
  }

  refreshAvailability(board) {
    this.setBoardState(board);
    for (const tile of activeTiles(board)) {
      const el = this.elements.get(tile.id);
      if (!el) continue;
      el.classList.toggle("blocked", !isFree(board, tile.id));
    }
  }

  signalNoMatch(id) {
    const tapped = this.elements.get(id);
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

  highlightHint(pair) {
    const HINT_MS = 2300;
    this._clearHint();
    for (const id of pair || []) this.elements.get(id)?.classList.add("hint", "hint-partner");

    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => this._clearHint(), HINT_MS);
  }

  _clearHint() {
    for (const el of this.tiles.querySelectorAll(".tile.hint, .tile.hint-partner")) {
      el.classList.remove("hint", "hint-partner");
    }
  }

  markSelected(id) {
    this.clearSelectable();
    this.elements.get(id)?.classList.add("selected");
    if (!this.boardState) return;
    for (const tile of matchingFreeTiles(this.boardState, id)) {
      this.elements.get(tile.id)?.classList.add("selectable");
    }
  }

  clearSelectable() {
    for (const el of this.tiles.querySelectorAll(".tile.selected, .tile.selectable")) {
      el.classList.remove("selected", "selectable");
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

  _createTile(tile) {
    const el = document.createElement("button");
    el.className = "tile";
    el.type = "button";
    const [c1, c2] = tileColors(SYMBOLS.indexOf(tile.type));
    const face = document.createElement("span");
    face.className = "tile-face";
    face.style.setProperty("--c1", c1);
    face.style.setProperty("--c2", c2);
    face.textContent = tile.type;
    el.appendChild(face);
    el.dataset.id = tile.id;
    el.dataset.type = tile.type;
    this._setPos(el, tile);
    return el;
  }

  _setPos(el, tile) {
    el.style.setProperty("--x", tile.x - this.bounds.minX);
    el.style.setProperty("--y", tile.y - this.bounds.minY);
    el.style.setProperty("--z", tile.z);
    el.dataset.z = tile.z;
    el.style.zIndex = String(10 + tile.z * 100 + tile.y);
  }

  _bindInput() {
    this.tiles.addEventListener("click", (e) => {
      if (!this.interactive) return;
      const node = e.target.closest(".tile");
      if (node) this.handlers.onTile?.(Number(node.dataset.id));
    });
  }
}
