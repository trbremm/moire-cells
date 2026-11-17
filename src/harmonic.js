// Step H1: the HARMONIC look (user, 2026-11-16: "one of my original inspirations are these higher harmonic microscopy
// images"; then "they don't need to be strictly like that, just the general look"). An alternative way to draw the dish,
// beside the neon look (which stays the default): as a multiphoton microscope image of tissue. Black ground; three
// detector channels that ADD (overlaps go yellow, pink, white); thin bright green rims round dark insides (a packed tissue
// reads as a green honeycomb); orange-yellow fibrous texture where the crust lies; violet wisps where there is fuel and in
// busy cells; a scanned image's slight softness and photon grain; a scale bar. Drawing only: the simulation is untouched.
//
// The channels and what they mean (src/palette.js HARMONIC; by the physics of each signal):
//   green   (third harmonic: lights up where the material changes, at INTERFACES) the cells' membranes, brighter the more
//           lipid each side holds (its integrity) and a little more with oil in it; oil
//           droplets' rims and soap films in the dish
//   orange  (second harmonic: lights up in ORDERED, non-centrosymmetric fibres such as collagen and myosin) the crust as a
//           dense fibrous texture, the fibres following the crust's own outlines and, where it is even, a slow swirl from
//           the moire beat of the medium's lattice against a copy of itself turned by `swirlAngle` (the hidden machinery
//           field, shown as collagen-like swirls); crust walls round cells; stretched cells as streaks along their
//           stretch; a PREDATOR's striations across its long axis (actomyosin: engulfing is contractile work) and a BUILDER's
//           fibrous matrix (collagen-like), each as strongly as the job shows (step F0, src/jobs.js; muscle's and cartilage's,
//           and a neuron's doubled green rim, until then). Heavy chains deeper
//           and redder, light ones yellower, dense crust brightest
//   violet  (autofluorescence: NADH, FAD; METABOLISM) fuel in the dish as a soft wispy haze, a cell's battery as a soft
//           glow at its centre, its engines as faint granules, and the whole inside a little brighter the busier the cell
//           (its battery changing fast either way, as the neon hum)
// Free atoms, trace and the excited haze are not drawn (no channel for them); the fluorescence glow (C12d) keeps its band
// colours (it IS fluorescence), the minerals are faint orange dust (crystals are ordered), springs and the spot's outline
// are quiet grey. Not drawn under this look: the ripple background, neon halos, light trails, hum, flicker.
//
// Switches: the View panel's "harmonic look" (and its blur, grain and scale bar), key ` (backquote; the key left of 1, by
// its place, so it works on every layout), URL ?look=harmonic (also ?look=neon, ?look=flat), ?grain=0, ?blur=0, ?scalebar=0.
// Knobs live: moire.harmonic.params (see below).
//
// The drawing itself: src/neon.js runs the frame (cleared to black, no halo, no trails), src/cells.js and cell_draw.wgsl
// (fs_harm) draw the cells, src/matter.js and matter_draw.wgsl (fs_harm) the substances, src/shaders/harmonic.wgsl the
// last pass (blur, grain, shoulder) onto the canvas. The scale bar is the app's (src/app.js), in every look.

import { loadShader } from './gpu.js';
import { LOOK, HARMONIC } from './palette.js';
import { camera } from './camera.js';   // app: the view camera (the rim's width under the zoom)

export class Harmonic {
  constructor(device, canvasFormat) {
    this.device = device;
    this.canvasFormat = canvasFormat;
    this.params = {
      // the last pass (src/shaders/harmonic.wgsl)
      blur: true,        // slight softness (View panel)
      blurMix: 0.55,     // ... its share of the tent-blurred picture
      grain: true,       // photon grain (View panel)
      grainAmt: 0.075,   // ... its size at a full signal (it grows with sqrt(signal))
      dark: 0.018,       // ... dark noise on the black
      rate: 24,          // ... new grain patterns per s (a live scan)
      gain: 1.0,         // the picture's brightness
      shoulder: 0.78,    // light above this rolls off toward white
      scalebar: true,    // the scale bar (View panel)
      // the cells (cell_draw.wgsl fs_harm)
      rim: 1.15,         // the green rim's brightness at a whole, lipid-rich membrane
      rimBase: 0.6,      // ... a side with no membrane at all (the cell's edge is still an interface), share of rim
      rimW: 0.9,         // ... its width (CSS px; at most 0.3 of a small cell's radius)
      oilRim: 0.35,      // ... brighter by up to this share with oil in the bilayer
      inside: 0.9,       // the inside's opacity (dark: what lies under a cell is hidden)
      insideTint: 0.03,  // ... its faint green
      bat: 0.25,         // violet: a full battery's glow at the centre (a soft spot, half the neon core's size)
      busy: 0.12,        // violet: the whole inside at the busiest (activity, as the hum's)
      parts: 0.5,        // violet: the engines' granules
      stretchFib: 0.55,  // orange: streaks along the stretch, at a strong stretch
      striations: 0.3,   // orange: a predator's striations (step F0; muscle's until then)
      matrix: 0.35,      // orange: a builder's matrix (step F0; cartilage's until then)
      wall: 0.9,         // orange: a crust wall round a cell
      gap: 0,            // the rim's gap from the cell's wall, as a share of the neon tubes' (0: neighbours share one green wall)
      // the dish (matter_draw.wgsl fs_harm)
      crust: 1.2,        // orange: the crust's fibres at a dense crust
      crustHalf: 1.5,    // ... the crust (per R^2, in units of the halftone's sediment step) at half brightness
      fibreLen: 14,       // ... a fibre's length (CSS px) ...
      fibreW: 1.5,       // ... and width
      swirl: 0.6,        // ... the moire swirl's weight in the fibres' direction where the crust is even (0 = none)
      swirlAngle: 2.2,   // ... the second lattice's turn (degrees): the beat's period is about the medium's / this angle
      fuel: 0.4,         // violet: the fuel haze at a rich spot
      fuelHalf: 0.25,    // ... the fuel (per R^2, in units of the dots' half) at half brightness (the dish holds little: 0.02 to 0.1 per R^2)
      oil: 0.85,         // green: oil droplets' rims (and soap films)
      oilFill: 0.06,     // ... a droplet's inside
      minerals: 0.35,    // orange: minerals as faint dust
      springs: 0.3,      // springs' markers, quiet grey
    };
    this.onBar = null;   // the scale bar's refresh (src/app.js)
  }

