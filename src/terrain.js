// The toy's TERRAIN GENERATORS (user 2026-11-22: "I love the complex terrain with obstacles ... go for something more toylike with
// focus on generating interesting mazes and topologies"). README "The toy front: controls, worlds and terrain generators".
//
// Each generator turns a seed into a WORLD for the dish as it is (its size W x H in dish px, the cells' radius R): obstacle shapes for
// the step G0b mask (src/obstacles.js: strokes, rounded blocks, round pillars; solid, porous or erase, applied in order), a round dish or
// not, springs (where the food drips), the colonies' homes and how many cells, the light, the currents, and perfusion (an inlet edge and a
// through-flow). Nothing here is a rule of the simulation: a world only uses what the dish already offers. Sizes are in cell radii, so a
// seed gives the same world on any screen for the same dish size in R (the share link carries it: ?terrain=type&seed=N&dish=WxR).
//
// Every generator keeps the open water CONNECTED (a cell can reach every part from its home: by construction, checked by reach() below)
// and keeps the shape count modest (a few hundred at most: the mask is rasterised once on the CPU; nothing per frame).

import { shapeSd } from './obstacles.js';

/** A small seeded random stream (mulberry32), its own per terrain and seed (the simulation's stream is never touched). */
export function rngFor(name, seed) {
  let h = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  let a = h || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = 2 * Math.PI;
const clampI = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));
const lerp = (a, b, t) => a + (b - a) * t;

/** A world being drawn: shapes (in order), springs, homes. */
class Sketch {
  constructor(W, H, R, rnd) {
    Object.assign(this, { W, H, R, rnd, shapes: [], springs: [], homes: [], round: false });
  }
  r(a, b) { return a + (b - a) * this.rnd(); }
  pick(list) { return list[Math.floor(this.rnd() * list.length) % list.length]; }
  line(x1, y1, x2, y2, w, kind = 'solid') { this.shapes.push({ type: 'stroke', pts: [[x1, y1], [x2, y2]], w, kind }); }
  /** A polyline wall; a long one is kept as pieces of at most 16 segments (the mask's raster culls by each piece's box: a spiral in one
   * piece took a second to rasterise, in pieces a tenth of that). */
  path(pts, w, kind = 'solid') {
    for (let i = 0; i + 1 < pts.length || (i === 0 && pts.length === 1); i += 16) {
      this.shapes.push({ type: 'stroke', pts: pts.slice(i, i + 17).map((p) => [p[0], p[1]]), w, kind });
    }
  }
  rect(x, y, w, h, kind = 'solid', r = 0) { this.shapes.push({ type: 'rect', x0: x, y0: y, x1: x + w, y1: y + h, r: Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)), kind }); }
  circle(x, y, r, kind = 'solid') { this.shapes.push({ type: 'circle', x, y, r: Math.max(0.5, r), kind }); }
  /** The whole dish solid (a rock to carve with erase shapes). */
  rock() { const R = this.R; this.rect(-3 * R, -3 * R, this.W + 6 * R, this.H + 6 * R, 'solid', 0); }
  /** A spring (kind: 'light' minerals, 'heavy' vent, 'emulsion' oil and soap ...), lasting unless life is given. */
  spring(x, y, kind = 'light', rate = null, life = 1e9) { this.springs.push({ x, y, kind, rate, life }); }
  home(x, y) { this.homes.push([x, y]); }
  /** The cells' distance field at (x, y) (CSS px, < 0 inside what stops cells), as src/obstacles.js sdAt works it out. */
  sd(x, y) {
    let a = 1e9;
    for (const sh of this.shapes) {
      const d = shapeSd(sh, x, y);
      if (sh.kind === 'erase') a = Math.max(a, -d); else a = Math.min(a, d);
    }
    if (this.round) a = Math.min(a, Math.min(this.W, this.H) / 2 - this.R - Math.hypot(x - this.W / 2, y - this.H / 2));
    return Math.min(a, x, y, this.W - x, this.H - y);
  }
  /** The nearest point to (x, y) with at least `clear` of open water round it (a spiral search; the point itself if none is found). */
  free(x, y, clear) {
    if (this.sd(x, y) >= clear) return [x, y];
    const R = this.R;
    for (let k = 1; k < 160; k++) {
      const a = k * 2.39996, d = 0.5 * R * Math.sqrt(k) * 1.6;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (this.sd(px, py) >= clear) return [px, py];
    }
    return [x, y];
  }
}

