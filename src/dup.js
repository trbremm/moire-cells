// Step G2: GENE DUPLICATION FOR ENGINES AND PUMPS (BUILD QUEUE 6c, 2026-11-22; README "Step G2: gene duplication"). How real genomes grow new
// functions: a gene is copied by accident, the cell now holds two; one keeps the old job while the other is free to drift, and now and then it
// drifts into a new job ("neofunctionalisation"), or both stay alike and the cell simply makes twice as much ("dosage"). Nothing here says
// which is better: the copies cost what any engine or pump costs, and selection decides. Each piece its own switch (the rules panel's group
// "Gene duplication (step G2)", URL options):
//
//   SILENT SLOTS   two more ENGINE slots (genome words 156..159, Bio.dx: codes and rates as the three of step C6), silent (rate 0: no effect, no
//                  cost, no drift) until a duplication fills one. Pumps: the plumbing of step C7 has two pump slots (their requests are packed
//                  in pairs in the words neighbours read), so a pump copy goes into the cell's EMPTY pump slot (most cells use at most one)
//   DUPLICATION    at a birth, with chance `rate` x the copying scale (key M x the fidelity gene's e^-F, + hard light's extra: as every copying
//                  error, step G1), one working slot (any engine or pump slot, at random) is copied over a silent one of its kind: its reaction
//                  (and pigment band) or substance and direction, its rate, its family, and the gene-network output it follows. Dosage x 2, and
//                  the upkeep x 2 (step T1b: upkeep only for what is expressed, so a copy the network keeps silent costs nothing)
//   DRIFT          from then on a copy mutates as the other slots: its rate by small steps, and now and then a jump to another reaction or band
//                  (at the chance one of the old slots has), a pump copy by the pumps' ordinary jumps (another substance, the other way, or empty)
//   DELETION       with chance `del` x the copying scale a birth loses one copy (at random) back to silence, so gene count is no one-way ratchet
//   FAMILIES       every working slot carries a FAMILY id (words 160..166), inherited, copies keep their original's: a founder's slots are
//                  named 1 + 16 x founder + slot (pumps + 8), a slot started from empty by ordinary mutation gets a fresh id. So the census can
//                  tell, per family, whether its slots still run one reaction or have BRANCHED into several
//   CONTROLS       ?dup=0 off: no duplication, the silent slots stay silent (exactly as before G2; copies in an old snapshot have no effect);
//                  ?dupnull=1 the NEUTRAL control: duplications, deletions and the copies' drift happen as when on, but the copies have NO
//                  effect (no reaction, no pumping, no upkeep, not drawn, not in the job colour); knobs ?duprate= ?dupdel= ?dupcensus=
//
// This module: the switches and knobs (moire.dup.params), the step's words (Fields.g2), the eat pass's (EatP.g2), the draw's (Draw.spare5[0]),
// the counters (the heat ledger's step C9 block, LG_DIV rows 8..12: duplications of engines and of pumps, deletions, no room, fresh families),
// a CENSUS every censusEvery s (a read-back of the cells and genomes: working slots per cell, cells holding a copy, each copy's fate: DOSAGE
// (a relative in the cell runs the same reaction), NEW FUNCTION (its family's other slot in the cell runs another), ALONE (its relatives lost);
// the families and how many have branched), the ENGINES panel line and overlay lines, and moire.dup.census() for the console.

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS, BIO_G2, famOf } from './genome.js';
import { ENGINES, SUBSTANCES } from './matter.js';
import { readBuffer } from './snapshot.js';

const LG_DIV = 22272;          // heat_common.wgsl: step C9's block, 16 numbers x 16 slots; G2's counters at rows 8..12 (DPC_* in cell_common.wgsl)
const DUP = { ACT: 1, COPY: 2 };
const CNT = ['eng', 'pump', 'del', 'full', 'fresh'];
const ROW0 = 8;
const C_FLAGS = 9, C_BAT = 16;
/** Whether the copies act now (the zoo's portraits and words follow it; written with the step's words each frame). */
export const DUP_STATE = { acts: true };

