/**
 * E5 - Byzantine fault tolerance of the 4-validator QBFT network (n = 3f + 1, f = 1).
 *
 *   node scripts/network/fault-tolerance.js        (network must be running via docker compose)
 *
 * Phase 1  all 4 validators up            -> blocks every ~2 s
 * Phase 2  stop 1 validator (pharmacy)    -> 3/4 still >= quorum (2f+1 = 3): chain continues
 * Phase 3  stop a 2nd validator           -> 2/4 < quorum: chain HALTS (safety over liveness)
 * Phase 4  restart both                   -> chain resumes, no forks, hash links intact
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const { JsonRpcProvider } = require("ethers");

const COMPOSE_DIR = path.resolve(__dirname, "../../../network");
const RPC = process.env.BESU_RPC_URL || "http://127.0.0.1:8545"; // regulator node, never stopped
const WINDOW_MS = Number(process.env.WINDOW_MS || 12000);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const compose = (args) => execSync(`docker compose ${args}`, { cwd: COMPOSE_DIR, stdio: "pipe" }).toString();

async function observe(provider, label) {
  const start = await provider.getBlockNumber();
  await wait(WINDOW_MS);
  const end = await provider.getBlockNumber();
  const produced = end - start;
  const r = { phase: label, windowSec: WINDOW_MS / 1000, blocksProduced: produced, blocksPerSec: +(produced / (WINDOW_MS / 1000)).toFixed(2) };
  console.log(`${label.padEnd(44)} blocks in ${WINDOW_MS / 1000}s: ${produced}`);
  return r;
}

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const results = [];
  console.log("QBFT fault-tolerance experiment (n=4, f=1, quorum=3)\n");

  results.push(await observe(provider, "1. all 4 validators online"));

  compose("stop pharmacy");
  results.push(await observe(provider, "2. pharmacy validator stopped (3/4)"));

  compose("stop distributor");
  results.push(await observe(provider, "3. distributor also stopped (2/4)"));

  // Recovery: after a halt every validator has escalated its round (timeout doubles per round),
  // so the network must first agree on a common round via ROUND-CHANGE messages.
  const haltedAt = await provider.getBlockNumber();
  const restart = Date.now();
  compose("start distributor pharmacy");
  let recoverySec = null;
  while (Date.now() - restart < 300000) {
    if ((await provider.getBlockNumber()) > haltedAt) {
      recoverySec = +((Date.now() - restart) / 1000).toFixed(1);
      break;
    }
    await wait(1000);
  }
  console.log(`${"4. both restarted - time to first new block".padEnd(44)} ${recoverySec ?? ">300"} s`);
  results.push({ phase: "4. restart -> first new block", recoverySec });
  results.push(await observe(provider, "5. after recovery (4/4)"));

  // safety check: hash links across the whole outage
  const head = await provider.getBlockNumber();
  let prev = await provider.getBlock(Math.max(0, head - 60));
  let intact = true;
  for (let n = prev.number + 1; n <= head; n++) {
    const b = await provider.getBlock(n);
    if (b.parentHash !== prev.hash) intact = false;
    prev = b;
  }
  console.log(`\nHash chain across the outage intact: ${intact}`);

  const out = path.join(__dirname, "../../benchmark-results/fault-tolerance.json");
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), results, hashChainIntact: intact }, null, 2));
  console.log(`Wrote ${out}`);
}

main().catch((e) => {
  console.error(e.message);
  try {
    compose("start distributor pharmacy");
  } catch {
    /* ignore */
  }
  process.exitCode = 1;
});