// ---------- mazes on a grid ----------
/** A spanning tree of an nx x ny grid (backtracker: long winding corridors; prim: many short dead ends). Returns the open edges. */
function gridMaze(nx, ny, start, rnd, style) {
  const seen = new Uint8Array(nx * ny), open = new Set();
  const key = (x, y, a, b) => `${Math.min(x, a)},${Math.min(y, b)},${a !== x ? 'v' : 'h'}`;
  const nbs = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < nx && b < ny);
  seen[start[1] * nx + start[0]] = 1;
  if (style === 'prim') {
    const front = [];
    const push = (x, y) => { for (const [a, b] of nbs(x, y)) if (!seen[b * nx + a]) front.push([x, y, a, b]); };
    push(...start);
    while (front.length) {
      const i = Math.floor(rnd() * front.length);
      const [x, y, a, b] = front[i];
      front[i] = front[front.length - 1]; front.pop();
      if (seen[b * nx + a]) continue;
      seen[b * nx + a] = 1;
      open.add(key(x, y, a, b));
      push(a, b);
    }
  } else {
    const stack = [start];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const nb = nbs(x, y).filter(([a, b]) => !seen[b * nx + a]);
      if (!nb.length) { stack.pop(); continue; }
      const [a, b] = nb[Math.floor(rnd() * nb.length)];
      seen[b * nx + a] = 1;
      open.add(key(x, y, a, b));
      stack.push([a, b]);
    }
  }
  return open;
}
/** The walls of a grid maze as long straight strokes (collinear wall pieces merged), the dish's own edge as the outer wall. */
function mazeWalls(S, nx, ny, open, w) {
  const cw = S.W / nx, ch = S.H / ny;
  for (let i = 0; i + 1 < nx; i++) {   // vertical walls at x = (i + 1) cw
    let j0 = -1;
    for (let j = 0; j <= ny; j++) {
      const wall = j < ny && !open.has(`${i},${j},v`);
      if (wall && j0 < 0) j0 = j;
      if (!wall && j0 >= 0) { S.line((i + 1) * cw, j0 === 0 ? -w : j0 * ch, (i + 1) * cw, j === ny ? S.H + w : j * ch, w); j0 = -1; }
    }
  }
  for (let j = 0; j + 1 < ny; j++) {   // horizontal walls at y = (j + 1) ch
    let i0 = -1;
    for (let i = 0; i <= nx; i++) {
      const wall = i < nx && !open.has(`${i},${j},h`);
      if (wall && i0 < 0) i0 = i;
      if (!wall && i0 >= 0) { S.line(i0 === 0 ? -w : i0 * cw, (j + 1) * ch, i === nx ? S.W + w : i * cw, (j + 1) * ch, w); i0 = -1; }
    }
  }
}
/** Each grid cell's open sides and its distance (steps) from the start. */
function mazeGraph(nx, ny, open, start) {
  const deg = new Uint8Array(nx * ny), dist = new Int32Array(nx * ny).fill(-1);
  const has = (x, y, a, b) => open.has(`${Math.min(x, a)},${Math.min(y, b)},${a !== x ? 'v' : 'h'}`);
  const q = [start];
  dist[start[1] * nx + start[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = x + dx, b = y + dy;
      if (a < 0 || b < 0 || a >= nx || b >= ny || !has(x, y, a, b)) continue;
      deg[y * nx + x]++;
      if (dist[b * nx + a] < 0) { dist[b * nx + a] = dist[y * nx + x] + 1; q.push([a, b]); }
    }
  }
  return { deg, dist };
}

function gridMazeWorld(S, style, pitchR, wallR, braid) {
  const { W, H, R } = S;
  const pitch = pitchR * R;
  const nx = clampI(W / pitch, 3, 40), ny = clampI(H / pitch, 3, 40), cw = W / nx, ch = H / ny;
  // (the start in a corner the toy's buttons leave free: the left side of a wide dish, the top of a tall one)
  const corner = S.pick(W >= H ? [[0, 0], [0, ny - 1]] : [[0, 0], [nx - 1, 0]]);
  const start = style === 'prim' ? [Math.floor(nx / 2), Math.floor(ny / 2)] : corner;
  const open = gridMaze(nx, ny, start, S.rnd, style);
  // braiding: a few extra openings make loops (a maze with more than one way round)
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
    if (x + 1 < nx && S.rnd() < braid) open.add(`${x},${y},v`);
    if (y + 1 < ny && S.rnd() < braid) open.add(`${x},${y},h`);
  }
  mazeWalls(S, nx, ny, open, wallR * R);
  const { deg, dist } = mazeGraph(nx, ny, open, start);
  const at = (i, j) => [(i + 0.5) * cw, (j + 0.5) * ch];
  // the colony's home: the start and its nearest neighbours (each colony one founder)
  const order = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) order.push([dist[j * nx + i], i, j]);
  order.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of order.slice(0, 3)) S.home(...at(i, j));
  S.spring(...at(...start), 'light');
  const [, gx, gy] = order[order.length - 1];   // the far end: the richest food
  S.spring(...at(gx, gy), 'heavy', 8);
  S.spring(at(gx, gy)[0] + 0.25 * cw, at(gx, gy)[1], 'light');
  // a few small springs in dead ends along the way
  const ends = order.filter(([d, i, j]) => deg[j * nx + i] === 1 && d > 2 && !(i === gx && j === gy));
  for (let k = 0; k < Math.min(style === 'prim' ? 5 : 3, ends.length); k++) {
    const [, i, j] = ends.splice(Math.floor(S.rnd() * ends.length), 1)[0];
    S.spring(...at(i, j), k % 2 ? 'heavy' : 'light', k % 2 ? 3 : 6);
  }
  return {};
}

