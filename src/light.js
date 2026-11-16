// Light (Part C, step C2): a light falls on the dish, either everywhere (FULL FIELD) or as a SPOTLIGHT that the mouse
// moves and tilts. Where it falls, what catches it warms up: the caught light becomes heat in the heat grid (src/heat.js,
// heat.wgsl's absorb), so the cells there shiver more and the ripples simmer more; the rest passes through the dish and
// is lost. The entropy panel books both.
//
// This module owns the light's state and its uniform (struct LightP, light_common.wgsl), shared by the heat passes
// (absorption) and the drawing (light_draw.wgsl): a thin, hard-edged ellipse outline in a faded warm white with a small
// marker on the side the light comes from, and a very faint flat tint inside. It is a layer: compute() writes the
// uniform (before the cells' passes, which run the heat), render() draws the tint under the cells, renderTop() the
// outline over them.
//
// Geometry: a beam of radius r hits the dish tilted by `tilt` from straight down, coming from the direction `az`. The
// spot is an ellipse with half-axes r / cos(tilt) (toward the light) and r (across): the same power over an area
// 1 / cos(tilt) larger, so dimmer on average, and brighter on the near side (a linear slope whose mean over the ellipse
// is zero, so the total stays the same).
//
// Slow variation: a day / night cycle (the power rises and falls over `dayPeriod` s of simulation time, between
// `dayMin` and 1; Shift+D) and, in full field only, soft cloud patches drifting across (low-frequency noise multiplying
// the power).

import { loadShader } from './gpu.js';
import { HEAT_SCALE } from './heat.js';
import { pal } from './palette.js';
import { camera } from './camera.js';   // app: the view camera (drawing only)

export const LIGHT_COMMON_URL = 'src/shaders/light_common.wgsl';
const LP_BYTES = 176;   // struct LightP (160 until the app's camera)

// The bands, on the same energy ladder as everything else in Part C (CLAUDE.md): short period = high energy. Light,
// the fields A / B / A', motion and heat all sit on one scale; heat is the lowest band (photon energy far below 1).
//   photon:  energy of one quantum of the band (abstract units; later steps match it to bond energies: the visible
//            bands make the lighter bonds, hard light the heaviest)
//   share:   the band's share of the light's power (the shares add to 1)
//   medium:  optical depth of the bare medium (water, the dish): the share it catches is 1 - exp(-medium)
//   cell:    optical depth of one full layer of cells: 1 - exp(-cell) of the light on a covered place is caught
// What is caught becomes heat; the rest passes through and is lost. In C2 nothing catches visible light (no pigments,
// no atoms yet), so both visible bands pass through. Later absorbers (atoms, sediment, the cells' pigment genes) add
// their own optical depth per band in heat.wgsl's absorb().
//   ink:     step C6: the band's colour where something shows it (a cell's pigment part, the strategy view), by photon
//            energy from warm red-orange through gold and sky blue to violet for hard light: since step C6n in
//            src/palette.js (band[k], flat and neon)
export const BANDS = [
  { name: 'warm', photon: 1, share: 0.40, medium: 0.4, cell: 2.3 },   // heat only: caught by everything (33 % by the bare
                                                                      // medium, 90 % by a layer of cells)
  { name: 'visible 1', photon: 2, share: 0.22, medium: 0, cell: 0 },   // the lighter bonds (C4); C6: pigments
  { name: 'visible 2', photon: 3, share: 0.22, medium: 0, cell: 0 },   // the richer bonds (C4); C6: pigments
  { name: 'hard', photon: 5, share: 0.16, medium: 0.08, cell: 1.2 },  // the heaviest bonds, cracks sediment (C4);
                                                                      // mostly heat in cells (70 %), a little passes
];

export const LIGHT_MODES = ['off', 'spot', 'full'];

