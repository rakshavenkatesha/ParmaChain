# Clone-Resistant, Unit-Level Drug Traceability on a Governed Permissioned Blockchain (v3)

*Research notes for PharmaChain v3: problem, contributions, protocol, threat model and evaluation.
Every number below is produced by a script in `blockchain/` and can be regenerated (§9).*

---

## 1. Problem

Falsified medicines are a serious public-health problem; the WHO estimated in 2017 that about 1 in 10 medical
products in low- and middle-income countries is substandard or falsified. Regulation therefore asks for
**unit-level serialisation with decommissioning at dispense**: the EU Falsified Medicines Directive 2011/62/EU
with Delegated Regulation 2016/161, and the US DSCSA. Both also require **aggregation**: the relationship
between case, carton and pack.

Most blockchain traceability work records **batches or shipments**. A copied QR code then verifies like the
original. Per-pack schemes (serial tables, NFTs) fix that, but have three gaps:

1. **Whoever scans first wins.** A copy of a genuine label that reaches a pharmacy first is accepted, and the
   genuine pack is the one flagged.
2. **Cost.** Per-pack on-chain registration is O(N).
3. **Single points of trust.** One temperature oracle, deciding on one reading, and one regulator key.

## 2. Contributions

| # | Mechanism | What it adds |
|---|---|---|
| C1 | **Two-part labels**: a visible QR carrying `(lot, index, publicTag)`, plus a hidden scratch-off code `h` (80 bits). Only the commitment `H(lot, index, h)` enters the pack leaf | Anyone can check a pack with the visible part. Dispensing needs `h`, which a copier who photographs the visible label never sees, so **the genuine pack always wins**. This removes v2's main weakness (§6, E3: 0 of 10 genuine packs wrongly flagged, versus 7 of 10). |
| C2 | **Case → carton → pack Merkle hierarchy** with index-bound aggregate leaves | O(1) registration (one 32-byte root). A distributor accepts a shipment by scanning its case labels: the contract proves they cover **exactly** the shipment's unit range, so 3 scans cover 1,152 packs. This matches EU FMD / DSCSA aggregation. |
| C3 | **Carton multiproof dispensing**: an OpenZeppelin multiproof against the carton root, plus one bitmap-word write | Many packs in one transaction, with 87.5% less gas per pack at 32 packs (E2). |
| C4 | **Evidence, not reverts**: forged, copied, cloned and diverted presentations are recorded as events | The attack attempt itself becomes immutable, attributable evidence. |
| C5 | **Lineage ranges**: splitting a shipment carves a disjoint unit range | Quantity is conserved by construction (fuzzed, §7). A genuine pack outside its shipment's range is flagged as **diversion**. |
| C6 | **Returns**: a regulator-approved un-dispense of an unopened pack | The one-time bitmap becomes reversible under governance, and the history stays on the ledger. |
| C7 | **Byzantine-tolerant cold chain**: three device-signed sensors; a reading counts only when 2 of 3 signatures agree; excursions are judged by on-chain **Mean Kinetic Temperature** | One faulty or malicious sensor can neither trigger nor suppress a quarantine. A short harmless spike doesn't quarantine; sustained heat does (E6). |
| C8 | **Governed network**: a 2-of-3 multisig for regulator recalls, quarantine releases and the **QBFT validator set**, which Besu reads from a contract placed in the genesis block | Removes the single regulator key, and validator membership becomes an on-chain multisig decision. |
| C9 | **Public checkpoints**: every 20 blocks the consortium block hash is anchored on a public chain (Polygon Amoy, or a local stand-in) | Anyone can audit the private chain without joining it. A rewritten history fails the audit, and conflicting submissions are stored as equivocation evidence. |
| C10 | **Zero-knowledge private dispensing**: a Groth16 proof that the pack is in the lot's Poseidon tree **and** inside the pharmacy's shipment range, plus a spent nullifier | Packs can't be linked to patients or competitors, and double dispensing is still impossible. |
| C11 | **Consumer-scan geo analytics**: impossible travel above 900 km/h, and out-of-region sale more than 100 km from the dispensing pharmacy within 72 h | Catches clones sold in two places, and diversion between shipments of the same pharmacy chain that the on-chain range check cannot see. |
| C12 | **Wallet-derived label secrets and an untrusted proof server** | Both label parts are re-derived from the manufacturer's deterministic wallet signature. The backend holds only hashes, and verdicts come from the contracts. |

