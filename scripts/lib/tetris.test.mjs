// Tests for the pure game logic in assets/tetris.js (the overlay UI is not loaded in node).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, PIECES, COLS, ROWS, LOCK_DELAY, gravityMs } from "../../assets/tetris.js";

// Deterministic random numbers so every run deals the same pieces.
const seededRandom = (seed = 1) => {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
};
const newGame = (seed) => createGame({ random: seededRandom(seed) });
const sortCells = (cells) => cells.map(([x, y]) => `${x},${y}`).sort();
const filled = (state) => state.board.flat().filter(Boolean).length;

test("starts with an empty 10x20 board and a falling piece at the top", () => {
  const game = newGame(1);
  const state = game.getState();
  assert.equal(state.board.length, ROWS);
  assert.equal(state.board[0].length, COLS);
  assert.equal(filled(state), 0);
  assert.ok(state.active);
  assert.ok(state.active.cells.every(([, y]) => y >= 0 && y <= 1), "piece is visible in the top rows");
  assert.equal(state.score, 0);
  assert.equal(state.level, 1);
  assert.equal(state.over, false);
  assert.equal(state.next.length, 5);
});

test("moves left and right until a wall stops it", () => {
  const game = newGame(2);
  game.testing.setBoard([]);
  game.testing.spawn("O"); // O occupies columns 4-5
  let moves = 0;
  while (game.moveLeft()) moves++;
  assert.equal(moves, 4);
  assert.equal(Math.min(...game.getState().active.cells.map(([x]) => x)), 0);
  assert.equal(game.moveLeft(), false);
  moves = 0;
  while (game.moveRight()) moves++;
  assert.equal(moves, 8);
  assert.equal(Math.max(...game.getState().active.cells.map(([x]) => x)), COLS - 1);
});

test("blocks on the board stop sideways moves", () => {
  const game = newGame(3);
  // a wall of blocks in column 2 near the top
  game.testing.setBoard(Array.from({ length: ROWS }, (_, y) => (y < 3 ? "..X......." : "..........")));
  game.testing.place("O", 0, 2, 0); // box x=2 -> cells at columns 3-4, rows 0-1
  assert.equal(game.moveLeft(), false, "column 2 is filled");
  assert.equal(game.moveRight(), true);
});

test("gravity drops the piece one row per interval and it locks after the lock delay", () => {
  const game = newGame(4);
  game.testing.setBoard([]);
  game.testing.spawn("T");
  const y0 = game.getState().active.y;
  game.tick(gravityMs(1) - 1);
  assert.equal(game.getState().active.y, y0);
  game.tick(2);
  assert.equal(game.getState().active.y, y0 + 1);
  // fall to the floor
  for (let i = 0; i < 40 && !game.getState().grounded; i++) game.tick(gravityMs(1));
  const grounded = game.getState();
  assert.equal(grounded.grounded, true);
  assert.equal(filled(grounded), 0, "not locked yet: lock delay still running");
  game.tick(LOCK_DELAY);
  assert.equal(filled(game.getState()), 4);
});

test("hard drop lands on the floor, scores 2 per row and locks", () => {
  const game = newGame(5);
  game.testing.setBoard([]);
  game.testing.spawn("I");
  const rows = game.hardDrop();
  assert.equal(rows, ROWS - 1);
  const state = game.getState();
  assert.equal(state.score, 2 * (ROWS - 1));
  assert.deepEqual(sortCells(state.board.flatMap((row, y) => row.map((c, x) => (c ? [x, y] : null)).filter(Boolean))), sortCells([[3, 19], [4, 19], [5, 19], [6, 19]]));
});

test("soft drop moves down and scores 1 point per row", () => {
  const game = newGame(6);
  game.testing.setBoard([]);
  game.testing.spawn("L");
  const y0 = game.getState().active.y;
  assert.equal(game.softDrop(), true);
  assert.equal(game.softDrop(), true);
  assert.equal(game.getState().active.y, y0 + 2);
  assert.equal(game.getState().score, 2);
});

test("rotation follows SRS and the O piece never moves", () => {
  const game = newGame(7);
  game.testing.setBoard([]);
  game.testing.place("T", 0, 3, 5);
  assert.equal(game.rotateCW(), true);
  const t = game.getState().active;
  assert.equal(t.rotation, 1);
  // T pointing right: vertical bar in the middle column, nub to the right
  assert.deepEqual(sortCells(t.cells), sortCells([[4, 5], [4, 6], [5, 6], [4, 7]]));
  game.rotateCCW();
  assert.equal(game.getState().active.rotation, 0);

  game.testing.place("O", 0, 3, 5);
  const before = sortCells(game.getState().active.cells);
  game.rotateCW();
  assert.deepEqual(sortCells(game.getState().active.cells), before);

  game.testing.place("I", 0, 3, 5);
  game.rotateCW();
  assert.deepEqual(sortCells(game.getState().active.cells), sortCells([[5, 5], [5, 6], [5, 7], [5, 8]]));
});

test("wall kick: a vertical I against the left wall still rotates", () => {
  const game = newGame(8);
  game.testing.setBoard([]);
  // I in state L (3) has its cells in box column 1; box x=-1 puts it flush against the left wall.
  assert.equal(game.testing.place("I", 3, -1, 5), true);
  assert.ok(game.getState().active.cells.every(([x]) => x === 0));
  // Rotating to state 0 without a kick would put a cell at x = -1; SRS kicks it right.
  assert.equal(game.rotateCW(), true);
  const cells = game.getState().active.cells;
  assert.equal(game.getState().active.rotation, 0);
  assert.ok(cells.every(([x]) => x >= 0 && x < COLS));
  assert.equal(new Set(cells.map(([, y]) => y)).size, 1, "horizontal again");
});

