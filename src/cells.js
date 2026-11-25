// The cells: all state on the GPU.
//
// State: one storage buffer of struct Cell (cell_common.wgsl, 256 bytes each), in a fixed order: index i is
// always the same cell, which keeps the drawing order stable.
// Step C9: the buffers hold a fixed CAPACITY of slots (`count`; ?cap=N, default 3 x the starting number `start`); a slot is a
// live cell while its flags have ALIVE. In the division mode (src/division.js) cells divide into free slots and die for
// good, so the number alive (`alive`, from the census read-back) rises and falls; the turnover mode keeps it fixed.
// Drawing: instanced quads (cell_draw.wgsl), crisp discs with an outline and the cell's lattice as dots; step C6n: under
// the neon look, bright tubes with a dark inside, and the hum (cell_glow.wgsl: each cell's activity, drawing only).
//
// Neighbour grid (cell_grid.wgsl), rebuilt every tick on the GPU: a counting sort by grid cell.
//   counts[g]  cells in grid cell g;  starts[g]  first slot of g in the sorted list;
//   sorted[j]  copy of the cells in grid order;  sortIdx[j]  that cell's index in `cells`.
// Grid cells are params.range x R wide (CSS px), so all contacts lie in the 3 x 3 block around a cell.
// A pass that needs neighbours binds sim (dynamic offset), counts, starts, sorted and sortIdx, and loops as
// cell_check.wgsl does. Per tick: clear counts, then count, scan_local, scan_top, scan_add, scatter.
//
// Per-tick uniforms (struct Sim) sit in slots 256 bytes apart in one buffer, bound with a dynamic offset, so
// several ticks in one frame each get their own tick number.
//
// The loop (step 4): in the grid's scatter pass every cell also works out its beat against the medium
// (struct CellBeat, cell_common.wgsl) into `beats`, in sorted order. The cells' field is drawn by scattering:
// each cell adds its beat x envelope over a quad into a half-resolution rgba16float texture (cell_field.wgsl),
// which the landscape's halftone dots read.
//
// Field B (step 5): a second, separate field in its own lattice band (every lattice bBand times longer, so it
// makes no slow beat with field A), with a longer reach and its own sign rule. Its beat rides along in the
// same CellBeat; it is scattered into the texture's G channel. Every cell has a charge per field (`fields`,
// uniform struct Fields, written once per frame).
//
// Size: the cells' radius R is the reference's R (from the screen area, 5 to 9 CSS px), but smaller when
// that many cells would not fit in a round blob of about 0.8 x the dish height (so 10 000 or 50 000 cells
// get smaller). See `fitR`.
//
// URL: ?cells=N  number of cells at the start (default 2000); step C9: ?cap=N the capacity (default 3 x that)
//      ?check=1  every 2 s, compare the grid's contacts with a brute-force count (console and overlay)

import { loadFieldShader, KIND } from './field.js';
import { computePipe, renderPipe, allPipes } from './gpu.js';   // step SP1: async pipelines
import { Genome, BIO_BYTES } from './genome.js';
import { Heat, HEAT_COMMON_URL } from './heat.js';
import { Eat } from './eat.js';
import { ALL_ENGINES as ENGINES, SUBSTANCES } from './matter.js';   // (step C15b: the parts' kinds include the carbon engines)
import { JOBS } from './jobs.js';   // step F0: colour by job (also writes the engines' job classes into the shaders)
import { pal } from './palette.js';
import { Dipole, STATS_DIP, DIP_WORDS } from './dipole.js';
import { Division, STATS_DIV, STATS_CLAIM, DIV_SNAP } from './division.js';
import { Walls, STATS_WALL, WALL_WORDS } from './walls.js';
import { Guides, STATS_FG, FG_WORDS, FG_CLEAR } from './guides.js';
import { Kin } from './kin.js';
import { Grn } from './grn.js';
import { Predators, STATS_P1, P1_WORDS, P1_CLEAR } from './predators.js';
import { Glue, STATS_G0, G0_WORDS, G0_CLEAR } from './glue.js';
import { Spindle, STATS_S1, S1_WORDS } from './spindle.js';
import { Fidelity } from './fidelity.js';
import { Dup } from './dup.js';
import { Mutation } from './mutation.js';
import { Motors, STATS_S2, S2_WORDS } from './motors.js';
import { Senses } from './senses.js';
import { Folding } from './folding.js';
import { Signals } from './signals.js';
import { Contract } from './contract.js';
import { Tendrils } from './tendrils.js';   // step T2: tendrils and bone
import { Inspect } from './inspect.js';     // step I1: the cell inspector (read-only: a family tree, what engines ran, the card)
import { camera } from './camera.js';   // app: the view camera (drawing only)
import { dish } from './dish.js';      // the dish's own size and R
import { cultureLayout } from './culture.js';   // app: how a new culture is spread
import { lod, LOD_URL } from './lod.js';   // step V1: LOD from band limits (drawing only)

export const CELL_URL = 'src/shaders/cell_common.wgsl';

// struct Cell in cell_common.wgsl: pos.xy, vel.xy, r, la, e1, e2, kind (u32), flags (u32), seed (u32), aux, z.xy;
// step C5: dead.xy, bat, pay (i32), mom (u32), fill, smell.xy; step C6b: q, qNet, efield.xy (CELL_FLOATS in heat.wgsl too);
// step C6c, the honeycomb outline (words 26..59): rad[6] (26), radV[6] (32), theta (38), spin (39), ea.xy (40), alpha[6] (42),
// and per side: integ[6] (48, membrane chemistry), sideQ[6] (54, step C6d: each side's charge); step C7: nbr[3] (60: the touching
// neighbour across each side, 16 bits each), volt (63: the membrane voltage); step C10, patterned walls (src/walls.js): front (64),
// mature[3] (65: each side's junction maturity, 16 bits), wadh[2] (68: each side's effective adhesion, 8 bits), wlink (70), wpay (71);
// step C12b, lipid membranes (src/lipids.js): lip[6] (72: per side, 4 x 8 bits: stiffness, the wall's heavy share, oil share, wall cover);
// step C13, fields as genes and guides (src/guides.js): fg[4] (78: the field genes the beat needs, f16 deltas), felt[2] (82: what each side felt)
// step C12e, osmosis on the ions (src/waste.js): osm (84: the swelling), osmP (85: the osmotic pressure); step T1b:
// sns0, sns1 (86, 87: the senses the eat pass hands the gene network, 4 x 8 bits each; spare until T1b); step P1, predators (src/predators.js):
// eng (88: what it engulfs, how far), engBy (89: who wraps it, or the host of the meal its dead slot holds), hold (90), engPay (91); step S2,
// flagella and cilia (src/motors.js): motE (92: the motors' share of their motor proteins), motW (93: what the motors did, the free sides); step P3,
// cells that sense cells (src/senses.js): taste (94, 95: the low-passed taste the step steers by)
export const CELL_FLOATS = 96;
export const CELL_BYTES = CELL_FLOATS * 4;
const CELL_CORE_BYTES = 120;   // step C6c: struct CellCore (the grid's sorted copy: Cell without the outline and per-side slots;
                               // step C6d: + the dipole, 104 until then; step C10: + the walls, 112 until then)
const ALIVE = 1;

export const DEFAULT_CELLS = 2000;
export const MAX_CELLS = 262144;

const SIM_BYTES = 256;         // struct Sim
const SLOT = 256;              // uniform slot stride (minUniformBufferOffsetAlignment is at most 256)
const SLOTS = 320;             // ticks that can be encoded in one frame (main.js runs at most 256, plus warm-up)
const BLOCK = 512;             // scan block (cell_grid.wgsl)
const BRUTE_MAX = 20000;       // largest count the ?check brute force runs on
const STATS_BYTES = 9600;      // struct Stats in cell_common.wgsl (step S2: + s2, 32 words; step S1: + s1, 16 words; step G0: + g0, 32 words; step P1: + p1, 64 words; step C13: + fg, 64 words; counters, events, census, step 6 census; step C6d: + dip;
                               // step C9: + div, claim; step C10: + wall; step C11: wall 24 -> 32 words)
const STATS_EXTRA = 8192;      // byte offset of Stats.extra (step 6 census: STATS_X_* in cell_common.wgsl)
const STATS_CENSUS = 1088;     // byte offset of the key bins (then the founder bitmap) in struct Stats
const STATS_EVENTS = 64;
const A_BIN = 0.2;             // width of the A-felt histogram's bins (STATS_X_AW in cell_common.wgsl)
const CELL_BEAT_BYTES = 128;   // struct CellBeat in cell_common.wgsl
const FIELDS_BYTES = 672;      // struct Fields in cell_common.wgsl (step P3: + p3a, p3b, 640 until then; step S2: + mo0..mo2, 592 until then; step G2: + g2, 576 until then; step G0b: + ob0, 560 until then; step G0: + g0a..g0c; step P1: + p1..p1d; step T1a: + t1; step C13: + fg0; step C6c: + memb; step C6d: + dip0..dip2; step C8: + hm;
                               // step C9: + dv0..dv2; step C10: + wl0, wl1)
const FIELD_FORMAT = 'rgba16float';
const DRAW_BYTES = 1552;       // struct Draw in cell_draw.wgsl (step V1: + lod, lod2, lodL, lod3, 1488 until then; step Q1: + q1, 1472 until then; step G3: + g3, g3Ink[2], 1424 until then; step F0: + job[7], 1312 until then; step P1: + p1, p1Ink; step T1b: + grn, grnInk, grnInkH, 1232 until then; step T1a: + kin, 1216 until then; step H1: + harm, harm2, harm3, harm4, hInk[5] after cam, 1072 until then; app: + cam, 1056 until then; step C13: + gd, gdInk[6]; step C12b: + lip, lip2, lipInk[3]; step C10: + wall, wall2, wallInk[4]; step C9: + div; step C7: + pump, pump2, pumpInk[13]); (step C6b: + the charge view's inks; step C6c: + the honeycomb, the membrane;
                               // step C6d: + the dipoles)
export const ANCHORS = ['sliding moire (reference)', 'pinned to the cell', 'still in the world'];

