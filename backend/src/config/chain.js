/**
 * Read-only blockchain connection shared by the indexer, proof server and explorer.
 * The backend NEVER holds a private key: every state change is signed by the user's wallet.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const DETAILS_PATH = path.join(__dirname, "contractDetails.json");

const STATUS_NAMES = ["None", "Manufactured", "In Transit", "Received", "Depleted", "Quarantined", "Recalled"];
const ROLE_NAMES = ["None", "Manufacturer", "Distributor", "Pharmacy", "Regulator", "Oracle"];
const ROLE_IDS = { Manufacturer: 1, Distributor: 2, Pharmacy: 3, Admin: 4, Regulator: 4, Oracle: 5 };

let cached = null;

function loadDetails() {
  if (!fs.existsSync(DETAILS_PATH)) return null;
  return JSON.parse(fs.readFileSync(DETAILS_PATH, "utf8"));
}

/** Returns { provider, pharma, registry, details } or null when contracts are not deployed yet. */
function getChain() {
  const details = loadDetails();
  if (!details || !details.pharmaChain) return null;
  if (cached && cached.details.pharmaChain.address === details.pharmaChain.address && cached.details.deployedAt === details.deployedAt) {
    return cached;
  }
  const rpcUrl = process.env.BLOCKCHAIN_RPC_URL || details.rpcUrl || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, polling: true });
  const pharma = new ethers.Contract(details.pharmaChain.address, details.pharmaChain.abi, provider);
  const registry = new ethers.Contract(details.registry.address, details.registry.abi, provider);
  const opt = (d) => (d ? new ethers.Contract(d.address, d.abi, provider) : null);
  cached = {
    provider,
    pharma,
    registry,
    monitor: opt(details.coldChain),
    governance: opt(details.governance),
    validatorSet: opt(details.validatorSet),
    privateDispenser: opt(details.privateDispenser),
    details,
    rpcUrl
  };
  return cached;
}

/** Converts PharmaChain.BatchView (ethers Result) into plain JSON. */
function viewToPlain(v) {
  const b = v.batch;
  return {
    originKey: b.originKey,
    parentKey: b.parentKey,
    unitRoot: b.unitRoot,
    manufacturer: b.manufacturer.toLowerCase(),
    currentOwner: b.currentOwner.toLowerCase(),
    pendingOwner: b.pendingOwner === ethers.ZeroAddress ? null : b.pendingOwner.toLowerCase(),
    unitStart: Number(b.unitStart),
    unitEnd: Number(b.unitEnd),
    dispensed: Number(b.dispensed),
    lotSize: Number(b.lotSize),
    packsPerCarton: Number(b.packsPerCarton),
    cartonsPerCase: Number(b.cartonsPerCase),
    zkRoot: b.zkRoot,
    privateLot: b.zkRoot !== ethers.ZeroHash,
    productionDate: new Date(Number(b.productionDate) * 1000),
    expiryDate: new Date(Number(b.expiryDate) * 1000),
    minTempC: Number(b.minTempDeci) / 10,
    maxTempC: Number(b.maxTempDeci) / 10,
    storedStatus: STATUS_NAMES[Number(b.status)],
    quarantined: b.quarantined,
    batchId: b.batchId,
    drugName: b.drugName,
    productCode: b.productCode,
    status: STATUS_NAMES[Number(v.effectiveStatus)],
    recalled: v.recalled,
    expired: v.expired,
    quantity: Number(v.quantity),
    remaining: Number(v.remaining)
  };
}

module.exports = { getChain, viewToPlain, STATUS_NAMES, ROLE_NAMES, ROLE_IDS };
