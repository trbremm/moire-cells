// Step C12g: MEMBRANES MODULATE ION FLOW (the user, 2026-11-16: "Yes, membranes modulate ion flow"). Step C12e found that free ions
// crossed the membrane as easily as anything, so osmosis barely bit and cells kept their own oxygen; step C12f that a dark vent's cells
// flooded with its fast free givers g (turning +, pushed out by the vent's + charge field) and clogged so the sea's T could not get in.
// Real cells decide which ions pass. So, derived from what the membrane is made of (no rule names an ion or a cell type):
//
//   THE BILAYER BLOCKS IONS   per cell, the intact share of its membrane (its mean integrity: with the lipid membranes of step C12b the
//                             soap bilayer and the oil between its tails over what the thickness asks; with ?lipids=0 the C6c linker
//                             weave's) passes free ions (charged atoms: g t G T, and g* t*) only at ionPass (1/20) of a neutral
//                             molecule's rate, plus its CHANNELS; the damaged share (holes) passes them as a neutral molecule. The crust
//                             WALL is not part of the integrity: it is porous (as a bacterial wall). Neutral molecules pass as before.
//   CHANNELS (genes)          a cation channel (free givers, +) and an anion channel (free takers, -), each an open level (a share of a
//                             neutral molecule's rate, at most 1 with the bilayer's own leak), from two genes:
//                               gate2.w  the channels' LEVEL, a log factor on chanBase (0 = the knob's value, 0.2; -4..2), new
//                               memb.w   the C6c ION SELECTIVITY s, -1..1, now the channels' BALANCE
//                             cation = chanBase e^level (1 + s), anion = chanBase e^level (1 - s). Two numbers, two channels: any pair
//                             of levels has exactly one (level, balance), so the old gene is reused instead of a duplicate. (With the
//                             block off, s keeps its C6c meaning: all ion exchange x (1 +- s).)
//   STRETCH CHANNELS (C12e)   a swollen membrane opens a NON-selective path, kStretch e^gene x swelling of a neutral molecule's rate, for
//                             ions and neutral molecules alike (with the block: added to the ions' path, so a swollen cell lets its ions go)
//   PUMPS (C7)                the active route, untouched: they move what they move whatever the block
//   THE VOLTAGE HOLDS         a C7 membrane voltage leaks back as ions cross, so its leak x the mean share of a neutral's rate the two
//                             signs pass: a tight bilayer holds a voltage (and pumping one sign the same way gets dearer)
//   VOLTAGE PUSH (optional, ?ionvolt=1, off by default)  ions crossing the intact membrane (channels, the bilayer's leak, the stretch path)
//                             settle at inside / outside = exp(-z kV V) instead of 1: a + cell pushes its cations out and pulls anions in
//                             (a toy of electrophysiology; it biases where ions sit, it does not discharge the voltage: the C7 leak does)
//
// Books: nothing here makes or moves matter or energy by itself; it only changes the passive exchange's rates (and the voltage's leak
// rate, whose freed energy is booked as before). Founders: the level gene within +-0.5 (their own random stream), the balance within
// +-0.25 (it was +-0.08 in step C6c, so the founders' cation and anion channels differ a little). Mutation: level +- 0.06 a birth (as the
// stretch genes), balance +- 0.03 (as before).
//
// This module holds the switches and knobs (moire.ions.params), writes the eat pass's words (EatP io), reads the census back and gives
// the IONS panel line, the overlay lines and moire.sample()'s ions.*.

import { fmt } from './heat.js';

const LG_IO = 28416;   // heat_common.wgsl: 16 snapshot numbers x 16 slots, then 16 counters x 16 slots
const IZ = ['n', 'g', 'g2', 's', 's2', 'cat', 'an', 'csel', 'asel', 'pc', 'pa', 'tight', 'open', 'shut'];
const IC = ['cIn', 'cOut', 'aIn', 'aOut', 'cBlk', 'aBlk'];
const IOF = { BLOCK: 1, GENES: 2, VOLT: 4 };

