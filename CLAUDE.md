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
    AS BUILT (C12b graze + C12c, 2026-11-16): grazing gives ~1 cell in 10 a whole membrane (mean integrity ~0.1, not
    0.3): light and heavy crust sit at different springs, so few cells hold both linkers, and bites eat soap as fast as
    fusion brings it. Excited g*/t* keep E* = 0.625 (half the photon surplus), fade at 1/30 s x (1 + T/4); through an
    engine to the battery, else heat. Breathing an excited atom beats burning PER EVENT, but the haze is ~0.1 %
    excited: most free light atoms come from springs and burners' exhaust (ground), light makes only 1-7 excited/s.
    Breathing still did not rise. One seed only: under the whole dish, light-driven uphill swap carriers rose to 52 %
    (2.5 % off), maybe eating their own excited waste. Haze drawn as sparse hot red-orange sparks.
C12d. ELECTRONS: BONDING REBUILT AROUND GRIP (user 2026-11-16; NEXT after C13). The user's insight: "the main thing
    about oxygen is how it binds to things so easily", then: "on the linking we make the givers give spare electrons
    and the takers take (basically electron orbitals)"; chose the full rebuild over a single "hungry atom" (dropped).
    The old C4 table ("a bond is a battery light charges": giver+taker bonds UPHILL, free atoms the calm state) had no
    room for a grabber. New table, still derived from ROW and GROUP only:
    - Each atom gets ONE derived number, GRIP: givers hold a spare electron (heavier = looser, gives easily, metal-like);
      takers have an empty slot and pull (lighter = harder, oxygen-like); linkers share electrons with each other.
    - Forming a bond RELEASES energy: the electron falls from the giver's hold into the taker's pull; the bigger the gap
      the more released. Free atoms are now the HIGH, restless state; light is the only thing that pushes electrons
      back up (splits bonds). Linker chains share (release a little, as now); oil/soap follow from the same numbers.
    - ORBITALS WITH ENERGY LEVELS (user 2026-11-16: "remember to add different energy levels to different orbitals"):
      each atom has a small ladder of levels, derived from row and group (each row adds a shell, outer shells sit
      higher and hold looser; grip = the level of the electron or empty slot that bonds). A bond has a lower (bonding)
      and an upper (anti-bonding) level. LIGHT IS ABSORBED ONLY WHERE A PHOTON MATCHES A GAP between levels, so each
      substance has its own absorption bands (colour from physics: pigments = molecules whose gap matches a visible
      band). A lifted electron is an EXCITED state: it reacts more easily (lower spark: photochemistry) or falls back,
      giving heat or re-emitting a LOWER band (FLUORESCENCE, Stokes shift: "absorb high, emit low", as in the band
      ladder; the user is a microscopist, so substances glowing in their own emission colour under the spotlight is a
      look to aim for). This folds in C12c's excited atoms as the general rule. Keep it a toy: 2-3 levels per atom.
    - What should follow (never written as rules): heavy giver + light taker = the most settled compound (water / rust
      / dead mineral); light giver + heavy taker = FUEL (electron still sits high); free light taker = OXYGEN (grabs
      anything, steals electrons from fuel: burning, breathing and damage are one reaction, through an engine to the
      battery, loose as heat); harvesters using pigment light to split settled compounds = PHOTOSYNTHESIS (fuel made,
      free light takers thrown out as waste). Swaps survive (t + gT -> gt + T still runs downhill).
    - SPRINGS drip settled minerals (and maybe some fuel, like a vent), not free atoms, so light (plus what springs
      carry, counted in the ledger) is the energy in; any oxygen in the dish must be made by life.
    - Keep: exact books (energies multiples of 1/16), sparks, symmetry (every reaction both ways), HARVESTERS MUST BURN
      (light never charges the battery directly), charges exact (keep the current charge rule unless electrons give a
      cleaner one; say which). Old table kept behind a switch for comparison; C12c excited waste off by default.
    - Past experiment numbers stop being comparable (user accepted). Then rerun the oxygen conditions WITHOUT a light
      spring: watch for the sink (free givers / heavy atoms catching takers first, rust-like crust), the haze building,
      breathers rising.
    AS BUILT (C12d, 2026-11-16): src/electrons.js; core pull giver 5/4, linker 5/2, taker 11/2, shell k at -Z/2^(k-1)
    (a linear ladder failed checks); grip g -1.25 G -0.625 l -2.5 L -1.25 t -5.5 T -2.75; bond gap = released + donor's
    atom gap (anti-bonding at the donor's empty shell, else visible light split water in the open). Gt -4.875 (most
    settled, open light cannot split it), gt -4.5, GT -2.375 / gT -1.5 (fuel, absorb visible 2 / 1); breathing t+gT 3.0.
    Excited states resolve within the tick (react 1/2, fluoresce 2/5 of the rest, else heat); g*/t* empty with electrons.
    Old charge rule kept (electrons give the same). Tap 2 = mineral spring (gt, l, L), tap 3 = vent (gT, GT, G, trace).
    Look: sparse steady sky-blue (minerals, tlL) and gold (GT, free t) lights in the light. ?electrons=0 = old table
    exactly (page reloads; old snapshots switch by themselves). RESULT (oxygen conditions, no free-atom spring, 40 min):
    breathing runs (60-180 events/s, ~1000x C12c) but as a LOOP INSIDE EACH CELL: pigment splits gt, the cell burns
    g + t back; pigments moved to hard light (a hard photon pays the whole split). No separate breather lineage
    (self-burn ~3.4 per event beats ~2.25 from a thin haze). Haze 50-90 under the spot, to ~510 whole dish; rust grows
    (sink), oxygen also ends in tlL soap (an unwritten sink). Known: hard light splits water in the open (oxygen
    without life); default scene crashes harder then recovers higher than the old table. Speed unchanged.
