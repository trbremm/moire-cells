// Step C13: FIELDS AS GENES, FIELDS AS GUIDES (user 2026-11-16; their words earlier: "I envisioned the field just to guide the
// underlying interactions. Maybe we let them mutate their different fields more"). Back to the moire as the heart of the look.
//
//   field genes  every number a cell uses for its fields is its own gene and mutates, per field:
//                A   lever (x the global lever: how far its lattice is from the medium's, i.e. its BEAT PERIOD), emission (x),
//                    sensing gain AND SIGN (x; negative: it runs from what it would have sought), tuning width (x: how picky its
//                    receptor is), lattice angle (an offset from its key: the field's lattice turns, the key, its identity, does not)
//                B   lever (x), emission (x), sensing gain and sign (x), pickiness (0: feels every cell's B, as before; larger: only
//                    cells whose B lattice is like its own), lattice angle (offset)
//                A'  (step 8's partner: A's sine twin, so its lattice, lever and tuning are A's) a SHARE: how far the cell's beat is
//                    turned from A into A' (0: pure A, as before; 1: pure A', its bright core gone dark-light), and a sensing gain
//                    and sign (x the push along the phase current, rule a, and the sideways push, rule c)
//                The founders carry today's values (x 1, offset 0), so with mutation off nothing changes. With the genes off
//                (?fgenes=0) every cell uses today's values whatever its genes say (they still drift).
//   guides       what a cell FEELS on each of its six membrane sides (field A, the exact segment integrals the push is made of, with
//                its sensing gene's gain and sign), s_k = tanh(felt_k / ref) in -1..1, GATES what it does, each through its own
//                gene (-1..1; the founders' within +-0.05, so guidance must evolve):
//                glue    each side's adhesion (step C10's pattern) x (1 + g s_k): stickier where the field is high (g > 0) or low;
//                        the cost (linkers, upkeep) follows, as for any glue
//                pump    the pump slots' rates x (1 + g s), s the mean over the sides (the field at the cell)
//                engine  the engine slots' rates x (1 + g s)
//                div     the division axis: blended toward the felt GRADIENT (g > 0: the daughter goes up or down the gradient) or
//                        across it (g < 0), by |g| x the gradient's strength
//                turn    the front (and with step C11's turning the body) turns toward the gradient (g > 0) or away (g < 0), at
//                        turnRate x |g| x the gradient's strength rad/s x the sine of the angle between them
//                Every factor is bounded (0..2; the turning at most turnRate rad/s); nothing is placed by hand.
//   push         the direct push of field A (step 4) x the push GENE (0..2, 1 = as before), so evolution can choose between
//                pushing and guiding
//   null         the NEUTRAL control (?gatenull=1): the gate genes and the push gene still mutate and drift, but have no effect,
//                to tell selection from noise (the field genes still act)
//
// Layout: Bio words 56..75 (struct Bio fa, fb, fx, gate, gate2 in cell_common.wgsl; GENES below); the step copies what the beat
// needs into the Cell (words 78..81, f16 deltas from today's values: 0 = as before) and writes what each side felt (words 82, 83,
// 8 bits a side), which the eat pass gates with. Census: Stats.fg (FG_WORDS words), counted on the frame's last tick.
//
// This module holds the switches and knobs (moire.guides.params, .look), writes the step's (Fields.fg0), the eat pass's (EatP
// wl1.z) and the drawing's words, reads the census back and gives the GUIDES panel line, the overlay lines and sample() numbers.

import { pal } from './palette.js';

export const STATS_FG = 8768;    // byte offset of Stats.fg in struct Stats (cell_common.wgsl)
export const FG_WORDS = 64;
export const BIO_FG = 56;        // the first field gene's word in Bio

