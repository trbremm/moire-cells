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
import { NCH, SUBSTANCES, ELECTRONS } from './matter.js';
import { CARBON, CB_LIP, CB_ENZANY, LADDER, TAR } from './carbon.js';   // step C15a (step C15c: CB_LIP; C15e: CB_ENZANY)
import { CW as CB_W, CW_STOCK as CB_STOCK } from './carboncells.js';   // step C15b: the cells' carbon words
// step C15a: the carbon's grid blocks in a snapshot (behind phi): the ladder's current copy, then the tar's hand counts
const CARBON_BLOCKS = CARBON ? [...LADDER, ...TAR.map((h) => `tar.${h}`)] : [];
// step Q1: the signal's blocks (behind the carbon's): its energy and flavour vector (the current copy)
const SIG_BLOCKS = ['sig.A', 'sig.X', 'sig.Y'];
const sigBlocks = (M) => (M.signals ? SIG_BLOCKS : []);
import { fieldDefaults } from './guides.js';
import { dish, snapDish } from './dish.js';

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
    ...(M.excited ? { 'excited.params': M.excited.params, 'excited.look': M.excited.look } : {}),   // step C12c
    ...(M.electrons ? { 'electrons.params': M.electrons.params, 'electrons.look': M.electrons.look } : {}),   // step C12d
    ...(M.guides ? { 'guides.params': M.guides.params, 'guides.look': M.guides.look } : {}),   // step C13
    ...(M.waste ? { 'waste.params': M.waste.params } : {}),   // step C12e
    ...(M.vents ? { 'vents.params': M.vents.params } : {}),   // step C12f
    ...(M.ions ? { 'ions.params': M.ions.params } : {}),     // step C12g
    ...(M.whole ? { 'whole.params': M.whole.params } : {}),   // step M1
    ...(M.kin ? { 'kin.params': M.kin.params, 'kin.look': M.kin.look } : {}),   // step T1a
    ...(M.grn ? { 'grn.params': M.grn.params, 'grn.look': M.grn.look } : {}),   // step T1b
    ...(M.predators ? { 'predators.params': M.predators.params, 'predators.look': M.predators.look } : {}),   // step P1
    ...(M.fidelity ? { 'fidelity.params': M.fidelity.params } : {}),   // step G1 (old snapshots: the gene 0 everywhere, the founders' value)
    ...(M.mutation ? { 'mutation.params': M.mutation.params } : {}),   // step M2 (old snapshots: today's drift x 1, the defaults)
    ...(M.dup ? { 'dup.params': M.dup.params } : {}),                 // step G2 (old snapshots: duplication off, as they ran)
    ...(M.motors ? { 'motors.params': M.motors.params } : {}),       // step S2 (old snapshots: flagella and cilia off, as they ran)
    ...(M.senses ? { 'senses.params': M.senses.params } : {}),       // step P3 (old snapshots: the senses off, as they ran)
    ...(M.folding ? { 'folding.params': M.folding.params } : {}),   // step G3 (old snapshots: the moire genome off, as they ran)
    ...(M.signals ? { 'signals.params': M.signals.params } : {}),   // step Q1 (old snapshots: the signal substance off, as they ran)
    ...(M.contract ? { 'contract.params': M.contract.params } : {}),   // step L1 (old snapshots: every contraction gene 0, nothing contracts)
    ...(M.tendrils ? { 'tendrils.params': M.tendrils.params } : {}),   // step T2 (old snapshots: tendrils and bone off, as they ran)
    ...(M.pigments ? { 'pigments.params': M.pigments.params } : {}),   // step N1: light needs matter
    ...(M.water ? { 'water.params': M.water.params } : {}),           // step N1: caustic light, currents
    ...(M.perfusion ? { 'perfusion.params': M.perfusion.params } : {}),   // perfusion (src/perfusion.js)
    ...(M.oases ? { 'oases.params': M.oases.params } : {}),           // step N1: the scarce nutrient's springs
    ...(M.glue ? { 'glue.params': M.glue.params } : {}),              // step G0: strong glue, junctions that break
    ...(M.stir ? { 'stir.params': M.stir.params } : {}),              // step G0: the cells stir the water
    ...(CARBON && M.carbon ? { 'carbon.params': M.carbon.params } : {}),                // step C15a: carbon in the open dish
    ...(CARBON && M.carbonCells ? { 'carbonCells.params': M.carbonCells.params } : {}),  // step C15b: cells eat carbon
    ...(M.spindle ? { 'spindle.params': M.spindle.params } : {}),     // step S1: cell shape
    ...(M.flow ? { 'flow.params': M.flow.params } : {}),               // step N2: substances that flow (old snapshots: off, as they ran)
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
    excited: M.excited ? clone(M.excited.tot) : null,   // step C12c
    electrons: M.electrons ? clone(M.electrons.tot) : null,   // step C12d
    vents: M.vents ? clone(M.vents.tot) : null,   // step C12f
    pigments: M.pigments ? clone(M.pigments.tot) : null,   // step N1
    carbon: CARBON ? cloneCarbon(M.matter.carbon.tot) : null,   // step C15a
    signals: M.signals ? clone(M.signals.tot) : null,   // step Q1
    excitedE16: M.excited ? M.excited.table.e16 : null,   // (the energy one excited count holds: ?exshare=)
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
  if (M.excited) { for (const k of Object.keys(M.excited.tot)) M.excited.tot[k] = (B.excited && B.excited[k]) || 0; }   // (step C12c)
  if (M.electrons) { for (const k of Object.keys(M.electrons.tot)) M.electrons.tot[k] = (B.electrons && B.electrons[k]) || 0; }   // (step C12d)
  if (M.vents) { for (const k of Object.keys(M.vents.tot)) M.vents.tot[k] = (B.vents && B.vents[k]) || 0; }   // (step C12f)
  if (M.pigments) { for (const k of Object.keys(M.pigments.tot)) M.pigments.tot[k] = (B.pigments && B.pigments[k]) || 0; }   // (step N1)
  if (!(H.tot.vent >= 0)) H.tot.vent = 0;
  if (M.signals) { const ST = M.signals.tot; for (const k of Object.keys(ST)) ST[k] = (B.signals && B.signals[k]) || 0; M.signals.hist = []; }   // (step Q1)
  if (CARBON) {   // step C15a
    const CT = M.matter.carbon.tot, BC = B.carbon || {};
    for (const k of ['add', 'lost', 'gone', 'rx', 'light', 'cin', 'cout']) { CT[k].fill(0); if (BC[k]) CT[k].set(BC[k].slice(0, CT[k].length)); }   // (step C15b: + cin, cout)
    CT.glow = BC.glow || 0; CT.heat = BC.heat || 0; CT.gt = BC.gt || 0;
  }
}