export class Ions {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.ions.params). Switches: the rules panel's group "Ion flow (step C12g)" and URL options
    this.params = {
      block: true,      // the bilayer blocks free ions (needs the membrane chemistry; ?ionblock=0)
      genes: true,      // the channel genes act (off: every cell's channels at chanBase, balanced; the genes drift: the neutral control; ?channels=0)
      volt: false,      // ions through the intact membrane feel the membrane voltage (?ionvolt=1)
      // knobs
      ionPass: 0.05,    // an intact bilayer passes free ions at this share of a neutral molecule's rate (?ionpass=)
      chanBase: 0.2,    // the founders' channel level (gene 0, balance 0), the same kind of share (?chanbase=)
      kV: 4,            // the voltage push: inside / outside = exp(-z kV V) for what crosses the intact membrane (?kv=)
    };
    this.tot = Object.fromEntries(IC.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];   // every 10 s: [time, gene, sd, balance, sd, cat, an, pc, pa, cIn, aIn, cBlk, aBlk, tight, csel, asel]
  }

  get flags() {
    const p = this.params;
    return (p.block ? IOF.BLOCK : 0) | (p.genes ? IOF.GENES : 0) | (p.volt ? IOF.VOLT : 0);
  }

  /** The eat pass's words (struct EatP io[0], io[1] from word o). */
  write(u, f, o) {
    const p = this.params;
    u[o] = this.flags;
    f[o + 1] = Math.min(1, Math.max(0, p.ionPass)); f[o + 2] = Math.max(0, p.chanBase); f[o + 3] = Math.max(0, p.kV);
    f[o + 4] = 0; f[o + 5] = 0; f[o + 6] = 0; f[o + 7] = 0;
  }

  /** The heat's ledger read-back (through src/eat.js). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_IO + 16 * q + k]; return s; };
    const S = Object.fromEntries(IZ.map((k, q) => [k, v(q)]));
    const T = this.tot;
    IC.forEach((k, q) => { T[k] += v(16 + q); });
    const H = this.hist;
    H.push([rec.time, ...IC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const A = 4096;   // counts per substance unit
    const rate = Object.fromEntries(IC.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt / A : 0]));
    const n = Math.max(1, S.n);
    const mean = (x) => x / 1000 / n, sd = (s1, s2) => Math.sqrt(Math.max(0, s2 / 1000 / n - (s1 / 1000 / n) ** 2));
    const W = this.eat.waste && this.eat.waste.census;
    const passed = rate.cIn + rate.cOut + rate.aIn + rate.aOut, blocked = rate.cBlk + rate.aBlk;
    const C = {
      time: rec.time, n: S.n, gene: mean(S.g), sdGene: sd(S.g, S.g2), bal: mean(S.s), sdBal: sd(S.s, S.s2),
      cat: mean(S.cat), an: mean(S.an), passC: mean(S.pc), passA: mean(S.pa),
      csel: S.csel, asel: S.asel, tight: S.tight, open: S.open, shut: S.shut,
      rate, passed, blocked, blockShare: passed + blocked > 0 ? blocked / (passed + blocked) : 0,
      swell: W ? W.w : 0, up: W ? W.up : 0, down: W ? W.down : 0,
    };
    this.census = C;
    const Sr = this.series, last = Sr[Sr.length - 1];
    if (last && rec.time < last[0]) Sr.length = 0;
    if (!Sr.length || rec.time - Sr[Sr.length - 1][0] >= 10) {
      Sr.push([rec.time, C.gene, C.sdGene, C.bal, C.sdBal, C.cat, C.an, C.passC, C.passA, rate.cIn, rate.aIn, rate.cBlk, rate.aBlk, C.tight, C.csel, C.asel]);
      if (Sr.length > 400) Sr.shift();
    }
  }

  /** The entropy panel's IONS line. */
  panelLine(compact = false) {
    const C = this.census, p = this.params;
    if (!C) return 'IONS  …';
    const r = C.rate, pc = (x) => `${Math.round(100 * x)}%`, sg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(2)}`;
    const on = this.eat.membrane && this.eat.membrane.rule('on');
    const blk = !p.block ? 'bilayer passes ions (block off)' : !on ? 'no block (membrane chemistry off)' : `blocked ${pc(C.blockShare)}`;
    if (compact) return `IONS ${blk} · in + ${fmt(r.cIn)} − ${fmt(r.aIn)}/s · channels + ${C.cat.toFixed(2)} − ${C.an.toFixed(2)}`;
    return `IONS  ${blk} (held back + ${fmt(r.cBlk)} − ${fmt(r.aBlk)}/s) · passed in + ${fmt(r.cIn)} − ${fmt(r.aIn)}, out + ${fmt(r.cOut)} − ${fmt(r.aOut)}/s` +
      ` · membranes pass + ${pc(C.passC)} − ${pc(C.passA)} of a neutral's rate (tight ${C.tight})` +
      ` · channels${p.genes ? '' : ' (genes off)'} + ${C.cat.toFixed(2)} − ${C.an.toFixed(2)} (level ${sg(C.gene)}, balance ${sg(C.bal)}; + only ${C.csel}, − only ${C.asel})` +
      ` · swelling ${C.swell >= 0 ? '+' : '−'}${pc(Math.abs(C.swell))} (puffed ${C.up}, shrunk ${C.down})${p.volt ? ` · voltage push ${p.kV}` : ''}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`ion flow (step C12g): bilayer blocks ions ${on(p.block)} (passes ${p.ionPass} of a neutral's rate) · channel genes ${on(p.genes)}` +
      ` (base level ${p.chanBase}: cation = base e^level (1 + balance), anion = base e^level (1 − balance)) · voltage push ${on(p.volt)} (kV ${p.kV})`];
    if (C) {
      const r = C.rate;
      lines.push(`ions: passed in + ${fmt(r.cIn)} − ${fmt(r.aIn)}, out + ${fmt(r.cOut)} − ${fmt(r.aOut)}, held back + ${fmt(r.cBlk)} − ${fmt(r.aBlk)} per s` +
        ` (${(100 * C.blockShare).toFixed(1)}% held) · pass + ${C.passC.toFixed(3)} − ${C.passA.toFixed(3)} · tight ${C.tight} of ${C.n}` +
        ` · genes: level ${C.gene.toFixed(3)} ± ${C.sdGene.toFixed(3)} (above +1: ${C.open}, below −1: ${C.shut}), balance ${C.bal.toFixed(3)} ± ${C.sdBal.toFixed(3)}` +
        ` (> 0.3: ${C.csel}, < −0.3: ${C.asel}) · channels + ${C.cat.toFixed(3)} − ${C.an.toFixed(3)}`);
      lines.push(`ions every 10 s (level / balance, channels + / −, in + / −, held + / −): ${this.series.slice(-6).map((s) =>
        `${s[0].toFixed(0)}s ${s[1].toFixed(2)}/${s[3].toFixed(2)} ${s[5].toFixed(2)}/${s[6].toFixed(2)} ${fmt(s[9])}/${fmt(s[10])} ${fmt(s[11])}/${fmt(s[12])}`).join(' ')}`);
    }
    return lines;
  }
}
