const express = require("express");
const Batch = require("../models/Batch");
const User = require("../models/User");
const Anomaly = require("../models/Anomaly");
const ChainEvent = require("../models/ChainEvent");
const UnitCommitment = require("../models/UnitCommitment");
const { protect, authorize } = require("../middleware/auth");
const { analyzeBatch } = require("../utils/anomalyDetector");
const { getChain, viewToPlain } = require("../config/chain");
const M = require("../utils/unitMerkle");
const indexer = require("../services/chainIndexer");

const router = express.Router();

// The packaging hierarchy (carton / case / lot trees) is rebuilt from stored leaf hashes on demand;
// keep a few hot lots in memory.
const hierarchyCache = new Map();
function hierarchyFor(commitment) {
  const k = commitment.batchId + ":" + commitment.root;
  if (!hierarchyCache.has(k)) {
    hierarchyCache.set(k, M.buildHierarchy(commitment.originKey, commitment.leaves, commitment.packsPerCarton, commitment.cartonsPerCase));
    if (hierarchyCache.size > 20) hierarchyCache.delete(hierarchyCache.keys().next().value);
  }
  return hierarchyCache.get(k);
}

/** Lot commitment for any batch id in the lineage (shipments share their lot's commitment). */
async function commitmentFor(batchId) {
  const batch = await Batch.findOne({ batchId });
  const lotId = batch ? batch.originBatchId || batch.batchId : batchId;
  return { batch, lotId, commitment: await UnitCommitment.findOne({ batchId: lotId }) };
}

async function nameOf(address) {
  if (!address) return null;
  const u = await User.findOne({ ethAddress: address.toLowerCase() }).select("name companyName role");
  return u ? { name: u.companyName || u.name, role: u.role } : null;
}

// @desc    Wait until the indexer has processed a block (dApp calls this after tx.wait())
// @route   GET /api/batches/sync/:blockNumber
// @access  Private
router.get("/sync/:blockNumber", protect, async (req, res) => {
  const ok = await indexer.waitForBlock(Number(req.params.blockNumber));
  res.json({ success: ok, indexedBlock: indexer.state.lastBlock });
});

