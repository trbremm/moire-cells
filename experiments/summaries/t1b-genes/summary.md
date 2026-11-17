# Step T1b: gene network, the colony runs' cell types (from the snapshots; node experiments/conditions/t1b/analyse.mjs --table)

| run | t | cells | lineages (sizes) | types per lineage | same-type neighbours (chance) | spread | inputs/reg, outputs/cell | border | biggest lineage's types (share: sides, light, spring R, at a border) | outputs that differ |
|---|---|---|---|---|---|---|---|---|---|---|
| t1b-col-on_s3 | 20 min | 3000 | 2 (2579/421) | 5/6 | 0.47 (0.24) / 0.32 (0.22) | 0.23 | 1.68, 4.5 | 6.2% | 33%: 0.84, 0.24, 20, 14% / 26%: 0.85, 0.24, 17, 12% / 22%: 0.86, 0.23, 19, 12% / 11%: 0.83, 0.24, 18, 6% / 7%: 0.82, 0.24, 25, 4% | display x2.1, motility x1.7, emit A x1.6 |
| t1b-col-on_s3 | 40 min | 3000 | 2 (2915/85) | 6/6 | 0.37 (0.22) / 0.63 (0.21) | 0.25 | 1.69, 4.3 | 4.8% | 29%: 0.80, 0.27, 20, 7% / 25%: 0.82, 0.25, 21, 11% / 20%: 0.81, 0.27, 20, 12% / 15%: 0.80, 0.27, 18, 10% / 6%: 0.82, 0.25, 24, 4% / 5%: 0.83, 0.24, 22, 14% | display x2.0, division x1.5 |
| t1b-col-on_s7 | 20 min | 3000 | 1 (3000) | 6 | 0.37 (0.20) | 0.27 | 2.19, 7.5 | 0.0% | 31%: 0.80, 0.25, 19, 0% / 21%: 0.79, 0.24, 18, 0% / 16%: 0.81, 0.23, 17, 0% / 15%: 0.80, 0.24, 21, 0% / 12%: 0.71, 0.26, 27, 0% / 5%: 0.83, 0.21, 16, 0% | wall x3.5, emit B x2.0, thickness x1.8, display x1.8 |
| t1b-col-on_s7 | 40 min | 3000 | 1 (3000) | 6 | 0.34 (0.18) | 0.30 | 2.31, 8.7 | 0.0% | 27%: 0.84, 0.25, 18, 0% / 19%: 0.81, 0.29, 19, 0% / 19%: 0.78, 0.26, 24, 0% / 13%: 0.83, 0.26, 17, 0% / 12%: 0.77, 0.23, 19, 0% / 11%: 0.79, 0.28, 23, 0% | engine 1 x3.7, pigment x3.2, division x2.9, channels x2.5 |
| t1b-col-on_s11 | 20 min | 3000 | 1 (3000) | 6 | 0.51 (0.27) | 0.29 | 2.17, 6.6 | 0.0% | 41%: 0.89, 0.22, 17, 0% / 21%: 0.86, 0.22, 19, 0% / 21%: 0.85, 0.26, 22, 0% / 8%: 0.84, 0.24, 22, 0% / 5%: 0.84, 0.28, 27, 0% | display x2.7, wall x2.2, emit B x1.9, engine 3 x1.7 |
| t1b-col-on_s11 | 40 min | 3000 | 1 (3000) | 5 | 0.51 (0.31) | 0.33 | 2.27, 7.1 | 0.0% | 48%: 0.86, 0.27, 18, 0% / 19%: 0.84, 0.25, 20, 0% / 13%: 0.82, 0.27, 24, 0% / 11%: 0.87, 0.22, 17, 0% / 8%: 0.71, 0.30, 28, 0% | display x5.7, division x3.5, emit B x2.5, engine 3 x2.3 |
| t1b-col-null_s3 | 40 min | 3000 | 2 (2902/98) | 6/6 | 0.39 (0.18) / 0.30 (0.19) | 0.26 | 1.74, 4.7 | 3.9% | 22%: 0.83, 0.26, 22, 6% / 21%: 0.86, 0.25, 19, 9% / 21%: 0.85, 0.25, 20, 7% / 13%: 0.87, 0.26, 19, 8% / 12%: 0.87, 0.25, 18, 6% / 11%: 0.88, 0.27, 20, 6% | motility x2.1, display x1.9, division x1.7, kin channels x1.7 |
| t1b-col-null_s7 | 40 min | 3000 | 1 (3000) | 6 | 0.26 (0.18) | 0.27 | 2.03, 7.7 | 0.0% | 24%: 0.75, 0.27, 21, 0% / 19%: 0.78, 0.27, 16, 0% / 16%: 0.75, 0.26, 17, 0% / 16%: 0.74, 0.26, 20, 0% / 15%: 0.72, 0.27, 21, 0% / 11%: 0.71, 0.25, 21, 0% | wall x2.4, engine 1 x2.2, display x2.1, channels x2.1 |
| t1b-col-null_s11 | 40 min | 3000 | 1 (3000) | 6 | 0.32 (0.17) | 0.31 | 2.07, 7.4 | 0.0% | 19%: 0.81, 0.24, 20, 0% / 19%: 0.81, 0.27, 19, 0% / 19%: 0.75, 0.29, 20, 0% / 17%: 0.81, 0.25, 18, 0% / 14%: 0.76, 0.26, 21, 0% / 12%: 0.77, 0.25, 20, 0% | emit B x2.6, motility x2.6, wall x2.5, engine 2 x2.4 |

