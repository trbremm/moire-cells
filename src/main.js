// Boot, frame loop, input and the F overlay.
//
// Frame loop: the simulation runs in fixed ticks of 1/60 s (at most MAX_TICKS per frame and per 1x of speed, so a slow
// frame slows the simulation instead of exploding it). Speeds (step C3b; keys [ ], the toolbar): 1x to 8x as before;
// 16x and 32x (timelapse) and MAX run more ticks per drawn frame, capped by a budget of ticks that adapts to the
// measured time between frames (see `budgets`), never more than TICK_CAP. The ticks are the same at any speed; only how many run
// between two drawn frames changes. Space pauses (no ticks; the picture stays). Each frame:
//   1. every layer's compute(encoder, frame) records its compute passes (in layer order),
//   2. the drawing (step C6n, src/neon.js): the background onto the canvas; the cells into the trail buffer; the other
//      layers' render(pass, frame) (in layer order) and renderTop into the light buffer, with the cells copied in between;
//      the halo; the light composited onto the canvas,
//   3. submit.
// To add a step (landscape, cells, ...), write a class with resize / compute / render and push it into `layers`.
//
// URL parameters (handy for headless screenshots, see tools/shot.py):
//   ?overlay=1  show the frame-time / adapter overlay from the start (overlay=ghost: kept up to date but
//               invisible, so tools/shot.py can print it without it covering the picture)
//   ?ripple=1   drop a ripple every 0.7 s at varying spots
//   ?debug=1    copy console warnings and errors into the overlay
//   ?nogpu=1    pretend WebGPU is missing (to see the fallback message)
//   ?cells=N    number of cells (default 2000; on a phone or small touch screen fewer, see defaultCells)
//   ?check=1    compare the cells' neighbour grid with brute force every 2 s (console)
//   ?seed=N     seed of the random start (cells, genomes); default random
//   ?speed=N    simulation speed: 1, 2, 4, 8, 16 or 32 ticks of 1/60 s per 1/60 s of real time, or max (keys [ and ])
//   ?paused=1   start paused (Space)
//   ?ui=0|1     step C3b: start with the toolbar folded / unfolded (default: as the page last had it)
//   ?founders=N founder genomes at the start (0 = every cell its own)
//   ?view=1     colour by lineage from the start (key V); ?view=2 (or strategy): by strategy (step C6)
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
//   ?neon=0     step C6n: start with the flat look (key E); ?halo=off|low|medium|high (Shift+1); ?trails=0 (Shift+2);
//               ?hum=0 (Shift+3); ?cheap=0|1 the phone's cheaper neon path off / on (default: on touch screens and small
//               windows); ?machinery=1 start with every diagnostic layer shown (Shift+4; default: the clean view)
//   ?until=T    run until simulation time T (s), then pause, exactly at that tick (for comparing runs; tools/shot.py)
//   ?charge=0   step C6b: start with the charge field off (Shift+7); ?qstock=0 the cells' B charges by fate instead of
//               from their stock (Shift+8); ?qfeel=0 the cells not feeling the grid's field (Shift+9); ?contours=1 the
//               charge field's contour lines drawn (Shift+0)
//   ?honeycomb=0  step C6c: start with the ellipse cells instead of the elastic honeycomb (rules panel, Cell shape)
//   ?membrane=0   step C6c: start with the membrane chemistry off; ?bites=0, ?burst=0, ?elastic=0, ?selectivity=0 its rules
//               (rules panel, Membrane chemistry)
//   ?dipoles=0    step C6d: start with the dipoles (charge per side) off; ?dd=0 no dipole-dipole, ?dphi=0 the substrate's
//               field not acting on the side charges, ?dfield=0 no turning and stretching (rules panel, Charge per side)
//   ?pumps=0      step C7: start with the pumps off; ?pumpcontact=0 no pumping across contact, ?voltage=0 no membrane
//               voltage, ?v2b=0 the voltage's energy all heat (not back into the battery) (rules panel, Pumps)
//   ?crystal=0    step C7b: start with crystal seeding off (sediment no longer lowers the spark of its own formation);
//               ?cofactor=0 the engines' rates not scaled by the trace inside (rules panel, Catalysts)
//   ?hardmut=0    step C8: start with hard light not mutating the cells (rules panel, Hard light)
//
// Part C keys are Shift + a letter (every plain letter is taken by Parts A and B): checked before the plain keys,
// so Shift+H never also toggles H.
//   ?show=summary|off|<substance>   step C3: what the substances' halftone shows (Shift+S), e.g. ?show=G
//   ?chem=0     step C4: start with the chemistry off (Shift+M)
//   ?eat=0      step C5: start with the cells not eating (Shift+A)
//   ?engines=0  step C6: start with the engines in the genome off (Shift+O); ?burners=1 with everyone burning (C5's
//               built-in burner, Shift+U)
//   ?springs=0  step C5: the old empty start (no springs; the spot at the centre). The default scene puts a light and a
//               heavy spring beside the culture with the spot between, see defaultScene
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
import { setupUI } from './ui.js';
import { Recorder } from './record.js';
import { Neon, LIGHT_FORMAT } from './neon.js';
import { Charge } from './charge.js';

