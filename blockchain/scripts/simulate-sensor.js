/**
 * Cold-chain simulator: three data loggers that SIGN their readings inside the device, and a
 * relayer (oracle account #4) that submits each sampling window to ColdChainMonitor.
 *
 *   BATCH_ID=INS-2026-0007-NORTH PROFILE=sustained npx hardhat run scripts/simulate-sensor.js --network besu
 *
 * PROFILE
 *   normal     4-6 degC, all three loggers agree                  -> never quarantines
 *   spike      one 14 degC window inside normal traffic           -> no quarantine (MKT stays < 8 degC)
 *   sustained  fridge degrades to ~10.5 degC                      -> quarantine once MKT > max
 *   freeze     product freezes (-1.5 degC)                        -> immediate hard breach
 *   faulty     logger 3 is broken (reads 31 degC)                  -> out-voted 2-of-3, evidence only
 *   malicious  logger 3 reports 20 degC to force a false recall     -> out-voted, no quarantine
 * WINDOWS (default 12), INTERVAL_MS (default 1500)
 * The shipment must already have sensors attached (dApp / demo-scenario), or the current owner's
 * account must be one of the dev accounts so the script can attach them.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEV_MNEMONIC = "test test test test test test test test test test test junk";

function trace(profile, k) {
  const base = 50 + Math.round(Math.sin(k / 2) * 6); // 4.4 - 5.6 degC
  switch (profile) {
    case "spike":
      return k === 4 ? [140, 141, 139] : [base, base + 1, base - 1];
    case "sustained":
      return k < 3 ? [base, base + 1, base - 1] : [105, 106, 104];
    case "freeze":
      return k < 2 ? [base, base + 1, base - 1] : [-15, -14, -16];
    case "faulty":
      return [base, base + 1, 310];
    case "malicious":
      return [base, base + 1, 200];
    default:
      return [base, base + 1, base - 1];
  }
}

async function main() {
  const { ethers } = hre;
  const batchId = process.env.BATCH_ID;
  if (!batchId) throw new Error("Set BATCH_ID=<shipment id>");
  const profile = process.env.PROFILE || "normal";
  const windows = Number(process.env.WINDOWS || 12);
  const interval = Number(process.env.INTERVAL_MS || 1500);

  const details = JSON.parse(fs.readFileSync(path.join(__dirname, "../../backend/src/config/contractDetails.json"), "utf8"));
  const signers = await ethers.getSigners();
  const relayer = signers[4];
  const monitor = await ethers.getContractAt("ColdChainMonitor", details.coldChain.address, relayer);
  const pharma = await ethers.getContractAt("PharmaChain", details.pharmaChain.address);
  const sensors = [0, 1, 2].map((i) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/1'/0/${i}`));

  const v = await pharma.getBatch(batchId);
  let m = await monitor.getMonitor(batchId);
  if (m.sensors[0] === ethers.ZeroAddress) {
    const owner = signers.find((s) => s.address.toLowerCase() === v.batch.currentOwner.toLowerCase());
    if (!owner) throw new Error("No sensors attached and the current owner is not a dev account");
    await (await monitor.connect(owner).assignSensors(batchId, sensors.map((w) => w.address))).wait();
    m = await monitor.getMonitor(batchId);
    console.log("Attached the three loggers to the shipment.");
  }
  const key = await pharma.keyOf(batchId);
  console.log(`Monitoring ${batchId}: range ${Number(v.batch.minTempDeci) / 10}-${Number(v.batch.maxTempDeci) / 10} degC, profile '${profile}'`);

  let seq = Number(m.lastSeq) + 1;
  for (let k = 0; k < windows; k++, seq++) {
    const temps = trace(profile, k);
    const ts = Math.floor(Date.now() / 1000);
    const readings = [];
    for (let i = 0; i < 3; i++) {
      const digest = await monitor.readingDigest(key, seq, temps[i], ts);
      readings.push({ tempDeci: temps[i], timestamp: ts, signature: await sensors[i].signMessage(ethers.getBytes(digest)) });
    }
    const rc = await (await monitor.submitReadings(batchId, seq, readings)).wait();
    const evts = rc.logs
      .map((l) => {
        try {
          return monitor.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const acc = evts.find((e) => e.name === "ReadingAccepted");
    const extra = evts.filter((e) => e.name !== "ReadingAccepted").map((e) => e.name);
    console.log(
      `  #${seq} loggers [${temps.map((t) => (t / 10).toFixed(1)).join(", ")}] degC` +
        (acc ? ` -> agreed ${(Number(acc.args.agreedDeci) / 10).toFixed(1)}  MKT ${(Number(acc.args.mktDeci) / 10).toFixed(1)}` : " -> no agreement") +
        (extra.length ? `  [${extra.join(", ")}]` : "") +
        `  block ${rc.blockNumber}`
    );
    if (extra.includes("ColdChainBreach")) {
      console.log("  Shipment quarantined on-chain. Releasing it requires the Governance multisig.");
      break;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
