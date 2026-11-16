// Step C12f: VENTS THAT FEED LIFE IN THE DARK (the user, 2026-11-16: "maybe we should adapt the chemistry then", after a fully dark
// vent dish starved in 100 s; README "Step C12f: vents in the dark" has the diagnosis). Chemosynthesis from a REDOX GRADIENT, derived
// from the electron table (step C12d), nothing set per substance:
//
//   HOT VENT   the vent (tap mode 3, the presets' vents) drips free GIVERS, mostly the heavy G (metal-like, it gives most easily) and
//              the light g (hydrogen-like), plus a little of what it dripped before (the fuels gT, GT) and trace; and it is HOT: it puts
//              heat into the grid where it drips, `heat` energy per atom it drips (like the warm fluid a vent pours out), booked as
//              energy in (the ledger's vent heat, beside the base warmth and the light)
//   THE SEA    a faint dish-wide supply of the free heavy TAKER T (sulfate- or CO2-like: oxidised), topped up on every grid pixel at
//              `seaRate` atoms per R^2 per s where the pixel holds none, less as it nears the sea's `seaLevel` (atoms per R^2), none
//              above it (the sea renews what is used, it never takes anything out), booked as added matter, like a spring's
//   and nothing else: by the table, G + T -> GT releases 2.375 and g + T -> gT 1.5. Their sparks (0.5, 0.375) keep them frozen in the
//   cold open; the vent's heat pays them close in, so the gradient burns away by itself there (abiotically, into fuel); further out
//   giver and taker meet cold and stay, and a cell's engine (an enzyme: its spark paid from the battery, not by heat) can run them
//   anywhere. The genome's engines already include every bond both ways (step C12d: g + T -> gT and G + T -> GT are "fermenting"
//   engines, no free t), so cells can eat the gradient with what they have; nothing names a chemosynthesiser.
//
// Switches (rules panel, group "Vents in the dark (step C12f)"; URL): hot (?hotvent=1; off: the C12d vent, fuel and G, no heat), sea
// (?sea=1); both on in the Deep vents preset and off elsewhere, so the other scenes are as they were. Knobs: ?ventheat= ?searate= ?sealevel=.
// With ?electrons=0 the vent is the old heavy spring and none of this acts (it needs the electrons' table).
//
// The ledger (heat_common.wgsl, LG_VENT, LG_SEA): vent heat put in (heat counts) and sea atoms added (counts), 64 slots each, since
// the last read-back. The cells' gradient engines (a bond made from two free atoms with no free t: g + T, G + T) count their events
// and what they put into batteries (cell_eat.wgsl E2_GRAD, E2_GRADE).

import { fmt, HEAT_SCALE } from './heat.js';

export const LG_VENT = 28288, LG_SEA = 28352;   // heat_common.wgsl
// the vents' mixes (shares of the dripped atoms): the hot one, and step C12d's (fuel and metal-like givers)
export const HOT_MIX = { G: 0.4, g: 0.3, GT: 0.11, gT: 0.11, trace: 0.08 };   // (trace twice the old vent's: vent water is rich in metals, the engines' cofactor)
export const OLD_MIX = { G: 0.2, gT: 0.36, GT: 0.4, trace: 0.04 };

export class Vents {
  constructor(matter, electrons) {
    this.matter = matter;
    this.on = electrons;    // the electrons' table (fixed for the page)
    // live-tunable (moire.vents.params)
    this.params = {
      hot: false,           // the vent drips free givers and heats the grid where it drips (?hotvent=1; the Deep vents preset turns it on).
                            // Off by default: the default scene's colony lives on the C12d vent's fuel and fell from ~1300 to ~150 cells
                            // with the hot vent (README "Step C12f"), so every other scene keeps the C12d vent
      heat: 10,             // energy put into the grid per atom a hot vent drips (?ventheat=)
      sea: false,           // the sea's faint supply of the free heavy taker T (?sea=1; the Deep vents preset turns it on)
      seaRate: 0.02,        // atoms of T per R^2 per s the sea brings to a pixel holding none (?searate=)
      seaLevel: 0.5,        // the sea's level (atoms of T per R^2): it tops a pixel up toward it, never above (?sealevel=)
    };
    this.tot = { heat: 0, sea: 0 };
    this.hist = [];
    this.census = null;
  }

  get hot() { return this.on && !!this.params.hot; }
  get seaOn() { return this.on && !!this.params.sea && this.params.seaRate > 0 && this.params.seaLevel > 0; }

