// Boot, frame loop, input and the F overlay.
//
// Frame loop: the simulation runs in fixed ticks of 1/60 s (at most MAX_TICKS per frame, so a slow frame
// slows the simulation instead of exploding it). Each frame:
//   1. every layer's compute(encoder, frame) records its compute passes (in layer order),
//   2. one render pass to the canvas; every layer's render(pass, frame) draws into it (in layer order),
//   3. submit.
// To add a step (landscape, cells, ...), write a class with resize / compute / render and push it into `layers`.
//
// URL parameters (handy for headless screenshots, see tools/shot.py):
//   ?overlay=1  show the frame-time / adapter overlay from the start (overlay=ghost: kept up to date but
//               invisible, so tools/shot.py can print it without it covering the picture)
//   ?ripple=1   drop a ripple every 0.7 s at varying spots
//   ?debug=1    copy console warnings and errors into the overlay
//   ?nogpu=1    pretend WebGPU is missing (to see the fallback message)
//   ?cells=N    number of cells (default 2000)
//   ?check=1    compare the cells' neighbour grid with brute force every 2 s (console)
//   ?seed=N     seed of the random start (cells, genomes); default random
//   ?speed=N    simulation speed: 1, 2, 4 or 8 ticks of 1/60 s per 1/60 s of real time (keys [ and ])
//   ?founders=N founder genomes at the start (0 = every cell its own)
//   ?view=1     colour by lineage from the start (key V)
//   ?bio=0      start with the biology rules off (D H B T M E): the loop alone

import { initGPU, GPUUnavailable, showNoWebGPU, showError, adapterName, messageIsShown } from './gpu.js';
import { Background } from './background.js';
import { Medium, KIND } from './field.js';
import { Landscape } from './landscape.js';
import { Cells, DEFAULT_CELLS, ANCHORS } from './cells.js';

window.__moireBooted = true;

const TICK = 1 / 60;
const MAX_TICKS = 4;
const BG = { r: 4 / 255, g: 6 / 255, b: 10 / 255, a: 1 };   // --bg #04060a

const params = new URLSearchParams(location.search);
const flag = (name) => params.has(name) && params.get(name) !== '0';

const SPEEDS = [1, 2, 4, 8];
let speed = Math.max(1, Math.min(8, Number(params.get('speed')) || 1));
const SEED = params.has('seed') ? (Number(params.get('seed')) >>> 0) : ((Math.random() * 4294967296) >>> 0);

const canvas = document.getElementById('gpu');
const overlayEl = document.getElementById('overlay');
const hintEl = document.getElementById('hint');

const debugLog = [];
if (flag('debug')) {
  for (const level of ['warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { debugLog.push(`${level}: ${args.join(' ')}`); if (debugLog.length > 8) debugLog.shift(); orig(...args); };
  }
  window.addEventListener('error', (e) => debugLog.push(`error: ${e.message}`));
}
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  showError('Something went wrong', (r && (r.stack || r.message)) || String(r));
});

let gpu = null;
let layers = [];
let background = null;
let medium = null;
let landscape = null;
let cells = null;
let running = false;
let view = null;

// boot progress on <body data-stage>; tools/shot.py waits for "running-10-frames"
const stage = (s) => { document.body.dataset.stage = s; };