// ---------- the generators ----------
export const TERRAINS = {
  maze: {
    label: 'Maze',
    line: 'A winding labyrinth. Food drips at one corner, richest in the far one; life gathers there and creeps along the corridors.',
    make(S) { return gridMazeWorld(S, 'backtrack', S.r(15, 21), 1.6, S.r(0, 0.05)); },
  },
  thicket: {
    label: 'Thicket',
    line: 'A tangle of short dead ends grown from the middle, with small springs hidden in the nooks.',
    make(S) { return gridMazeWorld(S, 'prim', S.r(11, 14), 1.4, 0.02); },
  },
  caves: {
    label: 'Caves',
    line: 'Chambers hollowed out of rock, joined by twisting tunnels. Food in the deepest cave.',
    make(S) {
      const { W, H, R } = S;
      S.rock();
      // chambers: spaced darts in from the edges
      const ch = [];
      const want = clampI(W * H / (R * R) / 2600, 5, 14);
      for (let t = 0; t < 600 && ch.length < want; t++) {
        const r = S.r(6, 12) * R, x = S.r(r + 4 * R, W - r - 4 * R), y = S.r(r + 4 * R, H - r - 4 * R);
        if (ch.every((c) => Math.hypot(c.x - x, c.y - y) > c.r + r + 10 * R)) ch.push({ x, y, r });
      }
      // tunnels: a minimum spanning tree over the chambers, plus one or two loops
      const edges = [], inTree = [0];
      const rest = new Set(ch.map((_, i) => i).slice(1));
      while (rest.size) {
        let best = null;
        for (const a of inTree) for (const b of rest) {
          const d = Math.hypot(ch[a].x - ch[b].x, ch[a].y - ch[b].y);
          if (!best || d < best[2]) best = [a, b, d];
        }
        edges.push(best); inTree.push(best[1]); rest.delete(best[1]);
      }
      for (let k = 0; k < 2 && ch.length > 3; k++) {
        const a = Math.floor(S.rnd() * ch.length), b = Math.floor(S.rnd() * ch.length);
        if (a !== b && !edges.some((e) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) edges.push([a, b, 0]);
      }
      for (const [a, b] of edges) {
        const A = ch[a], B = ch[b], n = 4, pts = [[A.x, A.y]];
        const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
        for (let k = 1; k < n; k++) {
          const t = k / n, off = S.r(-0.18, 0.18) * L;
          pts.push([A.x + dx * t - dy / L * off, A.y + dy * t + dx / L * off]);
        }
        pts.push([B.x, B.y]);
        S.path(pts, S.r(4.5, 7) * R, 'erase');
      }
      for (const c of ch) S.circle(c.x, c.y, c.r, 'erase');
      // stalagmites in the bigger chambers (solid again, after the carving)
      for (const c of ch) {
        if (c.r < 9 * R) continue;
        for (let k = 0, m = 1 + Math.floor(S.rnd() * 3); k < m; k++) {
          const a = S.r(0, TAU), d = S.r(0.2, 0.55) * c.r;
          S.circle(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, S.r(1.1, 2) * R);
        }
      }
      // home in the first chamber, food in the farthest (by tunnel hops) and a little on the way
      const hop = ch.map(() => -1); hop[0] = 0;
      for (let changed = true; changed;) {
        changed = false;
        for (const [a, b] of edges) {
          if (hop[a] >= 0 && hop[b] < 0) { hop[b] = hop[a] + 1; changed = true; }
          if (hop[b] >= 0 && hop[a] < 0) { hop[a] = hop[b] + 1; changed = true; }
        }
      }
      const far = hop.indexOf(Math.max(...hop));
      const near = edges.find((e) => e[0] === 0 || e[1] === 0);
      const second = near ? (near[0] === 0 ? near[1] : near[0]) : 0;
      S.home(ch[0].x, ch[0].y); if (second !== far) S.home(ch[second].x, ch[second].y);
      S.home(ch[0].x + 0.4 * ch[0].r, ch[0].y);
      S.spring(ch[0].x, ch[0].y, 'light');
      S.spring(ch[far].x, ch[far].y, 'heavy', 8);
      S.spring(ch[far].x + 0.4 * ch[far].r, ch[far].y, 'light');
      for (let i = 1; i < ch.length; i++) if (i !== far && i !== second && S.rnd() < 0.4) S.spring(ch[i].x, ch[i].y, S.rnd() < 0.5 ? 'light' : 'heavy', 3);
      return { light: { power: 0.8 } };
    },
  },
  delta: {
    label: 'River delta',
    wide: true,   // (drawn along the dish's longer side: on a tall dish the river flows down)
    line: 'Fresh water flows in from the left and splits into channels on its way to the sea. The flow carries food downstream.',
    make(S) {
      const { W, H, R } = S;
      S.rock();
      const x0 = 0.13 * W, x1 = 0.87 * W;
      S.rect(-3 * R, -3 * R, x0 + 3 * R, H + 6 * R, 'erase', 0);          // the lake the river leaves
      S.rect(x1, -3 * R, W - x1 + 3 * R, H + 6 * R, 'erase', 0);          // the sea it reaches
      const levels = Math.min(W / R > 150 ? 5 : 4, 3 + Math.floor(S.rnd() * 3)), span = (x1 - x0 + 4 * R) / levels;
      const tips = [];
      const branch = (x, y, lvl, w, spread) => {
        const nx = lvl === levels - 1 ? x1 + 3 * R : x + span;
        const kids = lvl === levels - 1 ? [y] : S.rnd() < 0.15 && lvl > 0 ? [y + S.r(-0.3, 0.3) * spread] : [y - spread * S.r(0.6, 1.05), y + spread * S.r(0.6, 1.05)];
        for (const ty0 of kids) {
          const ty = Math.max(5 * R, Math.min(H - 5 * R, ty0));
          const pts = [[x, y]];
          for (let k = 1; k < 5; k++) { const t = k / 5; pts.push([lerp(x, nx, t), lerp(y, ty, t * t * (3 - 2 * t)) + S.r(-1, 1) * 3 * R]); }
          pts.push([nx, ty]);
          S.path(pts, w, 'erase');
          if (lvl < levels - 1) branch(nx, ty, lvl + 1, Math.max(4.2 * R, w * 0.78), spread * 0.55);
          else tips.push(ty);
        }
      };
      const y0 = H * S.r(0.4, 0.6);
      branch(x0 - 2 * R, y0, 0, S.r(9, 11) * R, H * 0.27);
      // a few cross channels between neighbouring mouths (a braided river)
      tips.sort((a, b) => a - b);
      for (let k = 0; k + 1 < tips.length; k++) {
        if (S.rnd() < 0.45 && tips[k + 1] - tips[k] < 0.3 * H) {
          const x = S.r(x1 - span * 0.9, x1 - 4 * R);
          S.line(x, tips[k], x + S.r(-6, 6) * R, tips[k + 1], 4.2 * R, 'erase');
        }
      }
      // islands of rock out in the sea (stepping stones)
      for (let k = 0; k < 3; k++) S.circle(S.r(x1 + 5 * R, W - 5 * R), S.r(0.15, 0.85) * H, S.r(2, 4) * R);
      S.home(0.07 * W, y0 - 6 * R); S.home(0.07 * W, y0 + 6 * R);
      S.spring(0.05 * W, y0, 'light');
      return { perfusion: { dir: 'right', speed: 0.4 }, water: { speed: 0, gyre: 0 } };
    },
  },
  forest: {
    label: 'Pillar forest',
    line: 'Pillars, sparse at one side and thick as reeds at the other, with springs in the clearing and deep in the thicket.',
    make(S) {
      const { W, H, R } = S;
      const a = S.r(0, TAU), ux = Math.cos(a), uy = Math.sin(a);
      // density along the direction a (0 at the sparse side, 1 at the dense side)
      const proj = (x, y) => (x - W / 2) * ux + (y - H / 2) * uy, span = Math.abs(W * ux) / 2 + Math.abs(H * uy) / 2;
      const tOf = (x, y) => Math.max(0, Math.min(1, 0.5 + 0.55 * proj(x, y) / span)) ** 0.8;
      const clear = [W / 2 - ux * span * 0.7, H / 2 - uy * span * 0.7];
      clear[0] = Math.max(16 * R, Math.min(W - 16 * R, clear[0])); clear[1] = Math.max(16 * R, Math.min(H - 16 * R, clear[1]));
      const cell = 6 * R, gw = Math.ceil(W / cell), gh = Math.ceil(H / cell), grid = Array.from({ length: gw * gh }, () => []);
      const pil = [];
      for (let t = 0; t < 24000 && pil.length < 520; t++) {
        const x = S.r(0, W), y = S.r(0, H), tt = tOf(x, y);
        const r = lerp(5, 1, tt) * R * S.r(0.6, 1.1), gap = lerp(12, 2.6, tt) * R;
        if (Math.hypot(x - clear[0], y - clear[1]) < 14 * R + r) continue;
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let ok = true;
        for (let j = gy - 3; j <= gy + 3 && ok; j++) for (let i = gx - 3; i <= gx + 3 && ok; i++) {
          if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
          for (const p of grid[j * gw + i]) if (Math.hypot(p.x - x, p.y - y) < p.r + r + gap) { ok = false; break; }
        }
        if (!ok) continue;
        const p = { x, y, r };
        pil.push(p); grid[gy * gw + gx].push(p);
        S.circle(x, y, r);
      }
      S.home(...clear); S.home(clear[0] + 6 * R * uy, clear[1] - 6 * R * ux); S.home(clear[0] - 6 * R * uy, clear[1] + 6 * R * ux);
      S.spring(...clear, 'light');
      const deep = S.free(W / 2 + ux * span * 0.75, H / 2 + uy * span * 0.75, 1.5 * R);
      S.spring(...deep, 'heavy', 8);
      S.spring(...S.free(deep[0] - uy * 8 * R, deep[1] + ux * 8 * R, 1.5 * R), 'light');
      S.spring(...S.free(W / 2, H / 2, 2 * R), 'light', 4);
      return {};
    },
  },
  hive: {
    label: 'Honeycomb',
    line: 'Six-sided chambers with doorways between them, like a hive. Each door is a choice.',
    make(S) {
      const { W, H, R } = S;
      const s = S.r(13, 17) * R, w = 1.6 * R, door = 5.4 * R;
      const dx = Math.sqrt(3) * s, dy = 1.5 * s;
      const hexes = new Map();
      const keyOf = (q, r) => `${q},${r}`;
      const centre = (q, r) => [dx * (q + r / 2) + W / 2, dy * r + H / 2];
      const RR = Math.ceil(Math.max(W, H) / dy) + 2;
      for (let r = -RR; r <= RR; r++) for (let q = -2 * RR; q <= 2 * RR; q++) {
        const [x, y] = centre(q, r);
        if (x > 0.55 * s && x < W - 0.55 * s && y > 0.55 * s && y < H - 0.55 * s) hexes.set(keyOf(q, r), { q, r, x, y });
      }
      const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
      // the doors: a random spanning tree (every chamber reachable) plus a few extra
      const doors = new Set(), list = [...hexes.values()];
      const start = list.reduce((b, h) => (Math.hypot(h.x - W / 2, h.y - H / 2) < Math.hypot(b.x - W / 2, b.y - H / 2) ? h : b), list[0]);
      const seen = new Set([keyOf(start.q, start.r)]), stack = [start];
      const ek = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
      while (stack.length) {
        const h = stack[stack.length - 1];
        const nb = DIRS.map(([a, b]) => hexes.get(keyOf(h.q + a, h.r + b))).filter((n) => n && !seen.has(keyOf(n.q, n.r)));
        if (!nb.length) { stack.pop(); continue; }
        const n = nb[Math.floor(S.rnd() * nb.length)];
        seen.add(keyOf(n.q, n.r)); doors.add(ek(keyOf(h.q, h.r), keyOf(n.q, n.r))); stack.push(n);
      }
      // the walls: every edge between two chambers (with a door in its middle if it has one); the hive's rim stays open to a moat
      for (const h of list) {
        for (const [a, b] of DIRS) {
          const n = hexes.get(keyOf(h.q + a, h.r + b));
          if (!n || keyOf(n.q, n.r) < keyOf(h.q, h.r)) continue;
          const mx = (h.x + n.x) / 2, my = (h.y + n.y) / 2, ex = -(n.y - h.y) / dx, ey = (n.x - h.x) / dx;   // the edge's direction (unit)
          const half = s / 2;
          const k = ek(keyOf(h.q, h.r), keyOf(n.q, n.r));
          if (doors.has(k) || S.rnd() < 0.12) {
            S.line(mx - ex * half, my - ey * half, mx - ex * door / 2, my - ey * door / 2, w);
            S.line(mx + ex * door / 2, my + ey * door / 2, mx + ex * half, my + ey * half, w);
          } else S.line(mx - ex * half, my - ey * half, mx + ex * half, my + ey * half, w);
        }
      }
      S.home(start.x, start.y);
      for (const [a, b] of DIRS.slice(0, 6)) { const n = hexes.get(keyOf(start.q + a, start.r + b)); if (n && doors.has(ek(keyOf(start.q, start.r), keyOf(n.q, n.r))) && S.homes.length < 3) S.home(n.x, n.y); }
      while (S.homes.length < 3) S.home(start.x + S.r(-0.3, 0.3) * s, start.y + S.r(-0.3, 0.3) * s);
      S.spring(start.x, start.y, 'light');
      const far = [...list].sort((a, b) => Math.hypot(b.x - start.x, b.y - start.y) - Math.hypot(a.x - start.x, a.y - start.y));
      S.spring(far[0].x, far[0].y, 'heavy', 8);
      for (let k = 1; k < Math.min(4, far.length); k++) { const h = far[Math.floor(S.rnd() * Math.min(far.length, 12))]; S.spring(h.x, h.y, k === 2 ? 'heavy' : 'light', 4); }
      return {};
    },
  },
  rings: {
    label: 'Labyrinth',
    line: 'A round labyrinth of rings and gates. The richest food is in the middle; the way in goes all round each ring.',
    make(S) {
      const { W, H, R } = S;
      S.round = true;
      const cx = W / 2, cy = H / 2, rD = Math.min(W, H) / 2 - R, w = 1.6 * R;
      const band = S.r(10, 13) * R, r0 = 9 * R;
      const K = Math.max(2, Math.floor((rD - r0 - 8 * R) / band) + 1);
      const gapA = (r) => 5.5 * R / r;   // a gate 5.5 R wide on ring r
      let theta = S.r(0, TAU);
      const rings = [];
      for (let k = K - 1; k >= 0; k--) {   // from the outside in: each gate is reached the long way round from the one outside it
        const r = r0 + k * band;
        rings[k] = { r, gate: theta };
        theta += (S.rnd() < 0.5 ? 1 : -1) * S.r(0.5, 0.95) * Math.PI;
      }
      const arc = (r, a0, a1) => {
        const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) * r / (2.5 * R))), pts = [];
        for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
        return pts;
      };
      for (const g of rings) { const h = gapA(g.r); S.path(arc(g.r, g.gate + h, g.gate + TAU - h), w); }
      // one spoke in each band, just beside the outer ring's gate: the way in goes all round the band
      for (let k = 0; k + 1 < K; k++) {
        const inner = rings[k], outer = rings[k + 1], a = outer.gate + (S.rnd() < 0.5 ? 1 : -1) * (gapA(outer.r) + 0.12);
        S.line(cx + Math.cos(a) * inner.r, cy + Math.sin(a) * inner.r, cx + Math.cos(a) * outer.r, cy + Math.sin(a) * outer.r, w);
      }
      S.spring(cx, cy, 'heavy', 8); S.spring(cx + 3 * R, cy, 'light');
      const ro = (rings[K - 1].r + rD) / 2;
      for (let k = 0; k < 3; k++) { const a = rings[K - 1].gate + Math.PI + (k - 1) * 0.6; S.home(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro); }
      { const a = rings[K - 1].gate + Math.PI; S.spring(cx + Math.cos(a) * ro, cy + Math.sin(a) * ro, 'light'); }
      return {};
    },
  },
  spiral: {
    label: 'Spiral',
    line: 'One long corridor winding into the centre (sometimes two), with a few short cuts.',
    make(S) {
      const { W, H, R } = S;
      S.round = true;
      const cx = W / 2, cy = H / 2, rD = Math.min(W, H) / 2 - R, w = 1.6 * R;
      const arms = S.rnd() < 0.35 ? 2 : 1, pitch = S.r(12, 15) * R * arms, dir = S.rnd() < 0.5 ? 1 : -1, a0 = S.r(0, TAU);
      const rIn = 7 * R, rOut = rD - 6 * R, turns = (rOut - rIn) / pitch;
      for (let k = 0; k < arms; k++) {
        const pts = [];
        const n = Math.ceil(turns * TAU * rOut / (3 * R));
        for (let i = 0; i <= n; i++) {
          const t = i / n, a = a0 + k * TAU / arms + dir * t * turns * TAU, r = rIn + t * (rOut - rIn);
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        S.path(pts, w);
      }
      // a few short cuts through the wall
      for (let k = 0, m = Math.floor(S.rnd() * 3); k < m; k++) {
        const t = S.r(0.25, 0.85), a = a0 + dir * t * turns * TAU, r = rIn + t * (rOut - rIn);
        S.circle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.6 * R, 'erase');
      }
      S.spring(cx, cy, 'heavy', 8); S.spring(cx + 2.5 * R, cy + 2.5 * R, 'light');
      const ae = a0 + dir * turns * TAU + dir * 0.6, re = (rOut + rD) / 2;
      S.home(cx + Math.cos(ae) * re, cy + Math.sin(ae) * re);
      S.home(cx + Math.cos(ae + dir * 0.5) * re, cy + Math.sin(ae + dir * 0.5) * re);
      S.spring(cx + Math.cos(ae + dir * 0.25) * re, cy + Math.sin(ae + dir * 0.25) * re, 'light');
      return {};
    },
  },
  islands: {
    label: 'Archipelago',
    line: 'Islands in a slowly turning sea. The current sweeps food from shore to shore.',
    make(S) {
      const { W, H, R } = S;
      const isl = [], want = clampI(W * H / (R * R) / 1700, 5, 18);
      for (let t = 0; t < 800 && isl.length < want; t++) {
        const x = S.r(14 * R, W - 14 * R), y = S.r(14 * R, H - 14 * R);
        if (isl.every((p) => Math.hypot(p.x - x, p.y - y) > 27 * R)) isl.push({ x, y });
      }
      for (const p of isl) {
        p.ext = 0;
        for (let k = 0, m = 3 + Math.floor(S.rnd() * 4); k < m; k++) {
          const a = S.r(0, TAU), d = k ? S.r(1.5, 6) * R : 0, r = S.r(k ? 2.5 : 4, 5.5) * R;
          S.circle(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, r);
          p.ext = Math.max(p.ext, d + r);
        }
      }
      for (let k = 0; k < 14; k++) { const x = S.r(4 * R, W - 4 * R), y = S.r(4 * R, H - 4 * R); if (S.sd(x, y) > 6 * R) S.circle(x, y, S.r(0.9, 2) * R); }
      // springs and homes on a few shores
      const shores = isl.slice().sort(() => S.rnd() - 0.5).slice(0, 5);
      shores.forEach((p, k) => {
        const a = S.r(0, TAU), at = S.free(p.x + Math.cos(a) * (p.ext + 3.5 * R), p.y + Math.sin(a) * (p.ext + 3.5 * R), 1.5 * R);
        S.spring(...at, k === 2 ? 'heavy' : 'light', k === 2 ? 6 : null);
        if (k < 3) S.home(at[0] + Math.cos(a) * 5 * R, at[1] + Math.sin(a) * 5 * R);
      });
      return { water: { speed: 0.55, gyre: 0.6 } };
    },
  },
  sieve: {
    label: 'Filter walls',
    line: 'Porous walls split the dish: water and atoms pass, cells cannot. Each chamber its own colony and its own food.',
    make(S) {
      const { W, H, R } = S;
      const wide = W >= H, L = wide ? W : H, M = wide ? H : W;
      const k = S.rnd() < 0.5 ? 3 : 4, amp = S.r(3, 8) * R, wl = S.r(0.5, 1.2) * M;
      const P = (u, v) => (wide ? [u, v] : [v, u]);
      const solidAt = S.rnd() < 0.45 ? Math.floor(S.rnd() * (k - 1)) : -1;   // sometimes one wall is solid with a narrow door
      for (let j = 1; j < k; j++) {
        const u0 = j * L / k, ph = S.r(0, TAU), pts = [];
        for (let v = -2 * R; v <= M + 2 * R; v += 2.5 * R) pts.push(P(u0 + amp * Math.sin(TAU * v / wl + ph), v));
        S.path(pts, 2.2 * R, j - 1 === solidAt ? 'solid' : 'porous');
        if (j - 1 === solidAt) { const v = S.r(0.2, 0.8) * M; S.circle(...P(u0 + amp * Math.sin(TAU * v / wl + ph), v), 2.6 * R, 'erase'); }
      }
      const foods = [['light', null], ['heavy', 6], ['emulsion', 4], ['light', null]];
      for (let j = 0; j < k; j++) {
        const u = (j + 0.5) * L / k;
        S.home(...P(u, 0.35 * M)); S.home(...P(u, 0.65 * M));
        const [kind, rate] = foods[j % foods.length];
        S.spring(...P(u, 0.5 * M), kind, rate);
        if (kind !== 'light') S.spring(...P(u + 0.12 * L / k, 0.2 * M), 'light', 3);
      }
      return {};
    },
  },
  // step N2 (substances that flow): an open shallows where the food MOVES: strong gusty currents and turning tides, a few scattered rocks
  // (the water runs fast round them and stills in their lee, where scoured crust and tar settle as bars), springs that wander, go dry and
  // rise elsewhere (src/flow.js)
  currents: {
    label: 'Tidal currents',
    line: 'Open shallows with strong, changing currents. Springs wander and run dry; plumes of food sweep past. Sand bars pile up behind the rocks.',
    make(S) {
      const { W, H, R } = S;
      const want = clampI(W * H / (R * R) / 2600, 4, 14), rocks = [];
      for (let t = 0; t < 600 && rocks.length < want; t++) {
        const x = S.r(12 * R, W - 12 * R), y = S.r(12 * R, H - 12 * R);
        if (rocks.every((p) => Math.hypot(p.x - x, p.y - y) > 30 * R)) rocks.push({ x, y });
      }
      for (const p of rocks) {
        // a rock: a few overlapping round stones, drawn out along a random direction (streamlined)
        const a = S.r(0, TAU), m = 2 + Math.floor(S.rnd() * 3);
        for (let k = 0; k < m; k++) {
          const d = (k - (m - 1) / 2) * S.r(1.8, 3) * R;
          S.circle(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, S.r(1.6, 3.2) * R);
        }
      }
      // springs in the open water (they wander off from here), homes beside the first ones
      // (five springs and the full light made a crowd of 4000 cells by 10 minutes: three and a dimmer sky leave room to see the water)
      for (let k = 0; k < 3; k++) {
        const at = S.free(S.r(0.15, 0.85) * W, S.r(0.15, 0.85) * H, 2 * R);
        S.spring(...at, k === 2 ? 'heavy' : 'light', k === 2 ? 5 : 10);
        if (k < 2) S.home(at[0] + 5 * R, at[1]);
      }
      return { water: { speed: 0.5, gyre: 0.5 }, flow: { strength: 2.5, sweep: 0.35, tide: 0.5 }, light: { power: 0.6 } };
    },
  },
};
export const TERRAIN_NAMES = Object.keys(TERRAINS);

