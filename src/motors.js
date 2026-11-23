// Step S2, FLAGELLA AND CILIA (the user, 2026-11-17: motors as PARTS, the body-plus-parts plan; README "Step S2: flagella and cilia"). Until now
// a cell moved only by crawling (its motor pushes on the dish's floor, the heading's slow wander and the smell steering it) and by drifting with
// the water. Now two motors, each a set of genes, each its own switch:
//
//   FLAGELLUM   a swimmer's motor (Bio.mo.x: its thrust, 0..1 x `swim` R / s). It drives the cell along its FRONT (C10/S1: the body's own
//               direction, inherited, the long axis of a spindle); its SIGN gene (mo.y) says where it sits: > 0 at the back, a PUSHER (as E.
//               coli), < 0 in front, a PULLER (as an alga). At low Reynolds number a swimmer is FORCE-FREE: its motor pushes the water back
//               as hard as its body drags it forward, so it stirs the water (step G0's stirred flow) as a FORCE DIPOLE: a pusher's motor,
//               `arm` R behind it, pushes the water out along its axis; a puller's, in front, draws it in (cell_step.wgsl: the motor's push
//               put down on the stir grid against the body's drag). A swimmer is in the water, not on the floor: it drifts with it by more
//               than a crawler (`swimDrift` of the way from curDrift to wholly, by its thrust) and turns with half the water's vorticity
//               (as a small body in a flow), which is what lets dense pushers stir each other (bacterial turbulence, if it comes).
//               Turning comes from what exists: its front STEERS toward its crawling intention (the heading's slow wander and the smell: the
//               senses a crawler already steers by; `steer` rad / s at full thrust); a motor set off the axis (the PLACEMENT gene, mo.z, x 90
//               degrees round the pole) turns it by the thrust's torque (r x F over the rotational drag): curved runs, circles
//   CILIA       short beaters on the FREE sides (touching no neighbour; Bio.mo.w: their beat, 0..1). Each free side pushes the water along the
//               surface, straight back along the front (or tilted round the body by the TILT gene mc.y: a ciliated cell then spins), x (1 +
//               cos phase), and by reaction the cell forward: a free cell swims (half of `ciliaPush` R / s with all six sides beating), a cell
//               held in a tissue pumps the water past itself (a shared good: the water carries food). Each cell's beat has a PHASE (Bio.mc.z,
//               state, inherited) running at `beatHz` (each cell 0.9..1.1 x); the COUPLING gene (mc.x, -1..1) pulls it toward its touching
//               ciliated neighbours' phases less a LAG (the time the beat's push takes through the water to reach a neighbour downstream:
//               `lag` rad per R along the stroke), Kuramoto-like, so a sheet's edge can settle into a METACHRONAL wave (as airway cilia)
//   GENE NETWORK the 19th and 20th outputs (FLAGELLUM, CILIA: gains Bio.mg.x, mg.z, regulators mg.y, mg.w) scale the genes, so the same DNA
//               can grow cilia at a tissue's edge (the network senses its contacts) and none inside
//   COST        the battery pays (Cell.pay, as heat): the swim `swimCost` x crawlCost per unit of its work (as crawling), the cilia an upkeep
//               per beat (`ciliaUp` energy per s at beat 1 on six free sides); the battery's gate scales them (an empty battery cannot beat).
//               The motors' work on the cell is booked as every force's; the stirred water's push on other cells comes out of the heat under
//               them (step G0), and the stirred flow fades into heat. The MOTOR PROTEINS are built in carbon: they are enzymes (ATPases, which
//               turn the battery's energy into motion: catalysis), so the same recipe as an engine's (C15c: 4 carbons + 1 G, the heavy giver,
//               whose loose electron catalysis moves) in the same pool, worn and renewed alike: a full flagellum wants `flagWant` units of
//               expressed engine rate's enzymes, full cilia on six free sides `ciliaWant` (cell_eat.wgsl; the pool's share held, Cell.motE,
//               drives the motors). Without carbon (?carbon=0) only the battery pays
//   CONTROLS    ?flagella=0 ?cilia=0: off (exactly as before S2: the genes never mutate, nothing acts); ?flagellanull=1 ?cilianull=1 the
//               NEUTRAL controls (the genes drift as when on, nothing acts, nothing is paid); part switches ?mogrn=0 ?mowater=0 ?modipole=0
//               ?mopump=0 ?mocouple=0 ?mosteer=0 ?motorque=0; knobs ?swim= ?steer= ?arm= ?dipole= ?swimdrift= ?ciliapush= ?beathz= ?couple=
//               ?lag= ?swimcost= ?ciliaup= ?flagwant= ?ciliawant=
//
// Census (Stats.s2, cell_common.wgsl S2S_*; every frame): carriers, swimmers and their speed (and relative to the water), the pusher share,
// cilia carriers and beating cells, their free sides, the local WAVE order (|mean of e^i(phi_j - phi_i - lag)| over touching beating
// neighbours: 1 a perfect metachronal wave by the lag, 0 random) and SYNC (the same without the lag), the dish's global sync, the genes'
// means, the cost; the MOTORS panel line; moire.motors.census() (the last), moire.motors.now() (a read-back: where the carriers are: open
// water or near walls, alone or in tissue).

