// Oils and water (Part C, step C12). The user: "try to build molecules that are polar and apolar; we can simplify their
// charges combining without actual physics".
//
// The chemistry is in src/matter.js (the table: POLARITY from the atoms' charges and where they sit, the new molecules oil
// lL and the amphiphiles glL, tlL, their reactions); the grid's passes in matter.wgsl (oil_rho, oil_blur, the drift in
// spread, the census in count); the look in matter_draw.wgsl. This module holds the switches and knobs (moire.oil.params),
// writes the oil's words of the matter uniform, reads the census back, and gives the OIL panel line, the overlay and
// stats() (droplets, rings, films, from the grid).
//
// PHASE SEPARATION on the grid, every tick (matter.wgsl):
//   rho     each pixel's OIL SHARE: the water-shy mobile matter there (the oil's chained atoms, and the amphiphiles' tails x
//           tailVol) over `full` (the atoms per R^2 that fill a pixel)
//   obar    rho smoothed by a Gaussian of `blur` pixels (at most 1): what a molecule "sees" of the oil around it. The
//           smoothing keeps the pattern above the grid's scale (no checkerboard) and makes the rims round
//   film    each pixel's AMPHIPHILE FILM share: the amphiphiles' atoms over `filmFull`
//   pull    every substance with a polarity is drawn up u = gain x (chi x obar + beta x 4 obar (1 - obar)) (src/matter.js:
//           chi the bulk pull, beta the boundary pull): oil (chi 1) gathers where oil is, polar matter (chi -1: ions, fuels)
//           is pushed out of it, the amphiphiles (beta 2/3) collect where obar is a half, on the oil-water boundary
//   flow    across each edge between two pixels, its spreading and the pull (with the charge's drift, step C6b) as one
//           Scharfetter-Gummel flux, in whole counts and antisymmetric (both pixels of an edge work it out from the same
//           numbers), so matter stays exact; at rest the amounts follow e^u exactly, whichever way round the grid
//   packing what may flow INTO a pixel is x its room: 1 - rho for oil, 1 - film for amphiphiles (at least 0.05): a droplet
//           fills up and then grows in area, a film stays thin
//   skin    oil crossing an edge with a film on it is slowed, k / (1 + skin x the film's mean share there): a coated
//           droplet holds its oil and merges less easily (an emulsion)
// This is a nonlocal Cahn-Hilliard in disguise (the free energy rho ln rho + (1 - rho) ln (1 - rho) - gain/2 rho obar): below
// an oil share of about rho (1 - rho) gain < 1 oil stays dissolved; above it the dish separates into droplets; outside them
// about e^-gain/2 of a full pixel stays dissolved.
//
// MEMBRANE FUSION (cell_eat.wgsl, ChemP fuse; ?fusion=0): the membranes are linker chains, so oily: a cell whose membrane
// is short of linkers takes in the oil under it, each unit opening into l + L in its stock, the battery paying the chain's
// energy (0.75) and its spark (0.375, as heat); the repair then weaves them in. Bursts and deaths spill membranes as free
// linkers, which chain into oil again where l meets L (by the table, no rule of its own).

import { fmt, LEDGER_WORDS } from './heat.js';

// the census numbers (matter.wgsl count, OS_*): 16 slots each
const OS = ['area', 'n1', 'n3', 'nd', 'ampB', 'ampT', 'oilIn', 'edge', 'polIn', 'polT'];
export const OIL_SNAP = 25088;   // LG_OIL_SNAP in heat_common.wgsl
const OIL_FUSE = 25344;          // LG_OIL_FUSE: oil taken into membranes (counts), 16 slots

