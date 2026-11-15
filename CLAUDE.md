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
Neon colours on black (see the LOOK DECISION 2026-11-15 below). A fluid background that feels viscous, with subtle ripples.
Current palette: stem warm white, epithelium cyan, muscle pink, neuron violet, cartilage amber,
nutrient green, threat red. Avoid busy (colours: see the LOOK DECISION below, now brighter neon).
LOOK DECISION 2026-11-15 (user, REPLACES the 2026-11-14 "no glow, crisp flat 80s graphic art" rule): "I don't
want it to look like 80s computer graphics, I want it to look like 80s NEON COLOUR LIGHTS. Think of video clip
graphics." User's picks:
- NEON TUBES: outlines drawn as thin bright tubes, a sharp almost white-hot core line with a TIGHT coloured halo;
  insides mostly dark, like real neon signs. Glow is back, but tight (not the soft wash of the CPU reference).
- BRIGHTER COLOURS: move the palette from faded pastel toward stronger neon (hot pink, cyan, violet, ...); same
  colour meanings (fate, function), just more lit.
- LIGHT TRAILS: moving cells leave short fading streaks (long exposure / video feedback).
- FLICKER / HUM: tubes brighten and dim slightly; busy cells (burning fuel, running engines) shine brighter.
- Not chosen: background perspective grid / scanlines.
(Older note, superseded: "neon was only a colour reference, crisp flat shapes, no glow".)
CLEAN DEFAULT VIEW (user 2026-11-15): "Simplify what is shown: fields (dots) can be hidden, just the cells,
interesting materials, the substrate. Nothing algorithmic." Default shows cells, materials (fuel, crusts, faint
free atoms, as material: glowing dust/crusts, not a lattice dot screen), the soft substrate, the light, springs.
The moire field dots, inner lattice dots, lattice halftone and diagnostic marks are hidden by default and live
behind a "machinery" switch in the View panel.
User choices: source landscape = HALFTONE DOTS on the lattice (dot size shows amount; under the neon look they may glow softly as small lights);
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
- SWAPS (the permutation itself): a free atom takes a partner's place where that RELEASES energy, the difference
  going to heat. Same table, same spark rule, in the open and inside cells. As built in C4 (fuel energy grows with
  row), the swaps that run are LIGHT free atoms displacing heavy ones (t + gT -> gt + T, g + GT -> gT + G, ...):
  light free atoms are the "vandals" that degrade rich fuel. l + L do not chain (one sediment per row).
- Grid: 6 atoms + 4 fuels + 2 sediments + trace + heat = 14 channels per pixel (e.g. four rgba textures or
  storage buffers; f32 preferred for conservation, measure drift in the "rounding" line). About one pixel per
  half a cell radius. SPRINGS (mouse-dropped) drip atoms in.

NO NUTRIENT, NO THREAT (user 2026-11-14): "change the nutrient and threat to just be part of the chemistry; I want
the substances to emerge naturally as those." The hand-made nutrient and threat sources and rule E go away.
- Food is not a label: a substance is food for a cell if that cell's engines can get energy from it. One
  lineage's food can be another's useless or harmful substance.
- Harm is not a label either. It emerges from two things already in the plan: (1) the same reactions run inside
  a cell as outside, so a reactive free atom (a light one, see SWAPS) that gets in degrades the cell's rich fuel,
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
    AS BUILT (C5): src/eat.js + cell_eat.wgsl; Cell record 88 bytes; battery drawn as a pale-green core (full = 0.55 R);
    lessons: heat damage needs a cap (deaths heat the dish and can run away; capped at heatKill); crawling pays
    only 0.012 of the real work (full work emptied batteries in seconds); most battery energy leaves through
    turnover (a death turns the battery into heat); heat damage acts only with turnover (T) on.