/** Step C15a: the carbon's totals as plain numbers. */
function cloneCarbon(T) {
  return { add: Array.from(T.add), lost: Array.from(T.lost), gone: Array.from(T.gone), rx: Array.from(T.rx), light: Array.from(T.light), glow: T.glow, heat: T.heat, gt: T.gt,
    cin: Array.from(T.cin), cout: Array.from(T.cout) };   // (step C15b: carbon taken into cells, given back)
}

/** Every rate history and time series starts again (their windows would span the jump in time). */
function clearHistories(M) {
  const mods = [M.heat, M.matter, M.eat, M.membrane, M.pumps, M.catalysts, M.hardlight, M.dipole, M.division, M.cells, M.charge, M.oil, M.lipids, M.excited, M.electrons, M.vents, M.pigments].filter(Boolean);   // (step C12: + the oil; C12b: + the lipids; C12d: + electrons; C12f: + vents)
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
    // step C15a: the carbon ladder (current copy, both copies) and the tar
    ...(CARBON ? { carbon: LEDGER_WORDS + Mt.carbon.copyBase(Mt.carbon.cur), carbonCopies: [0, 1].map((k) => LEDGER_WORDS + Mt.carbon.copyBase(k)),
      tar: LEDGER_WORDS + Mt.carbon.tarBase() } : {}),
    // step Q1: the signal (copy 0 is current between ticks; copy 1 and the inboxes cleared on a load)
    ...(M.signals && H.signals ? { sig: M.signals.base(), sigCopy1: M.signals.base() + 3 * n, sigInbox: M.signals.inbox, sigInboxWords: (M.signals.blocks - 6) * n } : {}),
  };
}

