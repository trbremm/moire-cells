// Step P1: PREDATORS, ENGULFING AND KIN SPARING (BUILD QUEUE 5, 2026-11-17; README "Step P1: predators"). The user: "I think it's fair to add
// those genes, right? It is a gigantic level of abstraction anyways." and "Cannibalism should select itself off. But then they need to be able
// to tell its genetic proximity to each other." Predation is the missing PRESSURE TO LINK (algae evolve clumps under a predator that eats
// single cells): a cell glued into a tissue holds on, so a clump acts as one big cell. Every piece its own switch (the rules panel's group
// "Predators (step P1)", URL options); no rule names a predator:
//
//   ENGULF (gene Bio.kin.z, 0..1)   a cell may start to WRAP a touching cell when (a) it is bigger, area ratio >= sizeRatio; (b) its DRIVE beats
//                    the other's HOLD: drive x engulf (as expressed: x the gene network's 17th output) x (1 - spare x kinship) > the prey's
//                    glue to its touching neighbours (the C10/C11 glue, less this pair's own) + its ARMOUR (wallArm x its crust wall's cover
//                    + stiffArm x its membrane's stiffness above the softest, C12b) + holdBase; (c) it can pay: a battery of batStart (the
//                    start costs startCost, the wrap wrapCost per s, from the battery as heat) and a membrane of integMin. The wrap takes
//                    wrapTime s: the prey is pulled in (pull), the pair's contact push softens and their walls give way; it ESCAPES if it
//                    slips out of reach, its hold rises above the drive (or it grows too big), or the predator runs out (battery batKeep,
//                    membrane integMin / 2). Once the wrap closes the prey dies (C9's alive flag: a death by being EATEN) and its slot
//                    becomes a GHOST: its stock, membrane and battery are the meal, the predator's phagosome
//   DIGESTION        over digestTime s the meal moves into the host (the eat pass): its atoms and fuels into the stock as far as there is
//                    room, its membrane weave and pigment as their atoms, its lipids into the host's own membrane (recycled), its battery a
//                    share batShare into the host's battery (the rest heat); at the catch a share wrapShare (x the prey's perimeter over the
//                    host's) of the host's own bilayer goes round the meal (and comes back with it). What finds no room spills into the dish
//                    at the end. A host that dies spills its meal where it is. Matter, charge and energy exact
//   KIN SPARING (gene Bio.kin.w, 0..1)   the drive x (1 - spare x kinship), kinship the T1a marker's moire match (display as expressed):
//                    early predators are cannibals (founders 0); sparing must pay to spread. Hiding the marker (display) evades recognition
//                    both ways (mimicry, camouflage)
//   GENE NETWORK     an output ENGULF (the 17th: gain Bio.gm.z, regulator gm.w) and two senses: MEAL (digesting: the share left) and PREY
//                    (a cell it could engulf touches it)
//   CONTROLS         ?engulfnull=1 the NEUTRAL control (the genes drift, nothing is ever engulfed); ?kinsparenull=1 kinship ignored (the
//                    sparing gene drifts without effect); ?engulf=0 off (old snapshots: off). Only with the changing count (division, C9)
//
// This module: the switches and knobs (moire.predators.params, .look), the step's words (Fields p1..p1d), the eat pass's (EatP p1), the
// drawing's (Draw p1, p1Ink), the counters (Stats.p1: the step's events and census; the eat pass's in the T1a counter block 4..13), a census
// of CLUSTERS every censusEvery s (a read-back: groups of cells in mutual contact), the PREDATION panel line, overlay lines, and the
// hand-made predator (genome(), place()).

import { fmt, HEAT_SCALE } from './heat.js';
import { CELL_FLOATS } from './cells.js';
import { readBuffer } from './snapshot.js';
import { predatorGenome } from './genome.js';

