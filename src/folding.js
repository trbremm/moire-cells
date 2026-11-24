// Step G3: THE MOIRE GENOME, DNA FOLDING (BUILD QUEUE 6a6b, 2026-11-24; README "Step G3: the moire genome"). The user: "apply the moire
// principle in essence ... different beats", inside the cell, "as our own dna folding dynamic for large mutations and the small ones that can
// be caused by brownian motion and chemical oxidation"; chose "fold in life, damage at birth"; on buffering: "I like the buffering! Add it,
// but make it subtle at first". Every part its own switch (the rules panel's group "Moire genome (step G3)", URL options):
//
//   LATTICES (?g3=0)     each of the gene network's 8 regulators (step T1b) carries a small hex LATTICE (Bio.la, lk, lp: angle, spacing as
//                        ln of its wavenumber, phase). The 16 senses sit on FIXED lattices (a 4 x 4 grid over the same address space). A
//                        regulator's inputs are DERIVED from the beat: source q feeds regulator r at wMax x exp(-d^2 / (2 sigma^2)) x
//                        cos(phase_r - phase_q + chi), d^2 = 2 cosh(dl) - 2 cos(dtheta) (only near-matches beat slowly: addressing by
//                        tuning, as the receptors' tuning), each regulator keeping its 3 strongest (|w| >= wMin) in step T1b's words (gw,
//                        gi: a cache now). The free weights and wiring codes are no longer genes: a birth nudges the lattices instead (and,
//                        now and then, draws one afresh: the old rewiring). Biases, outputs, broadcast stay as in T1b. ?g3=0: step T1b
//                        exactly (the lattice words are carried, without effect)
//   THE FOLD (?fold=0)   a genome-wide TWIST (every address turned) and STRETCH (addresses facing its axis lengthened, six-fold as the
//                        lattice) of all regulator lattices at once: one change moves every beat (the moire lever) = the LARGE MUTATION.
//                        Two folds per genome, HOME (Bio.fh) and STRESS (Bio.fs). Both drift a little at every birth; rarely (refold x the
//                        mutation size) one is drawn afresh: a BIG REFOLD at birth (every link may change)
//   FOLD IN LIFE (?foldlife=0)  STRESS S = clamp(heatW x heat + oxW x free t, 0, 1) (the network's own senses) above s0 REFOLDS a living cell
//                        into its stress fold (kOn per s at full stress), calm below s0 folds it back (kOff): reversible, inherited by
//                        daughters (Bio.fs.w, epigenetic). The lattice numbers themselves change ONLY at birth. ?foldnull=1 the NEUTRAL
//                        control: the folds drift and switch as usual, the links always come from the home fold
//   DAMAGE DOSE (?dose=0)  in life a cell collects a DOSE (Bio.gs.x) from its heat (Brownian: doseHeat per s at heat 1) and its free t
//                        (oxidation: doseOx), fading by itself (doseFade); at a birth the parent's dose becomes lattice kicks of doseStep x D
//                        in the daughter (who starts at 0). REPAIR: the G1 FIDELITY gene (F > 0) removes repK x (e^F - 1) x D per s while
//                        the battery has charge, paid repCost per unit repaired (the eat pass, as heat; ?repair=0). ?dosenull=1: collected,
//                        never written. Copying errors (M2's scale, x2.5) stay as they are
//   BUFFERING (?buffer=0)  a CAPACITOR gene (Bio.fh.w, 0..1; Hsp90-like): small lattice changes at a birth (copying errors, the fold's drift,
//                        damage) are HIDDEN (Bio.gs.y, the squared change since the links were last derived) while they stay within the
//                        buffer's capacity bufCap x gene: the links stay at the lineage's working state. Stress weakens it (capacity x (1 -
//                        bufWeaken x S)), so under heat or oxidation the hidden variation shows at once (a RELEASE). Big changes (a fresh
//                        lattice, a duplication, a big refold) are never buffered. SUBTLE AT FIRST: founders 0.05 (capacity far below one
//                        birth's drift), upkeep bufCost per s at gene 1 (an engine's at rate 1). ?buffernull=1: drifts, no effect, no cost
//
// This module: the switches and knobs (moire.folding.params), the gene network pass's words (GrnP 12..39), the eat pass's (EatP.g3), the
// founders' lattices (stamp), the JS mirror of the derivation, the counters (the heat ledger's step C9 block row 7: refolds in, back, releases,
// big refolds), a CENSUS every censusEvery s, the FOLDING panel line, overlay lines, and the GENOME VIEW (drawGenome: the regulators'
// lattices overlaid, a moire).

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';   // (used inside functions only: genome.js imports this module)
import { readBuffer } from './snapshot.js';
import { HEAT_SCALE } from './heat.js';

export const G3 = { ON: 1, FOLD: 2, FOLDLIFE: 4, FOLDNULL: 8, DOSE: 16, DOSENULL: 32, REPAIR: 64, BUF: 128, BUFNULL: 256, DERALL: 512, OUT: 1024 };
const GS_LINE = 2048, GS_FLASH_SHIFT = 5;   // Bio.gs.w: bits 0..4 the mark and events, 5..9 the refold flash, 10 its kind; the line's refolds x 2048
const G3E = { BUF: 1, REP: 2, COUNT: 4 };
export const GS = { SET: 1, ON: 2, OFF: 4, REL: 8, BIG: 16 };
const BIO_G3 = 188, BIO_GRN = 84;   // (genome.js BIO_G3, BIO_GRN; kept here: the two modules import each other)
export const W_LA = BIO_G3, W_LK = BIO_G3 + 8, W_LP = BIO_G3 + 16, W_FH = BIO_G3 + 24, W_FS = BIO_G3 + 28, W_GS = BIO_G3 + 32;
const PI3 = Math.PI / 3;
const LG_DIV = 22272, ROW = 7;
const CNT = ['on', 'off', 'rel', 'big'];
const C_FLAGS = 9, C_BAT = 16, C_SNS0 = 86, C_SNS1 = 87;
const W_FID = 31, W_FOUNDER = 7;
const GRN_U = BIO_GRN + 48, GRN_O = BIO_GRN + 64;