export async function readGrid(M) {   // (step T1c: also the warfare census)
  const d = M.gpu.device, H = M.heat, o = gridOffsets(M), n = o.n;
  const nsig = o.sig ? SIG_BLOCKS.length : 0;   // (step Q1: the signal's 3 blocks last)
  const staging = d.createBuffer({ size: (3 + NCH + CARBON_BLOCKS.length + nsig) * n * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const e = d.createCommandEncoder({ label: 'lab grid read-back' });
  e.copyBufferToBuffer(H.buffer, o.delta * 4, staging, 0, n * 4);
  e.copyBufferToBuffer(H.buffer, o.heat * 4, staging, n * 4, n * 4);
  e.copyBufferToBuffer(H.buffer, o.matter * 4, staging, 2 * n * 4, NCH * n * 4);
  e.copyBufferToBuffer(H.buffer, o.phi * 4, staging, (2 + NCH) * n * 4, n * 4);
  if (CARBON) {   // step C15a: the ladder's 5 blocks, then the tar's 3
    e.copyBufferToBuffer(H.buffer, o.carbon * 4, staging, (3 + NCH) * n * 4, 5 * n * 4);
    e.copyBufferToBuffer(H.buffer, o.tar * 4, staging, (8 + NCH) * n * 4, 3 * n * 4);
  }
  if (nsig) e.copyBufferToBuffer(H.buffer, o.sig * 4, staging, (3 + NCH + CARBON_BLOCKS.length) * n * 4, nsig * n * 4);
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
  if (CARBON) {   // step C15a: the ladder (both copies) and the tar; blocks the snapshot does not have stay empty
    const lad = new Int32Array(5 * n), tar = new Int32Array(3 * n);
    LADDER.forEach((nm, j) => { const k = at(nm); if (k >= 0) lad.set(block(k), j * n); });
    TAR.forEach((h, j) => { const k = at(`tar.${h}`); if (k >= 0) tar.set(block(k), j * n); });
    for (const c of o.carbonCopies) q.writeBuffer(H.buffer, c * 4, lad);
    q.writeBuffer(H.buffer, o.tar * 4, tar);
    M.matter.carbon.cur = 0;
  }
  if (o.sig) {   // step Q1: the signal (a snapshot from before has none: the dish starts without)
    const sig = new Int32Array(3 * n);
    SIG_BLOCKS.forEach((nm, j) => { const k = at(nm); if (k >= 0) sig.set(block(k), j * n); });
    q.writeBuffer(H.buffer, o.sig * 4, sig);
    q.writeBuffer(H.buffer, o.sigCopy1 * 4, new Int32Array(3 * n));
    q.writeBuffer(H.buffer, o.sigInbox * 4, new Int32Array(o.sigInboxWords));
  }
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
    const CB = CARBON ? C.eat.carbon : null;   // step C15b: the cells' carbon (its own buffer, CW words a cell)
    const [cellAB, bioAB, stockAB, statsAB, cbAB] = await Promise.all([
      readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4),
      readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4),
      readBuffer(d, C.eat.stockBuf, 0, C.eat.stockBuf.size),
      readBuffer(d, C.statsBuf, 0, C.statsBuf.size),
      CB ? readBuffer(d, CB.buf, 0, n * CB_W * 4) : null,
    ]);
    const cu = new Uint32Array(cellAB), bu = new Uint32Array(bioAB), su = new Uint32Array(stockAB);
    const idx = [];
    // (step P1: and the GHOSTS, dead slots whose stock is a meal being digested: Cell.engBy mode 2)
    for (let i = 0; i < n; i++) if ((cu[i * CELL_FLOATS + 9] & 1) || ((cu[i * CELL_FLOATS + 89] >>> 24) & 3) === 2) idx.push(i);
    const m = idx.length;
    const rec = new Uint32Array(m * CELL_FLOATS), bio = new Uint32Array(m * BIO_FLOATS), stock = new Uint32Array(m * SW);
    const cbu = cbAB ? new Uint32Array(cbAB) : null, cstock = cbu ? new Uint32Array(m * CB_STOCK) : null;
    const ctend = cbu ? new Uint32Array(m) : null;   // (step T2: the tendrils' carbon pool, carbon word 23)
    idx.forEach((i, k) => {
      rec.set(cu.subarray(i * CELL_FLOATS, (i + 1) * CELL_FLOATS), k * CELL_FLOATS);
      bio.set(bu.subarray(i * BIO_FLOATS, (i + 1) * BIO_FLOATS), k * BIO_FLOATS);
      stock.set(su.subarray(i * SW, (i + 1) * SW), k * SW);
      if (cstock) cstock.set(cbu.subarray(i * CB_W, i * CB_W + CB_STOCK), k * CB_STOCK);   // (step C15b: the ladder and granules)
      if (ctend) ctend[k] = cbu[i * CB_W + 23];
    });
    const H = M.heat, v = ctl.view();
    const out = {
      format: SNAP_FORMAT, version: SNAP_VERSION, created: new Date().toISOString(), note: opts.note || '',
      url: location.href, query: location.search, seed: ctl.seed,
      electrons: ELECTRONS,   // step C12d: the chemistry's table it runs on (absent before step C12d: the old one)
      carbon: CARBON,         // step C15a: carbon in the dish (absent before step C15a: no carbon)
      cbLip: CB_LIP,          // step C15c: the membranes, walls, pigments, glue are carbon (absent before: the linkers' (?cblip=0))
      cbEnzAny: CB_ENZANY,    // step C15e: the enzymes' scaffold is burnt carbon (absent before: cellulose-like (?cbenzany=0))
      jobs: 1,                // step F0: the cells carry job scores, no fates (absent before: fates, cleared on load)
      time: ctl.time(), tick: C.tick >>> 0,
      view: { cssW: v.cssW, cssH: v.cssH }, R: C.R, start: C.start, count: C.count, alive: m,
      dish: { W: dish.W, H: dish.H, R: dish.R, mR: dish.mR, perArea: dish.perArea, start: dish.start, press: { ...dish.press } },   // (the dish's own size, src/dish.js)
      layout: { cellWords: CELL_FLOATS, bioWords: BIO_FLOATS, stockWords: SW, substances: SUBSTANCES.map((s) => s.name) },
      settings: captureSettings(M),
      founders: clone(M.genome.founders),
      springs: clone(M.matter.springs),
      obstacles: M.obstacles ? M.obstacles.save() : null,   // step G0b: the obstacles' shapes (the mask is made from them again)
      books: captureBooks(M),
      js: { aQuant: C.aQuant ? clone(C.aQuant) : null },
      cells: { idx: await pack(new Uint32Array(idx)), rec: await pack(rec), bio: await pack(bio), stock: await pack(stock),
        ...(cstock ? { carbon: await pack(cstock), carbonWords: CB_STOCK } : {}),   // (step C15b: the cells' carbon, CB_STOCK words a cell; absent before)
        ...(ctend ? { tendrilCarbon: await pack(ctend) } : {}) },   // (step T2: the tendrils' pools; absent before: none; the ropes themselves regrow)
      stats: await pack(new Uint32Array(statsAB)),
      grid: grid ? { hw: H.hw, hh: H.hh, px: H.px, blocks: ['delta', 'heat', ...SUBSTANCES.map((s) => s.name), 'phi', ...CARBON_BLOCKS, ...sigBlocks(M)], data: await pack(await readGrid(M)) } : null,
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
  // step C12d: the table is fixed for the page (the energy of everything in the dish depends on it): a snapshot of the other table
  // needs a page started with its ?electrons= (?snap= does that by itself: main.js reloads the page)
  if (!!S.electrons !== ELECTRONS) {
    throw new Error(`this snapshot runs on the ${S.electrons ? 'electrons table' : 'old (step C4) table'}: open the page with ?electrons=${S.electrons ? 1 : 0} to load it`);
  }
  // step C15a: carbon is fixed for the page too (its blocks live in the grid): a snapshot from before carbon loads with ?carbon=0
  if (!!S.carbon !== CARBON) {
    throw new Error(`this snapshot was saved ${S.carbon ? 'with' : 'without'} carbon: open the page with ?carbon=${S.carbon ? 1 : 0} to load it`);
  }
  // step C15c: and the membranes' make-up (their stock words mean linker or carbon molecules)
  if (!!S.cbLip !== CB_LIP) {
    throw new Error(`this snapshot was saved ${S.cbLip ? 'with' : 'without'} carbon making the cell: open the page with ?cblip=${S.cbLip ? 1 : 0} to load it`);
  }
  // step C15e: and the enzymes' scaffold (their carbon word means other hands)
  if (S.carbon && S.cbLip && !!S.cbEnzAny !== CB_ENZANY) {
    throw new Error(`this snapshot was saved ${S.cbEnzAny ? 'with' : 'without'} enzymes of any carbon: open the page with ?cbenzany=${S.cbEnzAny ? 1 : 0} to load it`);
  }
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
    // step C13: one from before the field genes (cells of 78 words, genomes of 56) loads with the new words empty (the beat's gene words 0:
    // today's values; nothing felt yet), its genomes' field genes at today's values (x 1, offset 0, gates 0, push 1), and with the field
    // genes, every gate and the push gene OFF, so it runs on as it was saved
    const oldC10 = S.layout.cellWords === 64 && S.layout.bioWords === 48;
    const oldC12 = S.layout.cellWords === 72 && S.layout.bioWords === 52;
    const oldC13 = S.layout.cellWords === 78 && S.layout.bioWords === 56;
    // step C12e: one from before osmosis (cells of 84 words) loads with the swelling words 0 and with saturation and osmosis OFF
    const oldC12e = S.layout.cellWords === 84 && S.layout.bioWords === 76;
    // step T1a: one from before the self marker (genomes of 76 words) loads with the marker and kin genes 0 (one marker for all, hidden: no
    // kinship, no channels) and with the inside, the kin channels, the clock and the smell for trace OFF, so it runs on as it was saved
    const oldT1 = S.layout.cellWords === 88 && S.layout.bioWords === 76;
    // step T1b: one from before the gene network (genomes of 84 words) loads with the network's words 0 (no network: every output x 1) and
    // with the network OFF (no mutation either), so it runs on as it was saved
    const oldT1b = S.layout.cellWords === 88 && S.layout.bioWords === 84;
    // step P1: one from before the predators (cells of 88 words) loads with the engulfing words 0 (no wraps, no ghosts) and with engulfing OFF
    const oldP1 = S.layout.cellWords === 88 && S.layout.bioWords === 156;
    // step G2: one from before gene duplication (genomes of 156 words) loads with the duplicate slots silent and no families (named at the next
    // births, by founder), and with duplication OFF, so it runs on as it was saved
    const oldG2 = S.layout.cellWords === 92 && S.layout.bioWords === 156;
    // step S2: one from before flagella and cilia (cells of 92 words, genomes of 168) loads with the motor words 0 (no motors, the phase at 0)
    // and with flagella and cilia OFF, so it runs on as it was saved
    const oldS2 = S.layout.cellWords === 92 && S.layout.bioWords === 168;
    // step P3: one from before the senses (cells of 94 words, genomes of 180) loads with the taste words 0 (no dials, range 0, nothing tasted)
    // and with the nose, the taste, the clump test and shared armour OFF, so it runs on as it was saved
    const oldP3 = S.layout.cellWords === 94 && S.layout.bioWords === 180;
    // step G3: one from before the moire genome (genomes of 188 words) loads with the lattice words 0 and the moire genome OFF (the network's
    // weights as they were), so it runs on as it was saved
    const oldG3 = S.layout.cellWords === 96 && S.layout.bioWords === 188;
    // step Q1: one from before the signal (genomes of 224 words) loads with the signal words 0 and the signal substance OFF
    const oldQ1 = S.layout.cellWords === 96 && S.layout.bioWords === 224;
    // step T2: one from before the tendrils (genomes of 240 words) loads with the tendril and mineral words 0 and tendrils and bone OFF
    const oldT2 = S.layout.cellWords === 96 && S.layout.bioWords === 240;
    const widen = oldC10 || oldC12 || oldC13 || oldC12e || oldT1 || oldT1b || oldP1 || oldG2 || oldS2 || oldP3 || oldG3 || oldQ1 || oldT2;
    if (!widen && (S.layout.cellWords !== CELL_FLOATS || S.layout.bioWords !== BIO_FLOATS)) {
      throw new Error(`snapshot layout (cell ${S.layout.cellWords}, bio ${S.layout.bioWords} words) does not match this page (${CELL_FLOATS}, ${BIO_FLOATS})`);
    }
    const m = S.alive;
    if (m > C.count) throw new Error(`the snapshot has ${m} cells, this page room for ${C.count}: load it with ?snap= or start the page with ?cap=${S.count}`);
    // the dish (src/dish.js): take the snapshot's (its size, R, medium and whether supplies are per area; one from before: its window,
    // R and medium, supplies per px), so the load is exact in any window (with ?dishfollow=1 the window stays the dish, as before)
    const D = snapDish(S);
    if (!dish.follow && (D.W !== dish.W || D.H !== dish.H || D.R !== dish.R || D.mR !== dish.mR || D.perArea !== dish.perArea)) {
      notes.push(`dish ${Math.round(dish.W)}x${Math.round(dish.H)} px (R ${dish.R.toFixed(3)}) -> the snapshot's ${Math.round(D.W)}x${Math.round(D.H)} (R ${D.R.toFixed(3)})`);
      Object.assign(dish, D, { from: 'snapshot' });
      C.start = S.start;
      ctl.resize();
      if (H.old) { H.trash.push(H.old.buffer); H.old = null; }   // the replaced grid: dropped, not drained (the books are replaced too)
      rebind(M);
    }
    if (S.dish && S.dish.press) dish.press = { ...S.dish.press };   // (the pressing wall, src/dish.js)
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
    } else if (opts.settings !== false && M.lipids && !('graze' in S.settings['lipids.params'])) {
      M.lipids.params.graze = false;   // (the C12b supply fix, 2026-11-16)
      notes.push('saved before the cells grazed crust: grazing off (as it ran)');
    }
    if (opts.settings !== false && M.excited && !(S.settings && S.settings['excited.params'])) {
      M.excited.params.on = false;   // step C12c
      notes.push('saved before step C12c: excited waste off (as it ran)');
    } else if (M.excited && S.books && S.books.excitedE16 != null && S.books.excitedE16 !== M.excited.table.e16) {
      notes.push(`saved with excited atoms holding ${S.books.excitedE16 / 16}, this page ${M.excited.table.energy} (?exshare=): the energy books will not match`);
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
    if (opts.settings !== false && M.guides && !(S.settings && S.settings['guides.params'])) {
      Object.assign(M.guides.params, { genes: false, glue: false, pump: false, engine: false, div: false, turn: false, push: false, null: false });   // step C13
      notes.push('saved before step C13: field genes, gates and the push gene off (as it ran)');
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
        if (bw < 76) fieldDefaults(new Float32Array(b2.buffer), k * BIO_FLOATS);   // (step C13: the field genes at today's values)
      }
      rec = r2; bio = b2;
    }
    if (opts.settings !== false && M.vents && !(S.settings && S.settings['vents.params'])) {
      Object.assign(M.vents.params, { hot: false, sea: false });   // step C12f
      notes.push('saved before step C12f: the vent as in step C12d (no heat), no sea (as it ran)');
    }
    if (opts.settings !== false && M.ions && !(S.settings && S.settings['ions.params'])) {
      Object.assign(M.ions.params, { block: false, genes: false, volt: false });   // step C12g
      notes.push('saved before step C12g: the bilayer passes ions as before, channel genes off (as it ran)');
    }
    if (opts.settings !== false && M.whole && !(S.settings && S.settings['whole.params'])) {
      Object.assign(M.whole.params, { oilSoap: false, biteBlock: false });   // step M1
      notes.push('saved before step M1: no head on oil inside cells, bites as before (as it ran)');
    }
    if (opts.settings !== false && M.kin && !(S.settings && S.settings['kin.params'])) {
      Object.assign(M.kin.params, { inside: false, channels: false, clock: false, smellTrace: false });   // step T1a
      notes.push('saved before step T1a: no inside, no kin channels, no marker clock, no smell for trace (as it ran)');
    }
    if (opts.settings !== false && M.grn && !(S.settings && S.settings['grn.params'])) {
      M.grn.params.on = false;   // step T1b
      notes.push('saved before step T1b: no gene network (as it ran)');
    }
    if (opts.settings !== false && M.predators && !(S.settings && S.settings['predators.params'])) {
      M.predators.params.on = false;   // step P1
      notes.push('saved before step P1: no engulfing (as it ran)');
    }
    if (opts.settings !== false && M.pigments && !(S.settings && S.settings['pigments.params'])) {
      Object.assign(M.pigments.params, { matter: false, sat: false, inhib: false });   // step N1
      notes.push('saved before step N1: pigments free, no saturation (as it ran)');
    } else if (opts.settings !== false && M.pigments && !('shed' in S.settings['pigments.params'])) {
      M.pigments.params.shed = false;   // (the C12g + N1 merge's follow-up)
      notes.push("saved before the trace shed: a worn pigment's trace goes back into the stock (as it ran)");
    }
    if (opts.settings !== false && M.genome && !(S.settings && S.settings['genome.params'] && 'bSign' in S.settings['genome.params'])) {
      M.genome.params.bSign = 'plus';   // (the C12g + N1 merge's follow-up: new founders, key G, as the page drew them then)
    }
    if (opts.settings !== false && M.water && !(S.settings && S.settings['water.params'])) {
      Object.assign(M.water.params, { caustics: false, currents: false });   // step N1
      notes.push('saved before step N1: no caustic light, no currents (as it ran)');
    }
    if (opts.settings !== false && M.oases && !(S.settings && S.settings['oases.params'])) {
      Object.assign(M.oases.params, { scarce: false, roam: false, count: 0 });   // step N1
      notes.push('saved before step N1: trace from every spring, no oases (as it ran)');
    }
    if (opts.settings !== false && M.glue && !(S.settings && S.settings['glue.params'])) {
      Object.assign(M.glue.params, { ceiling: false, cost: false, tear: false, null: false });   // step G0
      notes.push('saved before step G0: the glue gene capped at 1, no junctions tearing (as it ran)');
    }
    if (opts.settings !== false && M.spindle && !(S.settings && S.settings['spindle.params'])) {
      M.spindle.params.on = false;   // step S1
      notes.push('saved before step S1: round contacts, no elongation (as it ran)');
    }
    if (opts.settings !== false && M.motors && !(S.settings && S.settings['motors.params'])) {
      Object.assign(M.motors.params, { flagella: false, cilia: false, flagellaNull: false, ciliaNull: false });   // step S2
      notes.push('saved before step S2: no flagella, no cilia (as it ran)');
    }
    if (opts.settings !== false && M.mutation && !(S.settings && S.settings['mutation.params'])) {
      Object.assign(M.mutation.params, { scale: 1, rare: false });   // step M2: today's copying (drift x 1), as it ran
    }
    if (opts.settings !== false && M.signals && !(S.settings && S.settings['signals.params'])) {
      M.signals.params.on = false;   // step Q1
      notes.push('saved before step Q1: no signal substance (as it ran)');
    }
    if (opts.settings !== false && M.tendrils && !(S.settings && S.settings['tendrils.params'])) {
      Object.assign(M.tendrils.params, { on: false, null: false, mineral: false, mineralNull: false });   // step T2 (its genes 0 everywhere)
      notes.push('saved before step T2: no tendrils, no bone (as it ran)');
    }
    if (opts.settings !== false && M.contract && !(S.settings && S.settings['contract.params'])) {
      M.contract.params.on = false;   // step L1 (its genes 0 everywhere; off, births draw nothing new for them)
      notes.push('saved before step L1: no contraction (as it ran)');
    }
    if (opts.settings !== false && M.folding && !(S.settings && S.settings['folding.params'])) {
      M.folding.params.on = false;   // step G3
      notes.push('saved before step G3: the gene network with free weights, no lattices (as it ran)');
    }
    if (opts.settings !== false && M.senses && !(S.settings && S.settings['senses.params'])) {
      Object.assign(M.senses.params, { nose: false, taste: false, tasteNull: false, clump: false, armour: false });   // step P3
      notes.push('saved before step P3: the nose as in N2, no taste, no clump test, no shared armour (as it ran)');
    }
    if (opts.settings !== false && M.dup && !(S.settings && S.settings['dup.params'])) {
      Object.assign(M.dup.params, { on: false, null: false });   // step G2
      notes.push('saved before step G2: no gene duplication (as it ran)');
    }
    if (opts.settings !== false && M.flow && !(S.settings && S.settings['flow.params'])) {
      M.flow.params.on = false;   // step N2
      notes.push('saved before step N2: substances flow as in N1 (no gusts, heat not carried, no scour, fixed springs, no chemotaxis gene) (as it ran)');
    }
    if (opts.settings !== false && M.stir && !(S.settings && S.settings['stir.params'])) {
      M.stir.params.on = false;   // step G0
      notes.push('saved before step G0: the cells do not stir the water (as it ran)');
    }
    if (opts.settings !== false && CARBON && M.carbonCells && !(S.settings && S.settings['carbonCells.params'])) {
      M.carbonCells.params.on = false;   // step C15b
      if (M.carbon && !(S.settings && S.settings['carbon.params'])) M.carbon.params.surf = 0;   // (the tar reacted whole, as C15a)
      notes.push('saved before step C15b: the cells blind to carbon, all of the tar reacting (as it ran)');
    }
    // step C15d: one saved before the carbon economy runs on without its fixes (as it ran; the mineral spring's G is fixed for the page:
    // ?cbgspring=0 to match it exactly)
    if (opts.settings !== false && CARBON && M.carbonCells && S.settings && S.settings['carbonCells.params'] && !('shuttle' in S.settings['carbonCells.params'])) {
      Object.assign(M.carbonCells.params, { shuttle: false, granFat: false, hunger: false, wallRecycle: false });
      if (M.carbon && !(S.settings['carbon.params'] && 'hydHeat' in S.settings['carbon.params'])) M.carbon.params.hydHeat = false;
      notes.push('saved before step C15d: no reducing shuttle, no fat from granules, hunger for the body only, walls crack into the mud, mud hydrolyses by light only (as it ran)');
    }
    // step C15f: one saved before carbon life round 3 runs on without its four fixes (as it ran)
    if (opts.settings !== false && CARBON && M.carbonCells && S.settings && S.settings['carbonCells.params'] && !('hydFloor' in S.settings['carbonCells.params'])) {
      Object.assign(M.carbonCells.params, { hydFloor: false, wallCut: false, oilHeld: false, spoilKeep: false });
      notes.push('saved before step C15f: digestion down to an empty battery, wall pairs built from chain carbons, oil for the soap wanted, spoiled pieces into the mud (as it ran)');
    }
    // step C15g: one saved before carbon life round 4 runs on without its three levers (as it ran): idle photons to heat, crawling paid by
    // its free-running speed (any chemistry); founders' bilayers act only at a new culture
    if (opts.settings !== false && S.settings && S.settings['eat.params'] && !('crawlWork' in S.settings['eat.params'])) {
      M.eat.params.crawlWork = false;
      if (CARBON && M.carbonCells) Object.assign(M.carbonCells.params, { idleRed: false, membFound: 0 });
      notes.push('saved before step C15g: the crawl paid by its free-running speed, idle photons to heat (as it ran)');
    }
    if (opts.settings !== false && M.waste && !(S.settings && S.settings['waste.params'])) {
      Object.assign(M.waste.params, { saturation: false, osmosis: false });   // step C12e
      notes.push('saved before step C12e: saturation and osmosis off (as it ran)');
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
    // step C15b: the cells' carbon (a snapshot from before C15b: none, every cell's carbon empty)
    const CBC = CARBON ? C.eat.carbon : null, cbs = CBC && S.cells.carbon ? await unpack(S.cells.carbon) : null;
    const cbo = CBC ? new Uint32Array(n * CB_W) : null;
    const ctl2 = CBC && S.cells.tendrilCarbon ? await unpack(S.cells.tendrilCarbon) : null;   // (step T2)
    if (CBC && !cbs) notes.push('saved before step C15b: the cells hold no carbon');
    const dx = (v.cssW - S.view.cssW) / 2, dy = (v.cssH - S.view.cssH) / 2;
    // (step P1: packed slots renumber the engulfing partners, Cell.eng's bits 16..31 and Cell.engBy's 0..15, by the same map)
    const newOf = new Map();
    for (let k = 0; k < m; k++) newOf.set(idx[k], sameSlots ? idx[k] : k);
    for (let k = 0; k < m; k++) {
      const i = sameSlots ? idx[k] : k, o = i * CELL_FLOATS;
      cu.set(rec.subarray(k * CELL_FLOATS, (k + 1) * CELL_FLOATS), o);
      bu.set(bio.subarray(k * BIO_FLOATS, (k + 1) * BIO_FLOATS), i * BIO_FLOATS);
      su.set(stock.subarray(k * SW, (k + 1) * SW), i * SW);
      if (cbs) { const cw = S.cells.carbonWords || 8; cbo.set(cbs.subarray(k * cw, (k + 1) * cw), i * CB_W); }   // (8: saved before the body)
      if (ctl2 && cbo) cbo[i * CB_W + 23] = ctl2[k];   // (step T2: the tendrils' pool)
      if (!sameView) { cf[o] += dx; cf[o + 1] += dy; }
      if (!sameSlots) {
        cu[o + 60] = cu[o + 61] = cu[o + 62] = 0xffffffff;
        const e = cu[o + 88], b = cu[o + 89];
        if (e & 3) { const pn = newOf.get(e >>> 16); cu[o + 88] = pn == null ? 0 : ((e & 0xffff) | (pn << 16)) >>> 0; }
        if ((b >>> 24) & 3) { const pn = newOf.get(b & 0xffff); cu[o + 89] = pn == null ? 0 : ((b & 0xffff0000) | pn) >>> 0; }
      }
    }
    // step F0: a snapshot from before has fates: every cell's kind (Cell word 8) back to 0 and the fates' words of its genome (Bio 8..15,
    // 20..23: response and relay genes, accumulators; now job state) cleared, so the job colours start undecided and settle in seconds
    if (!S.jobs) {
      for (let k = 0; k < m; k++) {
        const i = sameSlots ? idx[k] : k;
        cu[i * CELL_FLOATS + 8] = 0;
        bu.fill(0, i * BIO_FLOATS + 8, i * BIO_FLOATS + 16);
        bu.fill(0, i * BIO_FLOATS + 20, i * BIO_FLOATS + 24);
      }
      notes.push('saved before step F0: the fates ignored (every cell undecided until its job shows)');
    }
    const q = d.queue;
    q.writeBuffer(C.cellBuf, 0, cu);
    for (const b of C.bioBuf) q.writeBuffer(b, 0, bu);
    q.writeBuffer(C.eat.stockBuf, 0, su);
    if (cbo) q.writeBuffer(CBC.buf, 0, cbo);   // step C15b
    const stats = await unpack(S.stats);
    if (stats.byteLength === C.statsBuf.size) q.writeBuffer(C.statsBuf, 0, stats);
    else if (stats.byteLength < C.statsBuf.size && stats.byteLength >= C.statsBuf.size - 512) q.writeBuffer(C.statsBuf, 0, stats);   // (step C10
    // appended Stats.wall, step C11 widened it, step C13 appended Stats.fg: the counters are in front, the census words behind are refilled
    // every frame)
    else notes.push('stats buffer size differs: counters start from the page\'s');
    if (gridOK) writeGrid(M, await unpack(S.grid.data), S.grid.blocks || ['delta', 'heat', ...SUBSTANCES.slice(0, 13).map((s) => s.name), 'phi']);

    // springs, time, the JS-side state
    M.matter.springs = clone(S.springs || []).map((s) => (sameView ? s : { ...s, x: s.x + dx, y: s.y + dy }));
    if (M.oases) M.oases.adopt();   // step N1: the snapshot's oases roam on (the page's own are gone with its springs)
    if (M.obstacles) M.obstacles.load(S.obstacles || null);   // step G0b: its obstacles (none before G0b)
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