window.__moireBooted = true;

const TICK = 1 / 60;
const MAX_TICKS = 4;        // 1x to 8x: at most this many ticks per frame per 1x of speed (as before step C3b)
const TICK_CAP = 256;       // never more ticks than this in one frame (cells.js SLOTS = 320 leaves room for the warm-up)
// step C3b: the tick budgets of the fast speeds. MAX: as many ticks per frame as the GPU does while the picture keeps
// at least about 50 frames per s (frames of at most 20 ms; a GPU that keeps up does about 13 to 16 ms of work in each);
// 16x and 32x: up to frames of 34 ms (about 30 per s), so they come as close to their speed as the GPU allows.
// `ticks` adapts to the time between frames (smoothed): up by 5 % a frame while the frames are quick, down by 15 % when
// they are slow (or the GPU's queue runs far behind), then a pause before it grows again, and slowly near the level
// where it last got slow (`ceil`), so a GPU at its limit does not see-saw between smooth and stuttering.
const budgets = {
  max: { ticks: 8, frameMs: 20, hold: 0, calm: 0, ceil: 0 },
  fast: { ticks: 16, frameMs: 34, hold: 0, calm: 0, ceil: 0 },
};
let lastBud = null;   // the budget that limited the last frame (adapted at the next frame, when its time is known)

const params = new URLSearchParams(location.search);
const flag = (name) => params.has(name) && params.get(name) !== '0';

const SPEEDS = [1, 2, 4, 8, 16, 32, 0];   // 0 = MAX
let speed = params.get('speed') === 'max' ? 0 : Math.max(1, Math.min(32, Number(params.get('speed')) || 1));
let paused = flag('paused');
const speedName = (s) => (s ? `${s}×` : 'MAX');
const SEED = params.has('seed') ? (Number(params.get('seed')) >>> 0) : ((Math.random() * 4294967296) >>> 0);

