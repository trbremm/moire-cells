// Step SP1: SPEED. What the GPU spends its time on, pass by pass (moire.speed.passes()), and the switches that make the page faster.
//
// MEASURING (nothing it does changes the dish): for a few frames the frame's command encoder is INSTRUMENTED. Every compute pass the
// layers begin is handed out as a stand-in that opens one real pass per run of dispatches with the same pipeline (so the eat pass's
// dump, split, plan and eat, or the matter's spread, react and carbon, are timed apart), with GPU timestamps at its beginning and end
// ('timestamp-query', requested at start where the browser offers it: src/gpu.js). The same dispatches run in the same order with
// the same bindings; only the pass boundaries move (a dispatch in WebGPU is its own usage scope anyway). Render passes get a timestamp
// pair each. The table: one row per pass / pipeline, its GPU ms per frame and per tick, its share of the timed total; plus the span from
// the frame's first timestamp to its last (the gaps between passes: clears, copies, barriers, other programs' turns on a shared GPU).
//
// Without 'timestamp-query' (e.g. Firefox at the time of writing) the table says so and gives the frame's GPU time only (from the queue's
// onSubmittedWorkDone, rough); moire.speed.passes({ skip: true }) then times each pass by leaving it out for a few frames (that one
// DOES change the dish: use a throwaway dish).
//
// Chrome rounds timestamps to 0.1 ms unless its WebGPU developer features are on (chrome://flags, or the flag
// --enable-webgpu-developer-features); the rounding averages out over the hundreds of passes a measurement times (each pass's start falls
// anywhere within a 0.1 ms step), so the means are still right, single passes are not.

const SET_QUERIES = 4096;            // queries per query set (the WebGPU limit)
const MAX_SETS = 12;                 // at most 24 576 timed passes per frame (more go untimed and are counted)

export class Speed {
  constructor() {
    this.device = null;
    this.has = false;                // the device has 'timestamp-query'
    this.job = null;                 // the measurement running now
    this.last = null;                // the last measurement's result (rows, spans)
    this.lastText = '';              // its one-line summary (overlay, Developer panel)
    this.sets = [];                  // query sets, their resolve and read-back buffers
    this.frameQ = 0;                 // queries used in the frame being instrumented
    this.names = [];                 // the timed passes' names, in query order
    this.untimed = 0;                // passes that found no free query this frame
    this.skipName = null;            // fallback: the pass left out
    this.busy = false;               // a read-back is mapping
  }

  init(device) {
    this.device = device;
    this.has = !!(device && device.features && device.features.has('timestamp-query'));
  }

  /**
   * Measure for `frames` frames (default 30) and print a table (pass, GPU ms per tick, ms per frame, share). Resolves with the result.
   * { skip: true }: without timestamps, time each pass by leaving it out (changes the dish). { quiet: true }: no console table.
   */
  passes(opts = {}) {
    if (this.job) return this.job.promise;
    const frames = Math.max(4, Math.round(opts.frames || 30));
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    if (this.has && !opts.skip) {
      this.job = { kind: 'ts', frames, left: frames, rows: new Map(), ticks: 0, spanNs: 0, sumNs: 0, nFrames: 0, untimed: 0, resolve, promise, quiet: !!opts.quiet };
    } else {
      this.job = { kind: opts.skip ? 'skip' : 'frame', frames, resolve, promise, quiet: !!opts.quiet, names: new Set(), phase: 'names', base: null, idx: 0, acc: null, rows: [] };
    }
    return promise;
  }

  /** main.js, right after creating the frame's encoder: instrument it if a measurement runs. `f`: the frame (its ticks). */
  instrument(encoder, f) {
    const J = this.job;
    if (!J || this.busy) return;
    if (J.kind === 'ts') {
      if (!f.ticks) return;   // (a paused frame times only the drawing: skipped)
      this.frameQ = 0; this.names.length = 0; this.untimed = 0;
      this.wrap(encoder, true);
      J.cur = { ticks: f.ticks };
    } else {
      if (J.kind === 'skip') this.wrap(encoder, false);   // (the frame-time fallback leaves the passes as they are)
      J.cur = { ticks: f.ticks };
    }
  }

