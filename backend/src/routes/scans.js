/**
 * Consumer scan analytics (item 10): coarse-location scans of a pack's VISIBLE label.
 *
 *  - authenticity is re-checked server-side against the contract (PharmaChain.verifyUnit), using
 *    the public commitment data of the lot (UnitCommitment) - the client is not trusted;
 *  - Impossible travel: the same unit scanned in two places faster than an airliner could fly
 *    => two physical packs carry the same visible label (clone in circulation);
 *  - Out-of-region sale: a unit scanned far from the pharmacy that dispensed it (shortly after
 *    dispensing) or far from the organisation currently holding it (not yet dispensed) => grey
 *    market / diversion, including diversion between two shipments of the same pharmacy chain,
 *    which the on-chain range check cannot see.
 */
const express = require("express");
const crypto = require("crypto");
const ScanEvent = require("../models/ScanEvent");
const Batch = require("../models/Batch");
const User = require("../models/User");
const Anomaly = require("../models/Anomaly");
const ChainEvent = require("../models/ChainEvent");
const UnitCommitment = require("../models/UnitCommitment");
const { getChain } = require("../config/chain");
const M = require("../utils/unitMerkle");
const geo = require("../utils/geo");

const router = express.Router();

// ------------------------------------------------------------------ helpers
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 10_000) hits.clear();
  return arr.length > RATE_MAX;
}

const hierarchyCache = new Map();
function hierarchyFor(c) {
  const k = `${c.batchId}:${c.root}`;
  if (!hierarchyCache.has(k)) {
    hierarchyCache.set(k, M.buildHierarchy(c.originKey, c.leaves, c.packsPerCarton, c.cartonsPerCase));
    if (hierarchyCache.size > 20) hierarchyCache.delete(hierarchyCache.keys().next().value);
  }
  return hierarchyCache.get(k);
}

const userLoc = (u) =>
  u && u.location && Number.isFinite(u.location.lat) ? { lat: u.location.lat, lon: u.location.lon, city: u.location.city, name: u.companyName || u.name } : null;

async function raise({ type, severity, description, batchId, originBatchId, unitIndex }) {
  const open = await Anomaly.findOne({ originBatchId, unitIndex, type, isResolved: false });
  if (open) return { type, severity, description: open.description, existing: true };
  await Anomaly.create({ batchId, originBatchId, unitIndex, type, severity, description, source: "off-chain", detectedBy: "Consumer scan geo-analytics" });
  return { type, severity, description, existing: false };
}

function historyView(scans) {
  return scans.map((s) => ({ city: s.city || null, at: s.createdAt, authentic: s.authentic, dispensed: s.dispensed, flags: s.flags }));
}

// ------------------------------------------------------------------ routes

