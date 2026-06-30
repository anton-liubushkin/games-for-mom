// Application wiring: state, controls, persistence and the service worker.

import {
  cloneGrid,
  isCleared,
  resolveClick,
  resolveMove,
  resolveSelection,
  applyAction,
  stateKey,
  findSafeHint,
} from "./engine.js";
import { generateLevel, LEVELS } from "./generator.js";
import { BoardView } from "./ui.js";

const STORAGE_KEY = "mahjong-slide-save-v4";
const DEFAULT_DIFFICULTY = "medium";

const $ = (id) => document.getElementById(id);

const view = new BoardView(
  { board: $("board"), slots: $("slots"), tiles: $("tiles") },
  { onMove: handleMove, onClick: handleClick }
);

const state = {
  difficulty: DEFAULT_DIFFICULTY,
  grid: null,
  initialGrid: null, // starting board, kept to rebuild the reference hint map
  solution: [], // canonical winning sequence (tap actions) from generation
  reference: new Map(), // stateKey -> action along the canonical path (O(1) hints)
  moves: 0, // counted only for the win message, not shown live
  history: [], // grid snapshots before each committed move (in-memory undo)
  selection: null, // { active, candidates, pushed } while picking a match
};

// Map every state along the canonical solution to its next action, so hints on
// the intended path are instant. Off-path states fall back to the solver.
function buildReference(initialGrid, solution) {
  const map = new Map();
  let grid = initialGrid;
  for (const action of solution) {
    map.set(stateKey(grid), action);
    grid = applyAction(grid, action);
  }
  return map;
}

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        difficulty: state.difficulty,
        grid: state.grid,
        initialGrid: state.initialGrid,
        solution: state.solution,
        moves: state.moves,
      })
    );
  } catch {
    /* storage may be unavailable; the game still works in-memory */
  }
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!data || !Array.isArray(data.grid) || !LEVELS[data.difficulty]) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- game lifecycle ----------
function newGame(difficulty) {
  state.difficulty = difficulty;
  const level = generateLevel(difficulty);
  state.initialGrid = cloneGrid(level.grid);
  state.grid = cloneGrid(level.grid);
  state.solution = level.solution;
  state.reference = buildReference(state.initialGrid, state.solution);
  state.moves = 0;
  state.history = [];
  cancelSelection();
  view.setLevel(level.rows, level.cols);
  view.renderAll(state.grid);
  hideOverlay();
  closeDifficultyModal();
  refreshUI();
  save();
}

function restoreGame(data) {
  state.difficulty = data.difficulty;
  state.grid = data.grid;
  state.initialGrid = data.initialGrid || data.grid;
  state.solution = data.solution || [];
  state.reference = buildReference(state.initialGrid, state.solution);
  state.moves = data.moves || 0;
  state.history = [];
  cancelSelection();
  view.setLevel(state.grid.length, state.grid[0].length);
  view.renderAll(state.grid);
  if (isCleared(state.grid)) showWin();
  refreshUI();
}

// Snapshot the pre-move grid so a single undo reverts one whole logical move.
function pushHistory() {
  state.history.push(cloneGrid(state.grid));
}

function undo() {
  if (!view.interactive || state.history.length === 0) return;
  cancelSelection();
  state.grid = state.history.pop();
  state.moves = Math.max(0, state.moves - 1);
  view.renderAll(state.grid);
  hideOverlay();
  refreshUI();
  save();
}

// ---------- match selection (player picks among equidistant partners) ----------
function enterSelection(active, candidates, pushed) {
  state.selection = { active, candidates, pushed };
  view.markSelectable(candidates);
}

function cancelSelection() {
  if (!state.selection) return;
  state.selection = null;
  view.clearSelectable();
}

async function completeSelection(chosen) {
  const { active, pushed } = state.selection;
  cancelSelection();
  if (!pushed) pushHistory();
  const result = resolveSelection(state.grid, active, chosen);
  state.grid = result.grid;
  state.moves += 1;
  refreshUI();

  view.setInteractive(false);
  await view.animateClear(result.cleared);
  view.setInteractive(true);
  save();

  if (isCleared(state.grid)) showWin();
}

