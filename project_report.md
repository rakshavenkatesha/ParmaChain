# PharmaChain: Clone-Resistant, Unit-Level Pharmaceutical Traceability on a Governed Permissioned Blockchain

**Two-part labels · case → carton → pack aggregation · multiproof dispensing · signed multi-sensor cold chain · multisig governance · public checkpoints · zero-knowledge dispensing**

---

| Field | Details |
|---|---|
| **Course** | Blockchain Technology (BTech Semester 7), End-Semester Project |
| **Domain** | Blockchain, Healthcare Supply Chain, Applied Cryptography |
| **Blockchain** | Private consortium network: 4 Hyperledger Besu validators, QBFT consensus, chain ID 2026, custom genesis block with contract-based validator selection |
| **Smart contracts** | Solidity 0.8.24 (Cancun): PharmaChain, AccessRegistry, Governance, ValidatorSet, ColdChainMonitor, PrivateDispenser + Groth16 verifier, CheckpointAnchor |
| **Application** | React 18 + Vite, Node.js + Express, MongoDB, ethers.js 6, MetaMask, circom/snarkjs |
| **Tooling cost** | Free and open source throughout |

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction and Problem Statement](#2-introduction-and-problem-statement)
3. [Related Work and Contributions](#3-related-work-and-contributions)
4. [Objectives](#4-objectives)
5. [System Architecture](#5-system-architecture)
6. [Blockchain Network, Genesis Block and Consensus](#6-blockchain-network-genesis-block-and-consensus)
7. [Smart Contracts](#7-smart-contracts)
8. [Protocols](#8-protocols)
9. [Off-Chain Components](#9-off-chain-components)
10. [Modules and Features](#10-modules-and-features)
11. [Security Analysis](#11-security-analysis)
12. [Experimental Evaluation](#12-experimental-evaluation)
13. [Verification and Testing](#13-verification-and-testing)
14. [Screenshots](#14-screenshots)
15. [Setup and Deployment](#15-setup-and-deployment)
16. [Limitations and Future Work](#16-limitations-and-future-work)
17. [Conclusion](#17-conclusion)
18. [References](#18-references)
19. [Appendix: Project Structure](#appendix-project-structure)

---

## 1. Abstract

Counterfeit and diverted medicines threaten patient safety. Batch-level blockchain traceability cannot stop
the commonest attack, copying a genuine label. Even per-pack schemes, whether serial tables or NFTs, let
**whichever copy is scanned first win**.

PharmaChain gives every pack a **two-part label**:
- a visible QR code that anyone can verify;
- a hidden scratch-off code that is needed to dispense the pack.

Only a commitment to the hidden code enters the pack's leaf in a **case → carton → pack Merkle hierarchy**,
so a whole lot is registered with one 32-byte root. Distributors accept shipments by scanning a few case
labels, which the contract proves cover exactly the shipment. Pharmacies dispense single packs or a whole
carton (one multiproof). Clones, forgeries and diversions are recorded on-chain as evidence.

Around this core:
- **Cold chain:** three device-signed sensors must agree (2 of 3), and breaches are judged by on-chain
  Mean Kinetic Temperature.
- **Governance:** a 2-of-3 regulator multisig governs recalls, quarantine releases and the QBFT validator
  set, which Besu reads from a contract placed in the genesis block.
- **Public checkpoints:** consortium block hashes are anchored on a public chain.
- **Private dispensing:** private lots dispense with zero-knowledge proofs and nullifiers.

Results:
- registration costs 659× less gas than ERC-721-per-pack at 10,000 packs;
- carton dispensing saves 87.5% gas per pack;
- 3 case scans replace 1,152 pack scans;
- two-part labels flag 30/30 copies with **0** genuine packs wrongly flagged, versus 7/10 for one-part
  labels or ERC-721;
- the signed MKT cold chain made 0 false quarantines and missed 0 breaches, versus 2 and 1 for a
  single-sensor rule;
- the network tolerates one failed validator without forking.

---

## 2. Introduction and Problem Statement

The WHO has estimated that about 1 in 10 medical products in low- and middle-income countries is substandard
or falsified [1]. The EU Falsified Medicines Directive [2] and the US DSCSA [3] mandate per-pack serialisation,
decommissioning at dispense, and aggregation of packs into cartons and cases.

The project evolved in three stages:

| Version | Design | Main weakness found |
|---|---|---|
| v1 | Batch records on a dev chain, plus off-chain heuristics | a copied QR verifies as genuine; anyone could register batches; roles only in the database; Admin self-registration bug |
| v2 | Per-pack Merkle commitments, a decommission bitmap, and a 4-node QBFT network | **the first presentation wins:** if a copy is scanned first, the genuine pack is flagged; one oracle and one regulator key |
| **v3** | Two-part labels, hierarchy, multiproofs, a signed MKT cold chain, multisig governance, checkpoints, ZK | addressed in §3 and §11 |

**Problem statement.** Build a blockchain-based pharmaceutical supply chain that:
- detects cloned, forged and diverted packs deterministically, **even when the copy reaches a pharmacy first**;
- supports packaging aggregation at constant registration cost;
- removes single points of trust in cold-chain monitoring and regulation;
- can be audited publicly without opening the consortium;
- can optionally hide which pack was sold.

---

## 3. Related Work and Contributions

Most published systems record batches, for example Musamih et al. [4]. Per-pack NFTs and serial registries
detect duplicates, but at O(N) cost and with the first-presentation race. The Merkle-root-plus-bitmap pattern
is known from Ethereum airdrops, so **novelty is claimed for applying and extending it**, not for the primitive.

| # | Contribution |
|---|---|
| C1 | **Two-part labels**: a visible tag plus a hidden scratch code, committed in the leaf. The genuine pack always wins against copies. |
| C2 | **Index-bound case → carton → pack Merkle hierarchy** with exact-coverage aggregated receipt |
| C3 | **Carton multiproof dispensing** with a single bitmap-word write |
| C4 | **Non-reverting evidence** for forgery, cloning and diversion |
| C5 | **Range lineage** for quantity conservation and diversion detection |
| C6 | **Regulator-approved returns** (reversible decommissioning) |
| C7 | **2-of-3 device-signed sensors with on-chain Mean Kinetic Temperature** |
| C8 | **Multisig governance of recalls, quarantine releases and the QBFT validator set**, from a contract placed in the genesis block |
| C9 | **Public checkpointing** of the private chain, with equivocation evidence |
| C10 | **ZK private dispensing**: a Groth16 proof of membership **and shipment range**, plus a nullifier |
| C11 | **Consumer-scan geo analytics**: impossible travel and out-of-region sale |
| C12 | **Wallet-derived secrets and an untrusted proof server** |

A direct comparison with the closest papers (PharmChain 2025, PharmaChain 3.0) is in `docs/RESEARCH.md` §8.
Their columns are to be completed from the papers themselves.

---

## 4. Objectives

1. A permissioned BFT consortium with a custom genesis block and **governed** validator membership.
2. On-chain identities and supply-chain rules: routes, two-phase handover, expiry, recall, quarantine.
3. Unit-level verification that stays correct when copies arrive first, at constant registration cost.
4. Packaging aggregation for receipt, and batch dispensing.
5. Trust-minimised cold chain and regulation.
6. Public auditability and optional privacy.
7. Experimental evaluation against realistic baselines, plus formal-style verification (fuzzing, invariants,
   static analysis).

---

## 5. System Architecture

![System architecture](Images/screenshots/00_system_architecture.png)

| Layer | Technology | Responsibility |
|---|---|---|
| Consensus network | 4 × Besu, QBFT, Docker | ordering, immediate finality; validators read from the ValidatorSet contract |
| Smart contracts | Solidity 0.8.24, OpenZeppelin, PRBMath, circom/snarkjs | identities, rules, unit verification, governance, cold chain, ZK |
| Public chain | Polygon Amoy, or a local stand-in | CheckpointAnchor for public auditability |
| Backend | Node.js / Express, ethers.js (read-only, holds no keys) | event indexer, untrusted proof server, explorer, governance, cold-chain, geo and checkpoint APIs |
| Database | MongoDB | rebuildable cache, commitments (hashes only), scans, anomalies |
| Frontend | React, Vite, Tailwind, Chart.js | role dashboards, labels, dispensing, verification, explorer, governance |
| Wallet | MetaMask | every state change is signed by the user |

**Design principle:** the ledger is the single source of truth. MongoDB is written only by the chain indexer,
from contract events, and can be rebuilt by replaying them.

---

## 6. Blockchain Network, Genesis Block and Consensus

### 6.1 Consensus: QBFT

QBFT is a Byzantine-fault-tolerant **Proof-of-Authority** protocol in the PBFT family [6, 7]. Each block goes
through:
1. **Pre-prepare:** the round's proposer, chosen round-robin, broadcasts the block.
2. **Prepare:** validators check and announce it.
3. **Commit:** with 3 matching prepares, validators sign commit seals. A block is final once it has 2f+1 = 3
   of 4 seals.

It gives **immediate finality**: no forks and no reorganisations. With n = 4 it tolerates f = 1 faulty
validator; with 2 down it halts rather than risk conflicting blocks. A failed proposer triggers a round change
with an exponentially growing timeout.

### 6.2 Custom genesis block

| Field | Value |
|---|---|
| `chainId` | 2026 |
| Forks | Berlin, London, Shanghai, **Cancun** at block 0 |
| `qbft` | 2-second blocks, epoch 30000, request timeout 4 s, **`validatorcontractaddress` 0x…9999** |
| `alloc` | pre-funded role accounts, plus the **ValidatorSet contract code with pre-written storage** (bootstrap owner, 4 validator addresses at `keccak256(slot 2) + i`) |
| `extraData` | RLP(vanity "PharmaChain Genesis :: 2026", empty validator list, vote, round, seals); in contract mode the validators come from the contract |
| `zeroBaseFee`, `gasLimit` | free gas; 30 M gas per block |

### 6.3 Governance of the network

After deployment the bootstrap owner hands ValidatorSet control to the **Governance multisig** and is burned.
Adding or removing a validator then requires 2 of 3 regulator officers. Node permissioning (an enode
allow-list) still restricts which machines can connect.

---

## 7. Smart Contracts

| Contract | Responsibility |
|---|---|
| `AccessRegistry` | regulator-admitted identities, one role each, licence hashes, suspension |
| `PharmaChain` | lots, two-part labels, hierarchy, custody, splits, single and carton dispensing, returns, recall and quarantine; hook for private dispensing |
| `Governance` | M-of-N multisig with generic proposals (target, calldata) |
| `ValidatorSet` | `getValidators()` for Besu; changed only by Governance |
| `ColdChainMonitor` | sensor registry, per-shipment sensor sets, signed 2-of-3 readings, on-chain MKT, auto-quarantine |
| `PrivateDispenser` + `Groth16Verifier` | ZK private dispensing with nullifiers |
| `CheckpointAnchor` (public chain) | consortium block-hash anchors, equivocation records |
| Baselines (benchmark only) | `NaiveSerialRegistry`, `NftPackRegistry` (ERC-721), `BatchLevelBaseline` |

Key `PharmaChain` functions:

| Function | Who | Rule enforced |
|---|---|---|
| `registerBatch(params)` | Manufacturer | one hierarchical root; packs per carton is a power of two; optional zkRoot |
| `transferOwnership` / `acceptShipment` / `cancelTransfer` | owner / designated recipient | route policy, two-phase handover, expiry, recall/quarantine |
| `acceptWithAggregation(id, scans)` | recipient | scanned cases/cartons proven in the lot and covering the shipment exactly |
| `splitBatch(parent, child, qty)` | manufacturer / distributor | disjoint ranges; quantity conserved |
| `decommissionUnit(id, claim, proof)` | pharmacy holding the stock | hierarchical proof including the hidden code → bitmap → range |
| `decommissionCarton(id, carton, claims, multiproof…)` | pharmacy | multiproof against the carton root, one bitmap write |
| `requestReturn` / `approveReturn` | pharmacy / regulator | clears the bit of an unopened returned pack |
| `recallBatch` | lot manufacturer or **Governance** | freezes the whole lineage |
| `quarantineBatch` / `releaseQuarantine` | regulator or oracle / **Governance only** | |
| `verifyUnit(id, i, tag, commitment, proof)` | anyone (view) | free consumer check |

---

## 8. Protocols

### 8.1 Two-part labels and hierarchy

```
seed        = keccak256(manufacturer wallet signature over "seed v1 | lot")   (re-derivable, never stored)
publicTag_i = H(seed, i, "public")       hiddenCode_i = 10 bytes of H(seed, i, "hidden")  -> XXXX-XXXX-XXXX-XXXX
commit_i    = H(lot, i, hiddenCode_i)    leaf_i = H(H(lot, i, publicTag_i, commit_i))
carton tree (power of two, zero-padded) -> H(H(lot, 1, c, cartonRoot))
case tree                               -> H(H(lot, 2, k, caseRoot))
lot root = Merkle(case leaves)
```

The backend stores only `leaf_i` and `commit_i`, and accepts them only if they reproduce the on-chain root.

### 8.2 Dispensing decision (single pack)

1. The hierarchical proof fails → `CounterfeitDetected`. This covers a forged label **or a copy of the visible
   label without the genuine scratch code**.
2. The bit is already set → `CloneDetected`. This happens when a leaked scratch code is reused.
3. The pack is outside the shipment's range → `DiversionDetected`.
4. Otherwise the bit is set → `UnitDispensed`.

`decommissionCarton` does the same for many packs of one carton with one OpenZeppelin multiproof.

### 8.3 Aggregated receipt

The receiver submits case and carton labels with their proofs. The contract checks that each aggregate belongs
to the lot (with its index bound in the leaf) and that, in order, they cover `[unitStart, unitEnd)` exactly.

### 8.4 Cold chain

Each window carries three EIP-191 signatures by the sensor devices over (chain, monitor, shipment, sequence,
temperature, time). The monitor needs 2 valid, agreeing signatures (within 1 °C), and records outliers or
disagreement as evidence. It updates `MKT = ΔH/R ÷ −ln(mean(exp(−ΔH/RT)))` with ΔH/R = 10,000 K, computed
on-chain in fixed point.

A breach is any of:
- MKT above the lot's maximum;
- a hard excursion (more than 10 °C above the maximum, or freezing).

A breach quarantines the shipment, and **only Governance can release it**.

### 8.5 Private (ZK) dispensing

The private lot additionally commits a Poseidon root. The pharmacy's browser generates a Groth16 proof
(circom, depth 12) that:
- `Poseidon(lotTag, i, hidden)` is in the tree;
- `unitStart ≤ i < unitEnd`;
- `nullifier = Poseidon(lotTag, hidden, 1)`.

The contract verifies the proof and records the nullifier. A reused nullifier is a clone. The pack index never
appears on-chain.

### 8.6 Public checkpoints and geo analytics

- **Checkpoints:** every 20 consortium blocks, the publisher posts (number, hash, stateRoot, validator-set
  hash) to `CheckpointAnchor`. The audit script re-checks the consortium chain against every anchor.
- **Geo analytics:** consumer scans (city-level, with consent) feed two flags: impossible travel above
  900 km/h, and out-of-region sale more than 100 km from the dispensing pharmacy within 72 h.

---

## 9. Off-Chain Components

**Chain indexer.** It indexes PharmaChain, AccessRegistry, ColdChainMonitor, Governance, ValidatorSet and
PrivateDispenser events idempotently, and re-reads batch state from the contracts. Attack, sensor and geo
signals become anomalies. It rebuilds automatically when the genesis changes.

**Untrusted proof server.** It serves hierarchical unit proofs, public commitments, carton multiproofs,
aggregation scans and ZK paths. Every one of them is checked on-chain.

| Group | Endpoints |
|---|---|
| Batches | `GET /api/batches`, `/:id`, `/:id/lineage`, `/:id/units/:i`, `/:id/aggregation`, `/:id/coldchain`; `POST /:id/units`, `/:id/carton-proof`, `/:id/verify`, `/:id/report` |
| Governance and returns | `GET /api/governance/proposals`, `GET /api/admin/returns` |
| ZK | `POST /api/zk/:id/leaves`, `GET /api/zk/:id/path/:i`, `/api/zk/status` |
| Checkpoints | `GET /api/checkpoints` |
| Geo | `POST /api/scans`, `GET /api/scans/:id/:i` |
| Explorer | `GET /api/chain/overview`, `/blocks`, `/blocks/:n`, `/tx/:hash`, `/integrity`, `/validators`, `/stats`, `/events` |

---

## 10. Modules and Features

1. **Identity and admission:** self-registration with a city; on-chain admission by the regulator's wallet;
   no Admin self-registration.
2. **Lot registration:** packaging hierarchy, cold-chain range, optional private (ZK) lot, and a step tracker.
3. **Two-part label sheets:** a QR plus a scratch-off panel per pack, carton and case labels, and a CSV print
   file.
4. **Custody:** route-enforced handoff; acceptance by **case scan** or pack by pack; quantity-conserving splits.
5. **Point of dispense:** single pack (visible plus hidden), **whole carton** (multiproof), returns, and private
   ZK dispensing.
6. **Consumer portal:**
   - verification with no wallet;
   - a **hierarchical Merkle path** recomputed in the browser;
   - a scratch-code check after purchase;
   - city-level scan reporting with geo flags.
7. **Traceability:** custody stepper, lineage tree, per-pack unit bitmap, and a **cold-chain chart with MKT**.
8. **Regulator:**
   - a command centre with the live validator mesh;
   - an evidence feed;
   - a **governance multisig page** (propose, approve, execute);
   - a returns queue.
9. **Ledger explorer:**
   - live hash-linked blocks and the genesis card (validator contract);
   - validator health and proposer share;
   - **public checkpoints**;
   - decoded transactions and events;
   - an integrity re-check.

---

## 11. Security Analysis

| Attack | Defence | Residual risk |
|---|---|---|
| Fake lot | regulator-admitted manufacturers only | regulator collusion (multisig) |
| Forged label | hierarchical proof fails | none |
| **Photocopied visible label, presented first** | the hidden code is required; the copy is rejected and evidenced; **the genuine pack still dispenses** | a tamper-evident scratch panel is needed |
| Leaked scratch code reused | bitmap clone detection | first use of a leaked code (physical access) |
| Brute-forcing the hidden code from its commitment | 80-bit code | lengthen for high-value drugs |
| Diversion | range check, plus geo out-of-region | same pharmacy and city |
| Unit inflation by splitting | ranges carved (Foundry invariant) | none |
| Faulty or malicious sensor | 2-of-3 signed agreement; MKT | 2 colluding sensors |
| Single regulator key | 2-of-3 Governance (recall, release, validators) | 2 colluding officers |
| History rewrite by the consortium | public checkpoints and audit; equivocation evidence | blocks after the last anchor |
| Pack–patient linkability | ZK private lots (nullifier only) | demo trusted setup |
| Backend compromise | no secrets stored; on-chain verdicts | denial of service |
| Validator failure | QBFT f = 1 | 2 or more halt the chain (safety over liveness) |

Slither found 81 issues with **0 confirmed vulnerabilities**: 2 hardening fixes were applied, and the rest are
triaged in `blockchain/security/slither-report.md`.

---

## 12. Experimental Evaluation

Gas and logic experiments ran on the Hardhat EVM (Cancun); network experiments ran on the 4-node Besu QBFT
network. The baselines are naive per-serial storage, **ERC-721 per pack**, and a **batch/box-level design
modelled on** [4]. Full tables are in `blockchain/benchmark-results/` and `docs/RESEARCH.md`.

| Experiment | Result |
|---|---|
| E1: registration, 10,000 packs | ours 380,020 gas (1 tx) vs ERC-721 250.6 M (40 tx), **659× less**; vs naive 228.7 M (20 tx) |
| E2: dispensing a 32-pack carton | 9,033 gas per pack vs 72,248 single, **−87.5%**; ERC-721 burn 33,489 |
| E2c: receiving 1,152 packs | **3 case scans**, 109,854 gas, vs about 56.8 M gas to verify every pack |
| E3: 10 packs, each copied 3× | two-part labels flag **30/30** copies with **0/10** genuine flagged; one-part and ERC-721 wrongly flag 7/10 genuine; batch-level and heuristic catch 0/30 |
| E4: QBFT throughput | finality about 2–5 s; gas-bound ceiling about 455 TPS for 33k-gas transactions |
| E5: fault tolerance | continues with 3/4 validators, halts safely at 2/4 with no fork; recovery 38–78 s |
| E6: cold chain | **0 false quarantines / 0 missed breaches**, vs 2 and 1 for a single-sensor rule; 123,809 gas per signed window |
| E7: ZK dispensing | proving about 1.3 s; 326,446 gas vs 69,243 public (privacy costs about 257k gas) |
| E8: checkpoints | about 150,768 gas each on the public chain; audit PASS; a rewritten history FAILS |

Caveats:
- In E6, the ground truth for "spike" and "sustained" uses the MKT criterion itself. The sensor-fault cases
  are the decisive ones.
- MKT reacts later than a single-reading rule (window 23 vs 13).

---

## 13. Verification and Testing

- **42 Hardhat tests**, covering:
  - roles and suspension; route policy, handshake and expiry; split conservation;
  - two-part labels, including the copy-first race; hierarchy for awkward lot shapes; aggregation receipt;
  - multiproof batches; returns; governance; the validator set;
  - 2-of-3 MKT cold chain; recall;
  - ZK dispensing (7 tests); checkpoint anchor (4 tests).
- **Foundry fuzz and invariants** (11 properties, all hold): unit conservation and disjoint ranges over 8,192
  random calls; forged codes or tags never verify; no double dispense; governance threshold.
- **Slither** static analysis with triage.
- **End-to-end runs on the live QBFT network:** `scripts/demo-scenario.js`, the sensor simulator profiles, the
  checkpoint audit, and the browser flows in §14. The screenshots were captured by driving the real dApp with
  a test wallet holding the dev keys.

---

## 14. Screenshots

All figures were captured from the running v3 system on the 4-validator Besu network. Earlier v1 screenshots
are archived in `Images/v1-archive/`.

### 14.1 Network, genesis block and consensus

**Figure 14.1: The four Besu validator containers**

![Docker validators](Images/screenshots/36_terminal_docker_validators.png)

**Figure 14.2: The validator set read from the genesis ValidatorSet contract, controlled by Governance**

![Validator contract](Images/screenshots/37_terminal_validator_contract.png)

**Figure 14.3: Ledger explorer: live blocks, QBFT validator mesh, validator set, throughput, checkpoints**

![Explorer](Images/screenshots/32_ledger_explorer.png)

**Figure 14.4: Genesis block card: contract-based validator selection and the hash-chain integrity check**

![Genesis](Images/screenshots/34_genesis_validator_contract.png)

**Figure 14.5: Public checkpoints anchored on the public chain and verified against the consortium**

![Checkpoints](Images/screenshots/33_public_checkpoints.png)

### 14.2 Identity and admission

**Figure 14.6: Sign-in with live network status**

![Login](Images/screenshots/01_login.png)

**Figure 14.7: A new pharmacy applies, with its city (used by geo analytics)**

![Register](Images/screenshots/02_register_organisation.png)

**Figure 14.8: Regulator admissions with live on-chain roles**

![Admissions](Images/screenshots/03_admin_admissions_pending.png)

### 14.3 Manufacturer

**Figure 14.9: Lot registration with packaging hierarchy, cold-chain range and the private-lot option**

![Register lot](Images/screenshots/04_register_lot_form.png)

**Figure 14.10: Two-part labels: visible QR plus scratch-off panel (three panels revealed)**

![Two-part labels](Images/screenshots/05_two_part_labels.png)

**Figure 14.11: Case and carton aggregate labels**

![Aggregate labels](Images/screenshots/06_case_and_carton_labels.png)

**Figure 14.12: Route policy enforced on-chain (Manufacturer → Pharmacy rejected)**

![Route](Images/screenshots/07_route_policy_enforced.png)

### 14.4 Distributor

**Figure 14.13: Incoming shipment with "Accept by case scan"**

![Incoming](Images/screenshots/08_distributor_incoming_case_scan.png)

**Figure 14.14: Splitting off a whole case (quantity-conserving)**

![Split](Images/screenshots/09_split_by_case.png)

**Figure 14.15: Distributor workspace after the split and hand-off**

![Distributor](Images/screenshots/10_distributor_dashboard.png)

### 14.5 Pharmacy: point of dispense

**Figure 14.16: A genuine pack dispensed (visible label plus scratch code)**

![Genuine](Images/screenshots/11_dispense_genuine.png)

**Figure 14.17: A photocopy of the visible label, presented first, is rejected**

![Copy rejected](Images/screenshots/12_photocopy_without_scratch_code_rejected.png)

**Figure 14.18: The genuine pack still wins afterwards**

![Genuine wins](Images/screenshots/13_genuine_pack_still_wins.png)

**Figure 14.19: A leaked scratch code reused after the sale is a clone**

![Clone](Images/screenshots/14_leaked_code_clone.png)

**Figure 14.20: A pack from another shipment is recorded as diversion**

![Diversion](Images/screenshots/15_diversion.png)

**Figure 14.21: A whole carton dispensed in one multiproof transaction, with gas per pack**

![Carton](Images/screenshots/16_carton_multiproof.png)

**Figure 14.22: Return of an unopened pack requested**

![Return](Images/screenshots/17_return_requested.png)

**Figure 14.23: Pharmacy workspace**

![Pharmacy](Images/screenshots/18_pharmacy_dashboard.png)

### 14.6 Private (zero-knowledge) lot

**Figure 14.24: Registering a private lot**

![Private lot](Images/screenshots/22_private_lot_form.png)

**Figure 14.25: Private dispense: a Groth16 proof generated in the browser and verified on-chain**

![ZK dispense](Images/screenshots/23_private_zk_dispense.png)

**Figure 14.26: The same private pack presented again: nullifier already spent**

![ZK clone](Images/screenshots/24_private_zk_clone.png)

### 14.7 Consumer verification

**Figure 14.27: Verification with the hierarchical Merkle path recomputed in the browser and the scratch-code check**

![Verify](Images/screenshots/19_verify_hierarchical_proof.png)

**Figure 14.28: Geo analytics: the same pack scanned in Coimbatore and New Delhi minutes apart**

![Geo](Images/screenshots/20_geo_impossible_travel.png)

**Figure 14.29: A counterfeit label rejected by `verifyUnit`**

![Counterfeit](Images/screenshots/21_verify_counterfeit.png)

### 14.8 Traceability and cold chain

**Figure 14.30: Batch trace: custody, lineage tree, unit bitmap, evidence, history**

![Trace](Images/screenshots/25_batch_trace.png)

**Figure 14.31: Cold chain: 3 signed sensors, the agreed readings and the cumulative MKT crossing the 8 °C limit; an outlier sensor out-voted; auto-quarantine**

![Cold chain](Images/screenshots/26_cold_chain_mkt.png)

### 14.9 Regulator and governance

**Figure 14.32: Returns awaiting approval**

![Returns](Images/screenshots/27_returns_pending.png)

**Figure 14.33: A governance proposal (lot recall) at 1 of 2 approvals**

![Proposal](Images/screenshots/28_governance_proposal_1_of_2.png)

**Figure 14.34: Approved by a second officer and executed by the multisig**

![Executed](Images/screenshots/29_governance_executed.png)

**Figure 14.35: Regulator command centre**

![Regulator](Images/screenshots/30_regulator_dashboard.png)

**Figure 14.36: Evidence feed (on-chain and off-chain signals)**

![Evidence](Images/screenshots/31_evidence_feed.png)

**Figure 14.37: A clone transaction decoded in the explorer**

![Clone tx](Images/screenshots/35_explorer_clone_tx.png)

### 14.10 Tests and experiments

**Figure 14.38: 42 Hardhat tests passing**

![Tests](Images/screenshots/38_terminal_tests.png)

**Figure 14.39: Foundry fuzz and invariant tests (excerpt)**

![Foundry](Images/screenshots/39_terminal_foundry_fuzz.png)

**Figure 14.40: Multiproof gas benchmark (E2)**

![Benchmark](Images/screenshots/40_terminal_multiproof_benchmark.png)

**Figure 14.41: Public checkpoint audit**

![Audit](Images/screenshots/41_terminal_checkpoint_audit.png)

**Figure 14.42: Fault-tolerance experiment on the v3 network**

![Fault](Images/screenshots/42_terminal_fault_tolerance.png)

---

## 15. Setup and Deployment

Prerequisites: Node.js 18+, MongoDB, Docker Desktop, MetaMask.

```powershell
cd blockchain; npm install; cd ..\backend; npm install; cd ..\frontend; npm install; cd ..
cd blockchain
npm run network:genesis        # genesis block with the ValidatorSet contract (add -- --force to regenerate)
npm run network:up             # 4 Besu validators
npm run deploy:besu            # core contracts, members, sensors, ValidatorSet -> Governance
npm run deploy:zk              # ZK verifier + PrivateDispenser
npm run public:node            # (separate terminal) public-chain stand-in on :8600
npm run checkpoint:deploy      # anchor contract on the public chain
npm run checkpoint:publish     # (separate terminal) checkpoint publisher
npm run demo:besu              # optional demo data
cd ..\backend;  npm run dev    # API + indexer :5000
cd ..\frontend; npm run dev    # dApp :3000
```

Accounts (dev keys; passwords `<role>123`, officers `officer123`):

| Login | Role | Wallet |
|---|---|---|
| manufacturer@pharma.com | Manufacturer | `0xf39F…2266` |
| distributor@pharma.com | Distributor | `0x7099…79C8` |
| pharmacy@pharma.com | Pharmacy | `0x3C44…93BC` |
| admin@pharma.com | Regulator, governance signer 1 | `0x90F7…b906` |
| officer2@pharma.com / officer3@pharma.com | governance signers 2 and 3 | `0x976E…0aa9` / `0x14dC…9955` |

---

## 16. Limitations and Future Work

- **Scratch panel:** the label must be tamper-evident; an opened pack leaks its code.
- **ZK trusted setup:** single-party for the demo; production needs an MPC ceremony.
- **Sensors:** two colluding sensors defeat 2-of-3; hardware-backed device keys are needed.
- **Checkpoints:** they protect history only up to the last anchor; Amoy requires faucet funds.
- **Geo analytics:** they depend on consumers sharing a city.
- **Experiments:** all ran on one laptop; a distributed deployment adds latency.
- **Comparison table:** the related-work comparison (RESEARCH.md §8) must be completed from the papers.

---

## 17. Conclusion

PharmaChain v3 makes unit-level drug traceability both **clone-resistant in the realistic attack**, a copy
reaching the counter first, and **practical**:
- one root per lot, case-level receipt, and carton-level dispensing at 9k gas per pack;
- trust is distributed across signed sensors, a regulator multisig and a governed validator set;
- the private consortium remains auditable through public checkpoints, and private lots hide which pack was
  sold.

The measured results and verification tooling back each claim, and the limitations are stated explicitly.

---

## 18. References

*Verify every reference against the original before submission.*

1. WHO, *A study on the public health and socioeconomic impact of substandard and falsified medical products*, 2017.
2. Directive 2011/62/EU; Commission Delegated Regulation (EU) 2016/161.
3. U.S. Drug Supply Chain Security Act, 2013.
4. A. Musamih et al., "A Blockchain-Based Approach for Drug Traceability in Healthcare Supply Chain," *IEEE Access*, vol. 9, 2021.
5. R. C. Merkle, *CRYPTO '87*.
6. M. Castro and B. Liskov, "Practical Byzantine Fault Tolerance," *OSDI* 1999.
7. R. Saltini and D. Hyland-Wood, "IBFT 2.0," 2019; Hyperledger Besu QBFT documentation.
8. J. D. Haynes, *J. Pharm. Sci.*, 1971 (Mean Kinetic Temperature); USP ⟨1079⟩.
9. J. Groth, *EUROCRYPT* 2016; iden3 circom/snarkjs; L. Grassi et al., Poseidon, *USENIX Security* 2021.
10. T. Pornin, RFC 6979; OpenZeppelin Contracts 5.x; PRBMath.
11. J. Feist et al., "Slither," *WETSEB* 2019; Foundry.
12. PharmChain (2025); PharmaChain 3.0: *add the full citations from your literature list.*

---

## Appendix: Project Structure

```
pharmachain-blockchain-supply-chain/
├── blockchain/
│   ├── contracts/  PharmaChain, AccessRegistry, Governance, ValidatorSet, ColdChainMonitor
│   │               zk/ (PrivateDispenser, Groth16Verifier)  checkpoint/ (CheckpointAnchor)  benchmark/ (baselines)
│   ├── circuits/   private_dispense.circom (+ build/)
│   ├── lib/        unitMerkle.js (two-part labels, hierarchy, multiproofs)
│   ├── scripts/    deploy, demo-scenario, simulate-sensor, benchmark
│   │               network/ (genesis, load, fault, validator governance)  zk/  checkpoint/
│   ├── test/       PharmaChain, PrivateDispenser, CheckpointAnchor (42 tests)
│   ├── forge-test/ Foundry fuzz + invariants      security/ Slither + Foundry reports
│   └── benchmark-results/  results, zk, checkpoints, network, fault-tolerance
├── network/docker-compose.yml   4 Besu validators
├── backend/src/  services/chainIndexer.js, routes/ (batches, chain, governance, zk, checkpoints, scans, admin, auth), models/
├── frontend/src/ pages/ (Dashboard, CreateBatch, UnitLabels, TransferBatch, BatchDetail, VerifyProduct, Explorer,
│                        GovernancePage, ReturnsPage, AdminDashboard, …), components/, utils/
├── frontend/public/zk/          prover artefacts (wasm, zkey)
├── docs/RESEARCH.md
└── Images/screenshots/          v3 figures   (Images/v1-archive/ - v1)
```

---

*Report updated: November 2026*