import { loadFieldShader } from './field.js';
import { CELL_FLOATS } from './cells.js';
import { BIO_FLOATS } from './genome.js';
import { readBuffer } from './snapshot.js';

export const STATS_S2 = 9472;     // byte offset of Stats.s2 in struct Stats (cell_common.wgsl)
export const S2_WORDS = 32;
export const BIO_S2 = 168;        // the motor genes' first word (Bio.mo; Bio.mc at 172, Bio.mg at 176)
export const MO = { FLAG: 1, FNULL: 2, CIL: 4, CNULL: 8, GRN: 16, WATER: 32, DIPOLE: 64, PUMP: 128, COUPLE: 256, STEER: 512, TORQUE: 1024 };
const MD_BYTES = 208;             // struct MotorDraw (motor_draw.wgsl)
const C_FLAGS = 9, C_MOTW = 93;

export class Motors {
  constructor(cells) {
    this.cells = cells;
    // live-tunable (moire.motors.params); the rules panel's group "Flagella and cilia (step S2)"
    this.params = {
      flagella: true,    // flagella act (?flagella=0: off, exactly as before S2)
      flagellaNull: false,   // ... their NEUTRAL control (?flagellanull=1): the genes drift, nothing acts, nothing is paid
      cilia: true,       // cilia act (?cilia=0)
      ciliaNull: false,  // ... their NEUTRAL control (?cilianull=1)
      grn: true,         // the gene network's 19th and 20th outputs scale the genes (?mogrn=0)
      water: true,       // a swimmer is free in the water: it drifts with it and turns with its vorticity (?mowater=0)
      dipole: true,      // a swimmer's motor pushes the water back: the force dipole (?modipole=0)
      pump: true,        // the cilia push the water along the surface (?mopump=0)
      couple: true,      // the beats' phases couple to touching neighbours' (?mocouple=0)
      steer: true,       // a swimmer's front steers toward its crawling intention (?mosteer=0)
      torque: true,      // an off-axis flagellum and tilted cilia turn the cell (?motorque=0)
      swim: 3,           // R / s at flagellum 1 (?swim=; crawling is 0.6)
      steerRate: 0.6,    // rad / s at full thrust (?steer=)
      arm: 1.5,          // R: the thrust's point behind a pusher's centre (before a puller's) (?arm=)
      dipole: 1,         // the motor's push on the water x the body's drag (1 = force-free) (?dipole=)
      swimDrift: 0.7,    // a full swimmer drifts with the water this far from curDrift to wholly (?swimdrift=)
      ciliaPush: 2,      // R / s at cilia 1 (a free cell with six beating sides swims at half of it) (?ciliapush=)
      beatHz: 1.5,       // the beat's frequency (Hz) (?beathz=)
      coupleRate: 4,     // rad / s at coupling 1 (?couple=)
      lag: 1,            // rad per R along the stroke: the metachronal wave's (?lag=; 0 = in step)
      swimCost: 0.15,    // the swim's battery cost per unit of its work, x crawlCost (?swimcost=; at 1, the crawl's own rate, a dish of full
                         // swimmers emptied every battery within 15 s: a full flagellum now costs about half an engine's upkeep)
      ciliaUp: 0.004,    // energy per s at beat 1 on six free sides (?ciliaup=)
      flagWant: 2,       // the motor proteins a full flagellum wants (units of expressed engine rate's enzymes) (?flagwant=)
      ciliaWant: 1.5,    // ... full cilia on six free sides (?ciliawant=)
      censusEvery: 10,   // s of simulated time between the place census's read-backs (0: never) (?mocensus=)
    };
    // the look (moire.motors.look)
    this.look = {
      on: true,          // draw the motors (?modraw=0)
      segs: 8,           // segments per flagellum (the cheap path: 5)
      hairs: 3,          // hairs per free side (the cheap path: 1)
      length: 2.6,       // a flagellum's length at full thrust (R)
      hair: 0.5,         // a hair's length (R)
      amp: 0.28,         // the flagellum wave's amplitude (R)
      waves: 1.4,        // ... wavelengths along it
      beats: 3,          // ... beats per s at full thrust (simulated time)
      swing: 0.7,        // a hair's swing (rad)
      tube: 1.1,         // the tube's half-width (CSS px)
      bright: 0.9,
      ciliaBright: 0.7,
    };
    this.census = null;
    this.series = [];    // [time, carriers, swimmers, speed, pushers, cilia carriers, beating, wave, sync, flag gene, cilia gene]
    this.place = null;   // the place census (now())
    this.busy = false;
    this.lastAt = -1e9;
    this.pipe = null;
  }

