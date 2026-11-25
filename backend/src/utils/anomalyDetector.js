const Anomaly = require("../models/Anomaly");

/**
 * Risk scoring.
 *
 * Earlier versions *guessed* at fraud with off-chain heuristics (skipped stages, scan counts).
 * Those rules are now enforced by the smart contract (a skipped stage simply reverts), and fraud
 * evidence arrives as deterministic on-chain events (clone / forgery / diversion / cold-chain).
 * This module only aggregates that evidence into a 0-100 score for a batch's whole lot lineage
 * and adds the one time-dependent check the chain cannot push by itself: expiry.
 */
const WEIGHT = { Critical: 50, High: 35, Medium: 20, Low: 10 };

const analyzeBatch = async (batch) => {
  const now = new Date();
  const active = ["Manufactured", "In Transit", "Received"];

  if (batch.expiryDate < now && active.includes(batch.status)) {
    const exists = await Anomaly.exists({ batchId: batch.batchId, type: "Expired Product Active", isResolved: false });
    if (!exists) {
      await Anomaly.create({
        batchId: batch.batchId,
        originBatchId: batch.originBatchId,
        type: "Expired Product Active",
        severity: "High",
        description: `Batch ${batch.batchId} expired on ${batch.expiryDate.toISOString().slice(0, 10)} but is still "${batch.status}". The contract blocks further movement; physical stock should be destroyed.`
      });
    }
  }

  const lot = batch.originBatchId || batch.batchId;
  const anomalies = await Anomaly.find({
    isResolved: false,
    $or: [{ batchId: batch.batchId }, { originBatchId: lot }, { batchId: lot }]
  }).sort({ createdAt: -1 });

  let riskScore = anomalies.reduce((sum, a) => sum + (WEIGHT[a.severity] || 0), 0);
  if (batch.status === "Recalled") riskScore = Math.max(riskScore, 90);
  if (batch.status === "Quarantined") riskScore = Math.max(riskScore, 60);
  riskScore = Math.min(riskScore, 100);

  return {
    riskScore,
    anomalies: anomalies.map((a) => ({
      type: a.type,
      severity: a.severity,
      description: a.description,
      source: a.source,
      unitIndex: a.unitIndex,
      txHash: a.txHash,
      createdAt: a.createdAt
    }))
  };
};

module.exports = { analyzeBatch };