const canvas = document.getElementById('gpu');
const overlayEl = document.getElementById('overlay');
const hintEl = document.getElementById('hint');
const entropyEl = document.getElementById('entropy');
const recEl = document.getElementById('rec');

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
let charge = null;     // step C6b: the screened charge field (src/charge.js)
let recorder = null;   // step C3b: the video recorder (Shift+V, the record button)
let neon = null;       // step C6n: the drawing as a whole, and the neon look (src/neon.js)
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
    // step C6n: every layer but the background draws into the light buffers (LIGHT_FORMAT), which src/neon.js
    // composites onto the canvas
    background = await Background.create(gpu.device, gpu.format);
    medium = new Medium(gpu.device);
    landscape = await Landscape.create(gpu.device, LIGHT_FORMAT, medium);
    light = await Light.create(gpu.device, LIGHT_FORMAT);
    matter = await Matter.create(gpu.device, LIGHT_FORMAT, medium);
    charge = await Charge.create(gpu.device, LIGHT_FORMAT);
    cells = await Cells.create(gpu.device, LIGHT_FORMAT, medium, Number(params.get('cells')) || defaultCells(), SEED);
    const small = Math.min(window.innerWidth || 800, window.innerHeight || 800) < 600;
    neon = await Neon.create(gpu.device, gpu.format, params.has('cheap') ? flag('cheap') : TOUCH || small);
    neonOptions(neon);
    cells.heat.setLight(light);   // step C2: the heat passes absorb the light
    light.heat = cells.heat;
    matter.attach(cells.heat);   // step C3: the substances live in the heat buffer, on its grid
    matter.light = light;        // step C4: the reactions read the light
    cells.matter = matter;
    matter.eat = cells.eat;      // step C5: the atoms inside the cells are in the matter's ledger
    matter.catalysts = cells.eat.catalysts;   // step C7b: crystal seeding goes into the chemistry's uniform
    // step C6b: the charge field's blocks live in the heat buffer, it is solved in the matter's ticks, the cells eat by it
    Object.assign(charge, { heat: cells.heat, matter, eat: cells.eat, cells });
    cells.heat.charge = charge; matter.charge = charge; cells.charge = charge; cells.eat.charge = charge;
    chargeOptions(charge);
    matter.landscape = landscape;
    lightOptions(light);
    cells.landscape = landscape;
    landscape.cells = cells;
    if (params.has('founders')) cells.genome.params.founders = Number(params.get('founders')) || 0;
    if (params.has('view')) {   // ?view=1 lineage, ?view=2 or ?view=strategy (step C6), ?view=3 or ?view=charge (step C6b)
      const v = params.get('view'), k = ['fate', 'lineage', 'strategy', 'charge'].indexOf(v);
      cells.look.view = k >= 0 ? k : Math.max(0, Math.min(3, Math.round(Number(v)) || 0));
    }
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
    if (params.has('chem')) matter.chem.on = flag('chem');   // step C4: ?chem=0 starts with the chemistry off (Shift+M)
    if (params.has('eat')) cells.eat.params.on = flag('eat');   // step C5: ?eat=0 starts with the cells not eating
    if (params.has('engines')) cells.eat.params.engines = flag('engines');   // step C6
    if (params.has('burners')) cells.eat.params.burner = flag('burners');
    if (params.has('honeycomb')) cells.shape.on = flag('honeycomb');   // step C6c: ?honeycomb=0 starts with the ellipse cells
    {   // step C6c: the membrane chemistry's switches
      const MP = cells.eat.membrane.params;
      for (const [q, k] of [['membrane', 'on'], ['bites', 'bites'], ['burst', 'burst'], ['elastic', 'elastic'], ['selectivity', 'select']]) {
        if (params.has(q)) MP[k] = flag(q);
      }
    }
    {   // step C6d: the dipoles' switches
      const DP = cells.dipole.params;
      for (const [q, k] of [['dipoles', 'on'], ['dd', 'dd'], ['dphi', 'phi'], ['dfield', 'field']]) {
        if (params.has(q)) DP[k] = flag(q);
      }
    }
    {   // step C7: the pumps' switches
      const PP = cells.eat.pumps.params;
      for (const [q, k] of [['pumps', 'on'], ['pumpcontact', 'contact'], ['voltage', 'voltage'], ['v2b', 'v2b']]) {
        if (params.has(q)) PP[k] = flag(q);
      }
    }
    {   // step C7b: the catalysts' switches
      const CP = cells.eat.catalysts.params;
      for (const [q, k] of [['crystal', 'crystal'], ['cofactor', 'cofactor']]) {
        if (params.has(q)) CP[k] = flag(q);
      }
    }
    if (params.has('hardmut')) cells.eat.hardlight.params.on = flag('hardmut');   // step C8
    background.heat = cells.heat;
  } catch (e) {
    showError(e.shaderError ? 'Shader did not compile' : 'Could not set up the GPU passes', e.message || String(e));
    return;
  }
  // the medium first: it writes the lattice every field-reading layer uses; the light before the cells (its uniform is
  // read by the heat passes the cells run), and its tint is drawn under them (its outline over them: renderTop)
  layers = [medium, background, landscape, matter, charge, light, cells];   // (step C6b: the charge's contours over the substances)
  // handle for tuning from the console or tools/shot.py --eval, e.g. moire.background.params.viscosity = 0.03
  window.moire = { gpu, layers, background, medium, landscape, cells, genome: cells.genome, heat: cells.heat, light, matter, eat: cells.eat, neon, charge,
    membrane: cells.eat.membrane, dipole: cells.dipole, pumps: cells.eat.pumps, catalysts: cells.eat.catalysts, hardlight: cells.eat.hardlight };
  window.moire.time = () => simTime;   // simulation time (s), for tools/shot.py --at
  window.moire.stats = stats;          // frame time, ticks this frame, speed reached (step C3b)
  window.moire.budgets = budgets;      // the fast speeds' tick budgets
  // births and deaths drop small ripples into the background (a birth a bump, a death a dip)
  cells.onEvents = (events) => {
    const amp = cells.genome.params.ripple;
    if (!(amp > 0)) return;
    for (const [x, y, sign] of events) background.impulse(x, y, sign > 0 ? amp : -0.7 * amp);
  };

  resize();
  defaultScene();
  window.addEventListener('resize', resize);
  setupInput();
  if (flag('overlay')) overlayEl.hidden = false;
  showEntropy(!params.has('entropy') || flag('entropy'));
  if (params.get('overlay') === 'ghost') overlayEl.style.opacity = '0';   // kept up to date but invisible (for tools/shot.py)
  running = true;
  stage('running');
  requestAnimationFrame(frame);
}

