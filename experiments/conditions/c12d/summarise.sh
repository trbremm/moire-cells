# Step C12d: the summaries (tables, plots, one stacked phase picture per oxygen run). Run from the repository with bash.
python tools/summarise.py experiments/runs/c12d-default-on_s3 experiments/runs/c12d-default-off_s3 experiments/runs/c12d-default-on_s7 \
  experiments/runs/c12d-default-off_s7 \
  --cols "alive,cells.rate2.eGain,electrons.rate.eBreath,electrons.rate.eFerment,dish.t,dish.Gt,heat.out,matter.order" \
  --times 300,600,900,1200 --plot "alive,cells.rate2.eGain,heat.rate.out,matter.order,dish.t" --out experiments/summaries/c12d-default
python tools/summarise.py experiments/runs/c12d-oxy-spot_s3 experiments/runs/c12d-oxy-spot_s7 experiments/runs/c12d-oxy-full_s3 \
  experiments/runs/c12d-oxy-full_s7 experiments/runs/c12d-substrate \
  --cols "alive,dish.t,dish.Gt,dish.G,dish.tlL,electrons.rate.photo,cells.rate2.eSwap,electrons.rate.eBreath,electrons.rate.eFerment,membrane.rate.bursts,heat.out,matter.order" \
  --times 600,1200,1800,2400 --every 60 \
  --plot "alive,dish.t,dish.Gt,dish.tlL,electrons.rate.eBreath,electrons.rate.eGlow,heat.rate.out,matter.order" \
  --stack "alive=cells,electrons.rate.photo=photochemistry in the open per s,dish.t=free t (oxygen) in the dish,dish.G=free G (the sink),dish.Gt=rust Gt,dish.tlL=minus soap tlL (t heads),engines.all.0.n+engines.all.2.n=cells with a pigment,engines.breath.lit+engines.breath.dark=cells with a t-using engine,electrons.rate.eBreath=breathing into batteries per s,electrons.rate.eFerment=fermenting into batteries per s,membrane.rate.bursts=bursts per s,electrons.rate.eGlow=fluorescence out per s,heat.rate.out=entropy rate,matter.order=ORDER" \
  --out experiments/summaries/c12d-oxygen