export const STATS_P1 = 9024;   // byte offset of Stats.p1 in struct Stats (cell_common.wgsl)
export const P1_WORDS = 64;
export const P1_CLEAR = 16;     // the census's first word (16 words cleared every frame)
const P1F = { ON: 1, NULL: 2, KINNULL: 4 };
const LG_T1 = 31488;            // heat_common.wgsl: the T1a block; its counters at + 512 (16 counters x 16 slots), P1's are 4..13
const PC = ['paid', 'atoms', 'lipid', 'bat', 'heat', 'spill', 'meals', 'wrapm', 'void', 'orphan'];
const PS = ['start', 'lost', 'held', 'poor', 'eaten', 'kin', 'alone', 'hold', 'area', 'kinSum'];
const PZ = ['n', 'e', 'e2', 's', 's2', 'carry', 'sparer', 'wrap', 'digest', 'wrapped', 'expr', 'sc', 'near', 'hold', 'glue', 'arm'];
const C_FLAGS = 9, C_NBR = 60, C_ENGBY = 89;

export class Predators {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.predators.params). Switches: the rules panel's group "Predators (step P1)"; URL ?engulf=0, ?engulfnull=1,
    // ?kinsparenull=1, and the knobs by name (?sizeratio= ?drive= ?wraptime= ?digesttime= ...)
    this.params = {
      on: true,          // engulfing (master)
      null: false,       // the NEUTRAL control: the genes drift, nothing is ever engulfed (?engulfnull=1)
      kinNull: false,    // kin sparing's control: kinship ignored (?kinsparenull=1)
      sizeRatio: 1.4,    // the area a predator needs over its prey's
      drive: 3,          // the drive at engulf gene 1 (against a hold: glue to neighbours ~0.5 .. 1.5 each, armour up to wallArm + stiffArm)
      holdBase: 0.25,    // the hold every cell has
      wallArm: 2,        // a full crust wall's armour
      stiffArm: 1,       // the stiffest membrane's armour (x (k - 1) / (kmax - 1))
      wrapTime: 3,       // s a wrap takes
      digestTime: 8,     // s a digestion takes
      startRate: 1,      // chance per s to start a wrap while a prey touches
      batStart: 0.25,    // battery share needed to start
      batKeep: 0.05,     // ... to go on
      integMin: 0.3,     // the membrane's mean integrity needed to start (half of it to go on)
      startCost: 0.05,   // the start's cost, battery shares
      wrapCost: 0.03,    // the wrap's cost, battery shares per s
      pull: 1,           // R per s a full wrap pulls the prey in
      soften: 0.85,      // how much the pair's contact push softens at a full wrap
      wrapShare: 0.4,    // the share of the host's bilayer that wraps the meal (x the prey's perimeter over the host's)
      batShare: 0.5,     // the share of the meal's battery that goes to the host's battery (the rest heat)
      censusEvery: 15,   // s of simulated time between the clusters' read-backs (0: never)
    };
    // the look (moire.predators.look; drawing only)
    this.look = {
      draw: true,        // the wrap's arms round the prey and the phagosome inside the host
      arm: 0.35,         // the arms' reach outside the prey (share of its radius)
      ghost: 0.75,       // the meal's ghost brightness (neon)
      ring: 1,           // the phagosome ring's brightness
      mark: false,       // the machinery: a small dark notch in engulf-capable cells (diagnostic)
      inkH: [190, 80, 255],   // harmonic: the phagosome's violet glow
    };
    this.tot = Object.fromEntries(PC.map((k) => [k, 0]));
    this.hist = [];
    this.shist = [];
    this.counts = null;
    this.census = null;
    this.clusters = null;
    this.series = [];   // every 10 s: [time, cells, carriers, engulf mean, spare mean, meals/s, kin share of meals, alone share, in clumps >= 8]
    this.busy = false;
    this.lastAt = -1e9;
  }

  get flags() {
    const p = this.params;
    return (p.on ? P1F.ON : 0) | (p.null ? P1F.NULL : 0) | (p.kinNull ? P1F.KINNULL : 0);
  }

  /** The step's words (struct Fields p1, p1b, p1c, p1d from word o). */
  writeFields(u, f, o) {
    const p = this.params, bc = this.cells.eat ? this.cells.eat.batCounts : 1;
    u[o] = this.flags; f[o + 1] = Math.max(1, p.sizeRatio); f[o + 2] = Math.max(0, p.drive); f[o + 3] = Math.max(0, p.holdBase);
    f[o + 4] = Math.max(0.05, p.wrapTime); f[o + 5] = Math.max(0.05, p.digestTime); f[o + 6] = Math.max(0, p.startRate); f[o + 7] = Math.max(0, p.wallArm);
    f[o + 8] = Math.max(0, p.stiffArm); f[o + 9] = Math.max(0, p.batStart); f[o + 10] = Math.max(0, p.batKeep); f[o + 11] = Math.max(0, p.pull);
    f[o + 12] = Math.max(0, p.integMin); f[o + 13] = Math.max(0, p.wrapCost) * bc; f[o + 14] = Math.max(0, p.startCost) * bc;
    f[o + 15] = Math.max(0, Math.min(1, p.soften));
  }
  /** The eat pass's words (EatP p1[2], from word o). */
  writeEat(u, f, o) {
    const p = this.params;
    f[o] = 0; f[o + 1] = Math.max(0, Math.min(1, p.wrapShare)); f[o + 2] = Math.max(0, Math.min(1, p.batShare)); f[o + 3] = Math.max(0.05, p.digestTime);
    f[o + 4] = 0; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  }
  /** The drawing's words (struct Draw p1, p1Ink, from word o). */
  writeDraw(a, o) {
    const K = this.look;
    a[o] = K.draw ? 1 : 0; a[o + 1] = Math.max(0, K.arm); a[o + 2] = Math.max(0, K.ghost); a[o + 3] = K.mark ? 1 : 0;
    for (let k = 0; k < 3; k++) a[o + 4 + k] = K.inkH[k] / 255;
    a[o + 7] = Math.max(0, K.ring);
  }

  /** The step's counters and census (Stats.p1, read back with the cells' stats). */
  applyStats(time, u) {
    const S = Object.fromEntries(PS.map((k, q) => [k, u[q]]));
    const Z = Object.fromEntries(PZ.map((k, q) => [k, u[P1_CLEAR + q]]));
    const H = this.shist;
    H.push([time, ...PS.map((k) => S[k])]);
    while (H.length > 2 && time - H[1][0] >= 10) H.shift();
    if (H.length && time < H[0][0]) H.length = 0;
    const dt = H.length ? time - H[0][0] : 0;
    const rate = Object.fromEntries(PS.map((k, j) => [k, dt > 0.2 ? ((H[H.length - 1][1 + j] - H[0][1 + j]) >>> 0) / dt : 0]));
    const n = Math.max(1, Z.n), car = Math.max(1, Z.carry);
    const eMean = Z.e / 1000 / n, sMean = Z.s / 1000 / n;
    const dEaten = (H[H.length - 1][5] - H[0][5]) >>> 0;
    const C = {
      time, n: Z.n,
      genes: { engulf: eMean, engulfSd: Math.sqrt(Math.max(0, Z.e2 / 1000 / n - eMean * eMean)), spare: sMean,
        spareSd: Math.sqrt(Math.max(0, Z.s2 / 1000 / n - sMean * sMean)), carriers: Z.carry / n, sparers: Z.carry ? Z.sparer / car : null,
        carrierSpare: Z.carry ? Z.sc / 1000 / car : null, expressed: Z.expr / 1000 / n, glue: Z.glue / 1000 / n },
      now: { wrapping: Z.wrap, digesting: Z.digest, wrapped: Z.wrapped, preyNear: Z.near, hold: Z.hold / 1000 / n, armour: Z.arm / 1000 / n },
      total: S,
      rate: { starts: rate.start, escapes: rate.lost + rate.held + rate.poor, lost: rate.lost, held: rate.held, poor: rate.poor, meals: rate.eaten },
      // of the meals in the last ~10 s: kin share (cannibalism of relatives), single cells' share, the prey's mean hold, area, kinship
      recent: dEaten ? {
        meals: dEaten, kin: ((H[H.length - 1][6] - H[0][6]) >>> 0) / dEaten, alone: ((H[H.length - 1][7] - H[0][7]) >>> 0) / dEaten,
        hold: ((H[H.length - 1][8] - H[0][8]) >>> 0) / 1000 / dEaten, area: ((H[H.length - 1][9] - H[0][9]) >>> 0) / 1000 / dEaten,
        kinship: ((H[H.length - 1][10] - H[0][10]) >>> 0) / 1000 / dEaten } : null,
      // since the page started: the share of all meals that were kin, single cells
      all: S.eaten ? { kin: S.kin / S.eaten, alone: S.alone / S.eaten, hold: S.hold / 1000 / S.eaten, area: S.area / 1000 / S.eaten, kinship: S.kinSum / 1000 / S.eaten } : null,
    };
    this.census = Object.assign(this.census || {}, C);
    if (this.counts) this.census.digest = this.counts;
    if (this.clusters) this.census.clusters = this.clusters;
    const Sr = this.series, last = Sr[Sr.length - 1];
    if (last && time < last[0]) Sr.length = 0;
    if (Z.n && (!Sr.length || time - Sr[Sr.length - 1][0] >= 10)) {
      const cl = this.clusters;
      Sr.push([time, Z.n, C.genes.carriers, eMean, sMean, rate.eaten, C.recent ? C.recent.kin : null, C.recent ? C.recent.alone : null, cl ? cl.in8 : null]);
      if (Sr.length > 600) Sr.shift();
    }
  }

  /** The eat pass's counters (through src/eat.js's ledger read-back: the T1a counter block, counters 4..13). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_T1 + 512 + 16 * q + k]; return s; };
    const T = this.tot;
    PC.forEach((k, j) => { T[k] += v(4 + j); });
    const H = this.hist;
    H.push([rec.time, ...PC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 5) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const A = 4096;   // atom counts per unit (ATOM_SCALE); energy in HEAT_SCALE counts per unit; lipids and meals as counts
    const per = (j, sc) => (dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt / sc : 0);
    const r = Object.fromEntries(PC.map((k, j) => [k, per(j, /^(paid|bat|heat)$/.test(k) ? HEAT_SCALE : /^(atoms|spill|lipid|wrapm)$/.test(k) ? A : 1)]));
    this.counts = { total: Object.fromEntries(PC.map((k) => [k, /^(paid|bat|heat)$/.test(k) ? T[k] / HEAT_SCALE : /^(atoms|spill|lipid|wrapm)$/.test(k) ? T[k] / A : T[k]])), rate: r };
    if (this.census) this.census.digest = this.counts;
  }

  /** Once a frame: start the clusters' read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.readClusters(time).catch((e) => { console.warn('predators census:', e); });
  }

  /**
   * CLUSTERS: cells in mutual contact (each lists the other across a side, Cell.nbr: the step's touching neighbours) joined into groups
   * (union-find). Sizes, the share of cells in clusters of 8 and more, single cells, contacts per cell, and the ghosts (meals) now.
   */
  async readClusters(time = this.lastAt) {
    if (this.busy) return this.clusters;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count, CF = CELL_FLOATS;
      const u = new Uint32Array(await readBuffer(d, C.cellBuf, 0, n * CF * 4));
      const live = new Uint8Array(n);
      let m = 0, ghosts = 0;
      for (let i = 0; i < n; i++) {
        if (u[i * CF + C_FLAGS] & 1) { live[i] = 1; m++; } else if (((u[i * CF + C_ENGBY] >>> 24) & 3) === 2) ghosts++;
      }
      const par = new Int32Array(n).map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const lists = (i) => { const o = i * CF + C_NBR, a = []; for (let w = 0; w < 3; w++) { a.push(u[o + w] & 0xffff, u[o + w] >>> 16); } return a; };
      let pairs = 0;
      for (let i = 0; i < n; i++) {
        if (!live[i]) continue;
        for (const j of lists(i)) {
          if (j === 0xffff || j >= n || j <= i || !live[j]) continue;
          if (!lists(j).includes(i)) continue;
          pairs++;
          const a = find(i), b = find(j);
          if (a !== b) par[a] = b;
        }
      }
      const size = new Map();
      for (let i = 0; i < n; i++) if (live[i]) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); }
      const sizes = [...size.values()].sort((a, b) => b - a);
      const bins = [1, 2, 4, 8, 16, 32, 64, 128, Infinity];
      const hist = new Array(bins.length).fill(0);   // cells in clusters of size [bins[k-1]+1 .. bins[k]] (k = 0: singles)
      let in8 = 0, singles = 0, wsum = 0;
      for (const s of sizes) {
        const k = bins.findIndex((b) => s <= b);
        hist[k] += s;
        if (s >= 8) in8 += s;
        if (s === 1) singles++;
        wsum += s * s;
      }
      this.clusters = { time, n: m, clusters: sizes.length, largest: sizes[0] || 0, top: sizes.slice(0, 8), in8: m ? in8 / m : 0, singles: m ? singles / m : 0,
        meanSize: m ? wsum / m : 0, perCell: m ? 2 * pairs / m : 0, ghosts, hist: { bins: bins.map((b) => (Number.isFinite(b) ? b : 'more')), cells: hist } };
      if (this.census) this.census.clusters = this.clusters;
      return this.clusters;
    } finally {
      this.busy = false;
    }
  }
  /** The clusters now (a fresh read-back; for the console and the experiments' evals). */
  clustersNow() { return this.readClusters(this.lastAt); }

  /**
   * For pictures: centre the view (zoom z) on a cell being WRAPPED (what 'wrap'; the furthest wrap) or a host DIGESTING (what 'digest'; the
   * freshest meal). Returns { x, y, progress } or null when there is none.
   */
  async focus(what = 'wrap', z = 5) {
    const C = this.cells, n = C.count, CF = CELL_FLOATS;
    const ab = await readBuffer(C.device, C.cellBuf, 0, n * CF * 4), u = new Uint32Array(ab), f = new Float32Array(ab);
    let best = -1, bp = -1;
    for (let i = 0; i < n; i++) {
      const o = i * CF;
      if (!(u[o + C_FLAGS] & 1)) continue;
      let p = -1;
      if (what === 'wrap' && ((u[o + C_ENGBY] >>> 24) & 3) === 1) p = ((u[o + C_ENGBY] >>> 16) & 255) / 255;
      if (what === 'digest' && (u[o + 88] & 3) === 2) p = 1 - ((u[o + 88] >>> 4) & 4095) / 4095;
      if (p > bp) { bp = p; best = i; }
    }
    if (best < 0) return null;
    const x = f[best * CF], y = f[best * CF + 1];
    if (window.moire && window.moire.camera) window.moire.camera.set(z, x, y);
    return { x, y, progress: what === 'wrap' ? bp : 1 - bp };
  }

  /** A hand-made predator's genome (the add-cell tool, the cells zoo): { engulf, spare, size }. */
  genome(opts = {}) { return predatorGenome(opts); }

  /** Place predators: `points` in dish coordinates, or a number of them at random over the dish (opts as genome()). */
  async place(points = 20, opts = {}) {
    const app = window.moire && window.moire.app;
    if (!app) throw new Error('the app is not ready');
    let pts = points;
    if (typeof points === 'number') {
      const v = this.cells.view, mg = 4 * this.cells.R;
      pts = Array.from({ length: points }, () => [mg + Math.random() * (v.cssW - 2 * mg), mg + Math.random() * (v.cssH - 2 * mg)]);
    }
    return app.place(pts, this.genome(opts), 'predator');
  }

  /** The entropy panel's PREDATION line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census;
    const ctl = !p.on ? ' (off)' : p.null ? ' · NULL' : p.kinNull ? ' · KIN-NULL' : '';
    if (!C || !C.n) return `PREDATION${ctl}  …`;
    const pc = (x) => (x == null ? '-' : `${Math.round(100 * x)}%`), f2 = (x) => (x == null ? '-' : x.toFixed(2));
    const r = C.rate, rc = C.recent, cl = C.clusters;
    if (compact) return `PREDATION${ctl} meals ${fmt(r.meals)}/s · kin ${pc(rc ? rc.kin : C.all && C.all.kin)} · engulf ${f2(C.genes.engulf)} spare ${f2(C.genes.spare)} · clumps≥8 ${pc(cl && cl.in8)}`;
    return `PREDATION${ctl}  engulf gene ${f2(C.genes.engulf)}±${f2(C.genes.engulfSd)} (carriers ${pc(C.genes.carriers)}), kin sparing ${f2(C.genes.spare)}±${f2(C.genes.spareSd)} (carriers' ${f2(C.genes.carrierSpare)})` +
      ` · wraps ${fmt(r.starts)}/s, escapes ${fmt(r.escapes)}/s, meals ${fmt(r.meals)}/s (${C.total.eaten} in all) · now wrapping ${C.now.wrapping}, digesting ${C.now.digesting}` +
      ` · meals kin ${pc(rc ? rc.kin : null)} (all ${pc(C.all && C.all.kin)}), single cells ${pc(rc ? rc.alone : null)}, hold ${f2(rc ? rc.hold : null)}` +
      ` · hold ${f2(C.now.hold)} armour ${f2(C.now.armour)} glue gene ${f2(C.genes.glue)}${cl ? ` · clusters: ${pc(cl.in8)} of cells in ≥8, singles ${pc(cl.singles)}, largest ${cl.largest}, contacts ${cl.perCell.toFixed(1)}/cell` : ''}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    const lines = [`predators (step P1): engulfing ${on(p.on)}${p.null ? ' · NEUTRAL CONTROL' : ''}${p.kinNull ? ' · kinship ignored' : ''} · area ratio ${p.sizeRatio}` +
      ` · drive ${p.drive} · hold base ${p.holdBase}, wall ${p.wallArm}, stiff ${p.stiffArm} · wrap ${p.wrapTime} s (cost ${p.startCost} + ${p.wrapCost}/s) · digest ${p.digestTime} s` +
      ` (battery ${p.batShare} to the host, wrap membrane ${p.wrapShare}) · needs battery ${p.batStart} / ${p.batKeep}, membrane ${p.integMin}`];
    const C = this.census;
    if (C && C.n) {
      const T = C.total, D = this.counts;
      lines.push(`predation: since start ${T.start} wraps, escapes lost ${T.lost} held ${T.held} poor ${T.poor}, meals ${T.eaten} (kin ${T.kin}, single ${T.alone})` +
        (D ? ` · digested per s: atoms ${fmt(D.rate.atoms)}, lipids ${fmt(D.rate.lipid)}, battery ${fmt(D.rate.bat)} (heat ${fmt(D.rate.heat)}), spilled ${fmt(D.rate.spill)}, paid ${fmt(D.rate.paid)}; meals done ${D.total.meals}, void ${D.total.void}, orphans ${D.total.orphan}` : ''));
      const S = this.series.slice(-6);
      if (S.length) lines.push(`predation every 10 s (cells, carriers, engulf, spare, meals/s, kin, single, clumps≥8): ${S.map((x) =>
        `${x[0].toFixed(0)}s ${x[1]} ${(100 * x[2]).toFixed(0)}% ${x[3].toFixed(2)} ${x[4].toFixed(2)} ${x[5].toFixed(2)} ${x[6] == null ? '-' : x[6].toFixed(2)} ${x[7] == null ? '-' : x[7].toFixed(2)} ${x[8] == null ? '-' : x[8].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }
}
