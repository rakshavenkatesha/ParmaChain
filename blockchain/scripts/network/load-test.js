/**
 * E4 - Throughput & latency of the QBFT consortium network.
 *
 *   npx hardhat run scripts/network/load-test.js --network besu
 *   TX_COUNT=300 npx hardhat run scripts/network/load-test.js --network besu
 *
 * Fires TX_COUNT transactions as fast as possible (pre-assigned nonces) for two workloads:
 *   A) recordTemperature  (~33k gas, the high-volume IoT path)
 *   B) registerBatch      (~355k gas, lot registration incl. strings + Merkle root)
 * and measures submit->receipt latency and sustained throughput. Appends to benchmark-results/.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const TX_COUNT = Number(process.env.TX_COUNT || 200);

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function blast(label, signer, buildTx) {
  const { ethers } = hre;
  const provider = ethers.provider;
  let nonce = await provider.getTransactionCount(signer.address, "pending");
  const startBlock = await provider.getBlockNumber();
  const t0 = Date.now();
  const sent = [];
  for (let i = 0; i < TX_COUNT; i++) {
    const txReq = await buildTx(i);
    const submitted = Date.now();
    const tx = await signer.sendTransaction({ ...txReq, nonce: nonce++, gasLimit: txReq.gasLimit, gasPrice: 0 });
    sent.push({ tx, submitted });
  }
  const submitMs = Date.now() - t0;
  const latencies = [];
  let gas = 0n;
  let lastBlock = startBlock;
  for (const s of sent) {
    const rc = await s.tx.wait();
    latencies.push(Date.now() - s.submitted);
    gas += rc.gasUsed;
    lastBlock = Math.max(lastBlock, rc.blockNumber);
  }
  const totalMs = Date.now() - t0;
  latencies.sort((a, b) => a - b);
  const r = {
    workload: label,
    transactions: TX_COUNT,
    blocksSpanned: lastBlock - startBlock,
    wallClockSec: +(totalMs / 1000).toFixed(2),
    submitPhaseSec: +(submitMs / 1000).toFixed(2),
    throughputTps: +(TX_COUNT / (totalMs / 1000)).toFixed(1),
    latencyMs: { p50: pct(latencies, 50), p95: pct(latencies, 95), max: latencies[latencies.length - 1] },
    avgGas: Number(gas / BigInt(TX_COUNT))
  };
  console.log(JSON.stringify(r));
  return r;
}

async function main() {
  const { ethers, network } = hre;
  const details = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../backend/src/config/contractDetails.json"), "utf8"));
  const [mfr, , , , oracle] = await ethers.getSigners();
  const chain = await ethers.getContractAt("PharmaChain", details.pharmaChain.address);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const tag = Date.now().toString(36).toUpperCase();

  // one target lot for the sensor workload
  await (
    await chain.connect(mfr).registerBatch({
      batchId: `LOAD-${tag}`,
      drugName: "Load test",
      productCode: "LT",
      quantity: 10,
      productionDate: now - 10,
      expiryDate: now + 86400 * 30,
      minTempDeci: -1000,
      maxTempDeci: 1000,
      unitRoot: ethers.id("load")
    })
  ).wait();

  const iface = chain.interface;
  const to = details.pharmaChain.address;

  const a = await blast("recordTemperature (IoT reading)", oracle, async (i) => ({
    to,
    data: iface.encodeFunctionData("recordTemperature", [`LOAD-${tag}`, 40 + (i % 10)]),
    gasLimit: 80000
  }));
  const b = await blast("registerBatch (lot registration)", mfr, async (i) => ({
    to,
    data: iface.encodeFunctionData("registerBatch", [
      {
        batchId: `LOAD-${tag}-${i}`,
        drugName: "Load test drug",
        productCode: "LT-001",
        quantity: 1000,
        productionDate: now - 10,
        expiryDate: now + 86400 * 30,
        minTempDeci: 20,
        maxTempDeci: 80,
        unitRoot: ethers.id(`root-${i}`)
      }
    ]),
    gasLimit: 600000
  }));

  const outDir = path.join(__dirname, "../../benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `network-${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify({ network: network.name, at: new Date().toISOString(), results: [a, b] }, null, 2));
  console.log(`Wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
