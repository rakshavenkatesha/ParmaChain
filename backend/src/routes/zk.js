/**
 * Zero-knowledge (private lot) support - mounted at /api/zk.
 *
 *   POST /api/zk/:batchId/leaves          manufacturer publishes the Poseidon leaves of a private lot
 *   GET  /api/zk/:batchId/path/:index     Merkle path for proving (batchId may be any shipment of the lot)
 *   GET  /api/zk/nullifier/:nullifier     has this one-time tag been spent?
 *   GET  /api/zk/status                   is the PrivateDispenser module deployed?
 *
 * The Poseidon tree code is shared with the circuit tooling (blockchain/scripts/zk/zkTree.js).
 */
const express = require("express");
const path = require("path");
const ZkLot = require("../models/ZkLot");
const { protect, authorize } = require("../middleware/auth");
const { getChain } = require("../config/chain");

let Z = null;
function zk() {
  if (!Z) Z = require(path.resolve(__dirname, "../../../blockchain/scripts/zk/zkTree.js"));
  return Z;
}

const router = express.Router();
const treeCache = new Map();

function treeFor(doc) {
  const k = doc.batchId + ":" + doc.zkRoot;
  if (!treeCache.has(k)) {
    treeCache.set(k, zk().buildTree(doc.leaves.map(BigInt)));
    if (treeCache.size > 20) treeCache.delete(treeCache.keys().next().value);
  }
  return treeCache.get(k);
}

async function onChain(batchId) {
  const chain = getChain();
  if (!chain) throw Object.assign(new Error("Contracts not deployed"), { status: 503 });
  try {
    return { chain, v: await chain.pharma.getBatch(batchId) };
  } catch {
    throw Object.assign(new Error("Batch is not registered on-chain"), { status: 404 });
  }
}

const fail = (res, e) => res.status(e.status || 500).json({ success: false, message: e.message });

// @route GET /api/zk/status
router.get("/status", (req, res) => {
  const chain = getChain();
  const d = chain && chain.details.privateDispenser;
  res.json({ success: true, data: { available: !!d, dispenser: d ? d.address : null, depth: zk().DEPTH, maxUnits: 2 ** zk().DEPTH } });
});

// @route POST /api/zk/:batchId/leaves   body: { leaves: [decimal|hex field elements] }
router.post("/:batchId/leaves", protect, authorize("Manufacturer"), async (req, res) => {
  try {
    const { leaves } = req.body;
    if (!Array.isArray(leaves) || leaves.length === 0) return res.status(400).json({ success: false, message: "leaves must be a non-empty array" });
    const { v } = await onChain(req.params.batchId);
    const b = v.batch;
    if (BigInt(b.parentKey) !== 0n) {
      return res.status(400).json({ success: false, message: "Leaves can only be published for a production lot" });
    }
    if (b.manufacturer.toLowerCase() !== (req.user.ethAddress || "").toLowerCase()) {
      return res.status(403).json({ success: false, message: "Only the lot's manufacturer can publish its private commitment" });
    }
    if (BigInt(b.zkRoot) === 0n) return res.status(400).json({ success: false, message: "This lot was not registered as a private (ZK) lot" });
    if (leaves.length !== Number(b.lotSize)) return res.status(400).json({ success: false, message: `Expected ${b.lotSize} leaves` });

    const Zm = zk();
    let parsed;
    try {
      parsed = leaves.map((x) => BigInt(x));
    } catch {
      return res.status(400).json({ success: false, message: "Leaves must be field elements" });
    }
    if (parsed.some((x) => x < 0n || x >= Zm.FIELD)) return res.status(400).json({ success: false, message: "Leaf outside the BN254 field" });
    const { root } = Zm.buildTree(parsed);
    if (Zm.toBytes32(root) !== b.zkRoot.toLowerCase()) {
      return res.status(400).json({ success: false, message: "Leaves do not reproduce the zkRoot stored on-chain - rejected" });
    }
    await ZkLot.findOneAndUpdate(
      { batchId: req.params.batchId },
      { batchId: req.params.batchId, originKey: b.originKey.toLowerCase(), zkRoot: b.zkRoot.toLowerCase(), lotTag: Zm.lotTagOf(b.originKey).toString(), leaves: parsed.map(String) },
      { upsert: true }
    );
    res.status(201).json({ success: true, message: `Private commitment for ${parsed.length} units stored`, zkRoot: b.zkRoot });
  } catch (e) {
    fail(res, e);
  }
});

// @route GET /api/zk/:batchId/path/:index
router.get("/:batchId/path/:index", async (req, res) => {
  try {
    const index = Number(req.params.index);
    const { v } = await onChain(req.params.batchId);
    const doc = await ZkLot.findOne({ originKey: v.batch.originKey.toLowerCase() });
    if (!doc) return res.status(404).json({ success: false, message: "No private commitment published for this lot" });
    if (!Number.isInteger(index) || index < 0 || index >= doc.leaves.length) return res.status(400).json({ success: false, message: "Unit index outside the lot" });
    const { layers, root } = treeFor(doc);
    res.json({
      success: true,
      data: {
        lotBatchId: doc.batchId,
        zkRoot: doc.zkRoot,
        root: root.toString(),
        lotTag: doc.lotTag,
        index,
        depth: zk().DEPTH,
        pathElements: zk().pathOf(layers, index).map(String),
        shipment: { batchId: v.batch.batchId, unitStart: Number(v.batch.unitStart), unitEnd: Number(v.batch.unitEnd) }
      }
    });
  } catch (e) {
    fail(res, e);
  }
});

// @route GET /api/zk/nullifier/:nullifier
router.get("/nullifier/:nullifier", async (req, res) => {
  try {
    const chain = getChain();
    if (!chain || !chain.details.privateDispenser) return res.status(503).json({ success: false, message: "ZK module not deployed" });
    const { ethers } = require("ethers");
    const d = new ethers.Contract(chain.details.privateDispenser.address, chain.details.privateDispenser.abi, chain.provider);
    res.json({ success: true, data: { nullifier: req.params.nullifier, spent: await d.isNullifierUsed(req.params.nullifier) } });
  } catch (e) {
    fail(res, e);
  }
});

module.exports = router;
