// Step C15b: CELLS EAT CARBON (README "Step C15b: cells eat carbon"; design/C15_carbon_proposal.md, stage 2: option S ends here).
// Step C15a put carbon into the open dish only; now the cells take part, with nothing of the C12d chemistry changed or retired (linkers,
// oil, soap and crust stay). Everything runs in the eat pass (cell_eat.wgsl, its carbon section), with one buffer of CW words per cell:
//
//   words 0..4   the cell's LADDER molecules (methane-like cg4 .. CO2-like ct4), counts (ATOM_SCALE per unit, as the dish)
//   words 5..7   its tar GRANULES, as the dish's tar: backbone bonds c-c, fuel hands c-g, burnt hands c-t (storage granules inside)
//   words 8..12  the plan pass's exchange per ladder channel this tick (+ in, - out); 13..15 the grazing it asks per tar hand
//
// The rules (each a switch: moire.carbonCells.params; the rules panel's group "Carbon in cells (step C15b)"; URL options):
//   exchange (?cbexch=0)  the ladder molecules are NEUTRAL (no free charge: C12g's ion block does not hold them), so they cross the
//                         membrane by concentration at a neutral molecule's rate: the permeability (gene) x their spreading speed over the
//                         light atoms' (0.24: five-atom molecules pass slower), x the leak of a damaged membrane, through the free sides
//                         only (T1a's inside), an inflow x the room left. CO2-like carbon made inside therefore LEAVES by itself, down its
//                         gradient, and what piles up first slows the engine that makes it (C12e's saturation): "expel CO2" is not a rule
//   engines (?cbeng=0)    the four carbon engines in the genome's slots (src/carbon.js carbonEngines; indices behind the table's), run as
//                         every engine (C6, C12d): downhill OXIDIZE (breathing on carbon) and CONDENSE (storage) put their release into the
//                         battery minus the ineff share, the spark paid from the battery first; uphill REDUCE (fixing) and HYDROLYZE
//                         (digesting) take a pigment's photon (one per event, the slot's band; N1's pigment matter and saturation apply,
//                         as for any harvest slot) or, band 0, the battery (a storer); the spark always from the battery. HARVESTERS MUST
//                         BURN: light never charges the battery. Saturation (C12e), the trace cofactor (C7b), the gene network's
//                         expression (T1b) and the upkeep of expressed engines (T1b) as for the others
//   graze (?cbgraze=0)    a cell with a granule-eating engine (OXIDIZE or HYDROLYZE: it can use tar) takes in the tar lying under it
//                         (kGraze x those engines' expressed rates per s, of the tar there; through its free sides, x the room left) into
//                         its granules: MUD EATERS (as M1's crust grazing; zero energy, matter exact)
//   dissolve (?cbdis2=0)  a granule's LOOSE carbons (no backbone bond: as the dish's DISSOLVE, c (1 - p)^4 of them) leave the granule as
//                         ladder molecules in the stock, kDis per s (enzymes: faster than the dish's 0.02), so burnt granule carbon can
//                         get out as CO2-like carbon and digested carbon becomes fuel the engines can burn
//   smell (?cbsmell=0)    the membrane's corners smell the ladder's fuel too, each molecule weighted by what a free t would release from
//                         it (its giver hands x 2.75), as the fuels are (C12d)
// A cell's carbon goes back to the dish at its death or burst (as its stock), is split at a birth (half the ladder, the granules by the
// newborn's share), and a predator digests a meal's carbon with the rest of it (P1).
//
// Books: the carbon in cells joins every ledger: carbon (src/carbon.js: in = dish + cells + out), atoms and energy (src/matter.js), charge
// (src/charge.js), and the dish's own carbon energy book counts what crossed the membranes (taken in, given back) per channel.

import { fmt, HEAT_SCALE, LEDGER_WORDS } from './heat.js';
import { CARBON, LADDER, LG_CBC, carbonTable } from './carbon.js';

export const CW = 16;          // carbon words per cell (cell_eat.wgsl CW)
export const CW_STOCK = 8;     // ... of them the stock (the ladder and the granules: what a snapshot keeps)
const ATOM_SCALE = 4096;
const CBF = { ON: 1, EXCH: 2, ENG: 4, GRAZE: 8, DIS: 16, FLIP: 32, RESET: 64, SMELL: 128 };
// the 64-bit event counters (LG_CBC.EV, cell_eat.wgsl CBE_*)
const EV = ['ox', 'cond', 'red', 'hyd', 'dis', 'graze', 'gain', 'heat', 'paid', 'phUsed', 'phIdle', 'satWant', 'satLost', 'rise', 'xtr', 'xtr2'];
const EV_ENERGY = /^(gain|heat|paid|rise)$/;
// the census (LG_CBC.CEN, 16 numbers x 16 slots, i32; cell_eat.wgsl CBZ_*)
const CEN = ['n', 'ox', 'cond', 'red', 'redLit', 'hyd', 'granule', 'granC', 'ladder', 'any', 'oxOnly', 'litOnly'];
export const CB_RULES = ['exchange', 'engines', 'graze', 'dissolve', 'smell'];