export class Cells {
  constructor(device, format, medium, count, seed, cap = 0) {
    this.device = device;
    this.genome = new Genome(seed);
    this.format = format;
    this.medium = medium;
    // step C9: `start` cells at a new culture, in buffers of `count` slots (the capacity); `alive` from the census read-back
    this.start = Math.max(1, Math.min(MAX_CELLS, Math.round(count) || DEFAULT_CELLS));
    this.count = Math.max(this.start, Math.min(MAX_CELLS, Math.round(cap) || 3 * this.start));
    this.alive = this.start;
    this.R = 9;
    this.view = null;
    this.tick = 0;
    this.grid = { gw: 0, gh: 0, cs: 1, n: 0, cap: 0 };
    this.checkOn = false;
    this.checkResult = null;   // last ?check result, for the overlay
    this.pointer = { drag: false, x: 0, y: 0, vx: 0, vy: 0 };   // stirring (see stir)
    this.timing = null;        // per-tick GPU time of the grid and the physics, from probe()
    this.warm = 0;             // ticks still to run at once after a reset (the reference pre-steps 200)
    // physics (live-tunable: moire.cells.params); forces are in CSS px / s, as in the reference
    this.params = {
      contact: true,  // soft contact push on/off (key P)
      stiffness: 7,   // contact push per px of overlap (reference KR = 7)
      damping: 0.85,  // velocity kept per tick (reference: v = 0.85 v + 0.15 F)
      jitter: 0.05,   // Brownian kick per tick, full width, in units of R (reference: 0.05)
      squeeze: 0.25,  // pull to the dish centre, set as the overlap it would cause in the blob's middle
                      // (scaled by the count, so 50 000 cells are squeezed no harder than 2000)
      wall: 2,        // soft wall stiffness (reference)
      drift: 0.15,    // slow drift of the medium, in units of R / s (reference 0.5, which tears a blob without
                      // adhesion; 0 = still)
      warmup: 180,    // ticks run at once after a reset, so a new culture starts settled
      stir: 0.5,      // how strongly a drag pushes cells along (reference 0.5)
      stirReach: 110, // how far from the pointer a drag reaches (CSS px; reference sqrt(12000))
      range: 3.0,     // smallest grid cell size in units of R (must be >= the largest contact range: reach x 2 r,
                      // with r up to about 1.3 R for big cells); the grid is at least `cut` wide too
      // the loop (step 4)
      emit: true,     // cells emit into the field (key O)
      lever: 0.4,     // how different the cells' lattices are from the medium's (keys - and =): scales each
                      // key's angle and period difference from the medium (1 = as the genome has it; smaller =
                      // longer beats, so bigger clusters)
      r0: 2.2,        // a cell's envelope range, in units of R (reference: r0^2 = 4.84 R^2)
      cut: 3.6,       // how far a cell's field reaches (sensed and drawn), in units of R (reference 3.6)
      sense: 10,      // gain of the force from the other cells' field felt on the membrane (1 = reference, which
                      // is too weak to matter against the contact push at 2000 cells)
      senseOn: true,  // field sensing on/off (key S)
      receptor: false, // tuning toward other cells by the genome's receptor instead of the own lattice (key R)
      tuneW: 0.5,     // tuning width toward other cells' lattices (reference 0.177: only near-identical keys)
      senseMax: 3.0,  // the field force saturates at this speed (R / s; reference 3)
      active: true,   // active deformation (key W): stretch along the motion and the field's pull
      shapeRate: 3,   // how fast the shape follows its target (1/s; reference 3)
      anchor: 1,      // where a cell's beat is anchored (key X): 0 = its lattice at the cell, the moire sliding as
                      // it moves (reference); 1 = the beat pinned to the cell, bright at its centre; 2 = its
                      // lattice anchored at the dish centre, the moire standing still in the world
    };
    // step C6c, elastic honeycomb cells (live-tunable: moire.cells.shape). The outline is 6 corners, each an underdamped
    // spring toward its rest place (the hexagon at the rest area on the active stretch's ellipse); a touching neighbour's
    // wall (the power-diagram line between the two centres) stops the corners facing it, so packed cells share straight
    // walls, and the hexagon turns so a side faces each neighbour. Kinematic: the shape never pushes a cell (the contact
    // push still keeps the centres apart), so it is outside the energy books
    this.shape = {
      on: true,       // honeycomb shapes (rules panel; ?honeycomb=0): off = the ellipse cells of steps 4 to C6b
      stiffness: 1,   // the corners' spring, x the default (panel - and +): 1 = a wobble of wobbleHz
      wobbleHz: 1.6,  // the corners' own wobble at stiffness 1 (Hz)
      zeta: 0.35,     // their damping ratio (1 = no overshoot; 0.35: a pushed cell wobbles about twice, settled in ~0.8 s)
      size: 1,        // the rest area, x pi r^2 (the ellipse cell's area)
      bulge: 1.5,     // how far free corners may grow (x their rest distance) to keep the area when sides are pressed flat
      snap: 1.5,      // a neighbour's wall up to this x a corner's rest distance draws the corner out to it, so touching
                      // cells close the gap between them and share the wall (1 = never: the corners only stop at walls)
      turn: 40,       // the contacts' turning pull on the hexagon (1/s^2, at full contact)
      turnDamp: 8,    // ... and its damping (1/s)
      jelly: 0.3,     // how much the corners lag the centre's change of velocity (0 = rigid outline; 0.3: a stirred cell wobbles)
    };
    // the fields' charges and field B (step 5; live-tunable: moire.cells.fields)
    this.fields = {
      chargeA: 1,     // field A charge, every cell (step F0: one for all; per fate until then)
      chargeB: 1,     // field B's fixed charge (signed; only with the charges neither from the stock nor the genes, ?qgenes=0)
      band: 1.5,      // B's lattice period in units of the medium's (its band; A's is 1)
      lever: 0.1,     // as params.lever, for B's lattices: small, so B's beat is much longer than its reach and
                      // B is a smooth bump around each cell (at 0.4 its rings make the summed force jitter)
      r0: 5,          // B's envelope range, in units of R (A: 2.2)
      cut: 10,        // how far B reaches (sensed and drawn), in units of R (A: 3.6)
      emit: true,     // cells emit into B
      strain: 1,      // how much a cell's stretch strains its B lattice (1 = fully, as A; 0 = not)
      on: true,       // cells feel B (key Q)
      gain: 0.6,      // gain of B's force (as params.sense for A)
      sat: 2,         // B's force saturates at this speed (R / s)
      sign: -1,       // +1: like repels like; -1: like attracts like (key U). Default attracts: with the biology
                      // on, repelling kept cells apart so fates rarely formed (until step F0); ?bio=0 sets +1 (the labyrinth)
      like: 0,        // what "like" means: 0 = by charge (signed charges multiply), 1 = by key (lineage)
      likeW: 0.15,    // lineage likeness width (Gaussian in the key difference)
      // step 6, rule 1: leak by deformation (key 4). A stretched cell's A lattice is squeezed the other way; when
      // one of its wavevectors comes near B's band, that share of its A emission goes into B instead (as a slow
      // plane-wave beat pinned to the cell), and it listens to B through its A charge in the same share
      leakOn: false,  // key 4 (off by default: see the README)
      leak: 1,        // strength of the leaked B, per unit A emission (and of the A charge it listens to B with)
      leakW: 0.1,     // how close the strained A lattice must come to B's band (Gaussian width of the pair's beat
                      // wavevector, in units of the medium's wavenumber; an unstretched cell is about 0.33 away)
      // step 6, rule 2: conversion A -> B (key 5). A cell that feels enough A (through a leaky integrator, with
      // hysteresis) converts: it emits B more strongly (mode 0) or B of the other sign (mode 1; key 6)
      convOn: true,   // key 5
      conv: 2,        // mode 0: a converted cell emits and feels B x (1 + conv); mode 1: x -conv
      convMode: 0,    // 0 = boost, 1 = flip (key 6). Flip pulls the loop-only culture into one blob
      convAuto: true, // the thresholds below are quantiles of the A felt across the culture (from the census, smoothed
                      // over about 20 s), as the A felt differs a lot between cultures (loop only, median 1.2 at 2000
                      // cells and 2.4 at 10 000: the smaller cells sit in each other's bright cores). false: absolute
      convUp: 0.9,    // the A felt above which a cell converts: with convAuto, the level that 90 % of the cells feel
                      // less than (so about the top tenth can convert on its own)
      convDown: 0.5,  // ... and below which it converts back (rule 2 alone; with convAuto, the median)
      convTau: 1.0,   // the integrator's time constant (s)
      // step 6, rule 3: relay through B (key 7; needs conversion on). The B of converted neighbours adds to the
      // trigger, so conversion spreads; a converted cell tires and then rests (an excitable medium)
      relayOnKey: true, // key 7
      relay: 4,       // weight of the converted share of a cell's neighbourhood (within B's reach, weighted by B's
                      // envelope) in the trigger, in units of the gap between the two thresholds: with 4, a cell that
                      // feels the median A converts once a quarter of its neighbourhood has
      relayOn: 2,     // seconds a cell stays converted
      relayRest: 6,   // seconds it then rests before it can convert again
    };
    // step 7: exclusion (live-tunable: moire.cells.excl). A cell's TYPE is its founder line (step F0; its fate until then); its STATE is which of `states`
    // equal bins of the hex lattice's 60 degrees its lattice angle lies in (2 bins: like spin up / down). Two cells
    // of the same type and state push apart hard, out past contact; of the same type in different states, they
    // may pack closer than contact. Cells of different types meet as before.
    this.excl = {
      on: false,      // key 8
      hard: 4,        // how hard same-state cells push apart, x the contact push
      reach: 1.3,     // ... out to this distance, x the contact distance (the sum of the two radii)
      pack: 1,        // same type, different state: push apart only below this x the contact distance (below 1:
                      // they pack closer than contact; 0.85 overlaps them visibly, busy with 3 states)
      states: 3,      // number of states, 2 to 4 (key 0). 3 fits the hex packing: every cell can have only other states
                      // around it (pinwheel rosettes); 2 cannot, so the packing opens into chains or, squeezed, a
                      // square checkerboard
      // rule 2, state flip (key 9; needs 8): a cell with more neighbours of its type in its own state than in another
      // moves to the state least represented around it (its lattice stays as it is)
      flip: true,     // key 9 (it only acts while exclusion is on; without it a lineage is all one state)
      flipRate: 1,    // chance per s that a crowded cell flips (random moments, so neighbours do not all flip at once)
    };
    // step 8: the partner A' of field A (live-tunable: moire.cells.partner). Every cell's field A is its pinned beat;
    // the partner is the same beat a quarter period out of step (its sin twin). Together they carry a phase, and where
    // the phase changes from place to place, a direction of travel.
    this.partner = {
      // rule a (key Z): cells feel the pair as a phase current, j = A grad A' - A' grad A, and are pushed along it
      on: false,
      gain: 1,        // push: gain x R x (R x the phase gradient) per s
      sat: 2,         // ... saturating at this speed (R / s)
      arrow: false,   // the partner's three waves travel one way (true: every cell has an arrow, its partner a dipole) or
                      // 120 degrees apart (false: symmetric; the partner of a lone cell is weak near it)
      // rule b (key ,): change makes the partner. A cell emits A' in proportion to how fast the A it feels changes,
      // and A in proportion to how fast the A' it feels changes (both through the step 6 integrator, convTau)
      change: false,
      chGain: 2,      // s: phasor = (1 + chSign x chGain x dA'/dt, chGain x dA/dt)
      chTau: 0.3,     // s: how fast the phasor follows
      chMax: 1.5,     // soft cap on its distance from (1, 0)
      chSign: -1,     // -1: change of A' lowers A (the pair turns, as Faraday's law); +1: raises it
      chMode: 1,      // 0 = felt change (the gains above), 1 = clock (key ')
      omega: 2.5,     // clock: rate of the hand (rad/s; a lone cell turns once in 2.5 s)
      pull: 1.5,      // clock: how hard the felt pair pulls the hand toward the neighbours' (rad/s)
      lag: 1.0,       // clock: ... toward their hand turned back by this much (rad). The lag slows a clock that is in
                      // step with its neighbours, to omega - pull x sin(lag) (here 1.2 rad/s: a turn in 5 s), and makes
                      // the waves travel: the culture's rim leads, rings run inward. 0 = plain alignment, all in step
      // rule c (key .): sideways push, the partner's force at right angles
      side: false,
      sideGain: 1,    // mode 0: x field A's force (the partner's gradient force, turned 90 degrees); mode 1: rad per s
                      // of turning at full A'
      sideMode: 0,    // 0 = the partner's gradient force turned 90 degrees, 1 = perpendicular to the cell's motion
      eps: 0.05,      // the current is divided by A^2 + A'^2 + eps^2 (the pair as weighted on the membrane: field A x
                      // the sign table x tuning; loop only about 0.2 to 0.4)
    };
    // drawing (live-tunable: moire.cells.look)
    this.fieldScale = 0.5;     // texels per CSS px of the cells' field texture
    this.fieldTex = null;
    this.look = {
      legend: true,   // step F0: the job legend (src/app.js; View panel, ?legend=0)
      view: 0,        // 0 = colour by job (step F0, src/jobs.js; by fate until then), 1 = colour by lineage (the key's hue), 2 = by strategy (step C6), 3 = by charge
                      // (step C6b; key V cycles)
      fill: 0.09,     // disc fill of undecided cells, as a fraction of the cell colour over black (fillC: with a clear job)
      fillC: 0.34,    // disc fill of committed cells (flat colour, so tissues read as areas)
      fillA: 0.88,    // disc opacity (1 = background fully hidden under a cell)
      line: 0.72,     // outline brightness
      lineW: 1.1,     // outline width (CSS px)
      dots: 0.85,     // dot brightness (0 = no dots)
      dotR: 0.21,     // dot radius as a fraction of the dot spacing (reference: 2.7 / 16)
      period: 0.62,   // dot spacing per lattice period, in units of R (the medium's period is 0.62 R)
      leakDot: 0.42,  // step 6: largest blue centre dot of a leaking cell, as a fraction of its radius (0 = none)
      leakMin: 0.2,   // leak level below which no dot is drawn
      convFill: 0.55, // fill of a converted undecided cell, as a fraction of field B's ink (outline: the ink itself)
      stateMark: true, // step 7: while exclusion is on, a bar across each cell shows its state (its angle: one of
                      // `states` directions, 180 / states degrees apart)
      bar: 0.8,       // the bar's brightness (as the outline's)
      hand: 1.0,      // step 8, rule b: brightness of the phasor's hand (0 = none), in the partner's ink
      core: 0.55,     // step C5: radius of a full battery's core, as a share of the cell's radius (area in proportion to the
                      // charge; 0 = not drawn); its ink: the palette's `core` (src/palette.js)
      starve: 0.12,   // ... a cell with less than this share of its battery is drawn dimmer, the emptier the dimmer
      starveDim: 0.4, // ... by up to this much (0 = not at all)
      // step C6: the engines drawn as parts (small flat marks around the core), and the strategy view's inks
      parts: true,    // draw them (while the engines run)
      partSize: 0.24, // a part's largest half-size, as a share of the cell's radius
      partDist: 0.58, // the parts' distance from the centre, as a share of the radius
      partDots: 0.45, // the lattice dots' brightness while parts are drawn, as a share of `dots` (they give the parts room)
      partRate: 2,    // the slot rate at which a part reaches its largest size (area in proportion to the rate below it)
      coreParts: 0.36, // the battery core's radius at full charge while parts are drawn (it gives them room)
      strategyFill: 0.5,                  // strategy view: every body's flat fill, as a share of its strategy's ink
      // (the parts' inks, by what the engine does: the palette's band (a harvester's pigment), burn, swap, sed; the
      // strategy view's: band, burn, other; src/palette.js)
      // ---- step C6n: the neon look (while it is on, key E; these replace the flat look's fills, line and dots) ----
      tube: 1.1,        // the tube's width (CSS px; at most 0.3 of a small cell's radius)
      white: 0.6,       // how white-hot the tube's centre line is (0 = its colour all across)
      innerGlow: 0.08,  // the inside lit by the tube: brightness next to it, as a share of the colour ...
      innerReach: 0.3,  // ... falling off inward over this share of the radius
      nFill: 0.03,      // the inside's tint, undecided cells ...
      nFillC: 0.06,     // ... committed cells
      nFillA: 0.8,      // the inside's opacity (it darkens what lies under the cell)
      nLine: 1.0,       // the tube's brightness
      nDots: 0.3,       // the lattice dots' brightness (flat: dots)
      nStrategyFill: 0.1, // strategy view: the inside's tint
      coreRim: 0.35,    // the battery core: its lit rim, as a share of its radius ...
      coreDim: 0.3,     // ... and its inside's brightness, as a share of the rim's
      partWhite: 0.45,  // the parts' lamps: how white their centre is
      humDepth: 0.05,   // the hum: the wobble's depth (5 %: brightness between 0.95 and 1.05) ...
      humRate: 0.9,     // ... its rate (Hz; each cell between 0.6 and 1.4 x this, at its own phase)
      humIdle: 0.8,     // ... an idle cell's brightness (the busiest: 1.12)
      nStarveDim: 0.25, // a starving cell's dimming under the neon look (flat: starveDim)
      humAct: 0.03,     // ... the activity (battery share changed per s of simulation time) at which a cell is 63 % of
                        // the way to the busiest
      humTau: 0.6,      // ... the activity's smoothing (s of real time)
      // step C6n, the clean view (default) or the machinery (View panel, Shift+4 flips every diagnostic layer at once):
      innerDots: false, // the cell's own lattice as dots inside it (Shift+6)
      marks: false,     // the diagnostic marks: step 6's leak dot and converted outline, step 7's state bar, step 8's hand
      // step C6c: the honeycomb outline
      corner: 0.3,      // corner rounding radius, as a share of the cell's radius (0 = sharp hexagons; 0.6: nearly round)
      wallGap: 0.45,    // each tube sits this far inside the cell's wall (CSS px; at most 0.08 r), so two neighbours' tubes
                        // along a shared wall read as two thin lines with a dark gap
      // step C6c, the membrane chemistry's look (while it is on): each side's tube shows its integrity
      membLook: true,   // draw it
      membDim: 0.35,    // an empty side's tube is this much dimmer (and a quarter thinner)
      membBreak: 0.5,   // below this integrity a side of a membrane that has been whole breaks into dashes and flickers
      membFlicker: 0.3, // ... the flicker's depth (at an empty side)
      membInner: 0.45,  // a heavy membrane's second, inner tube: its brightness (0 = none)
      membWide: 0.3,    // a thick membrane's tube is up to this much wider (at 2.5 x the founders' usual thickness)
      membFlash: 1.5,   // a burst cell's flash (0 = none)
      // step C6d, the dipoles' look (while they are on)
      dipTint: 0.6,     // each side's tube tinted toward the + ink (rose) or the - ink (blue) by its charge, at most this much
      dipArrow: 0.9,    // with the machinery (the marks): an arrow from - to + across each polarised cell, its brightness
      dipTwoTone: 0.85, // colour by charge (V): a polarised cell's body in two halves, + rose and - blue, this strong at a full dipole
      // step C7, the pumps' look (while they run)
      pumpParts: true,  // each pump slot as small notches on the membrane (slot 1 on sides 0, 2, 4; slot 2 on 1, 3, 5)
      pumpSize: 0.2,    // a notch's half-width at full size, as a share of the radius
      pumpRate: 1.5,    // the rate at which a notch reaches its full size
      pumpTint: 0.7,    // how much the tube's segment at a notch takes the substance's ink
      voltRim: 0.7,     // with the machinery: the membrane voltage as a faint rim inside the tube (rose +, blue -), its brightness
      voltFull: 0.5,    // ... full at this voltage
    };
    this.dipole = new Dipole(this);   // step C6d: charge per side (src/dipole.js)
    this.division = new Division(this);   // step C9: division and death with a changing count (src/division.js)
    this.walls = new Walls(this);         // step C10: patterned walls, evolvable adhesion per side (src/walls.js)
    this.glue = new Glue(this);           // step G0: strong glue, junctions that break (src/glue.js)
    this.walls.glue = this.glue;
    this.spindle = new Spindle(this);     // step S1: cell shape (src/spindle.js)
    this.stir = null;                     // step G0: the cells stir the water (src/stir.js; set by main.js)
    this.guides = new Guides(this);       // step C13: fields as genes and guides (src/guides.js)
    this.kin = new Kin(this);             // step T1a: an inside, kin channels, the self marker (src/kin.js)
    this.grn = new Grn(this);             // step T1b: the gene regulatory network, the reporter view (src/grn.js)
    this.pred = new Predators(this);      // step P1: predators, engulfing and kin sparing (src/predators.js)
    this.fidelity = new Fidelity(this);   // step G1: error correction, the fidelity gene (src/fidelity.js)
    this.mutation = new Mutation(this);   // step M2: the mutation sweep (src/mutation.js)
    this.dup = new Dup(this);             // step G2: gene duplication for engines and pumps (src/dup.js)
    this.motors = new Motors(this);       // step S2: flagella and cilia (src/motors.js)
    this.senses = new Senses(this);       // step P3: cells that sense cells (src/senses.js)
    this.folding = new Folding(this);     // step G3: the moire genome, DNA folding (src/folding.js)
    this.genome.foldP = this.folding.params;
    this.signals = new Signals(this);     // step Q1: a signal substance (src/signals.js)
    this.contract = new Contract(this);   // step L1: contraction (src/contract.js)
    this.tendrils = new Tendrils(this);   // step T2: tendrils and bone (src/tendrils.js)
    this.inspect = new Inspect(this);     // step I1: the cell inspector (src/inspect.js; ?inspect=0 none)
  }

