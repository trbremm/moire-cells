// Boot and frame loop.
//
// Frame loop: the simulation runs in fixed ticks of 1/60 s (at most MAX_TICKS per frame, so a slow frame
// slows the simulation instead of exploding it). Each frame:
//   1. every layer's compute(encoder, frame) records its compute passes (in layer order),
//   2. one render pass to the canvas; every layer's render(pass, frame) draws into it (in layer order),
//   3. submit.
// To add a step (landscape, cells, ...), write a class with resize / compute / render and push it into `layers`.
//
// URL parameters (handy for headless screenshots, see tools/shot.py):
//   ?nogpu=1    pretend WebGPU is missing (to see the fallback message)

import { initGPU, GPUUnavailable, showNoWebGPU, showError, messageIsShown } from './gpu.js';

window.__moireBooted = true;

const TICK = 1 / 60;
const MAX_TICKS = 4;
const BG = { r: 4 / 255, g: 6 / 255, b: 10 / 255, a: 1 };   // --bg #04060a

const params = new URLSearchParams(location.search);
const flag = (name) => params.has(name) && params.get(name) !== '0';

const canvas = document.getElementById('gpu');

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  showError('Something went wrong', (r && (r.stack || r.message)) || String(r));
});

let gpu = null;
let layers = [];
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

  layers = [];   // the passes come in the next steps

  resize();
  window.addEventListener('resize', resize);
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
let last = 0, acc = 0, simTime = 0, frameNo = 0;

function frame(now) {
  if (!running) return;
  const dtReal = last ? Math.min(0.25, (now - last) / 1000) : TICK;
  last = now;

  acc += dtReal;
  let ticks = Math.floor(acc / TICK);
  if (ticks > MAX_TICKS) { ticks = MAX_TICKS; acc = 0; } else acc -= ticks * TICK;
  simTime += ticks * TICK;

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

  if (frameNo === 10) stage('running-10-frames');
  frameNo++;
  requestAnimationFrame(frame);
}

boot().catch((e) => { if (!messageIsShown()) showError('Could not start', e.stack || e.message || String(e)); });