C12e. WASTE MUST LEAVE (user 2026-11-16, correcting Claude's "small atoms leak out" idea: "oxygen leaks out because of
    reaction byproducts in nature, the cell has to expel co2 not to get saturated or too acidic"). Two derived pressures,
    no "expel" rule:
    - SATURATION (mass action): every reaction inside a cell slows as its own products pile up in the stock (the reverse
      direction catches up), the balance point derived from the table's release (big release = hard to clog), no
      per-substance tuning.
    - OSMOSIS ON THE IONS (user, same day: "osmosis on the ions could do the job actually. And the membrane
      permeability with it"; REPLACES the first idea, acidity slowing engines): free ions inside (free charged atoms,
      counted by number; bonded molecules do not count) minus outside -> the cell swells (or shrinks), resisted by
      its membrane stiffness (crust wall holds hardest, like a bacterial wall holding turgor); STRETCH RAISES
      PERMEABILITY, so ions leak out down the gradient and the pressure relieves itself; overstretch costs integrity
      and bursts. Binding atoms into molecules lowers the load.
      GENETIC (user: "remember to tie that to genes too"): a STRETCH-CHANNEL gene (like mechanosensitive channels:
      how much permeability opens when swollen) and a STRETCH-TOLERANCE gene (how far before damage, at a cost), plus
      the existing permeability, pump, stiffness, thickness and lipid-mix genes; a neutral control (effect off, genes
      drifting) to tell selection from noise.
    - Waste leaves only by what exists: passive leak down the gradient (free) and C7 pump genes (up the gradient, costs).
    - Hoped for (watched, never written): full-battery harvesters make more t than they burn, clog and sour, dumpers win,
      the haze builds, breathers living on outside t rise and must dump their own waste (gt, T) like CO2.
    - Plus a switch (?photolysis=0) so hard light cannot split minerals in the open: oxygen made by life only.
    AS BUILT (C12e, 2026-11-16): src/waste.js. Saturation: in-cell rate x (1 - Q/K), K = exp(drive/(theta T)), no gene
    (a catalyst cannot move the balance); costs 4-22 % of in-cell events, never clogs the big self-burn. Osmosis: free
    ions in/out per capacity, swelling toward kOsm=10 x pressure x integrity / stiffness (-0.4..+1), radius x sqrt(1+s),
    stretch channels (Bio.lip.w) and tolerance (Bio.gate2.z, upkeep) genes; tearing via the burst path. Cell 352 bytes.
    Look: a few cells in a hundred puffed round and glossy, some shrunk tight (turgid vs plasmolysed). RESULT: the C12d
    self-burn loop HOLDS (60-85 % burn their own t, 4-12 % outside t); osmosis acts on 2-8 % of cells (ions cross the
    membrane as fast as anything); genes drift like the neutral control; one run showed t-OUT pumps rising 84 -> 713.
    ?photolysis=0: seed 3 dies in the founders' crash (with or without C12e), seed 7 builds 495 free t made by life.
    Possible lever not built: membranes that pass ions slower than neutral molecules (real lipid bilayers do).
C13. FIELDS AS GENES, FIELDS AS GUIDES (user 2026-11-16 chose it next, over more oxygen, the purist page or pruning;
    their words earlier: "I envisioned the field just to guide the underlying interactions. Maybe we let them mutate
    their different fields more"). Back to the moire as the heart of the look:
    - FIELD GENES: every field parameter a cell uses becomes its own gene and mutates, per field (A, B, partner A'):
      lever (how far its lattice is from the medium's, i.e. its beat period), emission strength, sensing gain and
      SIGN, tuning width (how picky its receptor is), lattice angle. Founders start at today's values.
    - FIELDS AS GUIDES: what a cell feels at each membrane side (the exact segment integrals sensing already computes)
      GATES its interactions, each through its own small gene (start near 0, so guidance must evolve):
      glue per side (more or less sticky where the field is high), pumps and engines (rate up or down with the
      local field), division axis (along or across the local gradient), turning of the front toward the gradient.
    - The direct PUSH becomes one more gene (push gain), so evolution chooses between pushing and guiding.
    - Each gate its own switch; a control where gates have no effect but the genes still drift (neutral drift) to
      tell selection from noise. Census of gate genes over time; a view that colours cells by their strongest gate.
    - Expected look: tissues that follow the moire landscape: sticky stripes along beat rings, divisions lined up with
      the rings, lineages with their own beat period tiling the dish. Tissue lab first (each gate alone, hand-set),
      then evolution.
    AS BUILT (C13, 2026-11-16): src/guides.js; field genes per field (A lever/emission/gain+sign/width/angle, B same,
    A' share + gain); gates from s_k = tanh(felt/2.3) per side, genes -1..1 (founders +-0.05); push gene 0..2; view
    V "guides" (ivory glue, teal pumps, green engines, lilac division, yellow turn). LAB: each gate visible (division:
    round / column / sprawl; turn: one sheet vs ring of rosettes; glue: tight sheet with a wedge flower vs loose rows;
    engines: dark-cored middle), ~4x stronger with the long beat. EVOLUTION: NULL, gate genes drift like the neutral
    control (+-0.6); beat periods do not tile the dish (median 4.5-7 R). Speed -7..8 %.
BUILD QUEUE (user 2026-11-16: "stop the glider hunt for now, we are changing a lot of things. Do the rest of the
    expansions"; glider WIP kept on branch `gliders`, resume later). Run back to back, report after each:
    1. C12f vents (running)   2. C12g ion flow  ||  N1 nutrient landscape (all five parts as proposed; parallel worktree)
    2b. merge N1 + trace leaks from life + random founder B sign (running)
    2c. M1 WHOLE MEMBRANES (Claude's call: membranes are mostly holes, integrity 0.05-0.25, so ion block, osmosis and
       T1's "inside" cannot act): diagnose the membrane material budget (supply: fusion, grazing, in-cell making; losses:
       bites, wear, division) and fix minimally, derived; plus retune the dark vent preset now the charge field is off
       (broader giver-taker zone: vent rate, sea level, heat).
       AS BUILT (M1, 2026-11-17): src/whole.js, MEMBRANES line. Bottleneck = heavy linker L (cells hold none away from
       springs; oil was fused and shed back). Fixes (derived): HEAD ON OIL in the cell (g/t + lL -> glL/tlL, the table's
       own reaction, spark from the battery; ?oilsoap=0) and BITES THROUGH THE BLOCK (biting atoms are ions, an intact
       bilayer keeps them off its chains; ?biteblock=0). Integrity 0.94 spot oxygen (99 % whole), 0.77 whole dish,
       Oases 0.92, shallows 0.55; default scene stays holey (0.24) once its springs dry. Ion block now holds 41-52 % of
       ion flow; channel genes moved beyond the neutral control in one lineage. OXYGEN (spot, one seed): the self-burn
       loop nearly vanished (14 cells vs 290) and breathers on outside t doubled: needs a second seed. Dark vents: the
       ring exists and founders now start on it (?ventring), but life dies by 4.5-7 min: an ECONOMY problem (upkeep
       0.025/s vs income 0.006-0.023) -> engines should cost upkeep only when EXPRESSED (comes with T1b). Oases knobs do
       not give the geography (colonies centre on mineral springs): next lever a SMELL for trace.
    3. T1a: an inside, kin channels, the self marker as a membrane landscape (Claude's reading), lineage-colour view,
       wild/blank founders   4. T1b: the gene regulatory network + reporter view   5. P1: engulf + kin sparing genes,
       hand-placed predator   6. T1c: designed tissues (plant, filament, biofilm) + random-colony experiments
       + CHEMICAL WARFARE CHECK (user 2026-11-17 chose "measure first"): is poisoning still possible and does it pay?
       Measure at lineage BORDERS vs colony interiors: bursts and membrane bites, OUT-pump genes and what they pump,
       free light atoms / free t / heat in the contact zone, which lineage gains ground; vs a neutral control. Weapons
       exist (OUT pumps, same-row bites, free t inside, heat damage) but M1's bite block and untargeted dumping make
       them weak. NOT YET AGREED, on file: a KIN-GATED PUMP gene (pumping per side rises/falls with the neighbour's
       kinship, like the C13 gates), so evolution picks weapon vs sharing; would go after P2 if the user wants it.
    || D1 DISH SIZE AND DENSITIES (user 2026-11-17, running in worktree ../moire-cells-dish, branch dish): after a
       full-screen dish was shrunk ~5x, WAVES formed: a dense bright front of packed cells sweeping across, an oil/soap
       slick with droplets in its wake, sparse regrowth behind, the front collapsing and restarting (excitable medium).
       Today the dish IS the window: a resize drains the whole substrate (famine), shrinks R, changes R vs the medium
       lattice (clamped 5..9 px), and supplies scale inconsistently (some per area, some per dish). User: "calculate the
       density of energy based on the grid size". Plan: audit; find the wave cause; the DISH gets its own size (set at a new
       culture), the window is only a view; every supply PER AREA; keep the waves reachable on purpose (preset/knob).
       Plus a SQUEEZE / STRETCH tool (user: "scale the dish as if we are compressing the sample"): rescale the dish at
       runtime keeping its contents (cells crowd, substrate resampled, matter exact).
       Plus (user 2026-11-17: "not happy with point like vents. Maybe the microfluidics chip analogy is better"): EXTENDED
       SOURCES (line fissures, soft patches; rates per length/area; points only for the pipette) and PERFUSION: an inlet
       edge bringing a medium recipe (booked in), an outlet edge (booked out), a gentle through-flow added to the prescribed
       currents (chemostat-like gradients); preset 'chip'. G0b later adds the chip's walls and pillars.
       AS BUILT (D1, 2026-11-17, branch dish): src/dish.js, squeeze.js, perfusion.js. CAUSE OF THE WAVES: the window's walls
       closing in (cells kept their px positions, 956 of 1101 ended outside, the soft walls shoved them into a dense pile that
       spread back as a front ~1.9 R/s), plus cells shrinking 3x in place (R from the window), light per cell falling 9x
       (light was per px), the medium lattice 1.03 -> 3.09 R (clamped in px), and a heat-count overflow (2^31) from the
       shove's drag heat that broke the books. The user's REPEATED waves not reproduced (guess: repeated drags + day cycle).
       FIX: the dish has its own size (chosen at a new culture: window as before, ?dish=WxH in R or um, presets, New culture
       dialog, snapshots); a resize only refits the view (dark bands), no drain, no R change. Per area against the 1280x800
       reference of the same starting number: medium = kappa R, light per R^2, clouds in R, capacity, spring rates and oases x
       area/ref (every preset unchanged at that window). ?dishfollow=1 = old exactly; ?perarea=0 ?medium ?power. SQUEEZE
       moire.dish.scale(f) + 0.8x/1.25x buttons (cells move with the sample, grid resampled in whole counts). EXTENDED SOURCES
       matter.addLine (fissures) / addPatch (seeps); Deep vents uses fissures (&pointvents=1 old). PERFUSION (?perfusion=1
       ?flow ?flowdir ?inlet ?outlet ?recipe; prescribed through-flow in psi, outlet booked lost), preset CHIP (life regrows
       from the inlet as a front following the flow profile). PRESS (?press=depth,period: a wall moving in and out, cells
       only), preset FRONTS (strip dish 396x124 R, wall to 0.45 every 240 s: a packed column rides the wall ~2 R/s, the
       tissue regrows as a front after release). Fixed: grid-buffer destroyed-in-submit crash on resize. Known: dish chosen
       at page start; phones get more slots; press moves only the cells' wall; squeeze keeps capacity/oases. Speed not
       measured (GPU shared). For G0: replace perfusion's through() with a pressure-driven flow.
       T1c PAUSED (user 2026-11-17: "stop the tissue experiments, we will change more things before they become valid").
       Committed and kept as tools: src/tissues.js (moire.tissues: PLANT, FILAMENT, BIOFILM as one hand-wired genome each,
       ?tissue=name, zoo buttons, census), src/warfare.js (moire.warfare.census(): border vs interior), ?clockhard=0 (marker
       not clocked by hard light), colonies ?colpower ?colrate. No results yet: rerun designs + colonies + warfare after
       D1, G0, G0b, G1, G2.
    6a. G0 STRONG GLUE + CELLS STIR THE WATER (user 2026-11-17 "yes! do both. Also, is the cells movement stirring the
       liquid too? if not, they should"; after D1, which touches the same grids). Today the adhesion gene is capped at 1
       (body.x 0..1), glue is free up to freeGlue 0.5 per side and costs above, nothing pulls joined cells apart, so the gene
       drifts near 0.5 (P1: no change vs control). (a) CEILING: adhesion gene on a log scale (e.g. 0.05..4), cost rising with
       strength; check numerical stability of very strong glue. (b) JUNCTIONS THAT BREAK: each contact has a breaking
       strength from both sides' glue (and maturity); forces that try to break it: water shear, the squeeze tool, predators
       pulling prey free, division pressure; a junction torn open costs/lets go. (c) CELLS STIR THE WATER: today the currents
       are PRESCRIBED (N1 stream function: moire eddies + gyre) and only drag cells (curDrift); cells moving do not move the
       water (the ripples are a surface layer, not flow). Two-way coupling: a moving cell's drag force goes into the water
       (e.g. vorticity on the heat grid from the curl of the cells' forces, a stream function by a few relaxation passes,
       viscosity and decay; added to the prescribed psi, so transport stays divergence-free, flux-form and exact); the water
       carries substances and other cells. Energy booked (water motion from the cells' work, decays to heat). Expected look:
       crawling colonies leave swirls; dense moving tissue may give "bacterial turbulence" (collective vortices); fronts
       (D1 waves) drag the water. Own switches; streamlines in the machinery view. Build the water solver MASK-READY
       (psi held constant on solid pixels) for G0b.
    6a2. G0b OBSTACLES (user 2026-11-17 asked; Claude: separate step right after G0, sharing its water solver): a solid
       mask on the substrate grid, painted with a tool (walls, blocks, pillars, channels) and in presets (e.g. a MICROFLUIDIC
       chip: channels and pillar arrays, a chamber with an inlet flow). Cells cannot enter (contact push from the mask), water
       flows around (no-slip, low Reynolds: smooth flow, dead zones, no vortex streets), substances do not cross (flux 0 at
       solid faces, exact), optional shadows. Variants: POROUS walls (water and small atoms pass, cells do not: a filter /
       membrane insert). The dish rim itself can become a mask (round dish). Expected: crevices as refuges from predators and
       shear, matter piling in dead zones, colonies channelled along walls, fronts (D1) bending round blocks.
    6a3. S1 SHAPE (user 2026-11-17, after seeing harmonic images of fibroblasts: "shape could also be fundamental now";
       "single cell organisms have no reason to form a static shape ... unless they collaborate more"). After G0b.
       (1) shape genes: spindle (two poles, aspect well beyond today's 0.5 stretch cap), maybe arms; COLLISIONS ON THE REAL
       SHAPE (capsules: segment + rounded ends, same grid). (2) shape as a GENE NETWORK OUTPUT (same DNA, shape by position:
       flat bark, columns, spindles). Payoffs derived, not tuned: exchange ~ membrane length, engulfing must wrap the prey's
       LENGTH (filamentation against grazers), sensing over the real extent, flow/shear (G0). (3) FIBROBLAST LOOP, second
       look: cells lay down ORIENTED fibres (crust chains with a direction on the grid) along their long axis, crawl along
       fibres (contact guidance), traction aligns them; the matrix is a SHARED GOOD (cheaters possible: pressure to link).
       Harmonic view draws the real fibre direction (orange SHG streaks, green-rimmed spindles).
       C15 CARBON (user 2026-11-17: "our chemistry should have a carbon like element"; then "yes, carbon sooner": NEXT after
       D1 merges, ahead of G0/G0b/S1; a design proposal is drafted first, while D1 and G1 run; BEFORE X1, which builds on it): a
       new group derived like the others, the BUILDER: wants FOUR partners (branches, rings, backbones of any length; today's
       linkers only make straight chains), grip in the MIDDLE of the electron table (shares rather than gives or takes), bonds
       strongly to itself. Expected from the C12d table, never written: c-g bonds hold electrons high = FUEL (hydrocarbon /
       sugar-like), c-t settled = CO2-LIKE WASTE (breathing: c-g fuel + t -> c-t + g-t, the real "expel CO2" of C12e), c-c
       backbones = structure (fibres, membranes' tails). Molecules are too many to give each a grid channel: describe them by
       COMPOSITION in a few recycled SPECIES SLOTS (the C14 soup idea, shared with X1's proteins), properties derived from
       composition / sequence. A chemistry rebuild like C12d: old table behind a switch, past numbers stop being comparable.
       DESIGN DONE (2026-11-17): design/C15_carbon_proposal.md (+ carbon_check.py, its output). One light builder c (pull
       Zc = 2, levels -2/-1, hands hold g, t or c, never free), bonds c-g 1, c-t 3.75, c-c 1, carbon sparks doubled; a LADDER
       of 5 mobile C1 molecules (methane-like -> CO2-like, each step OXIDIZE 2.75); TAR = 3 immobile hand counts (crust,
       walls, mud, granules); polarity rule: a bond is polar when its electron falls >= 1. USER CHOICES: REBUILD in stages
       (option R: carbon makes oil, soaps, walls, pigments; linkers l/L and g*/t* retire; inorganic g t G T, minerals,
       fuels, rust, vents stay); dead carbon = MUD (c-c 1); a little FUEL SEEP at vents (springs mostly CO2-like); OXYGEN
       DAMAGES membranes (fat -> soap -> crust) replacing same-row bites; slow open-dish carbon chemistry accepted.
       Build: C15a carbon in the open dish -> C15b cells eat carbon -> C15c lipids/walls/pigments from carbon, linkers
       retire -> species slots with X1. ?carbon=0 = old table; old snapshots load with carbon off.
       X1 SECRETED PROTEINS (user 2026-11-17: "or fibre/protein excretion", "or proteins even for that matter"): S1 part 3
       generalised. Cells BUILD polymers from their stock (linkers + charged atoms, battery paid, matter exact) and keep or
       SECRETE them; every property DERIVED from the polymer's short sequence (as C14 soup would, but made by life): long
       uncharged runs -> FIBRES (polymerise, oriented, stiff, SHG-bright: the fibroblast matrix); charge patterns -> STICKY
       (biofilm glue); a sequence hash -> which reaction it CATALYSES (exoenzymes: digest crust/food outside, a shared good,
       cheaters possible), harmful ones (TOXINS: the warfare question), and slow-fading ones as SIGNALS (quorum sensing).
       Genome: a few protein genes (sequence + rate + keep/secrete), a GRN output for each; the dish holds a few protein
       SPECIES SLOTS on the grid (recycled when a species dies out); proteins decay back to atoms. Order: S1 parts 1-2, then
       X1 with fibres first (contact guidance, traction), then exoenzymes / adhesives / toxins / signals. Engines stay as
       they are (no rewrite into proteins unless the user asks).
       DANGER SIGNALS (user 2026-11-17 asked whether bacteria have death/threat markers: yes, necrosignalling, kin-lysis
       danger sensing, altruistic suicide). Not an alarm rule: KEPT (non-secreted) proteins reach the dish only when a cell
       bursts, so 'inside-only stuff found outside' is a derived DAMP. Add ONE gene-network sense for it (kin-weighted by the
       spilled membrane's self marker: my kin died vs a stranger died); evolution decides the response (walls, pumps, glue,
       fleeing, faster division, suicide). Census: lineages wired to it vs a neutral control under predators / warfare.
    6a4. S2 FLAGELLA AND CILIA (user 2026-11-17 asked; after S1, needs G0's two-way water). Motors as PARTS (the user's
       body-plus-parts plan): FLAGELLUM = a swimmer's motor at the back (or front) along the cell's front; at low Reynolds a
       swimmer is force-free, so it stirs the water as a FORCE DIPOLE (pusher like E. coli / puller like algae), unlike a
       crawler pushing on the floor: dense pushers may give bacterial turbulence. CILIA = short beaters on free sides
       (a GRN output, so tissue edges can grow them), moving water along the surface (a colony pumping food past itself:
       a shared good), each with a beat phase coupled to neighbours through the water -> METACHRONAL WAVES (like airway
       cilia; kin of the loved step 8 curls). Genes: count/placement, beat strength, phase coupling; cost per beat from the
       battery. Look: neon flagellum as a thin wiggling tube trailing the cell; cilia as fine hairs shimmering in waves.
    6a0. F0 FATES REMOVED (user 2026-11-17: "I thought we got rid of the types"; coordinator's miss: T1 said the gene network
       REPLACES the per-fate table, but T1b added the network ALONGSIDE and the old contact-fate rules (Part B: surface ->
       epithelium, cartilage/muscle recruit, neuron inhibition; like-sticks-like matrix J; muscle stretch) still run by
       default (genome.rules.diff = true) and still colour cells. Seen by the user: small cyan (epithelium) and magenta
       (muscle) cells snaking through gaps in amber (cartilage) tissue in the shallows.) USER: "I dont want the fates
       anymore": REMOVE them (no switch): the contact-fate rules, fate-based adhesion matrix and body effects (muscle
       stretch), fate signals, the fate census/legend/keys D and I, the 'fate' view; glue is genetic since C10. After G1
       in main. COLOUR BY JOB: the neon tube's colour from what the cell actually does (its expressed network
       outputs / dominant engine: light eater, burner, breather, wall builder, predator, ...), keeping 'colour means
       function'. Check old presets/snapshots still load; the lab's hand-set fates keep working when the switch is on.
    6b. G1 ERROR CORRECTION (user 2026-11-17 "yes"): a FIDELITY gene (proofreading): higher = fewer mutations per
       division (all genes, incl. the self marker, so the molecular clock slows with it: kin sparing gets something to
       read) but each division costs more battery; hard light's extra mutation still acts (repair may evolve against it).
       Watch: tissues vs loners (do multicellular lineages copy tighter, fewer cheaters?), hot/bright places (mutators?).
       Neutral control as always.
       AS BUILT (G1, 2026-11-17): src/fidelity.js; gene F = genome word 31 (Bio.conv.w, a spare: old genomes load F 0 =
       founders), log factor -2..3; copying errors x e^-F for every gene step and jump, the GRN's nudges/rewires/duplication
       and the self marker's clock; F drifts 0.08 x mutation size per birth, NOT reduced by itself. Hard light's extra = template
       damage, a share beyond = 0.5 out of proofreading's reach. Cost at each birth 0.1 x (e^F - 1) from the parent's battery
       (heat); F <= 0 costs nothing. ?fidelity=0 ?fidelitynull=1 ?fidcost ?fidbeyond; FIDELITY line. QUICK RESULT (20 min, 2
       seeds, colonies + spotlight, shared GPU): F above its control 4/4 but controls wander -0.85..+0.96 (a hint, not a
       result); careful-careful contacts match markers better than sloppy-sloppy in 4/4 on runs, not in controls; dish-wide
       kinship not longer within 20 min; no light/shade or tissue/loner pattern; hard light keeps mutation x2-4 regardless.
       Needs >= 4 seeds per side later. Merged D1 (branch dish) with it. Speed not measured.
    6c. G2 GENE DUPLICATION FOR ENGINES AND PUMPS: a few SILENT slots; a rare duplication copies a working engine or
       pump slot over a silent one (dosage x2, or the copy drifts into a new reaction while the original keeps the cell
       alive: new functions). The GRN already duplicates regulators (T1b, 0.005). Census of engine families branching.
    7. P2: macrophages.
       AS BUILT (P1, 2026-11-17): src/predators.js. ENGULF gene kin.z, KIN SPARING kin.w (founders 0; wild 0..1). Wrap a
       touching cell >= 1.4x smaller in area when 3 x engulf x (1 - spare x kinship) beats the prey's HOLD (glue to its
       other neighbours + 2 x wall + stiffness armour + 0.25), battery >= 0.25, integrity >= 0.3; 3 s wrap (escape
       possible), then a GHOST slot (own grid bucket) digested over 8 s (atoms to stock by room, lipids to the membrane,
       half the battery, rest heat; spill if no room / host dies). GRN output 17 ENGULF, senses MEAL, PREY. ?engulf=0
       ?engulfnull=1 ?kinsparenull=1 ?predmark=1; zoo "predator" button; PREDATION line; Cell 368 bytes. Look: white-hot
       (harmonic: green) arc closing round the prey, ghost in a ring fading inside (harmonic: violet in a dark ring).
       RESULT (colonies 40 min x3 seeds, drops into default/shallows, each vs null): steady 4-20 meals/s, no boom-bust;
       loners ~10x likelier eaten but glue and clusters do not move (dishes are already one clump); ARMOUR SELECTED
       (stiffness higher 9/9 seed pairs, thickness 8/9; crust wall not); cannibalism falls by LOSING the engulf gene
       (colonies 0.25-0.53 vs null 0.57-0.63), not by sparing: kinship inside a lineage fades in 10-20 min (marker match
       0.03-0.17), so sparing has nothing to read; dropped predators never found a lineage, residents' own engulf genes
       spread instead. Only in division mode. Speed -6..10 % (bigger record, not the logic).
       AS BUILT (T1a, 2026-11-17): src/kin.js, Bio 84 words, TISSUES line. Inside (covered sides trade with the neighbour,
       not the dish; ?inside=0), kin channels (fuels, l, L, trace; gene kin.x; ?kinnull ?kinblind controls), self marker
       (Bio 76-79, stripe pattern, kinship = moire-fringe match x phase x display; clock 0.4), lineage view ?view=marker
       (Brainbow hues; dashes/dotting on the rim from zoom 3: looks immunostained), ?founders=wild|blank, lasting default
       mineral spring, trace smell. RESULT: random colonies crash in 2-5 min and ONE lineage fills each dish (the one in
       the spotlight), so lineages barely meet; kin genes and display drift like the null (every neighbour is kin);
       rim/inside gradients are geography; trace smell x2.3-2.5 at oases at 10 min; M1 oxygen finding CONFIRMED on seed 7
       (self-burners 51 vs 384 outside breathers).
       AS BUILT (T1b, 2026-11-17): src/grn.js + cell_grn.wgsl. 8 regulators (x 0..1, inherited), <= 3 inputs each,
       tau 5 s; 14 senses (contacts, fields A/B, battery, swelling, integrity, light, free t, fuel, linkers, trace, heat,
       a neighbours' broadcast signal, kin-weighted); 16 outputs = gene x min(exp(u.x), 4) (pigment, engines, wall,
       thickness, stiffness, glue, pumps, channels, kin channel, display, division, motility, emission A/B); upkeep only
       for EXPRESSED engines and pigment. Mutation nudges, rewires (0.05), retargets outputs (0.03), duplicates (0.005).
       Std/blank founders have no network (factors exactly 1); wild founders random sparse. Reporter view (neon green
       tubes; harmonic red mCherry-like nuclei), k-means cell-type census (GENES line), preset `colonies` (5 wild colonies,
       each own lasting spring + slow vent). Bio 84 -> 156 floats; speed -9..16 %. RESULT: 5-6 real cell types per
       lineage (engine x3.7, pigment x3.2...), in CLONAL PATCHES (~2x chance), not in positions; the neutral control
       looks the same, so types are inherited clones, not induced. Founders' crash still picks the winner (same winner
       with network on or null). Dark vents still die: gradient engines cost more than they earn there. Nothing yet
       rewards cells for differing from neighbours. Old bug found: G at the instant of a resize leaks ~650 atoms.
C12g. MEMBRANES MODULATE ION FLOW (user 2026-11-16 "Yes, membranes modulate ion flow"; after C12f, same files).
    C12e found ions cross the membrane as easily as anything, so osmosis barely bites and cells keep their own oxygen.
    - The lipid BILAYER blocks free ions (g t G T), derived from its make-up: an intact soap/oil bilayer passes ions at a
      small fraction of neutral molecules; damage (integrity) opens holes; the crust WALL is porous (does not block, like
      a bacterial wall). Neutral molecules pass by the gradient as now. ?lipids=0: the linker membrane blocks by integrity.
    - Ions pass through CHANNELS, as genes: a cation channel (givers +) and an anion channel (takers -), each an open
      level that mutates; the C12e stretch channel opens a non-selective path when swollen; C7 pumps stay the active route.
    - Optional, own switch: ion flow through channels also feels the C7 membrane VOLTAGE (charged atoms pushed by it), a
      toy of real electrophysiology.
    - CHARGE FIELD OFF BY DEFAULT (user 2026-11-16: "maybe the way we are handling charge is too exaggerated. Maybe the
      chemicals should be enough ... except the polarity case, membranes, oils etc"; agreed "yes"): salty water screens
      charge within ~1 nm and stays neutral, so the C6b dish-wide charge field (atom drift, pushing cells), C6d dipoles
      and the front following them go behind switches (off). KEEP atom charges (bookkeeping, polarity: oil, soap,
      bilayers) and membrane voltage, channels, pumps. Field B's strength comes from the C13 field genes, not stock charge.
    AS BUILT (C12g, 2026-11-16): src/ions.js. Ion pass = (1-integrity) + integrity x min(1, 1/20 + channel) + stretch;
    channels: level gene gate2.w (log), balance = the old C6c selectivity gene memb.w; ?ionblock ?channels ?ionvolt.
    Charge field off by default (?chargefield=1 restores field, drift, cells feeling it, B from stock; ?dipoles=1);
    field B charge = qGene 0.15 x sign of the B sensing gene (at 1 the colony crumbled). RESULT: the block bites only
    where membranes are whole, and they are mostly holes (integrity 0.05-0.25: the C12b SUPPLY PROBLEM again), so ion
    flow alone changed little (haze, swelling, self-burn loop as C12e); channel genes wander 2-5x the neutral control in a
    different direction per run. Field off: default colony looser, pinker, dark gaps (664 vs 1136 cells); dark vents:
    cells now sit between the vents, but givers pile up at the cores, the giver-taker zone thins and life dies by ~4 min
    (vent preset needs retuning). All founders share B sign + (to fix). Speed: field off ~15 % faster at 2000 cells.
    - Hoped for, never written: oxygen trapped -> cells swell -> stretch channels or anion-channel mutants let t out ->
      haze builds; breathers evolve inward anion channels or pumps. Census of channel genes vs a neutral control.
GLIDERS (user 2026-11-16: "did you notice our short lived gliders? When two cells combine and become fast little
    swimmers"; "I notice gliders all the time, in any condition, they are just a bit rare"). Claude had not seen them
    (screenshots miss them). Guess: a NON-RECIPROCAL pair (A's field genes pull it toward B, B's push it from A: a chase
    at touching distance, as in particle-life gliders), ended by collisions, divisions, glue, drift. HUNT (parallel
    worktree): a detector for fast touching pairs (speed, lifetime, heading, both cells' genes: field signs/gains, tuning,
    lattice angles, glue, fates), census over runs; then make one on demand in the tissue lab from two hand-set genomes;
    then what makes them last. They may be the first thing in the dish that REWARDS sticking together (moving to food).
T1. TISSUES THAT PAY: PRESSURE TO LINK (user 2026-11-16: "we have no evolutive pressure to encourage linking"; asked
    "could we design some tissues that run in our engine? like light eaters surrounded by strong celled ones (like
    plants)"). After C12f, C12g. Pieces, each its own switch, in this order:
    - AN INSIDE: a membrane side pressed against a neighbour exchanges with that neighbour (or not at all), not with the
      dish; outer cells meet the haze, vandal atoms and heat, inner cells are sheltered.
    - SAME DNA, DIFFERENT JOBS, BY A GENE NETWORK (user 2026-11-16: "our genetics must be stronger, tissue differentiation
      by contact is too rigid. We need to approximate that with phenotype and genes"; REPLACES the per-fate modifier
      table): each cell runs a small GENE REGULATORY NETWORK. A handful of regulator genes (~6-8) with EXPRESSION levels
      (cell state, inherited by daughters = cell memory), wired by genome weights (sparse: a few inputs each), updated
      slowly: x_i <- sigmoid(sum W_ij x_j + sum V_ik sense_k + b_i). SENSES: contacts and free sides, what the membrane
      feels of each field, light, oxygen/t inside, battery, swelling, stock, neighbours' signals (cells can emit a
      regulator as a contact signal). OUTPUTS modulate the existing genes as base levels (pigment, engine rates, wall,
      thickness, stiffness, glue per side, pumps, channels, division readiness, motility, field emission). PHENOTYPE =
      genes x state x surroundings. Cell types are then stable ATTRACTORS of the network (Waddington landscape), not
      rules; the contact fates become one input among many (or readouts). Mutation tweaks weights, rewires, sometimes
      DUPLICATES a regulator. Founders with zero weights behave as today. Look: a REPORTER view, like GFP reporters
      (pick a regulator, cells glow by its expression). Neutral control as always.
    - KIN CHANNELS: passive sharing through contacts with similar cells (plasmodesmata / gap junctions) as a gene.
    - Hand-designed tissues in the lab, each from ONE genome: PLANT (leaf core, bark ring), CYANOBACTERIAL FILAMENT
      (light-eaters with a thick-walled breather every few cells eating the chain's oxygen, like heterocysts), BIOFILM
      (crust-building top, fermenting bottom). Test survival vs the same cells loose; then release with mutation: do they
      keep shape, do cheaters appear, does evolution find its own designs?
    Background given to the user: real multicellularity from daughters not separating (snowflake yeast), safety in size
    (algae under predation), division of labour (heterocysts).
PREDATORS (user 2026-11-16 "should we start planning for macrophages? and other types of predators"; UNDER
    DISCUSSION, not agreed). Claude's proposal: predation is the missing PRESSURE TO LINK (algae evolve clumps under a
    predator that eats single cells). ENGULF gene (costs battery + membrane); only smaller cells can be wrapped; the
    prey's GLUE to its neighbours resists (pull it free first), so a clump acts as one big cell; crust walls / stiff
    membranes resist; matter conserved (prey's stock and lipids into the predator, battery to heat/food, digested over
    seconds). Look: outline wrapping round the prey, prey a fading ghost inside (phagosome). Kinds: engulfers, grazers
    (nibble walls at tissue edges), poisoners (burst neighbours, eat the spill), pack hunters (gliders?), MACROPHAGES
    (in-body cell type eating strangers/debris, sparing kin via the identity key; needs the T1 gene network). Suggested
    order: free engulfers with T1 (the reason to link), macrophages after the gene network. Watch: boom-bust, predator
    spirals and waves; risk of wipe-out (refuges, costs).
    DECIDED (user 2026-11-16: "I think it's fair to add those genes, right? It is a gigantic level of abstraction
    anyways"): ENGULF is an evolvable gene (founders 0; no rule names a predator); the add-cell tool can also place a
    hand-made predator; KIN SPARING is a gene too (reads the existing identity key/receptors), founders 0, so early
    predators are cannibals and sparing kin must pay to spread. Built with T1; macrophages after the gene network.
    KIN BY A SELF MARKER (user: "cannibalism should select itself off. But then they need to be able to tell its genetic
    proximity to each other"): a dedicated MARKER of a few numbers with no other effect, drifting at every birth (a
    molecular clock), so marker distance ~ time since the common ancestor (like MHC / slime-mould and sea-squirt fusion
    genes); kin sparing = tolerance on marker distance. Separate from the identity key (the key is the moire lattice,
    under selection, so unrelated lineages could converge). Watch whether cannibalism dies out (kin selection) vs a
    neutral control; it may persist (starving colonies). View: colour by marker, like Brainbow / Confetti lineage tracing
    (a view, not the default).
    MARKER AS A MEMBRANE LANDSCAPE (user 2026-11-16: "add a gene for marker membrane landscape"; Claude's reading, to
    confirm): the marker genes set a PATTERN on the membrane surface (a small periodic landscape around the outline:
    e.g. lattice angle, period, phase per side), like surface molecules / MHC on a real cell. At a contact two membranes'
    landscapes are compared by their MOIRE BEAT: near-identical patterns beat slowly (match = kin), different ones beat
    fast (stranger). A gene sets how much marker the cell DISPLAYS (it can hide it: camouflage, mimicry), and the gene
    network may regulate it. Drawn as fine texture on the membrane when zoomed (like surface immunostaining).
N1. A NUTRIENT LANDSCAPE, LIGHT LESS EASY (user 2026-11-16: "I think light is fueling them too easily. We might need to
    make the nutrient landscape more interesting"; PROPOSED, awaiting the user's pick; after C12f). Claude's proposal:
    (1) diagnose: share of energy from light, whether raw materials ever limit; (2) light needs matter: pigments built
    from stock atoms and wearing out (upkeep); photosynthesis saturates, photoinhibition at high light; (3) ONE SCARCE
    NUTRIENT (phosphorus-like) only from a few springs -> oases; springs that wander, pulse, dry up; (4) CAUSTIC LIGHT: the
    ripple layer as the water surface focusing light into a wandering bright net; (5) CURRENTS: slow flow carrying
    nutrients in plumes and eddies, possibly derived from the medium's moire beat (the original "chemical landscape made
    of moire beats").
    AS BUILT (N1 + merge, 2026-11-16): all five parts on by default (src/pigments.js, oases.js, water.js; presets oases,
    plumes). Diagnosis: light made ~100 % of income, only 13-25 % of photons used (no trace / no material). Pigment =
    2 l + 1 trace, wears 1/120 s, bleaches past saturation; trace = the scarce nutrient (oasis springs only, roam,
    pulse, dry, settle into the floor); caustics from ripples + a fixed swell; currents from the medium's moire beat
    (hex eddies ~19 R) + a reversing gyre, flux-form exact. Merge follow-ups: worn pigment's trace goes to the DISH
    (?pigshed=0), founders get a mixed B sign (?bsign=plus). RESULT: light still makes 92-100 % of income where lit; the
    default scene is one round colony round the lasting oasis in the spot; in the Oases preset cells sit near oases only
    by chance (currents spread trace over the dish in ~50 R plumes); 5x faster trace settling gathers cells at oases at
    10 min (x3.1) but kills light income, back to chance by 20 min: the wanted geography lies between (not tuned).
    Speed (GPU free): 2000 cells x7.45 neon / x8.1 harmonic; 10 000 x1.84 / x2.06.
EXPERIMENT STYLE FOR T1 AND PREDATORS (user 2026-11-16: "we just need to play with different very random initial stem
    cells in different colonies and see it unfolds"): no hand designs needed to start; several colonies, each from its own
    random founder (?spread=colonies&colonies=N, diversity mixed: colony k = founder k; works today), watched as they meet.
    Add a WILD FOUNDERS switch: every gene from its full range (field genes, gates, stretch genes, later the gene-network
    wiring, engulf, kin sparing, marker) vs BLANK founders (new abilities at 0, must evolve). Lineage-colour view to watch.
C12f. VENTS THAT FEED LIFE IN THE DARK (user 2026-11-16 "maybe we should adapt the chemistry then", after the app
    worker found a fully dark vent dish starves in 100 s: fermenting vent fuel earns the culture ~0.001 energy/s). Start
    after C12e is merged (same files). First DIAGNOSE (vent rate, engine rates, sparks, C12e saturation clogging small
    releases, upkeep). Then CHEMOSYNTHESIS from a redox gradient, derived from the electron table: the vent becomes a
    HOT source of free givers (g, G: hydrogen/iron-like, reduced), the "sea" a faint dish-wide background of free heavy
    takers T (sulfate/CO2-like, booked as input like springs); G+T -> GT 2.375, g+T -> gT 1.5. Sparks keep it slow in
    the cold open, vent heat burns it abiotically close in, cells' engines (enzymes) run it anywhere. Hoped for (never
    written): rings of life around vents in total darkness.
    AS BUILT (C12f, 2026-11-16): src/vents.js. Diagnosis of the old dark vent: chemistry, not a bug (the vent's own
    products reacted away in the open, founders carried the wrong engine, income ~2000x below upkeep). Hot vent (?hotvent=1:
    drips G .4 g .3 gT .11 GT .11 trace .08, 10 energy of heat per atom) and SEA (?sea=1: T topped up toward 0.5 per R^2),
    both booked; OFF by default (a hot vent starved the default scene), ON in the Deep vents preset (now truly dark;
    &light=full = dim). Gradient engines (g+T, G+T) counted apart. RESULT: the hoped-for geography forms (hot core with
    GT ash, a cold RING 9-30 R where free G, g and T sit unburned) and selection for gradient eaters is fast and complete
    (every survivor by 5 min), but life still dies by 16-20 min and the ring stays EMPTY, from older rules: (1) the
    vent's free givers make a strong + charge field that pushes g-flooded cells out at 1 R/s; (2) the stock clogs with
    fast g and slow gT so T cannot get in (stock room 0.3 + 0.7 x integrity, integrity ~0.08); (3) trace floor far
    from vents. ?membrane=0 survives 40 min as a boom-bust belt at the dish edge. Both main limits are ION FLOW: rerun
    batch-dark after C12g. Speed after the merge (GPU free): 2000 cells x7.4 neon / x7.8 harmonic; 10 000 x1.75 / x1.9.
VIEW AND APP (user 2026-11-16, alongside C12e; two parallel branches):
H1. HARMONIC VIEW (user: "one of my original inspirations are these higher harmonic microscopy images"; they showed a
    multiphoton tissue image: green thin rims around dark interiors (muscle-fibre honeycomb, threads, hollow rings),
    orange/yellow fibrous swirls between them, blue-violet wisps on surfaces; black ground; 100 nm scale bar). An
    ALTERNATIVE rendering mode beside the neon look (switch + URL ?look=harmonic). Colour keeps meaning, by the physics
    of each channel: GREEN (THG-like) = interfaces: membranes (brighter with lipid), oil/soap boundaries, vesicles, so
    packed tissue reads as a green honeycomb with dark insides; ORANGE (SHG-like) = ordered fibres: crust chains and
    walls, stretched/aligned cells as fibrous streaks (the moire beat may give the fibre direction); BLUE-VIOLET
    (autofluorescence-like) = metabolism: fuel, batteries, running engines. No neon halo, trails or flicker; slight
    blur and photon grain. User: "they don't need to be strictly like that, just the general look" (the mapping is a
    guide). The reference image is the user's: never commit it (public repo).
APP. Zoom and pan (pinch on touch; the wheel keeps tilting the spotlight in spotlight mode), ZOO panels (molecules: the
    periodic table drawn, energies, absorption, glow; cells: the lineages living now, portraits, counts), tools to ADD
    CELLS (pick from the zoo or founder types, tap to place) and a molecule pipette, NEW CULTURE dialog (founders, how
    spread: one clump / scattered / several colonies, diversity) and PRESET ENVIRONMENTS (e.g. hot vent in the dark,
    sunlit shallows, oil slick, oxygen world, crust desert, tissue lab), each with a one-line description.
    AS BUILT (H1 + APP, merged 2026-11-16): src/harmonic.js + shaders/harmonic.wgsl (key ` backquote, ?look=harmonic,
    ?blur ?grain ?scalebar): green rims (membranes, oil/soap rings), orange fibrous crust (swirl from the moire beat),
    striations in stretched/muscle cells, violet fuel haze and battery glow; rims widen only with sqrt(zoom). Default
    electron chemistry makes little crust, so the big orange masses show in crust-rich dishes (preset desert).
    APP: src/camera.js app.js zoo.js culture.js; zoom x1..x8 (Ctrl+wheel, wheel when no spotlight, middle/Space-drag
    pan, pinch: untested on a device), one scale bar (12 um per cell) following the zoom; molecules and cells zoos
    (portraits stay neon), add-cell tool (starter charge booked), pipette; New culture dialog; ?preset= vent, shallows,
    oxygen, slick, desert, lab; ?spread ?colonies ?diversity ?zoom. Finding: vents in total darkness starve in 100 s
    (preset vent has a dim light; &light=off = dark) -> C12f.
LATER, SPEED (user 2026-11-16 asked whether a desktop Python/C++ app would be faster; answer: little, the work is GPU
    shaders, native gains ~10-30 % overhead, Python wgpu ~ Firefox; real gains from PROFILING in the browser (GPU
    timestamps per pass; suspects: the grown cell_eat shader, grid passes that could run less often, panel read-backs),
    likely 1.5-3x. User: "Let's wait": not scheduled.
LATER, WATER-DROP UNIVERSE (user 2026-11-16 brainstorm, "keep it as a plan for us to go to later"; not scheduled).
    User's idea: "a 2.5D representation in which the 2D rendered cells can stack, but the rules under it go 3D" (chosen
    over a full 3D beaker, which would be close to a second engine; a 2D side-view "column mode" was also discussed).
    A "drop" mode beside the petri dish:
    - Look: flat neon cells at a height, overlapping where stacked; a FOCUS PLANE: in focus = sharp tubes, out of focus =
      soft glowing bokeh discs (depth without spending colour); focus slider; optional depth-colour-coded projection.
    - Rules 3D underneath: cells as hexagonal PRISMS (6 sides + top + bottom faces for sensing, glue, contact), so crowded
      cells climb, pile, form spheroids; substrate in a few depth layers following the drop's dome (thin rim, thick
      middle); gravity (crust sinks, oil floats into a surface skin, cells sink/float by what they carry); light fading
      with depth; moire lattices stay in-plane, envelopes use 3D distance.
    - Variants: SITTING drop (dome; coffee ring if evaporation at the rim) and HANGING drop (gravity to the tip: the
      organoid/spheroid method; Claude's pick to go first). Switch: air brings oxygen in at the surface, or not.
    - Order proposed: the drop alone (dome, layers, gravity, light depth) -> cells get height (3D contact, stacking,
      buoyancy, focus drawing) -> hanging drop / coffee ring.
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