// Tap a tile. While a selection is pending, a tap either picks a highlighted
// partner or cancels the selection. Otherwise it clears the tile with its single
// nearest partner, opens a selection on a tie, or — when nothing matches —
// signals it by shaking the tile and highlighting every identical tile.
async function handleClick(r, c) {
  if (!view.interactive) return;

  if (state.selection) {
    const chosen = state.selection.candidates.find((p) => p.r === r && p.c === c);
    if (chosen) await completeSelection(chosen);
    else cancelSelection();
    return;
  }

  const result = resolveClick(state.grid, r, c);
  if (result.status === "none") {
    view.signalNoMatch(r, c);
    return;
  }
  if (result.status === "select") {
    enterSelection(result.active, result.candidates, false);
    return;
  }

  pushHistory();
  state.grid = result.grid;
  state.moves += 1;
  refreshUI();

  view.setInteractive(false);
  await view.animateClear(result.cleared);
  view.setInteractive(true);
  save();

  if (isCleared(state.grid)) showWin();
}

// Drag a tile/block. The move is kept only if the grabbed tile lines up with a
// match; on a unique nearest partner the pair clears, on a tie the player picks,
// otherwise the block slides back to where it started.
async function handleMove(r, c, dir, steps) {
  if (!view.interactive) return;
  cancelSelection();

  const result = resolveMove(state.grid, r, c, dir, steps);

  view.setInteractive(false);
  if (result.status === "cleared") {
    pushHistory();
    state.grid = result.grid;
    state.moves += 1;
    refreshUI();
    await view.animateCommit(result.movedTiles, result.cleared);
    save();
    if (isCleared(state.grid)) showWin();
  } else if (result.status === "select") {
    pushHistory(); // the slide already changed the grid; this owns the move
    state.grid = result.grid;
    refreshUI();
    await view.animateCommit(result.movedTiles, []); // slide only; clear on pick
    enterSelection(result.active, result.candidates, true);
  } else {
    await view.revertDrag();
  }
  view.setInteractive(true);
}

function hint() {
  if (!view.interactive) return;
  const move = findSafeHint(state.grid, state.reference);
  if (move) view.highlightHint(move);
  else toast("Этот ход ведёт в тупик — нажмите «Отменить».");
}

// ---------- UI helpers ----------
function refreshUI() {
  view.setGrid(state.grid);
  $("btn-undo").disabled = state.history.length === 0;
}

function renderDifficultyOptions() {
  const list = $("diff-list");
  list.innerHTML = "";
  for (const [key, cfg] of Object.entries(LEVELS)) {
    const btn = document.createElement("button");
    btn.className = "diff-btn";
    btn.type = "button";
    btn.dataset.difficulty = key;
    btn.innerHTML =
      `<span class="diff-name">${cfg.label}</span>` +
      `<span class="diff-size">${cfg.cols}×${cfg.rows}</span>`;
    list.appendChild(btn);
  }
}

function openDifficultyModal() {
  $("difficulty-modal").hidden = false;
}

function closeDifficultyModal() {
  $("difficulty-modal").hidden = true;
}

function showWin() {
  $("overlay-sub").textContent = `Решено за ${state.moves} ${plural(state.moves)}`;
  $("overlay").hidden = false;
}

function hideOverlay() {
  $("overlay").hidden = true;
}

function plural(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "ход";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "хода";
  return "ходов";
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 220);
  }, 2600);
}

// ---------- events ----------
$("btn-new").addEventListener("click", openDifficultyModal);
$("btn-undo").addEventListener("click", undo);
$("btn-hint").addEventListener("click", hint);
$("overlay-again").addEventListener("click", openDifficultyModal);
$("diff-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".diff-btn");
  if (btn) newGame(btn.dataset.difficulty);
});
$("difficulty-modal").addEventListener("click", (e) => {
  if (e.target === $("difficulty-modal")) closeDifficultyModal();
});

// ---------- boot ----------
renderDifficultyOptions();
const saved = load();
if (saved) restoreGame(saved);
else newGame(DEFAULT_DIFFICULTY);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