# Speed (python experiments/conditions/c12f/speed.py t1b-speed / t1b-speedparts / t1b-speednull)

    t1b-speed-10k-harmonic                   runs 3  speeds x1.79 x1.78 x1.78  mean x1.78  commit 5874174  {'ok'}
    t1b-speed-10k-neon                       runs 3  speeds x1.53 x1.54 x1.59  mean x1.55  commit 5874174  {'ok'}
    t1b-speed-2k-harmonic                    runs 3  speeds x7.45 x7.45 x7.35  mean x7.42  commit 5874174  {'ok'}
    t1b-speed-2k-neon                        runs 3  speeds x6.94 x7.01 x7.02  mean x6.99  commit 5874174  {'ok'}
    t1b-speednull-10k                        runs 1  speeds x1.68  mean x1.68  commit a95084e  {'ok'}
    t1b-speedparity-10k-harmonic             runs 1  speeds x1.78  mean x1.78  commit a95084e  {'ok'}
    t1b-speedparity-10k-neon                 runs 2  speeds x1.53 x1.54  mean x1.54  commit a95084e  {'ok'}
    t1b-speedparity-2k-harmonic              runs 1  speeds x7.42  mean x7.42  commit a95084e  {'ok'}
    t1b-speedparity-2k-neon                  runs 2  speeds x6.97 x6.83  mean x6.90  commit a95084e  {'ok'}
    t1b-speedparts-10k-grn0                  runs 1  speeds x1.82  mean x1.82  commit a95084e  {'ok'}
    t1b-speedparts-10k-nocensus              runs 1  speeds x1.57  mean x1.57  commit a95084e  {'ok'}
    t1b-speedparts-10k-on                    runs 1  speeds x1.57  mean x1.57  commit a95084e  {'ok'}
    t1b-speedparts-10k-grn0                  runs 1  speeds x1.82  mean x1.82  commit a95084e  {'ok'}
    t1b-speedparts-10k-nocensus              runs 1  speeds x1.57  mean x1.57  commit a95084e  {'ok'}
    t1b-speedparts-10k-on                    runs 1  speeds x1.57  mean x1.57  commit a95084e  {'ok'}
    t1b-speednull-10k                        runs 1  speeds x1.68  mean x1.68  commit a95084e  {'ok'}
