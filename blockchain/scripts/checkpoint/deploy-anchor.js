/**
 * Deploys CheckpointAnchor to a PUBLIC chain and writes backend/src/config/checkpointDetails.json.
 *
 *   npx hardhat node --port 8600                                             (local public stand-in)
 *   npx hardhat run scripts/checkpoint/deploy-anchor.js --network publicLocal
 *
 *   # Polygon Amoy (free testnet): get test POL from https://faucet.polygon.technology first
 *   $env:AMOY_RPC_URL="https://rpc-amoy.polygon.technology"; $env:CHECKPOINT_PRIVATE_KEY="0x..."
 *   npx hardhat run scripts/checkpoint/deploy-anchor.js --network amoy
 *
 * Env: CHECKPOINT_INTERVAL (blocks, default 20), CHECKPOINT_PUBLISHERS (extra comma-separated addresses).
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { CHECKPOINT_DETAILS, REPO } = require("./common");

async function main() {
  const { ethers, network } = hre;
  if (network.name === "besu" || network.name === "hardhat") {
    throw new Error("Deploy the anchor to a PUBLIC network: --network publicLocal or --network amoy");
  }
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  // Idempotent: never replace a live anchor (its checkpoints are the audit history).
  if (fs.existsSync(CHECKPOINT_DETAILS) && process.env.REDEPLOY !== "1") {
    const prev = JSON.parse(fs.readFileSync(CHECKPOINT_DETAILS, "utf8"));
    if (prev.publicChainId === chainId && (await ethers.provider.getCode(prev.address)) !== "0x") {
      console.log(`CheckpointAnchor already live at ${prev.address} on '${network.name}' - keeping it (set REDEPLOY=1 to replace).`);
      return;
    }
  }
  console.log(`Deploying CheckpointAnchor to '${network.name}' (chainId ${chainId}) from ${deployer.address}`);

  const anchor = await ethers.deployContract("CheckpointAnchor");
  await anchor.waitForDeployment();
  const address = await anchor.getAddress();
  const rc = await anchor.deploymentTransaction().wait();
  console.log(`  CheckpointAnchor ${address} (block ${rc.blockNumber}, gas ${rc.gasUsed})`);

  for (const extra of (process.env.CHECKPOINT_PUBLISHERS || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    await (await anchor.setPublisher(extra, true)).wait();
    console.log(`  authorised publisher ${extra}`);
  }

  const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "../../artifacts/contracts/checkpoint/CheckpointAnchor.sol/CheckpointAnchor.json"), "utf8")).abi;
  const details = {
    publicNetwork: network.name === "amoy" ? "Polygon Amoy testnet" : `Local public-chain stand-in (${network.name})`,
    networkName: network.name,
    publicChainId: chainId,
    rpcUrl: network.config.url,
    explorerTx: network.name === "amoy" ? "https://amoy.polygonscan.com/tx/" : null,
    address,
    deployBlock: rc.blockNumber,
    publisher: deployer.address,
    interval: Number(process.env.CHECKPOINT_INTERVAL || 20),
    deployedAt: new Date().toISOString(),
    abi
  };
  fs.writeFileSync(CHECKPOINT_DETAILS, JSON.stringify(details, null, 2));
  console.log(`Wrote ${path.relative(REPO, CHECKPOINT_DETAILS)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