export class Oil {
  constructor(matter) {
    this.matter = matter;
    // live-tunable (moire.oil.params). Switches: the rules panel's group "Oils and water (step C12)" and URL options.
    this.params = {
      on: true,          // master (?oil=0): the oil's and amphiphiles' reactions, phase separation, the films' look
      phase: true,       // phase separation (?phase=0: oil and everything else only spread)
      amphi: true,       // amphiphiles (?amphi=0): no heads put on or taken off, no boundary pull, no skin
      fusion: true,      // membrane fusion (?fusion=0): a cell short of membrane takes the oil under it in (needs the membrane
                         // chemistry, step C6c, and the cells eating)
      // knobs
      gain: 9,           // the oil's pull, in units of the thermal energy (see the top of this file)
      full: 1.5,         // oil atoms per R^2 that fill a pixel
      blur: 2,           // the smoothing's width (sigma, grid pixels: half a cell radius each): the rim's width, round droplets
      tailVol: 1,        // an amphiphile's tail counts in the oil's share at this weight
      filmFull: 0.6,     // amphiphile atoms per R^2 that make a full film in a pixel
      skin: 4,           // a full film slows the oil crossing it to 1 / (1 + skin)
      kOil: 2,           // R^2 per s: l + L -> lL, before the spark's factor (as kSed)
      kCrack: 0.01,      // optical depth of oil for hard light (cracking it), per unit per R^2 (as kCrack)
      kHead: 1,          // optical depth of a head + oil pair for its band, per pair unit per R^2 (as kMake)
      kUnhead: 0.5,      // per s: a head coming off by heat, before the spark's factor (as kBurn)
      fuseK: 1,          // fusion: the share of a membrane's shortfall taken in from the oil under the cell per s
      spring: 'emulsion',   // what the oil tool drops: 'oil', 'emulsion' (oil + a little soap) or 'soap'
      // the look (matter_draw.wgsl)
      look: true,        // the oil films and soap lines drawn (off: nothing of the oil is drawn)
      polarity: false,   // the polarity view (machinery): polar matter washed warm, apolar cool
      filmAlpha: 0.55,   // the oil film's darkness
      lineW: 1.1,        // the rim's width (device px x about 2)
      irid: 0.7,         // how much the rim's hue drifts (0: plain pale blue)
      gloss: 0.7,        // the film's sheen on the side facing the light
      amphLine: 1.0,     // the soap lines' brightness
      polAlpha: 0.45,    // the polarity view's wash
    };
    this.census = null;
    this.tot = { fused: 0 };   // membrane fusion (src/eat.js books it here)
    this.series = [];          // [time, oil, soap, droplets, mean size, soap at boundaries]
    this.last = null;          // the last stats() result
  }

  /** Whether a part acts (the master and its own switch). */
  rule(k) { return !!(this.params.on && (k === 'on' || this.params[k])); }

  /**
   * The matter uniform's oil words (struct MatterP, from word 100): u = Uint32 view, f = Float32 view; SUB: the table;
   * blocksAt: the oil blocks' word offset; conc: atom-units per R^2 of one count; active: oil or amphiphiles are moving.
   * Returns whether the oil's passes run this frame.
   */
  writeMatter(u, f, SUB, blocksAt, conc, active) {
    const p = this.params, phase = this.rule('phase'), amphi = this.rule('amphi'), run = this.rule('on') && active;
    u[100] = run ? blocksAt : 0;
    u[101] = (phase ? 1 : 0) | (amphi ? 2 : 0);
    f[102] = Math.max(0.3, Math.min(3.2, p.blur)); u[103] = 0;
    f[104] = Math.max(0, p.gain);
    f[105] = conc / Math.max(1e-4, p.full);             // per count: its atoms x this = its share of a full pixel
    f[106] = conc / Math.max(1e-4, p.filmFull);
    f[107] = amphi ? Math.max(0, p.skin) : 0;
    SUB.forEach((s, c) => {
      const mobile = s.spread > 0;
      f[108 + c] = mobile ? s.chi : 0;
      f[124 + c] = mobile && amphi ? s.beta : 0;
      // the oil's volume per count, in atoms: the chained atoms of a mobile water-shy molecule (an amphiphile's x tailVol)
      f[140 + c] = !mobile ? 0 : s.kind === 'amphiphile' ? s.chained * Math.max(0, p.tailVol) : s.chi > 0 ? s.chained : 0;
      u[156 + c] = !mobile ? 0 : s.kind === 'amphiphile' ? 2 : s.chi > 0 ? 1 : 0;   // what fills a pixel: 1 oil, 2 film
    });
    return run;
  }

  /** The chemistry uniform's fusion words (struct ChemP fuse, from word o); up16, spark16: heat counts per unit of oil. */
  writeFuse(f, o, up16, spark16) {
    f[o] = this.fusionOn ? 1 : 0; f[o + 1] = Math.max(0, this.params.fuseK); f[o + 2] = up16; f[o + 3] = spark16;
  }