const quant = (a) => { if (!a.length) return [null, null, null]; const b = a.slice().sort((x, y) => x - y); return [0.1, 0.5, 0.9].map((q) => b[Math.min(b.length - 1, Math.floor(q * b.length))]); };
/** A sense's fixed lattice: [angle, ln wavenumber, phase] (cell_grn.wgsl g3_sense). */
export function senseAddr(s) { return [((s & 3) + 0.5) * PI3 / 4, -0.375 + 0.25 * (s >> 2), s * 2.3999632]; }
/** A lattice's address under a fold [twist, stretch, axis] (cell_grn.wgsl g3_addr). */
export function addr(th, lk, fold) { return [th + fold[0], lk + fold[1] * Math.cos(6 * (th - fold[2]))]; }
export function d2(a, b) {
  const x = a[0] - b[0], d = x - PI3 * Math.round(x / PI3);
  return 2 * Math.cosh(Math.max(-4, Math.min(4, a[1] - b[1]))) - 2 * Math.cos(d);
}
/** The genome's lattices at word o: { th[8], lk[8], ph[8], home[3], stress[3], state, buf }. */
export function latticesOf(g, o = 0) {
  const th = [], lk = [], ph = [];
  for (let r = 0; r < 8; r++) { th.push(g[o + W_LA + r] || 0); lk.push(g[o + W_LK + r] || 0); ph.push(g[o + W_LP + r] || 0); }
  return { th, lk, ph, home: [g[o + W_FH] || 0, g[o + W_FH + 1] || 0, g[o + W_FH + 2] || 0], buf: g[o + W_FH + 3] || 0,
    stress: [g[o + W_FS] || 0, g[o + W_FS + 1] || 0, g[o + W_FS + 2] || 0], state: (g[o + W_FS + 3] || 0) > 0.5 ? 1 : 0 };
}
/** The fold the links come from (as the shader): none with the fold off; the stress fold in that state unless the neutral control. */
export function foldInUse(L, P) {
  if (!P.fold) return [0, 0, 0];
  return L.state && !P.foldNull ? L.stress : L.home;
}
/** The derived links (cell_grn.wgsl g3_derive): per regulator its 3 inputs [{ q, w }] (q 1..8 regulators, 9..24 senses; none: q 0). */
export function derive(L, fold, P) {
  const ax = L.th.map((t, r) => addr(t, L.lk[r], fold));
  const inv = 1 / Math.max(2 * P.sigma * P.sigma, 1e-6);
  const out = [];
  for (let r = 0; r < 8; r++) {
    const best = [{ q: 0, w: 0 }, { q: 0, w: 0 }, { q: 0, w: 0 }];
    for (let q = 1; q < 25; q++) {
      if (q === r + 1) continue;
      let a, p;
      if (q <= 8) { a = ax[q - 1]; p = L.ph[q - 1]; } else { const s = senseAddr(q - 9); a = [s[0], s[1]]; p = s[2]; }
      const w = P.wMax * Math.exp(-d2(ax[r], a) * inv) * Math.cos(L.ph[r] - p + P.chi), aw = Math.abs(w);
      if (aw < P.wMin || aw <= Math.abs(best[2].w)) continue;
      best.push({ q, w });
      best.sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
      best.length = 3;
    }
    out.push(best);
  }
  return out;
}
/** The cached links in genome g at word o (step T1b's words): per regulator its 3 inputs [{ q, w }]. */
export function cachedLinks(g, o = 0) {
  const out = [];
  for (let r = 0; r < 8; r++) {
    const cw = Math.max(0, Math.round(g[o + BIO_GRN + 40 + r]));
    const L = [];
    for (let k = 0; k < 3; k++) L.push({ q: (cw >> (5 * k)) & 31, w: g[o + BIO_GRN + 16 + 3 * r + k] });
    out.push(L);
  }
  return out;
}
/** Of two link sets, how many inputs (of 24) differ (a source gained or lost, or its weight's sign turned). */
export function linkDiff(a, b) {
  let n = 0;
  for (let r = 0; r < 8; r++) {
    const ka = new Map(a[r].filter((l) => l.q > 0 && Math.abs(l.w) > 1e-6).map((l) => [l.q, Math.sign(l.w)]));
    const kb = new Map(b[r].filter((l) => l.q > 0 && Math.abs(l.w) > 1e-6).map((l) => [l.q, Math.sign(l.w)]));
    for (const [q, s] of ka) if (kb.get(q) !== s) n++;
    for (const q of kb.keys()) if (!ka.has(q)) n++;
  }
  return n;
}
/** A wiring as a short key (each regulator's sources with their signs), for counting distinct wirings. */
export function wiringKey(links) {
  return links.map((L) => L.filter((l) => l.q > 0 && Math.abs(l.w) > 1e-6).map((l) => `${l.q}${l.w < 0 ? '-' : '+'}`).sort().join(',')).join('|');
}
/**
 * Every founder's LATTICES (std, blank and wild alike: without outputs a network changes nothing), from its own random stream so a seed's
 * other genes stay as they were: each regulator's angle anywhere in 0..pi/3, spacing -0.5..0.5, phase 0..2 pi; the home fold at rest (0),
 * the stress fold anywhere within its bounds; the buffering gene at the founders' value. The state words 0.
 */
export function stampLattices(g, rng, o = 0, P = null) {
  const tw = P ? P.twistMax : 0.5, sm = P ? P.stretchMax : 0.3, bf = P ? P.bufFounder : 0.05;
  for (let r = 0; r < 8; r++) {
    g[o + W_LA + r] = rng() * PI3; g[o + W_LK + r] = rng() - 0.5; g[o + W_LP + r] = rng() * 2 * Math.PI;
  }
  g[o + W_FH] = 0; g[o + W_FH + 1] = 0; g[o + W_FH + 2] = 0; g[o + W_FH + 3] = bf;
  g[o + W_FS] = (2 * rng() - 1) * tw; g[o + W_FS + 1] = (2 * rng() - 1) * sm; g[o + W_FS + 2] = rng() * PI3; g[o + W_FS + 3] = 0;
  for (let k = 0; k < 4; k++) g[o + W_GS + k] = 0;
}

