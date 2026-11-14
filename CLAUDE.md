# Moiré cells

A toy simulation, made for beauty and fun: stem cells divide, specialise and form tissues while moving through
a "chemical" landscape made of moiré beats between lattices. It is NOT an experiment and not a biological model.
No benchmarks, no rivals, no claims. Judge changes by how they look and feel.

Started 2026-11-14, spun out of the `moire-experiment` project (sibling folder; closed, do not load it for context).

## The user
- Visual thinker: explain with what it looks like, in plain language; define technical terms.
- Works with microscopes by trade (hence the fluorescence-channel legend, scale bar, marker names).
- Not an ML or graphics specialist. They test by watching; ask what they see.

## The look (the user's words)
Faded neon colours on black. A fluid background that feels viscous, with subtle ripples.
Current palette: stem warm white, epithelium cyan, muscle pink, neuron violet, cartilage amber,
nutrient green, threat red. Keep it soft; avoid saturated or busy.
UPDATE 2026-11-14 (user): "neon" was only a colour reference, NOT an effect to imitate. No blur, no glow, no
bloom. Think 80s graphic art: crisp, flat, graphic shapes with clean hard edges, and the faded palette above.
Soft in colour, sharp in form. (The reference CPU page still glows; that part of it is no longer the target.)
User choices: source landscape = crisp HALFTONE DOTS on the lattice (dot size shows field strength, flat colour);
viscous ripple background = keep soft as it is (the one deliberately soft layer).
User answers after Part A (2026-11-14):
- COLOUR MEANS SOMETHING: colours represent function and specialisation. In a later iteration cells will also have
  PARTS (so plan colour for a body plus parts, not one fill per cell). Do not paint cells in colours that carry no
  meaning.
- Motion: the user likes it lively and does not want to supervise motion, unless it is numerical error (which
  "might give us free entropy").
- Step 8 curls (clock + sideways push): the user LOVES them, "the kind of self referring pattern I was hoping for".
  Keep them; they are a direction worth growing.

## Files
- `reference/neon_organoid_cpu.html` — the working CPU version (single file, Canvas 2D, about 520 cells).
  It is the reference for the rules. Open it in a browser to see the intended behaviour.
  Also published at https://claude.ai/artifact/ByKBbzmVQTh8MpmKzbg3rT (private to the user).

## The rules as they stand (all in the reference file)
Lattices:
- Every emitter (cell, nutrient source, threat source) carries a hex lattice: 3 wavevectors 60° apart,
  an angle `la`, and a period set by its kind (`PER`).
- The medium has its own lattice, anchored at the dish centre, breathing by about 1°.
- An emitter's chemical field = the beat of its lattice against the medium's:
  amp · envelope(r) · Σ cos(q_m·(x − centre) + phase_m), with q = k_emitter − k_medium.
  Envelope is a power law, 1 / (1 + r²/r0²).
- LESSON: anchoring the sensing lattice to the moving cell itself does not work. The beat then slides several
  times faster than the cell moves (the moiré lever), so cells get pinned within a few pixels. Beating against
  a shared medium lattice keeps the landscape stable in the world.
- LESSON 2 (GPU step 4, 2026-11-14): with thousands of moving cells, the reference's sliding cell beat is just noise
  (the field force averaged ~0.4 px/s against ~3 px/s of contact and drift, so nothing visible). What works: PIN each
  cell's beat pattern to the cell (phase 0 at its centre: bright core, hex rings at the beat period), sensing gain
  ~10, lever 0.4 (beat periods ~2.5x longer). That gives rosettes and, with deformation, petals and ribbons.
  Key X switches the anchor modes for comparison.

Sensing and motion:
- Nothing is simulated per pixel. A cell's membrane is 6 straight segments; the field is integrated exactly
  along each (closed form: cos at the midpoint × sinc of half the phase change).
- Force = Σ (segment integral × outward normal), which equals area × gradient; then a saturating (tanh) response.
- Receptor tuning: a cell feels an emitter in proportion to how alike their lattices are (Gaussian in the
  wavevector difference). `EMW` holds the sign and strength per cell type and emitter kind.

Deformation:
- Cell shape = area-preserving stretch (traceless tensor e1, e2, capped at 0.5).
- Passive: contact squeezes along the contact axis. Active: stretch along own motion and toward the landscape's
  pull (quadrupole of the membrane signal). Muscle has a built-in stretch.
