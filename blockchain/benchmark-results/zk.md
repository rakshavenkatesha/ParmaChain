# E7 - Zero-knowledge private dispensing

Network: `hardhat` - 2026-11-24T14:11:50.577Z - 8 runs

| Metric | Value |
|---|---:|
| Circuit | Groth16, depth-12 Poseidon tree (4,096 packs), 7,605 constraints, 5 public signals |
| Proving time (Node, snarkjs) | avg 1,322 ms (min 785, max 4,600) |
| Off-chain verification | 44 ms |
| Private dispense gas (verify + nullifier + core hook) | 326,446 |
| of which Groth16 verifier (estimate) | 241,790 |
| Public decommission gas (same lot shape) | 69,243 |
| Privacy overhead per pack | 257,203 gas |
| Prover artefacts | wasm 2.2 MB, zkey 3.3 MB |

The public path writes the pack index into the dispensing bitmap; the private path stores only a
nullifier, so the ledger cannot link a dispense to a pack, patient or shipment position.
Trusted setup: generated locally by a single party - adequate for a demo, NOT for production
(production needs a multi-party ceremony, e.g. the Hermez/Perpetual Powers of Tau + a phase-2 MPC).