/** The five engine slots and two pump slots of genome g at word o: [{ k, code, rate, fam: { id, reg, copy }, pump }]. */
export function slotsOf(g, o) {
  const s = [];
  for (let k = 0; k < 5; k++) {
    const code = Math.round(k < 3 ? g[o + 32 + k] : g[o + BIO_G2 + (k - 3)]);
    const rate = k < 3 ? g[o + 36 + k] : g[o + BIO_G2 + 2 + (k - 3)];
    s.push({ k, code, rate, fam: famOf(k < 4 ? g[o + BIO_G2 + 4 + k] : g[o + BIO_G2 + 8]), pump: false });
  }
  for (let k = 0; k < 2; k++) {
    s.push({ k, code: Math.round(g[o + 44 + k]), rate: g[o + 46 + k], fam: famOf(g[o + BIO_G2 + 9 + k]), pump: true });
  }
  return s;
}
/** A slot's job in words: an engine's reaction (with its pigment band), a pump's substance and direction. */
export function slotName(sl) {
  if (sl.pump) { const sb = SUBSTANCES[sl.code & 15]; return `pump ${sb ? sb.name : '?'} ${(sl.code >> 4) & 1 ? 'out' : 'in'}`; }
  const e = ENGINES[Math.min(ENGINES.length - 1, sl.code & 31)], band = sl.code >> 5;
  return `${e ? e.name : '?'}${e && e.kind === 0 ? (band ? ` (band ${band})` : ' (battery)') : ''}`;
}
// the reaction a slot runs, as a key that matters (an engine's band only for an uphill engine; a pump's substance and direction)
function jobKey(sl) {
  if (sl.pump) return `p${sl.code & 31}`;
  const e = ENGINES[Math.min(ENGINES.length - 1, sl.code & 31)];
  return `e${sl.code & 31}.${e && e.kind === 0 ? sl.code >> 5 : 0}`;
}

