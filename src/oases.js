// Step N1, A NUTRIENT LANDSCAPE (the user, 2026-11-16: "I think light is fueling them too easily. We might need to make the
// nutrient landscape more interesting"; the dish should have GEOGRAPHY: things to find, defend, share). Part 3: ONE SCARCE NUTRIENT.
// README "Step N1: nutrient landscape".
//
//   THE NUTRIENT   TRACE, the rare inert row 3 atom (phosphorus-like). Nothing new in the table: trace was already the engines' cofactor
//                  (step C7b: every engine runs at 35 % without it) and is now the heart of every pigment (src/pigments.js), so a
//                  cell needs it to catch light at all and to run its engines at full speed. It never reacts, barely spreads (0.017
//                  R^2 per s) and hardly passes a membrane: it stays where it is dripped, unless the water carries it (src/water.js).
//   SCARCE         with `scarce` on, no spring drips trace (the vents' and every preset's trace share is left out, the rest of the
//                  mix scaled up so a spring drips as many atoms as before), except the OASES: `count` NUTRIENT SPRINGS (tap mode
//                  "oasis" too), each dripping trace and the light linkers l a pigment is built from, at `rate` atoms per s
//   ROAMING        with `roam` on, the oases WANDER slowly (a smooth random walk, `wander` R per s), PULSE (their rate x (1 + pulse x
//                  sin), each with its own period), DRY UP after `life` s (+- half) and, `gap` s later, a new one rises somewhere
//                  else. Off: they stay put and never dry. Matter is booked exactly as every spring's (the springs' drip is counted
//                  on the GPU as it is dripped, wherever and however fast).
// Switches: the rules panel's group "Nutrient landscape (step N1)", URL ?scarce=0 ?roam=0 ?oases=N.

import { SPRING_KINDS } from './matter.js';

const TAU = 2 * Math.PI;

