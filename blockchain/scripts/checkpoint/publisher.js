/**
 * Checkpoint publisher: every N consortium blocks, anchors (blockNumber, blockHash, stateRoot,
 * validatorSetHash) of the private QBFT chain on the public chain.
 *
 *   node scripts/checkpoint/publisher.js                 (runs forever)
 *   node scripts/checkpoint/publisher.js --count 3       (stop after 3 new checkpoints)
 *
 * Reads the consortium READ-ONLY (never sends transactions to it). Restart-safe: it resumes from
 * the latest height already anchored on the public chain.
 *
 * Signer: CHECKPOINT_PRIVATE_KEY (required for Amoy); for the local stand-in it defaults to the
 * dev-mnemonic account #0, the anchor's deployer/owner.
 * Env: CHECKPOINT_INTERVAL (override), POLL_MS (default 3000).
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { consortiumDetails, checkpointDetails, consortiumProvider, publicProvider, validatorSetHash, REPO } = require("./common");

const DEV_MNEMONIC = "test test test test test test test test test test test junk";
const RESULTS = path.join(REPO, "blockchain/benchmark-results/checkpoints.json");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const cfg = checkpointDetails();
  const consortium = consortiumDetails();
  const interval = Number(process.env.CHECKPOINT_INTERVAL || cfg.interval || 20);
  const maxCount = argValue("--count") ? Number(argValue("--count")) : Infinity;
  const pollMs = Number(process.env.POLL_MS || 3000);

  const priv = consortiumProvider();
  const pub = publicProvider(cfg);
  const signer = process.env.CHECKPOINT_PRIVATE_KEY
    ? new ethers.Wallet(process.env.CHECKPOINT_PRIVATE_KEY, pub)
    : ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, "m/44'/60'/0'/0/0").connect(pub);
  const anchor = new ethers.Contract(cfg.address, cfg.abi, signer);
  if (!(await anchor.isPublisher(signer.address))) throw new Error(`${signer.address} is not an authorised publisher on ${cfg.address}`);

  const chainId = consortium.chainId;
  console.log(`Publisher ${signer.address}`);
  console.log(`  consortium chain ${chainId} -> ${cfg.publicNetwork} (${cfg.address}), every ${interval} blocks`);

  const gasLog = [];
  let published = 0;
  while (published < maxCount) {
    try {
      const head = await priv.getBlockNumber();
      const count = Number(await anchor.checkpointCount(chainId));
      const last = count > 0 ? Number(await anchor.heightAt(chainId, count - 1)) : 0;
      const target = Math.floor(head / interval) * interval; // QBFT blocks are final immediately
      if (target > last && target > 0) {
        const block = await priv.getBlock(target);
        const { hash: vHash, validators } = await validatorSetHash(priv, target);
        const tx = await anchor.submitCheckpoint(chainId, target, block.hash, block.stateRoot, vHash);
        const rc = await tx.wait();
        published++;
        gasLog.push(Number(rc.gasUsed));
        console.log(`  anchored #${target} ${block.hash.slice(0, 18)}... (${validators.length} validators) public block ${rc.blockNumber}, gas ${rc.gasUsed}`);
      }
    } catch (e) {
      console.warn(`  waiting: ${e.shortMessage || e.message}`);
    }
    if (published < maxCount) await new Promise((r) => setTimeout(r, pollMs));
  }

  if (gasLog.length) {
    const prev = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : {};
    const all = [...(prev.gasPerCheckpoint || []), ...gasLog];
    const out = {
      publicNetwork: cfg.publicNetwork,
      interval,
      checkpoints: all.length,
      gasPerCheckpoint: all,
      // first anchor for a chain initialises its height list (cold SSTOREs) - report both
      gasFirst: all[0],
      gasSteadyStateAvg: all.length > 1 ? Math.round(all.slice(1).reduce((a, b) => a + b, 0) / (all.length - 1)) : all[0],
      note: "Gas of CheckpointAnchor.submitCheckpoint; on Amoy, cost = gas x gas price (test POL, free from the faucet).",
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, JSON.stringify(out, null, 2));
    console.log(`Gas per checkpoint: first ${out.gasFirst}, steady-state avg ${out.gasSteadyStateAvg} -> ${path.relative(REPO, RESULTS)}`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