/**
 * Step C3b: the number of cells when the URL does not say. 2000 on a computer; on a touch screen or a small window,
 * fewer, by the shorter side (the blob's size): 2000 x (side / 800 px)^2, between 800 and 1500. So a phone (about
 * 390 px) gets 800 cells of about the computer's size (R about 5 px instead of 3 with 2000) and runs lighter.
 */
function defaultCells() {
  const side = Math.min(window.innerWidth || 800, window.innerHeight || 800);
  if (!TOUCH && side >= 600) return DEFAULT_CELLS;
  return Math.max(800, Math.min(1500, Math.round(DEFAULT_CELLS * (side / 800) ** 2)));
}

/**
 * Step C5: the default scene, so the chemistry and the eating show without anyone doing anything: a light and a heavy
 * spring just beyond the culture's rim, on the dish's longer axis (to the right on a wide screen, below on a tall one),
 * and the spotlight centred on the rim between them, so it lights both springs and the edge of the culture. The springs
 * drip for a whole day (SCENE.life, 240 s). ?springs=0: the old empty start (and the spot where it was).
 */
const SCENE = { life: 240, rim: 0.72, gap: 0.01, apart: 0.09 };
function defaultScene() {
  if (params.has('springs') && !flag('springs')) return;
  const W = view.cssW, H = view.cssH, m = Math.min(W, H);
  const rim = SCENE.rim * cells.R * Math.sqrt(cells.count / 0.85);   // about the settled culture's radius (its seed blob shrinks)
  const wide = W >= H, ax = wide ? [1, 0] : [0, 1], perp = wide ? [0, 1] : [1, 0];
  const d = rim + SCENE.gap * m, s = SCENE.apart * m;
  const cx = W / 2 + ax[0] * d, cy = H / 2 + ax[1] * d;
  matter.addSpring(cx - perp[0] * s, cy - perp[1] * s, 'light', SCENE.life);
  matter.addSpring(cx + perp[0] * s, cy + perp[1] * s, 'heavy', SCENE.life);
  if (!params.has('spot')) light.moveTo(W / 2 + ax[0] * rim, H / 2 + ax[1] * rim);
}

/** Step C6n: the look's URL options (see the top of this file). */
function neonOptions(N) {
  if (params.has('neon')) N.on = flag('neon');
  if (params.has('halo')) {
    const h = params.get('halo'), i = ['off', 'low', 'medium', 'high'].indexOf(h);
    N.params.halo = i >= 0 ? i : Math.max(0, Math.min(3, Math.round(Number(h)) || 0));
  }
  if (params.has('trails')) N.params.trails = flag('trails');
  if (params.has('hum')) N.params.hum = flag('hum');
}

