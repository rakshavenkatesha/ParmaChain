const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const M = require("../lib/unitMerkle");

const Role = { None: 0, Manufacturer: 1, Distributor: 2, Pharmacy: 3, Regulator: 4, Oracle: 5 };
const Status = { None: 0, Manufactured: 1, InTransit: 2, Received: 3, Depleted: 4, Quarantined: 5, Recalled: 6 };
const Dispense = { Dispensed: 0, InvalidProof: 1, AlreadyDispensed: 2, Diverted: 3 };
const DAY = 24 * 60 * 60;

async function deployFixture() {
  const s = await ethers.getSigners();
  const [mfr, dist, pharm, regulator, oracle, outsider, dist2, pharm2, officer2, officer3] = s;

  const registry = await ethers.deployContract("AccessRegistry", [regulator.address]);
  const governance = await ethers.deployContract("Governance", [[regulator.address, officer2.address, officer3.address], 2]);
  const chain = await ethers.deployContract("PharmaChain", [await registry.getAddress(), await governance.getAddress()]);
  const monitor = await ethers.deployContract("ColdChainMonitor", [await registry.getAddress(), await chain.getAddress()]);

  const lic = (x) => ethers.keccak256(ethers.toUtf8Bytes(x));
  const r = registry.connect(regulator);
  await r.registerParticipant(mfr.address, Role.Manufacturer, "PharmaMfg", lic("LIC-MFR-001"));
  await r.registerParticipant(dist.address, Role.Distributor, "PharmaDist", lic("LIC-DST-001"));
  await r.registerParticipant(dist2.address, Role.Distributor, "SubDist", lic("LIC-DST-002"));
  await r.registerParticipant(pharm.address, Role.Pharmacy, "CareRx", lic("LIC-RX-001"));
  await r.registerParticipant(pharm2.address, Role.Pharmacy, "OtherRx", lic("LIC-RX-002"));
  await r.registerParticipant(oracle.address, Role.Oracle, "ColdChain IoT GW", lic("IOT-001"));
  await r.registerParticipant(await monitor.getAddress(), Role.Oracle, "ColdChainMonitor", lic("MONITOR"));

  const sensors = [0, 1, 2].map(() => ethers.Wallet.createRandom());
  for (const [i, w] of sensors.entries()) await monitor.connect(regulator).registerSensor(w.address, `sensor-${i}`);

  return { registry, governance, chain, monitor, sensors, mfr, dist, pharm, regulator, oracle, outsider, dist2, pharm2, officer2, officer3 };
}

async function registerLot(chain, signer, batchId, quantity, opts = {}) {
  const ppc = opts.ppc ?? 4;
  const cpc = opts.cpc ?? 3;
  const lot = M.generateLot(batchId, quantity, ethers.hexlify(ethers.randomBytes(32)), ppc, cpc);
  const now = await time.latest();
  await chain.connect(signer).registerBatch({
    batchId,
    drugName: "Insulin Glargine",
    productCode: "PC-INS-100",
    quantity,
    productionDate: now - DAY,
    expiryDate: opts.expiryDate ?? now + 365 * DAY,
    minTempDeci: 20,
    maxTempDeci: 80,
    unitRoot: opts.unitRoot ?? lot.root,
    packsPerCarton: ppc,
    cartonsPerCase: cpc,
    zkRoot: ethers.ZeroHash
  });
  return lot;
}

const claimOf = (lot, i, overrides = {}) => ({ index: i, publicTag: lot.labels[i].publicTag, hiddenCode: lot.labels[i].hiddenCode, ...overrides });
const proofOf = (lot, i) => M.unitProof(lot.hierarchy, i);
const unitArgs = (lot, i, overrides) => [claimOf(lot, i, overrides), proofOf(lot, i)];

async function ship(chain, from, to, id) {
  await chain.connect(from).transferOwnership(id, to.address);
  await chain.connect(to).acceptShipment(id);
}