/**
 * Std and blank founders' OUTPUT GAINS (the moire genome on, founderOut): each of the 16 basic outputs (pigment, engines, wall, membrane,
 * glue, pumps, channels, kin channels, display, division, motility, emission) gets a gain anywhere in -founderGain..founderGain with chance
 * founderShare, so a founder's network acts from the first tick and a refold, which changes which regulator drives each output, changes what
 * the cell does. Random, not designed: what a founder's network makes of it is up to its lattices. Words a wild founder already has are kept.
 */
export function founderOutputs(g, rng, o = 0, P = null) {
  const share = P ? P.founderShare : 0.6, gain = P ? P.founderGain : 1.5;
  for (let q = 0; q < 16; q++) {
    const on = rng() < share, u = (2 * rng() - 1) * gain;
    if (!g[o + GRN_U + q]) g[o + GRN_U + q] = on ? u : 0;
  }
}
// the derivation's knobs when none are given (as Folding.params)
const DEFAULTS = { fold: true, foldNull: false, sigma: 0.12, wMax: 4, wMin: 1, chi: Math.PI / 4 };
// the genome view's inks: eight neon hues, one per regulator (sense lattices in a dim grey)
const INKS = [[255, 60, 170], [60, 230, 255], [170, 90, 255], [255, 190, 60], [90, 255, 130], [255, 90, 70], [80, 140, 255], [240, 240, 120]];

/**
 * THE GENOME VIEW: genome g at word o drawn into a 2D context of size S (device px), neon on black, round like a nucleus. Underneath, each
 * regulator's lattice (under the fold in use) as faint small dots in its own hue; over it, for every LINK the network derives (another
 * regulator or a sense feeding a regulator), the two lattices' MOIRE BEAT: the slow fringes their overlap makes (sum over the three
 * matched wavevectors of cos(dk . x + dphi)), drawn as glowing rosettes in the receiving regulator's hue, brighter for stronger links.
 * Near-matching lattices beat into big slow rosettes (strong links), poorer matches into fine ones; a refold turns every lattice at once,
 * so the whole picture changes. Brightness also follows each regulator's expression. opts: { expression (true), senses (true: draw the
 * sense links' beats too), P (the derivation's knobs; default the module's) }.
 */
export function drawGenome(cx, S, g, o = 0, P = null, opts = {}) {
  const L = latticesOf(g, o), Pp = { ...DEFAULTS, ...(P || {}) };
  const fold = foldInUse(L, Pp);
  const base = S * 0.05;                           // the reference lattice's spacing (20 across)
  // a lattice: its three wavevectors (angle th, th + 60, th + 120 degrees) and, per wavevector, the phase that shifts its dots by the
  // lattice's phase / 2 pi of a period along th
  const lat = (th, lk, ph) => {
    const p = base * Math.exp(-lk), k = 2 * Math.PI / p, sh = [Math.cos(th) * p * ph / (2 * Math.PI), Math.sin(th) * p * ph / (2 * Math.PI)];
    const K = [0, 1, 2].map((m) => [k * Math.cos(th + m * PI3), k * Math.sin(th + m * PI3)]);
    return { k: K, ph: K.map((q) => -(q[0] * sh[0] + q[1] * sh[1])) };
  };
  const regs = L.th.map((t, r) => { const a = addr(t, L.lk[r], fold); return lat(a[0], a[1], L.ph[r]); });
  const sens = Array.from({ length: 16 }, (_, s) => { const a = senseAddr(s); return lat(a[0], a[1], a[2]); });
  const xr = (r) => (opts.expression === false ? 1 : Math.max(0, Math.min(1, g[o + BIO_GRN + r] ?? 0.5)));
  // the beats: for each link q -> r, each of r's wavevectors paired with the nearest of q's six (+-k), the phase following the sign
  const links = derive(L, fold, Pp), beats = [];
  links.forEach((Lr, r) => Lr.forEach(({ q, w }) => {
    if (!q || (q > 8 && opts.senses === false)) return;
    const src = q <= 8 ? regs[q - 1] : sens[q - 9];
    const dk = [], dp = [];
    regs[r].k.forEach((km, m) => {
      let best = null, bd = Infinity;
      src.k.forEach((kn, n) => { for (const sg of [1, -1]) {
        const d = (km[0] - sg * kn[0]) ** 2 + (km[1] - sg * kn[1]) ** 2;
        if (d < bd) { bd = d; best = [km[0] - sg * kn[0], km[1] - sg * kn[1], regs[r].ph[m] - sg * src.ph[n]]; }
      } });
      dk.push([best[0], best[1]]); dp.push(best[2]);
    });
    beats.push({ r, dk, dp, amp: Math.min(1, Math.abs(w) / Math.max(1e-3, Pp.wMax)) ** 1.5 * (0.35 + 0.65 * xr(r)), neg: w < 0 });
  }));
  const img = cx.createImageData(S, S), D = img.data, c0 = S / 2, rad = S * 0.47;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - c0, dy = y - c0, rr = Math.hypot(dx, dy), j = 4 * (y * S + x);
      D[j + 3] = 255;
      if (rr > rad + 1.5) continue;
      const edge = Math.max(0, Math.min(1, rad + 0.5 - rr));
      let R = 0, G = 0, B = 0;
      for (let r = 0; r < 8; r++) {   // the lattices: small faint dots
        const K = regs[r].k, ph = regs[r].ph;
        const h = (Math.cos(K[0][0] * dx + K[0][1] * dy + ph[0]) + Math.cos(K[1][0] * dx + K[1][1] * dy + ph[1]) + Math.cos(K[2][0] * dx + K[2][1] * dy + ph[2])) / 3;
        const v = h > 0.75 ? ((h - 0.75) / 0.25) ** 2 * (0.12 + 0.25 * xr(r)) : 0;
        const ink = INKS[r];
        R += v * ink[0]; G += v * ink[1]; B += v * ink[2];
      }
      for (const b of beats) {        // the beats: glowing rosettes
        const h = (Math.cos(b.dk[0][0] * dx + b.dk[0][1] * dy + b.dp[0]) + Math.cos(b.dk[1][0] * dx + b.dk[1][1] * dy + b.dp[1]) +
          Math.cos(b.dk[2][0] * dx + b.dk[2][1] * dy + b.dp[2])) / 3;
        if (h <= 0.2) continue;
        // a soft fill and a crisp tube along the fringe's edge (the neon look: rosettes outlined)
        const t = (h - 0.2) / 0.8, e = (h - 0.62) / 0.05, v = b.amp * (0.3 * t * t + (b.neg ? 0.45 : 0.85) * Math.exp(-e * e)), ink = INKS[b.r];
        R += v * ink[0]; G += v * ink[1]; B += v * ink[2];
      }
      // a white-hot core where it is brightest (the neon look), the round edge
      const m = Math.max(R, G, B), hot = m > 255 ? Math.min(1, (m - 255) / 255) : 0;
      D[j] = edge * Math.min(255, R + hot * (255 - Math.min(255, R)));
      D[j + 1] = edge * Math.min(255, G + hot * (255 - Math.min(255, G)));
      D[j + 2] = edge * Math.min(255, B + hot * (255 - Math.min(255, B)));
    }
  }
  cx.putImageData(img, 0, 0);
  // the nuclear rim: a thin neon tube in the hue of the most expressed regulator
  let top = 0;
  for (let r = 1; r < 8; r++) if (xr(r) > xr(top)) top = r;
  const ink = INKS[top];
  cx.save();
  cx.beginPath(); cx.arc(c0, c0, rad, 0, 2 * Math.PI);
  cx.shadowColor = `rgba(${ink.join(',')},0.9)`; cx.shadowBlur = S * 0.03;
  cx.lineWidth = Math.max(1, S * 0.012); cx.strokeStyle = `rgba(${ink.join(',')},0.9)`; cx.stroke();
  cx.restore();
}