- Stretching the cell squeezes its lattice the other way (k = F⁻¹·k0), which changes both the field it
  projects and what it can sense.

Biology (toy):
- Division held back by crowding, sped up by nutrient. Slow turnover.
- Fate choice from neighbours: surface → epithelium; muscle and cartilage recruit neighbours; neurons inhibit
  neurons nearby; a busy, uneven field on the membrane holds a stem cell back; threat pushes toward epithelium.
- Like sticks to like (contact adhesion matrix `J`). Committed cells untwist their lattice toward same-type neighbours.
- Nutrient attracts and is eaten; threat repels, kills what it reaches, and fades.

Background: a damped slow wave field (ripples from divisions, deaths, stirring) plus a drifting sheen, drawn at
coarse resolution; the sources' landscape is added as a green/red glow.

## Next step: GPU engine in the browser with WebGPU (user decision 2026-11-14, final)
The user wants the engine on the GPU, as a web page using WebGPU, so it is easy to show to friends by link.
(A desktop Vulkan app was considered the same day and dropped; do not reopen it.)
The CPU version spends about 13 ms per frame on simulation alone at 520 cells, so it cannot grow.

Machine: Windows 11, GTX 1650 (4 GB), Python 3.13 installed (enough for a local web server). No Node, Rust
or CMake assumed; check before relying on any.

Stack:
- Plain static site: `index.html` + JavaScript modules + WGSL shaders (compute shaders for the simulation,
  render shaders for drawing). No framework and no build step unless one becomes clearly necessary.