// ============================================================================================
describe("AccessRegistry", function () {
  it("only the regulator can admit participants", async function () {
    const { registry, outsider, mfr } = await loadFixture(deployFixture);
    await expect(registry.connect(mfr).registerParticipant(outsider.address, Role.Pharmacy, "X", ethers.ZeroHash)).to.be.reverted;
  });

  it("records roles, verifies licence hashes and suspends", async function () {
    const { registry, chain, regulator, mfr, outsider } = await loadFixture(deployFixture);
    expect(await registry.activeRoleOf(mfr.address)).to.equal(Role.Manufacturer);
    expect(await registry.activeRoleOf(outsider.address)).to.equal(Role.None);
    expect(await registry.verifyLicense(mfr.address, "LIC-MFR-001")).to.equal(true);
    await registry.connect(regulator).suspendParticipant(mfr.address, "Licence revoked");
    await expect(registerLot(chain, mfr, "LOT-S", 8)).to.be.revertedWith("Unauthorised role");
  });
});

describe("Registration & route policy", function () {
  it("only an active manufacturer registers; packaging must be valid", async function () {
    const { chain, mfr, outsider } = await loadFixture(deployFixture);
    await expect(registerLot(chain, outsider, "L1", 10)).to.be.revertedWith("Unauthorised role");
    const now = await time.latest();
    const bad = { batchId: "L0", drugName: "X", productCode: "Y", quantity: 10, productionDate: now - DAY, expiryDate: now + DAY * 30, minTempDeci: 20, maxTempDeci: 80, unitRoot: ethers.id("r"), packsPerCarton: 6, cartonsPerCase: 2, zkRoot: ethers.ZeroHash };
    await expect(chain.connect(mfr).registerBatch(bad)).to.be.revertedWith("packsPerCarton must be a power of two <= 256");
    const lot = await registerLot(chain, mfr, "L1", 10);
    const v = await chain.getBatch("L1");
    expect(v.batch.unitRoot).to.equal(lot.root);
    expect(v.batch.lotSize).to.equal(10);
  });

  it("enforces Manufacturer -> Distributor -> Pharmacy and the two-phase handshake", async function () {
    const { chain, mfr, dist, pharm, outsider } = await loadFixture(deployFixture);
    await registerLot(chain, mfr, "L-R", 8);
    await expect(chain.connect(mfr).transferOwnership("L-R", pharm.address)).to.be.revertedWith("Route not permitted by supply-chain policy");
    await chain.connect(mfr).transferOwnership("L-R", dist.address);
    expect((await chain.getBatch("L-R")).batch.currentOwner).to.equal(mfr.address);
    await expect(chain.connect(outsider).acceptShipment("L-R")).to.be.revertedWith("Caller is not the designated recipient");
    await chain.connect(dist).acceptShipment("L-R");
    await ship(chain, dist, pharm, "L-R");
    const [custody] = await chain.getBatchHistory("L-R");
    expect(custody).to.deep.equal([mfr.address, dist.address, pharm.address]);
  });

  it("expired batches cannot move", async function () {
    const { chain, mfr, dist } = await loadFixture(deployFixture);
    const now = await time.latest();
    await registerLot(chain, mfr, "L-E", 8, { expiryDate: now + 10 * DAY });
    await time.increase(11 * DAY);
    await expect(chain.connect(mfr).transferOwnership("L-E", dist.address)).to.be.revertedWith("Batch has expired");
  });

  it("splits conserve quantity with disjoint ranges", async function () {
    const { chain, mfr, dist } = await loadFixture(deployFixture);
    await registerLot(chain, mfr, "L-Q", 100);
    await ship(chain, mfr, dist, "L-Q");
    await chain.connect(dist).splitBatch("L-Q", "L-Q-A", 30);
    await chain.connect(dist).splitBatch("L-Q", "L-Q-B", 25);
    const [p, a, b] = await Promise.all(["L-Q", "L-Q-A", "L-Q-B"].map((x) => chain.getBatch(x)));
    expect([p.batch.unitStart, p.batch.unitEnd, a.batch.unitStart, a.batch.unitEnd, b.batch.unitStart, b.batch.unitEnd]).to.deep.equal([0n, 45n, 70n, 100n, 45n, 70n]);
    expect(p.quantity + a.quantity + b.quantity).to.equal(100n);
  });
});

