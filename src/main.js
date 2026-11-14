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
//   ?bio=0      start with the biology rules off (D H B T M): the loop alone
//   ?excl=0|1   step 7 exclusion off / on from the start (key 8); ?states=2..4 its number of states;
//               ?flip=0|1 its state flip (key 9)
//   ?partner=0|1 step 8, rule a: the partner A' felt as a phase current (key Z); ?change=0|1 rule b (key ,);
//               ?clock=0|1 its mode (key '); ?side=0|1 rule c, sideways push (key .)
//   ?heat=0     step C1: start with the kicks from heat off (the old constant jitter; Shift+H)
//   ?entropy=0  step C1: start with the entropy panel hidden (Shift+E)
//   ?simmer=0   step C1: start with the ripples not driven by heat (Shift+R)
//   ?light=spot|full|off   step C2: the light's mode (Shift+L); ?spot=x,y,r the spot's centre and radius (shares of the
//               dish's width, height and shorter side, or CSS px if any is above 2); ?tilt=deg (0..70); ?az=deg (the
//               direction the light comes from: 0 right, 90 below, 180 left, 270 above); ?day=0 no day / night cycle
//               (Shift+D); ?hour=h the hour of the day at the start (12 = noon); ?clouds=0 no clouds (full field)
//
// Part C keys are Shift + a letter (every plain letter is taken by Parts A and B): checked before the plain keys,
// so Shift+H never also toggles H.
//   ?show=summary|off|<substance>   step C3: what the substances' halftone shows (Shift+S), e.g. ?show=G
//
// Mouse: left tap drops (keys 1 2 3: a ripple, a light spring, a heavy spring), left drag stirs; step C2's spotlight: right-drag moves it, the wheel tilts it,
// Shift+wheel turns the direction the light comes from.

import { initGPU, GPUUnavailable, showNoWebGPU, showError, adapterName, messageIsShown } from './gpu.js';
import { Background } from './background.js';
import { Medium } from './field.js';
import { Landscape } from './landscape.js';
import { Cells, DEFAULT_CELLS, ANCHORS } from './cells.js';
import { Light } from './light.js';
import { Matter, SHOWS } from './matter.js';

window.__moireBooted = true;