  /** The heat's ledger read-back (Int32 words; called by src/matter.js apply): the census. */
  apply(rec, w, pxArea) {
    let fz = 0;
    for (let k = 0; k < 16; k++) fz += w[OIL_FUSE + k];
    this.tot.fused += fz / 4096;
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[OIL_SNAP + 16 * q + k]; return s; };
    const x = Object.fromEntries(OS.map((k, j) => [k, v(j)]));
    const M = this.matter, CH = M.CH;
    const euler = (x.n1 - x.n3 - 2 * x.nd) / 4;   // 8-connected droplets minus their holes (Gray's quad counts)
    const oil = M.dish[CH.lL] || 0, soap = (M.dish[CH.glL] || 0) + (M.dish[CH.tlL] || 0);
    const C = {
      time: rec.time, oil, soap, area: x.area * pxArea, euler,
      meanSize: euler > 0 ? x.area * pxArea / euler : 0,
      soapAtEdge: x.ampT > 0 ? x.ampB / x.ampT : 0, oilInDrops: oil > 0 ? Math.min(1, x.oilIn * 16 / 4096 / oil) : 0,
      edge: x.edge * pxArea, polarInOil: x.polT > 0 ? x.polIn / x.polT : 0,
    };
    // membrane fusion (src/eat.js books what the cells took in): per s over the last few s
    const H = this.hist || (this.hist = []);
    H.push([rec.time, this.tot.fused]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    C.fusedRate = dt > 0.05 ? (H[H.length - 1][1] - H[0][1]) / dt : 0;
    C.fused = this.tot.fused;
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) S.push([rec.time, oil, soap, euler, C.meanSize, C.soapAtEdge]);
    while (S.length > 360) S.shift();
  }

  /** The OIL line of the entropy panel ('' while there is no oil anywhere and none was ever made). */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.params.on) return compact ? 'OIL off' : 'OIL  off (?oil=0)';
    if (!C || (C.oil + C.soap < 1e-3 && !this.everOil)) return compact ? 'OIL –' : 'OIL  none yet (the oil tool drops some; l and L chain into it where they meet)';
    this.everOil = true;
    const drops = C.euler > 0.5 ? `${Math.round(C.euler)}` : '0';
    const size = C.euler > 0.5 ? ` (${C.meanSize.toFixed(1)} R²)` : '';
    const fz = this.fusionOn ? ` · fused ${fmt(C.fusedRate)}/s` : '';
    if (compact) return `OIL ${fmt(C.oil)} · soap ${fmt(C.soap)} · drops ${drops}${size}`;
    return `OIL  oil ${fmt(C.oil)} · soap ${fmt(C.soap)} · droplets ~${drops}${size} · oil in droplets ${(100 * C.oilInDrops).toFixed(0)}%` +
      ` · soap on boundaries ${(100 * C.soapAtEdge).toFixed(0)}%${fz}`;
  }

  /** Fusion acts: its switch, the master, the cells eating and the membrane chemistry on. */
  get fusionOn() { const E = this.matter.eat; return !!(this.rule('fusion') && E && E.params.on && E.membrane && E.membrane.rule('on')); }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const M = this.matter, S = M.SUBSTANCES || [];
    const lines = [];
    lines.push(`oils and water (step C12): ${on(p.on)} · phase separation ${on(this.rule('phase'))} · amphiphiles ${on(this.rule('amphi'))}` +
      ` · fusion ${on(this.fusionOn)} · gain ${p.gain} · full ${p.full} atoms/R² · tail ${p.tailVol} · film ${p.filmFull} atoms/R² · skin ${p.skin}` +
      ` · k oil ${p.kOil}, crack ${p.kCrack}, head ${p.kHead}, unhead ${p.kUnhead}/s · oil tool drops ${p.spring}`);
    lines.push('polarity (from the atoms: charged = water-loving, chained linkers = water-shy): ' + S.filter((s) => s.polarity !== 'neutral')
      .map((s) => `${s.name} ${s.polarity} (chi ${+s.chi.toFixed(2)}${s.beta ? `, boundary ${+s.beta.toFixed(2)}` : ''})`).join(' · '));
    if (C) {
      lines.push(`oil census: oil ${fmt(C.oil)} · soap ${fmt(C.soap)} · oily area ${fmt(C.area)} R² · droplets (Euler) ${C.euler.toFixed(1)}` +
        ` · mean ${C.meanSize.toFixed(2)} R² · boundary ${fmt(C.edge)} R² · soap on boundaries ${(100 * C.soapAtEdge).toFixed(0)}%` +
        ` · polar matter inside oil ${(100 * C.polarInOil).toFixed(1)}% · fused ${fmt(C.fused)} (${fmt(C.fusedRate)}/s)` +
        (this.last ? ` · last stats(): ${this.last.droplets} droplets, ${this.last.rings} rings, largest ${this.last.largest.toFixed(1)} R²` : ''));
    }
    return lines;
  }

  /**
   * Droplets from the grid (CPU, a read-back): the pixels whose oil share rho is at least `level` (0.5), joined with their 8
   * neighbours into droplets; holes (the water left inside a droplet, not touching the dish's edge, 4-connected) make it a
   * RING (a vesicle-like compartment). Also where the amphiphiles sit. Resolves to { droplets, rings, sizes (R², largest
   * first), largest, mean, area, soapAtEdge, soapInside, soapOutside }.
   */
  async stats(level = 0.5) {
    const M = this.matter, H = M.heat, d = M.device, n = H.n, hw = H.hw, hh = H.hh;
    const CH = M.CH, base = (LEDGER_WORDS + M.copyBase(M.cur)) * 4;
    const read = async (c) => {
      const buf = d.createBuffer({ size: n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(H.buffer, base + c * n * 4, buf, 0, n * 4);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = new Int32Array(buf.getMappedRange().slice(0));
      buf.unmap(); buf.destroy();
      return out;
    };
    const [oil, ga, ta] = await Promise.all([read(CH.lL), read(CH.glL), read(CH.tlL)]);
    const p = this.params, a = H.px / H.R, conc = 1 / (4096 * a * a), pxA = a * a;
    const rho = new Float32Array(n), soap = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      soap[i] = (ga[i] + ta[i]) * 3 * conc;
      rho[i] = (oil[i] * 2 * conc + soap[i] * (2 / 3) * p.tailVol) / p.full;
    }
    const lab = new Int32Array(n).fill(-1), sizes = [];
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (rho[i] < level || lab[i] >= 0) continue;
      const id = sizes.length;
      let cnt = 0;
      lab[i] = id; stack.push(i);
      while (stack.length) {
        const j = stack.pop(); cnt++;
        const x = j % hw, y = (j / hw) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= hw || Y >= hh) continue;
            const k = Y * hw + X;
            if (lab[k] < 0 && rho[k] >= level) { lab[k] = id; stack.push(k); }
          }
        }
      }
      sizes.push(cnt);
    }
    // holes: 4-connected water patches that do not touch the edge, and the droplet around them
    const seen = new Uint8Array(n), ringOf = new Set();
    for (let i = 0; i < n; i++) {
      if (rho[i] >= level || seen[i]) continue;
      let edge = false, around = -1, mixed = false;
      seen[i] = 1; stack.push(i);
      while (stack.length) {
        const j = stack.pop();
        const x = j % hw, y = (j / hw) | 0;
        if (x === 0 || y === 0 || x === hw - 1 || y === hh - 1) edge = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= hw || Y >= hh) continue;
          const k = Y * hw + X;
          if (rho[k] >= level) { if (around < 0) around = lab[k]; else if (lab[k] !== around) mixed = true; }
          else if (!seen[k]) { seen[k] = 1; stack.push(k); }
        }
      }
      if (!edge && around >= 0 && !mixed) ringOf.add(around);
    }
    // where the soap sits: on the boundary (0.15 < rho < 0.85, or an oil pixel next to water), inside, outside
    let sB = 0, sI = 0, sO = 0;
    for (let i = 0; i < n; i++) {
      if (soap[i] <= 0) continue;
      const r = rho[i];
      if (r > 0.15 && r < 0.85) sB += soap[i]; else if (r >= 0.85) sI += soap[i]; else sO += soap[i];
    }
    const sT = sB + sI + sO;
    const R2 = sizes.map((c) => c * pxA).sort((x, y) => y - x);
    const area = R2.reduce((x, y) => x + y, 0);
    const out = {
      time: M.time, droplets: R2.length, rings: ringOf.size, sizes: R2.slice(0, 40), largest: R2[0] || 0,
      mean: R2.length ? area / R2.length : 0, area, soapAtEdge: sT ? sB / sT : 0, soapInside: sT ? sI / sT : 0, soapOutside: sT ? sO / sT : 0,
      oil: M.dish[CH.lL], soap: M.dish[CH.glL] + M.dish[CH.tlL],
    };
    this.last = out;
    return out;
  }
}
