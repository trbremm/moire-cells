// Boot, frame loop, input and the F overlay.
//
// Frame loop: the simulation runs in fixed ticks of 1/60 s (at most MAX_TICKS per frame and per 1x of speed, so a slow
// frame slows the simulation instead of exploding it). Speeds (step C3b; keys [ ], the toolbar): 1x to 8x as before;
// 16x and 32x (timelapse) and MAX run more ticks per drawn frame, capped by a budget of ticks that adapts to the
// measured time between frames (see `budgets`), never more than TICK_CAP. The ticks are the same at any speed; only how many run
// between two drawn frames changes. Space pauses (no ticks; the picture stays). Each frame:
//   1. every layer's compute(encoder, frame) records its compute passes (in layer order),
//   2. the drawing (step C6n, src/neon.js): the background onto the canvas; the cells into the trail buffer; the other
//      layers' render(pass, frame) (in layer order) and renderTop into the light buffer, with the cells copied in between;
//      the halo; the light composited onto the canvas,
//   3. submit.
// To add a step (landscape, cells, ...), write a class with resize / compute / render and push it into `layers`.
//
// URL parameters (handy for headless screenshots, see tools/shot.py):
//   ?overlay=1  show the frame-time / adapter overlay from the start (overlay=ghost: kept up to date but
//               invisible, so tools/shot.py can print it without it covering the picture)
//   ?ripple=1   drop a ripple every 0.7 s at varying spots
//   ?debug=1    copy console warnings and errors into the overlay
//   ?nogpu=1    pretend WebGPU is missing (to see the fallback message)
//   ?tanh=raw   the shaders' own tanh (before 2026-11-22; default safe: tanh of the input clamped to +-15, the same result where a GPU does
//               it right, finite where one overflows to NaN); ?tanh=naive every tanh as (e^2x - 1) / (e^2x + 1), what such a GPU does (a test;
//               src/gpu.js patchTanh). ?gpuguard=0 no guard in the cells' step (default: a cell whose numbers come out NaN or infinite is put
//               back where it was and counted; the overlay's "gpu maths" line). gpucheck.html: the GPU's maths against the expected values
//   ?cells=N    number of cells (default 2000; on a phone or small touch screen fewer, see defaultCells)
//   ?check=1    compare the cells' neighbour grid with brute force every 2 s (console)
//   ?seed=N     seed of the random start (cells, genomes); default random
//   ?speed=N    simulation speed: 1, 2, 4, 8, 16 or 32 ticks of 1/60 s per 1/60 s of real time, or max (keys [ and ])
//   ?paused=1   start paused (Space)
//   ?ui=0|1     step C3b: start with the toolbar folded / unfolded (default: as the page last had it)
//   ?founders=N founder genomes at the start (0 = every cell its own)
//   ?bsign=plus  the founders' field-B sensing sign all + (as until the C12g + N1 merge; default mixed: + or - at random, both present)
//   ?pigshed=0   a worn or bleached pigment's trace back into the stock (default: into the dish under the cell; step N1 follow-up)
//   ?view=1     colour by lineage from the start (key V); ?view=2 (or strategy): by strategy (step C6)
//   ?bio=0      start with the biology rules off (H B T M): the loop alone
//   ?legend=0   step F0: the job legend hidden (View panel); ?view=job (the default; ?view=fate means it too)
//   ?excl=0|1   step 7 exclusion off / on from the start (key 8); ?states=2..4 its number of states;
//               ?flip=0|1 its state flip (key 9)
//   ?partner=0|1 step 8, rule a: the partner A' felt as a phase current (key Z); ?change=0|1 rule b (key ,);
//               ?clock=0|1 its mode (key '); ?side=0|1 rule c, sideways push (key .)
//   ?heat=0     step C1: start with the kicks from heat off (the old constant jitter; Shift+H)
//   ?entropy=1  step C1: start with the entropy panel shown (Shift+E; since the toy front it starts hidden)
//   ?dev=1      the toy front (src/toy.js): start in the developer mode (the old toolbar, every panel, the hint line; key D or the gear)
//   ?terrain=name  the toy front: a generated world (src/terrain.js: maze, thicket, caves, delta, forest, hive, rings, spiral, islands,
//               sieve) from ?seed=N (its own random stream), on the dish ?dish=WxH; ?ui=0 hides every control (pictures)
//   ?simmer=0   step C1: start with the ripples not driven by heat (Shift+R)
//   ?light=spot|full|off   step C2: the light's mode (Shift+L); ?spot=x,y,r the spot's centre and radius (shares of the
//               dish's width, height and shorter side, or CSS px if any is above 2); ?tilt=deg (0..70); ?az=deg (the
//               direction the light comes from: 0 right, 90 below, 180 left, 270 above); ?day=0 no day / night cycle
//               (Shift+D); ?hour=h the hour of the day at the start (12 = noon); ?clouds=0 no clouds (full field);
//               ?power=x the light's power (default 33: per 100 px^2 at the reference R, i.e. 13.9 per R^2; src/dish.js)
//   ?neon=0     step C6n: start with the flat look (key E); ?halo=off|low|medium|high (Shift+1); ?trails=0 (Shift+2);
//               ?hum=0 (Shift+3); ?cheap=0|1 the phone's cheaper neon path off / on (default: on touch screens and small
//               windows); ?machinery=1 start with every diagnostic layer shown (Shift+4; default: the clean view)
//   ?look=harmonic  step H1: start with the harmonic look (key `, src/harmonic.js; ?look=neon, ?look=flat too); ?blur=0,
//               ?grain=0, ?scalebar=0 (its slight blur, photon grain and scale bar off)
//   ?until=T    run until simulation time T (s), then pause, exactly at that tick (for comparing runs; tools/shot.py)
//   ?chargefield=1  step C12g: the dish-wide charge field ON as before C12g (the field, the free atoms' drift, cells feeling it, B
//               charges from the stock; off by default since C12g); ?qgenes=0 with the stock off, B charges fixed (one for all since step F0) instead of
//               from the field genes
//   ?charge=1   step C6b: the charge field on (Shift+7; off by default since C12g); ?qstock=0 the cells' B charges fixed (one for all since step F0) instead of
//               from their stock (Shift+8); ?qfeel=0 the cells not feeling the grid's field (Shift+9); ?contours=1 the
//               charge field's contour lines drawn (Shift+0)
//   ?honeycomb=0  step C6c: start with the ellipse cells instead of the elastic honeycomb (rules panel, Cell shape)
//   ?membrane=0   step C6c: start with the membrane chemistry off; ?bites=0, ?burst=0, ?elastic=0, ?selectivity=0 its rules
//               (rules panel, Membrane chemistry)
//   ?dipoles=1    step C6d: the dipoles (charge per side) on (off by default since C12g); ?dd=0 no dipole-dipole, ?dphi=0 the substrate's
//               field not acting on the side charges, ?dfield=0 no turning and stretching (rules panel, Charge per side)
//   ?pumps=0      step C7: start with the pumps off; ?pumpcontact=0 no pumping across contact, ?voltage=0 no membrane
//               voltage, ?v2b=0 the voltage's energy all heat (not back into the battery) (rules panel, Pumps)
//   ?crystal=0    step C7b: start with crystal seeding off (sediment no longer lowers the spark of its own formation);
//               ?cofactor=0 the engines' rates not scaled by the trace inside (rules panel, Catalysts)
//   ?hardmut=0    step C8: start with hard light not mutating the cells (rules panel, Hard light)
//   ?divide=0     step C9: the old turnover, a fixed count (default 1: cells divide and die, the count changes); ?cap=N the
//               capacity (slots; default 3 x the starting number, with ?divide=0 the starting number); ?divat=x the division threshold (battery share),
//               ?divcost=x its cost (energy units), ?starve=s the starvation time, ?crowd=x the crowding limit, ?age=x the
//               background death rate per s (rules panel, Division)
//   ?walls=0      step C10: start with the patterned walls off (every side as sticky as the adhesion gene, as before);
//               ?wallfront=0 the front not following the dipole, ?wallcost=0 adhesion free (no linkers, no upkeep), ?mature=0
//               junctions not maturing (rules panel, Patterned walls); ?view=walls colour by wall pattern
//   ?turn=0       step C11: start with the glue not turning the cells; ?divfront=0 divisions along the long axis, not by the front
//               (rules panel, Glue turns cells); ?freeglue=x the free base glue (each side holds this much adhesion at no
//               cost; 0 = every bit of glue costs, as in step C10)
//   ?oil=0        step C12: start with oils and water off (no oil forms or separates); ?phase=0 no phase separation (oil
//               and the rest only spread), ?amphi=0 no amphiphiles (soap), ?fusion=0 no membrane fusion (cells do not take
//               oil into their membranes); ?oilspring=oil|emulsion|soap what the oil tool
//               drops; ?polarity=1 the polarity wash shown (rules panel, Oils and water; view panel)
//   ?lipids=0     step C12b: start with the lipid membranes off (the C6c linker membrane, as before); ?lipheat=0 heat not
//               fluidising the bilayer, ?crack=0 walls not cracking, ?lipheads=0 the soap heads not charging the cells, ?graze=0
//               cells not grazing the crust under them (the supply fix) (rules panel, Lipid membranes)
//   ?excited=0    step C12c: start with the excited waste off (freed light atoms carry no energy: the chemistry as before);
//               ?exshare=x the share of the photon's surplus an excited atom keeps (0..1, default 0.5; fixed for the page),
//               ?exlife=s its lifetime in a cold dish (s), ?exhot=T the temperature at which it fades twice as fast, ?exlook=0
//               the haze not drawn (rules panel, Excited waste; view panel)
//   ?electrons=0  step C12d: the previous chemistry (the step C4 table, C12c as it was) instead of the electrons' table (fixed for
//               the page: src/matter.js reads it when it loads; the rules panel's switch reloads the page). With electrons on:
//               ?fluor=0 no fluorescence, ?photo=0 excited states do not react (no photochemistry in the open), ?glow=0 the glow
//               not drawn; ?kabs=x a matching gap's optical depth, ?yrx=x the share that reacts, ?yfl=x the share of the rest that
//               fluoresces (rules panel, Electrons; view panel)
//   ?carbon=0     step C15a: no carbon (today's chemistry exactly: no carbon channels written or drawn; fixed for the page; old snapshots
//               load this way by themselves). With carbon on: ?cbox=0 no oxidizing by heat, ?cbcond=0 no condensing (no tar forming),
//               ?cblight=0 no reducing / hydrolyzing by hard light, ?cbdis=0 tar neither dissolves nor takes molecules in, ?cbspring=0
//               springs drip no carbon; ?cbkox=x, ?cbkcond=x, ?cbkdis=x, ?cbkset=x the rates; ?cblook=0 carbon not drawn (rules
//               panel, Carbon). Step C15b, cells eat carbon (src/carboncells.js): ?cbcells=0 the cells blind to carbon (as C15a), ?cbexch=0
//               no ladder through the membrane, ?cbeng=0 the carbon engines idle, ?cbgraze=0 no tar grazing, ?cbdis2=0 granules keep their
//               loose carbons, ?cbsmell=0 no smell for carbon fuel; ?cbkgraze=x, ?cbkdis2=x; ?cbsurf=x the tar's surface size (C15b, the
//               open dish: tar thicker than this reacts only at its surface; 0 = all of it, as C15a); ?seep=0 the default scene without
//               its lasting fuel seep; ?cbfounder=x the chance a std founder gets its carbon engines (1/3); GROWTH NEEDS CARBON: ?cbgrow=0
//               off, ?cbbody=x the body's carbon per R^2 (0.05), ?cbbuild=x per s (0.5), ?cbfound=x the founders' body (share of the want, 1)
//               Step C15c, carbon makes the cell (src/carboncells.js): ?cblip=0 step C15b (membranes, walls, pigments, glue of linkers; fixed
//               for the page), ?cbsugar=x sugar-unit-like carbon at the mineral spring (0.06 per atom of its rate), ?cbtrans=0 no carbon
//               TRANSPORTER (the ladder passes at a neutral molecule's rate, as C15b), ?cbktrans=x its rate per level (1), ?cbtransup=x its
//               upkeep per level (energy per s), ?cbred=0 the lipid builder may not reduce burnt hands from the battery, ?cbbite=0 oxygen
//               does not damage membranes, ?cbenz=0 engines need no enzymes (carbon + G), ?cbenzk=x enzyme carbon per unit of rate per R^2,
//               ?cbenzlife=x their life (s), ?cbtool=0 cells placed by the tools start without a body, ?cbhungry=x a hungry cell's
//               grazing (units of a grazing engine: 5; C15b 1)
//               Step C15d, the carbon economy (src/carboncells.js, src/carbon.js, src/genome.js): ?cbshut=0 no reducing shuttle (the builder
//               reduces only from the battery, as C15c), ?cbphoto=0 founders that photosynthesise do not fix carbon by default (C15c's
//               chance 1/3 for photosynthesisers; light + burn founders keep their fermenter), ?cbhydheat=0 mud does not hydrolyse by heat
//               (by hard light only), ?cbgran=0 no fat from granules (the two-carbon builder takes ladder molecules only), ?cbhunger=0 only a
//               cell short of BODY carbon grazes as a hungry one, ?cbpigfound=x founders start with x times the pigment a harvest rate of 1
//               wants (1; 0 = none, as C15c), ?cbwallrec=0 a jolted wall's cracked pieces go into the mud (as C15c), not the cell's
//               granules, ?cbgspring=x the share of a mineral spring's atoms that are G (0.01; 0 = none, as C15c)
//               Step C15e, carbon life viable (src/carboncells.js, src/carbon.js): ?cbenzany=0 an enzyme's frame is 4 cellulose-like carbons
//               (as C15d; fixed for the page, snapshots carry it), ?cbgranred=0 builders do not reduce the granules' burnt hands, ?cbgranhyd=0
//               builders do not open (hydrolyse) the granules' spare backbones for their hands, ?cbgsplit=0 the enzyme builder takes
//               only free G (does not split GT or rust Gt in its stock for it), ?cbbodyany=1 the body takes granule carbons
//               whatever their hands (off by default: C15b's rule, granules only while a quarter of their hands are fuel)
//               Step C15f, carbon life round 3 (src/carboncells.js): ?cbhydfloor=0 the granules' digestion (C15e (l)) pays down to an empty
//               battery (as C15e), not only from above the builder's floor (?cbredfloor); ?cbwallcut=0 a wall's cross-linked pairs are built
//               from two chain carbons only (as C15e), not cut out of the granules as they are first; ?cboilheld=0 the builder makes a
//               side's oil for the soap it wants (as C15e), not only for the soap it holds; ?cbspoilkeep=0 a lipid or wall piece spoiled by
//               oxygen leaves as mud (as C15e), not kept in the cell as granules
//               Step C15g, carbon life round 4: ?cbidlered=0 the pigments' idle photons go to heat (as C15f), not into the builders'
//               reductions (the table's REDUCE on the cell's own burnt hands, one photon a hand); ?cbmembfound=x founders (and placed cells)
//               start with x times a typical founder's whole bilayer (1; 0 = none, as C15f); ?crawlwork=0 the crawl is paid by the speed it
//               would crawl at freely (as C15f), not by the work it does (force . motion; this one acts with ?carbon=0 too)
//   ?saturation=0 step C12e: no saturation (reactions inside cells do not slow as their products pile up); ?osmosis=0 no osmosis (no
//               swelling: the stretch genes still drift, the NEUTRAL control), ?stretch=0 stretch opens no channels, ?tear=0 overstretch
//               does not burst, ?tolcost=0 the stretch tolerance is free; ?satscale=x, ?kosm=x, ?kstretch=x, ?wtol=x knobs;
//               ?photolysis=0 light cannot free atoms in the open dish (any free t is made by life) (rules panel, Waste must leave)
//   ?hotvent=1    step C12f: a HOT vent of free givers instead of the C12d vent (fuel and metal-like givers, no heat; the default
//               except in the Deep vents preset);
//               ?ventheat=x the heat a hot vent puts in per atom it drips; ?sea=1 the SEA's faint supply of the free heavy taker T
//               everywhere (on in the Deep vents preset), ?searate=x its rate (atoms per R² per s at an empty pixel), ?sealevel=x its
//               level (atoms per R²) (rules panel, Vents in the dark); ?starter=x the founders' starter charge (a share of the
//               battery, default 0.4; booked as energy in)
//   ?ionblock=0   step C12g: the lipid bilayer does not block free ions (they pass as neutral molecules, as before; the C6c selectivity
//               then scales them again); ?channels=0 the channel genes do not act (every cell's cation and anion channels at the base
//               level: the genes drift, the NEUTRAL control); ?ionvolt=1 ions through the intact membrane feel the membrane voltage;
//               ?ionpass=x the bilayer's own ion leak (share of a neutral's rate), ?chanbase=x the founders' channel level, ?kv=x the
//               voltage push (rules panel, Ion flow)
//   ?oilsoap=0    step M1: cells do not put a head on oil to make soap (as step C12b); ?biteblock=0 free atoms bite a whole bilayer as a
//               holey one (as step C12b) (rules panel, Whole membranes)
//   ?inside=0     step T1a: no inside (a side pressed against a neighbour trades with the dish as any other); ?kinchan=0 no kin channels;
//               ?kinnull=1 the kin channels' NEUTRAL control (they move nothing, the genes drift); ?kinblind=1 the channels open to every
//               neighbour (kinship ignored); ?clock=0 the self marker does not drift; ?smelltrace=0 the corners smell the fuels only;
//               ?kink=x ?seal=x ?press=x ?clocksize=x ?traceworth=x the knobs; ?founders=wild|blank|std the founder mode (any number:
//               how many founders, as before); ?view=marker colour by the self marker (lineage); ?lasting=0 the default scene's mineral
//               spring dries after a day (240 s) as before step T1a (rules panel, Tissues 1)
//   ?engulf=0     step P1: no engulfing (predators); ?engulfnull=1 its NEUTRAL control (the engulf and kin sparing genes drift, nothing is
//               ever engulfed); ?kinsparenull=1 kinship ignored (the sparing gene drifts without effect); knobs ?sizeratio= ?drive= ?holdbase=
//               ?wallarm= ?stiffarm= ?wraptime= ?digesttime= ?startrate= ?batstart= ?wrapcost= ?startcost= ?wrapshare= ?batshare= ?predcensus=;
//               ?predmark=1 the machinery's mark of engulf-capable cells; the founders' wild group 'engulf' (?founders=wild) draws the genes
//   ?p3=0         step P3, cells that sense cells (src/senses.js): every part off (exactly as before P3); ?nose=0 the smell as in N2 (else a relative
//               gradient, averaged over ?nosetau= s, soft response ?nosehalf= ?fuelfloor=); ?taste=0 no taste dials (?tastenull=1 their NEUTRAL
//               control: the dials and range drift, nothing steers, nothing is paid; knobs ?tastespeed= ?tastehalf= ?rangegain= ?rangecost=);
//               ?clump=0 the engulf size test by the prey alone (else its glued group; ?tug=); ?sharedarmour=0 the wall on every side (?kinshare=);
//               ?p3census= ?p3near= (rules panel, Cells that sense cells)
//   ?g3=0         step G3, the moire genome (src/folding.js): the gene network's links are step T1b's free weights again (else DERIVED from the
//               regulators' lattices); ?fold=0 no fold; ?foldlife=0 no refolding in life; ?foldnull=1 the fold's NEUTRAL control (folds drift and
//               switch, links from the home fold); ?dose=0 no damage dose written (?dosenull=1 collected, never written); ?repair=0 the fidelity
//               gene does not repair the dose; ?buffer=0 no buffering (?buffernull=1 its neutral control); knobs ?g3sigma= ?g3wmax= ?g3wmin=
//               ?latstep= ?phstep= ?latjump= ?foldstep= ?refold= ?s0= ?kon= ?koff= ?doseheat= ?doseox= ?dosestep= ?repk= ?repcost= ?bufcap=
//               ?bufcost= ?buffounder= ?bufweaken= ?g3census= (rules panel, Moire genome); ?g3out=0 outputs wired as in T1b (else by lattice, so a
//               refold changes which regulator drives each gene); ?g3founders=0 std founders without output gains (?foundergain= ?foundershare=)
//   ?signal=0     step Q1, a signal substance (src/signals.js): no signal at all (the genes carried, no grid, nothing heard); ?sigflow=0 the water
//               does not carry it; ?junction=0 no release through junctions; ?sigtaste=0 its taste dial does not steer; ?fastreg=0 no fast
//               regulators; ?signalnull=1 the NEUTRAL control (released and paid, heard at a random place); ?sigmut=0 its genes copy exactly;
//               knobs ?sigspread= ?siglife= ?sigpower= ?hearw= ?hearj= ?taufast= ?sigcensus= (rules panel, Signal substance); ?view=signals;
//               ?tissue=relay (the hand-wired relay sheet)
//   ?contract=0   step L1, contraction (src/contract.js): no cell contracts (the genes carried, never mutating); ?contractnull=1 its NEUTRAL
//               control (the genes drift, nothing contracts, nothing is paid); ?contractgrn=0 the gene alone (the network's 23rd output does not
//               act); knobs ?concost= ?concensus= (rules panel, Contraction); ?tissue=organ the tissue lab's organ (src/tissues.js: muscle,
//               nerve, skin; ?organ=muscle|ring|worm, ?pacemaker=1)
//   ?flagella=0   step S2: no flagella; ?cilia=0 no cilia (both 0: exactly as before S2); ?flagellanull=1 ?cilianull=1 their NEUTRAL controls
//               (the genes drift, nothing acts, nothing is paid); ?mogrn=0 ?mowater=0 ?modipole=0 ?mopump=0 ?mocouple=0 ?mosteer=0 ?motorque=0
//               one part off; knobs ?swim= ?steer= ?arm= ?dipole= ?swimdrift= ?ciliapush= ?beathz= ?couple= ?lag= ?swimcost= ?ciliaup=
//               ?flagwant= ?ciliawant= ?mocensus=; ?modraw=0 the motors not drawn (src/motors.js; rules panel, Flagella and cilia)
//   ?n2=0         step N2: substances flow as in step N1 (every part off); ?heatflow=0 ?gusts=0 ?scour=0 ?patchy=0 ?chemo=0 one part off;
//               ?chemonull=1 the chemotaxis gene's NEUTRAL control; knobs ?flowx= ?gust= ?sweep= ?tide= ?tideperiod= ?scourspeed= ?carry=
//               ?springlife= ?springgap= ?flowcensus= (src/flow.js; rules panel, Substances that flow); ?terrain=currents the world for it
//   ?shape=0      step S1: cell shape off (today's round contacts exactly); ?shapenull=1 the elongation gene's NEUTRAL control (it drifts, cells
//               ask to be round); ?shapegene=0 ?shapegrn=0 ?shapetorque=0 ?shapeexch=0 ?shapewrap=0 one part off; ?aspmax= the longest
//               aspect (1.2..4, default 4); ?shapeturn= x the derived turning (rules panel, Cell shape)
//   ?glueceil=0   step G0: the glue gene capped at 1 again (linear, as before G0); ?gluecost=0 glue above 1 costs per unit as below it;
//               ?breaks=0 junctions never tear; ?gluenull=1 the glue's NEUTRAL control (the gene drifts, every effect at the founder's
//               value); ?tearat=x a junction tears this share past the contact distance (0.05), ?heal=s a torn side heals after s on
//               average (4) (rules panel, Strong glue)
//   ?stir=0       step G0: the cells do not stir the water (the currents only prescribed, as before); ?stirsplit=0 the stirred water's work
//               on cells not taken from heat (booked as work in, like the prescribed currents); ?stirgain=x ?stirwet=x ?stirreach=R
//               ?stirfade=s ?stirscreen=R the knobs (rules panel, Stirred water)
//   ?fidelity=0   step G1: no error correction (the fidelity gene frozen, no effect, no cost: today's mutation); ?fidelitynull=1 its NEUTRAL
//               control (the gene drifts, no effect, no cost); ?fidcost=x proofreading's cost (energy units a birth at e^F - 1 = 1, 0.1),
//               ?fidbeyond=x the share of hard light's extra mutation proofreading cannot catch (0.5), ?fidcensus=s the census's interval
//               (rules panel, Error correction)
//   ?dup=0        step G2: no gene duplication (the two silent engine slots stay silent, no pump copies: exactly as before G2); ?dupnull=1
//               its NEUTRAL control (copies are made, drift and are lost as when on, but have no effect and cost nothing); ?duprate=x the
//               chance per birth of a duplication (0.02), ?dupdel=x of a copy's loss (0.02), both x the copying scale; ?dupcensus=s the
//               census's interval (rules panel, Gene duplication)
//   ?mut=x        step M2: every copying error x x (default 2.5; 1 = before 2026-11-24; 0 = exact copies, hard light's extra included, key M off); ?mutmode=rare
//               RARE BIG STEPS (exact copies, a mutation with chance ?mutp= (0.1) changing 1-3 gene groups by ?mutbig= (8) x the small
//               step), drift (default) every gene nudged at every birth; ?mutcensus=s the census's interval (rules panel, Mutation sweep)
//   ?grn=0        step T1b: the gene network frozen, without effect (as before T1b); ?grnnull=1 its NEUTRAL control (it runs and mutates,
//               its outputs have no effect); ?grnsignal=0 no contact signal; ?grnkin=0 the signal not weighted by kinship; ?grnmut=0 the
//               network copied exactly at births; ?grntau=x the expression's time constant (s); ?reporter=i the regulator the reporter
//               view shows (0..7); ?view=reporter that view; the founders' wild group 'grn' (?founders=wild) wires a random network
//               (rules panel, Gene network)
//   ?fgenes=0     step C13: start with the field genes off (every cell today's lever, emission, sensing, tuning, angle; the genes
//               still drift); ?gateglue=0, ?gatepump=0, ?gateengine=0, ?gatediv=0, ?gateturn=0 one gate off (?gates=0 all five),
//               ?pushgene=0 the push gene off (field A pushes every cell as before), ?gatenull=1 the NEUTRAL control (the gate
//               genes and the push gene drift but act on nothing); ?gateref=x the felt reference, ?gateturnrate=x the turn gate's
//               rate (rules panel, Fields as guides); ?view=guides colour by the strongest gate
//   ?preset=name  app (src/culture.js): a preset dish (vent, shallows, oxygen, slick, desert, lab; its options fill in what the URL
//               does not say); ?spread=clump|scatter|colonies|ring, ?colonies=N, ?diversity=clone|few|mixed|random (the new culture);
//               ?zoom=z or ?zoom=z,x,y the view zoomed (centre as shares of the dish)
//   ?dish=WxH     the dish's size in cell radii (or WxHum in micrometres), kept while the window changes (src/dish.js; default: the
//               window's at the start); ?dishfollow=1 the window IS the dish, as before (a resize re-sizes it: new R, new grid, the
//               old drained, supplies per px); ?medium=x the medium lattice's R in cell radii (default 9 px over the reference R: 1.389 for 2000 cells); ?perarea=0 a fixed
//               dish with the old amounts (light per px^2, capacity 3 x the starting number, springs and oases per dish, medium 1.389 R);
//               ?press=depth,period[,bottom] the right (bottom) wall presses the cells in to depth x the dish and lets go, every period s
//   ?dish=round   step G0b (src/obstacles.js): a ROUND dish (the outside of the inscribed circle is a solid rim; also ?dish=WxH,round or
//               ?round=1); ?obstacles=0 the obstacles ignored (the mask acts on nothing); ?obsflow=0 perfusion keeps its prescribed profile
//               (not solved round the obstacles); console moire.obstacles.line / path / rect / circle / pillars / erase / undo / clear
//   ?mut=0      start with mutation off (key M); ?life=0 with the life cycle off (key T: no births, no deaths)
//   Experiments (src/lab.js, src/snapshot.js; README "Experiments: tools"): ?snap=<file> loads a snapshot at the start (its
//               starting number and capacity, its settings); ?clone=1 copies the first live cell's genes to every cell
//               (?clone=@N: slot N's); ?genes=adhesion:0.8,motility:0.5 sets genes for every cell
//
// Part C keys are Shift + a letter (every plain letter is taken by Parts A and B): checked before the plain keys,
// so Shift+H never also toggles H.
//   ?show=summary|off|<substance>   step C3: what the substances' halftone shows (Shift+S), e.g. ?show=G
//   ?chem=0     step C4: start with the chemistry off (Shift+M)
//   ?eat=0      step C5: start with the cells not eating (Shift+A)
//   ?engines=0  step C6: start with the engines in the genome off (Shift+O); ?burners=1 with everyone burning (C5's
//               built-in burner, Shift+U)
//   ?springs=0  step C5: the old empty start (no springs; the spot at the centre). The default scene puts a light and a
//               heavy spring beside the culture with the spot between, see defaultScene
//
// Mouse: left tap drops (keys 1 2 3: a ripple, a light spring, a heavy spring; step C12's oil tool, no key: an oil spring), left drag stirs; step C2's spotlight: right-drag moves it, the wheel tilts it,
// Shift+wheel turns the direction the light comes from.