// @desc   Record a scan of a pack's visible label and run the geo detectors
// @route  POST /api/scans
// @access Public (rate-limited)
router.post("/", async (req, res) => {
  try {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)) return res.status(429).json({ success: false, message: "Too many scans, try again in a minute" });

    const { batchId, publicTag, city } = req.body || {};
    const index = Number(req.body?.index);
    const lat = Number(req.body?.lat);
    const lon = Number(req.body?.lon);
    const accuracyKm = req.body?.accuracyKm !== undefined ? Number(req.body.accuracyKm) : undefined;
    if (typeof batchId !== "string" || !batchId || !Number.isInteger(index) || index < 0) {
      return res.status(400).json({ success: false, message: "batchId and a non-negative integer index are required" });
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(publicTag || "")) return res.status(400).json({ success: false, message: "publicTag must be bytes32 hex" });
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ success: false, message: "Valid lat/lon are required (city centre is fine)" });
    }

    const holdingDoc = await Batch.findOne({ batchId });
    const lotId = holdingDoc ? holdingDoc.originBatchId || holdingDoc.batchId : batchId;
    const commitment = await UnitCommitment.findOne({ batchId: lotId });
    if (!commitment) return res.status(404).json({ success: false, message: "No unit commitment published for this lot" });
    if (index >= commitment.lotSize) return res.status(400).json({ success: false, message: "Unit index outside the lot" });

    // -- authenticity, decided by the contract
    const chain = getChain();
    if (!chain) return res.status(503).json({ success: false, message: "Blockchain not configured" });
    const proof = M.unitProof(hierarchyFor(commitment), index);
    const v = await chain.pharma.verifyUnit(batchId, index, publicTag, commitment.commitments[index], proof);
    const authentic = v.authentic;
    const dispensed = v.dispensed;

    const scanAt = new Date();
    const originKey = commitment.originKey;
    const previous = authentic ? await ScanEvent.find({ originKey, unitIndex: index, authentic: true }).sort({ createdAt: -1 }).limit(50) : [];

    const flags = [];
    if (authentic) {
      // -- impossible travel
      const it = geo.detectImpossibleTravel({ lat, lon, at: scanAt, city }, previous.map((p) => ({ lat: p.lat, lon: p.lon, at: p.createdAt, city: p.city })));
      if (it) {
        flags.push(
          await raise({
            type: "Impossible Travel",
            severity: "High",
            batchId: holdingDoc?.batchId || lotId,
            originBatchId: lotId,
            unitIndex: index,
            description: `Unit #${index} of lot ${lotId} was scanned in ${city || "an unknown city"} and in ${it.other.city || "another city"} ${it.distanceKm.toFixed(0)} km apart within ${it.hours.toFixed(1)} h (${it.speedKmh.toFixed(0)} km/h > ${geo.IMPOSSIBLE_SPEED_KMH} km/h). Two physical packs carry the same label.`
          })
        );
      }

      // -- out-of-region
      const ctx = {};
      if (dispensed) {
        const ev = await ChainEvent.findOne({ name: "UnitDispensed", originKey, unitIndex: index }).sort({ blockNumber: -1 });
        if (ev) {
          ctx.dispensedAt = ev.timestamp;
          ctx.dispenser = userLoc(await User.findOne({ ethAddress: (ev.actor || "").toLowerCase() }));
        }
      } else {
        const holder = await Batch.findOne({ originKey, unitStart: { $lte: index }, unitEnd: { $gt: index } });
        if (holder) ctx.holder = userLoc(await User.findOne({ ethAddress: holder.currentOwnerEthAddress }));
      }
      const oor = geo.detectOutOfRegion({ lat, lon, at: scanAt }, ctx);
      if (oor) {
        const ref = oor.reference;
        const description =
          oor.mode === "dispensed"
            ? `Unit #${index} of lot ${lotId} was dispensed by ${ref.name} (${ref.city}) but scanned ${oor.distanceKm.toFixed(0)} km away in ${city || "another city"} ${oor.hours.toFixed(1)} h later. Possible resale outside the dispensing region.`
            : `Unit #${index} of lot ${lotId} has not been dispensed and is held by ${ref.name} (${ref.city}), yet it was scanned ${oor.distanceKm.toFixed(0)} km away in ${city || "another city"}. Possible diversion out of the authorised channel.`;
        flags.push(
          await raise({ type: "Out-of-Region Sale", severity: "Medium", batchId: holdingDoc?.batchId || lotId, originBatchId: lotId, unitIndex: index, description })
        );
      }
    }

    await ScanEvent.create({
      batchId,
      originBatchId: lotId,
      originKey,
      unitIndex: index,
      authentic,
      dispensed,
      city: typeof city === "string" ? city.slice(0, 80) : undefined,
      lat,
      lon,
      accuracyKm: Number.isFinite(accuracyKm) ? accuracyKm : undefined,
      flags: flags.map((f) => f.type),
      ipHash: crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16)
    });

    const history = await ScanEvent.find({ originKey, unitIndex: index }).sort({ createdAt: -1 }).limit(10);
    res.status(201).json({ success: true, authentic, dispensed, flags, history: historyView(history) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @desc   Scan history of one unit (for the public verify page)
// @route  GET /api/scans/:batchId/:index
// @access Public
router.get("/:batchId/:index", async (req, res) => {
  try {
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ success: false, message: "Invalid index" });
    const holdingDoc = await Batch.findOne({ batchId: req.params.batchId });
    const lotId = holdingDoc ? holdingDoc.originBatchId || holdingDoc.batchId : req.params.batchId;
    const commitment = await UnitCommitment.findOne({ batchId: lotId }).select("originKey");
    const originKey = commitment ? commitment.originKey : M.batchKey(lotId).toLowerCase();
    const scans = await ScanEvent.find({ originKey, unitIndex: index }).sort({ createdAt: -1 }).limit(20);
    const open = await Anomaly.find({ originBatchId: lotId, unitIndex: index, isResolved: false, type: { $in: ["Impossible Travel", "Out-of-Region Sale"] } }).select(
      "type severity description createdAt"
    );
    res.json({ success: true, data: { history: historyView(scans), flags: open } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
