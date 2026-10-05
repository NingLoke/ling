// Hidden Tetris easter egg shared by the 2E3 (ink) and 3E4 (neon) timetable pages.
//   createGame()  pure game logic, no DOM (tested in scripts/lib/tetris.test.mjs)
//   openTetris()  full-screen overlay: canvas board, keyboard, touch buttons and board gestures

export const COLS = 10;
export const ROWS = 20;
const HIDDEN = 2; // rows above the visible board, so pieces can spawn and rotate at the very top
export const PIECES = ["I", "O", "T", "S", "Z", "J", "L"];
export const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const LINES_PER_LEVEL = 10;
const LINE_SCORES = [0, 100, 300, 500, 800];

// SRS spawn orientation inside each piece's box (x right, y down).
const SPAWN = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};
const BOX = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 };

// SHAPES[type][rotation] = cells; rotation 0 = spawn, 1 = R, 2 = 180, 3 = L.
const SHAPES = Object.fromEntries(
  PIECES.map((type) => {
    const states = [SPAWN[type]];
    for (let r = 1; r < 4; r++) {
      const n = BOX[type];
      states.push(type === "O" ? SPAWN.O : states[r - 1].map(([x, y]) => [n - 1 - y, x]));
    }
    return [type, states];
  })
);

// SRS wall kicks as written on the Tetris wiki (x right, y UP); applied as (x + dx, y - dy).
const KICKS_JLSTZ = {
  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I = {
  "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

/** Milliseconds per row at a level (Tetris guideline curve, capped at one row per frame). */
export const gravityMs = (level) =>
  Math.max(1000 / 60, 1000 * Math.pow(Math.max(0.8 - (level - 1) * 0.007, 0.05), level - 1));

/** Cells of a piece in its own box, for previews. */
export const pieceCells = (type, rotation = 0) => SHAPES[type][rotation].map(([x, y]) => [x, y]);

/**
 * Pure game state machine. Drive it with tick(ms) and the move functions; read it with getState().
 *   options.random     () => [0, 1)   (inject a seeded one for tests)
 *   options.startLevel  first level (default 1)
 */
export function createGame({ random = Math.random, startLevel = 1 } = {}) {
  let board, queue, active, holdType, holdUsed, score, lines, level, over, paused;
  let gravityAcc, lockTimer, lockResets, lowestY, events;

  const emptyRow = () => Array(COLS).fill(null);

  function refillBag() {
    const bag = [...PIECES];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    queue.push(...bag);
  }

  function takeNext() {
    while (queue.length < 8) refillBag();
    return queue.shift();
  }

  const cellsOf = (type, rotation, x, y) => SHAPES[type][rotation].map(([cx, cy]) => [x + cx, y + cy]);

  const fits = (type, rotation, x, y) =>
    cellsOf(type, rotation, x, y).every(
      ([cx, cy]) => cx >= 0 && cx < COLS && cy < HIDDEN + ROWS && (cy < 0 || board[cy][cx] === null)
    );

  const canAct = () => Boolean(active) && !over && !paused;
  const onGround = () => Boolean(active) && !fits(active.type, active.rotation, active.x, active.y + 1);

  function spawn(type) {
    const x = 3;
    const y = type === "I" ? HIDDEN - 1 : HIDDEN; // first visible row holds the piece's top cells
    gravityAcc = 0;
    lockTimer = 0;
    lockResets = 0;
    lowestY = y;
    if (!fits(type, 0, x, y)) {
      active = null;
      over = true;
      events.push({ type: "over" });
      return false;
    }
    active = { type, rotation: 0, x, y };
    return true;
  }

  function reset() {
    board = Array.from({ length: HIDDEN + ROWS }, emptyRow);
    queue = [];
    holdType = null;
    holdUsed = false;
    score = 0;
    lines = 0;
    level = startLevel;
    over = false;
    paused = false;
    events = [];
    spawn(takeNext());
  }

  function droppedTo(y) {
    if (y > lowestY) {
      lowestY = y;
      lockResets = 0;
      lockTimer = 0;
    }
  }

  // Successful move/rotate while resting on the stack: restart the lock delay (limited, so no infinite stalling).
  function manipulated() {
    if (onGround() && lockResets < MAX_LOCK_RESETS) {
      lockTimer = 0;
      lockResets++;
    }
  }

  function shift(dx) {
    if (!canAct() || !fits(active.type, active.rotation, active.x + dx, active.y)) return false;
    active.x += dx;
    manipulated();
    return true;
  }

  function rotate(dir = 1) {
    if (!canAct()) return false;
    if (active.type === "O") return true;
    const from = active.rotation;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const kicks = (active.type === "I" ? KICKS_I : KICKS_JLSTZ)[`${from}>${to}`];
    for (const [dx, dyUp] of kicks) {
      const x = active.x + dx;
      const y = active.y - dyUp;
      if (fits(active.type, to, x, y)) {
        active.x = x;
        active.y = y;
        active.rotation = to;
        droppedTo(y);
        manipulated();
        return true;
      }
    }
    return false;
  }

  function softDrop() {
    if (!canAct() || onGround()) return false;
    active.y++;
    droppedTo(active.y);
    gravityAcc = 0;
    score += 1;
    return true;
  }

  function lock() {
    const cells = cellsOf(active.type, active.rotation, active.x, active.y);
    let visible = false;
    for (const [x, y] of cells) {
      if (y >= 0) board[y][x] = active.type;
      if (y >= HIDDEN) visible = true;
    }
    events.push({ type: "lock", cells: cells.map(([x, y]) => [x, y - HIDDEN]), piece: active.type });
    active = null;
    if (!visible) {
      // Lock out: the whole piece came to rest above the visible board.
      over = true;
      events.push({ type: "over" });
      return;
    }
    const full = [];
    board.forEach((row, y) => {
      if (row.every(Boolean)) full.push(y);
    });
    if (full.length) {
      board = board.filter((_, y) => !full.includes(y));
      while (board.length < HIDDEN + ROWS) board.unshift(emptyRow());
      score += LINE_SCORES[full.length] * level;
      lines += full.length;
      events.push({ type: "clear", rows: full.map((y) => y - HIDDEN), count: full.length });
      const reached = startLevel + Math.floor(lines / LINES_PER_LEVEL);
      if (reached > level) {
        level = reached;
        events.push({ type: "level", level });
      }
    }
    holdUsed = false;
    spawn(takeNext());
  }

  function hardDrop() {
    if (!canAct()) return 0;
    let rows = 0;
    while (fits(active.type, active.rotation, active.x, active.y + 1)) {
      active.y++;
      rows++;
    }
    score += 2 * rows;
    lock();
    return rows;
  }

  function hold() {
    if (!canAct() || holdUsed) return false;
    const current = active.type;
    const swapIn = holdType;
    holdType = current;
    holdUsed = true;
    spawn(swapIn ?? takeNext());
    return true;
  }

  function tick(ms) {
    if (!canAct()) return;
    if (onGround()) {
      gravityAcc = 0;
      lockTimer += ms;
      if (lockTimer >= LOCK_DELAY) lock();
      return;
    }
    gravityAcc += ms;
    const interval = gravityMs(level);
    while (gravityAcc >= interval && active && !onGround()) {
      gravityAcc -= interval;
      active.y++;
      droppedTo(active.y);
    }
    if (onGround()) gravityAcc = 0;
  }

  function ghostY() {
    let y = active.y;
    while (fits(active.type, active.rotation, active.x, y + 1)) y++;
    return y;
  }

  const toVisible = (cells) => cells.map(([x, y]) => [x, y - HIDDEN]);

  function getState() {
    return {
      cols: COLS,
      rows: ROWS,
      board: board.slice(HIDDEN).map((row) => row.slice()),
      active: active
        ? {
            type: active.type,
            rotation: active.rotation,
            x: active.x,
            y: active.y - HIDDEN,
            cells: toVisible(cellsOf(active.type, active.rotation, active.x, active.y)),
          }
        : null,
      ghost: active ? toVisible(cellsOf(active.type, active.rotation, active.x, ghostY())) : null,
      next: queue.slice(0, 5),
      hold: holdType,
      canHold: !holdUsed,
      score,
      lines,
      level,
      over,
      paused,
      grounded: onGround(),
    };
  }

  reset();

  return {
    getState,
    tick,
    moveLeft: () => shift(-1),
    moveRight: () => shift(1),
    rotate,
    rotateCW: () => rotate(1),
    rotateCCW: () => rotate(-1),
    softDrop,
    hardDrop,
    hold,
    pause() {
      if (!over) paused = true;
    },
    resume() {
      paused = false;
    },
    togglePause() {
      if (!over) paused = !paused;
      return paused;
    },
    reset,
    drainEvents() {
      const out = events;
      events = [];
      return out;
    },
    // For unit tests only: set up exact positions.
    testing: {
      /** rows: visible rows top to bottom, strings like "XXXXXXXXX." ("." empty, a piece letter keeps its colour, anything else filled). */
      setBoard(rows) {
        board = Array.from({ length: HIDDEN + ROWS }, emptyRow);
        const offset = HIDDEN + ROWS - rows.length;
        rows.forEach((text, i) => {
          board[offset + i] = [...text.padEnd(COLS, ".")].slice(0, COLS).map((c) => (c === "." ? null : PIECES.includes(c) ? c : "G"));
        });
      },
      spawn(type) {
        over = false;
        return spawn(type);
      },
      place(type, rotation, x, visibleY) {
        active = { type, rotation, x, y: visibleY + HIDDEN };
        lowestY = active.y;
        lockTimer = 0;
        lockResets = 0;
        return fits(type, rotation, x, visibleY + HIDDEN);
      },
      queue: () => queue.slice(),
    },
  };
}

// ---------------------------------------------------------------------------
// Overlay UI
// ---------------------------------------------------------------------------

const DEFAULT_THEME = {
  style: "neon",
  background: "#0a0e17",
  panel: "#121826",
  grid: "rgba(255,255,255,.07)",
  text: "#e8ecf4",
  muted: "#94a0b8",
  accent: "#7cc4ff",
  pieces: { I: "#5ee1f0", O: "#f2d45e", T: "#b39cff", S: "#5fd4a0", Z: "#f27a8a", J: "#6f9cff", L: "#f2a65e" },
  font: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', Roboto, sans-serif",
};

let current = null; // only one overlay at a time

/**
 * How many px at the bottom of the screen are covered by something drawn on top of `layer`
 * (hosts can float a badge there, e.g. Netlify's "Powered by Netlify" on free projects).
 */
export function coveredBottom(layer) {
  if (typeof document.elementsFromPoint !== "function") return 0;
  const width = window.innerWidth;
  const height = window.innerHeight;
  let covered = 0;
  for (let dy = 4; dy <= 100; dy += 24) {
    const y = height - dy;
    for (let fx = 0.06; fx < 1; fx += 0.08) {
      for (const el of document.elementsFromPoint(width * fx, y)) {
        if (layer.contains(el) || el === document.body || el === document.documentElement) break;
        const box = el.getBoundingClientRect();
        const top = box.height > 0 && box.top > height / 2 ? box.top : y - 8;
        covered = Math.max(covered, height - top);
      }
    }
  }
  return Math.min(140, Math.ceil(covered));
}

const CSS = `
.tt-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;
  background:var(--tt-bg);color:var(--tt-text);font-family:var(--tt-font);font-size:14px;line-height:1.3;
  padding:max(8px,env(safe-area-inset-top)) max(10px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(10px,env(safe-area-inset-left));
  overscroll-behavior:contain;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;outline:none;box-sizing:border-box}
.tt-overlay *,.tt-overlay *::before,.tt-overlay *::after{box-sizing:border-box}
.tt-ink{background-image:radial-gradient(120% 80% at 50% 0%,rgba(255,255,255,.35),transparent 70%)}
.tt-neon{background-image:radial-gradient(90% 60% at 50% 0%,color-mix(in srgb,var(--tt-accent) 10%,transparent),transparent 70%)}
.tt-top{display:flex;align-items:center;gap:8px;flex:none}
.tt-title{margin:0 auto 0 4px;font-size:17px;font-weight:700;letter-spacing:.06em}
.tt-btn{min-width:44px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--tt-line);
  background:var(--tt-panel);color:var(--tt-text);font:inherit;font-size:15px;cursor:pointer;touch-action:manipulation}
.tt-btn:focus-visible,.tt-ctl:focus-visible{outline:2px solid var(--tt-accent);outline-offset:2px}
.tt-btn.tt-primary{background:var(--tt-accent);border-color:transparent;color:var(--tt-on-accent);font-weight:700}
.tt-main{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;gap:10px;padding:8px 0;position:relative}
.tt-boardwrap{position:relative;flex:none}
.tt-board{display:block;border-radius:6px;touch-action:none;border:1px solid var(--tt-line)}
.tt-neon .tt-board{box-shadow:0 0 0 1px color-mix(in srgb,var(--tt-accent) 18%,transparent),0 0 32px -6px color-mix(in srgb,var(--tt-accent) 35%,transparent)}
.tt-ink .tt-board{box-shadow:0 1px 0 rgba(0,0,0,.04),0 10px 30px -18px rgba(0,0,0,.35)}
.tt-side{flex:none;width:var(--tt-side);align-self:stretch;display:flex;flex-direction:column;gap:8px;justify-content:center}
.tt-box{background:var(--tt-panel);border:1px solid var(--tt-line);border-radius:10px;padding:6px 6px 4px}
.tt-box canvas{display:block;margin:0 auto}
.tt-label{display:block;font-size:11px;color:var(--tt-muted);letter-spacing:.08em}
.tt-hold{cursor:pointer;padding:6px 6px 4px;width:100%;text-align:left;font:inherit;color:inherit}
.tt-hold[aria-disabled=true] canvas{opacity:.4}
.tt-stat{display:flex;flex-direction:column;padding:2px 2px 0}
.tt-stat b{font-size:clamp(14px,calc(var(--tt-side) / 5.2),20px);font-variant-numeric:tabular-nums;font-weight:700;line-height:1.15}
.tt-controls{flex:none;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;padding-top:4px}
.tt-controls.tt-two{grid-auto-rows:52px}
.tt-controls.tt-two .tt-ctl{height:auto;min-height:48px}
.tt-ctl[hidden]{display:none}
.tt-ctl[data-action=rotate],.tt-ctl[data-action=drop]{color:var(--tt-accent)}
.tt-layouts{margin:4px 0 12px;text-align:left}
.tt-layouts>span{display:block;margin:0 0 6px;font-size:12px;color:var(--tt-muted);letter-spacing:.06em}
.tt-layouts>div{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.tt-lay{display:flex;flex-direction:column;align-items:stretch;gap:4px;min-height:44px;padding:6px 6px 5px;border-radius:10px;
  border:1px solid var(--tt-line);background:transparent;color:var(--tt-text);font:inherit;cursor:pointer;touch-action:manipulation}
.tt-lay[aria-pressed=true]{border-color:var(--tt-accent);background:color-mix(in srgb,var(--tt-accent) 14%,transparent)}
.tt-lay small{font-size:11px;line-height:1.2;text-align:center;white-space:nowrap}
.tt-lay-pad{display:grid;gap:2px;height:22px}
.tt-lay-pad i{border-radius:3px;background:color-mix(in srgb,var(--tt-text) 22%,transparent)}
.tt-lay-pad i.tt-hot{background:var(--tt-accent)}
.tt-ctl{height:58px;border-radius:16px;border:1px solid var(--tt-line);background:var(--tt-panel);color:var(--tt-text);
  font:inherit;font-size:22px;display:flex;align-items:center;justify-content:center;touch-action:none;cursor:pointer;padding:0}
.tt-ctl small{font-size:12px;letter-spacing:.04em}
.tt-ctl.tt-on{border-color:var(--tt-accent);background:color-mix(in srgb,var(--tt-accent) 22%,var(--tt-panel))}
.tt-ctl svg{width:24px;height:24px}
.tt-hint{flex:none;text-align:center;color:var(--tt-muted);font-size:12px;padding-top:6px}
.tt-coarse .tt-hint{display:none}
.tt-fine .tt-controls{display:none}
.tt-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px}
.tt-msg[hidden]{display:none}
.tt-card{background:var(--tt-panel);border:1px solid var(--tt-line);border-radius:16px;
  padding:18px 16px 14px;text-align:center;min-width:min(240px,100%);max-width:300px;box-shadow:0 18px 50px -20px rgba(0,0,0,.6);
  max-height:100%;overflow-y:auto;overscroll-behavior:contain}
.tt-card h2{margin:0 0 6px;font-size:20px;letter-spacing:.1em}
.tt-card p{margin:0 0 12px;color:var(--tt-muted);font-size:13px;line-height:1.6}
.tt-card .tt-score{font-size:30px;font-weight:700;color:var(--tt-text);font-variant-numeric:tabular-nums;margin:2px 0 4px}
.tt-card .tt-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.tt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tt-top,.tt-main,.tt-controls,.tt-hint{position:relative;z-index:1}
.tt-title small{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:.06em;
  vertical-align:3px;color:var(--tt-glow);border:1px solid color-mix(in srgb,var(--tt-glow) 45%,transparent);background:color-mix(in srgb,var(--tt-glow) 10%,transparent)}
.tt-icon{padding:0;width:44px;display:grid;place-items:center}.tt-icon svg{width:22px;height:22px}
/* drifting light (neon) / drifting mist (ink) behind everything */
.tt-aura{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.tt-aura i{position:absolute;width:70vmax;height:70vmax;border-radius:50%;opacity:.2;filter:blur(30px);transition:background 1.2s;
  background:radial-gradient(closest-side,var(--tt-glow),transparent);animation:tt-drift 19s ease-in-out infinite alternate}
.tt-aura i:nth-child(1){left:-30vmax;top:-25vmax}
.tt-aura i:nth-child(2){right:-35vmax;bottom:-30vmax;background:radial-gradient(closest-side,var(--tt-glow2),transparent);animation-duration:23s;animation-delay:-7s}
.tt-aura i:nth-child(3){left:20vmax;top:30vmax;width:45vmax;height:45vmax;opacity:.12;animation-duration:29s;animation-delay:-13s}
.tt-ink .tt-aura i{opacity:.09;filter:blur(40px);mix-blend-mode:multiply}
@keyframes tt-drift{from{transform:translate(0,0) scale(1)}to{transform:translate(18vmax,12vmax) scale(1.25)}}
/* the board breathes with the music; flashes on clears */
.tt-neon .tt-board{box-shadow:0 0 0 1px color-mix(in srgb,var(--tt-glow) 25%,transparent),0 0 28px -6px color-mix(in srgb,var(--tt-glow) 45%,transparent);
  animation:tt-breathe var(--tt-beat,.9s) ease-in-out infinite alternate}
@keyframes tt-breathe{to{box-shadow:0 0 0 1px color-mix(in srgb,var(--tt-glow) 45%,transparent),0 0 44px -4px color-mix(in srgb,var(--tt-glow) 70%,transparent)}}
.tt-paused .tt-board{animation-play-state:paused}
.tt-boardwrap::after{content:"";position:absolute;inset:-2px;border-radius:8px;pointer-events:none;opacity:0;transition:opacity .45s;
  box-shadow:0 0 0 2px var(--tt-glow),0 0 50px 6px color-mix(in srgb,var(--tt-glow) 70%,transparent)}
.tt-boardwrap.tt-hit::after{opacity:1;transition:opacity .05s}
.tt-ink .tt-boardwrap::after{box-shadow:0 0 0 2px color-mix(in srgb,var(--tt-glow) 70%,transparent),0 0 40px 4px color-mix(in srgb,var(--tt-glow) 30%,transparent)}
/* level up: a band of light sweeps across; new skin: a burst from the middle */
.tt-sweep,.tt-burst{position:absolute;inset:0;pointer-events:none;z-index:0;opacity:0}
.tt-sweep{background:linear-gradient(100deg,transparent 35%,color-mix(in srgb,var(--tt-glow) 45%,transparent) 50%,transparent 65%);background-size:250% 100%}
.tt-levelup .tt-sweep{animation:tt-sweep .9s ease-out}
@keyframes tt-sweep{0%{opacity:1;background-position:120% 0}100%{opacity:0;background-position:-20% 0}}
.tt-burst{background:radial-gradient(circle at 50% 45%,color-mix(in srgb,var(--tt-glow) 70%,transparent),transparent 60%)}
.tt-newskin .tt-burst{animation:tt-burst 1.2s ease-out}
@keyframes tt-burst{0%{opacity:.75;transform:scale(.3)}100%{opacity:0;transform:scale(1.8)}}
/* "四消！" style call-outs over the board */
.tt-pops{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;
  gap:4px;padding-top:34%;z-index:3}
.tt-pop{font-weight:800;font-size:calc(var(--tt-cell,24px) * 1.1);letter-spacing:.08em;white-space:nowrap;animation:tt-pop .9s ease-out forwards}
.tt-pop.tt-big{font-size:calc(var(--tt-cell,24px) * 1.5)}
.tt-pop.tt-small{font-size:calc(var(--tt-cell,24px) * .85)}
.tt-neon .tt-pop{color:#fff;text-shadow:0 0 6px var(--tt-glow),0 0 18px var(--tt-glow),0 0 36px var(--tt-glow)}
.tt-ink .tt-pop{color:var(--tt-glow);font-family:"Ma Shan Zheng","Noto Serif SC",serif;font-weight:700;
  text-shadow:0 0 1px #fff,0 1px 0 #fff,0 0 14px rgba(255,255,255,.9)}
@keyframes tt-pop{0%{opacity:0;transform:scale(.5) translateY(10px)}18%{opacity:.72;transform:scale(1.1)}32%{transform:scale(1)}60%{opacity:.6}100%{opacity:0;transform:translateY(-22px)}}
.tt-title small.tt-chip-new{animation:tt-chip 1.6s ease-out}
@keyframes tt-chip{0%{transform:scale(1)}15%{transform:scale(1.35);box-shadow:0 0 0 4px color-mix(in srgb,var(--tt-glow) 35%,transparent),0 0 24px var(--tt-glow)}100%{transform:scale(1);box-shadow:none}}
@media (prefers-reduced-motion:reduce){
  .tt-aura i,.tt-neon .tt-board{animation:none}
  .tt-levelup .tt-sweep,.tt-newskin .tt-burst{animation:none}
  .tt-pop{animation:tt-fade 1.1s forwards}
}
@keyframes tt-fade{0%,70%{opacity:1}100%{opacity:0}}
`;

const ICONS = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>',
  rotateCCW: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v5h5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13"/><path d="M6 12l6 6 6-6"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l5 5 5-5"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/></svg>',
};

// Where the touch buttons sit (按键布局), picked in the start / pause card and kept on the phone. The areas use
// the buttons' action names; a button a layout leaves out is hidden.
export const LAYOUTS = [
  { id: "row", name: "一排", columns: "repeat(6, 1fr)", areas: ["left rotate right down drop hold"] },
  { id: "split", name: "左移 右转", columns: "1fr 1fr 1fr .3fr 1.1fr 1.1fr", areas: ["left hold right . rotateCCW rotate", "left down right . drop drop"] },
  { id: "mirror", name: "左转 右移", columns: "1.1fr 1.1fr .3fr 1fr 1fr 1fr", areas: ["rotateCCW rotate . left hold right", "drop drop . left down right"] },
  { id: "pad", name: "两排大键", columns: "repeat(3, 1fr)", areas: ["hold rotate drop", "left down right"] },
  { id: "thumb", name: "单手", columns: ".8fr 1fr 1fr 1fr", areas: [". hold rotate drop", ". left down right"] },
];
const LAYOUT_KEY = "tt:controls-layout";
export const layoutById = (id) => LAYOUTS.find((layout) => layout.id === id) || LAYOUTS[0];
export const layoutActions = (layout) => new Set(layout.areas.join(" ").split(/\s+/).filter((name) => name !== "."));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only ever our own static SVG icons
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

function readBest(key) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private mode */
  }
}

