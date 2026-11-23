// Experiments: the lab bench. Console helpers for tools/experiment.py and for trying things by hand, installed on window.moire
// by main.js (setupLab). Nothing here changes how the simulation runs; it reads the numbers, saves and loads the state, and
// edits genomes on request.
//
//   moire.sample(opts)          every number the entropy panel shows (and the ledgers, censuses and motion behind it) as ONE
//                               flat object of numbers, plus the simulation time `t`. Async. While paused it first settles
//                               (see src/snapshot.js), so the numbers belong to that exact moment. opts.tissue: add
//                               moire.tissue.stats() as tissue.*
//   moire.snapshot(opts)        the whole state as JSON (src/snapshot.js); opts.grid = false: cells and settings only
//   moire.loadSnapshot(obj)     back to it; resolves to { exact, notes, rounding, ... }
//   moire.snapshotDownload()    save it as a file; moire.snapshotUpload() asks for a file and loads it (the rules panel's
//                               "save state" and "load state" buttons do the same)
//   moire.tissue.stats(opts)    clusters of touching cells, contacts, contact persistence and age, shape and motion
//                               stability, compactness (remembers the previous call); moire.tissue.stir(x, y, dx, dy, frames)
//   moire.genome.cloneAll(i)    copy cell i's genes (default: the first live cell's) to every live cell; moire.genome.setAll(
//                               field, value) or setAll({ field: value, ... }) one gene for all; moire.genome.get(i); the gene
//                               names: moire.genome.GENES; engineCode(name, band), pumpCode(substance, 'in' | 'out')
//   moire.lab.view(name)        for screenshots: 'clean' | 'job' | 'lineage' | 'strategy' | 'charge' | 'walls' | 'machinery'; returns the
//                               previous view for moire.lab.restoreView(prev)
// URL options handled here, once the page runs: ?snap=<file> (load a snapshot; its settings replace the page's), then
// ?clone=1 (cloneAll of the first live cell; ?clone=@N: of slot N) and ?genes=adhesion:0.8,motility:0.5 (setAll each).
// When they are done, <body data-lab="ready"> (or "failed", with the reason in data-lab-error).

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { SUBSTANCES, engineIndex } from './matter.js';
import { PUMP_OUT } from './genome.js';
import { readBuffer, frames, settle, snapshot, loadSnapshot, downloadJSON } from './snapshot.js';
import { VIEWS } from './actions.js';

