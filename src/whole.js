// Step M1: WHOLE MEMBRANES (Claude's call, 2026-11-16, BUILD QUEUE 2c). Membranes were mostly holes (mean integrity 0.05 to 0.25), so the
// C12g ion block, C12e osmosis and the coming T1 "inside" could not act. This module first COUNTS the membrane material's budget (what
// comes into the bilayers and what leaves them, per kind, and what the builder lacked), then holds the fixes the counts pointed to, each
// its own switch, all derived from the reaction table and the existing rules (README "Step M1: whole membranes"):
//
//   BITES THROUGH THE BLOCK (biteBlock)  the biting atoms (C6c, C12b) are free IONS (g t G T, g* t*), and an intact bilayer keeps ions
//                          off its oily core: that is step C12g's block. So they bite a side's chains where it is damaged (its holes'
//                          edges) and through the intact share only at the bilayer's own ion leak (ionPass): the bilayer's exposure x
//                          ((1 - the side's integrity) + integrity x ionPass). Needs the ion block on. The crust wall, outside, as before.
//   HEAD ON OIL (oilSoap)  a side short of soap whose oil is more than its soap's tails take puts a head from the stock on it (g + lL ->
//                          glL, t + lL -> tlL: the table's "head on", which step C12 ran only in the open dish), paid as the table says
//                          (the head bond's spark from the battery). Fusion takes oil for it too, and oil waiting for a head is not shed.
//
// Books: the counters only count; head on oil moves atoms (a head from the stock into a soap, the oil's l and L with it) and energy (the
// battery's spark, the release as heat; the lipids' chemical energy is the ledger's snapshot) exactly, in whole counts.
//
// This module holds the switches and knobs (moire.whole.params), writes the eat pass's words (EatP m1), reads the counters and the
// census back and gives the MEMBRANES panel line, the overlay lines and moire.sample()'s whole.*.

import { fmt } from './heat.js';

const LG_M1 = 30976;   // heat_common.wgsl: 16 snapshot numbers x 16 slots, then 16 counters x 16 slots
const MZ = ['n', 'integ', 'b0', 'b1', 'b2', 'b3', 'b4', 'want', 'held', 'hasL', 'hasl', 'hasAll', 'empty', 'xoil'];
const MC = ['fuseS', 'fuseO', 'madeS', 'madeO', 'biteS', 'biteO', 'shedS', 'shedO', 'spill', 'split', 'shHead', 'shl', 'shL', 'shBat', 'headOn'];
const M1F = { OILSOAP: 1, BITEBLOCK: 2 };

export class Whole {
  constructor(eat) {
    this.eat = eat;
    // live-tunable (moire.whole.params). Switches: the rules panel's group "Whole membranes (step M1)" and URL options
    this.params = {
      oilSoap: true,    // a cell puts a head on oil to make soap (the table's "head on", inside the cell; ?oilsoap=0)
      biteBlock: true,  // the biting atoms are ions: an intact bilayer keeps them off its chains as it keeps them out (step C12g's block;
                        // needs it on): a side's bilayer is bitten x ((1 - integrity) + integrity x ionPass) (?biteblock=0)
    };
    this.tot = Object.fromEntries(MC.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];   // every 10 s: [time, integ, whole share, holey share, held / want, fuse, made, headOn, bites, sheds, spill]
  }

  /** Whether the lipid membranes (and so these rules) act now. */
  get active() { const L = this.eat.lipids; return !!(L && L.active); }

  get flags() {
    const p = this.params;
    return (p.oilSoap ? M1F.OILSOAP : 0) | (p.biteBlock ? M1F.BITEBLOCK : 0);
  }

  /** The eat pass's words (struct EatP m1[0], m1[1] from word o). */
  write(u, f, o) {
    u[o] = this.flags;
    for (let k = 1; k < 8; k++) f[o + k] = 0;
  }