import { initGPU, GPUUnavailable, showNoWebGPU, showError, adapterName, messageIsShown, tanhMode, gpuGuard } from './gpu.js';
import { Background } from './background.js';
import { Medium } from './field.js';
import { Landscape } from './landscape.js';
import { Cells, DEFAULT_CELLS, ANCHORS } from './cells.js';
import { Light } from './light.js';
import { Matter, SHOWS, ELECTRONS } from './matter.js';
import { CARBON, CB_LIP, CB_ENZANY } from './carbon.js';   // step C15a: carbon in the open dish
import { makeActions, keyMaps, keysText, TOOLS, SQUEEZE_SOFT, SQUEEZE_HARD, VIEWS } from './actions.js';
import { setupUI } from './ui.js';
import { Recorder } from './record.js';
import { Neon, LIGHT_FORMAT } from './neon.js';
import { Charge } from './charge.js';
import { Water } from './water.js';
import { Oases } from './oases.js';
import { setupLab } from './lab.js';
import { fetchSnapshot } from './snapshot.js';
import { camera } from './camera.js';
import { dish, parseDish, snapDish } from './dish.js';   // the dish: its own size, kept while the window changes
import { scaleDish } from './squeeze.js';
import { Perfusion, parseRecipe } from './perfusion.js';   // the microfluidic chip: inlet, through-flow, outlet
import { Obstacles } from './obstacles.js';   // step G0b: walls, blocks, pillars; the round dish
import { createApp } from './app.js';
import { createToy } from './toy.js';   // the toy front: a few big buttons, worlds, terrain generators; the developer mode (src/toy.js)
import { applyPreset, layoutFromParams, applyDiversity, PRESETS, SPREAD_SQUEEZE } from './culture.js';
import { Tissues, useDesignFounder, DESIGNS } from './tissues.js';
import { Organ, organCells, organGenomes, organGroove, ORGAN_KINDS } from './organ.js';   // step L1
import { Warfare } from './warfare.js';
import { Flow } from './flow.js';   // step N2: substances that flow (gusts, heat carried, scour, patchy springs, the chemotaxis gene)
import { CB_PHOTO, makeRng } from './genome.js';   // step C15d: founders that photosynthesise fix carbon (?cbphoto=0)