async function boot() {
  stage('init-gpu');
  try {
    gpu = await initGPU(canvas, {
      forceFail: flag('nogpu'),
      onLost: (info) => {
        running = false;
        showError('The graphics device was lost',
          `${info.reason || 'unknown reason'}: ${info.message || ''}\n` +
          'This can happen after a driver update, sleep, or when the GPU was busy for too long. Reloading usually fixes it.');
      },
    });
  } catch (e) {
    if (e instanceof GPUUnavailable) showNoWebGPU(e.message);
    else showError('Could not start WebGPU', e.stack || e.message || String(e));
    return;
  }

  gpu.device.addEventListener('uncapturederror', (ev) => {
    running = false;
    showError('GPU error', `${ev.error.constructor.name}: ${ev.error.message}`);
  });

  stage('create-layers');
  try {
    background = await Background.create(gpu.device, gpu.format);
    medium = new Medium(gpu.device);
    landscape = await Landscape.create(gpu.device, gpu.format, medium);
    cells = await Cells.create(gpu.device, gpu.format, medium, Number(params.get('cells')) || DEFAULT_CELLS, SEED);
    cells.landscape = landscape;
    landscape.cells = cells;
    if (params.has('founders')) cells.genome.params.founders = Number(params.get('founders')) || 0;
    if (flag('view')) cells.look.view = 1;
    if (flag('check')) cells.enableCheck();
    if (params.get('bio') === '0') {
      // the loop alone: no fates, adhesion, body traits, turnover, mutation or nutrient/threat biology
      Object.assign(cells.genome.rules, { diff: false, adh: false, body: false, turn: false, mut: false, nut: false });
    }
  } catch (e) {
    showError(e.shaderError ? 'Shader did not compile' : 'Could not set up the GPU passes', e.message || String(e));
    return;
  }
  // the medium first: it writes the lattice every field-reading layer uses
  layers = [medium, background, landscape, cells];
  // handle for tuning from the console or tools/shot.py --eval, e.g. moire.background.params.viscosity = 0.03
  window.moire = { gpu, layers, background, medium, landscape, cells, genome: cells.genome };
  window.moire.time = () => simTime;   // simulation time (s), for tools/shot.py --at
  // births and deaths drop small ripples into the background (a birth a bump, a death a dip)
  cells.onEvents = (events) => {
    const amp = cells.genome.params.ripple;
    if (!(amp > 0)) return;
    for (const [x, y, sign] of events) background.impulse(x, y, sign > 0 ? amp : -0.7 * amp);
  };

  resize();
  landscape.seed();
  for (const s of landscape.sources) background.impulse(s.x, s.y, 3);
  window.addEventListener('resize', resize);
  setupInput();
  if (flag('overlay')) overlayEl.hidden = false;
  if (params.get('overlay') === 'ghost') overlayEl.style.opacity = '0';   // kept up to date but invisible (for tools/shot.py)
  running = true;
  stage('running');
  requestAnimationFrame(frame);
}

// ---------- size ----------
function resize() {
  const cssW = Math.max(1, canvas.clientWidth), cssH = Math.max(1, canvas.clientHeight);
  const maxDim = gpu.device.limits.maxTextureDimension2D;
  const dpr = Math.min(2, window.devicePixelRatio || 1, maxDim / cssW, maxDim / cssH);
  const pxW = Math.max(1, Math.round(cssW * dpr)), pxH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  view = { cssW, cssH, dpr, pxW, pxH };
  for (const l of layers) l.resize(view);
}

// ---------- loop ----------
const stats = { frameMs: 16.7, cpuMs: 0, gpuMs: 0, lastOverlay: 0, lastProbe: 0 };
let last = 0, acc = 0, simTime = 0, frameNo = 0, nextAutoRipple = 0.3, autoK = 0;