  get flagOn() { return !!this.params.flagella; }
  get ciliaOn() { return !!this.params.cilia; }

  /** The MO_* bits (Fields.mo0.x, EatP.g2.y): 0 while both motors are off. */
  bits() {
    const p = this.params;
    if (!p.flagella && !p.cilia) return 0;
    const grnActs = !!(this.cells.grn && this.cells.grn.acts);
    const stir = !!(this.cells.stir && this.cells.stir.on);
    return (p.flagella ? MO.FLAG : 0) | (p.flagella && p.flagellaNull ? MO.FNULL : 0) | (p.cilia ? MO.CIL : 0) | (p.cilia && p.ciliaNull ? MO.CNULL : 0) |
      (p.grn && grnActs ? MO.GRN : 0) | (p.water ? MO.WATER : 0) | (p.dipole && stir ? MO.DIPOLE : 0) | (p.pump && stir ? MO.PUMP : 0) |
      (p.couple ? MO.COUPLE : 0) | (p.steer ? MO.STEER : 0) | (p.torque ? MO.TORQUE : 0);
  }
  /** Whether either motor acts (not off, not its neutral control). */
  get acts() { const p = this.params; return (p.flagella && !p.flagellaNull) || (p.cilia && !p.ciliaNull); }

  /** The step's words (struct Fields mo0..mo2, from word o). */
  writeFields(u, f, o) {
    const p = this.params, n = (x, lo = 0) => Math.max(lo, Number(x) || 0);
    u[o] = this.bits(); f[o + 1] = n(p.swim); f[o + 2] = n(p.steerRate); f[o + 3] = n(p.arm);
    f[o + 4] = n(p.dipole); f[o + 5] = Math.min(1, n(p.swimDrift)); f[o + 6] = n(p.ciliaPush); f[o + 7] = Math.min(10, n(p.beatHz));
    f[o + 8] = n(p.coupleRate); f[o + 9] = Number(p.lag) || 0; f[o + 10] = n(p.swimCost); f[o + 11] = n(p.ciliaUp);
  }
  /** The eat pass's words (struct EatP g2.y..w, from word o = g2's first): the bits, the motor proteins' want. */
  writeEat(u, f, o) {
    const p = this.params, b = this.bits();
    u[o + 1] = b; f[o + 2] = b ? Math.max(0, p.flagWant) : 0; f[o + 3] = b ? Math.max(0, p.ciliaWant) : 0;
  }