// ============================================================================================
describe("Two-part labels (visible QR + hidden scratch code)", function () {
  async function shelf() {
    const ctx = await deployFixture();
    const { chain, mfr, dist, pharm, pharm2 } = ctx;
    const lot = await registerLot(chain, mfr, "LOT-U", 24, { ppc: 4, cpc: 3 }); // cases of 12
    await ship(chain, mfr, dist, "LOT-U");
    await chain.connect(dist).splitBatch("LOT-U", "LOT-U/P2", 12); // units 12..23
    await ship(chain, dist, pharm, "LOT-U"); // units 0..11
    await ship(chain, dist, pharm2, "LOT-U/P2");
    return { ...ctx, lot };
  }

  it("JS library matches the Solidity encodings", async function () {
    const { chain, lot } = await loadFixture(shelf);
    const l = lot.labels[3];
    const cm = await chain.hiddenCommitment(lot.originKey, 3, l.hiddenCode);
    expect(cm).to.equal(lot.commitments[3]);
    expect(await chain.packLeaf(lot.originKey, 3, l.publicTag, cm)).to.equal(lot.leaves[3]);
    expect(M.decodeCode(l.code)).to.equal(l.hiddenCode.toLowerCase());
  });

  it("dispenses a genuine pack exactly once", async function () {
    const { chain, pharm, lot } = await loadFixture(shelf);
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 4))).to.emit(chain, "UnitDispensed");
    expect(await chain.isDispensed(lot.originKey, 4)).to.equal(true);
    expect((await chain.getBatch("LOT-U")).remaining).to.equal(11);
  });

  it("a copy of the VISIBLE label cannot be dispensed - even if it reaches the pharmacy first", async function () {
    const { chain, pharm, lot } = await loadFixture(shelf);
    // counterfeiter photographed the visible QR but never saw the hidden scratch code
    const guessed = ethers.hexlify(ethers.randomBytes(10));
    expect(await chain.connect(pharm).decommissionUnit.staticCall("LOT-U", ...unitArgs(lot, 5, { hiddenCode: guessed }))).to.equal(Dispense.InvalidProof);
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 5, { hiddenCode: guessed }))).to.emit(chain, "CounterfeitDetected");
    // ...and the genuine pack still dispenses afterwards: the genuine pack always wins
    expect(await chain.connect(pharm).decommissionUnit.staticCall("LOT-U", ...unitArgs(lot, 5))).to.equal(Dispense.Dispensed);
  });

  it("a leaked scratch code reused after the genuine sale is a clone", async function () {
    const { chain, pharm, pharm2, lot } = await loadFixture(shelf);
    await chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 2));
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 2))).to.emit(chain, "CloneDetected");
    await expect(chain.connect(pharm2).decommissionUnit("LOT-U/P2", ...unitArgs(lot, 2))).to.emit(chain, "CloneDetected");
  });

  it("forged visible tags and out-of-lot indices are counterfeit", async function () {
    const { chain, pharm, lot } = await loadFixture(shelf);
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 1, { publicTag: ethers.ZeroHash }))).to.emit(chain, "CounterfeitDetected");
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", { index: 999, publicTag: lot.labels[1].publicTag, hiddenCode: lot.labels[1].hiddenCode }, proofOf(lot, 1))).to.emit(
      chain,
      "CounterfeitDetected"
    );
  });

  it("genuine pack from another shipment is diversion", async function () {
    const { chain, pharm, lot } = await loadFixture(shelf);
    await expect(chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 15))).to.emit(chain, "DiversionDetected");
  });

  it("consumers verify the visible label for free (with the public commitment)", async function () {
    const { chain, pharm, lot } = await loadFixture(shelf);
    let r = await chain.verifyUnit("LOT-U", 7, lot.labels[7].publicTag, lot.commitments[7], proofOf(lot, 7));
    expect([r.authentic, r.dispensed]).to.deep.equal([true, false]);
    await chain.connect(pharm).decommissionUnit("LOT-U", ...unitArgs(lot, 7));
    r = await chain.verifyUnit("LOT-U", 7, lot.labels[7].publicTag, lot.commitments[7], proofOf(lot, 7));
    expect(r.dispensed).to.equal(true);
    r = await chain.verifyUnit("LOT-U", 7, ethers.ZeroHash, lot.commitments[7], proofOf(lot, 7));
    expect(r.authentic).to.equal(false);
  });

  it("every pack of awkward lot shapes verifies (padding + promotion)", async function () {
    const { chain, mfr } = await loadFixture(deployFixture);
    for (const [n, ppc, cpc] of [[1, 1, 1], [3, 2, 1], [7, 4, 3], [33, 8, 2], [50, 4, 5]]) {
      const id = `ODD-${n}-${ppc}-${cpc}`;
      const lot = await registerLot(chain, mfr, id, n, { ppc, cpc });
      for (let i = 0; i < n; i++) {
        const r = await chain.verifyUnit(id, i, lot.labels[i].publicTag, lot.commitments[i], proofOf(lot, i));
        expect(r.authentic, `${id} #${i}`).to.equal(true);
      }
    }
  });
});