const SQUEEZE_SOFT = 0.25, SQUEEZE_HARD = 1.2;   // key \ : cells.params.squeeze, normal or pressed together

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
const entropyEl = document.getElementById('entropy');

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
let light = null;
let matter = null;
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
    light = await Light.create(gpu.device, gpu.format);
    matter = await Matter.create(gpu.device, gpu.format, medium);
    cells = await Cells.create(gpu.device, gpu.format, medium, Number(params.get('cells')) || DEFAULT_CELLS, SEED);
    cells.heat.setLight(light);   // step C2: the heat passes absorb the light
    light.heat = cells.heat;
    matter.attach(cells.heat);   // step C3: the substances live in the heat buffer, on its grid
    cells.matter = matter;
    matter.landscape = landscape;
    lightOptions(light);
    cells.landscape = landscape;
    landscape.cells = cells;
    if (params.has('founders')) cells.genome.params.founders = Number(params.get('founders')) || 0;
    if (flag('view')) cells.look.view = 1;
    if (flag('check')) cells.enableCheck();
    if (params.get('bio') === '0') {
      // the loop alone: no fates, adhesion, body traits, turnover or mutation
      Object.assign(cells.genome.rules, { diff: false, adh: false, body: false, turn: false, mut: false });
      cells.fields.sign = 1;   // like repels like: islands and a labyrinth of strands (key U flips)
      cells.excl.on = true;    // step 7 exclusion: pinwheel rosettes (key 8; the user chose it as this view's default)
    }
    if (params.has('excl')) cells.excl.on = flag('excl');
    if (params.has('squeeze')) cells.params.squeeze = flag('squeeze') ? SQUEEZE_HARD : SQUEEZE_SOFT;
    if (params.has('flip')) cells.excl.flip = flag('flip');
    if (params.has('partner')) cells.partner.on = flag('partner');
    if (params.has('change')) cells.partner.change = flag('change');
    if (params.has('side')) cells.partner.side = flag('side');
    if (params.has('clock')) cells.partner.chMode = flag('clock') ? 1 : 0;
    if (params.has('states')) cells.excl.states = Math.max(2, Math.min(4, Number(params.get('states')) || 2));
    if (params.has('heat')) cells.heat.params.kicks = flag('heat');
    if (params.has('simmer')) background.heatOn = flag('simmer');
    if (params.has('show')) { const i = SHOWS.indexOf(params.get('show')); if (i >= 0) matter.params.show = i; }
    background.heat = cells.heat;
  } catch (e) {
    showError(e.shaderError ? 'Shader did not compile' : 'Could not set up the GPU passes', e.message || String(e));
    return;
  }
  // the medium first: it writes the lattice every field-reading layer uses; the light before the cells (its uniform is
  // read by the heat passes the cells run), and its tint is drawn under them (its outline over them: renderTop)
  layers = [medium, background, landscape, matter, light, cells];
  // handle for tuning from the console or tools/shot.py --eval, e.g. moire.background.params.viscosity = 0.03
  window.moire = { gpu, layers, background, medium, landscape, cells, genome: cells.genome, heat: cells.heat, light, matter };
  window.moire.time = () => simTime;   // simulation time (s), for tools/shot.py --at
  // births and deaths drop small ripples into the background (a birth a bump, a death a dip)
  cells.onEvents = (events) => {
    const amp = cells.genome.params.ripple;
    if (!(amp > 0)) return;
    for (const [x, y, sign] of events) background.impulse(x, y, sign > 0 ? amp : -0.7 * amp);
  };

  resize();
  window.addEventListener('resize', resize);
  setupInput();
  if (flag('overlay')) overlayEl.hidden = false;
  showEntropy(!params.has('entropy') || flag('entropy'));
  if (params.get('overlay') === 'ghost') overlayEl.style.opacity = '0';   // kept up to date but invisible (for tools/shot.py)
  running = true;
  stage('running');
  requestAnimationFrame(frame);
}

