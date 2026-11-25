// Step T1a: TISSUES 1, AN INSIDE, KIN CHANNELS, THE SELF MARKER (BUILD QUEUE 3, 2026-11-17; README "Step T1a"). The first pieces of
// "T1. Tissues that pay" (CLAUDE.md): what a cell gains by being inside a tissue, and a way for relatives to know each other and share.
// Every piece is its own switch (the rules panel's group "Tissues 1 (step T1a)", URL options), derived, and no rule names a role:
//
//   AN INSIDE (inside)     a membrane side PRESSED against a neighbour (the step lists it across that side, closer than press x the two
//                          radii) does not trade with the dish under it: every exchange with the dish goes through the FREE sides only,
//                          x their share of the perimeter (passive exchange: the haze, vandal atoms, oxygen; fusion; grazing), per side
//                          (bites, pumps to the dish), and over a covered side osmosis feels the neighbour's inside. So rim cells meet
//                          the haze, inner cells are sheltered. Light still falls on every cell from above; heat passes through cells.
//   KIN CHANNELS (channels) gap junctions / plasmodesmata: a gene (Bio.kin.x, 0..1) for passive sharing of small NEUTRAL molecules (the
//                          four fuels, the free linkers l and L, trace) with a touching neighbour, down the gradient only, free, open
//                          only as far as each cell accepts the other as kin (the marker below, its TOLERANCE gene Bio.kin.y): conductance
//                          min(open_i accept_i, open_j accept_j) x kinK x the shared wall (R) x each molecule's own speed
//   THE SELF MARKER        (Bio.mark) a fine stripe pattern on the membrane: angle, period, phase, no other effect, drifting at every birth
//                          (a molecular CLOCK), so marker distance grows with the time since the common ancestor. At a contact the two
//                          patterns beat (moire): the beat's contrast over the shared wall x their phases' register x what both DISPLAY
//                          (Bio.mark.w: a hidden pattern cannot beat, so hiding costs both recognition by others and one's own channels)
//                          = the KINSHIP (kin_match in cell_common.wgsl). It is NOT the identity key (Bio.key: the cell's moire lattice,
//                          which sets its fields and glue and is under selection, so unrelated lineages can converge on it); the marker
//                          is selected only through what kinship opens
//   SMELL FOR TRACE (smellTrace) the membrane's corners already smell the fuels; they smell trace too, each unit weighing as traceWorth
//                          units of the richest fuel x how much the lack of trace still holds the cell's engines back (the cofactor)
//   NULL / BLIND           controls: null = the channels move nothing (their genes drift: neutral drift); blind = they open to every
//                          neighbour (kinship ignored)
// The founder modes (std / blank / wild) live in src/genome.js (genome.params.founderMode, ?founders=wild|blank).
//
// Books: the inside only scales and skips exchanges; a kin channel moves whole counts from one stock to the other (worked out once per
// pair, applied by both): atoms, charge and energy stay exact.
//
// This module holds the switches and knobs (moire.kin.params, .look), writes the eat pass's words (EatP t1), the step's (Fields t1) and the
// drawing's (Draw kin), reads the census back and gives the TISSUES panel line, the overlay lines and moire.sample()'s kin.*.

import { fmt } from './heat.js';
import { lod } from './lod.js';   // step V1

const LG_T1 = 31488;   // heat_common.wgsl: 32 snapshot numbers x 16 slots, then 16 counters x 16 slots
const TZ = ['n', 'free', 'b0', 'b1', 'b2', 'b3', 'bat0', 'bat1', 'bat2', 'bat3', 'int0', 'int1', 'int2', 'int3', 'tin0', 'tin1', 'tin2', 'tin3',
  'con', 'kin', 'acc', 'open', 'gk', 'gk2', 'gt', 'gd', 'gd2', 'kc', 'str', 'fs'];
