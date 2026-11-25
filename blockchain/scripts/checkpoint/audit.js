/**
 * Independent audit: anyone with READ access to the public chain and the consortium RPC can run
 * this. For every anchored checkpoint it checks that the consortium chain still has the same block
 * hash and state root at that height, and reports equivocations recorded on the public chain.
 *
 *   node scripts/checkpoint/audit.js
 *
 * Exit code 1 if any checkpoint mismatches or an equivocation exists.
 */
const { ethers } = require("ethers");
const { consortiumDetails, checkpointDetails, consortiumProvider, publicProvider } = require("./common");

async function main() {
  const cfg = checkpointDetails();
  const chainId = consortiumDetails().chainId;
  const priv = consortiumProvider();
  const anchor = new ethers.Contract(cfg.address, cfg.abi, publicProvider(cfg));

  const count = Number(await anchor.checkpointCount(chainId));
  console.log(`Auditing ${count} checkpoint(s) of consortium chain ${chainId} anchored on ${cfg.publicNetwork} (${cfg.address})\n`);
  let failures = 0;
  for (let i = 0; i < count; i++) {
    const height = Number(await anchor.heightAt(chainId, i));
    const cp = await anchor.getCheckpoint(chainId, height);
    const block = await priv.getBlock(height);
    const ok = block && block.hash === cp.blockHash && block.stateRoot === cp.stateRoot;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  #${String(height).padEnd(7)} anchored ${cp.blockHash.slice(0, 18)}...  consortium ${block ? block.hash.slice(0, 18) + "..." : "(missing)"}`
    );
  }
  const eq = Number(await anchor.equivocationCount());
  for (let i = 0; i < eq; i++) {
    const e = await anchor.getEquivocation(i);
    if (Number(e.consortiumChainId) !== chainId) continue;
    failures++;
    console.log(`  EQUIVOCATION at #${e.blockNumber}: anchored ${e.anchoredHash.slice(0, 18)}... vs ${e.conflictingHash.slice(0, 18)}... by ${e.publisher}`);
  }
  console.log(`\n${failures === 0 ? "AUDIT PASSED" : `AUDIT FAILED (${failures} problem(s))`} - ${count} checkpoint(s) checked`);
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
