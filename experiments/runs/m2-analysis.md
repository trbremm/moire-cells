## Counts, generations, lineages (ON runs)

| scene | setting | cells 2/4/10/20 min | births/s | mutated | generation mean (max) 20 min | founder lines 4 -> 20 min (effective) | marker patches 4 -> 20 | genotypes 20 (largest clone) |
|---|---|---|---|---|---|---|---|---|
| def3 | x0 | 1203 / 267 / 365 / 271 | 1.44 | 0% | 16.5 (23) | 10 (5.9) -> 2 (1.8) | 5.9 -> 1.8 | 2 (67%) |
| def3 | x03 | 1199 / 267 / 299 / 258 | 1.35 | 100% | 21.3 (31) | 10 (6.3) -> 2 (1.9) | 6.3 -> 1.9 | 237 (0%) |
| def3 | x1 | 1210 / 244 / 438 / 358 | 2.08 | 100% | 32.3 (42) | 11 (5.8) -> 3 (1.0) | 6.6 -> 2.0 | 304 (0%) |
| def3 | x3 | 1184 / 270 / 410 / 478 | 3.94 | 100% | 39.3 (46) | 10 (6.1) -> 3 (2.0) | 8.8 -> 3.6 | 440 (0%) |
| def3 | rare | 1213 / 289 / 258 / 218 | 1.24 | 10% | 18.3 (34) | 10 (6.0) -> 5 (2.2) | 6.9 -> 3.1 | 180 (1%) |
| def3 | rarehl | 1197 / 246 / 372 / 351 | 1.75 | 33% | 19.2 (27) | 10 (6.1) -> 5 (2.2) | 9.2 -> 4.8 | 310 (0%) |
| def7 | x0 | 1251 / 214 / 262 / 308 | 1.22 | 0% | 16.1 (34) | 11 (7.0) -> 4 (2.9) | 7.0 -> 2.9 | 4 (46%) |
| def7 | x1 | 1255 / 251 / 423 / 364 | 1.91 | 100% | 23.9 (30) | 12 (7.5) -> 5 (1.9) | 7.5 -> 1.9 | 322 (0%) |
| def7 | x3 | 1253 / 264 / 505 / 318 | 2.50 | 100% | 35.0 (44) | 11 (6.9) -> 4 (1.8) | 7.5 -> 3.1 | 272 (0%) |
| def7 | rare | 1249 / 235 / 247 / 325 | 1.29 | 10% | 20.0 (27) | 11 (7.1) -> 4 (2.5) | 7.1 -> 2.9 | 285 (1%) |
| isl7 | x1 | 1491 / 2624 / 4487 / 4453 | 28.63 | 100% | 25.5 (43) | 12 (6.2) -> 8 (1.5) | 5.8 -> 1.8 | 4338 (0%) |
| isl7 | x3 | 1411 / 2398 / 4830 / 5314 | 44.44 | 100% | 35.5 (49) | 12 (5.2) -> 5 (1.1) | 7.4 -> 3.9 | 5160 (0%) |
| isl7 | rare | 1471 / 2669 / 4269 / 4376 | 29.77 | 10% | 31.6 (49) | 12 (6.9) -> 7 (2.4) | 6.6 -> 4.4 | 4371 (0%) |
| col3 | x0 | 851 / 1341 / 2486 / 477 | 14.90 | 0% | 32.1 (41) | 4 (1.4) -> 1 (1.0) | 1.4 -> 1.0 | 1 (100%) |
| col3 | x1 | 778 / 1286 / 2892 / 2956 | 30.51 | 100% | 43.0 (57) | 4 (1.4) -> 2 (1.0) | 1.4 -> 2.0 | 2748 (0%) |
| col3 | x3 | 736 / 1171 / 2580 / 2927 | 31.29 | 100% | 41.2 (54) | 4 (1.4) -> 1 (1.0) | 3.0 -> 3.8 | 2802 (0%) |
| col3 | rare | 793 / 1231 / 2508 / 2970 | 25.68 | 11% | 39.2 (54) | 4 (1.5) -> 1 (1.0) | 1.6 -> 2.3 | 2959 (0%) |

## Genes vs their neutral-control twin (shift from the founders at 20 min, on / null)