// Small deterministic PRNG so ink tiles look hand-made but never flicker between frames.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

let probe = null;
const rgbCache = new Map();

/** Any CSS colour -> [r, g, b] (cached; the canvas does the parsing). */
function rgbOf(color) {
  if (!rgbCache.has(color)) {
    probe ??= document.createElement("canvas").getContext("2d");
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    const value = probe.fillStyle; // normalised: "#rrggbb" or "rgba(...)"
    let rgb;
    if (value.startsWith("#")) {
      const n = parseInt(value.slice(1), 16);
      rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    } else {
      rgb = (value.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    }
    rgbCache.set(color, rgb);
  }
  return rgbCache.get(color);
}

function withAlpha(color, alpha) {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

const inkDots = new Map();
/** A soft watercolour drop (colour fading to nothing at the edge), cached per colour. */
function inkDot(color) {
  if (!inkDots.has(color)) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const bloom = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    bloom.addColorStop(0, withAlpha(color, 0.85));
    bloom.addColorStop(0.45, withAlpha(color, 0.55));
    bloom.addColorStop(0.8, withAlpha(color, 0.18));
    bloom.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, 64, 64);
    inkDots.set(color, canvas);
  }
  return inkDots.get(color);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Pre-rendered block images (one per piece type and variant) at a given device-pixel size. */
function makeTiles(theme, size) {
  const ink = theme.style === "ink";
  const pad = Math.ceil(size * (ink ? 0.14 : 0.45)); // room for the ink bleed / neon glow
  const variants = ink ? 3 : 1;
  const tiles = {};
  for (const type of PIECES) {
    const color = theme.pieces[type];
    tiles[type] = [];
    for (let v = 0; v < variants; v++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size + pad * 2;
      const ctx = canvas.getContext("2d");
      if (ink) drawInkTile(ctx, size, color, seeded(type.charCodeAt(0) * 97 + v * 7919 + 13), pad);
      else drawNeonTile(ctx, size, pad, color);
      tiles[type].push({ canvas, pad, size });
    }
  }
  return tiles;
}

function drawNeonTile(ctx, size, pad, color) {
  const inset = Math.max(1, size * 0.07);
  const r = size * 0.18;
  ctx.save();
  ctx.shadowColor = withAlpha(color, 0.75);
  ctx.shadowBlur = size * 0.45;
  ctx.fillStyle = withAlpha(color, 0.9);
  roundRect(ctx, pad + inset, pad + inset, size - inset * 2, size - inset * 2, r);
  ctx.fill();
  ctx.restore();
  const gloss = ctx.createLinearGradient(0, pad, 0, pad + size);
  gloss.addColorStop(0, "rgba(255,255,255,.42)");
  gloss.addColorStop(0.45, "rgba(255,255,255,.06)");
  gloss.addColorStop(1, "rgba(0,0,0,.12)");
  ctx.fillStyle = gloss;
  roundRect(ctx, pad + inset, pad + inset, size - inset * 2, size - inset * 2, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.35)";
  ctx.lineWidth = Math.max(1, size * 0.04);
  roundRect(ctx, pad + inset + 0.5, pad + inset + 0.5, size - inset * 2 - 1, size - inset * 2 - 1, r);
  ctx.stroke();
}

function drawInkTile(ctx, size, color, rand, pad = 0) {
  // One square of rice paper washed with a traditional pigment, like watercolour: the paper shows
  // through, the colour soaks a little past the edge, lifts where the brush started and settles
  // deeper at the rim, with a faint dry-brush hair or two and the paper's own grain.
  const [r0, g0, b0] = rgbOf(color);
  const deep = `rgb(${Math.round(r0 * 0.62)},${Math.round(g0 * 0.62)},${Math.round(b0 * 0.62)})`;
  const inset = Math.max(1, size * 0.08);
  const x = pad + inset;
  const y = pad + inset;
  const w = size - inset * 2;
  const r = Math.max(1, size * 0.06);
  const shape = new Path2D();
  shape.moveTo(x + r, y);
  shape.arcTo(x + w, y, x + w, y + w, r);
  shape.arcTo(x + w, y + w, x, y + w, r);
  shape.arcTo(x, y + w, x, y, r);
  shape.arcTo(x, y, x + w, y, r);
  shape.closePath();

  // pigment, soaking softly into the paper around it
  ctx.save();
  ctx.shadowColor = withAlpha(color, 0.32);
  ctx.shadowBlur = size * 0.1;
  ctx.fillStyle = withAlpha(color, 0.76);
  ctx.fill(shape);
  ctx.restore();

  // wet wash: paper-light where the brush lifted, the pigment settling deeper towards one corner
  const lx = x + w * (0.24 + rand() * 0.16);
  const ly = y + w * (0.2 + rand() * 0.16);
  const wash = ctx.createRadialGradient(lx, ly, w * 0.03, x + w * 0.58, y + w * 0.62, w * 0.92);
  wash.addColorStop(0, "rgba(255,251,242,.36)");
  wash.addColorStop(0.45, "rgba(255,251,242,.1)");
  wash.addColorStop(1, withAlpha(deep, 0.28));
  ctx.fillStyle = wash;
  ctx.fill(shape);

  ctx.save();
  ctx.clip(shape);
  // the paper's grain showing through
  for (let i = 0; i < 26; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(255,251,242,.10)" : withAlpha(deep, 0.1);
    ctx.fillRect(x + rand() * w, y + rand() * w, Math.max(1, size * 0.02), Math.max(1, size * 0.02));
  }
  // a dry-brush hair or two
  ctx.lineCap = "round";
  for (let i = 0; i < 2; i++) {
    const sy = y + w * (0.25 + rand() * 0.5);
    ctx.strokeStyle = `rgba(255,251,242,${0.06 + rand() * 0.05})`;
    ctx.lineWidth = Math.max(0.8, size * 0.014);
    ctx.beginPath();
    ctx.moveTo(x + w * (0.08 + rand() * 0.2), sy);
    ctx.quadraticCurveTo(x + w * 0.5, sy + (rand() - 0.5) * w * 0.05, x + w * (0.7 + rand() * 0.25), sy + (rand() - 0.5) * w * 0.06);
    ctx.stroke();
  }
  ctx.restore();

  // pigment pooled along the rim, in its own deeper shade
  ctx.strokeStyle = withAlpha(deep, 0.42);
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.stroke(shape);
}

// ---------------------------------------------------------------------------
// Skins: the look changes as the score climbs (1,500 / 4,000 / 8,000 / 14,000 / 22,000, then every 10,000)
// ---------------------------------------------------------------------------

const SKIN_STEPS = [1500, 4000, 8000, 14000, 22000];
const SKIN_EVERY = 10000;

/** How many skin milestones a score has passed. */
export function skinStage(score) {
  let stage = SKIN_STEPS.filter((step) => score >= step).length;
  const last = SKIN_STEPS.at(-1);
  if (score >= last) stage += Math.floor((score - last) / SKIN_EVERY);
  return stage;
}

/** Score needed for the milestone after `stage`. */
export function nextSkinAt(stage) {
  return stage < SKIN_STEPS.length ? SKIN_STEPS[stage] : SKIN_STEPS.at(-1) + (stage - SKIN_STEPS.length + 1) * SKIN_EVERY;
}

// The first skin of each style is the page's own theme.
const SKINS = {
  neon: [
    { name: "夜空" },
    { name: "极光", accent: "#6ff7c8", glow: "#6ff7c8", glow2: "#a98bff", board: ["#06171a", "#0b0f24"], grid: "rgba(111,247,200,.08)",
      pieces: { I: "#6ff7c8", O: "#c8f76f", T: "#a98bff", S: "#3fd6a0", Z: "#ff7ac8", J: "#5aa9ff", L: "#7ae0ff" } },
    { name: "赛博", accent: "#ff4fd8", glow: "#ff4fd8", glow2: "#00f0ff", board: ["#16051f", "#05061a"], grid: "rgba(255,79,216,.09)",
      pieces: { I: "#00f0ff", O: "#ffe600", T: "#ff4fd8", S: "#39ff88", Z: "#ff3b6b", J: "#6b5bff", L: "#ff9a3b" } },
    { name: "熔岩", accent: "#ff7a2f", glow: "#ff5a1f", glow2: "#ffd166", board: ["#1d0905", "#0d0505"], grid: "rgba(255,122,47,.09)",
      pieces: { I: "#ffb347", O: "#ffe066", T: "#ff5e3a", S: "#ff9f1c", Z: "#e63946", J: "#d62828", L: "#ff7b00" } },
    { name: "冰川", accent: "#9be7ff", glow: "#9be7ff", glow2: "#5fa8ff", board: ["#061423", "#0a1a2e"], grid: "rgba(155,231,255,.09)",
      pieces: { I: "#e0fbff", O: "#b8f2ff", T: "#9bb8ff", S: "#7fe3f0", Z: "#c7d7ff", J: "#5fa8ff", L: "#a0f0e0" } },
    { name: "黄金", accent: "#ffd166", glow: "#ffcf4a", glow2: "#f4a259", board: ["#1a1306", "#0b0904"], grid: "rgba(255,209,102,.09)",
      pieces: { I: "#fff1b8", O: "#ffd166", T: "#f4a259", S: "#e9c46a", Z: "#e76f51", J: "#c99a3a", L: "#ffe08a" } },
  ],
  ink: [
    { name: "水墨" },
    // 青绿山水: azurite & malachite on pale celadon paper
    { name: "青绿", accent: "#2f7a5a", glow: "#2f7a5a", glow2: "#2e6e9e", board: ["#f4f3ea", "#e9efe6"], grid: "rgba(47,122,90,.12)",
      pieces: { I: "#2e6e9e", O: "#c9a23a", T: "#2f7a5a", S: "#5f9a6f", Z: "#3f7f8f", J: "#2f4a6b", L: "#8a9a4a" } },
    // 朱砂: cinnabar, rouge, vermilion orange
    { name: "朱砂", accent: "#c0442f", glow: "#c0442f", glow2: "#d4683c", board: ["#f8f1e6", "#f1e5d6"], grid: "rgba(192,68,47,.12)",
      pieces: { I: "#c0442f", O: "#d9a43a", T: "#9e2f4a", S: "#a3623a", Z: "#d4683c", J: "#2b2a28", L: "#c45a6a" } },
    // 金碧: gold with azurite and ink, on warm paper
    { name: "金碧", accent: "#b8862b", glow: "#c9972f", glow2: "#2e6e9e", board: ["#f6f0de", "#ece2c6"], grid: "rgba(184,134,43,.14)",
      pieces: { I: "#2e6e9e", O: "#c9972f", T: "#b5412e", S: "#3f7a5f", Z: "#8f3f2f", J: "#1f2f4a", L: "#a8823a" } },
    // 雪夜: the five shades of ink, one indigo, one seal red
    { name: "雪夜", accent: "#3b5a7a", glow: "#3b5a7a", glow2: "#8a8a86", board: ["#f1f3f5", "#e3e7ec"], grid: "rgba(59,90,122,.12)",
      pieces: { I: "#33332f", O: "#aaa9a3", T: "#b5412e", S: "#5c5b55", Z: "#3b5a7a", J: "#121211", L: "#84837d" } },
    // 桃花: peach blossom pinks with young-leaf green
    { name: "桃花", accent: "#c95b78", glow: "#c95b78", glow2: "#8faa5a", board: ["#fcf3f1", "#f6e6e6"], grid: "rgba(201,91,120,.13)",
      pieces: { I: "#c95b78", O: "#e3a0ae", T: "#9e2f4a", S: "#7f9f4f", Z: "#d97a8c", J: "#5a3a4a", L: "#a3623a" } },
  ],
};

// ---------------------------------------------------------------------------
// Music & sound effects (Web Audio, synthesised: no audio files)
// The tune is Korobeiniki (1861), the Russian folk song best known as the Tetris theme (public domain).
// ---------------------------------------------------------------------------

const NOTE_OFFSETS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiOf = (name) => {
  const m = /^([A-G])(#?)(\d)$/.exec(name);
  return 12 * (Number(m[3]) + 1) + NOTE_OFFSETS[m[1]] + (m[2] ? 1 : 0);
};
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
// [note or null for a rest, beats]
const MELODY_A = [
  ["E5", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["C5", 0.5], ["B4", 0.5],
  ["A4", 1], ["A4", 0.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5],
  ["B4", 1.5], ["C5", 0.5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 1], ["A4", 1], [null, 1],
  ["D5", 1.5], ["F5", 0.5], ["A5", 1], ["G5", 0.5], ["F5", 0.5],
  ["E5", 1.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5],
  ["B4", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 1], ["A4", 1], [null, 1],
];
const MELODY_B = [
  ["E5", 2], ["C5", 2], ["D5", 2], ["B4", 2], ["C5", 2], ["A4", 2], ["G#4", 2], ["B4", 2],
  ["E5", 2], ["C5", 2], ["D5", 2], ["B4", 2], ["C5", 1], ["E5", 1], ["A5", 2], ["G#5", 4],
];
const BASS_A = ["E2", "A2", "E2", "A2", "D2", "C2", "E2", "A2"]; // one root per bar
const BASS_B = ["A2", "E2", "A2", "E2", "A2", "E2", "A2", "E2"];

/** The whole loop (A A B) as timed notes: { beat, beats, midi, part }. */
export function buildSong() {
  const events = [];
  let beat = 0;
  const melody = (notes) => {
    for (const [name, beats] of notes) {
      if (name) events.push({ beat, beats, midi: midiOf(name), part: "lead" });
      beat += beats;
    }
  };
  const bass = (roots, start) => {
    roots.forEach((root, bar) => {
      for (let i = 0; i < 8; i++) events.push({ beat: start + bar * 4 + i / 2, beats: 0.5, midi: midiOf(root) + (i % 2 ? 12 : 0), part: "bass" });
    });
  };
  bass(BASS_A, 0);
  melody(MELODY_A);
  bass(BASS_A, 32);
  melody(MELODY_A);
  bass(BASS_B, 64);
  melody(MELODY_B);
  events.sort((a, b) => a.beat - b.beat || (a.part === "bass" ? -1 : 1));
  return { events, beats: beat };
}

const tempoFor = (level) => Math.min(220, 132 + (level - 1) * 8); // beats per minute

function createSound(style) {
  const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  const song = buildSong();
  let ctx = null;
  let master = null;
  let fxBus = null;
  let echo = null;
  let musicBus = null;
  let muted = false;
  let level = 1;
  let playing = false;
  let timer = 0;
  let index = 0;
  let loopBeat = 0;
  let cursorBeat = 0;
  let cursorTime = 0;

  function ensure() {
    if (!AudioCtx) return false;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
      } catch {
        return false;
      }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.8;
      master.connect(ctx.destination);
      if (style === "ink") {
        // a little room: soft echo, so the plucked notes ring like a zither
        echo = ctx.createGain();
        const delay = ctx.createDelay(1);
        delay.delayTime.value = 0.24;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.3;
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 1800;
        const wet = ctx.createGain();
        wet.gain.value = 0.3;
        echo.connect(delay);
        delay.connect(tone);
        tone.connect(feedback);
        feedback.connect(delay);
        tone.connect(wet);
        wet.connect(master);
      }
      fxBus = ctx.createGain();
      fxBus.gain.value = 0.9;
      fxBus.connect(master);
      if (echo) fxBus.connect(echo);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return true;
  }

  function newMusicBus() {
    if (musicBus) {
      const old = musicBus;
      old.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      setTimeout(() => old.disconnect(), 500);
    }
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.6;
    musicBus.connect(master);
    if (echo) musicBus.connect(echo);
  }

  function note(time, midi, length, part) {
    const gain = ctx.createGain();
    gain.connect(musicBus);
    const bass = part === "bass";
    if (style === "ink") {
      const body = ctx.createOscillator();
      body.type = "triangle";
      body.frequency.value = hz(midi);
      const shine = ctx.createOscillator();
      shine.type = "sine";
      shine.frequency.value = hz(midi) * 2;
      const shineGain = ctx.createGain();
      shineGain.gain.value = bass ? 0.12 : 0.35;
      body.connect(gain);
      shine.connect(shineGain);
      shineGain.connect(gain);
      const decay = bass ? Math.max(0.3, length) : Math.max(0.5, length * 1.8);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(bass ? 0.13 : 0.2, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0006, time + decay);
      body.start(time);
      shine.start(time);
      body.stop(time + decay + 0.05);
      shine.stop(time + decay + 0.05);
    } else {
      const osc = ctx.createOscillator();
      osc.type = bass ? "triangle" : "square";
      osc.frequency.value = hz(midi);
      if (bass) osc.connect(gain);
      else {
        const soften = ctx.createBiquadFilter();
        soften.type = "lowpass";
        soften.frequency.value = 3400;
        osc.connect(soften);
        soften.connect(gain);
      }
      const peak = bass ? 0.2 : 0.07;
      const end = time + length;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peak, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(peak * 0.6, Math.max(time + 0.02, end - 0.03));
      gain.gain.exponentialRampToValueAtTime(0.0005, end);
      osc.start(time);
      osc.stop(end + 0.02);
    }
  }

  // Look-ahead scheduler: queue the notes of the next quarter second, every 60 ms.
  function pump() {
    if (!playing || !ctx) return;
    const horizon = ctx.currentTime + 0.25;
    const secondsPerBeat = 60 / tempoFor(level);
    for (;;) {
      const event = song.events[index];
      const beat = loopBeat + event.beat;
      const time = cursorTime + (beat - cursorBeat) * secondsPerBeat;
      if (time > horizon) break;
      if (time >= ctx.currentTime - 0.05) note(Math.max(time, ctx.currentTime), event.midi, event.beats * secondsPerBeat * (event.part === "lead" ? 0.92 : 0.85), event.part);
      cursorTime = time;
      cursorBeat = beat;
      index++;
      if (index >= song.events.length) {
        index = 0;
        loopBeat += song.beats;
      }
    }
  }

  function tone(time, freq, length, { type = "sine", gain = 0.1, to = null } = {}) {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, time + length);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(gain, time + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0005, time + length);
    osc.connect(amp);
    amp.connect(fxBus);
    osc.start(time);
    osc.stop(time + length + 0.02);
  }

  return {
    start() {
      if (!ensure()) return;
      newMusicBus();
      index = 0;
      loopBeat = 0;
      cursorBeat = 0;
      cursorTime = ctx.currentTime + 0.08;
      playing = true;
      clearInterval(timer);
      timer = setInterval(pump, 60);
      pump();
    },
    pause() {
      clearInterval(timer);
      timer = 0;
      if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume() {
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (playing && !timer) timer = setInterval(pump, 60);
    },
    stopMusic() {
      playing = false;
      clearInterval(timer);
      timer = 0;
      if (musicBus && ctx) {
        musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        musicBus = null;
      }
    },
    setLevel(value) {
      level = value;
    },
    setMuted(value) {
      muted = value;
      if (master) master.gain.setTargetAtTime(value ? 0 : 0.8, ctx.currentTime, 0.02);
    },
    sfx(name, arg = 0) {
      if (!ctx || muted || ctx.state !== "running") return;
      const now = ctx.currentTime + 0.005;
      const wave = style === "ink" ? "triangle" : "square";
      if (name === "move") tone(now, style === "ink" ? 520 : 700, 0.035, { type: style === "ink" ? "sine" : "square", gain: 0.025 });
      else if (name === "rotate") tone(now, style === "ink" ? 660 : 880, 0.06, { type: wave, gain: 0.035, to: style === "ink" ? 740 : 1180 });
      else if (name === "lock") tone(now, 260, 0.05, { type: "triangle", gain: 0.05, to: 200 });
      else if (name === "drop") {
        tone(now, 190, 0.17, { type: "sine", gain: 0.22, to: 52 });
        tone(now, 95, 0.09, { type: "triangle", gain: 0.1 });
      } else if (name === "hold") {
        tone(now, hz(76), 0.07, { type: wave, gain: 0.035 });
        tone(now + 0.06, hz(71), 0.08, { type: wave, gain: 0.035 });
      } else if (name === "clear") {
        const notes = arg >= 4 ? [72, 76, 79, 84, 88, 91, 96] : [72, 76, 79, 84].slice(0, arg + 1);
        notes.forEach((m, i) => tone(now + i * 0.055, hz(m), 0.18, { type: wave, gain: arg >= 4 ? 0.06 : 0.05 }));
        if (arg >= 4) tone(now, 70, 0.45, { type: "sine", gain: 0.18, to: 38 });
      } else if (name === "level") {
        [67, 72, 76, 79].forEach((m, i) => tone(now + i * 0.08, hz(m), 0.22, { type: wave, gain: 0.055 }));
      } else if (name === "skin") {
        [79, 83, 86, 91, 95, 98].forEach((m, i) => tone(now + i * 0.06, hz(m), 0.35, { type: "sine", gain: 0.06 }));
      } else if (name === "over") {
        [64, 60, 57, 52].forEach((m, i) => tone(now + i * 0.22, hz(m), 0.32, { type: wave, gain: 0.07 }));
      }
    },
    close() {
      this.stopMusic();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}

/**
 * Open the full-screen game. Returns close().
 *   theme       { style: "neon"|"ink", background, panel, grid, text, muted, accent, pieces: {I..L}, font,
 *                 skinName (what the page's own colours are called; "夜空" / "水墨" by default),
 *                 skins (the skins that follow at higher scores, like SKINS below; the style's own by default) }
 *   storageKey  localStorage key for the best score
 *   title       heading shown in the overlay
 */
export function openTetris({ theme = {}, storageKey = "tetris:best", title = "俄罗斯方块" } = {}) {
  if (current) return current.close;

  const t = { ...DEFAULT_THEME, ...theme, pieces: { ...DEFAULT_THEME.pieces, ...(theme.pieces || {}) } };
  const ink = t.style === "ink";
  const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const html = document.documentElement;
  const body = document.body;
  const game = createGame();
  let best = readBest(storageKey);
  let started = false;
  let closed = false;
  const sound = createSound(t.style);
  const soundKey = `${storageKey}:sound`;
  let soundOn = true;
  try {
    soundOn = localStorage.getItem(soundKey) !== "off";
  } catch {
    /* private mode */
  }
  sound.setMuted(!soundOn);
  const own = { name: t.skinName || SKINS[ink ? "ink" : "neon"][0].name, accent: t.accent, glow: t.accent, glow2: t.pieces.T, board: [ink ? t.panel : t.background, ink ? t.panel : t.background], grid: t.grid, pieces: t.pieces };
  const skins = [own, ...(Array.isArray(t.skins) && t.skins.length ? t.skins : SKINS[ink ? "ink" : "neon"].slice(1))];
  let stage = 0;
  let skin = skins[0];

  // ----- DOM -----
  const style = el("style", { text: CSS });
  const overlay = el("div", {
    class: `tt-overlay ${ink ? "tt-ink" : "tt-neon"} ${coarse ? "tt-coarse" : "tt-fine"}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
    tabindex: "-1",
  });
  overlay.style.setProperty("--tt-bg", t.background);
  overlay.style.setProperty("--tt-panel", t.panel);
  overlay.style.setProperty("--tt-line", t.grid);
  overlay.style.setProperty("--tt-text", t.text);
  overlay.style.setProperty("--tt-muted", t.muted);
  overlay.style.setProperty("--tt-accent", t.accent);
  overlay.style.setProperty("--tt-on-accent", ink ? "#fbf7ef" : t.background);
  overlay.style.setProperty("--tt-font", t.font);

  const pauseBtn = el("button", { class: "tt-btn", type: "button", text: "暂停" });
  const closeBtn = el("button", { class: "tt-btn", type: "button", text: "关闭" });
  const soundBtn = el("button", { class: "tt-btn tt-icon", type: "button" });
  const skinChip = el("small", { text: skin.name });
  const top = el("div", { class: "tt-top" }, [el("h2", { class: "tt-title" }, [title, skinChip]), soundBtn, pauseBtn, closeBtn]);
  const showSound = () => {
    soundBtn.innerHTML = soundOn ? ICONS.soundOn : ICONS.soundOff; // static icons only
    soundBtn.setAttribute("aria-label", soundOn ? "关闭声音" : "打开声音");
    soundBtn.setAttribute("aria-pressed", String(soundOn));
  };
  showSound();

  const board = el("canvas", { class: "tt-board", role: "img", "aria-label": "游戏区域" });
  const msg = el("div", { class: "tt-msg" });
  const pops = el("div", { class: "tt-pops", "aria-hidden": "true" });
  const boardWrap = el("div", { class: "tt-boardwrap" }, [board, pops, msg]);
  const aura = el("div", { class: "tt-aura", "aria-hidden": "true" }, [el("i"), el("i"), el("i")]);
  const sweep = el("div", { class: "tt-sweep", "aria-hidden": "true" });
  const burst = el("div", { class: "tt-burst", "aria-hidden": "true" });

  const holdCanvas = el("canvas");
  const nextCanvas = el("canvas");
  const holdBtn = el("button", { class: "tt-box tt-hold", type: "button", "aria-label": "暂存方块" }, [
    el("span", { class: "tt-label", text: "暂存" }),
    holdCanvas,
  ]);
  const nextBox = el("div", { class: "tt-box" }, [el("span", { class: "tt-label", text: "下一个" }), nextCanvas]);
  const stat = (label) => {
    const value = el("b", { text: "0" });
    return { node: el("div", { class: "tt-stat" }, [el("span", { class: "tt-label", text: label }), value]), value };
  };
  const scoreStat = stat("分数");
  const linesStat = stat("行");
  const levelStat = stat("等级");
  const bestStat = stat("最高");
  const side = el("div", { class: "tt-side" }, [holdBtn, nextBox, scoreStat.node, linesStat.node, levelStat.node, bestStat.node]);
  const main = el("div", { class: "tt-main" }, [boardWrap, side]);

  const ctl = (name, label, icon) =>
    el("button", { class: "tt-ctl", type: "button", "aria-label": label, "data-action": name, html: icon });
  const controls = el("div", { class: "tt-controls" }, [
    ctl("left", "左移", ICONS.left),
    ctl("rotateCCW", "反方向旋转", ICONS.rotateCCW),
    ctl("rotate", "旋转", ICONS.rotate),
    ctl("right", "右移", ICONS.right),
    ctl("down", "加速下落", ICONS.down),
    ctl("drop", "直接落下", ICONS.drop),
    el("button", { class: "tt-ctl", type: "button", "aria-label": "暂存方块", "data-action": "hold" }, [el("small", { text: "暂存" })]),
  ]);
  let layoutId = "row";
  try {
    layoutId = layoutById(localStorage.getItem(LAYOUT_KEY)).id;
  } catch {
    /* private mode */
  }
  function applyLayout(id) {
    const layout = layoutById(id);
    layoutId = layout.id;
    const used = layoutActions(layout);
    controls.style.gridTemplateColumns = layout.columns;
    controls.style.gridTemplateAreas = layout.areas.map((row) => `"${row}"`).join(" ");
    controls.classList.toggle("tt-two", layout.areas.length > 1);
    for (const button of controls.children) {
      button.style.gridArea = button.dataset.action;
      button.hidden = !used.has(button.dataset.action);
    }
  }
  applyLayout(layoutId);
  // the layout picker in the start / pause card (touch screens only: a keyboard has no buttons to move)
  function layoutPicker() {
    const choices = LAYOUTS.map((layout) => {
      const cells = [...layoutActions(layout)].map((name) => el("i", { class: name === "rotate" || name === "drop" ? "tt-hot" : null, style: `grid-area:${name}` }));
      const pad = el("span", { class: "tt-lay-pad", "aria-hidden": "true", style: `grid-template-columns:${layout.columns};grid-template-areas:${layout.areas.map((row) => `"${row}"`).join(" ")}` }, cells);
      const button = el("button", { class: "tt-lay", type: "button", "aria-pressed": String(layout.id === layoutId), "data-layout": layout.id }, [pad, el("small", { text: layout.name })]);
      button.addEventListener("click", () => {
        applyLayout(layout.id);
        try {
          localStorage.setItem(LAYOUT_KEY, layout.id);
        } catch {
          /* private mode */
        }
        for (const other of choices) other.setAttribute("aria-pressed", String(other === button));
      });
      return button;
    });
    return el("div", { class: "tt-layouts", role: "group", "aria-label": "按键布局" }, [el("span", { text: "按键布局（点一下，下面的按钮马上换）" }), el("div", {}, choices)]);
  }
  const hint = el("div", { class: "tt-hint", text: "← → 移动 · ↑ 或 X 旋转 · Z 反转 · ↓ 加速 · 空格 落下 · C 暂存 · P 暂停 · M 声音 · Esc 关闭" });
  const live = el("div", { class: "tt-sr", "aria-live": "polite" });

  overlay.append(style, aura, top, main, controls, hint, live, sweep, burst);

  // ----- page lock: no scrolling behind, page made inert, focus remembered -----
  const scrollY = window.scrollY;
  const previousFocus = document.activeElement;
  const saved = {
    htmlOverflow: html.style.overflow,
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.append(overlay);
  // Measure anything the host floats over the bottom of the screen before the page goes inert
  // (inert elements are invisible to hit testing, but still drawn on top of us).
  const hostCovered = coveredBottom(overlay);
  const inerted = [];
  for (const child of body.children) {
    if (child !== overlay && !child.inert && child.tagName !== "SCRIPT") {
      child.inert = true;
      inerted.push(child);
    }
  }
  html.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  body.style.overflow = "hidden";

  // Android back button / gesture closes the overlay.
  let historyPushed = false;
  try {
    history.pushState({ ...(history.state || {}), __tetris: true }, "");
    historyPushed = true;
  } catch {
    /* sandboxed iframes may refuse */
  }
  const onPopState = () => close({ fromHistory: true });
  window.addEventListener("popstate", onPopState);

  // ----- sizing -----
  const dpr = () => Math.min(3, window.devicePixelRatio || 1);
  let cell = 20;
  let tiles = null;
  let mini = 12;
  let slots = 3;

  function layout() {
    // Keep the touch buttons clear of anything the host floats over the bottom of the screen.
    overlay.style.paddingBottom = hostCovered ? `calc(max(10px, env(safe-area-inset-bottom)) + ${hostCovered + 8}px)` : "";
    const rect = main.getBoundingClientRect();
    const gap = 10;
    const sideCells = 3.7;
    const availH = Math.max(120, rect.height - 18);
    const availW = Math.max(160, rect.width - gap - 2);
    cell = Math.max(8, Math.floor(Math.min(availH / ROWS, availW / (COLS + sideCells))));
    const sideW = Math.round(Math.min(130, Math.max(70, cell * sideCells)));
    overlay.style.setProperty("--tt-side", `${sideW}px`);
    const ratio = dpr();
    board.style.width = `${cell * COLS}px`;
    board.style.height = `${cell * ROWS}px`;
    board.width = Math.round(cell * COLS * ratio);
    board.height = Math.round(cell * ROWS * ratio);
    // Side column: hold + next previews + four stats. On short screens show one next piece instead of three.
    const overhead = 236;
    mini = Math.floor((sideW - 14) / 4.4);
    slots = overhead + mini * (2.4 + 7.6) > availH ? 1 : 3;
    const nextRows = slots === 3 ? 7.6 : 2.4;
    mini = Math.max(6, Math.min(mini, Math.floor((availH - overhead) / (2.4 + nextRows))));
    for (const [canvas, rowsTall] of [[holdCanvas, 2.4], [nextCanvas, nextRows]]) {
      canvas.style.width = `${mini * 4}px`;
      canvas.style.height = `${Math.round(mini * rowsTall)}px`;
      canvas.width = Math.round(mini * 4 * ratio);
      canvas.height = Math.round(mini * rowsTall * ratio);
    }
    overlay.style.setProperty("--tt-cell", `${cell}px`);
    tiles = tilesFor(stage);
    draw(performance.now(), true);
    prepareTiles(stage + 1);
  }

  // Block images per skin and size. Drawing them takes a moment on a phone, so the next skin's
  // set is prepared while the game idles and a skin change never stalls a falling piece.
  const tileCache = new Map();
  function tilesFor(index) {
    const ratio = dpr();
    const key = `${cell}@${ratio}@${index % skins.length}`;
    if (!tileCache.has(key)) {
      if (tileCache.size > 16) tileCache.clear();
      tileCache.set(key, makeTiles({ ...t, pieces: skins[index % skins.length].pieces }, Math.round(cell * ratio)));
    }
    return tileCache.get(key);
  }
  function prepareTiles(index) {
    const run = () => {
      if (!closed) tilesFor(index);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 400);
  }

  function applySkin(next, announce = true) {
    stage = next;
    skin = skins[next % skins.length];
    overlay.style.setProperty("--tt-glow", skin.glow);
    overlay.style.setProperty("--tt-glow2", skin.glow2);
    overlay.style.setProperty("--tt-accent", skin.accent);
    skinChip.textContent = skin.name;
    tiles = tilesFor(stage);
    lastShown = "";
    draw(performance.now(), true);
    prepareTiles(stage + 1);
    if (!announce) return;
    // Announce it off the board (the chip and the light behind the board), never over the pieces.
    sound.sfx("skin");
    flashClass(skinChip, "tt-chip-new", 1600);
    flashClass(overlay, "tt-newskin", 1200);
    live.textContent = `新皮肤：${skin.name}`;
  }

  // ----- drawing -----
  const flashes = []; // { rows, until }
  let lastShown = "";

  function drawTile(ctx, type, x, y, size, variant = 0) {
    const set = tiles[type];
    const tile = set[variant % set.length];
    const scale = size / tile.size;
    ctx.drawImage(tile.canvas, x - tile.pad * scale, y - tile.pad * scale, tile.canvas.width * scale, tile.canvas.height * scale);
  }

  function drawBoardBackground(ctx, w, h) {
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, skin.board[0]);
    fill.addColorStop(1, skin.board[1]);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, w, h);
    if (ink) {
      // faint paper fibres
      const rand = seeded(42);
      ctx.fillStyle = "rgba(0,0,0,.025)";
      for (let i = 0; i < 70; i++) ctx.fillRect(rand() * w, rand() * h, 1 + rand() * w * 0.05, 1);
    }
    ctx.strokeStyle = skin.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const size = w / COLS;
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(Math.round(x * size) + 0.5, 0);
      ctx.lineTo(Math.round(x * size) + 0.5, h);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, Math.round(y * size) + 0.5);
      ctx.lineTo(w, Math.round(y * size) + 0.5);
    }
    ctx.stroke();
  }

  function drawPreview(canvas, types, slots) {
    const ctx = canvas.getContext("2d");
    const ratio = dpr();
    const size = mini * ratio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    types.slice(0, slots).forEach((type, i) => {
      if (!type) return;
      const cells = pieceCells(type);
      const xs = cells.map(([x]) => x);
      const ys = cells.map(([, y]) => y);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      const ox = (canvas.width - w * size) / 2 - Math.min(...xs) * size;
      const oy = i * 2.6 * size + (2.4 * size - h * size) / 2 - Math.min(...ys) * size;
      for (const [x, y] of cells) drawTile(ctx, type, ox + x * size, oy + y * size, size);
    });
  }

  function draw(now, force = false) {
    const state = game.getState();
    const ctx = board.getContext("2d");
    const w = board.width;
    const h = board.height;
    const size = w / COLS;
    drawBoardBackground(ctx, w, h);

    state.board.forEach((row, y) =>
      row.forEach((type, x) => {
        if (type) drawTile(ctx, type === "G" ? "I" : type, x * size, y * size, size, x * 7 + y * 3);
      })
    );

    if (state.active && !state.over) {
      const color = skin.pieces[state.active.type];
      ctx.save();
      for (const [x, y] of state.ghost) {
        if (y < 0) continue;
        if (ink) {
          ctx.fillStyle = withAlpha(color, 0.07);
          ctx.strokeStyle = withAlpha(color, 0.4);
          ctx.lineWidth = Math.max(1, size * 0.03);
          ctx.setLineDash([size * 0.12, size * 0.08]);
          roundRect(ctx, x * size + size * 0.1, y * size + size * 0.1, size * 0.8, size * 0.8, size * 0.07);
          ctx.fill();
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = withAlpha(color, 0.5);
          ctx.lineWidth = Math.max(1, size * 0.06);
          roundRect(ctx, x * size + size * 0.12, y * size + size * 0.12, size * 0.76, size * 0.76, size * 0.16);
          ctx.stroke();
        }
      }
      ctx.restore();
      for (const [x, y] of state.active.cells) if (y >= 0) drawTile(ctx, state.active.type, x * size, y * size, size, x + y);
    }

    for (let i = flashes.length - 1; i >= 0; i--) {
      const flash = flashes[i];
      const left = flash.until - now;
      if (left <= 0) {
        flashes.splice(i, 1);
        continue;
      }
      ctx.fillStyle = ink ? withAlpha(skin.accent, 0.35 * (left / 260)) : `rgba(255,255,255,${0.55 * (left / 260)})`;
      for (const row of flash.rows) ctx.fillRect(0, row * size, w, size);
    }

    // hard-drop light trails
    for (let i = trails.length - 1; i >= 0; i--) {
      const trail = trails[i];
      const left = (trail.until - now) / 260;
      if (left <= 0) {
        trails.splice(i, 1);
        continue;
      }
      for (const col of trail.cols) {
        const top = col.top * size;
        const bottom = (col.bottom + 1) * size;
        const beam = ctx.createLinearGradient(0, top, 0, bottom);
        beam.addColorStop(0, withAlpha(trail.color, 0));
        beam.addColorStop(1, withAlpha(trail.color, (ink ? 0.22 : 0.45) * left));
        ctx.fillStyle = beam;
        ctx.fillRect(col.x * size + size * 0.12, top, size * 0.76, bottom - top);
      }
    }

    // particles: glowing sparks (neon) or ink splashes (ink)
    if (particles.length) {
      ctx.save();
      if (!ink) ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const a = Math.max(0, p.life / p.max);
        if (ink) {
          ctx.globalAlpha = 0.7 * a;
          ctx.drawImage(inkDot(p.color), p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        } else {
          ctx.fillStyle = withAlpha(p.color, 0.22 * a);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = withAlpha(p.color, 0.95 * a);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    const shown = `${state.next.join("")}|${state.hold}|${state.canHold}|${state.score}|${state.lines}|${state.level}|${best}|${mini}|${slots}`;
    if (force || shown !== lastShown) {
      lastShown = shown;
      drawPreview(nextCanvas, state.next, slots);
      drawPreview(holdCanvas, [state.hold], 1);
      holdBtn.setAttribute("aria-disabled", String(!state.canHold));
      scoreStat.value.textContent = state.score.toLocaleString("en-US");
      linesStat.value.textContent = String(state.lines);
      levelStat.value.textContent = String(state.level);
      bestStat.value.textContent = Math.max(best, state.score).toLocaleString("en-US");
    }
  }

  // ----- messages (start / pause / game over) -----
  function showMessage(kind) {
    msg.replaceChildren();
    if (!kind) {
      msg.hidden = true;
      return;
    }
    const state = game.getState();
    const card = el("div", { class: "tt-card" });
    const actions = el("div", { class: "tt-actions" });
    let primary;
    if (kind === "start") {
      card.append(
        el("h2", { text: title }),
        el("p", { text: coarse ? "按下面的按钮操作，也可以在方块区左右滑动、点一下旋转、往下一甩直接落下。" : "← → 移动，↑ 旋转，空格直接落下，M 开关声音。" }),
        el("p", { text: `分数到 ${nextSkinAt(0).toLocaleString("en-US")}、${nextSkinAt(1).toLocaleString("en-US")}、${nextSkinAt(2).toLocaleString("en-US")}… 会换新皮肤。` })
      );
      if (coarse) card.append(layoutPicker());
      primary = el("button", { class: "tt-btn tt-primary", type: "button", text: "开始" });
      primary.addEventListener("click", () => {
        started = true;
        sound.start(); // inside the tap, so phones allow audio
        resume();
      });
      actions.append(primary);
    } else if (kind === "pause") {
      const upcoming = skins[(stage + 1) % skins.length].name;
      card.append(
        el("h2", { text: "暂停" }),
        el("p", { text: `分数 ${state.score.toLocaleString("en-US")} · 行 ${state.lines}` }),
        el("p", { text: `皮肤「${skin.name}」· 到 ${nextSkinAt(stage).toLocaleString("en-US")} 分换「${upcoming}」` })
      );
      if (coarse) card.append(layoutPicker());
      primary = el("button", { class: "tt-btn tt-primary", type: "button", text: "继续" });
      primary.addEventListener("click", resume);
      const restart = el("button", { class: "tt-btn", type: "button", text: "重新开始" });
      restart.addEventListener("click", restartGame);
      actions.append(primary, restart);
    } else {
      const record = state.score > 0 && state.score >= best;
      card.append(
        el("h2", { text: "游戏结束" }),
        el("div", { class: "tt-score", text: state.score.toLocaleString("en-US") }),
        el("p", { text: record ? "新的最高分！" : `最高 ${best.toLocaleString("en-US")} · 行 ${state.lines}` })
      );
      primary = el("button", { class: "tt-btn tt-primary", type: "button", text: "重新开始" });
      primary.addEventListener("click", restartGame);
      const quit = el("button", { class: "tt-btn", type: "button", text: "关闭" });
      quit.addEventListener("click", () => close());
      actions.append(primary, quit);
    }
    card.append(actions);
    msg.append(card);
    msg.hidden = false;
    primary.focus({ preventScroll: true });
  }

  // ----- effects -----
  const particles = []; // { x, y, vx, vy, r, life, max, color } in canvas pixels / ms
  const trails = []; // { cols: [{ x, top, bottom }], color, until }
  let shake = 0; // css px
  let combo = -1;
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  function flashClass(node, name, ms) {
    node.classList.remove(name);
    void node.offsetWidth; // restart the CSS animation
    node.classList.add(name);
    later(() => node.classList.remove(name), ms);
  }

  function popup(text, size = "") {
    const pop = el("div", { class: `tt-pop ${size}`.trim(), text });
    pops.append(pop);
    later(() => pop.remove(), 1150);
  }

  function burstRows(rows, count) {
    if (reduceMotion) return;
    const size = board.width / COLS;
    const colors = Object.values(skin.pieces);
    for (const row of rows) {
      for (let x = 0; x < COLS; x++) {
        for (let k = 0; k < (ink ? 2 : 3); k++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = ((ink ? 1 : 2) + Math.random() * (ink ? 3 : 5)) * (count >= 4 ? 1.6 : 1) * size / 1000;
          const life = (ink ? 700 : 550) + Math.random() * 500;
          particles.push({
            x: (x + 0.5) * size,
            y: (row + 0.5) * size,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - (ink ? 0 : size * 0.004),
            r: size * (ink ? 0.1 + Math.random() * 0.22 : 0.05 + Math.random() * 0.07),
            life,
            max: life,
            color: ink && Math.random() < (count >= 4 ? 0.35 : 0.1) ? skin.accent : colors[(Math.random() * colors.length) | 0],
          });
        }
      }
    }
    if (particles.length > 600) particles.splice(0, particles.length - 600);
  }

  function stepEffects(dt) {
    const size = board.width / COLS;
    const gravity = (ink ? 3 : 10) * size / 1e6;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (ink) p.r *= 1 + dt * 0.0009; // the colour blooms into the paper as it lands
    }
    if (shake > 0.3) {
      shake *= Math.exp(-dt / 70);
      boardWrap.style.transform = `translate(${((Math.random() - 0.5) * 2 * shake).toFixed(1)}px, ${((Math.random() - 0.5) * 2 * shake).toFixed(1)}px)`;
    } else if (shake) {
      shake = 0;
      boardWrap.style.transform = "";
    }
  }

  function kick(px) {
    if (!reduceMotion) shake = Math.max(shake, px);
  }

  function setBeat() {
    overlay.style.setProperty("--tt-beat", `${(60 / tempoFor(game.getState().level)).toFixed(3)}s`);
  }

  // ----- loop -----
  let raf = 0;
  let last = 0;

  function frame(now) {
    raf = 0;
    if (closed) return;
    const dt = Math.min(100, now - last);
    last = now;
    game.tick(dt);
    handleEvents(now);
    stepEffects(dt);
    draw(now);
    const state = game.getState();
    if (!state.over && !state.paused) raf = requestAnimationFrame(frame);
    else if (particles.length || shake) raf = requestAnimationFrame(settle);
  }

  // After game over, let the last sparks fall and the shake settle.
  function settle(now) {
    raf = 0;
    if (closed) return;
    const dt = Math.min(100, now - last);
    last = now;
    stepEffects(dt);
    draw(now);
    if (particles.length || shake) raf = requestAnimationFrame(settle);
  }

  function run() {
    if (!raf && !closed) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  const CLEAR_WORDS = ["", "", "双消！", "三消！", "四消！"];
  let hardDropped = false;

  function handleEvents(now) {
    let locked = false;
    let cleared = 0;
    for (const event of game.drainEvents()) {
      if (event.type === "lock") {
        locked = true;
        if (!hardDropped) sound.sfx("lock");
      } else if (event.type === "clear") {
        cleared = event.count;
        if (!reduceMotion) flashes.push({ rows: event.rows, until: now + 260 });
        burstRows(event.rows, event.count);
        sound.sfx("clear", event.count);
        flashClass(boardWrap, "tt-hit", 320);
        kick(event.count >= 4 ? 9 : event.count >= 3 ? 5 : event.count >= 2 ? 3 : 0);
        if (event.count >= 2) popup(CLEAR_WORDS[event.count], event.count >= 4 ? "tt-big" : "");
        live.textContent = `消除 ${event.count} 行`;
      } else if (event.type === "level") {
        sound.setLevel(event.level);
        sound.sfx("level");
        setBeat();
        flashClass(overlay, "tt-levelup", 900);
        popup(`升级 · Lv.${event.level}`, "tt-small");
        live.textContent = `等级 ${event.level}`;
      } else if (event.type === "over") {
        sound.stopMusic();
        sound.sfx("over");
        stopRepeats();
        const score = game.getState().score;
        draw(now, true);
        showMessage("over");
        if (score > best) {
          best = score;
          writeBest(storageKey, best);
        }
        draw(now, true);
      }
    }
    if (locked) {
      combo = cleared ? combo + 1 : -1;
      if (combo >= 1) popup(`连击 ×${combo + 1}`, "tt-small");
    }
    hardDropped = false;
    const reached = skinStage(game.getState().score);
    if (reached > stage) applySkin(reached);
  }

  function pause() {
    const state = game.getState();
    if (!started || state.over || state.paused) return;
    game.pause();
    sound.pause();
    overlay.classList.add("tt-paused");
    stopRepeats();
    pauseBtn.textContent = "继续";
    showMessage("pause");
  }

  function resume() {
    if (game.getState().over) return;
    game.resume();
    sound.resume();
    overlay.classList.remove("tt-paused");
    pauseBtn.textContent = "暂停";
    showMessage(null);
    overlay.focus({ preventScroll: true });
    run();
  }

  function restartGame() {
    game.reset();
    flashes.length = 0;
    particles.length = 0;
    trails.length = 0;
    combo = -1;
    if (stage !== 0) applySkin(0, false);
    sound.setLevel(1);
    setBeat();
    sound.start();
    started = true;
    resume();
    draw(performance.now(), true);
  }

  // ----- input -----
  const act = {
    left: () => game.moveLeft(),
    right: () => game.moveRight(),
    down: () => game.softDrop(),
    rotate: () => game.rotateCW(),
    rotateCCW: () => game.rotateCCW(),
    drop: () => game.hardDrop(),
    hold: () => game.hold(),
  };
  const playing = () => {
    const state = game.getState();
    return started && !state.paused && !state.over;
  };
  function perform(name) {
    if (!playing()) return;
    const before = name === "drop" ? game.getState() : null;
    const result = act[name]();
    if (name === "left" || name === "right") {
      if (result) sound.sfx("move");
    } else if (name === "rotate" || name === "rotateCCW") {
      if (result) sound.sfx("rotate");
    } else if (name === "hold") {
      if (result) sound.sfx("hold");
    } else if (name === "drop" && before?.active) {
      hardDropped = true;
      sound.sfx("drop");
      kick(result > 0 ? 3 : 1.5);
      if (result > 0 && !reduceMotion) {
        const cols = new Map();
        for (const [x, y] of before.active.cells) cols.set(x, { x, top: Math.max(0, Math.min(y, cols.get(x)?.top ?? y)), bottom: 0 });
        for (const [x, y] of before.ghost) if (cols.has(x)) cols.get(x).bottom = Math.max(cols.get(x).bottom, y);
        trails.push({ cols: [...cols.values()], color: skin.pieces[before.active.type], until: performance.now() + 260 });
      }
    }
    handleEvents(performance.now());
    draw(performance.now());
  }

  // press-and-hold auto repeat
  const repeats = new Map();
  function startRepeat(id, name) {
    stopRepeat(id);
    if (name === "left") stopRepeatsFor("right");
    if (name === "right") stopRepeatsFor("left");
    perform(name);
    const delay = name === "down" ? 50 : 160;
    const every = name === "down" ? 45 : 50;
    const timer = { name, id: 0 };
    timer.id = setTimeout(function again() {
      perform(name);
      timer.id = setTimeout(again, every);
    }, delay);
    repeats.set(id, timer);
  }
  function stopRepeat(id) {
    const timer = repeats.get(id);
    if (timer) clearTimeout(timer.id);
    repeats.delete(id);
  }
  function stopRepeatsFor(name) {
    for (const [id, timer] of repeats) if (timer.name === name) stopRepeat(id);
  }
  function stopRepeats() {
    for (const id of [...repeats.keys()]) stopRepeat(id);
    for (const button of controls.querySelectorAll(".tt-on")) button.classList.remove("tt-on");
  }

  const KEYS = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowDown: "down",
    ArrowUp: "rotate",
    KeyX: "rotate",
    KeyZ: "rotateCCW",
    Space: "drop",
    KeyC: "hold",
    ShiftLeft: "hold",
    ShiftRight: "hold",
  };
  const REPEATING = new Set(["left", "right", "down"]);

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.code === "KeyM") {
      event.preventDefault();
      toggleSound();
      return;
    }
    if (event.code === "KeyP") {
      event.preventDefault();
      if (!started) return;
      if (game.getState().paused) resume();
      else pause();
      return;
    }
    const name = KEYS[event.code];
    if (!name) return;
    // Let Space/Enter press a focused button (start / continue cards) instead of hard-dropping.
    if (!playing()) return;
    event.preventDefault();
    if (event.repeat) return;
    if (REPEATING.has(name)) startRepeat(`key:${event.code}`, name);
    else perform(name);
  }

  function onKeyUp(event) {
    stopRepeat(`key:${event.code}`);
  }

  controls.addEventListener("pointerdown", (event) => {
    const button = event.target.closest(".tt-ctl");
    if (!button) return;
    event.preventDefault();
    const name = button.dataset.action;
    button.classList.add("tt-on");
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      /* not capturable */
    }
    if (REPEATING.has(name)) startRepeat(`ptr:${event.pointerId}`, name);
    else perform(name);
  });
  const release = (event) => {
    const button = event.target.closest?.(".tt-ctl");
    if (button) button.classList.remove("tt-on");
    stopRepeat(`ptr:${event.pointerId}`);
  };
  controls.addEventListener("pointerup", release);
  controls.addEventListener("pointercancel", release);
  controls.addEventListener("lostpointercapture", release);
  // Keyboard users: buttons still work with Enter/Space via click.
  controls.addEventListener("click", (event) => {
    if (event.detail !== 0) return; // pointer presses were already handled
    const button = event.target.closest(".tt-ctl");
    if (button) perform(button.dataset.action);
  });
  controls.addEventListener("contextmenu", (event) => event.preventDefault());

  // gestures on the board: drag sideways to move, drag down to soft drop, tap to rotate, flick down to hard drop
  let gesture = null;
  board.addEventListener("pointerdown", (event) => {
    if (!playing()) return;
    event.preventDefault();
    try {
      board.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    gesture = { id: event.pointerId, x0: event.clientX, y0: event.clientY, sx: event.clientX, sy: event.clientY, t0: performance.now(), moved: false };
  });
  board.addEventListener("pointermove", (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const step = Math.max(14, cell * 0.9);
    while (event.clientX - gesture.sx >= step) {
      gesture.sx += step;
      gesture.moved = true;
      perform("right");
    }
    while (gesture.sx - event.clientX >= step) {
      gesture.sx -= step;
      gesture.moved = true;
      perform("left");
    }
    while (event.clientY - gesture.sy >= step) {
      gesture.sy += step;
      gesture.moved = true;
      perform("down");
    }
    if (gesture.sy - event.clientY > step) gesture.sy = event.clientY; // ignore upward drags
  });
  const endGesture = (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dt = performance.now() - gesture.t0;
    const dx = event.clientX - gesture.x0;
    const dy = event.clientY - gesture.y0;
    if (event.type === "pointerup") {
      if (!gesture.moved && Math.hypot(dx, dy) < 12 && dt < 350) perform("rotate");
      else if (dy > cell * 2.5 && dy / Math.max(dt, 1) > 0.9 && Math.abs(dy) > Math.abs(dx) * 1.5) perform("drop");
    }
    gesture = null;
  };
  board.addEventListener("pointerup", endGesture);
  board.addEventListener("pointercancel", endGesture);
  holdBtn.addEventListener("click", () => perform("hold"));
  pauseBtn.addEventListener("click", () => {
    if (!started) return;
    if (game.getState().paused) resume();
    else pause();
  });
  closeBtn.addEventListener("click", () => close());
  function toggleSound() {
    soundOn = !soundOn;
    sound.setMuted(!soundOn);
    try {
      localStorage.setItem(soundKey, soundOn ? "on" : "off");
    } catch {
      /* private mode */
    }
    showSound();
  }
  soundBtn.addEventListener("click", toggleSound);

  const onVisibility = () => {
    if (document.hidden) pause();
  };
  const onBlur = () => stopRepeats();
  const onResize = () => layout();

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVisibility);
  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;
  resizeObserver?.observe(main);

  function close({ fromHistory = false } = {}) {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    stopRepeats();
    sound.close();
    for (const id of timers) clearTimeout(id);
    const score = game.getState().score;
    if (score > best) writeBest(storageKey, score);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("visibilitychange", onVisibility);
    resizeObserver?.disconnect();
    overlay.remove();
    for (const child of inerted) child.inert = false;
    html.style.overflow = saved.htmlOverflow;
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.left = saved.left;
    body.style.right = saved.right;
    body.style.width = saved.width;
    body.style.overflow = saved.overflow;
    try {
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    } catch {
      window.scrollTo(0, scrollY);
    }
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus({ preventScroll: true });
    if (historyPushed && !fromHistory && history.state?.__tetris) history.back();
    current = null;
  }

  current = { close: () => close() };
  game.pause();
  overlay.classList.add("tt-paused");
  overlay.style.setProperty("--tt-glow", skin.glow);
  overlay.style.setProperty("--tt-glow2", skin.glow2);
  overlay.style.setProperty("--tt-accent", skin.accent);
  layout();
  setBeat();
  showMessage("start");
  return current.close;
}
