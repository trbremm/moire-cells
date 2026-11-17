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
//   zoos             two toolbar panels, molecules and cells (src/zoo.js)
//   add cells        a tool (the cell icon): a tap places one cell, a drag a line of them, each a copy of the genome picked in
//                    the cells zoo (a lineage living now, or a founder habit). BOOKS: a placed cell starts as a new culture's
//                    founder does, with an EMPTY stock (no atoms: the atoms ledger is untouched) and the starter charge in its
//                    battery, booked as "starter charges in" (energy in, as at a new culture). It goes into a free slot (dead,
//                    its stock already handed back); with no free slot (the capacity is full) nothing is placed. The placing
//                    pauses for a moment (settle, as the genome edits of src/lab.js), so no division can take the slot meanwhile.
//   pipette          a tool (the dropper): a tap drops a short spring of the substance picked in the molecules zoo (1.5 s, 40
//                    atoms per s), booked as added like every spring; a drag drops more. Drops never push a real spring out.
//
// createApp(ctx) is called by main.js before the toolbar is built (it hands the toolbar its extra panels), attach(ui) after.

import { camera, MAX_ZOOM } from './camera.js';
import { moleculePanel, cellPanel, summary } from './zoo.js';
import { SUBSTANCES, CH } from './matter.js';
import { CELL_FLOATS, CELL_BYTES } from './cells.js';
import { BIO_FLOATS, founderGenome } from './genome.js';
import { SW } from './eat.js';
import { KIND } from './field.js';
import { settle, flushLedger, readBuffer, frames } from './snapshot.js';
import { openCultureDialog, PRESETS } from './culture.js';

const BAT_WORD = 13;          // cell_eat.wgsl: the battery's stock word
const LG_K_START = 13312;     // heat_common.wgsl: the starter charges' ledger slots (64-bit: low words, then the carries + 64)
const PIPETTE = { life: 1.5, rate: 40 };
export const TOOL_ICONS = {
  cell: '<path d="M8.5 3.5l4.6 2.65v5.3L8.5 14.1l-4.6-2.65v-5.3z"/><circle cx="8.5" cy="8.8" r="1.3" fill="currentColor" stroke="none"/><path d="M15.5 12.5v5M13 15h5"/>',
  pipette: '<path d="M13.2 2.8l4 4-2 2-4-4z"/><path d="M12.2 7.8l-7 7-1.2 3.2 3.2-1.2 7-7"/><circle cx="4.2" cy="17.4" r="0.9" fill="currentColor" stroke="none"/>',
};

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
  const centre = () => [camera.W / 2 * 1, camera.H / 2 * 1];   // the screen's centre (CSS px)
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
    const pxPerUm = camera.z * R / UM_PER_R;   // screen CSS px per micrometre
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

  // ---------- the zoos and the add tools ----------
  const pick = { genome: null, label: '', sub: CH.gT ?? 0 };   // what the add-cell tool places, what the pipette drops
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
    ctx.flash(`pipette: ${SUBSTANCES[c].name}. Tap or drag on the dish to drop it (booked as added)`);
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
  };
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
    : `pipette: ${SUBSTANCES[pick.sub].name}; tap drops it, a drag drops more (pick another in the molecules zoo)`);

  // the pointer (dish coordinates), while one of the two tools is active
  const drag = { on: false, kind: '', x: 0, y: 0, pts: [] };
  const toolNow = () => ctx.tools[ctx.app.tool] || {};
  A.dishDown = (x, y) => {
    const t = toolNow();
    if (!t.addCell && !t.pipette) return false;
    Object.assign(drag, { on: true, kind: t.addCell ? 'cell' : 'pip', x, y, pts: [[x, y]] });
    if (drag.kind === 'pip') drop(x, y);
    return true;
  };
  A.dishMove = (x, y) => {
    if (!drag.on) return false;
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
    if (drag.kind === 'cell' && drag.pts.length) {
      const { g, label } = genomeNow();
      place(drag.pts, g, label);
    }
    return true;
  };
  A.cancel = () => { drag.on = false; drag.pts = []; };

  function drop(x, y) {
    const s = SUBSTANCES[pick.sub];
    const ok = ctx.matter.addSpring(x, y, `drop:${s.name}`, PIPETTE.life, { drop: true, rate: PIPETTE.rate });
    ctx.background.impulse(x, y, 1.5);
    ctx.flash(ok ? `pipette: ${s.name} (${(PIPETTE.life * PIPETTE.rate / s.atoms.length).toFixed(0)} units over ${PIPETTE.life} s, booked as added)`
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
      for (let k = 20; k < 32; k++) bio[k] = 0;   // the accumulators and the step 6 state start empty (as genome.fill)
      const rec = new ArrayBuffer(CELL_BYTES), f = new Float32Array(rec), u = new Uint32Array(rec);
      const stock = new Int32Array(SW);
      stock[BAT_WORD] = starter;
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
      });
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
      ctx.flash(`added ${free.length} cell${free.length > 1 ? 's' : ''}${free.length < points.length ? ` (only ${free.length} free slots)` : ''}${label ? `: ${label}` : ''}; each starts with an empty stock and the starter charge (booked as energy in)`);
      return free.length;
    } finally {
      ctl.setPaused(wasPaused);
    }
  }
  return A;
}
