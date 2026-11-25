const { expect } = require("chai");
const path = require("path");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const snarkjs = require("snarkjs");
const M = require("../lib/unitMerkle");
const Z = require("../scripts/zk/zkTree");

const WASM = path.join(__dirname, "../circuits/build/private_dispense.wasm");
const ZKEY = path.join(__dirname, "../circuits/build/private_dispense.zkey");
const Role = { Manufacturer: 1, Distributor: 2, Pharmacy: 3 };
const DAY = 86400;

async function fixture() {
  const [mfr, dist, pharm, regulator, , , , pharm2, officer2, officer3] = await ethers.getSigners();
  const registry = await ethers.deployContract("AccessRegistry", [regulator.address]);
  const governance = await ethers.deployContract("Governance", [[regulator.address, officer2.address, officer3.address], 2]);
  const chain = await ethers.deployContract("PharmaChain", [await registry.getAddress(), await governance.getAddress()], regulator);
  const verifier = await ethers.deployContract("Groth16Verifier");
  const dispenser = await ethers.deployContract("PrivateDispenser", [await chain.getAddress(), await registry.getAddress(), await verifier.getAddress()]);
  await chain.connect(regulator).setPrivateDispenser(await dispenser.getAddress());

  const r = registry.connect(regulator);
  await r.registerParticipant(mfr.address, Role.Manufacturer, "M", ethers.ZeroHash);
  await r.registerParticipant(dist.address, Role.Distributor, "D", ethers.ZeroHash);
  await r.registerParticipant(pharm.address, Role.Pharmacy, "P", ethers.ZeroHash);
  await r.registerParticipant(pharm2.address, Role.Pharmacy, "P2", ethers.ZeroHash);

  // private lot of 24 packs: keccak hierarchy (visible-label checks) + Poseidon tree (ZK dispensing)
  const lot = M.generateLot("ZK-LOT", 24, ethers.hexlify(ethers.randomBytes(32)), 4, 3);
  const zk = Z.buildZkLot(lot.originKey, lot.labels.map((l) => l.hiddenCode));
  const now = await time.latest();
  await chain.connect(mfr).registerBatch({
    batchId: "ZK-LOT", drugName: "Insulin", productCode: "PC", quantity: 24,
    productionDate: now - DAY, expiryDate: now + 365 * DAY, minTempDeci: 20, maxTempDeci: 80,
    unitRoot: lot.root, packsPerCarton: 4, cartonsPerCase: 3, zkRoot: zk.zkRoot
  });
  const ship = async (from, to, id) => {
    await chain.connect(from).transferOwnership(id, to.address);
    await chain.connect(to).acceptShipment(id);
  };
  await ship(mfr, dist, "ZK-LOT");
  await chain.connect(dist).splitBatch("ZK-LOT", "ZK-LOT-B", 12); // units 12..23
  await ship(dist, pharm, "ZK-LOT"); // units 0..11
  await ship(dist, pharm2, "ZK-LOT-B");
  return { chain, dispenser, lot, zk, pharm, pharm2 };
}

/** Builds a Groth16 proof for dispensing `index` from a shipment holding [start, end). */
async function prove(lot, zk, index, start, end, hiddenCode = lot.labels[index].hiddenCode) {
  const input = Z.proofInput({ root: zk.root, lotTag: zk.lotTag, index, hiddenCode, path: Z.pathOf(zk.layers, index), rangeStart: start, rangeEnd: end });
  const { proof } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  const p = Z.solidityProof(proof);
  return { ...p, nullifier: Z.toBytes32(input.nullifierHash) };
}