/** Step C6b: the charge's URL options (see the top of this file). */
function chargeOptions(Q) {
  const P = Q.params;
  if (params.has('charge')) P.on = flag('charge');
  if (params.has('qstock')) P.stock = flag('qstock');
  if (params.has('qfeel')) P.feel = flag('qfeel');
  if (params.has('contours')) P.contours = flag('contours');
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
  if (neon) neon.resize(view);
  if (light && light.pendingSpotPx) {
    const [x, y, r] = light.pendingSpotPx;
    light.pendingSpotPx = null;
    if (Number.isFinite(x) && Number.isFinite(y)) light.moveTo(x, y);
    if (Number.isFinite(r) && r > 0) light.params.radius = r / Math.min(cssW, cssH);
  }
}

// ---------- loop ----------
const stats = { frameMs: 16.7, iv: 16.7, cpuMs: 0, gpuMs: 0, lastOverlay: 0, lastProbe: 0, reached: 1, ticks: 0, lat: 0 };
let last = 0, acc = 0, simTime = 0, frameNo = 0, nextAutoRipple = 0.3, autoK = 0;
const UNTIL = params.has('until') ? Math.max(0, Number(params.get('until')) || 0) : -1;   // ?until=T

function frame(now) {
  if (!running) return;
  const dtReal = last ? Math.min(0.25, (now - last) / 1000) : TICK;
  last = now;
  stats.frameMs += (dtReal * 1000 - stats.frameMs) * 0.05;
  stats.iv += (dtReal * 1000 - stats.iv) * 0.3;   // the same, quicker: for the budgets
  if (lastBud) adapt(lastBud);

  let ticks, bud = null;
  if (paused) { ticks = 0; acc = 0; }
  else if (!speed) { bud = budgets.max; ticks = bud.ticks; acc = 0; }
  else {
    acc += dtReal * speed;
    ticks = Math.floor(acc / TICK);
    const cap = speed >= 16 ? Math.min(TICK_CAP, budgets.fast.ticks) : MAX_TICKS * speed;
    if (ticks > cap) { ticks = cap; acc = 0; if (speed >= 16) bud = budgets.fast; } else acc -= ticks * TICK;
  }
  if (UNTIL >= 0 && !paused) {
    // ?until=T: never past T; pause on reaching it (the same tick in every run)
    const left = Math.max(0, Math.round((UNTIL - simTime) / TICK));
    if (ticks >= left) { ticks = left; paused = true; acc = 0; bud = null; document.body.dataset.until = 'reached'; }
  }
  simTime += ticks * TICK;
  // the speed reached: simulation time per real time, smoothed over about a second
  stats.reached += (ticks * TICK / Math.max(1e-3, dtReal) - stats.reached) * Math.min(1, dtReal / 1.0);
  stats.ticks = ticks;
  lastBud = bud;

  if (flag('ripple') && simTime >= nextAutoRipple) autoRipple();

  const t0 = performance.now();
  // realDt and reached: real time, for the drawing only (step C6n: the trails' fade, the hum)
  const f = { dt: ticks * TICK, tickDt: TICK, ticks, time: simTime, frameNo, realDt: dtReal, reached: paused ? 1 : stats.reached };
  const device = gpu.device;
  const encoder = device.createCommandEncoder({ label: `frame ${frameNo}` });
  for (const l of layers) l.compute(encoder, f);
  neon.tickReal(dtReal);
  const drawn = { background, cells, under: layers.filter((l) => l !== background && l !== cells), top: layers };
  neon.encode(encoder, f, gpu.context.getCurrentTexture().createView(), drawn);
  device.queue.submit([encoder.finish()]);
  const slow = neon.watch(stats.frameMs, dtReal, !paused && speed >= 1 && speed <= 8 && frameNo > 120);
  if (slow) flash(slow);
  stats.cpuMs += (performance.now() - t0 - stats.cpuMs) * 0.05;
  if (recorder && recorder.on) {
    recorder.capture();   // the frame just drawn, into the recording (in this task, while the canvas holds it)
    const e = Math.floor(recorder.elapsed), t = `REC ${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`;
    if (recEl.lastChild.textContent !== t) recEl.lastChild.textContent = t;
  }

  // rough GPU latency: time from submit until the queue reports the work done (every 8th frame); the budgets also back
  // off when it runs far behind
  if (frameNo % 8 === 0) {
    const ts = performance.now();
    device.queue.onSubmittedWorkDone().then(() => { stats.lat = performance.now() - ts; stats.gpuMs += (stats.lat - stats.gpuMs) * 0.3; });
  }

  if (!entropyEl.hidden) {
    const compact = view.cssW < 560 || view.cssH < 500;   // a phone (either way up): shorter lines
    let t = `${cells.heat.panelText(compact)}\n${matter.panelLine(compact)}\n${cells.eat.panelLine(compact)}\n${cells.eat.strategyLine(compact)}\n${charge.panelLine(compact)}\n${cells.eat.membrane.panelLine(compact)}\n${cells.dipole.panelLine(compact)}\n${cells.eat.pumps.panelLine(compact)}\n${cells.eat.catalysts.panelLine(compact)}\n${cells.eat.hardlight.panelLine(compact)}`;
    if (paused || speed !== 1) {
      const r = reachedText();
      const sp = paused ? 'paused' : r ? (compact ? r : `${speedName(speed)} · reached ${r}`) : speedName(speed);
      t = t.replace('\n', `${compact ? '  ' : '   '}${sp}\n`);
    }
    if (t !== entropyEl.textContent) entropyEl.textContent = t;
  }
  if (frameNo === 10) stage('running-10-frames');
  if (!overlayEl.hidden && now - stats.lastOverlay > 250) { stats.lastOverlay = now; drawOverlay(); }
  if (!overlayEl.hidden && now - stats.lastProbe > 1000) {
    stats.lastProbe = now;
    cells.probe().then(() => neon.probe(drawn, f));   // one after the other, so they do not time each other
  }
  frameNo++;
  requestAnimationFrame(frame);
}