/** Step C2: the light's URL options (see the top of this file). */
function lightOptions(L) {
  const P = L.params;
  const m = params.get('light');
  if (m === 'spot' || m === 'full' || m === 'off') P.mode = m;
  if (params.has('spot')) {
    const v = params.get('spot').split(',').map(Number);
    const px = v.some((x) => x > 2);   // CSS px instead of shares; resolved once the dish's size is known
    if (px) L.pendingSpotPx = v;
    else {
      if (Number.isFinite(v[0])) P.x = v[0];
      if (Number.isFinite(v[1])) P.y = v[1];
      if (Number.isFinite(v[2]) && v[2] > 0) P.radius = v[2];
    }
  }
  if (params.has('tilt')) P.tilt = Math.max(0, Math.min(P.maxTilt, Number(params.get('tilt')) || 0));
  if (params.has('az')) L.turnBy((Number(params.get('az')) || 0) - P.az);
  if (params.has('day')) P.day = flag('day');
  if (params.has('hour')) P.dayStart = (((Number(params.get('hour')) || 0) / 24) % 1 + 1) % 1;
  if (params.has('clouds')) P.clouds = flag('clouds');
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
  if (light && light.pendingSpotPx) {
    const [x, y, r] = light.pendingSpotPx;
    light.pendingSpotPx = null;
    if (Number.isFinite(x) && Number.isFinite(y)) light.moveTo(x, y);
    if (Number.isFinite(r) && r > 0) light.params.radius = r / Math.min(cssW, cssH);
  }
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
  for (const l of layers) if (l.renderTop) l.renderTop(pass, f);
  pass.end();
  device.queue.submit([encoder.finish()]);
  stats.cpuMs += (performance.now() - t0 - stats.cpuMs) * 0.05;

  // rough GPU latency: time from submit until the queue reports the work done (every 15th frame)
  if (frameNo % 15 === 0) {
    const ts = performance.now();
    device.queue.onSubmittedWorkDone().then(() => { stats.gpuMs += (performance.now() - ts - stats.gpuMs) * 0.3; });
  }

  if (!entropyEl.hidden) {
    const t = `${cells.heat.panelText()}\n${matter.panelLine()}`;
    if (t !== entropyEl.textContent) entropyEl.textContent = t;
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
    `tap ${TAP_MODES[tapMode].name} · landscape ${landscape.params.on ? 'on' : 'off'} · R ${medium.R.toFixed(2)} px · medium ${(medium.la0 * 180 / Math.PI).toFixed(2)}°`,
    ...cells.overlayLines(),
    ...matter.overlayLines(),
    `simmer (Shift+R) ${background.heatOn ? 'on' : 'off'}: ripple drops ${background.params.heatDrops} per cell per step x temperature², height ${background.params.heatAmp}`,
    `sim t ${simTime.toFixed(1)} s · speed ${speed}× · seed ${SEED}`,
  ];
  if (debugLog.length) lines.push('', ...debugLog.map(esc));
  overlayEl.innerHTML = lines.join('\n');
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- input ----------
// what a click drops (keys 1, 2, 3; step C3: springs of atoms replace the old nutrient and threat sources)
const TAP_MODES = [
  { name: 'ripple', label: 'drop a ripple' },
  { name: 'light spring', label: 'drop a light spring', spring: 'light' },
  { name: 'heavy spring', label: 'drop a heavy spring', spring: 'heavy' },
];
let tapMode = 0;

let allKeys = false;   // key ?: the short hint or the full key list
function hintLine() {
  const short = `click: ${TAP_MODES[tapMode].label} · drag: stir · 1 ripple · 2 light spring · 3 heavy spring · ` +
    'N / G: new culture · [ ]: speed · F: stats · ⇧E ⇧L ⇧S: entropy, light, substances · ?: more';
  return allKeys ? fullHint() : short;
}
function fullHint() {
  return `click: ${TAP_MODES[tapMode].label} · drag: stir · 1 ripple · 2 light spring · 3 heavy spring · ` +
    'C: clear springs · L: landscape · K: cell field · J: field B · Q: feel B · U: B like repels/attracts · Y: B like by charge/lineage · 4: leak A→B by stretch · 5: conversion A→B · 6: conversion boost/flip · 7: relay through B · 8: exclusion · 9: state flip · 0: 2/3/4 states · \\: squeeze · Z: partner A′ (phase current) · ,: change makes partner · ’ (apostrophe): felt change / clock · .: sideways push · ;: partner drawn · O: emit · S: sense · W: shape · X: beat anchor · R: receptor · - =: lever · A: ambient · N / G: new culture / new genomes · P: push · D: fates · H: adhesion · B: body · T: turnover · M: mutation · I: inherit fate · V: view · [ ]: speed · F: stats · Shift+H: jitter from heat / constant · Shift+E: entropy panel · Shift+R: ripples simmer with heat · Shift+L: light spot / full field / off · Shift+D: day and night · Shift+S: substances shown (summary / each alone / off) · Shift+C: wash the atoms out · right-drag: move the spot · wheel: tilt it · Shift+wheel: turn where the light comes from';
}

function tap(x, y) {
  const m = TAP_MODES[tapMode];
  if (!m.spring) { background.impulse(x, y, 2.5, 1.2 * background.sc); return; }
  matter.addSpring(x, y, m.spring);
  background.impulse(x, y, 3);   // a spring lands with a ripple, as the old sources did
}

function setupInput() {
  hintEl.textContent = hintLine();
  const pointer = { down: false, drag: false, light: false, x: 0, y: 0, sx: 0, sy: 0 };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    const [x, y] = pos(e);
    if (e.button === 2) {
      // step C2: right button moves the spotlight (the spot's centre follows the pointer)
      if (light.modeIndex !== 1) { flash('the spotlight is off: Shift+L until it says "spotlight"'); return; }
      Object.assign(pointer, { down: false, drag: false, light: true });
      light.moveTo(x, y);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button !== 0) return;
    Object.assign(pointer, { down: true, drag: false, light: false, x, y, sx: x, sy: y });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (pointer.light) { const [x, y] = pos(e); light.moveTo(x, y); return; }
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
  const up = (e) => {
    if (pointer.light) { if (e.button === 2 || !e.buttons) pointer.light = false; return; }
    if (e.button !== 0) return;
    if (pointer.down && !pointer.drag) tap(pointer.x, pointer.y);
    pointer.down = pointer.drag = false;
    cells.release();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => { pointer.down = pointer.drag = pointer.light = false; cells.release(); });
  // step C2: the wheel tilts the spotlight, Shift+wheel turns the direction it comes from. Browsers turn Shift+wheel
  // into a sideways scroll (deltaX), so either axis counts; one notch (about 100 px) = 5 degrees of tilt, 15 of turn.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (light.modeIndex !== 1) { flash('the wheel tilts the spotlight: Shift+L until it says "spotlight"'); return; }
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    if (e.shiftKey) {
      light.turnBy(d * 0.15);
      flash(`the light comes from ${compass(light.params.az)} (${light.params.az.toFixed(0)}°)`);
    } else {
      light.tiltBy(d * 0.05);
      const t = light.params.tilt;
      flash(t < 0.5 ? 'the light falls straight down' : `the light falls tilted by ${t.toFixed(0)}° (from ${compass(light.params.az)}): the spot stretches away from it, brighter on its near side`);
    }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Part C: Shift + a letter (before the plain keys, which lowercase e.key; Shift + a non-letter, such as ? or +, goes on)
    if (e.shiftKey && /^[a-z]$/i.test(e.key)) { shiftKey(e.key.toLowerCase()); return; }
    const k = e.key.toLowerCase();
    if (k === 'f') {
      overlayEl.hidden = !overlayEl.hidden;
      if (!overlayEl.hidden) drawOverlay();
    } else if (k === '?' || k === '/') {
      allKeys = !allKeys;
      hintEl.textContent = hintLine();
    } else if (k === 'a') {
      background.ambient = !background.ambient;
      flash(`ambient ripples ${background.ambient ? 'on' : 'off'}`);
    } else if (k === '1' || k === '2' || k === '3') {
      tapMode = Number(k) - 1;
      flash(`click drops: ${TAP_MODES[tapMode].label.replace(/^drop /, '')}`);
    } else if (k === 'c') {
      matter.clearSprings();
      flash('springs cleared (the atoms already in the dish stay; Shift+C washes them out)');
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
    } else if (k === '4') {
      const F = cells.fields;
      F.leakOn = !F.leakOn;
      flash(`leak by deformation ${F.leakOn ? 'on: strongly stretched cells leak into field B (blue centre dot)' : 'off'}`);
    } else if (k === '5') {
      const F = cells.fields;
      F.convOn = !F.convOn;
      flash(`conversion ${F.convOn ? 'on: cells that feel enough A turn to emitting B (blue outline)' : 'off'}`);
    } else if (k === '6') {
      const F = cells.fields;
      F.convMode = F.convMode ? 0 : 1;
      flash(`a converted cell ${F.convMode ? 'flips its B charge' : 'emits more B'}`);
    } else if (k === '7') {
      const F = cells.fields;
      F.relayOnKey = !F.relayOnKey;
      flash(`relay through B ${F.relayOnKey ? 'on: converted cells excite their neighbours, tire and rest' : 'off'}${F.convOn ? '' : ' (conversion is off: key 5)'}`);
    } else if (k === '8') {
      const X = cells.excl;
      X.on = !X.on;
      flash(`exclusion ${X.on ? 'on: same fate and same state (the bar) keep apart, other states pack closer' : 'off'}`);
    } else if (k === '9') {
      const X = cells.excl;
      X.flip = !X.flip;
      flash(`state flip ${X.flip ? 'on: a cell crowded by its own state turns to the state least represented around it' : 'off'}${X.on ? '' : ' (exclusion is off: key 8)'}`);
    } else if (k === '0') {
      const X = cells.excl;
      X.states = X.states >= 4 ? 2 : X.states + 1;
      flash(`exclusion: ${X.states} states (the bar's directions)${X.on ? '' : ' (exclusion is off: key 8)'}`);
    } else if (k === '\\') {
      const P = cells.params;
      P.squeeze = P.squeeze > SQUEEZE_SOFT ? SQUEEZE_SOFT : SQUEEZE_HARD;
      flash(`squeeze ${P.squeeze > SQUEEZE_SOFT ? 'hard: the pull to the centre presses the drop together (with 2 states (key 0), exclusion (8) and field B not felt (Q): a woven checkerboard)' : 'soft (normal)'}`);
    } else if (k === 'z') {
      const P = cells.partner;
      P.on = !P.on;
      flash(`partner A' ${P.on ? "on: cells feel field A and its quarter-period twin A' (yellow dots) as a phase current, and are pushed along it" : 'off'}`);
    } else if (k === ',') {
      const P = cells.partner;
      P.change = !P.change;
      flash(`change makes the partner ${P.change ? "on: a cell emits A' as the A it feels changes, and A as the A' it feels changes" : 'off'}`);
    } else if (k === '.') {
      const P = cells.partner;
      P.side = !P.side;
      flash(`sideways push ${P.side ? "on: the partner A' pushes at right angles (cells go round its blobs)" : 'off'}`);
    } else if (k === "'") {
      const P = cells.partner;
      P.chMode = P.chMode ? 0 : 1;
      flash(`change makes the partner: ${P.chMode ? "clock (in each cell A turns into A' and back; the neighbours pull the hand)" : "felt change (a cell emits A' as the A it feels changes, and A as the A' changes)"}${P.change ? '' : ' (the rule is off: key ,)'}`);
    } else if (k === ';') {
      landscape.params.partner = !landscape.params.partner;
      flash(`partner A' ${landscape.params.partner ? 'drawn (yellow dots, while a step 8 rule is on)' : 'not drawn'}`);
    } else if (k === 'l') {
      landscape.params.on = !landscape.params.on;
      flash(`landscape ${landscape.params.on ? 'on' : 'off: no halftone dots'}`);
    }
  });
}