export class Light {
  constructor(device, format) {
    this.device = device;
    this.format = format;
    // live-tunable: moire.light.params
    this.params = {
      mode: 'spot',       // 'spot' | 'full' | 'off' (Shift+L cycles)
      power: 33,          // energy per s per 100 CSS px^2 falling on the dish at full day, straight down, no cloud
                          // (per dish area, not per cell area, so the kicks it gives scale with the cells' radius:
                          // 33 is about 14 per R^2 at 2000 cells on a 1280 x 800 window, R 6.5 px)
      x: 0.5, y: 0.5,     // the spot's centre, as a share of the dish's width and height
      radius: 0.25,       // the beam's radius, as a share of the dish's shorter side
      tilt: 0,            // degrees from straight down (0 to maxTilt; mouse wheel)
      maxTilt: 70,
      az: 225,            // degrees: the direction the light comes from (0 = from the right, 90 = from below, as the
                          // screen's y; 225 = from the top left; Shift+wheel)
      near: 0.6,          // how much brighter the near rim is at a 90 degree tilt (x sin(tilt))
      edge: 1.5,          // CSS px of the rim's falloff (crisp)
      day: true,          // Shift+D: the day / night cycle (off: always full day)
      dayPeriod: 240,     // s of simulation time for one day
      dayMin: 0.15,       // the night's power, as a share of the day's
      dayStart: 0.35,     // where in the day the page starts (0 = midnight, 0.5 = noon)
      clouds: true,       // full field only: soft cloud patches drifting over
      cloudSize: 380,     // CSS px
      cloudDrift: 6,      // CSS px per s of simulation time
      cloudDepth: 0.45,   // how much a full cloud takes away
      // drawing
      // (the colour: the palette's `spot`, warm white; src/palette.js)
      lineAlpha: 0.55,    // the outline's opacity under the flat look (neon: x the palette's levels.spot / 0.55)
      lineWidth: 1.25,    // CSS px
      marker: 7,          // CSS px: the triangle on the near rim
      tintAlpha: 0.045,   // the inside tint at full day (0 = none)
      fullTint: 0.025,    // the full field's tint at full day (0 = none)
      tintSteps: 3,       // the tint is posterised into this many flat levels (the near side's slope, the clouds)
    };
    this.view = null;
    this.heat = null;     // set by main.js (the heat grid's pixel size and the tick length)
    this.dayLevel = 1;
    this.time = 0;
    this.ab = new ArrayBuffer(LP_BYTES);
  }

  static async create(device, format) {
    const l = new Light(device, format);
    await l.init();
    return l;
  }

