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
import { makeActions, keyMaps, keysText, TOOLS, SQUEEZE_SOFT, SQUEEZE_HARD } from './actions.js';

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
    `tap ${TOOLS[tool].name} · landscape ${landscape.params.on ? 'on' : 'off'} · R ${medium.R.toFixed(2)} px · medium ${(medium.la0 * 180 / Math.PI).toFixed(2)}°`,
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
// Every key and button runs an entry of ONE action table (src/actions.js); what a tap / click drops is the tool
// (keys 1, 2, 3; step C3: springs of atoms replace the old nutrient and threat sources).
let tool = 0;
let allKeys = false;   // key ?: the short hint or the full key list
let actions = [];
let keys = null;

function hintLine() {
  const short = `click: ${TOOLS[tool].label} · drag: stir · 1 ripple · 2 light spring · 3 heavy spring · ` +
    'N / G: new culture · [ ]: speed · F: stats · ⇧E ⇧L ⇧S: entropy, light, substances · ?: more';
  return allKeys ? fullHint() : short;
}
/** Every key, from the action table, plus the mouse. */
function fullHint() {
  const list = actions.filter((a) => a.keys.length).map((a) => `${keysText(a)}: ${a.label}`);
  return `click: ${TOOLS[tool].label} · drag: stir · ${list.join(' · ')} · right-drag: move the spot · wheel: tilt it · ` +
    'Shift+wheel: turn where the light comes from';
}

/** The app as the action table sees it (src/actions.js). */
function makeApp() {
  return {
    get cells() { return cells; }, get background() { return background; }, get landscape() { return landscape; },
    get light() { return light; }, get matter() { return matter; }, get heat() { return cells.heat; },
    get view() { return view; },
    overlayEl, entropyEl, ANCHORS,
    get tool() { return tool; },
    setTool(i) { tool = i; return `click drops: ${TOOLS[tool].label.replace(/^drop /, '')}`; },
    speedLabel: () => `${speed}×`,
    stepSpeed(d) {
      const i = SPEEDS.indexOf(speed);
      speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + d))];
      return `speed ${speed}×`;
    },
    showEntropy, drawOverlay,
    allKeys: () => allKeys,
    toggleAllKeys() { allKeys = !allKeys; hintEl.textContent = hintLine(); },
  };
}

/** Run an action (from a key or a button); k = the key, or '-' / '+' for a knob's buttons. */
function runAction(a, k) {
  const text = a.run(k);
  if (text) flash(text);
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Part C: Shift + a letter (before the plain keys, which lowercase e.key; Shift + a non-letter, such as ? or +, goes on)
  if (e.shiftKey && /^[a-z]$/i.test(e.key)) {
    const a = keys.shift.get(e.key.toLowerCase());
    if (a) runAction(a, `shift+${e.key.toLowerCase()}`);
    return;
  }
  const k = e.key.toLowerCase();
  const a = keys.plain.get(k);
  if (a) runAction(a, k);
}

function tap(x, y) {
  const m = TOOLS[tool];
  if (!m.spring) { background.impulse(x, y, 2.5, 1.2 * background.sc); return; }
  matter.addSpring(x, y, m.spring);
  background.impulse(x, y, 3);   // a spring lands with a ripple, as the old sources did
}

function setupInput() {
  actions = makeActions(makeApp());
  keys = keyMaps(actions);
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

  window.addEventListener('keydown', onKey);
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