C6. Engines in the genome (2-3 slots, mutate), pigments (cells catch a visible band for uphill reactions),
    incl. LIGHT-DRIVEN UPHILL SWAPS (gT + G + light -> GT + g: richer fuel plus a free light atom as waste) and
    downhill swaps as "breathing" engines. User hope (2026-11-14, "on a toy level"): an OXYGEN-LIKE story may
    emerge: harvesters' waste (free light atoms, the vandals) is first caught by free takers in the dish (the
    "iron" sink), then builds up dish-wide, poisons leaky cells, and breathers learn to live on it. Never write
    it as a rule; only watch for it (panel readout of free light atoms; census of harvesters vs breathers).
    HARVESTERS MUST BURN (user 2026-11-14): light never charges the battery; it only pays a harvester's uphill
    difference, the product goes to stock. Every engine's spark and upkeep come from the battery, and only
    downhill reactions fill it. So a harvester must burn (or breathe) some of what it makes to keep running.
    SYMMETRY (user 2026-11-14: "as long as our chemistry enables endothermic and exothermic reactions and their
    inverse, it should be close enough"): every reaction exists in both directions, in the open and in cells.
    Downhill: spark only (heat outside, battery inside), energy released (heat outside, battery inside).
    Uphill: difference + spark (light outside; inside: difference from pigment light or the battery, spark from
    the battery). Battery-paid uphill engines are STORERS (bank energy as fuel).
    heat tolerance and permeability as genes, engines drawn as parts.
C6n. NEON LOOK (user 2026-11-15, right after C6): restyle all drawing per the LOOK DECISION: neon-tube cell
    outlines (sharp core + tight halo, e.g. a small bloom pass on a half-resolution buffer, or analytic halos in
    the shaders), brighter palette, light trails (fading accumulation buffer for the cells, not for the panels),
    flicker/hum with busier cells brighter; substances, springs, spotlight and parts restyled to match; the
    ripple background stays soft and dark underneath. Each effect its own switch (trails, hum, halo strength).
    Must stay fast on phones (cheap path / auto-off on small GPUs).
C6b. CHARGE (user 2026-11-15): givers +1, takers -1, linkers 0, bonds neutral (every reaction already conserves
    charge). A SCREENED charge field on the substrate grid (its own decay law: exponential cut-off, like charge in
    salty water; one channel + a few relaxation passes per tick); free atoms drift in it, so fast light atoms
    cannot run far from their opposite partners. A cell's charge in field B comes from the net charge of its
    STOCK (replacing the fixed per-fate charges), so chemistry finally shapes the moire patterns. The charge
    field is not drawn by default (optional thin crisp contour lines). Shape already couples in: a cell's field
    is its own strained lattice, so a stretched charged cell projects a squeezed, elongated field (and can leak
    into a neighbouring band, step 6).
C6c. ELASTIC HONEYCOMB CELLS (user 2026-11-15: "cluster in honeycomb shape and deform elastically"): cells get a
    real deformable outline instead of a stretched ellipse. Suggested shape: the membrane's 6 sides (the ones
    sensing already uses) each with its own distance from the centre, plus an orientation that turns to face
    neighbours; elastic: springs back toward round with area kept, underdamped so a pushed cell wobbles a little;
    contact flattens the sides facing neighbours, so packed tissue tiles into hexagons and free edges stay
    rounded. Drawn as NEON TUBE outlines (see the look decision), shared walls straight; the inner
    parts (battery core, engines) sit inside. Sensing integrates along the real sides. Lively, not stiff.
    MEMBRANE CHEMISTRY (user 2026-11-15: "can excretion be harmful to some? the membrane should react with
    chemicals, not only through heat; elasticity could be genetic"). Cells already excrete: waste leaks out
    through the membrane by concentration, and sediment made inside is expelled. Make the membrane a material:
    - Each side has an INTEGRITY. The membrane is built from LINKER chains taken from the cell's stock; a gene sets
      the MIX of light (l) and heavy (L) linkers, and one sets THICKNESS.
    - Derived rule: a free reactive atom (giver or taker) at a side BITES chains of ITS OWN ROW (light atoms bite
      l-membranes, heavy atoms bite L-membranes), at a rate from the table's sparks. Bites cost integrity.
    - Repair uses linkers from stock + battery. Low integrity -> leakier and softer; zero -> the cell BURSTS and
      spills its contents (food for neighbours).
    - ELASTICITY is genetic: stiffness derives from the mix and thickness (heavy and thick = stiff, resistant,
      costly; light and thin = soft, cheap, vulnerable), plus a small stiffness gene.
    - Expected emergent harm: burners and light-swap harvesters excrete free LIGHT atoms, which eat light
      membranes; one lineage's waste is another's poison, and resistant lineages pay for it. No rule names a
      toxin. (C7 pumps add active excretion.)
C6d. CHARGE PER SIDE (dipoles): each side holds its own charge (a cell that eats on one side gets charged
    there); an outside field pulls the + and - ends opposite ways, so cells turn, line up and stretch along the
    field, which strains their lattice and changes their field again (a form <-> field loop, like the loved
    step 8 curls). Expect chains, head-to-tail threads, alternating stripes. Own switch.
C7. Pumps across contact: storing, sharing, stealing. Membrane VOLTAGE (charge difference pumped across the
    membrane) as a second battery; stealing charged atoms fights the voltage it builds.
    PUMPS AS GENES, BOTH WAYS (user 2026-11-15: "active chemical excretion without forcing the behaviour"): a pump
    slot in the genome = (substance, direction IN or OUT, rate). Moving a substance down its gradient is free
    (that is just leaking); moving it UP the gradient costs battery, more the steeper the gradient. Mutation
    picks substance and direction at random; no rule says "excrete", "toxin" or "steal". Selection decides:
    e.g. pumping light atoms OUT protects the cell's own rich fuel and membrane from vandals (self-protection),
    and as a side effect poisons light-membrane neighbours; pumping fuel IN from a touching neighbour is
    stealing; pumping fuel OUT next to kin is sharing.
C7b. CATALYSTS (user asked 2026-11-15; Claude's proposal, both derived, no per-substance tuning):
    - Engines are already the cells' catalysts (enzymes); the open dish has only trace.
    - CRYSTAL SEEDING: sediment lowers the spark of its own formation (crust grows on crust: autocatalysis).
      Expected: crusts become spreading fronts and spots, the first patterns the substrate makes by itself.
    - TRACE AS COFACTOR: an engine's rate scales with the trace inside the cell (saturating), so trace becomes
      a scarce vitamin worth finding, hoarding and (with pumps) stealing.
    Each its own switch.
C8. Hard light mutates cells.
C9. DIVISION AND DEATH WITH A CHANGING COUNT (Part B step 9, pulled in for the experiments; user 2026-11-15: "play
    with cell division too"): fixed-capacity buffers with an alive flag; a cell divides when its battery (and
    stock) can pay for a daughter (split, conserved), dies when it starves or overheats; the count rises and
    falls with the energy the dish catches. Fixed-count turnover stays as a switch for comparison.

C10. PATTERNED WALLS: EVOLVABLE ADHESION PER SIDE (user 2026-11-15: "evolve walls with different adhesion levels
    on different parts of it"; on Claude's proposal: "I want those effects to combine"). All parts below act
    TOGETHER (each keeps its own switch for comparison):
    - Each of the 6 sides has its own adhesion. A few smooth genes set the pattern around the wall: overall
      stickiness, a front/back (polar) part, an ends/sides (two-fold) part; mutation drifts them.
    - The pattern hangs on the cell's FRONT, which COMBINES (a) the inherited body orientation (daughters inherit
      it at division, so tissues keep a shared direction) and (b) the charge dipole (C6d): a gene sets how much
      the front follows the dipole, so chemistry -> polarity -> stickiness can evolve.
    - A contact holds by the smaller of the two touching sides' values (both must be sticky), times the existing
      adhesion matrix and knobs.
    - COST: adhesion molecules are built from linkers in the membrane (per side, like C6c) plus battery upkeep,
      so stickiness is paid where it is used.
    - MATURATION: a side that keeps touching gets stickier (junctions mature), fading when contact is lost.
    - Test first in the tissue lab with hand-set patterns (uniform, polar, two-ended, sticky sides: expect sheets,
      cysts with a lumen, chains, palisades), then with evolution. Lessons from the tissue series: the default
      moire beat shakes small tissues apart (a long beat glues); long-range like-attracts-like gathers cells.

    AS BUILT (C10): a0 = the old adhesion gene; genome 52 floats; Cell 288 bytes, CellCore 120. Hand-set patterns cut
    tissue into small pieces shaped by the pattern (rosettes, dumbbells, rafts), because cells cannot turn their
    sticky side to a neighbour; no visible selection in 20 min (patterns drift as fast with walls off).
C11. GLUE TURNS THE CELL + DIVISION ALONG THE FRONT (user 2026-11-15: "yes absolutely"): a sticky side pulling on
    a neighbour pulls off-centre, so the same contact force also gives a TORQUE that turns the cell (its honeycomb
    and front) until sticky sides face neighbours (derived from the forces, no "face your neighbour" rule).
    Division splits along (or across: a gene) the front, so daughters land where the pattern says. Wall cost:
    Claude's call (user): retune so the default colony packs as a honeycomb again while glue still costs.
OXYGEN RETRY (user yes): a never-drying light spring plus a slow heavy spring, 40-60 min, watching the swap rate
    inside cells (cells.rate.inSwap), not the carrier count; whole dish lit and spotlight.
ORDER AGREED (user 2026-11-15 "Do it"): C12 oils and water -> C13 fields as genes and guides -> C14 primordial soup.
C12. OILS AND WATER, POLAR AND APOLAR MOLECULES (user: "try to build molecules that are polar and apolar; we can
    simplify their charges combining without actual physics"):
    - POLARITY is derived from the atoms by simple combination, no physics: charged atoms (givers +, takers -) are
      water-loving; linkers (0) are water-shy. A molecule's polarity = how much charge it carries AND where:
      all-linker = APOLAR (oil); charged parts on both ends or spread = POLAR; a charged HEAD on one end with a
      linker TAIL = AMPHIPHILE (soap/lipid-like). A neutral molecule made of + and - parts still counts as polar.
    - Water-shy substances gather with their own kind on the grid (phase separation: droplets, films that grow and
      merge); polar ones avoid oil; amphiphiles collect at oil-water boundaries (films, and hopefully micelles,
      bilayers, vesicles: protocell-like compartments in the open dish). Matter conserved exactly.
    - Membranes are linker-built, so they are oily: droplets can fuse into membranes, bursts spill oil.
    - Look: oil as a glossy film; boundaries as thin bright (maybe iridescent) neon lines; not busy.
    AS BUILT (C12): oil lL (mixed-row linker chain; one-row chains still pack into crust), soap glL (+1) / tlL (-1);
    each substance has chi (bulk pull) and beta (boundary pull) from polarity(); exact Scharfetter-Gummel flux on the
    grid (plain upwind made diamond droplets); oil tool (drop icon); fusion = a cell short of linkers takes oil in.
    Seen: coated droplets (emulsion) stable 10 min; soap blobs hollow into vesicle-like rings, then refill into a foam
    net; the default scene makes almost no oil (linkers go to crust faster); fusion is a trickle (8 units / 10 min).
C12b. LIPID MEMBRANES, ELASTICITY FROM THE LIPIDS (user 2026-11-15: "Lipids should be connected with elasticity. In
    the membrane"; NEXT after merging C11 + C12, ahead of C13). The membrane (C6c) becomes a LIPID layer and its
    elasticity is DERIVED from which lipids it is made of, using the C12 polarity numbers (no per-molecule tuning):
    - Membrane material = the chain-carrying molecules in the cell's stock: crust chains ll/LL, oil lL, soap glL/tlL.
      Cells get them by fusing oil and soap from the dish (extend C12 fusion to soap) or by making them inside
      (let the C12 oil/soap reactions run in cells too, paid from the battery like any reaction).
    - Derived mechanics: the oily TAIL share packs the layer -> STIFF (holds its hexagon, resists bites, costly);
      the charged HEAD share makes it FLUID -> soft, wobbly, reseals fast (soap self-assembles), but bends easily;
      one-row crust chains -> rigid and brittle (cracks rather than bends). Thickness gene stays; the C6c light/heavy
      mix gene becomes a LIPID MIX gene (what the cell builds its membrane from); the small stiffness gene stays.
    - Heads carry charge: a membrane rich in glL (+) or tlL (-) charges its sides, feeding C6d dipoles and field B.
    - Bursts spill the lipids, which go back into droplets / soap films in the dish (matter exact).
    - REFINED after the user's doubt ("I just know that bacteria have a lipid membrane"), closer to real cells:
      SOAP (head + tail) is the bilayer itself, soft and fluid; OIL slips in between the tails and stiffens it
      (like cholesterol / hopanoids); CRUST chains form a rigid WALL outside it (like a bacterial cell wall, the part
      that really holds a bacterium's shape). HEAT makes the bilayer more fluid, so lineages in hot places may evolve
      oilier, stiffer membranes (real bacteria do this: "homeoviscous adaptation"). Watch for it; never write it.
    - Expected look: soft wobbly soap-skinned cells next to stiff oily ones holding crisp hexagons; tissue mechanics
      (packing, linking) now follow the chemistry the lineage eats and makes. Own switch (off = C6c linker membrane).
    AS BUILT (C12b): soap = bilayer, oil between its tails (<= 1 per soap), crust = wall outside (bricks, amber ll /
    brown LL, cracks when jolted); stiffness k = packing (tail/head over pure soap) x heat 2/(1+T/3) x integrity x
    sqrt(thickness) x gene, pulled toward 4 by the wall; memb.x = oil share; Bio.lip = wall, head, wall row; genome 56,
    Cell 312 bytes; ?lipids=0 = C6c. Look: soap pearly drifting tube, oil deeper glossier, wall amber bricks. Lab: all
    linked either way; make-up changes look and wobble, not linking. PROBLEM: in the default scene cells cannot build
    it (every soap/oil needs one L and nearly all L is locked in LL crust within minutes): integrity ~0.
    SUPPLY FIX (Claude's call, 2026-11-16): CELLS GRAZE CRUST. A cell over crust takes ll/LL in (like fusion) and its
    builder CRACKS chains back into linkers by the table's reverse reaction (uphill: bond energy + spark from the
    battery); walls may use grazed crust directly. Derived from the symmetry rule, no new chemistry; expected look:
    colonies clearing paths through crust fields.
OXYGEN RETRY AS RUN (2026-11-15, EXPERIMENTS.md "Oxygen retry"): the haze built (4.5 k free light atoms by 50 min)
    and poisoned hard (35-90 bursts/s, a crater of uneaten fuel at the light spring); colonies escaped by ARMOUR (heavy
    membranes, spotlight) or by DROPPING THE SKIN (whole dish); breathing never ran (<= 0.06 % of burning). Cause in the
    table: free atoms carry zero energy, so breathing a fuel releases LESS than burning it. Yardstick: breathing that
    runs = cells.rate2.eSwap; cells.rate.inSwap = heat-driven vandal swaps inside cells.
C12c. EXCITED WASTE, THE OXYGEN FIX (user 2026-11-15 chose "charged waste"; NEXT after C12b): real oxygen holds part
    of the sunlight that made it, which is why breathing beats fermenting. So:
    - When LIGHT drives a reaction that frees an atom (the harvesters' uphill swaps, e.g. gT + G + light -> GT + g*),
      the freed atom leaves EXCITED, keeping part of the photon's surplus (derived from the band energy minus the
      uphill difference; the rest is heat as now). New channels for the excited light atoms (g*, t*): grid and stock.
    - Excited atoms fade to ground + heat on their own (a lifetime, faster when hot), so the haze is rich but temporary.
    - They react like ground ones, but every reaction they take part in also releases their stored energy: through a
      cell's ENGINE (breathing) it goes to the battery, so breathing a fuel now pays MORE than burning it; uncontrolled
      (vandal swaps in the open or loose inside a cell, membrane bites) it is dumped as HEAT on the spot, so the excited
      haze is a worse poison than before (like reactive oxygen). No rule names breathers or poison.
    - Books exact (excited energy counted as stored), own switch, the excited haze drawn as a faint glowing sparkle that
      fades. Then rerun the oxygen conditions and watch: breathers rising, the haze being eaten, armour vs breathing.
LATER, PURIST VERSION (user 2026-11-15: hoped for "a more game of life situation", surprised how many abstractions
    were needed; chose to KEEP GOING with lipids (C12b) and the oxygen story, "I can go back to the purist version
    later"). Idea on file: a separate small page "moire life": cells of a few colours, pairwise push/pull through
    the moire beat of their lattices as the ONLY rule (ring-shaped, not a plain falloff), no energy/chemistry/heat/
    noise after the start, a random-rules button and a gallery of kept rule sets (particle-life genre).
    Also on file: prune the big sim's defaults to rules that showed a visible effect.
PROPOSED NEXT (user 2026-11-15, ideas under discussion, not agreed in detail):
- OILS: a water-shy property derived from the atoms (uncharged linker-rich molecules are oily); oily substances
  gather with their own kind on the grid (phase separation: droplets, films), membranes are oil, droplets can fuse
  with membranes; protocell-like compartments may form in the open.
- PRIMORDIAL SOUP: randomly generated molecules (strings of atoms) dripped in at random; a fixed number of species
  slots on the grid, recycled when a species dies out; every property derived from the sequence (energy, charge,
  oiliness, and which reaction it catalyses, from a hash of the sequence), so autocatalytic sets can emerge.
- FIELDS AS GENES, FIELDS AS GUIDES (user: "I envisioned the field just to guide the underlying interactions; maybe
  we let them mutate their different fields more"): every field parameter becomes genetic and mutates (period /
  lever, emission strength, sensing gain and sign, tuning width, per field), and the field's main effect becomes
  GUIDING interactions (gating glue, pumps, engines, division direction by the local field, as genes decide)
  rather than pushing cells directly.

EXPERIMENTS (user 2026-11-15; after C6..C9 are all done): run experiments with interesting, different
conditions and RECORD anything interesting: patterns, behaviours, and the statistics, MAINLY ENTROPY (entropy
rate, heat out vs ORDER, rounding/"free entropy"), plus counts, strategies, free light atoms (oxygen-like
build-up?), charge patterns. Play with cell division (rates, costs, capacity, fixed vs changing count).
- Tooling first: a headless experiment runner (extend tools/shot.py or a new tools/experiment.py) that sets URL
  options / evals, runs at MAX for a set simulated time, samples the panel's numbers to CSV every few seconds,
  and saves screenshots (and short .webm clips) at set times.
- Example conditions: full field vs spotlight vs darkness; long day vs no day cycle; light springs only / heavy
  only / both / many; no trace; mutation off vs high; heat tolerance low; division cheap vs costly; charge off
  vs on; dipoles on; 800 vs 10 000 cells; founders all burners vs all harvesters.
- Record in EXPERIMENTS.md (conditions, exact URL/settings, what was seen in plain visual words, entropy plots
  or tables, best images), keep only what is interesting, and publish a summary page for the user.
TISSUE EXPERIMENTS (user 2026-11-15): a separate series focused on CREATING TISSUES, i.e. LINKING: cells that hold
together in stable multicellular configurations. Method: FEW cells (tens to a few hundred), NO natural evolution
(mutation and turnover off, fixed genomes, chosen by hand or one genome cloned), and instead SWEEP THE TUNING
(adhesion/contact, the moire fields and lever, charge and dipoles, membrane stiffness and elasticity, pumps,
light, chemistry) to find which settings give stable linked configurations. STORE every stable configuration
(the exact settings, genomes, cell positions/shapes/contacts as a snapshot that can be reloaded, a screenshot,
and its measures) so we can learn WHAT DRIVES LINKING. Measures: clusters and their sizes, contacts per cell,
contact persistence (how long the same neighbours stay touching), shape stability over time, whether the cluster
survives a stir. Keep a table of what was swept, which settings link and which fall apart, and the best guesses
about the cause. Needs a snapshot save/load (state -> JSON, reload by URL/console) if none exists.

## Ground rules
- State plainly what was tested and how. "Runs without errors" is not "looks right".
- Commit working states often, so a bad visual change is easy to undo.