  /** The vent's mix for this frame (src/matter.js SPRING_KINDS.heavy follows it, so the drip, the drawing and the zoo agree). */
  sync(kinds) {
    if (!this.on) return;
    const K = kinds.heavy;
    K.mix = this.hot ? HOT_MIX : OLD_MIX;
    K.label = this.hot ? 'hot vent' : 'vent';
  }

  /** Heat counts per tick a spring of `kind` dripping `rate` atoms per s puts into its disc (0: none). */
  heatPerTick(kind, rate, dt) {
    if (!this.hot || kind !== 'heavy') return 0;
    return Math.max(0, this.params.heat) * rate * dt * HEAT_SCALE;
  }

  /** The sea's words (struct MatterP sea: counts per pixel per tick at an empty pixel, the level in counts per pixel, the channel). */
  writeMatter(f, o, aPx2, dt, ch) {
    if (!this.seaOn) { f[o] = 0; f[o + 1] = 1; f[o + 2] = ch; f[o + 3] = 0; return; }
    const p = this.params;
    f[o] = p.seaRate * aPx2 * dt * 4096;
    f[o + 1] = Math.max(1, p.seaLevel * aPx2 * 4096);
    f[o + 2] = ch; f[o + 3] = 0;
  }

  /** The heat's ledger read-back (called by src/matter.js apply). */
  apply(rec, w) {
    const sum = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k]; return s; };
    const T = this.tot;
    T.heat += sum(LG_VENT) / HEAT_SCALE;
    T.sea += sum(LG_SEA) / 4096;
    const H = this.hist;
    H.push([rec.time, T.heat, T.sea]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const rt = (j) => (dt > 0.05 ? (H[H.length - 1][j] - H[0][j]) / dt : 0);
    const M = this.matter, CH = M.CH, D = (n) => M.dish[CH[n]] || 0;
    const E2 = M.eat && M.eat.ledger && M.eat.ledger.rate2;
    const vents = M.springs.filter((s) => s.kind === 'heavy').length;
    this.census = {
      time: rec.time, vents, hot: this.hot ? 1 : 0, sea: this.seaOn ? 1 : 0,
      rate: { heat: rt(1), sea: rt(2), grad: E2 ? E2.eGrad || 0 : 0, gradE: E2 ? E2.eGradE || 0 : 0 },
      tot: { heat: T.heat, sea: T.sea },
      G: D('G'), g: D('g'), T: D('T'), gT: D('gT'), GT: D('GT'),
    };
  }

  /** The entropy panel's VENTS line. */
  panelLine(compact = false) {
    if (!this.on) return 'VENTS  the old table (?electrons=0): the heavy spring as it was';
    const C = this.census, p = this.params;
    if (!C) return 'VENTS  …';
    const r = C.rate;
    const vent = `${C.vents} ${this.hot ? 'hot vent' : 'vent'}${C.vents === 1 ? '' : 's'}${this.hot ? ` (heat in ${fmt(r.heat)}/s)` : ''}`;
    const sea = this.seaOn ? `sea T +${fmt(r.sea)}/s (level ${p.seaLevel}/R²)` : 'no sea';
    if (compact) return `VENTS ${vent} · ${sea} · gradient eaten ${fmt(r.grad)}/s → +${fmt(r.gradE)}/s`;
    return `VENTS  ${vent} · ${sea} · dish: G ${fmt(C.G)} g ${fmt(C.g)} T ${fmt(C.T)} · fuel gT ${fmt(C.gT)} GT ${fmt(C.GT)}` +
      ` · cells eat the gradient (g + T, G + T) ${fmt(r.grad)}/s → batteries +${fmt(r.gradE)}/s`;
  }

  overlayLines() {
    if (!this.on) return [];
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`vents in the dark (step C12f): hot vent ${on(p.hot)} (heat ${p.heat} per atom dripped; mix ${Object.entries(this.hot ? HOT_MIX : OLD_MIX).map(([a, s]) => `${a} ${s}`).join(' ')})` +
      ` · sea ${on(p.sea)} (T ${p.seaRate}/R²/s at an empty pixel, level ${p.seaLevel}/R²)`];
    if (C) lines.push(`vents: heat in ${fmt(C.rate.heat)}/s (total ${fmt(C.tot.heat)}) · sea T in ${fmt(C.rate.sea)}/s (total ${fmt(C.tot.sea)}) · gradient engines ${fmt(C.rate.grad)} events/s, ${fmt(C.rate.gradE)} energy/s into batteries`);
    return lines;
  }
}