window.__moireBooted = true;
{ const m = document.getElementById('msg'); if (m && m.dataset.net) { m.hidden = true; delete m.dataset.net; } }   // (a slow start: the safety net's message goes)

const TICK = 1 / 60;
const MAX_TICKS = 4;        // 1x to 8x: at most this many ticks per frame per 1x of speed (as before step C3b)
const TICK_CAP = 256;       // never more ticks than this in one frame (cells.js SLOTS = 320 leaves room for the warm-up)
// step C3b: the tick budgets of the fast speeds. MAX: as many ticks per frame as the GPU does while the picture keeps
// at least about 50 frames per s (frames of at most 20 ms; a GPU that keeps up does about 13 to 16 ms of work in each);
// 16x and 32x: up to frames of 34 ms (about 30 per s), so they come as close to their speed as the GPU allows.
// `ticks` adapts to the time between frames (smoothed): up by 5 % a frame while the frames are quick, down by 15 % when
// they are slow (or the GPU's queue runs far behind), then a pause before it grows again, and slowly near the level
// where it last got slow (`ceil`), so a GPU at its limit does not see-saw between smooth and stuttering.
const budgets = {
  max: { ticks: 8, frameMs: 20, hold: 0, calm: 0, ceil: 0 },
  fast: { ticks: 16, frameMs: 34, hold: 0, calm: 0, ceil: 0 },
};
let lastBud = null;   // the budget that limited the last frame (adapted at the next frame, when its time is known)

const params = new URLSearchParams(location.search);
const flag = (name) => params.has(name) && params.get(name) !== '0';
// app (src/culture.js): ?preset=name fills in its URL options (the URL's own win) before anything reads them
const PRESET = applyPreset(params);

const SPEEDS = [1, 2, 4, 8, 16, 32, 0];   // 0 = MAX
let speed = params.get('speed') === 'max' ? 0 : Math.max(1, Math.min(32, Number(params.get('speed')) || 1));
let paused = flag('paused');
const speedName = (s) => (s ? `${s}×` : 'MAX');
const SEED = params.has('seed') ? (Number(params.get('seed')) >>> 0) : ((Math.random() * 4294967296) >>> 0);

const canvas = document.getElementById('gpu');
const overlayEl = document.getElementById('overlay');
const hintEl = document.getElementById('hint');
const entropyEl = document.getElementById('entropy');
const recEl = document.getElementById('rec');

const debugLog = [];
if (flag('debug')) {
  for (const level of ['warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { debugLog.push(`${level}: ${args.join(' ')}`); if (debugLog.length > 8) debugLog.shift(); orig(...args); };
  }
  window.addEventListener('error', (e) => debugLog.push(`error: ${e.message}`));
}
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  showError('Something went wrong', (r && (r.stack || r.message)) || String(r));
});

let gpu = null;
let layers = [];
let background = null;
let medium = null;
let landscape = null;
let cells = null;
let light = null;
let matter = null;
let charge = null;     // step C6b: the screened charge field (src/charge.js)
let water = null;      // step N1: the water: caustic light and currents (src/water.js)
let oases = null;      // step N1: the scarce nutrient's springs (src/oases.js)
let flow = null;       // step N2: substances that flow (src/flow.js)
let obstacles = null;  // step G0b: obstacles (src/obstacles.js)
let perfusion = null;  // the microfluidic chip: inlet, through-flow, outlet (src/perfusion.js)
let recorder = null;   // step C3b: the video recorder (Shift+V, the record button)
let neon = null;       // step C6n: the drawing as a whole, and the neon look (src/neon.js)
let running = false;
let view = null;

// boot progress on <body data-stage>; tools/shot.py waits for "running-10-frames"
const stage = (s) => { document.body.dataset.stage = s; };