/** A fast speed's budget, after a frame it limited (see `budgets`). */
function adapt(B) {
  if (B.hold > 0) B.hold--;
  if (stats.iv > B.frameMs * 1.15 || stats.lat > B.frameMs * 4) {
    if (B.hold > 0) return;   // the last cut has not shown in the frame times yet
    B.ceil = B.ticks;
    B.ticks = Math.max(1, Math.floor(B.ticks * 0.85));
    B.hold = 8; B.calm = 30;
  } else if (stats.iv < B.frameMs * 0.9) {
    if (B.calm > 0) { B.calm--; return; }
    const near = B.ceil && B.ticks + 1 >= B.ceil;
    const step = near ? (frameNo % 60 === 0 ? 1 : 0) : Math.max(1, Math.round(B.ticks * 0.05));
    B.ticks = Math.min(TICK_CAP, B.ticks + step);
    if (B.ticks > B.ceil) B.ceil = 0;
  }
}

/** The speed reached, for the speed button and the entropy panel: "×37", "×0.9", or "" at the set speed. */
function reachedText() {
  if (paused) return 'paused';
  const r = stats.reached;
  if (speed && speed <= 8 && r > 0.8 * speed) return '';   // 1x to 8x: only when notably slower than set
  return `×${r >= 9.5 ? r.toFixed(0) : r.toFixed(1)}`;
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
    ...cells.eat.overlayLines(),
    ...charge.overlayLines(),
    ...cells.eat.membrane.overlayLines(),
    ...cells.dipole.overlayLines(),
    ...cells.eat.pumps.overlayLines(),
    ...cells.eat.catalysts.overlayLines(),
    ...cells.eat.hardlight.overlayLines(),
    neon.overlayLine(),
    `simmer (Shift+R) ${background.heatOn ? 'on' : 'off'}: ripple drops ${background.params.heatDrops} per cell per step x temperature², height ${background.params.heatAmp}`,
    `sim t ${simTime.toFixed(1)} s · speed ${paused ? 'paused' : speedName(speed)}, reached ×${stats.reached.toFixed(2)} (${stats.ticks} ticks this frame` +
      `${!speed || speed >= 16 ? `, budget ${(speed ? budgets.fast : budgets.max).ticks} ticks, gpu done after ${stats.lat.toFixed(1)} ms` : ''}) · seed ${SEED}`,
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
let ui = null;
// touch only (no mouse or pen anywhere): no hint line, bigger buttons
const TOUCH = !!(window.matchMedia && !window.matchMedia('(any-pointer: fine)').matches);

let hintQuiet = false;   // step C6n: the short hint goes quiet 8 s after the start (a calm screen); flashes and ? still show
function hintLine() {
  if (allKeys) return fullHint();
  if (TOUCH || hintQuiet) return '';   // touch only: the toolbar says it all; the line shows only the flashes
  const t = TOOLS[tool];
  const what = t.spot ? 'click or drag: move the light' : t.stir ? 'click or drag: stir' : `click: ${t.label} · drag: stir`;
  return `${what} · right-drag: move the light · wheel: tilt it · ?: all keys`;
}
/** Every key, from the action table, plus the mouse. */
function fullHint() {
  const list = actions.filter((a) => a.keys.length).map((a) => `${keysText(a)}: ${a.label}`);
  return `click: ${TOOLS[tool].label} · drag: stir · ${list.join(' · ')} · right-drag: move the light · wheel: tilt it · ` +
    'Shift+wheel: turn where the light comes from';
}

/** The app as the action table sees it (src/actions.js). */
function makeApp() {
  return {
    get cells() { return cells; }, get background() { return background; }, get landscape() { return landscape; },
    get light() { return light; }, get matter() { return matter; }, get heat() { return cells.heat; },
    get charge() { return charge; },
    get neon() { return neon; },
    get view() { return view; },
    overlayEl, entropyEl, ANCHORS,
    get tool() { return tool; },
    setTool,
    speeds: () => SPEEDS.map(speedName),
    speedIndex: () => Math.max(0, SPEEDS.indexOf(speed)),
    speedLabel: () => speedName(speed),
    speedReached: reachedText,
    setSpeed(i) { speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))]; return speedText(); },
    stepSpeed(d) {
      const i = SPEEDS.indexOf(speed);
      speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + d))];
      return speedText();
    },
    get paused() { return paused; },
    recording: () => !!(recorder && recorder.on),
    canRecord: () => !!(recorder && recorder.supported),
    toggleRecord,
    togglePause() { paused = !paused; return paused ? 'paused (Space or the button runs it again)' : 'running'; },
    showEntropy, drawOverlay, flash, compass, tiltText, turnText,
    allKeys: () => allKeys,
    toggleAllKeys() { allKeys = !allKeys; hintEl.textContent = hintLine(); },
  };
}

