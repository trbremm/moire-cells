// App: the parts of the page around the simulation that make it easier to explore (user 2026-11-16: "if we could zoom, and
// have panels with zoos of cells and molecules and tools to add cells. And to create new cultures with more spread and some
// preset interesting dish environments"). Nothing here changes a rule of the simulation.
//
//   zoom and pan     the view camera (src/camera.js): the +, - and fit buttons at the right edge, the zoom shown under them;
//                    Ctrl+wheel, the wheel without a spotlight, middle-drag, Space + drag and two fingers are in src/main.js
//   scale bar        bottom right, a crisp line of a round length in micrometres at the toy's scale (a cell 12 um across,
//                    R = 6 um, as the CPU version's "50 um" bar), following the zoom; one bar for every look (step H1: the
//                    harmonic look shows it on the black, without the panel behind it); hidden by the View panel's "scale
//                    bar" (?scalebar=0)
//   job legend       step F0: bottom right, above the scale bar, the jobs' colours named (src/jobs.js), with how many cells show each
//                    clearly; only while the cells are coloured by job in the neon or flat look; the View panel's "job legend"
//                    (?legend=0) hides it
//   zoos             two toolbar panels, molecules and cells (src/zoo.js)
//   add cells        a tool (the cell icon): a tap places one cell, a drag a line of them, each a copy of the genome picked in
//                    the cells zoo (a lineage living now, or a founder habit). BOOKS: a placed cell starts as a new culture's
//                    founder does, with an EMPTY stock (no atoms: the atoms ledger is untouched) and the starter charge in its
//                    battery, booked as "starter charges in" (energy in, as at a new culture). It goes into a free slot (dead,
//                    its stock already handed back); with no free slot (the capacity is full) nothing is placed. The placing
//                    pauses for a moment (settle, as the genome edits of src/lab.js), so no division can take the slot meanwhile.
//   pipette          a tool (the dropper): a tap drops a short spring of the substance picked in the molecules zoo (1.5 s, 40
//                    atoms per s), booked as added like every spring; a drag drops more. Drops never push a real spring out.
//   obstacles        step G0b (src/obstacles.js): a tool (the wall and pillars): WALL (a drag paints a pen line `width` R wide),
//                    BLOCK (a drag spans a rectangle), PILLAR (a tap places a round pillar, a drag a row of them), ERASE (a drag cuts);
//                    solid or POROUS (cells stopped, water and atoms pass). The tool's button again cycles the shape; the Dish panel
//                    has the shapes, the kind, the width, undo, clear and the round dish. Touch works the same.
//
// createApp(ctx) is called by main.js before the toolbar is built (it hands the toolbar its extra panels), attach(ui) after.

import { camera, MAX_ZOOM } from './camera.js';
import { moleculePanel, cellPanel, summary } from './zoo.js';
import { SUBSTANCES, CH, lgM } from './matter.js';
import { CARBON, CB_LIP, ENZ_H, LG_CB, LG_CBC } from './carbon.js';   // step C15c: placed cells get a body (step C15d: and a pigment)
import { CW as CB_W } from './carboncells.js';
import { CELL_FLOATS, CELL_BYTES } from './cells.js';
import { BIO_FLOATS, founderGenome } from './genome.js';
import { stampFounderGlue } from './glue.js';
import { SW } from './eat.js';
import { KIND } from './field.js';
import { settle, flushLedger, readBuffer, frames } from './snapshot.js';
import { openCultureDialog, PRESETS } from './culture.js';
import { JOBS } from './jobs.js';
import { pal } from './palette.js';