**Novelty, stated precisely.** A Merkle root plus a "claimed" bitmap is a known Ethereum pattern (airdrop
distributors), and Merkle aggregation and ZK nullifiers are known primitives. The claim is to **apply and extend**
them, not to invent them. The contribution is the combination for regulated pharmaceutical decommissioning:
- two-part labels that resolve the first-presentation race;
- index-bound hierarchical aggregation with exact-coverage receipt;
- range-based lineage for diversion;
- 2-of-3 signed MKT cold-chain decisions;
- multisig-governed QBFT validators with public checkpointing;
- ZK dispensing bound to a shipment range.

Each mechanism is evaluated against baselines on a real BFT consortium network.

## 3. Protocol

```
MANUFACTURER (browser)
  seed = keccak(wallet.sign("seed v1 | lot"))
  publicTag_i = H(seed, i, "public")        hidden_i = first 10 bytes of H(seed, i, "hidden")
  commit_i    = H(lot, i, hidden_i)          leaf_i = H(H(lot, i, publicTag_i, commit_i))
  carton tree (power-of-two, zero-padded) -> cartonLeaf_c = H(H(lot, 1, c, cartonRoot_c))
  case tree                               -> caseLeaf_k   = H(H(lot, 2, k, caseRoot_k))
  lot root = Merkle(caseLeaves)          registerBatch(root, packsPerCarton, cartonsPerCase [, zkRoot])
  publish leaves + commitments (never tags or codes) to the untrusted proof server
  print: visible QR (lot, i, publicTag_i)  +  scratch-off panel  hidden_i (XXXX-XXXX-XXXX-XXXX)

DISTRIBUTOR   acceptWithAggregation(shipment, [case/carton labels + proofs])
              -> each aggregate proven in the lot, scans contiguous, union == shipment range exactly
PHARMACY      decommissionUnit(shipment, {i, publicTag, hidden}, {packProof, cartonProof, caseProof})
              1. pack -> carton -> case -> lot root?     no -> CounterfeitDetected  (forged / visible-only copy)
              2. bitmap[i] set?                          yes -> CloneDetected       (leaked code reused)
              3. i in [unitStart, unitEnd)?              no -> DiversionDetected
              4. set bit, dispensed++                    -> UnitDispensed
              decommissionCarton(...) = several packs of one carton, OZ multiproof, one bitmap write
              requestReturn(i) -> regulator approveReturn(i) clears the bit
PRIVATE LOT   PrivateDispenser.dispense(shipment, Groth16 proof, nullifier)
              proves leaf in Poseidon tree AND unitStart <= i < unitEnd; nullifier spent once
CONSUMER      verifyUnit(lot, i, publicTag, commit_i, proof)   (free eth_call)
              after purchase: H(lot, i, scratched code) == commit_i  -> "you hold the original"
              optional city-level scan -> impossible-travel / out-of-region flags
```

## 4. Network, genesis block and governance

- **Validators:** 4 Hyperledger Besu 26.11 validators run QBFT: regulator, manufacturers', distributors' and
  pharmacy associations. With n = 4, f = 1, so a block needs a quorum of 3 commit seals. Blocks every 2 s,
  with immediate finality.
- **Hand-built genesis block** (`scripts/network/generate-genesis.js`):
  - chainId 2026, with Berlin, London, Shanghai and **Cancun** active from block 0;
  - zero base fee and pre-funded role accounts;
  - a node allow-list;
  - `validatorcontractaddress = 0x…9999`, where the **ValidatorSet contract is placed in `alloc` with its
    storage pre-written**: the owner, plus the four validators at `keccak256(slot 2) + i`;
  - the extraData validator list is therefore empty.
- **Governance:** the deploy script hands ValidatorSet control to the Governance multisig, which burns the
  bootstrap key. From then on, adding or removing a validator, recalling a lot as regulator, or releasing a
  quarantine needs 2 of 3 officer signatures.

## 5. Threat model