function toggleRecord() {
  if (!recorder.supported) return 'recording is not available in this browser (it cannot capture a canvas as video)';
  if (recorder.on) {
    recorder.stop();
    recEl.hidden = true;
    document.body.classList.remove('recording');
    return 'recording stopped: saving the video file';
  }
  recorder.start(view.cssW, view.cssH);
  recEl.lastChild.textContent = 'REC 0:00';
  recEl.hidden = false;
  document.body.classList.add('recording');
  return `recording the dish (not the panels) as ${recorder.type.split(';')[0].replace('video/', '')}: Shift+V or the button again stops and saves it`;
}

function speedText() {
  if (!speed) return 'speed MAX: as many steps per frame as the GPU does at about 50 frames per s (the speed button shows the speed reached)';
  return speed >= 16 ? `speed ${speed}× (as close as the GPU allows; the speed button shows the speed reached)` : `speed ${speed}×`;
}

/** Keys 1 2 3 and the toolbar: what a tap / click and a drag on the dish do. */
function setTool(i) {
  tool = i;
  const t = TOOLS[i];
  let text;
  if (t.stir) text = 'tap and drag: stir the dish';
  else if (t.spot) {
    text = 'tap or drag: move the spotlight there';
    if (light.params.mode !== 'spot') { light.params.mode = 'spot'; text += ' (the light is now a spotlight)'; }
  } else text = `click drops: ${t.label.replace(/^drop /, '')}`;
  return text;
}