/** The genes of step C13, in Bio order from word 56, with today's values (what the founders carry). */
export const FG_GENES = [
  ['leverA', 1], ['emitA', 1], ['senseA', 1], ['tuneA', 1],
  ['leverB', 1], ['emitB', 1], ['senseB', 1], ['pickB', 0],
  ['angleA', 0], ['angleB', 0], ['shareP', 0], ['senseP', 1],
  ['gateGlue', 0], ['gatePump', 0], ['gateEngine', 0], ['gateDiv', 0],
  ['gateTurn', 0], ['push', 1], ['fgSpare0', 0], ['fgSpare1', 0],
];
export const FG_DEFAULTS = FG_GENES.map(([, v]) => v);
const GATES = ['glue', 'pump', 'engine', 'div', 'turn'];
const SHORT = { leverA: 'lever', emitA: 'emit', senseA: 'sense', tuneA: 'tune', leverB: 'lever', emitB: 'emit', senseB: 'sense',
  pickB: 'pick', angleA: 'angle', angleB: 'angle', shareP: 'share', senseP: 'sense' };
// the beat period histogram's bin edges (units of R; the census, FG_PH)
export const PERIOD_EDGES = [2, 3, 4.5, 7, 10, 15, 25];

// bits (Fields.fg0.x, EatP wl1.z; keep in step with FG_* in cell_common.wgsl)
export const FG = { GENES: 1, GLUE: 2, PUMP: 4, ENGINE: 8, DIV: 16, TURN: 32, PUSH: 64 };

/** Fill a genome's step C13 words with today's values (a genome from before C13, or a founder). */
export function fieldDefaults(g, o = 0) {
  for (let k = 0; k < FG_DEFAULTS.length; k++) g[o + BIO_FG + k] = FG_DEFAULTS[k];
}

/** The founders' gate genes: each within +-spread of 0 (so guidance must evolve), from their own random stream. */
export function founderGates(g, rng, spread = 0.05) {
  for (let k = 12; k <= 16; k++) g[BIO_FG + k] = spread * (2 * rng() - 1);
}

