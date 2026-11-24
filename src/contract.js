// Step L1, CONTRACTION (BUILD QUEUE 6a6d, the user 2026-11-24: "let's create a tissue lab, that we pre design cells and try to create a muscle
// for instance, with nerves and skin, as simple as it is, as long as it is cohesive"; README "Step L1"). A general capability any cell could
// evolve (an actomyosin toy), never a "muscle" rule:
//
//   the gene     CONTRACTION (Bio.tb.y, 0..4; founders 0): how hard the cell can shorten along its FRONT (the S1 spindle's axis)
//   the network  the 23rd output, CONTRACT (gain Bio.tb.z, regulator tb.w; not addressed by lattice in the moire genome: it keeps the regulator
//                it was wired to), multiplies the gene: drive = min(gene x exp(u x), 1). A fast regulator (step Q1) makes it a TWITCH
//   the shape    the drive takes CON_MAX x drive (half ln 4) off the stretch the cell asks for along its front (cell_step.wgsl): a 4:1 spindle at
//                drive 1 is round, a round cell flattens across its front. The outline's elastic corners follow (shapeRate), the CAPSULE (its
//                contacts, step S1) shortens with them, and the glue across its junctions (step G0) pulls its neighbours after it: a bundle
//                glued end to end shortens as a whole. Nothing pushes or pulls by itself; the junctions may TEAR if it shortens faster than
//                the glue can follow (G0's breaking rule)
//   the pull     its contractile machinery is anchored in its junctions: a contracting cell PULLS each joined partner (a formed junction) toward
//                itself along its own axis (x |cos| of the contact to the axis: the poles pull), and is pulled back as hard; in a chain of
//                contracting cells the pulls cancel in the middle and the ends draw in, so the bundle shortens as a whole (`pull` x the
//                glue's scale x the drive; ?conpull=0: the shape alone)
//   the cost     `cost` energy per s at drive 1 from the battery (the eat pass's upkeep, as heat: booked); a cell with an empty battery cannot
//                contract (it relaxes). Free when it does not contract
//   mutation     at births with the gene network's (the gene drifts, the output's gain drifts, now and then it is pointed at another regulator,
//                switched on at a random gain, or off), only while contraction is on
//   null         ?contractnull=1: the genes drift as on, no cell contracts, nothing is paid
//   off          ?contract=0: exactly as before (the genes are carried, never mutate)
//
// Needs the cell shape (step S1) on. Census (a read-back every censusEvery s): carriers of the gene, wired (the output has a gain), contracting
// now (drive above 0.1), the mean drive, the energy it costs per s; the CONTRACTION panel line; moire.contract.now().

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { HEAT_SCALE } from './heat.js';
import { readBuffer } from './snapshot.js';

export const BIO_CON = 185;                 // Bio.tb.y: the gene; 186 the output's gain, 187 its regulator
const B_GX = 84;                            // Bio.gx: the regulators' expression
const C_FLAGS = 9, C_BAT = 16;
const BITS = { ON: 128, NULL: 256, GRN: 512 };   // SH_CON, SH_CNULL, SH_CGRN (cell_common.wgsl)
export const CON_MAX = 0.5 * Math.log(4);
export const CON_GMAX = 4;                 // the gene's top (cell_common.wgsl CON_GMAX)

/** A genome's contraction drive now (0..1), as cell_common.wgsl con_drive: g the Bio words at o; acts = the network's outputs act. */
export function conDrive(g, o, acts = true) {
  const k = Math.max(0, Math.min(CON_GMAX, g[o + BIO_CON] || 0));
  if (!(k > 0)) return 0;
  let f = 1;
  if (acts) {
    const j = Math.max(0, Math.min(7, Math.round(g[o + BIO_CON + 2] || 0)));
    const u = Math.max(-8, Math.min(8, g[o + BIO_CON + 1] || 0)), x = Math.max(0, Math.min(1, g[o + B_GX + j] || 0));
    f = Math.min(Math.exp(u * x), 4);
  }
  return Math.min(k * f, 1);
}