export class Dup {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.dup.params). Switches: the rules panel's group "Gene duplication (step G2)"; URL ?dup=0, ?dupnull=1, ?duprate=,
    // ?dupdel=, ?dupcensus=
    this.params = {
      on: true,          // duplications happen and the copies act
      null: false,       // the NEUTRAL control: duplications, deletions and drift as when on, the copies without any effect (?dupnull=1)
      rate: 0.02,        // the chance per birth of one duplication (x the copying scale: key M, fidelity, hard light)
      del: 0.02,         // the chance per birth that one copy is lost back to silence (same scale)
      censusEvery: 15,   // s of simulated time between the census's read-backs (0: never)
      minCells: 3,       // the census: a family's reaction counts (for branching) when at least this many slots run it
      partSize: 0.8,     // the look: a duplicate engine slot's part, x an engine part's size
    };
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.rates = null;   // the counters' rates (per s)
    this.census = null;
    this.series = [];    // per census: [time, cells, working slots per cell, share holding a copy, dosage, new function, alone, families, branched]
    this.busy = false;
    this.lastAt = -1e9;
  }

  get bits() {
    const p = this.params;
    return (p.on && !p.null ? DUP.ACT : 0) | (p.on || p.null ? DUP.COPY : 0);
  }
  get acts() { return (this.bits & DUP.ACT) !== 0; }

  /** The step's words (struct Fields g2, from word o): the bits, the duplication's and the deletion's chance per birth. */
  writeFields(u, f, o) {
    const p = this.params;
    DUP_STATE.acts = this.acts;
    u[o] = this.bits; f[o + 1] = Math.max(0, Math.min(1, p.rate)); f[o + 2] = Math.max(0, Math.min(1, p.del)); f[o + 3] = 0;
  }
  /** The eat pass's words (struct EatP g2, from word o): the bits. */
  writeEat(u, o) { u[o] = this.bits; u[o + 1] = 0; u[o + 2] = 0; u[o + 3] = 0; }
  /** The draw's words (struct Draw spare5[0], from word o): 1 = the copies act (drawn as parts), their parts' size. */
  writeDraw(a, o) { a[o] = this.acts ? 1 : 0; a[o + 1] = Math.max(0.2, this.params.partSize); }

  /** The heat ledger's read-back (Int32 words; called by src/eat.js apply): the counters since the last one. */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_DIV + 16 * q + k]; return s; };
    const T = this.tot;
    CNT.forEach((k, j) => { T[k] += v(ROW0 + j); });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 20) H.shift();   // over the last 20 s (duplications are rare)
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const per = (j) => (dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt : 0);
    this.rates = { time: rec.time, ...Object.fromEntries(CNT.map((k, j) => [k, per(j)])), tot: { ...T } };
    if (this.census) this.census.rates = this.rates;
  }

  /** Once a frame (before the frame's ticks are encoded): start the census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('dup census:', e); });
  }

  /** Read the cells and genomes back and work out the census (also moire.dup.census()). */
  async read(time = this.lastAt) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([
        readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
        readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      ]);
      const c = this.analyse(new Float32Array(bioAB), new Float32Array(cellAB), new Uint32Array(cellAB), n, time);
      c.rates = this.rates;
      this.census = c;
      const S = this.series, last = S[S.length - 1];
      if (last && c.time < last[0]) S.length = 0;
      if (c.n) S.push([c.time, c.n, c.working, c.withCopy, c.fate.dosage, c.fate.newfn, c.fate.alone, c.families.n, c.families.branched]);
      if (S.length > 400) S.shift();
      return c;
    } finally {
      this.busy = false;
    }
  }
  /** The census now (a fresh read-back; for the console and the experiments' evals). */
  now() { return this.read(this.lastAt); }

  /** Cells holding copies, for looking at them (moire.dup.where(n)): [{ slot, x, y (dish CSS px), slots: [names of the working slots, a copy marked *] }]. */
  async where(n = 10, kind = 'any') {
    const C = this.cells, d = C.device, N = C.count;
    const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, N * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, N * CELL_FLOATS * 4)]);
    const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB), out = [];
    for (let i = 0; i < N && out.length < n; i++) {
      if (!(u[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
      const S = slotsOf(g, i * BIO_FLOATS).filter((sl) => sl.rate > 0);
      const cps = S.filter((sl) => (sl.pump ? sl.fam.copy : sl.k >= 3));
      if (!cps.length) continue;
      const newfn = cps.some((cp) => S.some((sl) => sl !== cp && sl.pump === cp.pump && sl.fam.id === cp.fam.id && jobKey(sl) !== jobKey(cp)));
      if (kind === 'new' && !newfn) continue;
      out.push({ slot: i, x: f[i * CELL_FLOATS], y: f[i * CELL_FLOATS + 1], newfn,
        slots: S.map((sl) => `${slotName(sl)}${(sl.pump ? sl.fam.copy : sl.k >= 3) ? '*' : ''} #${sl.fam.id}`) });
    }
    return out;
  }

  analyse(g, f, u, n, time) {
    const CF = CELL_FLOATS, B = BIO_FLOATS, P = this.params, acts = this.acts;
    let m = 0, work = 0, act = 0, withCopy = 0, engCopies = 0, pumpCopies = 0, cellsEngCopy = 0, cellsPumpCopy = 0, dupsLine = 0;
    const fate = { dosage: 0, newfn: 0, alone: 0 };
    const bat = { copy: { n: 0, s: 0 }, none: { n: 0, s: 0 } };
    const fams = new Map();   // engine family id -> { slots, cells, jobs: Map key -> count, copies }
    const pfams = new Map();  // pump family id -> the same
    const famIdOf = (sl, i) => sl.fam.id || (1 + 16 * Math.min(65535, Math.max(0, Math.round(g[i * B + 7] || 0))) + (sl.pump ? 8 : 0) + sl.k);   // (not named yet: its founder's)
    for (let i = 0; i < n; i++) {
      if (!(u[i * CF + C_FLAGS] & 1)) continue;
      m++;
      const S = slotsOf(g, i * B).filter((sl) => sl.rate > 0);
      const copies = S.filter((sl) => (sl.pump ? sl.fam.copy : sl.k >= 3));
      work += S.filter((sl) => !sl.pump).length;
      act += S.filter((sl) => !sl.pump && (sl.k < 3 || acts)).length;
      dupsLine += g[i * B + BIO_G2 + 11] || 0;
      const ec = copies.filter((sl) => !sl.pump).length, pc = copies.length - ec;
      engCopies += ec; pumpCopies += pc;
      if (ec) cellsEngCopy++;
      if (pc) cellsPumpCopy++;
      const b = f[i * CF + C_BAT];
      if (copies.length) { withCopy++; bat.copy.n++; bat.copy.s += b; } else { bat.none.n++; bat.none.s += b; }
      for (const cp of copies) {
        const id = famIdOf(cp, i), key = jobKey(cp);
        const rel = S.filter((sl) => sl !== cp && sl.pump === cp.pump && famIdOf(sl, i) === id);
        if (rel.some((sl) => jobKey(sl) === key)) fate.dosage++; else if (rel.length) fate.newfn++; else fate.alone++;
      }
      const seen = new Set();
      for (const sl of S) {
        const id = famIdOf(sl, i), M = sl.pump ? pfams : fams;
        if (!M.has(id)) M.set(id, { id, slots: 0, cells: 0, copies: 0, jobs: new Map(), cellsBranched: 0 });
        const F = M.get(id);
        F.slots++;
        if ((sl.pump ? sl.fam.copy : sl.k >= 3)) F.copies++;
        F.jobs.set(jobKey(sl), (F.jobs.get(jobKey(sl)) || 0) + 1);
        const sk = `${sl.pump ? 'p' : 'e'}${id}`;
        if (!seen.has(sk)) { seen.add(sk); F.cells++; }
      }
      // a family running two different reactions in ONE cell (a new function next to the old one)
      const byFam = new Map();
      for (const sl of S) { const sk = `${sl.pump ? 'p' : 'e'}${famIdOf(sl, i)}`; if (!byFam.has(sk)) byFam.set(sk, new Set()); byFam.get(sk).add(jobKey(sl)); }
      for (const [sk, J] of byFam) if (J.size > 1) (sk[0] === 'p' ? pfams : fams).get(Number(sk.slice(1))).cellsBranched++;
    }
    const summarise = (M) => {
      const list = [...M.values()].filter((F) => F.slots >= P.minCells);
      const branched = list.filter((F) => [...F.jobs.values()].filter((x) => x >= P.minCells).length >= 2);
      const top = list.sort((a, b) => b.cells - a.cells).slice(0, 6).map((F) => ({
        id: F.id, cells: F.cells, slots: F.slots, copies: F.copies, cellsBranched: F.cellsBranched,
        jobs: [...F.jobs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, x]) => [keyName(k), x]),
      }));
      return { n: list.length, all: M.size, branched: branched.length, inCell: list.filter((F) => F.cellsBranched > 0).length, top };
    };
    const copiesAll = fate.dosage + fate.newfn + fate.alone;
    return {
      time, n: m, acts,
      working: m ? work / m : null,                  // working engine slots per cell (copies counted whether they act or not)
      acting: m ? act / m : null,                    // ... of them, those that act (the null control: the old three only)
      withCopy: m ? withCopy / m : null,             // cells holding at least one copy (engine or pump)
      engCopy: m ? cellsEngCopy / m : null, pumpCopy: m ? cellsPumpCopy / m : null,
      copies: { eng: engCopies, pump: pumpCopies, perCell: m ? (engCopies + pumpCopies) / m : null },
      fate: { ...fate, dosageShare: copiesAll ? fate.dosage / copiesAll : null, newShare: copiesAll ? fate.newfn / copiesAll : null, aloneShare: copiesAll ? fate.alone / copiesAll : null },
      battery: { copy: bat.copy.n ? bat.copy.s / bat.copy.n : null, none: bat.none.n ? bat.none.s / bat.none.n : null },
      lineDups: m ? dupsLine / m : null,             // duplications in a cell's line since its founder (mean)
      families: summarise(fams), pumpFamilies: summarise(pfams),
    };
  }

  /** The entropy panel's ENGINES line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, R = this.rates;
    const ctl = !p.on && !p.null ? ' (no duplication)' : p.null ? ' · NULL' : '';
    if (!C || !C.n) return `ENGINES${ctl}  …`;
    const pc = (x) => (x == null ? '-' : `${Math.round(100 * x)}%`), f2 = (x) => (x == null ? '-' : x.toFixed(2));
    const F = C.families;
    const ev = R ? `dup ${(R.eng + R.pump).toFixed(2)}/s, lost ${R.del.toFixed(2)}/s` : '';
    if (!p.on && !p.null) {
      return compact ? `ENGINES${ctl} ${f2(C.working)}/cell · families ${F.n}, branched ${F.branched}`
        : `ENGINES${ctl}  working slots ${f2(C.working)} a cell · engine families ${F.n} (branched into 2+ reactions: ${F.branched}) · fresh slots ${R ? R.fresh.toFixed(2) : '-'}/s`;
    }
    if (compact) {
      return `ENGINES${ctl} ${f2(C.working)}/cell · copies ${pc(C.withCopy)} (same ${pc(C.fate.dosageShare)} new ${pc(C.fate.newShare)}) · fam ${F.n} br ${F.branched} · ${ev}`;
    }
    return `ENGINES${ctl}  working slots ${f2(C.working)} a cell${C.acts ? '' : ` (${f2(C.acting)} act)`} · cells with a copy ${pc(C.withCopy)} (engine ${pc(C.engCopy)}, pump ${pc(C.pumpCopy)})` +
      ` · copies: dosage ${pc(C.fate.dosageShare)}, new function ${pc(C.fate.newShare)}, alone ${pc(C.fate.aloneShare)}` +
      ` · engine families ${F.n}, branched ${F.branched} (in one cell ${F.inCell}) · ${ev}${R && R.full > 0.005 ? `, no room ${R.full.toFixed(2)}/s` : ''}` +
      ` · battery with a copy ${f2(C.battery.copy)}, without ${f2(C.battery.none)}`;
  }

  overlayLines() {
    const p = this.params;
    const lines = [`gene duplication (step G2): ${p.on ? 'on' : 'off'}${p.null ? ' · NEUTRAL CONTROL (copies made, drift and vanish, no effect)' : ''}` +
      ` · a duplication ${p.rate} a birth, a copy lost ${p.del} a birth (x the copying scale: key M, fidelity, hard light) · 2 silent engine slots, pump copies in the empty pump slot`];
    const C = this.census, R = this.rates;
    if (C && C.n) {
      const F = C.families;
      lines.push(`engines: ${C.n} cells · copies ${C.copies.eng} engine, ${C.copies.pump} pump (${C.copies.perCell.toFixed(3)} a cell) · dosage ${C.fate.dosage}, new function ${C.fate.newfn}, alone ${C.fate.alone}` +
        ` · duplications per line ${C.lineDups.toFixed(2)}` + (R ? ` · per s: engine dups ${R.eng.toFixed(2)}, pump dups ${R.pump.toFixed(2)}, lost ${R.del.toFixed(2)}, no room ${R.full.toFixed(2)}, fresh slots ${R.fresh.toFixed(2)}` : ''));
      if (F.top.length) lines.push(`engine families (id: cells, copies, reactions): ${F.top.map((T) => `#${T.id} ${T.cells} ${T.copies} [${T.jobs.map(([k, x]) => `${k} ${x}`).join(', ')}]`).join(' · ')}`);
      const S = this.series.slice(-6);
      if (S.length) lines.push(`engines every census (cells, slots, with copy, dosage/new/alone, families, branched): ${S.map((x) => `${x[0].toFixed(0)}s ${x[1]} ${x[2].toFixed(2)} ${Math.round(100 * x[3])}% ${x[4]}/${x[5]}/${x[6]} ${x[7]} ${x[8]}`).join(' · ')}`);
    }
    return lines;
  }
}

function keyName(k) {
  if (k[0] === 'p') { const c = Number(k.slice(1)); const sb = SUBSTANCES[c & 15]; return `${sb ? sb.name : '?'} ${(c >> 4) & 1 ? 'out' : 'in'}`; }
  const [e, b] = k.slice(1).split('.').map(Number);
  const E = ENGINES[Math.min(ENGINES.length - 1, e)];
  return `${E ? E.name : '?'}${E && E.kind === 0 ? (b ? `@${b}` : '@bat') : ''}`;
}
