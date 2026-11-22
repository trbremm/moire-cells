// Step F0: COLOUR BY JOB (user, 2026-11-17: "I dont want the fates anymore"). The hand-written contact fates of Part B (stem,
// epithelium, muscle, neuron, cartilage) are gone; a cell's colour now says what it DOES, read from its genes AS EXPRESSED (the
// gene network's outputs, step T1b) and its engines (step C6), never from a label:
//
//   job          ink (neon)        what counts toward it (per tick, the cell's genes as expressed)
//   undecided    warm white        no job clearly ahead of the others (the founders' generalists), or nothing much expressed
//   light eater  lime              uphill engines with a PIGMENT (a light band), x the pigment output, counted x JOB_W_LIGHT
//                                  (every harvester must also burn, so its burners would otherwise outvote its pigment)
//   breather     hot pink          engines in which a free light taker (oxygen, t) grabs an electron: burning, breathing (C12d kind 2)
//   fermenter    violet            the other downhill engines (no oxygen): fermenting bonds, swaps, trades (kind 1)
//   gradient     cyan              downhill engines that bond two FREE atoms other than oxygen (g + T, G + T: the vents' redox gradient)
//   builder      amber             chain-making engines (form) + the crust WALL gene x the wall output, x JOB_W_WALL
//   predator     red               the ENGULF gene x its output, x JOB_W_ENGULF, + JOB_W_EAT while it wraps or digests a meal
//
// Each score is LOW-PASSED in the cell (time constant JOB_TAU, about 6 s; the state words Bio.acc and Bio.resp.xy, which held the
// fates' accumulators and response genes), and daughters inherit the parent's, so colours change smoothly and never flicker. The JOB
// is the highest score; how strongly it shows (0 = undecided white .. 1 = the job's full ink) grows with its lead over the second
// (margin) and with its own size (level): see job_of in cell_common.wgsl, mirrored by jobOf below for the zoo and the panel.
//
// The engine table is read from src/matter.js (ENGINES: kind 0 uphill, 1 ferment, 2 breathe, 3 form; the old table ?electrons=0:
// 1 burn, 2 swap), so a new chemistry only needs its kinds kept; its classes are written into the shaders as constants.
import { ALL_ENGINES as ENGINES, SUBSTANCES } from './matter.js';   // (step C15b: and the carbon engines: OXIDIZE breathe, CONDENSE build, REDUCE light)
import { setShaderConst } from './gpu.js';

export const JOBS = [
  { id: 'undecided', label: 'undecided', help: 'no job ahead of the others (generalists, like the founders) or little expressed' },
  { id: 'light', label: 'light eater', help: 'a pigment drives its uphill engines (light-made fuel or free atoms)' },
  { id: 'breathe', label: 'breather', help: 'burns or breathes: a free light taker (oxygen-like t) takes an electron' },
  { id: 'ferment', label: 'fermenter', help: 'downhill engines without oxygen: ferments bonds, swaps and trades' },
  { id: 'gradient', label: 'gradient eater', help: 'bonds two free atoms other than oxygen (g + T, G + T): lives on the vents\' redox gradient' },
  { id: 'build', label: 'builder', help: 'makes chains or builds a crust wall' },
  { id: 'predator', label: 'predator', help: 'engulfs other cells (the engulf gene expressed, or a meal inside)' },
];

// the same numbers as cell_common.wgsl (JOB_*): keep in step
export const JOB = { tau: 6, wLight: 2.5, wWall: 3, wEngulf: 6, wEat: 4, mLo: 0.1, mHi: 0.5, lLo: 0.2, lHi: 0.8 };

/** An engine's job class: 0 none (a battery-paid uphill engine without pigment: a storer, or a cracker), 1 light (uphill: only with a
 *  pigment band, the slot decides), 2 breathe, 3 ferment, 4 gradient, 5 build. */
export function engineClass(e) {
  if (!e) return 0;
  if (e.kind === 0) return 1;
  if (e.kind === 3) return 5;
  const free = e.ins.length === 2 && e.ins.every((c) => SUBSTANCES[c] && SUBSTANCES[c].kind === 'atom');
  if (e.kind === 2) return 2;
  return free ? 4 : 3;
}
export const ENGINE_CLASS = ENGINES.map(engineClass);
// 4 bits per engine, 8 engines per word (cell_common.wgsl job_class)
for (let w = 0; w < 4; w++) {
  let v = 0;
  for (let k = 0; k < 8; k++) v |= (ENGINE_CLASS[8 * w + k] || 0) << (4 * k);
  setShaderConst(`JOB_ENG${w}`, v >>> 0);
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The job of the cell whose Bio words start at g[b]: { job (0..6), strength (0..1), scores[6] } (as job_of in cell_common.wgsl). */
export function jobOf(g, b) {
  const s = [g[b + 20], g[b + 21], g[b + 22], g[b + 23], g[b + 8], g[b + 9]].map((x) => Math.max(0, x || 0));
  let top = 0, k = -1, second = 0;
  for (let j = 0; j < 6; j++) {
    if (s[j] > top) { second = top; top = s[j]; k = j; } else if (s[j] > second) second = s[j];
  }
  if (k < 0) return { job: 0, strength: 0, scores: s };
  const strength = smooth(JOB.mLo, JOB.mHi, (top - second) / Math.max(top, 1e-3)) * smooth(JOB.lLo, JOB.lHi, top);
  return { job: k + 1, strength, scores: s };
}

/** The job's ink (0..255 rgb) from a palette: the undecided ink mixed toward the job's by its strength. */
export function jobInk(P, j) {
  const u = P.job[0], c = P.job[j.job] || u;
  return u.map((v, q) => v + (c[q] - v) * j.strength);
}
