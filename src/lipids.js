// Step C12b: LIPID MEMBRANES, ELASTICITY FROM THE LIPIDS (user 2026-11-15: "Lipids should be connected with elasticity. In the
// membrane"; then, unsure: "I just know that bacteria have a lipid membrane", so closer to real cells). The membrane of step C6c
// (a weave of linkers) becomes a LIPID layer, and how stiff each side is follows from what it is made of:
//
//   bilayer   SOAP, the amphiphiles of step C12 (glL +, tlL -: a charged head on an oily tail), is the bilayer itself. OIL (lL)
//             slips in between the soap's tails (at most oilCap, 1, per soap molecule) and stiffens it, as cholesterol and hopanoids
//             do in real membranes. The integrity of a side is its bilayer (soap + the oil between its tails) over what the
//             thickness gene asks; leak, hold, softness and bursting (step C6c) follow it as before.
//   wall      CRUST (ll, LL: one-row chains, which pack into a crystal) builds a WALL outside the bilayer, like a bacterium's cell
//             wall: the part that really holds a bacterium's shape. Rigid and brittle: where the outline is JOLTED (a corner swinging
//             by more than crackAt x r: its speed over its own wobble's angular frequency) it CRACKS: the crust of those sides
//             breaks off into the dish. Slow packing does not crack it; a shove (a stir, a crowd pushing through) does.
//   stiffness DERIVED, never set per molecule. From the polarity numbers of step C12 (polarity() in src/matter.js: head = the
//             charged atoms' share, tail = the chained linkers' share): the bilayer's packing ratio = its tail atoms / its head
//             atoms, over pure soap's (2 / 1), so pure soap is 1 and soap with one oil per soap is 2 (oil brings tails, no heads),
//             x 2 / (1 + T / Tref) (HEAT makes the bilayer fluid: x 2 when cold, x 1 at Tref, falling as 1 / T when hot). Then x (soft +
//             (1 - soft) x integrity) (a damaged side is softer, as in C6c), x sqrt(thickness / tRef) x the stiffness gene (both
//             kept from C6c), and the wall's cover takes it toward the honeycomb's stiffest (4): a crystal does not bend.
//             The fluidity, 1 / (1 + stiffness), also sets how fast the bilayer reseals (rebuilds at repK x 2 / (1 + k)) and how
//             exposed it is to bites (x 2 / (1 + k)): fluid soap is soft, wobbly, quick to heal and easy to bite.
//   genes     memb.x, the C6c MIX gene, becomes the OIL SHARE (oil per soap, 0..1); Bio.lip: x the WALL (a share of a full wall,
//             which holds as much crust as the bilayer holds lipid), y the HEAD (-1 all t: tlL, 1 all g: glL), z the wall's ROW
//             (its heavy share). The thickness and stiffness genes stay. Mutation: small additive steps.
//   supply    a side short of soap or oil first takes it from the dish under the cell as it is (FUSION, the C12 switch, extended
//             to soap: self-assembly, free); then the BUILDER makes what is still short from the stock's atoms (soap = a head g
//             or t + l + L, oil = l + L, crust = l + l or L + L), paying each molecule's bond sparks from the battery and
//             releasing its bonds' energy, both as heat (the reaction table's numbers). Extra is shed into the dish whole.
//   bites     the C6c rule, derived from the atoms: a free reactive atom bites the chains of its own row, so each lipid by the
//             light (l) and heavy (L) linkers its chain holds: soap and oil (l + L) by both rows, ll only by light atoms, LL only
//             by heavy ones; at exp(-its chain's spark / (theta x T)). The wall is outside: the bilayer is exposed only where no
//             crust covers it. A bite pulls the molecule out whole into the dish.
//   charge    the soap heads carry charge: a membrane rich in glL (+) or tlL (-) charges the cell (field B, the substrate's field)
//             and, with the dipoles on, its own sides (step C6d). The books count the membrane's molecules as their atoms.
//   bursts    a burst or a death spills the membrane's lipids into the dish as they are: soap and oil gather into films and
//             droplets there (step C12), crust sits as crust.
// Nothing says "be stiff when hot" (homeoviscous adaptation): only watched for (the census, in the light and in the dark).
//
// The books: matter and charge exact (the membrane's molecules count as their atoms in the cells' ledger); the lipids' chemical
// energy (below the free atoms') counts as stored (LG_LIP_E); the builder's sparks and released bond energy go to heat.
//
// This module holds the switches and knobs (moire.lipids.params, .look), writes the eat pass's words (EatP.lp), reads the census
// back, and gives the LIPIDS panel line, the overlay lines and stats() for the experiments.

