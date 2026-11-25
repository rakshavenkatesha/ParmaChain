# PharmaChain v3 evaluation results

Network: `hardhat` (in-process Hardhat EVM, Cancun) - generated 2026-11-24T14:08:56.435Z

## E1 - Lot registration gas

| Units N | Ours (1 tx, hierarchical root) | Naive per-serial (txs) | ERC-721 per pack (txs) | Batch-level | NFT / ours |
|---:|---:|---:|---:|---:|---:|
| 10 | 397,072 | 250,444 (1) | 293,784 (1) | 90,274 | 1x |
| 100 | 379,984 | 2,304,550 (1) | 2,522,092 (1) | 90,274 | 7x |
| 1,000 | 380,008 | 22,867,768 (2) | 25,060,348 (4) | 90,286 | 66x |
| 10,000 | 380,020 | 228,679,264 (20) | 250,603,804 (40) | 90,286 | 659x |
| 100,000 | 380,044 | 2,286,792,640 (200) | 2,506,038,040 (400) | 90,298 | 6594x |

Rows above 10,000 units extrapolate the O(N) baselines linearly from the 10,000-unit measurement (cost per unit is constant). Batch-level registration is O(1) like ours but carries no per-unit information.

## E2 - Dispense gas per pack (lot of 4,096, 32 packs/carton)

| Packs k | Single decommissionUnit / pack | Carton multiproof / pack | Saving |
|---:|---:|---:|---:|
| 1 | 88,785 | 96,969 | -9.2% |
| 2 | 80,251 | 50,993 | 36.5% |
| 4 | 75,985 | 28,370 | 62.7% |
| 8 | 73,860 | 17,220 | 76.7% |
| 16 | 72,795 | 11,732 | 83.9% |
| 32 | 72,248 | 9,033 | 87.5% |

Baselines (steady state): ERC-721 burn 33,489 gas/pack, naive mapping 47,137 gas/pack (neither has access control, hierarchy or diversion checks).

## E2c - Receiving a shipment

| Method | Physical scans | Gas | Packs covered |
|---|---:|---:|---:|
| acceptShipment (no physical check) | 0 | 91,480 | 1,152 |
| verify every pack on receipt (estimate) | 1,152 | 56,755,584 (estimate) | 1,152 |
| acceptWithAggregation (case labels) | 3 | 109,854 | 1,152 |
| acceptWithAggregation (carton labels, split shipment) | 3 | 118,330 | 96 |

## E3 - Clone attack (10 genuine packs, each label copied 3x, 40 presentations in seeded random order)

| Scheme | Fake packs flagged | Detection rate | Genuine packs wrongly flagged | Genuine packs dispensed |
|---|---:|---:|---:|---:|
| Ours v3: two-part label (visible QR + scratch code) | 30 / 30 | 100.0% | 0 / 10 | 10 / 10 |
| Ours v2: one-part label (copy carries the full secret) | 23 / 30 | 76.7% | 7 / 10 | 3 / 10 |
| ERC-721 per pack (burn on dispense) | 23 / 30 | 76.7% | 7 / 10 | 3 / 10 |
| Batch-level (lot exists?) | 0 / 30 | 0.0% | 0 / 10 | 10 / 10 |
| v1 scan-count heuristic (> 50) | 0 / 30 | 0.0% | 0 / 10 | 10 / 10 |

With one-part labels and ERC-721 tokens every duplicate is detected, but whichever copy reaches a pharmacy first wins - the genuine pack is flagged whenever its clone went first. With two-part labels the copier never sees the scratch code, so every copy fails and every genuine pack dispenses.

## E6 - Cold-chain decisions (storage 2-8 degC, 30-min windows)

| Scenario | Ground truth | Ours: 2-of-3 signed + MKT | Single sensor, single reading | Final MKT (degC) |
|---|---|---|---|---:|
| in range (5 degC) | no breach | not quarantined | not quarantined | 5 |
| short spike (one 15 degC reading) | no breach | not quarantined | quarantined (window 21) **(wrong)** | 5.5 |
| sustained mild excursion (10.5 degC) | breach | quarantined (window 23) | quarantined (window 13) | 8.1 |
| freezing (-1.5 degC) | breach | quarantined (window 11) | quarantined (window 11) | 4.6 |
| faulty sensor stuck at 30 degC (true 5 degC) | no breach | not quarantined | quarantined (window 1) **(wrong)** | 5 |
| malicious sensor reports 5 degC (true 11 degC) | breach | quarantined (window 18) | not quarantined **(wrong)** | 8.2 |

| Policy | False quarantines | Missed breaches |
|---|---:|---:|
| Ours | 0 | 0 |
| Single-reading, single-sensor | 2 | 1 |

Gas per signed 3-sensor submission (3 x ecrecover + on-chain MKT update): 123,809.

