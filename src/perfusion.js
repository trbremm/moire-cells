// PERFUSION, the microfluidic chip analogy (the user, 2026-11-17: "I am not happy with point like vents. Maybe the microfluidics chip
// analogy is better"). README "Dish size and densities": "Extended sources and perfusion".
//
//   INLET        one side of the dish is a long LINE SOURCE along the wall (src/matter.js addLine: a spring of kind 'medium'),
//                dripping a RECIPE of fresh medium (which substances, in which shares) at `rate` atoms per s for every R of its
//                length: booked as added, exactly as every spring
//   THROUGH-FLOW the water flows from the inlet side to the outlet side at a mean `speed` (R per s), with a channel's profile
//                (fastest in the middle, still along the side walls): a stream-function term added to the currents (water.wgsl
//                through(): divergence-free, moved by the same flux-form exact advection as the eddies)
//   OUTLET       the opposite side's rim lets out `outlet` of its mobile matter per s (instead of the rim's usual sink): the water
//                leaving the chip carries whatever it holds, booked as lost
// So the dish becomes a chemostat: fresh medium in, gradients along the flow, spent medium out (in = out + kept, exactly).
// No walls yet: the chip's channels and pillars come later (G0b). The flow is prescribed (it does not feel cells or matter); a
// two-way water solver (G0) should replace `through` by a pressure-driven flow round obstacles, keep the inlet as a source line
// and the outlet as a sink line, and let the flow carry cells by drag as now.
// URL: ?perfusion=1 ?flow=x (R/s) ?flowdir=right|left|down|up (where the water goes) ?inlet=x (atoms/s per R) ?outlet=x (share per s)
// ?recipe=gt:0.4,l:0.2,... (shares of atoms).

import { SPRING_KINDS } from './matter.js';

export const MEDIUM_RECIPE = { gt: 0.35, l: 0.2, L: 0.15, gT: 0.15, GT: 0.1, trace: 0.05 };   // minerals, linkers, some fuel, a little trace
SPRING_KINDS.medium = { label: 'inlet (fresh medium)', mix: { ...MEDIUM_RECIPE }, stroke: 1.5 };

const SIDES = { right: 1, left: 2, down: 3, up: 4 };   // where the water GOES (the outlet's side, matter.wgsl chg.w)

export class Perfusion {
  constructor(matter) {
    this.matter = matter;
    matter.perfusion = this;
    this.params = {
      on: false,          // ?perfusion=1 (the chip preset)
      speed: 0.4,         // the through-flow's mean speed (R per s)
      dir: 'right',       // where the water goes: the inlet on the opposite side
      rate: 0.6,          // atoms per s the inlet drips for every R of its length
      outlet: 3,          // share per s of the outlet rim's mobile matter that leaves
      recipe: { ...MEDIUM_RECIPE },
    };
    this.inlet = null;    // the inlet's spring
  }

  get flowing() { return !!(this.params.on && this.params.speed > 0); }

  /** The through-flow's mean velocity (CSS px per s) for the cells' radius R. */
  velocity(R) {
    const U = Math.max(0, this.params.speed) * R, d = this.params.dir;
    return d === 'left' ? [-U, 0] : d === 'down' ? [0, U] : d === 'up' ? [0, -U] : [U, 0];
  }

  /** Lay the inlet along the wall the water comes from (once the dish's size is known). */
  start(W, H, R) {
    const P = this.params;
    if (!P.on) return;
    SPRING_KINDS.medium.mix = { ...P.recipe };
    const M = this.matter, d = P.dir, inset = 0.8 * R;
    const across = d === 'right' || d === 'left';
    const len = ((across ? H : W) - 2 * R) / R;
    const x = d === 'right' ? inset : d === 'left' ? W - inset : W / 2;
    const y = d === 'down' ? inset : d === 'up' ? H - inset : H / 2;
    M.addLine(x, y, 'medium', len, across ? 90 : 0, P.rate, 1e9);
    this.inlet = M.springs[M.springs.length - 1];
    this.inlet.inlet = true;
  }

  /** The matter's words: the outlet's share per tick (struct MatterP sea.w) and its side (chg.w). */
  writeMatter(u, f, dt) {
    const P = this.params;
    if (!P.on || !(P.outlet > 0)) { f[175] = 0; u[95] = 0; return; }
    f[175] = 1 - Math.exp(-P.outlet * dt);
    u[95] = SIDES[P.dir] || 1;
  }

  /** The F overlay. */
  overlayLine() {
    const P = this.params;
    if (!P.on) return 'perfusion off (?perfusion=1, the chip preset)';
    const rec = Object.entries(P.recipe).map(([a, v]) => `${a} ${v}`).join(' ');
    return `perfusion: water flows ${P.dir} at ${P.speed} R/s (mean; still at the side walls) · inlet ${P.rate} atoms/s per R (${rec}) · outlet lets out ${P.outlet}/s`;
  }
}

/** ?recipe=gt:0.4,l:0.2 -> { gt: 0.4, l: 0.2 } (shares normalised to 1), or null. */
export function parseRecipe(s, names) {
  if (!s) return null;
  const out = {};
  let tot = 0;
  for (const part of String(s).split(',')) {
    const [a, v] = part.split(':');
    const x = Number(v);
    if (names.includes(a) && x > 0) { out[a] = x; tot += x; }
  }
  if (!(tot > 0)) return null;
  for (const a of Object.keys(out)) out[a] /= tot;
  return out;
}
