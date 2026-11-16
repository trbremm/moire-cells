# Step C12e: the summaries (tables, plots, one stacked phase picture per run). Run from the repository with bash.
COLS="alive,dish.t,dish.Gt,electrons.rate.photo,electrons.rate.eBreath,waste.lostShare,waste.P,waste.w,waste.outb,waste.selfb,waste.rate.tOut,waste.gch,waste.gtol,heat.out,matter.order"
PLOT="alive,dish.t,electrons.rate.eBreath,waste.lostShare,waste.w,waste.outb,waste.selfb,waste.gch,waste.gtol,heat.rate.out,matter.order"
STACK="alive=cells,dish.t=free t (oxygen) in the dish,dish.Gt=rust Gt,electrons.rate.photo=photochemistry in the open per s,electrons.rate.eBreath=breathing into batteries per s,waste.lostShare=share lost to saturation,waste.P=osmotic pressure (mean),waste.w=swelling (mean),waste.up=cells swollen > 10 %,waste.down=cells shrunk > 10 %,waste.outb=breathers on outside t,waste.selfb=breathers on their own t,waste.rate.tMade=free t made inside per s,waste.rate.tOut=free t put out per s,waste.rate.tIn=free t taken in per s,waste.gch=gene stretch channels (mean),waste.gtol=gene stretch tolerance (mean),membrane.rate.bursts=bursts per s,heat.rate.out=entropy rate,matter.order=ORDER"
# the oxygen story with C12e on, and with ?photolysis=0 (seeds 3 and 7)
python tools/summarise.py experiments/runs/c12e-oxy-spot_s3 experiments/runs/c12e-oxy-spot_s7 experiments/runs/c12e-oxy-full_s3 \
  experiments/runs/c12e-oxy-full_s7 experiments/runs/c12e-oxy-spot-np_s3 experiments/runs/c12e-oxy-spot-np_s7 \
  experiments/runs/c12e-oxy-full-np_s3 experiments/runs/c12e-oxy-full-np_s7 \
  --cols "$COLS" --times 600,1200,1800,2400 --every 60 --plot "$PLOT" --stack "$STACK" --out experiments/summaries/c12e-oxygen
# each rule alone (the whole dish, seed 3), against both on and against C12d
python tools/summarise.py experiments/runs/c12e-oxy-full_s3 experiments/runs/c12e-sat-only experiments/runs/c12e-osm-only \
  experiments/runs/c12d-oxy-full_s3 \
  --cols "$COLS" --times 600,1200,1800,2400 --every 60 --plot "$PLOT" --stack "$STACK" --out experiments/summaries/c12e-single