const TC = ['fuel', 'link', 'trace', 'pairs'];
const T1F = { INSIDE: 1, KIN: 2, BLIND: 4, NULL: 8, SMELL: 16 };
export const KW = 24;   // kin-channel words per cell in the flux buffer (after the cells' SW words each)
export const BINS = ['enclosed', '1-2 free', '3-4 free', '5-6 free'];

export class Kin {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.kin.params). Switches: the rules panel's group "Tissues 1 (step T1a)"; URL ?inside=0, ?kinchan=0, ?kinnull=1,
    // ?kinblind=1, ?clock=0, ?smelltrace=0 (and ?founders=wild|blank, src/genome.js)
    this.params = {
      inside: true,      // an inside: covered sides do not trade with the dish
      seal: 1,           // ... a covered side's share closed to the dish (1: all of it)
      press: 1.1,        // ... a side is covered by the neighbour the step lists across it, closer than press x the two radii
      channels: true,    // kin channels: touching kin share fuel, free linkers and trace down the gradient
      kinK: 1,           // ... per s at full conductance, per R of shared wall (x each molecule's own speed)
      kinCap: 1 / 32,    // ... the most one pair moves per tick, as a share of the source (with the pumps' worst case no stock goes below 0)
      blind: false,      // control: the channels open to every neighbour (kinship ignored) (?kinblind=1)
      null: false,       // control: the channels move nothing, the genes still drift (neutral drift) (?kinnull=1)
      clock: true,       // the marker drifts at every birth (a molecular clock; with mutation, key M) (?clock=0)
      clockSize: 0.4,    // ... x (angle 0.02 rad, period's log 0.01, phase 0.05 rad per birth); 0.4: a lineage stays mostly kin over 30 min (pilots)
      clockHard: true,   // step T1c: the clock also ticks with hard light's extra mutation dose (off, ?clockhard=0: only with mutation itself)
      smellTrace: true,  // the membrane's corners smell trace too (?smelltrace=0)
      traceWorth: 50,    // ... a unit of trace smells like this many units of the richest fuel, to a cell with no trace inside
    };
    // the look (moire.kin.look; drawing only)
    this.look = {
      texture: true,     // the marker drawn as a faint fine texture on the membrane's tube when zoomed in (surface immunostaining)
      texZoom: 3,        // ... from this zoom on
      texDepth: 0.75,    // ... how deep its stripes cut the tube's brightness (x the display gene)
      viewFill: 0.4,     // the lineage (marker) view: the body's fill in its marker's hue
      viewSat: 1,        // ... the hues' saturation
    };
    this.tot = Object.fromEntries(TC.map((k) => [k, 0]));
    this.hist = [];
    this.census = null;
    this.series = [];   // every 30 s: [time, kin gene mean, sd, display mean, tolerance mean, kinship, accepted share, enclosed share, ...]
  }

  get eat() { return this.cells.eat; }
  get flags() {
    const p = this.params;
    return (p.inside ? T1F.INSIDE : 0) | (p.channels ? T1F.KIN : 0) | (p.blind ? T1F.BLIND : 0) | (p.null ? T1F.NULL : 0) | (p.smellTrace ? T1F.SMELL : 0);
  }
  /** Whether the step must list each side's touching neighbour (Sim.nbrOn). */
  get needsNbr() { return !!(this.params.inside || this.params.channels); }

  /** The eat pass's words (struct EatP t1[0], t1[1] from word o). smellMax: the richest fuel's smell weight (EatP smellW units). */
  writeEat(u, f, o, dt, smellMax, pumpWorst) {
    const p = this.params;
    u[o] = this.eat && this.eat.params.on ? this.flags : 0;
    f[o + 1] = Math.max(0, Math.min(1, p.seal)); f[o + 2] = Math.max(0.5, p.press); f[o + 3] = Math.max(0, p.kinK);
    // the pair cap: with the pumps' worst case (pumpWorst of a stock per tick) the six pairs a cell can be in never take more than the rest
    f[o + 4] = Math.max(0, Math.min(p.kinCap, (1 - pumpWorst) / 6));
    f[o + 5] = Math.max(0, p.traceWorth) * smellMax;
    f[o + 6] = 0; f[o + 7] = 0;
  }

  /** The step's words (struct Fields t1, from word o). */
  writeFields(u, f, o) {
    const p = this.params;
    u[o] = (p.clock ? 1 : 0) | (p.clockHard ? 2 : 0); f[o + 1] = Math.max(0, p.clockSize); f[o + 2] = 0; f[o + 3] = 0;
  }

  /** The drawing's words (struct Draw kin, from word o): x the marker view; y the texture's depth (0 below texZoom); z the view's fill; w its saturation. */
  writeDraw(a, o, L, zoom) {
    const K = this.look;
    a[o] = L.view === 6 ? 1 : 0;
    // (step V1: with the LOD on, the stripes are always passed and the shader keeps them as far as their period clears the grid limit;
    // ?lod=0: from texZoom on, as before)
    a[o + 1] = K.texture && (lod.on || zoom >= K.texZoom - 1e-6) ? Math.max(0, Math.min(1, K.texDepth)) : 0;
    a[o + 2] = Math.max(0, K.viewFill); a[o + 3] = Math.max(0, Math.min(1.5, K.viewSat));
  }

  /** The heat's ledger read-back (through src/eat.js). */
  apply(rec, w) {
    const v = (q) => { let s = 0; for (let k = 0; k < 16; k++) s += w[LG_T1 + 16 * q + k]; return s; };
    const S = Object.fromEntries(TZ.map((k, q) => [k, v(q)]));
    const T = this.tot;
    TC.forEach((k, q) => { T[k] += v(32 + q); });
    const H = this.hist;
    H.push([rec.time, ...TC.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 2) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const A = 4096;
    const rate = Object.fromEntries(TC.map((k, j) => [k, dt > 0.05 ? (H[H.length - 1][1 + j] - H[0][1 + j]) / dt / (k === 'pairs' ? 1 : A) : 0]));
    const n = Math.max(1, S.n), con = Math.max(1, S.con);
    const bins = [0, 1, 2, 3].map((b) => {
      const m = S[`b${b}`];
      return { n: m, share: m / n, bat: m ? S[`bat${b}`] / 1000 / m : null, integ: m ? S[`int${b}`] / 1000 / m : null, tin: m ? S[`tin${b}`] / 1000 / m : null };
    });
    const gk = S.gk / 1000 / n, gd = S.gd / 1000 / n;
    const C = {
      time: rec.time, n: S.n, freeSides: S.free / n, freeShare: S.fs / 1000 / n, bins,
      contacts: S.con, perCell: 2 * S.con / n, kinship: S.con ? S.kin / 1000 / con : null, accepted: S.con ? S.acc / con : null,
      strangers: S.con ? S.str / con : null, open: S.con ? S.open / 1000 / con : null,
      genes: { kin: gk, kinSd: Math.sqrt(Math.max(0, S.gk2 / 1000 / n - gk * gk)), tol: S.gt / 1000 / n, display: gd,
        displaySd: Math.sqrt(Math.max(0, S.gd2 / 1000 / n - gd * gd)), carriers: S.kc / n },
      rate,
    };
    this.census = C;
    const Sr = this.series, last = Sr[Sr.length - 1];
    if (last && rec.time < last[0]) Sr.length = 0;
    if (S.n && (!Sr.length || rec.time - Sr[Sr.length - 1][0] >= 30)) {
      Sr.push([rec.time, gk, C.genes.kinSd, gd, C.genes.tol, C.kinship ?? 0, C.accepted ?? 0, bins[0].share, rate.fuel + rate.link + rate.trace]);
      if (Sr.length > 400) Sr.shift();
    }
  }

  /** The entropy panel's TISSUES line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census;
    if (!C || !C.n) return 'TISSUES  …';
    const pc = (x) => (x == null ? '-' : `${Math.round(100 * x)}%`), f2 = (x) => (x == null ? '-' : x.toFixed(2));
    const r = C.rate, sh = r.fuel + r.link + r.trace;
    const ctl = p.null ? ' · NULL' : p.blind ? ' · BLIND' : '';
    if (compact) return `TISSUES inside ${pc(C.bins[0].share)} · kin ${f2(C.kinship)} · channels ${f2(C.genes.kin)} · shared ${fmt(sh)}/s${ctl}`;
    const b = C.bins, bat = b.map((x) => f2(x.bat)).join('/');
    return `TISSUES${p.inside ? '' : ' (inside off)'}  cells enclosed ${pc(b[0].share)}, 1-2 free sides ${pc(b[1].share)}, 3-4 ${pc(b[2].share)}, 5-6 ${pc(b[3].share)} · battery by free sides ${bat}` +
      ` · contacts ${C.perCell.toFixed(1)}/cell, kinship ${f2(C.kinship)}, kin both ways ${pc(C.accepted)}, strangers ${pc(C.strangers)}` +
      ` · KIN CHANNELS${p.channels ? '' : ' off'}${ctl} gene ${f2(C.genes.kin)}±${f2(C.genes.kinSd)} (carriers ${pc(C.genes.carriers)}), open ${f2(C.open)}` +
      ` · shared per s fuel ${fmt(r.fuel)} linkers ${fmt(r.link)} trace ${fmt(r.trace)} · display ${f2(C.genes.display)} tolerance ${f2(C.genes.tol)}`;
  }

  overlayLines() {
    const p = this.params, on = (x) => (x ? 'on' : 'off'), C = this.census;
    const lines = [`tissues 1 (step T1a): inside ${on(p.inside)} (seal ${p.seal}, press ${p.press}) · kin channels ${on(p.channels)} (kinK ${p.kinK}/s, cap ${p.kinCap.toFixed(3)})` +
      `${p.null ? ' · NEUTRAL CONTROL' : ''}${p.blind ? ' · BLIND (kinship ignored)' : ''} · marker clock ${on(p.clock)} ×${p.clockSize}${p.clockHard ? '' : ' (not by hard light)'} · smell for trace ${on(p.smellTrace)} (worth ${p.traceWorth})` +
      ` · founders ${this.cells.genome.params.founderMode}`];
    if (C && C.n) {
      const f3 = (x) => (x == null ? '-' : x.toFixed(3));
      lines.push(`tissues: ${C.n} cells · free sides ${C.freeSides.toFixed(2)} (free share ${C.freeShare.toFixed(3)}) · by free sides (${BINS.join(', ')}): ` +
        C.bins.map((b) => `${b.n} bat ${f3(b.bat)} integ ${f3(b.integ)} t ${f3(b.tin)}`).join(' | ') +
        ` · contacts ${C.contacts} kinship ${f3(C.kinship)} both-kin ${f3(C.accepted)} strangers ${f3(C.strangers)} open ${f3(C.open)}` +
        ` · genes kin ${f3(C.genes.kin)}±${f3(C.genes.kinSd)} tol ${f3(C.genes.tol)} display ${f3(C.genes.display)}±${f3(C.genes.displaySd)}` +
        ` · shared/s fuel ${fmt(C.rate.fuel)} linkers ${fmt(C.rate.link)} trace ${fmt(C.rate.trace)}, pair-ticks ${fmt(C.rate.pairs)}`);
      const S = this.series.slice(-6);
      if (S.length) lines.push(`tissues every 30 s (kin gene ±sd, display, tolerance, kinship, both-kin, enclosed, shared/s): ${S.map((x) =>
        `${x[0].toFixed(0)}s ${x[1].toFixed(2)}±${x[2].toFixed(2)} ${x[3].toFixed(2)} ${x[4].toFixed(2)} ${x[5].toFixed(2)} ${x[6].toFixed(2)} ${x[7].toFixed(2)} ${fmt(x[8])}`).join(' · ')}`);
    }
    return lines;
  }
}