export class Folding {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.folding.params). Switches: the rules panel's group "Moire genome (step G3)"; URL ?g3=0, ?fold=0, ?foldlife=0,
    // ?foldnull=1, ?dose=0, ?dosenull=1, ?repair=0, ?buffer=0, ?buffernull=1, knobs (see main.js)
    this.params = {
      on: true,          // the moire genome: the network's links derived from the regulators' lattices (off: step T1b's free weights)
      fold: true,        // the fold acts on the addresses
      foldLife: true,    // stress refolds a living cell, calm folds it back
      foldNull: false,   // the fold's NEUTRAL control: folds drift and switch, the links always from the home fold
      dose: true,        // the damage dose is written into the lattices at a birth
      doseNull: false,   // ... its neutral control: collected, never written
      repair: true,      // the fidelity gene repairs the dose (battery-paid)
      buffer: true,      // the buffering gene acts
      bufferNull: false, // ... its neutral control: drifts, capacity 0, no cost
      sigma: 0.12,       // the beat's tuning width (a lattice 6.9 degrees off, or 12 % apart in spacing, links at e^-1/2)
      wMax: 4,           // a perfect match's weight (step T1b's wild founders: up to 4)
      wMin: 1,           // weaker links are left out (a random genome then has ~12 links, 3-4 between regulators)
      chi: Math.PI / 4,  // a link's weight x cos(phase difference + chi): A -> B and B -> A differ in sign for most phase pairs
      latStep: 0.006,    // a birth's nudge of an angle (rad) and a ln spacing (x the mutation size: x2.5 by default; the beat amplifies
                         // it: one birth moves the weights ~17 % (tools: a node check of derive), as step T1b's nudges + rewiring)
      phStep: 0.03,      // ... of a phase (rad)
      jump: 0.05,        // chance per birth (x the mutation size) that one regulator's lattice is drawn afresh (as T1b's rewiring)
      foldStep: 0.01,    // a birth's nudge of both folds
      refold: 0.01,      // chance per birth (x the mutation size) of a BIG refold (one fold drawn afresh)
      twistMax: 0.5,     // a fold's twist within +-0.5 rad
      stretchMax: 0.3,   // ... its stretch within +-0.3
      s0: 0.5,           // the stress threshold: heat at half the tolerance (sense 0.25) alone, or a little less with free t inside
      kOn: 0.05,         // refolds per s at full stress (x (S - s0) / (1 - s0))
      kOff: 0.02,        // folds back per s when calm (x (s0 - S) / s0)
      heatW: 2,          // the stress: heatW x heat + oxW x free t. The free-t sense is nearly on/off (0 or ~1: it saturates at a
      oxW: 0.3,          // thousandth of the capacity), the heat sense graded (median 0.04-0.16, top tenth 0.1-0.5; 2026-11-24, 3 scenes)
      doseHeat: 0.04,    // dose per s at heat 1 (Brownian)
      doseOx: 0.006,     // ... at free t 1 (oxidation; the sense is nearly on/off, so a cell holding free t collects this)
      doseFade: 1 / 60,  // the dose fades by itself per s
      doseStep: 0.05,    // at a birth, lattice kicks of doseStep x the parent's dose
      repK: 0.02,        // repair: dose removed per s x (e^F - 1) x D
      repCost: 0.3,      // energy per unit of dose repaired
      bufCap: 0.03,      // the buffer's capacity at gene 1 (one birth's drift at x2.5: ~0.008, so gene 1 hides ~4 births; founders 0.05
                         // hide a fifth of one: nothing)
      bufStep: 0.01,     // a birth's nudge of the buffering gene (x the mutation size)
      bufWeaken: 1,      // capacity x max(0, 1 - bufWeaken x stress)
      bufCost: 0.003,    // energy per s at gene 1 (an engine of rate 1 costs as much)
      bufFounder: 0.05,  // the founders' buffering gene (subtle at first)
      hPhase: 0.3,       // a phase change counts toward the hidden drift x this
      censusEvery: 15,   // s of simulated time between the census's read-backs (0: never)
      out: true,         // the OUTPUTS by lattice too: each reads the regulator whose folded lattice best matches its fixed one (?g3out=0:
                         // step T1b's output wiring), so a refold changes which regulator drives each gene
      founderOut: true,  // std and blank founders get random output gains (each of the 16 outputs with chance founderShare, a gain in
                         // -founderGain..founderGain), so their networks (and so their folds) act from the start (?g3founders=0: no network
                         // effect, as step T1b's founders)
      founderShare: 0.6,
      founderGain: 1.5,
      shockLevel: 0.8,   // the STRESS button: stress added to every cell ...
      shockRate: 10,     // ... the refold rate x this ...
      shockTime: 8,      // ... for this many s of simulated time
    };
    // the toy's hands (src/app.js, src/toy.js): the refold tool's zone (dish px) and the fold it sets; the stress button's end time
    this.zone = null;    // { x, y, r, state }
    this.shockUntil = -1;
    this.target = 1;     // the refold tool sets this fold (1 stress, 0 home; the tool's button again switches)
    this.look = { flash: 2.2, inkOn: [255, 246, 230], inkOff: [110, 210, 255] };   // (into the stress fold: white-hot; home: ice blue; job hues are taken)
    this.derAll = false;  // derive every cell's links afresh on the next frame (a knob changed: moire.folding.rederive())
    this.tot = Object.fromEntries(CNT.map((k) => [k, 0]));
    this.hist = [];
    this.rates = null;
    this.census = null;
    this.series = [];
    this.busy = false;
    this.lastAt = -1e9;
  }

  get bits() {
    const p = this.params;
    return (p.on ? G3.ON : 0) | (p.fold ? G3.FOLD : 0) | (p.foldLife ? G3.FOLDLIFE : 0) | (p.foldNull ? G3.FOLDNULL : 0) |
      (p.dose ? G3.DOSE : 0) | (p.doseNull ? G3.DOSENULL : 0) | (p.repair ? G3.REPAIR : 0) | (p.buffer ? G3.BUF : 0) |
      (p.bufferNull ? G3.BUFNULL : 0) | (this.derAll ? G3.DERALL : 0) | (p.out ? G3.OUT : 0);
  }
  /** Derive every cell's links afresh (after a knob of the derivation changed; releases every hidden variation). */
  rederive() { this.derAll = true; return 'every cell re-derives its links next frame'; }

  /** The gene network pass's words (struct GrnP g3f.. from word o = 12). */
  writeGrn(u, f, o) {
    const p = this.params, n = (x, lo = 0) => Math.max(lo, Number(x) || 0);
    u[o] = this.bits;
    f[o + 1] = n(p.sigma, 1e-3); f[o + 2] = n(p.wMax); f[o + 3] = n(p.wMin); f[o + 4] = n(p.latStep); f[o + 5] = n(p.phStep);
    f[o + 6] = n(p.jump); f[o + 7] = n(p.foldStep); f[o + 8] = n(p.refold); f[o + 9] = n(p.twistMax); f[o + 10] = n(p.stretchMax);
    f[o + 11] = Math.max(0.01, Math.min(0.99, n(p.s0))); f[o + 12] = n(p.kOn); f[o + 13] = n(p.kOff); f[o + 14] = n(p.heatW); f[o + 15] = n(p.oxW);
    f[o + 16] = n(p.doseHeat); f[o + 17] = n(p.doseOx); f[o + 18] = n(p.doseFade); f[o + 19] = n(p.doseStep); f[o + 20] = n(p.repK);
    f[o + 21] = n(p.bufCap); f[o + 22] = n(p.bufStep); f[o + 23] = n(p.bufWeaken); f[o + 24] = Number(p.chi) || 0; f[o + 25] = n(p.hPhase);
    f[o + 26] = Math.min(1, n(p.bufFounder)); f[o + 27] = 0;
    const Z = this.zone, now = this.cells.lastTime || 0, sh = now < this.shockUntil;
    f[o + 28] = Z ? Z.x : 0; f[o + 29] = Z ? Z.y : 0; f[o + 30] = Z ? Math.max(1, Z.r) : 0; f[o + 31] = Z ? Z.state : 0;
    const LF = this.lineFold;
    f[o + 32] = sh ? n(p.shockLevel) : 0; f[o + 33] = sh ? Math.max(1, n(p.shockRate)) : 1;
    f[o + 34] = LF ? (LF.line == null ? -1 : LF.line + 1) : 0; f[o + 35] = LF ? LF.state : 0;
    this.lineFold = null;   // (one frame)
    if (Z && Z.release) this.zone = null;   // (a tap shorter than a frame still acts once)
    this.derAll = false;
  }
  /** The drawing's words (struct Draw g3, g3Ink[2], from word o). */
  writeDraw(a, o, neon = true) {
    const K = this.look;
    a[o] = this.params.on ? Math.max(0, K.flash) * (neon ? 1 : 0.6) : 0; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
    for (let k = 0; k < 3; k++) { a[o + 4 + k] = K.inkOn[k] / 255; a[o + 8 + k] = K.inkOff[k] / 255; }
    a[o + 7] = 1; a[o + 11] = 1;
  }
  /** The REFOLD tool (src/app.js): cells within r of (x, y) (dish px) are put into the fold `state` while it is held; null lifts it. */
  setZone(x, y, r, state = this.target) {
    if (x == null) { if (this.zone) this.zone.release = true; return; }
    this.zone = { x, y, r, state: state ? 1 : 0 };
  }
  /** The refold tool's button again: the fold it sets flips (stress <-> home). */
  flipTarget() { this.target = this.target ? 0 : 1; return this.target; }
  /** A GENOME CARD for the cell nearest (x, y) (dish px): its genome view, home and stress fold, for `ms` of real time (the refold tool). */
  async card(x, y, ms = 7000) {
    const C = this.cells, d = C.device, n = C.count;
    const cellAB = await readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4);
    const f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
    let best = -1, bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!(u[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
      const dd = Math.hypot(f[i * CELL_FLOATS] - x, f[i * CELL_FLOATS + 1] - y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0 || bd > 4 * (C.R || 9)) return null;
    await this.show({ cells: [best], size: 150, card: true });
    clearTimeout(this.cardT);
    this.cardT = setTimeout(() => this.hide(), ms);
    return best;
  }
  /** The STRESS button: every cell's stress raised for shockTime s (refolds come fast); calm folds them back over the next minute. */
  shock() { this.shockUntil = (this.cells.lastTime || 0) + Math.max(0.5, Number(this.params.shockTime) || 8); return `stress shock for ${this.params.shockTime} s`; }

  /** The eat pass's words (struct EatP g3, from word o), dt the tick. */
  writeEat(u, f, o, dt) {
    const p = this.params, on = !!p.on;
    u[o] = (on && p.buffer && !p.bufferNull ? G3E.BUF : 0) | (on && p.repair ? G3E.REP : 0) | (on ? G3E.COUNT : 0);
    f[o + 1] = Math.max(0, Number(p.repCost) || 0) * HEAT_SCALE;
    f[o + 2] = Math.max(0, Number(p.bufCost) || 0) * HEAT_SCALE * Math.max(1e-4, dt);
    f[o + 3] = 0;
  }

  /** The heat ledger's read-back (Int32 words; called by src/eat.js apply): the events since the last one. */
  apply(rec, w) {
    const v = (k) => { let s = 0; for (let j = 0; j < 4; j++) s += w[LG_DIV + 16 * ROW + 4 * k + j]; return s; };
    const T = this.tot;
    CNT.forEach((k, j) => { T[k] += v(j); });
    const H = this.hist;
    H.push([rec.time, ...CNT.map((k) => T[k])]);
    while (H.length > 2 && rec.time - H[1][0] >= 20) H.shift();
    if (H.length && rec.time < H[0][0]) H.length = 0;
    const dt = H.length ? rec.time - H[0][0] : 0;
    const d = (j) => (H.length ? H[H.length - 1][1 + j] - H[0][1 + j] : 0);
    this.rates = { time: rec.time, on: dt > 0.5 ? d(0) / dt : 0, off: dt > 0.5 ? d(1) / dt : 0, rel: dt > 0.5 ? d(2) / dt : 0, big: dt > 0.5 ? d(3) / dt : 0,
      tot: { ...T } };
    if (this.census) this.census.rates = this.rates;
  }

  /** Once a frame: start the census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || !this.params.on || (time - this.lastAt < every && time >= this.lastAt)) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('folding census:', e); });
  }
  /** The census now (a fresh read-back; for the console and the experiments' evals). */
  now() { return this.read(this.lastAt); }

  async read(time = this.lastAt) {
    if (this.busy) return this.census;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
      this.census = this.analyse(new Float32Array(bioAB), new Float32Array(cellAB), new Uint32Array(cellAB), n, time);
      this.census.rates = this.rates;
      const c = this.census, S = this.series, last = S[S.length - 1];
      if (last && c.time < last[0]) S.length = 0;
      S.push([c.time, c.n, c.stressFold, c.dose, c.buf, c.hidden, c.hiddenLinks, c.drift, c.wirings]);
      if (S.length > 400) S.shift();
      return this.census;
    } finally {
      this.busy = false;
    }
  }

  analyse(g, f, u, n, time) {
    const P = this.params, founders = (this.cells.genome && this.cells.genome.founders) || [];
    let live = 0, stressN = 0, doseS = 0, bufS = 0, bufS2 = 0, hidS = 0, hidL = 0, hidLN = 0, lineS = 0, stS = 0, driftS = 0, driftN = 0, setN = 0;
    let buffered = 0, repairing = 0, repS = 0, foldD = 0;
    const hi = { n: 0, buf: 0, fid: 0, dose: 0 }, lo = { n: 0, buf: 0, fid: 0, dose: 0 };   // stressed places (S >= s0) vs calm
    const lin = new Map(), heats = [], ts = [];
    const SAMPLE = Math.max(1, Math.floor(n / 600));   // the hidden links: a derivation per sampled cell
    for (let i = 0; i < n; i++) {
      const oc = i * CELL_FLOATS;
      if (!(u[oc + C_FLAGS] & 1)) continue;
      live++;
      const o = i * BIO_FLOATS, L = latticesOf(g, o);
      const gsw = Math.max(0, Math.round(g[o + W_GS + 3] || 0));
      if (gsw & GS.SET) setN++;
      const lineN = Math.floor(gsw / GS_LINE);
      const dose = g[o + W_GS] || 0, hid = g[o + W_GS + 1] || 0, fid = g[o + W_FID] || 0;
      const s0 = u[oc + C_SNS0], s1 = u[oc + C_SNS1];
      const tIn = ((s0 >>> 8) & 255) / 255, heat = ((s1 >>> 8) & 255) / 255;
      const st = Math.max(0, Math.min(1, P.heatW * heat + P.oxW * tIn));
      heats.push(heat); ts.push(tIn);
      stressN += L.state; doseS += dose; bufS += L.buf; bufS2 += L.buf * L.buf; hidS += hid; lineS += lineN; stS += st;
      if (hid > 1e-6) buffered++;
      if ((g[o + W_GS + 2] || 0) > 0) { repairing++; repS += g[o + W_GS + 2]; }
      const side = st >= P.s0 ? hi : lo;
      side.n++; side.buf += L.buf; side.fid += fid; side.dose += dose;
      // lattice drift from the cell's founder (its founder genome, when the dish still knows it): RMS over angles (folded) and spacings
      const fid0 = Math.round(g[o + W_FOUNDER] || 0), F0 = founders[fid0];
      if (F0 && F0.length > W_LP) {
        let s = 0;
        for (let r = 0; r < 8; r++) {
          const da = L.th[r] - F0[W_LA + r], dd = da - PI3 * Math.round(da / PI3), dl = L.lk[r] - F0[W_LK + r];
          s += dd * dd + dl * dl;
        }
        driftS += Math.sqrt(s / 16); driftN++;
      }
      const cached = cachedLinks(g, o);
      const key = wiringKey(cached);
      let Lg = lin.get(fid0);
      if (!Lg) { Lg = { id: fid0, n: 0, keys: new Map(), stress: 0, fac: [[0, 0, 0], [0, 0, 0]], facN: [0, 0], dose: 0, buf: 0, st: 0 }; lin.set(fid0, Lg); }
      Lg.n++; Lg.keys.set(key, (Lg.keys.get(key) || 0) + 1); Lg.stress += L.state; Lg.dose += dose; Lg.buf += L.buf; Lg.st += st;
      // what the fold changes: the outputs' factors (engines, pigment, wall, glue...) in each fold, by lineage
      const fs = L.state;
      Lg.facN[fs]++;
      const x = (r) => Math.max(0, Math.min(1, g[o + BIO_GRN + r]));
      const reg = (q) => (Math.max(0, Math.round(g[o + GRN_O + (q >> 2)])) >> (3 * (q & 3))) & 7;
      const fac = (q) => Math.min(Math.exp(Math.max(-8, Math.min(8, g[o + GRN_U + q])) * x(reg(q))), 4);
      Lg.fac[fs][0] += fac(1) + fac(2) + fac(3); Lg.fac[fs][1] += fac(0); Lg.fac[fs][2] += fac(7);
      // hidden links: the links the current lattices would give, against the cached ones (a sample of cells)
      if (i % SAMPLE === 0 && P.on) {
        hidL += linkDiff(derive(L, foldInUse(L, P), P), cached); hidLN++;
        if (P.fold) foldD += linkDiff(derive(L, L.home, P), derive(L, L.stress, P));   // what a refold would rewire
      }
    }
    const m = Math.max(1, live), mb = bufS / m;
    const lineages = [...lin.values()].sort((a, b) => b.n - a.n).filter((l) => l.n >= 20).slice(0, 6).map((l) => {
      const top = Math.max(...l.keys.values());
      const fr = (k, j) => (l.facN[k] ? l.fac[k][j] / l.facN[k] : null);
      const ratio = (j) => (l.facN[0] >= 5 && l.facN[1] >= 5 ? fr(1, j) / Math.max(1e-3, fr(0, j)) : null);
      return { id: l.id, n: l.n, wirings: l.keys.size, topWiring: top / l.n, stressFold: l.stress / l.n, dose: l.dose / l.n, buf: l.buf / l.n,
        stress: l.st / l.n, foldEngine: ratio(0), foldPigment: ratio(1), foldGlue: ratio(2) };
    });
    const avg = (s) => (s.n ? { n: s.n, buf: s.buf / s.n, fid: s.fid / s.n, dose: s.dose / s.n } : { n: 0, buf: null, fid: null, dose: null });
    return {
      time, n: live, derived: setN / m,
      stressFold: stressN / m, stress: stS / m, dose: doseS / m, repairing: repairing / m, repairPerS: repS / m / Math.max(1e-4, this.cells.lastDt || 1 / 60),
      buf: mb, bufSd: Math.sqrt(Math.max(0, bufS2 / m - mb * mb)), hidden: hidS / m, buffered: buffered / m,
      hiddenLinks: hidLN ? hidL / hidLN : 0, foldLinks: hidLN ? foldD / hidLN : 0, lineRefolds: lineS / m, drift: driftN ? driftS / driftN : null,
      wirings: lineages.reduce((a, l) => a + l.wirings, 0), lineages,
      stressed: avg(hi), calm: avg(lo),
      senses: { heat: quant(heats), t: quant(ts) },   // what the stress is made of: the heat and free t senses' 10, 50, 90 % quantiles
    };
  }

  /**
   * A page overlay of GENOME VIEWS (for pictures and the console): the largest lineages' middle cells (by battery), each as a pair: its
   * genome under the HOME fold and under its STRESS fold (the same lattices, refolded), with the regulators' expression as brightness.
   * opts: { lineages (4), size (220 CSS px per view), cells: [slot, ...] instead }. moire.folding.hide() removes it.
   */
  async show(opts = {}) {
    const C = this.cells, d = C.device, n = C.count;
    const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
    const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
    let picks = opts.cells;
    if (!picks) {
      const lin = new Map();
      for (let i = 0; i < n; i++) {
        if (!(u[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
        const id = Math.round(g[i * BIO_FLOATS + W_FOUNDER]);
        if (!lin.has(id)) lin.set(id, []);
        lin.get(id).push(i);
      }
      picks = [...lin.values()].sort((a, b) => b.length - a.length).slice(0, opts.lineages || 4).map((m) => {
        m.sort((a, b) => f[a * CELL_FLOATS + C_BAT] - f[b * CELL_FLOATS + C_BAT]);
        return m[Math.floor(m.length / 2)];
      });
    }
    this.hide();
    const sz = opts.size || 220, dpr = Math.min(2, window.devicePixelRatio || 1), S = Math.round(sz * dpr), gap = Math.round(8 * dpr), lab = Math.round(18 * dpr);
    const cv = document.createElement('canvas');
    cv.id = 'g3view';
    cv.width = 2 * S + 3 * gap; cv.height = picks.length * (S + lab + gap) + gap;
    Object.assign(cv.style, { position: 'fixed', inset: 'auto', ...(opts.card ? { left: '12px', bottom: '118px' } : { right: '12px', top: '12px' }), width: `${cv.width / dpr}px`, height: `${cv.height / dpr}px`, zIndex: 50,
      background: '#000', border: '1px solid rgba(217,221,230,0.15)' });
    const cx = cv.getContext('2d');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, cv.width, cv.height);
    const tile = document.createElement('canvas');
    tile.width = tile.height = S;
    const tc = tile.getContext('2d');
    picks.forEach((i, k) => {
      const o = i * BIO_FLOATS, y = gap + k * (S + lab + gap), L = latticesOf(g, o);
      for (const st of [0, 1]) {
        const g2 = g.slice(o, o + BIO_FLOATS);
        g2[W_FS + 3] = st;
        drawGenome(tc, S, g2, 0, { ...this.params, foldNull: false });
        cx.drawImage(tile, gap + st * (S + gap), y + lab);
      }
      cx.fillStyle = 'rgba(217,221,230,0.85)'; cx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
      cx.fillText(`line ${Math.round(g[o + W_FOUNDER])} · cell ${i} · now in the ${L.state ? 'STRESS' : 'home'} fold · home | stress`, gap, y + lab * 0.75);
    });
    document.body.append(cv);
    return { cells: picks };
  }
  hide() { const e = document.getElementById('g3view'); if (e) e.remove(); }

  /**
   * LAB and ZOO: put every live cell (or those of founder line `line`) into a fold (1 stress, 0 home) on the next frame, on the GPU (race-free;
   * re-derived, flashing). A scientist's hand, like the pipette: what the cells then do comes from their own genomes. Refolding in life goes on
   * (moire.folding.params.foldLife = false keeps them there).
   */
  forceFold(state = 1, line = null) {
    this.lineFold = { state: state ? 1 : 0, line: line == null ? null : Math.round(line) };
    return `next frame: ${line == null ? 'every cell' : `line ${line}`} into the ${state ? 'stress' : 'home'} fold`;
  }

  /**
   * LAB: what a refold DOES. phenotype(true) keeps each live cell's 16 output factors (ln, from its gains, the regulators its outputs read
   * and their expression now); phenotype() later compares the same slots (same founder line), returning per output the mean |change in ln
   * factor| (ln 2 = a gene's level doubled or halved), the share of cells whose largest change is past ln 2, and how many cells were compared.
   */
  async phenotype(keep = false) {
    const C = this.cells, d = C.device, n = C.count;
    const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
    const g = new Float32Array(bioAB), u = new Uint32Array(cellAB);
    const now = new Map();
    for (let i = 0; i < n; i++) {
      if (!(u[i * CELL_FLOATS + C_FLAGS] & 1)) continue;
      const o = i * BIO_FLOATS, fac = new Float32Array(16);
      for (let q = 0; q < 16; q++) {
        const r = (Math.max(0, Math.round(g[o + GRN_O + (q >> 2)])) >> (3 * (q & 3))) & 7;
        fac[q] = Math.max(-8, Math.min(Math.log(4), g[o + GRN_U + q] * Math.max(0, Math.min(1, g[o + BIO_GRN + r]))));
      }
      now.set(i, { line: Math.round(g[o + W_FOUNDER]), fac, state: latticesOf(g, o).state });
    }
    if (keep || !this.pheno) { this.pheno = now; return { kept: now.size }; }
    const dm = new Array(16).fill(0);
    let k = 0, big = 0, sw = 0;
    for (const [i, c] of now) {
      const p = this.pheno.get(i);
      if (!p || p.line !== c.line) continue;
      k++;
      let mx = 0;
      for (let q = 0; q < 16; q++) { const e = Math.abs(c.fac[q] - p.fac[q]); dm[q] += e; mx = Math.max(mx, e); }
      if (mx > Math.LN2) big++;
      if (p.state !== c.state) sw++;
    }
    return { compared: k, switched: k ? sw / k : 0, bigShare: k ? big / k : 0, meanChange: k ? dm.reduce((a, b) => a + b, 0) / (16 * k) : 0,
      perOutput: Object.fromEntries(['pigment', 'engine 1', 'engine 2', 'engine 3', 'wall', 'thickness', 'stiffness', 'glue', 'pumps', 'channels',
        'kin channels', 'display', 'division', 'motility', 'emit A', 'emit B'].map((nm, q) => [nm, k ? +(dm[q] / k).toFixed(3) : 0])) };
  }

  /** The entropy panel's FOLDING line. */
  panelLine(compact = false) {
    const p = this.params, C = this.census, R = this.rates;
    if (!p.on) return 'FOLDING (moire genome off: step T1b weights)';
    const nul = [p.foldNull && 'fold', p.doseNull && 'dose', p.bufferNull && 'buffer'].filter(Boolean);
    const state = nul.length ? ` · NULL ${nul.join('+')}` : '';
    if (!C || !C.n) return `FOLDING${state}  …`;
    const pc = (x) => `${Math.round(100 * x)}%`, f2 = (x) => (x == null ? '-' : x.toFixed(2)), f3 = (x) => (x == null ? '-' : x.toFixed(3));
    const rr = R ? `refolds ${R.on.toFixed(2)}/s in, ${R.off.toFixed(2)}/s back, big ${R.big.toFixed(2)}/s · releases ${R.rel.toFixed(2)}/s` : '';
    if (compact) return `FOLDING stress fold ${pc(C.stressFold)} · dose ${f2(C.dose)} · buffer ${f2(C.buf)} · hidden ${f2(C.hiddenLinks)} links${state}`;
    return `FOLDING${state}  stress fold ${pc(C.stressFold)} (stress ${f2(C.stress)}) · ${rr} · dose ${f2(C.dose)} (repairing ${pc(C.repairing)})` +
      ` · buffer ${f2(C.buf)}±${f2(C.bufSd)} (hidden ${f3(C.hidden)}, ${f2(C.hiddenLinks)} links/cell, ${pc(C.buffered)} carrying) · drift ${f2(C.drift)}` +
      ` · a refold rewires ${f2(C.foldLinks)} links · wirings ${C.wirings}`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`moire genome (step G3): ${on(p.on)} · fold ${on(p.fold)}${p.foldNull ? ' NULL' : ''} (in life ${on(p.foldLife)}, s0 ${p.s0}, kOn ${p.kOn}, kOff ${p.kOff})` +
      ` · dose ${on(p.dose)}${p.doseNull ? ' NULL' : ''} (repair ${on(p.repair)}) · buffer ${on(p.buffer)}${p.bufferNull ? ' NULL' : ''} (cap ${p.bufCap}, cost ${p.bufCost}/s)` +
      ` · sigma ${p.sigma} wMax ${p.wMax} wMin ${p.wMin} · steps lattice ${p.latStep} phase ${p.phStep} jump ${p.jump} fold ${p.foldStep} refold ${p.refold}`];
    if (C && C.n) {
      const f2 = (x) => (x == null ? '-' : x.toFixed(2));
      lines.push(`folding: stressed places ${C.stressed.n} (buffer ${f2(C.stressed.buf)}, fidelity ${f2(C.stressed.fid)}, dose ${f2(C.stressed.dose)}) vs calm ${C.calm.n}` +
        ` (buffer ${f2(C.calm.buf)}, fidelity ${f2(C.calm.fid)}, dose ${f2(C.calm.dose)}) · refolds per line ${f2(C.lineRefolds)}`);
      for (const l of C.lineages.slice(0, 4)) {
        lines.push(`lineage ${l.id}: ${l.n} cells, ${l.wirings} wirings (top ${Math.round(100 * l.topWiring)}%), stress fold ${Math.round(100 * l.stressFold)}%` +
          `, fold changes engines x${f2(l.foldEngine)} pigment x${f2(l.foldPigment)} glue x${f2(l.foldGlue)}`);
      }
    }
    return lines;
  }
}