export class Guides {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.guides.params). Switches: the rules panel's group "Fields as guides (step C13)"; URL ?fgenes=0, ?gateglue=0,
    // ?gatepump=0, ?gateengine=0, ?gatediv=0, ?gateturn=0, ?pushgene=0, ?gatenull=1
    this.params = {
      genes: true,       // field genes act: each cell's lever, emission, sensing, tuning, angle (A, B), share and sensing (A') from its
                         // genes; off: today's global values for everyone (the genes still drift)
      glue: true,        // the glue gate: each side's adhesion x (1 + g s_k)
      pump: true,        // the pump gate: the pump slots' rates x (1 + g s)
      engine: true,      // the engine gate: the engine slots' rates x (1 + g s)
      div: true,         // the division gate: the axis along (g > 0) or across (g < 0) the felt gradient
      turn: true,        // the turn gate: the front turns toward (g > 0) or away from (g < 0) the felt gradient
      push: true,        // the push gene: field A's direct push x the gene (off: x 1)
      null: false,       // the NEUTRAL control: every gate and the push gene without effect (their genes still drift)
      ref: 2.3,          // the field felt on a side that gives s = tanh(1) (field A's felt units, x the sensing gain 10: about the
                         // felt value at which the push saturates, senseMax / 1.3)
      turnRate: 1,       // the turn gate's rate (rad / s at |g| = 1, a full gradient and a right angle)
      viewMin: 0.15,     // the guides view: a cell whose gate genes are all below this is "unguided" (grey)
    };
    // the look (moire.guides.look; drawing only)
    this.look = {
      viewTube: 0.8,     // the guides view: each side's tube shaded by what it feels (bright: field high, dark: low)
      viewFill: 0.35,    // ... the body's fill in its strongest gate's ink, at |g| = 1 (less for weaker genes)
    };
    this.census = null;
    this.series = [];    // [time, mean glue, pump, engine, div, turn, push, mean lever A, median period] every 30 s
  }

  /** Whether a gate (or the push gene) acts. */
  gate(k) { return !!this.params[k] && !this.params.null; }

  bits() {
    const p = this.params;
    return (p.genes ? FG.GENES : 0) | (this.gate('glue') ? FG.GLUE : 0) | (this.gate('pump') ? FG.PUMP : 0) |
      (this.gate('engine') ? FG.ENGINE : 0) | (this.gate('div') ? FG.DIV : 0) | (this.gate('turn') ? FG.TURN : 0) |
      (this.gate('push') ? FG.PUSH : 0);
  }

  /** The step's words (struct Fields fg0, from word o). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = this.bits(); f[o + 1] = Math.max(1e-3, p.ref); f[o + 2] = Math.max(0, p.turnRate); f[o + 3] = 0;
  }

  /** The eat pass's word (EatP wl1.z). */
  writeEat(u, o) { u[o] = this.bits(); }

  /** The drawing's words (struct Draw gd, gdInk[6], from word o). */
  writeDraw(a, o, L) {
    const P = pal(), K = this.look, ink = P.guides || { none: P.other, glue: P.other, pump: P.other, engine: P.other, div: P.other, turn: P.other };
    a[o] = L.view === 5 ? 1 : 0; a[o + 1] = Math.max(0, Math.min(1, K.viewTube)); a[o + 2] = Math.max(0, K.viewFill); a[o + 3] = Math.max(0, this.params.viewMin);
    [ink.none, ink.glue, ink.pump, ink.engine, ink.div, ink.turn].forEach((c, j) => { for (let k = 0; k < 3; k++) a[o + 4 + 4 * j + k] = c[k] / 255; a[o + 7 + 4 * j] = 1; });
  }

  /** The cells' stats read-back (Stats.fg, u32 words). */
  apply(time, w) {
    const s = new Int32Array(w.buffer, w.byteOffset, w.length);
    const n = w[0], m = Math.max(1, n);
    const genes = {};
    FG_GENES.slice(0, 18).forEach(([name], k) => {
      const mean = s[1 + k] / 1000 / m, sq = w[19 + k] / 1000 / m;
      genes[name] = { mean, sd: Math.sqrt(Math.max(0, sq - mean * mean)) };
    });
    const strongest = {};
    ['none', ...GATES].forEach((k, j) => { strongest[k] = w[37 + j] / m; });
    const hist = Array.from(w.slice(48, 56));
    let acc = 0, median = null;
    const tot = hist.reduce((a, b) => a + b, 0);
    for (let b = 0; b < 8 && tot; b++) {
      acc += hist[b];
      if (acc >= tot / 2) { median = b; break; }
    }
    this.census = {
      time, n, genes, strongest,
      felt: w[43] / 1000 / m,            // mean |s| over the cells (the field felt at the cell, as the pump and engine gates see it)
      spread: w[44] / 1000 / m,          // mean (max - min) / 2 of the six sides' s (how differently the sides feel)
      guide: w[45] / 1000 / m,           // mean guidance strength (the felt gradient's, as the division and turn gates see it)
      glueEff: w[46] / 1000 / m,         // mean |the glue gate's factor - 1| over the sides (what the glue gate does now)
      rateEff: w[47] / 1000 / m,         // mean |the engine gate's factor - 1| (what the engine gate does now)
      period: { hist, median: median == null ? null : median, mean: tot ? w[56] / 1000 / tot : null },
    };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (n && (!S.length || time - S[S.length - 1][0] >= 30)) {
      const g = genes;
      S.push([time, g.gateGlue.mean, g.gatePump.mean, g.gateEngine.mean, g.gateDiv.mean, g.gateTurn.mean, g.push.mean, g.leverA.mean, median]);
      if (S.length > 400) S.shift();
    }
  }

  /** A beat period bin as words: "4.5-7 R". */
  static binText(b) {
    if (b == null) return '-';
    const E = PERIOD_EDGES;
    return b === 0 ? `<${E[0]} R` : b >= E.length ? `>${E[E.length - 1]} R` : `${E[b - 1]}-${E[b]} R`;
  }

  /** The entropy panel's GUIDES line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census;
    if (!C || !C.n) return 'GUIDES  …';
    const g = C.genes, sg = (x) => `${x.mean >= 0 ? '+' : ''}${x.mean.toFixed(2)}±${x.sd.toFixed(2)}`;
    const gt = (k, name) => (this.gate(k) ? '' : '·off');
    const strong = GATES.map((k) => [k, C.strongest[k]]).sort((a, b) => b[1] - a[1])[0];
    if (compact) {
      return `GUIDES glue ${g.gateGlue.mean.toFixed(2)} pump ${g.gatePump.mean.toFixed(2)} eng ${g.gateEngine.mean.toFixed(2)} div ${g.gateDiv.mean.toFixed(2)} turn ${g.gateTurn.mean.toFixed(2)}` +
        ` · push ${g.push.mean.toFixed(2)}${p.null ? ' · NULL' : ''} · beat ${Guides.binText(C.period.median)}`;
    }
    const fa = `A lever ×${g.leverA.mean.toFixed(2)}±${g.leverA.sd.toFixed(2)} emit ×${g.emitA.mean.toFixed(2)} sense ${sg(g.senseA)} tune ×${g.tuneA.mean.toFixed(2)}`;
    const fb = `B lever ×${g.leverB.mean.toFixed(2)} emit ×${g.emitB.mean.toFixed(2)} sense ${sg(g.senseB)} pick ${g.pickB.mean.toFixed(2)}`;
    return `GUIDES${p.null ? '  NEUTRAL CONTROL (gates without effect)' : ''}  glue ${sg(g.gateGlue)}${gt('glue')} · pump ${sg(g.gatePump)}${gt('pump')} · engine ${sg(g.gateEngine)}${gt('engine')}` +
      ` · div ${sg(g.gateDiv)}${gt('div')} · turn ${sg(g.gateTurn)}${gt('turn')} · push ${sg(g.push)}${gt('push')}` +
      ` · strongest ${strong[0]} ${Math.round(100 * strong[1])}%, unguided ${Math.round(100 * C.strongest.none)}%` +
      ` · felt ${C.felt.toFixed(2)}, sides ±${C.spread.toFixed(2)}, gradient ${C.guide.toFixed(2)}` +
      `\nFIELD GENES${p.genes ? '' : ' (off: today\'s values for all)'}  ${fa} · ${fb} · beat period median ${Guides.binText(C.period.median)}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`fields as genes and guides (step C13): field genes ${on(p.genes)} · gates: glue ${on(this.gate('glue'))}, pump ${on(this.gate('pump'))}, engine ${on(this.gate('engine'))},` +
      ` division ${on(this.gate('div'))}, turn ${on(this.gate('turn'))} · push gene ${on(this.gate('push'))}${p.null ? ' · NEUTRAL CONTROL' : ''} · ref ${p.ref} · turn rate ${p.turnRate} rad/s`];
    if (C && C.n) {
      const g = C.genes, f = (k) => `${g[k].mean.toFixed(3)}±${g[k].sd.toFixed(3)}`;
      lines.push(`field genes: A ${['leverA', 'emitA', 'senseA', 'tuneA', 'angleA'].map((k) => `${SHORT[k]} ${f(k)}`).join(' ')} · B ${['leverB', 'emitB', 'senseB', 'pickB', 'angleB'].map((k) => `${SHORT[k]} ${f(k)}`).join(' ')}` +
        ` · A' share ${f('shareP')} sense ${f('senseP')}`);
      lines.push(`gates: ${GATES.map((k, j) => `${k} ${f(['gateGlue', 'gatePump', 'gateEngine', 'gateDiv', 'gateTurn'][j])} (strongest ${Math.round(100 * C.strongest[k])}%)`).join(' · ')} · push ${f('push')}` +
        ` · felt |s| ${C.felt.toFixed(3)}, side spread ${C.spread.toFixed(3)}, gradient ${C.guide.toFixed(3)} · glue factor |x-1| ${C.glueEff.toFixed(3)}, engine |x-1| ${C.rateEff.toFixed(3)}` +
        ` · beat periods ${C.period.hist.join('/')} (bins ${['<2', ...PERIOD_EDGES.map(String)].join(' ')} R)`);
      const S = this.series.slice(-8);
      if (S.length) lines.push(`gates every 30 s (glue/pump/engine/div/turn, push, lever A, period bin): ${S.map((x) => `${x[0].toFixed(0)}s ${x.slice(1, 6).map((v) => v.toFixed(2)).join('/')} ${x[6].toFixed(2)} ${x[7].toFixed(2)} ${x[8] ?? '-'}`).join(' · ')}`);
    }
    return lines;
  }
}
