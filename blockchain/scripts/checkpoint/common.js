/**
 * Shared helpers for public checkpoint anchoring (deploy-anchor / publisher / audit).
 * Plain ethers + JSON-RPC, so the scripts run with `node` and need no Hardhat runtime.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const REPO = path.resolve(__dirname, "../../..");
const CONSORTIUM_DETAILS = path.join(REPO, "backend/src/config/contractDetails.json");
const CHECKPOINT_DETAILS = path.join(REPO, "backend/src/config/checkpointDetails.json");
const VALIDATOR_CONTRACT = "0x0000000000000000000000000000000000009999";

function readJson(file, what) {
  if (!fs.existsSync(file)) throw new Error(`${what} not found at ${file}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const consortiumDetails = () => readJson(CONSORTIUM_DETAILS, "contractDetails.json (deploy the consortium contracts first)");
const checkpointDetails = () => readJson(CHECKPOINT_DETAILS, "checkpointDetails.json (run deploy-anchor.js first)");

function consortiumProvider() {
  const d = consortiumDetails();
  const url = process.env.CONSORTIUM_RPC_URL || d.rpcUrl || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(url, d.chainId, { staticNetwork: true });
}

function publicProvider(cfg = checkpointDetails()) {
  const url = process.env.PUBLIC_RPC_URL || cfg.rpcUrl;
  return new ethers.JsonRpcProvider(url, cfg.publicChainId, { staticNetwork: true });
}

/** keccak256 of the sorted validator list (QBFT RPC first, then the ValidatorSet contract). */
async function validatorSetHash(provider, blockTag = "latest") {
  let list = null;
  try {
    list = await provider.send("qbft_getValidatorsByBlockNumber", [typeof blockTag === "number" ? ethers.toQuantity(blockTag) : blockTag]);
  } catch {
    /* not a QBFT node */
  }
  if (!Array.isArray(list)) {
    try {
      const vs = new ethers.Contract(VALIDATOR_CONTRACT, ["function getValidators() view returns (address[])"], provider);
      list = await vs.getValidators({ blockTag });
    } catch {
      list = [];
    }
  }
  const sorted = list.map((a) => a.toLowerCase()).sort();
  return { hash: ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [sorted])), validators: sorted };
}

module.exports = { REPO, CONSORTIUM_DETAILS, CHECKPOINT_DETAILS, VALIDATOR_CONTRACT, consortiumDetails, checkpointDetails, consortiumProvider, publicProvider, validatorSetHash };
