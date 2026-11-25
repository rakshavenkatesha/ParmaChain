/**
 * E7 - cost of zero-knowledge private dispensing vs public decommissioning.
 *   npx hardhat run scripts/zk/benchmark-zk.js            (in-process Hardhat EVM)
 * Writes benchmark-results/zk.json and zk.md
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const snarkjs = require("snarkjs");
const M = require("../../lib/unitMerkle");
const Z = require("./zkTree");

const WASM = path.join(__dirname, "../../circuits/build/private_dispense.wasm");
const ZKEY = path.join(__dirname, "../../circuits/build/private_dispense.zkey");
const VKEY = path.join(__dirname, "../../circuits/build/verification_key.json");
const RUNS = Number(process.env.ZK_RUNS || 8);
const DAY = 86400;

async function main() {
  const [mfr, dist, pharm, regulator, , , , , o2, o3] = await ethers.getSigners();
  const registry = await ethers.deployContract("AccessRegistry", [regulator.address]);
  const gov = await ethers.deployContract("Governance", [[regulator.address, o2.address, o3.address], 2]);
  const chain = await ethers.deployContract("PharmaChain", [await registry.getAddress(), await gov.getAddress()], regulator);
  const verifier = await ethers.deployContract("Groth16Verifier");
  const dispenser = await ethers.deployContract("PrivateDispenser", [await chain.getAddress(), await registry.getAddress(), await verifier.getAddress()]);
  await chain.connect(regulator).setPrivateDispenser(await dispenser.getAddress());
  for (const [a, r] of [[mfr, 1], [dist, 2], [pharm, 3]]) await registry.connect(regulator).registerParticipant(a.address, r, "x", ethers.ZeroHash);

  const N = 64;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const reg = async (id, zkRoot, lot) => {
    await chain.connect(mfr).registerBatch({ batchId: id, drugName: "D", productCode: "P", quantity: N, productionDate: now - DAY, expiryDate: now + 365 * DAY, minTempDeci: 20, maxTempDeci: 80, unitRoot: lot.root, packsPerCarton: 8, cartonsPerCase: 4, zkRoot });
    await chain.connect(mfr).transferOwnership(id, dist.address);
    await chain.connect(dist).acceptShipment(id);
    await chain.connect(dist).transferOwnership(id, pharm.address);
    await chain.connect(pharm).acceptShipment(id);
  };

  // ---- private lot
  const lot = M.generateLot("PRIV", N, ethers.hexlify(ethers.randomBytes(32)), 8, 4);
  const t0 = Date.now();
  const zk = Z.buildZkLot(lot.originKey, lot.labels.map((l) => l.hiddenCode));
  const treeMs = Date.now() - t0;
  await reg("PRIV", zk.zkRoot, lot);

  const vkey = JSON.parse(fs.readFileSync(VKEY, "utf8"));
  const proveMs = [];
  const verifyMs = [];
  const gas = [];
  for (let i = 0; i < RUNS; i++) {
    const input = Z.proofInput({ root: zk.root, lotTag: zk.lotTag, index: i, hiddenCode: lot.labels[i].hiddenCode, path: Z.pathOf(zk.layers, i), rangeStart: 0, rangeEnd: N });
    const s = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    proveMs.push(Date.now() - s);
    const v = Date.now();
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) throw new Error("off-chain verify failed");
    verifyMs.push(Date.now() - v);
    const p = Z.solidityProof(proof);
    const rc = await (await dispenser.connect(pharm).dispense("PRIV", p.a, p.b, p.c, Z.toBytes32(input.nullifierHash))).wait();
    gas.push(Number(rc.gasUsed));
  }
  const pv = Z.solidityProof((await snarkjs.groth16.fullProve(Z.proofInput({ root: zk.root, lotTag: zk.lotTag, index: 0, hiddenCode: lot.labels[0].hiddenCode, path: Z.pathOf(zk.layers, 0), rangeStart: 0, rangeEnd: N }), WASM, ZKEY)).proof);
  const verifierGas = Number(await verifier.verifyProof.estimateGas(pv.a, pv.b, pv.c, [zk.root, Z.nullifierOf(zk.lotTag, Z.hiddenField(lot.labels[0].hiddenCode)), 0, N, zk.lotTag]));

  // ---- public lot (same shape) for comparison
  const pub = M.generateLot("PUB", N, ethers.hexlify(ethers.randomBytes(32)), 8, 4);
  await reg("PUB", ethers.ZeroHash, pub);
  const pubGas = [];
  for (let i = 1; i < RUNS + 1; i++) {
    const rc = await (await chain.connect(pharm).decommissionUnit("PUB", { index: i, publicTag: pub.labels[i].publicTag, hiddenCode: pub.labels[i].hiddenCode }, M.unitProof(pub.hierarchy, i))).wait();
    pubGas.push(Number(rc.gasUsed));
  }

  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const constraints = 7605;
  const res = {
    network: network.name,
    generatedAt: new Date().toISOString(),
    circuit: { name: "private_dispense", depth: Z.DEPTH, maxUnits: 2 ** Z.DEPTH, constraints, publicSignals: 5, ptauPower: 13, setup: "local single-party powers of tau (demo only)" },
    runs: RUNS,
    poseidonTreeBuildMs: { units: N, ms: treeMs },
    provingMsNode: { avg: avg(proveMs), min: Math.min(...proveMs), max: Math.max(...proveMs) },
    offchainVerifyMs: avg(verifyMs),
    gas: { privateDispenseAvg: avg(gas), groth16VerifierEstimate: verifierGas, publicDecommissionAvg: avg(pubGas), overhead: avg(gas) - avg(pubGas) },
    artefacts: { wasmBytes: fs.statSync(WASM).size, zkeyBytes: fs.statSync(ZKEY).size }
  };
  const out = path.join(__dirname, "../../benchmark-results");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "zk.json"), JSON.stringify(res, null, 2));
  const f = (x) => Number(x).toLocaleString("en-US");
  const md = `# E7 - Zero-knowledge private dispensing

Network: \`${res.network}\` - ${res.generatedAt} - ${RUNS} runs

| Metric | Value |
|---|---:|
| Circuit | Groth16, depth-${Z.DEPTH} Poseidon tree (${f(2 ** Z.DEPTH)} packs), ${f(constraints)} constraints, 5 public signals |
| Proving time (Node, snarkjs) | avg ${f(res.provingMsNode.avg)} ms (min ${f(res.provingMsNode.min)}, max ${f(res.provingMsNode.max)}) |
| Off-chain verification | ${f(res.offchainVerifyMs)} ms |
| Private dispense gas (verify + nullifier + core hook) | ${f(res.gas.privateDispenseAvg)} |
| of which Groth16 verifier (estimate) | ${f(res.gas.groth16VerifierEstimate)} |
| Public decommission gas (same lot shape) | ${f(res.gas.publicDecommissionAvg)} |
| Privacy overhead per pack | ${f(res.gas.overhead)} gas |
| Prover artefacts | wasm ${(res.artefacts.wasmBytes / 1e6).toFixed(1)} MB, zkey ${(res.artefacts.zkeyBytes / 1e6).toFixed(1)} MB |

The public path writes the pack index into the dispensing bitmap; the private path stores only a
nullifier, so the ledger cannot link a dispense to a pack, patient or shipment position.
Trusted setup: generated locally by a single party - adequate for a demo, NOT for production
(production needs a multi-party ceremony, e.g. the Hermez/Perpetual Powers of Tau + a phase-2 MPC).
`;
  fs.writeFileSync(path.join(out, "zk.md"), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
