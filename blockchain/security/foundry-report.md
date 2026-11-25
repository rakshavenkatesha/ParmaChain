# Property-based testing with Foundry (fuzz + invariant)

Tool: Foundry `forge` (free, open source) run from the official Docker image, so nothing is
installed locally. Config: `blockchain/foundry.toml` (solc 0.8.24, Cancun, via-IR, 1,000 fuzz runs
per property, invariant campaigns of 128 runs x 64 calls). Tests: `blockchain/forge-test/`.
No forge-std is vendored: `forge-test/Base.sol` declares the few cheatcodes used and the
`targetContracts()` / `targetSelectors()` hooks read by the invariant engine.

```bash
cd blockchain
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/work" -w /work \
  --entrypoint forge ghcr.io/foundry-rs/foundry:latest test        # Git-Bash on Windows
# Linux/macOS:  docker run --rm -v "$PWD:/work" -w /work --entrypoint forge ghcr.io/foundry-rs/foundry:latest test
```

Full console output of the latest run: `security/forge-output.txt`.

## Result: all 11 properties hold (forge reports 9/9 tests - the 3 conservation invariants run as one campaign; 3 suites, ~4 min)

| Suite | Property | Kind | Runs | Result |
|---|---|---|---:|---|
| Conservation.t.sol | `invariant_unitsConserved`: sum of all shipment quantities of a lot == lot size | invariant | 128 x 64 = 8,192 random split / ship calls | PASS |
| Conservation.t.sol | `invariant_rangesDisjoint`: unit ranges never overlap and stay inside the lot | invariant | (same campaign) | PASS |
| Conservation.t.sol | `invariant_sameOrigin`: every shipment descends from the same lot | invariant | (same campaign) | PASS |
| Labels.t.sol | `test_everyGenuinePackVerifies` (hierarchy built independently in Solidity) | unit | 1 | PASS |
| Labels.t.sol | `testFuzz_forgedHiddenCodeNeverDispenses`: any scratch code != genuine -> InvalidProof, bit untouched | fuzz | 1,000 | PASS |
| Labels.t.sol | `testFuzz_forgedPublicTagNeverVerifies`: any (tag, commitment) != genuine fails consumer verification | fuzz | 1,000 | PASS |
| Labels.t.sol | `testFuzz_neverDispensedTwice`: repeated presentations dispense exactly once | fuzz | 1,000 | PASS |
| Labels.t.sol | `testFuzz_indexSwapRejected`: a genuine label shown under another index is rejected | fuzz | 1,000 | PASS |
| Governance.t.sol | `testFuzz_thresholdEnforced`: execution succeeds iff >= 3 of 5 signers approved | fuzz | 1,000 | PASS |
| Governance.t.sol | `invariant_noExecutionBelowThreshold`: every executed proposal had >= threshold approvals, executions == side effects (no double execution) | invariant | 128 x 64 random propose / approve / execute calls by 5 signers + 2 outsiders | PASS |
| Governance.t.sol | `testFuzz_outsiderCannotApprove` | fuzz | 1,000 | PASS |

Invariant handler call statistics (first run): SplitHandler `split` 4,073 / `ship` 4,119 calls, 0 reverts;
GovHandler `propose` 2,686 / `execute` 2,731 calls (+ approvals), 0 unexpected reverts.

The suite was re-run on the final code (after the Slither hardening - two zero-address `require`s in
`PharmaChain`, see `slither-report.md`): 9/9 passed again in 191 s, output in
`security/forge-output.txt`. The Hardhat suite (31 tests) also passes on the final code.

## Echidna

Not run (optional). The same conservation property can be checked with
`docker run --rm -v "$PWD:/src" ghcr.io/crytic/echidna/echidna` against an Echidna harness; Foundry's
invariant engine already covers it here.