/**
 * The world for terrain `name` and `seed` on a dish of W x H px with cells of radius R:
 *   { name, seed, label, line, shapes, round, springs: [{ x, y, kind, rate, life }], homes: [[x, y]], open (share), light: { power },
 *     water: { speed, gyre } | null, perfusion: { dir, speed } | null }
 * Homes and springs are moved into open water if a shape covers them.
 */
export function makeWorld(name, seed, W, H, R) {
  const T = TERRAINS[name];
  if (!T) throw new Error(`unknown terrain ${name}`);
  // a terrain drawn along the longer side (the river delta) on a tall dish: drawn on the wide frame, then turned (x <-> y)
  const flip = !!T.wide && H > W;
  let S = new Sketch(flip ? H : W, flip ? W : H, R, rngFor(name, seed));
  const o = T.make(S) || {};
  if (flip) {
    const F = new Sketch(W, H, R, S.rnd);
    const sw = (p) => [p[1], p[0]];
    F.shapes = S.shapes.map((sh) => (sh.type === 'stroke' ? { ...sh, pts: sh.pts.map(sw) }
      : sh.type === 'rect' ? { ...sh, x0: sh.y0, y0: sh.x0, x1: sh.y1, y1: sh.x1 } : { ...sh, x: sh.y, y: sh.x }));
    F.springs = S.springs.map((sp) => ({ ...sp, x: sp.y, y: sp.x }));
    F.homes = S.homes.map(sw);
    F.round = S.round;
    S = F;
    if (o.perfusion) o.perfusion = { ...o.perfusion, dir: { right: 'down', left: 'up', down: 'right', up: 'left' }[o.perfusion.dir || 'right'] };
  }
  const homes = S.homes.map(([x, y]) => S.free(x, y, 3 * R));
  // every home has food to start on: a lasting mineral spring and a slow vent within reach (as the open dish's pair beside its colony)
  for (const [x, y] of homes.slice(0, 2)) {
    const near = (kind) => S.springs.some((s) => s.kind === kind && Math.hypot(s.x - x, s.y - y) < 16 * R);
    if (!near('light')) S.spring(x + 3 * R, y, 'light');
    if (!near('heavy')) S.spring(x - 3 * R, y, 'heavy', 3);
  }
  // rates: a terrain's springs drip richer than a tapped one (6 atoms per s): the colonies' food must reach along corridors (a maze of
  // springs at 6 starved to a few dozen cells in 3 minutes)
  const RATE = { light: 16, heavy: 5, emulsion: 8, oil: 8, soap: 8 }, FLOOR = { light: 10, heavy: 4 };
  const springs = S.springs.map((s) => {
    const [x, y] = S.free(s.x, s.y, 1.5 * R);
    return { ...s, x, y, rate: Math.max(FLOOR[s.kind] || 0, s.rate != null ? s.rate : RATE[s.kind] || 6) };
  });
  return {
    name, seed: seed >>> 0, label: T.label, line: T.line, shapes: S.shapes, round: S.round, springs, homes,
    open: openShare(S), light: o.light || {}, water: o.water || null, perfusion: o.perfusion || null, flow: o.flow || null, sketch: S,
  };
}