| Attack | Defence | Residual risk |
|---|---|---|
| Fake lot | only regulator-admitted manufacturers register | regulator collusion (mitigated by the multisig) |
| Forged label | proof against the lot root fails; 2^256 preimage space | none |
| **Photocopied visible label** (the v2 weakness) | the hidden code is needed; the copy is flagged and the genuine pack still dispenses | the scratch panel must be tamper-evident; a pack opened before sale leaks `h` |
| Leaked scratch code reused | bitmap: the second presentation is a clone | the first use of a leaked code wins (requires physical access) |
| Brute-forcing `h` from the public commitment | 80-bit code: about 1.2·10^24 tries | longer codes for high-value drugs |
| Diversion to another shipment | range check (on-chain) | same pharmacy, same city: partly covered by geo analytics |
| Inflating units by splitting | ranges are carved, never minted (Foundry invariant) | none |
| Faulty or malicious sensor | 2-of-3 device signatures must agree; outliers recorded | 2 colluding sensors; device-key extraction |
| Single regulator key | 2-of-3 Governance for recall, quarantine release and validators | collusion of 2 officers |
| Consortium history rewrite | public checkpoints and the audit; equivocation evidence | only blocks before the last checkpoint are protected |
| Linking packs to patients or competitors | ZK private lots: no index on-chain, nullifier only | demo trusted setup (single party) |
| Backend compromise | no secrets stored; verdicts are on-chain; cache rebuildable | denial of service |
| 1 validator down or Byzantine | QBFT f = 1 | 2 or more halt the chain (safety over liveness) |

## 6. Evaluation

Setup: the in-process Hardhat EVM (Cancun) for gas and logic experiments (E1–E3, E6, E7), and a 4-node Besu
QBFT network in Docker on one Windows 11 laptop (E4, E5, E8). The baselines are:
- naive per-serial storage;
- **ERC-721, one token per pack** (`contracts/benchmark/NftPackRegistry.sol`);
- a **batch/box-level design modelled on** batch-level traceability papers such as Musamih et al. (2021)
  (`BatchLevelBaseline.sol`). This is our model of that approach, not their code.

### E1: Lot registration gas

| Units N | Ours (1 tx) | Naive per-serial (txs) | ERC-721 per pack (txs) | Batch-level | ERC-721 / ours |
|---:|---:|---:|---:|---:|---:|
| 100 | 379,984 | 2,304,550 (1) | 2,522,092 (1) | 90,274 | 7× |
| 1,000 | 380,008 | 22,867,768 (2) | 25,060,348 (4) | 90,286 | 66× |
| 10,000 | 380,020 | 228,679,264 (20) | 250,603,804 (40) | 90,286 | **659×** |
| 100,000 | 380,044 | 2.29 B (200, extrapolated) | 2.51 B (400, extrapolated) | 90,298 | 6,594× |

Batch-level registration is cheaper but carries no per-pack information, so it cannot detect clones (E3).

### E2: Dispense gas per pack (lot of 4,096 packs, 32 packs per carton)

| Packs per tx (k) | Single dispense | Carton multiproof | Saving |
|---:|---:|---:|---:|
| 1 | 88,785 | 96,969 | −9.2% |
| 4 | 75,985 | 28,370 | 62.7% |
| 16 | 72,795 | 11,732 | 83.9% |
| 32 | 72,248 | **9,033** | **87.5%** |

For comparison, an ERC-721 burn costs 33,489 gas and a naive mapping 47,137, but neither checks roles,
hierarchy or diversion. Dispensing a whole carton is cheaper per pack than either.

### E2c: Receiving a shipment of 1,152 packs

| Method | Physical scans | Gas |
|---|---:|---:|
| `acceptShipment` (no physical check) | 0 | 91,480 |
| verify every pack (estimate) | 1,152 | about 56.8 M |
| **`acceptWithAggregation`** (3 case labels) | **3** | **109,854** |
| carton labels for a 96-pack split shipment | 3 | 118,330 |

### E3: Clone attack (10 genuine packs, each label copied 3×, 40 presentations in seeded random order)

| Scheme | Fakes flagged | Genuine wrongly flagged | Genuine dispensed |
|---|---:|---:|---:|
| **v3 two-part label** | **30/30** | **0/10** | **10/10** |
| v2 one-part label | 23/30 | 7/10 | 3/10 |
| ERC-721 per pack | 23/30 | 7/10 | 3/10 |
| Batch-level | 0/30 | 0/10 | 10/10 |
| v1 scan-count heuristic | 0/30 | 0/10 | 10/10 |

