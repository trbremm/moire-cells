// Experiments: SNAPSHOTS. moire.snapshot() turns the whole state into one JSON-serialisable object; moire.loadSnapshot(obj)
// puts it back; ?snap=<path> (a JSON file under the site) loads one at the start (src/lab.js).
//
// What a snapshot holds:
//   settings   every switch and knob (the params objects of all layers, the genome's rules, the look), as plain JSON
//   cells      the raw words of the live slots only: their slot numbers, the Cell records (64 words: position, velocity, radius,
//              lattice angle, shape, outline corners, orientation, integrity, side charges, neighbours, voltage, ...), the Bio
//              records (48 floats: genome and its state) and the stock records (32 words: substances, battery, membrane, ...)
//   stats      the cells' Stats buffer (the cumulative division counters and the like)
//   grid       optional (opts.grid, default true): the substrate grid, as whole counts: the heat's delta and current copy, the
//              substances' current copy (16 since step C12, 13 before), and the charge field phi (19 blocks of hw x hh
//              words; 16 before step C12: such a snapshot loads, its blocks matched by name, the new channels empty)
//   springs    the springs (place, kind, age, life)
//   books      the ledgers' running totals (heat: work, warmth, out = ENTROPY, light; atoms: added, lost, gone; chemistry: light
//              caught, events; the cells' counters, starter charges, ...), so the entropy counter and the books continue
//   time, tick the simulation time and the cells' tick counter
// Arrays are stored as base64 of the raw bytes, gzipped where the browser has CompressionStream (Chrome, Edge, Firefox 113+).
//
// Exactness. A snapshot is taken while the simulation is paused, after every read-back in flight has come home and one
// extra ledger pass at the frozen state (`flushLedger`), so the totals belong to exactly the state in the buffers. On load
// (paused the same way) the buffers are written, the totals are SET to the snapshot's (not added), the rate histories are
// cleared (their windows would span the jump in time), and one ledger pass runs at the loaded state. Into a page of the same
// window size, starting number, capacity and grid (what ?snap= sets up), the load is EXACT: the cells' words and the grid are
// bit-identical and the atoms' and charge's rounding stay 0 (the energy's keeps the value it had). Otherwise (another window
// size or starting number) it is a best effort: cells are moved by the shift of the dish's centre, the grid is kept as the
// page has it when its size differs, and the books are RE-BASED: the atoms' difference per substance is booked as added and
// the energy's as warmth, so the rounding lines start again at 0 (result.rebased says by how much).
// Continuing is not bit-deterministic (the per-frame random seeds of the GPU passes are not part of the state).

import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { LEDGER_WORDS } from './heat.js';
import { NCH, SUBSTANCES } from './matter.js';

export const SNAP_FORMAT = 'moire-cells-snapshot';
export const SNAP_VERSION = 1;

// ---------- small GPU and encoding helpers ----------
/** Copy `size` bytes of a GPU buffer from `offset` back to the CPU (an ArrayBuffer). */
export async function readBuffer(device, src, offset, size) {
  const buf = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = device.createCommandEncoder({ label: 'lab read-back' });
  e.copyBufferToBuffer(src, offset, buf, 0, size);
  device.queue.submit([e.finish()]);
  await buf.mapAsync(GPUMapMode.READ);
  const out = buf.getMappedRange().slice(0);
  buf.unmap(); buf.destroy();
  return out;
}