// @desc    Recent on-chain events touching the caller's batches (activity feed)
// @route   GET /api/batches/activity
// @access  Private
router.get("/activity", protect, async (req, res) => {
  try {
    const me = (req.user.ethAddress || "").toLowerCase();
    const q = req.user.role === "Admin" ? {} : { $or: [{ currentOwnerEthAddress: me }, { pendingOwnerEthAddress: me }, { custody: me }] };
    const mine = await Batch.find(q).select("batchKey originKey");
    const keys = [...new Set(mine.flatMap((b) => [b.batchKey, b.originKey]))];
    const events = await ChainEvent.find({
      contract: "PharmaChain",
      name: { $ne: "TemperatureRecorded" },
      $or: [{ batchKey: { $in: keys } }, { originKey: { $in: keys } }]
    })
      .sort({ blockNumber: -1, logIndex: -1 })
      .limit(Math.min(Number(req.query.limit) || 25, 100));
    res.json({ success: true, data: events });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    List batches visible to the caller
// @route   GET /api/batches
// @access  Private
router.get("/", protect, async (req, res) => {
  try {
    const query = {};
    if (req.query.search) {
      query.$or = [
        { batchId: { $regex: req.query.search, $options: "i" } },
        { drugName: { $regex: req.query.search, $options: "i" } }
      ];
    }
    const me = (req.user.ethAddress || "").toLowerCase();
    if (req.user.role !== "Admin") {
      // everything I own, am about to receive, or have held in the past
      query.$and = [{ $or: [{ currentOwnerEthAddress: me }, { pendingOwnerEthAddress: me }, { custody: me }] }];
    }
    const batches = await Batch.find(query)
      .populate("manufacturer", "name companyName")
      .populate("currentOwner", "name companyName")
      .sort({ createdAt: -1 });
    res.json({ success: true, count: batches.length, data: batches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Batch details + risk analysis
// @route   GET /api/batches/:batchId
// @access  Private
router.get("/:batchId", protect, async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchId: req.params.batchId })
      .populate("manufacturer", "name companyName role")
      .populate("currentOwner", "name companyName role");
    if (!batch) return res.status(404).json({ success: false, message: "Batch not found" });

    const { riskScore, anomalies } = await analyzeBatch(batch);
    batch.riskScore = riskScore;
    await batch.save();
    res.json({ success: true, data: batch, riskScore, anomalies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Public batch-level verification. Reads the LIVE contract state and cross-checks the cache.
// @route   POST /api/batches/:batchId/verify
// @access  Public
router.post("/:batchId/verify", async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchId: req.params.batchId })
      .populate("manufacturer", "name companyName")
      .populate("currentOwner", "name companyName");

    // Source of truth: the contract
    let onChain = null;
    const chain = getChain();
    if (chain) {
      try {
        onChain = viewToPlain(await chain.pharma.getBatch(req.params.batchId));
      } catch (e) {
        onChain = null; // "Batch does not exist" revert
      }
    }

    if (!onChain && !batch) {
      return res.status(404).json({
        success: false,
        authenticityStatus: "Invalid",
        message: "This Batch ID is not registered on the PharmaChain ledger. The product is likely counterfeit."
      });
    }
    if (!batch) {
      return res.json({
        success: true,
        authenticityStatus: "Genuine",
        riskScore: 0,
        onChain,
        data: { ...onChain, history: [] },
        anomalies: [],
        note: "Found on-chain; the off-chain index is still catching up."
      });
    }

    batch.verificationCount += 1;
    const { riskScore, anomalies } = await analyzeBatch(batch);

    // Integrity cross-check between cache and ledger
    if (onChain && onChain.status !== batch.status) {
      anomalies.unshift({
        type: "Cache Divergence",
        severity: "Low",
        description: `Off-chain cache says "${batch.status}" but the ledger says "${onChain.status}". The ledger value is authoritative.`,
        source: "off-chain"
      });
    }
    batch.riskScore = riskScore;
    await batch.save();

    const status = onChain ? onChain.status : batch.status;
    let authenticityStatus = "Genuine";
    if (status === "Recalled") authenticityStatus = "Recalled";
    else if ((onChain ? onChain.expired : batch.expiryDate < new Date())) authenticityStatus = "Expired";
    else if (status === "Quarantined") authenticityStatus = "Quarantined";
    else if (riskScore >= 70) authenticityStatus = "Critical Alert";
    else if (riskScore > 30) authenticityStatus = "Suspicious";

    const custody = [];
    for (const addr of batch.custody || []) custody.push({ address: addr, ...(await nameOf(addr)) });

    res.json({ success: true, authenticityStatus, riskScore, onChain, custody, data: batch, anomalies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Publish a lot's public commitment data (pack leaves + hidden-code commitments).
//          Never receives visible tags or scratch codes. Verified against the on-chain root.
// @route   POST /api/batches/:batchId/units
// @access  Private (Manufacturer)
router.post("/:batchId/units", protect, authorize("Manufacturer"), async (req, res) => {
  try {
    const { leaves, commitments } = req.body;
    const isHex32 = (x) => /^0x[0-9a-fA-F]{64}$/.test(x);
    if (!Array.isArray(leaves) || !leaves.length || !leaves.every(isHex32) || !Array.isArray(commitments) || commitments.length !== leaves.length || !commitments.every(isHex32)) {
      return res.status(400).json({ success: false, message: "leaves and commitments must be equal-length arrays of bytes32" });
    }
    const chain = getChain();
    if (!chain) return res.status(503).json({ success: false, message: "Blockchain not configured" });
    let v;
    try {
      v = viewToPlain(await chain.pharma.getBatch(req.params.batchId));
    } catch {
      return res.status(404).json({ success: false, message: "Batch is not registered on-chain yet" });
    }
    if (v.originKey.toLowerCase() !== M.batchKey(req.params.batchId).toLowerCase()) {
      return res.status(400).json({ success: false, message: "Commitments can only be published for a production lot" });
    }
    if (v.manufacturer !== (req.user.ethAddress || "").toLowerCase()) {
      return res.status(403).json({ success: false, message: "Only the lot's manufacturer can publish its commitment" });
    }
    if (leaves.length !== v.lotSize) return res.status(400).json({ success: false, message: `Expected ${v.lotSize} leaves` });
    const h = M.buildHierarchy(v.originKey, leaves, v.packsPerCarton, v.cartonsPerCase);
    if (h.root.toLowerCase() !== v.unitRoot.toLowerCase()) {
      return res.status(400).json({ success: false, message: "Leaves do not reproduce the Merkle root stored on-chain - rejected" });
    }
    await UnitCommitment.findOneAndUpdate(
      { batchId: req.params.batchId },
      {
        batchId: req.params.batchId,
        originKey: v.originKey,
        root: h.root,
        lotSize: leaves.length,
        packsPerCarton: v.packsPerCarton,
        cartonsPerCase: v.cartonsPerCase,
        leaves,
        commitments
      },
      { upsert: true }
    );
    res.status(201).json({ success: true, message: `Commitment for ${leaves.length} units (${h.cartonCount} cartons, ${h.caseCount} cases) stored`, root: h.root });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Hierarchical proof + public commitment + dispensing timeline for one pack
// @route   GET /api/batches/:batchId/units/:index
// @access  Public (proofs and commitments are not secret)
router.get("/:batchId/units/:index", async (req, res) => {
  try {
    const index = Number(req.params.index);
    const { lotId, commitment } = await commitmentFor(req.params.batchId);
    if (!commitment) return res.status(404).json({ success: false, message: "No unit commitment published for this lot" });
    if (!Number.isInteger(index) || index < 0 || index >= commitment.lotSize) {
      return res.status(400).json({ success: false, message: "Unit index outside the lot" });
    }
    const h = hierarchyFor(commitment);
    const proof = M.unitProof(h, index);
    const carton = Math.floor(index / h.packsPerCarton);
    const events = await ChainEvent.find({
      originKey: commitment.originKey,
      unitIndex: index,
      name: { $in: ["UnitDispensed", "CloneDetected", "CounterfeitDetected", "DiversionDetected", "ReturnRequested", "UnitReturned"] }
    }).sort({ blockNumber: 1 });
    const timeline = [];
    for (const e of events) {
      timeline.push({ event: e.name, at: e.timestamp, txHash: e.txHash, blockNumber: e.blockNumber, pharmacy: { address: e.actor, ...(await nameOf(e.actor)) } });
    }
    res.json({
      success: true,
      lotBatchId: lotId,
      root: commitment.root,
      lotSize: commitment.lotSize,
      index,
      packaging: { packsPerCarton: h.packsPerCarton, cartonsPerCase: h.cartonsPerCase, carton, case: Math.floor(carton / h.cartonsPerCase) },
      leaf: commitment.leaves[index],
      commitment: commitment.commitments[index],
      proof,
      timeline
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Aggregate labels (cases / cartons) that exactly cover a shipment, with proofs
// @route   GET /api/batches/:batchId/aggregation
// @access  Private
router.get("/:batchId/aggregation", protect, async (req, res) => {
  try {
    const { batch, commitment } = await commitmentFor(req.params.batchId);
    if (!batch || !commitment) return res.status(404).json({ success: false, message: "Unknown batch or no commitment" });
    const h = hierarchyFor(commitment);
    const scans = M.aggregationScans(h, batch.unitStart, batch.unitEnd);
    if (!scans) {
      return res.status(409).json({ success: false, message: `Units ${batch.unitStart}-${batch.unitEnd - 1} are not carton-aligned; accept pack by pack instead.` });
    }
    res.json({
      success: true,
      data: {
        unitStart: batch.unitStart,
        unitEnd: batch.unitEnd,
        packs: batch.unitEnd - batch.unitStart,
        scans: scans.map((x) => ({ ...x, label: x.level === 2 ? `CASE ${x.index}` : `CARTON ${x.index}` }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Merkle multiproof for several packs of one carton (batch dispensing)
// @route   POST /api/batches/:batchId/carton-proof   { cartonIndex, indices: [] }
// @access  Private
router.post("/:batchId/carton-proof", protect, async (req, res) => {
  try {
    const { commitment } = await commitmentFor(req.params.batchId);
    if (!commitment) return res.status(404).json({ success: false, message: "No commitment for this lot" });
    const h = hierarchyFor(commitment);
    const { cartonIndex, indices } = req.body;
    if (!Number.isInteger(cartonIndex) || !Array.isArray(indices) || !indices.length) {
      return res.status(400).json({ success: false, message: "cartonIndex and indices are required" });
    }
    res.json({ success: true, data: M.cartonMultiProof(h, cartonIndex, indices.map(Number)) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// @desc    Cold-chain status: sensors, readings and Mean Kinetic Temperature
// @route   GET /api/batches/:batchId/coldchain
// @access  Public
router.get("/:batchId/coldchain", async (req, res) => {
  try {
    const chain = getChain();
    if (!chain || !chain.monitor) return res.json({ success: true, data: null });
    const m = await chain.monitor.getMonitor(req.params.batchId);
    const key = M.batchKey(req.params.batchId).toLowerCase();
    const readings = await ChainEvent.find({ batchKey: key, name: "ReadingAccepted" }).sort({ blockNumber: 1 }).limit(500);
    const evidence = await ChainEvent.find({ batchKey: key, name: { $in: ["SensorOutlier", "SensorDisagreement", "ColdChainBreach"] } }).sort({ blockNumber: 1 });
    const zero = "0x0000000000000000000000000000000000000000";
    const assigned = m.sensors.filter((a) => a !== zero);
    const labelOf = (a) => (chain.details.sensors || []).find((x) => x.address.toLowerCase() === a.toLowerCase())?.label || null;
    res.json({
      success: true,
      data: {
        sensors: assigned.map((a) => ({ address: a, label: labelOf(a) })),
        readings: readings.map((r) => ({ seq: Number(r.args.seq), tempC: Number(r.args.agreedDeci) / 10, mktC: Number(r.args.mktDeci) / 10, signatures: Number(r.args.validSignatures), at: r.timestamp, blockNumber: r.blockNumber })),
        count: Number(m.count),
        mktC: Number(m.count) ? Number(m.mktDeci) / 10 : null,
        lastC: Number(m.count) ? Number(m.lastAgreedDeci) / 10 : null,
        breached: m.breached,
        evidence: evidence.map((e) => ({ event: e.name, args: e.args, blockNumber: e.blockNumber, txHash: e.txHash, at: e.timestamp }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Full lineage of a production lot: every shipment, its unit range, owner and per-unit state
// @route   GET /api/batches/:batchId/lineage
// @access  Public (mirrors public ledger data)
router.get("/:batchId/lineage", async (req, res) => {
  try {
    const any = await Batch.findOne({ batchId: req.params.batchId });
    if (!any) return res.status(404).json({ success: false, message: "Batch not found" });
    const originKey = any.originKey;
    const shipments = await Batch.find({ originKey })
      .select("batchId parentBatchId unitStart unitEnd quantity dispensedCount status currentOwnerEthAddress pendingOwnerEthAddress custody createdAt")
      .sort({ createdAt: 1 })
      .lean();
    const lot = shipments.find((s) => !s.parentBatchId) || any;

    const owners = {};
    for (const s of shipments) {
      for (const a of [s.currentOwnerEthAddress, s.pendingOwnerEthAddress, ...(s.custody || [])]) {
        if (a && !owners[a]) owners[a] = await nameOf(a);
      }
    }

    const unitEvents = await ChainEvent.find({
      originKey,
      name: { $in: ["UnitDispensed", "CloneDetected", "CounterfeitDetected", "DiversionDetected"] }
    })
      .select("name unitIndex actor blockNumber txHash timestamp")
      .sort({ blockNumber: 1 })
      .lean();

    const dispensed = unitEvents.filter((e) => e.name === "UnitDispensed").map((e) => e.unitIndex);
    const flagged = {};
    for (const e of unitEvents) if (e.name !== "UnitDispensed") (flagged[e.unitIndex] = flagged[e.unitIndex] || []).push(e.name);

    res.json({
      success: true,
      data: {
        lotBatchId: lot.batchId,
        packsPerCarton: any.packsPerCarton,
        cartonsPerCase: any.cartonsPerCase,
        privateLot: !!any.privateLot,
        lotSize: any.lotSize || (await Batch.findOne({ batchKey: originKey }))?.lotSize || shipments.reduce((s, x) => Math.max(s, x.unitEnd || 0), 0),
        shipments,
        owners,
        dispensed,
        flagged,
        events: unitEvents.slice(-50)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Report suspicious batch activity (public)
// @route   POST /api/batches/:batchId/report
// @access  Public
router.post("/:batchId/report", async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || !description.trim()) {
      return res.status(400).json({ success: false, message: "Description required" });
    }
    const batch = await Batch.findOne({ batchId: req.params.batchId });
    await Anomaly.create({
      batchId: req.params.batchId,
      originBatchId: batch ? batch.originBatchId : undefined,
      type: "Suspicious Transaction Frequency",
      severity: "High",
      description: `Consumer Alert: ${description.slice(0, 1000)}`,
      detectedBy: "Consumer Feedback Portal",
      source: "off-chain"
    });
    res.status(201).json({ success: true, message: "Safety report logged successfully. Regulatory teams notified." });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