/** Part C keys (Shift + letter). */
function shiftKey(k) {
  if (k === 'h') {
    const P = cells.heat.params;
    P.kicks = !P.kicks;
    flash(P.kicks ? 'jitter from heat: each cell is kicked in a random direction, harder where it is hot; the kick uses that heat up'
      : 'jitter constant (as before Part C): the heat is still made, spread and leaked, but no longer shakes the cells');
  } else if (k === 'e') {
    showEntropy(entropyEl.hidden);
    flash(`entropy panel ${entropyEl.hidden ? 'hidden' : 'shown'}`);
  } else if (k === 'r') {
    background.heatOn = !background.heatOn;
    flash(`ripples ${background.heatOn ? 'simmer with heat: small random rings where it is hot' : 'no longer driven by heat'}`);
  } else if (k === 'l') {
    const P = light.params;
    P.mode = P.mode === 'spot' ? 'full' : P.mode === 'full' ? 'off' : 'spot';
    flash(P.mode === 'spot' ? 'light: spotlight (right-drag moves it, the wheel tilts it, Shift+wheel turns where it comes from)'
      : P.mode === 'full' ? 'light: full field, the whole dish lit (clouds drift over)' : 'light off: only the base warmth and the cells\' own motion heat the dish');
  } else if (k === 's') {
    flash(matter.cycleShow());
  } else if (k === 'c') {
    matter.wash();
    flash('the dish washed: every atom out (booked as gone in the atoms ledger)');
  } else if (k === 'd') {
    const P = light.params;
    P.day = !P.day;
    flash(P.day ? `day and night: the light rises and falls over ${P.dayPeriod} s` : 'no day and night: the light stays at full day');
  }
}

/** A compass word for the direction the light comes from (screen: 0 = right, 90 = below). */
function compass(az) {
  const names = ['the right', 'the lower right', 'below', 'the lower left', 'the left', 'the upper left', 'above', 'the upper right'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

function showEntropy(on) {
  entropyEl.hidden = !on;
  document.body.classList.toggle('entropy-on', on);
}

let flashTimer = 0;
function flash(text) {
  hintEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { hintEl.textContent = hintLine(); }, 1600);
}

boot().catch((e) => { if (!messageIsShown()) showError('Could not start', e.stack || e.message || String(e)); });
