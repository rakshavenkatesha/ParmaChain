/**
 * End-to-end v3 scenario on a deployed network (also populates the dApp with data).
 *
 *   npx hardhat run scripts/demo-scenario.js --network besu      (or --network localhost)
 *   LOT_ID=INS-2026-0007 npx hardhat run scripts/demo-scenario.js --network besu
 *
 *  1. Manufacturer registers a 48-pack lot (4 packs/carton, 3 cartons/case -> 4 cases) with
 *     two-part labels and publishes the public commitments to the proof server.
 *  2. Distributor accepts the WHOLE lot by scanning 4 case labels (aggregation proof).
 *  3. Distributor splits off case 3, ships cases 0-2 to the pharmacy (accepted by case scan).
 *  4. Cold chain: 3 device-signed sensors; a faulty sensor is out-voted; a sustained excursion
 *     on the split shipment raises its Mean Kinetic Temperature above 8 degC -> auto-quarantine.
 *  5. Pharmacy: genuine dispense; COPY of a visible label reaches the counter first and FAILS;
 *     the genuine pack still dispenses; a leaked scratch code reused = clone; a diverted pack;
 *     a whole carton in ONE multiproof transaction.
 *  6. Return of an unopened pack, approved by the regulator.
 *  7. Releasing the quarantine needs 2-of-3 regulator officers (Governance multisig).
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const M = require("../lib/unitMerkle");

const API = process.env.API_URL || "http://localhost:5000/api";
const RESULT = ["Dispensed", "InvalidProof (forged / copied label)", "AlreadyDispensed (clone)", "Diverted"];
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

async function main() {
  const { ethers } = hre;
  const details = JSON.parse(fs.readFileSync(path.join(__dirname, "../../backend/src/config/contractDetails.json"), "utf8"));
  const [mfr, dist, pharm, regulator, relayer, , officer2] = await ethers.getSigners();
  const chain = await ethers.getContractAt("PharmaChain", details.pharmaChain.address);
  const monitor = await ethers.getContractAt("ColdChainMonitor", details.coldChain.address);
  const governance = await ethers.getContractAt("Governance", details.governance.address);
  const sensors = [0, 1, 2].map((i) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/1'/0/${i}`));

  const send = async (label, p) => {
    const rc = await (await p).wait();
    console.log(`  [block ${rc.blockNumber}] ${label}  (gas ${rc.gasUsed})`);
    return rc;
  };

  const lotId = process.env.LOT_ID || `INS-${Date.now().toString(36).toUpperCase()}`;
  const childId = `${lotId}-NORTH`;
  const N = 48;
  const PPC = 4;
  const CPC = 3;

  const sig = await mfr.signMessage(`PharmaChain unit-label seed v1\nBatch: ${lotId}`);
  const lot = M.generateLot(lotId, N, ethers.keccak256(sig), PPC, CPC);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const claim = (i, o = {}) => ({ index: i, publicTag: lot.labels[i].publicTag, hiddenCode: lot.labels[i].hiddenCode, ...o });
  const proof = (i) => M.unitProof(lot.hierarchy, i);
  const scans = (a, b) => M.aggregationScans(lot.hierarchy, a, b);

  console.log(`\n== 1. Lot ${lotId}: ${N} packs, ${lot.hierarchy.cartonCount} cartons, ${lot.hierarchy.caseCount} cases`);
  await send(
    "registerBatch (one hierarchical root)",
    chain.connect(mfr).registerBatch({
      batchId: lotId,
      drugName: "Insulin Glargine 100IU/ml",
      productCode: "CDSCO-INS-4471",
      quantity: N,
      productionDate: now - 86400,
      expiryDate: now + 300 * 86400,
      minTempDeci: 20,
      maxTempDeci: 80,
      unitRoot: lot.root,
      packsPerCarton: PPC,
      cartonsPerCase: CPC,
      zkRoot: ethers.ZeroHash
    })
  );
  try {
    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "manufacturer@pharma.com", password: "manufacturer123" })
    }).then((r) => r.json());
    const up = await fetch(`${API}/batches/${lotId}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ leaves: lot.leaves, commitments: lot.commitments })
    }).then((r) => r.json());
    console.log(`  proof server: ${up.message}`);
  } catch {
    console.log("  (backend not reachable - skipped commitment upload)");
  }
  await send("attach 3 signed sensors to the lot", monitor.connect(mfr).assignSensors(lotId, sensors.map((w) => w.address)));

  console.log("\n== 2. Distributor accepts the whole lot by scanning 4 case labels");
  await send("manufacturer -> distributor", chain.connect(mfr).transferOwnership(lotId, dist.address));
  await send(`acceptWithAggregation (${scans(0, N).length} case scans instead of ${N} pack scans)`, chain.connect(dist).acceptWithAggregation(lotId, scans(0, N)));

  console.log("\n== 3. Split off case 3, ship cases 0-2 to the pharmacy");
  await send(`split 12 packs (case 3) into ${childId}`, chain.connect(dist).splitBatch(lotId, childId, 12));
  await send("distributor -> pharmacy", chain.connect(dist).transferOwnership(lotId, pharm.address));
  await send(`pharmacy acceptWithAggregation (${scans(0, 36).length} case scans)`, chain.connect(pharm).acceptWithAggregation(lotId, scans(0, 36)));

  console.log("\n== 4. Cold chain on the split shipment (3 device-signed sensors, MKT)");
  await send("attach sensors to the split shipment", monitor.connect(dist).assignSensors(childId, sensors.map((w) => w.address)));
  const key = M.batchKey(childId);
  let seq = 1;
  const window = async (temps) => {
    const ts = Math.floor(Date.now() / 1000);
    const readings = [];
    for (let i = 0; i < 3; i++) {
      if (temps[i] === null) continue;
      const digest = await monitor.readingDigest(key, seq, temps[i], ts);
      readings.push({ tempDeci: temps[i], timestamp: ts, signature: await sensors[i].signMessage(ethers.getBytes(digest)) });
    }
    const rc = await (await monitor.connect(relayer).submitReadings(childId, seq++, readings)).wait();
    return rc.logs.map((l) => {
      try {
        return monitor.interface.parseLog(l)?.name;
      } catch {
        return null;
      }
    });
  };
  for (const t of [48, 51, 50, 49]) await window([t, t + 1, t - 1]);
  console.log("  4 normal windows accepted (2-of-3 agreement)");
  console.log(`  faulty logger #3 reads 31.0 C -> ${(await window([50, 51, 310])).filter(Boolean).join(", ")}`);
  console.log(`  short 14 C spike -> ${(await window([140, 141, 139])).filter(Boolean).join(", ")} (no quarantine: MKT still in range)`);
  let breached = false;
  let n = 0;
  while (!breached && n < 60) {
    breached = (await window([108, 109, 107])).includes("ColdChainBreach");
    n++;
  }
  const mon = await monitor.getMonitor(childId);
  console.log(`  fridge degrades to ~10.8 C: breach after ${n} more windows, MKT = ${Number(mon.mktDeci) / 10} C -> ${childId} quarantined`);

  console.log("\n== 5. Pharmacy dispensing (two-part labels)");
  const dispense = async (label, i, o = {}) => {
    const r = Number(await chain.connect(pharm).decommissionUnit.staticCall(lotId, claim(i, o), proof(i)));
    await send(`${label}: unit #${i} -> ${RESULT[r]}`, chain.connect(pharm).decommissionUnit(lotId, claim(i, o), proof(i)));
  };
  await dispense("genuine pack", 0);
  await dispense("ATTACK photocopied visible label, guessed scratch code (arrives FIRST)", 5, { hiddenCode: ethers.hexlify(ethers.randomBytes(10)) });
  await dispense("genuine pack #5 afterwards - the genuine pack still wins", 5);
  await dispense("ATTACK leaked scratch code reused after the sale", 0);
  await dispense("ATTACK diverted pack from the split shipment", 40);
  const mp = M.cartonMultiProof(lot.hierarchy, 2, [8, 9, 10, 11]);
  await send(
    "whole carton 2 (packs 8-11) in ONE multiproof transaction",
    chain.connect(pharm).decommissionCarton(lotId, 2, mp.indices.map((i) => claim(i)), mp.multiProof, mp.proofFlags, mp.cartonProof, mp.caseProof)
  );

  console.log("\n== 6. Return of an unopened pack");
  await dispense("genuine pack", 1);
  await send("pharmacy requests return of #1", chain.connect(pharm).requestReturn(lotId, 1, "Unopened - prescription changed"));
  await send("regulator approves the return (bit cleared)", chain.connect(regulator).approveReturn(lotId, 1));

  console.log("\n== 7. Releasing the quarantine needs 2-of-3 officers");
  try {
    await chain.connect(regulator).releaseQuarantine.staticCall(childId);
  } catch (e) {
    console.log(`  regulator alone: REVERTED (${e.reason || e.shortMessage || e.message.slice(0, 90)})`);
  }
  const data = chain.interface.encodeFunctionData("releaseQuarantine", [childId]);
  const rcp = await send("officer 1 proposes release", governance.connect(regulator).propose(details.pharmaChain.address, data, `Release ${childId} after QA inspection`));
  const id = governance.interface.parseLog(rcp.logs.find((l) => l.address.toLowerCase() === details.governance.address.toLowerCase())).args.id;
  await send("officer 2 approves", governance.connect(officer2).approve(id));
  await send("executed by multisig", governance.connect(regulator).execute(id));

  const origin = process.env.FRONTEND_URL || "http://localhost:3000";
  console.log(`\nConsumer view (free eth_call):`);
  for (const i of [0, 7]) {
    const r = await chain.verifyUnit(lotId, i, lot.labels[i].publicTag, lot.commitments[i], proof(i));
    console.log(`  unit #${i}: authentic=${r.authentic} dispensed=${r.dispensed}`);
  }
  console.log(`\nTwo-part labels to try in the dApp (visible link  +  scratch code):`);
  for (const i of [7, 12, 13]) console.log(`  ${origin}/verify?b=${encodeURIComponent(lotId)}&i=${i}&p=${lot.labels[i].publicTag}   ${lot.labels[i].code}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