function frame(now) {
  if (!running) return;
  const dtReal = last ? Math.min(0.25, (now - last) / 1000) : TICK;
  last = now;
  stats.frameMs += (dtReal * 1000 - stats.frameMs) * 0.05;

  acc += dtReal * speed;
  let ticks = Math.floor(acc / TICK);
  if (ticks > MAX_TICKS * speed) { ticks = MAX_TICKS * speed; acc = 0; } else acc -= ticks * TICK;
  simTime += ticks * TICK;

  if (flag('ripple') && simTime >= nextAutoRipple) autoRipple();

  const t0 = performance.now();
  const f = { dt: ticks * TICK, tickDt: TICK, ticks, time: simTime, frameNo };
  const device = gpu.device;
  const encoder = device.createCommandEncoder({ label: `frame ${frameNo}` });
  for (const l of layers) l.compute(encoder, f);
  const pass = encoder.beginRenderPass({
    label: 'screen',
    colorAttachments: [{
      view: gpu.context.getCurrentTexture().createView(),
      clearValue: BG, loadOp: 'clear', storeOp: 'store',
    }],
  });
  for (const l of layers) l.render(pass, f);
  pass.end();
  device.queue.submit([encoder.finish()]);
  stats.cpuMs += (performance.now() - t0 - stats.cpuMs) * 0.05;

  // rough GPU latency: time from submit until the queue reports the work done (every 15th frame)
  if (frameNo % 15 === 0) {
    const ts = performance.now();
    device.queue.onSubmittedWorkDone().then(() => { stats.gpuMs += (performance.now() - ts - stats.gpuMs) * 0.3; });
  }

  if (frameNo === 10) stage('running-10-frames');
  if (!overlayEl.hidden && now - stats.lastOverlay > 250) { stats.lastOverlay = now; drawOverlay(); }
  if (!overlayEl.hidden && now - stats.lastProbe > 1000) { stats.lastProbe = now; cells.probe(); }
  frameNo++;
  requestAnimationFrame(frame);
}

function autoRipple() {
  // deterministic spots spread over the screen (golden-ratio sequence)
  autoK++;
  const x = ((autoK * 0.618034 + 0.2) % 1) * view.cssW;
  const y = ((autoK * 0.754878 + 0.35) % 1) * view.cssH;
  background.impulse(x, y, 2.0);
  nextAutoRipple = simTime + 0.7;
}

