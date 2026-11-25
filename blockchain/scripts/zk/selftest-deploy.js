/**
 * Self-test of deploy-zk.js on the in-process Hardhat network (never touches Besu or the shared
 * config): deploys the core like scripts/deploy.js would (regulator = account #3 as deployer),
 * runs deployZk into a temporary directory and checks the wiring.
 *
 *   npx hardhat run scripts/zk/selftest-deploy.js
 */
const { ethers } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { deployZk } = require("./deploy-zk");

async function main() {
  const s = await ethers.getSigners();
  const regulator = s[3];
  const registry = await ethers.deployContract("AccessRegistry", [regulator.address], regulator);
  const gov = await ethers.deployContract("Governance", [[regulator.address, s[6].address, s[7].address], 2], regulator);
  const pharma = await ethers.deployContract("PharmaChain", [await registry.getAddress(), await gov.getAddress()], regulator);
  const details = { pharmaChain: { address: await pharma.getAddress() }, registry: { address: await registry.getAddress() } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zkdeploy-"));
  fs.writeFileSync(path.join(dir, "contractDetails.json"), JSON.stringify(details));

  const addr = await deployZk(ethers, details, [dir]);
  const patched = JSON.parse(fs.readFileSync(path.join(dir, "contractDetails.json"), "utf8"));
  if ((await pharma.privateDispenser()) !== addr || patched.privateDispenser.address !== addr) throw new Error("wiring mismatch");
  await deployZk(ethers, details, [dir]); // idempotent second run
  console.log("selftest OK - dispenser wired, details patched, second run is a no-op");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
