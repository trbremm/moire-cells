// Step I1, the CELL INSPECTOR's bookkeeping (src/inspect.js). It READS the cells and writes only its own buffers (and zeroes the eat pass's
// engine counters at a birth), so the simulation is the same with or without it. Needs heat_common.wgsl and cell_common.wgsl in front
// (struct Sim, struct Cell, the flags).
//
// Every tick, right after the cells' step (its newborns still carry CELL_BORN and their mother in Cell.mom), two dispatches:
//   detect  every slot: a cell that is new here (alive now, and the slot was empty or held another cell: its seed changed) gets a BIRTH ID
//           (an atomic counter) and its MOTHER's id (read from her slot, which no thread changes in this dispatch); a cell that was here and
//           is gone (dead, or replaced) is logged as a DEATH with what is knowable of the cause: eaten (its slot is a predator's ghost; the
//           predator's meals count up), burst (its last tick showed the burst flash), starved (its starving clock ran out), hot (it was above
//           its heat tolerance), else old age (the background rate); in the turnover mode or when a culture or snapshot replaced it: so
//   commit  the new ids into their slots (birth time, how born), the eat pass's engine counters of the slot zeroed, the birth logged
// The LOG is a ring of 4-word entries read back by the CPU (src/inspect.js), which keeps the family tree of every cell since the page
// started: [kind (0 birth, 1 death) | detail << 1 (how born / the cause) | slot << 8, id, mother's id (a birth) or the predator's (eaten),
// time (f32 bits)]. Words 0..3 of the log buffer: the next id, the entries written so far (wrapping), 0, 0.

struct InspP {
  count: u32,        // slots
  ring: u32,         // log entries the ring holds
  starve: f32,       // the starving time that kills (s; src/division.js starveTime)
  _p: u32,
};

@group(0) @binding(0) var<uniform> S: Sim;
@group(0) @binding(1) var<storage, read> cells: array<Cell>;
@group(0) @binding(2) var<storage, read> bio: array<f32>;                  // this tick's genomes, as plain words (Bio.env.x = word 24)
@group(0) @binding(3) var<storage, read_write> info: array<atomic<u32>>;   // per slot IW words (below)
@group(0) @binding(4) var<storage, read_write> logb: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> ran: array<atomic<u32>>;    // the eat pass's engine counters (cell_eat.wgsl ran_add)
@group(0) @binding(6) var<uniform> IP: InspP;

const IW: u32 = 12u;       // info words per slot: 0 id, 1 mother's id, 2 birth time (f32), 3 seed, 4 the flags last seen, 5 how born,
                           // 6 meals (cells it engulfed), 7 spare; 8..11 the detect pass's pending birth (id, mother, how, 1)
const RAN_W: u32 = 8u;
const BIO_W: u32 = 256u;   // Bio floats (src/genome.js BIO_FLOATS)
const HOW_PLACED: u32 = 0u;     // a founder of a culture, a cell placed by hand, or one loaded from a snapshot
const HOW_DIV: u32 = 1u;        // a division's daughter
const HOW_TURN: u32 = 2u;       // the turnover mode's newborn (a dead neighbour's slot)
const DIE_OTHER: u32 = 0u;      // old age (the background death rate)
const DIE_EATEN: u32 = 1u;
const DIE_BURST: u32 = 2u;
const DIE_STARVED: u32 = 3u;
const DIE_HEAT: u32 = 4u;
const DIE_TURN: u32 = 5u;       // the turnover mode (its slot went to a neighbour's daughter at once)
const DIE_GONE: u32 = 6u;       // replaced from outside (a new culture, a snapshot)

fn ilog(kind: u32, detail: u32, slot: u32, id: u32, other: u32) {
  let n = atomicAdd(&logb[1], 1u);
  let o = 4u + (n % IP.ring) * 4u;
  atomicStore(&logb[o], kind | (detail << 1u) | (slot << 8u));
  atomicStore(&logb[o + 1u], id);
  atomicStore(&logb[o + 2u], other);
  atomicStore(&logb[o + 3u], bitcast<u32>(S.time));
}

@compute @workgroup_size(256)
fn detect(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= IP.count) { return; }
  let o = i * IW;
  let c = cells[i];
  let alive = (c.flags & CELL_ALIVE) != 0u;
  let id0 = atomicLoad(&info[o]);
  let last = atomicLoad(&info[o + 4u]);
  let was = id0 != 0u && (last & CELL_ALIVE) != 0u;
  let fresh = alive && (!was || c.seed != atomicLoad(&info[o + 3u]));
  if (was && (!alive || fresh)) {
    var cause = DIE_OTHER;
    var other = 0u;
    if (fresh) {
      cause = select(DIE_GONE, select(DIE_TURN, DIE_BURST, cell_burst(last) != 0u), (c.flags & CELL_BORN) != 0u);
    } else if ((c.engBy >> 24u) == BY_GHOST) {
      cause = DIE_EATEN;
      let h = c.engBy & 0xffffffu;
      if (h < IP.count) { other = atomicLoad(&info[h * IW]); atomicAdd(&info[h * IW + 6u], 1u); }
    } else if (cell_burst(last) != 0u) {
      cause = DIE_BURST;
    } else if (bio[i * BIO_W + 24u] >= IP.starve) {
      cause = DIE_STARVED;
    } else if (unpack4x8unorm(c.sns1).y > 0.5) {
      cause = DIE_HEAT;
    } else if ((c.flags & CELL_BORN) == 0u) {
      cause = DIE_GONE;
    }
    ilog(1u, cause, i, id0, other);
  }
  if (fresh) {
    var mom = 0u;
    var how = HOW_PLACED;
    if ((c.flags & CELL_BORN) != 0u && c.mom != 0xffffffffu) {
      let pi = c.mom & ~MOM_DIV;
      if (pi < IP.count && pi != i) {
        mom = atomicLoad(&info[pi * IW]);   // (no thread changes an id in this dispatch)
        how = select(HOW_TURN, HOW_DIV, (c.mom & MOM_DIV) != 0u);
      }
    }
    atomicStore(&info[o + 8u], atomicAdd(&logb[0], 1u) + 1u);
    atomicStore(&info[o + 9u], mom);
    atomicStore(&info[o + 10u], how);
    atomicStore(&info[o + 11u], 1u);
  }
  // what this tick saw (the next tick's detect reads it): the flags (alive, the burst flash) and, for a cell gone, an empty slot
  atomicStore(&info[o + 4u], select(0u, c.flags, alive));
  if (alive) { atomicStore(&info[o + 3u], c.seed); }
}

@compute @workgroup_size(256)
fn commit(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= IP.count) { return; }
  let o = i * IW;
  if (atomicLoad(&info[o + 11u]) == 0u) { return; }
  let id = atomicLoad(&info[o + 8u]);
  let mom = atomicLoad(&info[o + 9u]);
  let how = atomicLoad(&info[o + 10u]);
  atomicStore(&info[o], id);
  atomicStore(&info[o + 1u], mom);
  atomicStore(&info[o + 2u], bitcast<u32>(S.time));
  atomicStore(&info[o + 5u], how);
  atomicStore(&info[o + 6u], 0u);
  atomicStore(&info[o + 11u], 0u);
  for (var k = 0u; k < RAN_W; k++) { atomicStore(&ran[i * RAN_W + k], 0u); }
  ilog(0u, how, i, id, mom);
}