/** The share of the dish a cell's centre may sit in (a coarse grid, 3 R): the toy scatters its founders by it. */
function openShare(S) {
  const d = 3 * S.R, gw = Math.max(1, Math.floor(S.W / d)), gh = Math.max(1, Math.floor(S.H / d));
  let n = 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (S.sd((i + 0.5) * S.W / gw, (j + 0.5) * S.H / gh) > S.R) n++;
  return n / (gw * gh);
}

/**
 * How connected the world's open water is, for cells: a grid at `step` R, open where a cell's centre may sit (the cells' distance
 * field above 0.6 R: a cell squeezes through a gap of 1.2 R plus its own width), flooded from every home (the filter walls keep each colony
 * in its own chamber: every chamber has one). { open, reached (share of the open grid), springs (how many springs reached) }.
 */
export function reach(world, W, H, R, step = 0.5) {
  const S = world.sketch, d = step * R, gw = Math.ceil(W / d), gh = Math.ceil(H / d);
  const open = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh);
  let nOpen = 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (S.sd((i + 0.5) * d, (j + 0.5) * d) > 0.6 * R) { open[j * gw + i] = 1; nOpen++; }
  const idx = ([x, y]) => Math.min(gh - 1, Math.max(0, Math.floor(y / d))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x / d)));
  const q = [];
  for (const h of world.homes) { const k = idx(h); if (!seen[k]) { seen[k] = 1; q.push(k); } }
  let n = 0;
  for (let h = 0; h < q.length; h++) {
    const p = q[h];
    if (open[p]) n++;
    const x = p % gw, y = (p - x) / gw;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = x + a, j = y + b;
      if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
      const k = j * gw + i;
      if (!seen[k] && open[k]) { seen[k] = 1; q.push(k); }
    }
  }
  const springs = world.springs.filter((s) => { const k = idx([s.x, s.y]); return seen[k] || [1, -1, gw, -gw].some((o) => seen[k + o]); }).length;
  return { open: nOpen / (gw * gh), reached: nOpen ? n / nOpen : 0, springs, of: world.springs.length, shapes: world.shapes.length };
}