import { fmt, HEAT_SCALE } from './heat.js';
import { SUBSTANCES, CH, CHEM, ATOMS } from './matter.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';

const LG_LIP_E = 22528, LG_LIP_S = 22656, LG_LIP_C = 22912;   // heat_common.wgsl
export const LIP_SNAP = { E: LG_LIP_E, S: LG_LIP_S, E_WORDS: 128, S_WORDS: 256 };
const KINDS = ['glL', 'tlL', 'lL', 'll', 'LL'];               // LK_* in cell_eat.wgsl, stock words 32 + 6 x kind + side
const KIND_CH = [14, 15, 13, 10, 11];
KINDS.forEach((k, j) => { if (CH[k] !== KIND_CH[j]) throw new Error(`cell_eat.wgsl lk_ch expects ${k} in channel ${KIND_CH[j]}`); });
const CNT = ['biteB', 'biteW', 'soap', 'oil', 'wall', 'fused', 'shed', 'crack'];   // LC_* in cell_eat.wgsl
export const LIP_STOCK0 = 32;

// the derived numbers per lipid kind (soap, oil, ll, LL), from the atoms (no per-molecule constants)
const S_ = (n) => SUBSTANCES[CH[n]];
const bonds = (s) => s.atoms.slice(1).map((a, k) => [ATOMS[s.atoms[k]], ATOMS[a]]);
const sparkOf = (a, b) => CHEM.sparkPerRow * (a.row + b.row);
/** All the bonds' sparks of a molecule (what making it from atoms costs), energy units. */
const buildSpark = (s) => bonds(s).reduce((x, [a, b]) => x + sparkOf(a, b), 0);
/** Its chain's sparks (the linker-linker bonds: what a bite breaks), energy units. */
const chainSpark = (s) => bonds(s).reduce((x, [a, b]) => x + (a.group === 'linker' && b.group === 'linker' ? sparkOf(a, b) : 0), 0);
const linkers = (s, row) => s.atoms.filter((a) => ATOMS[a].group === 'linker' && ATOMS[a].row === row).length;
const LK4 = ['glL', 'lL', 'll', 'LL'];
export const LIPID_TABLE = LK4.map((n) => {
  const s = S_(n);
  return { name: n, atoms: s.atoms.length, head: s.head * s.atoms.length, tail: s.tail * s.atoms.length, chainSpark: chainSpark(s),
    buildSpark: buildSpark(s), release: -s.energy, light: linkers(s, 1), heavy: linkers(s, 2), energy: s.energy };
});