### E4: Throughput and latency on QBFT

200 transactions per workload:

| Workload | Gas per tx | Blocks used | Finality latency |
|---|---:|---:|---:|
| Sensor readings | about 33k | 2 | about 2–3 s |
| Lot registrations | about 355k | 3 | about 5 s |

The gas-bound ceiling at 30 M gas per 2 s block is about 455 TPS for 33k-gas transactions and about 42 TPS
for lot registrations.

### E5: Byzantine fault tolerance (QBFT with contract-based validators, v3 network)

| Phase | Validators online | Blocks in 12 s |
|---|---:|---:|
| baseline | 4/4 | 6 |
| 1 validator stopped | 3/4 | 4 (the chain continues) |
| 2 validators stopped | 2/4 | **0** (halts safely) |
| restart → first new block | 4/4 | after 38.5 s, 40.6 s and 77.8 s in three runs |

There was no fork in any run, and the hash chain was verified intact across each outage. Recovery time varies
because each validator's round timer doubles during the stall.

### E6: Cold-chain decisions (storage range 2–8 °C)

| Scenario | Ours (2-of-3 signed sensors + MKT) | Single sensor, single reading |
|---|---|---|
| short 15 °C spike | not quarantined ✓ | quarantined ✗ |
| sustained 10.5 °C | quarantined, window 23 | quarantined, window 13 |
| freezing (−1.5 °C) | quarantined (hard limit) | quarantined |
| faulty sensor stuck at 30 °C | out-voted, not quarantined ✓ | quarantined ✗ |
| malicious sensor reports 5 °C (true temperature 11 °C) | quarantined ✓ | missed ✗ |
| **False quarantines / missed breaches** | **0 / 0** | 2 / 1 |

A submission costs 123,809 gas (3 × `ecrecover` plus the on-chain MKT update).

Caveats:
- The ground truth for "spike" and "sustained" is defined by the MKT criterion, so those two rows partly
  agree with our policy by construction. The **sensor-fault rows are the decisive ones**.
- MKT reacts later to a sustained excursion than a single-reading rule does. A hard limit still catches
  freezing and extreme heat immediately.

### E7: Zero-knowledge private dispensing

| Metric | Value |
|---|---:|
| Circuit | Groth16, depth-12 Poseidon tree (4,096 packs), 7,605 constraints |
| Proving time | about 1.3 s average (Node); runs in the browser |
| Gas, private vs public dispense | 326,446 vs 69,243 (the privacy overhead is about 257k per pack) |

### E8: Public checkpoints

| Metric | Value |
|---|---:|
| Gas per checkpoint | first 184,552, then about 150,768 |
| Checkpoints in the live run | 20 anchored |
| Audit result | `AUDIT PASSED` |
| Audit against a different chain (a "rewritten history") | FAILS with exit code 1 |

## 7. Verification beyond unit tests

**42 Hardhat tests:** core, ZK and checkpoint.

**Foundry fuzz and invariant tests**, run in Docker: 11 properties, all hold.
- Units are conserved, and shipment ranges stay disjoint and keep the same origin, over 8,192 random
  split/ship calls.
- A forged scratch code never dispenses; a forged visible tag or commitment never verifies.
- No pack is ever dispensed twice, and a label shown under another index is rejected.
- Governance executes only at or above its threshold, never twice, and outsiders cannot approve.

**Slither:** 81 findings and 0 confirmed vulnerabilities.
- 2 low-severity hardening fixes were applied: zero-address checks.
- The rest are triaged as false positives (the generated verifier's assembly, a mapping reported as
  uninitialised) or accepted (timestamp use under QBFT; reentrancy-event ordering in `Governance.execute`).

**Echidna:** not run.

## 8. What a reviewer will challenge, answered

1. **"The Merkle root plus bitmap is a known pattern."** Agreed (§2). We claim the application and the
   extensions C1–C3 and C5–C10, evaluated against the baselines, not the primitive.
2. **"Whoever scans first wins."** It did in v2: 7 of the 30 flags fell on genuine packs. v3's two-part labels
   remove this (E3). What remains is a *leaked* scratch code, which needs physical access to an opened pack.
3. **"One oracle and one regulator key are single points of trust."** Replaced by 2-of-3 signed sensors with
   MKT (C7) and a 2-of-3 Governance multisig, which also controls the validator set (C8).
