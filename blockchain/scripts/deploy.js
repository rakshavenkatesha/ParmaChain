const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const SupplyChain = await hre.ethers.getContractFactory("SupplyChain");
  console.log("Deploying SupplyChain contract...");
  const supplyChain = await SupplyChain.deploy();
  await supplyChain.waitForDeployment();
  const contractAddress = await supplyChain.getAddress();

  console.log("SupplyChain contract deployed to:", contractAddress);

  // Read ABI from build artifact
  const artifactPath = path.join(__dirname, "../artifacts/contracts/SupplyChain.sol/SupplyChain.json");
  let contractAbi = [];
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    contractAbi = artifact.abi;
  } else {
    console.warn("Artifact file not found. Make sure to compile first!");
  }

  const details = {
    address: contractAddress,
    abi: contractAbi
  };

  // Directory paths
  const backendConfigDir = path.join(__dirname, "../../backend/src/config");
  const frontendConfigDir = path.join(__dirname, "../../frontend/src/config");

  // Create directories if they do not exist
  if (!fs.existsSync(backendConfigDir)) {
    fs.mkdirSync(backendConfigDir, { recursive: true });
  }
  if (!fs.existsSync(frontendConfigDir)) {
    fs.mkdirSync(frontendConfigDir, { recursive: true });
  }

  // Write details
  fs.writeFileSync(path.join(backendConfigDir, "contractDetails.json"), JSON.stringify(details, null, 2));
  fs.writeFileSync(path.join(frontendConfigDir, "contractDetails.json"), JSON.stringify(details, null, 2));

  console.log("Contract address and ABI exported successfully to backend and frontend folders.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
