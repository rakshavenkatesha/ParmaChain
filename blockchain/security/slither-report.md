# Slither static analysis - triage

Tool: Slither 0.11.6 (Trail of Bits, free/open source), solc 0.8.24, 102 detectors.

```bash
cd blockchain
npx hardhat compile
slither . --compile-force-framework hardhat --hardhat-ignore-compile \
  --filter-paths "node_modules|contracts/benchmark|forge-test" --exclude-dependencies \
  --json security/slither-raw.json
```

Raw output: `security/slither-raw.txt`, `security/slither-raw.json`. Scope: every contract under
`contracts/` except the evaluation baselines (`contracts/benchmark/`). At the time of the run this
included the ZK module (`contracts/zk/`) and the checkpoint anchor (`contracts/checkpoint/`) that are
developed separately; their findings are triaged below but were not changed here.

**Result: 81 findings - 0 confirmed vulnerabilities; 2 low-severity hardening fixes applied.**

| Detector | Impact | Count | Verdict |
|---|---|---:|---|
| incorrect-return (Groth16Verifier) | High | 3 | **False positive.** snarkjs-generated verifier: the assembly helpers deliberately `return(0, 0x20)` to stop with `false` on invalid field elements/pairings. This is the standard, audited snarkjs template. |
| uninitialized-state `CheckpointAnchor._heights` | High | 1 | **False positive.** It is a mapping; mappings are zero-initialised and filled by `submitCheckpoint`. |
| uninitialized-local (`acceptWithAggregation` start/size/lotRoot, `_validReadings.used`, `mktOf.sum`) | Medium | 5 | **False positive.** Locals intentionally start at zero and are assigned on every branch (unknown levels revert). |
| incorrect-equality `verifyLicense` | Medium | 1 | **False positive.** Compares two hashes; strict equality is exactly what is wanted. |
| unused-return `ECDSA.tryRecover` (3rd value) | Medium | 1 | **Accepted.** The third value (error argument) is not needed; `err` is checked. |
| missing-zero-check `PharmaChain` constructor `_governance`, `setPrivateDispenser(module)` | Low | 2 | **Fixed.** A zero governance address would make quarantine release / regulator recall impossible forever; a zero module would leave the one-time setter re-callable. Added `require`s. |
| missing-zero-check `ValidatorSet` constructor `_owner` | Low | 1 | **Accepted.** The constructor never runs on the real network (contract lives in genesis storage); in tests a zero owner only disables the one-time hand-over. |
| reentrancy-events `Governance.execute` | Low | 1 | **Accepted.** `executed` is set *before* the external call (checks-effects-interactions), so re-entry cannot execute twice (also covered by the Foundry invariant); only the event order differs. |
| events-access `CheckpointAnchor.transferOwnership` | Low | 1 | **Noted** for the checkpoint module owner (emit an event on ownership change). |
| timestamp (14) | Low | 14 | **Accepted.** Only expiry checks use `block.timestamp`; the rest are mis-attributions on plain `require`s. Under QBFT, timestamps are set by known, permissioned validators and block periods are 2 s, so manipulation is bounded to seconds against expiry windows of months. |
| assembly (5), low-level-calls (1) | Info | 6 | **Accepted.** Generated verifier; `Governance.execute` bubbles the target's revert reason with assembly. |
| costly-loop / cache-array-length | Info/Opt | 3 | **Accepted.** Validator / signer lists are 3-7 entries. |
| too-many-digits | Info | 2 | **Accepted.** Fixed-point constants (`273.15e18`) written in full on purpose. |
| solc-version / missing-inheritance | Info | 2 | **Accepted.** Generated verifier pragma; interface inheritance is cosmetic. |
| naming-convention | Info | 38 | **Accepted.** Leading-underscore parameters and mixed-case constants; style only. |

## Changes made to core contracts

`contracts/PharmaChain.sol`:

```solidity
constructor(AccessRegistry _registry, address _governance) {
    require(address(_registry) != address(0) && _governance != address(0), "Zero address");
    ...
function setPrivateDispenser(address module) external {
    ...
    require(module != address(0), "Zero module");
```

After the change, `npx hardhat test test/PharmaChain.test.js` passes 31/31 and the Foundry suite passes
9/9 (`security/foundry-report.md`). **Contracts already deployed on a running Besu network must be
redeployed to pick up the change.**

## Manual review notes (not flagged by Slither)

- `decommissionCarton` relies on `packsPerCarton` being a power of two <= 256 so that one carton
  sits in one bitmap word; `registerBatch` enforces this, and the multiproof requires strictly
  ascending, in-carton indices.
- `approveReturn` trusts the range check done in `requestReturn` (only the holding pharmacy can
  request, only for units of its own range).
- `recordPrivateDispense` delegates nullifier uniqueness to the PrivateDispenser module; it is only
  callable by the module address fixed once at deployment.