  static async create(device, format, medium, count, seed, cap = 0) {
    const c = new Cells(device, format, medium, count, seed, cap);
    await c.init();
    return c;
  }

  async init() {
    const d = this.device;
    const pre = [HEAT_COMMON_URL, CELL_URL];
    const [drawMod, gridMod, checkMod, stepMod, censusMod, fieldMod, heat, glowMod, grnMod] = await Promise.all([
      loadFieldShader(d, 'src/shaders/cell_draw.wgsl', [...pre, LOD_URL]),   // (step V1: + the shared fade)
      loadFieldShader(d, 'src/shaders/cell_grid.wgsl', pre),
      loadFieldShader(d, 'src/shaders/cell_check.wgsl', pre),
      loadFieldShader(d, 'src/shaders/cell_step.wgsl', pre),
      loadFieldShader(d, 'src/shaders/cell_census.wgsl', pre),
      loadFieldShader(d, 'src/shaders/cell_field.wgsl', pre),
      Heat.create(d),
      loadFieldShader(d, 'src/shaders/cell_glow.wgsl', pre),
      loadFieldShader(d, 'src/shaders/cell_grn.wgsl', pre),   // step T1b: the gene network
    ]);
    this.heat = heat;           // step C1: the heat band (src/heat.js)
    heat.signals = this.signals; this.signals.heat = heat;   // step Q1: the signal's blocks live in the heat buffer
    await this.signals.init(d);
    this.eat = null;            // step C5: the cells' stock and battery (src/eat.js; made at the end of init)
    // the cells' field: plain additive blending into a float texture (signed values add up)
    const add = { srcFactor: 'one', dstFactor: 'one', operation: 'add' };
    const rp = {};   // (step SP1: every pipeline of the cells at once, async; awaited below)
    rp.fieldPipe = renderPipe(d, {
      label: 'cell field', layout: 'auto',
      vertex: { module: fieldMod, entryPoint: 'vs' },
      fragment: { module: fieldMod, entryPoint: 'fs', targets: [{ format: FIELD_FORMAT, blend: { color: add, alpha: add } }] },
      primitive: { topology: 'triangle-list' },
    });
    const over = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    rp.drawPipe = renderPipe(d, {
      label: 'cell draw', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });
    // step H1: the harmonic look's cells (the same quads, fs_harm; src/harmonic.js)
    rp.harmPipe = renderPipe(d, {
      label: 'cell draw (harmonic)', layout: 'auto',
      vertex: { module: drawMod, entryPoint: 'vs' },
      fragment: { module: drawMod, entryPoint: 'fs_harm', targets: [{ format: this.format, blend: { color: over, alpha: over } }] },
      primitive: { topology: 'triangle-list' },
    });

    // compute pipelines with explicit layouts (the Sim uniform is bound with a dynamic offset)
    const C = GPUShaderStage.COMPUTE;
    const sim = { binding: 0, visibility: C, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: SIM_BYTES } };
    const ro = (binding) => ({ binding, visibility: C, buffer: { type: 'read-only-storage' } });
    const rw = (binding) => ({ binding, visibility: C, buffer: { type: 'storage' } });
    const layout = (label, entries) => {
      const bgl = d.createBindGroupLayout({ label, entries });
      return { bgl, pl: d.createPipelineLayout({ label, bindGroupLayouts: [bgl] }) };
    };
    const un = (binding) => ({ binding, visibility: C, buffer: { type: 'uniform' } });
    this.gridL = layout('cell grid', [sim, ro(1), rw(2), rw(3), rw(4), rw(5), rw(6), rw(7), un(8), rw(9), un(10)]);
    // (at most 8 storage buffers per stage, the core limit: the step finds sortIdx in the beats, and a grid cell's end
    // in the next one's start instead of in counts; binding 4 is the heat buffer, 13 its parameters)
    // (binding 10 held the nutrient and threat sources until step C3)
    this.stepL = layout('cell step', [sim, ro(1), ro(3), rw(4), rw(5), ro(6), rw(7), rw(8), un(9), ro(11), un(12), un(13)]);
    this.censusL = layout('cell census', [sim, ro(1), ro(2), rw(3)]);
    this.grnL = layout('cell grn', [sim, ro(1), rw(2), ro(3), un(4), un(5), rw(6), un(7)]);   // step T1b (src/grn.js makes its bind groups; step Q1: + the heat buffer, the signal's words)
    this.checkL = layout('cell check', [sim, ro(1), ro(2), ro(3), ro(4), ro(5), rw(6),
      { binding: 7, visibility: C, buffer: { type: 'uniform' } }]);
    const pipe = (L, module, entryPoint) => computePipe(d, {
      label: `cell ${entryPoint}`, layout: L.pl, compute: { module, entryPoint },
    });
    const cp = {};
    for (const e of ['count', 'scan_local', 'scan_top', 'scan_add', 'scatter']) cp[e] = pipe(this.gridL, gridMod, e);
    cp.step = pipe(this.stepL, stepMod, 'step');
    cp.check = pipe(this.checkL, checkMod, 'check');
    cp.census = pipe(this.censusL, censusMod, 'census');
    cp.grn = pipe(this.grnL, grnMod, 'grn');
    cp.signal = pipe(this.grnL, grnMod, 'signal');   // step Q1: hearing, the inboxes, the signal genes' mutation
    rp.glowPipe = computePipe(d, { label: 'cell glow', layout: 'auto', compute: { module: glowMod, entryPoint: 'main' } });
    const pipesP = Promise.all([allPipes(rp), allPipes(cp)]);   // (awaited after the buffers, with the eat pass's: compiled side by side)