  // ---------------------------------------------------------------- the census
  /** The cells' stats read-back (Stats.s2, u32 words). */
  apply(time, w) {
    const s = new Int32Array(w.buffer, w.byteOffset, w.length);
    const n = w[0], m = Math.max(1, n), sw = w[4], beat = w[10], wn = w[14], mc = w[25];
    const fg = w[2] / 1000 / m, fg2 = w[3] / 1000 / m, cg = w[8] / 1000 / m, cg2 = w[9] / 1000 / m;
    this.census = {
      time, n, carriers: w[1], flagGene: fg, flagSd: Math.sqrt(Math.max(0, fg2 - fg * fg)), flagExpr: w[26] / 1000 / m,
      swimmers: sw, speed: sw ? w[5] / 1000 / sw : 0, relSpeed: sw ? w[24] / 1000 / sw : 0, turning: sw ? w[23] / 1000 / sw : 0, open: w[28],
      pushers: w[6], pusherShare: w[1] ? w[6] / w[1] : 0, sign: s[22] / 1000 / m, placement: w[16] / 1000 / m,
      ciliaCarriers: w[7], ciliaGene: cg, ciliaSd: Math.sqrt(Math.max(0, cg2 - cg * cg)), ciliaExpr: w[27] / 1000 / m,
      beating: beat, freeSides: beat ? w[11] / beat : 0, waveN: wn, wave: wn ? w[12] / 1000 / wn : 0, sync: wn ? w[13] / 1000 / wn : 0,
      globalSync: beat ? Math.hypot(s[20], s[21]) / 1000 / beat : 0, coupling: s[15] / 1000 / m, tilt: w[17] / 1000 / m,
      motorShare: mc ? w[19] / 1000 / mc : 1, payPerTick: s[18] / 4096,
    };
    const S = this.series, last = S[S.length - 1];
    if (last && time < last[0]) S.length = 0;
    if (n && (!S.length || time - S[S.length - 1][0] >= 30)) {
      const C = this.census;
      S.push([time, C.carriers, C.swimmers, C.speed, C.pusherShare, C.ciliaCarriers, C.beating, C.wave, C.sync, C.flagGene, C.ciliaGene]);
      if (S.length > 400) S.shift();
    }
  }

  /** Once a frame: start the place census's read-back when it is due. */
  maybeCensus(time) {
    const every = this.params.censusEvery;
    if (!(every > 0) || this.busy || (time - this.lastAt < every && time >= this.lastAt)) return;
    if (!this.acts && !this.params.flagellaNull && !this.params.ciliaNull) return;
    this.lastAt = time;
    this.read(time).catch((e) => { console.warn('motors census:', e); });
  }
  /** The last census (the panel's numbers, every frame). */
  last() { return this.census; }
  /** A fresh read-back of WHERE the motors are (open water or near walls, alone or in tissue; also moire.motors.now()). */
  now() { return this.read(this.lastAt); }