- Run locally with `python -m http.server` and open http://localhost:8000 in Chrome or Edge. WebGPU needs a
  secure context: localhost and https qualify; opening the file directly (file://) may not work.
- If WebGPU is missing (`navigator.gpu` undefined or no adapter), show a plain message saying which browsers
  work and link to the CPU reference page. Never a blank screen.
- Sharing with friends: LIVE at https://trbremm.github.io/moire-cells/ (GitHub Pages from main / root, enabled
  2026-11-14 with the user's yes; every push to main updates it within a minute or two). The repo is public, so
  every push is public. Whether a claude.ai artifact allows WebGPU is
  unknown; test once with a tiny page before relying on it.
- Which browsers and phones support WebGPU changes quickly: CHECK CURRENT SUPPORT, do not rely on memory.
  Likewise check the current WebGPU / WGSL docs for API details before writing code.
- Testing: use a browser tool if the session has one (Claude in Chrome or the built-in browser) to load the
  page and take screenshots; otherwise ask the user what they see. Add a key that shows frame time and the
  adapter name on screen.

Build order (each step ends in something the user can look at; commit after each). Agreed principle:
minimal core first, then ONE rule at a time, so the user can see what each rule alone changes:
1. WebGPU check: a page that gets the GPU adapter, shows its name on screen, and draws the viscous background
   (ripple field + sheen) as a full-screen shader. Confirms the stack works on this GPU and in the browser.
   Include the no-WebGPU fallback message from the start.

   PART A — minimal core (no biology: no division, death, fates or adhesion matrix)
2. One field, sources only: full-resolution landscape shader, same beat formula as the reference
   (emitter lattice against the medium lattice, power-law envelope). Mouse drops sources.
3. Cells on the GPU, fixed count (start ~2 000): state in buffers; compute pass with a uniform grid for
   neighbours (count, prefix sum, scatter; or sort by grid index). Soft contact push only. Draw as instanced
   quads: glow body + inner dot grid.
3b. Genome and specialisation (user decision 2026-11-14, brought forward ahead of step 4):
   every cell carries a small random genome ("DNA"): a key (identity, also a faint tint), receptors (which keys it
   responds to, and how picky = SPECIFIC), thresholds with decay (only sustained contact counts = SUFFICIENT),
   a response table (signal -> fate: epithelium/muscle/neuron/cartilage, and how strongly committed cells signal
   onward), and body traits (adhesion, size, motility). Interactions are by contact for now; fields can carry them
   after step 4. Mutation with a fixed cell count: slow turnover, where a cell dies and a neighbour divides into its slot,
   copying its genome with small random mutations, so lineages compete and spread. Keys toggle turnover,
   mutation and fate choice; a key re-randomises.
4. The loop: membrane sensing (segment integrals), force, deformation, strained lattice — ported from the
   reference. Cells now emit into the field too, and the landscape shader includes every cell's field.
   LOOK HERE FIRST: what do thousands of cells do with only the loop? Tune the lever (how different the grids
   are) until patterns win over flicker. Do not move on until this is worth watching.
5. Second field with a different range and sign rule (e.g. long-range attraction + mid-range like-repels-like).
   Fields are separate sums in separate lattice bands, each drawn in its own colour. Look for clusters of a
   preferred size, stripes, regular spacing.
6. Leak by deformation: strained cells couple into the neighbouring band. Then conversion rules in the cell
   (feeling A above a threshold emits B). One rule at a time; keep only what makes it more interesting.
7. Exclusion: same-type cells in the same internal state (lattice angle) repel hard up close; different
   states pack closer. Look for shells filling up around an attractor.
8. Orthogonal partner fields: quarter-period partner lattice; a change in A makes the cell emit B and vice
   versa; partner pushes sideways to motion. Look for travelling waves, spirals, rotating clusters.

   PART B — biology on top (only once Part A is worth watching)
9. Division and death (cell count changes): fixed-capacity buffers with an alive flag; do it on the CPU every
   few frames from a read-back, or with an atomic counter in the compute shader. Decide when reached.
10. Fates and tissues, driven by the fields rather than by the hand-written neighbour rules of the reference
   where possible. Nutrient is eaten, threat kills. Neuron links and pulses if still wanted.
11. Polish: tap modes, stirring, legend/scale-bar overlay, performance (target 60 fps on the GTX 1650 with
   thousands to tens of thousands of cells).

Each new rule gets an on/off key, so its effect can be seen by toggling it.
Keep `reference/neon_organoid_cpu.html` as the behavioural reference for the loop (step 4) and the biology
(Part B); the multi-field ideas in "Design direction" below are new and have no reference.
After each step, look at the page (browser tool screenshot) or ask the user what they see before moving on.

## Design direction: several separate fields, like the forces of matter (user idea, 2026-11-14; not built)
This is the heart of the project now (build steps 5–8 above); the user is excited about it.
The user's picture: different fields as matter has, each with its own decay law, which do not mix by themselves
and only "leak" into each other through interaction rules carried by the cells (their example: Pauli exclusion).
Proposed shape (Claude's suggestion, open to change):
- 2 to 4 fields. Each field is its own sum over emitters, never added to another field. Each has its own
  lattice period ("band"), decay law, and sign rule. Starting set:
  long-range attraction ~1/r (nutrient / gravity-like) · mid-range, like repels like ~1/r² (charge-like) ·
  short-range binding, exponential cut-off (adhesion / strong-force-like).
- Bands keep fields apart naturally: lattices with very different periods make no slow beat, only close
  periods do. A cell that deforms strains its lattice toward another band, so deformation can be the leak.
- Cells are the only place fields meet. Each cell type has a "charge" per field (how strongly it emits and
  responds). Conversion rules live in the cell: e.g. feeling field A above a threshold makes it emit field B.
- Exclusion rule: two cells of the same type in the same internal state (lattice angle/phase) repel hard at
  short range; cells in different states may pack closer. Expected look: shells or alternating patterns.
- Orthogonal partner fields (user idea, after electric/magnetic): each field can have a partner at right angles.
  Suggested translation into patterns: (a) the partner is the same lattice a quarter period out of step
  (cos/sin pair), so the pair carries a phase and a direction of travel; (b) a CHANGE in one field at a cell's
  membrane makes the cell emit the partner (changing A makes B, changing B makes A), which lets signals travel
  as waves instead of sitting still; (c) the partner pushes a cell sideways to its motion, giving curls and spirals.
- NOT a particle simulation (user, explicit): no physics accuracy is wanted. Physics is only a source of
  concepts for how patterns exchange information. "Charge" above just means how strongly a cell emits into and
  listens to a field.
- Draw each field in its own faded colour, added together.
- Keep to the "minimal core first" advice: start with two fields and no biology, add one rule at a time.

## Part C: light, chemistry and heat (user decision 2026-11-14; NEXT, ahead of Part B)
Toy, not chemistry or thermodynamics: abstractions built from simple descriptors, judged by how they look.
Principle: ENERGY is the currency, MATTER is conserved (atoms never made or destroyed, only moved and
rearranged), and every loss ends up as HEAT, which leaves the dish. Each rule gets an on/off key.

Keys: every letter is already taken by Parts A/B. Part C rules go on SHIFT+letter (main.js lowercases e.key,
so check e.shiftKey before that), plus the F overlay / hint line. Mouse: left tap/drag stay as they are.

The band ladder (the user's picture: absorb high frequency, emit infrared, but only "my fields interacting"):
- Light, the fields A/B/A', motion and heat all sit on ONE energy scale, ordered by band (short period = high).
  Energy only flows DOWN the ladder by itself; the only way up is a cell (or bond) catching light of a matching
  band, never with full efficiency. Every conversion (absorption, reaction, field conversion of step 6, motion
  lost to drag) loses part of its energy into heat.
- HEAT is the lowest band. It is a field like A or B but INCOHERENT: its phase is redrawn every tick, so it gives
  no steady push, only shaking. Brownian jitter = feeling the heat field (replaces the constant Sim.jitter).
  Because it is incoherent only its intensity matters, so it is stored as one channel on the substrate grid
  (spreads fast, fades) rather than summed as lattices.
- Stability: a kick taken from heat USES that heat up (hot spots cool by stirring their neighbours), and heat
  leaks out of the dish ("to the sky") at a set rate, which sets the dish's temperature.
- Heat drives the viscous ripple background (the one soft layer): hot places shimmer, cool places go still.

Entropy counter (user request): on screen, updated every frame, crisp text panel in a corner (Shift key hides).
- ENTROPY = running total of heat that has left the dish, plus its rate per second.
- Energy ledger lines: light in, stored (fuel + cell batteries), moving (cells' motion), heat in dish, rounding.
  "rounding" = what does not add up = numerical error, shown honestly as "free entropy" (user's phrase); fast
  growth there means a bug.
- ORDER line (once there is chemistry): how patterned the dish is (e.g. Shannon entropy of the grid's
  substances). Life's trick to watch: order falls while heat out climbs faster.
- GPU reduction each frame; read back a few numbers with a small ring of staging buffers, never stall
  (showing a value 1-2 frames old is fine).

Light (user choices):
- Two modes: FULL FIELD (whole dish) or SPOTLIGHT. The spot moves and tilts with the mouse: right-drag moves it,
  wheel tilts it (an oblique beam makes the spot an ellipse, brighter on the near side), Shift+wheel turns the
  direction the light comes from. Drawn crisp and flat (thin hard-edged ellipse outline or faint flat tint;
  no glow). Shadows behind cells: maybe later.
- Bands (same energy scale as the bonds below): WARM (heat only, absorbed by everything, most by dark sediment),
  two VISIBLE bands (make the lighter bonds, caught by cells with a matching pigment gene), HARD (makes the
  heaviest bonds, cracks sediment in the open, mostly becomes heat; in a cell it raises mutation).

Substances: a small "periodic table" (user: "think of bands in the periodic table, like you did with light").
Each atom is described by TWO numbers only, and every property is DERIVED from them, never hand-tuned per atom:
ROW (size: heavier = slower spreading, stronger/richer bonds, needs harder light to bond) and GROUP (role).
- Groups: GIVER (wants one partner) · LINKER (wants two: chains) · TAKER (wants one partner).
- Rows 1 (light) and 2 (heavy): atoms g t l (light) and G T L (heavy).
- Plus one rare TRACE atom (row 3, inert): never reacts, barely moves, and LOWERS THE SPARK (activation cost,
  below) of any reaction where it sits (a catalyst). Cells that hoard it run their engines cheaper.
- SPARK (activation energy; user 2026-11-14: "energy should pay for chemical reactions too"): every reaction,
  even one that releases energy, must first be paid a spark, derived from the bond's row (heavier = bigger
  spark). Downhill reactions give the spark back plus their gain; uphill ones (making fuel) also need the
  difference, from light or the battery. In the open the spark comes from light or local HEAT (hot spots
  react, cold ones are frozen); in a cell it comes from the battery, so a cell with an empty battery cannot
  start anything (it needs a starter charge at birth; a daughter gets a share of the parent's).
- Bonds: giver + taker = FUEL pairs gt, gT, Gt, GT (energy grows with row: gt cheapest, made by the lower visible
  band; GT richest, needs hard light). Linkers chain into SEDIMENT ll and LL: forming it releases a little
  energy, it does not spread, so it piles up (accumulation only through reaction; the user's two ideas in one
  rule); it is dark, so it warms in light; hard light slowly cracks it. Like with like (g+g, t+t): no bond.
- SWAPS (the permutation itself): a free atom can take a partner out of a weaker bond (e.g. T + gt -> gT + t),
  releasing the bond difference as heat. Same table, same spark rule, in the open and inside cells.
- Grid: 6 atoms + 4 fuels + 2 sediments + trace + heat = 14 channels per pixel (e.g. four rgba textures or
  storage buffers; f32 preferred for conservation, measure drift in the "rounding" line). About one pixel per
  half a cell radius. SPRINGS (mouse-dropped) drip atoms in.

NO NUTRIENT, NO THREAT (user 2026-11-14): "change the nutrient and threat to just be part of the chemistry; I want
the substances to emerge naturally as those." The hand-made nutrient and threat sources and rule E go away.
- Food is not a label: a substance is food for a cell if that cell's engines can get energy from it. One
  lineage's food can be another's useless or harmful substance.
- Harm is not a label either. It emerges from two things already in the plan: (1) the same reactions run inside
  a cell as outside, so a reactive free atom (e.g. heavy taker T) that gets in swaps the cell's fuel apart,
  wasting what its engines need and dumping heat inside; (2) HEAT DAMAGE: a cell's death rate rises when its
  local temperature is above a tolerance (a genome trait later). So threats are whatever makes a place too hot:
  reactive chemistry, a strong spotlight, a crowd of busy cells.
- Growth: energy replaces "nutrient speeds division": rich cells win freed slots (energy-biased turnover).
- Tap modes 2 and 3 become springs (e.g. 2 = light-row atoms, 3 = heavy-row atoms + a little trace), each with
  its own mix; the spring's mix decides what chemistry happens there.
- The landscape's halftone dots (the user's chosen look) now show the grid's substances, on the medium lattice:
  dot size = amount.
- Look: colour means function (chemical function now, not "nutrient"/"threat" labels). Energy-rich fuel in
  the old nutrient green; the old threat red goes to the most REACTIVE free atoms (hungry for partners); sediment as a flat, crisp, dim layer;
  free atoms hidden unless a key cycles through them.

Cells and engines ("permutators"):
- Each cell holds an internal stock of the substances and one ENERGY number (its battery).
- Membrane exchange by two genes: PERMEABILITY (passive, from more to less) and PUMP (active inward pull, costs
  energy). Storer, sharer and THIEF (pumping from a touching neighbour) are meant to EMERGE from these two
  numbers; never write a "steal" rule.
- Engines: 2-3 genome slots, each a rearrangement from the table (make or break a given fuel, link sediment,
  optionally using a light band), with a rate. The energy table does the bookkeeping: each run pays its spark
  and any uphill difference from the battery; a run the battery cannot pay does not happen; the inefficiency
  goes to heat.
- Energy pays for MOTION and CHEMICAL REACTIONS (user); survival by energy later (heat damage, above, from C5). Energy-biased turnover: rich cells win
  the freed slot more often, so good energy handlers spread.
- The membrane's 6 corners sample the grid too: cells "smell" which way fuel lies.
- Engines are the cell's first PARTS (the user's body-plus-parts plan): small marks inside the body, coloured by
  reaction; battery = size of the inner core.

Build order (one rule at a time, each with a Shift key, look after each):
C1. Heat band + entropy counter: heat channel on a grid, jitter from local heat, drag and losses feed it, kicks
    use it, leak to the sky, ripples respond to heat. Counter with entropy, heat in dish, moving, rounding.
C2. Light: full field / spotlight (mouse controls above); warm and hard bands become heat where absorbed.
C3. The atom grid without reactions: springs REPLACE the nutrient/threat sources (tap modes 2, 3; remove rule E
    and the sources' beat landscape), spreading by row, halftone drawing of the substances, key to cycle them;
    ORDER line in the counter.
C4. Chemistry in the open (no cells): light makes and breaks bonds by the table, sediment forms and cracks,
    swaps, sparks from light and local heat, trace lowers the spark. Watch the substrate alone first.
C5. Cells eat: exchange, internal stock, battery (starter charge), one built-in burner for all; the battery
    pays for crawling and for each reaction's spark; the table's reactions also run inside cells (swaps);
    heat damage; energy-biased turnover (replaces the old nutrient rule).
C6. Engines in the genome (2-3 slots, mutate), heat tolerance as a gene, engines drawn as parts.
C7. Pumps across contact: storing, sharing, stealing.
C8. Hard light mutates cells.

## Ground rules
- State plainly what was tested and how. "Runs without errors" is not "looks right".
- Commit working states often, so a bad visual change is easy to undo.