// ============================================================================================
describe("Packaging hierarchy & aggregation", function () {
  it("a distributor accepts a whole lot by scanning case labels", async function () {
    const { chain, mfr, dist } = await loadFixture(deployFixture);
    const lot = await registerLot(chain, mfr, "AGG", 30, { ppc: 4, cpc: 3 }); // 3 cases (12, 12, 6)
    await chain.connect(mfr).transferOwnership("AGG", dist.address);
    const scans = M.aggregationScans(lot.hierarchy, 0, 30);
    expect(scans.map((s) => s.level)).to.deep.equal([2, 2, 2]);
    await expect(chain.connect(dist).acceptWithAggregation("AGG", scans)).to.emit(chain, "AggregationVerified").withArgs(M.batchKey("AGG"), "AGG", 3, 0, 30);
    expect((await chain.getBatch("AGG")).effectiveStatus).to.equal(Status.Received);
  });

  it("missing a case, re-ordering, or scanning another lot's case is rejected", async function () {
    const { chain, mfr, dist } = await loadFixture(deployFixture);
    const lot = await registerLot(chain, mfr, "AGG", 30, { ppc: 4, cpc: 3 });
    const other = await registerLot(chain, mfr, "OTHER", 30, { ppc: 4, cpc: 3 });
    await chain.connect(mfr).transferOwnership("AGG", dist.address);
    const scans = M.aggregationScans(lot.hierarchy, 0, 30);
    await expect(chain.connect(dist).acceptWithAggregation("AGG", scans.slice(0, 2))).to.be.revertedWith("Scans do not cover the shipment exactly");
    await expect(chain.connect(dist).acceptWithAggregation("AGG", [scans[1], scans[0], scans[2]])).to.be.revertedWith("Scans must be contiguous and in order");
    const foreign = M.aggregationScans(other.hierarchy, 0, 30);
    await expect(chain.connect(dist).acceptWithAggregation("AGG", foreign)).to.be.revertedWith("Aggregate label not part of this lot");
  });

  it("a carton-aligned split shipment is accepted by scanning cartons and cases", async function () {
    const { chain, mfr, dist, pharm } = await loadFixture(deployFixture);
    const lot = await registerLot(chain, mfr, "AGG", 30, { ppc: 4, cpc: 3 });
    await ship(chain, mfr, dist, "AGG");
    await chain.connect(dist).splitBatch("AGG", "AGG-B", 10); // units 20..29: carton 5 + case 2 (24..29)
    await chain.connect(dist).transferOwnership("AGG-B", pharm.address);
    const scans = M.aggregationScans(lot.hierarchy, 20, 30);
    expect(scans.map((s) => [s.level, s.index])).to.deep.equal([[1, 5], [2, 2]]);
    await chain.connect(pharm).acceptWithAggregation("AGG-B", scans);
    expect((await chain.getBatch("AGG-B")).batch.currentOwner).to.equal(pharm.address);
  });
});