async function boot() {
  stage('init-gpu');
  try {
    gpu = await initGPU(canvas, {
      forceFail: flag('nogpu'),
      onLost: (info) => {
        running = false;
        showError('The graphics device was lost',
          `${info.reason || 'unknown reason'}: ${info.message || ''}\n` +
          'This can happen after a driver update, sleep, or when the GPU was busy for too long. Reloading usually fixes it.');
      },
    });
  } catch (e) {
    if (e instanceof GPUUnavailable) showNoWebGPU(e.message);
    else showError('Could not start WebGPU', e.stack || e.message || String(e));
    return;
  }

  gpu.device.addEventListener('uncapturederror', (ev) => {
    running = false;
    showError('GPU error', `${ev.error.constructor.name}: ${ev.error.message}`);
  });

  // experiments: ?snap=<file>, fetched first, as its starting number and capacity size the buffers
  let snap = null, snapError = null;
  if (params.has('snap')) {
    stage('fetch-snapshot');
    try { snap = await fetchSnapshot(params.get('snap')); } catch (e) { snapError = e; }
    // step C12d: a snapshot runs on the table it was saved with (saved before step C12d: the old one). The table is fixed for the
    // page, so a snapshot of the other table reloads the page with ?electrons= set to its own
    if (snap && !!snap.electrons !== ELECTRONS) {
      const u = new URL(location.href);
      u.searchParams.set('electrons', snap.electrons ? '1' : '0');
      location.replace(u.href);
      return;
    }
    // step C15a: and with or without carbon as it was saved (saved before step C15a: without)
    if (snap && !!snap.carbon !== CARBON) {
      const u = new URL(location.href);
      u.searchParams.set('carbon', snap.carbon ? '1' : '0');
      location.replace(u.href);
      return;
    }
    // step C15c: and with carbon making the cell or not (saved before step C15c: not)
    if (snap && snap.carbon && !!snap.cbLip !== CB_LIP) {
      const u = new URL(location.href);
      u.searchParams.set('cblip', snap.cbLip ? '1' : '0');
      location.replace(u.href);
      return;
    }
    // step C15e: and with the enzymes' scaffold as it was saved (saved before step C15e: cellulose-like)
    if (snap && snap.carbon && snap.cbLip && !!snap.cbEnzAny !== CB_ENZANY) {
      const u = new URL(location.href);
      u.searchParams.set('cbenzany', snap.cbEnzAny ? '1' : '0');
      location.replace(u.href);
      return;
    }
  }
  // the DISH (src/dish.js): its own size, chosen now and kept while the window changes (?dishfollow=1: the window is the dish, as before)
  // (step G0b: ?dish=round, ?dish=WxH,round: a round dish, the rest is the size)
  const dishQ = String(params.get('dish') || ''), roundDish = /(^|,)\s*round\s*$/i.test(dishQ) || (params.has('round') && flag('round'));
  const dishR = parseDish(dishQ.replace(/,?\s*round\s*$/i, ''));
  if (params.has('perarea') && !flag('perarea')) dish.perArea = false;   // ?perarea=0: supplies per px / per dish as before (a comparison)
  let nCells = snap ? snap.start : Number(params.get('cells')) || defaultCells();
  // step L1: ?tissue=organ, the tissue lab's organ (src/organ.js): as many cells as it lays out
  const ORGAN = !snap && params.get('tissue') === 'organ' ? { kind: ORGAN_KINDS.includes(params.get('organ')) ? params.get('organ') : 'muscle', opts: {
    fibres: Number(params.get('fibres')) || undefined, length: Number(params.get('olen')) || undefined, ringCells: Number(params.get('ringcells')) || undefined,
    aspect: Number(params.get('oasp')) || undefined, glue: Number(params.get('oglue')) || undefined, con: params.has('ocon') ? Number(params.get('ocon')) : undefined,
    pacemaker: params.has('pacemaker') && flag('pacemaker'), stagger: !(params.has('stagger') && !flag('stagger')), noskin: params.has('skin') && !flag('skin'), angle: Number(params.get('organangle')) || 0 } } : null;
  if (ORGAN && !params.has('cells')) nCells = organCells(ORGAN.kind, ORGAN.opts).length;
  {
    const [winW, winH] = windowSize();
    if (flag('dishfollow')) {   // (also with a snapshot: it loads into the window, as before)
      dish.follow = true; dish.perArea = false;
      dish.fromWindow(winW, winH, nCells, 'follow');
    } else if (snap) {   // a snapshot's own dish (one from before: its window, its R, the medium as it was, the supplies per px as they were)
      Object.assign(dish, snapDish(snap), { from: 'snapshot' });
    } else if (dishR) {
      dish.fromCells(dishR[0], dishR[1], winW, winH, nCells, params.has('dish') && PRESET && !new URLSearchParams(location.search).has('dish') ? 'preset' : 'url');
      if (!params.has('cells')) { nCells = Math.min(nCells, dish.maxStart()); dish.start = nCells; dish.mR = dish.kappa * dish.R; }
    } else dish.fromWindow(winW, winH, nCells);
    // ?press=depth,period[,bottom]: the pressing wall (src/dish.js; the Fronts preset)
    if (params.has('press')) {
      const v = String(params.get('press')).split(',');
      const dp = Number(v[0]), pe = Number(v[1]);
      dish.press.on = dp > 0;
      if (dp > 0) dish.press.depth = Math.min(0.9, dp);
      if (pe > 0) dish.press.period = pe;
      if (v[2] === 'bottom') dish.press.side = 'bottom';
    }
    // ?medium=x: the medium lattice's R in cell radii (default 1.389: the moire beats' size in cell units; the old window rule gave 1 to 3)
    const mq = Number(params.get('medium'));
    if (!snap && !dish.follow && params.has('medium') && mq > 0.2 && mq < 20) dish.mR = mq * dish.R;
  }
  // step C9: the capacity; with ?divide=0 (a fixed count) no room beyond the starting number unless ?cap= asks for it; per area (the dish's)
  const nCap = snap ? snap.count : Number(params.get('cap')) || (params.has('divide') && !flag('divide') ? nCells : dish.capacity(nCells));

  stage('create-layers');
  try {
    // step C6n: every layer but the background draws into the light buffers (LIGHT_FORMAT), which src/neon.js
    // composites onto the canvas
    background = await Background.create(gpu.device, gpu.format);
    medium = new Medium(gpu.device);
    landscape = await Landscape.create(gpu.device, LIGHT_FORMAT, medium);
    light = await Light.create(gpu.device, LIGHT_FORMAT);
    matter = await Matter.create(gpu.device, LIGHT_FORMAT, medium);
    charge = await Charge.create(gpu.device, LIGHT_FORMAT);
    water = await Water.create(gpu.device, LIGHT_FORMAT);   // step N1
    obstacles = await Obstacles.create(gpu.device, LIGHT_FORMAT);   // step G0b
    cells = await Cells.create(gpu.device, LIGHT_FORMAT, medium, nCells, SEED, nCap);
    const small = Math.min(window.innerWidth || 800, window.innerHeight || 800) < 600;
    neon = await Neon.create(gpu.device, gpu.format, params.has('cheap') ? flag('cheap') : TOUCH || small);
    neonOptions(neon);
    cells.heat.setLight(light);   // step C2: the heat passes absorb the light
    light.heat = cells.heat;
    matter.attach(cells.heat);   // step C3: the substances live in the heat buffer, on its grid
    matter.light = light;        // step C4: the reactions read the light
    cells.matter = matter;
    matter.eat = cells.eat;      // step C5: the atoms inside the cells are in the matter's ledger
    matter.catalysts = cells.eat.catalysts;   // step C7b: crystal seeding goes into the chemistry's uniform
    // step C6b: the charge field's blocks live in the heat buffer, it is solved in the matter's ticks, the cells eat by it
    Object.assign(charge, { heat: cells.heat, matter, eat: cells.eat, cells });
    cells.heat.charge = charge; matter.charge = charge; cells.charge = charge; cells.eat.charge = charge;
    chargeOptions(charge);
    matter.landscape = landscape;
    lightOptions(light);
    cells.landscape = landscape;
    landscape.cells = cells;
    if (params.has('founders')) {   // (step T1a: ?founders=wild|blank|std the founder mode; a number: how many founders)
      const fm = params.get('founders');
      if (['wild', 'blank', 'std'].includes(fm)) cells.genome.params.founderMode = fm;
      else cells.genome.params.founders = Number(fm) || 0;
    }
    if (params.has('wild')) cells.genome.params.wildGroups = String(params.get('wild')).split(',').filter(Boolean);   // (step T1a: the wild groups)
    if (params.has('habit')) cells.genome.params.habit = params.get('habit');   // (step T1b: every founder one habit: burn, both, pigments, other)
    if (params.has('cbphoto')) CB_PHOTO.on = flag('cbphoto');   // (step C15d: founders that photosynthesise fix carbon)
    if (params.has('cbfounder') && Number.isFinite(+params.get('cbfounder'))) cells.genome.params.cbFounder = Math.max(0, Math.min(1, +params.get('cbfounder')));   // (step C15b)
    if (params.get('bsign') === 'plus' || params.get('bsign') === 'mixed') cells.genome.params.bSign = params.get('bsign');   // the founders' B sign
    if (params.has('view')) {   // ?view=1 lineage, ?view=2 or ?view=strategy (step C6), ?view=3 or ?view=charge (step C6b)
      const v = params.get('view') === 'fate' ? 'job' : params.get('view');   // (step F0: ?view=job; the old ?view=fate means it too)
      const k = VIEWS.indexOf(v);   // (step C10: ?view=walls; C13: guides; T1a: marker; T1b: reporter)
      cells.look.view = k >= 0 ? k : Math.max(0, Math.min(7, Math.round(Number(v)) || 0));
    }
    if (flag('check')) cells.enableCheck();
    if (params.get('bio') === '0') {
      // the loop alone: no adhesion, body traits, turnover or mutation
      Object.assign(cells.genome.rules, { adh: false, body: false, turn: false, mut: false });
      cells.fields.sign = 1;   // like repels like: islands and a labyrinth of strands (key U flips)
      cells.excl.on = true;    // step 7 exclusion: pinwheel rosettes (key 8; the user chose it as this view's default)
    }
    if (params.has('mut')) cells.genome.rules.mut = flag('mut');    // experiments: ?mut=0 mutation off (key M)
    {   // step M2: the mutation sweep (src/mutation.js): ?mut=x every copying error x x (0 = exact copies, also key M off), ?mutmode=rare|drift,
        // ?mutp= (rare: the chance per birth), ?mutbig= (rare: the step), ?mutcensus=
      const MP = cells.mutation.params;
      const v = Number(params.get('mut'));
      if (params.has('mut') && Number.isFinite(v) && v >= 0) MP.scale = v;
      if (params.has('mutmode')) MP.rare = params.get('mutmode') === 'rare';
      for (const [q, k] of [['mutp', 'p'], ['mutbig', 'big'], ['mutcensus', 'censusEvery']]) {
        const x = Number(params.get(q));
        if (params.has(q) && Number.isFinite(x) && x >= 0) MP[k] = k === 'p' ? Math.min(1, x) : x;
      }
    }
    if (params.has('life')) cells.genome.rules.turn = flag('life'); // ?life=0 the life cycle off (key T)
    if (params.has('excl')) cells.excl.on = flag('excl');
    if (params.has('squeeze')) cells.params.squeeze = flag('squeeze') ? SQUEEZE_HARD : SQUEEZE_SOFT;
    // ?warmup=n the ticks a new culture runs at once (180); step L1: a laid-out organ starts as laid out (n 0) unless asked
    if (params.has('warmup') && Number(params.get('warmup')) >= 0) cells.params.warmup = Number(params.get('warmup'));
    else if (ORGAN) cells.params.warmup = 0;
    if (params.has('flip')) cells.excl.flip = flag('flip');
    if (params.has('partner')) cells.partner.on = flag('partner');
    if (params.has('change')) cells.partner.change = flag('change');
    if (params.has('side')) cells.partner.side = flag('side');
    if (params.has('clock')) cells.partner.chMode = flag('clock') ? 1 : 0;
    if (params.has('states')) cells.excl.states = Math.max(2, Math.min(4, Number(params.get('states')) || 2));
    if (params.has('heat')) cells.heat.params.kicks = flag('heat');
    if (params.has('simmer')) background.heatOn = flag('simmer');
    if (params.has('show')) { const i = SHOWS.indexOf(params.get('show')); if (i >= 0) matter.params.show = i; }
    if (params.has('chem')) matter.chem.on = flag('chem');   // step C4: ?chem=0 starts with the chemistry off (Shift+M)
    if (params.has('eat')) cells.eat.params.on = flag('eat');   // step C5: ?eat=0 starts with the cells not eating
    if (params.has('engines')) cells.eat.params.engines = flag('engines');   // step C6
    if (params.has('burners')) cells.eat.params.burner = flag('burners');
    if (params.has('honeycomb')) cells.shape.on = flag('honeycomb');   // step C6c: ?honeycomb=0 starts with the ellipse cells
    {   // step C6c: the membrane chemistry's switches
      const MP = cells.eat.membrane.params;
      for (const [q, k] of [['membrane', 'on'], ['bites', 'bites'], ['burst', 'burst'], ['elastic', 'elastic'], ['selectivity', 'select']]) {
        if (params.has(q)) MP[k] = flag(q);
      }
    }
    {   // step C6d: the dipoles' switches
      const DP = cells.dipole.params;
      for (const [q, k] of [['dipoles', 'on'], ['dd', 'dd'], ['dphi', 'phi'], ['dfield', 'field']]) {
        if (params.has(q)) DP[k] = flag(q);
      }
    }
    {   // step C7: the pumps' switches
      const PP = cells.eat.pumps.params;
      for (const [q, k] of [['pumps', 'on'], ['pumpcontact', 'contact'], ['voltage', 'voltage'], ['v2b', 'v2b']]) {
        if (params.has(q)) PP[k] = flag(q);
      }
    }
    {   // step C7b: the catalysts' switches
      const CP = cells.eat.catalysts.params;
      for (const [q, k] of [['crystal', 'crystal'], ['cofactor', 'cofactor']]) {
        if (params.has(q)) CP[k] = flag(q);
      }
    }
    if (params.has('hardmut')) cells.eat.hardlight.params.on = flag('hardmut');   // step C8
    {   // step C9: division and death
      const DV = cells.division.params;
      if (params.has('divide')) DV.on = flag('divide');
      for (const [q, k] of [['divat', 'divAt'], ['divcost', 'cost'], ['starve', 'starveTime'], ['crowd', 'crowd'], ['age', 'age']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v)) DV[k] = v;
      }
    }
    {   // step C10: patterned walls
      const WP = cells.walls.params;
      for (const [q, k] of [['walls', 'on'], ['wallfront', 'front'], ['wallcost', 'cost'], ['mature', 'mature'], ['turn', 'turn'], ['divfront', 'divFront']]) {
        if (params.has(q)) WP[k] = flag(q);
      }
      const fg = Number(params.get('freeglue'));   // step C11: the free base glue
      if (params.has('freeglue') && Number.isFinite(fg)) WP.freeGlue = fg;
    }
    {   // step G0: strong glue, junctions that break
      const GP = cells.glue.params;
      for (const [q, k] of [['glueceil', 'ceiling'], ['gluecost', 'cost'], ['breaks', 'tear'], ['gluenull', 'null']]) {
        if (params.has(q)) GP[k] = flag(q);
      }
      for (const [q, k] of [['tearat', 'stretch'], ['heal', 'heal']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) GP[k] = v;
      }
    }
    {   // step S1: cell shape
      const SP = cells.spindle.params;
      for (const [q, k] of [['shape', 'on'], ['shapenull', 'null'], ['shapegene', 'gene'], ['shapegrn', 'grn'], ['shapetorque', 'torque'],
        ['shapeexch', 'exchange'], ['shapewrap', 'wrap']]) {
        if (params.has(q)) SP[k] = flag(q);
      }
      for (const [q, k] of [['aspmax', 'aspectMax'], ['shapeturn', 'turn']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) SP[k] = v;
      }
    }
    {   // step S2: flagella and cilia
      const MP = cells.motors.params, ML = cells.motors.look;
      for (const [q, k] of [['flagella', 'flagella'], ['flagellanull', 'flagellaNull'], ['cilia', 'cilia'], ['cilianull', 'ciliaNull'], ['mogrn', 'grn'],
        ['mowater', 'water'], ['modipole', 'dipole'], ['mopump', 'pump'], ['mocouple', 'couple'], ['mosteer', 'steer'], ['motorque', 'torque']]) {
        if (params.has(q)) MP[k] = flag(q);
      }
      // (?dipole= is the dipole's strength, a number; ?modipole=0 switches it off)
      for (const [q, k] of [['swim', 'swim'], ['steer', 'steerRate'], ['arm', 'arm'], ['dipole', 'dipole'], ['swimdrift', 'swimDrift'],
        ['ciliapush', 'ciliaPush'], ['beathz', 'beatHz'], ['couple', 'coupleRate'], ['lag', 'lag'], ['swimcost', 'swimCost'], ['ciliaup', 'ciliaUp'],
        ['flagwant', 'flagWant'], ['ciliawant', 'ciliaWant'], ['mocensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && (v >= 0 || k === 'lag')) MP[k] = v;
      }
      if (params.has('modraw')) ML.on = flag('modraw');
    }
    {   // step P3: cells that sense cells
      const PP = cells.senses.params;
      if (params.get('p3') === '0') Object.assign(PP, { nose: false, taste: false, clump: false, armour: false });   // every part off
      for (const [q, k] of [['nose', 'nose'], ['taste', 'taste'], ['tastenull', 'tasteNull'], ['clump', 'clump'], ['sharedarmour', 'armour']]) {
        if (params.has(q)) PP[k] = flag(q);
      }
      for (const [q, k] of [['nosetau', 'tau'], ['nosehalf', 'noseHalf'], ['fuelfloor', 'fuelFloor'], ['tastespeed', 'tasteSpeed'], ['tastehalf', 'tasteHalf'],
        ['rangegain', 'rangeGain'], ['rangecost', 'rangeCost'], ['tug', 'tug'], ['kinshare', 'kinShare'], ['p3census', 'censusEvery'], ['p3near', 'near']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) PP[k] = v;
      }
    }
    {   // step G3: the moire genome
      const FP = cells.folding.params;
      if (params.get('g3') === '0') FP.on = false;
      for (const [q, k] of [['fold', 'fold'], ['foldlife', 'foldLife'], ['foldnull', 'foldNull'], ['dose', 'dose'], ['dosenull', 'doseNull'],
        ['repair', 'repair'], ['buffer', 'buffer'], ['buffernull', 'bufferNull'], ['g3out', 'out'], ['g3founders', 'founderOut']]) {
        if (params.has(q)) FP[k] = flag(q);
      }
      for (const [q, k] of [['g3sigma', 'sigma'], ['g3wmax', 'wMax'], ['g3wmin', 'wMin'], ['latstep', 'latStep'], ['phstep', 'phStep'], ['latjump', 'jump'],
        ['foldstep', 'foldStep'], ['refold', 'refold'], ['s0', 's0'], ['kon', 'kOn'], ['koff', 'kOff'], ['doseheat', 'doseHeat'], ['doseox', 'doseOx'],
        ['dosestep', 'doseStep'], ['repk', 'repK'], ['repcost', 'repCost'], ['bufcap', 'bufCap'], ['bufcost', 'bufCost'], ['buffounder', 'bufFounder'],
        ['bufweaken', 'bufWeaken'], ['g3census', 'censusEvery'], ['foundergain', 'founderGain'], ['foundershare', 'founderShare']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) FP[k] = v;
      }
    }
    {   // step Q1: a signal substance
      const QP = cells.signals.params;
      if (params.get('signal') === '0') QP.on = false;
      for (const [q, k] of [['sigflow', 'flow'], ['junction', 'junction'], ['sigtaste', 'taste'], ['fastreg', 'fast'], ['signalnull', 'null'], ['sigmut', 'mutate']]) {
        if (params.has(q)) QP[k] = flag(q);
      }
      for (const [q, k] of [['sigspread', 'spread'], ['siglife', 'life'], ['sigpower', 'power'], ['hearw', 'hearW'], ['hearj', 'hearJ'], ['taufast', 'tauFast'],
        ['sigcensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) QP[k] = v;
      }
    }
    {   // step L1: contraction
      const CP = cells.contract.params;
      for (const [q, k] of [['contract', 'on'], ['contractnull', 'null'], ['contractgrn', 'grn']]) {
        if (params.has(q)) CP[k] = flag(q);
      }
      for (const [q, k] of [['concost', 'cost'], ['concensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) CP[k] = v;
      }
    }
    {   // step C13: fields as genes and guides
      const GP = cells.guides.params;
      for (const [q, k] of [['fgenes', 'genes'], ['gateglue', 'glue'], ['gatepump', 'pump'], ['gateengine', 'engine'], ['gatediv', 'div'],
        ['gateturn', 'turn'], ['pushgene', 'push'], ['gatenull', 'null']]) {
        if (params.has(q)) GP[k] = flag(q);
      }
      if (params.get('gates') === '0') Object.assign(GP, { glue: false, pump: false, engine: false, div: false, turn: false });   // every gate off
      for (const [q, k] of [['gateref', 'ref'], ['gateturnrate', 'turnRate']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v > 0) GP[k] = v;
      }
    }
    {   // step C12: oils and water
      const OP = matter.oil.params;
      for (const [q, k] of [['oil', 'on'], ['phase', 'phase'], ['amphi', 'amphi'], ['fusion', 'fusion'], ['polarity', 'polarity']]) {
        if (params.has(q)) OP[k] = flag(q);
      }
      if (['oil', 'emulsion', 'soap'].includes(params.get('oilspring'))) OP.spring = params.get('oilspring');
    }
    {   // step C12b: lipid membranes
      const LP = cells.eat.lipids.params;
      for (const [q, k] of [['lipids', 'on'], ['lipheat', 'heat'], ['crack', 'crack'], ['lipheads', 'heads'], ['graze', 'graze']]) {
        if (params.has(q)) LP[k] = flag(q);
      }
    }
    {   // step C12c: excited waste (?exshare= is read by src/matter.js when it loads: the energy an excited atom holds)
      const XP = matter.excited.params;
      if (params.has('excited')) XP.on = flag('excited');
      for (const [q, k] of [['exlife', 'life'], ['exhot', 'hot']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v > 0) XP[k] = v;
      }
      if (params.has('exlook')) matter.excited.look.on = flag('exlook');
      if (ELECTRONS) { XP.on = false; matter.excited.look.on = false; }   // (step C12d: folded into the electrons' excited states)
    }
    {   // step C12d: electrons (?electrons= itself is read by src/matter.js when it loads)
      const EP = matter.electrons.params;
      if (params.has('fluor')) EP.fluor = flag('fluor');
      if (params.has('photo')) EP.photo = flag('photo');
      if (params.has('glow')) matter.electrons.look.on = flag('glow');
      for (const [q, k] of [['kabs', 'kAbs'], ['yrx', 'yRx'], ['yfl', 'yFl']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) EP[k] = v;
      }
      if (params.has('photolysis')) EP.photolysis = flag('photolysis');   // step C12e
    }
    if (CARBON) {   // step C15a: carbon in the open dish (?carbon= itself is read by src/carbon.js when it loads)
      const CP = matter.carbon.params;
      for (const [q, k] of [['cbox', 'oxidize'], ['cbcond', 'condense'], ['cblight', 'light'], ['cbdis', 'dissolve'], ['cbspring', 'springs'], ['cbhydheat', 'hydHeat']]) {
        if (params.has(q)) CP[k] = flag(q);
      }
      for (const [q, k] of [['cbkox', 'kOx'], ['cbkcond', 'kCond'], ['cbkdis', 'kDis'], ['cbkset', 'kSet'], ['cbsurf', 'surf']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) CP[k] = v;
      }
      if (params.has('cblook')) matter.carbon.look.on = flag('cblook');
      // step C15b: cells eat carbon (src/carboncells.js)
      const CC = cells.eat.carbon.params;
      for (const [q, k] of [['cbcells', 'on'], ['cbexch', 'exchange'], ['cbeng', 'engines'], ['cbgraze', 'graze'], ['cbdis2', 'dissolve'], ['cbsmell', 'smell'], ['cbgrow', 'growth'],
        ['cbtrans', 'transport'], ['cbred', 'reduce'], ['cbbite', 'oxBite'], ['cbenz', 'enzymes'], ['cbtool', 'toolBody'], ['cbshut', 'shuttle'], ['cbgran', 'granFat'], ['cbhunger', 'hunger'], ['cbwallrec', 'wallRecycle'], ['cbgranred', 'granRed'], ['cbgranhyd', 'granHyd'], ['cbgsplit', 'gSplit'], ['cbbodyany', 'bodyAny'], ['cbhydfloor', 'hydFloor'], ['cbwallcut', 'wallCut'], ['cboilheld', 'oilHeld'], ['cbspoilkeep', 'spoilKeep'], ['cbidlered', 'idleRed'], ['cbidlewater', 'idleWater'], ['cbidlehyd', 'idleHyd'], ['cbsmellmud', 'smellMud']]) {   // (step C15c: transport .. toolBody; C15d: shuttle)
        if (params.has(q)) CC[k] = flag(q);
      }
      for (const [q, k] of [['cbkgraze', 'kGraze'], ['cbkdis2', 'kDis'], ['cbbody', 'kBody'], ['cbbuild', 'kBuild'], ['cbfound', 'found'],
        ['cbktrans', 'kTrans'], ['cbtransup', 'transUp'], ['cbenzk', 'kEnz'], ['cbenzlife', 'enzLife'], ['cbhungry', 'hungry'], ['cbredfloor', 'redFloor'], ['cbpigfound', 'pigFound'], ['cbmembfound', 'membFound']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) CC[k] = v;
      }
    }
    {   // step C12e: waste must leave
      const WP = cells.eat.waste.params;
      for (const [q, k] of [['saturation', 'saturation'], ['osmosis', 'osmosis'], ['stretch', 'stretch'], ['tear', 'tear'], ['tolcost', 'cost']]) {
        if (params.has(q)) WP[k] = flag(q);
      }
      for (const [q, k] of [['satscale', 'satScale'], ['kosm', 'kOsm'], ['kstretch', 'kStretch'], ['wtol', 'wTol']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) WP[k] = v;
      }
    }
    {   // step C12g: ion flow
      const IP = cells.eat.ions.params;
      for (const [q, k] of [['ionblock', 'block'], ['channels', 'genes'], ['ionvolt', 'volt']]) {
        if (params.has(q)) IP[k] = flag(q);
      }
      for (const [q, k] of [['ionpass', 'ionPass'], ['chanbase', 'chanBase'], ['kv', 'kV']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) IP[k] = v;
      }
    }
    {   // step M1: whole membranes
      const MP = cells.eat.whole.params;
      for (const [q, k] of [['oilsoap', 'oilSoap'], ['biteblock', 'biteBlock']]) {
        if (params.has(q)) MP[k] = flag(q);
      }
    }
    {   // step T1a: an inside, kin channels, the self marker, the smell for trace
      const KP = cells.kin.params;
      for (const [q, k] of [['inside', 'inside'], ['kinchan', 'channels'], ['kinnull', 'null'], ['kinblind', 'blind'], ['clock', 'clock'], ['clockhard', 'clockHard'], ['smelltrace', 'smellTrace']]) {
        if (params.has(q)) KP[k] = flag(q);
      }
      for (const [q, k] of [['kink', 'kinK'], ['seal', 'seal'], ['press', 'press'], ['clocksize', 'clockSize'], ['traceworth', 'traceWorth']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) KP[k] = v;
      }
    }
    {   // step T1b: the gene network, the reporter view
      const GP = cells.grn.params;
      for (const [q, k] of [['grn', 'on'], ['grnnull', 'null'], ['grnsignal', 'signal'], ['grnkin', 'kinWeight'], ['grnmut', 'mutate']]) {
        if (params.has(q)) GP[k] = flag(q);
      }
      for (const [q, k] of [['grntau', 'tau'], ['grnrewire', 'rewire'], ['grndup', 'dup'], ['grncensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) GP[k] = v;
      }
      const r = Number(params.get('reporter'));
      if (params.has('reporter') && Number.isFinite(r)) cells.grn.look.reporter = Math.max(0, Math.min(7, Math.round(r)));
      cells.grn.matter = matter;
    }
    {   // step P1: predators, engulfing, kin sparing
      const PP = cells.pred.params;
      for (const [q, k] of [['engulf', 'on'], ['engulfnull', 'null'], ['kinsparenull', 'kinNull']]) {
        if (params.has(q)) PP[k] = flag(q);
      }
      for (const [q, k] of [['sizeratio', 'sizeRatio'], ['drive', 'drive'], ['holdbase', 'holdBase'], ['wallarm', 'wallArm'], ['stiffarm', 'stiffArm'],
        ['wraptime', 'wrapTime'], ['digesttime', 'digestTime'], ['startrate', 'startRate'], ['batstart', 'batStart'], ['wrapcost', 'wrapCost'],
        ['startcost', 'startCost'], ['wrapshare', 'wrapShare'], ['batshare', 'batShare'], ['predcensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) PP[k] = v;
      }
      if (params.has('predmark')) cells.pred.look.mark = flag('predmark');
    }
    {   // step G1: error correction, the fidelity gene
      const FP = cells.fidelity.params;
      for (const [q, k] of [['fidelity', 'on'], ['fidelitynull', 'null']]) {
        if (params.has(q)) FP[k] = flag(q);
      }
      for (const [q, k] of [['fidcost', 'cost'], ['fidbeyond', 'beyond'], ['fidcensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) FP[k] = k === 'beyond' ? Math.min(1, v) : v;
      }
    }
    {   // step G2: gene duplication for engines and pumps
      const DP = cells.dup.params;
      for (const [q, k] of [['dup', 'on'], ['dupnull', 'null']]) {
        if (params.has(q)) DP[k] = flag(q);
      }
      for (const [q, k] of [['duprate', 'rate'], ['dupdel', 'del'], ['dupcensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) DP[k] = k === 'censusEvery' ? v : Math.min(1, v);
      }
    }
    {   // step C12f: vents in the dark
      const VP = matter.vents.params;
      if (params.has('hotvent')) VP.hot = flag('hotvent');
      if (params.has('sea')) VP.sea = flag('sea');
      const st = Number(params.get('starter'));   // (the starter charge, a share of the battery: any scene; the Deep vents preset fills it)
      if (params.has('starter') && Number.isFinite(st) && st >= 0) cells.eat.params.starter = Math.min(1, st);
      if (params.has('crawlwork')) cells.eat.params.crawlWork = flag('crawlwork');   // step C15g: the crawl paid by the work it does
      for (const [q, k] of [['ventheat', 'heat'], ['searate', 'seaRate'], ['sealevel', 'seaLevel']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) VP[k] = v;
      }
    }
    // step N1: the water (caustic light, currents): its blocks live in the heat buffer (set before the first resize sizes it)
    Object.assign(water, { heat: cells.heat, background, medium, light });
    cells.heat.water = water; matter.water = water; background.water = water;
    water.stir.heat = cells.heat; cells.stir = water.stir;   // step G0: the cells stir the water (src/stir.js)
    {
      const SP = water.stir.params;
      for (const [q, k] of [['stir', 'on'], ['stirsplit', 'split']]) { if (params.has(q)) SP[k] = flag(q); }
      for (const [q, k] of [['stirgain', 'gain'], ['stirwet', 'wet'], ['stirreach', 'reach'], ['stirfade', 'fade'], ['stirscreen', 'screen']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v)) SP[k] = v;
      }
    }
    {
      const WP = water.params;
      for (const [q, k] of [['caustics', 'caustics'], ['currents', 'currents']]) { if (params.has(q)) WP[k] = flag(q); }
      for (const [q, k] of [['focus', 'focus'], ['curspeed', 'speed'], ['gyre', 'gyre'], ['curdrift', 'drift'], ['wind', 'wind']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v)) WP[k] = v;
      }
    }
    // perfusion, the microfluidic chip (src/perfusion.js): an inlet line, a through-flow, an outlet
    perfusion = new Perfusion(matter);
    water.perfusion = perfusion;
    {
      const PP = perfusion.params;
      if (params.has('perfusion')) PP.on = flag('perfusion');
      for (const [q, k] of [['flow', 'speed'], ['inlet', 'rate'], ['outlet', 'outlet']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) PP[k] = v;
      }
      if (['right', 'left', 'down', 'up'].includes(params.get('flowdir'))) PP.dir = params.get('flowdir');
      const r = parseRecipe(params.get('recipe'), matter.SUBSTANCES.map((x) => x.name));
      if (r) PP.recipe = r;
    }
    // step G0b: the obstacles (src/obstacles.js): their blocks live in the heat buffer (the water's), the matter, the cells, the water and the
    // stir read them
    Object.assign(obstacles, { heat: cells.heat, water, stir: water.stir, cells, perfusion });
    water.obstacles = obstacles; matter.obstacles = obstacles; cells.obstacles = obstacles; water.stir.obstacles = obstacles;
    if (params.has('obstacles')) obstacles.params.on = flag('obstacles');
    if (params.has('obsflow')) obstacles.params.flow = flag('obsflow');
    if (!snap) {
      obstacles.round = roundDish;
      // a preset's own walls and pillars (before the culture is seeded, so no founder starts inside one)
      if (PRESET && PRESETS[PRESET].obstacles && !(params.has('presetwalls') && !flag('presetwalls'))) PRESETS[PRESET].obstacles({ obs: obstacles, W: dish.W, H: dish.H, R: dish.R });
      // step L1: the organ lab's GROOVE (porous walls: they stop cells, not water or substances) round the laid-out organ; ?groove=0 none
      if (ORGAN && !(params.has('groove') && !flag('groove'))) organGroove(obstacles, ORGAN, dish.W, dish.H, dish.R);
    }
    // step N1: the scarce nutrient and its roaming springs (src/oases.js)
    oases = new Oases(matter, SEED);
    {
      const OP = oases.params;
      if (params.has('scarce')) OP.scarce = flag('scarce');
      if (params.has('roam')) OP.roam = flag('roam');
      const v = Number(params.get('oases'));
      if (params.has('oases') && Number.isFinite(v) && v >= 0) OP.count = Math.round(v);
      // (the dish, src/dish.js: the oases per area, so a dish twice the reference's keeps twice as many; a snapshot brings its own count)
      if (!snap && OP.count > 0) OP.count = Math.max(1, Math.round(OP.count * dish.supply));
      const b = Number(params.get('bury'));
      if (params.has('bury') && Number.isFinite(b) && b >= 0) OP.bury = b;
      const r = Number(params.get('oasisrate'));
      if (params.has('oasisrate') && Number.isFinite(r) && r >= 0) OP.rate = r;
    }
    // step N2: substances that flow (src/flow.js): the currents' gusts and tides, the heat carried, the bed scoured, patchy springs, the
    // chemotaxis gene. ?n2=0: all off (as before step N2)
    flow = new Flow(matter, SEED);
    Object.assign(flow, { cells, obstacles, water });
    water.flow = flow; cells.flow = flow;
    {
      const FP = flow.params;
      for (const [q, k] of [['n2', 'on'], ['heatflow', 'heat'], ['gusts', 'gusts'], ['scour', 'scour'], ['patchy', 'patchy'], ['chemo', 'chemo'],
        ['chemonull', 'chemoNull']]) { if (params.has(q)) FP[k] = flag(q); }
      for (const [q, k] of [['flowx', 'strength'], ['gust', 'gust'], ['sweep', 'sweep'], ['tide', 'tide'], ['tideperiod', 'tidePeriod'],
        ['scourspeed', 'scourSpeed'], ['carry', 'carry'], ['springlife', 'life'], ['springgap', 'gap'], ['flowcensus', 'censusEvery']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) FP[k] = v;
      }
    }
    {   // step N1: a nutrient landscape (light needs matter)
      const PG = cells.eat.pigments;
      PG.light = light;
      for (const [q, k] of [['pigmatter', 'matter'], ['pigsat', 'sat'], ['inhib', 'inhib'], ['pigshed', 'shed']]) {
        if (params.has(q)) PG.params[k] = flag(q);
      }
      for (const [q, k] of [['pigwant', 'want'], ['pigwear', 'wear'], ['isat', 'isat'], ['bleach', 'bleach'], ['pigcost', 'cost']]) {
        const v = Number(params.get(q));
        if (params.has(q) && Number.isFinite(v) && v >= 0) PG.params[k] = v;
      }
    }
    background.heat = cells.heat;
    // app: how the culture is spread and how diverse it is (?spread= ?colonies= ?diversity=, or a preset's), before the first
    // resize seeds it
    cultureOptions(ORGAN ? { ...layoutFromParams(params, PRESET), spread: 'organ', organ: ORGAN } : layoutFromParams(params, PRESET), params.has('diversity'));
    if (ORGAN) {   // step L1: the organ's four designs are the founders (founder k = design k: muscle, nerve, skin, pacemaker)
      cells.genome.params.founders = 4;
      cells.genome.founders = organGenomes(makeRng((SEED ^ 0x6f72676e) >>> 0), ORGAN.opts);
    }
    // step T1c: ?tissue=plant|filament|biofilm, the culture's one founder is a designed tissue's genome (src/tissues.js); the reporter
    // view shows its job regulator
    if (params.has('tissue') && useDesignFounder(cells.genome, params.get('tissue'), SEED) && !params.has('reporter')) {
      cells.grn.look.reporter = DESIGNS[params.get('tissue')].reporter;
    }
  } catch (e) {
    showError(e.shaderError ? 'Shader did not compile' : 'Could not set up the GPU passes', e.message || String(e));
    return;
  }
  // the medium first: it writes the lattice every field-reading layer uses; the light before the cells (its uniform is
  // read by the heat passes the cells run), and its tint is drawn under them (its outline over them: renderTop)
  layers = [obstacles, medium, oases, flow, background, landscape, matter, charge, water, obstacles.drawLayer, cells.signals.drawLayer, light, cells];   // (step Q1: the signals view's haze)   // (step G0b: the obstacles'
  // mask first, so every pass of the frame reads it; drawn over the water, under the light's tint and the cells)   // (step C6b: the charge's contours over the substances; step N1: the water
  // after the ripples stepped and before the cells' ticks, its caustic net under the light's tint)
  // handle for tuning from the console or tools/shot.py --eval, e.g. moire.background.params.viscosity = 0.03
  window.moire = { gpu, layers, background, medium, landscape, cells, genome: cells.genome, heat: cells.heat, light, matter, eat: cells.eat, neon, charge,
    membrane: cells.eat.membrane, dipole: cells.dipole, pumps: cells.eat.pumps, catalysts: cells.eat.catalysts, hardlight: cells.eat.hardlight,
    division: cells.division, walls: cells.walls, oil: matter.oil, lipids: cells.eat.lipids, excited: matter.excited, guides: cells.guides,
    electrons: matter.electrons, waste: cells.eat.waste, vents: matter.vents, ions: cells.eat.ions, pigments: cells.eat.pigments, water, oases, whole: cells.eat.whole,
    kin: cells.kin, grn: cells.grn, predators: cells.pred, fidelity: cells.fidelity, dup: cells.dup, mutation: cells.mutation, perfusion, glue: cells.glue, stir: water.stir, obstacles,
    spindle: cells.spindle, carbon: matter.carbon, carbonCells: cells.eat.carbon, motors: cells.motors, flow, senses: cells.senses, folding: cells.folding, signals: cells.signals,
    contract: cells.contract };
  window.moire.tissues = new Tissues(window.moire);     // step T1c: designed tissues (place, census)
  window.moire.organ = cells.organ = new Organ(window.moire);   // step L1: the tissue lab's organ (lay out, poke, twitch, measure)
  if (ORGAN) Object.assign(cells.organ, { kind: ORGAN.kind, opts: ORGAN.opts, angle: ORGAN.opts.angle, n0: nCells });
  window.moire.warfare = new Warfare(window.moire);     // step T1c: the chemical warfare census (lineage borders against interiors)
  window.moire.time = () => simTime;   // simulation time (s), for tools/shot.py --at
  window.moire.stats = stats;          // frame time, ticks this frame, speed reached (step C3b)
  window.moire.budgets = budgets;      // the fast speeds' tick budgets
  // births and deaths drop small ripples into the background (a birth a bump, a death a dip)
  cells.onEvents = (events) => {
    const amp = cells.genome.params.ripple;
    if (!(amp > 0)) return;
    for (const [x, y, sign] of events) background.impulse(x, y, sign > 0 ? amp : -0.7 * amp);
  };

  resize();
  if (!snap) {   // (a snapshot brings its own springs; app: a preset its own)
    if (PRESET) presetScene(); else defaultScene();
    obstacles.freeSprings(matter.springs);   // (step G0b: a scene's spring that falls inside an obstacle or outside a round dish moves out)
    for (const s of matter.springs) if (s.kind !== 'oasis') s.scene = true;   // (the dish: a scene's springs drip per area, src/dish.js)
    perfusion.start(view.cssW, view.cssH, cells.R);   // (an inlet drips per R of its length: not scaled again)
  }
  {   // app: ?zoom=z or ?zoom=z,x,y (the view's centre as shares of the dish), or a preset's zoom
    const zq = params.has('zoom') ? params.get('zoom').split(',').map(Number) : PRESET && PRESETS[PRESET].zoom ? [PRESETS[PRESET].zoom] : null;
    if (zq && zq[0] > 1) camera.set(zq[0], (Number.isFinite(zq[1]) ? zq[1] : 0.5) * view.cssW, (Number.isFinite(zq[2]) ? zq[2] : 0.5) * view.cssH);
  }
  window.addEventListener('resize', resize);
  setupInput();
  if (flag('overlay')) overlayEl.hidden = false;
  showEntropy(flag('entropy'));   // (the toy front: closed unless ?entropy=1; Shift+E, the Developer panel)
  if (params.get('overlay') === 'ghost') overlayEl.style.opacity = '0';   // kept up to date but invisible (for tools/shot.py)
  window.moire.adapter = () => adapterName(gpu.info);
  window.moire.control = control;
  window.moire.dish = dish;       // the dish's own size (src/dish.js)
  dish.scale = (f) => scaleDish(window.moire, control, f);   // squeeze (f < 1) or stretch the sample, contents kept (src/squeeze.js)
  setupLab(window.moire, control, { params, snap, snapError });   // experiments: sample, snapshots, tissue, genome edits
  running = true;
  stage('running');
  requestAnimationFrame(frame);
}

/**
 * Experiments (src/lab.js, tools/experiment.py): the frame loop's controls. runUntil(t): run (at the set speed) until
 * simulation time t, then pause exactly there (as ?until=T; null: no limit). setTime is for loading a snapshot.
 */
const control = {
  time: () => simTime,
  setTime(t) { simTime = Number(t) || 0; },
  paused: () => paused,
  setPaused(b) { paused = !!b; if (ui) ui.refresh(); },
  speed: () => speedName(speed),
  setSpeed(s) {
    const v = String(s).toLowerCase() === 'max' ? 0 : Math.max(1, Math.min(32, Number(s) || 1));
    speed = SPEEDS.includes(v) ? v : SPEEDS.reduce((a, b) => (b && Math.abs(b - v) < Math.abs(a - v) ? b : a), 1);
    if (ui) ui.refresh();
    return speedName(speed);
  },
  reached: () => stats.reached,
  runUntil(t) {
    until = t == null || !Number.isFinite(Number(t)) ? -1 : Math.max(0, Number(t));
    delete document.body.dataset.until;
    paused = until >= 0 && until - simTime < TICK / 2;
    if (paused) document.body.dataset.until = 'reached';
    if (ui) ui.refresh();
  },
  view: () => view,
  resize: () => resize(),
  get seed() { return SEED; },
  action(id) { const a = actions.find((x) => x.id === id); if (a) runAction(a, ''); return !!a; },
  actionState(id) { const a = actions.find((x) => x.id === id); return a && a.get ? a.get() : undefined; },
  flash: (t) => flash(t),
};

/**
 * Step C3b: the number of cells when the URL does not say. 2000 on a computer; on a touch screen or a small window,
 * fewer, by the shorter side (the blob's size): 2000 x (side / 800 px)^2, between 800 and 1500. So a phone (about
 * 390 px) gets 800 cells of about the computer's size (R about 5 px instead of 3 with 2000) and runs lighter.
 */
function defaultCells() {
  const side = Math.min(window.innerWidth || 800, window.innerHeight || 800);
  if (!TOUCH && side >= 600) return DEFAULT_CELLS;
  return Math.max(800, Math.min(1500, Math.round(DEFAULT_CELLS * (side / 800) ** 2)));
}

/**
 * Step C5: the default scene, so the chemistry and the eating show without anyone doing anything: a light and a heavy
 * spring just beyond the culture's rim, on the dish's longer axis (to the right on a wide screen, below on a tall one),
 * and the spotlight centred on the rim between them, so it lights both springs and the edge of the culture. The springs
 * drip for a whole day (SCENE.life, 240 s). ?springs=0: the old empty start (and the spot where it was).
 */
const SCENE = { life: 240, rim: 0.72, gap: 0.01, apart: 0.09, seep: 0.3, seepR: 2.5 };   // (step C15b: the fuel seep, molecules per s, R)
function defaultScene() {
  if (params.has('springs') && !flag('springs')) return;
  const W = view.cssW, H = view.cssH, m = Math.min(W, H);
  const rim = SCENE.rim * cells.R * Math.sqrt(cells.start / 0.85);   // about the settled culture's radius (its seed blob shrinks)
  const wide = W >= H, ax = wide ? [1, 0] : [0, 1], perp = wide ? [0, 1] : [1, 0];
  const d = rim + SCENE.gap * m, s = SCENE.apart * m;
  const cx = W / 2 + ax[0] * d, cy = H / 2 + ax[1] * d;
  // (step T1a: the mineral spring lasts, ?lasting=0 as before: step M1 found the colony's membranes starve of linkers once it dries)
  matter.addSpring(cx - perp[0] * s, cy - perp[1] * s, 'light', !params.has('lasting') || flag('lasting') ? 1e9 : SCENE.life);
  matter.addSpring(cx + perp[0] * s, cy + perp[1] * s, 'heavy', SCENE.life);
  // step C15b: a LASTING FUEL SEEP beside the vent (methane-like carbon only, SCENE.seep molecules per s over a patch SCENE.seepR across;
  // per area, as the scene's springs: x the dish's supply), so carbon life can start once the vent has dried (?seep=0: none)
  if (CARBON && !(params.has('seep') && !flag('seep'))) {
    matter.addPatch(cx + perp[0] * s + ax[0] * 0.035 * m, cy + perp[1] * s + ax[1] * 0.035 * m, 'seep', SCENE.seepR, SCENE.seep / (Math.PI * SCENE.seepR ** 2), 1e9);
  }
  if (!params.has('spot')) light.moveTo(W / 2 + ax[0] * rim, H / 2 + ax[1] * rim);
  // step N1: the oases (the scarce nutrient's springs): the first beside the culture, in the spot's edge on the springs' side (a lasting
  // one: it stays put and never dries, only pulses), the others anywhere, roaming (src/oases.js)
  oases.start([[W / 2 + ax[0] * (rim - 0.06 * m) - perp[0] * 0.12 * m, H / 2 + ax[1] * (rim - 0.06 * m) - perp[1] * 0.12 * m, 'fixed']]);
}

/** App: a preset's springs and light (src/culture.js PRESETS), once the dish's size is known. ?springs=0 leaves them out. */
function presetScene() {
  if (params.has('springs') && !flag('springs')) return;
  PRESETS[PRESET].scene({ matter, light, cells, oases, water, W: view.cssW, H: view.cssH, hasSpot: params.has('spot') });
  if (!oases.started) oases.start();   // (step N1: a preset that places no oases of its own gets them anywhere)
}

/** App: the culture's layout and diversity (the URL's, a preset's, or the new culture dialog's); the pull to the centre nearly
 * off for any spread but the clump (unless ?squeeze= says). */
function cultureOptions(L, diversity = true) {
  cells.layout = L;
  if (!params.has('squeeze')) cells.params.squeeze = L.spread === 'clump' ? SQUEEZE_SOFT : SPREAD_SQUEEZE;
  if (diversity) applyDiversity(cells.genome, L.diversity);
}

/** App: the new culture dialog's "start here" (the same number of cells: no reload; the dish, its springs and light stay). */
function newCultureInPlace(o) {
  if (o.founders) cells.genome.params.founderMode = o.founders;   // (step T1a: before the founders are drawn)
  cultureOptions({ spread: o.spread, colonies: o.colonies, diversity: o.diversity, centres: null });
  cells.seed(false);
  background.impulse(view.cssW / 2, view.cssH / 2, 2);
  flash(`new culture: ${cells.start} cells, ${o.spread}, ${o.diversity}`);
}

/** Step C6n: the look's URL options (see the top of this file). */
function neonOptions(N) {
  if (params.has('neon')) N.on = flag('neon');
  if (params.has('halo')) {
    const h = params.get('halo'), i = ['off', 'low', 'medium', 'high'].indexOf(h);
    N.params.halo = i >= 0 ? i : Math.max(0, Math.min(3, Math.round(Number(h)) || 0));
  }
  if (params.has('trails')) N.params.trails = flag('trails');
  if (params.has('hum')) N.params.hum = flag('hum');
  // step H1: ?look=harmonic (also neon, flat), ?blur=0, ?grain=0, ?scalebar=0
  const look = params.get('look');
  if (look === 'harmonic') N.harmonic.on = true;
  else if (look === 'neon' || look === 'flat') { N.harmonic.on = false; N.on = look === 'neon'; }
  const HP = N.harmonic.params;
  if (params.has('blur')) HP.blur = flag('blur');
  if (params.has('grain')) HP.grain = flag('grain');
  if (params.has('scalebar')) HP.scalebar = flag('scalebar');
  if (params.has('legend')) cells.look.legend = flag('legend');   // step F0: the job legend
}

/** Step C6b: the charge's URL options (see the top of this file). */
function chargeOptions(Q) {
  const P = Q.params;
  // step C12g: ?chargefield=1 the old C6b behaviour (the dish-wide field, the free atoms' drift, cells feel it, B charge from the stock)
  if (params.has('chargefield')) { const v = flag('chargefield'); P.on = v; P.feel = v; P.stock = v; }
  if (params.has('charge')) P.on = flag('charge');
  if (params.has('qgenes')) P.genes = flag('qgenes');
  { const v = Number(params.get('qgene')); if (params.has('qgene') && Number.isFinite(v) && v >= 0) P.qGene = v; }
  if (params.has('qstock')) P.stock = flag('qstock');
  if (params.has('qfeel')) P.feel = flag('qfeel');
  if (params.has('contours')) P.contours = flag('contours');
}

/** Step C2: the light's URL options (see the top of this file). */
function lightOptions(L) {
  const P = L.params;
  const m = params.get('light');
  if (m === 'spot' || m === 'full' || m === 'off') P.mode = m;
  if (params.has('spot')) {
    const v = params.get('spot').split(',').map(Number);
    const px = v.some((x) => x > 2);   // CSS px instead of shares; resolved once the dish's size is known
    if (px) L.pendingSpotPx = v;
    else {
      if (Number.isFinite(v[0])) P.x = v[0];
      if (Number.isFinite(v[1])) P.y = v[1];
      if (Number.isFinite(v[2]) && v[2] > 0) P.radius = v[2];
    }
  }
  if (params.has('tilt')) P.tilt = Math.max(0, Math.min(P.maxTilt, Number(params.get('tilt')) || 0));
  if (params.has('az')) L.turnBy((Number(params.get('az')) || 0) - P.az);
  if (params.has('day')) P.day = flag('day');
  if (params.has('hour')) P.dayStart = (((Number(params.get('hour')) || 0) / 24) % 1 + 1) % 1;
  if (params.has('clouds')) P.clouds = flag('clouds');
  { const v = Number(params.get('power')); if (params.has('power') && Number.isFinite(v) && v >= 0) P.power = v; }   // (the light's power, default 33)
}

// ---------- size ----------
/** The window's size (CSS px): what the canvas may fill. */
function windowSize() {
  const e = document.documentElement;
  return [Math.max(1, e.clientWidth || window.innerWidth || 1), Math.max(1, e.clientHeight || window.innerHeight || 1)];
}

/**
 * The window changed (or the dish did): the canvas is fitted inside the window with the dish's shape, and every layer told. The DISH
 * does not change (src/dish.js): `view` keeps the dish's size (cssW, cssH: dish px, the simulation's units) and gives the drawing
 * dpr = device px per dish px. With ?dishfollow=1 the window is the dish again, as before (a new R, a new grid: the old one drained).
 */
function resize() {
  const [winW, winH] = windowSize();
  if (dish.follow) {
    canvas.style.cssText = '';
    dish.fromWindow(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), cells ? cells.start : 1, 'follow');
  }
  const f = dish.follow ? 1 : Math.min(winW / dish.W, winH / dish.H);
  const cw = dish.follow ? dish.W : dish.W * f, ch = dish.follow ? dish.H : dish.H * f;
  if (!dish.follow) {
    const st = canvas.style;
    st.width = `${cw}px`; st.height = `${ch}px`;
    st.left = `${(winW - cw) / 2}px`; st.top = `${(winH - ch) / 2}px`; st.right = 'auto'; st.bottom = 'auto';
  }
  dish.fit = f;
  const maxDim = gpu.device.limits.maxTextureDimension2D;
  const dpr0 = Math.min(2, window.devicePixelRatio || 1, maxDim / cw, maxDim / ch);
  const pxW = Math.max(1, Math.round(cw * dpr0)), pxH = Math.max(1, Math.round(ch * dpr0));
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  // (dpr: device px per DISH px; exactly the screen's when the dish is drawn at its own size, as on a page started in this window)
  view = { cssW: dish.W, cssH: dish.H, dpr: f === 1 ? dpr0 : pxW / dish.W, pxW, pxH, winW, winH };
  camera.setDish(dish.W, dish.H, f);   // app: the view camera stays inside the dish
  for (const l of layers) l.resize(view);
  if (neon) neon.resize(view);
  if (light && light.pendingSpotPx) {
    const [x, y, r] = light.pendingSpotPx;
    light.pendingSpotPx = null;
    if (Number.isFinite(x) && Number.isFinite(y)) light.moveTo(x, y);
    if (Number.isFinite(r) && r > 0) light.params.radius = r / Math.min(dish.W, dish.H);
  }
}

// ---------- loop ----------
const stats = { frameMs: 16.7, iv: 16.7, cpuMs: 0, gpuMs: 0, lastOverlay: 0, lastProbe: 0, reached: 1, ticks: 0, lat: 0 };
let last = 0, acc = 0, simTime = 0, frameNo = 0, nextAutoRipple = 0.3, autoK = 0;
let until = params.has('until') ? Math.max(0, Number(params.get('until')) || 0) : -1;   // ?until=T (control.runUntil)

function frame(now) {
  if (!running) return;
  const dtReal = last ? Math.min(0.25, (now - last) / 1000) : TICK;
  last = now;
  stats.frameMs += (dtReal * 1000 - stats.frameMs) * 0.05;
  stats.iv += (dtReal * 1000 - stats.iv) * 0.3;   // the same, quicker: for the budgets
  if (lastBud) adapt(lastBud);

  let ticks, bud = null;
  if (paused) { ticks = 0; acc = 0; }
  else if (!speed) { bud = budgets.max; ticks = bud.ticks; acc = 0; }
  else {
    acc += dtReal * speed;
    ticks = Math.floor(acc / TICK);
    const cap = speed >= 16 ? Math.min(TICK_CAP, budgets.fast.ticks) : MAX_TICKS * speed;
    if (ticks > cap) { ticks = cap; acc = 0; if (speed >= 16) bud = budgets.fast; } else acc -= ticks * TICK;
  }
  if (until >= 0 && !paused) {
    // ?until=T: never past T; pause on reaching it (the same tick in every run)
    const left = Math.max(0, Math.round((until - simTime) / TICK));
    if (ticks >= left) { ticks = left; paused = true; acc = 0; bud = null; document.body.dataset.until = 'reached'; }
  }
  simTime += ticks * TICK;
  // the speed reached: simulation time per real time, smoothed over about a second
  stats.reached += (ticks * TICK / Math.max(1e-3, dtReal) - stats.reached) * Math.min(1, dtReal / 1.0);
  stats.ticks = ticks;
  lastBud = bud;

  if (flag('ripple') && simTime >= nextAutoRipple) autoRipple();

  const t0 = performance.now();
  // realDt and reached: real time, for the drawing only (step C6n: the trails' fade, the hum)
  const f = { dt: ticks * TICK, tickDt: TICK, ticks, time: simTime, frameNo, realDt: dtReal, reached: paused ? 1 : stats.reached, camMoved: camera.moved };
  camera.moved = false;
  const device = gpu.device;
  const encoder = device.createCommandEncoder({ label: `frame ${frameNo}` });
  for (const l of layers) l.compute(encoder, f);
  neon.tickReal(dtReal);
  const drawn = { background, cells, under: layers.filter((l) => l !== background && l !== cells), top: layers };
  neon.encode(encoder, f, gpu.context.getCurrentTexture().createView(), drawn);
  device.queue.submit([encoder.finish()]);
  const slow = neon.watch(stats.frameMs, dtReal, !paused && speed >= 1 && speed <= 8 && frameNo > 120);
  if (slow) flash(slow);
  stats.cpuMs += (performance.now() - t0 - stats.cpuMs) * 0.05;
  if (recorder && recorder.on) {
    recorder.capture();   // the frame just drawn, into the recording (in this task, while the canvas holds it)
    const e = Math.floor(recorder.elapsed), t = `REC ${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`;
    if (recEl.lastChild.textContent !== t) recEl.lastChild.textContent = t;
  }

  // rough GPU latency: time from submit until the queue reports the work done (every 8th frame); the budgets also back
  // off when it runs far behind
  if (frameNo % 8 === 0) {
    const ts = performance.now();
    device.queue.onSubmittedWorkDone().then(() => { stats.lat = performance.now() - ts; stats.gpuMs += (stats.lat - stats.gpuMs) * 0.3; });
  }

  if (!entropyEl.hidden) {
    const compact = view.winW < 560 || view.winH < 500;   // a phone (either way up): shorter lines
    let t = `${cells.heat.panelText(compact)}\n${matter.panelLine(compact)}\n${cells.eat.panelLine(compact)}\n${cells.eat.strategyLine(compact)}\n${charge.panelLine(compact)}\n${cells.eat.membrane.panelLine(compact)}\n${cells.eat.lipids.panelLine(compact)}\n${cells.dipole.panelLine(compact)}\n${cells.eat.pumps.panelLine(compact)}\n${cells.eat.catalysts.panelLine(compact)}\n${cells.eat.hardlight.panelLine(compact)}\n${cells.division.panelLine(compact)}\n${cells.walls.panelLine(compact)}\n${cells.guides.panelLine(compact)}\n${matter.oil.panelLine(compact)}\n${ELECTRONS ? matter.electrons.panelLine(compact) : matter.excited.panelLine(compact)}
${cells.eat.waste.panelLine(compact)}
${cells.eat.ions.panelLine(compact)}
${cells.eat.whole.panelLine(compact)}
${cells.kin.panelLine(compact)}
${cells.grn.panelLine(compact)}
${cells.pred.panelLine(compact)}
${cells.fidelity.panelLine(compact)}
${cells.dup.panelLine(compact)}
${cells.mutation.panelLine(compact)}
${cells.glue.panelLine(compact)}
${cells.spindle.panelLine(compact)}
${cells.motors.panelLine(compact)}
${cells.senses.panelLine(compact)}
${cells.folding.panelLine(compact)}
${cells.signals.panelLine(compact)}
${cells.contract.panelLine(compact)}${cells.organ && cells.organ.kind ? `
${cells.organ.panelLine(compact)}` : ''}${ELECTRONS ? `
${matter.vents.panelLine(compact)}` : ''}${CARBON ? `
${matter.carbon.panelLine(compact)}
${cells.eat.carbon.panelLine(compact)}` : ''}
${cells.eat.pigments.panelLine(compact)}
${water.panelLine(compact)}
${oases.panelLine(compact)}
${flow.panelLine(compact)}`;
    if (paused || speed !== 1) {
      const r = reachedText();
      const sp = paused ? 'paused' : r ? (compact ? r : `${speedName(speed)} · reached ${r}`) : speedName(speed);
      t = t.replace('\n', `${compact ? '  ' : '   '}${sp}\n`);
    }
    if (t !== entropyEl.textContent) entropyEl.textContent = t;
  }
  if (frameNo === 10) stage('running-10-frames');
  if (!overlayEl.hidden && now - stats.lastOverlay > 250) { stats.lastOverlay = now; drawOverlay(); }
  if (!overlayEl.hidden && now - stats.lastProbe > 1000) {
    stats.lastProbe = now;
    cells.probe().then(() => neon.probe(drawn, f));   // one after the other, so they do not time each other
  }
  frameNo++;
  requestAnimationFrame(frame);
}

/** A fast speed's budget, after a frame it limited (see `budgets`). */
function adapt(B) {
  if (B.hold > 0) B.hold--;
  if (stats.iv > B.frameMs * 1.15 || stats.lat > B.frameMs * 4) {
    if (B.hold > 0) return;   // the last cut has not shown in the frame times yet
    B.ceil = B.ticks;
    B.ticks = Math.max(1, Math.floor(B.ticks * 0.85));
    B.hold = 8; B.calm = 30;
  } else if (stats.iv < B.frameMs * 0.9) {
    if (B.calm > 0) { B.calm--; return; }
    const near = B.ceil && B.ticks + 1 >= B.ceil;
    const step = near ? (frameNo % 60 === 0 ? 1 : 0) : Math.max(1, Math.round(B.ticks * 0.05));
    B.ticks = Math.min(TICK_CAP, B.ticks + step);
    if (B.ticks > B.ceil) B.ceil = 0;
  }
}

/** The speed reached, for the speed button and the entropy panel: "×37", "×0.9", or "" at the set speed. */
function reachedText() {
  if (paused) return 'paused';
  const r = stats.reached;
  if (speed && speed <= 8 && r > 0.8 * speed) return '';   // 1x to 8x: only when notably slower than set
  return `×${r >= 9.5 ? r.toFixed(0) : r.toFixed(1)}`;
}

function autoRipple() {
  // deterministic spots spread over the screen (golden-ratio sequence)
  autoK++;
  const x = ((autoK * 0.618034 + 0.2) % 1) * view.cssW;
  const y = ((autoK * 0.754878 + 0.35) % 1) * view.cssH;
  background.impulse(x, y, 2.0);
  nextAutoRipple = simTime + 0.7;
}

/** The portable maths (src/gpu.js): the tanh used, and the guard's counts (cell_step.wgsl G0S_BAD, G0S_FAST; cumulative since the start). */
function guardLine() {
  const g = cells.glue && cells.glue.census;
  const bad = g ? g.bad >>> 0 : 0, fast = g ? g.fast >>> 0 : 0;
  return `gpu maths: tanh ${tanhMode()} · guard ${gpuGuard() ? `on: <b>${bad}</b> cells put back after NaN/infinity` : 'off'} · ${fast} cell-ticks faster than 30 R/s`;
}

function drawOverlay() {
  const i = gpu.info;
  const lines = [
    `<b>${(stats.frameMs).toFixed(1)} ms</b> per frame  (${(1000 / stats.frameMs).toFixed(0)} fps)`,
    `cpu encode ${stats.cpuMs.toFixed(2)} ms · gpu done after ~${stats.gpuMs.toFixed(1)} ms`,
    `adapter  <b>${esc(adapterName(i))}</b>${i.isFallbackAdapter ? '  (software fallback)' : ''}`,
    `vendor ${esc(i.vendor || '?')} · arch ${esc(i.architecture || '?')}${i.device ? ' · device ' + esc(i.device) : ''}`,
    guardLine(),
    `canvas ${view.pxW}×${view.pxH} (dpr ${view.dpr.toFixed(2)}) · ${gpu.format}`,
    dish.line(),
    perfusion.overlayLine(),
    `ripple grid ${background.gw}×${background.gh} (${background.sc} css px/cell) · ambient ${background.ambient ? 'on' : 'off'}`,
    `tap ${TOOLS[tool].name} · landscape ${landscape.params.on ? 'on' : 'off'} · R ${medium.R.toFixed(2)} px · medium ${(medium.la0 * 180 / Math.PI).toFixed(2)}°`,
    ...cells.overlayLines(),
    ...matter.overlayLines(),
    ...cells.eat.overlayLines(),
    ...charge.overlayLines(),
    ...cells.eat.membrane.overlayLines(),
    ...cells.eat.lipids.overlayLines(),
    ...(ELECTRONS ? matter.electrons.overlayLines() : matter.excited.overlayLines()),
    ...cells.eat.waste.overlayLines(),
    ...cells.eat.ions.overlayLines(),
    ...cells.eat.whole.overlayLines(),
    ...cells.kin.overlayLines(),
    ...cells.grn.overlayLines(),
    ...cells.pred.overlayLines(),
    ...cells.fidelity.overlayLines(),
    ...cells.dup.overlayLines(),
    ...cells.mutation.overlayLines(),
    ...cells.eat.pigments.overlayLines(),
    ...water.overlayLines(),
    ...oases.overlayLines(),
    ...flow.overlayLines(),
    ...matter.vents.overlayLines(),
    ...matter.carbon.overlayLines(),
    ...cells.eat.carbon.overlayLines(),
    ...cells.dipole.overlayLines(),
    ...cells.eat.pumps.overlayLines(),
    ...cells.eat.catalysts.overlayLines(),
    ...cells.eat.hardlight.overlayLines(),
    ...cells.division.overlayLines(),
    ...cells.walls.overlayLines(),
    ...cells.glue.overlayLines(),
    ...cells.spindle.overlayLines(),
    ...cells.motors.overlayLines(),
    ...cells.senses.overlayLines(),
    ...cells.folding.overlayLines(),
    ...cells.signals.overlayLines(),
    ...cells.contract.overlayLines(),
    ...cells.guides.overlayLines(),
    ...matter.oil.overlayLines(),
    neon.overlayLine(),
    `simmer (Shift+R) ${background.heatOn ? 'on' : 'off'}: ripple drops ${background.params.heatDrops} per cell per step x temperature², height ${background.params.heatAmp}`,
    `sim t ${simTime.toFixed(1)} s · speed ${paused ? 'paused' : speedName(speed)}, reached ×${stats.reached.toFixed(2)} (${stats.ticks} ticks this frame` +
      `${!speed || speed >= 16 ? `, budget ${(speed ? budgets.fast : budgets.max).ticks} ticks, gpu done after ${stats.lat.toFixed(1)} ms` : ''}) · seed ${SEED}`,
  ];
  if (debugLog.length) lines.push('', ...debugLog.map(esc));
  overlayEl.innerHTML = lines.join('\n');
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- input ----------
// Every key and button runs an entry of ONE action table (src/actions.js); what a tap / click drops is the tool
// (keys 1, 2, 3; step C3: springs of atoms replace the old nutrient and threat sources).
let tool = 0;
let allKeys = false;   // key ?: the short hint or the full key list
let actions = [];
let keys = null;
let ui = null;
// touch only (no mouse or pen anywhere): no hint line, bigger buttons
const TOUCH = !!(window.matchMedia && !window.matchMedia('(any-pointer: fine)').matches);

let hintQuiet = false;   // step C6n: the short hint goes quiet 8 s after the start (a calm screen); flashes and ? still show
function hintLine() {
  if (allKeys) return fullHint();
  if (document.body.classList.contains('toy-mode')) return '';   // (the toy front: no key hints; the developer mode shows them)
  if (TOUCH || hintQuiet) return '';   // touch only: the toolbar says it all; the line shows only the flashes
  const t = TOOLS[tool];
  const what = t.spot ? 'click or drag: move the light' : t.stir ? 'click or drag: stir' : t.addCell ? 'click: place a cell · drag: a line of cells'
    : t.pipette ? 'click or drag: drop the substance' : t.obstacle ? (appUI ? appUI.obstacleHint() : 'drag: paint a wall')
      : `click: ${t.label} · drag: stir`;
  // (app: the wheel zooms while the spotlight is off; Ctrl+wheel always; middle-drag or Space+drag pans)
  return `${what} · wheel: zoom · right-drag: move the light${light && light.modeIndex === 1 ? ' · Alt+wheel: tilt it' : ''} · Space+drag: pan · ?: all keys`;
}
/** Every key, from the action table, plus the mouse. */
function fullHint() {
  const list = actions.filter((a) => a.keys.length).map((a) => `${keysText(a)}: ${a.label}`);
  return `click: ${TOOLS[tool].label} · drag: stir · ${list.join(' · ')} · wheel: zoom · right-drag: move the light · ` +
    'Alt+wheel: tilt it · Shift+wheel: turn where the light comes from · middle-drag or Space+drag: pan';
}

/** The app as the action table sees it (src/actions.js). */
function makeApp() {
  return {
    get cells() { return cells; }, get background() { return background; }, get landscape() { return landscape; },
    get light() { return light; }, get matter() { return matter; }, get heat() { return cells.heat; },
    get charge() { return charge; },
    get water() { return water; }, get oases() { return oases; },   // step N1
    get flow() { return flow; },   // step N2
    get neon() { return neon; },
    get view() { return view; },
    overlayEl, entropyEl, ANCHORS,
    get tool() { return tool; },
    setTool,
    speeds: () => SPEEDS.map(speedName),
    speedIndex: () => Math.max(0, SPEEDS.indexOf(speed)),
    speedLabel: () => speedName(speed),
    speedReached: reachedText,
    setSpeed(i) { speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))]; return speedText(); },
    stepSpeed(d) {
      const i = SPEEDS.indexOf(speed);
      speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + d))];
      return speedText();
    },
    get paused() { return paused; },
    recording: () => !!(recorder && recorder.on),
    canRecord: () => !!(recorder && recorder.supported),
    toggleRecord,
    togglePause() { paused = !paused; return paused ? 'paused (Space or the button runs it again)' : 'running'; },
    showEntropy, drawOverlay, flash, compass, tiltText, turnText,
    allKeys: () => allKeys,
    toggleAllKeys() { allKeys = !allKeys; hintEl.textContent = hintLine(); },
  };
}

function toggleRecord() {
  if (!recorder.supported) return 'recording is not available in this browser (it cannot capture a canvas as video)';
  if (recorder.on) {
    recorder.stop();
    recEl.hidden = true;
    document.body.classList.remove('recording');
    return 'recording stopped: saving the video file';
  }
  recorder.start(view.cssW, view.cssH);
  recEl.lastChild.textContent = 'REC 0:00';
  recEl.hidden = false;
  document.body.classList.add('recording');
  return `recording the dish (not the panels) as ${recorder.type.split(';')[0].replace('video/', '')}: Shift+V or the button again stops and saves it`;
}

function speedText() {
  if (!speed) return 'speed MAX: as many steps per frame as the GPU does at about 50 frames per s (the speed button shows the speed reached)';
  return speed >= 16 ? `speed ${speed}× (as close as the GPU allows; the speed button shows the speed reached)` : `speed ${speed}×`;
}

/** Keys 1 2 3 and the toolbar: what a tap / click and a drag on the dish do. */
function setTool(i) {
  const again = tool === i;
  tool = i;
  const t = TOOLS[i];
  let text;
  if (t.stir) text = 'tap and drag: stir the dish';
  else if (t.spot) {
    text = 'tap or drag: move the spotlight there';
    if (light.params.mode !== 'spot') { light.params.mode = 'spot'; text += ' (the light is now a spotlight)'; }
  } else if (t.addCell || t.pipette) text = appUI ? appUI.toolText(t) : t.label;   // app: the add tools
  else if (t.obstacle) text = appUI ? appUI.obstacleTool(again) : t.label;     // step G0b: again = the next shape
  else text = `click drops: ${t.label.replace(/^drop /, '')}`;
  return text;
}

function tiltText() {
  const t = light.params.tilt;
  return t < 0.5 ? 'the light falls straight down' : `the light falls tilted by ${t.toFixed(0)}° (from ${compass(light.params.az)}): the spot stretches away from it, brighter on its near side`;
}
function turnText() { return `the light comes from ${compass(light.params.az)} (${light.params.az.toFixed(0)}°)`; }

/** Run an action (from a key or a button); k = the key, or '-' / '+' for a knob's buttons. */
function runAction(a, k) {
  const text = a.run(k);
  if (text) flash(text);
  if (ui) ui.refresh();
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Part C: Shift + a letter (before the plain keys, which lowercase e.key; Shift + a non-letter, such as ? or +, goes on)
  if (e.shiftKey && /^[a-z]$/i.test(e.key)) {
    const a = keys.shift.get(e.key.toLowerCase());
    if (a) runAction(a, `shift+${e.key.toLowerCase()}`);
    return;
  }
  let k = e.key.toLowerCase();
  // step H1: the key left of 1 (backquote) by its place on the keyboard, unless what it types is a key of its own (on a
  // German keyboard it is a dead key, ^)
  if (e.code === 'Backquote' && !e.shiftKey && !keys.plain.has(k)) k = '`';
  // step C6n: Shift + a digit key (by its place on the keyboard, e.code, as the symbol it types differs between
  // layouts), unless that symbol is already a key of its own (e.g. Shift+7 is / on a German keyboard, Shift+1 is 1 on a
  // French one: those keep their meaning)
  if (e.shiftKey && /^Digit[0-9]$/.test(e.code) && !keys.plain.has(k)) {
    const s = keys.shift.get(e.code.slice(5));
    if (s) { runAction(s, `shift+${e.code.slice(5)}`); return; }
  }
  const a = keys.plain.get(k);
  if (!a) return;
  if (k === ' ') {
    // Space pauses; it must not also press a focused button. App: on its release (keyup above), so Space + a drag can pan
    e.preventDefault();
    if (!e.repeat && !(e.target && e.target.closest && e.target.closest('input, textarea, select'))) { spaceHeld = true; spaceUsed = false; }
    return;
  }
  runAction(a, k);
}

function tap(x, y) {
  const m = TOOLS[tool];
  if (m.stir) { background.impulse(x, y, 1.2); return; }   // the stir tool: a tap is a small stir bump
  if (!m.spring) { background.impulse(x, y, 2.5, 1.2 * background.sc); return; }
  matter.addSpring(x, y, m.oilSpring ? matter.oil.params.spring : m.spring);   // (step C12: the oil tool's choice)
  background.impulse(x, y, 3);   // a spring lands with a ripple, as the old sources did
}

function setupInput() {
  recorder = new Recorder(canvas);
  recorder.onSaved = (name, size) => flash(`saved ${name} (${(size / 1e6).toFixed(1)} MB)`);
  window.moire.recorder = recorder;
  const app = makeApp();
  actions = makeActions(app);
  keys = keyMaps(actions);
  hintEl.textContent = hintLine();
  if (params.has('machinery')) {   // step C6n: ?machinery=1, every diagnostic layer at once (the action does it)
    const m = actions.find((a) => a.id === 'machinery');
    if (m && !!m.get() !== flag('machinery')) m.run();
  }
  setTimeout(() => { hintQuiet = true; if (!flashTimer) hintEl.textContent = hintLine(); }, 8000);
  // app: the pointer in DISH coordinates (through the view camera); sx, sy: where it went down on SCREEN (CSS px), for the
  // tap / drag threshold. Pan: middle-drag, or Space held while dragging (Space alone still pauses: on its release, when no
  // drag happened). Touch: one finger is the active tool; two fingers pinch-zoom and pan the view (the second finger cancels
  // the first one's gesture; the remaining finger does nothing until every finger is up)
  const pointer = { down: false, drag: false, light: false, pan: false, x: 0, y: 0, sx: 0, sy: 0, px: 0, py: 0 };
  const screenPos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const pos = (e) => { const [sx, sy] = screenPos(e); return camera.toDish(sx, sy); };
  const touches = new Map();   // pointerId -> [sx, sy] of the fingers on the canvas
  let pinch = null;            // { d, cx, cy } while two fingers are down
  let pinchDone = false;       // after a pinch, until every finger is up: no tool
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
  };
  const cancelGesture = () => {
    pointer.down = pointer.drag = pointer.light = pointer.pan = false;
    cells.release();
    if (appUI) appUI.cancel();
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, screenPos(e));
      if (touches.size >= 2) {   // a second finger: pinch-zoom and pan; the first finger's gesture is cancelled
        cancelGesture();
        if (touches.size === 2) pinch = pinchState();
        pinchDone = true;
        try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        return;
      }
      if (pinchDone) return;
    } else if (!e.isPrimary) return;
    const [x, y] = pos(e), [sx, sy] = screenPos(e);
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      // app: pan the view (the middle button, or Space + a left drag)
      e.preventDefault();
      if (spaceHeld) spaceUsed = true;
      Object.assign(pointer, { down: false, drag: false, light: false, pan: true, px: sx, py: sy });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button === 0 && appUI && appUI.dishDown(x, y)) {   // app: the add tools (add cells, the pipette)
      Object.assign(pointer, { down: false, drag: false, light: false, pan: false });
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button === 0 && TOOLS[tool].spot) {
      // the move-light tool: a tap or a drag puts the spot's centre under the pointer (as the right button does)
      if (light.params.mode !== 'spot') { light.params.mode = 'spot'; flash('light: spotlight'); }
      Object.assign(pointer, { down: false, drag: false, light: true });
      light.moveTo(x, y);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button === 2) {
      // step C2: right button moves the spotlight (the spot's centre follows the pointer)
      if (light.modeIndex !== 1) { flash('the spotlight is off: Shift+L until it says "spotlight"'); return; }
      Object.assign(pointer, { down: false, drag: false, light: true });
      light.moveTo(x, y);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    if (e.button !== 0) return;
    Object.assign(pointer, { down: true, drag: false, light: false, x, y, sx: x, sy: y });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, screenPos(e));
      if (pinch && touches.size >= 2) {
        const q = pinchState();
        camera.panBy(q.cx - pinch.cx, q.cy - pinch.cy);
        camera.zoomAt(q.cx, q.cy, q.d / pinch.d);
        pinch = q;
        return;
      }
      if (pinchDone) return;
    } else if (!e.isPrimary) return;
    if (pointer.pan) {
      const [sx, sy] = screenPos(e);
      camera.panBy(sx - pointer.px, sy - pointer.py);
      pointer.px = sx; pointer.py = sy;
      return;
    }
    if (appUI && appUI.dishMove(...pos(e))) return;   // app: the add tools (a drag places more)
    if (pointer.light) { const [x, y] = pos(e); light.moveTo(x, y); return; }
    if (!pointer.down) return;
    const [x, y] = pos(e), [sx, sy] = screenPos(e);
    if (!pointer.drag && Math.hypot(sx - pointer.sx, sy - pointer.sy) > 6) pointer.drag = true;
    if (pointer.drag) {
      // stir: small bumps along the path, spaced about one grid cell apart
      const dist = Math.hypot(x - pointer.x, y - pointer.y);
      const n = Math.min(8, Math.max(1, Math.round(dist / background.sc)));
      for (let k = 1; k <= n; k++) {
        background.impulse(pointer.x + (x - pointer.x) * k / n, pointer.y + (y - pointer.y) * k / n, 1.2 / Math.sqrt(n));
      }
      cells.stirAt(x, y, x - pointer.x, y - pointer.y);   // cells near the pointer are pushed along
    }
    pointer.x = x; pointer.y = y;
  });
  const up = (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
      if (pinchDone) { if (!touches.size) pinchDone = false; return; }
    } else if (!e.isPrimary) return;
    if (appUI && appUI.dishUp()) return;
    if (pointer.pan) { pointer.pan = false; return; }
    if (pointer.light) { if (e.button === 2 || !e.buttons) pointer.light = false; return; }
    if (e.button !== 0) return;
    if (pointer.down && !pointer.drag) tap(pointer.x, pointer.y);
    pointer.down = pointer.drag = false;
    cells.release();
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!touches.size) pinchDone = false;
    cancelGesture();
  });
  // step C2: the wheel tilts the spotlight, Shift+wheel turns the direction it comes from. Browsers turn Shift+wheel
  // into a sideways scroll (deltaX), so either axis counts; one notch (about 100 px) = 5 degrees of tilt, 15 of turn.
  // App (user 2026-11-16: "the zoom should be by mouse wheel targeted on the mouse location"): the wheel (and Ctrl+wheel, a
  // trackpad's pinch) always zooms the view toward the pointer; with the spotlight on, Alt+wheel tilts it and Shift+wheel
  // turns where it comes from
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
    if (light.modeIndex !== 1 || !(e.altKey || e.shiftKey)) {
      const [sx, sy] = screenPos(e);
      camera.zoomAt(sx, sy, Math.exp(-Math.max(-300, Math.min(300, d)) * 0.00223));   // a notch (100 px) = x 1.25
      return;
    }
    if (e.shiftKey) {
      light.turnBy(d * 0.15);
      flash(turnText());
    } else {
      light.tiltBy(d * 0.05);
      flash(tiltText());
    }
  }, { passive: false });

  // app: Space held + a drag pans; Space pressed and let go without a drag still pauses (onKey leaves it to the release)
  window.addEventListener('keyup', (e) => {
    if (e.key !== ' ') return;
    const run = spaceHeld && !spaceUsed;
    spaceHeld = spaceUsed = false;
    if (run) { const a = keys.plain.get(' '); if (a) runAction(a, ' '); }
  });
  window.addEventListener('blur', () => { spaceHeld = spaceUsed = false; });
  window.addEventListener('keydown', onKey);
  appUI = createApp({ app, params, flag, flash, cells, matter, light, background, control, get view() { return view; }, touch: TOUCH, tools: TOOLS,
    inPlace: newCultureInPlace, preset: PRESET, dish, obstacles });
  toy = createToy({ app, actions, runAction, tools: TOOLS, cells, matter, light, obstacles, water, oases, perfusion, flow, background, params, flag,
    control, preset: PRESET, appUI, get view() { return view; }, flash, showEntropy, touch: TOUCH });
  ui = setupUI(Object.assign(app, {
    actions, runAction, touch: TOUCH,
    startFolded: params.has('ui') ? !flag('ui') : null,
    extraPanels: [toy.devPanel, ...appUI.panels], dishExtra: appUI.dishExtra, toolIcons: appUI.toolIcons,
  }));
  appUI.attach(ui);
  toy.attach(ui);
  window.moire.toy = toy;   // the toy front: moire.toy.build(name, seed), .check(), .link(), .setDev(on)
  window.moire.app = appUI;
  window.moire.camera = camera;   // app: the view camera (moire.camera.set(zoom, x, y), .fit())
}
let appUI = null;          // app: zoom buttons, scale bar, zoos, add tools, new culture (src/app.js)
let toy = null;            // the toy front (src/toy.js)
let spaceHeld = false;     // app: Space is down (a left drag then pans)
let spaceUsed = false;     // ... and a drag used it (its release does not pause)

/** A compass word for the direction the light comes from (screen: 0 = right, 90 = below). */
function compass(az) {
  const names = ['the right', 'the lower right', 'below', 'the lower left', 'the left', 'the upper left', 'above', 'the upper right'];
  return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

function showEntropy(on) {
  entropyEl.hidden = !on;
  document.body.classList.toggle('entropy-on', on);
}

let flashTimer = 0;
function flash(text) {
  hintEl.textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flashTimer = 0; hintEl.textContent = hintLine(); }, 1600);
}

boot().catch((e) => { if (!messageIsShown()) showError('Could not start', e.stack || e.message || String(e)); });