test("wall kick: T rotates out of a tight spot and fails when there is no room", () => {
  const game = newGame(9);
  game.testing.setBoard([]);
  game.testing.place("T", 0, 7, 10); // box x=7: cells at columns 7-9
  assert.equal(game.rotateCCW(), true, "rotation against the right wall works");
  const boxed = newGame(10);
  // fill everything except a 3-wide, 2-tall slot: the flat T fits, no rotation can
  boxed.testing.setBoard(Array.from({ length: ROWS }, (_, y) => (y === 10 ? "XXXX.XXXXX" : y === 11 ? "XXX...XXXX" : "XXXXXXXXXX")));
  assert.equal(boxed.testing.place("T", 0, 3, 10), true);
  assert.equal(boxed.rotateCW(), false);
  assert.equal(boxed.rotateCCW(), false);
});

test("line clears remove rows, shift the stack down and score by level", () => {
  const game = newGame(11);
  const rows = Array.from({ length: ROWS }, () => "..........");
  rows[18] = "XXXXXX....";
  rows[19] = "XXXXXX....";
  rows[17] = "X.........";
  game.testing.setBoard(rows);
  game.testing.place("O", 0, 5, 0); // cells at columns 6-7
  game.hardDrop();
  let state = game.getState();
  assert.equal(state.lines, 0, "columns 8-9 still open");
  const events = game.drainEvents().map((e) => e.type);
  assert.ok(events.includes("lock"));

  game.testing.place("O", 0, 7, 0); // cells at columns 8-9
  const before = state.score;
  game.hardDrop();
  state = game.getState();
  assert.equal(state.lines, 2);
  assert.equal(state.score - before, 300 + 2 * 18, "double = 300 x level 1, plus hard drop");
  // the lone block from row 17 fell to the bottom row
  assert.equal(state.board[19][0], "G");
  assert.equal(filled(state), 1);
  const clear = game.drainEvents().find((e) => e.type === "clear");
  assert.deepEqual(clear.rows, [18, 19]);
  assert.equal(clear.count, 2);
});

test("a tetris scores 800 and ten lines raise the level", () => {
  const game = newGame(12);
  const rows = Array.from({ length: ROWS }, () => "..........");
  for (let y = 16; y < 20; y++) rows[y] = "XXXXXXXXX.";
  game.testing.setBoard(rows);
  game.testing.place("I", 1, 7, 0); // vertical I in column 9
  game.hardDrop();
  let state = game.getState();
  assert.equal(state.lines, 4);
  assert.equal(state.score, 800 + 2 * 16);
  assert.equal(filled(state), 0);

  for (let i = 0; i < 2; i++) {
    game.testing.setBoard(rows);
    game.testing.place("I", 1, 7, 0);
    game.hardDrop();
  }
  state = game.getState();
  assert.equal(state.lines, 12);
  assert.equal(state.level, 2);
  assert.ok(game.drainEvents().some((e) => e.type === "level" && e.level === 2));
  assert.ok(gravityMs(2) < gravityMs(1), "higher level falls faster");
});

test("game over when a new piece cannot spawn", () => {
  const game = newGame(13);
  const rows = Array.from({ length: ROWS }, (_, y) => (y < 2 ? "...XXXX..." : ".........."));
  game.testing.setBoard(rows);
  assert.equal(game.testing.spawn("T"), false);
  const state = game.getState();
  assert.equal(state.over, true);
  assert.equal(state.active, null);
  assert.ok(game.drainEvents().some((e) => e.type === "over"));
  // nothing moves after game over
  assert.equal(game.moveLeft(), false);
  assert.equal(game.hardDrop(), 0);
  game.reset();
  assert.equal(game.getState().over, false);
  assert.equal(filled(game.getState()), 0);
});

test("stacking to the top ends the game", () => {
  const game = newGame(14);
  for (let i = 0; i < 200 && !game.getState().over; i++) game.hardDrop();
  assert.equal(game.getState().over, true);
});

test("7-bag: every run of 7 pieces from a bag boundary has each piece exactly once", () => {
  const game = newGame(15);
  const dealt = [game.getState().active.type];
  for (let i = 0; i < 69; i++) {
    game.testing.setBoard([]); // keep the board empty so the game never ends
    game.hardDrop();
    dealt.push(game.getState().active.type);
  }
  assert.equal(dealt.length, 70);
  for (let bag = 0; bag < 10; bag++) {
    const slice = dealt.slice(bag * 7, bag * 7 + 7);
    assert.deepEqual([...slice].sort(), [...PIECES].sort(), `bag ${bag}: ${slice.join("")}`);
  }
  // different seeds deal in a different order
  const other = newGame(99);
  const otherFirst = [other.getState().active.type, ...other.getState().next.slice(0, 5)];
  assert.notDeepEqual(otherFirst, dealt.slice(0, 6));
});

test("hold swaps once per piece", () => {
  const game = newGame(16);
  const first = game.getState().active.type;
  const upcoming = game.getState().next[0];
  assert.equal(game.hold(), true);
  assert.equal(game.getState().hold, first);
  assert.equal(game.getState().active.type, upcoming);
  assert.equal(game.hold(), false, "only once until the piece locks");
  game.testing.setBoard([]);
  game.hardDrop();
  assert.equal(game.hold(), true);
  assert.equal(game.getState().active.type, first, "held piece comes back");
});

test("pause freezes gravity and input", () => {
  const game = newGame(17);
  const y0 = game.getState().active.y;
  game.pause();
  game.tick(5000);
  assert.equal(game.getState().active.y, y0);
  assert.equal(game.moveLeft(), false);
  assert.equal(game.togglePause(), false);
  game.tick(gravityMs(1) + 1);
  assert.equal(game.getState().active.y, y0 + 1);
});