// ---------- the genome's fields (struct Bio, src/genome.js) ----------
export const GENES = {
  keyAngle: 0, keyScale: 1, recAngle: 2, recScale: 3, recWidth: 4, founder: 7,   // (step F0: threshold 5, output 6, resp 8..11, relay
                                                                                     //  12..15 were the fates' genes; 8, 9, 20..23 are job state now)
  adhesion: 16, size: 17, motility: 18,
  eng0: 32, eng1: 33, eng2: 34, tolerance: 35, rate0: 36, rate1: 37, rate2: 38, permeability: 39,
  mix: 40, thickness: 41, stiffness: 42, selectivity: 43, pump0: 44, pump1: 45, pumpRate0: 46, pumpRate1: 47,
  // step C10, the patterned walls: a0 is the adhesion gene itself; a1 the polar part, a2 the two-fold part, w how much the front
  // follows the dipole
  a0: 16, a1: 48, a2: 49, w: 50, wallFront: 50, divAxis: 51,   // (step C11: divAxis, 0 along the front .. 1 across)
  // step C12b, the lipid membrane: oilShare is the C6c mix gene (oil per soap); wall (a share of a full wall), head (-1 tlL .. 1 glL),
  // wallRow (the wall's heavy share)
  oilShare: 40, wall: 52, head: 53, wallRow: 54,
  // step C13, fields as genes: per field lever (x), emission (x), sensing gain and sign (x), tuning width (x, A) or pickiness (B), lattice
  // angle offset (rad); the partner's share and sensing; the gates (-1..1) and the push gene (0..2)
  leverA: 56, emitA: 57, senseA: 58, tuneA: 59, leverB: 60, emitB: 61, senseB: 62, pickB: 63, angleA: 64, angleB: 65, shareP: 66, senseP: 67,
  gateGlue: 68, gatePump: 69, gateEngine: 70, gateDiv: 71, gateTurn: 72, push: 73,
  // (step C12e, C12g: the stretch channels on the lipid word 55, the stretch tolerance 74, the ion channels' level 75)
  stretchChan: 55, stretchTol: 74, ionChan: 75,
  // step T1a: the self marker (angle rad, period ln R, phase rad), its display; the kin channels and the tolerance
  markAngle: 76, markPeriod: 77, markPhase: 78, display: 79, kinChan: 80, kinTol: 81,
  // step P1: the ENGULF gene and the KIN SPARING gene (src/predators.js); the gene network's ENGULF output's gain and regulator
  engulf: 82, spare: 83, grnEngulfGain: 154, grnEngulfReg: 155,
  // step T1b: the gene network (src/grn.js): the broadcast regulator and the signal's kinship weighting (the weights, codes and gains are
  // arrays: moire.grn's read-back, or setAll by word number 92..151)
  grnBroadcast: 152, grnKinWeight: 153,
  // step G1: the FIDELITY gene (proofreading, src/fidelity.js): a log factor, copying errors x e^-fidelity (founders 0)
  fidelity: 31,
  // step S1: the ELONGATION gene (ln of the aspect asked: 0 round .. ln 4 = 1.386 a 4:1 spindle) and the gene network's SHAPE output's gain
  // and regulator (src/spindle.js)
  elongation: 13, grnShapeGain: 14, grnShapeReg: 15,
  // step G2: the two duplicate engine slots (codes, rates; rate 0 = silent), the families (id x 8 + bits) of engine slots 0..4 and pump
  // slots 0, 1, the line's duplications so far (src/dup.js)
  eng3: 156, eng4: 157, rate3: 158, rate4: 159, fam0: 160, fam1: 161, fam2: 162, fam3: 163, fam4: 164, famPump0: 165, famPump1: 166, dups: 167,
  // step S2: the FLAGELLUM (thrust 0..1, sign: + pusher / - puller, placement round the pole -1..1), the CILIA (beat 0..1, coupling -1..1,
  // stroke tilt -1..1), the beat's phase (state), the gene network's FLAGELLUM and CILIA outputs' gains and regulators (src/motors.js)
  flagellum: 168, flagSign: 169, flagPlace: 170, cilia: 171, ciliaCouple: 172, ciliaTilt: 173, ciliaPhase: 174,
  grnFlagGain: 176, grnFlagReg: 177, grnCiliaGain: 178, grnCiliaReg: 179,
};
// words 19..30 are the cell's state, not genes (heading, accumulators, felt fields, conversion)
// (step T1b: and 84..91, the regulators' expression)
// (step G1: word 31, Bio.conv.w, is the FIDELITY gene, not state)
const STATE = new Set([19, ...Array.from({ length: 11 }, (_, k) => 20 + k), ...Array.from({ length: 8 }, (_, k) => 84 + k)]);