  get on() { return LOOK.harmonic; }
  set on(v) { LOOK.harmonic = !!v; this.showBar(); }

  static async create(device, canvasFormat) {
    const h = new Harmonic(device, canvasFormat);
    await h.init();
    return h;
  }

  async init() {
    const d = this.device;
    const mod = await loadShader(d, 'src/shaders/harmonic.wgsl');
    this.pipe = d.createRenderPipeline({
      label: 'harmonic post', layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] },
      primitive: { topology: 'triangle-list' },
    });
    this.sampler = d.createSampler({ label: 'harmonic', magFilter: 'linear', minFilter: 'linear' });
    this.u = d.createBuffer({ label: 'harmonic post', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  /** The last pass: the light buffer (lightView, w x h device px) onto the canvas. time: real s (the grain's clock). */
  encode(encoder, canvasView, lightView, w, h, time) {
    const P = this.params, d = this.device;
    if (lightView !== this.lightView) {
      this.lightView = lightView;
      this.bg = d.createBindGroup({
        layout: this.pipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: lightView }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.u } }],
      });
    }
    const seed = P.grain ? Math.floor(time * Math.max(0.1, P.rate)) % 4096 : 0;
    d.queue.writeBuffer(this.u, 0, new Float32Array([P.blur ? P.blurMix : 0, P.grain ? P.grainAmt : 0, P.grain ? P.dark : 0, seed * 1.37,
      P.gain, P.shoulder, 1 / w, 1 / h]));
    const pass = encoder.beginRenderPass({
      label: 'harmonic post', colorAttachments: [{ view: canvasView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bg);
    pass.draw(3);
    pass.end();
  }

  /**
   * The cells' words of struct Draw (cell_draw.wgsl: harm, harm2, harm3, harm4, hInk[5]) from float o. Zoomed in, the rim widens
   * on screen only with the square root of the zoom (rimW is its width at zoom 1), so it stays a thin line: x 2 at zoom 4.
   */
  writeCells(a, o) {
    const P = this.params, I = HARMONIC.harm;
    a[o] = P.rim; a[o + 1] = P.rimBase; a[o + 2] = Math.max(0.3, P.rimW) / Math.sqrt(camera.z); a[o + 3] = P.oilRim;
    a[o + 4] = P.inside; a[o + 5] = P.insideTint; a[o + 6] = P.bat; a[o + 7] = P.busy;
    a[o + 8] = P.parts; a[o + 9] = P.stretchFib; a[o + 10] = P.striations; a[o + 11] = P.matrix;
    a[o + 12] = P.wall; a[o + 13] = Math.max(0, P.gap); a[o + 14] = 0; a[o + 15] = 0;
    [I.green, I.orange, I.yellow, I.red, I.violet].forEach((rgb, k) => {
      for (let j = 0; j < 3; j++) a[o + 16 + 4 * k + j] = rgb[j] / 255;
      a[o + 19 + 4 * k] = 0;
    });
  }

  /** The dish's words of struct DrawP (matter_draw.wgsl: hm, hm2, hm3, hInk[6]) from float o. sedStep, half: the halftone's. */
  writeMatter(a, o, sedStep, half) {
    const P = this.params, I = HARMONIC.harm;
    a[o] = P.crust; a[o + 1] = Math.max(1e-4, P.crustHalf * sedStep); a[o + 2] = Math.max(1, P.fibreLen); a[o + 3] = Math.max(0.3, P.fibreW);
    a[o + 4] = P.swirl; a[o + 5] = P.swirlAngle * Math.PI / 180; a[o + 6] = P.fuel; a[o + 7] = Math.max(1e-4, P.fuelHalf * half);
    a[o + 8] = P.oil; a[o + 9] = P.oilFill; a[o + 10] = P.minerals; a[o + 11] = P.springs;
    [I.green, I.orange, I.yellow, I.red, I.violet, I.blue].forEach((rgb, k) => {
      for (let j = 0; j < 3; j++) a[o + 12 + 4 * k + j] = rgb[j] / 255;
      a[o + 15 + 4 * k] = 0;
    });
  }

  // ---------- the scale bar ----------
  // (merged with the app's: one scale bar, src/app.js, that follows the zoom in every look, a cell 12 um across as in the CPU
  // version; params.scalebar (View panel, ?scalebar=0) shows or hides it in every look. onBar: src/app.js's refresh.)
  showBar() { if (this.onBar) this.onBar(); }

  // ---------- switches ----------
  toggle() {
    this.on = !this.on;
    return this.on
      ? 'harmonic look: the dish as a multiphoton microscope image (green = interfaces, membranes and oil rims; orange = ordered fibres, crust and stretched cells; violet = metabolism, fuel and busy cells)'
      : `${LOOK.neon ? 'neon' : 'flat'} look`;
  }

  label() {
    const P = this.params;
    return `harmonic · blur ${P.blur ? 'on' : 'off'} · grain ${P.grain ? 'on' : 'off'} · scale bar ${P.scalebar ? 'on' : 'off'}`;
  }
}