const BAT_WORD = 13;          // cell_eat.wgsl: the battery's stock word
const LG_K_START = 13312;     // heat_common.wgsl: the starter charges' ledger slots (64-bit: low words, then the carries + 64)
const PIPETTE = { life: 1.5, rate: 40 };
export const TOOL_ICONS = {
  cell: '<path d="M8.5 3.5l4.6 2.65v5.3L8.5 14.1l-4.6-2.65v-5.3z"/><circle cx="8.5" cy="8.8" r="1.3" fill="currentColor" stroke="none"/><path d="M15.5 12.5v5M13 15h5"/>',
  pipette: '<path d="M13.2 2.8l4 4-2 2-4-4z"/><path d="M12.2 7.8l-7 7-1.2 3.2 3.2-1.2 7-7"/><circle cx="4.2" cy="17.4" r="0.9" fill="currentColor" stroke="none"/>',
  obstacle: '<rect x="2.8" y="3" width="6" height="14" rx="1"/><circle cx="14.2" cy="6.3" r="2.6"/><circle cx="14.2" cy="13.7" r="2.6"/>',   // step G0b
};
const OBS_SHAPES = ['wall', 'block', 'pillar', 'erase'];
const OBS_WORD = { wall: 'wall: drag paints a wall', block: 'block: drag spans a block', pillar: 'pillar: tap places one, drag a row', erase: 'erase: drag cuts through' };

const NS = 'http://www.w3.org/2000/svg';
const UM_PER_R = 6;   // the scale bar's toy scale: a cell's radius is 6 micrometres (a cell 12 um across, as the CPU version's)

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgIcon(inner) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 20 20');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}
const ZOOM_ICONS = {
  in: '<path d="M10 4v12M4 10h12"/>',
  out: '<path d="M4 10h12"/>',
  fit: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/>',
};