// ============================================================================================
describe("Multiproof carton dispensing", function () {
  async function onShelf() {
    const ctx = await deployFixture();
    const lot = await registerLot(ctx.chain, ctx.mfr, "MP", 32, { ppc: 16, cpc: 2 });
    await ship(ctx.chain, ctx.mfr, ctx.dist, "MP");
    await ship(ctx.chain, ctx.dist, ctx.pharm, "MP");
    return { ...ctx, lot };
  }
  const batchArgs = (lot, carton, indices) => {
    const mp = M.cartonMultiProof(lot.hierarchy, carton, indices);
    return ["MP", carton, mp.indices.map((i) => claimOf(lot, i)), mp.multiProof, mp.proofFlags, mp.cartonProof, mp.caseProof];
  };

  it("JS multiproof reproduces the carton root", async function () {
    const { lot } = await loadFixture(onShelf);
    const mp = M.cartonMultiProof(lot.hierarchy, 1, [17, 20, 21, 30]);
    const leaves = mp.indices.map((i) => lot.leaves[i]);
    expect(M.processMultiProof(mp.multiProof, mp.proofFlags, leaves)).to.equal(lot.hierarchy.cartonRoots[1]);
  });

  it("dispenses many packs in one transaction", async function () {
    const { chain, pharm, lot } = await loadFixture(onShelf);
    await expect(chain.connect(pharm).decommissionCarton(...batchArgs(lot, 0, [0, 1, 2, 5, 9, 15]))).to.emit(chain, "CartonDispensed").withArgs(M.batchKey("MP"), 0, 6, (x) => x > 0n);
    for (const i of [0, 1, 2, 5, 9, 15]) expect(await chain.isDispensed(lot.originKey, i)).to.equal(true);
    expect((await chain.getBatch("MP")).remaining).to.equal(26);
  });

  it("records clones inside a batch and skips them", async function () {
    const { chain, pharm, lot } = await loadFixture(onShelf);
    await chain.connect(pharm).decommissionUnit("MP", ...unitArgs(lot, 3));
    const tx = chain.connect(pharm).decommissionCarton(...batchArgs(lot, 0, [2, 3, 4]));
    await expect(tx).to.emit(chain, "CloneDetected");
    expect((await chain.getBatch("MP")).remaining).to.equal(29);
  });

  it("a whole carton empties the shipment state correctly; bad proofs revert", async function () {
    const { chain, pharm, lot } = await loadFixture(onShelf);
    const args = batchArgs(lot, 1, [16, 17, 18]);
    args[2] = args[2].map((c, k) => (k === 1 ? { ...c, hiddenCode: "0x00000000000000000000" } : c));
    await expect(chain.connect(pharm).decommissionCarton(...args)).to.be.revertedWith("Invalid carton multiproof");
    await chain.connect(pharm).decommissionCarton(...batchArgs(lot, 0, [...Array(16).keys()]));
    await chain.connect(pharm).decommissionCarton(...batchArgs(lot, 1, [...Array(16).keys()].map((i) => i + 16)));
    expect((await chain.getBatch("MP")).effectiveStatus).to.equal(Status.Depleted);
  });
});

// ============================================================================================
describe("Returns of unopened packs", function () {
  it("regulator-approved return clears the bit and restocks the shelf", async function () {
    const { chain, mfr, dist, pharm, regulator, outsider } = await loadFixture(deployFixture);
    const lot = await registerLot(chain, mfr, "RET", 2, { ppc: 2, cpc: 1 });
    await ship(chain, mfr, dist, "RET");
    await ship(chain, dist, pharm, "RET");
    await chain.connect(pharm).decommissionUnit("RET", ...unitArgs(lot, 0));
    await chain.connect(pharm).decommissionUnit("RET", ...unitArgs(lot, 1));
    expect((await chain.getBatch("RET")).effectiveStatus).to.equal(Status.Depleted);

    await expect(chain.connect(pharm).requestReturn("RET", 1, "Unopened, patient changed therapy")).to.emit(chain, "ReturnRequested");
    await expect(chain.connect(outsider).approveReturn("RET", 1)).to.be.revertedWith("Unauthorised role");
    await expect(chain.connect(regulator).approveReturn("RET", 1)).to.emit(chain, "UnitReturned");
    expect(await chain.isDispensed(lot.originKey, 1)).to.equal(false);
    expect((await chain.getBatch("RET")).effectiveStatus).to.equal(Status.Received);
    await expect(chain.connect(pharm).decommissionUnit("RET", ...unitArgs(lot, 1))).to.emit(chain, "UnitDispensed");
  });

  it("cannot return a pack that was never dispensed", async function () {
    const { chain, mfr, dist, pharm } = await loadFixture(deployFixture);
    await registerLot(chain, mfr, "RET", 2, { ppc: 2, cpc: 1 });
    await ship(chain, mfr, dist, "RET");
    await ship(chain, dist, pharm, "RET");
    await expect(chain.connect(pharm).requestReturn("RET", 0, "x")).to.be.revertedWith("Unit was never dispensed");
  });
});