  async init() {
    const d = this.device;
    const res = await fetch(LIGHT_COMMON_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Could not load shader ${LIGHT_COMMON_URL}: HTTP ${res.status}`);
    this.common = (await res.text()).replace(/\s*$/, '\n\n');
    const mod = await loadShader(d, 'src/shaders/light_draw.wgsl', { prefixes: [{ name: LIGHT_COMMON_URL, text: this.common }] });
    this.buffer = d.createBuffer({ label: 'light', size: LP_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    const bgl = d.createBindGroupLayout({
      label: 'light draw',
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const layout = d.createPipelineLayout({ label: 'light draw', bindGroupLayouts: [bgl] });
    const pipe = (entry) => d.createRenderPipeline({
      label: `light ${entry}`, layout,
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: entry, targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.tintPipe = pipe('fs_tint');
    this.linePipe = pipe('fs_line');
    this.bg = d.createBindGroup({ label: 'light draw', layout: bgl, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
  }

  get modeIndex() { return Math.max(0, LIGHT_MODES.indexOf(this.params.mode)); }
  get on() { return this.modeIndex !== 0; }

  resize(view) { this.view = view; }

  /** Spot centre and radius in CSS px. */
  spot() {
    const p = this.params, v = this.view;
    return { x: p.x * v.cssW, y: p.y * v.cssH, r: Math.max(4, p.radius * Math.min(v.cssW, v.cssH)) };
  }

  /** Mouse: put the spot's centre at (x, y) CSS px. */
  moveTo(x, y) {
    const v = this.view;
    this.params.x = Math.max(0, Math.min(1, x / v.cssW));
    this.params.y = Math.max(0, Math.min(1, y / v.cssH));
  }

  /** Mouse wheel: tilt by d degrees (clamped to 0 .. maxTilt). */
  tiltBy(d) {
    const p = this.params;
    p.tilt = Math.max(0, Math.min(p.maxTilt, p.tilt + d));
  }

  /** Shift+wheel: turn the direction the light comes from by d degrees. */
  turnBy(d) {
    const p = this.params;
    p.az = ((p.az + d) % 360 + 360) % 360;
  }

  /** The day / night level at simulation time t (dayMin .. 1; 1 with the cycle off). */
  dayAt(t) {
    const p = this.params;
    if (!p.day) return 1;
    const ph = (t / Math.max(1, p.dayPeriod) + p.dayStart) % 1;    // 0 midnight, 0.5 noon
    const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph);
    return p.dayMin + (1 - p.dayMin) * s;
  }

  /** The hour of the day (0 .. 24) at simulation time t, for the overlay. */
  hourAt(t) {
    const p = this.params;
    return 24 * ((t / Math.max(1, p.dayPeriod) + p.dayStart) % 1);
  }

  /** Write the uniform for this frame (the heat passes of this frame and the drawing read it). */
  compute(encoder, frame) {
    if (!this.view) return;
    this.time = frame.time;
    this.dayLevel = this.dayAt(frame.time);
    const p = this.params, f = new Float32Array(this.ab), u = new Uint32Array(this.ab);
    const mode = this.modeIndex, sp = this.spot();
    const tilt = Math.max(0, Math.min(89, p.tilt)) * Math.PI / 180, az = p.az * Math.PI / 180;
    u[0] = mode; u[1] = p.clouds ? 1 : 0; f[2] = this.view.cssW; f[3] = this.view.cssH;
    f[4] = sp.x; f[5] = sp.y; f[6] = Math.cos(az); f[7] = Math.sin(az);
    f[8] = sp.r; f[9] = 1 / Math.cos(tilt); f[10] = Math.max(0, Math.min(0.95, p.near * Math.sin(tilt))); f[11] = Math.max(0.05, p.edge);
    // clouds: the noise drifts slowly along a fixed slant
    const cs = Math.max(20, p.cloudSize), drift = p.cloudDrift * frame.time / cs;
    f[12] = 0.83 * drift + 3.1; f[13] = 0.31 * drift + 7.7; f[14] = 1 / cs; f[15] = Math.max(0, Math.min(1, p.cloudDepth));
    // per band: counts per heat pixel per tick where the light factor is 1
    const H = this.heat;
    const px = H && H.px ? H.px : 3, dt = frame.tickDt || 1 / 60;
    const perPx = Math.max(0, p.power) / 100 * this.dayLevel * px * px * dt * HEAT_SCALE;
    this.refPerPx = Math.max(1e-9, Math.max(0, p.power) / 100 * px * px * dt * HEAT_SCALE);   // (step C12d: full day, for the glow's scale)
    BANDS.forEach((b, k) => {
      f[16 + k] = perPx * b.share;
      f[20 + k] = Math.max(0, b.medium);
      f[24 + k] = Math.max(0, b.cell);
    });
    const P = pal(), c = P.spot.map((x) => x / 255);
    f[28] = c[0]; f[29] = c[1]; f[30] = c[2];
    f[31] = (mode === 2 ? p.fullTint : p.tintAlpha) * this.dayLevel;
    f[32] = c[0]; f[33] = c[1]; f[34] = c[2]; f[35] = p.lineAlpha * P.levels.spot / 0.55;
    f[36] = this.view.dpr; f[37] = Math.max(0.5, p.lineWidth); f[38] = Math.max(0, p.marker); f[39] = Math.max(1, Math.round(p.tintSteps));
    f.set(camera.vec(), 40);   // app: the view camera (drawing only)
    this.device.queue.writeBuffer(this.buffer, 0, this.ab);
  }

  /** The flat tint (under the cells). */
  render(pass) {
    if (!this.on || !this.view) return;
    const p = this.params;
    if (!((this.modeIndex === 2 ? p.fullTint : p.tintAlpha) > 0)) return;
    pass.setPipeline(this.tintPipe);
    pass.setBindGroup(0, this.bg);
    pass.draw(6);
  }

  /** The spot's outline and the marker on its near side (over the cells). */
  renderTop(pass) {
    if (this.modeIndex !== 1 || !this.view || !(this.params.lineAlpha > 0)) return;
    pass.setPipeline(this.linePipe);
    pass.setBindGroup(0, this.bg);
    pass.draw(6);
  }

  /** Short description for the panel: "spot" / "full field" / "off", and the day level. */
  label() {
    const m = this.modeIndex;
    if (!m) return 'light off';
    return `${m === 1 ? 'spot' : 'full field'} · day ${Math.round(this.dayLevel * 100)}%`;
  }

  /** The F overlay's settings line. */
  overlayLine() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), sp = this.view ? this.spot() : { x: 0, y: 0, r: 0 };
    const h = this.hourAt(this.time), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    let s = `light (Shift+L) ${p.mode}: power ${p.power}/100 px²/s · day ${Math.round(this.dayLevel * 100)}% at ` +
      `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (Shift+D cycle ${on(p.day)}, ${p.dayPeriod} s, night ${Math.round(p.dayMin * 100)}%)`;
    if (this.modeIndex === 1) {
      s += ` · spot at ${sp.x.toFixed(0)},${sp.y.toFixed(0)} r ${sp.r.toFixed(0)} px · tilt ${p.tilt.toFixed(0)}° (wheel) · from ${p.az.toFixed(0)}° (Shift+wheel)`;
    } else if (this.modeIndex === 2) {
      s += ` · clouds ${on(p.clouds)} (size ${p.cloudSize} px, depth ${p.cloudDepth})`;
    }
    return s;
  }
}