export class CarbonCells {
  constructor(eat) {
    this.eat = eat;
    this.on = CARBON;
    // live-tunable (moire.carbonCells.params)
    this.params = {
      on: true,          // cells take part in carbon at all (off: the cells are blind to it again, as in step C15a)
      exchange: true,    // the ladder crosses the membrane by concentration (a neutral molecule's rate)
      engines: true,     // the carbon engines in the genome run
      graze: true,       // cells with granule-eating engines take in the tar under them
      dissolve: true,    // loose granule carbons leave the granule as ladder molecules
      smell: true,       // the corners smell the ladder's fuel
      kGraze: 0.05,      // share of the tar under the cell taken per s, per unit of the grazing engines' expressed rate
      kDis: 0.2,         // per s: loose granule carbons leaving as molecules (the dish's: 0.02)
    };
    this.tot = Object.fromEntries(EV.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];
    this.ledger = null;
    this.ab = new ArrayBuffer(64);
  }

  /** The GPU side (called by src/eat.js init): the carbon buffer (CW words per cell; 16 bytes without carbon) and its uniform. */
  init(device, n) {
    const U = GPUBufferUsage;
    this.device = device;
    this.buf = device.createBuffer({ label: 'cell carbon', size: CARBON ? n * CW * 4 : 64, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.ubuf = device.createBuffer({ label: 'cell carbon params', size: 64, usage: U.UNIFORM | U.COPY_DST });
  }

  rule(k) { return CARBON && !!this.params.on && !!this.params[k]; }

  /**
   * The uniform (struct CbCellP, cell_eat.wgsl) for this frame or for a reset (`reset`: give_back puts carbon into the copy current outside a
   * frame). `tickBase`: the cells' tick at which the matter's tick 0 of this frame runs (after the warm-up).
   */
  write(tickBase = 0, reset = false) {
    if (!this.ubuf) return;
    const u = new Uint32Array(this.ab), f = new Float32Array(this.ab), i = new Int32Array(this.ab);
    u.fill(0);
    if (CARBON) {
      const E = this.eat, M = E.matter, H = E.heat, Cb = M && M.carbon;
      const ok = !!(M && H && H.buffer && M.bufVersion === H.version && Cb);
      const p = this.params;
      const flip = ok && M.active && M.carbonRun && M.ticks > 0;
      u[0] = (p.on ? CBF.ON : 0) | (this.rule('exchange') ? CBF.EXCH : 0) | (this.rule('engines') ? CBF.ENG : 0) | (this.rule('graze') ? CBF.GRAZE : 0) |
        (this.rule('dissolve') ? CBF.DIS : 0) | (flip ? CBF.FLIP : 0) | (reset ? CBF.RESET : 0) | (this.rule('smell') && E.rule('smell') ? CBF.SMELL : 0);
      u[1] = tickBase >>> 0; u[2] = ok ? Math.max(1, M.nSub || 1) : 1; u[3] = ok ? Cb.cur & 1 : 0;
      if (ok) {
        const LW = LEDGER_WORDS;   // (the heat buffer's grid starts behind the ledger)
        u[4] = LW + Cb.copyBase(0); u[5] = LW + Cb.copyBase(1); u[6] = LW + Cb.tarBase(); u[7] = reset ? LW + Cb.copyBase(Cb.cur) : 0;
      }
      const T = carbonTable();
      f[8] = T.ladder[0].spread / 1.2;   // the ladder's spreading speed over the light atoms' (SPREAD.row1): its membrane rate's share
      f[9] = Math.max(0, p.kGraze); f[10] = Math.max(0, p.kDis); f[11] = 0;
      i[12] = T.ox16; i[13] = T.cond16; i[14] = Math.round(16 * T.spark); i[15] = T.ox16;   // (smell: per giver hand, what a free t releases)
    }
    this.device.queue.writeBuffer(this.ubuf, 0, this.ab);
  }

  /** The heat's ledger read-back (through src/eat.js; src/carbon.js reads the stock and the flows for the books itself). */
  apply(rec, w) {
    if (!CARBON) return;
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const T = this.tot;
    EV.forEach((k, j) => { const v = wide(LG_CBC.EV + 128 * j); T[k] += EV_ENERGY.test(k) ? v / HEAT_SCALE : v / ATOM_SCALE; });
    const H = this.hist;
    H.push([rec.time, ...EV.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(EV.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_CBC.CEN + 16 * q + k]; return s; };
    const C = Object.fromEntries(CEN.map((k, q) => [k, v(q)]));
    C.granC /= 1000; C.ladder /= 1000;
    this.census = C;
    const held = [];
    for (let c = 0; c < 8; c++) held.push(wide(LG_CBC.STOCK + 128 * c) / ATOM_SCALE);
    const tarC = (2 * held[5] + held[6] + held[7]) / 4;
    this.ledger = { time: rec.time, rate, held, ladder: held.slice(0, 5), granules: held.slice(5), granC: tarC, census: C };
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.n, C.ox, C.cond, C.redLit, C.hyd, C.granule, tarC, rate.ox, rate.cond, rate.red, rate.graze]);
      if (S.length > 400) S.shift();
    }
  }