// ============================================================================================
describe("Governance multisig", function () {
  it("regulator recall and quarantine release need 2-of-3 officers", async function () {
    const { chain, governance, mfr, dist, regulator, officer2 } = await loadFixture(deployFixture);
    await registerLot(chain, mfr, "GOV", 8);
    await chain.connect(mfr).transferOwnership("GOV", dist.address);
    await chain.connect(regulator).quarantineBatch("GOV", "Inspection");

    // a single regulator key can no longer release or recall
    await expect(chain.connect(regulator).releaseQuarantine("GOV")).to.be.revertedWith("Only governance multisig");
    await expect(chain.connect(regulator).recallBatch("GOV", "x")).to.be.revertedWith("Only manufacturer or governance multisig");

    const data = chain.interface.encodeFunctionData("releaseQuarantine", ["GOV"]);
    await governance.connect(regulator).propose(await chain.getAddress(), data, "Release after inspection");
    await expect(governance.execute(0)).to.be.revertedWith("Not enough approvals");
    await governance.connect(officer2).approve(0);
    await expect(governance.execute(0)).to.emit(chain, "QuarantineReleased");
    await expect(governance.execute(0)).to.be.revertedWith("Proposal closed");

    const recall = chain.interface.encodeFunctionData("recallBatch", ["GOV", "Regulatory order"]);
    await governance.connect(officer2).propose(await chain.getAddress(), recall, "Recall GOV");
    await governance.connect(regulator).approve(1);
    await governance.execute(1);
    expect((await chain.getBatch("GOV")).effectiveStatus).to.equal(Status.Recalled);
  });

  it("only signers propose/approve and each signer approves once", async function () {
    const { governance, chain, regulator, outsider } = await loadFixture(deployFixture);
    await expect(governance.connect(outsider).propose(await chain.getAddress(), "0x", "x")).to.be.revertedWith("Not a governance signer");
    await governance.connect(regulator).propose(await chain.getAddress(), "0x", "x");
    await expect(governance.connect(regulator).approve(0)).to.be.revertedWith("Already approved");
  });

  it("the QBFT validator set changes only through governance", async function () {
    const { governance, regulator, officer2, outsider } = await loadFixture(deployFixture);
    const initial = [ethers.Wallet.createRandom().address, ethers.Wallet.createRandom().address];
    const vs = await ethers.deployContract("ValidatorSet", [initial, regulator.address]);
    await vs.connect(regulator).setController(await governance.getAddress());
    await expect(vs.connect(regulator).setController(outsider.address)).to.be.revertedWith("Only bootstrap owner");
    await expect(vs.connect(regulator).addValidator(outsider.address)).to.be.revertedWith("Only governance");

    const add = vs.interface.encodeFunctionData("addValidator", [outsider.address]);
    await governance.connect(regulator).propose(await vs.getAddress(), add, "Admit new validator");
    await governance.connect(officer2).approve(0);
    await governance.execute(0);
    expect(await vs.getValidators()).to.deep.equal([...initial, outsider.address]);
  });
});

