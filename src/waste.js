// Step C12e: WASTE MUST LEAVE (the user, 2026-11-16: "oxygen leaks out because of reaction byproducts in nature, the cell has to
// expel co2 not to get saturated or too acidic"; then "osmosis on the ions could do the job actually. And the membrane
// permeability with it"; then "remember to tie that to genes too"). Two pressures, both DERIVED; no rule says "expel", "breather"
// or "toxin". Waste leaves only by what exists: the passive exchange (down the gradient) and the C7 pump genes (up it, paid).
//
//   SATURATION (mass action)  every reaction a cell runs (its engines, the table's reactions inside it, the cracking of grazed
//                             crust) runs at x (1 - Q / K): Q = its products' over its reactants' concentrations (shares of the
//                             stock's capacity), K = exp(drive / (theta x T)) (theta: the sparks' temperature scale, T the
//                             temperature under the cell), drive = the energy the event gives off: a downhill reaction's release,
//                             an uphill one's photon surplus over the rise + its spark. A big release is hard to clog, a small one
//                             clogs easily; nothing is set per substance. Not a gene: an engine is a catalyst, and a catalyst
//                             speeds a reaction both ways alike, so it cannot move the balance point. (The lipid builder's
//                             products go into the membrane, never into the stock, so it cannot clog.)
//   OSMOSIS ON THE IONS       the free ions inside (free givers and takers, counted by number; bonded molecules are neutral and do
//                             not count) per R^2 of the cell, minus those in the dish under it, per unit of the stock's capacity, is
//                             the PRESSURE. The cell SWELLS toward kOsm x pressure x its membrane's closure (mean integrity: a leaky
//                             membrane holds no pressure) / its stiffness (C12b: the bilayer's packing, the crust wall holds hardest,
//                             like a bacterial wall holding turgor; C6c: the material's), and shrinks below 0. Binding atoms into
//                             molecules lowers the load. The swelling is seen: the cell grows to sqrt(1 + swelling) of its size.
//                             A swollen membrane is THINNER (the same material over a longer outline: its integrity falls, so it
//                             leaks and holds less, by the C6c rules), its STRETCH CHANNELS open (gene) and past its STRETCH
//                             TOLERANCE (gene) it tears and bursts (the C6c burst: contents spilled where it is, matter exact)
//   GENES (mutating; founders and old genomes at 0 = the knob's value)
//     stretch channels        Bio.lip.w, a log factor: the passive exchange x (1 + kStretch x e^gene x swelling), with the
//                             permeability gene (like bacteria's mechanosensitive channels MscL / MscS); -4..2
//     stretch tolerance       Bio.gate2.z, a log factor: the swelling a whole membrane bears is wTol x e^gene; past it, it bursts at
//                             tearRate x (swelling / tolerance - 1) per s; it COSTS upkeep, upTol x e^gene per s (while osmosis is
//                             on: with it off both genes drift unpaid and without effect, the neutral control); -2..1.5
//     and the old ones feed in as they did: permeability (the exchange), pumps (C7), stiffness, thickness, lipid mix and wall
//     (C12b), which set how hard the swelling is resisted
//   PHOTOLYSIS (?photolysis=0, src/electrons.js)  light cannot free atoms in the open: no split, no uphill swap, no head off by light
//                             in the dish (the absorbed photon then glows or warms), so any free t in the dish is made by life
//
// Books: nothing here makes or moves matter by itself (the swelling changes the cell's area, so its capacity and concentrations;
// the stretch channels only scale the passive exchange); a reaction slowed by saturation simply runs fewer events; the stretch
// tolerance's upkeep goes from the battery to heat. Stock words 62, 63 count, per cell since its birth, the free t it MADE and the free
// t it TOOK IN net (exchange and pumps): the census of who lives on outside t (cell_eat.wgsl).
//
// This module holds the switches and knobs (moire.waste.params), writes the eat pass's words (EatP ws, ws2), reads the census back
// and gives the WASTE panel line, the overlay lines and moire.sample()'s waste.*.

import { fmt, HEAT_SCALE } from './heat.js';
import { PUMP_CHANNELS } from './genome.js';
import { CH } from './matter.js';

const LG_WS = 27776;   // heat_common.wgsl: 16 snapshot numbers x 16 slots, then 16 counters x 16 slots
const WS = ['n', 'P', 'w', 'up', 'down', 'imp', 'exp', 'br', 'outb', 'selfb', 'gch', 'gch2', 'gtol', 'gtol2', 'ions', 'k'];
const WC = ['want', 'lost', 'tMade', 'tIn', 'tOut', 'tear', 'upkeep'];
const WSF = { SAT: 1, OSM: 2, STRETCH: 4, TEAR: 8, COST: 16 };