- def3 x1: glue +0.067/+0.241 · elongation +0.156/+0.131* · flagellum +0.108/+0.071* · cilia +0.091/+0.044* · ciliaCouple -0.066/-0.017* · chemo -0.531/+0.178* · fidelity -0.336/-0.091* · engulf +0.097/+0.066* · kinSpare +0.093/+0.066* · kinChan +0.113/+0.088* · gateGlue -0.031/+0.008* · gatePump +0.046/-0.055 · gateEngine +0.047/+0.078 · gateDiv -0.207/+0.027* · gateTurn +0.058/-0.046* · copies +0.237/+0.263
- def3 x3: glue -0.182/+0.452 · elongation +0.293/+0.453 · flagellum +0.353/+0.259* · cilia +0.181/+0.123* · ciliaCouple -0.283/-0.057* · chemo -0.185/-0.947 · fidelity +0.408/-0.151* · engulf +0.202/+0.275 · kinSpare +0.165/+0.199 · kinChan +0.282/+0.251* · gateGlue +0.057/+0.148 · gatePump -0.298/-0.055* · gateEngine -0.005/-0.057 · gateDiv +0.035/-0.076 · gateTurn -0.081/+0.102 · copies +0.934/+0.279*
- def3 rare: glue +0.103/+0.034* · elongation +0.000/+0.003 · flagellum +0.002/+0.003 · cilia +0.007/+0.001* · ciliaCouple -0.001/+0.002 · chemo +0.007/+0.115 · fidelity +0.010/+0.041 · engulf +0.013/+0.001* · kinSpare +0.005/+0.004* · kinChan +0.025/+0.003* · gateGlue +0.314/-0.003* · gatePump -0.299/-0.035* · gateEngine +0.255/-0.010* · gateDiv -0.039/+0.014* · gateTurn +0.014/+0.021 · copies +0.000/+0.051
- def7 x1: glue -0.149/-0.280 · elongation +0.103/+0.134 · flagellum +0.080/+0.047* · cilia +0.055/+0.063 · ciliaCouple +0.033/+0.001* · chemo -0.356/+0.126* · fidelity +0.099/-0.080* · engulf +0.044/+0.042* · kinSpare +0.090/+0.038* · kinChan +0.075/+0.078 · gateGlue -0.093/-0.079* · gatePump -0.090/-0.085* · gateEngine -0.048/+0.007* · gateDiv +0.118/+0.025* · gateTurn +0.091/+0.135 · copies +0.084/+0.109
- def7 x3: glue -0.176/+0.050* · elongation +0.229/+0.326 · flagellum +0.161/+0.236 · cilia +0.195/+0.169* · ciliaCouple +0.034/-0.227 · chemo -0.712/-0.069* · fidelity +0.597/+0.134* · engulf +0.228/+0.174* · kinSpare +0.163/+0.170 · kinChan +0.302/+0.159* · gateGlue +0.441/+0.236* · gatePump -0.208/-0.068* · gateEngine +0.186/+0.173* · gateDiv +0.298/-0.070* · gateTurn -0.247/-0.044* · copies +0.684/+0.268*
- def7 rare: glue -0.074/-0.259 · elongation +0.002/+0.002* · flagellum +0.000/+0.000 · cilia +0.001/+0.000* · ciliaCouple -0.005/+0.003* · chemo +0.019/+0.765 · fidelity +0.062/-0.004* · engulf +0.001/+0.203 · kinSpare +0.001/+0.164 · kinChan +0.003/+0.025 · gateGlue +0.007/+0.092 · gatePump -0.006/+0.096 · gateEngine -0.009/-0.018 · gateDiv +0.024/-0.038 · gateTurn +0.054/+0.040*
- isl7 x1: glue +0.037/-0.075 · elongation +0.153/+0.140* · flagellum +0.071/+0.062* · cilia +0.075/+0.096 · ciliaCouple -0.015/+0.004* · chemo -0.057/-0.048* · fidelity -0.079/+0.086 · engulf +0.071/+0.068* · kinSpare +0.072/+0.076 · kinChan +0.098/+0.110 · gateGlue -0.050/-0.026* · gatePump +0.031/+0.015* · gateEngine +0.002/-0.011 · gateDiv -0.027/-0.034 · gateTurn +0.001/-0.010 · copies +0.212/+0.224
- isl7 x3: glue +0.469/+0.545 · elongation +0.508/+0.445* · flagellum +0.243/+0.225* · cilia +0.258/+0.230* · ciliaCouple -0.054/-0.185 · chemo -0.651/-0.110* · fidelity +0.351/+0.156* · engulf +0.366/+0.201* · kinSpare +0.206/+0.209 · kinChan +0.342/+0.273* · gateGlue +0.087/+0.073* · gatePump +0.079/-0.106 · gateEngine +0.235/-0.046* · gateDiv +0.168/+0.039* · gateTurn +0.164/+0.060* · copies +0.654/+0.766
- isl7 rare: glue -0.102/-0.201 · elongation +0.415/+0.051* · flagellum +0.005/+0.006 · cilia +0.008/+0.009 · ciliaCouple -0.003/+0.026 · chemo -0.151/-0.034* · fidelity -0.019/-0.082 · engulf +0.174/+0.030* · kinSpare +0.016/+0.012* · kinChan +0.033/+0.018* · gateGlue +0.015/-0.043 · gatePump +0.017/-0.024 · gateEngine -0.063/-0.012* · gateDiv -0.021/-0.045 · gateTurn -0.009/-0.018 · copies +0.006/+0.021

## Per setting: genes whose ON shift is larger than the NULL's (all scenes; * above)

| setting | on > null | median |on|/|null| |
|---|---|---|
| x1 | 29/48 | 1.16 |
| x3 | 30/48 | 1.17 |
| rare | 20/47 | 0.72 |

## Same direction in both default seeds (ON), shift beyond both nulls

- x0: none
- x1: flagellum +0.108/+0.080 (nulls up to 0.071) · chemo -0.531/-0.356 (nulls up to 0.178) · kinSpare +0.093/+0.090 (nulls up to 0.066)
- x3: cilia +0.181/+0.195 (nulls up to 0.169) · fidelity +0.408/+0.597 (nulls up to 0.151) · kinChan +0.282/+0.302 (nulls up to 0.251) · gatePump -0.298/-0.208 (nulls up to 0.068) · copies +0.934/+0.684 (nulls up to 0.279)
- rare: cilia +0.007/+0.001 (nulls up to 0.001)