/** ctx: { app (main.js's view of the page), params, flag, flash, cells, matter, light, background, control, view (getter), touch } */
export function createApp(ctx) {
  const A = { ctx, ui: null };

  // ---------- zoom buttons ----------
  const box = el('div', 'zoombox');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Zoom');
  const btn = (name, title, run) => {
    const b = el('button', 'btn');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.append(svgIcon(ZOOM_ICONS[name]));
    b.addEventListener('click', () => { run(); setTimeout(() => b.blur(), 0); });
    box.append(b);
    return b;
  };
  const centre = () => [camera.SW / 2, camera.SH / 2];   // the canvas's centre (CSS px)
  btn('in', 'Zoom in (the wheel, toward the pointer; two fingers)', () => camera.zoomAt(...centre(), 1.5));
  btn('out', 'Zoom out', () => camera.zoomAt(...centre(), 1 / 1.5));
  btn('fit', 'The whole dish', () => camera.fit());
  const zlabel = el('span', 'zval', '');
  box.append(zlabel);
  document.body.append(box);

  // ---------- scale bar ----------
  const bar = el('div', 'scalebar');
  const line = el('span', 'sline');
  const label = el('span', 'slabel', '');
  bar.append(label, line);
  bar.title = 'Scale bar (a toy scale: a cell is 12 µm across, as in the CPU version)';
  document.body.append(bar);

  let lastKey = '';
  function update() {
    const HM = ctx.app.neon && ctx.app.neon.harmonic;   // step H1: its switch hides the bar; its look puts the bar on the black
    bar.hidden = !!(HM && !HM.params.scalebar);
    bar.classList.toggle('scope', !!(HM && HM.on));
    const R = ctx.cells.R || 5;
    const pxPerUm = camera.z * camera.f * R / UM_PER_R;   // screen CSS px per micrometre (fit: the dish drawn smaller or larger)
    let best = 1;
    for (const L of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) if (L * pxPerUm <= 130) best = L;
    const w = best * pxPerUm;
    const key = `${best}|${w.toFixed(1)}|${camera.z.toFixed(2)}`;
    if (key === lastKey) return;
    lastKey = key;
    line.style.width = `${w.toFixed(1)}px`;
    label.textContent = best >= 1000 ? `${best / 1000} mm` : `${best} µm`;
    zlabel.textContent = camera.z > 1.001 ? `×${camera.z < 9.95 ? camera.z.toFixed(1) : camera.z.toFixed(0)}` : '';
    box.classList.toggle('zoomed', camera.z > 1.001);
    for (const b of box.querySelectorAll('button')) b.disabled = false;
    box.children[0].disabled = camera.z >= MAX_ZOOM - 1e-6;
    box.children[1].disabled = camera.z <= 1 + 1e-6;
  }
  camera.listeners.push(update);
  if (ctx.app.neon && ctx.app.neon.harmonic) ctx.app.neon.harmonic.onBar = update;   // (step H1: the look or its switch changed)
  setInterval(update, 500);   // (R changes with a new culture, a resize)
  update();

  // ---------- step F0: the job legend ----------
  const legend = el('div', 'joblegend');
  legend.setAttribute('aria-label', 'Colour by job');
  const rows = JOBS.map((J) => {
    const r = el('div', 'jrow');
    const dot = el('span', 'jdot');
    const name = el('span', 'jname', J.label);
    const n = el('span', 'jn', '');
    r.title = J.help;
    r.append(dot, name, n);
    legend.append(r);
    return { dot, n };
  });
  document.body.append(legend);
  let legendKey = '';
  function updateLegend() {
    const C = ctx.cells, HM = ctx.app.neon && ctx.app.neon.harmonic;
    const show = C.look.legend !== false && C.look.view === 0 && !(HM && HM.on);
    legend.hidden = !show;
    if (!show) return;
    const P = pal(), st = C.stats;
    const key = `${P.name}|${st ? st.job.join(',') : ''}`;
    if (key === legendKey) return;
    legendKey = key;
    rows.forEach((r, k) => {
      const c = P.job[k] || P.job[0];
      r.dot.style.background = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      r.dot.style.boxShadow = P.name === 'flat' ? 'none' : `0 0 5px rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.85)`;
      r.n.textContent = st && st.job ? String(st.job[k] || 0) : '';
    });
  }
  setInterval(updateLegend, 500);
  updateLegend();

  // ---------- the zoos and the add tools ----------
  const pick = { genome: null, label: '', sub: CH.gT ?? 0 };   // what the add-cell tool places, what the pipette drops
  // (step C15a: the pipette's substance is a channel number, or a carbon ladder molecule's name: five atoms each)
  const subName = (x) => (typeof x === 'string' ? x : SUBSTANCES[x].name);
  const subAtoms = (x) => (typeof x === 'string' ? 5 : SUBSTANCES[x].atoms.length);
  const toolIndex = (id) => ctx.tools.findIndex((t) => t.id === id);
  const cellsZoo = cellPanel(ctx, (g, label) => {
    pick.genome = g.slice(); pick.label = label;
    ctx.app.setTool(toolIndex('cell'));
    ctx.flash(`add cells: ${label}. Tap or drag on the dish to place copies`);
    if (A.ui) A.ui.refresh();
  });
  const molZoo = moleculePanel(ctx, (c) => {
    pick.sub = c;
    ctx.app.setTool(toolIndex('pipette'));
    ctx.flash(`pipette: ${subName(c)}. Tap or drag on the dish to drop it (booked as added)`);
    if (A.ui) A.ui.refresh();
  });
  A.panels = [molZoo, cellsZoo];
  A.toolIcons = TOOL_ICONS;
  // the dish panel: the new culture dialog (src/culture.js) first
  A.dishExtra = (body) => {
    const r = document.createElement('div');
    r.className = 'row t-do';
    const m = document.createElement('div');
    m.className = 'rmain';
    const b = document.createElement('button');
    b.className = 'act'; b.type = 'button'; b.textContent = 'new culture…'; b.dataset.ui = 'culture';
    b.addEventListener('click', () => A.openCulture());
    m.append(b);
    if (ctx.preset) { const s = document.createElement('span'); s.className = 'lbl dimlbl'; s.textContent = `now: ${PRESETS[ctx.preset].label}`; m.append(s); }
    const h = document.createElement('p');
    h.className = 'help';
    h.textContent = 'how many founders, how spread (one clump, scattered, colonies, a ring), how diverse, and a preset dish (deep vents, sunlit shallows, oxygen world, oil slick, crust desert, tissue lab); opens as a link you can share';
    r.append(m, h);
    body.append(r);
    // the dish's own size (src/dish.js) and the squeeze / stretch tool (src/squeeze.js): the sample compressed or spread, contents kept
    const D = ctx.dish;
    if (!D) return;
    const r2 = document.createElement('div');
    r2.className = 'row t-do';
    const m2 = document.createElement('div');
    m2.className = 'rmain';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    const size = () => { const [w, hh] = D.sizeR; lbl.textContent = `dish ${Math.round(w)} × ${Math.round(hh)} R`; };
    size();
    let busy = false;
    const step = (f, text) => {
      const b2 = document.createElement('button');
      b2.className = 'act'; b2.type = 'button'; b2.textContent = text;
      b2.title = f < 1 ? 'Squeeze the sample: the dish x 0.8 across, its cells and matter pushed closer (nothing lost)'
        : 'Stretch the sample: the dish x 1.25 across, its cells and matter spread apart (nothing lost)';
      b2.addEventListener('click', async () => {
        if (busy || !D.scale) return;
        busy = true;
        try { await D.scale(f); size(); ctx.flash(`dish ${f < 1 ? 'squeezed' : 'stretched'}: ${D.line()}`); } catch (e) { ctx.flash(String(e.message || e)); }
        busy = false;
      });
      m2.append(b2);
    };
    m2.append(lbl);
    step(0.8, 'squeeze'); step(1.25, 'stretch');
    const h2 = document.createElement('p');
    h2.className = 'help';
    h2.textContent = 'the dish keeps its size when the window changes; squeeze or stretch the sample like a coverslip pressed or let go: cells, atoms, heat and springs move with it, nothing is lost (moire.dish.scale(f))';
    r2.append(m2, h2);
    body.append(r2);
    if (D.follow) r2.style.display = 'none';
    obstacleRow(body);
  };
  // step G0b: the obstacle tool's choices (shape, kind, width), undo, clear, the round dish
  function obstacleRow(body) {
    const O = ctx.obstacles;
    if (!O) return;
    const r = document.createElement('div');
    r.className = 'row t-do';
    const m = document.createElement('div');
    m.className = 'rmain';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'obstacles';
    m.append(lbl);
    const btns = [];
    const mk = (text, title, run, on) => {
      const b = document.createElement('button');
      b.className = 'act'; b.type = 'button'; b.textContent = text; b.title = title;
      b.addEventListener('click', () => { const t = run(); if (t) ctx.flash(t); sync(); });
      btns.push([b, on]);
      m.append(b);
      return b;
    };
    for (const sh of OBS_SHAPES) mk(sh, OBS_WORD[sh], () => { ctx.app.setTool(toolIndex('obstacle')); O.params.shape = sh; if (A.ui) A.ui.refresh(); return `obstacles: ${obsText()}`; }, () => O.params.shape === sh);
    mk('porous', 'porous: cells are stopped, water and atoms pass (a filter insert); off: solid', () => { O.params.kind = O.params.kind === 'porous' ? 'solid' : 'porous'; return `obstacles: ${O.params.kind}`; }, () => O.params.kind === 'porous');
    mk('−', 'thinner walls, smaller pillars', () => { O.params.width = Math.max(0.5, O.params.width / 1.25); O.params.pillar = Math.max(0.5, O.params.pillar / 1.25); return `walls ${O.params.width.toFixed(1)} R wide, pillars ${O.params.pillar.toFixed(1)} R in radius`; });
    mk('+', 'thicker walls, bigger pillars', () => { O.params.width = Math.min(20, O.params.width * 1.25); O.params.pillar = Math.min(20, O.params.pillar * 1.25); return `walls ${O.params.width.toFixed(1)} R wide, pillars ${O.params.pillar.toFixed(1)} R in radius`; });
    mk('undo', 'remove the last shape painted', () => O.undo());
    mk('clear', 'remove every obstacle', () => O.clear());
    mk('round dish', 'the dish round (the outside of its circle a solid rim) or square', () => O.setRound(!O.round), () => O.round);
    const h = document.createElement('p');
    h.className = 'help';
    h.textContent = 'the obstacle tool paints walls, blocks and pillars (or erases them): cells cannot enter, matter does not cross, the water flows round (with perfusion: a pressure-driven flow threads between them); porous ones stop only cells (moire.obstacles)';
    function sync() { for (const [b, on] of btns) if (on) b.setAttribute('aria-pressed', on() ? 'true' : 'false'); }
    sync();
    r.append(m, h);
    body.append(r);
  }
  const obsText = () => {
    const O = ctx.obstacles, P = O.params;
    const size = P.shape === 'pillar' ? `${P.pillar.toFixed(1)} R in radius` : P.shape === 'block' ? '' : `${P.width.toFixed(1)} R wide`;
    return `${OBS_WORD[P.shape]}${P.shape !== 'erase' ? ` (${P.kind}${size ? `, ${size}` : ''})` : size ? ` (${size})` : ''}`;
  };
  /** The tool's flash (main.js setTool); its button again: the next shape. */
  A.obstacleTool = (again) => {
    const O = ctx.obstacles;
    if (!O) return 'obstacles are not available';
    if (again) O.params.shape = OBS_SHAPES[(OBS_SHAPES.indexOf(O.params.shape) + 1) % OBS_SHAPES.length];
    if (A.ui) A.ui.refresh();
    return `obstacles: ${obsText()} · the button again: the next shape · the Dish panel: kind, width, undo, clear`;
  };
  A.obstacleHint = () => (ctx.obstacles ? `${obsText()} · the button again: next shape` : 'drag: paint a wall');
  A.openCulture = () => openCultureDialog({ cells: ctx.cells, params: ctx.params, flash: ctx.flash, control: ctx.control, inPlace: ctx.inPlace });
  A.attach = (ui) => { A.ui = ui; };

  /** What the add-cell tool places now (the zoo's pick; else the largest group living, else a founder eater). */
  function genomeNow() {
    if (pick.genome) return { g: pick.genome, label: pick.label };
    const z = cellsZoo.peek();
    if (z && z.list.length) return { g: z.list[0].genome, label: `the largest group living (${z.list[0].text[0]})` };
    const g = founderGenome('burn');
    return { g, label: `a founder eater (${summary(g, 0)[0]})` };
  }
  /** The flash for the tool buttons (main.js setTool). */
  A.toolText = (t) => (t.addCell ? `add cells: ${genomeNow().label}; tap places one, a drag a line (pick another in the cells zoo)`
    : `pipette: ${subName(pick.sub)}; tap drops it, a drag drops more (pick another in the molecules zoo)`);

  // the pointer (dish coordinates), while one of the two tools is active
  const drag = { on: false, kind: '', x: 0, y: 0, pts: [] };
  const toolNow = () => ctx.tools[ctx.app.tool] || {};
  A.dishDown = (x, y) => {
    const t = toolNow();
    if (t.obstacle) return obsDown(x, y);
    if (!t.addCell && !t.pipette) return false;
    Object.assign(drag, { on: true, kind: t.addCell ? 'cell' : 'pip', x, y, pts: [[x, y]] });
    if (drag.kind === 'pip') drop(x, y);
    return true;
  };
  A.dishMove = (x, y) => {
    if (!drag.on) return false;
    if (drag.kind === 'obs') { obsMove(x, y); return true; }
    const R = ctx.cells.R, gap = drag.kind === 'cell' ? 2.1 * R : 3 * R;
    if (Math.hypot(x - drag.x, y - drag.y) >= gap) {
      drag.x = x; drag.y = y;
      if (drag.kind === 'cell') { if (drag.pts.length < 400) drag.pts.push([x, y]); } else drop(x, y);
    }
    return true;
  };
  A.dishUp = () => {
    if (!drag.on) return false;
    drag.on = false;
    if (drag.kind === 'obs') { obsUp(); return true; }
    if (drag.kind === 'cell' && drag.pts.length) {
      const { g, label } = genomeNow();
      place(drag.pts, g, label);
    }
    return true;
  };
  A.cancel = () => {
    if (drag.on && drag.kind === 'obs' && ctx.obstacles) { ctx.obstacles.endStroke(); ctx.obstacles.prev = null; }
    drag.on = false; drag.pts = [];
  };

  // ---------- step G0b: painting obstacles ----------
  function obsDown(x, y) {
    const O = ctx.obstacles;
    if (!O) return false;
    const P = O.params, R = ctx.cells.R;
    Object.assign(drag, { on: true, kind: 'obs', x, y, x0: x, y0: y, pts: [[x, y]] });
    if (P.shape === 'wall' || P.shape === 'erase') O.beginStroke(x, y, Math.max(0.5, P.width) * R, P.shape === 'erase' ? 'erase' : P.kind);
    else if (P.shape === 'block') O.prev = { type: 'rect', x0: x, y0: y, x1: x, y1: y };
    else O.prev = { type: 'circle', x, y, r: Math.max(0.5, P.pillar) * R };
    return true;
  }
  function obsMove(x, y) {
    const O = ctx.obstacles, P = O.params, R = ctx.cells.R;
    if (P.shape === 'wall' || P.shape === 'erase') O.extendStroke(x, y);
    else if (P.shape === 'block') { O.prev.x1 = x; O.prev.y1 = y; }
    else {
      // a row of pillars: one more every 2.6 radii along the drag
      const r = Math.max(0.5, P.pillar) * R, gap = 2.6 * r;
      const [lx, ly] = drag.pts[drag.pts.length - 1];
      if (Math.hypot(x - lx, y - ly) >= gap) {
        const a = Math.atan2(y - ly, x - lx), nx = lx + Math.cos(a) * gap, ny = ly + Math.sin(a) * gap;
        if (drag.pts.length === 1) O.circle(lx, ly, r, P.kind);
        drag.pts.push([nx, ny]);
        O.circle(nx, ny, r, P.kind);
      }
      O.prev = { type: 'circle', x, y, r };
    }
  }
  function obsUp() {
    const O = ctx.obstacles, P = O.params, R = ctx.cells.R;
    let text = '';
    if (P.shape === 'wall' || P.shape === 'erase') { O.endStroke(); text = P.shape === 'erase' ? 'erased' : `a ${P.kind} wall`; }
    else if (P.shape === 'block') {
      const b = O.prev;
      if (Math.abs(b.x1 - b.x0) > 0.5 * R && Math.abs(b.y1 - b.y0) > 0.5 * R) {
        O.rect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0), P.kind, 0.3 * R);
        text = `a ${P.kind} block`;
      } else text = 'block: drag to span it';
    } else if (drag.pts.length < 2) { O.circle(drag.x0, drag.y0, Math.max(0.5, P.pillar) * R, P.kind); text = `a ${P.kind} pillar`; }
    else text = `${drag.pts.length} ${P.kind} pillars`;
    O.prev = null;
    ctx.background.impulse(drag.x0, drag.y0, 0.8);
    if (text) ctx.flash(`${text} (undo in the Dish panel)`);
  }

  function drop(x, y) {
    const name = subName(pick.sub);
    const ok = ctx.matter.addSpring(x, y, `drop:${name}`, PIPETTE.life, { drop: true, rate: PIPETTE.rate });
    ctx.background.impulse(x, y, 1.5);
    ctx.flash(ok ? `pipette: ${name} (${(PIPETTE.life * PIPETTE.rate / subAtoms(pick.sub)).toFixed(0)} units over ${PIPETTE.life} s, booked as added)`
      : 'pipette: the dish holds as many springs as it can; wait for one to dry up');
  }

  // ---------- placing cells (one job at a time) ----------
  let job = Promise.resolve();
  function place(points, genome, label) {
    job = job.then(() => placeNow(points, genome, label)).catch((e) => { console.error('add cells:', e); ctx.flash(`could not add cells: ${e.message || e}`); });
    return job;
  }
  A.place = place;   // (moire.app.place([[x, y], ...], genome) from the console: dish coordinates)
  async function placeNow(points, genome, label = '') {
    const M = window.moire, C = ctx.cells, E = C.eat, ctl = ctx.control, d = C.device;
    if (!E.ready) throw new Error('the cells are not ready yet');
    const wasPaused = ctl.paused();
    try {
      await settle(M, ctl, true);
      const n = C.count;
      const [cellAB, stockAB, ledAB] = await Promise.all([
        readBuffer(d, C.cellBuf, 0, n * CELL_BYTES),
        readBuffer(d, E.stockBuf, 0, n * SW * 4),
        readBuffer(d, C.heat.buffer, LG_K_START * 4, 128 * 4),
      ]);
      const cu = new Uint32Array(cellAB), st = new Int32Array(stockAB), led = new Uint32Array(ledAB);
      const free = [];
      for (let i = 0; i < n && free.length < points.length; i++) {
        if (cu[i * CELL_FLOATS + 9] & 1) continue;
        if (((cu[i * CELL_FLOATS + 89] >>> 24) & 3) === 2) continue;   // (step P1: a ghost: its slot holds a meal being digested)
        let empty = true;
        for (let w = 0; w < SW; w++) if (st[i * SW + w] !== 0) { empty = false; break; }
        if (empty) free.push(i);
      }
      if (!free.length) { ctx.flash(`no room: all ${n} slots are taken (the capacity; ?cap= sets it)`); return 0; }
      const R = C.R, W = camera.W, H = camera.H, starter = Math.round(E.starterShare * E.batCounts);
      const bio = new Float32Array(BIO_FLOATS);
      for (let k = 0; k < BIO_FLOATS; k++) bio[k] = genome[k] ?? 0;
      for (let k = 20; k < 31; k++) bio[k] = 0;   // the accumulators and the step 6 state start empty (as genome.fill; step G1: 31 the fidelity gene)
      stampFounderGlue(bio);                      // step G0: a founder's own glue as its founder value (a living cell's copy keeps its own)
      const rec = new ArrayBuffer(CELL_BYTES), f = new Float32Array(rec), u = new Uint32Array(rec);
      const stock = new Int32Array(SW);
      stock[BAT_WORD] = starter;
      // step C15c: a placed cell starts with a BODY and ENZYMES as a founder of radius R does (cell_carbon.wgsl cb_found, cb_found_enz),
      // booked as carbon (and the enzymes' G atoms) in; ?cbtool=0: none (as step C15b)
      const CC = CARBON && E.carbon ? E.carbon.params : null;
      const giveBody = !!(CC && CC.on && CC.toolBody);
      const nBody = giveBody && CC.growth ? Math.round(CC.kBody * Math.PI * CC.found * 4096) : 0;
      const rr = Math.max(bio[36], 0) + Math.max(bio[37], 0) + Math.max(bio[38], 0);   // (Bio.rate.xyz)
      const nEnz = giveBody && CC.enzymes ? Math.round(CC.kEnz * rr * Math.PI * 4096 / 4 * CC.enzFound) : 0;
      // step C15d: and the PIGMENT its harvest slots want (?cbpigfound: x the want; an oil-like carbon pair + a trace atom per count, booked
      // as carbon and trace in), as a founder's (cell_carbon.wgsl cb_found_pig; here from its own genes)
      let hr = 0;
      for (let k = 0; k < 3; k++) if (Math.floor(Math.round(bio[32 + k]) / 32) > 0) hr += Math.max(bio[36 + k], 0);
      const PG = E.pigments && E.pigments.params;
      const nPig = giveBody && CB_LIP && CC.pigFound > 0 && PG && PG.matter !== false ? Math.round((PG.want || 0) * Math.PI * hr * CC.pigFound * 4096) : 0;
      if (nPig) stock[30] = nPig;   // (stock word W_PIG)
      const cbw = new Int32Array(CB_W);
      cbw[8] = cbw[9] = cbw[10] = nBody;   // (cellulose-like: per carbon one backbone bond, one fuel hand, one burnt hand)
      cbw[11] = nEnz;                      // (each unit 4 carbons as ENZ_H hands + 1 G: (4, 4, 4), step C15e (4, 0, 8))
      free.forEach((slot, j) => {
        const [x, y] = points[j];
        f.fill(0);
        const a = Math.random() * 2 * Math.PI, jr = 0.15 * R * Math.random();
        f[0] = Math.max(R, Math.min(W - R, x + Math.cos(a) * jr)); f[1] = Math.max(R, Math.min(H - R, y + Math.sin(a) * jr));
        f[4] = R; f[5] = bio[0];                     // radius; the lattice angle = the key angle (as cells.seed)
        u[8] = KIND.STEM; u[9] = 1; u[10] = (Math.random() * 4294967296) >>> 0;
        f[11] = bio[1];                              // key scale
        f[12] = 1; f[13] = 0;                        // step 8's phasor
        f[16] = E.starterShare;                      // the battery share (the starter charge, in the stock below)
        u[60] = u[61] = u[62] = 0xffffffff;          // no neighbours across the sides yet
        f[64] = u[10] / 4294967296 * 2 * Math.PI;   // the front
        bio[19] = Math.random() * 2 * Math.PI;       // its crawling heading (state)
        d.queue.writeBuffer(C.cellBuf, slot * CELL_BYTES, rec);
        for (const b of C.bioBuf) d.queue.writeBuffer(b, slot * BIO_FLOATS * 4, bio);
        d.queue.writeBuffer(E.stockBuf, slot * SW * 4, stock);
        if (nBody || nEnz) d.queue.writeBuffer(E.carbon.buf, slot * CB_W * 4, cbw);
      });
      // step C15c: the books for the bodies and enzymes (carbon in: the dish's ADD and the cells' IN per tar hand; the G atoms: matter ADD)
      if (nBody || nEnz || nPig) {
        const k = free.length;   // (a pigment count: 1 backbone bond, 6 fuel hands: step C15d; an enzyme unit ENZ_H: step C15e)
        const hc = nBody + ENZ_H[0] * nEnz + nPig, hg = nBody + ENZ_H[1] * nEnz + 6 * nPig, ht = nBody + ENZ_H[2] * nEnz;
        const words = [[LG_CB + 128 * 5, hc], [LG_CB + 128 * 6, hg], [LG_CB + 128 * 7, ht],
          [LG_CBC.IN + 128 * 5, hc], [LG_CBC.IN + 128 * 6, hg], [LG_CBC.IN + 128 * 7, ht], [lgM('ADD', CH.G), nEnz],
          [lgM('ADD', CH.trace), nPig]];
        for (const [w, x] of words) {
          if (!x) continue;
          const [lo, hi] = await Promise.all([readBuffer(d, C.heat.buffer, w * 4, 4), readBuffer(d, C.heat.buffer, (w + 64) * 4, 4)]);
          const a = new Uint32Array(lo)[0], b = new Uint32Array(hi)[0], sum = a + x * k;
          d.queue.writeBuffer(C.heat.buffer, w * 4, new Uint32Array([sum >>> 0]));
          d.queue.writeBuffer(C.heat.buffer, (w + 64) * 4, new Uint32Array([(b + Math.floor(sum / 4294967296)) >>> 0]));
        }
      }
      // the books: the starter charges came in (as at a new culture: eat.start, "in"), into the first slot's 64-bit counter
      const add = free.length * starter, lo = led[0], sum = lo + add;
      const out = new Uint32Array([sum >>> 0]), carry = new Uint32Array([(led[64] + Math.floor(sum / 4294967296)) >>> 0]);
      d.queue.writeBuffer(C.heat.buffer, LG_K_START * 4, out);
      d.queue.writeBuffer(C.heat.buffer, (LG_K_START + 64) * 4, carry);
      flushLedger(M, ctl.time());
      await d.queue.onSubmittedWorkDone();
      await frames(2);
      C.alive += free.length;   // (until the census reads it back)
      for (const [x, y] of points.slice(0, free.length)) ctx.background.impulse(x, y, 1.2);
      ctx.flash(`added ${free.length} cell${free.length > 1 ? 's' : ''}${free.length < points.length ? ` (only ${free.length} free slots)` : ''}${label ? `: ${label}` : ''}; each starts with an empty stock and the starter charge${nBody ? ', a body and enzymes of carbon' : ''} (booked in)`);
      return free.length;
    } finally {
      ctl.setPaused(wasPaused);
    }
  }
  return A;
}