    const U = GPUBufferUsage;
    const n = this.count;
    this.cellBuf = d.createBuffer({ label: 'cells', size: n * CELL_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    this.heat.setCells(this.cellBuf, n);
    this.sortedBuf = d.createBuffer({ label: 'cells sorted', size: n * CELL_CORE_BYTES, usage: U.STORAGE });
    this.sortIdxBuf = d.createBuffer({ label: 'cell sort index', size: n * 4, usage: U.STORAGE });
    this.beatBuf = d.createBuffer({ label: 'cell beats (sorted)', size: n * CELL_BEAT_BYTES, usage: U.STORAGE });
    this.fieldsBuf = d.createBuffer({ label: 'fields (charges, field B)', size: FIELDS_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.fieldsAB = new ArrayBuffer(FIELDS_BYTES);
    this.fieldU = d.createBuffer({ label: 'cell field params', size: 32, usage: U.UNIFORM | U.COPY_DST });
    this.cellGridBuf = d.createBuffer({ label: 'cell grid slot', size: n * 8, usage: U.STORAGE });
    // the Bio records (genome + state), double-buffered: bioBuf[bioCur] holds the current tick's
    this.bioBuf = [0, 1].map((k) => d.createBuffer({ label: `cell bio ${k}`, size: n * BIO_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }));
    this.bioCur = 0;
    this.statsBuf = d.createBuffer({ label: 'cell stats', size: STATS_BYTES, usage: U.STORAGE | U.COPY_DST | U.COPY_SRC });
    // read-back ring for the stats (never waits: a buffer still mapping is simply skipped)
    this.statsRead = [0, 1, 2].map((k) => ({ buf: d.createBuffer({ label: `cell stats read ${k}`, size: STATS_BYTES, usage: U.MAP_READ | U.COPY_DST }), busy: false }));
    this.stats = null;          // last census, for the overlay (see readStats)
    this.statsHist = [];        // [time, births, deaths] for births / deaths per second
    this.onEvents = null;       // callback(events) for births and deaths (main.js drops ripples)
    this.eventTaps = [];        // step T1c: more listeners (the warfare census's deaths at lineage borders)
    this.landscape = null;      // set by main.js (its inks colour the cells' step 6 and 8 marks)
    this.matter = null;         // step C3: the substance grid (src/matter.js; set by main.js), run inside the heat's frame
    this.charge = null;         // step C6b: the charge (src/charge.js; set by main.js)
    this.simBuf = d.createBuffer({ label: 'cell sim params', size: SLOTS * SLOT, usage: U.UNIFORM | U.COPY_DST });
    this.simAB = new ArrayBuffer(SLOTS * SLOT);
    this.simF = new Float32Array(this.simAB);
    this.simU = new Uint32Array(this.simAB);

    // step C5: the stock and battery of every cell, and the pass that eats (src/eat.js)
    // (step SP1: these and the cells' own pipelines at once, async: the browser may compile them side by side)
    const [eat, , , , [rpd, cpd]] = await Promise.all([
      Eat.create(d, this),
      this.motors.init(d, this.format, pre),     // step S2: the flagella's and cilia's drawing (src/motors.js)
      this.tendrils.init(d, this.format, pre),   // step T2: the tendrils' passes and drawing (src/tendrils.js)
      this.inspect.init(d),                      // step I1: the cell inspector (its engine counters: the eat pass's, bound later)
      pipesP,
    ]);
    this.eat = eat;
    this.heat.eat = this.eat;
    Object.assign(this, rpd);
    this.pipes = cpd;
    this.fieldBG = d.createBindGroup({
      label: 'cell field', layout: this.fieldPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.fieldU } }, { binding: 1, resource: { buffer: this.beatBuf } }],
    });

    this.drawU = d.createBuffer({ label: 'cell draw params', size: DRAW_BYTES, usage: U.UNIFORM | U.COPY_DST });
    this.drawAB = new ArrayBuffer(DRAW_BYTES);
    this.drawData = new Float32Array(this.drawAB);
    this.drawU32 = new Uint32Array(this.drawAB);
    // step C6n: the cells' activity for the hum (cell_glow.wgsl; drawing only)
    this.glowBuf = d.createBuffer({ label: 'cell glow (drawing)', size: n * 8, usage: U.STORAGE | U.COPY_SRC });
    this.glowU = d.createBuffer({ label: 'cell glow params', size: 16, usage: U.UNIFORM | U.COPY_DST });
    this.glowBG = d.createBindGroup({
      label: 'cell glow', layout: this.glowPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.glowU } }, { binding: 1, resource: { buffer: this.cellBuf } },
        { binding: 2, resource: { buffer: this.glowBuf } }],
    });
    // one per genome copy (step C6: the parts read the engines; bioBuf[bioCur] is the current one)
    const drawEntries = (bio) => [
      { binding: 0, resource: { buffer: this.drawU } },
      { binding: 1, resource: { buffer: this.cellBuf } },
      { binding: 2, resource: { buffer: bio } },
      { binding: 3, resource: { buffer: this.glowBuf } },
    ];
    this.drawBGs = this.bioBuf.map((bio) => d.createBindGroup({ layout: this.drawPipe.getBindGroupLayout(0), entries: drawEntries(bio) }));
    // step H1: the harmonic pipeline's own (an automatic layout belongs to its pipeline)
    this.harmBGs = this.bioBuf.map((bio) => d.createBindGroup({ layout: this.harmPipe.getBindGroupLayout(0), entries: drawEntries(bio) }));
    this.motors.bgs = null;   // step S2: the motors' drawing binds to these buffers (again)
  }

  /** The cells' radius: the reference's R, or smaller if `count` cells would not fit in the dish. */
  fitR(view) {
    // (the dish's own R, src/dish.js: chosen with the dish, kept while the window changes; it is the old rule's for a dish from the window)
    if (dish.R > 0) return dish.R;
    // a round blob packed at about 0.82 area fraction, diameter at most 0.8 x the shorter side
    const blob = 0.4 * Math.min(view.cssW, view.cssH);
    return Math.min(this.medium.R, blob * Math.sqrt(0.82 / this.start));   // (step C9: by the starting number, not the capacity)
  }

  resize(view) {
    const first = !this.view;
    this.view = view;
    this.R = this.fitR(view);
    this.heat.resize(view, this.R);
    this.sizeGrid();
    this.sizeField();
    if (first) this.seed();
  }

  /** The cells' field texture: fieldScale texels per CSS px over the dish. */
  sizeField() {
    const { cssW: W, cssH: H } = this.view;
    const w = Math.max(1, Math.ceil(W * this.fieldScale)), h = Math.max(1, Math.ceil(H * this.fieldScale));
    if (this.fieldTex && this.fieldTex.width === w && this.fieldTex.height === h) return;
    if (this.fieldTex) this.fieldTex.destroy();
    this.fieldTex = this.device.createTexture({
      label: 'cell field', size: [w, h], format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.fieldView = this.fieldTex.createView();
    this.fieldBlank = false;
  }

  /** Whether the cells emit at all (key O). */
  emitting() { return !!this.params.emit; }

  /** Step 8: whether any partner rule is on (then the step works out the partner A'). */
  partnerOn() { const P = this.partner; return !!(P.on || P.change || P.side); }

  /** Step 8: whether the partner A' is drawn (only while a partner rule is on, so the page is as before otherwise). */
  partnerDrawn() { return this.emitting() && this.partnerOn(); }

  /** Grid cell size in CSS px: the larger of the contact range and the field's reach. */
  gridSize() {
    const p = this.params;
    const x = this.excl.on ? this.excl.reach * 2.3 : 0;   // step 7: same-state pairs reach past contact
    const sh = this.spindle ? this.spindle.range(this.genome.params.reach) : 0;   // step S1: the longest pair's contact
    return Math.max(1, Math.max(p.range, p.cut, x, sh) * this.R);
  }

  /** Grid dimensions from the dish size and R; (re)allocates the grid buffers when they grow. */
  sizeGrid() {
    const { cssW: W, cssH: H } = this.view;
    const cs = this.gridSize();
    const gw = Math.max(1, Math.ceil(W / cs)), gh = Math.max(1, Math.ceil(H / cs));
    const n = gw * gh;
    Object.assign(this.grid, { gw, gh, cs, n });
    if (n + 3 <= this.grid.cap) return;   // (step C9: + the free slots' bucket, and its end in starts; step P1: + the ghosts' bucket)
    const cap = Math.ceil((n + 3) * 1.25);
    const d = this.device, U = GPUBufferUsage;
    // (the old ones destroyed at the next frame when no timing probe holds them: a probe recorded before a resize submits them later)
    this.gridTrash = (this.gridTrash || []).concat([this.countsBuf, this.startsBuf, this.blockBuf].filter(Boolean));
    this.countsBuf = d.createBuffer({ label: 'grid counts', size: cap * 4, usage: U.STORAGE | U.COPY_DST });
    this.startsBuf = d.createBuffer({ label: 'grid starts', size: cap * 4, usage: U.STORAGE });
    this.blockBuf = d.createBuffer({ label: 'grid block sums', size: Math.ceil(cap / BLOCK) * 4, usage: U.STORAGE });
    this.grid.cap = cap;
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    this.gridBG = d.createBindGroup({
      label: 'cell grid', layout: this.gridL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.countsBuf), b(3, this.startsBuf), b(4, this.blockBuf), b(5, this.cellGridBuf),
        b(6, this.sortedBuf), b(7, this.sortIdxBuf), b(8, this.medium.buffer), b(9, this.beatBuf), b(10, this.fieldsBuf)],
    });
    this.makeStepBGs();
    this.censusBG = [0, 1].map((k) => d.createBindGroup({
      label: 'cell census', layout: this.censusL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.bioBuf[k]), b(3, this.statsBuf)],
    }));
    this.makeCheck();
  }

  /** The two step bind groups: stepBG[k] reads bioBuf[k] and writes bioBuf[1 - k] (rebuilt when the heat grid is replaced). */
  makeStepBGs() {
    this.stepBG = [0, 1].map((k) => this.makeStepBG(this.cellBuf, this.bioBuf[k], this.bioBuf[1 - k], this.statsBuf));
    this.heatVersion = this.heat.version;
  }

  makeStepBG(cellBuf, bioPrev, bioNext, statsBuf, heatBuf = this.heat.buffer) {
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    return this.device.createBindGroup({
      label: 'cell step', layout: this.stepL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.sortedBuf),
        b(3, this.startsBuf), b(4, heatBuf), b(5, cellBuf),
        b(6, bioPrev), b(7, bioNext), b(8, statsBuf), b(9, this.medium.buffer), b(11, this.beatBuf),
        b(12, this.fieldsBuf), b(13, this.heat.paramBuf)],
    });
  }

  /**
   * A fresh culture: all cells (undecided: no job shows yet) in a round blob at the dish centre, a little looser than packed, each a
   * copy of one of the founder genomes. fresh = true draws new founders (key G); else the same ones (key N).
   * Step C9: `start` cells in the first slots; every other slot of the capacity is free (dead, all zero).
   */
  seed(fresh = false) {
    const { cssW: W, cssH: H } = this.view;
    const n = this.start, R = this.R, rng = this.genome.rng;
    if (fresh) this.genome.newFounders();
    // app (src/culture.js): how the culture is spread (`layout`: one clump, the default; scattered; several colonies; a ring);
    // with colonies each colony is one founder's (founder k mod the founders)
    const place = cultureLayout(this.layout, W, H, R, n, rng);
    const bab = new ArrayBuffer(this.count * BIO_BYTES);
    const keys = this.genome.fill(new Float32Array(bab, 0, n * BIO_BYTES / 4), n, place.founder);
    const ab = new ArrayBuffer(this.count * CELL_BYTES);
    const f = new Float32Array(ab), u = new Uint32Array(ab);
    for (let i = 0; i < n; i++) {
      const o = i * CELL_FLOATS;
      let at = place.at(i);
      // step G0b: never inside an obstacle (another draw from the layout: only when there are obstacles, so the random stream is as before)
      const O = this.obstacles;
      if (O && O.active) for (let k = 0; k < 40 && O.blocked(at[0], at[1], 1.1 * R); k++) at = place.at(i);
      [f[o], f[o + 1]] = at;
      f[o + 2] = 0; f[o + 3] = 0;
      f[o + 4] = R;
      f[o + 5] = keys[2 * i];                          // lattice angle = the key angle
      f[o + 6] = 0; f[o + 7] = 0;
      u[o + 8] = KIND.STEM; u[o + 9] = ALIVE; u[o + 10] = (rng() * 4294967296) >>> 0;
      f[o + 11] = keys[2 * i + 1];                     // key scale
      f[o + 12] = 1; f[o + 13] = 0;                    // step 8: the phasor of field A and its partner
      f[o + 16] = this.eat.starterShare;               // step C5: the battery share (the starter charge, below)
      u[o + 60] = u[o + 61] = u[o + 62] = 0xffffffff;  // step C7: no neighbours across the sides yet (the step finds them)
      f[o + 64] = u[o + 10] / 4294967296 * 2 * Math.PI;   // step C10: the front, any way (from the cell's own seed: no extra draw)
      if (place.front) {   // step L1: a laid-out organ gives each cell its front and the stretch it starts with (its spindle)
        const fr = place.front(i), e = place.stretch ? place.stretch(i) : 0;
        f[o + 64] = ((fr % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        f[o + 6] = e * Math.cos(2 * f[o + 64]); f[o + 7] = e * Math.sin(2 * f[o + 64]);
      }
    }
    this.heat.depositAll();     // step C1: the old cells' motion becomes heat (queued before they are overwritten)
    this.eat.reset();           // step C5: the old cells' stock back to the dish, the starter charge into every battery
    this.device.queue.writeBuffer(this.cellBuf, 0, ab);
    this.device.queue.writeBuffer(this.bioBuf[this.bioCur], 0, bab);
    this.warm = Math.max(0, Math.round(this.params.warmup));
    this.aQuant = null;         // step 6: the conversion thresholds re-learn the A felt
    this.alive = n;             // step C9 (until the census reads it back)
    this.division.reset();
  }

  /** Pull toward the dish centre (1/s) that squeezes the middle of the blob by about params.squeeze. */
  pull() {
    const p = this.params;
    return 6.6 * p.squeeze * p.stiffness / this.start;   // (step C9: the dish's, by the starting number: a smaller culture is not
                                                         // pulled harder to the middle)
  }

  /** Step C7: the pumps (src/pumps.js, held by the eating). */
  get pumps() { return this.eat ? this.eat.pumps : null; }

  /** Write the Sim uniform for one tick (at simulation time `time`) into slot k. */
  writeSim(k, dt, time, count = false) {
    this.lastDt = dt; this.lastTime = time;   // (step G3: the census's tick, the stress button's clock)
    const v = this.view, g = this.grid, p = this.params;
    const f = this.simF, u = this.simU, o = k * SLOT / 4;
    u[o] = this.count; u[o + 1] = g.gw; u[o + 2] = g.gh; u[o + 3] = this.tick >>> 0;
    // (the PRESS, src/dish.js: the right or bottom wall moved in, for the cells only: they are held inside it and its soft wall pushes
    // the crowd in front of it; the dish, its grid and its matter stay)
    const pr = dish.pressAt(time);
    f[o + 4] = g.cs; f[o + 5] = this.R; f[o + 6] = v.cssW - pr[0]; f[o + 7] = v.cssH - pr[1];
    f[o + 8] = v.cssW / 2; f[o + 9] = v.cssH / 2; f[o + 10] = dt;
    f[o + 11] = p.contact ? p.stiffness : 0;
    f[o + 12] = p.damping; f[o + 13] = p.jitter; f[o + 14] = this.pull(); f[o + 15] = p.wall;
    const P = this.pointer, on = P.drag ? 1 : 0;
    f[o + 16] = P.x; f[o + 17] = P.y; f[o + 18] = P.vx * on; f[o + 19] = P.vy * on;
    f[o + 20] = p.stirReach * p.stirReach; f[o + 21] = p.stir;
    f[o + 22] = p.drift; f[o + 23] = time;
    u[o + 24] = this.genome.ruleBits();
    f[o + 25] = this.excl.flip ? Math.max(0, this.excl.flipRate) : 0;
    u[o + 26] = this.heat.offsetAt(k);
    u[o + 27] = ((this.pumps && this.pumps.contactOn) || this.kin.needsNbr) && this.count <= 65535 ? 1 : 0;   // step C7: each side's touching neighbour (step T1a: and the inside, kin channels)
    const G = this.genome.params;
    f[o + 30] = G.reach;   // (28, 29: the fates' tau and release until step F0; step S1: the shape's bits and largest stretch)
    f[o + 31] = G.adhesion;
    f[o + 32] = G.adhSigma; f[o + 34] = this.genome.rules.body ? 1 : 0; f[o + 35] = G.adhBase;
    f[o + 36] = this.genome.rules.body ? G.crawl : 0; f[o + 37] = G.turnRate;
    f[o + 38] = G.turnover; f[o + 39] = G.unhappy; f[o + 40] = G.mutSize; f[o + 41] = G.mutJump;
    f[o + 42] = Math.max(0, G.engJump ?? 0);       // step C6: engine slot jumps per birth
    const SH = this.shape;                         // step C6c (words 43 and 45 held the nutrient and threat numbers until C3)
    f[o + 43] = Math.max(0.2, SH.size); f[o + 45] = Math.max(0, SH.turnDamp);
    u[o + 44] = this.matter ? this.matter.copyAt(k) : 0;   // step C5: the substances' current copy at this tick
    f[o + 46] = p.lever; f[o + 47] = p.emit ? 1 : 0; f[o + 48] = p.r0; f[o + 49] = p.cut;
    f[o + 50] = p.senseOn ? p.sense : 0; f[o + 51] = p.tuneW; f[o + 57] = Math.max(1.001, SH.snap);
    u[o + 58] = p.receptor ? 1 : 0;
    f[o + 52] = Math.max(1, SH.bulge); f[o + 53] = p.senseMax;
    f[o + 54] = p.active ? 1 : 0; f[o + 55] = p.shapeRate; u[o + 56] = p.anchor;
    const X = this.excl;
    f[o + 59] = X.on ? Math.max(0, X.hard) : 0; f[o + 60] = Math.max(0, X.reach); f[o + 61] = Math.max(0, X.pack);
    u[o + 62] = Math.max(1, Math.min(4, Math.round(X.states))); u[o + 63] = count ? 1 : 0;
    this.spindle.writeSim(u, f, o);              // step S1: cell shape (words 28, 29, 33: the fates' until step F0)
    this.contract.writeSim(u, o);                // step L1: contraction (its bits in word 28, with the shape's)
    this.tendrils.writeSim(u, o);                // step T2: tendrils and bone (their bits in word 28 too)
  }

  /** Write the fields' uniform (struct Fields): the charges, field B's band, range and rules. */
  writeFields() {
    const F = this.fields, f = new Float32Array(this.fieldsAB), u = new Uint32Array(this.fieldsAB);
    f[0] = F.chargeA; f[4] = F.chargeB;   // (step F0: one charge per field; words 1..3, 5..9 spare, the fates' until then)
    f[10] = Math.max(0.1, F.band); f[11] = F.lever; f[12] = Math.max(0.1, F.r0); f[13] = Math.max(0.1, F.cut);
    const feel = F.on && F.emit && F.gain > 0;
    f[14] = feel ? F.gain : 0; f[15] = Math.max(0.01, F.sat); f[16] = this.charge ? this.charge.signB : F.sign; u[17] = F.like ? 1 : 0;
    f[18] = Math.max(0.005, F.likeW);
    u[19] = Math.max(1, Math.min(4, Math.ceil(F.cut * this.R / this.grid.cs - 1e-6)));   // grid block radius for B's reach
    f[20] = F.emit ? 1 : 0; f[21] = F.strain;
    f[22] = F.leakOn ? F.leak : 0; f[23] = Math.max(0.005, F.leakW);
    const [up, down] = this.convThresholds();
    f[24] = F.convOn ? F.conv : 0; u[25] = F.convMode ? 1 : 0; f[26] = up; f[27] = down; f[28] = F.convTau;
    f[29] = F.relayOnKey ? F.relay : 0; f[30] = F.relayOn; f[31] = F.relayRest;
    const P = this.partner;
    f[32] = P.on ? P.gain : 0; f[33] = Math.max(0.01, P.sat); f[34] = Math.max(1e-4, P.eps); u[35] = this.partnerOn() ? 1 : 0; f[36] = P.arrow ? 1 : -1;
    f[37] = P.change ? (P.chMode ? P.pull : P.chGain) : 0; f[38] = Math.max(1e-3, P.chTau); f[39] = Math.max(0.01, P.chMax); f[40] = P.chSign;
    u[41] = P.chMode ? 1 : 0; f[42] = P.omega; f[43] = P.lag;
    f[44] = P.side ? (P.sideMode ? P.sideGain / 60 : P.sideGain) : 0; u[45] = P.sideMode ? 1 : 0;
    // step C5: what the step needs of the cells' eating (src/eat.js): the switches (all off while it is off) and knobs
    const E = this.eat.params, rule = (k) => this.eat.rule(k);
    u[47] = (rule('pay') ? 1 : 0) | (rule('heat') ? 2 : 0) | (rule('bias') ? 4 : 0) | (rule('smell') ? 8 : 0) |
      (rule('tolGene') ? 16 : 0) |   // step C6: heat damage by each cell's tolerance gene
      (rule('pay') && rule('crawlWork') ? 32 : 0);   // step C15g: the crawl paid by the work it does
    f[48] = Math.max(1e-3, E.crawlFull); f[49] = Math.max(0, E.crawlCost); f[50] = Math.max(1e-3, E.tol); f[51] = Math.max(0, E.heatKill);
    f[52] = Math.max(0, E.biasFloor); f[53] = Math.max(0, E.smellGain); f[54] = Math.max(1e-6, E.smellHalf);
    // step C6b, charge (src/charge.js): the cells feel the substrate's field; their B charge from their stock
    const Q = this.charge;
    f[55] = Q && Q.feelOn ? Q.params.feelGain : 0; u[56] = Q ? Q.qMode : 0;   // (step C12g: 2 = from the field genes)
    f[57] = Q ? (Q.qMode === 2 ? Q.params.qGene : Q.params.qB) : 1; f[58] = Q ? Math.max(0.01, Q.params.feelSat) : 1;
    // step C6c: the honeycomb (omega^2 and the damping 2 zeta omega of the corners' springs, the turning, jelly)
    const SH = this.shape, om = 2 * Math.PI * SH.wobbleHz * Math.sqrt(Math.max(0.01, SH.stiffness));
    u[46] = SH.on ? 1 : 0;
    f[60] = om * om; f[61] = 2 * Math.max(0, SH.zeta) * om; f[62] = Math.max(0, SH.turn); f[63] = Math.max(0, SH.jelly);
    this.eat.membrane.writeFields(u, f, 64);   // step C6c: genetic elasticity, damaged sides softer, bursting
    this.dipole.writeFields(u, f, 68);         // step C6d: the dipoles
    f[67] = Math.max(0, this.genome.params.pumpJump ?? 0);   // step C7: pump slot jumps per birth (Fields.memb.w)
    this.eat.hardlight.writeFields(f, 80);     // step C8: hard light mutates (Fields.hm)
    this.fidelity.writeFields(u, f, 82);       // step G1: error correction (Fields.hm.z, hm.w; after the hard light's words)
    this.division.writeFields(f, u, 84);       // step C9: division and death (Fields.dv0..dv2)
    this.walls.writeFields(u, f, 96);          // step C10: patterned walls (Fields.wl0, wl1)
    this.guides.writeFields(u, f, 104);        // step C13: fields as genes and guides (Fields.fg0)
    this.kin.writeFields(u, f, 108);           // step T1a: the self marker's clock (Fields.t1)
    this.grn.writeFields(u, f, 110);           // step T1b: the gene network's outputs act (Fields.t1.z), field B's sense scale (t1.w)
    this.pred.writeFields(u, f, 112);          // step P1: predators (Fields.p1, p1b, p1c, p1d)
    this.glue.writeFields(u, f, 128);          // step G0: strong glue, junctions that break (Fields.g0a)
    if (this.stir) this.stir.writeFields(u, f, 132); else { u.fill(0, 132, 140); }   // step G0: the cells stir the water (Fields.g0b, g0c)
    if (this.obstacles) this.obstacles.writeFields(u, f, 140); else { u.fill(0, 140, 144); }   // step G0b: obstacles (Fields.ob0)
    this.dup.writeFields(u, f, 144);           // step G2: gene duplication (Fields.g2)
    u[147] = this.flow ? this.flow.chemoBits : 0;   // step N2: the chemotaxis gene's bits (Fields.g2.w; src/flow.js)
    this.motors.writeFields(u, f, 148);        // step S2: flagella and cilia (Fields.mo0..mo2)
    this.senses.writeFields(u, f, 160);        // step P3: cells that sense cells (Fields.p3a, p3b)
    this.mutation.writeFields(u, f);           // step M2: the mutation sweep (Fields.qA.yzw, qB.y)
    this.device.queue.writeBuffer(this.fieldsBuf, 0, this.fieldsAB);
  }

  /** Conversion thresholds (up, down) in units of A felt: quantiles of the culture's A felt when convAuto. */
  convThresholds() {
    const F = this.fields;
    if (!F.convAuto) return [F.convUp, F.convDown];
    const Q = this.aQuant;
    return Q ? [Q.up, Q.down] : [1e9, 0];   // none converts before the first census
  }

  /** Record the grid build for the tick whose uniforms are in slot k. */
  encodeGrid(encoder, k) {
    const g = this.grid, wg = Math.ceil(this.count / 256);
    encoder.clearBuffer(this.countsBuf, 0, (g.n + 2) * 4);   // (step C9: + the free slots' bucket; step P1: + the ghosts')
    encoder.clearBuffer(this.statsBuf, STATS_CLAIM, 4);      // step C9: no free slot claimed yet this tick
    const pass = encoder.beginComputePass({ label: 'cell grid' });
    pass.setBindGroup(0, this.gridBG, [k * SLOT]);
    pass.setPipeline(this.pipes.count); pass.dispatchWorkgroups(wg);
    pass.setPipeline(this.pipes.scan_local); pass.dispatchWorkgroups(Math.ceil((g.n + 2) / BLOCK));
    pass.setPipeline(this.pipes.scan_top); pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.scan_add); pass.dispatchWorkgroups(Math.ceil((g.n + 2) / 256));
    pass.setPipeline(this.pipes.scatter); pass.dispatchWorkgroups(wg);
    pass.end();
  }

  /** Record the physics for the tick in slot k (after its grid). */
  encodeStep(encoder, k) {
    const pass = encoder.beginComputePass({ label: 'cell step' });
    pass.setPipeline(this.pipes.step);
    pass.setBindGroup(0, this.stepBG[this.bioCur], [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 128));
    pass.end();
    this.bioCur ^= 1;
  }

  compute(encoder, frame) {
    if (this.gridTrash && this.gridTrash.length && !this.probing) { for (const x of this.gridTrash) x.destroy(); this.gridTrash.length = 0; }
    // step T1b: the cell types' census (a read-back every few s of simulated time), before this frame's ticks are encoded: bioCur still
    // names the genome copy the queue holds now
    this.grn.maybeCensus(frame.time);
    this.pred.maybeCensus(frame.time);   // step P1: the clusters' census (a read-back every few s)
    this.fidelity.maybeCensus(frame.time);   // step G1: the fidelity census (a read-back every few s)
    this.dup.maybeCensus(frame.time);        // step G2: the engines' census (a read-back every few s)
    this.mutation.maybeCensus(frame.time);   // step M2: generations, lines, genes (a read-back every few s)
    this.motors.maybeCensus(frame.time);     // step S2: where the motors are (a read-back every few s)
    this.senses.maybeCensus(frame.time);     // step P3: the taste, chases, glued groups (a read-back every few s)
    this.folding.maybeCensus(frame.time);    // step G3: folds, dose, buffering, hidden links (a read-back every few s)
    this.signals.maybeCensus(frame.time);    // step Q1: emitters, listeners, relays, waves (a read-back every few s)
    this.contract.maybeCensus(frame.time);   // step L1: who contracts (a read-back every few s)
    this.tendrils.maybeCensus(frame.time);   // step T2: tendrils, ropes, bone (a read-back every few s)
    if (this.organ) this.organ.maybeCensus(frame.time);   // step L1: the laid-out organ (src/organ.js; main.js sets it)
    if (this.gridSize() !== this.grid.cs) this.sizeGrid();   // params.cut or range changed
    // after a reset, the warm-up ticks run first (all in this frame, at the current time)
    const warm = Math.min(this.warm, SLOTS - frame.ticks);
    this.warm -= warm;
    const ticks = warm + frame.ticks;
    if (!ticks) return;
    this.heat.beginFrame(encoder, ticks, frame);
    if (this.heatVersion !== this.heat.version) this.makeStepBGs();
    // step C3: the substances drip and spread over the frame's real ticks (not the warm-up), in the heat buffer; step
    // C4: and react, each tick inside the heat's pass (after the cells' step, before the heat spreads)
    const M = this.matter;
    if (M) M.beginFrame(encoder, frame, warm);
    this.signals.beginFrame(encoder, frame, ticks);   // step Q1: the signal's uniforms (after the heat's: the currents; before the eat pass's), the pipette's puffs
    this.eat.beginFrame(frame, ticks);   // step C5: after the matter's, which decides the channels the cells may write into
    this.inspect.beginFrame(frame);      // step I1: the inspector's uniform
    for (let t = 0; t < ticks; t++) {
      const time = frame.time - Math.max(0, ticks - 1 - t) * frame.tickDt * (t < warm ? 0 : 1);
      this.writeSim(t, frame.tickDt, time, t === ticks - 1);
      this.tick++;
      if (t >= warm) { this.pointer.vx *= 0.8; this.pointer.vy *= 0.8; }   // the stir fades (reference: per frame)
    }
    this.device.queue.writeBuffer(this.simBuf, 0, this.simAB, 0, ticks * SLOT);
    this.writeFields();
    if (this.stir && this.stir.active) this.stir.ticks += ticks;   // step G0: the ticks whose push the stir passes read next frame
    encoder.clearBuffer(this.statsBuf, 48, 16);   // step 7: neighbour pairs by state, counted on the last tick
    encoder.clearBuffer(this.statsBuf, STATS_DIP, DIP_WORDS * 4);   // step C6d: the dipoles' census, also on the last tick
    encoder.clearBuffer(this.statsBuf, STATS_DIV + 4 * DIV_SNAP, 4 * (15 - DIV_SNAP));   // step C9: its snapshot, on the last tick
    encoder.clearBuffer(this.statsBuf, STATS_WALL, 4 * WALL_WORDS);   // step C10: the walls' census, on the last tick too
    encoder.clearBuffer(this.statsBuf, STATS_P1 + 4 * P1_CLEAR, 4 * (P1_WORDS - P1_CLEAR));   // step P1: the predators' census (its counters run on)
    encoder.clearBuffer(this.statsBuf, STATS_G0 + 4 * G0_CLEAR, 4 * (G0_WORDS - G0_CLEAR));   // step G0: the glue's census (its counters run on)
    encoder.clearBuffer(this.statsBuf, STATS_S1, 4 * S1_WORDS);       // step S1: the shape's census
    encoder.clearBuffer(this.statsBuf, STATS_S2, 4 * S2_WORDS);       // step S2: the motors' census
    encoder.clearBuffer(this.statsBuf, STATS_FG, 4 * FG_CLEAR);       // step C13: the field genes' and gates' census (the same; its
                                                                      // cumulative words after FG_CLEAR run on)
    for (let t = 0; t < ticks; t++) {
      this.encodeGrid(encoder, t);
      // ?check runs between the grid build and the move, so both see the same positions
      if (t === ticks - 1) this.maybeCheck(encoder, t, frame);
      this.encodeStep(encoder, t);
      this.inspect.encodeTick(encoder, t);   // step I1: births and deaths into the family tree (after the step: its newborns still marked)
      this.tendrils.encodeTick(encoder, t, SLOT);   // step T2: the tendrils pull, the bone holds (after the step: its newborns still marked)
      this.grn.encodeTick(encoder, t, SLOT);   // step T1b: the gene network (after the step, before the cells eat: its newborns still marked)
      this.eat.encodeTick(encoder, t, SLOT);   // step C5: the cells eat (after their step, before the dish spreads)
      this.signals.encodeTick(encoder, t);     // step Q1: the signal spreads and fades (after the cells released, before the heat spreads)
      this.heat.encodeTick(encoder, t, M && t >= warm ? (pass) => M.encodeTick(pass, t - warm) : null);
    }
    if (M) M.endTicks(encoder);
    this.heat.endFrame(encoder, ticks, frame);
    this.maybeCensus(encoder, ticks - 1, frame);
    this.maybeMotion(encoder, frame);
    this.inspect.encodeFrame(encoder);   // step I1: the inspector's read-backs (the log; the chosen cell's card)
    this.encodeField(encoder);
  }

  /** Scatter the cells' fields (A into r, B into g) into their texture (from the last tick's beats), if drawn. */
  encodeField(encoder) {
    const L = this.landscape;
    if (!this.fieldTex || !L) return;
    const onB = !!(this.fields.emit && L.params.fieldB);
    const onP = !!(L.params.partner && this.partnerDrawn());
    const on = (this.emitting() && L.params.cellField) || onB || onP;
    if (!on && this.fieldBlank) return;
    this.fieldBlank = !on;
    const v = this.view, a = new Float32Array([v.cssW, v.cssH, this.params.cut * this.R, onB ? this.fields.cut * this.R : 0, onP ? 1 : 0, this.partner.arrow ? 1 : -1, 0, 0]);
    this.device.queue.writeBuffer(this.fieldU, 0, a);
    const pass = encoder.beginRenderPass({
      label: 'cell field',
      colorAttachments: [{ view: this.fieldView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
    });
    if (on) {
      pass.setPipeline(this.fieldPipe);
      pass.setBindGroup(0, this.fieldBG);
      pass.draw(6, this.count);
    }
    pass.end();
  }

  // ---------- stats: census and read-back for the overlay ----------
  /** Every few frames: count jobs (step F0), key bins and founder lines, and copy the stats out (if a buffer is free). */
  maybeCensus(encoder, k, frame) {
    if (frame.frameNo % 4 !== 0) return;
    const rb = this.statsRead.find((r) => !r.busy);
    if (!rb) return;
    rb.busy = true;
    encoder.clearBuffer(this.statsBuf, 0, 32);                       // job counts (step F0)
    encoder.clearBuffer(this.statsBuf, STATS_CENSUS, STATS_DIP - STATS_CENSUS);   // key bins, founder bitmap (not the dipoles')
    const pass = encoder.beginComputePass({ label: 'cell census' });
    pass.setPipeline(this.pipes.census);
    pass.setBindGroup(0, this.censusBG[this.bioCur], [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
    encoder.copyBufferToBuffer(this.statsBuf, 0, rb.buf, 0, STATS_BYTES);
    encoder.clearBuffer(this.statsBuf, 40, 4);                       // event count: events restart after each copy
    const time = frame.time;
    setTimeout(() => this.readStats(rb, time), 0);                   // map once this frame is submitted
  }

  async readStats(rb, time) {
    try {
      await rb.buf.mapAsync(GPUMapMode.READ);
      const u = new Uint32Array(rb.buf.getMappedRange().slice(0));
      rb.buf.unmap();
      const f = new Float32Array(u.buffer);
      const job = Array.from(u.subarray(0, JOBS.length));   // step F0: cells per job (cell_census.wgsl; per fate until then)
      const births = u[8], deaths = u[9], heatDeaths = u[11];   // (step C5: of the deaths, from heat damage)
      const nEv = Math.min(u[10], STATS_EVENTS);
      const events = [];
      for (let e = 0; e < nEv; e++) events.push([f[16 + 4 * e], f[17 + 4 * e], f[18 + 4 * e], f[19 + 4 * e]]);   // (step T1c: w a death's cause + 16 x founder)
      // key bins holding a real share of the cells: a rough count of distinct lineages (genotype clusters)
      const bins = u.subarray(STATS_CENSUS / 4, STATS_CENSUS / 4 + 144);
      const big = Math.max(3, Math.max(1, job.reduce((x, y) => x + y, 0)) / 400);
      let clusters = 0;
      for (const b of bins) if (b >= big) clusters++;
      let founders = 0;
      for (let w = STATS_CENSUS / 4 + 144; w < STATS_EXTRA / 4; w++) { let x = u[w]; while (x) { x &= x - 1; founders++; } }
      // step 6: leaking and converted cells, histograms (STATS_X_* in cell_common.wgsl)
      const X = u.subarray(STATS_EXTRA / 4, STATS_EXTRA / 4 + 80);
      const step6 = { leak: X[0], conv: X[1], aHist: Array.from(X.subarray(2, 50)), sHist: Array.from(X.subarray(50, 60)), lHist: Array.from(X.subarray(60, 70)) };
      // step 7: cells per state, and same-type neighbour pairs (all, same state) from the frame's last tick
      const step7 = { perState: Array.from(X.subarray(70, 74)), pairs: u[12], same: u[13], touch: u[14], touchSame: u[15] };
      const step8 = { moved: X[74], dev: X[75] };
      // the conversion thresholds (convAuto): quantiles of the A felt across the culture (from the histogram,
      // interpolated in the bin), smoothed over about 20 s of simulation time
      const tot = step6.aHist.reduce((x, y) => x + y, 0);
      const quant = (p) => {
        let acc = 0;
        for (let k = 0; k < step6.aHist.length; k++) {
          const h = step6.aHist[k];
          if (acc + h >= p * tot) return (k + (p * tot - acc) / Math.max(h, 1)) * A_BIN;
          acc += h;
        }
        return step6.aHist.length * A_BIN;
      };
      if (tot > 0) {
        const F = this.fields, now = { up: quant(F.convUp), down: quant(F.convDown) }, Q = this.aQuant;
        const k = Q ? 1 - Math.exp(-Math.max(0, time - Q.time) / 20) : 1;
        this.aQuant = Q ? { up: Q.up + (now.up - Q.up) * k, down: Q.down + (now.down - Q.down) * k, time } : { ...now, time };
      }
      const H = this.statsHist;
      H.push([time, births, deaths, heatDeaths]);
      while (H.length > 2 && time - H[0][0] > 2) H.shift();
      const h0 = H[0], dt = time - h0[0];
      const rate = dt > 0.2 ? [((births - h0[1]) >>> 0) / dt, ((deaths - h0[2]) >>> 0) / dt, ((heatDeaths - h0[3]) >>> 0) / dt] : [0, 0, 0];
      this.stats = { time, job, births, deaths, heatDeaths, clusters, founders, birthRate: rate[0], deathRate: rate[1], heatDeathRate: rate[2], step6, step7, step8 };
      this.dipole.apply(time, new Int32Array(u.buffer, STATS_DIP, DIP_WORDS));   // step C6d
      // step C9: the live cells (the census counted them by job) and the division's counters
      this.alive = job.reduce((x, y) => x + y, 0);
      this.division.apply(time, new Uint32Array(u.buffer, STATS_DIV, 16), this.alive);
      this.walls.apply(time, new Uint32Array(u.buffer, STATS_WALL, WALL_WORDS));   // step C10
      this.guides.apply(time, new Uint32Array(u.buffer, STATS_FG, FG_WORDS));      // step C13
      this.pred.applyStats(time, new Uint32Array(u.buffer, STATS_P1, P1_WORDS));   // step P1
      this.glue.apply(time, new Uint32Array(u.buffer, STATS_G0, G0_WORDS));      // step G0
      this.spindle.apply(time, new Uint32Array(u.buffer, STATS_S1, S1_WORDS));   // step S1
      this.motors.apply(time, new Uint32Array(u.buffer, STATS_S2, S2_WORDS));    // step S2
      if (events.length && this.onEvents) this.onEvents(events);
      if (events.length) for (const t of this.eventTaps) t(events, time);
    } catch (e) {
      // device lost or page closing: nothing to show
    } finally {
      rb.busy = false;
    }
  }

  // ---------- motion: how the cells move, for the overlay ----------
  /**
   * About once per simulation second, copy the cells out and compare with the copy before: mean speed (the
   * damped velocity), mean net displacement per second (low against the speed = jittering on the spot), mean
   * stretch, and the spread of the culture (RMS distance from its centre of mass, in R).
   */
  maybeMotion(encoder, frame) {
    if (this.motionBusy || frame.time - (this.motionLast ?? -1e9) < 1) return;
    const d = this.device;
    if (!this.motionRead) {
      this.motionRead = d.createBuffer({ label: 'cells motion read', size: this.count * CELL_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    }
    this.motionBusy = true;
    this.motionLast = frame.time;
    encoder.copyBufferToBuffer(this.cellBuf, 0, this.motionRead, 0, this.count * CELL_BYTES);
    const time = frame.time;
    setTimeout(() => this.readMotion(time), 0);
  }

  async readMotion(time) {
    try {
      await this.motionRead.mapAsync(GPUMapMode.READ);
      const f = new Float32Array(this.motionRead.getMappedRange().slice(0));
      this.motionRead.unmap();
      const N = this.count, R = this.R, prev = this.motionPrev;
      const fu = new Uint32Array(f.buffer), live = new Uint8Array(N);   // step C9: the live cells only (a free slot: 0)
      let sp = 0, st = 0, cx = 0, cy = 0, net = 0, nNet = 0, n = 0;
      for (let i = 0; i < N; i++) {
        const o = i * CELL_FLOATS;
        if (!(fu[o + 9] & ALIVE)) continue;
        live[i] = 1; n++;
        sp += Math.hypot(f[o + 2], f[o + 3]); st += Math.hypot(f[o + 6], f[o + 7]);
        cx += f[o]; cy += f[o + 1];
      }
      n = Math.max(1, n);
      cx /= n; cy /= n;
      let r2 = 0;
      for (let i = 0; i < N; i++) { if (!live[i]) continue; const o = i * CELL_FLOATS; r2 += (f[o] - cx) ** 2 + (f[o + 1] - cy) ** 2; }
      const dt = prev ? time - prev.time : 0;
      if (prev && dt > 0.2) {
        for (let i = 0; i < N; i++) {
          if (!live[i] || !prev.live[i]) continue;
          const o = i * CELL_FLOATS, dd = Math.hypot(f[o] - prev.pos[2 * i], f[o + 1] - prev.pos[2 * i + 1]);
          if (dd < 8 * R * dt) { net += dd; nNet++; }   // a reborn cell jumps; leave those out
        }
      }
      const rot = prev && dt > 0.2 ? this.rotation(f, prev.pos, dt, cx, cy, live, prev.live) : null;
      const pos = new Float32Array(2 * N);
      for (let i = 0; i < N; i++) { pos[2 * i] = f[i * CELL_FLOATS]; pos[2 * i + 1] = f[i * CELL_FLOATS + 1]; }
      this.motionPrev = { time, pos, live };
      this.motion = { time, speed: sp / n, net: nNet ? net / nNet / dt : null, stretch: st / n, spread: Math.sqrt(r2 / n) / R, rot };
    } catch (e) {
      // device lost or page closing
    } finally {
      this.motionBusy = false;
    }
  }

  /**
   * Rotation, from the displacements over the last read-back interval (step 8): positions f (Cell layout) now,
   * prev (x, y pairs) dt seconds ago, about the culture's centre (cx, cy).
   *   spin   the whole culture's turning rate (deg/s; + = clockwise on screen): the best rigid-rotation fit,
   *          sum(r x v) / sum(r^2)
   *   swirl  local turning: the velocity averaged in square bins (6 R), its vorticity by central differences,
   *          halved (so a rigid rotation gives swirl = spin everywhere), in deg/s: the RMS over the bins (any sign),
   *          and the RMS left after taking out the culture's own spin (eddies, counter-rotating patches)
   *   eddies bins whose own swirl, minus the spin, is above 3 deg/s, and how many of them turn each way
   *   keep   how the bins' eddy turning correlates with the read-back before (persistent eddies near 1)
   */
  rotation(f, prev, dt, cx, cy, live, prevLive) {
    const n = this.count, R = this.R, W = this.view.cssW, H = this.view.cssH;
    let L = 0, I = 0;
    const b = 6 * R, gw = Math.max(3, Math.ceil(W / b)), gh = Math.max(3, Math.ceil(H / b));
    const vx = new Float32Array(gw * gh), vy = new Float32Array(gw * gh), cnt = new Uint16Array(gw * gh);
    for (let i = 0; i < n; i++) {
      if (live && (!live[i] || !prevLive || !prevLive[i])) continue;   // step C9: live cells only
      const o = i * CELL_FLOATS, x = f[o], y = f[o + 1];
      const ux = (x - prev[2 * i]) / dt, uy = (y - prev[2 * i + 1]) / dt;
      if (Math.hypot(ux, uy) > 8 * R) continue;          // a reborn cell jumps; leave those out
      const rx = x - cx, ry = y - cy;
      L += rx * uy - ry * ux; I += rx * rx + ry * ry;
      const g = Math.min(gh - 1, Math.max(0, Math.floor(y / b))) * gw + Math.min(gw - 1, Math.max(0, Math.floor(x / b)));
      vx[g] += ux; vy[g] += uy; cnt[g]++;
    }
    const spin = I > 0 ? L / I : 0;                       // rad/s, + = clockwise on screen (y points down)
    for (let g = 0; g < gw * gh; g++) if (cnt[g]) { vx[g] /= cnt[g]; vy[g] /= cnt[g]; }
    let s2 = 0, e2 = 0, nb = 0, cw = 0, ccw = 0;
    const vort = new Float32Array(gw * gh).fill(NaN), pv = this.rotPrev;
    let pc = 0, pa = 0, pb = 0;
    const deg = 180 / Math.PI, ok = (g) => cnt[g] >= 4;
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const g = y * gw + x;
        if (!ok(g) || !ok(g - 1) || !ok(g + 1) || !ok(g - gw) || !ok(g + gw)) continue;
        const w = 0.5 * ((vy[g + 1] - vy[g - 1]) - (vx[g + gw] - vx[g - gw])) / (2 * b);   // half the vorticity
        s2 += w * w; e2 += (w - spin) ** 2; nb++;
        vort[g] = w - spin;
        if (pv && pv.length === vort.length && !Number.isNaN(pv[g])) { pc += vort[g] * pv[g]; pa += vort[g] ** 2; pb += pv[g] ** 2; }
        if ((w - spin) * deg > 3) cw++; else if ((w - spin) * deg < -3) ccw++;
      }
    }
    this.rotPrev = vort;
    // persistence: correlation of each bin's eddy turning with its value one read-back earlier (1 = the same eddies keep
    // turning the same way, -1 = they reverse, about 0 = new eddies every time)
    const keep = pa > 0 && pb > 0 ? pc / Math.sqrt(pa * pb) : null;
    const S = { spin: spin * deg, swirl: nb ? Math.sqrt(s2 / nb) * deg : 0, eddy: nb ? Math.sqrt(e2 / nb) * deg : 0, bins: nb, cw, ccw, keep };
    // smoothed over about 5 s, as the 1 s numbers are noisy
    const P = this.rotSmooth, k = P ? 1 - Math.exp(-dt / 5) : 1;
    this.rotSmooth = P ? { spin: P.spin + (S.spin - P.spin) * k, swirl: P.swirl + (S.swirl - P.swirl) * k, eddy: P.eddy + (S.eddy - P.eddy) * k } : { ...S };
    return S;
  }

  // ---------- stirring (called by main.js on pointer moves) ----------
  /** The pointer moved by (dx, dy) to (x, y) while dragging: cells nearby are pushed along, as in the reference. */
  stirAt(x, y, dx, dy) {   // (named stir until step G3: cells.stir has been the G0 water stirrer since step G0, so a drag threw)
    const P = this.pointer;
    P.drag = true; P.x = x; P.y = y;
    P.vx = P.vx * 0.6 + dx * 24; P.vy = P.vy * 0.6 + dy * 24;
  }

  release() { Object.assign(this.pointer, { drag: false, vx: 0, vy: 0 }); }

  // ---------- timing ----------
  /**
   * Measure the GPU time of one tick's grid build and physics: submit each K times on its own, between frames,
   * and time it until the queue reports it done, minus the time an empty submit takes. Rough (+-0.1 ms), but
   * works in every browser (timestamp queries are optional and coarse). The physics copy writes to a scratch
   * buffer, and rebuilding the grid from the same positions changes nothing, so the probe does not disturb
   * the simulation.
   */
  async probe(K = 32) {
    if (this.probing) return;
    this.probing = true;
    const d = this.device, q = d.queue;
    try {
      if (!this.scratchBuf) {
        this.scratchBuf = d.createBuffer({ label: 'cells probe scratch', size: this.count * CELL_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      }
      if (!this.scratchStats) {
        this.scratchStats = d.createBuffer({ label: 'cells probe stats', size: STATS_BYTES, usage: GPUBufferUsage.STORAGE });
        this.scratchBio = d.createBuffer({ label: 'cells probe bio', size: this.count * BIO_BYTES, usage: GPUBufferUsage.STORAGE });
      }
      if (!this.scratchHeat || this.scratchHeat.size !== this.heat.bytes) {
        if (this.scratchHeat) this.scratchHeat.destroy();
        this.scratchHeat = d.createBuffer({ label: 'cells probe heat', size: this.heat.bytes, usage: GPUBufferUsage.STORAGE });
      }
      // the probe writes only to scratch buffers, so it changes nothing the simulation sees
      const scratchBG = this.makeStepBG(this.scratchBuf, this.bioBuf[this.bioCur], this.scratchBio, this.scratchStats, this.scratchHeat);
      // (step C6c: the step reads each cell itself from its slot, so the scratch copy starts as the cells are now)
      { const e = d.createCommandEncoder({ label: 'cells probe copy' }); e.copyBufferToBuffer(this.cellBuf, 0, this.scratchBuf, 0, this.count * CELL_BYTES); q.submit([e.finish()]); }
      const record = (fn) => { const e = d.createCommandEncoder({ label: 'cells probe' }); for (let k = 0; k < K; k++) fn(e); return e.finish(); };
      const gridCB = record((e) => this.encodeGrid(e, 0));
      const stepCB = record((e) => {
        const pass = e.beginComputePass({ label: 'cell step (probe)' });
        pass.setPipeline(this.pipes.step);
        pass.setBindGroup(0, scratchBG, [0]);
        pass.dispatchWorkgroups(Math.ceil(this.count / 128));
        pass.end();
      });
      const timed = async (cbs) => { const t0 = performance.now(); q.submit(cbs); await q.onSubmittedWorkDone(); return performance.now() - t0; };
      await q.onSubmittedWorkDone();
      const base = await timed([]);
      const tg = await timed([gridCB]);
      const ts = await timed([stepCB]);
      const now = { grid: Math.max(0, tg - base) / K, step: Math.max(0, ts - base) / K };
      const T = this.timing;
      this.timing = T ? { grid: T.grid + (now.grid - T.grid) * 0.3, step: T.step + (now.step - T.step) * 0.3 } : now;
    } finally {
      this.probing = false;
    }
  }

  /** Lines for the F overlay. */
  overlayLines() {
    const g = this.grid, p = this.params, T = this.timing, c = this.checkResult;
    const lines = [
      `cells <b>${this.alive}</b> alive of ${this.count} slots (started with ${this.start}) · r ${this.R.toFixed(2)} px · grid ${g.gw}×${g.gh} (${g.cs.toFixed(1)} px) · contact push ${p.contact ? 'on' : 'off'}`,
      T ? `cells per tick (gpu, probe): grid ${T.grid.toFixed(2)} ms · physics ${T.step.toFixed(2)} ms` : 'cells per tick (gpu, probe): measuring',
    ];
    const st = this.stats, r = this.genome.rules, on = (x) => (x ? 'on' : 'off');
    if (st) {
      lines.push(`jobs: ${JOBS.map((J, k) => `${J.label} <b>${st.job[k]}</b>`).join(' · ')}`);   // (step F0: a job counts once it shows at least half)
      lines.push(`lineages: ${st.founders} founder lines · ${st.clusters} key clusters · births ${st.birthRate.toFixed(1)}/s · deaths ${st.deathRate.toFixed(1)}/s` +
        ` (from heat ${st.heatDeathRate.toFixed(1)}/s; ${st.heatDeaths} so far)`);
    }
    lines.push(`rules: H adhesion ${on(r.adh)} · B body ${on(r.body)} · T turnover ${on(r.turn)} · M mutation ${on(r.mut)} · view ${this.look.view ? 'lineage' : 'job'}`);
    const mo = this.motion;
    lines.push(`loop: S sense ${on(p.senseOn)} · O emit ${on(p.emit)} · W active shape ${on(p.active)} · X beat ${ANCHORS[p.anchor] || p.anchor} · R tuning by ${p.receptor ? 'receptor' : 'own lattice'} · lever ${p.lever.toFixed(2)}` +
      (mo ? ` · speed ${mo.speed.toFixed(1)} px/s · net ${mo.net == null ? '-' : mo.net.toFixed(1)} px/s · stretch ${mo.stretch.toFixed(2)} · spread ${mo.spread.toFixed(1)} R` : ''));
    const ro = mo && mo.rot, rs = this.rotSmooth;
    if (ro && rs) {
      lines.push(`rotation (deg/s, + clockwise; 5 s mean in brackets): culture spin ${ro.spin.toFixed(2)} (${rs.spin.toFixed(2)})` +
        ` · local swirl rms ${ro.swirl.toFixed(1)} (${rs.swirl.toFixed(1)}) · eddies after the spin rms ${ro.eddy.toFixed(1)} (${rs.eddy.toFixed(1)})` +
        ` · bins of 6 R turning > 3 deg/s: ${ro.cw} clockwise, ${ro.ccw} anticlockwise of ${ro.bins}` +
        ` · eddies kept from the last second ${ro.keep == null ? '-' : ro.keep.toFixed(2)}`);
    }
    const F = this.fields, L = this.landscape;
    lines.push(`field B: Q felt ${on(F.on)} · J drawn ${on(L && L.params.fieldB)} · U like ${(this.charge ? this.charge.signB : F.sign) > 0 ? 'repels' : 'attracts'} like · like = ${F.like ? 'similar key (lineage)' : 'charge'}` +
      ` · band ${F.band} · r0 ${F.r0} R · cut ${F.cut} R · gain ${F.gain} · charges ${this.charge && this.charge.stockOn ? `from the stock (Shift+8; else ${F.chargeB} for all)` : this.charge && this.charge.genesOn ? 'from the field genes (the sign of the B sensing gene)' : `${F.chargeB} for all`}`);
    const s6 = st && st.step6;
    if (s6) {
      // a histogram's value below which a share p of the cells lie (bins of width w)
      const pct = (h, p, w) => { const n = h.reduce((x, y) => x + y, 0); let acc = 0; for (let k = 0; k < h.length; k++) { acc += h[k]; if (acc >= p * n) return (k + 1) * w; } return h.length * w; };
      lines.push(`step 6: 4 leak ${on(F.leakOn)} (${s6.leak} cells leaking) · stretch p50 ${pct(s6.sHist, 0.5, 0.05).toFixed(2)} p90 ${pct(s6.sHist, 0.9, 0.05).toFixed(2)}` +
        ` · stretched > 0.35: ${s6.sHist.slice(7).reduce((x, y) => x + y, 0)} · leak level > 0.5: ${s6.lHist.slice(5).reduce((x, y) => x + y, 0)}`);
      lines.push(`step 6: 5 conversion ${on(F.convOn)} (${s6.conv} converted) · 6 mode ${F.convMode ? 'flip B charge' : 'boost B'} x${F.conv}` +
        ` · 7 relay ${on(F.relayOnKey)} · up ${this.convThresholds()[0].toFixed(2)} down ${this.convThresholds()[1].toFixed(2)}` +
        `${F.convAuto ? ' (quantiles ' + F.convUp + ' / ' + F.convDown + ' of the A felt)' : ''} · A felt p25 ${pct(s6.aHist, 0.25, A_BIN).toFixed(2)} p50 ${pct(s6.aHist, 0.5, A_BIN).toFixed(2)} p90 ${pct(s6.aHist, 0.9, A_BIN).toFixed(2)}`);
    }
    const s7 = st && st.step7, X = this.excl;
    if (s7) {
      // same-state share among same-type neighbours, and what random mixing of the states would give
      const n = s7.perState.reduce((x, y) => x + y, 0), rnd = n ? s7.perState.reduce((x, y) => x + (y / n) ** 2, 0) : 0;
      lines.push(`step 7: 8 exclusion ${on(X.on)} · 9 flip ${on(X.flip)} · ${X.states} states (${s7.perState.slice(0, X.states).join(' / ')} cells) · hard x${X.hard} out to ${X.reach} · other state packs to ${X.pack}` +
        ` · same state among same-type neighbours: touching ${s7.touch ? (100 * s7.touchSame / s7.touch).toFixed(0) : '-'}%, within 1.6 ${s7.pairs ? (100 * s7.same / s7.pairs).toFixed(0) : '-'}%` +
        ` (random mixing ${(100 * rnd).toFixed(0)}%) · per cell ${(s7.touch / Math.max(1, n)).toFixed(2)} touching, ${(s7.pairs / Math.max(1, n)).toFixed(2)} within 1.6`);
    }
    const P = this.partner;
    lines.push(`step 8, partner A': Z phase current ${on(P.on)} (gain ${P.gain}, sat ${P.sat} R/s, eps ${P.eps}) · waves ${P.arrow ? 'one way (arrow)' : 'symmetric'}` +
      ` · , change makes partner ${on(P.change)} ' ${P.chMode ? `clock (${P.omega} rad/s, pull ${P.pull} rad/s, lag ${P.lag})` : `felt change (gain ${P.chGain} s, follow ${P.chTau} s, cap ${P.chMax}, sign ${P.chSign})`}` +
      ` · . sideways push ${on(P.side)} (${P.sideMode ? 'across the motion' : 'partner force turned 90°'}, gain ${P.sideGain})` +
      (st && st.step8 ? ` · phasor off (1,0) by > 0.25: ${st.step8.moved} cells, mean ${(st.step8.dev / 1000 / Math.max(1, this.alive)).toFixed(3)}` : '') + ` · ; drawn ${on(L && L.params.partner)}`);
    lines.push(...this.heat.overlayLines(this.view));
    if (c) {
      lines.push(`grid check: ${c.contacts / 2} contacts` + (c.brute ? ` (brute force ${c.bruteContacts / 2}, ${c.mismatch} cells differ)` : '') +
        ` · ${c.badSort} bad slots · overlap mean ${(100 * c.ovMean).toFixed(1)}% max ${(100 * c.ovMax).toFixed(1)}%`);
    }
    return lines;
  }

  // ---------- ?check: the grid's contacts against brute force ----------
  enableCheck() {
    this.checkOn = true;
    this.nextCheck = 1;
    this.makeCheck();
  }

  makeCheck() {
    if (!this.checkOn || !this.countsBuf) return;
    const d = this.device, U = GPUBufferUsage, n = this.count;
    if (!this.checkBuf) {
      this.checkBuf = d.createBuffer({ label: 'check result', size: n * 16, usage: U.STORAGE | U.COPY_SRC });
      this.checkRead = d.createBuffer({ label: 'check readback', size: n * 16, usage: U.MAP_READ | U.COPY_DST });
      this.checkU = d.createBuffer({ label: 'check params', size: 16, usage: U.UNIFORM | U.COPY_DST });
      d.queue.writeBuffer(this.checkU, 0, new Uint32Array([n <= BRUTE_MAX ? 1 : 0, 0, 0, 0]));
    }
    const b = (binding, buffer) => ({ binding, resource: { buffer } });
    this.checkBG = d.createBindGroup({
      label: 'cell check', layout: this.checkL.bgl,
      entries: [{ binding: 0, resource: { buffer: this.simBuf, size: SIM_BYTES } }, b(1, this.cellBuf),
        b(2, this.countsBuf), b(3, this.startsBuf), b(4, this.sortedBuf), b(5, this.sortIdxBuf),
        b(6, this.checkBuf), b(7, this.checkU)],
    });
  }

  maybeCheck(encoder, k, frame) {
    if (!this.checkOn || this.checkBusy || frame.time < this.nextCheck) return;
    this.nextCheck = frame.time + 2;
    this.checkBusy = true;
    const pass = encoder.beginComputePass({ label: 'cell check' });
    pass.setPipeline(this.pipes.check);
    pass.setBindGroup(0, this.checkBG, [k * SLOT]);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
    encoder.copyBufferToBuffer(this.checkBuf, 0, this.checkRead, 0, this.count * 16);
    // map once this frame has been submitted (main.js submits right after the layers have encoded)
    setTimeout(() => this.readCheck(frame.time), 0);
  }

  async readCheck(time) {
    try {
      await this.checkRead.mapAsync(GPUMapMode.READ);
      const r = new Uint32Array(this.checkRead.getMappedRange().slice(0));
      this.checkRead.unmap();
      const f = new Float32Array(r.buffer);
      const n = this.count, brute = n <= BRUTE_MAX;
      let contacts = 0, bruteContacts = 0, mismatch = 0, ovMax = 0, ovSum = 0, touching = 0, badSort = 0;
      for (let i = 0; i < n; i++) {
        if (r[4 * i + 3] !== 1) badSort++;
        const b = r[4 * i], g = r[4 * i + 1], ov = f[4 * i + 2];
        contacts += g; bruteContacts += b;
        if (brute && b !== g) mismatch++;
        if (g) { touching++; ovSum += ov; }
        ovMax = Math.max(ovMax, ov);
      }
      const res = { time, n, brute, contacts, bruteContacts, mismatch, badSort, ovMean: touching ? ovSum / touching : 0, ovMax };
      this.checkResult = res;
      const msg = `grid check t=${time.toFixed(1)} s: ${n} cells, ${contacts / 2} contacts via grid` +
        (brute ? `, ${bruteContacts / 2} by brute force, ${mismatch} cells differ` : ` (no brute force above ${BRUTE_MAX})`) +
        `; ${badSort} bad sort slots (grid ${this.grid.gw}x${this.grid.gh})` +
        `; deepest overlap per touching cell: mean ${(100 * res.ovMean).toFixed(1)}%, max ${(100 * ovMax).toFixed(1)}% of r_i + r_j`;
      if ((brute && mismatch) || badSort) console.warn(msg); else console.log(msg);
    } catch (e) {
      console.warn('grid check failed: ' + (e && e.message));
    } finally {
      this.checkBusy = false;
    }
  }

  /**
   * Step C6n: the cells' activity for the hum (drawing only; src/neon.js calls it each frame while the hum is on): how fast
   * each battery changes, smoothed (cell_glow.wgsl).
   */
  encodeGlow(encoder, f) {
    const keep = Math.exp(-Math.max(0, f.realDt || 0) / Math.max(1e-3, this.look.humTau));
    const ab = new ArrayBuffer(16), u = new Uint32Array(ab), x = new Float32Array(ab);
    u[0] = this.count; x[1] = f.dt; x[2] = keep;
    this.device.queue.writeBuffer(this.glowU, 0, ab);
    const pass = encoder.beginComputePass({ label: 'cell glow' });
    pass.setPipeline(this.glowPipe);
    pass.setBindGroup(0, this.glowBG);
    pass.dispatchWorkgroups(Math.ceil(this.count / 256));
    pass.end();
  }

  /**
   * Step C6c, for tuning and checking the honeycomb (console, tools): reads the cells back and measures, over neighbouring
   * pairs (centres closer than 1.3 x the sum of their radii, and neighbours in the power diagram: their tiles share a wall), the gap between the two outlines along the line joining the
   * centres, in units of R (negative = overlap; ellipse cells: their drawn ellipses): its percentiles, the share of pairs
   * whose outlines meet within 0.05 R (shared walls) and overlap by more than 0.05 R; the centres' distance over the sum of
   * the radii; the corners' distance from the centre over r; how many neighbours each cell's outline meets; the stretch.
   */
  async shapeStats() {
    const d = this.device, n = this.count, F = CELL_FLOATS, R = this.R;
    const buf = d.createBuffer({ size: n * CELL_BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(this.cellBuf, 0, buf, 0, n * CELL_BYTES);
    d.queue.submit([e.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(buf.getMappedRange().slice(0));
    const u = new Uint32Array(f.buffer);
    buf.unmap(); buf.destroy();
    // the outline's distance from the centre along the direction (ux, uy)
    const radial = (o, ux, uy) => {
      const hex = (u[o + 9] & 8) !== 0, r = f[o + 4];
      if (!hex) {   // ellipse: x = F (r v), |v| = 1, along u: r / |F^-1 u|
        const e1 = f[o + 6], e2 = f[o + 7], eps = Math.hypot(e1, e2);
        let fa = 1, fb = 0, fd = 1;
        if (eps > 1e-4) { const ch = Math.cosh(eps), sh = Math.sinh(eps) / eps; fa = ch + sh * e1; fb = sh * e2; fd = ch - sh * e1; }
        return r / Math.hypot(fd * ux - fb * uy, fa * uy - fb * ux);
      }
      // the corners' angles from corner 0's (theta + k x 60 degrees + alpha[k]), and the side the direction falls on
      const T = 2 * Math.PI, ang = [];
      for (let k = 0; k < 6; k++) ang.push(k * Math.PI / 3 + f[o + 42 + k] - f[o + 42]);
      let a = Math.atan2(uy, ux) - f[o + 38] - f[o + 42];
      a -= T * Math.floor(a / T);
      let k = 5;
      while (k > 0 && a < ang[k]) k--;
      const a1 = k < 5 ? ang[k + 1] : T, t = a - ang[k], D = a1 - ang[k];
      const r0 = f[o + 26 + k], r1 = f[o + 26 + (k + 1) % 6];
      // the ray at angle t from corner k meets the side from (r0 at 0) to (r1 at D): 1 / lambda = (sin(D - t) / r0 +
      // sin t / r1) / sin D
      return r0 * r1 * Math.sin(D) / (r1 * Math.sin(D - t) + r0 * Math.sin(t) + 1e-9);
    };
    const cs = 3 * R, gw = Math.ceil(this.view.cssW / cs) + 1, gh = Math.ceil(this.view.cssH / cs) + 1;
    const grid = new Map();
    const alive = [];
    for (let i = 0; i < n; i++) {
      const o = i * F;
      if (!(u[o + 9] & 1)) continue;
      alive.push(i);
      const g = Math.floor(f[o + 1] / cs) * gw + Math.floor(f[o] / cs);
      if (!grid.has(g)) grid.set(g, []);
      grid.get(g).push(i);
    }
    const gaps = [], dist = [], corners = [], meets = new Uint16Array(n), stretch = [];
    let hexCells = 0;
    for (const i of alive) {
      const o = i * F, x = f[o], y = f[o + 1], gx = Math.floor(x / cs), gy = Math.floor(y / cs);
      if (u[o + 9] & 8) { hexCells++; for (let k = 0; k < 6; k++) corners.push(f[o + 26 + k] / f[o + 4]); }
      stretch.push(Math.hypot(f[o + 6], f[o + 7]));
      for (let yy = gy - 1; yy <= gy + 1; yy++) for (let xx = gx - 1; xx <= gx + 1; xx++) {
        for (const j of grid.get(yy * gw + xx) || []) {
          if (j <= i) continue;
          const p = j * F, dx = f[p] - x, dy = f[p + 1] - y, dd = Math.hypot(dx, dy), R0 = f[o + 4] + f[p + 4];
          if (dd > 1.3 * R0 || dd < 1e-6) continue;
          const ux = dx / dd, uy = dy / dd;
          // tile neighbours only: the point on the centre line where the two power distances |x - p|^2 - r^2 are equal
          // must not be nearer (in that sense) to a third cell, else the two only meet at a corner of their tiles
          const w = 0.5 * dd + (f[o + 4] ** 2 - f[p + 4] ** 2) / (2 * dd), mx = x + ux * w, my = y + uy * w;
          const pw = (mx - x) ** 2 + (my - y) ** 2 - f[o + 4] ** 2;
          let tile = true;
          for (let y2 = gy - 1; y2 <= gy + 1 && tile; y2++) for (let x2 = gx - 1; x2 <= gx + 1 && tile; x2++) {
            for (const k of grid.get(y2 * gw + x2) || []) {
              if (k === i || k === j) continue;
              const q = k * F;
              if ((mx - f[q]) ** 2 + (my - f[q + 1]) ** 2 - f[q + 4] ** 2 < pw - 1e-6) { tile = false; break; }
            }
          }
          if (!tile) continue;
          const gap = (dd - radial(o, ux, uy) - radial(p, -ux, -uy)) / R;
          gaps.push(gap); dist.push(dd / R0);
          if (Math.abs(gap) < 0.05) { meets[i]++; meets[j]++; }
        }
      }
    }
    const pct = (a, q) => { const s = Float64Array.from(a).sort(); return s.length ? +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(3) : null; };
    const share = (a, fn) => a.length ? +(a.filter(fn).length / a.length).toFixed(3) : null;
    const mh = alive.map((i) => meets[i]);
    return {
      cells: alive.length, honeycomb: hexCells, pairs: gaps.length,
      gapR: { p10: pct(gaps, 0.1), p50: pct(gaps, 0.5), p90: pct(gaps, 0.9) },
      wallsShared: share(gaps, (g) => Math.abs(g) < 0.05), overlap: share(gaps, (g) => g < -0.05),
      distOverR0: { p10: pct(dist, 0.1), p50: pct(dist, 0.5), p90: pct(dist, 0.9) },
      cornerOverR: corners.length ? { p10: pct(corners, 0.1), p50: pct(corners, 0.5), p90: pct(corners, 0.9) } : null,
      wallsPerCell: { mean: +(mh.reduce((a, b) => a + b, 0) / Math.max(1, mh.length)).toFixed(2), six: share(mh, (m) => m === 6), zero: share(mh, (m) => m === 0) },
      stretch: { p50: pct(stretch, 0.5), p90: pct(stretch, 0.9) },
    };
  }

  /** Step C6n, for tuning the hum (console): percentiles of the cells' activity (battery share changed per s). */
  async glowStats() {
    const d = this.device, n = this.count;
    const rb = d.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const e = d.createCommandEncoder();
    e.copyBufferToBuffer(this.glowBuf, 0, rb, 0, n * 8);
    d.queue.submit([e.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(rb.getMappedRange().slice(0));
    rb.destroy();
    const a = Array.from({ length: n }, (_, i) => f[2 * i + 1]).sort((x, y) => x - y);
    const q = (p) => a[Math.min(n - 1, Math.floor(p * n))];
    return { p10: q(0.1), p50: q(0.5), p90: q(0.9), p99: q(0.99), max: a[n - 1] };
  }

  render(pass, frame = {}) {
    const v = this.view, L = this.look, a = this.drawData, P = pal();
    const look = frame.look || {}, neon = !!look.neon, hum = neon && !!look.hum;
    a[0] = v.cssW; a[1] = v.cssH; a[2] = v.dpr; a[3] = this.R;
    a[4] = neon ? L.nFill : L.fill; a[5] = neon ? L.nFillA : L.fillA; a[6] = neon ? L.nLine : L.line; a[7] = L.lineW;
    a[8] = L.innerDots ? (neon ? L.nDots : L.dots) : 0; a[9] = L.dotR; a[10] = L.period; a[11] = L.view; a[12] = neon ? L.nFillC : L.fillC; a[13] = this.params.lever;
    // step 6 marks, in field B's ink (the landscape's), a little brighter than its halftone
    const F = this.fields, bc = P.field.B;
    a[14] = F.leakOn && L.marks ? L.leakDot : 0; a[15] = L.leakMin;
    a[16] = bc[0] / 255 * 0.85; a[17] = bc[1] / 255 * 0.85; a[18] = bc[2] / 255 * 0.85; a[19] = F.convOn && L.marks ? 1 : 0; a[20] = L.convFill;
    // step 7: the state bar (only while exclusion is on)
    const X = this.excl;
    a[21] = X.on && L.stateMark && L.marks ? Math.max(1, Math.min(4, Math.round(X.states))) : 0; a[22] = L.bar;
    // step 8: the phasor's hand, in the partner's ink
    const pc = P.field.P;
    a[23] = this.partner.change && L.marks ? (this.partner.chMode ? -L.hand : L.hand) : 0; a[24] = pc[0] / 255; a[25] = pc[1] / 255; a[26] = pc[2] / 255;
    // step C5: the battery's core and the starving cells' dimming (while the cells eat)
    const eating = this.eat && this.eat.params.on;
    a[28] = eating ? L.core : 0; a[29] = eating ? (neon ? L.nStarveDim : L.starveDim) : 0; a[30] = L.starve;
    for (let k = 0; k < 3; k++) a[32 + k] = P.core[k] / 255;
    // step C6: the parts (while the engines run) and the strategy view's inks
    const inks = [P.band[1], P.band[2], P.band[3], P.burn, P.sed, P.swap, P.other];
    inks.forEach((ink, j) => { for (let k = 0; k < 3; k++) a[36 + 4 * j + k] = ink[k] / 255; });
    a[39] = L.parts && this.eat && this.eat.rule('engines') ? 1 : 0; a[43] = L.partSize; a[47] = L.partDist;
    const kinds = (lo) => ENGINES.slice(lo, lo + 16).reduce((m, e, k) => m | (e.kind << (2 * k)), 0) >>> 0;
    this.drawU32[51] = kinds(0); this.drawU32[35] = kinds(16);   // the engines' kinds, 2 bits each
    a[55] = Math.max(1e-3, L.partRate); a[59] = L.coreParts; a[63] = neon ? L.nStrategyFill : L.strategyFill;
    if (a[39] > 0) a[8] *= L.partDots;
    // step C6n: the neon look and the hum (words 64..83 spare: the fates' inks until step F0; step G2: 64, 65 the copies' parts)
    this.dup.writeDraw(a, 64);
    a[84] = neon ? 1 : 0; a[85] = L.tube; a[86] = L.white; a[87] = L.innerReach;
    a[88] = L.innerGlow; a[89] = L.coreRim; a[90] = L.partWhite; a[91] = L.coreDim;
    a[92] = hum ? L.humDepth : 0; a[93] = L.humRate; a[94] = (frame.now || 0) % 3600; a[95] = hum ? 1 : 0;
    a[96] = hum ? L.humIdle : 1; a[97] = L.humAct; a[98] = P.lineage.base; a[99] = P.lineage.amp;
    // step C6b: colour by charge (view 3): the charge contours' inks
    for (let k = 0; k < 3; k++) { a[100 + k] = P.charge.pos[k] / 255; a[104 + k] = P.charge.neg[k] / 255; }
    // step C6c: the honeycomb outline's corner rounding and the tubes' gap from the wall
    a[108] = Math.max(0, L.corner); a[109] = Math.max(0, L.wallGap);
    // step C6c: the membrane chemistry's look (src/membrane.js)
    const MB = this.eat && this.eat.membrane;
    a[112] = L.membLook && MB && MB.rule('on') ? 1 : 0; a[113] = L.membDim; a[114] = L.membBreak; a[115] = L.membInner;
    a[116] = L.membFlicker; a[117] = L.membFlash; a[118] = L.membWide; a[119] = MB ? MB.params.tRef : 0.012;
    this.dipole.writeDraw(a, 120, L, L.view === 3);   // step C6d: the dipoles' look
    // step C7: the pumps' notches (while the pumps run) and the voltage's rim (the machinery), each substance's ink
    const PU = this.pumps;
    a[128] = L.pumpParts && PU && PU.rule('on') ? 1 : 0; a[129] = L.pumpSize; a[130] = PU && PU.rule('voltage') && L.marks ? L.voltRim : 0;
    a[131] = Math.max(1e-3, L.voltFull); a[132] = Math.max(1e-3, L.pumpRate); a[133] = L.pumpTint;
    SUBSTANCES.slice(0, 13).forEach((sb, c) => {   // (step C12: the 13 the cells hold; the oil and amphiphiles stay in the open)
      const I = P.substances[sb.func] || P.substances.linker;
      for (let k = 0; k < 3; k++) a[136 + 4 * c + k] = (I.light[k] + (I.heavy[k] - I.light[k]) * sb.heavy) / 255;
    });
    this.division.writeDraw(a, 188);   // step C9: a division's flash, a starving cell's fading
    this.walls.writeDraw(a, 192, L, P);   // step C10: the walls' look (sticky sides, matured junctions, the front, the walls view)
    const u3 = (rgb) => rgb.map((x) => x / 255);
    this.eat.lipids.writeDraw(a, 216, { crustLight: u3(P.lipid.crustLight), crustHeavy: u3(P.lipid.crustHeavy), pearl: u3(P.lipid.pearl) });   // step C12b
    this.guides.writeDraw(a, 236, L);   // step C13: the guides view
    a[0] = v.cssW / camera.z; a[1] = v.cssH / camera.z; a[2] = v.dpr * camera.z; a.set(camera.vec(), 264);   // app: the view camera
    const HM = look.harmonic;            // step H1: the harmonic look (src/harmonic.js)
    if (HM) HM.writeCells(a, 268);
    this.kin.writeDraw(a, 304, L, camera.z);   // step T1a: the lineage (marker) view, the marker's texture when zoomed in
    this.grn.writeDraw(a, 308, L);             // step T1b: the reporter view
    this.pred.writeDraw(a, 320);               // step P1: the wraps' arms, the phagosomes
    P.job.forEach((ink, j) => { for (let k = 0; k < 3; k++) a[328 + 4 * j + k] = ink[k] / 255; });   // step F0: the jobs' inks
    this.folding.writeDraw(a, 356, neon);    // step G3: a refold's flash
    this.signals.writeDraw(a, 368, neon);    // step Q1: the signals view, the release flash
    lod.writeCells(a, 372);                  // step V1: LOD from band limits
    this.device.queue.writeBuffer(this.drawU, 0, this.drawAB);
    // step S2: the flagella and cilia first (src/motors.js; a body then covers its flagellum's root)
    this.motors.render(pass, { view: v, cam: camera.vec(), zoom: camera.z, neon, harmonic: !!HM, time: frame.time || 0, palette: P, cheap: !!look.cheap });
    this.tendrils.render(pass, { view: v, cam: camera.vec(), zoom: camera.z, neon, harmonic: !!HM, time: frame.time || 0, palette: P });   // step T2
    pass.setPipeline(HM ? this.harmPipe : this.drawPipe);
    pass.setBindGroup(0, (HM ? this.harmBGs : this.drawBGs)[this.bioCur]);
    pass.draw(6, this.count);
    this.tendrils.renderOver(pass);   // step T2: the bone's lamellae over the cells
  }
}