// ---------- flattening for sample() ----------
const SKIP = new Set(['time', 'top', 'series', 'hist', 'sizes', 'aHist', 'sHist', 'lHist', 'near', 'centre']);
function flatten(x, prefix, out, depth = 0) {
  if (x == null) return;
  if (typeof x === 'number') { if (Number.isFinite(x)) out[prefix] = x; return; }
  if (typeof x === 'boolean') { out[prefix] = x ? 1 : 0; return; }
  if (depth > 4 || typeof x !== 'object') return;
  if (Array.isArray(x) || ArrayBuffer.isView(x)) {
    if (x.length > 64) return;
    for (let k = 0; k < x.length; k++) flatten(x[k], `${prefix}.${k}`, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(x)) if (!SKIP.has(k)) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
}

/** Every number behind the panel (and more), flat: { t, alive, heat.out, heat.rate.out, matter.order, ... }. */
function gather(M, ctl) {
  const out = { t: ctl.time() };
  const C = M.cells, E = M.eat, Mt = M.matter;
  Object.assign(out, { alive: C.alive, capacity: C.count, start: C.start, R: C.R, paused: ctl.paused() ? 1 : 0, reached: ctl.reached() });
  flatten(M.heat.ledger, 'heat', out);           // ENTROPY = heat.out, its rate heat.rate.out; moving, heat, stored (chem), in, rounding
  if (Mt.ledger) {
    flatten(Mt.ledger, 'matter', out);   // ORDER = matter.order; atoms: add, dish, cells, lost, gone, rounding; chem.*
    SUBSTANCES.forEach((s, c) => { out[`dish.${s.name}`] = Mt.dish[c]; });
  }
  if (E.ledger) {
    const L = E.ledger;
    flatten({ ...L, stock: undefined, held: undefined }, 'cells', out);  // batteries, atoms inside, fuel inside, burner, crawl, ...
    SUBSTANCES.forEach((s, c) => { out[`inside.${s.name}`] = L.stock[c]; });
  }
  flatten(E.census, 'engines', out);              // the strategies: engines.all.0.n (harvest), .1 burn, .2 both, .3 other; free g t
  flatten(E.pig, 'pigments', out);
  flatten(M.charge.ledger, 'charge', out);
  flatten(M.membrane.census, 'membrane', out);
  flatten(M.dipole.census, 'dipole', out);
  flatten(M.pumps.census, 'pumps', out);
  flatten(M.catalysts.census, 'catalysts', out);
  flatten(M.hardlight.census, 'hardlight', out);
  flatten(M.division.census, 'division', out);
  flatten(M.walls.census, 'walls', out);         // step C10: the patterned walls' census
  if (M.guides && M.guides.census) flatten(M.guides.census, 'guides', out);   // step C13: the field genes and the gates
  if (M.oil) { flatten(M.oil.census, 'oil', out); if (M.oil.last) flatten({ ...M.oil.last, sizes: undefined }, 'oilstats', out); }   // step C12
  if (M.walls.near) flatten(M.walls.near, 'wallstats', out);
  if (M.lipids) { flatten({ ...(M.lipids.census || {}), tot: undefined }, 'lipids', out); if (M.lipids.last) flatten(M.lipids.last, 'lipstats', out); }   // step C12b
  if (M.excited && M.excited.census) flatten({ ...M.excited.census, tot: undefined }, 'excited', out);   // step C12c
  if (M.electrons && M.electrons.census) flatten({ ...M.electrons.census, tot: undefined }, 'electrons', out);   // step C12d
  if (M.waste && M.waste.census) flatten(M.waste.census, 'waste', out);   // step C12e
  if (M.vents && M.vents.census) flatten(M.vents.census, 'vents', out);   // step C12f
  if (M.carbon && M.carbon.census) flatten(M.carbon.census, 'carbon', out);   // step C15a: carbon in the open dish
  if (M.carbonCells && M.carbonCells.sample) flatten(M.carbonCells.sample, 'cbcells', out);   // step C15b: cells eat carbon
  if (M.ions && M.ions.census) flatten(M.ions.census, 'ions', out);   // step C12g
  if (M.whole && M.whole.census) flatten(M.whole.census, 'whole', out);   // step M1
  if (M.kin && M.kin.census) flatten(M.kin.census, 'kin', out);         // step T1a
  if (M.grn && M.grn.census) flatten(M.grn.census, 'grn', out);         // step T1b: the gene network's census (cell types)
  if (M.predators && M.predators.census) flatten(M.predators.census, 'pred', out);   // step P1: predation, the genes, the clusters
  if (M.fidelity) flatten(M.fidelity.census || (M.fidelity.copy ? { copy: M.fidelity.copy } : null), 'fid', out);   // step G1: error correction
  if (M.dup) flatten(M.dup.census ? { ...M.dup.census, families: { ...M.dup.census.families, top: undefined }, pumpFamilies: { ...M.dup.census.pumpFamilies, top: undefined } }
    : (M.dup.rates ? { rates: M.dup.rates } : null), 'dup', out);   // step G2: gene duplication (the families' top lists left out)
  if (M.pigments && M.pigments.census) flatten(M.pigments.census, 'lightmatter', out);   // step N1: light needs matter
  if (M.glue && M.glue.census) flatten(M.glue.census, 'glue', out);       // step G0: the glue gene, junctions, tears
  if (M.stir && M.stir.census) flatten(M.stir.census, 'stir', out);       // step G0: the stirred water
  if (M.spindle && M.spindle.census) flatten(M.spindle.census, 'shape', out);   // step S1: cell shape
  if (M.motors && M.motors.census) flatten(M.motors.census, 'motors', out);     // step S2: flagella and cilia
  if (M.obstacles && M.obstacles.census) flatten(M.obstacles.census, 'obs', out);   // step G0b: the obstacles' last measure (moire.obstacles.measure())
  out['division.costRate'] = M.division.costRate || 0;
  out['division.costTot'] = M.division.costTot || 0;
  if (C.stats) flatten({ job: C.stats.job, births: C.stats.births, deaths: C.stats.deaths, heatDeaths: C.stats.heatDeaths,
    clusters: C.stats.clusters, founders: C.stats.founders, birthRate: C.stats.birthRate, deathRate: C.stats.deathRate,
    step6: { leak: C.stats.step6.leak, conv: C.stats.step6.conv }, step7: C.stats.step7, step8: C.stats.step8 }, 'census', out);
  flatten(C.motion, 'motion', out);
  return out;
}

// ---------- tissue measures ----------
function makeTissue(M, ctl) {
  let prev = null;
  const T = {
    reset() { prev = null; },
    /**
     * Clusters (connected groups of touching cells: closer than reach x the sum of their radii, reach = the genome's contact
     * reach, 1.15), their sizes, contacts per cell, and against the previous call: contact persistence (share of the touching
     * pairs then still touching now), pairs gained and lost per s, the touching pairs' age (s, since first seen touching,
     * counted from the first call), motion (R per s; inside the largest cluster, without its drift), shape change (corner
     * radii, share of the radius per s) and turning (degrees per s); compactness (cell area over the area a round blob of
     * the same spread would cover: about 0.9 for a packed disc, ~1.5 / n for a chain of n).
     */
    async stats(opts = {}) {
      const C = M.cells, n = C.count, F = CELL_FLOATS, R = C.R;
      const ab = await readBuffer(M.gpu.device, C.cellBuf, 0, n * F * 4);
      const f = new Float32Array(ab), u = new Uint32Array(ab);
      const time = M.time(), reach = opts.reach ?? M.genome.params.reach ?? 1.15;
      const live = [];
      let rmax = 0;
      for (let i = 0; i < n; i++) if (u[i * F + 9] & 1) { live.push(i); rmax = Math.max(rmax, f[i * F + 4]); }
      const cs = Math.max(1, 2 * reach * rmax), grid = new Map();
      const key = (gx, gy) => gx * 100003 + gy;
      for (const i of live) {
        const k = key(Math.floor(f[i * F] / cs), Math.floor(f[i * F + 1] / cs));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
      const par = new Map(live.map((i) => [i, i]));
      const find = (i) => { while (par.get(i) !== i) { par.set(i, par.get(par.get(i))); i = par.get(i); } return i; };
      const deg = new Map(live.map((i) => [i, 0]));
      const pairs = new Map();
      for (const i of live) {
        const x = f[i * F], y = f[i * F + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          for (const j of grid.get(key(gx + a, gy + b)) || []) {
            if (j <= i) continue;
            if (Math.hypot(f[j * F] - x, f[j * F + 1] - y) >= reach * (f[i * F + 4] + f[j * F + 4])) continue;
            const pk = i * n + j;
            pairs.set(pk, prev && prev.pairs.has(pk) ? prev.pairs.get(pk) : time);
            deg.set(i, deg.get(i) + 1); deg.set(j, deg.get(j) + 1);
            const ra = find(i), rb = find(j);
            if (ra !== rb) par.set(ra, rb);
          }
        }
      }
      // clusters
      const groups = new Map();
      for (const i of live) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
      const list = [...groups.values()].sort((a, b) => b.length - a.length);
      const compact = (g) => {
        let cx = 0, cy = 0, r2 = 0, a = 0;
        for (const i of g) { cx += f[i * F]; cy += f[i * F + 1]; }
        cx /= g.length; cy /= g.length;
        for (const i of g) { const r = f[i * F + 4]; r2 += (f[i * F] - cx) ** 2 + (f[i * F + 1] - cy) ** 2 + r * r / 2; a += r * r; }
        const rg2 = r2 / g.length;
        // a: the sum of r^2; rg2: the group's second moment per cell (a disc of radius Rb has Rb^2 / 2), so a packed round
        // blob of N cells (N r^2 = phi Rb^2) gives phi, about 0.9; overlapping cells give more, a chain of n about 1.5 / n
        return { c: a / (2 * rg2), rg: Math.sqrt(rg2) / R, cx, cy };
      };
      const big = list.filter((g) => g.length >= 3);
      const cm = big.map((g) => [g.length, compact(g).c]);
      const wsum = cm.reduce((s, [k]) => s + k, 0);
      const largest = list[0] || [];
      const L = largest.length ? compact(largest) : { c: 0, rg: 0 };
      const m = Math.max(1, live.length);
      const sizes = list.slice(0, 10).map((g) => g.length);
      while (sizes.length < 10) sizes.push(0);
      const out = {
        time, n: live.length, pairs: pairs.size, contacts: 2 * pairs.size / m,
        isolated: list.filter((g) => g.length === 1).length, clusters: list.filter((g) => g.length >= 2).length, clusters3: big.length,
        largest: largest.length, inLargest: largest.length / m, sizes,
        meanCluster: list.length ? live.length / list.length : 0,
        compactLargest: L.c, rgLargest: L.rg, compactMean: wsum ? cm.reduce((s, [k, c]) => s + k * c, 0) / wsum : 0,
        persistence: null, gained: null, lost: null, ageMean: 0, ageMedian: 0,
        move: null, internal: null, shape: null, turn: null, dt: prev ? time - prev.time : 0,
      };
      const ages = [...pairs.values()].map((s) => time - s).sort((a, b) => a - b);
      if (ages.length) { out.ageMean = ages.reduce((a, b) => a + b, 0) / ages.length; out.ageMedian = ages[Math.floor(ages.length / 2)]; }
      const dt = out.dt;
      if (prev && dt > 0) {
        let kept = 0;
        for (const k of prev.pairs.keys()) if (pairs.has(k)) kept++;
        out.persistence = prev.pairs.size ? kept / prev.pairs.size : 1;
        out.lost = (prev.pairs.size - kept) / dt;
        out.gained = (pairs.size - kept) / dt;
        let mv = 0, sh = 0, tn = 0, k = 0;
        const disp = new Map();
        for (const i of live) {
          const p = prev.cells.get(i);
          if (!p) continue;
          const o = i * F, ddx = f[o] - p[0], ddy = f[o + 1] - p[1];
          disp.set(i, [ddx, ddy]);
          mv += Math.hypot(ddx, ddy);
          let s = 0;
          for (let c = 0; c < 6; c++) s += Math.abs(f[o + 26 + c] - p[4 + c]);
          sh += s / 6 / Math.max(1e-3, f[o + 4]);
          let dth = (f[o + 38] - p[3]) % (Math.PI / 3);
          if (dth > Math.PI / 6) dth -= Math.PI / 3; else if (dth < -Math.PI / 6) dth += Math.PI / 3;
          tn += Math.abs(dth);
          k++;
        }
        if (k) { out.move = mv / k / R / dt; out.shape = sh / k / dt; out.turn = tn / k / dt * 180 / Math.PI; }
        const inL = largest.filter((i) => disp.has(i));
        if (inL.length >= 2) {
          let mx = 0, my = 0;
          for (const i of inL) { mx += disp.get(i)[0]; my += disp.get(i)[1]; }
          mx /= inL.length; my /= inL.length;
          let s = 0;
          for (const i of inL) s += Math.hypot(disp.get(i)[0] - mx, disp.get(i)[1] - my);
          out.internal = s / inL.length / R / dt;
        }
      }
      const cells = new Map();
      for (const i of live) {
        const o = i * F;
        cells.set(i, [f[o], f[o + 1], f[o + 4], f[o + 38], f[o + 26], f[o + 27], f[o + 28], f[o + 29], f[o + 30], f[o + 31]]);
      }
      prev = { time, pairs, cells };
      T.last = out;
      return out;
    },
    /**
     * A stir, as a mouse drag: the pointer moved by (dx, dy) CSS px per frame from (x, y), for `n` frames, then let go. It
     * runs at 1x whatever the speed (a drag's push fades per tick), so the simulation moves on by about n / 60 s; the
     * speed and the pause are put back afterwards.
     */
    async stir(x, y, dx, dy, n = 10) {
      const wasPaused = ctl.paused(), sp = ctl.speed();
      ctl.setSpeed(1);
      ctl.runUntil(null);
      try {
        for (let k = 0; k < n; k++) {
          M.cells.stir(x + dx * k, y + dy * k, dx, dy);
          M.background.impulse(x + dx * k, y + dy * k, 1.2);
          await frames(1);
        }
      } finally {
        M.cells.release();
        ctl.setSpeed(sp === 'MAX' ? 'max' : parseInt(sp, 10));
        if (wasPaused) ctl.setPaused(true);
      }
    },
  };
  return T;
}

// ---------- genome edits ----------
function makeGenomeTools(M, ctl) {
  let lock = Promise.resolve();
  /** Run fn(bio floats, cell floats, cell words, live slots) on the genomes read back while paused; it returns which to write. */
  const edit = (fn) => {
    const job = lock.then(async () => {
      const wasPaused = ctl.paused();
      try {
        await settle(M, ctl, false);
        const C = M.cells, d = M.gpu.device, n = C.count;
        const [bioAB, cellAB] = await Promise.all([
          readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
          readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
        ]);
        const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB);
        const live = [];
        for (let i = 0; i < n; i++) if (u[i * CELL_FLOATS + 9] & 1) live.push(i);
        const res = fn(g, f, u, live);
        if (res && res.bio) for (const b of C.bioBuf) d.queue.writeBuffer(b, 0, g);
        if (res && res.cells) d.queue.writeBuffer(C.cellBuf, 0, f);
        await d.queue.onSubmittedWorkDone();
        return res ? res.value : undefined;
      } finally {
        ctl.setPaused(wasPaused);
      }
    });
    lock = job.catch(() => {});
    return job;
  };
  const gene = (name) => {
    if (typeof name === 'number') return name;
    if (/^\d+$/.test(String(name))) return Number(name);   // (step T1b: a word number as a key, e.g. setAll({ 132: -8 }) for the network's words)
    if (!(name in GENES)) throw new Error(`unknown gene ${name}; genes: ${Object.keys(GENES).join(' ')}`);
    return GENES[name];
  };
  return {
    GENES,
    /** Cell i's genes by name (default: the first live cell). */
    get(i = null) {
      return edit((g, f, u, live) => {
        const s = i == null ? live[0] : i;
        if (s == null || !live.includes(s)) throw new Error(`cell ${i} is not alive`);
        const o = s * BIO_FLOATS;
        return { value: { slot: s, ...Object.fromEntries(Object.entries(GENES).map(([k, w]) => [k, g[o + w]])) } };
      });
    },
    /** Copy cell i's genes (all but the state words) to every live cell; i = null / 'first' / 1: the first live cell. */
    cloneAll(i = null) {
      return edit((g, f, u, live) => {
        const s = i == null || i === 'first' || i === true ? live[0] : Number(i);
        if (s == null || !live.includes(s)) throw new Error(`cloneAll: cell ${i} is not alive`);
        const src = g.slice(s * BIO_FLOATS, (s + 1) * BIO_FLOATS);
        for (const c of live) {
          const o = c * BIO_FLOATS;
          for (let w = 0; w < BIO_FLOATS; w++) if (!STATE.has(w)) g[o + w] = src[w];
          f[c * CELL_FLOATS + 5] = src[0];    // the lattice angle and the key's scale (the Cell's copies)
          f[c * CELL_FLOATS + 11] = src[1];
        }
        return { bio: true, cells: true, value: { from: s, cells: live.length } };
      });
    },
    /** One gene (or { gene: value, ... }) set for every live cell (or the slots in opts.cells). */
    setAll(field, value, opts = {}) {
      const pairs = typeof field === 'object' && field !== null ? Object.entries(field) : [[field, value]];
      if (typeof field === 'object' && field !== null) opts = value || {};
      const words = pairs.map(([k, v]) => [gene(k), Number(v)]);
      return edit((g, f, u, live) => {
        const which = opts.cells ? live.filter((c) => opts.cells.includes(c)) : live;
        for (const c of which) {
          for (const [w, v] of words) {
            g[c * BIO_FLOATS + w] = v;
            if (w === 0) f[c * CELL_FLOATS + 5] = v;
            if (w === 1) f[c * CELL_FLOATS + 11] = v;
          }
        }
        return { bio: true, cells: words.some(([w]) => w <= 1), value: { cells: which.length, set: Object.fromEntries(pairs) } };
      });
    },
    /** An engine slot's gene: the reaction's name (as in ENGINES) and the pigment band (0 none, 1 visible 1, 2 visible 2, 3 hard). */
    engineCode(name, band = 0) {
      const k = engineIndex(name);
      if (k < 0) throw new Error(`unknown engine ${name}`);
      return k + 32 * band;
    },
    /** A pump slot's gene: a substance's name and 'in' or 'out'. */
    pumpCode(substance, dir = 'in') {
      const c = SUBSTANCES.findIndex((s) => s.name === substance);
      if (c < 0) throw new Error(`unknown substance ${substance}`);
      return c + (dir === 'out' ? PUMP_OUT : 0);
    },
  };
}

// ---------- views for screenshots ----------
function makeViews(M, ctl) {
  const machineryOn = () => !!ctl.actionState('machinery');
  return {
    view(name = 'clean') {
      const prev = { view: M.cells.look.view, machinery: machineryOn() };
      if (name === 'machinery') { if (!prev.machinery) ctl.action('machinery'); }
      else {
        if (prev.machinery) ctl.action('machinery');
        const k = VIEWS.indexOf(name);
        M.cells.look.view = k >= 0 ? k : 0;   // 'clean': colour by job, no machinery
      }
      return prev;
    },
    restoreView(prev) {
      if (!prev) return;
      M.cells.look.view = prev.view;
      if (machineryOn() !== prev.machinery) ctl.action('machinery');
    },
  };
}

/** Install everything on window.moire; ctl is main.js's control of the frame loop. Returns a promise for the URL options. */
export function setupLab(M, ctl, { params, snap = null, snapError = null } = {}) {
  M.tissue = makeTissue(M, ctl);
  Object.assign(M.genome, makeGenomeTools(M, ctl));
  M.lab = { ...makeViews(M, ctl), settle: (flush = true) => settle(M, ctl, flush) };
  M.sample = async (opts = {}) => {
    if (opts.settle ?? ctl.paused()) await settle(M, ctl, true);
    const out = gather(M, ctl);
    if (opts.tissue) flatten(await M.tissue.stats(opts.tissue === true ? {} : opts.tissue), 'tissue', out);
    return out;
  };
  M.snapshot = async (opts = {}) => {
    const measures = opts.measures === false ? null : await M.sample({ settle: true, tissue: !!opts.tissue });
    return snapshot(M, ctl, { ...opts, measures });
  };
  M.loadSnapshot = (obj, opts) => loadSnapshot(M, ctl, obj, opts);
  M.snapshotDownload = async (opts = {}) => {
    const S = await M.snapshot(opts);
    const d = new Date(), p = (x) => String(x).padStart(2, '0');
    const name = `moire-state-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}-t${Math.round(S.time)}.json`;
    const size = downloadJSON(S, name);
    return { name, size };
  };
  M.snapshotUpload = () => new Promise((resolve, reject) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const file = inp.files && inp.files[0];
        if (!file) { resolve(null); return; }
        resolve(await M.loadSnapshot(JSON.parse(await file.text())));
      } catch (e) { reject(e); }
    };
    inp.click();
  });

  // the URL options, once the page has run its first frames (the cells' eating needs one frame to set up)
  const done = (async () => {
    const want = snap || snapError || params.has('clone') || params.has('genes');
    if (!want) return;
    document.body.dataset.lab = 'starting';
    try {
      for (let k = 0; k < 600 && !(M.eat.ready && M.heat.ledger && M.matter.bg); k++) await frames(1);
      if (snapError) throw snapError;
      if (snap) {
        const r = await M.loadSnapshot(snap);
        M.lab.loaded = r;
        console.log(`snapshot loaded: ${r.cells} cells at t ${r.time.toFixed(1)} s, ${r.exact ? 'exact' : 'best effort: ' + r.notes.join('; ')}`);
      }
      if (params.has('clone')) {
        const v = params.get('clone');   // ?clone=1 (or first): the first live cell; ?clone=@N: slot N
        await M.genome.cloneAll(v.startsWith('@') ? Number(v.slice(1)) : null);
      }
      if (params.has('genes')) {
        const obj = {};
        for (const part of params.get('genes').split(',')) {
          const [k, v] = part.split(':');
          if (k && v != null && Number.isFinite(Number(v))) obj[k.trim()] = Number(v);
        }
        await M.genome.setAll(obj);
      }
      document.body.dataset.lab = 'ready';
    } catch (e) {
      console.error('lab:', e);
      document.body.dataset.lab = 'failed';
      document.body.dataset.labError = String(e && e.message ? e.message : e);
    }
  })();
  return done;
}
