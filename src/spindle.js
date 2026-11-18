// Step S1, CELL SHAPE (user 2026-11-17, after harmonic-generation images of fibroblasts: "shape could also be fundamental now"; "single
// cell organisms have no reason to form a static shape ... unless they collaborate more"; README "Step S1: cell shape"). Parts 1 and 2 (the
// fibroblast's fibre loop comes later, with X1's proteins):
//
//   shape gene   ELONGATION (Bio.relay.y): ln of the aspect the cell asks for, 0 (round) .. ln 4 (a 4:1 spindle). It becomes a stretch of
//                half that along the cell's FRONT (C10/C11), added to the active stretch the honeycomb's rest shape follows (C6c), so the
//                glue's turning, the division along the front and the honeycomb's elastic corners carry it. The largest stretch rises from
//                0.5 (aspect 2.7, never reached by the old rules) to 0.5 ln(aspectMax). The outline keeps its SIX corners: a hexagon on a 4:1
//                ellipse is already a spindle (two poles, long straight flanks; with the axis through a side's middle a blunt rod), so
//                every per-side thing (integrity, lipids, glue, junctions, charges, pumps, neighbours, felt field) stays as it is.
//   gene network the 18th output, SHAPE (gain Bio.relay.z, regulator relay.w), multiplies the gene: the same DNA long here, round there
//   contacts     on the real shape: a CAPSULE per cell (cell_common.wgsl capsule(): a core segment along the long axis, round ends, the
//                disc's area; its aspect is the outline's own, exp(2 |e|), so passive squeezing counts as well as the gene). A pair
//                touches where their core segments come closest: the overlap spring, the glue, the junctions, the side facing the other,
//                the neighbour lists, crowding and the honeycomb's shared wall (the power line between the two closest points) all use
//                that contact. A round cell is the old disc exactly.
//   torques      the contact sits off a long cell's centre, so its push and pull TURN it (torque / the capsule's rotational drag, its
//                second moment of area per area: r^2 / 2 for a disc, as C11's glue turning): rods pressed side by side line up (nematic
//                order). The obstacles (G0b) and the dish's soft wall push at the capsule's middle and both ends; the water drags it along
//                its length, so shear and eddies turn it too. The turn is the body's: outline, front and stretch together. Not booked
//                as energy (as C11's turning).
//   payoffs      derived, no bonus: the membrane's EXCHANGE with the dish x its real perimeter over a round cell's of the same area (a
//                spindle trades faster for its volume); ENGULFING must wrap the prey's LENGTH (a predator shorter than its prey's long
//                axis cannot close round it: filamentation against grazers); sensing already integrates the field along the real sides
//                (C6c); a long mother splits along her axis into two halves (daughters a quarter of her core further apart)
//   grid         the neighbour grid's cell grows to the longest contact a pair of the longest cells can make (2 (h + reach rho) at the
//                aspect's top; 3.9 R at 4:1 against field A's 3.6 R)
//   null         ?shapenull=1: the gene drifts as on, every cell asks for the founders' round shape (contacts stay on capsules)
//   off          ?shape=0: today's shapes and circle contacts exactly (the gene never mutates, the 18th output does not exist)
//
// Census (Stats.s1, cell_common.wgsl S1S_*): aspect (as the outlines have it) mean and spread, the share longer than 2:1, the nematic order of
// touching long pairs (<cos 2 delta>: 0 random, 1 aligned), the gene and as asked, the turning, the perimeter factor, prey saved by their
// length; the SHAPE panel line; moire.sample()'s shape.*.

export const STATS_S1 = 9408;     // byte offset of Stats.s1 in struct Stats (cell_common.wgsl)
export const S1_WORDS = 16;
const BITS = { ON: 1, NULL: 2, GRN: 4, TORQUE: 8, EXCH: 16, WRAP: 32, GENE: 64 };   // SH_* in cell_common.wgsl
export const LN_MAX = Math.log(4);

/** A capsule's end radius and half-length (in units of r) at aspect A (area kept: pi rho^2 + 4 h rho = pi r^2, h = (A - 1) rho). */
export function capsuleOf(A) {
  const a = Math.max(1, A), rho = Math.sqrt(Math.PI / (Math.PI + 4 * (a - 1)));
  return { rho, h: (a - 1) * rho };
}

