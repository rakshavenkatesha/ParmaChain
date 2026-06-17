const Anomaly = require("../models/Anomaly");
const User = require("../models/User");

/**
 * Runs a comprehensive anomaly and counterfeit analysis on a drug batch.
 * @param {Object} batch - The batch document from MongoDB.
 * @param {Array} custodyUsers - List of user objects corresponding to the chain of custody.
 * @returns {Object} { riskScore, anomaliesDetected }
 */
const analyzeBatch = async (batch, custodyUsers) => {
  let riskScore = 0;
  const anomaliesDetected = [];

  const now = new Date();

  // 1. Expired Product Detection
  if (batch.expiryDate < now && (batch.status === "Manufactured" || batch.status === "In Transit" || batch.status === "Received")) {
    riskScore += 40;
    anomaliesDetected.push({
      type: "Expired Product Active",
      severity: "High",
      description: `Batch ${batch.batchId} has expired on ${batch.expiryDate.toLocaleDateString()}, but is still active in the supply chain with status "${batch.status}".`
    });
  }

  // 2. Chain of Custody / Missing Transfer Stage Detection
  // Valid flow: Manufacturer (index 0) -> Distributor (index 1) -> Pharmacy (index 2)
  if (custodyUsers && custodyUsers.length > 1) {
    const roles = custodyUsers.map(u => u ? u.role : "Unknown");
    
    // Check if the chain skips directly from Manufacturer to Pharmacy
    if (roles[0] === "Manufacturer" && roles.includes("Pharmacy") && !roles.includes("Distributor")) {
      riskScore += 50;
      anomaliesDetected.push({
        type: "Missing Transfer Stage",
        severity: "Critical",
        description: `Batch ${batch.batchId} was transferred from Manufacturer directly to Pharmacy, skipping the expected Distributor stage.`
      });
    }

    // 3. Unauthorized Transfer / Reverse Flow Check
    // Check if any transfer was initiated by a Pharmacy
    for (const histItem of batch.history) {
      if (histItem.action === "Transfer Initiated" && histItem.from && histItem.from !== "system") {
        const sender = await User.findOne({ ethAddress: histItem.from.toLowerCase() });
        if (sender && sender.role === "Pharmacy") {
          riskScore += 45;
          anomaliesDetected.push({
            type: "Unauthorized Transfer",
            severity: "High",
            description: `Batch ${batch.batchId} records a transfer initiated by a Pharmacy (${sender.name}), which is unauthorized downstream logic.`
          });
        }
      }
    }
  }

  // 4. Verification Count / Suspicious Scan Monitoring
  // If the batch has been scanned/verified an abnormally high number of times (e.g. > 50), it could indicate duplicate printed QR codes.
  if (batch.verificationCount > 50) {
    riskScore += 30;
    anomaliesDetected.push({
      type: "Duplicate QR Code Scan",
      severity: "Medium",
      description: `Batch ${batch.batchId} has been verified ${batch.verificationCount} times, which suggests potential duplicate QR label replication.`
    });
  }

  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100);

  // Write newly detected anomalies to the database (only if they don't already exist for this batch)
  for (const anomaly of anomaliesDetected) {
    const exists = await Anomaly.findOne({
      batchId: batch.batchId,
      type: anomaly.type,
      isResolved: false
    });

    if (!exists) {
      await Anomaly.create({
        batchId: batch.batchId,
        type: anomaly.type,
        severity: anomaly.severity,
        description: anomaly.description
      });
    }
  }

  return {
    riskScore,
    anomalies: anomaliesDetected
  };
};

module.exports = {
  analyzeBatch
};
