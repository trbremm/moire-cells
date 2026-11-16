# Step C12g: the summaries (tables, plots, one stacked phase picture per run). Run from the repository with bash.
COLS="alive,dish.t,electrons.rate.eBreath,ions.blockShare,ions.rate.cIn,ions.rate.aIn,ions.passC,ions.passA,ions.gene,ions.bal,ions.tight,waste.up,waste.down,membrane.integ,heat.out,matter.order"
PLOT="alive,dish.t,ions.blockShare,ions.gene,ions.bal,ions.cat,ions.an,waste.up,waste.down,waste.rate.tOut,heat.rate.out"
STACK="alive=cells,dish.t=free t (oxygen) in the dish,ions.blockShare=share of the ion flow the bilayer held back,ions.gene=channel level gene (mean),ions.bal=channel balance gene (mean; + cation),waste.up=swollen cells,waste.down=shrunk cells,waste.rate.tOut=free t put out per s,heat.rate.out=entropy rate"
python tools/summarise.py experiments/runs/c12g-oxy-spot_s3 experiments/runs/c12g-oxy-spot_s7 experiments/runs/c12g-oxy-full_s3 experiments/runs/c12g-oxy-full_s7 \
  experiments/runs/c12g-oxy-spot-qfield experiments/runs/c12g-oxy-spot-null experiments/runs/c12g-oxy-full-null_s3 experiments/runs/c12g-oxy-spot-np_s7 experiments/runs/c12g-oxy-full-np_s7 \
  --cols "$COLS" --times 300,600,1200,1800,2400 --every 60 --plot "$PLOT" --stack "$STACK" --out experiments/summaries/c12g-oxygen
python tools/summarise.py experiments/runs/c12g-dark_s3 experiments/runs/c12g-dark_s7 experiments/runs/c12g-dark-qfield_s3 experiments/runs/c12g-dark-qfield_s7 experiments/runs/c12g-dark-null-qfield experiments/runs/c12g-dark-soap \
  experiments/runs/c12g-default experiments/runs/c12g-default-qfield \
  --cols "alive,vents.rate.gradE,charge.pos,charge.neg,membrane.integ,ions.blockShare,heat.out,matter.order" --times 30,60,120,180,300,600,1200 --every 30 \
  --plot "alive,vents.rate.gradE,charge.pos,charge.neg,ions.blockShare" --out experiments/summaries/c12g-dark-default