describe("Zero-knowledge private dispensing", function () {
  this.timeout(120000);

  it("dispenses a private pack without revealing which one", async function () {
    const { chain, dispenser, lot, zk, pharm } = await loadFixture(fixture);
    const p = await prove(lot, zk, 5, 0, 12);
    const tx = dispenser.connect(pharm).dispense("ZK-LOT", p.a, p.b, p.c, p.nullifier);
    await expect(tx).to.emit(chain, "PrivateUnitDispensed").withArgs(M.batchKey("ZK-LOT"), p.nullifier, pharm.address, (x) => x > 0n);
    expect(await dispenser.isNullifierUsed(p.nullifier)).to.equal(true);
    expect((await chain.getBatch("ZK-LOT")).remaining).to.equal(11);
    // the on-chain record holds no pack index: the bitmap is untouched
    expect(await chain.isDispensed(lot.originKey, 5)).to.equal(false);
  });

  it("the same pack dispensed twice is caught by its nullifier (evidence, not a revert)", async function () {
    const { chain, dispenser, lot, zk, pharm } = await loadFixture(fixture);
    const p1 = await prove(lot, zk, 7, 0, 12);
    await dispenser.connect(pharm).dispense("ZK-LOT", p1.a, p1.b, p1.c, p1.nullifier);
    const p2 = await prove(lot, zk, 7, 0, 12); // fresh proof, same pack
    expect(await dispenser.connect(pharm).dispense.staticCall("ZK-LOT", p2.a, p2.b, p2.c, p2.nullifier)).to.equal(false);
    await expect(dispenser.connect(pharm).dispense("ZK-LOT", p2.a, p2.b, p2.c, p2.nullifier)).to.emit(dispenser, "PrivateCloneDetected");
    expect((await chain.getBatch("ZK-LOT")).remaining).to.equal(11);
  });

  it("a pack from another shipment's range cannot be proven", async function () {
    const { dispenser, lot, zk, pharm } = await loadFixture(fixture);
    // unit 15 belongs to ZK-LOT-B: the circuit refuses the range constraint ...
    await expect(prove(lot, zk, 15, 0, 12)).to.be.rejected;
    // ... and a proof made for ZK-LOT-B's range does not verify against ZK-LOT's on-chain range
    const p = await prove(lot, zk, 15, 12, 24);
    await expect(dispenser.connect(pharm).dispense("ZK-LOT", p.a, p.b, p.c, p.nullifier)).to.be.revertedWith("Invalid zero-knowledge proof");
  });

  it("a forged scratch code cannot be proven or replayed", async function () {
    const { dispenser, lot, zk, pharm } = await loadFixture(fixture);
    await expect(prove(lot, zk, 3, 0, 12, "0x0102030405060708090a")).to.be.rejected; // not a leaf
    const p = await prove(lot, zk, 3, 0, 12);
    // tampering with the public nullifier invalidates the proof
    await expect(dispenser.connect(pharm).dispense("ZK-LOT", p.a, p.b, p.c, ethers.ZeroHash)).to.be.revertedWith("Invalid zero-knowledge proof");
  });

  it("only the pharmacy holding the shipment can dispense privately", async function () {
    const { dispenser, lot, zk, pharm2 } = await loadFixture(fixture);
    const p = await prove(lot, zk, 2, 0, 12);
    await expect(dispenser.connect(pharm2).dispense("ZK-LOT", p.a, p.b, p.c, p.nullifier)).to.be.revertedWith("Caller is not the current owner");
  });

  it("public decommissioning is blocked for private lots", async function () {
    const { chain, lot, pharm } = await loadFixture(fixture);
    const claim = { index: 1, publicTag: lot.labels[1].publicTag, hiddenCode: lot.labels[1].hiddenCode };
    await expect(chain.connect(pharm).decommissionUnit("ZK-LOT", claim, M.unitProof(lot.hierarchy, 1))).to.be.revertedWith(
      "Private lot: use zero-knowledge dispensing"
    );
  });

  it("only the registered dispenser module can record private dispenses", async function () {
    const { chain, pharm } = await loadFixture(fixture);
    await expect(chain.connect(pharm).recordPrivateDispense("ZK-LOT", pharm.address, ethers.ZeroHash)).to.be.revertedWith("Only the private dispenser");
  });
});