  /** main.js, before the frame's encoder is finished: resolve its timestamps. */
  resolve(encoder) {
    const J = this.job;
    if (!J || !J.cur || J.kind !== 'ts' || this.busy) return;
    const used = this.frameQ;
    for (let s = 0; s * SET_QUERIES < used; s++) {
      const n = Math.min(SET_QUERIES, used - s * SET_QUERIES), S = this.sets[s];
      encoder.resolveQuerySet(S.set, 0, n, S.res, 0);
      encoder.copyBufferToBuffer(S.res, 0, S.read, 0, n * 8);
    }
  }

  /** main.js, after the submit: read the timestamps back (or time the frame, without them). */
  afterSubmit() {
    const J = this.job;
    if (!J || !J.cur || this.busy) return;
    const cur = J.cur; J.cur = null;
    if (J.kind === 'ts') {
      const used = this.frameQ, names = this.names.slice(), untimed = this.untimed;
      this.busy = true;
      const sets = [];
      for (let s = 0; s * SET_QUERIES < used; s++) sets.push([this.sets[s], Math.min(SET_QUERIES, used - s * SET_QUERIES)]);
      Promise.all(sets.map(([S, n]) => S.read.mapAsync(GPUMapMode.READ, 0, n * 8).then(() => {
        const v = new BigUint64Array(S.read.getMappedRange(0, n * 8).slice(0)); S.read.unmap(); return v;
      }))).then((vals) => {
        this.busy = false;
        const ts = []; for (const v of vals) for (const x of v) ts.push(x);
        let first = null, lastT = null, sum = 0;
        for (let k = 0; k < names.length; k++) {
          const a = ts[2 * k], b = ts[2 * k + 1];
          if (!a || !b || b < a) continue;
          const ns = Number(b - a);
          if (ns > 5e8) continue;   // (a wrapped or bogus pair)
          sum += ns;
          if (first === null || a < first) first = a;
          if (lastT === null || b > lastT) lastT = b;
          const r = J.rows.get(names[k]) || { name: names[k], ns: 0, n: 0 };
          r.ns += ns; r.n++; J.rows.set(names[k], r);
        }
        J.ticks += cur.ticks; J.nFrames++; J.sumNs += sum; J.untimed += untimed;
        if (first !== null) J.spanNs += Number(lastT - first);
        if (--J.left <= 0) this.finishTs();
      }).catch((e) => { this.busy = false; console.warn('speed: timestamps', e); this.job = null; J.resolve(null); });
    } else {
      this.frameFallback(J, cur);
    }
  }