  /** The heat's ledger read-back (through src/eat.js). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_M1 + 16 * q + k]; return s; };
    const S = Object.fromEntries(MZ.map((k, q) => [k, v(q)]));
    const T = this.tot;
    MC.forEach((k, q) => { T[k] += v(16 + q); });
    const H = this.hist;
    H.push([rec.time, ...MC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const A = 4096;   // counts per substance unit
    const rate = Object.fromEntries(MC.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt / A : 0]));
    const n = Math.max(1, S.n);
    const supply = rate.fuseS + rate.fuseO + rate.madeS + rate.madeO;
    const loss = rate.biteS + rate.biteO + rate.shedS + rate.shedO + rate.spill;
    const C = {
      time: rec.time, n: S.n, integ: S.integ / 1000 / n,
      bins: [S.b0, S.b1, S.b2, S.b3, S.b4].map((x) => x / n), whole: (S.b3 + S.b4) / n, holey: S.b0 / n,
      want: S.want * 16 / A, held: S.held * 16 / A, xoil: S.xoil * 16 / A,
      hasL: S.hasL / n, hasl: S.hasl / n, hasAll: S.hasAll / n, empty: S.empty / n,
      rate, supply, loss,
      perCell: Object.fromEntries(Object.entries(rate).map(([k, x]) => [k, x / n])),
    };
    const sh = rate.shHead + rate.shl + rate.shL + rate.shBat;
    C.short = sh > 0 ? { head: rate.shHead / sh, l: rate.shl / sh, L: rate.shL / sh, bat: rate.shBat / sh } : { head: 0, l: 0, L: 0, bat: 0 };
    this.census = C;
    const Sr = this.series, last = Sr[Sr.length - 1];
    if (last && rec.time < last[0]) Sr.length = 0;
    if (!Sr.length || rec.time - Sr[Sr.length - 1][0] >= 10) {
      Sr.push([rec.time, C.integ, C.whole, C.holey, C.want > 0 ? C.held / C.want : 0, rate.fuseS + rate.fuseO, rate.madeS + rate.madeO, rate.headOn,
        rate.biteS + rate.biteO, rate.shedS + rate.shedO, rate.spill]);
      if (Sr.length > 400) Sr.shift();
    }
  }

  /** The entropy panel's MEMBRANES line. */
  panelLine(compact = false) {
    const C = this.census;
    if (!this.active) return 'MEMBRANES  (lipid membranes off)';
    if (!C || !C.n) return 'MEMBRANES  …';
    const r = C.rate, pc = (x) => `${Math.round(100 * x)}%`;
    if (compact) return `MEMBRANES whole ${pc(C.whole)} · holes ${pc(C.holey)} · in ${fmt(C.supply)} out ${fmt(C.loss)}/s`;
    const top = Object.entries(C.short).sort((a, b) => b[1] - a[1])[0];
    return `MEMBRANES  integrity ${C.integ.toFixed(2)} · whole (≥ 0.6) ${pc(C.whole)}, holes (< 0.2) ${pc(C.holey)} · held ${fmt(C.held)} of ${fmt(C.want)} wanted` +
      ` · per s in: fused ${fmt(r.fuseS)}+${fmt(r.fuseO)} oil, made ${fmt(r.madeS)}+${fmt(r.madeO)}${this.params.oilSoap ? `, head on oil ${fmt(r.headOn)}` : ''}` +
      ` · out: bitten ${fmt(r.biteS)}+${fmt(r.biteO)}, shed ${fmt(r.shedS)}+${fmt(r.shedO)}, spilled ${fmt(r.spill)} · to newborns ${fmt(r.split)}` +
      ` · builder short of ${top[1] > 0 ? `${top[0]} (${pc(top[1])})` : 'nothing'}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`whole membranes (step M1): head on oil ${on(p.oilSoap)} · bites through the block ${on(p.biteBlock)}${this.eat.ions && this.eat.ions.params.block ? '' : ' (the ion block is off: no effect)'}`];
    if (C && C.n) {
      const r = C.rate, pc = (x) => `${(100 * x).toFixed(0)}%`;
      lines.push(`membranes: ${C.n} cells · integrity ${C.integ.toFixed(3)} (bins 0-.2-.4-.6-.8-1: ${C.bins.map(pc).join(' ')}) · bilayer held ${fmt(C.held)} of ${fmt(C.want)} (oil past the tails ${fmt(C.xoil)})` +
        ` · stocks hold L ${pc(C.hasL)} l ${pc(C.hasl)} both + a head ${pc(C.hasAll)} · empty batteries ${pc(C.empty)}` +
        ` · per s: fused soap ${fmt(r.fuseS)} oil ${fmt(r.fuseO)}, made soap ${fmt(r.madeS)} oil ${fmt(r.madeO)}, head on oil ${fmt(r.headOn)}; bitten soap ${fmt(r.biteS)} oil ${fmt(r.biteO)},` +
        ` shed soap ${fmt(r.shedS)} oil ${fmt(r.shedO)}, spilled ${fmt(r.spill)}, to newborns ${fmt(r.split)} · builder short: head ${pc(C.short.head)} l ${pc(C.short.l)} L ${pc(C.short.L)} battery ${pc(C.short.bat)}`);
      lines.push(`membranes every 10 s (integrity, whole / holes, held/want, in fused/made/head-on, out bitten/shed/spilled): ${this.series.slice(-6).map((s) =>
        `${s[0].toFixed(0)}s ${s[1].toFixed(2)} ${pc(s[2])}/${pc(s[3])} ${s[4].toFixed(2)} ${fmt(s[5])}/${fmt(s[6])}/${fmt(s[7])} ${fmt(s[8])}/${fmt(s[9])}/${fmt(s[10])}`).join(' ')}`);
    }
    return lines;
  }
}