/** Wait for n drawn frames. */
export function frames(n = 1) {
  return new Promise((resolve) => {
    let k = 0;
    const step = () => { if (++k >= n) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const TYPES = { Uint32Array, Int32Array, Float32Array, Float64Array, Uint8Array };

/** A typed array as { type, n, enc, b64 } (gzipped if the browser can). */
export async function pack(typed) {
  let bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), enc = 'raw';
  if (typeof CompressionStream === 'function') {
    const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
    enc = 'gzip';
  }
  return { type: typed.constructor.name, n: typed.length, enc, b64: b64(bytes) };
}

/** Back from pack(). */
export async function unpack(p) {
  let bytes = unb64(p.b64);
  if (p.enc === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new Error('this browser cannot unzip the snapshot (no DecompressionStream)');
    const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(s).arrayBuffer());
  }
  const T = TYPES[p.type];
  if (!T) throw new Error(`snapshot: unknown array type ${p.type}`);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new T(copy.buffer, 0, p.n);
}

// ---------- settling: a paused page whose books belong to its buffers ----------
/** Whether no read-back is in flight (the ledger, the cells' census, the motion copy). */
function idleNow(M) {
  const H = M.heat, C = M.cells;
  return !H.reads.some((r) => r.busy) && !H.pending.size && !C.statsRead.some((r) => r.busy) && !C.motionBusy;
}
async function waitIdle(M, maxFrames = 600) {
  for (let k = 0; k < maxFrames; k++) {
    if (idleNow(M)) return true;
    await frames(1);
  }
  return false;
}

/**
 * One ledger pass and one census at the current (frozen) state, with no ticks: the books catch up with the buffers (also
 * the counters of a frame whose ledger copy was skipped because every read-back buffer was busy).
 */
export function flushLedger(M, time) {
  const d = M.gpu.device;
  M.heat.writeLedgerSlot();
  if (M.matter.bg && M.matter.bufVersion === M.heat.version) M.matter.writeLedgerSlot();
  const e = d.createCommandEncoder({ label: 'lab ledger flush' });
  M.heat.endFrame(e, 0, { time });
  M.cells.maybeCensus(e, 0, { frameNo: 0, time });
  d.queue.submit([e.finish()]);
}

/**
 * Pause the page (ctl: main.js's control) and wait until every read-back in flight has been applied; with `flush`, then
 * run one ledger pass at the frozen state and wait for it too. Resolves to true when settled.
 */
export async function settle(M, ctl, flush = true) {
  ctl.setPaused(true);
  await frames(2);
  await M.gpu.device.queue.onSubmittedWorkDone();
  let ok = await waitIdle(M);
  if (flush && ok && M.eat.ready) {
    flushLedger(M, ctl.time());
    await frames(1);
    ok = await waitIdle(M);
  }
  return ok;
}

// ---------- settings ----------
/** The live-tunable objects, by name (every switch and knob of the page). */
export function settingObjects(M) {
  const C = M.cells;
  return {
    'cells.params': C.params, 'cells.shape': C.shape, 'cells.fields': C.fields, 'cells.excl': C.excl, 'cells.partner': C.partner,
    'cells.look': C.look, 'genome.params': M.genome.params, 'genome.rules': M.genome.rules, 'heat.params': M.heat.params,
    'light.params': M.light.params, 'matter.params': M.matter.params, 'matter.chem': M.matter.chem, 'eat.params': M.eat.params,
    'charge.params': M.charge.params, 'membrane.params': M.membrane.params, 'dipole.params': M.dipole.params,
    'pumps.params': M.pumps.params, 'catalysts.params': M.catalysts.params, 'hardlight.params': M.hardlight.params,
    'division.params': M.division.params, 'division.look': M.division.look, 'background.params': M.background.params,
    'landscape.params': M.landscape.params, 'medium.params': M.medium.params, 'neon.params': M.neon.params,
    'walls.params': M.walls.params, 'walls.look': M.walls.look,   // step C10
    ...(M.oil ? { 'oil.params': M.oil.params } : {}),            // step C12
    ...(M.lipids ? { 'lipids.params': M.lipids.params, 'lipids.look': M.lipids.look } : {}),   // step C12b
  };
}
const SCALARS = [['neon.on', (M) => M.neon, 'on'], ['background.heatOn', (M) => M.background, 'heatOn'], ['background.ambient', (M) => M.background, 'ambient']];

const clone = (x) => JSON.parse(JSON.stringify(x));

export function captureSettings(M) {
  const out = {};
  for (const [k, o] of Object.entries(settingObjects(M))) out[k] = clone(o);
  for (const [k, get, key] of SCALARS) out[k] = get(M)[key];
  return out;
}

/** Copy src into target, only keys target has, keeping types (arrays element by element, objects recursively). */
function deepAssign(target, src) {
  for (const [k, sv] of Object.entries(src || {})) {
    if (!(k in target)) continue;
    const tv = target[k];
    if (Array.isArray(tv) && Array.isArray(sv)) { tv.length = 0; tv.push(...sv); }
    else if (tv && typeof tv === 'object' && sv && typeof sv === 'object' && !Array.isArray(sv)) deepAssign(tv, sv);
    else if (tv == null || typeof tv === typeof sv) target[k] = sv;
  }
}

export function applySettings(M, S) {
  const objs = settingObjects(M);
  for (const [k, o] of Object.entries(objs)) if (S[k]) deepAssign(o, S[k]);
  for (const [k, get, key] of SCALARS) if (k in S) get(M)[key] = S[k];
}

// ---------- the books ----------
function captureBooks(M) {
  const H = M.heat, Mt = M.matter, E = M.eat;
  return {
    heat: clone(H.tot),
    matter: { add: Array.from(Mt.tot.add), lost: Array.from(Mt.tot.lost), gone: Array.from(Mt.tot.gone),
      light: Array.from(Mt.ctot.light), rx: Array.from(Mt.ctot.rx) },
    eat: { tot: clone(E.tot), tot2: clone(E.tot2), start: E.start },
    membrane: clone(M.membrane.tot), pumps: clone(M.pumps.tot), hardlight: clone(M.hardlight.tot),
    oil: M.oil ? clone(M.oil.tot) : null,   // step C12
    lipids: M.lipids ? clone(M.lipids.tot) : null,   // step C12b
    division: { costTot: M.division.costTot || 0 },
    rounding: {
      energy: H.ledger ? H.ledger.rounding : null, atoms: Mt.ledger ? Mt.ledger.rounding : null,
      charge: M.charge.ledger ? M.charge.ledger.qRound : null,
    },
  };
}

function restoreBooks(M, B) {
  const H = M.heat, Mt = M.matter, E = M.eat;
  H.tot = clone(B.heat);
  // (step C12: a snapshot from before has 13 substances and 6 families: the rest start at 0)
  for (const k of ['add', 'lost', 'gone']) { Mt.tot[k].fill(0); Mt.tot[k].set(B.matter[k].slice(0, Mt.tot[k].length)); }
  Mt.ctot.light.set(B.matter.light); Mt.ctot.rx.fill(0); Mt.ctot.rx.set(B.matter.rx.slice(0, Mt.ctot.rx.length));
  if (M.oil) M.oil.tot = { fused: (B.oil && B.oil.fused) || 0 };
  E.tot = clone(B.eat.tot); E.tot2 = clone(B.eat.tot2); E.start = B.eat.start;
  M.membrane.tot = clone(B.membrane); M.pumps.tot = clone(B.pumps); M.hardlight.tot = clone(B.hardlight);
  M.division.costTot = B.division.costTot;
  if (M.lipids) { for (const k of Object.keys(M.lipids.tot)) M.lipids.tot[k] = (B.lipids && B.lipids[k]) || 0; }   // (step C12b)
}

/** Every rate history and time series starts again (their windows would span the jump in time). */
function clearHistories(M) {
  const mods = [M.heat, M.matter, M.eat, M.membrane, M.pumps, M.catalysts, M.hardlight, M.dipole, M.division, M.cells, M.charge, M.oil, M.lipids].filter(Boolean);   // (step C12: + the oil; C12b: + the lipids)
  for (const m of mods) {
    for (const k of Object.keys(m)) if (/(^hist|Hist$|hist\d$|^series$)/.test(k) && Array.isArray(m[k])) m[k] = [];
  }
  M.cells.motionPrev = null; M.cells.rotPrev = null; M.cells.rotSmooth = null;
}

// ---------- the grid's blocks ----------
/** The word offsets of the saved blocks in the heat buffer: delta, heat (current copy), the 13 substances (current), phi. */
function gridOffsets(M) {
  const H = M.heat, Mt = M.matter, n = H.n;
  return {
    n, delta: LEDGER_WORDS, heat: H.offset(H.cur), heatCopies: [H.offset(0), H.offset(1)],
    matter: LEDGER_WORDS + Mt.copyBase(Mt.cur), matterCopies: [LEDGER_WORDS + Mt.copyBase(0), LEDGER_WORDS + Mt.copyBase(1)],
    phi: H.chargeOffset,
  };
}

async function readGrid(M) {
  const d = M.gpu.device, H = M.heat, o = gridOffsets(M), n = o.n;
  const staging = d.createBuffer({ size: (3 + NCH) * n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = d.createCommandEncoder({ label: 'lab grid read-back' });
  e.copyBufferToBuffer(H.buffer, o.delta * 4, staging, 0, n * 4);
  e.copyBufferToBuffer(H.buffer, o.heat * 4, staging, n * 4, n * 4);
  e.copyBufferToBuffer(H.buffer, o.matter * 4, staging, 2 * n * 4, NCH * n * 4);
  e.copyBufferToBuffer(H.buffer, o.phi * 4, staging, (2 + NCH) * n * 4, n * 4);
  d.queue.submit([e.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Int32Array(staging.getMappedRange().slice(0));
  staging.unmap(); staging.destroy();
  return out;
}

/** `names`: the snapshot's block names (grid.blocks); a substance it does not have (saved before step C12) is left empty. */
function writeGrid(M, w, names) {
  const q = M.gpu.device.queue, H = M.heat, o = gridOffsets(M), n = o.n;
  const block = (k, len = 1) => w.subarray(k * n, (k + len) * n);
  const at = (name) => names.indexOf(name);
  q.writeBuffer(H.buffer, o.delta * 4, block(at('delta')));
  for (const c of o.heatCopies) q.writeBuffer(H.buffer, c * 4, block(at('heat')));
  const subs = new Int32Array(NCH * n);
  SUBSTANCES.forEach((s, c) => { const k = at(s.name); if (k >= 0) subs.set(block(k), c * n); });
  for (const c of o.matterCopies) q.writeBuffer(H.buffer, c * 4, subs);
  q.writeBuffer(H.buffer, o.phi * 4, block(at('phi')));
  H.cur = 0; M.matter.cur = 0;
  M.charge.phiLive = true;
}

// ---------- snapshot ----------
/**
 * The whole state as a JSON-serialisable object. opts.grid (default true): include the substrate grid (heat, substances,
 * charge field; the bulk of the file). opts.note: any text to keep with it. The page is left paused or running as it was.
 */
export async function snapshot(M, ctl, opts = {}) {
  const grid = opts.grid !== false;
  const wasPaused = ctl.paused();
  try {
    if (!(await settle(M, ctl, true))) throw new Error('snapshot: the page did not settle (read-backs still in flight)');
    const C = M.cells, d = M.gpu.device, n = C.count;
    const SW = C.eat.stockBuf.size / 4 / n;
    const [cellAB, bioAB, stockAB, statsAB] = await Promise.all([
      readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
      readBuffer(d, C.eat.stockBuf, 0, C.eat.stockBuf.size),
      readBuffer(d, C.statsBuf, 0, C.statsBuf.size),
    ]);
    const cu = new Uint32Array(cellAB), bu = new Uint32Array(bioAB), su = new Uint32Array(stockAB);
    const idx = [];
    for (let i = 0; i < n; i++) if (cu[i * CELL_FLOATS + 9] & 1) idx.push(i);
    const m = idx.length;
    const rec = new Uint32Array(m * CELL_FLOATS), bio = new Uint32Array(m * BIO_FLOATS), stock = new Uint32Array(m * SW);
    idx.forEach((i, k) => {
      rec.set(cu.subarray(i * CELL_FLOATS, (i + 1) * CELL_FLOATS), k * CELL_FLOATS);
      bio.set(bu.subarray(i * BIO_FLOATS, (i + 1) * BIO_FLOATS), k * BIO_FLOATS);
      stock.set(su.subarray(i * SW, (i + 1) * SW), k * SW);
    });
    const H = M.heat, v = ctl.view();
    const out = {
      format: SNAP_FORMAT, version: SNAP_VERSION, created: new Date().toISOString(), note: opts.note || '',
      url: location.href, query: location.search, seed: ctl.seed,
      time: ctl.time(), tick: C.tick >>> 0,
      view: { cssW: v.cssW, cssH: v.cssH }, R: C.R, start: C.start, count: C.count, alive: m,
      layout: { cellWords: CELL_FLOATS, bioWords: BIO_FLOATS, stockWords: SW, substances: SUBSTANCES.map((s) => s.name) },
      settings: captureSettings(M),
      founders: clone(M.genome.founders),
      springs: clone(M.matter.springs),
      books: captureBooks(M),
      js: { aQuant: C.aQuant ? clone(C.aQuant) : null },
      cells: { idx: await pack(new Uint32Array(idx)), rec: await pack(rec), bio: await pack(bio), stock: await pack(stock) },
      stats: await pack(new Uint32Array(statsAB)),
      grid: grid ? { hw: H.hw, hh: H.hh, px: H.px, blocks: ['delta', 'heat', ...SUBSTANCES.map((s) => s.name), 'phi'], data: await pack(await readGrid(M)) } : null,
      measures: opts.measures || null,
    };
    return out;
  } finally {
    ctl.setPaused(wasPaused);
  }
}

// ---------- load ----------
/**
 * Put a snapshot back. Resolves to { exact, notes, rebased, rounding }. The page is left paused or running as it was
 * (opts.paused: force one). opts.settings === false: keep the page's own switches and knobs.
 */
export async function loadSnapshot(M, ctl, S, opts = {}) {
  if (!S || S.format !== SNAP_FORMAT) throw new Error('not a moire-cells snapshot');
  if (S.version > SNAP_VERSION) throw new Error(`snapshot version ${S.version} is newer than this page (${SNAP_VERSION})`);
  const wasPaused = ctl.paused();
  const notes = [];
  const C = M.cells, H = M.heat, d = M.gpu.device;
  try {
    await settle(M, ctl, false);
    // step C10: a snapshot from before the patterned walls (cells of 64 words, genomes of 48) loads with the new words empty (front
    // 0, no maturity, no adhesion until the eat pass's first tick; wall genes a1 = a2 = w = 0, a uniform wall) and with the walls
    // OFF, so it runs on as it was saved; other layouts are refused
    // step C12b: one from before the lipid membranes (cells of 72 words, genomes of 52, stocks of 32) loads the same way, with the new
    // words empty (no lipids in any membrane, lipid genes 0) and with the lipid membranes OFF, so it runs on as it was saved
    const oldC10 = S.layout.cellWords === 64 && S.layout.bioWords === 48;
    const oldC12 = S.layout.cellWords === 72 && S.layout.bioWords === 52;
    const widen = oldC10 || oldC12;
    if (!widen && (S.layout.cellWords !== CELL_FLOATS || S.layout.bioWords !== BIO_FLOATS)) {
      throw new Error(`snapshot layout (cell ${S.layout.cellWords}, bio ${S.layout.bioWords} words) does not match this page (${CELL_FLOATS}, ${BIO_FLOATS})`);
    }
    const m = S.alive;
    if (m > C.count) throw new Error(`the snapshot has ${m} cells, this page room for ${C.count}: load it with ?snap= or start the page with ?cap=${S.count}`);
    // the starting number sets the cells' radius R (and with it the grid): take the snapshot's
    if (C.start !== S.start) {
      notes.push(`starting number ${C.start} -> ${S.start} (sets R)`);
      C.start = S.start;
      ctl.resize();
      if (H.old) { H.trash.push(H.old.buffer); H.old = null; }   // the replaced grid: dropped, not drained (the books are replaced too)
      rebind(M);
    }
    const v = ctl.view();
    const sameView = v.cssW === S.view.cssW && v.cssH === S.view.cssH;
    if (!sameView) notes.push(`window ${v.cssW}x${v.cssH}, snapshot ${S.view.cssW}x${S.view.cssH}: cells moved with the dish's centre`);
    const sameR = Math.abs(C.R - S.R) < 1e-6;
    if (!sameR) notes.push(`R ${C.R.toFixed(3)} px, snapshot ${S.R.toFixed(3)} px`);
    const gridOK = !!S.grid && S.grid.hw === H.hw && S.grid.hh === H.hh;
    if (S.grid && !gridOK) notes.push(`grid ${H.hw}x${H.hh}, snapshot ${S.grid.hw}x${S.grid.hh}: the page's grid kept`);
    if (!S.grid) notes.push('no grid in the snapshot (cells only): the page\'s grid kept');

    if (opts.settings !== false) applySettings(M, S.settings);
    if (opts.settings !== false && M.lipids && !(S.settings && S.settings['lipids.params'])) {
      M.lipids.params.on = false;
      notes.push('saved before step C12b: lipid membranes off (as it ran)');
    }
    if (opts.settings !== false && !(S.settings && S.settings['walls.params'])) {
      M.walls.params.on = false;
      notes.push('saved before step C10: patterned walls off (as it ran)');
    } else if (opts.settings !== false && !('turn' in S.settings['walls.params'])) {
      // step C11: a snapshot from before the glue turned cells runs on as it was saved: no turning, divisions by the long axis
      M.walls.params.turn = false;
      M.walls.params.divFront = false;
      M.walls.params.freeGlue = 0;
      notes.push('saved before step C11: glue turning and division by the front off, no free base glue (as it ran)');
    }
    if (S.founders) M.genome.founders = clone(S.founders);

    // the cells: at their own slots when they fit, else packed from slot 0 (their neighbour words then cleared)
    const n = C.count, SW = C.eat.stockBuf.size / 4 / n;
    const idx = await unpack(S.cells.idx);
    let rec = await unpack(S.cells.rec), bio = await unpack(S.cells.bio);
    let stock = await unpack(S.cells.stock);
    if (widen) {   // widen the records to this page's layout (the new words zero)
      const cw = S.layout.cellWords, bw = S.layout.bioWords;
      const r2 = new Uint32Array(m * CELL_FLOATS), b2 = new Uint32Array(m * BIO_FLOATS);
      for (let k = 0; k < m; k++) {
        r2.set(rec.subarray(k * cw, (k + 1) * cw), k * CELL_FLOATS);
        b2.set(bio.subarray(k * bw, (k + 1) * bw), k * BIO_FLOATS);
      }
      rec = r2; bio = b2;
    }
    if (S.layout.stockWords < SW && S.layout.stockWords === 32) {   // (step C12b: stocks of 32 words: the lipid words empty)
      const s2 = new Uint32Array(m * SW), ow = S.layout.stockWords;
      for (let k = 0; k < m; k++) s2.set(stock.subarray(k * ow, (k + 1) * ow), k * SW);
      stock = s2;
    } else if (S.layout.stockWords !== SW) throw new Error(`snapshot stock records have ${S.layout.stockWords} words, this page ${SW}`);
    const sameSlots = m === 0 || Math.max(...idx) < n;
    if (!sameSlots) notes.push('slots packed (the capacity is smaller than the snapshot\'s slot numbers)');
    const cu = new Uint32Array(n * CELL_FLOATS), cf = new Float32Array(cu.buffer);
    const bu = new Uint32Array(n * BIO_FLOATS), su = new Uint32Array(n * SW);
    const dx = (v.cssW - S.view.cssW) / 2, dy = (v.cssH - S.view.cssH) / 2;
    for (let k = 0; k < m; k++) {
      const i = sameSlots ? idx[k] : k, o = i * CELL_FLOATS;
      cu.set(rec.subarray(k * CELL_FLOATS, (k + 1) * CELL_FLOATS), o);
      bu.set(bio.subarray(k * BIO_FLOATS, (k + 1) * BIO_FLOATS), i * BIO_FLOATS);
      su.set(stock.subarray(k * SW, (k + 1) * SW), i * SW);
      if (!sameView) { cf[o] += dx; cf[o + 1] += dy; }
      if (!sameSlots) cu[o + 60] = cu[o + 61] = cu[o + 62] = 0xffffffff;
    }
    const q = d.queue;
    q.writeBuffer(C.cellBuf, 0, cu);
    for (const b of C.bioBuf) q.writeBuffer(b, 0, bu);
    q.writeBuffer(C.eat.stockBuf, 0, su);
    const stats = await unpack(S.stats);
    if (stats.byteLength === C.statsBuf.size) q.writeBuffer(C.statsBuf, 0, stats);
    else if (stats.byteLength < C.statsBuf.size && stats.byteLength >= C.statsBuf.size - 128) q.writeBuffer(C.statsBuf, 0, stats);   // (step C10
    // appended Stats.wall, step C11 widened it: the counters are in front, the census words behind are refilled every frame)
    else notes.push('stats buffer size differs: counters start from the page\'s');
    if (gridOK) writeGrid(M, await unpack(S.grid.data), S.grid.blocks || ['delta', 'heat', ...SUBSTANCES.slice(0, 13).map((s) => s.name), 'phi']);

    // springs, time, the JS-side state
    M.matter.springs = clone(S.springs || []).map((s) => (sameView ? s : { ...s, x: s.x + dx, y: s.y + dy }));
    ctl.setTime(S.time);
    C.tick = S.tick >>> 0;
    C.warm = 0;
    C.alive = m;
    C.aQuant = S.js && S.js.aQuant ? clone(S.js.aQuant) : null;
    M.matter.seen.fill(S.time);    // every substance channel moves until the read-backs say which hold matter
    M.matter.snapTime = -1e9; M.matter.maskHist = [];
    restoreBooks(M, S.books);
    clearHistories(M);
    if (M.tissue) M.tissue.reset();

    // one ledger pass at the loaded state; then, unless exact, re-base the books so the rounding starts at 0
    await frames(1);
    await waitIdle(M);
    flushLedger(M, ctl.time());
    await frames(1);
    await waitIdle(M);
    const exact = sameView && sameR && sameSlots && (gridOK || !S.grid) && !!S.grid;
    let rebased = null;
    if (!exact) {
      rebased = rebase(M);
      flushLedger(M, ctl.time());
      await frames(1);
      await waitIdle(M);
    }
    const rounding = {
      energy: H.ledger ? H.ledger.rounding : null, atoms: M.matter.ledger ? M.matter.ledger.rounding : null,
      charge: M.charge.ledger ? M.charge.ledger.qRound : null, snapshot: S.books.rounding,
    };
    return { exact, notes, rebased, rounding, cells: m, time: S.time };
  } finally {
    ctl.setPaused(opts.paused ?? wasPaused);
  }
}

/** After the heat grid was replaced while paused: the bind groups that hold it, made again now (not at the next tick). */
function rebind(M) {
  const H = M.heat, Mt = M.matter;
  Mt.bufVersion = H.version; Mt.cur = 0;
  Mt.bg = Mt.makeBG(H.buffer);
  Mt.makeTextures();
  M.charge.phiLive = false;
  M.eat.makeBG();
  M.cells.makeStepBGs();
}

/**
 * Books that do not match the buffers (a best-effort load): per substance, book the difference between the totals and what
 * is in the dish, the cells and out as added; the energy's difference as warmth. Returns what was booked.
 */
function rebase(M) {
  const Mt = M.matter, E = M.eat, H = M.heat;
  const atoms = {};
  const stock = E.ledger ? E.ledger.stock : new Float64Array(NCH);
  for (let c = 0; c < NCH; c++) {
    const diff = Mt.tot.add[c] - (Mt.dish[c] + stock[c] + Mt.tot.lost[c] + Mt.tot.gone[c]);
    if (diff !== 0) { Mt.tot.add[c] -= diff; atoms[SUBSTANCES[c].name] = -diff; }
  }
  let energy = 0;
  if (H.ledger) {
    // the chemical energy of the added atoms is part of `stored`, so re-base after the atoms: approximately (the next
    // ledger pass shows the rest, which this second step takes out)
    energy = -H.ledger.rounding;
    H.tot.base += energy;
  }
  return { atoms, energy };
}

/** For ?snap=: fetch a snapshot file of this site (same origin only). */
export async function fetchSnapshot(path) {
  const url = new URL(path, location.href);
  if (url.origin !== location.origin) throw new Error('?snap= takes a file of this site only');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`could not load the snapshot ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Save a snapshot as a file (a download). */
export function downloadJSON(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return blob.size;
}
