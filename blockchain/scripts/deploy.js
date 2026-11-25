/**
 * Deploys the PharmaChain v3 contract system and onboards the demo consortium.
 *
 *   npx hardhat run scripts/deploy.js --network besu        (4-node QBFT network, chainId 2026)
 *   npx hardhat run scripts/deploy.js --network localhost   (Hardhat dev node, chainId 31337)
 *
 * Contracts: AccessRegistry, Governance (2-of-3 regulator officers), PharmaChain,
 *            ColdChainMonitor (+ 3 registered sensor devices). On Besu, control of the genesis
 *            ValidatorSet contract is handed to Governance.
 * Writes contractDetails.json (addresses, ABIs, accounts, sensors) to backend & frontend.
 * Optional modules (ZK dispenser, checkpoint anchor) are added by their own scripts.
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const Role = { Manufacturer: 1, Distributor: 2, Pharmacy: 3, Oracle: 5 };
const VALIDATOR_CONTRACT = "0x0000000000000000000000000000000000009999";
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

/** Sensor device keys: a separate HD branch of the dev mnemonic (devices sign, they never pay gas). */
function sensorWallets(ethers) {
  return [0, 1, 2].map((i) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/1'/0/${i}`));
}

async function main() {
  const { ethers, network } = hre;
  const s = await ethers.getSigners();
  // Account layout (dev mnemonic, pre-funded in the Besu genesis):
  // 0 Manufacturer | 1 Distributor | 2 Pharmacy | 3 Regulator (governance signer 1) | 4 Oracle relayer
  // 5 spare | 6 officer (signer 2) | 7 officer (signer 3)
  const [manufacturer, distributor, pharmacy, regulator, oracle, , officer2, officer3] = s;
  if (!officer3) throw new Error("Need 8 accounts - check the network's account config");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  // SAFETY: new contracts start with an empty ledger. If the current contracts are still live on
  // this chain, keep them (all lots, custody and evidence stay intact). Use `npm run deploy:fresh`
  // (REDEPLOY=1) to deliberately start over.
  const existing = path.join(__dirname, "../../backend/src/config/contractDetails.json");
  if (fs.existsSync(existing) && process.env.REDEPLOY !== "1") {
    const prev = JSON.parse(fs.readFileSync(existing, "utf8"));
    if (prev.chainId === chainId && prev.pharmaChain && (await ethers.provider.getCode(prev.pharmaChain.address)) !== "0x") {
      console.log(`PharmaChain is already deployed at ${prev.pharmaChain.address} on '${network.name}' - keeping it.`);
      console.log("All existing lots, transactions and evidence are preserved. (npm run deploy:fresh replaces the contracts.)");
      return;
    }
  }
  console.log(`Deploying PharmaChain v3 to '${network.name}' (chainId ${chainId})`);

  const deploy = async (name, args) => {
    const c = await (await ethers.getContractFactory(name, regulator)).deploy(...args);
    await c.waitForDeployment();
    console.log(`  ${name.padEnd(18)} ${await c.getAddress()}`);
    return c;
  };

  const registry = await deploy("AccessRegistry", [regulator.address]);
  const deployBlock = (await registry.deploymentTransaction().wait()).blockNumber;
  const governance = await deploy("Governance", [[regulator.address, officer2.address, officer3.address], 2]);
  const pharma = await deploy("PharmaChain", [await registry.getAddress(), await governance.getAddress()]);
  const monitor = await deploy("ColdChainMonitor", [await registry.getAddress(), await pharma.getAddress()]);

  const lic = (x) => ethers.keccak256(ethers.toUtf8Bytes(x));
  const members = [
    [manufacturer.address, Role.Manufacturer, "PharmaMfg Corp", "LIC-MFR-001"],
    [distributor.address, Role.Distributor, "PharmaDist Logistics", "LIC-DST-001"],
    [pharmacy.address, Role.Pharmacy, "CareRx Pharmacy", "LIC-RX-001"],
    [oracle.address, Role.Oracle, "ColdChain IoT Gateway", "IOT-GW-001"],
    [await monitor.getAddress(), Role.Oracle, "ColdChainMonitor contract", "MONITOR-V3"]
  ];
  for (const [addr, role, name, licence] of members) {
    await (await registry.registerParticipant(addr, role, name, lic(licence))).wait();
    console.log(`  onboarded ${name.padEnd(26)} ${addr}`);
  }

  const sensors = sensorWallets(ethers);
  for (const [i, w] of sensors.entries()) {
    await (await monitor.connect(regulator).registerSensor(w.address, `Logger-${i + 1}`)).wait();
  }
  console.log(`  registered 3 sensor devices ${sensors.map((w) => w.address.slice(0, 8)).join(", ")}`);

  // Hand the genesis ValidatorSet to the multisig (Besu only)
  let validatorSet = null;
  if ((await ethers.provider.getCode(VALIDATOR_CONTRACT)) !== "0x") {
    validatorSet = await ethers.getContractAt("ValidatorSet", VALIDATOR_CONTRACT, regulator);
    if ((await validatorSet.controller()) === ethers.ZeroAddress) {
      await (await validatorSet.setController(await governance.getAddress())).wait();
      console.log(`  ValidatorSet ${VALIDATOR_CONTRACT} now controlled by Governance`);
    }
  }

  const abi = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/contracts/${name}.sol/${name}.json`), "utf8")).abi;
  const details = {
    version: 3,
    network: network.name,
    chainId,
    rpcUrl: network.config.url || "http://127.0.0.1:8545",
    deployBlock,
    deployedAt: new Date().toISOString(),
    pharmaChain: { address: await pharma.getAddress(), abi: abi("PharmaChain") },
    registry: { address: await registry.getAddress(), abi: abi("AccessRegistry") },
    governance: { address: await governance.getAddress(), abi: abi("Governance"), threshold: 2 },
    coldChain: { address: await monitor.getAddress(), abi: abi("ColdChainMonitor") },
    validatorSet: validatorSet ? { address: VALIDATOR_CONTRACT, abi: abi("ValidatorSet") } : null,
    sensors: sensors.map((w, i) => ({ label: `Logger-${i + 1}`, address: w.address, hdPath: `m/44'/60'/1'/0/${i}` })),
    accounts: {
      manufacturer: manufacturer.address,
      distributor: distributor.address,
      pharmacy: pharmacy.address,
      regulator: regulator.address,
      oracle: oracle.address,
      officers: [regulator.address, officer2.address, officer3.address]
    }
  };

  for (const dir of ["../../backend/src/config", "../../frontend/src/config"]) {
    const full = path.join(__dirname, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, "contractDetails.json"), JSON.stringify(details, null, 2));
  }
  console.log("contractDetails.json exported to backend and frontend.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