function drawOverlay() {
  const i = gpu.info;
  const lines = [
    `<b>${(stats.frameMs).toFixed(1)} ms</b> per frame  (${(1000 / stats.frameMs).toFixed(0)} fps)`,
    `cpu encode ${stats.cpuMs.toFixed(2)} ms · gpu done after ~${stats.gpuMs.toFixed(1)} ms`,
    `adapter  <b>${esc(adapterName(i))}</b>${i.isFallbackAdapter ? '  (software fallback)' : ''}`,
    `vendor ${esc(i.vendor || '?')} · arch ${esc(i.architecture || '?')}${i.device ? ' · device ' + esc(i.device) : ''}`,
    `canvas ${view.pxW}×${view.pxH} (dpr ${view.dpr.toFixed(2)}) · ${gpu.format}`,
    `ripple grid ${background.gw}×${background.gh} (${background.sc} css px/cell) · ambient ${background.ambient ? 'on' : 'off'}`,
    `tap ${TAP_MODES[tapMode].name} · sources ${landscape.sources.length}/${landscape.params.maxSources} · landscape ${landscape.params.on ? 'on' : 'off'} · R ${medium.R.toFixed(2)} px · medium ${(medium.la0 * 180 / Math.PI).toFixed(2)}°`,
    ...cells.overlayLines(),
    `sim t ${simTime.toFixed(1)} s · speed ${speed}× · seed ${SEED}`,
  ];
  if (debugLog.length) lines.push('', ...debugLog.map(esc));
  overlayEl.innerHTML = lines.join('\n');
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- input ----------
// what a click drops (keys 1, 2, 3)
const TAP_MODES = [
  { name: 'ripple', label: 'drop a ripple' },
  { name: 'nutrient', label: 'drop a nutrient source', kind: KIND.NUT },
  { name: 'threat', label: 'drop a threat source', kind: KIND.THR },
];
let tapMode = 0;

function hintLine() {
  return `click: ${TAP_MODES[tapMode].label} · drag: stir · 1 ripple · 2 nutrient · 3 threat · ` +
    'C: clear · L: landscape · K: cell field · J: field B · Q: feel B · U: B like repels/attracts · Y: B like by charge/lineage · O: emit · S: sense · W: shape · X: beat anchor · R: receptor · - =: lever · A: ambient · N / G: new culture / new genomes · P: push · D: fates · H: adhesion · B: body · T: turnover · M: mutation · E: nutrient/threat · I: inherit fate · V: view · [ ]: speed · F: stats';
}

function tap(x, y) {
  const m = TAP_MODES[tapMode];
  if (m.kind === undefined) background.impulse(x, y, 2.5, 1.2 * background.sc);
  else { landscape.addSource(x, y, m.kind); background.impulse(x, y, 3); }   // as the reference: a source lands with a ripple
}

function setupInput() {
  hintEl.textContent = hintLine();
  const pointer = { down: false, drag: false, x: 0, y: 0, sx: 0, sy: 0 };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    Object.assign(pointer, { down: true, drag: false, x, y, sx: x, sy: y });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointer.down) return;
    const [x, y] = pos(e);
    if (!pointer.drag && Math.hypot(x - pointer.sx, y - pointer.sy) > 6) pointer.drag = true;
    if (pointer.drag) {
      // stir: small bumps along the path, spaced about one grid cell apart
      const dist = Math.hypot(x - pointer.x, y - pointer.y);
      const n = Math.min(8, Math.max(1, Math.round(dist / background.sc)));
      for (let k = 1; k <= n; k++) {
        background.impulse(pointer.x + (x - pointer.x) * k / n, pointer.y + (y - pointer.y) * k / n, 1.2 / Math.sqrt(n));
      }
      cells.stir(x, y, x - pointer.x, y - pointer.y);   // cells near the pointer are pushed along
    }
    pointer.x = x; pointer.y = y;
  });
  const up = () => {
    if (pointer.down && !pointer.drag) tap(pointer.x, pointer.y);
    pointer.down = pointer.drag = false;
    cells.release();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { pointer.down = pointer.drag = false; cells.release(); });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      overlayEl.hidden = !overlayEl.hidden;
      if (!overlayEl.hidden) drawOverlay();
    } else if (k === 'a') {
      background.ambient = !background.ambient;
      flash(`ambient ripples ${background.ambient ? 'on' : 'off'}`);
    } else if (k === '1' || k === '2' || k === '3') {
      tapMode = Number(k) - 1;
      flash(`click drops: ${TAP_MODES[tapMode].name}`);
    } else if (k === 'c') {
      landscape.clear();
      flash('sources cleared');
    } else if (k === 'n' || k === 'g') {
      cells.seed(k === 'g');
      background.impulse(view.cssW / 2, view.cssH / 2, 2);   // as the reference's seed()
      flash(k === 'g' ? 'new culture, fresh random genomes' : 'new culture, same founder genomes');
    } else if (k === 'd') {
      const r = cells.genome.rules;
      r.diff = !r.diff;
      flash(r.diff ? 'differentiation on: cells read their contacts and choose fates' : 'differentiation off: every cell back to stem');
    } else if (k === 'h') {
      const r = cells.genome.rules;
      r.adh = !r.adh;
      flash(`adhesion ${r.adh ? 'on: like sticks to like (similar keys, same fate)' : 'off'}`);
    } else if (k === 'b') {
      const r = cells.genome.rules;
      r.body = !r.body;
      flash(`body traits ${r.body ? 'on: size and motility from the genome and the fate' : 'off: all cells alike'}`);
    } else if (k === 't') {
      const r = cells.genome.rules;
      r.turn = !r.turn;
      flash(`turnover ${r.turn ? 'on: cells die now and then, a neighbour divides into the gap' : 'off'}`);
    } else if (k === 'm') {
      const r = cells.genome.rules;
      r.mut = !r.mut;
      flash(`mutation ${r.mut ? 'on: daughters differ a little from their parent' : 'off: daughters are exact copies'}`);
    } else if (k === 'e') {
      const r = cells.genome.rules;
      r.nut = !r.nut;
      flash(`nutrient and threat ${r.nut ? 'on: cells in nutrient divide more, threat kills' : 'off: the cells ignore the sources'}`);
    } else if (k === 'i') {
      const r = cells.genome.rules;
      r.inherit = !r.inherit;
      flash(r.inherit ? "daughters inherit their parent's fate" : 'daughters start as stem cells');
    } else if (k === 'v') {
      cells.look.view = cells.look.view ? 0 : 1;
      flash(`colour by ${cells.look.view ? 'lineage (key)' : 'fate'}`);
    } else if (k === '[' || k === ']') {
      const i = SPEEDS.indexOf(speed);
      speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + (k === ']' ? 1 : -1)))];
      flash(`speed ${speed}×`);
    } else if (k === 'p') {
      cells.params.contact = !cells.params.contact;
      flash(`contact push ${cells.params.contact ? 'on' : 'off'}`);
    } else if (k === 's') {
      cells.params.senseOn = !cells.params.senseOn;
      flash(`field sensing ${cells.params.senseOn ? 'on: cells move along the field they feel on their membrane' : 'off'}`);
    } else if (k === '-' || k === '=' || k === '+') {
      const p = cells.params;
      p.lever = Math.max(0.05, Math.min(3, Math.round(p.lever * (k === '-' ? 0.8 : 1.25) * 1000) / 1000));
      flash(`lever ${p.lever.toFixed(2)}: the cells' lattices ${p.lever < 1 ? 'closer to' : 'further from'} the medium's (1 = as the genome has it)`);
    } else if (k === 'x') {
      const p = cells.params;
      p.anchor = (p.anchor + 1) % 3;
      flash(`cells' beat: ${ANCHORS[p.anchor]}`);
    } else if (k === 'r') {
      const p = cells.params;
      p.receptor = !p.receptor;
      flash(`cells feel other cells ${p.receptor ? 'through their genome’s receptor' : 'by likeness to their own lattice'}`);
    } else if (k === 'w') {
      cells.params.active = !cells.params.active;
      flash(`active deformation ${cells.params.active ? 'on: cells stretch along their motion and the pull of the field' : 'off: only contact squeezes them'}`);
    } else if (k === 'o') {
      cells.params.emit = !cells.params.emit;
      flash(`cells emit ${cells.params.emit ? 'on: every cell adds its own beat to the field' : 'off'}`);
    } else if (k === 'k') {
      landscape.params.cellField = !landscape.params.cellField;
      flash(`cells' field ${landscape.params.cellField ? 'drawn (pale dots)' : 'not drawn'}`);
    } else if (k === 'j') {
      landscape.params.fieldB = !landscape.params.fieldB;
      flash(`field B ${landscape.params.fieldB ? 'drawn (blue dots; open rings where it is negative)' : 'not drawn'}`);
    } else if (k === 'q') {
      const F = cells.fields;
      F.on = !F.on;
      flash(`field B ${F.on ? 'felt: cells move along it by the sign rule' : 'not felt (still emitted and drawn)'}`);
    } else if (k === 'u') {
      const F = cells.fields;
      F.sign = -F.sign;
      flash(`field B: like ${F.sign > 0 ? 'repels' : 'attracts'} like`);
    } else if (k === 'y') {
      const F = cells.fields;
      F.like = F.like ? 0 : 1;
      flash(`field B: "like" means ${F.like ? 'a similar key (the same lineage)' : 'the same sign of charge (charges by fate)'}`);
    } else if (k === 'l') {
      landscape.params.on = !landscape.params.on;
      flash(`landscape ${landscape.params.on ? 'on' : 'off'}`);
    }
  });
}

let flashTimer = 0;
function flash(text) {
  hintEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hintEl.textContent = hintLine(); }, 1600);
}

boot().catch((e) => { if (!messageIsShown()) showError('Could not start', e.stack || e.message || String(e)); });
