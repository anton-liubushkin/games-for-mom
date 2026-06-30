// Application wiring: state, controls, persistence and the service worker.

import {
  applyPair,
  cloneBoard,
  findHint,
  getTile,
  isCleared,
  isFree,
  matchingFreeTiles,
} from "./engine.js";
import { generateLevel, layoutBounds, LEVELS, LAYOUTS } from "./generator.js";
import { BoardView } from "./ui.js";

const STORAGE_KEY = "mahjong-classic-save-v1";
const DEFAULT_DIFFICULTY = "medium";

const $ = (id) => document.getElementById(id);

const view = new BoardView(
  { board: $("board"), tiles: $("tiles") },
  { onTile: handleTile }
);

const state = {
  difficulty: DEFAULT_DIFFICULTY,
  layout: null,
  bounds: null,
  board: null,
  solution: [],
  moves: 0,
  history: [],
  selectedId: null,
};

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        difficulty: state.difficulty,
        layoutId: state.layout.id,
        board: state.board,
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
    if (!data || !data.board || !LEVELS[data.difficulty]) return null;
    if (!LAYOUTS.some((layout) => layout.id === data.layoutId)) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- game lifecycle ----------
function newGame(difficulty) {
  state.difficulty = difficulty;
  const level = generateLevel(difficulty);
  state.layout = level.layout;
  state.bounds = level.bounds;
  state.board = cloneBoard(level.board);
  state.solution = level.solution;
  state.moves = 0;
  state.history = [];
  state.selectedId = null;
  view.setLayout(level.bounds);
  view.renderAll(state.board);
  hideOverlay();
  closeDifficultyModal();
  refreshUI();
  save();
}

function restoreGame(data) {
  state.difficulty = data.difficulty;
  state.layout = LAYOUTS.find((layout) => layout.id === data.layoutId);
  state.bounds = layoutBounds(state.layout.coords);
  state.board = cloneBoard(data.board);
  state.solution = data.solution || [];
  state.moves = data.moves || 0;
  state.history = [];
  state.selectedId = null;
  view.setLayout(state.bounds);
  view.renderAll(state.board);
  if (isCleared(state.board)) showWin();
  refreshUI();
}

// Snapshot the pre-move grid so a single undo reverts one whole logical move.
function pushHistory() {
  state.history.push(cloneBoard(state.board));
}

function undoStep() {
  state.board = state.history.pop();
  state.moves = Math.max(0, state.moves - 1);
}

// Undo. Normally a single step; but once a hint has proven the board is a dead
// end, one press rewinds straight to the most recent solvable position (popping
// however many moves that takes). The rewind always terminates because the very
// first board is solvable by construction.
async function undo() {
  if (!view.interactive || state.history.length === 0) return;
  cancelSelection();
  undoStep();
  view.renderAll(state.board);
  hideOverlay();
  refreshUI();
  save();
}

function cancelSelection() {
  state.selectedId = null;
  view.clearSelectable();
}

async function handleTile(id) {
  if (!view.interactive) return;
  const tile = getTile(state.board, id);
  if (!tile) return;
  if (!isFree(state.board, id)) {
    view.signalNoMatch(id);
    return;
  }

  if (!state.selectedId) {
    selectTile(id);
    return;
  }

  if (state.selectedId === id) {
    cancelSelection();
    return;
  }

  const result = applyPair(state.board, state.selectedId, id);
  if (!result.ok) {
    selectTile(id);
    return;
  }

  pushHistory();
  cancelSelection();
  state.board = result.board;
  state.moves += 1;
  refreshUI();

  view.setInteractive(false);
  await view.animateClear(result.cleared);
  view.refreshAvailability(state.board);
  view.setInteractive(true);
  save();

  if (isCleared(state.board)) showWin();
}

function selectTile(id) {
  const matches = matchingFreeTiles(state.board, id);
  if (matches.length === 0) {
    cancelSelection();
    view.signalNoMatch(id);
    toast("У этой свободной фишки пока нет открытой пары.");
    return;
  }
  state.selectedId = id;
  view.markSelected(id);
}

function hint() {
  if (!view.interactive) return;
  const pair = findHint(state.board, state.solution);
  if (!pair) return toast("Нет доступных пар. Попробуйте отменить ход.");
  view.highlightHint(pair);
}

// ---------- UI helpers ----------
function refreshUI() {
  view.setBoardState(state.board);
  $("btn-undo").disabled = state.history.length === 0;
  $("level-name").textContent = state.layout ? state.layout.label : "";
  $("moves").textContent = String(state.moves);
  $("moves-word").textContent = plural(state.moves);
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
      `<span class="diff-size">${cfg.layouts.length} раскл.</span>`;
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