  async read(time = this.lastAt) {
    if (this.busy) return this.place;
    this.busy = true;
    try {
      const C = this.cells, d = C.device, n = C.count;
      const [bioAB, cellAB] = await Promise.all([readBuffer(d, C.bioBuf[C.bioCur], 0, n * BIO_FLOATS * 4), readBuffer(d, C.cellBuf, 0, n * CELL_FLOATS * 4)]);
      const g = new Float32Array(bioAB), f = new Float32Array(cellAB), u = new Uint32Array(cellAB), R = C.R;
      const O = C.obstacles && C.obstacles.active && C.obstacles.n ? C.obstacles : null;
      const zone = () => ({ n: 0, flag: 0, cil: 0, swim: 0, beat: 0, speed: 0 });
      const Z = { open: zone(), wall: zone(), alone: zone(), tissue: zone(), all: zone() };
      for (let i = 0; i < n; i++) {
        const o = i * CELL_FLOATS;
        if (!(u[o + C_FLAGS] & 1)) continue;
        const b = i * BIO_FLOATS + BIO_S2, mw = u[o + C_MOTW];
        const fl = g[b] || 0, ci = g[b + 3] || 0, sw = (mw & 255) / 255, be = ((mw >> 8) & 255) / 255;
        const free = (mw >>> 16) & 63, nfree = free ? [0, 1, 2, 3, 4, 5].filter((k) => (free >> k) & 1).length : -1;
        const sp = Math.hypot(f[o + 2], f[o + 3]) / R;
        const add = (z) => { z.n++; z.flag += fl; z.cil += ci; if (sw >= 0.05) z.swim++; if (be >= 0.05 && nfree > 0) z.beat++; z.speed += sp; };
        add(Z.all);
        if (O) add(O.sdAt(f[o], f[o + 1]) < 3 * R ? Z.wall : Z.open);
        // alone or in tissue: by the motors' own touch word (bits 16..21 hold the free sides while the cilia act); else the panel's contact
        if (nfree === 6) add(Z.alone); else if (nfree >= 0) add(Z.tissue);
      }
      const out = { time };
      for (const [k, z] of Object.entries(Z)) {
        if (!z.n) { out[k] = { n: 0 }; continue; }
        out[k] = { n: z.n, flagGene: z.flag / z.n, ciliaGene: z.cil / z.n, swimShare: z.swim / z.n, beatShare: z.beat / z.n, speed: z.speed / z.n };
      }
      out.walls = !!O;
      this.place = out;
      return out;
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------------- the drawing
  async init(device, format, pre) {
    const d = device;
    const mod = await loadFieldShader(d, 'src/shaders/motor_draw.wgsl', pre);
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    this.pipe = d.createRenderPipeline({
      label: 'motors draw', layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uBuf = d.createBuffer({ label: 'motors draw params', size: MD_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uAB = new ArrayBuffer(MD_BYTES);
    this.device = d;
    this.bgs = null;
  }
  /** (Re)make the bind groups (after the cells' buffers were made). */
  bind() {
    const C = this.cells;
    if (!this.pipe || !C.cellBuf) return;
    this.bgs = C.bioBuf.map((bio) => this.device.createBindGroup({
      label: 'motors draw', layout: this.pipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uBuf } }, { binding: 1, resource: { buffer: C.cellBuf } }, { binding: 2, resource: { buffer: bio } }],
    }));
    this.boundTo = C.cellBuf;
  }
  /** Draw the flagella and cilia into the cells' pass (before the cells: a body covers its flagellum's root). */
  render(pass, { view, cam, zoom, neon, harmonic, time, palette, cheap }) {
    const L = this.look, C = this.cells;
    if (!this.pipe || !L.on || (!this.params.flagella && !this.params.cilia) || (!this.acts)) return;
    if (!this.bgs || this.boundTo !== C.cellBuf) this.bind();
    if (!this.bgs) return;
    const a = new Float32Array(this.uAB);
    a[0] = view.cssW / zoom; a[1] = view.cssH / zoom; a[2] = view.dpr * zoom; a[3] = C.R;
    a[4] = cam[0]; a[5] = cam[1]; a[6] = cam[2] || zoom; a[7] = 0;
    const NS = Math.max(2, Math.min(16, Math.round(cheap ? Math.min(5, L.segs) : L.segs)));
    const HPS = Math.max(1, Math.min(4, Math.round(cheap ? 1 : L.hairs)));
    a[8] = harmonic ? 2 : neon ? 1 : 0; a[9] = time % 3600; a[10] = Math.max(0.3, L.tube) / Math.sqrt(Math.max(1, zoom));   // (CSS px of the dish: on screen it widens with sqrt(zoom), as the rims)
    a[11] = L.bright;
    a[12] = NS; a[13] = HPS; a[14] = L.length; a[15] = L.hair;
    a[16] = L.amp; a[17] = L.waves; a[18] = L.beats; a[19] = L.swing;
    const hi = palette && palette.harm ? palette.harm.green : [70, 255, 60];   // (the harmonic look: thin green filaments, as the interfaces)
    a[20] = hi[0] / 255; a[21] = hi[1] / 255; a[22] = hi[2] / 255; a[23] = L.ciliaBright;
    const job = palette && palette.job ? palette.job : [];
    job.forEach((ink, j) => { for (let k = 0; k < 3; k++) a[24 + 4 * j + k] = ink[k] / 255; });
    this.device.queue.writeBuffer(this.uBuf, 0, this.uAB);
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.bgs[C.bioCur]);
    pass.draw(2 * NS * 6 + 6 * HPS * 6, C.count);
  }

  // ---------------------------------------------------------------- words
  panelLine(compact = false) {
    const p = this.params, C = this.census, pct = (x) => `${Math.round(100 * x)}%`;
    if (!p.flagella && !p.cilia) return 'MOTORS  off';
    if (!C || !C.n) return 'MOTORS  …';
    const fl = !p.flagella ? 'flagella off' : `${p.flagellaNull ? 'NULL ' : ''}flagella ${C.carriers} (gene ${C.flagGene.toFixed(2)}) · ${C.swimmers} swim ${C.speed.toFixed(2)} R/s · pushers ${pct(C.pusherShare)}`;
    const ci = !p.cilia ? 'cilia off' : `${p.ciliaNull ? 'NULL ' : ''}cilia ${C.ciliaCarriers} (gene ${C.ciliaGene.toFixed(2)}) · ${C.beating} beat on ${C.freeSides.toFixed(1)} free sides · wave ${C.wave.toFixed(2)} sync ${C.sync.toFixed(2)}`;
    if (compact) return `MOTORS ${C.carriers}/${C.swimmers} swim · cilia ${C.ciliaCarriers}/${C.beating} · wave ${C.wave.toFixed(2)}`;
    return `MOTORS  ${fl} · ${ci}`;
  }

  overlayLines() {
    const p = this.params, C = this.census, on = (x) => (x ? 'on' : 'off');
    const lines = [`flagella and cilia (step S2): flagella ${on(p.flagella)}${p.flagellaNull ? ' (NULL)' : ''}, cilia ${on(p.cilia)}${p.ciliaNull ? ' (NULL)' : ''} · gene network ${on(p.grn)} · in the water ${on(p.water)} (drift ${p.swimDrift}) · dipole ${on(p.dipole)} x${p.dipole} at ${p.arm} R · pump ${on(p.pump)} · coupling ${on(p.couple)} (${p.coupleRate} rad/s, lag ${p.lag} rad/R) · steer ${on(p.steer)} (${p.steerRate} rad/s) · torque ${on(p.torque)}` +
      ` · swim ${p.swim} R/s, cilia ${p.ciliaPush} R/s at ${p.beatHz} Hz · cost: swim x${p.swimCost} crawl, cilia ${p.ciliaUp}/s · proteins: flagellum ${p.flagWant}, cilia ${p.ciliaWant}`];
    if (C && C.n) {
      lines.push(`motors: ${C.n} cells · flagellum gene ${C.flagGene.toFixed(3)} ± ${C.flagSd.toFixed(3)} (expressed ${C.flagExpr.toFixed(3)}), carriers ${C.carriers}, swimmers ${C.swimmers} (${C.open} in open water) at ${C.speed.toFixed(2)} R/s (vs water ${C.relSpeed.toFixed(2)}), turning ${C.turning.toFixed(2)} rad/s, pushers ${(100 * C.pusherShare).toFixed(0)}% (sign ${C.sign.toFixed(2)}), |placement| ${C.placement.toFixed(2)}` +
        ` · cilia gene ${C.ciliaGene.toFixed(3)} ± ${C.ciliaSd.toFixed(3)}, carriers ${C.ciliaCarriers}, beating ${C.beating} on ${C.freeSides.toFixed(2)} free sides, wave ${C.wave.toFixed(3)} sync ${C.sync.toFixed(3)} (${C.waveN} with neighbours), global ${C.globalSync.toFixed(3)}, coupling ${C.coupling.toFixed(3)}, |tilt| ${C.tilt.toFixed(2)}` +
        ` · motor share ${C.motorShare.toFixed(2)} · cost ${C.payPerTick.toFixed(4)} a tick`);
      const S = this.series.slice(-6);
      if (S.length) lines.push(`motors every 30 s (carriers, swimmers, cilia, beating, wave): ${S.map((x) => `${x[0].toFixed(0)}s ${x[1]} ${x[2]} ${x[5]} ${x[6]} ${x[7].toFixed(2)}`).join(' · ')}`);
    }
    return lines;
  }
}