function tiltText() {
  const t = light.params.tilt;
  return t < 0.5 ? 'the light falls straight down' : `the light falls tilted by ${t.toFixed(0)}° (from ${compass(light.params.az)}): the spot stretches away from it, brighter on its near side`;
}
function turnText() { return `the light comes from ${compass(light.params.az)} (${light.params.az.toFixed(0)}°)`; }

/** Run an action (from a key or a button); k = the key, or '-' / '+' for a knob's buttons. */
function runAction(a, k) {
  const text = a.run(k);
  if (text) flash(text);
  if (ui) ui.refresh();
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
  // step C6n: Shift + a digit key (by its place on the keyboard, e.code, as the symbol it types differs between
  // layouts), unless that symbol is already a key of its own (e.g. Shift+7 is / on a German keyboard, Shift+1 is 1 on a
  // French one: those keep their meaning)
  if (e.shiftKey && /^Digit[0-9]$/.test(e.code) && !keys.plain.has(k)) {
    const s = keys.shift.get(e.code.slice(5));
    if (s) { runAction(s, `shift+${e.code.slice(5)}`); return; }
  }
  const a = keys.plain.get(k);
  if (!a) return;
  if (k === ' ') e.preventDefault();   // Space pauses; it must not also press a focused button
  runAction(a, k);
}

function tap(x, y) {
  const m = TOOLS[tool];
  if (m.stir) { background.impulse(x, y, 1.2); return; }   // the stir tool: a tap is a small stir bump
  if (!m.spring) { background.impulse(x, y, 2.5, 1.2 * background.sc); return; }
  matter.addSpring(x, y, m.spring);
  background.impulse(x, y, 3);   // a spring lands with a ripple, as the old sources did
}

function setupInput() {
  recorder = new Recorder(canvas);
  recorder.onSaved = (name, size) => flash(`saved ${name} (${(size / 1e6).toFixed(1)} MB)`);
  window.moire.recorder = recorder;
  const app = makeApp();
  actions = makeActions(app);
  keys = keyMaps(actions);
  hintEl.textContent = hintLine();
  if (params.has('machinery')) {   // step C6n: ?machinery=1, every diagnostic layer at once (the action does it)
    const m = actions.find((a) => a.id === 'machinery');
    if (m && !!m.get() !== flag('machinery')) m.run();
  }
  setTimeout(() => { hintQuiet = true; if (!flashTimer) hintEl.textContent = hintLine(); }, 8000);
  const pointer = { down: false, drag: false, light: false, x: 0, y: 0, sx: 0, sy: 0 };
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  canvas.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;   // a second finger: left to the browser (pinch); the first keeps its gesture
    const [x, y] = pos(e);
    if (e.button === 0 && TOOLS[tool].spot) {
      // the move-light tool: a tap or a drag puts the spot's centre under the pointer (as the right button does)
      if (light.params.mode !== 'spot') { light.params.mode = 'spot'; flash('light: spotlight'); }
      Object.assign(pointer, { down: false, drag: false, light: true });
      light.moveTo(x, y);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
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
    if (!e.isPrimary) return;
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
    if (!e.isPrimary) return;
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
      flash(turnText());
    } else {
      light.tiltBy(d * 0.05);
      flash(tiltText());
    }
  }, { passive: false });

  window.addEventListener('keydown', onKey);
  ui = setupUI(Object.assign(app, {
    actions, runAction, touch: TOUCH,
    startFolded: params.has('ui') ? !flag('ui') : null,
  }));
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
  flashTimer = setTimeout(() => { flashTimer = 0; hintEl.textContent = hintLine(); }, 1600);
}

boot().catch((e) => { if (!messageIsShown()) showError('Could not start', e.stack || e.message || String(e)); });