  /** For moire.sample(): the numbers of the last read-back. */
  get sample() {
    const L = this.ledger;
    if (!L) return null;
    const C = L.census, r = L.rate;
    const out = { cells: C.n, withOx: C.ox, withCond: C.cond, withRed: C.red, withRedLit: C.redLit, withHyd: C.hyd, anyCarbonEngine: C.any,
      holdGranules: C.granule, granC: L.granC, ladderHeld: L.ladder.reduce((a, b) => a + b, 0), cg4In: L.ladder[0], ct4In: L.ladder[4] };
    for (const k of EV) out[`r_${k}`] = r[k];
    return out;
  }

  /** The entropy panel's line. */
  panelLine(compact = false) {
    if (!CARBON) return 'CARBON IN CELLS  off (?carbon=0)';
    if (!this.params.on) return 'CARBON IN CELLS  off (the cells are blind to carbon)';
    const L = this.ledger;
    if (!L) return 'CARBON IN CELLS  …';
    const C = L.census, r = L.rate, pc = (x) => (C.n ? `${Math.round(100 * x / C.n)}%` : '-');
    if (compact) return `CARBON IN CELLS breathe ${fmt(r.ox)}/s store ${fmt(r.cond)}/s fix ${fmt(r.red)}/s · granules ${fmt(L.granC)} · engines ${pc(C.any)}`;
    return `CARBON IN CELLS  held: ladder ${L.ladder.map((x) => fmt(x)).join(' ')} · granules ${fmt(L.granC)} carbons in ${C.granule} cells` +
      ` · per s: breathe (oxidize) ${fmt(r.ox)} · store (condense) ${fmt(r.cond)} · fix (reduce) ${fmt(r.red)} · digest (hydrolyze) ${fmt(r.hyd)}` +
      ` · granules dissolve ${fmt(r.dis)} · tar grazed ${fmt(r.graze)} hands → batteries +${fmt(r.gain)}, heat ${fmt(r.heat)}` +
      `\n        cells with a carbon engine ${pc(C.any)}: oxidize ${C.ox} · condense ${C.cond} · reduce ${C.red} (by light ${C.redLit}) · hydrolyze ${C.hyd}`;
  }

  /** The F overlay's lines. */
  overlayLines() {
    if (!CARBON) return [];
    const p = this.params, on = (x) => (x ? 'on' : 'off');
    const lines = [`carbon in cells (step C15b) ${on(p.on)}: exchange ${on(p.exchange)} · engines ${on(p.engines)} · graze ${on(p.graze)} (k ${p.kGraze}/s per rate)` +
      ` · granules dissolve ${on(p.dissolve)} (${p.kDis}/s) · smell ${on(p.smell)}`];
    const L = this.ledger;
    if (L) {
      const r = L.rate;
      lines.push(`carbon engines per s: photons used ${fmt(r.phUsed)}, idle ${fmt(r.phIdle)} · stored in bonds ${fmt(r.rise)} · batteries paid ${fmt(r.paid)}` +
        ` · saturation lost ${fmt(r.satLost)} of ${fmt(r.satWant)} · every 10 s (cells: n/ox/cond/fix by light/hyd/granules; granule carbons; ox/cond/red/graze per s): ` +
        this.series.slice(-5).map((s) => `${s[0].toFixed(0)}s ${s.slice(1, 7).join('/')} ${fmt(s[7])} ${s.slice(8).map((x) => fmt(x)).join('/')}`).join(' · '));
    }
    return lines;
  }
}

export { LADDER };