export class Lipids {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.lipids.params). Switches: the rules panel's group "Lipid membranes (step C12b)" and URL options.
    this.params = {
      on: true,         // lipid membranes (master; off: the C6c linker membrane, exactly as before; ?lipids=0)
      heat: true,       // heat makes the bilayer fluid (stiffness x 2 / (1 + T / Tref); ?lipheat=0)
      crack: true,      // a strained wall cracks (?crack=0)
      heads: true,      // the soap's heads charge the cell and its sides (?lipheads=0)
      // knobs
      tRef: 3,          // the temperature (heat per R^2) at which pure soap has stiffness 1 (the default scene: about 1 to 2 in the
                        // dark, 8 to 10 in the spot)
      crackAt: 0.1,     // a corner swinging by more than this share of r (its speed / its wobble's angular frequency) cracks its sides' wall
      crackLoss: 0.5,   // ... this share of their crust breaks off per tick
      fuseK: 1,         // fusion: share of a side's shortfall of soap or oil taken from the dish per s
      oilCap: 1,        // oil molecules one soap molecule holds between its tails at most
      kMin: 0.25,       // the softest a side gets
    };
    this.look = {
      on: true,         // draw the membranes' make-up (soap pearly, oil glossy, crust as an outer rim)
      pearl: 0.55,      // a soap bilayer's pearly, iridescent sheen on the tube (0..1)
      gloss: 0.5,       // an oily bilayer's deeper, glossier tube (0..1)
      rim: 0.22,        // a full wall's rim: its width as a share of the radius
      rimBright: 0.8,   // ... its brightness (flat, crisp: crust is dark matter, not a lamp)
      brick: 0.42,      // ... the bricks' length, as a share of the radius
    };
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.energy = 0;      // the lipids' chemical energy in all membranes (energy units; negative)
    this.held = new Float64Array(16);   // per channel: the molecules held in membranes (units; for the dish's active channels)
    this.series = [];     // every 10 s: [time, soap, oil, wall, oil gene, wall gene, stiffness, lit oil, dark oil, lit k, dark k, walled]
  }

  /** Whether a sub-rule acts (cells eat, the membrane chemistry and the master on, and its own). */
  rule(k) { const M = this.eat.membrane; return !!(M.rule('on') && this.params.on && (k === 'on' || this.params[k])); }
  /** Whether the lipid membranes are what the cells are wrapped in now. */
  get active() { return this.rule('on'); }

  /** The eat uniform's lipid words (struct EatP lp[8], from word o). */
  write(u, f, o) {
    const p = this.params, T = LIPID_TABLE;
    u[o] = (this.rule('on') ? 1 : 0) | (this.rule('heat') ? 2 : 0) | (this.rule('crack') ? 4 : 0) | (this.rule('heads') ? 8 : 0);
    f[o + 1] = Math.max(1e-3, p.tRef); f[o + 2] = Math.max(0, p.crackAt); f[o + 3] = Math.max(0, Math.min(1, p.crackLoss));
    // the polarity's atoms: soap's head and tail atoms, oil's head and tail atoms
    f[o + 4] = T[0].head; f[o + 5] = T[0].tail; f[o + 6] = T[1].head; f[o + 7] = T[1].tail;
    T.forEach((t, j) => {
      f[o + 8 + j] = t.chainSpark;
      f[o + 12 + j] = Math.round(16 * t.buildSpark);    // heat counts per count (exact: multiples of 1/16)
      f[o + 16 + j] = Math.round(16 * t.release);
      f[o + 24 + j] = t.light;
      f[o + 28 + j] = t.heavy;
    });
    f[o + 20] = Math.max(0, p.fuseK); f[o + 21] = Math.max(0, p.oilCap); f[o + 22] = Math.max(0.01, p.kMin);
    f[o + 23] = this.eat.membrane.params.soft;
    const SH = this.eat.cells.shape;   // the honeycomb corners' angular frequency at stiffness 1 (as cells.js writeFields)
    f[o + 32] = 2 * Math.PI * SH.wobbleHz * Math.sqrt(Math.max(0.01, SH.stiffness)); f[o + 33] = 0; f[o + 34] = 0; f[o + 35] = 0;
  }

  /** The drawing's words (struct Draw lip, lip2, lipInk[3], from float a[o]). */
  writeDraw(a, o, palette) {
    const L = this.look, on = L.on && this.active;
    a[o] = on ? 1 : 0; a[o + 1] = L.pearl; a[o + 2] = L.gloss; a[o + 3] = L.rim;
    a[o + 4] = L.rimBright; a[o + 5] = L.brick; a[o + 6] = 0; a[o + 7] = 0;
    const I = palette || {};
    const put = (k, rgb) => { for (let j = 0; j < 3; j++) a[o + 8 + 4 * k + j] = rgb[j]; a[o + 11 + 4 * k] = 0; };
    put(0, I.crustLight || [0.62, 0.4, 0.16]);   // a light (ll) crust: dim amber
    put(1, I.crustHeavy || [0.4, 0.22, 0.1]);    // a heavy (LL) crust: deeper brown
    put(2, I.pearl || [0.92, 0.9, 1.0]);         // soap's pearl
  }

  /** The heat's ledger read-back (Int32 words; called by src/eat.js apply, before it books the cells' chemical energy). */
  apply(rec, w) {
    const wide = (a) => { let s = 0; for (let k = a; k < a + 64; k++) s += w[k + 64] * 4294967296 + (w[k] >>> 0); return s; };
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_LIP_S + 16 * q + k]; return s; };
    const c = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_LIP_C + 16 * q + k]; return s; };
    this.energy = -wide(LG_LIP_E) / HEAT_SCALE;
    const A = 4096, T = this.tot;
    CNT.forEach((k, j) => { T[k] += c(j) / A; });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    const dt = rec.time - H[0][0];
    const rate = Object.fromEntries(CNT.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0]));
    const held = KINDS.map((k, j) => v(j) / A);
    this.held.fill(0);
    KIND_CH.forEach((ch, j) => { this.held[ch] = held[j]; });
    const n = Math.max(1, v(5)), nl = v(10), nd = v(5) - v(10);
    const C = {
      time: rec.time, n: v(5), soapP: held[0], soapM: held[1], soap: held[0] + held[1], oil: held[2], ll: held[3], LL: held[4],
      wall: held[3] + held[4], oilGene: v(6) / 1000 / n, wallGene: v(7) / 1000 / n, stiff: v(8) / 1000 / n, walled: v(9),
      temp: v(14) / 100 / n, energy: this.energy,
      lit: { n: nl, oil: nl ? v(11) / 1000 / nl : 0, stiff: nl ? v(12) / 1000 / nl : 0, temp: nl ? v(13) / 100 / nl : 0, wall: nl ? v(15) / 1000 / nl : 0 },
      dark: { n: nd, oil: nd > 0 ? (v(6) - v(11)) / 1000 / nd : 0, stiff: nd > 0 ? (v(8) - v(12)) / 1000 / nd : 0,
        temp: nd > 0 ? (v(14) - v(13)) / 100 / nd : 0, wall: nd > 0 ? (v(7) - v(15)) / 1000 / nd : 0 },
      rate, tot: { ...T },
    };
    this.census = C;
    const S = this.series, last = S[S.length - 1];
    if (last && rec.time < last[0]) S.length = 0;
    if (!S.length || rec.time - S[S.length - 1][0] >= 10) {
      S.push([rec.time, C.soap, C.oil, C.wall, C.oilGene, C.wallGene, C.stiff, C.lit.oil, C.dark.oil, C.lit.stiff, C.dark.stiff, C.walled / n]);
      if (S.length > 400) S.shift();
    }
  }

  /**
   * For the experiments (console, tools): reads the cells, genomes and stocks back. Per founder lineage: cells, the genes (oil
   * share, wall, head, the wall's row, thickness), what the membranes hold (soap +, soap -, oil, crust per cell, units), the mean
   * side stiffness, wall cover and oil share as the eat pass worked them out, and the battery; and the same split by the light
   * (cells whose centre is in the light: hot in a spotlight scene) against the rest.
   */
  async stats() {
    const E = this.eat, C = E.cells, d = C.device, n = C.count, F = CELL_FLOATS, B = BIO_FLOATS;
    const read = async (src, bytes) => {
      const buf = d.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = d.createCommandEncoder();
      e.copyBufferToBuffer(src, 0, buf, 0, bytes);
      d.queue.submit([e.finish()]);
      await buf.mapAsync(GPUMapMode.READ);
      const out = buf.getMappedRange().slice(0);
      buf.destroy();
      return out;
    };
    const SW = E.stockBuf.size / 4 / n;
    const cf = new Float32Array(await read(C.cellBuf, n * F * 4)), cu = new Uint32Array(cf.buffer);
    const g = new Float32Array(await read(C.bioBuf[C.bioCur], n * B * 4));
    const st = new Int32Array(await read(E.stockBuf, n * SW * 4));
    // in the light: the whole dish in full field; in the spot's disc (its tilt's stretch ignored) with a spot
    const Lt = C.heat && C.heat.light, sp = Lt && Lt.modeIndex === 1 ? Lt.spot() : null;
    const lit = (x, y) => (!Lt ? false : Lt.modeIndex === 2 ? true : sp ? Math.hypot(x - sp.x, y - sp.y) < sp.r : false);
    const grp = () => ({ n: 0, oilGene: 0, wallGene: 0, head: 0, row: 0, thick: 0, soapP: 0, soapM: 0, oil: 0, ll: 0, LL: 0, stiff: 0, cover: 0, oilShare: 0, bat: 0 });
    const add = (G, i) => {
      const o = i * F, b = i * B, s = i * SW;
      G.n++; G.oilGene += g[b + 40]; G.thick += g[b + 41]; G.wallGene += g[b + 52]; G.head += g[b + 53]; G.row += g[b + 54];
      const sum = (kind) => { let x = 0; for (let k = 0; k < 6; k++) x += st[s + LIP_STOCK0 + 6 * kind + k]; return x / 4096; };
      G.soapP += sum(0); G.soapM += sum(1); G.oil += sum(2); G.ll += sum(3); G.LL += sum(4);
      let ks = 0, cv = 0, os = 0;
      for (let k = 0; k < 6; k++) {
        const wd = cu[o + 72 + k];
        ks += (wd & 255) / 255 * 4 / 6; os += ((wd >>> 16) & 255) / 255 / 6; cv += (wd >>> 24) / 255 / 6;
      }
      G.stiff += ks; G.cover += cv; G.oilShare += os; G.bat += cf[o + 16];
    };
    const fin = (G) => { for (const k of Object.keys(G)) if (k !== 'n') G[k] = G.n ? G[k] / G.n : 0; return G; };
    const byF = new Map(), L = grp(), D = grp(), all = grp();
    for (let i = 0; i < n; i++) {
      if (!(cu[i * F + 9] & 1)) continue;
      const f = Math.round(g[i * B + 7]);
      if (!byF.has(f)) byF.set(f, grp());
      add(byF.get(f), i); add(all, i);
      add(lit(cf[i * F], cf[i * F + 1]) ? L : D, i);
    }
    const founders = [...byF.entries()].sort((a, b) => b[1].n - a[1].n).map(([f, G]) => ({ founder: f, ...fin(G) }));
    this.last = { all: fin(all), lit: fin(L), dark: fin(D) };   // (moire.sample() includes it as lipstats.*)
    return { ...this.last, founders };
  }

  /** The entropy panel's LIPIDS line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.eat.params.on) return 'LIPIDS  (cells eat is off: Shift+A)';
    if (!this.eat.membrane.params.on) return 'LIPIDS  (membrane chemistry is off)';
    if (!this.params.on) return 'LIPIDS  off: the C6c linker membrane (rules panel)';
    if (!C || !C.n) return 'LIPIDS  …';
    const r = C.rate;
    if (compact) return `LIPIDS soap ${fmt(C.soap)} · oil ${fmt(C.oil)} · wall ${fmt(C.wall)} · stiff ${C.stiff.toFixed(2)}`;
    const lt = C.lit.n ? ` · lit: oil ${C.lit.oil.toFixed(2)} k ${C.lit.stiff.toFixed(2)} T ${C.lit.temp.toFixed(1)} | dark: oil ${C.dark.oil.toFixed(2)} k ${C.dark.stiff.toFixed(2)} T ${C.dark.temp.toFixed(1)}` : '';
    return `LIPIDS  soap ${fmt(C.soap)} (+${fmt(C.soapP)} −${fmt(C.soapM)}) · oil ${fmt(C.oil)} · wall ${fmt(C.wall)} · genes: oil ${C.oilGene.toFixed(2)} wall ${C.wallGene.toFixed(2)}` +
      ` · walled ${Math.round(100 * C.walled / Math.max(1, C.n))}% · stiffness ${C.stiff.toFixed(2)} · per s: made ${fmt(r.soap + r.oil + r.wall)} fused ${fmt(r.fused)} bitten ${fmt(r.biteB)}+${fmt(r.biteW)} cracked ${fmt(r.crack)}${lt}`;
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census, T = LIPID_TABLE;
    const lines = [`lipid membranes (step C12b) ${on(p.on)}: heat fluidises ${on(p.heat)} · walls crack ${on(p.crack)} · heads charge ${on(p.heads)} · Tref ${p.tRef}` +
      ` · crack at ${p.crackAt} (${p.crackLoss}/tick) · fusion ${p.fuseK}/s · oil per soap ≤ ${p.oilCap} · softest ${p.kMin}` +
      ` · table: ${T.map((t) => `${t.name} head ${t.head} tail ${t.tail} chain spark ${t.chainSpark} build ${t.buildSpark}+${t.release}`).join(', ')}`];
    if (C && C.n) {
      const r = C.rate;
      lines.push(`lipids: ${C.n} cells · in membranes soap +${fmt(C.soapP)} −${fmt(C.soapM)}, oil ${fmt(C.oil)}, crust ll ${fmt(C.ll)} LL ${fmt(C.LL)} (energy ${fmt(C.energy)})` +
        ` · genes oil ${C.oilGene.toFixed(3)} wall ${C.wallGene.toFixed(3)} · stiffness ${C.stiff.toFixed(3)} · walled ${C.walled} · T ${C.temp.toFixed(2)}` +
        ` · per s: made soap ${fmt(r.soap)} oil ${fmt(r.oil)} wall ${fmt(r.wall)}, fused ${fmt(r.fused)}, shed ${fmt(r.shed)}, bitten bilayer ${fmt(r.biteB)} wall ${fmt(r.biteW)}, cracked ${fmt(r.crack)}` +
        ` · lit ${C.lit.n}: oil ${C.lit.oil.toFixed(3)} wall ${C.lit.wall.toFixed(3)} k ${C.lit.stiff.toFixed(3)} T ${C.lit.temp.toFixed(2)} · dark ${C.dark.n}: oil ${C.dark.oil.toFixed(3)} wall ${C.dark.wall.toFixed(3)} k ${C.dark.stiff.toFixed(3)} T ${C.dark.temp.toFixed(2)}`);
      lines.push(`lipids every 10 s (soap/oil/wall, oil gene lit|dark, k lit|dark): ${this.series.slice(-6).map((s) => `${s[0].toFixed(0)}s ${fmt(s[1])}/${fmt(s[2])}/${fmt(s[3])} ${s[7].toFixed(2)}|${s[8].toFixed(2)} ${s[9].toFixed(2)}|${s[10].toFixed(2)}`).join(' ')}`);
    }
    return lines;
  }
}