export class Contract {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.contract.params); the rules panel's group "Contraction (step L1)"
    this.params = {
      on: true,          // contraction acts (?contract=0: as before; the genes carried, never mutating)
      null: false,       // the NEUTRAL control (?contractnull=1): the genes drift, nothing contracts, nothing is paid
      grn: true,         // the gene network's 23rd output scales the drive (?contractgrn=0: the gene alone, tonic)
      cost: 0.01,        // energy per s at drive 1 (?concost=; an engine's upkeep at rate 1 is 0.003, the signal's release 0.004)
      pull: 0.3,         // the pull through joined junctions at drive 1, x the glue's scale (adhesion x R x stiffness; 0: the shape alone) (?conpull=)
      censusEvery: 5,    // s of simulated time between the census's read-backs (0: never) (?concensus=)
    };
    this.census = null;
    this.busy = false;
    this.lastAt = -1e9;
  }

  get on() { return !!this.params.on; }

  /** The bits ORed into Sim.shapeF (word 28) after the shape's; nothing while the shape (step S1) is off. */
  bits() {
    const p = this.params, S = this.cells.spindle;
    if (!p.on || !S || !S.on) return 0;
    const acts = !!(this.cells.grn && this.cells.grn.acts);
    const pq = Math.max(0, Math.min(255, Math.round(32 * (Number(p.pull) || 0))));   // (bits 16..23: the pull x 32)
    return BITS.ON | (p.null ? BITS.NULL : 0) | (p.grn && acts ? BITS.GRN : 0) | (pq << 16);
  }
  writeSim(u, o) { u[o + 28] |= this.bits(); }

  /** The eat pass's word (EatP.g3.w): heat counts per tick at drive 1 (0 while off or in the null). */
  writeEat(f, o, dt) {
    const p = this.params;
    f[o] = this.bits() && !p.null ? Math.max(0, Number(p.cost) || 0) * HEAT_SCALE * Math.max(1e-4, dt) : 0;
  }

  // ---------------------------------------------------------------- the census
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!this.on || !(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('contract census:', e); });
  }
  now() { return this.read(window.moire && window.moire.time ? window.moire.time() : this.lastAt); }

  async read(time = 0) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count, B = BIO_FLOATS, CF = CELL_FLOATS;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * B * 4), readBuffer(d, C.cellBuf, 0, n * CF * 4)]);
      const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
      const acts = !!(this.params.grn && C.grn && C.grn.acts);
      let N = 0, carriers = 0, wired = 0, now = 0, sDrive = 0, sGene = 0;
      for (let i = 0; i < n; i++) {
        const o = i * CF;
        if (!(u[o + C_FLAGS] & 1)) continue;
        N++;
        const b = i * B, k = Math.max(0, Math.min(CON_GMAX, g[b + BIO_CON] || 0));
        sGene += k;
        if (k > 0.02) carriers++;
        if (k > 0.02 && (g[b + BIO_CON + 1] || 0) !== 0) wired++;
        const dr = this.params.null ? 0 : conDrive(g, b, acts) * (f[o + C_BAT] > 0 ? Math.min(1, f[o + C_BAT] / 0.05) : 0);
        sDrive += dr;
        if (dr > 0.1) now++;
      }
      this.census = { time, n: N, carriers, wired, contracting: now, drive: N ? sDrive / N : 0, gene: N ? sGene / N : 0,
        costPerS: this.params.null ? 0 : sDrive * this.params.cost };
      return this.census;
    } finally {
      this.busy = false;
    }
  }

  panelLine(compact = false) {
    const p = this.params, c = this.census;
    if (!p.on) return 'CONTRACTION off';
    if (!this.bits()) return 'CONTRACTION off (needs the cell shape, step S1)';
    if (!c) return 'CONTRACTION …';
    if (compact) return `CONTRACTION ${c.contracting} now · carriers ${c.carriers}${p.null ? ' NULL' : ''}`;
    return `CONTRACTION  contracting now ${c.contracting} (drive > 0.1) · mean drive ${c.drive.toFixed(3)} · carriers ${c.carriers} (gene > 0.02, mean ${c.gene.toFixed(3)})` +
      ` · wired to the network ${c.wired} · costs ${c.costPerS.toFixed(4)}/s${p.null ? ' · NULL' : ''}`;
  }
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    return [`contraction (step L1) ${on(p.on)}: gene x the network's 23rd output ${on(p.grn)}, up to ${CON_MAX.toFixed(3)} of stretch off along the front, cost ${p.cost}/s at drive 1` +
      `${p.null ? ' · NEUTRAL CONTROL' : ''}`];
  }
}