  // ---------- the instrumented encoder ----------
  alloc() {
    if (this.frameQ + 2 > MAX_SETS * SET_QUERIES) return null;
    const s = Math.floor(this.frameQ / SET_QUERIES);
    if (!this.sets[s]) {
      const d = this.device;
      this.sets[s] = {
        set: d.createQuerySet({ label: `speed queries ${s}`, type: 'timestamp', count: SET_QUERIES }),
        res: d.createBuffer({ label: `speed resolve ${s}`, size: SET_QUERIES * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: d.createBuffer({ label: `speed read ${s}`, size: SET_QUERIES * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
      };
    }
    const i = this.frameQ % SET_QUERIES;
    this.frameQ += 2;
    return { querySet: this.sets[s].set, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }

  wrap(encoder, timed) {
    const P = this, beginC = encoder.beginComputePass.bind(encoder), beginR = encoder.beginRenderPass.bind(encoder);
    encoder.beginComputePass = (desc = {}) => new PassProxy(P, beginC, desc, timed);
    encoder.beginRenderPass = (desc = {}) => {
      const name = `draw / ${desc.label || 'render pass'}`;
      if (timed) {
        const tw = P.alloc();
        if (tw) { P.names.push(name); return beginR({ ...desc, timestampWrites: tw }); }
        P.untimed++;
      } else if (P.job && P.job.names) P.job.names.add(name);
      return beginR(desc);
    };
  }

  // ---------- the results ----------
  finishTs() {
    const J = this.job; this.job = null;
    const total = [...J.rows.values()].reduce((s, r) => s + r.ns, 0) || 1;
    const rows = [...J.rows.values()].sort((a, b) => b.ns - a.ns).map((r) => ({
      pass: r.name,
      'ms/tick': +(r.ns / 1e6 / Math.max(1, J.ticks)).toFixed(4),
      'ms/frame': +(r.ns / 1e6 / J.nFrames).toFixed(3),
      'runs/frame': +(r.n / J.nFrames).toFixed(1),
      share: `${(100 * r.ns / total).toFixed(1)} %`,
    }));
    const res = {
      timestamps: true, frames: J.nFrames, ticksPerFrame: +(J.ticks / J.nFrames).toFixed(1),
      timedMsPerFrame: +(J.sumNs / 1e6 / J.nFrames).toFixed(3), spanMsPerFrame: +(J.spanNs / 1e6 / J.nFrames).toFixed(3),
      timedMsPerTick: +(J.sumNs / 1e6 / Math.max(1, J.ticks)).toFixed(4), untimedPasses: J.untimed, rows,
      groups: groupRows(J.rows, J.ticks, J.nFrames, total),
    };
    this.publish(res, J);
  }

  publish(res, J) {
    this.last = res;
    const top = (res.groups || []).slice(0, 4).map((g) => `${g.group} ${g.share}`).join(' · ');
    this.lastText = res.timestamps
      ? `speed (gpu timestamps, ${res.frames} frames, ${res.ticksPerFrame} ticks each): ${res.timedMsPerTick.toFixed(3)} ms per tick timed · ${top}`
      : `speed (${res.kind}): ${res.msPerTick != null ? `${res.msPerTick.toFixed(3)} ms per tick (frame time / ticks)` : ''}`;
    if (!J.quiet) {
      console.log(this.lastText);
      if (res.groups) console.table(res.groups);
      if (res.rows) console.table(res.rows);
    }
    J.resolve(res);
  }

  /** The fallback without timestamps: the frame's time (and, with skip, each pass left out in turn). Rough: the submit-to-done time
   * of a frame (at MAX the queue is kept full, so close to the frame's GPU time). */
  frameFallback(J, cur) {
    const t0 = performance.now();
    this.busy = true;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.busy = false;
      const ms = performance.now() - t0;
      if (J.phase === 'names') { J.phase = 'base'; J.left = J.frames; J.acc = { ms: 0, ticks: 0 }; return; }
      if (cur.ticks) { J.acc.ms += ms; J.acc.ticks += cur.ticks; }
      if (--J.left > 0) return;
      const perTick = J.acc.ms / Math.max(1, J.acc.ticks);
      if (J.phase === 'base') {
        J.base = perTick;
        if (J.kind === 'frame') { this.job = null; return this.publish({ timestamps: false, kind: 'frame time', msPerTick: perTick, rows: null }, J); }
        J.list = [...J.names].filter((n) => !n.startsWith('draw')); J.idx = 0;
      } else J.rows.push({ pass: J.list[J.idx++], 'ms/tick saved when left out': +(J.base - perTick).toFixed(4) });
      if (J.idx >= J.list.length) {
        this.skipName = null; this.job = null;
        J.rows.sort((x, y) => y['ms/tick saved when left out'] - x['ms/tick saved when left out']);
        return this.publish({ timestamps: false, kind: 'each pass left out in turn (the dish was changed)', msPerTick: J.base, rows: J.rows }, J);
      }
      J.phase = 'skip'; this.skipName = J.list[J.idx]; J.left = J.frames; J.acc = { ms: 0, ticks: 0 };
    });
  }

  overlayLine() { return this.lastText || `speed: ${this.has ? 'moire.speed.passes() times every pass (gpu timestamps)' : 'no gpu timestamps here; moire.speed.passes() gives the frame time'}`; }
}

/** The passes in a few groups (what a reader wants first: the cells' step, eating, the grids, the drawing). */
function groupRows(rows, ticks, frames, total) {
  const G = new Map();
  for (const r of rows.values()) {
    const g = groupOf(r.name);
    const x = G.get(g) || { group: g, ns: 0 };
    x.ns += r.ns; G.set(g, x);
  }
  return [...G.values()].sort((a, b) => b.ns - a.ns).map((x) => ({
    group: x.group, 'ms/tick': +(x.ns / 1e6 / Math.max(1, ticks)).toFixed(4), 'ms/frame': +(x.ns / 1e6 / frames).toFixed(3), share: `${(100 * x.ns / total).toFixed(1)} %`,
  }));
}

function groupOf(name) {
  const p = name.split(' / ')[0];
  if (name.startsWith('draw')) return 'drawing';
  if (/^cell grid/.test(p)) return 'cell grid';
  if (/^cell step/.test(p)) return 'cell step';
  if (/^cell eat/.test(p)) return 'cell eat';
  if (/^cell grn/.test(p)) return 'gene network + signal hearing';
  if (/^heat spread/.test(p)) return name.includes('matter') || name.includes('carbon') || name.includes('oil') || name.includes('tar') ? 'matter (spread, react, carbon)' : 'heat spread';
  if (/^signal/.test(p)) return 'signal grid';
  if (/^stir/.test(p)) return 'stirred water';
  return p;
}

/** A compute pass as the layers see it: real passes opened per run of one pipeline, timed. */
class PassProxy {
  constructor(P, begin, desc, timed) {
    this.P = P; this.begin = begin; this.desc = desc; this.timed = timed;
    this.label = desc.label || 'compute pass';
    this.real = null; this.realPipe = null; this.pipe = null;
    this.bgs = [];
  }
  open() {
    const P = this.P, name = `${this.label} / ${(this.pipe && this.pipe.label) || '?'}`;
    const d = { ...this.desc };
    if (this.timed) {
      const tw = P.alloc();
      if (tw) { d.timestampWrites = tw; P.names.push(name); } else P.untimed++;
    } else if (P.job && P.job.names) P.job.names.add(name);
    this.real = this.begin(d);
    this.real.setPipeline(this.pipe); this.realPipe = this.pipe;
    for (let i = 0; i < this.bgs.length; i++) if (this.bgs[i]) this.real.setBindGroup(i, this.bgs[i][0], this.bgs[i][1]);
    this.skipping = !this.timed && P.skipName === name;
  }
  close() { if (this.real) { this.real.end(); this.real = null; this.realPipe = null; } }
  setPipeline(p) {
    if (this.real && p !== this.realPipe) this.close();
    this.pipe = p;
  }
  setBindGroup(i, bg, offsets) {
    const o = offsets ? Array.from(offsets) : [];
    this.bgs[i] = [bg, o];
    if (this.real) this.real.setBindGroup(i, bg, o);
  }
  dispatchWorkgroups(x, y = 1, z = 1) {
    if (!this.real) this.open();
    if (!this.skipping) this.real.dispatchWorkgroups(x, y, z);
  }
  dispatchWorkgroupsIndirect(buf, off) {
    if (!this.real) this.open();
    if (!this.skipping) this.real.dispatchWorkgroupsIndirect(buf, off);
  }
  pushDebugGroup(s) { if (this.real) this.real.pushDebugGroup(s); }
  popDebugGroup() { if (this.real) this.real.popDebugGroup(); }
  insertDebugMarker(s) { if (this.real) this.real.insertDebugMarker(s); }
  end() { this.close(); }
}

export const speed = new Speed();
