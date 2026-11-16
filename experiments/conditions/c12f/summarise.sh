# Step C12f: the summaries (tables, plots, one stacked phase picture per run). Run from the repository with bash.
COLS="alive,cells.bat,vents.rate.gradE,cells.rate2.upkeep,cells.rate.paid,vents.G,vents.g,vents.T,vents.GT,inside.T,inside.gT,waste.lostShare,catalysts.factor,heat.out,matter.order"
PLOT="alive,vents.rate.gradE,cells.rate2.upkeep,cells.rate.paid,vents.G,vents.g,vents.T,vents.GT,inside.gT,catalysts.factor,heat.rate.out,matter.order"
STACK="alive=cells,vents.rate.gradE=gradient eaten into batteries per s,cells.rate2.upkeep=upkeep per s,cells.rate.paid=crawling paid per s,vents.G=free G in the dish,vents.g=free g in the dish,vents.T=free T in the dish (the sea),vents.GT=fuel GT (the hot core's ash),inside.gT=gT inside cells (the product),catalysts.factor=engines' cofactor factor,heat.rate.out=entropy rate,matter.order=ORDER"
python tools/summarise.py experiments/runs/c12f-dark_s3 experiments/runs/c12f-dark_s7 experiments/runs/c12f-dark-nomemb experiments/runs/c12f-dim \
  experiments/runs/c12f-late experiments/runs/c12f-late-qfeel0 \
  --cols "$COLS" --times 60,120,300,600,1200,1800,2400 --every 60 --plot "$PLOT" --stack "$STACK" --out experiments/summaries/c12f-vents
python tools/summarise.py experiments/runs/c12f-default experiments/runs/c12f-default-oldvent experiments/runs/c12f-oldvent experiments/runs/c12f-diag-dark experiments/runs/c12f-diag-dim \
  --cols "alive,cells.bat,cells.rate2.eGain,vents.rate.gradE,electrons.rate.eBreath,heat.out,matter.order" --times 60,150,300,600,1200 --every 30 \
  --plot "alive,cells.rate2.eGain,heat.rate.out" --out experiments/summaries/c12f-controls
