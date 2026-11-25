/**
 * Adds the zero-knowledge dispensing module to an EXISTING PharmaChain v3 deployment.
 *
 *   npx hardhat run scripts/zk/deploy-zk.js --network besu
 *
 * 1. reads backend/src/config/contractDetails.json (written by scripts/deploy.js)
 * 2. deploys Groth16Verifier + PrivateDispenser
 * 3. PharmaChain.setPrivateDispenser(dispenser)   - one-time, signed by PharmaChain's deployer
 * 4. patches BOTH contractDetails.json copies with privateDispenser {address, abi}
 *
 * Env: DETAILS_DIRS - comma-separated directories to patch (default backend + frontend config).
 * Prerequisite: node scripts/zk/build.js (circuit + verifier) and npx hardhat compile.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const DEFAULT_DIRS = [path.join(__dirname, "../../../backend/src/config"), path.join(__dirname, "../../../frontend/src/config")];

async function deployZk(ethers, details, dirs) {
  const pharma = await ethers.getContractAt("PharmaChain", details.pharmaChain.address);
  const deployerAddr = (await pharma.deployer()).toLowerCase();
  const signer = (await ethers.getSigners()).find((s) => s.address.toLowerCase() === deployerAddr);
  if (!signer) throw new Error(`No configured account matches PharmaChain's deployer ${deployerAddr}`);

  const current = await pharma.privateDispenser();
  if (current !== ethers.ZeroAddress) {
    console.log(`PharmaChain already has a private dispenser at ${current} - nothing to do.`);
    return current;
  }

  const verifier = await (await ethers.getContractFactory("Groth16Verifier", signer)).deploy();
  await verifier.waitForDeployment();
  const dispenser = await (await ethers.getContractFactory("PrivateDispenser", signer)).deploy(details.pharmaChain.address, details.registry.address, await verifier.getAddress());
  await dispenser.waitForDeployment();
  await (await pharma.connect(signer).setPrivateDispenser(await dispenser.getAddress())).wait();
  console.log(`  Groth16Verifier   ${await verifier.getAddress()}`);
  console.log(`  PrivateDispenser  ${await dispenser.getAddress()}  (wired into PharmaChain)`);

  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/zk/PrivateDispenser.sol/PrivateDispenser.json"), "utf8")).abi;
  const patched = { ...details, privateDispenser: { address: await dispenser.getAddress(), abi, verifier: await verifier.getAddress() } };
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "contractDetails.json"), JSON.stringify(patched, null, 2));
    console.log(`  patched ${path.join(dir, "contractDetails.json")}`);
  }
  return dispenser.getAddress();
}

async function main() {
  const dirs = process.env.DETAILS_DIRS ? process.env.DETAILS_DIRS.split(",") : DEFAULT_DIRS;
  const details = JSON.parse(fs.readFileSync(path.join(dirs[0], "contractDetails.json"), "utf8"));
  console.log(`Adding ZK module to PharmaChain ${details.pharmaChain.address} on '${hre.network.name}'`);
  await deployZk(hre.ethers, details, dirs);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

module.exports = { deployZk };