export class Spindle {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.spindle.params); the rules panel's group "Cell shape (step S1)"
    this.params = {
      on: true,          // (master) capsule contacts, the elongation gene, torques, payoffs (?shape=0: today's discs exactly)
      null: false,       // the elongation gene's neutral control (?shapenull=1)
      gene: true,        // the elongation gene acts (?shapegene=0: only passive shapes)
      grn: true,         // the gene network's 18th output (SHAPE) acts (?shapegrn=0)
      torque: true,      // off-centre forces turn long cells (?shapetorque=0)
      exchange: true,    // the membrane's exchange x the real perimeter (?shapeexch=0)
      wrap: true,        // engulfing must wrap the prey's length (?shapewrap=0)
      aspectMax: 4,      // the longest a cell may be (length over width; ?aspmax=; 1.2..4)
      turn: 1,           // x the derived turning (?shapeturn=)
    };
    this.census = null;
    this.series = [];    // [time, aspect geo mean, share > 2:1, nematic, gene mean, as asked]
  }

  get on() { return !!this.params.on; }

  /** The SH_* bits (Sim.shapeF): 0 while off. */
  bits() {
    const p = this.params;
    if (!p.on) return 0;
    const grnActs = !!(this.cells.grn && this.cells.grn.acts);   // (the 18th output acts only while the network's outputs do)
    return BITS.ON | (p.null ? BITS.NULL : 0) | (p.grn && grnActs ? BITS.GRN : 0) | (p.torque ? BITS.TORQUE : 0) | (p.exchange ? BITS.EXCH : 0) |
      (p.wrap ? BITS.WRAP : 0) | (p.gene ? BITS.GENE : 0);
  }

  /** The largest aspect, clamped. */
  aspect() { return Math.max(1.2, Math.min(4, Number(this.params.aspectMax) || 4)); }

  /** Sim words 28 (bits), 29 (the largest stretch), 33 (the turning gain). */
  writeSim(u, f, o) {
    u[o + 28] = this.bits();
    f[o + 29] = this.params.on ? 0.5 * Math.log(this.aspect()) : 0.5;
    f[o + 33] = this.params.on ? Math.max(0, Number(this.params.turn) || 0) : 0;
  }

  /** The longest contact a pair of the longest cells makes, in units of R (the grid's cell must be at least this): 0 while off. */
  range(reach) {
    if (!this.params.on) return 0;
    const { rho, h } = capsuleOf(this.aspect());
    return 2 * (h + Math.max(reach, 1.45) * rho);
  }

  /** The cells' stats read-back (Stats.s1, u32 words). */
  apply(time, w) {
    const s = new Int32Array(w.buffer, w.byteOffset, w.length);
    const n = w[0], m = Math.max(1, n), np = w[4];
    const la = w[1] / 1000 / m, la2 = w[2] / 1000 / m, g = w[6] / 1000 / m, g2 = w[7] / 1000 / m;
    this.census = {
      time, n, lnAspect: la, lnSd: Math.sqrt(Math.max(0, la2 - la * la)), aspect: Math.exp(la), long: w[3] / m,
      pairs: np / 2, nematic: np ? s[5] / 1000 / np : 0,
      gene: g, geneSd: Math.sqrt(Math.max(0, g2 - g * g)), geneAspect: Math.exp(g), asked: w[8] / 1000 / m,
      turning: w[10] ? w[9] / 1000 / w[10] : 0, turned: w[10] / m, noWrap: w[11], perim: w[12] / 1000 / m, length: w[13] / 1000 / m,
    };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (n && (!S.length || time - S[S.length - 1][0] >= 30)) {
      const C = this.census;
      S.push([time, C.aspect, C.long, C.nematic, C.gene, C.asked]);
      if (S.length > 400) S.shift();
    }
  }

  /** The entropy panel's SHAPE line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, pct = (x) => `${Math.round(100 * x)}%`;
    if (!p.on) return 'SHAPE  off (round contacts)';
    if (!C || !C.n) return 'SHAPE  …';
    const g = `gene ${C.geneAspect.toFixed(2)}:1${p.null ? ' NULL' : ''}`;
    if (compact) return `SHAPE ${C.aspect.toFixed(2)}:1 · ${pct(C.long)} > 2:1 · nematic ${C.nematic.toFixed(2)} · ${g}`;
    return `SHAPE  aspect ${C.aspect.toFixed(2)}:1 (spread ×${Math.exp(C.lnSd).toFixed(2)}), ${pct(C.long)} longer than 2:1 · nematic ${C.nematic.toFixed(2)}` +
      ` (${C.pairs} long pairs) · ${g}, asked ${Math.exp(C.asked).toFixed(2)}:1 · perimeter ×${C.perim.toFixed(2)}`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`cell shape (step S1): ${on(p.on)} · capsule contacts, elongation gene ${on(p.gene)} (up to ${this.aspect()}:1) · gene network output ${on(p.grn)}` +
      ` · torques ${on(p.torque)} (×${p.turn}) · exchange by perimeter ${on(p.exchange)} · engulf wraps the length ${on(p.wrap)} · neutral control ${on(p.null)}`];
    if (C && C.n) {
      lines.push(`shape: ${C.n} cells · aspect geo mean ${C.aspect.toFixed(3)} (ln ${C.lnAspect.toFixed(3)} ± ${C.lnSd.toFixed(3)}), > 2:1 ${(100 * C.long).toFixed(1)}%` +
        ` · long axis ${C.length.toFixed(2)} R · nematic ${C.nematic.toFixed(3)} over ${C.pairs} pairs · gene ln ${C.gene.toFixed(3)} ± ${C.geneSd.toFixed(3)}, asked ln ${C.asked.toFixed(3)}` +
        ` · turning ${C.turning.toFixed(3)} rad/s (${(100 * C.turned).toFixed(0)}% of cells) · perimeter ×${C.perim.toFixed(3)} · prey saved by length ${C.noWrap}`);
      const S = this.series.slice(-8);
      if (S.length) lines.push(`shape every 30 s (aspect, >2:1 %, nematic, gene): ${S.map((x) => `${x[0].toFixed(0)}s ${x[1].toFixed(2)} ${Math.round(100 * x[2])} ${x[3].toFixed(2)} ${x[4].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }
}