// ============================================================================================
describe("Cold chain: 2-of-3 signed sensors + Mean Kinetic Temperature", function () {
  /** Reference MKT in JS (USP <1079>, dH/R = 10,000 K). */
  const mktRef = (tempsC) => {
    const H = 10000;
    const s = tempsC.reduce((a, t) => a + Math.exp(-H / (t + 273.15)), 0) / tempsC.length;
    return H / -Math.log(s) - 273.15;
  };

  async function monitored() {
    const ctx = await deployFixture();
    await registerLot(ctx.chain, ctx.mfr, "CC", 8);
    await ctx.monitor.connect(ctx.mfr).assignSensors("CC", ctx.sensors.map((w) => w.address));
    await ctx.chain.connect(ctx.mfr).transferOwnership("CC", ctx.dist.address);
    return ctx;
  }

  let seqCounter = 0;
  async function window(monitor, sensors, temps, seq) {
    const key = M.batchKey("CC");
    const ts = 1_700_000_000 + seq * 600;
    const readings = [];
    for (let i = 0; i < sensors.length; i++) {
      if (temps[i] === null) continue;
      const digest = await monitor.readingDigest(key, seq, temps[i], ts);
      readings.push({ tempDeci: temps[i], timestamp: ts, signature: await sensors[i].signMessage(ethers.getBytes(digest)) });
    }
    return monitor.submitReadings("CC", seq, readings);
  }

  it("on-chain MKT matches the reference formula", async function () {
    const { monitor } = await loadFixture(monitored);
    const series = [50, 52, 48, 120, 55, 60, 45, 40];
    const onChain = Number(await monitor.mktOf(series)) / 10;
    expect(onChain).to.be.closeTo(mktRef(series.map((x) => x / 10)), 0.11);
  });

  it("needs two agreeing signatures; outliers and disagreements are evidence", async function () {
    const { monitor, sensors, outsider } = await loadFixture(monitored);
    await expect(window(monitor, sensors, [50, 51, 49], 1)).to.emit(monitor, "ReadingAccepted");
    await expect(window(monitor, sensors, [50, 52, 300], 2)).to.emit(monitor, "SensorOutlier"); // faulty 3rd sensor
    await expect(window(monitor, sensors, [50, null, null], 3)).to.be.revertedWith("Need at least 2 valid sensor signatures");
    await expect(window(monitor, sensors, [50, 90, null], 4)).to.emit(monitor, "SensorDisagreement");
    await expect(window(monitor, sensors, [50, 51, 49], 4)).to.be.revertedWith("Stale or replayed sequence");
    // a non-sensor key cannot vote
    const fake = [sensors[0], ethers.Wallet.createRandom(), ethers.Wallet.createRandom()];
    await expect(window(monitor, fake, [50, 51, 49], 5)).to.be.revertedWith("Need at least 2 valid sensor signatures");
  });

  it("a short spike does NOT quarantine, a sustained mild excursion DOES", async function () {
    const { chain, monitor, sensors } = await loadFixture(monitored);
    let seq = 1;
    for (const t of [50, 50, 50, 50, 50, 50, 50, 50, 50]) await window(monitor, sensors, [t, t, t], seq++);
    await window(monitor, sensors, [150, 151, 149], seq++); // one 15 degC spike (below the hard limit)
    expect((await chain.getBatch("CC")).effectiveStatus).to.equal(Status.InTransit);
    // the truck fridge degrades: 10-11 degC for many hours
    let breached = false;
    for (let k = 0; k < 40 && !breached; k++) {
      const tx = await window(monitor, sensors, [105, 106, 104], seq++);
      const rc = await tx.wait();
      breached = rc.logs.some((l) => l.fragment && l.fragment.name === "ColdChainBreach");
    }
    expect(breached).to.equal(true);
    expect((await chain.getBatch("CC")).effectiveStatus).to.equal(Status.Quarantined);
  });

  it("freezing triggers an immediate hard breach", async function () {
    const { chain, monitor, sensors } = await loadFixture(monitored);
    await expect(window(monitor, sensors, [-15, -14, -16], 1)).to.emit(monitor, "ColdChainBreach");
    expect((await chain.getBatch("CC")).effectiveStatus).to.equal(Status.Quarantined);
  });
});

describe("Recall propagation", function () {
  it("a manufacturer recall freezes every shipment of the lot", async function () {
    const { chain, mfr, dist } = await loadFixture(deployFixture);
    await registerLot(chain, mfr, "RC", 20);
    await ship(chain, mfr, dist, "RC");
    await chain.connect(dist).splitBatch("RC", "RC-1", 4);
    await chain.connect(mfr).recallBatch("RC", "Contamination");
    expect((await chain.getBatch("RC-1")).effectiveStatus).to.equal(Status.Recalled);
    await expect(chain.connect(dist).splitBatch("RC-1", "X", 2)).to.be.revertedWith("Batch lot is recalled");
  });
});