export class Waste {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.waste.params). Switches: the rules panel's group "Waste must leave (step C12e)" and URL options
    this.params = {
      saturation: true,   // mass action: products pile up, reactions slow (?saturation=0)
      osmosis: true,      // osmosis on the ions: cells swell and shrink (?osmosis=0)
      stretch: true,      // ... a stretched membrane's channels open (the stretch channels gene; ?stretch=0)
      tear: true,         // ... past its stretch tolerance a whole membrane tears and bursts (?tear=0; bursting needs turnover)
      cost: true,         // ... the stretch tolerance costs upkeep (?tolcost=0)
      // knobs
      satScale: 1,        // saturation: x theta x T in K = exp(drive / (satScale theta T)) (1: the sparks' own temperature scale)
      kOsm: 10,           // osmosis: swelling (area share) per unit of pressure at stiffness 1 (10: the loaded tenth of the cells swell or shrink by 3 to 25 %)
      rate: 1,            // ... the swelling's relaxation rate (per s; the radius follows at 0.8 per s)
      wMax: 1,            // ... the most a cell swells (area share: 1 = twice its area)
      wMin: -0.4,         // ... the most it shrinks
      kStretch: 3,        // stretch channels at gene 0: the passive exchange x (1 + kStretch x swelling)
      wTol: 0.5,          // stretch tolerance at gene 0 (swelling)
      tearRate: 2,        // bursts per s per unit of relative excess past the tolerance
      upTol: 0.003,       // the stretch tolerance's upkeep at gene 0 (energy per s; x e^gene)
    };
    this.tot = Object.fromEntries(WC.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];   // every 10 s: [time, P, w, lostShare, tMade, tIn, tOut, outb, selfb, gch, gtol, sdch, sdtol, tear, freeT]
  }

  get flags() {
    const p = this.params;
    return (p.saturation ? WSF.SAT : 0) | (p.osmosis ? WSF.OSM : 0) | (p.stretch ? WSF.STRETCH : 0) | (p.tear ? WSF.TEAR : 0) | (p.cost ? WSF.COST : 0);
  }

  /** The eat pass's words (struct EatP ws[0], ws[1], ws2 from word o). */
  write(u, f, o, dt) {
    const p = this.params;
    u[o] = this.flags;
    f[o + 1] = Math.max(1e-3, p.satScale); f[o + 2] = Math.max(0, p.kOsm); f[o + 3] = Math.max(0, p.rate);
    f[o + 4] = Math.max(0, p.wMax); f[o + 5] = Math.min(0, Math.max(-0.75, p.wMin)); f[o + 6] = Math.max(0, p.kStretch); f[o + 7] = Math.max(1e-3, p.wTol);
    f[o + 8] = Math.max(0, p.tearRate); f[o + 9] = Math.max(0, p.upTol) * HEAT_SCALE * dt; f[o + 10] = 0; f[o + 11] = 0;
  }

  /** The heat's ledger read-back (through src/eat.js). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_WS + 16 * q + k]; return s; };
    const S = Object.fromEntries(WS.map((k, q) => [k, v(q)]));
    const T = this.tot;
    WC.forEach((k, q) => { T[k] += v(16 + q) * (k === 'want' || k === 'lost' ? 16 : 1); });
    const H = this.hist;
    H.push([rec.time, ...WC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const rate = Object.fromEntries(WC.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const A = 4096, n = Math.max(1, S.n);
    // per s: reaction events and t in substance units, the tear count as cells, the upkeep in energy
    for (const k of ['want', 'lost', 'tMade', 'tIn', 'tOut']) rate[k] /= A;
    rate.upkeep /= HEAT_SCALE;
    const mean = (x) => x / 1000 / n, sd = (s1, s2) => Math.sqrt(Math.max(0, s2 / 1000 / n - (s1 / 1000 / n) ** 2));
    const P = this.eat.pumps && this.eat.pumps.census, nP = PUMP_CHANNELS.length;
    const pump = (name, out) => { const b = PUMP_CHANNELS.indexOf(CH[name]); return P && P.genes && b >= 0 ? P.genes[b + (out ? nP : 0)] : 0; };
    const D = this.eat.matter ? this.eat.matter.dish : null;
    const C = {
      time: rec.time, n: S.n, P: mean(S.P), w: mean(S.w), up: S.up, down: S.down, ions: mean(S.ions), k: mean(S.k),
      imp: S.imp, exp: S.exp, br: S.br, outb: S.outb, selfb: S.selfb,
      gch: mean(S.gch), gtol: mean(S.gtol), sdch: sd(S.gch, S.gch2), sdtol: sd(S.gtol, S.gtol2),
      rate, lostShare: rate.want > 0 ? rate.lost / rate.want : 0,
      pumps: { tOut: pump('t', true), tIn: pump('t', false), gtOut: pump('gt', true), gtIn: pump('gt', false), TOut: pump('T', true), TIn: pump('T', false),
        gOut: pump('g', true), GtOut: pump('Gt', true), gTIn: pump('gT', false), GTIn: pump('GT', false) },
      freeT: D ? D[CH.t] : 0,
    };
    this.census = C;
    const Sr = this.series, last = Sr[Sr.length - 1];
    if (last && rec.time < last[0]) Sr.length = 0;
    if (!Sr.length || rec.time - Sr[Sr.length - 1][0] >= 10) {
      Sr.push([rec.time, C.P, C.w, C.lostShare, rate.tMade, rate.tIn, rate.tOut, C.outb, C.selfb, C.gch, C.gtol, C.sdch, C.sdtol, rate.tear, C.freeT]);
      if (Sr.length > 400) Sr.shift();
    }
  }

  /** The entropy panel's WASTE line. */
  panelLine(compact = false) {
    const C = this.census, p = this.params;
    if (!C) return 'WASTE  …';
    const r = C.rate, pc = (x) => `${Math.round(100 * x)}%`, sg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
    const sat = p.saturation ? `saturation −${pc(C.lostShare)}` : 'saturation off';
    const osm = p.osmosis ? `pressure ${sg(C.P)} · swelling ${C.w >= 0 ? '+' : '−'}${pc(Math.abs(C.w))}` : 'osmosis off';
    if (compact) return `WASTE ${sat} · ${osm} · torn ${fmt(r.tear)}/s · t out ${fmt(r.tOut)}/s`;
    const Pm = C.pumps;
    return `WASTE  ${sat} of the reactions inside · ${osm} (puffed ${C.up}, shrunk ${C.down}) · torn ${fmt(r.tear)}/s` +
      ` · free t made ${fmt(r.tMade)}/s, taken in ${fmt(r.tIn)}/s, put out ${fmt(r.tOut)}/s · breathers ${C.br}: on outside t ${C.outb}, on their own ${C.selfb}` +
      ` · pumps t OUT ${Pm.tOut} IN ${Pm.tIn}, gt OUT ${Pm.gtOut}, T OUT ${Pm.TOut} · genes: stretch channels ${sg(C.gch)}, tolerance ${sg(C.gtol)}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`waste must leave (step C12e): saturation ${on(p.saturation)} (scale ${p.satScale}) · osmosis ${on(p.osmosis)}: kOsm ${p.kOsm}, rate ${p.rate}/s,` +
      ` swelling ${p.wMin}..${p.wMax} · stretch channels ${on(p.stretch)} (kStretch ${p.kStretch}) · tear ${on(p.tear)} (tolerance ${p.wTol}, ${p.tearRate}/s) · tolerance upkeep ${on(p.cost)} (${p.upTol}/s)`];
    if (C) {
      const r = C.rate;
      lines.push(`waste: reaction events wanted ${fmt(r.want)}/s, lost to saturation ${fmt(r.lost)}/s (${(100 * C.lostShare).toFixed(1)}%) · pressure ${C.P.toFixed(3)} (free ions inside ${C.ions.toFixed(3)}/R²)` +
        ` · swelling ${C.w.toFixed(3)} against stiffness ${C.k.toFixed(2)} · puffed ${C.up} shrunk ${C.down} of ${C.n} · torn ${fmt(r.tear)}/s · upkeep ${fmt(r.upkeep)}/s` +
        ` · t made ${fmt(r.tMade)}, in ${fmt(r.tIn)}, out ${fmt(r.tOut)} per s · net importers ${C.imp}, exporters ${C.exp} · breathers ${C.br} (outside t ${C.outb}, own ${C.selfb})` +
        ` · genes: channels ${C.gch.toFixed(3)} ± ${C.sdch.toFixed(3)}, tolerance ${C.gtol.toFixed(3)} ± ${C.sdtol.toFixed(3)}` +
        ` · pumps ${Object.entries(C.pumps).map(([k, x]) => `${k} ${x}`).join(' ')}`);
      lines.push(`waste every 10 s (P / swelling / lost, made / in / out t, outside / own breathers, genes ch / tol): ${this.series.slice(-6).map((s) =>
        `${s[0].toFixed(0)}s ${s[1].toFixed(2)}/${s[2].toFixed(2)}/${(100 * s[3]).toFixed(0)}% ${fmt(s[4])}/${fmt(s[5])}/${fmt(s[6])} ${s[7]}/${s[8]} ${s[9].toFixed(2)}/${s[10].toFixed(2)}`).join(' ')}`);
    }
    return lines;
  }
}
