# Step C12c: the summaries (tables, plots, one stacked phase picture per run). Run from the repository with bash.
python tools/summarise.py experiments/runs/c12c-spot-on_s3 experiments/runs/c12c-spot-off_s3 experiments/runs/c12c-spot-on_s7 \
  experiments/runs/c12c-spot-off_s7 experiments/runs/c12c-upswap-on_s3 experiments/runs/c12c-upswap-off_s3 \
  experiments/runs/c12c-full-on_s3 experiments/runs/c12c-full-off_s3 \
  --cols "alive,engines.free.g+engines.free.t,excited.inDish,cells.rate2.eSwap,excited.rate.eBreath,excited.rate.eEngine,excited.rate.eBurn,membrane.rate.bursts,heat.out,matter.order" \
  --times 600,1200,1800,2400 --every 60 \
  --plot "alive,engines.free.g+engines.free.t,excited.inDish,cells.rate2.eSwap,excited.rate.eEngine,engines.breath.lit+engines.breath.dark,membrane.rate.bursts,heat.rate.out,matter.order" \
  --stack "alive=cells,engines.free.g+engines.free.t=free light atoms (ground),excited.inDish=excited haze (dish),excited.rate.madeOpen+excited.rate.madeCell=excited made per s,excited.rate.eEngine=excitation into batteries per s,cells.rate2.eSwap=breathing that runs (swaps per s),engines.breath.lit+engines.breath.dark=breathing carriers,engines.up.lit+engines.up.dark=uphill-swap carriers,membrane.rate.bursts=bursts per s,heat.rate.out=entropy rate,matter.order=ORDER" \
  --out experiments/summaries/c12c