function rng32(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const OASIS_MIX = { trace: 0.5, l: 0.5 };
SPRING_KINDS.oasis = { label: 'nutrient spring (oasis)', mix: OASIS_MIX, stroke: 1.75 };

export class Oases {
  constructor(matter, seed = 1) {
    this.matter = matter;
    matter.oases = this;
    this.rng = rng32((seed ^ 0x0a5e5) >>> 0);
    // live-tunable: moire.oases.params
    this.params = {
      scarce: true,       // trace only from the oases (?scarce=0: every spring drips its trace as before)
      roam: true,         // the oases wander, pulse, dry up and rise elsewhere (?roam=0: they stay put, never dry)
      count: 3,           // how many oases the dish keeps (?oases=N; 0: none)
      rate: 1,            // atoms per s an oasis drips at its mean (trace and l, half each)
      wander: 0.12,       // how fast an oasis wanders (R per s)
      pulse: 0.6,         // its rate swings by this share
      period: [40, 110],  // ... over this many s (each its own)
      life: 300,          // s an oasis lives (each 0.5 to 1.5 x this)
      gap: 20,            // s before a dried oasis rises again elsewhere (each 0.5 to 1.5 x this)
      gush: 4,            // a new oasis gushes: x this rate at first, settling over `gushTime` s
      gushTime: 30,
      margin: 0.08,       // shares of the dish's shorter side kept free at the edges
      bury: 1 / 150,      // with the nutrient scarce: the share of the free trace in the dish that settles into the floor per s (buried,
                          // booked as lost), so plumes fade with distance and old oases do not leave trace everywhere (?bury=)
    };
    this.list = [];       // { s (the spring), vx, vy, period, phase, rate0 }
    this.pending = [];    // times a new oasis is due
    this.view = null;
    this.started = false;
    this.time = 0;
  }

  /** The mix a spring drips this frame: with the nutrient scarce, no trace but from the oases (the rest scaled up to the same rate). */
  mixFor(s, mix) {
    if (!this.params.scarce || s.kind === 'oasis' || s.drop || !(mix.trace > 0)) return mix;
    const rest = 1 - mix.trace, out = {};
    if (!(rest > 0)) return {};
    for (const [a, v] of Object.entries(mix)) if (a !== 'trace') out[a] = v / rest;
    return out;
  }

  /** The share of the free trace that settles per tick (struct MatterP n1.w; 0 while trace is not scarce). */
  buryPerTick(dt) { const b = this.params.bury; return this.params.scarce && b > 0 ? 1 - Math.exp(-b * dt) : 0; }

  resize(view) {
    if (this.view && (this.view.cssW !== view.cssW || this.view.cssH !== view.cssH)) {
      const sx = view.cssW / this.view.cssW, sy = view.cssH / this.view.cssH;
      for (const o of this.list) { o.vx *= sx; o.vy *= sy; }
    }
    this.view = view;
  }

  /** Place the dish's oases now (the default scene and the presets call it; `at`: a list of [x, y] for the first ones; [x, y, 'fixed']: one
   * that stays put and never dries, only pulses: a lasting oasis). */
  start(at = []) {
    this.started = true;
    for (const o of this.list) this.remove(o);
    this.list = []; this.pending = [];
    const n = Math.max(0, Math.round(this.params.count));
    for (let k = 0; k < n; k++) this.rise(at[k] || null, !!(at[k] && at[k][2] === 'fixed'));
  }

  remove(o) {
    const S = this.matter.springs, i = S.indexOf(o.s);
    if (i >= 0) S.splice(i, 1);
  }

  /** A new oasis at p (or a random place, away from the edges and from the other oases). */
  rise(p = null, fixed = false) {
    const v = this.view, P = this.params, R = this.R();
    if (!v) return;
    const W = v.cssW, H = v.cssH, m = P.margin * Math.min(W, H);
    let best = null, bestD = -1;
    for (let tries = 0; tries < (p ? 1 : 12); tries++) {
      const q = p || [m + this.rng() * (W - 2 * m), m + this.rng() * (H - 2 * m)];
      let d = 1e9;
      for (const o of this.list) d = Math.min(d, Math.hypot(o.s.x - q[0], o.s.y - q[1]));
      if (d > bestD) { bestD = d; best = q; }
    }
    const life = P.roam && !fixed ? P.life * (0.5 + this.rng()) : 1e9;
    const rate0 = Math.max(0, P.rate);
    const ok = this.matter.addSpring(best[0], best[1], 'oasis', life, { rate: rate0 });
    if (!ok) return;
    const s = this.matter.springs[this.matter.springs.length - 1];
    s.roam = true;
    if (fixed) s.fixed = true;
    const a = TAU * this.rng(), sp = P.wander * R;
    this.list.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, period: P.period[0] + (P.period[1] - P.period[0]) * this.rng(), phase: TAU * this.rng(), rate0 });
  }

  R() { return (this.matter.heat && this.matter.heat.R) || 6; }

  /** Adopt the oases a snapshot brought (its springs of kind 'oasis'). */
  adopt() {
    this.pending = [];
    this.list = this.list.filter((o) => this.matter.springs.includes(o.s));
    for (const s of this.matter.springs) {
      if (s.kind !== 'oasis' || this.list.some((o) => o.s === s)) continue;
      s.roam = true;
      const a = TAU * this.rng(), sp = this.params.wander * this.R();
      this.list.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, period: 75, phase: TAU * this.rng(), rate0: s.rate ?? this.params.rate });
    }
    this.started = true;
  }

  /** Each frame, before the matter writes its springs: wander, pulse; the dried ones replaced. */
  compute(encoder, frame) {
    this.time = frame.time;
    if (!this.started || !this.view || !frame.ticks) return;
    const P = this.params, dt = frame.dt, R = this.R(), v = this.view;
    // the ones the matter removed (dried up, or pushed out by a newer spring)
    const alive = this.list.filter((o) => this.matter.springs.includes(o.s));
    const lost = this.list.length - alive.length;
    this.list = alive;
    for (let k = 0; k < lost; k++) this.pending.push(frame.time + P.gap * (0.5 + this.rng()));
    const want = Math.max(0, Math.round(P.count));
    while (this.list.length + this.pending.length < want) this.pending.push(frame.time);
    while (this.list.length + this.pending.length > want && this.pending.length) this.pending.pop();
    this.pending.sort((a, b) => a - b);
    while (this.pending.length && this.pending[0] <= frame.time) { this.pending.shift(); this.rise(); }
    const m = P.margin * Math.min(v.cssW, v.cssH);
    for (const o of this.list) {
      const s = o.s;
      if (!P.roam || s.fixed) { s.rate = o.rate0 * (s.fixed && P.roam ? Math.max(0, 1 + P.pulse * Math.sin(TAU * frame.time / o.period + o.phase)) : 1) * (1 + Math.max(0, P.gush - 1) * Math.exp(-Math.max(0, s.age) / Math.max(1, P.gushTime))); continue; }
      // a smooth random walk: the heading turns slowly, the speed stays near `wander`
      const sp = Math.max(0, P.wander) * R, ang = Math.atan2(o.vy, o.vx) + (this.rng() - 0.5) * 0.6 * Math.sqrt(dt);
      o.vx = Math.cos(ang) * sp; o.vy = Math.sin(ang) * sp;
      s.x += o.vx * dt; s.y += o.vy * dt;
      if (s.x < m) { s.x = m; o.vx = Math.abs(o.vx); } else if (s.x > v.cssW - m) { s.x = v.cssW - m; o.vx = -Math.abs(o.vx); }
      if (s.y < m) { s.y = m; o.vy = Math.abs(o.vy); } else if (s.y > v.cssH - m) { s.y = v.cssH - m; o.vy = -Math.abs(o.vy); }
      const g = 1 + Math.max(0, P.gush - 1) * Math.exp(-Math.max(0, s.age) / Math.max(1, P.gushTime));   // (a new one gushes, then settles)
      s.rate = o.rate0 * g * Math.max(0, 1 + P.pulse * Math.sin(TAU * frame.time / o.period + o.phase));
      if (!(s.life < 1e8)) s.life = P.life * (0.5 + this.rng());   // (roaming switched on: it gets a life)
    }
    for (const o of this.list) if ((!P.roam || o.s.fixed) && o.s.life < 1e8) o.s.life = 1e9;
  }

  render() {}

  panelLine(compact = false) {
    const P = this.params, on = (x) => (x ? 'on' : 'off');
    const n = this.list.length, drip = this.list.reduce((a, o) => a + (o.s.rate ?? 0), 0);
    const T = this.matter.ledger ? this.matter.dish[this.matter.CH.trace] : 0;
    const E = this.matter.eat && this.matter.eat.ledger ? this.matter.eat.ledger.stock[this.matter.CH.trace] : 0;
    if (compact) return `OASES ${n} · trace ${P.scarce ? 'scarce' : 'everywhere'} · dish ${T.toFixed(1)} cells ${E.toFixed(2)}`;
    return `OASES  ${n} nutrient springs dripping ${drip.toFixed(1)} atoms/s (trace and l)${P.roam ? ', roaming' : ', fixed'}${this.pending.length ? ` · ${this.pending.length} rising soon` : ''}` +
      ` · trace ${P.scarce ? 'only from the oases' : 'from every spring'} · trace in the dish ${T.toFixed(2)}, in cells ${E.toFixed(3)} · rules: scarce ${on(P.scarce)}, roam ${on(P.roam)}`;
  }

  overlayLines() {
    const P = this.params;
    return [`oases (step N1): ${this.list.map((o) => `(${o.s.x.toFixed(0)}, ${o.s.y.toFixed(0)}) ${(o.s.rate ?? 0).toFixed(1)}/s, ${Math.max(0, (o.s.life ?? 0) - o.s.age).toFixed(0)} s left`).join(' · ') || 'none'}` +
      ` · count ${P.count}, rate ${P.rate}, wander ${P.wander} R/s, pulse ${P.pulse}, life ${P.life} s, gap ${P.gap} s`];
  }
}