4. **Closest related work.** Compare against PharmChain (2025, a Merkle DAG) and PharmaChain 3.0
   (serialisation) directly. *Fill in their columns from the papers; we have not verified their contents.*

| Capability | This work | PharmChain (2025) | PharmaChain 3.0 |
|---|---|---|---|
| Unit-level serialisation | ✓, one hierarchical root | *check* | *check* |
| Clone resistance when the copy arrives first | ✓, two-part label | *check* | *check* |
| Case/carton aggregation with exact-coverage receipt | ✓ | *check* (Merkle DAG) | *check* |
| Batch dispense via multiproof | ✓ | *check* | *check* |
| Diversion detection | ✓, ranges plus geo | *check* | *check* |
| Signed multi-sensor MKT cold chain | ✓ | *check* | *check* |
| Multisig governance of the validator set | ✓ | *check* | *check* |
| Public checkpoints | ✓ | *check* | *check* |
| ZK dispensing | ✓ | *check* | *check* |
| Measured against ERC-721 / batch baselines | ✓ | *check* | *check* |

5. **Name clash.** "PharmaChain" is also used by several published systems. Consider a distinct title for
   the report, for example *"ScratchTrace: two-part-label unit traceability on a governed QBFT consortium"*,
   while keeping the repository name.

## 9. Limitations

- **Scratch panel:** a pack opened before sale leaks `h`. The physical label must be tamper-evident.
- **ZK trusted setup:** generated by a single party for the demo. Production needs a multi-party ceremony.
- **Sensors:** device keys are only as strong as the hardware; two colluding sensors defeat 2-of-3.
- **Checkpoints:** they protect history only up to the latest anchor. Amoy needs faucet funds, so the demo
  uses a local stand-in.
- **Geo analytics:** they depend on consumers sharing a city, and are off-chain heuristics (stored as
  off-chain anomalies).
- **Experimental setup:** all experiments ran on one laptop. A geographically distributed deployment adds
  network latency.

## 10. Reproducing

```bash
cd blockchain
npm test                         # 42 tests (core, ZK, checkpoints)
npm run benchmark                # E1, E2, E2c, E3, E6  -> benchmark-results/results.md
npm run bench:zk                 # E7                    -> benchmark-results/zk.md
npm run fuzz                     # Foundry fuzz + invariants (Docker)
npm run slither                  # static analysis       -> security/slither-report.md
npm run network:genesis -- --force && npm run network:up && npm run deploy:besu && npm run deploy:zk
npm run public:node              # (separate terminal) public-chain stand-in on :8600
npm run checkpoint:deploy && npm run checkpoint:publish   # E8
npm run checkpoint:audit
npm run bench:load && npm run bench:fault                 # E4, E5
```

## References

*Verify every reference against the original before submission.*

1. WHO, *A study on the public health and socioeconomic impact of substandard and falsified medical products*, 2017.
2. Directive 2011/62/EU; Commission Delegated Regulation (EU) 2016/161.
3. U.S. Drug Supply Chain Security Act (DSCSA), 2013.
4. A. Musamih et al., "A Blockchain-Based Approach for Drug Traceability in Healthcare Supply Chain," *IEEE Access*, vol. 9, 2021.
5. R. C. Merkle, *CRYPTO '87*.
6. M. Castro and B. Liskov, "Practical Byzantine Fault Tolerance," *OSDI* 1999.
7. R. Saltini and D. Hyland-Wood, "IBFT 2.0 …," 2019; Hyperledger Besu QBFT documentation (contract validator selection).
8. J. D. Haynes, "Worldwide virtual temperatures for product stability testing," *J. Pharm. Sci.*, 1971 (Mean Kinetic Temperature); USP ⟨1079⟩.
9. J. Groth, "On the Size of Pairing-based Non-interactive Arguments," *EUROCRYPT* 2016; iden3 circom / snarkjs; Poseidon hash (Grassi et al., USENIX Security 2021).
10. T. Pornin, RFC 6979; OpenZeppelin Contracts 5.x (`MerkleProof` multiproofs, `ECDSA`, ERC-721); PRBMath.
11. EIP-7825 (transaction gas limit cap); Foundry; Slither (Feist et al., WETSEB 2019).
12. PharmChain (2025) and PharmaChain 3.0: *add the full citations from your literature list.*
