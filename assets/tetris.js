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
      /** rows: visible rows top to bottom, strings like "XXXXXXXXX." ("." empty, any other char filled). */
      setBoard(rows) {
        board = Array.from({ length: HIDDEN + ROWS }, emptyRow);
        const offset = HIDDEN + ROWS - rows.length;
        rows.forEach((text, i) => {
          board[offset + i] = [...text.padEnd(COLS, ".")].slice(0, COLS).map((c) => (c === "." ? null : "G"));
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
  padding:18px 16px 14px;text-align:center;min-width:min(240px,100%);max-width:300px;box-shadow:0 18px 50px -20px rgba(0,0,0,.6)}
.tt-card h2{margin:0 0 6px;font-size:20px;letter-spacing:.1em}
.tt-card p{margin:0 0 12px;color:var(--tt-muted);font-size:13px;line-height:1.6}
.tt-card .tt-score{font-size:30px;font-weight:700;color:var(--tt-text);font-variant-numeric:tabular-nums;margin:2px 0 4px}
.tt-card .tt-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.tt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

const ICONS = {
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  rotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v13"/><path d="M6 12l6 6 6-6"/></svg>',
  drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5l5 5 5-5"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/></svg>',
};

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
  const pad = ink ? 0 : Math.ceil(size * 0.45); // room for the neon glow
  const variants = ink ? 3 : 1;
  const tiles = {};
  for (const type of PIECES) {
    const color = theme.pieces[type];
    tiles[type] = [];
    for (let v = 0; v < variants; v++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size + pad * 2;
      const ctx = canvas.getContext("2d");
      if (ink) drawInkTile(ctx, size, color, seeded(type.charCodeAt(0) * 97 + v * 7919 + 13));
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

function drawInkTile(ctx, size, color, rand) {
  // A slightly irregular wash: lighter in the middle, ink pooling darker at the edges, a few grains.
  const inset = size * 0.08;
  const points = [];
  const steps = 12;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const side = size / 2 - inset;
    // squircle-ish outline with gentle wobble
    const cx = Math.cos(t);
    const cy = Math.sin(t);
    const k = 1 / Math.max(Math.abs(cx), Math.abs(cy)) ** 0.85;
    const wobble = 1 + (rand() - 0.5) * 0.09;
    points.push([size / 2 + cx * side * Math.min(k, 1.32) * wobble, size / 2 + cy * side * Math.min(k, 1.32) * wobble]);
  }
  const outline = new Path2D();
  points.forEach(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % points.length];
    const mx = (x + nx) / 2;
    const my = (y + ny) / 2;
    if (i === 0) outline.moveTo(mx, my);
    else outline.quadraticCurveTo(x, y, mx, my);
  });
  const [fx, fy] = points[0];
  const [sx, sy] = points[1];
  outline.quadraticCurveTo(fx, fy, (fx + sx) / 2, (fy + sy) / 2);
  outline.closePath();
  const wash = ctx.createRadialGradient(size * (0.42 + rand() * 0.16), size * (0.38 + rand() * 0.16), size * 0.05, size / 2, size / 2, size * 0.62);
  wash.addColorStop(0, withAlpha(color, 0.5));
  wash.addColorStop(0.7, withAlpha(color, 0.78));
  wash.addColorStop(1, withAlpha(color, 0.95));
  ctx.fillStyle = wash;
  ctx.fill(outline);
  ctx.save();
  ctx.clip(outline);
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = withAlpha(color, 0.12 + rand() * 0.18);
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, size * (0.04 + rand() * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,.10)";
  ctx.fillRect(size * 0.18, size * (0.2 + rand() * 0.1), size * 0.5, size * 0.07);
  ctx.restore();
  ctx.strokeStyle = withAlpha(color, 0.55);
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.stroke(outline);
}

/**
 * Open the full-screen game. Returns close().
 *   theme       { style: "neon"|"ink", background, panel, grid, text, muted, accent, pieces: {I..L}, font }
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
  const top = el("div", { class: "tt-top" }, [el("h2", { class: "tt-title", text: title }), pauseBtn, closeBtn]);

  const board = el("canvas", { class: "tt-board", role: "img", "aria-label": "游戏区域" });
  const msg = el("div", { class: "tt-msg" });
  const boardWrap = el("div", { class: "tt-boardwrap" }, [board, msg]);

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
    ctl("rotate", "旋转", ICONS.rotate),
    ctl("right", "右移", ICONS.right),
    ctl("down", "加速下落", ICONS.down),
    ctl("drop", "直接落下", ICONS.drop),
    el("button", { class: "tt-ctl", type: "button", "aria-label": "暂存方块", "data-action": "hold" }, [el("small", { text: "暂存" })]),
  ]);
  const hint = el("div", { class: "tt-hint", text: "← → 移动 · ↑ 或 X 旋转 · Z 反转 · ↓ 加速 · 空格 落下 · C 暂存 · P 暂停 · Esc 关闭" });
  const live = el("div", { class: "tt-sr", "aria-live": "polite" });

  overlay.append(style, top, main, controls, hint, live);

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
  const inerted = [];
  for (const child of body.children) {
    if (!child.inert && child.tagName !== "SCRIPT") {
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
  body.append(overlay);

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
  let tileKey = "";
  let mini = 12;
  let slots = 3;

  function layout() {
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
    const key = `${cell}@${ratio}`;
    if (key !== tileKey) {
      tileKey = key;
      tiles = makeTiles(t, Math.round(cell * ratio));
    }
    draw(performance.now(), true);
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
    ctx.fillStyle = ink ? t.panel : t.background;
    ctx.fillRect(0, 0, w, h);
    if (ink) {
      // faint paper fibres
      const rand = seeded(42);
      ctx.fillStyle = "rgba(0,0,0,.025)";
      for (let i = 0; i < 70; i++) ctx.fillRect(rand() * w, rand() * h, 1 + rand() * w * 0.05, 1);
    }
    ctx.strokeStyle = t.grid;
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
      const color = t.pieces[state.active.type];
      ctx.save();
      for (const [x, y] of state.ghost) {
        if (y < 0) continue;
        if (ink) {
          ctx.fillStyle = withAlpha(color, 0.12);
          roundRect(ctx, x * size + size * 0.1, y * size + size * 0.1, size * 0.8, size * 0.8, size * 0.2);
          ctx.fill();
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
      ctx.fillStyle = ink ? withAlpha(t.accent, 0.35 * (left / 260)) : `rgba(255,255,255,${0.55 * (left / 260)})`;
      for (const row of flash.rows) ctx.fillRect(0, row * size, w, size);
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
        el("p", { text: coarse ? "按下面的按钮操作，也可以在方块区左右滑动、点一下旋转、往下一甩直接落下。" : "← → 移动，↑ 旋转，空格直接落下。" })
      );
      primary = el("button", { class: "tt-btn tt-primary", type: "button", text: "开始" });
      primary.addEventListener("click", () => {
        started = true;
        resume();
      });
      actions.append(primary);
    } else if (kind === "pause") {
      card.append(el("h2", { text: "暂停" }), el("p", { text: `分数 ${state.score.toLocaleString("en-US")} · 行 ${state.lines}` }));
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
    draw(now);
    const state = game.getState();
    if (!state.over && !state.paused) raf = requestAnimationFrame(frame);
  }

  function run() {
    if (!raf && !closed) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function handleEvents(now) {
    for (const event of game.drainEvents()) {
      if (event.type === "clear") {
        if (!reduceMotion) flashes.push({ rows: event.rows, until: now + 260 });
        live.textContent = `消除 ${event.count} 行`;
      } else if (event.type === "level") {
        live.textContent = `等级 ${event.level}`;
      } else if (event.type === "over") {
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
  }

  function pause() {
    const state = game.getState();
    if (!started || state.over || state.paused) return;
    game.pause();
    stopRepeats();
    pauseBtn.textContent = "继续";
    showMessage("pause");
  }

  function resume() {
    if (game.getState().over) return;
    game.resume();
    pauseBtn.textContent = "暂停";
    showMessage(null);
    overlay.focus({ preventScroll: true });
    run();
  }

  function restartGame() {
    game.reset();
    flashes.length = 0;
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
    act[name]();
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
  layout();
  showMessage("start");
  return current.close;
}
